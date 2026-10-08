// Hearthvale — client.
//
// One valley shared by every player on the server. Game Hub gives each player
// a solo room; the server (mp_game.py + hv_world.py) joins those rooms into a
// single world and relays what everyone does. Everything visual happens here,
// in the browser: the terrain grows from the world's seed, so every player
// sees the same valley without the server ever sending a mesh.
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'hearthvale';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const tr = (k, v) => (window.t ? window.t(k, v) : k);

  let THREE = null;
  let welcome = null;          // last hv_welcome (sent again on every reconnect)
  let app = null;              // the DOM of the game, kept across re-renders
  let ui = {};
  let booted = false, booting = false;

  // ── scene state ──────────────────────────────────────────────────────────
  let renderer, scene, camera, sun, clock, waterTime;
  let T;                        // tuning from the server
  let SIZE, groundAt;
  const obstacles = new Map();  // "cx,cz" -> [{x,z,r}]
  const OB_CELL = 8;
  let me = null;                // { char, x,y,z, ry, vy, anim, grounded }
  const peers = new Map();      // id -> { char, label, name, color, x,y,z,ry, tx,ty,tz,tr, anim }
  const cam = { yaw: Math.PI, pitch: 0.42, dist: 8, x: 0, y: 0, z: 0 };
  let sendClock = 0, lastSent = null;
  let clouds = [];

  // ── gathering state ──────────────────────────────────────────────────────
  // Trees and loose stones grow from the seed like the terrain; their ids are
  // their position in decimetres, which is how the server recognises them.
  const CHUNK = 80;             // nature is built and shown in squares this big
  const chunks = [];            // { x, z, far: [meshes], near: [meshes] }
  const trees = new Map();      // id -> { id, x, z, s, r, pine, th, crown, parts, felled }
  const treeGrid = new Map();
  const stones = new Map();     // id -> { id, x, z, mesh, i, taken }
  const stoneGrid = new Map();
  const piles = new Map();      // id -> { data, group }
  const falling = [];           // trees on their way down
  let inv = { hand: null, pack: [] };
  let chunkClock = 0, promptClock = 0;
  let target = { pick: null, tree: null, fruit: null, growing: false };
  const chopProg = new Map();   // tree id -> { p, at }
  let chopTree = null, chopClock = 0, chopHeld = false;
  let ZERO = null;
  const builds = new Map();     // id -> { data, group, load, rope, obst }
  // The player is never steered directly: a click or a tap on a thing gives
  // its menu, and what is chosen there is done, like in The Sims.
  let goal = null, autoUse = null, drinkHeld = false, drinkClock = 0;
  let housing = null;
  let placing = null;           // what is being placed: { make, ghost, ok, at }
  // The open window of a sled or a frame: { id, other, sel, spot, drag }.
  // `other` is what is shown below it instead of the player's things: a
  // pile ({ pile }) or another sled or frame ({ build }) chosen in the world.
  let cargo = null;
  // Fields: squares of ground marked, dug with a hoe, planted and watered.
  let tilling = null;           // marking squares: { pend, erase, paint, hover, ghost, sig }
  const plots = new Map();      // square key -> { data, group, sig }
  const digProg = new Map();    // square key -> share of it dug
  let digAt = null, digClock = 0, digHeld = false;   // digAt: { c, till } being dug
  let autoTask = null;          // squares worked one after another: { kind, item, at }
  const tasks = [];             // what the player was told to do, in order: { id, label, run, started, at }
  let taskId = 0, taskIdle = 0;
  // The camera looks wherever it is dragged, unless it is locked on the
  // player with the button by the hands.
  let camLock = false, camFree = null;
  let cameraInput = () => {};
  try { camLock = localStorage.getItem('hv_follow') === '1'; } catch (e) { /* private window */ }
  const SLED_W = 1.2, SLED_L = 2.3;   // footprint of a sled and of its frame
  const TOOL_W = 0.9, TOOL_L = 0.75;  // footprint of the frame a tool is made on
  const footOf = (d) => d.make === 'floor' || d.make === 'wall' ? [d.width, d.depth] : (d.make || d.kind) === 'sled' ? [SLED_W, SLED_L] : [TOOL_W, TOOL_L];

  // ── seeded noise ─────────────────────────────────────────────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rand) {
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const grad = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
        case 4: return x; case 5: return -x; case 6: return y; default: return -y;
      }
    };
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t, a, b) => a + t * (b - a);
    return (x, y) => {
      const fx = Math.floor(x), fy = Math.floor(y);
      const X = fx & 255, Y = fy & 255;
      x -= fx; y -= fy;
      const u = fade(x), v = fade(y);
      const a = p[X] + Y, b = p[X + 1] + Y;
      return lerp(v, lerp(u, grad(p[a], x, y), grad(p[b], x - 1, y)),
                     lerp(u, grad(p[a + 1], x, y - 1), grad(p[b + 1], x - 1, y - 1)));
    };
  }

  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ── terrain ──────────────────────────────────────────────────────────────
  // The island: a flat meadow in the middle where everyone arrives, rolling
  // hills around it, a beach and then the sea before the edge of the world.
  function makeHeightFn(seed) {
    const n1 = makeNoise(mulberry32(seed));
    const n2 = makeNoise(mulberry32(seed ^ 0x9e3779b9));
    const fbm = (x, z) => {
      let s = 0, a = 0.5, f = 1;
      for (let o = 0; o < 4; o++) { s += a * n1(x * f, z * f); a *= 0.5; f *= 2.03; }
      return s;
    };
    const half = SIZE / 2;
    return (x, z) => {
      const d = Math.hypot(x, z) / half;
      const coast = d + n2(x * 0.011 + 31.7, z * 0.011 - 12.3) * 0.16;
      const land = 1 - smooth(0.66, 0.93, coast);
      const hills = Math.pow(Math.max(0, fbm(x * 0.0065, z * 0.0065) * 0.9 + 0.5), 1.7) * 30;
      const bumps = n2(x * 0.035, z * 0.035) * 1.1;
      const meadow = smooth(0.06, 0.42, d);
      const h = 2.4 + (hills * meadow) + bumps * (0.35 + 0.65 * meadow);
      return h * land + -6.5 * (1 - land);
    };
  }

  function buildTerrain(heightFn) {
    // Drawn as TILES x TILES separate meshes, so the parts behind the camera
    // or beyond the fog are skipped instead of drawing the whole island.
    const TILES = 8, span = SIZE + 180, seg = 320, step = span / seg, half = span / 2, cols = seg + 1;
    const H = new Float32Array(cols * cols);
    for (let iz = 0; iz < cols; iz++) {
      for (let ix = 0; ix < cols; ix++) H[iz * cols + ix] = heightFn(ix * step - half, iz * step - half);
    }
    // The exact surface of the mesh, triangle by triangle, so feet stand on
    // what is drawn rather than on the smooth function behind it.
    groundAt = (x, z) => {
      const gx = (x + half) / step, gz = (z + half) / step;
      const ix = Math.max(0, Math.min(seg - 1, Math.floor(gx)));
      const iz = Math.max(0, Math.min(seg - 1, Math.floor(gz)));
      const fx = Math.max(0, Math.min(1, gx - ix)), fz = Math.max(0, Math.min(1, gz - iz));
      const ha = H[iz * cols + ix], hd = H[iz * cols + ix + 1];
      const hb = H[(iz + 1) * cols + ix], hc = H[(iz + 1) * cols + ix + 1];
      if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
      return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
    };

    const rand = mulberry32(welcome.seed ^ 0x51ed);
    const tint = makeNoise(mulberry32(welcome.seed ^ 0x77));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const tileSeg = seg / TILES, tileSpan = tileSeg * step;
    for (let tz = 0; tz < TILES; tz++) {
      for (let tx = 0; tx < TILES; tx++) {
        const geo = new THREE.PlaneGeometry(tileSpan, tileSpan, tileSeg, tileSeg);
        geo.rotateX(-Math.PI / 2);
        geo.translate(-half + (tx + 0.5) * tileSpan, 0, -half + (tz + 0.5) * tileSpan);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const ix = Math.round((pos.getX(i) + half) / step), iz = Math.round((pos.getZ(i) + half) / step);
          pos.setY(i, H[iz * cols + ix]);
        }
        const flat = geo.toNonIndexed();
        geo.dispose();
        flat.computeVertexNormals();
        colorTerrain(flat, rand, tint);
        const mesh = new THREE.Mesh(flat, mat);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }

    const bed = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: '#b9a777', roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -6.6;
    scene.add(bed);
  }

  function colorTerrain(flat, rand, tint) {
    const p = flat.attributes.position, nrm = flat.attributes.normal;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color('#86b94e'), grassB = new THREE.Color('#5d9a3d'), grassC = new THREE.Color('#a3c25a');
    const sand = new THREE.Color('#e4d29b'), wet = new THREE.Color('#bfa774');
    const rock = new THREE.Color('#8f8b80'), high = new THREE.Color('#6d8f45');
    for (let i = 0; i < p.count; i += 3) {
      const h = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const up = nrm.getY(i);
      const shore = shoreLevel(cx, cz);
      if (shore !== null && h < shore + 0.4) c.copy(wet);
      else if (h < -0.6) c.copy(wet);
      else if (h < 1.1) c.copy(sand);
      else if (up < 0.78) c.copy(rock).lerp(high, 0.25);
      else {
        const k = tint(cx * 0.02, cz * 0.02) * 0.5 + 0.5;
        c.copy(grassB).lerp(grassA, k);
        if (k > 0.72) c.lerp(grassC, (k - 0.72) * 2);
        if (h > 16) c.lerp(high, Math.min(1, (h - 16) / 10));
        if (h < 1.6) c.lerp(sand, (1.6 - h) / 0.5 * 0.6);
      }
      const j = 0.96 + rand() * 0.08;
      for (let v = 0; v < 3; v++) {
        colors[(i + v) * 3] = c.r * j; colors[(i + v) * 3 + 1] = c.g * j; colors[(i + v) * 3 + 2] = c.b * j;
      }
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function buildWater() {
    const geo = new THREE.PlaneGeometry(3200, 3200, 200, 200);
    const mat = new THREE.MeshStandardMaterial({
      color: '#3fa2b8', transparent: true, opacity: 0.84, roughness: 0.18, metalness: 0.05, flatShading: true,
    });
    waterTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = waterTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'transformed.z += sin(position.x * 0.09 + uTime * 0.9) * 0.22 + cos(position.y * 0.075 + uTime * 0.7) * 0.22;');
    };
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    scene.add(water);
  }

  function buildSky() {
    const top = new THREE.Color('#4f97d8'), horizon = new THREE.Color('#d3e9f1');
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: top }, horizon: { value: horizon } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP;' +
        'void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.8)), 1.0);\n' +
        '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 16), mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    sky.onBeforeRender = () => sky.position.copy(camera.position);
    scene.add(sky);
    scene.fog = new THREE.Fog(horizon.clone(), 160, 540);
    scene.background = horizon.clone();
  }

  function buildClouds(rand) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, fog: false, emissive: '#dfe9f0', emissiveIntensity: 0.35 });
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Group();
      const parts = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < parts; k++) {
        const m = new THREE.Mesh(geo, mat);
        const s = 5 + rand() * 6;
        m.scale.set(s * 1.4, s * 0.8, s);
        m.position.set((k - parts / 2) * 7 + rand() * 4, rand() * 3, rand() * 6 - 3);
        g.add(m);
      }
      g.position.set(rand() * 1800 - 900, 85 + rand() * 30, rand() * 1800 - 900);
      g.userData.speed = 1.2 + rand() * 1.5;
      scene.add(g);
      clouds.push(g);
    }
  }

  // ── water: ponds and rivers ──────────────────────────────────────────────
  // Planned from the seed on top of the island's own height function, so every
  // player gets the same ones. The ground is shaped around them (carveGround)
  // and a water surface is laid at their level (buildInlandWater). Rivers run
  // from the hills to the sea; ponds are rare.
  const ponds = [];             // { id, x, z, ax, az, c, s, h0, lvl, far2 }
  const rivers = [];            // { pts: [{ x, z, y, l }] }
  const riverCell = new Map();  // "i,j" (RC metres) -> river segments that reach that square
  const RIVER_W = 12, RIVER_BANK = 24, RC = 48, POND_DEPTH = 1.4;
  const RV = { d: 0, lvl: 0, x: 0, z: 0 };   // what nearRiver found, reused

  function pondQ(p, x, z) {
    // 1 on the edge of the pond's flat, 0 in its middle.
    const dx = x - p.x, dz = z - p.z;
    return Math.hypot((dx * p.c + dz * p.s) / p.ax, (-dx * p.s + dz * p.c) / p.az);
  }

  function nearRiver(x, z) {
    const list = riverCell.get(Math.floor(x / RC) + ',' + Math.floor(z / RC));
    if (!list) return false;
    let bd = Infinity;
    for (const s of list) {
      let t = ((x - s.ax) * s.vx + (z - s.az) * s.vz) / s.l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + s.vx * t, pz = s.az + s.vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; RV.d = d; RV.lvl = s.la + (s.lb - s.la) * t; RV.x = px; RV.z = pz; }
    }
    return bd < Infinity;
  }

  function planWater(base) {
    ponds.length = 0; rivers.length = 0; riverCell.clear();
    const seed = welcome.seed, half = SIZE / 2;
    const rnd = mulberry32((seed ^ 0x5eed7a) >>> 0);
    const bend = makeNoise(mulberry32((seed ^ 0x41b3) >>> 0));
    const slopeOf = (x, z) => {
      const e = 3;
      return Math.max(Math.abs(base(x + e, z) - base(x - e, z)), Math.abs(base(x, z + e) - base(x, z - e))) / (2 * e);
    };

    // Rivers: a spring in the hills, then downhill and outwards to the shore.
    const wanted = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let n = 0, tries = 0; n < wanted && tries < 16; tries++) {
      let x = 0, z = 0, ok = false;
      for (let i = 0; i < 80 && !ok; i++) {
        const a = rnd() * Math.PI * 2, r = 90 + rnd() * 330;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        const h = base(x, z);
        ok = h > 7 && h < 26;
      }
      if (!ok) continue;
      let dx = x / Math.hypot(x, z), dz = z / Math.hypot(x, z);
      const pts = [];
      let tail = 0;
      for (let i = 0; i < 700 && tail < 3; i++) {
        const h = base(x, z);
        pts.push({ x, z, y: h });
        if (h < 0.6 || Math.hypot(x, z) > half * 0.8) tail++;
        const e = 6, ro = Math.hypot(x, z) || 1;
        const gx = (base(x + e, z) - base(x - e, z)) / (2 * e), gz = (base(x, z + e) - base(x, z - e)) / (2 * e);
        const gl = Math.hypot(gx, gz);
        const ox = x / ro, oz = z / ro;
        const ux = gl > 1e-3 ? -gx / gl : ox, uz = gl > 1e-3 ? -gz / gl : oz;
        const m = bend(i * 0.09 + tries * 13.1, 7.7) * 0.5;
        const vx = dx * 0.62 + ux * 0.3 + ox * 0.15 - dz * m, vz = dz * 0.62 + uz * 0.3 + oz * 0.15 + dx * m;
        const vl = Math.hypot(vx, vz) || 1;
        dx = vx / vl; dz = vz / vl;
        x += dx * 8; z += dz * 8;
      }
      // It has to reach the sea within a sensible way, or it is no river.
      if (pts.length < 20 || pts.length > 150 || tail < 3) continue;
      // The water only ever runs downhill: its level is the lowest the ground
      // has been so far, smoothed.
      let lvl = Infinity;
      pts.forEach(p => { lvl = Math.min(lvl, p.y - 0.7); p.l = Math.max(0.5, lvl); });
      for (let pass = 0; pass < 3; pass++) {
        const sm = pts.map((p, i) => {
          let sum = 0, c = 0;
          for (let k = -2; k <= 2; k++) { const q = pts[i + k]; if (q) { sum += q.l; c++; } }
          return sum / c;
        });
        pts.forEach((p, i) => { p.l = sm[i]; });
      }
      for (let i = 1; i < pts.length; i++) pts[i].l = Math.min(pts[i].l, pts[i - 1].l);
      rivers.push({ pts });
      n++;
      const pad = RIVER_W / 2 + RIVER_BANK + 2;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], vx = b.x - a.x, vz = b.z - a.z;
        const seg = { ax: a.x, az: a.z, vx, vz, l2: vx * vx + vz * vz || 1, la: a.l, lb: b.l };
        for (let i0 = Math.floor((Math.min(a.x, b.x) - pad) / RC); i0 <= Math.floor((Math.max(a.x, b.x) + pad) / RC); i0++) {
          for (let j0 = Math.floor((Math.min(a.z, b.z) - pad) / RC); j0 <= Math.floor((Math.max(a.z, b.z) + pad) / RC); j0++) {
            const key = i0 + ',' + j0;
            if (!riverCell.has(key)) riverCell.set(key, []);
            riverCell.get(key).push(seg);
          }
        }
      }
    }

    const farFromRivers = (x, z, m) => rivers.every(rv => rv.pts.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 > m * m));
    const addPond = (x, z, R, asp, ang) => {
      const h0 = base(x, z);
      const p = { id: 'p' + Math.round(x * 10) + '_' + Math.round(z * 10), x, z, ax: R * asp, az: R / asp,
                  c: Math.cos(ang), s: Math.sin(ang), ang, h0, lvl: h0 - 0.45 };
      p.far2 = (Math.max(p.ax, p.az) * 2.3) ** 2;
      ponds.push(p);
    };
    // The first pond is within reach of where newcomers arrive.
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2, d = 55 + rnd() * 50;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, R = 14 + rnd() * 5, asp = 0.8 + rnd() * 0.4, ang = rnd() * Math.PI;
      const h = base(x, z);
      if (h > 1.8 && h < 12 && slopeOf(x, z) < 0.3 && farFromRivers(x, z, R * 1.6 + 20)) { addPond(x, z, R, asp, ang); break; }
    }
    // The others: about one square of the island in twenty.
    const nC = Math.ceil((half - 4) / CHUNK);
    for (let cx = -nC; cx < nC; cx++) {
      for (let cz = -nC; cz < nC; cz++) {
        const r = mulberry32((seed ^ Math.imul(cx + 4096, 83492791) ^ Math.imul(cz + 4096, 297121507) ^ 0x9f3a) >>> 0);
        const chance = r(), x = cx * CHUNK + 12 + r() * (CHUNK - 24), z = cz * CHUNK + 12 + r() * (CHUNK - 24);
        const R = 13 + r() * 11, asp = 0.75 + r() * 0.55, ang = r() * Math.PI;
        if (chance > 0.07) continue;
        const h = base(x, z), d = Math.hypot(x, z);
        if (h < 1.8 || h > 20 || slopeOf(x, z) > 0.4 || d < 30 || d > half * 0.62) continue;
        if (!farFromRivers(x, z, R * 1.6 + 20) || ponds.some(o => Math.hypot(o.x - x, o.z - z) < 70 + R)) continue;
        addPond(x, z, R, asp, ang);
      }
    }
  }

  // The island's ground with the ponds dug and the river beds cut: the bank
  // beside a river is level with it, and every pond lies in a flat.
  function carveGround(base) {
    const w2 = RIVER_W / 2, inner = w2 * 1.25, bedEdge = w2 * 0.6;
    return (x, z) => {
      let h = base(x, z);
      for (const p of ponds) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz > p.far2) continue;
        const q = pondQ(p, x, z);
        if (q >= 2.2) continue;
        h += (p.h0 - h) * (1 - smooth(1.0, 2.2, q));
        h -= POND_DEPTH * (1 - smooth(0.5, 1.0, q));
      }
      if (nearRiver(x, z) && RV.d < w2 + RIVER_BANK) {
        // The bed is deeper in some reaches and shallow in others: a ford can
        // be waded, even with a sled; the deep parts cannot.
        const wob = 0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.017 + Math.sin(z * 0.013) * 2);
        const bank = RV.lvl + 0.55, bed = RV.lvl - (0.2 + 0.9 * smooth(0.4, 0.65, wob));
        const prof = RV.d >= inner ? bank : bed + (bank - bed) * Math.max(0, (RV.d - bedEdge) / (inner - bedEdge));
        // Not out at sea: the river ends where the land does.
        h += (prof - h) * (1 - smooth(inner, w2 + RIVER_BANK, RV.d)) * smooth(-1.5, 0.8, h);
      }
      return h;
    };
  }

  // True when (x, z) is in water or within `m` metres of it.
  function nearWater(x, z, m) {
    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > p.far2) continue;
      if (pondQ(p, x, z) < 1 + m / Math.min(p.ax, p.az)) return true;
    }
    return nearRiver(x, z) && RV.d < RIVER_W / 2 + m;
  }

  // The level of the water beside this spot, or null: the shore is wet.
  function shoreLevel(x, z) {
    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > p.far2) continue;
      if (pondQ(p, x, z) < 1.15) return p.lvl;
    }
    return nearRiver(x, z) && RV.d < RIVER_W * 0.75 ? RV.lvl : null;
  }

  function buildInlandWater() {
    const mat = new THREE.MeshStandardMaterial({
      color: '#3fa2b8', transparent: true, opacity: 0.82, roughness: 0.18, metalness: 0.05, flatShading: true, side: THREE.DoubleSide,
    });
    const disc = new THREE.CircleGeometry(1, 36);
    ponds.forEach(p => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(disc, mat);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(p.ax, p.az, 1);
      g.add(m);
      g.rotation.y = -p.ang;
      g.position.set(p.x, p.lvl, p.z);
      scene.add(g);
    });
    rivers.forEach(rv => {
      // A ribbon along the river, narrow at the spring, ending where the land does.
      let end = rv.pts.findIndex(p => p.y < 0.3);
      end = end < 0 ? rv.pts.length - 1 : Math.max(2, end);
      const pts = rv.pts.slice(0, end + 1), n = pts.length;
      const pos = new Float32Array(n * 6), nrm = new Float32Array(n * 6), idx = [];
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const hw = RIVER_W / 2 * 1.12 * Math.min(1, 0.3 + i * 0.1), y = p.l + 0.02;
        pos.set([p.x - tz * hw, y, p.z + tx * hw, p.x + tz * hw, y, p.z - tx * hw], i * 6);
        nrm.set([0, 1, 0, 0, 1, 0], i * 6);
        if (i + 1 < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setIndex(idx);
      scene.add(new THREE.Mesh(geo, mat));
    });
  }

  // The pond or the river bend the player can drink from where they stand.
  function drinkSpot() {
    for (const p of ponds) {
      const dx = me.x - p.x, dz = me.z - p.z;
      if (dx * dx + dz * dz > p.far2) continue;
      if (pondQ(p, me.x, me.z) < 0.95 + 2.2 / Math.min(p.ax, p.az)) return p.id;
    }
    if (nearRiver(me.x, me.z) && RV.d < RIVER_W / 2 + 2) return 'r' + Math.round(RV.x * 10) + '_' + Math.round(RV.z * 10);
    return null;
  }

  // ── nature ───────────────────────────────────────────────────────────────
  function addObstacle(x, z, r, ref) {
    const key = Math.floor(x / OB_CELL) + ',' + Math.floor(z / OB_CELL);
    if (!obstacles.has(key)) obstacles.set(key, []);
    obstacles.get(key).push({ x, z, r, ref });
  }

  function removeObstacle(x, z, ref) {
    const list = obstacles.get(Math.floor(x / OB_CELL) + ',' + Math.floor(z / OB_CELL));
    if (!list) return;
    const i = list.findIndex(o => o.ref === ref);
    if (i >= 0) list.splice(i, 1);
  }

  function gridAdd(grid, item) {
    const key = Math.floor(item.x / OB_CELL) + ',' + Math.floor(item.z / OB_CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(item);
  }

  // The closest item of the grid within `reach` of (x, z) that `ok` accepts;
  // `pad` is how far each item itself reaches out (a trunk's radius).
  function gridNearest(grid, x, z, reach, ok, pad) {
    const cx = Math.floor(x / OB_CELL), cz = Math.floor(z / OB_CELL);
    let best = null, bestD = Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = grid.get((cx + i) + ',' + (cz + j));
        if (!list) continue;
        for (const it of list) {
          if (!ok(it)) continue;
          const d = Math.hypot(it.x - x, it.z - z) - (pad ? pad(it) : 0);
          if (d < reach && d < bestD) { best = it; bestD = d; }
        }
      }
    }
    return best;
  }

  const idOf = (prefix, x, z) => prefix + Math.round(x * 10) + '_' + Math.round(z * 10);

  // CRC-32 of a tree's id, as zlib computes it on the server: both sides get
  // the tree's size from it, so the wood it gives matches what is drawn.
  let crcTable = null;
  function crc32(str) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < str.length; i++) c = crcTable[(c ^ str.charCodeAt(i)) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const treeSize = (id) => (crc32(id) % 1000) / 1000;
  const kindOf = (it) => (it && typeof it === 'object' ? it.k : it) || null;
  // Things in the inventory and on a sled: a name, a tool {k, w} or a stack
  // of fruit {k, n, at}. How many pieces, how fresh, how heavy.
  const countOf = (it) => (it && typeof it === 'object' && it.n ? it.n : it ? 1 : 0);
  const serverNow = () => Date.now() / 1000 + fruitOff;
  function qualityOf(it) {
    const life = it && typeof it === 'object' && T && T.items[it.k] && T.items[it.k].life;
    return life ? Math.max(0, Math.min(1, 1 - (serverNow() - it.at) / life)) : 1;
  }
  function loadTotals(load) {
    let kg = 0, l = 0;
    (load || []).forEach(e => { const i = T.items[kindOf(e)]; if (i) { kg += i.kg * countOf(e); l += i.l * countOf(e); } });
    return { kg, l };
  }
  const fmt = (v) => (Math.round(v * 10) / 10).toString();

  function slopeAt(x, z) {
    const e = 1.5;
    return Math.max(Math.abs(groundAt(x + e, z) - groundAt(x - e, z)), Math.abs(groundAt(x, z + e) - groundAt(x, z - e))) / (2 * e);
  }

  function instanced(geo, mat, list, shadow) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const o = new THREE.Object3D();
    list.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      o.scale.set(it.sx, it.sy, it.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, it.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  function hideInstance(mesh, i) {
    mesh.setMatrixAt(i, ZERO);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Every square of the island grows from a generator of its own, so what
  // stands in one square never depends on another — the same tree is always
  // in the same place, with the same id, for every player.
  function buildNature() {
    const half = SIZE / 2 - 4;
    const n = Math.ceil(half / CHUNK);
    const density = makeNoise(mulberry32(welcome.seed ^ 0x3c6e));
    const flowerPatch = makeNoise(mulberry32(welcome.seed ^ 0x1f2a));
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ flatShading: true, roughness: 0.9 }, o));
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const G = {
      trunk: trunkGeo, crown: new THREE.IcosahedronGeometry(1, 0), pine: new THREE.ConeGeometry(1, 1, 7),
      rock: new THREE.DodecahedronGeometry(1, 0), bush: new THREE.IcosahedronGeometry(1, 0),
      flower: new THREE.OctahedronGeometry(0.11, 0), grass: new THREE.ConeGeometry(0.07, 0.42, 3),
      stone: new THREE.DodecahedronGeometry(1, 0),
    };
    const M = {
      trunk: std({}), crown: std({}), pine: std({}), rock: std({ roughness: 1 }), bush: std({}),
      flower: std({ roughness: 0.6 }), grass: std({}), stone: std({ roughness: 1 }),
    };
    const petals = ['#ffffff', '#f7d84a', '#f29bc0', '#b48cf0', '#ff8a5c'];

    for (let cx = -n; cx < n; cx++) {
      for (let cz = -n; cz < n; cz++) {
        const x0 = cx * CHUNK, z0 = cz * CHUNK;
        let land = false;
        for (let a = 0; a <= 2 && !land; a++) for (let b = 0; b <= 2 && !land; b++) land = groundAt(x0 + a * CHUNK / 2, z0 + b * CHUNK / 2) > 0.2;
        if (!land) continue;
        const rand = mulberry32((welcome.seed ^ Math.imul(cx + 4096, 73856093) ^ Math.imul(cz + 4096, 19349663)) >>> 0);
        const pick = () => {
          const x = x0 + rand() * CHUNK, z = z0 + rand() * CHUNK;
          return Math.abs(x) < half && Math.abs(z) < half ? [x, z] : null;
        };
        const col = (hex, j) => new THREE.Color(hex).offsetHSL((rand() - 0.5) * j, (rand() - 0.5) * j, (rand() - 0.5) * j);
        const L = { trunk: [], crown: [], pine: [], rock: [], bush: [], flower: [], grass: [], stone: [] };
        const chunkTrees = [], chunkStones = [];

        for (let i = 0; i < 70; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.8 || slopeAt(x, z) > 0.55 || Math.hypot(x, z) < 22 || nearWater(x, z, 3)) continue;
          if (density(x * 0.012, z * 0.012) + rand() * 0.5 < 0.18) continue;
          rand();   // keeps the rest of the square where it always was
          const id = idOf('t', x, z), size = treeSize(id);
          const s = 0.7 + size * 0.95;
          const pine = h > 9 ? rand() < 0.75 : rand() < 0.3;
          const th = (pine ? 1.4 : 1.8) * s;
          const tree = { id, x, z, s, r: 0.45 * s, pine, th, logs: 2 + Math.floor(size * 5), parts: [], felled: false };
          tree.parts.push(['trunk', L.trunk.length]);
          L.trunk.push({ x, y: h - 0.1, z, sx: s, sy: th, sz: s, ry: rand() * 6, c: col('#7a5234', 0.05) });
          if (pine) {
            const g = col('#3f7a45', 0.06);
            tree.crown = g;
            tree.parts.push(['pine', L.pine.length], ['pine', L.pine.length + 1]);
            L.pine.push({ x, y: h + th * 0.75, z, sx: 1.7 * s, sy: 2.6 * s, sz: 1.7 * s, ry: rand() * 6, c: g });
            L.pine.push({ x, y: h + th * 0.75 + 1.6 * s, z, sx: 1.25 * s, sy: 2.1 * s, sz: 1.25 * s, ry: rand() * 6, c: g.clone().offsetHSL(0, 0, 0.03) });
          } else {
            const g = col(rand() < 0.15 ? '#c8a23c' : '#5f9e3f', 0.07);
            tree.crown = g;
            const r = 1.6 * s;
            tree.parts.push(['crown', L.crown.length], ['crown', L.crown.length + 1]);
            L.crown.push({ x, y: h + th + r * 0.55, z, sx: r, sy: r * 0.9, sz: r, ry: rand() * 6, c: g });
            L.crown.push({ x: x + (rand() - 0.5) * r, y: h + th + r * 0.2, z: z + (rand() - 0.5) * r, sx: r * 0.7, sy: r * 0.65, sz: r * 0.7, ry: rand() * 6, c: g.clone().offsetHSL(0, 0, -0.03) });
            if (crc32(id + 'f') % 1000 < T.fruit.tree_share) fruitSrc.push({ src: id, kind: 't', x, z, y: h + th + r * 0.55, r });
          }
          addObstacle(x, z, tree.r, tree);
          chunkTrees.push(tree);
        }
        for (let i = 0; i < 12; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < -0.5 || Math.hypot(x, z) < 14 || nearWater(x, z, 3)) continue;
          const s = 0.35 + Math.pow(rand(), 2) * 1.8;
          L.rock.push({ x, y: h + s * 0.15, z, sx: s * (1 + rand() * 0.6), sy: s * (0.55 + rand() * 0.4), sz: s * (1 + rand() * 0.5), rx: rand(), ry: rand() * 6, c: col('#9a978d', 0.05) });
          if (s > 0.6) addObstacle(x, z, s * 0.95);
        }
        // Loose stones small enough to pick up: the first tool there is.
        for (let i = 0; i < 9; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 0.9 || slopeAt(x, z) > 0.6 || nearWater(x, z, 0.5)) continue;
          const s = 0.15 + rand() * 0.08;
          chunkStones.push({ id: idOf('s', x, z), x, z, i: L.stone.length, taken: false });
          L.stone.push({ x, y: h + s * 0.45, z, sx: s * 1.25, sy: s * 0.8, sz: s, rx: rand(), ry: rand() * 6, c: col('#a9a59a', 0.06) });
        }
        for (let i = 0; i < 25; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.6 || slopeAt(x, z) > 0.6 || nearWater(x, z, 2)) continue;
          const s = 0.45 + rand() * 0.55;
          L.bush.push({ x, y: h + s * 0.35, z, sx: s * 1.2, sy: s * 0.85, sz: s * 1.2, ry: rand() * 6, c: col('#4f8a3a', 0.08) });
          const bid = idOf('b', x, z);
          if (crc32(bid + 'b') % 1000 < T.fruit.bush_share) fruitSrc.push({ src: bid, kind: 'b', x, z, y: h + s * 0.35, rx: s * 1.2, ry: s * 0.85 });
        }
        for (let i = 0; i < 100; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.5 || slopeAt(x, z) > 0.5 || flowerPatch(x * 0.03, z * 0.03) < 0.15 || nearWater(x, z, 0.5)) continue;
          L.flower.push({ x, y: h + 0.22, z, sx: 1, sy: 1, sz: 1, ry: rand() * 6, c: col(petals[Math.floor(rand() * petals.length)], 0.04) });
        }
        for (let i = 0; i < 340; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.4 || slopeAt(x, z) > 0.55 || nearWater(x, z, 0.3)) continue;
          const s = 0.7 + rand() * 0.8;
          L.grass.push({ x, y: h + 0.2 * s, z, sx: s, sy: s, sz: s, rx: (rand() - 0.5) * 0.5, ry: rand() * 6, rz: (rand() - 0.5) * 0.5, c: col('#8fc256', 0.08) });
        }

        const meshes = {};
        for (const k of ['trunk', 'crown', 'pine', 'rock', 'bush']) meshes[k] = instanced(G[k], M[k], L[k], true);
        for (const k of ['flower', 'grass', 'stone']) meshes[k] = instanced(G[k], M[k], L[k], k === 'stone');
        chunkTrees.forEach(t => {
          t.parts = t.parts.map(([k, i]) => [meshes[k], i]);
          trees.set(t.id, t);
          gridAdd(treeGrid, t);
        });
        chunkStones.forEach(st => {
          st.mesh = meshes.stone;
          stones.set(st.id, st);
          gridAdd(stoneGrid, st);
        });
        chunks.push({
          x: x0 + CHUNK / 2, z: z0 + CHUNK / 2,
          far: ['trunk', 'crown', 'pine', 'rock', 'bush'].map(k => meshes[k]).filter(Boolean),
          near: ['flower', 'grass', 'stone'].map(k => meshes[k]).filter(Boolean),
        });
      }
    }
  }

  // Trees and rocks are drawn out to the fog, grass, flowers and loose
  // stones only close by, where they can be seen at all.
  function updateChunks() {
    for (const c of chunks) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      const far = d < 520, near = d < 170;
      for (const m of c.far) m.visible = far;
      for (const m of c.near) m.visible = near;
    }
  }

// ── skills, needs, fruit ─────────────────────────────────────────────────
  const SKILL_KEYS = ['woodcutting', 'farming', 'strength', 'stamina'];
  let skills = { woodcutting: 0, farming: 0, strength: 0, stamina: 0 };
  let needs = { food: 100, water: 100, energy: 100, emax: 100 };
  let warnAt = 0, pillTimer = 0;
  const fruitSrc = [];           // every bush and apple tree that bears fruit
  const fruitAt = new Map();     // "src#k" -> server time it was picked
  let fruitOff = 0, fruitMesh = null, fruitSlots = [], fruitClock = 0;

  function levelOf(xp) {
    const c = T.skills;
    let lvl = 1, left = Math.max(0, xp);
    while (lvl < c.max_level) {
      const need = c.base_seconds * Math.pow(c.growth, lvl - 1);
      if (left < need) return { lvl, into: left, need };
      left -= need; lvl++;
    }
    return { lvl, into: 0, need: 0 };
  }
  const boostOf = (lvl) => 1 + (lvl - 1) * T.bonus_at_max / (T.skills.max_level - 1);
  const skillLevel = (k) => levelOf(skills[k] || 0).lvl;

  // How fast the sled being pulled lets the puller walk, 0 when it is too much.
  function sledFactor(b) {
    const kg = loadTotals(b.data.load).kg;
    const limit = T.pull_kg * boostOf(skillLevel('strength'));
    if (kg > limit) return 0;
    return Math.max(T.sled_min_speed, 1 - (1 - T.sled_min_speed) * kg / limit);
  }

  function setStats(w) {
    if (w.skills) skills = Object.assign(skills, w.skills);
    if (w.needs) needs = w.needs;
    renderNeeds();
    renderSkills();
  }

  function renderNeeds() {
    if (!ui.needs) return;
    const rows = [['food', needs.food, 100], ['water', needs.water, 100], ['energy', needs.energy, needs.emax]];
    rows.forEach(([k, v, max]) => {
      const row = ui.needs.querySelector('[data-need="' + k + '"]');
      row.querySelector('i').style.width = Math.max(0, Math.min(100, v / max * 100)).toFixed(1) + '%';
      row.querySelector('b').textContent = Math.round(v) + (k === 'energy' ? '/' + Math.round(max) : '');
      row.classList.toggle('low', v / max < 0.2);
    });
  }

  function renderSkills() {
    if (!ui.skills || !ui.skills.classList.contains('open')) return;
    ui.skills.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'hv-people-title';
    h.textContent = tr('hv_skills');
    ui.skills.appendChild(h);
    SKILL_KEYS.forEach(k => {
      const lv = levelOf(skills[k] || 0), boost = boostOf(lv.lvl);
      const row = document.createElement('div');
      row.className = 'hv-skill';
      const head = document.createElement('div');
      head.className = 'hv-skill-head';
      const name = document.createElement('span');
      name.textContent = tr('hv_skill_' + k);
      const lvl = document.createElement('b');
      lvl.textContent = lv.need ? tr('hv_level', { n: lv.lvl }) : tr('hv_level_max', { n: lv.lvl });
      head.append(name, lvl);
      const bar = document.createElement('div');
      bar.className = 'hv-skill-bar';
      const fill = document.createElement('i');
      fill.style.width = (lv.need ? lv.into / lv.need * 100 : 100).toFixed(1) + '%';
      bar.appendChild(fill);
      const note = document.createElement('div');
      note.className = 'hv-skill-note';
      note.textContent = tr('hv_skill_' + k + '_desc', { x: Math.round((k === 'woodcutting' || k === 'farming' ? (skillLevel(k) + skillLevel('strength')) / 2 : boost) * 100), e: Math.round(T.needs.energy_base * boost) });
      row.append(head, bar, note);
      ui.skills.appendChild(row);
    });
  }

  function showSkillPill(k) {
    const lv = levelOf(skills[k] || 0);
    ui.pillText.textContent = tr('hv_skill_' + k) + ' · ' + (lv.need ? tr('hv_level', { n: lv.lvl }) : tr('hv_level_max', { n: lv.lvl }));
    ui.pillFill.style.width = (lv.need ? lv.into / lv.need * 100 : 100).toFixed(1) + '%';
    ui.pill.classList.add('show');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => ui.pill.classList.remove('show'), 4200);
  }

  // ── fruit ────────────────────────────────────────────────────────────────
  // One mesh for all the fruit on the island. A fruit that has been picked
  // comes back small and grows until it is ripe again.
  function buildFruit() {
    const slots = [];
    fruitSrc.forEach(src => {
      const cfg = T.fruit[src.kind];
      src.slots = [];
      for (let k = 0; k < cfg.n; k++) {
        const a = (k / cfg.n) * Math.PI * 2 + (crc32(src.src + k) % 100) / 60;
        let x, y, z, size;
        if (src.kind === 'b') {
          x = src.x + Math.cos(a) * src.rx * 0.8; z = src.z + Math.sin(a) * src.rx * 0.8;
          y = src.y + src.ry * (0.25 + (k % 2) * 0.3); size = 0.1;
        } else {
          x = src.x + Math.cos(a) * src.r * 0.85; z = src.z + Math.sin(a) * src.r * 0.85;
          y = src.y - src.r * 0.1 + (k % 2) * 0.25; size = 0.2;
        }
        src.slots.push(slots.length);
        slots.push({ src, k, x, y, z, size, key: src.src + '#' + k });
      }
    });
    fruitSlots = slots;
    if (!slots.length) return;
    fruitMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.45 }), slots.length);
    fruitMesh.frustumCulled = false;
    const apple = new THREE.Color('#d8392f'), berry = new THREE.Color('#6a4bd1');
    slots.forEach((sl, i) => fruitMesh.setColorAt(i, sl.src.kind === 't' ? apple : berry));
    scene.add(fruitMesh);
    refreshFruit();
  }

  const fruitNow = () => Date.now() / 1000 + fruitOff;
  const fruitRipe = (src, k) => {
    const at = fruitAt.get(src + '#' + k);
    return at === undefined || fruitNow() - at >= T.fruit.grow;
  };

  function refreshFruit() {
    if (!fruitMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const now = fruitNow();
    fruitSlots.forEach((sl, i) => {
      const t = sl.src.kind === 't' ? trees.get(sl.src.src) : null;
      const at = fruitAt.get(sl.key);
      const frac = at === undefined ? 1 : Math.max(0, Math.min(1, (now - at) / T.fruit.grow));
      if (t && t.felled) { fruitMesh.setMatrixAt(i, ZERO); return; }
      const f = sl.size * (frac >= 1 ? 1 : 0.2 + 0.8 * frac);
      p.set(sl.x, sl.y, sl.z); sc.set(f, f, f);
      fruitMesh.setMatrixAt(i, m.compose(p, q, sc));
    });
    fruitMesh.instanceMatrix.needsUpdate = true;
  }

  // The fruit to eat from here: the closest bush or tree with a ripe one.
  function findFruit() {
    const reach = Math.max(0.6, T.reach + T.fruit.reach - 0.35);
    let best = null, bd = reach * reach, growing = false;
    for (const s of fruitSrc) {
      const dx = s.x - me.x, dz = s.z - me.z, d = dx * dx + dz * dz;
      if (d > reach * reach) continue;
      if (s.kind === 't') { const t = trees.get(s.src); if (t && t.felled) continue; }
      const k = s.slots.findIndex((_, i) => fruitRipe(s.src, i));
      if (k < 0) { growing = true; continue; }
      if (d < bd) { bd = d; best = { src: s.src, k, kind: s.kind }; }
    }
    target.fruit = best;
    target.growing = !best && growing;
  }

  // ── characters ───────────────────────────────────────────────────────────
  let charGeo = null;
  function charGeometries() {
    if (charGeo) return charGeo;
    charGeo = {
      leg: new THREE.CapsuleGeometry(0.085, 0.5, 4, 8),
      shoe: new THREE.BoxGeometry(0.17, 0.09, 0.27),
      torso: new THREE.CapsuleGeometry(0.24, 0.36, 4, 12),
      arm: new THREE.CapsuleGeometry(0.068, 0.4, 4, 8),
      hand: new THREE.SphereGeometry(0.08, 10, 8),
      head: new THREE.SphereGeometry(0.22, 18, 14),
      eye: new THREE.SphereGeometry(0.028, 8, 6),
      brim: new THREE.CylinderGeometry(0.37, 0.37, 0.03, 20),
      crown: new THREE.CylinderGeometry(0.19, 0.22, 0.17, 18),
      band: new THREE.CylinderGeometry(0.222, 0.222, 0.045, 18),
      stone: new THREE.DodecahedronGeometry(0.13, 0),
      log: new THREE.CylinderGeometry(0.14, 0.14, 1.5, 8),
      haft: new THREE.CylinderGeometry(0.03, 0.035, 0.75, 6),
      blade: new THREE.BoxGeometry(0.05, 0.16, 0.2),
      hoeHaft: new THREE.CylinderGeometry(0.03, 0.035, 1.25, 6),
      hoeBlade: new THREE.BoxGeometry(0.18, 0.035, 0.2),
      pail: new THREE.CylinderGeometry(0.17, 0.13, 0.3, 10),
      handle: new THREE.TorusGeometry(0.15, 0.012, 4, 12, Math.PI),
    };
    return charGeo;
  }

  function makeCharacter(color) {
    const G = charGeometries();
    const m = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.75 : r });
    const shirt = m(color), skin = m('#f0c39c', 0.6), pants = m('#4a5874'), shoe = m('#5b3e2b');
    const straw = m('#e6c77b', 0.9), band = m(new THREE.Color(color).offsetHSL(0, 0, -0.18)), eye = m('#2b2b33', 0.3);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mesh = (geo, mat, x, y, z, parent) => {
      const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; (parent || body).add(o); return o;
    };
    const limb = (x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); body.add(g); return g; };

    const legL = limb(-0.12, 0.84), legR = limb(0.12, 0.84);
    [legL, legR].forEach(l => { mesh(G.leg, pants, 0, -0.38, 0, l); mesh(G.shoe, shoe, 0, -0.8, 0.04, l); });
    mesh(G.torso, shirt, 0, 1.17, 0);
    const armL = limb(-0.33, 1.42), armR = limb(0.33, 1.42);
    [armL, armR].forEach(a => { mesh(G.arm, shirt, 0, -0.24, 0, a); mesh(G.hand, skin, 0, -0.5, 0, a); });
    mesh(G.head, skin, 0, 1.72, 0);
    mesh(G.eye, eye, -0.08, 1.75, 0.195); mesh(G.eye, eye, 0.08, 1.75, 0.195);
    mesh(G.brim, straw, 0, 1.87, 0);
    mesh(G.crown, straw, 0, 1.96, 0);
    mesh(G.band, band, 0, 1.91, 0);
    armL.rotation.z = -0.08; armR.rotation.z = 0.08;
    // What the hands hold: a stone in the right hand, a log carried in front.
    const stone = mesh(G.stone, m('#a9a59a', 1), 0, -0.6, 0.06, armR);
    stone.scale.set(1.25, 0.8, 1);
    const log = mesh(G.log, m('#8a5d3b', 0.9), 0, 1.12, 0.42);
    log.rotation.z = Math.PI / 2;
    // An axe: a haft through the fist, a stone head lashed to its top.
    const axe = new THREE.Group();
    axe.position.set(0, -0.52, 0.06);
    axe.rotation.x = Math.PI / 2;
    armR.add(axe);
    const haft = mesh(G.haft, m('#9a7048', 0.9), 0, 0.2, 0, axe);
    haft.castShadow = true;
    mesh(G.blade, m('#9c988e', 1), 0, 0.5, 0.1, axe);
    // A hoe: a long haft with a flat stone blade across its end.
    const hoe = new THREE.Group();
    hoe.position.set(0, -0.52, 0.06);
    hoe.rotation.x = Math.PI / 2;
    armR.add(hoe);
    mesh(G.hoeHaft, m('#9a7048', 0.9), 0, 0.35, 0, hoe);
    mesh(G.hoeBlade, m('#9c988e', 1), 0, 0.95, 0.1, hoe);
    // A wooden bucket hangs from the right hand by its handle.
    const bucket = new THREE.Group();
    bucket.position.set(0, -0.62, 0.04);
    armR.add(bucket);
    mesh(G.pail, m('#8a5d3b', 0.9), 0, -0.22, 0, bucket);
    mesh(G.handle, m('#5b3e2b', 0.8), 0, -0.07, 0, bucket);
    stone.visible = log.visible = axe.visible = hoe.visible = bucket.visible = false;
    return { root, body, legL, legR, armL, armR, stone, log, axe, hoe, bucket, held: null, phase: 0, swing: 0 };
  }

  function setHeld(ch, item) {
    ch.held = item || null;
    ch.stone.visible = item === 'stone';
    ch.log.visible = item === 'log';
    ch.axe.visible = item === 'axe';
    ch.hoe.visible = item === 'hoe';
    ch.bucket.visible = item === 'bucket';
  }

  function animateCharacter(ch, anim, dt) {
    const k = 1 - Math.exp(-dt * 12);
    let leg = 0, arm = 0, armOut = 0.08, bob = 0, armR = null;
    if (anim === 'chop') {
      // The stone comes down hard and goes back up slowly.
      ch.swing += dt * 1.6;
      const t = ch.swing % 1;
      armR = t < 0.7 ? -0.6 - (t / 0.7) * 2.1 : -2.7 + ((t - 0.7) / 0.3) * 2.1;
    } else if (anim === 'dig') {
      // Both hands on the hoe: up over the shoulder, then down into the soil.
      ch.swing += dt * 1.3;
      const t = ch.swing % 1;
      armR = t < 0.6 ? -0.3 - (t / 0.6) * 1.9 : -2.2 + ((t - 0.6) / 0.4) * 1.9;
      arm = armR;
    } else if (anim === 'walk' || anim === 'run') {
      const run = anim === 'run';
      ch.phase += dt * (run ? 11.5 : 7.2);
      const s = Math.sin(ch.phase);
      leg = s * (run ? 0.85 : 0.5);
      arm = -s * (run ? 0.9 : 0.45);
      bob = Math.abs(Math.cos(ch.phase)) * (run ? 0.07 : 0.035);
    } else if (anim === 'jump') {
      leg = 0.45; arm = -2.4; armOut = 0.35;
    } else {
      ch.phase += dt * 2;
      bob = Math.sin(ch.phase) * 0.008;
    }
    ch.legL.rotation.x += (leg - ch.legL.rotation.x) * k;
    ch.legR.rotation.x += ((anim === 'jump' ? -0.3 : -leg) - ch.legR.rotation.x) * k;
    let armL = arm;
    if (armR === null) armR = anim === 'jump' ? arm : -arm;
    if (ch.held === 'log') { armL = armR = -1.25; armOut = 0.02; }
    const kr = anim === 'chop' || anim === 'dig' ? 1 - Math.exp(-dt * 30) : k;
    ch.armL.rotation.x += (armL - ch.armL.rotation.x) * k;
    ch.armR.rotation.x += (armR - ch.armR.rotation.x) * kr;
    ch.armL.rotation.z += (-armOut - ch.armL.rotation.z) * k;
    ch.armR.rotation.z += (armOut - ch.armR.rotation.z) * k;
    ch.body.position.y += (bob - ch.body.position.y) * k;
  }

  function makeLabel(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 112;
    const g = c.getContext('2d');
    g.font = '600 52px system-ui, -apple-system, Segoe UI, sans-serif';
    const w = Math.min(500, g.measureText(text).width + 90);
    const x = (512 - w) / 2;
    g.fillStyle = 'rgba(16,20,24,.72)';
    g.beginPath(); g.roundRect(x, 14, w, 84, 42); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(x + 40, 56, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'middle';
    g.fillText(text, x + 66, 58, w - 84);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    s.scale.set(2.1, 0.46, 1);
    s.position.y = 2.45;
    return s;
  }

  // ── peers ────────────────────────────────────────────────────────────────
  function addPeer(p) {
    if (!scene || peers.has(p.id)) return;
    const ch = makeCharacter(p.color);
    const label = makeLabel(p.name, p.color);
    ch.root.add(label);
    ch.root.position.set(p.x || 0, p.y || 0, p.z || 0);
    ch.root.rotation.y = p.ry || 0;
    setHeld(ch, p.h);
    scene.add(ch.root);
    peers.set(p.id, { ch, label, name: p.name, color: p.color, tx: p.x || 0, ty: p.y || 0, tz: p.z || 0, tr: p.ry || 0, anim: p.a || 'idle' });
    renderPeople();
  }

  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    scene.remove(p.ch.root);
    p.ch.root.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    peers.delete(id);
    renderPeople();
  }

  function resetPeers(list) {
    [...peers.keys()].forEach(removePeer);
    (list || []).forEach(addPeer);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const isTouch = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function buildDom() {
    app = document.createElement('div');
    app.className = 'hv-app';
    app.innerHTML =
      '<div class="hv-stage"></div>' +
      '<div class="hv-top">' +
        '<div class="hv-chip hv-brand">🏡 <span class="hv-name"></span></div>' +
        '<button type="button" class="hv-chip hv-people-btn">👥 <span class="hv-count"></span></button>' +
        '<button type="button" class="hv-chip hv-craft-btn">🔨 <span class="hv-craft-label"></span></button>' +
        '<button type="button" class="hv-chip hv-skills-btn">📈 <span class="hv-skills-label"></span></button>' +
        '<div class="hv-spacer"></div>' +
        '<button type="button" class="hv-chip hv-fullscreen">⛶</button>' +
        '<button type="button" class="hv-chip hv-leave"></button>' +
      '</div>' +
      '<div class="hv-menu"></div>' +
      '<div class="hv-house-plan"></div>' +
      '<div class="hv-people"></div>' +
      '<div class="hv-craft"></div>' +
      '<div class="hv-skills"></div>' +
      '<div class="hv-cargo"></div>' +
      '<div class="hv-tasks"></div>' +
      '<div class="hv-needs">' +
        '<div class="hv-need" data-need="food"><span>🍎</span><div><i></i></div><b></b></div>' +
        '<div class="hv-need" data-need="water"><span>💧</span><div><i></i></div><b></b></div>' +
        '<div class="hv-need" data-need="energy"><span>⚡</span><div><i></i></div><b></b></div>' +
      '</div>' +
      '<div class="hv-pill"><div class="hv-pill-text"></div><div class="hv-pill-bar"><i></i></div></div>' +
      '<div class="hv-toasts"></div>' +
      '<div class="hv-hint"></div>' +
      '<div class="hv-prompt"><div class="hv-prompt-text"></div><div class="hv-bar"><i></i></div></div>' +
      '<div class="hv-inv"><button type="button" class="hv-me"><i></i><b>🔒</b></button><button type="button" class="hv-slot hv-hand"></button><div class="hv-pack"></div></div>' +
      '<div class="hv-loading"><div class="hv-spin"></div><div class="hv-loading-text"></div></div>';
    ui = {
      stage: app.querySelector('.hv-stage'),
      name: app.querySelector('.hv-name'),
      count: app.querySelector('.hv-count'),
      peopleBtn: app.querySelector('.hv-people-btn'),
      people: app.querySelector('.hv-people'),
      leave: app.querySelector('.hv-leave'),
      fullscreen: app.querySelector('.hv-fullscreen'),
      toasts: app.querySelector('.hv-toasts'),
      hint: app.querySelector('.hv-hint'),
      loading: app.querySelector('.hv-loading'),
      loadingText: app.querySelector('.hv-loading-text'),
      prompt: app.querySelector('.hv-prompt'),
      promptText: app.querySelector('.hv-prompt-text'),
      bar: app.querySelector('.hv-bar'),
      barFill: app.querySelector('.hv-bar i'),
      hand: app.querySelector('.hv-hand'),
      pack: app.querySelector('.hv-pack'),
      craftBtn: app.querySelector('.hv-craft-btn'),
      craft: app.querySelector('.hv-craft'),
      skillsBtn: app.querySelector('.hv-skills-btn'),
      skills: app.querySelector('.hv-skills'),
      cargo: app.querySelector('.hv-cargo'),
      tasks: app.querySelector('.hv-tasks'),
      needs: app.querySelector('.hv-needs'),
      pill: app.querySelector('.hv-pill'),
      pillText: app.querySelector('.hv-pill-text'),
      pillFill: app.querySelector('.hv-pill-bar i'),
      menu: app.querySelector('.hv-menu'),
      housePlan: app.querySelector('.hv-house-plan'),
      craftLabel: app.querySelector('.hv-craft-label'),
      me: app.querySelector('.hv-me'),
    };
    setLock(camLock, true);
    app.querySelector('.hv-skills-label').textContent = tr('hv_skills');
    ui.skillsBtn.onclick = () => toggleSkills();
    renderNeeds();
    renderCraftBtn();
    // While a frame is placed or a field marked, the same button ends it.
    ui.craftBtn.onclick = () => { if (housing) stopHousing(); else if (placing) stopPlacing(); else if (tilling) stopTilling(true); else toggleCraft(); };
    ui.hand.title = tr('hv_hands');
    ui.hand.onclick = (e) => { if (inv.hand) slotMenu('hand', e); };
    ui.pack.title = tr('hv_backpack');
    renderInv();
    ui.name.textContent = tr('hv_title');
    ui.leave.textContent = tr('hv_leave');
    ui.fullscreen.onclick = toggleFullscreen;
    document.addEventListener('fullscreenchange', renderFullscreen);
    document.addEventListener('webkitfullscreenchange', renderFullscreen);
    renderFullscreen();
    ui.loadingText.textContent = tr('hv_loading');
    app.classList.toggle('hv-touch', isTouch());
    ui.hint.textContent = tr(isTouch() ? 'hv_controls_touch' : 'hv_controls_mouse') + (isTouch() ? '' : ' · ' + tr('hv_camera_help'));
    ui.peopleBtn.onclick = () => { ui.people.classList.toggle('open'); toggleCraft(false); toggleSkills(false); renderPeople(); };
    ui.leave.onclick = () => {
      ui.leave.disabled = true;
      mp.send({ type: 'hv_exit' });
      setTimeout(() => { location.href = HUB_URL; }, 1500);
    };
    renderPeople();
  }

  function gameFullscreen() {
    return (document.fullscreenElement || document.webkitFullscreenElement) === app;
  }

  function renderFullscreen() {
    if (!ui.fullscreen) return;
    const active = gameFullscreen();
    const label = tr(active ? 'hv_fullscreen_exit' : 'hv_fullscreen');
    ui.fullscreen.textContent = active ? '⊡' : '⛶';
    ui.fullscreen.title = label;
    ui.fullscreen.setAttribute('aria-label', label);
    ui.fullscreen.setAttribute('aria-pressed', String(active));
    fit();
  }

  async function toggleFullscreen() {
    try {
      if (gameFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen unavailable');
        await exit.call(document);
      } else {
        const enter = app.requestFullscreen || app.webkitRequestFullscreen;
        if (!enter) throw new Error('Fullscreen unavailable');
        await enter.call(app);
      }
      renderFullscreen();
    } catch (e) {
      toast(tr('hv_fullscreen_failed'));
    }
  }

  function renderPeople() {
    if (!ui.count) return;
    ui.count.textContent = tr('hv_online', { n: peers.size + 1 });
    if (!ui.people.classList.contains('open')) return;
    ui.people.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'hv-people-title';
    h.textContent = tr('hv_people');
    ui.people.appendChild(h);
    const row = (name, color, mine) => {
      const r = document.createElement('div');
      r.className = 'hv-person';
      const dot = document.createElement('i');
      dot.style.background = color;
      const n = document.createElement('span');
      n.textContent = name + (mine ? ' (' + tr('hv_you') + ')' : '');
      r.append(dot, n);
      ui.people.appendChild(r);
    };
    if (welcome) row(welcome.you.name, welcome.you.color, true);
    peers.forEach(p => row(p.name, p.color, false));
    if (!peers.size) {
      const e = document.createElement('div');
      e.className = 'hv-people-empty';
      e.textContent = tr('hv_alone');
      ui.people.appendChild(e);
    }
  }

  const ICON = { floor: '🟫', wall: '🧱', stone: '🪨', log: '🪵', axe: '🪓', hoe: '⛏', bucket: '🪣', sled: '🛷', apple: '🍎', berries: '🍇' };
  // What stays with the player: never put down, never loaded on a sled.
  const kept = (k) => k === 'axe' || k === 'hoe';

  // An item's icon, with a bar for how worn a tool is.
  function fillSlot(el, it) {
    const k = kindOf(it);
    el.textContent = ICON[k] || '';
    el.classList.toggle('empty', !k);
    el.title = k ? tr('hv_name_' + k) : '';
    if (it && typeof it === 'object' && it.n) {
      // Fruit: how many, and a bar for how fresh it still is.
      const q = qualityOf(it);
      const cnt = document.createElement('b');
      cnt.className = 'hv-count';
      cnt.textContent = it.n;
      el.appendChild(cnt);
      const bar = document.createElement('i');
      bar.className = 'hv-wear';
      bar.style.width = Math.round(q * 100) + '%';
      bar.style.background = q > 0.5 ? '#7ccf5a' : q > 0.2 ? '#f2c14e' : '#e5624f';
      el.appendChild(bar);
      el.title += ' ×' + it.n + ' · ' + (q > 0 ? tr('hv_quality', { n: Math.round(q * 100) }) : tr('hv_rotten'));
    } else if (k === 'bucket' && T) {
      // A bucket: how many waterings or gulps are still in it.
      const bar = document.createElement('i');
      bar.className = 'hv-wear';
      bar.style.width = Math.round(it.w / T.farm.bucket * 100) + '%';
      bar.style.background = '#5ab4f0';
      el.appendChild(bar);
      el.title += ' · ' + tr('hv_bucket_water', { n: it.w, max: T.farm.bucket });
    } else if (it && typeof it === 'object' && T && T.tool_life[k]) {
      const left = Math.max(0, it.w / T.tool_life[k]);
      const bar = document.createElement('i');
      bar.className = 'hv-wear';
      bar.style.width = Math.round(left * 100) + '%';
      bar.style.background = left > 0.5 ? '#7ccf5a' : left > 0.2 ? '#f2c14e' : '#e5624f';
      el.appendChild(bar);
      el.title += ' · ' + tr('hv_wear', { n: Math.ceil(left * 100) });
    }
  }

  function renderInv() {
    if (!ui.hand) return;
    fillSlot(ui.hand, inv.hand);
    ui.hand.title = (ui.hand.title ? ui.hand.title + ' — ' : '') + tr('hv_hands');
    const n = (inv.pack || []).length;
    while (ui.pack.children.length < n) {
      const i = ui.pack.children.length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hv-slot';
      b.onclick = (e) => {
        if (inv.pack[i]) slotMenu(i, e);
        else mp.send({ type: 'hv_hold', slot: i });
      };
      ui.pack.appendChild(b);
    }
    inv.pack.forEach((it, i) => {
      const b = ui.pack.children[i];
      fillSlot(b, it);
    });
    if (ui.craft.classList.contains('open')) renderCraft();
  }

  // ── crafting ─────────────────────────────────────────────────────────────
  // How many of a thing the player carries, in the hands and the backpack.
  function carried(k) {
    return [inv.hand, ...inv.pack].reduce((n, it) => n + (kindOf(it) === k ? countOf(it) : 0), 0);
  }

  function toggleCraft(force) {
    const open = force == null ? !ui.craft.classList.contains('open') : force;
    ui.craft.classList.toggle('open', open);
    ui.craftBtn.classList.toggle('on', open);
    if (open) { ui.people.classList.remove('open'); ui.skills.classList.remove('open'); renderCraft(); }
  }

  // Everything is made the same way: its frame is placed on the ground and
  // the materials are brought to it.
  function renderCraft() {
    ui.craft.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'hv-people-title';
    h.textContent = tr('hv_recipes');
    ui.craft.appendChild(h);
    Object.entries((T && T.builds) || {}).forEach(([name, needs]) => {
      const row = document.createElement('div');
      row.className = 'hv-recipe';
      const icon = document.createElement('div');
      icon.className = 'hv-recipe-icon';
      icon.textContent = ICON[name] || '❔';
      const mid = document.createElement('div');
      mid.className = 'hv-recipe-mid';
      const title = document.createElement('b');
      title.textContent = tr('hv_name_' + name);
      const parts = document.createElement('div');
      parts.className = 'hv-recipe-parts';
      Object.entries(needs).forEach(([k, n]) => {
        const have = carried(k);
        const sp = document.createElement('span');
        sp.className = have >= n ? 'ok' : 'no';
        sp.textContent = (ICON[k] || '') + ' ' + tr('hv_name_' + k) + ' ' + Math.min(have, n) + '/' + n;
        parts.appendChild(sp);
      });
      // A tool the work needs without using it up.
      Object.keys((T.build_tools || {})[name] || {}).forEach(k => {
        const have = carried(k) > 0;
        const sp = document.createElement('span');
        sp.className = have ? 'ok' : 'no';
        sp.textContent = (ICON[k] || '') + ' ' + tr('hv_name_' + k) + ' ' + (have ? '✓' : '✗');
        parts.appendChild(sp);
      });
      mid.append(title, parts);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hv-make';
      btn.textContent = tr('hv_place');
      btn.onclick = () => startPlacing(name);
      row.append(icon, mid, btn);
      ui.craft.appendChild(row);
    });
    for (const [make, door] of [['floor', false], ['wall', false], ['wall', true]]) {
      const row = el('div', 'hv-recipe');
      const mid = el('div', 'hv-recipe-mid');
      mid.appendChild(el('b', null, tr(door ? 'hv_wall_door' : 'hv_name_' + make)));
      mid.appendChild(el('div', 'hv-recipe-parts', tr(make === 'floor' ? 'hv_floor_recipe' : 'hv_wall_recipe', { n: make === 'floor' ? T.housing.floor_logs : T.housing.wall_logs, size: T.housing.cell, max: T.housing.max_side })));
      const btn = el('button', 'hv-make', tr('hv_place')); btn.type = 'button';
      btn.onclick = () => startHousing(make, door);
      row.append(el('div', 'hv-recipe-icon', ICON[make]), mid, btn); ui.craft.appendChild(row);
    }
    // A field: squares of ground marked here and dug with a hoe.
    {
      const row = document.createElement('div');
      row.className = 'hv-recipe';
      const icon = document.createElement('div');
      icon.className = 'hv-recipe-icon';
      icon.textContent = '🌱';
      const mid = document.createElement('div');
      mid.className = 'hv-recipe-mid';
      const title = document.createElement('b');
      title.textContent = tr('hv_field');
      const parts = document.createElement('div');
      parts.className = 'hv-recipe-parts';
      const sp = document.createElement('span');
      sp.textContent = tr('hv_field_note');
      parts.appendChild(sp);
      mid.append(title, parts);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hv-make';
      btn.textContent = tr('hv_mark');
      btn.onclick = () => startTilling();
      row.append(icon, mid, btn);
      ui.craft.appendChild(row);
    }
    const note = document.createElement('div');
    note.className = 'hv-people-empty';
    note.textContent = tr('hv_craft_note');
    ui.craft.appendChild(note);
  }

  function toggleSkills(on) {
    if (!ui.skills) return;
    const open = on === undefined ? !ui.skills.classList.contains('open') : on;
    ui.skills.classList.toggle('open', open);
    if (open) { ui.people.classList.remove('open'); toggleCraft(false); renderSkills(); }
  }

  function doDrink() {
    const water = drinkSpot();
    if (water) mp.send({ type: 'hv_drink', water });
    else if (bucketWater() > 0) mp.send({ type: 'hv_drink', bucket: true });
  }
  // The most water in any bucket carried, in gulps or waterings.
  function bucketWater() {
    let w = 0;
    [inv.hand, ...inv.pack].forEach(it => { if (kindOf(it) === 'bucket') w = Math.max(w, it.w); });
    return w;
  }

  function toast(text) {
    if (!ui.toasts) return;
    const el = document.createElement('div');
    el.className = 'hv-toast';
    el.textContent = text;
    ui.toasts.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3800);
  }

  // ── input ────────────────────────────────────────────────────────────────
  // Dragging looks around; arrows, edge scrolling, Shift/right dragging
  // or two fingers move the camera over the ground,
  // the wheel or a pinch brings it closer, and a short press is a click.
  function bindInput(canvas) {
    // Tiles dragged out of the window of a sled or a frame.
    window.addEventListener('pointermove', cargoMove);
    window.addEventListener('pointerup', cargoUp);
    window.addEventListener('pointercancel', (e) => {
      const g = cargo && cargo.drag;
      if (g && g.id === e.pointerId) { if (g.ghost) g.ghost.remove(); cargo.drag = null; renderCargo(); }
    });

    const drags = new Map();
    const arrows = new Set();
    let edge = null;
    const editable = (target) => target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    window.addEventListener('keydown', (e) => {
      if (!booted || !app.isConnected || editable(e.target) || e.altKey || e.metaKey || e.ctrlKey || !e.key.startsWith('Arrow')) return;
      e.preventDefault();
      arrows.add(e.key);
    });
    window.addEventListener('keyup', (e) => arrows.delete(e.key));
    const resetCameraInput = () => {
      arrows.clear(); edge = null; drags.clear(); pinch = null;
      if (housing && housing.drag !== null) { housing.drag = null; housing.fixed = true; housing.selecting = false; }
    };
    window.addEventListener('blur', resetCameraInput);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetCameraInput(); });
    const cameraBounds = () => gameFullscreen()
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : canvas.getBoundingClientRect();
    const cameraSurface = (target) => target === canvas || target === app || target === ui.stage;
    const trackCameraPointer = (e, leaving = false) => {
      const r = cameraBounds();
      // Fullscreen can report a leave at the physical screen boundary, or
      // hit the app's background in a fractional gap beside the canvas.
      const atScreenEdge = gameFullscreen() && !e.relatedTarget &&
        e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
        e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2 &&
        (e.clientX <= r.left + 2 || e.clientX >= r.right - 2 ||
         e.clientY <= r.top + 2 || e.clientY >= r.bottom - 2);
      const surface = leaving ? cameraSurface(e.relatedTarget) || atScreenEdge : cameraSurface(e.target);
      edge = e.pointerType === 'mouse' && surface && !e.buttons
        ? { x: Math.max(r.left, Math.min(r.right, e.clientX)), y: Math.max(r.top, Math.min(r.bottom, e.clientY)) }
        : null;
    };
    window.addEventListener('pointermove', (e) => trackCameraPointer(e));
    document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) trackCameraPointer(e, true); });
    document.addEventListener('fullscreenchange', resetCameraInput);
    document.addEventListener('webkitfullscreenchange', resetCameraInput);
    cameraInput = (dt) => {
      if (!booted || !app.isConnected || document.hidden || editable(document.activeElement) || (housing && housing.drag !== null) || drags.size || (tilling && tilling.paint) || (cargo && cargo.drag)) return;
      let x = Number(arrows.has('ArrowRight')) - Number(arrows.has('ArrowLeft'));
      let y = Number(arrows.has('ArrowDown')) - Number(arrows.has('ArrowUp'));
      if (!x && !y && edge && !ui.menu.classList.contains('show')) {
        const r = cameraBounds(), band = 24;
        if (edge.x >= r.left && edge.x <= r.right && edge.y >= r.top && edge.y <= r.bottom) {
          x = edge.x > r.right - band ? 1 : edge.x < r.left + band ? -1 : 0;
          y = edge.y > r.bottom - band ? 1 : edge.y < r.top + band ? -1 : 0;
        }
      }
      const n = Math.hypot(x, y);
      if (n) panBy(-x / n * 420 * dt, -y / n * 420 * dt);
    };
    let pinch = null;
    const pair = () => {
      const [a, b] = [...drags.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    canvas.addEventListener('pointerdown', (e) => {
      hideMenu();
      edge = null;
      if (housing && e.pointerType === 'touch' && housing.drag !== null && housing.drag !== e.pointerId) {
        // A second finger changes the gesture to camera pan/zoom. Freeze
        // the plan while both fingers use the normal camera controls.
        const h = housing, p = h.pointer;
        drags.set(h.drag, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now(), pan: true, moved: true });
        const previous = h.press.previous;
        h.anchor = previous.anchor; h.end = previous.end; h.candidate = previous.candidate;
        h.drag = null; h.fixed = true; h.selecting = false;
      }
      if (housing && e.button === 0 && !e.shiftKey && !e.ctrlKey && !drags.size) {
        if (housing.drag !== null) return;
        housing.press = { x: e.clientX, y: e.clientY, selecting: housing.selecting, moved: false,
          previous: { anchor: housing.anchor, end: housing.end, candidate: housing.candidate } };
        housing.fixed = false; housing.pointer = { x: e.clientX, y: e.clientY }; housing.drag = e.pointerId;
        housingPoint(e.clientX, e.clientY, !housing.selecting); canvas.setPointerCapture(e.pointerId); updateHousing(); return;
      }
      // Marking a field: the left button or a finger paints squares.
      if (tilling && e.button === 0 && !e.shiftKey && !e.ctrlKey && !drags.size) {
        tilling.paint = { id: e.pointerId, last: null };
        tilling.erase = null;
        canvas.setPointerCapture(e.pointerId);
        paintAt(e.clientX, e.clientY);
        return;
      }
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(),
        pan: e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey, moved: false });
      canvas.setPointerCapture(e.pointerId);
      if (drags.size === 2) { pinch = pair(); drags.forEach(d => { d.moved = true; }); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (housing && (!drags.size || housing.drag === e.pointerId)) {
        if (e.pointerType !== 'touch' || housing.drag === e.pointerId) housing.pointer = { x: e.clientX, y: e.clientY };
        if (housing.drag === e.pointerId) {
          if (Math.hypot(e.clientX - housing.press.x, e.clientY - housing.press.y) >= 7) housing.press.moved = true;
          housingPoint(e.clientX, e.clientY); return;
        }
      }
      if (tilling && tilling.paint && tilling.paint.id === e.pointerId) { paintAt(e.clientX, e.clientY); return; }
      const d = drags.get(e.pointerId);
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= 7) d.moved = true;
      if (pinch && drags.size === 2) {
        const now = pair();
        if (now.d > 10 && pinch.d > 10) cam.dist = Math.max(3.2, Math.min(32, cam.dist * pinch.d / now.d));
        panBy(now.x - pinch.x, now.y - pinch.y);
        pinch = now;
        return;
      }
      if (d.pan) return panBy(dx, dy);
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(0.08, Math.min(1.25, cam.pitch + dy * 0.004));
    });
    const end = (e) => {
      drags.delete(e.pointerId);
      if (drags.size < 2) pinch = null;
      if (housing && housing.drag === e.pointerId) { housing.drag = null; housing.fixed = true; housing.selecting = false; }
      if (tilling && tilling.paint && tilling.paint.id === e.pointerId) endPaint();
    };
    canvas.addEventListener('pointermove', (e) => {
      if (!booted || e.pointerType === 'touch' || drags.size || markHit) return;
      const now = performance.now();
      if (now - hoverAt < 60) return;
      hoverAt = now;
      if (tilling || placing) {
        const g = groundRay(e.clientX, e.clientY);
        if (tilling) tilling.hover = g ? cellKey(g.x, g.z) : null;
        else placing.at = g && g.kind === 'ground' ? { x: g.x, z: g.z } : null;
        return;
      }
      const h = pickAt(e.clientX, e.clientY);
      hoverHit = h && h.kind !== 'ground' && h.kind !== 'water' ? h : null;
      canvas.style.cursor = hoverHit ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', (e) => { trackCameraPointer(e, true); hoverHit = null; canvas.style.cursor = ''; });
    canvas.addEventListener('pointerup', (e) => {
      if (housing && housing.drag === e.pointerId) {
        const h = housing;
        housingPoint(e.clientX, e.clientY); h.drag = null;
        const moved = h.press.moved || Math.hypot(e.clientX - h.press.x, e.clientY - h.press.y) >= 7;
        // A tap starts the rectangle; the next tap fixes its opposite
        // corner. Dragging still chooses both corners in one gesture.
        h.selecting = h.make === 'floor' && !!h.anchor && !h.press.selecting && !moved;
        h.fixed = !h.selecting;
        updateHousing(); return;
      }
      if (tilling && tilling.paint && tilling.paint.id === e.pointerId) { endPaint(); return; }
      const d = drags.get(e.pointerId), many = drags.size > 1;
      end(e);
      // A short press that did not drag is a click on the world.
      if (!d || !booted || many || d.moved || tilling || e.button !== 0 || performance.now() - d.t0 >= 450) return;
      if (placing) return placeAt(e.clientX, e.clientY);
      if (cargo && cargo.spot) return spotClick(e.clientX, e.clientY);
      if (cargo && cargoPick(e)) return;
      worldClick(e);
    });
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.max(3.2, Math.min(32, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // The button by the hands: a click flies the camera back to the player,
    // a right click or a long press keeps it on them or sets it free.
    let held = null;
    ui.me.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      held = setTimeout(() => { held = 'done'; setLock(!camLock); }, 550);
    });
    const letGo = () => { if (held && held !== 'done') clearTimeout(held); };
    ui.me.addEventListener('pointerup', letGo);
    ui.me.addEventListener('pointerleave', letGo);
    ui.me.onclick = () => {
      if (held === 'done') { held = null; return; }
      held = null;
      if (me && !camLock) camFree = { x: me.x, z: me.z };
    };
    ui.me.oncontextmenu = (e) => {
      e.preventDefault();
      if (held === 'done') return;
      // A long press may call this before the timer does: it counts once.
      if (held) { clearTimeout(held); held = 'done'; } else held = null;
      setLock(!camLock);
    };
  }

  // ── gathering ────────────────────────────────────────────────────────────
  function findTargets() {
    const stone = gridNearest(stoneGrid, me.x, me.z, 1.7, st => !st.taken);
    let pile = null, pd = 2.3;
    piles.forEach(p => {
      const d = Math.hypot(p.data.x - me.x, p.data.z - me.z);
      if (d < pd) { pile = p; pd = d; }
    });
    const sd = stone ? Math.hypot(stone.x - me.x, stone.z - me.z) : Infinity;
    target.pick = stone && sd <= pd ? { stone } : pile ? { pile } : null;
    target.tree = gridNearest(treeGrid, me.x, me.z, 1.4, t => !t.felled, t => t.r);
    // A frame or a sled is reached by facing it, anywhere along its sides.
    const fx = me.x + Math.sin(me.ry) * 0.9, fz = me.z + Math.cos(me.ry) * 0.9;
    let build = null, bd = 0.9;
    builds.forEach(b => {
      // Permanent projects are opened by clicking them explicitly. They
      // must not intercept picking up the logs brought beside a house.
      if (isStructure(b.data)) return;
      const d = footDist(b.data, fx, fz);
      if (d < bd) { build = b; bd = d; }
    });
    target.build = build;
    findFruit();
    // The field square in front of the player, and the nearest ripe fruit
    // on a planted one.
    const now = fruitNow(), px = me.x + Math.sin(me.ry) * 1.2, pz = me.z + Math.cos(me.ry) * 1.2;
    const cr = T.reach + T.fruit.reach - 0.35;
    let plot = null, qd = T.farm.cell, crop = null, cd = cr;
    plots.forEach(p => {
      const d = p.data, dm = Math.hypot(d.x - me.x, d.z - me.z);
      if (dm > T.reach + 2) return;
      const df = Math.hypot(d.x - px, d.z - pz);
      if (df < qd) { qd = df; plot = p; }
      if (d.crop && dm < cd) {
        const k = d.crop.pk.findIndex((_, i) => cropRipe(d, i, now));
        if (k >= 0) { cd = dm; crop = { plot: p, k }; }
      }
    });
    target.plot = plot;
    target.crop = crop;
  }

  // How far (x, z) is from the footprint of a frame or a sled.
  function footDist(d, x, z) {
    if (d.make === 'floor' && d.removed?.length) return Math.min(...buildParts(d).map(p =>
      Math.hypot(Math.max(0, Math.abs(x - p.x) - p.width / 2), Math.max(0, Math.abs(z - p.z) - p.depth / 2))));
    const dx = x - d.x, dz = z - d.z, c = Math.cos(d.ry), s = Math.sin(d.ry);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const [w, l] = footOf(d);
    return Math.hypot(Math.max(0, Math.abs(lx) - w / 2), Math.max(0, Math.abs(lz) - l / 2));
  }

  const myPull = () => { for (const b of builds.values()) if (b.data.by === welcome.you.id) return b; return null; };

  // Nothing needs a prompt but the work under way and what a click does
  // while a frame is placed or a field marked.
  function renderPrompt() {
    if (tilling) return showPrompt([tr('hv_till_mouse')], null);
    if (placing) return showPrompt([tr('hv_place_hint')], null);
    const cp = target.tree && chopProg.get(target.tree.id);
    const dp = digAt && digProg.get(digAt.c);
    showPrompt([], cp ? cp.p : dp != null ? dp : null);
  }

  function showPrompt(lines, prog) {
    const text = lines.join('\n');
    if (ui.promptText.textContent !== text) ui.promptText.textContent = text;
    ui.prompt.classList.toggle('show', lines.length > 0);
    ui.bar.style.display = prog == null ? 'none' : '';
    if (prog != null) ui.barFill.style.width = (prog * 100).toFixed(1) + '%';
  }

  // What taking from a pile is called: a bucket shows the water in it.
  function pileLabel(pd) {
    if (pd.kind === 'bucket') {
      return tr('hv_act_pick', { item: tr('hv_name_bucket') }) + ' · ' + tr('hv_bucket_water', { n: Math.round(pd.at), max: T.farm.bucket });
    }
    return tr('hv_act_take', { item: tr('hv_name_' + pd.kind), n: pd.n });
  }

  function doEat(slot) { mp.send(slot === undefined ? { type: 'hv_eat' } : { type: 'hv_eat', slot }); }

  // Repeats what a chosen action keeps doing.
  function updateAuto() {
    const now = performance.now();
    if ((drinkHeld || autoUse === 'drink') && now - drinkClock >= T.water.gap * 1000 + 100) {
      if ((drinkSpot() || bucketWater() > 0) && needs.water < T.needs.water_max - 1) { drinkClock = now; doDrink(); }
      else { drinkHeld = false; if (autoUse === 'drink') autoUse = null; }
    }
    if (autoUse === 'chop') {
      if (target.tree && !target.tree.felled) chopHeld = true;
      else { autoUse = null; chopHeld = false; }
    }
    // Fruit picked one after another, a moment apart.
    if (gatherAll && !goal && now - gatherAll.at > 350) {
      const g = gatherAll, k = ripeOf(g.src).find(i => !g.tried.has(i));
      if (k === undefined || g.left <= 0) gatherAll = null;
      else { g.tried.add(k); g.left--; g.at = now; mp.send({ type: 'hv_gather', src: g.src, k }); }
    }
    // A field worked square by square: the next one once this one is done.
    if (autoTask && !goal && !digAt && !gatherAll && now - autoTask.at > 700) nextAuto();
  }

  // ── picking fruit ────────────────────────────────────────────────────────
  // A bush, an apple tree or a planted crop: src as the server names it.
  let gatherAll = null;   // { src, left, tried, at }
  function ripeOf(src) {
    if (src[0] === 'f') {
      const p = plots.get(src.slice(1)), d = p && p.data, now = fruitNow();
      return d && d.crop ? d.crop.pk.map((_, i) => i).filter(i => cropRipe(d, i, now)) : [];
    }
    const f = fruitSrc.find(x => x.src === src);
    if (!f || (f.kind === 't' && (trees.get(src) || {}).felled)) return [];
    return f.slots.map((_, i) => i).filter(i => fruitRipe(src, i));
  }
  // Menu lines to pick one, or every ripe one, after walking up to it.
  function fruitItems(items, src, kind, x, z, r) {
    const n = ripeOf(src).length;
    const go = (left) => () => goAct(x, z, r, () => { gatherAll = { src, left, tried: new Set(), at: 0 }; });
    if (n) {
      items.push({ group: tr('hv_m_pick_' + kind), task: true, label: tr('hv_m_pick_' + kind), run: go(1) });
      items.push({ group: tr('hv_m_pick_' + kind), task: true, label: tr('hv_m_pick_all_' + kind), run: go(Infinity) });
    }
    if (src[0] === 'f') {
      items.push({ group: tr('hv_m_pick_' + kind), task: true, label: tr('hv_m_pick_garden_' + kind),
        run: () => goAct(x, z, r, () => startAuto('harvest', kind, src.slice(1))) });
    }
  }

  // ── click controls ───────────────────────────────────────────────────────
  function hideMenu() {
    if (ui.menu) { ui.menu.classList.remove('show'); ui.menu.textContent = ''; }
    markHit = null;
  }

  // A ring on the ground under whatever a click would act on: under the
  // pointer while it hovers, and under the chosen thing while its menu is open.
  let markHit = null, hoverHit = null, markMesh = null, otherMesh = null, hoverAt = 0;
  function markSize(h) {
    if (h.kind === 'tree') return (h.data.r || 0.5) + 0.7;
    if (h.kind === 'build') return h.data.data.kind === 'sled' ? 1.9 : footOf(h.data.data)[1] > 1 ? 1.6 : 0.85;
    if (h.kind === 'pile') return 0.9;
    if (h.kind === 'fruit') return 0.9;
    if (h.kind === 'stone') return 0.7;
    if (h.kind === 'plot') return T.farm.cell * 0.75;
    return 0.45;
  }
  function ringMesh(color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 20;
    scene.add(m);
    return m;
  }
  function ringAt(m, h, pulse) {
    const g = groundAt(h.x, h.z), sl = shoreLevel(h.x, h.z);
    m.position.set(h.x, Math.max(g, sl ?? -Infinity) + 0.08, h.z);
    m.scale.setScalar(markSize(h) * pulse);
    m.visible = true;
  }
  // The window's sled and its second thing keep their rings while it is open.
  function updateMarks() {
    const pulse = 1 + 0.07 * Math.sin(performance.now() / 160);
    const cb = cargo && builds.get(cargo.id), o = cargoOther();
    const h = markHit || (!placing ? hoverHit : null) || (cb ? { kind: 'build', x: cb.data.x, z: cb.data.z } : null);
    if (h) { markMesh = markMesh || ringMesh('#ffd45c'); ringAt(markMesh, h, pulse); }
    else if (markMesh) markMesh.visible = false;
    if (o) { otherMesh = otherMesh || ringMesh('#7fd4ff'); ringAt(otherMesh, { kind: o.pile ? 'pile' : 'build', x: o.d.x, z: o.d.z }, pulse); }
    else if (otherMesh) otherMesh.visible = false;
  }

  // Walk to a place, then do something there.
  // Running there is chosen in the menu of the place, and needs energy.
  function goTo(x, z, r, after, until, run) {
    // Far places get the time it takes to walk there, and some.
    const limit = Math.max(25000, Math.hypot(x - me.x, z - me.z) / T.walk_speed * 1600);
    goal = { x, z, r, after, until, limit, run: !!run, t0: performance.now(), chk: performance.now(), cx: me.x, cz: me.z };
  }
  // Walk up to a thing, face it, refresh what is in reach, then act.
  function goAct(x, z, r, fn, until) {
    goTo(x, z, r, () => {
      me.ry = Math.atan2(x - me.x, z - me.z);
      findTargets();
      fn();
    }, until);
  }

  // ── tasks ────────────────────────────────────────────────────────────────
  // Like in The Sims: every chosen action waits its turn and starts once the
  // one before it is over, whether it finished, failed or could not be done.
  const busy = () => !!(goal || digAt || autoTask || autoUse || drinkHeld || gatherAll);
  function queueTask(label, run) {
    tasks.push({ id: ++taskId, label, run, started: false, at: 0 });
    renderTasks();
  }
  function clearTasks() {
    if (!tasks.length) return;
    tasks.length = 0;
    renderTasks();
  }
  // Taking out the task under way stops it there and then.
  function removeTask(id) {
    const i = tasks.findIndex(t => t.id === id);
    if (i < 0) return;
    if (i === 0 && tasks[0].started) {
      goal = null; autoUse = null; autoTask = null; digAt = null; gatherAll = null;
      chopHeld = false; digHeld = false; drinkHeld = false;
    }
    tasks.splice(i, 1);
    taskIdle = performance.now();
    renderTasks();
  }
  function updateTasks() {
    const t = tasks[0];
    if (!t) return;
    const now = performance.now();
    if (!t.started) {
      // A short pause between tasks lets the server answer the last one.
      if (busy() || now - taskIdle < 350) return;
      t.started = true; t.at = now;
      t.run();
      renderTasks();
      return;
    }
    if (busy()) { taskIdle = now; return; }
    if (now - t.at < 600) return;
    tasks.shift();
    taskIdle = now;
    renderTasks();
  }
  function renderTasks() {
    const box = ui.tasks;
    if (!box) return;
    box.textContent = '';
    box.classList.toggle('show', tasks.length > 0);
    if (!tasks.length) return;
    box.appendChild(el('div', 'hv-tasks-title', tr('hv_tasks')));
    tasks.forEach((t, i) => {
      const row = el('div', 'hv-task' + (t.started ? ' now' : ''));
      row.appendChild(el('span', 'hv-task-n', t.started ? '▶' : String(i + 1)));
      row.appendChild(el('span', 'hv-task-label', t.label));
      const x = el('button', 'hv-task-x', '×');
      x.type = 'button';
      x.title = tr('hv_task_remove');
      x.onclick = (e) => { e.stopPropagation(); removeTask(t.id); };
      row.appendChild(x);
      box.appendChild(row);
    });
  }

  function groupMenuItems(items) {
    const grouped = [], groups = new Map();
    for (const it of items) {
      if (!it.group) { grouped.push(it); continue; }
      let g = groups.get(it.group);
      if (!g) { g = { label: it.group, children: [] }; groups.set(it.group, g); grouped.push(g); }
      g.children.push(it);
    }
    return grouped.map(it => it.children && it.children.length === 1 ? it.children[0] : it);
  }

  function showMenu(items, px, py, title, parent = null) {
    hideMenu();
    if (!items.length) return;
    const m = ui.menu;
    if (title) { const h = document.createElement('div'); h.className = 'hv-menu-title'; h.textContent = title; m.appendChild(h); }
    if (parent) {
      const back = document.createElement('button');
      back.type = 'button'; back.textContent = '‹ ' + tr('hv_menu_back');
      back.onclick = (e) => { e.stopPropagation(); parent(); };
      m.appendChild(back);
    }
    groupMenuItems(items).forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label + (it.children ? ' ›' : '');
      if (it.children) b.setAttribute('aria-haspopup', 'menu');
      if (it.off || (it.children && it.children.every(child => child.off))) b.disabled = true;
      b.onclick = (e) => {
        e.stopPropagation();
        if (it.children) {
          const hit = markHit;
          const reopen = () => { showMenu(items, px, py, title, parent); markHit = hit; };
          showMenu(it.children.map(child => ({ ...child, group: null })), px, py, it.label, reopen);
          markHit = hit;
          return;
        }
        hideMenu(); if (it.task) queueTask(it.label, it.run); else it.run();
      };
      m.appendChild(b);
    });
    m.classList.add('show');
    m.style.left = '0px'; m.style.top = '0px';
    const x = Math.max(4, Math.min(px, window.innerWidth - m.offsetWidth - 4));
    const y = Math.max(4, Math.min(py, window.innerHeight - m.offsetHeight - 4));
    m.style.left = x + 'px'; m.style.top = y + 'px';
  }

  function screenOf(x, y, z, r) {
    const _v = new THREE.Vector3().set(x, y, z).project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x + 1) / 2 * r.width, y: (1 - _v.y) / 2 * r.height };
  }

  // Which thing, water or ground lies under a click.
  function pickAt(cx, cy) {
    const rect = ui.stage.getBoundingClientRect();
    const px = cx - rect.left, py = cy - rect.top;
    let best = null, bs = 1;
    const consider = (kind, x, y, z, rad, data) => {
      if (Math.hypot(x - cam.x, z - cam.z) > 60) return;
      const p = screenOf(x, y, z, rect);
      if (!p) return;
      const sc = Math.hypot(p.x - px, p.y - py) / rad;
      if (sc < bs) { bs = sc; best = { kind, x, z, data }; }
    };
    stones.forEach(st => { if (!st.taken) consider('stone', st.x, groundAt(st.x, st.z) + 0.2, st.z, 40, st); });
    trees.forEach(t => { if (!t.felled) consider('tree', t.x, groundAt(t.x, t.z) + 1.5 * (t.s || 1), t.z, 58, t); });
    piles.forEach(p => consider('pile', p.data.x, groundAt(p.data.x, p.data.z) + 0.3, p.data.z, 44, p));
    builds.forEach(b => { if (!isStructure(b.data)) consider('build', b.data.x, groundAt(b.data.x, b.data.z) + 0.5, b.data.z, 54, b); });
    plots.forEach(p => consider('plot', p.data.x, groundAt(p.data.x, p.data.z) + 0.2, p.data.z, 34, p));
    fruitSrc.forEach(f => {
      if (f.kind === 't') { const t = trees.get(f.src); if (t && t.felled) return; }
      f.slots.forEach((gi, i) => { const sl = fruitSlots[gi]; if (sl && fruitRipe(f.src, i)) consider('fruit', sl.x, sl.y, sl.z, 30, { src: f.src, k: i, kind: f.kind, x: f.x, z: f.z }); });
    });
    if (best) return best;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(px / rect.width * 2 - 1, -(py / rect.height) * 2 + 1), camera);
    const roots = [...builds.values()].filter(b => isStructure(b.data)).map(b => b.group);
    const hit = ray.intersectObjects(roots, true)[0];
    if (hit) {
      let root = hit.object; while (root.parent && root.userData.buildId == null) root = root.parent;
      const b = builds.get(root.userData.buildId);
      if (b) return { kind: 'build', x: hit.point.x, z: hit.point.z, data: b };
    }
    return groundRay(cx, cy);
  }

  // The ground or water under a point of the screen: follow the ray down
  // until it meets land or water.
  function groundRay(cx, cy) {
    const rect = ui.stage.getBoundingClientRect();
    const px = cx - rect.left, py = cy - rect.top;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(px / rect.width * 2 - 1, -(py / rect.height) * 2 + 1), camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    for (let t = 1; t < 140; t += 0.6) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const g = walkGround(x, z), sl = shoreLevel(x, z);
      const top = sl !== null && sl > g ? sl : g;
      if (y <= top) {
        // Refine the intersection so selecting a construction square does
        // not drift into the next cell with the terrain march's step size.
        let lo = Math.max(0, t - .6), hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2, mx = o.x + d.x * mid, mz = o.z + d.z * mid;
          const land = walkGround(mx, mz), water = shoreLevel(mx, mz);
          if (o.y + d.y * mid <= Math.max(land, water ?? -Infinity)) hi = mid; else lo = mid;
        }
        const hx = o.x + d.x * hi, hz = o.z + d.z * hi;
        const land = walkGround(hx, hz), water = shoreLevel(hx, hz);
        return { kind: water !== null && water - land > .05 ? 'water' : 'ground', x: hx, z: hz };
      }
    }
    return null;
  }

  function worldClick(e, hit) {
    hit = hit || pickAt(e.clientX, e.clientY);
    if (!hit) return;
    const items = [];
    const D = hit;
    const tool = () => isTool(inv.hand) || packTool() >= 0;
    if (D.kind === 'stone') {
      items.push({ task: true, label: tr('hv_act_pick', { item: tr('hv_name_stone') }), run: () => goAct(D.x, D.z, 1.4, () => doPick()) });
    } else if (D.kind === 'pile') {
      const pd = D.data.data;
      items.push({ task: true, group: tr('hv_act_pick', { item: tr('hv_name_' + pd.kind) }), label: pileLabel(pd), run: () => goAct(pd.x, pd.z, 1.5, () => doPick()) });
      if (pd.n > 1) items.push({ task: true, group: tr('hv_act_pick', { item: tr('hv_name_' + pd.kind) }), label: tr('hv_m_all_take'), run: () => goAct(pd.x, pd.z, 1.5, () => doPick(true)) });
    } else if (D.kind === 'fruit') {
      const f = D.data, t = f.kind === 't' && trees.get(f.src);
      if (t) return worldClick(e, { kind: 'tree', x: t.x, z: t.z, data: t });
      fruitItems(items, f.src, 'berries', f.x, f.z, 1.8);
    } else if (D.kind === 'tree') {
      const t = D.data;
      fruitItems(items, t.id, 'apple', t.x, t.z, t.r + 0.9);
      items.push({ task: true, label: tool() ? tr('hv_m_chop') : tr('hv_act_need_stone'), off: !tool(),
        run: () => goAct(t.x, t.z, t.r + 0.9, () => { if (target.tree) { startChop(); autoUse = 'chop'; } }) });
    } else if (D.kind === 'water') {
      items.push({ task: true, label: tr('hv_act_drink'), run: () => goTo(D.x, D.z, 0.6, () => { drinkClock = 0; autoUse = 'drink'; }, () => !!drinkSpot()) });
      if ([inv.hand, ...inv.pack].some(x => kindOf(x) === 'bucket')) {
        items.push({ task: true, label: tr('hv_act_fill'), run: () => goTo(D.x, D.z, 0.6, () => fillBucket(), () => !!drinkSpot()) });
      }
    } else if (D.kind === 'plot') {
      return plotMenu(D.data, e);
    } else if (D.kind === 'build') {
      const d = D.data.data, at = (fn) => isStructure(d) ? approachBuild(d, fn) : goAct(d.x, d.z, 2.6, fn);
      if (isStructure(d) && d.done) {
        if (d.make === 'floor') {
          items.push({ group: tr('hv_name_wall'), label: tr('hv_name_wall'), run: () => startHousing('wall') });
          items.push({ group: tr('hv_name_wall'), label: tr('hv_wall_door'), run: () => startHousing('wall', true) });
          const g = groundRay(e.clientX, e.clientY);
          if (g) {
            items.push({ task: true, label: tr('hv_m_walk'), run: () => goTo(g.x, g.z, .5) });
            items.push({ task: true, label: tr('hv_m_run'), run: () => goTo(g.x, g.z, .5, null, null, true) });
          }
        } else items.push({ label: tr('hv_structure_done'), off: true, run: () => {} });
      } else if (d.kind === 'site') {
        if (d.done) items.push({ task: true, label: tr('hv_act_take_made', { item: tr('hv_name_' + d.make) }), run: () => at(() => mp.send({ type: 'hv_pick', build: d.id })) });
        else items.push({ label: tr('hv_m_view_frame'), run: () => viewBuild(D.data) });
      } else {
        const pulled = myPull() === D.data;
        items.push({ task: true, label: pulled ? tr('hv_act_let_go') : tr('hv_act_pull'), run: () => at(() => mp.send(pulled ? { type: 'hv_pull' } : { type: 'hv_pull', build: d.id })) });
        items.push({ label: tr('hv_m_view_sled'), run: () => viewBuild(D.data) });
      }
      if (d.kind === 'site') {
        const cell = d.make === 'floor' ? floorCellAt(d, D.x, D.z) : null;
        const walls = [...builds.values()].filter(b => b.data.floor === d.id);
        const whole = d.make === 'floor' && walls.length ? 'hv_remove_floor_walls' : 'hv_remove_build';
        const cellWalls = cell && walls.some(b => b.data.side === 'n' ? cell.z === 0 : b.data.side === 's' ? cell.z === d.nz - 1 : b.data.side === 'w' ? cell.x === 0 : cell.x === d.nx - 1);
        if (cell) items.push({ group: tr('hv_remove_group'), task: true,
          label: tr(cellWalls ? 'hv_remove_cell_walls' : 'hv_remove_cell'), run: () => removeBuildAction(d.id, cell) });
        items.push({ group: tr('hv_remove_group'), task: true, label: tr(whole), run: () => removeBuildAction(d.id) });
      }
    } else {
      items.push({ task: true, label: tr('hv_m_walk'), run: () => goTo(D.x, D.z, 0.5) });
      items.push({ task: true, label: tr('hv_m_run'), run: () => goTo(D.x, D.z, 0.5, null, null, true) });
    }
    showMenu(items, e.clientX, e.clientY);
    if (items.length) markHit = hit;
  }

  // The menu of a backpack or hand slot.
  function slotMenu(i, e) {
    const it = i === 'hand' ? inv.hand : inv.pack[i];
    if (!it) return;
    const k = kindOf(it), items = [];
    if (it && typeof it === 'object' && it.n && qualityOf(it) > 0) {
      items.push({ label: tr('hv_act_eat', { item: tr('hv_name_' + k) }), run: () => doEat(i) });
    }
    if (i === 'hand' && T.items[k].slot > 0) items.push({ label: tr('hv_act_stash'), run: () => mp.send({ type: 'hv_hold', slot: 'stash' }) });
    else if (i !== 'hand') items.push({ label: tr('hv_m_hold'), run: () => mp.send({ type: 'hv_hold', slot: i }) });
    if (k === 'bucket') {
      if (it.w > 0) items.push({ label: tr('hv_act_drink_bucket'), off: needs.water >= T.needs.water_max - 1, run: () => mp.send({ type: 'hv_drink', bucket: true }) });
      if (drinkSpot() && it.w < T.farm.bucket) items.push({ label: tr('hv_act_fill'), run: () => fillBucket() });
    }
    if (!kept(k)) {
      items.push({ label: tr('hv_act_drop', { item: tr('hv_name_' + k) }), run: () =>
        mp.send({ type: 'hv_drop', slot: i, x: me.x + Math.sin(me.ry) * 1.1, z: me.z + Math.cos(me.ry) * 1.1 }) });
    }
    showMenu(items, e.clientX, e.clientY);
  }

  function doPick(all) {
    const b = target.build;
    if (b && b.data.done) return mp.send({ type: 'hv_pick', build: b.data.id });
    if (b) return openCargo(b);
    const pk = target.pick;
    if (!pk) {
      if (target.fruit) mp.send({ type: 'hv_gather', src: target.fruit.src, k: target.fruit.k });
      else if (target.crop) mp.send({ type: 'hv_gather', src: 'f' + target.crop.plot.data.c, k: target.crop.k });
      return;
    }
    if (pk.stone) mp.send({ type: 'hv_pick', stone: pk.stone.id });
    else mp.send({ type: 'hv_pick', pile: pk.pile.data.id, all: !!all });
  }

  // What can chop: a tool the server knows a chopping time for.
  const isTool = (it) => !!(it && T && T.chop_seconds[kindOf(it)]);
  // The best chopping tool in the backpack (the fastest one), or -1.
  function packTool() {
    let best = -1, bestT = Infinity;
    inv.pack.forEach((it, i) => {
      const s = it && T.chop_seconds[kindOf(it)];
      if (s && s < bestT) { best = i; bestT = s; }
    });
    return best;
  }

  function startChop() {
    chopHeld = true;
    // Swap carried cargo for a chopping tool when the task needs one.
    if (target.tree && !isTool(inv.hand) && packTool() >= 0) mp.send({ type: 'hv_hold', slot: packTool() });
  }

  // Called every frame; returns true while the player is chopping.
  function updateChop(dt, moving) {
    const t = target.tree;
    if (!chopHeld || moving || !t || !isTool(inv.hand)) { chopTree = null; return false; }
    // Real time, not frame time: the server counts the seconds between ticks.
    const now = performance.now();
    if (chopTree !== t.id || now - chopClock >= T.chop_tick * 1000) {
      chopTree = t.id; chopClock = now;
      mp.send({ type: 'hv_chop', tree: t.id });
    }
    let d = Math.atan2(t.x - me.x, t.z - me.z) - me.ry;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    me.ry += d * (1 - Math.exp(-dt * 10));
    return true;
  }

  let stumpGeo = null, stumpMat = null;
  function fellTree(t, animate, by) {
    if (t.felled) return;
    t.felled = true;
    t.parts.forEach(([mesh, i]) => hideInstance(mesh, i));
    removeObstacle(t.x, t.z, t);
    if (!stumpGeo) {
      stumpGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.36, 7); stumpGeo.translate(0, 0.18, 0);
      stumpMat = new THREE.MeshStandardMaterial({ color: '#7a5234', flatShading: true, roughness: 0.9 });
    }
    const stump = new THREE.Mesh(stumpGeo, stumpMat);
    stump.position.set(t.x, groundAt(t.x, t.z) - 0.05, t.z);
    stump.scale.setScalar(t.s);
    stump.castShadow = stump.receiveShadow = true;
    scene.add(stump);
    addObstacle(t.x, t.z, 0.3 * t.s, stump);
    chopProg.delete(t.id);
    if (!animate) return;

    // A stand-in tree falls away from whoever cut it, then sinks out of sight.
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * t.s, 0.26 * t.s, t.th, 6), mat('#7a5234'));
    trunk.position.y = t.th / 2;
    const crown = t.pine
      ? new THREE.Mesh(new THREE.ConeGeometry(1.6 * t.s, 4.2 * t.s, 7), mat(t.crown))
      : new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 * t.s, 0), mat(t.crown));
    crown.position.y = t.th + (t.pine ? 1.6 : 0.9) * t.s;
    g.add(trunk, crown);
    g.traverse(o => { o.castShadow = true; });
    g.position.set(t.x, groundAt(t.x, t.z), t.z);
    const who = by === welcome.you.id ? me : peers.get(by);
    const fromX = who ? (who.ch ? who.ch.root.position.x : who.x) : t.x - 1, fromZ = who ? (who.ch ? who.ch.root.position.z : who.z) : t.z;
    g.rotation.y = Math.atan2(t.x - fromX, t.z - fromZ);
    scene.add(g);
    falling.push({ g, t: 0 });
  }

  function updateFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.t += dt;
      if (f.t < 1.6) f.g.rotation.x = Math.min(Math.PI / 2, Math.pow(f.t / 1.6, 2.2) * Math.PI / 2);
      else f.g.position.y -= dt * 1.2;
      if (f.t > 3.6) {
        scene.remove(f.g);
        f.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        falling.splice(i, 1);
      }
    }
  }

  function takeStone(id) {
    const st = stones.get(id);
    if (!st || st.taken) return;
    st.taken = true;
    hideInstance(st.mesh, st.i);
  }

  let pileGeo = null;
  function showPileGeo() {
    pileGeo = {
      log: new THREE.CylinderGeometry(0.14, 0.14, 1.5, 8), stone: new THREE.DodecahedronGeometry(0.13, 0),
      logMat: new THREE.MeshStandardMaterial({ color: '#8a5d3b', flatShading: true, roughness: 0.9 }),
      stoneMat: new THREE.MeshStandardMaterial({ color: '#a9a59a', flatShading: true, roughness: 1 }),
      fruit: new THREE.SphereGeometry(0.075, 8, 6),
      apple: new THREE.MeshStandardMaterial({ color: '#c8402f', flatShading: true, roughness: 0.7 }),
      berries: new THREE.MeshStandardMaterial({ color: '#6a3f8f', flatShading: true, roughness: 0.7 }),
      pail: new THREE.CylinderGeometry(0.17, 0.13, 0.3, 10).translate(0, 0.15, 0),
      handle: new THREE.TorusGeometry(0.16, 0.012, 4, 12, Math.PI),
      water: new THREE.CircleGeometry(0.15, 10).rotateX(-Math.PI / 2),
      waterMat: new THREE.MeshStandardMaterial({ color: '#3f86c4', roughness: 0.2 }),
    };
  }
  // A bucket standing on the ground or on a sled, with its water showing.
  function bucketMesh(w) {
    const g = new THREE.Group();
    const o = new THREE.Mesh(pileGeo.pail, pileGeo.logMat);
    o.castShadow = o.receiveShadow = true;
    const h = new THREE.Mesh(pileGeo.handle, pileGeo.logMat);
    h.position.y = 0.3;
    g.add(o, h);
    if (w > 0) {
      const s = new THREE.Mesh(pileGeo.water, pileGeo.waterMat);
      s.position.y = 0.05 + 0.22 * Math.min(1, w / T.farm.bucket);
      s.scale.setScalar(0.88 + 0.12 * Math.min(1, w / T.farm.bucket));
      g.add(s);
    }
    return g;
  }

  function showPile(data) {
    const old = piles.get(data.id);
    if (old) { scene.remove(old.group); if (old.data.kind === 'log') removeObstacle(old.data.x, old.data.z, old); }
    if (!pileGeo) showPileGeo();
    const g = new THREE.Group();
    const y0 = groundAt(data.x, data.z);
    g.position.set(data.x, y0, data.z);
    const r = mulberry32(data.id * 2654435761 >>> 0);
    if (data.kind === 'log') {
      // Three to a layer, each layer across the one below.
      for (let i = 0; i < data.n; i++) {
        const layer = Math.floor(i / 3), slot = i % 3 - 1;
        const o = new THREE.Mesh(pileGeo.log, pileGeo.logMat);
        o.position.y = 0.14 + layer * 0.27;
        if (layer % 2 === 0) { o.rotation.z = Math.PI / 2; o.position.z = slot * 0.3; }
        else { o.rotation.x = Math.PI / 2; o.position.x = slot * 0.3; }
        o.rotation.y += (r() - 0.5) * 0.08;
        o.castShadow = o.receiveShadow = true;
        g.add(o);
      }
    } else if (data.kind === 'bucket') {
      const o = bucketMesh(data.at);
      o.rotation.y = r() * Math.PI * 2;
      g.add(o);
    } else if (data.kind === 'axe' || data.kind === 'hoe') {
      toolMesh(g, data.kind, true);
      g.rotation.y = r() * Math.PI * 2;
    } else if (data.kind === 'apple' || data.kind === 'berries') {
      // A small heap of fruit; a big pile shows no more than a couple of dozen.
      const shown = Math.min(data.n, 24);
      for (let i = 0; i < shown; i++) {
        const rr = 0.07 * Math.sqrt(i), a = i * 2.39996;
        const o = new THREE.Mesh(pileGeo.fruit, pileGeo[data.kind]);
        o.position.set(Math.cos(a) * rr, 0.07 + Math.max(0, 0.18 - rr * 0.6), Math.sin(a) * rr);
        o.castShadow = true;
        g.add(o);
      }
    } else {
      // A heap: the more stones, the wider and higher it gets.
      const base = 0.12 * Math.sqrt(data.n);
      for (let i = 0; i < data.n; i++) {
        const rr = 0.12 * Math.sqrt(i), a = i * 2.39996;
        const o = new THREE.Mesh(pileGeo.stone, pileGeo.stoneMat);
        o.position.set(Math.cos(a) * rr, 0.08 + Math.max(0, base - rr) * 0.75, Math.sin(a) * rr);
        o.rotation.set(r() * 3, r() * 3, r() * 3);
        o.scale.set(1.25, 0.8, 1);
        o.castShadow = o.receiveShadow = true;
        g.add(o);
      }
    }
    scene.add(g);
    const entry = { data, group: g };
    piles.set(data.id, entry);
    if (data.kind === 'log') addObstacle(data.x, data.z, 0.75, entry);
  }

  function removePile(id) {
    const p = piles.get(id);
    if (!p) return;
    scene.remove(p.group);
    if (p.data.kind === 'log') removeObstacle(p.data.x, p.data.z, p);
    piles.delete(id);
  }

  // The state of the world as the server knows it: felled trees, taken
  // stones and every pile. Applied on arrival and again after a reconnect.
  function applyWorld(w) {
    if (!w) return;
    if (w.now) fruitOff = w.now - Date.now() / 1000;
    fruitAt.clear();
    (w.fruit || []).forEach(([src, k, at]) => fruitAt.set(src + '#' + k, at));
    (w.felled || []).forEach(id => { const t = trees.get(id); if (t) fellTree(t, false); });
    (w.taken || []).forEach(takeStone);
    const keep = new Set((w.piles || []).map(p => p.id));
    [...piles.keys()].forEach(id => { if (!keep.has(id)) removePile(id); });
    (w.piles || []).forEach(showPile);
    const keepB = new Set((w.builds || []).map(b => b.id));
    [...builds.keys()].forEach(id => { if (!keepB.has(id)) removeBuild(id); });
    (w.builds || []).forEach(showBuild);
    const keepP = new Set((w.plots || []).map(p => p.c));
    [...plots.keys()].forEach(c => { if (!keepP.has(c)) removePlot(c); });
    (w.plots || []).forEach(showPlot);
    refreshFruit();
  }

  function setInv(next) {
    if (!next) return;
    inv = { hand: next.hand || null, pack: (next.pack || []).slice() };
    if (me) setHeld(me.ch, kindOf(inv.hand));
    renderInv();
    renderCargo();
  }

  // ── builds: frames and sleds ─────────────────────────────────────────────
  let buildMats = null;
  function buildMat() {
    if (!buildMats) {
      const m = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
      buildMats = {
        board: m('#9a6a42'), runner: m('#6e4a2c'),
        mark: new THREE.MeshBasicMaterial({ color: '#f6e7b0', transparent: true, opacity: 0.28, depthWrite: false }),
        ghost: new THREE.MeshBasicMaterial({ color: '#9be37a', transparent: true, opacity: 0.4, depthWrite: false }),
        bad: new THREE.MeshBasicMaterial({ color: '#e5624f', transparent: true, opacity: 0.4, depthWrite: false }),
        rope: new THREE.LineBasicMaterial({ color: '#d8c39a' }),
        box: new THREE.BoxGeometry(1, 1, 1),
        planes: {},
        tool: new THREE.MeshStandardMaterial({ color: '#9a7048', flatShading: true, roughness: 0.9 }),
        blade: new THREE.MeshStandardMaterial({ color: '#9c988e', flatShading: true, roughness: 1 }),
        shade: new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.3, depthWrite: false }),
      };
    }
    return buildMats;
  }

  function box(mat, w, h, l, x, y, z) {
    const o = new THREE.Mesh(buildMat().box, mat);
    o.scale.set(w, h, l);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    return o;
  }

  // The square on the ground where a frame stands, edged with thin boards:
  // as big as a sled for a sled, a small one for a tool.
  function frameMesh(g, fill, make) {
    const M = buildMat(), [w, l] = footOf({ make });
    const key = w + 'x' + l;
    if (!M.planes[key]) M.planes[key] = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
    const plane = new THREE.Mesh(M.planes[key], fill);
    plane.position.y = 0.04;
    g.add(plane);
    const t = 0.08, hw = w / 2, hl = l / 2;
    g.add(box(M.board, t, 0.06, l, -hw, 0.03, 0), box(M.board, t, 0.06, l, hw, 0.03, 0),
      box(M.board, w, 0.06, t, 0, 0.03, -hl), box(M.board, w, 0.06, t, 0, 0.03, hl));
  }

  // A tool lying on its frame: pale while it is still being made.
  function toolMesh(g, k, done) {
    const M = buildMat(), wood = done ? M.tool : M.shade, stone = done ? M.blade : M.shade;
    const y = 0.1;
    if (k === 'axe') {
      g.add(box(wood, 0.06, 0.06, 0.62, 0, y, 0.04), box(stone, 0.26, 0.08, 0.12, 0.06, y + 0.01, -0.26));
    } else if (k === 'hoe') {
      g.add(box(wood, 0.05, 0.05, 0.66, 0, y, 0.06), box(stone, 0.28, 0.04, 0.1, 0, y, -0.3));
    } else if (k === 'bucket') {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 10), wood);
      o.position.set(0, 0.2, 0);
      o.castShadow = true;
      g.add(o);
    }
  }

  // A sled: two runners curling up at the front (local +z, towards whoever
  // pulls it) and a deck of boards across them.
  function sledMesh(g) {
    const M = buildMat();
    for (const x of [-0.45, 0.45]) {
      g.add(box(M.runner, 0.1, 0.1, SLED_L - 0.3, x, 0.05, -0.15));
      const tip = box(M.runner, 0.1, 0.1, 0.45, x, 0.16, SLED_L / 2 - 0.2);
      tip.rotation.x = -0.6;
      g.add(tip);
      for (const z of [-0.8, 0, 0.7]) g.add(box(M.runner, 0.08, 0.16, 0.08, x, 0.18, z));
    }
    for (let i = 0; i < 7; i++) g.add(box(M.board, SLED_W, 0.05, 0.28, 0, 0.28, -0.95 + i * 0.3));
    g.add(box(M.board, SLED_W * 0.9, 0.08, 0.1, 0, 0.3, SLED_L / 2 - 0.1));
  }

  // What lies on a sled: logs along it, three to a layer, stones on top.
  function loadMesh(g, items, y0) {
    if (!pileGeo) showPileGeo();
    const logs = items.filter(k => k === 'log').length;
    const rest = items.filter(k => k === 'stone');
    const fruit = items.filter(e => e && typeof e === 'object' && e.n);
    const pails = items.filter(e => kindOf(e) === 'bucket');
    for (let i = 0; i < logs; i++) {
      const o = new THREE.Mesh(pileGeo.log, pileGeo.logMat);
      o.rotation.x = Math.PI / 2;
      o.position.set((i % 3 - 1) * 0.3, y0 + 0.14 + Math.floor(i / 3) * 0.26, 0);
      o.castShadow = true;
      g.add(o);
    }
    const top = y0 + Math.ceil(logs / 3) * 0.26;
    rest.forEach((k, i) => {
      const o = new THREE.Mesh(pileGeo.stone, pileGeo.stoneMat);
      o.position.set((i % 2 ? 0.2 : -0.2), top + 0.08, -0.6 + Math.floor(i / 2) * 0.3);
      o.rotation.set(i, i * 2, i * 3);
      o.scale.set(1.25, 0.8, 1);
      o.castShadow = true;
      g.add(o);
    });
    // Buckets stand in a row at the front of the bed.
    pails.forEach((e, i) => {
      const o = bucketMesh(e.w);
      o.position.set((i % 3 - 1) * 0.36, top, -0.75 + Math.floor(i / 3) * 0.38);
      g.add(o);
    });
    // Fruit lies in a heap at the back of the bed, as much as is there.
    fruit.forEach((e, j) => {
      const shown = Math.min(30, Math.ceil(e.n / 3));
      for (let i = 0; i < shown; i++) {
        const rr = 0.07 * Math.sqrt(i), a = i * 2.39996;
        const o = new THREE.Mesh(pileGeo.fruit, pileGeo[e.k]);
        o.position.set((j ? 0.22 : -0.22) + Math.cos(a) * rr, top + 0.07 + Math.max(0, 0.15 - rr * 0.5), 0.55 + Math.sin(a) * rr);
        g.add(o);
      }
    });
  }

  function showBuild(data) {
    removeBuild(data.id);
    const g = new THREE.Group();
    if (isStructure(data)) {
      structureMesh(g, data);
    } else if (data.kind === 'site') {
      frameMesh(g, buildMat().mark, data.make);
      if (!pileGeo) showPileGeo();
      if (data.make === 'sled') {
        // The logs brought so far lie side by side inside the frame.
        for (let i = 0; i < (data.have.log || 0); i++) {
          const o = new THREE.Mesh(pileGeo.log, pileGeo.logMat);
          o.rotation.x = Math.PI / 2;
          o.position.set(-0.44 + i * 0.22, 0.14, 0);
          o.castShadow = true;
          g.add(o);
        }
      } else {
        // A tool: the pale shape of it, its materials beside it, and once
        // it is made, the tool itself.
        toolMesh(g, data.make, !!data.done);
        if (!data.done) {
          for (let i = 0; i < (data.have.log || 0); i++) {
            const o = new THREE.Mesh(pileGeo.log, pileGeo.logMat);
            o.rotation.set(Math.PI / 2, 0, Math.PI / 2);
            o.scale.set(0.8, 0.8, 0.8);
            o.position.set(0, 0.12, 0.25);
            o.castShadow = true;
            g.add(o);
          }
          for (let i = 0; i < (data.have.stone || 0); i++) {
            const o = new THREE.Mesh(pileGeo.stone, pileGeo.stoneMat);
            o.position.set(0.28, 0.1, -0.22);
            o.scale.set(1.25, 0.8, 1);
            o.castShadow = true;
            g.add(o);
          }
        }
      }
    } else {
      sledMesh(g);
      loadMesh(g, data.load || [], 0.3);
    }
    g.position.set(data.x, isStructure(data) ? data.base_y : groundAt(data.x, data.z), data.z);
    g.rotation.y = data.ry;
    g.userData.buildId = data.id;
    scene.add(g);
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), buildMat().rope);
    rope.visible = false;
    rope.frustumCulled = false;
    scene.add(rope);
    const b = { data, group: g, rope, obst: null };
    builds.set(data.id, b);
    setBuildObstacle(b);
  }

  // A standing sled is in the way like a log pile; a pulled one is not.
  function setBuildObstacle(b) {
    if (b.obst) { b.obst.forEach(o => removeObstacle(o.x, o.z, o)); b.obst = null; }
    const d = b.data;
    if (d.kind !== 'sled' || d.by) return;
    b.obst = [-0.6, 0.6].map(k => ({ x: d.x + Math.sin(d.ry) * k, z: d.z + Math.cos(d.ry) * k }));
    b.obst.forEach(o => addObstacle(o.x, o.z, 0.6, o));
  }

  function removeBuild(id) {
    const b = builds.get(id);
    if (!b) return;
    if (b.obst) b.obst.forEach(o => removeObstacle(o.x, o.z, o));
    scene.remove(b.group, b.rope);
    b.rope.geometry.dispose();
    builds.delete(id);
  }

  // The rope: a sled stays put until the rope is taut, then slides after
  // whoever pulls it. The server applies the same rule to the positions it
  // receives, so everyone sees the sled in the same place.
  const _ropeA = { x: 0, y: 0, z: 0 };
  function updateBuilds(dt) {
    builds.forEach(b => {
      const d = b.data;
      if (!d.by) { b.rope.visible = false; return; }
      const who = d.by === welcome.you.id ? me : peers.get(d.by);
      if (!who) { b.rope.visible = false; return; }
      const px = who.ch ? who.ch.root.position.x : who.x, pz = who.ch ? who.ch.root.position.z : who.z;
      const py = who.ch ? who.ch.root.position.y : who.y;
      const dx = d.x - px, dz = d.z - pz, len = Math.hypot(dx, dz);
      if (len > T.rope) {
        d.x = px + dx / len * T.rope;
        d.z = pz + dz / len * T.rope;
        const want = Math.atan2(-dx, -dz);
        let dr = want - d.ry;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        d.ry += dr * (1 - Math.exp(-dt * 8));
      }
      const gy = groundAt(d.x, d.z);
      b.group.position.set(d.x, gy, d.z);
      b.group.rotation.y = d.ry;
      _ropeA.x = d.x + Math.sin(d.ry) * (SLED_L / 2 - 0.05);
      _ropeA.z = d.z + Math.cos(d.ry) * (SLED_L / 2 - 0.05);
      const pos = b.rope.geometry.attributes.position;
      pos.setXYZ(0, _ropeA.x, groundAt(_ropeA.x, _ropeA.z) + 0.32, _ropeA.z);
      pos.setXYZ(1, px, py + 0.85, pz);
      pos.needsUpdate = true;
      b.rope.visible = true;
    });
  }

  // ── permanent modular construction ───────────────────────────────────────
  const isStructure = (d) => d.make === 'floor' || d.make === 'wall';
  const buildNeeds = (d) => d.need || T.builds[d.make] || {};
  function floorCells(d) {
    const removed = new Set(d.removed || []), cells = [];
    for (let x = 0; x < d.nx; x++) for (let z = 0; z < d.nz; z++) if (!removed.has(x + '_' + z)) cells.push({ x, z });
    return cells;
  }
  function floorCellAt(d, x, z) {
    const c = T.housing.cell, left = d.x - d.width / 2, top = d.z - d.depth / 2;
    if (x < left - .001 || x > left + d.width + .001 || z < top - .001 || z > top + d.depth + .001) return null;
    const cell = { x: Math.max(0, Math.min(d.nx - 1, Math.floor((x - left) / c))), z: Math.max(0, Math.min(d.nz - 1, Math.floor((z - top) / c))) };
    return (d.removed || []).includes(cell.x + '_' + cell.z) ? null : cell;
  }
  function buildParts(d) {
    if (d.make === 'floor' && d.removed?.length) {
      const c = T.housing.cell;
      return floorCells(d).map(p => ({ x: d.x + (p.x + .5 - d.nx / 2) * c, z: d.z + (p.z + .5 - d.nz / 2) * c, width: c, depth: c }));
    }
    if (isStructure(d) || (d.width != null && d.depth != null)) return [d];
    const room = 2 * (T.build_room[d.make || d.kind] || 1.5);
    return [{ x: d.x, z: d.z, width: room, depth: room }];
  }
  function floorSideFull(d, side) {
    return !(d.removed || []).some(key => { const [x, z] = key.split('_').map(Number);
      return side === 'n' ? z === 0 : side === 's' ? z === d.nz - 1 : side === 'w' ? x === 0 : x === d.nx - 1; });
  }
  function removeBuildAction(id, cell = null) {
    const d = builds.get(id)?.data;
    if (!d) return;
    const send = () => { if (builds.has(id)) mp.send({ type: 'hv_remove_build', build: id, cell }); };
    if (cell) {
      const c = T.housing.cell;
      goAct(d.x + (cell.x + .5 - d.nx / 2) * c, d.z + (cell.z + .5 - d.nz / 2) * c, 1.2, send);
    } else if (isStructure(d)) approachBuild(d, send);
    else goAct(d.x, d.z, 2.6, send);
  }
  function structureMesh(g, d, preview = false) {
    const M = buildMat();
    const mat = preview ? M.ghost : d.done ? M.board : M.shade;
    if (d.make === 'floor') {
      const cell = T.housing.cell;
      let supplied = d.have?.log || 0;
      for (const post of d.supports || []) {
        const finished = !preview && (d.done || supplied >= post.logs);
        supplied = Math.max(0, supplied - post.logs);
        g.add(box(finished ? M.runner : mat, T.housing.support_width, post.height, T.housing.support_width,
          post.x, post.y - d.base_y + post.height / 2, post.z));
      }
      let index = 0;
      for (const { x, z } of floorCells(d)) {
        const px = (x + .5) * cell - d.width / 2, pz = (z + .5) * cell - d.depth / 2;
        const finished = !preview && (d.done || (++index) * T.housing.floor_logs <= supplied);
        for (let board = 0; board < 5; board++) {
          g.add(box(finished ? M.board : mat, cell - .02, .16, cell / 5 - .015, px, .14, pz + (board - 2) * cell / 5));
        }
      }
    } else {
      const alongX = d.side === 'n' || d.side === 's';
      const length = alongX ? d.width : d.depth, h = T.housing.height;
      const doorway = d.door ? Math.min(T.housing.door_width, length - .2) : 0;
      const add = (w, height, x, y) => {
        g.add(box(mat, alongX ? w : d.width, height, alongX ? d.depth : w,
          alongX ? x : 0, y, alongX ? 0 : x));
      };
      for (let i = 0; i < 13; i++) {
        const y = (i + .5) * h / 13;
        if (doorway && y < T.housing.door_height) {
          const w = (length - doorway) / 2;
          add(w, h / 13 - .012, -(length + doorway) / 4, y);
          add(w, h / 13 - .012, (length + doorway) / 4, y);
        } else add(length, h / 13 - .012, 0, y);
      }
    }
  }

  function walkGround(x, z) {
    let y = groundAt(x, z);
    builds.forEach(b => {
      const d = b.data;
      if (d.make === 'floor' && d.done && floorCellAt(d, x, z)) y = Math.max(y, d.base_y + .22);
    });
    return y;
  }
  function wallRects() {
    const rects = [];
    builds.forEach(b => {
      const d = b.data;
      if (d.make !== 'wall' || !d.done) return;
      const alongX = d.side === 'n' || d.side === 's', length = alongX ? d.width : d.depth;
      const door = d.door ? Math.min(T.housing.door_width, length - .2) : 0;
      const parts = door ? [[-(length + door) / 4, (length - door) / 2], [(length + door) / 4, (length - door) / 2]] : [[0, length]];
      for (const [offset, span] of parts) rects.push({ x: d.x + (alongX ? offset : 0), z: d.z + (alongX ? 0 : offset), w: alongX ? span : d.width, l: alongX ? d.depth : span });
    });
    return rects;
  }
  function housingOverlaps(a, b) {
    return buildParts(a).some(ap => buildParts(b).some(bp =>
      Math.abs(ap.x - bp.x) < (ap.width + bp.width) / 2 - .01 && Math.abs(ap.z - bp.z) < (ap.depth + bp.depth) / 2 - .01));
  }
  function floorCandidate(a, b) {
    const c = T.housing.cell;
    const gx = Math.min(a.x, b.x), gz = Math.min(a.z, b.z), nx = Math.abs(a.x - b.x) + 1, nz = Math.abs(a.z - b.z) + 1;
    return { make: 'floor', gx, gz, nx, nz, x: (gx + nx / 2) * c, z: (gz + nz / 2) * c,
      width: nx * c, depth: nz * c, ry: 0, base_y: 0, have: { log: 0 }, need: { log: nx * nz * T.housing.floor_logs } };
  }
  function floorFoundation(d, terrain) {
    const cfg = T.housing, base = Math.max(...terrain), supports = [];
    const positions = n => { const out = []; for (let i = 0; i < n; i += cfg.support_step) out.push(i); out.push(n); return out; };
    for (const x of positions(d.nx)) for (const z of positions(d.nz)) {
      const y = terrain[x * 2 * (d.nz * 2 + 1) + z * 2], height = Math.round((base + .06 - y) * 10000) / 10000;
      if (height > cfg.support_min) supports.push({ x: (x - d.nx / 2) * cfg.cell, z: (z - d.nz / 2) * cfg.cell,
        y, height, logs: Math.ceil((height - .000001) / cfg.support_unit) });
    }
    const support_logs = supports.reduce((n, s) => n + s.logs, 0);
    Object.assign(d, { base_y: base, terrain, supports, support_logs, need: { log: d.nx * d.nz * cfg.floor_logs + support_logs } });
  }
  function wallCandidate(floor, side, door = false) {
    const d = floor, c = T.housing, alongX = side === 'n' || side === 's', length = alongX ? d.width : d.depth;
    return { make: 'wall', floor: d.id, side, door, ry: 0,
      x: d.x + (!alongX ? (d.width + c.thickness) / 2 * (side === 'e' ? 1 : -1) : 0),
      z: d.z + (alongX ? (d.depth + c.thickness) / 2 * (side === 's' ? 1 : -1) : 0),
      width: alongX ? length : c.thickness, depth: alongX ? c.thickness : length,
      base_y: d.base_y + .22, height: c.height, have: { log: 0 }, need: { log: (alongX ? d.nx : d.nz) * c.wall_logs } };
  }
  function housingValid(d) {
    if (!d) return false;
    if (d.make === 'floor') {
      if (d.nx > T.housing.max_side || d.nz > T.housing.max_side) return false;
      if (Math.abs(d.x) + d.width / 2 > SIZE / 2 - 3 || Math.abs(d.z) + d.depth / 2 > SIZE / 2 - 3) return false;
      const terrain = [];
      // Check every grid corner and centre, including interior obstacles.
      for (let x = 0; x <= d.nx * 2; x++) for (let z = 0; z <= d.nz * 2; z++) {
        const px = d.x - d.width / 2 + x * T.housing.cell / 2, pz = d.z - d.depth / 2 + z * T.housing.cell / 2;
        const y = groundAt(px, pz);
        if (y <= .1 || (shoreLevel(px, pz) ?? -Infinity) > y || gridNearest(treeGrid, px, pz, .5, t => !t.felled, t => t.r)) return false;
        terrain.push(Math.round(y * 10000) / 10000);
      }
      floorFoundation(d, terrain);
      for (const p of plots.values()) {
        if (Math.abs(p.data.x - d.x) < (d.width + T.farm.cell) / 2 - .01 && Math.abs(p.data.z - d.z) < (d.depth + T.farm.cell) / 2 - .01) return false;
      }
    } else {
      const f = builds.get(d.floor)?.data;
      if (!f || f.make !== 'floor' || !f.done || !floorSideFull(f, d.side)) return false;
    }
    for (const b of builds.values()) {
      if (d.make === 'wall' && b.data.floor === d.floor && b.data.side === d.side) return false;
      if (d.make === 'wall' && (b.data.id === d.floor || b.data.floor === d.floor)) continue;
      if (housingOverlaps(d, b.data)) return false;
    }
    return true;
  }
  function startHousing(make, door = false) {
    stopHousing(); stopPlacing(); stopTilling(false); closeCargo(); hideMenu(); toggleCraft(false);
    const ghost = new THREE.Group(); scene.add(ghost);
    housing = { make, door, ghost, anchor: null, end: null, drag: null, press: null, selecting: false, pointer: null, fixed: false, candidate: null, signature: null };
    app.classList.add('hv-building'); renderHousing(); renderCraftBtn();
  }
  function stopHousing() {
    if (!housing) return;
    scene.remove(housing.ghost); housing = null;
    app.classList.remove('hv-building');
    ui.housePlan.classList.remove('open'); ui.housePlan.textContent = '';
    renderCraftBtn();
  }
  function housingPoint(cx, cy, begin = false) {
    if (!housing) return;
    const h = housing, g = groundRay(cx, cy);
    if (!g || g.kind !== 'ground') { h.candidate = null; return; }
    if (h.make === 'floor') {
      const p = { x: Math.floor(g.x / T.housing.cell), z: Math.floor(g.z / T.housing.cell) };
      if (begin) h.anchor = p;
      h.end = p;
      h.candidate = floorCandidate(h.anchor || p, p);
    } else {
      let floor = null, best = 1.5;
      builds.forEach(b => { if (b.data.make === 'floor' && b.data.done) { const dist = footDist(b.data, g.x, g.z); if (dist < best) { best = dist; floor = b.data; } } });
      if (!floor) { h.candidate = null; return; }
      const sides = [['n', Math.abs(g.z - (floor.z - floor.depth / 2))], ['s', Math.abs(g.z - (floor.z + floor.depth / 2))],
        ['w', Math.abs(g.x - (floor.x - floor.width / 2))], ['e', Math.abs(g.x - (floor.x + floor.width / 2))]];
      sides.sort((a, b) => a[1] - b[1]);
      h.candidate = wallCandidate(floor, sides[0][0], h.door);
    }
  }
  function updateHousing() {
    if (!housing) return;
    const h = housing;
    if (h.pointer && !h.fixed) housingPoint(h.pointer.x, h.pointer.y);
    const d = h.candidate, ok = housingValid(d);
    const signature = JSON.stringify([d, ok]);
    if (signature === h.signature) return;
    h.signature = signature;
    h.ghost.clear();
    if (d && (d.make !== 'floor' || (d.nx <= T.housing.max_side && d.nz <= T.housing.max_side))) {
      structureMesh(h.ghost, d, true);
      h.ghost.traverse(o => { if (o.isMesh) { o.material = ok ? buildMat().ghost : buildMat().bad; o.castShadow = false; } });
      h.ghost.position.set(d.x, d.base_y, d.z);
    }
    renderHousing(ok);
  }
  function renderHousing(ok = false) {
    if (!housing) return;
    const box = ui.housePlan, h = housing, d = h.candidate;
    box.textContent = ''; box.classList.add('open');
    box.appendChild(el('b', null, tr(h.make === 'floor' ? 'hv_name_floor' : h.door ? 'hv_wall_door' : 'hv_name_wall')));
    box.appendChild(el('div', 'hv-house-note', tr(h.make === 'floor' ? 'hv_floor_help' : 'hv_wall_help')));
    if (d) box.appendChild(el('div', 'hv-house-cost', tr('hv_structure_cost', { w: fmt(d.width), l: fmt(d.depth), n: d.need.log })));
    if (d?.make === 'floor' && d.support_logs) box.appendChild(el('div', 'hv-house-note', tr('hv_support_cost', { n: d.supports.length, logs: d.support_logs })));
    if (d && !ok) box.appendChild(el('div', 'hv-house-error', tr('hv_structure_invalid')));
    const acts = el('div', 'hv-cargo-acts'), confirm = el('button', 'hv-make', tr('hv_place_project'));
    confirm.type = 'button'; confirm.disabled = !d || !ok || (h.make === 'floor' && !h.anchor);
    confirm.onclick = confirmHousing;
    const cancel = el('button', 'hv-make', tr('hv_act_cancel')); cancel.type = 'button'; cancel.onclick = stopHousing;
    acts.append(confirm, cancel); box.appendChild(acts);
  }
  function approachBuild(d, fn) {
    const points = buildParts(d).map(p => ({ x: Math.max(p.x - p.width / 2, Math.min(p.x + p.width / 2, me.x)),
      z: Math.max(p.z - p.depth / 2, Math.min(p.z + p.depth / 2, me.z)) }));
    points.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    if (points.length) goAct(points[0].x, points[0].z, 1.2, fn);
  }
  function confirmHousing() {
    const d = housing?.candidate;
    if (!housingValid(d)) return toast(tr('hv_structure_invalid'));
    const plan = { ...d }; stopHousing();
    queueTask(tr('hv_frame', { item: tr('hv_name_' + plan.make) }), () => approachBuild(plan, () => {
      if (!housingValid(plan)) return toast(tr('hv_structure_invalid'));
      mp.send({ type: 'hv_place', make: plan.make, gx: plan.gx, gz: plan.gz, nx: plan.nx, nz: plan.nz,
        floor: plan.floor, side: plan.side, door: plan.door, base_y: plan.base_y, terrain: plan.terrain });
    }));
  }

  // Placing a frame: a ghost of it follows the pointer until a click or a
  // tap on the ground puts it there; the player then walks over and builds.
  function startPlacing(make) {
    stopHousing(); stopTilling(false);
    stopPlacing();
    toggleCraft(false);
    const g = new THREE.Group();
    frameMesh(g, buildMat().ghost, make);
    if (make !== 'sled') toolMesh(g, make, false);
    scene.add(g);
    placing = { make, ghost: g, ok: true, at: null };
    renderCraftBtn();
  }

  function stopPlacing() {
    if (!placing) return;
    scene.remove(placing.ghost);
    placing = null;
    renderCraftBtn();
  }

  // The craft button ends what it started: placing a frame or marking a field.
  function renderCraftBtn() {
    if (!ui.craftLabel) return;
    ui.craftLabel.textContent = housing ? '✕ ' + tr('hv_act_cancel') : placing ? '✕ ' + tr('hv_act_cancel') : tilling ? '✓ ' + tr('hv_till_done') : tr('hv_craft');
    ui.craftBtn.classList.toggle('on', !!(housing || placing || tilling));
  }

  // Under the pointer, or in front of the player until the pointer has moved.
  function placeSpot() {
    if (placing && placing.at) {
      const a = placing.at;
      return { x: a.x, z: a.z, ry: Math.atan2(a.x - me.x, a.z - me.z) };
    }
    const r = placing && placing.make !== 'sled' ? 1.3 : 2.2;
    return { x: me.x + Math.sin(me.ry) * r, z: me.z + Math.cos(me.ry) * r, ry: me.ry };
  }

  function placeOk(make, x, z) {
    if (groundAt(x, z) <= 0.05 || (shoreLevel(x, z) ?? -Infinity) > groundAt(x, z)) return false;
    const room = T.build_room;
    for (const b of builds.values()) {
      if (isStructure(b.data)) { if (housingOverlaps({ x, z, width: room[make] * 2, depth: room[make] * 2 }, b.data)) return false; continue; }
      const gap = room[make] + (room[b.data.make || b.data.kind] || room.sled);
      if (Math.hypot(b.data.x - x, b.data.z - z) < gap) return false;
    }
    return true;
  }

  function updatePlacing() {
    if (!placing) return;
    const p = placeSpot();
    const ok = placeOk(placing.make, p.x, p.z);
    placing.ok = ok;
    placing.ghost.position.set(p.x, groundAt(p.x, p.z), p.z);
    placing.ghost.rotation.y = p.ry;
    placing.ghost.children[0].material = ok ? buildMat().ghost : buildMat().bad;
  }

  // A click or a tap while placing: walk there and put the frame down.
  function placeAt(cx, cy) {
    const g = groundRay(cx, cy);
    if (!g || g.kind !== 'ground' || !placeOk(placing.make, g.x, g.z)) { toast(tr('hv_bad_spot')); return; }
    const make = placing.make, x = g.x, z = g.z;
    stopPlacing();
    queueTask(tr('hv_frame', { item: tr('hv_name_' + make) }), () => goAct(x, z, T.reach - 0.8, () => {
      if (!placeOk(make, x, z)) return toast(tr('hv_bad_spot'));
      mp.send({ type: 'hv_place', make, x, z, ry: Math.atan2(x - me.x, z - me.z) });
    }));
  }

  // ── the window of a sled or a frame ──────────────────────────────────────
  // What lies on it and what the player carries, side by side as tiles. A
  // tile is tapped for its choices, or dragged: from the sled to the player's
  // things, the other way, or out onto the ground.
  const nearBuild = (d) => isStructure(d) ? footDist(d, me.x, me.z) <= T.reach : Math.hypot(d.x - me.x, d.z - me.z) <= T.reach + 1.1;

  function viewBuild(b) {
    const d = b.data;
    if (nearBuild(d)) return openCargo(b);
    const open = () => { if (builds.get(d.id)) openCargo(builds.get(d.id)); };
    if (isStructure(d)) approachBuild(d, open); else goAct(d.x, d.z, 2.6, open);
  }

  function openCargo(b) {
    hideMenu();
    toggleCraft(false); toggleSkills(false); ui.people.classList.remove('open');
    cargo = { id: b.data.id, other: null, sel: null, spot: null, drag: null };
    renderCargo();
  }

  // The second thing in the window, shown below in place of the player's
  // things: a pile, or another sled or frame close to the first one.
  // other is { pile: id } or { build: id }.
  function cargoOther() {
    const o = cargo && cargo.other;
    if (!o) return null;
    const h = o.pile != null ? piles.get(o.pile) : builds.get(o.build);
    return h ? { pile: o.pile != null, d: h.data, ref: o } : null;
  }
  const otherReach = () => T.unload_reach + 1.2;
  function cargoGap(a, b) {
    const [aw, ad] = isStructure(a) ? [a.width, a.depth] : [0, 0];
    const [bw, bd] = isStructure(b) ? [b.width, b.depth] : [0, 0];
    return Math.hypot(Math.max(0, Math.abs(a.x - b.x) - (aw + bw) / 2), Math.max(0, Math.abs(a.z - b.z) - (ad + bd) / 2));
  }

  // A click in the world while the window is open: a pile, sled or frame
  // close to the first one comes into the window. True when it did.
  function cargoPick(e) {
    const hit = pickAt(e.clientX, e.clientY), b = builds.get(cargo.id);
    if (!hit || !b || (hit.kind !== 'pile' && hit.kind !== 'build')) return false;
    const d = hit.data.data;
    if (hit.kind === 'build' && d.id === cargo.id) { cargo.other = null; cargo.sel = null; renderCargo(); return true; }
    if (cargoGap(d, b.data) > otherReach()) return false;
    cargo.other = hit.kind === 'pile' ? { pile: d.id } : { build: d.id };
    cargo.sel = null;
    renderCargo();
    return true;
  }

  function closeCargo() {
    if (cargo && cargo.drag && cargo.drag.ghost) cargo.drag.ghost.remove();
    cargo = null;
    ui.cargo.classList.remove('open', 'spot');
    ui.cargo.textContent = '';
  }

  // Shuts the window once its sled or frame is gone or left behind; the
  // second thing leaves it once it is gone or too far from the first.
  function updateCargo() {
    if (!cargo) return;
    const b = builds.get(cargo.id);
    if (!b) return closeCargo();
    const o = cargoOther();
    if (cargo.other && (!o || cargoGap(o.d, b.data) > otherReach())) {
      cargo.other = null;
      if (cargo.sel && cargo.sel.from === 'other') cargo.sel = null;
      renderCargo();
    }
    // Walking to the second thing, to take from it, keeps the window open.
    const nearO = o && Math.hypot(o.d.x - me.x, o.d.z - me.z) <= T.reach + 1.1;
    if (!nearBuild(b.data) && !nearO) closeCargo();
  }

  // What is on it, by kind: [{ k, n }] — for a frame, what it needs.
  function cargoOn(d) {
    if (d.kind === 'site') {
      if (d.done) return isStructure(d) ? [] : [{ k: d.make, n: 1, made: true }];
      return Object.entries(buildNeeds(d)).map(([k, need]) => ({ k, n: d.have[k] || 0, need }));
    }
    const by = new Map();
    (d.load || []).forEach(e => by.set(kindOf(e), (by.get(kindOf(e)) || 0) + countOf(e)));
    return [...by].map(([k, n]) => ({ k, n }));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderCargo() {
    if (!cargo) return;
    if (cargo.drag && cargo.drag.moved) { cargo.dirty = true; return; }
    const b = builds.get(cargo.id);
    if (!b) return closeCargo();
    const d = b.data, site = d.kind === 'site', make = site ? d.make : d.kind;
    const box = ui.cargo;
    box.textContent = '';
    box.classList.add('open');
    box.classList.toggle('spot', !!cargo.spot);
    if (cargo.spot) {
      box.appendChild(el('div', 'hv-cargo-note', tr('hv_cargo_spot')));
      const c = el('button', 'hv-make', tr('hv_act_cancel'));
      c.type = 'button';
      c.onclick = () => { cargo.spot = null; renderCargo(); };
      box.appendChild(c);
      return;
    }
    const head = el('div', 'hv-cargo-head');
    head.appendChild(el('b', null, buildName(d)));
    const x = el('button', 'hv-cargo-x', '✕');
    x.type = 'button';
    x.title = tr('hv_close');
    x.onclick = () => closeCargo();
    head.appendChild(x);
    box.appendChild(head);
    if (isStructure(d)) {
      box.appendChild(el('div', 'hv-house-cost', tr('hv_structure_cost', { w: fmt(d.width), l: fmt(d.depth), n: buildNeeds(d).log })));
      if (d.make === 'floor' && d.support_logs) box.appendChild(el('div', 'hv-house-note', tr('hv_support_cost', { n: d.supports.length, logs: d.support_logs })));
      if (d.done) { box.appendChild(el('div', 'hv-cargo-note', tr('hv_structure_done'))); return; }
    }
    if (!site) {
      const tot = loadTotals(d.load);
      box.appendChild(el('div', 'hv-cargo-cap', fmt(tot.kg) + '/' + T.sled.kg + ' kg · ' + fmt(tot.l) + '/' + T.sled.litres + ' L'));
    }

    const on = cargoOn(d);
    box.appendChild(el('div', 'hv-people-title', tr(site ? 'hv_cargo_needs' : 'hv_cargo_on')));
    const gOn = el('div', 'hv-cargo-grid hv-cargo-on');
    on.forEach(t => {
      const tile = el('button', 'hv-slot hv-tile', ICON[t.k] || '❔');
      tile.type = 'button';
      tile.title = tr('hv_name_' + t.k);
      if (!t.made) tile.appendChild(el('b', 'hv-count', t.need ? t.n + '/' + t.need : String(t.n)));
      if (t.need && t.n >= t.need) tile.classList.add('full');
      if (!t.n) tile.classList.add('dim');
      const sel = { from: 'on', k: t.k, n: t.n, made: !!t.made };
      if (cargo.sel && cargo.sel.from === 'on' && cargo.sel.k === t.k) tile.classList.add('sel');
      bindTile(tile, sel);
      gOn.appendChild(tile);
    });
    if (!on.length) gOn.appendChild(el('div', 'hv-people-empty', tr('hv_cargo_empty')));
    box.appendChild(gOn);
    if (site && !d.done) {
      Object.keys((T.build_tools || {})[make] || {}).forEach(k => {
        const have = carried(k) > 0;
        box.appendChild(el('div', 'hv-cargo-tool ' + (have ? 'ok' : 'no'),
          (ICON[k] || '') + ' ' + tr('hv_cargo_tool', { item: tr('hv_name_' + k) }) + ' ' + (have ? '✓' : '✗')));
      });
    }

    // Below: the second thing chosen in the world, or the player's things.
    const o = cargoOther();
    if (o) {
      const oh = el('div', 'hv-cargo-head hv-cargo-ohead');
      oh.appendChild(el('b', null, o.pile ? (ICON[o.d.kind] || '') + ' ' + cap(tr('hv_cargo_pile', { item: tr('hv_name_' + o.d.kind) })) : buildName(o.d)));
      const back = el('button', 'hv-make hv-cargo-back', '← ' + tr('hv_cargo_back'));
      back.type = 'button';
      back.onclick = () => { cargo.other = null; cargo.sel = null; renderCargo(); };
      oh.appendChild(back);
      box.appendChild(oh);
      const gO = el('div', 'hv-cargo-grid hv-cargo-other');
      const tiles = o.pile ? [{ k: o.d.kind, n: o.d.n }] : cargoOn(o.d);
      tiles.forEach(t => {
        const tile = el('button', 'hv-slot hv-tile', ICON[t.k] || '❔');
        tile.type = 'button';
        tile.title = tr('hv_name_' + t.k);
        if (!t.made) tile.appendChild(el('b', 'hv-count', t.need ? t.n + '/' + t.need : String(t.n)));
        if (t.need && t.n >= t.need) tile.classList.add('full');
        if (!t.n) tile.classList.add('dim');
        if (cargo.sel && cargo.sel.from === 'other' && cargo.sel.k === t.k) tile.classList.add('sel');
        bindTile(tile, { from: 'other', k: t.k, n: t.n, made: !!t.made });
        gO.appendChild(tile);
      });
      if (!tiles.length) gO.appendChild(el('div', 'hv-people-empty', tr('hv_cargo_empty')));
      box.appendChild(gO);
    } else {
      box.appendChild(el('div', 'hv-people-title', tr('hv_cargo_mine')));
      const gMine = el('div', 'hv-cargo-grid hv-cargo-mine');
      [['hand', inv.hand], ...inv.pack.map((it, i) => [i, it])].forEach(([slot, it]) => {
        if (!it) return;
        const tile = el('button', 'hv-slot hv-tile');
        tile.type = 'button';
        fillSlot(tile, it);
        if (slot === 'hand') tile.appendChild(el('i', 'hv-tile-hand', '✋'));
        if (kept(kindOf(it))) tile.classList.add('dim');
        if (cargo.sel && cargo.sel.from === 'mine' && cargo.sel.slot === slot) tile.classList.add('sel');
        bindTile(tile, { from: 'mine', slot, k: kindOf(it), kept: kept(kindOf(it)) });
        gMine.appendChild(tile);
      });
      if (!gMine.children.length) gMine.appendChild(el('div', 'hv-people-empty', tr('hv_cargo_nothing')));
      box.appendChild(gMine);
    }

    const acts = el('div', 'hv-cargo-acts');
    const act = (label, run) => {
      const a = el('button', 'hv-make', label);
      a.type = 'button';
      a.onclick = () => { cargo.sel = null; run(); renderCargo(); };
      acts.appendChild(a);
    };
    const s = cargo.sel, id = d.id;
    const item = s && { item: tr('hv_name_' + s.k) };
    const top = { build: id }, oRef = o && o.ref;
    const oOpen = o && !(o.d.kind === 'site' && o.d.done);
    if (s && s.from === 'other' && s.made) {
      act(tr('hv_act_take_made', item), () => takeOther(o, null, false));
    } else if (s && s.from === 'other' && s.n > 0) {
      if (!(site && d.done)) {
        act(tr('hv_cargo_move_one', item), () => mp.send({ type: 'hv_shift', src: oRef, dst: top, k: s.k }));
        if (s.n > 1) act(tr('hv_cargo_move_all', item), () => mp.send({ type: 'hv_shift', src: oRef, dst: top, k: s.k, all: true }));
      }
      act(tr('hv_cargo_take_one'), () => takeOther(o, s.k, false));
      if (s.n > 1) act(tr('hv_cargo_take_all'), () => takeOther(o, s.k, true));
    } else if (s && s.from === 'on' && s.made) {
      act(tr('hv_act_take_made', item), () => mp.send({ type: 'hv_pick', build: id }));
    } else if (s && s.from === 'on' && s.n > 0 && oOpen) {
      act(tr('hv_cargo_move_one', item), () => mp.send({ type: 'hv_shift', src: top, dst: oRef, k: s.k }));
      if (s.n > 1) act(tr('hv_cargo_move_all', item), () => mp.send({ type: 'hv_shift', src: top, dst: oRef, k: s.k, all: true }));
      act(tr('hv_cargo_unload'), () => mp.send({ type: 'hv_unload', build: id, k: s.k, all: true }));
    } else if (s && s.from === 'on' && s.n > 0) {
      act(tr('hv_cargo_take_one'), () => mp.send({ type: 'hv_pick', build: id, k: s.k }));
      if (s.n > 1) act(tr('hv_cargo_take_all'), () => mp.send({ type: 'hv_pick', build: id, k: s.k, all: true }));
      act(tr('hv_cargo_unload'), () => mp.send({ type: 'hv_unload', build: id, k: s.k, all: true }));
      act(tr('hv_cargo_put_one'), () => { cargo.spot = { from: 'on', k: s.k, all: false }; });
      if (s.n > 1) act(tr('hv_cargo_put_all'), () => { cargo.spot = { from: 'on', k: s.k, all: true }; });
    } else if (s && s.from === 'mine' && !s.kept) {
      const it = s.slot === 'hand' ? inv.hand : inv.pack[s.slot];
      const many = countOf(it) > 1;
      act(tr(site ? 'hv_cargo_add_one' : 'hv_cargo_load_one'), () => mp.send({ type: 'hv_drop', build: id, slot: s.slot }));
      if (many) act(tr(site ? 'hv_cargo_add_all' : 'hv_cargo_load_all'), () => mp.send({ type: 'hv_drop', build: id, slot: s.slot, all: true }));
      act(tr('hv_cargo_drop'), () => { cargo.spot = { from: 'mine', slot: s.slot }; });
    } else if (s && s.from === 'mine') {
      acts.appendChild(el('div', 'hv-people-empty', tr('hv_keep_tool')));
    } else {
      if (!site && d.load.length) act(tr('hv_cargo_unload_all'), () => mp.send({ type: 'hv_unload', build: id, all: true }));
      if (site && !d.done) act(tr('hv_remove_build'), () => { queueTask(tr('hv_remove_build'), () => removeBuildAction(id)); closeCargo(); });
      if (site && !d.done && on.some(t => t.n)) act(tr('hv_cargo_unload_all'), () => mp.send({ type: 'hv_unload', build: id, all: true }));
    }
    if (acts.children.length) box.appendChild(acts);
    box.appendChild(el('div', 'hv-cargo-note', tr('hv_cargo_hint')));
  }

  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function buildName(d) {
    const make = d.kind === 'site' ? d.make : d.kind;
    return (ICON[make] || '') + ' ' + cap(d.kind === 'site' && !d.done ? tr('hv_frame', { item: tr('hv_name_' + make) }) : tr('hv_name_' + make));
  }

  // Into the player's things from the second thing: from where they stand,
  // or after a walk over to it.
  function takeOther(o, k, all) {
    const msg = o.pile ? { type: 'hv_pick', pile: o.d.id, all } : k ? { type: 'hv_pick', build: o.d.id, k, all } : { type: 'hv_pick', build: o.d.id };
    const far = Math.hypot(o.d.x - me.x, o.d.z - me.z) > (o.pile ? T.reach - 0.3 : T.reach + 1);
    if (!far) return mp.send(msg);
    queueTask(tr('hv_cargo_take_all'), () => goAct(o.d.x, o.d.z, 1.5, () => mp.send(msg)));
  }

  // A tile: a tap chooses it, a drag carries it somewhere.
  function bindTile(tile, sel) {
    tile.style.touchAction = 'none';
    tile.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      cargo.drag = { sel, x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: false, ghost: null };
    });
  }

  function cargoMove(e) {
    const g = cargo && cargo.drag;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 8) return;
    if (!g.moved) {
      g.moved = true;
      g.ghost = el('div', 'hv-drag', ICON[g.sel.k] || '❔');
      app.appendChild(g.ghost);
    }
    g.ghost.style.left = e.clientX + 'px';
    g.ghost.style.top = e.clientY + 'px';
  }

  function cargoUp(e) {
    const g = cargo && cargo.drag;
    if (!g || g.id !== e.pointerId) return;
    cargo.drag = null;
    if (g.ghost) g.ghost.remove();
    const s = g.sel, id = cargo.id;
    if (!g.moved) {
      // A tap: choose it, or let go of it when it is already chosen.
      const same = cargo.sel && cargo.sel.from === s.from && cargo.sel.k === s.k && cargo.sel.slot === s.slot;
      cargo.sel = same ? null : s;
      return renderCargo();
    }
    cargo.dirty = false;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const into = over && over.closest('.hv-cargo-on, .hv-cargo-mine, .hv-cargo-other, .hv-inv, .hv-cargo, .hv-stage');
    const mine = into && (into.classList.contains('hv-cargo-mine') || into.classList.contains('hv-inv'));
    const o = cargoOther();
    if (o && s.from === 'other' && into && into.classList.contains('hv-cargo-on') && !s.made) {
      mp.send({ type: 'hv_shift', src: o.ref, dst: { build: id }, k: s.k, all: true });
    } else if (o && s.from === 'other' && mine) {
      takeOther(o, s.made ? null : s.k, true);
    } else if (o && s.from === 'on' && into && into.classList.contains('hv-cargo-other') && !s.made) {
      mp.send({ type: 'hv_shift', src: { build: id }, dst: o.ref, k: s.k, all: true });
    } else if (s.from === 'other') {
      // Nothing to do with it elsewhere.
    } else if (mine && s.from === 'on') {
      mp.send(s.made ? { type: 'hv_pick', build: id } : { type: 'hv_pick', build: id, k: s.k, all: true });
    } else if (into && into.classList.contains('hv-cargo-on') && s.from === 'mine' && !s.kept) {
      mp.send({ type: 'hv_drop', build: id, slot: s.slot, all: true });
    } else if (into && into.classList.contains('hv-stage') && !s.made && !s.kept) {
      cargo.spot = s.from === 'on' ? { from: 'on', k: s.k, all: true } : { from: 'mine', slot: s.slot };
      spotClick(e.clientX, e.clientY, true);
    }
    renderCargo();
  }

  // Where what was chosen in the window is put down on the ground.
  function spotClick(cx, cy, quiet) {
    const sp = cargo && cargo.spot, b = cargo && builds.get(cargo.id);
    if (!sp || !b) return;
    const g = groundRay(cx, cy);
    if (!g || g.kind !== 'ground') { if (!quiet) toast(tr('hv_bad_spot')); cargo.spot = quiet ? null : sp; return renderCargo(); }
    if (sp.from === 'on') {
      const distance = isStructure(b.data) ? footDist(b.data, g.x, g.z) : Math.hypot(g.x - b.data.x, g.z - b.data.z);
      if (distance > T.unload_reach) { toast(tr('hv_cargo_far_spot')); if (quiet) cargo.spot = null; return renderCargo(); }
      mp.send({ type: 'hv_unload', build: b.data.id, k: sp.k, all: sp.all, x: g.x, z: g.z });
    } else {
      if (Math.hypot(g.x - me.x, g.z - me.z) > T.reach) { toast(tr('hv_cargo_far_spot')); if (quiet) cargo.spot = null; return renderCargo(); }
      mp.send({ type: 'hv_drop', slot: sp.slot, x: g.x, z: g.z });
    }
    cargo.spot = null;
    renderCargo();
  }

  // ── fields ───────────────────────────────────────────────────────────────
  // The ground is cut into squares; the server keeps the same grid. A plant
  // grows only while its soil is loose and watered, worked out from the
  // times the server sends, the same way it does it.
  const cellKey = (x, z) => Math.floor(x / T.farm.cell) + '_' + Math.floor(z / T.farm.cell);
  function cellPos(key) {
    const [a, b] = key.split('_').map(Number);
    return { x: (a + 0.5) * T.farm.cell, z: (b + 0.5) * T.farm.cell };
  }
  const soilLoose = (d, now) => d.till > 0 && now - d.till < T.farm.till_life;
  const soilWet = (d, now) => d.wet > 0 && now - d.wet < T.farm.water_life;
  function cropG(d, now) {
    if (!d.crop) return 0;
    const end = Math.min(now, d.wet + T.farm.water_life, d.till + T.farm.till_life);
    return d.crop.g + Math.max(0, end - d.crop.t);
  }
  // How far a fruit of a grown plant is towards ripe: 1 is ripe, -1 while
  // the plant itself is still growing.
  function cropFruit(d, k, now) {
    const g = cropG(d, now), full = T.farm.grow[d.crop.k];
    if (g < full) return -1;
    const base = d.crop.pk[k] != null ? d.crop.pk[k] : full - T.farm.regrow;
    return Math.min(1, (g - base) / T.farm.regrow);
  }
  const cropRipe = (d, k, now) => cropFruit(d, k, now) >= 1;
  const hasKind = (k) => [inv.hand, ...inv.pack].some(x => kindOf(x) === k);
  // Fruit good enough to plant: the kind asked for, or any.
  function seedKind(want) {
    const it = [inv.hand, ...inv.pack].find(x => x && typeof x === 'object' && x.n && qualityOf(x) > 0 && (!want || x.k === want));
    return it ? it.k : null;
  }
  function seedKinds() {
    return [...new Set([inv.hand, ...inv.pack].filter(x => x && typeof x === 'object' && x.n && qualityOf(x) > 0).map(x => x.k))];
  }
  // Bring a tool out of the backpack into the hands; false if there is none.
  function holdKind(k) {
    if (kindOf(inv.hand) === k) return true;
    const i = inv.pack.findIndex(x => kindOf(x) === k);
    if (i < 0) return false;
    mp.send({ type: 'hv_hold', slot: i });
    return true;
  }
  // What F does on a square: dig it, water it, or nothing.
  function plotUse(d) {
    const now = fruitNow(), hk = kindOf(inv.hand);
    if (hk === 'bucket' && d.till && inv.hand.w > 0) return 'water';
    if (!d.till || !soilLoose(d, now) || hk === 'hoe') return hasKind('hoe') ? 'dig' : null;
    return null;
  }
  function needsDig(d, now) { return !d.till || !soilLoose(d, now); }

  function fmtDur(sec) {
    const m = Math.max(1, Math.round(sec / 60));
    return m >= 60 ? tr('hv_dur_h', { h: Math.floor(m / 60), m: m % 60 }) : tr('hv_dur_m', { m });
  }
  function plotStatus(d) {
    const now = fruitNow(), out = [];
    if (!d.till) return ['🟫 ' + tr('hv_plot_marked')];
    if (d.crop) {
      const full = T.farm.grow[d.crop.k], g = cropG(d, now);
      const ripe = d.crop.pk.filter((_, k) => cropRipe(d, k, now)).length;
      out.push((ICON[d.crop.k] || '🌱') + ' ' + tr('hv_name_' + d.crop.k) + ' · ' + (g < full
        ? tr('hv_plot_growing', { n: Math.floor(g / full * 100) })
        : ripe ? tr('hv_plot_ripe', { n: ripe }) : tr('hv_plot_regrowing')));
    }
    out.push(soilLoose(d, now) ? tr('hv_soil_loose', { t: fmtDur(d.till + T.farm.till_life - now) }) : tr('hv_soil_hard'));
    out.push(soilWet(d, now) ? tr('hv_soil_wet', { t: fmtDur(d.wet + T.farm.water_life - now) }) : tr('hv_soil_dry'));
    if (d.crop && !(soilLoose(d, now) && soilWet(d, now))) out.push('⚠ ' + tr('hv_plot_stalled'));
    return out;
  }

  // The menu of a field square in click mode.
  function plotMenu(p, e) {
    const d = p.data, now = fruitNow(), items = [];
    const at = (fn) => goAct(d.x, d.z, 1.4, fn);
    if (d.crop) fruitItems(items, 'f' + d.c, d.crop.k, d.x, d.z, 1.8);
    const hoe = hasKind('hoe');
    if (!d.till) {
      items.push({ task: true, group: tr('hv_m_dig'), label: hoe ? tr('hv_m_dig_here') : tr('hv_need_hoe'), off: !hoe, run: () => at(() => startDig(d.c)) });
      if (hoe) {
        items.push({ group: tr('hv_m_dig'), task: true, label: tr('hv_m_dig_garden'), run: () => at(() => startAuto('dig', null, d.c)) });
        items.push({ group: tr('hv_m_dig'), task: true, label: tr('hv_m_dig_all'), run: () => startAuto('dig') });
      }
      items.push({ label: tr('hv_m_unmark'), run: () => mp.send({ type: 'hv_plan', cells: [d.c], on: false }) });
    } else {
      const bw = bucketWater();
      if (hasKind('bucket')) {
        items.push({ task: true, group: tr('hv_m_water'), label: bw > 0 ? tr('hv_m_water_here') : tr('hv_bucket_empty'), off: bw <= 0, run: () => at(() => waterPlot(d.c)) });
        if (bw > 0) {
          items.push({ task: true, group: tr('hv_m_water'), label: tr('hv_m_water_garden'), run: () => at(() => startAuto('water', null, d.c)) });
          items.push({ task: true, group: tr('hv_m_water'), label: tr('hv_m_water_all'), run: () => at(() => startAuto('water')) });
        }
      } else if (d.crop && !soilWet(d, now)) items.push({ label: tr('hv_need_bucket'), off: true, run: () => {} });
      if (hoe) items.push({ task: true, group: tr('hv_m_dig'), label: tr(needsDig(d, now) ? 'hv_m_dig_here' : 'hv_m_loosen'), run: () => at(() => startDig(d.c)) });
      if (hoe) {
        items.push({ group: tr('hv_m_dig'), task: true, label: tr('hv_m_dig_garden'), run: () => at(() => startAuto('dig', null, d.c)) });
        items.push({ group: tr('hv_m_dig'), task: true, label: tr('hv_m_dig_all'), run: () => startAuto('dig') });
      }
      if (!d.crop && soilLoose(d, now)) {
        const kinds = seedKinds();
        kinds.forEach(k => {
          items.push({ task: true, group: tr('hv_m_plant_group'), label: tr('hv_m_plant', { item: tr('hv_name_' + k) }), run: () => at(() => plantPlot(d.c, k)) });
          items.push({ task: true, group: tr('hv_m_plant_group'), label: tr('hv_m_plant_all', { item: tr('hv_name_' + k) }), run: () => startAuto('plant', k) });
        });
        if (!kinds.length) items.push({ label: tr('hv_no_seed'), off: true, run: () => {} });
      }
      if (d.crop) items.push({ task: true, label: tr('hv_m_uproot'), run: () => at(() => mp.send({ type: 'hv_uproot', c: d.c })) });
    }
    showMenu(items, e.clientX, e.clientY, plotStatus(d).join('\n'));
    markHit = { kind: 'plot', x: d.x, z: d.z, data: p };
  }

  function startDig(c) {
    const p = plots.get(c);
    if (!p) return;
    if (!holdKind('hoe')) { toast(tr('hv_need_hoe')); autoTask = null; return; }
    digAt = { c, till: p.data.till };
    digHeld = true;
  }

  // Called every frame; returns true while the player is digging.
  function updateDig(dt, moving) {
    if (!digAt) return false;
    const p = plots.get(digAt.c);
    // The square is done once the server says it was dug.
    if (!p || p.data.till !== digAt.till || !digHeld || moving) { digAt = null; return false; }
    if (kindOf(inv.hand) !== 'hoe') return false;   // the hoe is still coming out
    const now = performance.now();
    if (now - digClock >= T.chop_tick * 1000) { digClock = now; mp.send({ type: 'hv_dig', c: digAt.c }); }
    let d = Math.atan2(p.data.x - me.x, p.data.z - me.z) - me.ry;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    me.ry += d * (1 - Math.exp(-dt * 10));
    return true;
  }

  function waterPlot(c) {
    if (!holdKind('bucket')) return toast(tr('hv_need_bucket'));
    mp.send({ type: 'hv_water', c });
  }
  function fillBucket() {
    const water = drinkSpot();
    if (!water) return;
    if (!holdKind('bucket')) return toast(tr('hv_need_bucket'));
    mp.send({ type: 'hv_water', water });
  }
  function plantPlot(c, k) { mp.send({ type: 'hv_plant', c, k }); }

  // Work every square that needs it, nearest first: dig, water or plant.
  // A garden is one connected patch of plots, including diagonal neighbours.
  function gardenCells(c) {
    const cells = new Set(), pending = [c];
    while (pending.length) {
      const key = pending.pop();
      if (cells.has(key) || !plots.has(key)) continue;
      cells.add(key);
      const [x, z] = key.split('_').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx || dz) pending.push((x + dx) + '_' + (z + dz));
      }
    }
    return cells;
  }
  function startAuto(kind, item, garden = null) {
    autoTask = { kind, item, cells: garden === null ? null : gardenCells(garden), at: 0, last: null, n: 0, skip: new Set() };
    nextAuto();
  }
  function nextAuto() {
    const t = autoTask;
    if (!t) return;
    t.at = performance.now();
    const now = fruitNow();
    if (t.kind === 'dig' && !hasKind('hoe')) { toast(tr('hv_need_hoe')); autoTask = null; return; }
    if (t.kind === 'water' && bucketWater() <= 0) { toast(tr('hv_bucket_empty')); autoTask = null; return; }
    if (t.kind === 'plant' && !seedKind(t.item)) { toast(tr('hv_no_seed')); autoTask = null; return; }
    const wants = (d) => t.kind === 'dig' ? needsDig(d, now)
      : t.kind === 'water' ? d.till && !soilWet(d, now)
      : t.kind === 'harvest' ? d.crop && d.crop.k === t.item && ripeOf('f' + d.c).length > 0
      : !d.crop && soilLoose(d, now);
    const reach = t.cells ? Infinity : (t.kind === 'dig' || t.kind === 'water') ? T.farm.plan_reach : 30;
    let best = null, bd = reach;
    plots.forEach(p => {
      if ((t.cells && !t.cells.has(p.data.c)) || t.skip.has(p.data.c) || !wants(p.data)) return;
      const dd = Math.hypot(p.data.x - me.x, p.data.z - me.z);
      if (dd < bd) { bd = dd; best = p; }
    });
    if (!best) {
      const remaining = t.kind === 'harvest' ? 0 : [...plots.values()].filter(p =>
        (!t.cells || t.cells.has(p.data.c)) && wants(p.data) &&
        Math.hypot(p.data.x - me.x, p.data.z - me.z) < reach).length;
      if (remaining) toast(tr('hv_work_remaining', { n: remaining }));
      else toast(tr(t.kind === 'dig' ? (t.cells ? 'hv_garden_dug' : 'hv_all_dug') : t.kind === 'water' ? (t.cells ? 'hv_garden_watered' : 'hv_all_watered') : t.kind === 'harvest' ? 'hv_garden_harvested' : 'hv_all_planted'));
      autoTask = null;
      return;
    }
    // A square that cannot be reached is left out after a few tries.
    const c = best.data.c;
    t.n = t.last === c ? t.n + 1 : 0;
    t.last = c;
    if (t.n >= 3) { t.skip.add(c); return; }
    goAct(best.data.x, best.data.z, t.kind === 'harvest' ? 1.8 : 1.4, () => {
      if (autoTask !== t) return;
      t.at = performance.now();
      if (t.kind === 'dig') startDig(c);
      else if (t.kind === 'water') waterPlot(c);
      else if (t.kind === 'harvest') {
        t.skip.add(c);
        gatherAll = { src: 'f' + c, left: Infinity, tried: new Set(), at: 0 };
      }
      else plantPlot(c, t.item);
    });
  }

  let farmGeo = null;
  function farmParts() {
    if (farmGeo) return farmGeo;
    const m = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, flatShading: true, roughness: 0.95 }, o));
    const soil = (c) => m(c, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const glass = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 6); trunk.translate(0, 0.5, 0);
    farmGeo = {
      box: new THREE.BoxGeometry(1, 1, 1), bush: new THREE.IcosahedronGeometry(1, 0), trunk,
      sprout: new THREE.ConeGeometry(0.07, 0.28, 4), fruit: new THREE.IcosahedronGeometry(1, 1),
      loose: soil('#6b4529'), wet: soil('#3e2717'), hard: soil('#9a8463'),
      plan: glass('#f6e7b0'), pend: glass('#9be37a'), erase: glass('#e5624f'), bad: glass('#e5624f'),
      leaf: m('#4f8a3a'), crown: m('#5f9e3f'), bark: m('#7a5234'), sprig: m('#7cc456'),
      apple: m('#d8392f', { roughness: 0.45 }), berries: m('#6a4bd1', { roughness: 0.45 }),
    };
    return farmGeo;
  }

  // A square of ground at full cell size whose corners and inner points sit
  // on the terrain itself, so it never cuts into a slope and neighbouring
  // squares meet edge to edge as one field. Heights are relative to oy.
  // ridges > 0 raises that many furrows across it, zero at both edges so a
  // dug square still joins a flat neighbour without a step.
  function groundPatch(x, z, oy, size, lift, ridges, amp) {
    const seg = ridges ? ridges * 4 : 6, step = size / seg, h = size / 2, n = seg + 1;
    const pos = new Float32Array(n * n * 3), idx = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = -h + i * step, lz = -h + j * step, k = (j * n + i) * 3;
        const b = ridges ? amp * Math.pow(Math.sin(Math.PI * ridges * j / seg), 2) : 0;
        pos[k] = lx; pos[k + 1] = groundAt(x + lx, z + lz) - oy + lift + b; pos[k + 2] = lz;
        if (i < seg && j < seg) {
          const a = j * n + i;
          idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    return flat;
  }
  function dropGroup(g) {
    g.traverse(o => { if (o.userData.own) o.geometry.dispose(); });
  }

  // What a square looks like now, coarse enough that it is redrawn only
  // when something can be seen to change.
  function plotSig(d, now) {
    if (!d.till) return 'p';
    let s = (soilLoose(d, now) ? 'l' : 'h') + (soilWet(d, now) ? 'w' : 'd');
    if (d.crop) {
      s += d.crop.k + Math.floor(Math.min(1, cropG(d, now) / T.farm.grow[d.crop.k]) * 20);
      d.crop.pk.forEach((_, k) => { s += ',' + Math.round(cropFruit(d, k, now) * 5); });
    }
    return s;
  }

  function drawPlot(p) {
    const d = p.data, F = farmParts(), c = T.farm.cell, now = fruitNow();
    if (p.group) { scene.remove(p.group); dropGroup(p.group); }
    const g = new THREE.Group(), oy = groundAt(d.x, d.z);
    g.position.set(d.x, oy, d.z);
    const add = (geo, mat, sx, sy, sz, x, y, z, shadow) => {
      const o = new THREE.Mesh(geo, mat);
      o.scale.set(sx, sy, sz); o.position.set(x, y, z);
      if (shadow) o.castShadow = true;
      o.receiveShadow = true;
      g.add(o);
      return o;
    };
    const patch = (mat, lift, ridges, amp) => {
      const o = new THREE.Mesh(groundPatch(d.x, d.z, oy, c, lift, ridges, amp), mat);
      o.userData.own = true;
      o.receiveShadow = true;
      g.add(o);
    };
    if (!d.till) {
      patch(F.plan, 0.05, 0, 0);
    } else {
      const loose = soilLoose(d, now);
      patch(loose ? (soilWet(d, now) ? F.wet : F.loose) : F.hard, 0.035, loose ? 3 : 0, 0.09);
    }
    if (d.crop) {
      const full = T.farm.grow[d.crop.k], f = Math.min(1, cropG(d, now) / full), n = d.crop.pk.length;
      if (f < 0.06) {
        add(F.sprout, F.sprig, 1, 1, 1, 0, 0.18, 0, true);
      } else if (d.crop.k === 'berries') {
        const r = 0.12 + 0.5 * f, y = 0.05 + r * 0.35;
        add(F.bush, F.leaf, r * 1.2, r * 0.85, r * 1.2, 0, y, 0, true);
        if (f >= 1) d.crop.pk.forEach((_, k) => {
          const q = cropFruit(d, k, now), a = (k / n) * Math.PI * 2 + 0.4, sz = 0.1 * (q >= 1 ? 1 : 0.2 + 0.8 * q);
          add(F.fruit, F.berries, sz, sz, sz, Math.cos(a) * r * 0.96, y + r * 0.85 * (0.25 + (k % 2) * 0.3), Math.sin(a) * r * 0.96);
        });
      } else {
        const sc = 0.15 + 0.6 * f, th = 1.8 * sc, r = 1.6 * sc;
        add(F.trunk, F.bark, sc, th, sc, 0, -0.05, 0, true);
        add(F.bush, F.crown, r, r * 0.9, r, 0, th + r * 0.55, 0, true);
        if (f >= 1) d.crop.pk.forEach((_, k) => {
          const q = cropFruit(d, k, now), a = (k / n) * Math.PI * 2 + 0.4, sz = 0.2 * (q >= 1 ? 1 : 0.2 + 0.8 * q);
          add(F.fruit, F.apple, sz, sz, sz, Math.cos(a) * r * 0.85, th + r * 0.45 + (k % 2) * 0.25, Math.sin(a) * r * 0.85);
        });
      }
    }
    scene.add(g);
    p.group = g;
    p.sig = plotSig(d, now);
  }

  function showPlot(data) {
    const p = plots.get(data.c) || { data, group: null, sig: null };
    p.data = data;
    plots.set(data.c, p);
    if (data.till) digProg.delete(data.c);
    drawPlot(p);
  }
  function removePlot(c) {
    const p = plots.get(c);
    if (!p) return;
    if (p.group) { scene.remove(p.group); dropGroup(p.group); }
    plots.delete(c);
    digProg.delete(c);
  }
  // Plants grow and soil dries without a word from the server.
  function refreshPlots() {
    const now = fruitNow();
    plots.forEach(p => {
      if (Math.hypot(p.data.x - cam.x, p.data.z - cam.z) > 160) return;
      if (plotSig(p.data, now) !== p.sig) drawPlot(p);
    });
  }

  // ── marking a field ──────────────────────────────────────────────────────
  // Like placing a frame: squares are marked first and dug afterwards. They
  // are painted by dragging over the ground with the mouse or a finger.
  function startTilling() {
    stopHousing(); stopPlacing();
    toggleCraft(false);
    goal = null; autoTask = null;
    tilling = { pend: new Set(), erase: null, paint: null, hover: null, ghost: new THREE.Group(), sig: '' };
    scene.add(tilling.ghost);
    renderCraftBtn();
  }
  function stopTilling(dig) {
    if (!tilling) return;
    endPaint();
    scene.remove(tilling.ghost); dropGroup(tilling.ghost);
    tilling = null;
    renderCraftBtn();
    // Then the marked squares get dug, one after another.
    if (!dig) return;
    const now = fruitNow();
    if (![...plots.values()].some(p => needsDig(p.data, now))) return;
    if (hasKind('hoe')) startAuto('dig');
    else toast(tr('hv_need_hoe'));
  }
  // Whether a square can be dug: dry land, no tree, nothing built on it.
  function cellFree(key) {
    if (plots.has(key)) return false;
    const { x, z } = cellPos(key), c = T.farm.cell;
    const g = groundAt(x, z);
    if (g < 0.4 || (shoreLevel(x, z) ?? -Infinity) > g - 0.05 || slopeAt(x, z) > 0.6) return false;
    if (gridNearest(treeGrid, x, z, c * 0.75, t => !t.felled, t => t.r)) return false;
    for (const b of builds.values()) if (isStructure(b.data) ? housingOverlaps({ x, z, width: c, depth: c }, b.data) : Math.hypot(b.data.x - x, b.data.z - z) < c) return false;
    return true;
  }
  // One point of a drag: every square on the way from the last point is
  // added, all marked or all unmarked as the first square decides.
  function paintAt(cx, cy) {
    const h = groundRay(cx, cy);
    if (!h || !tilling.paint) return;
    const t = tilling, last = t.paint.last || h;
    const n = Math.max(1, Math.ceil(Math.hypot(h.x - last.x, h.z - last.z) / (T.farm.cell / 3)));
    for (let i = 1; i <= n; i++) {
      const key = cellKey(last.x + (h.x - last.x) * i / n, last.z + (h.z - last.z) * i / n);
      if (t.erase === null) { const p = plots.get(key); t.erase = !!(p && !p.data.till); }
      if (t.pend.size >= T.farm.plan_max) break;
      const p = plots.get(key);
      if (t.erase ? p && !p.data.till : cellFree(key)) t.pend.add(key);
    }
    t.paint.last = h;
  }
  function endPaint() {
    const t = tilling;
    if (!t || !t.paint) return;
    if (t.pend.size) mp.send({ type: 'hv_plan', cells: [...t.pend], on: !t.erase });
    t.pend = new Set();
    t.paint = null;
  }
  // The squares about to be marked, or the one under the pointer.
  function updateTilling() {
    if (!tilling) return;
    const t = tilling;
    const shown = t.paint ? [...t.pend] : t.hover ? [t.hover] : [];
    const sig = shown.join('|') + (t.erase ? '-' : '+') + plots.size;
    if (sig === t.sig) return;
    t.sig = sig;
    const F = farmParts(), c = T.farm.cell;
    dropGroup(t.ghost);
    t.ghost.clear();
    shown.forEach(key => {
      const p = plots.get(key), { x, z } = cellPos(key);
      const mat = t.erase || (p && !p.data.till) ? F.erase : cellFree(key) ? F.pend : F.bad;
      const o = new THREE.Mesh(groundPatch(x, z, 0, c, 0.09, 0, 0), mat);
      o.userData.own = true;
      o.position.set(x, 0, z);
      o.renderOrder = 15;
      t.ghost.add(o);
    });
  }

  // ── local player ─────────────────────────────────────────────────────────
  function collide(x, z, r) {
    const cx = Math.floor(x / OB_CELL), cz = Math.floor(z / OB_CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = obstacles.get((cx + i) + ',' + (cz + j));
        if (!list) continue;
        for (const o of list) {
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
          if (d < min && d > 1e-4) { x = o.x + dx / d * min; z = o.z + dz / d * min; }
        }
      }
    }
    for (const wall of wallRects()) {
      const dx = x - wall.x, dz = z - wall.z, hx = wall.w / 2 + r, hz = wall.l / 2 + r;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        if (hx - Math.abs(dx) < hz - Math.abs(dz)) x = wall.x + (dx >= 0 ? hx : -hx);
        else z = wall.z + (dz >= 0 ? hz : -hz);
      }
    }
    return [x, z];
  }

  // Whether a walker of this size can stand here: nothing in the way and
  // water no deeper than it can wade. `skip` is the thing being walked to.
  function freeAt(x, z, r, skip, maxDepth) {
    const cx = Math.floor(x / OB_CELL), cz = Math.floor(z / OB_CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = obstacles.get((cx + i) + ',' + (cz + j));
        if (!list) continue;
        for (const o of list) {
          if (skip && Math.hypot(o.x - skip.x, o.z - skip.z) < 0.6) continue;
          if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
        }
      }
    }
    // Keep the walker’s actual radius at doorways; the wider steering
    // margin used around trees would close a 1.2 m entrance completely.
    const wallRadius = Math.min(r, .35);
    if (wallRects().some(w => Math.abs(x - w.x) < w.w / 2 + wallRadius && Math.abs(z - w.z) < w.l / 2 + wallRadius)) return false;
    return (shoreLevel(x, z) ?? 0) - walkGround(x, z) <= maxDepth;
  }

  // The heading that goes round whatever stands between here and the goal:
  // the straight line if it is clear, else the nearest angle to it that is.
  function steer(gx, gz, gd, maxDepth) {
    const base = Math.atan2(gx, gz), look = Math.min(gd, 3);
    const skip = goal;
    const clear = (ang) => {
      for (let d = 0.7; d <= look + 0.01; d += 0.7) {
        if (!freeAt(me.x + Math.sin(ang) * d, me.z + Math.cos(ang) * d, 0.6, skip, maxDepth)) return false;
      }
      return true;
    };
    const side = goal.side || 1;
    for (let k = 0; k <= 7; k++) {
      for (const sg of k ? [side, -side] : [1]) {
        const ang = base + sg * k * 0.3;
        if (clear(ang)) { if (k) goal.side = sg; else goal.side = 0; return ang; }
      }
    }
    return base;
  }

  function updateMe(dt) {
    let mx = 0, mz = 0, mag = 0;
    // A log in the arms or a sled on the rope: walking only.
    const pulled = myPull();
    const heavy = inv.hand === 'log' || !!pulled;
    // Walking is the default; running is chosen for a trip and needs energy.
    let running = false;
    if (goal) {
      // Walking to a clicked place or thing.
      const gx = goal.x - me.x, gz = goal.z - me.z, gd = Math.hypot(gx, gz);
      const now = performance.now();
      if (goal.until ? goal.until() : gd <= goal.r) {
        const f = goal.after; goal = null;
        if (f) f();
      } else if (now - goal.t0 > goal.limit || (now - goal.chk > 1500 && Math.hypot(me.x - goal.cx, me.z - goal.cz) < 0.4)) {
        goal = null;
      } else {
        if (now - goal.chk > 1500) { goal.chk = now; goal.cx = me.x; goal.cz = me.z; }
        let ang = steer(gx, gz, gd, pulled ? T.sled_wade : T.wade);
        // Turn gradually so the path curves round things instead of jerking.
        if (goal.hd === undefined) goal.hd = ang;
        let dd = Math.atan2(Math.sin(ang - goal.hd), Math.cos(ang - goal.hd));
        goal.hd += dd * (1 - Math.exp(-dt * 9));
        mx = Math.sin(goal.hd); mz = Math.cos(goal.hd); mag = 1;
        running = goal.run && !heavy && needs.energy > 0;
      }
    }
    let speed = mag > 0 ? (running ? T.run_speed : T.walk_speed) : 0;
    if (speed > 0 && needs.energy <= 0) speed *= 0.6;
    if (speed > 0 && pulled) {
      // The load slows the puller; too much for their strength, or no energy
      // left to pull it with, and the sled does not move.
      const f = sledFactor(pulled), load = loadTotals(pulled.data.load).kg;
      if (f <= 0 || (needs.energy <= 0 && load)) {
        speed = 0;
        if (performance.now() - warnAt > 3000) { warnAt = performance.now(); toast(tr(f <= 0 ? 'hv_too_heavy' : 'hv_tired_pull')); }
      } else speed *= f;
    }

    if (speed > 0) {
      let nx = me.x + mx * speed * dt, nz = me.z + mz * speed * dt;
      [nx, nz] = collide(nx, nz, 0.35);
      const lim = SIZE / 2 - 3;
      nx = Math.max(-lim, Math.min(lim, nx)); nz = Math.max(-lim, Math.min(lim, nz));
      // Shallow water can be waded, deep water cannot be crossed; a sled
      // only goes through the shallowest of it.
      const depth = (shoreLevel(nx, nz) ?? 0) - groundAt(nx, nz);
      const here = (shoreLevel(me.x, me.z) ?? 0) - groundAt(me.x, me.z);
      const maxDepth = pulled ? T.sled_wade : T.wade;
      if (depth <= maxDepth || depth < here) { me.x = nx; me.z = nz; }
      else if (performance.now() - warnAt > 2500) { warnAt = performance.now(); toast(tr(pulled ? 'hv_sled_water' : 'hv_too_deep')); }
      const want = Math.atan2(mx, mz);
      let d = want - me.ry;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      me.ry += d * (1 - Math.exp(-dt * 12));
    }

    me.y = walkGround(me.x, me.z);
    const chopping = updateChop(dt, speed > 0);
    const digging = !chopping && updateDig(dt, speed > 0);
    me.anim = chopping ? 'chop' : digging ? 'dig' : speed === 0 ? 'idle' : running ? 'run' : 'walk';

    me.ch.root.position.set(me.x, me.y, me.z);
    me.ch.root.rotation.y = me.ry;
    animateCharacter(me.ch, me.anim, dt);
  }

  function sendMove(dt) {
    sendClock += dt;
    if (sendClock < 1 / T.move_rate_hz) return;
    sendClock = 0;
    const s = { x: me.x, y: me.y, z: me.z, ry: me.ry, a: me.anim };
    if (lastSent && Math.abs(lastSent.x - s.x) < 0.02 && Math.abs(lastSent.z - s.z) < 0.02
        && Math.abs(lastSent.y - s.y) < 0.02 && Math.abs(lastSent.ry - s.ry) < 0.02 && lastSent.a === s.a) return;
    lastSent = s;
    mp.send(Object.assign({ type: 'hv_move' }, s));
  }

  function updatePeers(dt) {
    const k = 1 - Math.exp(-dt * 10);
    peers.forEach(p => {
      const r = p.ch.root;
      r.position.x += (p.tx - r.position.x) * k;
      r.position.y += (p.ty - r.position.y) * k;
      r.position.z += (p.tz - r.position.z) * k;
      let d = p.tr - r.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.rotation.y += d * k;
      animateCharacter(p.ch, p.anim, dt);
    });
  }

  function setLock(on, quiet) {
    camLock = on;
    if (!quiet) { try { localStorage.setItem('hv_follow', on ? '1' : '0'); } catch (e) { /* private window */ } }
    camFree = on ? null : { x: cam.x, z: cam.z };
    if (!ui.me) return;
    ui.me.classList.toggle('on', on);
    ui.me.title = tr(on ? 'hv_cam_locked' : 'hv_cam_free');
  }

  // A drag with the right button or two fingers slides the camera over the
  // ground, which follows the pointer; it unlocks the camera from the player.
  function panBy(dx, dy) {
    if (!dx && !dy) return;
    if (camLock) setLock(false);
    if (!camFree) camFree = { x: cam.x, z: cam.z };
    const k = cam.dist / 380 / Math.max(0.35, Math.sin(cam.pitch));
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const lim = SIZE / 2 - 3;
    camFree.x = Math.max(-lim, Math.min(lim, camFree.x + (-rx * dx + fx * dy) * k));
    camFree.z = Math.max(-lim, Math.min(lim, camFree.z + (-rz * dx + fz * dy) * k));
    hideMenu();
  }

  function updateCamera(dt) {
    const free = !camLock;
    if (!free) camFree = null;
    else if (!camFree) camFree = { x: cam.x, z: cam.z };
    const tx = free ? camFree.x : me.x, tz = free ? camFree.z : me.z;
    const ty = free ? Math.max(groundAt(tx, tz), shoreLevel(tx, tz) ?? -Infinity, 0) + 1.5 : me.y + 1.5;
    const k = 1 - Math.exp(-dt * 10);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
    const cp = Math.cos(cam.pitch);
    let px = cam.x + Math.sin(cam.yaw) * cp * cam.dist;
    let pz = cam.z + Math.cos(cam.yaw) * cp * cam.dist;
    let py = cam.y + Math.sin(cam.pitch) * cam.dist;
    py = Math.max(py, groundAt(px, pz) + 0.6, 0.6);
    camera.position.set(px, py, pz);
    camera.lookAt(cam.x, cam.y, cam.z);

    // The sun and its shadows follow what the camera looks at.
    sun.position.set(cam.x + 40, cam.y + 70, cam.z + 25);
    sun.target.position.set(cam.x, cam.y, cam.z);
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    if (!welcome || !app || booting) return;
    if (booted) { syncFromWelcome(); return; }
    booting = true;
    try {
      THREE = await import(welcome.three);
    } catch (e) {
      console.error(e);
      ui.loadingText.textContent = tr('hv_no_webgl');
      booting = false;
      return;
    }
    T = welcome.tuning;
    SIZE = T.world_size;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      ui.loadingText.textContent = tr('hv_no_webgl');
      booting = false;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    ui.stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight('#dcefff', '#58733a', 1.15));
    sun = new THREE.DirectionalLight('#fff0d4', 2.5);
    sun.castShadow = true;
    const sm = isTouch() ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    const rand = mulberry32(welcome.seed);
    buildSky();
    const base = makeHeightFn(welcome.seed);
    planWater(base);
    buildTerrain(carveGround(base));
    buildWater();
    buildInlandWater();
    ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    buildNature();
    buildFruit();
    buildClouds(rand);

    me = { ch: makeCharacter(welcome.you.color), x: 0, y: 0, z: 0, ry: 0, vy: 0, anim: 'idle', grounded: true };
    scene.add(me.ch.root);
    placeMe();
    resetPeers(welcome.peers);
    applyWorld(welcome.world);
    setInv(welcome.inv);
    setStats(welcome);
    cam.x = me.x; cam.y = me.y + 1.5; cam.z = me.z;
    cam.yaw = me.ry + Math.PI;
    if (camFree) camFree = { x: me.x, z: me.z };
    ui.me.querySelector('i').style.background = welcome.you.color;
    updateChunks();

    bindInput(renderer.domElement);
    new ResizeObserver(fit).observe(ui.stage);
    fit();

    booted = true; booting = false;
    ui.loading.classList.add('done');
    setTimeout(() => ui.hint.classList.add('fade'), 9000);
    // At rest nothing else is sent, and rest is when energy comes back.
    setInterval(() => { if (booted && !document.hidden) mp.send({ type: 'hv_sync' }); }, 3000);
    // Fruit keeps spoiling while it is carried: redraw the quality bars.
    setInterval(() => { if (booted && !document.hidden) renderInv(); }, 20000);
    renderer.setAnimationLoop(frame);
  }

  function placeMe() {
    const you = welcome.you;
    if (welcome.spawn || you.x == null) {
      // A newcomer arrives somewhere in the meadow in the middle.
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (groundAt(x, z) > 0.8) { me.x = x; me.z = z; break; }
      }
      me.ry = Math.random() * Math.PI * 2;
    } else {
      me.x = you.x; me.z = you.z; me.ry = you.ry || 0;
    }
    me.y = walkGround(me.x, me.z);
    lastSent = null;
  }

  // A reconnect sends the welcome again: the world is already built, only
  // the people in it may have changed.
  function syncFromWelcome() {
    resetPeers(welcome.peers);
    applyWorld(welcome.world);
    setInv(welcome.inv);
    setStats(welcome);
    chopTree = null;
    digAt = null;
    lastSent = null;
  }

  function fit() {
    if (!renderer) return;
    const w = ui.stage.clientWidth || 1, h = ui.stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    waterTime.value += dt;
    updateMe(dt);
    sendMove(dt);
    updatePeers(dt);
    cameraInput(dt);
    updateCamera(dt);
    updateFalling(dt);
    updateBuilds(dt);
    updatePlacing();
    updateHousing();
    updateCargo();
    updateTilling();
    updateAuto();
    updateTasks();
    updateMarks();
    fruitClock += dt;
    if (fruitClock > 1) { fruitClock = 0; refreshFruit(); refreshPlots(); }
    chunkClock += dt;
    if (chunkClock > 0.5) { chunkClock = 0; updateChunks(); }
    promptClock += dt;
    if (promptClock > 0.12) { promptClock = 0; findTargets(); renderPrompt(); }
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 950) c.position.x -= 1900;
    }
    renderer.render(scene, camera);
  }

  // ── network ──────────────────────────────────────────────────────────────
  mp.on('hv_welcome', (m) => { welcome = m; boot(); renderPeople(); });
  mp.on('hv_join', (m) => {
    if (!m.peer) return;
    addPeer(m.peer);
    if (booted) toast(tr('hv_arrived', { name: m.peer.name }));
  });
  mp.on('hv_leave', (m) => {
    const p = peers.get(m.id);
    if (p && booted) toast(tr('hv_departed', { name: p.name }));
    removePeer(m.id);
  });
  mp.on('hv_move', (m) => {
    const p = peers.get(m.id);
    if (!p) return;
    p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tr = m.ry; p.anim = m.a;
  });
  mp.on('hv_snap', (m) => {
    if (!me) return;
    me.x = m.x; me.z = m.z; me.y = groundAt(m.x, m.z);
    lastSent = null;
  });
  mp.on('room_closed', () => { location.href = HUB_URL; });
  mp.on('hv_inv', (m) => setInv(m.inv));
  mp.on('hv_held', (m) => { const p = peers.get(m.id); if (p) setHeld(p.ch, m.h); });
  mp.on('hv_chop_p', (m) => chopProg.set(m.tree, { p: m.p }));
  mp.on('hv_felled', (m) => {
    if (!booted) return;
    const t = trees.get(m.tree);
    if (t) fellTree(t, true, m.by);
    refreshFruit();
    if (m.pile) showPile(m.pile);
    if (m.by === welcome.you.id) { chopTree = null; toast(tr('hv_tree_felled')); }
  });
  mp.on('hv_stone_taken', (m) => { if (booted) takeStone(m.id); });
  mp.on('hv_pile', (m) => { if (booted && m.pile) { showPile(m.pile); if (cargo && cargo.other && cargo.other.pile === m.pile.id) renderCargo(); } });
  mp.on('hv_pile_gone', (m) => { if (booted) removePile(m.id); if (cargo && cargo.other && cargo.other.pile === m.id) { cargo.other = null; cargo.sel = null; renderCargo(); } });
  mp.on('hv_made', (m) => toast(tr(m.frame ? 'hv_made_frame' : 'hv_made', { item: tr('hv_name_' + m.item) })));
  mp.on('hv_removed', (m) => toast(tr(m.part ? 'hv_removed_cell' : 'hv_removed_build')));
  mp.on('hv_dig_p', (m) => digProg.set(m.c, m.p));
  mp.on('hv_plots', (m) => { if (booted) (m.plots || []).forEach(d => d.gone ? removePlot(d.c) : showPlot(d)); });
  mp.on('hv_broke', (m) => { chopTree = null; if (m.item === 'hoe') { digAt = null; autoTask = null; } toast(tr('hv_broke', { item: tr('hv_name_' + m.item) })); });
  mp.on('hv_build', (m) => {
    if (!booted || !m.build) return;
    // The sled being pulled keeps the place this client has drawn it at.
    const old = builds.get(m.build.id);
    if (old && old.data.by && m.build.by === old.data.by) { m.build.x = old.data.x; m.build.z = old.data.z; m.build.ry = old.data.ry; }
    showBuild(m.build);
    if (cargo && (cargo.id === m.build.id || (cargo.other && cargo.other.build === m.build.id))) renderCargo();
  });
  mp.on('hv_build_gone', (m) => {
    if (booted) removeBuild(m.id);
    if (cargo && cargo.id === m.id) closeCargo();
    else if (cargo && cargo.other && cargo.other.build === m.id) { cargo.other = null; cargo.sel = null; renderCargo(); }
  });
  mp.on('hv_needs', (m) => {
    if (m.skills) Object.assign(skills, m.skills);
    if (m.needs) { needs = m.needs; renderNeeds(); renderSkills(); }
  });
  mp.on('hv_skill', (m) => {
    if (!booted || !SKILL_KEYS.includes(m.k)) return;
    skills[m.k] = m.xp;
    showSkillPill(m.k);
    renderSkills();
    if (m.up) toast(tr('hv_skill_up', { skill: tr('hv_skill_' + m.k), n: skillLevel(m.k) }));
  });
  mp.on('hv_fruit', (m) => {
    fruitAt.set(m.src + '#' + m.k, m.at);
    refreshFruit();
  });
  const NOPE = {
    no_food: 'hv_no_food', rotten: 'hv_rotten_food', not_accepted: 'hv_not_accepted',
    unripe: 'hv_unripe', not_hungry: 'hv_not_hungry', not_thirsty: 'hv_not_thirsty',
    tired: 'hv_tired', too_heavy: 'hv_too_heavy',
    far: 'hv_too_far', full: 'hv_pack_full', hands_full: 'hv_hands_full', too_big: 'hv_too_big',
    need_stone: 'hv_need_stone', keep_tool: 'hv_keep_tool',
    sled_full: 'hv_sled_full', far_spot: 'hv_cargo_far_spot', crowded: 'hv_crowded', not_needed: 'hv_not_needed', taken: 'hv_taken',
    bad_structure: 'hv_structure_invalid', need_floor: 'hv_need_floor',
    need_hoe: 'hv_need_hoe', need_bucket: 'hv_need_bucket', need_axe: 'hv_need_axe', bucket_empty: 'hv_bucket_empty',
    soil_hard: 'hv_soil_hard_nope', no_seed: 'hv_no_seed', plan_none: 'hv_plan_none',
  };
  mp.on('hv_nope', (m) => {
    if (m.reason === 'far' || m.reason === 'need_stone' || m.reason === 'tired' || m.reason === 'too_big' || m.reason === 'hands_full') { chopTree = null; if (autoUse === 'chop') { autoUse = null; chopHeld = false; } }
    if (m.reason === 'far' || m.reason === 'full') gatherAll = null;
    if (['far', 'need_hoe', 'tired', 'need_bucket', 'bucket_empty', 'soil_hard', 'no_seed', 'full', 'too_big', 'hands_full'].includes(m.reason)) { digAt = null; digHeld = false; autoTask = null; }
    if (m.reason === 'too_big') return toast(tr('hv_too_big', { item: tr('hv_name_' + (kindOf(inv.hand) || 'log')) }));
    if (NOPE[m.reason]) toast(tr(NOPE[m.reason]));
  });

  // ── Game Hub ─────────────────────────────────────────────────────────────
  function renderSetup(box) {
    box.innerHTML = '<div class="hv-setup"><div class="hv-mark">🏡</div><h2></h2><p></p></div>';
    box.querySelector('h2').textContent = tr('hv_title');
    box.querySelector('p').textContent = tr('hv_setup');
  }

  function renderGame(at) {
    // Game Hub calls this again after a reconnect; the scene survives it.
    if (!app) buildDom();
    at.appendChild(app);
    boot();
  }

  mp.registerGame({
    id: GAME_ID, name: tr('hv_title'), renderSetup, renderGame,
    // The world keeps itself: nothing to save, and leaving is our own button.
    saveable: false, exitButton: false,
  });
})();
