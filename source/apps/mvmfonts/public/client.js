// What an app loads from /pub/mvmfonts/client.js to use the fonts of mvmFonts. When mvmFonts is not
// installed this file does not exist, and when its App API is off load() finds no fonts: in both
// cases the caller simply offers no extra fonts.
(function () {
  if (window.MvmFontsClient) return;
  const NAME_RE = /^[^<>"'{};\\\/]{1,60}$/;
  const FALLBACK = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif' };
  const C = {
    families: [], ranges: {}, by: {}, css: '',
    // opts.token: the Apps Hub token, for a public page; the desktop needs none.
    async load(opts) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (opts && opts.token) headers['X-Pub-Token'] = opts.token;
        const r = await fetch('/api/platform/apps/mvmfonts/call', { method: 'POST', headers, body: JSON.stringify({ method: 'list_fonts', args: [], kwargs: {} }) });
        this.set(r.ok ? (await r.json()).result : null);
      } catch (e) { this.set(null); }
      return this.families;
    },
    set(data) {
      this.families = ((data && data.families) || []).filter(f => f && NAME_RE.test(f.family) && f.styles && f.styles.length);
      this.ranges = (data && data.ranges) || {};
      this.by = {};
      this.families.forEach(f => { this.by[f.family] = f; });
      let css = '';
      for (const f of this.families) {
        for (const s of f.styles) {
          for (const sub in s.files) {
            const url = window.asset ? window.asset(s.files[sub]) : s.files[sub];
            const ext = url.split('?')[0].split('.').pop();
            const fmt = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
            css += `@font-face{font-family:"${f.family}";font-style:${s.style};font-weight:${String(s.weight).split(' ')[0]};font-display:swap;` +
              `src:url("${url}") format("${fmt}");unicode-range:${this.ranges[sub] || 'U+0-10FFFF'}}\n`;
          }
        }
      }
      this.css = css;
      this.inject(document);
    },
    has(name) { return !!this.by[name]; },
    // A CSS font-family value that still reads well on a machine without the font.
    stack(name) { const f = this.by[name]; return `"${name}", ${FALLBACK[(f && f.category) || 'sans'] || 'sans-serif'}`; },
    inject(doc) {
      if (!this.css || !doc || !doc.head) return;
      let st = doc.getElementById('mvmfonts-css');
      if (!st) { st = doc.createElement('style'); st.id = 'mvmfonts-css'; doc.head.appendChild(st); }
      if (st.textContent !== this.css) st.textContent = this.css;
    },
    // Resolves once the named families are loaded, so canvases and measuring use their real shapes.
    async ready(names, sample) {
      const list = [...new Set(names || [])].filter(n => this.by[n]);
      if (!list.length || !document.fonts) return;
      const tasks = [];
      for (const n of list) for (const s of this.by[n].styles) tasks.push(document.fonts.load(`${s.style} ${String(s.weight).split(' ')[0]} 16px "${n}"`, sample || 'AaBbЖжЯя').catch(() => {}));
      await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, 8000))]);
    },
  };
  window.MvmFontsClient = C;
})();
