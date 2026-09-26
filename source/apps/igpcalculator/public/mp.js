/*
 * IGP Calculator — runs on Game Hub's generic play page (NOT inside mvmOS).
 *
 * There is no game here: the room only gives the page an Apps Hub account.
 * Everything is calculated in the browser, and every race the player prepares
 * (driver, setup and practice data for up to two cars, the chosen tyre
 * strategy) and their list of drivers are kept on their profile through this
 * app's own api.py at /pub/igpcalculator.
 *
 * The tyre arithmetic (tyreLaps, calcStints, strategies) is a straight port of
 * the IGP Calculator on mvmrik.com and must stay identical to it.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const GAME_ID = 'igpcalculator';
  const API = '/pub/igpcalculator';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;

  function tr(k, vars) {
    let s = window.t ? window.t(k) : k;
    if (vars) Object.keys(vars).forEach(n => { s = String(s).split('{' + n + '}').join(vars[n]); });
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Fixed data ─────────────────────────────────────────────────────────────
  const TYRES = ['SS', 'S', 'M', 'H'];
  // Race wear against practice wear. 1.2 matches real races best so far; the
  // player can change it per tyre.
  const DEFAULT_COEF = 1.2;
  const TYRE_RING = { SS: '#e63232', S: '#e6c832', M: '#d0d0d0', H: '#e87820' };

  const TRACKS = [
    { flag: '🇦🇪', key: 'abu_dhabi',     laps: 50 },
    { flag: '🇦🇺', key: 'australia',     laps: 57 },
    { flag: '🇦🇹', key: 'austria',       laps: 71 },
    { flag: '🇦🇿', key: 'azerbaijan',    laps: 46 },
    { flag: '🇧🇭', key: 'bahrain',       laps: 59 },
    { flag: '🇧🇪', key: 'belgium',       laps: 43 },
    { flag: '🇧🇷', key: 'brazil',        laps: 69 },
    { flag: '🇨🇦', key: 'canada',        laps: 63 },
    { flag: '🇨🇳', key: 'china',         laps: 55 },
    { flag: '🇪🇺', key: 'europe',        laps: 50 },
    { flag: '🇫🇷', key: 'france',        laps: 48 },
    { flag: '🇩🇪', key: 'germany',       laps: 67 },
    { flag: '🇬🇧', key: 'great_britain', laps: 48 },
    { flag: '🇭🇺', key: 'hungary',       laps: 79 },
    { flag: '🇮🇹', key: 'italy',         laps: 51 },
    { flag: '🇯🇵', key: 'japan',         laps: 55 },
    { flag: '🇲🇾', key: 'malaysia',      laps: 55 },
    { flag: '🇲🇽', key: 'mexico',        laps: 70 },
    { flag: '🇲🇨', key: 'monaco',        laps: 59 },
    { flag: '🇳🇱', key: 'netherlands',   laps: 72 },
    { flag: '🇷🇺', key: 'russia',        laps: 46 },
    { flag: '🇸🇬', key: 'singapore',     laps: 60 },
    { flag: '🇪🇸', key: 'spain',         laps: 62 },
    { flag: '🇹🇷', key: 'turkey',        laps: 54 },
    { flag: '🇺🇸', key: 'usa',           laps: 60 },
  ];
  const TRACK = Object.fromEntries(TRACKS.map(t => [t.key, t]));
  const trackName = key => tr('igp_track_' + key);
  const sortedTracks = () => TRACKS.slice().sort((a, b) => trackName(a.key).localeCompare(trackName(b.key)));

  // The ranges and steps of the in-game setup sliders.
  const SETUP = [
    { key: 'tyre',   min: 17,   max: 27,   step: 0.1,  dec: 1, unit: ' psi' },
    { key: 'fw',     min: 5,    max: 35,   step: 0.5,  dec: 1, unit: '°' },
    { key: 'rw',     min: 10,   max: 40,   step: 0.5,  dec: 1, unit: '°' },
    { key: 'gear',   min: 4.4,  max: 5.4,  step: 0.01, dec: 2, unit: '' },
    // Camber runs negative in iGP: the slider goes from 0 to -3.6, and + moves it further negative.
    { key: 'camber', min: 0,    max: -3.6, step: -0.1, dec: 1, unit: '°' },
    { key: 'susp',   min: 0,    max: 100,  step: 1,    dec: 0, unit: '%' },
    { key: 'ride',   min: 15,   max: 61,   step: 1,    dec: 0, unit: ' mm' },
    { key: 'brake',  min: 30,   max: 70,   step: 1,    dec: 0, unit: '%' },
    { key: 'toe',    min: 0,    max: 0.4,  step: 0.02, dec: 2, unit: '°' },
  ];
  const SETUP_BY = Object.fromEntries(SETUP.map(d => [d.key, d]));

  // Driver special abilities in iGP Manager, each Common, Rare or Legendary.
  const ABILITIES = ['racecraft', 'qualifying', 'street', 'wet'];
  const TIERS = ['common', 'rare', 'legendary'];
  // ISO 3166 codes; the names come from the browser in the viewer's language.
  const COUNTRIES = ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ '
    + 'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP '
    + 'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ '
    + 'OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ '
    + 'UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW').split(' ');
  function flagOf(code) {
    return /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
  }
  let regionNames = null, regionLang = '';
  function countryName(code) {
    const lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    if (regionLang !== lang) {
      regionLang = lang;
      try { regionNames = new Intl.DisplayNames([lang, 'en'], { type: 'region' }); } catch (_) { regionNames = null; }
    }
    try { return (regionNames && regionNames.of(code)) || code; } catch (_) { return code; }
  }

  // Values live on the slider's grid: counted in steps, never in floats, so
  // 0.1 + 0.2 never shows up as 0.30000000000000004.
  function stepsOf(d) { return Math.round((d.max - d.min) / d.step); }
  function snap(d, v) {
    const n = Math.max(0, Math.min(stepsOf(d), Math.round((Number(v) - d.min) / d.step)));
    return +(d.min + n * d.step).toFixed(d.dec);
  }
  function middle(d) { return snap(d, d.min + Math.floor(stepsOf(d) / 2) * d.step); }
  function fmt(d, v) { return Number(v).toFixed(d.dec) + d.unit; }

  function defaultSetup() { return Object.fromEntries(SETUP.map(d => [d.key, middle(d)])); }
  function emptyTyres() { return Object.fromEntries(TYRES.map(t => [t, { fuel: null, wear: null, coef: DEFAULT_COEF }])); }
  function newCar(driver) {
    return { setup: defaultSetup(), tyres: emptyTyres(), pick: null,
      driver: driver ? driver.id : null, driverName: driver ? driver.name : '' };
  }

  function cleanSetup(s) {
    const out = defaultSetup();
    if (s && typeof s === 'object') SETUP.forEach(d => { if (s[d.key] != null && !isNaN(s[d.key])) out[d.key] = snap(d, s[d.key]); });
    return out;
  }
  function num(v) { return (v === '' || v == null || isNaN(v)) ? null : Number(v); }
  function cleanTyres(ty) {
    const out = emptyTyres();
    if (ty && typeof ty === 'object') TYRES.forEach(t => {
      const x = ty[t] || {};
      out[t] = { fuel: num(x.fuel), wear: num(x.wear), coef: x.coef === undefined ? DEFAULT_COEF : num(x.coef) };
    });
    return out;
  }
  function cleanCar(c) {
    return { setup: cleanSetup(c && c.setup), tyres: cleanTyres(c && c.tyres), pick: (c && c.pick) || null,
      driver: (c && c.driver) || null, driverName: (c && typeof c.driverName === 'string') ? c.driverName : '' };
  }

  // ── Tyre strategy (identical to the mvmrik.com calculator) ─────────────────
  function tyreLaps(wear, coef, minLifePct) {
    const rw = (wear * coef) / 100;
    const threshold = minLifePct / 100;
    let life = 1, lap = 0;
    while (life > threshold && lap < 200) { life *= (1 - rw); lap++; }
    return lap;
  }

  function calcStints(combo, data, total, rsv, minLifePct) {
    const maxPer = combo.map(t => Math.max(1, data[t].maxLaps));
    const totalMax = maxPer.reduce((a, b) => a + b, 0);
    if (totalMax < total) return null;

    const n = combo.length;
    const raw = maxPer.map(m => total * m / totalMax);
    const laps = raw.map(r => Math.floor(r));
    const diff = total - laps.reduce((s, l) => s + l, 0);
    raw.map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac)
      .slice(0, diff)
      .forEach(({ i }) => laps[i]++);

    for (let i = 0; i < n; i++) laps[i] = Math.max(1, Math.min(laps[i], maxPer[i]));
    if (laps.reduce((s, l) => s + l, 0) !== total) return null;

    const fuel = +(laps.reduce((s, l, i) => s + l * data[combo[i]].fuel, 0) + rsv).toFixed(1);

    const score = combo.reduce((s, t, i) => {
      const rw = (data[t].wear * data[t].coef) / 100;
      const rem = Math.round(Math.pow(1 - rw, laps[i]) * 100);
      return s + Math.abs(rem - minLifePct);
    }, 0) / n;

    const capacity = combo.reduce((s, t) => s + data[t].maxLaps, 0);

    return { combo, stintLaps: laps, totalFuel: fuel, nPits: n - 1, score, capacity };
  }

  function tyreData(tyres, minLife) {
    const d = {};
    TYRES.forEach(t => { d[t] = { ...tyres[t], maxLaps: tyreLaps(tyres[t].wear, tyres[t].coef, minLife) }; });
    return d;
  }

  function strategies(tyres, totalLaps, reserve, minLife) {
    const readyTyres = TYRES.filter(t => tyres[t].fuel > 0 && tyres[t].wear > 0 && tyres[t].coef != null);
    const hasEnoughData = readyTyres.length >= 2 && totalLaps > 0;
    if (!hasEnoughData) return { empty: true, error: false, strategies: [] };

    const d = tyreData(tyres, minLife);
    const total = totalLaps;

    const bestMax = Math.max(...readyTyres.map(t => Math.max(1, d[t].maxLaps)));
    const minStints = Math.max(2, Math.ceil(total / bestMax));
    const maxStints = Math.min(6, Math.max(minStints, 6)); // up to 5 pit stops

    const all = [];

    // Generate combinations with repetition (not permutations) by always
    // iterating from startIdx — each combo appears exactly once in sorted order
    function buildCombos(current, lapsLeft, startIdx = 0) {
      const n = current.length;
      if (n >= minStints && lapsLeft <= 0) {
        if (new Set(current).size < 2) return;
        const r = calcStints(current, d, total, reserve, minLife);
        if (r) all.push(r);
        return;
      }
      if (n >= maxStints) return;
      for (let i = startIdx; i < readyTyres.length; i++) {
        const t = readyTyres[i];
        buildCombos([...current, t], lapsLeft - Math.max(1, d[t].maxLaps), i);
      }
    }
    buildCombos([], total);

    all.sort((a, b) => {
      if (a.nPits !== b.nPits) return a.nPits - b.nPits;
      if (a.totalFuel !== b.totalFuel) return a.totalFuel - b.totalFuel;
      return a.score - b.score;
    });

    const list = all.slice(0, 20);

    if (!list.length) return { empty: false, error: true, strategies: [], data: d };
    return { empty: false, error: false, strategies: list, best: list[0], data: d };
  }

  function tyreRemaining(d, stintLaps) {
    if (!d || !d.wear || !d.coef || !stintLaps) return null;
    const rw = (d.wear * d.coef) / 100;
    return Math.round(Math.pow(1 - rw, stintLaps) * 100);
  }
  function remainingClass(pct) {
    if (pct === null) return 'igp-bar-none';
    if (pct > 60) return 'igp-bar-good';
    if (pct > 40) return 'igp-bar-mid';
    return 'igp-bar-low';
  }

  const comboKey = combo => combo.join('-');

  // ── Server ─────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const token = window.GameHub.getToken() || '';
    const r = await fetch(API + path, {
      method,
      headers: Object.assign({ 'X-Pub-Token': token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'error'), { status: r.status });
    return data;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let root = null;
  let races = [];
  let drivers = [];
  let loadError = false;
  let view = 'list';          // list | pick | edit | load | drivers | driver
  let filter = '';
  let draft = null;           // the race being edited
  let savedJson = '';         // draft as last saved/loaded, to spot unsaved changes
  let banner = null;          // { kind, text }
  let activeCar = 0;
  let activeTyre = 'SS';
  let openAccords = new Set();
  let saving = false;
  let driverDraft = null;     // the driver being edited
  let loadCar = 0;            // the car the "load from a race" list fills

  const driverById = id => drivers.find(d => d.id === id) || null;
  const seatOf = n => drivers.find(d => d.car === n) || null;
  // A deleted driver still shows under the name the race was saved with.
  function driverName(car) {
    const d = car && car.driver ? driverById(car.driver) : null;
    return d ? d.name : ((car && car.driverName) || '');
  }
  function carLabel(i, car) {
    const name = driverName(car);
    return tr('igp_car', { n: i + 1 }) + (name ? ' · ' + name : '');
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    try {
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString((window.mvmOS && window.mvmOS.lang) || 'en',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return iso; }
  }
  function pitsLabel(n) { return tr(n === 1 ? 'igp_pits_one' : 'igp_pits_many', { n }); }

  function draftJson() { return draft ? JSON.stringify(serialize(draft)) : ''; }
  function dirty() { return !!draft && draftJson() !== savedJson; }

  function serialize(dr) {
    return {
      laps: dr.laps, reserve: dr.reserve, minLife: dr.minLife, notes: dr.notes || '',
      cars: dr.cars.filter(Boolean).map(c => {
        const res = strategies(c.tyres, dr.laps, dr.reserve, dr.minLife);
        const chosen = pickedStrategy(c, res);
        return {
          driver: c.driver || null, driverName: driverName(c),
          setup: c.setup, tyres: c.tyres, pick: c.pick,
          strategy: chosen ? { combo: chosen.combo, stintLaps: chosen.stintLaps,
            totalFuel: chosen.totalFuel, nPits: chosen.nPits } : null,
        };
      }),
    };
  }

  function pickedStrategy(car, res) {
    if (!res || !res.strategies.length) return null;
    if (car.pick) {
      const hit = res.strategies.find(s => comboKey(s.combo) === car.pick);
      if (hit) return hit;
    }
    return res.best;
  }

  function fromRace(r) {
    const d = r.data || {};
    const cars = Array.isArray(d.cars) && d.cars.length ? d.cars.slice(0, 2).map(cleanCar) : [newCar()];
    return {
      id: r.id, track: r.track, race_date: r.race_date,
      laps: num(d.laps) || (TRACK[r.track] ? TRACK[r.track].laps : 50),
      reserve: d.reserve == null ? 1 : num(d.reserve),
      minLife: d.minLife == null ? 50 : num(d.minLife),
      notes: typeof d.notes === 'string' ? d.notes : '',
      cars: [cars[0], cars[1] || null],
    };
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  // Every render rebuilds the page, which would throw the reader back to the
  // top. A re-render of the same view keeps its place, and coming back to the
  // editor or the race list returns to where the reader left it; any other
  // view opens at the top.
  let shownView = null;
  const scrollMemo = {};
  function render() {
    if (!root) return;
    const before = root.querySelector('.igp-page');
    if (before && shownView) scrollMemo[shownView] = before.scrollTop;
    const keep = view === shownView || view === 'edit' || view === 'list';
    draw();
    shownView = view;
    const page = root.querySelector('.igp-page');
    if (page) page.scrollTop = keep ? (scrollMemo[view] || 0) : 0;
  }

  function draw() {
    if (view === 'pick') return renderPicker();
    if (view === 'edit') return renderEditor();
    if (view === 'load') return renderLoad();
    if (view === 'drivers') return renderDrivers();
    if (view === 'driver') return renderDriverForm();
    return renderList();
  }

  function tyreChip(t, size) {
    return '<span class="igp-tyre igp-tyre-' + (size || 'sm') + '" style="--ring:' + TYRE_RING[t] + '">' + t + '</span>';
  }
  function comboHtml(combo, size) {
    return combo.map(t => tyreChip(t, size)).join('<span class="igp-arrow">→</span>');
  }

  function renderList() {
    const shown = filter ? races.filter(r => r.track === filter) : races;
    const usedTracks = sortedTracks().filter(t => races.some(r => r.track === t.key));
    let body;
    if (loadError) {
      body = '<div class="igp-empty igp-warn">' + esc(tr('igp_load_error')) + '</div>';
    } else if (!races.length) {
      body = '<div class="igp-empty"><div class="igp-empty-icon">🏁</div>' + esc(tr('igp_no_races')) + '</div>';
    } else if (!shown.length) {
      body = '<div class="igp-empty">' + esc(tr('igp_no_races_track')) + '</div>';
    } else {
      body = '<div class="igp-races">' + shown.map(r => {
        const t = TRACK[r.track] || { flag: '🏁' };
        const cars = (r.data && Array.isArray(r.data.cars)) ? r.data.cars : [];
        const lines = cars.map((c, i) => {
          const s = c && c.strategy;
          return '<div class="igp-race-car"><span class="igp-car-tag">' + esc(carLabel(i, c)) + '</span>'
            + (s && Array.isArray(s.combo)
              ? '<span class="igp-combo">' + comboHtml(s.combo, 'xs') + '</span><span class="igp-dim">'
                + esc(pitsLabel(s.nPits)) + ' · ' + esc(s.totalFuel) + ' ' + esc(tr('igp_fuel_unit')) + '</span>'
              : '<span class="igp-dim">' + esc(tr('igp_no_strategy')) + '</span>')
            + '</div>';
        }).join('');
        return '<button class="igp-race" data-id="' + r.id + '">'
          + '<div class="igp-race-head"><span class="igp-flag">' + t.flag + '</span>'
          + '<span class="igp-race-name">' + esc(trackName(r.track)) + '</span>'
          + '<span class="igp-race-date">' + esc(fmtDate(r.race_date)) + '</span></div>'
          + lines
          + (r.data && r.data.notes ? '<div class="igp-race-notes">' + esc(r.data.notes) + '</div>' : '')
          + '</button>';
      }).join('') + '</div>';
    }

    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-exit" title="' + esc(tr('igp_close')) + '">‹ ' + esc(tr('igp_close')) + '</button>'
      + '<div class="igp-top-title">🏎️ ' + esc(tr('igp_title')) + '</div>'
      + '<button class="igp-btn igp-primary" id="igp-new">＋ ' + esc(tr('igp_new_race')) + '</button>'
      + '</div>'
      + '<div class="igp-list-head"><h2>' + esc(tr('igp_my_races')) + '</h2>'
      + '<div class="igp-list-tools">'
      + '<button class="igp-btn igp-ghost" id="igp-drivers">👤 ' + esc(tr('igp_drivers')) + '</button>'
      + (usedTracks.length > 1 ? '<select class="igp-input igp-filter" id="igp-filter"><option value="">' + esc(tr('igp_all_tracks')) + '</option>'
        + usedTracks.map(t => '<option value="' + t.key + '"' + (filter === t.key ? ' selected' : '') + '>' + t.flag + ' ' + esc(trackName(t.key)) + '</option>').join('')
        + '</select>' : '')
      + '</div></div>'
      + body
      + '</div></div>';

    root.querySelector('#igp-exit').onclick = exit;
    root.querySelector('#igp-new').onclick = () => { view = 'pick'; render(); };
    root.querySelector('#igp-drivers').onclick = () => { view = 'drivers'; render(); };
    const f = root.querySelector('#igp-filter');
    if (f) f.onchange = () => { filter = f.value; render(); };
    root.querySelectorAll('.igp-race').forEach(b => {
      b.onclick = () => {
        const r = races.find(x => String(x.id) === b.dataset.id);
        if (!r) return;
        openEditor(fromRace(r), null);
      };
    });
  }

  function renderPicker() {
    const changing = !!draft;
    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-back">‹ ' + esc(tr('igp_back')) + '</button>'
      + '<div class="igp-top-title">' + esc(tr('igp_choose_track')) + '</div><span></span>'
      + '</div>'
      + '<div class="igp-tracks">' + sortedTracks().map(t => {
        const last = races.find(r => r.track === t.key);
        return '<button class="igp-track' + (draft && draft.track === t.key ? ' on' : '') + '" data-key="' + t.key + '">'
          + '<span class="igp-flag">' + t.flag + '</span>'
          + '<span class="igp-track-name">' + esc(trackName(t.key)) + '</span>'
          + '<span class="igp-dim">' + esc(tr('igp_laps_n', { n: t.laps }))
          + (last ? ' · ' + esc(tr('igp_last_race', { date: fmtDate(last.race_date) })) : '') + '</span>'
          + '</button>';
      }).join('') + '</div>'
      + '</div></div>';

    root.querySelector('#igp-back').onclick = () => { view = changing ? 'edit' : 'list'; render(); };
    root.querySelectorAll('.igp-track').forEach(b => {
      b.onclick = () => {
        const key = b.dataset.key;
        if (changing) {
          // Moving an existing race to another track keeps what was entered.
          if (draft.track !== key) {
            draft.track = key;
            if (!draft.id) applyTrackDefaults(key);
          }
          view = 'edit';
          render();
          return;
        }
        const fresh = { id: null, track: key, race_date: today(), laps: TRACK[key].laps, reserve: 1, minLife: 50, notes: '', cars: [newCar(seatOf(1)), null] };
        draft = fresh;
        const note = applyTrackDefaults(key);
        openEditor(draft, note);
      };
    });
  }

  // A new race takes its drivers from the seats. Each car starts from the
  // last race on this track with the same driver; failing that, from the same
  // car in the last race on this track; failing that, from the middle of
  // every slider. Without seated drivers the second car comes along only if
  // the last race here had one.
  function applyTrackDefaults(key) {
    const past = races.filter(r => r.track === key && (!draft || r.id !== draft.id));
    const prev = past[0] || null;
    const prevCars = prev && prev.data && Array.isArray(prev.data.cars) ? prev.data.cars : [];
    const seats = [seatOf(1), seatOf(2)];
    const seated = !!(seats[0] || seats[1]);
    const count = seated ? (seats[1] ? 2 : 1) : (prevCars[1] ? 2 : 1);

    if (prev) {
      const p = fromRace(prev);
      draft.laps = p.laps; draft.reserve = p.reserve; draft.minLife = p.minLife;
    } else {
      draft.laps = TRACK[key].laps; draft.reserve = 1; draft.minLife = 50;
    }

    const lines = [];
    draft.cars = [0, 1].map(i => {
      if (i >= count) return null;
      const drv = seated ? seats[i] : null;
      let src = null, line;
      if (drv) {
        for (const r of past) {
          const c = (r.data && Array.isArray(r.data.cars) ? r.data.cars : []).find(x => x && x.driver === drv.id);
          if (c) { src = c; line = tr('igp_src_driver', { n: i + 1, driver: drv.name, date: fmtDate(r.race_date) }); break; }
        }
      }
      if (!src && prevCars[i]) { src = prevCars[i]; line = tr('igp_src_track', { n: i + 1, date: fmtDate(prev.race_date) }); }
      if (!line) line = tr('igp_src_fresh', { n: i + 1 });
      lines.push(line);
      const car = src ? Object.assign(cleanCar(src), { pick: null }) : newCar();
      car.driver = drv ? drv.id : null;
      car.driverName = drv ? drv.name : '';
      return car;
    });
    banner = { kind: 'info', lines };
    return banner;
  }

  function openEditor(d, note) {
    draft = d;
    banner = note || null;
    savedJson = draftJson();
    activeCar = 0;
    activeTyre = 'SS';
    openAccords = new Set();
    view = 'edit';
    render();
    root.querySelector('.igp-page').scrollTop = 0;
  }

  function leaveEditor() {
    if (dirty() && !confirm(tr('igp_discard_confirm'))) return;
    draft = null; banner = null; view = 'list';
    render();
  }

  function renderEditor() {
    const t = TRACK[draft.track];
    const car = draft.cars[activeCar] || draft.cars[0];
    if (!draft.cars[activeCar]) activeCar = 0;
    const hasCar2 = !!draft.cars[1];

    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top igp-sticky">'
      + '<button class="igp-btn igp-ghost" id="igp-back">‹ ' + esc(tr('igp_my_races')) + '</button>'
      + '<div class="igp-top-title"><span class="igp-flag">' + t.flag + '</span> ' + esc(trackName(draft.track)) + '</div>'
      + '<button class="igp-btn igp-primary" id="igp-save"' + (saving ? ' disabled' : '') + '>' + esc(tr(saving ? 'igp_saving' : 'igp_save')) + '</button>'
      + '</div>'
      + (banner ? '<div class="igp-banner igp-banner-' + banner.kind + '"><span>' + (banner.lines || [banner.text]).map(esc).join('<br>') + '</span><button class="igp-x" id="igp-banner-x" aria-label="×">×</button></div>' : '')

      // Race
      + '<section class="igp-card"><h3>' + esc(tr('igp_race')) + '</h3>'
      + '<div class="igp-grid4">'
      + '<label class="igp-field"><span>' + esc(tr('igp_track')) + '</span>'
      + '<button class="igp-input igp-track-btn" id="igp-track">' + t.flag + ' ' + esc(trackName(draft.track)) + '<span class="igp-dim">' + esc(tr('igp_change')) + '</span></button></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_date')) + '</span><input class="igp-input" type="date" id="igp-date" value="' + esc(draft.race_date) + '"></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_total_laps')) + '</span><input class="igp-input" type="number" inputmode="numeric" min="1" max="120" id="igp-laps" value="' + (draft.laps ?? '') + '"></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_reserve')) + '</span><input class="igp-input" type="number" inputmode="decimal" min="0" max="5" step="0.1" id="igp-reserve" value="' + (draft.reserve ?? '') + '"></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_min_life')) + '</span><input class="igp-input" type="number" inputmode="numeric" min="10" max="80" step="1" id="igp-minlife" value="' + (draft.minLife ?? '') + '"></label>'
      + '<label class="igp-field igp-span3"><span>' + esc(tr('igp_notes')) + '</span><input class="igp-input" type="text" maxlength="500" id="igp-notes" placeholder="' + esc(tr('igp_notes_ph')) + '" value="' + esc(draft.notes) + '"></label>'
      + '</div></section>'

      // Car tabs
      + '<div class="igp-cars">'
      + '<button class="igp-car-tab' + (activeCar === 0 ? ' on' : '') + '" data-car="0">🏎️ ' + esc(carLabel(0, draft.cars[0])) + '</button>'
      + (hasCar2
        ? '<button class="igp-car-tab' + (activeCar === 1 ? ' on' : '') + '" data-car="1">🏎️ ' + esc(carLabel(1, draft.cars[1])) + '</button>'
        : '<button class="igp-car-tab igp-car-add" id="igp-add-car">＋ ' + esc(tr('igp_add_car2')) + '</button>')
      + '</div>'
      + driverBarHtml(car)

      + '<div class="igp-cols">'
      // Setup
      + '<section class="igp-card"><div class="igp-card-head"><h3>' + esc(tr('igp_setup')) + '</h3><div class="igp-card-actions">'
      + (activeCar === 1 ? '<button class="igp-link" id="igp-copy1">' + esc(tr('igp_copy_car1')) + '</button>' : '')
      + '<button class="igp-link" id="igp-reset">' + esc(tr('igp_reset_setup')) + '</button>'
      + '</div></div>'
      + '<div class="igp-sliders">' + SETUP.map(d => sliderHtml(d, car.setup[d.key])).join('') + '</div>'
      + (activeCar === 1 ? '<button class="igp-link igp-danger" id="igp-rm-car">' + esc(tr('igp_remove_car2')) + '</button>' : '')
      + '</section>'

      + '<div class="igp-col">'
      // Practice
      + '<section class="igp-card"><h3>' + esc(tr('igp_practice')) + '</h3>'
      + '<div class="igp-tyre-tabs">' + TYRES.map(ty => {
        const x = car.tyres[ty];
        const filled = x.fuel > 0 && x.wear > 0;
        return '<button class="igp-tyre-tab' + (activeTyre === ty ? ' on' : '') + '" data-tyre="' + ty + '">'
          + tyreChip(ty, 'lg') + (filled ? '<span class="igp-dot"></span>' : '') + '</button>';
      }).join('') + '</div>'
      + '<div class="igp-grid3">'
      + tyreField('fuel', 'igp_fuel_lap', car.tyres[activeTyre].fuel, 0.1)
      + tyreField('wear', 'igp_wear_lap', car.tyres[activeTyre].wear, 0.1)
      + tyreField('coef', 'igp_race_coef', car.tyres[activeTyre].coef, 0.05)
      + '</div>'
      + '<p class="igp-note">' + esc(tr('igp_coef_note')) + '</p>'
      + '</section>'
      // Strategy
      + '<section class="igp-card"><h3>' + esc(tr('igp_strategy')) + '</h3><div id="igp-results"></div></section>'
      + '</div></div>'

      + (draft.id ? '<div class="igp-foot"><button class="igp-btn igp-danger-btn" id="igp-delete">🗑 ' + esc(tr('igp_delete')) + '</button></div>' : '')
      + '</div></div>';

    renderResults();
    bindEditor(car);
  }

  function abilityHtml(d) {
    if (!d || !d.ability) return '';
    return '<span class="igp-ability igp-tier-' + esc(d.tier || 'common') + '">' + esc(tr('igp_ab_' + d.ability))
      + ' · ' + esc(tr('igp_tier_' + (d.tier || 'common'))) + '</span>';
  }
  function driverFacts(d) {
    return (d.talent != null ? '<span class="igp-dim">' + esc(tr('igp_d_talent')) + ' ' + esc(d.talent) + '</span>' : '')
      + abilityHtml(d);
  }

  function driverBarHtml(car) {
    const cur = car.driver ? driverById(car.driver) : null;
    const options = '<option value="">' + esc(tr('igp_no_driver')) + '</option>'
      + drivers.map(d => '<option value="' + d.id + '"' + (car.driver === d.id ? ' selected' : '') + '>'
        + esc((flagOf(d.country) ? flagOf(d.country) + ' ' : '') + d.name) + '</option>').join('')
      + (car.driver && !cur ? '<option value="' + esc(car.driver) + '" selected>' + esc(car.driverName) + '</option>' : '');
    return '<div class="igp-driver-bar">'
      + '<label class="igp-field igp-driver-pick"><span>' + esc(tr('igp_driver')) + '</span>'
      + '<select class="igp-input" id="igp-driver">' + options + '</select></label>'
      + '<div class="igp-driver-facts">'
      + (cur ? driverFacts(cur) + (cur.fav_track === draft.track ? '<span class="igp-fav">★ ' + esc(tr('igp_d_fav')) + '</span>' : '') : '')
      + '</div>'
      + '<button class="igp-btn igp-ghost" id="igp-load">⤓ ' + esc(tr('igp_load_from')) + '</button>'
      + '</div>';
  }

  function sliderHtml(d, v) {
    const pct = ((v - d.min) / (d.max - d.min)) * 100;
    return '<div class="igp-slider" data-key="' + d.key + '">'
      + '<div class="igp-slider-top"><span class="igp-slider-label">' + esc(tr('igp_s_' + d.key)) + '</span>'
      + '<span class="igp-slider-val">' + esc(fmt(d, v)) + '</span></div>'
      + '<div class="igp-slider-row">'
      + '<button class="igp-step" data-dir="-1" aria-label="−">−</button>'
      + '<input type="range" min="0" max="' + stepsOf(d) + '" step="1" value="' + Math.round((v - d.min) / d.step) + '" style="--p:' + pct + '%" aria-label="' + esc(tr('igp_s_' + d.key)) + '">'
      + '<button class="igp-step" data-dir="1" aria-label="+">+</button>'
      + '</div>'
      + '<div class="igp-slider-ends"><span>' + esc(fmt(d, d.min)) + '</span><span>' + esc(fmt(d, d.max)) + '</span></div>'
      + '</div>';
  }

  function tyreField(field, label, value, step) {
    return '<label class="igp-field"><span>' + esc(tr(label)) + '</span>'
      + '<input class="igp-input" type="number" inputmode="decimal" min="0" step="' + step + '" data-field="' + field + '" value="' + (value ?? '') + '"></label>';
  }

  function renderResults() {
    const box = root.querySelector('#igp-results');
    if (!box) return;
    const car = draft.cars[activeCar];
    const res = strategies(car.tyres, draft.laps, draft.reserve, draft.minLife);

    if (res.empty) { box.innerHTML = '<div class="igp-empty igp-empty-sm">' + esc(tr('igp_no_data')) + '</div>'; return; }
    if (res.error) { box.innerHTML = '<div class="igp-warn-box">' + esc(tr('igp_no_cover')) + '</div>'; return; }

    const chosen = pickedStrategy(car, res);
    const chosenKey = comboKey(chosen.combo);
    const d = res.data;

    box.innerHTML = '<div class="igp-stats">'
      + '<div class="igp-stat"><b>' + chosen.nPits + '</b><span>' + esc(tr('igp_pit_stops')) + '</span></div>'
      + '<div class="igp-stat"><b>' + chosen.totalFuel + '</b><span>' + esc(tr('igp_fuel_total')) + '</span></div>'
      + '<div class="igp-stat"><b>' + esc(draft.minLife) + '%</b><span>' + esc(tr('igp_min_life_lbl')) + '</span></div>'
      + '</div>'
      + res.strategies.map((s, idx) => {
        const key = comboKey(s.combo);
        const isChosen = key === chosenKey;
        const open = openAccords.has(key);
        return '<div class="igp-strat' + (isChosen ? ' chosen' : '') + (idx === 0 ? ' best' : '') + '">'
          + '<div class="igp-strat-head" data-key="' + key + '">'
          + '<button class="igp-pick" data-pick="' + key + '" title="' + esc(tr(isChosen ? 'igp_chosen' : 'igp_use_strategy')) + '" aria-label="' + esc(tr(isChosen ? 'igp_chosen' : 'igp_use_strategy')) + '">' + (isChosen ? '✓' : '') + '</button>'
          + (idx === 0 ? '<span class="igp-star">★</span>' : '')
          + '<span class="igp-combo">' + comboHtml(s.combo, 'sm') + '</span>'
          + '<span class="igp-dim igp-nowrap">' + esc(pitsLabel(s.nPits)) + '</span>'
          + '<span class="igp-fuel igp-nowrap">' + s.totalFuel + ' ' + esc(tr('igp_fuel_unit')) + '</span>'
          + '<span class="igp-chev' + (open ? ' open' : '') + '">▾</span>'
          + '</div>'
          + (open ? '<div class="igp-stints">' + s.combo.map((ty, si) => {
            const rem = tyreRemaining(d[ty], s.stintLaps[si]);
            return '<div class="igp-stint"><div class="igp-stint-top">' + tyreChip(ty, 'md')
              + '<span class="igp-dim">' + esc(si === 0 ? tr('igp_start') : tr('igp_pit') + ' ' + si) + '</span></div>'
              + '<div class="igp-stint-laps">' + s.stintLaps[si] + '<small>' + esc(tr('igp_laps')) + '</small></div>'
              + '<div class="igp-dim igp-small">' + (s.stintLaps[si] * d[ty].fuel).toFixed(1) + ' ' + esc(tr('igp_fuel_unit')) + ' · ' + esc(tr('igp_max')) + ' ' + d[ty].maxLaps + '</div>'
              + '<div class="igp-bar"><div class="' + remainingClass(rem) + '" style="width:' + (rem ?? 0) + '%"></div></div>'
              + '<div class="igp-dim igp-small">' + rem + esc(tr('igp_of_life')) + '</div>'
              + '</div>';
          }).join('') + '</div>' : '')
          + '</div>';
      }).join('');

    box.querySelectorAll('.igp-strat-head').forEach(h => {
      h.onclick = (e) => {
        const pick = e.target.closest('.igp-pick');
        if (pick) { car.pick = pick.dataset.pick; renderResults(); return; }
        const k = h.dataset.key;
        openAccords.has(k) ? openAccords.delete(k) : openAccords.add(k);
        renderResults();
      };
    });
  }

  function bindEditor(car) {
    const $ = s => root.querySelector(s);
    $('#igp-back').onclick = leaveEditor;
    $('#igp-save').onclick = save;
    const bx = $('#igp-banner-x');
    if (bx) bx.onclick = () => { banner = null; bx.parentElement.remove(); };
    $('#igp-track').onclick = (e) => { e.preventDefault(); view = 'pick'; render(); };
    $('#igp-date').onchange = e => { if (e.target.value) draft.race_date = e.target.value; };
    $('#igp-notes').oninput = e => { draft.notes = e.target.value; };
    $('#igp-laps').oninput = e => { draft.laps = num(e.target.value); renderResults(); };
    $('#igp-reserve').oninput = e => { draft.reserve = num(e.target.value) ?? 0; renderResults(); };
    $('#igp-minlife').oninput = e => { draft.minLife = num(e.target.value) ?? 0; renderResults(); };

    root.querySelectorAll('.igp-car-tab[data-car]').forEach(b => {
      b.onclick = () => { activeCar = +b.dataset.car; openAccords = new Set(); render(); };
    });
    const add = $('#igp-add-car');
    if (add) add.onclick = () => {
      const s2 = seatOf(2);
      draft.cars[1] = newCar(s2 && s2.id !== draft.cars[0].driver ? s2 : null);
      activeCar = 1; openAccords = new Set(); render();
    };
    $('#igp-driver').onchange = e => {
      const id = e.target.value ? Number(e.target.value) : null;
      const d = id ? driverById(id) : null;
      if (id && !d) return;
      car.driver = id; car.driverName = d ? d.name : '';
      render();
    };
    $('#igp-load').onclick = () => { loadCar = activeCar; view = 'load'; render(); };
    const rm = $('#igp-rm-car');
    if (rm) rm.onclick = () => {
      if (!confirm(tr('igp_remove_car2_confirm'))) return;
      draft.cars[1] = null; activeCar = 0; render();
    };
    const cp = $('#igp-copy1');
    if (cp) cp.onclick = () => { car.setup = Object.assign({}, draft.cars[0].setup); render(); };
    $('#igp-reset').onclick = () => { car.setup = defaultSetup(); render(); };

    root.querySelectorAll('.igp-tyre-tab').forEach(b => {
      b.onclick = () => { activeTyre = b.dataset.tyre; render(); };
    });
    root.querySelectorAll('input[data-field]').forEach(inp => {
      inp.oninput = () => {
        car.tyres[activeTyre][inp.dataset.field] = num(inp.value);
        const x = car.tyres[activeTyre];
        const tab = root.querySelector('.igp-tyre-tab[data-tyre="' + activeTyre + '"]');
        const dot = tab.querySelector('.igp-dot');
        if (x.fuel > 0 && x.wear > 0) { if (!dot) tab.insertAdjacentHTML('beforeend', '<span class="igp-dot"></span>'); }
        else if (dot) dot.remove();
        renderResults();
      };
    });

    root.querySelectorAll('.igp-slider').forEach(el => bindSlider(el, car));

    const del = $('#igp-delete');
    if (del) del.onclick = async () => {
      if (!confirm(tr('igp_delete_confirm'))) return;
      try {
        await api('DELETE', '/races/' + draft.id);
        races = races.filter(r => r.id !== draft.id);
        draft = null; banner = null; view = 'list'; render();
      } catch (_) { alert(tr('igp_save_error')); }
    };
  }

  // One slider: drag it, or nudge it one in-game step with − / +. Holding a
  // button keeps stepping, the way the game's own buttons do.
  function bindSlider(el, car) {
    const d = SETUP_BY[el.dataset.key];
    const range = el.querySelector('input[type=range]');
    const val = el.querySelector('.igp-slider-val');
    function show() {
      const v = car.setup[d.key];
      range.value = Math.round((v - d.min) / d.step);
      range.style.setProperty('--p', ((v - d.min) / (d.max - d.min)) * 100 + '%');
      val.textContent = fmt(d, v);
    }
    range.oninput = () => { car.setup[d.key] = snap(d, d.min + Number(range.value) * d.step); show(); };
    el.querySelectorAll('.igp-step').forEach(btn => {
      const dir = +btn.dataset.dir;
      let t1 = 0, t2 = 0;
      const nudge = () => { car.setup[d.key] = snap(d, car.setup[d.key] + dir * d.step); show(); };
      const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; };
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        stop();
        nudge();
        t1 = setTimeout(() => { t2 = setInterval(nudge, 70); }, 420);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
      // Keyboard (Enter / Space) arrives as a click with no pointer behind it.
      btn.addEventListener('click', e => { if (e.detail === 0) nudge(); });
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  // ── Load a car from an earlier race on this track ──────────────────────────
  function renderLoad() {
    const car = draft.cars[loadCar];
    const past = races.filter(r => r.track === draft.track && r.id !== draft.id);
    const t = TRACK[draft.track];
    const body = !past.length
      ? '<div class="igp-empty">' + esc(tr('igp_load_none')) + '</div>'
      : '<div class="igp-races">' + past.map(r => {
        const cars = (r.data && Array.isArray(r.data.cars)) ? r.data.cars : [];
        return '<div class="igp-race igp-load-race">'
          + '<div class="igp-race-head"><span class="igp-race-date">' + esc(fmtDate(r.race_date)) + '</span></div>'
          + cars.map((c, i) => {
            if (!c) return '';
            const same = car.driver && c.driver === car.driver;
            const st = c.strategy;
            const su = cleanSetup(c.setup);
            return '<button class="igp-load-car' + (same ? ' same' : '') + '" data-race="' + r.id + '" data-car="' + i + '">'
              + '<span class="igp-car-tag">' + esc(carLabel(i, c)) + '</span>'
              + (st && Array.isArray(st.combo) ? '<span class="igp-combo">' + comboHtml(st.combo, 'xs') + '</span>' : '')
              + '<span class="igp-dim igp-small">' + ['tyre', 'fw', 'rw', 'gear'].map(k => esc(fmt(SETUP_BY[k], su[k]))).join(' · ') + '</span>'
              + '</button>';
          }).join('')
          + (r.data && r.data.notes ? '<div class="igp-race-notes">' + esc(r.data.notes) + '</div>' : '')
          + '</div>';
      }).join('') + '</div>';

    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-back">‹ ' + esc(tr('igp_back')) + '</button>'
      + '<div class="igp-top-title"><span class="igp-flag">' + t.flag + '</span> ' + esc(tr('igp_load_title', { track: trackName(draft.track) })) + '</div><span></span>'
      + '</div>'
      + '<p class="igp-note">' + esc(tr('igp_load_note', { car: carLabel(loadCar, car) })) + '</p>'
      + body
      + '</div></div>';

    root.querySelector('#igp-back').onclick = () => { view = 'edit'; render(); };
    root.querySelectorAll('.igp-load-car').forEach(b => {
      b.onclick = () => {
        const r = races.find(x => String(x.id) === b.dataset.race);
        const src = r && r.data && r.data.cars && r.data.cars[+b.dataset.car];
        if (!src) return;
        const c = cleanCar(src);
        car.setup = c.setup; car.tyres = c.tyres; car.pick = null;
        banner = { kind: 'info', text: tr('igp_loaded', { n: loadCar + 1, date: fmtDate(r.race_date) }) };
        activeCar = loadCar; openAccords = new Set();
        view = 'edit'; render();
      };
    });
  }

  // ── Drivers ────────────────────────────────────────────────────────────────
  function renderDrivers() {
    const seatSelect = n => {
      const cur = seatOf(n);
      return '<label class="igp-field"><span>🏎️ ' + esc(tr('igp_car', { n })) + '</span>'
        + '<select class="igp-input igp-seat" data-seat="' + n + '"><option value="">' + esc(tr('igp_no_driver')) + '</option>'
        + drivers.map(d => '<option value="' + d.id + '"' + (cur && cur.id === d.id ? ' selected' : '') + '>'
          + esc((flagOf(d.country) ? flagOf(d.country) + ' ' : '') + d.name) + '</option>').join('')
        + '</select></label>';
    };
    const list = !drivers.length
      ? '<div class="igp-empty"><div class="igp-empty-icon">👤</div>' + esc(tr('igp_no_drivers')) + '</div>'
      : '<div class="igp-races">' + drivers.map(d => {
        const fav = d.fav_track && TRACK[d.fav_track];
        return '<button class="igp-race igp-driver" data-id="' + d.id + '">'
          + '<div class="igp-race-head"><span class="igp-flag">' + (flagOf(d.country) || '👤') + '</span>'
          + '<span class="igp-race-name">' + esc(d.name) + '</span>'
          + (d.car ? '<span class="igp-car-tag">🏎️ ' + esc(tr('igp_car', { n: d.car })) + '</span>' : '') + '</div>'
          + '<div class="igp-driver-facts">' + driverFacts(d)
          + (fav ? '<span class="igp-dim">★ ' + fav.flag + ' ' + esc(trackName(d.fav_track)) + '</span>' : '')
          + '</div></button>';
      }).join('') + '</div>';

    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-back">‹ ' + esc(tr('igp_my_races')) + '</button>'
      + '<div class="igp-top-title">👤 ' + esc(tr('igp_drivers')) + '</div>'
      + '<button class="igp-btn igp-primary" id="igp-new-driver">＋ ' + esc(tr('igp_new_driver')) + '</button>'
      + '</div>'
      + (drivers.length ? '<section class="igp-card"><h3>' + esc(tr('igp_seats')) + '</h3>'
        + '<div class="igp-grid2">' + seatSelect(1) + seatSelect(2) + '</div>'
        + '<p class="igp-note">' + esc(tr('igp_seats_note')) + '</p></section>' : '')
      + list
      + '</div></div>';

    root.querySelector('#igp-back').onclick = () => { view = 'list'; render(); };
    root.querySelector('#igp-new-driver').onclick = () => {
      driverDraft = { id: null, name: '', country: '', fav_track: '', talent: null, ability: '', tier: 'common', car: null };
      view = 'driver'; render();
    };
    root.querySelectorAll('.igp-driver').forEach(b => {
      b.onclick = () => {
        const d = driverById(Number(b.dataset.id));
        if (!d) return;
        driverDraft = Object.assign({}, d, { tier: d.tier || 'common' });
        view = 'driver'; render();
      };
    });
    root.querySelectorAll('.igp-seat').forEach(sel => {
      sel.onchange = async () => {
        const seats = {};
        root.querySelectorAll('.igp-seat').forEach(x => { seats[x.dataset.seat] = x.value ? Number(x.value) : null; });
        // One driver, one car: taking a driver into this car empties the other.
        const other = sel.dataset.seat === '1' ? '2' : '1';
        if (seats[other] != null && seats[other] === seats[sel.dataset.seat]) seats[other] = null;
        try {
          const res = await api('POST', '/drivers/seats', seats);
          drivers = res.drivers || drivers;
        } catch (_) { alert(tr('igp_save_error')); }
        render();
      };
    });
  }

  function renderDriverForm() {
    const d = driverDraft;
    const countries = COUNTRIES.map(c => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
    root.innerHTML = '<div class="igp-page"><div class="igp-wrap">'
      + '<div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-back">‹ ' + esc(tr('igp_drivers')) + '</button>'
      + '<div class="igp-top-title">' + esc(tr(d.id ? 'igp_edit_driver' : 'igp_new_driver')) + '</div>'
      + '<button class="igp-btn igp-primary" id="igp-save">' + esc(tr('igp_save')) + '</button>'
      + '</div>'
      + '<section class="igp-card"><div class="igp-grid2">'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_name')) + '</span><input class="igp-input" id="igp-d-name" maxlength="40" value="' + esc(d.name) + '"></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_country')) + '</span><select class="igp-input" id="igp-d-country"><option value="">—</option>'
      + countries.map(([c, n]) => '<option value="' + c + '"' + (d.country === c ? ' selected' : '') + '>' + flagOf(c) + ' ' + esc(n) + '</option>').join('')
      + '</select></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_fav')) + '</span><select class="igp-input" id="igp-d-fav"><option value="">—</option>'
      + sortedTracks().map(t => '<option value="' + t.key + '"' + (d.fav_track === t.key ? ' selected' : '') + '>' + t.flag + ' ' + esc(trackName(t.key)) + '</option>').join('')
      + '</select></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_talent')) + '</span><input class="igp-input" id="igp-d-talent" type="number" inputmode="numeric" min="1" max="100" step="1" value="' + (d.talent ?? '') + '"></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_ability')) + '</span><select class="igp-input" id="igp-d-ability"><option value="">' + esc(tr('igp_ab_none')) + '</option>'
      + ABILITIES.map(a => '<option value="' + a + '"' + (d.ability === a ? ' selected' : '') + '>' + esc(tr('igp_ab_' + a)) + '</option>').join('')
      + '</select></label>'
      + '<label class="igp-field"><span>' + esc(tr('igp_d_tier')) + '</span><select class="igp-input" id="igp-d-tier"' + (d.ability ? '' : ' disabled') + '>'
      + TIERS.map(x => '<option value="' + x + '"' + (d.tier === x ? ' selected' : '') + '>' + esc(tr('igp_tier_' + x)) + '</option>').join('')
      + '</select></label>'
      + '</div></section>'
      + (d.id ? '<div class="igp-foot"><button class="igp-btn igp-danger-btn" id="igp-delete">🗑 ' + esc(tr('igp_d_delete')) + '</button></div>' : '')
      + '</div></div>';

    const $ = s => root.querySelector(s);
    const read = () => {
      d.name = $('#igp-d-name').value;
      d.country = $('#igp-d-country').value;
      d.fav_track = $('#igp-d-fav').value;
      d.talent = num($('#igp-d-talent').value);
      d.ability = $('#igp-d-ability').value;
      d.tier = $('#igp-d-tier').value;
    };
    $('#igp-back').onclick = () => { driverDraft = null; view = 'drivers'; render(); };
    $('#igp-d-ability').onchange = () => { $('#igp-d-tier').disabled = !$('#igp-d-ability').value; };
    $('#igp-save').onclick = async () => {
      read();
      if (!d.name.trim()) { alert(tr('igp_name_required')); return; }
      if (d.talent != null && !(d.talent >= 1 && d.talent <= 100)) { alert(tr('igp_talent_range')); return; }
      const body = { name: d.name.trim(), country: d.country, fav_track: d.fav_track,
        talent: d.talent == null ? null : Math.round(d.talent),
        ability: d.ability, tier: d.ability ? d.tier : '', car: d.car || null };
      if (d.id) body.id = d.id;
      try {
        const res = await api('POST', '/drivers', body);
        drivers = res.drivers || drivers;
        driverDraft = null; view = 'drivers'; render();
      } catch (_) { alert(tr('igp_save_error')); }
    };
    const del = $('#igp-delete');
    if (del) del.onclick = async () => {
      if (!confirm(tr('igp_d_delete_confirm'))) return;
      try {
        const res = await api('DELETE', '/drivers/' + d.id);
        drivers = res.drivers || drivers.filter(x => x.id !== d.id);
        driverDraft = null; view = 'drivers'; render();
      } catch (_) { alert(tr('igp_save_error')); }
    };
  }

  async function save() {
    if (saving) return;
    if (!draft.laps || draft.laps < 1) { alert(tr('igp_laps_required')); return; }
    saving = true;
    const btn = root.querySelector('#igp-save');
    if (btn) { btn.disabled = true; btn.textContent = tr('igp_saving'); }
    try {
      const body = { track: draft.track, race_date: draft.race_date, data: serialize(draft) };
      if (draft.id) body.id = draft.id;
      const res = await api('POST', '/races', body);
      const r = res.race;
      races = races.filter(x => x.id !== r.id);
      races.push(r);
      races.sort((a, b) => (b.race_date.localeCompare(a.race_date)) || (b.id - a.id));
      draft.id = r.id;
      savedJson = draftJson();
      banner = { kind: 'ok', text: tr('igp_saved') };
    } catch (_) {
      banner = { kind: 'warn', text: tr('igp_save_error') };
    }
    saving = false;
    render();
  }

  function exit() {
    mp.send({ type: 'igp_exit' });
    // room_closed normally takes us there; this is the fallback.
    setTimeout(() => { location.href = HUB_URL; }, 800);
  }

  async function load() {
    try {
      const [d, dr] = await Promise.all([api('GET', '/races'), api('GET', '/drivers')]);
      races = d.races || [];
      drivers = dr.drivers || [];
      loadError = false;
    } catch (_) {
      loadError = true;
    }
  }

  // ── Game Hub hooks ─────────────────────────────────────────────────────────
  // Nothing to set up and nobody to wait for, so the lobby is skipped: the
  // host's own start request goes out as soon as the lobby shows.
  let starting = false;
  function renderSetup(box) {
    box.innerHTML = '<div class="igp-opening">' + esc(tr('igp_opening')) + '</div>';
    if (!starting) {
      starting = true;
      fetch('/api/pub/gamehub/mp/rooms/' + encodeURIComponent(mp.roomId()) + '/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gh_token: window.GameHub.getToken(), settings: {} }),
      }).catch(() => { starting = false; });
    }
    return () => ({});
  }

  async function renderGame(box) {
    root = box;
    root.classList.add('igp-root');
    root.innerHTML = '<div class="igp-page"><div class="igp-opening">' + esc(tr('igp_opening')) + '</div></div>';
    await load();
    render();
  }

  mp.on('room_closed', () => { location.href = HUB_URL; });

  window.addEventListener('beforeunload', e => {
    if (view === 'edit' && dirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  mp.registerGame({
    id: GAME_ID,
    name: 'IGP Calculator',
    renderSetup,
    renderGame,
    exitButton: false,
    saveable: false,
  });
})();
