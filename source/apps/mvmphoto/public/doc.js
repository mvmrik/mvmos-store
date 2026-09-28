// mvmPhoto — the image document: layers, selection, history and the pixel
// work that does not depend on the user interface.
//
// Every layer is a canvas the size of the image. The selection is one more
// canvas of the same size whose alpha says how much of each pixel is
// selected. Canvases are never changed after something else may hold them:
// an edit replaces a layer's canvas with a fresh copy first (pixels()), so
// an undo step is only a list of the canvases that were current at the time,
// and a step that touched one layer costs one layer of memory.
(function () {
  const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
    'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const MAX_UNDO = 50;
  const HISTORY_BYTES = 1.5e9;
  const MAX_SIDE = 16384;
  const MAX_AREA = 120e6;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function clone(c) {
    const n = canvas(c.width, c.height);
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }
  function readPixels(c) {
    return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  }
  // src with everything outside the mask removed, as a new canvas.
  function masked(src, mask) {
    const out = clone(src);
    const ctx = out.getContext('2d');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    return out;
  }
  // orig where the mask is empty, changed where it is full, blended in
  // between: orig·(1−m) + changed·m, computed on premultiplied pixels.
  function applyMasked(orig, changed, mask) {
    if (!mask) return changed;
    const out = clone(orig);
    const ctx = out.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(masked(changed, mask), 0, 0);
    return out;
  }

  let seq = 0;
  const uid = p => p + Date.now().toString(36) + (seq++).toString(36);

  class Doc {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.layers = [];          // bottom first
      this.active = null;
      this.sel = null;
      this.undoStack = [];
      this.redoStack = [];
      this.onChange = null;
    }

    newLayer(name) {
      return { id: uid('l'), name, visible: true, opacity: 1, blend: 'source-over', canvas: canvas(this.width, this.height) };
    }
    layer(id) { return this.layers.find(l => l.id === id) || null; }
    activeLayer() { return this.layer(this.active); }
    indexOf(id) { return this.layers.findIndex(l => l.id === id); }

    snapshot() {
      return { width: this.width, height: this.height, active: this.active, sel: this.sel, layers: this.layers.map(l => ({ ...l })) };
    }
    restore(s) {
      this.width = s.width;
      this.height = s.height;
      this.active = s.active;
      this.sel = s.sel;
      this.layers = s.layers.map(l => ({ ...l }));
    }
    // Remembers the current state as an undo step; call before any change.
    checkpoint() { this.pushUndo(this.snapshot()); }
    pushUndo(s) {
      this.undoStack.push(s);
      this.redoStack = [];
      this.trim();
      if (this.onChange) this.onChange();
    }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
      if (this.onChange) this.onChange();
      return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
      if (this.onChange) this.onChange();
      return true;
    }
    // Keeps the history within a number of steps and a memory budget.
    trim() {
      while (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      const bytes = () => {
        const seen = new Set();
        let n = 0;
        const add = c => { if (c && !seen.has(c)) { seen.add(c); n += c.width * c.height * 4; } };
        for (const s of [...this.undoStack, ...this.redoStack, this.snapshot()]) { s.layers.forEach(l => add(l.canvas)); add(s.sel); }
        return n;
      };
      while (this.undoStack.length > 1 && bytes() > HISTORY_BYTES) this.undoStack.shift();
    }
    // A fresh copy of the layer's pixels to draw on; the old canvas stays
    // with the undo step.
    pixels(layer) {
      layer.canvas = clone(layer.canvas);
      return layer.canvas.getContext('2d');
    }

    // Draws the visible layers into ctx. hook(layer) may hand back another
    // canvas to draw instead of the layer's own; after(layer, ctx) runs
    // right after a layer is drawn.
    composite(ctx, hook, after) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this.width, this.height);
      for (const l of this.layers) {
        if (l.visible && l.opacity > 0) {
          ctx.globalAlpha = l.opacity;
          ctx.globalCompositeOperation = l.blend;
          ctx.drawImage((hook && hook(l)) || l.canvas, 0, 0);
        }
        if (after) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          after(l, ctx);
        }
      }
      ctx.restore();
    }
    flattened(background) {
      const c = canvas(this.width, this.height);
      const ctx = c.getContext('2d');
      this.composite(ctx);
      if (background) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      return c;
    }

    // Whole-image operations: the same change to every layer and the
    // selection. fn(canvas) returns the new canvas.
    transformAll(fn, w, h, keepSel) {
      this.checkpoint();
      for (const l of this.layers) l.canvas = fn(l.canvas);
      this.sel = keepSel && this.sel ? fn(this.sel) : null;
      this.width = w;
      this.height = h;
    }
  }

  function blank(w, h, fill, name) {
    const d = new Doc(w, h);
    const l = d.newLayer(name);
    if (fill) {
      const ctx = l.canvas.getContext('2d');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
    }
    d.layers.push(l);
    d.active = l.id;
    return d;
  }
  function fromImage(img, name) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const d = new Doc(w, h);
    const l = d.newLayer(name);
    l.canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    d.layers.push(l);
    d.active = l.id;
    return d;
  }
  function sizeOk(w, h) { return w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA; }

  // ── Geometry on canvases ───────────────────────────────────────────────
  // Downscaling in halves keeps detail that one big step would skip.
  function resample(src, w, h) {
    let cur = src;
    while (cur.width / 2 >= w && cur.height / 2 >= h) {
      const half = canvas(Math.max(w, Math.floor(cur.width / 2)), Math.max(h, Math.floor(cur.height / 2)));
      const c = half.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    const out = canvas(w, h);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    return out;
  }
  function offset(src, w, h, dx, dy) {
    const out = canvas(w, h);
    out.getContext('2d').drawImage(src, dx, dy);
    return out;
  }
  function rotate(src, deg) {
    const q = ((deg % 360) + 360) % 360;
    const swap = q === 90 || q === 270;
    const out = canvas(swap ? src.height : src.width, swap ? src.width : src.height);
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(q * Math.PI / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  }
  function flip(src, horizontal) {
    const out = canvas(src.width, src.height);
    const ctx = out.getContext('2d');
    if (horizontal) { ctx.translate(src.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, src.height); ctx.scale(1, -1); }
    ctx.drawImage(src, 0, 0);
    return out;
  }
  // Smallest rectangle holding every pixel with some alpha, or null.
  function alphaBounds(c) {
    if (c._bounds !== undefined) return c._bounds;
    const { data, width: w, height: h } = readPixels(c);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      let row = y * w * 4 + 3;
      for (let x = 0; x < w; x++, row += 4) {
        if (data[row]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    const b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    c._bounds = b;
    return b;
  }
  function crop(src, r) {
    const out = canvas(r.w, r.h);
    out.getContext('2d').drawImage(src, -r.x, -r.y);
    return out;
  }

  // ── Selection ──────────────────────────────────────────────────────────
  function shapeMask(w, h, draw) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    draw(ctx);
    return c;
  }
  // mode: new, add, subtract, intersect. Returns null for an empty result.
  function combine(old, shape, mode) {
    let out;
    if (mode === 'new' || !old) out = mode === 'subtract' || (mode === 'intersect' && !old) ? null : shape;
    else {
      out = clone(old);
      const ctx = out.getContext('2d');
      ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
      ctx.drawImage(shape, 0, 0);
    }
    return out && alphaBounds(out) ? out : null;
  }
  function invert(sel, w, h) {
    const out = shapeMask(w, h, ctx => ctx.fillRect(0, 0, w, h));
    if (sel) {
      const ctx = out.getContext('2d');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(sel, 0, 0);
    }
    return alphaBounds(out) ? out : null;
  }
  function maskFromBytes(bytes, w, h) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0, j = 0; i < bytes.length; i++, j += 4) {
      if (bytes[i]) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = bytes[i]; }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // The border of a selection as a path in image pixels, for the moving
  // dashed line. Runs of edge are joined so a rectangle is four lines.
  function outline(mask) {
    if (mask._outline) return mask._outline;
    const { data, width: w, height: h } = readPixels(mask);
    const inside = new Uint8Array((w + 2) * (h + 2));
    const W = w + 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inside[(y + 1) * W + x + 1] = data[(y * w + x) * 4 + 3] >= 128 ? 1 : 0;
    const p = new Path2D();
    for (let y = 0; y <= h; y++) {
      let run = -1;
      const a = y * W, b = (y + 1) * W;
      for (let x = 0; x <= w; x++) {
        const edge = x < w && inside[a + x + 1] !== inside[b + x + 1];
        if (edge && run < 0) run = x;
        else if (!edge && run >= 0) { p.moveTo(run, y); p.lineTo(x, y); run = -1; }
      }
    }
    for (let x = 0; x <= w; x++) {
      let run = -1;
      for (let y = 0; y <= h; y++) {
        const edge = y < h && inside[(y + 1) * W + x] !== inside[(y + 1) * W + x + 1];
        if (edge && run < 0) run = y;
        else if (!edge && run >= 0) { p.moveTo(x, run); p.lineTo(x, y); run = -1; }
      }
    }
    mask._outline = p;
    return p;
  }

  // Pixels similar to the one at (x, y): only the connected area when
  // contiguous, everywhere otherwise. Returns alpha bytes, 255 = taken.
  function flood(img, sx, sy, tol, contiguous) {
    const { data: d, width: w, height: h } = img;
    const out = new Uint8Array(w * h);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
    const s = (sy * w + sx) * 4;
    const r = d[s], g = d[s + 1], b = d[s + 2], a = d[s + 3];
    const like = i => {
      const j = i * 4;
      if (a === 0 && d[j + 3] === 0) return true;
      return Math.abs(d[j] - r) <= tol && Math.abs(d[j + 1] - g) <= tol && Math.abs(d[j + 2] - b) <= tol && Math.abs(d[j + 3] - a) <= tol;
    };
    if (!contiguous) {
      for (let i = 0; i < w * h; i++) if (like(i)) out[i] = 255;
      return out;
    }
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x0 = stack.pop();
      let x = x0;
      const row = y * w;
      if (out[row + x] || !like(row + x)) continue;
      while (x > 0 && !out[row + x - 1] && like(row + x - 1)) x--;
      let upOpen = false, downOpen = false;
      for (; x < w && !out[row + x] && like(row + x); x++) {
        out[row + x] = 255;
        if (y > 0) {
          const u = row - w + x;
          const ok = !out[u] && like(u);
          if (ok && !upOpen) stack.push(x, y - 1);
          upOpen = ok;
        }
        if (y < h - 1) {
          const dn = row + w + x;
          const ok = !out[dn] && like(dn);
          if (ok && !downOpen) stack.push(x, y + 1);
          downOpen = ok;
        }
      }
    }
    return out;
  }

  // ── Adjustments ────────────────────────────────────────────────────────
  // Each takes a canvas and returns a changed copy.
  function perPixel(src, fn) {
    const out = clone(src);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, out.width, out.height);
    fn(img.data);
    ctx.putImageData(img, 0, 0);
    return out;
  }
  function brightnessContrast(src, brightness, contrast) {
    const b = brightness * 1.5;
    const c = Math.tan((contrast / 100 + 1) * Math.PI / 4);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = (i + b - 128) * c + 128;
    return perPixel(src, d => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; } });
  }
  function hueSaturation(src, hue, saturation, lightness) {
    const hs = hue / 360, sf = saturation / 100, lf = lightness / 100;
    return perPixel(src, d => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
          const dd = max - min;
          s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
          h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
          h /= 6;
        }
        h = (h + hs + 1) % 1;
        s = Math.min(1, Math.max(0, sf >= 0 ? s + (1 - s) * sf * s : s * (1 + sf)));
        l = Math.min(1, Math.max(0, lf >= 0 ? l + (1 - l) * lf : l * (1 + lf)));
        let R, G, B;
        if (s === 0) R = G = B = l;
        else {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
          const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
          R = f(h + 1 / 3); G = f(h); B = f(h - 1 / 3);
        }
        d[i] = R * 255; d[i + 1] = G * 255; d[i + 2] = B * 255;
      }
    });
  }
  function invertColors(src) {
    return perPixel(src, d => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } });
  }
  function grayscale(src) {
    return perPixel(src, d => { for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; } });
  }
  // Three box blurs are close to a Gaussian one. Done on premultiplied
  // colors so transparent pixels do not bleed dark edges.
  function blur(src, radius) {
    if (radius <= 0) return clone(src);
    const w = src.width, h = src.height;
    const out = clone(src);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3] / 255;
      ch[0][i] = d[i * 4] * a; ch[1][i] = d[i * 4 + 1] * a; ch[2][i] = d[i * 4 + 2] * a; ch[3][i] = d[i * 4 + 3];
    }
    const sigma = radius;
    const boxes = [];
    const wIdeal = Math.sqrt(12 * sigma * sigma / 3 + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
    for (let i = 0; i < 3; i++) boxes.push(((i < m ? wl : wl + 2) - 1) / 2);
    const tmp = new Float32Array(n);
    const pass = (a, b, r, horizontal) => {
      const len = horizontal ? w : h, lines = horizontal ? h : w;
      const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
      const inv = 1 / (r + r + 1);
      for (let L = 0; L < lines; L++) {
        const base = L * lineStep;
        const first = a[base];
        let acc = (r + 1) * first;
        for (let k = 0; k < r; k++) acc += a[base + Math.min(k, len - 1) * step];
        for (let k = 0; k < len; k++) {
          acc += a[base + Math.min(k + r, len - 1) * step] - (k - r - 1 >= 0 ? a[base + (k - r - 1) * step] : first);
          b[base + k * step] = acc * inv;
        }
      }
    };
    for (const c of ch) for (const r of boxes) { const ri = Math.round(r); pass(c, tmp, ri, true); pass(tmp, c, ri, false); }
    for (let i = 0; i < n; i++) {
      const a = ch[3][i];
      d[i * 4 + 3] = a;
      const k = a > 0 ? 255 / a : 0;
      d[i * 4] = ch[0][i] * k; d[i * 4 + 1] = ch[1][i] * k; d[i * 4 + 2] = ch[2][i] * k;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }
  // Unsharp mask: the image plus amount × (image − slightly blurred image).
  function sharpen(src, amount) {
    const soft = readPixels(blur(src, 1)).data;
    const k = amount / 100;
    return perPixel(src, d => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] += (d[i] - soft[i]) * k; d[i + 1] += (d[i + 1] - soft[i + 1]) * k; d[i + 2] += (d[i + 2] - soft[i + 2]) * k;
      }
    });
  }

  // ── Files ──────────────────────────────────────────────────────────────
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported')); };
      img.src = url;
    });
  }
  function canvasBlob(c, type, quality) {
    return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
  }
  function blobDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('encode'));
      r.readAsDataURL(blob);
    });
  }
  // A project is JSON with each layer as a PNG, so nothing is lost.
  async function serialize(doc) {
    const layers = [];
    for (const l of doc.layers) {
      layers.push({ name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, png: await blobDataURL(await canvasBlob(l.canvas, 'image/png')) });
    }
    return JSON.stringify({ format: 'mvmphoto', version: 1, width: doc.width, height: doc.height, active: doc.indexOf(doc.active), layers });
  }
  async function parse(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('not_project'); }
    if (!raw || raw.format !== 'mvmphoto' || !Array.isArray(raw.layers) || !raw.layers.length) throw new Error('not_project');
    const w = Math.round(+raw.width), h = Math.round(+raw.height);
    if (!sizeOk(w, h)) throw new Error('not_project');
    const d = new Doc(w, h);
    for (const src of raw.layers) {
      const l = d.newLayer(String(src.name || ''));
      l.visible = src.visible !== false;
      l.opacity = Math.min(1, Math.max(0, src.opacity == null ? 1 : +src.opacity));
      l.blend = BLENDS.includes(src.blend) ? src.blend : 'source-over';
      if (typeof src.png === 'string' && src.png.startsWith('data:image/')) {
        const img = await loadImage(await (await fetch(src.png)).blob());
        l.canvas.getContext('2d').drawImage(img, 0, 0);
      }
      d.layers.push(l);
    }
    const a = d.layers[+raw.active] || d.layers[d.layers.length - 1];
    d.active = a.id;
    return d;
  }

  window.MvmPhotoDoc = {
    BLENDS, Doc, blank, fromImage, sizeOk, MAX_SIDE,
    canvas, clone, readPixels, masked, applyMasked,
    resample, offset, rotate, flip, alphaBounds, crop,
    shapeMask, combine, invert, maskFromBytes, outline, flood,
    brightnessContrast, hueSaturation, invertColors, grayscale, blur, sharpen,
    loadImage, canvasBlob, serialize, parse,
  };
})();
