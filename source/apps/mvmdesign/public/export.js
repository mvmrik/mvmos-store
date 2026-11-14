(function () {
  'use strict';
  const R = window.MvmDesignRender,
    M = window.MvmDesignModel;
  let library;
  const load = () =>
    library ||
    (library = import(
      window.asset('/apps/mvmdesign/lib/mediabunny.min.mjs')
    ).catch((e) => {
      library = null;
      throw e;
    }));
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const blob = (canvas, type = 'image/png', quality = 0.95) =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(Error('exportFailed'))),
        type,
        quality,
      ),
    );
  function canvas(w, h) {
    return Object.assign(document.createElement('canvas'), {
      width: w,
      height: h,
    });
  }
  // ZIP STORE keeps PNG/JPEG bytes unchanged. UTF-8 names, CRC32, no server or compression dependency.
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc32 = (data) => {
    let c = 0xffffffff;
    for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  async function zip(files) {
    let offset = 0;
    const parts = [],
      central = [];
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer()),
        name = new TextEncoder().encode(f.name),
        crc = crc32(data);
      if (offset + data.length > 0xffffffff) throw Error('tooLarge');
      const head = new Uint8Array(30 + name.length),
        v = new DataView(head.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x800, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
      head.set(name, 30);
      const ch = new Uint8Array(46 + name.length),
        c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x800, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      parts.push(head, data);
      offset += head.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  async function images(
    p,
    pages,
    type = 'png',
    scale = 1,
    progress = () => {},
  ) {
    await R.prepare(p);
    const c = canvas(Math.round(p.width * scale), Math.round(p.height * scale)),
      ctx = c.getContext('2d'),
      files = [];
    for (const [index, pg] of pages.entries()) {
      R.page(ctx, p, pg, c.width, c.height);
      files.push({
        name: `${String(index + 1).padStart(3, '0')}.${type}`,
        blob: await blob(c, 'image/' + (type === 'jpg' ? 'jpeg' : type)),
      });
      progress((index + 1) / pages.length);
    }
    return pages.length === 1 ? files[0].blob : zip(files);
  }
  function collector(mime) {
    const parts = [],
      patches = [];
    let size = 0;
    return {
      target: new WritableStream({
        write({ data, position }) {
          if (position >= size) {
            if (position > size)
              parts.push(new Blob([new Uint8Array(position - size)]));
            parts.push(new Blob([data]));
            size = position + data.length;
          } else patches.push({ position, data: new Blob([data]) });
        },
      }),
      finish() {
        let b = new Blob(parts);
        for (const p of patches)
          b = new Blob([
            b.slice(0, p.position),
            p.data,
            b.slice(p.position + p.data.size),
          ]);
        return new Blob([b], { type: mime });
      },
    };
  }
  async function formats(w, h, fps, quality, hasAudio, container = 'auto') {
    if (typeof VideoEncoder === 'undefined') throw Error('noEncoder');
    const B = await load(),
      bps = Math.round(
        Math.max(
          2000000,
          Math.min(
            160000000,
            w *
              h *
              fps *
              ({ standard: 0.07, high: 0.12, max: 0.22 }[quality] || 0.12),
          ),
        ),
      );
    for (const [ext, codecs, acodecs] of [
      ['mp4', ['avc'], ['aac']],
      ['webm', ['vp9', 'vp8'], ['opus']],
    ]) {
      if (container !== 'auto' && container !== ext) continue;
      const video = await B.getFirstEncodableVideoCodec(codecs, {
        width: w,
        height: h,
        quality: new B.Quality({ bitrate: bps }),
      });
      const audio = hasAudio
        ? await B.getFirstEncodableAudioCodec(acodecs, {
            numberOfChannels: 2,
            sampleRate: 48000,
            quality: new B.Quality({ bitrate: 320000 }),
          })
        : null;
      if (video && (!hasAudio || audio)) return { ext, video, audio, bps };
    }
    throw Error('noEncoder');
  }
  async function video(
    p,
    {
      scale = 1,
      fps = 30,
      quality = 'high',
      container = 'auto',
      signal,
      onProgress = () => {},
    } = {},
  ) {
    const W = Math.round((p.width * scale) / 2) * 2,
      H = Math.round((p.height * scale) / 2) * 2,
      duration = M.duration(p);
    if (!(duration > 0)) throw Error('emptySequence');
    await R.prepare(p);
    const B = await load(),
      fmt = await formats(W, H, fps, quality, !!p.audio, container),
      outFormat =
        fmt.ext === 'mp4'
          ? new B.Mp4OutputFormat({ fastStart: false })
          : new B.WebMOutputFormat(),
      col = collector(outFormat.mimeType);
    const output = new B.Output({
        format: outFormat,
        target: new B.StreamTarget(col.target, { chunked: true }),
      }),
      c = canvas(W, H),
      ctx = c.getContext('2d', { alpha: false });
    const vs = new B.CanvasSource(c, {
      codec: fmt.video,
      quality: new B.Quality({ bitrate: fmt.bps, bitrateMode: 'variable' }),
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
    output.addVideoTrack(vs, { frameRate: fps });
    let input, as, sink;
    let audioOrigin = 0;
    const check = () => {
      if (signal?.aborted) throw Error('canceled');
    };
    try {
      if (p.audio) {
        const source = await (await fetch(p.audio.data)).blob();
        input = new B.Input({
          source: new B.BlobSource(source),
          formats: B.ALL_FORMATS,
        });
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw Error('audioFailed');
        if (!(await track.canDecode())) throw Error('audioFailed');
        audioOrigin = Math.max(0, await input.getFirstTimestamp([track]));
        sink = new B.AudioBufferSink(track);
        as = new B.AudioBufferSource({
          codec: fmt.audio,
          quality: new B.Quality({
            bitrate: quality === 'standard' ? 192000 : 320000,
          }),
        });
        output.addAudioTrack(as);
      }
      await output.start();
      let audioDone = 0;
      const total = Math.ceil(duration * fps);
      for (let k = 0; k < total; k++) {
        check();
        const time = k / fps;
        if (as && audioDone <= time + 1 && audioDone < duration) {
          const end = Math.min(duration, audioDone + 10),
            offline = new OfflineAudioContext(
              2,
              Math.round((end - audioDone) * 48000),
              48000,
            );
          for await (const { buffer, timestamp } of audioDone < p.audio.duration
            ? sink.buffers(
                audioOrigin + audioDone,
                audioOrigin + Math.min(end, p.audio.duration),
              )
            : []) {
            check();
            const relative = timestamp - audioOrigin;
            const start = Math.max(audioDone, relative),
              stop = Math.min(
                end,
                relative + buffer.duration,
                p.audio.duration,
              );
            if (stop <= start) continue;
            const node = offline.createBufferSource();
            node.buffer = buffer;
            node.connect(offline.destination);
            node.start(start - audioDone, start - relative, stop - start);
          }
          await as.add(await offline.startRendering());
          audioDone = end;
        }
        R.video(ctx, p, time, W, H);
        await vs.add(time, Math.min(1 / fps, duration - time));
        if (k % 5 === 0) {
          onProgress((k + 1) / total);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      check();
      await output.finalize();
      onProgress(1);
      return { blob: col.finish(), ext: fmt.ext };
    } catch (e) {
      try {
        await output.cancel();
      } catch (_) {}
      throw e;
    } finally {
      input?.dispose();
      c.width = 1;
      c.height = 1;
    }
  }
  window.MvmDesignExport = {
    download,
    images,
    video,
    formats,
    zip,
    crc32,
    load,
  };
})();
