const _gh18n = {
  en: {
    title:'Game Hub', players:'Players', sessions:'Sessions', leaderboard:'Leaderboard',
    add_player:'+ Add player', edit:'Edit', del:'Delete', del_confirm:'Delete this player?',
    username:'Username', display_name:'Display name', avatar_color:'Color',
    password:'Password', password_edit:'New password (leave blank to keep)',
    save:'Save', cancel:'Cancel', no_players:'No players yet.',
    no_sessions:'No sessions recorded yet.', no_stats:'No stats yet.',
    played:'played', wins:'wins', best:'best', avg:'avg',
    vs:'vs', winner:'Winner', guests:'guests',
    duration:'Duration', game:'Game', score:'Score',
    username_taken:'Username already taken.',
    sec:'s', min:'m',
    fav_login_required:'Log in to Game Hub to use favourites.',
    fav_find_player:'Find a player',
    fav_search_ph:'Search by name or username…',
    fav_no_players_found:'No players found.',
    fav_saved_header:'Saved favourites',
    fav_none_yet:"No favourites yet. Add favourites in Apps Hub.",
    fav_profile_btn:'Profile',
    fav_saved:'★ Saved',
    fav_favourite:'☆ Favourite',
    fav_login_first:'Log in to GH first',
    prof_game_label:'Game:',
    prof_all_games:'All games',
    set_my_avatar:'My Avatar',
    set_edit_avatar:'Edit Avatar',
    set_direct_link:'Direct link (no domain mapping needed):',
    set_open_link:'Open ↗',
    set_domain_hint:'For a cleaner URL, map a domain or subpath to this app in mvmOS Domains settings.',
    password_required:'Password required',
    error:'Error',
    prof_no_shared:'No shared sessions.',
    prof_head_to_head:'Head to Head',
  },
  bg: {
    title:'Game Hub', players:'Играчи', sessions:'Сесии', leaderboard:'Класация',
    add_player:'+ Добави играч', edit:'Редактирай', del:'Изтрий', del_confirm:'Изтриване на играча?',
    username:'Потребителско Ime', display_name:'Показвано Ime', avatar_color:'Цвят',
    password:'Парола', password_edit:'Нова парола (остави празно за без промяна)',
    save:'Запази', cancel:'Отказ', no_players:'Няма играчи.',
    no_sessions:'Няма записани сесии.', no_stats:'Няма статистики.',
    played:'изиграни', wins:'победи', best:'най-добър', avg:'средно',
    vs:'срещу', winner:'Победител', guests:'гости',
    duration:'Продължителност', game:'Игра', score:'Резултат',
    username_taken:'Потребителското ime вече съществува.',
    sec:'с', min:'м',
    fav_login_required:'Влез в Game Hub, за да ползваш любими.',
    fav_find_player:'Намери играч',
    fav_search_ph:'Търсене по име или потребителско име…',
    fav_no_players_found:'Няма намерени играчи.',
    fav_saved_header:'Запазени любими',
    fav_none_yet:'Все още няма любими. Добави любими от Apps Hub.',
    fav_profile_btn:'Профил',
    fav_saved:'★ Запазен',
    fav_favourite:'☆ Любим',
    fav_login_first:'Първо влез в GH',
    prof_game_label:'Игра:',
    prof_all_games:'Всички игри',
    set_my_avatar:'Моят аватар',
    set_edit_avatar:'Редактирай аватар',
    set_direct_link:'Директен линк (не изисква мапване на домейн):',
    set_open_link:'Отвори ↗',
    set_domain_hint:'За по-чист URL, мапни домейн или подпът към това приложение в Настройки → Домейни на mvmOS.',
    password_required:'Изисква се парола',
    error:'Грешка',
    prof_no_shared:'Няма общи сесии.',
    prof_head_to_head:'Един срещу друг',
  },
};
function _ght(k) { const l=window.mvmOS?.lang||'en'; return (_gh18n[l]||_gh18n.en)[k]||k; }

const _GH_COLORS = ['#89b4fa','#a6e3a1','#f38ba8','#fab387','#f9e2af','#cba6f7','#94e2d5','#f5c2e7','#74c7ec','#eba0ac'];

mvmOS.registerApp({
  id: 'gamehub',
  name: _ght('title'),
  icon: '🎮',
  category: 'Games',

  launch() {
    mvmOS.createWindow({
      id: 'gamehub',
      title: '🎮 ' + _ght('title'),
      width: 860,
      height: 580,
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:var(--font,sans-serif);background:var(--bg);color:var(--fg)';

        const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        const btn = (bg) => `padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:13px;background:${bg||'var(--surface2)'};color:${bg?'#fff':'var(--fg)'}`;
        const inp = (w) => `padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--fg);font-size:13px;${w?'width:'+w+';':'width:100%;'}box-sizing:border-box`;
        const fld = (label,inner) => `<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--fg2)">${label}${inner}</label>`;
        const fmtDur = s => !s?'—':s<60?s+_ght('sec'):Math.floor(s/60)+_ght('min')+(s%60?s%60+_ght('sec'):'');
        const fmtDate = s => new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});

        let tab = 'games', stats = null;
        let _ghMe = null; // logged-in GH player for favourites

        // ── shell ───────────────────────────────────────────────
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
            <span style="font-weight:700;font-size:15px">🎮 ${_ght('title')}</span>
            <div style="flex:1"></div>
            <div id="gh-me-avatar" style="cursor:default;flex-shrink:0"></div>
            ${['games','favourites'].map(t=>`<button id="gh-t-${t}" style="${btn()}">${t==='games'?'Games':'Favourites'}</button>`).join('')}
            <button id="gh-t-settings" style="${btn()}" title="Settings">⚙</button>
          </div>
          <div id="gh-body" style="flex:1;overflow-y:auto;padding:14px"></div>
        `;

        ['games','favourites','settings'].forEach(t => {
          body.querySelector(`#gh-t-${t}`).onclick = () => { tab=t; renderTabs(); render(); };
        });

        function renderTabs() {
          ['games','favourites','settings'].forEach(t => {
            const b = body.querySelector(`#gh-t-${t}`); if(!b) return;
            b.style.background = tab===t ? 'var(--accent)' : 'var(--surface2)';
            b.style.color      = tab===t ? '#fff' : 'var(--fg)';
          });
        }

        // Load GH widget silently to get current player for favourites
        function _renderGhMeAvatar() {
          const el = body.querySelector('#gh-me-avatar');
          if (!el) return;
          if (_ghMe) {
            _avatarReady.then(() => {
              el.innerHTML = window.GHAvatar ? window.GHAvatar.renderAvatar(_ghMe, 28) : `<div style="width:28px;height:28px;border-radius:50%;background:${_ghMe.avatar_color||'#89b4fa'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${(_ghMe.display_name||'?')[0].toUpperCase()}</div>`;
              el.title = _ghMe.display_name || '';
            });
          } else {
            el.innerHTML = '';
          }
        }

        (function() {
          if (window.GameHub) { window.GameHub.init().then(() => { _ghMe = window.GameHub.currentPlayer(); _renderGhMeAvatar(); }); return; }
          const s = document.createElement('script');
          s.src = `/apps/gamehub/widget.js?_=${Date.now()}`;
          s.onload = () => window.GameHub?.init().then(() => { _ghMe = window.GameHub.currentPlayer(); _renderGhMeAvatar(); });
          document.head.appendChild(s);
        })();

        // Load avatar renderer
        const _avatarReady = new Promise(resolve => {
          if (window.GHAvatar) { resolve(); return; }
          const s = document.createElement('script');
          s.src = `/apps/gamehub/avatar.js?_=${Date.now()}`;
          s.onload = resolve;
          document.head.appendChild(s);
        });

        async function reload() {
          const [sr] = await Promise.all([
            fetch('/api/gamehub/stats'),
            _avatarReady,
          ]);
          stats   = sr.ok ? await sr.json() : null;
          _ghFavs = null; // reset cache so favourites tab reloads fresh
          render();
        }

        function render() {
          renderTabs();
          if(tab==='games')           renderGames();
          else if(tab==='favourites') renderFavourites();
          else if(tab==='settings')   renderSettings();
        }

        // ── Player profile overlay (read-only) ─────────────────
        // ── Favourites (read-only) ──────────────────────────────
        // Favourites are managed in Apps Hub; Game Hub only displays them.
        let _ghFavs = null; // cache: array of player objects, null = not loaded

        function _ghToken() { return localStorage.getItem('gh_token') || ''; }
        function _ghIsLoggedIn() { return !!(_ghMe || window.GameHub?.currentPlayer()); }

        async function _ghLoadFavs() {
          if (!_ghIsLoggedIn()) { _ghFavs = []; return; }
          const r = await fetch('/api/pub/gamehub/favourites', {headers:{'X-GH-Token':_ghToken()}});
          _ghFavs = r.ok ? await r.json() : [];
        }

        function showPlayerProfile(p) {
          const me = _ghMe || window.GameHub?.currentPlayer();
          const allSessions = (stats?.recent||[]).filter(s => s.players.some(sp=>sp.player_id===p.id));
          const sharedWithMe = me ? allSessions.filter(s =>
            s.mode === 'multiplayer' &&
            s.players.some(sp=>sp.player_id===me.id) &&
            s.players.some(sp=>sp.player_id===p.id)
          ) : [];
          const hasVs = me && me.id !== p.id && sharedWithMe.length > 0;
          const games = [...new Set(allSessions.map(s=>s.game_id))].sort();
          const vsGames = [...new Set(sharedWithMe.map(s=>s.game_id))].sort();

          let vsMode = false;

          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
          overlay.innerHTML = `
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;width:100%;max-width:460px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:8px;padding:16px;border-bottom:1px solid var(--border);flex-shrink:0">
                ${window.GHAvatar ? window.GHAvatar.renderAvatar(p, 48) : `<div style="width:48px;height:48px;border-radius:50%;background:${esc(p.avatar_color)};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;color:#1e1e2e;flex-shrink:0">${esc(p.display_name[0]?.toUpperCase()||'?')}</div>`}
                <div style="flex:1">
                  <div style="font-weight:700;font-size:16px">${esc(p.display_name)}</div>
                  <div style="font-size:12px;color:var(--fg2)">@${esc(p.username)}</div>
                </div>
                ${hasVs ? `<button id="gh-prof-vs-btn" style="${btn()};padding:5px 10px;font-size:12px">⚔️ vs</button>` : ''}
                <button id="gh-prof-close" style="${btn()};padding:4px 10px;font-size:16px;line-height:1">✕</button>
              </div>
              <div id="gh-prof-filter" style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;color:var(--fg2)">${_ght('prof_game_label')}</span>
                <select id="gh-prof-game" style="${inp('auto')};flex:1">
                  <option value="">${_ght('prof_all_games')}</option>
                </select>
              </div>
              <div id="gh-prof-stats" style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0"></div>
              <div style="padding:14px;display:flex;flex-direction:column;gap:6px" id="gh-prof-sessions"></div>
            </div>`;

          body.appendChild(overlay);
          overlay.querySelector('#gh-prof-close').onclick = () => overlay.remove();
          overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });

          const vsBtn = overlay.querySelector('#gh-prof-vs-btn');
          if (vsBtn) vsBtn.onclick = () => {
            vsMode = !vsMode;
            vsBtn.style.background = vsMode ? 'var(--accent)' : 'var(--surface2)';
            vsBtn.style.color = vsMode ? '#fff' : 'var(--fg)';
            render();
          };

          const sel = overlay.querySelector('#gh-prof-game');

          function render() {
            const gameFilter = sel.value;
            // Rebuild game options based on mode
            const gameList = vsMode ? vsGames : games;
            sel.innerHTML = `<option value="">${_ght('prof_all_games')}</option>` +
              gameList.map(g => `<option value="${esc(g)}"${sel.value===g?' selected':''}>${esc(stats?.game_meta?.[g]?.name||g)}</option>`).join('');
            overlay.querySelector('#gh-prof-filter').style.display = gameList.length > 1 ? '' : 'none';
            if (vsMode) renderVs(sel.value);
            else        renderNormal(sel.value);
          }

          function renderNormal(gameFilter) {
            const filteredSessions = gameFilter
              ? allSessions.filter(s=>s.game_id===gameFilter)
              : allSessions;
            const pstats = stats?.leaderboard
              ? (gameFilter
                  ? (stats.leaderboard[gameFilter]||[]).filter(s=>s.player_id===p.id)
                  : Object.values(stats.leaderboard).flat().filter(s=>s.player_id===p.id))
              : [];
            const totalPlayed = pstats.reduce((a,s)=>a+(s.played||0),0);
            const totalWins   = pstats.reduce((a,s)=>a+(s.wins||0),0);
            const statsCols = [
              [totalPlayed, _ght('played')],
              [totalWins,   _ght('wins')],
              [filteredSessions.length, _ght('sessions')],
            ];
            if (gameFilter) {
              const bestScore = pstats.reduce((a,s)=>Math.max(a,s.best_score||0),0);
              statsCols.push([bestScore||'—', _ght('best')]);
            }
            overlay.querySelector('#gh-prof-stats').innerHTML = statsCols.map(([v,l], i) => `
              <div style="flex:1;text-align:center;padding:12px 8px;${i<statsCols.length-1?'border-right:1px solid var(--border)':''}">
                <div style="font-size:20px;font-weight:700">${v}</div>
                <div style="font-size:11px;color:var(--fg2);margin-top:2px">${l}</div>
              </div>`).join('');

            const sc = overlay.querySelector('#gh-prof-sessions');
            sc.innerHTML = '';
            if (!filteredSessions.length) {
              sc.innerHTML = `<div style="color:var(--fg2);text-align:center;padding:20px">${_ght('no_sessions')}</div>`;
              return;
            }
            filteredSessions.forEach(s => {
              let meta = {};
              try { meta = JSON.parse(s.metadata||'{}'); } catch(_) {}
              const metaParts = [];
              if(meta.rounds!=null)         metaParts.push(`${meta.rounds} rounds`);
              if(meta.time_per_round!=null) metaParts.push(meta.time_per_round===0?'no limit':fmtDur(meta.time_per_round)+'/round');
              const modeLabel = s.mode==='singleplayer'?'👤':'👥';
              const myResult  = s.players.find(sp=>sp.player_id===p.id);
              const row = document.createElement('div');
              row.style.cssText = 'background:var(--surface1);border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:background .15s';
              row.onmouseenter = ()=>row.style.background='var(--surface2)';
              row.onmouseleave = ()=>row.style.background='var(--surface1)';
              row.innerHTML = `
                <div style="font-size:18px">🎮</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${!gameFilter?esc(s.game_id)+' ':''}${modeLabel}</div>
                  ${metaParts.length?`<div style="font-size:11px;color:var(--fg2)">${metaParts.join(' · ')}</div>`:''}
                </div>
                <div style="text-align:right;flex-shrink:0">
                  ${myResult?.score!=null?`<div style="font-weight:700;font-size:14px">${myResult.score} pts</div>`:''}
                  ${myResult?.is_winner?`<div style="font-size:11px;color:#a6e3a1">🏆</div>`:''}
                  <div style="font-size:11px;color:var(--fg2)">${fmtDate(s.played_at)}</div>
                </div>`;
              row.addEventListener('click', () => showSessionDetail(s));
              sc.appendChild(row);
            });
          }

          function renderVs(gameFilter) {
            const filtered = gameFilter
              ? sharedWithMe.filter(s=>s.game_id===gameFilter)
              : sharedWithMe;

            let myWins = 0, theirWins = 0;
            filtered.forEach(s => {
              if (s.players.find(sp=>sp.player_id===me.id)?.is_winner) myWins++;
              if (s.players.find(sp=>sp.player_id===p.id)?.is_winner)  theirWins++;
            });

            overlay.querySelector('#gh-prof-stats').innerHTML = `
              <div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid var(--border)">
                <div style="font-size:24px;font-weight:800;color:var(--accent)">${myWins}</div>
                <div style="font-size:11px;color:var(--fg2);margin-top:2px">${esc(me.display_name)}</div>
              </div>
              <div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 14px;border-right:1px solid var(--border)">
                <div style="font-size:11px;color:var(--fg2);font-weight:600">vs</div>
                <div style="font-size:11px;color:var(--fg2);margin-top:4px">${filtered.length} game${filtered.length!==1?'s':''}</div>
              </div>
              <div style="flex:1;text-align:center;padding:12px 8px">
                <div style="font-size:24px;font-weight:800">${theirWins}</div>
                <div style="font-size:11px;color:var(--fg2);margin-top:2px">${esc(p.display_name)}</div>
              </div>`;

            const sc = overlay.querySelector('#gh-prof-sessions');
            sc.innerHTML = '';
            if (!filtered.length) {
              sc.innerHTML = `<div style="color:var(--fg2);text-align:center;padding:20px">${_ght('prof_no_shared')}</div>`;
              return;
            }
            filtered.forEach(s => {
              let meta = {}; try { meta = JSON.parse(s.metadata||'{}'); } catch(_) {}
              const metaParts = [];
              if(meta.rounds!=null)         metaParts.push(`${meta.rounds} rounds`);
              if(meta.time_per_round!=null) metaParts.push(meta.time_per_round===0?'no limit':fmtDur(meta.time_per_round)+'/round');
              const myP    = s.players.find(sp=>sp.player_id===me.id);
              const theirP = s.players.find(sp=>sp.player_id===p.id);
              const { name: gameName } = stats?.game_meta?.[s.game_id] || {};
              const row = document.createElement('div');
              row.style.cssText = 'background:var(--surface1);border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:background .15s';
              row.onmouseenter = ()=>row.style.background='var(--surface2)';
              row.onmouseleave = ()=>row.style.background='var(--surface1)';
              row.innerHTML = `
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600;color:var(--fg2)">${esc(gameName||s.game_id)} · ${fmtDate(s.played_at)}</div>
                  ${metaParts.length?`<div style="font-size:11px;color:var(--fg2)">${metaParts.join(' · ')}</div>`:''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <div style="text-align:center;min-width:52px">
                    <div style="font-size:15px;font-weight:700;color:var(--accent)">${myP?.score??'—'}</div>
                    <div style="font-size:10px;color:var(--fg2)">${esc(me.display_name)}${myP?.is_winner?' 🏆':''}</div>
                  </div>
                  <div style="font-size:11px;color:var(--fg2)">:</div>
                  <div style="text-align:center;min-width:52px">
                    <div style="font-size:15px;font-weight:700">${theirP?.score??'—'}</div>
                    <div style="font-size:10px;color:var(--fg2)">${esc(p.display_name)}${theirP?.is_winner?' 🏆':''}</div>
                  </div>
                </div>`;
              row.addEventListener('click', () => showSessionDetail(s));
              sc.appendChild(row);
            });
          }

          sel.addEventListener('change', render);
          render();
        }

        // ── Session detail overlay ──────────────────────────────
        function showSessionDetail(s) {
          let meta = {};
          try { meta = JSON.parse(s.metadata || '{}'); } catch(_) {}
          const modeLabel = s.mode === 'singleplayer' ? '👤 Single player' : '👥 Multiplayer';
          const sorted = s.players.slice().sort((a,b) => (b.score||0) - (a.score||0));
          const winner = sorted.find(p => p.is_winner);

          const metaRows = [];
          if (meta.rounds != null)         metaRows.push(['Rounds', meta.rounds]);
          if (meta.time_per_round != null) metaRows.push(['Time / round', meta.time_per_round === 0 ? 'No limit' : fmtDur(meta.time_per_round)]);
          if (s.duration_seconds)          metaRows.push(['Total time', fmtDur(s.duration_seconds)]);
          metaRows.push(['Mode', modeLabel]);
          metaRows.push(['Date', fmtDate(s.played_at)]);

          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

          const box = document.createElement('div');
          box.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:12px;width:100%;max-width:420px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:0';
          box.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
              <span style="font-size:22px">🎮</span>
              <div style="flex:1">
                <div style="font-weight:700;font-size:15px">${esc(s.game_id)}</div>
                <div style="font-size:12px;color:var(--fg2)">${modeLabel}</div>
              </div>
              <button id="gh-det-close" style="${btn()};padding:4px 10px;font-size:16px;line-height:1">✕</button>
            </div>
            <div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                ${metaRows.map(([k,v]) => `
                  <tr>
                    <td style="color:var(--fg2);padding:3px 0;width:46%">${esc(String(k))}</td>
                    <td style="font-weight:600;padding:3px 0">${esc(String(v))}</td>
                  </tr>`).join('')}
              </table>
              <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--fg2);margin-bottom:8px">Players</div>
                <div id="gh-det-players"></div>
              </div>
            </div>`;

          const playersEl = box.querySelector('#gh-det-players');
          sorted.forEach((p, i) => {
            const name  = p.display_name || p.guest_name || '?';
            const color = p.avatar_color || '#585b70';
            const isWin = p.is_winner;
            const isClickable = !!p.player_id;
            const fullPlayer = p.player_id ? ((stats?.players||[]).find(pl=>pl.id===p.player_id) || p) : p;
            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;margin-bottom:4px;background:${isWin?'rgba(166,227,161,.12)':'var(--surface1)'};${isWin?'outline:1px solid rgba(166,227,161,.4)':''}${isClickable?';cursor:pointer':''}`;
            if (isClickable) {
              row.onmouseenter = () => row.style.opacity = '.8';
              row.onmouseleave = () => row.style.opacity = '1';
              row.onclick = () => { showPlayerProfile(fullPlayer); };
            }
            row.innerHTML = `
              <span style="font-size:13px;color:var(--fg2);min-width:18px;text-align:right">${i+1}.</span>
              ${window.GHAvatar ? window.GHAvatar.renderAvatar(fullPlayer, 28) : `<span style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#1e1e2e;flex-shrink:0">${esc((name[0]||'?').toUpperCase())}</span>`}
              <span style="flex:1;font-weight:600;font-size:13px">${esc(name)}${!p.player_id?' <span style="font-size:10px;color:var(--fg2)">(guest)</span>':' <span style="font-size:10px;color:var(--fg2)">›</span>'}</span>
              ${p.score!=null?`<span style="font-weight:700;font-size:15px">${p.score}</span>`:''}
              ${isWin?`<span style="font-size:14px" title="Winner">🏆</span>`:''}`;
            playersEl.appendChild(row);
          });

          overlay.appendChild(box);
          body.appendChild(overlay);
          box.querySelector('#gh-det-close').onclick = () => overlay.remove();
          overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        }

        // ── Games tab ───────────────────────────────────────────
        function _gameMeta(gameId) {
          const m = stats?.game_meta?.[gameId];
          return { name: m?.name || gameId, icon: m?.icon || '🎮' };
        }

        function renderGames() {
          const c = body.querySelector('#gh-body');
          if(!stats?.games?.length) { c.innerHTML=`<div style="color:var(--fg2);text-align:center;margin-top:30px">${_ght('no_stats')}</div>`; return; }
          c.innerHTML = '';
          stats.games.forEach(gameId => {
            const lb   = stats.leaderboard[gameId] || [];
            const sess = (stats.recent||[]).filter(s=>s.game_id===gameId);
            const { name, icon } = _gameMeta(gameId);
            const card = document.createElement('div');
            card.style.cssText = 'background:var(--surface1);border-radius:10px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:background .15s;display:flex;align-items:center;gap:14px';
            card.onmouseenter = () => card.style.background = 'var(--surface2)';
            card.onmouseleave = () => card.style.background = 'var(--surface1)';
            const top3 = lb.slice(0,3).map(r=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:${esc(r.avatar_color)};display:inline-block"></span>${esc(r.display_name)}</span>`).join('<span style="color:var(--fg2);padding:0 3px">·</span>');
            card.innerHTML = `
              <div style="font-size:28px">${icon}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:15px">${esc(name)}</div>
                <div style="font-size:12px;color:var(--fg2);margin-top:3px">${sess.length} sessions · ${lb.length} players</div>
                ${top3 ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">${top3}</div>` : ''}
              </div>
              <div style="font-size:18px;color:var(--fg2)">›</div>`;
            card.addEventListener('click', () => renderGameDetail(gameId));
            c.appendChild(card);
          });
        }

        function renderGameDetail(gameId) {
          const c = body.querySelector('#gh-body');
          const { name, icon } = _gameMeta(gameId);
          c.innerHTML = '';

          const back = document.createElement('button');
          back.style.cssText = `${btn()};margin-bottom:14px;display:inline-flex;align-items:center;gap:6px`;
          back.innerHTML = '‹ Games';
          back.onclick = () => renderGames();
          c.appendChild(back);

          const title = document.createElement('div');
          title.style.cssText = 'font-weight:700;font-size:17px;margin-bottom:14px;display:flex;align-items:center;gap:8px';
          title.innerHTML = `<span>${icon}</span><span>${esc(name)}</span>`;
          c.appendChild(title);

          // Sessions
          const sessHead = document.createElement('div');
          sessHead.style.cssText = 'font-weight:600;font-size:13px;color:var(--accent);margin-bottom:8px';
          sessHead.textContent = 'Sessions';
          c.appendChild(sessHead);

          const sess = (stats.recent||[]).filter(s=>s.game_id===gameId);
          if(!sess.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:var(--fg2);font-size:13px;margin-bottom:18px';
            empty.textContent = _ght('no_sessions');
            c.appendChild(empty);
          } else {
            sess.forEach(s => {
              const row = document.createElement('div');
              row.style.cssText = 'background:var(--surface1);border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:background .15s';
              row.onmouseenter = () => row.style.background = 'var(--surface2)';
              row.onmouseleave = () => row.style.background = 'var(--surface1)';
              const pnames = s.players.map(p => {
                const name = p.display_name || p.guest_name || '?';
                const color = p.avatar_color || '#585b70';
                return `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>${esc(name)}${p.score!=null?` <span style="color:var(--fg2);font-size:11px">(${p.score})</span>`:''}</span>`;
              }).join('<span style="color:var(--fg2);padding:0 4px">·</span>');
              let meta = {};
              try { meta = JSON.parse(s.metadata || '{}'); } catch(_) {}
              const metaParts = [];
              if (meta.rounds != null)         metaParts.push(`${meta.rounds} rounds`);
              if (meta.time_per_round != null) metaParts.push(meta.time_per_round === 0 ? 'no limit' : fmtDur(meta.time_per_round) + '/round');
              const modeLabel = s.mode === 'singleplayer' ? '👤' : '👥';
              row.innerHTML = `
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${modeLabel} ${fmtDate(s.played_at)}${s.duration_seconds?' · '+fmtDur(s.duration_seconds):''}</div>
                  ${metaParts.length ? `<div style="font-size:11px;color:var(--fg2);margin-top:1px">${metaParts.join(' · ')}</div>` : ''}
                  <div style="font-size:12px;color:var(--fg2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pnames}</div>
                </div>
                <div style="font-size:10px;color:var(--fg2)">›</div>`;
              row.addEventListener('click', () => showSessionDetail(s));
              c.appendChild(row);
            });
          }

          // Leaderboard
          const lb = stats.leaderboard[gameId] || [];
          const lbHead = document.createElement('div');
          lbHead.style.cssText = 'font-weight:600;font-size:13px;color:var(--accent);margin-top:10px;margin-bottom:8px';
          lbHead.textContent = 'Leaderboard';
          c.appendChild(lbHead);

          if(!lb.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:var(--fg2);font-size:13px';
            empty.textContent = _ght('no_stats');
            c.appendChild(empty);
          } else {
            const tbl = document.createElement('table');
            tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
            tbl.innerHTML = `<thead><tr style="color:var(--fg2);font-size:11px;text-align:left">
              <th style="padding:4px 8px">#</th>
              <th style="padding:4px 8px">${_ght('display_name')}</th>
              <th style="padding:4px 8px;text-align:right">${_ght('played')}</th>
              <th style="padding:4px 8px;text-align:right">${_ght('wins')}</th>
              <th style="padding:4px 8px;text-align:right">${_ght('best')}</th>
              <th style="padding:4px 8px;text-align:right">${_ght('avg')}</th>
            </tr></thead>`;
            const tbody = document.createElement('tbody');
            lb.forEach((r,i) => {
              const tr = document.createElement('tr');
              tr.style.cssText = `background:${i%2?'var(--surface1)':'transparent'};cursor:pointer`;
              tr.innerHTML = `
                <td style="padding:5px 8px;color:var(--fg2)">${i+1}</td>
                <td style="padding:5px 8px">
                  <span style="display:inline-flex;align-items:center;gap:6px">
                    <span style="width:10px;height:10px;border-radius:50%;background:${esc(r.avatar_color)};display:inline-block"></span>
                    ${esc(r.display_name)} <span style="font-size:10px;color:var(--fg2)">›</span>
                  </span>
                </td>
                <td style="padding:5px 8px;text-align:right">${r.played}</td>
                <td style="padding:5px 8px;text-align:right;color:var(--accent)">${r.wins}</td>
                <td style="padding:5px 8px;text-align:right">${r.best_score!=null?Math.round(r.best_score*10)/10:'—'}</td>
                <td style="padding:5px 8px;text-align:right;color:var(--fg2)">${r.avg_score!=null?Math.round(r.avg_score*10)/10:'—'}</td>`;
              tr.onmouseenter = () => tr.style.opacity = '.75';
              tr.onmouseleave = () => tr.style.opacity = '1';
              tr.onclick = () => {
                const full = (stats?.players||[]).find(pl=>pl.id===r.player_id) || r;
                showPlayerProfile(full);
              };
              tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            c.appendChild(tbl);
          }

          // Head to head for this game
          const gameSess = sess.map(s=>s.id);
          const h2h = (stats.head2head||[]).filter(r => {
            const playerMap = Object.fromEntries((stats.players||[]).map(p=>[p.id,p]));
            return playerMap[r.p1] && playerMap[r.p2];
          });
          if(h2h.length) {
            const playerMap = Object.fromEntries((stats.players||[]).map(p=>[p.id,p]));
            const h2hInGame = h2h.filter(r => {
              const gamePlayerIds = new Set(sess.flatMap(s=>s.players.filter(p=>p.player_id).map(p=>p.player_id)));
              return gamePlayerIds.has(r.p1) && gamePlayerIds.has(r.p2);
            });
            if(h2hInGame.length) {
              const sec = document.createElement('div');
              sec.style.marginTop = '16px';
              sec.innerHTML = `<div style="font-weight:600;font-size:13px;color:var(--accent);margin-bottom:8px">${_ght('prof_head_to_head')}</div>`;
              h2hInGame.forEach(r => {
                const p1 = playerMap[r.p1], p2 = playerMap[r.p2];
                if(!p1||!p2) return;
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)';
                row.innerHTML = `
                  <span style="display:inline-flex;align-items:center;gap:4px;flex:1;justify-content:flex-end;font-size:13px">
                    <span style="width:9px;height:9px;border-radius:50%;background:${esc(p1.avatar_color)};display:inline-block"></span>
                    ${esc(p1.display_name)}
                  </span>
                  <span style="font-size:13px;font-weight:700;color:var(--accent);min-width:50px;text-align:center">${r.p1_wins} – ${r.p2_wins}</span>
                  <span style="display:inline-flex;align-items:center;gap:4px;flex:1;font-size:13px">
                    <span style="width:9px;height:9px;border-radius:50%;background:${esc(p2.avatar_color)};display:inline-block"></span>
                    ${esc(p2.display_name)}
                  </span>`;
                sec.appendChild(row);
              });
              c.appendChild(sec);
            }
          }
        }

        // ── Favourites tab (read-only display) ──────────────────
        async function renderFavourites() {
          const c = body.querySelector('#gh-body');
          c.innerHTML = '';

          if (!_ghIsLoggedIn()) {
            c.innerHTML = `<div style="color:var(--fg2);text-align:center;margin-top:40px;font-size:13px">${_ght('fav_login_required')}</div>`;
            return;
          }

          if (_ghFavs === null) await _ghLoadFavs();

          const divider = document.createElement('div');
          divider.innerHTML = `<div style="font-weight:600;font-size:12px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${_ght('fav_saved_header')}</div>`;
          c.appendChild(divider);

          const favsEl = document.createElement('div');
          favsEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';
          divider.appendChild(favsEl);

          if (!_ghFavs || !_ghFavs.length) {
            favsEl.innerHTML = `<div style="color:var(--fg2);font-size:13px">${_ght('fav_none_yet')}</div>`;
          } else {
            _ghFavs.forEach(f => favsEl.appendChild(_ghFavRow(f)));
          }
        }

        function _ghFavRow(p) {
          const row = document.createElement('div');
          row.style.cssText = 'background:var(--surface1);border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px;transition:background .12s';
          row.innerHTML = `
            ${window.GHAvatar ? window.GHAvatar.renderAvatar(p, 30) : `<div style="width:30px;height:30px;border-radius:50%;background:${esc(p.avatar_color||'#585b70')};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#1e1e2e;flex-shrink:0">${esc((p.display_name?.[0]||'?').toUpperCase())}</div>`}
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${esc(p.display_name||p.username||'?')}</div>
              <div style="font-size:11px;color:var(--fg2)">@${esc(p.username||'')}</div>
            </div>
            <button id="frow-prof" style="${btn()};padding:4px 10px;font-size:12px">${_ght('fav_profile_btn')}</button>`;
          row.querySelector('#frow-prof').onclick = () => showPlayerProfile(p);
          return row;
        }

        // ── Settings tab ────────────────────────────────────────
        function renderSettings() {
          const c = body.querySelector('#gh-body');
          c.innerHTML = `
            <div style="max-width:420px;display:flex;flex-direction:column;gap:20px">
              <div id="gh-set-publink">
                <div style="font-size:12px;color:var(--fg2);margin-bottom:8px">${_ght('set_direct_link')}</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <code style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--accent);user-select:all">/pub/gamehub/</code>
                  <button id="gh-set-open" style="${btn()};padding:5px 12px;font-size:12px">${_ght('set_open_link')}</button>
                </div>
                <div style="font-size:11px;color:var(--fg2);margin-top:6px">${_ght('set_domain_hint')}</div>
              </div>
            </div>`;

          c.querySelector('#gh-set-open')?.addEventListener('click', () => window.open('/pub/gamehub/', '_blank'));
        }

        reload();
      }
    });
  }
});
