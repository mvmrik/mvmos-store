// Racelandia - the pit crew page of the Staff tab.
//
// Each car has its own crew: one person for every position of a pit stop. The page shows how fast the crew
// is, who stands where, what each person is good at, and lets the team hire, train and dismiss them. Every
// number comes from the server (G.crew); the texts and helpers come from the caller.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const seconds = v => (Math.round(v * 100) / 100).toFixed(2) + ' s';

function stopMeter(c, time) {
  // 10 s is a crew that has just started, under 2 s is the best a crew can be
  const pct = clamp((10 - time) / (10 - 1.8), 0.02, 1) * 100;
  return `<div class="ap-meter ap-stop-meter"><i style="width:${pct}%;background:${c.skillCol(100 - (time - 1.8) * 9)}"></i></div>`;
}

function skillBars(c, member, pos) {
  return c.G.crew.skills.map(k => {
    const v = member.skills[k], key = pos.weights[k] >= 0.25;
    return `<div class="ap-skill${key ? ' key' : ''}"><div class="ap-set-h"><label>${c.esc(c.t('ap_k_' + k))}</label><output>${v.toFixed(1)}</output></div>
      <div class="ap-meter"><i style="width:${Math.min(100, v)}%;background:${c.skillCol(v)}"></i></div></div>`;
  }).join('');
}

function memberCard(c, car, pos, member) {
  const game = Object.entries(c.G.crew.trainings).find(([, tr]) => tr.group === pos.group)?.[0];
  const busy = !!c.G.career.active_session;
  const trained = Object.entries(c.G.crew.trainings[game].skills).sort((a,b)=>b[1]-a[1]);
  const stars = '★'.repeat(Math.floor(member.stars)) + (member.stars % 1 >= 0.5 ? '½' : '') + '☆'.repeat(Math.max(0, 5 - Math.ceil(member.stars)));
  return `<div class="ap-card ap-crew-card"><div class="ap-bar"><h3>${c.esc(c.t('ap_pos_' + pos.id))}</h3><span class="ap-crew-tag">${c.esc(c.t('ap_crew_group_' + pos.group))}</span></div>
    <div class="ap-crew-who"><b>${c.esc(member.name)}</b><span class="ap-stars">${stars}</span></div>
    <p class="ap-hint">${c.esc(c.t('ap_age', { n: member.age }))} · ${c.esc(c.t('ap_crew_fit'))} <b>${Math.round(member.level)}%</b> · ${c.esc(c.t('ap_daily_salary'))}: <b>${c.money(member.salary)}</b></p>
    <div class="ap-skills">${skillBars(c, member, pos)}</div>
    <div class="ap-set-h"><span>${c.esc(c.t('ap_driver_energy_label'))}</span><output>${Math.floor(member.energy)}%</output></div><div class="ap-meter ap-energy"><i style="width:${member.energy}%"></i></div>
    <p class="ap-hint">${c.esc(c.t('ap_crew_drill_skills'))}</p><div class="ap-tags ap-crew-trained">${trained.map(([k,w])=>`<span class="${w>=.3 ? 'key' : ''}">${c.esc(c.t('ap_k_'+k))} ×${w}</span>`).join('')}</div><div class="ap-crew-actions"><button class="ap-btn ap-sm" data-crew-train="${c.esc(game)}" data-member="${c.esc(member.id)}" ${member.energy >= c.G.crew.train_energy && !busy && c.G.training_hall?.remaining ? '' : 'disabled'}>${c.esc(c.t('ap_train'))}<small>⚡ ${c.G.crew.train_energy}%</small></button>
      <button class="ap-btn ap-sm ap-ghost" data-crew-dismiss="${c.esc(member.id)}" data-name="${c.esc(member.name)}" ${busy ? 'disabled' : ''}>${c.esc(c.t('ap_crew_dismiss'))}</button></div>
    <div class="ap-hint">${c.esc(c.t('ap_training_level',{n:1+Math.round((member.training_levels?.[game]||0)*9)}))}</div><div class="ap-hint">${c.esc(c.t('ap_trd_' + game))}</div></div>`;
}

function offerCard(c, car, pos, offers) {
  const busy = !!c.G.career.active_session, budget = c.G.driver.budget;
  const rows = offers.map(o => {
    const stars = '★'.repeat(Math.floor(o.stars)) + (o.stars % 1 >= 0.5 ? '½' : '') + '☆'.repeat(Math.max(0, 5 - Math.ceil(o.stars)));
    return `<div class="ap-offer"><div><b>${c.esc(o.name)}</b> <span class="ap-stars">${stars}</span><div class="ap-hint">${c.esc(c.t('ap_age', { n: o.age }))} · ${c.esc(c.t('ap_crew_fit'))} ${Math.round(o.level)}% · ${c.esc(c.t('ap_overall'))} ${o.overall.toFixed(1)}</div>
      <div class="ap-hint">${c.esc(c.t('ap_daily_salary'))}: ${c.money(o.salary)}</div></div>
      <button class="ap-btn ap-sm" data-crew-hire="${c.esc(o.id)}" data-position="${c.esc(pos.id)}" ${!busy && budget >= o.price ? '' : 'disabled'}>${c.esc(c.t('ap_crew_hire'))} · ${c.money(o.price)}</button></div>`;
  }).join('');
  return `<div class="ap-card ap-crew-card empty"><div class="ap-bar"><h3>${c.esc(c.t('ap_pos_' + pos.id))}</h3><span class="ap-crew-tag">${c.esc(c.t('ap_crew_group_' + pos.group))}</span></div>
    <p class="ap-warn">${c.esc(c.t('ap_crew_empty'))}</p>${rows || `<p class="ap-hint">${c.esc(c.t('ap_crew_no_offers'))}</p>`}</div>`;
}

export function paintCrew(host, c) {
  const G = c.G, crew = G.crew, cars = G.team.cars;
  if (!cars.length) {
    host.innerHTML = `${c.heading}${c.nav}${c.hall}<div class="ap-card"><p class="ap-hint">${c.esc(c.t('ap_crew_need_car'))}</p></div>`;
    c.bind(host);
    return;
  }
  let carId = c.getCar();
  if (!cars.some(x => x.id === carId)) { carId = cars[0].id; c.setCar(carId); }
  const car = cars.find(x => x.id === carId), info = crew.cars[carId], times = info.times;
  const pilot = G.team.pilots.find(p => p.id === car.pilot_id);
  const tabs = cars.map(x => {
    const p = G.team.pilots.find(q => q.id === x.pilot_id);
    return `<button class="ap-btn ap-sm${x.id === carId ? '' : ' ap-ghost'}" data-crew-car="${c.esc(x.id)}">${c.esc(c.t('ap_car_number', { n: x.number }))} · ${c.esc(p?.name || c.t('ap_no_assigned_driver'))}</button>`;
  }).join('');
  const rivals = (G.division?.roster || []).map(r => r.pit).filter(v => v != null).sort((a, b) => a - b);
  const median = rivals.length ? rivals[Math.floor(rivals.length / 2)] : null;
  const positions = crew.positions.map(pos => {
    const member = info.members[pos.id];
    return member ? memberCard(c, car, pos, member) : offerCard(c, car, pos, crew.market[pos.id] || []);
  }).join('');
  const staffed = Object.values(info.members).filter(Boolean).length;
  host.innerHTML = `${c.heading}${c.nav}${c.hall}<div class="ap-crewpg">
    <div class="ap-crew-cars">${tabs}</div>
    <div class="ap-card ap-crew-summary"><h2>${c.esc(c.t('ap_crew_speed'))}${pilot ? ' · ' + c.esc(pilot.name) : ''}</h2>
      <p class="ap-hint">${c.esc(c.t('ap_crew_speed_hint'))}</p>
      <div class="ap-stop-times"><div><small>${c.esc(c.t('ap_stop_tyres'))}</small><b>${seconds(times.tyre)}</b>${stopMeter(c, times.tyre)}</div>
        <div><small>${c.esc(c.t('ap_stop_repair'))}</small><b>${seconds(times.repair)}</b>${stopMeter(c, times.repair)}</div>
        <div><small>${c.esc(c.t('ap_stop_both'))}</small><b>${seconds(times.both)}</b>${stopMeter(c, times.both)}</div></div>
      <div class="ap-tags"><span>${c.esc(c.t('ap_crew_staffed', { n: staffed, m: crew.positions.length }))}</span><span>${c.esc(c.t('ap_crew_cost_day'))}: ${c.money(info.daily)}</span>${median != null ? `<span>${c.esc(c.t('ap_crew_rivals', { n: median.toFixed(1) }))}</span>` : ''}</div>
      ${staffed < crew.positions.length ? `<p class="ap-warn">${c.esc(c.t('ap_crew_incomplete'))}</p>` : ''}
      <p class="ap-hint">${c.esc(c.t('ap_crew_market_hint'))}</p></div>
    <div class="ap-crew-grid">${positions}</div></div>`;
  c.bind(host);
  host.querySelectorAll('[data-crew-car]').forEach(b => b.onclick = () => { c.setCar(b.dataset.crewCar); paintCrew(host, c); });
  host.querySelectorAll('[data-crew-train]').forEach(b => b.onclick = () => c.train(b.dataset.crewTrain, b.dataset.member));
  host.querySelectorAll('[data-crew-hire]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await c.act('/crew/hire', { car: carId, position: b.dataset.position, offer: b.dataset.crewHire });
  });
  host.querySelectorAll('[data-crew-dismiss]').forEach(b => b.onclick = async () => {
    if (!await c.confirm(c.t('ap_crew_dismiss_confirm', { name: b.dataset.name }))) return;
    b.disabled = true;
    await c.act('/crew/dismiss', { member: b.dataset.crewDismiss });
  });
}

// ── the specialists of the team: one person for each role, hired from weekly offers, trained in their own game ──
const ROLE_ICON = { doctor: '🩺', coach: '📋', engineer: '🎧', strategist: '♟️', meteorologist: '🌦️', mechanic: '🔩', scout: '🔭', manager: '💼' };
const wxHalf = lv => Math.round(Math.max(0, Math.min(100, 1.2 * (100 - lv))) / 2);

// What the level does, in numbers the player can read ({n} of the role's ap_fx text)
export function specialistEffect(role, lv) {
  const n = { doctor: Math.round(lv / 2), coach: (lv / 100).toFixed(2), engineer: Math.round(30 * lv / 100), strategist: Math.round(40 * Math.max(0, 100 - lv) / 100),
    meteorologist: wxHalf(lv), mechanic: Math.round(lv), scout: Math.round(Math.max(45, lv)), manager: Math.round(lv) }[role];
  return n;
}

function specialistCard(c, role, m, offers) {
  const busy = !!c.G.career.active_session, S = c.G.specialists;
  const title = `<div class="ap-bar"><h3>${ROLE_ICON[role]} ${c.esc(c.t('ap_role_' + role))}</h3><span class="ap-crew-tag">${c.esc(c.t('ap_spec_alone'))}</span></div>`;
  if (!m) {
    const rows = offers.map(o => `<div class="ap-offer"><div><b>${c.esc(o.name)}</b> <span class="ap-stars">${stars(o.stars)}</span>
      <div class="ap-hint">${c.esc(c.t('ap_age', { n: o.age }))} · ${c.esc(c.t('ap_spec_retires', { n: o.retire }))} · ${c.esc(c.t('ap_spec_level'))} ${Math.round(o.level)}</div>
      <div class="ap-hint">${c.esc(c.t('ap_daily_salary'))}: ${c.money(o.salary)}</div></div>
      <button class="ap-btn ap-sm" data-spec-hire="${c.esc(o.id)}" data-role="${c.esc(role)}" ${!busy && c.G.driver.budget >= o.price ? '' : 'disabled'}>${c.esc(c.t('ap_crew_hire'))} · ${c.money(o.price)}</button></div>`).join('');
    return `<div class="ap-card ap-crew-card empty">${title}<p class="ap-hint">${c.esc(c.t('ap_role_' + role + '_does'))}</p><p class="ap-warn">${c.esc(c.t('ap_fx0_' + role))}</p>${rows || `<p class="ap-hint">${c.esc(c.t('ap_crew_no_offers'))}</p>`}</div>`;
  }
  const can = m.energy >= S.train_energy && !busy && c.G.training_hall?.remaining;
  return `<div class="ap-card ap-crew-card">${title}
    <div class="ap-crew-who"><b>${c.esc(m.name)}</b><span class="ap-stars">${stars(m.stars)}</span></div>
    <p class="ap-hint">${c.esc(c.t('ap_role_' + role + '_does'))}</p>
    <p class="ap-hint">${c.esc(c.t('ap_age', { n: m.age }))} · ${c.esc(c.t('ap_spec_retires', { n: m.retire }))} · ${c.esc(c.t('ap_spec_years', { n: Math.floor(m.years) }))} · ${c.esc(c.t('ap_daily_salary'))}: <b>${c.money(m.salary)}</b></p>
    <div class="ap-set-h"><label>${c.esc(c.t('ap_spec_level'))}</label><output>${m.level.toFixed(1)}</output></div><div class="ap-meter"><i style="width:${Math.min(100, m.level)}%;background:${c.skillCol(m.level)}"></i></div>
    <p class="ap-good">${c.esc(c.t('ap_fx_' + role, { n: specialistEffect(role, m.level) }))}</p>
    <div class="ap-set-h"><span>${c.esc(c.t('ap_driver_energy_label'))}</span><output>${Math.floor(m.energy)}%</output></div><div class="ap-meter ap-energy"><i style="width:${m.energy}%"></i></div>
    <div class="ap-crew-actions"><button class="ap-btn ap-sm" data-staff-train="${c.esc(S.games[role])}" data-member="${c.esc(m.id)}" ${can ? '' : 'disabled'}>${c.esc(c.t('ap_train'))}<small>⚡ ${S.train_energy}%</small></button>
      <button class="ap-btn ap-sm ap-ghost" data-spec-dismiss="${c.esc(m.id)}" data-name="${c.esc(m.name)}" ${busy ? 'disabled' : ''}>${c.esc(c.t('ap_crew_dismiss'))}</button></div>
    <div class="ap-hint">${c.esc(c.t('ap_trd_' + S.games[role]))}</div></div>`;
}
const stars = v => '★'.repeat(Math.floor(v)) + (v % 1 >= 0.5 ? '½' : '') + '☆'.repeat(Math.max(0, 5 - Math.ceil(v)));

export function paintSpecialists(host, c) {
  const S = c.G.specialists, retired = (S.retired || []).map(r => `<p class="ap-warn">${c.esc(c.t('ap_spec_retired', { name: r.name, role: c.t('ap_role_' + r.role) }))}</p>`).join('');
  host.innerHTML = `${c.heading}${c.nav}${c.hall}<div class="ap-crewpg">
    <div class="ap-card ap-crew-summary"><h2>${c.esc(c.t('ap_specialists'))}</h2><p class="ap-hint">${c.esc(c.t('ap_specialists_hint'))}</p>
      <div class="ap-tags"><span>${c.esc(c.t('ap_crew_staffed', { n: Object.values(S.members).filter(Boolean).length, m: S.roles.length }))}</span><span>${c.esc(c.t('ap_crew_cost_day'))}: ${c.money(S.daily)}</span></div>${retired}</div>
    <div class="ap-crew-grid">${S.roles.map(r => specialistCard(c, r, S.members[r], S.market[r] || [])).join('')}</div></div>`;
  c.bind(host);
  host.querySelectorAll('[data-staff-train]').forEach(b => b.onclick = () => c.train(b.dataset.staffTrain, b.dataset.member));
  host.querySelectorAll('[data-spec-hire]').forEach(b => b.onclick = async () => { b.disabled = true; await c.act('/specialists/hire', { role: b.dataset.role, offer: b.dataset.specHire }); });
  host.querySelectorAll('[data-spec-dismiss]').forEach(b => b.onclick = async () => {
    if (!await c.confirm(c.t('ap_crew_dismiss_confirm', { name: b.dataset.name }))) return;
    b.disabled = true; await c.act('/specialists/dismiss', { member: b.dataset.specDismiss });
  });
}
