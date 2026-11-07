// Racelandia - the 3D view: the circuit, the sky, the weather, the cars and
// the cameras. It only draws. The simulation (sim.js) decides where the car is;
// this file is handed a recorded run and a time and puts the car there.
//
// createView(THREE, host, track, opts) -> view. THREE is passed in so the page
// loads three.js once, from this app's own copy.

const F = { fuel: 17, pit: 30, sec: 31, t: 0, x: 1, y: 2, psi: 3, u: 4, v: 5, r: 6, delta: 7, thr: 8, brk: 9, gear: 10, rpm: 11, ax: 19, ay: 20, lap: 21, idx: 22, off: 23, water: 28 };
export const FRAME = 36;

const LIVERY = [
  [0xd7263d, 0xf4f4f0], [0x1f6feb, 0xffd23f], [0x20b26b, 0x101820], [0xff8a1f, 0x1a1a2e],
  [0x8a4fff, 0xf2f2f2], [0x14b8c8, 0x0b1d2a], [0xe8e8e8, 0xd7263d], [0x111111, 0xffcf33],
];
// Paint zones are shared by the garage editor, race cars and instanced opponents.
export const LIVERY_DEFAULTS = {body:'#d7263d',nose:'#d7263d',engineCover:'#d7263d',sidepods:'#d7263d',accents:'#f4f4f0',frontWing:'#f4f4f0',rearWing:'#d7263d',floor:'#171b22',suspension:'#171b22',mirrors:'#d7263d',halo:'#171b22',rims:'#646c78',helmet:'#f4f4f0'};
const paintColor = (colors, zone, fallback) => /^#[0-9a-f]{6}$/i.test(colors?.[zone]) ? colors[zone] : fallback;

const COMPOUND_COL = { S: 0xe5322d, M: 0xf2c230, H: 0xf1f1f1, I: 0x2fae4a, W: 0x2f7ee8 };

function mulberry(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(THREE, w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(ctx, w, h, base, amp, n, seed) {
  const r = mulberry(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (r() - 0.5) * amp;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

// Geometry is built once per view. Static surfaces are merged by material;
// steering, tyre rotation and the driver remain separate articulated parts.
function carFactory(THREE, low) {
  const segments = low ? 12 : 20, radial = low ? 12 : 20;
  const templates = new Map();
  const resources = new Set();
  const keep = r => { resources.add(r); return r; };
  function surface(rows, around, point) {
    const pos = [], idx = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= around; j++) pos.push(...point(i / rows, j / around));
    for (let i = 0; i < rows; i++) for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j, b = a + around + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    // Join normals across the parametric seam, without flattening the silhouette.
    const normals = geo.attributes.normal;
    for (let i = 0; i <= rows; i++) {
      const a = i * (around + 1), b = a + around;
      const n = new THREE.Vector3().fromBufferAttribute(normals, a).add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
      normals.setXYZ(a, n.x, n.y, n.z); normals.setXYZ(b, n.x, n.y, n.z);
    }
    return geo;
  }
  // Cross sections: longitudinal position, lower edge, upper edge, half width.
  function shell(sections) {
    const profile = new THREE.CatmullRomCurve3(sections.map(s => new THREE.Vector3(s[0], (s[1] + s[2]) / 2, s[3])));
    const height = new THREE.CatmullRomCurve3(sections.map(s => new THREE.Vector3(s[0], (s[2] - s[1]) / 2, 0)));
    const geo = surface(segments, radial, (u, v) => {
      const p = profile.getPoint(u), h = height.getPoint(u).y, a = v * Math.PI * 2;
      return [p.x, p.y + Math.sin(a) * h, Math.cos(a) * p.z];
    });
    const index = geo.index.array;
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    const normal = geo.attributes.normal;
    for (let i = 0; i < normal.array.length; i++) normal.array[i] *= -1;
    return geo;
  }
  function foil(span, chord, rise, sweep = 0) {
    return surface(low ? 8 : 12, 12, (u, v) => {
      const z = (u - 0.5) * span, a = v * Math.PI * 2, edge = Math.pow(Math.abs(u - 0.5) * 2, 2);
      return [Math.cos(a) * chord * (1 - edge * 0.12) / 2 + sweep * edge,
        Math.sin(a) * 0.018 + rise * edge + 0.035 * Math.sin(a / 2), z];
    });
  }
  function plate(points, depth, bevel = 0.015) {
    const shape = new THREE.Shape(); points.forEach((p, i) => i ? shape.lineTo(...p) : shape.moveTo(...p)); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 8 });
    geo.translate(0, 0, -depth / 2); return geo;
  }
  function build(col) {
    const [main, acc] = LIVERY[col % LIVERY.length];
    const body = keep(new THREE.MeshStandardMaterial({ color: main, roughness: 0.3, metalness: 0.16 }));
    const accent = keep(new THREE.MeshStandardMaterial({ color: acc, roughness: 0.32, metalness: 0.25 }));
    const carbon = keep(new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.52, metalness: 0.22 }));
    const rubber = keep(new THREE.MeshStandardMaterial({ color: 0x191a1d, roughness: 0.88 }));
    const alloy = keep(new THREE.MeshStandardMaterial({ color: 0x646c78, roughness: 0.35, metalness: 0.72 }));
    const cockpit = keep(new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.95 }));
    const g = new THREE.Group(), batches = new Map(), paintMaterials = new Map();
    let zone = 'body';
    const paintMaterial = (mat, part = zone) => {
      if (mat === rubber || mat === cockpit) return mat;
      const id = part + ':' + mat.uuid;
      if (!paintMaterials.has(id)) {
        const m = keep(mat.clone()); m.userData = {paintZone:part, baseColor:mat.color.getHex()};
        paintMaterials.set(id, m);
      }
      return paintMaterials.get(id);
    };
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      mat = paintMaterial(mat);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.updateMatrix();
      const transformed = geo.index ? geo.toNonIndexed() : geo.clone(); transformed.applyMatrix4(m.matrix); geo.dispose();
      if (zone === 'nose') {
        // Partition triangles at the front suspension; each triangle retains its original geometry.
        const groups = new Map(), p = transformed.attributes.position.array, n = transformed.attributes.normal.array;
        for (let i=0;i<p.length;i+=9) {
          const part = (p[i]+p[i+3]+p[i+6])/3 > 1.05 ? 'nose' : 'body';
          if (!groups.has(part)) groups.set(part,{p:[],n:[]});
          groups.get(part).p.push(...p.slice(i,i+9)); groups.get(part).n.push(...n.slice(i,i+9));
        }
        for (const [part, a] of groups) {
          const material = paintMaterial(body,part), piece = new THREE.BufferGeometry();
          piece.setAttribute('position',new THREE.Float32BufferAttribute(a.p,3));piece.setAttribute('normal',new THREE.Float32BufferAttribute(a.n,3));
          if (!batches.has(material)) batches.set(material,[]);batches.get(material).push(piece);
        }
        transformed.dispose(); return;
      }
      if (!batches.has(mat)) batches.set(mat, []); batches.get(mat).push(transformed);
    };
    const ellipsoid = (mat, x, y, z, sx, sy, sz) => {
      const geo = new THREE.SphereGeometry(1, radial, low ? 8 : 12); geo.scale(sx, sy, sz); add(geo, mat, x, y, z);
    };
    const rod = (a, b, radius = 0.018, mat = carbon) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), d = end.clone().sub(start);
      const geo = new THREE.CylinderGeometry(radius, radius, d.length(), 6);
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      const p = start.add(end).multiplyScalar(0.5); add(geo, mat, p.x, p.y, p.z);
    };
    // Tapered survival cell, slender raised nose and a tight engine cover.
    zone = 'nose';
    add(shell([[-2.45,.28,.36,.025],[-1.6,.22,.62,.22],[-.65,.22,.77,.35],[.35,.24,.65,.33],[1.1,.26,.60,.23],[2.1,.24,.43,.13],[3.08,.20,.29,.055],[3.15,.22,.26,.003]]), body);
    zone = 'engineCover';
    add(shell([[-2.35,.37,.42,.01],[-1.7,.34,.72,.18],[-1.02,.40,1.05,.24],[-.65,.53,1.10,.19],[-.50,.60,.98,.02]]), body);
    // Airbox above the driver's shoulders, with a dark inset inlet.
    ellipsoid(accent, -.62, .98, 0, .17, .15, .18);
    ellipsoid(cockpit, -.475, 1.0, 0, .035, .095, .115);
    zone = 'body';
    // Open cockpit and its raised padded surround.
    ellipsoid(carbon, .12, .67, 0, .61, .12, .30);
    ellipsoid(cockpit, .15, .735, 0, .51, .065, .235);
    for (const s of [-1, 1]) {
      zone = 'sidepods';
      add(shell([[-1.85,.20,.29,.015],[-1.3,.19,.46,.23],[-.55,.22,.60,.30],[.28,.27,.64,.29],[.65,.32,.59,.22],[.73,.38,.52,.01]]), body, 0, 0, s * .54);
      ellipsoid(cockpit, .57, .47, s * .56, .10, .10, .19);
      zone = 'accents';
      // A narrow accent follows the shoulder rather than forming another block.
      add(shell([[-1.55,.40,.42,.005],[-.65,.56,.58,.035],[.27,.61,.63,.05],[.59,.56,.58,.005]]), accent, 0, 0, s * .59);
      zone = 'floor';
      const floor = plate([[-2.15,.10],[.8,.10],[1.2,.15],[.65,.19],[-1.6,.17],[-2.15,.25]], .11, .01);
      add(floor, carbon, 0, 0, s * .81);
      // Wing endplates follow the aerofoil silhouette, with rounded edges.
      zone = 'frontWing';
      add(plate([[-.33,0],[.37,0],[.33,.22],[-.17,.25],[-.34,.14]], .025), accent, 2.91, .15, s * 1.02);
      zone = 'rearWing';
      add(plate([[-.40,0],[.31,0],[.33,.54],[-.25,.51],[-.40,.32]], .025), body, -2.55, .70, s * .70);
      rod([-2.43,.35,s * .15],[-2.53,1.05,s * .15], .024);
      zone = 'mirrors';
      rod([.35,.61,s * .28],[.48,.70,s * .57], .016);
      ellipsoid(body, .48, .72, s * .60, .14, .06, .085);
      zone = 'suspension';
      // Two wishbones and a pushrod at each exposed wheel.
      for (const x of [1.95, -1.65]) {
        for (const h of [.25,.46]) for (const dx of [-.39,.39]) rod([x + dx,h,s * .23],[x,h - .04,s * .87], .014);
        rod([x - .25,.56,s * .25],[x,.23,s * .86], .018);
      }
    }
    zone = 'floor';
    add(new THREE.BoxGeometry(4.0,.045,1.46), carbon, -.13,.12,0);
    zone = 'frontWing';
    add(foil(2.02,.56,.06,-.10), carbon, 2.95,.17);
    add(foil(1.94,.34,.07,-.14), accent, 2.77,.25);
    zone = 'rearWing';
    add(foil(1.39,.62,.02), carbon, -2.56,1.04);
    add(foil(1.39,.38,.02), accent, -2.66,1.18);
    zone = 'floor';
    // Diffuser and rear crash structure.
    add(plate([[-2.45,.13],[-1.5,.13],[-1.65,.21],[-2.45,.32]], 1.28, .008), carbon);
    add(new THREE.CylinderGeometry(.055,.065,.30,10), alloy, -2.39,.50,0,0,0,Math.PI/2);
    for (const z of [-.48,-.24,0,.24,.48]) add(new THREE.BoxGeometry(.55,.16,.018), carbon,-2.14,.23,z);
    // Halo is one articulated group, so cockpit cameras can hide all its supports.
    const halo = new THREE.Group();
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-.39,.86,-.27),new THREE.Vector3(.15,.96,-.29),new THREE.Vector3(.73,.92,0),new THREE.Vector3(.15,.96,.29),new THREE.Vector3(-.39,.86,.27)]);
    halo.add(new THREE.Mesh(keep(new THREE.TubeGeometry(path, low ? 16 : 28, .025, 6, false)), paintMaterial(carbon,'halo')));
    const pillar = new THREE.Mesh(keep(new THREE.CylinderGeometry(.021,.026,.32,6)),paintMaterial(carbon,'halo')); pillar.position.set(.71,.77,0); pillar.rotation.z = -.16; halo.add(pillar); g.add(halo);
    const helmet = new THREE.Group();
    const dome = new THREE.Mesh(keep(new THREE.SphereGeometry(.15,radial,12)),paintMaterial(accent,'helmet')); dome.scale.set(1,.98,.9); helmet.add(dome);
    const visor = new THREE.Mesh(keep(new THREE.SphereGeometry(.153,radial,8,Math.PI*.06,Math.PI*.88,Math.PI*.34,Math.PI*.29)),carbon); visor.rotation.y = Math.PI / 2; helmet.add(visor);
    helmet.position.set(.02,.82,0); g.add(helmet);
    const wheels = [];
    [[1.95,.88,.36,.36],[1.95,-.88,.36,.36],[-1.65,.87,.37,.43],[-1.65,-.87,.37,.43]].forEach((w,i) => {
      const wg = new THREE.Group(); wg.position.set(w[0],w[2],w[1]); const spin = new THREE.Group(); wg.add(spin);
      // Lathed rounded shoulders avoid the old cylinder's hard ninety-degree edge.
      const r = w[2], half = w[3]/2;
      const profile = [[.19,-half],[r*.82,-half],[r*.96,-half*.83],[r,-half*.55],[r,half*.55],[r*.96,half*.83],[r*.82,half],[.19,half]].map(p => new THREE.Vector2(...p));
      const tyre = new THREE.Mesh(keep(new THREE.LatheGeometry(profile,low ? 24 : 40)),rubber); tyre.rotation.x = Math.PI/2; spin.add(tyre);
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(r*.80,.010,6,low ? 24 : 40)), keep(new THREE.MeshStandardMaterial({color:COMPOUND_COL.M,roughness:.65})));
      ring.position.z = Math.sign(w[1]) * (half + .003); spin.add(ring);
      const cover = new THREE.Mesh(keep(new THREE.CylinderGeometry(.195,.195,w[3]+.012,low ? 20 : 32)),paintMaterial(carbon,'rims')); cover.rotation.x = Math.PI/2; spin.add(cover);
      const hub = new THREE.Mesh(keep(new THREE.CylinderGeometry(.065,.065,w[3]+.025,12)),paintMaterial(alloy,'rims')); hub.rotation.x = Math.PI/2; spin.add(hub);
      const mark = new THREE.Mesh(keep(new THREE.BoxGeometry(.105,.018,.006)),paintMaterial(alloy,'rims')); mark.position.set(.11,0,ring.position.z+.004*Math.sign(w[1])); spin.add(mark);
      g.add(wg); wheels.push({g:wg,spin,front:i<2,r});
    });
    // One draw per static material, regardless of the number of aero details.
    for (const [mat, list] of batches) {
      const pos = [], normal = [];
      for (const geo of list) { pos.push(...geo.attributes.position.array); normal.push(...geo.attributes.normal.array); geo.dispose(); }
      const geo = keep(new THREE.BufferGeometry()); geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
      g.add(new THREE.Mesh(geo,mat));
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = !low; o.receiveShadow = true; } });
    return {g,wheels,halo,helmet};
  }
  function makeCar(col, compound, colors = {}) {
    if (!templates.has(col)) templates.set(col,build(col));
    const t = templates.get(col), car = t.g.clone(true);
    const wheels = t.wheels.map(w => {
      const g = car.children[t.g.children.indexOf(w.g)], spin = g.children[0];
      spin.children[1].material = keep(spin.children[1].material.clone()); spin.children[1].material.color.setHex(COMPOUND_COL[compound] || COMPOUND_COL.M);
      return {...w,g,spin};
    });
    const painted = new Map();
    car.traverse(o => {
      if (!o.material?.userData.paintZone) return;
      if (!painted.has(o.material)) painted.set(o.material,keep(o.material.clone()));
      o.material = painted.get(o.material);
    });
    const holder = new THREE.Group(); holder.add(car);
    const result = {holder,car,wheels,halo:car.children[t.g.children.indexOf(t.halo)],helmet:car.children[t.g.children.indexOf(t.helmet)],parts:car.children,ownMaterials:[...wheels.map(w => w.spin.children[1].material),...painted.values()]};
    setLivery(result,colors); return result;
  }
  function setLivery(model, colors = {}) {
    model.car.traverse(o => { const m=o.material,part=m?.userData.paintZone;
      if (part) m.color.set(paintColor(colors,part,m.userData.baseColor));
    });
  }
  return {makeCar,setLivery,release(car) { car.ownMaterials.forEach(m => { m.dispose(); resources.delete(m); }); },dispose() { resources.forEach(r => r.dispose()); resources.clear(); templates.clear(); }};
}

// The garage uses the same model, rendered only on resize or interaction.
// No circuit, shadow map, postprocessing or idle animation is needed here.
export function createGarageView(THREE, host, opts = {}) {
  const low = !!opts.low, factory = carFactory(THREE,low);
  const renderer = new THREE.WebGLRenderer({antialias:!low,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,low ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x121923); host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35,1,.1,40);
  scene.add(new THREE.HemisphereLight(0xe4efff,0x454b58,2.2));
  const key = new THREE.DirectionalLight(0xffffff,3.2); key.position.set(1,5,3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xabcfff,2.0); rim.position.set(-3,2,-4); scene.add(rim);
  const car = factory.makeCar(0,opts.compound || 'M',opts.livery); scene.add(car.holder);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2,64),new THREE.MeshStandardMaterial({color:0x242d3a,roughness:.82}));
  floor.rotation.x = -Math.PI/2; floor.position.y = -.018; scene.add(floor);
  const shadowTex = canvasTex(THREE,128,64,(c,w,h) => { const g = c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2); g.addColorStop(0,'rgba(0,0,0,.65)'); g.addColorStop(1,'rgba(0,0,0,0)'); c.fillStyle=g; c.fillRect(0,0,w,h); });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7,2.7),new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false})); shadow.rotation.x=-Math.PI/2; shadow.position.y=.002; scene.add(shadow);
  let yaw = .78, pitch = .34, drag = null, dead = false;
  function render() {
    if (dead || !host.isConnected) return;
    const w=host.clientWidth || 600,h=host.clientHeight || 260;
    renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
    const dist= Math.max(9.8,6.2 / camera.aspect);
    camera.position.set(Math.cos(yaw)*Math.cos(pitch)*dist,.5+Math.sin(pitch)*dist,Math.sin(yaw)*Math.cos(pitch)*dist); camera.lookAt(.15,.48,0); renderer.render(scene,camera);
  }
  const canvas=renderer.domElement;
  if (opts.interactive !== false) {
    canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.009;pitch=Math.max(.12,Math.min(1.2,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];render();});
    canvas.addEventListener('pointerup',()=>{drag=null;}); canvas.addEventListener('pointercancel',()=>{drag=null;});
  }
  const observer=new ResizeObserver(render);observer.observe(host);render();
  return {setLivery(colors){factory.setLivery(car,colors);render();},destroy(){dead=true;observer.disconnect();factory.dispose();floor.geometry.dispose();floor.material.dispose();shadow.geometry.dispose();shadow.material.dispose();shadowTex.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
}

// The mechanics share instanced geometry; articulated poses cost a few draws for
// the entire crew. Their feet stay planted while hands work on each wheel.
function pitCrew(THREE, low) {
  const group = new THREE.Group(), actors = [], batches = new Map();
  const geo = new THREE.SphereGeometry(1,low ? 8 : 12,low ? 6 : 8);
  const suit = new THREE.MeshStandardMaterial({color:0xc92339,roughness:.76});
  const dark = new THREE.MeshStandardMaterial({color:0x171c25,roughness:.7});
  const helmet = new THREE.MeshStandardMaterial({color:0xe5eaf1,roughness:.38});
  const visor = new THREE.MeshStandardMaterial({color:0x243d50,roughness:.23,metalness:.5});
  function part(parent,mat,x,y,z,sx,sy,sz) {
    const m = new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(m);return m;
  }
  const positions = [[1.95,1.43], [1.95,-1.43], [-1.65,1.46], [-1.65,-1.46], [.2,1.8], [.2,-1.8], [3.8,0], [-3.55,0]];
  for (const [i,p] of positions.entries()) {
    const person=new THREE.Group();person.position.set(p[0],0,p[1]);person.rotation.y=p[1] ? (p[1]>0 ? Math.PI : 0) : (p[0]>0 ? -Math.PI/2 : Math.PI/2);
    part(person,suit,0,.69,0,.23,.28,.15);part(person,dark,0,.47,0,.21,.09,.14);
    part(person,helmet,0,1.07,.055,.17,.19,.17);part(person,visor,0,1.08,.198,.135,.077,.04);
    const arms=[];
    for(const s of [-1,1]) {
      const arm=new THREE.Group();arm.position.set(s*.25,.85,.01);arm.rotation.x=-.8;arm.rotation.z=s*.12;person.add(arm);
      part(arm,suit,0,-.16,0,.075,.20,.075);
      const forearm=new THREE.Group();forearm.position.y=-.32;forearm.rotation.x=-1.0;arm.add(forearm);
      part(forearm,suit,0,-.135,0,.065,.16,.065);part(forearm,dark,0,-.29,0,.073,.07,.072);arms.push(arm);
      // Bent thighs, knees, shins and boots in a stable crouch.
      const thigh=part(person,suit,s*.14,.34,.12,.10,.20,.10);thigh.rotation.x=-.85;
      const shin=part(person,suit,s*.15,.18,.24,.085,.17,.085);shin.rotation.x=.3;
      part(person,dark,s*.15,.065,.31,.10,.065,.18);
    }
    const tool=part(person,dark,.16,.51,.46,.07,.065,.14);
    part(person,helmet,.16,.51,.59,.025,.025,.05);
    actors.push({person,arms,tool,index:i});
  }
  const instanced=[];
  for(const [mat,parts] of batches) {
    const mesh=new THREE.InstancedMesh(geo,mat,parts.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=!low;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);instanced.push({mesh,parts});
  }
  function update(t) {
    for(const a of actors) {
      a.arms.forEach((arm,i)=>{arm.rotation.x=-.8+Math.sin(t*8+a.index+i)*.07;});
      a.person.updateMatrixWorld(true);
    }
    for(const {mesh,parts} of instanced) { parts.forEach((p,i)=>mesh.setMatrixAt(i,p.matrixWorld));mesh.instanceMatrix.needsUpdate=true; }
  }
  update(0); group.visible=false; return {group,update};
}

function recoveryTruck(THREE, low) {
  const g=new THREE.Group();
  const paint=new THREE.MeshStandardMaterial({color:0xe4aa24,roughness:.45,metalness:.22});
  const steel=new THREE.MeshStandardMaterial({color:0x596572,roughness:.5,metalness:.5});
  const black=new THREE.MeshStandardMaterial({color:0x171c24,roughness:.8});
  const glass=new THREE.MeshStandardMaterial({color:0x344c60,roughness:.24,metalness:.4});
  const light=new THREE.MeshBasicMaterial({color:0xffad19});
  function box(w,h,d,mat,x,y,z=0) {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=!low;g.add(m);return m;}
  box(7.4,.17,2.45,steel,0,.65);box(6.7,.25,1.65,black,0,.40);box(1.65,1.30,2.15,paint,4.15,1.01);
  box(1.4,.65,2.17,glass,4.16,1.76);box(1.65,.12,2.25,paint,4.15,2.12);box(.10,.7,2.15,paint,4.88,1.75);
  box(.12,.22,1.15,black,5.02,.93);box(.6,.15,1.5,paint,4.1,2.27);
  for(const s of [-1,1]) {
    box(.24,.15,.24,light,4.1,2.4,s*.58);box(6.9,.11,.06,paint,-.1,.79,s*1.2);
    for(const x of [-2.65,2.65,4.13]) {
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.23,low ? 12 : 20),black);wheel.rotation.x=Math.PI/2;wheel.position.set(x,.38,s*1.02);g.add(wheel);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.25,12),steel);hub.rotation.x=Math.PI/2;hub.position.copy(wheel.position);g.add(hub);
    }
  }
  g.visible=false;return g;
}

export function createView(THREE, host, T, opts) {
  opts = opts || {};
  const low = !!opts.low;
  const W = () => host.clientWidth || 800, H = () => host.clientHeight || 450;
  const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.2, 4000);
  const P = (x, y, h) => new THREE.Vector3(x, h || 0, -y);

  // ── light & sky ──
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x748071, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 400 });
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3c7bd8) }, hor: { value: new THREE.Color(0xbcd8f0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2cf) }, sunAmt: { value: 1 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vP;' +
      'void main(){ float h = clamp(vP.y,0.0,1.0); vec3 c = mix(hor, top, pow(h,0.55)); float d = max(dot(normalize(vP),normalize(sunDir)),0.0);' +
      'c += sunCol*(pow(d,900.0)*2.0 + pow(d,12.0)*0.22)*sunAmt; if(vP.y<0.0) c = hor*0.85; gl_FragColor = vec4(c,1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 24, 16), skyMat); sky.frustumCulled = false; scene.add(sky);

  // where on Earth the circuit is and which day it is decide how the sun and the moon cross the sky
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const siteHash = id => { let h = 2166136261; for (const ch of String(id || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const site = Object.assign({ lat: 45, lon: 0, id: '', doy: Math.floor((Date.now() - Date.UTC(new Date().getFullYear(), 0, 0)) / 864e5) }, opts.site || {});
  // the circuit's heading on the map is not known: each circuit gets its own fixed turn of the sky instead of the same sun everywhere
  const solar = hour => {
    const rad = Math.PI / 180, lat = (site.lat || 0) * rad, dec = 23.44 * rad * Math.sin(2 * Math.PI * (284 + site.doy) / 365);
    const H = (hour + (site.lon || 0) / 15 - Math.round((site.lon || 0) / 15) - 12) * 15 * rad;
    const sinE = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H), cosE = Math.sqrt(Math.max(0, 1 - sinE * sinE));
    const e = -Math.cos(dec) * Math.sin(H), n = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
    const rot = siteHash(site.id) * Math.PI * 2, ex = e * Math.cos(rot) - n * Math.sin(rot), nz = e * Math.sin(rot) + n * Math.cos(rot), hl = Math.hypot(ex, nz) || 1;
    return { sinE, dir: new THREE.Vector3(ex / hl * cosE, sinE, -nz / hl * cosE) };
  };

  // night sky: stars, a moon and its weak light
  const starPos = new Float32Array(900 * 3);
  { const r = mulberry(23); for (let i = 0; i < 900; i++) { const a = r() * Math.PI * 2, y = 0.05 + r() * 0.95, q = Math.sqrt(1 - y * y); starPos.set([Math.cos(a) * q * 2300, y * 2300, Math.sin(a) * q * 2300], i * 3); } }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.frustumCulled = false; stars.visible = false; scene.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(55, 24, 16), new THREE.MeshBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  moon.frustumCulled = false; moon.visible = false; scene.add(moon);
  const moonDir = new THREE.Vector3(0, 0.5, -1);
  const moonLight = new THREE.DirectionalLight(0x9fb5ff, 0); scene.add(moonLight); scene.add(moonLight.target);

  const cloudTex = canvasTex(THREE, 128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const clouds = [];
  { const r = mulberry(11);
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      const a = r() * Math.PI * 2, d = 500 + r() * 1700, hh = 260 + r() * 340;
      m.position.set(Math.cos(a) * d, hh, Math.sin(a) * d);
      const s = 320 + r() * 520; m.scale.set(s * 1.6, s, 1); m.rotation.x = Math.PI / 2; m.userData.k = r();
      scene.add(m); clouds.push(m);
    } }

  // ── ground, track, kerbs, run-off, walls ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ map: canvasTex(THREE, 256, 256, (c, w, h) => noise(c, w, h, '#4b703b', 32, 5000, 5), [260, 260]), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);

  const N = T.N;
  function ribbon(a, b, y, mat, vScale, closed) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      pos.push(T.x[k] + T.nx[k] * a, y, -(T.y[k] + T.ny[k] * a), T.x[k] + T.nx[k] * b, y, -(T.y[k] + T.ny[k] * b));
      uv.push(0, i * T.ds / vScale, 1, i * T.ds / vScale);
    }
    for (let i = 0; i < N; i++) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
  }
  const hw = T.half;
  const asphaltTex = canvasTex(THREE, 256, 256, (c, w, h) => {
    noise(c, w, h, '#50555a', 26, 6200, 3);
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(2, 0, 7, h); c.fillRect(w - 9, 0, 7, h);
  });
  const trackMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
  ribbon(-hw, hw, 0.02, trackMat, 12);
  // rubbered-in racing line
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });
  { const L = T.line, pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const k = i % N; pos.push(L.x[k] + Math.cos(L.psi[k] + Math.PI / 2) * -1.4, 0.035, -(L.y[k] + Math.sin(L.psi[k] + Math.PI / 2) * -1.4), L.x[k] + Math.cos(L.psi[k] + Math.PI / 2) * 1.4, 0.035, -(L.y[k] + Math.sin(L.psi[k] + Math.PI / 2) * 1.4)); }
    for (let i = 0; i < N; i++) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    scene.add(new THREE.Mesh(g, lineMat)); }
  const gravelTex = canvasTex(THREE, 128, 128, (c, w, h) => noise(c, w, h, '#b79e72', 90, 2600, 9));
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 });
  ribbon(hw + 1.3, hw + 14, 0.012, gravelMat, 8); ribbon(-hw - 14, -hw - 1.3, 0.012, gravelMat, 8);
  const apronTex = canvasTex(THREE, 64, 64, (c, w, h) => noise(c, w, h, '#2f3237', 30, 400, 2));
  const apronMat = new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.95 });
  ribbon(hw, hw + 1.3, 0.025, apronMat, 8); ribbon(-hw - 1.3, -hw, 0.025, apronMat, 8);
  // kerbs on the inside of corners
  { const pos = [], col = [], idx = []; let n = 0;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(T.kappa[i]); if (k < 1 / 330) continue;
      const side = T.kappa[i] > 0 ? 1 : -1;
      const j = (i + 1) % N;
      const a = side * hw, b = side * (hw + 1.5), rd = (Math.floor(i / 1) % 2) === 0;
      const c = rd ? [0.85, 0.12, 0.14] : [0.95, 0.95, 0.95];
      for (const q of [i, j]) for (const o of [a, b]) { pos.push(T.x[q] + T.nx[q] * o, 0.05, -(T.y[q] + T.ny[q] * o)); col.push(...c); }
      if (side > 0) idx.push(n,n+2,n+1,n+1,n+2,n+3);
      else idx.push(n,n+1,n+2,n+1,n+3,n+2);
      n += 4;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }))); }
  // On the pit side the outer wall and fence step back, smoothly, so the pit lane and the garages stand inside them.
  const pitStep = k => {
    const kk = k >= N / 2 ? k - N : k, a0 = T.pit.inA - N - 12, a1 = T.pit.outB + 12, ramp = 12;
    const w = Math.max(0, Math.min(1, Math.min(kk - a0, a1 - kk) / ramp));
    return 16 * (0.5 - 0.5 * Math.cos(Math.PI * w));
  };
  // A wall must not stand on the tarmac of another stretch of the circuit, or across the pit lane: where
  // it would, it is left out. wallOk[side][k] says whether the wall point beside index k may be built.
  const wallOff = (k, sg) => hw + T.runoff + (sg < 0 ? pitStep(k) : 0);
  const wallOk = {};
  for (const sg of [-1, 1]) {
    const ok = new Uint8Array(N).fill(1), PL = T.pit.line, ps = [];
    for (let k = T.pit.inA; k < N + T.pit.outB; k++) ps.push(k % N);
    for (let k = 0; k < N; k++) {
      const o = wallOff(k, sg), x = T.x[k] + T.nx[k] * o * sg, y = T.y[k] + T.ny[k] * o * sg;
      for (let j = 0; j < N && ok[k]; j += 2) {
        const d = Math.abs(j - k), arc = Math.min(d, N - d) * T.ds;
        if (arc >= 120 && Math.hypot(T.x[j] - x, T.y[j] - y) < hw + 1.5) ok[k] = 0;
      }
      for (let n = 0; n < ps.length && ok[k]; n += 2) {
        const i = ps[n], d = Math.abs(i - k), arc = Math.min(d, N - d) * T.ds;
        if (arc >= 60 && Math.hypot(PL.x[i] - x, PL.y[i] - y) < 6) ok[k] = 0;
      }
    }
    wallOk[sg] = ok;
  }
  // walls at the end of the run-off
  { const off = hw + T.runoff;
    const wallTex = canvasTex(THREE, 128, 64, (c, w, h) => { c.fillStyle = '#e9e9e9'; c.fillRect(0, 0, w, h); c.fillStyle = '#c8202f'; c.fillRect(0, h * 0.35, w, h * 0.3); c.fillStyle = '#1b1b1b'; c.fillRect(0, h * 0.9, w, h * 0.1); });
    wallTex.repeat.set(1, 1);
    for (const sg of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        // on the pit side the wall steps back, smoothly, so the pit lane and the garages stand inside it
        const o = wallOff(k, sg);
        const x = T.x[k] + T.nx[k] * o * sg, z = -(T.y[k] + T.ny[k] * o * sg); pos.push(x, 0, z, x, 1.3, z); uv.push(i * T.ds / 12, 0, i * T.ds / 12, 1);
      }
      for (let i = 0; i < N; i++) { if (!wallOk[sg][i % N] || !wallOk[sg][(i + 1) % N]) continue; const o = i * 2; if (sg > 0) idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); else idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.DoubleSide })); m.castShadow = !low; scene.add(m);
    } }
  // the pit lane, its wall and the garages
  { const P = T.pit, L = P.line, span = [];
    for (let k = P.inA; k < N + P.outB; k++) span.push(k % N);
    const pos = [], uv = [], idx = [];
    span.forEach((k, n) => {
      const nxp = -Math.sin(L.psi[k]), nyp = Math.cos(L.psi[k]);
      for (const o of [-P.halfWidth, P.halfWidth]) pos.push(L.x[k] + nxp * o, 0.045, -(L.y[k] + nyp * o));
      uv.push(0, n * T.ds / 12, 1, n * T.ds / 12);
    });
    for (let n = 0; n < span.length - 1; n++) { const o = n * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const lane = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, color: 0xb8c0cc })); lane.receiveShadow = true; scene.add(lane);
    // A building must not stand on another part of the circuit: a real circuit passes close to itself.
    // `clearOf` asks whether a footprint of radius r around (x, y) is clear of every part of the track
    // that is not the stretch it stands beside.
    var clearOf;
    { const cell = 40, grid = new Map();
      for (let j = 0; j < N; j += 2) { const key = Math.floor(T.x[j] / cell) + ',' + Math.floor(T.y[j] / cell); (grid.get(key) || grid.set(key, []).get(key)).push(j); }
      clearOf = (x, y, r, i0) => {
        const need = r + hw + T.runoff * 0.35, reach = Math.ceil(need / cell) + 1, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
          const l = grid.get((cx + a) + ',' + (cy + b)); if (!l) continue;
          for (const j of l) {
            const d = Math.abs(j - i0), arc = Math.min(d, N - d) * T.ds;
            if (arc < 220) continue;
            if (Math.hypot(T.x[j] - x, T.y[j] - y) < need) return false;
          }
        }
        return true;
      };
    }
    // pit wall between the track and the lane, and the garage building behind it
    const wallM = new THREE.MeshStandardMaterial({ color: 0xcfd3da, roughness: 0.7 }), garM = new THREE.MeshStandardMaterial({ color: 0x8995a3, roughness: 0.8 }), doorM = new THREE.MeshStandardMaterial({
      map: canvasTex(THREE,128,128,(c,w,h)=>{
        c.fillStyle='#82909e';c.fillRect(0,0,w,h);
        for(let y=0;y<h;y+=9){c.fillStyle='#54616f';c.fillRect(0,y,w,2);c.fillStyle='#b1bdc7';c.fillRect(0,y+2,w,1);}
        c.fillStyle='#394653';c.fillRect(w*.46,h*.64,w*.08,3);
      }), roughness:.72
    });
    const a0 = (P.inB - N) + 6, a1 = P.outA - 6;
    for (let k = a0; k <= a1; k += 2) {
      const i = ((k % N) + N) % N;
      const w = new THREE.Mesh(new THREE.BoxGeometry(7, 1.0, 0.5), wallM);
      w.position.set(T.x[i] + T.nx[i] * -(hw + 1.9), 0.5, -(T.y[i] + T.ny[i] * -(hw + 1.9))); w.rotation.y = T.psi[i]; scene.add(w);
    }
    const roofTrim=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xbac3cf,roughness:.5,metalness:.22}),20);
    const roofMatrix=new THREE.Matrix4();
    for (let n = 0; n < 10; n++) {         // one garage for each of the ten teams, the box of team n is at (n - 5) * 12 m from the pit mark
      const i = P.boxes[n], ox = T.x[i] + T.nx[i] * -(hw + 13), oy = T.y[i] + T.ny[i] * -(hw + 13);
      if (!clearOf(ox, oy, 8, i)) { roofMatrix.makeScale(0, 0, 0); roofTrim.setMatrixAt(n * 2, roofMatrix); roofTrim.setMatrixAt(n * 2 + 1, roofMatrix); continue; }
      const gb = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 7), garM); gb.position.set(ox, 2.5, -oy); gb.rotation.y = T.psi[i]; gb.castShadow = !low; scene.add(gb);
      for(let k=0;k<2;k++) {
        const off=-(hw+(k ? 8.2 : 13));
        roofMatrix.compose(new THREE.Vector3(T.x[i]+T.nx[i]*off,k ? 4.8 : 5.08,-(T.y[i]+T.ny[i]*off)),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),T.psi[i]),new THREE.Vector3(12.3,k ? .36 : .18,k ? .15 : 9.6));
        roofTrim.setMatrixAt(n*2+k,roofMatrix);
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.2), doorM); door.position.set(T.x[i] + T.nx[i] * -(hw + 9.4), 1.8, -(T.y[i] + T.ny[i] * -(hw + 9.4))); door.rotation.y = T.psi[i]; door.rotation.y += Math.PI / 2 * 0; scene.add(door);
    }
    scene.add(roofTrim);
    // A continuous passing lane beside separate service boxes. All marks use
    // the same geometry as the physics, including player-built circuits.
    const marking = new THREE.MeshBasicMaterial({ color: 0xf4ecd5 });
    const boxMarks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .025, 1), marking, P.boxes.length * 4);
    const markMatrix = new THREE.Matrix4(); let markIndex = 0;
    const placeMark = (i, along, side, length, width) => {
      const psi = T.psi[i], x = L.x[i] + T.nx[i] * side + Math.cos(psi) * along;
      const y = L.y[i] + T.ny[i] * side + Math.sin(psi) * along;
      markMatrix.compose(new THREE.Vector3(x, .065, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi), new THREE.Vector3(length, 1, width));
      boxMarks.setMatrixAt(markIndex++, markMatrix);
    };
    const dividerPos = [], dividerIndices = [];
    for (let k = P.inB; k <= N + P.outA; k++) {
      const i = k % N, n = k - P.inB;
      for (const side of [-.05, .05]) dividerPos.push(L.x[i] + T.nx[i] * side, .065, -(L.y[i] + T.ny[i] * side));
      if (n) { const a = (n - 1) * 2; dividerIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const divider = new THREE.BufferGeometry(); divider.setAttribute('position', new THREE.Float32BufferAttribute(dividerPos, 3)); divider.setIndex(dividerIndices); divider.computeVertexNormals();
    scene.add(new THREE.Mesh(divider, new THREE.MeshBasicMaterial({ color: 0xf4ecd5, side: THREE.DoubleSide })));
    for (const i of P.boxes) {
      placeMark(i, 0, -P.lane - 1.35, 8.5, .12);
      placeMark(i, 0, -P.lane + 1.35, 8.5, .12);
      placeMark(i, -4.25, -P.lane, .12, 2.7);
      placeMark(i, 4.25, -P.lane, .12, 2.7);
    }
    scene.add(boxMarks);
    for (let k = P.inB + 8; k < N + P.outA - 8; k += Math.max(1, Math.round(35 / T.ds))) {
      const i = k % N, psi = T.psi[i], positions = [];
      for (const [a, b] of [[2, 0], [-1, .8], [-.4, 0], [-1, -.8]]) {
        positions.push(L.x[i] + T.nx[i] * (P.lane + b) + Math.cos(psi) * a, .09,
          -(L.y[i] + T.ny[i] * (P.lane + b) + Math.sin(psi) * a));
      }
      const arrow = new THREE.BufferGeometry(); arrow.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); arrow.setIndex([0, 1, 2, 0, 2, 3]); arrow.computeVertexNormals();
      scene.add(new THREE.Mesh(arrow, new THREE.MeshBasicMaterial({ color: 0xf4ecd5, side: THREE.DoubleSide })));
    }
    // Detailed, crouching mechanics instead of cylinders on the pit apron.
    var view_crew = pitCrew(THREE,low); scene.add(view_crew.group);
  }
  // start / finish line and grid
  { const c = canvasTex(THREE, 64, 64, (g, w, h) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); } });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(T.width, 2.4), new THREE.MeshStandardMaterial({ map: c, roughness: 0.8 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2 - Math.atan2(T.y[1] - T.y[N - 1], T.x[1] - T.x[N - 1]) - Math.PI / 2 + Math.PI / 2;
    m.rotation.set(-Math.PI / 2, 0, 0); m.rotateZ(Math.atan2(T.y[1] - T.y[N - 1], T.x[1] - T.x[N - 1]) * -1 + 0);
    m.position.set(T.x[0], 0.05, -T.y[0]);
    // orient: plane long side across the track
    m.rotation.set(-Math.PI / 2, 0, 0); m.rotation.z = Math.PI / 2 - T.psi[0] + Math.PI / 2 - Math.PI / 2 + 0; m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, 0, 0);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), T.psi[0] + Math.PI / 2);
    m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    scene.add(m);
    // gantry with the start lights
    const gr = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.4 });
    for (const sg of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.5, 0.6), steel); p.position.set(0, 3.75, sg * (hw + 2.2)); p.castShadow = !low; gr.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, T.width + 5), steel); beam.position.y = 7.4; beam.castShadow = !low; gr.add(beam);
    const lights = [];
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 8), new THREE.MeshBasicMaterial({ color: 0x330000 })); l.position.set(-0.75, 7.4, -4 + i * 2); gr.add(l); lights.push(l); }
    gr.position.set(T.x[0], 0, -T.y[0]); gr.rotation.y = T.psi[0];
    scene.add(gr); view_lights = lights; }
  var view_lights;
  // pit building and grandstands along the main straight
  { const r = mulberry(21);
    const sideSign = -1;
    for (let k = 0; k < 9; k++) {
      const i = (N - 90 + k * 20) % N;
      const ox = T.x[i] + T.nx[i] * sideSign * (hw + 32), oy = T.y[i] + T.ny[i] * sideSign * (hw + 32);
      if (!clearOf(ox, oy, 26, i)) continue;
      const g = new THREE.Mesh(new THREE.BoxGeometry(48, 6 + (k % 3), 6), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xcfd3d8 : 0xb9bec6, roughness: 0.7 }));
      g.position.set(ox, 3.5, -oy); g.rotation.y = T.psi[i]; g.castShadow = !low; g.receiveShadow = true; scene.add(g);
    }
    const crowd = canvasTex(THREE, 128, 64, (c, w, h) => { c.fillStyle = '#4a505e'; c.fillRect(0, 0, w, h); const rr = mulberry(4); for (let y = 2; y < h; y += 6) for (let x = 2; x < w; x += 5) { c.fillStyle = `hsl(${rr() * 360},35%,${44 + rr() * 22}%)`; c.fillRect(x, y, 3, 3); } c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < h; y += 6) c.fillRect(0, y + 4, w, 1); });
    crowd.repeat.set(3, 1);
    for (let k = 0; k < (T.id==='own'?0:6); k++) {
      const i = (N - 60 + k * 26) % N, sg = 1;
      if (!clearOf(T.x[i] + T.nx[i] * sg * (hw + 40), T.y[i] + T.ny[i] * sg * (hw + 40), 32, i)) continue;
      const st = new THREE.Mesh(new THREE.BoxGeometry(60, 9, 14), new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }));
      st.position.set(T.x[i] + T.nx[i] * sg * (hw + 40), 4.5, -(T.y[i] + T.ny[i] * sg * (hw + 40))); st.rotation.y = T.psi[i]; st.castShadow = !low; scene.add(st);
    }
    void r;
  }
  // Player-built spectator facilities use their saved physical footprints.
  const venueResources=[];
  const facilities=T.id==='own'?(opts.venue?.grandstands||T.grandstands||[]):[];
  if(facilities.length){
    const occupancy=Math.max(0,Math.min(1,opts.venue?.occupancy||0)),rand=mulberry(90210),batches=new Map();
    const concrete=new THREE.MeshStandardMaterial({color:0xaab4c0,roughness:.86});
    const seats=new THREE.MeshStandardMaterial({color:0x2c6b9c,roughness:.75});
    const lawn=new THREE.MeshStandardMaterial({color:0x627a4d,roughness:1});
    const vip=new THREE.MeshStandardMaterial({color:0xddd8c9,roughness:.65});
    const glass=new THREE.MeshStandardMaterial({color:0x33596c,metalness:.3,roughness:.25});
    const crowdTex=canvasTex(THREE,256,64,(c,w,h)=>{c.fillStyle='#346e9b';c.fillRect(0,0,w,h);for(let x=0;x<w;x+=8){c.fillStyle='#194665';c.fillRect(x,32,6,22);if(rand()<occupancy){c.fillStyle=`hsl(${rand()*360},50%,58%)`;c.fillRect(x,18,6,22);c.fillStyle='#d4aa87';c.beginPath();c.arc(x+3,13,3,0,7);c.fill();}}});
    const filled=new THREE.MeshStandardMaterial({map:crowdTex,roughness:.9});
    const add=(mat,s,x,y,z,w,h,d)=>{
      if(!batches.has(mat))batches.set(mat,[]);
      const c=Math.cos(s.angle),n=Math.sin(s.angle),o=new THREE.Object3D();
      o.position.set(s.x+c*x+n*z,y,-s.y-n*x+c*z);o.rotation.y=s.angle;o.scale.set(w,h,d);o.updateMatrix();batches.get(mat).push(o.matrix.clone());
    };
    const totalCapacity=facilities.reduce((n,s)=>n+s.capacity,0),people=[];
    const peopleBudget=low?500:1800;
    for(const s of facilities){
      const d=s.depth,w=s.length;
      if(s.kind==='seated'){
        const steps=Math.min(24,s.rows),step=d/steps;
        for(let i=0;i<steps;i++){
          const h=(i+1)*s.rows/steps*.4,z=-d/2+(i+.5)*step;
          add(concrete,s,0,h/2,z,w,h,step);
          add(occupancy?filled:seats,s,0,h+.08,z,w,.16,step*.75);
        }
      }else if(s.kind==='free'){
        add(lawn,s,0,.12,0,w,.24,d);
        for(const x of [-w/2,w/2])add(concrete,s,x,.65,0,.15,1.3,d);
      }else{
        add(vip,s,0,1.8,0,w,3.6,d);add(glass,s,0,2,-d/2-.02,w*.95,1.7,.12);
        add(concrete,s,0,3.75,0,w+1,.3,d+1);
      }
      // Representative instanced people plus seating detail keep the real capacity unlimited.
      const count=Math.floor(peopleBudget*occupancy*s.capacity/Math.max(1,totalCapacity));
      for(let i=0;i<count;i++){
        const x=(rand()-.5)*w*.94,z=(rand()-.5)*d*.9;
        const step=Math.floor((z+d/2)/d*Math.min(24,s.rows));
        const h=s.kind==='seated'?(step+1)*s.rows/Math.min(24,s.rows)*.4:s.kind==='vip'?3.95:.24;
        const c=Math.cos(s.angle),n=Math.sin(s.angle);
        people.push({x:s.x+c*x+n*z,y:h,z:-s.y-n*x+c*z,col:new THREE.Color().setHSL(rand(),.5,.45+rand()*.2)});
      }
    }
    const cube=new THREE.BoxGeometry(1,1,1);
    venueResources.push(concrete,seats,lawn,vip,glass,filled,crowdTex,cube);
    for(const[mat,matrices]of batches){const mesh=new THREE.InstancedMesh(cube,mat,matrices.length);matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=!low;mesh.receiveShadow=true;mesh.userData.venue=true;scene.add(mesh);}
    if(people.length){
      const body=new THREE.InstancedMesh(new THREE.BoxGeometry(.42,.85,.3),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),people.length);
      const heads=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.16,0),new THREE.MeshStandardMaterial({color:0xd2ac8b,roughness:1}),people.length),m=new THREE.Matrix4();
      people.forEach((p,i)=>{m.makeTranslation(p.x,p.y+.6,p.z);body.setMatrixAt(i,m);body.setColorAt(i,p.col);m.makeTranslation(p.x,p.y+1.2,p.z);heads.setMatrixAt(i,m);});
      body.userData.venueCrowd=true;heads.userData.venueCrowd=true;scene.add(body,heads);
    }
  }
  // trees, away from the track
  { const cell = 40, grid = new Map();
    for (let i = 0; i < N; i += 2) { const key = Math.floor(T.x[i] / cell) + ',' + Math.floor(T.y[i] / cell); (grid.get(key) || grid.set(key, []).get(key)).push(i); }
    const near = (x, y, d) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell); for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const l = grid.get((cx + a) + ',' + (cy + b)); if (l) for (const i of l) if (Math.hypot(T.x[i] - x, T.y[i] - y) < d) return true; } return false; };
    const r = mulberry(77), pts = [];
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < N; i++) { minx = Math.min(minx, T.x[i]); maxx = Math.max(maxx, T.x[i]); miny = Math.min(miny, T.y[i]); maxy = Math.max(maxy, T.y[i]); }
    for (let tries = 0; tries < 9000 && pts.length < (low ? 240 : 500); tries++) {
      const x = minx - 260 + r() * (maxx - minx + 520), y = miny - 260 + r() * (maxy - miny + 520);
      if (!near(x, y, hw + T.runoff + 22) && !facilities.some(s=>{const dx=x-s.x,dy=y-s.y,c=Math.cos(s.angle),n=Math.sin(s.angle);return Math.abs(dx*c+dy*n)<s.length/2+6&&Math.abs(-dx*n+dy*c)<s.depth/2+6;})) pts.push([x, y, 0.8 + r() * 1.1]);
    }
    const trunkG = new THREE.CylinderGeometry(.22,.40,4.2,6), crownG = new THREE.IcosahedronGeometry(1,1);
    const trunks = new THREE.InstancedMesh(trunkG,new THREE.MeshStandardMaterial({color:0x63503b,roughness:1}),pts.length);
    const crowns = new THREE.InstancedMesh(crownG,new THREE.MeshStandardMaterial({color:0x547544,roughness:1}),pts.length*2);
    const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),col=new THREE.Color();
    pts.forEach((p,i)=>{
      const s=p[2];
      m4.compose(new THREE.Vector3(p[0],2.1*s,-p[1]),q,new THREE.Vector3(s,s,s));trunks.setMatrixAt(i,m4);
      for(let k=0;k<2;k++) {
        m4.compose(new THREE.Vector3(p[0]+(k ? 1.0 : -.65)*s,(4.3+k*1.65)*s,-p[1]+(k ? -.4 : .4)*s),q,new THREE.Vector3((2.5-k*.3)*s,(2.1-k*.1)*s,(2.2+k*.1)*s));
        crowns.setMatrixAt(i*2+k,m4);col.setHSL(.26+(i%7)*.012,.28+(i%3)*.04,.29+(i%5)*.024);crowns.setColorAt(i*2+k,col);
      }
    });
    crowns.castShadow=!low;trunks.castShadow=!low;scene.add(trunks,crowns);
  }

  // Catch fencing and evenly spaced supports outside the concrete barriers.
  {
    const posts=[],wires=[];
    for(const side of [-1,1]) for(let i=0;i<N;i+=5) {
      if(!wallOk[side][i]||!wallOk[side][(i+5)%N])continue;
      const off=(hw+T.runoff+.25+(side<0?pitStep(i):0))*side,x=T.x[i]+T.nx[i]*off,z=-(T.y[i]+T.ny[i]*off);
      posts.push([x,z]);
      const j=(i+5)%N,offJ=(hw+T.runoff+.25+(side<0?pitStep(j):0))*side,bx=T.x[j]+T.nx[j]*offJ,bz=-(T.y[j]+T.ny[j]*offJ);
      for(const y of [1.6,2.1,2.6,3.1])wires.push(x,y,z,bx,y,bz);
      wires.push(x,1.3,z,x,3.1,z);
    }
    const mat=new THREE.MeshStandardMaterial({color:0x8d98a0,roughness:.6,metalness:.4});
    const mesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(.045,.055,2.0,5),mat,posts.length),m=new THREE.Matrix4();
    posts.forEach((p,i)=>{m.makeTranslation(p[0],2.15,p[1]);mesh.setMatrixAt(i,m);});scene.add(mesh);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(wires,3));scene.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x9aa6b0,transparent:true,opacity:.5})));
  }

  // Shared smooth bodywork for the garage, player and multiplayer cars.
  const factory = carFactory(THREE, low);
  const makeCar = factory.makeCar;

  const me = makeCar(0, opts.compound || 'M', opts.livery);
  scene.add(me.holder);
  const recovery=recoveryTruck(THREE,low);scene.add(recovery);
  const fade=document.createElement('div');fade.style.cssText='position:absolute;inset:0;background:#070b12;opacity:0;pointer-events:none';host.appendChild(fade);
  let events=[];
  const ghosts = new Map();
  function ghostCar(col, colors) {
    const c = makeCar(col, 'M', colors), materials = new Map();
    c.car.traverse(o => {
      if (!o.material) return;
      if (!materials.has(o.material)) {
        const material = o.material.clone(); material.transparent = true; material.opacity = 0.62;
        materials.set(o.material, material);
      }
      o.material = materials.get(o.material);
    });
    c.ghostMaterials = [...materials.values()]; scene.add(c.holder); return c;
  }

  // Nineteen solid opponents share one set of geometry and instanced draws.
  let fieldBatches=null;
  const fieldTransform=new THREE.Object3D(),fieldMatrix=new THREE.Matrix4();
  function setField(rows) {
    if(!fieldBatches){
      const model=factory.makeCar(0,'M');model.holder.updateMatrixWorld(true);fieldBatches=[];
      model.holder.traverse(o=>{
        if(!o.isMesh)return;
        const mat=o.material.clone(),hex=mat.color.getHex(),zone=mat.userData.paintZone,tyre=!zone&&hex===COMPOUND_COL.M;
        if(zone||tyre)mat.color.setHex(0xffffff);
        const mesh=new THREE.InstancedMesh(o.geometry,mat,20);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;
        scene.add(mesh);fieldBatches.push({mesh,local:o.matrixWorld.clone(),zone,baseColor:hex,tyre});
      });
      factory.release(model);
    }
    for(const batch of fieldBatches){
      batch.mesh.count=rows.length;
      rows.forEach((r,i)=>{
        fieldTransform.position.set(r.x,0,-r.y);fieldTransform.rotation.set(0,r.psi,0);fieldTransform.scale.setScalar(r.hidden?0:1);fieldTransform.updateMatrix();
        fieldMatrix.multiplyMatrices(fieldTransform.matrix,batch.local);batch.mesh.setMatrixAt(i,fieldMatrix);
        if(batch.zone||batch.tyre) {
          const palette=LIVERY[(r.col??1)%LIVERY.length];
          const base=batch.baseColor===LIVERY[0][0]?palette[0]:batch.baseColor===LIVERY[0][1]?palette[1]:batch.baseColor;
          batch.mesh.setColorAt(i,new THREE.Color(batch.tyre?(COMPOUND_COL[r.compound]||COMPOUND_COL.M):paintColor(r.livery,batch.zone,base)));
        }
      });
      batch.mesh.instanceMatrix.needsUpdate=true;if(batch.mesh.instanceColor)batch.mesh.instanceColor.needsUpdate=true;
    }
  }
  const safetyCar=new THREE.Group();
  const safetyBody=new THREE.Mesh(new THREE.BoxGeometry(4.5,1.05,1.9),new THREE.MeshStandardMaterial({color:0xd5dce4,roughness:.35,metalness:.5}));safetyBody.position.y=.8;safetyCar.add(safetyBody);
  const safetyCabin=new THREE.Mesh(new THREE.BoxGeometry(2.2,.7,1.65),new THREE.MeshStandardMaterial({color:0x293d50,roughness:.3}));safetyCabin.position.set(-.2,1.55,0);safetyCar.add(safetyCabin);
  const safetyLamp=new THREE.Mesh(new THREE.BoxGeometry(.7,.15,1.3),new THREE.MeshBasicMaterial({color:0xffb51b}));safetyLamp.position.y=2;safetyCar.add(safetyLamp);
  for(const x of [-1.4,1.4])for(const z of [-1,1]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.37,.37,.25,12),new THREE.MeshStandardMaterial({color:0x121820}));wheel.rotation.x=Math.PI/2;wheel.position.set(x,.4,z);safetyCar.add(wheel);}
  safetyCar.visible=false;scene.add(safetyCar);

  // ── weather: rain streaks, fog, sky colours ──
  const RAIN = 3200;
  const rainPos = new Float32Array(RAIN * 6);
  const rainSeed = []; { const r = mulberry(5); for (let i = 0; i < RAIN; i++) rainSeed.push([r() * 90 - 45, r() * 45, r() * 90 - 45]); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcc8d6, transparent: true, opacity: 0.5 }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  let rainAmt = 0, rainT = 0;
  const cond = { cloud: 0.2, rain: 0, water: 0, sun: 1, hour: 14 };
  function setConditions(c, hour) {
    Object.assign(cond, c, { hour });
    const sol = solar(hour), sinE = sol.sinE;
    sun.position.copy(sol.dir);
    skyMat.uniforms.sunDir.value.copy(sol.dir);
    moonDir.set(-sol.dir.x, Math.max(0.3, Math.min(0.85, 0.55 - sol.dir.y * 0.5)), -sol.dir.z).normalize();
    const cl = Math.min(1, c.cloud), wet = Math.min(1, c.water / 2);
    const el = clamp01(sinE / 0.75);                       // 0 at the horizon, 1 with the sun high
    const dayK = clamp01((sinE + 0.05) / 0.30), nightK = clamp01((-sinE - 0.02) / 0.16), twK = clamp01((sinE + 0.1) / 0.25);
    const warm = Math.pow(1 - clamp01(sinE / 0.5), 2) * (1 - nightK);
    const top = new THREE.Color(0x2763c8).lerp(new THREE.Color(0x66707c), cl * 0.85).lerp(new THREE.Color(0x4a4f7a), warm * 0.5);
    const hor = new THREE.Color(0xbcd8f0).lerp(new THREE.Color(0xa7aeb6), cl * 0.9).lerp(new THREE.Color(0xf0b58a), warm * 0.6 * (1 - cl * 0.6));
    top.lerp(new THREE.Color(0x050a1c), nightK); hor.lerp(new THREE.Color(0x101c3a).lerp(new THREE.Color(0x2a2630), cl * 0.7), nightK);
    skyMat.uniforms.top.value.copy(top); skyMat.uniforms.hor.value.copy(hor);
    skyMat.uniforms.sunAmt.value = (1 - cl) * (1 - wet) * (1 - nightK);
    const dim = 1 - el;     // low sun (dawn, dusk): lift the light so the track and the car stay readable
    const sunFade = clamp01((sinE + 0.02) / 0.1);
    sun.intensity = ((0.4 + el * 2.4) * (1 - cl * 0.75) + dim * 0.6 * (1 - cl * 0.5)) * sunFade;
    sun.color.set(0xffffff).lerp(new THREE.Color(0xffc48a), warm * 0.7);
    const dayHemi = 1.0 + el * 0.5 + cl * 0.15 + dim * 0.55;
    hemi.intensity = 0.6 + (dayHemi - 0.6) * twK; hemi.color.copy(hor).lerp(new THREE.Color(0xe2e9f2), .45 * (1 - nightK)).lerp(new THREE.Color(0x3a4c82), nightK * 0.6);
    moonLight.color.set(0x9fb5ff); moonLight.intensity = 0.6 * nightK * (1 - cl * 0.6);
    scene.fog = new THREE.FogExp2(hor.clone().multiplyScalar(0.92), 0.00035 + 0.0013 * c.rain + 0.0004 * cl);
    renderer.toneMappingExposure = 0.95 + (1 - cl) * 0.1 + dim * 0.25 + nightK * 0.3;
    trackMat.roughness = 0.92 - 0.66 * wet; trackMat.color.setScalar(1 - 0.45 * wet);
    trackMat.metalness = 0.15 * wet;
    // a clear sky has no clouds at all; the more cloud the forecast says, the more of them there are and the thicker they get
    const cloudTone = (1 - cl * 0.45) * (1 - 0.93 * nightK) + 0.02;
    clouds.forEach(m => { const k = m.userData.k; m.material.opacity = clamp01((cl - k * 0.85) * 3.5) * (0.55 + 0.45 * k) * (1 - 0.45 * nightK); m.material.color.setScalar(cloudTone).lerp(new THREE.Color(0x0a0f1c), nightK * 0.8); });
    stars.visible = nightK > 0.02 && cl < 0.95; stars.material.opacity = nightK * Math.pow(1 - cl, 1.5) * 0.95;
    moon.visible = nightK > 0.02 && cl < 0.9; moon.material.opacity = nightK * (1 - cl * 0.9);
    lampK = 1 - dayK; glow.visible = lampK > 0.02; glow.material.opacity = lampK * 0.75;
    headMat.color.set(0x555555).lerp(new THREE.Color(0xfff0c8), lampK);
    rainAmt = c.rain; rain.visible = c.rain > 0.02; rainGeo.setDrawRange(0, Math.floor(RAIN * 2 * Math.min(1, c.rain * 1.3)));
  }

  // ── telemetry & playback ──
  let frames = null, nFrames = 0;
  const S = { x: 0, y: 0, psi: 0, u: 0, v: 0, delta: 0, ay: 0, ax: 0, thr: 0, brk: 0, gear: 1, rpm: 0, lap: 0, idx: 0, t: 0, i: 0, wheelPhase: 0 };
  function setRun(fr) { frames = fr; S.wheelPhase = 0; }
  function sample(t) {
    nFrames = frames ? frames.length / FRAME : 0;
    if (!frames || nFrames < 2) return S;
    const dt = 1 / 30;
    let f = Math.max(0, Math.min(nFrames - 1.0001, t / dt));
    const i = Math.floor(f), k = f - i, a = i * FRAME, b = a + FRAME;
    const L = n => frames[a + n] + (frames[b + n] - frames[a + n]) * k;
    S.x = L(F.x); S.y = L(F.y);
    let dp = frames[b + F.psi] - frames[a + F.psi]; while (dp > Math.PI) dp -= 2 * Math.PI; while (dp < -Math.PI) dp += 2 * Math.PI;
    S.psi = frames[a + F.psi] + dp * k;
    S.fuel = L(F.fuel); S.u = L(F.u); S.v = L(F.v); S.delta = L(F.delta); S.ay = L(F.ay); S.ax = L(F.ax); S.thr = L(F.thr); S.brk = L(F.brk);
    S.pit = frames[a + F.pit]; S.sec = frames[a + F.sec];
    S.gear = frames[a + F.gear]; S.rpm = L(F.rpm); S.lap = frames[a + F.lap]; S.idx = frames[a + F.idx]; S.t = t; S.i = i;
    S.fr = a;
    return S;
  }
  const carPos = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();
  function place(c, x, y, psi, o) {
    c.holder.position.set(x, 0, -y); c.holder.rotation.y = psi;
    if (o) { c.car.rotation.x = -o.roll || 0; c.car.rotation.z = o.pitch || 0; }
    else { c.car.rotation.x = 0; c.car.rotation.z = 0; }
  }

  // ── floodlights: poles along the circuit; a few real lights follow the car, the rest are glow points ──
  const lampPts = [];
  { const step = Math.max(1, Math.round(80 / T.ds));
    for (let i = 0, j = 0; i < N; i += step, j++) {
      const side = j % 2 ? 1 : -1, off = hw + 9;
      lampPts.push({ cx: T.x[i], cz: -T.y[i], x: T.x[i] + T.nx[i] * side * off, z: -(T.y[i] + T.ny[i] * side * off), hx: T.x[i] + T.nx[i] * side * (off - 3.5), hz: -(T.y[i] + T.ny[i] * side * (off - 3.5)) });
    } }
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 16, 6), new THREE.MeshStandardMaterial({ color: 0x3b4047, roughness: 0.8, metalness: 0.4 }), lampPts.length);
  const headMat = new THREE.MeshBasicMaterial({ color: 0x555555, toneMapped: false });
  const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.3, 1.1), headMat, lampPts.length);
  { const m = new THREE.Matrix4(); lampPts.forEach((p, i) => { m.makeTranslation(p.x, 8, p.z); poleMesh.setMatrixAt(i, m); m.makeTranslation(p.hx, 16.1, p.hz); headMesh.setMatrixAt(i, m); }); }
  poleMesh.frustumCulled = false; headMesh.frustumCulled = false; poleMesh.castShadow = !low; scene.add(poleMesh); scene.add(headMesh);
  const glowGeo = new THREE.BufferGeometry(); glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPts.flatMap(p => [p.hx, 16.1, p.hz]), 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: cloudTex, color: 0xffe2b0, size: 16, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.frustumCulled = false; glow.visible = false; scene.add(glow);
  const spots = Array.from({ length: low ? 5 : 9 }, () => { const l = new THREE.SpotLight(0xffe6c0, 0, 0, 1.45, 0.55, 1); scene.add(l); scene.add(l.target); return l; });
  let lampK = 0;
  function updateLamps() {
    spots.forEach(l => { l.intensity = 0; });
    if (lampK <= 0.01 || !lampPts.length) return;
    const cz = -S.y, near = lampPts.map((p, i) => [(p.x - S.x) ** 2 + (p.z - cz) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, spots.length);
    near.forEach(([, i], k) => { const p = lampPts[i], l = spots[k]; l.position.set(p.hx, 18, p.hz); l.target.position.set(p.cx, 0, p.cz); l.intensity = 85 * lampK; });
  }

  // ── cameras ──
  let camMode = 'chase', orbit = { yaw: 0.6, pitch: 0.28, dist: 11 };
  const cams = ['chase', 'cockpit', 'tv', 'heli', 'nose', 'orbit'];
  const posts = [];
  for (let i = 0; i < N; i += 100) {
    const k = T.kappa[i];
    const side = Math.abs(k) > 1 / 700 ? -Math.sign(k) : (i / 100 % 2 ? 1 : -1);
    posts.push({ x: T.x[i] + T.nx[i] * side * (hw + 26), y: T.y[i] + T.ny[i] * side * (hw + 26), h: 5 + (i / 100 % 3) * 3 });
  }
  let camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camInit = false, tvPost = 0;
  function setCamera(m) { if (cams.includes(m)) { camMode = m; camInit = false; } }

  function updateCamera(dt) {
    const cx = S.x, cy = S.y, ps = S.psi;
    me.holder.updateMatrixWorld(true);
    const speed = Math.hypot(S.u, S.v);
    let fov = 58 + Math.min(14, speed * 0.1);
    let tp = tmp, tl = look;
    const fx = Math.cos(ps), fy = Math.sin(ps);
    if (camMode === 'chase') {
      tp.set(cx - fx * (8.5 + speed * 0.015), 3.0 + speed * 0.01, -(cy - fy * (8.5 + speed * 0.015)));
      tl.set(cx + fx * 9, 0.7, -(cy + fy * 9));
    } else if (camMode === 'cockpit') {
      const e = new THREE.Vector3(0.1, 0.9, 0).applyMatrix4(me.car.matrixWorld);
      tp.copy(e); tl.copy(new THREE.Vector3(14, 0.55 - S.delta * 0, -S.delta * 12).applyMatrix4(me.car.matrixWorld));
      fov = 78 + Math.min(14, speed * 0.08);
    } else if (camMode === 'nose') {
      tp.copy(new THREE.Vector3(2.6, 0.5, 0).applyMatrix4(me.car.matrixWorld));
      tl.copy(new THREE.Vector3(30, 0.3, 0).applyMatrix4(me.car.matrixWorld)); fov = 96;
    } else if (camMode === 'heli') {
      const a = performance.now() / 9000;
      tp.set(cx + Math.cos(a) * 30, 85, -(cy + Math.sin(a) * 30)); tl.set(cx, 0, -cy); fov = 52;
    } else if (camMode === 'tv') {
      let best = tvPost, bd = 1e9;
      for (let i = 0; i < posts.length; i++) { const d = Math.hypot(posts[i].x - cx, posts[i].y - cy); if (d < bd - (i === tvPost ? 0 : 25)) { bd = d; best = i; } }
      tvPost = best; const p = posts[best];
      tp.set(p.x, p.h, -p.y); tl.set(cx, 0.8, -cy);
      fov = Math.max(14, Math.min(60, 2 * Math.atan(7 / Math.max(10, bd)) * 180 / Math.PI * 2.4));
    } else {
      tp.set(cx + Math.cos(orbit.yaw + ps) * Math.cos(orbit.pitch) * orbit.dist, 0.8 + Math.sin(orbit.pitch) * orbit.dist, -(cy + Math.sin(orbit.yaw + ps) * Math.cos(orbit.pitch) * orbit.dist));
      tl.set(cx, 0.6, -cy);
    }
    const k = (camMode === 'cockpit' || camMode === 'nose') ? 1 : (camMode === 'chase' ? 1 - Math.exp(-dt * 7) : 1 - Math.exp(-dt * 5));
    if (!camInit) { camPos.copy(tp); camLook.copy(tl); camInit = true; }
    camPos.lerp(tp, k); camLook.lerp(tl, camMode === 'tv' ? 1 - Math.exp(-dt * 9) : k);
    camera.position.copy(camPos); camera.lookAt(camLook);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    me.helmet.visible = camMode !== 'cockpit'; me.halo.visible = camMode !== 'cockpit' && camMode !== 'nose';
  }

  // pointer drag for the orbit camera
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', e => { if (camMode === 'orbit') { drag = [e.clientX, e.clientY]; renderer.domElement.setPointerCapture(e.pointerId); } });
  renderer.domElement.addEventListener('pointermove', e => { if (drag) { orbit.yaw -= (e.clientX - drag[0]) * 0.008; orbit.pitch = Math.max(0.05, Math.min(1.4, orbit.pitch + (e.clientY - drag[1]) * 0.006)); drag = [e.clientX, e.clientY]; } });
  renderer.domElement.addEventListener('pointerup', () => { drag = null; });
  renderer.domElement.addEventListener('wheel', e => { if (camMode === 'orbit') { orbit.dist = Math.max(5, Math.min(40, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08))); e.preventDefault(); } }, { passive: false });

  // ── frame ──
  let raf = 0, last = performance.now(), dead = false;
  const view = {
    el: renderer.domElement, cams, sample, S, setRun, setConditions, setCamera,
    setSite(o) { Object.assign(site, o || {}); setConditions(cond, cond.hour); },
    setEvents(e) { events=e || []; },
    setField,
    setSafetyCar(p) {safetyCar.visible=!!p;if(p){safetyCar.position.set(p.x,0,-p.y);safetyCar.rotation.y=p.psi;safetyLamp.visible=Math.floor(performance.now()/200)%2===0;}},
    get camera() { return camMode; },
    onTick: null,
    lights(n) { view_lights.forEach((l, i) => l.material.color.setHex(i < n ? 0xff1a1a : 0x330000)); },
    setCompound(c) { me.wheels.forEach(w => w.spin.children[1].material.color.setHex(COMPOUND_COL[c] || 0xf2c230)); },
    setLivery(colors) { factory.setLivery(me,colors); },
    setColor(i) { /* the player's own car keeps colour 0 */ void i; },
    park(idx) { const i = ((idx % N) + N) % N; S.x = T.x[i] + T.nx[i] * -3; S.y = T.y[i] + T.ny[i] * -3; S.psi = T.psi[i]; S.u = 0; S.v = 0; S.delta = 0; S.ax = 0; S.ay = 0; S.idx = i; },
    ghost(pid, g) {
      let c = ghosts.get(pid);
      if (!c) { c = { car: ghostCar(g.livery ? 0 : (g.col ?? 1), g.livery), tx: g.x, ty: g.y, tp: g.psi, x: g.x, y: g.y, p: g.psi, name: g.name || '', at: performance.now() }; ghosts.set(pid, c); }
      factory.setLivery(c.car,g.livery);
      c.tx = g.x; c.ty = g.y; c.tp = g.psi; c.at = performance.now(); c.name = g.name || c.name;
    },
    removeGhost(pid) {
      const c = ghosts.get(pid);
      if (c) { scene.remove(c.car.holder); c.car.ghostMaterials.forEach(m => m.dispose()); factory.release(c.car); ghosts.delete(pid); }
    },
    clearGhosts() { for (const k of [...ghosts.keys()]) view.removeGhost(k); },
    ghostList() { return [...ghosts.entries()].map(([id, c]) => ({ id, x: c.x, y: c.y, name: c.name })); },
    resize() { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); },
    destroy() {
      dead = true; cancelAnimationFrame(raf);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) materials.add(m); });
      materials.forEach(m => { for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v); m.dispose(); });
      textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); factory.dispose();
      venueResources.forEach(r=>r.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); fade.remove();
    },
    project(x, y) { const v = new THREE.Vector3(x, 3, -y).project(camera); return { x: (v.x * 0.5 + 0.5) * W(), y: (-v.y * 0.5 + 0.5) * H(), ok: v.z < 1 && v.z > -1 }; },
  };
  function loop(now) {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (view.onTick) view.onTick(dt);
    const speed = Math.hypot(S.u, S.v);
    // car pose and its small, honest body movements
    place(me, S.x, S.y, S.psi, { roll: Math.max(-0.05, Math.min(0.05, S.ay * 0.0016)), pitch: Math.max(-0.04, Math.min(0.04, S.ax * 0.0010)) });
    S.wheelPhase += speed * dt / 0.36;
    me.wheels.forEach(w => { w.spin.rotation.z = -S.wheelPhase; if (w.front) w.g.rotation.y = S.delta * 0.9; });
    for (const [pid, c] of ghosts) {
      if (now - c.at > 4000) { view.removeGhost(pid); continue; }
      const k = 1 - Math.exp(-dt * 10); c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
      let dp = c.tp - c.p; while (dp > Math.PI) dp -= 2 * Math.PI; while (dp < -Math.PI) dp += 2 * Math.PI; c.p += dp * k;
      place(c.car, c.x, c.y, c.p);
    }
    if (view_crew) {
      view_crew.group.visible=S.pit===2;
      if(S.pit===2) {view_crew.group.position.set(S.x,0,-S.y);view_crew.group.rotation.y=S.psi;view_crew.update(S.t);}
    }
    const tow=events.findLast(e=>e.type==='recovery' && e.t<=S.t);
    recovery.visible=S.pit===3;
    if(recovery.visible && tow) {
      const age=S.t-tow.t,approach=Math.max(0,1-age/6)*18;
      if (age >= 15 && !recovery.userData.arrived) { camInit=false; recovery.userData.arrived=true; }
      if (age < 15) recovery.userData.arrived=false;
      recovery.position.set(S.x-Math.cos(S.psi)*approach,0,-S.y+Math.sin(S.psi)*approach);recovery.rotation.y=S.psi;
      me.holder.position.y=Math.min(.78,Math.max(0,(age-6)/3)*.78);
      // An explicit time cut covers transport to the garage; the car never
      // reappears on the racing line after outside assistance.
      fade.style.opacity=String(age<14 ? 0 : age<15 ? age-14 : age<15.4 ? 1 : Math.max(0,1-(age-15.4)));
    } else { me.holder.position.y=0;fade.style.opacity='0'; }
    updateCamera(dt);
    // sun and shadows follow the car
    sun.target.position.set(S.x, 0, -S.y); sun.position.copy(sun.target.position).addScaledVector(skyMat.uniforms.sunDir.value, 160);
    ground.position.x = S.x; ground.position.z = -S.y;
    ground.material.map.offset.set(S.x / 9000 * 260, S.y / 9000 * 260);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position); moon.position.copy(camera.position).addScaledVector(moonDir, 2200);
    moonLight.target.position.set(S.x, 0, -S.y); moonLight.position.copy(moonLight.target.position).addScaledVector(moonDir, 160);
    updateLamps();
    clouds.forEach(m => { m.position.x += dt * 2; if (m.position.x > camera.position.x + 2400) m.position.x -= 4800; });
    if (rain.visible) {
      rainT += dt;
      const cp = camera.position;
      for (let i = 0; i < RAIN; i++) {
        const s = rainSeed[i];
        const y = ((s[1] - rainT * 26) % 45 + 45) % 45;
        const x = cp.x + s[0], z = cp.z + s[2];
        rainPos[i * 6] = x; rainPos[i * 6 + 1] = cp.y - 10 + y; rainPos[i * 6 + 2] = z;
        rainPos[i * 6 + 3] = x - 0.04 * speed * Math.cos(S.psi) * 0.05; rainPos[i * 6 + 4] = cp.y - 10 + y + 1.1; rainPos[i * 6 + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    // A replay can keep advancing under another tab without drawing an invisible circuit.
    if (host.clientWidth && host.clientHeight) renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  setConditions({ cloud: 0.2, rain: 0, water: 0, sun: 1 }, 14);
  view.park(0);
  return view;
}
