// mvmOS App: BeamBuilder v1.0.0
const _bb18n = {
  en: {
    title: 'Beam Builder',
    newProject: 'New Project',
    saveProject: 'Save',
    loadProject: 'Projects',
    materials: 'Materials',
    addMaterial: 'Add Material',
    matName: 'Name',
    matW: 'W (mm)',
    matH: 'H (mm)',
    matColor: 'Color',
    add: 'Add',
    cancel: 'Cancel',
    selected: 'Selected',
    none: 'None',
    drawMode: 'Draw',
    selectMode: 'Select',
    deleteSelected: 'Delete',
    editSelected: 'Edit Length',
    duplicateSelected: 'Duplicate',
    materialList: 'Material Summary',
    noBeams: 'No beams yet',
    snap: 'Snap to ends',
    length: 'Length',
    cm: 'cm',
    mm: 'mm',
    pcs: 'pcs',
    total: 'Total',
    projectName: 'Project name',
    save: 'Save',
    close: 'Close',
    rename: 'Edit',
    delete: 'Delete',
    confirmDelete: 'Delete this beam?',
    floor: 'Floor grid',
    help: 'Click a point → click another to draw a beam. Orbit: right-drag. Zoom: scroll.',
    unsaved: 'Unsaved changes',
    loadConfirm: 'Load project? Unsaved changes will be lost.',
    deleteBeam: 'Delete beam',
    editLength: 'Edit length (cm)',
    applyLength: 'Apply',
    noProjects: 'No saved projects',
    dragEndRotate: '🟡 drag end → rotate 45°',
    dragEndRotateHint: '+ Ctrl = vertical tilt | + Shift = 1° | + Ctrl+Shift = height 1cm',
    dragMidMove: '⚪ drag center → move (50cm)',
    dragMidMoveHint: '+ Ctrl = up/down | + Shift = 1cm',
    rotateH: 'Horizontal rotation',
    rotateV: 'Vertical tilt',
    selectClick: 'Select: click a beam',
    drawSecond: 'Draw: click second point...',
    heightAt: 'height',
    price: 'Price',
    pricePerM2: 'Price per m² (H × Length)',
    stockLen: 'Stock length (m)',
    stockLenHint: 'e.g. 4 — leave empty to skip cutting plan',
    cuttingPlan: 'Cutting plan',
    stockPcs: 'bars needed',
    stockWaste: 'offcuts',
    stockBar: 'Bar',
    stockUsed: 'used',
    stockLeft: 'left',
    chooseTemplate: 'Choose a template',
    tplCustom: 'Custom (blank)',
    tplBeams: 'Beams & posts',
    tplBoards: 'Boards',
    tplSheets: 'Sheet materials',
  },
  bg: {
    title: 'Beam Builder',
    newProject: 'Нов проект',
    saveProject: 'Запази',
    loadProject: 'Проекти',
    materials: 'Материали',
    addMaterial: 'Добави материал',
    matName: 'Име',
    matW: 'Ш (мм)',
    matH: 'В (мм)',
    matColor: 'Цвят',
    add: 'Добави',
    cancel: 'Откажи',
    selected: 'Избрано',
    none: 'Няма',
    drawMode: 'Чертай',
    selectMode: 'Избери',
    deleteSelected: 'Изтрий',
    editSelected: 'Промени дължина',
    duplicateSelected: 'Дублирай',
    materialList: 'Разчет материали',
    noBeams: 'Няма греди',
    snap: 'Прилепване към краища',
    length: 'Дължина',
    cm: 'см',
    mm: 'мм',
    pcs: 'бр',
    total: 'Общо',
    projectName: 'Име на проект',
    save: 'Запази',
    close: 'Затвори',
    rename: 'Редактирай',
    delete: 'Изтрий',
    confirmDelete: 'Изтрий тази греда?',
    floor: 'Мрежа на пода',
    help: 'Кликни точка → кликни друга за да начертаеш греда. Орбита: десен бутон или докосни. Зуум: scroll.',
    unsaved: 'Незапазени промени',
    loadConfirm: 'Зареди проект? Незапазените промени ще се загубят.',
    deleteBeam: 'Изтрий греда',
    editLength: 'Промени дължина (см)',
    applyLength: 'Приложи',
    noProjects: 'Няма запазени проекти',
    dragEndRotate: '🟡 влачи край → въртене 45°',
    dragEndRotateHint: '+ Ctrl = вертикално | + Shift = 1° | + Ctrl+Shift = височина 1см',
    dragMidMove: '⚪ влачи среда → мести (50см)',
    dragMidMoveHint: '+ Ctrl = нагоре/надолу | + Shift = 1см',
    rotateH: 'Хоризонтално въртене',
    rotateV: 'Вертикален наклон',
    selectClick: 'Избери: кликни греда за избор',
    drawSecond: 'Чертай: кликни втора точка...',
    heightAt: 'височина',
    price: 'Цена',
    pricePerM2: 'Цена за м² (В × Дължина)',
    stockLen: 'Продажна дължина (м)',
    stockLenHint: 'напр. 4 — остави празно за да пропуснеш',
    cuttingPlan: 'План за рязане',
    stockPcs: 'броя за купуване',
    stockWaste: 'остатъци',
    stockBar: 'Греда',
    stockUsed: 'използвано',
    stockLeft: 'остатък',
    chooseTemplate: 'Избери шаблон',
    tplCustom: 'По избор (празен)',
    tplBeams: 'Греди и колони',
    tplBoards: 'Дъски',
    tplSheets: 'Плоскости (листи)',
  }
};
function _bbt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_bb18n[lang] || _bb18n.en)[key] || key;
}

mvmOS.registerApp({
  id: 'beambuilder',
  name: _bbt('title'),
  icon: '🏗️',
  category: 'Utilities',
  launch() {
    mvmOS.createWindow({
      id: 'beambuilder',
      title: '🏗️ ' + _bbt('title'),
      width: 1000,
      height: 700,
      onMount(body) {
        body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:#e0e0e0;font-family:system-ui,sans-serif;user-select:none';
        body.innerHTML = _bbHTML();
        _bbInit(body);
      }
    });
  }
});

function _bbHTML() {
  return `
<div id="bb-root" style="display:flex;flex-direction:column;height:100%;overflow:hidden">
  <!-- Toolbar -->
  <div id="bb-toolbar" style="flex:0;display:flex;align-items:center;gap:6px;padding:5px 8px;background:#12122a;border-bottom:1px solid #2a2a4a;flex-wrap:wrap;z-index:10">
    <button class="bb-btn" id="bb-btn-new">📄 ${_bbt('newProject')}</button>
    <button class="bb-btn" id="bb-btn-save">💾 ${_bbt('saveProject')}</button>
    <button class="bb-btn" id="bb-btn-load">📂 ${_bbt('loadProject')}</button>
    <div style="width:1px;height:22px;background:#2a2a4a;margin:0 2px"></div>
    <button class="bb-btn bb-btn-toggle active" id="bb-btn-draw" title="${_bbt('drawMode')}">✏️ ${_bbt('drawMode')}</button>
    <button class="bb-btn bb-btn-toggle" id="bb-btn-select" title="${_bbt('selectMode')}">↖️ ${_bbt('selectMode')}</button>
    <div style="width:1px;height:22px;background:#2a2a4a;margin:0 2px"></div>
    <button class="bb-btn" id="bb-btn-delete-sel" style="display:none;color:#f87171">🗑️ ${_bbt('deleteSelected')}</button>
    <button class="bb-btn" id="bb-btn-edit-sel" style="display:none">📐 ${_bbt('editSelected')}</button>
    <button class="bb-btn" id="bb-btn-dup-sel" style="display:none">⧉ ${_bbt('duplicateSelected')}</button>
    <div style="flex:1"></div>
    <label style="font-size:.75rem;color:#888;display:flex;align-items:center;gap:4px">
      <input type="checkbox" id="bb-snap" checked> ${_bbt('snap')}
    </label>
    <label style="font-size:.75rem;color:#888;display:flex;align-items:center;gap:4px">
      <input type="checkbox" id="bb-floor" checked> ${_bbt('floor')}
    </label>
    <select id="bb-unit" style="background:#252545;color:#ccc;border:1px solid #3a3a6a;border-radius:5px;padding:3px 6px;font-size:.78rem;cursor:pointer">
      <option value="cm">cm</option>
      <option value="in">in</option>
      <option value="m">m</option>
    </select>
  </div>

  <!-- Main area -->
  <div style="flex:1;display:flex;overflow:hidden">
    <!-- Left panel: materials -->
    <div id="bb-panel" style="width:180px;min-width:180px;background:#12122a;border-right:1px solid #2a2a4a;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:6px 8px;font-size:.72rem;text-transform:uppercase;color:#666;border-bottom:1px solid #2a2a4a;letter-spacing:.05em">${_bbt('materials')}</div>
      <div id="bb-mat-list" style="flex:1;overflow-y:auto;padding:4px"></div>
      <div style="padding:6px">
        <button class="bb-btn" id="bb-btn-add-mat" style="width:100%">+ ${_bbt('addMaterial')}</button>
      </div>
      <div style="border-top:1px solid #2a2a4a;padding:6px 8px;font-size:.72rem;text-transform:uppercase;color:#666;letter-spacing:.05em">${_bbt('materialList')}</div>
      <div id="bb-summary" style="padding:4px 8px 8px;font-size:.75rem;color:#aaa;overflow-y:auto;max-height:160px"></div>
    </div>

    <!-- 3D canvas -->
    <div id="bb-canvas-wrap" style="flex:1;position:relative;overflow:hidden;background:#0d0d1a">
      <canvas id="bb-canvas" style="display:block;width:100%;height:100%"></canvas>
      <!-- Status bar overlay -->
      <div id="bb-status" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#aaa;font-size:.75rem;padding:4px 10px;border-radius:20px;pointer-events:none;white-space:nowrap">${_bbt('help')}</div>
      <!-- Ghost length label -->
      <div id="bb-ghost-label" style="position:absolute;display:none;background:rgba(0,0,0,.8);color:#ffd700;font-size:.8rem;padding:2px 7px;border-radius:8px;pointer-events:none"></div>
      <!-- Selected info -->
      <div id="bb-sel-info" style="position:absolute;top:8px;right:8px;display:none;background:rgba(18,18,42,.9);border:1px solid #2a2a4a;border-radius:8px;padding:8px 12px;font-size:.8rem;min-width:140px"></div>
    </div>
  </div>

  <!-- Modal backdrop -->
  <div id="bb-modal-bg" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center">
    <div id="bb-modal" style="background:#1e1e3a;border:1px solid #3a3a6a;border-radius:10px;padding:20px;min-width:260px;max-width:90%"></div>
  </div>
</div>

<style>
  .bb-btn{background:#252545;color:#ccc;border:1px solid #3a3a6a;border-radius:5px;padding:4px 10px;font-size:.78rem;cursor:pointer;white-space:nowrap}
  .bb-btn:hover{background:#303060}
  .bb-btn.active{background:#4a4aaa;color:#fff;border-color:#6a6aff}
  .bb-mat-card{padding:5px 7px;border-radius:6px;cursor:pointer;border:2px solid transparent;margin-bottom:3px;font-size:.78rem;display:flex;align-items:center;gap:6px}
  .bb-mat-card:hover{background:#252545}
  .bb-mat-card.selected{border-color:#6a6aff;background:#252550}
  .bb-mat-card .bb-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0}
  .bb-input{background:#0d0d1a;color:#ccc;border:1px solid #3a3a6a;border-radius:5px;padding:4px 8px;font-size:.82rem;width:100%;box-sizing:border-box}
  .bb-label{font-size:.75rem;color:#888;margin-bottom:3px;display:block}
</style>
`;
}

function _bbInit(body) {
  // ---- Load Three.js scripts dynamically from app folder ----
  const appBase = '/apps/beambuilder/';
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const threeAlreadyLoaded = typeof THREE !== 'undefined';
  const orbitAlreadyLoaded = typeof THREE !== 'undefined' && THREE.OrbitControls;

  const chain = threeAlreadyLoaded
    ? Promise.resolve()
    : loadScript(appBase + 'three.min.js');

  chain.then(() => {
    if (orbitAlreadyLoaded) return Promise.resolve();
    return loadScript(appBase + 'OrbitControls.js');
  }).then(() => {
    _bbStart(body);
  }).catch(err => {
    const wrap = body.querySelector('#bb-canvas-wrap');
    if (wrap) wrap.innerHTML = `<div style="padding:20px;color:#f87171">Failed to load 3D engine: ${err}</div>`;
  });
}

function _bbStart(body) {
  // ---- Unit helpers ----
  // Internal storage: always metres. Display converts to project unit.
  // unit: 'cm' | 'in' | 'm'
  const UNITS = {
    cm: { label: 'cm', fromM: v => v * 100, toM: v => v / 100, step: 1,    decimals: 0 },
    in: { label: 'in', fromM: v => v * 100, toM: v => v / 100, step: 1,    decimals: 0 },
    m:  { label: 'm',  fromM: v => v * 100, toM: v => v / 100, step: 1,    decimals: 0 },
  };
  // Default: system preference → cm, or inches if locale suggests imperial
  const sysUnit = (window.mvmOS?.units === 'imperial') ? 'in' : 'cm';

  function fmtLen(metres, forceUnit) {
    const u = UNITS[forceUnit || state.unit] || UNITS.cm;
    const val = u.fromM(metres);
    return Math.round(val) + ' ' + u.label;
  }
  function fmtLenVal(metres) {
    const u = UNITS[state.unit] || UNITS.cm;
    return Math.round(u.fromM(metres) / u.step) * u.step;
  }

  // ---- State ----
  const state = {
    materials: [],
    selectedMatId: null,
    beams: [],
    mode: 'draw',
    drawStart: null,
    selectedBeamId: null,
    snap: true,
    showFloor: true,
    dirty: false,
    currentProjectId: null,
    currentProjectName: null,
    nextBeamId: 1,
    unit: sysUnit,   // saved with project
  };

  // ---- DOM refs ----
  const canvas       = body.querySelector('#bb-canvas');
  const wrap         = body.querySelector('#bb-canvas-wrap');
  const matListEl    = body.querySelector('#bb-mat-list');
  const summaryEl    = body.querySelector('#bb-summary');
  const statusEl     = body.querySelector('#bb-status');
  const ghostLabel   = body.querySelector('#bb-ghost-label');
  const selInfoEl    = body.querySelector('#bb-sel-info');
  const modalBg      = body.querySelector('#bb-modal-bg');
  const modalEl      = body.querySelector('#bb-modal');
  const btnDraw      = body.querySelector('#bb-btn-draw');
  const btnSelect    = body.querySelector('#bb-btn-select');
  const btnDelSel    = body.querySelector('#bb-btn-delete-sel');
  const btnEditSel   = body.querySelector('#bb-btn-edit-sel');
  const btnDupSel    = body.querySelector('#bb-btn-dup-sel');
  const snapCb       = body.querySelector('#bb-snap');
  const floorCb      = body.querySelector('#bb-floor');

  // ---- Three.js setup ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x0d0d1a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d0d1a, 30, 80);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
  camera.position.set(5, 4, 7);
  camera.lookAt(0, 0, 0);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  // LEFT = disabled (used for draw/select/gizmo), RIGHT = orbit, MIDDLE = zoom
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enablePan = false;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Floor grid
  let floorGrid = _makeFloorGrid();
  scene.add(floorGrid);

  function _makeFloorGrid() {
    const g = new THREE.GridHelper(20, 40, 0x2a2a5a, 0x1a1a3a);
    g.position.y = 0;
    return g;
  }

  // Floor plane (invisible, for raycasting)
  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0;
  scene.add(floorPlane);

  // Ghost beam (preview while drawing)
  let ghostMesh = null;
  let ghostDot = null;

  // Start dot (yellow sphere)
  const startDotGeo = new THREE.SphereGeometry(0.06, 12, 12);
  const startDotMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  let startDot = new THREE.Mesh(startDotGeo, startDotMat);
  startDot.visible = false;
  scene.add(startDot);

  // Hover dot
  const hoverDotGeo = new THREE.SphereGeometry(0.05, 10, 10);
  const hoverDotMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa });
  let hoverDot = new THREE.Mesh(hoverDotGeo, hoverDotMat);
  hoverDot.visible = false;
  scene.add(hoverDot);

  // ---- Gizmo handles ----
  // handleStart (yellow), handleEnd (yellow), handleMid (white)
  const gizmoGroup = new THREE.Group();
  scene.add(gizmoGroup);

  function makeHandle(color, size = 0.09) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 14, 14),
      new THREE.MeshBasicMaterial({ color, depthTest: false })
    );
    m.renderOrder = 999;
    return m;
  }

  const gizmoHandleStart = makeHandle(0xffd700);
  const gizmoHandleEnd   = makeHandle(0xffd700);
  const gizmoHandleMid   = makeHandle(0xffffff, 0.07);
  gizmoGroup.add(gizmoHandleStart, gizmoHandleEnd, gizmoHandleMid);
  gizmoGroup.visible = false;

  // Drag state
  const drag = {
    active: false,
    type: null,       // 'start' | 'end' | 'mid'
    beam: null,
    startWorld: null, // Vector3 where drag began
    origStart: null,
    origEnd: null,
    plane: null,      // THREE.Plane for drag
  };

  function showGizmo(beam) {
    if (!beam) { gizmoGroup.visible = false; return; }
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    const mid = s.clone().add(e).multiplyScalar(0.5);
    gizmoHandleStart.position.copy(s);
    gizmoHandleEnd.position.copy(e);
    gizmoHandleMid.position.copy(mid);
    gizmoGroup.visible = true;
  }

  function hideGizmo() {
    gizmoGroup.visible = false;
    heightGroup.visible = false;
    heightLabelS.style.display = 'none';
    heightLabelE.style.display = 'none';
  }

  // ---- Height indicators ----
  const heightGroup = new THREE.Group();
  scene.add(heightGroup);
  heightGroup.visible = false;

  function makeDashedLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x00ffcc, dashSize: 0.06, gapSize: 0.04,
      transparent: true, opacity: 0.8, depthTest: false
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    line.computeLineDistances();
    return line;
  }

  const heightLineS = makeDashedLine();
  const heightLineE = makeDashedLine();
  heightGroup.add(heightLineS, heightLineE);

  // HTML labels for height values
  const heightLabelS = document.createElement('div');
  const heightLabelE = document.createElement('div');
  for (const lbl of [heightLabelS, heightLabelE]) {
    lbl.style.cssText = 'position:absolute;display:none;pointer-events:none;' +
      'background:rgba(0,0,0,.75);color:#00ffcc;font-size:.72rem;' +
      'padding:2px 6px;border-radius:4px;white-space:nowrap;z-index:20';
    wrap.appendChild(lbl);
  }

  function updateHeightLine(line, lbl, pt) {
    const heightCm = fmtLen(pt.y);

    if (pt.y < 0.001) {
      // On the floor — hide line but show "0 см" label at the point
      line.visible = false;
      const projected = new THREE.Vector3(pt.x, pt.y, pt.z).project(camera);
      const rect = canvas.getBoundingClientRect();
      const sx = (projected.x * 0.5 + 0.5) * rect.width;
      const sy = (-projected.y * 0.5 + 0.5) * rect.height;
      if (projected.z < 1) {
        lbl.style.display = 'block';
        lbl.style.left = (sx + 8) + 'px';
        lbl.style.top  = (sy - 14) + 'px';
        lbl.textContent = fmtLen(0);
      } else {
        lbl.style.display = 'none';
      }
      return;
    }

    line.visible = true;
    const pts = [new THREE.Vector3(pt.x, pt.y, pt.z), new THREE.Vector3(pt.x, 0, pt.z)];
    line.geometry.setFromPoints(pts);
    line.computeLineDistances();

    // Label at midpoint of the vertical line
    const mid = new THREE.Vector3(pt.x, pt.y / 2, pt.z);
    const projected = mid.clone().project(camera);
    const rect = canvas.getBoundingClientRect();
    const sx = (projected.x * 0.5 + 0.5) * rect.width;
    const sy = (-projected.y * 0.5 + 0.5) * rect.height;
    if (projected.z < 1) {
      lbl.style.display = 'block';
      lbl.style.left = (sx + 8) + 'px';
      lbl.style.top  = (sy - 10) + 'px';
      lbl.textContent = heightCm;
    } else {
      lbl.style.display = 'none';
    }
  }

  function showHeightIndicators(beam) {
    if (!beam) { heightGroup.visible = false; heightLabelS.style.display = 'none'; heightLabelE.style.display = 'none'; return; }
    heightGroup.visible = true;
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    updateHeightLine(heightLineS, heightLabelS, s);
    updateHeightLine(heightLineE, heightLabelE, e);
  }

  // Pick a drag plane perpendicular to the beam direction, facing camera
  function makeDragPlane(point) {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(camDir, point);
    return plane;
  }

  function getMouseWorld(event, plane) {
    const rect = canvas.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(mx, my), camera);
    const hit = new THREE.Vector3();
    r.ray.intersectPlane(plane, hit);
    return hit;
  }

  // Raycaster
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.12 };
  const mouse = new THREE.Vector2();

  // ---- Resize observer ----
  const ro = new ResizeObserver(() => _resize());
  ro.observe(wrap);
  function _resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  _resize();

  // ---- Animation loop ----
  let animId;
  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    // Update height label positions every frame (camera moves)
    if (heightGroup.visible) {
      const beam = state.beams.find(b => b.id === state.selectedBeamId);
      if (beam) {
        updateHeightLine(heightLineS, heightLabelS, new THREE.Vector3(...beam.start));
        updateHeightLine(heightLineE, heightLabelE, new THREE.Vector3(...beam.end));
      }
    }
  }
  animate();

  // ---- Cleanup on window close ----
  const win = body.closest('.window, [data-window-id]') || body.parentElement;
  const observer = new MutationObserver(() => {
    if (!document.contains(canvas)) {
      cancelAnimationFrame(animId);
      ro.disconnect();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ---- Helpers ----
  function getMat(id) { return state.materials.find(m => m.id === id); }

  function getSnapPoint(worldPos) {
    if (!state.snap) return worldPos.clone();
    let best = null, bestD = 0.25;
    for (const beam of state.beams) {
      for (const pt of [beam.start, beam.end]) {
        const v = new THREE.Vector3(...pt);
        const d = worldPos.distanceTo(v);
        if (d < bestD) { bestD = d; best = v.clone(); }
      }
    }
    return best || worldPos.clone();
  }

  // Snap end point to nearest 45° direction from start point
  function snapToAxis(startVec, endVec) {
    if (!startVec) return endVec.clone();
    const d = endVec.clone().sub(startVec);
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    const len = d.length();
    if (len < 0.001) return endVec.clone();

    // Determine dominant plane then snap angle to 45° steps
    if (ay <= ax * 0.42 && ay <= az * 0.42) {
      // XZ plane (horizontal) — snap angle in XZ
      let angle = Math.atan2(d.z, d.x);
      angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return startVec.clone().add(new THREE.Vector3(Math.cos(angle) * len, 0, Math.sin(angle) * len));
    } else if (ax <= ay * 0.42 && ax <= az * 0.42) {
      // YZ plane — snap angle in YZ
      let angle = Math.atan2(d.z, d.y);
      angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return startVec.clone().add(new THREE.Vector3(0, Math.cos(angle) * len, Math.sin(angle) * len));
    } else if (az <= ax * 0.42 && az <= ay * 0.42) {
      // XY plane — snap angle in XY
      let angle = Math.atan2(d.y, d.x);
      angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return startVec.clone().add(new THREE.Vector3(Math.cos(angle) * len, Math.sin(angle) * len, 0));
    } else {
      // Mixed — snap to dominant axis only (pure X, Y, or Z)
      if (ax >= ay && ax >= az) return startVec.clone().add(new THREE.Vector3(d.x, 0, 0));
      if (az >= ax && az >= ay) return startVec.clone().add(new THREE.Vector3(0, 0, d.z));
      return startVec.clone().add(new THREE.Vector3(0, d.y, 0));
    }
  }

  function getWorldPos(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Snap to existing beam endpoints first (screen-space proximity)
    if (state.snap) {
      let best = null, bestD = 0.06;
      for (const beam of state.beams) {
        for (const pt of [beam.start, beam.end]) {
          const v = new THREE.Vector3(...pt);
          const projected = v.clone().project(camera);
          const dx = projected.x - mouse.x, dy = projected.y - mouse.y;
          const screenD = Math.sqrt(dx*dx + dy*dy);
          if (screenD < bestD) { bestD = screenD; best = v.clone(); }
        }
      }
      if (best) return best;
    }

    // If drawing and start is set, also raycast two world-axis vertical planes through drawStart
    // so vertical (Y) beams and off-floor beams can be placed accurately
    if (state.drawStart) {
      // Plane 1: normal = world X  →  captures movement in Y-Z
      // Plane 2: normal = world Z  →  captures movement in X-Y
      // Pick the one whose normal is more perpendicular to camera view ray
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);

      const planeX = new THREE.Plane(new THREE.Vector3(1, 0, 0), -state.drawStart.x);
      const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), -state.drawStart.z);

      const hitX = new THREE.Vector3(), hitZ = new THREE.Vector3();
      const okX = raycaster.ray.intersectPlane(planeX, hitX);
      const okZ = raycaster.ray.intersectPlane(planeZ, hitZ);

      // Choose the plane whose normal is less parallel to ray (better intersection)
      const dotX = Math.abs(camDir.dot(new THREE.Vector3(1, 0, 0)));
      const dotZ = Math.abs(camDir.dot(new THREE.Vector3(0, 0, 1)));
      const vertHit = (dotX < dotZ && okX) ? hitX : (okZ ? hitZ : null);

      if (vertHit) {
        vertHit.x = Math.round(vertHit.x * 20) / 20;
        vertHit.y = Math.max(0, Math.round(vertHit.y * 20) / 20);
        vertHit.z = Math.round(vertHit.z * 20) / 20;

        // Use vertical hit only if it offers more Y displacement than the floor hit
        const floorHits = raycaster.intersectObject(floorPlane);
        const floorY = floorHits.length ? floorHits[0].point.y : 0;
        if (Math.abs(vertHit.y - state.drawStart.y) > Math.abs(floorY - state.drawStart.y) + 0.05) {
          return vertHit;
        }
      }
    }

    const hits = raycaster.intersectObject(floorPlane);
    if (hits.length) {
      const p = hits[0].point.clone();
      p.x = Math.round(p.x * 20) / 20;
      p.z = Math.round(p.z * 20) / 20;
      p.y = Math.max(0, Math.round(p.y * 20) / 20);
      return p;
    }
    return null;
  }

  function makeBeamMesh(start, end, mat) {
    const s = start instanceof THREE.Vector3 ? start.clone() : new THREE.Vector3(...start);
    const e = end instanceof THREE.Vector3 ? end.clone() : new THREE.Vector3(...end);
    const dir = e.clone().sub(s);
    const length = dir.length();
    if (length < 0.001) return null;

    const wm = mat.w / 1000;
    const hm = mat.h / 1000;
    // Geometry along X axis; bottom edge sits on the start→end line (offset +hm/2 in local Y)
    const geo = new THREE.BoxGeometry(length, hm, wm);
    geo.translate(0, hm / 2, 0); // shift so bottom face is at Y=0 in local space

    const color = new THREE.Color(mat.color);
    const matThree = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, matThree);

    const mid = s.clone().add(e).multiplyScalar(0.5);
    mesh.position.copy(mid);

    // Rotate to align X axis with beam direction
    const xAxis = new THREE.Vector3(1, 0, 0);
    const dirNorm = dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(xAxis, dirNorm);

    // Highlight edges
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
    const lines = new THREE.LineSegments(edges, lineMat);
    mesh.add(lines);

    return mesh;
  }

  function addBeam(start, end, matId) {
    const mat = getMat(matId);
    if (!mat) return;
    const s = start instanceof THREE.Vector3 ? start : new THREE.Vector3(...start);
    const e = end instanceof THREE.Vector3 ? end : new THREE.Vector3(...end);
    if (s.distanceTo(e) < 0.02) return;

    const mesh = makeBeamMesh(s, e, mat);
    if (!mesh) return;
    scene.add(mesh);

    const beam = {
      id: 'b' + (state.nextBeamId++),
      matId,
      start: [s.x, s.y, s.z],
      end: [e.x, e.y, e.z],
      mesh
    };
    state.beams.push(beam);
    state.dirty = true;
    updateSummary();
    return beam;
  }

  function removeBeam(id) {
    const idx = state.beams.findIndex(b => b.id === id);
    if (idx < 0) return;
    const beam = state.beams[idx];
    scene.remove(beam.mesh);
    beam.mesh.geometry.dispose();
    beam.mesh.material.dispose();
    state.beams.splice(idx, 1);
    state.dirty = true;
    updateSummary();
  }

  function duplicateBeam(id) {
    const beam = state.beams.find(b => b.id === id);
    if (!beam) return;
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    // Offset perpendicular to beam direction in horizontal plane, 0.5 m to the side
    const dir = e.clone().sub(s);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.5);
    if (perp.lengthSq() < 0.0001) perp.set(0.5, 0, 0); // fallback for vertical beams
    const ns = s.clone().add(perp);
    const ne = e.clone().add(perp);
    const newBeam = addBeam(ns, ne, beam.matId);
    if (newBeam) selectBeam(newBeam.id);
  }

  // Rotate beam around its center on a fixed world axis by exact degrees
  function rotateBeamAxis(beam, worldAxis, angleDeg) {
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    const center = s.clone().add(e).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromAxisAngle(worldAxis, angleDeg * Math.PI / 180);
    s.sub(center).applyQuaternion(q).add(center);
    e.sub(center).applyQuaternion(q).add(center);
    const r = v => Math.round(v * 10000) / 10000;
    beam.start = [r(s.x), r(s.y), r(s.z)];
    beam.end   = [r(e.x), r(e.y), r(e.z)];
    rebuildBeam(beam);
    state.dirty = true;
    updateSelUI();
    updateSummary();
  }

  function rotateBeam(beam, axis, angleDeg) {
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    const center = s.clone().add(e).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angleDeg * Math.PI / 180);
    s.sub(center).applyQuaternion(q).add(center);
    e.sub(center).applyQuaternion(q).add(center);
    // Round to avoid floating point drift
    const r = v => Math.round(v * 10000) / 10000;
    beam.start = [r(s.x), r(s.y), r(s.z)];
    beam.end   = [r(e.x), r(e.y), r(e.z)];
    rebuildBeam(beam);
    state.dirty = true;
    updateSelUI();
    updateSummary();
  }

  function rebuildBeam(beam) {
    const mat = getMat(beam.matId);
    if (!mat) return;
    scene.remove(beam.mesh);
    beam.mesh.geometry.dispose();
    beam.mesh.material.dispose();
    const mesh = makeBeamMesh(beam.start, beam.end, mat);
    if (!mesh) return;
    scene.add(mesh);
    beam.mesh = mesh;
    if (state.selectedBeamId === beam.id) {
      highlightBeam(beam, true);
      showGizmo(beam);
      showHeightIndicators(beam);
    }
  }

  function highlightBeam(beam, on) {
    if (!beam || !beam.mesh) return;
    beam.mesh.material.emissive = on ? new THREE.Color(0x3344aa) : new THREE.Color(0x000000);
    beam.mesh.material.emissiveIntensity = on ? 0.4 : 0;
  }

  function selectBeam(id) {
    if (state.selectedBeamId) {
      const old = state.beams.find(b => b.id === state.selectedBeamId);
      if (old) highlightBeam(old, false);
    }
    state.selectedBeamId = id;
    const beam = state.beams.find(b => b.id === id);
    if (beam) { highlightBeam(beam, true); showGizmo(beam); showHeightIndicators(beam); }
    else { hideGizmo(); showHeightIndicators(null); }
    updateSelUI();
  }

  function updateSelUI() {
    const beam = state.beams.find(b => b.id === state.selectedBeamId);
    if (!beam) {
      selInfoEl.style.display = 'none';
      btnDelSel.style.display = 'none';
      btnEditSel.style.display = 'none';
      btnDupSel.style.display = 'none';
      return;
    }
    btnDelSel.style.display = '';
    btnEditSel.style.display = '';
    btnDupSel.style.display = '';
    const mat = getMat(beam.matId);
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    const len = fmtLen(s.distanceTo(e));
    selInfoEl.style.display = 'block';
    selInfoEl.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${_bbt('selected')}</div>
      <div style="color:#888;font-size:.72rem">${mat ? mat.name : '?'}</div>
      <div style="margin-top:4px;margin-bottom:8px">${_bbt('length')}: <b>${len}</b></div>
      <div style="font-size:.7rem;color:#666;line-height:1.7">
        ${_bbt('dragEndRotate')}<br>
        <span style="color:#555">${_bbt('dragEndRotateHint')}</span><br>
        ${_bbt('dragMidMove')}<br>
        <span style="color:#555">${_bbt('dragMidMoveHint')}</span>
      </div>
    `;
  }

  function updateSummary() {
    if (!state.beams.length) {
      summaryEl.innerHTML = `<span style="color:#555">${_bbt('noBeams')}</span>`;
      return;
    }
    const groups = {};
    for (const beam of state.beams) {
      const mat = getMat(beam.matId);
      if (!mat) continue;
      const s = new THREE.Vector3(...beam.start);
      const e = new THREE.Vector3(...beam.end);
      const lenM = s.distanceTo(e);
      if (!groups[beam.matId]) groups[beam.matId] = { mat, totalM: 0, count: 0 };
      groups[beam.matId].totalM += lenM;
      groups[beam.matId].count++;
    }
    const u = UNITS[state.unit] || UNITS.cm;
    let grandTotal = 0;
    const rows = Object.values(groups).map(g => {
      const price = g.mat.price || 0;
      let qtyStr, cost;
      if (g.mat.pricePerM2) {
        const hm = g.mat.h / 1000;
        const totalM2 = hm * g.totalM;
        qtyStr = `<b style="color:#ffd700">${totalM2.toFixed(2)} m²</b>`;
        cost = price ? totalM2 * price : null;
      } else {
        qtyStr = `<b style="color:#ffd700">${fmtLen(g.totalM)}</b>`;
        if (price && g.mat.stockLen > 0) {
          const pieces = state.beams.filter(b => b.matId === g.mat.id).map(b => {
            const s = new THREE.Vector3(...b.start), e = new THREE.Vector3(...b.end);
            return s.distanceTo(e);
          });
          const bars = cuttingPlan(pieces, g.mat.stockLen);
          cost = bars.length * price;
        } else {
          cost = price ? g.totalM * price : null;
        }
      }
      if (cost) grandTotal += cost;
      const costStr = cost != null
        ? `<span style="color:#a0f0a0;margin-left:4px">= ${cost.toFixed(2)}</span>`
        : '';
      return `
        <div style="margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid #1a1a3a">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="display:inline-block;width:8px;height:8px;background:${g.mat.color};border-radius:2px"></span>
            <span style="color:#ccc">${g.mat.name}</span>
          </div>
          <div style="color:#888;margin-top:2px">
            ${g.count} ${_bbt('pcs')} · ${qtyStr}${costStr}
          </div>
        </div>`;
    });
    const totalRow = grandTotal > 0
      ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #3a3a5a;color:#a0f0a0;font-size:.78rem"><b>${_bbt('total')}: ${grandTotal.toFixed(2)}</b></div>`
      : '';

    // Cutting plan rows — only for materials with stockLen set
    const cutRows = Object.values(groups).filter(g => g.mat.stockLen > 0).map(g => {
      const hm = g.mat.h / 1000;
      const isSheet = g.mat.pricePerM2;
      const pieces = state.beams
        .filter(b => b.matId === g.mat.id)
        .map(b => {
          const s = new THREE.Vector3(...b.start), e = new THREE.Vector3(...b.end);
          return s.distanceTo(e);
        });
      const bars = cuttingPlan(pieces, g.mat.stockLen);
      const barRows = bars.map((bar, i) => {
        const usedStr = bar.used.map(p => fmtLen(p)).join(' + ');
        const leftStr = fmtLen(bar.left);
        const leftExtra = isSheet && bar.left > 0.001 ? ` = ${(bar.left * hm).toFixed(2)} m²` : '';
        const leftColor = bar.left < 0.05 ? '#555' : '#f0c060';
        return `<div style="font-size:.7rem;color:#888;margin-top:2px">
          <span style="color:#aaa">${_bbt('stockBar')} ${i+1}:</span> ${usedStr}
          <span style="color:${leftColor};margin-left:4px">(${_bbt('stockLeft')}: ${leftStr}${leftExtra})</span>
        </div>`;
      }).join('');
      const stockLabel = isSheet
        ? `${fmtLen(g.mat.stockLen, 'm')} × ${fmtLen(hm)} = ${(g.mat.stockLen * hm).toFixed(2)} m²`
        : fmtLen(g.mat.stockLen);
      return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1a1a3a">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
          <span style="display:inline-block;width:8px;height:8px;background:${g.mat.color};border-radius:2px"></span>
          <span style="color:#ccc;font-size:.75rem">${g.mat.name} — ${_bbt('cuttingPlan')}</span>
        </div>
        <div style="color:#ffd700;font-size:.75rem"><b>${bars.length} ${_bbt('stockPcs')}</b> × ${stockLabel}</div>
        ${barRows}
      </div>`;
    }).join('');

    summaryEl.innerHTML = rows.join('') + totalRow + cutRows;
  }

  // First Fit Decreasing cutting plan — returns array of bars, each with list of pieces and leftover
  function cuttingPlan(pieces, stockLen) {
    const sorted = [...pieces].sort((a, b) => b - a);
    const bars = []; // each bar: { used: [], left: stockLen }
    for (const piece of sorted) {
      if (piece > stockLen) continue; // piece longer than stock — skip
      let placed = false;
      for (const bar of bars) {
        if (bar.left >= piece - 0.0001) {
          bar.used.push(piece);
          bar.left -= piece;
          placed = true;
          break;
        }
      }
      if (!placed) bars.push({ used: [piece], left: stockLen - piece });
    }
    return bars;
  }

  // ---- Context menu ----
  let ctxMenu = null;
  function hideCtxMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }
  document.addEventListener('click', hideCtxMenu);

  function showCtxMenu(x, y, items) {
    hideCtxMenu();
    ctxMenu = document.createElement('div');
    ctxMenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#1e1e3a;border:1px solid #3a3a6a;border-radius:7px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,.5)`;
    for (const item of items) {
      const row = document.createElement('div');
      row.style.cssText = `padding:7px 14px;font-size:.8rem;cursor:pointer;color:${item.danger ? '#f87171' : '#ccc'};display:flex;align-items:center;gap:8px`;
      row.innerHTML = `<span>${item.icon || ''}</span><span>${item.label}</span>`;
      row.addEventListener('mouseenter', () => row.style.background = '#2a2a5a');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', e => { e.stopPropagation(); hideCtxMenu(); item.action(); });
      ctxMenu.appendChild(row);
    }
    document.body.appendChild(ctxMenu);
    // Keep in viewport
    const r = ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth)  ctxMenu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top = (y - r.height) + 'px';
  }

  function showEditMaterial(mat) {
    showModal(`
      <div style="font-weight:600;margin-bottom:12px">✏️ ${_bbt('rename')}</div>
      <label class="bb-label">${_bbt('matName')}</label>
      <input class="bb-input" id="em-name" value="${mat.name}" style="margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label class="bb-label">${_bbt('matW')} (mm)</label>
          <input class="bb-input" id="em-w" type="number" value="${mat.w}" min="5" max="500">
        </div>
        <div>
          <label class="bb-label">${_bbt('matH')} (mm)</label>
          <input class="bb-input" id="em-h" type="number" value="${mat.h}" min="5" max="500">
        </div>
      </div>
      <label class="bb-label">${_bbt('matColor')}</label>
      <input type="color" id="em-color" value="${mat.color}" style="width:100%;height:32px;border:none;background:none;cursor:pointer;margin-bottom:8px">
      <label class="bb-label">${_bbt('price')}</label>
      <input class="bb-input" id="em-price" type="number" value="${mat.price || 0}" min="0" step="0.01" style="margin-bottom:6px">
      <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:.78rem;cursor:pointer;margin-bottom:10px">
        <input type="checkbox" id="em-perm2" ${mat.pricePerM2 ? 'checked' : ''} style="width:14px;height:14px">
        ${_bbt('pricePerM2')}
      </label>
      <label class="bb-label">${_bbt('stockLen')}</label>
      <input class="bb-input" id="em-stocklen" type="number" value="${mat.stockLen || ''}" min="0.1" step="0.1" placeholder="${_bbt('stockLenHint')}" style="margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="bb-btn" id="em-cancel">${_bbt('cancel')}</button>
        <button class="bb-btn" id="em-save" style="background:#4a4aaa">${_bbt('save')}</button>
      </div>
    `, el => {
      el.querySelector('#em-cancel').onclick = hideModal;
      el.querySelector('#em-save').onclick = () => {
        mat.name      = el.querySelector('#em-name').value.trim() || mat.name;
        mat.w         = parseInt(el.querySelector('#em-w').value) || mat.w;
        mat.h         = parseInt(el.querySelector('#em-h').value) || mat.h;
        mat.color     = el.querySelector('#em-color').value;
        mat.price     = parseFloat(el.querySelector('#em-price').value) || 0;
        mat.pricePerM2 = el.querySelector('#em-perm2').checked;
        const sl = parseFloat(el.querySelector('#em-stocklen').value);
        mat.stockLen = sl > 0 ? sl : null;
        // Rebuild all beams using this material
        state.beams.filter(b => b.matId === mat.id).forEach(b => rebuildBeam(b));
        renderMaterials();
        updateSummary();
        state.dirty = true;
        hideModal();
      };
    });
  }

  function renderMaterials() {
    matListEl.innerHTML = '';
    for (const mat of state.materials) {
      const card = document.createElement('div');
      card.className = 'bb-mat-card' + (mat.id === state.selectedMatId ? ' selected' : '');
      const priceStr = mat.price ? ` · ${mat.price}/${mat.pricePerM2 ? 'm²' : mat.stockLen > 0 ? _bbt('pcs') : 'm'}` : '';
      const isHidden = mat.hidden || false;
      card.innerHTML = `
        <span class="bb-dot" data-toggle="${mat.id}" title="${isHidden ? 'Show' : 'Hide'}" style="background:${isHidden ? '#333' : mat.color};border:2px solid ${mat.color};cursor:pointer;opacity:${isHidden ? 0.4 : 1}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:${isHidden ? 0.4 : 1}">${mat.name}<span style="color:#555;font-size:.68rem">${priceStr}</span></span>
        <span style="color:#444;font-size:.7rem;cursor:pointer;padding:0 2px" data-edit="${mat.id}" title="Edit">⋯</span>
      `;
      card.addEventListener('click', e => {
        if (e.target.dataset.toggle) {
          e.stopPropagation();
          const m = getMat(e.target.dataset.toggle);
          if (m) {
            m.hidden = !m.hidden;
            state.beams.filter(b => b.matId === m.id).forEach(b => { b.mesh.visible = !m.hidden; });
            renderMaterials();
          }
          return;
        }
        if (e.target.dataset.edit) {
          e.stopPropagation();
          const m = getMat(e.target.dataset.edit);
          if (m) showEditMaterial(m);
          return;
        }
        state.selectedMatId = mat.id;
        renderMaterials();
      });
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, [
          { icon: '✏️', label: _bbt('rename'), action: () => showEditMaterial(mat) },
          { icon: '🗑️', label: _bbt('delete'), danger: true, action: () => {
            state.materials = state.materials.filter(m => m.id !== mat.id);
            if (state.selectedMatId === mat.id && state.materials.length)
              state.selectedMatId = state.materials[0].id;
            renderMaterials();
            updateSummary();
          }},
        ]);
      });
      matListEl.appendChild(card);
    }
  }

  function showModal(html, onReady) {
    modalEl.innerHTML = html;
    modalBg.style.display = 'flex';
    if (onReady) onReady(modalEl);
  }

  function hideModal() {
    modalBg.style.display = 'none';
  }

  const MAT_TEMPLATES = [
    { group: 'tplBeams', items: [
      { name: '10×10 cm',  w: 100, h: 100, color: '#c8a96e', stockLen: 4,   pricePerM2: false },
      { name: '10×5 cm',   w: 100, h: 50,  color: '#b8935a', stockLen: 4,   pricePerM2: false },
      { name: '5×5 cm',    w: 50,  h: 50,  color: '#d4a96e', stockLen: 4,   pricePerM2: false },
      { name: '15×15 cm',  w: 150, h: 150, color: '#a07840', stockLen: 4,   pricePerM2: false },
      { name: '20×20 cm',  w: 200, h: 200, color: '#8a6030', stockLen: 4,   pricePerM2: false },
    ]},
    { group: 'tplBoards', items: [
      { name: '2×10 cm',   w: 20,  h: 100, color: '#c8b48e', stockLen: 4,   pricePerM2: false },
      { name: '2×15 cm',   w: 20,  h: 150, color: '#c8b48e', stockLen: 4,   pricePerM2: false },
      { name: '2×20 cm',   w: 20,  h: 200, color: '#c8b48e', stockLen: 4,   pricePerM2: false },
      { name: '3×10 cm',   w: 30,  h: 100, color: '#b8a47e', stockLen: 4,   pricePerM2: false },
      { name: '3×15 cm',   w: 30,  h: 150, color: '#b8a47e', stockLen: 4,   pricePerM2: false },
    ]},
    { group: 'tplSheets', items: [
      { name: 'OSB 18мм',      w: 18,  h: 2500, color: '#d4b870', stockLen: 1.25, pricePerM2: true },
      { name: 'OSB 12мм',      w: 12,  h: 2500, color: '#d4c080', stockLen: 1.25, pricePerM2: true },
      { name: 'Шперплат 18мм', w: 18,  h: 2440, color: '#c8c070', stockLen: 1.22, pricePerM2: true },
      { name: 'Шперплат 12мм', w: 12,  h: 2440, color: '#d0c878', stockLen: 1.22, pricePerM2: true },
      { name: 'Гипсокартон',   w: 12,  h: 2600, color: '#d8d8d8', stockLen: 1.20, pricePerM2: true },
      { name: 'Ламарина 1мм',  w: 1,   h: 2000, color: '#99aabb', stockLen: 1.00, pricePerM2: true },
    ]},
  ];

  function showAddMaterial() {
    const groupsHtml = MAT_TEMPLATES.map(g => `
      <div style="margin-bottom:10px">
        <div style="font-size:.7rem;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${_bbt(g.group)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${g.items.map((t, i) => `
            <button class="bb-btn bb-tpl-btn" data-group="${g.group}" data-idx="${i}"
              style="font-size:.72rem;padding:3px 8px;background:#1a1a3a;border:1px solid #2a2a5a">
              <span style="display:inline-block;width:8px;height:8px;background:${t.color};border-radius:2px;margin-right:4px;vertical-align:middle"></span>${t.name}
            </button>`).join('')}
        </div>
      </div>`).join('');

    showModal(`
      <div style="font-weight:600;margin-bottom:10px">+ ${_bbt('addMaterial')}</div>
      <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #2a2a4a">
        <div style="font-size:.72rem;color:#888;margin-bottom:6px">${_bbt('chooseTemplate')}</div>
        ${groupsHtml}
        <button class="bb-btn bb-tpl-btn" data-custom="1" style="font-size:.72rem;padding:3px 10px;background:#111128;border:1px solid #333">+ ${_bbt('tplCustom')}</button>
      </div>
      <div id="bm-form" style="display:none">
        <label class="bb-label">${_bbt('matName')}</label>
        <input class="bb-input" id="bm-name" value="" style="margin-bottom:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div><label class="bb-label">${_bbt('matW')} (мм)</label>
            <input class="bb-input" id="bm-w" type="number" value="100" min="1" max="5000"></div>
          <div><label class="bb-label">${_bbt('matH')} (мм)</label>
            <input class="bb-input" id="bm-h" type="number" value="100" min="1" max="5000"></div>
        </div>
        <label class="bb-label">${_bbt('matColor')}</label>
        <input type="color" id="bm-color" value="#c8a96e" style="width:100%;height:32px;border:none;background:none;cursor:pointer;margin-bottom:8px">
        <label class="bb-label">${_bbt('price')}</label>
        <input class="bb-input" id="bm-price" type="number" value="0" min="0" step="0.01" style="margin-bottom:6px">
        <label style="display:flex;align-items:center;gap:6px;color:#aaa;font-size:.78rem;cursor:pointer;margin-bottom:6px">
          <input type="checkbox" id="bm-perm2" style="width:14px;height:14px"> ${_bbt('pricePerM2')}
        </label>
        <label class="bb-label">${_bbt('stockLen')}</label>
        <input class="bb-input" id="bm-stocklen" type="number" value="" min="0.1" step="0.1" placeholder="${_bbt('stockLenHint')}" style="margin-bottom:12px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="bb-btn" id="bm-cancel">${_bbt('cancel')}</button>
          <button class="bb-btn" id="bm-add" style="background:#4a4aaa">${_bbt('add')}</button>
        </div>
      </div>
    `, el => {
      const form = el.querySelector('#bm-form');

      function fillForm(t) {
        el.querySelector('#bm-name').value    = t.name;
        el.querySelector('#bm-w').value       = t.w;
        el.querySelector('#bm-h').value       = t.h;
        el.querySelector('#bm-color').value   = t.color;
        el.querySelector('#bm-price').value   = t.price || 0;
        el.querySelector('#bm-perm2').checked = t.pricePerM2 || false;
        el.querySelector('#bm-stocklen').value = t.stockLen || '';
        form.style.display = '';
      }

      el.querySelectorAll('.bb-tpl-btn').forEach(btn => {
        btn.onclick = () => {
          el.querySelectorAll('.bb-tpl-btn').forEach(b => b.style.borderColor = '#2a2a5a');
          btn.style.borderColor = '#7070cc';
          if (btn.dataset.custom) {
            fillForm({ name: '', w: 100, h: 100, color: '#c8a96e', price: 0, pricePerM2: false, stockLen: null });
            el.querySelector('#bm-name').focus();
          } else {
            const g = MAT_TEMPLATES.find(g => g.group === btn.dataset.group);
            fillForm(g.items[parseInt(btn.dataset.idx)]);
          }
        };
      });

      el.querySelector('#bm-cancel').onclick = hideModal;
      el.querySelector('#bm-add').onclick = () => {
        const name = el.querySelector('#bm-name').value.trim() || 'Material';
        const w = parseInt(el.querySelector('#bm-w').value) || 100;
        const h = parseInt(el.querySelector('#bm-h').value) || 100;
        const color = el.querySelector('#bm-color').value;
        const price = parseFloat(el.querySelector('#bm-price').value) || 0;
        const pricePerM2 = el.querySelector('#bm-perm2').checked;
        const sl = parseFloat(el.querySelector('#bm-stocklen').value);
        const stockLen = sl > 0 ? sl : null;
        const id = 'm' + Date.now();
        state.materials.push({ id, name, w, h, color, price, pricePerM2, stockLen });
        state.selectedMatId = id;
        renderMaterials();
        hideModal();
      };
    });
  }

  function showEditLength(beam) {
    const s = new THREE.Vector3(...beam.start);
    const e = new THREE.Vector3(...beam.end);
    const u = UNITS[state.unit] || UNITS.cm;
    const lenDisplay = fmtLenVal(s.distanceTo(e));
    showModal(`
      <div style="font-weight:600;margin-bottom:12px">📐 ${_bbt('editLength')} (${u.label})</div>
      <input class="bb-input" id="be-len" type="number" value="${lenDisplay}" min="0.01" step="${u.step}" style="margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="bb-btn" id="be-cancel">${_bbt('cancel')}</button>
        <button class="bb-btn" id="be-apply" style="background:#4a4aaa">${_bbt('applyLength')}</button>
      </div>
    `, el => {
      el.querySelector('#be-cancel').onclick = hideModal;
      el.querySelector('#be-apply').onclick = () => {
        const newLenDisplay = parseFloat(el.querySelector('#be-len').value);
        if (!newLenDisplay || newLenDisplay <= 0) return;
        const newLen = u.toM(newLenDisplay); // convert to metres
        const sv = new THREE.Vector3(...beam.start);
        const dir = new THREE.Vector3(...beam.end).sub(sv).normalize();
        const newEnd = sv.clone().add(dir.multiplyScalar(newLen));
        beam.end = [newEnd.x, newEnd.y, newEnd.z];
        rebuildBeam(beam);
        updateSelUI();
        updateSummary();
        state.dirty = true;
        hideModal();
      };
    });
  }

  // ---- API calls ----
  async function apiSave(name) {
    const data = {
      name,
      unit: state.unit,
      materials: state.materials,
      beams: state.beams.map(b => ({ id: b.id, matId: b.matId, start: b.start, end: b.end })),
    };
    const url = state.currentProjectId
      ? `/api/apps/beambuilder/projects/${state.currentProjectId}`
      : '/api/apps/beambuilder/projects';
    const method = state.currentProjectId ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error('Save failed');
    const j = await r.json();
    state.currentProjectId = j.id;
    state.currentProjectName = name;
    state.dirty = false;
    return j;
  }

  async function apiList() {
    const r = await fetch('/api/apps/beambuilder/projects');
    return r.json();
  }

  async function apiLoad(id) {
    const r = await fetch(`/api/apps/beambuilder/projects/${id}`);
    return r.json();
  }

  async function apiDelete(id) {
    await fetch(`/api/apps/beambuilder/projects/${id}`, { method: 'DELETE' });
  }

  function loadProject(proj) {
    // Clear scene
    for (const beam of state.beams) {
      scene.remove(beam.mesh);
      beam.mesh.geometry.dispose();
      beam.mesh.material.dispose();
    }
    state.beams = [];
    state.selectedBeamId = null;

    state.materials = proj.materials || [];
    state.currentProjectId = proj.id;
    state.currentProjectName = proj.name || null;
    state.unit = proj.unit || 'cm';
    state.dirty = false;
    const unitSel = body.querySelector('#bb-unit');
    if (unitSel) unitSel.value = state.unit;

    for (const b of (proj.beams || [])) {
      const mat = state.materials.find(m => m.id === b.matId);
      if (!mat) continue;
      const mesh = makeBeamMesh(b.start, b.end, mat);
      if (!mesh) continue;
      mesh.visible = !mat.hidden;
      scene.add(mesh);
      state.beams.push({ ...b, mesh });
      if (state.nextBeamId <= parseInt(b.id.replace('b', '')))
        state.nextBeamId = parseInt(b.id.replace('b', '')) + 1;
    }

    renderMaterials();
    updateSummary();
    updateSelUI();
  }

  function showSaveModal() {
    showModal(`
      <div style="font-weight:600;margin-bottom:12px">💾 ${_bbt('saveProject')}</div>
      <label class="bb-label">${_bbt('projectName')}</label>
      <input class="bb-input" id="bs-name" value="${state.currentProjectName || _bbt('newProject')}" style="margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="bb-btn" id="bs-cancel">${_bbt('cancel')}</button>
        <button class="bb-btn" id="bs-save" style="background:#4a4aaa">💾 ${_bbt('save')}</button>
      </div>
    `, el => {
      const inp = el.querySelector('#bs-name');
      inp.select();
      el.querySelector('#bs-cancel').onclick = hideModal;
      el.querySelector('#bs-save').onclick = async () => {
        const name = inp.value.trim() || _bbt('newProject');
        try {
          await apiSave(name);
          hideModal();
        } catch(e) { alert('Error: ' + e.message); }
      };
    });
  }

  function showLoadModal(projects) {
    if (!projects.length) {
      showModal(`
        <div style="margin-bottom:12px;color:#888">${_bbt('noProjects')}</div>
        <button class="bb-btn" id="bl-close">${_bbt('close')}</button>
      `, el => { el.querySelector('#bl-close').onclick = hideModal; });
      return;
    }
    showModal(`
      <div style="font-weight:600;margin-bottom:10px">📂 ${_bbt('loadProject')}</div>
      <div style="max-height:250px;overflow-y:auto;margin-bottom:12px">
        ${projects.map(p => `
          <div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #2a2a4a">
            <span style="flex:1;color:#ccc;font-size:.85rem">${p.name}</span>
            <button class="bb-btn" data-load="${p.id}" style="font-size:.75rem">📂</button>
            <button class="bb-btn" data-del="${p.id}" style="font-size:.75rem;color:#f87171">🗑️</button>
          </div>
        `).join('')}
      </div>
      <div style="text-align:right"><button class="bb-btn" id="bl-close">${_bbt('close')}</button></div>
    `, el => {
      el.querySelector('#bl-close').onclick = hideModal;
      el.querySelectorAll('[data-load]').forEach(btn => {
        btn.onclick = async () => {
          if (state.dirty && !confirm(_bbt('loadConfirm'))) return;
          const proj = await apiLoad(btn.dataset.load);
          loadProject(proj);
          hideModal();
        };
      });
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = async () => {
          await apiDelete(btn.dataset.del);
          btn.closest('div').remove();
        };
      });
    });
  }

  // ---- Ghost beam (preview) ----
  function updateGhost(startVec, endVec) {
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
    if (!startVec || !endVec) return;
    const mat = getMat(state.selectedMatId);
    if (!mat) return;
    const mesh = makeBeamMesh(
      [startVec.x, startVec.y, startVec.z],
      [endVec.x, endVec.y, endVec.z],
      mat
    );
    if (!mesh) return;
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = 0.4;
    ghostMesh = mesh;
    scene.add(ghostMesh);
  }

  // ---- Mouse events ----
  let isDragging = false;
  let mouseDownPos = null;

  function getMouseNDC(e) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function hitTestHandles(e) {
    if (!gizmoGroup.visible) return null;
    const ndc = getMouseNDC(e);
    const r = new THREE.Raycaster();
    r.setFromCamera(ndc, camera);
    const hits = r.intersectObjects([gizmoHandleStart, gizmoHandleEnd, gizmoHandleMid]);
    if (!hits.length) return null;
    const obj = hits[0].object;
    if (obj === gizmoHandleStart) return 'start';
    if (obj === gizmoHandleEnd)   return 'end';
    if (obj === gizmoHandleMid)   return 'mid';
    return null;
  }

  // Use capture phase so we intercept before OrbitControls (which uses pointerdown)
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    mouseDownPos = { x: e.clientX, y: e.clientY };
    isDragging = false;

    if (state.mode === 'select') {
      const handleType = hitTestHandles(e);
      if (handleType) {
        const beam = state.beams.find(b => b.id === state.selectedBeamId);
        if (beam) {
          drag.active    = true;
          drag.type      = handleType;
          drag.beam      = beam;
          drag.origStart = [...beam.start];
          drag.origEnd   = [...beam.end];
          drag.startX    = e.clientX;
          drag.startY    = e.clientY;
          drag.accAngle  = 0;
          drag.lastCtrl  = e.ctrlKey;
          drag.lastShift = e.shiftKey;
          if (handleType === 'mid') {
            const midPt = new THREE.Vector3(...beam.start)
              .add(new THREE.Vector3(...beam.end)).multiplyScalar(0.5);
            // Horizontal plane at beam's Y level
            drag.plane = new THREE.Plane(new THREE.Vector3(0,1,0), -midPt.y);
            drag.startWorld = getMouseWorld(e, drag.plane);
          }
          controls.enabled = false;
          e.stopPropagation();
          e.preventDefault();
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // No handle grabbed — allow left-drag to orbit (works in both draw and select mode)
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  }, { capture: true });

  canvas.addEventListener('pointerup', e => {
    controls.mouseButtons.LEFT = null;
    if (drag.active) {
      drag.active = false;
      drag.beam = null;
      controls.enabled = true;
      state.dirty = true;
      updateSummary();
      updateSelUI();
      try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    }
    mouseDownPos = null;
  });

  // Keep mouseup as fallback
  canvas.addEventListener('mouseup', () => {
    mouseDownPos = null;
  });

  canvas.addEventListener('pointermove', e => {
    if (mouseDownPos) {
      const dx = e.clientX - mouseDownPos.x, dy = e.clientY - mouseDownPos.y;
      if (Math.sqrt(dx*dx + dy*dy) > 6) isDragging = true;
    }

    // Gizmo drag in progress
    if (drag.active && drag.beam) {
      if (drag.type === 'mid') {
        // Rebuild plane if Ctrl changed (switch between horizontal/vertical)
        if (e.ctrlKey !== drag.lastCtrl) {
          drag.lastCtrl  = e.ctrlKey;
          drag.origStart = [...drag.beam.start];
          drag.origEnd   = [...drag.beam.end];
          const midNow = new THREE.Vector3(...drag.beam.start)
            .add(new THREE.Vector3(...drag.beam.end)).multiplyScalar(0.5);
          if (e.ctrlKey) {
            // Vertical plane facing camera (for up/down movement)
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir); camDir.y = 0; camDir.normalize();
            drag.plane = new THREE.Plane(camDir, -camDir.dot(midNow));
          } else {
            drag.plane = new THREE.Plane(new THREE.Vector3(0,1,0), -midNow.y);
          }
          drag.startWorld = getMouseWorld(e, drag.plane);
          return;
        }
        const cur = getMouseWorld(e, drag.plane);
        if (!cur || !drag.startWorld) return;
        const delta = cur.clone().sub(drag.startWorld);
        const step = e.shiftKey ? 0.01 : 0.5;
        const os = drag.origStart, oe = drag.origEnd;
        let ns, ne;
        if (e.ctrlKey) {
          const dy = Math.round(delta.y / step) * step;
          ns = [os[0], os[1]+dy, os[2]];
          ne = [oe[0], oe[1]+dy, oe[2]];
        } else {
          const dx = Math.round(delta.x / step) * step;
          const dz = Math.round(delta.z / step) * step;
          ns = [os[0]+dx, os[1], os[2]+dz];
          ne = [oe[0]+dx, oe[1], oe[2]+dz];
        }

        // Snap to nearby beam endpoints (disabled with Shift)
        if (!e.shiftKey) {
          const snapDist = 0.4; // 40cm snap radius
          const beamId = drag.beam.id;
          let bestD = snapDist, bestOffset = null;
          // Check both ends of moving beam against all other beam endpoints
          for (const other of state.beams) {
            if (other.id === beamId) continue;
            for (const opt of [other.start, other.end]) {
              const ov = new THREE.Vector3(...opt);
              // Check against start of moving beam
              const sv = new THREE.Vector3(...ns);
              const ev = new THREE.Vector3(...ne);
              const ds = sv.distanceTo(ov);
              const de = ev.distanceTo(ov);
              if (ds < bestD) {
                bestD = ds;
                bestOffset = [ov.x - sv.x, ov.y - sv.y, ov.z - sv.z];
              }
              if (de < bestD) {
                bestD = de;
                bestOffset = [ov.x - ev.x, ov.y - ev.y, ov.z - ev.z];
              }
            }
          }
          if (bestOffset) {
            ns = [ns[0]+bestOffset[0], ns[1]+bestOffset[1], ns[2]+bestOffset[2]];
            ne = [ne[0]+bestOffset[0], ne[1]+bestOffset[1], ne[2]+bestOffset[2]];
          }
        }

        drag.beam.start = ns;
        drag.beam.end   = ne;
      } else {
        // Rotate via pixel delta — 1px = 1°, snap to 45° steps
        // Reset reference point if Ctrl or Shift state changed mid-drag
        if (e.ctrlKey !== drag.lastCtrl || e.shiftKey !== drag.lastShift) {
          drag.startX    = e.clientX;
          drag.startY    = e.clientY;
          drag.accAngle  = 0;
          drag.origStart = [...drag.beam.start];
          drag.origEnd   = [...drag.beam.end];
          drag.lastCtrl  = e.ctrlKey;
          drag.lastShift = e.shiftKey;
          return;
        }

        // Ctrl+Shift: move only the Y of the dragged end in 1cm steps
        if (e.ctrlKey && e.shiftKey) {
          const totalPx = -(e.clientY - drag.startY);
          const step = 0.01;
          const newY = Math.max(0, Math.round((drag.type === 'end'
            ? drag.origEnd[1]
            : drag.origStart[1]) / step + totalPx / 3) * step);
          const r = v => Math.round(v * 10000) / 10000;
          if (drag.type === 'end') {
            drag.beam.start = [...drag.origStart];
            drag.beam.end   = [drag.origEnd[0], r(newY), drag.origEnd[2]];
          } else {
            drag.beam.start = [drag.origStart[0], r(newY), drag.origStart[2]];
            drag.beam.end   = [...drag.origEnd];
          }
          rebuildBeam(drag.beam);
          return;
        }

        const totalPx = e.ctrlKey
          ? -(e.clientY - drag.startY)
          :   (e.clientX - drag.startX);

        // Shift = 1° per 3px, normal = 45° steps (1px per degree, snapped)
        const step = e.shiftKey ? 1 : 45;
        const pxPerDeg = e.shiftKey ? 3 : 1;
        const snapped = Math.round(totalPx / pxPerDeg / step) * step;
        if (snapped === drag.accAngle) return;
        drag.accAngle = snapped;

        // Pivot = the fixed end (opposite of dragged handle)
        // Dragged end rotates around pivot, length preserved
        const pivot = drag.type === 'end'
          ? new THREE.Vector3(...drag.origStart)
          : new THREE.Vector3(...drag.origEnd);
        const moving = drag.type === 'end'
          ? new THREE.Vector3(...drag.origEnd)
          : new THREE.Vector3(...drag.origStart);
        const fullLen = pivot.distanceTo(moving);
        let dir = moving.clone().sub(pivot).normalize();

        let axis;
        if (e.ctrlKey) {
          const flat = new THREE.Vector3(dir.x, 0, dir.z);
          axis = flat.length() > 0.01
            ? new THREE.Vector3(-flat.z, 0, flat.x).normalize()
            : new THREE.Vector3(1, 0, 0);
        } else {
          axis = new THREE.Vector3(0, 1, 0);
        }

        dir.applyQuaternion(
          new THREE.Quaternion().setFromAxisAngle(axis, snapped * Math.PI / 180)
        );
        const newMoving = pivot.clone().add(dir.multiplyScalar(fullLen));
        const r = v => Math.round(v * 10000) / 10000;
        const pArr = [r(pivot.x),     r(pivot.y),     r(pivot.z)];
        const mArr = [r(newMoving.x), r(newMoving.y), r(newMoving.z)];
        if (drag.type === 'end') {
          drag.beam.start = pArr;
          drag.beam.end   = mArr;
        } else {
          drag.beam.end   = pArr;
          drag.beam.start = mArr;
        }
      }
      rebuildBeam(drag.beam);
      return;
    }

    // Hover highlight handles
    if (state.mode === 'select' && gizmoGroup.visible) {
      const h = hitTestHandles(e);
      gizmoHandleStart.material.color.set(h === 'start' ? 0xff4400 : 0xffd700);
      gizmoHandleEnd.material.color.set(h === 'end'   ? 0xff4400 : 0xffd700);
      gizmoHandleMid.material.color.set(h === 'mid'   ? 0xff4400 : 0xffffff);
      canvas.style.cursor = h ? 'grab' : '';
    } else {
      canvas.style.cursor = '';
    }

    if (state.mode === 'draw') {
      const pos = getWorldPos(e);
      if (pos) {
        const snapped = getSnapPoint(pos);
        const axisSnapped = state.drawStart ? snapToAxis(state.drawStart, snapped) : snapped;
        hoverDot.position.copy(axisSnapped);
        hoverDot.visible = true;

        if (state.drawStart) {
          updateGhost(state.drawStart, axisSnapped);
          ghostLabel.style.display = 'block';
          ghostLabel.textContent = fmtLen(state.drawStart.distanceTo(axisSnapped));
          ghostLabel.style.left = (e.clientX - wrap.getBoundingClientRect().left + 12) + 'px';
          ghostLabel.style.top = (e.clientY - wrap.getBoundingClientRect().top - 20) + 'px';
        }
      } else {
        hoverDot.visible = false;
        if (state.drawStart) {
          if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
        }
        ghostLabel.style.display = 'none';
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoverDot.visible = false;
    ghostLabel.style.display = 'none';
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
    canvas.style.cursor = '';
  });

  canvas.addEventListener('click', e => {
    if (isDragging) return;
    if (drag.active) return;

    if (state.mode === 'draw') {
      const pos = getWorldPos(e);
      if (!pos) return;
      const snapped = getSnapPoint(pos);

      if (!state.drawStart) {
        state.drawStart = snapped.clone();
        startDot.position.copy(state.drawStart);
        startDot.visible = true;
        statusEl.textContent = '📍 ' + _bbt('drawSecond');
      } else {
        const axisSnapped = snapToAxis(state.drawStart, snapped);
        if (state.drawStart.distanceTo(axisSnapped) >= 0.02) {
          addBeam(state.drawStart, axisSnapped, state.selectedMatId);
        }
        state.drawStart = null;
        startDot.visible = false;
        if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
        ghostLabel.style.display = 'none';
        statusEl.textContent = _bbt('help');
      }
    } else if (state.mode === 'select') {
      // Don't deselect if clicked a gizmo handle
      if (hitTestHandles(e)) return;

      const ndc = getMouseNDC(e);
      raycaster.setFromCamera(ndc, camera);

      const meshes = state.beams.map(b => b.mesh);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length) {
        let hitMesh = hits[0].object;
        while (hitMesh.parent && !state.beams.find(b => b.mesh === hitMesh))
          hitMesh = hitMesh.parent;
        const beam = state.beams.find(b => b.mesh === hitMesh);
        if (beam) { selectBeam(beam.id); return; }
      }
      selectBeam(null);
    }
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.mode === 'draw' && state.drawStart) {
      state.drawStart = null;
      startDot.visible = false;
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
      ghostLabel.style.display = 'none';
      statusEl.textContent = _bbt('help');
    }
  });

  // ---- UI events ----
  btnDraw.addEventListener('click', () => {
    state.mode = 'draw';
    btnDraw.classList.add('active');
    btnSelect.classList.remove('active');
    statusEl.textContent = _bbt('help');
    selectBeam(null);
  });

  btnSelect.addEventListener('click', () => {
    state.mode = 'select';
    btnSelect.classList.add('active');
    btnDraw.classList.remove('active');
    state.drawStart = null;
    startDot.visible = false;
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
    ghostLabel.style.display = 'none';
    statusEl.textContent = _bbt('selectClick');
  });

  btnDelSel.addEventListener('click', () => {
    if (!state.selectedBeamId) return;
    removeBeam(state.selectedBeamId);
    state.selectedBeamId = null;
    updateSelUI();
  });

  btnEditSel.addEventListener('click', () => {
    const beam = state.beams.find(b => b.id === state.selectedBeamId);
    if (beam) showEditLength(beam);
  });

  btnDupSel.addEventListener('click', () => {
    if (state.selectedBeamId) duplicateBeam(state.selectedBeamId);
  });

  const unitSel = body.querySelector('#bb-unit');
  unitSel.value = state.unit;
  unitSel.addEventListener('change', () => {
    state.unit = unitSel.value;
    state.dirty = true;
    updateSummary();
    updateSelUI();
  });

  snapCb.addEventListener('change', () => { state.snap = snapCb.checked; });

  floorCb.addEventListener('change', () => {
    state.showFloor = floorCb.checked;
    floorGrid.visible = state.showFloor;
  });

  body.querySelector('#bb-btn-add-mat').addEventListener('click', showAddMaterial);

  body.querySelector('#bb-btn-new').addEventListener('click', () => {
    if (state.dirty && !confirm(_bbt('loadConfirm'))) return;
    for (const beam of state.beams) {
      scene.remove(beam.mesh);
      beam.mesh.geometry.dispose();
      beam.mesh.material.dispose();
    }
    state.beams = [];
    state.selectedBeamId = null;
    state.currentProjectId = null;
    state.dirty = false;
    updateSummary();
    updateSelUI();
  });

  body.querySelector('#bb-btn-save').addEventListener('click', showSaveModal);

  body.querySelector('#bb-btn-load').addEventListener('click', async () => {
    const projects = await apiList();
    showLoadModal(projects);
  });

  modalBg.addEventListener('click', e => {
    if (e.target === modalBg) hideModal();
  });

  // ---- Initial render ----
  renderMaterials();
  updateSummary();
  updateSelUI();
  statusEl.textContent = _bbt('help');
}
