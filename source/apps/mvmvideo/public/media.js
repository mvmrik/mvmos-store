// mvmVideo — media sources: reading files, probing them, thumbnails and
// waveforms.
//
// Every source is read into a Blob once. The server's /api/files/raw answers
// without byte ranges, so a <video> pointed at it could not seek; a Blob URL
// can, instantly, and the export reads the very same Blob frame by frame.
//
// Times inside a media item are relative to its first frame (t0), because
// that is what <video>.currentTime counts from; the export adds t0 back when
// it asks the decoder for a timestamp.
(function () {
  const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'];
  const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'];
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];

  let mbPromise = null;
  function loadMB() {
    if (!mbPromise) {
      mbPromise = import('/apps/mvmvideo/lib/mediabunny.min.mjs').catch(e => { mbPromise = null; throw e; });
    }
    return mbPromise;
  }

  function ext(name) {
    const m = /\.([^.\/]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function kindOf(name, mime) {
    const e = ext(name);
    if (VIDEO_EXT.includes(e)) return 'video';
    if (AUDIO_EXT.includes(e)) return 'audio';
    if (IMAGE_EXT.includes(e)) return 'image';
    if (mime) {
      if (mime.startsWith('video/')) return 'video';
      if (mime.startsWith('audio/')) return 'audio';
      if (mime.startsWith('image/')) return 'image';
    }
    return null;
  }

  // Reads a file from the user's folders on the server, reporting progress
  // against the size the file listing gave us.
  async function fetchServerFile(path, size, onProgress) {
    const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
    if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : 'read_failed');
    if (!r.body || !onProgress) return r.blob();
    const reader = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      if (size) onProgress(Math.min(1, got / size));
    }
    return new Blob(parts, { type: r.headers.get('content-type') || '' });
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported')); };
      img.src = url;
    });
  }

  // Common frame rates the measured average is rounded to, so a phone video
  // measured at 29.968 fps becomes the 29.97 it really is.
  const FPS_STEPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120];
  function roundFps(f) {
    if (!f || !isFinite(f)) return 30;
    let best = FPS_STEPS[0];
    for (const s of FPS_STEPS) if (Math.abs(s - f) < Math.abs(best - f)) best = s;
    return Math.abs(best - f) / f < 0.03 ? best : Math.round(f * 100) / 100;
  }

  // What the editor needs to know about a source. Throws 'unsupported' when
  // this browser can neither read the container nor decode what is inside.
  async function probe(blob, name) {
    const kind = kindOf(name, blob.type);
    if (!kind) throw new Error('unsupported');
    if (kind === 'image') {
      const { img, url } = await loadImage(blob);
      return { kind, width: img.naturalWidth, height: img.naturalHeight, duration: 0, hasAudio: false, url, img };
    }
    const MB = await loadMB();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      if (!(await input.canRead())) throw new Error('unsupported');
      const vt = kind === 'video' ? await input.getPrimaryVideoTrack() : null;
      const at = await input.getPrimaryAudioTrack();
      const vOk = vt ? await vt.canDecode() : false;
      const aOk = at ? await at.canDecode() : false;
      if (kind === 'video' && !vOk) throw new Error(vt ? 'codec' : 'unsupported');
      if (kind === 'audio' && !aOk) throw new Error(at ? 'codec' : 'unsupported');
      const tracks = [vOk && vt, aOk && at].filter(Boolean);
      const t0 = Math.max(0, await input.getFirstTimestamp(tracks));
      const end = await input.computeDuration(tracks);
      const info = {
        kind, duration: Math.max(0, end - t0), t0,
        hasAudio: aOk, width: 0, height: 0, fps: 0, bitrate: 0,
        url: URL.createObjectURL(blob),
      };
      if (vOk) {
        info.width = await vt.getDisplayWidth();
        info.height = await vt.getDisplayHeight();
        const stats = await vt.computePacketStats(120);
        info.fps = roundFps(stats.averagePacketRate);
        info.bitrate = stats.averageBitrate || 0;
      }
      if (!(info.duration > 0)) throw new Error('unsupported');
      return info;
    } finally {
      input.dispose();
    }
  }

  // A small still for the media list and the clips on the timeline.
  function videoThumb(url, duration) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      let settled = false;
      const finish = res => { if (settled) return; settled = true; v.removeAttribute('src'); v.load(); resolve(res); };
      v.onloadeddata = () => { v.currentTime = Math.min(1, duration / 3); };
      v.onseeked = () => finish(drawThumb(v, v.videoWidth, v.videoHeight));
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 15000);
      v.src = url;
    });
  }
  function drawThumb(src, w, h) {
    if (!w || !h) return null;
    const H = 90, W = Math.max(1, Math.round(H * w / h));
    const c = document.createElement('canvas');
    c.width = Math.min(W, 240); c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / w, H / h);
    ctx.drawImage(src, (c.width - w * s) / 2, (H - h * s) / 2, w * s, h * s);
    try { return c.toDataURL('image/jpeg', 0.75); } catch (e) { return null; }
  }

  // Loudness peaks, PEAKS_PER_SEC per second of media, for waveforms.
  const PEAKS_PER_SEC = 50;
  async function computePeaks(blob, info) {
    const MB = await loadMB();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const at = await input.getPrimaryAudioTrack();
      if (!at) return null;
      const n = Math.max(1, Math.ceil(info.duration * PEAKS_PER_SEC));
      const peaks = new Float32Array(n);
      const sink = new MB.AudioBufferSink(at);
      for await (const { buffer, timestamp } of sink.buffers()) {
        const ch = buffer.getChannelData(0);
        const rate = buffer.sampleRate;
        const base = (timestamp - info.t0) * PEAKS_PER_SEC;
        const step = Math.max(1, Math.floor(rate / PEAKS_PER_SEC / 4));
        for (let i = 0; i < ch.length; i += step) {
          const k = Math.floor(base + i / rate * PEAKS_PER_SEC);
          if (k < 0 || k >= n) continue;
          const a = Math.abs(ch[i]);
          if (a > peaks[k]) peaks[k] = a;
        }
      }
      return peaks;
    } catch (e) {
      return null;
    } finally {
      input.dispose();
    }
  }

  window.MvmVideoMedia = {
    VIDEO_EXT, AUDIO_EXT, IMAGE_EXT, PEAKS_PER_SEC,
    loadMB, ext, kindOf, fetchServerFile, probe, videoThumb, drawThumb, computePeaks, roundFps,
  };
})();
