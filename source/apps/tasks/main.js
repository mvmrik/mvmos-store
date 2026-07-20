// mvmOS App: Tasks v1.0.0
const _tkti18n = {
  en: { title: 'Tasks' },
  bg: { title: 'Задачи' },
};
function _tkt(key) { const lang = window.mvmOS?.lang || 'en'; return (_tkti18n[lang] || _tkti18n.en)[key] || key; }

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadTasksAssets() {
  const p = [];
  if (!window.TASKS_I18N) p.push(_loadScript('/apps/tasks/i18n.js'));
  if (!window.TasksWidget) p.push(_loadScript('/apps/tasks/tasks-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'tasks',
  name: _tkt('title'),
  icon: '✅',
  category: 'Productivity',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'tasks',
      title: '✅ ' + _tkt('title'),
      width: 900,
      height: 640,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="tasks-root" style="height:100%"></div>`;
        const root = body.querySelector('#tasks-root');
        let handle = null;

        _loadTasksAssets().then(() => {
          handle = window.TasksWidget.mount(root, {});
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
