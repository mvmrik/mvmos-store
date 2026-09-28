// mvmOffice — formula engine shared by data sheets, tables embedded in text
// pages and formulas written straight into the text.
//
// Every table in a document has a name, so a formula can reach any of them:
//   A1, B2:C9, A:A          cells of the table the formula lives in
//   Prices!B2, 'My data'!A:A the same, in another table
//   Prices[Price]           a whole column, found by the text in its first row
// A formula in the text has no table of its own, so its references always
// name one.
//
// Values: number, string, boolean, null (empty), FErr, and Matrix for ranges.
(function () {
  if (window.MvmOfficeFormula) return;

  // ── Values ───────────────────────────────────────────────────────────────
  class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const ERR = {
    DIV0: new FErr('#DIV/0!'), REF: new FErr('#REF!'), NAME: new FErr('#NAME?'),
    VALUE: new FErr('#VALUE!'), NA: new FErr('#N/A'), CIRC: new FErr('#CIRC!'),
    NUM: new FErr('#NUM!'), ERROR: new FErr('#ERROR!'),
  };
  const ERR_BY_CODE = {};
  Object.values(ERR).forEach(e => { ERR_BY_CODE[e.code] = e; });
  const isErr = v => v instanceof FErr;

  class Matrix {
    constructor(rows) { this.rows = rows; this.h = rows.length; this.w = rows.length ? rows[0].length : 0; }
    flat() { const out = []; for (const r of this.rows) for (const v of r) out.push(v); return out; }
  }
  const isMatrix = v => v instanceof Matrix;

  // ── Addresses ────────────────────────────────────────────────────────────
  function colName(c) {
    let s = '';
    c += 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function colIndex(name) {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
  const COL_RE = /^(\$?)([A-Za-z]{1,3})$/;
  function parseCell(word) {
    const m = CELL_RE.exec(word);
    if (!m) return null;
    const r = parseInt(m[4], 10) - 1;
    if (r < 0) return null;
    return { c: colIndex(m[2]), r, absC: !!m[1], absR: !!m[3] };
  }
  function cellText(r, c, absR, absC) {
    return (absC ? '$' : '') + colName(c) + (absR ? '$' : '') + (r + 1);
  }
  // A table name needs quotes when it is not a plain word or could be read as
  // something else (a cell address, a boolean, a number).
  function quoteName(name) {
    const plain = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name)
      && !CELL_RE.test(name) && !COL_RE.test(name) && !/^(true|false)$/i.test(name);
    return plain ? name : "'" + name.replace(/'/g, "''") + "'";
  }

  // ── Tokenizer ────────────────────────────────────────────────────────────
  function tokenize(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const start = i;
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
        // "1:3" style row ranges are not supported; a number is a number.
        out.push({ t: 'num', v: parseFloat(m[0]), s: start, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      if (ch === '"') {
        let j = i + 1, v = '';
        for (;;) {
          if (j >= n) throw new Error('unterminated string');
          if (src[j] === '"') { if (src[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
          v += src[j++];
        }
        out.push({ t: 'str', v, s: start, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === "'") {
        let j = i + 1, v = '';
        for (;;) {
          if (j >= n) throw new Error('unterminated name');
          if (src[j] === "'") { if (src[j + 1] === "'") { v += "'"; j += 2; continue; } break; }
          v += src[j++];
        }
        out.push({ t: 'name', v, quoted: true, s: start, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === '[') {
        const j = src.indexOf(']', i);
        if (j < 0) throw new Error('unterminated column');
        out.push({ t: 'colspec', v: src.slice(i + 1, j).trim(), s: start, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === '#') {
        const m = /^#[A-Za-z0-9/]+[!?]?/.exec(src.slice(i));
        if (m && ERR_BY_CODE[m[0].toUpperCase()]) {
          out.push({ t: 'err', v: ERR_BY_CODE[m[0].toUpperCase()], s: start, e: i + m[0].length });
          i += m[0].length;
          continue;
        }
        throw new Error('unexpected #');
      }
      const w = /^[\p{L}\p{N}_.$]+/u.exec(src.slice(i));
      if (w) {
        out.push({ t: 'name', v: w[0], quoted: false, s: start, e: i + w[0].length });
        i += w[0].length;
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        out.push({ t: 'op', v: two, s: start, e: i + 2 });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: 'op', v: ch, s: start, e: i + 1 }); i++; continue; }
      if ('(),;:!'.includes(ch)) { out.push({ t: ch === ';' ? ',' : ch, v: ch, s: start, e: i + 1 }); i++; continue; }
      throw new Error('unexpected ' + ch);
    }
    out.push({ t: 'end', s: n, e: n });
    return out;
  }

  // ── Parser ───────────────────────────────────────────────────────────────
  // Reference nodes keep their source span so a formula can be rewritten in
  // place (renamed table, inserted row, pasted elsewhere) without reformatting
  // the rest of what the user typed.
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = (o = 0) => toks[p + o];
    const next = () => toks[p++];
    const expect = t => { const k = next(); if (k.t !== t) throw new Error('expected ' + t); return k; };

    function parseCmp() {
      let a = parseConcat();
      while (peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = next().v;
        a = { t: 'bin', op, a, b: parseConcat() };
      }
      return a;
    }
    function parseConcat() {
      let a = parseAdd();
      while (peek().t === 'op' && peek().v === '&') { next(); a = { t: 'bin', op: '&', a, b: parseAdd() }; }
      return a;
    }
    function parseAdd() {
      let a = parseMul();
      while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = next().v;
        a = { t: 'bin', op, a, b: parseMul() };
      }
      return a;
    }
    function parseMul() {
      let a = parsePow();
      while (peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = next().v;
        a = { t: 'bin', op, a, b: parsePow() };
      }
      return a;
    }
    function parsePow() {
      let a = parseUnary();
      while (peek().t === 'op' && peek().v === '^') { next(); a = { t: 'bin', op: '^', a, b: parseUnary() }; }
      return a;
    }
    function parseUnary() {
      if (peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
        const op = next().v;
        const a = parseUnary();
        return op === '-' ? { t: 'neg', a } : a;
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let a = parsePrimary();
      while (peek().t === 'op' && peek().v === '%') { next(); a = { t: 'pct', a }; }
      return a;
    }
    // After "Name!" or at a bare word: A1, A1:B2, A:A.
    function parseAddress(table, tableTok, first) {
      const cell = parseCell(first.v);
      const col = !cell && COL_RE.exec(first.v);
      if (cell) {
        if (peek().t === ':' && peek(1).t === 'name' && parseCell(peek(1).v)) {
          next();
          const second = next();
          const c2 = parseCell(second.v);
          return {
            t: 'range', table, tableTok, r1: cell.r, c1: cell.c, absR1: cell.absR, absC1: cell.absC,
            r2: c2.r, c2: c2.c, absR2: c2.absR, absC2: c2.absC, s: (tableTok || first).s, e: second.e,
          };
        }
        return { t: 'ref', table, tableTok, r: cell.r, c: cell.c, absR: cell.absR, absC: cell.absC, s: (tableTok || first).s, e: first.e };
      }
      if (col && peek().t === ':' && peek(1).t === 'name' && COL_RE.test(peek(1).v)) {
        next();
        const second = next();
        const m2 = COL_RE.exec(second.v);
        return {
          t: 'cols', table, tableTok, c1: colIndex(col[2]), absC1: !!col[1], c2: colIndex(m2[2]), absC2: !!m2[1],
          s: (tableTok || first).s, e: second.e,
        };
      }
      return null;
    }
    function parsePrimary() {
      const k = next();
      if (k.t === 'num') return { t: 'num', v: k.v };
      if (k.t === 'str') return { t: 'str', v: k.v };
      if (k.t === 'err') return { t: 'errlit', v: k.v };
      if (k.t === '(') { const e = parseCmp(); expect(')'); return e; }
      if (k.t === 'name') {
        if (peek().t === '!') {
          next();
          const addr = next();
          if (addr.t !== 'name') throw new Error('expected address');
          const node = parseAddress(k.v, k, addr);
          if (!node) throw new Error('bad address');
          return node;
        }
        if (peek().t === 'colspec') {
          const cs = next();
          return { t: 'col', table: k.v, tableTok: k, col: cs.v, s: k.s, e: cs.e };
        }
        if (!k.quoted && peek().t === '(') {
          next();
          const args = [];
          if (peek().t !== ')') {
            for (;;) {
              if (peek().t === ',' || peek().t === ')') args.push({ t: 'blank' });
              else args.push(parseCmp());
              if (peek().t === ',') { next(); continue; }
              break;
            }
          }
          expect(')');
          return { t: 'fn', name: k.v.toUpperCase(), args };
        }
        if (!k.quoted) {
          const node = parseAddress(null, null, k);
          if (node) return node;
          if (/^true$/i.test(k.v)) return { t: 'bool', v: true };
          if (/^false$/i.test(k.v)) return { t: 'bool', v: false };
        }
        return { t: 'unknown', v: k.v };
      }
      throw new Error('unexpected ' + (k.v || k.t));
    }
    const ast = parseCmp();
    if (peek().t !== 'end') throw new Error('unexpected ' + (peek().v || peek().t));
    return ast;
  }

  function walk(node, fn) {
    if (!node) return;
    fn(node);
    if (node.a) walk(node.a, fn);
    if (node.b) walk(node.b, fn);
    if (node.args) node.args.forEach(x => walk(x, fn));
  }

  // Rewrite every reference in a formula. `fn(node)` returns the new source
  // text for that reference, or undefined to keep it. Anything that does not
  // parse is left exactly as typed.
  function mapRefs(src, fn) {
    let ast;
    try { ast = parse(src); } catch (e) { return src; }
    const edits = [];
    walk(ast, n => {
      if (n.t === 'ref' || n.t === 'range' || n.t === 'cols' || n.t === 'col') {
        const out = fn(n);
        if (out !== undefined && out !== null) edits.push({ s: n.s, e: n.e, v: out });
      }
    });
    edits.sort((x, y) => y.s - x.s);
    let out = src;
    for (const ed of edits) out = out.slice(0, ed.s) + ed.v + out.slice(ed.e);
    return out;
  }

  function refToText(n, tableName) {
    const pre = tableName ? quoteName(tableName) + '!' : '';
    if (n.t === 'ref') return pre + cellText(n.r, n.c, n.absR, n.absC);
    if (n.t === 'range') return pre + cellText(n.r1, n.c1, n.absR1, n.absC1) + ':' + cellText(n.r2, n.c2, n.absR2, n.absC2);
    if (n.t === 'cols') return pre + (n.absC1 ? '$' : '') + colName(n.c1) + ':' + (n.absC2 ? '$' : '') + colName(n.c2);
    if (n.t === 'col') return quoteName(tableName) + '[' + n.col + ']';
    return '';
  }

  // ── Literals typed into a cell ───────────────────────────────────────────
  const DAY_MS = 86400000;
  const EPOCH = Date.UTC(1899, 11, 30);
  function dateSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS); }
  function serialDate(n) { return new Date(EPOCH + Math.round(n) * DAY_MS); }
  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1;
  }
  const CURRENCY_SUFFIX = /^([-+]?\d+(?:[.,]\d+)?)\s*(€|\$|£|¥|лв\.?|zł|kr|₽|₴|₺|CHF)$/i;
  const CURRENCY_PREFIX = /^(€|\$|£|¥)\s*([-+]?\d+(?:[.,]\d+)?)$/;

  // What a typed value means: a number, a date, a percentage, TRUE/FALSE or
  // text. `fmt` is the display format the value suggests when the cell has
  // none of its own ("20%" stays a percentage, "5 €" stays money).
  function parseLiteral(raw) {
    if (raw == null) return { v: null };
    const s = String(raw);
    if (s.startsWith("'")) return { v: s.slice(1) };
    const t = s.trim();
    if (t === '') return { v: null };
    if (/^[-+]?(\d+([.,]\d+)?|[.,]\d+)([eE][-+]?\d+)?$/.test(t)) return { v: parseFloat(t.replace(',', '.')) };
    let m = /^([-+]?\d+(?:[.,]\d+)?)\s*%$/.exec(t);
    if (m) return { v: parseFloat(m[1].replace(',', '.')) / 100, fmt: { type: 'percent', dec: (m[1].split(/[.,]/)[1] || '').length } };
    m = CURRENCY_SUFFIX.exec(t);
    if (m) {
      const dec = (m[1].split(/[.,]/)[1] || '').length;
      return { v: parseFloat(m[1].replace(',', '.')), fmt: { type: 'currency', sym: m[2], pos: 'after', dec: dec ? 2 : 0 } };
    }
    m = CURRENCY_PREFIX.exec(t);
    if (m) {
      const dec = (m[2].split(/[.,]/)[1] || '').length;
      return { v: parseFloat(m[2].replace(',', '.')), fmt: { type: 'currency', sym: m[1], pos: 'before', dec: dec ? 2 : 0 } };
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m && validYMD(+m[1], +m[2], +m[3])) return { v: dateSerial(+m[1], +m[2], +m[3]), fmt: { type: 'date' } };
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
    if (m && validYMD(+m[3], +m[2], +m[1])) return { v: dateSerial(+m[3], +m[2], +m[1]), fmt: { type: 'date' } };
    if (/^true$/i.test(t)) return { v: true };
    if (/^false$/i.test(t)) return { v: false };
    return { v: s };
  }

  // ── Display ──────────────────────────────────────────────────────────────
  const LOCALES = { en: 'en-US', bg: 'bg-BG', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP', 'pt-BR': 'pt-BR', ru: 'ru-RU', 'zh-CN': 'zh-CN' };
  // Whose numbers and dates these are: the person looking, never the file.
  // Documents keep plain values (1234.5, 2026-04-03), so a shared file means
  // the same everywhere and only its look changes from person to person.
  const REGION = { lang: '', dateFormat: '' };
  function setRegion(r) {
    REGION.lang = (r && r.lang) || '';
    REGION.dateFormat = (r && r.date_format) || '';
    _seps = null;
  }
  function locale() { return LOCALES[REGION.lang || (window.mvmOS && window.mvmOS.lang) || 'en'] || 'en-US'; }
  let _seps = null;
  function seps() {
    if (_seps && _seps.loc === locale()) return _seps;
    const parts = new Intl.NumberFormat(locale()).formatToParts(1234567.5);
    const find = t => (parts.find(p => p.type === t) || {}).value;
    const dp = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2026, 0, 2));
    return (_seps = { loc: locale(), dec: find('decimal') || '.', group: find('group') || ',', dateSep: ((dp.find(p => p.type === 'literal') || {}).value || '/').trim()[0] || '/' });
  }
  // The day/month order to read and show dates in.
  function dateOrder() {
    const f = REGION.dateFormat;
    if (f === 'MM/DD/YYYY') return 'MDY';
    if (f === 'YYYY-MM-DD') return 'YMD';
    if (f === 'DD/MM/YYYY') return 'DMY';
    return locale() === 'en-US' ? 'MDY' : /^(ja|zh)/.test(locale()) ? 'YMD' : 'DMY';
  }

  // A number as the person typed it ("1 234,5", "1.234,5", "1,234.5", "0,5")
  // in plain form ("1234.5"), or null. A lone separator that is neither this
  // person's decimal mark nor a valid thousands group is read as decimal.
  function plainNumber(t) {
    const m = /^([-+]?)(.+)$/.exec(t);
    if (!m) return null;
    const sign = m[1] === '-' ? '-' : '';
    let b = m[2], grouped = false;
    if (!/^[\d.,\s\u00a0\u202f']+$/.test(b) || !/\d/.test(b)) return null;
    if (/[\s\u00a0\u202f']/.test(b)) {
      if (!/^\d{1,3}([\s\u00a0\u202f']\d{3})+([.,]\d+)?$/.test(b)) return null;
      b = b.replace(/[\s\u00a0\u202f']/g, '');
      grouped = true;
    }
    const { dec, group } = seps();
    const dots = (b.match(/\./g) || []).length, commas = (b.match(/,/g) || []).length;
    let ip = b, fp = '';
    const groups = (s, ch) => new RegExp('^\\d{1,3}(\\' + ch + '\\d{3})+$').test(s);
    if (dots && commas) {
      const d = b.lastIndexOf('.') > b.lastIndexOf(',') ? '.' : ',';
      const g = d === '.' ? ',' : '.';
      const at = b.lastIndexOf(d);
      ip = b.slice(0, at); fp = b.slice(at + 1);
      if (fp.includes(g) || fp.includes(d) || !groups(ip, g)) return null;
      ip = ip.split(g).join('');
      grouped = true;
    } else if (dots + commas > 1) {
      const ch = dots ? '.' : ',';
      if (!groups(b, ch)) return null;
      ip = b.split(ch).join('');
      grouped = true;
    } else if (dots + commas === 1) {
      const ch = dots ? '.' : ',';
      if (ch !== dec && ch === group && groups(b, ch)) { ip = b.split(ch).join(''); grouped = true; }
      else { const at = b.indexOf(ch); ip = b.slice(0, at); fp = b.slice(at + 1); }
    }
    if (fp && !/^\d+$/.test(fp)) return null;
    if (!/^\d*$/.test(ip) || (!ip && !fp)) return null;
    return { text: sign + (ip || '0') + (fp ? '.' + fp : ''), dec: fp.length, grouped };
  }

  // What the person typed into a cell, in the form documents keep. `fmt` is
  // the display format it asks for when the cell has none of its own.
  function fromInput(raw) {
    if (raw == null) return { v: raw };
    const s = String(raw);
    if (s.startsWith('=') || s.startsWith("'")) return { v: s };
    const t = s.trim();
    if (!t) return { v: s };
    if (/^[-+]?(\d+\.?\d*|\.\d+)[eE][-+]?\d+$/.test(t)) return { v: t };
    let n = plainNumber(t);
    if (n) return n.grouped ? { v: n.text, fmt: { type: 'number', dec: n.dec } } : { v: n.text };
    let m = /^(.+?)\s*%$/.exec(t);
    if (m && (n = plainNumber(m[1]))) return { v: n.text + '%' };
    m = /^(.+?)\s*(€|\$|£|¥|лв\.?|zł|kr|₽|₴|₺|CHF)$/i.exec(t);
    if (m && (n = plainNumber(m[1]))) return { v: n.text + ' ' + m[2], fmt: n.grouped ? { type: 'currency', sym: m[2], pos: 'after', dec: n.dec ? 2 : 0 } : undefined };
    m = /^(€|\$|£|¥)\s*(.+)$/.exec(t);
    if (m && (n = plainNumber(m[2]))) return { v: m[1] + n.text, fmt: n.grouped ? { type: 'currency', sym: m[1], pos: 'before', dec: n.dec ? 2 : 0 } : undefined };
    const iso = (y, mo, d) => validYMD(y, mo, d) ? { v: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') } : null;
    m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(t);
    if (m) return iso(+m[1], +m[2], +m[3]) || { v: s };
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
    if (m) {
      const md = dateOrder() === 'MDY';
      return iso(+m[3], md ? +m[1] : +m[2], md ? +m[2] : +m[1]) || { v: s };
    }
    return { v: s };
  }
  // A kept value the way this person would type it, for editing.
  function editText(raw) {
    if (raw == null) return '';
    const s = String(raw);
    const d = seps().dec;
    const loc = x => d === '.' ? x : x.replace('.', d);
    let m;
    if (/^[-+]?\d*\.?\d+$/.test(s)) return loc(s);
    if ((m = /^([-+]?\d*\.?\d+)(\s*%)$/.exec(s))) return loc(m[1]) + m[2];
    if ((m = /^([-+]?\d*\.?\d+)(\s*\S+)$/.exec(s)) && CURRENCY_SUFFIX.test(s)) return loc(m[1]) + m[2];
    if ((m = /^(€|\$|£|¥)(\s*)([-+]?\d*\.?\d+)$/.exec(s))) return m[1] + m[2] + loc(m[3]);
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)) && validYMD(+m[1], +m[2], +m[3])) return fmtDate(dateSerial(+m[1], +m[2], +m[3]));
    return s;
  }
  const _nf = {};
  function nf(opts) {
    const key = locale() + JSON.stringify(opts);
    return _nf[key] || (_nf[key] = new Intl.NumberFormat(locale(), opts));
  }
  function fmtGeneral(n) {
    if (!isFinite(n)) return ERR.NUM.code;
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, 'e');
    return nf({ maximumFractionDigits: 10, useGrouping: false }).format(parseFloat(n.toPrecision(15)));
  }
  function fmtDate(n) {
    const dt = serialDate(n);
    const y = String(dt.getUTCFullYear()), mo = String(dt.getUTCMonth() + 1).padStart(2, '0'), d = String(dt.getUTCDate()).padStart(2, '0');
    const o = dateOrder();
    if (o === 'YMD') return y + '-' + mo + '-' + d;
    if (o === 'MDY') return mo + '/' + d + '/' + y;
    const sep = seps().dateSep === '.' ? '.' : '/';
    return d + sep + mo + sep + y;
  }
  function toText(v) {
    if (v == null) return '';
    if (isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return fmtGeneral(v);
    if (isMatrix(v)) return toText(v.rows[0] && v.rows[0][0]);
    return String(v);
  }
  // fmt: {type: general|number|percent|currency|date|text, dec, sym, pos}
  function formatValue(v, fmt) {
    if (isMatrix(v)) v = v.h && v.w ? v.rows[0][0] : null;
    if (typeof v !== 'number' || !fmt || !fmt.type || fmt.type === 'general' || fmt.type === 'text') return toText(v);
    if (!isFinite(v)) return ERR.NUM.code;
    const dec = fmt.dec == null ? 2 : Math.max(0, Math.min(10, fmt.dec | 0));
    if (fmt.type === 'number') return nf({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    if (fmt.type === 'percent') return nf({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v * 100) + '%';
    if (fmt.type === 'currency') {
      const num = nf({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
      const sym = fmt.sym || '';
      if (!sym) return num;
      return fmt.pos === 'before' ? sym + num : num + ' ' + sym;
    }
    if (fmt.type === 'date') return fmtDate(v);
    return toText(v);
  }

  // ── Coercion ─────────────────────────────────────────────────────────────
  function scalar(v) {
    if (isMatrix(v)) {
      if (v.h === 1 && v.w === 1) return v.rows[0][0];
      return ERR.VALUE;
    }
    return v;
  }
  function num(v) {
    v = scalar(v);
    if (isErr(v)) return v;
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const lit = parseLiteral(v);
    if (typeof lit.v === 'number') return lit.v;
    return ERR.VALUE;
  }
  function str(v) {
    v = scalar(v);
    if (isErr(v)) return v;
    return toText(v);
  }
  function bool(v) {
    v = scalar(v);
    if (isErr(v)) return v;
    if (v == null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
    return ERR.VALUE;
  }
  function compare(a, b) {
    // Excel ordering: numbers < text < booleans; empty acts like 0 or "".
    if (a == null) a = typeof b === 'string' ? '' : (typeof b === 'boolean' ? false : 0);
    if (b == null) b = typeof a === 'string' ? '' : (typeof a === 'boolean' ? false : 0);
    const rank = x => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (typeof a === 'string') {
      const x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function equal(a, b) { return compare(a, b) === 0; }

  // Numbers in ranges; text and booleans in ranges are skipped, as in Excel,
  // but given directly they count ("=SUM(1, "2")" is 3).
  function numbersOf(args) {
    const out = [];
    for (const a of args) {
      if (isMatrix(a)) {
        for (const v of a.flat()) {
          if (isErr(v)) return v;
          if (typeof v === 'number') out.push(v);
        }
      } else {
        if (a == null) continue;
        const n = num(a);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }
  function valuesOf(args) {
    const out = [];
    for (const a of args) {
      if (isMatrix(a)) out.push(...a.flat());
      else out.push(a);
    }
    return out;
  }
  function asMatrix(v) { return isMatrix(v) ? v : new Matrix([[v]]); }

  // "10", ">5", "<>x", "a*" — the condition SUMIF/COUNTIF test cells with.
  function criteria(c) {
    c = scalar(c);
    if (isErr(c)) return () => false;
    if (typeof c !== 'string') return v => equal(v, c);
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(c);
    const op = m[1] || '=';
    const lit = parseLiteral(m[2]).v;
    const target = lit == null ? '' : lit;
    if ((op === '=' || op === '<>') && typeof target === 'string' && /[*?]/.test(target)) {
      const re = new RegExp('^' + target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      return v => (op === '=') === re.test(toText(v));
    }
    return v => {
      if (typeof target === 'number' && typeof v !== 'number') return op === '<>';
      const r = compare(v == null ? (typeof target === 'number' ? null : '') : v, target);
      switch (op) {
        case '=': return r === 0;
        case '<>': return r !== 0;
        case '<': return r < 0;
        case '>': return r > 0;
        case '<=': return r <= 0;
        case '>=': return r >= 0;
      }
      return false;
    };
  }

  function roundTo(n, d, mode) {
    const f = Math.pow(10, d);
    const x = n * f;
    let r;
    if (mode === 'up') r = x < 0 ? Math.floor(parseFloat(x.toPrecision(15))) : Math.ceil(parseFloat(x.toPrecision(15)));
    else if (mode === 'down') r = Math.trunc(parseFloat(x.toPrecision(15)));
    else r = Math.sign(x) * Math.round(Math.abs(parseFloat(x.toPrecision(15))));
    return r / f;
  }

  // ── Functions ────────────────────────────────────────────────────────────
  // Each takes already evaluated arguments; `lazy` ones get a thunk per
  // argument so IF only evaluates the branch it takes.
  const FN = {};
  const LAZY = new Set(['IF', 'IFERROR', 'IFNA', 'AND', 'OR']);
  function def(name, fn) { FN[name] = fn; }

  def('SUM', a => { const ns = numbersOf(a); return isErr(ns) ? ns : ns.reduce((x, y) => x + y, 0); });
  def('PRODUCT', a => { const ns = numbersOf(a); return isErr(ns) ? ns : ns.reduce((x, y) => x * y, 1); });
  def('AVERAGE', a => { const ns = numbersOf(a); if (isErr(ns)) return ns; return ns.length ? ns.reduce((x, y) => x + y, 0) / ns.length : ERR.DIV0; });
  def('MIN', a => { const ns = numbersOf(a); if (isErr(ns)) return ns; return ns.length ? Math.min(...ns) : 0; });
  def('MAX', a => { const ns = numbersOf(a); if (isErr(ns)) return ns; return ns.length ? Math.max(...ns) : 0; });
  def('MEDIAN', a => {
    const ns = numbersOf(a); if (isErr(ns)) return ns;
    if (!ns.length) return ERR.NUM;
    ns.sort((x, y) => x - y);
    const m = ns.length >> 1;
    return ns.length % 2 ? ns[m] : (ns[m - 1] + ns[m]) / 2;
  });
  def('COUNT', a => valuesOf(a).filter(v => typeof v === 'number').length);
  def('COUNTA', a => valuesOf(a).filter(v => v != null && v !== '').length);
  def('COUNTBLANK', a => valuesOf(a).filter(v => v == null || v === '').length);
  def('ABS', ([x]) => { const n = num(x); return isErr(n) ? n : Math.abs(n); });
  def('INT', ([x]) => { const n = num(x); return isErr(n) ? n : Math.floor(n); });
  def('SQRT', ([x]) => { const n = num(x); if (isErr(n)) return n; return n < 0 ? ERR.NUM : Math.sqrt(n); });
  def('POWER', ([x, y]) => { const a = num(x), b = num(y); if (isErr(a)) return a; if (isErr(b)) return b; return Math.pow(a, b); });
  def('MOD', ([x, y]) => {
    const a = num(x), b = num(y); if (isErr(a)) return a; if (isErr(b)) return b;
    if (b === 0) return ERR.DIV0;
    return a - b * Math.floor(a / b);
  });
  for (const [name, mode] of [['ROUND', 'half'], ['ROUNDUP', 'up'], ['ROUNDDOWN', 'down']]) {
    def(name, ([x, d]) => {
      const n = num(x), k = d === undefined ? 0 : num(d);
      if (isErr(n)) return n; if (isErr(k)) return k;
      return roundTo(n, Math.trunc(k), mode);
    });
  }
  def('IF', ([c, a, b]) => {
    const cond = bool(c());
    if (isErr(cond)) return cond;
    if (cond) return a ? a() : true;
    return b ? b() : false;
  });
  def('IFERROR', ([v, alt]) => { const x = v(); return isErr(scalar(x)) ? (alt ? alt() : '') : x; });
  def('IFNA', ([v, alt]) => { const x = v(); return scalar(x) === ERR.NA ? (alt ? alt() : '') : x; });
  function logic(args, isAnd) {
    let seen = false;
    for (const th of args) {
      const v = th();
      for (const x of isMatrix(v) ? v.flat() : [v]) {
        if (x == null) continue;
        if (isMatrix(v) && typeof x === 'string') continue;
        const b = bool(x);
        if (isErr(b)) return b;
        seen = true;
        if (isAnd && !b) return false;
        if (!isAnd && b) return true;
      }
    }
    return seen ? isAnd : ERR.VALUE;
  }
  def('AND', a => logic(a, true));
  def('OR', a => logic(a, false));
  def('NOT', ([x]) => { const b = bool(x); return isErr(b) ? b : !b; });
  def('TRUE', () => true);
  def('FALSE', () => false);
  function concat(a) {
    let s = '';
    for (const v of valuesOf(a)) { if (isErr(v)) return v; s += toText(v); }
    return s;
  }
  def('CONCAT', concat);
  def('CONCATENATE', concat);
  def('TEXTJOIN', ([sep, skip, ...rest]) => {
    const d = str(sep); if (isErr(d)) return d;
    const sk = bool(skip); if (isErr(sk)) return sk;
    const parts = [];
    for (const v of valuesOf(rest)) {
      if (isErr(v)) return v;
      const t = toText(v);
      if (sk && t === '') continue;
      parts.push(t);
    }
    return parts.join(d);
  });
  def('LEN', ([x]) => { const s = str(x); return isErr(s) ? s : s.length; });
  def('UPPER', ([x]) => { const s = str(x); return isErr(s) ? s : s.toLocaleUpperCase(); });
  def('LOWER', ([x]) => { const s = str(x); return isErr(s) ? s : s.toLocaleLowerCase(); });
  def('TRIM', ([x]) => { const s = str(x); return isErr(s) ? s : s.trim().replace(/\s+/g, ' '); });
  def('LEFT', ([x, n]) => { const s = str(x), k = n === undefined ? 1 : num(n); if (isErr(s)) return s; if (isErr(k)) return k; return s.slice(0, Math.max(0, k)); });
  def('RIGHT', ([x, n]) => { const s = str(x), k = n === undefined ? 1 : num(n); if (isErr(s)) return s; if (isErr(k)) return k; return k <= 0 ? '' : s.slice(-k); });
  def('MID', ([x, st, n]) => {
    const s = str(x), a = num(st), k = num(n);
    if (isErr(s)) return s; if (isErr(a)) return a; if (isErr(k)) return k;
    if (a < 1 || k < 0) return ERR.VALUE;
    return s.substr(a - 1, k);
  });
  def('TEXT', ([x, f]) => {
    // Only the common numeric patterns: "0", "0.00", "0%", "0.0%".
    const n = num(x), p = str(f);
    if (isErr(n)) return n; if (isErr(p)) return p;
    const m = /^0(?:[.,](0+))?(%?)$/.exec(p.trim());
    if (!m) return toText(n);
    const dec = m[1] ? m[1].length : 0;
    return formatValue(n, { type: m[2] ? 'percent' : 'number', dec });
  });
  def('VALUE', ([x]) => num(x));
  def('TODAY', () => { const d = new Date(); return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); });
  def('DATE', ([y, m, d]) => {
    const a = num(y), b = num(m), c = num(d);
    if (isErr(a)) return a; if (isErr(b)) return b; if (isErr(c)) return c;
    return Math.round((Date.UTC(a, b - 1, c) - EPOCH) / DAY_MS);
  });
  def('YEAR', ([x]) => { const n = num(x); return isErr(n) ? n : serialDate(n).getUTCFullYear(); });
  def('MONTH', ([x]) => { const n = num(x); return isErr(n) ? n : serialDate(n).getUTCMonth() + 1; });
  def('DAY', ([x]) => { const n = num(x); return isErr(n) ? n : serialDate(n).getUTCDate(); });
  function ifAgg(range, crit, sumRange, kind) {
    const r = asMatrix(range);
    const s = sumRange === undefined ? r : asMatrix(sumRange);
    const test = criteria(crit);
    let total = 0, count = 0;
    for (let i = 0; i < r.h; i++) {
      for (let j = 0; j < r.w; j++) {
        if (!test(r.rows[i][j])) continue;
        if (kind === 'count') { count++; continue; }
        const v = s.rows[i] ? s.rows[i][j] : null;
        if (isErr(v)) return v;
        if (typeof v === 'number') { total += v; count++; }
      }
    }
    if (kind === 'count') return count;
    if (kind === 'avg') return count ? total / count : ERR.DIV0;
    return total;
  }
  def('SUMIF', ([r, c, s]) => ifAgg(r, c, s, 'sum'));
  def('COUNTIF', ([r, c]) => ifAgg(r, c, undefined, 'count'));
  def('AVERAGEIF', ([r, c, s]) => ifAgg(r, c, s, 'avg'));
  def('ROWS', ([x]) => asMatrix(x).h);
  def('COLUMNS', ([x]) => asMatrix(x).w);
  def('INDEX', ([range, row, col]) => {
    const m = asMatrix(range);
    let r = row === undefined ? 1 : num(row);
    let c = col === undefined ? 1 : num(col);
    if (isErr(r)) return r; if (isErr(c)) return c;
    // A single column or row can be indexed with one number either way.
    if (col === undefined && m.h === 1 && m.w > 1) { c = r; r = 1; }
    if (r < 1 || c < 1 || r > m.h || c > m.w) return ERR.REF;
    return m.rows[r - 1][c - 1];
  });
  function matchIn(list, target, mode) {
    if (mode === 0) {
      const test = typeof target === 'string' ? criteria(target) : (v => equal(v, target));
      for (let i = 0; i < list.length; i++) if (test(list[i])) return i;
      return -1;
    }
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v == null) continue;
      const r = compare(v, target);
      if (mode > 0 ? r <= 0 : r >= 0) best = i; else break;
    }
    return best;
  }
  def('MATCH', ([t, range, mode]) => {
    const target = scalar(t); if (isErr(target)) return target;
    const md = mode === undefined ? 1 : num(mode); if (isErr(md)) return md;
    const i = matchIn(asMatrix(range).flat(), target, Math.sign(md));
    return i < 0 ? ERR.NA : i + 1;
  });
  def('XLOOKUP', ([t, look, ret, notFound]) => {
    const target = scalar(t); if (isErr(target)) return target;
    const lm = asMatrix(look), rm = asMatrix(ret);
    const i = matchIn(lm.flat(), target, 0);
    if (i < 0) return notFound === undefined ? ERR.NA : notFound;
    // Same shape as the lookup range: a column returns from the same row.
    if (lm.w === 1) return rm.rows[i] ? rm.rows[i][0] : ERR.REF;
    return rm.rows[0] && i < rm.w ? rm.rows[0][i] : ERR.REF;
  });
  def('VLOOKUP', ([t, range, col, approx]) => {
    const target = scalar(t); if (isErr(target)) return target;
    const m = asMatrix(range);
    const c = num(col); if (isErr(c)) return c;
    if (c < 1 || c > m.w) return ERR.REF;
    const ap = approx === undefined ? true : bool(approx);
    if (isErr(ap)) return ap;
    const i = matchIn(m.rows.map(r => r[0]), target, ap ? 1 : 0);
    return i < 0 ? ERR.NA : m.rows[i][c - 1];
  });
  def('HLOOKUP', ([t, range, row, approx]) => {
    const target = scalar(t); if (isErr(target)) return target;
    const m = asMatrix(range);
    const r = num(row); if (isErr(r)) return r;
    if (r < 1 || r > m.h) return ERR.REF;
    const ap = approx === undefined ? true : bool(approx);
    if (isErr(ap)) return ap;
    const i = matchIn(m.rows[0], target, ap ? 1 : 0);
    return i < 0 ? ERR.NA : m.rows[r - 1][i];
  });

  // Shown by the formula helper: name → argument hint.
  const FN_HINTS = {
    SUM: 'SUM(value1, value2, …)', AVERAGE: 'AVERAGE(value1, …)', MIN: 'MIN(value1, …)', MAX: 'MAX(value1, …)',
    COUNT: 'COUNT(value1, …)', COUNTA: 'COUNTA(value1, …)', COUNTBLANK: 'COUNTBLANK(range)', PRODUCT: 'PRODUCT(value1, …)',
    MEDIAN: 'MEDIAN(value1, …)', ROUND: 'ROUND(number, digits)', ROUNDUP: 'ROUNDUP(number, digits)',
    ROUNDDOWN: 'ROUNDDOWN(number, digits)', INT: 'INT(number)', ABS: 'ABS(number)', SQRT: 'SQRT(number)',
    POWER: 'POWER(number, power)', MOD: 'MOD(number, divisor)', IF: 'IF(condition, if_true, if_false)',
    IFERROR: 'IFERROR(value, if_error)', IFNA: 'IFNA(value, if_na)', AND: 'AND(condition1, …)', OR: 'OR(condition1, …)',
    NOT: 'NOT(condition)', CONCAT: 'CONCAT(text1, …)', TEXTJOIN: 'TEXTJOIN(separator, skip_empty, text1, …)',
    LEN: 'LEN(text)', UPPER: 'UPPER(text)', LOWER: 'LOWER(text)', TRIM: 'TRIM(text)', LEFT: 'LEFT(text, count)',
    RIGHT: 'RIGHT(text, count)', MID: 'MID(text, start, count)', TEXT: 'TEXT(number, "0.00")', VALUE: 'VALUE(text)',
    TODAY: 'TODAY()', DATE: 'DATE(year, month, day)', YEAR: 'YEAR(date)', MONTH: 'MONTH(date)', DAY: 'DAY(date)',
    SUMIF: 'SUMIF(range, criteria, sum_range)', COUNTIF: 'COUNTIF(range, criteria)',
    AVERAGEIF: 'AVERAGEIF(range, criteria, average_range)', INDEX: 'INDEX(range, row, column)',
    MATCH: 'MATCH(value, range, 0)', XLOOKUP: 'XLOOKUP(value, lookup_range, return_range, if_not_found)',
    VLOOKUP: 'VLOOKUP(value, range, column, FALSE)', HLOOKUP: 'HLOOKUP(value, range, row, FALSE)',
    ROWS: 'ROWS(range)', COLUMNS: 'COLUMNS(range)',
  };

  // ── Engine ───────────────────────────────────────────────────────────────
  // Values are computed on demand and cached until the next change; a change
  // anywhere clears the cache, so every dependant — in any table, on any
  // page, in the text — is correct the next time it is drawn.
  class Engine {
    constructor(doc) { this.setDoc(doc); }
    setDoc(doc) { this.doc = doc; this.invalidate(); }
    invalidate() {
      this.cache = new Map();
      this.visiting = new Set();
      this.byName = new Map();
      this.parsed = this.parsed || new Map();
      for (const t of Object.values(this.doc.tables || {})) this.byName.set(String(t.name).toLowerCase(), t);
    }
    table(name) { return this.byName.get(String(name).toLowerCase()) || null; }
    raw(t, r, c) { const cell = t.cells[r + ',' + c]; return cell ? cell.v : null; }
    // Rows actually in use — whole-column references stop there.
    usedRows(t) {
      let max = 0;
      for (const k in t.cells) {
        const cell = t.cells[k];
        if (cell && cell.v != null && cell.v !== '') { const r = +k.split(',')[0] + 1; if (r > max) max = r; }
      }
      return Math.min(max, t.rows);
    }
    ast(src) {
      let a = this.parsed.get(src);
      if (a === undefined) {
        try { a = parse(src); } catch (e) { a = null; }
        if (this.parsed.size > 5000) this.parsed.clear();
        this.parsed.set(src, a);
      }
      return a;
    }
    value(t, r, c) {
      const key = t.id + '|' + r + '|' + c;
      if (this.cache.has(key)) return this.cache.get(key);
      const raw = this.raw(t, r, c);
      let v;
      if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
        if (this.visiting.has(key)) return ERR.CIRC;
        this.visiting.add(key);
        try { v = this.evalSource(raw.slice(1), t); } finally { this.visiting.delete(key); }
        if (isMatrix(v)) v = v.h && v.w ? v.rows[0][0] : null;
      } else {
        v = parseLiteral(raw).v;
      }
      this.cache.set(key, v);
      return v;
    }
    evalSource(src, table) {
      const ast = this.ast(src);
      if (!ast) return ERR.ERROR;
      try { return this.ev(ast, table); } catch (e) { return ERR.ERROR; }
    }
    // A formula typed into the text: no table of its own.
    evaluate(src) {
      src = String(src || '').replace(/^=/, '');
      if (!src.trim()) return null;
      const v = this.evalSource(src, null);
      return isMatrix(v) ? (v.h && v.w ? v.rows[0][0] : null) : v;
    }
    resolve(node, ctx) {
      if (node.table == null) return ctx;
      return this.table(node.table);
    }
    columnOf(t, name) {
      const want = String(name).trim().toLowerCase();
      for (let c = 0; c < t.cols; c++) {
        const v = this.raw(t, 0, c);
        if (v != null && String(v).trim().toLowerCase() === want) return c;
      }
      return -1;
    }
    matrix(t, r1, c1, r2, c2) {
      const rows = [];
      for (let r = r1; r <= r2; r++) {
        const row = [];
        for (let c = c1; c <= c2; c++) row.push(this.value(t, r, c));
        rows.push(row);
      }
      return new Matrix(rows);
    }
    ev(n, ctx) {
      switch (n.t) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'errlit': return n.v;
        case 'blank': return null;
        case 'unknown': return ERR.NAME;
        case 'ref': {
          const t = this.resolve(n, ctx);
          if (!t || n.r >= t.rows || n.c >= t.cols) return ERR.REF;
          return this.value(t, n.r, n.c);
        }
        case 'range': {
          const t = this.resolve(n, ctx);
          if (!t) return ERR.REF;
          const r1 = Math.min(n.r1, n.r2), r2 = Math.max(n.r1, n.r2);
          const c1 = Math.min(n.c1, n.c2), c2 = Math.max(n.c1, n.c2);
          if (r1 >= t.rows || c1 >= t.cols) return ERR.REF;
          return this.matrix(t, r1, c1, Math.min(r2, t.rows - 1), Math.min(c2, t.cols - 1));
        }
        case 'cols': {
          const t = this.resolve(n, ctx);
          if (!t) return ERR.REF;
          const c1 = Math.min(n.c1, n.c2), c2 = Math.max(n.c1, n.c2);
          if (c1 >= t.cols) return ERR.REF;
          const used = this.usedRows(t);
          if (!used) return new Matrix([[null]]);
          return this.matrix(t, 0, c1, used - 1, Math.min(c2, t.cols - 1));
        }
        case 'col': {
          const t = this.table(n.table);
          if (!t) return ERR.REF;
          const c = this.columnOf(t, n.col);
          if (c < 0) return ERR.REF;
          const used = this.usedRows(t);
          if (used < 2) return new Matrix([[null]]);
          return this.matrix(t, 1, c, used - 1, c);
        }
        case 'neg': { const x = num(this.ev(n.a, ctx)); return isErr(x) ? x : -x; }
        case 'pct': { const x = num(this.ev(n.a, ctx)); return isErr(x) ? x : x / 100; }
        case 'bin': return this.bin(n, ctx);
        case 'fn': {
          const f = FN[n.name];
          if (!f) return ERR.NAME;
          if (LAZY.has(n.name)) return f(n.args.map(a => () => this.ev(a, ctx)));
          const args = n.args.map(a => (a.t === 'blank' ? undefined : this.ev(a, ctx)));
          if (n.name !== 'IFERROR') {
            // Errors given directly propagate; errors inside ranges are the
            // functions' business.
            for (const a of args) if (isErr(a)) return a;
          }
          const out = f(args);
          return out === undefined ? null : out;
        }
      }
      return ERR.ERROR;
    }
    bin(n, ctx) {
      const a = scalar(this.ev(n.a, ctx));
      const b = scalar(this.ev(n.b, ctx));
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      if (n.op === '&') return toText(a) + toText(b);
      if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
        const r = compare(a, b);
        switch (n.op) {
          case '=': return r === 0;
          case '<>': return r !== 0;
          case '<': return r < 0;
          case '>': return r > 0;
          case '<=': return r <= 0;
          case '>=': return r >= 0;
        }
      }
      const x = num(a), y = num(b);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      switch (n.op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': return y === 0 ? ERR.DIV0 : x / y;
        case '^': { const p = Math.pow(x, y); return isFinite(p) ? p : ERR.NUM; }
      }
      return ERR.ERROR;
    }
    // The display format a cell's value suggests when the cell has none of
    // its own: typed "20%" or "5 €", or a formula taking a formatted cell.
    autoFormat(t, r, c, depth) {
      const cell = t.cells[r + ',' + c];
      if (!cell) return null;
      if (cell.f && cell.f.type && cell.f.type !== 'general') return cell.f;
      const raw = cell.v;
      if (typeof raw === 'string' && raw.startsWith('=')) {
        if ((depth || 0) > 8) return null;
        const ast = this.ast(raw.slice(1));
        return ast ? this.astFormat(ast, t, (depth || 0) + 1) : null;
      }
      return parseLiteral(raw).fmt || null;
    }
    // =B2*C2 shown as money when B2 is money; TODAY() shown as a date.
    astFormat(ast, ctx, depth) {
      if (!ast) return null;
      if (ast.t === 'fn') {
        if (['TODAY', 'DATE'].includes(ast.name)) return { type: 'date' };
        if (['COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'ROWS', 'COLUMNS', 'LEN', 'MATCH', 'YEAR', 'MONTH', 'DAY'].includes(ast.name)) return null;
        for (const a of ast.args) { const f = this.astFormat(a, ctx, depth); if (f) return f; }
        return null;
      }
      if (ast.t === 'ref') {
        const t = this.resolve(ast, ctx);
        return t ? this.autoFormat(t, ast.r, ast.c, depth) : null;
      }
      if (ast.t === 'range') {
        const t = this.resolve(ast, ctx);
        return t ? this.autoFormat(t, Math.max(ast.r1, ast.r2), ast.c1, depth) : null;
      }
      if (ast.t === 'col') {
        const t = this.table(ast.table);
        if (!t) return null;
        const c = this.columnOf(t, ast.col);
        return c < 0 ? null : this.autoFormat(t, 1, c, depth);
      }
      if (ast.t === 'cols') {
        const t = this.resolve(ast, ctx);
        return t ? this.autoFormat(t, 1, ast.c1, depth) : null;
      }
      if (ast.t === 'bin') {
        if (['&', '=', '<>', '<', '>', '<=', '>='].includes(ast.op)) return null;
        return this.astFormat(ast.a, ctx, depth) || (ast.op === '/' ? null : this.astFormat(ast.b, ctx, depth));
      }
      if (ast.t === 'neg') return this.astFormat(ast.a, ctx, depth);
      return null;
    }
    display(t, r, c) {
      const cell = t.cells[r + ',' + c];
      const v = this.value(t, r, c);
      const fmt = cell && cell.f && cell.f.type && cell.f.type !== 'general' ? cell.f : this.autoFormat(t, r, c);
      return formatValue(v, fmt);
    }
  }

  // Brackets left open at the end are closed, as Excel does on Enter.
  function closeParens(src) {
    let depth = 0, q = null;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) { if (ch === q) { if (src[i + 1] === q) i++; else q = null; } continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
    }
    return q || depth <= 0 ? src : src + ')'.repeat(depth);
  }

  window.MvmOfficeFormula = {
    closeParens, setRegion, fromInput, editText, Engine, parse, tokenize, mapRefs, refToText, quoteName, parseLiteral, formatValue, toText,
    colName, colIndex, parseCell, cellText, isErr, isMatrix, FErr, ERR, FN, FN_HINTS,
  };
})();
