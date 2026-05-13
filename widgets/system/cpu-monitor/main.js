// mvmOS Widget: CPU Monitor v1.0.0
mvmOS.registerWidget({
  id: 'cpu-monitor',
  type: 'desktop',
  defaultX: 20,
  defaultY: 60,
  init(container) {
    const W = 220, H = 140;
    container.innerHTML = `
      <div style="width:${W}px;background:rgba(17,17,27,.88);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:.72rem;font-weight:700;color:#cdd6f4;letter-spacing:.06em">CPU USAGE</span>
          <span id="cpu-mon-pct" style="font-size:1.1rem;font-weight:700;color:#89b4fa">—</span>
        </div>
        <canvas id="cpu-mon-canvas" width="${W - 24}" height="70" style="display:block;border-radius:4px"></canvas>
        <div style="display:flex;justify-content:space-between;margin-top:8px">
          <span style="font-size:.68rem;color:#585b70">Load avg</span>
          <span id="cpu-mon-load" style="font-size:.68rem;color:#a6adc8">—</span>
        </div>
      </div>
    `;

    const canvas = container.querySelector('#cpu-mon-canvas');
    const ctx = canvas.getContext('2d');
    const history = new Array(canvas.width).fill(0);
    let timer = null;

    function draw(pct) {
      history.push(pct);
      if (history.length > canvas.width) history.shift();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // grid lines
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.lineWidth = 1;
      [25, 50, 75].forEach(y => {
        const py = canvas.height - (y / 100 * canvas.height);
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
      });

      // gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, pct > 85 ? 'rgba(243,139,168,.6)' : pct > 60 ? 'rgba(249,226,175,.5)' : 'rgba(137,180,250,.5)');
      grad.addColorStop(1, 'rgba(137,180,250,.02)');
      ctx.beginPath();
      history.forEach((v, i) => {
        const x = i;
        const y = canvas.height - (v / 100 * canvas.height);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(canvas.width, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // line
      ctx.beginPath();
      ctx.strokeStyle = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : '#89b4fa';
      ctx.lineWidth = 1.5;
      history.forEach((v, i) => {
        const x = i;
        const y = canvas.height - (v / 100 * canvas.height);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    async function update() {
      try {
        const [rRes, hRes] = await Promise.all([fetch('/api/system/resources'), fetch('/api/system/hardware')]);
        const r = await rRes.json();
        const h = await hRes.json();
        const pct = r.cpu_pct ?? 0;
        container.querySelector('#cpu-mon-pct').textContent = pct + '%';
        container.querySelector('#cpu-mon-pct').style.color = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' : '#89b4fa';
        container.querySelector('#cpu-mon-load').textContent = h.load ? `${h.load['1']} · ${h.load['5']} · ${h.load['15']}` : '—';
        draw(pct);
      } catch(_) {}
    }

    update();
    timer = setInterval(update, 2000);
    const obs = new MutationObserver(() => { if (!document.contains(container)) { clearInterval(timer); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }
});
