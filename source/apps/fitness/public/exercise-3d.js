// Prototype 3D exercise viewer. Angles and joint positions belong to each motion;
// the mannequin and equipment can be reused by other exercises.
export async function mountExercise3D(host, exercise) {
  const url = '/apps/fitness/vendor/three.module.min.js';
  const T = await import(window.asset ? window.asset(url) : url);
  if (!host.isConnected) return () => {};
  let renderer;
  try { renderer = new T.WebGLRenderer({antialias:true, alpha:true}); }
  catch (_) { host.classList.add('fi-3d-unavailable'); return () => {}; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(480, 400, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color('#192533');
  const camera = new T.PerspectiveCamera(34, 1.2, .1, 30);
  scene.add(new T.HemisphereLight(0xe7f5ff, 0x536073, 2.0));
  const light = new T.DirectionalLight(0xffffff, 2.2); light.position.set(3, 6, 5); scene.add(light);
  const mat = color => new T.MeshStandardMaterial({color, roughness:.65});
  const skin=mat('#d89d7c'), shirt=mat('#538dab'), pants=mat('#374d69'), shoe=mat('#d6e2e9'), metal=mat('#c6d2dc'), dark=mat('#323e4d'), bench=mat('#49576a');
  const group = new T.Group(); scene.add(group);
  const sphere = new T.SphereGeometry(1, 20, 14);
  function ellipsoid(x,y,z,sx,sy,sz,m,parent=group) { const o=new T.Mesh(sphere,m); o.position.set(x,y,z); o.scale.set(sx,sy,sz); parent.add(o); return o; }
  function capsule(radius,length,m) { const o=new T.Mesh(new T.CapsuleGeometry(radius,Math.max(.01,length-2*radius),5,12),m); group.add(o); return o; }
  const point=(x,y,z)=>new T.Vector3(x,y,z), axis=new T.Vector3(0,1,0);
  function limb(a,b,r,m) { const o=capsule(r,a.distanceTo(b),m); place(o,a,b); return o; }
  function place(o,a,b) { o.position.copy(a).add(b).multiplyScalar(.5); o.quaternion.setFromUnitVectors(axis,new T.Vector3().subVectors(b,a).normalize()); }
  function box(x,y,z,sx,sy,sz,m) { const o=new T.Mesh(new T.BoxGeometry(sx,sy,sz),m); o.position.set(x,y,z); group.add(o); return o; }
  const lying = ['dumbbell_bench_press','incline_dumbbell_press','dumbbell_fly'].includes(exercise);
  const seated = lying || ['arnold_press','dumbbell_shoulder_press','wrist_curl'].includes(exercise);
  const lowerBody = ['goblet_squat','lunge','walking_lunge','bulgarian_split_squat','step_up'].includes(exercise);
  if (lying) { box(0,.60,-.36,.55,.12,1.25,bench); box(0,.30,-.36,.12,.60,.12,dark); if (exercise === 'incline_dumbbell_press') { const back=box(0,1.02,-.40,.55,.84,.09,bench); back.rotation.x=-1.0; } }
  else if (seated) { box(0,.60,0,.78,.12,.58,bench); box(0,.30,-.17,.12,.6,.12,dark); }
  if (exercise === 'bulgarian_split_squat') box(0,.33,-.62,.65,.12,.40,bench);
  if (exercise === 'step_up') box(0,.16,.40,.7,.32,.55,bench);
  const upperStart=group.children.length;
  ellipsoid(0,.88,0,.29,.2,.16,pants); ellipsoid(0,1.21,-.035,.30,.40,.16,shirt);
  ellipsoid(0,1.61,0,.095,.10,.09,skin); ellipsoid(0,1.78,0,.145,.19,.13,skin);
  ellipsoid(0,1.91,-.035,.15,.085,.13,dark);
  const upperMeshes=group.children.slice(upperStart);
  const legs=[];
  for (const s of [-1,1]) {
    const knee=seated ? point(s*.20,.47,.43) : point(s*.20,.47,.03);
    const ankle=seated ? point(s*.23,.10,.46) : point(s*.20,.10,.03);
    const hip=point(s*.16,.76,.06);
    const thigh=limb(hip,knee,.105,pants), shin=limb(knee,ankle,.075,pants);
    const joint=ellipsoid(knee.x,knee.y,knee.z,.105,.105,.105,pants);
    const foot=ellipsoid(ankle.x,.075,ankle.z+.07,.10,.065,.17,shoe);
    legs.push({s,hip,knee,ankle,thigh,shin,joint,foot,thighLength:hip.distanceTo(knee),shinLength:knee.distanceTo(ankle)});
  }
  const arms=[];
  const armStart=group.children.length;
  for (const s of [-1,1]) {
    const shoulder=point(s*.29,1.43,0), elbow=point(s*.19,1.10,.24), wrist=point(s*.19,1.55,.27);
    const upperLength=.40, foreLength=.45;
    const upper=capsule(.073,upperLength,skin), fore=capsule(.061,foreLength,skin);
    const joint=ellipsoid(0,0,0,.074,.074,.074,skin);
    const hand = new T.Group(); group.add(hand);
    ellipsoid(0,0,0,.065,.09,.035,skin,hand);
    ellipsoid(s*.068,-.005,.012,.026,.05,.025,skin,hand);
    // The handle and plates are children of the hand and rotate with the grip.
    const weight=new T.Group(); hand.add(weight);
    if (['goblet_squat','overhead_triceps_extension'].includes(exercise) && s === 1) weight.visible=false;
    const cylinder=(r,h,x,m)=>{const obj=new T.Mesh(new T.CylinderGeometry(r,r,h,20),m);obj.rotation.z=Math.PI/2;obj.position.x=x;weight.add(obj)};
    cylinder(.022,.30,0,metal); cylinder(.095,.055,-.17,dark); cylinder(.095,.055,.17,dark);
    cylinder(.065,.02,-.205,metal); cylinder(.065,.02,.205,metal);
    arms.push({s,shoulder,upper,fore,joint,hand,upperLength,foreLength});
  }
  const pivot=new T.Group(), offset=new T.Group();
  pivot.position.y=.88; offset.position.y=-.88; group.add(pivot); pivot.add(offset);
  for (const mesh of upperMeshes.concat(group.children.slice(armStart).filter(o => o !== pivot))) offset.add(mesh);
  if (lying) pivot.rotation.x = exercise === 'incline_dumbbell_press' ? -1.0 : -Math.PI/2;
  if (exercise === 'dumbbell_row' || exercise === 'rear_delt_fly') pivot.rotation.x=.95;
  let angle=.55, dragging=false, lastX=0, stopped=false, frame=0;
  function cameraPosition() { camera.position.set(Math.sin(angle)*4.5,2.2,Math.cos(angle)*4.5); camera.lookAt(0,1.22,0); }
  cameraPosition();
  function onDown(e) { dragging=true; lastX=e.clientX; host.setPointerCapture(e.pointerId); }
  function onMove(e) { if (!dragging) return; angle+=(e.clientX-lastX)*.009; lastX=e.clientX; cameraPosition(); }
  function onUp() { dragging=false; }
  host.addEventListener('pointerdown',onDown); host.addEventListener('pointermove',onMove); host.addEventListener('pointerup',onUp); host.addEventListener('pointercancel',onUp);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start=performance.now();
  function draw(now) {
    if (stopped || !host.isConnected) { cleanup(); return; }
    // Smooth single repetition: start at the shoulders, open the elbows while
    // rotating the forearms, then press overhead; reverse on the descent.
    const p=reduced ? 0 : (1-Math.cos((now-start)*2*Math.PI/4800))/2;
    const open=Math.min(1,p*1.55), lift=Math.max(0,(p-.15)/.85);
    for (const a of arms) {
      const s=a.s, shoulder=a.shoulder.clone();
      if (exercise === 'shrug') shoulder.y += .09*p;
      let w, guide, turn=0;
      if (exercise === 'arnold_press') {
        w=point(s*(.19+.18*open),1.55+.72*lift,.27*(1-open));
        guide=point(s*(.19+.18*open),1.10+.78*lift,.24*(1-open));
        turn=s*Math.PI*open;
      } else if (exercise === 'dumbbell_shoulder_press') {
        w=point(s*.52,1.51+.73*p,.02);
        guide=point(s*.62,1.20+.70*p,.02);
      } else if (exercise === 'lateral_raise') {
        const theta=p*Math.PI*.49;
        w=point(s*(.29+.83*Math.sin(theta)),1.43-.83*Math.cos(theta),0);
        guide=point(s*(.29+.42*Math.sin(theta)),1.43-.42*Math.cos(theta),-.04);
      } else if (exercise === 'front_raise') {
        const theta=p*Math.PI*.49;
        w=point(s*.29,1.43-.83*Math.cos(theta),.83*Math.sin(theta));
        guide=point(s*.29,1.43-.42*Math.cos(theta),.42*Math.sin(theta)-.04);
      } else if (exercise === 'dumbbell_curl' || exercise === 'hammer_curl') {
        const theta=p*2.5;
        w=point(s*.32,1.43-.40-.45*Math.cos(theta),.45*Math.sin(theta));
        guide=point(s*.32,1.03,0);
        turn=exercise === 'hammer_curl' ? Math.PI/2 : 0;
      } else if (lying && exercise !== 'dumbbell_fly') {
        w=point(s*(.49-.15*p),1.41,.22+.52*p);
        guide=point(s*(.57-.18*p),1.27,.13+.25*p);
      } else if (exercise === 'dumbbell_fly') {
        const theta=p*Math.PI*.43;
        w=point(s*(.29+.68*Math.cos(theta)),1.42,.25+.60*Math.sin(theta));
        guide=point(s*(.29+.36*Math.cos(theta)),1.35,.12+.29*Math.sin(theta));
      } else if (exercise === 'dumbbell_row') {
        const working=s === -1 ? p : 0;
        w=point(s*.34,.60+.35*working,0);
        guide=point(s*.34,1.00+.12*working,-.22*working);
      } else if (exercise === 'rear_delt_fly') {
        const theta=p*Math.PI*.47;
        w=point(s*(.29+.80*Math.sin(theta)),1.43-.80*Math.cos(theta),0);
        guide=point(s*(.29+.40*Math.sin(theta)),1.43-.40*Math.cos(theta),-.04);
      } else if (exercise === 'overhead_triceps_extension') {
        const theta=p*1.45;
        w=point(s*.10,2.05+.20*Math.sin(theta),-.32+.32*(1-Math.cos(theta)));
        guide=point(s*.16,1.90,-.06);
      } else if (exercise === 'wrist_curl') {
        w=point(s*.23,1.01,.53);
        guide=point(s*.23,.96,.15);
      } else if (exercise === 'goblet_squat') {
        w=point(s*.09,1.35,.32); guide=point(s*.19,1.02,.12);
      } else if (lowerBody) {
        w=point(s*.32,.60,0); guide=point(s*.32,1.02,0);
      } else if (exercise === 'shrug') {
        w=point(s*.32,.60+.09*p,0);
        guide=point(s*.32,1.02+.05*p,0);
      }
      // Two fixed-length arm segments meet at a single elbow. Project the
      // preferred elbow direction onto the circle where the two bones meet.
      const direction=w.clone().sub(shoulder);
      const distance=Math.max(Math.abs(a.upperLength-a.foreLength)+.001, Math.min(a.upperLength+a.foreLength-.001,direction.length()));
      direction.normalize();
      w.copy(shoulder).addScaledVector(direction,distance);
      const along=(a.upperLength*a.upperLength-a.foreLength*a.foreLength+distance*distance)/(2*distance);
      const height=Math.sqrt(Math.max(0,a.upperLength*a.upperLength-along*along));
      guide.sub(shoulder);
      const bend=guide.addScaledVector(direction,-guide.dot(direction));
      if (bend.lengthSq()<1e-8) bend.set(s,0,0).addScaledVector(direction,-s*direction.x);
      bend.normalize();
      const e=shoulder.clone().addScaledVector(direction,along).addScaledVector(bend,height);
      place(a.upper,shoulder,e); place(a.fore,e,w); a.joint.position.copy(e);
      a.hand.position.copy(w); a.hand.rotation.y=turn; a.hand.rotation.x=exercise === 'wrist_curl' ? -.45+.9*p : 0;
    }
    if (lowerBody) {
      const squat=exercise === 'goblet_squat', step=exercise === 'step_up';
      const drop=squat ? .27*p : step ? -.27*p : .20*p;
      pivot.position.y=.88-drop;
      for (const leg of legs) {
        const walkingSide=exercise === 'walking_lunge' && Math.floor((now-start)/4800)%2 ? 1 : -1;
        const front=leg.s === walkingSide;
        const hip=leg.hip.clone(); hip.y-=drop;
        let knee=leg.knee.clone(), ankle=leg.ankle.clone();
        if (squat) { knee.y-=.11*p; knee.z+=.20*p; }
        else if (step) {
          if (front) { ankle.set(leg.s*.20,.42,.40); knee.set(leg.s*.20,.60+.14*p,.40); }
          else { ankle.y+=.27*p; knee.y+=.27*p; }
        } else {
          const stride=exercise === 'bulgarian_split_squat' ? .46 : .34*p;
          ankle.z=front ? stride : -stride;
          if (exercise === 'bulgarian_split_squat' && !front) ankle.y=.41;
          knee.z=ankle.z*.6; knee.y-=.15*p;
        }
        place(leg.thigh,hip,knee); leg.thigh.scale.y=hip.distanceTo(knee)/leg.thighLength;
        place(leg.shin,knee,ankle); leg.shin.scale.y=knee.distanceTo(ankle)/leg.shinLength;
        leg.joint.position.copy(knee); leg.foot.position.set(ankle.x,ankle.y-.025,ankle.z+.07);
      }
    }
    renderer.render(scene,camera);
    if (!reduced) frame=requestAnimationFrame(draw);
  }
  function cleanup() {
    if (stopped) return; stopped=true; cancelAnimationFrame(frame);
    host.removeEventListener('pointerdown',onDown); host.removeEventListener('pointermove',onMove); host.removeEventListener('pointerup',onUp); host.removeEventListener('pointercancel',onUp);
    const geometries=new Set(), materials=new Set(); scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material)});
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); renderer.dispose(); renderer.domElement.remove();
  }
  frame=requestAnimationFrame(draw);
  return cleanup;
}
