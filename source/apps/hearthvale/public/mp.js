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
  const keys = new Set();
  const stick = { x: 0, y: 0, active: false, id: null };
  let jumpQueued = false;
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
  let target = { pick: null, tree: null };
  const chopProg = new Map();   // tree id -> { p, at }
  let chopTree = null, chopClock = 0, chopHeld = false;
  let ZERO = null;
  const builds = new Map();     // id -> { data, group, load, rope, obst }
  let placing = null;           // what is being placed: { make, ghost, ok }
  const SLED_W = 1.2, SLED_L = 2.3;   // footprint of a frame or a sled

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
      if (h < -0.6) c.copy(wet);
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
          if (h < 1.8 || slopeAt(x, z) > 0.55 || Math.hypot(x, z) < 22) continue;
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
          }
          addObstacle(x, z, tree.r, tree);
          chunkTrees.push(tree);
        }
        for (let i = 0; i < 12; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < -0.5 || Math.hypot(x, z) < 14) continue;
          const s = 0.35 + Math.pow(rand(), 2) * 1.8;
          L.rock.push({ x, y: h + s * 0.15, z, sx: s * (1 + rand() * 0.6), sy: s * (0.55 + rand() * 0.4), sz: s * (1 + rand() * 0.5), rx: rand(), ry: rand() * 6, c: col('#9a978d', 0.05) });
          if (s > 0.6) addObstacle(x, z, s * 0.95);
        }
        // Loose stones small enough to pick up: the first tool there is.
        for (let i = 0; i < 9; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 0.9 || slopeAt(x, z) > 0.6) continue;
          const s = 0.15 + rand() * 0.08;
          chunkStones.push({ id: idOf('s', x, z), x, z, i: L.stone.length, taken: false });
          L.stone.push({ x, y: h + s * 0.45, z, sx: s * 1.25, sy: s * 0.8, sz: s, rx: rand(), ry: rand() * 6, c: col('#a9a59a', 0.06) });
        }
        for (let i = 0; i < 25; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.6 || slopeAt(x, z) > 0.6) continue;
          const s = 0.45 + rand() * 0.55;
          L.bush.push({ x, y: h + s * 0.35, z, sx: s * 1.2, sy: s * 0.85, sz: s * 1.2, ry: rand() * 6, c: col('#4f8a3a', 0.08) });
        }
        for (let i = 0; i < 100; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.5 || slopeAt(x, z) > 0.5 || flowerPatch(x * 0.03, z * 0.03) < 0.15) continue;
          L.flower.push({ x, y: h + 0.22, z, sx: 1, sy: 1, sz: 1, ry: rand() * 6, c: col(petals[Math.floor(rand() * petals.length)], 0.04) });
        }
        for (let i = 0; i < 340; i++) {
          const at = pick(); if (!at) continue;
          const [x, z] = at;
          const h = groundAt(x, z);
          if (h < 1.4 || slopeAt(x, z) > 0.55) continue;
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
      const d = Math.hypot(c.x - me.x, c.z - me.z);
      const far = d < 520, near = d < 170;
      for (const m of c.far) m.visible = far;
      for (const m of c.near) m.visible = near;
    }
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
    stone.visible = log.visible = axe.visible = false;
    return { root, body, legL, legR, armL, armR, stone, log, axe, held: null, phase: 0, swing: 0 };
  }

  function setHeld(ch, item) {
    ch.held = item || null;
    ch.stone.visible = item === 'stone';
    ch.log.visible = item === 'log';
    ch.axe.visible = item === 'axe';
  }

  function animateCharacter(ch, anim, dt) {
    const k = 1 - Math.exp(-dt * 12);
    let leg = 0, arm = 0, armOut = 0.08, bob = 0, armR = null;
    if (anim === 'chop') {
      // The stone comes down hard and goes back up slowly.
      ch.swing += dt * 1.6;
      const t = ch.swing % 1;
      armR = t < 0.7 ? -0.6 - (t / 0.7) * 2.1 : -2.7 + ((t - 0.7) / 0.3) * 2.1;
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
    const kr = anim === 'chop' ? 1 - Math.exp(-dt * 30) : k;
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
        '<div class="hv-spacer"></div>' +
        '<button type="button" class="hv-chip hv-leave"></button>' +
      '</div>' +
      '<div class="hv-people"></div>' +
      '<div class="hv-craft"></div>' +
      '<div class="hv-toasts"></div>' +
      '<div class="hv-hint"></div>' +
      '<div class="hv-stick"><div class="hv-knob"></div></div>' +
      '<button type="button" class="hv-jump">⤒</button>' +
      '<div class="hv-prompt"><div class="hv-prompt-text"></div><div class="hv-bar"><i></i></div></div>' +
      '<div class="hv-inv"><button type="button" class="hv-slot hv-hand"></button><div class="hv-pack"></div></div>' +
      '<div class="hv-acts">' +
        '<button type="button" class="hv-act" data-act="pick">✋</button>' +
        '<button type="button" class="hv-act" data-act="chop">🪓</button>' +
        '<button type="button" class="hv-act" data-act="drop">⬇</button>' +
        '<button type="button" class="hv-act" data-act="pull">🪢</button>' +
      '</div>' +
      '<div class="hv-loading"><div class="hv-spin"></div><div class="hv-loading-text"></div></div>';
    ui = {
      stage: app.querySelector('.hv-stage'),
      name: app.querySelector('.hv-name'),
      count: app.querySelector('.hv-count'),
      peopleBtn: app.querySelector('.hv-people-btn'),
      people: app.querySelector('.hv-people'),
      leave: app.querySelector('.hv-leave'),
      toasts: app.querySelector('.hv-toasts'),
      hint: app.querySelector('.hv-hint'),
      stick: app.querySelector('.hv-stick'),
      knob: app.querySelector('.hv-knob'),
      jump: app.querySelector('.hv-jump'),
      loading: app.querySelector('.hv-loading'),
      loadingText: app.querySelector('.hv-loading-text'),
      prompt: app.querySelector('.hv-prompt'),
      promptText: app.querySelector('.hv-prompt-text'),
      bar: app.querySelector('.hv-bar'),
      barFill: app.querySelector('.hv-bar i'),
      hand: app.querySelector('.hv-hand'),
      pack: app.querySelector('.hv-pack'),
      acts: app.querySelector('.hv-acts'),
      craftBtn: app.querySelector('.hv-craft-btn'),
      craft: app.querySelector('.hv-craft'),
    };
    app.querySelector('.hv-craft-label').textContent = tr('hv_craft');
    ui.craftBtn.title = tr('hv_craft');
    ui.craftBtn.onclick = () => { if (placing) stopPlacing(); else toggleCraft(); };
    ui.hand.title = tr('hv_hands');
    ui.hand.onclick = () => mp.send({ type: 'hv_hold', slot: 'stash' });
    ui.pack.title = tr('hv_backpack');
    renderInv();
    ui.name.textContent = tr('hv_title');
    ui.leave.textContent = tr('hv_leave');
    ui.loadingText.textContent = tr('hv_loading');
    ui.hint.textContent = tr(isTouch() ? 'hv_controls_touch' : 'hv_controls_desktop');
    app.classList.toggle('hv-touch', isTouch());
    ui.peopleBtn.onclick = () => { ui.people.classList.toggle('open'); toggleCraft(false); renderPeople(); };
    ui.leave.onclick = () => {
      ui.leave.disabled = true;
      mp.send({ type: 'hv_exit' });
      setTimeout(() => { location.href = HUB_URL; }, 1500);
    };
    renderPeople();
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

  const ICON = { stone: '🪨', log: '🪵', axe: '🪓', sled: '🛷' };

  // An item's icon, with a bar for how worn a tool is.
  function fillSlot(el, it) {
    const k = kindOf(it);
    el.textContent = ICON[k] || '';
    el.classList.toggle('empty', !k);
    el.title = k ? tr('hv_name_' + k) : '';
    if (it && typeof it === 'object' && T && T.axe_life) {
      const left = Math.max(0, it.w / T.axe_life);
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
      b.onclick = () => mp.send({ type: 'hv_hold', slot: i });
      ui.pack.appendChild(b);
    }
    inv.pack.forEach((it, i) => {
      const b = ui.pack.children[i];
      fillSlot(b, it);
      b.dataset.key = String((i + 1) % 10);
    });
    if (ui.craft.classList.contains('open')) renderCraft();
  }

  // ── crafting ─────────────────────────────────────────────────────────────
  // A log counts while it is carried in the hands, a stone in the hands or
  // in the backpack — the same rule the server applies.
  function carried(k) {
    if (k === 'log') return kindOf(inv.hand) === 'log' ? 1 : 0;
    return inv.pack.filter(x => kindOf(x) === k).length + (kindOf(inv.hand) === k ? 1 : 0);
  }

  function toggleCraft(force) {
    const open = force == null ? !ui.craft.classList.contains('open') : force;
    ui.craft.classList.toggle('open', open);
    ui.craftBtn.classList.toggle('on', open);
    if (open) { ui.people.classList.remove('open'); renderCraft(); }
  }

  function renderCraft() {
    ui.craft.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'hv-people-title';
    h.textContent = tr('hv_recipes');
    ui.craft.appendChild(h);
    Object.entries((T && T.recipes) || {}).forEach(([name, needs]) => {
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
      let ok = true;
      Object.entries(needs).forEach(([k, n]) => {
        const have = carried(k);
        if (have < n) ok = false;
        const sp = document.createElement('span');
        sp.className = have >= n ? 'ok' : 'no';
        sp.textContent = (ICON[k] || '') + ' ' + tr('hv_name_' + k) + ' ' + Math.min(have, n) + '/' + n;
        parts.appendChild(sp);
      });
      mid.append(title, parts);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hv-make';
      btn.textContent = tr('hv_make');
      btn.disabled = !ok;
      btn.onclick = () => mp.send({ type: 'hv_craft', item: name });
      row.append(icon, mid, btn);
      ui.craft.appendChild(row);
    });
    // Things built on the ground: their frame is placed first and the
    // materials are brought to it.
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
        const sp = document.createElement('span');
        sp.textContent = (ICON[k] || '') + ' ' + tr('hv_name_' + k) + ' ×' + n;
        parts.appendChild(sp);
      });
      const where = document.createElement('span');
      where.textContent = tr('hv_build_note');
      parts.appendChild(where);
      mid.append(title, parts);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hv-make';
      btn.textContent = tr('hv_place');
      btn.onclick = () => startPlacing(name);
      row.append(icon, mid, btn);
      ui.craft.appendChild(row);
    });
    const note = document.createElement('div');
    note.className = 'hv-people-empty';
    note.textContent = tr('hv_craft_note');
    ui.craft.appendChild(note);
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
  function bindInput(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      keys.add(e.code);
      if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
      if (!e.repeat && booted) {
        if (placing && (e.code === 'KeyE' || e.code === 'Enter')) confirmPlacing();
        else if (placing && e.code === 'Escape') stopPlacing();
        else if (e.code === 'KeyE') doPick();
        else if (e.code === 'KeyT') doPull();
        else if (e.code === 'KeyF') startChop();
        else if (e.code === 'KeyG') doDrop();
        else if (e.code === 'KeyR') mp.send({ type: 'hv_hold', slot: 'stash' });
        else if (e.code === 'KeyC') toggleCraft();
        else if (/^Digit[0-9]$/.test(e.code)) mp.send({ type: 'hv_hold', slot: (Number(e.code.slice(5)) + 9) % 10 });
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyF') chopHeld = false; });
    window.addEventListener('blur', () => { keys.clear(); chopHeld = false; });

    // Looking around: drag anywhere on the scene, mouse or finger.
    const drags = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = drags.get(e.pointerId);
      if (!d) return;
      cam.yaw -= (e.clientX - d.x) * 0.006;
      cam.pitch = Math.max(0.08, Math.min(1.25, cam.pitch + (e.clientY - d.y) * 0.004));
      d.x = e.clientX; d.y = e.clientY;
    });
    const end = (e) => drags.delete(e.pointerId);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.max(3.2, Math.min(18, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Touch: a stick for walking and a button for jumping.
    const R = 48;
    const moveStick = (e) => {
      const r = ui.stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      ui.knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      stick.x = dx / R; stick.y = -dy / R;
    };
    ui.stick.addEventListener('pointerdown', (e) => {
      stick.active = true; stick.id = e.pointerId;
      ui.stick.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    ui.stick.addEventListener('pointermove', (e) => { if (stick.active && e.pointerId === stick.id) moveStick(e); });
    const stickEnd = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.active = false; stick.x = 0; stick.y = 0;
      ui.knob.style.transform = '';
    };
    ui.stick.addEventListener('pointerup', stickEnd);
    ui.stick.addEventListener('pointercancel', stickEnd);
    ui.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; });
    ui.acts.querySelectorAll('.hv-act').forEach(b => {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (act === 'pick') { if (placing) confirmPlacing(); else doPick(); }
        else if (act === 'pull') doPull();
        else if (act === 'drop') doDrop();
        else { b.setPointerCapture(e.pointerId); startChop(); }
      });
      if (act === 'chop') {
        const stop = () => { chopHeld = false; };
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointercancel', stop);
      }
    });
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
      const d = footDist(b.data, fx, fz);
      if (d < bd) { build = b; bd = d; }
    });
    target.build = build;
  }

  // How far (x, z) is from the footprint of a frame or a sled.
  function footDist(d, x, z) {
    const dx = x - d.x, dz = z - d.z, c = Math.cos(d.ry), s = Math.sin(d.ry);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - SLED_W / 2), Math.max(0, Math.abs(lz) - SLED_L / 2));
  }

  const myPull = () => { for (const b of builds.values()) if (b.data.by === welcome.you.id) return b; return null; };

  function renderPrompt() {
    const lines = [];
    if (placing) return showPrompt([
      (isTouch() ? '✋ · ' : 'E · ') + tr('hv_act_place'),
      (isTouch() ? '🔨 · ' : 'Esc · ') + tr('hv_act_cancel'),
    ], null);
    const b = target.build, hk0 = kindOf(inv.hand), pulled = myPull();
    if (b) {
      const d = b.data;
      if (d.kind === 'site') {
        const need = T.builds[d.make] || {};
        Object.entries(need).forEach(([k, n]) => lines.push(
          (ICON[d.make] || '') + ' ' + tr('hv_frame', { item: tr('hv_name_' + d.make) }) + ' · ' + (ICON[k] || '') + ' ' + (d.have[k] || 0) + '/' + n));
        const add = Object.keys(need).find(k => (d.have[k] || 0) < need[k] && (hk0 === k || (!hk0 && inv.pack.includes(k))));
        if (add) lines.push('G · ' + tr('hv_act_add', { item: tr('hv_name_' + add) }));
        const back = Object.keys(d.have).find(k => d.have[k] > 0);
        lines.push('E · ' + (back ? tr('hv_act_take_back', { item: tr('hv_name_' + back) }) : tr('hv_act_remove_frame')));
      } else {
        const nm = tr('hv_name_' + d.kind);
        lines.push((ICON[d.kind] || '') + ' ' + nm.charAt(0).toUpperCase() + nm.slice(1) + ' · ' + d.load.length + '/' + T.sled_cap);
        const load = hk0 && hk0 !== 'axe' ? hk0 : (!hk0 && inv.pack.includes('stone') ? 'stone' : null);
        if (load && d.load.length < T.sled_cap) lines.push('G · ' + tr('hv_act_load', { item: tr('hv_name_' + load) }));
        if (d.load.length) lines.push('E · ' + tr('hv_act_unload', { item: tr('hv_name_' + d.load[d.load.length - 1]) }));
        if (!pulled) lines.push('T · ' + tr('hv_act_pull'));
      }
    }
    if (pulled) lines.push('T · ' + tr('hv_act_let_go'));
    if (b) return showPrompt(lines, null);
    const pk = target.pick;
    if (pk && pk.stone) lines.push('E · ' + tr('hv_act_pick', { item: tr('hv_name_stone') }));
    else if (pk && pk.pile) lines.push('E · ' + tr('hv_act_take', { item: tr('hv_name_' + pk.pile.data.kind), n: pk.pile.data.n }));
    const t = target.tree;
    let prog = null;
    if (t) {
      lines.push('🌲 ' + tr('hv_tree_wood', { n: t.logs }));
      lines.push(isTool(inv.hand) || (!inv.hand && packTool() >= 0) ? 'F · ' + tr('hv_act_chop') : tr('hv_act_need_stone'));
      const cp = chopProg.get(t.id);
      if (cp) prog = cp.p;
    }
    const hk = kindOf(inv.hand);
    if (hk && hk !== 'axe') lines.push('G · ' + tr('hv_act_drop', { item: tr('hv_name_' + hk) }));
    if ((hk === 'stone' || hk === 'axe') && inv.pack.includes(null)) lines.push('R · ' + tr('hv_act_stash'));
    showPrompt(lines, prog);
  }

  function showPrompt(lines, prog) {
    const text = isTouch() ? lines.map(l => l.replace(/^[A-Z] · /, '')).join('\n') : lines.join('\n');
    if (ui.promptText.textContent !== text) ui.promptText.textContent = text;
    ui.prompt.classList.toggle('show', lines.length > 0);
    ui.bar.style.display = prog == null ? 'none' : '';
    if (prog != null) ui.barFill.style.width = (prog * 100).toFixed(1) + '%';
  }

  function doPick() {
    if (target.build) return mp.send({ type: 'hv_pick', build: target.build.data.id });
    const pk = target.pick;
    if (!pk) return;
    if (pk.stone) mp.send({ type: 'hv_pick', stone: pk.stone.id });
    else mp.send({ type: 'hv_pick', pile: pk.pile.data.id });
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

  function doDrop() {
    if (target.build) return mp.send({ type: 'hv_drop', build: target.build.data.id });
    if (kindOf(inv.hand) === 'axe') { toast(tr('hv_keep_tool')); return; }
    if (!inv.hand && !inv.pack.includes('stone')) return;
    mp.send({ type: 'hv_drop', x: me.x + Math.sin(me.ry) * 1.1, z: me.z + Math.cos(me.ry) * 1.1 });
  }

  function startChop() {
    chopHeld = true;
    // With empty hands the best tool in the backpack comes out by itself.
    if (target.tree && !inv.hand && packTool() >= 0) mp.send({ type: 'hv_hold', slot: packTool() });
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
    };
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
    (w.felled || []).forEach(id => { const t = trees.get(id); if (t) fellTree(t, false); });
    (w.taken || []).forEach(takeStone);
    const keep = new Set((w.piles || []).map(p => p.id));
    [...piles.keys()].forEach(id => { if (!keep.has(id)) removePile(id); });
    (w.piles || []).forEach(showPile);
    const keepB = new Set((w.builds || []).map(b => b.id));
    [...builds.keys()].forEach(id => { if (!keepB.has(id)) removeBuild(id); });
    (w.builds || []).forEach(showBuild);
  }

  function setInv(next) {
    if (!next) return;
    inv = { hand: next.hand || null, pack: (next.pack || []).slice() };
    if (me) setHeld(me.ch, kindOf(inv.hand));
    renderInv();
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
        plane: new THREE.PlaneGeometry(SLED_W, SLED_L).rotateX(-Math.PI / 2),
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

  // The square on the ground where a frame stands, edged with thin boards.
  function frameMesh(g, fill) {
    const M = buildMat();
    const plane = new THREE.Mesh(M.plane, fill);
    plane.position.y = 0.04;
    g.add(plane);
    const t = 0.08, hw = SLED_W / 2, hl = SLED_L / 2;
    g.add(box(M.board, t, 0.06, SLED_L, -hw, 0.03, 0), box(M.board, t, 0.06, SLED_L, hw, 0.03, 0),
      box(M.board, SLED_W, 0.06, t, 0, 0.03, -hl), box(M.board, SLED_W, 0.06, t, 0, 0.03, hl));
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
    const logs = items.filter(k => k === 'log').length, rest = items.filter(k => k !== 'log');
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
  }

  function showBuild(data) {
    removeBuild(data.id);
    const g = new THREE.Group();
    if (data.kind === 'site') {
      frameMesh(g, buildMat().mark);
      // The logs brought so far lie side by side inside the frame.
      if (!pileGeo) showPileGeo();
      for (let i = 0; i < (data.have.log || 0); i++) {
        const o = new THREE.Mesh(pileGeo.log, pileGeo.logMat);
        o.rotation.x = Math.PI / 2;
        o.position.set(-0.44 + i * 0.22, 0.14, 0);
        o.castShadow = true;
        g.add(o);
      }
    } else {
      sledMesh(g);
      loadMesh(g, data.load || [], 0.3);
    }
    g.position.set(data.x, groundAt(data.x, data.z), data.z);
    g.rotation.y = data.ry;
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

  function doPull() {
    if (myPull()) return mp.send({ type: 'hv_pull' });
    const b = target.build;
    if (b && b.data.kind === 'sled') mp.send({ type: 'hv_pull', build: b.data.id });
  }

  // Placing a frame: a ghost of it follows the player until it is put down.
  function startPlacing(make) {
    stopPlacing();
    toggleCraft(false);
    const g = new THREE.Group();
    frameMesh(g, buildMat().ghost);
    scene.add(g);
    placing = { make, ghost: g, ok: true };
  }

  function stopPlacing() {
    if (!placing) return;
    scene.remove(placing.ghost);
    placing = null;
  }

  function placeSpot() {
    return { x: me.x + Math.sin(me.ry) * 2.2, z: me.z + Math.cos(me.ry) * 2.2, ry: me.ry };
  }

  function updatePlacing() {
    if (!placing) return;
    const p = placeSpot();
    let ok = groundAt(p.x, p.z) > 0.05;
    builds.forEach(b => { if (Math.hypot(b.data.x - p.x, b.data.z - p.z) < T.build_gap) ok = false; });
    placing.ok = ok;
    placing.ghost.position.set(p.x, groundAt(p.x, p.z), p.z);
    placing.ghost.rotation.y = p.ry;
    placing.ghost.children[0].material = ok ? buildMat().ghost : buildMat().bad;
  }

  function confirmPlacing() {
    if (!placing) return;
    if (!placing.ok) { toast(tr('hv_bad_spot')); return; }
    const p = placeSpot();
    mp.send({ type: 'hv_place', make: placing.make, x: p.x, z: p.z, ry: p.ry });
    stopPlacing();
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
    return [x, z];
  }

  function updateMe(dt) {
    let ix = 0, iy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    let mag = Math.hypot(ix, iy);
    if (mag > 0) { ix /= mag; iy /= mag; mag = 1; }
    // A log in the arms or a sled on the rope: walking only.
    const heavy = inv.hand === 'log' || !!myPull();
    let running = !(keys.has('ShiftLeft') || keys.has('ShiftRight')) && !heavy;
    if (stick.active && Math.hypot(stick.x, stick.y) > 0.12) {
      ix = stick.x; iy = stick.y; mag = Math.min(1, Math.hypot(ix, iy));
      running = mag > 0.7 && !heavy;
      ix /= Math.hypot(stick.x, stick.y); iy /= Math.hypot(stick.x, stick.y);
    }

    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
    const speed = mag > 0 ? (running ? T.run_speed : T.walk_speed) : 0;

    if (speed > 0) {
      let nx = me.x + mx * speed * dt, nz = me.z + mz * speed * dt;
      [nx, nz] = collide(nx, nz, 0.35);
      const lim = SIZE / 2 - 3;
      nx = Math.max(-lim, Math.min(lim, nx)); nz = Math.max(-lim, Math.min(lim, nz));
      // Wading is fine; swimming out to sea is not.
      if (groundAt(nx, nz) > -0.9) { me.x = nx; me.z = nz; }
      const want = Math.atan2(mx, mz);
      let d = want - me.ry;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      me.ry += d * (1 - Math.exp(-dt * 12));
    }

    const ground = groundAt(me.x, me.z);
    if (jumpQueued && me.grounded) { me.vy = 5.6; me.grounded = false; }
    jumpQueued = false;
    if (!me.grounded) {
      me.vy -= 16 * dt;
      me.y += me.vy * dt;
      if (me.y <= ground) { me.y = ground; me.vy = 0; me.grounded = true; }
    } else {
      me.y = ground;
    }
    const chopping = updateChop(dt, speed > 0 || !me.grounded);
    me.anim = !me.grounded ? 'jump' : chopping ? 'chop' : speed === 0 ? 'idle' : running ? 'run' : 'walk';

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

  function updateCamera(dt) {
    const tx = me.x, ty = me.y + 1.5, tz = me.z;
    const k = 1 - Math.exp(-dt * 10);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
    const cp = Math.cos(cam.pitch);
    let px = cam.x + Math.sin(cam.yaw) * cp * cam.dist;
    let pz = cam.z + Math.cos(cam.yaw) * cp * cam.dist;
    let py = cam.y + Math.sin(cam.pitch) * cam.dist;
    py = Math.max(py, groundAt(px, pz) + 0.6, 0.6);
    camera.position.set(px, py, pz);
    camera.lookAt(cam.x, cam.y, cam.z);

    sun.position.set(me.x + 40, me.y + 70, me.z + 25);
    sun.target.position.set(me.x, me.y, me.z);
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
    buildTerrain(makeHeightFn(welcome.seed));
    buildWater();
    ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    buildNature();
    buildClouds(rand);

    me = { ch: makeCharacter(welcome.you.color), x: 0, y: 0, z: 0, ry: 0, vy: 0, anim: 'idle', grounded: true };
    scene.add(me.ch.root);
    placeMe();
    resetPeers(welcome.peers);
    applyWorld(welcome.world);
    setInv(welcome.inv);
    updateChunks();
    cam.x = me.x; cam.y = me.y + 1.5; cam.z = me.z;
    cam.yaw = me.ry + Math.PI;

    bindInput(renderer.domElement);
    new ResizeObserver(fit).observe(ui.stage);
    fit();

    booted = true; booting = false;
    ui.loading.classList.add('done');
    setTimeout(() => ui.hint.classList.add('fade'), 9000);
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
    me.y = groundAt(me.x, me.z);
    lastSent = null;
  }

  // A reconnect sends the welcome again: the world is already built, only
  // the people in it may have changed.
  function syncFromWelcome() {
    resetPeers(welcome.peers);
    applyWorld(welcome.world);
    setInv(welcome.inv);
    chopTree = null;
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
    updateCamera(dt);
    updateFalling(dt);
    updateBuilds(dt);
    updatePlacing();
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
    if (m.pile) showPile(m.pile);
    if (m.by === welcome.you.id) { chopTree = null; toast(tr('hv_tree_felled')); }
  });
  mp.on('hv_stone_taken', (m) => { if (booted) takeStone(m.id); });
  mp.on('hv_pile', (m) => { if (booted && m.pile) showPile(m.pile); });
  mp.on('hv_pile_gone', (m) => { if (booted) removePile(m.id); });
  mp.on('hv_made', (m) => toast(tr('hv_made', { item: tr('hv_name_' + m.item) })));
  mp.on('hv_broke', (m) => { chopTree = null; toast(tr('hv_broke', { item: tr('hv_name_' + m.item) })); });
  mp.on('hv_build', (m) => {
    if (!booted || !m.build) return;
    // The sled being pulled keeps the place this client has drawn it at.
    const old = builds.get(m.build.id);
    if (old && old.data.by && m.build.by === old.data.by) { m.build.x = old.data.x; m.build.z = old.data.z; m.build.ry = old.data.ry; }
    showBuild(m.build);
  });
  mp.on('hv_build_gone', (m) => { if (booted) removeBuild(m.id); });
  const NOPE = {
    far: 'hv_too_far', full: 'hv_pack_full', hands_full: 'hv_hands_full', too_big: 'hv_log_too_big',
    need_stone: 'hv_need_stone', missing: 'hv_missing', keep_tool: 'hv_keep_tool',
    sled_full: 'hv_sled_full', crowded: 'hv_crowded', not_needed: 'hv_not_needed', taken: 'hv_taken',
  };
  mp.on('hv_nope', (m) => {
    if (m.reason === 'far' || m.reason === 'need_stone') chopTree = null;
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
