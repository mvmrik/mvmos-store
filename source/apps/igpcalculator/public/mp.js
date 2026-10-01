/*
 * IGP Calculator — runs on Game Hub's generic play page (NOT inside mvmOS).
 *
 * There is no game here: the room only gives the page an Apps Hub account.
 * Everything is calculated in the browser, and every race the player prepares
 * (driver, setup and practice data for up to two cars, the chosen tyre
 * strategy) and their list of drivers are kept on their profile through this
 * app's own api.py at /pub/igpcalculator.
 *
 * The tyre arithmetic started as a port of the IGP Calculator on mvmrik.com,
 * which is no longer maintained. Wear here is linear, and each race's real
 * pit stops teach the next ones how much faster tyres wear than in practice.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const GAME_ID = 'igpcalculator';
  const API = '/pub/igpcalculator';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const importScript = new URL('import.js', document.currentScript?.src || location.origin + '/apps/igpcalculator/mp.js');
  importScript.searchParams.set('v', '20260930-progress');

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
  // Intermediates and wets: never part of a dry strategy and never in
  // practice, but raced in the rain, so their real wear is kept as well.
  const WET = ['I', 'W'];
  const ALL_TYRES = TYRES.concat(WET);
  // Race wear against practice wear, until the player's own pit stops say
  // otherwise. The player never sets it: learnedFor() works it out.
  const DEFAULT_COEF = 1.2;
  const TYRE_RING = { SS: '#e63232', S: '#e6c832', M: '#d0d0d0', H: '#e87820', I: '#3cb44b', W: '#2f7fe0' };

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
  function emptyTyres() { return Object.fromEntries(ALL_TYRES.map(t => [t, { fuel: null, wear: null, time: null, coef: DEFAULT_COEF }])); }
  function newCar(driver) {
    return { setup: defaultSetup(), tyres: emptyTyres(), pick: null,
      driver: driver ? driver.id : null, driverName: driver ? driver.name : '', igpDriverId: driver?.igp_id || null };
  }

  function cleanSetup(s) {
    const out = defaultSetup();
    if (s && typeof s === 'object') SETUP.forEach(d => { if (s[d.key] != null && !isNaN(s[d.key])) out[d.key] = snap(d, s[d.key]); });
    return out;
  }
  function num(v) { return (v === '' || v == null || isNaN(v)) ? null : Number(v); }
  function cleanTyres(ty) {
    const out = emptyTyres();
    if (ty && typeof ty === 'object') ALL_TYRES.forEach(t => {
      const x = ty[t] || {};
      out[t] = { fuel: num(x.fuel), wear: num(x.wear), time: num(x.time), coef: x.coef === undefined ? DEFAULT_COEF : num(x.coef) };
    });
    return out;
  }
  function cleanActual(a) {
    if (!a || typeof a !== 'object' || !Array.isArray(a.stints)) return null;
    return {
      startFuel: num(a.startFuel),
      stints: a.stints.slice(0, 8).map(s => {
        const tyre = ALL_TYRES.includes(s && s.tyre) ? s.tyre : 'M';
        const out = { tyre, lap: num(s && s.lap), left: num(s && s.left), fuel: num(s && s.fuel) };
        // A dry tyre driven in the rain: its wear says nothing about the dry.
        if (s && s.rain === true && TYRES.includes(tyre)) out.rain = true;
        return out;
      }),
    };
  }
  function cleanCar(c) {
    return { setup: cleanSetup(c && c.setup), tyres: cleanTyres(c && c.tyres), pick: (c && c.pick) || null,
      driver: (c && c.driver) || null, driverName: (c && typeof c.driverName === 'string') ? c.driverName : '',
      actual: cleanActual(c && c.actual), planned: cleanPlanned(c && c.strategy), learn: cleanLearn(c && c.learn),
      igpDriverId: c?.igpDriverId || null, igpResultId: c?.igpResultId || null,
      setupMissing: !!(c?.setupMissing || (c?.igpDriverId && !c.setup)),
      practice: Array.isArray(c?.practice) ? c.practice : [], report: Array.isArray(c?.report) ? c.report : [],
      position: num(c?.position), finish: c?.finish || '', bestLap: num(c?.bestLap) };
  }
  // Where the car's race coefficients came from, for the line above the strategy.
  function cleanLearn(l) {
    if (!l || !['driver', 'track', 'all', 'none'].includes(l.kind)) return null;
    return { kind: l.kind, date: typeof l.date === 'string' ? l.date : null,
      driverName: typeof l.driverName === 'string' ? l.driverName : '' };
  }
  // The strategy the race was saved with. Practice data or the formula may
  // change later; the race keeps the plan it was actually run on.
  function cleanPlanned(s) {
    if (!s || !Array.isArray(s.combo) || !Array.isArray(s.stintLaps) || s.combo.length !== s.stintLaps.length) return null;
    if (!s.combo.every(t => ALL_TYRES.includes(t)) || !s.stintLaps.every(n => n > 0)) return null;
    return { combo: s.combo.slice(), stintLaps: s.stintLaps.map(Number), totalFuel: num(s.totalFuel), nPits: s.combo.length - 1 };
  }

  // ── What really happened in the race ───────────────────────────────────────
  // After the race the player enters, for every pit stop and the finish, the
  // tyre, the lap, the tyre left on the set that came off and the fuel left.
  // Each stint gives the real wear per lap; for a dry tyre, against its
  // practice wear, that is the race coefficient the next races start from.
  // Fuel left from one stop to the next gives the real fuel per lap.
  function raceFacts(car) {
    const a = car.actual;
    if (!a) return null;
    let prevLap = 0, prevFuel = a.startFuel;
    const rows = a.stints.map(s => {
      const laps = s.lap != null && s.lap > prevLap ? s.lap - prevLap : null;
      const pw = car.tyres[s.tyre] ? car.tyres[s.tyre].wear : null;
      const r = { laps, wear: null, practice: pw > 0 ? pw : null, fuel: null };
      if (laps && !s.rain && s.left != null && s.left >= 0 && s.left <= 100) r.wear = (100 - s.left) / laps;
      if (laps && prevFuel != null && s.fuel != null && prevFuel > s.fuel) r.fuel = (prevFuel - s.fuel) / laps;
      if (s.lap != null) prevLap = s.lap;
      prevFuel = s.fuel;
      return r;
    });
    // Sums per tyre, weighted by laps: worn against practice wherever there
    // was practice on that tyre, and the plain race wear of every stint, which
    // still tells how long a tyre lasts here when a race (an old one entered
    // only from its report, or rain that was not in practice) had no practice.
    const ratio = {}, real = {};
    let worn = 0, base = 0;
    a.stints.forEach((s, i) => {
      const r = rows[i];
      if (r.wear == null) return;
      if (r.practice) {
        const x = ratio[s.tyre] || (ratio[s.tyre] = { worn: 0, base: 0, laps: 0 });
        x.worn += r.wear * r.laps; x.base += r.practice * r.laps; x.laps += r.laps;
        worn += r.wear * r.laps; base += r.practice * r.laps;
      }
      const x = real[s.tyre] || (real[s.tyre] = { worn: 0, laps: 0 });
      x.worn += r.wear * r.laps; x.laps += r.laps;
    });
    return { rows, ratio, real, worn, base };
  }

  // A car carried into a new race: its setup and practice data, without the
  // result and plan that belong to the race it came from.
  function carryCar(src) {
    const c = cleanCar(src);
    c.actual = null;
    c.pick = null;
    c.planned = null;
    c.learn = null;
    c.practice = []; c.report = []; c.position = null; c.finish = ''; c.bestLap = null; c.igpResultId = null;
    return c;
  }

  // What earlier pit stops say about this track: this driver's last race here
  // with pit stops entered, else the last race here with any, else every race
  // with pit stops on any track. `pick` chooses the stints that count.
  function learnFrom(track, driverId, has) {
    const past = races.filter(r => !draft || r.id !== draft.id).map(r => ({
      r, cars: (r.data && Array.isArray(r.data.cars) ? r.data.cars : []).filter(Boolean)
        .map(c => ({ driver: c.driver || null, f: raceFacts(cleanCar(c)) })).filter(c => c.f && has(c.f)),
    })).filter(x => x.cars.length);
    const here = past.filter(x => x.r.track === track);
    if (driverId) {
      for (const x of here) {
        const mine = x.cars.filter(c => c.driver === driverId);
        if (mine.length) return { kind: 'driver', date: x.r.race_date, facts: mine.map(c => c.f) };
      }
    }
    if (here.length) return { kind: 'track', date: here[0].r.race_date, facts: here[0].cars.map(c => c.f) };
    if (past.length) return { kind: 'all', date: null, facts: [].concat(...past.map(x => x.cars.map(c => c.f))) };
    return null;
  }

  // Race coefficients for a new race. Each tyre takes its own, a tyre not
  // raced takes the average of the others, and with no pit stops anywhere yet
  // the default stays. New practice wear is entered as usual and multiplied.
  function learnedFor(track, driverId) {
    const L = learnFrom(track, driverId, f => f.base > 0);
    if (!L) return { learn: { kind: 'none', date: null }, coefs: null };
    const sum = {};
    let worn = 0, base = 0;
    L.facts.forEach(f => {
      Object.keys(f.ratio).forEach(t => {
        const x = sum[t] || (sum[t] = { worn: 0, base: 0 });
        x.worn += f.ratio[t].worn; x.base += f.ratio[t].base;
      });
      worn += f.worn; base += f.base;
    });
    const coefs = Object.fromEntries(ALL_TYRES.map(t => [t, round2(sum[t] ? sum[t].worn / sum[t].base : worn / base)]));
    return { learn: { kind: L.kind, date: L.date }, coefs };
  }

  // Real wear per lap of intermediates and wets, from the same sources.
  // Plain race wear per lap of the tyres of this weather. Dry tyres only
  // from this track; rain is rare, so wet ones fall back to all races.
  function realFor(track, driverId, rain) {
    const pool = rain ? WET : TYRES;
    const L = learnFrom(track, driverId, f => pool.some(t => f.real[t]));
    if (!L || (L.kind === 'all' && !rain)) return null;
    const out = {};
    pool.forEach(t => {
      let worn = 0, laps = 0;
      L.facts.forEach(f => { if (f.real[t]) { worn += f.real[t].worn; laps += f.real[t].laps; } });
      if (laps) out[t] = worn / laps;
    });
    return { kind: L.kind, date: L.date, wear: out };
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  // Puts the learned coefficients on a car of a new race.
  function applyLearned(car) {
    const L = learnedFor(draft.track, car.driver);
    ALL_TYRES.forEach(t => { car.tyres[t].coef = L.coefs ? L.coefs[t] : DEFAULT_COEF; });
    car.learn = Object.assign({ driverName: car.driverName }, L.learn);
  }


  // ── Tyre strategy ──────────────────────────────────────────────────────────
  // A tyre loses the same share of its life every lap: practice wear times the
  // race coefficient. Pit stops in real races confirmed this; wear taken as a
  // share of what is left made long stints look far healthier than they were.
  function lifeLeft(rw, laps) { return Math.max(0, 1 - rw * laps); }

  // Laps until the tyre reaches minLifePct, counting the lap that crosses it.
  function tyreLaps(wear, coef, minLifePct) {
    const rw = (wear * coef) / 100;
    if (!(rw > 0)) return 200;
    return Math.min(200, Math.max(1, Math.ceil((1 - minLifePct / 100) / rw - 1e-9)));
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
      const rem = Math.round(lifeLeft(rw, laps[i]) * 100);
      return s + Math.abs(rem - minLifePct);
    }, 0) / n;

    const capacity = combo.reduce((s, t) => s + data[t].maxLaps, 0);

    const drivingTime = combo.every(t => data[t].time > 0) ? laps.reduce((sum, l, i) => sum + l * data[combo[i]].time, 0) : null;
    return { combo, stintLaps: laps, totalFuel: fuel, nPits: n - 1, score, capacity, drivingTime };
  }

  function tyreData(tyres, minLife) {
    const d = {};
    ALL_TYRES.forEach(t => { d[t] = { ...tyres[t], maxLaps: tyreLaps(tyres[t].wear, tyres[t].coef, minLife) }; });
    return d;
  }

  // A dry race runs on SS/S/M/H and needs two different compounds; a wet one
  // runs on intermediates and wets, where one compound is enough.
  function strategies(tyres, totalLaps, reserve, minLife, rain) {
    const need = rain ? 1 : 2;
    const readyTyres = (rain ? WET : TYRES).filter(t => tyres[t].fuel > 0 && tyres[t].wear > 0 && tyres[t].coef != null);
    const hasEnoughData = readyTyres.length >= need && totalLaps > 0;
    if (!hasEnoughData) return { empty: true, error: false, strategies: [] };

    const d = tyreData(tyres, minLife);
    const total = totalLaps;

    const bestMax = Math.max(...readyTyres.map(t => Math.max(1, d[t].maxLaps)));
    const minStints = Math.max(need, Math.ceil(total / bestMax));
    const maxStints = Math.min(6, Math.max(minStints, 6)); // up to 5 pit stops

    const all = [];

    // Generate combinations with repetition (not permutations) by always
    // iterating from startIdx — each combo appears exactly once in sorted order
    function buildCombos(current, lapsLeft, startIdx = 0) {
      const n = current.length;
      if (n >= minStints && lapsLeft <= 0) {
        if (new Set(current).size < need) return;
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

    const timed = readyTyres.every(t => d[t].time > 0);
    all.sort((a, b) => {
      if (a.nPits !== b.nPits) return a.nPits - b.nPits;
      if (timed && a.drivingTime !== b.drivingTime) return a.drivingTime - b.drivingTime;
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
    return Math.round(lifeLeft(rw, stintLaps) * 100);
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
  let importBusy = false, importPlan = null, importStatus = '', importError = '', importSteps = [], importExpected = 4;

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
      igpRaceId: dr.igpRaceId || null,
      laps: dr.laps, reserve: dr.reserve, minLife: dr.minLife, rain: !!dr.rain, notes: dr.notes || '',
      cars: dr.cars.filter(Boolean).map(c => {
        const res = strategies(c.tyres, dr.laps, dr.reserve, dr.minLife, dr.rain);
        const chosen = raceStrategy(c, res);
        return {
          driver: c.driver || null, driverName: driverName(c),
          setup: c.setup, tyres: c.tyres, pick: c.pick, actual: c.actual,
          igpDriverId: c.igpDriverId || null, igpResultId: c.igpResultId || null,
          setupMissing: !!c.setupMissing, practice: c.practice || [], report: c.report || [],
          position: c.position ?? null, finish: c.finish || '', bestLap: c.bestLap ?? null,
          strategy: chosen ? { combo: chosen.combo, stintLaps: chosen.stintLaps,
            totalFuel: chosen.totalFuel, nPits: chosen.nPits } : null,
        };
      }),
    };
  }

  // What the race is run on: the picked strategy while the calculator still
  // offers it, else the plan it was saved with, else the best one.
  function raceStrategy(car, res) {
    if (car.pick && car.planned && comboKey(car.planned.combo) === car.pick
        && !(res && res.strategies.some(s => comboKey(s.combo) === car.pick))) return car.planned;
    return pickedStrategy(car, res);
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
      igpRaceId: r.igp_id || d.igpRaceId || null,
      laps: num(d.laps) || (TRACK[r.track] ? TRACK[r.track].laps : 50),
      reserve: d.reserve == null ? 1 : num(d.reserve),
      minLife: d.minLife == null ? 50 : num(d.minLife),
      rain: d.rain === true,
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
    if (view === 'import') return renderImport();
    if (view === 'pick') return renderPicker();
    if (view === 'edit') return renderEditor();
    if (view === 'load') return renderLoad();
    if (view === 'drivers') return renderDrivers();
    if (view === 'driver') return renderDriverForm();
    return renderList();
  }

  function tyreChip(t, size) {
    return '<span class="igp-tyre igp-tyre-' + (size || 'sm') + '" style="--ring:' + (TYRE_RING[t] || '#888') + '">' + esc(t) + '</span>';
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
      + (window.mvmOS?.extension?.active ? '<button class="igp-btn igp-primary" id="igp-import">⚡ ' + esc(tr('igp_import')) + '</button>' : '')
      + '<button class="igp-btn igp-ghost" id="igp-drivers">👤 ' + esc(tr('igp_drivers')) + '</button>'
      + (usedTracks.length > 1 ? '<select class="igp-input igp-filter" id="igp-filter"><option value="">' + esc(tr('igp_all_tracks')) + '</option>'
        + usedTracks.map(t => '<option value="' + t.key + '"' + (filter === t.key ? ' selected' : '') + '>' + t.flag + ' ' + esc(trackName(t.key)) + '</option>').join('')
        + '</select>' : '')
      + '</div></div>'
      + (banner ? '<div class="igp-banner igp-banner-' + banner.kind + '">' + esc(banner.text) + '</div>' : '')
      + body
      + '</div></div>';

    root.querySelector('#igp-exit').onclick = exit;
    root.querySelector('#igp-new').onclick = () => { view = 'pick'; render(); };
    root.querySelector('#igp-drivers').onclick = () => { view = 'drivers'; render(); };
    const imp = root.querySelector('#igp-import');
    if (imp) imp.onclick = startImport;
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
        const fresh = { id: null, track: key, race_date: today(), laps: TRACK[key].laps, reserve: 1, minLife: 50, rain: false, notes: '', cars: [newCar(seatOf(1)), null] };
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
      const car = src ? carryCar(src) : newCar();
      car.driver = drv ? drv.id : null;
      car.driverName = drv ? drv.name : '';
      car.igpDriverId = drv?.igp_id || null;
      applyLearned(car);
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
      + '<div class="igp-field"><span>' + esc(tr('igp_weather')) + '</span>'
      + '<button class="igp-input igp-rain-btn' + (draft.rain ? ' on' : '') + '" id="igp-rain" aria-pressed="' + !!draft.rain + '">'
      + (draft.rain ? '🌧 ' + esc(tr('igp_rain')) : '☀️ ' + esc(tr('igp_dry'))) + '</button></div>'
      + '<label class="igp-field igp-span-all"><span>' + esc(tr('igp_notes')) + '</span><input class="igp-input" type="text" maxlength="500" id="igp-notes" placeholder="' + esc(tr('igp_notes_ph')) + '" value="' + esc(draft.notes) + '"></label>'
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
      + (car.setupMissing ? '<p class="igp-note">' + esc(tr('igp_import_no_setup')) + '</p>' : '<div class="igp-sliders">' + SETUP.map(d => sliderHtml(d, car.setup[d.key])).join('') + '</div>')
      + (activeCar === 1 ? '<button class="igp-link igp-danger" id="igp-rm-car">' + esc(tr('igp_remove_car2')) + '</button>' : '')
      + '</section>'

      + '<div class="igp-col">'
      // Practice
      + '<section class="igp-card"><h3>' + esc(tr('igp_practice')) + '</h3>'
      + '<div class="igp-tyre-tabs">' + ALL_TYRES.map(ty => {
        const x = car.tyres[ty];
        const filled = x.fuel > 0 && x.wear > 0;
        return '<button class="igp-tyre-tab' + (activeTyre === ty ? ' on' : '') + '" data-tyre="' + ty + '">'
          + tyreChip(ty, 'lg') + (filled ? '<span class="igp-dot"></span>' : '') + '</button>';
      }).join('') + '</div>'
      + '<div class="igp-grid2 igp-grid2-keep">'
      + tyreField('fuel', 'igp_fuel_lap', car.tyres[activeTyre].fuel, 0.1)
      + tyreField('wear', 'igp_wear_lap', car.tyres[activeTyre].wear, 0.1)
      + tyreField('time', 'igp_lap_seconds', car.tyres[activeTyre].time, 0.001)
      + '</div>'
      + practiceHtml(car)
      + (WET.includes(activeTyre) ? '<p class="igp-note">' + esc(tr('igp_wet_note')) + '</p>' : '')
      + '</section>'
      // Strategy
      + '<section class="igp-card"><h3>' + esc(tr('igp_strategy')) + '</h3><div id="igp-results"></div></section>'
      // Race result
      + '<section class="igp-card"><h3>' + esc(tr('igp_actual')) + '</h3><div id="igp-actual"></div></section>'
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

  // Where the race wear behind the forecast comes from. The coefficient itself
  // is never shown: the player only enters what the game shows.
  function learnHtml(car) {
    const l = car.learn;
    if (!l) return '';
    const date = fmtDate(l.date);
    const text = l.kind === 'driver' ? tr('igp_learn_driver', { driver: l.driverName || driverName(car), date })
      : l.kind === 'track' ? tr('igp_learn_track', { date })
      : l.kind === 'all' ? tr('igp_learn_all') : tr('igp_learn_none');
    return '<p class="igp-learn' + (l.kind === 'none' ? '' : ' igp-learn-ok') + '">' + esc(text) + '</p>';
  }

  // How long each tyre really lasted in earlier races, also those entered
  // only from their race report without practice or a strategy.
  function realHtml(car) {
    const w = realFor(draft.track, car.driver, draft.rain);
    if (!w) return '';
    const items = (draft.rain ? WET : TYRES).filter(t => w.wear[t]).map(t => '<span class="igp-wet-item">' + tyreChip(t, 'xs') + ' '
      + esc(tr('igp_wet_item', { v: w.wear[t].toFixed(1), n: Math.max(1, Math.floor((100 - (draft.minLife || 0)) / w.wear[t])) })) + '</span>');
    return '<div class="igp-wet-info"><span class="igp-dim">' + (draft.rain ? '🌧 ' : '') + esc(tr(draft.rain ? 'igp_wet_info' : 'igp_real_info')) + '</span>' + items.join('') + '</div>';
  }

  function renderResults() {
    const box = root.querySelector('#igp-results');
    if (!box) return;
    const car = draft.cars[activeCar];
    const res = strategies(car.tyres, draft.laps, draft.reserve, draft.minLife, draft.rain);
    const chosen = pickedStrategy(car, res);
    renderActual(car, raceStrategy(car, res));
    const head = learnHtml(car) + realHtml(car);

    if (res.empty) { box.innerHTML = head + '<div class="igp-empty igp-empty-sm">' + esc(tr(draft.rain ? 'igp_no_data_rain' : 'igp_no_data')) + '</div>'; return; }
    if (res.error) { box.innerHTML = head + '<div class="igp-warn-box">' + esc(tr('igp_no_cover')) + '</div>'; return; }

    const chosenKey = comboKey(chosen.combo);
    const d = res.data;

    box.innerHTML = head + '<div class="igp-stats">'
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
          + (s.drivingTime != null ? '<span class="igp-dim" title="' + esc(tr('igp_driving_time')) + '">⏱ ' + esc(formatTime(s.drivingTime)) + '</span>' : '')
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

  // Until the player types anything, the rows follow the chosen strategy and
  // nothing is stored; the first entry makes them the race's own.
  function actualTemplate(chosen) {
    if (!chosen) return { startFuel: null, stints: [{ tyre: 'M', lap: draft.laps || null, left: null, fuel: null }] };
    let lap = 0;
    return { startFuel: chosen.totalFuel,
      stints: chosen.combo.map((t, i) => ({ tyre: t, lap: (lap += chosen.stintLaps[i]), left: null, fuel: null })) };
  }

  function renderActual(car, chosen) {
    const box = root.querySelector('#igp-actual');
    if (!box) return;
    const a = car.actual || actualTemplate(chosen);
    const last = a.stints.length - 1;
    const field = (k, v, step, max) => '<input class="igp-input" type="number" inputmode="decimal" min="0"'
      + (max ? ' max="' + max + '"' : '') + ' step="' + step + '" data-act="' + k + '" value="' + (v ?? '') + '">';

    box.innerHTML = '<p class="igp-note igp-note-top">' + esc(tr('igp_actual_note')) + '</p>'
      + (chosen ? '' : '<p class="igp-note igp-note-top">' + esc(tr('igp_actual_old')) + '</p>')
      + '<label class="igp-field igp-act-start"><span>' + esc(tr('igp_start_fuel')) + '</span>'
      + '<input class="igp-input" type="number" inputmode="decimal" min="0" step="0.1" id="igp-act-start" value="' + (a.startFuel ?? '') + '"></label>'
      + '<div class="igp-act-head"><span></span><span>' + esc(tr('igp_act_lap')) + '</span><span>' + esc(tr('igp_act_left'))
      + '</span><span>' + esc(tr('igp_act_fuel')) + '</span><span></span></div>'
      + a.stints.map((s, i) => '<div class="igp-act" data-i="' + i + '"><div class="igp-act-row">'
        + '<div class="igp-act-tyre"><span class="igp-act-top"><span class="igp-act-name">' + esc(i === last ? tr('igp_act_finish') : tr('igp_pit') + ' ' + (i + 1)) + '</span>'
        + (TYRES.includes(s.tyre) ? '<button class="igp-act-wet' + (s.rain ? ' on' : '') + '" aria-pressed="' + !!s.rain + '" title="' + esc(tr('igp_act_rain')) + '" aria-label="' + esc(tr('igp_act_rain')) + '">🌧</button>' : '')
        + '</span><select class="igp-input" data-act="tyre" aria-label="' + esc(tr('igp_tyre')) + '">' + ALL_TYRES.map(t => '<option' + (t === s.tyre ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>'
        + field('lap', s.lap, 1) + (s.rain ? '<span class="igp-act-wet-cell">🌧 ' + esc(tr('igp_rain')) + '</span>' : field('left', s.left, 1, 100)) + field('fuel', s.fuel, 0.1)
        + (a.stints.length > 1 ? '<button class="igp-x igp-act-rm" aria-label="×">×</button>' : '<span></span>')
        + '</div><div class="igp-dim igp-small igp-act-calc"></div></div>').join('')
      + '<div class="igp-card-actions igp-act-actions">'
      + '<button class="igp-link" id="igp-act-add">＋ ' + esc(tr('igp_act_add')) + '</button>'
      + (car.actual ? '<button class="igp-link igp-danger-link" id="igp-act-clear">' + esc(tr('igp_act_clear')) + '</button>' : '')
      + '</div>'
      + '<div id="igp-act-sum"></div>';

    const own = () => {
      if (!car.actual) car.actual = cleanActual(actualTemplate(chosen));
      return car.actual;
    };
    box.querySelector('#igp-act-start').oninput = e => { own().startFuel = num(e.target.value); actualCalc(car); };
    box.querySelectorAll('.igp-act').forEach(el => {
      const i = +el.dataset.i;
      el.querySelectorAll('input[data-act]').forEach(inp => {
        inp.oninput = () => { own().stints[i][inp.dataset.act] = num(inp.value); actualCalc(car); };
      });
      el.querySelector('select').onchange = e => {
        const st = own().stints[i];
        st.tyre = e.target.value;
        if (!TYRES.includes(st.tyre)) delete st.rain;
        renderActual(car, chosen);
      };
      const wet = el.querySelector('.igp-act-wet');
      if (wet) wet.onclick = () => {
        const st = own().stints[i];
        if (st.rain) delete st.rain; else st.rain = true;
        renderActual(car, chosen);
      };
      const rm = el.querySelector('.igp-act-rm');
      if (rm) rm.onclick = () => { own().stints.splice(i, 1); renderActual(car, chosen); };
    });
    box.querySelector('#igp-act-add').onclick = () => {
      const st = own().stints;
      if (st.length >= 8) return;
      // A forgotten stop goes in before the finish.
      st.splice(st.length - 1, 0, { tyre: st[st.length - 1].tyre, lap: null, left: null, fuel: null });
      renderActual(car, chosen);
    };
    const clr = box.querySelector('#igp-act-clear');
    if (clr) clr.onclick = () => { car.actual = null; renderActual(car, chosen); };
    actualCalc(car);
  }

  // Refreshes only the worked-out lines, so typing never loses the field.
  function actualCalc(car) {
    const box = root.querySelector('#igp-actual');
    if (!box) return;
    const f = raceFacts(car) || { rows: [], ratio: {}, real: {} };
    box.querySelectorAll('.igp-act').forEach(el => {
      const r = f.rows[+el.dataset.i];
      const parts = [];
      if (r && r.laps) parts.push(r.laps + ' ' + tr('igp_laps'));
      if (r && r.wear != null) parts.push(tr('igp_act_wear', { v: r.wear.toFixed(1) })
        + (r.practice ? ' ' + tr('igp_act_practice', { v: r.practice }) : ''));
      if (r && r.fuel != null) parts.push(tr('igp_act_fuel_lap', { v: r.fuel.toFixed(2) }));
      const st = car.actual && car.actual.stints[+el.dataset.i];
      if (st && st.rain) parts.push(tr('igp_act_rain_skip'));
      el.querySelector('.igp-act-calc').textContent = parts.join(' · ');
    });
    // Per tyre over the whole race: practice against race where both exist,
    // the race wear alone for a tyre that had no practice.
    const items = ALL_TYRES.map(t => {
      const x = f.ratio[t], w = f.real[t];
      if (x) return '<span class="igp-act-coef">' + tyreChip(t, 'xs')
        + esc(tr('igp_act_vs', { p: (x.base / x.laps).toFixed(1), r: (x.worn / x.laps).toFixed(1) })) + '</span>';
      if (w) return '<span class="igp-act-coef">' + tyreChip(t, 'xs') + esc(tr('igp_act_wear', { v: (w.worn / w.laps).toFixed(1) })) + '</span>';
      return '';
    }).join('');
    box.querySelector('#igp-act-sum').innerHTML = items
      ? '<div class="igp-act-sum"><span class="igp-dim">' + esc(tr('igp_act_sum')) + '</span><div class="igp-act-coefs">' + items + '</div>'
        + '<p class="igp-note">' + esc(tr('igp_act_next')) + '</p></div>'
      : '';
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
    $('#igp-rain').onclick = () => { draft.rain = !draft.rain; openAccords = new Set(); render(); };

    root.querySelectorAll('.igp-car-tab[data-car]').forEach(b => {
      b.onclick = () => { activeCar = +b.dataset.car; openAccords = new Set(); render(); };
    });
    const add = $('#igp-add-car');
    if (add) add.onclick = () => {
      const s2 = seatOf(2);
      draft.cars[1] = newCar(s2 && s2.id !== draft.cars[0].driver ? s2 : null);
      applyLearned(draft.cars[1]);
      activeCar = 1; openAccords = new Set(); render();
    };
    $('#igp-driver').onchange = e => {
      const id = e.target.value ? Number(e.target.value) : null;
      const d = id ? driverById(id) : null;
      if (id && !d) return;
      car.driver = id; car.driverName = d ? d.name : '';
      car.igpDriverId = d?.igp_id || null;
      // A race not saved yet follows the new driver's own race wear.
      if (!draft.id) applyLearned(car);
      render();
    };
    $('#igp-load').onclick = () => { loadCar = activeCar; view = 'load'; render(); };
    const rm = $('#igp-rm-car');
    if (rm) rm.onclick = () => {
      if (!confirm(tr('igp_remove_car2_confirm'))) return;
      draft.cars[1] = null; activeCar = 0; render();
    };
    const cp = $('#igp-copy1');
    if (cp) cp.onclick = () => { car.setup = Object.assign({}, draft.cars[0].setup); car.setupMissing = !!draft.cars[0].setupMissing; render(); };
    $('#igp-reset').onclick = () => { car.setup = defaultSetup(); car.setupMissing = false; render(); };

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
        const c = carryCar(src);
        car.setup = c.setup; car.setupMissing = c.setupMissing; car.tyres = c.tyres; car.pick = null;
        applyLearned(car);
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

  function formatTime(seconds) {
    if (!(seconds > 0)) return '—';
    const ms = Math.round(seconds * 1000), minutes = Math.floor(ms / 60000);
    return minutes + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' + String(ms % 1000).padStart(3, '0');
  }
  function practiceHtml(car) {
    if (!car.practice?.length) return '';
    return '<details class="igp-history"><summary>' + esc(tr('igp_test_history')) + '</summary><div class="igp-table-wrap"><table class="igp-import-table"><thead><tr>'
      + ['igp_lap', 'igp_tyre', 'igp_time', 'igp_fuel_lap', 'igp_wear_lap', 'igp_s_ride', 'igp_s_susp', 'igp_wing'].map(k => '<th>' + esc(tr(k)) + '</th>').join('')
      + '</tr></thead><tbody>' + car.practice.map(p => '<tr><td>' + esc(p.lap) + '</td><td>' + tyreChip(p.tyre) + '</td><td>' + esc(formatTime(p.time)) + '</td><td>'
        + esc(p.fuel) + '</td><td>' + esc(p.wear) + '%</td><td>' + esc(p.setup?.ride) + '</td><td>' + esc(p.setup?.susp) + '</td><td>' + esc(p.setup?.wing) + '°</td></tr>').join('')
      + '</tbody></table></div></details>';
  }
  async function startImport() {
    if (importBusy) return;
    const ext = window.mvmOS?.extension;
    importError = ''; importPlan = null; importSteps = []; importExpected = 4; view = 'import';
    if (!ext?.active || !/(^|\.)igpmanager\.com$/.test(ext.context?.hostname || '')) {
      importError = tr('igp_import_open'); render(); return;
    }
    importBusy = true; importStatus = tr('igp_import_reading'); render();
    try {
      if (!window.IGPImport) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = importScript.href;
        script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('script')); };
        document.head.appendChild(script);
      });
      importPlan = await window.IGPImport.collect(ext, (e) => {
        importExpected = e.expected; importStatus = tr(e.label);
        const last = importSteps[importSteps.length - 1];
        if (e.state === 'reading') importSteps.push({ label: e.label, info: e.info || '', state: 'reading' });
        else if (last) last.state = e.state;
        render();
      });
      importPlan.races.forEach(r => { r.selected = true; });
      if (!importPlan.drivers.length && !importPlan.races.length) importError = tr('igp_import_failed');
    } catch (_) { importError = tr('igp_import_failed'); }
    importBusy = false; render();
  }
  function importStepsHtml() {
    const icon = { reading: '⏳', ok: '✅', failed: '⚠️' };
    const done = importSteps.filter(x => x.state !== 'reading').length;
    const total = importBusy ? Math.max(importExpected, importSteps.length) : importSteps.length;
    return '<section class="igp-card igp-imp-steps" role="status"><div class="igp-card-head"><h3>' + esc(tr('igp_import_pages')) + '</h3>'
      + '<span class="igp-dim">' + done + ' / ' + total + '</span></div>'
      + '<div class="igp-progress"><i style="width:' + Math.round(100 * done / Math.max(1, total)) + '%"></i></div>'
      + importSteps.map(x => '<div class="igp-imp-step igp-imp-' + x.state + '">' + icon[x.state] + ' <b>' + esc(tr(x.label)) + '</b>'
        + (x.info ? ' <span class="igp-dim">' + esc(x.info) + '</span>' : '') + '</div>').join('')
      + (importBusy && importStatus === tr('igp_saving') ? '<div class="igp-imp-step">⏳ ' + esc(importStatus) + '</div>' : '')
      + '</section>';
  }
  function renderImport() {
    root.innerHTML = '<div class="igp-page"><div class="igp-wrap"><div class="igp-top">'
      + '<button class="igp-btn igp-ghost" id="igp-import-back"' + (importBusy ? ' disabled' : '') + '>‹ ' + esc(tr('igp_back')) + '</button>'
      + '<div class="igp-top-title">' + esc(tr('igp_import')) + '</div><span></span></div>'
      + (importBusy || importSteps.length ? importStepsHtml() : '')
      + (importError ? '<div class="igp-banner igp-banner-warn" role="alert">' + esc(importError) + '</div>' : '')
      + (importPlan ? '<p class="igp-note">' + esc(tr('igp_import_preview')) + '</p>'
        + (importPlan.warnings.length ? '<div class="igp-banner igp-banner-warn">' + esc(tr('igp_import_partial')) + ' ' + [...new Set(importPlan.warnings)].map(k => esc(tr(k))).join(', ') + '</div>' : '')
        + '<section class="igp-card"><h3>' + esc(tr('igp_drivers')) + '</h3>'
        + importPlan.drivers.map(d => '<p>' + esc(d.name) + ' · iGP ' + esc(d.igp_id) + (d.car ? ' · ' + esc(tr('igp_car', { n: d.car })) : '') + '</p>').join('') + '</section>'
        + importPlan.races.map((r, i) => {
          const existing = races.find(x => x.igp_id === r.igpRaceId || x.data?.igpRaceId === r.igpRaceId);
          if (existing && !r.race_date) r.race_date = existing.race_date;
          if (existing && !r.laps) r.laps = existing.data.laps;
          return '<section class="igp-card"><div class="igp-card-head"><h3><label><input type="checkbox" data-import-select="' + i + '"' + (r.selected ? ' checked' : '') + '> '
            + esc(tr(r.kind === 'next' ? 'igp_import_next' : 'igp_import_previous')) + ' · ' + esc(trackName(r.track)) + ' · iGP ' + esc(r.igpRaceId) + '</label></h3></div>'
            + '<div class="igp-grid2"><label class="igp-field"><span>' + esc(tr('igp_date')) + '</span><input type="date" class="igp-input" data-import-date="' + i + '" value="' + esc(r.race_date) + '"></label>'
            + '<label class="igp-field"><span>' + esc(tr('igp_total_laps')) + '</span><input type="number" min="1" max="200" class="igp-input" data-import-laps="' + i + '" value="' + (r.laps || '') + '"></label></div>'
            + ((!r.race_date || !r.laps) ? '<p class="igp-note">' + esc(tr('igp_import_date')) + (r.start ? ' ' + esc(r.start) : '') + '</p>' : '')
            + '<label class="igp-field"><span>' + esc(tr('igp_import_merge')) + '</span><select class="igp-input" data-import-id="' + i + '"' + (existing ? ' disabled' : '') + '><option value="">' + esc(tr(existing ? 'igp_import_update' : 'igp_import_create')) + '</option>'
            + races.filter(x => x.track === r.track && !x.igp_id && !x.data?.igpRaceId).map(x => '<option value="' + x.id + '"' + (r.id === x.id ? ' selected' : '') + '>' + esc(fmtDate(x.race_date)) + ' · ' + esc(x.data?.cars?.map(c => c.driverName).join(', ')) + '</option>').join('') + '</select></label>'
            + r.cars.map(c => '<h4>' + esc(c.driverName) + '</h4>' + (c.practice ? practiceHtml(c) : '')
              + (c.setup ? '<p class="igp-note">' + SETUP.filter(d => c.setup[d.key] != null).map(d => esc(tr('igp_s_' + d.key)) + ': ' + esc(fmt(d, c.setup[d.key]))).join(' · ') + '</p>' : '')
              + (c.actual ? '<p>' + comboHtml(c.actual.stints.map(s => s.tyre)) + '</p><p class="igp-note">' + esc(tr('igp_import_stints', { laps: c.actual.stints.map(s => s.lap).join(', '), fuel: c.actual.startFuel })) + '</p>' : '')).join('') + '</section>';
        }).join('')
        + '<button class="igp-btn igp-primary" id="igp-import-save"' + (importBusy || loadError ? ' disabled' : '') + '>' + esc(tr(importBusy ? 'igp_saving' : 'igp_import_apply')) + '</button>' : '')
      + (!importBusy ? '<button class="igp-btn igp-ghost" id="igp-import-retry">' + esc(tr('igp_import')) + '</button>' : '') + '</div></div>';
    root.querySelector('#igp-import-back').onclick = () => { view = 'list'; render(); };
    const retry = root.querySelector('#igp-import-retry'); if (retry) retry.onclick = startImport;
    root.querySelectorAll('[data-import-select]').forEach(el => { el.onchange = () => { importPlan.races[+el.dataset.importSelect].selected = el.checked; }; });
    root.querySelectorAll('[data-import-date]').forEach(el => { el.onchange = () => { importPlan.races[+el.dataset.importDate].race_date = el.value; }; });
    root.querySelectorAll('[data-import-laps]').forEach(el => { el.oninput = () => { importPlan.races[+el.dataset.importLaps].laps = num(el.value); }; });
    root.querySelectorAll('[data-import-id]').forEach(el => { el.onchange = () => { importPlan.races[+el.dataset.importId].id = num(el.value); }; });
    const save = root.querySelector('#igp-import-save'); if (save) save.onclick = applyImport;
  }
  async function applyImport() {
    if (importBusy || !importPlan) return;
    const selected = importPlan.races.filter(r => r.selected);
    if (selected.some(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.race_date) || !Number.isInteger(r.laps) || r.laps < 1 || r.laps > 200)) {
      importError = tr('igp_import_date'); render(); return;
    }
    importBusy = true; importError = ''; importStatus = tr('igp_saving'); render();
    try {
      const result = await api('POST', '/import', { drivers: importPlan.drivers, races: selected });
      drivers = result.drivers; races = result.races;
      importPlan = null; view = 'list'; banner = { kind: 'ok', text: tr('igp_import_saved') };
    } catch (_) { importError = tr('igp_save_error'); }
    importBusy = false; render();
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
  window.mvmOS?.extension?.onContext(() => { if (root && view === 'list') render(); });

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
