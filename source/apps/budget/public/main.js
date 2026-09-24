// mvmOS App: Budget v1.0.0
// The window title is needed synchronously, at registerApp() time, so it stays
// here rather than in public/i18n.js, which the widget loads on demand.
const _bgti18n = {
  en: { title: 'Budget' },
  bg: { title: 'Бюджет' },
  de: { title: 'Budget' },
  es: { title: 'Presupuesto' },
  fr: { title: 'Budget' },
  ja: { title: '家計簿' },
  'pt-BR': { title: 'Orçamento' },
  ru: { title: 'Бюджет' },
  'zh-CN': { title: '预算' },
};
function _bgt(key) { const lang = window.mvmOS?.lang || 'en'; return (_bgti18n[lang] || _bgti18n.en)[key] || key; }

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function _loadBudgetWidget() {
  if (window.BudgetWidget) return Promise.resolve();
  // i18n.js first: the widget reads window.BUDGET_I18N as it defines itself.
  return _loadScript('/apps/budget/i18n.js?v=1.5.1')
    .then(() => _loadScript('/apps/budget/budget-widget.js'));
}

mvmOS.registerApp({
  id: 'budget',
  name: _bgt('title'),
  icon: '💰',
  category: 'Finance',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'budget',
      title: '💰 ' + _bgt('title'),
      width: 900,
      height: 640,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="budget-root" style="height:100%"></div>`;
        const root = body.querySelector('#budget-root');
        let handle = null;

        _loadBudgetWidget().then(() => {
          handle = window.BudgetWidget.mount(root, {});
        });

        const observer = new MutationObserver(() => {
          if (!document.body.contains(root)) {
            if (handle) handle.destroy();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
    });
  },
});
