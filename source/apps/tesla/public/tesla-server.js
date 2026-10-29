// Desktop-only server settings. No personal Tesla secret is sent to this view.
window.TeslaServerSettings = async function(container) {
  const hub = typeof AppHub !== 'undefined' ? AppHub : window.AppHub;
  const t = key => window.t ? window.t(key) : key;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const api = async (method, body) => {
    const r = await fetch('/api/apps/tesla/server', {method, headers:{'Content-Type':'application/json','X-Pub-Token':hub?.getToken?.() || localStorage.getItem('apphub_token') || ''}, ...(body?{body:JSON.stringify(body)}:{})});
    const data = await r.json(); if(!r.ok) throw Error(data.error || 'server_required'); return data;
  };
  let state;
  try {state=await api('GET');} catch(e) {container.textContent=t('tsl_setup_server_required');return;}
  const profile = await hub?.getUser?.().catch(()=>null);
  container.innerHTML=`<form style="margin-top:16px;min-width:0"><h3>${esc(t('tsl_setup_server_title'))}</h3><p style="line-height:1.6">${esc(t('tsl_setup_server_hint'))}</p><p>${esc(t('tsl_setup_dependency_hint'))}</p>${profile?`<p>${esc(profile.display_name || profile.username || '')}</p>`:''}<label>${esc(t('tsl_setup_public_origin'))}<input name="origin" type="url" required value="${esc(state.origin || (location.protocol==='https:'?location.origin:''))}" placeholder="https://tesla.example.com" style="display:block;box-sizing:border-box;width:100%;margin:8px 0;padding:10px;background:var(--surface2,#252d45);color:inherit;border:1px solid var(--border,#ffffff30);border-radius:8px"></label><button class="tsl-btn" type="submit" style="padding:10px;cursor:pointer;background:var(--surface2,#252d45);color:inherit;border:1px solid var(--border,#ffffff30);border-radius:8px;font:inherit">${esc(t('tsl_setup_server_save'))}</button><p role="status" aria-live="polite"></p>${state.key_url?`<p style="overflow-wrap:anywhere"><code>${esc(state.key_url)}</code></p>`:''}</form>`;
  const form=container.querySelector('form'), result=form.querySelector('[role=status]'), button=form.querySelector('button');
  form.addEventListener('submit', async e=>{
    e.preventDefault();button.disabled=true;
    try {await api('PUT',{origin:form.elements.origin.value});result.textContent=t('tsl_setup_server_saved');}
    catch(e) {const key='tsl_setup_'+e.message;result.textContent=t(key)===key?t('tsl_error'):t(key);}
    finally {button.disabled=false;}
  });
};
