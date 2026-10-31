// Game Hub — the player's own games and the Store they pick them from.
//
// Like the Apps Hub shelf: the server offers every game, and each profile
// chooses which of them it wants on its own page. Nothing is deleted by
// removing one. This file knows no game: names, genres and descriptions all
// come from each game's own manifest through /mp/library.
(function () {
  'use strict';
  if (window.GHLibrary) return;

  const API = '/api/pub/gamehub/mp';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tr = (k, v) => (window.t ? window.t(k, v) : k);
  // A game's icon as HTML: its own picture where its manifest declares one,
  // otherwise its emoji. `o` carries icon and icon_image / iconImage.
  function iconHTML(o, fb) {
    const img = o && (o.iconImage || o.icon_image);
    if (img && /^\/apps\/[A-Za-z0-9_-]+\//.test(img)) {
      return '<img src="' + esc(img) + '" alt="" draggable="false" style="width:1em;height:1em;object-fit:contain;vertical-align:-.15em">';
    }
    return esc((o && o.icon) || fb || '🎮');
  }

  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';
  const pick = v => typeof v === 'string' ? v : v ? (v[lang()] || v.en || Object.values(v)[0] || '') : '';

  const CAT_ICON = { strategy: '♟️', cards: '🃏', puzzle: '🧩', simulation: '🏙️', quiz: '❓', sports: '⚽',
                     adventure: '🗺️', board: '🎲', arcade: '🕹️', other: '📂' };
  const catName = id => {
    const v = window._i18n && window._i18n['gl_cat_' + id];
    return v || String(id).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
  };
  const catIcon = id => CAT_ICON[id] || '📂';
  const gameName = g => (g.name_i18n && (g.name_i18n[lang()] || g.name_i18n.en)) || g.name;

  const L = { games: null, prefs: {}, token: null };

  async function load(token, force) {
    if (L.games && !force) return L;
    L.token = token;
    try {
      const r = await fetch(API + '/library', { headers: token ? { 'X-GH-Token': token } : {} });
      const d = r.ok ? await r.json() : { games: [], prefs: {} };
      L.games = d.games || [];
      L.prefs = d.prefs || {};
    } catch (_) { L.games = L.games || []; }
    return L;
  }

  function setPref(key, value) {
    if (L.prefs[key] === value) return;
    L.prefs[key] = value;
    if (!L.token) return;
    fetch(API + '/library/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-GH-Token': L.token },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {});
  }

  async function setInstalled(id, installed) {
    const r = await fetch(`${API}/library/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-GH-Token': L.token },
      body: JSON.stringify({ installed }),
    });
    if (!r.ok) throw new Error('save failed');
    const g = L.games.find(x => x.id === id);
    if (g) g.installed = installed;
  }

  function injectStyle() {
    if (document.getElementById('gl-style')) return;
    const st = document.createElement('style');
    st.id = 'gl-style';
    st.textContent = `
    .gl-bar{display:flex;gap:8px;align-items:center}
    .gl-bar select{flex:1 1 0;min-width:0}
    .gl-bar select,.gl-search{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--fg);padding:6px 10px;font-size:.82rem;font-family:inherit;max-width:100%}
    .gl-search{width:100%;padding:9px 12px;font-size:.9rem;outline:none}
    .gl-search:focus{border-color:var(--accent)}
    .gl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
    .gl-cat{background:var(--surface1);border:1px solid var(--border);border-radius:14px;padding:18px 12px 14px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;text-align:center;transition:background .12s}
    .gl-cat:hover{background:var(--surface2)}
    .gl-cat .ic{font-size:34px;line-height:1}
    .gl-cat .nm{font-weight:700;font-size:13px}
    .gl-cat .sm{font-size:11px;color:var(--fg2)}
    .gl-row{display:flex;align-items:center;gap:12px;background:var(--surface1);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
    .gl-row .ic{font-size:28px;flex-shrink:0;width:36px;text-align:center}
    .gl-row .inf{flex:1;min-width:0}
    .gl-row .nm{font-weight:700;font-size:14px}
    .gl-row .ds{font-size:12px;color:var(--fg2);margin-top:2px;line-height:1.35}
    .gl-btn{background:var(--surface2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0}
    .gl-btn.add{background:var(--accent);color:var(--on-accent,var(--surface,var(--surface1,#1e1e2e)));border-color:var(--accent)}
    .gl-btn:disabled{opacity:.5;cursor:default}
    .gl-empty{color:var(--fg2);text-align:center;padding:30px 10px}
    `;
    document.head.appendChild(st);
  }

  function sortGames(list, mode) {
    const out = list.slice();
    if (mode === 'recent') out.sort((a, b) => new Date(b.last_opened_at || 0) - new Date(a.last_opened_at || 0) || gameName(a).localeCompare(gameName(b)));
    else if (mode === 'frequent') out.sort((a, b) => (b.open_count || 0) - (a.open_count || 0) || gameName(a).localeCompare(gameName(b)));
    else out.sort((a, b) => gameName(a).localeCompare(gameName(b)));
    return out;
  }

  // ── The player's own page: filtered, sorted ───────────────────────────────
  // o: { token, cardFor(game) -> Element, openStore() }
  function renderShelf(el, o) {
    injectStyle();
    el.innerHTML = '';
    const mine = (L.games || []).filter(g => g.installed);
    if (!mine.length) {
      const e = document.createElement('div');
      e.className = 'gl-empty';
      e.innerHTML = `<div style="font-size:2rem;margin-bottom:8px">📭</div><div>${esc(tr((L.games || []).length ? 'gl_empty_shelf' : 'gl_no_games_available'))}</div>` +
        ((L.games || []).length ? `<button class="gl-btn add" style="margin-top:14px;padding:8px 18px">${esc(tr('gl_open_store'))}</button>` : '');
      e.querySelector('button')?.addEventListener('click', o.openStore);
      el.appendChild(e);
      return;
    }
    const cats = [...new Set(mine.map(g => g.category || 'other'))].sort((a, b) => catName(a).localeCompare(catName(b)));
    const wanted = L.prefs.games_category;
    let cat = wanted && cats.includes(wanted) ? wanted : 'all';
    let sort = ['alpha', 'frequent', 'recent'].includes(L.prefs.games_sort) ? L.prefs.games_sort : 'alpha';

    const bar = document.createElement('div');
    bar.className = 'gl-bar';
    bar.innerHTML = `
      <select id="gl-cat" aria-label="${esc(tr('gl_category'))}" title="${esc(tr('gl_category'))}">
        <option value="all">${esc(tr('gl_all_categories'))}</option>
        ${cats.map(c => `<option value="${esc(c)}"${c === cat ? ' selected' : ''}>${esc(catName(c))}</option>`).join('')}
      </select>
      <select id="gl-sort" aria-label="${esc(tr('gl_sort'))}" title="${esc(tr('gl_sort'))}">
        ${['alpha', 'frequent', 'recent'].map(m => `<option value="${m}"${m === sort ? ' selected' : ''}>${esc(tr('gl_sort_' + m))}</option>`).join('')}
      </select>`;
    const grid = document.createElement('div');
    grid.className = 'gl-grid';
    el.appendChild(bar);
    el.appendChild(grid);

    const draw = () => {
      grid.innerHTML = '';
      sortGames(cat === 'all' ? mine : mine.filter(g => (g.category || 'other') === cat), sort)
        .forEach(g => grid.appendChild(o.cardFor(g)));
    };
    bar.querySelector('#gl-cat').onchange = e => { cat = e.target.value; setPref('games_category', cat); draw(); };
    bar.querySelector('#gl-sort').onchange = e => { sort = e.target.value; setPref('games_sort', sort); draw(); };
    draw();
  }

  // ── The Store: categories, search, add and remove ─────────────────────────
  let storeView = null;   // null = categories, a category id, or 'installed'

  function renderStore(el, o) {
    injectStyle();
    const games = L.games || [];
    if (!games.length) { el.innerHTML = `<div class="gl-empty">${esc(tr('gl_no_games_available'))}</div>`; return; }
    const catOf = g => g.category || 'other';
    const cats = [...new Set(games.map(catOf))].sort((a, b) => catName(a).localeCompare(catName(b)));
    if (storeView && storeView !== 'installed' && !cats.includes(storeView)) storeView = null;

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="color:var(--fg2);font-size:.82rem;line-height:1.5">${esc(tr('gl_store_hint'))}</div>
        <input class="gl-search" type="search" autocomplete="off" aria-label="${esc(tr('gl_search'))}" placeholder="${esc(tr('gl_search'))}">
        <div id="gl-content" style="display:flex;flex-direction:column;gap:12px"></div>
      </div>`;
    const content = el.querySelector('#gl-content');
    const search = el.querySelector('.gl-search');

    const drawCategories = () => {
      const added = games.filter(g => g.installed).length;
      content.innerHTML = `
        <div><button class="gl-btn" id="gl-mine"${added ? '' : ' disabled'}>${esc(tr('gl_installed_btn', { n: added }))}</button></div>
        <div class="gl-grid">${cats.map(c => {
          const inCat = games.filter(g => catOf(g) === c);
          return `<div class="gl-cat" data-cat="${esc(c)}"><div class="ic">${catIcon(c)}</div><div class="nm">${esc(catName(c))}</div>` +
                 `<div class="sm">${esc(tr('gl_cat_summary', { total: inCat.length, added: inCat.filter(g => g.installed).length }))}</div></div>`;
        }).join('')}</div>`;
      content.querySelector('#gl-mine').onclick = () => { storeView = 'installed'; drawGames(); };
      content.querySelectorAll('[data-cat]').forEach(c => c.onclick = () => { storeView = c.dataset.cat; drawGames(); });
    };

    const drawRows = (rows, title, showBack) => {
      content.innerHTML = `
        ${showBack ? `<div><button class="gl-btn" id="gl-back">${esc(tr('gl_back'))}</button></div>` : ''}
        ${title ? `<div style="font-weight:700">${esc(title)}</div>` : ''}
        <div class="err" id="gl-err" style="color:var(--red);font-size:.82rem;min-height:0"></div>
        <div style="display:flex;flex-direction:column;gap:10px" id="gl-list"></div>`;
      content.querySelector('#gl-back')?.addEventListener('click', () => { storeView = null; drawCategories(); });
      const list = content.querySelector('#gl-list');
      list.innerHTML = rows.length ? rows.map(g => `
        <div class="gl-row"><div class="ic">${iconHTML(g)}</div>
          <div class="inf"><div class="nm">${esc(gameName(g))}</div><div class="ds">${esc(pick(g.description))}</div></div>
          <button class="gl-btn${g.installed ? '' : ' add'}" data-id="${esc(g.id)}">${esc(tr(g.installed ? 'gl_remove' : 'gl_add'))}</button>
        </div>`).join('') : `<div class="gl-empty">${esc(tr('gl_no_results'))}</div>`;
      list.querySelectorAll('[data-id]').forEach(btn => btn.onclick = async () => {
        const g = games.find(x => x.id === btn.dataset.id);
        const want = !g.installed;
        btn.disabled = true;
        try {
          await setInstalled(g.id, want);
          // The page keeps a category filter of its own; a game added from
          // another category would land behind it and look like nothing happened.
          if (want && L.prefs.games_category && L.prefs.games_category !== 'all' && L.prefs.games_category !== catOf(g)) setPref('games_category', 'all');
          btn.textContent = tr(want ? 'gl_remove' : 'gl_add');
          btn.classList.toggle('add', !want);
          content.querySelector('#gl-err').textContent = '';
        } catch (_) { content.querySelector('#gl-err').textContent = tr('gl_failed'); }
        btn.disabled = false;
      });
    };

    const drawGames = () => {
      const inst = storeView === 'installed';
      const rows = (inst ? games.filter(g => g.installed) : games.filter(g => catOf(g) === storeView))
        .sort((a, b) => gameName(a).localeCompare(gameName(b)));
      drawRows(rows, inst ? tr('gl_installed_title') : catName(storeView), true);
    };

    search.addEventListener('input', () => {
      const q = search.value.trim().toLocaleLowerCase();
      if (!q) { if (storeView) drawGames(); else drawCategories(); return; }
      drawRows(games.filter(g => [gameName(g), pick(g.description), catName(catOf(g)), catOf(g)].some(v => v.toLocaleLowerCase().includes(q)))
        .sort((a, b) => gameName(a).localeCompare(gameName(b))), '', false);
    });
    if (storeView) drawGames(); else drawCategories();
  }

  window.GHLibrary = { load, renderShelf, renderStore, gameName, catName, pick, iconHTML, find: id => (L.games || []).find(g => g.id === id) };
})();
