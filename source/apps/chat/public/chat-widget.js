// mvmOS Chat — shared UI + websocket client, used by both the in-app window
// (apps/chat/main.js) and the standalone public page (apps/chat/public/index.html).
// Identity always comes from the shared 'apphub_token' in localStorage.
//
// Every conversation, direct or group, is addressed by its own id. A direct
// conversation is opened from a person (POST /dm returns its id); a group is
// created from several people. Everything after that is the same code path.
const ChatWidget = (() => {
  // The account's own saved date/time display choice (Apps Hub profile).
  // Loaded once a token is known (see mount() below); until then, or for a
  // visitor with no override set, timeStr() below just uses their browser.
  let _prefs = {};
  function _loadPrefs() {
    const token = localStorage.getItem('apphub_token');
    if (!token) return;
    fetch('/api/pub/apphub/me', {headers:{'X-Pub-Token':token}}).then(r=>r.ok?r.json():{}).then(p=>{_prefs=p;}).catch(()=>{});
  }
  _loadPrefs();

  // Strings live in public/i18n.js so they travel inside the store archive and
  // are loaded before this file by all three surfaces (window, public page,
  // Telegram mini-app).
  const I18N = window.CHAT_I18N || { en: {} };
  function t(key, vars) {
    const lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    let s = (I18N[lang] || I18N.en)[key] || I18N.en[key] || key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  // The end-to-end encryption client (apps/chat/premium/public/crypto.js). It
  // exists only while the server offers encrypted chats; without it every
  // check below is skipped and the widget behaves as a plain chat.
  let E = null;

  const MAX_GROUP_MEMBERS = 50;
  const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','🙂','😉',
                  '😢','😭','😡','😱','😴','🤗','🤝','👍','👎','👏','🙏','💪',
                  '🔥','🎉','❤️','💙','💯','✅','❌','⭐','☀️','🌙','🎂','☕'];
  const NAME_COLORS = ['#f38ba8','#fab387','#f9e2af','#a6e3a1','#94e2d5','#89dceb','#b4befe','#cba6f7'];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function hashIdx(s, n) {
    let h = 0;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % n;
  }

  function avatarHtml(u, size) {
    size = size || 36;
    if (u && u.avatar_svg) {
      return u.avatar_svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
    }
    const color  = esc((u && u.avatar_color) || '#585b70');
    const letter = esc((((u && u.display_name) || '?')[0] || '?').toUpperCase());
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.45)}px;color:#1e1e2e;flex-shrink:0">${letter}</div>`;
  }

  function groupAvatarHtml(id, size) {
    size = size || 36;
    const color = NAME_COLORS[hashIdx(id, NAME_COLORS.length)];
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.5)}px;color:#1e1e2e;flex-shrink:0">👥</div>`;
  }

  function timeStr(iso) {
    try {
      const d = new Date(iso);
      if (_prefs.time_format) return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:_prefs.time_format==='12'});
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    catch (_) { return ''; }
  }

  function injectStyles() {
    if (document.getElementById('chat-widget-style')) return;
    const style = document.createElement('style');
    style.id = 'chat-widget-style';
    style.textContent = `
.cw-root{display:flex;height:100%;background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);font-family:system-ui,sans-serif;overflow:hidden;position:relative}
.cw-sidebar{width:280px;flex-shrink:0;border-right:1px solid var(--pub-surface2, #313244);display:flex;flex-direction:column;min-height:0}
.cw-search{padding:10px;border-bottom:1px solid var(--pub-surface2, #313244);position:relative;display:flex;gap:6px;align-items:center}
.cw-search-input{flex:1;min-width:0;box-sizing:border-box;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:6px;color:var(--pub-fg, #cdd6f4);padding:8px 10px;font-size:.85rem;outline:none}
.cw-search-input:focus{border-color:var(--pub-accent, #89b4fa)}
.cw-newgroup{flex-shrink:0;background:var(--pub-surface2, #313244);border:none;border-radius:6px;color:var(--pub-fg, #cdd6f4);height:34px;padding:0 10px;font-size:.95rem;cursor:pointer}
.cw-newgroup:hover{background:var(--pub-border, #3b3b54)}
.cw-search-results{position:absolute;left:10px;right:10px;top:100%;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:6px;margin-top:4px;max-height:260px;overflow-y:auto;z-index:5;display:none}
.cw-search-results.show{display:block}
.cw-result,.cw-conv{display:flex;align-items:center;gap:10px;padding:10px;cursor:pointer;border-bottom:1px solid #26263a}
.cw-result:hover,.cw-conv:hover{background:var(--pub-surface2, #292941)}
.cw-conv.active{background:var(--pub-surface2, #313244)}
.cw-conv-list,.cw-contacts-list{flex:1;overflow-y:auto;min-height:0}
.cw-sidebar-tabs{display:flex;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0}
.cw-sidebar-tab{flex:1;background:none;border:none;padding:10px 6px;font-size:.82rem;font-weight:600;color:var(--pub-dim, #6c7086);cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}
.cw-sidebar-tab.active{color:var(--pub-accent, #89b4fa);border-color:var(--pub-accent, #89b4fa)}
.cw-sidebar-tab:hover:not(.active){color:var(--pub-fg, #cdd6f4)}
.cw-conv-meta{flex:1;min-width:0}
.cw-conv-name{font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-conv-last{font-size:.78rem;color:var(--pub-dim, #6c7086);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-conv-last.cw-conv-typing{color:var(--pub-accent, #89b4fa);font-style:italic}
.cw-conv-badge{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-size:.7rem;font-weight:700;border-radius:10px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;padding:0 5px}
.cw-empty-hint{padding:20px;color:var(--pub-dim, #6c7086);font-size:.85rem;text-align:center}
.cw-thread{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.cw-thread-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--pub-dim, #6c7086);font-size:.9rem;text-align:center;padding:20px}
.cw-thread-active{flex:1;display:flex;flex-direction:column;min-height:0}
.cw-thread-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0}
.cw-thread-header.cw-clickable{cursor:pointer}
.cw-thread-head-main{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.cw-back{display:none;background:none;border:none;color:var(--pub-fg, #cdd6f4);font-size:1.2rem;cursor:pointer;padding:0 6px 0 0}
.cw-thread-titlewrap{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.cw-thread-name{font-weight:600;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-thread-status{font-size:.72rem;color:var(--pub-dim, #6c7086);min-height:14px}
.cw-thread-status.typing{color:var(--pub-accent, #89b4fa);font-style:italic}
.cw-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:6px}
.cw-bubble-row{display:flex}
.cw-bubble-row.me{justify-content:flex-end}
.cw-bubble-row.cw-failed .cw-bubble{opacity:.5}
.cw-bubble{max-width:70%;padding:7px 11px;border-radius:12px;font-size:.86rem;line-height:1.35;word-wrap:break-word;background:var(--pub-surface2, #313244)}
.cw-bubble-row.me .cw-bubble{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e)}
.cw-bubble-name{display:block;font-size:.72rem;font-weight:700;margin-bottom:2px}
.cw-bubble-time{font-size:.68rem;opacity:.6;margin-top:3px;display:block;text-align:right}
.cw-bubble-edited{font-size:.68rem;opacity:.6;margin-left:4px}
.cw-bubble-edit-input{width:100%;box-sizing:border-box;background:var(--pub-crust, #11111b);border:1px solid var(--pub-accent, #89b4fa);border-radius:8px;color:var(--pub-fg, #cdd6f4);padding:5px 8px;font-size:.86rem;outline:none}
.cw-input-row{position:relative;display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid var(--pub-surface2, #313244);flex-shrink:0}
.cw-input{flex:1;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:16px;color:var(--pub-fg, #cdd6f4);padding:9px 14px;font-size:.86rem;outline:none}
.cw-input:focus{border-color:var(--pub-accent, #89b4fa)}
.cw-send{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);border:none;border-radius:50%;width:36px;height:36px;font-size:1rem;cursor:pointer;flex-shrink:0}
.cw-emoji-btn{background:none;border:none;font-size:1.3rem;cursor:pointer;flex-shrink:0;padding:0 2px;line-height:1}
.cw-emoji-panel{position:absolute;bottom:54px;right:10px;width:260px;max-height:190px;overflow-y:auto;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:10px;padding:8px;display:none;grid-template-columns:repeat(7,1fr);gap:4px;z-index:10}
.cw-emoji-panel.show{display:grid}
.cw-emoji-panel span{cursor:pointer;font-size:1.2rem;text-align:center;padding:3px;border-radius:6px}
.cw-emoji-panel span:hover{background:var(--pub-surface2, #313244)}
.cw-ctx-menu{position:fixed;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:8px;padding:4px;z-index:50;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.cw-ctx-item{padding:8px 12px;font-size:.85rem;cursor:pointer;border-radius:6px;color:var(--pub-fg, #cdd6f4);white-space:nowrap}
.cw-ctx-item:hover{background:var(--pub-surface2, #313244)}
.cw-ctx-item.danger{color:var(--pub-red, #f38ba8)}
.cw-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100;padding:12px;box-sizing:border-box}
.cw-modal{background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);border:1px solid var(--pub-surface2, #313244);border-radius:12px;padding:18px;width:280px;max-width:100%;max-height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;font-family:system-ui,sans-serif}
.cw-modal.wide{width:360px}
.cw-modal-title{font-weight:700;font-size:.95rem;margin-bottom:4px}
.cw-modal-text{font-size:.85rem;color:var(--pub-fg2, #a6adc8)}
.cw-modal-btn{background:var(--pub-surface2, #313244);border:none;color:var(--pub-fg, #cdd6f4);border-radius:8px;padding:10px;font-size:.85rem;cursor:pointer;text-align:center;font-family:inherit}
.cw-modal-btn:hover{background:var(--pub-border, #3b3b54)}
.cw-modal-btn.primary{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:700}
.cw-modal-btn.primary:disabled{opacity:.4;cursor:default}
.cw-modal-btn.danger{color:var(--pub-red, #f38ba8)}
.cw-modal-btn.cancel{background:none;color:var(--pub-dim, #6c7086);margin-top:2px}
.cw-modal-err{color:var(--pub-red, #f38ba8);font-size:.8rem;min-height:0}
.cw-field{width:100%;box-sizing:border-box;background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:6px;color:var(--pub-fg, #cdd6f4);padding:8px 10px;font-size:.85rem;outline:none;font-family:inherit}
.cw-field:focus{border-color:var(--pub-accent, #89b4fa)}
.cw-chips{display:flex;flex-wrap:wrap;gap:6px}
.cw-chip{display:inline-flex;align-items:center;gap:4px;background:var(--pub-surface2, #313244);border-radius:12px;padding:3px 4px 3px 10px;font-size:.78rem}
.cw-chip button{background:none;border:none;color:var(--pub-dim, #6c7086);cursor:pointer;font-size:.8rem;padding:0 4px}
.cw-pick-list{overflow-y:auto;min-height:90px;max-height:240px;border:1px solid var(--pub-surface2, #313244);border-radius:6px}
.cw-pick-row{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-bottom:1px solid #26263a}
.cw-pick-row:hover{background:var(--pub-surface2, #292941)}
.cw-pick-check{margin-left:auto;color:var(--pub-accent, #89b4fa);font-weight:700;width:16px;text-align:center}
.cw-member-row{display:flex;align-items:center;gap:10px;padding:6px 0}
.cw-member-list{overflow-y:auto;max-height:260px}
.cw-role{font-size:.68rem;color:var(--pub-accent, #89b4fa);border:1px solid var(--pub-accent, #89b4fa);border-radius:8px;padding:0 6px;margin-left:6px}
.cw-member-x{margin-left:auto;background:none;border:none;color:var(--pub-red, #f38ba8);cursor:pointer;font-size:.95rem}
.cw-enc-lock{background:none;border:none;font-size:1rem;cursor:pointer;padding:0 4px;flex-shrink:0}
.cw-row-alt{margin-left:auto;flex-shrink:0;background:none;border:none;font-size:.95rem;cursor:pointer;padding:2px 4px;opacity:.7}
.cw-row-alt:hover{opacity:1}
.cw-toast{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);background:var(--pub-surface1, #181825);border:1px solid var(--pub-surface2, #313244);border-radius:8px;padding:8px 14px;font-size:.82rem;z-index:60;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.cw-login{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:var(--pub-fg2, #a6adc8)}
.cw-login button{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);border:none;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer}
@media (max-width:768px){
  .cw-sidebar{width:100%}
  .cw-back{display:inline-flex}
  .cw-root:not(.cw-show-thread) .cw-thread{display:none}
  .cw-root.cw-show-thread .cw-sidebar{display:none}
}
`;
    document.head.appendChild(style);
  }

  function apiBase() { return '/pub/chat'; }

  // Clears the shared core notification for a conversation (source='chat') by
  // hitting the core API directly with our own Apps Hub token. `ref` is the
  // sender's user id for a direct conversation and the conversation id for a
  // group — see _notify_members() in backend/apps/chat/public.py. Must not go
  // through window.mvmOS — this widget also runs standalone on the public
  // chat page (apps/chat/public/index.html), which has no desktop shell, so
  // window.mvmOS is undefined there and that call would silently no-op,
  // leaving the notification (and any badge derived from it) stuck unread.
  function markNotifRead(ref) {
    const token = localStorage.getItem('apphub_token');
    if (!token || !ref) return;
    fetch('/api/notifications/read-by-ref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
      body: JSON.stringify({ source: 'chat', ref: String(ref) }),
    }).then(() => window.mvmOS?._refreshNotifs?.()).catch(() => {});
  }

  async function api(path, opts) {
    opts = opts || {};
    const token = localStorage.getItem('apphub_token');
    const headers = Object.assign({ 'X-Pub-Token': token || '' }, opts.headers || {});
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts = Object.assign({}, opts, { body: JSON.stringify(opts.json) });
    }
    const r = await fetch(apiBase() + path, Object.assign({}, opts, { headers }));
    if (!r.ok) {
      const err = new Error('http_' + r.status);
      err.status = r.status;
      try { const j = await r.json(); err.code = j.error; err.missing = j.missing; } catch (_) {}
      throw err;
    }
    return r.json();
  }

  function errText(e) {
    const code = e && e.code;
    const own = E ? E.errText(e) : null;
    if (own !== null && own !== undefined) return own;
    if (code === 'encryption_unavailable') return t('errEncUnavailable');
    if (code === 'too_many')  return t('errTooMany', { n: MAX_GROUP_MEMBERS });
    if (code === 'forbidden') return t('errForbidden');
    if (code === 'not_found') return t('errNotFound');
    return t('errGeneric');
  }

  // opts.onNeedLogin, opts.openPeer (a user id to open a direct chat with on
  // first load), opts.openConv (a conversation id, e.g. from a Telegram link)
  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = `<div class="cw-login"><div>${esc(t('empty'))}</div></div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    root.innerHTML = `
      <div class="cw-root">
        <div class="cw-sidebar">
          <div class="cw-search">
            <input class="cw-search-input" placeholder="${esc(t('search'))}" autocomplete="off"/>
            <button type="button" class="cw-newgroup" title="${esc(t('newGroup'))}">👥＋</button>
            <button type="button" class="cw-newgroup cw-enc-settings" style="display:none" title="${esc(t('encSettings'))}">🔒</button>
            <div class="cw-search-results"></div>
          </div>
          <div class="cw-sidebar-tabs">
            <button type="button" class="cw-sidebar-tab active" data-tab="chats">💬 ${esc(t('chatsTab'))}</button>
            <button type="button" class="cw-sidebar-tab" data-tab="contacts">⭐ ${esc(t('contactsTab'))}</button>
          </div>
          <div class="cw-enc-slot"></div>
          <div class="cw-conv-list"><div class="cw-empty-hint">${esc(t('noConv'))}</div></div>
          <div class="cw-contacts-list" style="display:none"></div>
        </div>
        <div class="cw-thread">
          <div class="cw-thread-empty">${esc(t('empty'))}</div>
        </div>
      </div>`;

    const cwRoot       = root.querySelector('.cw-root');
    const searchIn     = root.querySelector('.cw-search-input');
    const searchRes    = root.querySelector('.cw-search-results');
    const newGroupBtn  = root.querySelector('.cw-newgroup:not(.cw-enc-settings)');
    const encBtn       = root.querySelector('.cw-enc-settings');
    const encSlot      = root.querySelector('.cw-enc-slot');
    const sidebarTabs  = root.querySelector('.cw-sidebar-tabs');
    const contactsList = root.querySelector('.cw-contacts-list');
    const convList     = root.querySelector('.cw-conv-list');
    const threadPane   = root.querySelector('.cw-thread');

    const SIDEBAR_TAB_KEY = 'cw_sidebar_tab';
    let sidebarTab = localStorage.getItem(SIDEBAR_TAB_KEY) || 'chats';

    function setSidebarTab(tabName) {
      sidebarTab = tabName;
      localStorage.setItem(SIDEBAR_TAB_KEY, tabName);
      sidebarTabs.querySelectorAll('.cw-sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
      convList.style.display     = tabName === 'chats'    ? '' : 'none';
      contactsList.style.display = tabName === 'contacts' ? '' : 'none';
    }
    sidebarTabs.querySelectorAll('.cw-sidebar-tab').forEach(b => {
      b.addEventListener('click', () => setSidebarTab(b.dataset.tab));
    });
    setSidebarTab(sidebarTab);

    let me = null;
    let conversations = [];
    let contacts = [];
    let activeConv = null;          // conversation id
    let activeDetail = null;        // detail (with members) of the open conversation
    let ws = null, retry = 0, closedByUs = false;
    const pending = [];
    const usersCache = {};          // user id -> profile, for names on group bubbles
    const typingBy = {};            // conversation id -> { user id: timer }

    function remember(u) { if (u && u.id) usersCache[u.id] = Object.assign(usersCache[u.id] || {}, u); }
    function nameOf(id) {
      const u = usersCache[id];
      return (u && (u.display_name || u.username)) || '?';
    }
    function flash(text) {
      if (!text) return;
      const el = document.createElement('div');
      el.className = 'cw-toast';
      el.textContent = text;
      cwRoot.appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }

    function convName(c) { return c.type === 'group' ? (c.title || (c.encrypted ? t('encTitleLocked') : '')) : ((c.peer && (c.peer.display_name || c.peer.username)) || '?'); }
    function convAvatar(c, size) { return c.type === 'group' ? groupAvatarHtml(c.id, size) : avatarHtml(c.peer, size); }
    function notifRef(c) { return c.type === 'group' ? c.id : (c.peer && c.peer.id); }

    function typersOf(cid) { return Object.keys(typingBy[cid] || {}); }
    function typingText(c) {
      const ids = typersOf(c.id);
      if (!ids.length) return '';
      if (c.type !== 'group') return t('typing');
      return ids.length === 1 ? t('typingOne', { name: nameOf(ids[0]) }) : t('typingMany');
    }

    // The lock button and the "unlock" bar exist only when encryption does.
    function syncEncUi() {
      encBtn.style.display = E ? '' : 'none';
      encBtn.title = t('encSettings');
      const need = !!E && !E.isUnlocked() && conversations.some(c => c.encrypted && !c.locked);
      encSlot.innerHTML = need
        ? `<div class="cw-enc-bar"><span>🔒 ${esc(t('encUnlockBar'))}</span><button type="button">${esc(t('encUnlock'))}</button></div>` : '';
      const unlockBtn = encSlot.querySelector('button');
      if (unlockBtn) unlockBtn.addEventListener('click', () => E.unlock());
    }

    function renderConvList() {
      syncEncUi();
      if (!conversations.length) {
        convList.innerHTML = `<div class="cw-empty-hint">${esc(t('noConv'))}</div>`;
        return;
      }
      convList.innerHTML = conversations.map(c => {
        const typing = typingText(c);
        let last = c.last_body || '';
        if (last && c.last_sender_id === (me && me.id)) last = t('you') + ': ' + last;
        else if (last && c.type === 'group' && c.last_sender_name) last = c.last_sender_name + ': ' + last;
        return `
        <div class="cw-conv${c.id === activeConv ? ' active' : ''}" data-id="${esc(c.id)}">
          ${convAvatar(c, 38)}
          <div class="cw-conv-meta">
            <div class="cw-conv-name">${c.encrypted ? '🔒 ' : ''}${esc(convName(c))}</div>
            <div class="cw-conv-last${typing ? ' cw-conv-typing' : ''}">${esc(typing || last)}</div>
          </div>
          ${c.unread ? `<div class="cw-conv-badge">${c.unread > 9 ? '9+' : c.unread}</div>` : ''}
        </div>`;
      }).join('');
      convList.querySelectorAll('.cw-conv').forEach(el => {
        el.addEventListener('click', () => openConv(el.dataset.id));
      });
    }

    let convSeq = 0;
    async function refreshConversations() {
      const seq = ++convSeq;
      try {
        const list = await api('/conversations');
        if (E) await Promise.all(list.map(c => E.decorate(c)));
        if (seq !== convSeq) return;          // a newer refresh has already answered
        conversations = list;
        conversations.forEach(c => { remember(c.peer); });
        renderConvList();
        // Someone joined or left an encrypted chat: whoever can, changes its key.
        if (E) E.rotateDue(list).then(did => { if (did) refreshConversations(); });
      } catch (_) {}
    }

    // Detail of one conversation, ready to show (encrypted names opened).
    async function decorated(d) { return E ? E.decorate(d) : d; }
    async function fetchDetail(cid) { return decorated(await api('/conversations/' + encodeURIComponent(cid))); }

    // With encryption on, a person's row offers the other kind of chat than
    // the one a plain click starts (a click follows the "encrypt new chats" setting).
    function altButton(id) {
      if (!E) return '';
      const enc = E.defaultEncrypted();
      return `<button type="button" class="cw-row-alt" data-alt="${esc(id)}" title="${esc(t(enc ? 'encStartPlain' : 'encStartChat'))}">${enc ? '💬' : '🔒'}</button>`;
    }
    function wireAlt(box, after) {
      box.querySelectorAll('.cw-row-alt').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        openPeer(b.dataset.alt, !E.defaultEncrypted());
        if (after) after();
      }));
    }

    function renderContactsList() {
      if (!contacts.length) {
        contactsList.innerHTML = `<div class="cw-empty-hint">${esc(t('noContacts'))}</div>`;
        return;
      }
      contactsList.innerHTML = contacts.map(c => `
        <div class="cw-conv" data-peer="${esc(c.id)}">
          ${avatarHtml(c, 38)}
          <div class="cw-conv-meta"><div class="cw-conv-name">${esc(c.display_name || c.username)}</div></div>
          ${altButton(c.id)}
        </div>`).join('');
      contactsList.querySelectorAll('.cw-conv').forEach(el => {
        el.addEventListener('click', () => { openPeer(el.dataset.peer); setSidebarTab('chats'); });
      });
      wireAlt(contactsList, () => setSidebarTab('chats'));
    }

    async function refreshContacts() {
      try {
        contacts = await fetch('/api/pub/apphub/favourites', { headers: { 'X-Pub-Token': token } }).then(r => r.ok ? r.json() : []);
        contacts.forEach(remember);
        renderContactsList();
      } catch (_) {}
    }

    function scrollBottom(el) { el.scrollTop = el.scrollHeight; }

    // ── typing indicator ─────────────────────────────────────────────────
    function setTyping(cid, uid, on) {
      const map = typingBy[cid] || (typingBy[cid] = {});
      if (map[uid]) { clearTimeout(map[uid]); delete map[uid]; }
      if (on) map[uid] = setTimeout(() => setTyping(cid, uid, false), 3500);
      renderConvList();
      if (cid === activeConv) paintStatus();
    }

    function statusText() {
      const c = activeDetail;
      if (!c) return '';
      const ids = typersOf(c.id);
      if (ids.length) return typingText(c);
      const lock = c.encrypted ? '🔒 ' + t('encBanner') : '';
      if (c.type === 'group') return t('membersCount', { n: c.member_count }) + (lock ? ' · ' + lock : '');
      return lock;
    }

    function paintStatus() {
      const el = threadPane.querySelector('.cw-thread-status');
      if (!el) return;
      el.textContent = statusText();
      el.classList.toggle('typing', !!(activeDetail && typersOf(activeDetail.id).length));
    }

    function paintHeader() {
      const box = threadPane.querySelector('.cw-thread-head-main');
      if (!box || !activeDetail) return;
      box.innerHTML = `
        ${convAvatar(activeDetail, 30)}
        <div class="cw-thread-titlewrap">
          <div class="cw-thread-name">${esc(convName(activeDetail))}</div>
          <div class="cw-thread-status"></div>
        </div>
        ${activeDetail.encrypted && E ? `<button type="button" class="cw-enc-lock" title="${esc(t('encSecurityTitle'))}">🔒</button>` : ''}`;
      paintStatus();
    }

    // ── bubbles ──────────────────────────────────────────────────────────
    function nameColor(id) { return NAME_COLORS[hashIdx(id, NAME_COLORS.length)]; }

    function bubbleHtml(m, prevFrom) {
      const from = m.from;
      const mine = from === me.id;
      const id = m.id || '';
      const clientId = (!id && m.client_id) ? m.client_id : '';
      const editedTag = m.edited_at ? `<span class="cw-bubble-edited">${esc(t('edited'))}</span>` : '';
      const showName = !mine && activeDetail && activeDetail.type === 'group' && prevFrom !== from;
      const nameTag = showName
        ? `<span class="cw-bubble-name" data-uid="${esc(from)}" style="color:${nameColor(from)}">${esc(nameOf(from))}</span>` : '';
      return `<div class="cw-bubble-row${mine ? ' me' : ''}" data-from="${esc(from)}"${id ? ` data-id="${esc(id)}"` : ''}${clientId ? ` data-client-id="${esc(clientId)}"` : ''}>
        <div class="cw-bubble">${nameTag}<span class="cw-bubble-body">${esc(m.body)}</span>${editedTag}<span class="cw-bubble-time">${timeStr(m.created_at)}</span></div>
      </div>`;
    }

    function renderMessages(list) {
      let prev = null;
      return list.map(m => { const h = bubbleHtml(m, prev); prev = m.from; return h; }).join('');
    }

    function refreshNames() {
      threadPane.querySelectorAll('.cw-bubble-name').forEach(el => { el.textContent = nameOf(el.dataset.uid); });
    }

    // ── context menu (edit / delete on own messages) ─────────────────────
    function closeCtxMenu() {
      const existing = document.querySelector('.cw-ctx-menu');
      if (existing) existing.remove();
    }

    function showCtxMenu(x, y, row) {
      closeCtxMenu();
      const menu = document.createElement('div');
      menu.className = 'cw-ctx-menu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.innerHTML = `
        <div class="cw-ctx-item" data-act="edit">✏️ ${esc(t('menuEdit'))}</div>
        <div class="cw-ctx-item danger" data-act="delete">🗑 ${esc(t('menuDelete'))}</div>`;
      document.body.appendChild(menu);
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 6) + 'px';
      if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 6) + 'px';
      menu.querySelector('[data-act="edit"]').addEventListener('click', () => { closeCtxMenu(); startEdit(row); });
      menu.querySelector('[data-act="delete"]').addEventListener('click', () => { closeCtxMenu(); confirmDelete(row); });
      setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
    }

    function startEdit(row) {
      const bubble = row.querySelector('.cw-bubble');
      const bodyEl = bubble.querySelector('.cw-bubble-body');
      if (!bodyEl) return;
      const current = bodyEl.textContent;
      const input = document.createElement('input');
      input.className = 'cw-bubble-edit-input';
      input.value = current;
      bodyEl.replaceWith(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      let done = false, committing = false;
      function restore(text) {
        if (done) return;
        done = true;
        const span = document.createElement('span');
        span.className = 'cw-bubble-body';
        span.textContent = text;
        input.replaceWith(span);
      }
      async function commit() {
        if (done || committing) return;
        const val = input.value.trim();
        if (val && val !== current) {
          committing = true;
          const msg = { type: 'edit', id: row.dataset.id, body: val };
          if (activeDetail && activeDetail.encrypted && E) {
            try {
              msg.key_version = activeDetail.key_version;
              msg.body = await E.encryptMessage(activeDetail.id, msg.key_version, val);
            } catch (e) { flash(errText(e)); restore(current); return; }
          }
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
          restore(val);
        } else {
          restore(current);
        }
      }
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); restore(current); }
      });
      input.addEventListener('blur', () => commit());
    }

    function openOverlay(html, cls) {
      const overlay = document.createElement('div');
      overlay.className = 'cw-modal-overlay';
      overlay.innerHTML = `<div class="cw-modal${cls ? ' ' + cls : ''}">${html}</div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
      return overlay;
    }

    function confirmDelete(row) {
      const overlay = openOverlay(`
          <div class="cw-modal-title">${esc(t('delTitle'))}</div>
          <button class="cw-modal-btn danger" data-act="everyone">${esc(t('delForEveryone'))}</button>
          <button class="cw-modal-btn" data-act="me">${esc(t('delForMe'))}</button>
          <button class="cw-modal-btn cancel" data-act="cancel">${esc(t('cancel'))}</button>`);
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());
      overlay.querySelector('[data-act="everyone"]').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'delete', id: row.dataset.id, for_everyone: true }));
        overlay.remove();
      });
      overlay.querySelector('[data-act="me"]').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'delete', id: row.dataset.id, for_everyone: false }));
        overlay.remove();
      });
    }

    // A yes/no box; resolves true only on the confirm button.
    function confirmBox(title, text, okLabel) {
      return new Promise(resolve => {
        const overlay = openOverlay(`
          <div class="cw-modal-title">${esc(title)}</div>
          ${text ? `<div class="cw-modal-text">${esc(text)}</div>` : ''}
          <button class="cw-modal-btn danger" data-act="ok">${esc(okLabel)}</button>
          <button class="cw-modal-btn cancel" data-act="cancel">${esc(t('cancel'))}</button>`);
        let settled = false;
        const done = v => { if (settled) return; settled = true; overlay.remove(); resolve(v); };
        overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
        new MutationObserver((_, obs) => { if (!document.body.contains(overlay)) { obs.disconnect(); done(false); } })
          .observe(document.body, { childList: true });
      });
    }

    // ── people picker (create a group / add people to one) ───────────────
    // cfg: { title, withName, exclude:Set of ids, okLabel, onConfirm(name, ids) -> Promise }
    function openPicker(cfg) {
      const selected = new Map();
      const exclude = cfg.exclude || new Set();
      const overlay = openOverlay(`
        <div class="cw-modal-title">${esc(cfg.title)}</div>
        ${cfg.withName ? `<input class="cw-field cw-pick-name" maxlength="60" placeholder="${esc(t('groupName'))}" autocomplete="off"/>` : ''}
        ${cfg.encToggle ? `<label class="cw-enc-check"><input type="checkbox" class="cw-pick-enc"${E && E.defaultEncrypted() ? ' checked' : ''}/> 🔒 ${esc(t('encNewGroupToggle'))}</label>` : ''}
        <div class="cw-chips"></div>
        <input class="cw-field cw-pick-search" placeholder="${esc(t('search'))}" autocomplete="off"/>
        <div class="cw-pick-list"></div>
        <div class="cw-modal-err"></div>
        <button class="cw-modal-btn primary" data-act="ok" disabled>${esc(cfg.okLabel)}</button>
        <button class="cw-modal-btn cancel" data-act="cancel">${esc(t('cancel'))}</button>`, 'wide');
      const nameIn = overlay.querySelector('.cw-pick-name');
      const encIn  = overlay.querySelector('.cw-pick-enc');
      const chips  = overlay.querySelector('.cw-chips');
      const search = overlay.querySelector('.cw-pick-search');
      const list   = overlay.querySelector('.cw-pick-list');
      const err    = overlay.querySelector('.cw-modal-err');
      const okBtn  = overlay.querySelector('[data-act="ok"]');
      let shown = [];
      let timer = null;

      function canSubmit() {
        return selected.size > 0 && (!nameIn || nameIn.value.trim().length > 0);
      }
      function paint() {
        chips.innerHTML = [...selected.values()].map(u =>
          `<span class="cw-chip">${esc(u.display_name || u.username)}<button type="button" data-id="${esc(u.id)}">✕</button></span>`).join('');
        chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { selected.delete(b.dataset.id); paint(); }));
        list.innerHTML = shown.length ? shown.map(u => `
          <div class="cw-pick-row" data-id="${esc(u.id)}">
            ${avatarHtml(u, 30)}
            <div class="cw-conv-meta"><div class="cw-conv-name">${esc(u.display_name || u.username)}</div></div>
            <span class="cw-pick-check">${selected.has(u.id) ? '✓' : ''}</span>
          </div>`).join('') : `<div class="cw-empty-hint">${esc(t('noResults'))}</div>`;
        list.querySelectorAll('.cw-pick-row').forEach(row => row.addEventListener('click', () => {
          const u = shown.find(x => x.id === row.dataset.id);
          if (!u) return;
          if (selected.has(u.id)) selected.delete(u.id); else selected.set(u.id, u);
          paint();
        }));
        okBtn.disabled = !canSubmit();
      }
      function offer(users) {
        shown = users.filter(u => u.id !== (me && me.id) && !exclude.has(u.id));
        users.forEach(remember);
        paint();
      }
      offer(contacts);
      search.addEventListener('input', () => {
        clearTimeout(timer);
        const q = search.value.trim();
        if (q.length < 2) { offer(contacts); return; }
        timer = setTimeout(async () => {
          try {
            const r = await fetch('/api/pub/apphub/search?q=' + encodeURIComponent(q));
            offer(r.ok ? await r.json() : []);
          } catch (_) {}
        }, 250);
      });
      if (nameIn) { nameIn.addEventListener('input', () => { okBtn.disabled = !canSubmit(); }); nameIn.focus(); }
      else search.focus();
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());
      okBtn.addEventListener('click', async () => {
        if (!canSubmit()) return;
        okBtn.disabled = true;
        err.textContent = '';
        try {
          await cfg.onConfirm(nameIn ? nameIn.value.trim() : '', [...selected.keys()], !!(encIn && encIn.checked));
          overlay.remove();
        } catch (e) {
          err.textContent = errText(e);
          okBtn.disabled = false;
        }
      });
    }

    function newGroupDialog() {
      openPicker({
        title: t('newGroup'), withName: true, okLabel: t('create'), encToggle: !!E,
        onConfirm: async (name, ids, encrypted) => {
          let body = { title: name, member_ids: ids };
          if (encrypted && E) {
            const p = await E.groupPayload(name, ids);
            body = { title: p.title, member_ids: ids, encrypted: true, wraps: p.wraps };
          }
          const d = await api('/groups', { method: 'POST', json: body });
          await refreshConversations();
          openConv(d.id);
        },
      });
    }
    newGroupBtn.addEventListener('click', newGroupDialog);

    // ── group info: rename, members, add, remove, leave ──────────────────
    function groupInfoDialog() {
      const d = activeDetail;
      if (!d || d.type !== 'group') return;
      const admin = d.role === 'admin';
      const overlay = openOverlay(`
        <div class="cw-modal-title">${esc(t('groupInfo'))}</div>
        ${admin
          ? `<input class="cw-field cw-info-name" maxlength="60" value="${esc(d.title)}" autocomplete="off"/>
             <button class="cw-modal-btn" data-act="rename">${esc(t('rename'))}</button>`
          : `<div class="cw-thread-name">${esc(d.title)}</div>`}
        <div class="cw-modal-text">${esc(t('membersCount', { n: d.member_count }))}${d.encrypted ? ' · 🔒 ' + esc(t('encBanner')) : ''}</div>
        <div class="cw-member-list">${d.members.map(m => `
          <div class="cw-member-row">
            ${avatarHtml(m, 30)}
            <div class="cw-conv-name">${esc(m.display_name || m.username)}${m.id === me.id ? ` (${esc(t('you'))})` : ''}${m.role === 'admin' ? `<span class="cw-role">${esc(t('admin'))}</span>` : ''}</div>
            ${admin && m.id !== me.id ? `<button class="cw-member-x" data-remove="${esc(m.id)}" title="${esc(t('remove'))}">✕</button>` : ''}
          </div>`).join('')}</div>
        <div class="cw-modal-err"></div>
        ${admin ? `<button class="cw-modal-btn" data-act="add">＋ ${esc(t('addPeople'))}</button>` : ''}
        <button class="cw-modal-btn danger" data-act="leave">${esc(t('leaveGroup'))}</button>
        <button class="cw-modal-btn cancel" data-act="close">${esc(t('close'))}</button>`, 'wide');
      const err = overlay.querySelector('.cw-modal-err');
      const fail = e => { err.textContent = errText(e); };
      const reopen = detail => { overlay.remove(); activeDetail = detail; detail.members.forEach(remember); paintHeader(); groupInfoDialog(); };

      overlay.querySelector('[data-act="close"]').addEventListener('click', () => overlay.remove());
      const renameBtn = overlay.querySelector('[data-act="rename"]');
      if (renameBtn) renameBtn.addEventListener('click', async () => {
        const title = overlay.querySelector('.cw-info-name').value.trim();
        if (!title || title === d.title) return;
        try {
          const sent = d.encrypted && E ? await E.encryptTitle(d.id, d.key_version, title) : title;
          const nd = await decorated(await api('/groups/' + encodeURIComponent(d.id), { method: 'PATCH', json: { title: sent } }));
          refreshConversations(); reopen(nd);
        } catch (e) { fail(e); }
      });
      const addBtn = overlay.querySelector('[data-act="add"]');
      if (addBtn) addBtn.addEventListener('click', () => {
        overlay.remove();
        openPicker({
          title: t('addPeople'), withName: false, okLabel: t('add'),
          exclude: new Set(d.members.map(m => m.id)),
          onConfirm: async (_, ids) => {
            const nd = await decorated(await api('/groups/' + encodeURIComponent(d.id) + '/members', { method: 'POST', json: { user_ids: ids } }));
            activeDetail = nd; nd.members.forEach(remember); paintHeader(); refreshConversations();
          },
        });
      });
      overlay.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
        const target = usersCache[b.dataset.remove];
        if (!await confirmBox(t('removeTitle', { name: (target && target.display_name) || '?' }), '', t('remove'))) return;
        try {
          await api('/groups/' + encodeURIComponent(d.id) + '/members/' + encodeURIComponent(b.dataset.remove), { method: 'DELETE' });
          reopen(await fetchDetail(d.id));
          refreshConversations();
        } catch (e) { fail(e); }
      }));
      overlay.querySelector('[data-act="leave"]').addEventListener('click', async () => {
        if (!await confirmBox(t('leaveTitle'), t('leaveText'), t('leave'))) return;
        try {
          await api('/groups/' + encodeURIComponent(d.id) + '/members/' + encodeURIComponent(me.id), { method: 'DELETE' });
          overlay.remove();
          closeThread();
          refreshConversations();
        } catch (e) { fail(e); }
      });
    }

    // ── opening a conversation ───────────────────────────────────────────
    function closeThread() {
      activeConv = null;
      activeDetail = null;
      cwRoot.classList.remove('cw-show-thread');
      threadPane.innerHTML = `<div class="cw-thread-empty">${esc(t('empty'))}</div>`;
      renderConvList();
    }

    // wantEnc: true/false to choose the kind of chat, or nothing to follow the
    // person's "encrypt new chats" setting.
    async function openPeer(peerId, wantEnc) {
      if (wantEnc === undefined) wantEnc = !!(E && E.defaultEncrypted());
      try {
        let d;
        if (wantEnc && E) {
          const p = await E.dmPayload(peerId);
          d = await api('/dm', { method: 'POST', json: { peer_id: peerId, encrypted: true, wraps: p.wraps } });
        } else {
          d = await api('/dm', { method: 'POST', json: { peer_id: peerId } });
        }
        d = await decorated(d);
        d.members.forEach(remember);
        await openConv(d.id, d);
      } catch (e) { flash(errText(e)); }
    }

    async function openConv(cid, detailHint) {
      const known = conversations.find(x => x.id === cid);
      if (known && known.locked) { flash(t('encLockedChat')); return; }
      activeConv = cid;
      activeDetail = detailHint || null;
      cwRoot.classList.add('cw-show-thread');
      renderConvList();

      threadPane.innerHTML = `
        <div class="cw-thread-active">
          <div class="cw-thread-header">
            <button class="cw-back" type="button">←</button>
            <div class="cw-thread-head-main"></div>
          </div>
          <div class="cw-messages"></div>
          <form class="cw-input-row">
            <button class="cw-emoji-btn" type="button">😊</button>
            <div class="cw-emoji-panel"></div>
            <input class="cw-input" placeholder="${esc(t('placeholder'))}" autocomplete="off"/>
            <button class="cw-send" type="submit">➤</button>
          </form>
        </div>`;

      threadPane.querySelector('.cw-back').addEventListener('click', () => {
        cwRoot.classList.remove('cw-show-thread');
      });
      const header = threadPane.querySelector('.cw-thread-header');
      header.addEventListener('click', e => {
        if (e.target.closest('.cw-back')) return;
        if (e.target.closest('.cw-enc-lock')) { if (E && activeDetail) E.securityDialog(activeDetail); return; }
        if (activeDetail && activeDetail.type === 'group') groupInfoDialog();
      });

      const msgsEl     = threadPane.querySelector('.cw-messages');
      const form       = threadPane.querySelector('.cw-input-row');
      const input      = threadPane.querySelector('.cw-input');
      const emojiBtn   = threadPane.querySelector('.cw-emoji-btn');
      const emojiPanel = threadPane.querySelector('.cw-emoji-panel');

      emojiPanel.innerHTML = EMOJIS.map(e => `<span>${e}</span>`).join('');
      emojiBtn.addEventListener('click', e => {
        e.stopPropagation();
        emojiPanel.classList.toggle('show');
      });
      emojiPanel.querySelectorAll('span').forEach(el => {
        el.addEventListener('click', () => {
          input.value += el.textContent;
          input.focus();
        });
      });

      if (activeDetail) { header.classList.toggle('cw-clickable', activeDetail.type === 'group'); paintHeader(); }

      msgsEl.addEventListener('contextmenu', e => {
        const row = e.target.closest('.cw-bubble-row.me');
        if (!row || !row.dataset.id) return;
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, row);
      });
      let lpTimer = null;
      msgsEl.addEventListener('touchstart', e => {
        const row = e.target.closest('.cw-bubble-row.me');
        if (!row || !row.dataset.id) return;
        const touch = e.touches[0];
        lpTimer = setTimeout(() => showCtxMenu(touch.clientX, touch.clientY, row), 500);
      }, { passive: true });
      msgsEl.addEventListener('touchend', () => clearTimeout(lpTimer));
      msgsEl.addEventListener('touchmove', () => clearTimeout(lpTimer));

      let lastTypingSent = 0;
      input.addEventListener('input', () => {
        const now = Date.now();
        if (now - lastTypingSent > 2500 && ws && ws.readyState === WebSocket.OPEN) {
          lastTypingSent = now;
          ws.send(JSON.stringify({ type: 'typing', conversation_id: cid }));
        }
      });

      form.addEventListener('submit', e => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        emojiPanel.classList.remove('show');
        const clientId = sendMessage(cid, body);
        const last = msgsEl.lastElementChild;
        msgsEl.insertAdjacentHTML('beforeend', bubbleHtml({ from: me.id, body, created_at: new Date().toISOString(), client_id: clientId }, last && last.dataset.from));
        scrollBottom(msgsEl);
      });

      // Everything above is wired synchronously so a fast Enter can never fall
      // through to a native form submit; the input stays disabled until the
      // history has loaded, so nothing is sent into a half-drawn thread.
      input.disabled = true;
      try {
        const raw = await api('/conversations/' + encodeURIComponent(cid));
        if (activeConv !== cid) return;
        if (raw.encrypted) {
          if (raw.locked || !E) { flash(t('encLockedChat')); closeThread(); return; }
          // The conversation key is opened with the person's passphrase.
          if (!E.isUnlocked() && !(await E.unlock())) { if (activeConv === cid) closeThread(); return; }
        }
        const detail = await decorated(raw);
        const hist = await api('/conversations/' + encodeURIComponent(cid) + '/messages?limit=50');
        if (detail.encrypted) await Promise.all(hist.messages.map(m => E.decryptMessage(cid, m)));
        if (activeConv !== cid) return;       // the user moved on while this loaded
        activeDetail = detail;
        detail.members.forEach(remember);
        Object.values(hist.users || {}).forEach(remember);
        header.classList.toggle('cw-clickable', detail.type === 'group');
        paintHeader();
        msgsEl.innerHTML = renderMessages(hist.messages);
        scrollBottom(msgsEl);
        input.disabled = false;
        input.focus();
      } catch (e) {
        if (activeConv === cid) { flash(errText(e)); closeThread(); }
        return;
      }

      // The user is looking at the conversation now: clear its pending push
      // notification instead of waiting for the bell icon.
      markNotifRead(notifRef(activeDetail));
      refreshConversations();
    }

    const sentPlain = new Map();      // client id -> { cid, text, tries }, kept until the server confirms
    let sendChain = Promise.resolve();

    function markFailed(clientId) {
      const row = threadPane.querySelector(`.cw-bubble-row[data-client-id="${CSS.escape(clientId)}"]`);
      if (row) row.classList.add('cw-failed');
    }

    // Sends one message. Encrypting takes a moment, so sends go through a
    // chain that keeps them in the order they were typed.
    async function dispatch(cid, text, clientId) {
      const payload = { type: 'send', conversation_id: cid, body: text, client_id: clientId };
      const c = (activeDetail && activeDetail.id === cid) ? activeDetail : conversations.find(x => x.id === cid);
      if (c && c.encrypted) {
        try {
          if (!E) throw Object.assign(new Error('encryption_unavailable'), { code: 'encryption_unavailable' });
          const kv = await E.freshVersion(cid, c);
          payload.body = await E.encryptMessage(cid, kv, text);
          payload.key_version = kv;
          const prev = sentPlain.get(clientId);
          sentPlain.set(clientId, { cid, text, tries: prev ? prev.tries + 1 : 0 });
        } catch (e) { markFailed(clientId); flash(errText(e)); return; }
      }
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      else pending.push(payload);
    }

    function sendMessage(cid, body) {
      const clientId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
      sendChain = sendChain.then(() => dispatch(cid, body, clientId)).catch(() => {});
      return clientId;
    }

    // The conversation got a new key between encrypting and arriving: fetch
    // the new key and send the same text again, once.
    async function retryStale(clientId) {
      const s = sentPlain.get(clientId);
      if (!s || s.tries > 0) { markFailed(clientId); sentPlain.delete(clientId); return; }
      try {
        const d = await fetchDetail(s.cid);
        if (activeConv === s.cid) activeDetail = d;
        const i = conversations.findIndex(x => x.id === s.cid);
        if (i >= 0) conversations[i] = Object.assign(conversations[i], { key_version: d.key_version, needs_rotation: d.needs_rotation });
        sendChain = sendChain.then(() => dispatch(s.cid, s.text, clientId)).catch(() => {});
      } catch (_) { markFailed(clientId); }
    }

    // ── live events ──────────────────────────────────────────────────────
    // Frames are handled one after the other: an encrypted one has to be
    // decrypted first, and a fast second frame must not overtake the first.
    let inChain = Promise.resolve();
    function onIncoming(msg) { inChain = inChain.then(() => handleIncoming(msg)).catch(() => {}); }

    async function handleIncoming(msg) {
      if (msg.encrypted) {
        if (E) await E.decryptMessage(msg.conversation_id, msg);
        else msg.body = t('encLockedShort');
      }
      const cid = msg.conversation_id;
      const msgsEl = threadPane.querySelector('.cw-messages');
      const mine = msg.from === me.id;
      if (!mine) setTyping(cid, msg.from, false);
      if (cid === activeConv && msgsEl) {
        if (mine && msg.client_id) {
          sentPlain.delete(msg.client_id);
          const row = msgsEl.querySelector(`.cw-bubble-row[data-client-id="${CSS.escape(msg.client_id)}"]`);
          if (row) { row.dataset.id = msg.id; delete row.dataset.clientId; }
          else if (!msgsEl.querySelector(`.cw-bubble-row[data-id="${CSS.escape(msg.id)}"]`)) {
            // sent from another tab or device of the same account
            const last = msgsEl.lastElementChild;
            msgsEl.insertAdjacentHTML('beforeend', bubbleHtml(msg, last && last.dataset.from));
            scrollBottom(msgsEl);
          }
        } else if (!mine) {
          const last = msgsEl.lastElementChild;
          msgsEl.insertAdjacentHTML('beforeend', bubbleHtml(msg, last && last.dataset.from));
          scrollBottom(msgsEl);
          if (!usersCache[msg.from]) {
            // someone added after this window loaded — fetch the roster once
            fetchDetail(cid).then(d => {
              if (activeConv !== cid) return;
              activeDetail = d; d.members.forEach(remember); refreshNames(); paintHeader();
            }).catch(() => {});
          }
          // The backend creates a notification for every message regardless of
          // whether the recipient is viewing the conversation live — clear it
          // here too, and tell the server this message has been read.
          markNotifRead(notifRef(activeDetail));
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'read', conversation_id: cid }));
          return;            // the server answers with a 'read' event, which refreshes the list
        }
      }
      refreshConversations();
    }

    function onEdited(msg) { inChain = inChain.then(() => handleEdited(msg)).catch(() => {}); }

    async function handleEdited(msg) {
      const row = threadPane.querySelector(`.cw-bubble-row[data-id="${CSS.escape(msg.id)}"]`);
      if (row && msg.encrypted) {
        msg.from = row.dataset.from;            // only the sender can edit, so this is who sealed it
        if (E) await E.decryptMessage(msg.conversation_id, msg);
        else msg.body = t('encLockedShort');
      }
      if (row) {
        const bubble = row.querySelector('.cw-bubble');
        const bodyEl = bubble && bubble.querySelector('.cw-bubble-body');
        if (bodyEl) bodyEl.textContent = msg.body;
        if (bubble && !bubble.querySelector('.cw-bubble-edited')) {
          const tag = document.createElement('span');
          tag.className = 'cw-bubble-edited';
          tag.textContent = t('edited');
          bubble.insertBefore(tag, bubble.querySelector('.cw-bubble-time'));
        }
      }
      refreshConversations();
    }

    function onDeleted(msg) {
      const row = threadPane.querySelector(`.cw-bubble-row[data-id="${CSS.escape(msg.id)}"]`);
      if (row) row.remove();
      refreshConversations();
    }

    function onConversationUpdated(msg) {
      refreshConversations();
      if (msg.conversation_id !== activeConv) return;
      if (msg.removed) { flash(t('removedFromGroup')); closeThread(); return; }
      fetchDetail(activeConv).then(d => {
        if (activeConv !== d.id) return;
        activeDetail = d; d.members.forEach(remember); paintHeader(); refreshNames();
      }).catch(() => {});
    }

    function onError(msg) {
      if (msg.message === 'stale_key' && msg.client_id) { retryStale(msg.client_id); return; }
      if (msg.client_id) {
        const row = threadPane.querySelector(`.cw-bubble-row[data-client-id="${CSS.escape(msg.client_id)}"]`);
        if (row) row.classList.add('cw-failed');
      }
      if (msg.message === 'stale_key') flash(t('errGeneric'));
      else if (msg.message === 'encryption_unavailable') flash(t('errEncUnavailable'));
      else if (msg.message === 'rate_limited') flash(t('errRate'));
      else if (msg.message === 'not_member') flash(t('errNotFound'));
    }

    // Asks the server whether encrypted chats are on; if so, fetches the client
    // script (it needs the token, so it cannot be a plain <script src>).
    async function initEncryption() {
      if (E) return;
      try {
        const f = await api('/features');
        if (!f.encryption) return;
        const r = await fetch(apiBase() + '/e2ee/crypto.js', { headers: { 'X-Pub-Token': token }, cache: 'no-store' });
        if (!r.ok) return;
        if (!window.ChatE2EE) {
          const script = document.createElement('script');
          script.textContent = await r.text();
          document.head.appendChild(script);
          script.remove();
        }
        const inst = window.ChatE2EE && window.ChatE2EE.create({ api, t, esc, openOverlay, me: () => me, nameOf, flash });
        if (!inst) return;
        E = inst;
        E.onChange(() => { refreshConversations(); syncEncUi(); });
        await E.init();
        renderContactsList();
      } catch (_) { E = null; }
    }
    encBtn.addEventListener('click', () => { if (E) E.settingsDialog(); });

    function connect() {
      if (!document.body.contains(root)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}${apiBase()}/ws`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', token })); };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.type === 'ping') { ws.send('{"type":"pong"}'); return; }
        if (msg.type === 'joined') {
          const first = !me;
          me = msg.user; remember(me); retry = 0;
          while (pending.length) ws.send(JSON.stringify(pending.shift()));
          initEncryption().then(refreshConversations).then(() => {
            if (!first || activeConv !== null) return;
            if (opts.openConv) openConv(opts.openConv);
            else if (opts.openPeer) openPeer(opts.openPeer);
          });
          refreshContacts();
          return;
        }
        if (msg.type === 'message')              { onIncoming(msg); return; }
        if (msg.type === 'edited')               { onEdited(msg); return; }
        if (msg.type === 'deleted')              { onDeleted(msg); return; }
        if (msg.type === 'typing')               { setTyping(msg.conversation_id, msg.from, true); return; }
        if (msg.type === 'read')                 { refreshConversations(); return; }
        if (msg.type === 'conversation_updated') { onConversationUpdated(msg); return; }
        if (msg.type === 'error')                { onError(msg); return; }
      };
      ws.onclose = () => {
        if (closedByUs || !document.body.contains(root)) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, 400 * retry);
      };
      ws.onerror = () => {};
    }

    let searchTimer = null;
    searchIn.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchIn.value.trim();
      if (q.length < 2) { searchRes.classList.remove('show'); return; }
      searchTimer = setTimeout(async () => {
        try {
          const r = await fetch('/api/pub/apphub/search?q=' + encodeURIComponent(q));
          const users = r.ok ? await r.json() : [];
          searchRes.innerHTML = users.filter(u => !me || u.id !== me.id).map(u => `
            <div class="cw-result" data-peer="${esc(u.id)}">
              ${avatarHtml(u, 32)}
              <div class="cw-conv-meta"><div class="cw-conv-name">${esc(u.display_name || u.username)}</div></div>
            </div>`).join('') || `<div class="cw-empty-hint">—</div>`;
          searchRes.classList.add('show');
          searchRes.querySelectorAll('.cw-result').forEach(el => {
            el.addEventListener('click', () => {
              searchIn.value = ''; searchRes.classList.remove('show');
              openPeer(el.dataset.peer);
            });
          });
        } catch (_) {}
      }, 250);
    });
    document.addEventListener('click', e => {
      if (!searchRes.contains(e.target) && e.target !== searchIn) searchRes.classList.remove('show');
      const panel = threadPane.querySelector('.cw-emoji-panel');
      const btn = threadPane.querySelector('.cw-emoji-btn');
      if (panel && !panel.contains(e.target) && e.target !== btn) panel.classList.remove('show');
    });

    // The account's own language arrives after the widget has mounted (the
    // public layout applies it once /api/pub/apphub/me answers), and the desktop
    // can switch language while the window is open — repaint every visible label.
    function applyLang() {
      if (!document.body.contains(root)) return;
      searchIn.placeholder = t('search');
      newGroupBtn.title = t('newGroup');
      syncEncUi();
      sidebarTabs.querySelector('[data-tab="chats"]').textContent = '💬 ' + t('chatsTab');
      sidebarTabs.querySelector('[data-tab="contacts"]').textContent = '⭐ ' + t('contactsTab');
      renderConvList();
      renderContactsList();
      const empty = threadPane.querySelector('.cw-thread-empty');
      if (empty) empty.textContent = t('empty');
      const input = threadPane.querySelector('.cw-input');
      if (input) input.placeholder = t('placeholder');
      if (activeDetail) paintHeader();
      threadPane.querySelectorAll('.cw-bubble-edited').forEach(el => { el.textContent = t('edited'); });
    }
    if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(applyLang);

    connect();

    return {
      destroy() {
        closedByUs = true;
        E = null;
        Object.values(typingBy).forEach(m => Object.values(m).forEach(clearTimeout));
        if (ws) try { ws.close(); } catch (_) {}
      }
    };
  }

  return { mount, avatarHtml, esc };
})();
window.ChatWidget = ChatWidget;
