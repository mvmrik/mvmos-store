// mvmOS Widget: CPU Meter v1.1.0
mvmOS.registerWidget({
  id: 'cpu-meter',
  type: 'taskbar',
  label: 'CPU',
  init(container) {
    container.style.cssText = 'display:flex;align-items:center;gap:4px;padding:0 8px;cursor:default';
    container.innerHTML = `
      <span style="font-size:.7rem;color:var(--text-dim)">CPU</span>
      <div style="width:36px;height:4px;background:var(--surface);border-radius:2px;overflow:hidden">
        <div id="cpu-meter-bar" style="height:100%;width:0%;background:#89b4fa;border-radius:2px;transition:width .5s"></div>
      </div>
      <span id="cpu-meter-pct" style="font-size:.72rem;color:var(--text);min-width:28px;text-align:right">—</span>
    `;

    mvmOS.onResources(d => {
      const pct = d.cpu_pct ?? 0;
      const bar = container.querySelector('#cpu-meter-bar');
      const label = container.querySelector('#cpu-meter-pct');
      if (!bar) return;
      bar.style.width = pct + '%';
      bar.style.background = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : '#89b4fa';
      label.textContent = pct + '%';
    });
  }
});
