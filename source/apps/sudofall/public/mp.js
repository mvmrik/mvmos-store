(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const COLORS = {
    1: '#f38ba8', 2: '#fab387', 3: '#f9e2af',
    4: '#a6e3a1', 5: '#94e2d5', 6: '#89dceb',
    7: '#89b4fa', 8: '#b4befe', 9: '#cba6f7',
  };

  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _avatar(p, size) { return (p && window.GameHub) ? window.GameHub.renderAvatar(p, size) : ''; }
  function _me()  { return window.GameHub?.currentPlayer() || {}; }
  function _myName()  { return _me().display_name || 'You'; }
  function _oppName() { return _oppInfo?.display_name || 'Opponent'; }
  function _myAvatarHtml(size)  { return _avatar(_me(), size); }
  function _oppAvatarHtml(size) { return _avatar(_oppInfo, size); }

  // ── State ─────────────────────────────────────────────────────────────────
  let _root = null;
  let _oppInfo = null;       // {id, display_name, avatar_svg, avatar_color}
  let _myTurn = false;
  let _myScore = 0;
  let _oppScore = 0;
  let _oppGrid = null;
  let _isHost = false;
  let _seq = [];
  let _idx = 0;
  let _gameOver = false;
  let _gameStartTime = 0;
  let _elapsed = 0;
  let _timerInterval = null;
  let _showingOppMove = false;

  // DOM refs
  let _myGridEl = null;
  let _oppGridEl = null;
  let _statusEl = null;
  let _gameoverEl = null;

  // ── Grid state (mirrors SudofallGame but independent) ─────────────────────
  let _grid = [];
  let _current = 0;
  let _next = 0;
  let _bombs = 0;
  let _animating = false;
  let _cells = [];
  let _dropCells = [];
  let _dragCol = -1;
  let _scoreEl = null, _currentEl = null, _nextEl = null, _timerEl = null, _bombEl = null, _msgEl = null, _goScore = null, _goTime = null;

  function _newGrid() { return Array.from({length:9}, () => Array(9).fill(0)); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _initState(seq, idx) {
    _seq = seq; _idx = idx;
    _grid = _newGrid();
    _myScore = 0; _bombs = 0; _gameOver = false; _animating = false;
    _elapsed = 0; _gameStartTime = Date.now();
    _current = _seq[_idx % _seq.length];
    _next    = _seq[(_idx + 1) % _seq.length];
  }

  function _startTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      if (_gameOver || !_myTurn) return;
      _elapsed++;
      if (_timerEl) _timerEl.textContent = _formatTime(_elapsed);
      if (_elapsed % 10 === 0) { _myScore--; if (_scoreEl) _scoreEl.textContent = _myScore; }
    }, 1000);
  }

  function _formatTime(s) {
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  }

  function _dropRow(col) {
    for (let r = 8; r >= 0; r--) if (_grid[r][col] === 0) return r;
    return -1;
  }

  function _wouldConflict(row, col, num) {
    for (let c = 0; c < 9; c++) if (c !== col && _grid[row][c] === num) return true;
    for (let r = 0; r < 9; r++) if (r !== row && _grid[r][col] === num) return true;
    const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
    for (let r = br; r < br+3; r++)
      for (let c = bc; c < bc+3; c++)
        if ((r !== row || c !== col) && _grid[r][c] === num) return true;
    return false;
  }

  function _canDrop(col) {
    if (_current === 0) return false;
    const row = _dropRow(col);
    if (row < 0) return false;
    return _wouldConflict(row, col, _current) ? 'warn' : 'valid';
  }

  function _findClears() {
    const toRemove = new Set(); let cleared = 0;
    for (let r = 0; r < 9; r++) {
      const vals = _grid[r].filter(v => v !== 0);
      if (vals.length === 9 && new Set(vals).size === 9) {
        for (let c = 0; c < 9; c++) toRemove.add(`${r},${c}`); cleared++;
      }
    }
    for (let c = 0; c < 9; c++) {
      const vals = _grid.map(r => r[c]).filter(v => v !== 0);
      if (vals.length === 9 && new Set(vals).size === 9) {
        for (let r = 0; r < 9; r++) toRemove.add(`${r},${c}`); cleared++;
      }
    }
    for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
      const vals = [];
      for (let r = br*3; r < br*3+3; r++) for (let c = bc*3; c < bc*3+3; c++) if (_grid[r][c]) vals.push(_grid[r][c]);
      if (vals.length === 9 && new Set(vals).size === 9) {
        for (let r = br*3; r < br*3+3; r++) for (let c = bc*3; c < bc*3+3; c++) toRemove.add(`${r},${c}`); cleared++;
      }
    }
    return { toRemove, cleared };
  }

  function _applyGravity() {
    for (let c = 0; c < 9; c++) {
      const vals = [];
      for (let r = 0; r < 9; r++) if (_grid[r][c]) vals.push(_grid[r][c]);
      for (let r = 0; r < 9; r++) _grid[r][c] = 0;
      for (let i = 0; i < vals.length; i++) _grid[9 - vals.length + i][c] = vals[i];
    }
  }

  function _gridFull() {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!_grid[r][c]) return false;
    return true;
  }

  function _findConflicts() {
    const s = new Set();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const val = _grid[r][c]; if (!val) continue;
      for (let c2 = 0; c2 < 9; c2++) if (c2!==c && _grid[r][c2]===val) { s.add(`${r},${c}`); break; }
      for (let r2 = 0; r2 < 9; r2++) if (r2!==r && _grid[r2][c]===val) { s.add(`${r},${c}`); break; }
      const br=Math.floor(r/3)*3, bc=Math.floor(c/3)*3;
      outer: for (let r2=br;r2<br+3;r2++) for (let c2=bc;c2<bc+3;c2++)
        if ((r2!==r||c2!==c) && _grid[r2][c2]===val) { s.add(`${r},${c}`); break outer; }
    }
    return s;
  }

  function _findConflictsInGrid(g) {
    const s = new Set();
    if (!g) return s;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const val = g[r]?.[c]; if (!val) continue;
      for (let c2=0;c2<9;c2++) if (c2!==c && g[r][c2]===val) { s.add(`${r},${c}`); break; }
      for (let r2=0;r2<9;r2++) if (r2!==r && g[r2]?.[c]===val) { s.add(`${r},${c}`); break; }
      const br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;
      outer: for (let r2=br;r2<br+3;r2++) for (let c2=bc;c2<bc+3;c2++)
        if ((r2!==r||c2!==c) && g[r2]?.[c2]===val) { s.add(`${r},${c}`); break outer; }
    }
    return s;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function _render() {
    if (!_scoreEl) return;
    _scoreEl.textContent = _myScore;
    _currentEl.textContent = _current === 0 ? '?' : _current;
    _currentEl.style.background = _current === 0
      ? 'linear-gradient(135deg,#f38ba8,#fab387,#f9e2af,#a6e3a1,#89b4fa,#cba6f7)'
      : (COLORS[_current] || '#89b4fa');
    _currentEl.style.cursor = _current === 0 ? 'pointer' : 'grab';
    _currentEl.style.animation = _current === 0 ? 'sf-pulse .8s ease-in-out infinite alternate' : '';
    _nextEl.textContent = _next === 0 ? '0' : _next;
    _nextEl.style.background = _next === 0
      ? 'linear-gradient(135deg,#f38ba8,#fab387,#f9e2af,#a6e3a1,#89b4fa,#cba6f7)'
      : (COLORS[_next] || '#89b4fa');
    if (_bombEl) _bombEl.textContent = `💣 ${_bombs}`;

    _dropCells.forEach((el, c) => {
      const mode = _canDrop(c);
      if (!mode) {
        el.style.background = 'rgba(255,255,255,.04)'; el.style.borderColor = 'var(--border,#45475a)';
        el.style.color = 'var(--text-dim,#6c7086)'; el.style.cursor = 'not-allowed';
        el.style.opacity = '.25'; el.textContent = '▼';
      } else if (mode === 'warn') {
        el.style.background = c===_dragCol ? 'rgba(250,179,135,.3)' : 'rgba(250,179,135,.08)';
        el.style.borderColor = '#fab387'; el.style.color = '#fab387';
        el.style.cursor = 'pointer'; el.style.opacity = '1'; el.textContent = '⚠';
      } else {
        el.style.background = c===_dragCol ? (COLORS[_current]||'#89b4fa')+'55' : 'rgba(255,255,255,.04)';
        el.style.borderColor = c===_dragCol ? (COLORS[_current]||'#89b4fa') : 'var(--border,#45475a)';
        el.style.color = 'var(--text-dim,#6c7086)'; el.style.cursor = 'pointer';
        el.style.opacity = '1'; el.textContent = '▼';
      }
    });

    const conflicts = _findConflicts();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const val = _grid[r][c]; const el = _cells[r][c];
      el.textContent = val || '';
      if (val) {
        if (conflicts.has(`${r},${c}`)) {
          el.style.background = `repeating-linear-gradient(45deg,${COLORS[val]},${COLORS[val]} 4px,#1e1e2e 4px,#1e1e2e 8px)`;
          el.style.color = '#fff'; el.style.outline = `2px solid ${COLORS[val]}`; el.style.outlineOffset = '-2px';
        } else {
          el.style.background = COLORS[val]; el.style.color = '#1e1e2e';
          el.style.outline = ''; el.style.textShadow = '';
        }
      } else {
        const br=Math.floor(r/3), bc=Math.floor(c/3);
        el.style.background = (br+bc)%2===0 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.2)';
        el.style.color = 'transparent'; el.style.outline = '';
      }
    }

    if (_gameOver && _msgEl) {
      _msgEl.style.display = 'flex';
    }
  }

  function _updateStatus() {
    if (!_statusEl) return;
    const myBold  = _myTurn  ? 'font-weight:700;color:var(--text,#cdd6f4)' : 'font-weight:400;color:var(--text-dim,#a6adc8)';
    const oppBold = !_myTurn ? 'font-weight:700;color:var(--text,#cdd6f4)' : 'font-weight:400;color:var(--text-dim,#a6adc8)';
    _statusEl.innerHTML =
      `<span style="display:inline-flex;align-items:center;gap:5px;${myBold}">${_myAvatarHtml(18)}<span>${_esc(_myName())}: ${_myScore}</span></span>`+
      `<span style="color:#45475a;margin:0 6px">|</span>`+
      `<span style="display:inline-flex;align-items:center;gap:5px;${oppBold}">${_oppAvatarHtml(18)}<span>${_esc(_oppName())}: ${_oppScore}</span></span>`;
  }

  function _showMyGrid() {
    if (!_myGridEl || !_oppGridEl) return;
    _myGridEl.closest('#sf-my-side').style.display = 'flex';
    _oppGridEl.closest('#sf-opp-side').style.display = 'none';
  }

  function _showOpponentGrid() {
    if (!_myGridEl || !_oppGridEl) return;
    _myGridEl.closest('#sf-my-side').style.display = 'none';
    _oppGridEl.closest('#sf-opp-side').style.display = 'flex';
    _renderOppGrid();
  }

  function _renderOppGrid() {
    if (!_oppGridEl || !_oppGrid) return;
    const g = _oppGrid;
    const conflicts = _findConflictsInGrid(g);
    const cells = _oppGridEl.querySelectorAll('.sf-opp-cell');
    cells.forEach((el, i) => {
      const r = Math.floor(i/9), c = i%9;
      const val = g[r]?.[c] || 0;
      el.textContent = val || '';
      if (val) {
        if (conflicts.has(`${r},${c}`)) {
          el.style.background = `repeating-linear-gradient(45deg,${COLORS[val]},${COLORS[val]} 4px,#1e1e2e 4px,#1e1e2e 8px)`;
          el.style.color = '#fff';
        } else {
          el.style.background = COLORS[val]; el.style.color = '#1e1e2e';
        }
      } else {
        el.style.background = 'rgba(255,255,255,.03)'; el.style.color = 'transparent';
      }
    });
  }

  function _buildOppGridUI(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:1px;height:100%;width:100%';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const el = document.createElement('div');
      el.className = 'sf-opp-cell';
      const mt = r%3===0&&r!==0?'2px':'0', ml = c%3===0&&c!==0?'2px':'0';
      el.style.cssText = `display:flex;align-items:center;justify-content:center;border-radius:2px;font-size:clamp(.6rem,2vw,.85rem);font-weight:700;background:rgba(255,255,255,.03);margin-top:${mt};margin-left:${ml}`;
      wrap.appendChild(el);
    }
    container.appendChild(wrap);
  }

  function _buildMyGridUI(container) {
    container.innerHTML = `
      <style>@keyframes sf-pulse { from { transform:scale(1); } to { transform:scale(1.12); } }</style>
      <div style="display:flex;flex-direction:column;height:100%;padding:6px 8px;box-sizing:border-box;gap:6px;position:relative">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);text-transform:uppercase;letter-spacing:.05em">Score</div>
            <div id="sfmp-score" style="font-size:1.5rem;font-weight:700;color:var(--text,#cdd6f4);line-height:1">0</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">DROP</div>
              <div id="sfmp-current" style="width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#1e1e2e;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:background .2s"></div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">Next</div>
              <div id="sfmp-next" style="width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#1e1e2e;opacity:.75;transition:background .2s"></div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">Time</div>
              <div id="sfmp-timer" style="font-size:1rem;font-weight:700;color:var(--text,#cdd6f4);min-width:36px;text-align:center">0:00</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.7rem;color:var(--text-dim,#a6adc8);margin-bottom:3px">💣</div>
              <div id="sfmp-bombs" style="font-size:1rem;font-weight:700;color:#f38ba8;min-width:24px;text-align:center">💣 0</div>
            </div>
          </div>
        </div>
        <div style="flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;overflow:hidden">
          <div id="sfmp-grid-wrap" style="width:100%;height:100%;display:flex;flex-direction:column;gap:3px">
            <div id="sfmp-drop-row" style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px;height:9%"></div>
            <div id="sfmp-grid" style="display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:2px;flex:1;min-height:0"></div>
          </div>
        </div>
      </div>`;

    _scoreEl   = container.querySelector('#sfmp-score');
    _currentEl = container.querySelector('#sfmp-current');
    _nextEl    = container.querySelector('#sfmp-next');
    _timerEl   = container.querySelector('#sfmp-timer');
    _bombEl    = container.querySelector('#sfmp-bombs');

    const dropRow = container.querySelector('#sfmp-drop-row');
    _dropCells = [];
    for (let c = 0; c < 9; c++) {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;justify-content:center;border-radius:4px 4px 0 0;border:1px solid var(--border,#45475a);font-size:.8rem;color:var(--text-dim,#6c7086);cursor:pointer;transition:background .1s,border-color .1s;';
      el.textContent = '▼';
      el.addEventListener('click', () => _handleClick(c));
      el.addEventListener('mouseenter', () => { _dragCol = c; _render(); });
      el.addEventListener('mouseleave', () => { _dragCol = -1; _render(); });
      dropRow.appendChild(el); _dropCells.push(el);
    }

    const gridEl = container.querySelector('#sfmp-grid');
    _cells = [];
    for (let r = 0; r < 9; r++) {
      _cells[r] = [];
      for (let c = 0; c < 9; c++) {
        const el = document.createElement('div');
        const br=Math.floor(r/3), bc=Math.floor(c/3);
        el.style.cssText = `display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:clamp(.7rem,2vw,1rem);font-weight:700;color:#1e1e2e;transition:background .12s,transform .1s;background:${(br+bc)%2===0?'rgba(255,255,255,.03)':'rgba(0,0,0,.2)'}`;
        el.dataset.r = r; el.dataset.c = c;
        gridEl.appendChild(el); _cells[r][c] = el;
      }
    }

    _currentEl.addEventListener('click', () => {
      if (_current === 0 && !_animating && !_gameOver && _myTurn) _resolveJoker();
    });
  }

  async function _handleClick(col) {
    if (!_myTurn || _gameOver || _animating) return;
    const mode = _canDrop(col);
    if (!mode) return;
    _animating = true;

    const row = _dropRow(col);
    if (row < 0) { _animating = false; return; }

    for (let r = 0; r <= row; r++) {
      const el = _cells[r][col];
      el.textContent = _current === 0 ? '?' : _current;
      el.style.background = COLORS[_current] || '#89b4fa';
      el.style.color = '#1e1e2e';
      el.style.transform = 'scale(1.05)';
      await sleep(50);
      if (r < row) {
        el.textContent = _grid[r][col] || '';
        el.style.background = _grid[r][col] ? (COLORS[_grid[r][col]]||'#89b4fa') : ((Math.floor(r/3)+Math.floor(col/3))%2===0?'rgba(255,255,255,.03)':'rgba(0,0,0,.2)');
        el.style.color = _grid[r][col] ? '#1e1e2e' : 'transparent';
        el.style.transform = '';
      }
    }
    _grid[row][col] = _current;
    if (!_wouldConflict(row, col, _current)) _myScore++;

    const landed = _cells[row][col];
    landed.style.transition = 'transform .1s';
    landed.style.transform = 'scale(1.18)';
    await sleep(110);
    landed.style.transform = ''; landed.style.transition = '';

    let iterations = 0;
    while (iterations++ < 10) {
      const { toRemove, cleared } = _findClears();
      if (!toRemove.size) break;
      _myScore += cleared * 9; _bombs += cleared;
      toRemove.forEach(key => {
        const [rr,cc] = key.split(',').map(Number);
        _cells[rr][cc].style.transition = 'background .1s,transform .1s';
        _cells[rr][cc].style.background = '#f9e2af';
        _cells[rr][cc].style.transform = 'scale(1.1)';
      });
      await sleep(180);
      toRemove.forEach(key => {
        const [rr,cc] = key.split(',').map(Number);
        _cells[rr][cc].style.transition = 'opacity .12s,transform .12s';
        _cells[rr][cc].style.opacity = '0';
        _cells[rr][cc].style.transform = 'scale(0.7)';
        _grid[rr][cc] = 0;
      });
      await sleep(130);
      _applyGravity(); _render();
      toRemove.forEach(key => {
        const [rr,cc] = key.split(',').map(Number);
        _cells[rr][cc].style.transition = '';
        _cells[rr][cc].style.opacity = '';
        _cells[rr][cc].style.transform = '';
      });
      await sleep(80);
    }

    _idx++;
    const i = _idx % _seq.length;
    _current = _seq[i]; _next = _seq[(i+1) % _seq.length];
    _animating = false;

    if (_gridFull()) {
      _gameOver = true;
      mp.send({ type: 'game_over', score: _myScore });
      _showResult();
      return;
    }

    mp.send({ type: 'move' });
    mp.send({ type: 'grid_update', grid: _grid.map(r => [...r]) });
    mp.send({ type: 'score_update', score: _myScore });
    _myTurn = false;
    _updateStatus();
    _render();
    setTimeout(() => _showOpponentGrid(), 1000);
  }

  function _resolveJoker() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;z-index:50;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;border-radius:8px';
    overlay.innerHTML = `
      <div style="background:var(--surface,#1e1e2e);border:1px solid var(--border,#45475a);border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:.8rem;color:var(--text-dim,#a6adc8);margin-bottom:10px;letter-spacing:.05em;text-transform:uppercase">Joker — choose a number</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          ${[1,2,3,4,5,6,7,8,9].map(n=>`<div data-n="${n}" style="width:44px;height:44px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:#1e1e2e;background:${COLORS[n]};cursor:pointer">${n}</div>`).join('')}
        </div>
      </div>`;
    _myGridEl.closest('#sf-my-side').appendChild(overlay);
    overlay.querySelectorAll('[data-n]').forEach(el => {
      el.addEventListener('click', () => { overlay.remove(); _current = +el.dataset.n; _render(); });
    });
  }

  function _showResult() {
    if (!_gameoverEl) return;
    _gameoverEl.style.display = 'flex';
    const resultEl = _gameoverEl.querySelector('#sfmp-result');
    const scoreEl  = _gameoverEl.querySelector('#sfmp-go-score');
    const timeEl   = _gameoverEl.querySelector('#sfmp-go-time');
    const won = _myScore > _oppScore, tied = _myScore === _oppScore;
    if (resultEl) resultEl.textContent = tied ? '🤝 Tie!' : won ? '🏆 You Win!' : '😢 You Lose';
    if (scoreEl) scoreEl.textContent = `${_myScore} vs ${_oppScore}`;
    const elapsed = Math.round((Date.now() - _gameStartTime) / 1000);
    if (timeEl) timeEl.textContent = `Time: ${_formatTime(elapsed)}`;
  }

  // ── renderSetup ───────────────────────────────────────────────────────────
  function renderSetup(box) {
    box.innerHTML = '<div style="font-size:.85rem;color:#a6adc8;text-align:center;padding:8px 0">🔢 Ready to play! Start when 2 players are in the lobby.</div>';
    return () => ({});
  }

  // ── renderGame ────────────────────────────────────────────────────────────
  function renderGame(box) {
    _root = box;
    _myTurn = false; _oppScore = 0; _oppGrid = null; _isHost = false;

    box.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:6px 8px;box-sizing:border-box;gap:6px;position:relative;background:var(--surface,#1e1e2e)">
        <div id="sf-mp-status" style="text-align:center;font-size:.8rem;padding:4px 8px;border-radius:6px;background:var(--surface2,#313244);flex-shrink:0"></div>
        <div style="flex:1;min-height:0;display:flex;gap:8px">
          <div id="sf-my-side" style="flex:1;min-width:0;display:flex;flex-direction:column">
            <div id="sfmp-my-game" style="flex:1;min-height:0"></div>
          </div>
          <div id="sf-opp-side" style="flex:1;min-width:0;display:flex;flex-direction:column;display:none">
            <div style="font-size:.7rem;color:#a6adc8;text-align:center;margin-bottom:4px" id="sfmp-opp-label">Opponent</div>
            <div id="sfmp-opp-game" style="flex:1;min-height:0;opacity:.85"></div>
          </div>
        </div>
        <div id="sfmp-gameover" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.85);z-index:10;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:8px">
          <div id="sfmp-result" style="font-size:1.4rem;font-weight:700;color:#f9e2af"></div>
          <div id="sfmp-go-score" style="font-size:1rem;color:var(--text,#cdd6f4)"></div>
          <div id="sfmp-go-time" style="font-size:.85rem;color:var(--text-dim,#a6adc8)"></div>
          <button id="sfmp-play-again" style="padding:10px 28px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Play Again</button>
        </div>
      </div>`;

    _statusEl   = box.querySelector('#sf-mp-status');
    _gameoverEl = box.querySelector('#sfmp-gameover');
    _myGridEl   = box.querySelector('#sfmp-my-game');
    _oppGridEl  = box.querySelector('#sfmp-opp-game');
    _msgEl      = _gameoverEl;

    _buildMyGridUI(_myGridEl);
    _buildOppGridUI(_oppGridEl);

    box.querySelector('#sfmp-play-again').addEventListener('click', () => {
      if (_timerInterval) clearInterval(_timerInterval);
      mp.send({ type: 'leave' });
      location.reload();
    });

    // ── Message handlers ──────────────────────────────────────────────────
    mp.on('game_start', (msg) => {
      _oppInfo = msg.opponent || _opp();
      const lbl = box.querySelector('#sfmp-opp-label');
      if (lbl && _oppInfo) lbl.innerHTML = window.GameHub.renderAvatar(_oppInfo, 16) + ' ' + _esc(_oppName());
      _isHost = msg.is_host || false;
      _initState(msg.seq, 0);
      _myTurn = msg.first_player_id === mp.youId();
      _startTimer();
      _updateStatus();
      _render();
      if (!_myTurn) _showOpponentGrid(); else _showMyGrid();
    });

    mp.on('move', () => {
      _myTurn = true; _showingOppMove = true;
      _showOpponentGrid(); _updateStatus();
      setTimeout(() => {
        _showingOppMove = false;
        _showMyGrid(); _updateStatus(); _render();
      }, 1500);
    });

    mp.on('score_update', (msg) => {
      _oppScore = msg.score; _updateStatus();
    });

    mp.on('grid_update', (msg) => {
      _oppGrid = msg.grid;
      if (!_myTurn || _showingOppMove) _renderOppGrid();
    });

    mp.on('player_left', () => {
      box.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--surface,#1e1e2e)">
          <div style="font-size:2rem">🚪</div>
          <div style="font-size:1rem;font-weight:700;color:#f38ba8">Opponent disconnected</div>
          <button onclick="location.reload()" style="padding:8px 20px;background:var(--accent,#6366f1);border:none;border-radius:8px;color:#fff;cursor:pointer">Back to Hub</button>
        </div>`;
    });

    mp.on('game_over', (msg) => {
      _oppScore = msg.score ?? _oppScore;
      if (!_gameOver) _showResult();
    });

    mp.on('sf_state', (msg) => {
      if (!msg.started) return;
      _oppInfo = msg.opponent;
      _initState(msg.seq, 0);
      _myTurn = msg.your_turn;
      _oppGrid = msg.opponent?.grid || null;
      _oppScore = msg.opponent?.score || 0;
      _startTimer(); _updateStatus(); _render();
      if (!_myTurn) _showOpponentGrid(); else _showMyGrid();
    });

    // Signal ready
    mp.send({ type: 'sf_ready' });
  }

  function _opp() { return mp.players().find(p => p.id !== mp.youId()) || null; }

  mp.registerGame({ id: 'sudofall', name: 'Sudofall', renderSetup, renderGame });
})();
