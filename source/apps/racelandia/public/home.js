const { render, on } = window.RacelandiaUI;
// Racelandia - the home dashboard: what the team's people would tell the owner today.
//
// Only advice: every number comes from the state the server already sent (the staff, their levels, the
// warehouse, the lab, the pilots); nothing is decided or stored here. A piece of advice is spoken by the
// specialist who knows the subject, so it appears only when that person is hired, and is shown with their level.

const HIRE_ORDER = ['strategist', 'mechanic', 'engineer', 'coach', 'doctor', 'manager', 'meteorologist', 'scout'];
const ROLE_ICON = { doctor: '🩺', coach: '📋', engineer: '🎧', strategist: '♟️', meteorologist: '🌦️', mechanic: '🔩', scout: '🔭', manager: '💼' };
const WEAR_LIMIT = .98, NEAR_WORN = .7, PART_WORN = .5, TIRED = 40, RUNWAY_DAYS = 7;

const minutes = (sec, c) => {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d} ${c.t('ap_unit_d')} ${h} ${c.t('ap_unit_h')}` : h ? `${h} ${c.t('ap_unit_h')} ${m} ${c.t('ap_unit_min')}` : `${Math.max(1, m)} ${c.t('ap_unit_min')}`;
};
const avgWear = u => u.wear.reduce((a, b) => a + b, 0) / u.wear.length;

// What a level does, in the numbers of the ap_fx_<role> texts (the same formulas as the staff screen)
const wxHalf = lv => Math.round(Math.max(0, Math.min(100, 1.2 * (100 - lv))) / 2);
const effect = (role, lv) => ({ doctor: Math.round(lv / 2), coach: (lv / 100).toFixed(2), engineer: Math.round(30 * lv / 100), strategist: Math.round(40 * Math.max(0, 100 - lv) / 100),
  meteorologist: wxHalf(lv), mechanic: Math.round(lv), scout: Math.round(Math.max(45, lv)), manager: Math.round(lv) }[role]);

// One report for each person of the team and one for the team itself. A report is the list of what that person
// has to say: { sev: 2 needs attention / 1 can be improved / 0 in order, icon, text, act: { label, run } }
function reports(c) {
  const { G, t } = c, S = G.specialists || {}, M = S.members || {}, team = G.team, d = G.driver;
  const carName = car => c.carName(car);
  const go = (label, run) => ({ label, run });
  const to = (label, screen) => go(label, () => c.go(screen));
  const staff = (label, tab) => go(label, () => c.openStaff(tab));
  const items = {}, say = (who, sev, icon, text, act) => (items[who] = items[who] || []).push({ sev, icon, text, act });

  const daily = (S.daily || 0) + Object.values(G.crew?.cars || {}).reduce((a, x) => a + (x.daily || 0), 0) + team.pilots.reduce((a, p) => a + (p.salary || 0), 0);
  const income = G.career?.sponsor_base || 0;

  // ── the manager: the sponsors (the money itself is on the finance screen) ──
  const sponsors = to('ap_finances', 'finance');
  if (!(income > 0)) say('manager', 1, '🤝', t('ap_hm_sponsor_none'), sponsors);
  else say('manager', income >= daily ? 0 : 1, '🤝', t('ap_hm_sponsor_ok', { income: c.money(income), costs: c.money(daily) }), sponsors);

  // ── the strategist: the tyres ──
  const live = (G.warehouse?.tyres || []).filter(u => Math.max(...u.wear) < WEAR_LIMIT), cars = team.cars.length;
  const nearly = live.filter(u => Math.max(...u.wear) >= NEAR_WORN).length;
  const warehouse = to('ap_tab_warehouse', 'warehouse');
  if (live.length < cars) say('strategist', 2, '🛞', t('ap_hm_tyres_few', { n: live.length, m: cars }), warehouse);
  else {
    const rec = M.strategist ? c.recCompound() : null;
    say('strategist', 0, '🛞', rec ? t('ap_hm_tyres_ok_rec', { n: live.length, m: cars, compound: t('ap_c_' + rec) }) : t('ap_hm_tyres_ok', { n: live.length, m: cars }), warehouse);
  }
  if (live.length) {
    const sets = {}; live.forEach(u => { sets[u.compound] = (sets[u.compound] || 0) + 1; });
    const worst = Math.max(...live.map(u => Math.max(...u.wear)));
    say('strategist', 0, '🛞', t('ap_hm_tyres_sets', { list: Object.entries(sets).map(([k, n]) => `${t('ap_c_' + k)} ${n}`).join(', '), pct: Math.round(worst * 100) }), warehouse);
  }
  if (nearly) say('strategist', 1, '🛞', t('ap_hm_tyres_worn', { n: nearly }), warehouse);

  // ── the chief mechanic: the laboratory and the worn parts ──
  const L = G.lab || {}, lab = to('ap_tab_lab', 'lab');
  if (L.research?.status === 'ready') say('mechanic', 2, '🔬', t('ap_hm_lab_ready'), lab);
  else if (L.research) say('mechanic', 0, '🔬', t('ap_hm_lab_running', { part: t('ap_part_' + L.research.part), time: minutes(L.research.done_at - L.now, c) }), lab);
  else say('mechanic', 1, '🔬', t('ap_hm_lab_idle'), lab);
  team.cars.forEach(car => {
    const worn = Object.entries(car.parts || {}).filter(([, w]) => w >= PART_WORN).sort((a, b) => b[1] - a[1]);
    if (worn.length) say('mechanic', worn[0][1] >= NEAR_WORN ? 2 : 1, '🔧', t('ap_hm_parts_worn', { car: carName(car), list: worn.map(([k, w]) => `${t('ap_part_' + k)} ${Math.round((1 - w) * 100)}%`).join(', ') }), to('ap_tab_garage', 'garage'));
    else {
      const top = Object.entries(car.parts || {}).sort((a, b) => b[1] - a[1])[0];
      if (top) say('mechanic', 0, '🔧', t('ap_hm_parts_ok', { car: carName(car), part: t('ap_part_' + top[0]), pct: Math.round((1 - top[1]) * 100) }), to('ap_tab_garage', 'garage'));
    }
  });
  team.cars.forEach(car => {
    const crew = G.crew?.cars?.[car.id]; if (!crew) return;
    const slots = Object.entries(crew.members), empty = slots.filter(([, m]) => !m).length;
    if (empty) say('mechanic', 1, '🛠️', t('ap_hm_crew_empty', { car: carName(car), n: empty, m: slots.length }), staff('ap_pit_crew', 'crew'));
    else {
      const weak = slots.slice().sort((a, b) => a[1].level - b[1].level)[0];
      if (weak) say('mechanic', 0, '🛠️', t('ap_hm_crew_train', { car: carName(car), name: weak[1].name, pos: t('ap_pos_' + weak[0]), level: Math.round(weak[1].level) }), staff('ap_pit_crew', 'crew'));
    }
  });


  // ── the driver coach: the weakest skill of the pilot ──
  if (M.coach && d.has_driver) {
    const hall = c.hall(), skills = G.skills.map(k => [k, d.skills[k]]).sort((a, b) => a[1] - b[1]);
    const [weak, value] = skills[0], game = G.games.find(g => (c.gameSkills[g] || []).includes(weak));
    const pilots = staff('ap_pilots', 'pilots');
    if (d.energy < TIRED) say('coach', 1, '🎓', t('ap_hm_coach_rest', { name: d.name, e: Math.floor(d.energy) }), pilots);
    else if (!hall.remaining) say('coach', 0, '🎓', t('ap_hm_coach_wait'), pilots);
    else if (game) say('coach', 1, '🎓', t('ap_hm_coach_train', { name: d.name, skill: t('ap_k_' + weak), v: value.toFixed(1), game: t('ap_tr_' + game), n: hall.remaining }), pilots);
  }

  // ── the race engineer: where a test run would teach the team the most ──
  if (M.engineer && c.pilotOk) {
    const usable = G.tracks.filter(x => x.usable);
    const fresh = usable.filter(x => !(x.bests?.runs)).sort((a, b) => (a.own ? -1 : 0) - (b.own ? -1 : 0))[0];
    const gap = usable.filter(x => x.bests?.best != null && x.bests?.record != null).map(x => [x, x.bests.best - x.bests.record]).sort((a, b) => b[1] - a[1])[0];
    say('engineer', 0, '📐', t('ap_hm_test_count', { n: usable.filter(x => x.bests?.runs).length, m: usable.length }), to('ap_tab_team', 'team'));
    if (fresh) say('engineer', 1, '📐', t('ap_hm_test_new', { track: c.trackName(fresh.id) }), go('ap_open', () => c.openTrack(fresh.id)));
    else if (gap && gap[1] > .05) say('engineer', 1, '📐', t('ap_hm_test_gap', { track: c.trackName(gap[0].id), gap: gap[1].toFixed(1) }), go('ap_open', () => c.openTrack(gap[0].id)));
    else say('engineer', 0, '📐', t('ap_hm_test_ok'), to('ap_tab_team', 'team'));
  }

  // ── the team doctor: tired people ──
  const tired = team.pilots.filter(p => p.energy < TIRED && p.id !== d.pilot_id);
  tired.forEach(p => say('doctor', 1, '🩺', t('ap_hm_energy_low', { name: p.name, e: Math.floor(p.energy) }), staff('ap_pilots', 'pilots')));
  const lows = [[d.name, d.energy], ...team.pilots.map(p => [p.name, p.energy])].sort((a, b) => a[1] - b[1])[0];
  if (lows) say('doctor', 0, '🩺', t('ap_hm_energy_min', { name: lows[0], e: Math.floor(lows[1]) }), staff('ap_pilots', 'pilots'));
  if (!tired.length) say('doctor', 0, '🩺', t('ap_hm_energy_ok'), staff('ap_pilots', 'pilots'));

  // ── the meteorologist and the scout: what their level lets the team see ──
  if (M.meteorologist) {
    const half = wxHalf(M.meteorologist.level);
    if (half < 30) say('meteorologist', 0, '🌦️', t('ap_hm_wx_short_on'), staff('ap_specialists', 'specialists'));
    else say('meteorologist', 1, '🌦️', t('ap_hm_wx_short_off'), staff('ap_specialists', 'specialists'));
  }
  if (M.scout) say('scout', 0, '🔭', t('ap_hm_scout_market', { n: (G.career?.offers || []).length }), staff('ap_pilots', 'pilots'));

  // ── the pilots: who drives what, how rested they are, where the active pilot is strong and weak ──
  const pilots = staff('ap_pilots', 'pilots');
  team.cars.forEach(car => { if (!car.pilot_id) say('pilots', 2, '🏎️', t('ap_hm_pilot_nocar', { car: carName(car) }), to('ap_tab_garage', 'garage')); });
  team.pilots.forEach(p => {
    const car = team.cars.find(x => x.pilot_id === p.id);
    say('pilots', 0, '🧑‍✈️', car ? t('ap_hm_pilot_car', { name: p.name, car: carName(car), overall: p.overall, e: Math.floor(p.energy) }) : t('ap_hm_pilot_reserve', { name: p.name, overall: p.overall, e: Math.floor(p.energy) }), pilots);
  });
  if (d.has_driver && G.skills?.length) {
    const sk = G.skills.map(k => [k, d.skills[k]]).sort((a, b) => a[1] - b[1]), weak = sk[0], best = sk[sk.length - 1];
    say('pilots', 0, '📊', t('ap_hm_pilot_skills', { name: d.name, best: t('ap_k_' + best[0]), bv: best[1].toFixed(1), weak: t('ap_k_' + weak[0]), wv: weak[1].toFixed(1) }), pilots);
  }
  if (!M.coach) say('pilots', 1, '🎓', t('ap_hm_pilot_nocoach'), staff('ap_specialists', 'specialists'));

  // ── every specialist: their own training ──
  const need = S.train_energy || 30;
  Object.values(M).filter(Boolean).forEach(m => {
    if (m.energy >= need && m.headroom > .5) say(m.role, 1, '🎯', t('ap_hm_spec_train', { name: m.name, role: t('ap_role_' + m.role), level: Math.round(m.level), n: Math.round(m.headroom) }), staff('ap_specialists', 'specialists'));
  });

  const out = [{ role: 'pilots', items: items.pilots || [] }];
  HIRE_ORDER.forEach(role => out.push({ role, items: items[role] || [], member: M[role] || null }));
  return out;
}

const worst = r => r.items.reduce((a, i) => Math.max(a, i.sev), 0);
const voice = (c, r) => r.role === 'pilots' ? c.t('ap_pilots') : `${c.t('ap_role_' + r.role)} · ${r.member.name} · ${c.t('ap_spec_level')} ${Math.round(r.member.level)}`;

export function paintHome(host, c) {
  const { t, esc } = c, all = reports(c);
  const acts = [];
  const hired = all.filter(r => r.role === 'pilots' || r.member).sort((a, b) => worst(b) - worst(a));
  const missing = all.filter(r => r.role !== 'pilots' && !r.member);
  const line = it => { acts.push(it.act.run); return `<li class="sev${it.sev}"><span aria-hidden="true">${it.icon}</span><p>${esc(it.text)}</p><button class="ap-btn ap-sm ap-ghost" data-hm="${acts.length - 1}">${esc(t(it.act.label))} ▸</button></li>`; };
  const cards = hired.map(r => {
    const sev = r.items.length ? worst(r) : 0, icon = r.role === 'pilots' ? '🧑‍✈️' : ROLE_ICON[r.role];
    return `<div class="ap-hm-card sev${sev}"><div class="ap-hm-i" aria-hidden="true">${icon}</div><div class="ap-hm-b"><div class="ap-hm-head"><small>${esc(voice(c, r))}</small><span class="ap-hm-v">${esc(t('ap_hm_v' + sev))}</span></div>
      ${r.member ? `<p class="ap-hint">${esc(t('ap_fx_' + r.role, { n: effect(r.role, r.member.level) }))}</p>` : ''}
      <ul class="ap-hm-list">${r.items.length ? r.items.map(line).join('') : `<li class="sev0"><span aria-hidden="true">✅</span><p>${esc(t('ap_hm_nothing'))}</p></li>`}</ul></div></div>`;
  }).join('');
  const none = missing.map(r => `<div class="ap-hm-card none"><div class="ap-hm-i" aria-hidden="true">${ROLE_ICON[r.role]}</div><div class="ap-hm-b"><div class="ap-hm-head"><small>${esc(t('ap_role_' + r.role))}</small></div>
      <p>${esc(t('ap_hm_spec_hire', { role: t('ap_role_' + r.role), does: t('ap_role_' + r.role + '_does') }))}</p>
      <button class="ap-btn ap-sm ap-ghost" data-hm="${acts.push(() => c.openStaff('specialists')) - 1}">${esc(t('ap_specialists'))} ▸</button></div></div>`).join('');
  render(host, `${c.heading}<div class="ap-garage ap-garage-one"><div class="ap-col">
    <div class="ap-hm-grid">${cards}${none}</div></div></div>`);
  host.querySelectorAll('[data-hm]').forEach(b => on(b, 'click', () => acts[+b.dataset.hm]()));
}
