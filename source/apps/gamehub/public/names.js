/* Desktop-only catalogue editor. Games share these names through Game Hub. */
(() => {
  const t = key => window.t('gn_' + key);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path = '', options = {}) {
    const r = await fetch('/api/gamehub/names' + path, options);
    if (!r.ok) { const e = new Error(t(r.status === 409 ? 'duplicate' : r.status === 403 ? 'forbidden' : r.status === 422 ? 'invalid' : 'error')); e.status = r.status; throw e; }
    return r.json();
  }
  const countryName = (code, fallback) => {
    if (code === 'teams') return t('teams');
    try { return new Intl.DisplayNames([window.mvmOS?.lang || 'en'], {type:'region'}).of(code) || fallback; } catch (_) { return fallback; }
  };
  const flag = code => code === 'teams' ? '🏁' : String.fromCodePoint(...[...code].map(c => c.charCodeAt(0) + 127397));
  window.GHNames = { async mount(root, {onBack}) {
    if (!document.getElementById('gh-names-css')) {
      const link = document.createElement('link'); link.id = 'gh-names-css'; link.rel = 'stylesheet'; link.href = window.asset('/apps/gamehub/names.css'); document.head.append(link);
    }
    root.innerHTML = `<section class="gn"><div class="gn-heading"><button type="button" data-back>‹ ${esc(t('settings'))}</button><h2>${esc(t('title'))}</h2></div><p>${esc(t('intro'))}</p><div role="status" class="gn-status"></div><div class="gn-content"></div></section>`;
    const shell = root.querySelector('.gn'), status = shell.querySelector('.gn-status'), content = shell.querySelector('.gn-content');
    shell.querySelector('[data-back]').onclick = onBack;
    let summary, selected = '', category = '', search = '', offset = 0, revision = 0;
    const alive = () => root.contains(shell);
    function error(e) { if (alive()) { status.textContent = e.message || t('error'); status.classList.add('gn-error'); } }
    function clear() { status.textContent = ''; status.classList.remove('gn-error'); }
    function previewHTML(code) {
      return `<div class="gn-preview"><h3>${esc(t('preview'))}</h3><div class="gn-controls"><select aria-label="${esc(t('language'))}" data-lang>${['bg','de','en','es','fr','ja','pt-BR','ru','zh-CN'].map(l => `<option value="${l}" ${l === (window.mvmOS?.lang || 'en') ? 'selected' : ''}>${esc(new Intl.DisplayNames([window.mvmOS?.lang || 'en'],{type:'language'}).of(l))}</option>`).join('')}</select>${code === 'teams' ? '' : `<select aria-label="${esc(t('gender'))}" data-gender><option value="mixed">${esc(t('mixed'))}</option><option value="male">${esc(t('male'))}</option><option value="female">${esc(t('female'))}</option></select>`}<button type="button" data-preview>${esc(t('generate'))}</button></div><div class="gn-examples" aria-live="polite"></div></div>`;
    }
    function bindPreview(code) {
      const button = content.querySelector('[data-preview]');
      button.onclick = async () => {
        clear(); button.disabled = true;
        const target = content.querySelector('.gn-examples');
        try {
          const data = await api('/preview', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({country:code, gender:content.querySelector('[data-gender]')?.value || 'mixed', lang:content.querySelector('[data-lang]').value})});
          if (!target.isConnected || !alive()) return;
          target.innerHTML = data.examples.map(v => `<div><strong>${flag(v.country)} ${esc(v.display)}</strong><small>${esc(v.native)}${v.native !== v.latin ? ' · ' + esc(v.latin) : ''}</small></div>`).join('');
        } catch (e) { error(e); } finally { button.disabled = false; }
      };
    }
    async function home() {
      selected = ''; revision++; clear(); content.textContent = t('loading');
      try {
        summary = await api();
        if (!alive() || selected) return;
        content.innerHTML = `<div class="gn-grid">${summary.countries.map(c => `<button class="gn-country" type="button" data-country="${esc(c.code)}"><span>${flag(c.code)}</span><strong>${esc(countryName(c.code,c.name))}</strong><small>${Object.values(c.counts).reduce((a,b)=>a+b,0)} ${esc(t('entries'))}</small></button>`).join('')}</div>${previewHTML('')}`;
        content.querySelectorAll('[data-country]').forEach(b => b.onclick = () => { selected=b.dataset.country; category=selected==='teams'?'prefix':'male_first'; search=''; offset=0; detail(); });
        bindPreview('');
      } catch (e) { error(e); content.textContent = ''; }
    }
    async function detail() {
      const current = ++revision; clear();
      try {
        const data = await api('/' + encodeURIComponent(selected) + '?' + new URLSearchParams({category,q:search,offset,limit:50}));
        if (!alive() || current !== revision) return;
        content.innerHTML = `<div class="gn-heading"><button type="button" data-countries>‹ ${esc(t('countries'))}</button><h3>${flag(selected)} ${esc(countryName(selected,data.name))}</h3></div><div class="gn-categories">${data.groups.map(g => `<button type="button" data-category="${g}" aria-pressed="${g===category}">${esc(t(g))}</button>`).join('')}</div><p>${esc(t(selected==='teams'?'teams_hint':'spelling_hint'))}</p><form class="gn-controls" data-search><input type="search" maxlength="100" value="${esc(search)}" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><button>${esc(t('search'))}</button><span>${data.total} ${esc(t('entries'))}</span></form><div class="gn-table-wrap"><table><thead><tr><th>${esc(t('native'))}</th><th>${esc(t('latin'))}</th><th>${esc(t('source'))}</th>${summary.editable?'<th></th>':''}</tr></thead><tbody>${data.entries.map(v => `<tr><td>${esc(v.native)}</td><td>${esc(v.latin)}</td><td><small>${esc(t(v.custom?'custom':'standard'))}</small></td>${summary.editable?`<td>${v.custom?`<button type="button" data-delete="${v.id}" aria-label="${esc(t('delete'))} ${esc(v.native)}">${esc(t('delete'))}</button>`:''}</td>`:''}</tr>`).join('') || `<tr><td colspan="4">${esc(t('empty'))}</td></tr>`}</tbody></table></div><div class="gn-controls gn-pagination"><button type="button" data-prev ${offset===0?'disabled':''}>‹ ${esc(t('previous'))}</button><span>${data.total ? offset+1 : 0}–${Math.min(offset+50,data.total)} / ${data.total}</span><button type="button" data-next ${offset+50>=data.total?'disabled':''}>${esc(t('next'))} ›</button></div>${summary.editable?`<form class="gn-add"><h3>${esc(t('add'))}</h3><p>${esc(t('custom_hint'))}</p><div class="gn-controls"><label>${esc(t('native'))}<input name="native" required maxlength="100" autocomplete="off"></label>${selected==='teams'?'':`<label>${esc(t('latin'))}<input name="latin" required maxlength="100" autocomplete="off"></label>`}<button>${esc(t('add'))}</button></div></form>`:`<p>${esc(t('readonly'))}</p>`}${previewHTML(selected)}${data.sources.length?`<details class="gn-sources"><summary>${esc(t('sources'))}</summary><p>${esc(t('sources_hint'))}</p>${data.sources.map(s=>s.url ? `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></p>` : `<p>${esc(s.title)}</p>`).join('')}</details>`:''}`;
        content.querySelector('[data-countries]').onclick = home;
        content.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category; offset=0;search='';detail();});
        content.querySelector('[data-search]').onsubmit=e=>{e.preventDefault();search=e.currentTarget.querySelector('input').value;offset=0;detail();};
        content.querySelector('[data-prev]').onclick=()=>{offset=Math.max(0,offset-50);detail();};
        content.querySelector('[data-next]').onclick=()=>{offset+=50;detail();};
        const form=content.querySelector('.gn-add');
        if(form) form.onsubmit=async e=>{
          e.preventDefault();clear(); const button=form.querySelector('button'); button.disabled=true;
          const values=new FormData(form), native=String(values.get('native')).trim();
          try { await api('/'+selected+'/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,native,latin:selected==='teams'?native:String(values.get('latin')).trim()})}); search=native;offset=0;await detail(); if(alive())status.textContent=t('saved'); }
          catch(e){error(e);button.disabled=false;}
        };
        content.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
          if(!await window.mvmOS.confirm(t('delete_confirm')))return;
          b.disabled=true; try{await api('/'+selected+'/entries/'+b.dataset.delete,{method:'DELETE'});offset=0;await detail();}catch(e){error(e);b.disabled=false;}
        });
        bindPreview(selected);
      } catch(e){error(e);}
    }
    await home();
  }};
})();
