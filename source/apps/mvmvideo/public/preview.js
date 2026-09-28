// mvmVideo — live preview of the timeline.
//
// Playback uses the browser's own <video>/<audio> elements, one per clip,
// kept in step with a single clock and drawn into the preview canvas layer by
// layer, bottom track first. This is only for looking; the exported file is
// rendered separately, frame by frame (export.js).
(function () {
  const X = () => window.MvmVideoExport;
  const DRIFT = 0.25;      // seconds a playing element may wander before it is re-seeked
  const PRELOAD = 1.5;     // seconds ahead a clip's element is parked on its first frame

  class Preview {
    constructor(canvas, host) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.host = host;          // { project(), media(id), onTime(t), onState(playing) }
      this.els = new Map();      // clip id -> { el, gain, mediaId }
      this.time = 0;
      this.playing = false;
      this.actx = null;
      this.raf = 0;
      this.pendingDraw = false;
    }

    get project() { return this.host.project(); }

    resize(maxW, maxH) {
      const p = this.project;
      const dpr = window.devicePixelRatio || 1;
      const s = Math.min(maxW / p.width, maxH / p.height);
      const cssW = Math.max(1, Math.floor(p.width * s)), cssH = Math.max(1, Math.floor(p.height * s));
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      const w = Math.min(p.width, Math.round(cssW * dpr)), h = Math.min(p.height, Math.round(cssH * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.draw();
    }

    audioCtx() {
      if (!this.actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.actx = new AC();
      }
      if (this.actx && this.actx.state === 'suspended') this.actx.resume().catch(() => {});
      return this.actx;
    }

    element(c) {
      let e = this.els.get(c.id);
      const m = this.host.media(c.media);
      if (e && e.mediaId === c.media) return e;
      if (e) this.drop(c.id);
      if (!m || !m.info || m.info.kind === 'image') return null;
      const el = document.createElement(m.info.kind === 'video' ? 'video' : 'audio');
      el.preload = 'auto';
      el.playsInline = true;
      el.src = m.info.url;
      el.addEventListener('seeked', () => this.requestDraw());
      el.addEventListener('loadeddata', () => this.requestDraw());
      e = { el, gain: null, mediaId: c.media };
      const ac = this.audioCtx();
      if (ac && (m.info.kind === 'audio' || m.info.hasAudio)) {
        try {
          const src = ac.createMediaElementSource(el);
          e.gain = ac.createGain();
          src.connect(e.gain).connect(ac.destination);
        } catch (err) { e.gain = null; }
      }
      this.els.set(c.id, e);
      return e;
    }

    drop(id) {
      const e = this.els.get(id);
      if (!e) return;
      try { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); } catch (err) { /* gone */ }
      if (e.gain) try { e.gain.disconnect(); } catch (err) { /* gone */ }
      this.els.delete(id);
    }

    // Elements of clips that no longer exist.
    prune() {
      const ids = new Set(this.project.clips.map(c => c.id));
      for (const id of [...this.els.keys()]) if (!ids.has(id)) this.drop(id);
    }

    play() {
      const dur = X().projectDuration(this.project);
      if (!(dur > 0)) return;
      if (this.time >= dur - 0.01) this.time = 0;
      this.audioCtx();
      this.playing = true;
      this.clock = { wall: performance.now(), t: this.time };
      this.host.onState(true);
      this.sync();
      this.loop();
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      cancelAnimationFrame(this.raf);
      for (const e of this.els.values()) e.el.pause();
      this.host.onState(false);
      this.sync();
    }

    toggle() { if (this.playing) this.pause(); else this.play(); }

    seek(t) {
      this.time = Math.max(0, t);
      if (this.playing) this.clock = { wall: performance.now(), t: this.time };
      this.sync();
      this.host.onTime(this.time);
    }

    loop() {
      if (!this.playing) return;
      const dur = X().projectDuration(this.project);
      this.time = this.clock.t + (performance.now() - this.clock.wall) / 1000;
      if (this.time >= dur) {
        this.time = dur;
        this.pause();
        this.host.onTime(this.time);
        return;
      }
      this.sync();
      this.host.onTime(this.time);
      this.raf = requestAnimationFrame(() => this.loop());
    }

    // Puts every element where the clock says it should be, then draws.
    sync() {
      const p = this.project;
      const T = this.time;
      const active = new Set();
      for (const c of p.clips) {
        const m = this.host.media(c.media);
        if (!m || !m.info || m.info.kind === 'image') continue;
        const tr = p.tracks.find(x => x.id === c.track);
        if (!tr) continue;
        const end = X().clipEnd(c);
        const inside = T >= c.start && T < end;
        const soon = !inside && c.start > T && c.start - T < PRELOAD;
        const shown = tr.kind === 'video' && !tr.hidden;
        const heard = !tr.muted && c.volume > 0;
        if (!inside && !soon) continue;
        if (!inside && !this.els.has(c.id)) { if (!this.playing) continue; }
        const e = this.element(c);
        if (!e) continue;
        active.add(c.id);
        const el = e.el;
        if (e.gain) e.gain.gain.value = heard ? c.volume : 0;
        else el.muted = !heard;
        if (!inside) {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in;
          continue;
        }
        const rel = c.in + (T - c.start);
        if (this.playing && (shown || heard)) {
          if (el.paused) {
            el.currentTime = rel;
            el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - rel) > DRIFT) {
            el.currentTime = rel;
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - rel) > 0.02) el.currentTime = rel;
        }
      }
      for (const [id, e] of this.els) if (!active.has(id) && !e.el.paused) e.el.pause();
      this.draw();
    }

    requestDraw() {
      if (this.pendingDraw || this.playing) return;
      this.pendingDraw = true;
      requestAnimationFrame(() => { this.pendingDraw = false; this.draw(); });
    }

    draw() {
      const p = this.project;
      const ctx = this.ctx;
      const W = this.canvas.width, H = this.canvas.height;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const T = this.time;
      const layers = p.tracks.filter(t => t.kind === 'video' && !t.hidden).reverse();
      for (const tr of layers) {
        const c = p.clips.find(x => x.track === tr.id && T >= x.start && T < X().clipEnd(x));
        if (!c) continue;
        const m = this.host.media(c.media);
        if (!m || !m.info) continue;
        let src = null, sw = 0, sh = 0;
        if (m.info.kind === 'image') {
          src = m.info.img; sw = src.naturalWidth; sh = src.naturalHeight;
        } else {
          const e = this.els.get(c.id);
          if (!e || e.el.readyState < 2) continue;
          src = e.el; sw = src.videoWidth; sh = src.videoHeight;
        }
        if (!sw || !sh) continue;
        const s = Math.min(W / sw, H / sh);
        ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
      }
    }

    destroy() {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      for (const id of [...this.els.keys()]) this.drop(id);
      if (this.actx) this.actx.close().catch(() => {});
    }
  }

  window.MvmVideoPreview = Preview;
})();
