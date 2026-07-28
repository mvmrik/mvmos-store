// mvmOS App: Calendar v1.0.0
const _cali18n = {
  en: { title: 'Calendar', login: 'Log in to Apps Hub to use Calendar' },
  bg: { title: 'Календар', login: 'Влез в Apps Hub, за да ползваш календара' },
};
function _calt(key) { const lang = window.mvmOS?.lang || 'en'; return (_cali18n[lang] || _cali18n.en)[key] || key; }

function _loadCalendarWidget() {
  if (window.CalendarWidget) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/apps/calendar/calendar-widget.js?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

mvmOS.registerApp({
  id: 'calendar',
  name: _calt('title'),
  icon: '📅',
  category: 'Productivity',
  launch() {
    mvmOS.createWindow({
      id: 'calendar',
      title: '📅 ' + _calt('title'),
      width: 820,
      height: 600,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="calendar-root" style="height:100%"></div>`;
        const root = body.querySelector('#calendar-root');
        let handle = null;

        function start() {
          _loadCalendarWidget().then(() => {
            handle = window.CalendarWidget.mount(root, {
              onNeedLogin() {
                AppHub.requireLogin(() => start());
              },
            });
          });
        }

        if (typeof AppHub !== 'undefined') {
          AppHub.requireLogin(() => start());
        } else {
          start();
        }

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
