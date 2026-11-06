// mvmOffice — the covers of a book: a free layout of texts, pictures and
// shapes on a page of the book's size, drawn on a canvas.
//
// One drawing routine serves the editor, the print preview, the book view and
// every export, so what is laid out here is exactly what is printed: the
// covers go to paper, to Word and to the e-book as a picture of the finished
// page, made from the same layout whenever it is needed.
(function () {
  'use strict';
  if (window.MvmOfficeCover) return;
  const M = window.MvmOfficeModel;
  const FONTS = M.COVER_FONTS;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // ── Drawing ──────────────────────────────────────────────────────────────
  const imgCache = new Map();
  function loadImg(src) {
    if (!imgCache.has(src)) {
      imgCache.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
    }
    return imgCache.get(src);
  }
  async function loadImages(doc, cover) {
    const m = new Map();
    for (const it of cover.items) {
      if (it.type !== 'image') continue;
      const im = doc.images[it.imageId];
      const img = im && await loadImg(im.src);
      if (img) m.set(it.imageId, img);
    }
    return m;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // The font of a text: one of mvmFonts when the cover names it, always followed by the usual stack.
  const fam = it => (it.ff ? `"${it.ff}", ${FONTS[it.font]}` : FONTS[it.font]);
  const usedFamilies = cover => [...new Set((cover.items || []).filter(i => i.type === 'text' && i.ff).map(i => i.ff))];

  // The lines a text breaks into at its width, and the box they fill.
  function layoutText(ctx, it, W) {
    const px = it.size * W;
    ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700' : '400'} ${px}px ${fam(it)}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (it.ls * px) + 'px';
    const maxW = it.w * W;
    const lines = [];
    for (const para of (it.caps ? it.text.toUpperCase() : it.text).split('\n')) {
      let cur = '';
      for (const word of para.split(' ')) {
        const tryLine = cur ? cur + ' ' + word : word;
        if (cur && ctx.measureText(tryLine).width > maxW) { lines.push(cur); cur = word; } else cur = tryLine;
      }
      lines.push(cur);
    }
    const lh = px * it.lh;
    return { lines, lh, px, w: maxW, h: Math.max(1, lines.length) * lh };
  }

  function itemBox(ctx, it, W, H, doc) {
    if (it.type === 'text') { const l = layoutText(ctx, it, W); return { w: l.w, h: l.h, lay: l }; }
    if (it.type === 'image') {
      const im = doc.images[it.imageId];
      const asp = im && im.w && im.h ? im.h / im.w : 1;
      return { w: it.w * W, h: it.w * W * asp };
    }
    if (it.shape === 'line') return { w: it.w * W, h: Math.max(2, (it.sw || 0.004) * W) };
    return { w: it.w * W, h: it.h * H };
  }

  function drawText(ctx, it, box) {
    const l = box.lay, w = box.w, h = box.h;
    const ax = it.align === 'left' ? 0 : it.align === 'right' ? w : w / 2;
    ctx.textAlign = it.align;
    ctx.textBaseline = 'middle';
    ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700' : '400'} ${l.px}px ${fam(it)}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (it.ls * l.px) + 'px';
    const each = fn => l.lines.forEach((ln, i) => fn(ln, (i + 0.5) * l.lh));
    ctx.fillStyle = it.color;
    if (it.fx === 'band') {
      const pad = l.px * 0.3;
      ctx.fillStyle = it.fx2;
      each((ln, y) => {
        const tw = ctx.measureText(ln).width;
        const x0 = it.align === 'left' ? 0 : it.align === 'right' ? w - tw : (w - tw) / 2;
        roundRect(ctx, x0 - pad, y - l.lh / 2 + l.lh * 0.04, tw + pad * 2, l.lh * 0.92, l.px * 0.2);
        ctx.fill();
      });
      ctx.fillStyle = it.color;
    }
    if (it.fx === 'long') {
      const n = Math.ceil(l.px * 0.4);
      ctx.fillStyle = it.fx1;
      for (let k = n; k >= 1; k--) each((ln, y) => ctx.fillText(ln, ax + k * 0.7, y + k * 0.7));
      ctx.fillStyle = it.color;
    }
    if (it.fx === 'outline') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = l.px * 0.12;
      ctx.strokeStyle = it.fx1;
      each((ln, y) => ctx.strokeText(ln, ax, y));
    }
    if (it.fx === 'shadow') {
      ctx.shadowColor = rgba(it.fx1, 0.6);
      ctx.shadowBlur = l.px * 0.14;
      ctx.shadowOffsetX = l.px * 0.04;
      ctx.shadowOffsetY = l.px * 0.06;
    }
    if (it.fx === 'glow') { ctx.shadowColor = it.fx1; ctx.shadowBlur = l.px * 0.5; }
    if (it.fx === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, it.color); g.addColorStop(1, it.fx2);
      ctx.fillStyle = g;
    }
    each((ln, y) => ctx.fillText(ln, ax, y));
    if (it.fx === 'glow') each((ln, y) => ctx.fillText(ln, ax, y));
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }

  // Draws the page into ctx (W × H pixels). Returns where every item landed,
  // in pixels: the editor uses it to place the handles.
  function render(ctx, W, H, cover, imgs, doc) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cover.bg;
    ctx.fillRect(0, 0, W, H);
    const bounds = [];
    for (const it of cover.items) {
      const box = itemBox(ctx, it, W, H, doc);
      const x = it.x * W, y = it.y * H;
      const b = { id: it.id, cx: x + box.w / 2, cy: y + box.h / 2, w: box.w, h: box.h, rot: it.rot };
      bounds.push(b);
      ctx.save();
      ctx.globalAlpha = it.opacity;
      ctx.translate(b.cx, b.cy);
      ctx.rotate(it.rot * Math.PI / 180);
      ctx.translate(-box.w / 2, -box.h / 2);
      if (it.type === 'text') {
        if (it.text) drawText(ctx, it, box);
      } else if (it.type === 'image') {
        const img = imgs.get(it.imageId);
        if (img) {
          if (it.flip) { ctx.translate(box.w, 0); ctx.scale(-1, 1); }
          ctx.drawImage(img, 0, 0, box.w, box.h);
        }
      } else {
        const sw = it.sw * W;
        if (it.shape === 'line') {
          ctx.fillStyle = it.stroke || it.fill || '#000000';
          ctx.fillRect(0, 0, box.w, box.h);
        } else {
          if (it.shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(box.w / 2, box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2); }
          else roundRect(ctx, 0, 0, box.w, box.h, it.radius * Math.min(box.w, box.h));
          if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(); }
          if (it.stroke && sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = it.stroke; ctx.stroke(); }
        }
      }
      ctx.restore();
    }
    ctx.restore();
    return bounds;
  }

  // The finished cover as a picture, the long side at most `max` pixels.
  async function toImage(doc, cover, box, max) {
    const imgs = await loadImages(doc, cover);
    if (window.MvmOfficeFonts) await window.MvmOfficeFonts.ready(document, usedFamilies(cover));
    const k = (max || 2000) / Math.max(box.w, box.h);
    const W = Math.round(box.w * k), H = Math.round(box.h * k);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    render(cv.getContext('2d'), W, H, cover, imgs, doc);
    return { src: cv.toDataURL('image/jpeg', 0.92), w: W, h: H };
  }

  // ── The editor ───────────────────────────────────────────────────────────
  const SWATCHES = ['#ffffff', '#f5efe0', '#e8d9b5', '#f4c95d', '#e07a5f', '#81b29a', '#3d5a80', '#1d2d44', '#111111'];
  const HANDLES = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  const rot = (x, y, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

  class CoverEditor {
    constructor(office, side, done) {
      this.office = office;
      this.t = office.t;
      this.doc = office.doc;
      this.done = done;
      this.side = side;
      this.cov = { front: M.clone(this.doc.cover), back: M.clone(this.doc.back) };
      this.box = M.pageBox(this.doc);
      this.sel = null;
      this.undo = []; this.redo = [];
      this.guides = true;
      this.drag = null;
      this.imgs = new Map();
      this.build();
      this.start();
    }
    get cover() { return this.cov[this.side]; }
    item(id) { return this.cover.items.find(i => i.id === id); }
    get cur() { return this.sel ? this.item(this.sel) : null; }

    build() {
      const t = this.t;
      const ov = document.createElement('div');
      ov.className = 'mo-cv';
      ov.innerHTML = `
        <div class="mo-cv-bar">
          <div class="mo-cv-tabs">
            <button class="mo-btn" data-side="front">${esc(t('mo_front_cover'))}</button>
            <button class="mo-btn" data-side="back">${esc(t('mo_back_cover'))}</button>
          </div>
          <button class="mo-ib" data-c="undo" title="${esc(t('mo_undo'))}">↶</button>
          <button class="mo-ib" data-c="redo" title="${esc(t('mo_redo'))}">↷</button>
          <button class="mo-ib" data-c="guides" title="${esc(t('mo_cv_guides'))}">⌗</button>
          <span class="mo-grow"></span>
          <button class="mo-btn" data-c="cancel">${esc(t('mo_cancel'))}</button>
          <button class="mo-btn mo-primary" data-c="ok">${esc(t('mo_cv_done'))}</button>
        </div>
        <div class="mo-cv-main">
          <div class="mo-cv-tools">
            <button class="mo-btn" data-add="text">T <span>${esc(t('mo_cv_text'))}</span></button>
            <button class="mo-btn" data-add="image">🖼 <span>${esc(t('mo_cv_image'))}</span></button>
            <button class="mo-btn" data-add="rect">▭ <span>${esc(t('mo_cv_rect'))}</span></button>
            <button class="mo-btn" data-add="ellipse">◯ <span>${esc(t('mo_cv_ellipse'))}</span></button>
            <button class="mo-btn" data-add="line">― <span>${esc(t('mo_cv_line'))}</span></button>
          </div>
          <div class="mo-cv-stage"><div class="mo-cv-page"><canvas></canvas><div class="mo-cv-ov"></div></div></div>
          <div class="mo-cv-panel"></div>
        </div>`;
      this.office.root.appendChild(ov);
      this.ov = ov;
      this.stage = ov.querySelector('.mo-cv-stage');
      this.pageEl = ov.querySelector('.mo-cv-page');
      this.canvas = ov.querySelector('canvas');
      this.layer = ov.querySelector('.mo-cv-ov');
      this.panel = ov.querySelector('.mo-cv-panel');
      this.ctx = this.canvas.getContext('2d');

      ov.addEventListener('click', e => this.onClick(e));
      this.layer.addEventListener('pointerdown', e => this.onDown(e));
      this.layer.addEventListener('dblclick', e => { const it = this.hit(e); if (it && it.type === 'text') { const ta = this.panel.querySelector('[data-p="text"]'); if (ta) { ta.focus(); ta.select(); } } });
      window.addEventListener('pointermove', this._mv = e => this.onMove(e));
      window.addEventListener('pointerup', this._up = e => this.onUp(e));
      window.addEventListener('pointercancel', this._up);
      document.addEventListener('keydown', this._key = e => this.onKey(e), true);
      this.panel.addEventListener('input', e => this.onPanel(e));
      this.panel.addEventListener('change', e => this.onPanel(e, true));
      this._ro = new ResizeObserver(() => this.fit());
      this._ro.observe(this.stage);
    }

    async start() {
      this.imgs = await this.load();
      this.fit();
      this.refreshTabs();
      this.showPanel();
    }
    async load() {
      const all = new Map();
      for (const c of [this.cov.front, this.cov.back]) (await loadImages(this.doc, c)).forEach((v, k) => all.set(k, v));
      return all;
    }

    // The page as large as the window allows, with room around it.
    fit() {
      const sw = this.stage.clientWidth - 24, sh = this.stage.clientHeight - 24;
      if (sw < 50 || sh < 50) return;
      const k = Math.min(sw / this.box.w, sh / this.box.h);
      this.Dw = Math.floor(this.box.w * k); this.Dh = Math.floor(this.box.h * k);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.pageEl.style.width = this.Dw + 'px'; this.pageEl.style.height = this.Dh + 'px';
      this.canvas.width = Math.round(this.Dw * this.dpr); this.canvas.height = Math.round(this.Dh * this.dpr);
      this.canvas.style.width = this.Dw + 'px'; this.canvas.style.height = this.Dh + 'px';
      this.paint();
    }
    paint() {
      if (!this.Dw) return;
      // A font of mvmFonts is drawn only once loaded; ask for it, and paint again when it is there.
      const FN = window.MvmOfficeFonts;
      const want = FN ? usedFamilies(this.cover).filter(n => !(this._fontsAsked || (this._fontsAsked = new Set())).has(n)) : [];
      want.forEach(n => this._fontsAsked.add(n));
      if (want.length) FN.ready(document, want).then(() => this.schedule());
      this.bounds = render(this.ctx, this.canvas.width, this.canvas.height, this.cover, this.imgs, this.doc)
        .map(b => ({ id: b.id, cx: b.cx / this.dpr, cy: b.cy / this.dpr, w: b.w / this.dpr, h: b.h / this.dpr, rot: b.rot }));
      this.drawOverlay();
    }
    // The fonts of mvmFonts, after the built-in ones; none when that app is not there.
    fontOptions(it) {
      const FN = window.MvmOfficeFonts;
      if (!FN || !FN.families.length) return '';
      const group = (label, list) => list.length ? `<optgroup label="${esc(label)}">` + list.map(f => `<option value="ff:${esc(f.family)}"${it.ff === f.family ? ' selected' : ''}>${esc(f.family)}</option>`).join('') + '</optgroup>' : '';
      return group(this.t('mo_fontcat_custom'), FN.families.filter(f => f.custom)) +
        ['sans', 'serif', 'mono', 'display'].map(c => group(this.t('mo_fontcat_' + c), FN.families.filter(f => !f.custom && f.category === c))).join('');
    }
    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
    }
    bound(id) { return this.bounds.find(b => b.id === id); }
    mmPerPx() { return this.box.w / this.Dw; }

    // ── Overlay: selection, handles, guides ───────────────────────────────
    drawOverlay() {
      const L = this.layer;
      L.textContent = '';
      if (this.guides) {
        const m = 5 / this.mmPerPx();
        L.insertAdjacentHTML('beforeend', `<div class="mo-cv-safe" style="left:${m}px;top:${m}px;right:${m}px;bottom:${m}px"></div>`);
      }
      const it = this.cur, b = it && this.bound(it.id);
      if (!it || !b) { this.drawGuides(); return; }
      const pad = it.type === 'shape' && it.shape === 'line' ? 6 : 0;
      const sel = document.createElement('div');
      sel.className = 'mo-cv-sel';
      Object.assign(sel.style, { left: b.cx - b.w / 2 - pad + 'px', top: b.cy - b.h / 2 - pad + 'px', width: b.w + pad * 2 + 'px', height: b.h + pad * 2 + 'px', transform: `rotate(${b.rot}deg)` });
      const hs = it.type === 'text' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : it.type === 'image' ? ['nw', 'ne', 'se', 'sw']
        : it.shape === 'line' ? ['e', 'w'] : Object.keys(HANDLES);
      sel.innerHTML = hs.map(h => `<i class="mo-cv-h mo-cv-h-${h}" data-h="${h}"></i>`).join('') + '<i class="mo-cv-h mo-cv-rot" data-h="rot"></i>';
      L.appendChild(sel);
      this.drawGuides();
    }
    drawGuides() {
      const g = this.guideData;
      if (!g) return;
      const L = this.layer;
      const line = (x1, y1, x2, y2, cls) => {
        const d = document.createElement('div');
        d.className = 'mo-cv-line ' + (cls || '');
        if (x1 === x2) Object.assign(d.style, { left: x1 + 'px', top: Math.min(y1, y2) + 'px', height: Math.abs(y2 - y1) + 'px', width: '0' });
        else Object.assign(d.style, { top: y1 + 'px', left: Math.min(x1, x2) + 'px', width: Math.abs(x2 - x1) + 'px', height: '0' });
        L.appendChild(d);
      };
      const lbl = (x, y, mm, cls) => {
        const d = document.createElement('div');
        d.className = 'mo-cv-lbl ' + (cls || '');
        d.textContent = (Math.round(mm * 10) / 10) + ' mm';
        Object.assign(d.style, { left: x + 'px', top: y + 'px' });
        L.appendChild(d);
      };
      (g.v || []).forEach(x => line(x, 0, x, this.Dh, 'mo-cv-snap'));
      (g.h || []).forEach(y => line(0, y, this.Dw, y, 'mo-cv-snap'));
      (g.gaps || []).forEach(s => {
        if (s.axis === 'y') { line(s.pos, s.a, s.pos, s.b, s.eq ? 'mo-cv-eq' : 'mo-cv-gap'); lbl(s.pos + 4, (s.a + s.b) / 2 - 8, s.mm, s.eq ? 'eq' : ''); }
        else { line(s.a, s.pos, s.b, s.pos, s.eq ? 'mo-cv-eq' : 'mo-cv-gap'); lbl((s.a + s.b) / 2 - 20, s.pos + 4, s.mm, s.eq ? 'eq' : ''); }
      });
    }

    // Axis-aligned box of an item, in page pixels (rotation taken into account).
    aabb(b) {
      const a = b.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      const w = b.w * c + b.h * s, h = b.w * s + b.h * c;
      return { l: b.cx - w / 2, r: b.cx + w / 2, t: b.cy - h / 2, b: b.cy + h / 2, w, h, cx: b.cx, cy: b.cy };
    }

    // Moving: stick to the page's middle and edges, to the other items'
    // edges and middles, and to equal gaps between neighbours. Alt turns it off.
    snapMove(id, dx, dy, free) {
      const b0 = this.drag.b0;
      const b = Object.assign({}, b0, { cx: b0.cx + dx, cy: b0.cy + dy });
      const others = this.bounds.filter(o => o.id !== id).map(o => this.aabb(o));
      const mine = () => this.aabb(b);
      const G = { v: [], h: [], gaps: [] };
      if (!free) {
        const thr = 6;
        const m = mine();
        const tx = [0, this.Dw / 2, this.Dw], ty = [0, this.Dh / 2, this.Dh];
        others.forEach(o => { tx.push(o.l, o.cx, o.r); ty.push(o.t, o.cy, o.b); });
        const best = (mv, targets) => { let bd = thr + 1, bt = null; for (const m1 of mv) for (const t1 of targets) { const d = t1 - m1; if (Math.abs(d) < Math.abs(bd)) { bd = d; bt = t1; } } return Math.abs(bd) <= thr ? { d: bd, at: bt } : null; };
        const sx = best([m.l, m.cx, m.r], tx), sy = best([m.t, m.cy, m.b], ty);
        if (sx) { b.cx += sx.d; G.v.push(sx.at); }
        if (sy) { b.cy += sy.d; G.h.push(sy.at); }
        // Equal gaps.
        const eq = axis => {
          const m2 = mine();
          const lo = axis === 'y' ? 't' : 'l', hi = axis === 'y' ? 'b' : 'r';
          const crossLo = axis === 'y' ? 'l' : 't', crossHi = axis === 'y' ? 'r' : 'b';
          const near = others.filter(o => Math.min(o[crossHi], m2[crossHi]) - Math.max(o[crossLo], m2[crossLo]) > 0);
          const before = near.filter(o => o[hi] <= m2[lo] + 0.5).sort((p, q) => q[hi] - p[hi])[0];
          const after = near.filter(o => o[lo] >= m2[hi] - 0.5).sort((p, q) => p[lo] - q[lo])[0];
          const size = axis === 'y' ? this.Dh : this.Dw;
          const a = before ? before[hi] : 0, z = after ? after[lo] : size;
          if (!before && !after) return null;
          const g1 = m2[lo] - a, g2 = z - m2[hi];
          return { g1, g2, a, z, m: m2, lo, hi, before: !!before, after: !!after };
        };
        ['x', 'y'].forEach(axis => {
          const ax = axis === 'x' ? 'x' : 'y';
          const r = eq(ax);
          if (!r || r.g1 < 0 || r.g2 < 0) return;
          if (Math.abs(r.g1 - r.g2) <= thr && (r.before && r.after || (r.before !== r.after))) {
            const adj = (r.g2 - r.g1) / 2;
            if (axis === 'x') b.cx += adj; else b.cy += adj;
          }
        });
      }
      // Show the gaps to the neighbours (equal ones highlighted).
      const m = mine(), mm = this.mmPerPx();
      const gaps = [];
      [['y', 't', 'b', 'l', 'r', this.Dh], ['x', 'l', 'r', 't', 'b', this.Dw]].forEach(([axis, lo, hi, cl, ch, size]) => {
        const near = others.filter(o => Math.min(o[ch], m[ch]) - Math.max(o[cl], m[cl]) > 0);
        const before = near.filter(o => o[hi] <= m[lo] + 0.5).sort((p, q) => q[hi] - p[hi])[0];
        const after = near.filter(o => o[lo] >= m[hi] - 0.5).sort((p, q) => p[lo] - q[lo])[0];
        const mid = axis === 'y' ? (Math.max(m.l, before ? before.l : m.l) + Math.min(m.r, before ? before.r : m.r)) / 2 : (Math.max(m.t, before ? before.t : m.t) + Math.min(m.b, before ? before.b : m.b)) / 2;
        const a = before ? before[hi] : 0, z = after ? after[lo] : size;
        const g1 = m[lo] - a, g2 = z - m[hi];
        const eqd = Math.abs(g1 - g2) < 0.75 && (before || after);
        const cross = axis === 'y' ? m.cx : m.cy;
        if (g1 > 1) gaps.push({ axis, pos: cross, a, b: m[lo], mm: g1 * mm, eq: eqd });
        if (g2 > 1) gaps.push({ axis, pos: cross, a: m[hi], b: z, mm: g2 * mm, eq: eqd });
      });
      G.gaps = gaps;
      this.guideData = G;
      return { dx: b.cx - b0.cx, dy: b.cy - b0.cy };
    }

    // ── Pointer ────────────────────────────────────────────────────────────
    pt(e) { const r = this.pageEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    hit(e) {
      const p = this.pt(e);
      const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches ? 8 : 3;
      for (let i = this.cover.items.length - 1; i >= 0; i--) {
        const it = this.cover.items[i], b = this.bound(it.id);
        if (!b) continue;
        const [lx, ly] = rot(p.x - b.cx, p.y - b.cy, -b.rot);
        const pad = (it.type === 'shape' && it.shape === 'line' ? 8 : 0) + coarse;
        if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) return it;
      }
      return null;
    }
    onDown(e) {
      if (e.button && e.button !== 0) return;
      const h = e.target.dataset && e.target.dataset.h;
      const p = this.pt(e);
      if (h && this.cur) {
        this.commit();
        this.layer.setPointerCapture && this.layer.setPointerCapture(e.pointerId);
        this.drag = { kind: h === 'rot' ? 'rot' : 'size', h, b0: Object.assign({}, this.bound(this.sel)), it0: M.clone(this.cur), p0: p };
        e.preventDefault();
        return;
      }
      const it = this.hit(e);
      this.sel = it ? it.id : null;
      this.showPanel();
      if (it) {
        this.commit();
        this.layer.setPointerCapture && this.layer.setPointerCapture(e.pointerId);
        this.drag = { kind: 'move', b0: Object.assign({}, this.bound(it.id)), it0: M.clone(it), p0: p, moved: false };
      }
      this.paint();
      e.preventDefault();
    }
    onMove(e) {
      const d = this.drag;
      if (!d) return;
      const p = this.pt(e);
      const it = this.cur;
      if (!it) return;
      if (d.kind === 'move') {
        let dx = p.x - d.p0.x, dy = p.y - d.p0.y;
        if (!d.moved && Math.hypot(dx, dy) < 2) return;
        d.moved = true;
        const s = this.snapMove(it.id, dx, dy, e.altKey);
        it.x = d.it0.x + s.dx / this.Dw; it.y = d.it0.y + s.dy / this.Dh;
      } else if (d.kind === 'rot') {
        let a = Math.atan2(p.y - d.b0.cy, p.x - d.b0.cx) * 180 / Math.PI + 90;
        a = ((a + 540) % 360) - 180;
        if (!e.altKey) { const r = Math.round(a / 15) * 15; if (Math.abs(a - r) < 3.5) a = r; }
        it.rot = Math.round(a * 10) / 10;
        this.guideData = null;
        this.angleBadge = it.rot;
      } else {
        this.resize(it, d, p, e.shiftKey);
        this.guideData = null;
      }
      this.schedule();
      this.syncPanelValues();
    }
    resize(it, d, p, shift) {
      const b = d.b0, [sx, sy] = d.h in HANDLES ? HANDLES[d.h] : [0, 0];
      const hw = b.w / 2, hh = b.h / 2;
      const aLocal = [-sx * hw, -sy * hh];
      const [ax, ay] = rot(aLocal[0], aLocal[1], b.rot);
      const A = { x: b.cx + ax, y: b.cy + ay };
      const [vx, vy] = rot(p.x - A.x, p.y - A.y, -b.rot);
      const corner = sx !== 0 && sy !== 0;
      const place = (w, h, ox, oy) => {
        const [rx, ry] = rot(ox, oy, b.rot);
        const cx = A.x + rx, cy = A.y + ry;
        return { x: (cx - w / 2) / this.Dw, y: (cy - h / 2) / this.Dh };
      };
      if (corner && (it.type !== 'shape' || shift)) {
        const dx = sx * 2 * hw, dy = sy * 2 * hh;
        const k = Math.max(0.05, (vx * dx + vy * dy) / (dx * dx + dy * dy));
        const nw = b.w * k, nh = b.h * k;
        const pos = place(nw, nh, sx * hw * k, sy * hh * k);
        it.x = pos.x; it.y = pos.y;
        if (it.type === 'text') { it.size = Math.max(0.005, d.it0.size * k); it.w = d.it0.w * k; } else it.w = d.it0.w * k;
        if (it.type === 'shape') it.h = d.it0.h * k;
      } else if (it.type === 'shape') {
        let nw = b.w, nh = b.h;
        if (sx !== 0) nw = Math.max(4, Math.abs(vx));
        if (sy !== 0) nh = Math.max(4, Math.abs(vy));
        const pos = place(nw, nh, sx * nw / 2, sy * nh / 2);
        it.x = pos.x; it.y = pos.y; it.w = nw / this.Dw;
        if (it.shape !== 'line') it.h = nh / this.Dh;
      } else if (it.type === 'text' && sx !== 0) {
        const nw = Math.max(this.Dw * 0.04, Math.abs(vx));
        const pos = place(nw, b.h, sx * nw / 2, 0);
        it.x = pos.x; it.y = pos.y; it.w = nw / this.Dw;
      }
    }
    onUp() {
      if (!this.drag) return;
      this.drag = null;
      this.guideData = null;
      this.angleBadge = null;
      this.paint();
    }
    onKey(e) {
      if (!this.ov.isConnected) return;
      const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.sel && !typing) { this.sel = null; this.showPanel(); this.paint(); } else if (typing) e.target.blur(); else this.finish(false); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? this.doRedo() : this.doUndo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); this.doRedo(); return; }
      const it = this.cur;
      if (!it) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(); return; }
      const step = (e.shiftKey ? 2 : 0.25) / this.mmPerPx();
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (mv) { e.preventDefault(); this.commit(true); it.x += mv[0] * step / this.Dw; it.y += mv[1] * step / this.Dh; this.paint(); }
    }

    // ── History ────────────────────────────────────────────────────────────
    snap() { return JSON.stringify({ f: this.cov.front, b: this.cov.back }); }
    // Called before a change: remembers how things were (changes that follow
    // each other quickly, like typing, are one step).
    commit(burst) {
      const now = Date.now();
      if (burst && this._lastCommit && now - this._lastCommit < 700) { this._lastCommit = now; return; }
      this._lastCommit = burst ? now : 0;
      const s = this.snap();
      if (this.undo[this.undo.length - 1] === s) return;
      this.undo.push(s);
      if (this.undo.length > 100) this.undo.shift();
      this.redo = [];
    }
    restore(s) {
      const o = JSON.parse(s);
      this.cov = { front: o.f, back: o.b };
      if (this.sel && !this.item(this.sel)) this.sel = null;
      this.showPanel();
      this.paint();
    }
    doUndo() { if (!this.undo.length) return; this.redo.push(this.snap()); this.restore(this.undo.pop()); this._lastCommit = 0; }
    doRedo() { if (!this.redo.length) return; this.undo.push(this.snap()); this.restore(this.redo.pop()); this._lastCommit = 0; }

    // ── Commands ───────────────────────────────────────────────────────────
    onClick(e) {
      const side = e.target.closest('[data-side]');
      if (side) { this.side = side.dataset.side; this.sel = null; this.refreshTabs(); this.showPanel(); this.paint(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { this.add(add.dataset.add); return; }
      const c = e.target.closest('[data-c]');
      if (c) {
        const a = c.dataset.c;
        if (a === 'undo') this.doUndo(); else if (a === 'redo') this.doRedo();
        else if (a === 'guides') { this.guides = !this.guides; c.classList.toggle('on', this.guides); this.paint(); }
        else if (a === 'ok') this.finish(true); else if (a === 'cancel') this.finish(false);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) this.act(act.dataset.act, act);
    }
    refreshTabs() {
      this.ov.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('mo-primary', b.dataset.side === this.side));
      this.ov.querySelector('[data-c="guides"]').classList.toggle('on', this.guides);
    }
    async add(kind) {
      this.commit();
      const id = M.uid();
      let it;
      if (kind === 'text') {
        it = M.normItem({ type: 'text', id, text: this.t('mo_cv_new_text'), x: 0.2, y: 0.4, w: 0.6, size: 0.07, bold: true });
      } else if (kind === 'image') {
        const r = await this.office.pickImage();
        if (!r) return;
        this.imgs.set(r.id, await loadImg(this.doc.images[r.id].src));
        const im = this.doc.images[r.id];
        const asp = im.h / im.w;
        // Fits inside the page, in the middle.
        const w = Math.min(0.8, 0.8 * (this.box.h / this.box.w) / asp * 0.8);
        it = M.normItem({ type: 'image', id, imageId: r.id, w, x: (1 - w) / 2, y: Math.max(0.02, (1 - w * asp * this.box.w / this.box.h) / 2) });
      } else {
        it = M.normItem({ type: 'shape', id, shape: kind, x: 0.2, y: 0.4, w: kind === 'line' ? 0.6 : 0.4, h: kind === 'ellipse' ? 0.2 : 0.12, fill: kind === 'line' ? '#111111' : '#e07a5f', sw: 0.005 });
      }
      this.cover.items.push(it);
      this.sel = id;
      this.showPanel();
      this.paint();
      if (kind === 'text') setTimeout(() => { const ta = this.panel.querySelector('[data-p="text"]'); if (ta && !matchMedia('(pointer:coarse)').matches) { ta.focus(); ta.select(); } }, 0);
    }
    remove() {
      if (!this.sel) return;
      this.commit();
      this.cover.items = this.cover.items.filter(i => i.id !== this.sel);
      this.sel = null;
      this.showPanel();
      this.paint();
    }
    duplicate() {
      const it = this.cur;
      if (!it) return;
      this.commit();
      const c = M.clone(it);
      c.id = M.uid(); c.x += 0.03; c.y += 0.03;
      this.cover.items.push(c);
      this.sel = c.id;
      this.showPanel();
      this.paint();
    }
    layerMove(how) {
      const a = this.cover.items, i = a.findIndex(x => x.id === this.sel);
      if (i < 0) return;
      this.commit();
      const [it] = a.splice(i, 1);
      const j = how === 'front' ? a.length : how === 'back' ? 0 : how === 'up' ? Math.min(a.length, i + 1) : Math.max(0, i - 1);
      a.splice(j, 0, it);
      this.paint();
    }
    alignTo(how) {
      const it = this.cur, b = it && this.bound(it.id);
      if (!b) return;
      this.commit();
      const m = this.aabb(b);
      let dx = 0, dy = 0;
      if (how === 'l') dx = -m.l; if (how === 'c') dx = this.Dw / 2 - m.cx; if (how === 'r') dx = this.Dw - m.r;
      if (how === 't') dy = -m.t; if (how === 'm') dy = this.Dh / 2 - m.cy; if (how === 'b') dy = this.Dh - m.b;
      it.x += dx / this.Dw; it.y += dy / this.Dh;
      this.paint();
    }
    // A picture as large as the page needs: filling it (the surplus is cut
    // off at the edge) or fitting whole inside it.
    fitImage(mode) {
      const it = this.cur;
      if (!it || it.type !== 'image') return;
      const im = this.doc.images[it.imageId];
      if (!im) return;
      this.commit();
      const asp = im.h / im.w;
      const pageAsp = this.box.h / this.box.w;
      const w = mode === 'fill' ? Math.max(1, pageAsp / asp) : Math.min(1, pageAsp / asp);
      it.w = w; it.rot = 0;
      it.x = (1 - w) / 2;
      it.y = (1 - w * asp / pageAsp) / 2;
      this.paint();
    }
    async replaceImage() {
      const it = this.cur;
      if (!it || it.type !== 'image') return;
      const r = await this.office.pickImage();
      if (!r) return;
      this.commit();
      this.imgs.set(r.id, await loadImg(this.doc.images[r.id].src));
      it.imageId = r.id;
      this.paint();
    }
    act(a, el) {
      const it = this.cur;
      if (a === 'del') this.remove();
      else if (a === 'dup') this.duplicate();
      else if (a.startsWith('layer-')) this.layerMove(a.slice(6));
      else if (a.startsWith('al-')) this.alignTo(a.slice(3));
      else if (a === 'fill' || a === 'fit') this.fitImage(a);
      else if (a === 'replace') this.replaceImage();
      else if (a === 'flip' && it) { this.commit(); it.flip = !it.flip; this.paint(); }
      else if (a.startsWith('tg-') && it) { this.commit(); const k = a.slice(3); it[k] = !it[k]; el.classList.toggle('on', it[k]); this.paint(); }
      else if (a.startsWith('ta-') && it) { this.commit(); it.align = a.slice(3); this.showPanel(); this.paint(); }
      else if (a.startsWith('sw-')) { this.commit(); this.cover.bg = a.slice(3); this.showPanel(); this.paint(); }
    }

    // ── Panel ──────────────────────────────────────────────────────────────
    showPanel() {
      const t = this.t, it = this.cur;
      const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
      const btn = (act, label, title, on) => `<button class="mo-btn mo-cv-b${on ? ' on' : ''}" data-act="${act}" title="${esc(title || '')}">${label}</button>`;
      const row = (label, inner) => `<label class="mo-cv-r"><span>${esc(label)}</span>${inner}</label>`;
      if (!it) {
        this.panel.innerHTML = `
          <div class="mo-cv-h3">${esc(t(this.side === 'front' ? 'mo_front_cover' : 'mo_back_cover'))}</div>
          ${row(t('mo_cv_bg'), `<input type="color" data-p="bg" value="${this.cover.bg}">`)}
          <div class="mo-cv-sw">${SWATCHES.map(c => `<button class="mo-cv-swb" data-act="sw-${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
          <p class="mo-dlg-hint">${esc(t('mo_cv_hint'))}</p>`;
        return;
      }
      const pt = it.type === 'text' ? Math.round(it.size * this.box.w * 72 / 25.4 * 10) / 10 : 0;
      let h = '';
      if (it.type === 'text') {
        h += `<textarea class="mo-dlg-in" data-p="text" rows="3" maxlength="2000">${esc(it.text)}</textarea>
          <div class="mo-cv-rowb">
            <select data-p="font">${Object.keys(M.COVER_FONTS).map(f => opt(f, t('mo_cv_font_' + f), it.ff ? '' : it.font)).join('')}${this.fontOptions(it)}</select>
            <input type="number" data-p="pt" min="4" max="400" step="1" value="${pt}" title="pt">
          </div>
          <div class="mo-cv-rowb">
            ${btn('tg-bold', '<b>B</b>', t('mo_bold'), it.bold)}${btn('tg-italic', '<i>I</i>', t('mo_italic'), it.italic)}${btn('tg-caps', 'Aa', t('mo_cv_caps'), it.caps)}
            ${btn('ta-left', '⯇', t('mo_align_left'), it.align === 'left')}${btn('ta-center', '≡', t('mo_align_center'), it.align === 'center')}${btn('ta-right', '⯈', t('mo_align_right'), it.align === 'right')}
          </div>
          ${row(t('mo_text_color'), `<input type="color" data-p="color" value="${it.color}">`)}
          ${row(t('mo_cv_lh'), `<input type="range" data-p="lh" min="0.8" max="2.5" step="0.05" value="${it.lh}">`)}
          ${row(t('mo_cv_ls'), `<input type="range" data-p="ls" min="-0.05" max="0.6" step="0.01" value="${it.ls}">`)}
          ${row(t('mo_cv_fx'), `<select data-p="fx">${M.TEXT_FX.map(f => opt(f, t('mo_cv_fx_' + f), it.fx)).join('')}</select>`)}
          <div class="mo-cv-fxc">
            ${['shadow', 'outline', 'glow', 'long'].includes(it.fx) ? row(t('mo_cv_fx_color'), `<input type="color" data-p="fx1" value="${it.fx1}">`) : ''}
            ${['gradient', 'band'].includes(it.fx) ? row(t(it.fx === 'band' ? 'mo_cv_fx_band_color' : 'mo_cv_fx_to'), `<input type="color" data-p="fx2" value="${it.fx2}">`) : ''}
          </div>`;
      } else if (it.type === 'image') {
        h += `<div class="mo-cv-rowb">${btn('replace', '🖼 ' + esc(t('mo_cv_replace')))}${btn('flip', '⇋ ' + esc(t('mo_cv_flip')), '', it.flip)}</div>
          <div class="mo-cv-rowb">${btn('fill', esc(t('mo_cv_fill')), t('mo_cv_fill_hint'))}${btn('fit', esc(t('mo_cv_fit')), t('mo_cv_fit_hint'))}</div>`;
      } else {
        h += `${row(t('mo_cv_shape'), `<select data-p="shape">${['rect', 'ellipse', 'line'].map(s => opt(s, t('mo_cv_' + (s === 'rect' ? 'rect' : s)), it.shape)).join('')}</select>`)}
          ${row(t(it.shape === 'line' ? 'mo_cv_line_color' : 'mo_cv_fill_color'), `<input type="color" data-p="fill" value="${(it.shape === 'line' ? it.stroke || it.fill : it.fill) || '#cccccc'}">`)}
          ${it.shape !== 'line' ? `${row(t('mo_cv_nofill'), `<input type="checkbox" data-p="nofill"${it.fill ? '' : ' checked'}>`)}
            ${row(t('mo_cv_stroke'), `<input type="color" data-p="stroke" value="${it.stroke || '#111111'}">`)}
            ${row(t('mo_cv_stroke_w'), `<input type="range" data-p="sw" min="0" max="0.03" step="0.001" value="${it.stroke ? it.sw : 0}">`)}
            ${it.shape === 'rect' ? row(t('mo_cv_radius'), `<input type="range" data-p="radius" min="0" max="0.5" step="0.01" value="${it.radius}">`) : ''}` :
            row(t('mo_cv_thick'), `<input type="range" data-p="sw" min="0.001" max="0.03" step="0.001" value="${it.sw}">`)}`;
      }
      h += `${row(t('mo_cv_opacity'), `<input type="range" data-p="opacity" min="0.05" max="1" step="0.05" value="${it.opacity}">`)}
        ${row(t('mo_cv_rotation'), `<input type="number" data-p="rot" min="-180" max="180" step="1" value="${Math.round(it.rot)}">`)}
        <div class="mo-cv-lab">${esc(t('mo_cv_align_page'))}</div>
        <div class="mo-cv-rowb">${btn('al-l', '⇤')}${btn('al-c', '↔')}${btn('al-r', '⇥')}${btn('al-t', '⤒')}${btn('al-m', '↕')}${btn('al-b', '⤓')}</div>
        <div class="mo-cv-lab">${esc(t('mo_cv_layer'))}</div>
        <div class="mo-cv-rowb">${btn('layer-front', '⤒', t('mo_cv_to_front'))}${btn('layer-up', '↑', t('mo_cv_forward'))}${btn('layer-down', '↓', t('mo_cv_backward'))}${btn('layer-back', '⤓', t('mo_cv_to_back'))}
          ${btn('dup', '⧉', t('mo_duplicate'))}${btn('del', '🗑', t('mo_delete'))}</div>`;
      this.panel.innerHTML = h;
    }
    // While dragging, the number fields follow the item.
    syncPanelValues() {
      const it = this.cur;
      if (!it) return;
      const f = k => this.panel.querySelector(`[data-p="${k}"]`);
      if (f('rot')) f('rot').value = Math.round(it.rot);
      if (f('pt') && it.type === 'text') f('pt').value = Math.round(it.size * this.box.w * 72 / 25.4 * 10) / 10;
    }
    onPanel(e, change) {
      const k = e.target.dataset && e.target.dataset.p;
      if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      this.commit(true);
      if (k === 'bg') { this.cover.bg = v; this.paint(); return; }
      const it = this.cur;
      if (!it) return;
      const num = parseFloat(v);
      switch (k) {
        case 'text': it.text = v; break;
        case 'font': {
          const FN = window.MvmOfficeFonts;
          if (v.startsWith('ff:') && FN && FN.has(v.slice(3))) {
            it.ff = v.slice(3);
            const cat = FN.by[it.ff].category;
            it.font = cat === 'mono' ? 'mono' : cat === 'serif' ? 'serif' : cat === 'display' ? 'display' : 'sans';
          } else { it.ff = ''; it.font = v; }
          break;
        }
        case 'pt': if (num > 0) it.size = num * 25.4 / 72 / this.box.w; break;
        case 'color': it.color = v; break;
        case 'lh': it.lh = num; break;
        case 'ls': it.ls = num; break;
        case 'fx': it.fx = v; if (change) { this.showPanel(); } break;
        case 'fx1': it.fx1 = v; break;
        case 'fx2': it.fx2 = v; break;
        case 'opacity': it.opacity = num; break;
        case 'rot': if (isFinite(num)) it.rot = Math.max(-360, Math.min(360, num)); break;
        case 'shape': it.shape = v; if (it.shape === 'line') it.stroke = it.stroke || it.fill; this.showPanel(); break;
        case 'fill': if (it.shape === 'line') it.stroke = v; else it.fill = v; break;
        case 'nofill': it.fill = v ? '' : '#cccccc'; this.showPanel(); break;
        case 'stroke': it.stroke = v; if (!it.sw) it.sw = 0.004; break;
        case 'sw': it.sw = num; if (it.shape !== 'line' && num === 0) it.stroke = ''; else if (it.shape !== 'line' && !it.stroke) it.stroke = '#111111'; break;
        case 'radius': it.radius = num; break;
      }
      this.schedule();
    }

    finish(ok) {
      const close = () => {
        window.removeEventListener('pointermove', this._mv);
        window.removeEventListener('pointerup', this._up);
        window.removeEventListener('pointercancel', this._up);
        document.removeEventListener('keydown', this._key, true);
        this._ro.disconnect();
        this.ov.remove();
        this.done(ok ? { cover: M.normCover(this.cov.front, this.doc, 'front'), back: M.normCover(this.cov.back, this.doc, 'back') } : null);
      };
      if (!ok && this.undo.length) {
        this.office.confirm(this.t('mo_cv_discard'), this.t('mo_cv_discard_ok')).then(y => { if (y) close(); });
      } else close();
    }
  }

  function open(office, side) {
    return new Promise(resolve => new CoverEditor(office, side || 'front', resolve));
  }

  window.MvmOfficeCover = { open, render, toImage, loadImages, itemBox };
})();
