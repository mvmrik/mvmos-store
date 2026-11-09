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

  // Which side of a path a point lies on, looking along the direction of travel.
  function sideOf(path, idx, p) {
    const a = path[idx], b = path[Math.min(path.length - 1, idx + 1)];
    const k = Math.cos(rad(p.lat));
    const dx = (b.lng - a.lng) * k, dy = b.lat - a.lat;
    const vx = (p.lng - a.lng) * k, vy = p.lat - a.lat;
    return dx * vy - dy * vx > 0 ? 'left' : 'right';
  }

  // ── Places by kind: OpenStreetMap through Overpass (free, no key) ────────
  const CATS = [
    { id: 'fuel', icon: '⛽', q: '["amenity"="fuel"]' },
    { id: 'charging', icon: '🔌', q: '["amenity"="charging_station"]' },
    { id: 'food', icon: '🍽', q: '["amenity"~"^(restaurant|fast_food|cafe)$"]' },
    { id: 'parking', icon: '🅿️', q: '["amenity"="parking"]["access"!~"^(private|no|customers)$"]' },
    { id: 'shop', icon: '🛒', q: '["shop"~"^(supermarket|convenience|mall)$"]' },
    { id: 'pharmacy', icon: '💊', q: '["amenity"="pharmacy"]' },
    { id: 'atm', icon: '🏧', q: '["amenity"="atm"]' },
    { id: 'hospital', icon: '🏥', q: '["amenity"="hospital"]' },
  ];
  const OVERPASS = 'https://overpass-api.de/api/interpreter';
  const AHEAD = 50000;          // how far along the route to look (m)
  const poiCache = new Map();
  async function overpass(cat, area) {
    const key = cat.id + '|' + area;
    const hit = poiCache.get(key);
    if (hit && Date.now() - hit.t < 300000) return hit.d;
    const q = '[out:json][timeout:25];nwr' + cat.q + '(' + area + ');out center tags 300;';
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      if (!r.ok) throw new Error('overpass_' + r.status);
      const j = await r.json();
      const d = j.elements || [];
      if (j.remark && !d.length) throw new Error('overpass_busy');
      poiCache.set(key, { t: Date.now(), d });
      return d;
    } finally { clearTimeout(tm); }
  }
  function poiItem(cat, e) {
    const tg = e.tags || {};
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lng != null ? e.lng : (e.lon != null ? e.lon : e.center && e.center.lon);
    if (lat == null || lng == null) return null;
    const addr = [tg['addr:street'], tg['addr:housenumber']].filter(Boolean).join(' ');
    const brand = tg.brand && tg.brand !== tg.name ? tg.brand : tg.operator;
    return { id: e.type + e.id, cat: cat.id, icon: cat.icon, lat, lng, address: addr,
      name: tg.name || tg.brand || tg.operator || t('nav_cat_' + cat.id), extra: [brand && brand !== (tg.name || '') ? brand : '', addr].filter(Boolean).join(' · ') };
  }
  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

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
  const picker = () => window.mvmOS && window.mvmOS.dateTimePicker;
  // Clock times and dates follow the mvmOS display settings (12/24 h, date order, time zone).
  function fmtClock(ms) {
    const dp = picker();
    if (dp) { try { return dp.format(dp.fromEpoch(Math.floor(ms / 1000), { type: 'time' }), { type: 'time' }); } catch (e) {} }
    return new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  }
  function fmtWhen(ms) {
    const dp = picker();
    if (dp) { try { return dp.format(dp.fromEpoch(Math.floor(ms / 1000), { type: 'datetime' }), { type: 'datetime' }); } catch (e) {} }
    return new Date(ms).toLocaleString(lang());
  }
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
      .nv-btn.pri{background:var(--pub-accent,#89b4fa);color:var(--on-accent,var(--pub-surface1,#11111b));font-weight:700}
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
      .nv-side .nv-btn.on{background:var(--pub-accent,#89b4fa);color:var(--on-accent,var(--pub-surface1,#11111b))}
      .nv-bottom{position:absolute;left:10px;right:10px;bottom:10px;z-index:5;max-width:640px;background:var(--pub-surface1,#313244);border-radius:18px;box-shadow:0 4px 22px #000a;padding:14px}
      .nv-bottom h3{margin:0 0 2px;font-size:1.15rem}
      .nv-bottom .addr{font-size:.85rem;color:var(--pub-fg2,#a6adc8);margin-bottom:10px}
      .nv-modes{display:flex;gap:8px;margin-bottom:10px}
      .nv-modes .md{flex:1;text-align:center;border:2px solid transparent;border-radius:12px;background:var(--pub-surface2,#45475a);padding:8px 10px;cursor:pointer}
      .nv-modes .md.on{border-color:var(--pub-accent,#89b4fa)}
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
      .nv-cats::-webkit-scrollbar,.nv-chips::-webkit-scrollbar,.nv-routes::-webkit-scrollbar{display:none}
      .nv-cats,.nv-chips,.nv-routes{scrollbar-width:none}
      .nv-cats{display:flex;gap:6px;overflow-x:auto;margin-top:6px;padding-bottom:2px}
      .nv-cat{flex:0 0 auto;background:var(--pub-surface1,#313244);border:2px solid transparent;border-radius:18px;padding:7px 12px;box-shadow:0 2px 10px #0008;cursor:pointer;white-space:nowrap;font-size:.92rem}
      .nv-cat.on{border-color:var(--pub-accent,#89b4fa)}
      .nv-row .pi{font-size:1.4rem;flex:0 0 auto}
      .nv-row .sub.hl{color:var(--pub-fg,#cdd6f4);font-weight:600}
      .nv-stops{margin:0 0 10px}
      .nv-stoprow{display:flex;align-items:center;gap:8px;padding:3px 0}
      .nv-stoprow .n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:#b85c00;color:#fff;font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center}
      .nv-stoprow .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nv-stoprow .ic{background:transparent;border:0;color:inherit;font-size:1rem;padding:6px;cursor:pointer;opacity:.8}
      .nv-actions.col{flex-direction:column}
      .nv-actions.col .nv-btn{width:100%}
      .nv-prog{cursor:pointer}
      .nv-pm{position:absolute;inset:0;z-index:9;display:flex;align-items:center;justify-content:center;background:#000a}
      .pm-box{background:var(--pub-surface1,#313244);color:var(--pub-fg,#cdd6f4);border-radius:16px;width:min(460px,92%);height:min(82%,760px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px #000a}
      .pm-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-size:1.1rem}
      .pm-list{position:relative;flex:1;overflow-y:auto;padding:10px 14px 24px}
      .pm-row{position:relative;padding:9px 0 9px 44px;min-height:34px;display:flex;align-items:center}
      .pm-row::before{content:'';position:absolute;left:15px;top:0;bottom:0;width:4px;border-radius:2px;background:var(--pub-surface2,#45475a)}
      .pm-row.p::before{background:#1f7a4d}
      .pm-row.y::before{background:linear-gradient(var(--pub-surface2,#45475a) 0 50%,#1f7a4d 50% 100%)}
      .pm-node{position:absolute;left:4px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;background:#b85c00;color:#fff;border:2px solid #fff;box-sizing:border-box;font-size:.78rem;font-weight:700;display:flex;align-items:center;justify-content:center}
      .pm-row.p .pm-node{background:#1f7a4d}
      .pm-row.p:not(.leg) .ttl{opacity:.7}
      .pm-row.y .pm-node{background:#4ea8ff;width:30px;height:30px;left:2px}
      .pm-row.y{background:#4ea8ff22;border-radius:10px}
      .pm-row.leg{min-height:30px;font-size:.82rem;color:var(--pub-fg2,#a6adc8)}
      .pm-t .ttl{font-weight:600}
      .pm-t .sub{font-size:.82rem;color:var(--pub-fg2,#a6adc8)}
      .nv-pm.nw .pm-box{width:100%;height:100%;border-radius:0}
      .nv-prog.h{margin:2px 0 14px;padding:0 10px}
      .nv-prog .track{position:relative;height:8px;border-radius:4px;background:var(--pub-surface2,#45475a)}
      .nv-prog .fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--pub-accent,#89b4fa)}
      .nv-prog .dot{position:absolute;width:20px;height:20px;border-radius:50%;transform:translate(-50%,-50%);background:#b85c00;color:#fff;border:2px solid #fff;font-size:.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
      .nv-prog .dot.done{background:#1f7a4d}
      .nv-prog .flag{position:absolute;transform:translate(-50%,-50%);font-size:1.05rem;line-height:1}
      .nv-prog .me{position:absolute;width:16px;height:16px;border-radius:50%;transform:translate(-50%,-50%);background:#4ea8ff;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px #0008}
      .nv-prog.h .track .dot,.nv-prog.h .track .flag,.nv-prog.h .track .me{top:50%}
      .nv-prog .lbls{display:flex;justify-content:space-between;margin-top:12px;font-size:.78rem;color:var(--pub-fg2,#a6adc8)}
      .nv-prog .lbls b{color:var(--pub-fg,#cdd6f4);font-variant-numeric:tabular-nums}
      .nv-prog.v{position:absolute;right:14px;top:258px;bottom:196px;width:42px;z-index:4;display:flex;flex-direction:column;align-items:center;gap:6px;min-height:110px}
      .nv-prog.v .track{flex:1;width:8px}
      .nv-prog.v .fill{right:0;bottom:auto;height:auto}
      .nv-prog.v .track .dot,.nv-prog.v .track .flag,.nv-prog.v .track .me{left:50%}
      .nv-prog.v .lb{background:var(--pub-surface1,#313244);border-radius:10px;padding:3px 6px;font-size:.72rem;font-weight:700;text-align:center;box-shadow:0 2px 8px #0008;white-space:nowrap}
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
      voice: localStorage.getItem('nav_voice') !== '0', travel: ['WALK', 'TRANSIT'].includes(localStorage.getItem('nav_travel')) ? localStorage.getItem('nav_travel') : 'DRIVE', progOpen: false, pmCenter: false, follow: true, listOpen: false,
      query: '', results: [], dest: null, routes: [], sel: 0, mode: 'browse', toast: '', busy: false,
      nav: null, stops: [], history: [], histOpen: false, tripId: null,
      poi: { cat: null, items: [], busy: false, show: false, mode: 'around', fetchedAlong: 0 },
    };
    let G = null;                 // google.maps namespace
    let marker = null, destMarker = null, accCircle = null, polylines = [], placeMarkers = [], poiMarkers = [], stopMarkers = [], poiSeq = 0;
    let watchId = null, lock = null, destroyed = false, sessionToken = newSession(), searchTimer = null, toastTimer = null;
    let lastRerouteAt = 0, onResize = null;

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
        pickPlace({ name: t('nav_pin'), address: ll.lat().toFixed(5) + ', ' + ll.lng().toFixed(5), lat: ll.lat(), lng: ll.lng() });
      });
      // Everything drawn on the old map goes with it; draw it again on the new one.
      marker = null; accCircle = null; destMarker = null; polylines = []; placeMarkers = []; poiMarkers = []; stopMarkers = [];
      drawMe(); drawPlaceMarkers(); drawDestMarker(); drawRoutes(false); drawPoiMarkers(); drawStopMarkers();
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
    // Walking: the arrow follows the phone's compass, so it shows where you face even when standing still.
    let compassHdg = null, compassOn = false, compassT = 0;
    function onCompass(e) {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
      if (h == null || isNaN(h)) return;
      const now = Date.now();
      if (now - compassT < 120 || (compassHdg != null && Math.abs(((h - compassHdg + 540) % 360) - 180) < 3)) return;
      compassT = now; compassHdg = h;
      if (st.travel !== 'DRIVE' && st.pos) drawMe();
    }
    async function startCompass() {
      if (compassOn || typeof window.DeviceOrientationEvent === 'undefined') return;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
      } catch (e) { return; }
      compassOn = true;
      window.addEventListener('deviceorientationabsolute', onCompass, true);
      window.addEventListener('deviceorientation', onCompass, true);
    }
    function faceHdg() {
      if (compassHdg != null && (st.travel === 'WALK' || (st.travel === 'TRANSIT' && !(st.pos && st.pos.speed > 2.5)))) return compassHdg;
      return st.pos && st.pos.heading != null ? st.pos.heading : null;
    }
    function applyHeading() {
      const hd = faceHdg();
      if (!st.rotate || !st.vector || !st.pos || hd == null || (st.travel === 'DRIVE' && st.pos.speed != null && st.pos.speed <= 1)) return;
      const cur = st.map.getHeading() || 0;
      if (Math.abs(((hd - cur + 540) % 360) - 180) > 2) st.map.setHeading(hd);
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
      const hd = faceHdg();
      const arrow = st.travel !== 'DRIVE' ? hd != null : (st.pos.heading != null && (st.pos.speed == null || st.pos.speed > 1));
      const icon = arrow
        ? { path: G.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: st.rotate && st.vector ? 0 : hd, fillColor: '#4ea8ff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
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
      if (m) { pickPlace({ name: t('nav_pin'), address: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`, lat: +m[1], lng: +m[2] }); return; }
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
      pickPlace(r);
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
      st.dest = null; st.mode = 'browse'; st.routes = []; st.stops = [];
      if (destMarker) { destMarker.setMap(null); destMarker = null; }
      clearRoutes(); drawStopMarkers(); renderOverlay();
      if (st.poi.cat) loadPoi();
    }
    let pendingCarry = null;
    async function fetchRoutes(reroute, carry) {
      if (!st.dest) return;
      const origin = st.pos || (st.map && { lat: st.map.getCenter().lat(), lng: st.map.getCenter().lng() });
      if (!st.pos && !reroute) toast(t('nav_no_position'));
      if (!origin) return;
      const loc = { latLng: { latitude: origin.lat, longitude: origin.lng } };
      if (reroute && st.pos && st.pos.heading != null && (st.pos.speed || 0) > 3) loc.heading = Math.round(st.pos.heading);
      st.busy = true; renderOverlay();
      try {
        if (st.travel === 'TRANSIT') { await fetchTransit(origin, reroute, carry); st.busy = false; renderOverlay(); return; }
        const d = await google('https://routes.googleapis.com/directions/v2:computeRoutes', {
          origin: { location: loc },
          destination: { location: { latLng: { latitude: st.dest.lat, longitude: st.dest.lng } } },
          ...(st.stops.length ? { intermediates: st.stops.map(p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })) } : {}),
          travelMode: st.travel, ...(st.travel === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}), computeAlternativeRoutes: !reroute && !st.stops.length,
          languageCode: lang(), units: 'METRIC',
        }, 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,' +
           'routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.endLocation');
        st.routes = (d.routes || []).map(prepRoute);
        st.sel = 0;
        if (!st.routes.length) toast(t('nav_no_route'));
        drawRoutes(!reroute);
        if (reroute && st.routes.length && (st.mode === 'nav' || carry)) beginRoute(st.routes[0], true, carry);
        if (st.poi.cat) loadPoi();
      } catch (e) { toast(t('nav_api_failed')); }
      st.busy = false; renderOverlay();
    }
    // Public transport: Google cannot route through intermediate points, so every
    // stop becomes its own request and the parts are chained into one trip whose
    // walk and ride legs show up as points on the progress.
    const VEH = { BUS: '🚌', INTERCITY_BUS: '🚌', TROLLEYBUS: '🚎', SUBWAY: '🚇', METRO_RAIL: '🚇', TRAM: '🚋', LIGHT_RAIL: '🚋', HEAVY_RAIL: '🚆', RAIL: '🚆', COMMUTER_TRAIN: '🚆', HIGH_SPEED_TRAIN: '🚆', LONG_DISTANCE_TRAIN: '🚆', FERRY: '⛴️' };
    async function fetchTransit(origin, reroute, carry) {
      const pts = [origin].concat(st.stops, [st.dest]);
      const mask = 'routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.transitDetails';
      const parts = []; let when = Date.now();
      for (let i = 0; i < pts.length - 1; i++) {
        const body = {
          origin: { location: { latLng: { latitude: pts[i].lat, longitude: pts[i].lng } } },
          destination: { location: { latLng: { latitude: pts[i + 1].lat, longitude: pts[i + 1].lng } } },
          travelMode: 'TRANSIT', computeAlternativeRoutes: pts.length === 2 && !reroute, languageCode: lang(), units: 'METRIC',
        };
        if (i) body.departureTime = new Date(when).toISOString();
        const d = await google('https://routes.googleapis.com/directions/v2:computeRoutes', body, mask);
        const rs = d.routes || [];
        if (!rs.length) { st.routes = []; clearRoutes(); toast(t('nav_no_transit')); return; }
        parts.push(rs); when += secs(rs[0].duration) * 1000 + 180000;
      }
      const n = pts.length === 2 ? parts[0].length : 1;
      st.routes = [];
      for (let k = 0; k < n; k++) st.routes.push(prepTransit(parts.map((rs, i) => i === 0 ? rs[k] : rs[0]), pts));
      st.sel = 0;
      drawRoutes(!reroute);
      if (reroute && (st.mode === 'nav' || carry)) beginRoute(st.routes[0], true, carry);
      if (st.poi.cat) loadPoi();
    }
    function prepTransit(parts, pts) {
      const path = [], cum = [0], marks = [], segs = [];
      let dur = 0, dist = 0;
      const addPoly = enc => decodePolyline(enc).forEach(p => {
        if (!path.length) { path.push(p); return; }
        const d = haversine(path[path.length - 1], p);
        if (d < 0.5) return;
        cum.push(cum[cum.length - 1] + d); path.push(p);
      });
      parts.forEach((rt, pi) => {
        dur += secs(rt.duration); dist += rt.distanceMeters || 0;
        (rt.legs || []).forEach(leg => (leg.steps || []).forEach(s => {
          if (!s.polyline || !s.polyline.encodedPolyline) return;
          const a = cum[cum.length - 1];
          addPoly(s.polyline.encodedPolyline);
          const b = cum[cum.length - 1];
          if (s.travelMode === 'TRANSIT' && s.transitDetails) {
            const td = s.transitDetails, sd = td.stopDetails || {}, ln = td.transitLine || {};
            const line = ln.nameShort || ln.name || '', veh = (ln.vehicle && ln.vehicle.type) || '';
            const sl = s.startLocation && s.startLocation.latLng, el = s.endLocation && s.endLocation.latLng;
            marks.push({ kind: 'board', name: (sd.departureStop || {}).name || '', lat: sl ? sl.latitude : path[0].lat, lng: sl ? sl.longitude : path[0].lng, at: a, line, veh, time: Date.parse(sd.departureTime) || 0 });
            marks.push({ kind: 'alight', name: (sd.arrivalStop || {}).name || '', lat: el ? el.latitude : path[path.length - 1].lat, lng: el ? el.longitude : path[path.length - 1].lng, at: b, line, veh, time: Date.parse(sd.arrivalTime) || 0 });
            segs.push({ from: a, to: b, kind: 'transit', line, veh, n: td.stopCount || 0 });
          } else segs.push({ from: a, to: b, kind: 'walk' });
        }));
        if (pi < parts.length - 1) { const sp = pts[pi + 1]; marks.push({ kind: 'stop', name: sp.name, lat: sp.lat, lng: sp.lng, at: cum[cum.length - 1] }); }
      });
      const via = segs.filter(x => x.kind === 'transit').map(x => (VEH[x.veh] || '🚌') + ' ' + x.line).join(' › ');
      return { path, cum, steps: [], total: cum[cum.length - 1] || dist || 1, dist, dur, staticDur: dur, via, segs, pts: marks, transit: true };
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
      histStart();
      speak(r.steps[0] ? r.steps[0].text : '');
      if (st.poi.cat) loadPoi();
    }
    function beginRoute(r, rerouted, carry) {
      st.routes = [r]; st.sel = 0;
      // Distance and points already done before a reroute or a resume stay part of the trip's progress.
      const old = carry || (rerouted && st.nav ? st.nav : null);
      const base = old ? old.base + old.along : 0;
      const fresh = r.pts ? r.pts.map(m => Object.assign({}, m, { done: false }))
        : st.stops.map(sp => ({ kind: 'stop', name: sp.name, lat: sp.lat, lng: sp.lng, at: project(r.path, r.cum, sp, 0, r.path.length).along, done: false }));
      const marks = (old ? old.marks.filter(m => m.done) : []).concat(fresh.map(m => Object.assign(m, { at: base + m.at })));
      st.nav = { r, idx: 0, off: 0, said: {}, startedAt: Date.now(), along: 0, base, marks };
      if (carry) { st.mode = 'nav'; st.follow = true; }
      drawRoutes(false);
      if (rerouted && !carry) toast(t('nav_rerouting'));
      updateNav();
      saveActive(true);
    }
    function stopNav(silent) {
      if (st.mode === 'nav') { histEnd('stopped'); clearActive(); st.mode = 'place'; st.nav = null; st.progOpen = false; }
      if (lock) { try { lock.release(); } catch (e) {} lock = null; }
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (!silent) { st.follow = false; st.routes = []; clearRoutes(); renderOverlay(); if (st.poi.cat) loadPoi(); }
    }
    function updateNav() {
      const n = st.nav;
      if (!n || !n.r || !st.pos) return;
      const r = n.r;
      let pr = project(r.path, r.cum, st.pos, n.idx - 30, n.idx + 4000);
      if (pr.off > 80) pr = project(r.path, r.cum, st.pos, 0, r.path.length);
      if (pr.off > 80 && (st.pos.acc || 0) < 100) {
        n.off++;
        if (n.off >= 3 && st.travel !== 'TRANSIT' && Date.now() - lastRerouteAt > 15000) { lastRerouteAt = Date.now(); n.off = 0; fetchRoutes(true); }
      } else if (pr.off <= 80) { n.off = 0; n.idx = pr.idx; n.along = Math.max(0, pr.along); }
      if (pr.off <= 80) {
        // Points are reached in order: close enough (80 m, 150 m for a transit stop) or already left behind on the route.
        let changed = false;
        for (const mk of n.marks) {
          if (mk.done) continue;
          const near = haversine(st.pos, mk) < (mk.kind === 'stop' ? 80 : 150), passed = mk.at - n.base < n.along - 120;
          if (!near && !passed) break;
          mk.done = true; changed = true;
          if (mk.kind === 'stop') { st.stops.shift(); drawStopMarkers(); }
          if (near) { const msg = mk.kind === 'stop' ? t('nav_stop_reached', { n: mk.name }) : markLabel(mk); speak(msg); toast(msg, 6000); }
        }
        if (changed) saveActive(true);
      }
      const remain = Math.max(0, r.total - n.along);
      if (remain < 30) { histEnd('arrived'); clearActive(); st.progOpen = false; st.stops = []; drawStopMarkers(); speak(t('nav_arrived')); toast(t('nav_arrived'), 8000); stopNav(true); st.mode = 'browse'; st.nav = null; if (destMarker) { destMarker.setMap(null); destMarker = null; } st.dest = null; clearRoutes(); renderOverlay(); return; }
      let k = r.steps.findIndex(s => s.along > n.along + 8);
      if (k < 0) k = r.steps.length - 1;
      n.k = k;
      n.toNext = Math.max(0, (r.steps[k] ? r.steps[k].along : r.total) - n.along);
      n.remain = remain;
      n.etaSec = r.dur * remain / r.total;
      saveActive(false);
      announce(k, n.toNext);
      if (st.poi.cat && st.poi.mode === 'route' && !st.poi.busy && n.along - st.poi.fetchedAlong > 15000) loadPoi();
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

    // ── Places by kind ────────────────────────────────────────────────────
    const mapCenter = () => st.map && { lat: st.map.getCenter().lat(), lng: st.map.getCenter().lng() };
    const searchCenter = () => (st.pos && st.follow) ? st.pos : (mapCenter() || st.pos);
    function routeNow() {
      if (st.mode === 'nav' && st.nav) return st.nav.r;
      if (st.mode === 'preview' && st.routes[st.sel]) return st.routes[st.sel];
      return null;
    }
    function alongNow(r) {
      if (st.mode === 'nav' && st.nav) return st.nav.along;
      if (!st.pos) return 0;
      const pr = project(r.path, r.cum, st.pos, 0, r.path.length);
      return pr.off < 500 ? pr.along : 0;
    }
    function idxAt(r, d) { let i = 0; while (i < r.cum.length - 1 && r.cum[i] < d) i++; return i; }
    async function loadPoi() {
      const p = st.poi, cat = CATS.find(c => c.id === p.cat), seq = ++poiSeq;
      if (!cat) { p.items = []; p.busy = false; drawPoiMarkers(); renderOverlay(); return; }
      p.busy = true; renderOverlay();
      try {
        const r = routeNow();
        let items, mode, fetchedAlong = 0, c = null;
        if (r) {
          const cur = alongNow(r), lim = Math.min(r.total, cur + AHEAD);
          const i0 = Math.max(0, idxAt(r, cur - 200) - 1), i1 = Math.min(r.path.length - 1, idxAt(r, lim + 300) + 1);
          const pts = []; let lastD = -1e9;
          for (let i = i0; i <= i1; i++) {
            if (r.cum[i] - lastD >= 1000 || i === i1) { pts.push(r.path[i].lat.toFixed(5), r.path[i].lng.toFixed(5)); lastD = r.cum[i]; }
          }
          const els = await overpass(cat, 'around:800,' + pts.join(','));
          items = els.map(e => poiItem(cat, e)).filter(Boolean).map(it => {
            const pr = project(r.path, r.cum, it, i0, i1 + 1);
            it.along = pr.along; it.off = pr.off; it.side = sideOf(r.path, pr.idx, it);
            return it;
          }).filter(it => it.off <= 900 && it.along >= cur - 100 && it.along <= lim + 300).sort((a, b) => a.along - b.along);
          mode = 'route'; fetchedAlong = cur;
        } else {
          c = searchCenter();
          if (!c) throw new Error('nopos');
          const at = r2 => 'around:' + r2 + ',' + c.lat.toFixed(3) + ',' + c.lng.toFixed(3);
          let els = await overpass(cat, at(5000));
          if (els.length < 3) els = await overpass(cat, at(20000));
          items = els.map(e => poiItem(cat, e)).filter(Boolean).map(it => { it.dist = haversine(c, it); it.bearing = bearing(c, it); return it; })
            .sort((a, b) => a.dist - b.dist);
          mode = 'around';
        }
        if (seq !== poiSeq) return;
        p.items = items.slice(0, 40); p.mode = mode; p.fetchedAlong = fetchedAlong;
        if (!p.items.length) toast(t('nav_poi_none'));
        else if (mode === 'around' && st.mode !== 'nav') fitPoi(c);
      } catch (e) { if (seq !== poiSeq) return; p.items = []; toast(t(e.message === 'nopos' ? 'nav_no_position' : 'nav_poi_failed')); }
      p.busy = false; drawPoiMarkers(); renderOverlay();
    }
    function fitPoi(c) {
      if (!G || !st.map) return;
      const b = new G.LatLngBounds();
      if (c) b.extend({ lat: c.lat, lng: c.lng });
      st.poi.items.slice(0, 10).forEach(i => b.extend({ lat: i.lat, lng: i.lng }));
      st.follow = false;
      st.map.fitBounds(b, { top: 150, bottom: 120, left: 40, right: 80 });
    }
    function drawPoiMarkers() {
      poiMarkers.forEach(m => m.setMap(null)); poiMarkers = [];
      if (!G || !st.map || !st.poi.cat) return;
      st.poi.items.forEach(it => {
        const m = new G.Marker({ map: st.map, position: { lat: it.lat, lng: it.lng }, title: it.name, zIndex: 50,
          label: { text: it.icon, fontSize: '15px' },
          icon: { path: G.SymbolPath.CIRCLE, scale: 15, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#1d2230', strokeWeight: 2 } });
        m.addListener('click', () => pickPlace(it));
        poiMarkers.push(m);
      });
    }
    function drawStopMarkers() {
      stopMarkers.forEach(m => m.setMap(null)); stopMarkers = [];
      if (!G || !st.map) return;
      st.stops.forEach((s, i) => {
        stopMarkers.push(new G.Marker({ map: st.map, position: { lat: s.lat, lng: s.lng }, title: s.name, zIndex: 60,
          label: { text: String(i + 1), color: '#ffffff', fontWeight: '700', fontSize: '13px' },
          icon: { path: G.SymbolPath.CIRCLE, scale: 13, fillColor: '#b85c00', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } }));
      });
    }

    // ── Choosing a place: destination or a stop ───────────────────────────
    function pickPlace(d) {
      if (!d) return;
      st.listOpen = false;
      if (!st.dest) { setDest(d); return; }
      const el = document.createElement('div');
      el.className = 'nv-dlg';
      el.innerHTML = `<div><b>${esc(t('nav_pick_title', { n: d.name }))}</b><div style="font-size:.85rem;opacity:.75;margin:4px 0 14px">${esc(d.address || '')}</div>
        <div class="nv-actions col"><button class="nv-btn pri" data-r="stop">📍 ${esc(t('nav_as_stop'))}</button><button class="nv-btn" data-r="dest">🏁 ${esc(t('nav_as_dest'))}</button>${isSaved(d) ? '' : `<button class="nv-btn" data-r="save">⭐ ${esc(t('nav_save'))}</button>`}<button class="nv-btn" data-r="no">${esc(t('nav_cancel'))}</button></div></div>`;
      w.appendChild(el);
      el.onclick = e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        el.remove();
        if (b.dataset.r === 'stop') addStop(d);
        else if (b.dataset.r === 'dest') replaceDest(d);
        else if (b.dataset.r === 'save') savePlace(d);
      };
    }
    function replaceDest(d) {
      const mode = st.mode;
      if (mode === 'nav') { st.dest = d; drawDestMarker(); fetchRoutes(true); return; }
      setDest(d);
      if (mode === 'preview') { st.mode = 'preview'; renderOverlay(); fetchRoutes(); }
    }
    function recalcRoute() {
      if (st.mode === 'nav') fetchRoutes(true);
      else if (st.mode === 'preview') fetchRoutes();
      else renderOverlay();
    }
    function addStop(d) {
      if (st.stops.length >= 20) { toast(t('nav_error')); return; }
      const s = { name: d.name, address: d.address || '', lat: d.lat, lng: d.lng };
      const r = routeNow();
      let at = st.stops.length;
      if (r) {
        // Keep the stops in the order the route reaches them.
        const a = project(r.path, r.cum, s, 0, r.path.length).along;
        const k = st.stops.findIndex(x => project(r.path, r.cum, x, 0, r.path.length).along > a);
        if (k >= 0) at = k;
      }
      st.stops.splice(at, 0, s);
      drawStopMarkers();
      recalcRoute();
    }
    function removeStop(i) {
      if (!st.stops[i]) return;
      st.stops.splice(i, 1);
      drawStopMarkers();
      recalcRoute();
    }
    function catsHtml() {
      return `<div class="nv-cats" data-keep="cats">${CATS.map(c => `<div class="nv-cat ${st.poi.cat === c.id ? 'on' : ''}" data-a="cat" data-c="${c.id}">${c.icon} ${esc(t('nav_cat_' + c.id))}</div>`).join('')}</div>`;
    }
    function poiListHtml() {
      const p = st.poi;
      if (!p.cat) return '';
      if (p.busy && !p.items.length) return `<div class="nv-list"><div class="addr" style="padding:12px">…</div></div>`;
      const cur = p.mode === 'route' && st.mode === 'nav' && st.nav ? st.nav.along : p.fetchedAlong;
      const rows = [];
      p.items.forEach((it, i) => {
        let info;
        if (p.mode === 'route') {
          const ahead = it.along - cur;
          if (ahead < -100) return;
          info = `${it.side === 'left' ? '↰' : '↱'} ${t('nav_side_' + it.side)} · ${t('nav_poi_ahead', { d: fmtDist(Math.max(0, ahead)) })} · ${t('nav_poi_off', { d: fmtDist(it.off) })}`;
        } else info = `${ARROWS[Math.round(it.bearing / 45) % 8]} ${fmtDist(it.dist)}`;
        rows.push(`<div class="nv-row" data-a="poi" data-i="${i}"><span class="pi">${it.icon}</span><div class="main"><div class="ttl">${esc(it.name)}</div>${it.extra ? `<div class="sub">${esc(it.extra)}</div>` : ''}<div class="sub hl">${esc(info)}</div></div></div>`);
      });
      return rows.length ? `<div class="nv-list" data-keep="poi">${rows.join('')}</div>` : '';
    }
    function markGlyph(m, n) {
      if (m.kind === 'board') return VEH[m.veh] || '🚌';
      if (m.kind === 'alight') return '⬇';
      return n;
    }
    function progressHtml() {
      const n = st.nav;
      if (!n) return '';
      const total = n.base + n.r.total, done = Math.min(total, n.base + n.along);
      const pct = v => Math.max(0, Math.min(100, total ? v / total * 100 : 0));
      const narrow = w.clientWidth < 640, v = narrow;
      const pos = v ? 'top' : 'left';
      let sn = 0;
      const dots = n.marks.map(m => { if (m.kind === 'stop') sn++; return `<div class="dot ${m.done ? 'done' : ''} ${m.kind}" style="${pos}:${pct(m.at)}%" title="${esc(markLabel(m))}">${m.done ? '✓' : markGlyph(m, sn)}</div>`; }).join('');
      const core = `<div class="track"><div class="fill" style="${v ? 'left:0;right:0;top:0;height:' + pct(done) + '%' : 'width:' + pct(done) + '%'}"></div>${dots}<div class="flag" style="${pos}:100%">🏁</div><div class="me" style="${pos}:${pct(done)}%"></div></div>`;
      if (v) return `<div class="nv-prog v" data-a="progress"><div class="lb">${esc(fmtDist(done))}</div>${core}<div class="lb">${esc(fmtDist(Math.max(0, total - done)))}</div></div>`;
      return `<div class="nv-prog h" data-a="progress">${core}<div class="lbls"><span>${esc(t('nav_progress_done'))} <b>${esc(fmtDist(done))}</b></span><span>${esc(t('nav_progress_left'))} <b>${esc(fmtDist(Math.max(0, total - done)))}</b></span></div></div>`;
    }
    function progModalHtml() {
      const n = st.nav;
      if (!n || !n.r) return '';
      const r = n.r, here = n.base + n.along, total = n.base + r.total;
      const all = [{ kind: 'start', name: t('nav_prog_start'), at: 0, done: true }].concat(n.marks, [{ kind: 'dest', name: st.dest ? st.dest.name : '', at: total, done: false }]);
      all.sort((a, b) => a.at - b.at);
      let sn = 0; all.forEach(m => { if (m.kind === 'stop') m.no = ++sn; });
      const fut = all.filter(m => !m.done).reverse(), past = all.filter(m => m.done).reverse();
      const modeIcon = st.travel === 'WALK' ? '🚶' : st.travel === 'TRANSIT' ? '🚶' : '🚗';
      const legOf = (lo, hi) => {
        const mid = (lo.at + hi.at) / 2 - n.base, sg = (r.segs || []).find(x => mid >= x.from && mid <= x.to);
        const dist = fmtDist(Math.max(0, hi.at - lo.at));
        if (sg && sg.kind === 'transit') return `${VEH[sg.veh] || '🚌'} ${esc(sg.line)}${sg.n ? ' · ' + esc(t('nav_leg_stops', { n: sg.n })) : ''} · ${esc(dist)}`;
        if (sg) return `🚶 ${esc(t('nav_leg_walk'))} · ${esc(dist)}`;
        return `${modeIcon} ${esc(dist)}`;
      };
      const pointRow = (m, cls) => {
        const node = cls === 'p' ? '✓' : m.kind === 'dest' ? '🏁' : m.kind === 'start' ? '●' : markGlyph(m, m.no);
        const bits = [];
        if (m.time) bits.push(fmtClock(m.time));
        if (m.kind === 'start') { /* nothing more to say about the start */ }
        else if (cls === 'p') bits.push(t('nav_prog_visited'));
        else bits.push(t('nav_prog_in', { d: fmtDist(Math.max(0, m.at - here)) }));
        const ttl = m.kind === 'dest' ? t('nav_prog_dest') + ': ' + m.name : m.kind === 'stop' ? t('nav_prog_stop', { n: m.no }) + ': ' + m.name : markLabel(m);
        return `<div class="pm-row ${cls}"><span class="pm-node">${esc(node)}</span><div class="pm-t"><div class="ttl">${esc(ttl)}</div><div class="sub">${esc(bits.join(' · '))}</div></div></div>`;
      };
      const rows = [];
      fut.forEach((m, i) => {
        rows.push(pointRow(m, 'f'));
        const lower = fut[i + 1] || null;
        if (lower) rows.push(`<div class="pm-row f leg"><div class="pm-t">${legOf(lower, m)}</div></div>`);
      });
      rows.push(`<div class="pm-row y"><span class="pm-node">📍</span><div class="pm-t"><div class="ttl">${esc(t('nav_prog_you'))}</div><div class="sub">${esc(t('nav_progress_done'))} ${esc(fmtDist(here))} · ${esc(t('nav_progress_left'))} ${esc(fmtDist(Math.max(0, total - here)))}</div></div></div>`);
      past.forEach((m, i) => {
        const upper = past[i - 1] || null;
        if (i > 0) rows.push(`<div class="pm-row p leg"><div class="pm-t">${legOf(m, upper)}</div></div>`);
        rows.push(pointRow(m, 'p'));
      });
      const eta = Date.now() + (n.etaSec || 0) * 1000;
      return `<div class="nv-pm ${w.clientWidth < 640 ? 'nw' : ''}" data-a="progclose"><div class="pm-box">
        <div class="pm-head"><b>${esc(t('nav_prog_title'))}</b><button class="nv-btn" data-a="progclose">✕</button></div>
        <div class="nv-stats" style="padding:8px 14px 0"><div><b>${fmtClock(eta)}</b><span>${esc(t('nav_arrive'))}</span></div><div><b>${esc(fmtDur(n.etaSec || 0))}</b><span>${esc(t('nav_remaining'))}</span></div><div><b>${esc(fmtDist(Math.max(0, total - here)))}</b><span>${esc(t('nav_distance_left'))}</span></div></div>
        <div class="pm-list" data-keep="pm">${rows.join('')}</div></div></div>`;
    }
    function historyHtml() {
      const list = st.history;
      const sym = { arrived: '✓ ' + t('nav_hist_arrived'), stopped: '■ ' + t('nav_hist_stopped'), started: '… ' + t('nav_hist_unfinished') };
      return `<div class="nv-bottom" style="max-height:60%;overflow-y:auto;padding:6px">
        <div class="nv-actions" style="padding:6px;align-items:center"><b style="flex:1">🕘 ${esc(t('nav_history'))}</b>${list.length ? `<button class="nv-btn" data-a="hclear">${esc(t('nav_history_clear'))}</button>` : ''}</div>
        ${list.length ? list.map(h => `<div class="nv-row" data-a="hgo" data-id="${esc(h.id)}"><div class="main"><div class="ttl">${esc(h.name)}${h.stops && h.stops.length ? ' · ' + esc(t('nav_stops_n', { n: h.stops.length })) : ''}</div><div class="sub">${esc(h.address || '')}</div><div class="sub hl">${esc(fmtWhen(h.started))} · ${esc(sym[h.status] || sym.started)}</div></div>${isSaved(h) ? '' : `<button class="ic" data-a="hsave" data-id="${esc(h.id)}" title="${esc(t('nav_save'))}">⭐</button>`}<button class="ic" data-a="hdel" data-id="${esc(h.id)}" title="${esc(t('nav_delete'))}">🗑</button></div>`).join('') : `<div class="addr" style="padding:12px">${esc(t('nav_history_empty'))}</div>`}</div>`;
    }
    function modesHtml() {
      return `<div class="nv-modes">${[['DRIVE', '🚗', 'nav_mode_drive'], ['WALK', '🚶', 'nav_mode_walk'], ['TRANSIT', '🚌', 'nav_mode_transit']].map(m => `<div class="md ${st.travel === m[0] ? 'on' : ''}" data-a="travel" data-m="${m[0]}">${m[1]} ${esc(t(m[2]))}</div>`).join('')}</div>`;
    }
    function stopsHtml() {
      if (!st.stops.length) return '';
      return `<div class="nv-stops">${st.stops.map((s, i) => `<div class="nv-stoprow"><span class="n">${i + 1}</span><span class="nm">${esc(s.name)}</span><button class="ic" data-a="rmstop" data-i="${i}" title="${esc(t('nav_remove'))}">✕</button></div>`).join('')}</div>`;
    }

    // ── Remembering the trip on the server ───────────────────────────────
    let lastSave = 0;
    function markLabel(m) {
      if (!m) return '';
      if (m.kind === 'board') return t('nav_board', { l: m.line || '', n: m.name });
      if (m.kind === 'alight') return t('nav_alight', { n: m.name });
      return m.name;
    }
    function activeData() {
      const n = st.nav;
      if (!n || !n.r || st.mode !== 'nav' || !st.dest) return null;
      const r = n.r, path = []; let last = -1e9;
      for (let i = 0; i < r.path.length; i++) {
        if (r.cum[i] - last >= 60 || i === r.path.length - 1) { path.push([+r.path[i].lat.toFixed(5), +r.path[i].lng.toFixed(5)]); last = r.cum[i]; }
      }
      return { v: 1, travel: st.travel, tripId: st.tripId, dest: { name: st.dest.name, address: st.dest.address || '', lat: st.dest.lat, lng: st.dest.lng },
        stops: st.stops.map(x => ({ name: x.name, address: x.address || '', lat: x.lat, lng: x.lng })),
        base: n.base, along: n.along, total: r.total,
        marks: n.marks.map(m => ({ kind: m.kind, name: m.name, lat: m.lat, lng: m.lng, at: Math.round(m.at), done: !!m.done, line: m.line || '', veh: m.veh || '', time: m.time || 0 })), path };
    }
    function saveActive(force) {
      const now = Date.now();
      if (!force && now - lastSave < 20000) return;
      const d = activeData();
      if (!d) return;
      lastSave = now;
      api('/active', { method: 'PUT', body: JSON.stringify({ data: d }) }).catch(() => {});
    }
    function clearActive() { lastSave = 0; api('/active', { method: 'DELETE' }).catch(() => {}); }
    const waitPos = ms => new Promise(res => { const t0 = Date.now(), iv = setInterval(() => { if (st.pos || Date.now() - t0 > ms || destroyed) { clearInterval(iv); res(!!st.pos); } }, 300); });
    async function checkActive() {
      let a = null;
      try { a = (await api('/active')).active; } catch (e) { return; }
      if (!a || !a.dest || destroyed || st.mode === 'nav') return;
      const d = document.createElement('div');
      d.className = 'nv-dlg';
      d.innerHTML = `<div><b>${esc(t('nav_resume_title', { n: a.dest.name }))}</b><div style="font-size:.88rem;opacity:.8;margin:6px 0 14px;line-height:1.4">${esc(t('nav_resume_text'))}</div>
        <div class="nv-actions"><button class="nv-btn" data-r="no">${esc(t('nav_discard'))}</button><button class="nv-btn pri" data-r="yes">${esc(t('nav_resume'))}</button></div></div>`;
      w.appendChild(d);
      d.onclick = e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        d.remove();
        if (b.dataset.r === 'yes') resumeTrip(a);
        else { st.tripId = a.tripId || null; histEnd('stopped'); clearActive(); }
      };
    }
    // Continue where the person is now: whatever the trip's route already left behind counts as visited.
    async function resumeTrip(a) {
      if (!st.pos && !(await waitPos(10000))) { toast(t('nav_no_position')); checkActive(); return; }
      const tr = ['DRIVE', 'WALK', 'TRANSIT'].includes(a.travel) ? a.travel : 'DRIVE';
      st.travel = tr; localStorage.setItem('nav_travel', tr);
      if (tr !== 'DRIVE') startCompass();
      const path = (a.path || []).map(p => ({ lat: p[0], lng: p[1] }));
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
      let rel = a.along || 0;
      if (path.length > 1) { const pr = project(path, cum, st.pos, 0, path.length); if (pr.off <= 300) rel = pr.along; }
      if ((a.total || 0) - rel < 30) { st.tripId = a.tripId || null; histEnd('arrived'); clearActive(); toast(t('nav_arrived'), 6000); return; }
      const marks = (a.marks || []).map(m => Object.assign({}, m));
      const remaining = []; let k = 0;
      marks.forEach(m => {
        const was = m.done;
        if (!was && m.at - a.base <= rel + 40) m.done = true;
        if (m.kind === 'stop' && !was) { if (!m.done && a.stops[k]) remaining.push(a.stops[k]); k++; }
      });
      st.dest = a.dest; st.stops = remaining; st.tripId = a.tripId || null;
      st.listOpen = false; st.histOpen = false; st.results = []; st.query = '';
      drawDestMarker(); drawStopMarkers();
      st.mode = 'preview'; renderOverlay();
      await fetchRoutes(true, { base: (a.base || 0) + rel, along: 0, marks });
      if (st.mode !== 'nav') { st.mode = 'place'; renderOverlay(); return; }
      try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) {}
      st.map.setZoom(17);
    }

    // ── Trip history ──────────────────────────────────────────────────────
    async function loadHistory() {
      try { st.history = (await api('/history')).trips; } catch (e) { st.history = []; }
      renderOverlay();
    }
    async function histStart() {
      if (!st.dest || st.tripId) return;
      try {
        const h = await api('/history', { method: 'POST', body: JSON.stringify({ name: st.dest.name, address: st.dest.address || '', lat: st.dest.lat, lng: st.dest.lng,
          stops: st.stops.map(x => ({ name: x.name, lat: x.lat, lng: x.lng })) }) });
        st.tripId = h.id; st.history.unshift(h);
      } catch (e) {}
    }
    function histEnd(status) {
      const id = st.tripId;
      if (!id) return;
      st.tripId = null;
      api('/history/' + id, { method: 'PUT', body: JSON.stringify({ status }) })
        .then(h => { const i = st.history.findIndex(x => x.id === id); if (i >= 0) st.history[i] = h; renderOverlay(); }).catch(() => {});
    }
    async function clearHistory() {
      if (!(await confirmDlg(t('nav_history_clear_confirm')))) return;
      try { await api('/history', { method: 'DELETE' }); st.history = []; } catch (e) { toast(t('nav_error')); }
      renderOverlay();
    }
    async function deleteTrip(id) {
      try { await api('/history/' + id, { method: 'DELETE' }); st.history = st.history.filter(x => x.id !== id); } catch (e) { toast(t('nav_error')); }
      renderOverlay();
    }
    // Straight to the route, no destination card: used by saved places and history.
    async function goTo(d, stops) {
      if (st.mode === 'nav') stopNav(true);
      st.listOpen = false; st.histOpen = false; st.results = []; st.query = '';
      st.stops = (stops || []).map(x => ({ name: x.name || '', address: '', lat: x.lat, lng: x.lng }));
      drawStopMarkers();
      setDest(d);
      st.mode = 'preview'; renderOverlay();
      await fetchRoutes();
      if (st.routes.length && st.pos) startNav();
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
        m.addListener('click', () => pickPlace(p));
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
        const nm = nav.marks.find(m => !m.done);
        if (nav.r.transit) h += `<div class="nv-banner"><div class="dist">${esc(fmtDist(nm ? Math.max(0, nm.at - nav.base - nav.along) : (nav.remain || 0)))}</div><div class="ins">${esc(nm ? markLabel(nm) : (st.dest ? st.dest.name : ''))}</div></div>`;
        else h += `<div class="nv-banner"><div class="dist">${esc(fmtDist(nav.toNext || 0))}</div><div class="ins">${esc(s ? s.text : '')}</div></div>`;
        h += `<div class="nv-side"><button class="nv-btn ${st.follow ? 'on' : ''}" data-a="locate" title="${esc(t('nav_locate'))}">⌖</button><button class="nv-btn ${st.rotate ? 'on' : ''}" data-a="rotate" title="${esc(st.rotate ? t('nav_north') : t('nav_rotate'))}">🧭</button><button class="nv-btn ${st.voice ? 'on' : ''}" data-a="voice" title="${esc(st.voice ? t('nav_voice_on') : t('nav_voice_off'))}">${st.voice ? '🔊' : '🔇'}</button><button class="nv-btn ${st.poi.show ? 'on' : ''}" data-a="poitoggle" title="${esc(t('nav_poi_find'))}">🔎</button></div>`;
        if (w.clientWidth < 640) h += progressHtml();
        if (st.poi.show) h += `<div class="nv-top" style="top:112px">${catsHtml()}${poiListHtml()}</div>`;
        const ns = st.stops[0];
        const eta = Date.now() + (nav.etaSec || 0) * 1000;
        const kmh = st.pos && st.pos.speed != null ? Math.round(st.pos.speed * 3.6) : '–';
        h += `<div class="nv-bottom">${ns ? `<div class="nv-stoprow" style="margin-bottom:8px"><span class="n">1</span><span class="nm">${esc(t('nav_next_stop'))}: ${esc(ns.name)}${nav.marks.find(m => !m.done && m.kind === 'stop') ? ' · ' + esc(fmtDist(Math.max(0, nav.marks.find(m => !m.done && m.kind === 'stop').at - nav.base - nav.along))) : ''}${st.stops.length > 1 ? ' · ' + esc(t('nav_stops_n', { n: st.stops.length })) : ''}</span><button class="ic" data-a="rmstop" data-i="0" title="${esc(t('nav_remove'))}">✕</button></div>` : ''}${w.clientWidth < 640 ? '' : progressHtml()}<div class="nv-stats">
          <div><b>${fmtClock(eta)}</b><span>${esc(t('nav_arrive'))}</span></div>
          <div><b>${esc(fmtDur(nav.etaSec || 0))}</b><span>${esc(t('nav_remaining'))}</span></div>
          <div><b>${esc(fmtDist(nav.remain || 0))}</b><span>${esc(t('nav_distance_left'))}</span></div>
          <div><b>${kmh}</b><span>${esc(t('nav_speed'))} ${esc(t('nav_u_kmh'))}</span></div></div>
          <div class="nv-actions" style="margin-top:12px"><button class="nv-btn red" data-a="stop" style="flex:1">${esc(t('nav_stop'))}</button></div></div>`;
        if (st.progOpen) h += progModalHtml();
      } else {
        h += `<div class="nv-top"><div class="nv-search"><input type="search" id="nv-q" placeholder="${esc(t('nav_search'))}" value="${esc(st.query)}" autocomplete="off"><button class="nv-btn" data-a="clear" ${st.query ? '' : 'hidden'}>✕</button></div>`;
        const showCats = !st.query && (st.sf || st.poi.cat);
        if (showCats) h += catsHtml();
        if (st.results.length) h += `<div class="nv-list">${st.results.map((r, i) => `<div class="nv-row" data-a="res" data-i="${i}"><div class="main"><div class="ttl">${esc(r.name)}</div><div class="sub">${esc(r.address)}</div></div></div>`).join('')}</div>`; else if (showCats) h += poiListHtml();
        h += `</div>`;
        h += `<div class="nv-side"><button class="nv-btn ${st.follow ? 'on' : ''}" data-a="locate" title="${esc(t('nav_locate'))}">⌖</button><button class="nv-btn ${st.rotate ? 'on' : ''}" data-a="rotate" title="${esc(st.rotate ? t('nav_north') : t('nav_rotate'))}">🧭</button><button class="nv-btn ${st.listOpen ? 'on' : ''}" data-a="places" title="${esc(t('nav_places'))}">⭐</button><button class="nv-btn ${st.histOpen ? 'on' : ''}" data-a="history" title="${esc(t('nav_history'))}">🕘</button><button class="nv-btn" data-a="theme" title="${esc(st.dark ? t('nav_light') : t('nav_dark'))}">${st.dark ? '☀️' : '🌙'}</button></div>`;
        if ((st.mode === 'place' || st.mode === 'preview') && st.dest) {
          const d = st.dest;
          const near = distTo(d);
          h += `<div class="nv-bottom"><h3>${esc(d.name)}</h3><div class="addr">${esc(d.address)}${near != null ? ' · ' + esc(t('nav_away', { d: fmtDist(near) })) : ''}</div>${modesHtml()}${stopsHtml()}`;
          if (st.mode === 'preview' && st.routes.length) h += `<div class="nv-routes">${st.routes.map((r, i) => `<div class="rt ${i === st.sel ? 'on' : ''}" data-a="route" data-i="${i}"><b>${esc(fmtDur(r.dur))}</b><span>${esc(fmtDist(r.dist))}${r.via ? ' · ' + esc(r.via) : ''}</span></div>`).join('')}</div>`;
          else if (st.mode === 'preview' && st.busy) h += `<div class="addr">…</div>`;
          h += `<div class="nv-actions">${st.mode === 'place' ? `<button class="nv-btn pri" data-a="directions">🧭 ${esc(t('nav_directions'))}</button>` : `<button class="nv-btn pri" data-a="start" ${st.routes.length ? '' : 'disabled'}>▶ ${esc(t('nav_start'))}</button>`}${isSaved(d) ? '' : `<button class="nv-btn" data-a="save">⭐ ${esc(t('nav_save'))}</button>`}<button class="nv-btn" data-a="close">✕</button></div></div>`;
        } else if (st.histOpen) {
          h += historyHtml();
        } else if (st.listOpen) {
          const list = sortedPlaces();
          h += `<div class="nv-bottom" style="max-height:60%;overflow-y:auto;padding:6px">
            <div class="nv-actions" style="padding:6px"><button class="nv-btn pri" data-a="savehere">📍 ${esc(t('nav_save_here'))}</button></div>
            ${list.length ? list.map(p => { const d = distTo(p); return `<div class="nv-row" data-a="place" data-id="${esc(p.id)}"><div class="main"><div class="ttl">${esc(p.name)}</div><div class="sub">${esc(p.address)}</div></div><div class="dist">${d == null ? '' : esc(fmtDist(d))}</div> <button class="ic" data-a="gonav" data-id="${esc(p.id)}" title="${esc(t('nav_navigate'))}">🧭</button><button class="ic" data-a="rename" data-id="${esc(p.id)}" title="${esc(t('nav_rename'))}">✏️</button><button class="ic" data-a="del" data-id="${esc(p.id)}" title="${esc(t('nav_delete'))}">🗑</button></div>`; }).join('') : `<div class="addr" style="padding:12px">${esc(t('nav_no_places'))}</div>`}</div>`;
        } else if (st.places.length) {
          h += `<div class="nv-chips">${sortedPlaces().slice(0, 8).map(p => { const d = distTo(p); return `<div class="nv-chip" data-a="place" data-id="${esc(p.id)}">⭐ ${esc(p.name)}${d == null ? '' : `<b>${esc(fmtDist(d))}</b>`}</div>`; }).join('')}</div>`;
        }
      }
      if (st.toast) h += `<div class="nv-toast">${esc(st.toast)}</div>`;
      // Keep the search box (and its focus/caret) alive while typing.
      const q = ov.querySelector('#nv-q'), had = q && document.activeElement === q, caret = q ? q.selectionStart : 0;
      const keep = {};
      ov.querySelectorAll('[data-keep]').forEach(e => { keep[e.dataset.keep] = [e.scrollLeft, e.scrollTop]; });
      ov.innerHTML = h;
      ov.querySelectorAll('[data-keep]').forEach(e => { const k = keep[e.dataset.keep]; if (k) { e.scrollLeft = k[0]; e.scrollTop = k[1]; } });
      if (st.pmCenter) {
        const list = ov.querySelector('.pm-list'), y = ov.querySelector('.pm-row.y');
        if (list && y) { list.scrollTop = y.offsetTop - list.clientHeight / 2 + y.offsetHeight / 2; st.pmCenter = false; }
      }
      const q2 = ov.querySelector('#nv-q');
      if (q2) {
        q2.oninput = () => {
          if (q2.value.trim() && st.poi.cat) { st.poi.cat = null; st.poi.items = []; poiSeq++; st.poi.busy = false; drawPoiMarkers(); }
          onInput(q2.value);
        };
        q2.onfocus = () => { if (!st.sf) { st.sf = true; renderOverlay(); } };
        q2.onblur = () => setTimeout(() => {
          const cur = ov.querySelector('#nv-q');
          if (document.activeElement === cur) return;
          st.sf = false;
          if (!st.poi.cat) renderOverlay();
        }, 250);
        q2.onkeydown = e => { if (e.key === 'Enter' && q2.value.trim()) { clearTimeout(searchTimer); searchText(q2.value.trim()); } };
        if (had) { q2.focus(); try { q2.setSelectionRange(caret, caret); } catch (e) {} }
      }
    }

    function onClick(e) {
      const el = e.target.closest('[data-a]');
      if (!el) return;
      const a = el.dataset.a;
      if (a === 'progclose' && el.classList.contains('nv-pm') && e.target !== el) return;
      const place = el.dataset.id && st.places.find(p => p.id === el.dataset.id);
      if (a === 'clear') { st.query = ''; st.results = []; renderOverlay(); }
      else if (a === 'res') pickResult(st.results[+el.dataset.i]);
      else if (a === 'locate') locateOnce();
      else if (a === 'places') { st.listOpen = !st.listOpen; st.histOpen = false; renderOverlay(); }
      else if (a === 'history') { st.histOpen = !st.histOpen; st.listOpen = false; renderOverlay(); if (st.histOpen) loadHistory(); }
      else if (a === 'gonav' && place) goTo(place);
      else if (a === 'hclear') clearHistory();
      else if (a === 'hdel') deleteTrip(el.dataset.id);
      else if (a === 'hsave') { const h = st.history.find(x => x.id === el.dataset.id); if (h) savePlace({ name: h.name, address: h.address, lat: h.lat, lng: h.lng }); }
      else if (a === 'hgo') { const h = st.history.find(x => x.id === el.dataset.id); if (h) goTo({ name: h.name, address: h.address, lat: h.lat, lng: h.lng }, h.stops); }
      else if (a === 'theme') { st.dark = !st.dark; localStorage.setItem('nav_dark', st.dark ? '1' : '0'); if (st.vector) { const r = st.rotate; setVector(true).then(() => { st.rotate = r && st.vector; renderOverlay(); }); } else { st.map.setOptions({ styles: st.dark ? DARK_STYLE : [] }); renderOverlay(); } }
      else if (a === 'rotate') toggleRotate();
      else if (a === 'voice') { st.voice = !st.voice; localStorage.setItem('nav_voice', st.voice ? '1' : '0'); if (!st.voice && window.speechSynthesis) speechSynthesis.cancel(); renderOverlay(); }
      else if (a === 'place' && place) { st.listOpen = false; pickPlace(place); }
      else if (a === 'rename' && place) renamePlace(place);
      else if (a === 'del' && place) deletePlace(place);
      else if (a === 'savehere') { if (!st.pos) { toast(t('nav_no_position')); return; } savePlace({ name: t('nav_my_location'), address: '', lat: st.pos.lat, lng: st.pos.lng }); }
      else if (a === 'route') { st.sel = +el.dataset.i; drawRoutes(false); renderOverlay(); if (st.poi.cat) loadPoi(); }
      else if (a === 'travel') {
        if (st.travel !== el.dataset.m) {
          st.travel = el.dataset.m; localStorage.setItem('nav_travel', st.travel); if (st.travel !== 'DRIVE') startCompass(); drawMe();
          if (st.mode === 'preview') { st.routes = []; clearRoutes(); renderOverlay(); fetchRoutes(); } else renderOverlay();
        }
      }
      else if (a === 'directions') { st.mode = 'preview'; renderOverlay(); fetchRoutes(); }
      else if (a === 'start') startNav();
      else if (a === 'stop') stopNav(false);
      else if (a === 'cat') {
        const id = el.dataset.c;
        st.poi.cat = st.poi.cat === id ? null : id; st.poi.items = [];
        if (st.poi.cat) loadPoi(); else { poiSeq++; st.poi.busy = false; drawPoiMarkers(); renderOverlay(); }
      }
      else if (a === 'poi') pickPlace(st.poi.items[+el.dataset.i]);
      else if (a === 'rmstop') removeStop(+el.dataset.i);
      else if (a === 'poitoggle') {
        st.poi.show = !st.poi.show;
        if (!st.poi.show) { st.poi.cat = null; st.poi.items = []; poiSeq++; drawPoiMarkers(); }
        renderOverlay();
      }
      else if (a === 'progress') { st.progOpen = true; st.pmCenter = true; renderOverlay(); }
      else if (a === 'progclose') { st.progOpen = false; renderOverlay(); }
      else if (a === 'save') savePlace(st.dest);
      else if (a === 'close') closeDest();
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    async function boot() {
      try { const cfg = await api('/config'); st.key = cfg.api_key; st.mapId = cfg.map_id || ''; } catch (e) { w.innerHTML = `<div class="nv-msg">${esc(t(e.message === 'private' ? 'nav_private' : 'nav_error'))}</div>`; return; }
      if (!st.key) { w.innerHTML = `<div class="nv-msg">${esc(t('nav_no_key'))}<br><a href="/pub/apphub/?tab=settings&section=keys" target="_blank" style="color:inherit;font-weight:600">Apps Hub →</a></div>`; return; }
      try { await loadMaps(st.key); } catch (e) { w.innerHTML = `<div class="nv-msg">${esc(t('nav_maps_failed'))}</div>`; return; }
      if (destroyed) return;
      await Promise.all(['core', 'maps', 'marker'].map(l => window.google.maps.importLibrary(l)));
      G = window.google.maps;
      w.innerHTML = '<div class="nv-map"></div><div class="nv-ov"></div>';
      ov = w.querySelector('.nv-ov');
      buildMap(false);
      ov.addEventListener('click', onClick);
      renderOverlay();
      const dp = picker(); if (dp && dp.ready) { try { await dp.ready(); } catch (e) {} }
      onResize = () => renderOverlay(); window.addEventListener('resize', onResize);
      await loadPlaces();
      loadHistory();
      checkActive();
      startWatch(); if (st.travel !== "DRIVE") startCompass();
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
        if (onResize) window.removeEventListener('resize', onResize);
      },
    };
  }

  window.NavigationWidget = { mount };
})();
