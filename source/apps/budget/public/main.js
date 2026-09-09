// mvmOS App: Budget v1.0.0
const _bgti18n = {
  en: { title: 'Budget' },
  bg: { title: 'Бюджет' },
};
function _bgt(key) { const lang = window.mvmOS?.lang || 'en'; return (_bgti18n[lang] || _bgti18n.en)[key] || key; }

function _loadBudgetWidget() {
  if (window.BudgetWidget) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/apps/budget/budget-widget.js?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

mvmOS.registerApp({
  id: 'budget',
  name: _bgt('title'),
  icon: '💰',
  category: 'Productivity',
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
