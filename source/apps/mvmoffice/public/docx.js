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
    if (o.font) s += `<w:rFonts w:ascii="${xml(o.font)}" w:hAnsi="${xml(o.font)}" w:cs="${xml(o.font)}"/>`;
    if (o.b) s += '<w:b/>';
    if (o.i) s += '<w:i/>';
    if (o.s) s += '<w:strike/>';
    if (o.sup) s += '<w:vertAlign w:val="superscript"/>';
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
      else if (m.type === 'font') o.font = m.attrs && m.attrs.family;
      else if (m.type === 'link') o.link = m.attrs && m.attrs.href;
    }
    return o;
  }
  const run = (text, o) => `<w:r>${rPr(o || {})}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;

  class Writer {
    constructor(doc, office, covers) {
      this.covers = covers || null;
      this.doc = doc;
      this.office = office;
      this.engine = office.engine;
      this.nums = [];              // [abstract id, start] for every list
      this.rels = [];              // hyperlinks and pictures: [id, kind, target]
      this.media = new Map();      // image id -> { name, ext, mime, bytes }
      this.docPr = 0;
      this.notes = [];             // the notes of the page being written
      const box = M.pageBox(doc);
      this.box = box;
      this.textW = Math.round((box.w - box.l - box.r) * TW_MM);
    }

    inline(nodes) {
      let s = '';
      const link = (o, r) => {
        const href = /^(https?:\/\/|mailto:)/i.test(String(o.link || '').trim()) ? o.link.trim() : null;
        if (!href) return r;
        const id = 'rIdL' + (this.rels.length + 1);
        this.rels.push([id, 'hyperlink', href]);
        return `<w:hyperlink r:id="${id}" w:history="1">${r}</w:hyperlink>`;
      };
      for (const n of nodes || []) {
        if (n.type === 'text') { const o = marksOf(n.marks); if (o.link) { o.u = true; o.color = o.color || '#1A55C8'; } s += link(o, run(n.text, o)); }
        else if (n.type === 'hard_break') s += '<w:r><w:br/></w:r>';
        else if (n.type === 'formula') s += run(this.office.inlineText(n.attrs.expr, n.attrs.fmt), marksOf(n.marks));
        else if (n.type === 'note') { this.notes.push((n.attrs && n.attrs.text) || ''); s += run(String(this.notes.length), { sup: true }); }
      }
      return s;
    }

    para(n, extra) {
      const a = n.attrs || {};
      let pPr = '';
      if (n.type === 'heading') pPr += `<w:pStyle w:val="Heading${Math.min(4, Math.max(1, a.level || 1))}"/>`;
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
        case 'image':
          return this.picture(n.attrs || {});
        case 'toc':
          return this.toc((n.attrs && n.attrs.depth) || 2);
        default:
          return n.content ? this.blocks(n.content, ctx) : '';
      }
    }

    // A picture, centred, as wide as the author set it (a share of the text).
    picture(a) {
      const im = this.doc.images[a.imageId];
      const m = im && /^data:(image\/(png|jpeg|gif|webp));base64,(.*)$/.exec(im.src);
      if (!m) return '';
      let rec = this.media.get(a.imageId);
      if (!rec) {
        const bin = atob(m[3]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
        rec = { name: 'image' + (this.media.size + 1) + '.' + ext, ext, mime: m[1], bytes, rid: 'rIdI' + (this.media.size + 1) };
        this.media.set(a.imageId, rec);
        this.rels.push([rec.rid, 'image', 'media/' + rec.name]);
      }
      const pct = Math.min(100, Math.max(5, a.width | 0 || 60));
      const cx = Math.round(this.textW * pct / 100 * 635);
      const cy = Math.round(cx * ((im.h || 3) / (im.w || 4)));
      const id = ++this.docPr;
      return '<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
        `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${xml(a.alt || '')}"/>` +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${rec.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rec.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    // The table of contents is a Word field filled with the headings as they
    // are now; Word adds the page numbers when the field is updated.
    toc(depth) {
      const list = M.headings(this.doc, depth);
      const fld = t => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
      let s = `<w:p><w:pPr><w:keepNext/></w:pPr>${run(this.office.t('mo_toc'), { b: true })}</w:p>`;
      if (!list.length) return s;
      list.forEach((h, i) => {
        s += `<w:p><w:pPr><w:ind w:left="${(h.level - 1) * 360}"/></w:pPr>` +
          (i === 0 ? fld('begin') + `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-${depth}" \\h \\z \\u </w:instrText></w:r>` + fld('separate') : '') +
          run(h.text) + (i === list.length - 1 ? fld('end') : '') + '</w:p>';
      });
      return s;
    }

    // A cover is a picture of the finished page, laid behind the text from
    // the corner of the sheet to the corner, so it has no margins.
    fullPage(src, key) {
      const m = /^data:(image\/(png|jpeg|gif|webp));base64,(.*)$/.exec(src || '');
      if (!m) return '';
      let rec = this.media.get(key);
      if (!rec) {
        const bin = atob(m[3]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
        rec = { name: 'image' + (this.media.size + 1) + '.' + ext, ext, mime: m[1], bytes, rid: 'rIdI' + (this.media.size + 1) };
        this.media.set(key, rec);
        this.rels.push([rec.rid, 'image', 'media/' + rec.name]);
      }
      const cx = Math.round(this.box.w * 36000), cy = Math.round(this.box.h * 36000);
      const id = ++this.docPr;
      return '<w:p><w:r><w:drawing>' +
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
        `<wp:docPr id="${id}" name="Cover ${id}"/><wp:cNvGraphicFramePr/>` +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${rec.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rec.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
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

    // The notes of a page, listed at its end the way the printed sheets show them.
    notesList() {
      if (!this.notes.length) return '';
      let s = `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="999999"/></w:pBdr><w:spacing w:before="360"/></w:pPr>${run(this.office.t('mo_notes'), { b: true })}</w:p>`;
      this.notes.forEach((text, i) => { s += `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${run((i + 1) + '. ' + text, {})}</w:p>`; });
      return s;
    }

    body() {
      const pages = this.doc.pages.map(p => {
        this.notes = [];
        const text = this.blocks((p.content && p.content.content) || []);
        return text + this.notesList();
      });
      const cv = this.covers;
      let s = (cv ? this.fullPage(cv.front.src, 'front') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') +
        pages.join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>') +
        (cv ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + this.fullPage(cv.back.src, 'back') : '');
      // Word wants a paragraph after a table that ends the document.
      if (!s || s.endsWith('</w:tbl>')) s += '<w:p/>';
      return s;
    }

    sectPr() {
      const b = this.box;
      const tw = mm => Math.round(mm * TW_MM);
      const land = b.w > b.h;
      return '<w:sectPr>' +
        (b.header !== 'none' ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' + (this.evenOdd() ? '<w:headerReference w:type="even" r:id="rIdHeaderEven"/>' : '') : '') +
        (b.numbers !== 'none' ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' + (this.evenOdd() ? '<w:footerReference w:type="even" r:id="rIdFooterEven"/>' : '') : '') +
        `<w:pgSz w:w="${tw(b.w)}" w:h="${tw(b.h)}"${land ? ' w:orient="landscape"' : ''}/>` +
        `<w:pgMar w:top="${tw(b.t)}" w:right="${tw(b.r)}" w:bottom="${tw(b.b)}" w:left="${tw(b.l)}" w:header="${tw(b.t / 2)}" w:footer="${tw(b.b / 2)}" w:gutter="0"/>` +
        (this.covers ? '<w:titlePg/>' : '') +
        '</w:sectPr>';
    }

    // Left and right sheets differ when the number goes to the outer edge or
    // the header runs in the book manner.
    evenOdd() { return this.box.numbers === 'outside' || this.box.header === 'book'; }

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
  // A book is set in a serif face, justified, with the first line indented.
  const styles = book => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${book ? 'Cambria' : 'Calibri'}" w:hAnsi="${book ? 'Cambria' : 'Calibri'}" w:eastAsia="Calibri" w:cs="Calibri"/>` +
    '<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1F1F1F"/></w:rPr></w:rPrDefault>' +
    `<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="${book ? 0 : 110}" w:line="${book ? 336 : 348}" w:lineRule="auto"/>${book ? '<w:ind w:firstLine="400"/><w:jc w:val="both"/>' : ''}</w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    [[1, 40], [2, 32], [3, 26], [4, 23]].map(([l, sz]) =>
      `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${sz * 4}" w:after="${sz * 3}"/><w:ind w:firstLine="0"/>${book && l === 1 ? '<w:jc w:val="center"/>' : '<w:jc w:val="left"/>'}<w:outlineLvl w:val="${l - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`).join('') +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="CCCCCC"/></w:pBdr><w:ind w:left="300"/></w:pPr>' +
    '<w:rPr><w:color w:val="444444"/></w:rPr></w:style>' +
    '</w:styles>';

  // A footer with the page number; `align` is left, center or right.
  function footer(align) {
    const fld = t => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="${align}"/></w:pPr>` +
      fld('begin') + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' + fld('separate') +
      '<w:r><w:t>1</w:t></w:r>' + fld('end') + '</w:p></w:ftr>';
  }
  // A running header: the document title, or the nearest first-level heading.
  function header(kind, align, title) {
    const fld = t => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
    const rp = '<w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr>';
    const text = kind === 'title'
      ? `<w:r>${rp}<w:t xml:space="preserve">${xml(title)}</w:t></w:r>`
      : `<w:r>${rp}${''}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> STYLEREF "Heading 1" </w:instrText></w:r>` +
        `<w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t></w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="${align}"/></w:pPr>${text}</w:p></w:hdr>`;
  }

  function document(doc, office, covers) {
    const X = window.MvmOfficeXlsx;
    const w = new Writer(doc, office, covers);
    const body = w.body();
    const b = w.box;
    const eo = w.evenOdd();
    const hasFooter = b.numbers !== 'none';
    const hasHeader = b.header !== 'none';
    const hasSettings = b.mirror || eo;
    const P = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
    const files = [];
    const exts = new Map();
    w.media.forEach(m => exts.set(m.ext, m.mime));
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      [...exts].map(([e, m]) => `<Default Extension="${e}" ContentType="${m}"/>`).join('') +
      `<Override PartName="/word/document.xml" ContentType="${CT}document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT}styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="${CT}numbering+xml"/>` +
      (hasSettings ? `<Override PartName="/word/settings.xml" ContentType="${CT}settings+xml"/>` : '') +
      (hasFooter ? `<Override PartName="/word/footer1.xml" ContentType="${CT}footer+xml"/>` : '') +
      (hasFooter && eo ? `<Override PartName="/word/footer2.xml" ContentType="${CT}footer+xml"/>` : '') +
      (hasHeader ? `<Override PartName="/word/header1.xml" ContentType="${CT}header+xml"/>` : '') +
      (hasHeader && eo ? `<Override PartName="/word/header2.xml" ContentType="${CT}header+xml"/>` : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>']);
    files.push(['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${xml(doc.title)}</dc:title><dc:creator>${xml(doc.meta.author || 'mvmOffice')}</dc:creator>` +
      (doc.meta.description ? `<dc:description>${xml(doc.meta.description)}</dc:description>` : '') +
      (doc.meta.lang ? `<dc:language>${xml(doc.meta.lang)}</dc:language>` : '') + '</cp:coreProperties>']);
    files.push(['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdStyles" Type="${P}styles" Target="styles.xml"/>` +
      `<Relationship Id="rIdNumbering" Type="${P}numbering" Target="numbering.xml"/>` +
      (hasSettings ? `<Relationship Id="rIdSettings" Type="${P}settings" Target="settings.xml"/>` : '') +
      (hasFooter ? `<Relationship Id="rIdFooter" Type="${P}footer" Target="footer1.xml"/>` : '') +
      (hasFooter && eo ? `<Relationship Id="rIdFooterEven" Type="${P}footer" Target="footer2.xml"/>` : '') +
      (hasHeader ? `<Relationship Id="rIdHeader" Type="${P}header" Target="header1.xml"/>` : '') +
      (hasHeader && eo ? `<Relationship Id="rIdHeaderEven" Type="${P}header" Target="header2.xml"/>` : '') +
      w.rels.map(([id, kind, target]) => kind === 'hyperlink'
        ? `<Relationship Id="${id}" Type="${P}hyperlink" Target="${xml(target)}" TargetMode="External"/>`
        : `<Relationship Id="${id}" Type="${P}image" Target="${xml(target)}"/>`).join('') +
      '</Relationships>']);
    files.push(['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      `<w:body>${body}${w.sectPr()}</w:body></w:document>`]);
    files.push(['word/styles.xml', styles(M.isBook(doc))]);
    files.push(['word/numbering.xml', w.numbering()]);
    if (hasSettings) {
      files.push(['word/settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        (eo ? '<w:evenAndOddHeaders/>' : '') + (b.mirror ? '<w:mirrorMargins/>' : '') + '</w:settings>']);
    }
    if (hasFooter) {
      // Odd sheets are on the right, even ones on the left.
      files.push(['word/footer1.xml', footer(b.numbers === 'outside' ? 'right' : b.numbers)]);
      if (eo) files.push(['word/footer2.xml', footer(b.numbers === 'outside' ? 'left' : b.numbers === 'right' ? 'right' : 'center')]);
    }
    if (hasHeader) {
      const kind = b.header === 'title' ? 'title' : 'chapter';
      files.push(['word/header1.xml', b.header === 'book' ? header('chapter', 'right', doc.title) : header(kind, 'center', doc.title)]);
      if (eo) files.push(['word/header2.xml', b.header === 'book' ? header('title', 'left', doc.title) : header(kind, 'center', doc.title)]);
    }
    w.media.forEach(m => files.push(['word/media/' + m.name, m.bytes]));
    return X.zip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  window.MvmOfficeDocx = { document };
})();
