// mvmOS App: mvmOS Chat v1.0.0
const _chati18n = {
  en: { title: 'mvmOS Chat', login: 'Log in to Apps Hub to use Chat' },
  bg: { title: 'mvmOS Chat', login: 'Влез в Apps Hub, за да ползваш чата' },
};
function _chatt(key) { const lang = window.mvmOS?.lang || 'en'; return (_chati18n[lang] || _chati18n.en)[key] || key; }

function _loadChatWidget() {
  if (window.ChatWidget) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/apps/chat/chat-widget.js?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

mvmOS.registerApp({
  id: 'chat',
  name: _chatt('title'),
  icon: '💬',
  category: 'Social',
  launch() {
    mvmOS.createWindow({
      id: 'chat',
      title: '💬 ' + _chatt('title'),
      width: 760,
      height: 560,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="chat-root" style="height:100%"></div>`;
        const root = body.querySelector('#chat-root');
        let handle = null;

        function start() {
          _loadChatWidget().then(() => {
            handle = window.ChatWidget.mount(root, {
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
