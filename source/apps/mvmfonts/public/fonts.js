// mvmFonts window: browse the installed fonts, and (administrator) add or remove your own.
(function () {
  const API = '/api/apps/mvmfonts';
  const WEIGHTS = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k, v) => {
    const lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    let s = ((window.MVMFONTS_I18N[lang] || window.MVMFONTS_I18N.en)[k]) || window.MVMFONTS_I18N.en[k] || k;
    if (v) for (const n in v) s = s.replace('{' + n + '}', v[n]);
    return s;
  };
  const CSS = `
  .mf{height:100%;display:flex;flex-direction:column;background:var(--surface,#161b22);color:var(--text,#c9d1d9);font-family:var(--font,inherit)}
  .mf-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border,#30363d)}
  .mf-top input[type=text]{flex:1 1 180px;min-width:120px;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#30363d);background:var(--bg,#0d1117);color:inherit}
  .mf-chip{padding:5px 11px;border-radius:999px;border:1px solid var(--border,#30363d);background:none;color:inherit;cursor:pointer;font-size:.8rem}
  .mf-chip.on{background:var(--accent,#2a6ee0);border-color:var(--accent,#2a6ee0);color:var(--on-accent,#fff)}
  .mf-body{flex:1;overflow:auto;padding:12px 14px}
  .mf-hint{font-size:.78rem;color:var(--text-dim,#8b949e);line-height:1.5;margin-bottom:10px}
  .mf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
  .mf-card{border:1px solid var(--border,#30363d);border-radius:8px;padding:10px 12px;cursor:pointer;background:var(--surface2,#21262d);min-width:0}
  .mf-card:hover{border-color:var(--accent,#2a6ee0)}
  .mf-name{font-size:.78rem;color:var(--text-dim,#8b949e);display:flex;gap:6px;align-items:baseline;justify-content:space-between}
  .mf-sample{font-size:1.25rem;line-height:1.35;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
  .mf-det{grid-column:1/-1;border:1px solid var(--accent,#2a6ee0);border-radius:8px;padding:12px 14px}
  .mf-row{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border,#30363d)}
  .mf-row:first-of-type{border-top:0}
  .mf-row small{flex:none;width:120px;color:var(--text-dim,#8b949e)}
  .mf-row span{flex:1;font-size:1.5rem;line-height:1.3;word-break:break-word}
  .mf-btn{padding:6px 12px;border-radius:6px;border:1px solid var(--border,#30363d);background:var(--surface2,#21262d);color:inherit;cursor:pointer}
  .mf-btn.pri{background:var(--accent,#2a6ee0);border-color:var(--accent,#2a6ee0);color:var(--on-accent,#fff)}
  .mf-btn.bad{color:var(--danger,#da3633)}
  .mf-add{margin-top:16px;border-top:1px solid var(--border,#30363d);padding-top:12px;display:flex;flex-direction:column;gap:8px;max-width:560px}
  .mf-add label{display:flex;gap:8px;align-items:center;font-size:.85rem}
  .mf-add input[type=text],.mf-add select,.mf-add input[type=number]{padding:6px 8px;border-radius:6px;border:1px solid var(--border,#30363d);background:var(--bg,#0d1117);color:inherit}
  .mf-msg{font-size:.82rem;min-height:1.2em}
  `;

  function mount(host) {
    let data = { families: [], ranges: {}, admin: false };
    let cat = 'all', q = '', open = null;
    const injected = new Set();
    const root = document.createElement('div');
    root.className = 'mf';
    host.appendChild(root);
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const view = document.createElement('div');
    view.style.cssText = 'height:100%;display:flex;flex-direction:column';
    root.appendChild(view);

    function face(fam) {
      if (injected.has(fam.family)) return;
      injected.add(fam.family);
      let css = '';
      for (const s of fam.styles) {
        for (const sub in s.files) {
          const w = String(s.weight).split(' ')[0];
          const fmt = /\.woff2$/.test(s.files[sub]) ? 'woff2' : /\.woff$/.test(s.files[sub]) ? 'woff' : /\.otf$/.test(s.files[sub]) ? 'opentype' : /\.ttf$/.test(s.files[sub]) ? 'truetype' : 'woff2';
          css += `@font-face{font-family:"mvmf ${fam.family}";font-style:${s.style};font-weight:${w};font-display:swap;` +
            `src:url("${window.asset ? window.asset(s.files[sub]) : s.files[sub]}") format("${fmt}");unicode-range:${data.ranges[sub] || 'U+0-10FFFF'}}`;
        }
      }
      style.textContent += css;
    }

    function shown() {
      const needle = q.trim().toLowerCase();
      return data.families.filter(f => (cat === 'all' || (cat === 'custom' ? f.custom : f.category === cat && !f.custom)) && (!needle || f.family.toLowerCase().includes(needle)));
    }

    function styleName(s) {
      const w = String(s.weight).split(' ')[0];
      return (WEIGHTS[w] || w) + (s.style === 'italic' ? ' Italic' : '');
    }

    function render() {
      const list = shown();
      const sample = (view.querySelector('.mf-sample-in') || {}).value || t('sample');
      view.innerHTML = `
        <div class="mf-top">
          <input type="text" class="mf-q" placeholder="${esc(t('search'))}" value="${esc(q)}">
          ${['all', 'sans', 'serif', 'mono', 'display', 'custom'].map(c => `<button class="mf-chip${cat === c ? ' on' : ''}" data-cat="${c}">${esc(t(c))}</button>`).join('')}
          <input type="text" class="mf-sample-in" value="${esc(sample)}" style="flex:2 1 220px">
          <span style="font-size:.78rem;color:var(--text-dim,#8b949e)">${esc(t('count', { n: list.length }))}</span>
        </div>
        <div class="mf-body">
          <div class="mf-hint">${esc(t('hint'))}</div>
          <div class="mf-grid">${list.length ? list.map(card).join('') : `<div class="mf-hint">${esc(t('none'))}</div>`}</div>
          ${data.admin ? addForm() : ''}
        </div>`;
      list.forEach(face);
      wire();
    }

    function card(f) {
      const sample = (view.querySelector('.mf-sample-in') || {}).value;
      const text = esc(sample || t('sample'));
      const head = `<div class="mf-name"><b style="color:var(--text,#c9d1d9)">${esc(f.family)}</b><span>${esc(t('styles', { n: f.styles.length }))}${f.cyrillic ? ' · ' + esc(t('cyrillic')) : ''}</span></div>`;
      if (open === f.family) {
        return `<div class="mf-det" data-fam="${esc(f.family)}">${head}
          ${f.styles.map(s => `<div class="mf-row"><small>${esc(styleName(s))}</small><span style="font-family:'mvmf ${esc(f.family)}',sans-serif;font-style:${s.style};font-weight:${String(s.weight).split(' ')[0]}">${text}</span>${s.id ? `<button class="mf-btn bad" data-del="${s.id}">${esc(t('delete'))}</button>` : ''}</div>`).join('')}
          ${f.license ? `<div class="mf-hint" style="margin:8px 0 0">${esc(t('licence'))}: ${esc(f.license)}</div>` : ''}
        </div>`;
      }
      const reg = f.styles.find(s => s.style === 'normal' && String(s.weight).split(' ')[0] === '400') || f.styles[0];
      return `<div class="mf-card" data-fam="${esc(f.family)}">${head}<div class="mf-sample" style="font-family:'mvmf ${esc(f.family)}',sans-serif;font-weight:${String(reg.weight).split(' ')[0]};font-style:${reg.style}">${text}</div></div>`;
    }

    function addForm() {
      return `<div class="mf-add"><b>${esc(t('add'))}</b><div class="mf-hint">${esc(t('add_hint'))}</div>
        <label>${esc(t('family'))} <input type="text" class="mf-f-fam" maxlength="60"></label>
        <label>${esc(t('weight'))} <select class="mf-f-w">${Object.keys(WEIGHTS).map(w => `<option value="${w}"${w === '400' ? ' selected' : ''}>${w} ${WEIGHTS[w]}</option>`).join('')}</select>
          <label><input type="checkbox" class="mf-f-it"> ${esc(t('italic'))}</label></label>
        <label>${esc(t('category'))} <select class="mf-f-c">${['sans', 'serif', 'mono', 'display'].map(c => `<option value="${c}">${esc(t(c))}</option>`).join('')}</select></label>
        <label>${esc(t('file'))} <input type="file" class="mf-f-file" accept=".woff2,.woff,.ttf,.otf"></label>
        <div><button class="mf-btn pri mf-up">${esc(t('upload'))}</button></div><div class="mf-msg"></div></div>`;
    }

    function wire() {
      view.querySelector('.mf-q').oninput = e => { q = e.target.value; const pos = e.target.selectionStart; render(); const el = view.querySelector('.mf-q'); el.focus(); el.setSelectionRange(pos, pos); };
      view.querySelector('.mf-sample-in').oninput = e => { const pos = e.target.selectionStart; render(); const el = view.querySelector('.mf-sample-in'); el.focus(); el.setSelectionRange(pos, pos); };
      view.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; open = null; render(); });
      view.querySelectorAll('.mf-card').forEach(c => c.onclick = () => { open = c.dataset.fam; render(); });
      view.querySelectorAll('.mf-det .mf-name').forEach(h => h.onclick = () => { open = null; render(); });
      view.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => {
        e.stopPropagation();
        if (!confirm(t('confirm_delete'))) return;
        const r = await fetch(`${API}/custom/${b.dataset.del}`, { method: 'DELETE' });
        if (r.ok) { open = null; await refresh(); msg(t('removed')); } else msg(t('failed'), true);
      });
      const up = view.querySelector('.mf-up');
      if (up) up.onclick = async () => {
        const file = view.querySelector('.mf-f-file').files[0];
        const fam = view.querySelector('.mf-f-fam').value.trim();
        if (!file || !fam) return msg(t('bad_family'), true);
        const qs = new URLSearchParams({ family: fam, weight: view.querySelector('.mf-f-w').value, italic: view.querySelector('.mf-f-it').checked, category: view.querySelector('.mf-f-c').value });
        const r = await fetch(`${API}/custom?${qs}`, { method: 'POST', body: file });
        if (r.ok) { injected.delete(fam); await refresh(); cat = 'custom'; open = fam; render(); msg(t('done')); }
        else { const j = await r.json().catch(() => ({})); msg(t(j.error || (r.status === 403 ? 'admin_only' : 'failed')), true); }
      };
    }

    function msg(text, bad) {
      const el = view.querySelector('.mf-msg');
      if (el) { el.textContent = text; el.style.color = bad ? 'var(--danger,#da3633)' : 'inherit'; }
    }

    async function refresh() {
      data = await fetch(`${API}/catalog`).then(r => r.json());
      injected.clear();
      render();
    }
    refresh();
    return { destroy() { root.remove(); } };
  }
  window.MvmFonts = { mount };
})();
