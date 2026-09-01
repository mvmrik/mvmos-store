(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'livingtown';
  const tr = (k, v) => window.t ? window.t(k, v) : k;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => esc(s).replace(/"/g, '&quot;');

  let B, town, root, canvas, g, hud, tools, subtools, panel, toast, eventButton, eventLog;
  let unreadEvents = 0;
  let pending = null, raf = 0, last = 0, paused = false, pushClock = 0, hudClock = 0;
  let speed = loadSpeed();
  let selected = null, mode = null, category = null, zoneStart = null, zoneHover = null;
  let roadShape = 'straight', roadRotation = 0, roadHoverCell = null;
  let lineDraft = null;
  let pointer = null, moved = 0;
  const cam = { x: 2100, y: 2100, z: 2.4 };
  // One small house occupies exactly one cell. Everything placed by the player
  // or claimed by a resident resolves to this same grid, so zoning, roads and
  // later multi-cell buildings all speak one spatial language.
  const CELL = 70;
  const SUB = CELL / 6;
  // A person converging exactly onto a road corner every frame would re-erase
  // separatePedestrians()'s sideways push the moment it happens, since two
  // housemates walking the same route recompute the same exact target and
  // snap straight back onto it. Stopping a little short of each corner (as
  // Stonehold's walkers already do with their own "reach" tolerance) lets the
  // push actually stick instead of being fought every frame. Only the final
  // step into a building still lands exactly, since that point is a door, not
  // a shared stretch of road.
  const ARRIVE = SUB * 0.35;
  const dpr = () => window.devicePixelRatio || 1;
  const world = () => B.world_size;
  const person = id => town.people.find(p => p.id === id);
  const building = id => town.buildings.find(b => b.id === id);
  const age = p => Math.floor((p.age_days || 0) / 365);
  const money = n => '¤' + Math.round(n || 0).toLocaleString();
  const dayPart = () => town.day - Math.floor(town.day);
  const isWorkTime = () => {
    const hour = dayPart() * 24;
    return hour >= B.work_start_hour && hour < B.work_end_hour;
  };
  const isWorkDay = () => Math.floor(town.day) % 7 < B.work_days;
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
    twoway: ['walk', 'grass', 'asphalt', 'grass', 'asphalt', 'walk'],
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
  const ROAD_SHAPES = { straight: ['W', 'E'], corner: ['N', 'E'], diagonal: ['N', 'E'] };
  const EDGE_CW = { N: 'E', E: 'S', S: 'W', W: 'N' };
  function rotateEdge(edge, steps) {
    let e = edge;
    for (let i = 0, n = ((steps % 4) + 4) % 4; i < n; i++) e = EDGE_CW[e];
    return e;
  }
  function pieceEdges(shape, rotation) {
    const base = ROAD_SHAPES[shape] || ROAD_SHAPES.straight;
    return [rotateEdge(base[0], rotation), rotateEdge(base[1], rotation)];
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
      eventLog.classList.toggle('open'); unreadEvents = 0; renderEvents();
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
    town.busStops = town.busStops || []; town.busLines = town.busLines || [];
    town.buses = town.buses || []; town.cars = town.cars || [];
    town.next_bus_stop = town.next_bus_stop || 1; town.next_bus_line = town.next_bus_line || 1;
    town.next_bus = town.next_bus || 1; town.next_car = town.next_car || 1;
    town.transit_version = town.transit_version || 0;
    for (const r of town.roads) {
      if (r.speed_kmh == null) r.speed_kmh = roadSpec(r).speed_kmh;
      if (r.dir == null) r.dir = 1;
    }
    for (const p of town.people) normalizePerson(p);
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
    if (town.founding) mode = 'residential';
    unreadEvents = 0; renderHud(); renderTools(); renderPanel(); renderEvents(); home();
    if (town.founding) say(tr('lt_found_prompt'));
    last = performance.now(); paused = false;
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
    if (p.health == null) p.health = 'well';
    if (p.car == null) p.car = false;
    if (p.riding === undefined) p.riding = null;
    if (p.waitingAtStop === undefined) p.waitingAtStop = null;
    if (p.busBoardStop === undefined) p.busBoardStop = null;
    if (p.busAlightStop === undefined) p.busAlightStop = null;
    if (p.busLine === undefined) p.busLine = null;
    p.route = null; p.routeGoal = null; p.atBuilding = null;
    if (!town.roads.length && !p.inside && p.home) p.inside = p.home;
  }
  function resetTravel(p) {
    p.route = null; p.routeGoal = null; p.busBoardStop = null; p.busLine = null; p.busAlightStop = null;
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
    for (const p of town.people) updatePerson(p, dt);
    separatePedestrians();
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
    if (pushClock > 4) { pushClock = 0; push(); renderHud(); renderPanel(); }
  }

  function newDay(completedDay) {
    for (const p of town.people) {
      p.age_days += 365;
      if (p.happiness == null) p.happiness = B.happiness_start;
      if (p.worked_day === completedDay) p.happiness -= B.happiness_work_decay;
      else if (p.parked_day === completedDay) {
        const park = building(p.parked_building);
        p.happiness += B.happiness_park_gain_per_level * (park ? (park.level || 1) : 1);
      } else p.happiness += B.happiness_home_gain;
      p.happiness = Math.max(0, Math.min(100, p.happiness));
      if (age(p) >= B.adult_age) p.money -= B.living_cost;
      if (p.car) p.money -= B.car_tax;
      if (age(p) >= B.retire_age && p.work) {
        const workplace = building(p.work);
        if (workplace) workplace.workers = (workplace.workers || []).filter(id => id !== p.id);
        p.work = null; p.goal = null; resetTravel(p);
      }
    }
    chargeMaintenance();
    handleDeaths();
    runEconomy(completedDay);
    collectRents(completedDay);
    fillJobs();
    formCouples();
    updateHomes();
    houseExistingResidents();
    privateDecisions();
    growFamilies();
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
    town.treasury -= total;
  }

  function handleDeaths() {
    const deceasedToday = town.people.filter(p => {
      const years = age(p);
      if (years >= 100) return true;
      const annualRisk = Math.max(0, Math.min(.99, years / 100));
      return Math.random() < annualRisk;
    });
    for (const deceased of deceasedToday) {
      const children = (deceased.children || []).map(person).filter(Boolean);
      const partner = person(deceased.partner);
      const heirs = children.length ? children : (partner ? [partner] : []);
      const estate = Math.max(0, deceased.money || 0);
      if (heirs.length) {
        const share = estate / heirs.length;
        for (const heir of heirs) heir.money += share;
      } else town.treasury += estate;
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
    if (completedDay % 7 >= B.work_days) return;
    for (const b of town.buildings) {
      if (b.built < 1 || !(b.jobs > 0)) continue;
      const workers = (b.workers || []).map(person).filter(p => p && p.worked_day === completedDay);
      if (b.type === 'shop') updateBusinessScale(b);
      const wage = b.wage || B.work_income;
      if (b.type === 'shop') {
        b.cash = b.cash == null ? 250 : b.cash;
        b.total_profit = b.total_profit || 0;
        const zone = zoneAt(b), rate = zone ? zone.tax_rate : town.tax_rate;
        const revenue = workers.length * wage * (2.5 + town.people.length * .02);
        b.cash += revenue;
        const owner = person(b.owner);
        for (const p of workers) {
          const earnsOwnerShare = owner && p.id !== owner.id;
          const employeeTax = wage * rate, ownerTax = earnsOwnerShare ? wage * rate : 0;
          b.cash -= wage * (earnsOwnerShare ? 2 : 1);
          p.money += wage - employeeTax;
          town.treasury += employeeTax + ownerTax;
          if (earnsOwnerShare) owner.money += wage - ownerTax;
        }
        const hiredWorkers = workers.filter(p => !owner || p.id !== owner.id).length;
        const profit = Math.max(0, revenue - workers.length * wage - hiredWorkers * wage);
        b.total_profit += profit;
        const tax = Math.max(0, Math.min(b.cash, profit * rate));
        b.cash -= tax; town.treasury += tax;
        b.last_profit = profit; b.last_tax = tax;
        const upgradeCost = B.private_build_cost.shop * (b.development + 1);
        if (owner && !b.target_development && b.development < 10 &&
            (b.workers || []).length >= b.jobs && owner.money >= upgradeCost) {
          owner.money -= upgradeCost; b.last_upgrade_cost = upgradeCost;
          b.target_development = b.development + 1;
          b.upgrade_progress = 0; b.upgrade_days = b.target_development * .04;
        }
      } else {
        for (const p of workers) {
          if (town.treasury < wage) break;
          const tax = wage * town.tax_rate;
          town.treasury -= wage; town.treasury += tax; p.money += wage - tax;
        }
      }
    }
  }

  function updateBusinessScale(b) {
    b.development = Math.max(1, Math.min(10, b.development || 1));
    b.jobs = b.development * 3;
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
      const id = town.next_person++, female = Math.random() < .5;
      const firstNames = female ? B.names.female : B.names.male;
      const fatherSurname = String(partner.name || '').trim().split(/\s+/).pop() || 'Vale';
      const child = { id, name: firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + fatherSurname, sex: female ? 'f' : 'm',
        age_days: 0, money: 0, partner: null, parents: [mother.id, partner.id], children: [],
        home: mother.home, work: null, x: mother.x, y: mother.y, inside: mother.home,
        goal: null, happiness: B.happiness_start, history: [] };
      town.people.push(child); mother.children.push(id);
      partner.children = partner.children || []; partner.children.push(id);
      const home = building(mother.home); if (home && !(home.residents || []).includes(id)) home.residents.push(id);
      addEvent('lt_event_born', { person: child.name });
    }
    const openJobs = town.buildings.filter(b => b.built >= 1)
      .reduce((n, b) => n + Math.max(0, (b.jobs || 0) - (b.workers || []).length), 0);
    const arrival = randomRoadPoint();
    if (town.next_migrant_day == null) town.next_migrant_day = today + 1;
    if (today >= town.next_migrant_day) {
      town.next_migrant_day = today + 1;
      if (!(openJobs > 0 && arrival)) return;
      const id = town.next_person, female = Math.random() < .5;
      const names = female ? B.names.female : B.names.male;
      const savings = 100 + Math.floor(Math.random() * 171) * 10;
      const newcomer = { id, name: names[Math.floor(Math.random() * names.length)] + ' ' + B.names.outsider_surname, sex: female ? 'f' : 'm',
        age_days: (20 + id % 15) * 365, money: savings, partner: null, parents: [], children: [],
        home: null, work: null, x: arrival.x, y: arrival.y, inside: null, goal: null,
        happiness: B.happiness_start, history: ['lt_hist_founded'] };
      const resale = vacantHomePurchase(newcomer);
      const purchase = resale ? null : housingOpportunity([newcomer]);
      const rental = (resale || purchase) ? null : rentalOpportunity(newcomer);
      if (!resale && !purchase && !rental) return;
      town.next_person += 1; town.people.push(newcomer);
      if (resale) buyVacantHome(newcomer, resale);
      else if (purchase) {
        newcomer.inside = 'waiting';
        if (!createPrivate('house', purchase.at, newcomer, purchase.cost, [newcomer])) {
          town.people = town.people.filter(p => p.id !== newcomer.id); return;
        }
      } else moveIntoRental(newcomer, rental);
      addEvent('lt_event_migrant', { person: newcomer.name });
    }
  }

  function updatePerson(p, dt) {
    if (p.inside === 'waiting') return;
    if (p.riding || p.waitingAtStop != null) return;
    if (!p.goal) chooseGoal(p);
    if (!p.goal) return;
    const target = p.goal.kind === 'wander' ? p.goal : building(p.goal.building);
    if (!target) { p.goal = null; return; }
    if (p.goal.kind === 'work' && (!isWorkDay() || dayPart() * 24 >= B.work_end_hour)) {
      p.goal = null; resetTravel(p); return;
    }
    if (p.goal.kind === 'build' && p.atBuilding === target.id) return;
    const routeGoal = p.goal.kind + ':' + (target.id || (target.x + ':' + target.y));
    if (p.inside) {
      if (p.inside !== target.id) {
        if (!p.route || p.routeGoal !== routeGoal) {
          const origin = building(p.inside);
          const commuting = (p.goal.kind === 'work' && p.inside === p.home) || (p.goal.kind === 'home' && p.inside === p.work) ||
            p.goal.kind === 'park' || (p.goal.kind === 'home' && origin && origin.type === 'park');
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
          if (!route) route = roadRoute(origin || p, target);
          p.route = route; p.routeGoal = routeGoal; p.atBuilding = null;
          if (!p.route) return;
          p.x = p.route[0].x; p.y = p.route[0].y; p.route.shift();
        }
        p.inside = null;
      }
      else {
        if (p.goal.kind === 'work') {
          if (isWorkTime()) p.worked_day = Math.floor(town.day);
          if (dayPart() * 24 >= B.work_end_hour) p.goal = null;
          return;
        }
        if (p.goal.kind === 'home' && p.work) {
          if (isWorkDay() && dayPart() * 24 >= departureHourFor(p) && dayPart() * 24 < B.work_end_hour) p.goal = null;
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
      p.route = roadRoute(p, target); p.routeGoal = routeGoal; p.atBuilding = null;
      if (!p.route) return;
      p.x = p.route[0].x; p.y = p.route[0].y; p.route.shift();
    }
    // Someone unhappy is a little less eager to hurry - a mild effect, never
    // more than a quarter slower, so it stays a flavor detail rather than a
    // real obstacle.
    const moraleFactor = p.happiness == null ? 1 : .75 + .25 * (p.happiness / 100);
    let left = B.walk_speed * dt * speed * moraleFactor, routeGuard = 0;
    while (p.route.length && left > 0 && routeGuard++ < 100) {
      const next = p.route[0];
      const tol = p.route.length > 1 ? ARRIVE : .01;
      const dx = next.x - p.x, dy = next.y - p.y, d = Math.hypot(dx, dy);
      const remaining = d - tol;
      // Pedestrian separation can leave a walker a floating-point fraction
      // outside a corner. A tiny step may not change the world coordinates,
      // so treat it as arrival and keep a hard per-frame safety limit above.
      if (!Number.isFinite(d) || remaining <= .01) { p.route.shift(); continue; }
      const travel = Math.min(left, remaining);
      p.x += dx / d * travel; p.y += dy / d * travel; left -= travel;
    }
    if (p.route.length) return;
    p.route = null; p.routeGoal = null;
    if (p.busBoardStop != null) { p.waitingAtStop = p.busBoardStop; return; }
    if (p.goal.kind === 'build') { p.atBuilding = target.id; return; }
    if (target.id) {
      p.inside = target.id;
      if (p.goal.kind === 'work' && isWorkTime()) p.worked_day = Math.floor(town.day);
      if (p.goal.kind === 'park') {
        p.parked_day = Math.floor(town.day); p.parked_building = target.id; p.last_park_visit = Math.floor(town.day);
      }
      p.goal.left = p.goal.duration || (p.goal.kind === 'park' ? B.park_visit_duration : .18);
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

  function roadPathBetween(road, from, to) {
    const points = roadPath(road), a = projectToRoad(from, road), b = projectToRoad(to, road);
    const forward = a.t <= b.t, low = Math.min(a.t, b.t), high = Math.max(a.t, b.t);
    const total = pathLength(points) || 1, result = [a.point]; let travelled = 0;
    for (let i = 1; i < points.length - 1; i++) {
      travelled += dist(points[i - 1], points[i]); const t = travelled / total;
      if (t > low + 1e-5 && t < high - 1e-5) result.push(points[i]);
    }
    result.push(b.point); if (!forward) result.reverse(); return result;
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
      if (!best || accessDistance < best.distance) best = { road, point: p, distance: accessDistance };
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

  function roadAnchor(at, vehicleAware) {
    if (at && at.type && at.id != null) return buildingRoadAccess(at, vehicleAware);
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
  function buildRoute(from, to, vehicleAware) {
    const start = roadAnchor(from, vehicleAware), end = roadAnchor(to, vehicleAware);
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
  function roadRoute(from, to) {
    const detail = buildRoute(from, to, false);
    return detail ? detail.points : null;
  }
  function roadRouteDetailed(from, to) {
    return buildRoute(from, to, true);
  }

  function randomRoadPoint() {
    if (!town.roads.length) return null;
    const road = town.roads[Math.floor(Math.random() * town.roads.length)], t = Math.random();
    return { x: road.x1 + (road.x2 - road.x1) * t, y: road.y1 + (road.y2 - road.y1) * t };
  }

  function chooseGoal(p) {
    if (age(p) < B.adult_age) {
      const h = building(p.home); if (h) p.goal = { kind: 'home', building: h.id, duration: 6 };
      return;
    }
    if (p.work && isWorkDay() && dayPart() * 24 >= departureHourFor(p) && dayPart() * 24 < B.work_end_hour) {
      p.goal = { kind: 'work', building: p.work };
      return;
    }
    const park = considerPark(p);
    if (park) p.goal = { kind: 'park', building: park.id };
    else if (p.home) p.goal = { kind: 'home', building: p.home, duration: p.work ? 4 : 6 };
  }

  // How many real hours of free time remain today, given the day's schedule.
  // Used to judge whether a special park trip mid-week still leaves enough
  // time to sleep and make the next work departure.
  function parkFreeHours(p) {
    const hourNow = dayPart() * 24;
    if (p.work && isWorkDay()) {
      const dep = departureHourFor(p);
      if (hourNow < dep) return dep - hourNow;
      if (hourNow >= B.work_end_hour) return Math.max(0, 24 - B.sleep_hours - hourNow);
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
  // (or anyone without a job) only need happiness below the "seek" threshold,
  // since there is plenty of spare time. A workday interrupts work only when
  // happiness is genuinely low AND the round trip plus the visit still fits
  // in the free time left before the next work departure or bedtime.
  function considerPark(p) {
    if (!p.home || p.happiness == null) return null;
    if (p.last_park_visit === Math.floor(town.day)) return null;
    const weekend = !isWorkDay();
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
    const roundTrip = trip.hours * 2 + B.park_visit_duration;
    return roundTrip <= parkFreeHours(p) ? park : null;
  }

  // walk_speed is world-units per real-second at 1x game speed and represents
  // walk_speed_kmh - every vehicle speed is the same ratio scaled by its own
  // km/h, so a 50 km/h road segment moves a car 10x faster than a pedestrian.
  function vehicleUnitsPerSecond(kmh) { return B.walk_speed * (kmh / B.walk_speed_kmh); }
  // Game time and real time are both scaled by the same `speed` multiplier,
  // so it cancels out of any duration expressed in game-hours: this is the
  // same relationship the original workDepartureHour math relied on.
  function hoursForRealSeconds(secs) { return secs * 24 * B.days_per_second; }
  function routeLength(points) {
    let len = 0; for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]); return len;
  }
  function hoursForWalk(points) {
    if (!points || points.length < 2) return Infinity;
    return hoursForRealSeconds(routeLength(points) / B.walk_speed);
  }
  function roadSpeedKmh(roadId) {
    const road = town.roads.find(r => r.id === roadId);
    return road ? (road.speed_kmh || roadSpec(road).speed_kmh) : B.walk_speed_kmh;
  }
  function hoursForVehicleRoute(detail) {
    if (!detail || detail.points.length < 2) return Infinity;
    let secs = 0;
    for (let i = 1; i < detail.points.length; i++) {
      secs += dist(detail.points[i - 1], detail.points[i]) / vehicleUnitsPerSecond(roadSpeedKmh(detail.roadIds[i - 1]));
    }
    return hoursForRealSeconds(secs);
  }

  function segmentLength(line, i) { return dist(line.points[i], line.points[(i + 1) % line.points.length]); }
  function segmentSpeedKmh(line, i) { return roadSpeedKmh(line.roadIds[i]); }
  function segmentSeconds(line, i) { return segmentLength(line, i) / vehicleUnitsPerSecond(segmentSpeedKmh(line, i)); }

  function stopPositionOnLine(line, stop) {
    let best = null;
    for (let i = 0; i < line.points.length; i++) {
      const a = line.points[i], b = line.points[(i + 1) % line.points.length];
      const proj = projectToRoad({ x: stop.x, y: stop.y }, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      if (proj.distance <= STOP_REACH && (!best || proj.distance < best.distance)) best = { segIndex: i, t: proj.t, distance: proj.distance };
    }
    return best;
  }
  // A stop is never bound to a specific line - any line whose loop passes
  // close enough serves it, recomputed live so building/removing lines just
  // changes who serves a stop without editing the stop itself.
  function lineStops(line) { return town.busStops.filter(stop => stopPositionOnLine(line, stop)); }

  function nextStopInSegment(line, seg, afterT) {
    let best = null;
    for (const stop of town.busStops) {
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

  // Looks at every line's stops within walking reach of both ends of the
  // trip and picks the board/alight pair with the lowest total time (walk to
  // stop + live wait for the next bus there + ride + walk from alight stop).
  function bestBusPlan(home, workplace) {
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
          const walkToBoard = hoursForWalk(roadRoute(home, boardStop));
          const walkFromAlight = hoursForWalk(roadRoute(alightStop, workplace));
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
    const walkHours = hoursForWalk(roadRoute(originB, destB));
    if (p.car) {
      const carHours = hoursForVehicleRoute(roadRouteDetailed(originB, destB));
      if (Number.isFinite(carHours)) return { mode: 'car', hours: carHours };
    }
    const busPlan = bestBusPlan(originB, destB);
    if (busPlan && busPlan.hours < walkHours) return { mode: 'bus', hours: busPlan.hours, line: busPlan.line, boardStop: busPlan.boardStop, alightStop: busPlan.alightStop };
    return { mode: 'walk', hours: walkHours };
  }

  function planCommute(p) {
    const home = building(p.home), workplace = building(p.work);
    if (!home || !workplace) return { hour: B.work_start_hour, mode: 'walk' };
    const plan = planTrip(home, workplace, p);
    if (!Number.isFinite(plan.hours)) return { hour: B.work_start_hour, mode: 'walk' };
    return { hour: Math.max(0, B.work_start_hour - plan.hours), mode: plan.mode, line: plan.line, boardStop: plan.boardStop, alightStop: plan.alightStop };
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

  function separatePedestrians() {
    const walkers = town.people.filter(p => !p.inside);
    const minimum = SUB * .58;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        let dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
        if (distance >= minimum) continue;
        const overlapping = distance < .001;
        if (overlapping) {
          const next = b.route && b.route[0];
          const tx = next ? next.x - b.x : 1, ty = next ? next.y - b.y : 0;
          const length = Math.hypot(tx, ty) || 1;
          dx = -ty / length; dy = tx / length;
        } else { dx /= distance; dy /= distance; }
        const shift = (minimum - (overlapping ? 0 : distance)) / 2 + .01;
        a.x -= dx * shift; a.y -= dy * shift;
        b.x += dx * shift; b.y += dy * shift;
      }
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
    return forward ? [4] : [2];
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
      if ((other.roadIds && other.roadIds[other.seg]) !== dir.roadId) continue;
      const dx = other.x - car.x, dy = other.y - car.y;
      if (dx * dir.fx + dy * dir.fy <= 0) continue;
      const d = Math.hypot(dx, dy);
      if (d < gap && d < nearestDist) { nearest = other; nearestDist = d; }
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
        if (p.goal.kind === 'work' && isWorkTime()) p.worked_day = Math.floor(town.day);
        if (p.goal.kind === 'park') {
          p.parked_day = Math.floor(town.day); p.parked_building = p.goal.building; p.last_park_visit = Math.floor(town.day);
        }
        p.goal.left = p.goal.duration || (p.goal.kind === 'park' ? B.park_visit_duration : .18);
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
    const moraleFactor = driver && driver.happiness != null ? .75 + .25 * (driver.happiness / 100) : 1;
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
        p.riding = null; p.x = stop.x; p.y = stop.y; p.inside = null; p.waitingAtStop = null;
        resetTravel(p);
        return false;
      }
      return true;
    });
    const waiting = town.people.filter(p => p.waitingAtStop === stop.id && p.busLine === line.id);
    for (const p of waiting) {
      if (bus.passengers.length >= bus.capacity) break;
      p.money -= B.bus_fare; town.treasury += B.bus_fare;
      p.waitingAtStop = null; p.riding = { kind: 'bus', id: bus.id };
      bus.passengers.push(p.id);
    }
  }

  function updateBuses(dt) { for (const bus of town.buses) updateBus(bus, dt); }
  function updateBus(bus, dt) {
    const line = town.busLines.find(l => l.id === bus.lineId);
    if (!line || line.points.length < 2) return;
    if (bus.dwell > 0) { bus.dwell = Math.max(0, bus.dwell - dt); return; }
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
    if (town.treasury < spec.cost) return say(tr('lt_no_money'));
    town.treasury -= spec.cost;
    const start = line.points[0];
    town.buses.push({ id: town.next_bus++, lineId, tier: line.tier, seg: 0, segT: 0,
      x: start.x, y: start.y, dwell: 0, passengers: [], capacity: spec.capacity });
    say(tr('lt_bus_bought')); town.transit_version++; push(); renderPanel(); renderHud();
  }
  function upgradeLine(lineId, tier) {
    const line = town.busLines.find(l => l.id === lineId); if (!line || !B.bus_types[tier]) return;
    const buses = town.buses.filter(b => b.lineId === lineId);
    const cost = B.bus_types[tier].cost * Math.max(1, buses.length);
    if (town.treasury < cost) return say(tr('lt_no_money'));
    town.treasury -= cost; line.tier = tier;
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

  function carOpportunity(p) {
    if (p.car || age(p) < B.adult_age || !p.work || p.money < B.car_cost * 1.3) return false;
    p.money -= B.car_cost; town.treasury += B.car_cost; p.car = true;
    p.history.unshift('lt_hist_car'); addEvent('lt_event_car', { person: p.name });
    town.transit_version++;
    return true;
  }

  function fillJobs() {
    const vacancies = town.buildings.filter(b => b.built >= 1 && (b.workers || []).length < (b.jobs || 0));
    for (const p of town.people) {
      if (p.work || age(p) < B.adult_age || age(p) >= B.retire_age) continue;
      const ownBusiness = vacancies.find(b => b.type === 'shop' && b.owner === p.id);
      if (ownBusiness) {
        ownBusiness.workers.push(p.id); p.work = ownBusiness.id;
        p.history.unshift('lt_hist_job'); addEvent('lt_event_job', { person: p.name, name: ownBusiness.name });
        continue;
      }
      if (businessOpportunity(p)) continue;
      let best = null, score = -Infinity;
      for (const b of vacancies) {
        if ((b.workers || []).length >= b.jobs) continue;
        const s = (b.wage || 0) - dist(p, b) / 180;
        if (s > score) { score = s; best = b; }
      }
      if (best) {
        best.workers.push(p.id); p.work = best.id;
        p.history.unshift('lt_hist_job'); addEvent('lt_event_job', { person: p.name, name: best.name });
      }
    }
  }

  function formCouples() {
    const singles = town.people.filter(p => age(p) >= B.adult_age && age(p) <= 50 && !p.partner);
    for (const p of singles) {
      if (p.partner) continue;
      const matches = singles.filter(q => q.id !== p.id && !q.partner && q.sex !== p.sex &&
        Math.abs(age(q) - age(p)) <= 15 && !(p.parents || []).includes(q.id) && !(q.parents || []).includes(p.id) &&
        !(p.parents || []).some(id => (q.parents || []).includes(id)));
      if (!matches.length || Math.random() >= .35) continue;
      matches.sort((a, b) => Math.abs(age(a) - age(p)) - Math.abs(age(b) - age(p)));
      const partner = matches[0]; p.partner = partner.id; partner.partner = p.id;
    }
  }

  function propertyLevelsInZone(kind, at) {
    const zone = zoneAt(at); if (!zone || zone.kind !== kind) return Infinity;
    const type = kind === 'business' ? 'shop' : 'house';
    return town.buildings.filter(b => b.type === type && b.built >= 1)
      .filter(b => { const ownZone = zoneAt(b); return ownZone && ownZone.group === zone.group; })
      .reduce((sum, b) => sum + Math.max(1, b.development || 1), 0);
  }

  function homeCostAt(at) {
    const levels = propertyLevelsInZone('residential', at);
    return Number.isFinite(levels) ? B.private_build_cost.house * (levels + 1) : Infinity;
  }

  function housingOpportunity(owners) {
    if (town.buildings.some(b => b.type === 'house' && b.built < 1)) return null;
    const money = owners.reduce((sum, p) => sum + Math.max(0, p.money), 0);
    const occupied = new Set(town.buildings.map(b => cellKey(cellAt(b))));
    const options = town.zones.filter(z => z.kind === 'residential' && !occupied.has(cellKey(z)) && !cellHasRoad(z))
      .map(z => { const at = cellPoint(z); return { at, cost: homeCostAt(at), tax: z.tax_rate || 0 }; })
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

  function vacantHomePurchase(buyer) {
    return town.buildings.filter(home => home.type === 'house' && home.built >= 1 && !home.target_development &&
      !(home.residents || []).length && buildingRoadAccess(home))
      .map(home => ({ home, price: homeValue(home) }))
      .filter(option => buyer.money >= option.price)
      .sort((a, b) => a.price - b.price)[0] || null;
  }

  function buyVacantHome(buyer, option) {
    const home = option.home, sellers = (home.owners || [home.owner]).map(person).filter(Boolean);
    buyer.money -= option.price;
    if (sellers.length) for (const seller of sellers) seller.money += option.price / sellers.length;
    else town.treasury += option.price;
    home.owner = buyer.id; home.owners = [buyer.id]; home.residents = [buyer.id];
    buyer.home = home.id; buyer.rental_home = null; buyer.inside = home.id;
    buyer.x = home.x; buyer.y = home.y; buyer.goal = null; resetTravel(buyer);
    addEvent('lt_event_home_bought', { person: buyer.name, name: home.name, price: money(option.price) });
  }

  function annualRent(home) {
    updateHomeScale(home);
    return Math.max(1, homeValue(home) * .03 / home.capacity);
  }

  function rentalOpportunity(tenant) {
    return town.buildings.filter(b => b.type === 'house' && b.built >= 1 &&
      (b.residents || []).length < (b.capacity || 2) && buildingRoadAccess(b))
      .map(home => ({ home, rent: annualRent(home) }))
      .filter(option => tenant.money >= option.rent)
      .sort((a, b) => a.rent - b.rent)[0] || null;
  }

  function moveIntoRental(tenant, option) {
    const oldHome = building(tenant.home);
    if (oldHome) oldHome.residents = (oldHome.residents || []).filter(id => id !== tenant.id);
    tenant.home = option.home.id; tenant.rental_home = option.home.id;
    tenant.inside = option.home.id; tenant.goal = null; resetTravel(tenant);
    if (!option.home.residents.includes(tenant.id)) option.home.residents.push(tenant.id);
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
      else town.treasury += paid;
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
    b.capacity = b.development * 2;
  }

  function updateHomes() {
    const housingDemand = town.people.some(p => !p.home && p.inside !== 'waiting');
    for (const home of town.buildings.filter(b => b.type === 'house' && b.built >= 1)) {
      updateHomeScale(home);
      if (home.target_development || home.development >= 10 ||
          ((home.residents || []).length <= home.capacity && !housingDemand)) continue;
      const owners = (home.owners || [home.owner]).map(person).filter(Boolean);
      const total = owners.reduce((sum, p) => sum + Math.max(0, p.money), 0);
      const cost = B.private_build_cost.house * (home.development + 1);
      if (!owners.length || total < cost) continue;
      for (const owner of owners) owner.money -= cost * (Math.max(0, owner.money) / total);
      home.last_upgrade_cost = cost; home.target_development = home.development + 1;
      home.upgrade_progress = 0; home.upgrade_days = home.target_development * .04;
    }
  }

  function privateDecisions() {
    const adult = town.people.filter(p => age(p) >= B.adult_age);
    for (const buyer of adult.filter(p => !p.car).sort((a, b) => b.money - a.money)) {
      if (carOpportunity(buyer)) break;
    }
    const noWork = adult.filter(p => !p.work).sort((a, b) => b.money - a.money);
    for (const investor of noWork) {
      const opportunity = businessOpportunity(investor);
      if (!opportunity) continue;
      createPrivate('shop', opportunity.at, investor, opportunity.cost);
      break;
    }
    const couples = adult.filter(p => p.partner && p.id < p.partner)
      .map(p => [p, person(p.partner)]).filter(pair => pair[1] &&
        (pair[0].home !== pair[1].home || pair[0].rental_home || pair[1].rental_home));
    for (const couple of couples) {
      const opportunity = housingOpportunity(couple);
      if (!opportunity) continue;
      createPrivate('house', opportunity.at, couple[0], opportunity.cost, couple); break;
    }
    const housingSeeker = adult.find(p => (!p.home || p.rental_home) && !p.partner);
    if (housingSeeker) {
      const opportunity = housingOpportunity([housingSeeker]);
      if (opportunity) createPrivate('house', opportunity.at, housingSeeker, opportunity.cost, [housingSeeker]);
    }
  }

  function businessCostAt(at) {
    const levels = propertyLevelsInZone('business', at);
    if (!Number.isFinite(levels)) return Infinity;
    return B.private_build_cost.shop * (levels + 1);
  }

  function businessOpportunity(owner) {
    if (!owner || town.buildings.some(b => b.type === 'shop' && b.built < 1)) return null;
    const occupied = new Set(town.buildings.map(b => cellKey(cellAt(b))));
    const options = town.zones.filter(z => z.kind === 'business' && !occupied.has(cellKey(z)) && !cellHasRoad(z))
      .map(z => { const at = cellPoint(z); return { at, cost: businessCostAt(at), tax: z.tax_rate || 0 }; })
      .filter(x => owner.money >= x.cost)
      .sort((a, b) => a.cost - b.cost || a.tax - b.tax || dist(owner, a.at) - dist(owner, b.at));
    return options[0] || null;
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
    if (type === 'shop') { b.cash = 250; b.development = 1; b.total_profit = 0; updateBusinessScale(b); }
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

  function addEvent(key, vars) {
    town.events = town.events || [];
    town.events.unshift({ day: Math.floor(town.day), key, vars: vars || {} });
    town.events = town.events.slice(0, 100);
    unreadEvents += 1;
    renderEvents();
  }

  function renderEvents() {
    if (!eventButton || !eventLog || !town) return;
    const events = town.events || [];
    const latest = events[0];
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
    const jobs = town.buildings.filter(b => b.built >= 1)
      .reduce((n, b) => n + Math.max(0, (b.jobs || 0) - (b.workers || []).length), 0);
    hud.innerHTML = '<button data-home title="' + esc(tr('lt_home')) + '">⌂</button>' +
      '<span><b>' + town.people.length + '</b> ' + esc(tr('lt_people')) + '</span>' +
      '<span><b>' + money(town.treasury) + '</b> ' + esc(tr('lt_treasury')) + '</span>' +
      '<span><b>' + jobs + '</b> ' + esc(tr('lt_jobs')) + '</span><span data-clock>' + esc(fmtDay()) + '</span>' +
      '<label class="lt-speed">⏱<select data-speed>' + Array.from({ length: 10 }, (_, i) => {
        const value = i + 1; return '<option value="' + value + '"' + (value === speed ? ' selected' : '') + '>' + value + '×</option>';
      }).join('') + '</select></label>';
    hud.querySelector('[data-home]').onclick = home;
    hud.querySelector('[data-speed]').onchange = ev => setSpeed(ev.target.value);
  }

  // Each road tier is a separate construction tool. Existing segments are
  // never repaved in place: select and delete one before drawing its replacement.
  const categoryDefs = [
    ['zone', '🗂️', 'lt_cat_zone'], ['road', '🛣️', 'lt_road'], ['public', '🏛️', 'lt_cat_public'],
    ['transport', '🚌', 'lt_cat_transport'],
  ];
  const subToolDefs = {
    zone: [['residential', '🏠', 'lt_zone_home'], ['business', '🏪', 'lt_zone_business'], ['park', '🌳', 'lt_park']],
    road: [['road:dirt', '🟫', 'lt_road_type_dirt'], ['road:oneway', '➡️', 'lt_road_type_oneway'],
      ['road:twoway', '↔️', 'lt_road_type_twoway'], ['road:avenue', '🛣️', 'lt_road_type_avenue'],
      ['road:highway', '🏎️', 'lt_road_type_highway']],
    public: [['clinic', '✚', 'lt_clinic'], ['police', '★', 'lt_police'], ['fire', '🔥', 'lt_fire']],
    transport: [['busline', '🚌', 'lt_bus_new_line'], ['busstop', '🚏', 'lt_bus_stop'], ['lines', '📋', 'lt_bus_lines']],
  };
  function categoryOf(m) {
    if (m === 'residential' || m === 'business' || m === 'park') return 'zone';
    if (m === 'clinic' || m === 'police' || m === 'fire') return 'public';
    if (m === 'busline' || m === 'busstop' || m === 'lines') return 'transport';
    if (m && m.indexOf('road:') === 0) return 'road';
    return null;
  }
  function renderTools() {
    if (town && town.founding) {
      tools.innerHTML = '<button class="on"><i>🏠</i><span>' + esc(tr('lt_zone_home')) + '</span></button>';
      subtools.innerHTML = ''; subtools.classList.remove('open');
      return;
    }
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
      mode = null; zoneStart = null; zoneHover = null; roadHoverCell = null; lineDraft = null;
      renderTools(); say('');
    };
    renderSubtools();
  }
  const ROAD_PIECE_DEFS = [['straight', 'lt_piece_straight'], ['corner', 'lt_piece_corner'], ['diagonal', 'lt_piece_diagonal']];
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
    } else {
      for (let i = 0; i < 6; i++) {
        const r = ((i + .5) * band).toFixed(1);
        inner += '<path d="M ' + r + ' 0 A ' + r + ' ' + r + ' 0 0 1 0 ' + r + '" stroke="' + ROAD_COLORS[layout[i]] +
          '" stroke-width="' + (band + .6).toFixed(1) + '" fill="none"/>';
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
      '"><i>' + x[1] + '</i><span>' + esc(tr(x[2])) + '</span></button>').join('');
    if (category === 'road' && roadModeType()) {
      const type = roadModeType();
      html += ROAD_PIECE_DEFS.map(x => '<button data-piece="' + x[0] + '" class="' + (roadShape === x[0] ? 'on' : '') +
        '"><i style="display:flex;justify-content:center">' + pieceIconSVG(x[0], type, roadRotation * 90) + '</i><span>' + esc(tr(x[1])) + '</span></button>').join('') +
        '<button data-rotate><i>⟳</i><span>' + esc(tr('lt_piece_rotate')) + '</span></button>';
    }
    subtools.innerHTML = html;
    for (const b of subtools.querySelectorAll('[data-tool]')) b.onclick = () => {
      zoneStart = null; zoneHover = null; roadHoverCell = null; lineDraft = null;
      if (b.dataset.tool === 'lines') {
        mode = null; renderTools(); selected = { kind: 'lines' }; renderPanel(); return;
      }
      mode = mode === b.dataset.tool ? null : b.dataset.tool; renderTools();
      say(!mode ? '' : roadModeType() ? tr('lt_tool_hint') : (mode === 'residential' || mode === 'business' || mode === 'park') ? tr('lt_zone_first') :
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
    panel.classList.add('open');
    if (selected.kind === 'person') {
      const p = person(selected.id); if (!p) return closePanel();
      const h = building(p.home), w = building(p.work);
      const plan = personPlan(p);
      panel.innerHTML = closeButton() + '<h2>' + (p.sex === 'f' ? '♀' : '♂') + ' ' + esc(p.name) + '</h2><p class="lt-lead">' +
        esc(tr('lt_person_line', { age: age(p), money: money(p.money) })) + '</p>' + rows([
          [tr('lt_home_label'), h ? h.name : tr('lt_none')], [tr('lt_work_label'), w ? w.name : tr('lt_seeking')],
          [tr('lt_partner'), p.partner ? person(p.partner).name : tr('lt_none')],
          [tr('lt_now'), personState(p)], [tr('lt_next_plan'), plan.label + (plan.hour == null ? '' : ' · ' + fmtHour(plan.hour))],
          [tr('lt_children'), (p.children || []).length],
          [tr('lt_happiness'), Math.round(p.happiness ?? B.happiness_start)],
        ]) + '<h3>' + esc(tr('lt_history')) + '</h3><div class="lt-history">' +
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
        [tr('lt_company_cash'), money(b.cash)], [tr('lt_development'), b.development || 1],
        [tr('lt_last_profit'), money(b.last_profit)], [tr('lt_last_tax'), money(b.last_tax)]);
      if (b.type === 'house') details.push([tr('lt_development'), b.development || 1]);
      panel.innerHTML = closeButton() + '<h2>' + glyph(b.type) + ' ' + esc(b.name) + '</h2>' +
        (construction < 1 ? '<div class="lt-progress"><i style="width:' + Math.round(construction * 100) + '%"></i></div><p>' +
          esc(tr('lt_building_progress', { n: Math.round(construction * 100) })) + '</p>' : '') +
        rows(details) + peopleList((b.residents || []).concat(b.workers || []), b.id);
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
    } else if (selected.kind === 'lines') {
      const lines = town.busLines;
      panel.innerHTML = closeButton() + '<h2>🚌 ' + esc(tr('lt_bus_lines')) + '</h2>' +
        (lines.length ? '<div class="lt-list">' + lines.map(l => '<button data-line="' + l.id + '"><i style="color:' +
          l.color + '">●</i>' + esc(l.name) + '</button>').join('') + '</div>' :
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
        '<h3>' + esc(tr('lt_bus_schedule')) + '</h3>' +
        (buses.length && stops.length ? stops.map((s, i) => {
          const secs = nextArrivalSeconds(l, s), mins = Number.isFinite(secs) ? Math.max(0, Math.round(secs / 60)) : null;
          return '<p>🚏 ' + esc(tr('lt_bus_stop')) + ' ' + (i + 1) + ' — ' + (mins == null ? esc(tr('lt_bus_none')) : mins + ' min') + '</p>';
        }).join('') : '<p class="lt-lead">' + esc(tr('lt_bus_none')) + '</p>') +
        '<h3>' + esc(tr('lt_bus_manage')) + '</h3><div class="lt-list">' +
        '<button data-buy-bus>' + esc(tr('lt_bus_buy')) + ' · ' + money(spec.cost) + '</button>' +
        (buses.length ? '<button data-remove-bus="' + buses[buses.length - 1].id + '">' + esc(tr('lt_bus_remove')) + '</button>' : '') +
        '</div><h3>' + esc(tr('lt_bus_upgrade_line')) + '</h3><div class="lt-list">' + otherTiers.map(t => {
          const cost = B.bus_types[t].cost * Math.max(1, buses.length), afford = town.treasury >= cost;
          return '<button data-upgrade-line="' + t + '"' + (afford ? '' : ' disabled') + '>' +
            esc(tr('lt_bus_tier_' + t)) + ' · ' + money(cost) + '</button>';
        }).join('') + '</div>';
    } else {
      const cells = town.zones.filter(z => z.group === selected.group);
      if (!cells.length) return closePanel();
      const z = cells[0], pct = Math.round((z.tax_rate || 0) * 100);
      panel.innerHTML = closeButton() + '<h2>' + (z.kind === 'business' ? '🏪 ' : '🏠 ') +
        esc(tr(z.kind === 'business' ? 'lt_zone_business' : 'lt_zone_home')) + '</h2>' +
        rows([[tr('lt_zone_size'), cells.length], [tr('lt_profit_tax'), pct + '%']]) +
        '<div class="lt-tax"><button data-tax="-1">−</button><b>' + pct + '%</b><button data-tax="1">+</button></div>' +
        '<p class="lt-lead">' + esc(tr('lt_tax_help')) + '</p>';
    }
    panel.querySelector('[data-close]').onclick = closePanel;
    for (const el of panel.querySelectorAll('[data-tax]')) el.onclick = () => changeZoneTax(selected.group, +el.dataset.tax);
    for (const el of panel.querySelectorAll('[data-person]')) el.onclick = () => { selected = { kind: 'person', id: +el.dataset.person }; renderPanel(); };
    const deleteRoadButton = panel.querySelector('[data-delete-road]');
    if (deleteRoadButton) deleteRoadButton.onclick = () => deleteRoad(selected.id);
    for (const el of panel.querySelectorAll('[data-speed-road]')) el.onclick = () => {
      const r = town.roads.find(x => x.id === selected.id); if (!r) return;
      r.speed_kmh = Math.max(5, Math.min(150, (r.speed_kmh || 0) + parseInt(el.dataset.speedRoad, 10)));
      town.transit_version++; push(); renderPanel();
    };
    const flipButton = panel.querySelector('[data-flip-road]');
    if (flipButton) flipButton.onclick = () => {
      const r = town.roads.find(x => x.id === selected.id); if (!r) return;
      r.dir = (r.dir || 1) >= 0 ? -1 : 1;
      town.transit_version++; push(); renderPanel();
    };
    for (const el of panel.querySelectorAll('[data-line]')) el.onclick = () => { selected = { kind: 'line', id: +el.dataset.line }; renderPanel(); };
    const buyBusBtn = panel.querySelector('[data-buy-bus]');
    if (buyBusBtn) buyBusBtn.onclick = () => buyBus(selected.id);
    const removeBusBtn = panel.querySelector('[data-remove-bus]');
    if (removeBusBtn) removeBusBtn.onclick = () => removeBus(+removeBusBtn.dataset.removeBus);
    for (const el of panel.querySelectorAll('[data-upgrade-line]')) el.onclick = () => upgradeLine(selected.id, el.dataset.upgradeLine);
  }

  function changeZoneTax(group, delta) {
    const cells = town.zones.filter(z => z.group === group); if (!cells.length) return;
    const rate = Math.max(0, Math.min(.50, (cells[0].tax_rate || 0) + delta / 100));
    for (const z of cells) z.tax_rate = rate;
    push(); renderPanel();
  }

  function closeButton() { return '<button class="lt-close" data-close>×</button>'; }
  function closePanel() { selected = null; renderPanel(); }
  function rows(items) { return '<dl>' + items.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>').join('') + '</dl>'; }
  function peopleList(ids, buildingId) {
    if (!ids.length) return '';
    return '<h3>' + esc(tr('lt_people_here')) + '</h3><div class="lt-list">' + [...new Set(ids)].map(id => {
      const p = person(id); if (!p) return '';
      const present = p.inside === buildingId;
      return '<button data-person="' + id + '" class="' + (present ? 'present' : 'away') + '" title="' +
        escAttr(personState(p)) + '"><i aria-hidden="true">●</i><b aria-label="' + (p.sex === 'f' ? 'female' : 'male') + '">' +
        (p.sex === 'f' ? '♀' : '♂') + '</b>' + esc(p.name) + '</button>';
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
    if (!p.work) return { label: tr('lt_none'), hour: null };
    if (p.inside === p.home) {
      const plan = commutePlanFor(p);
      return { label: tr('lt_work_departure') + ' · ' + tr('lt_plan_' + plan.mode), hour: plan.hour };
    }
    if (p.inside === p.work) {
      if (hour < B.work_start_hour) return { label: tr('lt_work_starts'), hour: B.work_start_hour };
      if (hour < B.work_end_hour) return { label: tr('lt_goal_home'), hour: B.work_end_hour };
    }
    if (p.goal && p.goal.kind === 'home') return { label: tr('lt_goal_home'), hour: null };
    if (p.goal && p.goal.kind === 'park') return { label: tr('lt_goal_park'), hour: null };
    const plan = commutePlanFor(p);
    return { label: tr('lt_work_departure') + ' · ' + tr('lt_plan_' + plan.mode), hour: plan.hour };
  }

  function glyph(type) { return ({ house: '🏠', shop: '🏪', clinic: '✚', police: '★', fire: '🔥', park: '🌳' })[type] || '▣'; }
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
    if (roadModeType()) { roadHoverCell = cellAt(worldPoint(ev)); draw(); }
    if (!pointer || pointer.id !== ev.pointerId) return;
    const dx = ev.clientX - pointer.x, dy = ev.clientY - pointer.y; moved = Math.max(moved, Math.hypot(dx, dy));
    zoneHover = worldPoint(ev);
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
    if (mode === 'busline') { tapBusLine(at); return; }
    if (mode === 'busstop') { createBusStop(at); return; }
    if (mode === 'residential' || mode === 'business' || mode === 'park') {
      const cell = cellAt(at);
      if (!zoneStart) {
        zoneStart = cell; zoneHover = cellPoint(cell); say(tr('lt_zone_second'));
      } else {
        const created = mode === 'park' ? createPark(zoneStart, cell) : createZone(zoneStart, cell, mode);
        zoneStart = null; zoneHover = null;
        if (created !== false && (mode === 'residential' || mode === 'business')) say(tr('lt_zone_first'));
      }
      draw(); return;
    }
    if (roadModeType()) {
      placeRoadPiece(cellAt(at), roadModeType(), roadShape, roadRotation);
      draw();
      return;
    }
    if (['clinic', 'police', 'fire'].includes(mode)) { createAdmin(mode, at); return; }
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
      const hit = roadHitTest(at);
      if (hit) best = { kind: 'road', id: hit.road.id };
    }
    if (!best) {
      const c = cellAt(at), z = town.zones.find(q => q.gx === c.gx && q.gy === c.gy);
      if (z) best = { kind: 'zone', group: z.group };
    }
    selected = best; renderPanel();
  }

  function createFoundingHomes(cells) {
    const founders = town.people.slice().sort((a, b) => a.id - b.id);
    const families = [];
    for (const founder of founders) {
      if (families.some(group => group.some(p => p.id === founder.id))) continue;
      const partner = person(founder.partner);
      families.push(partner ? [founder, partner] : [founder]);
    }
    for (let i = 0; i < families.length; i++) {
      const at = cellPoint(cells[i]), members = families[i];
      const b = { id: town.next_building++, type: 'house', x: at.x, y: at.y,
        owner: members[0].id, owners: members.map(p => p.id), residents: members.map(p => p.id), workers: [], jobs: 0,
        built: 1, development: 1, capacity: 2, name: tr('lt_founders_home') + ' ' + (i + 1) };
      town.buildings.push(b);
      for (const p of members) {
        p.home = b.id; p.inside = b.id; p.x = b.x; p.y = b.y; p.goal = null;
      }
    }
    town.founding = false;
    const first = town.buildings[town.buildings.length - families.length];
    mode = null; cam.x = first.x; cam.y = first.y; cam.z = 4.2;
    addEvent('lt_event_home', {}); renderTools(); renderHud();
    say(tr('lt_first_business')); push();
  }

  function placeRoadPiece(cell, type, shape, rotation) {
    const spec = B.road_types[type];
    if (!spec) return false;
    if (cellHasRoad(cell)) { say(tr('lt_road_delete_first')); return false; }
    if (town.buildings.some(b => b.type === 'park' ?
      (b.cells || []).some(c => c.gx === cell.gx && c.gy === cell.gy) :
      (() => { const bc = cellAt(b); return bc.gx === cell.gx && bc.gy === cell.gy; })())) {
      say(tr('lt_zone_occupied')); return false;
    }
    const path = roadPieceGeometry(shape, rotation, cell);
    const a = path[0], b = path[path.length - 1];
    const nx = b.x - a.x, ny = b.y - a.y, nl = Math.hypot(nx, ny) || 1;
    const length = pathLength(path);
    const first = town.roads.length === 0;
    const cost = Math.ceil(length * spec.cost);
    if (town.treasury < cost) { say(tr('lt_no_money')); return false; }
    town.treasury -= cost;
    town.roads.push({ id: town.next_road++, x1: a.x, y1: a.y, x2: b.x, y2: b.y, path,
      end_dx: nx / nl, end_dy: ny / nl, type, shape, rotation, cell: { gx: cell.gx, gy: cell.gy },
      dir: 1, speed_kmh: spec.speed_kmh });
    say(first && type === 'dirt' ? tr('lt_first_road_done') : tr('lt_road_cost', { n: money(cost) }));
    town.transit_version++; push(); renderHud();
    return true;
  }
  function deleteRoad(id) {
    const road = town.roads.find(r => r.id === id); if (!road) return;
    const affectedLines = town.busLines.filter(line => (line.roadIds || []).includes(id));
    const affectedLineIds = new Set(affectedLines.map(line => line.id));
    for (const bus of town.buses.filter(bus => affectedLineIds.has(bus.lineId))) {
      for (const personId of bus.passengers || []) {
        const p = person(personId); if (!p) continue;
        p.riding = null; p.x = bus.x; p.y = bus.y; p.inside = null; resetTravel(p);
      }
    }
    town.buses = town.buses.filter(bus => !affectedLineIds.has(bus.lineId));
    town.busLines = town.busLines.filter(line => !affectedLineIds.has(line.id));
    for (const car of town.cars.filter(car => (car.roadIds || []).includes(id))) {
      for (const personId of car.passengers || []) {
        const p = person(personId); if (!p) continue;
        p.riding = null; p.x = car.x; p.y = car.y; p.inside = null; resetTravel(p);
      }
    }
    town.cars = town.cars.filter(car => !(car.roadIds || []).includes(id));
    town.roads = town.roads.filter(r => r.id !== id);
    selected = null; town.transit_version++; say(tr('lt_road_deleted')); push(); renderPanel(); renderHud();
  }
  // Each tap routes from the previous point along the road network (turns
  // and all), same as a resident would walk it. Tapping back near the start
  // (with at least 4 points already placed) closes the loop and finalizes
  // the line - it will then run forever in that one rotational direction.
  function tapBusLine(at) {
    const anchor = roadAnchor(at, true);
    if (!anchor) { say(tr('lt_bus_need_road')); return; }
    const point = anchor.point;
    if (!lineDraft) {
      lineDraft = { points: [point], roadIds: [] };
      say(tr('lt_bus_line_next')); draw(); return;
    }
    const last = lineDraft.points[lineDraft.points.length - 1];
    if (lineDraft.points.length >= 4 && dist(point, lineDraft.points[0]) <= LINE_CLOSE_DIST) {
      const closing = buildRoute(last, lineDraft.points[0], true);
      if (!closing) { say(tr('lt_bus_no_route')); return; }
      lineDraft.points.push(...closing.points.slice(1));
      lineDraft.roadIds.push(...closing.roadIds);
      finishBusLine();
      return;
    }
    const leg = buildRoute(last, point, true);
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
    mode = null; say(tr('lt_bus_line_done'));
    selected = { kind: 'line', id };
    town.transit_version++; renderTools(); renderPanel(); push();
  }
  function createBusStop(at) {
    const anchor = roadAnchor(at, true);
    if (!anchor) { say(tr('lt_bus_need_road')); return; }
    if (town.treasury < B.bus_stop_cost) { say(tr('lt_no_money')); return; }
    town.treasury -= B.bus_stop_cost;
    town.busStops.push({ id: town.next_bus_stop++, x: anchor.point.x, y: anchor.point.y });
    say(tr('lt_bus_stop_done'));
    town.transit_version++; push(); renderHud(); draw();
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
  function createZone(a, b, kind) {
    const x0 = Math.min(a.gx, b.gx), x1 = Math.max(a.gx, b.gx);
    const y0 = Math.min(a.gy, b.gy), y1 = Math.max(a.gy, b.gy);
    const occupied = new Set(town.zones.map(cellKey));
    const fresh = [];
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const c = { gx, gy }; if (!occupied.has(cellKey(c)) && !cellHasPark(c)) fresh.push(c);
    }
    if (!fresh.length) return say(tr('lt_zone_occupied'));
    if (town.founding && kind === 'residential' && fresh.length < 3) { say(tr('lt_need_three_homes')); return false; }
    const cost = Math.ceil(fresh.length * B.zone_cost);
    if (town.treasury < cost) return say(tr('lt_no_money'));
    town.treasury -= cost;
    const group = town.next_zone_group++, tax = .10;
    for (const c of fresh) town.zones.push({ id: town.next_zone++, kind, gx: c.gx, gy: c.gy, group, tax_rate: tax });
    if (town.founding && kind === 'residential') {
      const sites = [a].concat(fresh.filter(c => cellKey(c) !== cellKey(a))).slice(0, 3);
      createFoundingHomes(sites);
    } else if (kind === 'business' && !town.buildings.some(b => b.type === 'shop')) {
      const investor = town.people.slice().sort((a, b) => b.money - a.money)[0];
      const site = fresh.find(c => !cellHasRoad(c));
      const at = site && cellPoint(site), cost = at ? businessCostAt(at) : Infinity;
      if (at && investor && investor.money >= cost) createPrivate('shop', at, investor, cost);
      say(tr('lt_zone_done', { n: fresh.length })); push(); renderHud();
    } else {
      say(tr('lt_zone_done', { n: fresh.length })); push(); renderHud();
    }
  }
  function createAdmin(type, at) {
    const spec = B.admin[type];
    at = cellPoint(cellAt(at));
    if (cellHasRoad(cellAt(at)) || cellHasPark(cellAt(at)) ||
        town.buildings.some(b => cellKey(cellAt(b)) === cellKey(cellAt(at)))) {
      say(tr('lt_zone_occupied')); return;
    }
    if (town.treasury < spec.cost) return say(tr('lt_no_money'));
    town.treasury -= spec.cost;
    town.buildings.push({ id: town.next_building++, type, x: at.x, y: at.y, owner: null,
      residents: [], workers: [], jobs: spec.jobs, wage: spec.wage, built: 1,
      name: tr('lt_b_' + type), capacity: spec.jobs * 2 });
    mode = null; fillJobs(); renderTools(); renderHud(); push();
  }
  function createPark(a, b) {
    const x0 = Math.min(a.gx, b.gx), x1 = Math.max(a.gx, b.gx);
    const y0 = Math.min(a.gy, b.gy), y1 = Math.max(a.gy, b.gy);
    const zoned = new Set(town.zones.map(cellKey));
    const cells = [];
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const c = { gx, gy };
      if (zoned.has(cellKey(c)) || cellHasRoad(c) || cellHasPark(c)) continue;
      if (town.buildings.some(bd => cellKey(cellAt(bd)) === cellKey(c))) continue;
      cells.push(c);
    }
    if (!cells.length) return say(tr('lt_zone_occupied'));
    const cost = Math.ceil(cells.length * B.park_cost_per_cell);
    if (town.treasury < cost) return say(tr('lt_no_money'));
    town.treasury -= cost;
    const center = cellPoint(cells[Math.floor(cells.length / 2)]);
    town.buildings.push({ id: town.next_building++, type: 'park', x: center.x, y: center.y, owner: null,
      residents: [], workers: [], jobs: 0, built: 1, level: cells.length, cost, cells,
      name: tr('lt_b_park') });
    say(tr('lt_park_done', { n: cells.length })); mode = null; renderTools(); renderHud(); push(); draw();
  }

  function zoneOverlayVisible() {
    if (category === 'zone' || mode === 'residential' || mode === 'business' || mode === 'park') return true;
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
    drawZoneChoice();
    g.lineCap = 'round';
    for (const r of town.roads) drawRoad(r);
    // Transit keeps running in the background, but route overlays are a
    // planning aid: show all routes in the line list and only the selected
    // route in its detail view. The normal town view stays uncluttered.
    const visibleLines = selected && selected.kind === 'lines' ? town.busLines :
      selected && selected.kind === 'line' ? town.busLines.filter(line => line.id === selected.id) : [];
    for (const line of visibleLines) drawBusLinePath(line);
    for (const b of town.buildings) drawBuilding(b);
    drawBuildingAccessIndicators();
    for (const stop of town.busStops) drawBusStop(stop);
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
    const laneRows = type === 'oneway' ? [[2, (r.dir || 1) >= 0 ? 1 : -1], [3, (r.dir || 1) >= 0 ? 1 : -1]] :
      type === 'twoway' ? [[2, 1], [4, -1]] : type === 'avenue' ? [[1, 1], [2, 1], [3, -1], [4, -1]] :
      type === 'highway' ? [[0, 1], [1, 1], [2, 1], [3, -1], [4, -1], [5, -1]] : [];
    for (const lane of laneRows) drawArrowRow((lane[0] - 2.5) * SUB, len, SUB * 3.2, lane[1]);
    g.restore();
  }

  function drawCurvedRoadArrows(road, points) {
    const type = road.type || 'dirt';
    const lanes = type === 'oneway' ? [[2, (road.dir || 1) >= 0 ? 1 : -1], [3, (road.dir || 1) >= 0 ? 1 : -1]] :
      type === 'twoway' ? [[2, 1], [4, -1]] : type === 'avenue' ? [[1, 1], [2, 1], [3, -1], [4, -1]] :
      type === 'highway' ? [[0, 1], [1, 1], [2, 1], [3, -1], [4, -1], [5, -1]] : [];
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
    } else if (selected.kind === 'zone') {
      for (const cell of town.zones.filter(z => z.group === selected.group)) outlineCell(cell);
    }
    g.restore();
  }

  function drawBuildingAccessIndicators() {
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of town.buildings) {
      if (b.type === 'park' || (b.built || 0) < 1) continue;
      const access = buildingRoadAccess(b, false);
      const isSelected = selected && selected.kind === 'building' && selected.id === b.id;
      if (!access) {
        g.fillStyle = '#e63946'; g.strokeStyle = '#4a0d12'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(b.x + CELL * .32, b.y - CELL * .32, SUB * .58, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(SUB * .72) + 'px system-ui';
        g.fillText('!', b.x + CELL * .32, b.y - CELL * .32 + .4);
      } else if (access.entrance) {
        if (isSelected) {
          g.strokeStyle = '#6fdb89'; g.lineWidth = 3; g.setLineDash([3, 3]);
          g.beginPath(); g.moveTo(access.entrance.x, access.entrance.y); g.lineTo(access.point.x, access.point.y); g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = '#36b85a'; g.strokeStyle = '#173f25'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(access.entrance.x, access.entrance.y, SUB * .58, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(SUB * .7) + 'px system-ui';
        g.fillText('✓', access.entrance.x, access.entrance.y + .3);
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
  function drawBusLinePath(line) {
    if (line.points.length < 2) return;
    g.save(); g.strokeStyle = line.color; g.globalAlpha = .55; g.lineWidth = 3; g.setLineDash([2, 6]);
    g.beginPath(); g.moveTo(line.points[0].x, line.points[0].y);
    for (let i = 1; i < line.points.length; i++) g.lineTo(line.points[i].x, line.points[i].y);
    g.closePath(); g.stroke(); g.restore();
  }
  function drawBusStop(stop) {
    g.save(); g.fillStyle = '#ffd166'; g.strokeStyle = '#3a2f16'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(stop.x, stop.y, SUB * .38, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = 'bold ' + Math.round(SUB * .55) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🚏', stop.x, stop.y - SUB * .05); g.restore();
  }
  function drawCar(car) {
    const r = SUB * .32;
    const pos = vehicleDrawPosition(car, car.roadIds && car.roadIds[car.seg], car.points && car.points[car.seg], car.points && car.points[car.seg + 1]);
    g.save(); g.fillStyle = car.color; g.strokeStyle = '#111'; g.lineWidth = 1;
    g.fillRect(pos.x - r, pos.y - r * .6, r * 2, r * 1.2); g.strokeRect(pos.x - r, pos.y - r * .6, r * 2, r * 1.2);
    g.restore();
  }
  function drawBus(bus, line) {
    const color = line ? line.color : '#888', w = SUB * .95, h = SUB * .55;
    const seg = line && bus.seg % line.points.length;
    const pos = vehicleDrawPosition(bus, line && line.roadIds[seg], line && line.points[seg], line && line.points[(seg + 1) % line.points.length]);
    g.save(); g.fillStyle = color; g.strokeStyle = '#111'; g.lineWidth = 1.2;
    g.fillRect(pos.x - w / 2, pos.y - h / 2, w, h); g.strokeRect(pos.x - w / 2, pos.y - h / 2, w, h);
    g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(SUB * .45) + 'px system-ui';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚌', pos.x, pos.y);
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
    return { x: vehicle.x - dy / len * offset, y: vehicle.y + dx / len * offset };
  }
  function drawLineDraft() {
    if (!lineDraft || !lineDraft.points.length) return;
    g.save(); g.strokeStyle = '#ffd166'; g.lineWidth = 3; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(lineDraft.points[0].x, lineDraft.points[0].y);
    for (let i = 1; i < lineDraft.points.length; i++) g.lineTo(lineDraft.points[i].x, lineDraft.points[i].y);
    g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd166';
    for (const p of lineDraft.points) { g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  function drawRoadPreview() {
    const type = roadModeType();
    if (!type || !roadHoverCell) return;
    const spec = B.road_types[type];
    if (!spec) return;
    const cell = roadHoverCell;
    const blocked = cellHasRoad(cell) || town.buildings.some(b => b.type === 'park' ?
      (b.cells || []).some(c => c.gx === cell.gx && c.gy === cell.gy) :
      (() => { const bc = cellAt(b); return bc.gx === cell.gx && bc.gy === cell.gy; })());
    const path = roadPieceGeometry(roadShape, roadRotation, cell);
    g.save(); g.globalAlpha = .6; g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = blocked ? '#e74c3c' : '#ffd166'; g.lineWidth = CELL * .62;
    g.beginPath(); g.moveTo(path[0].x, path[0].y);
    for (const p of path.slice(1)) g.lineTo(p.x, p.y);
    g.stroke();
    g.restore();
  }
  function drawZoneChoice() {
    if (!zoneStart || !zoneHover || (mode !== 'residential' && mode !== 'business' && mode !== 'park')) return;
    const end = cellAt(zoneHover), x0 = Math.min(zoneStart.gx, end.gx), x1 = Math.max(zoneStart.gx, end.gx);
    const y0 = Math.min(zoneStart.gy, end.gy), y1 = Math.max(zoneStart.gy, end.gy);
    g.fillStyle = mode === 'residential' ? 'rgba(111,203,137,.20)' : mode === 'business' ? 'rgba(105,165,255,.20)' : 'rgba(90,200,120,.20)';
    g.strokeStyle = mode === 'residential' ? '#7fdb9d' : mode === 'business' ? '#79adff' : '#5ad07a'; g.lineWidth = 5;
    g.fillRect(x0 * CELL, y0 * CELL, (x1 - x0 + 1) * CELL, (y1 - y0 + 1) * CELL);
    g.strokeRect(x0 * CELL + 2, y0 * CELL + 2, (x1 - x0 + 1) * CELL - 4, (y1 - y0 + 1) * CELL - 4);
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
    const walkRoad = roadAnchor(p, false);
    if (walkRoad && roadSpec(walkRoad.road).pedestrian_access !== false && walkRoad.distance < CELL * .7) {
      const dx = next ? next.x - p.x : walkRoad.road.x2 - walkRoad.road.x1;
      const dy = next ? next.y - p.y : walkRoad.road.y2 - walkRoad.road.y1;
      const length = Math.hypot(dx, dy) || 1, side = p.id % 2 ? 1 : -1;
      px -= dy / length * SUB * 2.5 * side; py += dx / length * SUB * 2.5 * side;
    }
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

  function push() { if (town) mp.send({ type: 'lt_state', state: town }); }
  mp.on('lt_start', msg => { if (root && canvas) begin(msg); else pending = msg; });
  mp.registerGame({
    id: GAME_ID, name: tr('lt_title'), renderSetup, renderGame,
    snapshot: () => { push(); return null; },
    pause: () => { paused = true; }, resume: () => { paused = false; last = performance.now(); },
  });
})();
