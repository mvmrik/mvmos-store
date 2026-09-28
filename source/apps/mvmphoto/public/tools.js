// mvmPhoto — the tools. Each tool gets the pointer in image pixels
// (down/move/up), may draw guides over the view (overlay) and lists the
// fields of its options bar. Painting goes through the editor's stroke
// canvas (startPaint/commitPaint), so opacity and the selection apply the
// same way to every tool.
(function () {
  const D = window.MvmPhotoDoc;
  const { t } = window.MvmPhotoUI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const MODES = [
    { v: 'new', icon: '▭', label: 'mp_mode_new' },
    { v: 'add', icon: '⊕', label: 'mp_mode_add' },
    { v: 'subtract', icon: '⊖', label: 'mp_mode_subtract' },
    { v: 'intersect', icon: '⊗', label: 'mp_mode_intersect' },
  ];
  const FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];

  // Shift adds, Alt subtracts, both intersect; otherwise the option.
  function selMode(e, o) {
    if (e.shiftKey && e.altKey) return 'intersect';
    if (e.shiftKey) return 'add';
    if (e.altKey) return 'subtract';
    return o.mode;
  }
  // Shift keeps lines at multiples of 45°.
  function snap45(p0, p) {
    const a = Math.round(Math.atan2(p.y - p0.y, p.x - p0.x) / (Math.PI / 4)) * (Math.PI / 4);
    const r = dist(p0, p);
    return { x: p0.x + Math.cos(a) * r, y: p0.y + Math.sin(a) * r };
  }
  // A drag rectangle; square with Shift, from the center with Alt.
  function dragRect(p0, p, square, center) {
    let dx = p.x - p0.x, dy = p.y - p0.y;
    if (square) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
    if (center) return { x: p0.x - Math.abs(dx), y: p0.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
    return { x: Math.min(p0.x, p0.x + dx), y: Math.min(p0.y, p0.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
  }
  function hexOf(r, g, b) { return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }

  function create(ed) {
    const doc = () => ed.doc;
    const opt = g => ed.options[g];
    const tools = {};

    // ── Screen guides ──────────────────────────────────────────────────
    function dashed(ctx, draw) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#fff';
      draw(ctx);
      ctx.stroke();
      ctx.lineDashOffset = 5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.restore();
    }
    function handle(ctx, s) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1c7ed6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(s.x - 4.5, s.y - 4.5, 9, 9);
      ctx.fill();
      ctx.stroke();
    }

    // ── Selection tools ────────────────────────────────────────────────
    function marquee(id, icon, ellipse) {
      return {
        id, icon, key: 'm', group: 'select', hint: 'mp_hint_marquee',
        fields: () => [{ type: 'seg', key: 'mode', choices: MODES }],
        down(p, e) {
          this.p0 = p; this.p1 = p;
          this.mode = selMode(e, opt('select'));
          this.shiftAtStart = e.shiftKey;
          this.active = true;
        },
        move(p, e) { this.p1 = p; this.e = e; },
        rect() {
          const e = this.e || {};
          return dragRect(this.p0, this.p1, e.shiftKey && !this.shiftAtStart, e.altKey && !this.shiftAtStart && this.mode !== 'subtract');
        },
        up() {
          this.active = false;
          const d = doc();
          const r = this.rect();
          if (r.w * ed.view.zoom < 3 && r.h * ed.view.zoom < 3) {
            if (this.mode === 'new') ed.deselect();
            this.e = null;
            return;
          }
          const mask = D.shapeMask(d.width, d.height, ctx => {
            ctx.beginPath();
            if (ellipse) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
            else { const x = Math.round(r.x), y = Math.round(r.y); ctx.rect(x, y, Math.round(r.x + r.w) - x, Math.round(r.y + r.h) - y); }
            ctx.fill();
          });
          this.e = null;
          ed.setSelection(mask, this.mode);
        },
        overlay(ctx) {
          if (!this.active) return;
          const r = this.rect();
          const a = ed.toScreen(r), z = ed.view.zoom;
          dashed(ctx, c => {
            c.beginPath();
            if (ellipse) c.ellipse(a.x + r.w * z / 2, a.y + r.h * z / 2, r.w * z / 2, r.h * z / 2, 0, 0, Math.PI * 2);
            else c.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(r.w * z), Math.round(r.h * z));
          });
        },
        cancel() { this.active = false; },
      };
    }
    tools.marquee = marquee('marquee', '⬚', false);
    tools.ellipse = marquee('ellipse', '◯', true);

    tools.lasso = {
      id: 'lasso', icon: '➰', key: 'l', group: 'select', hint: 'mp_hint_lasso',
      fields: () => [{ type: 'seg', key: 'mode', choices: MODES }],
      down(p, e) { this.pts = [p]; this.mode = selMode(e, opt('select')); },
      move(p) { if (this.pts && dist(p, this.pts[this.pts.length - 1]) * ed.view.zoom >= 1.5) this.pts.push(p); },
      up() {
        const pts = this.pts;
        this.pts = null;
        if (!pts || pts.length < 3) { if (this.mode === 'new') ed.deselect(); return; }
        const d = doc();
        ed.setSelection(D.shapeMask(d.width, d.height, ctx => {
          ctx.beginPath();
          pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          ctx.fill();
        }), this.mode);
      },
      overlay(ctx) {
        if (!this.pts) return;
        dashed(ctx, c => {
          c.beginPath();
          this.pts.forEach((q, i) => { const s = ed.toScreen(q); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
        });
      },
      cancel() { this.pts = null; },
    };

    tools.wand = {
      id: 'wand', icon: '🪄', key: 'w', hint: 'mp_hint_wand',
      fields: () => [
        { type: 'seg', key: 'mode', choices: MODES },
        { type: 'range', key: 'tolerance', label: 'mp_tolerance', min: 0, max: 255 },
        { type: 'check', key: 'contiguous', label: 'mp_contiguous' },
        { type: 'check', key: 'all', label: 'mp_sample_all' },
      ],
      down(p, e) {
        const d = doc();
        const o = opt('wand');
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
        const l = d.activeLayer();
        const src = o.all ? d.flattened() : l && l.canvas;
        if (!src) return;
        const bytes = D.flood(D.readPixels(src), x, y, o.tolerance, o.contiguous);
        ed.setSelection(D.maskFromBytes(bytes, d.width, d.height), selMode(e, o));
      },
      move() {},
    };

    tools.crop = {
      id: 'crop', icon: '✂', key: 'c', cursor: 'crosshair', hint: 'mp_hint_crop',
      rect: null,
      fields() {
        return this.rect ? [
          { type: 'button', act: 'apply', label: 'mp_apply', primary: true },
          { type: 'button', act: 'cancel', label: 'mp_cancel' },
        ] : [];
      },
      action(a) { if (a === 'apply') this.enter(); else this.cancel(); },
      // Which edges of the crop box are under the point, or 'in'.
      hit(p) {
        const r = this.rect;
        if (!r) return null;
        const tol = 7 / ed.view.zoom;
        const l = Math.abs(p.x - r.x) < tol, rr = Math.abs(p.x - (r.x + r.w)) < tol;
        const tp = Math.abs(p.y - r.y) < tol, b = Math.abs(p.y - (r.y + r.h)) < tol;
        const inX = p.x > r.x - tol && p.x < r.x + r.w + tol, inY = p.y > r.y - tol && p.y < r.y + r.h + tol;
        const edges = { l: l && inY, r: rr && inY, t: tp && inX, b: b && inX };
        if (edges.l || edges.r || edges.t || edges.b) return edges;
        if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'in';
        return null;
      },
      cursorAt(p) {
        const h = this.hit(p);
        if (!h) return 'crosshair';
        if (h === 'in') return 'move';
        if ((h.l && h.t) || (h.r && h.b)) return 'nwse-resize';
        if ((h.r && h.t) || (h.l && h.b)) return 'nesw-resize';
        return h.l || h.r ? 'ew-resize' : 'ns-resize';
      },
      down(p) {
        const h = this.hit(p);
        this.p0 = p;
        this.r0 = this.rect && { ...this.rect };
        this.how = h || 'new';
        if (!h) { this.rect = { x: p.x, y: p.y, w: 0, h: 0 }; ed.renderOptions(); }
      },
      move(p, e) {
        const d = doc();
        const dx = p.x - this.p0.x, dy = p.y - this.p0.y;
        let r;
        if (this.how === 'new') r = dragRect(this.p0, p, e.shiftKey, false);
        else if (this.how === 'in') r = { ...this.r0, x: clamp(this.r0.x + dx, 0, d.width - this.r0.w), y: clamp(this.r0.y + dy, 0, d.height - this.r0.h) };
        else {
          let x0 = this.r0.x, y0 = this.r0.y, x1 = x0 + this.r0.w, y1 = y0 + this.r0.h;
          if (this.how.l) x0 += dx;
          if (this.how.r) x1 += dx;
          if (this.how.t) y0 += dy;
          if (this.how.b) y1 += dy;
          r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        }
        const x0 = clamp(Math.round(r.x), 0, d.width), y0 = clamp(Math.round(r.y), 0, d.height);
        const x1 = clamp(Math.round(r.x + r.w), 0, d.width), y1 = clamp(Math.round(r.y + r.h), 0, d.height);
        this.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      },
      up() {
        if (this.rect && (this.rect.w < 1 || this.rect.h < 1)) { this.rect = null; ed.renderOptions(); }
      },
      dblclick(p) { if (this.hit(p) === 'in') this.enter(); },
      enter() {
        if (!this.rect) return false;
        const r = this.rect;
        this.rect = null;
        ed.renderOptions();
        ed.cropTo(r);
        return true;
      },
      overlay(ctx) {
        const r = this.rect;
        if (!r) return;
        const a = ed.toScreen(r), z = ed.view.zoom;
        const w = r.w * z, h = r.h * z;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath();
        ctx.rect(0, 0, ed.vw, ed.vh);
        ctx.rect(a.x, a.y, w, h);
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const f of [1 / 3, 2 / 3]) {
          ctx.moveTo(a.x + w * f, a.y); ctx.lineTo(a.x + w * f, a.y + h);
          ctx.moveTo(a.x, a.y + h * f); ctx.lineTo(a.x + w, a.y + h * f);
        }
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
        for (const [fx, fy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) handle(ctx, { x: a.x + w * fx, y: a.y + h * fy });
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(`${r.w} × ${r.h}`, a.x + 4, a.y - 8 > 12 ? a.y - 8 : a.y + 16);
        ctx.restore();
      },
      cancel() { if (this.rect) { this.rect = null; ed.renderOptions(); } },
      leave() { this.cancel(); },
    };

    // ── Colors ─────────────────────────────────────────────────────────
    tools.picker = {
      id: 'picker', icon: '💉', key: 'i', hint: 'mp_hint_picker',
      fields: () => [{ type: 'check', key: 'all', label: 'mp_sample_all' }],
      down(p, e) { this.which = ed.toolId === 'picker' && e.altKey ? 'bg' : 'fg'; this.pick(p); },
      move(p) { this.pick(p); },
      up() { ed.pushRecent(this.which === 'fg' ? ed.fg : ed.bg); },
      pick(p) {
        const d = doc();
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
        const l = d.activeLayer();
        const src = opt('picker').all ? (ed.compDirty || !ed.comp ? d.flattened() : ed.comp) : l && l.canvas;
        if (!src) return;
        const px = src.getContext('2d').getImageData(x, y, 1, 1).data;
        if (!px[3]) return;
        const hex = hexOf(px[0], px[1], px[2]);
        if ((this.which === 'fg' ? ed.fg : ed.bg) !== hex) ed.setColor(this.which, hex, true);
      },
    };

    // ── Painting ───────────────────────────────────────────────────────
    const dabs = new Map();
    function dab(size, hardness, color) {
      const key = size + '|' + hardness + '|' + color;
      let c = dabs.get(key);
      if (c) return c;
      if (dabs.size > 24) dabs.clear();
      const n = Math.ceil(size) + 2;
      c = D.canvas(n, n);
      const ctx = c.getContext('2d');
      const r = size / 2;
      if (hardness >= 100 || size < 3) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n / 2, n / 2, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, r);
        const rgb = color.match(/\w\w/g).map(h => parseInt(h, 16)).join(',');
        g.addColorStop(0, `rgba(${rgb},1)`);
        g.addColorStop(Math.min(0.99, hardness / 100), `rgba(${rgb},1)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, n, n);
      }
      dabs.set(key, c);
      return c;
    }
    function brushLike(id, icon, key, erase) {
      return {
        id, icon, key, paints: true, cursor: 'crosshair', hint: erase ? 'mp_hint_eraser' : 'mp_hint_brush',
        fields: () => [
          { type: 'range', key: 'size', label: 'mp_size', min: 1, max: 500, unit: 'px' },
          { type: 'range', key: 'hardness', label: 'mp_hardness', min: 0, max: 100, unit: '%' },
          { type: 'range', key: 'opacity', label: 'mp_opacity', min: 1, max: 100, unit: '%' },
        ],
        brushCursor: () => opt(id).size,
        down(p, e) {
          const o = opt(id);
          this.ctx = ed.startPaint(erase ? 'destination-out' : 'source-over', o.opacity / 100);
          if (!this.ctx) return;
          this.dab = dab(o.size, o.hardness, erase ? '#000000' : ed.fg);
          this.step = Math.max(0.5, o.size * (o.hardness >= 100 ? 0.08 : 0.12));
          this.carry = 0;
          if (e.shiftKey && this.end) { this.last = this.end; this.stamp(this.end); this.line(p); }
          else { this.last = p; this.stamp(p); }
        },
        stamp(p) { this.ctx.drawImage(this.dab, p.x - this.dab.width / 2, p.y - this.dab.height / 2); },
        line(p) {
          const a = this.last;
          const len = dist(a, p);
          let s = this.step - this.carry;
          while (s <= len) {
            this.stamp({ x: a.x + (p.x - a.x) * s / len, y: a.y + (p.y - a.y) * s / len });
            s += this.step;
          }
          this.carry = len - (s - this.step);
          this.last = p;
        },
        move(p) { if (this.ctx) this.line(p); },
        up(p) {
          if (!this.ctx) return;
          this.ctx = null;
          this.end = this.last || p;
          ed.commitPaint();
        },
        cancel() { if (this.ctx) { this.ctx = null; ed.cancelPaint(); } },
      };
    }
    tools.brush = brushLike('brush', '🖌', 'b', false);
    tools.eraser = brushLike('eraser', '🧽', 'e', true);

    // Hard square pixels with no smoothing, for pixel work.
    tools.pencil = {
      id: 'pencil', icon: '✏', key: 'b', paints: true, hint: 'mp_hint_pencil',
      fields: () => [
        { type: 'range', key: 'size', label: 'mp_size', min: 1, max: 100, unit: 'px' },
        { type: 'range', key: 'opacity', label: 'mp_opacity', min: 1, max: 100, unit: '%' },
      ],
      brushCursor: () => opt('pencil').size,
      down(p, e) {
        const o = opt('pencil');
        this.ctx = ed.startPaint('source-over', o.opacity / 100);
        if (!this.ctx) return;
        this.ctx.fillStyle = ed.fg;
        this.size = o.size;
        const q = { x: Math.floor(p.x), y: Math.floor(p.y) };
        if (e.shiftKey && this.end) { this.last = this.end; this.line(q); }
        else { this.last = q; this.dot(q); }
      },
      dot(q) { const s = this.size; this.ctx.fillRect(q.x - Math.floor((s - 1) / 2), q.y - Math.floor((s - 1) / 2), s, s); },
      line(q) {
        let { x: x0, y: y0 } = this.last;
        const dx = Math.abs(q.x - x0), dy = -Math.abs(q.y - y0);
        const sx = x0 < q.x ? 1 : -1, sy = y0 < q.y ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          this.dot({ x: x0, y: y0 });
          if (x0 === q.x && y0 === q.y) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
        this.last = q;
      },
      move(p) { if (this.ctx) this.line({ x: Math.floor(p.x), y: Math.floor(p.y) }); },
      up() { if (!this.ctx) return; this.ctx = null; this.end = this.last; ed.commitPaint(); },
      cancel() { if (this.ctx) { this.ctx = null; ed.cancelPaint(); } },
    };

    tools.bucket = {
      id: 'bucket', icon: '🪣', key: 'g', paints: true, hint: 'mp_hint_bucket',
      fields: () => [
        { type: 'range', key: 'tolerance', label: 'mp_tolerance', min: 0, max: 255 },
        { type: 'check', key: 'contiguous', label: 'mp_contiguous' },
        { type: 'check', key: 'all', label: 'mp_sample_all' },
        { type: 'range', key: 'opacity', label: 'mp_opacity', min: 1, max: 100, unit: '%' },
      ],
      down(p) {
        const d = doc();
        const o = opt('bucket');
        const x = Math.floor(p.x), y = Math.floor(p.y);
        const l = d.activeLayer();
        if (!l || x < 0 || y < 0 || x >= d.width || y >= d.height) return;
        const src = o.all ? d.flattened() : l.canvas;
        const mask = D.maskFromBytes(D.flood(D.readPixels(src), x, y, o.tolerance, o.contiguous), d.width, d.height);
        const ctx = ed.startPaint('source-over', o.opacity / 100);
        ctx.fillStyle = ed.fg;
        ctx.fillRect(0, 0, d.width, d.height);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ed.commitPaint();
      },
      move() {},
    };

    tools.gradient = {
      id: 'gradient', icon: '🌈', key: 'g', paints: true, hint: 'mp_hint_gradient',
      fields: () => [
        { type: 'seg', key: 'kind', choices: [{ v: 'linear', icon: '▤', label: 'mp_gradient_linear' }, { v: 'radial', icon: '◎', label: 'mp_gradient_radial' }] },
        { type: 'check', key: 'clear', label: 'mp_gradient_clear' },
        { type: 'range', key: 'opacity', label: 'mp_opacity', min: 1, max: 100, unit: '%' },
      ],
      down(p) {
        this.ctx = ed.startPaint('source-over', opt('gradient').opacity / 100);
        this.p0 = p; this.p1 = p;
      },
      move(p, e) {
        if (!this.ctx) return;
        this.p1 = e.shiftKey ? snap45(this.p0, p) : p;
        this.render();
      },
      render() {
        const d = doc(), o = opt('gradient'), ctx = this.ctx;
        const { p0, p1 } = this;
        ctx.clearRect(0, 0, d.width, d.height);
        const g = o.kind === 'radial' ? ctx.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, Math.max(0.5, dist(p0, p1))) : ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
        g.addColorStop(0, ed.fg);
        if (o.clear) {
          const rgb = ed.fg.match(/\w\w/g).map(h => parseInt(h, 16)).join(',');
          g.addColorStop(1, `rgba(${rgb},0)`);
        } else g.addColorStop(1, ed.bg);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, d.width, d.height);
      },
      up() {
        if (!this.ctx) return;
        this.ctx = null;
        if (dist(this.p0, this.p1) * ed.view.zoom < 2) { ed.cancelPaint(); return; }
        ed.commitPaint();
      },
      overlay(ctx) {
        if (!this.ctx) return;
        const a = ed.toScreen(this.p0), b = ed.toScreen(this.p1);
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        handle(ctx, a); handle(ctx, b);
        ctx.restore();
      },
      cancel() { if (this.ctx) { this.ctx = null; ed.cancelPaint(); } },
    };

    tools.shape = {
      id: 'shape', icon: '⬟', key: 'u', paints: true, hint: 'mp_hint_shape',
      fields() {
        const o = opt('shape');
        return [
          { type: 'seg', key: 'kind', choices: [{ v: 'rect', icon: '▭', label: 'mp_shape_rect' }, { v: 'ellipse', icon: '◯', label: 'mp_shape_ellipse' }, { v: 'line', icon: '╱', label: 'mp_shape_line' }] },
          ...(o.kind === 'line' ? [] : [{ type: 'seg', key: 'style', choices: [{ v: 'fill', icon: '■', label: 'mp_style_fill' }, { v: 'stroke', icon: '□', label: 'mp_style_stroke' }, { v: 'both', icon: '▣', label: 'mp_style_both' }] }]),
          ...(o.kind === 'line' || o.style !== 'fill' ? [{ type: 'range', key: 'width', label: 'mp_stroke_width', min: 1, max: 200, unit: 'px' }] : []),
          { type: 'range', key: 'opacity', label: 'mp_opacity', min: 1, max: 100, unit: '%' },
        ];
      },
      optionChanged(k) { if (k === 'kind' || k === 'style') ed.renderOptions(); },
      down(p) {
        this.ctx = ed.startPaint('source-over', opt('shape').opacity / 100);
        this.p0 = p;
      },
      move(p, e) {
        if (!this.ctx) return;
        const d = doc(), o = opt('shape'), ctx = this.ctx;
        ctx.clearRect(0, 0, d.width, d.height);
        ctx.lineWidth = o.width;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'round';
        this.drawn = true;
        if (o.kind === 'line') {
          const q = e.shiftKey ? snap45(this.p0, p) : p;
          ctx.strokeStyle = ed.fg;
          ctx.beginPath(); ctx.moveTo(this.p0.x, this.p0.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          this.drawn = dist(this.p0, q) > 0.5;
          return;
        }
        const r = dragRect(this.p0, p, e.shiftKey, e.altKey);
        if (r.w < 0.5 || r.h < 0.5) { this.drawn = false; return; }
        ctx.beginPath();
        if (o.kind === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        else if (o.style === 'fill') ctx.rect(Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w) - Math.round(r.x), Math.round(r.y + r.h) - Math.round(r.y));
        else ctx.rect(r.x, r.y, r.w, r.h);
        if (o.style !== 'stroke') { ctx.fillStyle = ed.fg; ctx.fill(); }
        if (o.style !== 'fill') { ctx.strokeStyle = o.style === 'both' ? ed.bg : ed.fg; ctx.stroke(); }
      },
      up() {
        if (!this.ctx) return;
        this.ctx = null;
        if (!this.drawn) { ed.cancelPaint(); return; }
        this.drawn = false;
        ed.commitPaint();
      },
      cancel() { if (this.ctx) { this.ctx = null; ed.cancelPaint(); } },
    };

    // ── Text ───────────────────────────────────────────────────────────
    tools.text = {
      id: 'text', icon: 'T', key: 't', cursor: 'text', hint: 'mp_hint_text',
      editing: null,
      fields() {
        return [
          { type: 'select', key: 'font', label: 'mp_font', choices: FONTS.map(f => ({ v: f })) },
          { type: 'range', key: 'size', label: 'mp_size', min: 4, max: 800, unit: 'px' },
          { type: 'check', key: 'bold', label: 'mp_bold' },
          { type: 'check', key: 'italic', label: 'mp_italic' },
          ...(this.editing ? [{ type: 'button', act: 'commit', label: 'mp_apply', primary: true }, { type: 'button', act: 'cancel', label: 'mp_cancel' }] : []),
        ];
      },
      action(a) { if (a === 'commit') this.commit(); else this.cancel(); },
      optionChanged() { this.restyle(); },
      font(size) {
        const o = opt('text');
        const fam = /\s/.test(o.font) ? `"${o.font}"` : o.font;
        return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${size}px ${fam}`;
      },
      down(p) {
        if (this.editing) { this.commit(); return; }
        const d = doc();
        if (!d.activeLayer()) return;
        const ta = document.createElement('textarea');
        ta.className = 'mp-text-edit';
        ta.spellcheck = false;
        ta.rows = 1;
        ed.viewEl.appendChild(ta);
        this.editing = { p, ta };
        ta.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); this.cancel(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
        });
        ta.addEventListener('input', () => this.place());
        this.restyle();
        ed.renderOptions();
        setTimeout(() => ta.focus(), 0);
      },
      move() {},
      restyle() {
        if (!this.editing) return;
        this.editing.ta.style.color = ed.fg;
        this.place();
      },
      place() {
        if (!this.editing) return;
        const { p, ta } = this.editing;
        const o = opt('text');
        const s = ed.toScreen(p);
        ta.style.font = this.font(o.size * ed.view.zoom);
        ta.style.lineHeight = '1.2';
        ta.style.left = s.x + 'px';
        ta.style.top = s.y + 'px';
        ta.style.width = '0px';
        ta.style.height = '0px';
        ta.style.width = (ta.scrollWidth + o.size * ed.view.zoom * 0.6 + 4) + 'px';
        ta.style.height = ta.scrollHeight + 'px';
      },
      commit() {
        const ed_ = this.editing;
        if (!ed_) return;
        this.editing = null;
        const text = ed_.ta.value.replace(/\s+$/, '');
        ed_.ta.remove();
        ed.renderOptions();
        ed.root.focus({ preventScroll: true });
        if (!text.trim()) return;
        const d = doc();
        const o = opt('text');
        d.checkpoint();
        const l = d.newLayer(text.split('\n')[0].trim().slice(0, 30) || t('mp_tool_text'));
        const ctx = l.canvas.getContext('2d');
        ctx.font = this.font(o.size);
        ctx.fillStyle = ed.fg;
        ctx.textBaseline = 'top';
        text.split('\n').forEach((line, i) => ctx.fillText(line, ed_.p.x, ed_.p.y + o.size * 0.1 + i * o.size * 1.2));
        ed.insertLayer(l);
        ed.changed();
      },
      cancel() {
        if (!this.editing) return;
        this.editing.ta.remove();
        this.editing = null;
        ed.renderOptions();
        ed.root.focus({ preventScroll: true });
      },
      leave() { this.commit(); },
      enter() { return false; },
    };

    // ── Move and free transform ────────────────────────────────────────
    // The pixels being moved float over what stays behind (base) until the
    // move ends: plain moves on release, a free transform on Enter.
    let floatTmp = null;
    function drawFloat(ctx, f, img, quality) {
      const s = f.st;
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      const plain = !s.a && s.w === img.width && s.h === img.height;
      if (plain) ctx.drawImage(img, Math.round(s.cx - s.w / 2), Math.round(s.cy - s.h / 2));
      else if (quality && !s.a) ctx.drawImage(D.resample(img, Math.max(1, Math.round(s.w)), Math.max(1, Math.round(s.h))), Math.round(s.cx - s.w / 2), Math.round(s.cy - s.h / 2));
      else {
        ctx.translate(s.cx, s.cy);
        ctx.rotate(s.a);
        ctx.drawImage(img, -s.w / 2, -s.h / 2, s.w, s.h);
      }
      ctx.restore();
    }
    tools.floatCanvas = () => {
      const f = ed.float, d = doc();
      if (!floatTmp || floatTmp.width !== d.width || floatTmp.height !== d.height) floatTmp = D.canvas(d.width, d.height);
      const ctx = floatTmp.getContext('2d');
      ctx.clearRect(0, 0, d.width, d.height);
      ctx.drawImage(f.base, 0, 0);
      drawFloat(ctx, f, f.img, false);
      return floatTmp;
    };

    tools.move = {
      id: 'move', icon: '✥', key: 'v', cursor: 'move', hint: 'mp_hint_move',
      fields() {
        const f = ed.float;
        if (f && f.transform) return [
          { type: 'hint', label: 'mp_hint_transform' },
          { type: 'button', act: 'apply', label: 'mp_apply', primary: true },
          { type: 'button', act: 'cancel', label: 'mp_cancel' },
        ];
        return [{ type: 'button', act: 'transform', label: 'mp_free_transform' }];
      },
      action(a) {
        if (a === 'transform') this.startTransform();
        else if (a === 'apply') this.apply();
        else this.cancel();
      },
      begin(transform) {
        const d = doc();
        const l = d.activeLayer();
        if (!l) return false;
        let b;
        if (d.sel) b = D.alphaBounds(d.sel);
        else b = transform ? D.alphaBounds(l.canvas) : { x: 0, y: 0, w: d.width, h: d.height };
        if (!b) { ed.toast(t('mp_layer_empty')); return false; }
        const cut = d.sel ? D.masked(l.canvas, d.sel) : l.canvas;
        const img = D.crop(cut, b);
        let base;
        if (d.sel) {
          base = D.clone(l.canvas);
          const c = base.getContext('2d');
          c.globalCompositeOperation = 'destination-out';
          c.drawImage(d.sel, 0, 0);
        } else if (transform) {
          base = D.clone(l.canvas);
          base.getContext('2d').clearRect(b.x, b.y, b.w, b.h);
        } else base = D.canvas(d.width, d.height);
        ed.float = {
          layerId: l.id, base, img, transform, hideSel: true,
          selPart: d.sel ? D.crop(d.sel, b) : null,
          st: { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, a: 0 },
        };
        return true;
      },
      startTransform() {
        if (ed.float) { if (ed.float.transform) return; this.apply(); }
        if (!this.begin(true)) return;
        ed.renderOptions();
        ed.redraw();
      },
      apply() {
        const f = ed.float;
        if (!f) return;
        ed.float = null;
        const d = doc();
        const s = f.st;
        const moved = !!(s.a || s.w !== f.img.width || s.h !== f.img.height || f.moved);
        if (moved) {
          d.checkpoint();
          const out = D.clone(f.base);
          drawFloat(out.getContext('2d'), f, f.img, true);
          out._bounds = undefined;
          d.layer(f.layerId).canvas = out;
          if (f.selPart) {
            const m = D.canvas(d.width, d.height);
            drawFloat(m.getContext('2d'), f, f.selPart, true);
            d.sel = D.alphaBounds(m) ? m : null;
          }
        }
        ed.renderOptions();
        if (moved) ed.changed(); else ed.redraw();
      },
      cancel() {
        if (!ed.float) return;
        ed.float = null;
        this.op = null;
        ed.renderOptions();
        ed.compDirty = true;
        ed.redraw();
      },
      leave() { this.op = null; this.apply(); },
      enter() { if (ed.float && ed.float.transform) { this.apply(); return true; } return false; },
      nudge(dx, dy) {
        if (ed.float && ed.float.transform) { ed.float.st.cx += dx; ed.float.st.cy += dy; ed.float.moved = true; ed.redraw(); return; }
        if (!this.begin(false)) return;
        ed.float.st.cx += dx;
        ed.float.st.cy += dy;
        ed.float.moved = true;
        this.apply();
      },
      // The point in the transform box's own frame, relative to its center.
      local(p, s) {
        const dx = p.x - s.cx, dy = p.y - s.cy, c = Math.cos(-s.a), si = Math.sin(-s.a);
        return { x: dx * c - dy * si, y: dx * si + dy * c };
      },
      hit(p) {
        const f = ed.float;
        if (!f || !f.transform) return null;
        const s = f.st;
        const q = this.local(p, s);
        const tol = 8 / ed.view.zoom;
        for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
          if (!sx && !sy) continue;
          if (Math.abs(q.x - sx * s.w / 2) < tol && Math.abs(q.y - sy * s.h / 2) < tol) return { kind: 'scale', sx, sy };
        }
        if (Math.abs(q.x) <= s.w / 2 && Math.abs(q.y) <= s.h / 2) return { kind: 'move' };
        return { kind: 'rotate' };
      },
      cursorAt(p) {
        const h = this.hit(p);
        if (!h) return 'move';
        if (h.kind === 'rotate') return 'alias';
        if (h.kind === 'move') return 'move';
        const ang = ((Math.atan2(h.sy, h.sx) + ed.float.st.a) * 180 / Math.PI + 360) % 180;
        return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(ang / 45) % 4];
      },
      down(p) {
        const f = ed.float;
        if (f && f.transform) {
          this.op = { ...this.hit(p), p0: p, s0: { ...f.st } };
          return;
        }
        if (!this.begin(false)) { this.op = null; return; }
        this.op = { kind: 'move', p0: p, s0: { ...ed.float.st }, plain: true };
      },
      move(p, e) {
        const f = ed.float, op = this.op;
        if (!f || !op) return;
        const s0 = op.s0, s = f.st;
        if (op.kind === 'move') {
          let dx = p.x - op.p0.x, dy = p.y - op.p0.y;
          if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
          s.cx = s0.cx + Math.round(dx);
          s.cy = s0.cy + Math.round(dy);
          f.moved = true;
        } else if (op.kind === 'rotate') {
          let a = s0.a + Math.atan2(p.y - s0.cy, p.x - s0.cx) - Math.atan2(op.p0.y - s0.cy, op.p0.x - s0.cx);
          if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          s.a = a;
        } else if (op.kind === 'scale') {
          const q = this.local(p, s0);
          const fx = -op.sx * s0.w / 2, fy = -op.sy * s0.h / 2;
          let w = op.sx ? Math.max(1, op.sx * (q.x - fx)) : s0.w;
          let h = op.sy ? Math.max(1, op.sy * (q.y - fy)) : s0.h;
          if (e.shiftKey) {
            const k = op.sx && op.sy ? Math.max(w / s0.w, h / s0.h) : op.sx ? w / s0.w : h / s0.h;
            w = Math.max(1, s0.w * k); h = Math.max(1, s0.h * k);
          }
          const lx = op.sx ? fx + op.sx * w / 2 : 0, ly = op.sy ? fy + op.sy * h / 2 : 0;
          const c = Math.cos(s0.a), si = Math.sin(s0.a);
          s.w = w; s.h = h;
          s.cx = s0.cx + lx * c - ly * si;
          s.cy = s0.cy + lx * si + ly * c;
        }
      },
      up() {
        const op = this.op;
        this.op = null;
        if (op && op.plain) this.apply();
      },
      overlay(ctx) {
        const f = ed.float;
        if (!f || !f.transform) return;
        const s = f.st, z = ed.view.zoom;
        const c = ed.toScreen({ x: s.cx, y: s.cy });
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(s.a);
        const w = s.w * z, h = s.h * z;
        ctx.strokeStyle = '#1c7ed6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) if (sx || sy) handle(ctx, { x: sx * w / 2, y: sy * h / 2 });
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        const deg = Math.round(((s.a * 180 / Math.PI) % 360 + 540) % 360 - 180);
        ctx.fillText(`${Math.round(s.w)} × ${Math.round(s.h)}${deg ? `  ${deg}°` : ''}`, c.x - w / 2, c.y - h / 2 - 10);
        ctx.restore();
      },
    };

    // ── View ───────────────────────────────────────────────────────────
    tools.hand = { id: 'hand', icon: '✋', key: 'h', cursor: 'grab', hint: 'mp_hint_hand', down() {}, move() {} };
    tools.zoom = {
      id: 'zoom', icon: '🔍', key: 'z', hint: 'mp_hint_zoom',
      fields: () => [
        { type: 'button', act: 'fit', label: 'mp_zoom_fit' },
        { type: 'button', act: '100', label: 'mp_zoom_actual' },
      ],
      action(a) { if (a === 'fit') ed.zoomFit(); else ed.zoomTo(1); },
      cursorAt: () => 'zoom-in',
      down(p, e) { const s = ed.toScreen(p); ed.zoomStep(e.altKey ? -1 : 1, s.x, s.y); },
      move() {},
    };

    const order = ['move', 'marquee', 'ellipse', 'lasso', 'wand', 'crop', 'picker', 'brush', 'pencil', 'eraser', 'bucket', 'gradient', 'shape', 'text', 'hand', 'zoom'];
    const list = order.map(id => tools[id]);
    return {
      list,
      byId: tools,
      text: tools.text,
      crop: tools.crop,
      move: tools.move,
      floatCanvas: tools.floatCanvas,
      // Stops whatever is half done: a stroke, a move, a transform, a crop
      // box or a text being typed.
      cancelAll() {
        for (const tl of list) if (tl.cancel) tl.cancel();
        ed.drag = null;
        ed.paint = null;
        if (ed.float) { ed.float = null; ed.compDirty = true; }
        tools.move.op = null;
        ed.redraw();
      },
    };
  }

  window.MvmPhotoTools = { create };
})();
