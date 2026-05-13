// mvmOS Widget: System Overview v1.0.0
mvmOS.registerWidget({
  id: 'sys-overview',
  type: 'desktop',
  defaultX: 20,
  defaultY: 220,
  init(container) {
    container.innerHTML = `
      <div style="width:220px;background:rgba(17,17,27,.88);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:.72rem;font-weight:700;color:#cdd6f4;letter-spacing:.06em;margin-bottom:12px">SYSTEM</div>

        ${[['cpu','CPU','#89b4fa'],['mem','MEM','#a6e3a1'],['disk','DISK','#f9e2af']].map(([k,label,color]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:.72rem;color:#585b70">${label}</span>
            <span id="so-${k}-val" style="font-size:.72rem;color:${color}">—</span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
            <div id="so-${k}-bar" style="height:100%;width:0%;background:${color};border-radius:3px;transition:width .6s"></div>
          </div>
        </div>`).join('')}

        <div style="border-top:1px solid rgba(255,255,255,.06);margin-top:4px;padding-top:8px;display:flex;justify-content:space-between">
          <span style="font-size:.68rem;color:#585b70">Uptime</span>
          <span id="so-uptime" style="font-size:.68rem;color:#a6adc8">—</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:.68rem;color:#585b70">Host</span>
          <span id="so-host" style="font-size:.68rem;color:#a6adc8">—</span>
        </div>
      </div>
    `;

    let timer = null;

    function setBar(key, pct, color) {
      const bar = container.querySelector(`#so-${key}-bar`);
      if (!bar) return;
      const c = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : color;
      bar.style.width = pct + '%';
      bar.style.background = c;
      container.querySelector(`#so-${key}-val`).style.color = c;
    }

    function fmt(b) {
      if (b >= 1073741824) return (b/1073741824).toFixed(1) + 'G';
      if (b >= 1048576)    return (b/1048576).toFixed(0) + 'M';
      return (b/1024).toFixed(0) + 'K';
    }

    async function update() {
      try {
        const [rRes, hRes] = await Promise.all([fetch('/api/system/resources'), fetch('/api/system/hardware')]);
        const r = await rRes.json();
        const h = await hRes.json();

        const cpuPct = r.cpu_pct ?? 0;
        setBar('cpu', cpuPct, '#89b4fa');
        container.querySelector('#so-cpu-val').textContent = cpuPct + '%';

        const memPct = r.mem_total ? Math.round(r.mem_used / r.mem_total * 100) : 0;
        setBar('mem', memPct, '#a6e3a1');
        container.querySelector('#so-mem-val').textContent = `${fmt(r.mem_used)}/${fmt(r.mem_total)}`;

        const disk = h.disks?.[0];
        if (disk) {
          setBar('disk', disk.pct, '#f9e2af');
          container.querySelector('#so-disk-val').textContent = `${fmt(disk.used)}/${fmt(disk.total)}`;
        }

        container.querySelector('#so-uptime').textContent = h.uptime || '—';
        container.querySelector('#so-host').textContent = h.hostname || '—';
      } catch(_) {}
    }

    update();
    timer = setInterval(update, 3000);
    const obs = new MutationObserver(() => { if (!document.contains(container)) { clearInterval(timer); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }
});
