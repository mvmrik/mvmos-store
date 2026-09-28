// mvmOffice — the pages of a document as a Word file (.docx).
//
// What goes to Word is what goes to the printer: the pages in their order,
// each starting on a new sheet, with the tables in the text and the values
// of the formulas in the sentences. The data sheets stay out; they go to
// Excel. The page setup travels too — paper, orientation, margins and the
// page number in the footer — so Word lays the text out on the same sheets.
(function () {
  'use strict';
  if (window.MvmOfficeDocx) return;
  const M = window.MvmOfficeModel;

  const xml = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TW_MM = 1440 / 25.4;        // twips in a millimetre
  const TW_PX = 15;                 // twips in a CSS pixel
  const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };

  // '#abc' / '#aabbcc' -> 'AABBCC'; anything else is left out.
  function hex(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(c || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return h.toUpperCase();
  }

  function rPr(o) {
    let s = '';
    if (o.b) s += '<w:b/>';
    if (o.i) s += '<w:i/>';
    if (o.s) s += '<w:strike/>';
    const c = hex(o.color);
    if (c) s += `<w:color w:val="${c}"/>`;
    if (o.u) s += '<w:u w:val="single"/>';
    return s ? '<w:rPr>' + s + '</w:rPr>' : '';
  }
  function marksOf(marks) {
    const o = {};
    for (const m of marks || []) {
      if (m.type === 'strong') o.b = true;
      else if (m.type === 'em') o.i = true;
      else if (m.type === 'underline') o.u = true;
      else if (m.type === 'strike') o.s = true;
      else if (m.type === 'color') o.color = m.attrs && m.attrs.color;
    }
    return o;
  }
  const run = (text, o) => `<w:r>${rPr(o || {})}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;

  class Writer {
    constructor(doc, office) {
      this.doc = doc;
      this.office = office;
      this.engine = office.engine;
      this.nums = [];              // [abstract id, start] for every list
      const box = M.pageBox(doc);
      this.box = box;
      this.textW = Math.round((box.w - box.l - box.r) * TW_MM);
    }

    inline(nodes) {
      let s = '';
      for (const n of nodes || []) {
        if (n.type === 'text') s += run(n.text, marksOf(n.marks));
        else if (n.type === 'hard_break') s += '<w:r><w:br/></w:r>';
        else if (n.type === 'formula') s += run(this.office.inlineText(n.attrs.expr, n.attrs.fmt), marksOf(n.marks));
      }
      return s;
    }

    para(n, extra) {
      const a = n.attrs || {};
      let pPr = '';
      if (n.type === 'heading') pPr += `<w:pStyle w:val="Heading${Math.min(3, Math.max(1, a.level || 1))}"/>`;
      if (extra && extra.style) pPr += `<w:pStyle w:val="${extra.style}"/>`;
      if (extra && extra.num) pPr += `<w:numPr><w:ilvl w:val="${extra.num.lvl}"/><w:numId w:val="${extra.num.id}"/></w:numPr>`;
      if (extra && extra.ind != null) pPr += `<w:ind w:left="${extra.ind}"/>`;
      if (a.align && JC[a.align]) pPr += `<w:jc w:val="${JC[a.align]}"/>`;
      return `<w:p>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${this.inline(n.content)}</w:p>`;
    }

    blocks(nodes, ctx) {
      ctx = ctx || {};
      let s = '';
      for (const n of nodes || []) s += this.block(n, ctx);
      return s;
    }

    block(n, ctx) {
      switch (n.type) {
        case 'paragraph':
        case 'heading':
          return this.para(n, ctx.quote ? { style: 'Quote' } : ctx.ind != null ? { ind: ctx.ind } : null);
        case 'blockquote':
          return this.blocks(n.content, { ...ctx, quote: true });
        case 'horizontal_rule':
          return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
        case 'page_break':
          return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        case 'bullet_list':
        case 'ordered_list':
          return this.list(n, ctx);
        case 'table_embed':
          return this.table(this.doc.tables[n.attrs && n.attrs.tableId]);
        default:
          return n.content ? this.blocks(n.content, ctx) : '';
      }
    }

    // Every list is its own numbering, so a numbered list starts where the
    // document says; a list inside an item goes one level deeper.
    list(n, ctx) {
      const lvl = ctx.lvl == null ? 0 : ctx.lvl + 1;
      if (lvl > 8) return this.blocks((n.content || []).flatMap(i => i.content || []), ctx);
      const ordered = n.type === 'ordered_list';
      this.nums.push([ordered ? 1 : 0, ordered ? Math.max(1, (n.attrs && n.attrs.order) || 1) : 1, lvl]);
      const id = this.nums.length;
      let s = '';
      for (const item of n.content || []) {
        let first = true;
        for (const c of item.content || []) {
          if (first && (c.type === 'paragraph' || c.type === 'heading')) {
            s += this.para(c, { num: { id, lvl } });
          } else if (c.type === 'bullet_list' || c.type === 'ordered_list') {
            s += this.list(c, { ...ctx, lvl });
          } else {
            s += this.block(c, { ...ctx, ind: 720 * (lvl + 1) });
          }
          first = false;
        }
      }
      return s;
    }

    // A table as the printer shows it: the header row repeats on every
    // sheet, and a table wider than the text is narrowed to fit.
    table(t) {
      if (!t) return '';
      const eng = this.engine;
      let w = [];
      for (let c = 0; c < t.cols; c++) w.push(Math.round((t.colW[c] || 120) * TW_PX));
      const total = w.reduce((a, b) => a + b, 0);
      if (total > this.textW) w = w.map(x => Math.floor(x * this.textW / total));
      const sum = w.reduce((a, b) => a + b, 0);
      const B = '<w:{s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>';
      const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => B.replace('{s}', x)).join('');
      let s = `<w:tbl><w:tblPr><w:tblW w:w="${sum}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders>` +
        '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' +
        '<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>' + w.map(x => `<w:gridCol w:w="${x}"/>`).join('') + '</w:tblGrid>';
      const header = t.header && t.rows > 1;
      for (let r = 0; r < t.rows; r++) {
        const head = header && r === 0;
        s += '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
        for (let c = 0; c < t.cols; c++) {
          const cell = t.cells[r + ',' + c] || {};
          const v = eng.value(t, r, c);
          const a = cell.a || (typeof v === 'number' ? 'right' : null);
          const bg = hex(cell.bg);
          const text = eng.display(t, r, c);
          s += `<w:tc><w:tcPr><w:tcW w:w="${w[c]}" w:type="dxa"/>${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : ''}</w:tcPr>` +
            `<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>${a && JC[a] ? `<w:jc w:val="${JC[a]}"/>` : ''}</w:pPr>` +
            (text !== '' ? run(text, { b: cell.b || head, i: cell.i, u: cell.u, s: cell.s, color: cell.fg }) : '') + '</w:p></w:tc>';
        }
        s += '</w:tr>';
      }
      return s + '</w:tbl>';
    }

    body() {
      const pages = this.doc.pages.map(p => this.blocks((p.content && p.content.content) || []));
      let s = pages.join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      // Word wants a paragraph after a table that ends the document.
      if (!s || s.endsWith('</w:tbl>')) s += '<w:p/>';
      return s;
    }

    sectPr() {
      const b = this.box;
      const tw = mm => Math.round(mm * TW_MM);
      const land = b.w > b.h;
      return '<w:sectPr>' +
        (b.numbers !== 'none' ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '') +
        `<w:pgSz w:w="${tw(b.w)}" w:h="${tw(b.h)}"${land ? ' w:orient="landscape"' : ''}/>` +
        `<w:pgMar w:top="${tw(b.t)}" w:right="${tw(b.r)}" w:bottom="${tw(b.b)}" w:left="${tw(b.l)}" w:header="${tw(b.t / 2)}" w:footer="${tw(b.b / 2)}" w:gutter="0"/>` +
        '</w:sectPr>';
    }

    numbering() {
      const BUL = ['•', '◦', '▪'];
      const DEC = ['decimal', 'lowerLetter', 'lowerRoman'];
      const lvls = ordered => Array.from({ length: 9 }, (_, l) =>
        `<w:lvl w:ilvl="${l}"><w:start w:val="1"/>` +
        (ordered ? `<w:numFmt w:val="${DEC[l % 3]}"/><w:lvlText w:val="%${l + 1}."/>`
          : `<w:numFmt w:val="bullet"/><w:lvlText w:val="${BUL[l % 3]}"/>`) +
        `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>` +
        this.nums.map(([abs, start, lvl], i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${abs}"/>` +
          (abs === 1 ? `<w:lvlOverride w:ilvl="${lvl}"><w:startOverride w:val="${start}"/></w:lvlOverride>` : '') + '</w:num>').join('') +
        '</w:numbering>';
    }
  }

  // The same look as the page on screen: Calibri 11 pt, 1.45 lines.
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1F1F1F"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="110" w:line="348" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    [[1, 40], [2, 32], [3, 26]].map(([l, sz]) =>
      `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${sz * 4}" w:after="${sz * 3}"/><w:outlineLvl w:val="${l - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`).join('') +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="CCCCCC"/></w:pBdr><w:ind w:left="300"/></w:pPr>' +
    '<w:rPr><w:color w:val="444444"/></w:rPr></w:style>' +
    '</w:styles>';

  function footer(align) {
    const fld = t => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:p><w:pPr><w:jc w:val="${align === 'right' ? 'right' : 'center'}"/></w:pPr>` +
      fld('begin') + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' + fld('separate') +
      '<w:r><w:t>1</w:t></w:r>' + fld('end') + '</w:p></w:ftr>';
  }

  function document(doc, office) {
    const X = window.MvmOfficeXlsx;
    const w = new Writer(doc, office);
    const body = w.body();
    const hasFooter = w.box.numbers !== 'none';
    const files = [];
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      (hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>']);
    files.push(['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${xml(doc.title)}</dc:title><dc:creator>mvmOffice</dc:creator></cp:coreProperties>`]);
    files.push(['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      (hasFooter ? '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '') +
      '</Relationships>']);
    files.push(['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${body}${w.sectPr()}</w:body></w:document>`]);
    files.push(['word/styles.xml', STYLES]);
    files.push(['word/numbering.xml', w.numbering()]);
    if (hasFooter) files.push(['word/footer1.xml', footer(w.box.numbers)]);
    return X.zip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  window.MvmOfficeDocx = { document };
})();
