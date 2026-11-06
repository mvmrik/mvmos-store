// mvmOffice — the document as an e-book (.epub, EPUB 3).
//
// Every page of text becomes a chapter. The headings make the navigation, a
// book gets its cover and title page, the notes become real EPUB footnotes —
// a number in the sentence that opens the note in a pop-up in the readers
// that support it, and stay listed at the end of the chapter in the rest —
// and pictures, links, tables and the values of the formulas travel along.
(function () {
  'use strict';
  if (window.MvmOfficeEpub) return;
  const M = window.MvmOfficeModel;

  const xml = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hex = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : null);
  const safeHref = h => (/^(https?:\/\/|mailto:)/i.test(String(h || '').trim()) ? String(h).trim() : null);
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

  const CSS = `html { font-size: 100%; }
body { font-family: serif; line-height: 1.45; margin: 0; padding: 0 .4em; }
body.book p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
body.book h1 + p, body.book h2 + p, body.book h3 + p, body.book h4 + p, body.book li p, body.book blockquote p, body.book td p, body.book .notes p { text-indent: 0; }
body.text p { margin: 0 0 .6em; }
h1 { font-size: 1.6em; margin: 1.4em 0 .6em; page-break-before: always; }
h2 { font-size: 1.3em; margin: 1.2em 0 .5em; } h3 { font-size: 1.1em; margin: 1em 0 .4em; } h4 { font-size: 1em; margin: 1em 0 .4em; }
h1, h2, h3, h4 { page-break-after: avoid; }
body.book h1 { text-align: center; }
.al-center { text-align: center; } .al-right { text-align: right; } .al-left { text-align: left; } .al-justify { text-align: justify; }
blockquote { margin: .6em 0 .6em 1em; padding-left: .8em; border-left: 3px solid #bbb; }
hr { border: 0; border-top: 1px solid #999; margin: 1.2em 0; }
ul, ol { margin: 0 0 .6em; padding-left: 1.6em; }
table { border-collapse: collapse; margin: .6em 0; max-width: 100%; }
td, th { border: 1px solid #999; padding: .15em .4em; vertical-align: top; }
th { background: #eee; }
.img { text-align: center; margin: .8em 0; page-break-inside: avoid; }
.img img { max-width: 100%; height: auto; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage h1 { page-break-before: auto; font-size: 2em; margin: 0 0 .4em; }
.titlepage .sub { font-size: 1.2em; margin: 0 0 1.6em; }
.titlepage .author { font-size: 1.1em; letter-spacing: .06em; }
sup a.noteref { text-decoration: none; font-size: .8em; }
.notes { margin-top: 2em; border-top: 1px solid #999; padding-top: .6em; font-size: .9em; }
.notes .notes-title { font-weight: bold; margin: 0 0 .4em; text-indent: 0; }
aside.fn p { margin: 0 0 .3em; text-indent: 0; }
.toc { list-style: none; padding: 0; } .toc li { margin: .15em 0; } .toc a { text-decoration: none; color: inherit; }
.toc .l2 { margin-left: 1.2em; } .toc .l3 { margin-left: 2.4em; } .toc .l4 { margin-left: 3.6em; }
.toc-title { font-size: 1.4em; font-weight: bold; margin: 0 0 .6em; text-indent: 0; }
`;

  function bytes(dataUri) {
    const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUri);
    if (!m) return null;
    const bin = atob(m[2]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { type: m[1], data: out };
  }

  function book(doc, office, o) {
    const X = window.MvmOfficeXlsx;
    const isBook = M.isBook(doc);
    const eng = office.engine;
    const files = [];
    const media = new Map();                  // image id -> { file, type }
    // Fonts the text uses, brought along so the book looks the same on any reader: family -> { stack, faces: [...] }.
    const fontOf = {};
    for (const [family, f] of Object.entries(o.fonts || {})) {
      fontOf[family] = { stack: `'${family}', ${f.fallback || 'serif'}`, faces: f.faces || [] };
    }
    const addImage = (id, srcOverride) => {
      if (media.has(id)) return media.get(id);
      const im = srcOverride ? { src: srcOverride } : doc.images[id];
      const b = im && bytes(im.src);
      if (!b) return null;
      const file = 'images/img' + (media.size + 1) + '.' + EXT[b.type];
      const rec = { file, type: b.type, data: b.data, id: 'img' + (media.size + 1) };
      media.set(id, rec);
      return rec;
    };

    // Which chapter file every heading lands in.
    const heads = M.headings(doc, 4);
    const where = new Map(heads.map(h => [h.n, 'chap' + (h.page + 1) + '.xhtml#h' + h.n]));
    let headNo = 0, noteId = 0;

    function inline(nodes, ctx) {
      let s = '';
      for (const n of nodes || []) {
        if (n.type === 'hard_break') { s += '<br/>'; continue; }
        if (n.type === 'note') {
          const id = ++noteId, no = ++ctx.noteNo;
          ctx.notes.push({ id, no, text: n.attrs && n.attrs.text });
          s += `<sup><a epub:type="noteref" class="noteref" id="r${id}" href="#n${id}">${no}</a></sup>`;
          continue;
        }
        let t;
        if (n.type === 'text') t = xml(n.text);
        else if (n.type === 'formula') t = xml(office.inlineText(n.attrs.expr, n.attrs.fmt));
        else continue;
        for (const m of n.marks || []) {
          if (m.type === 'strong') t = `<strong>${t}</strong>`;
          else if (m.type === 'em') t = `<em>${t}</em>`;
          else if (m.type === 'underline') t = `<u>${t}</u>`;
          else if (m.type === 'strike') t = `<s>${t}</s>`;
          else if (m.type === 'font' && m.attrs && fontOf[m.attrs.family]) t = `<span style="font-family:${xml(fontOf[m.attrs.family].stack)}">${t}</span>`;
          else if (m.type === 'color' && hex(m.attrs && m.attrs.color)) t = `<span style="color:${m.attrs.color}">${t}</span>`;
          else if (m.type === 'link' && safeHref(m.attrs && m.attrs.href)) t = `<a href="${xml(safeHref(m.attrs.href))}">${t}</a>`;
        }
        s += t;
      }
      return s;
    }
    const alignClass = a => (a && /^(left|center|right|justify)$/.test(a) ? ` class="al-${a}"` : '');

    function table(t) {
      if (!t) return '';
      let s = '<table>';
      const header = t.header && t.rows > 1;
      for (let r = 0; r < t.rows; r++) {
        const tag = header && r === 0 ? 'th' : 'td';
        s += '<tr>';
        for (let c = 0; c < t.cols; c++) {
          const cell = t.cells[r + ',' + c] || {};
          const v = eng.value(t, r, c);
          const a = cell.a || (typeof v === 'number' ? 'right' : null);
          let st = a ? `text-align:${a};` : '';
          if (cell.b) st += 'font-weight:bold;';
          if (cell.i) st += 'font-style:italic;';
          if (cell.bg && hex(cell.bg)) st += `background:${cell.bg};`;
          if (cell.fg && hex(cell.fg)) st += `color:${cell.fg};`;
          s += `<${tag}${st ? ` style="${st}"` : ''}>${xml(eng.display(t, r, c))}</${tag}>`;
        }
        s += '</tr>';
      }
      return s + '</table>';
    }

    function blocks(nodes, ctx) { return (nodes || []).map(n => block(n, ctx)).join(''); }
    function block(n, ctx) {
      const a = n.attrs || {};
      switch (n.type) {
        case 'paragraph': {
          const body = inline(n.content, ctx);
          return `<p${alignClass(a.align)}>${body || '<br/>'}</p>`;
        }
        case 'heading': {
          const id = ++headNo, level = Math.min(4, Math.max(1, a.level || 1));
          return `<h${level} id="h${id}"${alignClass(a.align)}>${inline(n.content, ctx)}</h${level}>`;
        }
        case 'blockquote': return `<blockquote>${blocks(n.content, ctx)}</blockquote>`;
        case 'horizontal_rule': return '<hr/>';
        case 'bullet_list': return `<ul>${(n.content || []).map(li => `<li>${blocks(li.content, ctx)}</li>`).join('')}</ul>`;
        case 'ordered_list': return `<ol${a.order > 1 ? ` start="${a.order | 0}"` : ''}>${(n.content || []).map(li => `<li>${blocks(li.content, ctx)}</li>`).join('')}</ol>`;
        case 'table_embed': return table(doc.tables[a.tableId]);
        case 'image': {
          const im = addImage(a.imageId);
          if (!im) return '';
          const w = Math.min(100, Math.max(5, a.width | 0 || 60));
          return `<div class="img"><img src="${im.file}" alt="${xml(a.alt || '')}" style="width:${w}%"/></div>`;
        }
        case 'toc': {
          const list = heads.filter(h => h.level <= (a.depth || 2));
          return `<p class="toc-title">${xml(o.toc)}</p><ul class="toc">` +
            list.map(h => `<li class="l${h.level}"><a href="${where.get(h.n)}">${xml(h.text)}</a></li>`).join('') + '</ul>';
        }
        case 'page_break': return '';
        default: return n.content ? blocks(n.content, ctx) : '';
      }
    }

    const page = (title, body, cls) =>
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(o.lang)}" xml:lang="${xml(o.lang)}">` +
      `<head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>` +
      `<body class="${cls || (isBook ? 'book' : 'text')}">${body}</body></html>`;

    // The chapters.
    const chapters = doc.pages.map((p, i) => {
      const ctx = { noteNo: 0, notes: [] };
      let body = blocks((p.content && p.content.content) || [], ctx);
      if (ctx.notes.length) {
        body += `<section epub:type="endnotes" class="notes"><p class="notes-title">${xml(o.notes)}</p>` +
          ctx.notes.map(n => `<aside epub:type="footnote" class="fn" id="n${n.id}"><p><a href="#r${n.id}">${n.no}</a>. ${xml(n.text)}</p></aside>`).join('') + '</section>';
      }
      const file = 'chap' + (i + 1) + '.xhtml';
      return { file, id: 'c' + (i + 1), title: p.title || doc.title, xhtml: page(p.title || doc.title, body) };
    });

    // Cover and title page of a book.
    const front = [];
    let coverRec = null;
    const cv = o.cover;
    if (isBook) {
      coverRec = cv.image ? addImage('__cover', cv.image.src) : null;
      if (coverRec) front.push({ file: 'cover.xhtml', id: 'cover', title: cv.title, xhtml: page(cv.title, `<div class="cover"><img src="${coverRec.file}" alt="${xml(cv.title)}"/></div>`, 'cover') });
      front.push({
        file: 'title.xhtml', id: 'titlepage', title: cv.title,
        xhtml: page(cv.title, `<div class="titlepage"><h1>${xml(cv.title)}</h1>` + (cv.author ? `<p class="author">${xml(cv.author)}</p>` : '') + '</div>'),
      });
    }

    // Navigation: the headings, nested by level; a chapter without any is listed by its name.
    const items = [];
    doc.pages.forEach((p, i) => {
      const own = heads.filter(h => h.page === i);
      if (!own.length) items.push({ level: 1, text: p.title || doc.title, href: chapters[i].file });
      else own.forEach(h => items.push({ level: h.level, text: h.text, href: where.get(h.n) }));
    });
    const root = { level: 0, kids: [] };
    const stack = [root];
    for (const it of items) {
      const node = { level: it.level, it, kids: [] };
      while (stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    }
    const ol = kids => kids.length ? `<ol>${kids.map(k => `<li><a href="${k.it.href}">${xml(k.it.text)}</a>${ol(k.kids)}</li>`).join('')}</ol>` : '';
    const nav = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(o.lang)}" xml:lang="${xml(o.lang)}">` +
      `<head><meta charset="utf-8"/><title>${xml(o.toc)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>` +
      `<body><nav epub:type="toc" id="toc"><h1>${xml(o.toc)}</h1>${ol(root.kids)}</nav></body></html>`;

    // The package.
    // randomUUID needs a secure page; the bytes are available everywhere.
    const rnd = new Uint8Array(16);
    crypto.getRandomValues(rnd);
    rnd[6] = (rnd[6] & 0x0f) | 0x40; rnd[8] = (rnd[8] & 0x3f) | 0x80;
    const h = [...rnd].map(b => b.toString(16).padStart(2, '0')).join('');
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    const author = doc.meta.author;
    const fontFaces = [...new Map(Object.values(fontOf).flatMap(f => f.faces).map(fc => [fc.file, fc])).values()];
    const spineFront = front.map(f => f.id);
    const opf = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xml(o.lang)}">` +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>` +
      `<dc:title>${xml(doc.title)}</dc:title>` +
      `<dc:language>${xml(o.lang)}</dc:language>` +
      (author ? `<dc:creator>${xml(author)}</dc:creator>` : '') +
      (doc.meta.description ? `<dc:description>${xml(doc.meta.description)}</dc:description>` : '') +
      `<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>` +
      '</metadata><manifest>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="css" href="style.css" media-type="text/css"/>' +
      front.map(f => `<item id="${f.id}" href="${f.file}" media-type="application/xhtml+xml"/>`).join('') +
      chapters.map(c => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('') +
      fontFaces.map((fc, i) => `<item id="font${i + 1}" href="fonts/${fc.file}" media-type="${fc.mime}"/>`).join('') +
      [...media.values()].map(m => `<item id="${m.id}" href="${m.file}" media-type="${m.type}"${m === coverRec ? ' properties="cover-image"' : ''}/>`).join('') +
      '</manifest><spine>' +
      spineFront.map(id => `<itemref idref="${id}"/>`).join('') +
      '<itemref idref="nav" linear="no"/>' +
      chapters.map(c => `<itemref idref="${c.id}"/>`).join('') +
      '</spine></package>';

    files.push(['mimetype', 'application/epub+zip']);
    files.push(['META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
      '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>']);
    files.push(['OEBPS/content.opf', opf]);
    files.push(['OEBPS/nav.xhtml', nav]);
    const faceCss = Object.entries(fontOf).map(([family, f]) => f.faces.map(fc =>
      `@font-face { font-family: '${family}'; font-style: ${fc.style}; font-weight: ${fc.weight}; src: url(fonts/${fc.file}) format('${fc.format}');` +
      (fc.range ? ` unicode-range: ${fc.range};` : '') + ' }').join('\n')).join('\n');
    files.push(['OEBPS/style.css', CSS + faceCss + '\n']);
    fontFaces.forEach(fc => files.push(['OEBPS/fonts/' + fc.file, fc.data]));
    front.forEach(f => files.push(['OEBPS/' + f.file, f.xhtml]));
    chapters.forEach(c => files.push(['OEBPS/' + c.file, c.xhtml]));
    media.forEach(m => files.push(['OEBPS/' + m.file, m.data]));
    return X.zip(files, 'application/epub+zip');
  }

  window.MvmOfficeEpub = { book };
})();
