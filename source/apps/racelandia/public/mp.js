/*
 * Racelandia - the client half of the game.
 *
 * Runs on Game Hub's generic play page. The player never drives: they look
 * after the car (its parts and its setup for each circuit), train their young
 * driver in seven small simulators, and send the car out to practise or to
 * race. The lap is simulated here in the browser (sim.js), a little ahead of
 * the replay so that a pit call made while the car is on the track still
 * changes what happens; the server (mp_game.py, apex_data.py) owns the
 * driver's skills, the budget, the parts, the weather and the scoring, and
 * tells this file what to simulate. The run is shown in 3D (view3d.js); other
 * players in the room appear on the track as ghosts.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'racelandia';
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const asset = p => (window.asset ? window.asset(p) : p);
  const token = () => (window.GameHub.getToken && window.GameHub.getToken()) || '';

  let render, on;
  const uiReady = import(asset('/apps/' + GAME_ID + '/ui.js')).then(ui => { render = ui.render; on = ui.on; });

  // ── state ──
  let root = null, G = null, cfg = { laps: 3, hour: 12 }, multi = false, board = [];
  let staffTab = 'pilots', crewCar = null, weekendSet2 = null;
  // The cars of a weekend session run together: each has its own simulation, setup, tyres and pit; one of them is watched.
  let cars = [], carIdx = 0;
  const scrollMemo = {};
  const screenCache = new Map();
  let stateRevision = 0;
  let appNode = null, lastFocus = null;
  let setupFrom = 'team', statsCar = null, setupPage = 'cars', editFrom = null, editEntry = false, marketOpen = false, screen = 'home', gview = 'cars', teamView = 'overview', pview = 'list', curTrack = 'own', setups = {}, compound = 'M', weekendSet = null;
  let markedCars = null, carSets = {};   // the cars ticked for a practice (null: only the open one) and the warehouse tyre set of each
  let resumeBusy=false,resumeTimer=null,resumeError='',deferredGo=null;
  let garageView = null, garageRevision = 0, divisionPlayback=null, divisionTimer=null, hallTimer=null, hallRefreshing=false;
  let venueView = null, venueRevision = 0;
  const closeVenueView = () => { venueRevision++; venueView?.destroy(); venueView = null; };
  const closeGarageView = () => { garageRevision++; if (garageView) { garageView.destroy(); garageView = null; } };
  const send = m => mp.send(m);
  let mods = null, builder = null, tracksCat = null, builtTracks = {}, view = null, run = null, runGroup = null, track = null, summary = null, pending = null, busy = false;
  let pb = { t: 0, speed: 1, playing: false, sent: false, skip: false, msg: null };
  let radio = null, radioMsgs = [], radioId = 0;
  let trainingStarting = false, lastGains = null, over = null, sndOn = true, snd = null, posAcc = 0, hudAcc = 0, myCol = 0, saveTimer = 0;
  let history = [], histTrack = '', sec = null, secColors = {}, pitModal = false, tyreWait = false;
  const peers = {};
  let fitN = 0;
  const LEAD = 6;                                    // seconds the simulation runs ahead of the replay

  const isMine = id => id === 'player' || id === 'player2';
  const ICON = { S: '#e5322d', M: '#f2c230', H: '#f1f1f1', I: '#2fae4a', W: '#2f7ee8' };
  const GROUPS = ['aero', 'chassis', 'tyres', 'drive'];
  const PIT_SET = ['frontWing', 'rearWing', 'arbF', 'arbR', 'brakeBias', 'diff', 'engine'];
  const GAMEICON = { reaction: '🚦', reflexes: '🎯', pace: '🧺', braking: '🛑', cornering: '🛣️', traction: '🦶', consistency: '⏲️', focus: '🎚️', composure: '🛞', tyreCare: '🌡️', wet: '🌧️', fitness: '💪', feedback: '🎛️', crew_wheel: '🔧', crew_jack: '🏗️', crew_repair: '🛠️', crew_release: '🚦', staff_doctor: '🩺', staff_coach: '📋', staff_engineer: '🎧', staff_strategist: '♟️', staff_meteorologist: '🌦️', staff_mechanic: '🔩', staff_scout: '🔭', staff_manager: '💼' };
  // One training game for each skill, named after it.
  const GAMESKILLS = Object.fromEntries(['reaction', 'reflexes', 'pace', 'braking', 'cornering', 'traction', 'consistency', 'focus', 'composure', 'tyreCare', 'wet', 'fitness', 'feedback'].map(k => [k, [k]]));
  const trainVal = (game, v) => {
    const r = G.training_refs?.[game];
    if (v == null || !r) return '—';
    if (r.unit === 'ms') return Math.round(v) + ' ms';
    if (r.unit === 'm') return v.toFixed(1) + ' m';
    if (r.unit === 's') return v.toFixed(2) + ' s';
    if (r.unit === '/s') return v.toFixed(1) + ' ' + _t('ap_tg_taps_s');
    return (v * 100).toFixed(1) + '%';
  };
  const trainingKeys = new Set();
  const activationKey = e => e.code === 'Space' || e.code === 'Enter';
  window.addEventListener('keydown', e => { if (activationKey(e)) trainingKeys.add(e.code); }, true);
  window.addEventListener('keyup', e => trainingKeys.delete(e.code), true);
  window.addEventListener('blur', () => trainingKeys.clear());
  // Menu illustrations are local vector assets; they never enter the race renderer.
  const menuArt = name => `<img class="ap-art" src="${esc(asset('/apps/' + GAME_ID + '/art/' + name + '.svg'))}" alt="" decoding="async">`;
  const pageHeading = (title, hint, art) => `<div class="ap-pagehead"><div><span class="ap-eyebrow">${esc(_t('ap_title'))}</span><h1>${esc(_t(title))}</h1><p>${esc(_t(hint))}</p></div>${menuArt(art)}</div>`;

  // Safari only lets a page make sound from an AudioContext that was started during a click, and the
  // engine is created a few seconds after the click (it waits for the server). So one context is made
  // and reused during automatic resume; a gesture unlocks that same context.
  let sharedAC = null;
  function unlockAudio() {
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      audioContext();
      if (sharedAC.state === 'suspended'||sharedAC.state === 'interrupted') { const r = sharedAC.resume(); if (r && r.catch) r.catch(() => {}); }
      const src = sharedAC.createBufferSource(); src.buffer = sharedAC.createBuffer(1, 1, 22050); src.connect(sharedAC.destination); src.start(0);
    } catch (_) { /* no sound is better than no game */ }
  }
  ['pointerdown', 'mousedown', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));
  const audioContext = () => {
    const A=window.AudioContext||window.webkitAudioContext;
    if(!A)return undefined;
    if(!sharedAC||sharedAC.state==='closed')sharedAC=new A();
    return sharedAC;
  };

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const $ = (sel, r) => (r || root).querySelector(sel);
  const money = n => '$' + Math.round(n).toLocaleString((window.mvmOS && window.mvmOS.lang) || undefined);
  function lapStr(s) {
    if (s == null || !isFinite(s)) return '–:––.–––';
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  }
  const secStr = s => (s == null || !isFinite(s) ? '–.––' : s.toFixed(2));
  function hourStr(h) {
    try { return new Intl.DateTimeFormat((window.mvmOS && window.mvmOS.lang) || undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, 0)); }
    catch (_) { return h + ':00'; }
  }
  function dateStr(ts) {
    try { return new Intl.DateTimeFormat((window.mvmOS && window.mvmOS.lang) || undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts * 1000)); }
    catch (_) { return new Date(ts * 1000).toLocaleString(); }
  }
  const sky = c => (c.rain > 0.5 ? '🌧️' : c.rain > 0.02 ? '🌦️' : c.cloud > 0.72 ? '☁️' : c.cloud > 0.35 ? '⛅' : '☀️');
  const trackName = id => { const t = G && G.tracks && G.tracks.find(x => x.id === id); if (t) return t.name; const k = 'ap_trk_' + id; const v = _t(k); return v === k ? id : v; };
  const roundTrack = div => (div && div.calendar && div.calendar[div.round - 1] && div.calendar[div.round - 1].track) || 'zandvoort';

  async function api(path, body) {
    const r = await fetch('/pub/' + GAME_ID + path, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      headers: Object.assign({ 'X-GH-Token': token() }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if(d.training_hall)d.training_hall.received_at=performance.now();
    return { ok: r.ok, d };
  }

  async function loadMods() {
    if (mods) return mods;
    const three = await import(asset('/apps/' + GAME_ID + '/three.module.min.js'));
    const SIM = await import(asset('/apps/' + GAME_ID + '/sim.js'));
    const VIEW = await import(asset('/apps/' + GAME_ID + '/view3d.js'));
    const TIMING = await import(asset('/apps/' + GAME_ID + '/timing.js'));
    const RACE = await import(asset('/apps/' + GAME_ID + '/race.js'));
    const DIVISION = await import(asset('/apps/' + GAME_ID + '/division.js'));
    const AUDIO = await import(asset('/apps/' + GAME_ID + '/engine-audio.js'));
    const ANALYSIS = await import(asset('/apps/' + GAME_ID + '/analysis.js'));
    const RADIO = await import(asset('/apps/' + GAME_ID + '/radio.js'));
    if (!FX) FX = await import(asset('/apps/' + GAME_ID + '/specialist-fx.js'));
    mods = { THREE: three, SIM, VIEW, TIMING, RACE, DIVISION, AUDIO, ANALYSIS, FX, RADIO };
    if (!tracksCat) tracksCat = await (await fetch(asset('/pub/' + GAME_ID + '/tracks.json'))).json();
    return mods;
  }

  // The weather of a circuit is fetched when it is opened and kept for a few hours, so browsing
  // the garage does not ask the weather service again and again.
  const forecasts = {};
  let simMod = null, FX = null;
  async function loadSim() { if (!simMod) simMod = await import(asset('/apps/' + GAME_ID + '/sim.js')); return simMod; }
  // The circuit's local time now, with minutes: the moment the forecast was fetched plus the time since.
  const nowFrac = () => (G && G.fc ? (G.fc.now_frac ?? G.fc.now ?? G.fc.hour) + (Date.now() - G.fc.at) / 3600e3 : cfg.hour) % 24;
  async function loadForecast(id) {
    await loadSim();
    const key = id + ':' + Math.floor(Date.now() / 3600e3);
    if (!forecasts[key]) {
      const r = await api('/forecast?track=' + encodeURIComponent(id));
      if (!r.ok) return;
      forecasts[key] = { ...r.d, at: Date.now() };
    }
    const f = forecasts[key];
    G.forecast = f.forecast; G.live = f.live; G.fc = f;
    cfg.hour = Math.floor(nowFrac());   // a test always runs at the circuit's current hour
    compound = recShown(cond(cfg.hour));
  }

  // A circuit built once and kept: the official ones come from the shipped catalogue, the own one from the garage.
  function useTrack(id) {
    const def = id === 'own' ? G.own : (tracksCat && tracksCat[id]);
    if (!def || !mods) return null;
    const key = id + ':' + def.length + ':' + def.start + ':' + def.points.length + ':' + JSON.stringify(def.grandstands||[]);
    if (!builtTracks[key]) builtTracks[key] = mods.SIM.buildTrack({ id, points: def.points, width: def.width, runoff: def.runoff, sectors: def.sectors, start: def.start, grandstands: def.grandstands });
    return builtTracks[key];
  }

  // ── skeleton ──
  function renderGame(r, options = {}) {
    if (options.reconnect && appNode && G) {
      root = r;
      if (appNode.parentNode !== root) root.appendChild(appNode);
      if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
      startEnergyRefresh();
      view?.resize();
      return;
    }
    screenCache.clear();
    closeGarageView();closeVenueView();sndStop();clearInterval(divisionTimer);divisionTimer=null;clearInterval(hallTimer);hallTimer=null;
    clearTimeout(resumeTimer);resumeBusy=false;resumeError='';pending=null;pitModal=false;G=null;
    if(view){view.destroy();view=null;}
    if(divisionPlayback){divisionPlayback.destroy();divisionPlayback=null;}

    root = r;
    root.innerHTML = `
      <div class="ap-app">
        <header class="ap-top">
          <div class="ap-brand">🏁 <b>${esc(_t('ap_title'))}</b></div>
          <nav class="ap-tabs" aria-label="${esc(_t('ap_title'))}">
            <button data-tab="home">🏠 <span>${esc(_t('ap_tab_home'))}</span></button>
            <button data-tab="team">🏁 <span>${esc(_t('ap_tab_team'))}</span></button>
            <button data-tab="garage">🔧 <span>${esc(_t('ap_tab_garage'))}</span></button>
            <button data-tab="lab">🔬 <span>${esc(_t('ap_tab_lab'))}</span></button>
            <button data-tab="warehouse">📦 <span>${esc(_t('ap_tab_warehouse'))}</span></button>
            <button data-tab="driver">🧑‍✈️ <span>${esc(_t('ap_staff'))}</span></button>
            <button data-tab="division">🏆 <span>${esc(_t('ap_divisions'))}</span></button>
            <button data-tab="finance">💳 <span>${esc(_t('ap_finances'))}</span></button>
            <button data-tab="stats">📊 <span>${esc(_t('ap_tab_stats'))}</span></button>
            <button data-tab="track" hidden>🎥 <span>${esc(_t('ap_tab_track'))}</span></button>
          </nav>
          <div class="ap-status">
            <span class="ap-chip" id="ap-budget" title="${esc(_t('ap_budget'))}"></span>
            <button class="ap-btn ap-sm" id="ap-leave">${esc(_t('ap_leave'))}</button>
          </div>
        </header>
        <main class="ap-main">
          <section id="ap-home" class="ap-screen"></section>
          <section id="ap-team" class="ap-screen"></section>
          <section id="ap-garage" class="ap-screen"></section>
          <section id="ap-lab" class="ap-screen"></section>
          <section id="ap-warehouse" class="ap-screen"></section>
          <section id="ap-driver" class="ap-screen"></section>
          <section id="ap-division" class="ap-screen"></section>
          <section id="ap-finance" class="ap-screen"></section>
          <section id="ap-stats" class="ap-screen"></section>
          <section id="ap-track" class="ap-screen"></section>
        </main>
        <div id="ap-modal" class="ap-modal" hidden></div>
      </div>`;
    appNode = root.querySelector('.ap-app');
    appNode.addEventListener('focusin', e => { lastFocus = e.target; });
    root.querySelectorAll('.ap-tabs button').forEach(b => b.addEventListener('click', () => {
      // a menu click returns to the screen as it was left: same sub-view, same scroll position
      const from = $('#ap-' + screen), to = $('#ap-' + b.dataset.tab);
      if (from) scrollMemo[screen] = from.scrollTop;
      go(b.dataset.tab);
      if (to) to.scrollTop = scrollMemo[b.dataset.tab] || 0;
    }));
    $('#ap-leave').addEventListener('click', async () => {
      if (pending) return;
      const running = G?.career?.active_session || (run && !run.done);
      if (running && !await confirmGame(_t('ap_leave_confirm'))) return;
      mp.send({ type: 'ap_finish' });
      setTimeout(() => { location.href = '/pub/gamehub/?game=' + GAME_ID; }, 250);
    });
    window.addEventListener('resize', () => view && view.resize());
    load();
  }

  async function load() {
    await uiReady;
    const { ok, d } = await api('/state');
    if (!ok) { render($('#ap-garage'), `<div class="ap-empty">${esc(_t('ap_error'))}</div>`); go('garage'); return; }
    if (!FX) FX = await import(asset('/apps/' + GAME_ID + '/specialist-fx.js'));
    adopt(d);
    if (!cfg.hourSet) cfg.hour = G.hour;
    compound = recShown(cond(cfg.hour));
    paintStatus();
    if(deferredGo){const msg=deferredGo;deferredGo=null;receiveGo(msg);return;}
    const active=G.career.active_session;
    if(active&&run&&!run.done&&pb.msg?.session===active.id){pb.playing=true;go('track');return;}
    run=null;summary=null;busy=false;gview='cars';pview='list';teamView='overview';go('home');
    if(active)requestResume();
  }
  function adopt(d) {
    stateRevision++;
    G = d; G.live = !!d.weather_live;
    if(!d.tracks.some(t=>t.id===curTrack))curTrack=d.tracks[0]?.id || 'own';
    { const f = forecasts[curTrack + ':' + Math.floor(Date.now() / 3600e3)]; if (f) { G.forecast = f.forecast; G.live = f.live; G.fc = f; cfg.hour = Math.floor(nowFrac()); } }
    if(d.division?.locked_setup)setups[roundTrack(d.division)]={...d.division.locked_setup};
    d.tracks.forEach(t => { if (!setups[t.id]) setups[t.id] = Object.assign({}, t.setup); });
  }

  const hasTrackContent = () => !!(divisionPlayback || run || summary || pending || G?.career.active_session);
  function updateTrackTab() {
    const tab = root?.querySelector('[data-tab="track"]');
    if (tab) tab.hidden = !hasTrackContent();
  }
  function go(s) {
    if(s==='division' && G?.team){
      const car=G.team.cars.find(c=>c.id===G.team.active_car);
      if(car?.pilot_id && car.pilot_id!==G.team.active_pilot){
        flushSetup().then(ok=>ok?api('/team/select-car',{id:car.id}):null).then(r=>{if(!r)return;if(r.ok){setups={};adopt(r.d);paintStatus();go('division');}else notifyGame(careerError(r.d.error));});return;
      }
    }
    updateTrackTab();
    if (s === 'track' && !hasTrackContent()) s = 'garage';
    if(builder&&teamView!=='builder'){builder.destroy();builder=null;}
    if (s !== 'lab') labMod?.stop();
    if(s==='division'&&!['S','M','H'].includes(compound))compound='M';
    if(s==='team'){if(editEntry){editFrom='driver';editEntry=false;}else if(editFrom){editFrom=null;teamView='overview';if(builder){builder.destroy();builder=null;}}}
    screen = s;clearInterval(divisionTimer);divisionTimer=null;clearInterval(hallTimer);hallTimer=null;
    if(divisionPlayback){if(s==='track')divisionPlayback.resume();else divisionPlayback.pause();}
    root.querySelectorAll('.ap-screen').forEach(x => { x.style.display = x.id === 'ap-' + s ? '' : 'none'; });
    root.querySelector('.ap-app').dataset.screen = s;
    root.querySelectorAll('.ap-tabs button').forEach(b => {
      const active = b.dataset.tab === (s === 'team' && editFrom ? editFrom : s);
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      if (active) {
        const nav = b.parentElement, left = b.offsetLeft, right = left + b.offsetWidth;
        if (left < nav.scrollLeft) nav.scrollLeft = left;
        else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
      }
    });
    const signature = JSON.stringify([stateRevision, s === 'garage' ? [gview, setupPage] : s === 'team' ? teamView : s === 'driver' ? [pview, staffTab, marketOpen] : '', curTrack]);
    const refresh = screenCache.get(s) !== signature;
    screenCache.set(s, signature);
    if (!refresh && s !== 'track' && s !== 'lab') {
      startEnergyRefresh();
      if (view) setTimeout(() => view?.resize(), 30);
      return;
    }
    if (s === 'home') paintHome();
    else if (s === 'team') paintTeam();
    else if (s === 'garage') paintGarage();
    else if (s === 'warehouse') paintWarehouse();
    else if (s === 'lab') paintLab();
    else if (s === 'driver') paintDriver();
    else if (s === 'division') paintDivision();
    else if (s === 'finance') paintFinances();
    else if (s === 'stats') paintStats();
    else if (s === 'track') paintTrack();
    startEnergyRefresh();
    if (view) setTimeout(() => view?.resize(), 30);
  }

  function paintStatus() {
    if (!G) return;
    updateTrackTab();
    const d = G.driver;
    $('#ap-budget').textContent = '💰 ' + money(d.budget);
    const car=G.team?.cars.find(c=>c.id===d.car_id),pilot=G.team?.pilots.find(p=>p.id===d.pilot_id);
    if(car){car.parts=d.parts;car.level=d.car_level;}
    if(pilot){pilot.name=d.name;pilot.energy=d.energy;pilot.overall=d.overall;pilot.age=d.age;}
  }

  const cond = h => G.forecast[((h % 24) + 24) % 24];
  function clockStr(h) {
    const m = Math.round(((h % 24) + 24) % 24 * 60);
    try { return new Intl.DateTimeFormat((window.mvmOS && window.mvmOS.lang) || undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60)); }
    catch (_) { return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  }
  // Chance of rain at a moment: the forecast's own figure, or its intensity when the day is simulated.
  const rainPct = c => Math.round(100 * Math.max(0, Math.min(1, c.pp != null ? Math.max(c.pp, c.rain || 0) : (c.rain || 0))));
  // What the team's specialists let it see (levels come from the server; null = nobody in the role)
  const lvl = role => G?.specialists?.levels?.[role] ?? null;
  // where a circuit is on Earth: the sky above it follows the sun and the moon there
  const siteOf = id => { const t = (G?.tracks || []).find(x => x.id === id); return t && t.lat != null ? { lat: t.lat, lon: t.lon, id } : { id }; };
  const wxH = () => (FX ? FX.wxHalf(lvl('meteorologist')) : null);
  const stratOn = () => lvl('strategist') != null;
  const recShown = c => (stratOn() ? recommend(c) : 'M');          // the tyre call belongs to the strategist
  const isRaining = c => (c.rain || 0) > 0.02;   // the same limit the 3D view draws raindrops at
  // What the next hour holds, minute by minute, from the same forecast the simulation reads.
  function wxOutlook(SIM, forecast, hf, span = 60) {
    const at = m => SIM.condAt(forecast, hf + m / 60);
    const now = isRaining(at(0)), short = span < 60;
    let change = null;
    for (let s = 15; s <= span * 60 && change == null; s += 15) if (isRaining(at(s / 60)) !== now) change = short ? Math.max(1, Math.round(s / 60)) : Math.ceil(s / 60);
    const msg = (short ? { 1: 'ap_wx_short_wet', 2: 'ap_wx_short_stops', 3: 'ap_wx_short_dry', 4: 'ap_wx_short_starts' }[(now ? 1 : 3) + (change == null ? 0 : 1)] : null)
      || (now ? (change == null ? 'ap_wx_rain_all' : 'ap_wx_rain_stops') : (change == null ? 'ap_wx_dry_all' : 'ap_wx_rain_starts'));
    return { now, change, msg, span, steps: [0, 15, 30, 45, 60].map(m => ({ m, c: at(m) })) };
  }
  function wxStepsHtml(o, hf) {
    const half = wxH();
    return `<div class="ap-wxsteps">${o.steps.map(x => `<div><small>${esc(x.m ? '+' + x.m + ' ' + _t('ap_min') : _t('ap_now'))}</small><span>${sky(x.c)}</span><b>${esc(FX.wxText(rainPct(x.c), 'o' + Math.floor(hf * 4) + ':' + x.m, half))}</b><em>${esc(clockStr(hf + x.m / 60))}</em></div>`).join('')}</div>`;
  }
  const wxMsgText = o => _t(o.msg, { n: o.change ?? o.span });
  // The wording of the coming minutes for the weaker meteorologists: a range of chances, not the minute the rain changes.
  function wxAheadText(SIM, forecast, hf, o, minutes) {
    const half = wxH();
    if (half == null) return _t('ap_wx_none');
    if (!FX.wxShortOn(half)) return _t('ap_wx_hourly_only');
    if (FX.wxExact(half) || half <= 6) return wxMsgText(o);
    const top = Math.max(...[0, minutes / 2, minutes].map(m => rainPct(SIM.condAt(forecast, hf + m / 60))));
    return _t('ap_wx_short_chance', { n: FX.wxText(top, 'a' + Math.floor(hf * 6), half), m: minutes });
  }
  function wxNowHtml(SIM, forecast, hf, cn) {
    const o = wxOutlook(SIM, forecast, hf, 10), half = wxH();
    const state = o.now ? _t('ap_wx_raining') + ' · ' + _t('ap_wx_intensity', { n: ((cn.rain || 0) * 2.5).toFixed(1) }) : _t('ap_wx_not_raining') + (half == null ? '' : ' · ' + _t('ap_wx_chance', { n: FX.wxText(rainPct(cn), 'n' + Math.floor(hf * 6), half).replace('%', '') }));
    return `<b>${sky(cn)} ${esc(state)}</b><br>${esc(_t('ap_air'))} ${Math.round(cn.air)}° · ${esc(_t('ap_asphalt'))} ${Math.round(cn.track)}°<br><small>${esc(wxAheadText(SIM, forecast, hf, o, 10))}</small>${FX.wxShortOn(half) ? `<br><small class="ap-hint">${esc(_t('ap_wx_tap'))}</small>` : ''}`;
  }
  const recommend = c => (c.water > 1.2 ? 'W' : c.water > 0.08 || c.rain > 0.2 ? 'I' : c.track < 22 ? 'S' : c.track > 44 ? 'H' : 'M');
  const tinfo = () => G.tracks.find(t => t.id === curTrack) || G.tracks[0];
  const setup = () => setups[curTrack];
  // The setup is saved for the open car shortly after the last slider move. Anything still waiting is sent at once
  // before another car is opened, otherwise it would be stored on the wrong car and the open car would lose it.
  let setupSave = null;
  let setupSaving = Promise.resolve(true);
  function queueSetupSave(track, S) {
    clearTimeout(saveTimer); setupSave = { track, setup: { ...S } };
    saveTimer = setTimeout(flushSetup, 600);
  }
  async function flushSetup() {
    clearTimeout(saveTimer); saveTimer = 0;
    const job = setupSave; setupSave = null;
    if (job) setupSaving = setupSaving.then(async () => {
      try {
        const result = await api('/setup', job);
        if (result.ok) return true;
      } catch (_) { /* retain the draft so switching cannot silently lose it */ }
      if (!setupSave) setupSave = job;
      notifyGame(_t('ap_error'));
      return false;
    });
    return setupSaving;
  }
  // opening another car keeps the page where it was instead of jumping back to the top
  async function openCar(id) {
    if (!await flushSetup()) return false;
    const r = await api('/team/select-car', { id });
    if (!r.ok) { notifyGame(careerError(r.d.error)); return false; }
    return r;
  }
  const isHost = () => { try { return mp.isHost(); } catch (_) { return true; } };
  const canChange = () => !multi || isHost();
  const sessLaps = () => cfg.laps;
  function costNow() {
    const t = tinfo();
    if (t.id === 'own') return 0;
    return markedIds().reduce((sum, id) => sum + t.rent_practice + G.costs.lap * (sessLaps() + 1) + G.costs.fuel * Math.round(carSetupOf(id).fuel), 0);
  }
  // the cars of a practice: the ticked ones, in the order of the team; the setup each goes out with on this circuit
  const defaultSetup = () => Object.fromEntries(G.defs.map(x => [x.key, x.def]));
  const carSetupOf = id => id === teamRoster().active_car ? setup() : teamRoster().cars.find(c => c.id === id)?.setups?.[curTrack] || defaultSetup();
  function markedIds() {
    const team = teamRoster();
    if (team.cars.length < 2 || !markedCars) return team.cars.some(c => c.id === team.active_car) ? [team.active_car] : [];
    return team.cars.filter(c => markedCars.includes(c.id)).map(c => c.id);
  }
  function driverEnergy(cost=0) {
    const d=G.driver;if(!d.has_driver)return '';
    const rate=d.energy_regen_hour??15,full=Math.max(0,100-d.energy)/rate*3600;
    return `<div data-driver-energy class="ap-driver-energy"><b>${esc(_t('ap_driver_energy_now',{name:d.name,energy:Math.floor(d.energy*10)/10}))}</b><p class="ap-hint">${esc(_t('ap_energy_refill',{rate,time:durationText(full)}))}</p>${cost?`<p class="ap-hint">${esc(_t('ap_energy_use',{cost}))}</p>`:''}</div>`;
  }

  function startEnergyRefresh(){
    clearInterval(divisionTimer);divisionTimer=null;clearInterval(hallTimer);hallTimer=null;
    if(!G||!['team','garage','driver','division'].includes(screen))return;
    if(screen==='driver')hallTimer=setInterval(updateTrainingHall,1000);
    divisionTimer=setInterval(async()=>{
      if(busy||pending||!$('#ap-modal')?.hidden)return;
      const current=screen,driver=G.driver,node=root;let response;
      try{response=await api('/state');}catch(_){return;}
      if(!response.ok||screen!==current||root!==node||G.driver!==driver||busy||pending||!$('#ap-modal')?.hidden)return;
      const oldOffers=G.career.offers.map(o=>o.id).join(','),oldHall=G.training_hall?.remaining,oldDiv=JSON.stringify(G.division?.weekend||G.division?.round||0);
      const keep=setups,sc=$('#ap-'+screen),top=sc?sc.scrollTop:0;adopt(response.d);setups=keep;paintStatus();
      // the background refresh never rebuilds a screen the player is working in; division only when its weekend moved on
      if(screen==='division'){if(oldDiv!==JSON.stringify(G.division?.weekend||G.division?.round||0)){paintDivision();if(sc)sc.scrollTop=top;}}
      else if(screen==='garage'&&gview==='setup'){}
      else if(screen==='driver'){
        if(oldHall!==G.training_hall?.remaining || pview==='list'&&oldOffers!==G.career.offers.map(o=>o.id).join(',')){paintDriver();if(sc)sc.scrollTop=top;return;}
        const panel=$('[data-driver-energy]');if(panel)panel.outerHTML=driverEnergy();
        const meter=$('.ap-meter.ap-energy i');if(meter)meter.style.width=G.driver.energy+'%';
        $('#ap-driver').querySelectorAll('[data-crew-train]').forEach(b=>{const member=Object.values(G.crew.cars).flatMap(c=>Object.values(c.members)).find(m=>m?.id===b.dataset.member);b.disabled=!member||member.energy<G.crew.train_energy||!!G.career.active_session||!G.training_hall?.remaining;});
        $('#ap-driver').querySelectorAll('[data-staff-train]').forEach(b=>{const member=Object.values(G.specialists.members).find(m=>m?.id===b.dataset.member);b.disabled=!member||member.energy<G.specialists.train_energy||!!G.career.active_session||!G.training_hall?.remaining;});
        $('#ap-driver').querySelectorAll('[data-g]').forEach(b=>b.disabled=G.driver.energy<G.costs.train_energy||!!G.career.active_session||!G.training_hall?.remaining);
      }
    },30000);
  }
  const energyNow = () => Math.round(G.costs.practice_energy_lap*(sessLaps()+1)*(G.driver.driving_energy_factor??1)*100)/100;
  const health = w => Math.round((1 - w) * 100);
  const healthCol = w => (w < 0.4 ? '#4fd18b' : w < 0.7 ? '#f2c230' : w < 0.9 ? '#ff9a4d' : '#ff5a5a');

  function careerError(code) {
    return _t(({training_limit:'ap_hall_limit',tyre_set:'ap_tyre_set_error',tyre:'ap_tyre_set_error',warehouse_full:'ap_wh_full',designs_full:'ap_wh_full',research_busy:'ap_err_research_busy',queue_full:'ap_err_queue_full',unit:'ap_err_unit',car:'ap_need_car',driver:'ap_need_driver',busy:'ap_active_run_hint',no_archive:'ap_error',cooldown:'ap_recruit_cooldown',
      assignment:'ap_assignment_required',offer:'ap_offer_expired',owned:'ap_car_owned',future:'ap_multiplayer_soon',division_requirements:'ap_division_requirements',weekend_order:'ap_weekend_order',parc_ferme:'ap_parc_ferme',second_car:'ap_both_need_driver',solo_only:'ap_solo_only',budget:'ap_no_budget',energy:'ap_no_energy_run',licence:'ap_err_licence',no_track:'ap_err_no_track',track_requirements:'ap_err_track_requirements',car_limit:'ap_err_car_limit',member:'ap_err_member',occupied:'ap_err_occupied',position:'ap_err_member',role:'ap_err_member'})[code] || 'ap_error');
  }
  function activeRunPanel(){
    if(!G?.career.active_session)return '';
    return `<div class="ap-active-run"><p class="ap-warn">${esc(_t('ap_active_run_hint'))}</p><p class="ap-hint">${esc(_t('ap_resume_run_hint'))}</p>
      <button class="ap-btn ap-sm" data-resume-run ${resumeBusy?'disabled':''}>${esc(_t(resumeBusy?'ap_resuming_run':'ap_resume_run'))}</button>
      ${resumeError?`<p class="ap-warn" role="status">${esc(resumeError)}</p>`:''}</div>`;
  }
  function paintResumeButtons(){
    if(!root)return;
    root.querySelectorAll('[data-resume-run]').forEach(b=>{b.disabled=resumeBusy;b.textContent=_t(resumeBusy?'ap_resuming_run':'ap_resume_run');});
  }
  function bindResume(host){host.querySelectorAll('[data-resume-run]').forEach(b=>on(b, 'click',requestResume));}
  function requestResume(){
    if(!G?.career.active_session||resumeBusy)return;
    const id=G.career.active_session.id;
    if(run&&!run.done&&pb.msg?.session===id){pb.playing=true;go('track');return;}
    if(divisionPlayback?.session===id){go('track');return;}
    resumeBusy=true;resumeError='';busy=true;paintResumeButtons();
    clearTimeout(resumeTimer);
    resumeTimer=setTimeout(()=>{
      resumeBusy=false;busy=false;resumeError=_t('ap_resume_retry');
      if(screen==='division')paintDivision();else if(screen==='garage')paintGarage();else paintResumeButtons();
    },8000);
    mp.send({type:'ap_resume',session:id});
  }
  function receiveGo(msg){
    if(!root||!G){deferredGo=msg;return;}
    clearTimeout(resumeTimer);resumeBusy=false;resumeError='';paintResumeButtons();
    if(pending?.session===msg.session)return;
    if(run&&!run.done&&pb.msg?.session===msg.session){busy=false;pb.playing=true;go('track');return;}
    if(divisionPlayback?.session===msg.session){busy=false;go('track');return;}
    onGo(msg).catch(async error=>{
      console.error(error);pending=null;busy=false;sndStop();
      if(view){view.destroy();view=null;}
      if(divisionPlayback){divisionPlayback.destroy();divisionPlayback=null;}
      run=null;await load2();resumeError=_t('ap_no_webgl');go('garage');
    });
  }
  function careerCard() {
    const c=G.career,d=G.driver;
    return `<div class="ap-card ap-career"><h2>${esc(_t('ap_team_title'))}</h2><p class="ap-hint">${esc(_t('ap_team_intro'))}</p>
      <p class="ap-hint">${esc(_t('ap_career_save_hint'))}</p><button class="ap-btn ap-sm ap-ghost" data-new-career ${c.active_session || busy ? 'disabled' : ''}>${esc(_t('ap_new_career'))}</button>
      ${c.previous_at ? `<p class="ap-hint">${esc(_t('ap_restore_hint',{n:Math.max(1,Math.ceil((c.previous_at+7*86400-Date.now()/1000)/86400))}))}</p><button class="ap-btn ap-sm ap-ghost" data-restore-career ${c.active_session || busy ? 'disabled' : ''}>${esc(_t('ap_restore_career'))}</button>` : ''}
      ${c.active_session ? `${activeRunPanel()}<button class="ap-btn ap-sm ap-ghost" data-abandon>${esc(_t('ap_abandon_run'))}</button>` : ''}</div>`;
  }
  function characterStyle(ch){
    if((ch.defence??50)>=65&&(ch.defence??50)>=(ch.aggression??50))return 'defensive';
    if((ch.aggression??50)>=65)return 'aggressive';
    return (ch.patience??50)>=65?'cautious':'balanced';
  }
  function characterHtml(ch,compact=false){
    if(!ch||!Object.keys(ch).length)return '';
    return `<div class="ap-character ${compact?'compact':''}"><strong>${esc(_t('ap_character'))}: ${esc(_t('ap_style_'+characterStyle(ch)))}</strong><div class="ap-character-traits">${['aggression','defence','patience'].map(k=>{const v=Math.max(0,Math.min(100,Number(ch[k])||0));return `<div><span>${esc(_t('ap_trait_'+k))}<b>${v}</b></span><div class="ap-meter"><i style="width:${v}%"></i></div></div>`;}).join('')}</div>${compact?'':`<p class="ap-hint">${esc(_t('ap_character_hint'))}</p>`}</div>`;
  }
  function recruitmentCard(always=false) {
    if(!always&&!marketOpen)return `<div class="ap-card ap-recruitment"><button class="ap-btn ap-sm ap-ghost" data-market-toggle>${esc(_t('ap_recruit_open'))}</button></div>`;
    const c=G.career,d=G.driver,wait=c.recruit_remaining;
    const totalHours=Math.ceil(wait/3600),days=Math.floor(totalHours/24),hours=totalHours%24;
    return `<div class="ap-card ap-recruitment"><div class="ap-bar"><h2>${esc(_t('ap_recruit_title'))}</h2>${always?'':`<button class="ap-btn ap-sm ap-ghost" data-market-toggle>${esc(_t('ap_recruit_close'))}</button>`}</div>
      <p class="ap-hint">${esc(_t('ap_recruit_market_hint'))}</p><p class="ap-hint">${esc(_t('ap_character_hint'))}</p>
      ${wait ? `<p class="ap-warn">${esc(_t('ap_recruit_wait',{days,hours}))}</p>` : ''}
      <div class="ap-recruit-offers">${c.offers.map(o=>`<div class="ap-recruit-offer"><div><b>${esc(o.name)}</b><small>${esc(_t('ap_age',{n:o.age}))} · ${esc(_t('ap_overall'))} ${o.overall}</small><span class="ap-stars">${'★'.repeat(Math.floor(o.stars))}${o.stars%1>=.5 ? '½' : ''}</span>${characterHtml(o.character,true)}<p class="ap-hint">${esc(_t('ap_daily_salary'))}: <b>${money(o.salary)}</b></p><details><summary>${esc(_t('ap_driver_skills'))}</summary>${G.skills.map(k=>`<div class="ap-offer-skill"><span>${esc(_t('ap_k_'+k))}</span><b>${o.skills[k].toFixed(1)}</b></div>`).join('')}</details></div>
        <button class="ap-btn ap-sm" data-recruit="${esc(o.id)}" data-name="${esc(o.name)}" ${c.active_session || d.budget<o.price ? 'disabled' : ''}>${esc(_t('ap_recruit'))}<small>${money(o.price)}</small></button></div>`).join('')}</div>
      <p class="ap-hint">${esc(_t('ap_aging_hint'))}</p></div>`;
  }
  function bindCareer(host) {
    on(host.querySelector('[data-sponsor-open]'), 'click',()=>go('finance'));
    bindResume(host);
    host.querySelectorAll('[data-market-toggle]').forEach(b=>on(b,'click',()=>{marketOpen=!marketOpen;if(screen==='driver')paintDriver();else if(screen==='team')paintTeam();else paintGarage();}));
    const refresh=async(path,body)=>{
      const r=await api(path,body);if(!r.ok){notifyGame(careerError(r.d.error));await load2();if(screen==='driver')paintDriver();else if(screen==='team')paintTeam();else paintGarage();return;}
      if(path==='/session/abandon'){summary=null;sndStop();if(divisionPlayback){divisionPlayback.destroy();divisionPlayback=null;}pb.playing=false;pb.sent=true;busy=false;pending=null;run=null;if(view){view.destroy();view=null;}render($('#ap-track'), '');}
      adopt(r.d);lastGains=null;paintStatus();if(path==='/driver/recruit')pview='list';if(screen==='driver')paintDriver();else if(screen==='team')paintTeam();else paintGarage();
    };
    host.querySelectorAll('[data-season]').forEach(b=>b.onclick=()=>go('division'));
    host.querySelectorAll('[data-new-career]').forEach(b=>on(b, 'click',async()=>{
      if(!await confirmGame(_t('ap_new_career_confirm')))return;
      b.disabled=true;mp.send({type:'ap_new_career',started:G.career.started});
    }));
    host.querySelectorAll('[data-restore-career]').forEach(b=>on(b, 'click',async()=>{
      if(!await confirmGame(_t('ap_restore_confirm')))return;
      b.disabled=true;mp.send({type:'ap_restore_career',started:G.career.started});
    }));
    host.querySelectorAll('[data-recruit]').forEach(b=>on(b, 'click',async()=>{
      if(!await confirmGame(_t('ap_recruit_team_confirm',{name:b.dataset.name,price:money(G.career.offers.find(o=>o.id===b.dataset.recruit)?.price || 0)})))return;
      b.disabled=true;refresh('/driver/recruit',{offer:b.dataset.recruit}).catch(()=>{b.disabled=false;});
    }));
    host.querySelectorAll('[data-abandon]').forEach(b=>on(b, 'click',async()=>{if(await confirmGame(_t('ap_abandon_confirm')))refresh('/session/abandon',{});}));
  }
  function paintEmptyGarage(host) {
    render(host, `${pageHeading('ap_tab_garage','ap_car_list_hint','frontWing')}<div class="ap-card"><p class="ap-hint">${esc(_t('ap_need_car'))}</p><button class="ap-btn" data-open-team>${esc(_t('ap_tab_team'))}</button></div>`);
    host.querySelector('[data-open-team]').onclick=()=>{teamView='overview';go('team');};
  }

  function teamRoster() {
    if (G.team) return G.team;
    const d = G.driver;
    return { cars: d.has_car ? [{ id: d.car_id, number: 1, level: d.car_level, parts: d.parts, pilot_id: d.assigned_pilot_id }] : [],
      pilots: d.has_driver ? [{ ...d, id: d.pilot_id }] : [], active_car: d.car_id, active_pilot: d.pilot_id };
  }
  const assignedPilot = () => teamRoster().cars.find(c=>c.id===teamRoster().active_car)?.pilot_id || null;
  const carName = car => car.name || _t('ap_car_number', { n: car.number });
  function rosterBack(kind) {
    return `<div class="ap-roster-back"><button class="ap-btn ap-sm ap-ghost" data-roster-back="${kind}">◂ ${esc(_t(kind === 'cars' ? 'ap_your_cars' : 'ap_tab_drivers'))}</button></div>`;
  }
  function bindRosterBack(host) {
    host.querySelectorAll('[data-roster-back]').forEach(b => on(b, 'click', () => {
      if (b.dataset.rosterBack === 'cars') { gview='cars'; paintGarage(); }
      else { pview='list'; paintDriver(); }
      host.scrollTop=0;
    }));
  }
  async function selectRoster(kind, id, button) {
    button.disabled=true;
    try {
      if (!await flushSetup()) return;
      const r=await api('/team/select-' + kind, { id });
      if (!r.ok) { notifyGame(careerError(r.d.error)); return; }
      setups={};adopt(r.d);lastGains=null;paintStatus();
      if (kind==='car') { gview='car'; paintGarage(); $('#ap-garage').scrollTop=0; }
      else { pview='detail'; paintDriver(); $('#ap-driver').scrollTop=0; }
    } finally { if(button.isConnected)button.disabled=false; }
  }
  function circuitsCard() {
    const tracks = G.tracks.map(t => {
      const b = t.bests || {};
      return `<div class="ap-trackcard" data-track="${t.id}">
        <div class="ap-bar"><h3>${esc(trackName(t.id))}${t.own ? ` <small class="ap-hint">· ${esc(_t('ap_own_badge'))}</small>` : ''}</h3>
          <span><button class="ap-btn ap-sm" data-open="${t.id}" ${assignedPilot() && t.usable ? '' : 'disabled'}>${esc(_t('ap_open'))} ▸</button></span></div>
        <div class="ap-circuit-map" data-circuit-map="${esc(t.id)}"></div>
        <div class="ap-tc-info">${t.usable ? '' : `<p class="ap-hint">🔒 ${esc(_t('ap_licence_needed'))}</p>`}
        <div class="ap-cond">
          ${t.usable ? `<div><span>${esc(_t('ap_your_best'))}</span><b>${lapStr(b.best)}</b></div>
          <div><span>${esc(_t('ap_theoretical'))}</span><b>${lapStr(b.theoretical)}</b></div>
          <div><span>${esc(_t('ap_track_record'))}</span><b>${lapStr(b.record)}</b></div>` : ''}
          ${t.own ? '' : `<div><span>${esc(_t('ap_distance'))}</span><b>${esc(Math.round(t.km).toLocaleString())} km</b></div>
          <div><span>${esc(_t('ap_trip_practice'))}</span><b>${money(t.practice_cost)}</b></div>
          <div><span>${esc(_t('ap_trip_race'))}</span><b>${money(t.race_trip)}</b></div>`}
          ${t.usable ? `<div><span>${esc(_t('ap_runs_n'))}</span><b>${b.runs || 0} · 🏁 ${b.races || 0}</b></div>` : ''}
        </div></div></div>`;
    }).join('');
    return `<div class="ap-card"><h2>${esc(_t('ap_circuits'))}</h2>${tracks}</div>`;
  }
  // the home dashboard: the advice of the team's people, from the state already loaded
  let homeMod = null;
  async function paintHome() {
    if (!G) return;
    const host = $('#ap-home');
    if (!host.hasChildNodes()) render(host, `<div class="ap-empty">${esc(_t('ap_preparing'))}</div>`);
    if (!homeMod) homeMod = await import(asset('/apps/' + GAME_ID + '/home.js'));
    if (screen !== 'home' || !G) return;
    homeMod.paintHome(host, {
      G, t: _t, esc, money, go, hall: hallView, gameSkills: GAMESKILLS, carName, trackName, pilotOk: !!assignedPilot(),
      heading: pageHeading('ap_tab_home', 'ap_hm_page_hint', 'staff'),
      recCompound: () => { try { return recShown(cond(cfg.hour)); } catch (_) { return null; } },
      openStaff: tab => { staffTab = tab; pview = 'list'; go('driver'); },
      openTrack: async id => { curTrack = id; gview = 'setup'; setupPage = 'cars'; setupFrom = 'home'; screenCache.delete('garage'); histTrack = ''; await loadForecast(curTrack); go('garage'); }
    });
  }
  function paintTeam() {
    if(!G)return;
    if(teamView==='builder'){if(!builder)paintBuilder();return;}
    if(builder){builder.destroy();builder=null;}
    if(teamView==='stands'&&G.own){if(!venueView)paintVenue();return;}
    teamView='overview';closeVenueView();
    const host=$('#ap-team');
    render(host, `${pageHeading('ap_tab_team','ap_team_page_hint','staff')}<div class="ap-garage ap-lab-list"><div class="ap-col">${circuitsCard()}</div></div>`);
    bindCareer(host);paintCircuitMaps(host);
    host.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{b.disabled=true;curTrack=b.dataset.open;gview='setup';setupPage='cars';setupFrom='team';screenCache.delete('garage');histTrack='';try{await loadForecast(curTrack);go('garage');}finally{if(b.isConnected)b.disabled=false;}});
    if(!tracksCat)fetch(asset('/pub/'+GAME_ID+'/tracks.json')).then(r=>r.ok?r.json():null).then(cat=>{if(cat)tracksCat=cat;if(screen==='team'&&teamView==='overview')paintCircuitMaps(host);}).catch(()=>{});
  }
  function teamNameCard() {
    return `<div class="ap-card"><h2>${esc(_t('ap_team_name'))}</h2><form data-team-name-form><label class="ap-teamname"><span>${esc(_t('ap_team_name'))}</span><input id="ap-team-name" maxlength="28" value="${esc(teamRoster().team_name||'')}" placeholder="${esc(_t('ap_your_team'))}" ${G.career.active_session?'disabled':''}></label><button type="submit" class="ap-btn" ${G.career.active_session?'disabled':''}>${esc(_t('ap_team_save'))}</button><p class="ap-hint" data-team-name-status role="status"></p></form></div>`;
  }
  function bindTeamName(host) {
    host.querySelector('[data-team-name-form]').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),status=form.querySelector('[data-team-name-status]');button.disabled=true;
      try{const r=await api('/team/name',{name:form.querySelector('input').value});if(!r.ok){status.textContent=careerError(r.d.error);return;}const keep=setups;adopt(r.d);setups=keep;paintStatus();form.querySelector('input').value=teamRoster().team_name;status.textContent=_t('ap_team_saved');}
      catch(_){status.textContent=_t('ap_error');}finally{if(button.isConnected)button.disabled=!!G.career.active_session;}
    };
  }
  function homeCircuitCard(withOpen=true) {
    const own=G.own;
    return `<div class="ap-card"><h2>${esc(_t('ap_tb_title'))}</h2>${own?`<div class="ap-trackcard"><div class="ap-circuit-map" data-circuit-map="own"></div><h3>${esc(own.name)}</h3><p class="ap-hint">${esc(_t('ap_tb_length'))}: ${(own.length/1000).toFixed(2)} km</p></div>`:`<p class="ap-hint">${esc(_t('ap_no_track_hint'))}</p>`}<div class="ap-card-actions"><button class="ap-btn" data-home-circuit ${G.career.active_session?'disabled':''}>${esc(_t(own?'ap_edit_track':'ap_tb_open'))}</button>${own&&withOpen?`<button class="ap-btn ap-ghost" data-open="own" ${assignedPilot()?'':'disabled'}>${esc(_t('ap_open'))}</button>`:''}</div></div>`;
  }
  function paintCarList(host) {
    closeGarageView();
    const team=teamRoster(), locked=!!G.career.active_session;
    const cards=team.cars.map(car=>{
      const pilot=team.pilots.find(p=>p.id===car.pilot_id);
      const wear=Object.values(car.parts || {}), condition=wear.length ? Math.round((1-wear.reduce((a,b)=>a+b,0)/wear.length)*100) : 100;
      return `<button type="button" class="ap-roster-card ap-car-choice" data-select-car="${esc(car.id)}" aria-label="${esc(_t('ap_open_car'))}: ${esc(carName(car))}" ${locked&&car.id!==team.active_car?'disabled':''}><div class="ap-roster-picture ap-roster-car" aria-busy="true"><div class="ap-car-loading" role="status">${esc(_t('ap_car_loading'))}</div><span class="ap-roster-number">${String(car.number).padStart(2,'0')}</span></div>
        <div class="ap-roster-body"><h2>${esc(carName(car))}</h2><div class="ap-tags"><span>${esc(_t('ap_car_level',{n:car.level}))}</span>${car.id===team.active_car?`<span>${esc(_t('ap_selected'))}</span>`:''}</div>
        <p class="ap-hint">${esc(_t('ap_tab_driver'))}: <b>${esc(pilot?.name || _t('ap_no_assigned_driver'))}</b></p>
        <div class="ap-set-h"><span>${esc(_t('ap_condition'))}</span><output>${condition}%</output></div><div class="ap-meter"><i style="width:${condition}%;background:${healthCol(1-condition/100)}"></i></div>
        </div></button>`;
    }).join('');
    render(host, `${pageHeading('ap_your_cars','ap_car_list_hint','frontWing')}<div class="ap-garage ap-car-list"><div class="ap-col"><div class="ap-roster-grid">${cards}</div>
      </div></div>`);
    bindCareer(host);
    host.querySelectorAll('[data-select-car]').forEach(b=>on(b, 'click',()=>selectRoster('car',b.dataset.selectCar,b)));
    const revision = garageRevision, previews = [];
    garageView = { destroy: () => previews.forEach(v => v.destroy()) };
    loadMods().then(M => {
      if (revision !== garageRevision || !host.isConnected || screen !== 'garage') return;
      host.querySelectorAll('.ap-roster-car').forEach(preview => {
        try {
          previews.push(M.VIEW.createGarageView(M.THREE, preview, { low: matchMedia('(pointer:coarse)').matches, compound, interactive: false, livery: team.cars.find(c=>c.id===preview.closest('[data-select-car]').dataset.selectCar)?.livery }));
          preview.querySelector('.ap-car-loading')?.remove();
        } catch (e) {
          preview.querySelector('canvas')?.remove();
          preview.querySelector('.ap-car-loading').textContent = _t('ap_no_webgl');
          console.warn('Racelandia car preview unavailable', e);
        }
        preview.setAttribute('aria-busy', 'false');
      });
    }).catch(e => {
      if (revision !== garageRevision) return;
      host.querySelectorAll('.ap-roster-car').forEach(preview => {
        preview.querySelector('.ap-car-loading').textContent = _t('ap_no_webgl');
        preview.setAttribute('aria-busy', 'false');
      });
      console.warn('Racelandia car previews unavailable', e);
    });
  }
  const staffNav = () => `<div class="ap-subtabs" role="tablist">${[['pilots', 'ap_pilots'], ['crew', 'ap_pit_crew'], ['specialists', 'ap_specialists'], ['team', 'ap_staff']].map(([k, label]) => `<button role="tab" aria-selected="${staffTab === k}" class="${staffTab === k ? 'on' : ''}" data-staff-tab="${k}">${esc(_t(label))}</button>`).join('')}</div>`;
  const bindStaffNav = host => host.querySelectorAll('[data-staff-tab]').forEach(b => on(b, 'click', () => { staffTab = b.dataset.staffTab; pview = 'list'; paintDriver(); host.scrollTop = 0; }));
  async function crewAction(path, body) {
    const r = await api(path, body);
    if (!r.ok) { notifyGame(careerError(r.d.error)); await load2(); }
    else { const keep = setups; adopt(r.d); setups = keep; paintStatus(); }
    if (screen === 'driver') paintDriver();
    return r.ok;
  }
  async function paintCrew(host) {
    const m = await import(asset('/apps/' + GAME_ID + '/staff.js'));
    if (screen !== 'driver' || staffTab !== 'crew' || pview !== 'list') return;
    m.paintCrew(host, { G, t: _t, esc, money, skillCol, confirm: confirmGame, heading: pageHeading('ap_staff', 'ap_staff_hint', 'staff'), nav: staffNav(), bind: bindStaffNav,
      hall:trainingHall(), getCar: () => crewCar, setCar: id => { crewCar = id; }, act: crewAction, train: (game, member) => startTraining(game, member) });
  }
  async function paintSpecialists(host) {
    const m = await import(asset('/apps/' + GAME_ID + '/staff.js'));
    if (screen !== 'driver' || staffTab !== 'specialists' || pview !== 'list') return;
    m.paintSpecialists(host, { G, t: _t, esc, money, skillCol, confirm: confirmGame, heading: pageHeading('ap_staff', 'ap_staff_hint', 'staff'), nav: staffNav(), bind: bindStaffNav,
      hall: trainingHall(), act: crewAction, train: (game, member) => startTraining(game, member) });
  }
  function paintPilotList(host) {
    const team=teamRoster(),locked=!!G.career.active_session;
    const cards=team.pilots.map(p=>`<button type="button" class="ap-roster-card ap-pilot-choice" data-select-pilot="${esc(p.id)}" aria-label="${esc(_t('ap_open_driver'))}: ${esc(p.name)}" ${locked&&p.id!==team.active_pilot?'disabled':''}>
      <div class="ap-pilot-identity"><span class="ap-pilot-avatar">${menuArt('helmet')}</span><span class="ap-pilot-name"><b>${esc(p.name)}</b><small>${esc(_t('ap_age',{n:p.age}))}</small></span><span class="ap-pilot-arrow" aria-hidden="true">↗</span></div>
      <div class="ap-roster-body"><div class="ap-pilot-facts"><div><small>${esc(_t('ap_overall'))}</small><strong>${p.overall.toFixed(1)}</strong></div><div><small>${esc(_t('ap_daily_salary'))}</small><strong>${money(p.salary)}</strong></div></div>
      <div class="ap-tags">${p.id===team.active_pilot?`<span>${esc(_t('ap_selected'))}</span>`:''}${team.cars.filter(car=>car.pilot_id===p.id).map(car=>`<span>${esc(carName(car))}</span>`).join('')}</div>
      <div class="ap-set-h"><span>${esc(_t('ap_driver_energy_label'))}</span><output>${Math.floor(p.energy)}%</output></div><div class="ap-meter ap-energy"><i style="width:${p.energy}%;background:${healthCol(1-p.energy/100)}"></i></div></div></button>`).join('');
    render(host, `${pageHeading('ap_staff','ap_staff_hint','staff')}${staffNav()}${trainingHall()}<p class="ap-hint ap-staff-hint">${esc(_t('ap_pilot_list_hint'))}</p><div class="ap-driverpg"><div class="ap-col">${cards?`<div class="ap-roster-grid">${cards}</div>`:`<div class="ap-card"><p class="ap-hint">${esc(_t('ap_need_driver'))}</p></div>`}</div><div class="ap-col">${recruitmentCard()}</div></div>`);
    bindCareer(host);bindStaffNav(host);
    host.querySelectorAll('[data-select-pilot]').forEach(b=>on(b, 'click',()=>selectRoster('pilot',b.dataset.selectPilot,b)));
  }
  function paintTeamTab(host) {
    render(host, `${pageHeading('ap_staff','ap_staff_hint','staff')}${staffNav()}<div class="ap-garage ap-team-top"><div class="ap-col">${teamNameCard()}${homeCircuitCard(false)}</div><div class="ap-col">${careerCard()}</div></div>`);
    bindCareer(host);bindTeamName(host);bindStaffNav(host);paintCircuitMaps(host);
    host.querySelector('[data-home-circuit]').onclick=()=>{teamView='builder';editEntry=true;go('team');};
  }
  function assignmentCard() {
    const team=teamRoster(), car=team.cars.find(c=>c.id===team.active_car),pilot=team.pilots.find(p=>p.id===car?.pilot_id);
    return `<div class="ap-assignment ap-assignment-in"><h3>${esc(_t('ap_car_driver'))}</h3><div class="ap-assigned-pilot">${menuArt('helmet')}<div><b>${esc(pilot?.name || _t('ap_no_assigned_driver'))}</b><p class="ap-hint">${esc(_t('ap_assignment_hint'))}</p></div></div>
      <label class="ap-hint" for="ap-assignment-pilot">${esc(_t('ap_tab_driver'))}</label><div class="ap-assignment-controls"><select id="ap-assignment-pilot" ${G.career.active_session?'disabled':''}><option value="">${esc(_t('ap_no_assigned_driver'))}</option>${team.pilots.map(p=>`<option value="${esc(p.id)}" ${p.id===car?.pilot_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="ap-btn" data-assign-pilot ${G.career.active_session?'disabled':''}>${esc(_t('ap_assign_driver'))}</button></div>${!car?.pilot_id?`<p class="ap-warn">${esc(_t('ap_assignment_required'))}</p>`:''}${!team.pilots.length?`<button class="ap-btn ap-ghost" data-pilots>${esc(_t('ap_tab_drivers'))} ▸</button>`:''}</div>`;
  }
  function bindAssignment(host) {
    bindRosterBack(host);
    on(host.querySelector('[data-pilots]'), 'click',()=>{pview='list';go('driver');});
    on(host.querySelector('[data-assign-pilot]'), 'click',async e=>{
      const button=e.currentTarget;button.disabled=true;
      try {
        if (!await flushSetup()) return;
        const r=await api('/team/assign',{car:teamRoster().active_car,pilot:host.querySelector('#ap-assignment-pilot').value || null});
        if(!r.ok){notifyGame(careerError(r.d.error));return;}
        setups={};adopt(r.d);paintStatus();paintCar();
      } finally {if(button.isConnected)button.disabled=false;}
    });
  }

  // ── the garage: first the car, then a circuit ──
  function paintGarage() {
    if (!G) return;
    if (gview === 'livery' && G.driver.has_car) { if (!garageView) paintLivery(); }
    else if (gview === 'cars') paintCarList($('#ap-garage'));
    else if (gview === 'setup' && G.driver.has_car) { closeGarageView(); paintSetup(); } else paintCar();
  }

  function leaveEdit() { editFrom = null; staffTab = 'team'; pview = 'list'; go('driver'); }
  async function paintBuilder() {
    closeVenueView();
    const host=$('#ap-team');if (!host.hasChildNodes()) render(host, `<div class="ap-empty">${esc(_t('ap_preparing'))}</div>`);
    const mod=await import(asset('/apps/'+GAME_ID+'/trackbuilder.js'));
    if(teamView!=='builder'||screen!=='team')return;
    if(builder)builder.destroy();
    let handle;
    handle=mod.openBuilder({host,G,api,t:_t,esc,money,
      onDone:(state,stay)=>{if(builder!==handle)return;adopt(state);paintStatus();handle.destroy();builder=null;teamView=stay?'builder':'overview';if(!stay&&editFrom){leaveEdit();return;}if(screen==='team')paintTeam();},
      onCancel:()=>{if(builder!==handle)return;handle.destroy();builder=null;teamView='overview';if(editFrom){leaveEdit();return;}paintTeam();},
      onVenueEdit:()=>{teamView='stands';paintTeam();}});
    builder=handle;
    host.insertAdjacentHTML('afterbegin',pageHeading('ap_tb_title','ap_team_page_hint','telemetry'));host.scrollTop=0;
  }
  async function paintVenue() {
    closeVenueView();const host=$('#ap-team'),revision=venueRevision;
    if (!host.hasChildNodes()) render(host, `<div class="ap-empty">${esc(_t('ap_preparing'))}</div>`);
    try{
      const editor=await import(asset('/apps/'+GAME_ID+'/venue.js'));
      if(revision!==venueRevision||teamView!=='stands'||screen!=='team')return;
      venueView=editor.openVenueEditor({host,G,api,t:_t,esc,money,
        onDone:state=>{adopt(state);builtTracks={};paintStatus();if(revision===venueRevision&&screen==='team'){teamView='builder';paintTeam();}},
        onCancel:()=>{teamView='builder';paintTeam();}});host.scrollTop=0;
    }catch(e){if(revision===venueRevision){teamView='builder';paintTeam();notifyGame(_t('ap_venue_err_stand_invalid'));}console.warn('Racelandia venue editor unavailable',e);}
  }

  async function paintLivery() {
    closeGarageView();
    const host=$('#ap-garage'), revision=garageRevision;
    if (!host.hasChildNodes()) render(host, `<div class="ap-empty">${esc(_t('ap_preparing'))}</div>`);
    try {
      const [M, editor]=await Promise.all([loadMods(),import(asset('/apps/' + GAME_ID + '/livery.js'))]);
      if(revision!==garageRevision||gview!=='livery'||screen!=='garage')return;
      const team=teamRoster(),car=team.cars.find(c=>c.id===team.active_car);
      garageView=editor.openLiveryEditor({host,car,other:team.cars.find(c=>c.id!==car.id),M,t:_t,esc,api,
        onSaved:state=>{adopt(state);paintStatus();if(revision===garageRevision){gview='car';paintGarage();}},
        onCancel:()=>{gview='car';paintGarage();}});
      host.scrollTop=0;
    } catch(e) {
      if(revision!==garageRevision)return;
      render(host, `<div class="ap-card"><p>${esc(_t('ap_livery_error'))}</p><button class="ap-btn" data-paint-back>${esc(_t('ap_cancel'))}</button></div>`);
      host.querySelector('[data-paint-back]').onclick=()=>{gview='car';paintGarage();};
      console.warn('Racelandia paint editor unavailable',e);
    }
  }

  function paintCircuitMaps(host) {
    host.querySelectorAll('[data-circuit-map]').forEach(el=>{
      const id=el.dataset.circuitMap,def=id==='own'?G.own:tracksCat?.[id],pts=def?.points;
      if(!pts?.length)return;
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),maxY=Math.max(...ys);
      const w=Math.max(...xs)-minX,h=maxY-Math.min(...ys),scale=Math.min(160/Math.max(w,1),90/Math.max(h,1));
      const x=p=>((p[0]-minX)*scale+(180-w*scale)/2).toFixed(1),y=p=>((maxY-p[1])*scale+(110-h*scale)/2).toFixed(1);
      const path=pts.filter((_,i)=>i%3===0).map((p,i)=>(i?'L':'M')+x(p)+','+y(p)).join(' ')+' Z';
      const start=pts[Math.round((def.start||0)*pts.length/Math.max(1,Math.round(def.length/3)))%pts.length];
      render(el, `<svg viewBox="0 0 180 110" aria-hidden="true" focusable="false"><path d="${path}"/><circle cx="${x(start)}" cy="${y(start)}" r="3.5"/></svg>`);
    });
  }

  function paintCar() {
    closeGarageView();
    const host = $('#ap-garage');
    const d = G.driver;
    if(!d.has_car){paintEmptyGarage(host);return;}
    const rows = Object.keys(G.parts).map(k => {
      const w = d.parts[k], info = G.parts[k], broken = w >= 0.999;
      const repairCost = G.lab.repair_cost?.[k] ?? Math.round(info.repair * Math.max(0.25, w) / 100) * 100;
      const dsg = G.lab.designs[k].find(x => x.id === G.lab.fitted[k]), dname = esc(_t('ap_part_' + k)) + (dsg && dsg.ver > 1 ? ' v' + dsg.ver : '');
      return `<div class="ap-part">
        <div class="ap-part-i">${menuArt(k)}</div>
        <div class="ap-part-b"><div class="ap-set-h"><label>${dname}</label><output style="color:${healthCol(w)}">${broken ? esc(_t('ap_broken')) : health(w) + '%'}</output></div>
          <div class="ap-meter"><i style="width:${health(w)}%;background:${healthCol(w)}"></i></div>
          <div class="ap-hint">${esc(_t('ap_parth_' + k))}</div></div>
        <div class="ap-part-a">
          <button class="ap-btn ap-sm ap-ghost" data-part="${k}" data-mode="repair" ${w < 0.03 || broken || G.career.active_session ? 'disabled' : ''}>${esc(_t('ap_repair_btn'))}<small>${money(repairCost)}</small></button>
          <button class="ap-btn ap-sm" data-replace-part="${k}" ${G.career.active_session ? 'disabled' : ''}>${esc(_t('ap_replace_btn'))}<small>${G.warehouse.parts.filter(u => u.part === k).length} ${esc(_t('ap_in_warehouse'))}</small></button>
        </div></div>`;
    }).join('');
    render(host, `${rosterBack('cars')}${pageHeading('ap_tab_garage', 'ap_paddock_garage', 'frontWing')}<div class="ap-garage ap-garage-one">
      <div class="ap-col"><div class="ap-card"><div class="ap-bar"><h2>${esc(_t('ap_car_title'))}</h2><button class="ap-btn ap-sm ap-ghost" data-edit-livery ${G.career.active_session?'disabled':''}>${esc(_t('ap_livery_title'))}</button></div><div class="ap-car-preview" aria-label="${esc(_t('ap_car_title'))}" aria-busy="true"><div class="ap-car-loading" role="status">${esc(_t('ap_car_loading'))}</div></div>
        <div class="ap-hint">${esc(_t('ap_parts_hint'))}</div>${assignmentCard()}</div>
        <div class="ap-card"><h3>${esc(_t('ap_parts'))}</h3><div class="ap-equipment">${rows}</div></div></div></div>`);
    bindCareer(host);bindAssignment(host);paintCircuitMaps(host);
    host.querySelector('[data-edit-livery]').onclick=()=>{gview='livery';paintGarage();};
    const preview = host.querySelector('.ap-car-preview'), revision = garageRevision;
    const previewFailed = e => {
      if (revision !== garageRevision || !preview.isConnected) return;
      preview.querySelector('canvas')?.remove();
      preview.setAttribute('aria-busy', 'false');
      const status=preview.querySelector('.ap-car-loading');
      if (status) status.textContent=_t('ap_no_webgl');
      console.warn('Racelandia car preview unavailable', e);
    };
    loadMods().then(M => {
      if (revision !== garageRevision || !preview.isConnected || screen !== 'garage') return;
      paintCircuitMaps(host);
      let next;
      try {
        next = M.VIEW.createGarageView(M.THREE, preview, { low: matchMedia('(pointer:coarse)').matches, compound, livery: teamRoster().cars.find(c=>c.id===teamRoster().active_car)?.livery });
        preview.querySelector('.ap-car-loading')?.remove();
        preview.setAttribute('aria-busy', 'false');
        garageView = next;
      } catch (e) {
        if (next) next.destroy();
        previewFailed(e);
      }
    }).catch(previewFailed);
    // A part is replaced from the warehouse; what is not there is produced in Development first.
    host.querySelectorAll('[data-replace-part]').forEach(b => on(b, 'click', () => {
      const k = b.dataset.replacePart, units = G.warehouse.parts.filter(u => u.part === k);
      const list = units.map(u => {
        const dsg = G.lab.designs[k].find(x => x.id === u.design), left = Math.round((1 - u.wear) * 100);
        return `<div class="ap-offer"><div><b>${esc(_t('ap_part_' + k))}${dsg && dsg.ver > 1 ? ' v' + dsg.ver : ''}</b><div class="ap-hint">${esc(_t('ap_condition'))}: <span style="color:${healthCol(u.wear)}">${left}%</span></div></div>
          <button class="ap-btn ap-sm" data-fit-unit="${esc(u.id)}">${esc(_t('ap_wh_fit'))}</button></div>`;
      }).join('');
      const m = modal(`<div class="ap-dlg"><div class="ap-bar"><h2>${esc(_t('ap_replace_title', { part: _t('ap_part_' + k) }))}</h2><button class="ap-btn ap-sm ap-ghost" id="ap-rp-x">✕</button></div>
        ${units.length ? `<p class="ap-hint">${esc(_t('ap_replace_hint'))}</p>${list}` : `<p class="ap-warn">${esc(_t('ap_replace_none', { part: _t('ap_part_' + k) }))}</p><button class="ap-btn" id="ap-rp-lab">${esc(_t('ap_go_lab'))}</button>`}</div>`);
      on($('#ap-rp-x', m), 'click', () => modal(''));
      on($('#ap-rp-lab', m), 'click', () => { modal(''); go('lab'); });
      m.querySelectorAll('[data-fit-unit]').forEach(f => on(f, 'click', async () => {
        f.disabled = true;
        const ok = await warehouseAction('/warehouse/fit', { unit: f.dataset.fitUnit });
        modal('');
        if (ok) paintGarage();
      }));
    }));
    host.querySelectorAll('[data-part]').forEach(b => on(b, 'click', async () => {
      b.disabled = true;
      const r = await api('/parts', { part: b.dataset.part, mode: b.dataset.mode });
      if (r.d && r.d.driver) { G.driver = r.d.driver; paintStatus(); }
      if (!r.ok) notifyGame(_t(r.d.error === 'busy' ? 'ap_active_run_hint' : r.d.error === 'budget' ? 'ap_no_budget' : r.d.error === 'broken' ? 'ap_broken_hint' : 'ap_part_err'));
      paintCar();
    }));
  }

  async function loadHistory() {
    if (histTrack === curTrack) return;
    histTrack = curTrack;
    const r = await api('/runs?track=' + encodeURIComponent(curTrack));
    history = r.ok ? r.d.runs : [];
    if (r.ok) { const t = tinfo(); t.bests = r.d.bests; }
    if (screen === 'garage' && gview === 'setup') { paintReco(); paintHistory(); }
  }

  // plus / minus beside a setup slider: one step of the slider per press
  function nudgeWire(root) {
    root.querySelectorAll('.ap-nudge').forEach(b => on(b, 'click', () => {
      const i = b.parentNode.querySelector('input[type=range]'); if (!i || i.disabled) return;
      i.value = String(Math.round((+i.value + (+b.dataset.nudge) * (+i.step || 1)) * 1e4) / 1e4);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  }

  function paintSetup() {
    const host = $('#ap-garage');
    const t = tinfo(), c = cond(cfg.hour), S = setup(), locked=!!G.division?.locked_setup;
    const rec = recShown(c);
    const groups = GROUPS.map(gr => {
      const items = G.defs.filter(d => d.group === gr).map(d => `<div class="ap-set" data-k="${d.key}">
          <div class="ap-set-h"><label>${esc(_t('ap_s_' + d.key))}</label><output>${fmtSet(d, S[d.key])}</output></div>
          <div class="ap-step"><button type="button" class="ap-nudge" data-nudge="-1" ${locked?'disabled':''} aria-label="−">−</button><div class="ap-range"><i class="ap-advice" hidden></i><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${S[d.key]}" data-k="${d.key}" ${locked?'disabled':''}></div><button type="button" class="ap-nudge" data-nudge="1" ${locked?'disabled':''} aria-label="+">+</button></div>
          <div class="ap-hint">${esc(_t('ap_h_' + d.key))}</div></div>`).join('');
      return `<div class="ap-grp"><h3 class="ap-group-title">${menuArt(({aero:'frontWing',chassis:'suspension',tyres:'tyre-M',drive:'engine'})[gr])}${esc(_t('ap_g_' + gr))}</h3>${items}</div>`;
    }).join('');
    const comps = G.compounds.map(k => `<button class="ap-comp${k === compound ? ' on' : ''}" data-c="${k}">
        ${k === rec ? `<span class="ap-rec">★ ${esc(_t('ap_suggested'))}</span>` : ''}<i style="background:${ICON[k]}"></i><b>${esc(_t('ap_c_' + k))}</b><small>${esc(_t('ap_ch_' + k))}</small><em>${money(G.tyre_cost[k])}</em></button>`).join('');
    const hours = G.hours.map(h => { const x = cond(h); return `<button class="ap-hr${h === cfg.hour ? ' on' : ''}" data-h="${h}" ${canChange() ? '' : 'disabled'}><b>${esc(hourStr(h))}</b><span>${sky(x)}</span><small>${Math.round(x.air)}°</small></button>`; }).join('');
    void comps; void hours;
    const team=teamRoster(),car=team.cars.find(x=>x.id===team.active_car),pilot=team.pilots.find(p=>p.id===car?.pilot_id);
    if (setupPage === 'car' && car) {
      // the open car: its setup and its tyres, without the lap time statistics
      render(host, `${pageHeading('ap_setup', 'ap_setup_track_hint', 'suspension')}<div class="ap-garage ap-garage-one">
        <div class="ap-col ap-setups">
          <div class="ap-bar"><div><button class="ap-btn ap-sm ap-ghost" id="ap-back">◂ ${esc(_t('ap_back'))}</button> <b class="ap-title2">${esc(trackName(t.id))} · ${esc(pilot?.name||_t('ap_no_assigned_driver'))} · ${esc(carName(car))}</b></div><button class="ap-btn ap-sm ap-ghost" id="ap-reset" ${locked?'disabled':''}>${esc(_t('ap_reset'))}</button></div>
          <div class="ap-hint">${esc(_t(locked?'ap_parc_ferme':'ap_setup_track_hint'))}</div>
          <div class="ap-hint" data-advice-basis></div>
          <div class="ap-card" id="ap-cartyres"></div>
          <div class="ap-setup-groups">${groups}</div>
        </div></div>`);
      nudgeWire(host);
      host.querySelectorAll('input[data-k]').forEach(i => on(i, 'input', () => {
        const d = G.defs.find(x => x.key === i.dataset.k), cur = setup(); cur[d.key] = +i.value;
        i.closest('.ap-set').querySelector('output').textContent = fmtSet(d, +i.value);
        paintAdvice(host);
        queueSetupSave(curTrack, cur);
      }));
      on($('#ap-back', host), 'click', () => { setupPage = 'cars'; paintGarage(); host.scrollTop = 0; });
      on($('#ap-reset', host), 'click', () => { const cur = setup(); G.defs.forEach(d => { cur[d.key] = d.def; }); queueSetupSave(curTrack, cur); flushSetup(); paintGarage(); });
      paintCarTyres(host);
      loadAna().then(() => { if (host.isConnected) paintAdvice(host); });
      return;
    }
    if (setupPage === 'stats') {
      // the lap time statistics of this circuit: the team's advice, the record and what was tried here
      render(host, `${pageHeading('ap_tab_stats', 'ap_setup_track_hint', 'telemetry')}<div class="ap-garage ap-garage-one">
        <div class="ap-col ap-session">
          <div class="ap-bar"><div><button class="ap-btn ap-sm ap-ghost" id="ap-back">◂ ${esc(_t('ap_back'))}</button> <b class="ap-title2">${esc(trackName(t.id))} · ${esc(pilot?.name||_t('ap_no_assigned_driver'))} · ${car?esc(carName(car)):''}</b></div></div>
          <div class="ap-card" id="ap-reco" data-ui-preserve></div>
          <div class="ap-card" id="ap-hist" data-ui-preserve></div>
          ${multi ? boardHtml() : ''}
        </div></div>`);
      on($('#ap-back', host), 'click', () => { setupPage = 'cars'; paintGarage(); host.scrollTop = 0; });
      paintReco(); paintHistory(); loadHistory();
      return;
    }
    setupPage = 'cars';
    render(host, `${pageHeading('ap_setup', 'ap_setup_track_hint', 'suspension')}<div class="ap-garage ap-garage-one">
      <div class="ap-col ap-session">
        <div class="ap-bar"><div><button class="ap-btn ap-sm ap-ghost" id="ap-back">◂ ${esc(_t('ap_back'))}</button> <b class="ap-title2">${esc(trackName(t.id))}</b></div></div>
        <div class="ap-card" id="ap-sess" data-ui-preserve></div>
        ${multi ? boardHtml() : ''}
      </div></div>`);
    on($('#ap-back', host), 'click', () => { gview = 'cars'; setupPage = 'cars'; screenCache.delete('garage'); go(setupFrom); });
    paintSession();
  }

  // What the team advises before the car goes out: the setup of this driver's best run on this circuit,
  // how it differs from the one now, and who holds the circuit record.
  // The team's advised range for each setting is drawn on the slider itself, around the driver's best run here.
  let anaMod = null;
  async function loadAna() { if (!anaMod) { await loadSim(); anaMod = await import(asset('/apps/' + GAME_ID + '/analysis.js')); } return anaMod; }
  // The same advice for every kind of session: the pool of what this driver did here, judged against the weather now.
  function adviceFor(ANA, run, rows, trackId, c) {
    const adv = ANA.advise(G.tracks.find(t => t.id === trackId)?.bests?.pool, c, G.defs, G.tracks.find(t => t.id === trackId)?.bests?.now);
    return ANA.suggestions(run, rows, G.defs, adv.prior, { scale: adv.scale, weight: adv.weight, narrow: FX ? FX.rangeFactor(lvl('engineer')) : 1, floor: FX ? FX.rangeFloor(lvl('engineer')) : 1.2 });
  }
  function paintAdvice(host) {
    if (!anaMod || !host) return;
    const adv = anaMod.advise(tinfo().bests?.pool, cond(cfg.hour), G.defs, tinfo().bests?.now, simMod.MODE_F);
    // the fuel follows the laps chosen for this session (the outlap counts), at the consumption seen here before
    const fuel = { perLap: adv.fuelLap, laps: sessLaps() + 1, modeF: simMod.MODE_F };
    const items = Object.fromEntries(anaMod.suggestions({ setup: setup(), P: { comp: { Topt: 0 } } }, [], G.defs, adv.prior, { scale: adv.scale, weight: adv.weight, fuel, narrow: FX ? FX.rangeFactor(lvl('engineer')) : 1, floor: FX ? FX.rangeFloor(lvl('engineer')) : 1.2 }).items.map(it => [it.key, it]));
    const basis = host.querySelector('[data-advice-basis]');
    if (basis) basis.textContent = _t(adv.laps ? 'ap_advice_basis' : 'ap_advice_none', { n: adv.laps });
    host.querySelectorAll('.ap-set[data-k]').forEach(row => {
      const it = items[row.dataset.k], bar = row.querySelector('.ap-advice'); let tag = row.querySelector('.ap-advice-tag');
      if (it) tag?.remove();
      row.querySelector('.ap-range').classList.toggle('has-advice', !!it);
      if (!it) {
        bar.hidden = true;
        if (row.dataset.k !== 'fuel') { tag?.remove(); return; }
        if (!tag) { tag = document.createElement('small'); tag.className = 'ap-advice-tag'; row.querySelector('.ap-step').after(tag); }
        tag.textContent = _t('ap_an_no_fuel_data');
        return;
      }
      const span = it.max - it.min;
      bar.hidden = false; bar.style.left = (it.lo - it.min) / span * 100 + '%'; bar.style.width = Math.max(2, (it.hi - it.lo) / span * 100) + '%';
      row.classList.toggle('in-range', it.inRange);
    });
  }
  // the best run of the open car on this circuit, from its own history
  function carAdvice(b) {
    const team = teamRoster(), id = team.active_car;
    const mine = history.filter(r => r.car === id && r.best != null).sort((x, y) => x.best - y.best)[0];
    return mine ? { setup: mine.setup, best: mine.best, compound: mine.compound, air: mine.air, water: mine.water, at: mine.at } : null;
  }
  function paintReco() {
    const box = $('#ap-reco'); if (!box) return;
    const b = tinfo().bests || {}, a = carAdvice(b), S = setup(), c = cond(cfg.hour), locked = !!G.division?.locked_setup;
    let html = `<h2>🧑‍🔧 ${esc(_t('ap_reco_title'))}</h2>`;
    if (a) {
      const diff = G.defs.filter(d => Math.abs((a.setup[d.key] ?? d.def) - (S[d.key] ?? d.def)) > 1e-9).length;
      html += `<p><b>${esc(_t('ap_reco_best', { time: lapStr(a.best) }))}</b> · <i class="ap-dot" style="background:${ICON[a.compound]}"></i> ${sky({ rain: a.water > 0.5 ? 0.6 : a.water > 0.05 ? 0.2 : 0, cloud: 0.3 })} ${Math.round(a.air)}°</p><div class="ap-chips">${setupChips(a.setup)}</div>`;
      html += diff ? `<p class="ap-hint">${esc(_t('ap_reco_diff', { n: diff }))}</p><button class="ap-btn ap-sm" data-reco-use ${locked ? 'disabled' : ''}>${esc(_t('ap_reco_use'))}</button>` : `<p class="ap-hint">${esc(_t('ap_reco_same'))}</p>`;
      if (c.water > 0.3 && !(a.water > 0.3)) html += `<p class="ap-hint">⚠️ ${esc(_t('ap_reco_wet'))}</p>`;
      else if (!(c.water > 0.3) && a.water > 0.3) html += `<p class="ap-hint">⚠️ ${esc(_t('ap_reco_dry'))}</p>`;
    } else html += `<p class="ap-hint">${esc(_t('ap_reco_none'))}</p>`;
    if (b.record_by && b.record != null) html += `<p class="ap-hint">🏆 ${esc(_t(b.record_by.mine ? 'ap_reco_record_you' : 'ap_reco_record', { time: lapStr(b.record), who: b.record_by.who || '—' }))}</p>`;
    render(box, html);
    on(box.querySelector('[data-reco-use]'), 'click', () => {
      setups[curTrack] = Object.assign({}, a.setup);
      queueSetupSave(curTrack, setups[curTrack]); flushSetup(); paintGarage();
    });
  }

  // Which of the cars go out, and with which driver: tick one or both; each car shows its tyres and setup at a glance
  // and opens its own setup page when clicked.
  function ensureCarSets(live, rec) {
    const team = teamRoster(), taken = new Set(), marked = markedIds();
    [...marked, ...team.cars.map(c => c.id).filter(id => !marked.includes(id))].forEach(id => {
      let sid = carSets[id];
      if (!sid || !live.some(t => t.id === sid) || taken.has(sid)) { sid = suggestPracticeSet(rec, taken)?.id || null; carSets[id] = sid; }
      if (sid) taken.add(sid);
    });
  }
  function carsOverviewHtml(live) {
    const team=teamRoster(),ids=markedIds(),locked=!!G.career.active_session,many=team.cars.length>1,cb=tinfo().bests?.car_bests||{};
    return `<h3>${esc(_t('ap_test_car'))}</h3><div class="ap-teamcars ap-trackcars">${team.cars.map(car=>{
      const pilot=team.pilots.find(p=>p.id===car.pilot_id),on=ids.includes(car.id),t=live.find(x=>x.id===carSets[car.id]);
      return `<div class="ap-teamcar${on?' on':''}">${many?`<label class="ap-markbox"><input type="checkbox" data-mark-car="${esc(car.id)}" ${on?'checked':''} ${locked?'disabled':''} aria-label="${esc(_t('ap_selected'))}"></label>`:''}<div class="ap-carwrap"><button class="ap-teamcar-body" data-test-car="${esc(car.id)}" ${locked?'disabled':''}><b>${esc(pilot?.name||_t('ap_no_assigned_driver'))}</b><span>${esc(carName(car))} · ${esc(_t('ap_car_level',{n:car.level}))}</span>
        <em class="ap-carcomp">${t?`<i class="ap-dot" style="background:${ICON[t.compound]}"></i>${esc(t.id)} · ${esc(_t('ap_c_'+t.compound))}`:esc(_t('ap_both_need_sets'))}</em>
        <span class="ap-setupchips">${setupChips(carSetupOf(car.id))}</span>${pilot?'':`<small class="ap-warn">${esc(_t('ap_both_need_driver'))}</small>`}<small>${esc(_t('ap_setup'))} ▸</small></button>
        <div class="ap-carfoot"><span>${esc(_t('ap_fastest_lap'))}<b>${lapStr(cb[car.id])}</b></span><button class="ap-btn ap-sm ap-ghost" data-car-stats="${esc(car.id)}" ${locked?'disabled':''}>${esc(_t('ap_tab_stats'))}</button></div></div></div>`;}).join('')}</div>`;
  }
  // The tyre sets of the open car, on its own setup page.
  function paintCarTyres(host) {
    const box=host.querySelector('#ap-cartyres');if(!box)return;
    const team=teamRoster(),id=team.active_car,live=G.warehouse.tyres.filter(t=>Math.max(...t.wear)<.98),rec=recShown(cond(cfg.hour));
    ensureCarSets(live,rec);
    const held={};markedIds().filter(x=>x!==id).forEach(x=>{if(carSets[x])held[carSets[x]]=team.cars.findIndex(c=>c.id===x)+1;});
    const sets=live.length?tyreSetsHtml({tyres:live},carSets[id],'data-carset',rec,true,held):`<p class="ap-warn">${esc(_t('ap_both_need_sets'))}</p>`;
    render(box, `<div class="ap-mate" data-carset-box="${esc(id)}"><h3>${esc(_t('ap_tyres'))}</h3>${sets}<p class="ap-hint">${esc(_t('ap_wh_practice_hint'))}</p><button class="ap-btn ap-sm ap-ghost" data-open-warehouse>${esc(_t('ap_wh_open'))}</button></div>`);
    box.querySelectorAll('[data-carset]').forEach(b=>on(b,'click',()=>{const want=b.dataset.carset,holder=team.cars.map(c=>c.id).find(x=>x!==id&&carSets[x]===want);if(holder)carSets[holder]=carSets[id];carSets[id]=want;paintCarTyres(host);}));
    on(box.querySelector('[data-open-warehouse]'),'click',()=>go('warehouse'));
  }
  function trackSummaryHtml() {
    const b=tinfo().bests||{};
    return `<div class="ap-track-sum"><div class="ap-cond"><div><span>${esc(_t('ap_track_record'))}</span><b>${lapStr(b.record)}${b.record_by&&b.record_by.who?' · '+esc(b.record_by.who):''}</b></div></div></div>`;
  }

  function paintSession(light) {
    const box=$('#ap-sess');if(!box)return;
    const career=G.career,c=cond(cfg.hour);
    const need=costNow(),en=energyNow(),rec=recShown(c),d=G.driver;
    const okMoney=d.budget>=need;
    const worn=Object.keys(G.parts).filter(k=>d.parts[k]>=.7);
    const live=G.warehouse.tyres.filter(t=>Math.max(...t.wear)<.98);
    const ids=markedIds(),team=teamRoster();
    ensureCarSets(live,rec);
    const ready=ids.length>0&&ids.every(id=>team.cars.find(c=>c.id===id)?.pilot_id&&carSets[id]);
    if(light){const cb=$('.ap-cost b',box);if(cb){cb.textContent=curTrack==='own'?_t('ap_free'):money(need);cb.className=okMoney?'':'ap-bad';}const send=$('#ap-send',box);if(send)send.disabled=!(ready&&okMoney&&d.has_car&&!career.active_session&&!G.division?.locked_setup&&!busy);const panel=$('[data-driver-energy]',box);if(panel)panel.outerHTML=driverEnergy(en);return;}
    const tyreHint=live.length?`<p class="ap-hint">${esc(_t('ap_wh_practice_hint'))}</p>`:`<p class="ap-warn">${esc(_t('ap_wh_practice_empty'))}</p>`;
    const hours=G.hours.length?Array.from({length:Math.max(1,24-cfg.hour)},(_,i)=>cfg.hour+i).map(h=>{const x=cond(h),half=wxH(),now=h===cfg.hour,rg=FX&&!now?FX.wxRange(rainPct(x),'h'+h,half):null;return `<div class="ap-hr${now?' on':''}"><b>${esc(now?_t('ap_now'):hourStr(h))}</b><span>${now||(rg&&rg.exact)?sky(x):rg?chanceIcon((rg.mid??rg.lo)/100):'·'}</span><small>${now||half!=null?Math.round(x.air)+'°':'·'}</small></div>`;}).join(''):'';
    const free=curTrack==='own';
    const outlook=simMod&&FX?`<h3>${esc(_t('ap_wx_next_hour'))}</h3>${FX.wxShortOn(wxH())?wxStepsHtml(wxOutlook(simMod,G.forecast,nowFrac()),nowFrac()):''}<p class="ap-hint">${esc(wxAheadText(simMod,G.forecast,nowFrac(),wxOutlook(simMod,G.forecast,nowFrac()),60))}</p>`:'';
    render(box, `<h2>🧪 ${esc(_t('ap_practice'))}</h2><p class="ap-hint">${esc(_t('ap_test_description'))}</p>
      ${carsOverviewHtml(live)}${trackSummaryHtml()}
      <h3>${esc(_t('ap_laps'))}: <b id="ap-laps-v">${cfg.laps}</b></h3><input type="range" id="ap-laps" min="${G.laps.min}" max="${G.laps.max}" step="1" value="${cfg.laps}" ${canChange()?'':'disabled'}><div class="ap-hint">${esc(_t('ap_laps_hint'))}</div><h3>${esc(_t('ap_time'))}</h3><div class="ap-hours">${hours}</div>${outlook}<div class="ap-hint">${esc(G.live ? _t('ap_live_weather', { place: trackName(curTrack) }) : _t('ap_sim_weather'))} ${esc(_t('ap_test_now_hint'))}</div>
      <div class="ap-cond"><div><span>${esc(_t('ap_air'))}</span><b>${c.air.toFixed(0)}°C</b></div><div><span>${esc(_t('ap_asphalt'))}</span><b>${c.track.toFixed(0)}°C</b></div><div><span>${esc(_t('ap_water'))}</span><b>${c.water>.02?c.water.toFixed(1)+' mm':esc(_t('ap_dry'))}</b></div><div><span>${esc(_t('ap_rubber'))}</span><b>${(c.rubber*100).toFixed(1)}%</b></div></div>
      <div class="ap-tip">${esc(_t(tipKey(c)))}</div>
      ${tyreHint}<button class="ap-btn ap-sm ap-ghost" data-open-warehouse>${esc(_t('ap_wh_open'))}</button>
      ${worn.length?`<div class="ap-tip ap-tipwarn">⚠️ ${esc(_t('ap_worn_warn',{list:worn.map(k=>_t('ap_part_'+k)+' '+health(d.parts[k])+'%').join(', ')}))}</div>`:''}
      <div class="ap-cost"><span>${esc(_t('ap_cost'))}</span><b class="${okMoney?'':'ap-bad'}">${free?esc(_t('ap_free')):money(need)}</b></div>${driverEnergy(en)}
      <button class="ap-btn ap-go" id="ap-send" ${ready&&okMoney&&d.has_car&&!career.active_session&&!G.division?.locked_setup&&!busy?'':'disabled'}>${esc(_t(ids.length>1?'ap_send_cars':'ap_send'))}</button>
      ${!d.has_driver?`<p class="ap-warn">${esc(_t('ap_need_driver'))}</p>`:''}${activeRunPanel()}
      ${!okMoney?`<p class="ap-warn">${esc(_t('ap_no_budget'))}</p>`:''}`);
    const openCarPage=async(id,page)=>{if(!markedCars)markedCars=markedIds();const host=$('#ap-garage');if(id!==teamRoster().active_car){const r=await openCar(id);if(!r)return;setups={};weekendSet=null;weekendSet2=null;adopt(r.d);paintStatus();}setupPage=page;statsCar=id;paintGarage();host.scrollTop=0;};
    box.querySelectorAll('[data-test-car]').forEach(b=>b.onclick=()=>{b.disabled=true;openCarPage(b.dataset.testCar,'car').finally(()=>{if(b.isConnected)b.disabled=false;});});
    box.querySelectorAll('[data-car-stats]').forEach(b=>b.onclick=()=>{b.disabled=true;openCarPage(b.dataset.carStats,'stats').finally(()=>{if(b.isConnected)b.disabled=false;});});
    box.querySelectorAll('[data-mark-car]').forEach(b=>on(b, 'change',()=>{const id=b.dataset.markCar,now=markedIds();markedCars=now.includes(id)?now.filter(x=>x!==id):[...now,id];paintSession();}));
        const laps=$('#ap-laps',box);
    if(laps){on(laps, 'input',()=>{cfg.laps=+laps.value;$('#ap-laps-v').textContent=cfg.laps;paintSession(true);});on(laps, 'change',()=>{mp.send({type:'ap_cfg',laps:cfg.laps,hour:cfg.hour});paintSession();});}
    on(box.querySelector('[data-open-warehouse]'), 'click',()=>go('warehouse'));
    on($('#ap-send',box), 'click',sendOut);bindResume(box);
  }

  function setupChips(s) {
    return `<span title="${esc(_t('ap_g_aero'))}">${s.frontWing}/${s.rearWing}</span><span title="${esc(_t('ap_s_rideF'))}">${s.rideF}/${s.rideR}</span>
      <span title="${esc(_t('ap_s_brakeBias'))}">${s.brakeBias}%</span><span title="${esc(_t('ap_s_diff'))}">${s.diff}%</span><span title="${esc(_t('ap_s_fuel'))}">${litres(s.fuel)} L</span>`;
  }
  function resultCell(r) {
    if(r.weekend?.phase==='race'){const own=r.weekend.classification.find(c=>isMine(c.id)&&c.position===r.position)||r.weekend.classification.find(c=>isMine(c.id));return `<b>P${r.position||own.position}${own.dnf?' · DNF':''}</b> <small>${money(r.prize)}</small>`;}
    if (r.dnf) return `<em class="ap-bad">${esc(_t('ap_dnf'))}</em>`;
    if(r.qualification?.medal)return `<b>${esc(_t('ap_medal_'+r.qualification.medal))}</b> <small>${money(r.prize)}</small>`;
    if (r.kind === 'race' && r.position) return `<b>P${r.position}</b> <small>${money(r.prize)}</small>`;
    return r.best != null ? `<b>${lapStr(r.best)}</b>` : '–';
  }
  function sessionCardHtml(r) {
    const title = r.weekend ? _t('ap_round', { n: r.weekend.round }) + ' · ' + _t('ap_phase_' + r.weekend.phase)
      : _t(r.kind === 'qualifying' ? 'ap_qualifying' : r.kind === 'race' ? 'ap_race' : 'ap_practice');
    return `<span class="ap-record-head"><span class="ap-record-art">${menuArt('tyre-' + r.compound)}</span><span><b>${esc(title)}</b><small>${esc(dateStr(r.at))} · ${esc(_t('ap_c_' + r.compound))}</small></span><span class="ap-record-result">${resultCell(r)}</span></span>
      <span class="ap-record-metrics"><span>${esc(_t('ap_laps'))}<b>${r.laps}</b></span><span>${esc(_t('ap_points'))}<b>${r.points || '–'}</b></span><span>${esc(_t('ap_h_cond'))}<b>${sky({ rain: r.water > 0.5 ? 0.6 : r.water > 0.05 ? 0.2 : 0, cloud: 0.3 })} ${Math.round(r.air)}°${r.asphalt == null ? '' : ' / ' + Math.round(r.asphalt) + '°'}</b></span></span>
      <span class="ap-chips ap-record-setup">${setupChips(r.final_setup || r.setup)}</span>`;
  }
  function paintHistory() {
    const box = $('#ap-hist'); if (!box) return;
    const rows = history.filter(r => r.car === teamRoster().active_car).slice(0, 12).map((r, i) => `<div class="ap-session-record">${sessionCardHtml(r)}
      <button class="ap-btn ap-sm ap-ghost" data-use="${i}" ${G.division?.locked_setup?'disabled':''}>${esc(_t('ap_use_setup'))}</button></div>`).join('');
    render(box, `<h3>${esc(_t('ap_history'))}</h3>` + (rows
      ? `<div class="ap-session-records">${rows}</div><div class="ap-hint">${esc(_t('ap_history_hint'))}</div>`
      : `<div class="ap-hint">${esc(_t('ap_no_runs'))}</div>`));
    box.querySelectorAll('[data-use]').forEach(b => on(b, 'click', () => {
      const r = history[+b.dataset.use]; setups[curTrack] = Object.assign({}, r.setup);
      api('/setup', { track: curTrack, setup: setups[curTrack] }); paintGarage();
    }));
  }

  // Fuel is simulated in kilograms; the player sees litres.
  const FUEL_KG_PER_L = 0.75, litres = kg => Math.round(kg / FUEL_KG_PER_L);
  function fmtSet(d, v) { if (d.key === 'fuel') return litres(+v) + ' L'; const n = d.step < 1 ? (+v).toFixed(1) : Math.round(v); return n + (d.unit ? ' ' + d.unit : ''); }
  function tipKey(c) {
    if (c.water > 1.2) return 'ap_tip_wet';
    if (c.water > 0.08 || c.rain > 0.2) return 'ap_tip_damp';
    if (c.track < 22) return 'ap_tip_cold';
    if (c.track > 44) return 'ap_tip_hot';
    return 'ap_tip_ok';
  }
  function boardHtml() {
    return `<div class="ap-card"><h3>${esc(_t('ap_board'))}</h3><table class="ap-table">${board.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${esc(r.name)}${r.running ? ' 🏎️' : ''}${r.done ? ' ✔' : ''}</td><td>${r.best != null ? lapStr(r.best) : '–'}</td><td>${r.points}</td></tr>`).join('')}</table></div>`;
  }

  // ── the driver ──
  function paintDriver() {
    const host = $('#ap-driver');
    if (!G) return;
    if(pview==='list'){if(staffTab==='crew')paintCrew(host);else if(staffTab==='specialists')paintSpecialists(host);else if(staffTab==='team')paintTeamTab(host);else paintPilotList(host);return;}
    const d = G.driver;
    if(!d.has_driver){render(host, `${pageHeading('ap_tab_driver', 'ap_paddock_driver', 'helmet')}<div class="ap-driverpg"><div class="ap-col"><div class="ap-card"><p class="ap-hint">${esc(_t('ap_need_driver'))}</p></div></div><div class="ap-col">${recruitmentCard(true)}</div></div>`);bindCareer(host);return;}
    const bars = G.skills.map(k => {
      const v = d.skills[k], gain = lastGains && lastGains[k];
      return `<button type="button" class="ap-skill ap-skill-link" data-train-skill="${k}" title="${esc(_t('ap_training'))}"><div class="ap-set-h"><span>${esc(_t('ap_k_' + k))}</span><output>${v.toFixed(1)}${gain ? ` <em class="${gain < 0 ? 'neg' : ''}">${gain > 0 ? '+' : ''}${gain.toFixed(2)}</em>` : ''}</output></div>
        <div class="ap-meter"><i style="width:${Math.min(100, v)}%;background:${skillCol(v)}"></i></div></button>`;
    }).join('');
    const stars = '★'.repeat(Math.max(0, Math.floor(d.stars))) + (d.stars % 1 >= 0.5 ? '½' : '') + '☆'.repeat(Math.max(0, 5 - Math.ceil(d.stars)));
    const cards = G.games.map(g => `<div class="ap-train" data-training-game="${g}" tabindex="-1">
        <div class="ap-train-i">${GAMEICON[g]}</div>
        <div class="ap-train-b"><b>${esc(_t('ap_tr_' + g))}</b><p>${esc(_t('ap_trd_' + g))}</p>
        <div class="ap-hint"></div><div class="ap-tags">${GAMESKILLS[g].map(k => `<span>${esc(_t('ap_k_' + k))}</span>`).join('')}</div></div>
        <button class="ap-btn ap-sm" data-g="${g}" ${d.energy >= G.costs.train_energy && !G.career.active_session && G.training_hall?.remaining ? '' : 'disabled'}>${esc(_t('ap_train'))}<small>⚡ ${G.costs.train_energy}%</small></button></div>`).join('');
    render(host, `${rosterBack('pilots')}${pageHeading('ap_tab_driver', 'ap_paddock_driver', 'helmet')}${trainingHall()}<div class="ap-driverpg">
      <div class="ap-col"><div class="ap-card">
        <div class="ap-bar"><h2>${esc(_t('ap_tab_driver'))}</h2></div>
        <div class="ap-who"><div class="ap-avatar">${menuArt('helmet')}</div><div>
          <input id="ap-name" maxlength="24" value="${esc(d.name)}"><div class="ap-hint">${esc(_t('ap_age', { n: d.age }))} · ${esc(_t('ap_potential'))}: <span class="ap-stars">${stars}</span> · ${esc(_t('ap_overall'))} ${d.overall.toFixed(1)}</div></div></div>
        <div class="ap-meter ap-energy"><i style="width:${d.energy}%"></i></div>${driverEnergy()}
        <p class="ap-hint">${esc(_t('ap_start_effect',{n:d.start_reaction_ms,e:Math.round((d.driving_energy_factor??1)*100)}))}</p>${characterHtml(d.character)}<p class="ap-hint">${esc(_t('ap_aging_hint'))}</p>${d.aging ? `<p class="ap-warn">${esc(_t('ap_aging_decline'))}</p>` : ''}<div class="ap-skills">${bars}</div>
      </div></div>
      <div class="ap-col">${recruitmentCard()}<div class="ap-card"><div class="ap-bar"><h2>${esc(_t('ap_training'))}</h2></div><div class="ap-hint">${esc(_t('ap_training_hint'))}</div>${cards}</div></div></div>`);
    bindCareer(host);bindRosterBack(host);
    on($('#ap-name', host), 'change', async e => { const r = await api('/name', { name: e.target.value }); if (r.ok) { G.driver = r.d.driver; paintStatus(); } });
    host.querySelectorAll('button[data-g]').forEach(b => on(b, 'click', () => startTraining(b.dataset.g)));
    host.querySelectorAll('[data-train-skill]').forEach(b => on(b, 'click', () => {
      const skill = b.dataset.trainSkill;
      const games = G.games.filter(g => GAMESKILLS[g].includes(skill));
      const game = games[0];
      host.querySelectorAll('.ap-training-target').forEach(el => el.classList.remove('ap-training-target'));
      const target = game ? host.querySelector(`[data-training-game="${game}"]`) : null;
      for (const g of games) host.querySelector(`[data-training-game="${g}"]`)?.classList.add('ap-training-target');
      if (!target) return;
      target.classList.add('ap-training-target');
      target.focus({preventScroll:true});
      target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }));
  }
  const skillCol = v => (v >= 85 ? '#4fd18b' : v >= 70 ? '#8bd450' : v >= 55 ? '#f2c230' : '#ff8a5e');

  // ── the warehouse: what the team keeps ──
  function suggestPracticeSet(rec, skip) {
    const live = G.warehouse.tyres.filter(t => Math.max(...t.wear) < 0.98 && !skip?.has(t.id)), least = list => list.sort((a, b) => avgWear(a) - avgWear(b))[0];
    return least(live.filter(t => t.compound === rec)) || least(live) || null;
  }
  let labMod = null;
  async function loadLab() { if (!labMod) labMod = await import(asset('/apps/' + GAME_ID + '/lab.js')); return labMod; }
  async function warehouseAction(path, body) {
    const r = await api(path, body);
    if (!r.ok) { notifyGame(careerError(r.d.error)); await load2(); }
    else { const keep = setups; adopt(r.d); setups = keep; G.driver = r.d.driver; paintStatus(); }
    if (screen === 'warehouse') paintWarehouse();
    else if (screen === 'lab') paintLab();
    return r.ok;
  }
  const labCtx = () => ({ confirm: confirmGame, G, t: _t, esc, money, healthCol, dateStr, act: warehouseAction, reload: async () => { await load2(); if (screen === 'lab') paintLab(); } });
  async function paintLab() {
    if (!G) return;
    const m = await loadLab();
    if (screen === 'lab') m.paintLab($('#ap-lab'), labCtx());
  }
  // The warehouse: what the team owns, tyres first and then the parts, oldest on top; the basket buys new tyres.
  let whFilter = 'all', whCartOpen = false, whCart = {};
  async function paintWarehouse() {
    if (!G) return;
    const lm = await loadLab();
    if (screen !== 'warehouse') return;
    const host = $('#ap-warehouse'), w = G.warehouse, d = G.driver, busy = !!G.career.active_session;
    const free = w.max_tyres - w.tyres.length, inCart = Object.values(whCart).reduce((n, x) => n + x, 0);
    const total = G.compounds.reduce((n, c) => n + (whCart[c] || 0) * G.tyre_cost[c], 0);
    const kinds = [...new Set(w.parts.map(u => u.part))];
    if (whFilter !== 'all' && whFilter !== 'tyres' && !kinds.includes(whFilter)) whFilter = 'all';
    const chip = (k, label, n) => `<button class="ap-chipf${whFilter === k ? ' on' : ''}" data-wfilter="${k}">${esc(label)}<small>${n}</small></button>`;
    const filters = chip('all', _t('ap_wh_all'), w.tyres.length + w.parts.length) + chip('tyres', _t('ap_tyres'), w.tyres.length)
      + kinds.map(k => chip(k, _t('ap_part_' + k), w.parts.filter(u => u.part === k).length)).join('');
    const rows = G.compounds.map(c => `<div class="ap-cartrow">${menuArt('tyre-' + c)}<div><b>${esc(_t('ap_c_' + c))}</b><small>${esc(_t('ap_ch_' + c))}</small></div><em>${money(G.tyre_cost[c])}</em>
        <div class="ap-qty"><button data-wqty="${c}" data-d="-1" ${whCart[c] ? '' : 'disabled'} aria-label="-">−</button><output>${whCart[c] || 0}</output><button data-wqty="${c}" data-d="1" ${inCart < free ? '' : 'disabled'} aria-label="+">+</button></div></div>`).join('');
    const cart = whCartOpen ? `<div class="ap-card ap-cart"><div class="ap-cartlist">${rows}</div>
        <div class="ap-carttotal"><span>${esc(_t('ap_wh_total'))}: <b>${money(total)}</b></span><button class="ap-btn" data-wbuynow ${d.has_car && inCart && total <= d.budget ? '' : 'disabled'}>${esc(_t('ap_wh_buy_now'))}</button></div>
        ${free <= 0 ? `<p class="ap-warn">${esc(_t('ap_wh_full'))}</p>` : ''}</div>` : '';
    const tyreCards = whFilter === 'all' || whFilter === 'tyres' ? w.tyres.map(t => {
      const avg = avgWear(t), dead = Math.max(...t.wear) >= 0.98;
      return `<div class="ap-part" data-ui-key="tyre-${esc(t.id)}"><div class="ap-part-i">${menuArt('tyre-' + t.compound)}</div>
        <div class="ap-part-b"><div class="ap-set-h"><label>${esc(t.id)} · ${esc(_t('ap_c_' + t.compound))}</label><output style="color:${healthCol(avg)}">${dead ? esc(_t('ap_wh_worn_out')) : esc(_t('ap_wh_left', { pct: health(avg) }))}</output></div>
          <div class="ap-meter"><i style="width:${health(avg)}%;background:${healthCol(avg)}"></i></div>
          <div class="ap-hint">${t.runs ? esc(_t('ap_wh_laps', { laps: t.laps })) : esc(_t('ap_set_new'))}</div></div>
        <div class="ap-part-a"><button class="ap-btn ap-sm ap-ghost" data-wsell="${esc(t.id)}" ${busy ? 'disabled' : ''}>${esc(_t('ap_wh_sell', { price: money(t.sale) }))}</button></div></div>`;
    }) : [];
    const partCards = w.parts.filter(u => whFilter === 'all' || u.part === whFilter).map(u => lm.partRowHtml(labCtx(), u));
    const cards = [...tyreCards, ...partCards].join('');
    render(host, `${pageHeading('ap_wh_title', 'ap_paddock_warehouse', 'warehouse')}
      <div class="ap-whbar"><div class="ap-chipsf">${filters}</div><button class="ap-btn ap-cartbtn${whCartOpen ? ' on' : ''}" data-wcart>🛒 ${esc(_t('ap_wh_cart'))}${inCart ? `<span class="ap-badge">${inCart}</span>` : ''}</button></div>
      ${cart}
      <div class="ap-card"><div class="ap-bar"><small>${esc(_t('ap_wh_tyres'))}: ${w.tyres.length}/${w.max_tyres} · ${esc(_t('ap_wh_parts'))}: ${w.parts.length}/${w.max_parts}</small></div>
        ${cards ? `<div class="ap-equipment">${cards}</div>` : `<p class="ap-hint">${esc(_t(w.tyres.length + w.parts.length ? 'ap_wh_none' : 'ap_wh_empty'))}</p>`}</div>`);
    lm.bindPartRows(host, labCtx());
    host.querySelectorAll('[data-wfilter]').forEach(b => on(b, 'click', () => { whFilter = b.dataset.wfilter; paintWarehouse(); }));
    on(host.querySelector('[data-wcart]'), 'click', () => { whCartOpen = !whCartOpen; paintWarehouse(); });
    host.querySelectorAll('[data-wqty]').forEach(b => on(b, 'click', () => { const c = b.dataset.wqty; whCart[c] = Math.max(0, (whCart[c] || 0) + +b.dataset.d); paintWarehouse(); }));
    on(host.querySelector('[data-wbuynow]'), 'click', async e => {
      host.querySelectorAll('button').forEach(x => { x.disabled = true; });
      const items = { ...whCart };
      if (await warehouseAction('/warehouse/buy-many', { items })) { whCart = {}; whCartOpen = false; if (screen === 'warehouse') paintWarehouse(); }
    });
    host.querySelectorAll('[data-wsell]').forEach(b => on(b, 'click', async () => { const t = w.tyres.find(x => x.id === b.dataset.wsell); if (t && await confirmGame(_t('ap_wh_sell_confirm', { price: money(t.sale) }))) warehouseAction('/warehouse/sell', { set: t.id }); }));
  }

  // ── solo division and persistent championship ──
  const durationText=seconds=>{const n=Math.max(0,Math.ceil(seconds));return Math.floor(n/3600)+':'+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  // ── the tyres and the weather of a weekend ──
  const CLIFF = 0.72;
  const avgWear = t => t.wear.reduce((a, b) => a + b, 0) / 4;
  const chanceIcon = p => (p >= 0.75 ? '🌧️' : p >= 0.5 ? '🌦️' : p >= 0.25 ? '⛅' : '☀️');
  // The compound the forecast calls for in the coming session, and the best set of it to use.
  function suggestedSet(s) {
    const f = s.forecast?.[s.stage], p = f && stratOn() && wxH() != null ? f.chance : 0;
    // A dry track is started on dry tyres whatever the forecast says; rain tyres only when the track is already wet.
    let now = null; try { now = f ? recommend(cond(f.hour)) : null; } catch (_) {}
    const wetNow = now === 'W' || now === 'I';
    const want = now && !wetNow ? (s.phase === 'qualifying' ? 'S' : 'M') : wetNow && p < 0.5 ? now : p >= 0.8 ? 'W' : p >= 0.5 ? 'I' : s.phase === 'qualifying' ? 'S' : 'M';
    const fresh = s.tyres.filter(t => t.compound === want && Math.max(...t.wear) < 0.98).sort((a, b) => avgWear(a) - avgWear(b));
    const pick = s.phase === 'race' || s.phase === 'qualifying' ? fresh[0] : fresh[fresh.length - 1] || fresh[0];
    if (pick) return pick;
    // Never swap dry for rain tyres (or the other way round) because the wanted compound is missing or the sets are worn:
    // the same kind of tyre comes first, the least worn of it; the other kind only when there is none at all.
    const wetKind = want === 'W' || want === 'I', kind = t => (t.compound === 'W' || t.compound === 'I') === wetKind;
    const same = s.tyres.filter(kind).sort((a, b) => (Math.max(...a.wear) >= 0.98) - (Math.max(...b.wear) >= 0.98) || avgWear(a) - avgWear(b));
    return same[0] || s.tyres.find(t => Math.max(...t.wear) < 0.98) || s.tyres[0];
  }
  function forecastHtml(s) {
    if (!s.forecast?.length) return '';
    const phases = ['fp1', 'fp2', 'fp3', 'qualifying', 'race'], half = wxH();
    if (half == null) return `<h3>${esc(_t('ap_weather_title'))}</h3><p class="ap-hint">${esc(_t('ap_wx_none'))}</p>`;
    const rg = (f, i) => FX.wxRange(Math.round(f.chance * 100), 'w' + s.round + ':' + i, half);
    return `<h3>${esc(_t('ap_weather_title'))}</h3><div class="ap-forecast">${s.forecast.map((f, i) => `<div class="${i === s.stage ? 'current' : f.done ? 'done' : ''}">
        <small>${esc(_t('ap_phase_' + phases[i]))}</small><span>${chanceIcon(((rg(f, i).mid ?? rg(f, i).lo)) / 100)}</span><b>${esc(FX.wxText(Math.round(f.chance * 100), 'w' + s.round + ':' + i, half))}</b><em>${f.air}° · ${esc(hourStr(f.hour))}</em>
        <i class="ap-trust" title="${esc(_t('ap_forecast_trust'))}" style="--t:${Math.max(0.2, 1 - f.lead * 0.2)}"></i></div>`).join('')}</div>
      <p class="ap-hint">${esc(_t('ap_forecast_hint'))}</p>`;
  }
  // The strategist's range of laps until a number (the real figure is somewhere inside it)
  const lapsSpan = (v, err) => (err < .02 ? String(Math.floor(v)) : Math.max(1, Math.floor(v * (1 - err))) + '–' + Math.max(1, Math.ceil(v * (1 + err))));
  function tyreNotesHtml(s) {
    const err = FX ? FX.tyreErr(lvl('strategist')) : null;
    if (err == null) return '';
    const n = s.tyre_notes || {}, have = G.compounds.filter(c => n[c] && n[c].laps >= 2);
    const rows = have.map(c => {
      const per = n[c].wear / n[c].laps, to = FX.lapsToCliff(n[c], CLIFF, err, 'tn' + s.round + c);
      return `<div><i class="ap-dot" style="background:${ICON[c]}"></i><b>${esc(_t('ap_c_' + c))}</b><span>${(per * 100).toFixed(1)}% ${esc(_t('ap_per_lap'))}</span><span>≈ ${esc(err < .02 ? String(to.mid) : to.lo + '–' + to.hi)} ${esc(_t('ap_laps_to_cliff'))}</span><small>${esc(_t('ap_notes_from', { n: n[c].laps }))}</small></div>`;
    }).join('');
    let plan = '';
    if (s.phase === 'race') {
      const stints = FX.strategyPlan(n, s.race_laps, CLIFF, err);
      plan = stints ? `<h3>${esc(_t('ap_strategy'))}</h3><div class="ap-strategy">${stints.map(x => `<span><i class="ap-dot" style="background:${ICON[x.compound]}"></i>${esc(x.compound)}${x.laps}</span>`).join('')}</div><p class="ap-hint">${esc(_t('ap_strategy_hint', { n: s.race_laps, e: Math.round(err * 100) }))}</p>`
        : `<h3>${esc(_t('ap_strategy'))}</h3><p class="ap-hint">${esc(_t('ap_strategy_need'))}</p>`;
    }
    return (rows ? `<h3>${esc(_t('ap_tyre_notes'))}</h3><div class="ap-tyre-notes">${rows}</div>` : '') + plan;
  }
  // compact: the used sets and only one new set of each compound (the chosen one when it is new), as new sets are all alike
  function tyreSetsHtml(s, selected, attr, rec, compact, held = {}) {
    return G.compounds.map(c => {
      let sets = s.tyres.filter(t => t.compound === c);
      if (compact) { const fresh = sets.filter(t => !t.runs && !t.wear.some(x => x > 0)), one = fresh.find(t => t.id === selected) || fresh.find(t => !held[t.id]) || fresh[0]; sets = sets.filter(t => !fresh.includes(t) || t === one || held[t.id]); }
      if (!sets.length) return '';
      return `<div class="ap-setrow"><span class="ap-setrow-h"><i class="ap-dot" style="background:${ICON[c]}"></i>${c === rec ? '★ ' : ''}${esc(_t('ap_c_' + c))}</span>${sets.map(t => {
        const w = avgWear(t), dead = Math.max(...t.wear) >= 0.98;
        return `<button class="ap-setchip${selected === t.id ? ' on' : ''}${t.runs ? ' used' : ''}${held[t.id] ? ' held' : ''}" ${attr}="${t.id}" ${dead ? 'disabled' : ''} title="${esc(_t('ap_set_tip', { laps: t.laps, wear: Math.round(w * 100) }))}"><b>${esc(t.id)}</b><small>${held[t.id] ? '🚗' + held[t.id] : t.runs ? Math.round((1 - w) * 100) + '%' : esc(_t('ap_set_new'))}</small></button>`;
      }).join('')}</div>`;
    }).join('');
  }

  function paintDivision(){
    if(!G)return;
    clearInterval(divisionTimer);divisionTimer=null;clearInterval(hallTimer);hallTimer=null;
    const host=$('#ap-division'),d=G.driver,s=G.division;
    if(!s){render(host, '');return;}
    const phases=['fp1','fp2','fp3','qualifying','race'],complete=s.round>20;
    if (s.tyres && (!weekendSet || !s.tyres.some(t => t.id === weekendSet))) weekendSet = suggestedSet(s).id;
    const chosenSet = s.tyres?.find(t => t.id === weekendSet), laps = s.phase === 'race' ? s.race_laps : Math.floor((s.durations?.[s.stage] || 1800) / 55) + 2;
    const cars2=2,otherFee=s.slots?.find(x=>x.key!==s.slot)?.tyre_fee||0;
    const cost=(s.phase==='race'?35000:15000)*cars2+(s.tyre_fee||0)+otherFee+G.costs.lap*(laps+(s.phase==='race'?0:1))*cars2+G.costs.fuel*setup().fuel*cars2;
    const raceReady=s.slots?.length===2&&s.slots.every(x=>x.stage===s.stage);
    const otherSlot=s.slots?.find(x=>x.key!==s.slot)||null;
    if(otherSlot&&(!weekendSet2||!otherSlot.tyres.some(t=>t.id===weekendSet2)))weekendSet2=suggestedSet({...s,tyres:otherSlot.tyres,stage:s.stage}).id;
    const can=!!assignedPilot()&&s.entered&&!complete&&!G.career.active_session&&!busy&&!multi&&d.budget>=cost&&raceReady;
    const ladder=s.divisions.map(x=>`<div class="ap-division-level ${x.available?'current':''}"><b>${esc(_t('ap_division',{n:x.level}))}</b><span>${esc(_t('ap_car_level',{n:x.car}))} · ${esc(_t('ap_driver_level',{n:x.driver}))}</span><small>${esc(_t(x.available?'ap_available':'ap_coming_later'))}</small></div>`).join('');
    const teamCars=(s.slots||[]).map(x=>{const car=teamRoster().cars.find(c=>c.id===x.car_id),active=x.key===s.slot,ph=x.stage>=5?'—':_t('ap_phase_'+['fp1','fp2','fp3','qualifying','race'][x.stage]);
      return `<button class="ap-teamcar${active?' on':''}" data-pick-car="${esc(x.car_id)}" ${active||G.career.active_session?'disabled':''} title="${esc(_t('ap_watch_car'))}"><b>${esc(x.name||_t('ap_no_assigned_driver'))}</b><span>${esc(_t('ap_car_number',{n:x.number}))}${car?' · '+esc(_t('ap_car_level',{n:car.level})):''}</span><small>${active?esc(_t('ap_selected'))+' · ':''}${esc(_t('ap_next_session'))}: ${esc(ph)}${x.times?.[['fp1','fp2','fp3','qualifying'][Math.max(0,x.stage-1)]]!=null&&x.stage>0&&x.stage<5?' · '+esc(lapStr(x.times[['fp1','fp2','fp3','qualifying'][x.stage-1]])):''}</small></button>`;}).join('');
    const teamLabel=(name,mine)=>name||(mine?_t('ap_your_team'):'—');
    const teamTable=(s.team_standings||[]).map((r,i)=>`<tr class="${r.mine?'best':''}"><td>${i+1}</td><td>${esc(teamLabel(r.name,r.mine))}</td><td>${r.points}</td><td>${r.wins}</td></tr>`).join('');
    const standing=s.standings.map((r,i)=>`<tr class="${r.mine?'best':''}"><td>${i+1}</td><td>${esc(r.name||_t('ap_you'))}<small class="ap-team-sub">${esc(teamLabel(r.team,r.mine))}</small></td><td>${r.points}</td><td>${r.wins}</td></tr>`).join('');
    const opponents=s.roster.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.team)}</td><td>${r.overall}</td><td>${Math.round(r.car)}</td><td>${r.pit!=null?r.pit.toFixed(1)+' s':'—'}</td><td>${r.character?esc(_t('ap_style_'+characterStyle(r.character))):'—'}</td></tr>`).join('');
    render(host, `${pageHeading('ap_divisions', 'ap_paddock_division', 'trophy')}<div class="ap-garage ap-season-page"><div class="ap-col">
      <div class="ap-card"><h2>${esc(_t('ap_divisions'))}</h2><p class="ap-hint">${esc(_t('ap_division_intro'))}</p><div class="ap-division-ladder">${ladder}</div>
      <p class="ap-hint">${esc(_t('ap_division_requirements'))}</p>
      <div class="ap-tags"><span>${esc(_t('ap_car_level',{n:d.car_level||0}))}</span><span>${esc(_t('ap_driver_level',{n:d.overall}))}</span></div>
      ${!s.entered?`<button class="ap-btn" data-enter-division ${s.eligible&&!multi&&!G.career.active_session?'':'disabled'}>${esc(_t('ap_enter_division'))}</button>`:''}${multi?`<p class="ap-warn">${esc(_t('ap_solo_only'))}</p>`:''}</div>
      ${s.entered?`<div class="ap-card"><h2>${esc(_t('ap_team_cars'))}</h2><p class="ap-hint">${esc(_t('ap_team_cars_hint'))}</p><div class="ap-teamcars">${teamCars}</div></div>`:''}
      ${s.entered?`<div class="ap-card"><h2>${esc(_t(complete?'ap_season_complete':'ap_weekend'))} ${complete?'':esc(_t('ap_round',{n:s.round}))}</h2>
        <p class="ap-hint">${esc(_t('ap_calendar_rule'))}</p>
        <div class="ap-weekend-stages">${phases.map((p,i)=>`<div class="${!complete&&s.stage===i?'current':!complete&&i<s.stage?'done':''}">${!complete&&i<s.stage?'✓ ':''}${esc(_t('ap_phase_'+p))}</div>`).join('')}</div>
        ${!complete?`<p class="ap-hint">${esc(_t('ap_recovery_rule'))}</p>
          <p class="ap-hint">${esc(_t(s.locked_setup?'ap_parc_ferme':'ap_weekend_setup_hint'))}</p>
          <button class="ap-btn ap-sm ap-ghost" data-weekend-setup ${s.locked_setup?'disabled':''}>${esc(_t('ap_setup'))}</button>
          ${forecastHtml(s)}${tyreNotesHtml(s)}
          <h3>${esc(_t('ap_tyre_sets'))}${otherSlot?' · '+esc(s.slots.find(x=>x.key===s.slot)?.name||''):''}</h3><p class="ap-hint">${esc(_t('ap_tyre_sets_hint'))}</p>${tyreSetsHtml(s,weekendSet,'data-wset')}
          ${otherSlot?`<h3>${esc(_t('ap_tyre_sets'))} · ${esc(otherSlot.name||'')}</h3>${tyreSetsHtml({tyres:otherSlot.tyres},weekendSet2,'data-wset2')}`:''}
          ${!raceReady?`<p class="ap-warn">${esc(_t('ap_race_both_cars'))}</p>`:''}
          ${s.tyre_fee+otherFee?`<p class="ap-hint">${esc(_t('ap_tyre_fee',{fee:money(s.tyre_fee+otherFee)}))}</p>`:''}
          <p class="ap-hint">${esc(_t(s.phase==='race'?'ap_race_rules':'ap_solo_session_rule'))}</p>
          <div class="ap-cost"><span>${esc(_t('ap_cost'))}</span><b>${money(cost)}</b></div>${driverEnergy(s.energy)}
          <button class="ap-btn ap-go" data-weekend-start ${can?'':'disabled'}>${esc(_t('ap_start_phase',{phase:_t('ap_phase_'+s.phase)}))}</button>
          ${activeRunPanel()}`:''}
        ${s.grid.length?`<h3>${esc(_t('ap_starting_grid'))}</h3><div class="ap-scroll"><table class="ap-table">${s.grid.map((r,i)=>`<tr class="${isMine(r.id)?'best':''}"><td>${i+1}</td><td>${esc(r.name)}</td><td>${lapStr(r.time)}</td></tr>`).join('')}</table></div>`:''}</div>
        <div class="ap-card"><h2>${esc(_t('ap_calendar'))}</h2><div class="ap-season-calendar">${s.calendar.map(r=>`<div class="${r.status}"><b>${esc(_t('ap_round',{n:r.round}))}</b><span>${esc(trackName(r.track))}</span><small>${r.status==='complete'?'P'+r.position+' · '+r.points+' '+esc(_t('ap_points')):r.round===s.round?esc(_t('ap_weekend')):'—'}</small></div>`).join('')}</div></div>`:''}
      </div><div class="ap-col"><div class="ap-card"><h2>${esc(_t('ap_team_standings'))}</h2><div class="ap-scroll"><table class="ap-table"><tr><th>#</th><th>${esc(_t('ap_team_col'))}</th><th>${esc(_t('ap_points'))}</th><th>${esc(_t('ap_wins'))}</th></tr>${teamTable}</table></div></div>
      <div class="ap-card"><h2>${esc(_t('ap_championship_standings'))}</h2><div class="ap-scroll"><table class="ap-table"><tr><th>#</th><th>${esc(_t('ap_tab_driver'))}</th><th>${esc(_t('ap_points'))}</th><th>${esc(_t('ap_wins'))}</th></tr>${standing}</table></div></div>
      <div class="ap-card"><h2>${esc(_t('ap_division_field'))}</h2><div class="ap-scroll"><table class="ap-table"><tr><th>${esc(_t('ap_tab_driver'))}</th><th>${esc(_t('ap_team_col'))}</th><th>${esc(_t('ap_overall'))}</th><th>${esc(_t('ap_car_level',{n:''}))}</th><th>${esc(_t('ap_stop_short'))}</th><th>${esc(_t('ap_character'))}</th></tr>${opponents}</table></div></div>
      ${s.results.length?`<div class="ap-card"><h2>${esc(_t('ap_race_history'))}</h2>${s.results.slice().reverse().map(r=>`<details><summary>${esc(_t('ap_round',{n:r.round}))} · ${r.points} ${esc(_t('ap_points'))} · ${money(r.prize)}</summary><div class="ap-scroll"><table class="ap-table">${r.classification.map(c=>`<tr class="${isMine(c.id)?'best':''}"><td>${c.position}</td><td>${esc(c.name)}</td><td>${c.dnf?'DNF':lapStr(c.time)}</td><td>${c.points}</td></tr>`).join('')}</table></div></details>`).join('')}</div>`:''}
      </div></div>`);
    bindResume(host);
    on(host.querySelector('[data-enter-division]'), 'click',e=>{e.target.disabled=true;mp.send({type:'ap_division_enter'});});
    on(host.querySelector('[data-weekend-setup]'), 'click',async()=>{curTrack=roundTrack(s);gview='setup';setupPage='cars';setupFrom='division';screenCache.delete('garage');await loadForecast(curTrack);go('garage');});

    host.querySelectorAll('[data-wset]').forEach(b=>b.onclick=()=>{weekendSet=b.dataset.wset;paintDivision();});
    host.querySelectorAll('[data-wset2]').forEach(b=>b.onclick=()=>{weekendSet2=b.dataset.wset2;paintDivision();});
    host.querySelectorAll('[data-pick-car]').forEach(b=>b.onclick=async()=>{b.disabled=true;const r=await openCar(b.dataset.pickCar);if(!r){b.disabled=false;return;}setups={};weekendSet=null;weekendSet2=null;adopt(r.d);paintStatus();paintDivision();});
    on(host.querySelector('[data-weekend-start]'), 'click',async e=>{busy=true;e.target.disabled=true;if(!await flushSetup()){busy=false;paintDivision();return;}curTrack=roundTrack(s);mp.send({type:'ap_run',kind:'d5_'+s.phase,compound:chosenSet?.compound||'M',tyre_set:weekendSet,tyre_set2:weekendSet2,setup:setup(),track:curTrack});});
    startEnergyRefresh();
  }

  function hallView() {
    const h=G?.training_hall,limit=h?.limit||10,remaining=h?.remaining??limit;
    const now=(h?.server_time||0)+Math.max(0,performance.now()-(h?.received_at??performance.now()))/1000;
    const seconds=Math.max(0,Math.ceil((h?.reset_at||0)-now));
    const clock=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
    return {limit,remaining,seconds,value:remaining?`${remaining} / ${limit}`:clock,
      text:remaining?_t('ap_hall_status',{n:remaining,m:limit}):_t(seconds?'ap_hall_wait':'ap_hall_refresh',{time:clock})};
  }
  function trainingHall() {
    const h=hallView();
    return `<section class="ap-hall${h.remaining?'':' is-resting'}" data-training-hall aria-label="${esc(_t('ap_hall_title'))}"><div class="ap-hall-main"><span class="ap-hall-icon" aria-hidden="true">⏱</span><div><h2>${esc(_t('ap_hall_title'))}</h2><p data-hall-status>${esc(h.text)}</p></div><strong data-hall-count>${esc(h.value)}</strong></div><div class="ap-hall-slots" aria-hidden="true">${Array.from({length:h.limit},(_,i)=>`<i class="${i<h.remaining?'available':'used'}"></i>`).join('')}</div><p class="ap-hint">${esc(_t('ap_hall_rules'))}</p></section>`;
  }
  async function updateTrainingHall() {
    if(!G||screen!=='driver'||!root?.isConnected)return;
    const h=hallView();
    root.querySelectorAll('[data-hall-count]').forEach(n=>n.textContent=h.value);
    root.querySelectorAll('[data-hall-status]').forEach(n=>n.textContent=h.text);
    if(!h.remaining&&!h.seconds&&!hallRefreshing&&$('#ap-modal')?.hidden){
      hallRefreshing=true;const currentRoot=root;
      try{const r=await api('/state');if(r.ok&&root===currentRoot&&screen==='driver'&&$('#ap-modal')?.hidden){adopt(r.d);paintStatus();paintDriver();}}
      catch(_){ /* The server will be retried while the countdown is expired. */ }
      finally{hallRefreshing=false;}
    }
  }
  // ── training ──
  // A top-layer dialog stays above the game's overlays, including in fullscreen.
  let gameDialog = null;
  function gameMessage(message, question = false) {
    if (gameDialog) return question ? Promise.resolve(false) : gameDialog.then(() => gameMessage(message));
    const host = root?.querySelector('.ap-app');
    if (!host?.isConnected) return Promise.resolve(false);
    let finish;
    const result = new Promise(resolve => { finish = resolve; });
    gameDialog = result;
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'ap-message';
    dialog.setAttribute('aria-labelledby', 'ap-message-title');
    dialog.setAttribute('aria-describedby', 'ap-message-text');
    render(dialog, `<div class="ap-message-heading"><span aria-hidden="true">🏁</span><h2 id="ap-message-title">${esc(_t('ap_title'))}</h2></div><p id="ap-message-text">${esc(message)}</p><div class="ap-message-actions">${question ? `<button type="button" class="ap-btn ap-ghost" data-message-cancel>${esc(_t('ap_cancel'))}</button>` : ''}<button type="button" class="ap-btn" data-message-accept>${esc(_t(question ? 'ap_confirm' : 'ap_close'))}</button></div>`);
    host.append(dialog);
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      dialog.close();
      dialog.remove();
      gameDialog = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      finish(value);
    };
    const observer = new MutationObserver(() => { if (!dialog.isConnected) done(false); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    dialog.querySelector('[data-message-accept]').onclick = () => done(true);
    on(dialog.querySelector('[data-message-cancel]'), 'click', () => done(false));
    on(dialog, 'cancel', e => { e.preventDefault(); done(false); });
    on(dialog, 'close', () => done(false));
    dialog.showModal();
    dialog.querySelector(question ? '[data-message-cancel]' : '[data-message-accept]').focus();
    return result;
  }
  const confirmGame = message => gameMessage(message, true);
  const notifyGame = message => gameMessage(message);

  function modal(html) { const m = $('#ap-modal'); m.hidden = !html; render(m, html || ''); return m; }
  async function startTraining(game, member) {
    if (trainingStarting || !$('#ap-modal')?.hidden) return;
    trainingStarting = true;
    let r;
    try { r = await api('/train/start', member ? { game, member } : { game }); }
    finally { trainingStarting = false; }
    if (!r.ok) { notifyGame(careerError(r.d.error)); return; }
    G.driver = r.d.driver; G.crew=r.d.crew;if(r.d.specialists)G.specialists=r.d.specialists;G.training_hall=r.d.training_hall;if(r.d.training_refs)G.training_refs=r.d.training_refs;paintStatus();
    const staffGame = game.startsWith('staff_'), tid = r.d.tid, mechanic = member && !staffGame ? G.crew.trainings[game].game : game;
    const m = modal(`<div class="ap-dlg"><div class="ap-bar"><h2>${GAMEICON[game] || ''} ${esc(_t('ap_tr_' + game))}</h2><button class="ap-btn ap-sm ap-ghost" id="ap-tg-x">✕</button></div>
      <p class="ap-hint">${esc(_t('ap_trd_' + game))}</p><div id="ap-tg" class="ap-tg"></div></div>`);
    const trainingBox = $('#ap-tg', m);
    let h = null, finished = false;
    const close = () => { if (h) h.destroy(); modal(''); if (member) load2().then(() => { if (screen === 'driver') paintDriver(); }); else paintDriver(); };
    on($('#ap-tg-x', m), 'click', async () => { if (finished || await confirmGame(_t('ap_tg_quit'))) close(); });
    const T = await import(asset('/apps/' + GAME_ID + (staffGame ? '/staff-train.js' : member ? '/crew-train.js' : '/pilot-train.js')));
    if (!trainingBox.isConnected) return;
    h = T.run(mechanic, trainingBox, _t, async raw => {
      if (finished) return;
      finished = true;
      const blockedKeys = new Set(trainingKeys);
      if (h) h.destroy();
      const f = await api('/train/finish', { tid, result: raw });
      if (f.ok) { G.training_hall=f.d.training_hall;G.driver = f.d.driver; if (member) { G.crew = f.d.crew; if (f.d.specialists) G.specialists = f.d.specialists; } else { G.training_levels = f.d.training_levels; G.training_refs = f.d.training_refs || G.training_refs; lastGains = f.d.gains; } paintStatus(); }
      const pct = f.ok ? Math.round(f.d.percent) : 0;
      const fatigue=game==='fitness'&&raw.buckets?Math.round(Math.max(0,1-(raw.buckets[4]+raw.buckets[5])/Math.max(1,raw.buckets[0]+raw.buckets[1]))*100):null;
      const gains = f.ok ? Object.entries(f.d.gains).map(([k, v]) => `<li>${esc(_t('ap_k_' + k))} <b class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)}</b></li>`).join('') : '';
      const lost = f.ok && Object.values(f.d.gains).some(v => v < 0);
      if (!trainingBox.isConnected) return;
      render(trainingBox, `<div class="ap-result" tabindex="-1"><div class="ap-score">${pct > 0 ? '+' : ''}${pct}%</div><div class="ap-hint">${esc(_t('ap_tg_step'))}</div>${member || !f.ok ? '' : `<p class="ap-hint">${esc(_t('ap_tg_measured'))}: <b>${esc(trainVal(game, f.d.measured))}</b> · </p>`}
        ${f.ok && f.d.coach ? `<p class="ap-hint">${esc(_t('ap_tg_coach', { n: f.d.coach }))}</p>` : ''}${fatigue!==null?`<p class="ap-hint">${esc(_t('ap_endurance_drop',{n:fatigue}))}</p>`:''}${lost ? `<div class="ap-warn">${esc(_t('ap_tg_loss'))}</div>` : ''}
        <ul>${gains || `<li>${esc(_t('ap_tg_nogain'))}</li>`}</ul>
        <button class="ap-btn" id="ap-tg-ok">${esc(_t('ap_close'))}</button> <button class="ap-btn ap-ghost" id="ap-tg-again" ${(staffGame ? Object.values(G.specialists.members).some(x => x && x.id === member && x.energy >= G.specialists.train_energy) : member ? (G.crew.cars && Object.values(G.crew.cars).some(c => Object.values(c.members).some(x => x && x.id === member && x.energy >= G.crew.train_energy))) : G.driver.energy >= G.costs.train_energy) && !G.career.active_session && G.training_hall?.remaining ? '' : 'disabled'}>${esc(_t('ap_again'))}</button></div>`);
      const result = $('.ap-result', m);
      // A key held during play must be released before it can activate a result button.
      const guardKey = e => {
        if (!activationKey(e)) return;
        if (e.type === 'keydown' && !e.repeat) blockedKeys.delete(e.code);
        const blocked = blockedKeys.has(e.code) || (e.type === 'keydown' && e.repeat);
        if (e.type === 'keyup') blockedKeys.delete(e.code);
        if (blocked) { e.preventDefault(); e.stopImmediatePropagation(); }
      };
      on(result, 'keydown', guardKey, true);
      on(result, 'keyup', guardKey, true);
      result.focus({preventScroll:true});
      on($('#ap-tg-ok', m), 'click', close);
      on($('#ap-tg-again', m), 'click', () => { modal(''); startTraining(game, member); });
    }, { difficulty: r.d.difficulty, settings: r.d.settings });
    const canvas = $('canvas', m);
    if (canvas) { canvas.tabIndex = 0; canvas.focus({preventScroll:true}); }
  }

  async function paintFinances() {
    const host=$('#ap-finance');
    if (!host.hasChildNodes()) render(host, `<div class="ap-empty">${esc(_t('ap_preparing'))}</div>`);
    const mod=await import(asset('/apps/' + GAME_ID + '/finance.js'));
    if(screen!=='finance')return;
    await mod.paint(host,{t:_t,esc,money,api,asset,heading:()=>pageHeading('ap_finances','ap_finance_hint','telemetry'),
      updateBalance:balance=>{G.driver.budget=balance;paintStatus();}});
  }

  // ── statistics ──
  async function paintStats() {
    const host = $('#ap-stats');
    if (!G) return;
    if (!host.hasChildNodes()) render(host, `<div class="ap-empty">…</div>`);
    const r = await api('/runs?track=' + encodeURIComponent(curTrack));
    if (!r.ok) { render(host, `<div class="ap-empty">${esc(_t('ap_error'))}</div>`); return; }
    history = r.d.runs; histTrack = curTrack; const b = r.d.bests; tinfo().bests = b;
    const secCells = [0, 1, 2].map(i => {
      const mine = b.sectors && b.sectors[i], rec = b.record_sectors && b.record_sectors[i];
      const cls = mine != null && rec != null && mine <= rec + 0.0005 ? 'purple' : 'green';
      return `<div class="ap-sectile ${mine == null ? '' : cls}"><small>S${i + 1}</small><b>${secStr(mine)}</b><em>${esc(_t('ap_record_s'))} ${secStr(rec)}</em></div>`;
    }).join('');
    const rows = history.map(x => `<button type="button" data-run="${x.id}" class="ap-session-record ap-record-open">${sessionCardHtml(x)}<span class="ap-record-more" aria-hidden="true">↗</span></button>`).join('');
    render(host, `${pageHeading('ap_tab_stats', 'ap_paddock_stats', 'telemetry')}<div class="ap-statspg">
      <div class="ap-card"><div class="ap-bar"><h2>${esc(trackName(curTrack))}</h2></div>
        <div class="ap-cond ap-cond4"><div><span>${esc(_t('ap_your_best'))}</span><b>${lapStr(b.best)}</b></div><div><span>${esc(_t('ap_theoretical'))}</span><b>${lapStr(b.theoretical)}</b></div>
          <div><span>${esc(_t('ap_track_record'))}</span><b>${lapStr(b.record)}</b></div><div><span>${esc(_t('ap_runs_n'))}</span><b>${b.runs || 0} · 🏁 ${b.races || 0}</b></div></div>
        <h3>${esc(_t('ap_best_sectors'))}</h3><div class="ap-sectiles">${secCells}</div></div>
      <div class="ap-card"><h3>${esc(_t('ap_all_runs'))}</h3>${rows ? `<div class="ap-session-records ap-record-grid">${rows}</div>` : `<div class="ap-hint">${esc(_t('ap_no_runs'))}</div>`}</div>
      <div id="ap-rundetail" data-ui-preserve></div></div>`);
    host.querySelectorAll('[data-run]').forEach(tr => on(tr, 'click', () => showRun(+tr.dataset.run)));
  }

  async function showRun(id) {
    const box = $('#ap-rundetail');
    const r = await api('/run/' + id);
    if (!r.ok) return;
    const x = r.d, bs = tinfo().bests || {}, recS = bs.record_sectors || [];
    if(x.weekend?.classification?.length)await loadMods();
    const best = [0, 1, 2].map(i => Math.min(...x.laps_log.filter(l => l.valid && l['s' + (i + 1)] != null).map(l => l['s' + (i + 1)]).concat([1e9])));
    const rows = x.laps_log.map(l => {
      const cells = [1, 2, 3].map(n => {
        const v = l['s' + n]; if (v == null) return '<td>–</td>';
        const cls = !l.valid || l.pit ? '' : (recS[n - 1] != null && v <= recS[n - 1] + 0.0005 ? 'purple' : v <= best[n - 1] + 0.0005 ? 'green' : 'yellow');
        return `<td class="ap-sc ${cls}">${secStr(v)}</td>`;
      }).join('');
      return `<tr class="${l.valid ? '' : 'inv'}"><td>${l.n}</td><td>${lapStr(l.lap_time)}${l.pen ? ` <small>+${l.pen}s</small>` : ''}${l.pit ? ' 🅿' : ''}</td>${cells}</tr>`;
    }).join('');
    render(box, `<div class="ap-card"><div class="ap-bar"><h3>${x.weekend?esc(_t('ap_round',{n:x.weekend.round}))+' · '+esc(_t('ap_phase_'+x.weekend.phase)):x.kind==='qualifying' ? '⏱' : x.kind === 'race' ? '🏁' : '🧪'} ${esc(dateStr(x.at))}</h3><button class="ap-btn ap-sm ap-ghost" id="ap-rd-x">✕</button></div>
      <div class="ap-chips ap-chips-l">${setupChips(x.setup)} ${x.final_setup && JSON.stringify(x.final_setup) !== JSON.stringify(x.setup) ? '→ ' + setupChips(x.final_setup) : ''}</div>
      <table class="ap-table"><tr><th>#</th><th>${esc(_t('ap_time_h'))}</th><th>S1</th><th>S2</th><th>S3</th></tr>${rows}</table>
      ${x.weekend?.classification?.length&&mods ? mods.DIVISION.classificationHtml(x.weekend.classification,_t,lapStr) : ''}
      ${x.kind === 'race' && x.position ? `<div class="ap-hint">${esc(_t('ap_position', { n: x.position, m: 11 }))} · ${lapStr(x.race_time)} · ${money(x.prize)}</div>` : ''}</div>`);
    on($('#ap-rd-x'), 'click', () => { render(box, ''); });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── sending the car out ──
  async function sendOut() {
    if (busy || pending) return;
    const ids = markedIds(), team = teamRoster();
    if (!ids.length) return;
    ensureCarSets(G.warehouse.tyres.filter(t => Math.max(...t.wear) < .98), recShown(cond(cfg.hour)));   // no worn-out set and no set on two cars
    busy = true; $('#ap-send').disabled = true;
    if (!await flushSetup()) { busy = false; paintSession(); return; }
    // the open car leads; with only another car ticked, that car is opened first
    const leadId = ids.includes(team.active_car) ? team.active_car : ids[0], otherId = ids.find(id => id !== leadId) || null;
    const leadSetup = { ...carSetupOf(leadId) }, otherSetup = otherId ? { ...carSetupOf(otherId) } : null, sets = { ...carSets };
    if (leadId !== team.active_car) {
      const r = await openCar(leadId);
      if (!r) { busy = false; paintSession(); return; }
      setups = {}; weekendSet = null; weekendSet2 = null; adopt(r.d); paintStatus();
    }
    setups[curTrack] = leadSetup;
    queueSetupSave(curTrack, leadSetup);
    if (!await flushSetup()) { busy = false; paintSession(); return; }
    mp.send({ type: 'ap_run', kind: 'practice', compound: G.warehouse.tyres.find(t => t.id === sets[leadId])?.compound, tyre_set: sets[leadId], setup: leadSetup, track: curTrack,
      ...(otherId ? { both: true, tyre_set2: sets[otherId], setup2: otherSetup } : {}) });
  }

  async function onGo(msg) {
    sndStop();
    if(divisionPlayback){divisionPlayback.destroy();divisionPlayback=null;}
    if(msg.kind==='d5_race'){
      if(view){view.destroy();view=null;}run=null;sndStop();pb.playing=false;
      pending=msg;busy=true;G.driver=msg.driver;G.career.active_session={id:msg.session,kind:msg.kind};paintStatus();
      go('track');const host=$('#ap-track');render(host, `<div class="ap-load">${esc(_t('ap_preparing'))}</div>`);
      try{
        const M=await loadMods();track=useTrack(msg.track);if(!track)throw new Error('track');
        divisionPlayback=M.DIVISION.playRace({host,M,track,payload:{...msg,site:siteOf(msg.track),tyre_cost:G.tyre_cost,spares:G.warehouse.parts,wx_half:wxH(),tyre_err:FX.tyreErr(lvl('strategist'))},t:_t,money,time:lapStr,RaceModel:M.RACE.Race,sound:{factory:M.AUDIO.createEngineAudio,context:audioContext,enabled:sndOn,changed:value=>{sndOn=value;}},
          sendPit:command=>new Promise(resolve=>{pitAck=resolve;send({type:'ap_pit',compound:command.compound,set:command.set,at:command.t,wing:command.wing===true,wing_unit:command.wing_unit,service:command.service,pass:command.pass===true,car:command.car||'player'});}),
          saveProgress:value=>send({type:'ap_progress',session:msg.session,progress:{t:value,pbt:value,armed:false,inputs:[]}}),
          onFinish:report=>send({type:'ap_result',session:msg.session,...report}),
          onGarage:()=>{divisionPlayback.destroy();divisionPlayback=null;render(host, '');go('division');}});
        divisionPlayback.session=msg.session;pending=null;
      }catch(e){console.error(e);pending=null;busy=false;render(host, `<div class="ap-empty">${esc(_t('ap_no_webgl'))}</div>`);}
      return;
    }
    if(msg.locked_setup&&G.division)G.division.locked_setup={...msg.setup};
    pending = msg; myCol = msg.col || 0;
    G.driver = msg.driver; G.career.active_session={id:msg.session,kind:msg.kind};paintStatus();
    go('track');
    const host = $('#ap-track');
    render(host, `<div class="ap-load"><div class="ap-load-t">${esc(_t('ap_preparing'))}</div><div class="ap-bar2"><i style="width:60%"></i></div></div>`);
    let M;
    try { M = await loadMods(); } catch (e) { console.error(e); render(host, `<div class="ap-empty">${esc(_t('ap_no_webgl'))}</div>`); pending = null; busy = false; return; }
    const SIM = M.SIM;
    track = useTrack(msg.track);
    if (!track) { render(host, `<div class="ap-empty">${esc(_t('ap_error'))}</div>`); pending = null; busy = false; return; }
    const mk = m => new SIM.Run({ track, setup: m.setup, skills: m.skills, forecast: msg.forecast, startHour: msg.hour_frac ?? msg.hour, laps: msg.laps, compound: m.compound,
      seed: m.seed, mods: m.mods || null, character:m.character, tyreSet: m.tyre_set || null, energy:m.start_energy??100, energyCost:msg.energy??0, race: false, lockedSetup:!!msg.locked_setup, duration: msg.duration, parts: m.parts, fail: m.fail, crash: m.crash, lazy: true });
    const mates = [{ key: msg.key || (msg.other?.key === 'player' ? 'player2' : 'player'), name: msg.driver?.name || G.driver.name, msg, saved: msg.progress && msg.progress.inputs ? msg.progress : null }];
    if (msg.other) mates.push({ key: msg.other.key, name: msg.other.name, msg: { ...msg, ...msg.other, sectors: msg.kind === 'practice' ? msg.sectors : { ...msg.sectors, personal: [null, null, null] } }, saved: msg.progress?.cars?.[msg.other.key] || null });
    const bar = host.querySelector('.ap-bar2 i');
    for (const m of mates) m.run = mk(m.msg);
    runGroup = new SIM.RunGroup(mates.map(m => m.run));
    if (mates.some(m => m.saved)) {
      runGroup.restoreBegin(mates.map(m => m.saved));
      while (!runGroup.restoreStep(14)) {
        const until = Math.max(1, ...mates.map(m => m.saved?.t || 0));
        if (bar) bar.style.width = Math.min(98, 10 + 88 * mates[0].run.t / until) + '%';
        await new Promise(r => setTimeout(r, 0));
      }
    } else runGroup.advance(40, LEAD);
    cars = mates.map(m => ({ key: m.key, name: m.name, msg: m.msg, run: m.run, secColors: {},
      sec: { personal: (m.msg.sectors.personal || [null, null, null]).slice(), record: (m.msg.sectors.record || [null, null, null]).slice(), run: [null, null, null], shown: 0 }, savedInputs: m.run.inputs.length }));
    carIdx = 0; run = cars[0].run; secColors = cars[0].secColors; sec = cars[0].sec;
    const saved = mates[0].saved;
    pb = { t: saved ? Math.min(saved.pbt || 0, ...cars.map(c => Math.max(0, (c.run.frames.length / c.run.FRAME - 1) / 30))) : 0, speed: 1, playing: true, sent: false, skip: false, msg, lightsOut: run.lightsOut, wxAt: 0 };
    saveAt = 0; savedInputs = cars.reduce((n, c) => n + c.run.inputs.length, 0);
    pitModal = false; tyreWait = false; summary = null;
    buildTrackScreen();
    pending = null;
  }

  // ── the track view ──
  function paintTrack() {
    const host = $('#ap-track');
    if(divisionPlayback)return;
    if (run && !summary && !host.querySelector('.ap-view')) buildTrackScreen();
    else if (!run) host.innerHTML = `<div class="ap-empty">${esc(_t('ap_no_run'))}</div>`;
    if (view) view.resize();
  }

  function buildTrackScreen() {
    const host = $('#ap-track'), M = mods;
    host.innerHTML = `
      <div class="ap-view">
        <div class="ap-3d" id="ap-3d"></div>
        <div class="ap-hud">
          <div class="ap-tower"><div class="ap-tower-head"><b>${esc(_t('ap_classification'))}</b><span>${esc(_t('ap_best'))}</span></div><div id="h-own-position" class="ap-own-position" hidden></div><div id="h-order"></div></div>
          <div class="ap-hud-l">
            <div class="ap-speed"><b id="h-speed">0</b><small>km/h</small><span id="h-gear">N</span></div>
            ${M.DIVISION.drivingMetersHtml(_t)}
            <div class="ap-tyres" id="h-tyres"></div>
          </div>
          <div class="ap-hud-t"><div id="h-lap" class="ap-laptxt"></div><div id="h-session-clock" class="ap-session-clock"></div><div id="h-time" class="ap-laptime">0:00.000</div>
            <div class="ap-sectors" id="h-secs"><div id="hs0"><small>S1</small><b>–</b><em></em></div><div id="hs1"><small>S2</small><b>–</b><em></em></div><div id="hs2"><small>S3</small><b>–</b><em></em></div></div>
            <div id="h-last" class="ap-hint"></div></div>
          <div class="ap-hud-r"><canvas id="h-map" width="170" height="120"></canvas>
            <div class="ap-gauges"><div title="${esc(_t('ap_hud_fuel'))}">⛽ <b id="h-fuel"></b></div><div title="${esc(_t('ap_hud_ers'))}">🔋 <b id="h-ers"></b></div><div id="h-wx"></div></div></div>
          <div class="ap-lights" id="h-lights" hidden></div>
          <div class="ap-banner" id="h-banner" hidden></div>
          <div id="h-active-rivals" class="ap-active-rivals"></div><div id="h-names"></div>
          <div class="ap-radio shut" id="h-radio"><button type="button" class="ap-radio-head" id="h-radio-head" aria-expanded="false" aria-label="${esc(_t('ap_radio'))}"><span><span class="ap-radio-ic">🎙️</span><span class="ap-radio-tt"> ${esc(_t('ap_radio'))}</span></span><i aria-hidden="true">▾</i></button><div class="ap-radio-list" id="h-radio-list" aria-live="polite"></div></div>
        </div>
        <div class="ap-ctl">
          <div class="ap-cams" id="h-cams">${['chase', 'cockpit', 'tv', 'heli', 'nose', 'orbit'].map(c => `<button data-cam="${c}">${esc(_t('ap_cam_' + c))}</button>`).join('')}</div>
          ${cars.length > 1 ? `<div class="ap-watch" id="h-cars">${cars.map((c, i) => `<button data-car="${i}" data-team-car="${esc(c.key)}" title="${esc(_t('ap_watch_car'))}">${esc(c.name)}</button>`).join('')}</div>` : ''}
          <button class="ap-boxbtn" id="h-box"></button><button class="ap-boxbtn" id="h-through">${esc(_t('ap_pit_through'))}</button>
          <div class="ap-speeds" id="h-speeds">${[1, 2, 4, 8].map(s => `<button data-sp="${s}">×${s}</button>`).join('')}<button data-sp="skip">${esc(_t('ap_skip'))}</button><button id="h-snd">${sndOn ? '🔊' : '🔇'}</button></div>
        </div>
      </div>`;
    if (view) { view.destroy(); view = null; }
    view = M.VIEW.createView(M.THREE, $('#ap-3d'), track, { low: matchMedia('(pointer:coarse)').matches, compound: pb.msg.compound, livery: pb.msg.livery, venue: pb.msg.venue, site: siteOf(pb.msg.track) });
    view.setConditions(M.SIM.condAt(pb.msg.forecast, pb.msg.hour_frac ?? pb.msg.hour), pb.msg.hour_frac ?? pb.msg.hour);
    view.setCompound(compoundAt(cars[carIdx], pb.t));
    view.setRun(run.frames);
    view.setEvents(run.events);
    view.setCamera('chase');
    view.onTick = tick;
    host.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => { view.setCamera(b.dataset.cam); markCam(); }));
    host.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.sp === 'skip') { if (!pitModal) pb.skip = true; } else { pb.speed = +b.dataset.sp; pb.skip = false; }
      markSpeed();
    }));
    $('#h-wx').onclick = () => {
      const w = pb.wxLast; if (!w || !M.FX.wxShortOn(wxH())) return;
      const lapSec = w.lap > 0 ? w.t / w.lap : 95;
      M.DIVISION.openWeatherLaps($('#ap-track .ap-view'), M.DIVISION.weatherLapsHtml(M, pb.msg.forecast, w.hr, lapSec, Math.min(w.laps, w.lap + 1), w.laps, _t, wxH()));
    };
    const paintSound=M.DIVISION.bindSoundButton($('#h-snd'),{engine:()=>snd,enabled:()=>sndOn,t:_t,set:value=>{sndOn=value;if(!value)sndStop();else sndStart();}});
    view.paintSound=paintSound;
    host.querySelectorAll('[data-car]').forEach(b => b.addEventListener('click', () => switchCar(+b.dataset.car)));
    $('#h-order').addEventListener('click', e => { if (e.target.closest('.ap-order-row.teammate')) switchCar(1 - carIdx); });
    markCars();
    $('#h-box').addEventListener('click', () => { if (run && !run.done && !run.pitState) { run.pitRequest = run.pitRequest === true ? false : true; paintBox(); } });
    $('#h-through').addEventListener('click', () => { if (run && !run.done && !run.pitState) { run.pitRequest = run.pitRequest === 'pass' ? false : 'pass'; paintBox(); } });
    drawMapBase(); markCam(); markSpeed(); paintBox();
    radio = mods.RADIO.createRadio(); radioMsgs = []; if (pb.t > 1) radio.reset(true);
    $('#h-radio-head').addEventListener('click', () => radioShow(radioMode === 'open' ? 'shut' : 'open'));
    view.resize();
    mods.DIVISION.fitHud($('#ap-track .ap-view'), _t);
    sndStart();
  }
  const markCam = () => root.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === view.camera));
  const markSpeed = () => root.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === pb.speed && !pb.skip));

  function paintBox() {
    const b = $('#h-box'); if (!b || !run) return;
    const S = view ? view.S : { lap: 0 };
    const can = !run.done && !run.pitState && !pitModal && S.lap < run.pushLaps;
    b.disabled = !can && !run.pitRequest;
    b.classList.toggle('armed', run.pitRequest === true);
    b.textContent = run.pitState ? '🅿 ' + _t('ap_pit_lane') : run.pitRequest === true ? '🅿 ' + _t('ap_box_armed') : '🅿 ' + _t('ap_box');
    const through = $('#h-through');
    if (through) { through.disabled = !can; through.classList.toggle('armed', run.pitRequest === 'pass'); }
  }

  // minimap with the sector marks
  let mapBase = null;
  function mapBounds() {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (let i = 0; i < track.N; i++) { a = Math.min(a, track.x[i]); b = Math.max(b, track.x[i]); c = Math.min(c, track.y[i]); d = Math.max(d, track.y[i]); }
    const w = 170, h = 120, s = Math.min((w - 16) / (b - a), (h - 16) / (d - c));
    return { a, d, s, ox: (w - (b - a) * s) / 2, oy: (h - (d - c) * s) / 2 };
  }
  const mapXY = (m, x, y) => [m.ox + (x - m.a) * m.s, m.oy + (m.d - y) * m.s];
  function drawMapBase() {
    const m = mapBounds(); mapBase = m;
    const c = $('#h-map'); if (!c) return; const g = c.getContext('2d');
    g.clearRect(0, 0, 170, 120);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i <= track.N; i += 3) { const [x, y] = mapXY(m, track.x[i % track.N], track.y[i % track.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke();
    // pit lane
    const P = track.pit; g.strokeStyle = 'rgba(120,200,255,.9)'; g.lineWidth = 2; g.beginPath();
    for (let k = P.inA; k < track.N + P.outB; k += 2) { const i = k % track.N; const [x, y] = mapXY(m, P.line.x[i], P.line.y[i]); k === P.inA ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    // sector marks
    for (const f of track.sectors) { const i = Math.round(f * track.N); const [x, y] = mapXY(m, track.x[i], track.y[i]); g.fillStyle = '#ffd23f'; g.fillRect(x - 3, y - 3, 6, 6); }
    mapBase.img = g.getImageData(0, 0, 170, 120);
  }
  function drawMap(S) {
    const c = $('#h-map'); if (!c || !mapBase) return; const g = c.getContext('2d');
    g.putImageData(mapBase.img, 0, 0);
    const [sx, sy] = mapXY(mapBase, track.x[0], track.y[0]); g.fillStyle = '#fff'; g.fillRect(sx - 2, sy - 5, 4, 10);
    // the field of the session, placed by its timetable
    const field = pb.msg?.timing_field;
    if (field && mods?.TIMING?.rivalPosition) {
      const el = Math.max(0, pb.t - pb.lightsOut);
      for (const r of field) {
        const q = mods.TIMING.rivalPosition(r, el, track.sectors); if (!q) continue;
        const i = Math.floor(q.frac * track.N) % track.N, [x, y] = mapXY(mapBase, track.x[i], track.y[i]);
        g.fillStyle = q.kind === 'flying' ? '#6fa8ff' : 'rgba(111,168,255,.55)'; g.beginPath(); g.arc(x, y, 3.6, 0, 7); g.fill(); g.strokeStyle = 'rgba(8,12,20,.9)'; g.lineWidth = 1.2; g.stroke();
      }
    }
    for (const k in peers) { const p = peers[k]; const [x, y] = mapXY(mapBase, p.x, p.y); g.fillStyle = '#7bb6ff'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    // our car stands out: a bigger red dot with a white ring and a halo
    const [x, y] = mapXY(mapBase, S.x, S.y);
    g.fillStyle = 'rgba(255,77,77,.28)'; g.beginPath(); g.arc(x, y, 9 + 2 * Math.sin(performance.now() / 260), 0, 7); g.fill();
    g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(x, y, 5.2, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    // the teammate is drawn last so it stays visible when the two cars run side by side
    if (cars.length > 1) {
      const o = cars[1 - carIdx].run, n = o.frames.length / o.FRAME, a = Math.max(0, Math.min(n - 1, Math.floor(pb.t * 30))) * o.FRAME;
      if (n > 1) { const [mx, my] = mapXY(mapBase, o.frames[a + 1], o.frames[a + 2]); g.fillStyle = '#ffd166'; g.beginPath(); g.arc(mx, my, 4.2, 0, 7); g.fill(); g.strokeStyle = 'rgba(8,12,20,.9)'; g.lineWidth = 1.2; g.stroke(); }
    }
  }

  // ── keeping the simulation just ahead of the replay ──
  function feedOne(r) {
    if (!r || r.done) return;
    if (r.waiting === 'decide') {
      // the pit call stays open until the replay itself reaches the point where the driver must know
      if (pb.skip || pb.t >= r.t - 0.3) r.resolve();
      return;
    }
    if (r.waiting === 'service') return;
    r.advance(8, pb.skip ? undefined : pb.t + LEAD * Math.max(1, pb.speed / 2));
  }
  const allRuns = () => (cars.length ? cars.map(c => c.run) : [run]);
  const availOf = r => Math.max(0, (r.frames.length / r.FRAME - 1) / 30);       // seconds recorded so far
  function feedSim() {
    if (!runGroup) { for (const r of allRuns()) feedOne(r); return; }
    for (const r of allRuns()) if (r.waiting === 'decide') feedOne(r);
    runGroup.advance(8, pb.skip ? undefined : pb.t + LEAD * Math.max(1, pb.speed / 2));
  }

  // Pit decisions may already be simulated ahead of the replay. Show the tyres at the watched time.
  function compoundAt(car, time) {
    return car.run.pits.findLast(p => p.t <= time)?.compound || car.msg.compound;
  }

  // The car that is watched changes; everything that belongs to one car is kept with it.
  function switchCar(i) {
    if (!cars.length || i === carIdx || pitModal || !cars[i]) return;
    const c = cars[carIdx];
    c.sec = sec; c.secColors = secColors; c.secHold = pb._secHold;
    carIdx = i; const n = cars[i];
    run = n.run; pb.msg = n.msg; sec = n.sec; secColors = n.secColors; pb._secHold = n.secHold;
    hud._n = -1; const order = $('#h-order'); if (order) order._timingTick = -1;
    view.setRun(run.frames); view.setEvents(run.events); view.setCompound(compoundAt(n, pb.t)); view.setLivery(pb.msg.livery);
    view.removeGhost('mate');
    radioClear(true);
    const state = view.sample(pb.t);
    hud(state); mods.DIVISION.updateDrivingMeters($('#ap-track'), state, _t);
    sndUpdate(state); drawMap(state);
    markCars(); paintBox();
    mods.DIVISION.fitHud($('#ap-track .ap-view'), _t);
  }
  const markCars = () => root.querySelectorAll('[data-car]').forEach(b => b.classList.toggle('on', +b.dataset.car === carIdx));

  // ── playback ──
  let saveAt = 0, savedInputs = 0;
  // the server keeps how far the session got and what was decided, for a reload
  function saveProgress() {
    if (!cars.length || cars.every(c => c.run.done) || pb.sent || !pb.msg?.session) return;
    const now = performance.now(), count = cars.reduce((n, c) => n + c.run.inputs.length, 0);
    if (now - saveAt < 3000 && count === savedInputs) return;
    saveAt = now; savedInputs = count;
    const lead = cars[0].run, progress = { t: lead.t, pbt: pb.t, armed: !!lead.pitRequest, pass: lead.pitRequest === 'pass', inputs: lead.inputs };
    if (cars.length > 1) progress.cars = { [cars[1].key]: { t: cars[1].run.t, armed: !!cars[1].run.pitRequest, pass: cars[1].run.pitRequest === 'pass', inputs: cars[1].run.inputs } };
    send({type:'ap_progress', session: pb.msg.session, progress });
  }
  function tick(dt) {
    if (!run) return;
    feedSim();
    saveProgress();
    const runs = allRuns(), going = r => !r.done && r.waiting !== 'service', live = runs.filter(r => !r.done);
    // time moves only as far as every car that is still driving has been simulated
    const avail = live.length ? Math.min(...live.map(availOf)) : Math.max(...runs.map(availOf));
    if (pb.skip && runs.some(going)) {
      for (let g = 0; g < 40 && runs.some(going) && !runs.some(r => r.waiting === 'service'); g++) {
        for (const r of runs) if (r.waiting === 'decide') r.resolve();
        runGroup ? runGroup.advance(30) : runs.filter(going).forEach(r => r.advance(30));
      }
      const still = runs.filter(r => !r.done);
      pb.t = still.length ? Math.min(...still.map(r => Math.min(r.t, availOf(r)))) : Math.max(...runs.map(availOf));
    }
    else if (pb.playing) pb.t = Math.min(pb.t + dt * (pb.skip ? 60 : pitModal ? 1 : pb.speed), avail);
    if (pitModal && run.waiting === 'service') {
      // the car stands at its box and the session clock keeps running at real speed, for the other car too
      for (let k = 0, n = Math.min(480, Math.ceil(dt * 240)); k < n; k++) {
        for (const r of runs) if (r.waiting === 'decide') r.resolve();
        runGroup ? runGroup.step() : runs.filter(r => !r.done).forEach(r => r.step());
      }
      const left = pb.msg.duration == null ? 1 : pb.msg.duration - Math.max(0, run.t - pb.lightsOut);
      const ck = $('#ap-pit-clock'); if (ck) ck.textContent = pb.msg.duration == null ? '' : _t('ap_time_left', { time: Math.floor(Math.max(0, left) / 60) + ':' + String(Math.floor(Math.max(0, left) % 60)).padStart(2, '0') });
      if (left <= 0) { const go = $('#ap-pit-go'); if (go && !go.disabled) go.click(); }
    }
    if (pb.skip && runs.every(r => r.done)) { pb.t = Math.max(...runs.map(availOf)); pb.skip = false; markSpeed(); }
    // the car that stands at its box is shown, and the player may work on it
    const served = runs.find(r => r.waiting === 'service' && pb.t >= availOf(r) - 0.05);
    if (served && !pitModal) { if (served !== run) switchCar(runs.indexOf(served)); }
    const S = view.sample(pb.t);
    if (served && !pitModal && served === run) openPit();
    if (runs.every(r => r.done) && pb.t >= avail - 0.05 && !pb.sent) finishRun();
    // the other car is a ghost on the circuit
    if (cars.length > 1) {
      const o = cars[1 - carIdx], r = o.run, n = r.frames.length / r.FRAME, a = Math.max(0, Math.min(n - 1, Math.floor(pb.t * 30))) * r.FRAME;
      if (n > 1) view.ghost('mate', { x: r.frames[a + 1], y: r.frames[a + 2], psi: r.frames[a + 3], col: 0, livery: o.msg.livery, name: o.name });
    }
    // start lights
    const lo = pb.lightsOut, lights = $('#h-lights');
    if (!run.race) { lights.hidden = true; view.lights(0); }
    else if (pb.t < lo + 1.2) {
      const n = pb.t < lo ? Math.max(0, Math.min(5, Math.floor((pb.t - 1.0) / 0.8) + 1)) : 0;
      view.lights(n); lights.hidden = false; lights.innerHTML = [0, 1, 2, 3, 4].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      if (pb.t >= lo) lights.hidden = true;
    } else { lights.hidden = true; view.lights(0); }
    hudAcc += dt;
    if (hudAcc > 0.05) { hudAcc = 0; hud(S); paintBox(); if (++fitN % 6 === 0) mods.DIVISION.fitHud($('#ap-track .ap-view'), _t); }
    posAcc += dt;
    if (posAcc > 0.125 && pb.playing && !pb.sent) { posAcc = 0; send({type:'ap_pos', x: S.x, y: S.y, psi: S.psi, v: Math.hypot(S.u, S.v), lap: S.lap, col: myCol, best: mods.TIMING.qualifyingTiming(run,S.t,S.lap,timingBase()).bestLap }); }
    mods.DIVISION.updateDrivingMeters($('#ap-track'),S,_t);
    sndUpdate(S);view.paintSound?.();
    drawMap(S);
    radioTick(S);
    const nm = $('#h-names');
    if (nm) nm.innerHTML = view.ghostList().map(g => { const p = view.project(g.x, g.y); return p.ok ? `<div class="ap-tag" style="left:${p.x}px;top:${p.y}px">${esc(g.name)}</div>` : ''; }).join('');
  }

  // The driver's radio: what happens on the track, said as it happens, in a block at the right of the picture.
  const RADIO_KEEP = 40, RADIO_SHOW_MS = 9000;
  // A new message shows alone for a few seconds and the block folds back to its title. The title opens the whole
  // list, which stays open (and scrolls) until the title is pressed again.
  let radioTimer = 0, radioMode = 'shut';
  function radioShow(mode) {
    clearTimeout(radioTimer);
    const box = $('#h-radio'); if (!box) return;
    radioMode = mode;
    box.classList.remove('shut', 'peek', 'open'); box.classList.add(mode);
    $('#h-radio-head')?.setAttribute('aria-expanded', mode === 'open');
    mods.DIVISION.fitHud($('#ap-track .ap-view'), _t);
    if (mode === 'peek') radioTimer = setTimeout(() => radioShow('shut'), RADIO_SHOW_MS);
  }
  function radioText(m) {
    const v = ((m.variant - 1) % 2) + 1;
    for (const k of ['ap_rd_' + m.key + '_' + v, 'ap_rd_' + m.key + '_1', 'ap_rd_' + m.key]) { const x = _t(k, m.params); if (x !== k) return x; }
    return '';
  }
  function paintRadio() {
    const box = $('#h-radio-list'); if (!box) return;
    const keep = box.scrollTop;
    box.innerHTML = radioMsgs.map(m => `<div class="ap-radio-msg ${m.tone}${m.fresh ? ' new' : ''}"><em>${esc(m.lap)}</em><span>${esc(m.text)}</span></div>`).join('');
    box.scrollTop = keep;
    for (const m of radioMsgs) m.fresh = false;
  }
  function radioClear(mute) { if (radio) radio.reset(mute); radioMsgs = []; paintRadio(); radioShow('shut'); }
  let radioT = 0;
  function radioTick(S) {
    if (!radio || !run || !pb.msg || !mods) return;
    const t = pb.t, hr = (pb.msg.hour_frac ?? pb.msg.hour) + t / 3600;
    if (t + 0.5 < radioT && radioMsgs.length) { radioMsgs = []; paintRadio(); }
    radioT = t;
    const out = radio.update({ run, fr: S.fr || 0, t, quiet: pb.skip, cond: mods.SIM.condAt(pb.msg.forecast, hr), refSectors: ownSectors(), fb: run.drv?.fb || 0,
      duration: pb.msg.duration, initialCompound: pb.msg.compound, compounds: mods.SIM.COMPOUNDS, fmt: lapStr, fmtS: secStr, fmtD: d => Math.abs(d).toFixed(3), part: k => _t('ap_part_' + k) });
    for (const m of out) {
      const text = radioText(m); if (!text) continue;
      radioMsgs.unshift({ id: ++radioId, text, tone: m.tone, fresh: true, lap: fmtClock(t - (pb.lightsOut || 0)) });
    }
    if (out.length) { radioMsgs.length = Math.min(radioMsgs.length, RADIO_KEEP); paintRadio(); if (radioMode !== 'open') radioShow('peek'); }
  }
  const fmtClock = sec => { const x = Math.max(0, Math.floor(sec)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };

  // A personal practice (not a tournament or a weekend) is coloured against the best sectors this driver ever set here.
  function ownSectors() { return pb?.msg?.kind === 'practice' && !pb.msg.weekend && sec?.personal?.some(x => x > 0) ? sec.personal : null; }
  function timingBase() { return { ...sec, field: pb.msg.timing_field, offset: pb.lightsOut, own: ownSectors() }; }

  function hud(S) {
    const v = Math.hypot(S.u, S.v) * 3.6;
    $('#h-speed').textContent = Math.round(v);
    $('#h-gear').textContent = S.gear < 0 ? 'R' : v < 3 ? 'N' : S.gear;
    const compound = compoundAt(cars[carIdx], S.t);
    view.setCompound(compound);
    const fr = S.fr || 0, F = run.frames, tC = mods.SIM.COMPOUNDS[compound].Topt;
    const temps = [F[fr + 12], F[fr + 13], F[fr + 14], F[fr + 15]];
    {
      const tempCol = t => { const d = (t - tC) / 22; return d < -1 ? '#4da3ff' : d < -0.4 ? '#7fd6ff' : d < 0.6 ? '#4fd18b' : d < 1.2 ? '#f2c230' : '#ff5a4d'; };
      const wears = [F[fr + 32], F[fr + 33], F[fr + 34], F[fr + 35]];
      const completed = run.laps.filter(l => l.t0 + l.time <= S.t + 1e-6);
      const tyreStop = run.pits.findLast(p => p.tyres && p.t <= S.t)?.t ?? -Infinity;
      const n = completed.length;
      if (hud._n !== n || hud._tyreStop !== tyreStop) {
        hud._n = n; hud._tyreStop = tyreStop;
        const rows = mods.ANALYSIS.lapRows({ laps: completed });
        hud._ty = mods.ANALYSIS.tyreStats(rows.filter((r, i) => completed[i].t0 >= tyreStop), { compoundNow: compound });
      }
      if (hud._ty.mean > 0.0005) hud._ty.lapsLeft = Math.max(0, (CLIFF - wears.reduce((a, b) => a + b, 0) / 4) / hud._ty.mean);
      const tErr = FX ? FX.tyreErr(lvl('strategist')) : null, left = tErr != null && hud._ty && hud._ty.lapsLeft != null ? lapsSpan(Math.max(0, hud._ty.lapsLeft), tErr) : null;
      $('#h-tyres').innerHTML = mods.DIVISION.tyreHudHtml({compound,wear:wears,temps,tempColor:tempCol,remaining:true},_t)
        +(left==null?'':`<div class="ap-wheel-footer"><span>${esc(_t('ap_rt_left',{n:left}))}</span></div>`);
    }
    $('#h-fuel').textContent = (F[fr + 17] / FUEL_KG_PER_L).toFixed(1) + ' L'; $('#h-ers').textContent = Math.round(F[fr + 18] * 100) + '%';;
    const nowMs0 = performance.now();
    const hr = (pb.msg.hour_frac ?? pb.msg.hour) + S.t / 3600;
    const cn = mods.SIM.condAt(pb.msg.forecast, hr);
    pb.wxLast = { hr, t: S.t, lap: S.lap, laps: run.laps };
    if (!pb.wxTextAt || nowMs0 - pb.wxTextAt > 2000) { pb.wxTextAt = nowMs0; $('#h-wx').innerHTML = wxNowHtml(mods.SIM, pb.msg.forecast, hr, cn); }
    const nowMs = performance.now();
    if (!pb.wxAt || nowMs - pb.wxAt > 1500) { pb.wxAt = nowMs; view.setConditions(cn, hr); }
    // laps
    const L = run.laps, lp = S.lap, race = pb.msg.kind === 'race';
    let start = 0, label = S.t < pb.lightsOut + 1 ? _t('ap_pre') : _t(race ? 'ap_lapn' : 'ap_outlap', { n: 1, m: run.pushLaps + 1 });
    if (lp >= 0) { const rec = L.find(l => l.n === lp); start = rec ? rec.t0 : lapStartOf(lp); label = race ? _t('ap_lapn', { n: lp + 1, m: run.pushLaps + 1 }) : lp === 0 ? _t('ap_outlap') : _t('ap_lapn', { n: lp, m: run.pushLaps }); }
    if(pb.msg.duration&&lp>=1){const phase=pb.msg.weekend?.phase||(pb.msg.kind==='qualifying'?'qualifying':'practice');label=_t(phase==='qualifying'?'ap_qual_lap':'ap_practice_lap',{n:lp});}
    const remaining=pb.msg.duration==null ? null : Math.max(0,pb.msg.duration-Math.max(0,S.t-pb.lightsOut));
    $('#h-session-clock').textContent=remaining==null ? '' : remaining>0 ? _t('ap_time_left',{time:Math.floor(remaining/60)+':'+String(Math.floor(remaining%60)).padStart(2,'0')}) : _t('ap_finish_current_lap');
    $('#h-lap').dataset.n = Math.max(0, race ? lp + 1 : lp); if (pb.msg.duration) delete $('#h-lap').dataset.m; else $('#h-lap').dataset.m = race ? run.pushLaps + 1 : run.pushLaps;
    $('#h-lap').textContent = (race ? '🏁 ' : '') + label + (S.pit === 1 || S.pit === 2 ? ' · 🅿' : '');
    $('#h-time').textContent = lp >= 0 ? lapStr(Math.max(0, S.t - start)) : '–:––.–––';
    const timing = mods.TIMING.qualifyingTiming(run, S.t, lp, timingBase());
    Object.assign(secColors,timing.colors);
    if ((lp >= 1 || race && lp >= 0) && timing.invalid) $('#h-lap').textContent += ' · ' + _t('ap_lap_deleted');
    const deltaText = d => d == null ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(3);
    // Cumulative from the start: the record on top (the best sectors that stood before this lap's own), our own total below with the gap to it.
    const cumStr = x => x == null ? '—' : x >= 60 ? lapStr(x) : x.toFixed(3);
    const buildSecs = (cells, live) => {
      let refCum = 0, myCum = 0, refOk = true, myOk = true;
      return [0,1,2].map(i => {
        const mark=cells[i];
        const ref = mark ? mark.valid ? (mark.delta == null ? mark.time : mark.time - mark.delta) : null : timing.overallBests[i];
        refOk = refOk && ref != null; refCum += ref ?? 0;
        myOk = myOk && !!mark && mark.valid; myCum += mark?.valid ? mark.time : 0;
        return {cls:'sc '+(mark ? mark.color : live && S.sec === i && lp >= 0 ? 'cur' : ''),b:cumStr(refOk ? refCum : null),
          em:mark ? mark.valid ? myOk ? cumStr(myCum)+' '+deltaText(refOk ? myCum-refCum : null) : '✖' : '✖' : live && S.sec === i && lp >= 0 ? '…' : ''};
      });
    };
    const secNow = buildSecs(timing.cells, true);
    // When a lap ends its three sector cards stay for 5 seconds, then fade and the new lap's cards come in.
    // The last sector is set at the very moment the lap changes, so the old lap's cards are rebuilt from its marks.
    const sh=pb._secHold||(pb._secHold={lp,hold:null,fresh:0});
    if(sh.hold&&(S.t<sh.hold.until-5.7||lp<sh.lp))sh.hold=null;
    if(lp!==sh.lp){
      if(lp>sh.lp&&sh.lp>=(run.race?0:1)){
        const old=[0,1,2].map(i=>timing.marks.findLast(e=>e.lap===sh.lp&&e.sec===i)||null);
        if(old.some(Boolean))sh.hold={arr:buildSecs(old,false),until:S.t+5};
      }
      sh.lp=lp;
    }
    if(sh.hold&&S.t>=sh.hold.until){sh.hold=null;sh.fresh=S.t+.7;}
    const shown=sh.hold?sh.hold.arr:secNow,fading=sh.hold&&S.t>=sh.hold.until-.7,fresh=!sh.hold&&S.t<sh.fresh&&S.t>sh.fresh-.8;
    for (let i=0;i<3;i++) {
      const el=$('#hs'+i),x=shown[i];
      el.className=x.cls+(fading?' sc-fade':fresh?' sc-fresh':'');
      el.querySelector('b').textContent=x.b;
      el.querySelector('em').textContent=x.em;
    }
    const done=timing.completed.filter(l => !l.out);
    $('#h-last').textContent='';
    if (done.length) {
      const lastL=done[done.length-1];
      $('#h-last').textContent=_t('ap_last')+' '+lapStr(lastL.time)+(!lastL.valid || lastL.pit || lastL.pen ? ' ✖' : '')+(lastL.pen ? ' +'+lastL.pen+'s' : '')+(timing.bestLap != null ? ' · '+_t('ap_best')+' '+lapStr(timing.bestLap) : '');
    }
    paintOrder(timing.bestLap,timing,S);
    const latest=timing.latest, bn=$('#h-banner');
    if (latest && latest.valid && S.t-latest.t < 3) {
      bn.hidden=false; bn.className='ap-banner sec-'+latest.color;
      bn.textContent='S'+(latest.sec+1)+'  '+secStr(latest.time)+'  '+deltaText(latest.delta);
    }
    const ban = $('#h-banner');
    if (latest && latest.valid && S.t-latest.t < 3) { /* the current lap's sector result */ }
    else {
      const ev = run.events.filter(e => e.t <= S.t && e.t > S.t - 4 && ['spin', 'crash', 'limits', 'error', 'failure', 'pit-in', 'pit-stop', 'recovering', 'rejoined', 'recovery', 'garage', 'fuel'].includes(e.type));
      if (ev.length) { const e = ev[ev.length - 1]; ban.hidden = false; ban.className = 'ap-banner'; ban.textContent = e.type === 'failure' ? _t('ap_ev_failure', { part: _t('ap_part_' + e.part) }) : e.type === 'limits' && pb.msg.kind === 'race' ? _t('ap_ev_penalty') : (e.type === 'crash' && e.heavy ? _t('ap_ev_crash_h') : _t('ap_ev_' + e.type.replace('-', '_'))); }
      else if (S.pit === 3) { ban.hidden=false; ban.className='ap-banner'; ban.textContent=_t('ap_ev_recovery'); }
      else if (!(pb.sent && run.done)) ban.hidden = true;
    }
  }
  // the team's other car, as it stands in the timing now
  function mateRows() {
    if (cars.length < 2) return [];
    const o = cars[1 - carIdx], t = pb.t, r = o.run;
    const clean = r.laps.filter(l => l.t0 + l.time <= t + 1e-6 && l.valid && !l.out && !l.pit && !l.pen);
    return [{ id: o.key||'mate', name: o.name, compound: r.pits.findLast(p => p.t <= t)?.compound || o.msg.compound, status: r.done ? 'pit' : (r.frames[Math.max(0, Math.min(r.frames.length / r.FRAME - 1, Math.floor(t * 30))) * r.FRAME + Math.max(0, (simMod?.FRAME_FIELDS||[]).indexOf('lap'))] || 0) <= 0 ? 'out' : 'flying', best: clean.length ? Math.min(...clean.map(l => l.time)) : null }];
  }
  function paintOrder(best,timing=null,state=null) {
    const host=$('#h-order'); if (!host || !pb.msg) return;
    if(pb.msg.timing_field){
      const tick=Math.floor(pb.t*10);
      if(host._timingTick===tick&&host._timingBest===best)return;
      host._timingTick=tick;host._timingBest=best;
      host.closest('.ap-tower').classList.add('ap-session-tower');
      const rows=mods.TIMING.sessionClassification(pb.msg.timing_field,Math.max(0,pb.t-pb.lightsOut),cars[carIdx]?.name||G.driver.name,best,(timing?.marks||[]).map(m=>({...m,t:m.t-pb.lightsOut})),mateRows(),cars[carIdx]?.key||'player');
      const own=rows.find(r=>r.mine),caption=$('#h-own-position');
      const delta=x=>x==null?'—':'+'+x.toFixed(3);
      caption.hidden=false;const ownText=_t('ap_position',{n:own.position,m:rows.length})+' · '+delta(own.gap);if(caption.textContent!==ownText)caption.textContent=ownText;
      const head=host.closest('.ap-tower').querySelector('.ap-tower-head span'),heading=_t('ap_best')+' / '+_t('ap_gap');if(head.textContent!==heading)head.textContent=heading;
      const ownRow=rows.find(r=>r.mine);
      const pit=run.pits.findLast(p=>p.t<=pb.t);
      Object.assign(ownRow,{compound:pit?.compound||cars[carIdx]?.msg.compound||pb.msg.compound,status:state?.pit?'pit':state?.lap<=0?'out':'flying',cells:timing?.cells||[]});
      const tyre=r=>`<i class="ap-tyre-badge tyre-${esc(r.compound||'M')}" title="${esc(_t('ap_c_'+(r.compound||'M')))}">${esc(r.compound||'M')}</i>`;
      const status=r=>_t('ap_status_'+(r.status||'pit'));
      const code=r=>r.status==='pit'?'P':r.status==='out'?'↗':r.status==='in'?'↘':'●';
      const bars=r=>`<span class="ap-sector-bars">${[0,1,2].map(i=>`<i class="${r.cells?.[i]?.color||''}" title="S${i+1}${r.cells?.[i]?' '+secStr(r.cells[i].time):''}"></i>`).join('')}</span>`;
      const rowHtml=r=>`<b>${r.position}</b><span class="ap-rival-info"><span class="ap-rival-name">${esc(r.name)}</span><span class="ap-rival-meta">${tyre(r)}<i class="ap-track-status" aria-label="${esc(status(r))}">${code(r)}</i>${bars(r)}</span></span><strong>${lapStr(r.best)}<small>${delta(r.gap)}</small></strong>`;
      // Keyed rows slide to their new place; a driver who climbs is lifted and lit, and a long climb takes longer so it can be followed.
      const rh=innerWidth<=650?38:44,keep=host._rows||(host._rows=new Map()),ids=new Set(rows.map(r=>r.pid));
      host.classList.add('ap-session-order');host.style.setProperty('--rh',rh+'px');let spacer=host.querySelector(':scope > .ap-order-spacer');
      if(!spacer){spacer=document.createElement('div');spacer.className='ap-order-spacer';host.prepend(spacer);}
      spacer.style.height=rows.length*rh+'px';
      for(const [pid,el] of keep) if(!ids.has(pid)){el.remove();keep.delete(pid);}
      rows.forEach((r,i)=>{
        let el=keep.get(r.pid);
        if(!el||el.parentNode!==host){el=document.createElement('div');el.className='ap-order-row';el._i=i;el.style.setProperty('--i',i);keep.set(r.pid,el);host.insertBefore(el,host.querySelector(':scope > .ap-order-pin'));}
        if(el._i!==i){
          const d=Math.abs(el._i-i);el.style.transitionDuration=Math.min(1.8,.45+.12*d)+'s';
          if(i<el._i){el.classList.add('gain');clearTimeout(el._gain);el._gain=setTimeout(()=>el.classList.remove('gain'),Math.min(1.8,.45+.12*d)*1000+500);}
          el._i=i;el.style.setProperty('--i',i);
        }
        el.dataset.teamCar=r.pid;el.dataset.trackStatus=r.status||'pit';el.classList.toggle('mine',!!r.mine);el.classList.toggle('teammate',!!r.teammate);
        const html=rowHtml(r);if(el._html!==html){el.innerHTML=html;el._html=html;}
        const title=r.name+' · '+status(r);if(el.title!==title)el.title=title;
      });
      mods.DIVISION.focusClassification(host,state?.lap);
      const active=$('#h-active-rivals');
      if(active){
        active.style.bottom=(host.closest('.ap-view').querySelector('.ap-ctl').offsetHeight+10)+'px';
        // Three places, held until the lap that was started in them is over: nobody is swapped out half way.
        // A free place goes to the fastest rival on a flying lap, and while nobody has a time yet to the one who left first.
        const now=Math.max(0,pb.t-pb.lightsOut);
        if(active._t==null||now<active._t-.5)active._slots=[];
        active._t=now;
        const slots=active._slots||(active._slots=[]),byId=new Map(rows.map(r=>[r.pid,r]));
        for(let i=slots.length-1;i>=0;i--){
          const slot=slots[i],r=byId.get(slot.pid);
          if(!r){slots.splice(i,1);continue;}
          if(slot.doneAt==null&&!(r.status==='flying'&&r.lapEnd===slot.lapEnd))slot.doneAt=now;
          if(slot.doneAt!=null&&now-slot.doneAt>=3)slots.splice(i,1);   // the last sector stays readable for a moment
        }
        if(slots.length<3){
          const taken=new Set(slots.map(x=>x.pid)),timed=rows.some(r=>!r.mine&&r.best!=null);
          rows.filter(r=>!r.mine&&r.status==='flying'&&r.lapEnd!=null&&!taken.has(r.pid))
            .sort((a,b)=>(timed?(a.best??Infinity)-(b.best??Infinity):0)||a.lapStart-b.lapStart||String(a.pid).localeCompare(String(b.pid)))
            .slice(0,3-slots.length).forEach(r=>slots.push({pid:r.pid,lapEnd:r.lapEnd,doneAt:null}));
        }
        // Cumulative from the start, as on our own card: the rival's total to this sector and the gap to the record to the same point.
        const cumStr=x=>x==null?'—':x>=60?lapStr(x):x.toFixed(3),deltaText=d=>d==null?'—':(d>0?'+':d<0?'−':'±')+Math.abs(d).toFixed(3);
        const body=r=>{
          let cum=0,ref=0,ok=true,refOk=true;
          const splits=[0,1,2].map(i=>{
            const c=r.cells?.[i];
            ok=ok&&!!c;cum+=c?c.time:0;
            const rec=timing.overallBests[i];refOk=refOk&&rec!=null;ref+=rec??0;
            const gap=c&&refOk?cum-ref:null;
            return `<div class="${c?.color||''}"><small>S${i+1}</small><b>${c?cumStr(cum):'…'}</b><em>${c?deltaText(gap):''}</em></div>`;});
          // a phone shows the small chip (position, three letters, time to the last sector) until it is tapped
          return `<div class="ap-rival-chip"><b>${r.position??''}</b><span>${esc(String(r.name).slice(0,3))}</span><i>${r.cells?.[0]?cumStr(cum):'—'}</i><u>${[0,1,2].map(i=>`<s class="${r.cells?.[i]?.color||''}"></s>`).join('')}</u></div><div class="ap-rival-card-head"><b>${r.position??''} ${esc(r.name)}</b>${tyre(r)}</div><div class="ap-rival-splits">${splits.join('')}</div>`;
        };
        if(!active._tap){active._tap=true;active.addEventListener('click',e=>{const card=e.target.closest('.ap-rival-card');if(!card||innerWidth>640)return;const on=!card.classList.contains('open');active.querySelectorAll('.ap-rival-card.open').forEach(c=>c.classList.remove('open'));if(on)card.classList.add('open');});}
        // Cards are kept per rival: a new one slides in, one that has finished its last sector stays readable, then fades out while the next ones close the gap.
        const els=active._els||(active._els=new Map()),wanted=new Set(slots.map(x=>x.pid));
        for(const [pid,el] of els) if(!wanted.has(pid)){
          els.delete(pid);el.classList.add('leaving');el.addEventListener('animationend',()=>el.remove(),{once:true});setTimeout(()=>el.remove(),1200);
        }
        slots.forEach(x=>{
          const r=byId.get(x.pid);let el=els.get(x.pid);
          if(!el){el=document.createElement('div');el.className='ap-rival-card entering';el.style.setProperty('--enter-delay',(active.querySelector('.ap-rival-card.leaving')?.6:0)+'s');els.set(x.pid,el);active.appendChild(el);el.addEventListener('animationend',()=>el.classList.remove('entering'),{once:true});}
          const html=body(r);if(el._html!==html){el.innerHTML=html;el._html=html;}
        });
      }
      return;
    }
    // Room bests belong to a player across runs, not to either car in this session.
    // Watching another car must only change the highlight, never its time or tie-break.
    const pid=pb.msg.pid, rows=multi ? board.filter(r => r.pid !== pid).map(r => ({...r,best:peers[r.pid]?.best ?? r.best})) : [];
    rows.push({pid:cars[carIdx]?.key||'player',name:cars[carIdx]?.name || pb.msg.name || G.driver.name || _t('ap_you'),best,mine:true});
    for(const t of mateRows())rows.push({pid:t.id,name:t.name,best:t.best,teammate:true});
    rows.sort((a,b) => (a.best ?? Infinity)-(b.best ?? Infinity) || String(a.pid).localeCompare(String(b.pid)));
    host.innerHTML=rows.map((r,i) => `<div data-team-car="${esc(r.pid)}" class="ap-order-row ${r.mine ? 'mine' : ''}${r.teammate ? ' teammate' : ''}"><b>${i+1}</b><span>${esc(r.name)}</span><strong>${lapStr(r.best)}</strong></div>`).join('');
    mods.DIVISION.focusClassification(host,state?.lap);
  }
  function lapStartOf(n) { const l = run.laps.find(x => x.n === n - 1); return l ? l.t0 + l.time : 0; }

  // ── the pit box: first what the car did, then what the rules allow you to change ──
  const TYRE_NAMES = ['FL', 'FR', 'RL', 'RR'];
  const wearCol = w => (w < 0.4 ? '#4fd18b' : w < 0.62 ? '#f2c230' : w < CLIFF ? '#ff9a4d' : '#ff5a5a');
  // The team's advised range for each setting: the bar shows the range, the marker where the car is now.
  function sugBarsHtml(sug) {
    return sug.items.slice(0, 7).map(it => {
        const span = it.max - it.min, lo = (it.lo - it.min) / span * 100, hi = (it.hi - it.min) / span * 100, cur = (it.cur - it.min) / span * 100;
        const fmt = v => (it.step < 1 ? (+v).toFixed(1) : Math.round(v)) + (it.unit ? ' ' + it.unit : '');
        return `<div class="ap-sug${it.inRange ? ' ok' : ''}"><div class="ap-set-h"><label>${esc(_t('ap_s_' + it.key))}</label><output>${it.inRange ? '✓ ' + esc(_t('ap_an_in_range')) : (it.move > 0 ? '▲ ' : '▼ ') + esc(_t('ap_an_move', { lo: fmt(it.lo), hi: fmt(it.hi) }))}</output></div>
          <div class="ap-sugbar"><i style="left:${lo}%;width:${Math.max(2, hi - lo)}%"></i><b style="left:${cur}%" title="${esc(fmt(it.cur))}"></b>${it.prior != null ? `<u style="left:${(it.prior - it.min) / span * 100}%" title="★ ${esc(fmt(it.prior))}"></u>` : ''}</div></div>`;
    }).join('');
  }

  function analysisHtml(an, locked) {
    const rows = an.rows.filter(r => !r.out).slice(-6);
    const bal = u => (u > 0.012 ? _t('ap_an_under') : u < -0.012 ? _t('ap_an_over') : _t('ap_an_neutral'));
    const table = rows.length ? `<div class="ap-scroll"><table class="ap-table ap-an-table"><tr><th>#</th><th>${esc(_t('ap_time_h'))}</th><th>${esc(_t('ap_an_balance'))}</th><th>${esc(_t('ap_an_locks'))}</th><th>${esc(_t('ap_an_spin'))}</th><th>${esc(_t('ap_an_temps'))}</th><th>${esc(_t('ap_an_wear_lap'))}</th></tr>${rows.map(r => `<tr class="${r.valid ? '' : 'inv'}"><td>${r.n}</td><td>${lapStr(r.time)}${r.pit ? ' 🅿' : ''}</td>
        <td>${r.m ? esc(bal(r.m.us)) : '–'}</td><td>${r.m ? r.m.lockF.toFixed(1) + ' / ' + r.m.lockR.toFixed(1) + ' s' : '–'}</td><td>${r.m ? r.m.spin.toFixed(1) + ' s' : '–'}</td>
        <td>${r.m ? Math.round(r.m.tAvg.reduce((a, b) => a + b, 0) / 4) + '°' : '–'}</td><td>${(r.wearDelta.reduce((a, b) => a + b, 0) / 4 * 100).toFixed(1)}%</td></tr>`).join('')}</table></div>` : `<p class="ap-hint">${esc(_t('ap_an_no_data'))}</p>`;
    const ty = an.tyres, tiles = ty.wear.map((w, i) => {
      const left = 100 - Math.round(Math.max(0, Math.min(1, w)) * 100);
      return `<div class="ap-tyretile"><small>${TYRE_NAMES[i]}</small><b style="color:${wearCol(w)}">${left}%</b><div class="ap-meter"><i style="width:${left}%;background:${wearCol(w)}"></i></div><em>${Math.round(rows.length ? rows[rows.length - 1].tyreT[i] : 0)}°</em></div>`;
    }).join('');
    const tyreBlock = `<h3>${esc(_t('ap_an_tyres'))} · ${esc(_t('ap_c_' + ty.compound))} · ${esc(_t('ap_hud_left'))}</h3><div class="ap-tyretiles">${tiles}</div>
      <p class="ap-hint">${ty.samples ? esc(_t('ap_an_tyre_rate', { rate: (ty.mean * 100).toFixed(1), n: ty.samples })) + (ty.lapsLeft != null && FX && FX.tyreErr(lvl('strategist')) != null ? ' ' + esc(_t('ap_an_laps_left', { n: lapsSpan(ty.lapsLeft, FX.tyreErr(lvl('strategist'))) })) : '') : esc(_t('ap_an_no_data'))}</p>`;
    let sug = '';
    if (locked) sug = `<p class="ap-hint">${esc(_t('ap_an_locked'))}</p>`;
    else if (an.sug.n || an.sug.items.length) {
      const items = sugBarsHtml(an.sug);
      sug = `<h3>${esc(_t('ap_an_suggest_title'))}</h3><p class="ap-hint">${esc(an.sug.n ? _t('ap_an_suggest_hint', { n: an.sug.n }) : _t('ap_an_prior_hint'))}</p><div class="ap-sugs">${items}</div>`;
    }
    return table + tyreBlock + sug;
  }

  // The parts of the car at the box: how each stands (its wear and what the crashes did) and which spares of the team's
  // warehouse can go on instead. Nothing is repaired on the spot; a part that is not changed is repaired in the garage.
  const PART_ORDER = ['frontWing', 'rearWing', 'floor', 'suspension', 'brakes', 'engine', 'gearbox', 'battery'];
  const SWAP_SECONDS = { frontWing: 4, rearWing: 4, floor: 10, suspension: 10, brakes: 8, battery: 8, engine: 15, gearbox: 15 };
  const hurt = k => run.partDamage?.[k] || 0;
  const usedSpares = () => new Set(cars.flatMap(c => (c.run.swaps || []).map(x => x.unit)));
  const sparesOf = k => { const used = usedSpares(); return (G.warehouse.parts || []).filter(u => u.part === k && u.wear < 0.98 && !used.has(u.id)); };
  const spareLabel = u => _t('ap_pit_spare', { ver: u.ver || 1, left: Math.round((1 - u.wear) * 100) });
  function carConditionHtml() {
    const rows = PART_ORDER.map(k => {
      const wear = pb.msg.parts?.[k] || 0, dmg = hurt(k), left = Math.max(0, 1 - wear - dmg), spares = sparesOf(k);
      const fix = spares.length
        ? `<label class="ap-service-option">${esc(_t('ap_pit_swap'))} <select data-swap="${k}"><option value="">${esc(_t('ap_pit_keep'))}</option>${spares.map(u => `<option value="${esc(u.id)}">${esc(spareLabel(u))}</option>`).join('')}</select><b>${SWAP_SECONDS[k]} s</b></label>`
        : `<p class="ap-hint">${esc(_t('ap_pit_no_spare'))}</p>`;
      return `<div class="ap-set"><div class="ap-set-h"><label>${esc(_t('ap_part_' + k))}</label><output style="color:${healthCol(1 - left)}">${Math.round(left * 100)}%${dmg > 0.005 ? ' · ' + esc(_t('ap_pit_damaged', { n: Math.round(dmg * 100) })) : ''}</output></div><div class="ap-meter"><i style="width:${Math.round(left * 100)}%;background:${healthCol(1 - left)}"></i></div>${fix}</div>`;
    }).join('');
    return `<div id="ap-pit-parts"><h3>${esc(_t('ap_pit_condition'))}</h3><p class="ap-hint">${esc(_t('ap_pit_condition_hint'))}</p>${rows}<p class="ap-warn" id="ap-pit-must-repair" hidden>${esc(_t('ap_pit_must_repair'))}</p></div>`;
  }
  // part -> unit id for every spare chosen; the same unit cannot go on two parts, and each part has its own list
  const swapChoice = () => Object.fromEntries([...document.querySelectorAll('#ap-pitpanel [data-swap]')].filter(i => i.value).map(i => [i.dataset.swap, i.value]));
  const swapTime = r => Object.keys(r || {}).reduce((a, k) => a + (SWAP_SECONDS[k] ?? 10), 0);
  // The car's overall damage after the chosen swaps: too much and it cannot go back out.
  function projectedDamage(r) {
    const all = Object.values(run.partDamage || {}).reduce((a, b) => a + b, 0), left = Object.keys(run.partDamage || {}).filter(k => !(r || {})[k]).reduce((a, k) => a + run.partDamage[k], 0);
    return all > 0 ? run.damage * left / all : 0;
  }

  function openPit() {
    pitModal = true; pb.skip = false; pb.speed = 1; markSpeed();
    const M = mods, weekend = !!pb.msg.tyres, locked = !!pb.msg.locked_setup;
    const cur = run.compoundNow, s = run.setup, rec = recShown(run.condNow || cond(pb.msg.hour));
    const maxFuel = Math.max(0, Math.floor(110 - run.fuel));
    const rows = M.ANALYSIS.lapRows(run), an = { rows, tyres: M.ANALYSIS.tyreStats(rows, run), sug: adviceFor(M.ANALYSIS, run, rows, pb.msg.track, run.condNow || cond(pb.msg.hour)) };
    const sugOf = k => an.sug.items.find(x => x.key === k);
    // sets that may still be fitted: not the one on the car, not used earlier in this session, not finished
    const used = new Set([...(run.tyreLogNow ? run.tyreLogNow().map(e => e.set) : [])]);
    const freshSets = weekend ? { tyres: (pb.msg.tyres || []).filter(t => !used.has(t.id) && !(pb.msg.mounted || []).includes(t.id)) } : null;
    let pc = 'keep', pset = null;
    const sliderHtml = k => {
      const d = G.defs.find(x => x.key === k), sg = sugOf(k), band = sg ? `<i class="ap-rngband" aria-hidden="true" style="left:${(sg.lo - d.min) / (d.max - d.min) * 100}%;width:${Math.max(2, (sg.hi - sg.lo) / (d.max - d.min) * 100)}%"></i>` : '';
      return `<div class="ap-set"><div class="ap-set-h"><label>${esc(_t('ap_s_' + k))}</label><output>${fmtSet(d, s[k])}</output></div><div class="ap-step"><button type="button" class="ap-nudge" data-nudge="-1" aria-label="−">−</button><div class="ap-rng${sg ? ' has-advice' : ''}">${band}<input type="range" data-pk="${k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${s[k]}"></div><button type="button" class="ap-nudge" data-nudge="1" aria-label="+">+</button></div>${k === 'engine' ? `<p class="ap-hint">${esc(_t('ap_h_engine'))}</p>` : ''}</div>`;
    };
    const sl = (locked ? [] : PIT_SET).map(sliderHtml).join(''), pr = (locked ? [] : ['pressF', 'pressR', 'camberF', 'camberR']).map(sliderHtml).join('');
    const tyreChoice = weekend
      ? `<div class="ap-setrow"><button class="ap-setchip on" data-pset=""><b>${esc(_t('ap_pit_keep'))}</b><small>${esc(_t('ap_c_' + cur))}</small></button></div>${tyreSetsHtml(freshSets, null, 'data-pset', rec)}`
      : `<div class="ap-comps ap-comps6">${['keep'].concat(G.compounds).map(k => k === 'keep'
        ? `<button class="ap-comp on" data-pc="keep"><b>${esc(_t('ap_pit_keep'))}</b><small>${esc(_t('ap_c_' + cur))}</small></button>`
        : `<button class="ap-comp" data-pc="${k}">${k === rec ? `<span class="ap-rec">★</span>` : ''}<i style="background:${ICON[k]}"></i><b>${esc(_t('ap_c_' + k))}</b><em>${money(G.tyre_cost[k])}</em></button>`).join('')}</div>`;
    const entry = cars[carIdx], car = teamRoster().cars.find(c => c.id === entry?.msg.car_id);
    const carLabel = car ? _t('ap_car_number', { n: car.number }) + (car.name ? ' · ' + car.name : '') : _t('ap_car_number', { n: entry?.key === 'player2' ? 2 : 1 });
    const ov = document.createElement('div'); ov.className = 'ap-pitpanel'; ov.id = 'ap-pitpanel';
    ov.innerHTML = `<div class="ap-pit-in"><div class="ap-pit-heading"><div class="ap-bar"><h2>🅿 ${esc(_t('ap_pit_title'))}</h2><b id="ap-pit-clock" class="ap-pit-clock"></b></div><p class="ap-pit-car"><b>${esc(carLabel)}</b> · ${esc(entry?.name || pb.msg.driver?.name || G.driver.name)}</p></div>
      <div class="ap-pit-tabs"><button data-ptab="an" class="on">📊 ${esc(_t('ap_pit_tab_analysis'))}</button><button data-ptab="ch">🔧 ${esc(_t('ap_pit_tab_changes'))}</button></div>
      <p class="ap-hint">${esc(_t('ap_pit_hint_running'))}</p>${carConditionHtml()}
      <div id="ap-pit-an">${analysisHtml(an, locked)}</div>
      <div id="ap-pit-ch" hidden>
        <h3>${esc(_t('ap_tyres'))}</h3>${tyreChoice}
        <div class="ap-set"><div class="ap-set-h"><label for="ap-refuel">${esc(_t('ap_refuel'))}</label><output id="ap-refuel-value"></output></div><input id="ap-refuel" type="range" min="0" max="${maxFuel}" step="1" value="${run.fuel<.1?Math.min(20,maxFuel):0}"><p class="ap-hint">${esc(_t('ap_refuel_hint'))}</p></div>
        <div class="ap-pit-cols"><div>${sl}</div><div id="ap-pit-pr" hidden>${pr}</div></div>
        <div class="ap-cost"><span id="ap-pit-info"></span><b id="ap-pit-cost"></b></div></div>
      <button class="ap-btn ap-go" id="ap-pit-go">${esc(_t('ap_pit_release'))}</button></div>`;
    $('#ap-track .ap-view').appendChild(ov);
    const choose = () => (weekend ? !!pset : pc !== 'keep');
    const collect = () => {
      const ch = { fuel: +$('#ap-refuel').value, swap: swapChoice() }; ov.querySelectorAll('[data-pk]').forEach(i => { ch[i.dataset.pk] = +i.value; });
      if (weekend && pset) { const t = freshSets.tyres.find(x => x.id === pset); ch.set = { id: t.id, compound: t.compound, wear: t.wear }; ch.compound = t.compound; }
      else if (!weekend && pc !== 'keep') ch.compound = pc;
      return ch;
    };
    const info = () => {
      const ch = collect(), wings = ['frontWing', 'rearWing'].filter(k => ch[k]!=null && +ch[k] !== run.setup[k]).length, tyres = choose();
      const bars = ['arbF', 'arbR'].filter(k => ch[k]!=null && +ch[k] !== run.setup[k]).length, dur = 0.5 + swapTime(ch.swap) + (tyres ? 2.0 : 0) + wings * 1.6 + bars * 0.8 + ch.fuel / 2;
      $('#ap-pit-info').textContent = _t('ap_pit_time', { n: dur.toFixed(1) });
      const price = (tyres && !weekend ? G.tyre_cost[pc] : 0) + ch.fuel * G.costs.fuel;
      $('#ap-pit-cost').textContent = price ? money(price) : '';
      $('#ap-refuel-value').textContent = _t('ap_refuel_amount', { add: litres(ch.fuel), total: litres(run.fuel + ch.fuel) });
      const stillWrecked = projectedDamage(ch.swap) >= 0.85;
      $('#ap-pit-must-repair').hidden = !stillWrecked;
      $('#ap-pit-go').disabled = run.fuel + ch.fuel <= 0 || G.driver.budget < price || stillWrecked;
      $('#ap-pit-pr').hidden = !tyres;
    };
    ov.querySelectorAll('[data-ptab]').forEach(b => b.addEventListener('click', () => { ov.querySelectorAll('[data-ptab]').forEach(x => x.classList.toggle('on', x === b)); $('#ap-pit-an').hidden = b.dataset.ptab !== 'an'; $('#ap-pit-ch').hidden = b.dataset.ptab !== 'ch'; }));
    ov.querySelectorAll('[data-pc]').forEach(b => b.addEventListener('click', () => { pc = b.dataset.pc; ov.querySelectorAll('[data-pc]').forEach(x => x.classList.toggle('on', x === b)); info(); }));
    ov.querySelectorAll('[data-pset]').forEach(b => b.addEventListener('click', () => { pset = b.dataset.pset || null; ov.querySelectorAll('[data-pset]').forEach(x => x.classList.toggle('on', x === b)); info(); }));
    nudgeWire(ov);
    ov.querySelectorAll('[data-pk]').forEach(i => i.addEventListener('input', () => { const d = G.defs.find(x => x.key === i.dataset.pk); i.closest('.ap-set').querySelector('output').textContent = fmtSet(d, +i.value); info(); }));
    $('#ap-refuel').addEventListener('input', info);
    ov.querySelectorAll('[data-swap]').forEach(i => i.addEventListener('change', info));
    info();
    $('#ap-pit-go').addEventListener('click', async () => {
      const ch = collect(); $('#ap-pit-go').disabled = true;
      if (choose() || ch.fuel > 0 || Object.keys(ch.swap).length) {
        tyreWait = true;
        const ack = new Promise(res => { pitAck = res; });
        send({type:'ap_pit', compound: choose() ? ch.compound : null, set: ch.set ? ch.set.id : undefined, fuel: ch.fuel, swap: Object.keys(ch.swap).length ? ch.swap : undefined, car: cars[carIdx]?.key });
        const ok = await ack;
        tyreWait = false;
        if (!ok) { notifyGame(_t('ap_no_budget')); $('#ap-pit-go').disabled = false; return; }
        if (ch.set) { pb.msg.mounted = [...(pb.msg.mounted || []), ch.set.id]; }
        if (pb.lastAck?.swap) { ch.swap = pb.lastAck.swap; ch.mods = pb.lastAck.mods; }
      }
      run.service(ch);
      ov.remove(); pitModal = false; pb.playing = true; paintBox();
    });
  }
  let pitAck = null;

  // ── engine sound (optional, off with the speaker button) ──
  function sndStart() {
    if(!sndOn||snd||!mods?.AUDIO)return;
    try{snd=mods.AUDIO.createEngineAudio({enabled:sndOn,context:audioContext()});}catch(_){snd=null;}
  }
  function sndUpdate(S) {
    snd?.update({rpm:S.rpm,gear:S.gear,throttle:S.thr,speed:Math.hypot(S.u,S.v),time:S.t,
      camera:view?.camera,playing:pb.playing&&screen==='track'&&!pb.sent&&sndOn&&S.fuel>0});
  }
  function sndStop() {if(snd){snd.destroy();snd=null;}}

  // ── the run is over: report, then read the result ──
  function finishRun() {
    if (pb.sent) return;
    pb.sent = true;
    sndStop();
    // fuel burnt per lap on laps without a stop (the outlap excluded), so the team can advise the fuel to load next time
    const fuelPerLap = r => { const used = []; r.laps.forEach((l, i) => { const p = r.laps[i - 1]; if (i >= 1 && p && !l.pit && !p.pit && p.fuel > l.fuel) used.push(p.fuel - l.fuel); }); return used.length ? +(used.reduce((x, y) => x + y, 0) / used.length).toFixed(3) : 0; };
    const reportOf = r => ({ duration: r.finishT ? r.finishT - r.lightsOut : Math.max(0, r.t - r.lightsOut),
      laps: r.laps.map(l => ({ time: l.time, valid: l.valid, invalidated: r.events.some(e => e.lap === l.n && ['limits','crash','recovering','recovery','fuel'].includes(e.type)), out: l.out, sectors: l.sectors, pen: l.pen, pit: l.pit })),
      fuel_lap: fuelPerLap(r), dnf: r.dnf, impact: r.impact, failed: r.failed, spins: r.spins, bottoming: r.bottomT, race_time: r.raceTime(),
      pits: r.pits.map(p => ({ compound: p.compound, tyres: p.tyres })), final_setup: r.setup, damage_parts: r.partDamage, swap_log: r.swaps, tyre_log: r.tyreLogNow() });
    if (pb.msg.kind === 'practice') setups[pb.msg.track || curTrack] = { ...cars[0].run.setup };   // the next run starts from where this one ended
    const msg = { type: 'ap_result', session: pb.msg.session, ...reportOf(cars[0].run) };
    if (cars.length > 1) msg.other = reportOf(cars[1].run);
    send(msg);
    const ban = $('#h-banner'); if (ban) { ban.hidden = false; ban.className = 'ap-banner'; ban.textContent = run.dnf ? _t('ap_dnf_' + run.dnf) : _t('ap_chequered'); }
  }

  function onSummary(msg) {
    summary = msg; busy = false;
    G.driver = msg.driver; G.career=msg.career || G.career;G.division=msg.division || G.division;
    if(msg.kind==='d5_race'&&divisionPlayback){paintStatus();divisionPlayback.showResult(msg);load2();return;}
    if(msg.weekend?.phase?.startsWith('fp')&&cars.length)setups[curTrack]={...cars[0].run.setup};
    lastGains = msg.gains; tinfo().bests = msg.bests; histTrack = ''; paintStatus();
    const host = $('#ap-track');
    const ov = document.createElement('div'); ov.className = 'ap-sum';
    let selected = 0;
    const show = i => {
      selected = i;
      render(ov, summaryHtml(msg, i));
      drawChart(ov.querySelector('#ap-chart'), cars[i]?.run || run);
    };
    show(selected);
    host.querySelector('.ap-view').appendChild(ov);
    ov.addEventListener('click', e => {
      const pick = e.target.closest('[data-summary-car]');
      if (pick && ov.contains(pick)) { show(+pick.dataset.summaryCar); return; }
      if (e.target.closest('#ap-s-garage')) { ov.remove(); go(msg.weekend?'division':'garage'); }
      if (e.target.closest('#ap-s-replay')) {
        ov.remove(); switchCar(selected); radioClear(); pb.t = 0; pb.playing = true; pb.sent = true; pb.speed = 1; sec.shown = 0; markSpeed(); sndStart();
      }
    });
    load2();
  }
  async function load2() { const r = await api('/state'); if (r.ok) { const keep = setups; adopt(r.d); setups = keep; G.driver = r.d.driver; paintStatus(); } }

  function comments(simulation = run) {
    const r = simulation.report(), fb = simulation.drv.fb, k = 1 - 0.35 * fb, out = [];
    const T = simulation.P.comp.Topt;
    if (r.dnf === 'crash') out.push('crash');
    if (r.understeer > 0.012 * k + 0.008) out.push('under'); else if (r.understeer < -0.012 * k - 0.008) out.push('over'); else out.push('balanced');
    if (r.lockF > 0.5 * k) out.push('lockF');
    if (r.lockR > 0.25 * k) out.push('lockR');
    if (r.spin > 7 * k) out.push('spin');
    if (r.bottoming > 0.8 * k) out.push('bottom');
    if (r.maxT > T + 16) out.push('hot'); else if (r.minT < T - 28 && simulation.laps.length > 2) out.push('cold');
    if (r.wear > 0.18) out.push('wear');
    if (r.fuelLeft < 0.4) out.push('fuelLow'); else if (r.fuelLeft > 14 && !r.dnf) out.push('fuelHeavy');
    return out;
  }

  function summaryHtml(result, selected = 0) {
    const entry = cars[selected] || cars[0], simulation = entry?.run || run;
    const m = selected === 1 && result.other
      ? { ...result, ...result.other, qualification: result.other.qualification || null }
      : { ...result, cost: result.other ? result.cost - (result.other.cost || 0) : result.cost };
    const reference = entry?.msg || pb.msg, personal = entry?.sec?.personal;
    const own = reference?.kind === 'practice' && !reference.weekend && personal?.some(x => x > 0) ? personal : null;
    const race = m.kind === 'race',q=m.qualification,fin=mods.TIMING.finalSectorColours(m.laps,reference?.timing_field,own);
    const rows = m.laps.map((l, i) => {
      const cells = l.sectors.map((s, n) => `<span class="ap-sc ${fin[i + ':' + n] || ''}">${secStr(s)}</span>`).join('');
      return `<tr class="${l.valid ? (m.best && l.time === m.best.time ? 'best' : '') : 'inv'}"><td>${l.out ? _t('ap_out') : race ? i + 1 : i}</td><td>${lapStr(l.time)}${!l.valid && !l.out ? ' <small class="ap-lap-deleted">'+esc(_t('ap_invalid'))+'</small>' : ''}${l.pen ? ` <small>+${l.pen}s</small>` : ''}${l.pit ? ' 🅿' : ''}</td>
      <td class="sec">${cells}</td><td>${race || q ? '' : (l.valid ? l.points : (l.out ? '–' : esc(_t('ap_invalid'))))}</td></tr>`;
    }).join('');
    const gains = Object.entries(m.gains || {}).map(([k, v]) => `<span class="${v < 0 ? 'neg' : ''}">${esc(_t('ap_k_' + k))} ${v > 0 ? '+' : ''}${v.toFixed(2)}</span>`).join('');
    const cm = comments(simulation).map(c => `<li>${esc(_t('ap_fb_' + c))}</li>`).join('');
    const wear = Object.entries(m.wear || {}).filter(([, v]) => v > 0.004).map(([k, v]) => `<span>${esc(_t('ap_part_' + k))} −${Math.round(v * 100)}%</span>`).join('');
    const dmg = Object.entries(m.damage || {}).filter(([, v]) => v > 0.01).map(([k, v]) => `<span class="neg">${esc(_t('ap_part_' + k))} −${Math.round(v * 100)}%</span>`).join('');
    const top = q ? `<div class="ap-big"><small>${esc(_t('ap_qualifying'))}</small><b>${esc(_t(q.medal ? 'ap_medal_'+q.medal : 'ap_no_medal'))}</b></div><div class="ap-big"><small>${esc(_t('ap_best_three'))}</small><b>${lapStr(q.average)}</b></div><div class="ap-big"><small>${esc(_t('ap_valid_laps'))}</small><b>${q.clean_laps} / ${q.timed_laps}</b></div><div class="ap-big"><small>${esc(_t('ap_prize'))}</small><b>+${money(m.reward)}</b></div><div class="ap-big"><small>${esc(_t('ap_sponsor_bonus'))}</small><b>+${money(m.sponsor_bonus)}</b></div>` : race
      ? `<div class="ap-big"><small>${esc(_t('ap_position_h'))}</small><b>${m.race ? 'P' + m.race.position + ' / ' + m.race.field : '–'}</b></div>
         <div class="ap-big"><small>${esc(_t('ap_race_time'))}</small><b>${m.race ? lapStr(m.race.time) : '–'}</b></div>
         <div class="ap-big"><small>${esc(_t('ap_prize'))}</small><b class="${m.race && m.race.prize ? 'ap-good' : ''}">+${money(m.race ? m.race.prize : 0)}</b></div>`
      : `<div class="ap-big"><small>${esc(_t('ap_best'))}</small><b>${m.best ? lapStr(m.best.time) : '–'}</b></div>
         <div class="ap-big"><small>${esc(_t('ap_points'))}</small><b>${m.best ? m.best.points : 0}</b></div>`;
    return `<div class="ap-sum-in">
      <h2>${m.weekend ? esc(_t('ap_round',{n:m.weekend.round}))+' · '+esc(_t('ap_phase_'+m.weekend.phase))+' · ' : ''}${q ? '⏱ '+esc(_t('ap_qual_result')) : race ? '🏁 ' + esc(_t('ap_race_result')) : '🧪 ' + esc(_t('ap_result'))}</h2>
      ${m.dnf ? `<div class="ap-dnfbar">${esc(m.dnf === 'fuel' ? _t('ap_dnf_fuel') : m.dnf === 'crash' ? _t('ap_dnf_crash') : m.dnf === 'recovery' ? _t('ap_dnf_recovery') : _t('ap_dnf_failure', { part: _t('ap_part_' + (m.failed || 'engine')) }))}</div>` : ''}
      ${q ? `<p class="ap-hint">${esc(_t('ap_qual_result_hint'))}</p><p class="ap-hint">${esc(m.career?.licensed ? _t('ap_license_ready') : _t('ap_license_progress',{n:m.career?.qualifications || 0,s:m.career?.silver_sessions ? 1 : 0}))}</p>` : ''}
      ${m.cheat ? `<div class="ap-dnfbar">${esc(_t('ap_cheat'))}</div>` : ''}
      <div class="ap-sum-top">${top}<div class="ap-big"><small>${esc(_t('ap_spent_h'))}</small><b class="ap-bad">−${money(m.cost)}</b></div></div>
      ${result.other ? `<div class="ap-sum-cars">${[result, result.other].map((r, i) => `<button type="button" data-summary-car="${i}" class="${selected === i ? 'on' : ''}" aria-pressed="${selected === i}"><b>${esc(cars[i]?.name || (i ? result.other.name : result.driver?.name || G.driver.name))}</b><span>${r.best ? lapStr(r.best.time) : '–'}</span><small>${(r.laps || []).filter(l=>l.valid).length} ${esc(_t('ap_valid_laps'))}</small></button>`).join('')}</div>` : ''}
      <div class="ap-sum-grid">
        <div><table class="ap-table"><tr><th>#</th><th>${esc(_t('ap_time_h'))}</th><th>${esc(_t('ap_sectors'))}</th><th>${race || q ? '' : esc(_t('ap_points'))}</th></tr>${rows}</table>
          <canvas id="ap-chart" width="520" height="170"></canvas><div class="ap-hint">${esc(_t('ap_chart_hint'))}</div></div>
        <div><h3>🎙️ ${esc(_t('ap_radio'))}</h3><ul class="ap-fb">${cm}</ul>
          ${wear ? `<h3>${esc(_t('ap_wear_added'))}</h3><div class="ap-tags">${wear}</div>` : ''}
          ${dmg ? `<h3>${esc(_t('ap_damage'))}</h3><div class="ap-tags">${dmg}</div>` : ''}
          ${gains ? `<h3>${esc(_t(Object.values(m.gains).some(v => v < 0) ? 'ap_learned' : 'ap_learned'))}</h3><div class="ap-tags">${gains}</div>` : (race ? `<div class="ap-hint">${esc(_t('ap_race_no_xp'))}</div>` : '')}</div>
      </div>
      ${m.weekend?.classification?.length ? mods.DIVISION.classificationHtml(m.weekend.classification,_t,lapStr) : ''}
      ${m.weekend ? `<p class="ap-hint">${esc(_t('ap_recovery_rule'))}</p>` : ''}
      <div class="ap-sum-btns"><button class="ap-btn" id="ap-s-garage">🔧 ${esc(_t('ap_to_garage'))}</button><button class="ap-btn ap-ghost" id="ap-s-replay">⟲ ${esc(_t('ap_replay'))}</button></div></div>`;
  }

  function drawChart(c, simulation = run) {
    if (!c) return; const g = c.getContext('2d'), W = c.width, H = c.height, F = simulation.frames, FS = simulation.FRAME;
    g.clearRect(0, 0, W, H); g.lineWidth = 1;
    g.fillStyle = 'rgba(10,14,22,.9)'; g.fillRect(0, 0, W, H);
    const lapsV = simulation.laps.filter(l => !l.out);
    const pick = [];
    const bl = lapsV.filter(l => l.valid && !l.pit).sort((a, b) => a.time - b.time)[0]; const ll = lapsV[lapsV.length - 1];
    if (bl) pick.push([bl, '#4fd18b']); if (ll && ll !== bl) pick.push([ll, '#f2c230']);
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '10px sans-serif';
    for (let v = 0; v <= 350; v += 50) { const y = H - 14 - v / 350 * (H - 24); g.beginPath(); g.moveTo(26, y); g.lineTo(W, y); g.stroke(); g.fillText(v, 2, y + 3); }
    for (const [l, col] of pick) {
      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); let first = true;
      for (let f = Math.floor(l.from); f < Math.ceil(l.to); f++) {
        const a = f * FS, idx = F[a + 22], sp = Math.hypot(F[a + 4], F[a + 5]) * 3.6;
        const x = 26 + idx / track.N * (W - 30), y = H - 14 - sp / 350 * (H - 24);
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  // ── the room is over ──
  function onOver(msg) {
    over = msg; sndStop();
    go('garage');
    closeGarageView();
    const host = $('#ap-garage');
    const rows = msg.board.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.best != null ? lapStr(r.best) : '–'}</td><td>${r.points}</td></tr>`).join('');
    host.innerHTML = `<div class="ap-final"><h2>🏁 ${esc(_t('ap_final'))}</h2>
      <table class="ap-table"><tr><th>#</th><th></th><th>${esc(_t('ap_best'))}</th><th>${esc(_t('ap_points'))}</th></tr>${rows}</table>
      <section data-gh-results></section>
      <div class="ap-sum-btns"><button class="ap-btn" id="ap-new">${esc(_t('ap_new_visit'))}</button><button class="ap-btn ap-ghost" id="ap-hub">${esc(_t('ap_to_hub'))}</button></div></div>`;
    $('#ap-hub').addEventListener('click', () => { location.href = '/pub/gamehub/?game=' + GAME_ID; });
    $('#ap-new').addEventListener('click', async e => {
      e.target.disabled = true;
      const r = await fetch('/api/pub/gamehub/mp/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GH-Token': token() }, body: JSON.stringify({ game_id: GAME_ID, max_players: 1 }) });
      if (r.status === 409) { location.href = '/pub/gamehub/?game=' + GAME_ID; return; }
      if (r.ok) location.href = (await r.json()).play_url; else e.target.disabled = false;
    });
    root.querySelector('.ap-tabs').style.display = 'none'; $('#ap-leave').style.display = 'none';
  }

  // ── messages from the room (registered at load time) ──
  mp.on('ap_cfg', m => { cfg.laps = m.cfg.laps; cfg.hour = m.cfg.hour; cfg.hourSet = true; multi = !!m.multi; board = m.board || []; if (root && screen === 'garage' && gview === 'setup' && G && !over) paintSession(); });
  mp.on('ap_board', m => { board = m.board || []; if (root && screen === 'garage' && gview === 'setup' && multi && G && !over) paintGarage(); });
  mp.on('ap_division_updated', async()=>{busy=false;await load2();go('division');});
  mp.on('ap_career_reset', async () => {
    if(divisionPlayback){divisionPlayback.destroy();divisionPlayback=null;}
    pb.playing=false;pb.sent=true;busy=false;pending=null;run=null;summary=null;lastGains=null;
    if(view){view.destroy();view=null;}closeGarageView();
    setups={};history=[];histTrack='';gview='cars';pview='list';screen='home';teamView='overview';curTrack='own';cfg={laps:3,hour:12};compound='M';sec=null;secColors={};
    $('#ap-track').innerHTML='';$('#ap-stats').innerHTML='';$('#ap-driver').innerHTML='';
    await load();
  });
  mp.on('ap_go',receiveGo);
  mp.on('ap_err', async m => { clearTimeout(resumeTimer);resumeBusy=false;busy = false; notifyGame(careerError(m.code)); await load2();if(screen==='division')paintDivision();if(screen==='team')paintTeam(); if (screen === 'garage') paintGarage(); });
  mp.on('ap_pit_ok', m => { if (m.budget != null && G) { G.driver.budget = m.budget; paintStatus(); } if (pitAck) { pb.lastAck = m; pitAck(!!m.ok); pitAck = null; } });
  mp.on('ap_summary', m => { if (root) onSummary(m); });
  mp.on('ap_pos', m => { peers[m.pid] = { x: m.x, y: m.y, best: m.best }; if (view && pb.msg?.kind!=='qualifying') view.ghost(m.pid, { x: m.x, y: m.y, psi: m.psi, col: m.col, livery: m.livery, name: m.name }); });
  mp.on('ap_gone', m => { delete peers[m.pid]; if (view) view.removeGhost(m.pid); });
  mp.on('ap_over', m => { if (root) onOver(m); });

  mp.registerGame({
    id: GAME_ID,
    name: _t('ap_title'),
    renderGame,
    exitButton: false,
    saveable: false,
    snapshot: () => null,
    pause: () => { snd?.update({playing:false});clearInterval(divisionTimer);clearInterval(hallTimer);if(divisionPlayback)divisionPlayback.pause();pb.playing = false; },
    resume: () => { startEnergyRefresh();if(divisionPlayback&&screen==='track')divisionPlayback.resume();if(screen==='division')paintDivision();if (screen === 'garage' && gview === 'car' && root && !over) paintGarage(); if (run && !pb.sent && !pitModal) pb.playing = true; },
  });
})();
