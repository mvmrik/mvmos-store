// mvmOS App: System Info v1.0.0
mvmOS.registerApp({
  id: 'system-info',
  name: 'System Info',
  icon: '🖥️',
  category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'system-info',
      title: '🖥️ System Info',
      width: 720,
      height: 560,
      onMount(body) { SI.init(body); },
    });
  }
});

const SI = (() => {
  let _timer = null;
  let _netPrev = null;
  let _netPrevTime = null;

  function init(body) {
    body.style.padding = '0';
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:var(--surface);font-size:.82rem;overflow:hidden">
        <!-- tabs -->
        <div style="display:flex;gap:0;border-bottom:1px solid var(--border);background:var(--surface2)">
          ${[['overview','Overview'],['cpu','CPU'],['memory','Memory'],['disks','Disks'],['network','Network'],['temps','Sensors']].map(([id,label],i) => `
            <div class="si-tab${i===0?' si-tab-active':''}" data-tab="${id}"
              style="padding:8px 16px;cursor:pointer;font-size:.8rem;color:${i===0?'var(--text)':'var(--text-dim)'};border-bottom:${i===0?'2px solid var(--accent)':'2px solid transparent'};margin-bottom:-1px;white-space:nowrap">
              ${label}
            </div>`).join('')}
        </div>
        <!-- content -->
        <div id="si-content" style="flex:1;overflow:auto;padding:16px"></div>
      </div>
    `;

    body.querySelectorAll('.si-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        body.querySelectorAll('.si-tab').forEach(t => {
          t.style.color = 'var(--text-dim)';
          t.style.borderBottom = '2px solid transparent';
          t.classList.remove('si-tab-active');
        });
        tab.style.color = 'var(--text)';
        tab.style.borderBottom = '2px solid var(--accent)';
        tab.classList.add('si-tab-active');
        _render(body, tab.dataset.tab);
      });
    });

    _fetch(body);
    _timer = setInterval(() => _fetch(body), 3000);

    const observer = new MutationObserver(() => {
      if (!document.contains(body)) { clearInterval(_timer); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function _fetch(body) {
    try {
      const res = await fetch('/api/system/hardware');
      const data = await res.json();
      body._siData = data;
      const activeTab = body.querySelector('.si-tab-active')?.dataset.tab || 'overview';
      _render(body, activeTab, data);
    } catch(e) {
      body.querySelector('#si-content').innerHTML = `<div style="color:var(--text-dim);padding:24px">Failed to load system info.</div>`;
    }
  }

  function _render(body, tab) {
    const data = body._siData;
    if (!data) return;
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
      <div style="height:100%;width:${pct}%;background:${c};border-radius:3px;transition:width .4s"></div>
    </div>`;
  }

  function _row(label, value) {
    return `<tr>
      <td style="padding:6px 12px 6px 0;color:var(--text-dim);white-space:nowrap;width:160px">${label}</td>
      <td style="padding:6px 0;color:var(--text)">${value}</td>
    </tr>`;
  }

  function _card(title, content) {
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:12px">
      <div style="font-weight:600;color:var(--text);margin-bottom:10px;font-size:.83rem">${title}</div>
      ${content}
    </div>`;
  }

  function _bytes(b) {
    if (b >= 1073741824) return (b/1073741824).toFixed(2) + ' GB';
    if (b >= 1048576)    return (b/1048576).toFixed(0) + ' MB';
    return (b/1024).toFixed(0) + ' KB';
  }

  function _overview(d) {
    const memPct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
    const diskMain = d.disks?.[0];
    const diskPct = diskMain ? diskMain.pct : 0;
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${_card('🖥️ System', `<table style="width:100%;border-collapse:collapse">
          ${_row('Hostname', d.hostname)}
          ${_row('OS', d.os || '—')}
          ${_row('Kernel', d.kernel)}
          ${_row('Uptime', d.uptime)}
        </table>`)}
        ${_card('⚡ CPU', `<table style="width:100%;border-collapse:collapse">
          ${_row('Model', `<span style="font-size:.75rem">${d.cpu_model}</span>`)}
          ${_row('Cores', d.cpu_cores)}
          ${_row('Frequency', d.cpu_freq_mhz ? d.cpu_freq_mhz + ' MHz' : '—')}
          ${_row('Load avg', `${d.load?.['1']} / ${d.load?.['5']} / ${d.load?.['15']}`)}
        </table>`)}
        ${_card('🧠 Memory', `
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:var(--text-dim)">Used</span>
            <span style="color:var(--text)">${_bytes(d.mem_used)} / ${_bytes(d.mem_total)} (${memPct}%)</span>
          </div>
          ${_bar(memPct, '#a6e3a1')}
          ${d.swap_total ? `<div style="display:flex;justify-content:space-between;margin-top:8px;margin-bottom:2px">
            <span style="color:var(--text-dim)">Swap</span>
            <span style="color:var(--text)">${_bytes(d.swap_used)} / ${_bytes(d.swap_total)}</span>
          </div>${_bar(Math.round(d.swap_used/d.swap_total*100), '#cba6f7')}` : ''}
        `)}
        ${_card('💾 Disk', diskMain ? `
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:var(--text-dim)">${diskMain.mount}</span>
            <span style="color:var(--text)">${_bytes(diskMain.used)} / ${_bytes(diskMain.total)} (${diskPct}%)</span>
          </div>
          ${_bar(diskPct, '#f9e2af')}
          <div style="color:var(--text-dim);margin-top:6px;font-size:.75rem">Free: ${_bytes(diskMain.free)}</div>
        ` : '<div style="color:var(--text-dim)">No disk info</div>')}
      </div>
      ${d.temps?.length ? _card('🌡️ Temperatures', `<div style="display:flex;gap:16px;flex-wrap:wrap">
        ${d.temps.map(t => `<div style="text-align:center">
          <div style="font-size:1.2rem;font-weight:700;color:${t.temp>80?'#f38ba8':t.temp>60?'#f9e2af':'#a6e3a1'}">${t.temp}°C</div>
          <div style="color:var(--text-dim);font-size:.75rem">${t.label}</div>
        </div>`).join('')}
      </div>`) : ''}
    `;
  }

  function _cpu(d) {
    return _card('⚡ CPU Details', `<table style="width:100%;border-collapse:collapse">
      ${_row('Model', d.cpu_model)}
      ${_row('Physical cores', d.cpu_cores)}
      ${_row('Avg frequency', d.cpu_freq_mhz ? d.cpu_freq_mhz + ' MHz' : '—')}
      ${_row('Load (1 min)', d.load?.['1'])}
      ${_row('Load (5 min)', d.load?.['5'])}
      ${_row('Load (15 min)', d.load?.['15'])}
      ${_row('Uptime', d.uptime)}
    </table>`);
  }

  function _memory(d) {
    const memPct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
    const swapPct = d.swap_total ? Math.round(d.swap_used / d.swap_total * 100) : 0;
    return `
      ${_card('🧠 RAM', `
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="color:var(--text-dim)">Used</span>
          <span>${_bytes(d.mem_used)} / ${_bytes(d.mem_total)} (${memPct}%)</span>
        </div>
        ${_bar(memPct, '#a6e3a1')}
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          ${_row('Total', _bytes(d.mem_total))}
          ${_row('Used', _bytes(d.mem_used))}
          ${_row('Available', _bytes(d.mem_available))}
          ${_row('Free (exact)', _bytes(d.mem_total - d.mem_used))}
        </table>
      `)}
      ${d.swap_total ? _card('💱 Swap', `
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="color:var(--text-dim)">Used</span>
          <span>${_bytes(d.swap_used)} / ${_bytes(d.swap_total)} (${swapPct}%)</span>
        </div>
        ${_bar(swapPct, '#cba6f7')}
      `) : ''}
    `;
  }

  function _disks(d) {
    if (!d.disks?.length) return '<div style="color:var(--text-dim)">No disks found.</div>';
    return d.disks.map(disk => _card(
      `💾 ${disk.mount} <span style="font-weight:400;color:var(--text-dim);font-size:.75rem">(${disk.device} · ${disk.fstype})</span>`,
      `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:var(--text-dim)">Used</span>
        <span>${_bytes(disk.used)} / ${_bytes(disk.total)} (${disk.pct}%)</span>
      </div>
      ${_bar(disk.pct, '#f9e2af')}
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        ${_row('Total', _bytes(disk.total))}
        ${_row('Used', _bytes(disk.used))}
        ${_row('Free', _bytes(disk.free))}
      </table>`
    )).join('');
  }

  function _network(d) {
    if (!d.network?.length) return '<div style="color:var(--text-dim)">No network interfaces found.</div>';
    return d.network.map(n => _card(
      `🌐 ${n.iface}`,
      `<table style="width:100%;border-collapse:collapse">
        ${_row('↓ Received', _bytes(n.rx_bytes) + ` (${n.rx_packets.toLocaleString()} packets)`)}
        ${_row('↑ Sent', _bytes(n.tx_bytes) + ` (${n.tx_packets.toLocaleString()} packets)`)}
      </table>`
    )).join('');
  }

  function _temps(d) {
    if (!d.temps?.length) return `<div style="color:var(--text-dim);padding:8px 0">
      No temperature sensors detected.<br>
      <span style="font-size:.75rem">This is normal on virtual servers (VPS/cloud).</span>
    </div>`;
    return _card('🌡️ Temperature Sensors', `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px">
        ${d.temps.map(t => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:${t.temp>80?'#f38ba8':t.temp>60?'#f9e2af':'#a6e3a1'}">${t.temp}°C</div>
            <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px">${t.label}</div>
          </div>`).join('')}
      </div>
    `);
  }

  return { init };
})();
