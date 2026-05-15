// mvmOS App: System Info v1.1.0
const _si18n = {
  en: {
    title: 'System Info', tab_overview: 'Overview', tab_cpu: 'CPU', tab_memory: 'Memory',
    tab_disks: 'Disks', tab_network: 'Network', tab_temps: 'Sensors',
    failed: 'Failed to load system info.',
    sys: '🖥️ System', hostname: 'Hostname', os: 'OS', kernel: 'Kernel', uptime: 'Uptime',
    cpu: '⚡ CPU', model: 'Model', cores: 'Cores', frequency: 'Frequency', load_avg: 'Load avg',
    memory: '🧠 Memory', used: 'Used', swap: 'Swap', available: 'Available', free_exact: 'Free (exact)',
    disk: '💾 Disk', free: 'Free', no_disk: 'No disk info',
    temps: '🌡️ Temperatures', temp_sensors: '🌡️ Temperature Sensors',
    no_disks: 'No disks found.', no_network: 'No network interfaces found.',
    no_temps: 'No temperature sensors detected.', no_temps_note: 'This is normal on virtual servers (VPS/cloud).',
    rx: '↓ Received', tx: '↑ Sent', packets: 'packets',
    cpu_details: '⚡ CPU Details', phys_cores: 'Physical cores', avg_freq: 'Avg frequency',
    load1: 'Load (1 min)', load5: 'Load (5 min)', load15: 'Load (15 min)',
    ram: '🧠 RAM', total: 'Total', calculating: 'calculating…',
  },
  bg: {
    title: 'Системна информация', tab_overview: 'Обзор', tab_cpu: 'Процесор', tab_memory: 'Памет',
    tab_disks: 'Дискове', tab_network: 'Мрежа', tab_temps: 'Сензори',
    failed: 'Грешка при зареждане.',
    sys: '🖥️ Система', hostname: 'Хост', os: 'ОС', kernel: 'Ядро', uptime: 'Работно време',
    cpu: '⚡ Процесор', model: 'Модел', cores: 'Ядра', frequency: 'Честота', load_avg: 'Натоварване',
    memory: '🧠 Памет', used: 'Използвана', swap: 'Суап', available: 'Налична', free_exact: 'Свободна (точно)',
    disk: '💾 Диск', free: 'Свободно', no_disk: 'Няма информация за диск',
    temps: '🌡️ Температури', temp_sensors: '🌡️ Температурни сензори',
    no_disks: 'Няма намерени дискове.', no_network: 'Няма намерени мрежови интерфейси.',
    no_temps: 'Няма открити температурни сензори.', no_temps_note: 'Нормално е за виртуални сървъри (VPS/cloud).',
    rx: '↓ Получено', tx: '↑ Изпратено', packets: 'пакета',
    cpu_details: '⚡ Детайли за процесора', phys_cores: 'Физически ядра', avg_freq: 'Средна честота',
    load1: 'Натоварване (1 мин)', load5: 'Натоварване (5 мин)', load15: 'Натоварване (15 мин)',
    ram: '🧠 RAM', total: 'Общо', calculating: 'изчисляване…',
  },
};
function _sit(key) { const lang = window.mvmOS?.lang || 'en'; return (_si18n[lang] || _si18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'system-info',
  name: _sit('title'),
  icon: '🖥️',
  category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'system-info',
      title: '🖥️ ' + _sit('title'),
      width: 720,
      height: 560,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => SI.init(body)); },
    });
  }
});

const SI = (() => {
  let _timer = null;
  let _netPrev = null;
  let _netPrevTime = null;

  const TABS = () => [
    ['overview', _sit('tab_overview')], ['cpu', _sit('tab_cpu')], ['memory', _sit('tab_memory')],
    ['disks', _sit('tab_disks')], ['network', _sit('tab_network')], ['temps', _sit('tab_temps')],
  ];
  const mobile = () => window.innerWidth < 768;

  function init(body) {
    body.style.padding = '0';
    const isMob = mobile();
    const tabs = TABS();
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:var(--surface);font-size:.82rem;overflow:hidden">
        ${isMob ? `
        <div style="padding:8px 12px;border-bottom:1px solid var(--border);background:var(--surface2)">
          <select id="si-select" style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.85rem">
            ${tabs.map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}
          </select>
        </div>` : `
        <div style="display:flex;gap:0;border-bottom:1px solid var(--border);background:var(--surface2)">
          ${tabs.map(([id,label],i) => `
            <div class="si-tab${i===0?' si-tab-active':''}" data-tab="${id}"
              style="padding:8px 16px;cursor:pointer;font-size:.8rem;color:${i===0?'var(--text)':'var(--text-dim)'};border-bottom:${i===0?'2px solid var(--accent)':'2px solid transparent'};margin-bottom:-1px;white-space:nowrap">
              ${label}
            </div>`).join('')}
        </div>`}
        <div id="si-content" style="flex:1;overflow:auto;padding:16px"></div>
      </div>
    `;

    if (isMob) {
      body.querySelector('#si-select').addEventListener('change', e => _render(body, e.target.value));
    } else {
      body.querySelectorAll('.si-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          body.querySelectorAll('.si-tab').forEach(t => {
            t.style.color = 'var(--text-dim)'; t.style.borderBottom = '2px solid transparent'; t.classList.remove('si-tab-active');
          });
          tab.style.color = 'var(--text)'; tab.style.borderBottom = '2px solid var(--accent)'; tab.classList.add('si-tab-active');
          _render(body, tab.dataset.tab);
        });
      });
    }

    _fetch(body);
    _timer = setInterval(() => _fetch(body), 3000);
    const observer = new MutationObserver(() => {
      if (!document.contains(body)) { clearInterval(_timer); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.mvmOS?.onLangChange(() => init(body));
  }

  async function _fetch(body) {
    try {
      const res = await fetch('/api/system/hardware');
      const data = await res.json();
      body._siData = data;
      const activeTab = body.querySelector('#si-select')?.value || body.querySelector('.si-tab-active')?.dataset.tab || 'overview';
      _render(body, activeTab, data);
    } catch(e) {
      body.querySelector('#si-content').innerHTML = `<div style="color:var(--text-dim);padding:24px">${_sit('failed')}</div>`;
    }
  }

  function _render(body, tab) {
    const data = body._siData; if (!data) return;
    const content = body.querySelector('#si-content');
    switch(tab) {
      case 'overview': content.innerHTML = _overview(data); break;
      case 'cpu':      content.innerHTML = _cpu(data); break;
      case 'memory':   content.innerHTML = _memory(data); break;
      case 'disks':    content.innerHTML = _disks(data); break;
      case 'network':  content.innerHTML = _network(data); break;
      case 'temps':    content.innerHTML = _temps(data); break;
    }
  }

  function _bar(pct, color) {
    const c = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : color;
    return `<div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden;margin-top:4px">
      <div style="height:100%;width:${pct}%;background:${c};border-radius:3px;transition:width .4s"></div></div>`;
  }

  function _row(label, value) {
    return `<tr><td style="padding:6px 12px 6px 0;color:var(--text-dim);white-space:nowrap;width:160px">${label}</td>
      <td style="padding:6px 0;color:var(--text)">${value}</td></tr>`;
  }

  function _card(title, content) {
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:12px">
      <div style="font-weight:600;color:var(--text);margin-bottom:10px;font-size:.83rem">${title}</div>${content}</div>`;
  }

  function _bytes(b) {
    if (b >= 1073741824) return (b/1073741824).toFixed(2) + ' GB';
    if (b >= 1048576)    return (b/1048576).toFixed(0) + ' MB';
    return (b/1024).toFixed(0) + ' KB';
  }

  function _overview(d) {
    const memPct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
    const diskMain = d.disks?.[0]; const diskPct = diskMain ? diskMain.pct : 0;
    return `
      <div style="display:grid;grid-template-columns:${mobile() ? '1fr' : '1fr 1fr'};gap:12px">
        ${_card(_sit('sys'), `<table style="width:100%;border-collapse:collapse">
          ${_row(_sit('hostname'), d.hostname)} ${_row(_sit('os'), d.os || '—')}
          ${_row(_sit('kernel'), d.kernel)} ${_row(_sit('uptime'), d.uptime)}</table>`)}
        ${_card(_sit('cpu'), `<table style="width:100%;border-collapse:collapse">
          ${_row(_sit('model'), `<span style="font-size:.75rem">${d.cpu_model}</span>`)}
          ${_row(_sit('cores'), d.cpu_cores)}
          ${_row(_sit('frequency'), d.cpu_freq_mhz ? d.cpu_freq_mhz + ' MHz' : '—')}
          ${_row(_sit('load_avg'), `${d.load?.['1']} / ${d.load?.['5']} / ${d.load?.['15']}`)}</table>`)}
        ${_card(_sit('memory'), `
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:var(--text-dim)">${_sit('used')}</span>
            <span style="color:var(--text)">${_bytes(d.mem_used)} / ${_bytes(d.mem_total)} (${memPct}%)</span>
          </div>${_bar(memPct, '#a6e3a1')}
          ${d.swap_total ? `<div style="display:flex;justify-content:space-between;margin-top:8px;margin-bottom:2px">
            <span style="color:var(--text-dim)">${_sit('swap')}</span>
            <span style="color:var(--text)">${_bytes(d.swap_used)} / ${_bytes(d.swap_total)}</span>
          </div>${_bar(Math.round(d.swap_used/d.swap_total*100), '#cba6f7')}` : ''}`)}
        ${_card(_sit('disk'), diskMain ? `
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:var(--text-dim)">${diskMain.mount}</span>
            <span style="color:var(--text)">${_bytes(diskMain.used)} / ${_bytes(diskMain.total)} (${diskPct}%)</span>
          </div>${_bar(diskPct, '#f9e2af')}
          <div style="color:var(--text-dim);margin-top:6px;font-size:.75rem">${_sit('free')}: ${_bytes(diskMain.free)}</div>
        ` : `<div style="color:var(--text-dim)">${_sit('no_disk')}</div>`)}
      </div>
      ${d.temps?.length ? _card(_sit('temps'), `<div style="display:flex;gap:16px;flex-wrap:wrap">
        ${d.temps.map(t => `<div style="text-align:center">
          <div style="font-size:1.2rem;font-weight:700;color:${t.temp>80?'#f38ba8':t.temp>60?'#f9e2af':'#a6e3a1'}">${t.temp}°C</div>
          <div style="color:var(--text-dim);font-size:.75rem">${t.label}</div></div>`).join('')}</div>`) : ''}`;
  }

  function _cpu(d) {
    return _card(_sit('cpu_details'), `<table style="width:100%;border-collapse:collapse">
      ${_row(_sit('model'), d.cpu_model)} ${_row(_sit('phys_cores'), d.cpu_cores)}
      ${_row(_sit('avg_freq'), d.cpu_freq_mhz ? d.cpu_freq_mhz + ' MHz' : '—')}
      ${_row(_sit('load1'), d.load?.['1'])} ${_row(_sit('load5'), d.load?.['5'])}
      ${_row(_sit('load15'), d.load?.['15'])} ${_row(_sit('uptime'), d.uptime)}</table>`);
  }

  function _memory(d) {
    const memPct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
    const swapPct = d.swap_total ? Math.round(d.swap_used / d.swap_total * 100) : 0;
    return `
      ${_card(_sit('ram'), `
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="color:var(--text-dim)">${_sit('used')}</span>
          <span>${_bytes(d.mem_used)} / ${_bytes(d.mem_total)} (${memPct}%)</span>
        </div>${_bar(memPct, '#a6e3a1')}
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          ${_row(_sit('total'), _bytes(d.mem_total))} ${_row(_sit('used'), _bytes(d.mem_used))}
          ${_row(_sit('available'), _bytes(d.mem_available))} ${_row(_sit('free_exact'), _bytes(d.mem_total - d.mem_used))}
        </table>`)}
      ${d.swap_total ? _card(_sit('swap'), `
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="color:var(--text-dim)">${_sit('used')}</span>
          <span>${_bytes(d.swap_used)} / ${_bytes(d.swap_total)} (${swapPct}%)</span>
        </div>${_bar(swapPct, '#cba6f7')}`) : ''}`;
  }

  function _disks(d) {
    if (!d.disks?.length) return `<div style="color:var(--text-dim)">${_sit('no_disks')}</div>`;
    return d.disks.map(disk => _card(
      `💾 ${disk.mount} <span style="font-weight:400;color:var(--text-dim);font-size:.75rem">(${disk.device} · ${disk.fstype})</span>`,
      `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:var(--text-dim)">${_sit('used')}</span>
        <span>${_bytes(disk.used)} / ${_bytes(disk.total)} (${disk.pct}%)</span>
      </div>${_bar(disk.pct, '#f9e2af')}
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        ${_row(_sit('total'), _bytes(disk.total))} ${_row(_sit('used'), _bytes(disk.used))} ${_row(_sit('free'), _bytes(disk.free))}
      </table>`)).join('');
  }

  function _network(d) {
    if (!d.network?.length) return `<div style="color:var(--text-dim)">${_sit('no_network')}</div>`;
    return d.network.map(n => _card(`🌐 ${n.iface}`, `<table style="width:100%;border-collapse:collapse">
      ${_row(_sit('rx'), _bytes(n.rx_bytes) + ` (${n.rx_packets.toLocaleString()} ${_sit('packets')})`)}
      ${_row(_sit('tx'), _bytes(n.tx_bytes) + ` (${n.tx_packets.toLocaleString()} ${_sit('packets')})`)}
    </table>`)).join('');
  }

  function _temps(d) {
    if (!d.temps?.length) return `<div style="color:var(--text-dim);padding:8px 0">
      ${_sit('no_temps')}<br><span style="font-size:.75rem">${_sit('no_temps_note')}</span></div>`;
    return _card(_sit('temp_sensors'), `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px">
        ${d.temps.map(t => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:${t.temp>80?'#f38ba8':t.temp>60?'#f9e2af':'#a6e3a1'}">${t.temp}°C</div>
          <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px">${t.label}</div>
        </div>`).join('')}</div>`);
  }

  return { init };
})();
