// mvmOffice — the table grid. One component in two modes:
//   'sheet'  a data sheet: thousands of rows, drawn only where visible
//   'embed'  a table inside a text page: a real HTML table that grows with
//            its text, with its letters and numbers shown while it is in use
// Both keep the same selection, editing, clipboard and formula picking, so a
// table behaves the same wherever it is.
(function () {
  if (window.MvmOfficeGrid) return;
  const F = window.MvmOfficeFormula;
  const M = window.MvmOfficeModel;

  const RH = 24;          // sheet row height
  const HH = 24;          // column header height
  const RW = 48;          // row header width
  const SHEET_COL_W = 100;
  const EMBED_COL_W = 120;
  const MIN_COL_W = 30;

  const key = (r, c) => r + ',' + c;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // A value typed or pasted into a cell: kept in the plain form every reader
  // understands (1234.5, 2026-04-03), with the format it asks for when the
  // cell has none yet.
  function typedCell(old, v) {
    const next = Object.assign({}, old || {});
    if (v === '' || v == null) { delete next.v; return next; }
    if (typeof v === 'string' && v.startsWith('=')) { next.v = F.closeParens(v); return next; }
    const r = F.fromInput(v);
    next.v = r.v;
    if (r.fmt && !next.f) next.f = r.fmt;
    return next;
  }

  // ── Formula picking ──────────────────────────────────────────────────────
  // While a formula is being typed — in a cell, in the formula bar or in the
  // text — clicking cells of any table inserts a reference to them instead of
  // leaving the formula, as in Excel.
  class PickTarget {
    constructor(input, ctxTable, onChange) {
      this.input = input;
      this.ctxTable = ctxTable;
      this.onChange = onChange;
      this.span = null;
      this.cur = null;
      // Typing ends the reference being picked, and with it its outline.
      input.addEventListener('input', () => this.clearMark());
    }
    canInsert() {
      const el = this.input;
      const v = el.value;
      const requireEq = this.ctxTable !== undefined && !this.inline;
      if (requireEq && !v.startsWith('=')) return false;
      const pos = el.selectionStart;
      if (this.span && this.span.e === pos && el.selectionEnd === pos) return true;
      const before = v.slice(0, pos).replace(/\s+$/, '');
      if (!before) return !!this.inline;
      return /[=(,;+\-*/^&<>:]$/.test(before);
    }
    begin() {
      const pos = this.input.selectionStart;
      if (!(this.span && this.span.e === pos)) { this.span = { s: pos, e: this.input.selectionEnd }; this.clearMark(); }
    }
    // Outline the block just picked in `grid`; arrow keys carry on from it.
    mark(grid, ar, ac, r, c) {
      if (this.cur && this.cur.grid !== grid && !this.cur.grid.destroyed) this.cur.grid.showPick(null);
      this.cur = { grid, ar, ac, r, c };
      grid.showPick(this.cur);
    }
    clearMark() {
      if (this.cur && !this.cur.grid.destroyed) this.cur.grid.showPick(null);
      this.cur = null;
    }
    update(text) {
      const el = this.input;
      const v = el.value;
      el.value = v.slice(0, this.span.s) + text + v.slice(this.span.e);
      this.span.e = this.span.s + text.length;
      el.setSelectionRange(this.span.e, this.span.e);
      if (this.onChange) this.onChange();
    }
    // Text reference to a block of cells in `table`, as seen from here.
    refText(table, r1, c1, r2, c2, wholeColumn) {
      const same = this.ctxTable && this.ctxTable.id === table.id;
      if (wholeColumn) {
        const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
        const head = lo === hi ? table.cells[key(0, lo)] : null;
        if (head && head.v != null && String(head.v).trim() && !String(head.v).startsWith('=') && !/[\[\]]/.test(head.v)) {
          return F.quoteName(table.name) + '[' + String(head.v).trim() + ']';
        }
        return (same ? '' : F.quoteName(table.name) + '!') + F.colName(lo) + ':' + F.colName(hi);
      }
      const pre = same ? '' : F.quoteName(table.name) + '!';
      const a = F.cellText(Math.min(r1, r2), Math.min(c1, c2));
      if (r1 === r2 && c1 === c2) return pre + a;
      return pre + a + ':' + F.cellText(Math.max(r1, r2), Math.max(c1, c2));
    }
  }

  class Grid {
    constructor(host, opts) {
      this.office = opts.office;
      this.table = opts.table;
      this.mode = opts.mode;
      this.host = host;
      this.sel = { ar: 0, ac: 0, r: 0, c: 0 };
      this.editing = null;
      this.active = false;
      this.destroyed = false;
      this.build();
      this.render();
    }

    get t() { return this.office.t; }
    colW(c) { return this.table.colW[c] || (this.mode === 'sheet' ? SHEET_COL_W : EMBED_COL_W); }

    // ── DOM ────────────────────────────────────────────────────────────────
    build() {
      const root = document.createElement('div');
      root.className = 'mo-grid ' + (this.mode === 'sheet' ? 'mo-grid-sheet' : 'mo-grid-embed');
      this.root = root;
      if (this.mode === 'sheet') {
        root.innerHTML = `
          <div class="mo-gs-inner">
            <div class="mo-gs-colhdr"><div class="mo-gs-corner"></div><div class="mo-gs-colcells"></div></div>
            <div class="mo-gs-body"><div class="mo-gs-rowhdr"></div><div class="mo-gs-cells"></div>
              <div class="mo-sel"></div><div class="mo-act"></div></div>
          </div>`;
        this.inner = root.querySelector('.mo-gs-inner');
        this.layer = root.querySelector('.mo-gs-body');
        this.cellsEl = root.querySelector('.mo-gs-cells');
        this.rowHdr = root.querySelector('.mo-gs-rowhdr');
        this.colHdr = root.querySelector('.mo-gs-colcells');
        root.addEventListener('scroll', () => this.scheduleDraw());
        this._ro = new ResizeObserver(() => this.scheduleDraw());
        this._ro.observe(root);
      } else {
        root.innerHTML = `
          <div class="mo-ge-bar"></div>
          <div class="mo-ge-scroll"><div class="mo-ge-wrap"><table class="mo-ge-table"></table>
            <div class="mo-sel"></div><div class="mo-act"></div></div></div>`;
        this.bar = root.querySelector('.mo-ge-bar');
        this.layer = root.querySelector('.mo-ge-wrap');
        this.tableEl = root.querySelector('.mo-ge-table');
        this.bar.addEventListener('mousedown', e => this.onBarMouseDown(e));
      }
      this.selEl = this.layer.querySelector('.mo-sel');
      this.actEl = this.layer.querySelector('.mo-act');

      // The focus holder: receives keys, clipboard events and typed text.
      const kbd = document.createElement('textarea');
      kbd.className = 'mo-kbd';
      kbd.setAttribute('aria-label', this.table.name);
      kbd.spellcheck = false;
      this.layer.appendChild(kbd);
      this.kbd = kbd;
      kbd.addEventListener('keydown', e => this.onKey(e));
      kbd.addEventListener('input', () => {
        if (this.editing || !kbd.value) return;
        const text = kbd.value;
        kbd.value = '';
        this.startEdit(text, 'enter');
      });
      kbd.addEventListener('copy', e => this.onCopy(e, false));
      kbd.addEventListener('cut', e => this.onCopy(e, true));
      kbd.addEventListener('paste', e => this.onPaste(e));
      kbd.addEventListener('focus', () => this.office.activate(this));

      root.addEventListener('mousedown', e => this.onMouseDown(e));
      root.addEventListener('dblclick', e => this.onDblClick(e));
      root.addEventListener('contextmenu', e => this.onContextMenu(e));
      this.host.appendChild(root);
    }

    destroy() {
      this.destroyed = true;
      if (this._ro) this._ro.disconnect();
      if (this.office.activeGrid === this) this.office.activate(null);
      this.root.remove();
    }

    setActive(on) {
      if (this.active === on) return;
      this.active = on;
      this.root.classList.toggle('active', on);
      if (!on && this.editing) this.commitEdit(null);
      if (this.mode === 'embed') this.render();
      else this.drawSelection();
    }

    focus() { this.kbd.focus({ preventScroll: true }); }

    // ── Rendering ──────────────────────────────────────────────────────────
    render() {
      if (this.destroyed) return;
      if (this.mode === 'sheet') this.renderSheet();
      else this.renderEmbed();
      this.drawSelection();
    }
    refresh() { this.render(); }

    cellContent(r, c) {
      const t = this.table;
      const cell = t.cells[key(r, c)];
      const eng = this.office.engine;
      const v = eng.value(t, r, c);
      const text = eng.display(t, r, c);
      let cls = 'mo-c';
      let align = cell && cell.a;
      if (!align) {
        if (F.isErr(v) || typeof v === 'boolean') align = 'center';
        else if (typeof v === 'number') align = 'right';
      }
      if (F.isErr(v)) cls += ' mo-err';
      if (align) cls += ' mo-a-' + align;
      let style = '';
      if (cell) {
        if (cell.b) cls += ' mo-b';
        if (cell.i) cls += ' mo-i';
        if (cell.u) cls += ' mo-u';
        if (cell.s) cls += ' mo-s';
        if (cell.bg) style += 'background:' + cell.bg + ';';
        if (cell.fg) style += 'color:' + cell.fg + ';';
      }
      return { cls, style, text };
    }

    colX(c) {
      if (!this._colX || this._colXVer !== this._layoutVer) this.buildColX();
      return this._colX[c];
    }
    buildColX() {
      const xs = new Array(this.table.cols + 1);
      let x = 0;
      for (let c = 0; c < this.table.cols; c++) { xs[c] = x; x += this.colW(c); }
      xs[this.table.cols] = x;
      this._colX = xs;
      this._colXVer = this._layoutVer;
    }
    colAt(x) {
      const xs = this._colX;
      let lo = 0, hi = this.table.cols - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    scheduleDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; if (!this.destroyed) this.renderSheet(); });
    }

    renderSheet() {
      const t = this.table;
      this._layoutVer = (this._layoutVer || 0) + 1;
      this.buildColX();
      const totalW = this._colX[t.cols];
      const totalH = t.rows * RH;
      this.inner.style.width = (RW + totalW) + 'px';
      this.inner.style.height = (HH + totalH) + 'px';
      this.layer.style.height = totalH + 'px';
      this.layer.style.width = (RW + totalW) + 'px';

      const root = this.root;
      const vw = root.clientWidth, vh = root.clientHeight;
      const sx = root.scrollLeft, sy = root.scrollTop;
      const r0 = Math.max(0, Math.floor(sy / RH) - 2);
      const r1 = Math.min(t.rows - 1, Math.ceil((sy + vh) / RH) + 2);
      const c0 = Math.max(0, this.colAt(Math.max(0, sx - RW)) - 1);
      const c1 = Math.min(t.cols - 1, this.colAt(sx + vw) + 1);
      this.visible = { r0, r1, c0, c1 };

      let hdr = '';
      for (let c = c0; c <= c1; c++) {
        hdr += `<div class="mo-hc" data-hc="${c}" style="left:${this._colX[c]}px;width:${this.colW(c)}px">${F.colName(c)}<span class="mo-rsz" data-rsz="${c}"></span></div>`;
      }
      this.colHdr.innerHTML = hdr;
      let rows = '';
      for (let r = r0; r <= r1; r++) rows += `<div class="mo-hr" data-hr="${r}" style="top:${r * RH}px">${r + 1}</div>`;
      this.rowHdr.innerHTML = rows;

      let cells = '';
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = this.cellContent(r, c);
          cells += `<div class="${x.cls}" data-r="${r}" data-c="${c}" style="left:${this._colX[c]}px;top:${r * RH}px;width:${this.colW(c)}px;${x.style}">${esc(x.text)}</div>`;
        }
      }
      this.cellsEl.innerHTML = cells;
      this.drawSelection();
    }

    renderEmbed() {
      const t = this.table;
      const show = this.active;
      let html = '<colgroup>' + (show ? `<col style="width:${RW - 12}px">` : '');
      let w = show ? RW - 12 : 0;
      for (let c = 0; c < t.cols; c++) { html += `<col style="width:${this.colW(c)}px">`; w += this.colW(c); }
      html += '</colgroup>';
      if (show) {
        html += '<thead><tr><th class="mo-corner"></th>';
        for (let c = 0; c < t.cols; c++) html += `<th class="mo-hc" data-hc="${c}">${F.colName(c)}<span class="mo-rsz" data-rsz="${c}"></span></th>`;
        html += '</tr></thead>';
      }
      html += '<tbody>';
      for (let r = 0; r < t.rows; r++) {
        html += `<tr${r === 0 && t.header ? ' class="mo-head-row"' : ''}>`;
        if (show) html += `<th class="mo-hr" data-hr="${r}">${r + 1}</th>`;
        for (let c = 0; c < t.cols; c++) {
          const x = this.cellContent(r, c);
          html += `<td class="${x.cls}" data-r="${r}" data-c="${c}" style="${x.style}">${esc(x.text) || '&#8203;'}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody>';
      this.tableEl.innerHTML = html;
      this.tableEl.style.width = w + 'px';
      this.bar.innerHTML = show ? `
        <span class="mo-ge-name" data-act="rename" title="${esc(this.t('mo_rename_table'))}">▦ ${esc(t.name)}</span>
        <button data-act="addrow" title="${esc(this.t('mo_add_row'))}">+ ${esc(this.t('mo_row'))}</button>
        <button data-act="addcol" title="${esc(this.t('mo_add_col'))}">+ ${esc(this.t('mo_col'))}</button>
        <button data-act="header" class="${t.header ? 'on' : ''}" title="${esc(this.t('mo_header_row_hint'))}">${esc(this.t('mo_header_row'))}</button>
        <button data-act="xlsx" title="${esc(this.t('mo_export_table_xlsx'))}">⬇ xlsx</button>
        <button data-act="delete" class="mo-danger" title="${esc(this.t('mo_delete_table'))}">🗑</button>` : '';
    }

    // Position of a cell inside this.layer.
    cellRect(r, c) {
      if (this.mode === 'sheet') {
        return { x: RW + this.colX(c), y: r * RH, w: this.colW(c), h: RH };
      }
      const td = this.tableEl.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
      if (!td) return { x: 0, y: 0, w: 0, h: 0 };
      const lr = this.layer.getBoundingClientRect();
      const cr = td.getBoundingClientRect();
      return { x: cr.left - lr.left, y: cr.top - lr.top, w: cr.width, h: cr.height };
    }

    selRect() {
      const s = this.sel;
      return { r1: Math.min(s.ar, s.r), r2: Math.max(s.ar, s.r), c1: Math.min(s.ac, s.c), c2: Math.max(s.ac, s.c) };
    }

    // The dashed outline of cells being picked into a formula.
    showPick(p) {
      this._pick = p;
      if (!p) { if (this.pickEl) this.pickEl.style.display = 'none'; return; }
      if (!this.pickEl) {
        this.pickEl = document.createElement('div');
        this.pickEl.className = 'mo-pick';
        this.layer.appendChild(this.pickEl);
      }
      const a = this.cellRect(Math.min(p.ar, p.r), Math.min(p.ac, p.c));
      const b = this.cellRect(Math.max(p.ar, p.r), Math.max(p.ac, p.c));
      Object.assign(this.pickEl.style, { display: '', left: a.x + 'px', top: a.y + 'px', width: (b.x + b.w - a.x) + 'px', height: (b.y + b.h - a.y) + 'px' });
    }
    drawSelection() {
      if (!this.selEl) return;
      if (this._pick) this.showPick(this._pick);
      const show = this.active || this.mode === 'sheet';
      this.selEl.style.display = show ? '' : 'none';
      this.actEl.style.display = show ? '' : 'none';
      if (!show) return;
      const { r1, r2, c1, c2 } = this.selRect();
      const a = this.cellRect(r1, c1), b = this.cellRect(r2, c2);
      Object.assign(this.selEl.style, { left: a.x + 'px', top: a.y + 'px', width: (b.x + b.w - a.x) + 'px', height: (b.y + b.h - a.y) + 'px' });
      this.selEl.classList.toggle('multi', r1 !== r2 || c1 !== c2);
      const c = this.cellRect(this.sel.r, this.sel.c);
      Object.assign(this.actEl.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
      Object.assign(this.kbd.style, { left: c.x + 'px', top: c.y + 'px' });
      if (this.mode === 'sheet') {
        this.root.querySelectorAll('.mo-hc.sel,.mo-hr.sel').forEach(el => el.classList.remove('sel'));
        this.root.querySelectorAll('.mo-hc').forEach(el => { const i = +el.dataset.hc; if (i >= c1 && i <= c2) el.classList.add('sel'); });
        this.root.querySelectorAll('.mo-hr').forEach(el => { const i = +el.dataset.hr; if (i >= r1 && i <= r2) el.classList.add('sel'); });
      }
    }

    scrollToActive() {
      if (this.mode !== 'sheet') return;
      const root = this.root;
      const rc = this.cellRect(this.sel.r, this.sel.c);
      const top = rc.y, bottom = rc.y + rc.h + HH;
      if (top < root.scrollTop) root.scrollTop = top;
      else if (bottom > root.scrollTop + root.clientHeight) root.scrollTop = bottom - root.clientHeight;
      const left = rc.x - RW, right = rc.x + rc.w;
      if (left < root.scrollLeft) root.scrollLeft = left;
      else if (right > root.scrollLeft + root.clientWidth) root.scrollLeft = right - root.clientWidth;
    }

    // ── Selection ──────────────────────────────────────────────────────────
    select(r, c, extend) {
      const t = this.table;
      if (this.mode === 'sheet') {
        if (r >= t.rows && t.rows < M.MAX_ROWS) this.office.growTable(t, Math.min(M.MAX_ROWS, r + 100), t.cols);
        if (c >= t.cols && t.cols < M.MAX_COLS) this.office.growTable(t, t.rows, Math.min(M.MAX_COLS, c + 5));
      }
      r = Math.max(0, Math.min(t.rows - 1, r));
      c = Math.max(0, Math.min(t.cols - 1, c));
      if (extend) { this.sel.r = r; this.sel.c = c; }
      else this.sel = { ar: r, ac: c, r, c };
      this.scrollToActive();
      this.drawSelection();
      this.office.onSelect(this);
    }
    selectAll() {
      this.sel = { ar: 0, ac: 0, r: this.table.rows - 1, c: this.table.cols - 1 };
      this.drawSelection();
      this.office.onSelect(this);
    }
    activeCell() { return this.table.cells[key(this.sel.r, this.sel.c)] || null; }
    activeRaw() { const c = this.activeCell(); return c && c.v != null ? String(c.v) : ''; }
    // The active cell as this person would type it: 1234,5 or 03.04.2026.
    activeText() { return F.editText(this.activeRaw()); }
    address() {
      const { r1, r2, c1, c2 } = this.selRect();
      const a = F.cellText(r1, c1);
      return r1 === r2 && c1 === c2 ? a : a + ':' + F.cellText(r2, c2);
    }

    // ── Mouse ──────────────────────────────────────────────────────────────
    hit(target) {
      const cell = target.closest('[data-r]');
      if (cell && this.root.contains(cell)) return { r: +cell.dataset.r, c: +cell.dataset.c };
      const hc = target.closest('[data-hc]');
      if (hc && this.root.contains(hc)) return { col: +hc.dataset.hc };
      const hr = target.closest('[data-hr]');
      if (hr && this.root.contains(hr)) return { row: +hr.dataset.hr };
      return null;
    }
    onMouseDown(e) {
      if (e.button !== 0 && e.button !== 2) return;
      const rsz = e.target.closest('[data-rsz]');
      if (rsz && e.button === 0) { this.startResize(e, +rsz.dataset.rsz); return; }
      const h = this.hit(e.target);
      if (!h) {
        if (this.mode === 'sheet' && e.target.closest('.mo-gs-corner')) { e.preventDefault(); this.focus(); this.selectAll(); }
        return;
      }

      const pick = this.office.pick;
      if (pick && e.button === 0 && pick.grid !== this && pick.canInsert()) {
        e.preventDefault();
        this.pickDrag(e, h, pick);
        return;
      }
      if (pick && e.button === 0 && pick.grid === this && this.editing && pick.canInsert()) {
        e.preventDefault();
        this.pickDrag(e, h, pick);
        return;
      }
      if (this.editing) this.commitEdit(null);

      if (e.button === 2) {
        // Right click keeps a selection it lands in.
        const { r1, r2, c1, c2 } = this.selRect();
        const inside = h.r != null ? (h.r >= r1 && h.r <= r2 && h.c >= c1 && h.c <= c2)
          : h.col != null ? (h.col >= c1 && h.col <= c2 && r1 === 0 && r2 === this.table.rows - 1)
          : (h.row >= r1 && h.row <= r2 && c1 === 0 && c2 === this.table.cols - 1);
        if (!inside) this.selectHit(h, false);
        e.preventDefault();
        this.focus();
        return;
      }
      e.preventDefault();
      this.focus();
      this.selectHit(h, e.shiftKey);
      const move = ev => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const hh = el && this.hit(el);
        if (!hh) return;
        if (h.r != null && hh.r != null) this.select(hh.r, hh.c, true);
        else if (h.col != null && hh.col != null) { this.sel.c = hh.col; this.drawSelection(); this.office.onSelect(this); }
        else if (h.row != null && hh.row != null) { this.sel.r = hh.row; this.drawSelection(); this.office.onSelect(this); }
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    selectHit(h, extend) {
      const t = this.table;
      if (h.r != null) { this.select(h.r, h.c, extend); return; }
      if (h.col != null) {
        if (extend) this.sel = { ar: 0, ac: this.sel.ac, r: t.rows - 1, c: h.col };
        else this.sel = { ar: 0, ac: h.col, r: t.rows - 1, c: h.col };
      } else {
        if (extend) this.sel = { ar: this.sel.ar, ac: 0, r: h.row, c: t.cols - 1 };
        else this.sel = { ar: h.row, ac: 0, r: h.row, c: t.cols - 1 };
      }
      // The active cell of a whole column/row is its first cell.
      this.drawSelection();
      this.office.onSelect(this);
    }
    pickDrag(e, h, pick) {
      // Shift+click stretches the block picked last in this table.
      const cur = pick.cur;
      const stretch = e.shiftKey && h.r != null && cur && cur.grid === this && pick.span && pick.span.e === pick.input.selectionStart;
      pick.begin();
      const start = stretch ? { r: cur.ar, c: cur.ac } : h;
      const apply = hh => {
        const last = this.table.rows - 1, lastC = this.table.cols - 1;
        if (start.col != null) {
          const c2 = hh.col != null ? hh.col : hh.c != null ? hh.c : start.col;
          pick.update(pick.refText(this.table, 0, start.col, 0, c2, true));
          pick.mark(this, 0, start.col, last, c2);
        } else if (start.r != null && hh.r != null) {
          pick.update(pick.refText(this.table, start.r, start.c, hh.r, hh.c, false));
          pick.mark(this, start.r, start.c, hh.r, hh.c);
        } else if (start.row != null) {
          const r2 = hh.row != null ? hh.row : start.row;
          pick.update(pick.refText(this.table, start.row, 0, r2, lastC, false));
          pick.mark(this, start.row, 0, r2, lastC);
        }
      };
      apply(h);
      const move = ev => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const hh = el && this.hit(el);
        if (hh) apply(hh);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        pick.input.focus();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    startResize(e, c) {
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX, w0 = this.colW(c);
      const move = ev => {
        this.table.colW[c] = Math.max(MIN_COL_W, Math.round(w0 + ev.clientX - x0));
        this.render();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.office.changed({ layoutOnly: true });
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    onDblClick(e) {
      const rsz = e.target.closest('[data-rsz]');
      if (rsz) { this.autoFit(+rsz.dataset.rsz); return; }
      const h = this.hit(e.target);
      if (h && h.r != null) { this.select(h.r, h.c, false); this.startEdit(null, 'edit'); }
    }
    autoFit(c) {
      // Measure the widest shown text in the column.
      const probe = document.createElement('span');
      probe.className = 'mo-measure';
      this.root.appendChild(probe);
      let w = MIN_COL_W;
      const used = Math.min(this.table.rows, 2000);
      for (let r = 0; r < used; r++) {
        if (!this.table.cells[key(r, c)]) continue;
        probe.textContent = this.office.engine.display(this.table, r, c);
        w = Math.max(w, probe.offsetWidth + 14);
      }
      probe.remove();
      this.table.colW[c] = Math.min(600, w);
      this.render();
      this.office.changed({ layoutOnly: true });
    }
    onBarMouseDown(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.preventDefault();
      this.office.embedAction(this, b.dataset.act);
    }
    onContextMenu(e) {
      const h = this.hit(e.target);
      if (!h) return;
      e.preventDefault();
      this.office.gridMenu(this, e.clientX, e.clientY, h);
    }

    // ── Keyboard ───────────────────────────────────────────────────────────
    onKey(e) {
      if (this.editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = this.sel;
      const shift = e.shiftKey;
      const k = e.key;
      const moveTo = (r, c) => { e.preventDefault(); this.select(r, c, shift); };
      if (mod && !e.altKey) {
        const lk = k.toLowerCase();
        if (lk === 'z') { e.preventDefault(); shift ? this.office.redo() : this.office.undo(); return; }
        if (lk === 'y') { e.preventDefault(); this.office.redo(); return; }
        if (lk === 'a') { e.preventDefault(); this.selectAll(); return; }
        if (lk === 'b' || lk === 'i' || lk === 'u') { e.preventDefault(); this.toggleStyle(lk); return; }
        if (k === 'ArrowDown') return moveTo(this.edge(s.r, s.c, 1, 0), s.c);
        if (k === 'ArrowUp') return moveTo(this.edge(s.r, s.c, -1, 0), s.c);
        if (k === 'ArrowRight') return moveTo(s.r, this.edge(s.r, s.c, 0, 1));
        if (k === 'ArrowLeft') return moveTo(s.r, this.edge(s.r, s.c, 0, -1));
        if (k === 'Home') return moveTo(0, 0);
        return;
      }
      switch (k) {
        case 'ArrowDown': return moveTo(s.r + 1, s.c);
        case 'ArrowUp': return moveTo(s.r - 1, s.c);
        case 'ArrowRight': return moveTo(s.r, s.c + 1);
        case 'ArrowLeft': return moveTo(s.r, s.c - 1);
        case 'Home': return moveTo(s.r, 0);
        case 'End': return moveTo(s.r, this.edge(s.r, 0, 0, 1));
        case 'PageDown': return moveTo(s.r + Math.max(1, Math.floor(this.root.clientHeight / RH) - 1), s.c);
        case 'PageUp': return moveTo(s.r - Math.max(1, Math.floor(this.root.clientHeight / RH) - 1), s.c);
        case 'Tab':
          e.preventDefault();
          this.advance(shift ? -1 : 1, 'col');
          return;
        case 'Enter':
          e.preventDefault();
          this.advance(shift ? -1 : 1, 'row');
          return;
        case 'F2':
          e.preventDefault();
          this.startEdit(null, 'edit');
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          this.clearSelection();
          return;
        case 'Escape':
          if (this.mode === 'embed') { e.preventDefault(); this.office.leaveEmbed(this); }
          return;
      }
    }
    // Enter/Tab move inside a selected block, as in Excel; Tab on the last
    // cell of an embedded table adds a row, as in Word.
    advance(dir, axis) {
      const s = this.sel;
      const { r1, r2, c1, c2 } = this.selRect();
      const block = r1 !== r2 || c1 !== c2;
      if (!block) {
        if (axis === 'col') {
          if (this.mode === 'embed' && dir > 0 && s.c === this.table.cols - 1) {
            if (s.r === this.table.rows - 1) this.office.structural(this.table, 'r', this.table.rows, 1);
            this.select(s.r + 1, 0, false);
            return;
          }
          this.select(s.r, s.c + dir, false);
        } else {
          this.select(s.r + dir, s.c, false);
        }
        return;
      }
      let r = s.r, c = s.c;
      if (axis === 'col') {
        c += dir;
        if (c > c2) { c = c1; r++; } else if (c < c1) { c = c2; r--; }
        if (r > r2) r = r1; else if (r < r1) r = r2;
      } else {
        r += dir;
        if (r > r2) { r = r1; c++; } else if (r < r1) { r = r2; c--; }
        if (c > c2) c = c1; else if (c < c1) c = c2;
      }
      this.sel.r = r; this.sel.c = c;
      this.drawSelection();
      this.office.onSelect(this);
    }
    // Ctrl+arrow: to the edge of the current block of data.
    edge(r, c, dr, dc) {
      const t = this.table;
      const filled = (rr, cc) => { const x = t.cells[key(rr, cc)]; return !!(x && x.v != null && x.v !== ''); };
      const inb = (rr, cc) => rr >= 0 && cc >= 0 && rr < t.rows && cc < t.cols;
      let rr = r + dr, cc = c + dc;
      if (!inb(rr, cc)) return dr ? r : c;
      if (filled(r, c) && filled(rr, cc)) {
        while (inb(rr + dr, cc + dc) && filled(rr + dr, cc + dc)) { rr += dr; cc += dc; }
      } else {
        while (inb(rr, cc) && !filled(rr, cc)) { rr += dr; cc += dc; }
        if (!inb(rr, cc)) { rr -= dr; cc -= dc; }
      }
      return dr ? rr : cc;
    }

    // ── Editing ────────────────────────────────────────────────────────────
    startEdit(initial, mode) {
      if (this.editing) return;
      const r = this.sel.r, c = this.sel.c;
      const rc = this.cellRect(r, c);
      const ed = document.createElement('textarea');
      ed.className = 'mo-cell-editor';
      ed.spellcheck = false;
      ed.value = initial != null ? initial : this.activeText();
      Object.assign(ed.style, { left: rc.x + 'px', top: rc.y + 'px', minWidth: rc.w + 'px', minHeight: rc.h + 'px', width: rc.w + 'px', height: rc.h + 'px' });
      const cell = this.activeCell();
      if (cell && cell.b) ed.style.fontWeight = '700';
      if (cell && cell.i) ed.style.fontStyle = 'italic';
      this.layer.appendChild(ed);
      this.editing = { r, c, el: ed, mode, orig: this.activeText() };
      const pick = new PickTarget(ed, this.table, () => { this.grow(); this.office.onEditInput(this, ed.value); });
      pick.grid = this;
      this.editing.pick = pick;
      this.office.setPick(pick);
      this.editing.assist = this.office.attachAssist(ed, this.table);
      const grow = () => this.grow();
      ed.addEventListener('input', () => { grow(); this.office.onEditInput(this, ed.value); });
      ed.addEventListener('keydown', e => this.onEditKey(e));
      ed.addEventListener('blur', () => {
        // Leaving for the formula bar or a formula suggestion is not leaving.
        setTimeout(() => {
          if (!this.editing || this.editing.el !== ed) return;
          const a = document.activeElement;
          if (a === ed || (a && a.closest && a.closest('.mo-fbar, .mo-assist'))) return;
          this.commitEdit(null);
        }, 0);
      });
      ed.focus({ preventScroll: true });
      const end = ed.value.length;
      ed.setSelectionRange(end, end);
      this.grow();
      this.office.onEditInput(this, ed.value);
    }
    grow() {
      const ed = this.editing && this.editing.el;
      if (!ed) return;
      ed.style.width = 'auto';
      ed.style.width = Math.max(parseFloat(ed.style.minWidth), Math.min(600, ed.scrollWidth + 4)) + 'px';
      ed.style.height = 'auto';
      ed.style.height = Math.max(parseFloat(ed.style.minHeight), ed.scrollHeight) + 'px';
    }
    onEditKey(e) {
      const ed = this.editing;
      if (!ed) return;
      if (ed.assist && ed.assist.handleKey(e)) return;
      const k = e.key;
      if (k === 'Enter' && !e.altKey) { e.preventDefault(); this.commitEdit(e.shiftKey ? 'up' : 'down'); return; }
      if (k === 'Enter' && e.altKey) {
        e.preventDefault();
        const el = ed.el, p = el.selectionStart;
        el.value = el.value.slice(0, p) + '\n' + el.value.slice(el.selectionEnd);
        el.setSelectionRange(p + 1, p + 1);
        this.grow();
        return;
      }
      if (k === 'Tab') { e.preventDefault(); this.commitEdit(e.shiftKey ? 'left' : 'right'); return; }
      if (k === 'Escape') { e.preventDefault(); this.cancelEdit(); return; }
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      // Typing a formula, arrows pick cells instead of moving the cursor,
      // Shift+arrows stretch the pick, as in Excel.
      if (step && ed.mode === 'enter' && !e.altKey && !e.ctrlKey && !e.metaKey && ed.el.value.startsWith('=') && ed.pick.canInsert()) {
        e.preventDefault();
        this.pickStep(step, e.shiftKey);
        return;
      }
      if (ed.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && !ed.el.value.startsWith('=')) {
        e.preventDefault();
        this.commitEdit({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[k]);
      }
    }
    pickStep([dr, dc], extend) {
      const ed = this.editing, pick = ed.pick, t = this.table;
      const going = pick.cur && pick.cur.grid === this && pick.span && pick.span.e === pick.input.selectionStart;
      const cur = going ? Object.assign({}, pick.cur) : { ar: ed.r, ac: ed.c, r: ed.r, c: ed.c };
      cur.r = Math.max(0, Math.min(t.rows - 1, cur.r + dr));
      cur.c = Math.max(0, Math.min(t.cols - 1, cur.c + dc));
      if (!extend) { cur.ar = cur.r; cur.ac = cur.c; }
      pick.begin();
      pick.update(pick.refText(t, cur.ar, cur.ac, cur.r, cur.c, false));
      pick.mark(this, cur.ar, cur.ac, cur.r, cur.c);
      if (this.mode === 'sheet') {
        const rc = this.cellRect(cur.r, cur.c), root = this.root;
        if (rc.y < root.scrollTop) root.scrollTop = rc.y;
        else if (rc.y + rc.h + HH > root.scrollTop + root.clientHeight) root.scrollTop = rc.y + rc.h + HH - root.clientHeight;
        if (rc.x - RW < root.scrollLeft) root.scrollLeft = rc.x - RW;
        else if (rc.x + rc.w > root.scrollLeft + root.clientWidth) root.scrollLeft = rc.x + rc.w - root.clientWidth;
      }
    }
    endEdit() {
      const ed = this.editing;
      if (!ed) return null;
      this.editing = null;
      if (ed.assist) ed.assist.detach();
      if (this.office.pick === ed.pick) this.office.setPick(null);
      ed.el.remove();
      return ed;
    }
    cancelEdit() {
      this.endEdit();
      this.office.onEditInput(this, null);
      this.focus();
    }
    // The formula bar commits through here too.
    commitEdit(dir, value) {
      const ed = this.editing;
      const v = value !== undefined ? value : ed ? ed.el.value : null;
      const r = ed ? ed.r : this.sel.r, c = ed ? ed.c : this.sel.c;
      const orig = ed ? ed.orig : this.activeText();
      this.endEdit();
      if (v != null && v !== orig) this.setRaw(r, c, v);
      this.office.onEditInput(this, null);
      if (dir) {
        const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
        if (dir === 'right' && this.mode === 'embed' && c === this.table.cols - 1) {
          if (r === this.table.rows - 1) this.office.structural(this.table, 'r', this.table.rows, 1);
          this.select(r + 1, 0, false);
        } else this.select(r + d[0], c + d[1], false);
      }
      if (this.office.activeGrid === this) this.focus();
    }
    // `v` is what the person typed.
    setRaw(r, c, v) {
      const k = key(r, c);
      const next = typedCell(this.table.cells[k], v);
      if (typeof v === 'string' && v.startsWith('=')) this.office.formulaHint(v);
      this.office.setCells(this.table, { [k]: Object.keys(next).length ? next : null });
    }

    // ── Changes to the selection ───────────────────────────────────────────
    forSelection(fn) {
      const { r1, r2, c1, c2 } = this.selRect();
      const t = this.table;
      const changes = {};
      // A whole column of a 1000-row sheet: only touch rows in use unless
      // the style has to reach empty cells.
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const k = key(r, c);
          const out = fn(t.cells[k] || null, r, c);
          if (out !== undefined) changes[k] = out;
        }
      }
      if (Object.keys(changes).length) this.office.setCells(t, changes);
    }
    clearSelection() {
      this.forSelection(cell => {
        if (!cell || cell.v == null) return undefined;
        const next = Object.assign({}, cell);
        delete next.v;
        return Object.keys(next).length ? next : null;
      });
    }
    // patch: {b: true}, {a: 'center'}, {f: {...}}; null removes the key.
    applyStyle(patch) {
      this.forSelection(cell => {
        const next = Object.assign({}, cell || {});
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === false) delete next[k]; else next[k] = v;
        }
        if (!cell && !Object.keys(next).length) return undefined;
        return Object.keys(next).length ? next : null;
      });
    }
    toggleStyle(k) {
      const cell = this.activeCell();
      this.applyStyle({ [k]: !(cell && cell[k]) });
    }

    // ── Clipboard ──────────────────────────────────────────────────────────
    onCopy(e, cut) {
      const { r1, r2, c1, c2 } = this.selRect();
      const t = this.table;
      const eng = this.office.engine;
      const text = [], raws = [];
      let html = '<table>';
      for (let r = r1; r <= r2; r++) {
        const row = [], rawRow = [];
        html += '<tr>';
        for (let c = c1; c <= c2; c++) {
          const d = eng.display(t, r, c);
          row.push(d);
          rawRow.push(t.cells[key(r, c)] ? M.clone(t.cells[key(r, c)]) : null);
          html += '<td>' + esc(d) + '</td>';
        }
        html += '</tr>';
        text.push(row);
        raws.push(rawRow);
      }
      html += '</table>';
      const tsv = M.toTSV(text);
      e.preventDefault();
      e.clipboardData.setData('text/plain', tsv);
      e.clipboardData.setData('text/html', html);
      this.office.clip = { tsv, tableId: t.id, r: r1, c: c1, cells: raws, cut };
    }
    onPaste(e) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const html = e.clipboardData.getData('text/html');
      this.pasteText(text, html);
    }
    pasteText(text, html) {
      const t = this.table;
      const clip = this.office.clip;
      const at = this.selRect();
      const changes = {};
      let rows;
      if (clip && text === clip.tsv) {
        // Our own cells: formulas follow, styles come along.
        const dr = at.r1 - clip.r, dc = at.c1 - clip.c;
        rows = clip.cells;
        this.ensureSize(at.r1 + rows.length, at.c1 + rows[0].length);
        rows.forEach((row, i) => row.forEach((cell, j) => {
          let next = cell ? M.clone(cell) : null;
          if (next && typeof next.v === 'string' && next.v.startsWith('=') && !clip.cut) next.v = '=' + M.moveFormula(next.v.slice(1), dr, dc);
          changes[key(at.r1 + i, at.c1 + j)] = next;
        }));
        if (clip.cut) {
          // Cut: the source cells empty out; where source and target overlap
          // in the same table, the pasted cells win.
          this.office.clip = null;
          const src = this.office.doc.tables[clip.tableId];
          if (src) {
            const cleared = {};
            rows.forEach((row, i) => row.forEach((_, j) => { cleared[key(clip.r + i, clip.c + j)] = null; }));
            if (src === t) {
              this.office.setCells(t, Object.assign(cleared, changes));
              this.afterPaste(at, rows);
              return;
            }
            this.office.setCells(src, cleared);
          }
        }
      } else {
        if (html && /<table/i.test(html) && !text) {
          const div = document.createElement('div');
          div.innerHTML = html;
          const tbl = div.querySelector('table');
          rows = tbl ? M.cellsFromHtmlTable(tbl) : [['']];
        } else {
          rows = M.parseTSV(text || '');
        }
        const single = rows.length === 1 && rows[0].length === 1;
        if (single && (at.r1 !== at.r2 || at.c1 !== at.c2)) {
          // One value into a block fills the block.
          for (let r = at.r1; r <= at.r2; r++) for (let c = at.c1; c <= at.c2; c++) {
            const old = t.cells[key(r, c)];
            changes[key(r, c)] = typedCell(old, rows[0][0]);
          }
          this.office.setCells(t, changes);
          return;
        }
        this.ensureSize(at.r1 + rows.length, at.c1 + Math.max(...rows.map(r => r.length)));
        rows.forEach((row, i) => row.forEach((v, j) => {
          const k = key(at.r1 + i, at.c1 + j);
          const old = t.cells[k];
          const next = typedCell(old, v);
          changes[k] = Object.keys(next).length ? next : null;
        }));
      }
      this.office.setCells(t, changes);
      this.afterPaste(at, rows);
    }
    afterPaste(at, rows) {
      this.sel = { ar: at.r1, ac: at.c1, r: Math.min(this.table.rows - 1, at.r1 + rows.length - 1), c: Math.min(this.table.cols - 1, at.c1 + rows[0].length - 1) };
      this.drawSelection();
      this.office.onSelect(this);
    }
    ensureSize(rows, cols) {
      const t = this.table;
      if (rows <= t.rows && cols <= t.cols) return;
      if (this.mode === 'sheet') this.office.growTable(t, Math.max(t.rows, rows), Math.max(t.cols, cols));
      else {
        if (rows > t.rows) this.office.structural(t, 'r', t.rows, rows - t.rows);
        if (cols > t.cols) this.office.structural(t, 'c', t.cols, cols - t.cols);
      }
    }
  }

  window.MvmOfficeGrid = { Grid, PickTarget, typedCell, RH, HH, RW };
})();
