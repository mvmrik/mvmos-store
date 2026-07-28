/* FindYourself — multiplayer client module.
 *
 * Runs on the generic Game Hub play page (NOT inside mvmOS). It registers with
 * window.GameHub.mp and provides ONLY FindYourself's UI/logic:
 *   • renderSetup — the host's rounds/time/API-key form (lobby)
 *   • renderGame  — the in-game Street View + guess map + results
 *   • message handlers wired to the hub transport
 *
 * All sockets, players, reconnect, invites and session recording are handled by
 * the hub (GameHub.mp). Single-player lives separately in main.js and is not
 * affected by this file.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  // ── i18n ────────────────────────────────────────────────────────────────
  const _I18N = {
    en: { round:'Round', of:'of', score:'Score', submit:'Guess', loading:'Loading…', region:'Region',
      result:'Result', waiting_others:'waiting…', next_round:'Next round', waiting_round:'Waiting for host…',
      final:'Final standings', winner:'Winner', reset:'Reset view', preparing:'Preparing',
      rounds:'rounds', time_round:'Time per round', api_key:'Google Maps API key', api_missing:'Enter a Google Maps API key to play.',
      no_limit:'no limit', you:'You', players:'Players', start_fail:'Could not start.', maps_fail:'Failed to load Google Maps. Check the API key.',
      change:'Change' },
    bg: { round:'Рунд', of:'от', score:'Точки', submit:'Познай', loading:'Зареждане…', region:'Регион',
      result:'Резултат', waiting_others:'изчакване…', next_round:'Следващ рунд', waiting_round:'Изчакване на домакина…',
      final:'Крайно класиране', winner:'Победител', reset:'Нулирай изгледа', preparing:'Подготовка',
      rounds:'рунда', time_round:'Време за рунд', api_key:'Google Maps API ключ', api_missing:'Въведи Google Maps API ключ за да играеш.',
      no_limit:'без лимит', you:'Ти', players:'Играчи', start_fail:'Неуспешен старт.', maps_fail:'Грешка при зареждане на Google Maps. Провери ключа.',
      change:'Смени' },
  };
  const _t = k => { const lang = (window.mvmOS && window.mvmOS.lang) === 'bg' ? 'bg' : 'en'; return (_I18N[lang] || _I18N.en)[k] || k; };

  // ── small helpers ───────────────────────────────────────────────────────
  const _isMobile = window.innerWidth < 768;
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  function _avatar(p, size) { return mp.renderAvatar(p, size); }
  function _fmtTime(s) { return s < 60 ? s + 's' : Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }
  function _fmtDist(km) { if (km == null) return '—'; if (km < 1) return Math.round(km*1000)+' m'; if (km < 100) return km.toFixed(1)+' km'; return Math.round(km)+' km'; }
  function _distKm(a, b) {
    const R = 6371, dLat = (b.lat-a.lat)*Math.PI/180, dLng = (b.lng-a.lng)*Math.PI/180;
    const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  // ── Country definitions ──────────────────────────────────────────────────
  const _COUNTRIES = {
    world: { name: '🌍 World', code: null, bbox: null, scale: 2000, zoom: 2, center: { lat: 20, lng: 0 } },
    bg: { name: '🇧🇬 България', code: 'BG', bbox: [41.2, 44.2, 22.4, 28.6], scale: 200, zoom: 6, center: { lat: 42.7, lng: 25.5 } },
    us: { name: '🇺🇸 USA',      code: 'US', bbox: [24.5, 49.5, -125, -66],   scale: 800, zoom: 4, center: { lat: 37.1, lng: -95.7 } },
    gb: { name: '🇬🇧 UK',       code: 'GB', bbox: [49.9, 58.7, -8.2, 1.8],   scale: 250, zoom: 6, center: { lat: 54.0, lng: -2.5 } },
    de: { name: '🇩🇪 Germany',  code: 'DE', bbox: [47.3, 55.1, 5.9, 15.0],   scale: 300, zoom: 5, center: { lat: 51.2, lng: 10.4 } },
    fr: { name: '🇫🇷 France',   code: 'FR', bbox: [42.3, 51.1, -4.8, 8.2],   scale: 400, zoom: 5, center: { lat: 46.6, lng: 2.4 } },
    es: { name: '🇪🇸 Spain',    code: 'ES', bbox: [35.9, 43.8, -9.3, 4.3],   scale: 400, zoom: 5, center: { lat: 40.0, lng: -3.7 } },
    it: { name: '🇮🇹 Italy',    code: 'IT', bbox: [37.9, 47.1, 6.6, 18.5],   scale: 400, zoom: 5, center: { lat: 42.5, lng: 12.3 } },
    jp: { name: '🇯🇵 Japan',    code: 'JP', bbox: [30.9, 45.5, 129.5, 145.8], scale: 500, zoom: 5, center: { lat: 36.2, lng: 138.3 } },
    au: { name: '🇦🇺 Australia', code: 'AU', bbox: [-43.6, -10.7, 113.3, 153.6], scale: 1500, zoom: 3, center: { lat: -25.0, lng: 133.8 } },
    br: { name: '🇧🇷 Brazil',   code: 'BR', bbox: [-33.7, 5.3, -73.8, -28.6], scale: 1500, zoom: 3, center: { lat: -14.2, lng: -51.9 } },
    ca: { name: '🇨🇦 Canada',   code: 'CA', bbox: [41.7, 60.0, -140.9, -52.6], scale: 1500, zoom: 3, center: { lat: 56.1, lng: -96.3 } },
    ru: { name: '🇷🇺 Russia',   code: 'RU', bbox: [41.2, 77.0, 19.6, 180],   scale: 2000, zoom: 3, center: { lat: 61.5, lng: 105.3 } },
    gr: { name: '🇬🇷 Greece',   code: 'GR', bbox: [34.8, 41.8, 19.4, 29.6],  scale: 300,  zoom: 6, center: { lat: 39.0, lng: 22.0 } },
    tr: { name: '🇹🇷 Turkey',   code: 'TR', bbox: [35.8, 42.1, 25.7, 44.8],  scale: 600,  zoom: 5, center: { lat: 38.9, lng: 35.2 } },
    ro: { name: '🇷🇴 Romania',  code: 'RO', bbox: [43.6, 48.3, 20.3, 29.7],  scale: 300,  zoom: 6, center: { lat: 45.9, lng: 24.9 } },
    pl: { name: '🇵🇱 Poland',   code: 'PL', bbox: [49.0, 54.8, 14.1, 24.1],  scale: 300,  zoom: 5, center: { lat: 51.9, lng: 19.1 } },
    nl: { name: '🇳🇱 Netherlands', code: 'NL', bbox: [50.8, 53.5, 3.4, 7.2], scale: 150,  zoom: 7, center: { lat: 52.1, lng: 5.3 } },
    pt: { name: '🇵🇹 Portugal', code: 'PT', bbox: [37.0, 42.2, -9.5, -6.2],  scale: 250,  zoom: 6, center: { lat: 39.4, lng: -8.2 } },
    se: { name: '🇸🇪 Sweden',   code: 'SE', bbox: [55.3, 69.1, 11.1, 24.2],  scale: 500,  zoom: 4, center: { lat: 60.1, lng: 18.6 } },
    mx: { name: '🇲🇽 Mexico',   code: 'MX', bbox: [14.5, 32.7, -117.1, -86.7], scale: 800, zoom: 4, center: { lat: 23.6, lng: -102.5 } },
    in: { name: '🇮🇳 India',    code: 'IN', bbox: [8.1, 37.1, 68.2, 97.4],   scale: 1000, zoom: 4, center: { lat: 20.6, lng: 78.9 } },
  };

  function _coordForRegion(key) {
    const c = key && key !== 'world' ? _COUNTRIES[key] : null;
    if (!c || !c.bbox) return _randomCoord();
    const [minLat, maxLat, minLng, maxLng] = c.bbox;
    return { lat: minLat + Math.random() * (maxLat - minLat), lng: minLng + Math.random() * (maxLng - minLng) };
  }

  function _verifyCountry(lat, lng, code) {
    return new Promise(resolve => {
      new google.maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
        if (status !== 'OK' || !results?.length) { resolve(true); return; }
        const cc = results[0].address_components?.find(c => c.types.includes('country'));
        resolve(!cc || cc.short_name === code);
      });
    });
  }

  function _countryOptions(selected) {
    return Object.entries(_COUNTRIES).map(([key, c]) =>
      `<option value="${key}" ${key === (selected || 'world') ? 'selected' : ''}>${c.name}</option>`
    ).join('');
  }

  // weighted random land boxes (populated regions) — same idea as single-player
  const _BOXES = [
    [24,49,-124,-67,18],[36,60,-9,30,30],[50,60,-8,28,10],[35,55,30,140,28],
    [-44,-10,113,154,8],[-35,5,-75,-35,12],[5,35,70,90,16],[-35,35,15,50,10],
    [30,46,128,146,8],[20,40,95,127,12],
  ];
  function _randomCoord() {
    const total = _BOXES.reduce((s,b)=>s+b[4],0);
    let r = Math.random()*total;
    for (const [a,b,c,d,w] of _BOXES) { r -= w; if (r <= 0) return { lat:a+Math.random()*(b-a), lng:c+Math.random()*(d-c) }; }
    return { lat: Math.random()*140-70, lng: Math.random()*360-180 };
  }

  let _mapsLoaded = false;
  function _loadMaps(apiKey) {
    return new Promise((resolve, reject) => {
      if (_mapsLoaded && window.google && window.google.maps) return resolve();
      if (window._fyMapsLoading) { window._fyMapsResolvers.push(resolve); return; }
      window._fyMapsLoading = true; window._fyMapsResolvers = [resolve];
      window._fyMapsCallback = () => { _mapsLoaded = true; window._fyMapsLoading = false; window._fyMapsResolvers.forEach(r=>r()); };
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&callback=_fyMapsCallback';
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function _resolveLocation(countryKey) {
    return new Promise((resolve, reject) => {
      const countryData = countryKey && countryKey !== 'world' ? _COUNTRIES[countryKey] : null;
      let attempt = 0;
      function _try() {
        if (attempt++ > 14) return reject('no SV');
        const svc = new google.maps.StreetViewService();
        svc.getPanorama({ location: _coordForRegion(countryKey), radius: 50000, source: google.maps.StreetViewSource.OUTDOOR }, async (data, status) => {
          if (status !== 'OK') { _try(); return; }
          const actual = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
          if (countryData?.code) {
            const ok = await _verifyCountry(actual.lat, actual.lng, countryData.code);
            if (!ok) { _try(); return; }
          }
          resolve({ lat: actual.lat, lng: actual.lng, heading: Math.random() * 360 });
        });
      }
      _try();
    });
  }

  // ── module state ────────────────────────────────────────────────────────
  let _root = null;
  let _round = 0, _total = 5, _time = 60, _apiKey = '';
  let _actual = null, _initPov = null;
  let _sv = null, _map = null, _marker = null, _guess = null;
  let _submitted = false;
  let _timer = null, _timeLeft = 0;
  let _liveTotal = 1, _liveGuesses = {}, _liveMap = null, _liveMarkers = {}, _livePolylines = {};
  const _MAP_PCTS = [38, 60, 100]; let _mapPctIdx = 0;
  let _countryCenter = { lat: 20, lng: 0 }, _countryZoom = 2;

  function _stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }

  // ══════════════════════════════════════════════════════════════════════
  // Lobby setup form (host)
  // ══════════════════════════════════════════════════════════════════════
  function renderSetup(box, settings) {
    // Render placeholder immediately so the lobby is not empty during fetch.
    box.innerHTML = `<div id="fy-setup-inner" style="display:flex;flex-direction:column;gap:10px;background:var(--surface1,#181825);border:1px solid var(--border,#45475a);border-radius:10px;padding:14px">
      <div>
        <div style="font-size:12px;color:var(--fg2,#a6adc8);margin-bottom:4px">${_t('round')}s</div>
        <input id="fy-s-rounds" type="number" min="1" max="20" value="5" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:6px;padding:6px 10px;width:100%;font-size:13px;box-sizing:border-box">
      </div>
      <div>
        <div style="font-size:12px;color:var(--fg2,#a6adc8);margin-bottom:4px">${_t('time_round')}</div>
        <select id="fy-s-time" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:6px;padding:6px 10px;width:100%;font-size:13px">
          <option value="10">10s</option><option value="20">20s</option><option value="30">30s</option><option value="40">40s</option><option value="50">50s</option>
          <option value="60" selected>1 min</option><option value="120">2 min</option><option value="180">3 min</option><option value="240">4 min</option><option value="300">5 min</option>
          <option value="360">6 min</option><option value="420">7 min</option><option value="480">8 min</option><option value="540">9 min</option><option value="600">10 min</option>
          <option value="0">${_t('no_limit')}</option>
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:var(--fg2,#a6adc8);margin-bottom:4px">${_t('region')}</div>
        <select id="fy-s-country" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:6px;padding:6px 10px;width:100%;font-size:13px">
          ${_countryOptions((settings && settings.country) || 'world')}
        </select>
      </div>
      <div id="fy-s-key-row"><div style="font-size:12px;color:#a6adc8">⏳</div></div>
    </div>`;

    let _resolvedKey = (settings && settings.api_key) || '';

    // Try to fetch the saved key from the server (where it lives in FindYourself settings DB).
    const token = mp.me() ? window.GameHub.getToken() : null;
    if (token) {
      fetch('/pub/findyourself/config', { headers: { 'X-GH-Token': token } })
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
          _resolvedKey = (cfg && cfg.api_key) || _resolvedKey;
          _renderKeyRow(box, _resolvedKey);
        })
        .catch(() => _renderKeyRow(box, _resolvedKey));
    } else {
      _renderKeyRow(box, _resolvedKey);
    }

    return function collect() {
      if (!_resolvedKey) { alert(_t('api_missing')); return null; }
      const countryKey = box.querySelector('#fy-s-country')?.value || 'world';
      const cd = _COUNTRIES[countryKey] || _COUNTRIES.world;
      return {
        rounds: parseInt(box.querySelector('#fy-s-rounds').value),
        time:   parseInt(box.querySelector('#fy-s-time').value),
        api_key: _resolvedKey,
        country: countryKey,
        scale: cd.scale,
        country_center: cd.center,
        country_zoom: cd.zoom,
      };
    };
  }

  function _renderKeyRow(box, key) {
    const row = box.querySelector('#fy-s-key-row');
    if (!row) return;
    if (key) {
      row.innerHTML = `<div style="font-size:12px;color:#a6e3a1">✓ Google Maps API key</div>`;
    } else {
      row.innerHTML = `<div style="font-size:12px;color:#f38ba8">⚠ No Google Maps API key — set it in FindYourself settings.</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // In-game view
  // ══════════════════════════════════════════════════════════════════════
  function renderGame(root) {
    _root = root;
    _stopTimer();
    root.innerHTML = '<div class="fy-root"><div class="fy-game" id="fy-game"><div class="fy-screen"><div style="font-size:1.6rem">⏳</div><p style="color:#a6adc8">' + _t('preparing') + '…</p></div></div></div>';
    // Persist active room so the public hub can offer "resume" after a disconnect.
    try { localStorage.setItem('gh_active_room', JSON.stringify({ roomId: mp.roomId(), gameId: mp.gameId(), ts: Date.now() })); } catch (e) {}
  }

  function _gameEl() { return _root && _root.querySelector('#fy-game'); }

  function _buildRoundUI(gameEl) {
    gameEl.innerHTML = `
      <div class="fy-hud">
        <div class="fy-hud-pill">${_t('round')} <strong>${_round}</strong> ${_t('of')} <strong>${_total}</strong></div>
        <div class="fy-hud-pill fy-timer" id="fy-timer">${_time > 0 ? _fmtTime(_time) : '0:00'}</div>
        <div id="fy-guessed-bar" style="display:flex;align-items:center;gap:4px"></div>
      </div>
      <div id="fy-sv" class="fy-sv"></div>
      <div class="fy-map-wrap ${_isMobile ? 'fy-map-collapsed' : 'fy-map-mini'}" id="fy-map-wrap">
        <div id="fy-map" class="fy-map"></div>
        <div class="fy-map-thumb" id="fy-map-thumb"><span class="fy-map-thumb-ico">🗺</span></div>
        <div class="fy-map-timer" id="fy-map-timer">${_time > 0 ? _fmtTime(_time) : '0:00'}</div>
        <button class="fy-map-close-btn" id="fy-map-close" title="Close">✕</button>
        <div class="fy-map-inner-controls" id="fy-map-inner-controls">
          ${!_isMobile ? `<button class="fy-map-btn" id="fy-zoom-cycle" title="Zoom">⊞</button>` : ''}
          <button class="fy-map-btn" id="fy-map-reset" title="${_t('reset')}">⌖</button>
          <button class="fy-guess-btn-map" id="fy-submit" disabled>${_t('submit')}</button>
        </div>
      </div>
      <div id="fy-sv-loading" style="position:absolute;inset:0;background:#1e1e2e;display:flex;align-items:center;justify-content:center;z-index:5;font-size:.9rem;color:#a6adc8">${_t('loading')}</div>`;
  }

  function _renderRound(gameEl, actual, heading, elapsed) {
    _actual = actual;
    _initPov = { heading: heading || 0, pitch: 0 };

    _sv = new google.maps.StreetViewPanorama(gameEl.querySelector('#fy-sv'), {
      position: _actual, pov: _initPov, addressControl: false, showRoadLabels: false,
      motionTracking: false, motionTrackingControl: false, fullscreenControl: false,
    });

    _map = new google.maps.Map(gameEl.querySelector('#fy-map'), {
      zoom: _countryZoom, center: _countryCenter, streetViewControl: false, fullscreenControl: false,
      mapTypeControl: false, zoomControl: false, gestureHandling: 'greedy',
    });
    _marker = null; _guess = null;
    _map.addListener('click', e => {
      _guess = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (_marker) _marker.setMap(null);
      _marker = new google.maps.Marker({ position: _guess, map: _map });
      const b = gameEl.querySelector('#fy-submit'); if (b) b.disabled = false;
    });

    const mapWrap = gameEl.querySelector('#fy-map-wrap');
    function _setPct(i) {
      const p = _MAP_PCTS[i];
      if (p >= 100) { mapWrap.style.width = 'calc(100% - 16px)'; mapWrap.style.height = 'calc(100% - 70px)'; mapWrap.classList.add('fy-map-full'); }
      else { mapWrap.style.width = p + '%'; mapWrap.style.height = p + '%'; mapWrap.classList.remove('fy-map-full'); }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 10);
    }
    function _open() {
      if (_isMobile) { mapWrap.classList.remove('fy-map-collapsed'); mapWrap.classList.add('fy-map-active'); }
      else { mapWrap.classList.remove('fy-map-mini'); mapWrap.classList.add('fy-map-active'); _setPct(_mapPctIdx); }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 260);
    }
    function _close() {
      mapWrap.classList.remove('fy-map-active', 'fy-map-full');
      if (_isMobile) mapWrap.classList.add('fy-map-collapsed');
      else { mapWrap.classList.add('fy-map-mini'); mapWrap.style.width = ''; mapWrap.style.height = ''; }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 260);
    }
    gameEl.querySelector('#fy-map-thumb')?.addEventListener('click', e => { e.stopPropagation(); _open(); });
    gameEl.querySelector('#fy-map-close')?.addEventListener('click', e => { e.stopPropagation(); _close(); });
    gameEl.querySelector('#fy-zoom-cycle')?.addEventListener('click', e => { e.stopPropagation(); _mapPctIdx = (_mapPctIdx+1)%_MAP_PCTS.length; _setPct(_mapPctIdx); });
    if (!_isMobile) gameEl.addEventListener('click', e => { if (mapWrap.classList.contains('fy-map-active') && !mapWrap.contains(e.target)) _close(); }, true);
    gameEl.querySelector('#fy-map-reset')?.addEventListener('click', e => { e.stopPropagation(); _sv.setPov(_initPov); _sv.setPosition(_actual); });

    gameEl.querySelector('#fy-sv-loading')?.remove();
    gameEl.querySelector('#fy-submit')?.addEventListener('click', _submit);
    _startTimer(gameEl, elapsed || 0);
  }

  function _startTimer(gameEl, elapsed) {
    _stopTimer();
    const timed = _time > 0;
    _timeLeft = timed ? Math.max(0, _time - elapsed) : 0;
    const start = Date.now() - elapsed * 1000;
    _timer = setInterval(() => {
      const el = gameEl.querySelector('#fy-timer'), mapEl = gameEl.querySelector('#fy-map-timer');
      if (timed) {
        _timeLeft--;
        const txt = _fmtTime(Math.max(0, _timeLeft)), urgent = _timeLeft <= 10;
        if (el) { el.textContent = txt; el.classList.toggle('urgent', urgent); }
        if (mapEl) { mapEl.textContent = txt; mapEl.classList.toggle('urgent', urgent); }
        if (_timeLeft <= 0) { _stopTimer(); _timeUp(); }
      } else {
        const txt = _fmtTime(Math.floor((Date.now()-start)/1000));
        if (el) el.textContent = txt; if (mapEl) mapEl.textContent = txt;
      }
    }, 1000);
  }

  function _myInfo() {
    const me = mp.me() || {};
    return {
      display_name: me.display_name || window.GameHub?.currentPlayer()?.display_name || '?',
      avatar_svg:   me.avatar_svg   || window.GameHub?.currentPlayer()?.avatar_svg,
      avatar_color: me.avatar_color || window.GameHub?.currentPlayer()?.avatar_color,
    };
  }

  function _submit() {
    if (_submitted) return;
    _submitted = true; _stopTimer();
    const lat = _guess ? _guess.lat : null, lng = _guess ? _guess.lng : null;
    mp.send({ type: 'fy_guess', lat, lng });
    const info = _myInfo();
    _liveGuesses[mp.youId()] = { lat, lng, dist_km: (lat != null && _actual) ? _distKm({lat,lng}, _actual) : null, ...info };
    _showLive();
  }

  function _timeUp() {
    if (_submitted) return;
    _submitted = true; _stopTimer();
    const lat = _guess ? _guess.lat : null, lng = _guess ? _guess.lng : null;
    mp.send({ type: 'fy_guess', lat, lng });
    const info = _myInfo();
    _liveGuesses[mp.youId()] = { lat, lng, dist_km: (lat != null && _actual) ? _distKm({lat,lng}, _actual) : null, ...info };
    _showLive();
  }

  // ── waiting / live map after submitting ──────────────────────────────────
  function _showLive() {
    const gameEl = _gameEl(); if (!gameEl) return;
    gameEl.querySelectorAll('.fy-result-overlay').forEach(el => el.remove());
    // Hide Street View so its iframe doesn't bleed through the overlay.
    const svEl = gameEl.querySelector('#fy-sv');
    if (svEl) svEl.style.visibility = 'hidden';
    _liveMap = null; _liveMarkers = {}; _livePolylines = {};
    _liveTotal = mp.players().length || 1;
    const done = Object.keys(_liveGuesses).length;
    const ov = document.createElement('div');
    ov.className = 'fy-result-overlay'; ov.id = 'fy-live';
    ov.style.zIndex = '200';
    ov.innerHTML = `
      <div class="fy-result-box fy-mp-result">
        <h2>${_t('result')} — ${_t('round')} ${_round}/${_total}</h2>
        <div style="text-align:center;font-size:.78rem;color:#a6adc8;margin-bottom:4px"><span id="fy-live-status">${done}/${_liveTotal} ${_t('waiting_others')}</span></div>
        <div class="fy-result-map" id="fy-live-map"></div>
        <div class="fy-mp-scores" id="fy-live-scores"></div>
      </div>`;
    gameEl.appendChild(ov);
    _updateLiveScores();
    if (_actual && window.google) setTimeout(() => {
      const el = document.getElementById('fy-live-map'); if (!el) return;
      const bounds = new google.maps.LatLngBounds();
      _liveMap = new google.maps.Map(el, { streetViewControl:false, fullscreenControl:false, mapTypeControl:false, zoomControl:false, gestureHandling:'greedy' });
      new google.maps.Marker({ position:_actual, map:_liveMap, zIndex:999,
        icon:{ path:'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z', fillColor:'#f9e2af', fillOpacity:1, strokeColor:'#1e1e2e', strokeWeight:1.5, scale:1.8, anchor:new google.maps.Point(12,22) } });
      bounds.extend(_actual);
      Object.entries(_liveGuesses).forEach(([pid,g]) => _liveMarker(pid, g, bounds));
      if (bounds.isEmpty()) bounds.extend(_actual);
      _liveMap.fitBounds(bounds, 50);
    }, 100);
  }

  function _liveMarker(pid, g, bounds) {
    if (!_liveMap || g.lat == null) return;
    const pos = { lat:g.lat, lng:g.lng };
    const icon = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(_avatar(g, 28));
    if (_liveMarkers[pid]) _liveMarkers[pid].setMap(null);
    if (_livePolylines[pid]) _livePolylines[pid].setMap(null);
    _liveMarkers[pid] = new google.maps.Marker({ position:pos, map:_liveMap, title:g.display_name, zIndex:10,
      icon:{ url:icon, scaledSize:new google.maps.Size(28,28), anchor:new google.maps.Point(14,14) } });
    _livePolylines[pid] = new google.maps.Polyline({ path:[pos,_actual], map:_liveMap, strokeColor:g.avatar_color||'#89b4fa', strokeOpacity:.55, strokeWeight:2 });
    if (bounds) bounds.extend(pos);
  }

  function _updateLiveScores() {
    const el = document.getElementById('fy-live-scores'); if (!el) return;
    const waiting = (_liveTotal) - Object.keys(_liveGuesses).length;
    const allPlayers = mp.players();
    const byDist = allPlayers.slice().sort((a,b) => {
      const ga = _liveGuesses[a.id], gb = _liveGuesses[b.id];
      if (!ga && !gb) return 0;
      if (!ga) return 1;
      if (!gb) return -1;
      return (ga.dist_km||Infinity) - (gb.dist_km||Infinity);
    });
    el.innerHTML = byDist.map((p, idx) => {
      const g = _liveGuesses[p.id];
      const isMe = p.id === mp.youId();
      const rank = g ? `${idx+1}.` : '—';
      if (g) {
        return `<div class="fy-mp-score-row${isMe?' you':''}">
          <span class="rank">${rank}</span>${_avatar(p, 22)}<span class="nm">${_esc(p.display_name)}${isMe?' ('+_t('you')+')':''}</span>
          <span class="ds">${g.lat!=null?_fmtDist(g.dist_km):'—'}</span><span class="rs">✓</span>
        </div>`;
      } else {
        return `<div class="fy-mp-score-row${isMe?' you':''}">
          <span class="rank">—</span>${_avatar(p, 22)}<span class="nm">${_esc(p.display_name)}${isMe?' ('+_t('you')+')':''}</span>
          <span class="ds" style="color:#a6adc8">⏳</span><span class="rs" style="color:#a6adc8">—</span>
        </div>`;
      }
    }).join('');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Transport handlers (registered once, at load)
  // ══════════════════════════════════════════════════════════════════════

  // Host: resolve Street View locations and deliver them to the server.
  mp.on('fy_need_locations', async (msg) => {
    const settings = mp.settings() || {};
    const key = localStorage.getItem('fy_api_key') || settings.api_key || '';
    const countryKey = settings.country || 'world';
    const gameEl = _gameEl();
    if (!key) { if (gameEl) gameEl.innerHTML = `<div class="fy-screen"><p style="color:#f38ba8">${_t('api_missing')}</p></div>`; return; }
    try { await _loadMaps(key); }
    catch (e) { if (gameEl) gameEl.innerHTML = `<div class="fy-screen"><p style="color:#f38ba8">${_t('maps_fail')}</p></div>`; return; }
    const n = msg.rounds || _total;
    const locs = [];
    for (let i = 0; i < n; i++) {
      if (gameEl) gameEl.innerHTML = `<div class="fy-screen"><div style="font-size:1.6rem">🌍</div><p style="color:#a6adc8">${_t('preparing')} (${i}/${n})</p></div>`;
      try { locs.push(await _resolveLocation(countryKey)); } catch (e) { /* retry budget exhausted — skip */ }
    }
    mp.send({ type: 'fy_locations', locations: locs });
  });

  mp.on('fy_preparing', (msg) => {
    _total = msg.rounds || _total;
    const gameEl = _gameEl();
    if (gameEl && !mp.isHost()) gameEl.innerHTML = `<div class="fy-screen"><div style="font-size:1.6rem">⏳</div><p style="color:#a6adc8">${_t('preparing')}…</p></div>`;
  });

  mp.on('fy_round_start', async (msg) => {
    _stopTimer();
    _round = msg.round; _total = msg.total; _time = msg.time; _apiKey = msg.api_key || _apiKey;
    _countryCenter = msg.country_center || { lat: 20, lng: 0 };
    _countryZoom = msg.country_zoom || 2;
    _submitted = false; _guess = null; _liveGuesses = {};
    const gameEl = _gameEl(); if (!gameEl) return;
    _buildRoundUI(gameEl);
    try { await _loadMaps(_apiKey); }
    catch (e) { gameEl.innerHTML = `<div class="fy-screen"><p style="color:#f38ba8">${_t('maps_fail')}</p></div>`; return; }
    const elapsed = msg.started_at ? Math.floor(Date.now()/1000 - msg.started_at) : 0;
    if (_time > 0 && elapsed >= _time) { _renderRound(gameEl, { lat: msg.lat, lng: msg.lng }, msg.heading, elapsed); _timeUp(); return; }
    _renderRound(gameEl, { lat: msg.lat, lng: msg.lng }, msg.heading, elapsed);
  });

  function _animateGuess(player) {
    const gameEl = _gameEl(); if (!gameEl) return;
    const bar = document.getElementById('fy-guessed-bar'); if (!bar) return;

    // Big avatar in center
    const big = document.createElement('div');
    big.style.cssText = 'position:absolute;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;pointer-events:none';
    const avatarHtml = _avatar(player, 80);
    big.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;animation:fy-guess-pop .35s cubic-bezier(.34,1.56,.64,1) both">
      <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 4px ${player.avatar_color||'#89b4fa'},0 4px 24px rgba(0,0,0,.6)">${avatarHtml}</div>
      <div style="font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.8);background:rgba(0,0,0,.5);padding:3px 10px;border-radius:20px">${_esc(player.display_name||'')}</div>
    </div>`;
    gameEl.appendChild(big);

    // After 1.2s — shrink into bar
    setTimeout(() => {
      big.remove();
      // Add small icon to bar
      const icon = document.createElement('div');
      icon.style.cssText = 'width:26px;height:26px;border-radius:50%;overflow:hidden;border:2px solid '+(player.avatar_color||'#89b4fa')+';flex-shrink:0;animation:fy-guess-shrink .3s cubic-bezier(.34,1.56,.64,1) both';
      icon.title = player.display_name || '';
      icon.innerHTML = _avatar(player, 26);
      bar.appendChild(icon);
    }, 1200);
  }

  mp.on('fy_guess_update', (msg) => {
    const dist = (msg.lat != null && _actual) ? _distKm({ lat: msg.lat, lng: msg.lng }, _actual) : null;
    _liveGuesses[msg.player_id] = { lat: msg.lat, lng: msg.lng, dist_km: dist,
      display_name: msg.display_name, avatar_svg: msg.avatar_svg, avatar_color: msg.avatar_color };
    _animateGuess(_liveGuesses[msg.player_id]);
    if (!_submitted) return;
    const st = document.getElementById('fy-live-status');
    if (st) st.textContent = `${Object.keys(_liveGuesses).length}/${_liveTotal} ${_t('waiting_others')}`;
    _updateLiveScores();
    if (_liveMap && msg.lat != null) _liveMarker(msg.player_id, _liveGuesses[msg.player_id], null);
  });

  mp.on('fy_round_end', (msg) => _showRoundEnd(msg));
  mp.on('fy_state', (msg) => _applyState(msg));
  mp.on('fy_game_over', (msg) => _showGameOver(msg));

  // ── round end overlay ────────────────────────────────────────────────────
  function _showRoundEnd(msg) {
    _stopTimer();
    if (msg.actual) _actual = msg.actual;
    const isLast = msg.round >= msg.total;
    const isHost = mp.isHost();
    const byScore = (msg.results || []).slice().sort((a,b)=>b.score-a.score);
    const byTotal = (msg.results || []).slice().sort((a,b)=>b.total-a.total);
    const rank = {}; byTotal.forEach((r,i)=>{ rank[r.player_id] = i+1; });
    const me = mp.youId();

    const gameEl = _gameEl();
    if (gameEl) {
      const svEl = gameEl.querySelector('#fy-sv');
      if (svEl) svEl.style.visibility = 'hidden';
      gameEl.querySelectorAll('.fy-result-overlay').forEach(el => el.remove());
    }

    const overlay = document.createElement('div');
    overlay.className = 'fy-result-overlay';
    overlay.style.zIndex = '200';
    overlay.innerHTML = `
      <div class="fy-result-box fy-mp-result">
        <h2>${_t('result')} — ${_t('round')} ${msg.round}/${msg.total}</h2>
        <div class="fy-result-map" id="fy-result-map"></div>
        <div class="fy-mp-scores">
          ${byScore.map((r,idx)=>`
            <div class="fy-mp-score-row${idx===0?' winner':''}${r.player_id===me?' you':''}" data-pid="${r.player_id}" style="cursor:pointer">
              <span class="rank">${rank[r.player_id]}.</span>${_avatar(r,22)}
              <span class="nm">${_esc(r.display_name)}${r.player_id===me?' ('+_t('you')+')':''}</span>
              <span class="ds">${r.lat!=null?_fmtDist(r.dist_km):'—'}</span>
              <span class="rs">+${r.score}</span><span class="ts">${r.total}</span>
            </div>`).join('')}
        </div>
        <div class="fy-mp-result-ctrl" id="fy-mp-result-ctrl"></div>
      </div>`;
    (_gameEl() || _root).appendChild(overlay);

    const ctrl = overlay.querySelector('#fy-mp-result-ctrl');
    if (!isLast) {
      if (isHost) {
        ctrl.innerHTML = `<button class="fy-btn" id="fy-next">${_t('next_round')} ▶</button>`;
        ctrl.querySelector('#fy-next').addEventListener('click', e => { e.target.disabled = true; mp.send({ type: 'fy_next' }); });
      } else {
        ctrl.innerHTML = `<div class="fy-mp-waitnext">${_t('waiting_round')}</div>`;
      }
    } else {
      if (isHost) {
        ctrl.innerHTML = `<button class="fy-btn" id="fy-end">🏁 ${_t('final')} ▶</button>`;
        ctrl.querySelector('#fy-end').addEventListener('click', e => { e.target.disabled = true; mp.send({ type: 'fy_end' }); });
      } else {
        ctrl.innerHTML = `<div class="fy-mp-waitnext">${_t('waiting_round')}</div>`;
      }
    }

    if (msg.actual && window.google) setTimeout(() => {
      const mapEl = document.getElementById('fy-result-map'); if (!mapEl) return;
      const bounds = new google.maps.LatLngBounds();
      const rMap = new google.maps.Map(mapEl, { streetViewControl:false, fullscreenControl:false, mapTypeControl:false, zoomControl:false, gestureHandling:'greedy' });
      new google.maps.Marker({ position:msg.actual, map:rMap, zIndex:999,
        icon:{ path:'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z', fillColor:'#f9e2af', fillOpacity:1, strokeColor:'#1e1e2e', strokeWeight:1.5, scale:1.8, anchor:new google.maps.Point(12,22) } });
      bounds.extend(msg.actual);
      const polylines = {}, markers = {}; let hi = null;
      (msg.results||[]).forEach(r => {
        if (r.lat == null) return;
        const pos = { lat:r.lat, lng:r.lng };
        const icon = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(_avatar(r, 28));
        markers[r.player_id] = new google.maps.Marker({ position:pos, map:rMap, title:r.display_name, zIndex:10,
          icon:{ url:icon, scaledSize:new google.maps.Size(28,28), anchor:new google.maps.Point(14,14) } });
        polylines[r.player_id] = new google.maps.Polyline({ path:[pos,msg.actual], map:rMap, strokeColor:r.avatar_color||'#89b4fa', strokeOpacity:.55, strokeWeight:2 });
        bounds.extend(pos);
      });
      rMap.fitBounds(bounds, 50);
      overlay.querySelectorAll('.fy-mp-score-row[data-pid]').forEach(row => {
        row.addEventListener('click', () => {
          const pid = row.dataset.pid, already = hi === pid;
          Object.values(polylines).forEach(pl => pl.setOptions({ strokeOpacity:.55, strokeWeight:2, zIndex:1 }));
          Object.values(markers).forEach(mk => mk.setZIndex(10));
          overlay.querySelectorAll('.fy-mp-score-row').forEach(r => r.classList.remove('highlighted'));
          if (already) { hi = null; }
          else { hi = pid; if (polylines[pid]) polylines[pid].setOptions({ strokeOpacity:1, strokeWeight:5, zIndex:20 }); if (markers[pid]) markers[pid].setZIndex(100); row.classList.add('highlighted'); }
        });
      });
    }, 100);
  }

  // ── game over ────────────────────────────────────────────────────────────
  function _showGameOver(msg) {
    _stopTimer();
    try { localStorage.removeItem('gh_active_room'); } catch (e) {}
    const standings = msg.standings || [];
    const winner = standings[0], me = mp.youId();
    _root.innerHTML = `
      <div class="fy-root"><div class="fy-screen">
        <div style="font-size:2.5rem">🏆</div>
        <h1>${_t('final')}</h1>
        ${winner ? `<div class="fy-result-score" style="color:${winner.avatar_color||'#89b4fa'}">${_t('winner')}: ${_esc(winner.display_name)}</div>` : ''}
        <div class="fy-mp-scores fy-mp-final">
          ${standings.map((s,i)=>`
            <div class="fy-mp-score-row${i===0?' winner':''}${s.player_id===me?' you':''}">
              <span class="rank">${i+1}.</span>${_avatar(s,22)}
              <span class="nm">${_esc(s.display_name)}</span><span class="ts">${s.total}</span>
            </div>`).join('')}
        </div>
        <a href="/pub/gamehub/" class="fy-btn" style="text-decoration:none;display:inline-block">← Game Hub</a>
      </div></div>`;
  }

  // ── reconnect: rebuild current state ─────────────────────────────────────
  async function _applyState(s) {
    _total = s.total; _time = s.time; _apiKey = s.api_key || _apiKey;
    _countryCenter = s.country_center || { lat: 20, lng: 0 };
    _countryZoom = s.country_zoom || 2;
    if (!s.started) return; // still in preparing
    _round = s.round;
    const gameEl = _gameEl(); if (!gameEl) return;
    if (s.result_shown) {
      _showRoundEnd({ round: s.round, total: s.total, actual: s.actual, results: s.results, host_id: mp.hostId() });
      return;
    }
    if (s.location) {
      _buildRoundUI(gameEl);
      try { await _loadMaps(_apiKey); } catch (e) { return; }
      const elapsed = s.started_at ? Math.floor(Date.now()/1000 - s.started_at) : 0;
      _renderRound(gameEl, { lat: s.location.lat, lng: s.location.lng }, s.location.heading, elapsed);
      if (s.you_guessed) { _submitted = true; _showLive(); }
    }
  }

  // ── register with the hub ────────────────────────────────────────────────
  mp.registerGame({ id: 'findyourself', name: 'FindYourself', renderSetup, renderGame });
})();
