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
    fav_none_yet:"No favourites yet. Search above or add from a player's profile.",
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
    fav_none_yet:'Все още няма любими. Търси отгоре или добави от профила на играч.',
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

        let tab = 'players', players = [], stats = null;
        let _ghMe = null; // logged-in GH player for favourites

        // ── shell ───────────────────────────────────────────────
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
            <span style="font-weight:700;font-size:15px">🎮 ${_ght('title')}</span>
            <div style="flex:1"></div>
            <div id="gh-me-avatar" style="cursor:default;flex-shrink:0"></div>
            ${['players','games','favourites'].map(t=>`<button id="gh-t-${t}" style="${btn()}">${t==='games'?'Games':t==='favourites'?'Favourites':_ght(t)}</button>`).join('')}
            <button id="gh-t-settings" style="${btn()}" title="Settings">⚙</button>
          </div>
          <div id="gh-body" style="flex:1;overflow-y:auto;padding:14px"></div>
        `;

        ['players','games','favourites','settings'].forEach(t => {
          body.querySelector(`#gh-t-${t}`).onclick = () => { tab=t; renderTabs(); render(); };
        });

        function renderTabs() {
          ['players','games','favourites','settings'].forEach(t => {
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
          const [pr, sr] = await Promise.all([
            fetch('/api/gamehub/players'),
            fetch('/api/gamehub/stats'),
            _avatarReady,
          ]);
          players = pr.ok ? await pr.json() : [];
          stats   = sr.ok ? await sr.json() : null;
          _ghFavs = null; // reset cache so favourites tab reloads fresh
          render();
        }

        function render() {
          renderTabs();
          if(tab==='players')         renderPlayers();
          else if(tab==='games')      renderGames();
          else if(tab==='favourites') renderFavourites();
          else if(tab==='settings')   renderSettings();
        }

        // ── Players tab ─────────────────────────────────────────
        function renderPlayers() {
          const c = body.querySelector('#gh-body');
          c.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button id="gh-add" style="${btn('var(--accent)')}">${_ght('add_player')}</button></div>`;
          if(!players.length) { c.innerHTML += `<div style="color:var(--fg2);text-align:center;margin-top:30px">${_ght('no_players')}</div>`; }
          else {
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px';
            players.forEach(p => {
              const card = document.createElement('div');
              card.style.cssText = 'background:var(--surface1);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:background .15s';
              card.onmouseenter = () => card.style.background = 'var(--surface2)';
              card.onmouseleave = () => card.style.background = 'var(--surface1)';
              card.addEventListener('click', e => { if(!e.target.closest('button')) showPlayerProfile(p); });
              const pstats = stats?.leaderboard ? Object.values(stats.leaderboard).flat().filter(s=>s.player_id===p.id) : [];
              const totalPlayed = pstats.reduce((a,s)=>a+(s.played||0),0);
              const totalWins   = pstats.reduce((a,s)=>a+(s.wins||0),0);
              card.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px">
                  ${window.GHAvatar ? window.GHAvatar.renderAvatar(p, 36) : `<div style="width:36px;height:36px;border-radius:50%;background:${esc(p.avatar_color)};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#1e1e2e;flex-shrink:0">${esc(p.display_name[0]?.toUpperCase()||'?')}</div>`}
                  <div>
                    <div style="font-weight:600;font-size:14px">${esc(p.display_name)}</div>
                    <div style="font-size:11px;color:var(--fg2)">@${esc(p.username)}</div>
                  </div>
                </div>
                <div style="font-size:12px;color:var(--fg2)">${totalPlayed} ${_ght('played')} · ${totalWins} ${_ght('wins')}</div>
                <div style="display:flex;gap:6px">
                  <button class="gh-edit" data-id="${p.id}" style="${btn()};flex:1;font-size:12px">${_ght('edit')}</button>
                  <button class="gh-del"  data-id="${p.id}" style="${btn('#f38ba8')};font-size:12px">${_ght('del')}</button>
                </div>`;
              grid.appendChild(card);
            });
            c.appendChild(grid);
          }
          c.querySelector('#gh-add').onclick = () => showPlayerModal(null);
          c.querySelectorAll('.gh-edit').forEach(b => b.onclick = () => showPlayerModal(players.find(p=>p.id===b.dataset.id)));
          c.querySelectorAll('.gh-del').forEach(b => b.onclick = async () => {
            if(!confirm(_ght('del_confirm'))) return;
            await fetch(`/api/gamehub/players/${b.dataset.id}`,{method:'DELETE'});
            reload();
          });
        }

        // ── Player profile overlay ─────────────────────────────
        // ── Favourites helpers (admin UI) ───────────────────────
        let _ghFavs = null; // cache: array of player objects, null = not loaded

        function _ghToken() { return localStorage.getItem('gh_token') || ''; }
        function _ghIsLoggedIn() { return !!(_ghMe || window.GameHub?.currentPlayer()); }

        async function _ghLoadFavs() {
          if (!_ghIsLoggedIn()) { _ghFavs = []; return; }
          const r = await fetch('/api/pub/gamehub/favourites', {headers:{'X-GH-Token':_ghToken()}});
          _ghFavs = r.ok ? await r.json() : [];
        }

        function _ghIsFav(pid) {
          return !!(_ghFavs && _ghFavs.some(f => f.id === pid));
        }

        async function _ghToggleFav(p) {
          if (!_ghIsLoggedIn()) return;
          const isFav = _ghIsFav(p.id);
          const method = isFav ? 'DELETE' : 'POST';
          await fetch(`/api/pub/gamehub/favourites/${p.id}`, {method, headers:{'X-GH-Token':_ghToken()}});
          if (isFav) {
            _ghFavs = (_ghFavs || []).filter(f => f.id !== p.id);
          } else {
            _ghFavs = [p, ...(_ghFavs || []).filter(f => f.id !== p.id)];
          }
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
                <button id="gh-prof-fav" style="${btn()};padding:5px 10px;font-size:12px">${_ghIsFav(p.id)?_ght('fav_saved'):_ght('fav_favourite')}</button>
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

          const favBtn = overlay.querySelector('#gh-prof-fav');
          favBtn.onclick = async () => {
            if (!_ghIsLoggedIn()) { favBtn.textContent = _ght('fav_login_first'); setTimeout(()=>{ favBtn.textContent = _ghIsFav(p.id)?_ght('fav_saved'):_ght('fav_favourite'); }, 2000); return; }
            await _ghToggleFav(p);
            favBtn.textContent = _ghIsFav(p.id) ? _ght('fav_saved') : _ght('fav_favourite');
          };

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

        // ── Player modal ────────────────────────────────────────
        function showPlayerModal(player) {
          const isNew = !player;
          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999';
          const box = document.createElement('div');
          box.style.cssText = 'background:var(--surface1);border-radius:10px;padding:20px;width:360px;max-width:95vw;display:flex;flex-direction:column;gap:12px';

          let selColor = player?.avatar_color || _GH_COLORS[players.length % _GH_COLORS.length];

          box.innerHTML = `
            <div style="font-weight:700;font-size:16px">${isNew?_ght('add_player'):_ght('edit')}</div>
            ${fld(_ght('display_name'),`<input id="gh-dname" value="${esc(player?.display_name||'')}" style="${inp()}">`)}
            ${fld(_ght('username'),`<input id="gh-uname" value="${esc(player?.username||'')}" style="${inp()}">`)  }
            ${fld(isNew ? _ght('password') : _ght('password_edit'), `<input id="gh-pass" type="password" placeholder="${esc(isNew ? '' : _ght('password_edit'))}" style="${inp()}">`)}
            <div>
              <div style="font-size:12px;color:var(--fg2);margin-bottom:6px">${_ght('avatar_color')}</div>
              <div id="gh-colors" style="display:flex;gap:6px;flex-wrap:wrap"></div>
            </div>
            <div id="gh-err" style="font-size:12px;color:#f38ba8;display:none"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="gh-cancel" style="${btn()}">${_ght('cancel')}</button>
              <button id="gh-save"   style="${btn('var(--accent)')}">${_ght('save')}</button>
            </div>`;

          const colorsEl = box.querySelector('#gh-colors');
          function renderColors() {
            colorsEl.innerHTML = '';
            _GH_COLORS.forEach(c => {
              const dot = document.createElement('div');
              dot.style.cssText = `width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===selColor?'#fff':'transparent'};transition:border .1s`;
              dot.onclick = () => { selColor=c; renderColors(); };
              colorsEl.appendChild(dot);
            });
          }
          renderColors();

          box.querySelector('#gh-cancel').onclick = () => ov.remove();
          box.querySelector('#gh-save').onclick = async () => {
            const dname = box.querySelector('#gh-dname').value.trim();
            const uname = box.querySelector('#gh-uname').value.trim();
            const pass  = box.querySelector('#gh-pass').value;
            if(!dname||!uname) return;
            if(isNew && !pass) { const err=box.querySelector('#gh-err'); err.textContent=_ght('password_required'); err.style.display='block'; return; }
            const payload = {username:uname, display_name:dname, avatar_color:selColor};
            if(pass) payload.password = pass;
            const url  = isNew ? '/api/gamehub/players' : `/api/gamehub/players/${player.id}`;
            const res  = await fetch(url,{method:isNew?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
            if(!res.ok) {
              const d = await res.json().catch(()=>({}));
              const err = box.querySelector('#gh-err');
              err.textContent = d.detail===`Username already exists` ? _ght('username_taken') : (d.detail||_ght('error'));
              err.style.display='block';
              return;
            }
            ov.remove(); reload();
          };
          ov.appendChild(box);
          ov.onclick = e => { if(e.target===ov) ov.remove(); };
          document.body.appendChild(ov);
          setTimeout(()=>box.querySelector('#gh-dname')?.focus(),50);
        }

        // ── Favourites tab ──────────────────────────────────────
        async function renderFavourites() {
          const c = body.querySelector('#gh-body');
          c.innerHTML = '';

          if (!_ghIsLoggedIn()) {
            c.innerHTML = `<div style="color:var(--fg2);text-align:center;margin-top:40px;font-size:13px">${_ght('fav_login_required')}</div>`;
            return;
          }

          if (_ghFavs === null) await _ghLoadFavs();

          // Search
          const searchWrap = document.createElement('div');
          searchWrap.style.cssText = 'margin-bottom:18px';
          searchWrap.innerHTML = `
            <div style="font-weight:600;font-size:12px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${_ght('fav_find_player')}</div>
            <input id="gh-fav-search" placeholder="${_ght('fav_search_ph')}" style="${inp()};margin-bottom:8px" autocomplete="off">
            <div id="gh-fav-results" style="display:flex;flex-direction:column;gap:6px"></div>`;
          c.appendChild(searchWrap);

          const allPlayers = (players || []).filter(p => p.id !== (_ghMe?.id));
          const resultsEl = searchWrap.querySelector('#gh-fav-results');

          searchWrap.querySelector('#gh-fav-search').oninput = e => {
            const q = e.target.value.trim().toLowerCase();
            resultsEl.innerHTML = '';
            if (!q) return;
            const hits = allPlayers.filter(p =>
              p.display_name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
            ).slice(0, 8);
            if (!hits.length) { resultsEl.innerHTML = `<div style="color:var(--fg2);font-size:13px">${_ght('fav_no_players_found')}</div>`; return; }
            hits.forEach(p => resultsEl.appendChild(_ghFavRow(p)));
          };

          // Saved favourites
          const divider = document.createElement('div');
          divider.innerHTML = `<div style="font-weight:600;font-size:12px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding-top:14px;border-top:1px solid var(--border)">${_ght('fav_saved_header')}</div>`;
          c.appendChild(divider);

          const favsEl = document.createElement('div');
          favsEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';
          divider.appendChild(favsEl);

          function renderSaved() {
            favsEl.innerHTML = '';
            if (!_ghFavs || !_ghFavs.length) {
              favsEl.innerHTML = `<div style="color:var(--fg2);font-size:13px">${_ght('fav_none_yet')}</div>`;
              return;
            }
            _ghFavs.forEach(f => favsEl.appendChild(_ghFavRow(f, renderSaved)));
          }
          renderSaved();
        }

        function _ghFavRow(p, onFavChange) {
          const fav = _ghIsFav(p.id);
          const row = document.createElement('div');
          row.style.cssText = 'background:var(--surface1);border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px;transition:background .12s';
          row.innerHTML = `
            ${window.GHAvatar ? window.GHAvatar.renderAvatar(p, 30) : `<div style="width:30px;height:30px;border-radius:50%;background:${esc(p.avatar_color||'#585b70')};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#1e1e2e;flex-shrink:0">${esc((p.display_name?.[0]||'?').toUpperCase())}</div>`}
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${esc(p.display_name||p.username||'?')}</div>
              <div style="font-size:11px;color:var(--fg2)">@${esc(p.username||'')}</div>
            </div>
            <button id="frow-prof" style="${btn()};padding:4px 10px;font-size:12px">${_ght('fav_profile_btn')}</button>
            <button id="frow-fav" style="${btn()};padding:4px 10px;font-size:12px">${fav?_ght('fav_saved'):_ght('fav_favourite')}</button>`;
          row.querySelector('#frow-prof').onclick = () => showPlayerProfile(p);
          row.querySelector('#frow-fav').onclick = async () => {
            if (!_ghIsLoggedIn()) return;
            await _ghToggleFav(p);
            const b = row.querySelector('#frow-fav');
            b.textContent = _ghIsFav(p.id) ? _ght('fav_saved') : _ght('fav_favourite');
            if (onFavChange) onFavChange();
          };
          return row;
        }

        // ── Settings tab ────────────────────────────────────────
        function renderSettings() {
          const c = body.querySelector('#gh-body');
          const me = _ghMe || window.GameHub?.currentPlayer();
          const avatarSection = me ? `
              <div>
                <div style="font-weight:700;font-size:14px;margin-bottom:12px">👤 ${_ght('set_my_avatar')}</div>
                <div style="background:var(--surface1);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:14px">
                  <div id="gh-set-av-preview">${window.GHAvatar ? window.GHAvatar.renderAvatar(me, 64) : `<div style="width:64px;height:64px;border-radius:50%;background:${esc(me.avatar_color||'#585b70')};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:28px;color:#1e1e2e">${esc((me.display_name?.[0]||'?').toUpperCase())}</div>`}</div>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <div style="font-size:13px;font-weight:600">${esc(me.display_name)}</div>
                    <button id="gh-set-av-btn" style="${btn()};padding:6px 14px;font-size:12px">${_ght('set_edit_avatar')}</button>
                  </div>
                </div>
              </div>` : '';
          c.innerHTML = `
            <div style="max-width:420px;display:flex;flex-direction:column;gap:20px">
              ${avatarSection}
              <div id="gh-set-publink">
                <div style="font-size:12px;color:var(--fg2);margin-bottom:8px">${_ght('set_direct_link')}</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <code style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--accent);user-select:all">/pub/gamehub/</code>
                  <button id="gh-set-open" style="${btn()};padding:5px 12px;font-size:12px">${_ght('set_open_link')}</button>
                </div>
                <div style="font-size:11px;color:var(--fg2);margin-top:6px">${_ght('set_domain_hint')}</div>
              </div>
            </div>`;

          if (me) {
            c.querySelector('#gh-set-av-btn').onclick = () => {
              if (!window.GHAvatar) return;
              window.GHAvatar.showBuilder(me.avatar_data, me.avatar_color, async data => {
                const svgStr = window.GHAvatar.avatarSvg(JSON.parse(data), 80);
                const res = await fetch('/api/pub/gamehub/me', {
                  method: 'PUT',
                  headers: {'Content-Type':'application/json', 'X-GH-Token': localStorage.getItem('gh_token')||''},
                  body: JSON.stringify({avatar_data: data, avatar_svg: svgStr}),
                });
                if (res.ok) {
                  me.avatar_data = data;
                  me.avatar_svg = svgStr;
                  if (_ghMe) { _ghMe.avatar_data = data; _ghMe.avatar_svg = svgStr; }
                  const prev = c.querySelector('#gh-set-av-preview');
                  if (prev) prev.innerHTML = window.GHAvatar.renderAvatar(me, 64);
                }
              });
            };
          }

          c.querySelector('#gh-set-open')?.addEventListener('click', () => window.open('/pub/gamehub/', '_blank'));
        }

        reload();
      }
    });
  }
});
