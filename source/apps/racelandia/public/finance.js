const { render, on } = window.RacelandiaUI;
// Team finances: the server owns every amount, category, balance and payroll checkpoint.
let regional;
const views = new WeakMap();
async function dateTools(asset) {
  if (!regional) regional=(async()=>{
    if (!window.mvmOS?.dateTimePicker) await new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=asset('/datetime-picker.js');s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
    });
    const picker=window.mvmOS.dateTimePicker;await picker.ready();return picker;
  })().catch(e=>{regional=null;throw e;});
  return regional;
}

export async function paint(host,c) {
  if (views.has(host)) return views.get(host)(c);
  const {t,esc,money}=c;
  let picker;
  try {picker=await dateTools(c.asset);} catch (_) {render(host, `<div class="ap-empty">${esc(t('ap_error'))}</div>`);return;}
  let category='',cursor=null,rows=[],revision=0;
  const date=epoch=>picker.format(picker.fromEpoch(epoch),{type:'datetime'});
  async function load(more=false) {
    const seq=++revision;
    const q=new URLSearchParams();if(category)q.set('category',category);if(more&&cursor)q.set('before',cursor);
    const response=await c.api('/finances?'+q.toString());
    if(seq!==revision||!host.isConnected)return;
    if(!response.ok){render(host, `<div class="ap-empty">${esc(t('ap_error'))}</div>`);return;}
    const f=response.d;c.updateBalance(f.balance);rows=more?rows.concat(f.ledger):f.ledger;cursor=f.next_before;
    const daily=f.daily_drivers+f.daily_staff+f.daily_track+(f.daily_crew||0)+(f.daily_specialists||0);
    const metric=(key,value)=>`<div><span>${esc(t(key))}</span><b>${money(value)}</b></div>`;
    render(host, `${c.heading()}<div class="ap-statspg ap-finance-page">
      <div class="ap-card"><div class="ap-cond ap-cond4">${metric('ap_fin_balance',f.balance)}${metric('ap_fin_income',f.income)}${metric('ap_fin_expenses',f.expenses)}${metric('ap_fin_daily',daily)}</div><p class="ap-hint">${esc(t('ap_finance_tracking',{time:date(f.tracking_since)}))}</p></div>
      <div data-sponsors data-ui-preserve></div>
      <div class="ap-garage"><div class="ap-col"><div class="ap-card"><h2>${esc(t('ap_fin_contracts'))}</h2><p class="ap-hint">${esc(t('ap_fin_payroll_hint'))}</p>
      ${f.pilots.map(p=>`<div class="ap-fin-contract"><span><b>${esc(p.name)}</b><small>${esc(t('ap_overall'))} ${p.overall} · ${esc(t('ap_age',{n:p.age}))}</small></span><b>${money(p.salary)}<small>${esc(t('ap_per_day'))}</small></b></div>`).join('')||`<p class="ap-hint">${esc(t('ap_need_driver'))}</p>`}</div></div>
      <div class="ap-col"><div class="ap-card"><h2>${esc(t('ap_fin_operations'))}</h2><div class="ap-fin-contract"><span><b>${esc(t('ap_fin_staff'))}</b><small>${esc(t('ap_fin_staff_count',{mechanics:f.mechanics,engineers:f.engineers}))}</small></span><b>${money(f.daily_staff)}<small>${esc(t('ap_per_day'))}</small></b></div>
      <div class="ap-fin-contract"><span><b>${esc(t('ap_fin_crew'))}</b></span><b>${money(f.daily_crew||0)}<small>${esc(t('ap_per_day'))}</small></b></div>
      <div class="ap-fin-contract"><span><b>${esc(t('ap_fin_specialists'))}</b></span><b>${money(f.daily_specialists||0)}<small>${esc(t('ap_per_day'))}</small></b></div>
      <div class="ap-fin-contract"><span><b>${esc(t('ap_fin_track'))}</b></span><b>${money(f.daily_track)}<small>${esc(t('ap_per_day'))}</small></b></div></div></div></div>
      <div class="ap-card"><div class="ap-bar"><h2>${esc(t('ap_fin_activity'))}</h2><button class="ap-btn ap-sm ap-ghost" data-fin-refresh>${esc(t('ap_fin_refresh'))}</button></div>
      <label class="ap-fin-filter">${esc(t('ap_fin_category'))}<select data-fin-category><option value="">${esc(t('ap_fin_all'))}</option>${f.categories.map(k=>`<option value="${esc(k)}" ${k===category?'selected':''}>${esc(t('ap_fin_'+k))}</option>`).join('')}</select></label>
      <div class="ap-fin-ledger">${rows.map(r=>`<div class="ap-fin-entry"><span class="ap-fin-symbol ${r.amount<0?'expense':'income'}" aria-hidden="true">${r.amount<0?'↗':'↙'}</span><span><b>${esc(t('ap_fin_'+r.category))}</b><small>${esc(date(r.at))}${r.detail.name?' · '+esc(r.detail.name):''}${r.detail.part?' · '+esc(t('ap_part_'+r.detail.part)):''}${r.detail.compound?' · '+esc(t('ap_c_'+r.detail.compound)):''}${r.detail.qty?' ×'+r.detail.qty:''}${r.detail.number?' · '+esc(t('ap_car_number',{n:r.detail.number})):''}</small></span><span class="ap-fin-amount"><b>${r.amount>0?'+':''}${money(r.amount)}</b><small>${esc(t('ap_fin_balance'))}: ${money(r.balance)}</small></span></div>`).join('')||`<p class="ap-hint">${esc(t('ap_fin_empty'))}</p>`}</div>
      ${cursor?`<button class="ap-btn ap-ghost" data-fin-more>${esc(t('ap_fin_more'))}</button>`:''}</div></div>`);
    const sponsors=await import(c.asset('/apps/racelandia/sponsors.js'));
    if(seq!==revision||!host.isConnected)return;
    sponsors.paint(host.querySelector('[data-sponsors]'),f.sponsors,{...c,date,reload:()=>load()});
    host.querySelector('[data-fin-category]').onchange=e=>{category=e.target.value;load();};
    host.querySelector('[data-fin-refresh]').onclick=()=>load();
    on(host.querySelector('[data-fin-more]'), 'click',e=>{e.currentTarget.disabled=true;load(true);});
  }
  views.set(host, async context => { c = context; await load(); });
  await load();
}
