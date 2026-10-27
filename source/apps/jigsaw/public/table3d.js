/*
 * Jigsaw — the 3D table.
 *
 * A wooden table with a board on it and every piece of the puzzle lying about
 * as a real, thick piece of cardboard: cut out of the picture by a seed (so
 * every player of a room has the very same pieces), with tabs and blanks that
 * fit only their true neighbours. The camera looks down at the table at an
 * angle; the table is bigger than the screen, so you move over it the way you
 * would over a big real puzzle: drag the empty table to pan, pinch or use the
 * wheel to zoom. Pick a piece up and it lifts and casts a shadow; let it go
 * close to its slot and it clicks into the board.
 *
 * The browser only draws and reports. Whether a piece counts is decided by the
 * server; a piece is locked here at once and unlocked again if the server
 * disagrees.
 *
 * Loaded on demand, and handed the three.js module by the caller.
 *
 *   createTable(THREE, host, { cols, rows, seed, image, tol, ghost, tilt,
 *                              onGrab(i), onDrop(i, snapped), onSnap(i, dx, dy) })
 *     → { ready, setPlaced(str), lock(i, animate), unlock(i), flyHome(i, done), tidy(),
 *         scatter(), setTilt(on), fit(what), positions(), restore(list),
 *         project(i), pulse(i), celebrate(), setGhost(a), loose(), resize(), destroy() }
 *
 * Units: one piece of the board is one unit across. The board is centred on
 * the origin, x runs right, z runs down the picture.
 */

// ── Seeded random numbers: the same seed cuts the same pieces everywhere ────

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function rng(seed) {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The shape of an edge: a tab on one side, so a blank on the other ────────

const TAB = 0.1;          // the size of a tab
const JIT = 0.04;         // how much every tab differs from the next

function bezier(p0, p1, p2, p3, steps, out) {
  for (let s = 1; s <= steps; s++) {
    const t = s / steps, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

// The edge from (x0, y0) to (x1, y1), as points. `dir` is the side the tab
// grows to. The curve is three joined Béziers along the edge (l) and out of it (w).
function makeEdge(rand, x0, y0, x1, y1) {
  const dir = rand() < 0.5 ? -1 : 1;
  const j = () => (rand() * 2 - 1) * JIT;
  const a = j(), b = j(), c = j(), d = j(), e = j();
  const t = TAB * (0.92 + rand() * 0.16);
  const L = [
    [0, 0], [0.2, a], [0.5 + b + d, -t + c], [0.5 - t + b, t + c],
    [0.5 - 2 * t + b - d, 3 * t + c], [0.5 + 2 * t + b - d, 3 * t + c], [0.5 + t + b, t + c],
    [0.5 + b + d, -t + c], [0.8, e], [1, 0],
  ];
  const dx = x1 - x0, dy = y1 - y0;                 // along the edge; the length is 1
  const nx = -dy * dir, ny = dx * dir;              // out of it
  const P = L.map(([l, w]) => [x0 + dx * l + nx * w, y0 + dy * l + ny * w]);
  const pts = [P[0]];
  bezier(P[0], P[1], P[2], P[3], 6, pts);
  bezier(P[3], P[4], P[5], P[6], 8, pts);
  bezier(P[6], P[7], P[8], P[9], 6, pts);
  return pts;
}

const DEPTH = 0.07, BEV_T = 0.015, BEV_S = 0.012;    // together a piece is 0.1 thick

// The outlines of every piece, as points in board units (y down the picture).
function cutPieces(cols, rows, seed) {
  const rand = rng('cut:' + seed);
  const H = [], V = [];
  for (let r = 1; r < rows; r++) { H[r] = []; for (let c = 0; c < cols; c++) H[r][c] = makeEdge(rand, c, r, c + 1, r); }
  for (let r = 0; r < rows; r++) { V[r] = []; for (let c = 1; c < cols; c++) V[r][c] = makeEdge(rand, c, r, c, r + 1); }
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pts = [];
      const add = list => list.forEach((p, k) => { if (k > 0 || !pts.length) pts.push(p); });
      add(r === 0 ? [[c, r], [c + 1, r]] : H[r][c]);
      add(c === cols - 1 ? [[c + 1, r], [c + 1, r + 1]] : V[r][c + 1]);
      add(r === rows - 1 ? [[c + 1, r + 1], [c, r + 1]] : H[r + 1][c].slice().reverse());
      add(c === 0 ? [[c, r + 1], [c, r]] : V[r][c].slice().reverse());
      pts.pop();                                     // the last point is the first again
      out.push(pts);
    }
  }
  return out;
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// A wooden table top, drawn once on a canvas.
function woodTexture(THREE) {
  const S = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = rng('wood');
  g.fillStyle = '#8a5f3a';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 7; k++) {                       // boards
    const y = k * S / 7;
    const tone = 0.86 + r() * 0.28;
    g.fillStyle = 'rgba(' + Math.round(120 * tone) + ',' + Math.round(80 * tone) + ',' + Math.round(48 * tone) + ',0.55)';
    g.fillRect(0, y, S, S / 7);
    g.fillStyle = 'rgba(30,18,8,.55)';
    g.fillRect(0, y, S, 2);
  }
  for (let k = 0; k < 520; k++) {                     // grain
    const y = r() * S, amp = 1 + r() * 4, len = 120 + r() * 520, x0 = r() * S;
    g.strokeStyle = r() < 0.5 ? 'rgba(40,22,8,' + (0.06 + r() * 0.14) + ')' : 'rgba(255,225,180,' + (0.04 + r() * 0.08) + ')';
    g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath();
    for (let x = 0; x <= len; x += 12) {
      const yy = y + Math.sin((x0 + x) * 0.012 + k) * amp;
      if (x === 0) g.moveTo(x0 + x, yy); else g.lineTo(x0 + x, yy);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTable(THREE, host, o) {
  const cols = o.cols, rows = o.rows, N = cols * rows;
  const W = cols, Hh = rows;
  const TOL = o.tol || 0.5;
  const TILT_ON = 0.62, TILT_OFF = 0.03;
  const FOV = 34;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x1c130c, 1);
  const cv = renderer.domElement;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:grab';
  host.appendChild(cv);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1c130c, 55, 150);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 300);
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x7a5a3c, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-7, 16, 9);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffe2b8, 0.6);
  fill.position.set(8, 6, -6);
  scene.add(fill);

  // ── The table, the board and the picture's ghost ──────────────────────────
  const wood = woodTexture(THREE);
  wood.repeat.set(30, 30);
  wood.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const tableTop = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85, metalness: 0 }));
  tableTop.position.y = -0.06;
  scene.add(tableTop);

  // The frame is four strips, so the picture's ghost on the bed is not under a lid.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 0.7 });
  const FW = 0.75;
  [[W + 0.18, FW, 0, -(Hh + 0.18) / 2 - FW / 2], [W + 0.18, FW, 0, (Hh + 0.18) / 2 + FW / 2],
   [FW, Hh + 0.18 + 2 * FW, -(W + 0.18) / 2 - FW / 2, 0], [FW, Hh + 0.18 + 2 * FW, (W + 0.18) / 2 + FW / 2, 0]].forEach(([w, d, x, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), frameMat);
    m.position.set(x, -0.03, z);
    scene.add(m);
  });
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.18, 0.06, Hh + 0.18),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 }));
  bed.position.y = -0.03;
  scene.add(bed);

  let tex = null, ghost = null;
  const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: o.ghost || 0, depthWrite: false });
  ghost = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh).rotateX(-Math.PI / 2), ghostMat);
  ghost.position.y = 0.004;
  ghost.visible = false;
  scene.add(ghost);

  // ── The pieces ─────────────────────────────────────────────────────────────
  const capMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xd6c9ae, roughness: 0.8 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false, fog: false });
  const pieces = new Array(N);
  let outlines = null, zTop = 0;
  let building = null;

  const uvGen = {
    generateTopUV(geometry, vertices, a, b, c) {
      const u = i => new THREE.Vector2(vertices[i * 3] / W, 1 + vertices[i * 3 + 1] / Hh);
      return [u(a), u(b), u(c)];
    },
    generateSideWallUV() {
      const z = new THREE.Vector2(0, 0);
      return [z, z, z, z];
    },
  };

  function buildPiece(i) {
    const c = i % cols, r = Math.floor(i / cols);
    const pts = outlines[i];
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH, bevelEnabled: true, bevelThickness: BEV_T, bevelSize: BEV_S, bevelOffset: -BEV_S,
      bevelSegments: 2, steps: 1, curveSegments: 1, UVGenerator: uvGen,
    });
    g.translate(-(c + 0.5), r + 0.5, BEV_T);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, [capMat, sideMat]);
    const shadow = new THREE.Mesh(g, shadowMat);
    shadow.scale.y = 0.01;
    shadow.renderOrder = -1;
    scene.add(mesh);
    scene.add(shadow);
    const p = {
      i, c, r, mesh, shadow, poly: pts.map(q => [q[0] - (c + 0.5), q[1] - (r + 0.5)]),
      home: { x: c + 0.5 - W / 2, z: r + 0.5 - Hh / 2 },
      x: 0, z: 0, y: 0, lift: 0, rank: 0, locked: false, edge: c === 0 || r === 0 || c === cols - 1 || r === rows - 1,
      hidden: false, busy: false,
    };
    pieces[i] = p;
    return p;
  }

  function paintPiece(p) {
    p.mesh.position.set(p.x, p.y + p.lift, p.z);
    const k = 0.7 * p.lift;
    p.shadow.position.set(p.x + 0.05 + k * 0.5, p.lift > 0.02 ? 0.106 : 0.004, p.z + 0.07 + k * 0.7);
    p.shadow.visible = !p.locked && !p.hidden;
    p.mesh.visible = !p.hidden;
    dirty = true;
  }

  function topRank(p) {
    p.rank = ++zTop;
    if (zTop > 700) {                                // squeeze the stack so it never grows tall
      const list = pieces.filter(q => q && !q.locked).sort((a, b) => a.rank - b.rank);
      list.forEach((q, k) => { q.rank = k + 1; q.y = q.rank * 0.0012; paintPiece(q); });
      zTop = list.length;
    }
    p.y = p.rank * 0.0012;
  }

  // ── Where the loose pieces lie ─────────────────────────────────────────────
  let bounds = { x0: -W / 2 - 3, x1: W / 2 + 3, z0: -Hh / 2 - 3, z1: Hh / 2 + 3 };
  const growBounds = () => {
    let x0 = -W / 2 - 2.5, x1 = W / 2 + 2.5, z0 = -Hh / 2 - 2.5, z1 = Hh / 2 + 2.5;
    pieces.forEach(p => { if (p && !p.locked) { x0 = Math.min(x0, p.x - 2); x1 = Math.max(x1, p.x + 2); z0 = Math.min(z0, p.z - 2); z1 = Math.max(z1, p.z + 2); } });
    bounds = { x0, x1, z0, z1 };
    if (typeof updateDMax === 'function') updateDMax();
  };
  const clampPiece = p => {
    const m = 3;
    p.x = Math.max(bounds.x0 - m, Math.min(bounds.x1 + m, p.x));
    p.z = Math.max(bounds.z0 - m, Math.min(bounds.z1 + m, p.z));
  };

  let tidyNext = 'rows';
  function looseList() { return pieces.filter(p => p && !p.locked); }

  // Loose pieces lie in a ring around the board.
  function ringLayout(list, seed) {
    const r = rng('ring:' + seed);
    let m = 3;
    while ((W + 2 * m) * (Hh + 2 * m) - W * Hh < list.length * 3.4) m += 0.5;
    const x1 = W / 2 + m, z1 = Hh / 2 + m;
    const placed = [];
    const order = list.slice().sort(() => r() - 0.5);
    order.forEach(p => {
      let best = null, bestD = -1;
      for (let k = 0; k < 24; k++) {
        const x = (r() * 2 - 1) * x1, z = (r() * 2 - 1) * z1;
        if (Math.abs(x) < W / 2 + 1.2 && Math.abs(z) < Hh / 2 + 1.2) continue;
        let d = 1e9;
        for (let q = 0; q < placed.length; q++) { const dx = placed[q][0] - x, dz = placed[q][1] - z; d = Math.min(d, dx * dx + dz * dz); }
        if (d > bestD) { bestD = d; best = [x, z]; }
      }
      if (!best) best = [x1, z1];
      placed.push(best);
      p.x = best[0]; p.z = best[1];
    });
  }

  // Loose pieces lie in neat rows below the board, shuffled: nothing says which
  // piece is an edge or where it goes. On a phone this makes the table a page
  // to scroll.
  function rowsLayout(list, seed) {
    const r = rng('rows:' + seed + ':' + zTop);
    const sorted = list.slice().sort(() => r() - 0.5);
    const step = 1.55;
    // Rows as wide as the screen shows: the whole board's width on a computer, a phone's few pieces across.
    const per = W_ >= H_ ? Math.max(7, Math.floor((W + 4) / step)) : Math.max(5, Math.floor(Math.min(W + 2.4, 10.5) / step));
    const x0 = -(per - 1) * step / 2;
    const z0 = Hh / 2 + 2.4;
    sorted.forEach((p, k) => {
      p.x = x0 + (k % per) * step + (r() - 0.5) * 0.1;
      p.z = z0 + Math.floor(k / per) * step + (r() - 0.5) * 0.1;
    });
  }

  function arrange(kind, list) {
    if (kind === 'rows') rowsLayout(list, o.seed); else ringLayout(list, o.seed + ':' + zTop);
    list.forEach((p, k) => { topRank(p); p.lift = 0; paintPiece(p); });
    growBounds();
    dirty = true;
  }

  // ── The camera ─────────────────────────────────────────────────────────────
  let tx = 0, tz = 0, D = 30, tilt = o.tilt === false ? TILT_OFF : TILT_ON;
  let W_ = 1, H_ = 1;
  const tw = [];                                      // running animations
  let dirty = true, dead = false;

  function placeCamera() {
    camera.position.set(tx, D * Math.cos(tilt), tz + D * Math.sin(tilt));
    camera.up.set(0, 0, -1);
    camera.lookAt(tx, 0, tz);
    camera.updateMatrixWorld();
    dirty = true;
  }

  const tanH = Math.tan(FOV * Math.PI / 360);
  function distFor(w, h) {
    const asp = W_ / H_;
    return Math.max(w / (2 * tanH * asp), h * Math.cos(tilt) / (2 * tanH)) * 1.06;
  }
  const dMin = () => 4.5;
  let dMaxV = 40;
  const dMax = () => dMaxV;
  function clampCam() {
    D = Math.max(dMin(), Math.min(dMax() * 1.05, D));
    tx = Math.max(bounds.x0, Math.min(bounds.x1, tx));
    tz = Math.max(bounds.z0, Math.min(bounds.z1, tz));
  }

  // Where the camera must stand so that the rectangle (cx, cz, w, h) of the table fills the screen,
  // at tilt `tl`. The near side of a tilted table looks bigger than the far side, so this looks at
  // where the corners really land instead of guessing.
  function solveFit(cx, cz, w, h, tl) {
    const keep = { tx, tz, D, tilt };
    tilt = tl; tx = cx; tz = cz; D = distFor(w, h);
    const corners = [[cx - w / 2, cz - h / 2], [cx + w / 2, cz - h / 2], [cx - w / 2, cz + h / 2], [cx + w / 2, cz + h / 2]];
    for (let k = 0; k < 7; k++) {
      placeCamera();
      let minY = 9, maxY = -9, ex = 0;
      corners.forEach(([x, z]) => {
        tmp.set(x, 0, z).project(camera);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y); ex = Math.max(ex, Math.abs(tmp.x));
      });
      D *= Math.max(ex, maxY, -minY, 0.2) / 0.95;
      const mid = (minY + maxY) / 2;
      if (Math.abs(mid) > 0.02) {
        const w0 = worldAt(W_ / 2, H_ / 2), w1 = worldAt(W_ / 2, (1 - mid) / 2 * H_);
        if (w0 && w1) { tx += w1.x - w0.x; tz += w1.z - w0.z; }
      }
    }
    const out = { tx, tz, D };
    tx = keep.tx; tz = keep.tz; D = keep.D; tilt = keep.tilt;
    placeCamera();
    return out;
  }

  function updateDMax() {
    const r = solveFit((bounds.x0 + bounds.x1) / 2, (bounds.z0 + bounds.z1) / 2, bounds.x1 - bounds.x0 + 3, bounds.z1 - bounds.z0 + 3, tilt);
    dMaxV = Math.max(r.D, dMin() + 2);
  }

  function tween(dur, upd, done, ease) {
    const t = { t0: performance.now(), dur, upd, done, ease: ease || (p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2) };
    tw.push(t);
    dirty = true;
    return t;
  }

  function camTo(nx, nz, nd, ntilt, dur) {
    const a = { tx, tz, D, tilt };
    const b = { tx: nx, tz: nz, D: nd, tilt: ntilt == null ? tilt : ntilt };
    if (!dur) { tx = b.tx; tz = b.tz; D = b.D; tilt = b.tilt; clampCam(); placeCamera(); return; }
    tween(dur, p => {
      tx = a.tx + (b.tx - a.tx) * p; tz = a.tz + (b.tz - a.tz) * p;
      D = a.D + (b.D - a.D) * p; tilt = a.tilt + (b.tilt - a.tilt) * p;
      placeCamera();
    });
  }

  function fit(what, dur) {
    growBounds();
    const tl = tilt;
    const go = (cx, cz, w, h) => { const r = solveFit(cx, cz, w, h, tl); camTo(r.tx, r.tz, Math.min(r.D, dMax() * 1.05), null, dur); };
    if (what === 'all') {
      go((bounds.x0 + bounds.x1) / 2, (bounds.z0 + bounds.z1) / 2, bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
    } else if (what === 'pool') {
      const l = looseList();
      if (!l.length) return fit('board', dur);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, cx = 0, cz = 0;
      l.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); cx += p.x; cz += p.z; });
      cx /= l.length; cz /= l.length;
      // When the pieces lie around the board, "pieces" is the whole table.
      if (Math.abs(cx) < W * 0.2 && Math.abs(cz) < Hh * 0.2) return fit('all', dur);
      if (W_ >= H_) {
        go((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0 + 2.4, 8), z1 - z0 + 2.4);
      } else {
        // A phone shows a few pieces across and the first rows of the pool; the rest is a scroll away.
        const r = solveFit(0, 0, Math.min(W + 2.4, 10.5), 0.01, tl);
        camTo((x0 + x1) / 2, z0 - 1 + r.D * tanH / Math.cos(tl) * 0.9, r.D, null, dur);
      }
    } else if (what === 'start') {
      // The board near the top and the first rows of pieces below it: on a phone, the table is a page.
      const w = Math.min(W + 2.4, 10.5);
      const r = solveFit(0, 0, w, 0.01, tl);
      camTo(0, -Hh / 2 + r.D * tanH / Math.cos(tl) * 0.84, r.D, null, dur);
    } else {
      go(0, 0, W + 2.4, Hh + 2.4);
    }
  }

  // ── Looking and picking ────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
  const tmp = new THREE.Vector3();
  function worldAt(px, py) {
    ndc.set(px / W_ * 2 - 1, -(py / H_) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, tmp) ? { x: tmp.x, z: tmp.z } : null;
  }

  function pieceAt(w) {
    let best = null;
    for (let i = 0; i < N; i++) {
      const p = pieces[i];
      if (!p || p.locked || p.hidden || p.busy) continue;
      const dx = w.x - p.x, dz = w.z - p.z;
      if (dx > 0.85 || dx < -0.85 || dz > 0.85 || dz < -0.85) continue;
      if (inside(p.poly, dx, dz) && (!best || p.rank > best.rank)) best = p;
    }
    if (best) return best;
    let nd = 0.45 * 0.45;                              // a fingertip is not exact
    for (let i = 0; i < N; i++) {
      const p = pieces[i];
      if (!p || p.locked || p.hidden || p.busy) continue;
      const dx = w.x - p.x, dz = w.z - p.z, d = dx * dx + dz * dz;
      if (d < nd) { nd = d; best = p; }
    }
    return best;
  }

  const ptrs = new Map();
  let drag = null, pan = null, pinch = null, edgeSpeed = [0, 0];

  function local(ev) {
    const rc = cv.getBoundingClientRect();
    return { x: ev.clientX - rc.left, y: ev.clientY - rc.top };
  }

  function startDrag(p, w, id) {
    drag = { p, id, gx: p.x - w.x, gz: p.z - w.z };
    topRank(p);
    p.busy = false;
    const from = p.lift;
    tween(140, k => { p.lift = from + (0.5 - from) * k; paintPiece(p); });
    cv.style.cursor = 'grabbing';
    if (o.onGrab) o.onGrab(p.i);
  }

  function moveDrag(l) {
    const w = worldAt(l.x, l.y);
    if (!w || !drag) return;
    const p = drag.p;
    p.x = w.x + drag.gx; p.z = w.z + drag.gz;
    clampPiece(p);
    paintPiece(p);
    // At the edge of the screen the table scrolls, so a piece can be carried further than the view.
    const m = Math.min(56, Math.min(W_, H_) * 0.14);
    edgeSpeed = [l.x < m ? -(1 - l.x / m) : l.x > W_ - m ? (1 - (W_ - l.x) / m) : 0,
                 l.y < m ? -(1 - l.y / m) : l.y > H_ - m ? (1 - (H_ - l.y) / m) : 0];
    drag.last = l;
  }

  function endDrag() {
    const { p } = drag;
    drag = null; edgeSpeed = [0, 0];
    cv.style.cursor = 'grab';
    const dx = p.x - p.home.x, dz = p.z - p.home.z;
    if (Math.hypot(dx, dz) <= TOL) {
      if (o.onDrop) o.onDrop(p.i, true);
      lockPiece(p, true);
      if (o.onSnap) o.onSnap(p.i, dx, dz);
    } else {
      const from = p.lift;
      tween(160, k => { p.lift = from * (1 - k); paintPiece(p); });
      if (o.onDrop) o.onDrop(p.i, false);
    }
  }

  function lockPiece(p, animate) {
    p.locked = true;
    const a = { x: p.x, z: p.z, y: p.y, l: p.lift };
    if (!animate) {
      p.x = p.home.x; p.z = p.home.z; p.y = 0; p.lift = 0;
      paintPiece(p);
      return;
    }
    tween(170, k => {
      p.x = a.x + (p.home.x - a.x) * k; p.z = a.z + (p.home.z - a.z) * k;
      p.y = a.y * (1 - k); p.lift = a.l * (1 - k) + Math.sin(k * Math.PI) * 0.12;
      paintPiece(p);
    }, () => { p.lift = 0; paintPiece(p); });
  }

  function unlockPiece(i) {
    const p = pieces[i];
    if (!p || !p.locked) return;
    p.locked = false;
    topRank(p);
    p.lift = 0;
    paintPiece(p);
    growBounds();
  }

  // ── Pointers ───────────────────────────────────────────────────────────────
  function onDown(ev) {
    if (dead) return;
    cv.setPointerCapture && cv.setPointerCapture(ev.pointerId);
    const l = local(ev);
    ptrs.set(ev.pointerId, l);
    if (ptrs.size === 1) {
      const w = worldAt(l.x, l.y);
      if (!w) return;
      const p = ev.button === 0 || ev.pointerType !== 'mouse' ? pieceAt(w) : null;
      if (p) startDrag(p, w, ev.pointerId);
      else { pan = { id: ev.pointerId, ax: w.x, az: w.z }; cv.style.cursor = 'grabbing'; }
    } else if (ptrs.size === 2 && !drag) {
      pan = null;
      const [a, b] = [...ptrs.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, D0: D, anchor: worldAt(mid.x, mid.y) };
    }
    ev.preventDefault();
  }

  function onMove(ev) {
    const l = local(ev);
    if (!ptrs.has(ev.pointerId)) {
      if (ev.pointerType === 'mouse' && !dead && !drag) {
        const w = worldAt(l.x, l.y);
        cv.style.cursor = w && pieceAt(w) ? 'grab' : 'default';
      }
      return;
    }
    ptrs.set(ev.pointerId, l);
    if (drag && drag.id === ev.pointerId) moveDrag(l);
    else if (pan && pan.id === ev.pointerId) {
      const w = worldAt(l.x, l.y);
      if (w) { tx += pan.ax - w.x; tz += pan.az - w.z; clampCam(); placeCamera(); }
    } else if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      D = pinch.D0 * pinch.d0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
      D = Math.max(dMin(), Math.min(dMax() * 1.05, D));
      placeCamera();
      const w = worldAt(mid.x, mid.y);
      if (w && pinch.anchor) { tx += pinch.anchor.x - w.x; tz += pinch.anchor.z - w.z; clampCam(); placeCamera(); }
    }
    ev.preventDefault();
  }

  function onUp(ev) {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    if (drag && drag.id === ev.pointerId) endDrag();
    if (pan && pan.id === ev.pointerId) { pan = null; cv.style.cursor = 'grab'; }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1 && !drag) {                    // the second finger lifted: carry on panning with the first
      const [id, l] = [...ptrs.entries()][0];
      const w = worldAt(l.x, l.y);
      if (w) pan = { id, ax: w.x, az: w.z };
    }
  }

  function onWheel(ev) {
    ev.preventDefault();
    const l = local(ev);
    const before = worldAt(l.x, l.y);
    D *= Math.exp(Math.max(-60, Math.min(60, ev.deltaY)) * 0.0016);
    D = Math.max(dMin(), Math.min(dMax() * 1.05, D));
    placeCamera();
    const after = worldAt(l.x, l.y);
    if (before && after) { tx += before.x - after.x; tz += before.z - after.z; }
    clampCam(); placeCamera();
  }

  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ── The loop: draws only when something has changed ────────────────────────
  let raf = 0, lastT = performance.now();
  function frame(now) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    for (let k = tw.length - 1; k >= 0; k--) {
      const t = tw[k];
      const p = Math.min(1, (now - t.t0) / t.dur);
      t.upd(t.ease(Math.max(0, p)));
      if (p >= 1) { tw.splice(k, 1); if (t.done) t.done(); }
    }
    if (drag && (edgeSpeed[0] || edgeSpeed[1])) {
      const v = dt * D * 0.55;
      tx += edgeSpeed[0] * v; tz += edgeSpeed[1] * v;
      clampCam(); placeCamera();
      if (drag.last) moveDrag(drag.last);
    }
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
  }

  function resize() {
    const w = host.clientWidth || 300, h = host.clientHeight || 300;
    if (w === W_ && h === H_) return;
    W_ = w; H_ = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
    updateDMax();
  }

  // ── Building ───────────────────────────────────────────────────────────────
  const ready = (async () => {
    outlines = cutPieces(cols, rows, o.seed);
    tex = await new THREE.TextureLoader().loadAsync(o.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    capMat.map = tex; capMat.needsUpdate = true;
    ghostMat.map = tex; ghostMat.needsUpdate = true;
    ghost.visible = (o.ghost || 0) > 0;
    for (let i = 0; i < N; i++) {
      buildPiece(i);
      if (i % 24 === 23) {                              // let the page breathe while the pieces are cut
        if (o.onBuild) o.onBuild((i + 1) / N);
        await new Promise(r => setTimeout(r, 0));
        if (dead) return;
      }
    }
    resize();
    if (o.onBuild) o.onBuild(1);
  })();

  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host);
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);

  // ── What the game asks for ─────────────────────────────────────────────────
  function setPlaced(str) {
    for (let i = 0; i < N; i++) {
      const p = pieces[i];
      if (!p) continue;
      if (str[i] === '1' && !p.locked) lockPiece(p, false);
      else if (str[i] !== '1' && p.locked) unlockPiece(i);
    }
    growBounds();
  }

  function flyHome(i, done) {
    const p = pieces[i];
    if (!p || p.locked) { if (done) done(); return; }
    p.busy = true;
    if (drag && drag.p === p) { drag = null; }
    topRank(p);
    const a = { x: p.x, z: p.z, y: p.y };
    p.locked = true;
    tween(650, k => {
      p.x = a.x + (p.home.x - a.x) * k; p.z = a.z + (p.home.z - a.z) * k;
      p.y = a.y * (1 - k);
      p.lift = Math.sin(k * Math.PI) * 1.4;
      paintPiece(p);
    }, () => { p.lift = 0; p.busy = false; paintPiece(p); if (done) done(); });
    // Bring the slot into view if it is off screen.
    tmp.set(p.home.x, 0, p.home.z).project(camera);
    if (Math.abs(tmp.x) > 0.85 || Math.abs(tmp.y) > 0.85) camTo(p.home.x, p.home.z, Math.min(D, distFor(W * 0.6, W * 0.6 * H_ / W_)), null, 500);
  }

  function celebrate() {
    const list = pieces.filter(Boolean);
    list.forEach(p => {
      const delay = Math.hypot(p.home.x, p.home.z) * 55;
      setTimeout(() => {
        if (dead) return;
        tween(520, k => { p.lift = Math.sin(k * Math.PI) * 0.7; paintPiece(p); }, () => { p.lift = 0; paintPiece(p); });
      }, delay);
    });
    fit('board', 900);
  }

  return {
    ready,
    setPlaced,
    lock(i, animate) { const p = pieces[i]; if (p && !p.locked) lockPiece(p, animate !== false); },
    unlock: unlockPiece,
    flyHome,
    celebrate,
    resize,
    fit(what) { fit(what, 600); },
    // First arrangement, and "tidy", which alternates: shuffled rows below the
    // board, then all around the board as at the start, and so on.
    scatter(kind) { arrange(kind, looseList()); fit(kind === 'rows' ? 'start' : 'all'); },
    tidy() {
      const kind = tidyNext;
      tidyNext = kind === 'rows' ? 'ring' : 'rows';
      arrange(kind, looseList());
      fit(kind === 'rows' ? 'pool' : 'all', 600);
    },
    setTilt(on) { camTo(tx, tz, D, on ? TILT_ON : TILT_OFF, 500); },
    tilted() { return tilt > (TILT_ON + TILT_OFF) / 2; },
    setGhost(a) { ghostMat.opacity = a; ghost.visible = a > 0; dirty = true; },
    loose: () => looseList().length,
    positions() {
      return pieces.filter(p => p && !p.locked).map(p => [p.i, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100]);
    },
    restore(list) {
      (list || []).forEach(([i, x, z]) => {
        const p = pieces[i];
        if (p && !p.locked && isFinite(x) && isFinite(z)) { p.x = x; p.z = z; topRank(p); paintPiece(p); }
      });
      growBounds();
    },
    project(i) {
      const p = pieces[i];
      if (!p) return null;
      tmp.set(p.home.x, 0.1, p.home.z).project(camera);
      return { x: (tmp.x + 1) / 2 * W_, y: (1 - tmp.y) / 2 * H_ };
    },
    pulse(i) {
      const p = pieces[i];
      if (p) tween(420, k => { p.lift = Math.sin(k * Math.PI) * 0.25; paintPiece(p); }, () => { p.lift = 0; paintPiece(p); });
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      pieces.forEach(p => { if (p) p.mesh.geometry.dispose(); });
      [capMat, sideMat, shadowMat, ghostMat, tableTop.material, frameMat, bed.material].forEach(m => m.dispose());
      if (tex) tex.dispose();
      wood.dispose();
      renderer.dispose();
      cv.remove();
    },
  };
}
