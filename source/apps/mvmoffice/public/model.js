// mvmOffice — the document model and every change that has to rewrite
// formulas: renaming a table, inserting or deleting rows and columns, and
// pasting cells somewhere else.
//
// A document:
//   { format: 'mvmoffice', version: 1, title,
//     pages:  [{ id, title, content }]         text pages (ProseMirror JSON)
//     sheets: [{ id, tableId }]                the Data part, one table each
//     tables: { id: { id, name, kind: 'sheet'|'embed', rows, cols,
//                     cells: { "r,c": { v, f, b, i, u, s, a, bg, fg } },
//                     colW: { c: px }, header } } }
// A sheet is named after its table; a table embedded in a text page is
// referenced from the page content by its id.
(function () {
  if (window.MvmOfficeModel) return;
  const F = window.MvmOfficeFormula;

  const FORMAT = 'mvmoffice';
  const VERSION = 1;
  const SHEET_ROWS = 1000;
  const SHEET_COLS = 26;
  const MAX_ROWS = 100000;
  const MAX_COLS = 702;   // A … ZZ

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function emptyPageContent() { return { type: 'doc', content: [{ type: 'paragraph' }] }; }

  function newTable(doc, kind, name, rows, cols) {
    const t = {
      id: uid(), name, kind,
      rows: rows || (kind === 'sheet' ? SHEET_ROWS : 3),
      cols: cols || (kind === 'sheet' ? SHEET_COLS : 3),
      cells: {}, colW: {}, header: kind === 'embed',
    };
    doc.tables[t.id] = t;
    return t;
  }

  // Every document starts as one empty page; pages and data sheets are added
  // as needed. Names come from the caller's language.
  function newDoc(names) {
    const doc = { format: FORMAT, version: VERSION, title: names.title, pages: [], sheets: [], tables: {} };
    doc.pages.push({ id: uid(), title: names.page + ' 1', content: emptyPageContent() });
    return doc;
  }

  function addPage(doc, title, at) {
    const p = { id: uid(), title, content: emptyPageContent() };
    if (at == null) doc.pages.push(p); else doc.pages.splice(at, 0, p);
    return p;
  }
  function addSheet(doc, name, at) {
    const t = newTable(doc, 'sheet', name);
    const s = { id: uid(), tableId: t.id };
    if (at == null) doc.sheets.push(s); else doc.sheets.splice(at, 0, s);
    return s;
  }

  // Page setup of the whole document: the sheet it is printed on, its
  // margins in millimetres and where the page number goes. The same numbers
  // lay out the pages on screen, in the print preview and on paper.
  const PAPER = { A4: [210, 297], A5: [148, 210], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
  const MARGINS = { normal: [20, 20, 20, 20], narrow: [12.7, 12.7, 12.7, 12.7], wide: [25.4, 30, 25.4, 30] };  // top right bottom left
  const PAGE_NUMBERS = ['none', 'center', 'right', 'outside'];
  const HEADERS = ['none', 'title', 'chapter', 'book'];
  // What a book starts from: a small page, mirrored margins (the inner one
  // is the wider one, where the pages are bound), the number on the outer
  // edge and the title / chapter running along the top.
  const BOOK_PAGE = { size: 'A5', orient: 'portrait', margins: [20, 16, 22, 20], mirror: true, numbers: 'outside', header: 'book' };
  function normPage(pg) {
    pg = pg && typeof pg === 'object' ? pg : {};
    const size = PAPER[pg.size] ? pg.size : 'A4';
    const orient = pg.orient === 'landscape' ? 'landscape' : 'portrait';
    const [w, h] = orient === 'landscape' ? [PAPER[size][1], PAPER[size][0]] : PAPER[size];
    const m = Array.isArray(pg.margins) && pg.margins.length === 4 ? pg.margins : MARGINS.normal;
    // Margins stay small enough to leave room for the text.
    const clamp = (v, max) => Math.round(Math.max(0, Math.min(max, +v || 0)) * 10) / 10;
    const margins = [clamp(m[0], h / 3), clamp(m[1], w / 3), clamp(m[2], h / 3), clamp(m[3], w / 3)];
    const numbers = PAGE_NUMBERS.includes(pg.numbers) ? pg.numbers : 'none';
    const header = HEADERS.includes(pg.header) ? pg.header : 'none';
    return { size, orient, margins, numbers, mirror: !!pg.mirror, header };
  }
  // The page setup in millimetres, ready for layout.
  function pageBox(doc) {
    const pg = normPage(doc && doc.page);
    const [w, h] = pg.orient === 'landscape' ? [PAPER[pg.size][1], PAPER[pg.size][0]] : PAPER[pg.size];
    const [t, r, b, l] = pg.margins;
    return { w, h, t, r, b, l, numbers: pg.numbers, mirror: pg.mirror, header: pg.header };
  }

  // The kinds of document, the details of the author and the cover. Images
  // live in one table of the document and are referenced by id, so a long
  // text never carries picture data inside it.
  function normMeta(m) {
    m = m && typeof m === 'object' ? m : {};
    const s = (v, n) => String(v == null ? '' : v).slice(0, n);
    return { author: s(m.author, 200), lang: s(m.lang, 20), description: s(m.description, 2000) };
  }
  // A cover is a page of its own, laid out freely: a background colour and
  // items in the order they are stacked — texts, pictures and shapes. x, y
  // and w are shares of the page's width and height; text sizes are shares
  // of its width, so the same cover fits whatever the page size is.
  const COVER_FONTS = {
    serif: 'Georgia, "Times New Roman", "Liberation Serif", serif',
    sans: '"Helvetica Neue", Arial, "Liberation Sans", sans-serif',
    display: 'Impact, "Arial Black", "Haettenschweiler", "Liberation Sans", sans-serif',
    condensed: '"Arial Narrow", "Liberation Sans Narrow", "Roboto Condensed", sans-serif',
    script: '"Segoe Script", "Brush Script MT", "URW Chancery L", "Apple Chancery", cursive',
    mono: '"Courier New", "Liberation Mono", monospace',
  };
  const TEXT_FX = ['none', 'shadow', 'outline', 'glow', 'gradient', 'band', 'long'];
  const SHAPES = ['rect', 'ellipse', 'line'];
  const hexOf = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
  const numIn = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

  function normItem(it) {
    if (!it || typeof it !== 'object') return null;
    const type = ['text', 'image', 'shape'].includes(it.type) ? it.type : null;
    if (!type) return null;
    const o = {
      id: String(it.id || uid()).slice(0, 40), type,
      x: numIn(it.x, -3, 4, 0.1), y: numIn(it.y, -3, 4, 0.1), w: numIn(it.w, 0.005, 5, 0.5),
      rot: numIn(it.rot, -360, 360, 0), opacity: numIn(it.opacity, 0, 1, 1),
    };
    if (type === 'text') {
      Object.assign(o, {
        text: String(it.text == null ? '' : it.text).slice(0, 2000),
        size: numIn(it.size, 0.005, 0.6, 0.06),
        color: hexOf(it.color, '#111111'),
        font: COVER_FONTS[it.font] ? it.font : 'serif',
        ff: /^[^<>"'{};\\\/]{1,60}$/.test(String(it.ff || '')) ? String(it.ff) : '',
        bold: !!it.bold, italic: !!it.italic, caps: !!it.caps,
        align: ['left', 'center', 'right'].includes(it.align) ? it.align : 'center',
        lh: numIn(it.lh, 0.8, 3, 1.2), ls: numIn(it.ls, -0.2, 1, 0),
        fx: TEXT_FX.includes(it.fx) ? it.fx : 'none',
        fx1: hexOf(it.fx1, '#000000'), fx2: hexOf(it.fx2, '#ffcc00'),
      });
    } else if (type === 'image') {
      Object.assign(o, { imageId: String(it.imageId || '').slice(0, 40), flip: !!it.flip });
    } else {
      Object.assign(o, {
        shape: SHAPES.includes(it.shape) ? it.shape : 'rect',
        h: numIn(it.h, 0.001, 5, 0.2),
        fill: it.fill === '' ? '' : hexOf(it.fill, '#cccccc'),
        stroke: it.stroke === '' ? '' : hexOf(it.stroke, ''),
        sw: numIn(it.sw, 0, 0.1, 0.004),
        radius: numIn(it.radius, 0, 0.5, 0),
      });
    }
    return o;
  }
  const text = (o, d) => Object.assign({ type: 'text', id: uid() }, d, o);
  // What a cover starts as: the title and author of the book, or on the back
  // the description, in the middle of a plain page.
  function coverDefaults(doc, side, legacy) {
    legacy = legacy || {};
    const items = [];
    if (side === 'front') {
      const title = legacy.title || doc.title || '';
      if (legacy.image) items.push({ type: 'image', id: uid(), imageId: legacy.image, x: 0.2, y: 0.08, w: 0.6, rot: 0, opacity: 1 });
      const top = legacy.image ? 0.55 : 0.3;
      items.push(text({ text: title, x: 0.1, y: top, w: 0.8, size: 0.09, bold: true, lh: 1.1 }));
      if (legacy.subtitle) items.push(text({ text: legacy.subtitle, x: 0.1, y: top + 0.17, w: 0.8, size: 0.045, color: '#444444' }));
      const author = legacy.author || doc.meta.author;
      if (author) items.push(text({ text: author, x: 0.1, y: 0.86, w: 0.8, size: 0.04, ls: 0.1, caps: true }));
    } else if (doc.meta.description) {
      items.push(text({ text: doc.meta.description, x: 0.12, y: 0.22, w: 0.76, size: 0.032, align: 'left', lh: 1.45 }));
    }
    return { v: 2, bg: '#ffffff', items: items.map(normItem).filter(Boolean) };
  }
  function normCover(c, doc, side) {
    c = c && typeof c === 'object' ? c : {};
    if (c.v !== 2) return coverDefaults(doc, side, side === 'front' ? c : null);
    const items = (Array.isArray(c.items) ? c.items : []).slice(0, 80).map(normItem).filter(Boolean);
    return { v: 2, bg: hexOf(c.bg, '#ffffff'), items };
  }
  function ensureCovers(doc) {
    if (!doc.cover || doc.cover.v !== 2) doc.cover = normCover(doc.cover, doc, 'front');
    if (!doc.back || doc.back.v !== 2) doc.back = normCover(doc.back, doc, 'back');
  }
  function isBook(doc) { return !!doc && doc.type === 'book'; }
  // Switching a document to a book.
  function applyBookPage(doc) { doc.page = normPage(Object.assign({}, BOOK_PAGE, { margins: BOOK_PAGE.margins.slice() })); }

  // The headings of the whole document, in reading order: what the table of
  // contents lists. `n` is the position among all headings, the same number
  // the printed and exported headings get as their anchor.
  function headings(doc, depth) {
    const out = [];
    let n = 0;
    doc.pages.forEach((p, pi) => {
      walkJSON(p.content, node => {
        if (node.type !== 'heading') return;
        n++;
        const level = (node.attrs && node.attrs.level) || 1;
        if (level > (depth || 4)) return;
        out.push({ n, level, page: pi, text: plainText(node).trim() });
      });
    });
    return out.filter(h => h.text);
  }
  function plainText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'formula' || node.type === 'note') return '';
    if (node.type === 'hard_break') return ' ';
    return (node.content || []).map(plainText).join('');
  }

  // A document read from a file or the server: fill in anything missing and
  // refuse what is not ours.
  function normalize(doc) {
    if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) throw new Error('not_mvmoffice');
    doc.version = doc.version || VERSION;
    doc.title = String(doc.title || '');
    doc.page = normPage(doc.page);
    doc.type = doc.type === 'book' ? 'book' : 'text';
    doc.meta = normMeta(doc.meta);
    // The covers of a book start from the title and author as they are when it becomes a book.
    for (const [k, side] of [['cover', 'front'], ['back', 'back']]) {
      const c = doc[k];
      doc[k] = doc.type === 'book' || (c && c.v === 2) ? normCover(c, doc, side) : { v: 0, bg: '#ffffff', items: [] };
    }
    doc.book = { chapterRight: !!(doc.book && doc.book.chapterRight) };
    // The author's notes: the plan, the characters, the dates. A page of text
    // like the others, but kept apart — never printed, exported or numbered.
    const nt = doc.notes && typeof doc.notes === 'object' ? doc.notes : {};
    doc.notes = { id: 'notes', title: '', content: nt.content && nt.content.type === 'doc' ? nt.content : emptyPageContent() };
    doc.images = doc.images && typeof doc.images === 'object' ? doc.images : {};
    for (const [id, im] of Object.entries(doc.images)) {
      if (!im || typeof im.src !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(im.src)) delete doc.images[id];
      else { im.w = im.w | 0; im.h = im.h | 0; }
    }
    doc.pages = Array.isArray(doc.pages) ? doc.pages : [];
    doc.sheets = Array.isArray(doc.sheets) ? doc.sheets : [];
    doc.tables = doc.tables && typeof doc.tables === 'object' ? doc.tables : {};
    for (const [id, t] of Object.entries(doc.tables)) {
      t.id = id;
      t.name = String(t.name || id);
      t.kind = t.kind === 'sheet' ? 'sheet' : 'embed';
      t.rows = Math.max(1, Math.min(MAX_ROWS, t.rows | 0 || 1));
      t.cols = Math.max(1, Math.min(MAX_COLS, t.cols | 0 || 1));
      t.cells = t.cells && typeof t.cells === 'object' ? t.cells : {};
      t.colW = t.colW && typeof t.colW === 'object' ? t.colW : {};
      t.header = !!t.header;
    }
    doc.sheets = doc.sheets.filter(s => s && doc.tables[s.tableId]);
    for (const p of doc.pages) {
      p.id = p.id || uid();
      p.title = String(p.title || '');
      if (!p.content || p.content.type !== 'doc') p.content = emptyPageContent();
    }
    return doc;
  }

  // Tables no page and no sheet points at any more (a table deleted from the
  // text). Done when a document is opened, never while it is being edited,
  // so undoing a deletion always finds its table.
  function dropOrphans(doc) {
    const used = new Set(doc.sheets.map(s => s.tableId));
    for (const p of doc.pages.concat(doc.notes ? [doc.notes] : [])) walkJSON(p.content, n => { if (n.type === 'table_embed' && n.attrs) used.add(n.attrs.tableId); });
    for (const id of Object.keys(doc.tables)) if (!used.has(id)) delete doc.tables[id];
    const pics = new Set();
    for (const side of [doc.cover, doc.back]) for (const it of (side && side.items) || []) if (it.type === 'image') pics.add(it.imageId);
    for (const p of doc.pages.concat(doc.notes ? [doc.notes] : [])) walkJSON(p.content, n => { if (n.type === 'image' && n.attrs) pics.add(n.attrs.imageId); });
    for (const id of Object.keys(doc.images || {})) if (!pics.has(id)) delete doc.images[id];
  }

  function walkJSON(node, fn) {
    if (!node) return;
    fn(node);
    if (Array.isArray(node.content)) node.content.forEach(c => walkJSON(c, fn));
  }

  function tableByName(doc, name) {
    const want = String(name).toLowerCase();
    return Object.values(doc.tables).find(t => t.name.toLowerCase() === want) || null;
  }

  function uniqueName(doc, base) {
    const used = new Set(Object.values(doc.tables).map(t => t.name.toLowerCase()));
    if (!used.has(base.toLowerCase()) && !validateName(doc, base)) return base;
    for (let i = 1; ; i++) {
      const n = base.replace(/\s*\d+$/, '') + i;
      if (!used.has(n.toLowerCase())) return n;
    }
  }

  // Returns an i18n key describing the problem, or null.
  function validateName(doc, name, exceptId) {
    name = String(name || '').trim();
    if (!name) return 'mo_name_empty';
    if (name.length > 60) return 'mo_name_long';
    if (/[!'\[\]]/.test(name)) return 'mo_name_chars';
    if (F.parseCell(name) || /^\$?[A-Za-z]{1,3}$/.test(name) || /^(true|false)$/i.test(name)) return 'mo_name_like_cell';
    const other = tableByName(doc, name);
    if (other && other.id !== exceptId) return 'mo_name_taken';
    return null;
  }

  // Every formula in the document: cells (with the table they live in) and
  // formulas in the text (no table of their own).
  function eachFormula(doc, fn) {
    for (const t of Object.values(doc.tables)) {
      for (const [k, cell] of Object.entries(t.cells)) {
        if (cell && typeof cell.v === 'string' && cell.v.startsWith('=')) {
          const out = fn(cell.v.slice(1), t);
          if (out !== undefined && out !== cell.v.slice(1)) t.cells[k] = Object.assign({}, cell, { v: '=' + out });
        }
      }
    }
    for (const p of doc.pages) eachTextFormula(p.content, fn);
  }
  function eachTextFormula(content, fn) {
    walkJSON(content, n => {
      if (n.type === 'formula' && n.attrs && n.attrs.expr) {
        const out = fn(n.attrs.expr, null);
        if (out !== undefined) n.attrs.expr = out;
      }
    });
  }

  // The rewrite for one formula; used both on the stored document and on the
  // text page open in the editor.
  function refTarget(doc, node, ctx) {
    return node.table == null ? ctx : tableByName(doc, node.table);
  }
  function tableNameOf(node, table) { return node.table == null ? null : table.name; }

  function renameRewriter(doc, table, newName) {
    return (src, ctx) => F.mapRefs(src, n => {
      if (n.table == null || refTarget(doc, n, ctx) !== table) return undefined;
      return F.refToText(n, newName);
    });
  }

  // Rows (axis 'r') or columns (axis 'c') inserted at `at` (count > 0) or
  // deleted from `at` (count < 0), in `table`.
  function shiftRewriter(doc, table, axis, at, count) {
    const moveIdx = i => {
      if (count > 0) return i >= at ? i + count : i;
      const n = -count;
      if (i < at) return i;
      if (i < at + n) return null;
      return i - n;
    };
    const moveSpan = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (count > 0) return [moveIdx(lo), moveIdx(hi)];
      const n = -count;
      const nlo = lo < at ? lo : (lo < at + n ? at : lo - n);
      const nhi = hi < at ? hi : (hi < at + n ? at - 1 : hi - n);
      return nhi < nlo ? null : [nlo, nhi];
    };
    return (src, ctx) => F.mapRefs(src, n => {
      if (refTarget(doc, n, ctx) !== table) return undefined;
      const name = tableNameOf(n, table);
      if (n.t === 'col') return undefined;
      if (n.t === 'ref') {
        const idx = moveIdx(axis === 'r' ? n.r : n.c);
        if (idx == null) return '#REF!';
        return F.refToText(Object.assign({}, n, axis === 'r' ? { r: idx } : { c: idx }), name);
      }
      if (n.t === 'range') {
        const span = axis === 'r' ? moveSpan(n.r1, n.r2) : moveSpan(n.c1, n.c2);
        if (!span) return '#REF!';
        return F.refToText(Object.assign({}, n, axis === 'r' ? { r1: span[0], r2: span[1] } : { c1: span[0], c2: span[1] }), name);
      }
      if (n.t === 'cols') {
        if (axis === 'r') return undefined;
        const span = moveSpan(n.c1, n.c2);
        if (!span) return '#REF!';
        return F.refToText(Object.assign({}, n, { c1: span[0], c2: span[1] }), name);
      }
      return undefined;
    });
  }

  // A formula copied dr rows and dc columns away: relative parts follow.
  function moveFormula(src, dr, dc) {
    return F.mapRefs(src, n => {
      const name = n.table;
      const mv = (i, abs, d) => (abs ? i : i + d);
      if (n.t === 'ref') {
        const r = mv(n.r, n.absR, dr), c = mv(n.c, n.absC, dc);
        if (r < 0 || c < 0) return '#REF!';
        return F.refToText(Object.assign({}, n, { r, c }), name);
      }
      if (n.t === 'range') {
        const r1 = mv(n.r1, n.absR1, dr), r2 = mv(n.r2, n.absR2, dr);
        const c1 = mv(n.c1, n.absC1, dc), c2 = mv(n.c2, n.absC2, dc);
        if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return '#REF!';
        return F.refToText(Object.assign({}, n, { r1, r2, c1, c2 }), name);
      }
      if (n.t === 'cols') {
        const c1 = mv(n.c1, n.absC1, dc), c2 = mv(n.c2, n.absC2, dc);
        if (c1 < 0 || c2 < 0) return '#REF!';
        return F.refToText(Object.assign({}, n, { c1, c2 }), name);
      }
      return undefined;
    });
  }

  // Move the cells themselves (and column widths) for an insert/delete.
  function shiftCells(table, axis, at, count) {
    const cells = {};
    for (const [k, cell] of Object.entries(table.cells)) {
      let [r, c] = k.split(',').map(Number);
      let i = axis === 'r' ? r : c;
      if (count > 0) { if (i >= at) i += count; }
      else {
        const n = -count;
        if (i >= at && i < at + n) continue;
        if (i >= at + n) i -= n;
      }
      if (axis === 'r') r = i; else c = i;
      cells[r + ',' + c] = cell;
    }
    table.cells = cells;
    if (axis === 'c') {
      const w = {};
      for (const [k, v] of Object.entries(table.colW)) {
        let c = +k;
        if (count > 0) { if (c >= at) c += count; }
        else {
          const n = -count;
          if (c >= at && c < at + n) continue;
          if (c >= at + n) c -= n;
        }
        w[c] = v;
      }
      table.colW = w;
      table.cols = Math.max(1, Math.min(MAX_COLS, table.cols + count));
    } else {
      table.rows = Math.max(1, Math.min(MAX_ROWS, table.rows + count));
    }
  }

  // Plain cells from an HTML table (pasted from a web page, Word or Excel).
  function cellsFromHtmlTable(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const row = [];
      for (const td of tr.children) {
        if (!/^(TD|TH)$/.test(td.tagName)) continue;
        row.push(td.textContent.replace(/\s+/g, ' ').trim());
        const span = Math.min(50, parseInt(td.getAttribute('colspan') || '1', 10) || 1);
        for (let i = 1; i < span; i++) row.push('');
      }
      rows.push(row);
    }
    return rows;
  }

  // Tab-separated text, as Excel, Sheets and every spreadsheet put on the
  // clipboard. Quoted fields may hold tabs and newlines.
  function parseTSV(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    text = text.replace(/\r\n?/g, '\n');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
        continue;
      }
      if (ch === '"' && cur === '') { q = true; continue; }
      if (ch === '\t') { row.push(cur); cur = ''; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
      cur += ch;
    }
    row.push(cur);
    rows.push(row);
    return rows;
  }
  function toTSV(rows) {
    return rows.map(r => r.map(v => (/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t')).join('\n');
  }

  window.MvmOfficeModel = {
    FORMAT, VERSION, SHEET_ROWS, SHEET_COLS, MAX_ROWS, MAX_COLS,
    uid, clone, newDoc, newTable, addPage, addSheet, normalize, dropOrphans, walkJSON,
    tableByName, uniqueName, validateName, eachFormula, eachTextFormula,
    renameRewriter, shiftRewriter, moveFormula, shiftCells, cellsFromHtmlTable, parseTSV, toTSV,
    emptyPageContent, PAPER, MARGINS, PAGE_NUMBERS, HEADERS, BOOK_PAGE, normPage, pageBox,
    isBook, applyBookPage, headings, plainText, normMeta, normCover, ensureCovers, normItem, coverDefaults, COVER_FONTS, TEXT_FX,
  };
})();
