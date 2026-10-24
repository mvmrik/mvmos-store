// Navigation — one widget for the desktop window and the public page.
// The browser talks to Google directly with the owner's key (map, Places API
// (New), Routes API); the server only keeps each profile's saved places.
(function () {
  const API = '/pub/navigation';
  const t = (k, v) => (window.t || (x => x))(k, v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';

  // ── Geometry ────────────────────────────────────────────────────────────
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  // Decode a Google encoded polyline (precision 5) into [{lat,lng}].
  function decodePolyline(str) {
    const out = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
        const d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (k === 0) lat += d; else lng += d;
      }
      out.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return out;
  }
  // Where on a path is a position: distance along it (m) and distance off it (m).
  // Local flat-earth maths around the point is accurate to centimetres at this scale.
  function project(path, cum, p, from, to) {
    let best = { off: Infinity, along: 0, idx: from };
    const kx = Math.cos(rad(p.lat)) * R * Math.PI / 180, ky = R * Math.PI / 180;
    const last = Math.min(path.length - 1, to);
    for (let i = Math.max(0, from); i < last; i++) {
      const ax = (path[i].lng - p.lng) * kx, ay = (path[i].lat - p.lat) * ky;
      const bx = (path[i + 1].lng - p.lng) * kx, by = (path[i + 1].lat - p.lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let u = len2 ? -(ax * dx + ay * dy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const off = Math.hypot(ax + u * dx, ay + u * dy);
      if (off < best.off) best = { off, along: cum[i] + u * Math.sqrt(len2), idx: i };
    }
    return best;
  }

  // ── Formatting ──────────────────────────────────────────────────────────
  function fmtDist(m) {
    if (m < 950) return Math.max(0, Math.round(m / 10) * 10) + ' ' + t('nav_u_m');
    return (m < 20000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' ' + t('nav_u_km');
  }
  function fmtDur(s) {
    const mins = Math.max(1, Math.round(s / 60));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + ' ' + t('nav_u_h') + (m ? ' ' + m + ' ' + t('nav_u_min') : '') : m + ' ' + t('nav_u_min');
  }
  const fmtClock = ms => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  const secs = d => parseInt(String(d || '0'), 10) || 0;

  const DARK_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1d2230' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9aa4bd' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2230' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2e3650' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a5580' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#b4bdd6' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1420' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ];

  let mapsPromise = null;
  function loadMaps(key) {
    if (window.google && window.google.maps && window.google.maps.importLibrary) return Promise.resolve();
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve, reject) => {
      window.__navMapsReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&v=weekly&loading=async&language=' + encodeURIComponent(lang()) + '&callback=__navMapsReady';
      s.onerror = () => { mapsPromise = null; reject(new Error('maps')); };
      document.head.appendChild(s);
      // A bad key does not fail the script load; Google calls this instead.
      window.gm_authFailure = () => { mapsPromise = null; reject(new Error('maps')); };
    });
    return mapsPromise;
  }

  function injectStyles() {
    if (document.getElementById('nav-style')) return;
    const style = document.createElement('style');
    style.id = 'nav-style';
    style.textContent = `
      .nv{position:relative;height:100%;width:100%;overflow:hidden;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif}
      .nv-map{position:absolute;inset:0}
      .nv-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:1rem;line-height:1.5;color:var(--pub-fg2,#a6adc8)}
      .nv-top{position:absolute;top:10px;left:10px;right:70px;z-index:5;max-width:560px}
      .nv-search{display:flex;gap:6px;background:var(--pub-surface1,#313244);border-radius:14px;box-shadow:0 4px 18px #0008;padding:4px}
      .nv-search input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:inherit;font-size:1.05rem;padding:10px 12px}
      .nv-btn{border:0;border-radius:12px;background:var(--pub-surface2,#45475a);color:inherit;font-size:1.05rem;padding:10px 14px;cursor:pointer;min-height:44px}
      .nv-btn.pri{background:var(--pub-accent,#89b4fa);color:#11111b;font-weight:700}
      .nv-btn.red{background:#e0536a;color:#fff;font-weight:700}
      .nv-list{margin-top:6px;background:var(--pub-surface1,#313244);border-radius:14px;box-shadow:0 4px 18px #0008;max-height:50vh;overflow-y:auto}
      .nv-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #0003;cursor:pointer}
      .nv-row:last-child{border-bottom:0}
      .nv-row .main{flex:1;min-width:0}
      .nv-row .ttl{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nv-row .sub{font-size:.82rem;color:var(--pub-fg2,#a6adc8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nv-row .dist{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
      .nv-row .ic{background:transparent;border:0;color:inherit;font-size:1.1rem;padding:8px;cursor:pointer;opacity:.8}
      .nv-side{position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;gap:8px}
      .nv-side .nv-btn{width:50px;height:50px;padding:0;box-shadow:0 4px 14px #0008;background:var(--pub-surface1,#313244)}
      .nv-side .nv-btn.on{background:var(--pub-accent,#89b4fa);color:#11111b}
      .nv-bottom{position:absolute;left:10px;right:10px;bottom:10px;z-index:5;max-width:640px;background:var(--pub-surface1,#313244);border-radius:18px;box-shadow:0 4px 22px #000a;padding:14px}
      .nv-bottom h3{margin:0 0 2px;font-size:1.15rem}
      .nv-bottom .addr{font-size:.85rem;color:var(--pub-fg2,#a6adc8);margin-bottom:10px}
      .nv-routes{display:flex;gap:8px;overflow-x:auto;margin-bottom:10px}
      .nv-routes .rt{flex:0 0 auto;border:2px solid transparent;border-radius:12px;background:var(--pub-surface2,#45475a);padding:8px 12px;cursor:pointer}
      .nv-routes .rt.on{border-color:var(--pub-accent,#89b4fa)}
      .nv-routes .rt b{display:block;font-size:1.1rem}
      .nv-routes .rt span{font-size:.8rem;color:var(--pub-fg2,#a6adc8)}
      .nv-actions{display:flex;gap:8px;flex-wrap:wrap}
      .nv-actions .nv-btn.pri{flex:1}
      .nv-banner{position:absolute;top:10px;left:10px;right:10px;z-index:6;max-width:640px;background:#0f6b4f;color:#fff;border-radius:18px;box-shadow:0 4px 22px #000a;padding:14px 18px}
      .nv-banner .dist{font-size:2.1rem;font-weight:800;line-height:1.1}
      .nv-banner .ins{font-size:1.25rem;margin-top:2px}
      .nv-stats{display:flex;justify-content:space-between;gap:10px;text-align:center}
      .nv-stats div{flex:1}
      .nv-stats b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums}
      .nv-stats span{font-size:.75rem;color:var(--pub-fg2,#a6adc8);text-transform:uppercase;letter-spacing:.4px}
      .nv-chips{position:absolute;left:10px;right:70px;bottom:10px;z-index:4;display:flex;gap:8px;overflow-x:auto}
      .nv-chip{flex:0 0 auto;background:var(--pub-surface1,#313244);border-radius:20px;padding:10px 14px;box-shadow:0 4px 14px #0008;cursor:pointer;white-space:nowrap}
      .nv-chip b{margin-left:6px;font-variant-numeric:tabular-nums}
      .nv-toast{position:absolute;left:50%;transform:translateX(-50%);bottom:90px;z-index:9;background:#000c;color:#fff;border-radius:12px;padding:10px 16px;max-width:90%;text-align:center}
      .nv-dlg{position:absolute;inset:0;z-index:10;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px}
      .nv-dlg>div{background:var(--pub-surface1,#313244);border-radius:16px;padding:18px;width:100%;max-width:380px}
      .nv-dlg input{width:100%;box-sizing:border-box;margin:10px 0 14px;padding:12px;border-radius:10px;border:1px solid #0005;background:var(--pub-bg,#1e1e2e);color:inherit;font-size:1.05rem}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="nv"></div>';
    const w = root.firstChild;
    if (!token) {
      w.innerHTML = `<div class="nv-msg">${esc(t('nav_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    const st = {
      key: '', mapId: '', vector: false, rotate: false, places: [], pos: null, map: null, dark: localStorage.getItem('nav_dark') !== '0',
      voice: localStorage.getItem('nav_voice') !== '0', follow: true, listOpen: false,
      query: '', results: [], dest: null, routes: [], sel: 0, mode: 'browse', toast: '', busy: false,
      nav: null,
    };
    let G = null;                 // google.maps namespace
    let marker = null, destMarker = null, accCircle = null, polylines = [], placeMarkers = [];
    let watchId = null, lock = null, destroyed = false, sessionToken = newSession(), searchTimer = null, toastTimer = null;
    let lastRerouteAt = 0;

    function newSession() { return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); }

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        if (r.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('http_' + r.status));
        return data;
      });
    }
    function google(url, body, mask, method) {
      return fetch(url, {
        method: method || 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': st.key }, mask ? { 'X-Goog-FieldMask': mask } : {}),
        body: body ? JSON.stringify(body) : undefined,
      }).then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('google_' + r.status);
        return data;
      });
    }

    function toast(msg, ms) {
      st.toast = msg; renderOverlay();
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { st.toast = ''; renderOverlay(); }, ms || 3500);
    }

    // ── Dialogs ───────────────────────────────────────────────────────────
    function ask(title, value) {
      return new Promise(resolve => {
        const d = document.createElement('div');
        d.className = 'nv-dlg';
        d.innerHTML = `<div><b>${esc(title)}</b><input type="text" maxlength="80" value="${esc(value || '')}">
          <div class="nv-actions"><button class="nv-btn" data-a="no">${esc(t('nav_cancel'))}</button><button class="nv-btn pri" data-a="ok">${esc(t('nav_ok'))}</button></div></div>`;
        w.appendChild(d);
        const inp = d.querySelector('input');
        const done = v => { d.remove(); resolve(v); };
        d.querySelector('[data-a=no]').onclick = () => done(null);
        d.querySelector('[data-a=ok]').onclick = () => done(inp.value.trim() || null);
        inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
        inp.focus(); inp.select();
      });
    }
    function confirmDlg(title) {
      return new Promise(resolve => {
        const d = document.createElement('div');
        d.className = 'nv-dlg';
        d.innerHTML = `<div><b>${esc(title)}</b><div class="nv-actions" style="margin-top:14px"><button class="nv-btn" data-a="no">${esc(t('nav_cancel'))}</button><button class="nv-btn red" data-a="ok">${esc(t('nav_delete'))}</button></div></div>`;
        w.appendChild(d);
        d.querySelector('[data-a=no]').onclick = () => { d.remove(); resolve(false); };
        d.querySelector('[data-a=ok]').onclick = () => { d.remove(); resolve(true); };
      });
    }


    // (Re)create the map. Rotation needs Google's vector renderer, which is only
    // chosen when the map is created with a Map ID, so switching means a new map.
    function buildMap(vector) {
      const old = st.map, c = old && old.getCenter(), zoom = old && old.getZoom();
      const fresh = document.createElement('div');
      fresh.className = 'nv-map';
      w.querySelector('.nv-map').replaceWith(fresh);
      const o = {
        center: c ? { lat: c.lat(), lng: c.lng() } : { lat: 42.7, lng: 25.3 }, zoom: zoom || 7,
        disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false,
        zoomControl: true, zoomControlOptions: { position: G.ControlPosition.LEFT_CENTER },
      };
      if (vector) { o.mapId = st.mapId || 'DEMO_MAP_ID'; o.colorScheme = st.dark ? 'DARK' : 'LIGHT'; }
      else o.styles = st.dark ? DARK_STYLE : [];
      st.map = new G.Map(fresh, o);
      st.map.addListener('dragstart', () => { if (st.follow) { st.follow = false; renderOverlay(); } });
      st.map.addListener('click', e => {
        if (st.mode === 'nav') return;
        const ll = e.latLng;
        setDest({ name: t('nav_pin'), address: ll.lat().toFixed(5) + ', ' + ll.lng().toFixed(5), lat: ll.lat(), lng: ll.lng() });
      });
      // Everything drawn on the old map goes with it; draw it again on the new one.
      marker = null; accCircle = null; destMarker = null; polylines = []; placeMarkers = [];
      drawMe(); drawPlaceMarkers(); drawDestMarker(); drawRoutes(false);
    }
    async function setVector(on) {
      if (!on) { buildMap(false); st.vector = false; st.rotate = false; return true; }
      buildMap(true);
      const ok = await new Promise(resolve => {
        const isVector = () => st.map.getRenderingType() === G.RenderingType.VECTOR;
        let l = null;
        const done = v => { clearTimeout(tm); if (l) l.remove(); resolve(v); };
        l = st.map.addListener('renderingtype_changed', () => {
          if (isVector()) done(true); else if (st.map.getRenderingType() === G.RenderingType.RASTER) done(false);
        });
        const tm = setTimeout(() => done(isVector()), 5000);
      });
      if (!ok) { buildMap(false); st.vector = false; st.rotate = false; return false; }
      st.vector = true;
      return true;
    }
    async function toggleRotate() {
      if (st.rotate) {
        st.rotate = false;
        if (st.vector) { st.map.setHeading(0); }
        drawMe(); renderOverlay(); return;
      }
      if (!st.vector && !(await setVector(true))) { renderOverlay(); info(t('nav_vector_help')); return; }
      st.rotate = true; st.follow = true;
      applyHeading(); drawMe(); renderOverlay();
    }
    function applyHeading() {
      if (!st.rotate || !st.vector || !st.pos || st.pos.heading == null || (st.pos.speed != null && st.pos.speed <= 1)) return;
      const cur = st.map.getHeading() || 0;
      if (Math.abs(((st.pos.heading - cur + 540) % 360) - 180) > 2) st.map.setHeading(st.pos.heading);
    }
    function info(text) {
      const d = document.createElement('div');
      d.className = 'nv-dlg';
      d.innerHTML = `<div><div style="line-height:1.5">${esc(text)}</div><div class="nv-actions" style="margin-top:14px"><button class="nv-btn pri" data-a="ok" style="flex:1">${esc(t('nav_ok'))}</button></div></div>`;
      w.appendChild(d);
      d.querySelector('[data-a=ok]').onclick = () => d.remove();
    }

    // ── Position ──────────────────────────────────────────────────────────
    function startWatch() {
      if (!navigator.geolocation || watchId != null) return;
      watchId = navigator.geolocation.watchPosition(onFix, () => { st.pos = st.pos || null; renderOverlay(); },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    }
    function onFix(p) {
      const c = p.coords, prev = st.pos;
      let heading = c.heading;
      if ((heading == null || isNaN(heading)) && prev && haversine(prev, { lat: c.latitude, lng: c.longitude }) > 8) {
        heading = bearing(prev, { lat: c.latitude, lng: c.longitude });
      }
      st.pos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, speed: c.speed, heading: (heading == null || isNaN(heading)) ? (prev ? prev.heading : null) : heading, t: p.timestamp };
      drawMe();
      if (st.mode === 'nav') updateNav();
      else renderOverlay();
    }
    function drawMe() {
      if (!G || !st.map || !st.pos) return;
      const pos = { lat: st.pos.lat, lng: st.pos.lng };
      const moving = st.pos.heading != null && (st.pos.speed == null || st.pos.speed > 1);
      const icon = moving
        ? { path: G.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: st.rotate && st.vector ? 0 : st.pos.heading, fillColor: '#4ea8ff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
        : { path: G.SymbolPath.CIRCLE, scale: 9, fillColor: '#4ea8ff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 };
      if (!marker) { marker = new G.Marker({ map: st.map, position: pos, icon, zIndex: 100 }); accCircle = new G.Circle({ map: st.map, center: pos, radius: st.pos.acc || 0, strokeWeight: 0, fillColor: '#4ea8ff', fillOpacity: .15, clickable: false }); }
      else { marker.setPosition(pos); marker.setIcon(icon); accCircle.setCenter(pos); accCircle.setRadius(Math.min(st.pos.acc || 0, 500)); }
      applyHeading();
      if (st.follow) { st.map.panTo(pos); }
    }
    function locateOnce() {
      st.follow = true;
      if (st.pos) { st.map.panTo({ lat: st.pos.lat, lng: st.pos.lng }); if (st.map.getZoom() < 14) st.map.setZoom(15); renderOverlay(); return; }
      navigator.geolocation.getCurrentPosition(p => { onFix(p); st.map.setZoom(15); }, () => toast(t('nav_no_position')),
        { enableHighAccuracy: true, timeout: 15000 });
    }

    // ── Search ────────────────────────────────────────────────────────────
    function onInput(v) {
      st.query = v;
      clearTimeout(searchTimer);
      if (v.trim().length < 3) { st.results = []; renderOverlay(); return; }
      searchTimer = setTimeout(() => autocomplete(v.trim()), 250);
    }
    async function autocomplete(q) {
      try {
        const bias = st.pos || (st.map && { lat: st.map.getCenter().lat(), lng: st.map.getCenter().lng() });
        const body = { input: q, languageCode: lang(), sessionToken };
        if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
        const d = await google('https://places.googleapis.com/v1/places:autocomplete', body);
        if (q !== st.query.trim()) return;
        st.results = (d.suggestions || []).filter(s => s.placePrediction).map(s => {
          const p = s.placePrediction;
          return { placeId: p.placeId, name: (p.structuredFormat && p.structuredFormat.mainText.text) || p.text.text,
                   address: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || '' };
        });
        renderOverlay();
      } catch (e) { toast(t('nav_api_failed')); }
    }
    async function searchText(q) {
      const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
      if (m) { setDest({ name: t('nav_pin'), address: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`, lat: +m[1], lng: +m[2] }); return; }
      try {
        const d = await google('https://places.googleapis.com/v1/places:searchText', { textQuery: q, languageCode: lang() },
          'places.id,places.displayName,places.formattedAddress,places.location');
        st.results = (d.places || []).map(p => ({ name: p.displayName.text, address: p.formattedAddress || '', lat: p.location.latitude, lng: p.location.longitude }));
        if (!st.results.length) toast(t('nav_no_results'));
        renderOverlay();
      } catch (e) { toast(t('nav_api_failed')); }
    }
    async function pickResult(r) {
      st.results = []; st.query = '';
      if (r.lat == null) {
        try {
          const d = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(r.placeId) + '?languageCode=' + lang() + '&sessionToken=' + sessionToken, {
            headers: { 'X-Goog-Api-Key': st.key, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' } }).then(x => x.json());
          sessionToken = newSession();
          r = { name: d.displayName.text, address: d.formattedAddress || '', lat: d.location.latitude, lng: d.location.longitude };
        } catch (e) { toast(t('nav_api_failed')); return; }
      }
      setDest(r);
    }

    // ── Destination and routes ────────────────────────────────────────────
    function clearRoutes() { polylines.forEach(p => p.setMap(null)); polylines = []; }
    function setDest(d) {
      st.dest = d; st.mode = 'place'; st.routes = []; st.sel = 0; st.follow = false;
      drawDestMarker();
      st.map.panTo({ lat: d.lat, lng: d.lng });
      clearRoutes();
      renderOverlay();
    }
    function drawDestMarker() {
      if (destMarker) destMarker.setMap(null);
      destMarker = st.dest && st.map ? new G.Marker({ map: st.map, position: { lat: st.dest.lat, lng: st.dest.lng }, title: st.dest.name }) : null;
    }
    function closeDest() {
      stopNav(true);
      st.dest = null; st.mode = 'browse'; st.routes = [];
      if (destMarker) { destMarker.setMap(null); destMarker = null; }
      clearRoutes(); renderOverlay();
    }
    async function fetchRoutes(reroute) {
      if (!st.dest) return;
      const origin = st.pos || (st.map && { lat: st.map.getCenter().lat(), lng: st.map.getCenter().lng() });
      if (!st.pos && !reroute) toast(t('nav_no_position'));
      if (!origin) return;
      const loc = { latLng: { latitude: origin.lat, longitude: origin.lng } };
      if (reroute && st.pos && st.pos.heading != null && (st.pos.speed || 0) > 3) loc.heading = Math.round(st.pos.heading);
      st.busy = true; renderOverlay();
      try {
        const d = await google('https://routes.googleapis.com/directions/v2:computeRoutes', {
          origin: { location: loc },
          destination: { location: { latLng: { latitude: st.dest.lat, longitude: st.dest.lng } } },
          travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: !reroute,
          languageCode: lang(), units: 'METRIC',
        }, 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,' +
           'routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.endLocation');
        st.routes = (d.routes || []).map(prepRoute);
        st.sel = 0;
        if (!st.routes.length) toast(t('nav_no_route'));
        drawRoutes(!reroute);
        if (reroute && st.routes.length && st.mode === 'nav') beginRoute(st.routes[0], true);
      } catch (e) { toast(t('nav_api_failed')); }
      st.busy = false; renderOverlay();
    }
    function prepRoute(r) {
      const path = decodePolyline(r.polyline.encodedPolyline);
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
      const steps = [];
      let from = 0, prevAlong = 0;
      ((r.legs || [])).forEach(leg => (leg.steps || []).forEach(s => {
        const end = { lat: s.endLocation.latLng.latitude, lng: s.endLocation.latLng.longitude };
        const pr = project(path, cum, end, from, path.length);
        const along = Math.max(prevAlong, pr.along);
        from = Math.max(0, pr.idx - 1); prevAlong = along;
        steps.push({ text: (s.navigationInstruction && s.navigationInstruction.instructions) || '', maneuver: (s.navigationInstruction && s.navigationInstruction.maneuver) || '', along });
      }));
      return { path, cum, steps, total: cum[cum.length - 1] || r.distanceMeters || 1, dist: r.distanceMeters, dur: secs(r.duration), staticDur: secs(r.staticDuration), via: r.description || '' };
    }
    function drawRoutes(fit) {
      clearRoutes();
      if (!G) return;
      st.routes.forEach((r, i) => {
        const line = new G.Polyline({ map: st.map, path: r.path, strokeColor: i === st.sel ? '#4ea8ff' : '#8a93ad', strokeOpacity: i === st.sel ? 1 : .75, strokeWeight: i === st.sel ? 8 : 6, zIndex: i === st.sel ? 10 : 1, clickable: true });
        line.addListener('click', () => { if (st.mode === 'preview') { st.sel = i; drawRoutes(false); renderOverlay(); } });
        polylines.push(line);
      });
      if (fit && st.routes.length) {
        const b = new G.LatLngBounds();
        st.routes[st.sel].path.forEach(p => b.extend(p));
        if (st.pos) b.extend({ lat: st.pos.lat, lng: st.pos.lng });
        st.map.fitBounds(b, { top: 90, bottom: 190, left: 40, right: 80 });
      }
    }

    // ── Travel mode ───────────────────────────────────────────────────────
    async function startNav() {
      const r = st.routes[st.sel];
      if (!r) return;
      if (!st.pos) { toast(t('nav_no_position')); return; }
      st.mode = 'nav'; st.follow = true;
      beginRoute(r, false);
      try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) {}
      st.map.setZoom(17);
      speak(r.steps[0] ? r.steps[0].text : '');
    }
    function beginRoute(r, rerouted) {
      st.routes = [r]; st.sel = 0;
      st.nav = { r, idx: 0, off: 0, said: {}, startedAt: Date.now(), along: 0 };
      drawRoutes(false);
      if (rerouted) toast(t('nav_rerouting'));
      updateNav();
    }
    function stopNav(silent) {
      if (st.mode === 'nav') { st.mode = 'place'; st.nav = null; }
      if (lock) { try { lock.release(); } catch (e) {} lock = null; }
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (!silent) { st.follow = false; st.routes = []; clearRoutes(); renderOverlay(); }
    }
    function updateNav() {
      const n = st.nav;
      if (!n || !st.pos) return;
      const r = n.r;
      let pr = project(r.path, r.cum, st.pos, n.idx - 30, n.idx + 4000);
      if (pr.off > 80) pr = project(r.path, r.cum, st.pos, 0, r.path.length);
      if (pr.off > 80 && (st.pos.acc || 0) < 100) {
        n.off++;
        if (n.off >= 3 && Date.now() - lastRerouteAt > 15000) { lastRerouteAt = Date.now(); n.off = 0; fetchRoutes(true); }
      } else if (pr.off <= 80) { n.off = 0; n.idx = pr.idx; n.along = Math.max(0, pr.along); }
      const remain = Math.max(0, r.total - n.along);
      if (remain < 30) { speak(t('nav_arrived')); toast(t('nav_arrived'), 8000); stopNav(true); st.mode = 'browse'; st.nav = null; if (destMarker) { destMarker.setMap(null); destMarker = null; } st.dest = null; clearRoutes(); renderOverlay(); return; }
      let k = r.steps.findIndex(s => s.along > n.along + 8);
      if (k < 0) k = r.steps.length - 1;
      n.k = k;
      n.toNext = Math.max(0, (r.steps[k] ? r.steps[k].along : r.total) - n.along);
      n.remain = remain;
      n.etaSec = r.dur * remain / r.total;
      announce(k, n.toNext);
      renderOverlay();
    }
    function announce(k, d) {
      const n = st.nav, s = n.r.steps[k];
      if (!s || !s.text) return;
      if (d < 450 && d > 120 && !n.said[k + 'a']) { n.said[k + 'a'] = 1; speak(t('nav_in', { d: spokenDist(d), s: s.text })); }
      else if (d <= 120 && !n.said[k + 'b']) { n.said[k + 'b'] = 1; n.said[k + 'a'] = 1; speak(s.text); }
    }
    const spokenDist = d => d < 950 ? Math.round(d / 50) * 50 + ' ' + t('nav_u_m') : (d / 1000).toFixed(1) + ' ' + t('nav_u_km');
    function speak(text) {
      if (!st.voice || !text || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang() === 'pt-BR' ? 'pt-BR' : lang() === 'zh-CN' ? 'zh-CN' : lang();
      speechSynthesis.speak(u);
    }

    // ── Saved places ──────────────────────────────────────────────────────
    async function loadPlaces() {
      try { st.places = (await api('/places')).places; } catch (e) { st.places = []; }
      drawPlaceMarkers(); renderOverlay();
    }
    function drawPlaceMarkers() {
      placeMarkers.forEach(m => m.setMap(null)); placeMarkers = [];
      if (!G || !st.map) return;
      st.places.forEach(p => {
        const m = new G.Marker({ map: st.map, position: { lat: p.lat, lng: p.lng }, title: p.name,
          icon: { path: 'M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z', fillColor: '#f9c74f', fillOpacity: 1, strokeColor: '#6b4e00', strokeWeight: 1.5, scale: 1.3, anchor: new G.Point(12, 22) } });
        m.addListener('click', () => { if (st.mode !== 'nav') setDest(p); });
        placeMarkers.push(m);
      });
    }
    const isSaved = d => d && st.places.some(p => Math.abs(p.lat - d.lat) < 0.00005 && Math.abs(p.lng - d.lng) < 0.00005);
    async function savePlace(d) {
      const name = await ask(t('nav_name'), d.name);
      if (!name) return;
      try { const p = await api('/places', { method: 'POST', body: JSON.stringify({ name, address: d.address || '', lat: d.lat, lng: d.lng }) }); st.places.push(p); drawPlaceMarkers(); toast(t('nav_saved')); }
      catch (e) { toast(t('nav_error')); }
      renderOverlay();
    }
    async function renamePlace(p) {
      const name = await ask(t('nav_rename'), p.name);
      if (!name) return;
      try { const n = await api('/places/' + p.id, { method: 'PUT', body: JSON.stringify({ name }) }); p.name = n.name; } catch (e) { toast(t('nav_error')); }
      drawPlaceMarkers(); renderOverlay();
    }
    async function deletePlace(p) {
      if (!(await confirmDlg(t('nav_delete_confirm') + ' ' + p.name))) return;
      try { await api('/places/' + p.id, { method: 'DELETE' }); st.places = st.places.filter(x => x.id !== p.id); } catch (e) { toast(t('nav_error')); }
      drawPlaceMarkers(); renderOverlay();
    }
    function distTo(p) { return st.pos ? haversine(st.pos, p) : null; }
    function sortedPlaces() {
      return st.places.slice().sort((a, b) => (distTo(a) ?? 0) - (distTo(b) ?? 0));
    }

    // ── Rendering ─────────────────────────────────────────────────────────
    let ov = null;
    function renderOverlay() {
      if (destroyed || !ov) return;
      const nav = st.mode === 'nav' && st.nav;
      let h = '';
      if (nav) {
        const s = nav.r.steps[nav.k || 0];
        h += `<div class="nv-banner"><div class="dist">${esc(fmtDist(nav.toNext || 0))}</div><div class="ins">${esc(s ? s.text : '')}</div></div>`;
        h += `<div class="nv-side"><button class="nv-btn ${st.follow ? 'on' : ''}" data-a="locate" title="${esc(t('nav_locate'))}">⌖</button><button class="nv-btn ${st.rotate ? 'on' : ''}" data-a="rotate" title="${esc(st.rotate ? t('nav_north') : t('nav_rotate'))}">🧭</button><button class="nv-btn ${st.voice ? 'on' : ''}" data-a="voice" title="${esc(st.voice ? t('nav_voice_on') : t('nav_voice_off'))}">${st.voice ? '🔊' : '🔇'}</button></div>`;
        const eta = Date.now() + (nav.etaSec || 0) * 1000;
        const kmh = st.pos && st.pos.speed != null ? Math.round(st.pos.speed * 3.6) : '–';
        h += `<div class="nv-bottom"><div class="nv-stats">
          <div><b>${fmtClock(eta)}</b><span>${esc(t('nav_arrive'))}</span></div>
          <div><b>${esc(fmtDur(nav.etaSec || 0))}</b><span>${esc(t('nav_remaining'))}</span></div>
          <div><b>${esc(fmtDist(nav.remain || 0))}</b><span>${esc(t('nav_distance_left'))}</span></div>
          <div><b>${kmh}</b><span>${esc(t('nav_speed'))} ${esc(t('nav_u_kmh'))}</span></div></div>
          <div class="nv-actions" style="margin-top:12px"><button class="nv-btn red" data-a="stop" style="flex:1">${esc(t('nav_stop'))}</button></div></div>`;
      } else {
        h += `<div class="nv-top"><div class="nv-search"><input type="search" id="nv-q" placeholder="${esc(t('nav_search'))}" value="${esc(st.query)}" autocomplete="off"><button class="nv-btn" data-a="clear" ${st.query ? '' : 'hidden'}>✕</button></div>`;
        if (st.results.length) h += `<div class="nv-list">${st.results.map((r, i) => `<div class="nv-row" data-a="res" data-i="${i}"><div class="main"><div class="ttl">${esc(r.name)}</div><div class="sub">${esc(r.address)}</div></div></div>`).join('')}</div>`;
        h += `</div>`;
        h += `<div class="nv-side"><button class="nv-btn ${st.follow ? 'on' : ''}" data-a="locate" title="${esc(t('nav_locate'))}">⌖</button><button class="nv-btn ${st.rotate ? 'on' : ''}" data-a="rotate" title="${esc(st.rotate ? t('nav_north') : t('nav_rotate'))}">🧭</button><button class="nv-btn ${st.listOpen ? 'on' : ''}" data-a="places" title="${esc(t('nav_places'))}">⭐</button><button class="nv-btn" data-a="theme" title="${esc(st.dark ? t('nav_light') : t('nav_dark'))}">${st.dark ? '☀️' : '🌙'}</button></div>`;
        if ((st.mode === 'place' || st.mode === 'preview') && st.dest) {
          const d = st.dest;
          const near = distTo(d);
          h += `<div class="nv-bottom"><h3>${esc(d.name)}</h3><div class="addr">${esc(d.address)}${near != null ? ' · ' + esc(t('nav_away', { d: fmtDist(near) })) : ''}</div>`;
          if (st.mode === 'preview' && st.routes.length) h += `<div class="nv-routes">${st.routes.map((r, i) => `<div class="rt ${i === st.sel ? 'on' : ''}" data-a="route" data-i="${i}"><b>${esc(fmtDur(r.dur))}</b><span>${esc(fmtDist(r.dist))}${r.via ? ' · ' + esc(r.via) : ''}</span></div>`).join('')}</div>`;
          else if (st.mode === 'preview' && st.busy) h += `<div class="addr">…</div>`;
          h += `<div class="nv-actions">${st.mode === 'place' ? `<button class="nv-btn pri" data-a="directions">🧭 ${esc(t('nav_directions'))}</button>` : `<button class="nv-btn pri" data-a="start" ${st.routes.length ? '' : 'disabled'}>▶ ${esc(t('nav_start'))}</button>`}${isSaved(d) ? '' : `<button class="nv-btn" data-a="save">⭐ ${esc(t('nav_save'))}</button>`}<button class="nv-btn" data-a="close">✕</button></div></div>`;
        } else if (st.listOpen) {
          const list = sortedPlaces();
          h += `<div class="nv-bottom" style="max-height:60%;overflow-y:auto;padding:6px">
            <div class="nv-actions" style="padding:6px"><button class="nv-btn pri" data-a="savehere">📍 ${esc(t('nav_save_here'))}</button></div>
            ${list.length ? list.map(p => { const d = distTo(p); return `<div class="nv-row" data-a="place" data-id="${esc(p.id)}"><div class="main"><div class="ttl">${esc(p.name)}</div><div class="sub">${esc(p.address)}</div></div><div class="dist">${d == null ? '' : esc(fmtDist(d))}</div><button class="ic" data-a="rename" data-id="${esc(p.id)}" title="${esc(t('nav_rename'))}">✏️</button><button class="ic" data-a="del" data-id="${esc(p.id)}" title="${esc(t('nav_delete'))}">🗑</button></div>`; }).join('') : `<div class="addr" style="padding:12px">${esc(t('nav_no_places'))}</div>`}</div>`;
        } else if (st.places.length) {
          h += `<div class="nv-chips">${sortedPlaces().slice(0, 8).map(p => { const d = distTo(p); return `<div class="nv-chip" data-a="place" data-id="${esc(p.id)}">⭐ ${esc(p.name)}${d == null ? '' : `<b>${esc(fmtDist(d))}</b>`}</div>`; }).join('')}</div>`;
        }
      }
      if (st.toast) h += `<div class="nv-toast">${esc(st.toast)}</div>`;
      // Keep the search box (and its focus/caret) alive while typing.
      const q = ov.querySelector('#nv-q'), had = q && document.activeElement === q, caret = q ? q.selectionStart : 0;
      ov.innerHTML = h;
      const q2 = ov.querySelector('#nv-q');
      if (q2) {
        q2.oninput = () => onInput(q2.value);
        q2.onkeydown = e => { if (e.key === 'Enter' && q2.value.trim()) { clearTimeout(searchTimer); searchText(q2.value.trim()); } };
        if (had) { q2.focus(); try { q2.setSelectionRange(caret, caret); } catch (e) {} }
      }
    }

    function onClick(e) {
      const el = e.target.closest('[data-a]');
      if (!el) return;
      const a = el.dataset.a;
      const place = el.dataset.id && st.places.find(p => p.id === el.dataset.id);
      if (a === 'clear') { st.query = ''; st.results = []; renderOverlay(); }
      else if (a === 'res') pickResult(st.results[+el.dataset.i]);
      else if (a === 'locate') locateOnce();
      else if (a === 'places') { st.listOpen = !st.listOpen; renderOverlay(); }
      else if (a === 'theme') { st.dark = !st.dark; localStorage.setItem('nav_dark', st.dark ? '1' : '0'); if (st.vector) { const r = st.rotate; setVector(true).then(() => { st.rotate = r && st.vector; renderOverlay(); }); } else { st.map.setOptions({ styles: st.dark ? DARK_STYLE : [] }); renderOverlay(); } }
      else if (a === 'rotate') toggleRotate();
      else if (a === 'voice') { st.voice = !st.voice; localStorage.setItem('nav_voice', st.voice ? '1' : '0'); if (!st.voice && window.speechSynthesis) speechSynthesis.cancel(); renderOverlay(); }
      else if (a === 'place' && place) { st.listOpen = false; setDest(place); }
      else if (a === 'rename' && place) renamePlace(place);
      else if (a === 'del' && place) deletePlace(place);
      else if (a === 'savehere') { if (!st.pos) { toast(t('nav_no_position')); return; } savePlace({ name: t('nav_my_location'), address: '', lat: st.pos.lat, lng: st.pos.lng }); }
      else if (a === 'route') { st.sel = +el.dataset.i; drawRoutes(false); renderOverlay(); }
      else if (a === 'directions') { st.mode = 'preview'; renderOverlay(); fetchRoutes(); }
      else if (a === 'start') startNav();
      else if (a === 'stop') stopNav(false);
      else if (a === 'save') savePlace(st.dest);
      else if (a === 'close') closeDest();
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    async function boot() {
      try { const cfg = await api('/config'); st.key = cfg.api_key; st.mapId = cfg.map_id || ''; } catch (e) { w.innerHTML = `<div class="nv-msg">${esc(t(e.message === 'private' ? 'nav_private' : 'nav_error'))}</div>`; return; }
      if (!st.key) { w.innerHTML = `<div class="nv-msg">${esc(t('nav_no_key'))}</div>`; return; }
      try { await loadMaps(st.key); } catch (e) { w.innerHTML = `<div class="nv-msg">${esc(t('nav_maps_failed'))}</div>`; return; }
      if (destroyed) return;
      await Promise.all(['core', 'maps', 'marker'].map(l => window.google.maps.importLibrary(l)));
      G = window.google.maps;
      w.innerHTML = '<div class="nv-map"></div><div class="nv-ov"></div>';
      ov = w.querySelector('.nv-ov');
      buildMap(false);
      ov.addEventListener('click', onClick);
      renderOverlay();
      await loadPlaces();
      startWatch();
      locateOnce();
    }
    boot();

    return {
      destroy() {
        destroyed = true;
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        if (lock) { try { lock.release(); } catch (e) {} }
        if (window.speechSynthesis) speechSynthesis.cancel();
        clearTimeout(searchTimer); clearTimeout(toastTimer);
      },
    };
  }

  window.NavigationWidget = { mount };
})();
