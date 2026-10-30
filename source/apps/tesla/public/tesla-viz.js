// Tesla — units, charts and a small tile map. No libraries: everything is drawn here.
(function () {
  const t = (k, v) => (window.t || (x => x))(k, v);
  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Units: the server speaks km, kWh and °C ─────────────────────────────
  const U = {
    imperial: localStorage.getItem('tesla_units') === 'imperial',
    set(imp) { U.imperial = !!imp; localStorage.setItem('tesla_units', imp ? 'imperial' : 'metric'); },
    dist: km => U.imperial ? km / 1.609344 : km,
    distU: () => t(U.imperial ? 'tsl_u_mi' : 'tsl_u_km'),
    speed: kmh => U.imperial ? kmh / 1.609344 : kmh,
    speedU: () => t(U.imperial ? 'tsl_u_mph' : 'tsl_u_kmh'),
    temp: c => U.imperial ? c * 9 / 5 + 32 : c,
    tempU: () => U.imperial ? '°F' : '°C',
    eff: whkm => U.imperial ? whkm * 1.609344 : whkm,
    effU: () => t(U.imperial ? 'tsl_u_wh_mi' : 'tsl_u_wh_km'),
  };
  const nf = (n, d) => new Intl.NumberFormat(lang(), { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }).format(n);
  const fmt = {
    dist: (km, d) => nf(U.dist(km), d == null ? (U.dist(km) < 100 ? 1 : 0) : d) + ' ' + U.distU(),
    speed: kmh => nf(U.speed(kmh)) + ' ' + U.speedU(),
    temp: c => nf(U.temp(c)) + U.tempU(),
    eff: whkm => nf(U.eff(whkm)) + ' ' + U.effU(),
    kwh: (k, d) => nf(k, d == null ? (k < 10 ? 1 : 0) : d) + ' ' + t('tsl_u_kwh'),
    kw: k => nf(k) + ' ' + t('tsl_u_kw'),
    dur(sec) {
      const m = Math.max(1, Math.round(sec / 60)), h = Math.floor(m / 60);
      return h ? h + ' ' + t('tsl_u_h') + (m % 60 ? ' ' + (m % 60) + ' ' + t('tsl_u_min') : '') : m + ' ' + t('tsl_u_min');
    },
    date: ts => window.mvmOS&&window.mvmOS.dateTimePicker ? window.mvmOS.dateTimePicker.format(window.mvmOS.dateTimePicker.fromEpoch(ts,{type:'date'}),{type:'date'}) : new Date(ts * 1000).toLocaleDateString(lang(), { weekday: 'short', day: 'numeric', month: 'short' }),
    dateTime: ts => window.mvmOS&&window.mvmOS.dateTimePicker ? window.mvmOS.dateTimePicker.format(window.mvmOS.dateTimePicker.fromEpoch(ts)) : new Date(ts * 1000).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    time: ts => window.mvmOS&&window.mvmOS.dateTimePicker ? window.mvmOS.dateTimePicker.format(window.mvmOS.dateTimePicker.fromEpoch(ts,{type:'time'}),{type:'time'}) : new Date(ts * 1000).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }),
    ago(ts, now) {
      const s = Math.max(0, (now || Date.now() / 1000) - ts);
      if (s < 90) return t('tsl_ago_now');
      if (s < 3600) return t('tsl_ago_min', { n: Math.round(s / 60) });
      if (s < 86400) return t('tsl_ago_h', { n: Math.round(s / 3600) });
      return t('tsl_ago_d', { n: Math.round(s / 86400) });
    },
  };

  // ── Battery ring ────────────────────────────────────────────────────────
  function ring(pct, o) {
    o = o || {};
    const r = 86, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
    const col = o.charging ? '#4ade80' : p <= 15 ? '#f87171' : p <= 30 ? '#fbbf24' : '#60a5fa';
    const lim = o.limit ? (() => {
      const a = (o.limit / 100) * 2 * Math.PI - Math.PI / 2;
      return `<line x1="${100 + Math.cos(a) * 76}" y1="${100 + Math.sin(a) * 76}" x2="${100 + Math.cos(a) * 96}" y2="${100 + Math.sin(a) * 96}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>`;
    })() : '';
    return `<svg class="tsl-ring" viewBox="0 0 200 200"><defs><linearGradient id="tslg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity=".55"/></linearGradient></defs>
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--pub-surface2,#2a3144)" stroke-width="14"/>
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="url(#tslg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c * p / 100} ${c}" transform="rotate(-90 100 100)" class="${o.charging ? 'tsl-pulse' : ''}"/>${lim}
      <text x="100" y="104" text-anchor="middle" class="tsl-ring-v">${p == null ? '–' : Math.round(p)}<tspan class="tsl-ring-u">%</tspan></text>
      <text x="100" y="134" text-anchor="middle" class="tsl-ring-s">${esc(o.sub || '')}</text></svg>`;
  }

  // ── Car picture, tinted with the real colour ────────────────────────────
  const COLORS = { PearlWhite: '#e9edf3', SolidBlack: '#1b1d22', DeepBlue: '#1f3a6e', MidnightSilver: '#6a7280', Silver: '#aab1bd', Red: '#b3202a', RedMulticoat: '#b3202a', StealthGrey: '#515862', QuickSilver: '#c7cdd6', UltraRed: '#c2182a', MidnightCherryRed: '#4a0f1a', Grey: '#60666f', Blue: '#2b5fb4', White: '#e9edf3', Black: '#1b1d22' };
  let carSeq = 0;
  function car(color, o) {
    o = o || {};
    const c = COLORS[color] || '#cfd5df', id = 'tslcar' + (++carSeq);
    const doors = o.doors || {}, windows = o.windows || {}, tires = o.tires || {};
    const wheel = (key, x, y) => `<rect x="${x}" y="${y}" width="17" height="53" rx="7" fill="#080c13" stroke="${tires[key] === 'bad' ? '#f87171' : tires[key] === 'warn' ? '#fbbf24' : '#465265'}" stroke-width="2"/><path d="M${x + 4} ${y + 9}v35 M${x + 12} ${y + 9}v35" stroke="#718096" stroke-opacity=".3"/>`;
    // Each side is an actual hinged body panel with its own shaped glass.
    // Opening a door removes that panel from the body and rotates the same panel.
    const frontPanel = 'M44 161Q54 164 68 174L64 235L43 238Z';
    const rearPanel = 'M43 239L64 237L63 299L46 319Q42 283 43 239Z';
    const frontGlass = 'M51 173L64 179L61 228L49 231Z';
    const rearGlass = 'M49 246L61 242L60 294L48 309Z';
    const sideDoor = (key, rear, right) => {
      const open = !!doors[key], lowered = windows[key], known = lowered != null;
      const y = rear ? 240 : 162, panel = rear ? rearPanel : frontPanel;
      const glass = rear ? rearGlass : frontGlass;
      const state = lowered ? 'open' : known ? 'closed' : 'unknown';
      // Mirroring the complete door keeps the hinge and glass aligned on both sides.
      return `<g ${right ? 'transform="translate(240 0) scale(-1 1)"' : ''}>
        ${open ? `<g class="tsl-door-opening"><path d="${panel}" fill="#060c14" stroke="#536375" stroke-width="1.2"/><path d="M48 ${y + 10}L59 ${y + 15}L56 ${y + 57}L47 ${y + 62}Z" fill="#202d3b"/><path d="M48 ${y + 18}L56 ${y + 23}M47 ${y + 48}L55 ${y + 52}" stroke="#738195" stroke-opacity=".45" stroke-width="2"/></g>` : ''}
        <g class="${open ? 'tsl-open-door' : 'tsl-door closed'}" data-door="${key}" ${open ? `transform="rotate(34 45 ${y})"` : ''}>
          <path d="${panel}" fill="url(#${id}paint)" stroke="${open ? '#c4d0dc' : '#718093'}" stroke-opacity="${open ? '.9' : '.6'}" stroke-width="1"/>
          <g class="tsl-window ${state}" data-window="${key}">
            <path d="${glass}" fill="${lowered ? '#070d16' : `url(#${id}sideglass)`}" stroke="${lowered ? '#394655' : '#bed4e1'}" stroke-opacity="${known ? '.8' : '.35'}" stroke-width=".9"/>
            ${lowered ? `<path d="${rear ? 'M48 308L60 294' : 'M49 230L61 227'}" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/><path d="${rear ? 'M51 251L51 290' : 'M54 182L52 218'}" stroke="#334355" stroke-width="3"/>` : `<path d="${rear ? 'M52 249L54 287M57 247L57 277' : 'M55 180L54 216M60 182L58 209'}" stroke="#d7f0ff" stroke-width="1.4" stroke-opacity="${known ? '.48' : '.2'}"/>`}
          </g>
          <path d="${rear ? 'M45 289L46 297' : 'M45 218L45 226'}" stroke="#172333" stroke-width="2" stroke-linecap="round"/>
          ${!rear ? `<path d="M44 166L28 171Q24 177 29 181L44 177Z" fill="${c}" stroke="#9eacba" stroke-width=".8"/>` : ''}
          ${open ? `<path d="${rear ? 'M44 242L46 317' : 'M44 163L43 235'}" stroke="#fbbf24" stroke-opacity=".8" stroke-width="1.3"/>` : ''}
        </g></g>`;
    };
    return `<svg class="tsl-car" viewBox="0 0 240 440" aria-hidden="true"><defs>
      <linearGradient id="${id}paint" x1="0" x2="1"><stop stop-color="#101827"/><stop offset=".12" stop-color="${c}"/><stop offset=".38" stop-color="${c}"/><stop offset=".5" stop-color="#fff"/><stop offset=".59" stop-color="${c}"/><stop offset=".87" stop-color="${c}"/><stop offset="1" stop-color="#101827"/></linearGradient>
      <linearGradient id="${id}glass" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#415b73"/><stop offset=".4" stop-color="#152333"/><stop offset=".75" stop-color="#09111e"/><stop offset="1" stop-color="#263c50"/></linearGradient>
      <linearGradient id="${id}shine" x1="0" x2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}sideglass" x1="0" y1="0" x2="1" y2=".5"><stop stop-color="#7196aa"/><stop offset=".35" stop-color="#36586d"/><stop offset="1" stop-color="#0d1b2b"/></linearGradient>
      <mask id="${id}bodymask" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="440"><rect width="240" height="440" fill="white"/>
        <path d="${frontPanel}" fill="black"/><path d="${rearPanel}" fill="black"/><path d="${frontPanel}" transform="translate(240 0) scale(-1 1)" fill="black"/><path d="${rearPanel}" transform="translate(240 0) scale(-1 1)" fill="black"/>
      </mask>
      <clipPath id="${id}cabin"><path d="M69 174Q120 161 171 174L177 296Q120 314 63 296Z"/></clipPath>
      <linearGradient id="${id}air" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b8f4ff" stop-opacity=".4"/><stop offset=".5" stop-color="#53ccf6" stop-opacity=".17"/><stop offset="1" stop-color="#4abcf0" stop-opacity="0"/></linearGradient>
      <filter id="${id}shadow" x="-50%" y="-20%" width="200%" height="145%"><feGaussianBlur stdDeviation="9"/></filter>
      </defs>
      <ellipse cx="120" cy="232" rx="89" ry="194" fill="#000" opacity=".4" filter="url(#${id}shadow)"/>
      ${wheel('fl', 31, 103)}${wheel('fr', 192, 103)}${wheel('rl', 31, 306)}${wheel('rr', 192, 306)}
      <path d="M120 21C74 21 52 33 44 76C37 121 42 164 43 214L42 320C43 365 48 395 62 408C83 424 157 424 178 408C192 395 197 365 198 320L197 214C198 164 203 121 196 76C188 33 166 21 120 21Z" mask="url(#${id}bodymask)" fill="url(#${id}paint)" stroke="#94a3b8" stroke-opacity=".45"/>
      <path d="M120 27C82 27 59 38 53 72C47 94 49 110 52 126Q120 110 188 126C191 110 193 94 187 72C181 38 158 27 120 27Z" fill="${c}"/>
      <path d="M67 56Q120 37 173 56M65 68L61 112M175 68L179 112" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
      <path d="M58 126Q120 109 182 126L173 175Q120 159 67 175Z" fill="url(#${id}glass)" stroke="#0b1421" stroke-width="3"/>
      <path d="M69 180Q120 166 171 180L177 296Q120 314 63 296Z" fill="url(#${id}glass)" stroke="#09111b" stroke-width="3"/>
      <path d="M67 308Q120 325 173 308L183 353Q120 378 57 353Z" fill="url(#${id}glass)" stroke="#0b1421" stroke-width="3"/>
      <path d="M64 129L68 174L64 235L63 299L60 318M176 129L172 174L176 235L177 299L180 318" fill="none" stroke="#0c1522" stroke-width="3"/>
      <path d="M49 74Q57 63 68 64L66 79L49 88M191 74Q183 63 172 64L174 79L191 88" fill="#e2f1ff" stroke="#c5d4df"/>
      <path d="M53 384L77 391M187 384L163 391" stroke="#fb5468" stroke-width="5" stroke-linecap="round"/>
      <path d="M65 397Q120 413 175 397M73 375Q120 386 167 375" fill="none" stroke="#0c1522" stroke-opacity=".5" stroke-width="2"/>
      <path d="M93 31Q78 216 91 410H109Q100 210 111 25Z" fill="url(#${id}shine)"/>
      ${sideDoor('dr', true, false)}${sideDoor('pr', true, true)}${sideDoor('df', false, false)}${sideDoor('pf', false, true)}
      ${doors.ft ? '<path d="M57 103Q120 82 183 103" fill="none" stroke="#fbbf24" stroke-width="4"/>' : ''}
      ${doors.rt ? '<path d="M58 373Q120 397 182 373" fill="none" stroke="#fbbf24" stroke-width="4"/>' : ''}
      ${o.climate ? `<g class="tsl-climate-flow" clip-path="url(#${id}cabin)">
        <g class="tsl-climate-haze" fill="url(#${id}air)"><path d="M78 171L99 171Q97 214 106 292L67 292Q80 214 78 171Z"/><path d="M141 171L162 171Q160 214 173 292L134 292Q143 214 141 171Z"/></g>
        ${[0, 1, 2, 3, 4, 5].map(i => {
          const right = i >= 3, lane = i % 3;
          const x = (right ? 145 : 80) + lane * 6;
          const end = x + (lane - 1) * 4;
          return `<path class="tsl-climate-stream" d="M${x} 175C${x - 4} 203 ${end + 4} 239 ${end} 287" style="animation-delay:-${i * .37}s;opacity:${lane === 1 ? '.9' : '.5'}"/>`;
        }).join('')}
        <path d="M76 174Q89 170 103 174M137 174Q151 170 165 174" fill="none" stroke="#c9f5ff" stroke-width="2" stroke-linecap="round" opacity=".7"/>
      </g>` : ''}
      ${o.port ? '<circle cx="190" cy="365" r="6" fill="#4ade80" stroke="#dcfce7" stroke-width="2"/>' : ''}
      </svg>`;
  }

  // ── Charts ──────────────────────────────────────────────────────────────
  // cfg: { type:'line'|'bars'|'dots'|'stack', series:[{label,color,data:[[x,y]]}], xFmt, yFmt, yMin, yMax, height }
  let seq = 0;
  function chart(el, cfg) {
    const W = Math.max(260, Math.round(el.clientWidth || 640)), H = cfg.height || 200, L = 46, R = 10, T = 12, B = 26;
    const all = [].concat.apply([], cfg.series.map(s => s.data));
    el.innerHTML = '';
    if (!all.length) { el.innerHTML = `<div class="tsl-empty">${esc(cfg.empty || t('tsl_stats_none'))}</div>`; return; }
    let xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    let y0 = cfg.yMin != null ? cfg.yMin : Math.min(0, Math.min.apply(null, ys)), y1 = cfg.yMax != null ? cfg.yMax : Math.max.apply(null, ys);
    if (cfg.type === 'stack') { y1 = cfg.yMax != null ? cfg.yMax : Math.max.apply(null, cfg.series[0].data.map((_, i) => cfg.series.reduce((a, s) => a + (s.data[i] ? s.data[i][1] : 0), 0))); }
    if (y1 <= y0) y1 = y0 + 1;
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    const bars = cfg.type === 'bars' || cfg.type === 'stack';
    const n = cfg.series[0].data.length, bw = bars ? Math.max(3, Math.min(34, (W - L - R) / Math.max(1, n) * 0.7)) : 0;
    const padX = bars ? (W - L - R) / Math.max(1, n) / 2 : 0;
    const X = x => L + padX + (x - x0) / (x1 - x0) * (W - L - R - padX * 2);
    const Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const nice = (y1 - y0) / 4;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = y0 + nice * i, y = Y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="tsl-grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="tsl-ax">${esc(cfg.yFmt ? cfg.yFmt(v) : nf(v, v < 10 ? 1 : 0))}</text>`;
    }
    const tickData = cfg.segmented ? all.slice().sort((a,b)=>a[0]-b[0]) : cfg.series[0].data;
    const ticks = Math.min(Math.max(2, Math.floor(W / 120)), tickData.length, 6);
    for (let i = 0; i < ticks; i++) {
      const idx = ticks === 1 ? 0 : Math.round(i * (tickData.length - 1) / (ticks - 1));
      const p = tickData[idx];
      if (p) g += `<text x="${X(p[0])}" y="${H - 8}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}" class="tsl-ax">${esc(cfg.xFmt ? cfg.xFmt(p[0]) : p[0])}</text>`;
    }
    const id = 'tslh' + (++seq);
    let body = '';
    cfg.series.forEach((s, si) => {
      const col = s.color || '#60a5fa';
      if (cfg.type === 'line') {
        const pts = s.data.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1));
        if (cfg.area !== false) body += `<polygon points="${X(s.data[0][0])},${Y(y0)} ${pts.join(' ')} ${X(s.data[s.data.length - 1][0])},${Y(y0)}" fill="${col}" opacity=".16"/>`;
        body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
      } else if (cfg.type === 'dots') {
        body += s.data.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3.6" fill="${col}" opacity=".7"/>`).join('');
      } else if (cfg.type === 'bars') {
        body += s.data.map(p => `<rect x="${(X(p[0]) - bw / 2).toFixed(1)}" y="${Y(Math.max(p[1], 0)).toFixed(1)}" width="${bw}" height="${Math.max(0, Y(y0) - Y(Math.max(p[1], 0))).toFixed(1)}" rx="3" fill="${col}"/>`).join('');
      } else if (cfg.type === 'stack') {
        body += s.data.map((p, i) => {
          const below = cfg.series.slice(0, si).reduce((a, q) => a + (q.data[i] ? q.data[i][1] : 0), 0);
          return `<rect x="${(X(p[0]) - bw / 2).toFixed(1)}" y="${Y(below + p[1]).toFixed(1)}" width="${bw}" height="${Math.max(0, Y(below) - Y(below + p[1])).toFixed(1)}" fill="${col}"/>`;
        }).join('');
      }
    });
    el.innerHTML = `<div class="tsl-chart"><svg viewBox="0 0 ${W} ${H}" id="${id}">${g}${body}<line class="tsl-cross" y1="${T}" y2="${H - B}" x1="0" x2="0" style="display:none"/></svg><div class="tsl-tip" style="display:none"></div></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tsl-tip'), cross = el.querySelector('.tsl-cross'), host = el.querySelector('.tsl-chart');
    const base = cfg.segmented ? all : cfg.series[0].data;
    function hover(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * W;
      let best = 0, bd = 1e9;
      base.forEach((p, i) => { const d = Math.abs(X(p[0]) - px); if (d < bd) { bd = d; best = i; } });
      const p = base[best];
      cross.setAttribute('x1', X(p[0])); cross.setAttribute('x2', X(p[0])); cross.style.display = '';
      const lines = cfg.series.filter(s=>!cfg.segmented || s.data.some(q=>q===p)).map(s => { const sample=s.data.reduce((a,q)=>!a||Math.abs(q[0]-p[0])<Math.abs(a[0]-p[0])?q:a,null); return sample ? `<span style="color:${s.color}">●</span> ${esc(s.label ? s.label + ': ' : '')}${esc(cfg.tipFmt ? cfg.tipFmt(sample[1], s) : (cfg.yFmt ? cfg.yFmt(sample[1]) : nf(sample[1], 1)))}` : ''; }).join('<br>');
      tip.innerHTML = `<b>${esc(cfg.xFmt ? cfg.xFmt(p[0], true) : p[0])}</b><br>${lines}`;
      tip.style.display = '';
      const left = X(p[0]) / W * host.clientWidth;
      tip.style.left = Math.min(host.clientWidth - tip.offsetWidth - 4, Math.max(4, left - tip.offsetWidth / 2)) + 'px';
    }
    svg.addEventListener('mousemove', hover);
    svg.addEventListener('touchmove', hover, { passive: true });
    svg.addEventListener('touchstart', hover, { passive: true });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.style.display = 'none'; });
  }

  // 48 hour activity strip.
  const STATE_COL = { online: '#60a5fa', asleep: '#475569', offline: '#7c3aed', driving: '#fbbf24', charging: '#4ade80' };
  function strip(tl) {
    const span = tl.now - tl.since;
    const segs = tl.rows.map(r => `<div style="left:${(r.start - tl.since) / span * 100}%;width:${Math.max(0.3, (r.end - r.start) / span * 100)}%;background:${STATE_COL[r.state] || '#64748b'}" title="${esc(tl.labels&&tl.labels[r.state]||t('tsl_st_' + r.state))} ${esc(fmt.dateTime(r.start))} – ${esc(fmt.time(r.end))}"></div>`).join('');
    const legend = Object.keys(STATE_COL).map(k => `<span><i style="background:${STATE_COL[k]}"></i>${esc(t('tsl_st_' + k))}</span>`).join('');
    return `<div class="tsl-strip">${segs}</div><div class="tsl-legend">${legend}</div>`;
  }

  // ── Tile map ────────────────────────────────────────────────────────────
  // route: [[lat,lng,value?]]; opts: { marker:[lat,lng], color(v) }
  function tileMap(el, route, opts) {
    opts = opts || {};
    const TILE = 256;
    const mx = lng => (lng + 180) / 360;
    const my = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
    let routes, markers, all;
    function geometry() {
      routes = (opts.routes || [route || []]).map(r => r.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
      markers = opts.markers || [];
      all = routes.flat().concat(opts.marker ? [opts.marker] : [], markers.map(m => [m.lat, m.lng]),opts.circle?[[opts.circle.lat,opts.circle.lng]]:[]);
      if(opts.circle){const c=opts.circle,dy=c.radius/111320,dx=dy/Math.max(.01,Math.cos(c.lat*Math.PI/180));all.push([c.lat-dy,c.lng-dx],[c.lat+dy,c.lng+dx]);}
    }
    geometry();
    el.innerHTML = '<div class="tsl-map"><div class="tsl-tiles"></div><svg class="tsl-route"></svg><div class="tsl-zoom"><button type="button" data-z="1">+</button><button type="button" data-z="-1">−</button></div><div class="tsl-attr">© OpenStreetMap</div></div>';
    const box = el.firstChild, tiles = box.querySelector('.tsl-tiles'), svg = box.querySelector('svg');
    if (!all.length) { box.innerHTML = `<div class="tsl-empty">${esc(t('tsl_no_position'))}</div>`; return; }
    let z = 15, cx = 0.5, cy = 0.5, dead = false, interacted = false;
    const tileNodes = new Map();
    function fit() {
      const w = box.clientWidth || 600, h = box.clientHeight || 300;
      const xs = all.map(p => mx(p[1])), ys = all.map(p => my(p[0]));
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
      z = 16;
      for (; z > 3; z--) { const s = TILE * Math.pow(2, z); if ((x1 - x0) * s < w * 0.8 && (y1 - y0) * s < h * 0.8) break; }
    }
    function draw() {
      if (dead) return;
      const w = box.clientWidth, h = box.clientHeight, s = TILE * Math.pow(2, z);
      const ox = cx * s - w / 2, oy = cy * s - h / 2;
      const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE), tx1 = Math.floor((ox + w) / TILE), ty1 = Math.floor((oy + h) / TILE);
      const visible = new Set(), n = Math.pow(2, z);
      for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
        if (y < 0 || y >= n) continue;
        const key = `${z}/${x}/${y}`; visible.add(key);
        let tile = tileNodes.get(key);
        if (!tile) {
          tile = document.createElement('img');
          const url = `https://tile.openstreetmap.org/${z}/${((x % n) + n) % n}/${y}.png`;
          tile.src = window.asset ? window.asset(url) : url;
          tile.draggable = false; tile.alt = ''; tile.dataset.tile = key;
          tileNodes.set(key, tile); tiles.appendChild(tile);
        }
        tile.style.left = (x * TILE - ox) + 'px'; tile.style.top = (y * TILE - oy) + 'px';
      }
      for (const [key, tile] of tileNodes) if (!visible.has(key)) { tile.remove(); tileNodes.delete(key); }
      const P = p => [(mx(p[1]) * s - ox), (my(p[0]) * s - oy)];
      let out = '';
      if(opts.circle){const c=opts.circle,m=P([c.lat,c.lng]),r=c.radius/(40075016.686*Math.cos(c.lat*Math.PI/180))*s;out+=`<circle cx="${m[0]}" cy="${m[1]}" r="${r}" fill="#60a5fa" fill-opacity=".18" stroke="#60a5fa" stroke-width="2"/><circle cx="${m[0]}" cy="${m[1]}" r="4" fill="#fff"/>`;}
      for (const pts of routes) {
      if (pts.length) {
        for (let i = 1; i < pts.length; i++) {
          const a = P(pts[i - 1]), b = P(pts[i]);
          if(Math.max(a[0],b[0]) < -10 || Math.min(a[0],b[0]) > box.clientWidth+10 || Math.max(a[1],b[1]) < -10 || Math.min(a[1],b[1]) > box.clientHeight+10)continue;
          out += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${opts.color ? opts.color(pts[i][2]) : '#3b82f6'}" stroke-width="5" stroke-linecap="round"/>`;
        }
        const a = P(pts[0]), b = P(pts[pts.length - 1]);
        out += `<circle cx="${a[0]}" cy="${a[1]}" r="8" fill="#22c55e" stroke="#fff" stroke-width="3"/><circle cx="${b[0]}" cy="${b[1]}" r="8" fill="#ef4444" stroke="#fff" stroke-width="3"/>`;
      }
      }
      markers.forEach(marker => {
        const m = P([marker.lat, marker.lng]);
        out += `<g><title>${esc(marker.label || t('tsl_tab_charges'))}</title><circle cx="${m[0]}" cy="${m[1]}" r="12" fill="#34d399" stroke="#fff" stroke-width="2"/><text x="${m[0]}" y="${m[1]+5}" text-anchor="middle" font-size="15" fill="#052e26">ϟ</text></g>`;
      });
      if (opts.marker) {
        const m = P(opts.marker);
        out += `<circle cx="${m[0]}" cy="${m[1]}" r="18" fill="#3b82f6" opacity=".25"/><circle cx="${m[0]}" cy="${m[1]}" r="8" fill="#3b82f6" stroke="#fff" stroke-width="3"/>`;
      }
      svg.innerHTML = out;
      drawCursor();
    }
    // Keep help inside the map; it must not initiate a map pan or zoom.
    const help=document.createElement('div');help.className='tsl-map-help';
    const helpId='tsl-map-legend-'+(++seq);
    const closeHelp=()=>{const panel=help.querySelector('.tsl-map-legend'),button=help.querySelector('button');if(panel)panel.hidden=true;if(button)button.setAttribute('aria-expanded','false');};
    function legend() {
      help.hidden=!(opts.color && routes.some(r=>r.length>1));
      if(help.hidden)return;
      const speed=v=>nf(U.speed(v),U.imperial?1:0),unit=U.speedU();
      const row=(color,label,point=false)=>`<div><i class="${point?'point':'line'}" style="--legend-color:${color}" aria-hidden="true"></i><span>${esc(label)}</span></div>`;
      help.innerHTML=`<button type="button" class="tsl-map-help-btn" aria-label="${esc(t('tsl_map_legend'))}" title="${esc(t('tsl_map_legend'))}" aria-expanded="false" aria-controls="${helpId}">?</button><div class="tsl-map-legend" id="${helpId}" role="region" aria-label="${esc(t('tsl_map_legend'))}" hidden><b>${esc(t('tsl_map_speed'))}</b>${row('#22c55e','< '+speed(30)+' '+unit)}${row('#eab308',speed(30)+' – < '+speed(70)+' '+unit)}${row('#f97316',speed(70)+' – < '+speed(110)+' '+unit)}${row('#ef4444','≥ '+speed(110)+' '+unit)}${row('#3b82f6',t('tsl_map_unknown'))}<div class="tsl-map-ends">${row('#22c55e',t('tsl_map_start'),true)}${row('#ef4444',t('tsl_map_finish'),true)}</div><p>${esc(t('tsl_map_note'))}</p></div>`;
      help.querySelector('button').onclick=()=>{const panel=help.querySelector('.tsl-map-legend');panel.hidden=!panel.hidden;help.querySelector('button').setAttribute('aria-expanded',String(!panel.hidden));};
    }
    box.appendChild(help);legend();
    box.addEventListener('keydown',e=>{if(e.key==='Escape'&&!help.hidden){closeHelp();help.querySelector('button').focus();e.stopPropagation();}});
    box.addEventListener('click',e=>{if(!e.target.closest('.tsl-map-help'))closeHelp();});
    let cursor = null, following=false, followListener=null;
    function releaseFollow(){if(following){following=false;if(followListener)followListener(false);}}
    function drawCursor() {
      const old=svg.querySelector('.tsl-replay-car');if(old)old.remove();if(!cursor)return;
      const scale=TILE*Math.pow(2,z),x=(mx(cursor.lng)-cx)*scale+box.clientWidth/2,y=(my(cursor.lat)-cy)*scale+box.clientHeight/2;
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','tsl-replay-car');g.setAttribute('transform',`translate(${x} ${y})`);g.innerHTML=`<circle r="20" fill="#60a5fa" opacity=".22"/><g transform="rotate(${cursor.heading||0})"><path d="m0-25-5 7h10z" fill="#fff"/><rect x="-9" y="-16" width="18" height="32" rx="7" fill="#fff" stroke="#172033" stroke-width="2"/><path d="M-6-7h12l-1 7H-5zM-5 8H5v4H-5z" fill="#1d4266"/></g>`;svg.appendChild(g);
    }
    fit();
    const pointers = new Map();
    let start = null, pinch = null, pinched = false;
    function clamp() { cy = Math.max(0, Math.min(1, cy)); }
    function midpoint() {
      const [a,b] = [...pointers.values()];
      return { x:(a.x+b.x)/2, y:(a.y+b.y)/2, distance:Math.hypot(a.x-b.x,a.y-b.y) };
    }
    function beginPinch() {
      const m = midpoint(), r = box.getBoundingClientRect(), s = TILE * Math.pow(2,z);
      pinch = { distance:Math.max(1,m.distance), z, x:cx+(m.x-r.left-box.clientWidth/2)/s, y:cy+(m.y-r.top-box.clientHeight/2)/s };
      pinched = true;
    }
    box.addEventListener('pointerdown', e => {
      if (e.target.closest('.tsl-zoom,.tsl-map-help') || e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if (pointers.size === 1) { start = { x:e.clientX,y:e.clientY }; pinched = false; }
      else if (pointers.size === 2) beginPinch();
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', e => {
      const previous = pointers.get(e.pointerId); if (!previous) return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if (pointers.size >= 2 && pinch) {
        releaseFollow();
        const m = midpoint(), r = box.getBoundingClientRect();
        z = Math.max(3,Math.min(18,Math.round(pinch.z+Math.log2(Math.max(1,m.distance)/pinch.distance))));
        const s = TILE*Math.pow(2,z);
        cx = pinch.x-(m.x-r.left-box.clientWidth/2)/s; cy = pinch.y-(m.y-r.top-box.clientHeight/2)/s;
        interacted = true;
      } else {
        const s = TILE*Math.pow(2,z);
        cx -= (e.clientX-previous.x)/s; cy -= (e.clientY-previous.y)/s;
        if (start && Math.hypot(e.clientX-start.x,e.clientY-start.y)>2){interacted = true;releaseFollow();}
      }
      clamp(); draw();
    });
    function endPointer(e, cancel) {
      if (!pointers.has(e.pointerId)) return;
      const pick = !cancel && !pinched && pointers.size===1 && start && Math.hypot(e.clientX-start.x,e.clientY-start.y)<5;
      pointers.delete(e.pointerId); pinch = null;
      if (pick && opts.onPick) {
        const r=box.getBoundingClientRect(),s=TILE*Math.pow(2,z),x=cx+(e.clientX-r.left-box.clientWidth/2)/s,y=cy+(e.clientY-r.top-box.clientHeight/2)/s;
        opts.onPick({lat:Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI,lng:x*360-180});
      }
      if (!pointers.size) start = null;
    }
    box.addEventListener('pointerup', e => endPointer(e,false));
    box.addEventListener('pointercancel', e => endPointer(e,true));
    box.addEventListener('lostpointercapture', e => endPointer(e,true));
    function zoomTo(next, x, y) {
      const oldScale=TILE*Math.pow(2,z), anchorX=cx+(x-box.clientWidth/2)/oldScale, anchorY=cy+(y-box.clientHeight/2)/oldScale;
      z=Math.max(3,Math.min(18,next));const scale=TILE*Math.pow(2,z);
      cx=anchorX-(x-box.clientWidth/2)/scale;cy=anchorY-(y-box.clientHeight/2)/scale;interacted=true;if(following&&cursor){cx=mx(cursor.lng);cy=my(cursor.lat);}clamp();draw();
    }
    box.addEventListener('wheel', e => {
      if(e.target.closest('.tsl-map-help'))return;
      e.preventDefault();const r=box.getBoundingClientRect();zoomTo(z+(e.deltaY<0?1:-1),e.clientX-r.left,e.clientY-r.top);
    }, { passive:false });
    box.querySelector('.tsl-zoom').addEventListener('click', e => {
      const b=e.target.closest('button');if(b)zoomTo(z+parseInt(b.dataset.z,10),box.clientWidth/2,box.clientHeight/2);
    });
    const redraw = () => { if(dead)return;if(!interacted)fit();draw(); };
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(redraw):null;
    if(observer)observer.observe(box);
    requestAnimationFrame(redraw);
    return {
      element:el, redraw,
      setCursor(next) { if(dead)return;cursor=next;if(following&&cursor){cx=mx(cursor.lng);cy=my(cursor.lat);interacted=true;clamp();draw();}else drawCursor(); },
      setFollow(enabled) {
        if(dead)return;
        const wasFollowing=following;following=!!enabled;
        if(following){if(!wasFollowing)z=14;interacted=true;if(cursor){cx=mx(cursor.lng);cy=my(cursor.lat);}clamp();draw();}
        else {interacted=false;fit();draw();}
        if(followListener)followListener(following);
      },
      onFollowChange(listener) {followListener=listener;},
      update(nextRoute,nextOpts) { if(dead)return;route=nextRoute||[];opts=nextOpts||{};geometry();legend();redraw(); },
      getView() { return { zoom:z, x:cx, y:cy, interacted, following }; },
      destroy() { dead=true;if(observer)observer.disconnect();pointers.clear();tileNodes.clear();followListener=null; }
    };
  }

  window.TeslaViz = { U, fmt, nf, esc, ring, car, chart, strip, tileMap, STATE_COL };
})();
