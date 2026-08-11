(function () {
  'use strict';

  const BASE = '/api/pub/gamehub';
  const TOKEN_KEY = 'gh_token';

  let _player = null;
  let _token  = localStorage.getItem('apphub_token') || localStorage.getItem(TOKEN_KEY);

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  // The widget runs on Game Hub's own page and on every game's play page, and
  // both now carry Game Hub's string table. Falls back to English text rather
  // than the raw key, for any page that does not.
  function _t(key, fallback) {
    const s = window.t ? window.t(key) : key;
    return (!s || s === key) ? (fallback || key) : s;
  }

  function _setToken(token, player) {
    _token  = token;
    _player = player;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else       localStorage.removeItem(TOKEN_KEY);
  }

  async function _tryToken(token) {
    if (!token) return null;
    try {
      const r = await fetch(BASE + '/me', { headers: { 'X-GH-Token': token } });
      if (r.ok) return await r.json();
    } catch(e) {}
    return null;
  }

  async function _initSession() {
    // Apps Hub is the source of truth. A stale local 'gh_token' (e.g. left over
    // from a previous account) must never block a fresh apphub_token login.
    const apphubToken = localStorage.getItem('apphub_token');
    const ghToken      = localStorage.getItem(TOKEN_KEY);
    for (const token of [apphubToken, ghToken]) {
      if (!token) continue;
      const player = await _tryToken(token);
      if (player) {
        _token  = token;
        _player = player;
        localStorage.setItem(TOKEN_KEY, token);
        return _player;
      }
    }
    _setToken(null, null);
    return null;
  }

  // Game Hub has no login of its own. Identity comes from Apps Hub.
  // Inside mvmOS we use the shared AppHub.requireLogin window; on a standalone
  // page (e.g. an invite link opened on a phone) we bounce through the Apps Hub
  // public login page and come straight back.
  function _login(onDone) {
    if (typeof AppHub !== 'undefined' && AppHub && AppHub.requireLogin) {
      AppHub.requireLogin(async () => {
        _token = (AppHub.getToken && AppHub.getToken()) || localStorage.getItem('apphub_token');
        const p = await _initSession();
        if (onDone) onDone(p);
      });
    } else {
      location.href = '/pub/apphub/?return=' + encodeURIComponent(location.pathname + location.search);
    }
  }

  function _ensureStyle() {
    if (document.getElementById('gh-widget-css')) return;
    const s = document.createElement('style');
    s.id = 'gh-widget-css';
    s.textContent = `
      .gh-w { font-family:var(--font,system-ui,sans-serif);color:var(--fg,#cdd6f4) }
      .gh-w input{background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:6px;padding:6px 10px;font-size:13px;width:100%;box-sizing:border-box;outline:none}
      .gh-w input:focus{border-color:var(--accent,#89b4fa)}
      .gh-w .gh-btn{border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:13px;width:100%;transition:opacity .1s}
      .gh-w .gh-btn:hover{opacity:.85}
      .gh-w .gh-p{background:var(--accent,#89b4fa);color:#1e1e2e;font-weight:600}
      .gh-w .gh-s{background:var(--surface2,#313244);color:var(--fg,#cdd6f4)}
      .gh-w .gh-err{color:#f38ba8;font-size:12px;margin-top:2px;display:none}
      .gh-w .gh-back{color:var(--accent,#89b4fa);cursor:pointer;font-size:12px;text-decoration:underline;background:none;border:none;padding:0}
      #gh-save-exit{position:fixed;left:10px;bottom:10px;z-index:9000;background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:10px;padding:8px 14px;font-size:.82rem;font-weight:600;font-family:inherit;cursor:pointer;opacity:.85}
      #gh-save-exit:hover{opacity:1}
      #gh-save-ov{position:fixed;inset:0;z-index:9001;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px}
      #gh-save-ov .gh-save-card{background:var(--surface1,#181825);border:1px solid var(--border,#45475a);border-radius:16px;padding:26px 30px;text-align:center;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:90%;color:var(--fg,#cdd6f4);font-family:var(--font,system-ui,sans-serif)}
      #gh-save-ov button{border-radius:8px;padding:9px 18px;font-size:.88rem;font-weight:600;cursor:pointer;font-family:inherit}
    `;
    document.head.appendChild(s);
  }

  function _box(inner) {
    return `<div class="gh-w" style="padding:14px;background:var(--surface1,#181825);border-radius:8px;border:1px solid var(--border,#45475a);display:flex;flex-direction:column;gap:8px">${inner}</div>`;
  }

  function renderWidget(container, opts) {
    opts = opts || {};
    const onReady = opts.onReady || function(){};

    _ensureStyle();

    function showLoggedIn(player) {
      container.innerHTML = _box(`
        <div style="display:flex;align-items:center;gap:10px">
          ${renderAvatar(player, 36)}
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px">${_esc(player.display_name)}</div>
            <div style="font-size:11px;color:var(--fg2,#a6adc8)">@${_esc(player.username)}</div>
          </div>
        </div>
        <button class="gh-btn gh-p" id="gh-w-ready">Ready ▶</button>
      `);
      container.querySelector('#gh-w-ready').onclick = () => onReady(player);
    }

    function showLogin() {
      container.innerHTML = _box(`
        <div style="font-size:14px;font-weight:600;margin-bottom:2px">🎮 Game Hub</div>
        <div style="font-size:12px;color:var(--fg2,#a6adc8);margin-bottom:4px">Log in with your Apps Hub account to continue.</div>
        <button class="gh-btn gh-p" id="gh-w-login">Log in</button>
      `);
      container.querySelector('#gh-w-login').onclick = () => {
        _login(p => { if (p) showLoggedIn(p); });
      };
    }

    _initSession().then(player => {
      if (player) showLoggedIn(player);
      else        showLogin();
    });
  }

  function renderHeader(container) {
    const p = _player || {};
    const hdr = document.createElement('header');
    hdr.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border,#45475a);flex-shrink:0';
    hdr.innerHTML = '<a href="/pub/gamehub/" style="font-weight:700;font-size:15px;color:inherit;text-decoration:none">🎮 Game Hub</a>'
      + '<div style="flex:1"></div>'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + renderAvatar(p, 28)
      + '<div style="display:flex;flex-direction:column;line-height:1.2">'
      + '<span style="font-size:12px;color:var(--fg2,#a6adc8)">Logged in as</span>'
      + '<span style="font-size:13px;font-weight:700;color:var(--accent,#89b4fa)">' + _esc(p.display_name || '') + '</span>'
      + '</div>'
      + '<button id="gh-hdr-logout" style="padding:5px 12px;font-size:.82rem;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;cursor:pointer">Logout</button>'
      + '</div>';
    hdr.querySelector('#gh-hdr-logout').onclick = async () => {
      await window.GameHub.logout();
      location.href = '/pub/gamehub/';
    };
    container.prepend(hdr);
    return hdr;
  }

  function renderAvatar(player, size) {
    size = size || 36;
    if (!player) player = {};
    if (player.avatar_svg) {
      return player.avatar_svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
    }
    const letter = _esc(((player.display_name || '?')[0]).toUpperCase());
    const color  = _esc(player.avatar_color || '#585b70');
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="border-radius:50%;display:block;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="67" font-family="system-ui,sans-serif" font-size="54" font-weight="700" fill="#1e1e2e" text-anchor="middle">${letter}</text></svg>`;
  }

  async function renderInviteSection(container, gameId, roomUrl) {
    if (!container) return;
    if (!_token) { container.innerHTML = ''; return; }
    try {
      const r = await fetch(BASE + '/favourites', { headers: { 'X-GH-Token': _token } });
      if (!r.ok) { container.innerHTML = ''; return; }
      const list = await r.json();

      _ensureStyle();
      if (!list.length) {
        container.innerHTML = `
          <div class="gh-w" style="display:flex;flex-direction:column;gap:6px">
            <div style="font-size:.72rem;color:#a6adc8;text-transform:uppercase;letter-spacing:.5px">Invite players</div>
            <div style="font-size:.8rem;color:#a6adc8">No favourites yet — add some in Game Hub to invite them here.</div>
          </div>`;
        return;
      }
      container.innerHTML = `
        <div class="gh-w" style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:.72rem;color:#a6adc8;text-transform:uppercase;letter-spacing:.5px">Invite players</div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto" id="gh-inv-list">
            ${list.map(p => `
              <div style="display:flex;align-items:center;gap:8px;background:var(--surface2,#313244);border-radius:6px;padding:5px 8px">
                ${renderAvatar(p, 20)}
                <span style="flex:1;font-size:.82rem">${_esc(p.display_name)}</span>
                <button class="gh-btn gh-s gh-inv-btn" style="width:auto;padding:3px 10px;font-size:.75rem" data-pid="${p.id}">Invite</button>
              </div>`).join('')}
          </div>
        </div>`;

      container.querySelectorAll('.gh-inv-btn').forEach(btn => {
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = '⏳';
          try {
            const res = await fetch(BASE + '/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-GH-Token': _token },
              body: JSON.stringify({ to_ids: [btn.dataset.pid], game_id: gameId, room_url: roomUrl }),
            });
            btn.textContent = res.ok ? '✓ Invited' : '✕';
            if (!res.ok) setTimeout(() => { btn.disabled = false; btn.textContent = 'Invite'; }, 2000);
          } catch(_) { btn.disabled = false; btn.textContent = 'Invite'; }
        };
      });
    } catch(_) { container.innerHTML = ''; }
  }

  // ── Multiplayer client framework ────────────────────────────────
  // Generic host-side lobby + socket. Games register only their UI/logic.
  const _mp = (function () {
    const MP = '/api/pub/gamehub/mp';
    let _root = null, _roomId = null, _gameId = null;
    let _ws = null, _connected = false, _closedByUs = false, _retry = 0;
    let _state = 'connecting';                 // connecting|lobby|playing|over
    let _roster = [], _you = null, _isHost = false, _hostId = null;
    let _maxPlayers = 8, _settings = {};
    let _game = null;                          // { id, name, renderSetup, renderGame }
    let _savedClient = null;                   // browser half of the save we resumed from
    let _saveBusy = false, _saveBtn = null, _saveOv = null, _finished = false;
    const _handlers = {};

    function _onEv(type, cb) { (_handlers[type] = _handlers[type] || []).push(cb); }
    function _emit(type, msg) { (_handlers[type] || []).forEach(cb => { try { cb(msg); } catch (e) { console.error(e); } }); }
    function _send(msg) { if (_ws && _connected) { try { _ws.send(JSON.stringify(msg)); } catch (e) {} } }
    function registerGame(def) { _game = def; }

    function _wsUrl() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      return proto + '://' + location.host + MP + '/rooms/' + _roomId + '/ws';
    }

    function start(rootEl, room) {
      _root = rootEl; _roomId = room.roomId; _gameId = room.gameId;
      if (!_token || !_player) { _renderLoginGate(); return; }
      _connect();
    }

    function _renderLoginGate() {
      _ensureStyle();
      _root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-width:360px;margin:40px auto;padding:0 16px;width:100%';
      wrap.innerHTML = '<div style="text-align:center;margin-bottom:14px;font-size:15px;color:var(--fg2,#a6adc8)">Log in to Game Hub to play multiplayer</div>';
      const box = document.createElement('div');
      wrap.appendChild(box);
      _root.appendChild(wrap);
      renderWidget(box, {
        onReady: () => {
          if (_token && _player) { _root.innerHTML = ''; _connect(); }
        },
      });
    }

    function _connect() {
      _closedByUs = false;
      _state = 'connecting';
      _ws = new WebSocket(_wsUrl());
      _ws.onopen = () => { _connected = true; _retry = 0; _send({ type: 'join', gh_token: _token }); };
      _ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } _dispatch(m); };
      _ws.onclose = () => {
        _connected = false;
        if (_closedByUs) return;
        _retry = Math.min(_retry + 1, 6);
        setTimeout(() => { if (!_closedByUs) _connect(); }, 400 * _retry);
      };
      _ws.onerror = () => { try { _ws.close(); } catch (e) {} };
    }

    function _dispatch(msg) {
      switch (msg.type) {
        case 'ping': _send({ type: 'pong' }); return;
        case 'pong': return;
        case 'error': _closedByUs = true; _unmountSave(); _renderError(msg.message); return;
        case 'game_over':
          // The run ended on its own — there is nothing left to save.
          _finished = true;
          _unmountSave();
          _emit(msg.type, msg);
          return;
        case 'joined':
          _you = msg.you; _isHost = msg.is_host; _hostId = msg.host_id;
          _maxPlayers = msg.max_players; _settings = msg.settings || {};
          _roster = msg.players || [];
          if (msg.saved_state) _savedClient = msg.saved_state;
          if (msg.status === 'playing') _enterGame(true);
          // A finished room cannot be played again — reloading its link used to
          // land back in the lobby, where Start only answers 409.
          else if (msg.status === 'finished') { _state = 'finished'; _renderFinished(); }
          else { _state = 'lobby'; _renderLobby(); }
          return;
        case 'roster':
          _roster = msg.players || []; _hostId = msg.host_id;
          if (msg.status === 'playing' && _state !== 'playing') _enterGame(false);
          else if (_state === 'lobby') _updateLobbyRoster();
          _emit('roster', msg);
          return;
        case 'game_started':
          _settings = msg.settings || _settings;
          if (msg.saved_state) _savedClient = msg.saved_state;
          if (_state !== 'playing') _enterGame(false);
          return;
        case '__saved':
          _saveBusy = false;
          _emit(msg.type, msg);
          if (msg.ok) {
            _closedByUs = true;
            location.href = '/pub/gamehub/?saved=1' + (_gameId ? '&game=' + encodeURIComponent(_gameId) : '');
          } else {
            _saveFailed();
          }
          return;
        case 'room_closed':
          // The room ended without the game ending — a saved game, typically.
          // The game gets the message first and usually navigates away itself;
          // this is what is left if it does not.
          _emit(msg.type, msg);
          _closedByUs = true;
          _state = 'finished';
          _unmountSave();
          _renderFinished();
          return;
        default:
          _emit(msg.type, msg);
      }
    }

    function _enterGame(isReconnect) {
      _state = 'playing';
      _finished = false;
      _root.innerHTML = '';
      if (_game && typeof _game.renderGame === 'function') {
        try { _game.renderGame(_root, { reconnect: !!isReconnect }); } catch (e) { console.error(e); }
      }
      _mountSave();
      _emit('enter_game', { reconnect: !!isReconnect });
    }

    // ── Stopping for now ──────────────────────────────────────────────────
    // Every solo run in every game can be put down and picked up again, so the
    // control, the question and the storage all live here rather than in each
    // game. A game only says what belongs in the save (snapshot) and reads it
    // back where its board is ready for it (savedState). Multiplayer has none
    // of this: you cannot freeze a room other people are sitting in.
    function canSave() {
      return _state === 'playing' && !_finished && _maxPlayers <= 1
             && !!_game && _game.saveable !== false;
    }

    function _mountSave() {
      _unmountSave();
      if (!canSave() || (_game && _game.exitButton === false)) return;
      _ensureStyle();
      const b = document.createElement('button');
      b.id = 'gh-save-exit';
      b.type = 'button';
      b.textContent = _t('gh_save_exit', '⏸ Save & exit');
      b.onclick = exitPrompt;
      document.body.appendChild(b);
      _saveBtn = b;
    }

    function _unmountSave() {
      if (_saveBtn) { _saveBtn.remove(); _saveBtn = null; }
      _closePrompt(false);
    }

    function _closePrompt(resumeGame) {
      if (_saveOv) { _saveOv.remove(); _saveOv = null; }
      if (resumeGame && _game && typeof _game.resume === 'function') {
        try { _game.resume(); } catch (e) { console.error(e); }
      }
    }

    function exitPrompt() {
      if (!canSave() || _saveOv) return;
      if (_game && typeof _game.pause === 'function') {
        try { _game.pause(); } catch (e) { console.error(e); }
      }
      _ensureStyle();
      const hub = '/pub/gamehub/' + (_gameId ? '?game=' + encodeURIComponent(_gameId) : '');
      const ov = document.createElement('div');
      ov.id = 'gh-save-ov';
      ov.innerHTML =
        '<div class="gh-save-card">'
        + '<div style="font-size:2rem;line-height:1">⏸</div>'
        + '<div style="font-size:1.05rem;font-weight:700">' + _esc(_t('gh_save_title', 'Stopping for now?')) + '</div>'
        + '<div style="font-size:.82rem;color:var(--fg2,#a6adc8);max-width:290px;line-height:1.5">'
        + _esc(_t('gh_save_body', 'Saving keeps this run for later and closes it here. Nothing is recorded — the game has not ended.')) + '</div>'
        + '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px">'
        + '<button id="gh-save-go" style="background:var(--accent,#89b4fa);color:#1e1e2e;border:none">'
        + _esc(_t('gh_save_and_exit', '💾 Save & exit')) + '</button>'
        + '<button id="gh-save-back" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a)">'
        + _esc(_t('gh_keep_playing', '▶ Keep playing')) + '</button>'
        + '</div>'
        + '<a href="' + hub + '" style="font-size:.75rem;color:var(--fg2,#a6adc8);text-decoration:underline">'
        + _esc(_t('gh_exit_no_save', 'Leave without saving — the run stays open for a while')) + '</a>'
        + '</div>';
      document.body.appendChild(ov);
      _saveOv = ov;
      ov.querySelector('#gh-save-back').onclick = () => _closePrompt(true);
      ov.querySelector('#gh-save-go').onclick = (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = _t('gh_saving', 'Saving…');
        if (!saveAndExit()) _saveFailed();
      };
    }

    // The save itself, without the question — a game with its own exit UI
    // calls this (or exitPrompt) instead of building any of it again.
    function saveAndExit() {
      if (!canSave() || _saveBusy) return false;
      _saveBusy = true;
      let state = null;
      if (_game && typeof _game.snapshot === 'function') {
        try { state = _game.snapshot(); } catch (e) { console.error(e); }
      }
      _send({ type: '__save', state: state || null });
      // The server answers __saved and closes the room. If it never does, the
      // player is not left staring at a dead button.
      setTimeout(() => { if (_saveBusy) { _saveBusy = false; _saveFailed(); } }, 8000);
      return true;
    }

    function _saveFailed() {
      const btn = _saveOv && _saveOv.querySelector('#gh-save-go');
      if (btn) { btn.disabled = false; btn.textContent = _t('gh_save_and_exit', '💾 Save & exit'); }
      alert(_t('gh_save_error', 'Could not save the game. Try again.'));
    }

    // Reached by reloading the link of a room whose game already ended. The
    // run itself is gone, but the player is one click from a new one.
    function _renderFinished() {
      _ensureStyle();
      const hub = '/pub/gamehub/' + (_gameId ? '?game=' + encodeURIComponent(_gameId) : '');
      _root.innerHTML =
        '<div style="max-width:360px;margin:60px auto;text-align:center;padding:0 16px;'
        + 'display:flex;flex-direction:column;gap:14px;align-items:center">'
        + '<div style="font-size:2.6rem;line-height:1">🏁</div>'
        + '<div style="font-size:1.05rem;font-weight:700">' + _esc(_t('gh_room_finished_title', 'This game is over')) + '</div>'
        + '<div style="font-size:.88rem;color:var(--fg2,#a6adc8);line-height:1.5">'
        + _esc(_t('gh_room_finished_body', 'The room has closed. Start a new game from Game Hub.')) + '</div>'
        + '<a href="' + hub + '" style="background:var(--accent,#89b4fa);color:#1e1e2e;border-radius:8px;'
        + 'padding:9px 20px;font-weight:700;font-size:.9rem;text-decoration:none">'
        + _esc(_t('gh_back_to_hub', '‹ Game Hub')) + '</a>'
        + '</div>';
    }

    function _renderError(message) {
      _ensureStyle();
      const map = {
        not_invited: 'You are not invited to this game.',
        game_in_progress: 'The game has already started.',
        room_full: 'The room is full.',
        unauthorized: 'A Game Hub account is required.',
      };
      _root.innerHTML = '<div style="max-width:360px;margin:60px auto;text-align:center;color:#f38ba8;font-size:15px;padding:0 16px">'
        + _esc(map[message] || message || 'Error') + '</div>';
    }

    function _updateLobbyRoster() {
      const pcol = _root.querySelector('#gh-lobby-pcol');
      if (!pcol) { _renderLobby(); return; }
      const connectedCount = _roster.filter(p => p.connected).length;
      pcol.innerHTML = '<div style="font-size:.72rem;color:#a6adc8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Players:' + connectedCount + '</div>';
      const plist = document.createElement('div');
      plist.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      _roster.forEach(p => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;background:var(--surface2,#313244);border-radius:8px;padding:8px 10px;' + (p.connected ? '' : 'opacity:.45');
        row.innerHTML = renderAvatar(p, 26)
          + '<span style="flex:1;font-size:.9rem">' + _esc(p.display_name) + (p.id === _you ? ' (You)' : '') + '</span>'
          + (p.is_host ? '<span style="font-size:.7rem;color:#89b4fa">host</span>' : '');
        plist.appendChild(row);
      });
      pcol.appendChild(plist);
      const btn = _root.querySelector('#gh-start-btn');
      if (btn) {
        const minPlayers = _maxPlayers > 1 ? 2 : 1;
        const canStart = connectedCount >= minPlayers;
        btn.disabled = !canStart;
        btn.style.opacity = canStart ? '1' : '.5';
        btn.textContent = canStart ? 'Start' : 'Need at least 2 players';
      }
      const icol = _root.querySelector('#gh-lobby-icol');
      if (icol) renderInviteSection(icol, _gameId, MP + '/play/' + _roomId);
    }

    function _renderLobby() {
      if (_state !== 'lobby') return;
      _ensureStyle();
      const _hdr = _root.querySelector('header');
      _root.innerHTML = '';
      if (_hdr) _root.appendChild(_hdr);
      const name = (_game && _game.name) || _gameId;
      const connectedCount = _roster.filter(p => p.connected).length;


      const page = document.createElement('div');
      page.className = 'gh-w';
      page.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto;padding:18px;gap:16px;max-width:980px;margin:0 auto;width:100%';

      const cols = document.createElement('div');
      cols.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap';
      page.appendChild(cols);

      const pcol = document.createElement('div');
      pcol.id = 'gh-lobby-pcol';
      pcol.style.cssText = 'flex:1;min-width:240px';
      pcol.innerHTML = '<div style="font-size:.72rem;color:#a6adc8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Players:' + connectedCount + '</div>';
      const plist = document.createElement('div');
      plist.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      _roster.forEach(p => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;background:var(--surface2,#313244);border-radius:8px;padding:8px 10px;' + (p.connected ? '' : 'opacity:.45');
        row.innerHTML = renderAvatar(p, 26)
          + '<span style="flex:1;font-size:.9rem">' + _esc(p.display_name) + (p.id === _you ? ' (You)' : '') + '</span>'
          + (p.is_host ? '<span style="font-size:.7rem;color:#89b4fa">host</span>' : '');
        plist.appendChild(row);
      });
      pcol.appendChild(plist);
      cols.appendChild(pcol);

      if (_isHost && _maxPlayers > 1) {
        const icol = document.createElement('div');
        icol.id = 'gh-lobby-icol';
        icol.style.cssText = 'flex:1;min-width:240px';
        cols.appendChild(icol);
        renderInviteSection(icol, _gameId, MP + '/play/' + _roomId);
      }

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      page.appendChild(footer);

      if (_isHost) {
        let collect = null;
        if (_game && typeof _game.renderSetup === 'function') {
          const sbox = document.createElement('div');
          footer.appendChild(sbox);
          collect = _game.renderSetup(sbox, _settings) || null;
        }
        const startBtn = document.createElement('button');
        startBtn.id = 'gh-start-btn';
        startBtn.className = 'gh-btn gh-p';
        const minPlayers = _maxPlayers > 1 ? 2 : 1;
        const canStart = connectedCount >= minPlayers;
        startBtn.disabled = !canStart;
        startBtn.style.opacity = canStart ? '1' : '.5';
        startBtn.textContent = canStart ? 'Start' : 'Need at least 2 players';
        startBtn.onclick = async () => {
          const settings = (typeof collect === 'function') ? collect() : {};
          if (settings === null) return;
          startBtn.disabled = true; startBtn.textContent = 'Starting…';
          const r = await fetch(MP + '/rooms/' + _roomId + '/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gh_token: _token, settings }),
          });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            startBtn.disabled = false; startBtn.textContent = 'Start';
            const msg = e.error || 'Error';
            alert(msg);
          }
        };
        footer.appendChild(startBtn);
      } else {
        const w = document.createElement('div');
        w.style.cssText = 'text-align:center;color:#a6adc8;font-size:.9rem;padding:10px';
        w.textContent = 'Waiting for host to start…';
        footer.appendChild(w);
      }

      _root.appendChild(page);
    }

    return {
      start, registerGame,
      on: _onEv, send: _send,
      players:  () => _roster.slice(),
      me:       () => _roster.find(p => p.id === _you) || null,
      youId:    () => _you,
      isHost:   () => _isHost,
      hostId:   () => _hostId,
      settings: () => _settings,
      gameId:   () => _gameId,
      roomId:   () => _roomId,
      root:     () => _root,
      renderAvatar,
      // Saving: savedState() is the blob this run was resumed from (null for a
      // fresh one); the rest is the exit flow, shared by every solo game.
      savedState:  () => _savedClient,
      canSave, exitPrompt, saveAndExit,
      leave: () => { _closedByUs = true; if (_ws) { try { _ws.close(); } catch (e) {} } },
    };
  })();

  window.GameHub = {
    isLoggedIn:    () => !!_player,
    currentPlayer: () => _player,
    getToken:      () => _token,
    init:          () => _initSession(),
    login:         _login,
    renderAvatar,
    renderHeader,
    logout: async () => {
      if (_token) {
        await fetch(BASE + '/logout', { method:'POST', headers:{'X-GH-Token':_token} }).catch(()=>{});
        _setToken(null, null);
      }
    },
    renderWidget,
    renderInviteSection,
    mp: _mp,
    recordSession: (data) => fetch(BASE + '/session', {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body:    JSON.stringify(data),
    }),
  };

  if (_token) _initSession();
})();
