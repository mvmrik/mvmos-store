(function () {
'use strict';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mount(root, options = {}) {
  let lang = window.mvmOS?.lang || localStorage.getItem('language') || navigator.language;
  if (!window.CLASSIFIEDS_I18N[lang]) lang = lang.startsWith('pt') ? 'pt-BR' : lang.startsWith('zh') ? 'zh-CN' : lang.split('-')[0];
  const t = key => (window.CLASSIFIEDS_I18N[lang] || window.CLASSIFIEDS_I18N.en)[key] || window.CLASSIFIEDS_I18N.en[key] || key;
  const token = () => window.AppHub?.getToken?.() || localStorage.getItem('apphub_token') || '';
  let cfg, mine = false, offset = 0, rows = [], total = 0, destroyed = false, requestId = 0;
  const blobs = new Map();
  const abort = new AbortController();
  const date = n => new Date(n * 1000).toLocaleString(lang);
  const money = row => row.price_cents === 0 ? t('free') : new Intl.NumberFormat(lang, {style:'currency', currency:row.currency,minimumFractionDigits:row.price_cents%100?2:undefined,maximumFractionDigits:2}).format(row.price_cents/100);
  const btn = (key, action, attr = '') => `<button type="button" data-action="${action}" ${attr}>${esc(t(key))}</button>`;
  const fail = e => { if (!destroyed && e.name !== 'AbortError') { notice.textContent = t(e.message); notice.hidden = false; root.scrollTop = 0; } };
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
  root.innerHTML = `<header class="cl-header"><div><span class="cl-brand">◈</span> <strong>${esc(t('title'))}</strong><small>${esc(t('subtitle'))}</small></div><nav>${btn('browse','browse')}${btn('mine','mine')}${btn('messages','messages')}${btn('new','new','class="cl-primary"')}${options.desktop ? btn('settings','settings') : btn(token() ? 'profile' : 'login','login')}</nav></header><div class="cl-notice" role="alert" hidden></div><main class="cl-main"><section class="cl-filters"><form class="cl-search"><input name="q" maxlength="160" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><select name="category" aria-label="${esc(t('category'))}"></select><select name="currency" aria-label="${esc(t('currency'))}"></select><input name="min" type="number" min="0" step="0.01" placeholder="${esc(t('min_price'))}" aria-label="${esc(t('min_price'))}"><input name="max" type="number" min="0" step="0.01" placeholder="${esc(t('max_price'))}" aria-label="${esc(t('max_price'))}"><label class="cl-inline"><input name="free" type="checkbox">${esc(t('free'))}</label><select name="status" aria-label="${esc(t('status'))}" hidden>${['all','active','inactive','expired'].map(k=>`<option value="${k}">${esc(t(k))}</option>`).join('')}</select><button>${esc(t('search_button'))}</button></form></section><div class="cl-results" aria-live="polite"></div><section class="cl-grid"></section><footer class="cl-pager">${btn('previous','previous')}<span></span>${btn('next','next')}</footer></main><div class="cl-overlay" hidden><section class="cl-dialog" role="dialog" aria-modal="true" tabindex="-1"></section></div>`;
  const $ = selector => root.querySelector(selector);
  const notice = $('.cl-notice'), search = $('.cl-search'), grid = $('.cl-grid'), overlay = $('.cl-overlay'), dialog = $('.cl-dialog');
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
    const p = new URLSearchParams({mine:String(mine),offset:String(offset),q:f.get('q'),category:f.get('category')||'0',free:String(f.get('free')==='on'),status:f.get('status')||'all',currency:f.get('currency')||''});
    if ((f.get('min') || f.get('max')) && !f.get('currency')) {p.set('currency',cfg.currency);search.elements.currency.value=cfg.currency;}
    if (f.get('min')) p.set('min_price',String(Math.round(Number(f.get('min'))*100)));
    if (f.get('max')) p.set('max_price',String(Math.round(Number(f.get('max'))*100)));
    $('.cl-results').textContent=t('loading');
    const data = await api('/listings?'+p);
    if (destroyed || seq!==requestId) return;
    rows=data.items; total=data.total;
    if(offset && !rows.length) {offset=Math.max(0,offset-24);return load();}
    search.elements.status.hidden=!mine;
    $('.cl-results').textContent = `${t(mine?'mine':'browse')} · ${total}`;
    grid.innerHTML = rows.length ? rows.map(r=>`<article class="cl-card"><button class="cl-cover" data-action="detail" data-id="${r.id}" aria-label="${esc(r.title)}">${r.photos.length?`<img data-src="${r.photos[0].url}" alt="${esc(r.title)}" loading="lazy">`:'<span aria-hidden="true">◈</span>'}</button><div class="cl-card-body"><small>${esc(categoryName(r.category_id))}</small><button class="cl-card-title" data-action="detail" data-id="${r.id}">${esc(r.title)}</button><strong class="cl-price">${esc(money(r))}</strong><p>${esc(r.location || r.seller)}</p>${mine?`<span class="cl-status cl-${r.status}">${esc(t(r.status))}</span><small>${esc(t('expires'))}: ${esc(date(r.expires_at))}</small><div class="cl-actions">${btn('edit','edit',`data-id="${r.id}"`)}${btn(r.status==='active'?'deactivate':'activate',r.status==='active'?'deactivate':'activate',`data-id="${r.id}"`)}${btn('bump','bump',`data-id="${r.id}" ${r.status!=='active'||r.bump_available_at>Date.now()/1000?'disabled':''} title="${esc(t('bump_hint'))} ${esc(date(r.bump_available_at))}"`)}${btn('delete','delete',`data-id="${r.id}" class="cl-danger"`)}</div>`:''}</div></article>`).join('') : `<div class="cl-empty">◈<h2>${esc(t('empty'))}</h2><p>${esc(t('empty_hint'))}</p></div>`;
    $('.cl-pager span').textContent = total ? `${offset+1}–${Math.min(offset+24,total)} / ${total}` : '0';
    $('[data-action="previous"]').disabled=offset===0;
    $('[data-action="next"]').disabled=offset+24>=total;
    hydrate(grid);
  }
  async function detail(id) {
    const r = await api('/listings/'+id);
    open(`<div class="cl-dialog-head"><h2>${esc(r.title)}</h2>${btn('close','close')}</div><div class="cl-gallery">${r.photos.map(p=>`<img data-src="${p.url}" alt="${esc(r.title)}">`).join('')}</div><strong class="cl-price">${esc(money(r))}</strong><p>${esc(categoryName(r.category_id))} · ${esc(r.location)}</p><p class="cl-description">${esc(r.description)}</p><div class="cl-seller"><strong>${esc(r.seller)}</strong>${!r.owned ? btn('write_seller','write_seller',`data-id="${r.id}" class="cl-primary"`) : ''}${r.contact?`<p>${esc(t('contact'))}: ${esc(r.contact)}</p>`:''}</div><small>${esc(t('expires'))}: ${esc(date(r.expires_at))}</small>`);
  }
  const field = (key, input) => `<label>${esc(t(key))}${input}</label>`;
  async function editor(id) {
    if(!requireLogin()) return;
    const r=id?await api('/listings/'+id):{title:'',description:'',price_cents:0,location:'',contact:'',photos:[]};
    open(`<div class="cl-dialog-head"><h2>${esc(t(id?'edit':'new'))}</h2>${btn('close','close')}</div><form class="cl-editor">${field('ad_title',`<input name="title" required maxlength="140" value="${esc(r.title)}">`)}${field('description',`<textarea name="description" required maxlength="10000" rows="5">${esc(r.description)}</textarea>`)}${field('category',`<select name="category_id" required>${catOptions(r.category_id)}</select>`)}<div class="cl-columns">${field('price',`<input name="price" type="number" min="0" max="999999999.99" step="0.01" required value="${r.price_cents/100}">`)}${field('currency',`<select name="currency">${currencyOptions(r.currency||cfg.currency)}</select>`)}<span>${esc(t('zero_free'))}</span></div>${field('location',`<input name="location" maxlength="160" value="${esc(r.location)}">`)}${field('contact',`<input name="contact" maxlength="250" value="${esc(r.contact)}">`)}<small>${esc(t('contact_hint'))}</small><div class="cl-edit-photos">${r.photos.map(p=>`<div><img data-src="${p.url}" alt="${esc(t('photos'))}">${btn('remove','remove_photo',`data-id="${r.id}" data-photo="${p.id}"`)}</div>`).join('')}</div>${field('photos','<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>')}<small>${esc(t('photos_hint'))}</small><p>${esc(t('validity'))}: ${cfg.validity_days} ${esc(t('days'))}</p><div class="cl-form-error" role="alert"></div><button class="cl-primary" type="submit">${esc(t('save'))}</button></form>`);
    const form=dialog.querySelector('form');
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
        close(); mine=true; offset=0; await load();
      } catch(e) {error.textContent=t(e.message); if(id) { const current=await api('/listings/'+id).catch(()=>null); if(current) r.photos=current.photos; form.elements.photos.value=''; }}
      finally {submit.disabled=false;}
    };
  }
  async function admin() {
    cfg=await api('/settings','GET',undefined,true);
    open(`<div class="cl-dialog-head"><h2>${esc(t('settings'))}</h2>${btn('close','close')}</div><form class="cl-settings">${field('validity',`<input type="number" name="validity_days" min="1" max="3650" required value="${cfg.validity_days}">`)}${field('currency',`<select name="currency"><option value="" ${!cfg.default_currency?'selected':''}>${esc(t('system_default'))} (${esc(cfg.system_currency)})</option>${currencyOptions(cfg.default_currency)}</select>`)}<small>${esc(t('settings_hint'))}</small><button>${esc(t('save'))}</button><div role="status"></div></form><h3>${esc(t('categories'))}</h3><div class="cl-category-list">${cfg.categories.map(c=>`<div><span>${esc(categoryName(c.id))}</span>${btn('edit','edit_category',`data-id="${c.id}"`)}${btn('delete','delete_category',`data-id="${c.id}"`)}</div>`).join('')}</div><form class="cl-category-form">${field('category_name','<input name="name" required maxlength="80">')}${field('parent',`<select name="parent_id">${catOptions('',true)}</select>`)}<button>${esc(t('add'))}</button><div role="alert"></div></form>`);
    dialog.querySelector('.cl-settings').onsubmit=async e=> {e.preventDefault();const f=e.target;try {await api('/settings','PUT',{validity_days:Number(f.elements.validity_days.value),currency:f.elements.currency.value},true);cfg=await api('/config');f.querySelector('[role="status"]').textContent=t('saved');}catch(e){f.querySelector('[role="status"]').textContent=t(e.message);}};
    dialog.querySelector('.cl-category-form').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await api('/categories','POST',{name:f.elements.name.value,parent_id:Number(f.elements.parent_id.value)||null},true);await admin(); search.elements.category.innerHTML=catOptions();}catch(e){f.querySelector('[role="alert"]').textContent=t(e.message);}};
  }
  async function unread() {
    if(!token()) return;
    const data = await api('/conversations');
    if(destroyed)return;
    $('[data-action="messages"]').textContent=t('messages')+(data.unread ? ` (${data.unread})` : '');
  }
  async function inbox() {
    if(!requireLogin()) return;
    const data=await api('/conversations?offset='+inboxOffset);
    open(`<div class="cl-dialog-head"><h2>${esc(t('messages'))}</h2>${btn('close','close')}</div><div class="cl-inbox">${data.items.length?data.items.map(c=>`<button data-action="conversation" data-id="${c.id}"><strong>${esc(c.peer)} ${c.unread?`<span class="cl-unread">${c.unread}</span>`:''}</strong><span>${esc(c.listing_title)}</span><small>${esc(c.preview||t('start_chat'))}</small></button>`).join(''):`<p>${esc(t('no_messages'))}</p>`}</div><div class="cl-pager">${btn('previous','inbox_previous',inboxOffset?'':'disabled')}${btn('next','inbox_next',inboxOffset+50<data.total?'':'disabled')}</div>`);
    await unread();
  }
  async function chat(cid) {
    const data=await api('/conversations/'+cid+'/messages');
    open(`<div class="cl-dialog-head"><div><small>${esc(t('messages'))}</small><h2>${esc(data.listing_title)}</h2></div>${btn('close','close')}</div>${btn('back_messages','messages')}${btn('older_messages','older_messages',data.more?'':'hidden')}<div class="cl-messages" aria-live="polite"></div><form class="cl-message-form">${field('message','<textarea name="message" required maxlength="4000" rows="3"></textarea>')}<button class="cl-primary">${esc(t('send'))}</button><div role="alert"></div></form>`);
    currentConversation=cid;
    let messageRows=data.items, pendingId=null, pendingText=null;
    const area=dialog.querySelector('.cl-messages');
    const render=()=>{area.innerHTML=messageRows.map(m=>`<div class="cl-bubble ${m.mine?'cl-own':''}"><p>${esc(m.body)}</p><small>${esc(date(m.created_at))}</small></div>`).join('')||`<p>${esc(t('start_chat'))}</p>`;};
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
      else if(action==='browse'||action==='mine') {if(action==='mine'&&!requireLogin())return;mine=action==='mine';offset=0;await load();}
      else if(action==='next'||action==='previous'){offset+=action==='next'?24:-24;await load();}
      else if(action==='messages') {inboxOffset=0;await inbox();}
      else if(action==='inbox_next'||action==='inbox_previous') {inboxOffset+=action==='inbox_next'?50:-50;await inbox();}
      else if(action==='conversation') await chat(id);
      else if(action==='write_seller') {if(requireLogin()){const c=await api('/listings/'+id+'/conversation','POST');await chat(c.id);}}
      else if(action==='detail') await detail(id);
      else if(action==='new'||action==='edit') await editor(id);
      else if(action==='settings') await admin();
      else if(action==='delete') {if(confirm(t('confirm_delete'))){await api('/listings/'+id,'DELETE');await load();}}
      else if(['activate','deactivate','bump'].includes(action)){b.disabled=true;await api('/listings/'+id+'/actions/'+action,'POST');await load();}
      else if(action==='remove_photo'){if(confirm(t('confirm_delete'))){await api('/listings/'+id+'/photos/'+b.dataset.photo,'DELETE');b.parentElement.remove();}}
      else if(action==='delete_category'){if(confirm(t('confirm_delete'))){await api('/categories/'+id,'DELETE',undefined,true);await admin();search.elements.category.innerHTML=catOptions();}}
      else if(action==='edit_category') {
        const c=cfg.categories.find(c=>String(c.id)===id),name=prompt(t('category_name'),c.name);
        if(name!==null){await api('/categories/'+id,'PUT',{name,parent_id:c.parent_id},true);await admin();search.elements.category.innerHTML=catOptions();}
      }
    } catch(e){fail(e);b.disabled=false;}
  },{signal:abort.signal});
  root.addEventListener('keydown',e=>{if(overlay.hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]')];if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},{signal:abort.signal});
  search.onsubmit=e=>{e.preventDefault();offset=0;load().catch(fail);};
  api('/config').then(async data=>{cfg=data;search.elements.category.innerHTML=catOptions();search.elements.currency.innerHTML=currencyOptions('',true);await load();await unread();const lid=new URLSearchParams(location.search).get('listing');if(lid)await detail(lid);}).catch(fail);
  return {destroy(){destroyed=true;clearInterval(poll);abort.abort();for(const p of blobs.values())p.then(URL.revokeObjectURL).catch(()=>{});blobs.clear();root.innerHTML='';}};
}
window.Classifieds={mount};
})();
