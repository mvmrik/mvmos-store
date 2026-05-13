// mvmOS Widget: RAM Meter v1.1.0
mvmOS.registerWidget({
  id: 'ram-meter',
  type: 'taskbar',
  label: 'RAM',
  init(container) {
    container.style.cssText = 'display:flex;align-items:center;gap:4px;padding:0 8px;cursor:default';
    container.innerHTML = `
      <span style="font-size:.7rem;color:var(--text-dim)">RAM</span>
      <div style="width:36px;height:4px;background:var(--surface);border-radius:2px;overflow:hidden">
        <div id="ram-meter-bar" style="height:100%;width:0%;background:#a6e3a1;border-radius:2px;transition:width .5s"></div>
      </div>
      <span id="ram-meter-pct" style="font-size:.72rem;color:var(--text);min-width:28px;text-align:right">—</span>
    `;

    mvmOS.onResources(d => {
      const pct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
      const bar = container.querySelector('#ram-meter-bar');
      const label = container.querySelector('#ram-meter-pct');
      if (!bar) return;
      bar.style.width = pct + '%';
      bar.style.background = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : '#a6e3a1';
      label.textContent = pct + '%';
    });
  }
});
