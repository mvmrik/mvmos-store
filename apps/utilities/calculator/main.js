// mvmOS App: Calculator v1.2.0
const _calc18n = {
  en: { title: 'Calculator' },
  bg: { title: 'Калкулатор' },
};
function _calct(key) { const lang = window.mvmOS?.lang || 'en'; return (_calc18n[lang] || _calc18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'calculator',
  name: _calct('title'),
  icon: '🧮',
  category: 'Utilities',
  launch() {
    mvmOS.createWindow({
      id: 'calculator',
      title: '🧮 ' + _calct('title'),
      width: 260,
      height: 380,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;height:100%;background:#1e1e2e;color:#cdd6f4;font-family:monospace;outline:none" id="calc-root" tabindex="0">
            <div style="flex:0;padding:6px 14px 2px;font-size:.78rem;min-height:22px;text-align:right;color:#6272a4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="calc-expr"></div>
            <div id="calc-display" style="flex:0;padding:4px 14px 10px;font-size:2rem;text-align:right;background:#181825;word-break:break-all;min-height:52px">0</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;flex:1;background:#313244">
              ${[
                ['C','±','%','÷'],
                ['7','8','9','×'],
                ['4','5','6','−'],
                ['1','2','3','+'],
                ['0','.','⌫','='],
              ].map(row => row.map(k => {
                const isOp  = ['÷','×','−','+'].includes(k);
                const isEq  = k === '=';
                const isClr = k === 'C';
                const bg = isEq ? '#89b4fa' : 'transparent';
                const clr = isEq ? '#1e1e2e' : isClr ? '#f38ba8' : isOp ? '#fab387' : '#cdd6f4';
                return `<button class="calc-btn" data-k="${k}" style="background:${bg};color:${clr};border:none;font-size:1.05rem;cursor:pointer;padding:0;transition:background .1s">${k}</button>`;
              }).join('')).join('')}
            </div>
          </div>
        `;

        const root    = body.querySelector('#calc-root');
        const display = body.querySelector('#calc-display');
        const exprEl  = body.querySelector('#calc-expr');

        // state
        let expr  = '';   // full expression string shown top
        let cur   = '0';  // current number being typed
        let justEvaled = false;

        const OPS = { '÷': '/', '×': '*', '−': '-', '+': '+' };
        const OP_DISPLAY = { '/': '÷', '*': '×', '-': '−', '+': '+' };

        function updateDisplay() {
          display.textContent = cur;
          exprEl.textContent  = expr;
        }

        function appendDigit(d) {
          if (justEvaled) { expr = ''; cur = '0'; justEvaled = false; }
          if (d === '.' && cur.includes('.')) return;
          cur = (cur === '0' && d !== '.') ? d : cur + d;
          updateDisplay();
        }

        function appendOp(op) {
          justEvaled = false;
          // replace trailing operator if present
          expr = (expr + cur).replace(/[+\-*/]$/, '') + op;
          cur = '0';
          updateDisplay();
        }

        function evaluate() {
          const full = expr + cur;
          if (!full || full === cur) return;
          try {
            // replace display ops with JS ops
            const jsExpr = full.replace(/÷/g,'/').replace(/×/g,'*').replace(/−/g,'-');
            // eslint-disable-next-line no-new-func
            const result = Function('"use strict"; return (' + jsExpr + ')')();
            const rounded = parseFloat(result.toFixed(10));
            exprEl.textContent = full + ' =';
            cur = String(rounded);
            expr = '';
            justEvaled = true;
            display.textContent = cur;
          } catch (_) {}
        }

        function handleKey(k) {
          if (k >= '0' && k <= '9') { appendDigit(k); return; }
          if (k === '.') { appendDigit('.'); return; }
          if (k === '+') { appendOp('+'); return; }
          if (k === '-') { appendOp('−'); return; }
          if (k === '*') { appendOp('×'); return; }
          if (k === '/') { appendOp('÷'); return; }
          if (k === 'Enter' || k === '=') { evaluate(); return; }
          if (k === 'Backspace') {
            if (justEvaled) { cur = '0'; expr = ''; justEvaled = false; updateDisplay(); return; }
            cur = cur.length > 1 ? cur.slice(0, -1) : '0';
            updateDisplay(); return;
          }
          if (k === 'Escape' || k === 'c' || k === 'C') {
            cur = '0'; expr = ''; justEvaled = false; updateDisplay(); return;
          }
          if (k === '%') {
            cur = String(parseFloat(cur) / 100); updateDisplay(); return;
          }
        }

        body.querySelectorAll('.calc-btn').forEach(btn => {
          btn.addEventListener('mouseenter', () => { if (!['='].includes(btn.dataset.k)) btn.style.background = 'rgba(255,255,255,.08)'; });
          btn.addEventListener('mouseleave', () => { btn.style.background = btn.dataset.k === '=' ? '#89b4fa' : 'transparent'; });
          btn.addEventListener('click', () => {
            root.focus();
            const k = btn.dataset.k;
            if (k >= '0' && k <= '9' || k === '.') { appendDigit(k); return; }
            if (k in OPS) { appendOp(k); return; }
            if (k === '=') { evaluate(); return; }
            if (k === 'C') { cur = '0'; expr = ''; justEvaled = false; updateDisplay(); return; }
            if (k === '⌫') { handleKey('Backspace'); return; }
            if (k === '±') { cur = String(-parseFloat(cur)); updateDisplay(); return; }
            if (k === '%') { cur = String(parseFloat(cur) / 100); updateDisplay(); return; }
          });
        });

        root.addEventListener('keydown', e => {
          const map = { '/': '/', '*': '*', '+': '+', '-': '-', Enter: 'Enter', Backspace: 'Backspace', Escape: 'Escape', '%': '%', '=': '=' };
          const k = map[e.key] ?? (e.key.length === 1 ? e.key : null);
          if (k) { e.preventDefault(); handleKey(k); }
        });

        // focus so keyboard works immediately
        root.focus();
        updateDisplay();
      }
    });
  }
});
