// mvmOS App: FindYourself v1.3.0
const _fyi18n = {
  en: {
    title: 'FindYourself', play: 'Play', settings_btn: '⚙ Settings',
    no_api: 'Enter your Google Maps API key in App Settings to play.',
    round: 'Round', of: 'of', score: 'Score', time: 'Time',
    click_map: 'Click on the map to place your guess',
    reset_pos: 'Reset position', expand_map: 'Expand map', collapse_map: 'Collapse map',
    submit: 'Submit Guess', next_round: 'Next Round', see_result: 'See Result',
    finish: 'Finish Game', play_again: 'Play Again',
    distance: 'Distance', points: 'Points',
    result_title: 'Round Result',
    final_title: 'Game Over',
    total_score: 'Total Score',
    best: 'Best', rounds_label: 'rounds',
    rounds_count: 'Rounds', time_per_round: 'Time per round', no_limit: 'No limit', region: 'Region',
    location_pts: 'Location', time_bonus: 'Time bonus', total_pts: 'Total',
    loading: 'Loading Street View…',
    no_sv: 'No Street View found nearby, trying another location…',
    singleplayer: 'Single player', multiplayer: 'Multiplayer',
    mp_share: 'Share this link with your friends:', copy_link: 'Copy link', copied: 'Copied!',
    host: 'Host', your_name: 'Your name', ready: 'Ready', waiting_host: 'Waiting for host…',
    players: 'Players', start_game: 'Start game', need_players: 'Waiting for players…',
    waiting_others: 'Waiting for other players…', times_up: "Time's up! Calculating…",
    next_round: 'Next Round', final_standings: 'Final Standings', winner: 'Winner',
    you: 'You', final_standings: 'Final Standings', winner: 'Winner',
    mp_login: 'Log in to Game Hub to play multiplayer',
    open_games: 'Open games', no_open_games: 'No open games right now',
    create_game: 'Create game', join: 'Join', solo: 'Solo',
    players_waiting: 'players waiting', in_round: 'In round',
    start_game: 'Start game', preparing: 'Preparing round…',
    waiting_start: 'Waiting for someone to start…', waiting_round: 'Waiting for next round…',
    player_left_game: 'left the game',
    next_auto: 'Next round in',
    invite_players: 'Invite players', invite: 'Invite', invited: 'Invited ✓',
    logout: 'Logout', back: '← Back',
    maps_load_failed: 'Failed to load Google Maps. Check your API key.',
  },
  bg: {
    title: 'FindYourself', play: 'Играй', settings_btn: '⚙ Настройки',
    no_api: 'Въведи Google Maps API ключ в App Settings за да играеш.',
    round: 'Рунд', of: 'от', score: 'Точки', time: 'Време',
    click_map: 'Кликни на картата за да отбележиш позицията си',
    submit: 'Потвърди', next_round: 'Следващ рунд', see_result: 'Виж резултата',
    finish: 'Приключи', play_again: 'Играй пак',
    distance: 'Разстояние', points: 'Точки',
    result_title: 'Резултат',
    final_title: 'Край на играта',
    total_score: 'Общо точки',
    best: 'Рекорд', rounds_label: 'рунда',
    reset_pos: 'Начална позиция', expand_map: 'Разшири картата', collapse_map: 'Свий картата',
    rounds_count: 'Брой рундове', time_per_round: 'Време за рунд', no_limit: 'Без време', region: 'Регион',
    location_pts: 'Локация', time_bonus: 'Бонус за време', total_pts: 'Общо',
    loading: 'Зареждане на Street View…',
    no_sv: 'Няма Street View наблизо, опитваме друга локация…',
    singleplayer: 'Сам', multiplayer: 'Мултиплеър',
    mp_share: 'Сподели този линк с приятелите си:', copy_link: 'Копирай линка', copied: 'Копирано!',
    host: 'Хост', your_name: 'Твоето име', ready: 'Готов', waiting_host: 'Чака хоста…',
    players: 'Играчи', start_game: 'Старт', need_players: 'Чака играчи…',
    waiting_others: 'Чака останалите играчи…', times_up: 'Времето изтече! Изчисляване…',
    next_round: 'Следващ рунд', final_standings: 'Крайно класиране', winner: 'Победител',
    you: 'Ти', final_standings: 'Крайно класиране', winner: 'Победител',
    mp_login: 'Влез в Game Hub за мултиплеър',
    open_games: 'Отворени игри', no_open_games: 'Няма отворени игри',
    create_game: 'Създай игра', join: 'Присъедини се', solo: 'Сам',
    players_waiting: 'играча чакат', in_round: 'В рунд',
    start_game: 'Стартирай', preparing: 'Подготвяме рунда…',
    waiting_start: 'Чака някой да стартира…', waiting_round: 'Чака следващия рунд…',
    player_left_game: 'напусна играта',
    next_auto: 'Следващ рунд след',
    invite_players: 'Покани играчи', invite: 'Покани', invited: 'Поканен ✓',
    logout: 'Изход', back: '← Назад',
    maps_load_failed: 'Грешка при зареждане на Google Maps. Провери своя API ключ.',
  },
};
function _fyt(key) { const l = window.mvmOS?.lang || 'en'; return (_fyi18n[l] || _fyi18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'findyourself',
  name: 'FindYourself',
  icon: '🌍',
  category: 'Games',
  settings: [
    { key: 'api_key', label: 'Google Maps API Key', type: 'password', default: '' },
    { key: 'rounds',  label: 'Rounds per game',     type: 'number',  default: 5, min: 1, max: 10 },
    { key: 'time',    label: 'Time per round (sec, 0 = unlimited)', type: 'number', default: 60, min: 0 },
  ],
  launch(opts) {
    mvmOS.createWindow({
      id: 'findyourself',
      title: '🌍 FindYourself',
      icon: '🌍',
      width: 1000,
      height: 640,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'findyourself' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => FY.mount(body));
      },
    });
  },
});

const FY = (() => {
  // На standalone multiplayer страницата mvmOS.db липсва → _db = null (ползва се само от хоста)
  const _db = (typeof mvmOS !== 'undefined' && mvmOS.db) ? mvmOS.db('findyourself') : null;
  let _root = null;
  let _cfg = { api_key: '', rounds: 5, time: 60 };
  let _sv = null;       // Street View panorama
  let _map = null;      // guess map
  let _marker = null;   // player's guess marker
  let _guess = null;    // { lat, lng }
  let _actual = null;   // { lat, lng }
  let _round = 0;
  let _totalScore = 0;
  let _roundScores = [];
  let _locations = [];  // pre-generated coords for this game
  let _timerInterval = null;
  let _timeLeft = 0;
  let _roundStartTime = 0;  // ms timestamp когато рундът стане готов
  let _initPov = null;      // началната посока на гледане (за reset бутона)
  let _mapsLoaded = false;
  const _isMobile = window.matchMedia('(max-width:600px)').matches;

  let _mp = null;  // multiplayer module reference (null in single player)

  // Game Hub state
  let _ghPlayer = null;
  let _gameStartTime = 0;

  // ── Точкуване ──────────────────────────────────────────────────────────────
  const TIME_BONUS_MAX = 1000;     // макс бонус за време (5× по-малък от макс разстояние)
  const TIME_BONUS_WINDOW = 200;   // секунди до 0 бонус (5 точки/сек)
  function _timeBonus(elapsedSec) {
    const b = TIME_BONUS_MAX * (1 - elapsedSec / TIME_BONUS_WINDOW);
    return Math.max(0, Math.round(b));
  }

  // Размер на картата — стъпки в % от екрана (запомня се за цялата игра)
  const _MAP_PCTS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let _mapPctIdx = 2;  // default 30%

  // ── Country definitions [minLat, maxLat, minLng, maxLng, score scale, map zoom, center] ─────
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

  // ── Random locations ──────────────────────────────────────────────────────
  // Weighted list of land bounding boxes [minLat, maxLat, minLng, maxLng, weight]
  const _BOXES = [
    [35, 71, -10, 40, 25],   // Europe
    [25, 50, 60, 140, 20],   // Asia
    [-35, 37, -18, 52, 15],  // Africa
    [25, 50, -125, -65, 15], // North America
    [-55, 15, -82, -34, 10], // South America
    [-45, -10, 110, 155, 8], // Australia
    [0, 25, 100, 140, 7],    // SE Asia
  ];

  function _randomCoord() {
    const total = _BOXES.reduce((s, b) => s + b[4], 0);
    let r = Math.random() * total;
    for (const [minLat, maxLat, minLng, maxLng, w] of _BOXES) {
      r -= w;
      if (r <= 0) {
        return {
          lat: minLat + Math.random() * (maxLat - minLat),
          lng: minLng + Math.random() * (maxLng - minLng),
        };
      }
    }
    return { lat: Math.random() * 140 - 70, lng: Math.random() * 360 - 180 };
  }

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

  // ── Score calculation (GeoGuessr-style) ───────────────────────────────────
  function _calcScore(distKm) {
    const scale = (_cfg.country && _cfg.country !== 'world' && _COUNTRIES[_cfg.country]?.scale) || 2000;
    if (distKm < 0.05) return 5000;
    return Math.round(5000 * Math.exp(-distKm / scale));
  }

  function _distKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  function _fmtDist(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 100) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
  }

  function _fmtTime(s) {
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ── Game Hub helpers ─────────────────────────────────────────────────────

  function _loadGameHub(cb, errCb) {
    if (window.GameHub) { window.GameHub.init().then(cb); return; }
    const s = document.createElement('script');
    s.src = `/apps/gamehub/widget.js?_=${Date.now()}`;
    s.onload  = () => window.GameHub?.init().then(cb) || cb();
    s.onerror = errCb || cb;
    document.head.appendChild(s);
  }

  function _avatar(player, size) {
    if (window.GameHub) return window.GameHub.renderAvatar(player, size);
    const color = (player && player.avatar_color) || '#585b70';
    const letter = ((player && player.display_name && player.display_name[0]) || '?').toUpperCase();
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="border-radius:50%;display:block;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="67" font-family="system-ui,sans-serif" font-size="54" font-weight="700" fill="#1e1e2e" text-anchor="middle">${letter}</text></svg>`;
  }

  function _renderGhSection(container, onReload, onUnlock) {
    if (!window.GameHub) { container.style.display = 'none'; return; }
    container.style.display = '';
    const p = window.GameHub.currentPlayer();
    _ghPlayer = p || null;
    if (p) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);border-radius:8px;padding:8px 12px;width:100%;box-sizing:border-box">
          ${_avatar(p, 22)}
          <div style="flex:1;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.display_name}</div>
          <button id="fy-gh-out" style="border:none;background:none;color:#a6adc8;font-size:11px;cursor:pointer;padding:2px 6px;flex-shrink:0">${_fyt('logout')}</button>
        </div>`;
      container.querySelector('#fy-gh-out').onclick = async () => {
        await window.GameHub.logout();
        _ghPlayer = null;
        onReload();
      };
      onUnlock?.();
    } else {
      // No login of its own — renderWidget delegates to Apps Hub.
      // Play stays locked until the user is logged in.
      window.GameHub.renderWidget(container, {
        onReady(player) { _ghPlayer = player; onReload(); },
      });
    }
  }

  function _recordGhSession(durationSeconds) {
    if (!_ghPlayer || !window.GameHub) return;
    window.GameHub.recordSession({
      game_id: 'findyourself',
      mode: 'singleplayer',
      players: [{ player_id: _ghPlayer.id, score: _totalScore, is_winner: true }],
      duration_seconds: durationSeconds,
      metadata: { rounds: _cfg.rounds, time_per_round: _cfg.time },
    }).catch(() => {});
  }

  function _recordMpSession(standings) {
    if (!window.GameHub) return;
    const winner = standings[0];
    window.GameHub.recordSession({
      game_id: 'findyourself',
      mode: 'multiplayer',
      players: standings.map(s => ({
        ...(s.gh_player_id ? { player_id: s.gh_player_id } : { guest_name: s.name }),
        score: s.total,
        is_winner: s === winner,
      })),
      metadata: { rounds: _cfg.rounds, time_per_round: _cfg.time },
    }).catch(() => {});
  }

  // ── Google Maps loader ────────────────────────────────────────────────────
  function _loadMaps(apiKey) {
    return new Promise((resolve, reject) => {
      if (_mapsLoaded && window.google?.maps) { resolve(); return; }
      if (window._fyMapsLoading) { window._fyMapsResolvers.push(resolve); return; }
      window._fyMapsLoading = true;
      window._fyMapsResolvers = [resolve];
      window._fyMapsCallback = () => {
        _mapsLoaded = true;
        window._fyMapsLoading = false;
        window._fyMapsResolvers.forEach(r => r());
      };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=_fyMapsCallback`;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  async function mount(body) {
    _root = body;
    await _initDb();
    await _loadCfg();
    _showSetup();
    window.addEventListener('settings-changed', async e => {
      if (e.detail?.app === 'findyourself') { await _loadCfg(); }
    });
  }

  async function _initDb() {
    await _db.run(`CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)`);
    await _db.run(`CREATE TABLE IF NOT EXISTS scores
      (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, rounds INTEGER, date TEXT)`);
  }

  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    const s = {};
    rows.forEach(r => { try { s[r.key] = JSON.parse(r.value); } catch(_) { s[r.key] = r.value; } });
    _cfg = {
      api_key: s.api_key || '',
      rounds:  parseInt(s.rounds) || 5,
      time:    parseInt(s.time) || 60,
      country: s.country || 'world',
    };
  }

  // ── Setup screen ──────────────────────────────────────────────────────────
  async function _showSetup() {
    _stopTimer();
    const best = await _getBest();
    _root.innerHTML = `
      <div class="fy-root">
        <div class="fy-screen">
          <div style="font-size:3rem">🌍</div>
          <h1>${_fyt('title')}</h1>
          <p>Drop into a random Street View location anywhere in the world and guess where you are on the map.</p>
          ${best ? `<div style="font-size:.82rem;color:#a6adc8">${_fyt('best')}: <strong>${best.total}</strong> pts / ${best.rounds} ${_fyt('rounds_label')}</div>` : ''}
          ${!_cfg.api_key ? `
            <p style="color:#f38ba8;font-size:.82rem">${_fyt('no_api')}</p>
            <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com" target="_blank" style="font-size:.78rem;color:#89b4fa">Get API key from Google Cloud Console →</a>
            <button class="fy-btn secondary" onclick="AppStore?.openWindow({section:'my-apps',appId:'findyourself'})">${_fyt('settings_btn')}</button>
          ` : `
            <div class="fy-setup-opts">
              <label class="fy-setup-field">
                <span>${_fyt('rounds_count')}</span>
                <input type="number" id="fy-set-rounds" min="1" max="50" value="${_cfg.rounds}">
              </label>
              <label class="fy-setup-field">
                <span>${_fyt('time_per_round')}</span>
                <select id="fy-set-time">${_timeOptions(_cfg.time)}</select>
              </label>
              <label class="fy-setup-field">
                <span>${_fyt('region')}</span>
                <select id="fy-set-country">${_countryOptions(_cfg.country)}</select>
              </label>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
              <button class="fy-btn" id="fy-start">🌍 ${_fyt('singleplayer')}</button>
              <button class="fy-btn secondary" id="fy-start-mp" disabled>👥 ${_fyt('multiplayer')}</button>
            </div>
            <div id="fy-gh-section" style="width:280px"></div>
          `}
        </div>
      </div>`;
    const startBtn   = _root.querySelector('#fy-start');
    const startMpBtn = _root.querySelector('#fy-start-mp');
    if (startBtn) startBtn.disabled = true;

    const ghSection = _root.querySelector('#fy-gh-section');
    _loadGameHub(() => {
      if (!ghSection) return;
      _renderGhSection(ghSection, () => _showSetup(), () => {
        if (startBtn) startBtn.disabled = false;
        // MP only available when logged into Game Hub
        if (startMpBtn) startMpBtn.disabled = !_ghPlayer;
      });
    }, () => {
      if (startBtn) startBtn.disabled = false;
    });

    _root.querySelector('#fy-start')?.addEventListener('click', _startGame);
    // Multiplayer now lives entirely in the Game Hub. The button opens the
    // public hub, where games are created, players invited and matches played.
    _root.querySelector('#fy-start-mp')?.addEventListener('click', () => {
      window.open('/pub/gamehub/', '_blank');
    });
  }

  // Прочита избраните рундове/време от setup екрана в _cfg
  function _readSetupOpts() {
    const rEl = _root.querySelector('#fy-set-rounds');
    const tEl = _root.querySelector('#fy-set-time');
    const cEl = _root.querySelector('#fy-set-country');
    if (rEl) _cfg.rounds = Math.min(50, Math.max(1, parseInt(rEl.value) || 5));
    if (tEl) { const t = parseInt(tEl.value); _cfg.time = isNaN(t) ? 60 : t; }
    if (cEl) _cfg.country = cEl.value || 'world';
  }

  // Селект опции за време: 10-50s, после 1-10 мин, + без време
  function _timeOptions(selected) {
    const opts = [10, 20, 30, 40, 50];
    for (let m = 1; m <= 10; m++) opts.push(m * 60);
    let html = opts.map(s => {
      const label = s < 60 ? s + 's' : (s / 60) + ' min';
      return `<option value="${s}" ${s === selected ? 'selected' : ''}>${label}</option>`;
    }).join('');
    html += `<option value="0" ${selected === 0 ? 'selected' : ''}>${_fyt('no_limit')}</option>`;
    return html;
  }

  async function _getBest() {
    const rows = await _db.query('SELECT * FROM scores ORDER BY total DESC LIMIT 1');
    return rows[0] || null;
  }

  // ── Game ──────────────────────────────────────────────────────────────────
  async function _startGame() {
    _readSetupOpts();
    await _db.run('INSERT OR REPLACE INTO cfg (key, value) VALUES (?,?)', ['country', JSON.stringify(_cfg.country)]);
    _gameStartTime = Date.now();
    _mapPctIdx = 2;  // ресет размер на картата за новата игра
    _round = 0;
    _totalScore = 0;
    _roundScores = [];
    _locations = Array.from({ length: _cfg.rounds }, () => _coordForRegion(_cfg.country));
    _root.innerHTML = `<div class="fy-root"><div class="fy-game" id="fy-game"></div></div>`;
    try {
      await _loadMaps(_cfg.api_key);
    } catch(e) {
      _root.innerHTML = `<div class="fy-root"><div class="fy-screen"><p style="color:#f38ba8">${_fyt('maps_load_failed')}</p><button class="fy-btn secondary" id="fy-back">${_fyt('back')}</button></div></div>`;
      _root.querySelector('#fy-back').addEventListener('click', _showSetup);
      return;
    }
    _nextRound();
  }

  // Шаблон на рунда (HUD + Street View + компас + карта). Преизползва се single + MP.
  function _buildRoundUI(gameEl) {
    gameEl.innerHTML = `
      <div class="fy-hud">
        <div class="fy-hud-pill">${_fyt('round')} <strong>${_round}</strong> ${_fyt('of')} <strong>${_cfg.rounds}</strong></div>
        <div class="fy-hud-pill">${_fyt('score')}: <strong id="fy-score-val">${_totalScore}</strong></div>
        <div class="fy-hud-pill fy-timer" id="fy-timer">${_cfg.time > 0 ? _fmtTime(_cfg.time) : '0:00'}</div>
      </div>
      <div id="fy-sv" class="fy-sv"></div>
      <div class="fy-map-wrap ${_isMobile ? 'fy-map-collapsed' : 'fy-map-mini'}" id="fy-map-wrap">
        <div id="fy-map" class="fy-map"></div>
        <div class="fy-map-thumb" id="fy-map-thumb"><span class="fy-map-thumb-ico">🗺</span></div>
        <div class="fy-map-timer" id="fy-map-timer">${_cfg.time > 0 ? _fmtTime(_cfg.time) : '0:00'}</div>
        <button class="fy-map-close-btn" id="fy-map-close" title="Close map">✕</button>
        <div class="fy-map-inner-controls" id="fy-map-inner-controls">
          ${!_isMobile ? `<button class="fy-map-btn" id="fy-zoom-cycle" title="Zoom map">⊞</button>` : ''}
          <button class="fy-map-btn" id="fy-map-reset" title="${_fyt('reset_pos')}">⌖</button>
          <button class="fy-guess-btn-map" id="fy-submit" disabled>${_fyt('submit')}</button>
        </div>
      </div>
      <div id="fy-sv-loading" style="position:absolute;inset:0;background:#1e1e2e;display:flex;align-items:center;justify-content:center;z-index:5;font-size:.9rem;color:#a6adc8">${_fyt('loading')}</div>
    `;
  }

  async function _nextRound() {
    _guess = null;
    _round++;
    const gameEl = _root.querySelector('#fy-game');
    if (!gameEl) return;
    _buildRoundUI(gameEl);
    await _loadRoundLocation(gameEl);
  }

  async function _loadRoundLocation(gameEl, attempt = 0) {
    if (attempt > 10) {
      const loading = gameEl.querySelector('#fy-sv-loading');
      if (loading) loading.textContent = 'Could not find Street View. Skipping round…';
      setTimeout(() => _submitGuess(true), 1500);
      return;
    }

    const coord = attempt === 0 ? _locations[_round - 1] : _coordForRegion(_cfg.country);
    if (attempt > 0) _locations[_round - 1] = coord;

    const svService = new google.maps.StreetViewService();
    svService.getPanorama({ location: coord, radius: 50000, source: google.maps.StreetViewSource.OUTDOOR }, async (data, status) => {
      if (status !== 'OK') {
        _loadRoundLocation(gameEl, attempt + 1);
        return;
      }
      const actual = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
      const countryData = _cfg.country && _cfg.country !== 'world' ? _COUNTRIES[_cfg.country] : null;
      if (countryData?.code) {
        const ok = await _verifyCountry(actual.lat, actual.lng, countryData.code);
        if (!ok) { _loadRoundLocation(gameEl, attempt + 1); return; }
      }
      _renderRound(gameEl, actual, Math.random() * 360);
    });
  }

  // Построява панорамата + картата + контролите + компаса за фиксирана локация и посока.
  // Преизползва се от single-player И multiplayer (споделена loc/heading за всички играчи).
  function _renderRound(gameEl, actual, heading, alreadyElapsed) {
    _actual = actual;
    _initPov = { heading, pitch: 0 };

    const svEl = gameEl.querySelector('#fy-sv');
    _sv = new google.maps.StreetViewPanorama(svEl, {
      position: _actual,
      pov: _initPov,
      addressControl: false,
      showRoadLabels: false,
      motionTracking: false,
      motionTrackingControl: false,
      fullscreenControl: false,
    });

    const mapEl = gameEl.querySelector('#fy-map');
    const _cm = _cfg.country && _cfg.country !== 'world' ? _COUNTRIES[_cfg.country] : null;
    _map = new google.maps.Map(mapEl, {
      zoom: _cm ? _cm.zoom : 2,
      center: _cm ? _cm.center : { lat: 20, lng: 0 },
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      zoomControl: false,
      gestureHandling: 'greedy',
      styles: [{ featureType: 'all', elementType: 'labels.text', stylers: [{ visibility: 'on' }] }],
    });
    _marker = null;
    _map.addListener('click', e => {
      _guess = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (_marker) _marker.setMap(null);
      _marker = new google.maps.Marker({ position: _guess, map: _map, title: 'Your guess' });
      const btn = gameEl.querySelector('#fy-submit');
      if (btn) btn.disabled = false;
    });

    // ── Map open/close/zoom ──────────────────────────────────────────────
    const mapWrap = gameEl.querySelector('#fy-map-wrap');

    // Размер в % от екрана; затвореното (мини) състояние е фиксиран малък размер от CSS
    function _setMapPct(idx) {
      const p = _MAP_PCTS[idx];
      if (p >= 100) {
        mapWrap.style.width = 'calc(100% - 16px)';
        mapWrap.style.height = 'calc(100% - 70px)';
        mapWrap.classList.add('fy-map-full');
      } else {
        mapWrap.style.width = p + '%';
        mapWrap.style.height = p + '%';
        mapWrap.classList.remove('fy-map-full');
      }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 10);
    }

    function _openMap() {
      if (_isMobile) {
        mapWrap.classList.remove('fy-map-collapsed');
        mapWrap.classList.add('fy-map-active');
      } else {
        mapWrap.classList.remove('fy-map-mini');
        mapWrap.classList.add('fy-map-active');
        _setMapPct(_mapPctIdx);
      }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 260);
    }

    function _closeMap() {
      mapWrap.classList.remove('fy-map-active', 'fy-map-full');
      if (_isMobile) {
        mapWrap.classList.add('fy-map-collapsed');
      } else {
        mapWrap.classList.add('fy-map-mini');
        mapWrap.style.width = '';   // връща към фиксирания мини размер от CSS
        mapWrap.style.height = '';
      }
      setTimeout(() => google.maps.event.trigger(_map, 'resize'), 260);
    }

    // Клик на затворената карта (thumb overlay) → отваря
    gameEl.querySelector('#fy-map-thumb')?.addEventListener('click', e => { e.stopPropagation(); _openMap(); });

    // X бутон → затваря
    gameEl.querySelector('#fy-map-close')?.addEventListener('click', e => { e.stopPropagation(); _closeMap(); });

    // Zoom бутон (десктоп) → цикъл през % стъпките, запомня за цялата игра
    gameEl.querySelector('#fy-zoom-cycle')?.addEventListener('click', e => {
      e.stopPropagation();
      _mapPctIdx = (_mapPctIdx + 1) % _MAP_PCTS.length;
      _setMapPct(_mapPctIdx);
    });

    // Десктоп: клик извън картата (върху Street View) → затваря
    if (!_isMobile) {
      gameEl.addEventListener('click', e => {
        if (!mapWrap.classList.contains('fy-map-active')) return;
        if (mapWrap.contains(e.target)) return;
        _closeMap();
      }, true);
    }

    // Reset — връща Street View към началната посока
    gameEl.querySelector('#fy-map-reset')?.addEventListener('click', e => {
      e.stopPropagation();
      _sv.setPov(_initPov);
      _sv.setPosition(_actual);
    });


    const loading = gameEl.querySelector('#fy-sv-loading');
    if (loading) loading.remove();

    // Submit бутон — разклонение single vs multiplayer
    gameEl.querySelector('#fy-submit')?.addEventListener('click', () => {
      if (_mp) _mpSubmit(); else _submitGuess(false);
    });

    _startTimer(gameEl, alreadyElapsed);
  }

  function _startTimer(gameEl, alreadyElapsed) {
    _stopTimer();
    const elapsed = alreadyElapsed || 0;
    _roundStartTime = Date.now() - elapsed * 1000;
    const timed = _cfg.time > 0;
    _timeLeft = timed ? Math.max(0, _cfg.time - elapsed) : 0;
    _timerInterval = setInterval(() => {
      const el    = gameEl.querySelector('#fy-timer');
      const mapEl = gameEl.querySelector('#fy-map-timer');
      if (timed) {
        _timeLeft--;
        const txt = _fmtTime(Math.max(0, _timeLeft));
        const urgent = _timeLeft <= 10;
        if (el)    { el.textContent = txt;    el.classList.toggle('urgent', urgent); }
        if (mapEl) { mapEl.textContent = txt; mapEl.classList.toggle('urgent', urgent); }
        const liveTimer = gameEl.querySelector('#fy-live-timer');
        if (liveTimer) { liveTimer.textContent = txt; liveTimer.style.color = urgent ? '#f38ba8' : '#f9e2af'; }
        if (_timeLeft <= 0) { _stopTimer(); if (_mp) _mpTimeUp(); else _submitGuess(false); }
      } else {
        const elapsed = Math.floor((Date.now() - _roundStartTime) / 1000);
        const txt = _fmtTime(elapsed);
        if (el)    el.textContent = txt;
        if (mapEl) mapEl.textContent = txt;
      }
    }, 1000);
  }

  function _stopTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  }

  function _submitGuess(noGuess = false) {
    _stopTimer();
    const gameEl = _root.querySelector('#fy-game');
    if (!gameEl) return;

    const elapsed = (Date.now() - _roundStartTime) / 1000;
    let dist = 0, distScore = 0, timeBonus = 0;
    if (!noGuess && _guess && _actual) {
      dist = _distKm(_guess, _actual);
      distScore = _calcScore(dist);
      timeBonus = _timeBonus(elapsed);
    }
    const score = distScore + timeBonus;
    _totalScore += score;
    _roundScores.push({ score, distScore, timeBonus, dist, actual: _actual, guess: _guess });

    // Show result overlay with map
    const isLast = _round >= _cfg.rounds;
    const overlay = document.createElement('div');
    overlay.className = 'fy-result-overlay';
    overlay.innerHTML = `
      <div class="fy-result-box">
        <h2>${_fyt('result_title')} — ${_fyt('round')} ${_round}/${_cfg.rounds}</h2>
        <div class="fy-result-score">+${score} ${_fyt('points')}</div>
        <div class="fy-result-dist">${noGuess || !_guess ? 'No guess — 0 points' : _fyt('distance') + ': ' + _fmtDist(dist)}</div>
        ${!noGuess && _guess ? `
        <div class="fy-result-breakdown">
          <span>${_fyt('location_pts')}: <strong>+${distScore}</strong></span>
          <span>${_fyt('time_bonus')} (${_fmtTime(Math.round(elapsed))}): <strong>+${timeBonus}</strong></span>
          <span>${_fyt('total_pts')}: <strong>${_totalScore}</strong></span>
        </div>` : ''}
        <div class="fy-result-map" id="fy-result-map"></div>
        <div class="fy-result-actions">
          <button class="fy-btn" id="fy-next">${isLast ? _fyt('finish') : _fyt('next_round')}</button>
        </div>
      </div>
    `;
    gameEl.appendChild(overlay);

    // Show result map with actual + guess lines
    setTimeout(() => {
      const resultMapEl = document.getElementById('fy-result-map');
      if (!resultMapEl || !_actual) return;
      const bounds = new google.maps.LatLngBounds();
      const rMap = new google.maps.Map(resultMapEl, {
        streetViewControl: false, fullscreenControl: false,
        mapTypeControl: false, zoomControl: false,
        gestureHandling: 'none',
      });
      // Actual location marker — pin shape
      new google.maps.Marker({
        position: _actual, map: rMap,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
          fillColor: '#f9e2af', fillOpacity: 1, strokeColor: '#1e1e2e', strokeWeight: 1.5,
          scale: 1.6, anchor: new google.maps.Point(12, 22),
        },
        title: 'Actual location', zIndex: 999,
      });
      bounds.extend(_actual);
      if (_guess) {
        new google.maps.Marker({
          position: _guess, map: rMap,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#f38ba8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: 'Your guess',
        });
        new google.maps.Polyline({
          path: [_actual, _guess], map: rMap,
          strokeColor: '#f1fa8c', strokeOpacity: .8, strokeWeight: 2,
        });
        bounds.extend(_guess);
      }
      rMap.fitBounds(bounds, 40);
    }, 100);

    overlay.querySelector('#fy-next').addEventListener('click', () => {
      overlay.remove();
      if (isLast) _showFinal();
      else _nextRound();
    });
  }

  async function _showFinal() {
    _stopTimer();
    _recordGhSession(Math.round((Date.now() - _gameStartTime) / 1000));
    await _db.run('INSERT INTO scores (total, rounds, date) VALUES (?,?,?)',
      [_totalScore, _cfg.rounds, new Date().toISOString()]);

    const best = await _getBest();
    _root.innerHTML = `
      <div class="fy-root">
        <div class="fy-screen">
          <div style="font-size:2.5rem">🌍</div>
          <h1>${_fyt('final_title')}</h1>
          <div class="fy-result-score">${_totalScore} ${_fyt('points')}</div>
          <div class="fy-scores">
            ${_roundScores.map((r, i) => `
              <div class="fy-score-row">
                <span class="rank">${i+1}.</span>
                <span class="sname">${r.guess ? _fmtDist(r.dist) : 'No guess'}</span>
                <span class="spts">+${r.score}</span>
              </div>
            `).join('')}
          </div>
          ${best ? `<div style="font-size:.8rem;color:#a6adc8">${_fyt('best')}: <strong>${best.total}</strong> pts</div>` : ''}
          <div style="display:flex;gap:10px">
            <button class="fy-btn" id="fy-again">${_fyt('play_again')}</button>
            <button class="fy-btn secondary" id="fy-home">← Menu</button>
          </div>
        </div>
      </div>`;
    _root.querySelector('#fy-again').addEventListener('click', _startGame);
    _root.querySelector('#fy-home').addEventListener('click', _showSetup);
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  return { mount };
})();
