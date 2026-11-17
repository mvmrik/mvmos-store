// mvmOS App: Calendar v1.0.0
const _calNames = {"en": "Calendar", "bg": "Календар", "de": "Kalender", "es": "Calendario", "fr": "Calendrier", "ja": "カレンダー", "pt-BR": "Calendário", "ru": "Календарь", "zh-CN": "日历"};
function _calt() { return _calNames[window.mvmOS?.lang] || _calNames.en; }

function _loadCalendarWidget() {
  function load(path) { return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = window.asset(path);
    s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
  }); }
  return (window.CALENDAR_I18N ? Promise.resolve() : load('/apps/calendar/i18n.js'))
    .then(() => window.CalendarWidget ? null : load('/apps/calendar/calendar-widget.js'));
}

mvmOS.registerApp({
  id: 'calendar',
  requires_apphub: true,
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
