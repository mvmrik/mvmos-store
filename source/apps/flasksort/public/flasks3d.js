/*
 * Flask Sort — the 3D view.
 *
 * Glass flasks with layered liquid, standing on shelves the way a lab
 * cupboard looks. All the flasks of a level are always in view: the
 * arrangement follows the shape of the screen, a phone held upright gets more
 * rows, a wide screen fewer, and the picture is scaled to fit.
 *
 * The liquid is not made of separate pieces that tilt with the glass. Every
 * layer is a full-length column of the inside of the flask, clipped between
 * two horizontal planes in the world; when a flask tips over to pour, its
 * liquid stays level the way real liquid does.
 *
 * Loaded on demand, and handed the three.js module by the caller.
 *
 *   createFlasks(THREE, host, { onPick(i) })
 *     → { setLevel(tubes, cap), setTubes(tubes), select(i), mark(i), pour(a, b, n, c, done),
 *         shake(i), celebrate(), busy(), tubeBusy(i), resize(), destroy() }
 *   tubes: array of arrays of colour indices, bottom first.
 */

export const PALETTE = [
  '#FFD400', '#4242FA', '#42DBFA', '#BD0505', '#F4BEF4', '#05BD61', '#323232', '#F5AD89', '#BD0580', '#787878',
  '#FFFFFF', '#899BF5', '#AAFF00', '#FF00FF', '#BD8005', '#42FADB', '#FF5500', '#F5899B', '#0580BD', '#E2F4BE',
];

let U = 0.62;                // height of one unit of liquid (flasks are lower when there are many)
let R = 0.36;                // inner radius
let RO = 0.405;              // outer radius of the glass
const HEAD = 0.05;           // the glass ends where the liquid does: a full flask is full to the top
const PITCH = 1.3;           // distance between flasks
const GAP_Y = 0.9;           // between shelves

export function createFlasks(THREE, host, o) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
  // A flask that is lifted or pouring is drawn in a second pass over the first,
  // with the same lights, so it is always in front of the shelves and the other
  // flasks, never hidden behind anything.
  const frontScene = new THREE.Scene();
  [scene, frontScene].forEach(sc => {
    sc.add(new THREE.HemisphereLight(0xffffff, 0x6a5f99, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-5, 10, 8);
    sc.add(sun);
    const rim = new THREE.DirectionalLight(0xb7a2ff, 0.7);
    rim.position.set(6, 4, -6);
    sc.add(rim);
  });
  renderer.autoClear = false;
  const turret = new THREE.Group();
  scene.add(turret);

  const col = PALETTE.map(h => new THREE.Color(h));

  // ── state ────────────────────────────────────────────────────────────────
  let cap = 4, L = cap * U + HEAD;
  let tubes = [];
  let decor = [];
  // With many flasks the shelves are drawn closer together.
  let pitch = PITCH, gapY = GAP_Y;
  let sel = -1;
  let alive = true;
  let pours = 0;
  const fx = [];
  const anims = [];

  // ── shared geometry / materials ──────────────────────────────────────────
  let fillGeo = null, glassGeo = null, hlGeo = null, hl2Geo = null, hitGeo = null, rimGeo = null, lidGeo = null;
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8ff, transparent: true, opacity: 0.17, roughness: 0.06, metalness: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const hl2Mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // The rim is plain glass, hardly more visible than the flask itself, and a
  // selected flask's only warms a little.
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a90b4, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
  const rimSelMat = new THREE.MeshStandardMaterial({ color: 0xb59d62, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.6, depthWrite: false });
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const streamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  function lathe(radius, top, bottomRound) {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = (k / 10) * Math.PI / 2;
      pts.push(new THREE.Vector2(radius * Math.sin(t), -radius * Math.cos(t)));
    }
    pts.push(new THREE.Vector2(radius, top));
    return new THREE.LatheGeometry(pts, 28);
  }

  // Many flasks are drawn lower and a little wider, so that three rows of them
  // fit a phone and the flasks are not thin.
  function applySizes(n) {
    if (n > 16) { U = 0.46; R = 0.45; RO = 0.495; pitch = 1.07; gapY = 0.5; }
    else if (n > 12) { U = 0.55; R = 0.4; RO = 0.445; pitch = 1.2; gapY = 0.55; }
    else { U = 0.62; R = 0.36; RO = 0.405; pitch = PITCH; gapY = GAP_Y; }
  }

  function buildShared() {
    [fillGeo, glassGeo, hlGeo, hl2Geo, hitGeo, rimGeo, lidGeo].forEach(g => g && g.dispose());
    L = cap * U + HEAD;
    fillGeo = lathe(R, L);
    glassGeo = lathe(RO, L);
    hlGeo = new THREE.CylinderGeometry(RO + 0.006, RO + 0.006, L * 0.72, 1, 1, true, -1.2, 0.24).translate(0, L * 0.42, 0);
    hl2Geo = new THREE.CylinderGeometry(RO + 0.006, RO + 0.006, L * 0.5, 1, 1, true, 0.95, 0.1).translate(0, L * 0.38, 0);
    hitGeo = new THREE.CylinderGeometry(Math.min(0.62, pitch * 0.5), Math.min(0.62, pitch * 0.5), L + RO + 0.2, 8).translate(0, (L - RO) / 2, 0);
    rimGeo = new THREE.TorusGeometry(RO, 0.022, 8, 28).rotateX(Math.PI / 2);
    lidGeo = new THREE.CylinderGeometry(RO * 0.97, RO * 1.03, 0.16, 24);
  }

  // ── a flask ──────────────────────────────────────────────────────────────
  function makeTube(i, pos, stack) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const t = {
      i, g, home: pos.clone(), stack: stack.slice(), units: [], lift: 0, liftT: 0,
      theta: 0, dir: new THREE.Vector2(1, 0), aTop: stack.length * U, busy: false, sealed: false,
      shake: 0, lid: null,
    };
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.renderOrder = 5;
    g.add(glass);
    t.hl = new THREE.Group();
    t.hl.renderOrder = 6;
    t.hl.children.forEach(m => { m.renderOrder = 6; });
    g.add(t.hl);
    t.rim = new THREE.Mesh(rimGeo, rimMat);
    t.rim.position.y = L;
    g.add(t.rim);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.userData.i = i;
    g.add(hit);
    t.hit = hit;
    t.discG = new THREE.Group();
    t.disc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ roughness: 0.25, side: THREE.DoubleSide }));
    t.discG.add(t.disc);
    t.discG.renderOrder = 2;
    turret.add(t.discG);
    t.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    t.shadow.position.set(pos.x, pos.y - RO + 0.015, pos.z);
    turret.add(t.shadow);
    turret.add(g);
    syncUnits(t);
    refresh(t);
    return t;
  }

  function newUnit(c) {
    const mat = new THREE.MeshStandardMaterial({ color: col[c % col.length], roughness: 0.28, metalness: 0.02, emissive: col[c % col.length], emissiveIntensity: 0.22, side: THREE.DoubleSide });
    const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4);
    const ph = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
    mat.clippingPlanes = [pl, ph];
    const mesh = new THREE.Mesh(fillGeo, mat);
    mesh.renderOrder = 1;
    return { mesh, mat, pl, ph, c };
  }

  // The unit meshes follow the stack; the flask owns them.
  function syncUnits(t, want) {
    const stack = want || t.stack;
    while (t.units.length > stack.length) {
      const u = t.units.pop();
      t.g.remove(u.mesh); u.mat.dispose();
    }
    for (let j = 0; j < stack.length; j++) {
      let u = t.units[j];
      if (!u || u.c !== stack[j]) {
        if (u) { t.g.remove(u.mesh); u.mat.dispose(); }
        u = t.units[j] = newUnit(stack[j]);
        t.g.add(u.mesh);
      }
    }
    t.aTop = stack.length * U;
    const sealed = t.stack.length === cap && t.stack.every(c => c === t.stack[0]);
    setSealed(t, sealed);
  }

  function setSealed(t, on) {
    if (on === t.sealed && (!on || t.lid)) return;
    t.sealed = on;
    if (on) {
      const c = col[t.stack[0] % col.length];
      const m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.8), roughness: 0.35, metalness: 0.35, emissive: c, emissiveIntensity: 0.35 });
      t.lid = new THREE.Mesh(lidGeo, m);
      t.lid.position.y = L + 0.06;
      t.lid.renderOrder = 3;
      t.g.add(t.lid);
      t.lidAnim = 0;
    } else if (t.lid) {
      t.g.remove(t.lid); t.lid.material.dispose(); t.lid = null;
    }
  }

  // Positions the clipping planes, the surface and the lid for the flask as it
  // is right now (at rest or tipped over).
  function refresh(t) {
    const cy = t.g.position.y, ct = Math.cos(t.theta);
    const top = Math.min(t.aTop, L - 0.01);
    t.units.forEach((u, j) => {
      const lo = j * U, hi = Math.min((j + 1) * U, top);
      u.pl.constant = j === 0 ? 1e4 : -(cy + lo * ct);
      u.ph.constant = hi > lo ? cy + hi * ct : -1e4;
    });
    const n = t.units.length;
    const show = n > 0 && t.theta < 1.05 && top > 0.02;
    t.discG.visible = show;
    if (show) {
      const st = Math.sin(t.theta);
      const P = t.g.position;
      t.discG.position.set(P.x + st * t.dir.x * top, P.y + ct * top, P.z + st * t.dir.y * top);
      t.discG.rotation.y = Math.atan2(-t.dir.y, t.dir.x);
      t.discG.scale.set(R * 0.985 / Math.max(ct, 0.4), 1, R * 0.985);
      const c = t.units[Math.min(n - 1, Math.max(0, Math.ceil(top / U) - 1))].c;
      t.disc.material.color.copy(col[c % col.length]).lerp(new THREE.Color(0xffffff), 0.18);
      t.disc.material.emissive.copy(col[c % col.length]);
      t.disc.material.emissiveIntensity = 0.25;
    }
    t.shadow.position.y = t.home.y - RO + 0.015;
    t.hl.rotation.y = -turret.rotation.y;
    t.rim.material = t.i === sel ? rimSelMat : rimMat;
  }

  // ── layouts ──────────────────────────────────────────────────────────────
  const Hf = () => L + RO;

  function shelfPositions(n, rows) {
    const per = Math.ceil(n / rows), out = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const cnt = Math.min(per, n - idx);
      const baseY = -r * (Hf() + gapY);
      for (let k = 0; k < cnt; k++) {
        out.push({ p: new THREE.Vector3((k - (cnt - 1) / 2) * pitch, baseY + RO, 0), row: r, cnt });
        idx++;
      }
    }
    return out;
  }

  // The smallest distance at which the camera sees all of `pts`, looking at
  // `target` from above by `el`. Bigger screens and a tidy layout give a
  // smaller distance, which is a bigger picture.
  const probe = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
  const tmp = new THREE.Vector3();
  function fitDistance(cam, pts, target, el, margin) {
    let lo = 2, hi = 400;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      cam.position.set(target.x, target.y + Math.sin(el) * d, target.z + Math.cos(el) * d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let ok = true;
      for (const p of pts) {
        tmp.copy(p).project(cam);
        if (Math.abs(tmp.x) > margin || Math.abs(tmp.y) > margin) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }

  function boxPoints(positions, lift) {
    const pts = [];
    positions.forEach(q => {
      const yb = q.y - RO, yt = q.y + L + (lift || 0);
      [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        pts.push(new THREE.Vector3(q.x + sx * RO, yb, q.z + sz * RO));
        pts.push(new THREE.Vector3(q.x + sx * RO, yt, q.z + sz * RO));
      }));
    });
    return pts;
  }

  let cam = { d: 20, target: new THREE.Vector3(), el: 0.12 };
  let slots = [];

  function planLayout(n, dry) {
    L = cap * U + HEAD;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    probe.aspect = w / h;
    probe.updateProjectionMatrix();
    let best = null;
    for (let rows = n > 16 ? 3 : 1; rows <= Math.min(n, 6); rows++) {
      const sl = shelfPositions(n, rows);
      const pos = sl.map(s => s.p);
      const pts = boxPoints(pos, 0.85);
      const minX = Math.min(...pos.map(p => p.x)) - 0.6, maxX = Math.max(...pos.map(p => p.x)) + 0.6;
      const y0 = -(rows - 1) * (Hf() + gapY) - 0.3;
      [minX, maxX].forEach(x => { pts.push(new THREE.Vector3(x, y0, 0.6)); });
      let target = new THREE.Vector3(0, y0 / 2 + (L + 0.85 - RO) / 2 - 0.1, 0);
      let d = fitDistance(probe, pts, target, 0.14, 0.97);
      // Then the picture is centred: whatever is left over is shared equally
      // between the top and the bottom.
      for (let k = 0; k < 3; k++) {
        probe.position.set(target.x, target.y + Math.sin(0.14) * d, target.z + Math.cos(0.14) * d);
        probe.lookAt(target);
        probe.updateMatrixWorld(true);
        let lo = 9, hi = -9;
        for (const q of pts) { tmp.copy(q).project(probe); lo = Math.min(lo, tmp.y); hi = Math.max(hi, tmp.y); }
        target = target.clone();
        target.y += ((hi + lo) / 2) * d * Math.tan(17 * Math.PI / 180);
        d = fitDistance(probe, pts, target, 0.14, 0.97);
      }
      if (!best || d < best.d - 1e-3) best = { d, rows, sl, target };
    }
    if (dry) return best.d;
    slots = best.sl;
    cam = { el: 0.14, target: best.target, d: best.d, rows: best.rows };
  }

  function placeCamera() {
    camera.position.set(cam.target.x, cam.target.y + Math.sin(cam.el) * cam.d, cam.target.z + Math.cos(cam.el) * cam.d);
    camera.lookAt(cam.target);
    camera.updateMatrixWorld(true);
  }

  function clearScene() {
    anims.length = 0;
    pours = 0;
    queue.length = 0;
    running = false;
    tubes.forEach(t => {
      t.units.forEach(u => u.mat.dispose());
      if (t.lid) t.lid.material.dispose();
      t.disc.material.dispose();
      [t.g, t.discG, t.shadow].forEach(o => { if (o.parent) o.parent.remove(o); });
    });
    tubes = [];
    decor.forEach(m => { turret.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); });
    decor = [];
    sel = -1;
  }

  function buildDecor() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2b6e, roughness: 0.55, metalness: 0.25, emissive: 0x1b1240, emissiveIntensity: 0.6 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x8e72ff, roughness: 0.4, emissive: 0x6a4cff, emissiveIntensity: 0.9 });
    {
      const rows = cam.rows || 1;
      for (let r = 0; r < rows; r++) {
        const row = slots.filter(s => s.row === r);
        const xs = row.map(s => s.p.x);
        const w = Math.max(...xs) - Math.min(...xs) + pitch + 0.5;
        const y = -r * (Hf() + gapY);
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
        const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 1.5), wood);
        board.position.set(cx, y - 0.1, 0.1);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.05), edge);
        lip.position.set(cx, y - 0.02, 0.86);
        turret.add(board, lip);
        decor.push(board, lip);
      }
    }
  }

  function setLevel(data, capIn) {
    clearScene();
    cap = capIn;
    applySizes(data.length);
    if (data.length > 12) {
      // With many flasks the picture is as wide as the screen allows, so the
      // flasks are made as tall as can be without making them any smaller:
      // the tallest height at which the whole thing still fits as wide.
      const lo0 = data.length > 16 ? 0.34 : 0.4;
      U = lo0;
      const d0 = planLayout(data.length, true);
      let lo = lo0, hi = 0.8;
      for (let it = 0; it < 8; it++) {
        const mid = (lo + hi) / 2;
        U = mid;
        if (planLayout(data.length, true) <= d0 * 1.015) lo = mid; else hi = mid;
      }
      U = lo;
    }
    buildShared();
    planLayout(data.length);
    buildDecor();
    placeCamera();
    data.forEach((stack, i) => {
      const t = makeTube(i, slots[i].p, stack);
      tubes.push(t);
      // They drop in one after another.
      t.g.position.y = t.home.y + 6;
      t.intro = -i * 0.035;
      refresh(t);
    });
    animate(0.75 + data.length * 0.035, () => {
      tubes.forEach(t => {
        if (t.intro == null) return;
        t.intro += tick.dt;
        const p = Math.max(0, Math.min(1, t.intro / 0.55));
        const e = bounce(p);
        t.g.position.y = t.home.y + (1 - e) * 6 + t.lift;
        if (p >= 1) { t.g.position.y = t.home.y + t.lift; t.intro = null; }
        refresh(t);
      });
    });
    invalidate();
  }

  function setTubes(data) {
    // Everything snaps to the given contents (undo, restart, a resync).
    anims.length = 0;
    pours = 0;
    queue.length = 0;
    running = false;
    fx.length = 0;
    tubes.forEach((t, i) => {
      t.busy = false; t.intro = null;
      if (t.front) setFront(t, false);
      t.theta = 0; t.g.quaternion.identity();
      t.g.position.copy(t.home);
      t.lift = 0; t.liftT = 0;
      t.stack = (data[i] || []).slice();
      syncUnits(t);
      refresh(t);
    });
    sel = -1;
    tubes.forEach(refresh);
    invalidate();
  }

  // Eases out and stops: things land, they do not hop.
  function bounce(p) {
    return 1 - Math.pow(1 - p, 3);
  }

  // A flask that is lifted or pouring is drawn last, so it is plainly in front
  // of the flasks and the shelf behind it, not seen through them.
  function setFront(t, on) {
    if (on) { frontScene.add(t.g); frontScene.add(t.discG); }
    else { turret.add(t.g); turret.add(t.discG); }
    t.front = on;
    invalidate();
  }

  // ── selecting ────────────────────────────────────────────────────────────
  function select(i) {
    sel = i;
    tubes.forEach(t => {
      t.liftT = t.i === i ? 0.55 : 0;
      t.rim.material = t.i === i ? rimSelMat : rimMat;
      if (!t.busy) setFront(t, t.i === i);
    });
    invalidate();
  }

  // A flask the hint points at gets the bright rim of a selected one, until the
  // next selection.
  function mark(i) {
    const t = tubes[i];
    if (t) { t.rim.material = rimSelMat; invalidate(); }
  }

  function shake(i) {
    const t = tubes[i];
    if (t && !t.busy) { t.shake = 0.4; invalidate(); }
  }

  // ── pouring ──────────────────────────────────────────────────────────────
  const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const tiltFor = s => Math.min(1.68, Math.atan2(L - s, R) + 0.1);

  // Pours wait in line: the player may already choose the next one while a
  // flask is still pouring, and it starts the moment the one before is done.
  const queue = [];
  let running = false;
  function pour(a, b, cnt, color, done) {
    pours++;
    queue.push({ a, b, cnt, color, done });
    nextPour();
  }
  function nextPour() {
    if (running || !queue.length) return;
    running = true;
    startPour(queue.shift());
  }

  function startPour(job) {
    const { a, b, cnt, color, done } = job;
    const A = tubes[a], B = tubes[b];
    if (!A || !B) { pours--; running = false; if (done) done(); nextPour(); return; }
    A.busy = B.busy = true;
    setFront(A, true); setFront(B, true);
    // The flask is already lifted by its selection; from here the pour moves it,
    // and when it comes back it must rest at once, not settle down from a lift.
    A.lift = 0; A.liftT = 0;
    if (sel === a) sel = -1;
    const k0 = A.stack.length, kd0 = B.stack.length;
    const d = new THREE.Vector2(B.home.x - A.home.x, B.home.z - A.home.z);
    if (d.lengthSq() < 1e-6) d.set(1, 0);
    // On shelves the flask tips toward the back as well as toward the target,
    // so its body swings out in front of the row instead of through the others.
    d.y -= 0.5 * Math.max(0.6, Math.abs(d.x));
    d.normalize();
    A.dir.copy(d); B.dir.copy(d);
    const target = B.stack.slice();
    for (let k = 0; k < cnt; k++) target.push(color);
    // The new layers exist from the start, empty until the liquid reaches them.
    syncUnits(B, target);
    B.aTop = kd0 * U;
    const T1 = 0.28, T2 = 0.14 + 0.32 * cnt, T3 = 0.26;
    const p0 = A.g.position.clone();
    const lip = new THREE.Vector3(B.home.x, B.home.y + L + 0.78, B.home.z);
    const stream = new THREE.Mesh(streamGeo, new THREE.MeshStandardMaterial({ color: col[color % col.length], emissive: col[color % col.length], emissiveIntensity: 0.35, roughness: 0.2 }));
    stream.visible = false;
    turret.add(stream);
    const axis = new THREE.Vector3(d.y, 0, -d.x);
    const place = (theta, from, p) => {
      const st = Math.sin(theta), ct = Math.cos(theta);
      const C = new THREE.Vector3(
        lip.x - L * st * d.x - R * ct * d.x,
        lip.y - L * ct + R * st,
        lip.z - L * st * d.y - R * ct * d.y);
      A.g.position.lerpVectors(from, C, p);
      return C;
    };
    const th0 = tiltFor(k0 * U), thEnd = tiltFor((k0 - cnt) * U);
    let t = 0;
    const total = T1 + T2 + T3;
    animate(total, () => {
      t += tick.dt;
      if (t < T1) {
        const p = ease(t / T1);
        A.theta = th0 * p;
        const C = new THREE.Vector3();
        // fly to the pose while tilting; the pose is for the angle reached
        const st = Math.sin(A.theta), ct = Math.cos(A.theta);
        C.set(lip.x - L * st * d.x - R * ct * d.x, lip.y - L * ct + R * st, lip.z - L * st * d.y - R * ct * d.y);
        A.g.position.lerpVectors(p0, C, p);
        A.aTop = k0 * U;
      } else if (t < T1 + T2) {
        const f = (t - T1) / T2, fl = f * f * (3 - 2 * f) * cnt;
        A.aTop = (k0 - fl) * U;
        A.theta = tiltFor(A.aTop);
        place(A.theta, A.g.position, 1);
        B.aTop = (kd0 + fl) * U;
        const C = A.g.position;
        const surf = B.home.y + B.aTop;
        stream.visible = true;
        const len = Math.max(0.05, lip.y - surf);
        const w = 0.05 + 0.012 * Math.sin(t * 40);
        stream.scale.set(w, len, w);
        stream.position.set(lip.x, lip.y - len / 2, lip.z);
        void C;
      } else {
        const p = ease(Math.min(1, (t - T1 - T2) / T3));
        stream.visible = false;
        A.aTop = (k0 - cnt) * U;
        B.aTop = (kd0 + cnt) * U;
        A.theta = thEnd * (1 - p);
        const st = Math.sin(A.theta), ct = Math.cos(A.theta);
        const C = new THREE.Vector3(lip.x - L * st * d.x - R * ct * d.x, lip.y - L * ct + R * st, lip.z - L * st * d.y - R * ct * d.y);
        A.g.position.lerpVectors(C, A.home, p);
      }
      A.g.quaternion.setFromAxisAngle(axis, A.theta);
      refresh(A); refresh(B);
    }, () => {
      turret.remove(stream);
      stream.material.dispose();
      A.theta = 0; A.g.quaternion.identity(); A.g.position.copy(A.home);
      A.stack.splice(A.stack.length - cnt, cnt);
      B.stack = target;
      syncUnits(A); syncUnits(B);
      refresh(A); refresh(B);
      A.busy = B.busy = false;
      setFront(A, sel === A.i); setFront(B, sel === B.i);
      // A flask chosen as the next source while it was busy goes back up.
      if (sel === A.i) A.liftT = 0.55;
      if (sel === B.i) B.liftT = 0.55;
      pours--;
      running = false;
      if (done) done();
      nextPour();
    });
  }

  // ── a little celebration ─────────────────────────────────────────────────
  function celebrate() {
    const n = 90, pos = new Float32Array(n * 3), cols = new Float32Array(n * 3), vel = [];
    const cx = 0, cy = cam.target.y + 1.5;
    for (let k = 0; k < n; k++) {
      pos[k * 3] = cx; pos[k * 3 + 1] = cy; pos[k * 3 + 2] = 1;
      const c = col[k % col.length];
      cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
      vel.push([Math.cos(a) * s * 1.3, Math.abs(Math.sin(a)) * s * 0.9 + 2, (Math.random() - 0.5) * 3]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({ size: 0.3, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    let t = 0;
    animate(1.7, () => {
      t += tick.dt;
      for (let k = 0; k < n; k++) {
        vel[k][1] -= 9 * tick.dt;
        pos[k * 3] += vel[k][0] * tick.dt; pos[k * 3 + 1] += vel[k][1] * tick.dt; pos[k * 3 + 2] += vel[k][2] * tick.dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - Math.max(0, t - 1.0) / 0.7);
    }, () => { scene.remove(pts); geo.dispose(); mat.dispose(); });
  }

  // ── camera / size ────────────────────────────────────────────────────────
  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (tubes.length) {
      const rows = cam.rows, was = pitch;
      planLayout(tubes.length);
      if (rows !== cam.rows || was !== pitch) {
        // The best arrangement changed with the shape of the screen.
        decor.forEach(m => { turret.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); });
        decor = [];
        buildDecor();
        tubes.forEach((t, i) => {
          t.home.copy(slots[i].p);
          t.g.position.copy(t.home).y += t.lift;
          t.shadow.position.set(t.home.x, t.home.y - RO + 0.015, t.home.z);
        });
      }
      tubes.forEach(refresh);
    }
    placeCamera();
    invalidate();
  }

  // ── input ────────────────────────────────────────────────────────────────
  const el = renderer.domElement;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let pointer = null;

  function pick(ev) {
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    scene.updateMatrixWorld(true);
    frontScene.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(tubes.map(t => t.hit), false);
    return hits.length ? hits[0].object.userData.i : -1;
  }
  el.addEventListener('pointerdown', ev => {
    el.setPointerCapture(ev.pointerId);
    pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 };
  });
  el.addEventListener('pointermove', ev => {
    if (!pointer || pointer.id !== ev.pointerId) return;
    pointer.moved += Math.abs(ev.clientX - pointer.x) + Math.abs(ev.clientY - pointer.y);
    pointer.x = ev.clientX; pointer.y = ev.clientY;
  });
  function up(ev) {
    if (!pointer || pointer.id !== ev.pointerId) return;
    if (ev.type === 'pointerup' && pointer.moved < 10 && performance.now() - pointer.t < 700) {
      const i = pick(ev);
      if (i >= 0 && o.onPick) o.onPick(i);
    }
    pointer = null;
    invalidate();
  }
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  // ── loop: runs only while something moves ────────────────────────────────
  let raf = 0, last = 0;
  function invalidate() { if (!raf && alive) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function animate(dur, fn, done) { anims.push({ t: 0, dur, fn, done }); invalidate(); }
  function tick(now) {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    tick.dt = dt;
    let busy = false;
    for (let k = 0; k < anims.length; k++) {
      const a = anims[k];
      a.t += dt;
      a.fn();
      if (a.t >= a.dur) { a.over = true; } else busy = true;
    }
    for (let k = anims.length - 1; k >= 0; k--) {
      if (anims[k].over) { const a = anims.splice(k, 1)[0]; if (a.done) a.done(); }
    }
    tubes.forEach(t => {
      if (t.busy || t.intro != null) return;
      let moved = false;
      if (Math.abs(t.liftT - t.lift) > 0.002) { t.lift += (t.liftT - t.lift) * Math.min(1, dt * 14); moved = true; }
      else if (t.lift !== t.liftT) { t.lift = t.liftT; moved = true; }
      if (t.shake > 0) {
        t.shake = Math.max(0, t.shake - dt);
        t.g.rotation.z = Math.sin(t.shake * 50) * 0.09 * (t.shake / 0.4);
        moved = true;
        if (t.shake === 0) t.g.rotation.z = 0;
      }
      if (t.lid && t.lidAnim != null) {
        t.lidAnim += dt;
        const p = Math.min(1, t.lidAnim / 0.35);
        t.lid.position.y = L + 0.06 + (1 - bounce(p)) * 0.9;
        moved = true;
        if (p >= 1) t.lidAnim = null;
      }
      if (moved) {
        // A lifted flask also comes a little toward the viewer on shelves.
        t.g.position.set(t.home.x, t.home.y + t.lift, t.home.z + t.lift * 0.7);
        refresh(t);
        busy = true;
      }
    });
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(frontScene, camera);
    if (busy || pointer) invalidate();
  }

  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host);
  resize();

  return {
    setLevel, setTubes, select, mark, pour, shake, celebrate, resize,
    busy: () => pours > 0,
    tubeBusy: i => !!(tubes[i] && (tubes[i].busy || tubes[i].intro != null)),
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      clearScene();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
