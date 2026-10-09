(function () {
  if (window.CardboxWidget) return;
  const TYPES = ['loyalty', 'discount', 'voucher', 'ticket', 'business', 'other'];
  const ICONS = {loyalty:'💳', discount:'🏷️', voucher:'🎁', ticket:'🎟️', business:'👤', other:'📌'};
  const FIELDS = ['title','issuer','code','notes','tags','expires_at','person','company','role','phone','email','website','address'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  function mount(root, options = {}) {
    let lang = window.mvmOS?.lang || document.documentElement.lang || 'en';
    let dict = window.CARDBOX_I18N[lang] || window.CARDBOX_I18N[lang.split('-')[0]] || window.CARDBOX_I18N.en;
    const t = k => dict[k] || window.CARDBOX_I18N.en[k] || k;
    const state = {items:[], filter:'all', q:'', active:null, editor:null, images:{}, busy:false};
    const token = () => localStorage.getItem('apphub_token');
    const urls = new Set();
    function clearUrls() { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); }
    function styles() {
      if (document.getElementById('cardbox-css')) return;
      const s = document.createElement('style'); s.id = 'cardbox-css';
      s.textContent = `
      .cb{height:100%;min-height:0;overflow:auto;background:radial-gradient(circle at 85% -5%,#293957 0,transparent 38%),#111723;color:#edf3ff;font:14px/1.45 system-ui,sans-serif;box-sizing:border-box}
      .cb *,.cb-overlay,.cb-overlay *{box-sizing:border-box}.cb button,.cb input,.cb select,.cb textarea,.cb-overlay button,.cb-overlay input,.cb-overlay select,.cb-overlay textarea{font:inherit}.cb button,.cb-overlay button{cursor:pointer}.cb-wrap{max-width:1120px;margin:auto;padding:26px 26px 60px}
      .cb-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}.cb-header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.cb-brand{display:flex;gap:14px;align-items:center}.cb-logo{width:54px;height:54px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#7760e8,#2bb7b1);font-size:27px;box-shadow:0 12px 30px #0004}.cb h1{font-size:25px;margin:0;letter-spacing:-.04em}.cb-sub{color:#aab6cf;margin:3px 0 0}
      .cb-brand{display:none}.cb-header{justify-content:flex-end;margin-bottom:14px}
      .cb-header-actions .cb-icon-action{width:40px;min-width:40px;height:40px;padding:0;font-size:20px;line-height:1}
      .cb-btn{border:1px solid #45506b;background:#28344b;color:#fff;border-radius:11px;padding:10px 15px;min-height:40px}.cb-btn:hover{background:#36445f}.cb-primary{background:#7361df;border-color:#9385f3;font-weight:650}.cb-primary:hover{background:#8675f1}.cb-danger{color:#ffb1b1;border-color:#8a474b;background:#38242d}
      .cb-tools{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.cb-search{flex:1;min-width:210px;border:1px solid #3b4760;background:#1a2435;border-radius:11px;color:#fff;padding:11px 14px;outline:none}.cb-search:focus,.cb-field:focus{border-color:#9e91ff}.cb-pills{display:flex;gap:7px;overflow:auto;padding-bottom:9px;margin-bottom:13px}.cb-pill{white-space:nowrap;border:1px solid #354056;background:#1b2638;color:#becae0;border-radius:20px;padding:7px 13px}.cb-pill.active{color:#fff;background:#5b4ebe;border-color:#9584f4}
      .cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(225px,1fr));gap:14px}.cb-card{position:relative;min-height:150px;border:1px solid #3b4960;border-radius:16px;background:linear-gradient(150deg,#26344d,#1a2537);color:#fff;padding:14px;overflow:hidden;box-shadow:0 12px 28px #070b1640;display:flex;flex-direction:column;align-items:stretch}.cb-card.favorite{border-left:4px solid #f4c95d;padding-left:11px}.cb-card:hover{border-color:#9384ef;transform:translateY(-2px)}.cb-card.favorite:hover{border-left-color:#f4c95d}.cb-card:after{content:'';position:absolute;width:125px;height:125px;border:1px solid #ffffff0d;border-radius:50%;right:-40px;top:-35px;pointer-events:none}.cb-card-main{display:flex;flex:1;flex-direction:column;align-items:flex-start;min-width:0;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left}.cb-card-top{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px}.cb-card-icon{font-size:24px;line-height:1}.cb-card-expiry{min-width:0;max-width:78%;padding:3px 8px;border:1px solid #536782;border-radius:99px;background:#31415b;color:#dce7fa;font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}.cb-card-expiry.soon{border-color:#a08043;background:#534026;color:#ffe1a0}.cb-card-expiry.expired{border-color:#9c5555;background:#572f39;color:#ffd0d0}.cb-card-title{font-size:17px;font-weight:700;line-height:1.25;margin:9px 0 2px}.cb-card-meta{color:#aebcd5;max-width:100%;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cb-code-preview{align-self:flex-end;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;max-width:100%;height:44px;margin-top:6px;padding:3px;border:0;border-radius:4px;background:#fff;color:#18243a}.cb-code-preview.qr{width:44px}.cb-code-preview.barcode{width:140px;height:38px}.cb-code-preview.plain{height:auto;max-width:100%;padding:2px 0;background:none;color:#cbd8f1;font:12px/1.2 ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cb-code-preview svg{display:block;width:100%;height:100%;max-height:100%}.cb-code-preview:hover{outline:2px solid #b7aaff;outline-offset:2px}
      .cb-empty{border:1px dashed #4b5670;border-radius:19px;text-align:center;padding:55px 20px;color:#aebbd3}.cb-empty strong{display:block;color:#fff;font-size:20px;margin:10px}.cb-empty-icon{font-size:44px}
      .cb-overlay{position:fixed;inset:0;background:#060b14c9;z-index:100001;display:flex;align-items:center;justify-content:center;padding:14px;color:#f2f6ff;font:14px/1.45 system-ui,sans-serif}.cb-panel{width:min(760px,100%);max-height:min(90vh,900px);overflow:auto;background:#1a2435;border:1px solid #526079;box-shadow:0 25px 80px #0009;border-radius:21px;padding:24px;color:#f2f6ff}.cb-panel h2{font-size:23px;margin:0 0 4px}.cb-panel-top{display:flex;justify-content:space-between;gap:15px;align-items:start;margin-bottom:20px}.cb-close{border:0;background:#ffffff16;border-radius:9px;color:#fff;font-size:20px;width:34px;height:34px}.cb-actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.cb-section{border-top:1px solid #3b4760;padding-top:17px;margin-top:18px}.cb-section h3{margin:0 0 12px;font-size:15px;color:#c8d6f1}.cb-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px;row-gap:18px}.cb-form label{display:block;min-width:0;color:#c6d3ea;font-size:12px;font-weight:650}.cb-field{display:block;width:100%;margin-top:7px;border:1px solid #44516a;border-radius:10px;background:#101a2a;color:#fff;padding:10px 12px;outline:none;min-height:44px}.cb-form input.cb-field,.cb-form select.cb-field{height:44px}.cb-form .wide{grid-column:1/-1}.cb-form textarea{min-height:90px;resize:vertical}.cb-form select{appearance:auto}.cb-typepick{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px}.cb-typepick button{border:1px solid #46536d;background:#26334a;color:#dce5fa;border-radius:11px;padding:10px 13px}.cb-typepick button.active{border-color:#ad9fff;background:#5547a3;color:white}.cb-photos{display:flex;gap:12px;flex-wrap:wrap}.cb-photo{width:195px;max-width:100%;border:1px solid #3f4e67;border-radius:11px;background:#111b2a;padding:9px}.cb-photo img{width:100%;height:118px;object-fit:contain;border-radius:8px;background:#0b1320}.cb-photo-name{font-size:12px;color:#a9b9d4;margin-bottom:6px}.cb-photo-buttons{display:flex;gap:5px;margin-top:7px}.cb-photo-buttons .cb-btn{font-size:11px;padding:6px;min-height:0}.cb-code{background:#fff;color:#131313;border-radius:17px;padding:25px;text-align:center;overflow:auto;margin:16px 0}.cb-code svg{max-width:100%;height:auto}.cb-code-value{font-size:18px;letter-spacing:.06em;overflow-wrap:anywhere;margin-top:10px}.cb-row{display:flex;gap:8px;margin:7px 0;color:#c3d0e8}.cb-row strong{min-width:92px;color:#fff}.cb-note{white-space:pre-wrap;overflow-wrap:anywhere;color:#d2ddf2}.cb-tip{color:#a9b9d4;font-size:12px;margin:3px 0 14px}.cb-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:100003;background:#35305d;border:1px solid #9788ed;border-radius:10px;padding:10px 16px;color:white;box-shadow:0 10px 30px #0008}
      @media(max-width:600px){.cb-wrap{padding:17px 14px 45px}.cb-header{align-items:center}.cb-header-actions .cb-btn{padding:8px 10px}.cb h1{font-size:22px}.cb-sub{font-size:12px}.cb-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cb-card{min-height:145px;padding:11px}.cb-card.favorite{padding-left:8px}.cb-card-title{font-size:15px}.cb-card-meta{font-size:11px}.cb-panel{padding:16px;max-height:95vh}.cb-form{grid-template-columns:1fr}.cb-form .wide{grid-column:auto}.cb-photos{flex-direction:column}.cb-photo{width:100%}}
      `; document.head.appendChild(s);
    }
    function toast(msg) { const el=document.createElement('div');el.className='cb-toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3000); }
    async function api(path, method='GET', body, raw=false) {
      const headers={'X-Pub-Token':token() || ''}; if (body && !(body instanceof FormData)) headers['Content-Type']='application/json';
      const r=await fetch('/pub/cardbox'+path,{method,headers,body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined});
      if (r.status===401) { options.onNeedLogin?.(); throw Error(t('login')); }
      if (!r.ok) { let x={}; try{x=await r.json()}catch{} throw Error(x.error || t('failed')); }
      return raw ? r.blob() : r.json();
    }
    async function refresh() {
      const kind = TYPES.includes(state.filter) ? '&kind=' + encodeURIComponent(state.filter) : '';
      try { state.items=await api('/items?archived='+String(state.filter==='archived')+kind); render(); }
      catch(e) { toast(e.message); }
    }
    const fmt = date => {if(!date)return ''; try{return new Date(date+'T12:00:00').toLocaleDateString(lang)}catch{return date}};
    function expiry(item) {if(!item.expires_at)return '';const days=Math.floor((new Date(item.expires_at+'T23:59:59')-new Date())/86400000);return days<0?t('expired'):days<30?t('expiring')+' · '+fmt(item.expires_at):fmt(item.expires_at)}
    function expiryDays(date) {
      const [year, month, day] = date.split('-').map(Number);
      const now = new Date();
      return Math.round((Date.UTC(year, month-1, day)-Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))/86400000);
    }
    function expiryBadge(item) {
      if (!item.expires_at) return '';
      const days = expiryDays(item.expires_at);
      const label = days < 0 ? t('expired') : days === 0
        ? new Intl.RelativeTimeFormat(lang, {numeric:'auto'}).format(0, 'day')
        : t('remainingDays').replace('{days}', new Intl.NumberFormat(lang, {style:'unit', unit:'day', unitDisplay:'long'}).format(days));
      return `<span class="cb-card-expiry ${days<0?'expired':days<=7?'soon':''}" title="${esc(t('expiry'))}: ${esc(fmt(item.expires_at))}">${esc(label)}</span>`;
    }
    function visible() {const q=state.q.toLocaleLowerCase();return state.items.filter(x=>(state.filter==='all'||state.filter==='archived'||state.filter==='favorites'&&x.favorite||x.kind===state.filter)&&(!q||['title','issuer','code','person','company','tags','notes'].some(k=>String(x[k]||'').toLocaleLowerCase().includes(q))))}
    function miniCode(item) {
      if (!item.code) return '';
      let visual = '';
      try {
        if (item.code_format === 'qr') {
          const qr = qrcode(0, 'M');
          qr.addData(item.code);
          qr.make();
          visual = qr.createSvgTag(2, 0);
        } else if (item.code_format === 'code128') {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          JsBarcode(svg, item.code, {format:'CODE128', displayValue:false, width:1, height:40, margin:0});
          visual = svg.outerHTML;
        }
      } catch { visual = ''; }
      const preview = visual ? item.code_format : 'plain';
      return `<button type="button" class="cb-code-preview ${preview==='qr'?'qr':preview==='code128'?'barcode':'plain'}" data-code-id="${esc(item.id)}" aria-label="${esc(t('viewCode'))}" title="${esc(t('viewCode'))}">${visual || esc(item.code)}</button>`;
    }
    function render() {
      const cards=visible();
      root.innerHTML=`<div class="cb"><div class="cb-wrap">
        <div class="cb-header"><div class="cb-brand"><div class="cb-logo">🎟️</div><div><h1>${esc(t('title'))}</h1><p class="cb-sub">${esc(t('subtitle'))}</p></div></div>
          <div class="cb-header-actions"><button class="cb-btn cb-icon-action" data-settings type="button" title="${esc(t('settings'))}" aria-label="${esc(t('settings'))}">⚙</button><button class="cb-btn cb-primary cb-icon-action" data-add="other" type="button" title="${esc(t('add'))}" aria-label="${esc(t('add'))}">+</button></div></div>
        <div class="cb-tools"><input class="cb-search" type="search" placeholder="${esc(t('search'))}" value="${esc(state.q)}"></div>
        <div class="cb-pills">${['all',...TYPES,'favorites','archived'].map(k=>`<button class="cb-pill ${state.filter===k?'active':''}" data-filter="${k}">${ICONS[k]|| (k==='favorites'?'★':'')} ${esc(t(k))}</button>`).join('')}</div>
        ${cards.length?`<div class="cb-grid">${cards.map(x=>`<article class="cb-card ${x.favorite?'favorite':''}">
          <button class="cb-card-main" data-id="${esc(x.id)}"><span class="cb-card-top"><span class="cb-card-icon" title="${esc(t(x.kind))}">${ICONS[x.kind]}</span>${expiryBadge(x)}</span><span class="cb-card-title">${esc(x.title)}</span><span class="cb-card-meta">${esc(x.kind==='business'?(x.company||x.person):(x.issuer||x.code))}</span></button>
          ${miniCode(x)}
        </article>`).join('')}</div>`:`<div class="cb-empty"><div class="cb-empty-icon">🎟️</div><strong>${esc(state.items.length?t('noResults'):t('empty'))}</strong><div>${esc(state.items.length?'':t('emptyHint'))}</div>${!state.items.length?`<button class="cb-btn cb-primary" style="margin-top:19px" data-add="other">＋ ${esc(t('add'))}</button>`:''}</div>`}
      </div></div>`;
      root.querySelector('.cb-search').oninput=e=>{state.q=e.target.value;const pos=e.target.selectionStart;render();const inp=root.querySelector('.cb-search');inp.focus();inp.setSelectionRange(pos,pos)};
      root.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;refresh()});
      root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>editor(null,b.dataset.add));
      root.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>detail(b.dataset.id));
      root.querySelector('[data-settings]').onclick=settings;
      root.querySelectorAll('[data-code-id]').forEach(b=>b.onclick=()=>{
        const item=state.items.find(x=>x.id===b.dataset.codeId);
        if(item) showCode(item);
      });
    }
    async function recordUse(item) {
      try { await api('/items/'+item.id+'/use','POST'); await refresh(); }
      catch(e) { toast(e.message); }
    }
    function sortOptions(selected, category=false) {
      const options=[...(category?[['inherit','inherit']]:[]),['favorites_recent','sortDefault'],['recent_used','sortRecentUse'],['most_used','sortMostUsed'],['expires_soon','sortExpiry']];
      return options.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${esc(t(label))}</option>`).join('');
    }
    async function settings() {
      let saved;
      try { saved=await api('/settings/sort'); } catch(e) { toast(e.message); return; }
      const el=overlay(`<div class="cb-panel-top"><h2>⚙ ${esc(t('settings'))}</h2><button class="cb-close" data-close aria-label="${esc(t('cancel'))}">×</button></div>
        <div class="cb-section"><h3>${esc(t('generalSort'))}</h3><select class="cb-field" data-sort="all">${sortOptions(saved.general)}</select><p class="cb-tip" style="margin-top:10px">${esc(t('usageHint'))}</p></div>
        <div class="cb-section"><h3>${esc(t('categorySort'))}</h3><div class="cb-form">${TYPES.map(kind=>`<label>${ICONS[kind]} ${esc(t(kind))}<select class="cb-field" data-sort="${kind}">${sortOptions(saved.categories[kind]||'inherit',true)}</select></label>`).join('')}</div></div>
        <div class="cb-actions"><button class="cb-btn" data-close>${esc(t('cancel'))}</button></div>`);
      el.querySelectorAll('[data-sort]').forEach(select=>select.onchange=async()=>{
        const before=saved;
        select.disabled=true;
        try { saved=await api('/settings/sort','PUT',{category:select.dataset.sort,sort:select.value}); await refresh(); }
        catch(e) { select.value=select.dataset.sort==='all'?before.general:(before.categories[select.dataset.sort]||'inherit'); toast(e.message); }
        finally { select.disabled=false; }
      });
    }
    function overlay(html) {const old=document.querySelector('.cb-overlay');if(old)old.remove();const el=document.createElement('div');el.className='cb-overlay';el.innerHTML=`<div class="cb-panel" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(el);el.addEventListener('click',e=>{if(e.target===el||e.target.closest('[data-close]'))close()});return el;}
    function close(){clearUrls();document.querySelector('.cb-overlay')?.remove();state.active=null;state.editor=null;}
    async function photo(item,side,node) {if(!item.images?.[side]||!node)return;try{const blob=await api(`/items/${item.id}/images/${side}`,'GET',null,true);if(!node.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);node.src=url}catch{}}
    function photoTiles(item,editMode=false){return `<div class="cb-photos">${['front','back'].map(side=>`<div class="cb-photo"><div class="cb-photo-name">${esc(t(side))}</div>${item?.images?.[side]?`<img data-photo="${side}" alt="${esc(t(side))}">`:`<div style="height:118px;display:grid;place-items:center;color:#7486a5;font-size:30px">▧</div>`}${editMode?`<div class="cb-photo-buttons"><label class="cb-btn" style="cursor:pointer">${esc(item?.images?.[side]?t('replace'):t('upload'))}<input hidden type="file" accept="image/png,image/jpeg,image/webp" data-upload="${side}"></label>${item?.images?.[side]?`<button type="button" class="cb-btn" data-remove-photo="${side}">${esc(t('remove'))}</button>`:''}</div>`:''}</div>`).join('')}</div>`}
    function loadPhotos(el,item){for(const side of ['front','back'])photo(item,side,el.querySelector(`[data-photo="${side}"]`))}
    function vcard(item){const safe=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const lines=['BEGIN:VCARD','VERSION:3.0','FN:'+safe(item.person||item.title),'ORG:'+safe(item.company),'TITLE:'+safe(item.role),'TEL:'+safe(item.phone),'EMAIL:'+safe(item.email),'URL:'+safe(item.website),'ADR:;;;;'+safe(item.address)+';;','END:VCARD'];const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/vcard'}));a.download=(item.person||item.title).replace(/[^\w-]+/g,'-')+'.vcf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
    async function detail(id){clearUrls();let item;try{item=await api('/items/'+id)}catch(e){toast(e.message);return}state.active=item;
      const el=overlay(`<div class="cb-panel-top"><div><h2>${ICONS[item.kind]} ${esc(item.title)}</h2><div class="cb-sub">${esc(t(item.kind))}${item.issuer?' · '+esc(item.issuer):''}</div></div><button class="cb-close" data-close aria-label="${esc(t('cancel'))}">×</button></div>${photoTiles(item)}${item.code?`<div class="cb-actions"><button class="cb-btn cb-primary" data-show-code>${esc(t('viewCode'))}</button><button class="cb-btn" data-copy>${esc(t('copy'))}</button></div>`:''}${item.expires_at?`<div class="cb-row"><strong>${esc(t('expiry'))}</strong><span>${esc(expiry(item))}</span></div>`:''}${item.tags?`<div class="cb-row"><strong>${esc(t('tags'))}</strong><span>${esc(item.tags)}</span></div>`:''}${item.kind==='business'&&[item.person,item.company,item.role,item.phone,item.email,item.website,item.address].some(Boolean)?`<div class="cb-section"><h3>${esc(t('contact'))}</h3>${['person','company','role','phone','email','website','address'].filter(k=>item[k]).map(k=>`<div class="cb-row"><strong>${esc(t(k))}</strong><span>${esc(item[k])}</span></div>`).join('')}<div class="cb-actions">${item.phone?`<a class="cb-btn" href="tel:${encodeURIComponent(item.phone)}">${esc(t('call'))}</a>`:''}${item.email?`<a class="cb-btn" href="mailto:${encodeURIComponent(item.email)}">${esc(t('write'))}</a>`:''}${item.website?`<a class="cb-btn" href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${esc(t('visit'))}</a>`:''}<button class="cb-btn" data-vcard>${esc(t('download'))}</button></div></div>`:''}${item.notes?`<div class="cb-section"><h3>${esc(t('notes'))}</h3><div class="cb-note">${esc(item.notes)}</div></div>`:''}<div class="cb-section cb-actions"><button class="cb-btn cb-primary" data-edit>${esc(t('edit'))}</button><button class="cb-btn" data-favorite>${esc(t(item.favorite?'unfavorite':'favorite'))}</button><button class="cb-btn" data-archive>${esc(t(item.archived?'restore':'archive'))}</button><button class="cb-btn cb-danger" data-delete>${esc(t('delete'))}</button></div>`);
      loadPhotos(el,item);
      recordUse(item);
      el.querySelector('[data-edit]').onclick=()=>editor(item);
      el.querySelector('[data-favorite]').onclick=async()=>{await act(()=>api('/items/'+id,'PUT',{data:{favorite:!item.favorite}}));close();refresh()};
      el.querySelector('[data-archive]').onclick=async()=>{await act(()=>api('/items/'+id,'PUT',{data:{archived:!item.archived}}));close();refresh()};
      el.querySelector('[data-delete]').onclick=async()=>{if(!confirm(t('deleteConfirm')))return;await act(()=>api('/items/'+id,'DELETE'));close();refresh()};
      el.querySelector('[data-vcard]')?.addEventListener('click',()=>vcard(item));
      el.querySelector('[data-copy]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(item.code);toast(t('copied'))}catch{toast(t('failed'))}});
      el.querySelector('[data-show-code]')?.addEventListener('click',()=>showCode(item,false));
    }
    async function act(fn){try{return await fn()}catch(e){toast(e.message);throw e}}
    function showCode(item,countUse=true){if(!item.code){toast(t('codeMissing'));return}if(countUse)recordUse(item);let visual='';try{if(item.code_format==='qr'){const q=qrcode(0,'M');q.addData(item.code);q.make();visual=q.createSvgTag(5,4)}else if(item.code_format==='code128'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');JsBarcode(svg,item.code,{format:'CODE128',displayValue:false,width:2,height:110,margin:5});visual=svg.outerHTML}}catch{visual=''}
      const el=overlay(`<div class="cb-panel-top"><h2>${esc(item.title)}</h2><button class="cb-close" data-close>×</button></div><div class="cb-code">${visual}<div class="cb-code-value">${esc(item.code)}</div></div><div class="cb-actions"><button class="cb-btn" data-copy>${esc(t('copy'))}</button><button class="cb-btn" data-close>${esc(t('cancel'))}</button></div>`);
      el.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(item.code);toast(t('copied'))}catch{toast(t('failed'))}};
    }
    function field(key,value='',type='text',wide=false){return `<label class="${wide?'wide':''}">${esc(t(key==='expires_at'?'expiry':key))}<input class="cb-field" name="${key}" type="${type}" value="${esc(value)}" maxlength="512"></label>`}
    function editor(item,kind='other') {clearUrls();state.editor=item;let picked=item?.kind||kind;
      const el=overlay(`<div class="cb-panel-top"><div><h2>${esc(item?t('edit'):t('newItem'))}</h2><div class="cb-sub">${esc(t('quickAdd'))}</div></div><button class="cb-close" data-close>×</button></div><div class="cb-typepick">${TYPES.map(k=>`<button type="button" data-kind="${k}" class="${picked===k?'active':''}">${ICONS[k]} ${esc(t(k))}</button>`).join('')}</div><form class="cb-form" id="cb-form">${field('title',item?.title||'')}${field('issuer',item?.issuer||'')}${field('code',item?.code||'')}<label>${esc(t('format'))}<select class="cb-field" name="code_format">${[['none','plain'],['qr','qr'],['code128','barcode']].map(([k,label])=>`<option value="${k}" ${item?.code_format===k?'selected':''}>${esc(t(label))}</option>`).join('')}</select></label>${field('expires_at',item?.expires_at||'','date')}${field('tags',item?.tags||'')}<label class="wide">${esc(t('notes'))}<textarea class="cb-field" name="notes" maxlength="4000">${esc(item?.notes||'')}</textarea></label><div class="wide" id="cb-contact"><div class="cb-section"><h3>${esc(t('contact'))}</h3><p class="cb-tip">${esc(t('imageOnly'))}</p><div class="cb-form">${['person','company','role','phone','email','website','address'].map(k=>field(k,item?.[k]||'')).join('')}</div></div></div><div class="wide cb-section"><h3>${esc(t('front'))} / ${esc(t('back'))}</h3><div class="cb-tip">${esc(t('imageOnly'))}</div>${photoTiles(item,true)}</div><div class="wide cb-actions"><button class="cb-btn cb-primary" type="submit">${esc(t('save'))}</button><button class="cb-btn" type="button" data-close>${esc(t('cancel'))}</button></div></form>`);
      const form=el.querySelector('#cb-form');const contact=el.querySelector('#cb-contact');const pending={};
      function showContact(){contact.style.display=picked==='business'?'block':'none'}showContact();
      el.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{picked=b.dataset.kind;el.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));showContact()});
      loadPhotos(el,item||{});
      el.querySelectorAll('[data-upload]').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;if(f.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type)){toast(t('invalidImage'));return}pending[inp.dataset.upload]=f;const tile=inp.closest('.cb-photo');const old=tile.querySelector('img');const url=URL.createObjectURL(f);urls.add(url);if(old)old.src=url;else tile.querySelector('div[style]')?.replaceWith(Object.assign(document.createElement('img'),{src:url}));if('BarcodeDetector' in window){try{const detector=new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8','upc_a','upc_e']});const found=await detector.detect(await createImageBitmap(f));if(found.length&&!form.elements.code.value){form.elements.code.value=found[0].rawValue;form.elements.code_format.value=found[0].format==='qr_code'?'qr':'code128';toast(t('scan'))}}catch{}}});
      el.querySelectorAll('[data-remove-photo]').forEach(b=>b.onclick=async()=>{if(!item)return;try{item=await api(`/items/${item.id}/images/${b.dataset.removePhoto}`,'DELETE');editor(item)}catch(e){toast(e.message)}});
      form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;state.busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;const data={kind:picked};for(const key of FIELDS)data[key]=form.elements[key]?.value||'';data.code_format=form.elements.code_format.value;
        if (!data.title.trim()) data.title = (picked==='business' ? (data.person||data.company) : data.issuer) || t(picked);
        try{let saved=item?await api('/items/'+item.id,'PUT',{data}):await api('/items','POST',{data});item=saved;for(const [side,file] of Object.entries(pending)){const fd=new FormData();fd.append('image',file);saved=await api(`/items/${saved.id}/images/${side}`,'POST',fd);delete pending[side]}close();await refresh();detail(saved.id)}catch(err){toast(err.message)}finally{state.busy=false;button.disabled=false}};
    }
    styles();refresh();
    const observer=new MutationObserver(()=>{if(!document.body.contains(root)){close();observer.disconnect()}});observer.observe(document.body,{childList:true,subtree:true});
    return {destroy(){close();observer.disconnect()}};
  }
  window.CardboxWidget={mount};
})();
