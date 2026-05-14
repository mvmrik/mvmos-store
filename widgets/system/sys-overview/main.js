// mvmOS Widget: System Overview v1.2.0
mvmOS.registerWidget({
  id: 'sys-overview',
  type: 'desktop',
  defaultX: 20,
  defaultY: 220,
  init(container) {
    container.innerHTML = `
      <div style="width:220px;background:var(--surface,rgba(17,17,27,.88));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:10px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:.72rem;font-weight:700;color:var(--text,#cdd6f4);letter-spacing:.06em;margin-bottom:12px">SYSTEM</div>
        ${[['cpu','CPU','#89b4fa'],['mem','MEM','#a6e3a1'],['disk','DISK','#f9e2af']].map(([k,label,color]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:.72rem;color:var(--text-dim,#585b70)">${label}</span>
            <span id="so-${k}-val" style="font-size:.72rem;color:${color}">—</span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
            <div id="so-${k}-bar" style="height:100%;width:0%;background:${color};border-radius:3px;transition:width .6s"></div>
          </div>
        </div>`).join('')}
        <div style="border-top:1px solid var(--border,rgba(255,255,255,.06));margin-top:4px;padding-top:8px;display:flex;justify-content:space-between">
          <span style="font-size:.68rem;color:var(--text-dim,#585b70)">Uptime</span>
          <span id="so-uptime" style="font-size:.68rem;color:var(--text,#a6adc8)">—</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:.68rem;color:var(--text-dim,#585b70)">Host</span>
          <span id="so-host" style="font-size:.68rem;color:var(--text,#a6adc8)">—</span>
        </div>
      </div>
    `;

    function fmt(b) {
      if (b >= 1073741824) return (b/1073741824).toFixed(1) + 'G';
      if (b >= 1048576)    return (b/1048576).toFixed(0) + 'M';
      return (b/1024).toFixed(0) + 'K';
    }

    function setBar(key, pct, color) {
      const bar = container.querySelector(`#so-${key}-bar`);
      if (!bar) return;
      const c = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : color;
      bar.style.width = pct + '%';
      bar.style.background = c;
      container.querySelector(`#so-${key}-val`).style.color = c;
    }

    mvmOS.onResources(d => {
      if (!container.querySelector('#so-cpu-val')) return;

      const cpuPct = d.cpu_pct ?? 0;
      setBar('cpu', cpuPct, '#89b4fa');
      container.querySelector('#so-cpu-val').textContent = cpuPct + '%';

      const memPct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
      setBar('mem', memPct, '#a6e3a1');
      container.querySelector('#so-mem-val').textContent = d.mem_total ? `${fmt(d.mem_used)}/${fmt(d.mem_total)}` : '—';

      const disk = d.disks?.[0];
      if (disk) {
        setBar('disk', disk.pct, '#f9e2af');
        container.querySelector('#so-disk-val').textContent = `${fmt(disk.used)}/${fmt(disk.total)}`;
      }

      if (d.uptime) container.querySelector('#so-uptime').textContent = d.uptime;
      if (d.hostname) container.querySelector('#so-host').textContent = d.hostname;
    });
  }
});
