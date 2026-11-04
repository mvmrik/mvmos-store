// Per-car paint editor. Draft colors remain local until Save; copying never links two cars.
export function openLiveryEditor({host, car, other, M, t, esc, api, onSaved, onCancel}) {
  let colors = {...car.livery}, dead = false, saving = false, preview = null;
  const defaults = M.VIEW.LIVERY_DEFAULTS;
  host.innerHTML = `<div class="ap-garage ap-livery-editor"><div class="ap-col"><div class="ap-card">
    <div class="ap-bar"><h2>${esc(t('ap_livery_title'))} · ${esc(t('ap_car_number',{n:car.number}))}</h2></div>
    <div class="ap-car-preview ap-livery-preview" aria-label="${esc(t('ap_livery_title'))}"></div>
    <p class="ap-hint">${esc(t('ap_livery_rotate'))}</p></div></div>
    <div class="ap-col"><div class="ap-card"><h2>${esc(t('ap_livery_colors'))}</h2><p class="ap-hint">${esc(t('ap_livery_hint'))}</p>
    <div class="ap-livery-colors">${Object.keys(defaults).map(part=>`<label class="ap-livery-color"><span>${esc(t('ap_livery_'+part))}</span><input type="color" data-paint="${part}" value="${colors[part]||defaults[part]}"><output data-hex="${part}">${(colors[part]||defaults[part]).toUpperCase()}</output></label>`).join('')}</div>
    <div class="ap-livery-tools">${other?`<button class="ap-btn ap-ghost" data-paint-copy>${esc(t('ap_livery_copy',{n:other.number}))}</button>`:''}<button class="ap-btn ap-ghost" data-paint-reset>${esc(t('ap_livery_reset'))}</button></div>
    <p class="ap-hint ap-livery-message" role="status" aria-live="polite"></p>
    <div class="ap-livery-actions"><button class="ap-btn" data-paint-save>${esc(t('ap_livery_save'))}</button><button class="ap-btn ap-ghost" data-paint-cancel>${esc(t('ap_cancel'))}</button></div></div></div></div>`;
  const message = host.querySelector('.ap-livery-message');
  const refresh = () => {
    host.querySelectorAll('[data-paint]').forEach(input=>{
      input.value=colors[input.dataset.paint]||defaults[input.dataset.paint];
      host.querySelector(`[data-hex="${input.dataset.paint}"]`).textContent=input.value.toUpperCase();
    });
    preview?.setLivery(colors);
  };
  try {
    preview=M.VIEW.createGarageView(M.THREE,host.querySelector('.ap-livery-preview'),{low:matchMedia('(pointer:coarse)').matches,livery:colors});
  } catch (e) { message.textContent=t('ap_no_webgl'); console.warn('Racelandia paint preview unavailable',e); }
  host.querySelectorAll('[data-paint]').forEach(input=>input.addEventListener('input',()=>{
    if (saving) return;
    colors[input.dataset.paint]=input.value;refresh();message.textContent='';
  }));
  host.querySelector('[data-paint-copy]')?.addEventListener('click',()=>{colors={...other.livery};refresh();message.textContent=t('ap_livery_copied',{n:other.number});});
  host.querySelector('[data-paint-reset]').addEventListener('click',()=>{colors={};refresh();message.textContent=t('ap_livery_reset_hint');});
  host.querySelector('[data-paint-cancel]').addEventListener('click',()=>{if(!saving)onCancel();});
  host.querySelector('[data-paint-save]').addEventListener('click',async()=>{
    if (saving) return;
    saving=true;message.textContent=t('ap_livery_saving');
    host.querySelectorAll('button,input').forEach(e=>e.disabled=true);
    try {
      const r=await api('/car/livery',{car:car.id,colors});
      if (r.ok) {onSaved(r.d);return;}
      if(!dead)message.textContent=t(r.d.error==='busy'?'ap_active_run_hint':'ap_livery_error');
    } catch (_) {if(!dead)message.textContent=t('ap_livery_error');}
    finally {saving=false;if(!dead)host.querySelectorAll('button,input').forEach(e=>e.disabled=false);}
  });
  return {destroy(){dead=true;preview?.destroy();}};
}
