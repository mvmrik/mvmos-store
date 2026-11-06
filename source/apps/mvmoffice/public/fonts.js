// The fonts mvmFonts has installed on this server. When the app is not there, or its
// App API is off, the list is empty and every place that would show fonts stays quiet.
(function () {
  if (window.MvmOfficeFonts) return;
  const FALLBACK = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif' };
  const NAME_RE = /^[^<>"'{};\\\/]{1,60}$/;
  const F = {
    families: [], ranges: {}, by: {}, css: '',
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
            const fmt = /\.woff2$/.test(url.split('?')[0]) ? 'woff2' : /\.woff$/.test(url.split('?')[0]) ? 'woff' : /\.otf$/.test(url.split('?')[0]) ? 'opentype' : 'truetype';
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
    stack(name) {
      const f = this.by[name];
      return `"${name}", ${FALLBACK[(f && f.category) || 'sans'] || 'sans-serif'}`;
    },
    // The same rules inside another document (the print sheets).
    inject(doc) {
      if (!this.css || !doc || !doc.head) return;
      let st = doc.getElementById('mo-fonts-css');
      if (!st) { st = doc.createElement('style'); st.id = 'mo-fonts-css'; doc.head.appendChild(st); }
      if (st.textContent !== this.css) st.textContent = this.css;
    },
    // Wait until the fonts a document uses are loaded, so measuring and drawing use their real shapes.
    async ready(doc, names, sample) {
      doc = doc || document;
      const list = [...new Set(names || [])].filter(n => this.by[n]);
      if (!list.length || !doc.fonts) return;
      const text = sample || 'AaBbЖжЯя';
      const tasks = [];
      for (const n of list) {
        for (const s of this.by[n].styles) {
          tasks.push(doc.fonts.load(`${s.style} ${String(s.weight).split(' ')[0]} 16px "${n}"`, text).catch(() => {}));
        }
      }
      await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, 8000))]);
    },
  };
  window.MvmOfficeFonts = F;
})();
