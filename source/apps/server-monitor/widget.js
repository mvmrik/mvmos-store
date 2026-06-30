// Bit Garden — desktop widget for Server Monitor
(async function () {
  const ID = 'server-monitor-garden';
  const SIZES = { s: { w: 180, h: 160 }, m: { w: 240, h: 220 }, l: { w: 320, h: 180 } };

  function drawPlant(growth, health, px) {
    const W = px, H = Math.round(px * 1.15);
    const cx = W / 2, ground = H - Math.round(H * 0.09);
    const sick   = health < 30;
    const wilted = health < 10;
    const leafC  = wilted ? '#6b4226' : sick ? '#a38a2a' : '#22c55e';
    const stemC  = wilted ? '#6b4226' : '#15803d';
    const bloomC = '#f9a8d4';
    const s      = W / 200;

    if (growth === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <ellipse cx="${cx}" cy="${ground+H*0.045}" rx="${W*0.36}" ry="${H*0.055}" fill="#3d2b1f"/>
        <ellipse cx="${cx}" cy="${ground}" rx="${W*0.05}" ry="${H*0.02}" fill="#5c4a2a"/>
      </svg>`;
    }

    const stemGrowthPct = Math.max(0, Math.min(1, (growth - 5) / 55));
    const maxStemH = H * 0.62;
    const stemH    = stemGrowthPct * maxStemH;
    const stemTop  = ground - stemH;
    const stemW    = growth >= 60 ? W*0.022 : growth >= 30 ? W*0.018 : W*0.012;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <ellipse cx="${cx}" cy="${ground+H*0.045}" rx="${W*0.36}" ry="${H*0.055}" fill="#3d2b1f"/>`;

    if (growth < 5) {
      const tipH = (growth / 5) * W * 0.07;
      svg += `<path d="M${cx},${ground} Q${cx+s*2},${ground-tipH*0.6} ${cx},${ground-tipH}"
        fill="none" stroke="${stemC}" stroke-width="${W*0.01}" stroke-linecap="round"/>`;
      return svg + '</svg>';
    }

    svg += `<path d="M${cx},${ground} Q${cx+W*0.04},${ground-stemH*0.5} ${cx-W*0.01},${stemTop}"
      fill="none" stroke="${stemC}" stroke-width="${stemW}" stroke-linecap="round"/>`;

    function lf(lx, ly, dir, size) {
      const ex = lx+dir*size, ey = ly-size*0.4;
      return `<path d="M${lx},${ly} Q${lx+dir*size*0.5},${ly-size*0.9} ${ex},${ey} Q${lx+dir*size*0.15},${ly-size*0.15} ${lx},${ly}"
        fill="${leafC}" opacity="${wilted?0.45:0.92}"/>`;
    }
    const ls = W * 0.09;

    if (growth >= 5)  svg += lf(cx+s*2, ground-stemH*0.35, 1,  Math.min(ls*0.85, ls*0.85*(growth-5)/5));
    if (growth >= 10) svg += lf(cx+s*2, ground-stemH*0.35, 1,  ls*0.85);
    if (growth >= 20) svg += lf(cx-s*2, ground-stemH*0.55, -1, ls * Math.min(1,(growth-20)/10));
    if (growth >= 30) { svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls); svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1 * Math.min(1,(growth-30)/10)); }
    if (growth >= 40) { svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls); svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1); svg += lf(cx-s*3, ground-stemH*0.86, -1, ls*0.9 * Math.min(1,(growth-40)/10)); }
    if (growth >= 50) { svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls); svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1); svg += lf(cx-s*3, ground-stemH*0.86, -1, ls*0.9); }

    if (growth >= 60) {
      svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls);
      svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1);  svg += lf(cx-s*3, ground-stemH*0.86, -1, ls*0.9);
      const budSc = Math.min(1,(growth-60)/10), br = W*0.016*budSc;
      if (br > 0.5) for (let i=0;i<3;i++) { const a=(i/3)*Math.PI*2-Math.PI/2; svg += `<circle cx="${(cx-s*3)+Math.cos(a)*W*0.03*budSc}" cy="${stemTop+Math.sin(a)*W*0.03*budSc}" r="${br}" fill="${bloomC}" opacity=".7"/>`; }
    }

    if (growth >= 70) {
      svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls);
      svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1);  svg += lf(cx-s*3, ground-stemH*0.86, -1, ls*0.9);
      const sc=Math.min(1,(growth-70)/10), bx=cx-s*3, by=stemTop, pr=W*(0.03+sc*0.02);
      for (let i=0;i<5;i++) { const a=(i/5)*Math.PI*2, px2=bx+Math.cos(a)*pr, py2=by+Math.sin(a)*pr; svg += `<ellipse cx="${px2}" cy="${py2}" rx="${W*(0.018+sc*0.008)}" ry="${W*0.012}" fill="${bloomC}" transform="rotate(${i*72},${px2},${py2})" opacity="${0.6+sc*0.35}"/>`; }
      svg += `<circle cx="${bx}" cy="${by}" r="${W*(0.012+sc*0.01)}" fill="#fde68a"/>`;
    }

    if (growth >= 80) {
      svg += lf(cx+s*2, ground-stemH*0.35, 1, ls*0.85); svg += lf(cx-s*2, ground-stemH*0.55, -1, ls);
      svg += lf(cx+s*3, ground-stemH*0.72, 1, ls*1.1);  svg += lf(cx-s*3, ground-stemH*0.86, -1, ls*0.9);
      const sc=Math.min(1,(growth-80)/10), bx=cx-s*3, by=stemTop;
      const petals = growth >= 90 ? 8 : 6;
      const pr = W*(0.05+sc*0.025);
      for (let i=0;i<petals;i++) { const a=(i/petals)*Math.PI*2, px2=bx+Math.cos(a)*pr, py2=by+Math.sin(a)*pr; svg += `<ellipse cx="${px2}" cy="${py2}" rx="${W*(0.028+sc*0.01)}" ry="${W*0.018}" fill="${bloomC}" transform="rotate(${i*(360/petals)},${px2},${py2})"/>`; }
      if (growth >= 90) { for (let i=0;i<5;i++) { const a=(i/5)*Math.PI*2+0.3, px2=bx+Math.cos(a)*W*0.035, py2=by+Math.sin(a)*W*0.035; svg += `<ellipse cx="${px2}" cy="${py2}" rx="${W*0.02}" ry="${W*0.013}" fill="${bloomC}" opacity=".8" transform="rotate(${i*72},${px2},${py2})"/>`; } }
      svg += `<circle cx="${bx}" cy="${by}" r="${W*(0.025+sc*0.01)}" fill="#fde68a"/>`;
      if (growth >= 98) for (let i=0;i<6;i++) { const a=(i/6)*Math.PI*2, dx=bx+Math.cos(a)*W*0.1, dy=by+Math.sin(a)*W*0.1; svg += `<circle cx="${dx}" cy="${dy}" r="${W*0.008}" fill="#fde68a" opacity=".7"/>`; }
    }

    svg += '</svg>';
    return svg;
  }

  function hColor(h) { return h > 60 ? '#22c55e' : h > 30 ? '#f59e0b' : '#ef4444'; }

  // ── Build static skeleton once, update only values on refresh ────────────────
  function buildSkeleton(container, size, p) {
    const sz      = SIZES[size] || SIZES.m;
    const boosted = p.boost_active;
    const plantPx = size === 's' ? 80 : size === 'm' ? 100 : 130;

    container.innerHTML = '';

    if (!p.started) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;padding:10px;box-sizing:border-box">
          <div style="opacity:.35">${drawPlant(0, 100, plantPx)}</div>
          <button id="bgw-plant" style="background:#22c55e;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:.72rem;cursor:pointer;font-weight:600">🌱 Plant</button>
        </div>`;
      container.querySelector('#bgw-plant').addEventListener('click', async () => {
        await fetch('/api/apps/server-monitor/plant/plant', { method: 'POST' });
        doRefresh(container, size);
      });
      return false; // skeleton not built for live plant
    }

    const css = `<style>.bgw-bar{height:3px;border-radius:2px;background:#1e2433}.bgw-fill{height:3px;border-radius:2px;transition:width .6s}</style>`;

    if (size === 's') {
      // S: plant left, bars right — horizontal, compact
      container.innerHTML = css + `
        <div style="display:flex;flex-direction:row;align-items:center;height:100%;padding:8px;box-sizing:border-box;gap:8px">
          <div id="bgw-svg" style="cursor:pointer;flex-shrink:0"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:5px">
            <div>
              <div style="display:flex;justify-content:space-between;font-size:.6rem;color:#64748b;margin-bottom:2px">
                <span>Health</span>
              </div>
              <div class="bgw-bar"><div id="bgw-hbar" class="bgw-fill"></div></div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;font-size:.6rem;color:#64748b;margin-bottom:2px">
                <span>Growth</span>
              </div>
              <div class="bgw-bar"><div id="bgw-gbar" class="bgw-fill" style="background:#3b82f6"></div></div>
            </div>
            <div id="bgw-boost" style="font-size:.58rem;color:#60a5fa"></div>
          </div>
        </div>`;

    } else if (size === 'm') {
      // M: plant top-center, cards below
      container.innerHTML = css + `
        <div style="display:flex;flex-direction:column;align-items:center;height:100%;padding:8px;box-sizing:border-box;gap:6px">
          <div id="bgw-svg" style="cursor:pointer;flex-shrink:0"></div>
          <div style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:5px">
            <div style="background:rgba(255,255,255,.06);border-radius:6px;padding:5px 7px">
              <div style="font-size:.6rem;color:#64748b">Health</div>
              <div id="bgw-hval" style="font-size:.88rem;font-weight:700"></div>
              <div class="bgw-bar" style="margin-top:3px"><div id="bgw-hbar" class="bgw-fill"></div></div>
            </div>
            <div style="background:rgba(255,255,255,.06);border-radius:6px;padding:5px 7px">
              <div style="font-size:.6rem;color:#64748b">Growth</div>
              <div id="bgw-gval" style="font-size:.88rem;font-weight:700;color:#3b82f6"></div>
              <div class="bgw-bar" style="margin-top:3px"><div id="bgw-gbar" class="bgw-fill" style="background:#3b82f6"></div></div>
            </div>
          </div>
          <div id="bgw-boost" style="font-size:.62rem;color:#60a5fa;align-self:flex-start;min-height:12px"></div>
        </div>`;

    } else {
      // L: plant left, full stats right
      container.innerHTML = css + `
        <div style="display:flex;flex-direction:row;align-items:center;height:100%;padding:10px;box-sizing:border-box;gap:12px">
          <div id="bgw-svg" style="cursor:pointer;flex-shrink:0"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:7px;min-width:0">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
              <div style="background:rgba(255,255,255,.06);border-radius:6px;padding:6px 8px">
                <div style="font-size:.6rem;color:#64748b">Health</div>
                <div id="bgw-hval" style="font-size:1rem;font-weight:700"></div>
                <div class="bgw-bar" style="margin-top:3px"><div id="bgw-hbar" class="bgw-fill"></div></div>
              </div>
              <div style="background:rgba(255,255,255,.06);border-radius:6px;padding:6px 8px">
                <div style="font-size:.6rem;color:#64748b">Growth</div>
                <div id="bgw-gval" style="font-size:1rem;font-weight:700;color:#3b82f6"></div>
                <div class="bgw-bar" style="margin-top:3px"><div id="bgw-gbar" class="bgw-fill" style="background:#3b82f6"></div></div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:.7rem">
              <div style="color:#64748b">CPU: <span id="bgw-cpu" style="color:#94a3b8"></span></div>
              <div style="color:#64748b">RAM: <span id="bgw-ram" style="color:#94a3b8"></span></div>
              <div style="color:#64748b">Disk: <span id="bgw-disk" style="color:#94a3b8"></span></div>
              <div style="color:#64748b">Net: <span id="bgw-net" style="color:#94a3b8"></span></div>
            </div>
            <div id="bgw-boost" style="font-size:.68rem;color:#60a5fa;min-height:14px"></div>
          </div>
        </div>`;
    }

    // water on click
    container.querySelector('#bgw-svg')?.addEventListener('click', async () => {
      if (p.boost_active) return;
      await fetch('/api/apps/server-monitor/plant/water', { method: 'POST' });
      doRefresh(container, size);
    });

    return true;
  }

  function updateValues(container, size, p) {
    const sz      = SIZES[size] || SIZES.m;
    const growth  = p.growth ?? 0;
    const health  = p.health ?? 100;
    const hc      = hColor(health);
    const boosted = p.boost_active;
    const plantPx = size === 's' ? 80 : size === 'm' ? 100 : 130;
    const lastLog = p.log?.[p.log.length - 1];
    const boostH  = Math.round((p.boost_remaining ?? 0) / 3600 * 10) / 10;

    // plant SVG
    const svgEl = container.querySelector('#bgw-svg');
    if (svgEl) svgEl.innerHTML = drawPlant(growth, health, plantPx);

    // health bar + value
    const hbar = container.querySelector('#bgw-hbar');
    const hval = container.querySelector('#bgw-hval');
    if (hbar) { hbar.style.width = health + '%'; hbar.style.background = hc; }
    if (hval) { hval.textContent = health.toFixed(1) + '%'; hval.style.color = hc; }

    // growth bar + value
    const gbar = container.querySelector('#bgw-gbar');
    const gval = container.querySelector('#bgw-gval');
    if (gbar) gbar.style.width = growth + '%';
    if (gval) gval.textContent = growth.toFixed(1) + '%';

    // boost line
    const boostEl = container.querySelector('#bgw-boost');
    if (boostEl) {
      boostEl.textContent = boosted ? `💧 Boost — ${boostH}h` : '';
    }

    // L size extras
    if (size === 'l' && lastLog) {
      const cpu  = container.querySelector('#bgw-cpu');
      const ram  = container.querySelector('#bgw-ram');
      const disk = container.querySelector('#bgw-disk');
      const net  = container.querySelector('#bgw-net');
      if (cpu)  cpu.textContent  = (lastLog.cpu?.toFixed(1)  ?? '—') + '%';
      if (ram)  ram.textContent  = (lastLog.ram?.toFixed(1)  ?? '—') + '%';
      if (disk) disk.textContent = (lastLog.disk?.toFixed(1) ?? '—') + '%';
      if (net)  net.textContent  = (lastLog.net_mb?.toFixed(2) ?? '—') + ' MB/s';
    }
  }

  function renderInto(container, data, size) {
    const p = data;
    // build skeleton only once (or when started state changes)
    const wasBuilt   = container._bgwBuilt;
    const wasStarted = container._bgwStarted;
    if (!wasBuilt || wasStarted !== p.started) {
      const built = buildSkeleton(container, size, p);
      container._bgwBuilt   = true;
      container._bgwStarted = p.started;
      if (!built) return; // seed screen, no values to update
    }
    updateValues(container, size, p);
  }

  async function doRefresh(container, size) {
    try {
      const r = await fetch('/api/apps/server-monitor/plant');
      if (!r.ok) return;
      renderInto(container, await r.json(), size);
    } catch(e) {}
  }

  if (window._bgwRegistered) return;
  window._bgwRegistered = true;

  let _lastData = null;

  async function doRefreshCached(container, size) {
    try {
      const r = await fetch('/api/apps/server-monitor/plant');
      if (!r.ok) return;
      _lastData = await r.json();
      renderInto(container, _lastData, size);
    } catch(e) {}
  }

  // determine which widgets are actually installed before registering
  let _installedDesktop = false, _installedTaskbar = false;
  try {
    const r = await fetch('/api/widgets');
    if (r.ok) {
      const list = await r.json();
      _installedDesktop = list.some(w => w.id === ID);
      _installedTaskbar = list.some(w => w.id === ID + '-taskbar');
    }
  } catch(_) {}

  // ── Desktop widget ────────────────────────────────────────────────────────
  if (_installedDesktop) mvmOS.registerWidget({
    id:          ID,
    name:        'Bit Garden',
    icon:        '🌱',
    type:        'desktop',
    defaultX:    20,
    defaultY:    80,
    defaultSize: 'm',
    sizes:       ['s', 'm', 'l'],
    init(container, size = 'm') {
      const sz = SIZES[size] || SIZES.m;
      container.style.cssText = `width:${sz.w}px;height:${sz.h}px;background:#0f1117;border-radius:12px;color:#e2e8f0;font-family:system-ui,sans-serif;overflow:hidden`;
      container._bgwBuilt   = false;
      container._bgwStarted = undefined;
      if (_lastData) renderInto(container, _lastData, size);
      doRefreshCached(container, size);
      if (container._bgwTimer) clearInterval(container._bgwTimer);
      container._bgwTimer = setInterval(() => doRefreshCached(container, size), 60000);
    },
  });

  // ── Taskbar widget ────────────────────────────────────────────────────────
  if (_installedTaskbar) mvmOS.registerWidget({
    id:   ID + '-taskbar',
    name: 'Bit Garden (taskbar)',
    icon: '🌱',
    type: 'taskbar',
    init(wrap) {
      wrap.style.cssText += 'cursor:pointer;padding:0 6px;gap:6px;display:flex;align-items:center;font-family:system-ui,sans-serif;font-size:.72rem;color:#e2e8f0';

      wrap.innerHTML = `
        <div id="bgt-plant" style="flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:80px">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="color:#64748b;width:14px;font-size:.6rem">H</span>
            <div style="flex:1;height:3px;background:#1e2433;border-radius:2px">
              <div id="bgt-hbar" style="height:3px;border-radius:2px;transition:width .6s"></div>
            </div>
            <span id="bgt-hval" style="min-width:34px;text-align:right;font-size:.65rem"></span>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="color:#64748b;width:14px;font-size:.6rem">G</span>
            <div style="flex:1;height:3px;background:#1e2433;border-radius:2px">
              <div id="bgt-gbar" style="height:3px;background:#3b82f6;border-radius:2px;transition:width .6s"></div>
            </div>
            <span id="bgt-gval" style="min-width:34px;text-align:right;font-size:.65rem;color:#3b82f6"></span>
          </div>
        </div>`;

      function updateTaskbar(p) {
        const growth = p.growth ?? 0;
        const health = p.health ?? 100;
        const hc     = hColor(health);
        const svg    = wrap.querySelector('#bgt-plant');
        const hbar   = wrap.querySelector('#bgt-hbar');
        const hval   = wrap.querySelector('#bgt-hval');
        const gbar   = wrap.querySelector('#bgt-gbar');
        const gval   = wrap.querySelector('#bgt-gval');
        if (svg)  svg.innerHTML = drawPlant(growth, health, 32);
        if (hbar) { hbar.style.width = health + '%'; hbar.style.background = hc; }
        if (hval) { hval.textContent = health.toFixed(0) + '%'; hval.style.color = hc; }
        if (gbar) gbar.style.width = growth + '%';
        if (gval) gval.textContent = growth.toFixed(0) + '%';
      }

      // click opens server-monitor app
      wrap.addEventListener('click', () => mvmOS.openApp('server-monitor'));

      async function refresh() {
        try {
          const r = await fetch('/api/apps/server-monitor/plant');
          if (!r.ok) return;
          _lastData = await r.json();
          updateTaskbar(_lastData);
        } catch(e) {}
      }

      if (_lastData) updateTaskbar(_lastData);
      refresh();
      wrap._bgtTimer = setInterval(refresh, 60000);
    },
  });
})();
