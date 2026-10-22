/*
 * Remember the Pairs — the 3D view.
 *
 * Every card sits on the surface of a cylinder that stands on a turntable, in
 * rings of the same size one above the other. The cylinder is sized to fill
 * the space it is given: all its rings are always in view from top to bottom,
 * so nothing ever scrolls up or down. Only the front of it is readable at a
 * time — the cards on the far side wait there until it is turned. Dragging
 * (or the wheel) turns it, a tap on a card turns that card over.
 *
 * How many rings, and how many cards in each, is decided by the game for the
 * size of the table and is the same on every device; the cylinder is only
 * scaled to fit whatever screen it is on.
 *
 * Loaded on demand, and handed the three.js module by the caller, so players
 * who use the flat table never download either.
 *
 *   createCylinder(THREE, host, { count, rings, perRing, faceCanvas(sym),
 *                                 backCanvas(), hue, onPick(i) })
 *     → { setCard(i, state, sym), flipUp(i, sym), flipDown(i), remove(i),
 *         focus(i), resize(), destroy() }
 */

const CW = 1, CH = 1.333, GAP = 0.17, PITCH = CW + GAP, ROW = CH + 0.15;
const EXTRA_H = 1.3;                   // lid on top, turntable underneath

export function createCylinder(THREE, host, o) {
  const N = o.count;
  const R = o.rings, perRing = o.perRing;          // the same on every device
  const counts = [];
  for (let k = 0; k < R; k++) counts.push(perRing);
  const rho = Math.max(1.2, perRing * PITCH / (2 * Math.PI));
  const ys = counts.map((_, k) => -k * ROW);
  const yTop = 0, yBottom = ys[R - 1];
  const Hworld = (R - 1) * ROW + CH + EXTRA_H;

  const place = [];
  for (let k = 0; k < R; k++) {
    for (let j = 0; j < counts[k]; j++) {
      place.push({ k, th: j / counts[k] * Math.PI * 2 + (k % 2 ? Math.PI / counts[k] : 0), y: ys[k] });
    }
  }

  // ── Scene ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d879c, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-4, 9, 7);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9db8ff, 0.55);
  rim.position.set(6, 3, -6);
  scene.add(rim);

  const turret = new THREE.Group();
  scene.add(turret);

  const hue = o.hue != null ? o.hue : 220;
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color('hsl(' + hue + ',45%,30%)'), roughness: 0.38, metalness: 0.55 });
  // Orientation: the rims and the top of the turntable run through all the
  // colours once around, the same way at the top and at the bottom. Turning
  // the cylinder turns the colours with it, so the colour in front says where
  // on the cylinder you are looking.
  function rainbow(geo) {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));            // the same angle the cards are placed at
      c.setHSL(((a / (2 * Math.PI)) + 1) % 1, 0.85, 0.55);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  const rainbowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // Turntable
  const baseR = rho + 0.55;
  const baseY = yBottom - CH / 2 - 0.3;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR + 0.18, 0.3, 64), metal);
  base.position.y = baseY;
  turret.add(base);
  const ringGeo = rainbow(new THREE.TorusGeometry(baseR + 0.01, 0.09, 12, 128).rotateX(Math.PI / 2));
  const ring = new THREE.Mesh(ringGeo, rainbowMat);
  ring.position.y = baseY + 0.16;
  turret.add(ring);
  // The top of the turntable, between the wall of cards and the edge.
  const deckGeo = rainbow(new THREE.RingGeometry(rho + 0.12, baseR - 0.02, 128, 1).rotateX(-Math.PI / 2));
  const deck = new THREE.Mesh(deckGeo, rainbowMat);
  deck.position.y = baseY + 0.152;
  turret.add(deck);
  // A cylinder under the cards, so the gaps between them are not see-through.
  const coreTop = yTop + CH / 2 + 0.1, coreBottom = yBottom - CH / 2 - 0.1;
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(rho - 0.16, rho - 0.16, coreTop - coreBottom, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('hsl(' + hue + ',40%,16%)'), roughness: 0.9, side: THREE.DoubleSide })
  );
  core.position.y = (coreTop + coreBottom) / 2;
  turret.add(core);
  // A lid on top, so the top ring has an edge to sit against.
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(rho + 0.12, rho + 0.12, 0.24, 64), metal);
  lid.position.y = coreTop + 0.08;
  turret.add(lid);
  const lidRing = new THREE.Mesh(rainbow(new THREE.TorusGeometry(rho + 0.12, 0.09, 12, 128).rotateX(Math.PI / 2)), rainbowMat);
  lidRing.position.y = coreTop + 0.2;
  turret.add(lidRing);

  // Soft shadow on the ground
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sg = sc.getContext('2d');
  const grad = sg.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(baseR * 3, baseR * 3), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = baseY - 0.2;
  scene.add(shadow);

  // ── Cards ────────────────────────────────────────────────────────────────
  const cardShape = (() => {
    const s = new THREE.Shape(), w = CW / 2, h = CH / 2, r = 0.15;
    s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r);
    s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h);
    s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
    return s;
  })();
  const bodyGeo = new THREE.ExtrudeGeometry(cardShape, { depth: 0.05, bevelEnabled: false });
  bodyGeo.translate(0, 0, -0.025);
  const planeGeo = new THREE.PlaneGeometry(CW, CH);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x20263a, roughness: 0.6 });
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const backTex = new THREE.CanvasTexture(o.backCanvas());
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.anisotropy = aniso;
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.5, metalness: 0.08, transparent: true, alphaTest: 0.4 });

  const faceTex = {}, faceMat = {};
  function faceMaterial(sym) {
    if (faceMat[sym]) return faceMat[sym];
    const tex = new THREE.CanvasTexture(o.faceCanvas(sym));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    faceTex[sym] = tex;
    return (faceMat[sym] = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.55, metalness: 0.02, transparent: true, alphaTest: 0.4,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22,
    }));
  }

  const cards = [];
  const bodies = [];
  for (let i = 0; i < N; i++) {
    const p = place[i];
    const root = new THREE.Group();
    root.position.set(Math.cos(p.th) * rho, p.y, Math.sin(p.th) * rho);
    root.rotation.y = Math.PI / 2 - p.th;      // +Z of the card points away from the axis
    const pivot = new THREE.Group();
    root.add(pivot);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.userData.i = i;
    pivot.add(body);
    const front = new THREE.Mesh(planeGeo, backMat);        // what is seen while face down
    front.position.z = 0.0265;
    pivot.add(front);
    const faceM = new THREE.Mesh(planeGeo, backMat);
    faceM.position.z = -0.0265; faceM.rotation.y = Math.PI;
    pivot.add(faceM);
    turret.add(root);
    bodies.push(body);
    cards.push({ root, pivot, faceM, state: 'down', sym: null, th: p.th, y: p.y });
  }

  // ── Animation ────────────────────────────────────────────────────────────
  const anims = [];
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function animate(dur, fn, done) { anims.push({ t: 0, dur, fn, done }); invalidate(); }

  function showFace(i, sym) {
    const c = cards[i];
    c.sym = sym;
    c.faceM.material = faceMaterial(sym);
  }

  function setCard(i, state, sym) {
    const c = cards[i];
    if (!c) return;
    c.state = state;
    if (sym != null) showFace(i, sym);
    c.root.visible = state !== 'gone';
    c.root.scale.setScalar(1);
    c.pivot.rotation.y = state === 'up' ? Math.PI : 0;
    c.pivot.position.z = 0;
    invalidate();
  }

  function flip(i, to) {
    const c = cards[i];
    if (!c) return;
    c.root.visible = true;
    const from = c.pivot.rotation.y;
    animate(0.5, p => {
      const e = ease(p);
      c.pivot.rotation.y = from + (to - from) * e;
      c.pivot.position.z = Math.sin(p * Math.PI) * 0.42;
    }, () => { c.pivot.rotation.y = to; c.pivot.position.z = 0; });
  }
  function flipUp(i, sym) {
    const c = cards[i];
    if (!c) return;
    showFace(i, sym);
    c.state = 'up';
    flip(i, Math.PI);
  }
  function flipDown(i) {
    const c = cards[i];
    if (!c) return;
    c.state = 'down';
    flip(i, 0);
  }
  function remove(i) {
    const c = cards[i];
    if (!c || c.state === 'gone') return;
    c.state = 'gone';
    animate(0.55, p => {
      const e = ease(p);
      c.root.scale.setScalar(1 - e);
      c.pivot.position.z = Math.sin(e * Math.PI) * 0.5;
      c.pivot.rotation.z = e * 0.8;
    }, () => { c.root.visible = false; c.pivot.rotation.z = 0; c.pivot.position.z = 0; });
  }

  // ── Camera: the whole height always fits; only the turn is free ──────────
  let yaw = 0, yawT = null, yawV = 0;
  let baseD = 12;
  const fov = camera.fov * Math.PI / 180;
  const centerY = (yTop + yBottom) / 2 - 0.15;

  function fit() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const aspect = w / h;
    // The front wall is the nearest part: its full height has to fit, and so
    // does the full width of the turntable at the widest point.
    const dH = baseR + (Hworld / 2) / Math.tan(fov / 2);
    const dW = (baseR + 0.25) / (Math.tan(fov / 2) * aspect) + 0.2;
    baseD = Math.max(dH, dW) * 1.02;
    invalidate();
  }

  function focus(i) {
    const c = cards[i];
    if (!c) return;
    // Turn the cylinder so the card's side faces the viewer.
    let target = c.th - Math.PI / 2;
    target = yaw + Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
    yawT = target; yawV = 0;
    invalidate();
  }

  // ── Input ────────────────────────────────────────────────────────────────
  const el = renderer.domElement;
  let pointer = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  function pick(ev) {
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(bodies.filter((b, k) => cards[k].root.visible), false);
    return hits.length ? hits[0].object.userData.i : -1;
  }
  el.addEventListener('pointerdown', ev => {
    el.setPointerCapture(ev.pointerId);
    pointer = { id: ev.pointerId, x: ev.clientX, t: performance.now(), moved: 0 };
    yawT = null; yawV = 0;
  });
  el.addEventListener('pointermove', ev => {
    if (!pointer || pointer.id !== ev.pointerId) return;
    const dx = ev.clientX - pointer.x;
    pointer.x = ev.clientX;
    pointer.moved += Math.abs(dx);
    const d = dx / Math.max(1, el.clientWidth) * 3.4;
    yaw += d; yawV = d;
    invalidate();
  });
  function up(ev) {
    if (!pointer || pointer.id !== ev.pointerId) return;
    if (ev.type === 'pointerup' && pointer.moved < 10 && performance.now() - pointer.t < 600) {
      const i = pick(ev);
      if (i >= 0 && o.onPick) o.onPick(i);
      yawV = 0;
    }
    pointer = null;
    invalidate();
  }
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', ev => {
    ev.preventDefault();
    yaw += (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * 0.004;
    yawT = null; invalidate();
  }, { passive: false });

  // ── Loop: runs only while something moves ────────────────────────────────
  let raf = 0, last = 0, alive = true;
  function invalidate() { if (!raf && alive) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(now) {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    let busy = false;
    for (let k = anims.length - 1; k >= 0; k--) {
      const a = anims[k];
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      a.fn(p);
      if (p >= 1) { anims.splice(k, 1); if (a.done) a.done(); } else busy = true;
    }
    if (yawT != null) {
      yaw += (yawT - yaw) * Math.min(1, dt * 6);
      if (Math.abs(yawT - yaw) < 0.002) { yaw = yawT; yawT = null; } else busy = true;
    }
    if (!pointer && Math.abs(yawV) > 0.0005) {
      yaw += yawV;
      yawV *= Math.pow(0.02, dt);
      busy = true;
    }
    turret.rotation.y = yaw;
    camera.position.set(0, centerY + baseD * 0.07, baseD);
    camera.lookAt(0, centerY, 0);
    renderer.render(scene, camera);
    if (busy || pointer) raf = requestAnimationFrame(tick);
  }

  const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(host);
  fit();

  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
    [metal, rainbowMat, bodyMat, backMat, backTex, shadowTex, ...Object.values(faceMat), ...Object.values(faceTex)]
      .forEach(x => x && x.dispose && x.dispose());
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (_) {}
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return { setCard, flipUp, flipDown, remove, focus, resize: fit, destroy, count: N, rings: counts };
}
