const { render, on } = window.RacelandiaUI;
// Racelandia - the circuit designer.
//
// The player draws the outline of the own circuit as control points; the server turns them
// into the track, checks it and prices it (POST /track/quote), and a build is only paid for once the
// simulator has driven it. Nothing here decides what is allowed: the page only draws what the server answers.

const TEMPLATES = {
  oval: [[0, 0], [250, 0], [450, 0], [560, 90], [560, 230], [450, 320], [250, 320], [0, 320], [-110, 230], [-110, 90]],
  bean: [[0, 0], [250, 0], [480, 20], [620, 120], [600, 260], [450, 300], [300, 230], [150, 300], [0, 330], [-130, 240], [-110, 90]],
  triangle: [[0, 0], [300, 0], [600, 0], [700, 150], [600, 300], [400, 450], [200, 300], [0, 150]],
};
const SEATS = ['seated', 'free', 'vip'];

export function openBuilder(o) {
  const { host, G, api, t: _t, esc, money, onDone, onCancel } = o;
  const rules = G.track_rules;
  const own = G.own;
  let rebuilding = !own;
  let ctrl = own ? own.ctrl.map(p => p.slice()) : [], width = own ? own.width : rules.widths[1];
  let seats = Object.assign({ seated: 0, free: 0, vip: 0 }, own ? own.seats : {});
  let name = own ? own.name : _t('ap_tb_name_def');
  let place = own ? { lat: own.lat, lon: own.lon, label: '' } : null;
  let quote = null, drive = null, driveTimer = 0, driveSeq = 0, quoteTimer = 0, quoteSeq = 0, building = false, message = '', places = null, zoom = 1, drag = -1, destroyed = false;
  const fmtKm = m => (m / 1000).toFixed(2) + ' km';
  const num = v => Math.max(0, Math.floor(Number(v) || 0));

  const errText = code => _t(({ budget: 'ap_no_budget', busy: 'ap_active_run_hint' })[code] || ('ap_tb_err_' + code)) ;

  render(host, `<div class="ap-garage ap-tb">
    <div class="ap-col"><div class="ap-card"><div class="ap-bar"><h2>${esc(_t('ap_tb_title'))}</h2><button class="ap-btn ap-sm ap-ghost" data-tb="cancel">${esc(_t('ap_tb_cancel'))}</button></div>
      <p class="ap-hint" data-tb="intro"></p>
      <canvas class="ap-tb-canvas" data-tb="canvas"></canvas>
      <div class="ap-tb-tools" data-tb="tools"></div></div></div>
    <div class="ap-col" data-tb="side"></div></div>`);
  const $ = k => host.querySelector(`[data-tb="${k}"]`);
  const canvas = $('canvas'), g = canvas.getContext('2d');

  // the world is metres; the window shows a fixed area around the middle of the drawing
  function frame() {
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 400, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    return { W, H, dpr, s: W / (2600 / zoom), cx: 300, cy: 200 };
  }
  const toScreen = (f, p) => [f.W / 2 + (p[0] - f.cx) * f.s, f.H / 2 - (p[1] - f.cy) * f.s];
  const toWorld = (f, x, y) => [Math.round((x - f.W / 2) / f.s + f.cx), Math.round(-(y - f.H / 2) / f.s + f.cy)];

  function draw() {
    if (destroyed) return;
    const f = frame(); g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    const cs = getComputedStyle(host), fg = cs.getPropertyValue('--fg').trim() || '#ccc', accent = cs.getPropertyValue('--accent').trim() || '#4a8';
    g.clearRect(0, 0, f.W, f.H);
    g.fillStyle = 'rgba(80,140,80,.14)'; g.fillRect(0, 0, f.W, f.H);
    // grid every 100 m, stronger every 500 m
    g.lineWidth = 1;
    const x0 = f.cx - f.W / 2 / f.s, x1 = f.cx + f.W / 2 / f.s, y0 = f.cy - f.H / 2 / f.s, y1 = f.cy + f.H / 2 / f.s;
    for (let x = Math.ceil(x0 / 100) * 100; x <= x1; x += 100) { g.strokeStyle = x % 500 ? 'rgba(128,128,128,.12)' : 'rgba(128,128,128,.3)'; const [sx] = toScreen(f, [x, 0]); g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, f.H); g.stroke(); }
    for (let y = Math.ceil(y0 / 100) * 100; y <= y1; y += 100) { g.strokeStyle = y % 500 ? 'rgba(128,128,128,.12)' : 'rgba(128,128,128,.3)'; const [, sy] = toScreen(f, [0, y]); g.beginPath(); g.moveTo(0, sy); g.lineTo(f.W, sy); g.stroke(); }
    const pts = rebuilding ? (quote && quote.points) : own.points;
    if (pts && pts.length > 2) {
      const road = Math.max(5, (rebuilding ? width : own.width) * f.s);
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = quote && !quote.ok && rebuilding ? 'rgba(220,80,80,.85)' : 'rgba(138,146,160,.95)'; g.lineWidth = road;
      g.beginPath(); pts.forEach((p, i) => { const [x, y] = toScreen(f, p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1, road * 0.08); g.setLineDash([road * 1.2, road * 1.2]);
      g.beginPath(); pts.forEach((p, i) => { const [x, y] = toScreen(f, p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke(); g.setLineDash([]);
    }
    if (rebuilding) {
      g.strokeStyle = fg; g.globalAlpha = .35; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath();
      ctrl.forEach((p, i) => { const [x, y] = toScreen(f, p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (ctrl.length > 2) g.closePath(); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      ctrl.forEach((p, i) => { const [x, y] = toScreen(f, p); g.fillStyle = i === 0 ? '#ffd23f' : accent; g.beginPath(); g.arc(x, y, i === drag ? 9 : 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); });
    }
    if (rebuilding && drive && drive.at) {
      const [x, y] = toScreen(f, drive.at);
      g.strokeStyle = '#ff4d4d'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, Math.max(16, 30 * f.s * 4), 0, 7); g.stroke();
      g.fillStyle = '#ff4d4d'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    }
    // scale bar
    const bar = 500 * f.s; g.fillStyle = fg; g.fillRect(12, f.H - 16, bar, 3); g.font = '11px sans-serif'; g.fillText('500 m', 12, f.H - 22);
  }

  function hit(f, x, y) {
    for (let i = ctrl.length - 1; i >= 0; i--) { const [sx, sy] = toScreen(f, ctrl[i]); if (Math.hypot(sx - x, sy - y) <= 14) return i; }
    return -1;
  }
  function insertAt(p) {
    if (ctrl.length < 3) { ctrl.push(p); return; }
    let best = 1e18, at = ctrl.length;
    for (let i = 0; i < ctrl.length; i++) {
      const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dy * u));
      if (d < best) { best = d; at = i + 1; }
    }
    ctrl.splice(at, 0, p);
  }
  // pointer in the canvas's own CSS pixels: the page may be scaled (zoom, fullscreen), so the box on screen and clientWidth can differ
  const point = e => {
    const r = canvas.getBoundingClientRect(), bx = canvas.clientLeft, by = canvas.clientTop;
    const kx = canvas.clientWidth / Math.max(1, r.width - 2 * bx), ky = canvas.clientHeight / Math.max(1, r.height - 2 * by);
    return [(e.clientX - r.left - bx) * kx, (e.clientY - r.top - by) * ky];
  };
  on(canvas, 'pointerdown', e => {
    if (!rebuilding || building) return;
    const f = frame(), [x, y] = point(e), i = hit(f, x, y);
    if (i >= 0) { drag = i; canvas.setPointerCapture(e.pointerId); }
    else if (ctrl.length < 40) { insertAt(toWorld(f, x, y)); changed(); }
    draw();
  });
  on(canvas, 'pointermove', e => {
    if (drag < 0) return;
    const f = frame(), [x, y] = point(e); ctrl[drag] = toWorld(f, x, y); draw(); changed(true);
  });
  const release = () => { if (drag >= 0) { drag = -1; changed(); } };
  on(canvas, 'pointerup', release); on(canvas, 'pointercancel', release);
  on(canvas, 'dblclick', e => {
    if (!rebuilding || building) return;
    const f = frame(), [x, y] = point(e), i = hit(f, x, y);
    if (i >= 0) { ctrl.splice(i, 1); changed(); draw(); }
  });
  const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  resizeObs && resizeObs.observe(canvas);

  function changed(soft) {
    message = '';
    drive = null; driveSeq++; clearTimeout(driveTimer);
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(askQuote, soft ? 400 : 120);
    if (!soft) paintSide(true);
  }
  async function askQuote() {
    if (!rebuilding) return;
    const seq = ++quoteSeq;
    if (ctrl.length < 4) { quote = { ok: false, error: 'shape', points: [] }; paintSide(true); draw(); return; }
    const r = await api('/track/quote', { ctrl, width, seats });
    if (seq !== quoteSeq || destroyed) return;
    quote = r.ok ? r.d : { ok: false, error: 'shape' };
    drive = quote.ok ? 'checking' : null;
    paintSide(true); draw();
    if (quote.ok) driveTimer = setTimeout(() => verify(seq), 700);
  }
  // the quote only checks the shape; the car itself must also be able to get round: a test drive shows where it cannot
  async function verify(seq) {
    const mine = ++driveSeq;
    const r = await api('/track/verify', { ctrl, width });
    if (destroyed || mine !== driveSeq || seq !== quoteSeq) return;
    drive = r.ok ? r.d : { ok: true };
    paintSide(true); draw();
  }

  function paintTools() {
    render($('tools'), rebuilding
      ? `<span class="ap-hint">${esc(_t('ap_tb_templates'))}:</span> ${Object.keys(TEMPLATES).map(k => `<button class="ap-btn ap-sm ap-ghost" data-tpl="${k}">${esc(_t('ap_tb_tpl_' + k))}</button>`).join(' ')}
         <button class="ap-btn ap-sm ap-ghost" data-tb-undo>⌫</button> <button class="ap-btn ap-sm ap-ghost" data-tb-clear>${esc(_t('ap_tb_clear'))}</button>
         <button class="ap-btn ap-sm ap-ghost" data-zoom="-1">−</button><button class="ap-btn ap-sm ap-ghost" data-zoom="1">+</button>`
      : `<button class="ap-btn ap-sm ap-ghost" data-zoom="-1">−</button><button class="ap-btn ap-sm ap-ghost" data-zoom="1">+</button>`);
    $('intro').textContent = rebuilding ? _t('ap_tb_intro') : '';
    host.querySelectorAll('[data-tpl]').forEach(b => on(b, 'click', () => { ctrl = TEMPLATES[b.dataset.tpl].map(p => p.slice()); changed(); draw(); }));
    on(host.querySelector('[data-tb-undo]'), 'click', () => { ctrl.pop(); changed(); draw(); });
    on(host.querySelector('[data-tb-clear]'), 'click', () => { ctrl = []; quote = null; changed(); draw(); });
    host.querySelectorAll('[data-zoom]').forEach(b => on(b, 'click', () => { zoom = Math.max(.6, Math.min(3, zoom * (b.dataset.zoom === '1' ? 1.25 : .8))); draw(); }));
  }

  const row = (k, v) => `<div><span>${esc(k)}</span><b>${v}</b></div>`;
  const checks = h => ['length', 'width', 'seated', 'vip'].map(k => {
    const text = k === 'length' ? _t('ap_tb_need_length', { n: rules.require.length / 1000 }) : k === 'width' ? _t('ap_tb_need_width', { n: rules.require.width })
      : k === 'seated' ? _t('ap_tb_need_seated', { n: rules.require.seated.toLocaleString() }) : _t('ap_tb_need_vip', { n: rules.require.vip });
    return `<div class="ap-tb-need ${h.need[k] ? 'ok' : ''}">${h.need[k] ? '✓' : '○'} ${esc(text)}</div>`;
  }).join('');

  function paintSide(keepFocus) {
    const side = $('side');
    const focus = keepFocus && document.activeElement && host.contains(document.activeElement) ? document.activeElement.getAttribute('data-keep') : null;
    const info = rebuilding ? quote : { ...own, ok: true, cost: own.cost, seats_cost: own.seats_cost, upkeep: own.upkeep, host: own.host, min_radius: null, demolition: 0 };
    const h = info && info.host;
    const seatIn = SEATS.map(k => `<div><span>${esc(_t('ap_tb_'+k))}</span><b>${(rebuilding?0:(own.seats[k]||0)).toLocaleString()}</b></div>`).join('');
    let extra = 0;
    if (!rebuilding) extra = SEATS.reduce((a, k) => a + Math.max(0, seats[k] - (own.seats[k] || 0)) * rules.seat_cost[k], 0);
    const total = rebuilding ? (quote && quote.total != null ? quote.total : 0) : extra;
    const afford = total <= G.driver.budget;
    const stats = info ? `<div class="ap-cond">
      ${row(_t('ap_tb_length'), fmtKm(info.length || 0))}${row(_t('ap_tb_corners'), info.corners ?? '–')}${info.min_radius != null ? row(_t('ap_tb_radius'), Math.round(info.min_radius) + ' m') : ''}
      ${row(_t('ap_tb_track_cost'), rebuilding ? money(info.cost || 0) : money(own.cost))}
      ${row(_t('ap_tb_stands_cost'), rebuilding ? money(info.seats_cost || 0) : money(extra))}
      ${rebuilding && info.demolition ? row(_t('ap_tb_demolition'), money(info.demolition)) : ''}
      ${row(_t('ap_tb_total'), '<span class="' + (afford ? '' : 'ap-neg') + '">' + money(total) + '</span>')}${row(_t('ap_tb_budget'), money(G.driver.budget))}</div>` : '';
    const msg = building ? `<p class="ap-hint">${esc(_t('ap_tb_working'))}</p>` : message ? `<p class="ap-tb-err">${esc(message)}</p>` : (rebuilding && quote && !quote.ok ? `<p class="ap-tb-err">${esc(errText(quote.error))}</p>` : rebuilding && drive === 'checking' ? `<p class="ap-hint">${esc(_t('ap_tb_checking'))}</p>` : rebuilding && drive && drive.ok === false ? `<p class="ap-tb-err">${esc(_t('ap_tb_err_undrivable_at'))}</p>` : rebuilding && drive && drive.ok ? `<p class="ap-hint">✓ ${esc(_t('ap_tb_drive_ok'))}</p>` : '');
    const placeRow = rebuilding ? `<div class="ap-card"><h3>${esc(_t('ap_tb_place'))}</h3>
      <div class="ap-tb-search"><input type="text" data-keep="q" placeholder="${esc(_t('ap_tb_place_ph'))}" maxlength="60"><button class="ap-btn ap-sm" data-tb-search>${esc(_t('ap_tb_search'))}</button></div>
      ${places ? (places.length ? places.map((p, i) => `<button class="ap-btn ap-sm ap-ghost ap-tb-place" data-pick="${i}">${esc([p.name, p.region, p.country].filter(Boolean).join(', '))}</button>`).join('') : `<p class="ap-hint">${esc(_t('ap_tb_no_results'))}</p>`) : ''}
      ${place ? `<p><b>📍 ${esc(place.label || place.lat.toFixed(2) + ', ' + place.lon.toFixed(2))}</b></p>` : ''}
      <p class="ap-hint">${esc(_t('ap_tb_place_hint'))}</p></div>` : '';
    render(side, `${rebuilding ? `<div class="ap-card"><label class="ap-tb-field"><span>${esc(_t('ap_tb_name'))}</span><input type="text" maxlength="30" value="${esc(name)}" data-keep="name" data-tb-name></label>
        <h3>${esc(_t('ap_tb_width'))}</h3><div class="ap-tb-widths">${rules.widths.map(w => `<button class="ap-btn ap-sm ${w === width ? '' : 'ap-ghost'}" data-width="${w}">${w} m</button>`).join('')}</div>
        <p class="ap-hint">${esc(_t('ap_tb_limits', { min: (rules.min_length / 1000).toFixed(1), max: (rules.max_length / 1000).toFixed(0), r: rules.min_radius }))}</p></div>${placeRow}` : `<div class="ap-card"><h2>${esc(own.name)}</h2><p class="ap-hint">📍 ${own.lat.toFixed(2)}, ${own.lon.toFixed(2)}</p></div>`}
      <div class="ap-card"><h3>${esc(_t('ap_tb_stands'))}</h3><div class="ap-cond">${seatIn}</div><p class="ap-hint">${esc(_t(rebuilding?'ap_venue_after_build':'ap_venue_hint'))}</p></div>
      <div class="ap-card">${stats}${msg}
        ${h ? `<h3>${esc(_t('ap_tb_host_title'))}</h3><p class="ap-hint">${esc(_t('ap_tb_host_hint'))}</p>${checks(h)}<div class="ap-cond">${row(_t('ap_tb_income'), money(h.income.total))}${row(_t('ap_tb_upkeep'), money((info && info.upkeep) || 0))}</div><p class="ap-hint"><b>${esc(_t(h.ok ? 'ap_tb_ready' : 'ap_tb_notyet'))}</b></p>` : ''}
        <div class="ap-tb-actions">${rebuilding
          ? `<button class="ap-btn" data-tb-build ${building || !quote || !quote.ok || drive === 'checking' || (drive && drive.ok === false) || !place || !afford ? 'disabled' : ''}>${esc(_t(own ? 'ap_tb_rebuild' : 'ap_tb_build'))}</button>`
          : `<button class="ap-btn" data-tb-stands ${building ? 'disabled' : ''}>${esc(_t('ap_venue_open'))}</button>
             <button class="ap-btn ap-ghost" data-tb-rebuild ${building ? 'disabled' : ''}>${esc(_t('ap_tb_rebuild'))}</button><p class="ap-hint">${esc(_t('ap_tb_rebuild_hint'))}</p>`}</div></div>`);
    bindSide();
    if (focus) { const el = side.querySelector(`[data-keep="${focus}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) { /* number inputs */ } } }
  }

  function bindSide() {
    const side = $('side');
    on(side.querySelector('[data-tb-name]'), 'input', e => { name = e.target.value; });
    side.querySelectorAll('[data-width]').forEach(b => on(b, 'click', () => { width = +b.dataset.width; changed(); draw(); }));
    on(side.querySelector('[data-tb-search]'), 'click', search);
    on(side.querySelector('input[data-keep="q"]'), 'keydown', e => { if (e.key === 'Enter') search(); });
    side.querySelectorAll('[data-pick]').forEach(b => on(b, 'click', () => {
      const p = places[+b.dataset.pick]; place = { lat: p.lat, lon: p.lon, label: [p.name, p.country].filter(Boolean).join(', ') }; places = null; paintSide();
    }));
    on(side.querySelector('[data-tb-rebuild]'), 'click', () => { rebuilding = true; seats={seated:0,free:0,vip:0}; quote = null; paintTools(); paintSide(); askQuote(); draw(); });
    on(side.querySelector('[data-tb-build]'), 'click', build);
    on(side.querySelector('[data-tb-stands]'), 'click', addStands);
  }

  async function search() {
    const q = host.querySelector('input[data-keep="q"]')?.value.trim() || '';
    if (q.length < 2) return;
    const r = await api('/geocode?q=' + encodeURIComponent(q));
    if (destroyed) return;
    if (!r.ok) { message = _t('ap_tb_err_geocode'); places = null; } else { places = r.d.places || []; message = ''; }
    paintSide();
  }
  async function build() {
    if (building || !quote || !quote.ok || !place) return;
    building = true; paintSide();
    const r = await api('/track/build', { ctrl, width, seats: {}, name: name.trim(), lat: place.lat, lon: place.lon });
    building = false;
    if (destroyed) return;
    if (!r.ok) { message = errText(r.d.error); paintSide(); return; }
    onDone(r.d);
  }
  function addStands() { if(!building)o.onVenueEdit(); }

  on($('cancel'), 'click', () => onCancel());
  paintTools(); paintSide();
  requestAnimationFrame(() => { draw(); if (rebuilding && ctrl.length >= 4) askQuote(); });
  return { destroy() { destroyed = true; clearTimeout(quoteTimer); clearTimeout(driveTimer); resizeObs && resizeObs.disconnect(); } };
}
