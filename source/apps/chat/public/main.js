// mvmOS App: mvmOS Chat v1.0.0
// The window title and login prompt are needed synchronously, at registerApp()
// time, so they stay here rather than in public/i18n.js, which the widget
// loads on demand.
const _chati18n = {
  en: { title: 'mvmOS Chat', login: 'Log in to Apps Hub to use Chat' },
  bg: { title: 'mvmOS Chat', login: 'Влез в Apps Hub, за да ползваш чата' },
  de: { title: 'mvmOS Chat', login: 'Melde dich bei Apps Hub an, um den Chat zu nutzen' },
  es: { title: 'mvmOS Chat', login: 'Inicia sesión en Apps Hub para usar el chat' },
  fr: { title: 'mvmOS Chat', login: 'Connecte-toi à Apps Hub pour utiliser le chat' },
  ja: { title: 'mvmOS チャット', login: 'チャットを使うには Apps Hub にログインしてください' },
  'pt-BR': { title: 'mvmOS Chat', login: 'Entre no Apps Hub para usar o chat' },
  ru: { title: 'mvmOS Chat', login: 'Войди в Apps Hub, чтобы пользоваться чатом' },
  'zh-CN': { title: 'mvmOS 聊天', login: '登录 Apps Hub 以使用聊天' },
};
function _chatt(key) { const lang = window.mvmOS?.lang || 'en'; return (_chati18n[lang] || _chati18n.en)[key] || key; }

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function _chatSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'chat' }); }

// Strings of the settings page come from the same table as the widget.
function _adminT(key) {
  const table = window.CHAT_I18N || {};
  const lang = window.mvmOS?.lang || 'en';
  return (table[lang] || table.en || {})[key] || (table.en || {})[key] || key;
}

function _loadChatWidget() {
  if (window.ChatWidget) return Promise.resolve();
  // i18n.js first: the widget reads window.CHAT_I18N as it defines itself.
  return _loadScript('/apps/chat/i18n.js')
    .then(() => _loadScript('/apps/chat/chat-widget.js'));
}

mvmOS.registerApp({
  id: 'chat',
  name: _chatt('title'),
  icon: '💬',
  category: 'Communication',
  appSettings: true,
  settings: [],
  onAppSettings: _chatSettings,
  // The administrator's switch for encrypted chats. It is Premium: without a
  // licence the box is shown but a click opens the Premium dialog instead, and
  // the server refuses to store it anyway.
  async renderSettingsExtra(wrap) {
    if (!window.CHAT_I18N) await _loadScript('/apps/chat/i18n.js');
    const data = await fetch('/api/apps/chat/admin/settings').then(r => r.json()).catch(() => ({ premium: false }));
    wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;gap:10px';
    wrap.innerHTML = `
      <div style="font-size:.82rem;font-weight:700">${_adminT('admTitle')}</div>
      <div style="font-size:.75rem;color:var(--text-dim);line-height:1.5">${_adminT('admHint')}</div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" data-chat-encryption ${data.encryption ? 'checked' : ''} ${data.premium ? '' : 'disabled'}> ${_adminT('admEncryption')}
      </label>
      <div style="font-size:.75rem;color:var(--text-dim);line-height:1.5">${_adminT('admOffNote')}</div>`;
    if (!data.premium && window.mvmOS?.premiumGate) window.mvmOS.premiumGate(wrap, _adminT('admPremium'));
  },
  async saveSettingsExtra(panel) {
    const box = panel.querySelector('[data-chat-encryption]');
    if (!box || box.disabled) return;
    const response = await fetch('/api/apps/chat/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryption: box.checked }),
    });
    if (!response.ok) throw new Error('premium_required');
  },
  launch() {
    mvmOS.createWindow({
      id: 'chat',
      title: '💬 ' + _chatt('title'),
      width: 760,
      height: 560,
      appSettings: true,
      onAppSettings: _chatSettings,
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
