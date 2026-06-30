// mvmOS App: Server Monitor v1.0.0
const _sm18n = {
  en: {
    title: 'Server Monitor', garden: 'Bit Garden',
    plant_btn: 'Plant the seed', watered: 'Watered! ×0.9 penalties for 1h',
    water_btn: '💧 Water', boost_active: 'Boost active',
    health_lbl: 'Health', growth_lbl: 'Growth', daily_rate: 'Daily rate', per_day: 'day', per_hour: 'h',
    seed_title: 'Your server has no plant yet.', seed_sub: 'Click to plant the seed and start growing.',
    stage_seed: 'Seed', stage_sprout: 'Sprout', stage_young: 'Young plant',
    stage_mature: 'Plant', stage_bloom: 'Blooming', stage_tree: 'Tree',
    modifiers: 'Current modifiers', boost_rem: 'Boost remaining',
    add_widget: '🪴 Add to desktop',
    influence: 'Influence (last hour)', waiting_first: '— waiting for first hour',
    metric: 'Metric', value: 'Value', effect: 'Effect',
    on_health: 'health', on_growth: 'growth',
    disk_slow: 'growth −', disk_ok: 'full growth',
    ram_cpu_more: '% more CPU dmg', ram_cpu_less: '% less CPU dmg', ram_neutral: 'neutral',
    boost_status: 'Boost active — {h}h left · damage blocked · growth ×2',
    archive_label: 'Archive', days_label: 'days',
    cpu: 'CPU', ram: 'RAM', swap: 'Swap', disk: 'Disk', net: 'Network', sensors: 'Sensors',
    load: 'Load Avg', disk_io: 'Disk I/O', net_in: 'Network In', net_out: 'Network Out',
    read: 'Read', write: 'Write',
    prev_healthy: 'Healthy (100%)', prev_normal: 'Sick (20%)', prev_sick: 'Dying (5%)',
    garden_history: 'History', health_lbl_short: 'Health', growth_lbl_short: 'Growth',
    no_plant_history: 'No plant data for this period.',
    prev_growth: 'Growth', prev_my_plant: 'Mine', prev_variety: 'Variety',
    period_hour: 'Last hour', period_today: 'Today', period_yesterday: 'Yesterday',
    period_week: 'Week', period_month: 'Month',
    avg: 'Avg', min: 'Min', max: 'Max',
    no_data: 'No data for this period yet.',
    loading: 'Loading…', no_sensors: 'No temperature sensors detected on this machine.',
    error: 'Error loading data',
    records: 'records', time: 'Time', click_details: 'Click for details',
    cpu_pct: 'CPU %', load_1m: 'Load avg 1m', load_5m: 'Load avg 5m', load_15m: 'Load avg 15m',
    ram_used: 'RAM used %', swap_used: 'Swap used %',
    disk_used: 'Disk used %', read_mbs: 'Read MB/s', write_mbs: 'Write MB/s',
    net_in_mbs: 'Network in MB/s', net_out_mbs: 'Network out MB/s',
    temp_max: 'Temperature max °C',
  },
  bg: {
    title: 'Сървър Монитор', garden: 'Бит Градина',
    plant_btn: 'Посади семето', watered: 'Полято! ×0.9 наказания за 1ч',
    water_btn: '💧 Полей', boost_active: 'Бустът е активен',
    health_lbl: 'Здраве', growth_lbl: 'Растеж', daily_rate: 'Дневна скорост', per_day: 'ден', per_hour: 'ч',
    seed_title: 'Сървърът ти няма растение.', seed_sub: 'Кликни за да посадиш семето и да започнеш.',
    stage_seed: 'Семе', stage_sprout: 'Кълн', stage_young: 'Малко растение',
    stage_mature: 'Растение', stage_bloom: 'Цъфти', stage_tree: 'Дърво',
    modifiers: 'Текущи модификатори', boost_rem: 'Буст оставащо',
    add_widget: '🪴 Добави на десктопа',
    influence: 'Влияние (последния час)', waiting_first: '— изчаква първия час',
    metric: 'Метрика', value: 'Стойност', effect: 'Ефект',
    on_health: 'здраве', on_growth: 'растеж',
    disk_slow: 'растеж −', disk_ok: 'пълен растеж',
    ram_cpu_more: '% повече CPU щета', ram_cpu_less: '% по-малко CPU щета', ram_neutral: 'неутрална',
    boost_status: 'Boost активен — {h}ч остават · щети блокирани · растеж ×2',
    archive_label: 'Архив', days_label: 'дни',
    cpu: 'Процесор', ram: 'Памет', swap: 'Суап', disk: 'Диск', net: 'Мрежа', sensors: 'Сензори',
    load: 'Натоварване', disk_io: 'Диск I/O', net_in: 'Мрежа Вход', net_out: 'Мрежа Изход',
    read: 'Четене', write: 'Запис',
    prev_healthy: 'Здраво (100%)', prev_normal: 'Болно (20%)', prev_sick: 'Умира (5%)',
    garden_history: 'История', health_lbl_short: 'Здраве', growth_lbl_short: 'Растеж',
    no_plant_history: 'Няма данни за растението за този период.',
    prev_growth: 'Растеж', prev_my_plant: 'Моето', prev_variety: 'Вид',
    period_hour: 'Последен час', period_today: 'Днес', period_yesterday: 'Вчера',
    period_week: 'Седмица', period_month: 'Месец',
    avg: 'Средно', min: 'Мин', max: 'Макс',
    no_data: 'Няма данни за този период.',
    loading: 'Зарежда…', no_sensors: 'Няма открити температурни сензори на тази машина.',
    error: 'Грешка при зареждане',
    records: 'записа', time: 'Час', click_details: 'Кликни за детайли',
    cpu_pct: 'Процесор %', load_1m: 'Натоварване 1м', load_5m: 'Натоварване 5м', load_15m: 'Натоварване 15м',
    ram_used: 'Памет заета %', swap_used: 'Суап зает %',
    disk_used: 'Диск зает %', read_mbs: 'Четене MB/s', write_mbs: 'Запис MB/s',
    net_in_mbs: 'Мрежа вход MB/s', net_out_mbs: 'Мрежа изход MB/s',
    temp_max: 'Температура макс °C',
  },
};
function _smt(k) { const l = window.mvmOS?.lang || 'en'; return (_sm18n[l] || _sm18n.en)[k] || k; }

mvmOS.registerApp({
  id: 'server-monitor',
  name: _smt('title'),
  icon: '🌡️',
  category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'server-monitor',
      title: '📊 ' + _smt('title'),
      width: 860,
      height: 580,
      onMount(body) {
        body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#0f1117;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100%';

        body.innerHTML = `
          <style>
            .sm-tabs { display:flex; gap:2px; padding:10px 12px 0; background:#0f1117; border-bottom:1px solid #1e2433; flex-wrap:wrap; }
            .sm-tab  { padding:6px 16px; border-radius:6px 6px 0 0; cursor:pointer; font-size:.82rem; color:#64748b; background:transparent; border:none; transition:all .15s; white-space:nowrap; }
            .sm-tab.active { background:#1e2433; color:#e2e8f0; }
            .sm-tab:hover:not(.active) { color:#94a3b8; }
            .sm-periods { display:flex; gap:6px; padding:10px 14px 6px; flex-wrap:wrap; border-bottom:1px solid #1e2433; }
            .sm-period { padding:3px 12px; border-radius:20px; cursor:pointer; font-size:.78rem; color:#64748b; background:#1e2433; border:none; transition:all .15s; }
            .sm-period.active { background:#3b82f6; color:#fff; }
            .sm-period:hover:not(.active) { background:#263142; color:#94a3b8; }
            .sm-content { flex:1; overflow-y:auto; padding:14px; }
            .sm-chart-wrap { background:#1e2433; border-radius:10px; padding:14px; margin-bottom:12px; }
            .sm-chart-title { font-size:.8rem; color:#94a3b8; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; }
            .sm-chart-name { font-weight:600; color:#e2e8f0; }
            .sm-stats { display:flex; gap:14px; font-size:.72rem; }
            .sm-stat { color:#64748b; } .sm-stat span { color:#e2e8f0; font-weight:600; }
            .sm-chart-svg { width:100%; height:90px; display:block; margin-top:6px; }
            .sm-no-data { text-align:center; padding:60px 20px; color:#475569; font-size:.85rem; line-height:1.6; }
            .sm-sensor-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; }
            .sm-sensor-card { background:#1e2433; border-radius:10px; padding:12px 14px; }
            .sm-sensor-label { font-size:.72rem; color:#64748b; margin-bottom:4px; }
            .sm-sensor-val { font-size:1.5rem; font-weight:700; }
          </style>

          <div class="sm-tabs" id="sm-tabs"></div>

          <div id="sm-panels" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
            <div class="sm-periods" id="sm-periods"></div>
            <div class="sm-content" id="sm-content">
              <div class="sm-no-data">${_smt('loading')}</div>
            </div>
          </div>
        `;

        // ── State ─────────────────────────────────────────────────────────────
        const TABS_METRICS = [
          { id: 'cpu',     label: '⚡ ' + _smt('cpu')     },
          { id: 'ram',     label: '🧠 ' + _smt('ram')     },
          { id: 'disk',    label: '💾 ' + _smt('disk')    },
          { id: 'net',     label: '🌐 ' + _smt('net')     },
          { id: 'sensors', label: '🌡️ ' + _smt('sensors') },
        ];
        const TAB_PLANT = { id: 'plant', label: '🌱 ' + _smt('garden') };
        let TABS = [TAB_PLANT, ...TABS_METRICS];  // reordered after plant check
        let plantHistoryPeriod = null;  // null = show plant, string = show chart
        const PERIODS = [
          { id: 'hour',      label: _smt('period_hour')      },
          { id: 'today',     label: _smt('period_today')     },
          { id: 'yesterday', label: _smt('period_yesterday') },
          { id: 'week',      label: _smt('period_week')      },
          { id: 'month',     label: _smt('period_month')     },
        ];

        let activeTab    = 'cpu';
        let activePeriod = 'today';
        let cache        = {};  // key: tab+period
        let refreshTimer = null;

        // ── Build tabs ────────────────────────────────────────────────────────
        const tabsEl = body.querySelector('#sm-tabs');
        function buildTabs() {
          tabsEl.innerHTML = '';
          TABS.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'sm-tab' + (t.id === activeTab ? ' active' : '');
            btn.textContent = t.label;
            btn.dataset.tab = t.id;
            btn.addEventListener('click', () => {
              tabsEl.querySelectorAll('.sm-tab').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              activeTab = t.id;
              loadTab();
            });
            tabsEl.appendChild(btn);
          });
        }

        // Check if plant is started to decide tab order
        fetch('/api/apps/server-monitor/plant').then(r => r.ok ? r.json() : null).then(p => {
          if (p?.started) {
            TABS = [TAB_PLANT, ...TABS_METRICS];
            activeTab = 'plant';
          } else {
            TABS = [...TABS_METRICS, TAB_PLANT];
            activeTab = 'cpu';
          }
          buildTabs();
          loadTab();
        }).catch(() => {
          buildTabs();
          loadTab();
        });

        // ── Build period bar ──────────────────────────────────────────────────
        const periodsEl = body.querySelector('#sm-periods');
        PERIODS.forEach(p => {
          const btn = document.createElement('button');
          btn.className = 'sm-period';
          btn.textContent = p.label;
          btn.dataset.period = p.id;
          btn.addEventListener('click', () => {
            if (activeTab === 'plant') {
              // toggle: click same period to go back to plant view
              if (plantHistoryPeriod === p.id) {
                plantHistoryPeriod = null;
                periodsEl.querySelectorAll('.sm-period').forEach(b => b.classList.remove('active'));
              } else {
                plantHistoryPeriod = p.id;
                periodsEl.querySelectorAll('.sm-period').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
              }
              loadTab();
            } else {
              periodsEl.querySelectorAll('.sm-period').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              activePeriod = p.id;
              cache = {};
              loadTab();
            }
          });
          periodsEl.appendChild(btn);
        });

        // ── Chart helpers ─────────────────────────────────────────────────────
        function sparkline(points, field, color) {
          const vals = points.map(p => p[`avg_${field}`]).filter(v => v != null);
          if (!vals.length) return '';
          const maxV = Math.max(...vals);
          const minV = Math.min(...vals);
          const range = maxV - minV || 1;
          const flatLine = maxV === minV;
          const W = 800, H = 90, pad = 2;
          const step = (W - pad * 2) / Math.max(vals.length - 1, 1);
          const pts = vals.map((v, i) => ({
            x: pad + i * step,
            y: flatLine ? (H / 2) : H - pad - ((v - minV) / range) * (H - pad * 2),
          }));
          const id = field.replace(/[^a-z]/g, '');
          const coords = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
          const last = pts[pts.length - 1];
          const area = `M${coords[0]} L${coords.join(' L')} L${last.x.toFixed(1)},${H} L${pad},${H} Z`;
          const line = `M${coords[0]} L${coords.join(' L')}`;
          const ts = points.map(p => p.ts ?? '').join(',');
          return `<svg class="sm-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
            data-vals="${vals.join(',')}" data-ts="${ts}"
            data-xs="${pts.map(p=>p.x.toFixed(1)).join(',')}" data-ys="${pts.map(p=>p.y.toFixed(1)).join(',')}">
            <defs>
              <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="${area}" fill="url(#g${id})"/>
            <path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>
            <line class="sm-xhair" x1="-2" y1="0" x2="-2" y2="${H}" stroke="rgba(255,255,255,.45)" stroke-width="1.5" stroke-dasharray="3,3"/>
            <circle class="sm-dot" cx="-10" cy="-10" r="4" fill="${color}" stroke="#0f1623" stroke-width="1.5"/>
          </svg>`;
        }

        // ── Chart click/hover registries (populated by chartBlock, consumed by listeners)
        const _chartClickRegistry = {};
        const _chartUnitRegistry  = {};

        // ── Detail modal ──────────────────────────────────────────────────────
        function showDetail(name, points, field, unit) {
          const existing = body.querySelector('#sm-modal');
          if (existing) existing.remove();

          const fmt = ts => {
            const d = new Date(ts * 1000);
            return d.toLocaleDateString([], {day:'2-digit',month:'2-digit'}) + ' '
                 + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:(window._vosSettings?.time_format==='12')});
          };

          const rows = points
            .filter(p => p[`avg_${field}`] != null)
            .map(p => {
              const avg = p[`avg_${field}`];
              const mn  = p[`min_${field}`];
              const mx  = p[`max_${field}`];
              const isMx = mx === Math.max(...points.map(x => x[`max_${field}`] ?? -Infinity));
              return `<tr style="${isMx ? 'color:#f59e0b' : ''}">
                <td style="padding:5px 10px;border-bottom:1px solid #263142;white-space:nowrap">${fmt(p.ts)}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #263142;text-align:right;font-weight:600">${avg.toFixed(2)}${unit}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #263142;text-align:right;color:#64748b">${mn.toFixed(2)}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #263142;text-align:right;color:${isMx?'#f59e0b':'#64748b'}">${mx.toFixed(2)}</td>
              </tr>`;
            }).join('');

          const modal = document.createElement('div');
          modal.id = 'sm-modal';
          modal.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
          modal.innerHTML = `
            <div style="background:#1e2433;border-radius:12px;width:90%;max-width:600px;max-height:80%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #263142">
                <span style="font-weight:700;font-size:.9rem">${name} — ${points.filter(p=>p[`avg_${field}`]!=null).length} ${_smt('records')}</span>
                <button id="sm-modal-close" style="background:none;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;line-height:1">✕</button>
              </div>
              <div style="overflow-y:auto;flex:1">
                <table style="width:100%;border-collapse:collapse;font-size:.8rem">
                  <thead>
                    <tr style="color:#475569;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em">
                      <th style="padding:8px 10px;text-align:left;border-bottom:1px solid #263142">${_smt('time')}</th>
                      <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #263142">${_smt('avg')}</th>
                      <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #263142">${_smt('min')}</th>
                      <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #263142">${_smt('max')}</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
          `;
          modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
          modal.querySelector('#sm-modal-close').addEventListener('click', () => modal.remove());
          // position relative to the window body
          const wrap = body.closest('[style*="position"]') || body.parentElement;
          body.style.position = 'relative';
          body.appendChild(modal);
        }

        function chartBlock(name, points, field, color, unit = '%') {
          const vals = points.map(p => p[`avg_${field}`]).filter(v => v != null);
          if (!vals.length) return '';
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          const mn  = Math.min(...vals);
          const mx  = Math.max(...vals);
          const peakIdx  = vals.indexOf(mx);
          const peakTs   = points[peakIdx]?.ts;
          const peakTime = peakTs ? new Date(peakTs * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:(window._vosSettings?.time_format==='12')}) : '';
          const blockId  = 'smcb_' + field + '_' + Math.random().toString(36).slice(2);
          _chartClickRegistry[blockId] = () => showDetail(name, points, field, unit);
          _chartUnitRegistry[blockId]  = unit;
          return `<div class="sm-chart-wrap" data-smcb="${blockId}" style="cursor:pointer" title="${_smt('click_details')}">
            <div class="sm-chart-title">
              <span class="sm-chart-name">${name}</span>
              <div class="sm-stats">
                <div class="sm-stat">${_smt('avg')}: <span>${avg.toFixed(2)}${unit}</span></div>
                <div class="sm-stat">${_smt('min')}: <span>${mn.toFixed(2)}${unit}</span></div>
                <div class="sm-stat">${_smt('max')}: <span>${mx.toFixed(2)}${unit}</span>${peakTime ? ` <span style="color:#475569;font-weight:400">@ ${peakTime}</span>` : ''}</div>
              </div>
            </div>
            ${sparkline(points, field, color)}
          </div>`;
        }

        const _smContent = body.querySelector('#sm-content');

        _smContent.addEventListener('click', e => {
          const block = e.target.closest('[data-smcb]');
          if (block) _chartClickRegistry[block.dataset.smcb]?.();
        });

        // ── Chart hover tooltip ───────────────────────────────────────────────
        const _smTip = document.createElement('div');
        _smTip.style.cssText = 'position:fixed;background:#0f1623;border:1px solid #334155;border-radius:6px;padding:5px 11px;font-size:.78rem;color:#e2e8f0;pointer-events:none;z-index:9999;white-space:nowrap;display:none;box-shadow:0 4px 14px rgba(0,0,0,.5)';
        document.body.appendChild(_smTip);

        function _smHideHover() {
          _smTip.style.display = 'none';
          body.querySelectorAll('.sm-xhair').forEach(l => { l.setAttribute('x1', '-2'); l.setAttribute('x2', '-2'); });
          body.querySelectorAll('.sm-dot').forEach(c => { c.setAttribute('cx', '-10'); c.setAttribute('cy', '-10'); });
        }

        _smContent.addEventListener('mousemove', e => {
          const svg = e.target.closest('.sm-chart-svg');
          if (!svg || !svg.dataset.vals) { _smHideHover(); return; }

          const rect = svg.getBoundingClientRect();
          const relX = Math.max(0, e.clientX - rect.left);
          const vals = svg.dataset.vals.split(',').map(Number);
          const xs   = svg.dataset.xs.split(',').map(Number);
          const ys   = svg.dataset.ys.split(',').map(Number);
          const tss  = svg.dataset.ts.split(',').map(Number);

          const idx = Math.max(0, Math.min(Math.round(relX / rect.width * (vals.length - 1)), vals.length - 1));
          const val = vals[idx];
          const svgX = xs[idx], svgY = ys[idx];

          const wrap = svg.closest('[data-smcb]');
          const unit = _chartUnitRegistry[wrap?.dataset.smcb] || '';

          const ts = tss[idx];
          const timeStr = ts ? new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:(window._vosSettings?.time_format==='12')}) : '';

          // update crosshair in this SVG only
          body.querySelectorAll('.sm-xhair').forEach(l => { l.setAttribute('x1', '-2'); l.setAttribute('x2', '-2'); });
          body.querySelectorAll('.sm-dot').forEach(c => { c.setAttribute('cx', '-10'); c.setAttribute('cy', '-10'); });
          const xhair = svg.querySelector('.sm-xhair');
          const dot   = svg.querySelector('.sm-dot');
          if (xhair) { xhair.setAttribute('x1', svgX); xhair.setAttribute('x2', svgX); }
          if (dot)   { dot.setAttribute('cx', svgX);   dot.setAttribute('cy', svgY); }

          _smTip.textContent = `${val.toFixed(2)}${unit}${timeStr ? '  ·  ' + timeStr : ''}`;
          _smTip.style.left  = (e.clientX + 16) + 'px';
          _smTip.style.top   = (e.clientY - 32) + 'px';
          _smTip.style.display = 'block';
        });

        _smContent.addEventListener('mouseleave', _smHideHover);

        // clean up tooltip on window close
        new MutationObserver(() => { if (!document.contains(body)) { _smTip.remove(); } })
          .observe(document.body, { childList: true, subtree: true });

        // ── SVG Plant renderer ────────────────────────────────────────────────
        function _seededRng(seed) {
          let s = seed | 0;
          return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
        }

        function drawPlant(growth, health, seed = 0) {
          const rng = _seededRng(seed);
          const W = 200, H = 230;
          const cx = W / 2, ground = H - 28;

          // ── 14 personality traits from seed ──────────────────────────────────
          const leafType   = Math.floor(rng() * 5);       // 0=round 1=pointed 2=wide 3=narrow 4=heart
          const curve      = (rng() - 0.5) * 32;          // stem lean -16..+16
          const bloomHue   = Math.floor(rng() * 8);
          const leafHueIdx = Math.floor(rng() * 8);
          const stemThick  = rng() > 0.6;                 // thick brown vs slim green
          const heightMult = 0.52 + rng() * 0.96;         // 0.52x .. 1.48x stem height
          const leafSzMult = 0.5  + rng() * 1.3;          // 0.5x .. 1.8x leaf size
          const bushy      = rng() > 0.52;                // leaves on both sides
          const bloomStyle = Math.floor(rng() * 5);       // 0=5petal 1=6round 2=star 3=berries 4=daisy
          const bloomSzM   = 0.6  + rng() * 0.9;         // bloom size multiplier
          const leafPairs  = 2 + Math.floor(rng() * 3);  // 2-4 leaf pairs at full growth
          const leafSpread = 0.7  + rng() * 0.7;          // 0.7..1.4 horizontal reach
          const altLeaves  = rng() > 0.5;                // alternating vs symmetric placement
          const centerHue  = Math.floor(rng() * 4);

          const BLOOM_COLORS  = ['#f9a8d4','#c4b5fd','#93c5fd','#fde68a','#6ee7b7','#fca5a5','#fb923c','#e879f9'];
          const LEAF_COLORS   = ['#22c55e','#16a34a','#4ade80','#0d9488','#84cc16','#4f7942','#14b8a6','#a3e635'];
          const CENTER_COLORS = ['#fde68a','#fbbf24','#f9a8d4','#c084fc'];

          const sick    = health < 30;
          const wilted  = health < 10;
          const leafC   = wilted ? '#6b4226' : sick ? '#a38a2a' : LEAF_COLORS[leafHueIdx];
          const stemC   = wilted ? '#6b4226' : stemThick ? '#5a3e28' : '#15803d';
          const bloomC  = BLOOM_COLORS[bloomHue];
          const centerC = CENTER_COLORS[centerHue];

          // ── Phase 0: seed ────────────────────────────────────────────────────
          if (growth === 0) {
            return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
              <ellipse cx="${cx}" cy="${ground+10}" rx="70" ry="12" fill="#3d2b1f"/>
              <ellipse cx="${cx}" cy="${ground+5}"  rx="16" ry="4"  fill="#4a3728"/>
              <ellipse cx="${cx}" cy="${ground}"    rx="6"  ry="4"  fill="#5c4a2a"/>
            </svg>`;
          }

          const maxStemH = Math.round(70 + 60 * heightMult);   // 70..130
          const stemGrowthPct = Math.max(0, Math.min(1, (growth - 5) / 55));
          const stemH    = stemGrowthPct * maxStemH;
          const stemTop  = ground - stemH;
          const stemW    = stemThick
            ? (growth >= 60 ? 5.5 : growth >= 30 ? 4 : 2.5)
            : (growth >= 60 ? 3   : growth >= 30 ? 2 : 1.5);

          let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
            <ellipse cx="${cx}" cy="${ground+10}" rx="70" ry="12" fill="#3d2b1f"/>`;

          if (growth < 5) {
            const tipH = (growth / 5) * 14;
            svg += `<path d="M${cx},${ground} Q${cx+2},${ground-tipH*0.6} ${cx},${ground-tipH}"
              fill="none" stroke="${stemC}" stroke-width="1.5" stroke-linecap="round"/>`;
            svg += `</svg>`;
            return svg;
          }

          // stem
          const cpx = cx + curve, cpy = ground - stemH * 0.5;
          svg += `<path d="M${cx},${ground} Q${cpx},${cpy} ${cx - curve*0.25},${stemTop}"
            fill="none" stroke="${stemC}" stroke-width="${stemW}" stroke-linecap="round"/>`;

          // ── Leaf helper ──────────────────────────────────────────────────────
          function leaf(lx, ly, dir, baseSize) {
            const s = baseSize * leafSzMult * leafSpread;
            const op = wilted ? 0.42 : 0.9;
            let path;
            if (leafType === 0) {          // round
              const ex = lx+dir*s*0.9, ey = ly-s*0.4;
              path = `M${lx},${ly} Q${lx+dir*s*0.45},${ly-s*0.95} ${ex},${ey} Q${lx+dir*4},${ly-4} ${lx},${ly}`;
            } else if (leafType === 1) {   // pointed
              const ex = lx+dir*s*1.15, ey = ly-s*0.15;
              path = `M${lx},${ly} Q${lx+dir*s*0.3},${ly-s*1.2} ${ex},${ey} Q${lx+dir*s*0.75},${ly+5} ${lx},${ly}`;
            } else if (leafType === 2) {   // wide
              const ex = lx+dir*s*0.85, ey = ly-s*0.55;
              path = `M${lx},${ly} Q${lx+dir*s*1.0},${ly-s*0.2} ${ex},${ey} Q${lx+dir*s*0.4},${ly-s*1.1} ${lx},${ly}`;
            } else if (leafType === 3) {   // narrow
              const ex = lx+dir*s*0.48, ey = ly-s*0.8;
              path = `M${lx},${ly} Q${lx+dir*s*0.15},${ly-s*1.3} ${ex},${ey} Q${lx+dir*2},${ly-1} ${lx},${ly}`;
            } else {                       // heart
              const mx = lx+dir*s*0.35, my = ly-s*0.5;
              path = `M${lx},${ly} Q${lx+dir*s*0.1},${ly-s*1.0} ${mx},${my-s*0.2} Q${lx+dir*s*0.85},${ly-s*0.85} ${lx+dir*s*0.65},${my+s*0.1} Q${lx+dir*s*0.4},${ly+2} ${lx},${ly}`;
            }
            return `<path d="${path}" fill="${leafC}" opacity="${op}"/>`;
          }

          // ── Leaf placement ────────────────────────────────────────────────────
          // Heights along stem: distribute leafPairs evenly from 0.3 to 0.88
          function addLeaves(maxPairs) {
            const visible = Math.min(maxPairs, leafPairs);
            for (let i = 0; i < visible; i++) {
              const frac = 0.3 + (i / Math.max(1, leafPairs - 1)) * 0.58;
              const ly   = ground - stemH * frac;
              if (ly <= stemTop) continue;
              const baseSize = 14 + i * 2.5;
              const dir1 = altLeaves ? (i % 2 === 0 ? 1 : -1) : 1;
              svg += leaf(cx + dir1*2, ly, dir1, baseSize);
              if (bushy || !altLeaves) {
                svg += leaf(cx - dir1*2, ly, -dir1, baseSize * (bushy ? 0.85 : 0.9));
              }
            }
          }

          if (growth >= 10) {
            const pairs = growth < 30 ? 1 : growth < 50 ? 2 : growth < 70 ? 3 : leafPairs;
            addLeaves(pairs);
          }

          // ── Bloom ─────────────────────────────────────────────────────────────
          if (growth >= 60) {
            const bp = Math.min(1, (growth - 60) / 40);
            const bx = cx - curve * 0.25, by = stemTop;

            // small buds at 60-70%
            if (growth < 70) {
              const br = 3 * bp * 2.5;
              for (let i = 0; i < 3; i++) {
                const a = (i/3)*Math.PI*2 - Math.PI/2;
                svg += `<circle cx="${bx+Math.cos(a)*5*bp}" cy="${by+Math.sin(a)*5*bp}" r="${br}" fill="${bloomC}" opacity=".7"/>`;
              }
            } else {
              const bpF = Math.min(1, (growth - 70) / 30);
              if (bloomStyle === 0) {        // 5-petal
                const pr = (7 + bpF * 9) * bloomSzM;
                for (let i = 0; i < 5; i++) {
                  const a = (i/5)*Math.PI*2;
                  const px = bx+Math.cos(a)*pr, py = by+Math.sin(a)*pr;
                  svg += `<ellipse cx="${px}" cy="${py}" rx="${(3.5+bpF*3.5)*bloomSzM}" ry="${(2+bpF*2)*bloomSzM}" fill="${bloomC}"
                    transform="rotate(${i*72},${px},${py})" opacity="${0.65+bpF*0.35}"/>`;
                }
                svg += `<circle cx="${bx}" cy="${by}" r="${(2.5+bpF*3)*bloomSzM}" fill="${centerC}"/>`;
              } else if (bloomStyle === 1) { // 6-petal round
                const pr = (8 + bpF * 11) * bloomSzM;
                for (let i = 0; i < 6; i++) {
                  const a = (i/6)*Math.PI*2;
                  const px = bx+Math.cos(a)*pr, py = by+Math.sin(a)*pr;
                  svg += `<ellipse cx="${px}" cy="${py}" rx="${(4.5+bpF*4.5)*bloomSzM}" ry="${(3+bpF*2.5)*bloomSzM}" fill="${bloomC}"
                    transform="rotate(${i*60},${px},${py})"/>`;
                }
                svg += `<circle cx="${bx}" cy="${by}" r="${(3+bpF*3.5)*bloomSzM}" fill="${centerC}"/>`;
              } else if (bloomStyle === 2) { // spiky star
                const pr = (9 + bpF * 12) * bloomSzM;
                for (let i = 0; i < 8; i++) {
                  const a = (i/8)*Math.PI*2;
                  const px = bx+Math.cos(a)*pr, py = by+Math.sin(a)*pr;
                  svg += `<ellipse cx="${px}" cy="${py}" rx="${(2.5+bpF*2.5)*bloomSzM}" ry="${(1+bpF)*bloomSzM}" fill="${bloomC}"
                    transform="rotate(${i*45},${px},${py})" opacity="${0.85+bpF*0.15}"/>`;
                }
                svg += `<circle cx="${bx}" cy="${by}" r="${(2+bpF*2.5)*bloomSzM}" fill="${centerC}"/>`;
              } else if (bloomStyle === 3) { // berry cluster
                const sp = (9 + bpF * 10) * bloomSzM;
                const br2 = (3.5 + bpF * 4) * bloomSzM;
                svg += `<circle cx="${bx}" cy="${by}" r="${br2}" fill="${bloomC}"/>`;
                for (let i = 0; i < 6; i++) {
                  const a = (i/6)*Math.PI*2;
                  svg += `<circle cx="${bx+Math.cos(a)*sp}" cy="${by+Math.sin(a)*sp*0.75}" r="${br2*0.85}" fill="${bloomC}" opacity=".9"/>`;
                }
                svg += `<circle cx="${bx}" cy="${by}" r="${br2*0.45}" fill="${centerC}"/>`;
              } else {                      // daisy (many thin petals)
                const pr = (6 + bpF * 8) * bloomSzM;
                for (let i = 0; i < 10; i++) {
                  const a = (i/10)*Math.PI*2;
                  const px = bx+Math.cos(a)*pr, py = by+Math.sin(a)*pr;
                  svg += `<ellipse cx="${px}" cy="${py}" rx="${(3+bpF*2.5)*bloomSzM}" ry="${(1.5+bpF)*bloomSzM}" fill="${bloomC}"
                    transform="rotate(${i*36},${px},${py})" opacity="${0.75+bpF*0.25}"/>`;
                }
                svg += `<circle cx="${bx}" cy="${by}" r="${(3.5+bpF*2.5)*bloomSzM}" fill="${centerC}"/>`;
              }

              // sparkle at 100%
              if (growth >= 98) {
                for (let i = 0; i < 6; i++) {
                  const a = (i/6)*Math.PI*2;
                  svg += `<circle cx="${bx+Math.cos(a)*22}" cy="${by+Math.sin(a)*22}" r="1.5" fill="${centerC}" opacity=".7"/>`;
                }
              }
            }
          }

          // ── Sick / wilted overlays ────────────────────────────────────────────
          if (sick && stemH > 5) {
            const sickPct = Math.max(0, (30 - health) / 30);
            const droopAmt = sickPct * 14;
            if (droopAmt > 1) {
              for (let i = 0; i < leafPairs; i++) {
                const frac = 0.3 + (i / Math.max(1, leafPairs-1)) * 0.58;
                const lx = cx + (i%2===0?1:-1)*2, ly = ground - stemH*frac, dir = i%2===0?1:-1;
                if (ly > stemTop) svg += `<path d="M${lx},${ly} Q${lx+dir*10},${ly+droopAmt} ${lx+dir*18},${ly+droopAmt*1.4}"
                  fill="none" stroke="${leafC}" stroke-width="1.5" opacity="${0.3+sickPct*0.4}"/>`;
              }
            }
            if (health < 20) {
              const spotCount = Math.floor(sickPct * 5) + 1;
              [[cx+14,ground-stemH*0.28],[cx-16,ground-stemH*0.5],[cx+18,ground-stemH*0.68],[cx-14,ground-stemH*0.82],[cx+8,ground-stemH*0.4]]
                .slice(0,spotCount).forEach(([sx,sy]) => {
                  svg += `<circle cx="${sx}" cy="${sy}" r="${2+sickPct*2}" fill="#7a4a1a" opacity="${0.4+sickPct*0.4}"/>`;
                });
            }
            if (wilted) {
              svg += `<path d="M${cx},${ground+2} Q${cx+12},${ground-stemH*0.4} ${cx+6},${stemTop+stemH*0.15}"
                fill="none" stroke="${stemC}" stroke-width="1.5" opacity=".25"/>`;
            }
            if (health < 15) {
              [[cx+2,ground-stemH*0.35,1],[cx-2,ground-stemH*0.55,-1]].forEach(([lx,ly,dir]) => {
                svg += `<path d="M${lx},${ly} L${lx+dir*12},${ly-6}" fill="none" stroke="#8b6914" stroke-width="0.8" opacity=".6"/>`;
              });
            }
          }

          svg += `</svg>`;
          return svg;
        }

        // ── Garden tab render ─────────────────────────────────────────────────
        async function loadGarden() {
          const cont = body.querySelector('#sm-content');
          cont.innerHTML = `<div class="sm-no-data">${_smt('loading')}</div>`;
          try {
            const r = await fetch('/api/apps/server-monitor/plant');
            if (!r.ok) throw new Error(r.status);
            const p = await r.json();
            renderGarden(p);
          } catch(e) {
            cont.innerHTML = `<div class="sm-no-data">${_smt('error')}</div>`;
          }
        }

        function renderGarden(p) {
          const cont = body.querySelector('#sm-content');
          const archive  = p.archive ?? [];
          const gen      = p.generation ?? 1;
          const seed     = p.seed ?? 0;
          const plantName = p.name ?? 'Lumivex';

          // ── Seed screen ────────────────────────────────────────────────────
          if (!p.started) {
            const archiveHtml = archive.length ? `
              <div style="margin-top:24px;width:100%;max-width:520px">
                <div style="font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Архивирани растения</div>
                <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
                  ${archive.map(a => `
                    <div style="text-align:center;background:#1e2433;border-radius:10px;padding:10px 14px">
                      <div style="font-size:.65rem;color:#60a5fa;font-weight:600;margin-bottom:4px">#${a.generation} ${a.name}</div>
                      ${drawPlant(100, a.health, a.seed)}
                      <div style="font-size:.6rem;color:#475569;margin-top:4px">${a.days} ${_smt('days_label')} · health ${a.health}%</div>
                    </div>`).join('')}
                </div>
              </div>` : '';

            cont.innerHTML = `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;gap:16px;padding:20px">
                <div style="opacity:.4">${drawPlant(0, 100, seed)}</div>
                <div style="text-align:center">
                  <div style="font-size:.7rem;color:#60a5fa;margin-bottom:4px;font-weight:600">#${gen} ${plantName}</div>
                  <div style="font-size:1rem;color:#e2e8f0;margin-bottom:6px">${_smt('seed_title')}</div>
                  <div style="font-size:.8rem;color:#64748b;margin-bottom:20px">${_smt('seed_sub')}</div>
                  <button id="sm-plant-btn" style="background:#22c55e;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:.9rem;cursor:pointer;font-weight:600">
                    🌱 ${_smt('plant_btn')}
                  </button>
                </div>
                ${archiveHtml}
              </div>`;
            cont.querySelector('#sm-plant-btn').addEventListener('click', async () => {
              await fetch('/api/apps/server-monitor/plant/plant', { method: 'POST' });
              // move Plant tab to first position now that plant exists
              TABS = [TAB_PLANT, ...TABS_METRICS];
              activeTab = 'plant';
              buildTabs();
              loadGarden();
            });
            return;
          }

          const growth = p.growth ?? 0;
          const health = p.health ?? 100;
          const stage  = growth < 3  ? _smt('stage_seed')   :
                         growth < 20 ? _smt('stage_sprout')  :
                         growth < 40 ? _smt('stage_young')   :
                         growth < 60 ? _smt('stage_mature')  :
                         growth < 80 ? _smt('stage_bloom')   : _smt('stage_tree');

          const hColor = health > 60 ? '#22c55e' : health > 30 ? '#f59e0b' : '#ef4444';
          const gColor = '#3b82f6';
          const lastLog     = p.log?.[p.log.length - 1];
          const boostMins   = Math.ceil((p.boost_remaining ?? 0) / 60);
          const lastCpu     = lastLog?.cpu          ?? null;
          const lastRam     = lastLog?.ram          ?? null;
          const lastDisk    = lastLog?.disk         ?? null;
          const lastNetMb   = lastLog?.net_mb       ?? null;
          const lastDiskR   = lastLog?.disk_read_mb  ?? null;
          const lastDiskW   = lastLog?.disk_write_mb ?? null;
          // disk I/O penalty: smooth asymptotic formula, only when write > read
          const _weedPct = (() => {
            if (lastDiskR === null || lastDiskW === null) return 0;
            if (lastDiskW > lastDiskR) {
              if (lastDiskR > 0) { const x = lastDiskW / lastDiskR - 1; return 3 * x / (x + 2); }
              return 3;
            }
            return 0;
          })();
          // recalculate health delta (same formula as backend)
          const _cpuRaw    = lastCpu !== null ? -((lastCpu - 20) / 80) * (100 / 24) : null;
          const _ramMod    = lastRam !== null ? (lastRam - 50) / 50 * 0.5 : 0;
          const _cpuEffect = _cpuRaw !== null ? _cpuRaw - Math.abs(_cpuRaw) * _ramMod : null;
          const _dlBonus   = lastNetMb !== null ? Math.min(3, lastNetMb * 60 / 100) : 0;
          let _rawHealth   = _cpuEffect !== null ? _cpuEffect + _dlBonus : null;
          if (_rawHealth !== null && _weedPct > 0) _rawHealth -= _weedPct / 24;
          const healthDelta = lastLog
            ? (p.boost_active && _rawHealth !== null && _rawHealth < 0 ? 0 : _rawHealth)
            : null;
          // recalculate growth rate, apply weed penalty and boost
          const _diskMult      = lastDisk !== null ? 1 - Math.max(0, (lastDisk - 50) / 50) : 1;
          const _baseGrowth    = (1 / 24) * _diskMult + (lastNetMb !== null ? Math.min(3, lastNetMb * 60 / 100) : 0);
          const _growthWeed    = _weedPct > 0 ? Math.max(0, _baseGrowth - _weedPct / 24) : _baseGrowth;
          const _growthPerHour = p.boost_active ? _growthWeed * 2 : _growthWeed;
          const dailyRate      = lastLog ? (_growthPerHour * 24).toFixed(2) : '—';

          // compute effects (same formulas as backend)
          function _fmtEff(val, pos) {
            if (val === null) return '—';
            const s = (val >= 0 ? '+' : '') + val.toFixed(3) + '%/' + _smt('per_hour');
            return `<span style="color:${val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#64748b'}">${s}</span>`;
          }
          let cpuEffect = null, ramMod = null, diskEffect = null, dlBonus = null, ulBonus = null;
          if (lastCpu !== null) {
            const _cr = -((lastCpu - 20) / 80) * (100 / 24);
            ramMod    = lastRam !== null ? ((lastRam - 50) / 50) * 0.5 : 0;
            cpuEffect = _cr - Math.abs(_cr) * ramMod;
            if (p.boost_active && cpuEffect < 0) cpuEffect = 0;
          }
          if (lastDisk !== null) {
            const diskMult = 1 - Math.max(0, (lastDisk - 50) / 50);
            diskEffect = (1/24) * diskMult - (1/24); // deviation from base
          }
          if (lastNetMb !== null) {
            const netHr = lastNetMb * 60;
            dlBonus = Math.min(3, netHr / 100);
            ulBonus = Math.min(3, netHr / 100);
          }

          const canArchive = growth >= 100 && health >= 70;
          const boostHours = Math.round((p.boost_remaining ?? 0) / 3600 * 10) / 10;

          // archived list html
          const archiveListHtml = archive.length ? `
            <div style="background:#1e2433;border-radius:10px;padding:12px 14px">
              <div style="font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${_smt('archive_label')}</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${archive.map(a => `
                  <div style="display:flex;align-items:center;gap:10px">
                    <div style="flex-shrink:0;transform:scale(0.4);transform-origin:left center;width:80px;height:50px;overflow:visible">
                      ${drawPlant(100, a.health, a.seed)}
                    </div>
                    <div>
                      <div style="font-size:.75rem;color:#60a5fa;font-weight:600">#${a.generation} ${a.name}</div>
                      <div style="font-size:.65rem;color:#64748b">${a.days} ${_smt('days_label')} · health ${a.health}%</div>
                    </div>
                  </div>`).join('')}
              </div>
            </div>` : '';

          cont.innerHTML = `
            <div style="display:flex;gap:16px;padding:4px 0;height:100%;box-sizing:border-box;flex-wrap:wrap">

              <!-- Plant visual -->
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:200px;flex:0 0 auto;gap:8px">
                <div style="font-size:.65rem;color:#60a5fa;font-weight:600">#${gen} ${plantName}</div>
                <div style="font-size:.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${stage}</div>
                <div id="sm-plant-svg" style="cursor:${p.boost_active ? 'default' : 'pointer'}" title="${p.boost_active ? _smt('boost_active') : _smt('water_btn')}">
                  ${drawPlant(growth, health, seed)}
                </div>
                ${p.boost_active
                  ? `<div style="font-size:.75rem;color:#60a5fa;background:#1e3a5f;padding:4px 10px;border-radius:20px">
                       💧 ${_smt('boost_active')} — ${boostHours}ч
                     </div>`
                  : `<button id="sm-water-btn" style="background:#1e3a5f;color:#60a5fa;border:1px solid #2563eb;border-radius:8px;padding:6px 16px;font-size:.8rem;cursor:pointer">
                       ${_smt('water_btn')}
                     </button>`
                }
                ${canArchive ? `
                  <button id="sm-archive-btn" style="background:#854d0e;color:#fde68a;border:1px solid #a16207;border-radius:8px;padding:6px 14px;font-size:.78rem;cursor:pointer;font-weight:600">
                    🏆 Архивирай
                  </button>` : ''}
              </div>

              <!-- Stats -->
              <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:10px;overflow-y:auto">

                <div style="background:#1e2433;border-radius:10px;padding:12px 14px">
                  <div style="font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${_smt('health_lbl')} & ${_smt('growth_lbl')}</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div>
                      <div style="font-size:.7rem;color:#64748b">${_smt('health_lbl')}</div>
                      <div style="font-size:1.6rem;font-weight:700;color:${hColor}">${health.toFixed(1)}%</div>
                      <div style="height:4px;background:#263142;border-radius:2px;margin-top:4px">
                        <div style="height:4px;width:${health}%;background:${hColor};border-radius:2px;transition:width .4s"></div>
                      </div>
                      <div id="sm-health-pct" style="margin-top:5px;font-size:.72rem;cursor:pointer;color:${healthDelta === null ? '#475569' : healthDelta > 0 ? '#22c55e' : healthDelta < 0 ? '#ef4444' : '#64748b'}" title="breakdown">
                        ${healthDelta === null ? '—' : (healthDelta > 0 ? '▲ +' : healthDelta < 0 ? '▼ ' : '● ') + healthDelta.toFixed(3) + '%/' + _smt('per_hour')}
                      </div>
                    </div>
                    <div>
                      <div style="font-size:.7rem;color:#64748b">${_smt('growth_lbl')}</div>
                      <div style="font-size:1.6rem;font-weight:700;color:${gColor}">${growth.toFixed(1)}%</div>
                      <div style="height:4px;background:#263142;border-radius:2px;margin-top:4px">
                        <div style="height:4px;width:${growth}%;background:${gColor};border-radius:2px;transition:width .4s"></div>
                      </div>
                      <div style="margin-top:5px;font-size:.72rem;color:#64748b">
                        <span id="sm-growth-rate" style="cursor:pointer" title="breakdown">${_smt('daily_rate')}: <span style="color:#e2e8f0">${dailyRate}% / ${_smt('per_day')}</span></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div style="background:#1e2433;border-radius:10px;padding:12px 14px">
                  <div style="font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">
                    ${_smt('influence')}
                    ${!lastLog ? `<span style="color:#334155;font-weight:400;text-transform:none">${_smt('waiting_first')}</span>` : ''}
                  </div>
                  <div style="display:flex;flex-direction:column;gap:5px;font-size:.75rem">

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#475569">${_smt('metric')}</span>
                      <span style="color:#475569">${_smt('value')}</span>
                      <span style="color:#475569">${_smt('effect')}</span>
                    </div>
                    <div style="height:1px;background:#263142;margin:2px 0"></div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">CPU</span>
                      <span style="color:${lastCpu!==null?(lastCpu>60?'#ef4444':lastCpu>20?'#f59e0b':'#22c55e'):'#334155'}">${lastCpu !== null ? lastCpu.toFixed(1)+'%' : '—'}</span>
                      <span style="font-size:.7rem">${cpuEffect !== null ? _fmtEff(cpuEffect) : '—'} <span style="color:#334155">${_smt('on_health')}</span></span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">RAM</span>
                      <span style="color:${lastRam!==null?(lastRam>80?'#ef4444':lastRam>50?'#f59e0b':'#22c55e'):'#334155'}">${lastRam !== null ? lastRam.toFixed(1)+'%' : '—'}</span>
                      <span style="font-size:.7rem;color:#64748b">${lastRam !== null
                        ? (Math.abs(ramMod) < 0.01 ? _smt('ram_neutral')
                          : ramMod > 0 ? `+${(ramMod*100).toFixed(0)}% ${_smt('ram_cpu_more')}`
                          : `${(ramMod*100).toFixed(0)}% ${_smt('ram_cpu_less')}`)
                        : '—'}</span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">Disk</span>
                      <span style="color:${lastDisk!==null?(lastDisk>80?'#ef4444':lastDisk>50?'#f59e0b':'#22c55e'):'#334155'}">${lastDisk !== null ? lastDisk.toFixed(1)+'%' : '—'}</span>
                      <span style="font-size:.7rem">${lastDisk !== null
                        ? (lastDisk > 50
                          ? `<span style="color:#ef4444">${_smt('disk_slow')}${((lastDisk-50)/50*100).toFixed(0)}%</span>`
                          : `<span style="color:#22c55e">+${(1/24).toFixed(3)}%/h ${_smt('on_growth')}</span>`)
                        : '—'}</span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">Net↓</span>
                      <span style="color:#94a3b8">${lastNetMb !== null ? (lastNetMb*60).toFixed(1)+' MB/h' : '—'}</span>
                      <span style="font-size:.7rem">${dlBonus !== null ? _fmtEff(dlBonus) : '—'} <span style="color:#334155">${_smt('on_health')}</span></span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">Net↑</span>
                      <span style="color:#94a3b8">${lastNetMb !== null ? (lastNetMb*60).toFixed(1)+' MB/h' : '—'}</span>
                      <span style="font-size:.7rem">${ulBonus !== null ? _fmtEff(ulBonus) : '—'} <span style="color:#334155">${_smt('on_growth')}</span></span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">Disk R</span>
                      <span style="color:#94a3b8">${lastDiskR !== null ? lastDiskR.toFixed(2)+' MB/s' : '—'}</span>
                      <span style="font-size:.7rem;color:#334155">—</span>
                    </div>

                    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center">
                      <span style="color:#64748b">Disk W</span>
                      <span style="color:#94a3b8">${lastDiskW !== null ? lastDiskW.toFixed(2)+' MB/s' : '—'}</span>
                      <span style="font-size:.7rem">${_weedPct > 0
                        ? `<span style="color:#ef4444">-${_weedPct.toFixed(2)}%/day</span> <span style="color:#334155">health+growth</span>`
                        : `<span style="color:#334155">W≤R → ок</span>`}</span>
                    </div>

                  </div>
                  ${p.boost_active ? `
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263142;font-size:.72rem;color:#60a5fa">
                      💧 ${_smt('boost_status').replace('{h}', boostHours)}
                    </div>` : ''}
                </div>

                ${archiveListHtml}

                <div style="display:flex;gap:6px">
                  <button id="sm-widget-btn" style="flex:1;background:#1e2433;border:1px solid #334155;color:#94a3b8;border-radius:8px;padding:8px 14px;font-size:.78rem;cursor:pointer;text-align:left">
                    ${_smt('add_widget')}
                  </button>
                  <button id="sm-taskbar-btn" style="flex:1;background:#1e2433;border:1px solid #334155;color:#94a3b8;border-radius:8px;padding:8px 14px;font-size:.78rem;cursor:pointer;text-align:left">
                    🌱 Add to taskbar
                  </button>
                  <button id="sm-preview-btn" style="background:#1e2433;border:1px solid #334155;color:#64748b;border-radius:8px;padding:8px 12px;font-size:.78rem;cursor:pointer" title="Preview">
                    🔍
                  </button>
                </div>
              </div>
            </div>`;

          // breakdown popup helper
          function showBreakdown(anchor, rows) {
            document.getElementById('sm-breakdown-popup')?.remove();
            const pop = document.createElement('div');
            pop.id = 'sm-breakdown-popup';
            pop.style.cssText = 'position:absolute;z-index:999;background:#1e2433;border:1px solid #334155;border-radius:10px;padding:12px 14px;font-size:.72rem;min-width:200px;box-shadow:0 4px 20px rgba(0,0,0,.5)';
            pop.innerHTML = rows.map(([label, val, color]) =>
              label === ''
                ? `<div style="border-top:1px solid #334155;margin:4px 0"></div>`
                : `<div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0">
                    <span style="color:#94a3b8">${label}</span>
                    <span style="color:${color};font-weight:600;white-space:nowrap">${val}</span>
                  </div>`
            ).join('');
            cont.style.position = 'relative';
            cont.appendChild(pop);
            const ar = anchor.getBoundingClientRect();
            const cr = cont.getBoundingClientRect();
            pop.style.left = (ar.left - cr.left) + 'px';
            pop.style.top  = (ar.bottom - cr.top + 6) + 'px';
            setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 50);
          }

          // health breakdown click
          cont.querySelector('#sm-health-pct')?.addEventListener('click', function(e) {
            e.stopPropagation();
            const ph  = _smt('per_hour');
            const fmt = (v) => {
              if (v === null) return ['—', '#64748b'];
              return [(v >= 0 ? '+' : '') + v.toFixed(3) + '%/' + ph, v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#64748b'];
            };
            // CPU: neutral at 20%, -4.17%/h at 100%, +4.17%/h at 0%
            const cpuRaw    = lastCpu !== null ? -((lastCpu - 20) / 80) * (100 / 24) : null;
            const cpuLabel  = lastCpu !== null
              ? 'CPU ' + lastCpu.toFixed(1) + '% (' + (lastCpu < 20 ? '< 20% → heals' : lastCpu === 20 ? 'neutral' : '> 20% → dmg') + ')'
              : 'CPU';
            // RAM >50% always bad, <50% always good — works against plant when high
            const ramMod    = lastRam !== null ? (lastRam - 50) / 50 * 0.5 : 0;
            const ramEffect = cpuRaw !== null ? -(Math.abs(cpuRaw) * ramMod) : null;
            const ramPct    = Math.abs(ramMod * 100).toFixed(0);
            const ramDir    = ramMod > 0 ? (cpuRaw >= 0 ? 'reduces heal' : 'amplifies dmg')
                                         : ramMod < 0 ? (cpuRaw >= 0 ? 'amplifies heal' : 'reduces dmg') : 'neutral';
            const ramLabel  = lastRam !== null
              ? 'RAM ' + lastRam.toFixed(1) + '% (' + (ramMod >= 0 ? '+' : '-') + ramPct + '% → ' + ramDir + ')'
              : 'RAM';
            const cpuFinal  = cpuRaw !== null ? cpuRaw + (ramEffect ?? 0) : null;
            // Download bonus: asymptotic, max 3%/day
            const netInHr   = lastNetMb !== null ? lastNetMb * 60 : null;
            const dlVal     = netInHr !== null ? (3.0 * netInHr / (netInHr + 50.0)) / 24 : null;
            const dlLabel   = netInHr !== null ? 'Download ' + netInHr.toFixed(1) + ' MB/h' : 'Download';
            // Disk weed: write/read ratio → direct penalty on health
            const weedRatio   = _weedPct > 0 && lastDiskR > 0 ? (lastDiskW / lastDiskR).toFixed(2) : null;
            const weedLabelH  = lastDiskR !== null
              ? 'Disk R:' + (lastDiskR ?? 0).toFixed(2) + ' W:' + (lastDiskW ?? 0).toFixed(2) + ' MB/s'
                + (_weedPct > 0 ? ' (W:R ' + weedRatio + ':1)' : ' (R≥W → ок)')
              : null;
            let totalH = (cpuFinal ?? 0) + (dlVal ?? 0);
            const weedEffectH = _weedPct > 0 ? -_weedPct / 24 : null;
            if (_weedPct > 0) totalH -= _weedPct;
            const effectiveH = p.boost_active && totalH < 0 ? 0 : totalH;
            const rows = [
              [cpuLabel,       ...fmt(cpuRaw)],
              [ramLabel,       ...fmt(ramEffect)],
              [dlLabel,        ...fmt(dlVal)],
              ...(weedLabelH ? [[weedLabelH, ...fmt(weedEffectH)]] : []),
              ['', '', ''],
              ['= ' + _smt('health_lbl'), ...fmt(effectiveH)],
            ];
            if (p.boost_active) rows.splice(rows.length - 2, 0, ['💧 Boost (blocks dmg)', '🛡️', '#60a5fa']);
            showBreakdown(this, rows);
          });

          // growth breakdown click
          cont.querySelector('#sm-growth-rate')?.addEventListener('click', function(e) {
            e.stopPropagation();
            const pd      = _smt('per_day');
            const fmtD    = (v) => {
              if (v === null) return ['—', '#64748b'];
              return [(v >= 0 ? '+' : '') + (v * 24).toFixed(2) + '%/' + pd, v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#64748b'];
            };
            // Disk: < 50% = no penalty, > 50% slows growth up to 100% stop
            const diskMult  = lastDisk !== null ? 1 - Math.max(0, (lastDisk - 50) / 50) : 1;
            const diskPen   = lastDisk !== null ? (1/24) * diskMult - (1/24) : null;
            const diskLabel = lastDisk !== null
              ? 'Disk ' + lastDisk.toFixed(1) + '% (' + (lastDisk <= 50 ? 'no penalty' : '×' + diskMult.toFixed(2) + ' slowdown') + ')'
              : 'Disk';
            // Upload bonus: asymptotic, max 3%/day
            const netOutHr  = lastNetMb !== null ? lastNetMb * 60 : null;
            const ulVal     = netOutHr !== null ? (3.0 * netOutHr / (netOutHr + 50.0)) / 24 : null;
            const ulLabel   = netOutHr !== null ? 'Upload ' + netOutHr.toFixed(1) + ' MB/h' : 'Upload';
            // Disk weed effect on growth
            const weedLabelG = lastDiskR !== null
              ? 'Disk R:' + (lastDiskR ?? 0).toFixed(2) + ' W:' + (lastDiskW ?? 0).toFixed(2) + ' MB/s'
                + (_weedPct > 0 ? ' (W:R ' + (lastDiskR > 0 ? (lastDiskW/lastDiskR).toFixed(2) : '∞') + ':1)' : ' (R≥W → ок)')
              : null;
            const weedEffectG = _weedPct > 0 ? -_weedPct / 24 : null;
            const rows = [
              ['Base growth rate', '+1%/' + pd, '#e2e8f0'],
              [diskLabel, ...(diskPen !== null && diskPen < 0 ? fmtD(diskPen) : ['no effect', '#64748b'])],
              [ulLabel,   ...(ulVal !== null && ulVal > 0 ? fmtD(ulVal) : ['no effect', '#64748b'])],
              ...(weedLabelG ? [[weedLabelG, ...(_weedPct > 0 ? fmtD(weedEffectG) : ['no effect', '#64748b'])]] : []),
              ['', '', ''],
              ['= ' + _smt('growth_lbl'), ...fmtD(_growthWeed)],
            ];
            if (p.boost_active) rows.splice(rows.length - 2, 0, ['💧 Boost', '×2', '#60a5fa']);
            showBreakdown(this, rows);
          });

          // water button
          cont.querySelector('#sm-water-btn')?.addEventListener('click', async () => {
            await fetch('/api/apps/server-monitor/plant/water', { method: 'POST' });
            mvmOS.notify('Bit Garden', _smt('watered'));
            loadGarden();
          });

          // click on plant = water shortcut
          cont.querySelector('#sm-plant-svg')?.addEventListener('click', async () => {
            if (p.boost_active) return;
            await fetch('/api/apps/server-monitor/plant/water', { method: 'POST' });
            mvmOS.notify('Bit Garden', _smt('watered'));
            loadGarden();
          });

          // archive button
          cont.querySelector('#sm-archive-btn')?.addEventListener('click', async () => {
            const ok = await mvmOS.confirm(`Архивирай ${plantName}?\n\nРастението ще се запази в архива и ще започне ново.`);
            if (!ok) return;
            const r = await fetch('/api/apps/server-monitor/plant/archive', { method: 'POST' });
            const d = await r.json();
            if (d.ok) {
              mvmOS.notify('Bit Garden', `${plantName} е архивиран! Започва поколение #${d.generation}.`);
              loadGarden();
            } else {
              mvmOS.notify('Bit Garden', d.reason ?? 'Грешка');
            }
          });

          // preview button
          cont.querySelector('#sm-preview-btn')?.addEventListener('click', () => {
            const existing = body.querySelector('#sm-modal');
            if (existing) existing.remove();

            const PHASES = [
              { g:  0, label: '0%'  }, { g:  5, label: '5%'  }, { g: 15, label: '15%' },
              { g: 30, label: '30%' }, { g: 50, label: '50%' }, { g: 70, label: '70%' },
              { g: 85, label: '85%' }, { g:100, label: '100%'},
            ];
            const PLANTS = [
              {name:'Lumivex',seed:1001},{name:'Thornalis',seed:2002},{name:'Veradusk',seed:3003},
              {name:'Crysthorn',seed:4004},{name:'Morveil',seed:5005},{name:'Faebloom',seed:6006},
              {name:'Solmira',seed:7007},{name:'Duskpetal',seed:8008},{name:'Irisvex',seed:9009},
              {name:'Nyxflora',seed:10010},
            ];
            const HEALTHS = [
              { h: 100, label: _smt('prev_healthy'), col: '#22c55e' },
              { h:  20, label: _smt('prev_normal'),  col: '#f59e0b' },
              { h:   5, label: _smt('prev_sick'),    col: '#ef4444' },
            ];

            function scaledPlant(g, h, s) {
              const sc = 0.48;
              return `<div style="width:${Math.round(200*sc)}px;height:${Math.round(230*sc)}px;overflow:hidden;display:inline-block;vertical-align:top">
                <div style="transform:scale(${sc});transform-origin:top left;pointer-events:none">${drawPlant(g, h, s)}</div>
              </div>`;
            }

            function buildTable(s) {
              const cols = HEALTHS.map(hv => `<th style="padding:6px 10px;font-size:.65rem;color:${hv.col};font-weight:600;text-align:center;border-bottom:1px solid #1e2433;white-space:nowrap">${hv.label}</th>`).join('');
              const rows = PHASES.map(ph => {
                const cells = HEALTHS.map(hv => `<td style="padding:4px 6px;text-align:center;border-bottom:1px solid #0f1623">${scaledPlant(ph.g, hv.h, s)}</td>`).join('');
                return `<tr>
                  <td style="padding:4px 10px;font-size:.65rem;color:#64748b;white-space:nowrap;border-bottom:1px solid #0f1623;border-right:1px solid #1e2433">${ph.label}</td>
                  ${cells}
                </tr>`;
              }).join('');
              return `<table style="border-collapse:collapse;margin:0 auto">
                <thead><tr>
                  <th style="padding:6px 10px;font-size:.65rem;color:#334155;text-align:left;border-bottom:1px solid #1e2433;border-right:1px solid #1e2433">${_smt('prev_growth')}</th>
                  ${cols}
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>`;
            }

            const seedOpts = PLANTS.map(pl =>
              `<option value="${pl.seed}" ${pl.seed === seed ? 'selected' : ''}>${pl.name}${pl.seed === seed ? ' ★' : ''}</option>`
            ).join('');

            const modal = document.createElement('div');
            modal.id = 'sm-modal';
            modal.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.75);z-index:100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
            modal.innerHTML = `
              <div style="background:#0f1117;border:1px solid #1e2433;border-radius:14px;width:95%;max-width:700px;max-height:90%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.7)">
                <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #1e2433">
                  <span style="font-weight:700;font-size:.9rem">🌱 Plant Preview</span>
                  <select id="sm-seed-sel" style="background:#1e2433;border:1px solid #334155;color:#94a3b8;border-radius:6px;padding:4px 8px;font-size:.75rem;cursor:pointer">${seedOpts}</select>
                  <button id="sm-modal-close" style="background:none;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;margin-left:auto">✕</button>
                </div>
                <div id="sm-preview-body" style="overflow-y:auto;padding:16px">${buildTable(seed)}</div>
              </div>`;
            modal.querySelector('#sm-seed-sel').addEventListener('change', e => {
              modal.querySelector('#sm-preview-body').innerHTML = buildTable(parseInt(e.target.value));
            });
            modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            modal.querySelector('#sm-modal-close').addEventListener('click', () => modal.remove());
            body.style.position = 'relative';
            body.appendChild(modal);
          });

          // add widget button — install as proper widget (persists across reloads)
          cont.querySelector('#sm-widget-btn')?.addEventListener('click', async () => {
            const btn = cont.querySelector('#sm-widget-btn');
            btn.disabled = true;
            try {
              const r = await fetch('/api/widgets/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id:          'server-monitor-garden',
                  name:        'Bit Garden',
                  icon:        '🌱',
                  category:    'System',
                  version:     '1.0.0',
                  description: 'Server plant that grows based on server health',
                  widget_type: 'desktop',
                  js_url:      window.location.origin + '/apps/server-monitor/widget.js',
                }),
              });
              if (r.ok) {
                // load & register immediately without page reload
                window._bgwRegistered = false;
                const s = document.createElement('script');
                s.src = '/apps/server-monitor/widget.js?_=' + Date.now();
                document.head.appendChild(s);
                btn.textContent = '✓ ' + _smt('add_widget');
                mvmOS.notify('Bit Garden', _smt('add_widget'));
              }
            } catch(e) {
              btn.disabled = false;
            }
          });
          // taskbar widget install button
          cont.querySelector('#sm-taskbar-btn')?.addEventListener('click', async () => {
            const btn = cont.querySelector('#sm-taskbar-btn');
            btn.disabled = true;
            try {
              const r = await fetch('/api/widgets/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id:          'server-monitor-garden-taskbar',
                  name:        'Bit Garden (taskbar)',
                  icon:        '🌱',
                  category:    'System',
                  version:     '1.0.0',
                  description: 'Bit Garden taskbar widget',
                  widget_type: 'taskbar',
                  js_url:      window.location.origin + '/apps/server-monitor/widget.js',
                }),
              });
              if (r.ok) {
                window._bgwRegistered = false;
                const s = document.createElement('script');
                s.src = '/apps/server-monitor/widget.js?_=' + Date.now();
                document.head.appendChild(s);
                btn.textContent = '✓ Taskbar';
                mvmOS.notify('Bit Garden', 'Taskbar widget added!');
              }
            } catch(e) {
              btn.disabled = false;
            }
          });
        }

        // ── Render functions per tab ──────────────────────────────────────────
        function renderCpu(data) {
          const pts = data.points;
          if (!pts.length) return `<div class="sm-no-data">${_smt('no_data')}</div>`;
          return chartBlock(_smt('cpu_pct'),  pts, 'cpu',    '#3b82f6')
               + chartBlock(_smt('load_1m'),  pts, 'load1',  '#8b5cf6', '')
               + chartBlock(_smt('load_5m'),  pts, 'load5',  '#6366f1', '')
               + chartBlock(_smt('load_15m'), pts, 'load15', '#4f46e5', '');
        }

        function renderRam(data) {
          const pts = data.points;
          if (!pts.length) return `<div class="sm-no-data">${_smt('no_data')}</div>`;
          return chartBlock(_smt('ram_used'),  pts, 'ram_used_pct',  '#22c55e')
               + chartBlock(_smt('swap_used'), pts, 'swap_used_pct', '#f59e0b');
        }

        function renderDisk(data) {
          const pts = data.points;
          if (!pts.length) return `<div class="sm-no-data">${_smt('no_data')}</div>`;
          return chartBlock(_smt('disk_used'),  pts, 'disk_used_pct',  '#f97316')
               + chartBlock(_smt('read_mbs'),  pts, 'disk_read_mb',  '#06b6d4', ' MB/s')
               + chartBlock(_smt('write_mbs'), pts, 'disk_write_mb', '#8b5cf6', ' MB/s');
        }

        function renderNet(data) {
          const pts = data.points;
          if (!pts.length) return `<div class="sm-no-data">${_smt('no_data')}</div>`;
          return chartBlock(_smt('net_in_mbs'),  pts, 'net_in_mb',  '#22c55e', ' MB/s')
               + chartBlock(_smt('net_out_mbs'), pts, 'net_out_mb', '#ef4444', ' MB/s');
        }

        function renderSensors(data) {
          const pts = data.points;
          const hasSensors = pts.some(p => p.avg_temp_max != null);
          if (!hasSensors) {
            return `<div class="sm-no-data">🌡️<br><br>${_smt('no_sensors')}</div>`;
          }
          return chartBlock(_smt('temp_max'), pts, 'temp_max', '#f43f5e', '°C');
        }

        const RENDERERS = { cpu: renderCpu, ram: renderRam, disk: renderDisk, net: renderNet, sensors: renderSensors };

        // ── Load & render ─────────────────────────────────────────────────────
        async function loadTab() {
          const periodsEl = body.querySelector('#sm-periods');
          if (activeTab === 'plant') {
            periodsEl.style.display = '';
            // reset period active state when switching to plant tab
            if (plantHistoryPeriod === null) {
              periodsEl.querySelectorAll('.sm-period').forEach(b => b.classList.remove('active'));
            }
            if (plantHistoryPeriod) {
              loadPlantHistory();
            } else {
              loadGarden();
            }
            return;
          }
          plantHistoryPeriod = null;
          periodsEl.querySelectorAll('.sm-period').forEach(b => b.classList.remove('active'));
          periodsEl.querySelectorAll('.sm-period').forEach(b => {
            if (b.dataset.period === activePeriod) b.classList.add('active');
          });
          periodsEl.style.display = '';

          const key = activeTab + '_' + activePeriod;
          const cont = body.querySelector('#sm-content');

          if (cache[key]) {
            cont.innerHTML = RENDERERS[activeTab](cache[key]);
            return;
          }

          cont.innerHTML = `<div class="sm-no-data">${_smt('loading')}</div>`;

          try {
            const _tz = encodeURIComponent(window._vosSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
            const r = await fetch(`/api/apps/server-monitor/metrics?period=${activePeriod}&tz=${_tz}`);
            if (!r.ok) throw new Error(r.status);
            const data = await r.json();
            cache[key] = data;
            cont.innerHTML = RENDERERS[activeTab](data);
          } catch(e) {
            cont.innerHTML = `<div class="sm-no-data">${_smt('error')}</div>`;
          }
        }

        async function loadPlantHistory() {
          const cont = body.querySelector('#sm-content');
          cont.innerHTML = `<div class="sm-no-data">${_smt('loading')}</div>`;
          try {
            const _tz2 = encodeURIComponent(window._vosSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
            const r = await fetch(`/api/apps/server-monitor/plant-history?period=${plantHistoryPeriod}&tz=${_tz2}`);
            if (!r.ok) throw new Error(r.status);
            const data = await r.json();
            const pts = data.points;
            if (!pts.length) { cont.innerHTML = `<div class="sm-no-data">${_smt('no_plant_history')}</div>`; return; }
            // map to avg_<field> format expected by chartBlock
            const mapped = pts.map(p => ({ ts: p.ts, avg_health: p.health, avg_growth: p.growth }));
            cont.innerHTML = chartBlock(_smt('health_lbl'), mapped, 'health', '#22c55e')
                           + chartBlock(_smt('growth_lbl'), mapped, 'growth', '#3b82f6');
          } catch(e) {
            cont.innerHTML = `<div class="sm-no-data">${_smt('error')}</div>`;
          }
        }

        // ── Auto-refresh every 60s (started after plant check resolves) ─────────
        refreshTimer = setInterval(() => {
          cache = {};
          loadTab();
        }, 60000);

        // cleanup
        body._smCleanup = () => clearInterval(refreshTimer);
      }
    });
  }
});
