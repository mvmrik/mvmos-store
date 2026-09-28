// mvmVideo — rendering the timeline into a video file.
//
// Nothing here plays anything back. Each output frame is composed from the
// exact decoded source frame for its timestamp (Mediabunny's sample sinks
// decode every packet once, in order), so the result does not depend on how
// fast the computer is and no frame is skipped or repeated. A source whose
// size matches the project is copied pixel for pixel; others are scaled with
// the browser's best filter. The only generation loss is the one encode, at a
// bitrate chosen from the resolution and frame rate.
//
// Audio is mixed ahead of the video in short segments with an
// OfflineAudioContext, which also resamples every source to 48 kHz, and fed
// to the encoder interleaved with the frames.
(function () {
  const M = () => window.MvmVideoMedia;

  const AUDIO_RATE = 48000;
  const SEGMENT = 20;      // seconds of audio mixed at a time
  const PAD = 0.1;         // decoded margin around each segment, so the resampler never starts cold
  const EPS = 1e-6;

  // Bits per pixel per frame. "max" is well above what H.264 needs to be
  // visually transparent at these sizes; the others trade size for quality.
  const BPP = { max: 0.2, high: 0.12, standard: 0.07 };
  const AUDIO_BITRATE = { max: 320000, high: 256000, standard: 192000 };

  function clipLen(c) { return c.out - c.in; }
  function clipEnd(c) { return c.start + clipLen(c); }
  function projectDuration(p) { return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); }

  function videoBitrate(p, quality, media) {
    let b = p.width * p.height * p.fps * (BPP[quality] || BPP.max);
    if (quality === 'max') {
      // Never below the richest source, scaled to the output size.
      for (const m of Object.values(media)) {
        if (m.info.kind !== 'video' || !m.info.bitrate || !m.info.width) continue;
        const scale = (p.width * p.height) / (m.info.width * m.info.height);
        b = Math.max(b, m.info.bitrate * Math.min(1, scale) * 1.25);
      }
    }
    return Math.round(Math.min(160e6, Math.max(2e6, b)));
  }

  function estimateBytes(p, quality, media) {
    const d = projectDuration(p);
    const hasAudio = p.clips.some(c => audible(p, c, media));
    return d * (videoBitrate(p, quality, media) + (hasAudio ? AUDIO_BITRATE[quality] || 0 : 0)) / 8;
  }

  function trackOf(p, c) { return p.tracks.find(t => t.id === c.track); }
  function audible(p, c, media) {
    const tr = trackOf(p, c);
    const m = media[c.media];
    if (!tr || tr.muted || !m || !(c.volume > 0)) return false;
    return m.info.kind === 'audio' || (m.info.kind === 'video' && m.info.hasAudio);
  }

  // Which codecs this browser can write at this size: MP4 with H.264 when it
  // can, WebM with VP9 otherwise.
  async function pickFormat(p, vbps) {
    const MB = await M().loadMB();
    if (typeof VideoEncoder === 'undefined') return null;
    const vq = new MB.Quality({ bitrate: vbps });
    const aq = new MB.Quality({ bitrate: 256000 });
    const size = { width: p.width, height: p.height, quality: vq };
    const aopt = { numberOfChannels: 2, sampleRate: AUDIO_RATE, quality: aq };
    const avc = await MB.getFirstEncodableVideoCodec(['avc'], size);
    if (avc) {
      const audio = await MB.getFirstEncodableAudioCodec(['aac', 'opus'], aopt);
      return { container: 'mp4', video: avc, audio };
    }
    const vp = await MB.getFirstEncodableVideoCodec(['vp9', 'av1', 'vp8'], size);
    if (vp) {
      const audio = await MB.getFirstEncodableAudioCodec(['opus'], aopt);
      return { container: 'webm', video: vp, audio };
    }
    return null;
  }

  const CODEC_NAMES = { avc: 'H.264', vp9: 'VP9', av1: 'AV1', vp8: 'VP8', aac: 'AAC', opus: 'Opus' };
  function describeFormat(f) {
    if (!f) return '';
    return f.container.toUpperCase() + ' (' + [f.video, f.audio].filter(Boolean).map(c => CODEC_NAMES[c] || c).join(' + ') + ')';
  }

  // Collects the muxer's writes into Blobs, which the browser may keep on
  // disk, instead of one ArrayBuffer the size of the whole film. Writes are
  // appended in order; the few that go back to patch a header are applied
  // at the end by slicing.
  function blobCollector(mime) {
    const parts = [];
    const patches = [];
    let size = 0;
    const writable = new WritableStream({
      write(chunk) {
        const { data, position } = chunk;
        if (position === size) {
          parts.push(new Blob([data]));
          size += data.byteLength;
        } else if (position > size) {
          parts.push(new Blob([new Uint8Array(position - size)]), new Blob([data]));
          size = position + data.byteLength;
        } else {
          patches.push({ position, data: new Blob([data]) });
          if (position + data.byteLength > size) size = position + data.byteLength;
        }
      },
    });
    function finish() {
      let blob = new Blob(parts);
      for (const { position, data } of patches) {
        const end = position + data.size;
        blob = new Blob([blob.slice(0, position), data, blob.slice(Math.min(end, blob.size))]);
      }
      return new Blob([blob], { type: mime });
    }
    return { writable, finish };
  }

  // Draws a still into the frame the same way the preview does: whole
  // picture, centred, black around it.
  function drawContain(ctx, src, sw, sh, W, H) {
    const s = Math.min(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  async function run({ project, media, quality, onProgress, signal }) {
    const MB = await M().loadMB();
    const p = project;
    const W = p.width, H = p.height, fps = p.fps;
    const duration = projectDuration(p);
    if (!(duration > 0)) throw new Error('empty');
    const totalFrames = Math.max(1, Math.ceil(duration * fps - 1e-3));
    const vbps = videoBitrate(p, quality, media);
    const fmt = await pickFormat(p, vbps);
    if (!fmt) throw new Error('no_encoder');

    const audioClips = p.clips.filter(c => audible(p, c, media));
    const withAudio = !!(fmt.audio && audioClips.length);

    const format = fmt.container === 'mp4'
      ? new MB.Mp4OutputFormat({ fastStart: false })
      : new MB.WebMOutputFormat();
    const collector = blobCollector(format.mimeType);
    const output = new MB.Output({ format, target: new MB.StreamTarget(collector.writable, { chunked: true }) });

    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const videoSource = new MB.CanvasSource(canvas, {
      codec: fmt.video,
      quality: new MB.Quality({ bitrate: vbps, bitrateMode: 'variable' }),
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource = null;
    if (withAudio) {
      audioSource = new MB.AudioBufferSource({ codec: fmt.audio, quality: new MB.Quality({ bitrate: AUDIO_BITRATE[quality] || AUDIO_BITRATE.max }) });
      output.addAudioTrack(audioSource);
    }

    // Open decoders per clip, created when the clip first shows up and
    // closed as soon as it ends.
    const open = new Map();
    const images = new Map();
    const inputs = [];
    const cleanup = async () => {
      for (const st of open.values()) { try { await st.iter.return(); } catch (e) { /* closing */ } }
      open.clear();
      for (const i of inputs) { try { i.dispose(); } catch (e) { /* closing */ } }
      for (const b of images.values()) { try { b.close(); } catch (e) { /* closing */ } }
    };
    const checkAbort = () => { if (signal && signal.aborted) throw new Error('aborted'); };

    const frameTime = k => k / fps;
    const activeAt = (c, k) => { const t = frameTime(k) + EPS; return t >= c.start && t < clipEnd(c); };

    async function openClip(c, k0) {
      const m = media[c.media];
      const input = new MB.Input({ source: new MB.BlobSource(m.blob), formats: MB.ALL_FORMATS });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      const sink = new MB.VideoSampleSink(track);
      const t0 = m.info.t0 || 0;
      const last = t0 + c.out - 1e-4;
      function* times() {
        for (let k = k0; activeAt(c, k); k++) {
          yield Math.min(last, t0 + c.in + (frameTime(k) - c.start) + 1e-4);
        }
      }
      const st = { iter: sink.samplesAtTimestamps(times()), input };
      open.set(c.id, st);
      return st;
    }

    async function image(c) {
      if (images.has(c.media)) return images.get(c.media);
      const bmp = await createImageBitmap(media[c.media].blob, { imageOrientation: 'from-image' });
      images.set(c.media, bmp);
      return bmp;
    }

    // ── Audio ──
    const layers = p.tracks.filter(t => t.kind === 'video' && !t.hidden).reverse();
    const audioInputs = new Map();
    async function audioTrackFor(mediaId) {
      if (audioInputs.has(mediaId)) return audioInputs.get(mediaId);
      const input = new MB.Input({ source: new MB.BlobSource(media[mediaId].blob), formats: MB.ALL_FORMATS });
      inputs.push(input);
      const at = await input.getPrimaryAudioTrack();
      const entry = at ? { sink: new MB.AudioBufferSink(at), channels: at.numberOfChannels, rate: at.sampleRate } : null;
      audioInputs.set(mediaId, entry);
      return entry;
    }

    // Decodes [from, to) of a source (media-relative seconds) into one
    // AudioBuffer at the source's own rate.
    async function decodeRange(mediaId, from, to) {
      const a = await audioTrackFor(mediaId);
      if (!a) return null;
      const t0 = media[mediaId].info.t0 || 0;
      const len = Math.max(1, Math.round((to - from) * a.rate));
      const out = new AudioBuffer({ length: len, numberOfChannels: Math.min(2, a.channels) || 1, sampleRate: a.rate });
      for await (const { buffer, timestamp } of a.sink.buffers(t0 + from, t0 + to)) {
        const offset = Math.round((timestamp - t0 - from) * a.rate);
        for (let ch = 0; ch < out.numberOfChannels; ch++) {
          const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
          const dst = out.getChannelData(ch);
          const s0 = Math.max(0, -offset);
          const s1 = Math.min(src.length, len - offset);
          if (s1 > s0) dst.set(src.subarray(s0, s1), offset + s0);
        }
      }
      return out;
    }

    let audioDone = 0;
    async function mixSegment(from, to) {
      const frames = Math.round((to - from) * AUDIO_RATE);
      const octx = new OfflineAudioContext(2, frames, AUDIO_RATE);
      for (const c of audioClips) {
        const a = Math.max(from, c.start), b = Math.min(to, clipEnd(c));
        if (b <= a) continue;
        const srcFrom = c.in + (a - c.start);
        const padBefore = Math.min(PAD, srcFrom);
        const srcTo = Math.min(c.out, c.in + (b - c.start));
        const padAfter = Math.min(PAD, Math.max(0, media[c.media].info.duration - srcTo));
        const buf = await decodeRange(c.media, srcFrom - padBefore, srcTo + padAfter);
        if (!buf) continue;
        const node = octx.createBufferSource();
        node.buffer = buf;
        const gain = octx.createGain();
        gain.gain.value = c.volume;
        node.connect(gain).connect(octx.destination);
        node.start(a - from, padBefore, b - a);
      }
      return octx.startRendering();
    }
    async function feedAudioUntil(t) {
      while (audioSource && audioDone < t && audioDone < duration) {
        checkAbort();
        const to = Math.min(duration, audioDone + SEGMENT);
        await audioSource.add(await mixSegment(audioDone, to));
        audioDone = to;
      }
    }

    try {
      await output.start();
      const started = performance.now();
      for (let k = 0; k < totalFrames; k++) {
        checkAbort();
        const T = frameTime(k);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        for (const tr of layers) {
          const c = p.clips.find(x => x.track === tr.id && activeAt(x, k));
          if (!c) continue;
          const m = media[c.media];
          if (m.info.kind === 'image') {
            const bmp = await image(c);
            drawContain(ctx, bmp, bmp.width, bmp.height, W, H);
          } else if (m.info.kind === 'video') {
            const st = open.get(c.id) || await openClip(c, k);
            const { value: sample } = await st.iter.next();
            if (sample) {
              sample.drawWithFit(ctx, { fit: 'contain' });
              sample.close();
            }
          }
        }
        // Clips that just ended release their decoder.
        for (const [id, st] of open) {
          const c = p.clips.find(x => x.id === id);
          if (!c || !activeAt(c, k + 1)) { try { await st.iter.return(); } catch (e) { /* closing */ } open.delete(id); }
        }
        await feedAudioUntil(T + 1);
        await videoSource.add(T, 1 / fps);
        if (onProgress && (k % 5 === 0 || k === totalFrames - 1)) {
          const elapsed = (performance.now() - started) / 1000;
          onProgress({ frame: k + 1, total: totalFrames, elapsed, eta: elapsed / (k + 1) * (totalFrames - k - 1) });
        }
      }
      await feedAudioUntil(duration);
      checkAbort();
      if (onProgress) onProgress({ finalizing: true });
      await output.finalize();
      return { blob: collector.finish(), ext: format.fileExtension, format: fmt };
    } catch (e) {
      try { await output.cancel(); } catch (x) { /* already failed */ }
      throw e;
    } finally {
      await cleanup();
    }
  }

  window.MvmVideoExport = { run, pickFormat, describeFormat, videoBitrate, estimateBytes, projectDuration, clipEnd, clipLen, audible };
})();
