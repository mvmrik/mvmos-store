const { render, on } = window.RacelandiaUI;
// Racelandia - the research team, the production line and the parts in the warehouse.
//
// Only the picture: every number (what a research may find, what a part costs,
// how long it takes) is decided by the server (parts_lab.py). The one thing
// repeated here is the ambition formula, so the sliders can show how risky a
// request is before the team is paid; the server rolls the real outcome.

const PARTS = ['engine', 'gearbox', 'battery', 'brakes', 'suspension', 'floor', 'frontWing', 'rearWing'];
const SEGS = ['perf', 'eff', 'dur', 'mass'];
const GOOD = '#4fd18b', MID = '#f2c230', BAD = '#ff5a5a';

const partArt = name => `<img class="ap-art" src="${cAsset('/apps/racelandia/art/' + name + '.svg')}" alt="" decoding="async">`;
const cAsset = path => (window.asset ? window.asset(path) : path).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

let ui = { open: null, part: 'engine', base: null, push: {}, qty: {} };
let timer = null, skew = 0;
// The chief mechanic's level (null: nobody). Without one the sliders have no zones and nothing says how risky a request is;
// a weaker mechanic draws the zone edges and the chance a little off, a better one closer to the real figures.
let mech = null;
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const zoneErr = () => .3 * Math.max(0, 100 - mech) / 100;
function chanceShown(ch, key) {
  if (mech == null) return '?';
  const half = Math.round(zoneErr() * 50), pct = Math.round(ch * 100);
  if (half < 1) return pct + '%';
  const mid = pct + (hash(key + 'c') - .5) * half * .6, cl = v => Math.max(0, Math.min(100, Math.round(v)));
  return cl(mid - half) + '–' + cl(mid + half) + '%';
}

export function stop() { clearInterval(timer); timer = null; }

const ambition = push => {
  const up = SEGS.reduce((a, s) => a + Math.max(0, push[s] || 0), 0), down = SEGS.reduce((a, s) => a + Math.max(0, -(push[s] || 0)), 0);
  return Math.max(0, up - 0.6 * down);
};
const risk = (push, K) => Math.min(1, Math.max(0, (ambition(push) - K.safe) / (K.limit - K.safe)));
const chance = (push, K) => 1 - 0.75 * Math.pow(risk(push, K), 1.2);
const nowS = () => (Date.now() + skew) / 1000;

export function spanText(sec, t) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return `${d} ${t('ap_unit_d')} ${h} ${t('ap_unit_h')}`;
  if (h) return `${h} ${t('ap_unit_h')} ${m} ${t('ap_unit_min')}`;
  return `${Math.max(1, m)} ${t('ap_unit_min')}`;
}

export const designName = (c, part, d) => `${c.t('ap_part_' + part)}${d.ver > 1 ? ' v' + d.ver : ''}`;
const segName = (c, part, s) => c.t(s === 'perf' || s === 'eff' ? `ap_seg_${part}_${s}` : `ap_seg_${s}`);

function statBars(c, part, stats, before) {
  return SEGS.map(s => {
    const v = stats[s], diff = before ? v - before[s] : 0;
    const col = v >= 50 ? GOOD : BAD;
    return `<div class="ap-stat"><span>${c.esc(segName(c, part, s))}</span><div class="ap-meter"><i style="width:${Math.min(100, v)}%;background:${col}"></i></div><b>${Math.round(v)}${before ? `<small style="color:${diff > 0.05 ? GOOD : diff < -0.05 ? BAD : 'inherit'}">${diff > 0 ? '+' : ''}${diff.toFixed(1)}</small>` : ''}</b></div>`;
  }).join('');
}

function balanceNotes(c, bal) {
  const out = [];
  if (bal.brake > 0.05) out.push(c.t('ap_bal_brake'));
  if (bal.grip > 0.05) out.push(c.t('ap_bal_grip'));
  if (bal.gear > 0.05) out.push(c.t('ap_bal_gear'));
  return out.length ? out.map(x => `<div class="ap-tip ap-tipwarn">⚠️ ${c.esc(x)}</div>`).join('') : `<div class="ap-tip">✅ ${c.esc(c.t('ap_bal_ok'))}</div>`;
}

// ── a part in the warehouse ──
export function partRowHtml(c, u) {
  const wear = u.wear, left = Math.round((1 - wear) * 100);
  return `<div class="ap-part" data-ui-key="part-${c.esc(u.id)}"><div class="ap-part-i">${partArt(u.part)}</div>
      <div class="ap-part-b"><div class="ap-set-h"><label>${c.esc(designName(c, u.part, u))}</label><output style="color:${c.healthCol(wear)}">${left}%</output></div>
        <div class="ap-meter"><i style="width:${left}%;background:${c.healthCol(wear)}"></i></div>
        <div class="ap-stats">${statBars(c, u.part, u.stats)}</div></div>
      <div class="ap-part-a"><button class="ap-btn ap-sm" data-fit="${c.esc(u.id)}" ${c.G.career.active_session ? 'disabled' : ''}>${c.esc(c.t('ap_wh_fit'))}</button>
        <button class="ap-btn ap-sm ap-ghost" data-sellunit="${c.esc(u.id)}" ${c.G.career.active_session ? 'disabled' : ''}>${c.esc(c.t('ap_wh_sell', { price: c.money(u.sale) }))}</button></div></div>`;
}

export function partRowsHtml(c) {
  const w = c.G.warehouse;
  if (!w.parts.length) return `<p class="ap-hint">${c.esc(c.t('ap_wh_parts_empty'))}</p>`;
  return `<div class="ap-equipment">` + w.parts.map(u => partRowHtml(c, u)).join('') + '</div>';
}

export function bindPartRows(host, c) {
  host.querySelectorAll('[data-fit]').forEach(b => on(b, 'click', () => c.act('/warehouse/fit', { unit: b.dataset.fit })));
  host.querySelectorAll('[data-sellunit]').forEach(b => on(b, 'click', async () => { { const u = c.G.warehouse.parts.find(x => x.id === b.dataset.sellunit); if (u && await c.confirm(c.t('ap_wh_sell_confirm', { price: c.money(u.sale) }))) c.act('/warehouse/sell-part', { unit: u.id }); }; }));
}

// ── the sliders: green where there is no risk, red where the team may fail ──
function sliderBackground(push, s, K) {
  if (mech == null) return '#26364a';
  const at = v => { const p = { ...push, [s]: v }; return ambition(p); };
  let safe = 0, hot = 0;
  for (let v = 0; v <= K.push_max; v++) { if (at(v) <= K.safe) safe = v; if (risk({ ...push, [s]: v }, K) < 0.5) hot = v; }
  const err = zoneErr(), span = K.push_max - K.push_min;
  const edge = (v, tag) => Math.max(K.push_min, Math.min(K.push_max, v + (hash(ui.part + s + tag) - .5) * 2 * err * span));
  safe = edge(safe, 'a'); hot = Math.max(safe, edge(hot, 'b'));
  const pos = v => ((v - K.push_min) / (K.push_max - K.push_min) * 100).toFixed(1);
  return `linear-gradient(90deg, ${GOOD} 0, ${GOOD} ${pos(safe)}%, ${MID} ${pos(safe)}%, ${MID} ${pos(hot)}%, ${BAD} ${pos(hot)}%, ${BAD} 100%)`;
}

function researchForm(c, L) {
  const K = L.consts, part = ui.part, info = L.info[part];
  const designs = L.designs[part];
  if (!designs.some(d => d.id === ui.base)) ui.base = designs[designs.length - 1].id;
  const base = designs.find(d => d.id === ui.base);
  const push = ui.push;
  SEGS.forEach(s => { if (push[s] == null) push[s] = 0; });
  const rows = SEGS.map(s => {
    const v = push[s], tgt = base.stats[s] + v;
    return `<div class="ap-set"><div class="ap-set-h"><label>${c.esc(segName(c, part, s))}</label><output data-out="${s}">${Math.round(base.stats[s])} → <b>${Math.round(tgt)}</b></output></div>
      <div class="ap-risk" style="background:${sliderBackground(push, s, K)}"><input type="range" data-push="${s}" min="${K.push_min}" max="${K.push_max}" step="1" value="${v}"></div></div>`;
  }).join('');
  const r = risk(push, K), ch = chance(push, K), any = SEGS.some(s => push[s] > 0);
  const col = r === 0 ? GOOD : r < 0.5 ? MID : BAD;
  const ready = c.G.driver.budget >= info.cost && any;
  return `<h3>${c.esc(c.t('ap_lab_new'))}</h3><p class="ap-hint">${c.esc(c.t('ap_lab_hint'))}</p>
    ${designs.length > 1 ? `<label class="ap-hint">${c.esc(c.t('ap_lab_base'))} <select data-rbase>${designs.map(d => `<option value="${c.esc(d.id)}" ${d.id === ui.base ? 'selected' : ''}>${c.esc(designName(c, part, d))}</option>`).join('')}</select></label>` : ''}
    ${rows}
    <p class="ap-hint">${c.esc(c.t(mech == null ? 'ap_lab_zones_none' : 'ap_lab_zones'))}</p>
    <div class="ap-cost"><span>${c.esc(c.t('ap_lab_chance'))}</span><b data-chance style="color:${mech == null ? 'inherit' : col}">${chanceShown(ch, ui.part)}</b></div>
    <div class="ap-cost"><span>${c.esc(c.t('ap_lab_price'))} · ${c.esc(spanText(info.seconds, c.t))}</span><b class="${c.G.driver.budget >= info.cost ? '' : 'ap-bad'}">${c.money(info.cost)}</b></div>
    <button class="ap-btn ap-go" data-rstart ${ready ? '' : 'disabled'}>${c.esc(c.t('ap_lab_start'))}</button>`;
}

function reportCard(c, L, r) {
  const rep = r.report, part = r.part;
  const net = SEGS.reduce((a, s) => a + (rep.after[s] - rep.before[s]), 0);
  const verdict = net > 6 ? 'ap_lab_v_great' : net > 1.5 ? 'ap_lab_v_good' : net > -1.5 ? 'ap_lab_v_mixed' : 'ap_lab_v_poor';
  const worse = ['brake', 'grip', 'gear'].some(k => rep.balance[k] > rep.balance_now[k] + 0.05);
  return `<div class="ap-research-art">${partArt(part)}</div><h3>📋 ${c.esc(c.t('ap_lab_report'))}: ${c.esc(c.t('ap_part_' + part))}</h3>
    <p class="ap-hint">${c.esc(c.t(verdict))}</p>
    <div class="ap-stats">${statBars(c, part, rep.after, rep.before)}</div>
    <div class="ap-cost"><span>${c.esc(c.t('ap_lab_unit'))} · ${c.esc(spanText(rep.seconds, c.t))}</span><b>${c.money(rep.unit_cost)}</b></div>
    ${worse ? `<div class="ap-tip ap-tipwarn">⚠️ ${c.esc(c.t('ap_lab_balance_worse'))}</div>` : ''}${balanceNotes(c, rep.balance)}
    <p class="ap-hint">${c.esc(c.t('ap_lab_pace', { now: (rep.pace_now * 100).toFixed(1), next: (rep.pace * 100).toFixed(1) }))}</p>
    <div class="ap-bar"><button class="ap-btn ap-go" data-rdecide="accept">${c.esc(c.t('ap_lab_accept'))}</button><button class="ap-btn ap-ghost" data-rdecide="reject">${c.esc(c.t('ap_lab_reject'))}</button></div>`;
}

// the sliders move while they are dragged: only the numbers around them change, never the slider itself
function updateForm(host, c, L) {
  const K = L.consts, base = L.designs[ui.part].find(d => d.id === ui.base), push = ui.push;
  SEGS.forEach(s => {
    render(host.querySelector(`[data-out="${s}"]`), `${Math.round(base.stats[s])} → <b>${Math.round(base.stats[s] + push[s])}</b>`);
    host.querySelector(`[data-push="${s}"]`).parentElement.style.background = sliderBackground(push, s, K);
  });
  const r = risk(push, K), el = host.querySelector('[data-chance]');
  el.textContent = chanceShown(chance(push, K), ui.part);
  el.style.color = mech == null ? 'inherit' : r === 0 ? GOOD : r < 0.5 ? MID : BAD;
  host.querySelector('[data-rstart]').disabled = !(c.G.driver.budget >= L.info[ui.part].cost && SEGS.some(s => push[s] > 0));
}

function researchCard(c, L) {
  const r = L.research;
  if (!r) return researchForm(c, L);
  if (r.status === 'ready') return reportCard(c, L, r);
  const total = r.done_at - r.started, left = r.done_at - nowS(), pct = Math.min(100, Math.max(0, (1 - left / total) * 100));
  return `<div class="ap-research-art">${partArt(r.part)}</div><h3>🔬 ${c.esc(c.t('ap_lab_running', { part: c.t('ap_part_' + r.part) }))}</h3>
    <div class="ap-meter"><i style="width:${pct}%;background:${MID}"></i></div>
    <p class="ap-hint">${c.esc(c.t('ap_lab_left', { time: spanText(left, c.t) }))} · ${c.esc(c.dateStr(r.done_at))}</p>
    <p class="ap-hint">${c.esc(c.t('ap_lab_paid'))}</p>`;
}

function productionCard(c, L, only) {
  const blocks = (only ? [only] : PARTS).map(p => {
    const made = L.designs[p];
    return `<section class="ap-production-group"><h3>${c.esc(c.t('ap_part_' + p))}</h3><div class="ap-equipment">${made.map(d => {
      const qty = ui.qty[d.id] || 1;
      return `<div class="ap-part ap-part-prod"><div class="ap-part-i">${partArt(p)}</div><div class="ap-part-b"><div class="ap-set-h"><label>${c.esc(designName(c, p, d))}${L.fitted[p] === d.id ? ' · ' + c.esc(c.t('ap_lab_fitted')) : ''}</label><output>${c.money(d.cost)} · ${c.esc(spanText(d.seconds, c.t))}</output></div>
        <div class="ap-stats">${statBars(c, p, d.stats)}</div></div>
        <div class="ap-part-a"><select data-qty="${c.esc(d.id)}">${Array.from({ length: L.consts.max_batch }, (_, i) => `<option value="${i + 1}" ${qty === i + 1 ? 'selected' : ''}>×${i + 1}</option>`).join('')}</select>
        <button class="ap-btn ap-sm" data-build="${c.esc(d.id)}" ${c.G.driver.budget >= d.cost * qty && L.queue.length < L.consts.max_queue ? '' : 'disabled'}>${c.esc(c.t('ap_lab_build'))}<small>${c.money(d.cost * qty)}</small></button></div></div>`;
    }).join('')}</div></section>`;
  }).join('');
  const queue = L.queue.filter(o => !only || o.part === only).map(o => {
    const left = o.done_at - nowS(), d = L.designs[o.part].find(x => x.id === o.design);
    return `<div class="ap-queue">${partArt(o.part)}<b>${c.esc(designName(c, o.part, d || { ver: 1 }))} ×${o.qty}</b><span>${c.esc(c.t('ap_lab_ready_n', { n: o.delivered, m: o.qty }))}</span><small>${c.esc(c.t('ap_lab_left', { time: spanText(left, c.t) }))}</small></div>`;
  }).join('');
  return `<div class="ap-card"><h2>🏭 ${c.esc(c.t('ap_lab_production'))}</h2><p class="ap-hint">${c.esc(c.t('ap_lab_production_hint'))}</p>
    ${queue ? `<h3>${c.esc(c.t('ap_lab_queue'))}</h3>${queue}` : ''}<div class="ap-production-grid">${blocks}</div></div>`;
}

function carCard(c, L) {
  const rows = PARTS.map(p => {
    const d = L.designs[p].find(x => x.id === L.fitted[p]) || L.designs[p][0], wear = c.G.driver.parts[p] || 0;
    return `<button type="button" class="ap-part ap-part-prod ap-lab-open" data-open-part="${p}"><div class="ap-part-i">${partArt(p)}</div><div class="ap-part-b"><div class="ap-set-h"><label>${c.esc(designName(c, p, d))}</label><output style="color:${c.healthCol(wear)}">${L.research?.part === p ? (L.research.status === 'ready' ? '🔬✔ ' : '🔬 ') : ''}${L.queue.some(o => o.part === p) ? '🏭 ' : ''}${Math.round((1 - wear) * 100)}% ↗</output></div>
      <div class="ap-stats">${statBars(c, p, d.stats)}</div></div></button>`;
  }).join('');
  return `<div class="ap-card"><h2>🏎️ ${c.esc(c.t('ap_lab_car'))}</h2><p class="ap-hint">${c.esc(c.t('ap_lab_car_hint'))}</p>${balanceNotes(c, L.balance)}
    <p class="ap-hint">${c.esc(c.t('ap_lab_car_pace', { pace: (L.pace * 100).toFixed(1), mass: (L.mass > 0 ? '+' : '') + L.mass.toFixed(1) }))}</p><div class="ap-equipment">${rows}</div></div>`;
}

export function paintLab(host, c) {
  const L = c.G.lab;
  mech = c.G.specialists?.levels?.mechanic ?? null;
  skew = L.now * 1000 - Date.now();
  const head = `<div class="ap-pagehead"><div><span class="ap-eyebrow">${c.esc(c.t('ap_title'))}</span><h1>${c.esc(c.t('ap_lab_title'))}</h1><p>${c.esc(c.t('ap_paddock_lab'))}</p></div>${partArt('factory')}</div>`;
  if (ui.open && !PARTS.includes(ui.open)) ui.open = null;
  if (!ui.open) {
    // the list: only the parts of the car; research and production are inside each part (a marker shows where something is going on)
    render(host, `${head}<div class="ap-garage ap-lab-list"><div class="ap-col">${carCard(c, L)}</div></div>`);
  } else {
    ui.part = ui.open;
    render(host, `${head}<div class="ap-bar"><div><button class="ap-btn ap-sm ap-ghost" data-lab-back>◂ ${c.esc(c.t('ap_back'))}</button> <b class="ap-title2">${c.esc(c.t('ap_part_' + ui.open))}</b></div></div>
      <div class="ap-garage"><div class="ap-col"><div class="ap-card"><h2>🔬 ${c.esc(c.t('ap_lab_title'))}</h2>${researchCard(c, L)}</div></div>
      <div class="ap-lab-production">${productionCard(c, L, ui.open)}</div></div>`);
  }
  host.querySelectorAll('[data-open-part]').forEach(b => on(b, 'click', () => { ui.open = b.dataset.openPart; ui.base = null; ui.push = {}; paintLab(host, c); host.scrollTop = 0; }));
  on(host.querySelector('[data-lab-back]'), 'click', () => { ui.open = null; paintLab(host, c); host.scrollTop = 0; });
  on(host.querySelector('[data-rbase]'), 'change', e => { ui.base = e.target.value; paintLab(host, c); });
  host.querySelectorAll('[data-push]').forEach(i => on(i, 'input', () => { ui.push[i.dataset.push] = +i.value; updateForm(host, c, L); }));
  on(host.querySelector('[data-rstart]'), 'click', e => { e.target.disabled = true; c.act('/lab/research', { part: ui.part, base: ui.base, push: ui.push }).then(ok => { if (ok) ui.push = {}; }); });
  host.querySelectorAll('[data-rdecide]').forEach(b => on(b, 'click', () => { host.querySelectorAll('button').forEach(x => { x.disabled = true; }); c.act('/lab/decide', { action: b.dataset.rdecide }); }));
  host.querySelectorAll('[data-qty]').forEach(s => on(s, 'change', () => { ui.qty[s.dataset.qty] = +s.value; paintLab(host, c); }));
  host.querySelectorAll('[data-build]').forEach(b => on(b, 'click', () => { b.disabled = true; c.act('/lab/build', { design: b.dataset.build, qty: ui.qty[b.dataset.build] || 1 }); }));
  stop();
  const due = [L.research && L.research.status === 'running' ? L.research.done_at : null, ...L.queue.map(o => o.start + o.per_unit * (o.delivered + 1))].filter(Boolean);
  if (due.length) {
    const next = Math.min(...due);
    timer = setInterval(() => {
      if (nowS() >= next) { stop(); c.reload(); } else if (!host.querySelector('input:focus,select:focus')) paintLab(host, c);
    }, 20000);
  }
}
