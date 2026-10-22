// Game Hub — statistics views, shared by the public page and the desktop window.
//
// Nothing here knows a game. A game's own manifest says which numbers it
// reports and what they are called; the server turns them into boards, ratings
// and trends (see backend/apps/gamehub/stats.py) and this file only draws what
// comes back.
//
//   GHStats.renderGame(el,    { gameId, name, icon, myId, token, favIds, onPlayer })
//   GHStats.renderOverall(el, { myId, token, onPlayer })
(function () {
  'use strict';
  if (window.GHStats) return;

  const BASE = '/api/pub/gamehub';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // A game's icon as HTML: its own picture where its manifest declares one,
  // otherwise its emoji. `o` carries icon and icon_image / iconImage.
  function iconHTML(o, fb) {
    const img = o && (o.iconImage || o.icon_image);
    if (img && /^\/apps\/[A-Za-z0-9_-]+\//.test(img)) {
      return '<img src="' + esc(img) + '" alt="" draggable="false" style="width:1em;height:1em;object-fit:contain;vertical-align:-.15em">';
    }
    return esc((o && o.icon) || fb || '🎮');
  }
  const tr = (k, vars) => (window.t ? window.t(k, vars) : k);
  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';

  // ── i18n of what games call their numbers ───────────────────────────────
  function labelOf(m) {
    if (!m) return '';
    if (m.label) return m.label[lang()] || m.label.en || Object.values(m.label)[0] || m.key;
    return m.key === 'score' ? tr('gs_score') : m.key;
  }

  // ── Number formatting ───────────────────────────────────────────────────
  function num(v, max) {
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: max == null ? 0 : max });
  }
  function dur(s) {
    s = Math.round(s);
    if (s < 60) return s + 's';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + 'm ' + String(sec).padStart(2, '0') + 's';
  }
  function fmt(v, type) {
    if (v == null || !isFinite(v)) return '—';
    if (type === 'duration') return dur(v);
    if (type === 'percent') return num(v, 1) + '%';
    if (type === 'decimal') return num(v, 1);
    return num(v, Math.abs(v) < 100 && v % 1 ? 1 : 0);
  }
  const shortDate = s => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // ── Styles (once) ───────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('ghs-style')) return;
    const st = document.createElement('style');
    st.id = 'ghs-style';
    st.textContent = `
    .ghs{display:flex;flex-direction:column;gap:16px;font-size:13px;color:var(--fg)}
    .ghs *{box-sizing:border-box}
    .ghs-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ghs-seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .ghs-seg button{background:var(--surface1);color:var(--fg2);border:none;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
    .ghs-seg button.on{background:var(--accent);color:#1e1e2e}
    .ghs select{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--fg);padding:6px 8px;font-size:12px;font-family:inherit;max-width:100%}
    .ghs-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
    .ghs-card{background:var(--surface1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;min-width:0}
    .ghs-card .v{font-size:20px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
    .ghs-card .l{font-size:11px;color:var(--fg2);margin-top:2px}
    .ghs-card .s{font-size:11px;color:var(--accent);margin-top:3px}
    .ghs h4{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--fg2);margin:0 0 8px;font-weight:700}
    .ghs-box{background:var(--surface1);border:1px solid var(--border);border-radius:10px;padding:12px}
    .ghs-chips{display:flex;gap:6px;flex-wrap:wrap}
    .ghs-chip{background:var(--surface2);color:var(--fg2);border:1px solid var(--border);border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer;font-family:inherit}
    .ghs-chip.on{background:var(--accent);border-color:var(--accent);color:#1e1e2e;font-weight:700}
    .ghs-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;position:relative;overflow:hidden}
    .ghs-row.clickable{cursor:pointer}
    .ghs-row.clickable:hover{background:var(--surface2)}
    .ghs-row.me{outline:1px solid var(--accent);background:rgba(137,180,250,.08)}
    .ghs-row .fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent);opacity:.1;pointer-events:none}
    .ghs-row .pos{width:26px;text-align:center;font-weight:700;color:var(--fg2);flex-shrink:0;z-index:1}
    .ghs-row .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;z-index:1}
    .ghs-row .val{font-weight:700;z-index:1;text-align:right}
    .ghs-row .sub{font-size:11px;color:var(--fg2);z-index:1;min-width:40px;text-align:right}
    .ghs-muted{color:var(--fg2);font-size:12px}
    .ghs-empty{color:var(--fg2);text-align:center;padding:28px 0}
    .ghs-link{background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;padding:6px 0;font-family:inherit}
    .ghs svg.chart{width:100%;height:auto;display:block;overflow:visible}
    .ghs svg.chart text{fill:var(--fg2);font-size:10px;font-family:inherit}
    .ghs-leg{display:flex;gap:14px;font-size:11px;color:var(--fg2);margin-top:6px;flex-wrap:wrap}
    .ghs-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
    .ghs-split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media (max-width:640px){.ghs-split{grid-template-columns:1fr}}
    .ghs-cmp{width:100%;border-collapse:collapse}
    .ghs-cmp td,.ghs-cmp th{padding:5px 6px;border-bottom:1px solid rgba(69,71,90,.4);text-align:right}
    .ghs-cmp td:first-child,.ghs-cmp th:first-child{text-align:left;color:var(--fg2)}
    .ghs-cmp .win{color:var(--green);font-weight:700}
    .ghs-wld{display:flex;height:8px;border-radius:4px;overflow:hidden;flex:1;min-width:60px;background:var(--surface2)}
    .ghs-det{padding:4px 8px 8px 44px;display:flex;flex-direction:column;gap:3px;font-size:12px}
    .ghs-det div{display:flex;gap:8px;align-items:center}
    .gv-sec{border-top:1px solid var(--border);padding:12px 16px;display:flex;flex-direction:column;gap:10px}
    .gv-sec h4{margin:0}
    .gv-score{display:flex;align-items:stretch;gap:8px;text-align:center}
    .gv-score>div{flex:1;background:var(--surface2);border-radius:10px;padding:8px 4px;min-width:0}
    .gv-score .n{font-size:26px;font-weight:800;line-height:1.1}
    .gv-score .l{font-size:11px;color:var(--fg2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gv-split{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--surface2)}
    .gv-verdict{font-size:13px;line-height:1.45}
    .gv-dots{display:inline-flex;gap:4px;vertical-align:middle}
    .gv-dots i{width:12px;height:12px;border-radius:50%;display:inline-block}
    .gv-form{display:flex;align-items:center;gap:10px;font-size:12px;flex-wrap:wrap}
    .gv-form b{min-width:70px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gv-chance{display:flex;align-items:center;gap:12px}
    .gv-chance .big{font-size:28px;font-weight:800;color:var(--accent);min-width:96px;flex-shrink:0}
    .gv-g{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12px}
    .gv-g:hover{background:var(--surface2)}
    .gv-g .nm{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gv-m{display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid rgba(69,71,90,.35)}
    .gv-m .h{display:flex;justify-content:space-between;font-size:12px;color:var(--fg2)}
    .gv-bar{display:flex;align-items:center;gap:8px;font-size:12px}
    .gv-bar .w{width:64px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
    .gv-bar .t{flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden}
    .gv-bar .t i{display:block;height:100%;border-radius:4px}
    .gv-bar .v{min-width:58px;text-align:right;font-weight:600}
    .gv-bar .v.lead{color:var(--green)}
    `;
    document.head.appendChild(st);
  }

  // ── Small drawing helpers ───────────────────────────────────────────────
  function avatar(p, size) {
    if (window.GHAvatar) return window.GHAvatar.renderAvatar(p, size);
    return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${esc(p.avatar_color || '#585b70')};display:inline-block;flex-shrink:0"></span>`;
  }

  function niceRange(lo, hi) {
    if (lo === hi) { lo = lo - 1; hi = hi + 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  // Line chart. series: [{name,color,dashed,pts:[[x,y],...]}], hline: [{y,color,label}]
  function lineChart(series, o) {
    o = o || {};
    const W = 600, H = 190, L = 56, R = 12, T = 10, B = 24;
    const all = series.flatMap(s => s.pts);
    if (!all.length) return '';
    const hl = o.hlines || [];
    let xs = all.map(p => p[0]), ys = all.map(p => p[1]).concat(hl.map(h => h.y));
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = niceRange(Math.min(...ys), Math.max(...ys));
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R);
    const Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
    for (let i = 0; i <= 3; i++) {
      const y = y0 + (y1 - y0) * i / 3, yy = Y(y);
      out += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-opacity=".5"/>` +
             `<text x="${L - 6}" y="${yy + 3}" text-anchor="end">${esc(fmt(y, o.type))}</text>`;
    }
    hl.forEach(h => {
      out += `<line x1="${L}" x2="${W - R}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-dasharray="5 4" stroke-width="1.5"/>`;
    });
    series.forEach(s => {
      const pts = s.pts.slice().sort((a, b) => a[0] - b[0]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
      out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
      if (pts.length <= 60) pts.forEach(p => {
        out += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${s.color}"><title>${esc((s.name ? s.name + ': ' : '') + fmt(p[1], o.type) + (p[2] ? ' · ' + p[2] : ''))}</title></circle>`;
      });
    });
    if (o.xlabels) {
      out += `<text x="${L}" y="${H - 6}" text-anchor="start">${esc(o.xlabels[0])}</text>` +
             `<text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(o.xlabels[1])}</text>`;
    }
    return out + '</svg>';
  }

  // Bars. items: [{label,value,color,title}]
  function barChart(items, o) {
    o = o || {};
    if (!items.length) return '';
    const W = 600, H = 150, L = 8, R = 8, T = 14, B = 22;
    const max = Math.max(...items.map(i => i.value), 1);
    const slot = (W - L - R) / items.length, bw = Math.max(4, slot * 0.7);
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
    items.forEach((it, i) => {
      const h = (it.value / max) * (H - T - B), x = L + i * slot + (slot - bw) / 2, y = H - B - h;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, it.value ? 2 : 0).toFixed(1)}" rx="3" fill="${it.color || 'var(--accent)'}" fill-opacity="${it.color ? 1 : .55}"><title>${esc(it.title || it.value)}</title></rect>`;
      if (it.value && items.length <= 14) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${esc(it.value)}</text>`;
    });
    if (o.xlabels) {
      out += `<text x="${L}" y="${H - 6}" text-anchor="start">${esc(o.xlabels[0])}</text>` +
             `<text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(o.xlabels[1])}</text>`;
    }
    return out + '</svg>';
  }

  // ── Server ──────────────────────────────────────────────────────────────
  async function get(path, token) {
    const r = await fetch(BASE + path, { headers: token ? { 'X-GH-Token': token } : {} });
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  // ── Per-game statistics ─────────────────────────────────────────────────
  function renderGame(el, opts) {
    injectStyle();
    const S = { mode: 'auto', period: 'all', scope: 'all', board: null, agg: 'best', data: null, expanded: false, cmp: null };
    const root = document.createElement('div');
    root.className = 'ghs';
    el.innerHTML = '';
    el.appendChild(root);

    async function load() {
      root.innerHTML = `<div class="ghs-empty">${esc(tr('gs_loading'))}</div>`;
      try {
        S.data = await get(`/insights/${encodeURIComponent(opts.gameId)}?mode=${S.mode}&period=${S.period}`, opts.token);
      } catch (_) {
        root.innerHTML = `<div class="ghs-empty">${esc(tr('gs_error'))}</div>`;
        return;
      }
      S.mode = S.data.mode;   // resolves "auto"
      if (!S.data.available.single && !S.data.available.multi) { root.innerHTML = `<div class="ghs-empty">${esc(tr('gs_no_data'))}</div>`; return; }
      S.board = null;
      draw();
    }

    // The boards a game offers, built only from what its manifest declared.
    function boardsOf(d) {
      const list = [];
      const metrics = d.decl.metrics;
      const ranking = d.decl.ranking;
      if (d.mode === 'multi') {
        list.push({ id: '@rating', label: tr('gs_rating'), type: 'number', better: 'high', val: r => r.rating, noAgg: true, hint: tr('gs_rating_hint') });
      }
      if (d.mode === 'multi' || ranking === 'wins' || ranking === 'win_rate') {
        list.push({ id: '@wins', label: tr('gs_wins'), type: 'number', better: 'high', val: r => r.wins, noAgg: true });
      }
      if (d.mode === 'multi' || ranking === 'win_rate') {
        list.push({ id: '@winrate', label: tr('gs_win_rate'), type: 'percent', better: 'high', val: r => r.win_rate, sort: r => r.win_rate_adj, noAgg: true });
      }
      metrics.forEach(m => list.push({
        id: m.key, label: labelOf(m), type: m.type, better: m.better, metric: m,
        val: (r, agg) => (r[agg] || {})[m.key],
      }));
      list.push({ id: '@played', label: tr('gs_games_played'), type: 'number', better: 'high', val: r => r.played, noAgg: true });
      // Open on the board the game itself ranks by (multiplayer opens on rating).
      const defId = d.mode === 'multi' ? '@rating' : ranking === 'win_rate' ? '@winrate' : (ranking === 'wins' || ranking === 'played') ? '@' + ranking : ranking;
      return { list, def: list.find(b => b.id === defId) ? defId : list[0].id };
    }

    function scopedRows(d) {
      let rows = d.players;
      if (S.scope === 'fav') {
        const ids = new Set((opts.favIds ? opts.favIds() : []).concat(opts.myId ? [opts.myId] : []));
        rows = rows.filter(r => ids.has(r.player_id));
      } else if (S.scope === 'with' && d.me) {
        const ids = new Set(d.me.played_with.concat([opts.myId]));
        rows = rows.filter(r => ids.has(r.player_id));
      }
      return rows;
    }

    // rows -> [{row, value, place}] sorted best first, ties sharing a place
    function rank(rows, board, agg) {
      const items = rows.map(r => ({ row: r, value: board.val(r, agg) })).filter(i => i.value != null && isFinite(i.value));
      // A board may order by something other than what it shows (win rates are
      // smoothed so one lucky game cannot lead).
      items.forEach(i => { i.key = board.sort ? board.sort(i.row) : i.value; });
      items.sort((a, b) => board.better === 'high' ? b.key - a.key : a.key - b.key);
      items.forEach((it, i) => { it.place = i && items[i - 1].key === it.key ? items[i - 1].place : i + 1; });
      return items;
    }

    function draw() {
      const d = S.data;
      const { list, def } = boardsOf(d);
      if (!S.board || !list.find(b => b.id === S.board)) S.board = def;
      const board = list.find(b => b.id === S.board);
      if (!board.noAgg && board.metric && S.agg === 'total' && !board.metric.total) S.agg = 'best';
      const agg = board.noAgg ? 'best' : S.agg;

      const rows = scopedRows(d);
      const items = rank(rows, board, agg);
      const mine = items.find(i => i.row.player_id === opts.myId);
      const myRow = d.players.find(r => r.player_id === opts.myId);
      const vals = items.map(i => i.value);
      const avgVal = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

      const periods = [['all', 'gs_period_all'], ['week', 'gs_period_week'], ['month', 'gs_period_month'], ['year', 'gs_period_year']];
      const modes = [];
      if (d.available.single) modes.push(['single', tr('gs_solo')]);
      if (d.available.multi) modes.push(['multi', tr('gs_multi')]);

      let h = `<div class="ghs-bar">`;
      if (modes.length > 1) h += `<div class="ghs-seg" data-k="mode">${modes.map(m => `<button data-v="${m[0]}" class="${S.mode === m[0] ? 'on' : ''}">${m[0] === 'single' ? '👤' : '👥'} ${esc(m[1])}</button>`).join('')}</div>`;
      h += `<select data-k="period">${periods.map(p => `<option value="${p[0]}"${S.period === p[0] ? ' selected' : ''}>${esc(tr(p[1]))}</option>`).join('')}</select>`;
      if (opts.myId) h += `<select data-k="scope"><option value="all"${S.scope === 'all' ? ' selected' : ''}>${esc(tr('gs_scope_all'))}</option>` +
        `<option value="fav"${S.scope === 'fav' ? ' selected' : ''}>${esc(tr('gs_scope_fav'))}</option>` +
        `<option value="with"${S.scope === 'with' ? ' selected' : ''}>${esc(tr('gs_scope_with'))}</option></select>`;
      h += `</div>`;

      if (!d.totals.sessions) {
        root.innerHTML = h + `<div class="ghs-empty">${esc(tr('gs_no_data'))}</div>`;
        bindBar();
        return;
      }

      // ── Summary ──
      h += `<div class="ghs-cards">`;
      if (opts.myId) {
        if (mine) {
          const worse = items.filter(i => i.key !== mine.key && (board.better === 'high' ? i.key < mine.key : i.key > mine.key)).length;
          const pct = items.length > 1 ? Math.round(100 * worse / (items.length - 1)) : 0;
          h += `<div class="ghs-card"><div class="v">#${mine.place}<span class="ghs-muted"> ${esc(tr('gs_of', { n: items.length }))}</span></div>` +
               `<div class="l">${esc(tr('gs_your_place'))} · ${esc(board.label)}</div>` +
               (items.length > 1 ? `<div class="s">${esc(tr('gs_better_than', { n: pct }))}</div>` : '') + `</div>`;
          h += `<div class="ghs-card"><div class="v">${esc(fmt(mine.value, board.type))}</div><div class="l">${esc(board.label)}${board.noAgg ? '' : ' · ' + esc(tr('gs_' + agg))}</div>` +
               (items[0] && items[0] !== mine ? `<div class="s">${esc(tr('gs_leader'))}: ${esc(fmt(items[0].value, board.type))}</div>` : '') + `</div>`;
        } else {
          h += `<div class="ghs-card" style="grid-column:1/-1"><div class="l">${esc(tr('gs_not_ranked'))}</div></div>`;
        }
        if (myRow) {
          h += `<div class="ghs-card"><div class="v">${myRow.played}</div><div class="l">${esc(tr('gs_games_played'))}</div></div>`;
          if (d.mode !== 'single' || d.decl.ranking === 'win_rate') h += `<div class="ghs-card"><div class="v">${fmt(myRow.win_rate, 'percent')}</div><div class="l">${esc(tr('gs_win_rate'))}</div><div class="s">${myRow.wins} ${esc(tr('gs_wins'))}</div></div>`;
          if (myRow.seconds) h += `<div class="ghs-card"><div class="v">${esc(dur(myRow.seconds))}</div><div class="l">${esc(tr('gs_time_played'))}</div></div>`;
        }
      } else {
        h += `<div class="ghs-card"><div class="v">${d.totals.sessions}</div><div class="l">${esc(tr('gs_sessions'))}</div></div>` +
             `<div class="ghs-card"><div class="v">${d.totals.players}</div><div class="l">${esc(tr('gs_players'))}</div></div>`;
        if (d.totals.seconds) h += `<div class="ghs-card"><div class="v">${esc(dur(d.totals.seconds))}</div><div class="l">${esc(tr('gs_time_played'))}</div></div>`;
      }
      h += `</div>`;

      // ── Board picker ──
      h += `<div class="ghs-box"><h4>${esc(tr('gs_board'))}</h4><div class="ghs-chips" data-k="board">${list.map(b => `<button class="ghs-chip${b.id === S.board ? ' on' : ''}" data-v="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div>`;
      if (!board.noAgg) {
        const aggs = ['best', 'avg'].concat(board.metric && board.metric.total ? ['total'] : []);
        h += `<div class="ghs-seg" data-k="agg" style="margin-top:8px">${aggs.map(a => `<button data-v="${a}" class="${agg === a ? 'on' : ''}">${esc(tr('gs_' + a + (board.better === 'low' && a === 'best' ? '_low' : '')))}</button>`).join('')}</div>`;
      }
      if (board.hint) h += `<div class="ghs-muted" style="margin-top:8px">${esc(board.hint)}</div>`;

      // ── Ranking ──
      h += `<div style="margin-top:10px" id="ghs-rank"></div></div>`;

      // ── Distribution ──
      if (items.length > 1) h += `<div class="ghs-box"><h4>${esc(tr('gs_distribution'))} · ${esc(board.label)}</h4><div id="ghs-dist"></div></div>`;

      // ── Progress ──
      h += `<div class="ghs-box" id="ghs-prog" style="display:none"></div>`;
      h += `<div class="ghs-box" id="ghs-vs" style="display:none"></div>`;

      // ── Records, h2h, compare, activity ──
      h += `<div id="ghs-more" class="ghs-split"></div>`;
      h += `<div class="ghs-box" id="ghs-cmp"></div>`;
      h += `<div class="ghs-box" id="ghs-act"></div>`;

      root.innerHTML = h;
      bindBar();
      root.querySelectorAll('[data-k="board"] button').forEach(b => b.onclick = () => { S.board = b.dataset.v; S.expanded = false; draw(); });
      root.querySelectorAll('[data-k="agg"] button').forEach(b => b.onclick = () => { S.agg = b.dataset.v; draw(); });

      drawRank(items, board, agg);
      if (items.length > 1) drawDist(items, board, mine, avgVal);
      drawProgress(d, board, agg, avgVal);
      drawMore(d, board);
      drawCompare(d, rows);
      drawActivity(d);
    }

    function bindBar() {
      root.querySelectorAll('[data-k="mode"] button').forEach(b => b.onclick = () => { S.mode = b.dataset.v; load(); });
      root.querySelector('select[data-k="period"]')?.addEventListener('change', e => { S.period = e.target.value; load(); });
      root.querySelector('select[data-k="scope"]')?.addEventListener('change', e => { S.scope = e.target.value; draw(); });
    }

    function drawRank(items, board, agg) {
      const box = root.querySelector('#ghs-rank');
      if (!items.length) { box.innerHTML = `<div class="ghs-empty">${esc(tr('gs_no_data'))}</div>`; return; }
      const LIMIT = 10;
      let shown = S.expanded ? items : items.slice(0, LIMIT);
      const mine = items.find(i => i.row.player_id === opts.myId);
      const extra = mine && !shown.includes(mine);
      // Bar length: how far along the field's own range this value is, best at full length.
      const hi = Math.max(...items.map(i => i.value)), lo = Math.min(...items.map(i => i.value));
      const widthOf = v => {
        if (hi === lo) return 100;
        const f = (v - lo) / (hi - lo);
        return 8 + 92 * (board.better === 'high' ? f : 1 - f);
      };
      const row = it => {
        const r = it.row, isMe = r.player_id === opts.myId;
        const sub = board.id === '@rating' ? `${r.rating_games} ${esc(tr('gs_games_short'))}` : `${r.played} ${esc(tr('gs_games_short'))}`;
        const prov = board.id === '@rating' && r.rating_games < 5 ? ` <span class="ghs-muted" title="${esc(tr('gs_provisional_hint'))}">(${esc(tr('gs_provisional'))})</span>` : '';
        return `<div class="ghs-row clickable${isMe ? ' me' : ''}" data-pid="${esc(r.player_id)}"><span class="fill" style="width:${widthOf(it.value).toFixed(0)}%"></span>` +
          `<span class="pos">${it.place <= 3 ? ['🥇', '🥈', '🥉'][it.place - 1] : it.place}</span>${avatar(r, 24)}` +
          `<span class="nm">${esc(r.display_name)}${isMe ? ` <span style="font-size:10px;color:var(--accent)">(${esc(tr('gh_you'))})</span>` : ''}${prov}</span>` +
          `<span class="sub">${sub}</span><span class="val">${esc(fmt(it.value, board.type))}</span></div>`;
      };
      let h = shown.map(row).join('');
      if (extra) h += `<div class="ghs-muted" style="text-align:center">…</div>` + row(mine);
      if (items.length > LIMIT) h += `<button class="ghs-link" id="ghs-more-btn">${esc(tr(S.expanded ? 'gs_show_less' : 'gs_show_more'))}</button>`;
      box.innerHTML = h;
      box.querySelector('#ghs-more-btn')?.addEventListener('click', () => { S.expanded = !S.expanded; drawRank(items, board, agg); });
      box.querySelectorAll('.ghs-row').forEach(rw => rw.onclick = () => {
        const p = S.data.players.find(x => x.player_id === rw.dataset.pid);
        if (p && opts.onPlayer) opts.onPlayer({ id: p.player_id, ...p });
      });
    }

    function drawDist(items, board, mine, avgVal) {
      const box = root.querySelector('#ghs-dist');
      const vals = items.map(i => i.value);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const nb = Math.min(10, Math.max(3, new Set(vals).size));
      const step = (hi - lo) / nb || 1;
      const bins = Array.from({ length: nb }, () => 0);
      const bin = v => Math.min(nb - 1, Math.floor((v - lo) / step));
      vals.forEach(v => bins[bin(v)]++);
      const myBin = mine ? bin(mine.value) : -1;
      const chart = barChart(bins.map((c, i) => ({
        value: c, color: i === myBin ? 'var(--accent)' : null,
        title: `${fmt(lo + i * step, board.type)} – ${fmt(lo + (i + 1) * step, board.type)}: ${c}`,
      })), { xlabels: [fmt(lo, board.type), fmt(hi, board.type)] });
      box.innerHTML = chart +
        `<div class="ghs-leg">${mine ? `<span><i style="background:var(--accent)"></i>${esc(tr('gs_you'))}: ${esc(fmt(mine.value, board.type))}</span>` : ''}` +
        `<span><i style="background:var(--accent);opacity:.55"></i>${esc(tr('gs_players'))}</span>` +
        `<span>Ø ${esc(fmt(avgVal, board.type))}</span><span>${esc(tr('gs_leader'))}: ${esc(fmt(items[0].value, board.type))}</span></div>`;
    }

    function drawProgress(d, board, agg, avgVal) {
      const prog = root.querySelector('#ghs-prog'), vs = root.querySelector('#ghs-vs');
      if (!d.me) return;
      const tl = d.me.timeline;
      let pts = [], title = tr('gs_progress'), type = board.type;
      if (board.id === '@rating') {
        pts = d.me.rating_history.map(p => [new Date(p[0]).getTime(), p[1]]);
        title = tr('gs_rating_history'); type = 'number';
      } else if (board.id === '@wins' || board.id === '@winrate') {
        let w = 0;
        pts = tl.map((s, i) => { w += s.win ? 1 : 0; return [new Date(s.t).getTime(), board.id === '@wins' ? w : 100 * w / (i + 1)]; });
      } else if (board.id === '@played') {
        pts = tl.map((s, i) => [new Date(s.t).getTime(), i + 1]);
      } else {
        pts = tl.filter(s => s.m[board.id] != null).map(s => [new Date(s.t).getTime(), s.m[board.id], shortDate(s.t)]);
      }
      if (pts.length >= 2) {
        const hl = avgVal != null && board.metric ? [{ y: avgVal, color: 'var(--yellow)' }] : [];
        prog.style.display = '';
        prog.innerHTML = `<h4>${esc(title)} · ${esc(board.label)}</h4>` +
          lineChart([{ name: tr('gs_you'), color: 'var(--accent)', pts }], { type, hlines: hl, xlabels: [shortDate(pts[0][0]), shortDate(pts[pts.length - 1][0])] }) +
          `<div class="ghs-leg"><span><i style="background:var(--accent)"></i>${esc(tr('gs_you'))}</span>${hl.length ? `<span><i style="background:var(--yellow)"></i>${esc(tr('gs_field_avg'))}</span>` : ''}</div>`;
      }
      // Weekly (or daily) you-vs-everyone comparison for numeric boards.
      if (board.metric && d.trend.length >= 2) {
        const meP = [], fP = [];
        d.trend.forEach((b, i) => {
          if (b.field[board.id] != null) fP.push([i, b.field[board.id], shortDate(b.b)]);
          if (b.me[board.id] != null) meP.push([i, b.me[board.id], shortDate(b.b)]);
        });
        if (meP.length && fP.length >= 2) {
          vs.style.display = '';
          vs.innerHTML = `<h4>${esc(tr('gs_vs_field'))} · ${esc(board.label)}</h4>` +
            lineChart([{ name: tr('gs_everyone'), color: 'var(--yellow)', pts: fP }, { name: tr('gs_you'), color: 'var(--accent)', pts: meP }],
              { type, xlabels: [shortDate(d.trend[0].b), shortDate(d.trend[d.trend.length - 1].b)] }) +
            `<div class="ghs-leg"><span><i style="background:var(--accent)"></i>${esc(tr('gs_you'))}</span><span><i style="background:var(--yellow)"></i>${esc(tr('gs_everyone'))}</span><span>${esc(tr('gs_avg'))}</span></div>`;
        }
      }
    }

    function drawMore(d, board) {
      const box = root.querySelector('#ghs-more');
      let h = '';
      const rec = board.metric ? d.records[board.id] : null;
      if (rec && rec.length) {
        h += `<div class="ghs-box"><h4>${esc(tr('gs_records'))} · ${esc(board.label)}</h4>` + rec.map((r, i) =>
          `<div class="ghs-row"><span class="pos">${['🥇', '🥈', '🥉'][i]}</span>${avatar(r, 22)}<span class="nm">${esc(r.display_name)}</span><span class="sub">${esc(shortDate(r.t))}</span><span class="val">${esc(fmt(r.value, board.type))}</span></div>`).join('') + `</div>`;
      }
      const vs = d.me && d.me.versus;
      if (vs && vs.length) {
        h += `<div class="ghs-box"><h4>${esc(tr('gs_h2h'))}</h4>` + vs.slice(0, 6).map(v => {
          const tot = v.w + v.l + v.d;
          return `<div class="ghs-row"><span class="nm">${esc(v.display_name)}</span>` +
            `<span class="ghs-wld" title="${v.w} / ${v.d} / ${v.l}"><i style="width:${100 * v.w / tot}%;background:var(--green)"></i><i style="width:${100 * v.d / tot}%;background:var(--fg2)"></i><i style="width:${100 * v.l / tot}%;background:var(--red)"></i></span>` +
            `<span class="sub" style="min-width:64px"><span style="color:var(--green)">${v.w}</span> · ${v.d} · <span style="color:var(--red)">${v.l}</span></span></div>`;
        }).join('') + `<div class="ghs-muted" style="margin-top:6px">${esc(tr('gs_h2h_hint'))}</div></div>`;
      }
      box.style.display = h ? '' : 'none';
      box.innerHTML = h;
    }

    function drawCompare(d, rows) {
      const box = root.querySelector('#ghs-cmp');
      const others = d.players.filter(r => r.player_id !== opts.myId);
      const myRow = d.players.find(r => r.player_id === opts.myId);
      if (!myRow || !others.length) { box.style.display = 'none'; return; }
      if (!S.cmp || !others.find(o => o.player_id === S.cmp)) S.cmp = others[0].player_id;
      const o = others.find(r => r.player_id === S.cmp);
      const line = (label, a, b, type, better) => {
        if (a == null && b == null) return '';
        const aw = a != null && b != null && a !== b && ((better === 'low') ? a < b : a > b);
        const bw = a != null && b != null && a !== b && !aw;
        return `<tr><td>${esc(label)}</td><td class="${aw ? 'win' : ''}">${esc(fmt(a, type))}</td><td class="${bw ? 'win' : ''}">${esc(fmt(b, type))}</td></tr>`;
      };
      let body = line(tr('gs_games_played'), myRow.played, o.played, 'number', 'high');
      if (d.mode !== 'single' || d.decl.ranking === 'win_rate') {
        body += line(tr('gs_wins'), myRow.wins, o.wins, 'number', 'high') + line(tr('gs_win_rate'), myRow.win_rate, o.win_rate, 'percent', 'high');
        if (myRow.rating != null || o.rating != null) body += line(tr('gs_rating'), myRow.rating, o.rating, 'number', 'high');
      }
      d.decl.metrics.forEach(m => {
        body += line(labelOf(m) + ' · ' + tr(m.better === 'low' ? 'gs_best_low' : 'gs_best'), myRow.best[m.key], o.best[m.key], m.type, m.better);
        body += line(labelOf(m) + ' · ' + tr('gs_avg'), myRow.avg[m.key], o.avg[m.key], m.type, m.better);
      });
      box.style.display = '';
      box.innerHTML = `<h4>${esc(tr('gs_compare'))}</h4><div class="ghs-bar" style="margin-bottom:8px"><select id="ghs-cmp-sel">${others.map(r => `<option value="${esc(r.player_id)}"${r.player_id === S.cmp ? ' selected' : ''}>${esc(r.display_name)}</option>`).join('')}</select></div>` +
        `<table class="ghs-cmp"><thead><tr><th></th><th>${esc(tr('gs_you'))}</th><th>${esc(o.display_name)}</th></tr></thead><tbody>${body}</tbody></table>`;
      box.querySelector('#ghs-cmp-sel').onchange = e => { S.cmp = e.target.value; drawCompare(d, rows); };
    }

    function drawActivity(d) {
      const box = root.querySelector('#ghs-act');
      if (d.trend.length < 2) { box.style.display = 'none'; return; }
      box.innerHTML = `<h4>${esc(tr('gs_activity'))}</h4>` +
        barChart(d.trend.map(b => ({ value: b.sessions, title: `${shortDate(b.b)}: ${b.sessions}` })), { xlabels: [shortDate(d.trend[0].b), shortDate(d.trend[d.trend.length - 1].b)] }) +
        `<div class="ghs-leg"><span>${d.totals.sessions} ${esc(tr('gs_sessions'))}</span><span>${d.totals.players} ${esc(tr('gs_players'))}</span><span>${esc(dur(d.totals.seconds))}</span></div>`;
    }

    load();
    return { reload: load };
  }

  // ── Ranking across games ────────────────────────────────────────────────
  function renderOverall(el, opts) {
    injectStyle();
    const S = { period: 'all', data: null, open: null };
    const root = document.createElement('div');
    root.className = 'ghs';
    el.innerHTML = '';
    el.appendChild(root);

    async function load() {
      root.innerHTML = `<div class="ghs-empty">${esc(tr('gs_loading'))}</div>`;
      try { S.data = await get(`/overall?period=${S.period}`, opts.token); }
      catch (_) { root.innerHTML = `<div class="ghs-empty">${esc(tr('gs_error'))}</div>`; return; }
      draw();
    }

    function draw() {
      const d = S.data;
      const periods = [['all', 'gs_period_all'], ['week', 'gs_period_week'], ['month', 'gs_period_month'], ['year', 'gs_period_year']];
      let h = `<div class="ghs-bar"><select id="gso-period">${periods.map(p => `<option value="${p[0]}"${S.period === p[0] ? ' selected' : ''}>${esc(tr(p[1]))}</option>`).join('')}</select></div>`;
      const me = opts.myId ? d.players.find(p => p.player_id === opts.myId) : null;
      if (me) {
        h += `<div class="ghs-cards"><div class="ghs-card"><div class="v">#${me.place}<span class="ghs-muted"> ${esc(tr('gs_of', { n: d.players.length >= 100 ? '100+' : d.players.length }))}</span></div><div class="l">${esc(tr('gs_overall_place'))}</div></div>` +
             `<div class="ghs-card"><div class="v">${esc(num(me.points, 1))}</div><div class="l">${esc(tr('gs_points'))}</div></div>` +
             `<div class="ghs-card"><div class="v">${me.games}</div><div class="l">${esc(tr('gs_games'))}</div></div>` +
             `<div class="ghs-card"><div class="v">${esc(num(me.avg_percentile, 0))}</div><div class="l">${esc(tr('gs_avg_standing'))}</div></div></div>`;
      }
      if (!d.players.length) { root.innerHTML = h + `<div class="ghs-empty">${esc(tr('gs_no_data'))}</div>`; bind(); return; }
      const top = d.players[0].points || 1;
      h += `<div class="ghs-box"><h4>${esc(tr('gs_overall'))}</h4>` + d.players.map(p => {
        const isMe = p.player_id === opts.myId, open = S.open === p.player_id;
        let row = `<div class="ghs-row clickable${isMe ? ' me' : ''}" data-pid="${esc(p.player_id)}"><span class="fill" style="width:${Math.max(3, 100 * p.points / top).toFixed(0)}%"></span>` +
          `<span class="pos">${p.place <= 3 ? ['🥇', '🥈', '🥉'][p.place - 1] : p.place}</span>${avatar(p, 24)}` +
          `<span class="nm">${esc(p.display_name)}${isMe ? ` <span style="font-size:10px;color:var(--accent)">(${esc(tr('gh_you'))})</span>` : ''}</span>` +
          `<span class="sub">${p.games} ${esc(tr('gs_games_short'))}</span><span class="val">${esc(num(p.points, 1))}</span></div>`;
        if (open) {
          row += `<div class="ghs-det">` + p.ladders.slice().sort((a, b) => b.points - a.points).map(l => {
            const g = d.game_meta[l.game_id] || {};
            return `<div><span>${iconHTML(g)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name || l.game_id)} ${l.mode === 'multi' ? '👥' : '👤'}</span>` +
              `<span class="ghs-muted">#${l.place} ${esc(tr('gs_of', { n: l.ladder_size }))}</span><b style="min-width:42px;text-align:right">${esc(num(l.points, 1))}</b></div>`;
          }).join('') + (opts.onPlayer ? `<button class="ghs-link" data-prof="${esc(p.player_id)}" style="text-align:left">${esc(tr('gs_open_profile'))}</button>` : '') + `</div>`;
        }
        return row;
      }).join('') + `</div>`;
      h += `<div class="ghs-box"><h4>${esc(tr('gs_how_points'))}</h4><div class="ghs-muted" style="line-height:1.5">${esc(tr('gs_how_text'))}</div></div>`;
      root.innerHTML = h;
      bind();
      root.querySelectorAll('.ghs-row[data-pid]').forEach(r => r.onclick = () => { S.open = S.open === r.dataset.pid ? null : r.dataset.pid; draw(); });
      root.querySelectorAll('[data-prof]').forEach(b => b.onclick = () => {
        const p = d.players.find(x => x.player_id === b.dataset.prof);
        if (p && opts.onPlayer) opts.onPlayer({ id: p.player_id, ...p });
      });
    }
    function bind() { root.querySelector('#gso-period')?.addEventListener('change', e => { S.period = e.target.value; load(); }); }

    load();
    return { reload: load };
  }

  // ── One player against another ──────────────────────────────────────────
  //   GHStats.renderVersus(el, { otherId, otherName, myName, token, game, gameInfo(id), onGame(id) })
  async function renderVersus(el, o) {
    injectStyle();
    el.innerHTML = `<div class="ghs-empty">${esc(tr('gs_loading'))}</div>`;
    let d;
    try { d = await get(`/versus/${encodeURIComponent(o.otherId)}${o.game ? '?game=' + encodeURIComponent(o.game) : ''}`, o.token); }
    catch (_) { el.innerHTML = ''; return; }
    const me = o.myName || tr('gs_you'), them = o.otherName || '?';
    const sh = d.shared;
    if (!sh.games) {
      el.innerHTML = `<div class="gv-sec"><div class="ghs-muted">${esc(tr('gv_no_shared', { name: them }))}</div></div>`;
      return;
    }
    const pct = n => sh.games ? 100 * n / sh.games : 0;
    const verdict = sh.mine > sh.theirs ? tr('gv_verdict_lead', { a: sh.mine, b: sh.theirs, n: sh.games })
      : sh.mine < sh.theirs ? tr('gv_verdict_trail', { name: them, a: sh.mine, b: sh.theirs, n: sh.games })
      : tr('gv_verdict_tie', { a: sh.mine, b: sh.theirs, n: sh.games });
    let h = `<div class="gv-sec"><h4>${esc(tr('gv_record'))}</h4>
      <div class="gv-score">
        <div><div class="n" style="color:var(--accent)">${sh.mine}</div><div class="l">${esc(me)}</div></div>
        <div><div class="n" style="color:var(--fg2)">${sh.draws}</div><div class="l">${esc(tr('gv_draws'))}</div></div>
        <div><div class="n">${sh.theirs}</div><div class="l">${esc(them)}</div></div>
      </div>
      <div class="gv-split"><i style="width:${pct(sh.mine)}%;background:var(--accent)"></i><i style="width:${pct(sh.draws)}%;background:var(--fg2)"></i><i style="width:${pct(sh.theirs)}%;background:var(--red)"></i></div>
      <div class="gv-verdict">${esc(verdict)}</div></div>`;

    // Chance of winning next time, from both ratings.
    const chances = Object.entries(d.chance);
    if (o.game && d.chance[o.game]) {
      const c = d.chance[o.game];
      h += `<div class="gv-sec"><h4>${esc(tr('gv_chance'))}</h4><div class="gv-chance"><div class="big">${c.p}%</div>
        <div class="ghs-muted">${esc(tr('gv_ratings', { me: c.me, them: c.them, name: them }))}<br>${esc(tr('gv_chance_hint'))}</div></div></div>`;
    }

    // Recent form and streaks.
    const dots = f => f.last.length ? `<span class="gv-dots">${f.last.map(w => `<i style="background:var(${w ? '--green' : '--red'})" title="${esc(tr(w ? 'gv_win' : 'gv_loss'))}"></i>`).join('')}</span>` : `<span class="ghs-muted">${esc(tr('gv_no_form'))}</span>`;
    const streak = f => Math.abs(f.current) >= 2 ? `<span class="ghs-muted">${esc(tr(f.current > 0 ? 'gv_streak_win' : 'gv_streak_loss', { n: Math.abs(f.current) }))}</span>` : '';
    h += `<div class="gv-sec"><h4>${esc(tr('gv_form'))}</h4>
      <div class="gv-form"><b>${esc(me)}</b>${dots(d.form.me)}${streak(d.form.me)}<span class="ghs-muted">${esc(tr('gv_best_streak', { n: d.form.me.best }))}</span></div>
      <div class="gv-form"><b>${esc(them)}</b>${dots(d.form.them)}${streak(d.form.them)}<span class="ghs-muted">${esc(tr('gv_best_streak', { n: d.form.them.best }))}</span></div></div>`;

    // By game: tapping one compares every number for it.
    if (!o.game && d.per_game.length) {
      h += `<div class="gv-sec"><h4>${esc(tr('gv_by_game'))}</h4>` + d.per_game.map(g => {
        const gi = o.gameInfo ? o.gameInfo(g.game_id) : { name: g.game_id, icon: '🎮' };
        const c = d.chance[g.game_id];
        return `<div class="gv-g" data-g="${esc(g.game_id)}"><span>${gi.iconHTML || iconHTML(gi)}</span><span class="nm">${esc(gi.name)}</span>
          <span class="ghs-wld" style="max-width:90px" title="${g.mine} / ${g.draws} / ${g.theirs}"><i style="width:${100 * g.mine / g.n}%;background:var(--green)"></i><i style="width:${100 * g.draws / g.n}%;background:var(--fg2)"></i><i style="width:${100 * g.theirs / g.n}%;background:var(--red)"></i></span>
          <span style="min-width:54px;text-align:right"><span style="color:var(--green)">${g.mine}</span> · ${g.draws} · <span style="color:var(--red)">${g.theirs}</span></span>
          ${c ? `<span class="ghs-muted" style="min-width:36px;text-align:right" title="${esc(tr('gv_chance'))}">${Math.round(c.p)}%</span>` : ''}</div>`;
      }).join('') + `<div class="ghs-muted">${esc(tr('gv_pick_game'))}</div></div>`;
    }

    // Side by side, for one chosen game.
    if (o.game && d.compare) {
      const A = d.compare.me, B = d.compare.them;
      const rows = [];
      const bar = (label, a, b, type, better, extra) => {
        if (a == null && b == null) return;
        const hiN = Math.max(Math.abs(a || 0), Math.abs(b || 0)) || 1;
        const lead = a == null || b == null || a === b ? 0 : ((better === 'low') ? (a < b ? 1 : -1) : (a > b ? 1 : -1));
        const diff = a != null && b != null && a !== b && Math.min(Math.abs(a), Math.abs(b)) > 0
          ? Math.round(100 * Math.abs(a - b) / Math.min(Math.abs(a), Math.abs(b))) : null;
        const line = (name, v, mine, lead_) => `<div class="gv-bar"><span class="w">${esc(name)}</span><span class="t"><i style="width:${v == null ? 0 : Math.max(3, 100 * Math.abs(v) / hiN)}%;background:${mine ? 'var(--accent)' : 'var(--red)'}"></i></span><span class="v${lead_ ? ' lead' : ''}">${esc(fmt(v, type))}</span></div>`;
        rows.push(`<div class="gv-m"><div class="h"><span>${esc(label)}</span>${diff != null ? `<span>${lead > 0 ? '▲ ' + esc(me) : '▲ ' + esc(them)} ${diff}%</span>` : ''}</div>${line(me, a, true, lead > 0)}${line(them, b, false, lead < 0)}</div>`);
      };
      bar(tr('gs_games_played'), A && A.played, B && B.played, 'number', 'high');
      bar(tr('gv_multi_games'), A && A.multi.played, B && B.multi.played, 'number', 'high');
      bar(tr('gs_win_rate'), A && A.multi.win_rate, B && B.multi.win_rate, 'percent', 'high');
      if (d.chance[o.game]) bar(tr('gs_rating'), d.chance[o.game].me, d.chance[o.game].them, 'number', 'high');
      d.decl.metrics.forEach(m => {
        bar(labelOf(m) + ' · ' + tr(m.better === 'low' ? 'gs_best_low' : 'gs_best'), A && A.best[m.key], B && B.best[m.key], m.type, m.better);
        bar(labelOf(m) + ' · ' + tr('gs_avg'), A && A.avg[m.key], B && B.avg[m.key], m.type, m.better);
      });
      bar(tr('gs_time_played'), A && A.seconds, B && B.seconds, 'duration', 'high');
      h += `<div class="gv-sec"><h4>${esc(tr('gv_side_by_side'))}</h4>${rows.join('') || `<div class="ghs-muted">${esc(tr('gs_no_data'))}</div>`}</div>`;
      const hm = d.rating_history.me.map(p => [new Date(p[0]).getTime(), p[1]]), ht = d.rating_history.them.map(p => [new Date(p[0]).getTime(), p[1]]);
      if (hm.length >= 2 && ht.length >= 2) {
        h += `<div class="gv-sec"><h4>${esc(tr('gv_rating_chart'))}</h4>` +
          lineChart([{ name: me, color: 'var(--accent)', pts: hm }, { name: them, color: 'var(--red)', pts: ht }], { type: 'number' }) +
          `<div class="ghs-leg"><span><i style="background:var(--accent)"></i>${esc(me)}</span><span><i style="background:var(--red)"></i>${esc(them)}</span></div></div>`;
      }
    }
    el.innerHTML = h;
    el.querySelectorAll('.gv-g').forEach(r => r.onclick = () => o.onGame && o.onGame(r.dataset.g));
  }

  window.GHStats = { renderGame, renderOverall, renderVersus };
})();
