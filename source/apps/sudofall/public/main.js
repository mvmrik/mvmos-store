// Sudofall — Tetris meets Sudoku

mvmOS.registerApp({
  id: 'sudofall',
  name: 'Sudofall',
  icon: '🔢',
  category: 'Games',
  launch(opts) {
    const isMP = opts?.multiplayer === true;
    const roomId = opts?.roomId;
    mvmOS.createWindow({
      id: 'sudofall',
      title: '🔢 Sudofall',
      width: 520,
      height: 660,
      minWidth: 380,
      minHeight: 520,
      onMount(body) {
        body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%;background:var(--surface,#1e1e2e)';
        if (isMP && roomId) {
          SudofallGame.joinMultiplayer(body, roomId);
        } else {
          SudofallGame.init(body);
        }
      }
    });
  }
});

const _sf18n = {
  en: {
    score: 'Score', drop: 'DROP', next: 'Next', time: 'Time',
    new_game: '↺ New', game_over: 'Game Over!', final_score: 'Final Score:',
    time_label: 'Time:', play_again: 'Play Again', joker_title: 'Joker — choose a number',
    mp_waiting: 'Waiting for opponent…', mp_share_link: 'Share the link with your friend',
    mp_link_expired: 'Link Expired',
    mp_room_gone: 'This game room no longer exists.<br>Ask your opponent to create a new game.',
    mp_room_ttl: 'Rooms expire after 1 hour of inactivity',
    mp_opponent_disconnected: 'Opponent Disconnected',
    mp_opponent_left: 'Your opponent has left the game.',
    back_to_menu: 'Back to Menu',
    mp_draw: 'Draw!', mp_win: '🏆 You win!', mp_lose: '😔 You lose',
  },
  bg: {
    score: 'Точки', drop: 'ПУСНИ', next: 'Следващо', time: 'Време',
    new_game: '↺ Ново', game_over: 'Край на играта!', final_score: 'Резултат:',
    time_label: 'Време:', play_again: 'Играй пак', joker_title: 'Джокер — избери число',
    mp_waiting: 'Изчакване на опонент…', mp_share_link: 'Сподели линка с приятел',
    mp_link_expired: 'Линкът е изтекъл',
    mp_room_gone: 'Тази стая вече не съществува.<br>Помоли опонента си да създаде нова игра.',
    mp_room_ttl: 'Стаите изтичат след 1 час неактивност',
    mp_opponent_disconnected: 'Опонентът се разкачи',
    mp_opponent_left: 'Опонентът напусна играта.',
    back_to_menu: 'Обратно в менюто',
    mp_draw: 'Равенство!', mp_win: '🏆 Ти печелиш!', mp_lose: '😔 Ти губиш',
  },
};
const SudofallGame = (() => {
  const t = k => { const lang = window.mvmOS?.lang || 'en'; return (_sf18n[lang] || _sf18n.en)[k] || k; };

  let grid = [];
  let current = 0;
  let next = 0;
  let score = 0;
  let bombs = 0;
  let gameOver = false;
  let animating = false;
  let elapsed = 0;
  let _timerInterval = null;
  let _bombEl = null;

  // Multiplayer state
  let _mp = null; // { ws, roomId, playerIndex, isHost, myTurn, opponentScore, opponentGrid, seq, idx, phase, opponentAvatarSvg }
  let _mpMode = false;
  let _mpRoomLink = null;
  let _mpLeaving = false; // true when we intentionally close the WebSocket

  // Game Hub state
  let _ghPlayer = null;       // logged-in player object, or null

  function newNum() { return Math.floor(Math.random() * 10); } // 0-9, 0 = joker

  function _showJokerPicker() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:50;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;border-radius:8px';
      const bombDisabled = bombs <= 0;
      overlay.innerHTML = `
        <div style="background:var(--surface,#1e1e2e);border:1px solid var(--border,#45475a);border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:.8rem;color:var(--text-dim,#a6adc8);margin-bottom:10px;letter-spacing:.05em;text-transform:uppercase">${t('joker_title')}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
            ${[1,2,3,4,5,6,7,8,9].map(n => `
              <div data-n="${n}" style="
                width:44px;height:44px;border-radius:8px;
                display:flex;align-items:center;justify-content:center;
                font-size:1.3rem;font-weight:700;color:#1e1e2e;
                background:${COLORS[n]};cursor:pointer;
                transition:transform .1s,opacity .1s;
              ">${n}</div>
            `).join('')}
          </div>
          <div style="margin-top:10px;border-top:1px solid var(--border,#45475a);padding-top:10px">
            <div data-bomb="1" style="
              width:100%;padding:8px;border-radius:8px;
              display:flex;align-items:center;justify-content:center;gap:8px;
              font-size:.9rem;font-weight:700;color:${bombDisabled ? '#585b70' : '#1e1e2e'};
              background:${bombDisabled ? 'var(--surface2,#313244)' : '#f38ba8'};
              cursor:${bombDisabled ? 'not-allowed' : 'pointer'};
              transition:transform .1s;border:1px solid ${bombDisabled ? 'var(--border,#45475a)' : 'transparent'};
            ">💣 Bomb ${bombDisabled ? '(0)' : `(${bombs})`}</div>
          </div>
        </div>`;
      _body.appendChild(overlay);
      overlay.querySelectorAll('[data-n]').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.transform = 'scale(1.15)');
        el.addEventListener('mouseleave', () => el.style.transform = '');
        el.addEventListener('click', () => { overlay.remove(); resolve(+el.dataset.n); });
      });
      const bombBtn = overlay.querySelector('[data-bomb]');
      if (!bombDisabled) {
        bombBtn.addEventListener('mouseenter', () => bombBtn.style.transform = 'scale(1.05)');
        bombBtn.addEventListener('mouseleave', () => bombBtn.style.transform = '');
        bombBtn.addEventListener('click', () => { overlay.remove(); resolve('bomb'); });
      }
    });
  }

  async function _activateBomb() {
    // Highlight all non-empty cells and wait for click
    const cells = _body.querySelectorAll('.sf-cell');
    const instruction = document.createElement('div');
    instruction.style.cssText = 'position:absolute;top:8px;left:0;right:0;z-index:40;text-align:center;font-size:.8rem;color:#f38ba8;font-weight:600;pointer-events:none';
    instruction.textContent = '💣 Choose a cell to destroy';
    _body.appendChild(instruction);

    cells.forEach(el => {
      const r = +el.dataset.r, c = +el.dataset.c;
      if (grid[r][c] !== 0) {
        el.style.outline = '2px solid #f38ba8';
        el.style.cursor = 'crosshair';
      }
    });

    return new Promise(resolve => {
      function onCellClick(e) {
        const el = e.target.closest('.sf-cell');
        if (!el) return;
        const r = +el.dataset.r, c = +el.dataset.c;
        if (grid[r][c] === 0) return;
        cells.forEach(el => { el.style.outline = ''; el.style.cursor = ''; });
        instruction.remove();
        _body.removeEventListener('click', onCellClick);
        resolve({ r, c });
      }
      _body.addEventListener('click', onCellClick);
    });
  }

  function _formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function _startTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      if (gameOver) return;
      if (_mpMode && !_mp?.myTurn) return; // don't tick when waiting for opponent
      elapsed++;
      if (_timerEl) _timerEl.textContent = _formatTime(elapsed);
      // Every 10 seconds — deduct 1 point
      if (elapsed % 10 === 0) {
        score--;
        if (_scoreEl) _scoreEl.textContent = score;
      }
    }, 1000);
  }

  function _resolveJoker() {
    if (current !== 0) return;
    _showJokerPicker().then(async n => {
      if (n === 'bomb') {
        bombs--;
        if (_bombEl) _bombEl.textContent = `💣 ${bombs}`;
        const { r, c } = await _activateBomb();
        // Destroy cell, apply gravity, check clears
        animating = true;
        _cells[r][c].style.transition = 'opacity .15s,transform .15s';
        _cells[r][c].style.opacity = '0';
        _cells[r][c].style.transform = 'scale(0.5)';
        grid[r][c] = 0;
        await sleep(160);
        _cells[r][c].style.transition = '';
        _cells[r][c].style.opacity = '';
        _cells[r][c].style.transform = '';
        applyGravity();
        render();
        let iterations = 0;
        while (iterations++ < 10) {
          const { toRemove, cleared } = findClears();
          if (toRemove.size === 0) break;
          score += cleared * 9;
          bombs += cleared;
          if (_bombEl) _bombEl.textContent = `💣 ${bombs}`;
          toRemove.forEach(key => {
            const [rr, cc] = key.split(',').map(Number);
            _cells[rr][cc].style.transition = 'background .1s,transform .1s';
            _cells[rr][cc].style.background = '#f9e2af';
            _cells[rr][cc].style.transform = 'scale(1.1)';
          });
          await sleep(180);
          toRemove.forEach(key => {
            const [rr, cc] = key.split(',').map(Number);
            _cells[rr][cc].style.transition = 'opacity .12s,transform .12s';
            _cells[rr][cc].style.opacity = '0';
            _cells[rr][cc].style.transform = 'scale(0.7)';
            grid[rr][cc] = 0;
          });
          await sleep(130);
          applyGravity();
          render();
          toRemove.forEach(key => {
            const [rr, cc] = key.split(',').map(Number);
            _cells[rr][cc].style.transition = '';
            _cells[rr][cc].style.opacity = '';
            _cells[rr][cc].style.transform = '';
          });
          await sleep(80);
        }
        animating = false;
        // Bomb counts as a move — advance idx same as placeNumber
        if (_mpMode && _mp) {
          _mp.idx++;
          const i = _mp.idx % _mp.seq.length;
          current = _mp.seq[i];
          next = _mp.seq[(i + 1) % _mp.seq.length];
          _mp.ws.send(JSON.stringify({ type: 'move' }));
          _mp.ws.send(JSON.stringify({ type: 'grid_update', grid: grid.map(r => [...r]) }));
          _mp.ws.send(JSON.stringify({ type: 'score_update', score }));
          _mp.myTurn = false;
          _updateMpStatus();
          setTimeout(() => _showOpponentGrid(), 1000);
        }
        render();
      } else {
        current = n;
        render();
      }
    });
  }

  // ── Game Hub helpers ───────────────────────────────────────────────────────

  function _loadGameHub(cb) {
    if (window.GameHub) { window.GameHub.init().then(cb); return; }
    const s = document.createElement('script');
    s.src = `/apps/gamehub/widget.js?_=${Date.now()}`;
    s.onload  = () => window.GameHub?.init().then(cb) || cb();
    s.onerror = cb;
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
      // Already logged in — player made their choice, unlock immediately
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;background:var(--surface2,#313244);border-radius:8px;padding:8px 12px;width:100%;box-sizing:border-box">
          ${_avatar(p, 22)}
          <div style="flex:1;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.display_name}</div>
          <button id="sf-gh-out" style="border:none;background:none;color:var(--text-dim,#a6adc8);font-size:11px;cursor:pointer;padding:2px 6px;flex-shrink:0">Logout</button>
        </div>`;
      container.querySelector('#sf-gh-out').onclick = async () => {
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

  function _recordGhSession() {
    if (!_ghPlayer || !window.GameHub) return;
    window.GameHub.recordSession({
      game_id: 'sudofall',
      mode: 'singleplayer',
      players: [{ player_id: _ghPlayer.id, score, is_winner: true }],
      duration_seconds: elapsed,
      metadata: {},
    }).catch(() => {});
  }

  function initState() {
    grid = Array.from({length: 9}, () => Array(9).fill(0));
    if (!_mpMode) {
      current = newNum();
      while (current === 0) current = newNum();
      next = newNum();
    }
    score = 0;
    bombs = 0;
    gameOver = false;
    animating = false;
    elapsed = 0;
    if (_timerEl) _timerEl.textContent = '0:00';
    _startTimer();
  }

  function dropRow(col) {
    for (let r = 8; r >= 0; r--) {
      if (grid[r][col] === 0) return r;
    }
    return -1;
  }

  // Check if placing `num` at (row, col) is valid sudoku-wise
  function isValid(row, col, num) {
    // Check row
    for (let c = 0; c < 9; c++) if (grid[row][c] === num) return false;
    // Check column
    for (let r = 0; r < 9; r++) if (grid[r][col] === num) return false;
    // Check 3x3 box
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br+3; r++)
      for (let c = bc; c < bc+3; c++)
        if (grid[r][c] === num) return false;
    return true;
  }

  // Find the lowest empty row in column (tetris-style drop)
  function dropRow(col) {
    for (let r = 8; r >= 0; r--) {
      if (grid[r][col] === 0) return r;
    }
    return -1; // column full
  }

  // Would placing `num` at (row, col) create a conflict?
  function wouldConflict(row, col, num) {
    for (let c = 0; c < 9; c++) if (c !== col && grid[row][c] === num) return true;
    for (let r = 0; r < 9; r++) if (r !== row && grid[r][col] === num) return true;
    const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
    for (let r = br; r < br+3; r++)
      for (let c = bc; c < bc+3; c++)
        if ((r !== row || c !== col) && grid[r][c] === num) return true;
    return false;
  }

  // Find all existing conflicts in the grid (cells that violate sudoku rules)
  function findGridConflicts() {
    const conflicted = new Set();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = grid[r][c];
        if (!val) continue;
        for (let c2 = 0; c2 < 9; c2++)
          if (c2 !== c && grid[r][c2] === val) { conflicted.add(`${r},${c}`); break; }
        for (let r2 = 0; r2 < 9; r2++)
          if (r2 !== r && grid[r2][c] === val) { conflicted.add(`${r},${c}`); break; }
        const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
        outer: for (let r2 = br; r2 < br+3; r2++)
          for (let c2 = bc; c2 < bc+3; c2++)
            if ((r2 !== r || c2 !== c) && grid[r2][c2] === val) { conflicted.add(`${r},${c}`); break outer; }
      }
    }
    return conflicted;
  }

  // Can drop if column is not full. Returns 'warn' if would create conflict, 'valid' otherwise.
  // Returns false also if current is joker (0) — must pick first.
  function canDropInCol(col) {
    if (current === 0) return false;
    const row = dropRow(col);
    if (row < 0) return false; // column full
    return wouldConflict(row, col, current) ? 'warn' : 'valid';
  }

  function findClears() {
    const toRemove = new Set();
    let cleared = 0;

    for (let r = 0; r < 9; r++) {
      const vals = grid[r].filter(v => v !== 0);
      if (vals.length === 9 && new Set(vals).size === 9) {
        for (let c = 0; c < 9; c++) toRemove.add(`${r},${c}`);
        cleared++;
      }
    }
    for (let c = 0; c < 9; c++) {
      const vals = grid.map(r => r[c]).filter(v => v !== 0);
      if (vals.length === 9 && new Set(vals).size === 9) {
        for (let r = 0; r < 9; r++) toRemove.add(`${r},${c}`);
        cleared++;
      }
    }
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const vals = [];
        for (let r = br*3; r < br*3+3; r++)
          for (let c = bc*3; c < bc*3+3; c++)
            if (grid[r][c] !== 0) vals.push(grid[r][c]);
        if (vals.length === 9 && new Set(vals).size === 9) {
          for (let r = br*3; r < br*3+3; r++)
            for (let c = bc*3; c < bc*3+3; c++)
              toRemove.add(`${r},${c}`);
          cleared++;
        }
      }
    }
    return { toRemove, cleared };
  }

  // Apply gravity — numbers fall down in each column
  function applyGravity() {
    for (let c = 0; c < 9; c++) {
      const vals = [];
      for (let r = 0; r < 9; r++) if (grid[r][c] !== 0) vals.push(grid[r][c]);
      for (let r = 0; r < 9; r++) grid[r][c] = 0;
      for (let i = 0; i < vals.length; i++) grid[9 - vals.length + i][c] = vals[i];
    }
  }

  function gridFull() {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (grid[r][c] === 0) return false;
    return true;
  }

  const COLORS = {
    1: '#f38ba8', 2: '#fab387', 3: '#f9e2af',
    4: '#a6e3a1', 5: '#94e2d5', 6: '#89dceb',
    7: '#89b4fa', 8: '#b4befe', 9: '#cba6f7',
  };

  let _body = null;
  let _cells = [];
  let _dropCells = [];
  let _scoreEl = null;
  let _currentEl = null;
  let _nextEl = null;
  let _timerEl = null;
  let _msgEl = null;
  let _goScore = null;
  let _goTime = null;
  let _dragCol = -1;

  function render() {
    if (!_body) return;

    _scoreEl.textContent = score;

    _currentEl.textContent = current === 0 ? '?' : current;
    _currentEl.style.background = current === 0 ? 'linear-gradient(135deg,#f38ba8,#fab387,#f9e2af,#a6e3a1,#89b4fa,#cba6f7)' : COLORS[current];
    _currentEl.style.cursor = current === 0 ? 'pointer' : 'grab';
    _currentEl.style.animation = current === 0 ? 'sf-pulse .8s ease-in-out infinite alternate' : '';

    _nextEl.textContent = next === 0 ? '0' : next;
    _nextEl.style.background = next === 0 ? 'linear-gradient(135deg,#f38ba8,#fab387,#f9e2af,#a6e3a1,#89b4fa,#cba6f7)' : COLORS[next];

    _dropCells.forEach((el, c) => {
      const mode = canDropInCol(c);
      if (!mode) {
        // Column full
        el.style.background = 'rgba(255,255,255,.04)';
        el.style.borderColor = 'var(--border,#45475a)';
        el.style.color = 'var(--text-dim,#6c7086)';
        el.style.cursor = 'not-allowed';
        el.style.opacity = '.25';
        el.style.textShadow = '';
        el.textContent = '▼';
      } else if (mode === 'warn') {
        // Will create conflict — orange warning
        el.style.background = c === _dragCol ? 'rgba(250,179,135,.3)' : 'rgba(250,179,135,.08)';
        el.style.borderColor = '#fab387';
        el.style.color = '#fab387';
        el.style.cursor = 'pointer';
        el.style.opacity = '1';
        el.style.textShadow = '';
        el.textContent = '⚠';
      } else {
        // Normal drop
        el.style.background = c === _dragCol ? COLORS[current] + '55' : 'rgba(255,255,255,.04)';
        el.style.borderColor = c === _dragCol ? COLORS[current] : 'var(--border,#45475a)';
        el.style.color = 'var(--text-dim,#6c7086)';
        el.style.cursor = 'pointer';
        el.style.opacity = '1';
        el.style.textShadow = '';
        el.textContent = '▼';
      }
    });

    const conflicts = findGridConflicts();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = grid[r][c];
        const el = _cells[r][c];
        el.textContent = val || '';
        if (val) {
          const isConflict = conflicts.has(`${r},${c}`);
          if (isConflict) {
            const col = COLORS[val];
            el.style.background = `repeating-linear-gradient(
              45deg,
              ${col},
              ${col} 4px,
              #1e1e2e 4px,
              #1e1e2e 8px
            )`;
            el.style.color = '#fff';
            el.style.textShadow = '0 0 3px rgba(0,0,0,.8)';
            el.style.outline = `2px solid ${col}`;
            el.style.outlineOffset = '-2px';
          } else {
            el.style.background = COLORS[val];
            el.style.color = '#1e1e2e';
            el.style.textShadow = '';
            el.style.outline = '';
          }
        } else {
          el.style.background = 'rgba(255,255,255,.03)';
          el.style.color = 'transparent';
          el.style.textShadow = '';
          el.style.outline = '';
        }
      }
    }

    if (gameOver) {
      _msgEl.style.display = 'flex';
      _goScore.textContent = `${t('final_score')} ${score}`;
      if (_goTime) _goTime.textContent = `${t('time_label')} ${_formatTime(elapsed)}`;
    } else {
      _msgEl.style.display = 'none';
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function placeNumber(col) {
    if (animating || gameOver) return;
    if (_mpMode && _mp && !_mp.myTurn) return; // not your turn
    const mode = canDropInCol(col);
    if (!mode) return;

    animating = true;

    const row = dropRow(col);
    if (row < 0) { animating = false; return; }

    // Fall animation
    for (let r = 0; r <= row; r++) {
      const el = _cells[r][col];
      el.textContent = current;
      el.style.background = COLORS[current];
      el.style.color = '#1e1e2e';
      el.style.transform = 'scale(1.05)';
      await sleep(50);
      if (r < row) {
        el.textContent = grid[r][col] || '';
        el.style.background = grid[r][col] ? COLORS[grid[r][col]] : 'rgba(255,255,255,.03)';
        el.style.color = grid[r][col] ? '#1e1e2e' : 'transparent';
        el.style.transform = '';
      }
    }

    grid[row][col] = current;

    // +1 point if no conflict, 0 if conflict
    if (!wouldConflict(row, col, current)) score++;

    const landed = _cells[row][col];
    landed.style.transition = 'transform .1s';
    landed.style.transform = 'scale(1.18)';
    await sleep(110);
    landed.style.transform = '';
    landed.style.transition = '';

    // Check clears + gravity loop
    let iterations = 0;
    while (iterations++ < 10) {
      const { toRemove, cleared } = findClears();
      if (toRemove.size === 0) break;
      score += cleared * 9;
      bombs += cleared;
      if (_bombEl) _bombEl.textContent = `💣 ${bombs}`;

      // Flash cleared cells
      toRemove.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        _cells[r][c].style.transition = 'background .1s, transform .1s';
        _cells[r][c].style.background = '#f9e2af';
        _cells[r][c].style.transform = 'scale(1.1)';
      });
      await sleep(180);

      // Fade out
      toRemove.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        _cells[r][c].style.transition = 'opacity .12s, transform .12s';
        _cells[r][c].style.opacity = '0';
        _cells[r][c].style.transform = 'scale(0.7)';
        grid[r][c] = 0;
      });
      await sleep(130);

      applyGravity();
      render();

      toRemove.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        _cells[r][c].style.transition = '';
        _cells[r][c].style.opacity = '';
        _cells[r][c].style.transform = '';
      });

      await sleep(80);
    }

    if (_mpMode && _mp) {
      _mp.idx++;
      // Wrap around if sequence exhausted (9x9 grid = max 81 moves per player)
      const i = _mp.idx % _mp.seq.length;
      current = _mp.seq[i];
      next = _mp.seq[(i + 1) % _mp.seq.length];
    } else {
      current = next;
      next = newNum();
    }
    animating = false;

    if (gridFull()) {
      gameOver = true;
      if (_mpMode) {
        _mp.ws.send(JSON.stringify({ type: 'game_over', score }));
        if (_mp.isHost) _recordMpSession(score, _mp.opponentScore);
      } else {
        _recordGhSession();
      }
    }
    if (_mpMode && _mp) {
      // Just tell opponent I moved — they don't touch their numbers
      _mp.ws.send(JSON.stringify({ type: 'move' }));
      _mp.ws.send(JSON.stringify({ type: 'grid_update', grid: grid.map(r => [...r]) }));
      _mp.ws.send(JSON.stringify({ type: 'score_update', score }));
      _mp.myTurn = false;
      _updateMpStatus();
      setTimeout(() => _showOpponentGrid(), 1000);
    }
    render();

    // If new current is joker, show picker immediately
    // If joker, wait for user to click the tile
  }

  // ── Multiplayer ────────────────────────────────────────────────────────────
  // Shared sequence model: host generates seq[], sends whole array at start.
  // Both players read seq[idx] for current. Each advances OWN idx only when THEY drop.
  // Opponent's move only flips whose turn it is — never touches my numbers.

  function _mpLeave() {
    _mpLeaving = true;
    if (_mp?.ws) { try { _mp.ws.close(); } catch(e) {} }
    _mp = null;
    _mpMode = false;
    gameOver = false;
    bombs = 0;
    setTimeout(() => { _mpLeaving = false; }, 500);
  }

  function _myName()  { return _ghPlayer?.display_name || (_mp?.isHost ? 'Host' : 'Player'); }
  function _oppName() { return _mp?.opponentName || 'Opponent'; }
  function _myAvatarHtml(size)  { return _avatar(_ghPlayer, size); }
  function _oppAvatarHtml(size) {
    const p = _mp?.opponentAvatarSvg
      ? { avatar_svg: _mp.opponentAvatarSvg, display_name: _oppName() }
      : { display_name: _oppName() };
    return _avatar(p, size);
  }

  function _recordMpSession(myScore, oppScore) {
    if (!_mp || !_mp.isHost || _mp.sessionRecorded || !window.GameHub) return;
    _mp.sessionRecorded = true;
    const myP = _ghPlayer
      ? { player_id: _ghPlayer.id,          score: myScore,  is_winner: myScore >= oppScore }
      : { guest_name: 'Host',               score: myScore,  is_winner: myScore >= oppScore };
    const opP = _mp.opponentGhPlayerId
      ? { player_id: _mp.opponentGhPlayerId, score: oppScore, is_winner: oppScore > myScore }
      : { guest_name: _mp.opponentName || 'Opponent',        score: oppScore, is_winner: oppScore > myScore };
    window.GameHub.recordSession({
      game_id: 'sudofall', mode: 'multiplayer',
      players: [myP, opP],
      duration_seconds: elapsed,
      metadata: {},
    }).catch(() => {});
  }

  function _mpConnect(roomId) {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ghToken = window.GameHub?.getToken() || '';
    const ws = new WebSocket(`${wsProto}//${location.host}/api/pub/gamehub/mp/rooms/${roomId}/ws?token=${encodeURIComponent(ghToken)}`);
    _mp = { ws, roomId, playerIndex: -1, isHost: false, myTurn: false,
            opponentScore: 0, opponentGrid: null, seq: null, idx: 0, phase: null,
            opponentGhPlayerId: null, opponentName: 'Opponent', opponentAvatarSvg: null, sessionRecorded: false };

    // Single message handler. Always captures 'joined', then delegates to the
    // current phase handler (lobby → game). Only one handler ever exists.
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
if (msg.type === 'joined') _mp.playerIndex = msg.player;
      if (_mp.phase) _mp.phase(msg);
    };
    ws.onclose = (e) => {
      if (_mpLeaving) return; // we initiated the close
      if (e.code === 4004) {
        _showMpExpired();
      } else if (!gameOver) {
        _showMpDisconnect();
      }
    };
  }

  // In-game message handler (set as _mp.phase after the game starts)
  function _mpHandleMessage(msg) {
    if (msg.type === 'move') {
      // Opponent moved — it's now MY turn. Do NOT touch my numbers.
      _mp.myTurn = true;
      _mp.showingOpponentMove = true;
      _showOpponentGrid();
      _updateMpStatus();
      setTimeout(() => {
        _mp.showingOpponentMove = false;
        _showMyGrid();
        _updateMpStatus();
        render();
      }, 1500);
    } else if (msg.type === 'score_update') {
      _mp.opponentScore = msg.score;
      _updateMpStatus();
    } else if (msg.type === 'grid_update') {
      _mp.opponentGrid = msg.grid;
      if (!_mp.myTurn || _mp.showingOpponentMove) _renderOpponentGrid();
    } else if (msg.type === 'player_left') {
      _showMpDisconnect();
    } else if (msg.type === 'game_over') {
      _recordMpSession(score, msg.score);
      _showMpResult(score, msg.score);
    }
  }

  let _opponentGridEl = null;
  let _myGridEl = null;
  let _mpStatusEl = null;

  function _startMpGame() {
    // Replace body with multiplayer layout
    _body.innerHTML = `
      <style>
        @keyframes sf-pulse { from { transform: scale(1); } to { transform: scale(1.12); } }
        @keyframes sf-turn-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,.4); } 50% { box-shadow: 0 0 0 8px rgba(99,102,241,0); } }
      </style>
      <div style="display:flex;flex-direction:column;height:100%;padding:6px 8px;box-sizing:border-box;gap:6px;position:relative;background:var(--surface,#1e1e2e)">
        <div id="sf-mp-status" style="text-align:center;font-size:.8rem;padding:4px 8px;border-radius:6px;background:var(--surface2,#313244);flex-shrink:0"></div>
        <div style="flex:1;min-height:0;display:flex;gap:8px">
          <div id="sf-my-side" style="flex:1;min-width:0;display:flex;flex-direction:column">
            <div id="sf-my-game" style="flex:1;min-height:0"></div>
          </div>
          <div id="sf-opp-side" style="flex:1;min-width:0;display:flex;flex-direction:column">
            <div id="sf-opp-game" style="flex:1;min-height:0;opacity:.7"></div>
          </div>
        </div>
        <div id="sf-gameover" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.85);z-index:10;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:8px">
          <div id="sf-mp-result" style="font-size:1.4rem;font-weight:700;color:#f9e2af"></div>
          <div id="sf-go-score" style="font-size:1rem;color:var(--text,#cdd6f4)"></div>
          <div id="sf-go-time" style="font-size:.85rem;color:var(--text-dim,#a6adc8)"></div>
          <button id="sf-mp-play-again" style="padding:10px 28px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">${t('play_again')}</button>
        </div>
      </div>`;

    _mpStatusEl = _body.querySelector('#sf-mp-status');
    _msgEl = _body.querySelector('#sf-gameover');
    _goScore = _body.querySelector('#sf-go-score');
    _goTime = _body.querySelector('#sf-go-time');
    _myGridEl = _body.querySelector('#sf-my-game');
    _opponentGridEl = _body.querySelector('#sf-opp-game');

    _body.querySelector('#sf-mp-play-again').addEventListener('click', () => {
      _mpLeave();
      _showMpLobby(_body);
    });

    // Build opponent grid UI
    _buildOpponentGridUI(_opponentGridEl);

    _buildGameUI(_myGridEl);
    // current and next already set before _startMpGame was called
    _updateMpStatus();
    render();

    // Switch the message phase to in-game handling
    _mp.phase = _mpHandleMessage;

    // If not my turn first, block and show opponent grid
    if (!_mp.myTurn) {
      _showOpponentGrid();
    } else {
      _showMyGrid();
    }
  }

  function _updateMpStatus() {
    if (!_mpStatusEl) return;
    const myBold  = _mp.myTurn  ? 'font-weight:700;color:var(--text,#cdd6f4)' : 'font-weight:400;color:var(--text-dim,#a6adc8)';
    const oppBold = !_mp.myTurn ? 'font-weight:700;color:var(--text,#cdd6f4)' : 'font-weight:400;color:var(--text-dim,#a6adc8)';
    _mpStatusEl.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;${myBold}">${_myAvatarHtml(18)}<span>${_myName()}: ${score}</span></span>
      <span style="color:#45475a;margin:0 6px">|</span>
      <span style="display:inline-flex;align-items:center;gap:5px;${oppBold}">${_oppAvatarHtml(18)}<span>${_oppName()}: ${_mp.opponentScore}</span></span>`;
  }

  function _isMobile() {
    return window.innerWidth <= 600;
  }

  function _showMyGrid() {
    if (!_myGridEl || !_opponentGridEl) return;
    const mySide = _myGridEl.closest('#sf-my-side');
    const oppSide = _opponentGridEl.closest('#sf-opp-side');
    _myGridEl.style.pointerEvents = '';
    mySide.style.display = 'flex';
    oppSide.style.display = 'none';
  }

  function _showOpponentGrid() {
    if (!_myGridEl || !_opponentGridEl) return;
    const mySide = _myGridEl.closest('#sf-my-side');
    const oppSide = _opponentGridEl.closest('#sf-opp-side');
    _myGridEl.style.pointerEvents = 'none';
    mySide.style.display = 'none';
    oppSide.style.display = 'flex';
    _renderOpponentGrid();
  }

  function _renderOpponentGrid() {
    if (!_opponentGridEl || !_mp?.opponentGrid) return;
    const g = _mp.opponentGrid;
    const conflicts = _findConflictsInGrid(g);
    const cells = _opponentGridEl.querySelectorAll('.sf-opp-cell');
    cells.forEach((el, i) => {
      const r = Math.floor(i / 9), c = i % 9;
      const val = g[r]?.[c] || 0;
      el.textContent = val || '';
      if (val) {
        const isConflict = conflicts.has(`${r},${c}`);
        if (isConflict) {
          el.style.background = `repeating-linear-gradient(45deg,${COLORS[val]},${COLORS[val]} 4px,#1e1e2e 4px,#1e1e2e 8px)`;
          el.style.color = '#fff';
        } else {
          el.style.background = COLORS[val];
          el.style.color = '#1e1e2e';
        }
      } else {
        el.style.background = 'rgba(255,255,255,.03)';
        el.style.color = 'transparent';
      }
    });
  }

  function _findConflictsInGrid(g) {
    const conflicted = new Set();
    if (!g) return conflicted;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = g[r]?.[c];
        if (!val) continue;
        for (let c2 = 0; c2 < 9; c2++) if (c2 !== c && g[r][c2] === val) { conflicted.add(`${r},${c}`); break; }
        for (let r2 = 0; r2 < 9; r2++) if (r2 !== r && g[r2]?.[c] === val) { conflicted.add(`${r},${c}`); break; }
        const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
        outer: for (let r2 = br; r2 < br+3; r2++)
          for (let c2 = bc; c2 < bc+3; c2++)
            if ((r2 !== r || c2 !== c) && g[r2]?.[c2] === val) { conflicted.add(`${r},${c}`); break outer; }
      }
    }
    return conflicted;
  }

  function _buildOpponentGridUI(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:1px;height:100%;width:100%';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const el = document.createElement('div');
        const mt = r % 3 === 0 && r !== 0 ? '2px' : '0';
        const ml = c % 3 === 0 && c !== 0 ? '2px' : '0';
        el.className = 'sf-opp-cell';
        el.style.cssText = `display:flex;align-items:center;justify-content:center;border-radius:2px;font-size:clamp(.6rem,2vw,.85rem);font-weight:700;background:rgba(255,255,255,.03);margin-top:${mt};margin-left:${ml}`;
        wrap.appendChild(el);
      }
    }
    container.appendChild(wrap);
  }

  function _showMpWaiting() {
    if (!_body) return;
    const existing = _body.querySelector('#sf-mp-waiting');
    if (existing) return;
    const el = document.createElement('div');
    el.id = 'sf-mp-waiting';
    el.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.8);z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:8px';
    el.innerHTML = `<div style="font-size:1.2rem;font-weight:700;color:#cdd6f4">${t('mp_waiting')}</div>
      <div style="font-size:.85rem;color:#a6adc8">${t('mp_share_link')}</div>`;
    _body.appendChild(el);
  }

  function _showMpExpired() {
    if (!_body) return;
    _body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:20px;padding:32px;background:var(--surface,#1e1e2e)">
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(243,139,168,.15);border:2px solid rgba(243,139,168,.3);display:flex;align-items:center;justify-content:center;font-size:2rem">⏰</div>
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:#f38ba8;margin-bottom:8px">${t('mp_link_expired')}</div>
          <div style="font-size:.82rem;color:var(--text-dim,#a6adc8);line-height:1.6">${t('mp_room_gone')}</div>
        </div>
        <div style="width:100%;max-width:280px;height:1px;background:var(--border,#45475a)"></div>
        <div style="font-size:.75rem;color:#585b70;text-align:center">${t('mp_room_ttl')}</div>
      </div>`;
  }

  function _showMpDisconnect() {
    if (!_body) return;
    _body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:20px;padding:32px;background:var(--surface,#1e1e2e)">
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(243,139,168,.15);border:2px solid rgba(243,139,168,.3);display:flex;align-items:center;justify-content:center;font-size:2rem">🔌</div>
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:#f38ba8;margin-bottom:8px">${t('mp_opponent_disconnected')}</div>
          <div style="font-size:.82rem;color:var(--text-dim,#a6adc8);line-height:1.6">${t('mp_opponent_left')}</div>
        </div>
        <div style="width:100%;max-width:280px;height:1px;background:var(--border,#45475a)"></div>
        <button id="sf-disconnect-back" style="padding:10px 28px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer">${t('back_to_menu')}</button>
      </div>`;
    _body.querySelector('#sf-disconnect-back').addEventListener('click', () => {
      _mpLeave();
      _showMpLobby(_body);
    });
  }

  function _showMpResult(myScore, oppScore) {
    if (!_msgEl) return;
    const win = myScore > oppScore;
    const draw = myScore === oppScore;
    const resultEl = _body.querySelector('#sf-mp-result');
    if (resultEl) resultEl.textContent = draw ? t('mp_draw') : win ? t('mp_win') : t('mp_lose');
    if (_goScore) _goScore.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap"><span style="display:flex;align-items:center;gap:6px">${_myAvatarHtml(22)}<span>${_myName()}: ${myScore}</span></span><span style="color:#585b70">|</span><span style="display:flex;align-items:center;gap:6px">${_oppAvatarHtml(22)}<span>${_oppName()}: ${oppScore}</span></span></div>`;
    if (_goTime) _goTime.textContent = `${t('time_label')} ${_formatTime(elapsed)}`;
    _msgEl.style.display = 'flex';
    clearInterval(_timerInterval);
  }

  function _showMpLobby(body) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--surface,#1e1e2e)">
        <div style="font-size:1.8rem">🔢</div>
        <div style="font-size:1.3rem;font-weight:700;color:var(--text,#cdd6f4)">Sudofall</div>
        <button id="sf-btn-single" style="width:200px;padding:12px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">🎮 Single Player</button>
        <button id="sf-btn-multi" style="width:200px;padding:12px;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:8px;color:var(--text,#cdd6f4);font-size:1rem;font-weight:600;cursor:pointer">👥 Multiplayer</button>
        <div id="sf-gh-section" style="width:200px"></div>
      </div>`;

    const singleBtn = body.querySelector('#sf-btn-single');
    const multiBtn  = body.querySelector('#sf-btn-multi');
    [singleBtn, multiBtn].forEach(b => { b.disabled = true; b.style.opacity = '.4'; b.style.cursor = 'not-allowed'; });

    function _ghReady() {
      [singleBtn, multiBtn].forEach(b => { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; });
    }

    _loadGameHub(() => {
      if (!window.GameHub) { _ghReady(); return; }
      _renderGhSection(body.querySelector('#sf-gh-section'), () => _showMpLobby(body), _ghReady);
    });

    body.querySelector('#sf-btn-single').addEventListener('click', () => {
      _mpMode = false;
      _buildGameUI(body);
      initState();
      render();
    });

    body.querySelector('#sf-btn-multi').addEventListener('click', () => {
      window.open('/pub/gamehub/', '_blank');
    });
    if (false) { // dead code kept for reference only — no longer used
      let roomData;
      const { roomId, link } = roomData || {};
      _mpMode = true;
      _mpRoomLink = link;

      // Show link to share — connect only after user clicks Ready
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--surface,#1e1e2e)">
          <div style="font-size:1.1rem;font-weight:700;color:var(--text,#cdd6f4)">👥 Multiplayer</div>
          <div style="font-size:.8rem;color:var(--text-dim,#a6adc8);text-align:center">Share this link with your opponent:</div>
          <div style="background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:8px;padding:10px 14px;font-size:.75rem;word-break:break-all;color:#89b4fa;max-width:320px;text-align:center;user-select:all">${link}</div>
          <button id="sf-copy-link" style="padding:8px 24px;background:var(--accent,#6366f1);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:.9rem;font-weight:600">📋 Copy link</button>
          <div id="sf-invite-wrap"></div>
          <div id="sf-players-status" style="font-size:.85rem;color:var(--text-dim,#a6adc8);text-align:center;line-height:1.8">✅ ${_myName()}<br>⏳ Waiting for opponent…</div>
          <button id="sf-ready" style="padding:10px 28px;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:8px;color:var(--text-dim,#a6adc8);cursor:pointer;font-size:.9rem" disabled>⏳ Waiting for opponent…</button>
          <button id="sf-back" style="padding:6px 16px;background:transparent;border:1px solid var(--border,#45475a);border-radius:6px;color:var(--text-dim,#a6adc8);cursor:pointer;font-size:.8rem">← Back</button>
        </div>`;

      const copyBtn = body.querySelector('#sf-copy-link');
      const readyBtn = body.querySelector('#sf-ready');

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(link).catch(() => {});
        copyBtn.textContent = '✓ Copied!';
      });

      // Invite from Game Hub favourites
      _loadGameHub(async () => {
        if (!window.GameHub) return;
        const me = window.GameHub.currentPlayer();
        if (!me) return;
        const token = localStorage.getItem('gh_token');
        if (!token) return;

        let favs = [];
        try {
          const r = await fetch('/api/pub/gamehub/favourites', {headers:{'X-GH-Token':token}});
          if (r.ok) favs = (await r.json()).filter(f => f.id !== me.id);
        } catch(_) {}
        if (!favs.length) return;

        const wrap = body.querySelector('#sf-invite-wrap');
        wrap.style.cssText = 'width:100%;max-width:320px;text-align:left';
        wrap.innerHTML = `
          <div style="font-size:.75rem;color:#a6adc8;margin-bottom:6px">🎮 Invite from Game Hub:</div>
          <div id="sf-fav-list" style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px"></div>
          <button id="sf-invite-send" style="width:100%;padding:7px 0;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:6px;color:#cdd6f4;cursor:pointer;font-size:.82rem" disabled>Send invitations</button>
          <div id="sf-invite-status" style="font-size:.75rem;color:#a6adc8;text-align:center;margin-top:4px;min-height:16px"></div>`;

        const listEl = wrap.querySelector('#sf-fav-list');
        const sendBtn = wrap.querySelector('#sf-invite-send');
        const statusEl = wrap.querySelector('#sf-invite-status');
        const selected = new Set();

        favs.forEach(f => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.05);cursor:pointer;transition:background .12s';
          const avatarHtml = _avatar(f, 22);
          row.innerHTML = `
            <input type="checkbox" id="sf-cb-${f.id}" style="accent-color:#89b4fa;cursor:pointer;width:15px;height:15px;flex-shrink:0">
            ${avatarHtml}
            <span style="font-size:.83rem;font-weight:600;color:#cdd6f4">${f.display_name||f.username||'?'}</span>`;
          const cb = row.querySelector('input');
          row.addEventListener('click', e => { if (e.target !== cb) cb.click(); });
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(f.id); else selected.delete(f.id);
            sendBtn.disabled = selected.size === 0;
            row.style.background = cb.checked ? 'rgba(137,180,250,.15)' : 'rgba(255,255,255,.05)';
          });
          listEl.appendChild(row);
        });

        sendBtn.addEventListener('click', async () => {
          sendBtn.disabled = true;
          statusEl.textContent = 'Sending…';
          try {
            const r = await fetch('/api/pub/gamehub/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-GH-Token': token },
              body: JSON.stringify({ to_ids: [...selected], game_id: 'sudofall', room_url: link }),
            });
            statusEl.textContent = r.ok ? '✓ Invitations sent!' : 'Error sending invitations.';
          } catch(_) {
            statusEl.textContent = 'Error sending invitations.';
          }
          setTimeout(() => { sendBtn.disabled = selected.size === 0; }, 2000);
        });
      });
      body.querySelector('#sf-back').addEventListener('click', () => {
        const token = localStorage.getItem('gh_token');
        if (_mpRoomLink && token) fetch('/api/pub/gamehub/invites?room_url=' + encodeURIComponent(_mpRoomLink), {method:'DELETE',headers:{'X-GH-Token':token}}).catch(()=>{});
        _showMpLobby(body);
      });

      // Connect WebSocket — lobby phase handler updates the Ready button
      _mpConnect(roomId);
      _mp.phase = (msg) => {
        if (msg.type === 'player_joined') {
          body.querySelector('#sf-players-status').innerHTML = `✅ ${_myName()}<br>✅ Opponent connected`;
          readyBtn.textContent = '▶ Start game';
          readyBtn.style.background = 'var(--accent,#6366f1)';
          readyBtn.style.color = '#fff';
          readyBtn.style.border = 'none';
          readyBtn.style.fontWeight = '600';
          readyBtn.disabled = false;
        }
        if (msg.type === 'hello') {
          _mp.opponentGhPlayerId = msg.gh_player_id || null;
          _mp.opponentName = msg.name || 'Opponent';
          _mp.opponentAvatarSvg = msg.avatar_svg || null;
          const statusEl = body.querySelector('#sf-players-status');
          if (statusEl) statusEl.innerHTML = `✅ ${_myName()}<br>✅ ${_mp.opponentName}`;
        }
        if (msg.type === 'player_left') {
          body.querySelector('#sf-players-status').innerHTML = `✅ ${_myName()}<br>⏳ Waiting for opponent…`;
          readyBtn.textContent = '⏳ Waiting for opponent…';
          readyBtn.style.background = 'var(--surface2,#313244)';
          readyBtn.style.color = 'var(--text-dim,#a6adc8)';
          readyBtn.style.border = '1px solid var(--border,#45475a)';
          readyBtn.disabled = true;
        }
      };

      readyBtn.addEventListener('click', () => {
        if (readyBtn.disabled) return;
        readyBtn.disabled = true;
        readyBtn.textContent = '⏳ Starting…';
        const first = Math.floor(Math.random() * 2);
        // Host generates the full shared sequence (first number never a joker)
        const seq = Array.from({length: 500}, () => Math.floor(Math.random() * 10));
        while (seq[0] === 0) seq[0] = Math.floor(Math.random() * 10);
        _mp.isHost = true;
        _mp.seq = seq;
        _mp.idx = 0;
        _mp.myTurn = (first === 0);
        current = seq[0];
        next = seq[1];
        _mp.ws.send(JSON.stringify({ type: 'game_start', first, seq, hostName: _myName(), hostAvatarSvg: _ghPlayer?.avatar_svg || null }));
        // Cancel pending invites — game is starting
        const _sfInvToken = localStorage.getItem('gh_token');
        if (_mpRoomLink && _sfInvToken) fetch('/api/pub/gamehub/invites?room_url=' + encodeURIComponent(_mpRoomLink), {method:'DELETE',headers:{'X-GH-Token':_sfInvToken}}).catch(()=>{});
        _startMpGame();
      });
    } // end if (false)
  }

  function init(body) {
    _body = body;
    _showMpLobby(body);
  }

  function _buildGameUI(body) {
    if (!_mpMode) _body = body;
    initState();

    body.innerHTML = `
      <style>
        @keyframes sf-pulse { from { transform: scale(1); } to { transform: scale(1.12); } }
      </style>
      <div style="display:flex;flex-direction:column;height:100%;padding:6px 8px;box-sizing:border-box;gap:6px;position:relative">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);text-transform:uppercase;letter-spacing:.05em">${t('score')}</div>
            <div id="sf-score" style="font-size:1.5rem;font-weight:700;color:var(--text,#cdd6f4);line-height:1">0</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">${t('drop')}</div>
              <div id="sf-current" style="width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#1e1e2e;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:background .2s"></div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">${t('next')}</div>
              <div id="sf-next" style="width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#1e1e2e;opacity:.75;transition:background .2s"></div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">${t('time')}</div>
              <div id="sf-timer" style="font-size:1rem;font-weight:700;color:var(--text,#cdd6f4);min-width:36px;text-align:center">0:00</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">💣</div>
              <div id="sf-bombs" style="font-size:1rem;font-weight:700;color:#f38ba8;min-width:24px;text-align:center">💣 0</div>
            </div>
          </div>
          <button id="sf-restart" style="padding:5px 14px;font-size:.8rem;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:6px;color:var(--text,#cdd6f4);cursor:pointer">${t('new_game')}</button>
        </div>

        <!-- Grid container -->
        <div style="flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;overflow:hidden" id="sf-grid-container">
          <div id="sf-grid-wrap">

            <!-- Drop row -->
            <div id="sf-drop-row" style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px;margin-bottom:3px;height:9%"></div>

            <!-- Main grid -->
            <div id="sf-grid" style="display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:2px;height:91%"></div>
          </div>
        </div>

        <!-- Game over -->
        <div id="sf-gameover" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.8);z-index:10;flex-direction:column;align-items:center;justify-content:center;gap:16px;border-radius:8px">
          <div style="font-size:1.8rem;font-weight:700;color:#f9e2af">${t('game_over')}</div>
          <div id="sf-go-score" style="font-size:1.1rem;color:var(--text,#cdd6f4)"></div>
          <div id="sf-go-time" style="font-size:.9rem;color:var(--text-dim,#a6adc8)"></div>
          <button id="sf-play-again" style="padding:10px 28px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">${t('play_again')}</button>
        </div>
      </div>
    `;

    _scoreEl = body.querySelector('#sf-score');
    _currentEl = body.querySelector('#sf-current');
    _nextEl = body.querySelector('#sf-next');
    _timerEl = body.querySelector('#sf-timer');
    _bombEl = body.querySelector('#sf-bombs');
    _msgEl = body.querySelector('#sf-gameover');
    _goScore = body.querySelector('#sf-go-score');
    _goTime = body.querySelector('#sf-go-time');

    // Build drop row
    const dropRow_ = body.querySelector('#sf-drop-row');
    _dropCells = [];
    for (let c = 0; c < 9; c++) {
      const el = document.createElement('div');
      el.style.cssText = `
        display:flex;align-items:center;justify-content:center;
        border-radius:4px;border:2px dashed var(--border,#45475a);
        font-size:.7rem;color:var(--text-dim,#6c7086);
        transition:background .15s,border-color .15s;
        user-select:none;
      `;
      el.textContent = '▼';

      el.addEventListener('click', () => { if (!animating && !gameOver) placeNumber(c); });
      el.addEventListener('dragover', e => { e.preventDefault(); _dragCol = c; render(); });
      el.addEventListener('dragleave', () => { _dragCol = -1; render(); });
      el.addEventListener('drop', e => { e.preventDefault(); _dragCol = -1; placeNumber(c); render(); });
      el.addEventListener('touchend', e => { e.preventDefault(); if (!animating && !gameOver) placeNumber(c); });

      _dropCells.push(el);
      dropRow_.appendChild(el);
    }

    // Build main grid
    const gridEl = body.querySelector('#sf-grid');
    _cells = [];
    for (let r = 0; r < 9; r++) {
      _cells.push([]);
      for (let c = 0; c < 9; c++) {
        const el = document.createElement('div');
        el.className = 'sf-cell';
        el.dataset.r = r;
        el.dataset.c = c;
        // Box borders via margin
        const mt = r % 3 === 0 && r !== 0 ? '3px' : '0';
        const ml = c % 3 === 0 && c !== 0 ? '3px' : '0';
        el.style.cssText = `
          display:flex;align-items:center;justify-content:center;
          border-radius:3px;
          font-size:clamp(.8rem,3vw,1.1rem);font-weight:700;
          transition:background .12s,transform .12s;
          margin-top:${mt};margin-left:${ml};
        `;
        _cells[r].push(el);
        gridEl.appendChild(el);
      }
    }

    // Click on current tile — for joker picker
    _currentEl.addEventListener('click', () => {
      if (current === 0 && (!_mpMode || _mp?.myTurn)) _resolveJoker();
    });

    // Draggable current number
    _currentEl.draggable = true;
    _currentEl.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', 'sudofall');
      e.dataTransfer.effectAllowed = 'copy';
    });

    // Touch drag on current number
    let touchStartX = 0;
    _currentEl.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
    }, {passive: true});

    body.querySelector('#sf-restart').addEventListener('click', () => {
      if (_mpMode) { _mpLeave(); _showMpLobby(_body); return; }
      _showMpLobby(_body);
    });
    body.querySelector('#sf-play-again').addEventListener('click', () => { _showMpLobby(_body); });

    // Responsive grid sizing — fit inside available space
    const gridContainer = body.querySelector('#sf-grid-container');
    const gridWrap = body.querySelector('#sf-grid-wrap');
    function _resizeGrid() {
      const availW = gridContainer.clientWidth;
      const availH = gridContainer.clientHeight;
      // grid aspect ratio is 9 wide : 10 tall (9 cols + drop row)
      let h = availH;
      let w = h * 9 / 10;
      if (w > availW) { w = availW; h = w * 10 / 9; }
      gridWrap.style.width = w + 'px';
      gridWrap.style.height = h + 'px';
      // Set font size based on cell size (grid is 9 cols, 91% of height for cells)
      const cellSize = w / 9;
      const fs = Math.round(cellSize * 0.52);
      _cells.forEach(row => row.forEach(el => el.style.fontSize = fs + 'px'));
    }
    _resizeGrid();
    new ResizeObserver(_resizeGrid).observe(gridContainer);

    render();
  }

  function joinMultiplayer(body, roomId) {
    _body = body;
    _mpMode = true;

    function _connectAndPlay(playerName) {
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--surface,#1e1e2e)">
          <div style="font-size:1.8rem">🔢</div>
          <div style="font-size:.85rem;color:var(--text-dim,#a6adc8)">⏳ Waiting for host to start…</div>
        </div>`;
      _mpConnect(roomId);
      const sendHello = () => _mp.ws.send(JSON.stringify({
        type: 'hello',
        name: playerName,
        gh_player_id: _ghPlayer ? _ghPlayer.id : null,
        avatar_svg: _ghPlayer?.avatar_svg || null,
      }));
      if (_mp.ws.readyState === 1) sendHello();
      else _mp.ws.onopen = sendHello;
      _mp.phase = (msg) => {
        if (msg.type === 'game_start') {
          _mp.opponentName = msg.hostName || 'Host';
          _mp.opponentAvatarSvg = msg.hostAvatarSvg || null;
          _mp.seq = msg.seq;
          _mp.idx = 0;
          _mp.myTurn = (msg.first === _mp.playerIndex);
          current = _mp.seq[0];
          next = _mp.seq[1];
          _startMpGame();
        }
        if (msg.type === 'player_left') _showMpDisconnect();
      };
    }

    // Show Game Hub widget — player must choose before connecting
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--surface,#1e1e2e)">
        <div style="font-size:1.8rem">🔢</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text,#cdd6f4)">Sudofall — Multiplayer</div>
        <div id="sf-join-gh" style="width:260px"></div>
      </div>`;

    _loadGameHub(() => {
      if (!window.GameHub) {
        _connectAndPlay('Player');
        return;
      }
      window.GameHub.renderWidget(body.querySelector('#sf-join-gh'), {
        onReady(player) {
          _ghPlayer = player;
          _connectAndPlay(player.display_name);
        },
      });
    });
  }

  return { init, joinMultiplayer };
})();
