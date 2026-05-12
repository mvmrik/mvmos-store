// mvmOS App: Calculator
mvmOS.registerApp({
  id: 'calculator',
  name: 'Calculator',
  icon: '🧮',
  launch() {
    mvmOS.createWindow({
      id: 'calculator',
      title: '🧮 Calculator',
      width: 260,
      height: 360,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;height:100%;background:#1e1e2e;color:#cdd6f4;font-family:monospace">
            <div id="calc-display" style="flex:0;padding:12px 16px;font-size:1.6rem;text-align:right;background:#181825;min-height:56px;word-break:break-all">0</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;flex:1;background:#313244">
              ${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.',  '⌫','=']
                .map(k => `<button class="calc-btn" data-k="${k}" style="background:#1e1e2e;color:#cdd6f4;border:none;font-size:1.1rem;cursor:pointer;padding:0;${k==='='?'background:#89b4fa;color:#1e1e2e':''}${k==='C'?'color:#f38ba8':''}${['÷','×','−','+'].includes(k)?'color:#fab387':''}">${k}</button>`).join('')}
            </div>
          </div>
        `;

        let display = body.querySelector('#calc-display');
        let state = { val: '0', prev: null, op: null, newNum: false };

        function update(v) { display.textContent = v || '0'; }

        body.querySelectorAll('.calc-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const k = btn.dataset.k;
            if (k >= '0' && k <= '9' || k === '.') {
              if (state.newNum || state.val === '0') { state.val = k; state.newNum = false; }
              else if (k === '.' && state.val.includes('.')) return;
              else state.val += k;
            } else if (k === 'C') {
              state = { val: '0', prev: null, op: null, newNum: false };
            } else if (k === '⌫') {
              state.val = state.val.length > 1 ? state.val.slice(0, -1) : '0';
            } else if (k === '±') {
              state.val = String(-parseFloat(state.val));
            } else if (k === '%') {
              state.val = String(parseFloat(state.val) / 100);
            } else if (['÷','×','−','+'].includes(k)) {
              state.prev = parseFloat(state.val);
              state.op = k; state.newNum = true;
            } else if (k === '=') {
              if (state.op && state.prev !== null) {
                const a = state.prev, b = parseFloat(state.val);
                const res = state.op === '÷' ? a/b : state.op === '×' ? a*b : state.op === '−' ? a-b : a+b;
                state.val = String(parseFloat(res.toFixed(10)));
                state.op = null; state.prev = null; state.newNum = true;
              }
            }
            update(state.val);
          });
        });
      }
    });
  }
});
