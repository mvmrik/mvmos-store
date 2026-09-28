// mvmOffice — tables written out as an Excel workbook (.xlsx).
//
// Every chosen table becomes a worksheet of its own: the data sheets under
// their names and the tables from the text under theirs. A cell keeps its
// formula when Excel can read it the same way — references to tables that
// travel with it become references to their worksheets — and always carries
// the value mvmOffice computed, so the file shows the same numbers even
// where a formula had to stay behind as a plain value.
(function () {
  if (window.MvmOfficeXlsx) return;
  const F = window.MvmOfficeFormula;

  // Functions Excel only knows under the "future function" prefix.
  const XLFN = new Set(['XLOOKUP', 'TEXTJOIN', 'CONCAT', 'IFNA']);
  const PX_PER_CHAR = 7;

  const xml = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  // Worksheet names: at most 31 characters, none of []:*?/\ and unique
  // without regard to case.
  function sheetNames(tables) {
    const used = new Set();
    const out = new Map();
    for (const t of tables) {
      let base = String(t.name || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Sheet';
      base = base.slice(0, 31);
      let name = base, n = 2;
      while (used.has(name.toLowerCase())) {
        const suffix = ' (' + n++ + ')';
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      used.add(name.toLowerCase());
      out.set(t.id, name);
    }
    return out;
  }
  const quoteSheet = name => "'" + name.replace(/'/g, "''") + "'";

  function walk(node, fn) {
    if (!node) return;
    fn(node);
    if (node.a) walk(node.a, fn);
    if (node.b) walk(node.b, fn);
    if (node.args) node.args.forEach(x => walk(x, fn));
  }

  // The formula as Excel writes it, or null when it cannot go over as is.
  function excelFormula(src, table, engine, names) {
    let ast, toks;
    try { ast = F.parse(src); toks = F.tokenize(src); } catch (e) { return null; }
    const edits = [];
    let ok = true;
    walk(ast, n => {
      if (!ok) return;
      if (n.t === 'unknown' || (n.t === 'fn' && !F.FN[n.name])) { ok = false; return; }
      if (!['ref', 'range', 'cols', 'col'].includes(n.t)) return;
      const target = n.table ? engine.table(n.table) : table;
      if (!target || !names.has(target.id)) { ok = false; return; }
      const pre = target === table && !n.table ? '' : quoteSheet(names.get(target.id)) + '!';
      if (n.t === 'col') {
        // Table[Column] is the column under that header, from the first row
        // of data down to the last one in use.
        const c = engine.columnOf(target, n.col);
        if (c < 0) { ok = false; return; }
        const last = Math.max(2, engine.usedRows(target));
        edits.push({ s: n.s, e: n.e, v: pre + '$' + F.colName(c) + '$2:$' + F.colName(c) + '$' + last });
      } else {
        const text = F.refToText(n, null);
        if (pre || n.table) edits.push({ s: n.s, e: n.e, v: pre + text });
      }
    });
    if (!ok) return null;
    toks.forEach((k, i) => {
      if (k.t === ',' && k.v === ';') edits.push({ s: k.s, e: k.e, v: ',' });
      if (k.t === 'name' && !k.quoted && XLFN.has(k.v.toUpperCase()) && toks[i + 1] && toks[i + 1].t === '(') {
        edits.push({ s: k.s, e: k.s, v: '_xlfn.' });
      }
    });
    edits.sort((x, y) => y.s - x.s || y.e - x.e);
    let out = src;
    for (const ed of edits) out = out.slice(0, ed.s) + ed.v + out.slice(ed.e);
    return out;
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  class Styles {
    constructor() {
      this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
      this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
      this.numFmts = [];
      this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
      this.keys = new Map();
    }
    static argb(color) {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
      if (!m) return null;
      let h = m[1];
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      return 'FF' + h.toUpperCase();
    }
    idOf(list, entry) {
      let i = list.indexOf(entry);
      if (i < 0) { list.push(entry); i = list.length - 1; }
      return i;
    }
    numFmt(fmt) {
      if (!fmt || !fmt.type || fmt.type === 'general') return 0;
      if (fmt.type === 'date') return 14;
      if (fmt.type === 'text') return 49;
      const dec = fmt.dec == null ? 2 : Math.max(0, Math.min(10, fmt.dec | 0));
      const digits = '#,##0' + (dec ? '.' + '0'.repeat(dec) : '');
      let code;
      if (fmt.type === 'number') code = digits;
      else if (fmt.type === 'percent') code = '0' + (dec ? '.' + '0'.repeat(dec) : '') + '%';
      else if (fmt.type === 'currency') {
        const sym = '"' + String(fmt.sym || '').replace(/"/g, '') + '"';
        code = !fmt.sym ? digits : fmt.pos === 'before' ? sym + digits : digits + ' ' + sym;
      } else return 0;
      let i = this.numFmts.indexOf(code);
      if (i < 0) { this.numFmts.push(code); i = this.numFmts.length - 1; }
      return 164 + i;
    }
    xf(cell, fmt, bold) {
      const c = cell || {};
      const b = !!(c.b || bold), it = !!c.i, u = !!c.u, s = !!c.s;
      const fg = Styles.argb(c.fg), bg = Styles.argb(c.bg);
      const align = ['left', 'center', 'right'].includes(c.a) ? c.a : null;
      const numFmtId = this.numFmt(fmt);
      const key = [b, it, u, s, fg, bg, align, numFmtId].join('|');
      if (this.keys.has(key)) return this.keys.get(key);
      let fontId = 0, fillId = 0;
      if (b || it || u || s || fg) {
        fontId = this.idOf(this.fonts, '<font>' + (b ? '<b/>' : '') + (it ? '<i/>' : '') + (s ? '<strike/>' : '') + (u ? '<u/>' : '') +
          '<sz val="11"/>' + (fg ? `<color rgb="${fg}"/>` : '') + '<name val="Calibri"/></font>');
      }
      if (bg) fillId = this.idOf(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`);
      const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"` +
        (numFmtId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') + (fillId ? ' applyFill="1"' : '') +
        (align ? ` applyAlignment="1"><alignment horizontal="${align}"/></xf>` : '/>');
      this.xfs.push(xf);
      const id = this.xfs.length - 1;
      this.keys.set(key, id);
      return id;
    }
    toXML() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        (this.numFmts.length ? `<numFmts count="${this.numFmts.length}">` + this.numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(c)}"/>`).join('') + '</numFmts>' : '') +
        `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
        `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>';
    }
  }

  // ── One worksheet ────────────────────────────────────────────────────────
  function sheetXML(table, engine, names, styles, defaultColW) {
    let maxR = -1, maxC = -1;
    for (const k in table.cells) {
      const cell = table.cells[k];
      if (!cell || ((cell.v == null || cell.v === '') && !cell.bg)) continue;
      const [r, c] = k.split(',').map(Number);
      if (r >= table.rows || c >= table.cols) continue;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    const cols = [];
    for (let c = 0; c <= Math.max(maxC, 0); c++) {
      const px = table.colW[c] || defaultColW;
      cols.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.round(px / PX_PER_CHAR * 100) / 100}" customWidth="1"/>`);
    }
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const out = [];
      for (let c = 0; c <= maxC; c++) {
        const cell = table.cells[r + ',' + c];
        const header = r === 0 && table.header;
        if (!cell || ((cell.v == null || cell.v === '') && !cell.bg)) continue;
        const ref = F.colName(c) + (r + 1);
        const raw = cell.v;
        const fmt = cell.f && cell.f.type && cell.f.type !== 'general' ? cell.f : engine.autoFormat(table, r, c);
        const s = styles.xf(cell, fmt, header);
        const sa = s ? ` s="${s}"` : '';
        if (raw == null || raw === '') { out.push(`<c r="${ref}"${sa}/>`); continue; }
        let v = engine.value(table, r, c);
        if (F.isMatrix(v)) v = v.h && v.w ? v.rows[0][0] : null;
        const isFormula = typeof raw === 'string' && raw.startsWith('=') && raw.length > 1;
        const f = isFormula ? excelFormula(raw.slice(1), table, engine, names) : null;
        const fx = f != null ? `<f>${xml(f)}</f>` : '';
        if (F.isErr(v)) {
          out.push(`<c r="${ref}"${sa} t="e">${fx}<v>${xml(v.code)}</v></c>`);
        } else if (typeof v === 'number') {
          out.push(isFinite(v) ? `<c r="${ref}"${sa}>${fx}<v>${v}</v></c>` : `<c r="${ref}"${sa} t="e">${fx}<v>#NUM!</v></c>`);
        } else if (typeof v === 'boolean') {
          out.push(`<c r="${ref}"${sa} t="b">${fx}<v>${v ? 1 : 0}</v></c>`);
        } else if (v == null) {
          out.push(fx ? `<c r="${ref}"${sa} t="str">${fx}<v></v></c>` : `<c r="${ref}"${sa}/>`);
        } else if (fx) {
          out.push(`<c r="${ref}"${sa} t="str">${fx}<v>${xml(v)}</v></c>`);
        } else {
          out.push(`<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`);
        }
      }
      if (out.length) rows.push(`<row r="${r + 1}">${out.join('')}</row>`);
    }
    // A table from the text shows no row numbers or column letters, as it
    // does in the document when it is not being edited.
    const view = '<sheetView workbookViewId="0"' + (table.kind === 'embed' ? ' showRowColHeaders="0"' : '');
    const frozen = table.header && maxR > 0
      ? `<sheetViews>${view}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews>${view}/></sheetViews>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<dimension ref="A1${maxR >= 0 && maxC >= 0 ? ':' + F.colName(maxC) + (maxR + 1) : ''}"/>` +
      frozen + '<sheetFormatPr defaultRowHeight="15"/>' +
      `<cols>${cols.join('')}</cols>` +
      `<sheetData>${rows.join('')}</sheetData>` +
      '</worksheet>';
  }

  // ── The zip around it ────────────────────────────────────────────────────
  // Stored without compression: every spreadsheet program reads that, and it
  // needs no library.
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files, type) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const [name, text] of files) {
      const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
      parts.push(local, nameB, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      central.push(cen, nameB);
      offset += 30 + nameB.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // tables: [{ table, colW }] in the order the worksheets should have.
  function workbook(tables, engine) {
    const names = sheetNames(tables.map(x => x.table));
    const styles = new Styles();
    const sheets = tables.map(x => sheetXML(x.table, engine, names, styles, x.colW));
    const files = [];
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>']);
    files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView/></bookViews><sheets>' +
      tables.map((x, i) => `<sheet name="${xml(names.get(x.table.id))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>']);
    files.push(['xl/styles.xml', styles.toXML()]);
    sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, s]));
    return zip(files);
  }

  window.MvmOfficeXlsx = { workbook, excelFormula, sheetNames, zip };
})();
