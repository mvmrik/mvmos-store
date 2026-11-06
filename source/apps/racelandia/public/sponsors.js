const { render, on } = window.RacelandiaUI;
// Sponsorship amounts and eligibility always come from the authenticated server.
export function paint(host,s,c) {
  const {t,esc,money,date}=c;
  const metric=(key,value)=>`<div><span>${esc(t(key))}</span><b>${value}</b></div>`;
  const daily=value=>`${money(value)} ${esc(t('ap_per_day'))}`;
  render(host, `<div class="ap-card"><h2>${esc(t('ap_sponsors'))}</h2><p class="ap-hint">${esc(t('ap_sp_rules'))}</p>
    <div class="ap-cond ap-cond4">${metric('ap_sp_daily',daily(s.daily))}${metric('ap_fin_daily',daily(s.expenses))}${metric('ap_sp_net',daily(s.net))}${metric('ap_sp_reserve',s.runway_days===null?esc(t('ap_sp_covered')):esc(t('ap_sp_days',{n:s.runway_days})))}</div>
    <p class="ap-hint">${esc(t('ap_sp_progress',{slots:s.reputation.slots,races:s.reputation.races,points:s.reputation.points,podiums:s.reputation.podiums}))}</p><p class="ap-hint">${esc(t('ap_sp_unlock'))}</p>${s.manager?`<p class="ap-good">${esc(t('ap_sp_manager',{n:s.manager}))}</p>`:''}
    <div class="ap-sp-grid">${s.active.map(p=>`<article class="ap-sp-contract"><h3>${esc(p.name)}</h3><b>${daily(p.daily)}</b><p>${esc(t('ap_sp_goal_'+p.goal))}: +${money(p.bonus)}</p><p class="ap-hint">${esc(t('ap_sp_expires',{date:date(p.expires)}))}</p></article>`).join('')||`<p class="ap-hint">${esc(t('ap_sp_none'))}</p>`}</div>
    <h3>${esc(t('ap_sp_offers'))}</h3><p class="ap-hint">${esc(t('ap_sp_refresh',{date:date(s.refresh_at)}))}</p>
    <div class="ap-sp-grid">${s.offers.map(p=>{
      const net=s.daily+p.daily-s.expenses;
      const runway=net<0?t('ap_sp_days',{n:Math.round(Math.max(0,s.balance+p.advance)/-net*10)/10}):t('ap_sp_covered');
      return `<article class="ap-sp-contract"><small>${esc(t('ap_sp_slot_'+p.slot))} · ${esc(t('ap_sp_variant_'+p.variant))}</small><h3>${esc(p.name)}</h3><b>${daily(p.daily)}</b><p>${esc(t('ap_sp_advance'))}: ${money(p.advance)}</p><p>${esc(t('ap_sp_goal_'+p.goal))}: +${money(p.bonus)}</p><p class="ap-hint">${esc(t('ap_sp_forecast',{net:daily(net),reserve:runway}))}</p><button class="ap-btn" data-sign="${esc(p.id)}">${esc(t('ap_sp_sign'))}</button></article>`;
    }).join('')||`<p class="ap-hint">${esc(t('ap_sp_full'))}</p>`}</div><p data-sp-error class="ap-hint" role="status"></p></div>`);
  host.querySelectorAll('[data-sign]').forEach(b=>b.onclick=async()=>{
    host.querySelectorAll('[data-sign]').forEach(x=>x.disabled=true);
    try {
      const r=await c.api('/sponsors/sign',{offer:b.dataset.sign});
      if(r.ok){await c.reload();return;}
      host.querySelector('[data-sp-error]').textContent=t('ap_sp_error');
    } catch (_) {if(host.isConnected)host.querySelector('[data-sp-error]').textContent=t('ap_sp_error');}
    if(host.isConnected)host.querySelectorAll('[data-sign]').forEach(x=>x.disabled=false);
  });
}
