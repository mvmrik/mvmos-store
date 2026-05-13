// mvmOS Widget: RAM Meter v1.0.0
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

    let _timer = null;

    async function update() {
      try {
        const res = await fetch('/api/system/resources');
        const d = await res.json();
        const pct = d.mem_total ? Math.round(d.mem_used / d.mem_total * 100) : 0;
        const bar = document.getElementById('ram-meter-bar');
        const label = document.getElementById('ram-meter-pct');
        if (!bar) { clearInterval(_timer); return; }
        bar.style.width = pct + '%';
        bar.style.background = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : '#a6e3a1';
        label.textContent = pct + '%';
      } catch (_) {}
    }

    update();
    _timer = setInterval(update, 3000);

    const observer = new MutationObserver(() => {
      if (!document.contains(container)) { clearInterval(_timer); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
});
