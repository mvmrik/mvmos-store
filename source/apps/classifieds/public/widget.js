(function () {
'use strict';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mount(root, options = {}) {
  let lang = window.mvmOS?.lang || localStorage.getItem('language') || navigator.language;
  if (!window.CLASSIFIEDS_I18N[lang]) lang = lang.startsWith('pt') ? 'pt-BR' : lang.startsWith('zh') ? 'zh-CN' : lang.split('-')[0];
  const t = key => (window.CLASSIFIEDS_I18N[lang] || window.CLASSIFIEDS_I18N.en)[key] || window.CLASSIFIEDS_I18N.en[key] || key;
  const token = () => window.AppHub?.getToken?.() || localStorage.getItem('apphub_token') || '';
  let cfg, mine = false, watched = false, offset = 0, rows = [], total = 0, destroyed = false, requestId = 0;
  // The account's own saved display preferences (Apps Hub, server-side —
  // never localStorage, so they follow the person to any device). Empty
  // until fetched (or for a visitor with no account at all), in which case
  // date()/currency below fall back to this visitor's own browser / the
  // installation's configured default, same as before this existed.
  let prefs = {};
  const blobs = new Map();
  const abort = new AbortController();
  // No forced locale, no forced hour12, no forced field order by default —
  // the visitor's own browser decides, same as every other page they use.
  // Only overridden field-by-field when the signed-in account has explicitly
  // saved its own preference (prefs, fetched at startup below).
  const date = n => {
    const d = new Date(n * 1000);
    if (!prefs.date_format && !prefs.time_format) return d.toLocaleString();
    let dateStr = d.toLocaleDateString();
    if (prefs.date_format) {
      const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
      dateStr = prefs.date_format==='MM/DD/YYYY' ? `${v.month}/${v.day}/${v.year}` : prefs.date_format==='YYYY-MM-DD' ? `${v.year}-${v.month}-${v.day}` : `${v.day}/${v.month}/${v.year}`;
    }
    const timeStr = prefs.time_format ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:prefs.time_format==='12'}) : d.toLocaleTimeString();
    return `${dateStr} ${timeStr}`;
  };
  const money = row => row.price_cents === 0 ? t('free') : new Intl.NumberFormat(lang, {style:'currency', currency:row.currency,minimumFractionDigits:row.price_cents%100?2:undefined,maximumFractionDigits:2}).format(row.price_cents/100);
  const btn = (key, action, attr = '') => `<button type="button" data-action="${action}" ${attr}>${esc(t(key))}</button>`;
  const fail = e => { if (destroyed || e.name === 'AbortError') return; const slot = overlay.hidden && !modPage.hidden && modPage.querySelector('.cl-mod-error'); if (slot) { slot.textContent = t(e.message); return; } notice.textContent = t(e.message); notice.hidden = false; root.scrollTop = 0; };
  async function api(path, method = 'GET', body, admin = false) {
    const headers = {};
    if (token()) headers['X-Pub-Token'] = token();
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch((admin ? '/api/apps/classifieds' : '/pub/classifieds') + path, {method, headers, credentials:'same-origin', signal:abort.signal, body:body ? body instanceof FormData ? body : JSON.stringify(body) : undefined});
    let data; try { data = await r.json(); } catch { throw new Error('error'); }
    if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'error');
    return data;
  }
  function login() { location.href = '/pub/apphub/?return=' + encodeURIComponent(location.origin + '/pub/classifieds/'); }
  function requireLogin() { if (token()) return true; if (options.desktop) fail(new Error('login_required')); else login(); return false; }
  root.classList.add('cl-root');
  // In the desktop the app wears the mvmOS theme; the public page keeps its own look.
  if (options.desktop) root.classList.add('cl-desktop');
  root.innerHTML = `<header class="cl-header"><div><span class="cl-brand">◈</span> <strong>${esc(t('title'))}</strong><small>${esc(t('subtitle'))}</small></div><nav>${btn('browse','browse')}${btn('mine','mine')}${btn('watched','watched')}${btn('messages','messages')}${btn('new','new','class="cl-primary"')}${options.desktop ? btn('moderation','moderation')+btn('settings','settings') : btn(token() ? 'profile' : 'login','login')}</nav></header><div class="cl-notice" role="alert" hidden></div><div class="cl-banned" role="status" hidden></div><main class="cl-main"><section class="cl-filters"><form class="cl-search"><input name="q" maxlength="160" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><select name="category" aria-label="${esc(t('category'))}"></select><select name="currency" aria-label="${esc(t('currency'))}"></select><input name="min" type="number" min="0" step="0.01" placeholder="${esc(t('min_price'))}" aria-label="${esc(t('min_price'))}"><input name="max" type="number" min="0" step="0.01" placeholder="${esc(t('max_price'))}" aria-label="${esc(t('max_price'))}"><label class="cl-inline"><input name="free" type="checkbox">${esc(t('free'))}</label><select name="status" aria-label="${esc(t('status'))}" hidden>${['all','active','inactive','expired'].map(k=>`<option value="${k}">${esc(t(k))}</option>`).join('')}</select><button>${esc(t('search_button'))}</button></form></section><div class="cl-results" aria-live="polite"></div><section class="cl-grid"></section><footer class="cl-pager">${btn('previous','previous')}<span></span>${btn('next','next')}</footer></main><main class="cl-main cl-mod-page" hidden></main><div class="cl-overlay" hidden><section class="cl-dialog" role="dialog" aria-modal="true" tabindex="-1"></section></div>`;
  const $ = selector => root.querySelector(selector);
  const notice = $('.cl-notice'), search = $('.cl-search'), grid = $('.cl-grid'), overlay = $('.cl-overlay'), dialog = $('.cl-dialog'), mainView = $('.cl-main'), modPage = $('.cl-mod-page');
  let restoreFocus, currentConversation = null, inboxOffset = 0, pollBusy = false;
  const open = html => { currentConversation = null; root.scrollTop = 0; restoreFocus = document.activeElement; dialog.innerHTML = html; overlay.hidden = false; dialog.focus(); hydrate(dialog); };
  const close = () => { currentConversation = null; overlay.hidden = true; dialog.innerHTML = ''; restoreFocus?.focus(); };
  function catOptions(selected = '', parentsOnly = false) {
    let html = `<option value="">${esc(t(parentsOnly ? 'top_category' : 'all_categories'))}</option>`;
    for (const p of cfg.categories.filter(c => !c.parent_id)) {
      html += `<option value="${p.id}" ${String(selected)===String(p.id)?'selected':''}>${esc(p.name)}</option>`;
      if (!parentsOnly) for (const c of cfg.categories.filter(c=>c.parent_id===p.id)) html += `<option value="${c.id}" ${String(selected)===String(c.id)?'selected':''}>　${esc(p.name)} / ${esc(c.name)}</option>`;
    }
    return html;
  }
  const currencyOptions = (selected, all=false) => (all ? `<option value="">${esc(t('all_currencies'))}</option>` : '') + cfg.currencies.map(c=>`<option value="${c}" ${c===selected?'selected':''}>${esc(c)}</option>`).join('');
  const categoryName = id => { const c=cfg.categories.find(c=>c.id===id); const p=c?.parent_id && cfg.categories.find(p=>p.id===c.parent_id); return (p ? p.name+' / ' : '')+(c?.name || ''); };
  async function hydrate(container) {
    for (const img of container.querySelectorAll('img[data-src]')) {
      const url = img.dataset.src;
      try {
        if (!blobs.has(url)) blobs.set(url, fetch(url,{headers: token() ? {'X-Pub-Token':token()} : {},signal:abort.signal}).then(async r=> { if(!r.ok) throw new Error('not_found'); return URL.createObjectURL(await r.blob()); }));
        img.src = await blobs.get(url);
      } catch { blobs.delete(url); img.hidden=true; }
    }
  }
  async function load() {
    const seq = ++requestId;
    const f = new FormData(search);
    const p = new URLSearchParams({mine:String(mine),watched:String(watched),offset:String(offset),q:f.get('q'),category:f.get('category')||'0',free:String(f.get('free')==='on'),status:f.get('status')||'all',currency:f.get('currency')||''});
    if ((f.get('min') || f.get('max')) && !f.get('currency')) {p.set('currency',cfg.currency);search.elements.currency.value=cfg.currency;}
    if (f.get('min')) p.set('min_price',String(Math.round(Number(f.get('min'))*100)));
    if (f.get('max')) p.set('max_price',String(Math.round(Number(f.get('max'))*100)));
    $('.cl-results').textContent=t('loading');
    const data = await api('/listings?'+p);
    if (destroyed || seq!==requestId) return;
    rows=data.items; total=data.total;
    if(offset && !rows.length) {offset=Math.max(0,offset-24);return load();}
    search.elements.status.hidden=!mine;
    $('.cl-results').textContent = `${t(mine?'mine':watched?'watched':'browse')} · ${total}`;
    grid.innerHTML = rows.length ? rows.map(r=>`<article class="cl-card ${r.vip?'cl-vip':''}"><button class="cl-cover" data-action="detail" data-id="${r.id}" aria-label="${esc(r.title)}">${r.photos.length?`<img data-src="${r.photos[0].url}" alt="${esc(r.title)}" loading="lazy">`:'<span aria-hidden="true">◈</span>'}</button><div class="cl-card-body"><small>${esc(categoryName(r.category_id))}</small><button class="cl-card-title" data-action="detail" data-id="${r.id}">${r.vip?`<span class="cl-vip-badge">${esc(t('vip'))}</span> `:''}${esc(r.title)}</button><strong class="cl-price">${esc(money(r))}</strong><p>${esc(r.location || r.seller)}</p>${r.owned?`<span class="cl-status cl-${r.status}">${esc(t(r.status))}</span><small>${esc(t('expires'))}: ${esc(date(r.expires_at))}</small><small class="cl-stats">${esc(t('views'))}: ${r.views} · ${esc(t('watching'))}: ${r.watchers_count}</small><div class="cl-actions">${btn('edit','edit',`data-id="${r.id}"`)}${btn(r.status==='active'?'deactivate':'activate',r.status==='active'?'deactivate':'activate',`data-id="${r.id}"`)}${btn('bump','bump',`data-id="${r.id}" ${r.status!=='active'||r.bump_available_at>Date.now()/1000?'disabled':''} title="${esc(t('bump_hint'))} ${esc(date(r.bump_available_at))}"`)}${btn('delete','delete',`data-id="${r.id}" class="cl-danger"`)}</div>`:`<button type="button" class="cl-watch ${r.watched?'cl-watched':''}" data-action="${r.watched?'unwatch':'watch'}" data-id="${r.id}">${esc(t(r.watched?'unwatch':'watch'))}</button>`}</div></article>`).join('') : `<div class="cl-empty">◈<h2>${esc(t('empty'))}</h2><p>${esc(t('empty_hint'))}</p></div>`;
    $('.cl-pager span').textContent = total ? `${offset+1}–${Math.min(offset+24,total)} / ${total}` : '0';
    $('[data-action="previous"]').disabled=offset===0;
    $('[data-action="next"]').disabled=offset+24>=total;
    hydrate(grid);
  }
  async function detail(id) {
    const r = await api('/listings/'+id);
    open(`<div class="cl-dialog-head"><h2>${r.vip?`<span class="cl-vip-badge">${esc(t('vip'))}</span> `:''}${esc(r.title)}</h2>${btn('close','close')}</div><div class="cl-gallery">${r.photos.map(p=>`<img data-src="${p.url}" alt="${esc(r.title)}">`).join('')}</div><strong class="cl-price">${esc(money(r))}</strong><p>${esc(categoryName(r.category_id))} · ${esc(r.location)}</p><p class="cl-description">${esc(r.description)}</p><div class="cl-seller"><strong>${esc(r.seller)}</strong>${!r.owned ? btn('write_seller','write_seller',`data-id="${r.id}" class="cl-primary"`)+' '+btn(r.watched?'unwatch':'watch',r.watched?'unwatch':'watch',`data-id="${r.id}"`) : ''}${r.contact?`<p>${esc(t('contact'))}: ${esc(r.contact)}</p>`:''}</div><small>${esc(t('expires'))}: ${esc(date(r.expires_at))}</small>${r.owned&&r.vip?`<small>${esc(t('vip_active_until'))}: ${esc(date(r.vip_until))}</small>`:''}${r.owned?`<div class="cl-stats-panel"><p>${esc(t('views'))}: ${r.views} · ${esc(t('watching'))}: ${r.watchers_count}</p>${r.watchers.length?`<div class="cl-watchers">${r.watchers.map(w=>`<div><span>${esc(w.name)}</span>${btn('message_watcher','message_watcher',`data-id="${r.id}" data-user="${w.id}"`)}</div>`).join('')}</div>`:`<p>${esc(t('no_watchers'))}</p>`}</div>`:''}`);
  }
  const field = (key, input) => `<label>${esc(t(key))}${input}</label>`;
  async function editor(id) {
    if(!requireLogin()) return;
    const r=id?await api('/listings/'+id):{title:'',description:'',price_cents:0,location:'',contact:'',photos:[]};
    let vipClientId=null;
    open(`<div class="cl-dialog-head"><h2>${esc(t(id?'edit':'new'))}</h2>${btn('close','close')}</div><form class="cl-editor">${field('ad_title',`<input name="title" required maxlength="140" value="${esc(r.title)}">`)}${field('description',`<textarea name="description" required maxlength="10000" rows="5">${esc(r.description)}</textarea>`)}${field('category',`<select name="category_id" required>${catOptions(r.category_id)}</select>`)}<div class="cl-columns">${field('price',`<input name="price" type="number" min="0" max="999999999.99" step="0.01" required value="${r.price_cents/100}">`)}${field('currency',`<select name="currency">${currencyOptions(r.currency||cfg.currency)}</select>`)}<span>${esc(t('zero_free'))}</span></div>${field('location',`<input name="location" maxlength="160" value="${esc(r.location)}">`)}${field('contact',`<input name="contact" maxlength="250" value="${esc(r.contact)}">`)}<small>${esc(t('contact_hint'))}</small><div class="cl-edit-photos">${r.photos.map(p=>`<div><img data-src="${p.url}" alt="${esc(t('photos'))}">${btn('remove','remove_photo',`data-id="${r.id}" data-photo="${p.id}"`)}</div>`).join('')}</div>${field('photos','<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>')}<small>${esc(t('photos_hint'))}</small><p>${esc(t('validity'))}: ${cfg.validity_days} ${esc(t('days'))}</p>${cfg.vip_packages?.length?`<div class="cl-vip-picker">${field('vip_package',`<select name="vip_package_id"><option value="">${esc(t('vip_none'))}</option>${cfg.vip_packages.map(p=>`<option value="${p.id}">${esc(p.name)} — ${p.price_credits} ${esc(t('credits'))} (${p.days} ${esc(t('days'))})</option>`).join('')}</select>`)}${r.vip?`<small>${esc(t('vip_active_until'))}: ${esc(date(r.vip_until))}</small>`:''}</div>`:''}<div class="cl-verify" hidden></div><div class="cl-form-error" role="alert"></div><button class="cl-primary" type="submit">${esc(t('save'))}</button></form>`);
    const form=dialog.querySelector('form');
    // Verification never interrupts anything else: it shows up only here,
    // when the chosen category is one this person still has to verify for.
    const originalCategory=r.category_id;
    const checkVerify=()=>{const cat=Number(form.elements.category_id.value);if(cat&&cat!==originalCategory)verifyPanel(form.querySelector('.cl-verify'),cat).catch(()=>{});else form.querySelector('.cl-verify').hidden=true;};
    form.elements.category_id.onchange=checkVerify;
    form.onsubmit=async e=>{
      e.preventDefault(); const submit=form.querySelector('[type="submit"]'), error=form.querySelector('.cl-form-error');
      error.textContent=''; submit.disabled=true;
      try {
        const files=[...form.elements.photos.files];
        if(files.length+form.querySelectorAll('.cl-edit-photos > div').length>10) throw new Error('image_limit');
        if(files.some(f=>f.size>5*1024*1024)) throw new Error('image_size');
        const f=new FormData(form), body={title:f.get('title'),description:f.get('description'),category_id:Number(f.get('category_id')),price_cents:Math.round(Number(f.get('price'))*100),currency:f.get('currency'),location:f.get('location'),contact:f.get('contact')};
        if(id) await api('/listings/'+id,'PUT',body); else { const result=await api('/listings','POST',body); id=result.id; r.id=id; }
        // Keep the saved id after upload failure: retry edits this ad instead of duplicating it.
        for (const file of files) { const fd=new FormData();fd.append('file',file); const p=await api('/listings/'+id+'/photos','POST',fd); r.photos.push(p); }
        const vipPid=f.get('vip_package_id');
        if(vipPid){ vipClientId=vipClientId||crypto.randomUUID(); await api('/listings/'+id+'/vip','POST',{package_id:vipPid,client_id:vipClientId}); }
        close(); mine=true; offset=0; await load();
      } catch(e) {error.textContent=t(e.message); if(e.message==='verification_required') await verifyPanel(form.querySelector('.cl-verify'),Number(form.elements.category_id.value)).catch(()=>{}); if(id) { const current=await api('/listings/'+id).catch(()=>null); if(current) r.photos=current.photos; form.elements.photos.value=''; }}
      finally {submit.disabled=false;}
    };
  }
  async function verifyPanel(box, categoryId) {
    if(!cfg.verification||!token()){box.hidden=true;return;}
    const data=await api('/verification?category_id='+categoryId);
    box.hidden=!data.items.length;
    box.innerHTML=data.items.length?`<strong>${esc(t('verification_needed'))}</strong>${data.items.map(v=>`<div class="cl-verify-item"><h4>${esc(v.name)}</h4><p class="cl-description">${esc(v.instructions)}</p>${v.pending?`<p class="cl-verify-pending">${esc(t('verification_pending'))}</p>`:''}${field(v.pending?'verification_replace_photo':'verification_photo','<input type="file" accept="image/jpeg,image/png,image/webp">')}${btn('verification_send','verify_send',`data-id="${v.id}" data-category="${categoryId}"`)}<div role="status"></div></div>`).join('')}`:'';
  }
  async function verifyAdmin() {
    const v=await api('/verifications','GET',undefined,true);
    const triggerText=r=>r.trigger==='immediate'?t('verification_trigger_immediate'):t('verification_trigger_'+r.trigger+'_n').replace('{n}',r.trigger_value);
    const cats=r=>r.categories.length?r.categories.map(categoryName).join(', '):t('all_categories');
    open(`<div class="cl-dialog-head"><h2>${esc(t('verifications'))} ${v.premium?'':'🔒'}</h2>${btn('close','close')}</div>${btn('back_settings','settings')}<p><small>${esc(t('verification_hint'))}</small></p>
      <h3>${esc(t('verification_pending_list'))}</h3><div class="cl-verify-pending-list">${v.pending.length?v.pending.map(s=>`<div class="cl-verify-review"><img data-src="/api/apps/classifieds/verification-submissions/${s.id}/photo" alt="${esc(t('verification_photo'))}"><div><strong>${esc(s.user_name)}</strong><span>${esc(s.requirement_name)}</span><small>${esc(date(s.created_at))}</small><div class="cl-actions">${btn('verification_approve','verify_review',`data-id="${s.id}" data-decision="approve" class="cl-primary"`)}${btn('verification_reject','verify_review',`data-id="${s.id}" data-decision="reject" class="cl-danger"`)}</div></div></div>`).join(''):`<p>${esc(t('verification_no_pending'))}</p>`}</div>
      <h3>${esc(t('verification_requirements'))}</h3><div class="cl-vip-admin-list">${v.items.length?v.items.map(r=>`<div><span><strong>${esc(r.name)}</strong>${r.active?'':` · ${esc(t('inactive'))}`}<br><small>${esc(triggerText(r))} · ${esc(cats(r))} · ${esc(t('verification_verified_count'))}: ${r.verified}</small></span>${btn('edit','verify_edit',`data-id="${r.id}"`)}${btn('verification_verified_users','verify_users',`data-id="${r.id}"`)}${btn('delete','verify_delete',`data-id="${r.id}"`)}</div><div class="cl-verify-users" data-for="${r.id}" hidden></div>`).join(''):`<p>${esc(t('verification_none'))}</p>`}</div>
      <form class="cl-verify-form"><h3>${esc(t('verification_new'))}</h3><input type="hidden" name="id">${field('verification_name','<input name="name" required maxlength="80">')}${field('verification_instructions',`<textarea name="instructions" required maxlength="2000" rows="4" placeholder="${esc(t('verification_instructions_placeholder'))}"></textarea>`)}<div class="cl-columns">${field('verification_trigger',`<select name="trigger"><option value="immediate">${esc(t('verification_trigger_immediate'))}</option><option value="after_days">${esc(t('verification_trigger_after_days'))}</option><option value="after_listings">${esc(t('verification_trigger_after_listings'))}</option></select>`)}${field('verification_trigger_value','<input name="trigger_value" type="number" min="1" max="100000" value="3">')}</div><fieldset class="cl-verify-cats"><legend>${esc(t('verification_categories'))}</legend><small>${esc(t('verification_categories_hint'))}</small>${cfg.categories.filter(c=>!c.parent_id).map(p=>`<label class="cl-inline"><input type="checkbox" name="categories" value="${p.id}">${esc(p.name)}</label>${cfg.categories.filter(c=>c.parent_id===p.id).map(c=>`<label class="cl-inline cl-sub"><input type="checkbox" name="categories" value="${c.id}">${esc(c.name)}</label>`).join('')}`).join('')}</fieldset><label class="cl-inline"><input type="checkbox" name="active" checked>${esc(t('active'))}</label><div class="cl-actions"><button type="submit" class="cl-primary">${esc(t('save'))}</button>${btn('cancel','verify_cancel','hidden')}</div><div role="alert"></div></form>`);
    const form=dialog.querySelector('.cl-verify-form'),save=form.querySelector('[type="submit"]');
    const syncValue=()=>{form.elements.trigger_value.closest('label').hidden=form.elements.trigger.value==='immediate';};
    form.elements.trigger.onchange=syncValue;syncValue();
    if (options.desktop) window.mvmOS?.premiumGate?.(save, t('verification_premium_hint'));
    dialog._verifyItems=v.items;
    form.onsubmit=async e=>{e.preventDefault();const f=e.target;try{
      const body={name:f.elements.name.value,instructions:f.elements.instructions.value,trigger:f.elements.trigger.value,trigger_value:Number(f.elements.trigger_value.value)||0,categories:[...f.querySelectorAll('[name="categories"]:checked')].map(x=>Number(x.value)),active:f.elements.active.checked};
      const rid=f.elements.id.value;
      await api('/verifications'+(rid?'/'+rid:''),rid?'PUT':'POST',body,true);
      cfg=await api('/config');await verifyAdmin();
    }catch(e){f.querySelector('[role="alert"]').textContent=t(e.message);}};
    setPending(v.pending.length);
  }
  function setPending(n) {
    if(!options.desktop) return;
    $('[data-action="settings"]').textContent=t('settings')+(n?` (${n})`:'');
  }
  async function admin() {
    cfg=await api('/settings','GET',undefined,true);
    const vip=await api('/vip-packages','GET',undefined,true);
    const verify=await api('/verifications','GET',undefined,true);
    open(`<div class="cl-dialog-head"><h2>${esc(t('settings'))}</h2>${btn('close','close')}</div><form class="cl-settings">${field('validity',`<input type="number" name="validity_days" min="1" max="3650" required value="${cfg.validity_days}">`)}${field('currency',`<select name="currency"><option value="" ${!cfg.default_currency?'selected':''}>${esc(t('system_default'))} (${esc(cfg.system_currency)})</option>${currencyOptions(cfg.default_currency)}</select>`)}<small>${esc(t('settings_hint'))}</small><button>${esc(t('save'))}</button><div role="status"></div></form><h3>${esc(t('categories'))}</h3><div class="cl-category-list">${cfg.categories.map(c=>`<div><span>${esc(categoryName(c.id))}</span>${btn('edit','edit_category',`data-id="${c.id}"`)}${btn('delete','delete_category',`data-id="${c.id}"`)}</div>`).join('')}</div><form class="cl-category-form">${field('category_name','<input name="name" required maxlength="80">')}${field('parent',`<select name="parent_id">${catOptions('',true)}</select>`)}<button>${esc(t('add'))}</button><div role="alert"></div></form><h3>${esc(t('vip_packages'))} ${vip.premium?'':'🔒'}</h3><div class="cl-vip-admin-list">${vip.items.length?vip.items.map(p=>`<div><span>${esc(p.name)} — ${p.price_credits} ${esc(t('credits'))} (${p.days} ${esc(t('days'))})</span>${btn('delete','delete_vip_package',`data-id="${p.id}"`)}</div>`).join(''):`<p>${esc(t('no_vip_packages'))}</p>`}</div><form class="cl-vip-form">${field('vip_package_name','<input name="name" required maxlength="80">')}${field('vip_package_days','<input name="days" type="number" min="1" max="3650" required value="7">')}${field('vip_package_price','<input name="price_credits" type="number" min="0" max="1000000" required value="5">')}<button type="submit">${esc(t('add'))}</button><div role="alert"></div></form><h3>${esc(t('verifications'))} ${verify.premium?'':'🔒'}</h3><p><small>${esc(t('verification_hint'))}</small></p>${btn('verification_manage','verify_admin')}${verify.pending.length?` <strong>${esc(t('verification_pending_list'))}: ${verify.pending.length}</strong>`:''}`);
    setPending(verify.pending.length);
    dialog.querySelector('.cl-settings').onsubmit=async e=> {e.preventDefault();const f=e.target;try {await api('/settings','PUT',{validity_days:Number(f.elements.validity_days.value),currency:f.elements.currency.value},true);cfg=await api('/config');f.querySelector('[role="status"]').textContent=t('saved');}catch(e){f.querySelector('[role="status"]').textContent=t(e.message);}};
    dialog.querySelector('.cl-category-form').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await api('/categories','POST',{name:f.elements.name.value,parent_id:Number(f.elements.parent_id.value)||null},true);await admin(); search.elements.category.innerHTML=catOptions();}catch(e){f.querySelector('[role="alert"]').textContent=t(e.message);}};
    const vipForm=dialog.querySelector('.cl-vip-form'), vipSave=vipForm.querySelector('[type="submit"]');
    // The control stays visible either way — window.mvmOS.premiumGate greys it
    // out and swaps the click for the shared premium modal when this
    // installation has no active Premium; the endpoint itself refuses the
    // save regardless, so a locked button is never the only thing enforcing it.
    if (options.desktop) window.mvmOS?.premiumGate?.(vipSave, t('vip_premium_hint'));
    vipForm.onsubmit=async e=>{e.preventDefault();const f=e.target;try{await api('/vip-packages','POST',{name:f.elements.name.value,days:Number(f.elements.days.value),price_credits:Number(f.elements.price_credits.value)},true);await admin();}catch(e){f.querySelector('[role="alert"]').textContent=t(e.message);}};
  }
  // Moderation (desktop only): its own page beside the listings, not a
  // dialog — every listing and every profile Classifieds knows, whoever owns
  // them. State survives going into a listing and back.
  const mod={tab:'listings',q:'',category:'',status:'all',owner:'',ownerName:'',offset:0,uq:'',ufilter:'all',uoffset:0,selected:new Set(),page:50};
  const nav=action=>root.querySelectorAll('.cl-header nav [data-action]').forEach(x=>x.classList.toggle('cl-current',x.dataset.action===action));
  function showMod(html){close();mainView.hidden=true;modPage.hidden=false;modPage.innerHTML=html;nav('moderation');root.scrollTop=0;hydrate(modPage);}
  function leaveMod(action){if(modPage.hidden&&action)return nav(action);modPage.hidden=true;modPage.innerHTML='';mainView.hidden=false;nav(action);}
  const modHead=(extra='')=>`<div class="cl-mod-head"><h2>${esc(t('moderation'))}</h2><div class="cl-mod-tabs" role="tablist">${['listings','users'].map(k=>btn('mod_'+k,'mod_tab',`role="tab" data-tab="${k}" aria-selected="${mod.tab===k}" ${mod.tab===k?'class="cl-current"':''}`)).join('')}</div>${extra}</div>`;
  const pager=(off,total,action)=>`<div class="cl-pager">${btn('previous',action,'data-step="-1" '+(off?'':'disabled'))}<span>${total?`${off+1}–${Math.min(off+mod.page,total)} / ${total}`:'0'}</span>${btn('next',action,'data-step="1" '+(off+mod.page<total?'':'disabled'))}</div>`;
  const banned=()=>`<span class="cl-mod-banned">${esc(t('mod_banned'))}</span>`;
  async function moderation() {
    if(mod.tab==='users') return modUsers();
    const p=new URLSearchParams({q:mod.q,category:mod.category||'0',status:mod.status,owner:mod.owner,offset:String(mod.offset)});
    const data=await api('/admin/listings?'+p,'GET',undefined,true);
    if(mod.offset&&!data.items.length){mod.offset=Math.max(0,mod.offset-data.page);return moderation();}
    mod.page=data.page;
    const ids=new Set(data.items.map(r=>r.id));mod.selected=new Set([...mod.selected].filter(id=>ids.has(id)));
    const row=r=>`<div class="cl-mod-row" role="row"><span><input type="checkbox" class="cl-mod-pick" value="${r.id}" ${mod.selected.has(r.id)?'checked':''} aria-label="${esc(r.title)}"></span><button type="button" class="cl-mod-thumb" data-action="mod_edit" data-id="${r.id}" tabindex="-1">${r.photos.length?`<img data-src="${r.photos[0].url}" alt="">`:'◈'}</button><div class="cl-mod-main"><button type="button" class="cl-mod-title" data-action="mod_edit" data-id="${r.id}">${r.vip?`<span class="cl-vip-badge">${esc(t('vip'))}</span> `:''}${esc(r.title)}</button><small>${esc(categoryName(r.category_id))} · <strong>${esc(money(r))}</strong></small><small>${esc(t('mod_created'))} ${esc(date(r.created_at))} · ${esc(t('views'))} ${r.views} · ${esc(t('watching'))} ${r.watchers_count}</small></div><div class="cl-mod-who"><button type="button" class="cl-link" data-action="mod_owner" data-id="${r.owner_id}" data-name="${esc(r.owner_name||r.owner_id)}">${esc(r.owner_name||r.owner_id)}</button>${r.owner_username?`<small>@${esc(r.owner_username)}</small>`:''}${r.owner_banned?banned():''}</div><div class="cl-mod-state"><span class="cl-status cl-${r.status}">${esc(t(r.status))}</span><small>${esc(t('expires'))} ${esc(date(r.expires_at))}</small></div><div class="cl-mod-acts">${btn(r.status==='active'?'deactivate':'activate','mod_bulk',`data-id="${r.id}" data-bulk="${r.status==='active'?'deactivate':'activate'}"`)}${btn('delete','mod_bulk',`data-id="${r.id}" data-bulk="delete" class="cl-danger"`)}</div></div>`;
    showMod(`${modHead()}<form class="cl-mod-toolbar"><input name="q" type="search" maxlength="160" value="${esc(mod.q)}" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}"><select name="category" aria-label="${esc(t('category'))}">${catOptions(mod.category)}</select><select name="status" aria-label="${esc(t('status'))}">${['all','active','expired','inactive','vip'].map(k=>`<option value="${k}" ${mod.status===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select><button class="cl-primary">${esc(t('search_button'))}</button></form>${mod.owner?`<div class="cl-mod-chip">${esc(t('mod_owner'))}: <strong>${esc(mod.ownerName)}</strong>${btn('mod_show_all','mod_clear_owner','class="cl-link"')}</div>`:''}
      <div class="cl-mod-bulk" hidden><span class="cl-mod-count"></span><span class="cl-mod-move"><select class="cl-mod-target" aria-label="${esc(t('mod_move'))}">${catOptions('',false).replace(/^<option value="">[^<]*<\/option>/,`<option value="">${esc(t('mod_move'))}…</option>`)}</select>${btn('mod_move_button','mod_bulk','data-bulk="move"')}</span>${btn('activate','mod_bulk','data-bulk="activate"')}${btn('deactivate','mod_bulk','data-bulk="deactivate"')}${btn('mod_end_vip','mod_bulk','data-bulk="end_vip"')}${btn('delete','mod_bulk','data-bulk="delete" class="cl-danger"')}</div><div class="cl-form-error cl-mod-error" role="alert"></div>
      <div class="cl-mod-table cl-mod-listings" role="table">${data.items.length?`<div class="cl-mod-row cl-mod-th" role="row"><span><input type="checkbox" class="cl-mod-all" aria-label="${esc(t('mod_select_all'))}" title="${esc(t('mod_select_all'))}"></span><span></span><span>${esc(t('mod_listing'))}</span><span>${esc(t('mod_owner'))}</span><span>${esc(t('status'))}</span><span></span></div>${data.items.map(row).join('')}`:`<p class="cl-mod-empty">${esc(t('empty'))}</p>`}</div>
      ${pager(mod.offset,data.total,'mod_page')}`);
    const all=modPage.querySelector('.cl-mod-all'),picks=[...modPage.querySelectorAll('.cl-mod-pick')];
    const sync=()=>{const n=mod.selected.size;modPage.querySelector('.cl-mod-bulk').hidden=!n;modPage.querySelector('.cl-mod-count').textContent=t('mod_selected').replace('{n}',n);if(all){all.checked=n>0&&picks.every(x=>x.checked);all.indeterminate=n>0&&!all.checked;}picks.forEach(x=>x.closest('.cl-mod-row').classList.toggle('cl-picked',x.checked));};sync();
    modPage.querySelector('.cl-mod-toolbar').onsubmit=e=>{e.preventDefault();const f=e.target.elements;mod.q=f.q.value.trim();mod.category=f.category.value;mod.status=f.status.value;mod.offset=0;moderation().catch(fail);};
    if(all)all.onchange=()=>{picks.forEach(x=>{x.checked=all.checked;mod.selected[all.checked?'add':'delete'](x.value);});sync();};
    picks.forEach(x=>x.onchange=()=>{mod.selected[x.checked?'add':'delete'](x.value);sync();});
  }
  async function modUsers() {
    const data=await api('/admin/users?'+new URLSearchParams({q:mod.uq,filter:mod.ufilter,offset:String(mod.uoffset)}),'GET',undefined,true);
    mod.page=data.page;
    const row=u=>`<div class="cl-mod-row" role="row"><div class="cl-mod-main"><strong>${esc(u.name||u.id)}</strong>${u.username?`<small>@${esc(u.username)}</small>`:''}</div><div><small>${esc(t('mod_listing_count').replace('{n}',u.listings).replace('{a}',u.active_listings))}</small></div><div class="cl-mod-state">${u.banned?`${banned()}<small>${esc(date(u.banned_at))}${u.banned_by?` · ${esc(u.banned_by)}`:''}</small>${u.ban_reason?`<small>${esc(t('mod_reason'))}: ${esc(u.ban_reason)}</small>`:''}`:''}</div><div class="cl-mod-acts">${btn('mod_view_listings','mod_owner',`data-id="${u.id}" data-name="${esc(u.name||u.id)}" ${u.listings?'':'disabled'}`)}${u.banned?btn('mod_unban','mod_unban',`data-id="${u.id}" data-name="${esc(u.name||u.id)}"`):btn('mod_ban','mod_ban',`data-id="${u.id}" data-name="${esc(u.name||u.id)}" class="cl-danger"`)}</div></div>`;
    showMod(`${modHead()}<form class="cl-mod-toolbar"><input name="q" type="search" maxlength="80" value="${esc(mod.uq)}" placeholder="${esc(t('mod_search_users'))}" aria-label="${esc(t('mod_search_users'))}"><select name="filter" aria-label="${esc(t('status'))}"><option value="all">${esc(t('mod_all_users'))}</option><option value="banned" ${mod.ufilter==='banned'?'selected':''}>${esc(t('mod_filter_banned'))}</option></select><button class="cl-primary">${esc(t('search_button'))}</button></form><p class="cl-mod-hint">${esc(t('mod_ban_hint'))}</p><div class="cl-form-error cl-mod-error" role="alert"></div>
      <div class="cl-mod-table cl-mod-users" role="table">${data.items.length?`<div class="cl-mod-row cl-mod-th" role="row"><span>${esc(t('mod_profile'))}</span><span>${esc(t('mod_listings'))}</span><span>${esc(t('status'))}</span><span></span></div>${data.items.map(row).join('')}`:`<p class="cl-mod-empty">${esc(t('mod_no_users'))}</p>`}</div>
      ${pager(mod.uoffset,data.total,'mod_upage')}`);
    modPage.querySelector('.cl-mod-toolbar').onsubmit=e=>{e.preventDefault();const f=e.target.elements;mod.uq=f.q.value.trim();mod.ufilter=f.filter.value;mod.uoffset=0;modUsers().catch(fail);};
  }
  async function modEditor(id) {
    const r=await api('/admin/listings/'+id,'GET',undefined,true);
    const facts=[[t('mod_owner'),`<button type="button" class="cl-link" data-action="mod_owner" data-id="${r.owner_id}" data-name="${esc(r.owner_name||r.owner_id)}">${esc(r.owner_name||r.owner_id)}</button>${r.owner_banned?' '+banned():''}`],[t('status'),`<span class="cl-status cl-${r.status}">${esc(t(r.status))}</span>`],[t('mod_created'),esc(date(r.created_at))],[t('expires'),esc(date(r.expires_at))],...(r.vip?[[t('vip_active_until'),esc(date(r.vip_until))]]:[]),[t('views'),r.views],[t('watching'),r.watchers_count]];
    showMod(`<div class="cl-mod-head">${btn('mod_back','moderation','class="cl-link cl-mod-back"')}<h2>${esc(r.title)}</h2></div><div class="cl-mod-edit"><form class="cl-mod-form">${field('ad_title',`<input name="title" required maxlength="140" value="${esc(r.title)}">`)}${field('description',`<textarea name="description" required maxlength="10000" rows="7">${esc(r.description)}</textarea>`)}${field('category',`<select name="category_id" required>${catOptions(r.category_id)}</select>`)}<div class="cl-columns">${field('price',`<input name="price" type="number" min="0" max="999999999.99" step="0.01" required value="${r.price_cents/100}">`)}${field('currency',`<select name="currency">${currencyOptions(r.currency)}</select>`)}</div><small>${esc(t('zero_free'))}</small>${field('location',`<input name="location" maxlength="160" value="${esc(r.location)}">`)}${field('contact',`<input name="contact" maxlength="250" value="${esc(r.contact)}">`)}${r.photos.length?`<div class="cl-edit-photos">${r.photos.map(p=>`<div><img data-src="${p.url}" alt="${esc(t('photos'))}">${btn('remove','mod_remove_photo',`data-id="${r.id}" data-photo="${p.id}"`)}</div>`).join('')}</div>`:''}<small>${esc(t('mod_edit_hint'))}</small><div class="cl-form-error cl-mod-error" role="alert"></div><div><button class="cl-primary" type="submit">${esc(t('save'))}</button></div></form><aside class="cl-mod-side"><dl>${facts.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl><div class="cl-mod-side-acts">${btn(r.status==='active'?'deactivate':'activate','mod_bulk',`data-id="${r.id}" data-bulk="${r.status==='active'?'deactivate':'activate'}" data-stay="1"`)}${r.vip?btn('mod_end_vip','mod_bulk',`data-id="${r.id}" data-bulk="end_vip" data-stay="1"`):''}${btn('delete','mod_bulk',`data-id="${r.id}" data-bulk="delete" class="cl-danger"`)}${r.owner_banned?'':btn('mod_ban_owner','mod_ban',`data-id="${r.owner_id}" data-name="${esc(r.owner_name||r.owner_id)}" class="cl-danger"`)}</div></aside></div>`);
    const form=modPage.querySelector('form');
    form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),error=form.querySelector('.cl-form-error');error.textContent='';
      try{await api('/admin/listings/'+id,'PUT',{title:f.get('title'),description:f.get('description'),category_id:Number(f.get('category_id')),price_cents:Math.round(Number(f.get('price'))*100),currency:f.get('currency'),location:f.get('location'),contact:f.get('contact')},true);await moderation();}
      catch(e){error.textContent=t(e.message);}};
  }
  async function bannedNotice() {
    const box=$('.cl-banned');
    if(!token()){box.hidden=true;return;}
    const a=await api('/account');
    box.hidden=!a.banned;
    box.innerHTML=a.banned?`<strong>${esc(t('banned_notice'))}</strong>${a.ban_reason?`<br><small>${esc(t('mod_reason'))}: ${esc(a.ban_reason)}</small>`:''}`:'';
  }
  // Moderation notices arrive as messages whose sender is the system; they
  // carry a key and variables, so each reader sees them in their own language.
  const sysText = m => { let text = t('sys_' + m.key); for (const [k, v] of Object.entries(m.vars || {})) if (k !== 'reason') text = text.split('{' + k + '}').join(v); return m.vars?.reason ? text + '\n' + t('mod_reason') + ': ' + m.vars.reason : text; };
  async function unread() {
    if(!token()) return;
    const data = await api('/conversations');
    if(destroyed)return;
    $('[data-action="messages"]').textContent=t('messages')+(data.unread ? ` (${data.unread})` : '');
  }
  async function inbox() {
    if(!requireLogin()) return;
    const data=await api('/conversations?offset='+inboxOffset);
    open(`<div class="cl-dialog-head"><h2>${esc(t('messages'))}</h2>${btn('close','close')}</div><div class="cl-inbox">${data.items.length?data.items.map(c=>`<button data-action="conversation" data-id="${c.id}" ${c.system?'class="cl-system"':''}><strong>${c.system?`<span class="cl-system-badge">${esc(t('sys_badge'))}</span> ${esc(t('sys_sender'))}`:esc(c.peer)} ${c.unread?`<span class="cl-unread">${c.unread}</span>`:''}</strong><span>${esc(c.system?t('sys_title'):c.listing_title)}</span><small>${esc(c.preview_system?sysText(c.preview_system):c.preview||t('start_chat'))}</small></button>`).join(''):`<p>${esc(t('no_messages'))}</p>`}</div><div class="cl-pager">${btn('previous','inbox_previous',inboxOffset?'':'disabled')}${btn('next','inbox_next',inboxOffset+50<data.total?'':'disabled')}</div>`);
    await unread();
  }
  async function chat(cid) {
    const data=await api('/conversations/'+cid+'/messages');
    open(`<div class="cl-dialog-head"><div><small>${esc(data.system?t('sys_sender'):t('messages'))}</small><h2>${data.system?`<span class="cl-system-badge">${esc(t('sys_badge'))}</span> ${esc(t('sys_title'))}`:esc(data.listing_title)}</h2></div>${btn('close','close')}</div>${btn('back_messages','messages')}${btn('older_messages','older_messages',data.more?'':'hidden')}<div class="cl-messages" aria-live="polite"></div>${data.system?`<p class="cl-system-note">${esc(t('sys_no_reply'))}</p>`:''}<form class="cl-message-form" ${data.system?'hidden':''}>${field('message','<textarea name="message" required maxlength="4000" rows="3"></textarea>')}<button class="cl-primary">${esc(t('send'))}</button><div role="alert"></div></form>`);
    currentConversation=cid;
    let messageRows=data.items, pendingId=null, pendingText=null;
    const area=dialog.querySelector('.cl-messages');
    const render=()=>{area.innerHTML=messageRows.map(m=>m.system?`<div class="cl-bubble cl-system"><small class="cl-system-badge">${esc(t('sys_badge'))}</small><p>${esc(sysText(m.system))}</p><small>${esc(date(m.created_at))}</small></div>`:`<div class="cl-bubble ${m.mine?'cl-own':''}"><p>${esc(m.body)}</p><small>${esc(date(m.created_at))}</small></div>`).join('')||`<p>${esc(t('start_chat'))}</p>`;};
    render();area.scrollTop=area.scrollHeight;
    async function markRead(){const last=messageRows.at(-1);if(last && document.visibilityState==='visible'){await api('/conversations/'+cid+'/read','POST',{message_id:last.id});await unread();}}
    await markRead();
    dialog.querySelector('[data-action="older_messages"]').onclick=async e=>{try{const older=await api('/conversations/'+cid+'/messages?before='+messageRows[0].id);const h=area.scrollHeight;messageRows=[...older.items,...messageRows];render();area.scrollTop=area.scrollHeight-h;e.target.hidden=!older.more;}catch(e){fail(e);}};
    const refresh=async()=>{
      const fresh=await api('/conversations/'+cid+'/messages?after='+(messageRows.at(-1)?.id||0));if(currentConversation!==cid)return;
      const atBottom=area.scrollHeight-area.scrollTop-area.clientHeight<60;
      const known=new Set(messageRows.map(m=>m.id));const additions=fresh.items.filter(m=>!known.has(m.id));
      if(additions.length){messageRows.push(...additions);render();if(atBottom)area.scrollTop=area.scrollHeight;}
      await markRead();
      if(fresh.more && fresh.items.length) await refresh();
    };
    dialog._refreshChat=refresh;
    dialog.querySelector('.cl-message-form').onsubmit=async e=>{
      e.preventDefault();const f=e.target,b=f.querySelector('button'),text=f.elements.message.value.trim();if(!text)return;b.disabled=true;
      if(text!==pendingText){pendingText=text;pendingId=crypto.randomUUID();}
      try{await api('/conversations/'+cid+'/messages','POST',{body:text,client_id:pendingId});f.elements.message.value='';pendingText=pendingId=null;f.querySelector('[role="alert"]').textContent='';await refresh();area.scrollTop=area.scrollHeight;}
      catch(e){f.querySelector('[role="alert"]').textContent=t(e.message);}finally{b.disabled=false;}
    };
  }
  const poll=setInterval(async()=>{if(destroyed||pollBusy||document.visibilityState!=='visible'||!token())return;pollBusy=true;try{if(currentConversation)await dialog._refreshChat?.();else await unread();}catch{}finally{pollBusy=false;}},10000);
  root.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action]'); if(!b||b.disabled)return;
    const action=b.dataset.action,id=b.dataset.id; notice.hidden=true;
    try {
      if(action==='close') {close();await load();}
      else if(action==='login') login();
      else if(action==='browse'||action==='mine'||action==='watched') {if(action!=='browse'&&!requireLogin())return;leaveMod(action);mine=action==='mine';watched=action==='watched';offset=0;await load();}
      else if(action==='next'||action==='previous'){offset+=action==='next'?24:-24;await load();}
      else if(action==='messages') {inboxOffset=0;await inbox();}
      else if(action==='inbox_next'||action==='inbox_previous') {inboxOffset+=action==='inbox_next'?50:-50;await inbox();}
      else if(action==='conversation') await chat(id);
      else if(action==='write_seller') {if(requireLogin()){const c=await api('/listings/'+id+'/conversation','POST');await chat(c.id);}}
      else if(action==='message_watcher') {const c=await api('/listings/'+id+'/watchers/'+b.dataset.user+'/conversation','POST');await chat(c.id);}
      else if(action==='watch'||action==='unwatch') {
        if(!requireLogin())return;
        b.disabled=true;
        await api('/listings/'+id+'/watch',action==='watch'?'POST':'DELETE');
        const nowWatched=action==='watch';
        root.querySelectorAll(`[data-action="watch"][data-id="${id}"],[data-action="unwatch"][data-id="${id}"]`).forEach(el=>{
          el.dataset.action=nowWatched?'unwatch':'watch';
          el.textContent=t(nowWatched?'unwatch':'watch');
          el.classList.toggle('cl-watched',nowWatched);
          el.disabled=false;
        });
        if(watched && !nowWatched) await load();
      }
      else if(action==='detail') await detail(id);
      else if(action==='new'||action==='edit') await editor(id);
      else if(action==='settings') await admin();
      else if(action==='delete') {if(confirm(t('confirm_delete'))){await api('/listings/'+id,'DELETE');await load();}}
      else if(['activate','deactivate','bump'].includes(action)){b.disabled=true;await api('/listings/'+id+'/actions/'+action,'POST');await load();}
      else if(action==='remove_photo'){if(confirm(t('confirm_delete'))){await api('/listings/'+id+'/photos/'+b.dataset.photo,'DELETE');b.parentElement.remove();}}
      else if(action==='delete_category'){if(confirm(t('confirm_delete'))){await api('/categories/'+id,'DELETE',undefined,true);await admin();search.elements.category.innerHTML=catOptions();}}
      else if(action==='moderation') await moderation();
      else if(action==='mod_tab') {mod.tab=b.dataset.tab;await moderation();}
      else if(action==='mod_page') {mod.offset=Math.max(0,mod.offset+Number(b.dataset.step)*mod.page);await moderation();}
      else if(action==='mod_upage') {mod.uoffset=Math.max(0,mod.uoffset+Number(b.dataset.step)*mod.page);await modUsers();}
      else if(action==='mod_owner') {mod.tab='listings';mod.owner=id;mod.ownerName=b.dataset.name||id;mod.offset=0;mod.selected.clear();await moderation();}
      else if(action==='mod_clear_owner') {mod.owner='';mod.ownerName='';mod.offset=0;await moderation();}
      else if(action==='mod_edit') await modEditor(id);
      else if(action==='mod_bulk') {
        const kind=b.dataset.bulk,ids=id?[id]:[...mod.selected];
        if(!ids.length){fail(new Error('mod_nothing_selected'));return;}
        const body={ids,action:kind};
        if(kind==='move'){body.category_id=Number(modPage.querySelector('.cl-mod-target').value)||null;if(!body.category_id){fail(new Error('category_required'));return;}}
        if(kind==='delete'&&!confirm(t('mod_confirm_delete').replace('{n}',ids.length)))return;
        b.disabled=true;
        await api('/admin/listings/bulk','POST',body,true);
        if(!id)mod.selected.clear();
        if(b.dataset.stay)await modEditor(id);else await moderation();
      }
      else if(action==='mod_remove_photo'){if(confirm(t('confirm_delete'))){await api('/admin/listings/'+id+'/photos/'+b.dataset.photo,'DELETE',undefined,true);b.parentElement.remove();}}
      else if(action==='mod_ban') {
        const reason=prompt(t('mod_ban_prompt').replace('{name}',b.dataset.name),'');
        if(reason===null)return;
        b.disabled=true;
        await api('/admin/users/'+id+'/ban','POST',{reason},true);
        if(mod.tab==='users')await modUsers();else await moderation();
      }
      else if(action==='mod_unban'){if(confirm(t('mod_confirm_unban').replace('{name}',b.dataset.name))){await api('/admin/users/'+id+'/ban','DELETE',undefined,true);await modUsers();}}
      else if(action==='verify_admin') await verifyAdmin();
      else if(action==='verify_send') {
        const item=b.closest('.cl-verify-item'),file=item.querySelector('input[type="file"]').files[0],status=item.querySelector('[role="status"]');
        if(!file){status.textContent=t('verification_choose_photo');return;}
        if(file.size>5*1024*1024){status.textContent=t('image_size');return;}
        b.disabled=true;
        try{const fd=new FormData();fd.append('file',file);await api('/verification/'+id,'POST',fd);await verifyPanel(item.closest('.cl-verify'),Number(b.dataset.category));}
        catch(e){status.textContent=t(e.message);b.disabled=false;}
      }
      else if(action==='verify_review') {
        const decision=b.dataset.decision;
        if(decision==='reject'&&!confirm(t('verification_confirm_reject')))return;
        b.disabled=true;
        await api('/verification-submissions/'+id+'/'+decision,'POST',undefined,true);
        // The reviewers' bell entry for this photo is done with either way.
        fetch('/api/notifications/read-by-ref',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Mvm-Surface':'desktop'},body:JSON.stringify({source:'classifieds',ref:'verification:'+id})}).catch(()=>{});
        await verifyAdmin();
      }
      else if(action==='verify_edit') {
        const r=dialog._verifyItems.find(x=>x.id===id),f=dialog.querySelector('.cl-verify-form');
        f.elements.id.value=r.id;f.elements.name.value=r.name;f.elements.instructions.value=r.instructions;f.elements.trigger.value=r.trigger;f.elements.trigger_value.value=r.trigger_value||3;f.elements.active.checked=r.active;
        f.elements.trigger.onchange();
        f.querySelectorAll('[name="categories"]').forEach(x=>{x.checked=r.categories.includes(Number(x.value));});
        f.querySelector('h3').textContent=t('verification_edit');f.querySelector('[data-action="verify_cancel"]').hidden=false;f.scrollIntoView({block:'start'});f.elements.name.focus();
      }
      else if(action==='verify_cancel') await verifyAdmin();
      else if(action==='verify_delete'){if(confirm(t('verification_confirm_delete'))){await api('/verifications/'+id,'DELETE',undefined,true);cfg=await api('/config');await verifyAdmin();}}
      else if(action==='verify_users') {
        const box=dialog.querySelector(`.cl-verify-users[data-for="${id}"]`);
        if(!box.hidden){box.hidden=true;return;}
        const data=await api('/verifications/'+id+'/verified','GET',undefined,true);
        box.innerHTML=data.items.length?data.items.map(u=>`<div><span>${esc(u.user_name)} <small>${esc(date(u.verified_at))}</small></span>${btn('verification_revoke','verify_revoke',`data-id="${id}" data-user="${u.user_id}"`)}</div>`).join(''):`<p>${esc(t('verification_no_verified'))}</p>`;
        box.hidden=false;
      }
      else if(action==='verify_revoke'){if(confirm(t('verification_confirm_revoke'))){await api('/verifications/'+id+'/verified/'+b.dataset.user,'DELETE',undefined,true);b.parentElement.remove();}}
      else if(action==='delete_vip_package'){if(confirm(t('confirm_delete'))){await api('/vip-packages/'+id,'DELETE',undefined,true);await admin();}}
      else if(action==='edit_category') {
        const c=cfg.categories.find(c=>String(c.id)===id),name=prompt(t('category_name'),c.name);
        if(name!==null){await api('/categories/'+id,'PUT',{name,parent_id:c.parent_id},true);await admin();search.elements.category.innerHTML=catOptions();}
      }
    } catch(e){fail(e);b.disabled=false;}
  },{signal:abort.signal});
  root.addEventListener('keydown',e=>{if(overlay.hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]')];if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},{signal:abort.signal});
  search.onsubmit=e=>{e.preventDefault();offset=0;load().catch(fail);};
  (async () => {
    // The account's own saved preferences live on its Apps Hub profile
    // (Settings there, not here) — /me is the same endpoint the profile
    // page itself reads and writes, so this always sees the latest choice.
    if (token()) { try { prefs = await fetch('/api/pub/apphub/me',{headers:{'X-Pub-Token':token()},signal:abort.signal}).then(r=>r.ok?r.json():{}); } catch { prefs = {}; } }
    try {
      cfg = await api('/config');
      if (prefs.currency && cfg.currencies.includes(prefs.currency)) cfg.currency = prefs.currency;
      search.elements.category.innerHTML=catOptions();search.elements.currency.innerHTML=currencyOptions('',true);
      nav('browse');await load();await unread();
      bannedNotice().catch(()=>{});
      if(options.desktop) api('/verifications','GET',undefined,true).then(v=>setPending(v.pending.length)).catch(()=>{});
      const lid=new URLSearchParams(location.search).get('listing');if(lid)await detail(lid);
    } catch(e) { fail(e); }
  })();
  return {destroy(){destroyed=true;clearInterval(poll);abort.abort();for(const p of blobs.values())p.then(URL.revokeObjectURL).catch(()=>{});blobs.clear();root.innerHTML='';}};
}
window.Classifieds={mount};
})();
