(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'livingtown';
  const tr = (k, v) => window.t ? window.t(k, v) : k;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => esc(s).replace(/"/g, '&quot;');

  let B, town, root, canvas, g, hud, tools, subtools, panel, toast, eventButton, eventLog;
  let unreadEvents = 0;
  let eventPreviewTimer = 0, eventPreviewVisible = false;
  let pending = null, raf = 0, last = 0, paused = false, pushClock = 0, hudClock = 0, saveTimer = 0;
  let speed = loadSpeed();
  let selected = null, mode = null, category = null;
  let roadShape = 'straight', roadRotation = 0, roadHoverCell = null, roadHoverPoint = null;
  let lineDraft = null;
  let stopLineId = null;
  let pendingBusStop = null;
  let crosswalkOccupancy = null;
  let crosswalkVehicleOccupancy = null;
  let sidewalkCacheVersion = -1, sidewalkCacheBase = null, sidewalkCacheFull = null;
  let pointer = null, moved = 0;
  const cam = { x: 2100, y: 2100, z: 2.4 };
  // One small house occupies exactly one cell. Everything placed by the player
  // or claimed by a resident resolves to this same grid, so zoning, roads and
  // later multi-cell buildings all speak one spatial language.
  const CELL = 70;
  const SUB = CELL / 6;
  const dpr = () => window.devicePixelRatio || 1;
  const world = () => B.world_size;
  const person = id => town.people.find(p => p.id === id);
  const building = id => town.buildings.find(b => b.id === id);
  const age = p => Math.floor((p.age_days || 0) / 365);
  // Chance of dying at some point during each complete ten-year age band.
  // These are cohort probabilities, not annual rolls: each person draws once
  // on entering a band and, when selected, receives one persistent death age.
  const MORTALITY_BANDS = [.006, .003, .007, .013, .033, .085, .18, .33, .65, .94];
  const money = n => '¤' + Math.round(n || 0).toLocaleString();
  const dayPart = () => town.day - Math.floor(town.day);
  // Five work-schedule types, assigned at random the moment someone gets
  // hired (see assignShift) so a workplace's staff are not all on the same
  // clock. day1/day2 are the familiar Mon-Fri office week; the other three
  // rotate on a fixed cycle regardless of weekday, counted from the day
  // the person started (p.shift_anchor). wageMult compensates a 12-hour
  // shift against the base wage, which is calibrated for an 8-hour day.
  const SHIFT_DEFS = {
    day1: { start: 8, end: 17, wageMult: 1 },
    day2: { start: 9, end: 18, wageMult: 1 },
    rot_day: { start: 7, end: 19, cycle: 4, on: 2, wageMult: 1.5 },
    rot_night: { start: 19, end: 7, cycle: 4, on: 2, wageMult: 1.5 },
    // Day shift (8-20), night shift (20-8), then two days off, repeating.
    dno: { start: 8, cycle: 4, wageMult: 1.5 },
  };
  const SHIFT_KEYS = Object.keys(SHIFT_DEFS);
  const shiftTypeOf = p => (p.shift && SHIFT_DEFS[p.shift]) ? p.shift : 'day1';
  function assignShift(p) {
    p.shift = SHIFT_KEYS[Math.floor(Math.random() * SHIFT_KEYS.length)];
    p.shift_anchor = Math.floor(town.day);
  }
  function wageMultiplierFor(p) { return SHIFT_DEFS[shiftTypeOf(p)].wageMult || 1; }
  // The shift that STARTS on calendar day `day` for this person, or null if
  // that day is a day off. `overnight` means the shift crosses midnight.
  function shiftOnDay(p, day) {
    const type = shiftTypeOf(p), def = SHIFT_DEFS[type];
    if (type === 'dno') {
      const pos = (((day - (p.shift_anchor || 0)) % 4) + 4) % 4;
      if (pos === 0) return { start: 8, end: 20, overnight: false };
      if (pos === 1) return { start: 20, end: 8, overnight: true };
      return null;
    }
    if (def.cycle) {
      const pos = (((day - (p.shift_anchor || 0)) % def.cycle) + def.cycle) % def.cycle;
      if (pos >= def.on) return null;
      return { start: def.start, end: def.end, overnight: def.end <= def.start };
    }
    if (day % 7 >= B.work_days) return null;
    return { start: def.start, end: def.end, overnight: false };
  }
  // Is p actually clocked in at this exact moment (fractional town.day)?
  // Checks both the shift starting today and an overnight one still running
  // from yesterday.
  function isWorkingAt(p, dayFloat) {
    const day = Math.floor(dayFloat), hour = (dayFloat - day) * 24;
    const today = shiftOnDay(p, day);
    if (today && !today.overnight && hour >= today.start && hour < today.end) return true;
    if (today && today.overnight && hour >= today.start) return true;
    const yest = shiftOnDay(p, day - 1);
    if (yest && yest.overnight && hour < yest.end) return true;
    return false;
  }
  // p's shift as it applies to "today" in the same start/end-hour terms the
  // rest of the schedule logic already uses: an overnight shift still
  // running from yesterday reads as already started (start:-1) ending at
  // its real hour; one starting today that runs past midnight reads as
  // ending at hour 24, since isWorkingAt handles the actual overnight part.
  function todaysShift(p, dayFloat) {
    const day = Math.floor(dayFloat);
    const yest = shiftOnDay(p, day - 1);
    if (yest && yest.overnight) return { start: -1, end: yest.end, overnight: true };
    const today = shiftOnDay(p, day);
    if (!today) return null;
    return { start: today.start, end: today.overnight ? 24 : today.end, overnight: today.overnight };
  }
  const isWorkTimeFor = p => isWorkingAt(p, town.day);
  const isWorkDayFor = p => !!todaysShift(p, town.day);
  const fmtDay = () => {
    const totalMinutes = Math.floor(dayPart() * 24 * 60);
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    const weekday = tr('lt_weekday_' + (Math.floor(town.day) % 7));
    return tr('lt_date', { year: town.year, day: 1 }) + ' · ' + weekday + ' · ' + hours + ':' + minutes;
  };
  const fmtHour = value => {
    const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(value * 60)));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const roadSpec = road => (B.road_types && B.road_types[road.type || 'dirt']) || { cost: 0, width: 1, sidewalks: false, lanes: 1, two_way: false, speed_kmh: 30 };
  const BUS_TIERS = ['mini', 'standard', 'double'];
  const LINE_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];
  const CAR_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261', '#a663cc', '#606c38', '#3a86ff', '#fb5607', '#ffb4a2'];
  const ROAD_LAYOUTS = {
    dirt: ['dirt', 'grass', 'grass', 'grass', 'grass', 'dirt'],
    oneway: ['walk', 'grass', 'asphalt', 'asphalt', 'grass', 'walk'],
    // Each lane sits flush against its own sidewalk (no dead grass strip in
    // between); the two grass strips left over form a single planted median
    // between the opposing lanes instead of an asymmetric side gap.
    twoway: ['walk', 'asphalt', 'grass', 'grass', 'asphalt', 'walk'],
    avenue: ['walk', 'asphalt', 'asphalt', 'asphalt', 'asphalt', 'walk'],
    highway: ['asphalt', 'asphalt', 'asphalt', 'asphalt', 'asphalt', 'asphalt'],
  };
  const ROAD_COLORS = { dirt: '#4b3b27', grass: '#315c3b', walk: '#979b9d', asphalt: '#2d3033' };
  // Anywhere a line's path passes within this reach of a stop, the stop is
  // served by that line - stops are never bound to a line explicitly, so
  // adding/removing lines can change who serves a stop without touching it.
  const STOP_REACH = SUB * .6;
  const LINE_CLOSE_DIST = SUB * 1.5;
  const BUS_CATCHMENT = CELL * 4;
  const cellAt = p => ({ gx: Math.max(0, Math.min(Math.floor(world() / CELL) - 1, Math.floor(p.x / CELL))),
    gy: Math.max(0, Math.min(Math.floor(world() / CELL) - 1, Math.floor(p.y / CELL))) });
  const cellPoint = c => ({ x: c.gx * CELL + CELL / 2, y: c.gy * CELL + CELL / 2 });
  const cellKey = c => c.gx + ':' + c.gy;
  const roadPath = road => road.path && road.path.length > 1 ? road.path :
    [{ x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }];
  const pathLength = points => points.slice(1).reduce((sum, point, i) => sum + dist(points[i], point), 0);
  const roadModeType = () => mode && mode.indexOf('road:') === 0 ? mode.slice(5) : null;

  // Roads are built block by block: every piece is one of three fixed shapes
  // (straight / 90 degree corner / 45 degree diagonal) dropped into exactly
  // one construction cell and turned to face any of its four rotations. A
  // corner's two ends always sit at the exact midpoints of the cell's edges,
  // which are the same points a neighbouring straight or corner piece uses to
  // cross that edge - so pieces always meet edge to edge with no gap. Corner
  // pieces are quarter circles centred on the cell's own corner: at each end
  // their tangent is exactly perpendicular to the edge it crosses, the same
  // tangent a straight piece has crossing that edge, so the lane colouring
  // (asphalt/sidewalk/grass) lines up perfectly across the joint too.
  const ROAD_SHAPES = {
    straight: ['W', 'E'], corner: ['N', 'E'], diagonal: ['N', 'E'],
    tee: ['W', 'E', 'N'], cross: ['W', 'E', 'N', 'S'],
  };
  const EDGE_CW = { N: 'E', E: 'S', S: 'W', W: 'N' };
  function rotateEdge(edge, steps) {
    let e = edge;
    for (let i = 0, n = ((steps % 4) + 4) % 4; i < n; i++) e = EDGE_CW[e];
    return e;
  }
  function pieceEdges(shape, rotation) {
    const base = ROAD_SHAPES[shape] || ROAD_SHAPES.straight;
    return base.map(edge => rotateEdge(edge, rotation));
  }
  function edgeMidpoint(cell, edge) {
    const x0 = cell.gx * CELL, y0 = cell.gy * CELL;
    if (edge === 'W') return { x: x0, y: y0 + CELL / 2 };
    if (edge === 'E') return { x: x0 + CELL, y: y0 + CELL / 2 };
    if (edge === 'N') return { x: x0 + CELL / 2, y: y0 };
    return { x: x0 + CELL / 2, y: y0 + CELL };
  }
  function cellCornerFor(edgeA, edgeB, cell) {
    const x0 = cell.gx * CELL, y0 = cell.gy * CELL;
    const north = edgeA === 'N' || edgeB === 'N', west = edgeA === 'W' || edgeB === 'W';
    return { x: west ? x0 : x0 + CELL, y: north ? y0 : y0 + CELL };
  }
  function roadPieceGeometry(shape, rotation, cell) {
    const [edgeA, edgeB] = pieceEdges(shape, rotation);
    const p1 = edgeMidpoint(cell, edgeA), p2 = edgeMidpoint(cell, edgeB);
    if (shape !== 'corner') return [p1, p2];
    const c = cellCornerFor(edgeA, edgeB, cell), radius = CELL / 2;
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x), a2raw = Math.atan2(p2.y - c.y, p2.x - c.x);
    let delta = a2raw - a1;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Enough samples that the first/last straight segment's chord direction
    // (what the lane-offset code actually reads as "the tangent" at that
    // point) is within a fraction of a degree of the arc's true tangent -
    // otherwise a straight piece butting up against this one would show a
    // hairline seam where their lane offsets don't quite line up.
    const samples = 24, path = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, ang = a1 + delta * t;
      path.push({ x: c.x + Math.cos(ang) * radius, y: c.y + Math.sin(ang) * radius });
    }
    return path;
  }
  function roadPiecePaths(shape, rotation, cell) {
    if (shape !== 'tee' && shape !== 'cross') return [roadPieceGeometry(shape, rotation, cell)];
    const center = cellPoint(cell), edges = pieceEdges(shape, rotation);
    return edges.map((edge, index) => {
      const outer = edgeMidpoint(cell, edge);
      // Opposite arms of one-way intersections retain a usable through-flow:
      // west/north enter the centre and east/south leave it after rotation.
      const inbound = index === 0 || (shape === 'cross' && index === 2);
      return inbound ? [outer, center] : [center, outer];
    });
  }

  function roadCrossesCell(road, cell) {
    const inset = .01;
    const x0 = cell.gx * CELL + inset, y0 = cell.gy * CELL + inset;
    const x1 = (cell.gx + 1) * CELL - inset, y1 = (cell.gy + 1) * CELL - inset;
    const dx = road.x2 - road.x1, dy = road.y2 - road.y1;
    let near = 0, far = 1;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const ratio = q / p;
      if (p < 0) { if (ratio > far) return false; if (ratio > near) near = ratio; }
      else { if (ratio < near) return false; if (ratio < far) far = ratio; }
      return true;
    };
    return clip(-dx, road.x1 - x0) && clip(dx, x1 - road.x1) &&
      clip(-dy, road.y1 - y0) && clip(dy, y1 - road.y1) && near <= far;
  }

  function cellHasRoad(cell) {
    return town.roads.some(road => roadCrossesCell(road, cell));
  }
  function cellHasPark(cell) {
    return town.buildings.some(b => b.type === 'park' && (b.cells || []).some(c => c.gx === cell.gx && c.gy === cell.gy));
  }
  function loadSpeed() {
    try { return Math.max(1, Math.min(10, parseInt(localStorage.getItem('livingtown_speed') || '1', 10))); }
    catch (_) { return 1; }
  }
  function setSpeed(value) {
    speed = Math.max(1, Math.min(10, parseInt(value, 10) || 1));
    try { localStorage.setItem('livingtown_speed', String(speed)); } catch (_) {}
    renderHud();
  }

  function renderSetup(box) {
    box.innerHTML = '<div class="lt-setup"><div class="lt-mark">🏘️</div><h2>' + esc(tr('lt_title')) +
      '</h2><p>' + esc(tr('lt_setup')) + '</p></div>';
  }

  function renderGame(at) {
    root = at;
    root.innerHTML = '<div class="lt-app"><canvas id="lt-map"></canvas><div id="lt-hud"></div>' +
      '<div id="lt-toast"></div><button id="lt-event-button"></button><aside id="lt-event-log"></aside>' +
      '<div id="lt-toolbar"><div id="lt-subtools"></div><div id="lt-tools"></div></div><aside id="lt-panel"></aside></div>';
    canvas = root.querySelector('#lt-map'); g = canvas.getContext('2d');
    hud = root.querySelector('#lt-hud'); tools = root.querySelector('#lt-tools'); subtools = root.querySelector('#lt-subtools');
    panel = root.querySelector('#lt-panel'); toast = root.querySelector('#lt-toast');
    eventButton = root.querySelector('#lt-event-button'); eventLog = root.querySelector('#lt-event-log');
    eventButton.onclick = () => {
      eventLog.classList.toggle('open'); unreadEvents = 0; eventPreviewVisible = false;
      clearTimeout(eventPreviewTimer); renderEvents();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', fit);
    fit();
    if (pending) { const msg = pending; pending = null; begin(msg); }
  }

  function fit() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect(), q = dpr();
    canvas.width = Math.max(300, Math.round(r.width * q));
    canvas.height = Math.max(300, Math.round(r.height * q));
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    draw();
  }

  function begin(msg) {
    B = msg.tuning; town = msg.state;
    // A business should cost exactly what a home does at the same level,
    // so the choice between the two comes down to which one someone can
    // actually afford right now, not one tier being structurally pricier.
    B.private_build_cost.shop = B.private_build_cost.house;
    // A park visit should be a proper rest, not a quick top-up: recovering
    // from empty to full happiness takes about 12 hours spent there.
    B.happiness_park_gain_per_level = 100 / 12;
    // Health decays daily based on happiness and age: 1%/day at full
    // happiness rising linearly to 10%/day at zero happiness, plus up to
    // another 10% for age (1% per 10 years, capped at 100 years old) - so
    // a miserable centenarian could in theory lose 20%/day, but that's a
    // ceiling, not a typical case. A clinic visit heals 10%/day instead.
    B.health_happiness_min_decay = 1;
    B.health_happiness_max_decay = 10;
    B.health_age_max_bonus = 10;
    B.health_age_years_per_percent = 10;
    B.health_seek_hospital = 70;
    B.health_recover_per_day = 10;
    // Gym: not part of the server's admin building list, so it's added
    // client-side the same way private_build_cost.shop was equalized above
    // - same cost/staffing shape as the other public buildings.
    B.admin.gym = B.admin.gym || { cost: 300, jobs: 2, wage: 30 };
    // Public buildings were priced far too high for a small town's budget -
    // cheaper flat costs client-side, same pattern as the shop/gym overrides
    // above. Police/fire don't have any gameplay effect yet (not designed
    // yet), so their price is a placeholder alongside the clinic's.
    B.admin.clinic.cost = 900;
    B.admin.police.cost = 900;
    B.admin.fire.cost = 900;
    B.park_cost_per_cell = 500;
    // Roads were priced per unit of length (a corner/diagonal piece is
    // longer than a straight one, so its price varies slightly), not as a
    // flat per-square price like buildings - these per-unit rates are
    // calibrated so a standard straight one-cell piece costs about
    // 50/100/150/200 respectively (dirt stays free).
    B.road_types.oneway.cost = 50 / CELL;
    B.road_types.twoway.cost = 100 / CELL;
    B.road_types.avenue.cost = 150 / CELL;
    B.road_types.highway.cost = 200 / CELL;
    B.bus_stop_cost = 50;
    // Strength trains up slowly (2 hours/day of a 1%/hour session = +2%),
    // decays 1%/day on its own regardless of training, and in turn shaves
    // up to 10% off the daily health decay (1% per 10 points of strength,
    // same capped-bonus shape as the age penalty above). Energy is spent
    // training and restored by a full night at home (100% over 8 hours);
    // less time home naturally means less recovered.
    B.strength_train_rate_per_hour = 1;
    B.strength_daily_decay = 1;
    B.strength_health_max_bonus = 10;
    B.strength_points_per_percent = 10;
    B.energy_gym_decay_per_hour = 5;
    B.energy_home_recover_per_hour = 100 / 8;
    town.busStops = town.busStops || []; town.busLines = town.busLines || [];
    town.buses = town.buses || []; town.cars = town.cars || [];
    town.crosswalks = town.crosswalks || [];
    town.dayEventCounts = town.dayEventCounts || {};
    town.richest_dead = town.richest_dead || null;
    town.next_bus_stop = town.next_bus_stop || 1; town.next_bus_line = town.next_bus_line || 1;
    town.next_bus = town.next_bus || 1; town.next_car = town.next_car || 1;
    town.next_crosswalk = town.next_crosswalk || 1;
    town.transit_version = town.transit_version || 0;
    // Company cash existed in older saves but had no useful gameplay role.
    // Move it once to the current owner; an ownerless company's stranded
    // balance becomes public money instead of remaining inaccessible.
    for (const b of town.buildings) {
      if (b.type !== 'shop' || !Number.isFinite(b.cash)) continue;
      const balance = Math.max(0, b.cash);
      const owner = person(b.owner);
      if (owner) owner.money += balance;
      else town.treasury += balance;
      delete b.cash;
    }
    for (const r of town.roads) {
      if (r.speed_kmh == null) r.speed_kmh = roadSpec(r).speed_kmh;
      if (r.dir == null) r.dir = 1;
    }
    for (const line of town.busLines) normalizeBusLineGeometry(line);
    // One-time compatibility for old free-standing stops: attach each one
    // to the nearest line that actually passed through its saved point.
    for (const stop of town.busStops) if (stop.lineId == null) {
      let best = null;
      for (const line of town.busLines) {
        const position = stopPositionOnLine(line, stop);
        if (position && (!best || position.distance < best.position.distance)) best = { line, position };
      }
      if (best) bindStopToLine(stop, best.line, best.position.segIndex, best.position.t);
    }
    // Earlier two-click builds could leave two saved stops directly on top
    // of one another. Keep the oldest and redirect any active travel plan
    // to it, so the map count and timetable match what is visibly built.
    const uniqueStops = [], duplicateStops = new Map();
    for (const stop of town.busStops.slice().sort((a, b) => a.id - b.id)) {
      const same = uniqueStops.find(existing => existing.lineId != null && existing.lineId === stop.lineId && dist(existing, stop) < SUB * 1.2);
      if (same) duplicateStops.set(stop.id, same.id); else uniqueStops.push(stop);
    }
    town.busStops = uniqueStops;
    if (duplicateStops.size) for (const p of town.people) {
      if (duplicateStops.has(p.waitingAtStop)) p.waitingAtStop = duplicateStops.get(p.waitingAtStop);
      if (duplicateStops.has(p.busBoardStop)) p.busBoardStop = duplicateStops.get(p.busBoardStop);
      if (duplicateStops.has(p.busAlightStop)) p.busAlightStop = duplicateStops.get(p.busAlightStop);
    }
    if (town.founding) {
      // The town no longer starts with 3 free houses - it starts with
      // nothing but 5 waiting couples (10 settlers) who each showed up
      // with exactly enough to buy a starter home and a starter business
      // (480 + 480). They stay "waiting" (invisible, unsimulated - same
      // status the old founders held before their first home existed)
      // until the player has zoned land for them to actually settle on;
      // the existing couple/business-investor logic then picks them up
      // automatically, same as it would anyone else.
      town.people = []; town.buildings = []; town.founding = false;
      for (let i = 0; i < 5; i++) {
        const family = B.names.families[Math.floor(Math.random() * B.names.families.length)];
        const manId = town.next_person++, womanId = town.next_person++;
        const base = { age_days: (20 + Math.floor(Math.random() * 10)) * 365,
          home: null, work: null, x: world() / 2, y: world() / 2, inside: 'waiting', goal: null,
          happiness: B.happiness_start, health: 100, strength: 0, energy: 100 };
        const manHasMoney = Math.random() < 0.5;
        town.people.push(
          { id: manId, name: B.names.male[Math.floor(Math.random() * B.names.male.length)] + ' ' + family,
            sex: 'm', partner: womanId, money: manHasMoney ? 1200 : 0, parents: [], children: [], history: [], ...base },
          { id: womanId, name: B.names.female[Math.floor(Math.random() * B.names.female.length)] + ' ' + family,
            sex: 'f', partner: manId, money: manHasMoney ? 0 : 1200, parents: [], children: [], history: [], ...base });
      }
    }
    for (const p of town.people) {
      normalizePerson(p);
      // Commute plans are derived data. Never trust a plan saved by an older
      // tuning/code version: movement speed may have changed while the same
      // game day was in progress, leaving a stale departure time on reload.
      p._commutePlan = null;
      p._commuteDay = null;
    }
    for (const p of town.people) {
      if (p.riding && p.riding.kind === 'car' && !town.cars.some(c => c.id === p.riding.id)) p.riding = null;
      if (p.riding && p.riding.kind === 'bus' && !town.buses.some(b => b.id === p.riding.id)) p.riding = null;
      if (p.waitingAtStop != null && !town.busStops.some(s => s.id === p.waitingAtStop)) {
        p.waitingAtStop = null; p.busBoardStop = null; p.busLine = null; p.busAlightStop = null;
      }
    }
    for (const b of town.buildings) b.builders = [];
    normalizeZones();
    fillJobs();
    unreadEvents = 0; eventPreviewVisible = false; clearTimeout(eventPreviewTimer);
    renderHud(); renderTools(); renderPanel(); renderEvents(); home();
    last = performance.now(); paused = !!(town.awaitingNextDay && town.daySummary);
    if (paused) { selected = { kind: 'daySummary' }; renderPanel(); }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }

  function normalizeZones() {
    // Convert rectangles made by the first prototype into real cells. This is
    // intentionally done client-side because the live simulation owns the map
    // and the converted state is included in its next ordinary save.
    town.next_zone_group = town.next_zone_group || 1;
    if ((town.zones || []).every(z => z.gx != null && z.gy != null)) {
      for (const z of town.zones) {
        if (z.group == null) z.group = town.next_zone_group++;
        if (z.tax_rate == null) z.tax_rate = .10;
      }
      return;
    }
    const cells = [], seen = new Set();
    for (const z of (town.zones || [])) {
      const group = z.group == null ? town.next_zone_group++ : z.group;
      const a = z.gx == null ? cellAt({ x: z.x, y: z.y }) : { gx: z.gx, gy: z.gy };
      const b = z.gx == null ? cellAt({ x: z.x + Math.max(0, z.w - 1), y: z.y + Math.max(0, z.h - 1) }) : a;
      for (let gy = a.gy; gy <= b.gy; gy++) for (let gx = a.gx; gx <= b.gx; gx++) {
        const key = gx + ':' + gy; if (seen.has(key)) continue;
        seen.add(key); cells.push({ id: town.next_zone++, kind: z.kind, gx, gy,
          group, tax_rate: z.tax_rate == null ? .10 : z.tax_rate });
      }
    }
    town.zones = cells;
  }

  function normalizePerson(p) {
    if (!p.history) p.history = [];
    if (p.inside === undefined) p.inside = null;
    if (p.goal === undefined) p.goal = null;
    if (p.goal && p.goal.kind === 'build') p.goal = null;
    if (p.health == null || typeof p.health !== 'number') p.health = 100;
    if (p.strength == null) p.strength = 0;
    if (p.energy == null) p.energy = 100;
    if (p.car == null) p.car = false;
    if (p.riding === undefined) p.riding = null;
    if (p.waitingAtStop === undefined) p.waitingAtStop = null;
    if (p.busBoardStop === undefined) p.busBoardStop = null;
    if (p.busAlightStop === undefined) p.busAlightStop = null;
    if (p.busLine === undefined) p.busLine = null;
    ensureMortalityPlan(p);
    p.route = null; p.routeGoal = null; p.blockedRouteGoal = null; p.atBuilding = null;
    if (!town.roads.length && !p.inside && p.home) p.inside = p.home;
  }

  function ensureMortalityPlan(p) {
    const years = age(p);
    if (years >= 100) return;
    const band = Math.floor(years / 10);
    if (p.mortality_band === band) return;

    p.mortality_band = band;
    p.death_age = null;
    const fullBandRisk = MORTALITY_BANDS[band] || 0;
    const bandEnd = band * 10 + 9;
    const yearsRemaining = bandEnd - years + 1;
    // A migrant or an old save may enter halfway through a band. Give that
    // person only the corresponding remaining share of the band probability.
    const remainingRisk = 1 - Math.pow(1 - fullBandRisk, yearsRemaining / 10);
    if (Math.random() >= remainingRisk) return;

    // Later ages within the remaining band carry progressively more weight.
    // The chosen value is stored, so redraws cannot happen on frames/reloads.
    const candidates = [];
    let totalWeight = 0;
    for (let deathAge = years; deathAge <= bandEnd; deathAge++) {
      const weight = deathAge - band * 10 + 1;
      totalWeight += weight;
      candidates.push({ deathAge, totalWeight });
    }
    const roll = Math.random() * totalWeight;
    p.death_age = candidates.find(candidate => roll < candidate.totalWeight).deathAge;
  }
  function resetTravel(p) {
    p.route = null; p.routeGoal = null; p.blockedRouteGoal = null;
    p.busBoardStop = null; p.busLine = null; p.busAlightStop = null;
  }
  function invalidatePedestrianRoutes() {
    sidewalkCacheVersion = -1; sidewalkCacheBase = null; sidewalkCacheFull = null;
    const now = performance.now();
    for (const p of town.people) {
      p.blockedRouteGoal = null;
      if (!p.riding && p.waitingAtStop == null) {
        p.route = null; p.routeGoal = null;
        p._routeRecalcAfter = now + (p.id % 30) * 34;
      }
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!paused && town) update(dt);
    draw();
  }

  function update(dt) {
    // Choosing the founding home is a free spatial decision. Nothing ages,
    // earns or invests until the two founders actually have somewhere to live.
    if (town.founding) return;
    town.elapsed += dt;
    const oldDay = Math.floor(town.day);
    town.day += dt * B.days_per_second * speed;
    town.year = Math.floor(town.day) + 1;
    crosswalkVehicleOccupancy = new Map();
    for (const p of town.people) updatePerson(p, dt);
    crosswalkOccupancy = new Map();
    updateBuses(dt); updateCars(dt);
    for (const b of town.buildings) if ((b.built || 0) < 1 || b.target_development) updateSite(b, dt);
    if (Math.floor(town.day) !== oldDay) newDay(oldDay);
    hudClock += dt;
    if (hudClock > .25) {
      hudClock = 0;
      const clock = hud && hud.querySelector('[data-clock]');
      if (clock) clock.textContent = fmtDay(); else renderHud();
    }
    pushClock += dt;
    // The autosave serializes the whole town (people, roads, zones, event
    // history) and sends it off - as the town has grown that's become
    // heavy enough to cause a visible hitch each time it fires, so it now
    // runs half as often.
    if (pushClock > 20) { pushClock = 0; push(); renderHud(); }
  }

  function newDay(completedDay) {
    const treasuryBefore = town.treasury;
    town.econYesterday = town.econToday || { income: {}, expense: {} };
    town.econToday = { income: {}, expense: {} };
    for (const p of town.people) {
      // Settlers still waiting for their first home are not simulated at
      // all (see the 'waiting' skip in updatePerson/update) - they must
      // not silently pay living costs or age through retirement either,
      // or their starting money drains away before they ever get a
      // chance to spend it on a home/business.
      if (p.inside === 'waiting') continue;
      p.age_days += 365;
      if (p.happiness == null) p.happiness = B.happiness_start;
      // A park visit now raises happiness continuously while the person is
      // actually inside it (see updatePerson), so it no longer takes the
      // once-a-day lump sum the work/home cases still use.
      if (p.goal && p.goal.kind === 'park' && p.inside === p.goal.building) {
        // happiness already being applied live
      } else if (p.worked_day === completedDay) p.happiness -= B.happiness_work_decay;
      else p.happiness += B.happiness_home_gain;
      p.happiness = Math.max(0, Math.min(100, p.happiness));
      if (p.health == null) p.health = 100;
      if (p.strength == null) p.strength = 0;
      if (p.energy == null) p.energy = 100;
      // Strength erodes a flat 1%/day on its own, whether or not today
      // included a gym session (the session's own +1%/hour is applied live
      // in updatePerson while actually training) - so skipping the gym
      // (sick, no access, etc.) always costs a point, same as the user
      // described.
      p.strength = Math.max(0, Math.min(100, p.strength - B.strength_daily_decay));
      // A clinic visit now raises health continuously while the person is
      // actually inside it (see updatePerson), same as a park visit does
      // for happiness, so it's skipped here to avoid double-counting.
      if (p.goal && p.goal.kind === 'hospital' && p.inside === p.goal.building) {
        // health already being applied live
      } else {
        const happinessPenalty = B.health_happiness_max_decay -
          (B.health_happiness_max_decay - B.health_happiness_min_decay) * (p.happiness / 100);
        const ageBonus = Math.min(B.health_age_max_bonus, age(p) / B.health_age_years_per_percent);
        const strengthBonus = Math.min(B.strength_health_max_bonus, p.strength / B.strength_points_per_percent);
        p.health = Math.max(0, Math.min(100, p.health - happinessPenalty - ageBonus + strengthBonus));
      }
      if (age(p) >= B.adult_age) p.money -= B.living_cost;
      if (p.car) p.money -= B.car_tax;
      if (age(p) >= B.retire_age && p.work) {
        const workplace = building(p.work);
        if (workplace) workplace.workers = (workplace.workers || []).filter(id => id !== p.id);
        p.work = null; p.goal = null; resetTravel(p);
      }
      // A grown adult still living with their parents is not evicted -
      // see seekFamilyHousing() below, which looks for them a place of
      // their own (with a parental contribution toward buying one) without
      // ever actually displacing them until somewhere real is found.
    }
    chargeMaintenance();
    handleDeaths();
    runEconomy(completedDay);
    payPensions();
    collectRents(completedDay);
    fillJobs();
    seekBetterJob();
    formCouples();
    houseExistingResidents();
    // Getting a grown child a place of their own comes before anything
    // else money might go toward that day - business investment, or a
    // parent's own home simply growing further.
    seekFamilyHousing();
    // Business investment and new housing for people who actually lack a
    // home run before a home simply expanding its current one - a job or
    // somewhere to live at all is the more pressing use of a day's money
    // than a house that's merely full growing further, which otherwise
    // always spent first and left founders too poor to ever start a shop.
    privateDecisions();
    updateHomes();
    seekMoreRoomForFamily();
    growFamilies();
    const counts = town.dayEventCounts || {};
    const income = Object.values((town.econToday && town.econToday.income) || {}).reduce((sum, value) => sum + value, 0);
    const expense = Object.values((town.econToday && town.econToday.expense) || {}).reduce((sum, value) => sum + value, 0);
    town.daySummary = {
      day: completedDay, people: town.people.length, births: counts.lt_event_born || 0,
      deaths: counts.lt_event_died || 0, jobs: counts.lt_event_job || 0,
      buildings: (counts.lt_event_started || 0) + (counts.lt_event_finished || 0),
      purchases: counts.lt_event_home_bought || 0, cars: counts.lt_event_car || 0,
      income, expense, treasuryBefore, treasuryAfter: town.treasury,
    };
    town.dayEventCounts = {};
    town.events = town.events || [];
    town.events.unshift({ day: completedDay, key: 'lt_event_daily_summary', vars: {
      births: town.daySummary.births, deaths: town.daySummary.deaths, jobs: town.daySummary.jobs,
      buildings: town.daySummary.buildings,
    }});
    town.events = town.events.slice(0, 100); unreadEvents += 1;
    town.awaitingNextDay = true; paused = true; selected = { kind: 'daySummary' };
    eventPreviewVisible = false; renderEvents(); renderPanel(); push();
  }

  function roadMaintenanceCost(road) {
    const spec = B.road_types[road.type || 'dirt'];
    return pathLength(roadPath(road)) * spec.cost * B.maintenance_rate;
  }
  function busMaintenanceCost(bus) {
    return B.bus_types[bus.tier].cost * B.maintenance_rate;
  }
  function parkMaintenanceCost(park) {
    return (park.cost || (park.level || 1) * B.park_cost_per_cell) * B.maintenance_rate;
  }
  function chargeMaintenance() {
    let total = 0;
    for (const r of town.roads) total += roadMaintenanceCost(r);
    total += town.busStops.length * B.bus_stop_cost * B.maintenance_rate;
    for (const b of town.buses) total += busMaintenanceCost(b);
    for (const b of town.buildings) if (b.type === 'park') total += parkMaintenanceCost(b);
    town.treasury -= total; econ('expense', 'maintenance', total);
  }

  function handleDeaths() {
    const deceasedToday = town.people.filter(p => {
      const years = age(p);
      if (years >= 100) return true;
      ensureMortalityPlan(p);
      return p.death_age != null && years >= p.death_age;
    });
    for (const deceased of deceasedToday) {
      // A record only worth keeping if they were the richest person alive
      // at the moment of death (computed before the estate below gets
      // redistributed to heirs) and it beats whatever record already
      // stands - the wealth panel clears it on its own once someone
      // currently alive genuinely surpasses it.
      const worthAtDeath = netWorth(deceased);
      const richerAlive = town.people.some(other => other.id !== deceased.id && netWorth(other) > worthAtDeath);
      if (!richerAlive && (!town.richest_dead || worthAtDeath > town.richest_dead.worth)) {
        town.richest_dead = { name: deceased.name, sex: deceased.sex, age: age(deceased), worth: worthAtDeath };
      }
      const children = (deceased.children || []).map(person).filter(Boolean);
      const partner = person(deceased.partner);
      const heirs = children.length ? children : (partner ? [partner] : []);
      const estate = Math.max(0, deceased.money || 0);
      if (heirs.length) {
        const share = estate / heirs.length;
        for (const heir of heirs) heir.money += share;
      } else { town.treasury += estate; econ('income', 'property', estate); }
      const successor = heirs[0] || null;
      for (const b of town.buildings) {
        b.residents = (b.residents || []).filter(id => id !== deceased.id);
        b.workers = (b.workers || []).filter(id => id !== deceased.id);
        b.builders = (b.builders || []).filter(id => id !== deceased.id);
        const primaryOwnerDied = b.owner === deceased.id;
        if (primaryOwnerDied) b.owner = successor ? successor.id : null;
        if (b.owners) b.owners = b.owners.filter(id => id !== deceased.id);
        if (primaryOwnerDied && successor && b.owners && !b.owners.includes(successor.id)) b.owners.push(successor.id);
      }
      if (partner) partner.partner = null;
      addEvent('lt_event_died', { person: deceased.name, age: age(deceased) });
      town.people = town.people.filter(p => p.id !== deceased.id);
    }
  }

  function runEconomy(completedDay) {
    // No blanket weekday gate any more - whether anyone actually worked
    // today is now entirely down to each person's own shift (see
    // shiftOnDay), which some of the new schedules run through weekends.
    for (const b of town.buildings) {
      if (b.built < 1 || !(b.jobs > 0)) continue;
      const workers = (b.workers || []).map(person).filter(p => p && p.worked_day === completedDay);
      if (b.type === 'shop') updateBusinessScale(b);
      const wage = b.wage || B.work_income;
      // A 12-hour shift is paid 1.5x the base (8-hour) wage - see
      // SHIFT_DEFS.*.wageMult - and that scaled amount is what a shop's
      // revenue and cost accounting are based on too, not raw headcount.
      const workerWage = p => wage * wageMultiplierFor(p);
      if (b.type === 'shop') {
        b.total_profit = b.total_profit || 0;
        const zone = zoneAt(b), rate = zone ? zone.tax_rate : town.tax_rate;
        // The owner is never among the workers any more (see fillJobs) -
        // they tour their businesses instead of clocking in at one.
        const totalWage = workers.reduce((sum, p) => sum + workerWage(p), 0);
        const revenue = totalWage * (2.5 + town.people.length * .02);
        const owner = person(b.owner);
        for (const p of workers) {
          const pWage = workerWage(p);
          const employeeTax = pWage * rate;
          p.money += pWage - employeeTax;
          town.treasury += employeeTax; econ('income', 'business_tax', employeeTax);
        }
        // Every worker is hired help now that the owner never works the
        // till themselves, so the full wage bill counts against profit
        // twice over - once as the wage actually paid, once as the cost
        // of relying on hired labour instead of an owner-operator.
        const profit = Math.max(0, revenue - totalWage - totalWage);
        b.total_profit += profit;
        const tax = owner ? profit * rate : profit;
        town.treasury += tax; econ('income', 'business_tax', tax);
        // Profit waits in the till until the owner actually visits to
        // collect it (see the 'tour' goal in chooseGoal/updatePerson),
        // instead of teleporting straight into their pocket every day.
        if (owner) b.till = (b.till || 0) + (profit - tax);
        b.last_profit = profit; b.last_tax = tax;
        const upgradeCost = B.private_build_cost.shop * (b.development + 1);
        if (owner && !b.target_development && b.development < 10 &&
            (b.workers || []).length >= b.jobs && (b.till || 0) >= upgradeCost) {
          b.till -= upgradeCost; b.last_upgrade_cost = upgradeCost;
          b.target_development = b.development + 1;
          b.upgrade_progress = 0; b.upgrade_days = b.target_development * .04;
        }
      } else {
        for (const p of workers) {
          const pWage = workerWage(p);
          if (town.treasury < pWage) break;
          const tax = pWage * town.tax_rate;
          town.treasury -= pWage; econ('expense', 'wages', pWage);
          town.treasury += tax; econ('income', 'municipal_tax', tax);
          p.money += pWage - tax;
        }
      }
    }
  }

  // Half of today's zone business tax becomes the day's pension pool, split
  // evenly across every retiree - raise business zone tax rates and the
  // treasury earns more, but pensions grow with it too, rather than a
  // fixed payout the treasury could just quietly stop affording.
  const PENSION_TAX_SHARE = .5;
  function payPensions() {
    const retirees = town.people.filter(p => age(p) >= B.retire_age);
    if (!retirees.length) return;
    const businessTaxToday = (town.econToday && town.econToday.income && town.econToday.income.business_tax) || 0;
    const pool = Math.min(town.treasury, businessTaxToday * PENSION_TAX_SHARE);
    if (pool <= 0) return;
    const perPerson = pool / retirees.length;
    for (const p of retirees) p.money += perPerson;
    town.treasury -= pool; econ('expense', 'pension', pool);
  }

  function updateBusinessScale(b) {
    b.development = Math.max(1, Math.min(10, b.development || 1));
    // Same growth rule as a home's capacity (updateHomeScale): each level's
    // step is one bigger than the last - 3, 7, 12, 18, 25, 33, 42, 52, 63,
    // 75 - instead of flat multiples of 3, so a big level-10 business feels
    // as much like a real employer as a level-10 home feels like a block.
    b.jobs = b.development * (b.development + 5) / 2;
    b.wage = 27 + (b.development - 1) * 4;
  }

  function growFamilies() {
    const today = Math.floor(town.day);
    for (const mother of town.people.slice()) {
      const motherAge = age(mother);
      if (mother.sex !== 'f' || motherAge < B.adult_age || motherAge >= 50 || !mother.partner || !mother.home) continue;
      const partner = person(mother.partner);
      if (!partner || partner.home !== mother.home) continue;
      if (mother.next_child_day == null) mother.next_child_day = today + 1;
      if (mother.next_child_day > today + 1) mother.next_child_day = today + 1;
      if (today < mother.next_child_day) continue;
      mother.next_child_day = today + 1;
      // A happier couple is a little more likely to have a child - a mild
      // effect (never below 60% of the base chance), so happiness matters
      // without making an unhappy couple effectively unable to have kids.
      const avgHappiness = ((mother.happiness ?? B.happiness_start) + (partner.happiness ?? B.happiness_start)) / 2;
      const happinessFactor = 0.6 + 0.4 * (avgHappiness / 100);
      const birthChance = .80 * (50 - motherAge) / 32 * happinessFactor;
      if (Math.random() >= birthChance) continue;
      // No room, no baby: a household that is already at capacity simply
      // cannot afford one this attempt. They get another roll next day.
      const home = building(mother.home);
      if (!home || (home.residents || []).length >= (home.capacity || 2)) continue;
      const id = town.next_person++, female = Math.random() < .5;
      const firstNames = female ? B.names.female : B.names.male;
      const fatherSurname = String(partner.name || '').trim().split(/\s+/).pop() || 'Vale';
      const child = { id, name: firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + fatherSurname, sex: female ? 'f' : 'm',
        age_days: 0, money: 0, partner: null, parents: [mother.id, partner.id], children: [],
        home: mother.home, work: null, x: mother.x, y: mother.y, inside: mother.home,
        goal: null, happiness: B.happiness_start, health: 100, strength: 0, energy: 100, history: [] };
      ensureMortalityPlan(child);
      town.people.push(child); mother.children.push(id);
      partner.children = partner.children || []; partner.children.push(id);
      if (!(home.residents || []).includes(id)) home.residents.push(id);
      addEvent('lt_event_born', { person: child.name });
    }
    // Outside migrants are disabled by request: the town only grows from
    // its own residents (children, and the housing/rental/business flow
    // they go through as adults) rather than newcomers competing with them
    // for the same open homes and jobs.
  }

  const PERSON_WAIT_GAP = SUB * .55;
  // Nearest other pedestrian close ahead of p on roughly the same line of
  // travel (not someone crossing a different sidewalk or the far side of
  // a crossing), used so people queue up single-file behind each other on
  // a shared path instead of walking straight through one another.
  function personAhead(p, gap) {
    const next = p.route && p.route[0];
    if (!next) return null;
    const dx = next.x - p.x, dy = next.y - p.y, len = Math.hypot(dx, dy) || 1;
    const fx = dx / len, fy = dy / len;
    let nearest = null, nearestDist = Infinity;
    for (const other of town.people) {
      if (other.id === p.id || other.inside || other.riding) continue;
      const ox = other.x - p.x, oy = other.y - p.y;
      const ahead = ox * fx + oy * fy;
      if (ahead <= 0) continue;
      const d = Math.hypot(ox, oy);
      if (d >= gap) continue;
      const lateral = Math.abs(ox * fy - oy * fx);
      if (lateral > gap * .6) continue;
      if (d < nearestDist) { nearest = other; nearestDist = d; }
    }
    return nearest;
  }
  function personBlocked(p) {
    const blocker = personAhead(p, PERSON_WAIT_GAP);
    return !!(blocker && blocker.id < p.id);
  }

  function updatePerson(p, dt) {
    if (p.inside === 'waiting') return;
    if (p.riding || p.waitingAtStop != null) return;
    // Energy regen from being home applies regardless of the current goal
    // (there's often no active "home" goal once someone has already
    // arrived and settled in) - 100% over 8 hours, so a shorter stay
    // recovers proportionally less, same as real sleep.
    if (p.inside && p.inside === p.home) {
      p.energy = Math.min(100, (p.energy ?? 100) + B.energy_home_recover_per_hour * hoursForRealSeconds(dt * speed));
    }
    if (!p.goal) chooseGoal(p);
    if (!p.goal) return;
    if (!p.route && p._routeRecalcAfter) {
      if (performance.now() < p._routeRecalcAfter) return;
      delete p._routeRecalcAfter;
    }
    const target = p.goal.kind === 'wander' ? p.goal : building(p.goal.building);
    if (!target) { p.goal = null; return; }
    if (p.goal.kind === 'work') {
      const shift = todaysShift(p, town.day);
      if (!shift || dayPart() * 24 >= shift.end) { p.goal = null; resetTravel(p); return; }
    }
    if (p.goal.kind === 'build' && p.atBuilding === target.id) return;
    const routeGoal = p.goal.kind + ':' + (target.id || (target.x + ':' + target.y));
    if (p.blockedRouteGoal === routeGoal) return;
    if (p.inside) {
      if (p.inside !== target.id) {
        if (!p.route || p.routeGoal !== routeGoal) {
          const origin = building(p.inside);
          const commuting = (p.goal.kind === 'work' && p.inside === p.home) || (p.goal.kind === 'home' && p.inside === p.work) ||
            p.goal.kind === 'park' || p.goal.kind === 'tour' || p.goal.kind === 'hospital' || p.goal.kind === 'gym' ||
            (p.goal.kind === 'home' && origin && (origin.type === 'park' || origin.type === 'shop'));
          const plan = !commuting ? null : p.goal.kind === 'work' ? commutePlanFor(p) : planTrip(origin, target, p);
          if (plan && plan.mode === 'car') {
            p.routeGoal = routeGoal; p.atBuilding = null; p.inside = null;
            startCarTrip(p, origin, target);
            return;
          }
          let route = null;
          if (plan && plan.mode === 'bus') {
            route = roadRoute(origin, plan.boardStop);
            if (route) { p.busBoardStop = plan.boardStop.id; p.busAlightStop = plan.alightStop.id; p.busLine = plan.line.id; }
          }
          if (!route) route = roadRoute(origin || p, target, true);
          p.route = route; p.routeGoal = routeGoal; p.atBuilding = null;
          if (!p.route) return;
          p.x = p.route[0].x; p.y = p.route[0].y; p.route.shift();
        }
        p.inside = null;
      }
      else {
        if (p.goal.kind === 'work') {
          if (isWorkTimeFor(p)) p.worked_day = Math.floor(town.day);
          const shift = todaysShift(p, town.day);
          if (!shift || dayPart() * 24 >= shift.end) p.goal = null;
          return;
        }
        if (p.goal.kind === 'home' && p.work) {
          const shift = todaysShift(p, town.day);
          if (shift && dayPart() * 24 >= departureHourFor(p) && dayPart() * 24 < shift.end) p.goal = null;
          // On a day off, release the persistent "stay home" goal so
          // chooseGoal() can perform today's park roll and schedule a visit.
          // A person who does not roll a visit simply chooses home again.
          else if (!shift) p.goal = null;
          return;
        }
        if (p.goal.kind === 'park') {
          // Stay until fully recovered, until 22:00 (an evening curfew - a
          // park visit is a daytime thing, not an overnight stay), or until
          // the day turns over - whichever comes first.
          const park = building(p.goal.building);
          const rate = B.happiness_park_gain_per_level * (park ? (park.level || 1) : 1);
          p.happiness = Math.min(100, (p.happiness ?? B.happiness_start) + rate * hoursForRealSeconds(dt * speed));
          if (p.happiness >= 100 || dayPart() * 24 >= 22 || Math.floor(town.day) !== p.parked_day) p.goal = null;
          return;
        }
        if (p.goal.kind === 'hospital') {
          // Unlike a park visit, recovery can take several days, so there's
          // no day-boundary or evening curfew cutoff here - just stay until
          // fully healed. A hospitalized worker still gets paid for their
          // shift as though they'd shown up (runEconomy only checks
          // worked_day, not where the person actually is).
          const rate = B.health_recover_per_day / 24;
          p.health = Math.min(100, (p.health ?? 100) + rate * hoursForRealSeconds(dt * speed));
          if (p.work && isWorkTimeFor(p)) p.worked_day = Math.floor(town.day);
          if (p.health >= 100) p.goal = null;
          return;
        }
        if (p.goal.kind === 'gym') {
          // A fixed 2-hour session (game time, via hoursForRealSeconds, same
          // as the park/hospital rates) - +1%/hour strength, -5%/hour
          // energy, tracked as a countdown rather than a target value since
          // both stats keep moving after the session ends.
          if (!Number.isFinite(p.goal.hoursLeft)) p.goal.hoursLeft = 2;
          const elapsed = hoursForRealSeconds(dt * speed);
          p.strength = Math.min(100, (p.strength ?? 0) + B.strength_train_rate_per_hour * elapsed);
          p.energy = Math.max(0, (p.energy ?? 100) - B.energy_gym_decay_per_hour * elapsed);
          p.goal.hoursLeft -= elapsed;
          if (p.goal.hoursLeft <= 0) { p.trained_day = Math.floor(town.day); p.goal = null; }
          return;
        }
        // Calendar time is accelerated, visible actions are not. A resident
        // must remain readable on the map even while years pass quickly.
        if (!Number.isFinite(p.goal.left)) p.goal.left = p.goal.duration || .18;
        p.goal.left -= dt * speed;
        if (p.goal.left <= 0) p.goal = null;
        return;
      }
    }
    if (!p.route || p.routeGoal !== routeGoal) {
      p.route = roadRoute(p, target, true); p.routeGoal = routeGoal; p.atBuilding = null;
      if (!p.route) return;
      p.x = p.route[0].x; p.y = p.route[0].y; p.route.shift();
    }
    if (personBlocked(p) || pedestrianMustYieldToVehicle(p, p.route[0])) return;
    // Use the same personal pace that commute planning uses. Otherwise an
    // unhappy resident would leave home as if walking at full speed and
    // inevitably arrive late.
    const moraleFactor = pedestrianPaceFactor(p);
    let left = B.walk_speed * dt * speed * moraleFactor, routeGuard = 0;
    while (p.route.length && left > 0 && routeGuard++ < 100) {
      const next = p.route[0];
      const dx = next.x - p.x, dy = next.y - p.y, d = Math.hypot(dx, dy);
      // A degenerate route point (NaN) must not read as "arrived" below -
      // that used to hand the walker a bare [] that had lost the original
      // route's complete:false flag, so completedRoute defaulted to true
      // and they were marked as having reached their goal (and vanished,
      // since drawPeople skips anyone p.inside) without ever getting there.
      if (!Number.isFinite(d)) { p.route = []; p.route.complete = false; break; }
      if (d <= .0001) { p.x = next.x; p.y = next.y; p.route.shift(); continue; }
      // Curves contain closely spaced samples. Consume every sample exactly;
      // an arrival radius larger than their spacing skips a whole bend and
      // makes the walker appear to teleport across it.
      if (d <= left) {
        p.x = next.x; p.y = next.y; left -= d; p.route.shift();
      } else {
        p.x += dx / d * left; p.y += dy / d * left; left = 0;
      }
    }
    if (p.route.length) return;
    const completedRoute = p.route.complete !== false;
    p.route = null; p.routeGoal = null;
    if (!completedRoute) { p.blockedRouteGoal = routeGoal; return; }
    if (p.busBoardStop != null) { p.waitingAtStop = p.busBoardStop; return; }
    if (p.goal.kind === 'build') { p.atBuilding = target.id; return; }
    if (target.id) {
      p.inside = target.id;
      if (p.goal.kind === 'work' && isWorkTimeFor(p)) p.worked_day = Math.floor(town.day);
      if (p.goal.kind === 'park') {
        p.parked_day = Math.floor(town.day); p.parked_building = target.id; p.last_park_visit = Math.floor(town.day);
      } else if (p.goal.kind === 'tour') {
        const shop = building(target.id);
        if (shop) { p.money += shop.till || 0; shop.till = 0; }
        p.toured_day = Math.floor(town.day);
        p.goal.left = p.goal.duration || .18;
      } else if (p.goal.kind === 'hospital' || p.goal.kind === 'gym') {
        // Recovery/training is driven live by the "already inside" branch
        // above (keyed on health/hoursLeft, not a fixed screen-time timer),
        // so there's nothing to set here beyond p.inside itself.
      } else {
        p.goal.left = p.goal.duration || .18;
      }
    }
    else p.goal = null;
  }

  function projectToRoad(at, road) {
    const points = roadPath(road), total = pathLength(points) || 1;
    let best = null, travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      const local = d2 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / d2)) : 0;
      const point = { x: a.x + dx * local, y: a.y + dy * local }, distance = dist(at, point);
      const t = (travelled + Math.sqrt(d2) * local) / total;
      if (!best || distance < best.distance) best = { road, point, t, distance };
      travelled += Math.sqrt(d2);
    }
    return best;
  }

  function roadTangentAt(road, at) {
    const points = roadPath(road);
    let best = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (!d2) continue;
      const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / d2));
      const point = { x: a.x + dx * t, y: a.y + dy * t }, distance = dist(at, point);
      if (!best || distance < best.distance) {
        const length = Math.sqrt(d2);
        best = { dx: dx / length, dy: dy / length, point, distance };
      }
    }
    return best || { dx: 1, dy: 0, point: { x: at.x, y: at.y }, distance: 0 };
  }

  // Stops remain logically anchored on the road centre so existing line
  // service calculations keep working. Only their drawing/hit position is
  // moved onto the chosen outer pedestrian strip.
  function busStopGeometry(stop) {
    let road = town.roads.find(r => r.id === stop.roadId);
    if (!road) {
      let nearest = null;
      for (const candidate of town.roads) {
        const projection = projectToRoad(stop, candidate);
        if (!nearest || projection.distance < nearest.distance) nearest = projection;
      }
      road = nearest && nearest.road;
    }
    if (!road) return { point: { x: stop.x, y: stop.y }, angle: 0, road: null };
    const tangent = roadTangentAt(road, stop), side = stop.side === -1 ? -1 : 1;
    const offset = side * SUB * 2.5;
    return {
      point: { x: tangent.point.x - tangent.dy * offset, y: tangent.point.y + tangent.dx * offset },
      angle: Number.isFinite(stop.directionAngle) ? stop.directionAngle : Math.atan2(tangent.dy, tangent.dx), road,
    };
  }

  function roadPathBetween(road, from, to) {
    const points = roadPath(road), a = projectToRoad(from, road), b = projectToRoad(to, road);
    const forward = a.t <= b.t, low = Math.min(a.t, b.t), high = Math.max(a.t, b.t);
    const total = pathLength(points) || 1, middle = []; let travelled = 0;
    for (let i = 1; i < points.length - 1; i++) {
      travelled += dist(points[i - 1], points[i]); const t = travelled / total;
      if (t > low + 1e-5 && t < high - 1e-5) middle.push(points[i]);
    }
    // Always preserve the requested from -> to endpoints. Reversing the old
    // complete array also swapped those endpoints, so a walker entering a
    // curve backwards was teleported straight to its far end.
    if (!forward) middle.reverse();
    return [a.point, ...middle, b.point];
  }

  function shiftedPath(points, offset) {
    return points.map((point, i) => {
      const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
      const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
      return { x: point.x - dy / length * offset, y: point.y + dx / length * offset };
    });
  }

  // Pedestrians have their own graph on the two outer strips. It deliberately
  // does not contain links across the carriageway; those will only be added
  // later by an explicit pedestrian-crossing feature.
  function crosswalkConnection(crossing, segments) {
    const sidewalkOffset = SUB * 2.5, center = crosswalkCenter(crossing);
    const vertical = (crossing.rotation || 0) % 2 === 0;
    const axis = vertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const ends = [-1, 1].map(sign => ({ x: center.x + axis.x * sidewalkOffset * sign,
      y: center.y + axis.y * sidewalkOffset * sign }));
    const hits = ends.map(endpoint => {
      let best = null;
      for (const segment of segments) {
        const hit = projectToSegment(endpoint, segment);
        if (!best || hit.distance < best.distance) best = { segment, point: hit.point, distance: hit.distance };
      }
      return best;
    });
    if (!hits[0] || !hits[1] || hits[0].distance > SUB || hits[1].distance > SUB ||
      hits[0].segment.id === hits[1].segment.id) return null;
    return [hits[0].point, center, hits[1].point];
  }
  function crosswalkCenter(crossing) {
    return Number.isFinite(crossing.x) && Number.isFinite(crossing.y) ?
      { x: crossing.x, y: crossing.y } : cellPoint(crossing);
  }

  // A pedestrian counts as being on a crossing from the moment their centre
  // enters its painted corridor. The small extra margin is intentional: a
  // vehicle must yield when someone has only just stepped onto the first
  // stripe, not after they have already reached the carriageway centre.
  function pedestrianOnCrosswalk(crossing) {
    if (crosswalkOccupancy && crosswalkOccupancy.has(crossing.id)) return crosswalkOccupancy.get(crossing.id);
    const center = crosswalkCenter(crossing);
    const vertical = (crossing.rotation || 0) % 2 === 0;
    const ax = vertical ? 0 : 1, ay = vertical ? 1 : 0;
    for (const p of town.people) {
      if (p.inside || p.riding) continue;
      const dx = p.x - center.x, dy = p.y - center.y;
      const along = Math.abs(dx * ax + dy * ay);
      const across = Math.abs(dx * -ay + dy * ax);
      if (along <= SUB * 2.85 && across <= SUB * .85) {
        if (crosswalkOccupancy) crosswalkOccupancy.set(crossing.id, true);
        return true;
      }
    }
    if (crosswalkOccupancy) crosswalkOccupancy.set(crossing.id, false);
    return false;
  }

  // Cars and buses share the same right-of-way rule. `frontOffset` accounts
  // for their different lengths so the nose, rather than the centre of a
  // long bus, stops before the painted crossing.
  function vehicleMustYieldToPedestrian(vehicle, from, to, frontOffset) {
    if (!from || !to) return false;
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (!length) return false;
    const fx = dx / length, fy = dy / length;
    for (const crossing of town.crosswalks) {
      if (!pedestrianOnCrosswalk(crossing)) continue;
      const center = crosswalkCenter(crossing), vx = center.x - vehicle.x, vy = center.y - vehicle.y;
      const ahead = vx * fx + vy * fy;
      const lateral = Math.abs(vx * -fy + vy * fx);
      // Once the front has entered the painted corridor, keep moving and
      // clear it. Stopping on the stripes would trap both the vehicle and
      // the pedestrian who has just arrived.
      if (lateral <= SUB * 1.35 && ahead >= frontOffset + SUB * .85 && ahead <= frontOffset + SUB * 2.25) return true;
    }
    return false;
  }
  function pedestrianMustYieldToVehicle(p, next) {
    if (!next) return false;
    for (const crossing of town.crosswalks) {
      const center = crosswalkCenter(crossing), vertical = (crossing.rotation || 0) % 2 === 0;
      const ax = vertical ? 0 : 1, ay = vertical ? 1 : 0;
      const px = p.x - center.x, py = p.y - center.y;
      const nx = next.x - center.x, ny = next.y - center.y;
      const pAlong = px * ax + py * ay, nextAlong = nx * ax + ny * ay;
      const pAcross = Math.abs(px * -ay + py * ax);
      // Already between the first stripes: finish crossing. Otherwise only
      // wait when this route step is actually heading into the crossing.
      if (Math.abs(pAlong) <= SUB * 2.15 || pAcross > SUB * 1.2 || Math.abs(nextAlong) >= Math.abs(pAlong)) continue;
      if (crosswalkHasVehicle(crossing, ax, ay)) return true;
    }
    return false;
  }
  function crosswalkHasVehicle(crossing, ax, ay) {
    if (crosswalkVehicleOccupancy && crosswalkVehicleOccupancy.has(crossing.id)) {
      return crosswalkVehicleOccupancy.get(crossing.id);
    }
    const center = crosswalkCenter(crossing);
    let occupied = false;
    for (const group of [town.cars, town.buses]) {
      for (const vehicle of group) {
        const vx = vehicle.x - center.x, vy = vehicle.y - center.y;
        const acrossRoad = Math.abs(vx * ax + vy * ay);
        const alongRoad = Math.abs(vx * -ay + vy * ax);
        let halfLength = SUB * .45;
        if (vehicle.lineId != null) {
          const tier = vehicle.tier || 'mini';
          halfLength = SUB * (tier === 'double' ? 1.575 : tier === 'standard' ? 1.325 : 1.075);
        }
        if (acrossRoad <= SUB * 3.05 && alongRoad <= halfLength + SUB * .85) { occupied = true; break; }
      }
      if (occupied) break;
    }
    if (crosswalkVehicleOccupancy) crosswalkVehicleOccupancy.set(crossing.id, occupied);
    return occupied;
  }
  function crosswalkCandidate(at, rotation) {
    let best = null;
    for (const road of town.roads) {
      if (roadSpec(road).pedestrian_access === false) continue;
      const hit = projectToRoad(at, road);
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (!best || best.distance > CELL / 2) return null;
    const cell = cellAt(best.point);
    return { gx: cell.gx, gy: cell.gy, x: best.point.x, y: best.point.y, rotation: rotation % 2 };
  }
  function sidewalkSegments(includeCrosswalks = true) {
    if (sidewalkCacheVersion === town.transit_version) {
      const cached = includeCrosswalks ? sidewalkCacheFull : sidewalkCacheBase;
      if (cached) return cached;
    } else {
      sidewalkCacheVersion = town.transit_version; sidewalkCacheBase = null; sidewalkCacheFull = null;
    }
    const result = [], junctionGroups = new Map(), sidewalkOffset = SUB * 2.5;
    const add = path => { if (path && path.length > 1) result.push({ id: result.length, path }); };
    for (const road of town.roads) {
      if (roadSpec(road).pedestrian_access === false) continue;
      if (road.piece_group && (road.shape === 'tee' || road.shape === 'cross')) {
        if (!junctionGroups.has(road.piece_group)) junctionGroups.set(road.piece_group, []);
        junctionGroups.get(road.piece_group).push(road); continue;
      }
      const path = roadPath(road);
      add(shiftedPath(path, sidewalkOffset)); add(shiftedPath(path, -sidewalkOffset));
    }
    for (const parts of junctionGroups.values()) {
      if (!parts.length || !parts[0].cell) continue;
      const center = cellPoint(parts[0].cell), arms = [];
      for (const part of parts) {
        let path = roadPath(part).slice();
        if (dist(path[0], center) < dist(path[path.length - 1], center)) path.reverse();
        const outer = path[0], rayX = outer.x - center.x, rayY = outer.y - center.y;
        const rayLength = Math.hypot(rayX, rayY) || 1;
        // A junction arm's sidewalk must stop at the outside edge of the
        // crossing corridor, not continue to the green centre of the cell.
        path[path.length - 1] = {
          x: center.x + rayX / rayLength * sidewalkOffset,
          y: center.y + rayY / rayLength * sidewalkOffset,
        };
        const plus = shiftedPath(path, sidewalkOffset), minus = shiftedPath(path, -sidewalkOffset);
        add(plus); add(minus);
        arms.push({ angle: Math.atan2(outer.y - center.y, outer.x - center.x), plus: plus[plus.length - 1], minus: minus[minus.length - 1] });
      }
      arms.sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < arms.length; i++) {
        const current = arms[i], next = arms[(i + 1) % arms.length];
        let delta = next.angle - current.angle;
        if (delta <= 0) delta += Math.PI * 2;
        // Adjacent arms already meet at the same outside corner. Across the
        // missing arm of a T they form the uninterrupted back sidewalk.
        // At a four-way junction the four corner pairs remain disconnected
        // until actual pedestrian crossings are introduced.
        add([current.minus, next.plus]);
      }
    }
    if (includeCrosswalks) {
      const base = result.slice();
      for (const crossing of town.crosswalks) {
        const connection = crosswalkConnection(crossing, base);
        if (connection) add(connection);
      }
    }
    if (includeCrosswalks) sidewalkCacheFull = result; else sidewalkCacheBase = result;
    return result;
  }

  function projectToSegment(at, segment) { return projectToRoad(at, { path: segment.path }); }
  function sidewalkPathBetween(segment, from, to) {
    return roadPathBetween({ path: segment.path }, from, to);
  }
  function sidewalkAnchor(at, segments) {
    let origin = at;
    if (at && at.type && at.id != null) {
      const access = buildingRoadAccess(at, false);
      if (!access) return null;
      origin = access.entrance || access.point;
    }
    let best = null;
    for (const segment of segments) {
      const hit = projectToSegment(origin, segment);
      if (!best || hit.distance < best.distance) best = { segment, point: hit.point, distance: hit.distance };
    }
    return best;
  }

  function pedestrianRoute(from, to) {
    const segments = sidewalkSegments(), start = sidewalkAnchor(from, segments), end = sidewalkAnchor(to, segments);
    if (!start || !end) return null;
    if (start.segment.id === end.segment.id) return sidewalkPathBetween(start.segment, start.point, end.point);
    const nodes = new Map(), edges = new Map();
    const addNode = point => {
      for (const [key, existing] of nodes) if (dist(existing, point) < 1) return key;
      const key = point.x.toFixed(4) + ':' + point.y.toFixed(4); nodes.set(key, point); return key;
    };
    const addEdge = (a, b, weight, segment) => {
      if (!edges.has(a)) edges.set(a, []); if (!edges.has(b)) edges.set(b, []);
      edges.get(a).push({ to: b, weight, segment }); edges.get(b).push({ to: a, weight, segment });
    };
    for (const segment of segments) {
      const a = addNode(segment.path[0]), b = addNode(segment.path[segment.path.length - 1]);
      addEdge(a, b, pathLength(segment.path), segment);
    }
    // Crosswalks attach to the middle of a sidewalk piece, not necessarily to
    // its end. Splice every coincident segment endpoint into the carrier path
    // so stepping off a crossing continues along the sidewalk instead of
    // leaving the pedestrian on an isolated graph island.
    // This must tolerate at least as much slack as crosswalkConnection()
    // allows when a crossing is first placed (up to SUB away from the
    // nearest sidewalk) - it used to require under 1 unit, so a validly
    // built crosswalk could still fail to splice in, leaving that end an
    // island only reachable up to the crossing itself. A route walking
    // there would then dead-end mid-crossing (freezing there, or worse).
    for (const connector of segments) {
      for (const endpoint of [connector.path[0], connector.path[connector.path.length - 1]]) {
        const endpointKey = addNode(endpoint);
        for (const carrier of segments) {
          if (carrier.id === connector.id) continue;
          const hit = projectToSegment(endpoint, carrier);
          if (hit.distance >= SUB) continue;
          const hitKey = addNode(hit.point), a = addNode(carrier.path[0]);
          const b = addNode(carrier.path[carrier.path.length - 1]);
          addEdge(endpointKey, hitKey, hit.distance, carrier);
          addEdge(hitKey, a, pathLength(sidewalkPathBetween(carrier, hit.point, carrier.path[0])), carrier);
          addEdge(hitKey, b, pathLength(sidewalkPathBetween(carrier, hit.point, carrier.path[carrier.path.length - 1])), carrier);
        }
      }
    }
    const startKey = addNode(start.point), endKey = addNode(end.point);
    for (const item of [[start, startKey], [end, endKey]]) {
      const hit = item[0], hitKey = item[1], a = addNode(hit.segment.path[0]);
      const b = addNode(hit.segment.path[hit.segment.path.length - 1]);
      addEdge(hitKey, a, dist(hit.point, nodes.get(a)), hit.segment);
      addEdge(hitKey, b, dist(hit.point, nodes.get(b)), hit.segment);
    }
    const scores = new Map([[startKey, 0]]), previous = new Map(), previousSegment = new Map(), open = new Set(nodes.keys());
    while (open.size) {
      let current = null, score = Infinity;
      for (const candidate of open) {
        const value = scores.get(candidate) ?? Infinity;
        if (value < score) { current = candidate; score = value; }
      }
      if (current == null || current === endKey) break;
      open.delete(current);
      for (const edge of (edges.get(current) || [])) {
        const value = score + edge.weight;
        if (value < (scores.get(edge.to) ?? Infinity)) {
          scores.set(edge.to, value); previous.set(edge.to, current); previousSegment.set(edge.to, edge.segment);
        }
      }
    }
    const complete = scores.has(endKey);
    let targetKey = endKey;
    if (!complete) {
      targetKey = null; let closest = Infinity;
      for (const candidate of scores.keys()) {
        const point = nodes.get(candidate), distance = dist(point, end.point);
        if (distance < closest) { closest = distance; targetKey = candidate; }
      }
      if (targetKey == null) return null;
    }
    const points = [], used = []; let cursor = targetKey;
    while (cursor != null) {
      points.unshift(nodes.get(cursor));
      const segment = previousSegment.get(cursor); if (segment) used.unshift(segment);
      cursor = previous.get(cursor);
    }
    const expanded = [points[0]];
    for (let i = 0; i < used.length; i++) expanded.push(...sidewalkPathBetween(used[i], points[i], points[i + 1]).slice(1));
    expanded.complete = complete;
    return expanded;
  }

  function nearestRoad(at) {
    let best = null;
    for (const road of town.roads) {
      const candidate = projectToRoad(at, road);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }

  function roadAccessForCell(cell, allowInside, vehicleAware) {
    const at = cellPoint(cell);
    const x0 = cell.gx * CELL, y0 = cell.gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    let best = null;
    for (const road of town.roads) {
      const spec = roadSpec(road);
      if (vehicleAware ? spec.vehicle_access === false : spec.pedestrian_access === false) continue;
      const candidate = projectToRoad(at, road), p = candidate.point;
      const inside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const dx = p.x < x0 ? x0 - p.x : (p.x > x1 ? p.x - x1 : 0);
      const dy = p.y < y0 ? y0 - p.y : (p.y > y1 ? p.y - y1 : 0);
      // The route graph follows a road's centre line, while every road now
      // fills a whole large cell. Measure access from its outer edge so a
      // building in the immediately adjacent cell is correctly reachable.
      const edgeDistance = Math.max(0, Math.hypot(dx, dy) - CELL / 2);
      if ((!allowInside && inside) || edgeDistance > SUB * .75) continue;
      const accessDistance = inside ? 0 : edgeDistance;
      // The CELL/2 subtraction above correctly zeroes out edgeDistance for a
      // road that shares a full edge with this cell, but it also zeroes out
      // a road that only touches this cell's corner diagonally (a nearby
      // junction piece one cell over on both axes) - the raw hypot distance
      // to that corner can equal CELL/2 too. Tie-break on the unadjusted
      // distance to the cell centre so a true adjacent edge (closer to the
      // centre) always wins over a same-scoring diagonal corner touch,
      // which used to sometimes anchor a park's pedestrian route onto a
      // distant junction/crosswalk instead of the park's own near side.
      const better = !best || accessDistance < best.distance - 1e-6 ||
        (Math.abs(accessDistance - best.distance) < 1e-6 && dist(p, at) < dist(best.point, at));
      if (better) best = { road, point: p, distance: accessDistance };
    }
    return best;
  }

  function buildingRoadAccess(at, vehicleAware) {
    if (at.type !== 'park') {
      const cell = cellAt(at), center = cellPoint(cell), half = CELL / 2;
      const entrances = [
        { side: 'north', x: center.x, y: center.y - half }, { side: 'east', x: center.x + half, y: center.y },
        { side: 'south', x: center.x, y: center.y + half }, { side: 'west', x: center.x - half, y: center.y },
      ];
      const x0 = cell.gx * CELL, y0 = cell.gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      let best = null;
      for (const road of town.roads) {
        const spec = roadSpec(road);
        if (vehicleAware ? spec.vehicle_access === false : spec.pedestrian_access === false) continue;
        for (const entrance of entrances) {
          const candidate = projectToRoad(entrance, road), point = candidate.point;
          const centreInsideBuilding = point.x > x0 + .01 && point.x < x1 - .01 && point.y > y0 + .01 && point.y < y1 - .01;
          if (centreInsideBuilding) continue;
          const accessDistance = Math.max(0, candidate.distance - CELL / 2);
          if (accessDistance > SUB * .75) continue;
          if (!best || accessDistance < best.distance) best = {
            road, point, distance: accessDistance, entrance: { x: entrance.x, y: entrance.y }, side: entrance.side,
          };
        }
      }
      return best;
    }
    const cells = (at.cells || []).length ? at.cells : [cellAt(at)];
    let best = null;
    for (const cell of cells) {
      const access = roadAccessForCell(cell, true, vehicleAware);
      if (access && (!best || access.distance < best.distance)) best = access;
    }
    return best;
  }

  // preferRoadId lets a caller that's already following one road (drawing
  // a bus line, say) stick with it near a junction where a second,
  // parallel road happens to pass a hair closer to the click than the one
  // actually being traced - without this, the nearest-road-wins rule alone
  // would snap onto that neighbour for one point, producing a route that
  // visibly kinks onto the wrong lane for a stretch right at every corner.
  function roadAnchor(at, vehicleAware, preferRoadId) {
    if (at && at.type && at.id != null) return buildingRoadAccess(at, vehicleAware);
    if (preferRoadId != null) {
      const road = town.roads.find(r => r.id === preferRoadId);
      if (road) {
        const spec = roadSpec(road);
        if (!(vehicleAware ? spec.vehicle_access === false : spec.pedestrian_access === false)) {
          const candidate = projectToRoad(at, road);
          if (candidate.distance <= SUB * (spec.width / 2 + .6)) return candidate;
        }
      }
    }
    let best = null;
    for (const road of town.roads) {
      const spec = roadSpec(road);
      if (vehicleAware ? spec.vehicle_access === false : spec.pedestrian_access === false) continue;
      const candidate = projectToRoad(at, road);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }

  // Pedestrians ignore road direction entirely; vehicles only respect it on
  // oneway tiers (every other tier, and every anchor/connector edge that
  // splices a start/end point onto the graph, stays two-way even for cars).
  function buildRoute(from, to, vehicleAware, preferRoadId) {
    // At a junction, `from` (typically the previous leg's own endpoint)
    // can sit exactly on two roads at once (distance 0 to both) - the
    // plain nearest-road search breaks that tie arbitrarily by array
    // order, which could silently continue the route on the wrong one of
    // the two. Preferring whichever road the caller was already on avoids
    // that.
    const start = roadAnchor(from, vehicleAware, preferRoadId), end = roadAnchor(to, vehicleAware);
    if (!start || !end) return null;
    if (start.road.id === end.road.id) {
      const points = roadPathBetween(start.road, start.point, end.point);
      return { points, roadIds: points.slice(1).map(() => start.road.id) };
    }

    const nodes = new Map(), edges = new Map();
    const key = p => p.x.toFixed(4) + ':' + p.y.toFixed(4);
    const addNode = p => {
      // Saved roads from earlier geometry revisions can differ at a shared
      // endpoint by a fraction of a world unit. Treat that as one junction so
      // pedestrians and vehicles do not stop at an invisible numerical seam.
      for (const [existingKey, existing] of nodes) if (dist(existing, p) < 1) return existingKey;
      const k = key(p); if (!nodes.has(k)) nodes.set(k, { x: p.x, y: p.y }); return k;
    };
    const addEdge = (a, b, weight, roadId, bidirectional) => {
      if (!edges.has(a)) edges.set(a, []); if (!edges.has(b)) edges.set(b, []);
      edges.get(a).push({ to: b, weight, roadId });
      if (bidirectional) edges.get(b).push({ to: a, weight, roadId });
    };
    for (const road of town.roads) {
      const spec = roadSpec(road);
      if (vehicleAware ? spec.vehicle_access === false : spec.pedestrian_access === false) continue;
      const a = addNode({ x: road.x1, y: road.y1 }), b = addNode({ x: road.x2, y: road.y2 });
      const length = pathLength(roadPath(road));
      if (vehicleAware && road.type === 'oneway') {
        if ((road.dir || 1) >= 0) addEdge(a, b, length, road.id, false);
        else addEdge(b, a, length, road.id, false);
      } else addEdge(a, b, length, road.id, true);
    }
    const startKey = addNode(start.point), endKey = addNode(end.point);
    for (const item of [[start, startKey], [end, endKey]]) {
      const hit = item[0], hitKey = item[1], a = addNode({ x: hit.road.x1, y: hit.road.y1 });
      const b = addNode({ x: hit.road.x2, y: hit.road.y2 });
      addEdge(hitKey, a, dist(hit.point, nodes.get(a)), hit.road.id, true);
      addEdge(hitKey, b, dist(hit.point, nodes.get(b)), hit.road.id, true);
    }

    const scores = new Map([[startKey, 0]]), previous = new Map(), previousRoad = new Map(), open = new Set(nodes.keys());
    while (open.size) {
      let current = null, score = Infinity;
      for (const candidate of open) {
        const candidateScore = scores.get(candidate) ?? Infinity;
        if (candidateScore < score) { current = candidate; score = candidateScore; }
      }
      if (current == null || current === endKey) break;
      open.delete(current);
      for (const edge of (edges.get(current) || [])) {
        const nextScore = score + edge.weight;
        if (nextScore < (scores.get(edge.to) ?? Infinity)) {
          scores.set(edge.to, nextScore); previous.set(edge.to, current); previousRoad.set(edge.to, edge.roadId);
        }
      }
    }
    if (!scores.has(endKey)) return null;
    const points = [], roadIds = []; let cursor = endKey;
    while (cursor != null) {
      points.unshift(nodes.get(cursor));
      const r = previousRoad.get(cursor); if (r != null) roadIds.unshift(r);
      cursor = previous.get(cursor);
    }
    const expanded = [points[0]], expandedRoads = [];
    for (let i = 0; i < roadIds.length; i++) {
      const road = town.roads.find(r => r.id === roadIds[i]);
      const part = road ? roadPathBetween(road, points[i], points[i + 1]) : [points[i], points[i + 1]];
      for (const point of part.slice(1)) { expanded.push(point); expandedRoads.push(roadIds[i]); }
    }
    return { points: expanded, roadIds: expandedRoads };
  }
  function roadRoute(from, to, allowPartial) {
    const route = pedestrianRoute(from, to);
    return route && (route.complete !== false || allowPartial) ? route : null;
  }
  function roadRouteDetailed(from, to) {
    return buildRoute(from, to, true);
  }

  // Which of an owner's businesses to visit today, cycling through all of
  // them one at a time (day 1 the first, day 2 the second, and so on) so
  // every shop eventually gets its till collected instead of always the
  // same one. Leaves at 7 like a normal commute, but with no fixed arrival
  // time to plan around - they just get there whenever the walk takes.
  function tourGoalFor(p) {
    if (p.work || !p.home) return null;
    const shops = ownedShops(p);
    if (!shops.length) return null;
    const day = Math.floor(town.day);
    if (p.toured_day === day || dayPart() * 24 < 7) return null;
    if (p.tour_pick_day !== day) {
      p.tour_pick_day = day;
      p.tour_index = (p.tour_index == null ? 0 : p.tour_index + 1);
    }
    return shops[p.tour_index % shops.length];
  }

  function bestGym(origin) {
    let best = null, bestHours = Infinity;
    for (const b of town.buildings) {
      if (b.type !== 'gym' || (b.built || 0) < 1) continue;
      const hours = hoursForWalk(roadRoute(origin, b));
      if (Number.isFinite(hours) && hours < bestHours) { bestHours = hours; best = b; }
    }
    return best;
  }
  // Training is a daily habit like the shop owner's tour, not something
  // only triggered by low strength - once a day, whenever there's a free
  // moment (chooseGoal only reaches this once work/tour are already
  // accounted for, so it never competes with either). Everyone's first
  // free moment tends to land at the same hour (right after work, or right
  // at the start of a day off), so without a personal randomized time
  // they'd all head out in one mob the instant they're free - a single
  // random hour per person per day (picked once, re-rolled daily) spreads
  // that out instead.
  function gymGoalFor(p) {
    if (age(p) < B.adult_age || !p.home) return null;
    const day = Math.floor(town.day);
    if (p.trained_day === day) return null;
    if (p._gymPlanDay !== day) { p._gymPlanDay = day; p._gymPlanHour = 6 + Math.random() * 16; }
    if (dayPart() * 24 < p._gymPlanHour) return null;
    return bestGym(building(p.home));
  }

  function bestClinic(origin) {
    let best = null, bestHours = Infinity;
    for (const b of town.buildings) {
      if (b.type !== 'clinic' || (b.built || 0) < 1) continue;
      const hours = hoursForWalk(roadRoute(origin, b));
      if (Number.isFinite(hours) && hours < bestHours) { bestHours = hours; best = b; }
    }
    return best;
  }
  // Health dropping below the threshold sends someone to the nearest
  // clinic, same idea as considerPark but simpler: no weekend roll or
  // curfew, since a health scare (unlike a happiness dip) isn't something
  // that waits for a convenient day off. This takes priority over work in
  // chooseGoal - they still get paid for the shift (see the 'hospital'
  // case in updatePerson/arriveCar), they just don't physically show up.
  function considerHospital(p) {
    if (!p.home || p.health == null || p.health >= B.health_seek_hospital) return null;
    return bestClinic(building(p.home));
  }

  function chooseGoal(p) {
    const hospital = considerHospital(p);
    if (hospital) { p.goal = { kind: 'hospital', building: hospital.id }; return; }
    if (age(p) < B.adult_age) {
      const h = building(p.home); if (h) p.goal = { kind: 'home', building: h.id, duration: 6 };
      return;
    }
    const workShift = p.work ? todaysShift(p, town.day) : null;
    if (workShift && dayPart() * 24 >= departureHourFor(p) && dayPart() * 24 < workShift.end) {
      p.goal = { kind: 'work', building: p.work };
      return;
    }
    const tourTarget = tourGoalFor(p);
    // Give the touring owner a proper visible stay instead of the .18
    // fallback (barely a blink on screen) - same real-time-pacing "duration"
    // convention as the home stays above (4/6), just long enough that they
    // actually read as being inside the shop for a while before leaving.
    if (tourTarget) { p.goal = { kind: 'tour', building: tourTarget.id, duration: 3 }; return; }
    const gym = gymGoalFor(p);
    if (gym) { p.goal = { kind: 'gym', building: gym.id }; return; }
    const park = considerPark(p);
    if (park) p.goal = { kind: 'park', building: park.id };
    else if (p.home) p.goal = { kind: 'home', building: p.home, duration: p.work ? 4 : 6 };
    // A homeless adult (evicted at 18, or simply not housed yet) has no
    // "go home" fallback and considerPark requires a home too, so outside
    // work hours they used to get no goal at all and just froze in place
    // forever - looking, for all practical purposes, like they had
    // vanished. Loiter near work instead while still house-hunting.
    else if (p.work) p.goal = { kind: 'idle', building: p.work, duration: 4 };
  }

  // How many real hours of free time remain today, given the day's schedule.
  // Used to judge whether a special park trip mid-week still leaves enough
  // time to sleep and make the next work departure.
  function parkFreeHours(p) {
    const hourNow = dayPart() * 24;
    const shift = p.work ? todaysShift(p, town.day) : null;
    if (shift) {
      const dep = departureHourFor(p);
      if (hourNow < dep) return dep - hourNow;
      if (hourNow >= shift.end) return Math.max(0, 24 - B.sleep_hours - hourNow);
      return 0;
    }
    return Math.max(0, 24 - B.sleep_hours - hourNow);
  }

  function bestPark(origin) {
    let best = null, bestHours = Infinity;
    for (const b of town.buildings) {
      if (b.type !== 'park' || (b.built || 0) < 1) continue;
      const hours = hoursForWalk(roadRoute(origin, b));
      if (Number.isFinite(hours) && hours < bestHours) { bestHours = hours; best = b; }
    }
    return best;
  }

  // Decides whether this person should head to a park right now. Weekends
  // honor the daily happiness roll at its randomly selected hour. A workday
  // interrupts work only when happiness is genuinely low AND the round trip
  // plus the visit still fits before the next obligation.
  function considerPark(p) {
    if (!p.home || p.happiness == null) return null;
    if (p.last_park_visit === Math.floor(town.day)) return null;
    const workShift = p.work ? todaysShift(p, town.day) : null;
    const weekend = !workShift;
    if (weekend) {
      const day = Math.floor(town.day);
      if (p._parkPlanDay !== day) {
        p._parkPlanDay = day;
        p._parkPlanVisit = Math.random() < Math.max(0, Math.min(1, 1 - p.happiness / 100));
        p._parkPlanHour = 8 + Math.random() * 9;
      }
      if (!p._parkPlanVisit || dayPart() * 24 < p._parkPlanHour) return null;
    } else if (p.happiness >= B.happiness_seek_park) return null;
    const home = building(p.home);
    const park = bestPark(home); if (!park) return null;
    const isFreeDay = !p.work || weekend;
    if (!isFreeDay && p.happiness > B.happiness_urgent_park) return null;
    const trip = planTrip(home, park, p);
    if (!Number.isFinite(trip.hours)) return null;
    // A successful weekend roll must result in an actual visit. With the
    // slower city-scale walking speed, applying the weekday bedtime window
    // here rejected most randomly scheduled visits to a distant park.
    if (weekend) return park;
    const roundTrip = trip.hours * 2 + B.park_visit_duration;
    return roundTrip <= parkFreeHours(p) ? park : null;
  }

  // walk_speed is world-units per real-second at 1x game speed and represents
  // walk_speed_kmh - every vehicle speed is the same ratio scaled by its own
  // km/h, so a 50 km/h road segment moves a car 10x faster than a pedestrian.
  function vehicleUnitsPerSecond(kmh) { return B.walk_speed * (kmh / B.walk_speed_kmh); }
  function travelPaceFactor(p) {
    return p && p.happiness != null ? .75 + .25 * (p.happiness / 100) : 1;
  }
  // Pedestrians (unlike a car's driver, which only cares about mood) also
  // slow down when tired, not just when unhappy - averaged together so the
  // overall .75-1.0 range stays the same as before, just now driven by
  // both stats instead of happiness alone.
  function pedestrianPaceFactor(p) {
    if (!p) return 1;
    const happiness = p.happiness != null ? p.happiness : 100;
    const energy = p.energy != null ? p.energy : 100;
    return .75 + .25 * ((happiness + energy) / 2 / 100);
  }
  // Game time and real time are both scaled by the same `speed` multiplier,
  // so it cancels out of any duration expressed in game-hours: this is the
  // same relationship the original workDepartureHour math relied on.
  function hoursForRealSeconds(secs) { return secs * 24 * B.days_per_second; }
  function routeLength(points) {
    let len = 0; for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]); return len;
  }
  function hoursForWalk(points, p) {
    if (!points || points.length < 2) return Infinity;
    return hoursForRealSeconds(routeLength(points) / (B.walk_speed * pedestrianPaceFactor(p)));
  }
  function roadSpeedKmh(roadId) {
    const road = town.roads.find(r => r.id === roadId);
    return road ? (road.speed_kmh || roadSpec(road).speed_kmh) : B.walk_speed_kmh;
  }
  function hoursForVehicleRoute(detail, driver) {
    if (!detail || detail.points.length < 2) return Infinity;
    let secs = 0;
    const pace = travelPaceFactor(driver);
    for (let i = 1; i < detail.points.length; i++) {
      secs += dist(detail.points[i - 1], detail.points[i]) / (vehicleUnitsPerSecond(roadSpeedKmh(detail.roadIds[i - 1])) * pace);
    }
    return hoursForRealSeconds(secs);
  }

  function segmentLength(line, i) { return dist(line.points[i], line.points[(i + 1) % line.points.length]); }
  function segmentSpeedKmh(line, i) { return roadSpeedKmh(line.roadIds[i]); }
  function segmentSeconds(line, i) { return segmentLength(line, i) / vehicleUnitsPerSecond(segmentSpeedKmh(line, i)); }

  function stopPositionOnLine(line, stop) {
    if (stop.lineId != null && stop.lineId !== line.id) return null;
    if (stop.lineId === line.id && Number.isInteger(stop.lineSeg) && Number.isFinite(stop.lineT) &&
        stop.lineSeg >= 0 && stop.lineSeg < line.points.length) {
      return { segIndex: stop.lineSeg, t: stop.lineT, distance: 0 };
    }
    let best = null;
    for (let i = 0; i < line.points.length; i++) {
      const a = line.points[i], b = line.points[(i + 1) % line.points.length];
      const proj = projectToRoad({ x: stop.x, y: stop.y }, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      if (proj.distance <= STOP_REACH && (!best || proj.distance < best.distance)) best = { segIndex: i, t: proj.t, distance: proj.distance };
    }
    return best;
  }
  // New stops belong to one selected line. The geometric fallback only
  // supports old saves until normalizeTown attaches those legacy stops.
  function lineStops(line) {
    return town.busStops.filter(stop => stopPositionOnLine(line, stop)).sort((a, b) => {
      const pa = stopPositionOnLine(line, a), pb = stopPositionOnLine(line, b);
      return pa.segIndex - pb.segIndex || pa.t - pb.t;
    });
  }

  function nextStopInSegment(line, seg, afterT) {
    let best = null;
    for (const stop of town.busStops) {
      if (stop.lineId != null && stop.lineId !== line.id) continue;
      if (stop.lineId === line.id && stop.lineSeg === seg && Number.isFinite(stop.lineT)) {
        if (stop.lineT > afterT + 1e-6 && (!best || stop.lineT < best.t)) best = { t: stop.lineT, stop };
        continue;
      }
      const a = line.points[seg], b = line.points[(seg + 1) % line.points.length];
      const proj = projectToRoad({ x: stop.x, y: stop.y }, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      if (proj.distance <= STOP_REACH && proj.t > afterT + 1e-6 && (!best || proj.t < best.t)) best = { t: proj.t, stop };
    }
    return best;
  }

  function lineLoopSeconds(line) {
    let total = B.bus_dwell_seconds * lineStops(line).length;
    for (let i = 0; i < line.points.length; i++) total += segmentSeconds(line, i);
    return total;
  }
  function lineLoopHours(line) { return hoursForRealSeconds(lineLoopSeconds(line)); }
  function lineHeadwayHours(line) {
    const buses = town.buses.filter(b => b.lineId === line.id);
    return buses.length ? lineLoopHours(line) / buses.length : Infinity;
  }

  // Real-seconds to travel forward around the loop from one path position to
  // another, including the dwell time of every stop passed strictly between
  // them (not the two endpoints themselves - boarding/alighting dwell is
  // accounted for separately by the caller).
  function positionSeconds(line, fromSeg, fromT, toSeg, toT) {
    const n = line.points.length; let seg = fromSeg, t = fromT, secs = 0, guard = 0;
    while (!(seg === toSeg && Math.abs(t - toT) < 1e-9) && guard++ < n + 5) {
      const segLen = segmentLength(line, seg), speed = vehicleUnitsPerSecond(segmentSpeedKmh(line, seg));
      let targetT = 1, stopHere = null;
      if (seg === toSeg && toT > t) targetT = toT;
      else {
        const next = nextStopInSegment(line, seg, t);
        if (next && (seg !== toSeg || next.t < toT)) { targetT = next.t; stopHere = next; }
      }
      secs += (targetT - t) * segLen / speed;
      t = targetT;
      if (seg === toSeg && Math.abs(t - toT) < 1e-9) break;
      if (t >= 1 - 1e-9) { seg = (seg + 1) % n; t = 0; } else if (stopHere) secs += B.bus_dwell_seconds;
    }
    return secs;
  }

  function busSecondsToStop(bus, line, stop) {
    const pos = stopPositionOnLine(line, stop); if (!pos) return Infinity;
    let secs = positionSeconds(line, bus.seg, bus.segT, pos.segIndex, pos.t);
    if (bus.dwell > 0) secs += bus.dwell;
    return secs;
  }
  function nextArrivalSeconds(line, stop) {
    const buses = town.buses.filter(b => b.lineId === line.id);
    return buses.length ? Math.min(...buses.map(b => busSecondsToStop(b, line, stop))) : Infinity;
  }
  function busArrivalLabel(line, stop) {
    const secs = nextArrivalSeconds(line, stop);
    if (!Number.isFinite(secs)) return tr('lt_bus_none');
    const rounded = Math.max(0, Math.ceil(secs));
    const wait = rounded < 60 ? tr('lt_bus_wait_seconds', { n: rounded }) :
      tr('lt_bus_wait_minutes', { n: Math.ceil(rounded / 60) });
    const arrivalDay = town.day + secs * B.days_per_second * speed;
    const totalMinutes = Math.floor((arrivalDay - Math.floor(arrivalDay)) * 24 * 60);
    const clock = String(Math.floor(totalMinutes / 60)).padStart(2, '0') + ':' + String(totalMinutes % 60).padStart(2, '0');
    const weekday = tr('lt_weekday_' + (Math.floor(arrivalDay) % 7));
    return tr('lt_bus_arrives_at', { time: weekday + ' ' + clock, wait });
  }

  // Looks at every line's stops within walking reach of both ends of the
  // trip and picks the board/alight pair with the lowest total time (walk to
  // stop + live wait for the next bus there + ride + walk from alight stop).
  function bestBusPlan(home, workplace, p) {
    let best = null;
    for (const line of town.busLines) {
      const stops = lineStops(line); if (stops.length < 2) continue;
      const boardCandidates = stops.filter(s => dist(s, home) <= BUS_CATCHMENT).sort((a, b) => dist(a, home) - dist(b, home)).slice(0, 3);
      const alightCandidates = stops.filter(s => dist(s, workplace) <= BUS_CATCHMENT).sort((a, b) => dist(a, workplace) - dist(b, workplace)).slice(0, 3);
      for (const boardStop of boardCandidates) {
        const boardPos = stopPositionOnLine(line, boardStop); if (!boardPos) continue;
        for (const alightStop of alightCandidates) {
          if (alightStop.id === boardStop.id) continue;
          const alightPos = stopPositionOnLine(line, alightStop); if (!alightPos) continue;
          const waitSecs = nextArrivalSeconds(line, boardStop); if (!Number.isFinite(waitSecs)) continue;
          const rideSecs = positionSeconds(line, boardPos.segIndex, boardPos.t, alightPos.segIndex, alightPos.t);
          const walkToBoard = hoursForWalk(roadRoute(home, boardStop), p);
          const walkFromAlight = hoursForWalk(roadRoute(alightStop, workplace), p);
          const hours = walkToBoard + hoursForRealSeconds(waitSecs) + hoursForRealSeconds(rideSecs) + walkFromAlight;
          if (Number.isFinite(hours) && (!best || hours < best.hours)) best = { hours, line, boardStop, alightStop };
        }
      }
    }
    return best;
  }

  // Car owners always drive - it is a luxury they already committed to by
  // buying the car, not something weighed trip by trip. Everyone else always
  // takes whichever of walking or the bus is actually faster.
  function planTrip(originB, destB, p) {
    const walkHours = hoursForWalk(roadRoute(originB, destB), p);
    if (p.car) {
      const carHours = hoursForVehicleRoute(roadRouteDetailed(originB, destB), p);
      if (Number.isFinite(carHours)) return { mode: 'car', hours: carHours };
    }
    const busPlan = bestBusPlan(originB, destB, p);
    if (busPlan && busPlan.hours < walkHours) return { mode: 'bus', hours: busPlan.hours, line: busPlan.line, boardStop: busPlan.boardStop, alightStop: busPlan.alightStop };
    return { mode: 'walk', hours: walkHours };
  }

  function planCommute(p) {
    const home = building(p.home), workplace = building(p.work);
    // The start hour of the shift they're due at: today's, or (if an
    // overnight shift is still running from yesterday) right now.
    const shift = todaysShift(p, town.day);
    const startHour = shift ? Math.max(0, shift.start) : SHIFT_DEFS[shiftTypeOf(p)].start;
    if (!home || !workplace) return { hour: startHour, mode: 'walk' };
    const plan = planTrip(home, workplace, p);
    if (!Number.isFinite(plan.hours)) return { hour: startHour, mode: 'walk' };
    return { hour: Math.max(0, startHour - plan.hours), mode: plan.mode, line: plan.line, boardStop: plan.boardStop, alightStop: plan.alightStop };
  }

  // Recomputing the best route/plan is too costly to redo every frame for
  // every resident still sitting at home, so it is cached until the day
  // rolls over or something that could change the answer actually changes:
  // home/work/owning a car, or the road/transit network itself.
  function commutePlanFor(p) {
    const day = Math.floor(town.day);
    if (p._commuteDay !== day || p._commuteWork !== p.work || p._commuteHome !== p.home ||
        p._commuteCar !== p.car || p._commuteTransit !== town.transit_version) {
      p._commutePlan = planCommute(p);
      p._commuteDay = day; p._commuteWork = p.work; p._commuteHome = p.home;
      p._commuteCar = p.car; p._commuteTransit = town.transit_version;
    }
    return p._commutePlan;
  }
  function departureHourFor(p) { return commutePlanFor(p).hour; }

  function updateSite(b, dt) {
    if ((b.built || 0) < 1) {
      b.built = Math.min(1, (b.built || 0) + dt * B.days_per_second * speed / (b.build_days || .04));
      if (b.built < 1) return;
      addEvent('lt_event_finished', { name: b.name });
      if (b.type === 'house') occupyHouse(b);
      fillJobs();
      return;
    }
    if (b.target_development) {
      b.upgrade_progress = Math.min(1, (b.upgrade_progress || 0) + dt * B.days_per_second * speed / (b.upgrade_days || .08));
      if (b.upgrade_progress < 1) return;
      b.development = b.target_development;
      b.target_development = null; b.upgrade_progress = null; b.upgrade_days = null;
      if (b.type === 'shop') updateBusinessScale(b);
      else { updateHomeScale(b); houseExistingResidents(); }
      addEvent('lt_event_finished', { name: b.name }); fillJobs();
    }
  }

  // No junction/right-of-way model exists, so this is a simple stand-in:
  // a car never gets shoved through another vehicle, it just waits its turn.
  // Buses always have priority over cars, and between two cars the one that
  // was already on the road (lower id) goes first - a strict order, so this
  // can never deadlock two cars into waiting on each other forever.
  //
  // Overtaking works the same way, one lane deeper: a car defaults to the
  // right-hand ("cruise") lane. If it is close behind another car in that
  // same lane, on the same road, heading the same way, and the road actually
  // has a second lane going that direction (oneway/avenue/highway - not a
  // single-lane twoway or dirt road), it swings into the left ("pass") lane
  // as long as that lane is clear right there, drives around, and merges
  // back once the right lane ahead of it is clear again. A single-lane road
  // still just makes the following car wait, same as before.
  const CAR_WAIT_GAP = SUB * .9;
  const CAR_MERGE_CLEAR = SUB * 1.8;
  // The two lanes going the same direction as `forward` on this road type,
  // or a single "lane" for road types with only one lane each way.
  function laneStripsAhead(type, forward) {
    if (type === 'oneway') return [2, 3];
    if (type === 'avenue') return forward ? [3, 4] : [1, 2];
    if (type === 'highway') return forward ? [3, 4, 5] : [0, 1, 2];
    return forward ? [4] : [1];
  }
  function carDirection(car) {
    const roadId = car.roadIds && car.roadIds[car.seg];
    const road = roadId != null && town.roads.find(r => r.id === roadId);
    const from = car.points && car.points[car.seg], to = car.points && car.points[car.seg + 1];
    if (!road || !from || !to) return null;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
    const forward = dx * (road.x2 - road.x1) + dy * (road.y2 - road.y1) >= 0;
    return { roadId, forward, fx: dx / len, fy: dy / len, type: road.type || 'dirt' };
  }
  // Nearest other car ahead of `car` (by its own heading), on the same road,
  // same direction and same lane, within `gap`.
  function carAheadInLane(car, lane, dir, gap) {
    let nearest = null, nearestDist = Infinity;
    for (const other of town.cars) {
      if (other.id === car.id) continue;
      if ((other.lane || 'right') !== lane) continue;
      const dx = other.x - car.x, dy = other.y - car.y;
      if (dx * dir.fx + dy * dir.fy <= 0) continue;
      const d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      // Matching on the exact current road piece used to miss a car just
      // ahead across a piece boundary (a corner, an intersection), letting
      // two cars overlap right at that seam. Proximity plus heading is
      // reliable everywhere; only reject something not actually heading
      // the same way (crossing traffic at a junction), when its heading is
      // known.
      const otherDir = carDirection(other);
      if (otherDir && otherDir.fx * dir.fx + otherDir.fy * dir.fy < .5) continue;
      if (d < nearestDist) { nearest = other; nearestDist = d; }
    }
    return nearest;
  }
  function updateCarLane(car) {
    const dir = carDirection(car);
    car.lane = car.lane || 'right';
    if (!dir) return;
    const canPass = laneStripsAhead(dir.type, dir.forward).length > 1;
    if (car.lane === 'left') {
      if (!canPass || !carAheadInLane(car, 'right', dir, CAR_MERGE_CLEAR)) car.lane = 'right';
      return;
    }
    if (canPass && carAheadInLane(car, 'right', dir, CAR_WAIT_GAP) && !carAheadInLane(car, 'left', dir, CAR_WAIT_GAP)) {
      car.lane = 'left';
    }
  }
  function carBlocked(car) {
    const from = car.points && car.points[car.seg], to = car.points && car.points[car.seg + 1];
    if (vehicleMustYieldToPedestrian(car, from, to, SUB * .45)) return true;
    for (const bus of town.buses) if (dist(car, bus) < CAR_WAIT_GAP) return true;
    const dir = carDirection(car);
    if (!dir) {
      for (const other of town.cars) {
        if (other.id !== car.id && other.id < car.id && dist(car, other) < CAR_WAIT_GAP) return true;
      }
      return false;
    }
    const blocker = carAheadInLane(car, car.lane || 'right', dir, CAR_WAIT_GAP);
    return !!(blocker && blocker.id < car.id);
  }

  function randomCarColor() { return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]; }

  function startCarTrip(driver, origin, target) {
    const detail = roadRouteDetailed(origin, target);
    if (!detail) { driver.inside = origin.id; driver.goal = null; return; }
    const car = { id: town.next_car++, ownerId: driver.id, x: detail.points[0].x, y: detail.points[0].y,
      points: detail.points, roadIds: detail.roadIds, seg: 0, segT: 0, lane: 'right', color: randomCarColor(), passengers: [driver.id] };
    driver.riding = { kind: 'car', id: car.id }; driver.route = null; driver.routeGoal = null;
    // A housemate heading to the exact same place at the exact same moment
    // rides along for free instead of needing (and taxing) a car of their
    // own - only the driver's own car actually makes the trip.
    for (const mate of town.people) {
      if (mate.id === driver.id || mate.car || mate.home !== driver.home || mate.inside !== origin.id) continue;
      if (!mate.goal || mate.goal.building !== target.id) continue;
      mate.riding = { kind: 'car', id: car.id }; mate.inside = null; resetTravel(mate);
      car.passengers.push(mate.id);
    }
    town.cars.push(car);
  }

  function arriveCar(car) {
    const dest = car.points[car.points.length - 1];
    for (const id of car.passengers) {
      const p = person(id); if (!p) continue;
      p.riding = null; p.x = dest.x; p.y = dest.y;
      if (p.goal && p.goal.building) {
        p.inside = p.goal.building;
        if (p.goal.kind === 'work' && isWorkTimeFor(p)) p.worked_day = Math.floor(town.day);
        if (p.goal.kind === 'park') {
          p.parked_day = Math.floor(town.day); p.parked_building = p.goal.building; p.last_park_visit = Math.floor(town.day);
        } else if (p.goal.kind === 'tour') {
          const shop = building(p.goal.building);
          if (shop) { p.money += shop.till || 0; shop.till = 0; }
          p.toured_day = Math.floor(town.day);
          p.goal.left = p.goal.duration || .18;
        } else if (p.goal.kind === 'hospital' || p.goal.kind === 'gym') {
          // Recovery/training is driven live by updatePerson's "already
          // inside" branch (keyed on health/hoursLeft, not a fixed timer).
        } else {
          p.goal.left = p.goal.duration || .18;
        }
      } else p.goal = null;
    }
    town.cars = town.cars.filter(c => c.id !== car.id);
  }

  function updateCars(dt) { for (const car of town.cars.slice()) updateCar(car, dt); }
  function updateCar(car, dt) {
    updateCarLane(car);
    if (carBlocked(car)) return;
    // A driver in a bad mood is a bit less eager to hurry - same flavor
    // effect as the pedestrian's moraleFactor, capped at a quarter slower.
    // Buses have no individual driver, so they never get this penalty.
    const driver = person(car.ownerId);
    const moraleFactor = travelPaceFactor(driver);
    let budget = dt, guard = 0;
    while (budget > 0 && guard++ < 50) {
      if (car.seg >= car.points.length - 1) { arriveCar(car); return; }
      const a = car.points[car.seg], b = car.points[car.seg + 1];
      const segLen = Math.max(.001, dist(a, b));
      const speed = vehicleUnitsPerSecond(roadSpeedKmh(car.roadIds[car.seg])) * moraleFactor;
      const secs = (1 - car.segT) * segLen / speed;
      if (secs <= budget) { budget -= secs; car.seg += 1; car.segT = 0; }
      else { car.segT += (budget / segLen) * speed; budget = 0; }
    }
    const last = car.points.length - 1;
    const a = car.points[Math.min(car.seg, last)], b = car.points[Math.min(car.seg + 1, last)];
    car.x = a.x + (b.x - a.x) * car.segT; car.y = a.y + (b.y - a.y) * car.segT;
  }

  function boardAndAlight(bus, stop, line) {
    bus.passengers = bus.passengers.filter(id => {
      const p = person(id);
      if (!p) return false;
      if (p.busAlightStop === stop.id) {
        const platform = busStopGeometry(stop).point;
        p.riding = null; p.x = platform.x; p.y = platform.y; p.inside = null; p.waitingAtStop = null;
        resetTravel(p);
        return false;
      }
      return true;
    });
    const waiting = town.people.filter(p => p.waitingAtStop === stop.id && p.busLine === line.id);
    for (const p of waiting) {
      if (bus.passengers.length >= bus.capacity) break;
      p.money -= B.bus_fare; town.treasury += B.bus_fare; econ('income', 'fares', B.bus_fare);
      p.waitingAtStop = null; p.riding = { kind: 'bus', id: bus.id };
      bus.passengers.push(p.id);
    }
  }

  function updateBuses(dt) { for (const bus of town.buses) updateBus(bus, dt); }
  function updateBus(bus, dt) {
    const line = town.busLines.find(l => l.id === bus.lineId);
    if (!line || line.points.length < 2) return;
    if (bus.dwell > 0) { bus.dwell = Math.max(0, bus.dwell - dt); return; }
    const currentSeg = bus.seg % line.points.length;
    if (vehicleMustYieldToPedestrian(bus, line.points[currentSeg], line.points[(currentSeg + 1) % line.points.length], SUB * 1.1)) return;
    let budget = dt, guard = 0;
    while (budget > 0 && guard++ < 50) {
      const seg = bus.seg % line.points.length;
      const a = line.points[seg], b = line.points[(seg + 1) % line.points.length];
      const segLen = Math.max(.001, dist(a, b)), speed = vehicleUnitsPerSecond(segmentSpeedKmh(line, seg));
      const stopAhead = nextStopInSegment(line, seg, bus.segT);
      const targetT = stopAhead ? stopAhead.t : 1;
      const secs = (targetT - bus.segT) * segLen / speed;
      if (secs <= budget) {
        budget -= secs; bus.segT = targetT;
        if (stopAhead) { boardAndAlight(bus, stopAhead.stop, line); bus.dwell = B.bus_dwell_seconds; break; }
        bus.seg = (seg + 1) % line.points.length; bus.segT = 0;
      } else { bus.segT += (budget / segLen) * speed; budget = 0; }
    }
    const seg = bus.seg % line.points.length;
    const a = line.points[seg], b = line.points[(seg + 1) % line.points.length];
    bus.x = a.x + (b.x - a.x) * bus.segT; bus.y = a.y + (b.y - a.y) * bus.segT;
  }

  function buyBus(lineId) {
    const line = town.busLines.find(l => l.id === lineId); if (!line) return;
    const spec = B.bus_types[line.tier];
    if (town.treasury < spec.cost) return say(tr('lt_no_money_cost', { price: money(spec.cost), have: money(town.treasury) }));
    town.treasury -= spec.cost; econ('expense', 'construction', spec.cost);
    const start = line.points[0];
    town.buses.push({ id: town.next_bus++, lineId, tier: line.tier, seg: 0, segT: 0,
      x: start.x, y: start.y, dwell: 0, passengers: [], capacity: spec.capacity });
    say(tr('lt_bus_bought')); town.transit_version++; push(); renderPanel(); renderHud();
  }
  function upgradeLine(lineId, tier) {
    const line = town.busLines.find(l => l.id === lineId); if (!line || !B.bus_types[tier]) return;
    const buses = town.buses.filter(b => b.lineId === lineId);
    const cost = B.bus_types[tier].cost * Math.max(1, buses.length);
    if (town.treasury < cost) return say(tr('lt_no_money_cost', { price: money(cost), have: money(town.treasury) }));
    town.treasury -= cost; econ('expense', 'construction', cost); line.tier = tier;
    for (const bus of buses) { bus.tier = tier; bus.capacity = B.bus_types[tier].capacity; }
    say(tr('lt_bus_upgraded')); town.transit_version++; push(); renderPanel(); renderHud();
  }
  function removeBus(busId) {
    const bus = town.buses.find(b => b.id === busId); if (!bus) return;
    for (const id of bus.passengers) {
      const p = person(id); if (!p) continue;
      p.riding = null; p.x = bus.x; p.y = bus.y; resetTravel(p);
    }
    town.buses = town.buses.filter(b => b.id !== busId);
    town.transit_version++; push(); renderPanel(); renderHud();
  }

  function deleteBusLine(lineId) {
    const line = town.busLines.find(item => item.id === lineId); if (!line) return;
    const removedBuses = town.buses.filter(bus => bus.lineId === lineId);
    const removedBusIds = new Set(removedBuses.map(bus => bus.id));
    const busById = new Map(removedBuses.map(bus => [bus.id, bus]));
    for (const p of town.people) {
      const ridingRemovedBus = p.riding && p.riding.kind === 'bus' && removedBusIds.has(p.riding.id);
      if (ridingRemovedBus) {
        const bus = busById.get(p.riding.id);
        if (bus) { p.x = bus.x; p.y = bus.y; }
        p.riding = null;
      }
      if (ridingRemovedBus || p.busLine === lineId) {
        p.waitingAtStop = null;
        resetTravel(p);
      }
    }
    town.buses = town.buses.filter(bus => bus.lineId !== lineId);
    town.busLines = town.busLines.filter(item => item.id !== lineId);
    town.busStops = town.busStops.filter(stop => stop.lineId !== lineId);
    if (stopLineId === lineId) { stopLineId = null; pendingBusStop = null; mode = null; }
    selected = { kind: 'lines' };
    town.transit_version++;
    say(tr('lt_bus_line_deleted')); push(); renderPanel(); renderHud();
  }

  function carOpportunity(p) {
    if (p.car || age(p) < B.adult_age || !p.work || p.money < B.car_cost * 1.3) return false;
    p.money -= B.car_cost; town.treasury += B.car_cost; econ('income', 'property', B.car_cost); p.car = true;
    p.history.unshift('lt_hist_car'); addEvent('lt_event_car', { person: p.name });
    town.transit_version++;
    return true;
  }

  function ownedShops(p) {
    return town.buildings.filter(b => b.type === 'shop' && b.built >= 1 &&
      (b.owners && b.owners.length ? b.owners : [b.owner]).includes(p.id));
  }
  function fillJobs() {
    const vacancies = town.buildings.filter(b => b.built >= 1 && (b.workers || []).length < (b.jobs || 0));
    for (const p of town.people) {
      if (p.work || age(p) < B.adult_age || age(p) >= B.retire_age) continue;
      // A business owner tours their businesses instead of working at any
      // of them (or anywhere else) - see the 'tour' goal in chooseGoal.
      if (ownedShops(p).length) continue;
      if (businessOpportunity(p)) continue;
      let best = null, bestWage = -Infinity;
      for (const b of vacancies) {
        if ((b.workers || []).length >= b.jobs) continue;
        const wage = b.wage || 0;
        if (wage > bestWage || wage === bestWage && best && b.id < best.id) {
          bestWage = wage; best = b;
        }
      }
      if (best) {
        best.workers.push(p.id); p.work = best.id; assignShift(p);
        p.history.unshift('lt_hist_job'); addEvent('lt_event_job', { person: p.name, name: best.name });
      }
    }
  }

  // Already-employed workers aren't loyal to wherever fillJobs first placed
  // them - if a vacancy anywhere in town pays strictly more than their
  // current job, they jump for it, distance be damned (unlike fillJobs'
  // own commute-weighted placement for the newly jobless). Keeps wages from
  // just being locked in by whichever spot someone happened to fill first.
  function seekBetterJob() {
    for (const p of town.people) {
      if (!p.work || age(p) < B.adult_age || age(p) >= B.retire_age) continue;
      if (ownedShops(p).length) continue;
      const current = building(p.work); if (!current) continue;
      let best = null, bestWage = current.wage || 0;
      for (const b of town.buildings) {
        if (b.id === current.id || (b.built || 0) < 1 || !(b.jobs > 0)) continue;
        if ((b.workers || []).length >= b.jobs) continue;
        if ((b.wage || 0) > bestWage) { bestWage = b.wage || 0; best = b; }
      }
      if (!best) continue;
      current.workers = (current.workers || []).filter(id => id !== p.id);
      best.workers.push(p.id); p.work = best.id; assignShift(p);
      p.history.unshift('lt_hist_job'); addEvent('lt_event_job', { person: p.name, name: best.name });
    }
  }

  function formCouples() {
    const singles = town.people.filter(p => age(p) >= B.adult_age && age(p) <= 50 && !p.partner);
    for (const p of singles) {
      if (p.partner) continue;
      // No hard age-gap cutoff any more - a small town can't afford to
      // structurally lock itself out of ever pairing up again just because
      // its only same-generation singles ended up spread far apart. Instead
      // the closest-in-age eligible match is always the one considered, and
      // the chance of it actually happening today falls off with how far
      // apart they are: 80% at the same age, down 2.5%/year of difference
      // (so it's already near-zero past a ~32-year gap without needing an
      // explicit cap).
      const matches = singles.filter(q => q.id !== p.id && !q.partner && q.sex !== p.sex &&
        !(p.parents || []).includes(q.id) && !(q.parents || []).includes(p.id) &&
        !(p.parents || []).some(id => (q.parents || []).includes(id)));
      if (!matches.length) continue;
      matches.sort((a, b) => Math.abs(age(a) - age(p)) - Math.abs(age(b) - age(p)));
      const partner = matches[0];
      const chance = Math.max(0, .80 - .025 * Math.abs(age(partner) - age(p)));
      if (Math.random() >= chance) continue;
      p.partner = partner.id; partner.partner = p.id;
    }
  }

  function propertyLevelsInZone(kind, at) {
    const zone = zoneAt(at); if (!zone || zone.kind !== kind) return Infinity;
    const cluster = new Set(zoneCluster(zone.gx, zone.gy).map(z => z.gx + ':' + z.gy));
    const type = kind === 'business' ? 'shop' : 'house';
    return town.buildings.filter(b => b.type === type && b.built >= 1)
      .filter(b => { const c = cellAt(b); return cluster.has(c.gx + ':' + c.gy); })
      .reduce((sum, b) => sum + Math.max(1, b.development || 1), 0);
  }
  // Same result as propertyLevelsInZone, but memoized per cluster within a
  // single caller-supplied cache - businessOpportunity/housingOpportunity
  // used to run the zoneCluster BFS (plus a full buildings scan) once for
  // EVERY vacant cell of a zone, even though every cell in the same
  // cluster gets the identical answer. With dozens of vacant cells across
  // only a handful of actual clusters, and this running for every adult in
  // town every simulated day, that redundant work was heavy enough to
  // cause a visible hitch each day (worse at higher game speed, since days
  // pass faster). The cache is created fresh by the caller per call, so it
  // can never go stale across separate calls.
  function propertyLevelsInZoneCached(kind, at, cache) {
    const zone = zoneAt(at); if (!zone || zone.kind !== kind) return Infinity;
    const startKey = zone.gx + ':' + zone.gy;
    if (cache.has(startKey)) return cache.get(startKey);
    const clusterKeys = zoneCluster(zone.gx, zone.gy).map(z => z.gx + ':' + z.gy);
    const clusterSet = new Set(clusterKeys);
    const type = kind === 'business' ? 'shop' : 'house';
    const levels = town.buildings.filter(b => b.type === type && b.built >= 1)
      .filter(b => { const c = cellAt(b); return clusterSet.has(c.gx + ':' + c.gy); })
      .reduce((sum, b) => sum + Math.max(1, b.development || 1), 0);
    for (const key of clusterKeys) cache.set(key, levels);
    return levels;
  }

  function homeCostAt(at) {
    const levels = propertyLevelsInZone('residential', at);
    return Number.isFinite(levels) ? B.private_build_cost.house * (levels + 1) : Infinity;
  }

  function housingOpportunity(owners) {
    if (town.buildings.some(b => b.type === 'house' && b.built < 1)) return null;
    const money = owners.reduce((sum, p) => sum + Math.max(0, p.money), 0);
    const occupied = new Set(town.buildings.map(b => cellKey(cellAt(b))));
    const levelsCache = new Map();
    const options = town.zones.filter(z => z.kind === 'residential' && !occupied.has(cellKey(z)) && !cellHasRoad(z))
      .map(z => {
        const at = cellPoint(z);
        const levels = propertyLevelsInZoneCached('residential', at, levelsCache);
        const cost = Number.isFinite(levels) ? B.private_build_cost.house * (levels + 1) : Infinity;
        return { at, cost, tax: z.tax_rate || 0 };
      })
      .filter(x => money >= x.cost)
      .sort((a, b) => a.cost - b.cost || a.tax - b.tax);
    return options[0] || null;
  }

  function homeValue(home) {
    const level = Math.max(1, home.development || 1);
    let value = homeCostAt(home);
    if (!Number.isFinite(value)) value = B.private_build_cost.house;
    for (let next = 2; next <= level; next++) value += B.private_build_cost.house * next;
    return value;
  }

  function businessValue(shop) {
    const level = Math.max(1, shop.development || 1);
    let value = businessCostAt(shop);
    if (!Number.isFinite(value)) value = B.private_build_cost.shop;
    for (let next = 2; next <= level; next++) value += B.private_build_cost.shop * next;
    return value;
  }

  // A resident's total worth: cash on hand plus their share of every home
  // or business they own (valued the same way a buyer would price it) and
  // any till still waiting to be collected from their businesses.
  function netWorth(p) {
    let total = p.money || 0;
    for (const b of town.buildings) {
      if ((b.built || 0) < 1 || (b.type !== 'house' && b.type !== 'shop')) continue;
      const owners = (b.owners && b.owners.length) ? b.owners : [b.owner];
      if (!owners.includes(p.id)) continue;
      const share = 1 / owners.length;
      total += (b.type === 'house' ? homeValue(b) : businessValue(b) + (b.till || 0)) * share;
    }
    return total;
  }

  function vacantHomePurchase(buyers) {
    buyers = Array.isArray(buyers) ? buyers.filter(Boolean) : [buyers].filter(Boolean);
    const availableMoney = buyers.reduce((sum, buyer) => sum + Math.max(0, buyer.money), 0);
    return town.buildings.filter(home => home.type === 'house' && home.built >= 1 && !home.target_development &&
      !(home.residents || []).length && buildingRoadAccess(home))
      .map(home => {
        const ownerIds = home.owners && home.owners.length ? home.owners : [home.owner];
        const sellers = ownerIds.map(person).filter(Boolean);
        // An ownerless home costs exactly what a new home in this zone would
        // cost today. Owned resale property keeps its normal market value.
        return { home, sellers, abandoned: !sellers.length,
          price: sellers.length ? homeValue(home) : homeCostAt(home) };
      })
      .filter(option => availableMoney >= option.price)
      .sort((a, b) => Number(b.abandoned) - Number(a.abandoned) || a.price - b.price)[0] || null;
  }

  function buyVacantHome(buyers, option) {
    buyers = Array.isArray(buyers) ? buyers.filter(Boolean) : [buyers].filter(Boolean);
    const buyer = buyers[0], home = option.home;
    const ownerIds = home.owners && home.owners.length ? home.owners : [home.owner];
    const sellers = option.sellers || ownerIds.map(person).filter(Boolean);
    const combined = buyers.reduce((sum, personBuyer) => sum + Math.max(0, personBuyer.money), 0);
    if (!buyer || combined < option.price) return false;
    for (const personBuyer of buyers) {
      personBuyer.money -= option.price * (Math.max(0, personBuyer.money) / combined);
    }
    if (sellers.length) for (const seller of sellers) seller.money += option.price / sellers.length;
    else { town.treasury += option.price; econ('income', 'property', option.price); }
    home.owner = buyer.id; home.owners = buyers.map(personBuyer => personBuyer.id); home.residents = [];
    for (const personBuyer of buyers) {
      const oldHome = building(personBuyer.home);
      if (oldHome) oldHome.residents = (oldHome.residents || []).filter(id => id !== personBuyer.id);
      personBuyer.home = home.id; personBuyer.rental_home = null; personBuyer.inside = home.id;
      personBuyer.x = home.x; personBuyer.y = home.y; personBuyer.goal = null; resetTravel(personBuyer);
      home.residents.push(personBuyer.id);
      personBuyer.history.unshift('lt_hist_invested');
    }
    addEvent('lt_event_home_bought', { person: buyer.name, name: home.name, price: money(option.price) });
    return true;
  }

  function annualRent(home) {
    updateHomeScale(home);
    return Math.max(1, homeValue(home) * .03 / home.capacity);
  }

  function rentalOpportunity(tenant) {
    return town.buildings.filter(b => b.type === 'house' && b.built >= 1 && b.id !== tenant.evicted_from &&
      (b.residents || []).length < (b.capacity || 2) && buildingRoadAccess(b))
      .map(home => {
        // A fully empty home with nobody left to own it is free to claim -
        // whoever moves in first becomes its owner instead of a tenant.
        const empty = !(home.residents || []).length;
        const hasOwner = (home.owners && home.owners.length ? home.owners : [home.owner]).map(person).filter(Boolean).length > 0;
        const claim = empty && !hasOwner;
        return { home, rent: claim ? 0 : annualRent(home), claim };
      })
      .filter(option => option.claim || tenant.money >= option.rent)
      .sort((a, b) => Number(b.claim) - Number(a.claim) || a.rent - b.rent)[0] || null;
  }

  // A couple that cannot afford to buy anywhere together still needs
  // somewhere to actually live together - otherwise they never cohabit at
  // all, which (among other things) means they can never have children.
  // Same idea as rentalOpportunity, just sized and priced for two.
  function coupleRentalOpportunity(couple) {
    const tenants = couple.filter(Boolean);
    if (tenants.length < 2) return null;
    const availableMoney = tenants.reduce((sum, t) => sum + Math.max(0, t.money), 0);
    return town.buildings.filter(b => b.type === 'house' && b.built >= 1 &&
      !tenants.some(t => t.evicted_from === b.id) &&
      (b.residents || []).length + tenants.length <= (b.capacity || 2) && buildingRoadAccess(b))
      .map(home => {
        const empty = !(home.residents || []).length;
        const hasOwner = (home.owners && home.owners.length ? home.owners : [home.owner]).map(person).filter(Boolean).length > 0;
        const claim = empty && !hasOwner;
        // Each of them would owe the full rent independently once moved
        // in (see collectRents), so affording it means affording that
        // much per person, not split between them.
        return { home, rent: claim ? 0 : annualRent(home) * tenants.length, claim };
      })
      .filter(option => option.claim || availableMoney >= option.rent)
      .sort((a, b) => Number(b.claim) - Number(a.claim) || a.rent - b.rent)[0] || null;
  }
  function moveCoupleIntoRental(couple, option) {
    const home = option.home;
    for (const tenant of couple.filter(Boolean)) {
      const oldHome = building(tenant.home);
      if (oldHome) oldHome.residents = (oldHome.residents || []).filter(id => id !== tenant.id);
      tenant.home = home.id; tenant.inside = home.id; tenant.goal = null; resetTravel(tenant);
      if (!home.residents.includes(tenant.id)) home.residents.push(tenant.id);
    }
    if (option.claim) {
      home.owner = couple[0].id; home.owners = couple.filter(Boolean).map(t => t.id);
      for (const tenant of couple.filter(Boolean)) tenant.history.unshift('lt_hist_invested');
    } else {
      for (const tenant of couple.filter(Boolean)) tenant.rental_home = home.id;
    }
  }

  function moveIntoRental(tenant, option) {
    const oldHome = building(tenant.home);
    if (oldHome) oldHome.residents = (oldHome.residents || []).filter(id => id !== tenant.id);
    const home = option.home;
    tenant.home = home.id; tenant.inside = home.id; tenant.goal = null; resetTravel(tenant);
    if (!home.residents.includes(tenant.id)) home.residents.push(tenant.id);
    if (option.claim) {
      home.owner = tenant.id; home.owners = [tenant.id]; tenant.rental_home = null;
      tenant.history.unshift('lt_hist_invested');
    } else {
      tenant.rental_home = home.id;
    }
  }

  function collectRents(completedDay) {
    if (completedDay < 0) return;
    for (const tenant of town.people.filter(p => p.rental_home)) {
      const home = building(tenant.rental_home);
      if (!home) { tenant.rental_home = null; tenant.home = null; continue; }
      const due = annualRent(home), paid = Math.max(0, Math.min(tenant.money, due));
      tenant.money -= paid;
      const owners = (home.owners || [home.owner]).map(person).filter(Boolean);
      if (owners.length) for (const owner of owners) owner.money += paid / owners.length;
      else { town.treasury += paid; econ('income', 'property', paid); }
      tenant.last_rent = paid;
    }
  }

  function houseExistingResidents() {
    for (const resident of town.people.filter(p => !p.home && p.inside !== 'waiting')) {
      const rental = rentalOpportunity(resident);
      if (rental) moveIntoRental(resident, rental);
    }
  }

  function updateHomeScale(b) {
    b.development = Math.max(1, Math.min(10, b.development || 1));
    // Capacity grows by a step that itself grows by 1 each level: level 1
    // is 3, then +4, +5, +6... (3, 7, 12, 18, 25, 33, 42, 52, 63, 75 at
    // level 10) - closed form n*(n+5)/2 - instead of a flat doubling, so a
    // level-1 home isn't stuck at just 2 residents with no room for a
    // child while the couple still can't afford to build again.
    b.capacity = b.development * (b.development + 5) / 2;
  }

  function updateHomes() {
    for (const home of town.buildings.filter(b => b.type === 'house' && b.built >= 1)) {
      updateHomeScale(home);
      // A full home is reason enough to grow it - waiting for someone else
      // in town to be homeless first meant an isolated founding household
      // (no jobs built yet, so no migrants ever showing up to need the
      // room) could sit at its starting capacity forever, permanently
      // blocking their own children from ever having room to be born.
      if (home.target_development || home.development >= 10 ||
          (home.residents || []).length < home.capacity) continue;
      const owners = (home.owners || [home.owner]).map(person).filter(Boolean);
      const total = owners.reduce((sum, p) => sum + Math.max(0, p.money), 0);
      const cost = B.private_build_cost.house * (home.development + 1);
      if (!owners.length || total < cost) continue;
      for (const owner of owners) owner.money -= cost * (Math.max(0, owner.money) / total);
      home.last_upgrade_cost = cost; home.target_development = home.development + 1;
      home.upgrade_progress = 0; home.upgrade_days = home.target_development * .04;
    }
  }

  // Top up a grown child's own savings from their parents' before a
  // purchase, proportional to how much each parent actually has - a gift,
  // not an investment, so only the child ends up owning the new place.
  function giftFromParents(child, parents, amount) {
    if (amount <= 0) return;
    const pool = parents.reduce((sum, par) => sum + Math.max(0, par.money), 0) || 1;
    for (const par of parents) {
      const share = amount * (Math.max(0, par.money) / pool);
      par.money -= share; child.money += share;
    }
  }

  // A grown adult still living with their parents' home (not owning it,
  // not already renting elsewhere) is looking for a place of their own
  // every day, same as any other housing seeker, except their parents chip
  // in toward buying one whenever the combined money makes that possible -
  // they simply keep living at home, undisturbed, until it actually is.
  function seekFamilyHousing() {
    for (const p of town.people) {
      if (age(p) < B.adult_age || !p.home || p.rental_home) continue;
      const home = building(p.home);
      if (!home) continue;
      const owns = (home.owners || [home.owner]).includes(p.id);
      if (owns) continue;
      const parents = (home.owners || [home.owner]).map(person).filter(Boolean)
        .filter(owner => (p.parents || []).includes(owner.id));
      if (!parents.length) continue;
      const resale = vacantHomePurchase([p, ...parents]);
      if (resale) {
        giftFromParents(p, parents, Math.max(0, resale.price - p.money));
        buyVacantHome([p], resale);
        continue;
      }
      const opportunity = housingOpportunity([p, ...parents]);
      if (opportunity) {
        giftFromParents(p, parents, Math.max(0, opportunity.cost - p.money));
        createPrivate('house', opportunity.at, p, opportunity.cost, [p]);
        continue;
      }
      // Can't yet afford to buy anywhere even with help - a rental is
      // cheap enough that their own wage alone usually covers it, so try
      // that on their own money while they wait and keep earning. Not the
      // room they're already in, though - that would just formalise
      // staying put as a rental instead of actually moving out.
      const rental = rentalOpportunity(p);
      if (rental && rental.home.id !== home.id) moveIntoRental(p, rental);
    }
  }

  // A couple still able to have children shouldn't be stuck forever just
  // because their current home happens to be cramped while a roomier one
  // sits available elsewhere - they swap for free (no purchase, no rent
  // due on the move itself) any time another reachable home has strictly
  // more free space than their own. Ownership isn't disturbed: an owner
  // keeps owning their old place (it simply becomes a rental for whoever
  // ends up there next) and only becomes a tenant of the new one if
  // someone else already owns it.
  function seekMoreRoomForFamily() {
    const couples = town.people.filter(p => p.sex === 'f' && age(p) >= B.adult_age && age(p) <= 50 && p.partner && p.home)
      .map(mother => [mother, person(mother.partner)])
      .filter(([mother, partner]) => partner && partner.home === mother.home);
    for (const [mother, partner] of couples) {
      const home = building(mother.home); if (!home) continue;
      const currentFree = (home.capacity || 2) - (home.residents || []).length;
      let best = null, bestFree = currentFree;
      for (const b of town.buildings) {
        if (b.type !== 'house' || b.id === home.id || (b.built || 0) < 1 || b.target_development) continue;
        if (!buildingRoadAccess(b)) continue;
        const free = (b.capacity || 2) - (b.residents || []).length;
        if (free >= 2 && free > bestFree) { bestFree = free; best = b; }
      }
      if (!best) continue;
      for (const t of [mother, partner]) {
        home.residents = (home.residents || []).filter(id => id !== t.id);
        t.home = best.id; t.inside = best.id; t.rental_home = null; t.goal = null; resetTravel(t);
        if (!best.residents.includes(t.id)) best.residents.push(t.id);
      }
      const empty = (best.residents || []).length === 2; // just the two of them, so it was empty before
      const hasOwner = (best.owners && best.owners.length ? best.owners : [best.owner]).map(person).filter(Boolean).length > 0;
      if (empty && !hasOwner) {
        best.owner = mother.id; best.owners = [mother.id, partner.id];
        for (const t of [mother, partner]) t.history.unshift('lt_hist_invested');
      } else if (!(best.owners && best.owners.length ? best.owners : [best.owner]).includes(mother.id)) {
        mother.rental_home = best.id; partner.rental_home = best.id;
      }
    }
  }

  function privateDecisions() {
    const adult = town.people.filter(p => age(p) >= B.adult_age);
    for (const buyer of adult.filter(p => !p.car && p.inside !== 'waiting').sort((a, b) => b.money - a.money)) {
      if (carOpportunity(buyer)) break;
    }
    // Jobless residents get first crack at a new business (they need the
    // income most), but once everyone already has a job at the one shop in
    // town, nobody was ever even considered again no matter how much they
    // had saved or how cheap a fresh zone was. An already-employed adult
    // with the money can still fund one too - as an investor, not
    // necessarily someone who quits their day job to staff it themselves.
    // Settlers who haven't moved into a home yet ('waiting') must not fund
    // a business before they even have a place to live - they'd otherwise
    // own a shop while still invisible/unsimulated, which looked like the
    // business belonged to nobody. They can only invest once settled.
    const investors = adult.filter(p => p.inside !== 'waiting')
      .sort((a, b) => (a.work ? 1 : 0) - (b.work ? 1 : 0) || b.money - a.money);
    for (const investor of investors) {
      const opportunity = businessOpportunity(investor);
      if (!opportunity) continue;
      if (opportunity.building) buyAbandonedBusiness(investor, opportunity);
      else createPrivate('shop', opportunity.at, investor, opportunity.cost);
      break;
    }
    const couples = adult.filter(p => p.partner && p.id < p.partner)
      .map(p => [p, person(p.partner)]).filter(pair => pair[1] &&
        (!pair[0].home || pair[0].home !== pair[1].home || pair[0].rental_home || pair[1].rental_home));
    for (const couple of couples) {
      const resale = vacantHomePurchase(couple);
      if (resale) { buyVacantHome(couple, resale); break; }
      const opportunity = housingOpportunity(couple);
      if (opportunity) { createPrivate('house', opportunity.at, couple[0], opportunity.cost, couple); break; }
      // Can't afford to buy anywhere together - rent a place together
      // instead of just leaving them split across two homes indefinitely.
      const rental = coupleRentalOpportunity(couple);
      if (rental) { moveCoupleIntoRental(couple, rental); break; }
    }
    const housingSeeker = adult.find(p => (!p.home || p.rental_home) && !p.partner);
    if (housingSeeker) {
      const resale = vacantHomePurchase([housingSeeker]);
      if (resale) buyVacantHome([housingSeeker], resale);
      else {
        const opportunity = housingOpportunity([housingSeeker]);
        if (opportunity) createPrivate('house', opportunity.at, housingSeeker, opportunity.cost, [housingSeeker]);
      }
    }
  }

  function businessCostAt(at) {
    const levels = propertyLevelsInZone('business', at);
    if (!Number.isFinite(levels)) return Infinity;
    return B.private_build_cost.shop * (levels + 1);
  }

  function businessOpportunity(owner) {
    if (!owner) return null;
    const abandoned = town.buildings.filter(b => b.type === 'shop' && b.built >= 1 && !b.target_development &&
      !(b.owners && b.owners.length ? b.owners : [b.owner]).map(person).filter(Boolean).length)
      .map(building => ({ building, cost: businessCostAt(building), tax: (zoneAt(building) || {}).tax_rate || 0 }))
      .filter(option => owner.money >= option.cost)
      .sort((a, b) => a.cost - b.cost || a.tax - b.tax || dist(owner, a.building) - dist(owner, b.building));
    if (abandoned.length) return abandoned[0];
    if (town.buildings.some(b => b.type === 'shop' && b.built < 1)) return null;
    const occupied = new Set(town.buildings.map(b => cellKey(cellAt(b))));
    const levelsCache = new Map();
    const options = town.zones.filter(z => z.kind === 'business' && !occupied.has(cellKey(z)) && !cellHasRoad(z))
      .map(z => {
        const at = cellPoint(z);
        const levels = propertyLevelsInZoneCached('business', at, levelsCache);
        const cost = Number.isFinite(levels) ? B.private_build_cost.shop * (levels + 1) : Infinity;
        return { at, cost, tax: z.tax_rate || 0 };
      })
      .filter(x => owner.money >= x.cost)
      .sort((a, b) => a.cost - b.cost || a.tax - b.tax || dist(owner, a.at) - dist(owner, b.at));
    return options[0] || null;
  }

  function buyAbandonedBusiness(owner, option) {
    const b = option && option.building;
    if (!owner || !b || owner.money < option.cost) return false;
    owner.money -= option.cost; town.treasury += option.cost; econ('income', 'property', option.cost);
    b.owner = owner.id; b.owners = [owner.id];
    owner.history.unshift('lt_hist_invested');
    if (!owner.work && (b.workers || []).length < (b.jobs || 0)) {
      b.workers.push(owner.id); owner.work = b.id; assignShift(owner);
      owner.history.unshift('lt_hist_job');
      addEvent('lt_event_job', { person: owner.name, name: b.name });
    }
    return true;
  }

  function zonedSite(kind) {
    const founder = town.people[0], home = founder && building(founder.home);
    const zones = town.zones.filter(z => z.kind === kind).sort((a, b) => {
      const ap = cellPoint(a), bp = cellPoint(b);
      return ((a.tax_rate || 0) * 1800 + (home ? dist(ap, home) : 0)) -
             ((b.tax_rate || 0) * 1800 + (home ? dist(bp, home) : 0));
    });
    for (const z of zones) {
      const at = cellPoint(z);
      if (!cellHasRoad(z) && !town.buildings.some(b => cellKey(cellAt(b)) === cellKey(z))) return at;
    }
    return null;
  }

  function createPrivate(type, at, owner, quotedCost, coOwners) {
    if (cellHasRoad(cellAt(at))) return null;
    const cost = quotedCost == null ? B.private_build_cost[type] : quotedCost;
    const owners = (coOwners || [owner]).filter(Boolean);
    const combined = owners.reduce((sum, p) => sum + Math.max(0, p.money), 0);
    if (combined < cost) return null;
    for (const personOwner of owners) personOwner.money -= cost * (Math.max(0, personOwner.money) / combined);
    const b = { id: town.next_building++, type, x: at.x, y: at.y, owner: owner.id,
      owners: owners.map(p => p.id), residents: [], workers: [], jobs: type === 'shop' ? 3 : 0,
      wage: type === 'shop' ? 27 : 0, built: .01, builders: [],
      build_days: B.private_build_days[type], build_cost: cost,
      name: type === 'shop' ? owner.name.split(' ')[0] + ' Works' : owner.name.split(' ')[0] + ' House' };
    if (type === 'shop') { b.development = 1; b.total_profit = 0; updateBusinessScale(b); }
    else { b.development = 1; updateHomeScale(b); }
    town.buildings.push(b);
    for (const personOwner of owners) personOwner.history.unshift('lt_hist_invested');
    addEvent('lt_event_started', { person: owner.name, name: b.name });
    return b;
  }

  function occupyHouse(b) {
    const owners = (b.owners || [b.owner]).map(person).filter(Boolean);
    for (const owner of owners) {
      const oldHome = building(owner.home);
      if (oldHome) oldHome.residents = (oldHome.residents || []).filter(id => id !== owner.id);
      owner.home = b.id;
      owner.rental_home = null;
      owner.inside = b.id;
      owner.goal = null; resetTravel(owner);
      if (!b.residents.includes(owner.id)) b.residents.push(owner.id);
    }
  }

  // Categorised treasury flow, so the money panel can show where it comes
  // from and where it goes rather than just the running total. `econToday`
  // accumulates as the day plays out; `econYesterday` is the last fully
  // closed day's snapshot, frozen once newDay() rolls the day over so the
  // panel always shows one complete day instead of a half-finished one.
  function econ(kind, category, amount) {
    if (!amount) return;
    town.econToday = town.econToday || { income: {}, expense: {} };
    const bucket = town.econToday[kind];
    bucket[category] = (bucket[category] || 0) + amount;
  }

  function addEvent(key, vars) {
    town.dayEventCounts = town.dayEventCounts || {};
    town.dayEventCounts[key] = (town.dayEventCounts[key] || 0) + 1;
  }

  function renderEvents() {
    if (!eventButton || !eventLog || !town) return;
    const events = town.events || [];
    const latest = events[0];
    eventButton.classList.toggle('compact', !eventPreviewVisible);
    eventButton.title = tr('lt_events');
    eventButton.innerHTML = '🔔 <span>' + (latest ? esc(tr(latest.key, latest.vars)) : esc(tr('lt_events'))) + '</span>' +
      (unreadEvents ? '<b>' + unreadEvents + '</b>' : '');
    eventLog.innerHTML = '<button data-event-close>×</button><h2>🔔 ' + esc(tr('lt_events')) + '</h2><div>' +
      (events.length ? events.map(event => '<article><time>' + esc(tr('lt_date', { year: event.day + 1, day: 1 })) +
        '</time><p>' + esc(tr(event.key, event.vars)) + '</p></article>').join('') : '<p>' + esc(tr('lt_none')) + '</p>') + '</div>';
    const close = eventLog.querySelector('[data-event-close]');
    if (close) close.onclick = () => eventLog.classList.remove('open');
  }

  function renderHud() {
    if (!town) return;
    // Net jobs balance: open positions minus people actually looking for
    // one, so it goes negative once jobless residents outnumber the open
    // spots instead of just floor-ing out at 0 and hiding the shortage.
    const openJobs = town.buildings.filter(b => b.built >= 1)
      .reduce((n, b) => n + Math.max(0, (b.jobs || 0) - (b.workers || []).length), 0);
    const unemployed = town.people.filter(p => p.inside !== 'waiting' &&
      age(p) >= B.adult_age && age(p) < B.retire_age && !p.work && !ownedShops(p).length).length;
    const jobs = openJobs - unemployed;
    // Same net-balance idea for housing: free beds minus people with
    // nowhere to live, so a housing shortage shows as a negative number
    // instead of silently floor-ing at 0.
    const openHomes = town.buildings.filter(b => b.type === 'house' && b.built >= 1)
      .reduce((n, b) => n + Math.max(0, (b.capacity || 2) - (b.residents || []).length), 0);
    const homeless = town.people.filter(p => p.inside !== 'waiting' && !p.home).length;
    const homes = openHomes - homeless;
    const waiting = town.people.filter(p => p.inside === 'waiting').length;
    hud.innerHTML = '<button data-home title="' + esc(tr('lt_home')) + '">⌂</button>' +
      '<span data-wealth class="lt-clickable" title="' + esc(tr('lt_wealth')) + '"><b>' + town.people.length +
        '</b> ' + esc(tr('lt_people')) + '</span>' +
      (waiting ? '<span data-wealth class="lt-clickable" title="' + esc(tr('lt_wealth')) + '"><b>' + waiting +
        '</b> ' + esc(tr('lt_waiting_settlers')) + '</span>' : '') +
      '<span data-treasury class="lt-clickable" title="' + esc(tr('lt_economy')) + '"><b>' + money(town.treasury) +
        '</b> ' + esc(tr('lt_treasury')) + '</span>' +
      '<span><b>' + (jobs > 0 ? '+' + jobs : jobs) + '</b> ' + esc(tr('lt_jobs')) + '</span>' +
      '<span><b>' + (homes > 0 ? '+' + homes : homes) + '</b> ' + esc(tr('lt_homes_balance')) + '</span><span data-clock>' + esc(fmtDay()) + '</span>' +
      '<label class="lt-speed">⏱<select data-speed>' + Array.from({ length: 10 }, (_, i) => {
        const value = i + 1; return '<option value="' + value + '"' + (value === speed ? ' selected' : '') + '>' + value + '×</option>';
      }).join('') + '</select></label>';
    hud.querySelector('[data-home]').onclick = home;
    for (const el of hud.querySelectorAll('[data-wealth]')) el.onclick = () => { selected = { kind: 'wealth' }; renderPanel(); };
    hud.querySelector('[data-treasury]').onclick = () => { selected = { kind: 'economy' }; renderPanel(); };
    hud.querySelector('[data-speed]').onchange = ev => setSpeed(ev.target.value);
  }

  // Each road tier is a separate construction tool. Existing segments are
  // never repaved in place: select and delete one before drawing its replacement.
  const categoryDefs = [
    ['zone', '🗂️', 'lt_cat_zone'], ['road', '🛣️', 'lt_road'], ['public', '🏛️', 'lt_cat_public'],
    ['transport', '🚌', 'lt_cat_transport'],
  ];
  const subToolDefs = {
    zone: [['residential', '🏠', 'lt_zone_home'], ['business', '🏪', 'lt_zone_business']],
    road: [['road:dirt', '🟫', 'lt_road_type_dirt'], ['road:oneway', '➡️', 'lt_road_type_oneway'],
      ['road:twoway', '↔️', 'lt_road_type_twoway'], ['road:avenue', '🛣️', 'lt_road_type_avenue'],
      ['road:highway', '🏎️', 'lt_road_type_highway'], ['crosswalk', '🚸', 'lt_crosswalk']],
    public: [['clinic', '✚', 'lt_clinic'], ['police', '★', 'lt_police'], ['fire', '🔥', 'lt_fire'], ['park', '🌳', 'lt_park'], ['gym', '🏋️', 'lt_gym']],
    transport: [['busline', '🚌', 'lt_bus_new_line'], ['lines', '📋', 'lt_bus_lines']],
  };
  function categoryOf(m) {
    if (m === 'residential' || m === 'business') return 'zone';
    if (m === 'clinic' || m === 'police' || m === 'fire' || m === 'park' || m === 'gym') return 'public';
    if (m === 'busline' || m === 'busstop' || m === 'lines') return 'transport';
    if (m === 'crosswalk' || m && m.indexOf('road:') === 0) return 'road';
    return null;
  }
  function renderTools() {
    const activeCat = category || categoryOf(mode);
    tools.innerHTML = categoryDefs.map(x => '<button data-cat="' + x[0] + '" class="' + (activeCat === x[0] ? 'on' : '') +
      '"><i>' + x[1] + '</i><span>' + esc(tr(x[2])) + '</span></button>').join('');
    for (const b of tools.querySelectorAll('button')) b.onclick = () => {
      const cat = b.dataset.cat;
      // Clicking a category button - even the one already open - always
      // drops whatever tool was armed. Otherwise closing the panel on a road
      // type left it "loaded": the canvas kept placing pieces on every tap
      // with no visible way to back out short of picking a different tool.
      category = category === cat ? null : cat;
      mode = null; stopLineId = null; pendingBusStop = null; roadHoverCell = null; roadHoverPoint = null; lineDraft = null;
      renderTools(); say('');
    };
    renderSubtools();
  }
  const ROAD_PIECE_DEFS = [['straight', 'lt_piece_straight'], ['corner', 'lt_piece_corner'],
    ['diagonal', 'lt_piece_diagonal'], ['tee', 'lt_piece_tee'], ['cross', 'lt_piece_cross']];
  function constructionPrice(tool) {
    if (tool === 'residential' || tool === 'business') return B.zone_cost || 0;
    if (tool === 'park') return B.park_cost_per_cell;
    if (tool === 'crosswalk' || tool === 'busline' || tool === 'lines') return 0;
    if (tool === 'busstop') return B.bus_stop_cost;
    if (tool && tool.indexOf('road:') === 0) return Math.ceil(CELL * B.road_types[tool.slice(5)].cost);
    return B.admin[tool] ? B.admin[tool].cost : null;
  }
  function priceMarkup(tool) {
    const price = constructionPrice(tool);
    if (price == null) return '';
    const text = price === 0 ? tr('lt_free') : tr(tool === 'residential' || tool === 'business' ?
      'lt_price_each' : 'lt_price', { price: money(price) });
    return '<small style="display:block;opacity:.72;font-size:10px;line-height:1.1;margin-top:2px">' + esc(text) + '</small>';
  }
  // Mini renders of the actual lane banding (ROAD_LAYOUTS/ROAD_COLORS) so the
  // picker shows what will really be built, not an abstract glyph standing
  // in for it.
  function pieceIconSVG(shape, type, rotationDeg) {
    const layout = ROAD_LAYOUTS[type] || ROAD_LAYOUTS.dirt, S = 44, band = S / 6;
    let inner = '';
    if (shape === 'straight') {
      for (let i = 0; i < 6; i++) inner += '<rect x="0" y="' + (i * band).toFixed(1) + '" width="' + S +
        '" height="' + (band + .6).toFixed(1) + '" fill="' + ROAD_COLORS[layout[i]] + '"/>';
    } else if (shape === 'diagonal') {
      const big = S * 1.6;
      inner = '<g transform="translate(' + (S / 2) + ' ' + (S / 2) + ') rotate(-45) translate(' + (-big / 2) + ' ' + (-S / 2) + ')">';
      for (let i = 0; i < 6; i++) inner += '<rect x="0" y="' + (i * band).toFixed(1) + '" width="' + big +
        '" height="' + (band + .6).toFixed(1) + '" fill="' + ROAD_COLORS[layout[i]] + '"/>';
      inner += '</g>';
    } else if (shape === 'corner') {
      for (let i = 0; i < 6; i++) {
        const r = ((i + .5) * band).toFixed(1);
        inner += '<path d="M ' + r + ' 0 A ' + r + ' ' + r + ' 0 0 1 0 ' + r + '" stroke="' + ROAD_COLORS[layout[i]] +
          '" stroke-width="' + (band + .6).toFixed(1) + '" fill="none"/>';
      }
    } else {
      const id = 'lt-' + shape + '-' + type;
      inner = '<defs><clipPath id="' + id + '-n"><polygon points="0,0 ' + S + ',0 ' + (S / 2) + ',' + (S / 2) +
        '"/></clipPath>' + (shape === 'cross' ? '<clipPath id="' + id + '-s"><polygon points="0,' + S + ' ' +
        (S / 2) + ',' + (S / 2) + ' ' + S + ',' + S + '"/></clipPath>' : '') + '</defs>';
      // The horizontal base and the clipped vertical sectors mirror the
      // exact painter used for the full-size junction tile.
      for (let i = 0; i < 6; i++) inner += '<rect x="0" y="' + (i * band).toFixed(1) + '" width="' + S +
        '" height="' + (band + .6).toFixed(1) + '" fill="' + ROAD_COLORS[layout[i]] + '"/>';
      for (let i = 0; i < 6; i++) {
        const x = (S / 2 + (i - 3) * band).toFixed(1);
        inner += '<rect x="' + x + '" y="0" width="' + (band + .6).toFixed(1) + '" height="' + (S / 2) +
          '" fill="' + ROAD_COLORS[layout[i]] + '" clip-path="url(#' + id + '-n)"/>';
        if (shape === 'cross') inner += '<rect x="' + x + '" y="' + (S / 2) + '" width="' +
          (band + .6).toFixed(1) + '" height="' + (S / 2) + '" fill="' + ROAD_COLORS[layout[i]] +
          '" clip-path="url(#' + id + '-s)"/>';
      }
    }
    // The rotation goes on the svg itself, not a wrapping element: the <i>
    // it sits in stretches to the button's full width, so rotating that box
    // instead would swing a wide short rectangle onto its side and push the
    // icon out past the button/menu edge. The svg's own box is a true square,
    // so rotating it in place never shifts its footprint.
    const spin = rotationDeg ? ' style="transform:rotate(' + rotationDeg + 'deg)"' : '';
    return '<svg viewBox="0 0 ' + S + ' ' + S + '" width="26" height="26"' + spin + '><rect width="' + S +
      '" height="' + S + '" fill="#18291f" rx="4"/>' + inner + '</svg>';
  }
  function renderSubtools() {
    const defs = category && subToolDefs[category];
    if (!defs) { subtools.innerHTML = ''; subtools.classList.remove('open'); return; }
    subtools.classList.add('open');
    let html = defs.map(x => '<button data-tool="' + x[0] + '" class="' + (mode === x[0] ? 'on' : '') +
      '"><i>' + x[1] + '</i><span>' + esc(tr(x[2])) + priceMarkup(x[0]) + '</span></button>').join('');
    if (category === 'road' && roadModeType()) {
      const type = roadModeType();
      html += ROAD_PIECE_DEFS.map(x => {
        const length = roadPiecePaths(x[0], roadRotation, { gx: 1, gy: 1 }).reduce((sum, path) => sum + pathLength(path), 0);
        const price = Math.ceil(length * B.road_types[type].cost);
        const priceText = price ? tr('lt_price', { price: money(price) }) : tr('lt_free');
        return '<button data-piece="' + x[0] + '" class="' + (roadShape === x[0] ? 'on' : '') +
          '"><i style="display:flex;justify-content:center">' + pieceIconSVG(x[0], type, roadRotation * 90) + '</i><span>' + esc(tr(x[1])) +
          '<small style="display:block;opacity:.72;font-size:10px;line-height:1.1;margin-top:2px">' + esc(priceText) + '</small></span></button>';
      }).join('') +
        '<button data-rotate><i>⟳</i><span>' + esc(tr('lt_piece_rotate')) + '</span></button>';
    } else if (category === 'road' && mode === 'crosswalk') {
      html += '<button data-rotate><i>⟳</i><span>' + esc(tr('lt_piece_rotate')) + '</span></button>';
    }
    subtools.innerHTML = html;
    for (const b of subtools.querySelectorAll('[data-tool]')) b.onclick = () => {
      roadHoverCell = null; roadHoverPoint = null; lineDraft = null;
      if (b.dataset.tool === 'lines') {
        mode = null; renderTools(); selected = { kind: 'lines' }; renderPanel(); return;
      }
      mode = mode === b.dataset.tool ? null : b.dataset.tool; renderTools();
      say(!mode ? '' : roadModeType() ? tr('lt_tool_hint') : (mode === 'residential' || mode === 'business') ? tr('lt_zone_first') :
        mode === 'busline' ? tr('lt_bus_line_hint') : tr('lt_tool_hint'));
    };
    for (const b of subtools.querySelectorAll('[data-piece]')) b.onclick = () => { roadShape = b.dataset.piece; renderSubtools(); };
    const rotateButton = subtools.querySelector('[data-rotate]');
    if (rotateButton) rotateButton.onclick = () => { roadRotation = (roadRotation + 1) % 4; renderSubtools(); };
  }

  // Placing pieces one per tap means say() can fire on every click in a fast
  // block-by-block run. Without a timeout the message never goes away, so it
  // sits over the very tiles the player is trying to look at while building.
  let sayTimer = 0;
  function say(s) {
    toast.textContent = s || ''; toast.classList.toggle('show', !!s);
    clearTimeout(sayTimer);
    if (s) sayTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }

  function renderPanel() {
    if (!town || !selected) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
    if (town.awaitingNextDay && selected.kind !== 'daySummary') selected = { kind: 'daySummary' };
    panel.classList.add('open');
    if (selected.kind === 'daySummary') {
      const s = town.daySummary;
      if (!s) return closePanel();
      panel.innerHTML = '<h2>📊 ' + esc(tr('lt_day_summary_title', { day: s.day + 1 })) + '</h2>' +
        rows([
          [tr('lt_people'), s.people], [tr('lt_summary_births'), s.births], [tr('lt_summary_deaths'), s.deaths],
          [tr('lt_summary_job_changes'), s.jobs], [tr('lt_summary_building_changes'), s.buildings],
          [tr('lt_summary_purchases'), s.purchases], [tr('lt_summary_cars'), s.cars],
          [tr('lt_income'), money(s.income)], [tr('lt_expense'), money(s.expense)],
          [tr('lt_net'), (s.treasuryAfter - s.treasuryBefore >= 0 ? '+' : '−') + money(Math.abs(s.treasuryAfter - s.treasuryBefore))],
          [tr('lt_treasury'), money(s.treasuryAfter)],
        ]) + '<div class="lt-list"><button data-next-day>▶ ' + esc(tr('lt_start_next_day')) + '</button></div>';
    } else if (selected.kind === 'wealth') {
      const tab = selected.tab || 'wealth';
      const tabsHtml = '<div class="lt-list">' +
        '<button data-wealth-tab="wealth"' + (tab === 'wealth' ? ' class="on"' : '') + '>' + esc(tr('lt_wealth')) + '</button>' +
        '<button data-wealth-tab="couples"' + (tab === 'couples' ? ' class="on"' : '') + '>' + esc(tr('lt_couples')) + '</button>' +
        '</div>';
      let body;
      if (tab === 'couples') {
        const couples = town.people.filter(p => p.partner && p.id < p.partner)
          .map(p => [p, person(p.partner)]).filter(pair => pair[1]);
        // Same eligibility rule formCouples() itself uses (age window,
        // opposite sex, no siblings/parent-child) - shown here so the
        // player can see who's actually matchable, not just who's alone.
        // There's no hard age-gap cutoff any more, only a chance that fades
        // with distance, so "potential" here means "has a shot" (>=1%) -
        // shown alongside that daily chance rather than as a flat yes/no.
        const singles = town.people.filter(p => age(p) >= B.adult_age && age(p) <= 50 && !p.partner);
        const potential = [];
        for (const p of singles) for (const q of singles) {
          if (q.id <= p.id || q.sex === p.sex) continue;
          if ((p.parents || []).includes(q.id) || (q.parents || []).includes(p.id)) continue;
          if ((p.parents || []).some(id => (q.parents || []).includes(id))) continue;
          const chance = Math.max(0, .80 - .025 * Math.abs(age(q) - age(p)));
          if (chance < .01) continue;
          potential.push([p, q, chance]);
        }
        potential.sort((a, b) => b[2] - a[2]);
        const matchedIds = new Set(potential.flatMap(([p, q]) => [p.id, q.id]));
        const unmatched = singles.filter(p => !matchedIds.has(p.id));
        const personTag = p => (p.sex === 'f' ? '♀' : '♂') + ' ' + esc(p.name) + ' (' + age(p) + ')';
        const pairRow = (p, q) => '<button data-person="' + p.id + '"><span>' + personTag(p) + ' + ' + personTag(q) + '</span></button>';
        body = '<h3>' + esc(tr('lt_couples_current')) + '</h3>' +
          (couples.length ? '<div class="lt-list">' + couples.map(([p, q]) => pairRow(p, q)).join('') + '</div>' :
            '<p class="lt-lead">' + esc(tr('lt_none')) + '</p>') +
          '<h3>' + esc(tr('lt_couples_potential')) + '</h3>' +
          (potential.length ? '<div class="lt-list">' + potential.map(([p, q, chance]) =>
            '<button data-person="' + p.id + '"><span>' + personTag(p) + ' + ' + personTag(q) +
            ' · ' + Math.round(chance * 100) + '%</span></button>').join('') + '</div>' :
            '<p class="lt-lead">' + esc(tr('lt_none')) + '</p>') +
          (unmatched.length ? '<h3>' + esc(tr('lt_couples_unmatched')) + '</h3>' +
            '<div class="lt-list">' + unmatched.map(p => '<button data-person="' + p.id + '"><span>' + personTag(p) + '</span></button>').join('') + '</div>' : '');
      } else {
        const ranked = town.people.map(p => [p, netWorth(p), true]);
        // A dead record-holder only stays worth showing until someone
        // currently alive genuinely out-earns them - checked here, on
        // actually opening the ranking, rather than on some daily tick.
        if (town.richest_dead && ranked.some(([, worth]) => worth > town.richest_dead.worth)) town.richest_dead = null;
        if (town.richest_dead) ranked.push([town.richest_dead, town.richest_dead.worth, false]);
        ranked.sort((a, b) => b[1] - a[1]);
        body = '<p class="lt-lead">' + esc(tr('lt_wealth_note')) + '</p>' +
          '<div class="lt-list">' + ranked.map(([p, worth, alive]) =>
            (alive ? '<button data-person="' + p.id + '">' : '<button disabled>') +
            '<i aria-hidden="true">' + (p.sex === 'f' ? '♀' : '♂') + '</i>' +
            '<span>' + (alive ? age(p) : p.age) + ' · ' + esc(p.name) + (alive ? '' : ' ✝ ' + esc(tr(p.sex === 'f' ? 'lt_deceased_f' : 'lt_deceased'))) +
            '</span><b style="margin-left:auto">' + money(worth) + '</b></button>'
          ).join('') + '</div>';
      }
      panel.innerHTML = closeButton() + '<h2>💰 ' + esc(tab === 'couples' ? tr('lt_couples') : tr('lt_wealth')) + '</h2>' +
        tabsHtml + body;
    } else if (selected.kind === 'economy') {
      const econOrder = ['business_tax', 'municipal_tax', 'fares', 'property', 'maintenance', 'wages', 'pension', 'construction'];
      const income = (town.econToday && town.econToday.income) || {};
      const expense = (town.econToday && town.econToday.expense) || {};
      const incomeCats = econOrder.filter(c => income[c]), expenseCats = econOrder.filter(c => expense[c]);
      let body;
      if (!incomeCats.length && !expenseCats.length) {
        body = '<p class="lt-lead">' + esc(tr('lt_econ_none')) + '</p>';
      } else {
        const net = Object.values(income).reduce((s, v) => s + v, 0) - Object.values(expense).reduce((s, v) => s + v, 0);
        body = '<h3>' + esc(tr('lt_income')) + '</h3>' +
          (incomeCats.length ? rows(incomeCats.map(c => [tr('lt_econ_' + c), money(income[c])])) :
            '<p class="lt-lead">' + esc(tr('lt_econ_none')) + '</p>') +
          '<h3>' + esc(tr('lt_expense')) + '</h3>' +
          (expenseCats.length ? rows(expenseCats.map(c => [tr('lt_econ_' + c), money(expense[c])])) :
            '<p class="lt-lead">' + esc(tr('lt_econ_none')) + '</p>') +
          rows([[tr('lt_net'), (net >= 0 ? '+' : '−') + money(Math.abs(net))]]);
      }
      panel.innerHTML = closeButton() + '<h2>💰 ' + esc(tr('lt_economy')) + '</h2>' + body;
    } else if (selected.kind === 'person') {
      const p = person(selected.id); if (!p) return closePanel();
      const h = building(p.home), w = building(p.work);
      const plan = personPlan(p);
      const shops = ownedShops(p);
      const workValue = w ? goToLink('building', w.id, w.name) :
        shops.length === 1 ? goToLink('building', shops[0].id, shops[0].name) :
        shops.length ? esc(tr('lt_owns_n', { n: shops.length })) :
        esc(age(p) >= B.retire_age ? tr('lt_retired') : tr('lt_seeking'));
      const personRows = [
        [tr('lt_home_label'), h ? goToLink('building', h.id, h.name) : esc(tr('lt_none'))],
        [tr('lt_work_label'), workValue],
      ];
      if (p.work) personRows.push([tr('lt_shift'), esc(tr('lt_shift_' + shiftTypeOf(p)))]);
      const partner = p.partner ? person(p.partner) : null;
      personRows.push(
        [tr('lt_partner'), partner ? goToLink('person', partner.id, partner.name) : esc(tr('lt_none'))],
        // "Now" jumps to wherever this same person currently is (a building
        // if inside one, their live position otherwise) - handy to re-center
        // the camera on them after panning away to check a linked building.
        [tr('lt_now'), goToLink('person', p.id, personState(p))],
        [tr('lt_next_plan'), esc(plan.label + (plan.hour == null ? '' : ' · ' + fmtHour(plan.hour)))],
        [tr('lt_children'), esc((p.children || []).length)],
        [tr('lt_happiness'), esc(Math.round(p.happiness ?? B.happiness_start))],
        [tr('lt_health'), esc(Math.round(p.health ?? 100) + '%')],
        [tr('lt_strength'), esc(Math.round(p.strength ?? 0) + '%')],
        [tr('lt_energy'), esc(Math.round(p.energy ?? 100) + '%')],
      );
      panel.innerHTML = closeButton() + '<h2>' + (p.sex === 'f' ? '♀' : '♂') + ' ' + esc(p.name) + '</h2><p class="lt-lead">' +
        esc(tr('lt_person_line', { age: age(p), money: money(p.money) })) + '</p>' + rowsRaw(personRows) +
        '<h3>' + esc(tr('lt_history')) + '</h3><div class="lt-history">' +
        (p.history || []).slice(0, 6).map(k => '<p>' + esc(tr(k)) + '</p>').join('') + '</div>';
    } else if (selected.kind === 'building') {
      const b = building(selected.id); if (!b) return closePanel();
      if (b.type === 'park') {
        const visitors = town.people.filter(p => p.inside === b.id).map(p => p.id);
        panel.innerHTML = closeButton() + '<h2>' + glyph(b.type) + ' ' + esc(b.name) + '</h2>' +
          rows([
            [tr('lt_park_level'), b.level || 1],
            [tr('lt_maintenance'), money(parkMaintenanceCost(b)) + ' / ' + tr('lt_day_short')],
            [tr('lt_park_visitors'), visitors.length],
          ]) + peopleList(visitors, b.id);
      } else {
      const construction = (b.built || 0) < 1 ? (b.built || 0) : (b.target_development ? (b.upgrade_progress || 0) : 1);
      const ownerNames = (b.owners || [b.owner]).map(person).filter(Boolean).map(p => p.name).join(', ');
      const details = [
        [tr('lt_type'), tr('lt_b_' + b.type)], [tr('lt_owner'), ownerNames || tr('lt_municipal')],
        [tr('lt_road'), buildingRoadAccess(b, false) ? '✓' : '✕'],
        [tr('lt_residents'), (b.residents || []).length + (b.type === 'house' ? ' / ' + (b.capacity || 2) : '')],
        [tr('lt_staff'), (b.workers || []).length + ' / ' + (b.jobs || 0)],
        [tr('lt_wage'), b.jobs ? money(b.wage) + ' / ' + tr('lt_day_short') : '—'],
      ];
      if (b.type === 'shop') details.push(
        [tr('lt_development'), b.development || 1],
        [tr('lt_next_level'), money(B.private_build_cost.shop * ((b.development || 1) + 1))],
        [tr('lt_last_profit'), money(b.last_profit)], [tr('lt_last_tax'), money(b.last_tax)],
        [tr('lt_till'), money(b.till || 0)]);
      if (b.type === 'house') details.push(
        [tr('lt_development'), b.development || 1],
        [tr('lt_next_level'), money(B.private_build_cost.house * ((b.development || 1) + 1))]);
      const patients = b.type === 'clinic' ? town.people.filter(p => p.inside === b.id && p.goal && p.goal.kind === 'hospital').map(p => p.id) : [];
      if (b.type === 'clinic') details.push([tr('lt_clinic_patients'), patients.length]);
      const trainees = b.type === 'gym' ? town.people.filter(p => p.inside === b.id && p.goal && p.goal.kind === 'gym').map(p => p.id) : [];
      if (b.type === 'gym') details.push([tr('lt_gym_trainees'), trainees.length]);
      panel.innerHTML = closeButton() + '<h2>' + glyph(b.type) + ' ' + esc(b.name) + '</h2>' +
        (construction < 1 ? '<div class="lt-progress"><i style="width:' + Math.round(construction * 100) + '%"></i></div><p>' +
          esc(tr('lt_building_progress', { n: Math.round(construction * 100) })) + '</p>' : '') +
        rows(details) + peopleList((b.residents || []).concat(b.workers || []).concat(patients).concat(trainees), b.id);
      }
    } else if (selected.kind === 'road') {
      const r = town.roads.find(x => x.id === selected.id); if (!r) return closePanel();
      const type = r.type || 'dirt';
      panel.innerHTML = closeButton() + '<h2>🛣️ ' + esc(tr('lt_road_type_' + type)) + '</h2>' +
        '<p class="lt-lead">' + esc(tr('lt_road_desc_' + type)) + '</p>' +
        rows([[tr('lt_maintenance'), money(roadMaintenanceCost(r)) + ' / ' + tr('lt_day_short')]]) +
        '<h3>' + esc(tr('lt_road_speed')) + '</h3>' +
        '<div class="lt-tax"><button data-speed-road="-5">−</button><b>' + Math.round(r.speed_kmh || 0) + '</b><button data-speed-road="5">+</button></div>' +
        (type === 'oneway' ? '<div class="lt-list"><button data-flip-road>' + esc(tr('lt_road_flip')) +
          ' ' + ((r.dir || 1) >= 0 ? '→' : '←') + '</button></div>' : '') +
        '<div class="lt-list"><button data-delete-road>🗑️ ' + esc(tr('lt_road_delete')) + '</button></div>';
    } else if (selected.kind === 'crosswalk') {
      const c = town.crosswalks.find(x => x.id === selected.id); if (!c) return closePanel();
      panel.innerHTML = closeButton() + '<h2>🚸 ' + esc(tr('lt_crosswalk')) + '</h2>' +
        '<div class="lt-list"><button data-delete-crosswalk>🗑️ ' + esc(tr('lt_crosswalk_delete')) + '</button></div>';
    } else if (selected.kind === 'busstop') {
      const stop = town.busStops.find(x => x.id === selected.id); if (!stop) return closePanel();
      panel.innerHTML = closeButton() + '<h2>🚌 ' + esc(tr('lt_bus_stop')) + '</h2>' +
        '<div class="lt-list"><button data-delete-busstop>🗑️ ' + esc(tr('lt_bus_stop_delete')) + '</button></div>';
    } else if (selected.kind === 'lines') {
      const lines = town.busLines;
      panel.innerHTML = closeButton() + '<h2>🚌 ' + esc(tr('lt_bus_lines')) + '</h2>' +
        (lines.length ? '<div class="lt-line-list">' + lines.map(l => '<div class="lt-line-row"><button data-line="' +
          l.id + '"><i style="color:' + l.color + '">●</i>' + esc(l.name) + '</button><button class="lt-line-delete" data-delete-line="' +
          l.id + '" title="' + escAttr(tr('lt_bus_line_delete')) + '">🗑️</button></div>').join('') + '</div>' :
          '<p class="lt-lead">' + esc(tr('lt_bus_none')) + '</p>');
    } else if (selected.kind === 'line') {
      const l = town.busLines.find(x => x.id === selected.id); if (!l) return closePanel();
      const buses = town.buses.filter(b => b.lineId === l.id);
      const stops = lineStops(l);
      const spec = B.bus_types[l.tier];
      const otherTiers = BUS_TIERS.filter(t => t !== l.tier);
      panel.innerHTML = closeButton() + '<h2 style="color:' + l.color + '">🚌 ' + esc(l.name) + '</h2>' +
        rows([
          [tr('lt_bus_stops_served'), stops.length],
          [tr('lt_bus_fleet'), buses.length],
          [tr('lt_bus_capacity'), tr('lt_bus_tier_' + l.tier) + ' · ' + spec.capacity],
          [tr('lt_maintenance'), money(buses.reduce((sum, b) => sum + busMaintenanceCost(b), 0)) + ' / ' + tr('lt_day_short')],
        ]) +
        (pendingBusStop && pendingBusStop.lineId === l.id ? '<h3>' + esc(tr('lt_bus_stop')) + '</h3><p class="lt-lead">' +
          esc(tr('lt_bus_stop_confirm_price', { price: money(B.bus_stop_cost) })) + '</p><div class="lt-list">' +
          '<button data-confirm-busstop>✓ ' + esc(tr('lt_confirm')) + '</button><button data-cancel-busstop>× ' + esc(tr('lt_cancel')) + '</button></div>' :
          '<p class="lt-lead">' + esc(tr('lt_bus_stop_line_hint')) + '</p>') +
        '<h3>' + esc(tr('lt_bus_manage')) + '</h3><div class="lt-list">' +
        '<button data-buy-bus>' + esc(tr('lt_bus_buy')) + ' · ' + money(spec.cost) + '</button>' +
        (buses.length ? '<button data-remove-bus="' + buses[buses.length - 1].id + '">' + esc(tr('lt_bus_remove')) + '</button>' : '') +
        '</div><h3>' + esc(tr('lt_bus_upgrade_line')) + '</h3><div class="lt-list">' + otherTiers.map(t => {
          const cost = B.bus_types[t].cost * Math.max(1, buses.length), afford = town.treasury >= cost;
          return '<button data-upgrade-line="' + t + '"' + (afford ? '' : ' disabled') + '>' +
            esc(tr('lt_bus_tier_' + t)) + ' · ' + money(cost) + '</button>';
        }).join('') + '</div>';
    } else {
      const cells = zoneCluster(selected.gx, selected.gy);
      if (!cells.length) return closePanel();
      const z = cells[0], pct = Math.round((z.tax_rate || 0) * 100);
      panel.innerHTML = closeButton() + '<h2>' + (z.kind === 'business' ? '🏪 ' : '🏠 ') +
        esc(tr(z.kind === 'business' ? 'lt_zone_business' : 'lt_zone_home')) + '</h2>' +
        rows([[tr('lt_zone_size'), cells.length], [tr('lt_profit_tax'), pct + '%']]) +
        '<div class="lt-tax"><button data-tax="-1">−</button><b>' + pct + '%</b><button data-tax="1">+</button></div>' +
        '<p class="lt-lead">' + esc(tr('lt_tax_help')) + '</p>' +
        '<div class="lt-list"><button data-delete-zone>🗑️ ' + esc(tr('lt_zone_delete')) + '</button></div>';
    }
    const closePanelButton = panel.querySelector('[data-close]');
    if (closePanelButton) closePanelButton.onclick = closePanel;
    const nextDayButton = panel.querySelector('[data-next-day]');
    if (nextDayButton) nextDayButton.onclick = () => {
      town.awaitingNextDay = false; town.daySummary = null; selected = null; paused = false;
      last = performance.now(); renderPanel(); push();
    };
    for (const el of panel.querySelectorAll('[data-tax]')) el.onclick = () => changeZoneTax(selected.gx, selected.gy, +el.dataset.tax);
    const deleteZoneButton = panel.querySelector('[data-delete-zone]');
    if (deleteZoneButton) deleteZoneButton.onclick = () => { deleteZoneCell(selected.gx, selected.gy); closePanel(); };
    for (const el of panel.querySelectorAll('[data-person]')) el.onclick = () => { selected = { kind: 'person', id: +el.dataset.person }; renderPanel(); };
    for (const el of panel.querySelectorAll('[data-wealth-tab]')) el.onclick = () => { selected.tab = el.dataset.wealthTab; renderPanel(); };
    for (const el of panel.querySelectorAll('[data-goto-kind]')) el.onclick = () => goTo(el.dataset.gotoKind, el.dataset.gotoId);
    const deleteRoadButton = panel.querySelector('[data-delete-road]');
    if (deleteRoadButton) deleteRoadButton.onclick = () => deleteRoad(selected.id);
    const deleteCrosswalkButton = panel.querySelector('[data-delete-crosswalk]');
    if (deleteCrosswalkButton) deleteCrosswalkButton.onclick = () => deleteCrosswalk(selected.id);
    const deleteBusStopButton = panel.querySelector('[data-delete-busstop]');
    if (deleteBusStopButton) deleteBusStopButton.onclick = () => deleteBusStop(selected.id);
    for (const el of panel.querySelectorAll('[data-speed-road]')) el.onclick = () => {
      const r = town.roads.find(x => x.id === selected.id); if (!r) return;
      const roads = r.piece_group ? town.roads.filter(x => x.piece_group === r.piece_group) : [r];
      for (const part of roads) part.speed_kmh = Math.max(5, Math.min(150,
        (part.speed_kmh || 0) + parseInt(el.dataset.speedRoad, 10)));
      town.transit_version++; push(); renderPanel();
    };
    const flipButton = panel.querySelector('[data-flip-road]');
    if (flipButton) flipButton.onclick = () => {
      const r = town.roads.find(x => x.id === selected.id); if (!r) return;
      const roads = r.piece_group ? town.roads.filter(x => x.piece_group === r.piece_group) : [r];
      for (const part of roads) part.dir = (part.dir || 1) >= 0 ? -1 : 1;
      town.transit_version++; push(); renderPanel();
    };
    for (const el of panel.querySelectorAll('[data-line]')) el.onclick = () => selectBusLineForStops(+el.dataset.line);
    for (const el of panel.querySelectorAll('[data-delete-line]')) el.onclick = () => deleteBusLine(+el.dataset.deleteLine);
    const confirmBusStopBtn = panel.querySelector('[data-confirm-busstop]');
    if (confirmBusStopBtn) confirmBusStopBtn.onclick = confirmBusStop;
    const cancelBusStopBtn = panel.querySelector('[data-cancel-busstop]');
    if (cancelBusStopBtn) cancelBusStopBtn.onclick = () => { pendingBusStop = null; renderPanel(); draw(); };
    const buyBusBtn = panel.querySelector('[data-buy-bus]');
    if (buyBusBtn) buyBusBtn.onclick = () => buyBus(selected.id);
    const removeBusBtn = panel.querySelector('[data-remove-bus]');
    if (removeBusBtn) removeBusBtn.onclick = () => removeBus(+removeBusBtn.dataset.removeBus);
    for (const el of panel.querySelectorAll('[data-upgrade-line]')) el.onclick = () => upgradeLine(selected.id, el.dataset.upgradeLine);
  }

  function changeZoneTax(gx, gy, delta) {
    const cells = zoneCluster(gx, gy); if (!cells.length) return;
    const rate = Math.max(0, Math.min(.50, (cells[0].tax_rate || 0) + delta / 100));
    for (const z of cells) z.tax_rate = rate;
    push(); renderPanel();
  }

  // A cell someone marks for deletion is only ever offered from the panel
  // when it is selected as an empty zoned cell to begin with, but check
  // again here too in case a building went up on it in the meantime.
  function deleteZoneCell(gx, gy) {
    if (town.buildings.some(b => { const c = cellAt(b); return c.gx === gx && c.gy === gy; })) return;
    town.zones = town.zones.filter(z => !(z.gx === gx && z.gy === gy));
    push(); renderHud();
  }

  function closeButton() { return '<button class="lt-close" data-close>×</button>'; }
  function selectBusLineForStops(id) {
    if (!town.busLines.some(line => line.id === id)) return;
    selected = { kind: 'line', id }; stopLineId = id; pendingBusStop = null; mode = 'busstop'; category = 'transport';
    renderTools(); renderPanel(); say(tr('lt_bus_stop_line_hint')); draw();
  }
  function closePanel() {
    selected = null;
    if (mode === 'busstop') { mode = null; stopLineId = null; pendingBusStop = null; renderTools(); }
    renderPanel(); draw();
  }
  function rows(items) { return '<dl>' + items.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>').join('') + '</dl>'; }
  // Like rows(), but the value is trusted HTML (a goToLink span) instead of
  // plain text - the label is still escaped, callers must escape any value
  // that isn't itself already-safe markup.
  function rowsRaw(items) { return '<dl>' + items.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd></div>').join('') + '</dl>'; }
  function goToLink(kind, id, label) {
    return '<span class="lt-goto" data-goto-kind="' + kind + '" data-goto-id="' + id + '">' + esc(label) + '</span>';
  }
  // Pans the camera to and selects the linked building/person, so clicking
  // "Home", "Work", "Partner" or "Now" in a person's panel jumps straight
  // to and highlights that concrete object instead of just naming it.
  function goTo(kind, id) {
    if (kind === 'building') {
      const b = building(+id); if (!b) return;
      cam.x = b.x; cam.y = b.y; clampCam();
      selected = { kind: 'building', id: b.id };
    } else if (kind === 'person') {
      const target = person(+id); if (!target) return;
      const at = target.inside && building(target.inside) || target;
      cam.x = at.x; cam.y = at.y; clampCam();
      selected = { kind: 'person', id: target.id };
    } else return;
    renderPanel(); draw();
  }
  function peopleList(ids, buildingId) {
    if (!ids.length) return '';
    return '<h3>' + esc(tr('lt_people_here')) + '</h3><div class="lt-list">' + [...new Set(ids)].map(id => {
      const p = person(id); if (!p) return '';
      const present = p.inside === buildingId;
      return '<button data-person="' + id + '" class="' + (present ? 'present' : 'away') + '" title="' +
        escAttr(personState(p)) + '"><i aria-hidden="true">●</i><b aria-label="' + (p.sex === 'f' ? 'female' : 'male') + '">' +
        (p.sex === 'f' ? '♀' : '♂') + '</b><span>' + age(p) + ' · ' + esc(p.name) + '</span></button>';
    }).join('') + '</div>';
  }

  function personState(p) {
    if (p.riding) return tr('lt_riding');
    if (p.waitingAtStop != null) return tr('lt_waiting_bus');
    if (p.inside) { const b = building(p.inside); return b ? tr('lt_inside', { name: b.name }) : tr('lt_idle'); }
    if (!p.goal) return tr('lt_idle');
    return tr('lt_goal_' + p.goal.kind);
  }

  function personPlan(p) {
    const hour = dayPart() * 24;
    if (p.goal && p.goal.kind === 'tour') return { label: tr('lt_goal_tour'), hour: null };
    if (p.goal && p.goal.kind === 'hospital') return { label: tr('lt_goal_hospital'), hour: null };
    if (p.goal && p.goal.kind === 'gym') return { label: tr('lt_goal_gym'), hour: null };
    if (!p.work) {
      if (ownedShops(p).length && p.toured_day !== Math.floor(town.day)) {
        return { label: tr('lt_goal_tour'), hour: 7 };
      }
      return { label: tr('lt_none'), hour: null };
    }
    if (p.inside === p.home) {
      const plan = commutePlanFor(p);
      return { label: tr('lt_work_departure') + ' · ' + tr('lt_plan_' + plan.mode), hour: plan.hour };
    }
    if (p.inside === p.work) {
      const shift = todaysShift(p, town.day);
      if (shift) {
        if (hour < shift.start) return { label: tr('lt_work_starts'), hour: shift.start };
        if (hour < shift.end) return { label: tr('lt_goal_home'), hour: shift.end };
      }
    }
    if (p.goal && p.goal.kind === 'home') return { label: tr('lt_goal_home'), hour: null };
    if (p.goal && p.goal.kind === 'park') return { label: tr('lt_goal_park'), hour: null };
    const plan = commutePlanFor(p);
    return { label: tr('lt_work_departure') + ' · ' + tr('lt_plan_' + plan.mode), hour: plan.hour };
  }

  function glyph(type) { return ({ house: '🏠', shop: '🏪', clinic: '✚', police: '★', fire: '🔥', park: '🌳', gym: '🏋️' })[type] || '▣'; }
  function view() {
    const scale = Math.min(canvas.width, canvas.height) / world() * cam.z;
    return { scale, left: cam.x - canvas.width / scale / 2, top: cam.y - canvas.height / scale / 2 };
  }
  function worldPoint(ev) {
    const r = canvas.getBoundingClientRect(), v = view();
    return { x: v.left + (ev.clientX - r.left) * dpr() / v.scale, y: v.top + (ev.clientY - r.top) * dpr() / v.scale };
  }

  function home() {
    const h = town && town.buildings[0]; cam.x = h ? h.x : world() / 2; cam.y = h ? h.y : world() / 2;
    cam.z = h ? 4.2 : 1.25; draw();
  }

  function onDown(ev) {
    canvas.setPointerCapture(ev.pointerId); pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, camX: cam.x, camY: cam.y, at: worldPoint(ev) }; moved = 0;
  }
  function onMove(ev) {
    if (roadModeType() || mode === 'crosswalk') {
      roadHoverPoint = worldPoint(ev); roadHoverCell = cellAt(roadHoverPoint); draw();
    }
    if (!pointer || pointer.id !== ev.pointerId) return;
    const dx = ev.clientX - pointer.x, dy = ev.clientY - pointer.y; moved = Math.max(moved, Math.hypot(dx, dy));
    const v = view(); cam.x = pointer.camX - dx * dpr() / v.scale; cam.y = pointer.camY - dy * dpr() / v.scale; clampCam();
  }
  function onUp(ev) {
    if (!pointer || pointer.id !== ev.pointerId) return;
    const at = worldPoint(ev);
    if (moved < 8) tap(at);
    pointer = null;
  }
  function onWheel(ev) {
    ev.preventDefault(); const before = worldPoint(ev), factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
    cam.z = Math.max(.85, Math.min(14, cam.z * factor));
    const after = worldPoint(ev); cam.x += before.x - after.x; cam.y += before.y - after.y; clampCam();
  }
  function clampCam() { cam.x = Math.max(0, Math.min(world(), cam.x)); cam.y = Math.max(0, Math.min(world(), cam.y)); }

  function tap(at) {
    if (town.awaitingNextDay) return;
    if (!mode && selected && selected.kind === 'lines') {
      const line = busLineHitTest(at);
      if (line) { selectBusLineForStops(line.id); return; }
    }
    if (mode === 'busline') { tapBusLine(at); return; }
    if (mode === 'busstop') { createBusStop(at); return; }
    if (mode === 'residential' || mode === 'business') {
      createZoneCell(cellAt(at), mode);
      draw(); return;
    }
    if (roadModeType()) {
      placeRoadPiece(cellAt(at), roadModeType(), roadShape, roadRotation);
      draw();
      return;
    }
    if (mode === 'crosswalk') { placeCrosswalk(at, roadRotation); draw(); return; }
    if (['clinic', 'police', 'fire', 'park', 'gym'].includes(mode)) { createAdmin(mode, at); return; }
    let best = null, bd = 32;
    for (const p of town.people) if (!p.inside && dist(p, at) < bd) { bd = dist(p, at); best = { kind: 'person', id: p.id }; }
    for (const b of town.buildings) {
      if (b.type === 'park' && (b.cells || []).some(c => cellKey(c) === cellKey(cellAt(at)))) {
        best = { kind: 'building', id: b.id }; break;
      }
      const hit = (b.type === 'shop' || b.type === 'house') ? 48 + Math.min(10, b.development || 1) * 5 : 48;
      if (dist(b, at) < hit && dist(b, at) < bd + 18) { bd = dist(b, at); best = { kind: 'building', id: b.id }; }
    }
    if (!best) {
      const crossing = town.crosswalks.find(c => dist(crosswalkCenter(c), at) < SUB * 2.4);
      if (crossing) best = { kind: 'crosswalk', id: crossing.id };
    }
    if (!best) {
      const stop = town.busStops.find(s => dist(busStopGeometry(s).point, at) < SUB * 1.6);
      if (stop) best = { kind: 'busstop', id: stop.id };
    }
    if (!best) {
      const hit = roadHitTest(at);
      if (hit) best = { kind: 'road', id: hit.road.id };
    }
    if (!best) {
      const c = cellAt(at), z = town.zones.find(q => q.gx === c.gx && q.gy === c.gy);
      if (z) best = { kind: 'zone', gx: z.gx, gy: z.gy };
    }
    selected = best; renderPanel();
  }

  function placeRoadPiece(cell, type, shape, rotation) {
    const spec = B.road_types[type];
    if (!spec) return false;
    // Building a different road type directly over an existing one replaces
    // it instead of requiring a separate delete step first - the old piece
    // sells back for half of what it would currently cost to build (same
    // rate table, not whatever was originally paid for it), then the new
    // one goes up in its place at full price.
    const existing = town.roads.filter(r => r.cell && r.cell.gx === cell.gx && r.cell.gy === cell.gy);
    let refund = 0;
    if (existing.length) {
      const oldSpec = B.road_types[existing[0].type] || { cost: 0 };
      const oldLength = existing.reduce((sum, r) => sum + pathLength(roadPath(r)), 0);
      refund = Math.floor(Math.ceil(oldLength * oldSpec.cost) / 2);
    }
    if (town.buildings.some(b => b.type === 'park' ?
      (b.cells || []).some(c => c.gx === cell.gx && c.gy === cell.gy) :
      (() => { const bc = cellAt(b); return bc.gx === cell.gx && bc.gy === cell.gy; })())) {
      say(tr('lt_zone_occupied')); return false;
    }
    const paths = roadPiecePaths(shape, rotation, cell);
    const length = paths.reduce((sum, path) => sum + pathLength(path), 0);
    const first = town.roads.length === 0;
    const cost = Math.ceil(length * spec.cost);
    if (town.treasury + refund < cost) { say(tr('lt_no_money_cost', { price: money(cost), have: money(town.treasury + refund) })); return false; }
    if (existing.length) { town.treasury += refund; if (refund) econ('income', 'property', refund); removeRoadPieces(new Set(existing.map(r => r.id))); }
    town.treasury -= cost; econ('expense', 'construction', cost);
    const pieceGroup = 'road-piece-' + town.next_road;
    for (const path of paths) {
      const a = path[0], b = path[path.length - 1], nx = b.x - a.x, ny = b.y - a.y;
      const nl = Math.hypot(nx, ny) || 1;
      town.roads.push({ id: town.next_road++, x1: a.x, y1: a.y, x2: b.x, y2: b.y, path,
        end_dx: nx / nl, end_dy: ny / nl, type, shape, rotation, piece_group: pieceGroup,
        cell: { gx: cell.gx, gy: cell.gy }, dir: 1, speed_kmh: spec.speed_kmh });
    }
    invalidatePedestrianRoutes();
    say(first && type === 'dirt' ? tr('lt_first_road_done') : tr('lt_road_cost', { n: money(cost) }));
    town.transit_version++; push(); renderHud();
    return true;
  }
  function placeCrosswalk(at, rotation) {
    const crossing = crosswalkCandidate(at, rotation);
    if (!crossing) {
      say(tr('lt_crosswalk_need_road')); return false;
    }
    if (town.crosswalks.some(existing => dist(crosswalkCenter(existing), crosswalkCenter(crossing)) < SUB * .75)) {
      say(tr('lt_crosswalk_exists')); return false;
    }
    crossing.id = town.next_crosswalk++;
    if (!crosswalkConnection(crossing, sidewalkSegments(false))) {
      town.next_crosswalk--; say(tr('lt_crosswalk_rotate')); return false;
    }
    town.crosswalks.push(crossing);
    invalidatePedestrianRoutes(); town.transit_version++;
    say(tr('lt_crosswalk_done')); push(); return true;
  }
  // Shared cleanup for removing a set of road pieces (whether from an
  // explicit delete or placeRoadPiece replacing them with a new type):
  // bus lines/buses and cars using them are pulled off, and any crosswalk
  // that no longer connects two sidewalks is dropped too.
  function removeRoadPieces(deleteIds) {
    const affectedLines = town.busLines.filter(line => (line.roadIds || []).some(roadId => deleteIds.has(roadId)));
    const affectedLineIds = new Set(affectedLines.map(line => line.id));
    for (const bus of town.buses.filter(bus => affectedLineIds.has(bus.lineId))) {
      for (const personId of bus.passengers || []) {
        const p = person(personId); if (!p) continue;
        p.riding = null; p.x = bus.x; p.y = bus.y; p.inside = null; resetTravel(p);
      }
    }
    town.buses = town.buses.filter(bus => !affectedLineIds.has(bus.lineId));
    town.busLines = town.busLines.filter(line => !affectedLineIds.has(line.id));
    for (const car of town.cars.filter(car => (car.roadIds || []).some(roadId => deleteIds.has(roadId)))) {
      for (const personId of car.passengers || []) {
        const p = person(personId); if (!p) continue;
        p.riding = null; p.x = car.x; p.y = car.y; p.inside = null; resetTravel(p);
      }
    }
    town.cars = town.cars.filter(car => !(car.roadIds || []).some(roadId => deleteIds.has(roadId)));
    town.roads = town.roads.filter(r => !deleteIds.has(r.id));
    sidewalkCacheVersion = -1; sidewalkCacheBase = null; sidewalkCacheFull = null;
    const remainingSidewalks = sidewalkSegments(false);
    town.crosswalks = town.crosswalks.filter(crossing => !!crosswalkConnection(crossing, remainingSidewalks));
  }
  function deleteRoad(id) {
    const road = town.roads.find(r => r.id === id); if (!road) return;
    const deleteIds = new Set(town.roads.filter(r => road.piece_group && r.piece_group === road.piece_group || r.id === id).map(r => r.id));
    removeRoadPieces(deleteIds);
    invalidatePedestrianRoutes();
    selected = null; town.transit_version++; say(tr('lt_road_deleted')); push(); renderPanel(); renderHud();
  }
  function deleteCrosswalk(id) {
    town.crosswalks = town.crosswalks.filter(c => c.id !== id);
    invalidatePedestrianRoutes(); town.transit_version++;
    selected = null; say(tr('lt_crosswalk_deleted')); push(); renderPanel(); renderHud();
  }
  function deleteBusStop(id) {
    const affected = new Set(town.people.filter(p => p.waitingAtStop === id || p.busBoardStop === id || p.busAlightStop === id).map(p => p.id));
    for (const bus of town.buses) {
      const removed = (bus.passengers || []).filter(personId => affected.has(personId));
      bus.passengers = (bus.passengers || []).filter(personId => !affected.has(personId));
      for (const personId of removed) {
        const p = person(personId); if (!p) continue;
        p.riding = null; p.x = bus.x; p.y = bus.y; p.inside = null;
      }
    }
    for (const p of town.people) if (affected.has(p.id)) {
      p.waitingAtStop = null; resetTravel(p);
    }
    town.busStops = town.busStops.filter(stop => stop.id !== id);
    selected = null; town.transit_version++;
    say(tr('lt_bus_stop_deleted')); push(); renderPanel(); renderHud(); draw();
  }
  // Each tap routes from the previous point along the road network (turns
  // and all), same as a resident would walk it. Tapping back near the start
  // (with at least 4 points already placed) closes the loop and finalizes
  // the line - it will then run forever in that one rotational direction.
  function tapBusLine(at) {
    const preferRoadId = lineDraft && lineDraft.roadIds.length ? lineDraft.roadIds[lineDraft.roadIds.length - 1] : null;
    const anchor = roadAnchor(at, true, preferRoadId);
    if (!anchor) { say(tr('lt_bus_need_road')); return; }
    // A click close to a road endpoint means the junction itself. Keeping a
    // tiny interior offset here creates centre -> offset -> centre detours in
    // the route, which become large diagonal kinks after lane offsetting.
    const endpoints = [{ x: anchor.road.x1, y: anchor.road.y1 }, { x: anchor.road.x2, y: anchor.road.y2 }];
    const nearestEndpoint = endpoints.sort((a, b) => dist(a, anchor.point) - dist(b, anchor.point))[0];
    const point = dist(nearestEndpoint, anchor.point) <= SUB * 1.5 ? nearestEndpoint : anchor.point;
    if (!lineDraft) {
      lineDraft = { points: [point], roadIds: [] };
      say(tr('lt_bus_line_next')); draw(); return;
    }
    const last = lineDraft.points[lineDraft.points.length - 1];
    if (lineDraft.points.length >= 4 && dist(point, lineDraft.points[0]) <= LINE_CLOSE_DIST) {
      const closing = buildRoute(last, lineDraft.points[0], true, preferRoadId);
      if (!closing) { say(tr('lt_bus_no_route')); return; }
      lineDraft.points.push(...closing.points.slice(1));
      lineDraft.roadIds.push(...closing.roadIds);
      finishBusLine();
      return;
    }
    const leg = buildRoute(last, point, true, preferRoadId);
    if (!leg) { say(tr('lt_bus_no_route')); return; }
    lineDraft.points.push(...leg.points.slice(1));
    lineDraft.roadIds.push(...leg.roadIds);
    draw();
  }
  function finishBusLine() {
    const draft = lineDraft; lineDraft = null;
    draft.points.pop(); // drop the duplicate of points[0] the closing leg ends on
    const id = town.next_bus_line++;
    town.busLines.push({ id, name: tr('lt_bus_new_line') + ' ' + id, color: LINE_COLORS[(id - 1) % LINE_COLORS.length],
      points: draft.points, roadIds: draft.roadIds, tier: 'mini' });
    mode = 'busstop'; stopLineId = id; pendingBusStop = null; say(tr('lt_bus_line_done'));
    selected = { kind: 'line', id };
    town.transit_version++; renderTools(); renderPanel(); push();
  }
  function normalizeBusLineGeometry(line) {
    if (!line || !Array.isArray(line.points) || !Array.isArray(line.roadIds)) return;
    // Remove saved A -> B -> A micro-detours produced by older junction
    // snapping. Remove both detour edges while preserving A -> next.
    for (let i = 1; i < line.points.length - 1;) {
      if (dist(line.points[i - 1], line.points[i + 1]) < 1) {
        line.points.splice(i, 2);
        line.roadIds.splice(i - 1, 2);
        if (Array.isArray(line.sides)) line.sides.splice(i - 1, 2);
        i = Math.max(1, i - 1);
      } else i++;
    }
    delete line.sides;
  }
  function createBusStop(at) {
    const line = town.busLines.find(item => item.id === stopLineId);
    if (!line) { mode = null; stopLineId = null; say(tr('lt_bus_stop_select_line')); renderTools(); return; }
    if (pendingBusStop && pendingBusStop.lineId === line.id) {
      const preview = pendingBusStop.stop, platform = busStopGeometry(preview).point;
      if (dist(at, preview) <= SUB * 1.7 || dist(at, platform) <= SUB * 1.7) {
        confirmBusStop(); return;
      }
    }
    const lanePath = joinedBusLanePath(line, true);
    let best = null;
    for (let i = 0; i < line.points.length; i++) {
      const drawnA = lanePath[i], drawnB = lanePath[(i + 1) % lanePath.length];
      const projection = projectToRoad(at, { x1: drawnA.x, y1: drawnA.y, x2: drawnB.x, y2: drawnB.y });
      if (!best || projection.distance < best.distance) best = { seg: i, t: projection.t, distance: projection.distance };
    }
    if (!best || best.distance > SUB * 1.6) { say(tr('lt_bus_stop_line_only')); return; }
    const preview = { id: -1 };
    bindStopToLine(preview, line, best.seg, best.t);
    pendingBusStop = { lineId: line.id, stop: preview };
    say(tr('lt_bus_stop_click_confirm')); renderPanel(); draw();
  }
  function busLineHitTest(at) {
    let best = null;
    for (const line of town.busLines) {
      const path = joinedBusLanePath(line, true);
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const projection = projectToRoad(at, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        if (projection.distance <= SUB * 1.6 && (!best || projection.distance < best.distance)) {
          best = { line, distance: projection.distance };
        }
      }
    }
    return best && best.line;
  }
  function confirmBusStop() {
    if (!pendingBusStop) return;
    const line = town.busLines.find(item => item.id === pendingBusStop.lineId);
    if (!line) { pendingBusStop = null; return; }
    if (town.busStops.some(stop => stop.lineId === line.id && dist(stop, pendingBusStop.stop) < SUB * 1.2)) {
      pendingBusStop = null; say(tr('lt_bus_stop_exists')); renderPanel(); draw(); return;
    }
    if (town.treasury < B.bus_stop_cost) { say(tr('lt_no_money_cost', { price: money(B.bus_stop_cost), have: money(town.treasury) })); return; }
    town.treasury -= B.bus_stop_cost; econ('expense', 'construction', B.bus_stop_cost);
    const stop = { ...pendingBusStop.stop, id: town.next_bus_stop++ };
    town.busStops.push(stop);
    pendingBusStop = null;
    say(tr('lt_bus_stop_done'));
    town.transit_version++; push(); renderHud(); renderPanel(); draw();
  }
  function bindStopToLine(stop, line, seg, t) {
    const a = line.points[seg], b = line.points[(seg + 1) % line.points.length];
    const clampedT = Math.max(.001, Math.min(.999, t));
    stop.lineId = line.id; stop.lineSeg = seg; stop.lineT = clampedT;
    stop.x = a.x + (b.x - a.x) * clampedT; stop.y = a.y + (b.y - a.y) * clampedT;
    stop.roadId = line.roadIds[seg];
    stop.directionAngle = Math.atan2(b.y - a.y, b.x - a.x);
    const road = town.roads.find(r => r.id === stop.roadId);
    if (road) {
      const tangent = roadTangentAt(road, stop);
      const aligned = (b.x - a.x) * tangent.dx + (b.y - a.y) * tangent.dy >= 0;
      // In canvas coordinates (+Y points down), the positive canonical
      // normal is the right-hand side of x1->x2. Reverse-running service
      // therefore uses the opposite outer sidewalk.
      stop.side = aligned ? 1 : -1;
    } else stop.side = 1;
  }
  function roadHitTest(at) {
    let best = null;
    for (const road of town.roads) {
      const spec = roadSpec(road), candidate = projectToRoad(at, road);
      const tolerance = SUB * (spec.width / 2 + .6);
      if (candidate.distance <= tolerance && (!best || candidate.distance < best.distance)) best = candidate;
    }
    return best;
  }
  // Zoning places one cell at a time, same as any building - simpler and
  // more precise than the old drag-a-rectangle tool, and it plays well
  // with zones now being grouped by adjacency (zoneCluster) rather than by
  // which draw action made them: two separate single-cell zonings that end
  // up touching are already the same zone the moment the second lands.
  function createZoneCell(cell, kind) {
    if (town.zones.some(z => z.gx === cell.gx && z.gy === cell.gy) || cellHasPark(cell)) {
      say(tr('lt_zone_occupied')); return;
    }
    const cost = Math.ceil(B.zone_cost || 0);
    if (town.treasury < cost) { say(tr('lt_no_money_cost', { price: money(cost), have: money(town.treasury) })); return; }
    town.treasury -= cost; if (cost) econ('expense', 'construction', cost);
    town.zones.push({ id: town.next_zone++, kind, gx: cell.gx, gy: cell.gy, tax_rate: .10 });
    if (kind === 'business' && !town.buildings.some(b => b.type === 'shop')) {
      const investor = town.people.filter(p => p.inside !== 'waiting').sort((a, b) => b.money - a.money)[0];
      const at = !cellHasRoad(cell) ? cellPoint(cell) : null;
      const bizCost = at ? businessCostAt(at) : Infinity;
      if (at && investor && investor.money >= bizCost) createPrivate('shop', at, investor, bizCost);
    }
    say(tr('lt_zone_done', { n: 1 })); push(); renderHud();
  }
  function createAdmin(type, at) {
    const spec = B.admin[type];
    const cost = spec ? spec.cost : B.park_cost_per_cell;
    at = cellPoint(cellAt(at));
    if (cellHasRoad(cellAt(at)) || cellHasPark(cellAt(at)) ||
        town.buildings.some(b => cellKey(cellAt(b)) === cellKey(cellAt(at)))) {
      say(tr('lt_zone_occupied')); return;
    }
    if (town.treasury < cost) return say(tr('lt_no_money_cost', { price: money(cost), have: money(town.treasury) }));
    town.treasury -= cost; econ('expense', 'construction', cost);
    if (type === 'park') {
      // A park is now a single building like any other municipal one - it
      // must sit on a road-connected cell for residents to actually reach
      // it (see drawBuildingAccessIndicators), instead of being a drawn
      // zone that could end up stranded in the middle of a block.
      town.buildings.push({ id: town.next_building++, type: 'park', x: at.x, y: at.y, owner: null,
        residents: [], workers: [], jobs: 0, built: 1, level: 1, cost, cells: [cellAt(at)],
        name: tr('lt_b_park') });
    } else {
      town.buildings.push({ id: town.next_building++, type, x: at.x, y: at.y, owner: null,
        residents: [], workers: [], jobs: spec.jobs, wage: spec.wage, built: 1,
        name: tr('lt_b_' + type), capacity: spec.jobs * 2 });
    }
    mode = null; fillJobs(); renderTools(); renderHud(); push();
  }

  function zoneOverlayVisible() {
    if (category === 'zone' || category === 'road' || roadModeType() ||
        mode === 'residential' || mode === 'business') return true;
    if (!selected) return false;
    if (selected.kind === 'zone') return true;
    return selected.kind === 'building' && building(selected.id) && building(selected.id).type === 'park';
  }

  function draw() {
    if (!g || !town) return;
    const v = view(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#18291f'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.save(); g.translate(-v.left * v.scale, -v.top * v.scale); g.scale(v.scale, v.scale);
    drawGrid(v);
    const showZones = zoneOverlayVisible();
    if (showZones) {
      for (const z of town.zones) {
        g.fillStyle = z.kind === 'residential' ? 'rgba(111,203,137,.25)' : 'rgba(105,165,255,.25)';
        g.fillRect(z.gx * CELL + 2, z.gy * CELL + 2, CELL - 4, CELL - 4);
      }
    }
    g.lineCap = 'round';
    const drawnRoadGroups = new Set();
    for (const r of town.roads) {
      if (r.piece_group && (r.shape === 'tee' || r.shape === 'cross')) {
        if (drawnRoadGroups.has(r.piece_group)) continue;
        drawnRoadGroups.add(r.piece_group);
        drawIntersectionPiece(town.roads.filter(part => part.piece_group === r.piece_group));
      } else drawRoad(r);
    }
    for (const crossing of town.crosswalks) drawCrosswalk(crossing);
    // Transit keeps running in the background, but route overlays are a
    // planning aid: show all routes in the line list and only the selected
    // route in its detail view. The normal town view stays uncluttered.
    const visibleLines = selected && selected.kind === 'lines' ? town.busLines :
      selected && selected.kind === 'line' ? town.busLines.filter(line => line.id === selected.id) : [];
    for (const line of visibleLines) drawBusLinePath(line);
    for (const b of town.buildings) drawBuilding(b);
    drawBuildingAccessIndicators();
    for (const stop of town.busStops) drawBusStop(stop);
    if (pendingBusStop) drawBusStop(pendingBusStop.stop);
    drawPeople();
    for (const car of town.cars) drawCar(car);
    for (const bus of town.buses) drawBus(bus, town.busLines.find(l => l.id === bus.lineId));
    drawSelection();
    if (lineDraft) drawLineDraft();
    drawRoadPreview();
    g.restore();
  }
  function drawRoad(r) {
    const type = r.type || 'dirt';
    const curvedPath = roadPath(r);
    if (curvedPath.length > 2) {
      const layout = ROAD_LAYOUTS[type] || ROAD_LAYOUTS.dirt;
      g.save(); g.lineCap = 'butt'; g.lineJoin = 'round';
      for (let i = 0; i < 6; i++) {
        const offset = (i - 2.5) * SUB, shifted = [];
        for (let j = 0; j < curvedPath.length; j++) {
          const before = curvedPath[Math.max(0, j - 1)], after = curvedPath[Math.min(curvedPath.length - 1, j + 1)];
          const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
          shifted.push({ x: curvedPath[j].x - dy / length * offset, y: curvedPath[j].y + dx / length * offset });
        }
        g.strokeStyle = ROAD_COLORS[layout[i]]; g.lineWidth = SUB + .35;
        g.beginPath(); g.moveTo(shifted[0].x, shifted[0].y);
        for (const point of shifted.slice(1)) g.lineTo(point.x, point.y);
        g.stroke();
      }
      drawCurvedRoadArrows(r, curvedPath);
      g.restore(); return;
    }
    const dx = r.x2 - r.x1, dy = r.y2 - r.y1, len = Math.hypot(dx, dy) || .001;
    g.save(); g.translate((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2); g.rotate(Math.atan2(dy, dx));
    const half = len / 2;
    const layout = ROAD_LAYOUTS[type] || ROAD_LAYOUTS.dirt;
    for (let i = 0; i < 6; i++) {
      const y = (i - 3) * SUB;
      g.fillStyle = ROAD_COLORS[layout[i]]; g.fillRect(-half, y, len, SUB + .25);
    }
    // Right-hand traffic: the higher-index (right-hand) half of the road
    // carries "forward" (x1->x2) traffic, so its arrows point forward (+1)
    // and the lower-index (left-hand) half's arrows point backward (-1).
    const laneRows = type === 'oneway' ? [[2, (r.dir || 1) >= 0 ? 1 : -1], [3, (r.dir || 1) >= 0 ? 1 : -1]] :
      type === 'twoway' ? [[1, -1], [4, 1]] : type === 'avenue' ? [[1, -1], [2, -1], [3, 1], [4, 1]] :
      type === 'highway' ? [[0, -1], [1, -1], [2, -1], [3, 1], [4, 1], [5, 1]] : [];
    for (const lane of laneRows) drawArrowRow((lane[0] - 2.5) * SUB, len, SUB * 3.2, lane[1]);
    g.restore();
  }

  function drawCrosswalk(crossing, previewColor) {
    // Visual only - kept as wide as a single sidewalk square (SUB) and
    // pulled in short of the sidewalks themselves (which sit at +-2.5*SUB,
    // see crosswalkConnection) so the painted stripes stay inside the road
    // and never appear to spill onto the sidewalk paving. The actual
    // walkable connection geometry (crosswalkConnection/crosswalkCandidate)
    // is untouched, so this doesn't change who can use the crossing.
    const center = crosswalkCenter(crossing);
    g.save(); g.translate(center.x, center.y); g.rotate((crossing.rotation || 0) * Math.PI / 2);
    g.fillStyle = previewColor || 'rgba(245,245,235,.92)';
    for (let y = -SUB * 1.9; y <= SUB * 1.9; y += SUB * .72) {
      g.fillRect(-SUB * .5, y - SUB * .14, SUB, SUB * .28);
    }
    g.restore();
  }

  function drawIntersectionPiece(parts) {
    const road = parts[0]; if (!road || !road.cell) return;
    const type = road.type || 'dirt', layout = ROAD_LAYOUTS[type] || ROAD_LAYOUTS.dirt;
    const center = cellPoint(road.cell), half = CELL / 2;
    const drawBand = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length, ny = dx / length;
      g.lineCap = 'butt'; g.lineJoin = 'miter';
      for (let i = 0; i < 6; i++) {
        const offset = (i - 2.5) * SUB;
        g.strokeStyle = ROAD_COLORS[layout[i]]; g.lineWidth = SUB + .35;
        g.beginPath(); g.moveTo(x1 + nx * offset, y1 + ny * offset);
        g.lineTo(x2 + nx * offset, y2 + ny * offset); g.stroke();
      }
    };
    const clipTriangle = points => {
      g.beginPath(); g.moveTo(points[0][0], points[0][1]);
      for (const point of points.slice(1)) g.lineTo(point[0], point[1]);
      g.closePath(); g.clip();
    };
    g.save(); g.translate(center.x, center.y); g.rotate((road.rotation || 0) * Math.PI / 2);
    // West/east is the base road. The northern and (for a four-way piece)
    // southern arms are clipped to their own triangular sectors, so no full
    // width road is painted twice over another one.
    drawBand(-half, 0, half, 0);
    g.save(); clipTriangle([[-half, -half], [half, -half], [0, 0]]);
    drawBand(0, -half, 0, 0); g.restore();
    if (road.shape === 'cross') {
      g.save(); clipTriangle([[-half, half], [0, 0], [half, half]]);
      drawBand(0, 0, 0, half); g.restore();
    }
    // Medians and grass strips end before a junction. The central conflict
    // area is continuous asphalt, otherwise later-painted perpendicular
    // bands overwrite the earlier carriageway and leave a green hole where
    // vehicles are meant to turn or cross. Keep the outer sidewalk corners
    // intact by filling only the four inner strips.
    if (type !== 'dirt') {
      g.fillStyle = ROAD_COLORS.asphalt;
      g.fillRect(-SUB * 2, -SUB * 2, SUB * 4, SUB * 4);
    }
    g.restore();
  }

  function drawCurvedRoadArrows(road, points) {
    const type = road.type || 'dirt';
    const lanes = type === 'oneway' ? [[2, (road.dir || 1) >= 0 ? 1 : -1], [3, (road.dir || 1) >= 0 ? 1 : -1]] :
      type === 'twoway' ? [[1, -1], [4, 1]] : type === 'avenue' ? [[1, -1], [2, -1], [3, 1], [4, 1]] :
      type === 'highway' ? [[0, -1], [1, -1], [2, -1], [3, 1], [4, 1], [5, 1]] : [];
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let index = 3; index < points.length - 2; index += 5) {
      const before = points[index - 1], after = points[index + 1], dx = after.x - before.x, dy = after.y - before.y;
      const length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
      for (const lane of lanes) {
        const sign = lane[1], offset = (lane[0] - 2.5) * SUB;
        const x = points[index].x + nx * offset, y = points[index].y + ny * offset, size = SUB * .48;
        g.beginPath(); g.moveTo(x + ux * size * sign, y + uy * size * sign);
        g.lineTo(x - ux * size * .5 * sign + nx * size * .5, y - uy * size * .5 * sign + ny * size * .5);
        g.lineTo(x - ux * size * .5 * sign - nx * size * .5, y - uy * size * .5 * sign - ny * size * .5);
        g.closePath(); g.fill();
      }
    }
  }

  function drawSelection() {
    if (!selected) return;
    g.save();
    g.strokeStyle = '#ffd166'; g.lineWidth = 2.5; g.setLineDash([5, 4]);
    g.shadowColor = 'rgba(255,209,102,.85)'; g.shadowBlur = 7;
    const outlineCell = cell => g.strokeRect(cell.gx * CELL + 2, cell.gy * CELL + 2, CELL - 4, CELL - 4);
    if (selected.kind === 'person') {
      const p = person(selected.id); if (!p) { g.restore(); return; }
      if (p.inside && building(p.inside)) outlineCell(cellAt(building(p.inside)));
      else { g.beginPath(); g.arc(p.x, p.y, SUB * .62, 0, Math.PI * 2); g.stroke(); }
    } else if (selected.kind === 'building') {
      const b = building(selected.id); if (!b) { g.restore(); return; }
      if (b.type === 'park') for (const cell of (b.cells || [cellAt(b)])) outlineCell(cell);
      else outlineCell(cellAt(b));
    } else if (selected.kind === 'road') {
      const road = town.roads.find(r => r.id === selected.id);
      if (road) {
        // Follow the road's actual path point by point, not just a straight
        // line between its two ends - a corner piece's endpoints are joined
        // by an arc, and a chord between them cuts across the turn.
        const points = roadPath(road), width = CELL;
        for (const side of [-1, 1]) {
          g.beginPath();
          for (let i = 0; i < points.length; i++) {
            const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
            const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
            const ox = -dy / length * (width / 2 + 2), oy = dx / length * (width / 2 + 2);
            const p = { x: points[i].x + ox * side, y: points[i].y + oy * side };
            if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
          }
          g.stroke();
        }
      }
    } else if (selected.kind === 'crosswalk') {
      const c = town.crosswalks.find(x => x.id === selected.id);
      if (c) { const center = crosswalkCenter(c); g.beginPath(); g.arc(center.x, center.y, SUB * 2, 0, Math.PI * 2); g.stroke(); }
    } else if (selected.kind === 'busstop') {
      const stop = town.busStops.find(x => x.id === selected.id);
      if (stop) { const point = busStopGeometry(stop).point; g.beginPath(); g.arc(point.x, point.y, SUB * 1.35, 0, Math.PI * 2); g.stroke(); }
    } else if (selected.kind === 'zone') {
      for (const cell of zoneCluster(selected.gx, selected.gy)) outlineCell(cell);
    }
    g.restore();
    if (selected.kind === 'zone') drawZonePrices(selected.gx, selected.gy);
  }

  // On a selected zone, label every still-empty, buildable cell with what
  // it would currently cost to build there - the price a resident would
  // actually pay depends on how developed the zone already is, so it is
  // not one flat number and is worth showing per cell.
  function drawZonePrices(gx, gy) {
    const cells = zoneCluster(gx, gy);
    if (!cells.length) return;
    const kind = cells[0].kind;
    g.save();
    g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const cell of cells) {
      if (cellHasRoad(cell) || town.buildings.some(b => cellKey(cellAt(b)) === cellKey(cell))) continue;
      const at = cellPoint(cell);
      const cost = kind === 'business' ? businessCostAt(at) : homeCostAt(at);
      if (!Number.isFinite(cost)) continue;
      const label = money(cost);
      const width = g.measureText(label).width + 10;
      g.fillStyle = 'rgba(12,18,15,.85)';
      g.fillRect(at.x - width / 2, at.y - 9, width, 18);
      g.fillStyle = '#ffd166';
      g.fillText(label, at.x, at.y);
    }
    g.restore();
  }

  function drawBuildingAccessIndicators() {
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of town.buildings) {
      if ((b.built || 0) < 1) continue;
      const access = buildingRoadAccess(b, false);
      const isSelected = selected && selected.kind === 'building' && selected.id === b.id;
      if (!access) {
        g.fillStyle = '#e63946'; g.strokeStyle = '#4a0d12'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(b.x + CELL * .32, b.y - CELL * .32, SUB * .58, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(SUB * .72) + 'px system-ui';
        g.fillText('!', b.x + CELL * .32, b.y - CELL * .32 + .4);
      } else if (isSelected) {
        // Connected is the normal case, so only show the green road-link
        // indicator (and the line to the actual connected road) while the
        // building is selected - it doesn't need to clutter the map at
        // rest. A park has no fixed 'entrance' side like other buildings
        // (it connects from whichever edge of its cell faces the road), so
        // it draws the same line/mark from its own centre point instead.
        const from = access.entrance || { x: b.x, y: b.y };
        g.strokeStyle = '#6fdb89'; g.lineWidth = 3; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(access.point.x, access.point.y); g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#36b85a'; g.strokeStyle = '#173f25'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(from.x, from.y, SUB * .58, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(SUB * .7) + 'px system-ui';
        g.fillText('✓', from.x, from.y + .3);
      }
    }
    g.restore();
  }
  // Drawn in the road's own rotated local frame (x runs along the road from
  // x1,y1 to x2,y2), so sign +1/-1 simply means "points toward x2,y2 or x1,y1".
  function drawArrowRow(cy, len, spacing, sign) {
    const half = len / 2, size = SUB * .5;
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let x = -half + spacing * .5; x < half - spacing * .3; x += spacing) {
      g.beginPath();
      g.moveTo(x + size * sign, cy);
      g.lineTo(x - size * .5 * sign, cy - size * .5);
      g.lineTo(x - size * .5 * sign, cy + size * .5);
      g.closePath(); g.fill();
    }
  }
  // A bus always cruises the outermost right-hand lane (see
  // vehicleDrawPosition), so any drawn route - the finished line and the
  // in-progress draft alike - should trace that same lane per segment
  // instead of the road's centerline. Segments are offset independently
  // since two segments through the same point can want different offsets
  // (different road, or opposite direction on a loop).
  // The route direction alone selects the outermost right-hand lane. Click
  // position never changes sides: the line must match the lane used by buses.
  function laneOffsetPoints(a, b, roadId) {
    const road = roadId != null && town.roads.find(r => r.id === roadId);
    if (!road) return [a, b];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    // This segment's own a->b direction may run either the same way as the
    // road's canonical x1->x2 or opposite it. The chosen physical side
    // must stay the same regardless, so an opposite-running segment needs
    // the complementary strip set to land on the same side once shifted
    // along its (also reversed) local direction.
    const alignedWithRoad = dx * (road.x2 - road.x1) + dy * (road.y2 - road.y1) >= 0;
    const high = alignedWithRoad;
    const strips = laneStripsAhead(road.type || 'dirt', high);
    const strip = high ? strips[strips.length - 1] : strips[0];
    const offset = (strip - 2.5) * SUB;
    // Strip indices belong to the road's canonical x1->x2 coordinate frame.
    // When the route traverses the road backwards, its tangent is reversed;
    // using that reversed tangent to apply a canonical strip offset mirrors
    // the result into the oncoming lane. Keep the normal canonical too.
    const laneDx = alignedWithRoad ? dx : -dx, laneDy = alignedWithRoad ? dy : -dy;
    const shift = p => ({ x: p.x - laneDy / len * offset, y: p.y + laneDx / len * offset });
    return [shift(a), shift(b)];
  }
  function offsetLineIntersection(a, b, c, d) {
    const abx = b.x - a.x, aby = b.y - a.y, cdx = d.x - c.x, cdy = d.y - c.y;
    const cross = abx * cdy - aby * cdx;
    if (Math.abs(cross) < 1e-5) return null;
    const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / cross;
    return { x: a.x + abx * t, y: a.y + aby * t };
  }
  // Convert independently offset lane segments into one continuous lane
  // centreline. Adjacent segments meet at their geometric intersection, so
  // bends and junctions have no cracks or sideways jumps. A capped midpoint
  // fallback handles parallel and U-turn segments without producing a huge
  // miter outside the road cell.
  function joinedBusLanePath(line, closed) {
    const count = closed ? line.points.length : Math.max(0, line.points.length - 1);
    if (!count) return line.points.slice();
    const segments = [];
    for (let i = 0; i < count; i++) {
      const a = line.points[i], b = line.points[(i + 1) % line.points.length];
      segments.push(laneOffsetPoints(a, b, line.roadIds[i]));
    }
    const join = (previous, next, raw) => {
      const intersection = offsetLineIntersection(previous[0], previous[1], next[0], next[1]);
      if (intersection && dist(intersection, raw) <= CELL * .8) return intersection;
      return { x: (previous[1].x + next[0].x) / 2, y: (previous[1].y + next[0].y) / 2 };
    };
    if (!closed) {
      const result = [segments[0][0]];
      for (let i = 1; i < segments.length; i++) result.push(join(segments[i - 1], segments[i], line.points[i]));
      result.push(segments[segments.length - 1][1]);
      return result;
    }
    return segments.map((segment, i) => join(segments[(i - 1 + count) % count], segment, line.points[i]));
  }
  function drawBusLinePath(line) {
    if (line.points.length < 2) return;
    const path = joinedBusLanePath(line, true);
    g.save(); g.strokeStyle = line.color; g.globalAlpha = .55; g.lineWidth = 3; g.setLineDash([2, 6]);
    g.beginPath(); g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    g.closePath(); g.stroke(); g.restore();
  }
  function drawBusStop(stop) {
    const geometry = busStopGeometry(stop), p = geometry.point;
    g.save(); g.translate(p.x, p.y); g.rotate(geometry.angle);
    g.fillStyle = 'rgba(255,209,102,.24)'; g.strokeStyle = '#ffd166'; g.lineWidth = Math.max(1.2, SUB * .12);
    g.beginPath(); g.rect(-SUB * 1.05, -SUB * .35, SUB * 2.1, SUB * .7); g.fill(); g.stroke();
    g.fillStyle = '#fff3bf'; g.font = '900 ' + Math.round(SUB * .42) + 'px system-ui';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', -SUB * .18, SUB * .02);
    g.fillStyle = '#ffd166'; g.beginPath();
    g.moveTo(SUB * .92, 0); g.lineTo(SUB * .58, -SUB * .22); g.lineTo(SUB * .58, SUB * .22); g.closePath(); g.fill();
    g.restore();
  }
  function drawCar(car) {
    const r = SUB * .32;
    const pos = vehicleDrawPosition(car, car.roadIds && car.roadIds[car.seg], car.points && car.points[car.seg], car.points && car.points[car.seg + 1]);
    g.save(); g.fillStyle = car.color; g.strokeStyle = '#111'; g.lineWidth = 1;
    g.fillRect(pos.x - r, pos.y - r * .6, r * 2, r * 1.2); g.strokeRect(pos.x - r, pos.y - r * .6, r * 2, r * 1.2);
    g.restore();
  }
  function drawBus(bus, line) {
    const color = line ? line.color : '#888';
    const seg = line && bus.seg % line.points.length;
    let pos = { x: bus.x, y: bus.y }, angle = 0;
    if (line && line.points.length > 1) {
      const path = joinedBusLanePath(line, true), a = path[seg], b = path[(seg + 1) % path.length];
      pos = { x: a.x + (b.x - a.x) * bus.segT, y: a.y + (b.y - a.y) * bus.segT };
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
    const tier = bus.tier || line && line.tier || 'mini';
    const length = SUB * (tier === 'double' ? 3.15 : tier === 'standard' ? 2.65 : 2.15);
    const width = SUB * .72, left = -length / 2, top = -width / 2;
    g.save(); g.translate(pos.x, pos.y); g.rotate(angle);
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = SUB * .16; g.shadowOffsetY = SUB * .1;
    g.fillStyle = color; g.strokeStyle = '#16191b'; g.lineWidth = Math.max(1, SUB * .09);
    g.beginPath(); g.roundRect(left, top, length, width, SUB * .18); g.fill(); g.stroke();
    g.shadowColor = 'transparent';
    // The windscreen and headlights are at +X: this makes the front visibly
    // point in the actual direction of travel after the canvas is rotated.
    g.fillStyle = '#bfe9f4'; g.fillRect(length * .23, top + SUB * .1, length * .18, width - SUB * .2);
    g.fillStyle = '#263841';
    for (let x = left + SUB * .45; x < length * .16; x += SUB * .48) {
      g.fillRect(x, top + SUB * .08, SUB * .31, SUB * .15);
      g.fillRect(x, -top - SUB * .23, SUB * .31, SUB * .15);
    }
    g.fillStyle = '#fff4b8';
    g.fillRect(length / 2 - SUB * .08, top + SUB * .08, SUB * .08, SUB * .13);
    g.fillRect(length / 2 - SUB * .08, -top - SUB * .21, SUB * .08, SUB * .13);
    g.fillStyle = '#e03131';
    g.fillRect(left, top + SUB * .08, SUB * .07, SUB * .13);
    g.fillRect(left, -top - SUB * .21, SUB * .07, SUB * .13);
    g.fillStyle = '#f8f9fa'; g.beginPath();
    g.moveTo(length * .08, 0); g.lineTo(-SUB * .08, -SUB * .16); g.lineTo(-SUB * .08, SUB * .16); g.closePath(); g.fill();
    g.restore();
  }
  function vehicleDrawPosition(vehicle, roadId, from, to) {
    const road = town.roads.find(r => r.id === roadId);
    if (!road || !from || !to) return { x: vehicle.x, y: vehicle.y };
    const type = road.type || 'dirt', roadDx = road.x2 - road.x1, roadDy = road.y2 - road.y1;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
    const forward = dx * roadDx + dy * roadDy >= 0;
    // Strip index rises left-to-right across the lane-offset axis (see the
    // offset formula below), so the higher-index half of the road is the
    // right-hand side in the direction of travel. Right-hand traffic means
    // "forward" (x1->x2) keeps to that higher half, "backward" to the lower.
    const strips = laneStripsAhead(type, forward);
    // Buses always cruise the outermost right-hand lane. A car uses its own
    // simulated lane ('left' while overtaking, 'right' otherwise) so what's
    // drawn matches what updateCarLane() actually decided, instead of just
    // spreading cars out cosmetically.
    const isBus = vehicle.lineId != null;
    const cruiseStrip = forward ? strips[strips.length - 1] : strips[0];
    const passStrip = forward ? strips[0] : strips[strips.length - 1];
    const strip = isBus ? cruiseStrip : (vehicle.lane === 'left' ? passStrip : cruiseStrip);
    const offset = (strip - 2.5) * SUB;
    const laneDx = forward ? dx : -dx, laneDy = forward ? dy : -dy;
    return { x: vehicle.x - laneDy / len * offset, y: vehicle.y + laneDx / len * offset };
  }
  function drawLineDraft() {
    if (!lineDraft || !lineDraft.points.length) return;
    const path = joinedBusLanePath(lineDraft, false);
    g.save(); g.strokeStyle = '#ffd166'; g.lineWidth = 3; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd166';
    for (const p of path) { g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  function drawRoadPreview() {
    const type = roadModeType();
    if (mode === 'crosswalk' && roadHoverPoint) {
      const candidate = crosswalkCandidate(roadHoverPoint, roadRotation) ||
        { x: roadHoverPoint.x, y: roadHoverPoint.y, rotation: roadRotation % 2 };
      const duplicate = town.crosswalks.some(c => dist(crosswalkCenter(c), crosswalkCenter(candidate)) < SUB * .75);
      const valid = !duplicate && !!crosswalkConnection(candidate, sidewalkSegments(false));
      g.save(); g.globalAlpha = .8; drawCrosswalk(candidate, valid ? '#ffd166' : '#e74c3c'); g.restore();
      return;
    }
    if (!type || !roadHoverCell) return;
    const spec = B.road_types[type];
    if (!spec) return;
    const cell = roadHoverCell;
    const blocked = cellHasRoad(cell) || town.buildings.some(b => b.type === 'park' ?
      (b.cells || []).some(c => c.gx === cell.gx && c.gy === cell.gy) :
      (() => { const bc = cellAt(b); return bc.gx === cell.gx && bc.gy === cell.gy; })());
    const paths = roadPiecePaths(roadShape, roadRotation, cell);
    g.save(); g.globalAlpha = .6; g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = blocked ? '#e74c3c' : '#ffd166'; g.lineWidth = CELL * .62;
    for (const path of paths) {
      g.beginPath(); g.moveTo(path[0].x, path[0].y);
      for (const p of path.slice(1)) g.lineTo(p.x, p.y);
      g.stroke();
    }
    g.restore();
  }
  function line(r) { g.beginPath(); g.moveTo(r.x1, r.y1); g.lineTo(r.x2, r.y2); g.stroke(); }
  function drawGrid(v) {
    g.lineWidth = 1 / v.scale;
    for (let x = 0, n = 0; x <= world(); x += SUB, n++) {
      g.strokeStyle = n % 6 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.10)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, world()); g.stroke();
    }
    for (let y = 0, n = 0; y <= world(); y += SUB, n++) {
      g.strokeStyle = n % 6 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.10)';
      g.beginPath(); g.moveTo(0, y); g.lineTo(world(), y); g.stroke();
    }
  }
  function drawBuilding(b) {
    const rawProgress = (b.built || 0) < 1 ? (b.built || 0) : (b.target_development ? (b.upgrade_progress || 0) : 1);
    const progress = Math.max(0, Math.min(1, rawProgress));
    if (b.type === 'park') { drawPark(b); return; }
    if (b.type === 'shop') { drawBusiness(b, progress); return; }
    if (b.type === 'house') { drawHome(b, progress); return; }
    g.save(); g.globalAlpha = .35 + progress * .65;
    g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 8; g.shadowOffsetY = 5;
    g.font = (b.type === 'house' ? '48px' : '54px') + ' system-ui';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(glyph(b.type), b.x, b.y); g.restore();
    if (progress < 1) {
      g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.beginPath();
      g.arc(b.x, b.y, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); g.stroke();
    }
  }

  function drawPark(b) {
    const treeOffsets = [[-.24, -.23], [.23, -.20], [-.22, .23], [.23, .24], [0, .02]];
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = Math.round(CELL * .25) + 'px system-ui';
    for (const cell of (b.cells || [cellAt(b)])) {
      const x = cell.gx * CELL, y = cell.gy * CELL;
      if (zoneOverlayVisible()) {
        g.fillStyle = '#285f3d'; g.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
        g.strokeStyle = 'rgba(126,220,149,.42)'; g.lineWidth = 1.5; g.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
      }
      for (const offset of treeOffsets) g.fillText('🌳', x + CELL * (.5 + offset[0]), y + CELL * (.5 + offset[1]));
    }
    g.restore();
  }

  function drawHome(b, progress) {
    const level = Math.max(1, Math.min(10, b.development || 1));
    if (level === 1) {
      g.save(); g.globalAlpha = .35 + progress * .65;
      g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 8; g.shadowOffsetY = 5;
      g.font = '48px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🏠', b.x, b.y); g.restore();
    } else {
      const floors = level, floorHeight = 10, width = 44 + Math.min(7, level) * 5;
      const height = 18 + floors * floorHeight, left = b.x - width / 2, top = b.y + 28 - height;
      g.save(); g.globalAlpha = .35 + progress * .65;
      g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 8; g.shadowOffsetY = 5;
      g.fillStyle = level < 6 ? '#b76e5a' : '#7b8794'; g.fillRect(left, top, width, height);
      g.shadowColor = 'transparent';
      for (let floor = 0; floor < floors; floor++) {
        const y = b.y + 18 - floor * floorHeight;
        for (let x = left + 9; x < left + width - 5; x += 14) {
          g.fillStyle = '#ffe6a7'; g.fillRect(x, y - 6, 7, 6);
        }
      }
      g.fillStyle = '#46362e'; g.fillRect(b.x - 5, b.y + 13, 10, 15);
      g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center';
      g.fillText('L' + level, b.x, top + 10); g.restore();
    }
    if (progress < 1) {
      g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.beginPath();
      g.arc(b.x, b.y, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); g.stroke();
    }
  }

  function drawBusiness(b, progress) {
    const level = Math.max(1, Math.min(10, b.development || 1));
    const floors = level, floorHeight = 11;
    const width = 46 + Math.min(6, level) * 6, height = 24 + floors * floorHeight;
    const left = b.x - width / 2, top = b.y + 28 - height;
    g.save(); g.globalAlpha = .35 + progress * .65;
    g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 8; g.shadowOffsetY = 5;
    g.fillStyle = level < 4 ? '#b98345' : level < 7 ? '#657889' : '#485967';
    g.fillRect(left, top, width, height);
    g.fillStyle = level < 4 ? '#e7b76f' : '#91a5b6';
    g.fillRect(left - 3, top - 5, width + 6, 7);
    g.shadowColor = 'transparent';
    for (let floor = 0; floor < floors; floor++) {
      const y = b.y + 19 - floor * floorHeight;
      const windows = Math.max(2, Math.floor(width / 16));
      for (let col = 0; col < windows; col++) {
        const gap = width / (windows + 1), x = left + gap * (col + 1) - 3;
        g.fillStyle = '#bfe4ff'; g.fillRect(x, y - 7, 7, 6);
      }
    }
    g.fillStyle = '#3a2417'; g.fillRect(b.x - 5, b.y + 13, 10, 15);
    g.fillStyle = '#fff4c2'; g.font = 'bold 10px system-ui'; g.textAlign = 'center';
    g.fillText('L' + level, b.x, top + 10); g.restore();
    if (progress < 1) {
      g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.beginPath();
      g.arc(b.x, b.y, Math.max(31, width / 2), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); g.stroke();
    }
  }

  function zoneAt(at) {
    const c = cellAt(at);
    return town.zones.find(z => z.gx === c.gx && z.gy === c.gy) || null;
  }
  // A zone's real extent is whichever same-kind cells actually touch each
  // other right now, not which draw action originally created them - two
  // separately zoned patches that end up adjacent are one zone from here
  // on (for pricing, tax, selection, deletion), regardless of when either
  // was made.
  function zoneCluster(gx, gy) {
    const start = town.zones.find(z => z.gx === gx && z.gy === gy);
    if (!start) return [];
    const byKey = new Map();
    for (const z of town.zones) if (z.kind === start.kind) byKey.set(z.gx + ':' + z.gy, z);
    const seen = new Set(), stack = [start], result = [];
    while (stack.length) {
      const z = stack.pop(), key = z.gx + ':' + z.gy;
      if (seen.has(key)) continue;
      seen.add(key); result.push(z);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = byKey.get((z.gx + dx) + ':' + (z.gy + dy));
        if (n && !seen.has(n.gx + ':' + n.gy)) stack.push(n);
      }
    }
    return result;
  }
  function drawPeople() {
    const groups = new Map();
    for (const p of town.people) {
      if (p.inside) continue;
      const key = p.x.toFixed(2) + ':' + p.y.toFixed(2);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.id - b.id);
      for (let i = 0; i < group.length; i++) {
        const offset = (i - (group.length - 1) / 2) * SUB * .42;
        drawPerson(group[i], offset);
      }
    }
  }

  function drawPerson(p, offset) {
    const r = SUB / 4;
    let px = p.x, py = p.y;
    const next = p.route && p.route[0];
    if (offset) {
      const dx = next ? next.x - p.x : 0, dy = next ? next.y - p.y : 0;
      const length = Math.hypot(dx, dy);
      if (length > .01) { px -= dy / length * offset; py += dx / length * offset; }
      else px += offset;
    }
    g.fillStyle = p.sex === 'f' ? '#ff8fab' : '#7cc6fe'; g.strokeStyle = '#111'; g.lineWidth = .8;
    g.beginPath(); g.arc(px, py + r * .45, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#f1d0b5'; g.beginPath(); g.arc(px, py - r * .85, r * .62, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  function saveState() {
    return { ...town, people: town.people.map(p => {
      const copy = { ...p };
      delete copy.route; delete copy.routeGoal; delete copy.blockedRouteGoal; delete copy._routeRecalcAfter;
      delete copy._commutePlan; delete copy._commuteDay; delete copy._commuteWork;
      delete copy._commuteHome; delete copy._commuteCar; delete copy._commuteTransit;
      return copy;
    }) };
  }
  function push(immediate = false) {
    if (!town) return;
    clearTimeout(saveTimer);
    const send = () => { saveTimer = 0; mp.send({ type: 'lt_state', state: saveState() }); };
    if (immediate) send();
    else saveTimer = setTimeout(() => {
      if (window.requestIdleCallback) window.requestIdleCallback(send, { timeout: 1500 }); else send();
    }, 450);
  }
  mp.on('lt_start', msg => { if (root && canvas) begin(msg); else pending = msg; });
  mp.registerGame({
    id: GAME_ID, name: tr('lt_title'), renderSetup, renderGame,
    snapshot: () => { push(true); return null; },
    pause: () => { paused = true; }, resume: () => { paused = false; last = performance.now(); },
  });
})();
