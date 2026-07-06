// mvmOS Chat — shared UI + websocket client, used by both the in-app window
// (apps/chat/main.js) and the standalone public page (apps/chat/public/index.html).
// Identity always comes from the shared 'apphub_token' in localStorage.
const ChatWidget = (() => {
  const I18N = {
    en: {
      search: 'Search people…', empty: 'Select a conversation', noConv: 'No conversations yet — search for someone above',
      contacts: 'Contacts', chatsTab: 'Chats', contactsTab: 'Contacts', noContacts: 'No contacts yet — add favourites in Apps Hub',
      placeholder: 'Message…', you: 'You', typing: 'typing…', edited: '(edited)',
      menuEdit: 'Edit', menuDelete: 'Delete',
      delTitle: 'Delete message?', delForMe: 'Delete for me', delForEveryone: 'Delete for everyone', cancel: 'Cancel',
    },
    bg: {
      search: 'Търси хора…', empty: 'Избери разговор', noConv: 'Все още няма разговори — потърси някого отгоре',
      contacts: 'Контакти', chatsTab: 'Чатове', contactsTab: 'Контакти', noContacts: 'Все още няма контакти — добави любими в Apps Hub',
      placeholder: 'Съобщение…', you: 'Ти', typing: 'пише…', edited: '(редактирано)',
      menuEdit: 'Редактирай', menuDelete: 'Изтрий',
      delTitle: 'Изтриване на съобщение?', delForMe: 'Изтрий само за мен', delForEveryone: 'Изтрий за всички', cancel: 'Отказ',
    },
  };
  function t(key) {
    const lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    return (I18N[lang] || I18N.en)[key] || I18N.en[key];
  }

  const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','🙂','😉',
                  '😢','😭','😡','😱','😴','🤗','🤝','👍','👎','👏','🙏','💪',
                  '🔥','🎉','❤️','💙','💯','✅','❌','⭐','☀️','🌙','🎂','☕'];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function avatarHtml(u, size) {
    size = size || 36;
    if (u && u.avatar_svg) {
      return u.avatar_svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
    }
    const color  = esc((u && u.avatar_color) || '#585b70');
    const letter = esc((((u && u.display_name) || '?')[0] || '?').toUpperCase());
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.45)}px;color:#1e1e2e;flex-shrink:0">${letter}</div>`;
  }

  function timeStr(iso) {
    try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (_) { return ''; }
  }

  function injectStyles() {
    if (document.getElementById('chat-widget-style')) return;
    const style = document.createElement('style');
    style.id = 'chat-widget-style';
    style.textContent = `
.cw-root{display:flex;height:100%;background:#1e1e2e;color:#cdd6f4;font-family:system-ui,sans-serif;overflow:hidden}
.cw-sidebar{width:280px;flex-shrink:0;border-right:1px solid #313244;display:flex;flex-direction:column;min-height:0}
.cw-search{padding:10px;border-bottom:1px solid #313244;position:relative}
.cw-search-input{width:100%;box-sizing:border-box;background:#181825;border:1px solid #313244;border-radius:6px;color:#cdd6f4;padding:8px 10px;font-size:.85rem;outline:none}
.cw-search-input:focus{border-color:#89b4fa}
.cw-search-results{position:absolute;left:10px;right:10px;top:100%;background:#181825;border:1px solid #313244;border-radius:6px;margin-top:4px;max-height:260px;overflow-y:auto;z-index:5;display:none}
.cw-search-results.show{display:block}
.cw-result,.cw-conv{display:flex;align-items:center;gap:10px;padding:10px;cursor:pointer;border-bottom:1px solid #26263a}
.cw-result:hover,.cw-conv:hover{background:#292941}
.cw-conv.active{background:#313244}
.cw-conv-list,.cw-contacts-list{flex:1;overflow-y:auto;min-height:0}
.cw-sidebar-tabs{display:flex;border-bottom:1px solid #313244;flex-shrink:0}
.cw-sidebar-tab{flex:1;background:none;border:none;padding:10px 6px;font-size:.82rem;font-weight:600;color:#6c7086;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}
.cw-sidebar-tab.active{color:#89b4fa;border-color:#89b4fa}
.cw-sidebar-tab:hover:not(.active){color:#cdd6f4}
.cw-conv-meta{flex:1;min-width:0}
.cw-conv-name{font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-conv-last{font-size:.78rem;color:#6c7086;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-conv-last.cw-conv-typing{color:#89b4fa;font-style:italic}
.cw-conv-badge{background:#89b4fa;color:#1e1e2e;font-size:.7rem;font-weight:700;border-radius:10px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;padding:0 5px}
.cw-empty-hint{padding:20px;color:#6c7086;font-size:.85rem;text-align:center}
.cw-thread{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.cw-thread-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#6c7086;font-size:.9rem}
.cw-thread-active{flex:1;display:flex;flex-direction:column;min-height:0}
.cw-thread-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #313244;flex-shrink:0}
.cw-back{display:none;background:none;border:none;color:#cdd6f4;font-size:1.2rem;cursor:pointer;padding:0 6px 0 0}
.cw-thread-titlewrap{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.cw-thread-name{font-weight:600;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-thread-status{font-size:.72rem;color:#89b4fa;font-style:italic;min-height:14px}
.cw-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:6px}
.cw-bubble-row{display:flex}
.cw-bubble-row.me{justify-content:flex-end}
.cw-bubble{max-width:70%;padding:7px 11px;border-radius:12px;font-size:.86rem;line-height:1.35;word-wrap:break-word;background:#313244}
.cw-bubble-row.me .cw-bubble{background:#89b4fa;color:#1e1e2e}
.cw-bubble-time{font-size:.68rem;opacity:.6;margin-top:3px;display:block;text-align:right}
.cw-bubble-edited{font-size:.68rem;opacity:.6;margin-left:4px}
.cw-bubble-edit-input{width:100%;box-sizing:border-box;background:#11111b;border:1px solid #89b4fa;border-radius:8px;color:#cdd6f4;padding:5px 8px;font-size:.86rem;outline:none}
.cw-input-row{position:relative;display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid #313244;flex-shrink:0}
.cw-input{flex:1;background:#181825;border:1px solid #313244;border-radius:16px;color:#cdd6f4;padding:9px 14px;font-size:.86rem;outline:none}
.cw-input:focus{border-color:#89b4fa}
.cw-send{background:#89b4fa;color:#1e1e2e;border:none;border-radius:50%;width:36px;height:36px;font-size:1rem;cursor:pointer;flex-shrink:0}
.cw-emoji-btn{background:none;border:none;font-size:1.3rem;cursor:pointer;flex-shrink:0;padding:0 2px;line-height:1}
.cw-emoji-panel{position:absolute;bottom:54px;right:10px;width:260px;max-height:190px;overflow-y:auto;background:#181825;border:1px solid #313244;border-radius:10px;padding:8px;display:none;grid-template-columns:repeat(7,1fr);gap:4px;z-index:10}
.cw-emoji-panel.show{display:grid}
.cw-emoji-panel span{cursor:pointer;font-size:1.2rem;text-align:center;padding:3px;border-radius:6px}
.cw-emoji-panel span:hover{background:#313244}
.cw-ctx-menu{position:fixed;background:#181825;border:1px solid #313244;border-radius:8px;padding:4px;z-index:50;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.cw-ctx-item{padding:8px 12px;font-size:.85rem;cursor:pointer;border-radius:6px;color:#cdd6f4;white-space:nowrap}
.cw-ctx-item:hover{background:#313244}
.cw-ctx-item.danger{color:#f38ba8}
.cw-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100}
.cw-modal{background:#1e1e2e;border:1px solid #313244;border-radius:12px;padding:18px;width:280px;display:flex;flex-direction:column;gap:8px}
.cw-modal-title{font-weight:700;font-size:.95rem;margin-bottom:4px}
.cw-modal-btn{background:#313244;border:none;color:#cdd6f4;border-radius:8px;padding:10px;font-size:.85rem;cursor:pointer;text-align:center}
.cw-modal-btn:hover{background:#3b3b54}
.cw-modal-btn.danger{color:#f38ba8}
.cw-modal-btn.cancel{background:none;color:#6c7086;margin-top:2px}
.cw-login{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:#a6adc8}
.cw-login button{background:#89b4fa;color:#1e1e2e;border:none;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer}
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

  async function api(path, opts) {
    opts = opts || {};
    const token = localStorage.getItem('apphub_token');
    const headers = Object.assign({ 'X-Pub-Token': token || '' }, opts.headers || {});
    const r = await fetch(apiBase() + path, Object.assign({}, opts, { headers }));
    if (!r.ok) throw new Error('http_' + r.status);
    return r.json();
  }

  // opts.onNeedLogin, opts.openPeer (peer_id to auto-open on first load, e.g. from a deep link)
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
            <div class="cw-search-results"></div>
          </div>
          <div class="cw-sidebar-tabs">
            <button type="button" class="cw-sidebar-tab active" data-tab="chats">💬 ${esc(t('chatsTab'))}</button>
            <button type="button" class="cw-sidebar-tab" data-tab="contacts">⭐ ${esc(t('contactsTab'))}</button>
          </div>
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
    const sidebarTabs   = root.querySelector('.cw-sidebar-tabs');
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
    let activePeer = null;
    let ws = null, retry = 0, closedByUs = false;
    const pending = [];
    const typingPeers = {};
    const typingTimers = {};

    function peerFromConv(c) { return { id: c.peer_id, username: c.username, display_name: c.display_name, avatar_color: c.avatar_color, avatar_svg: c.avatar_svg }; }

    function renderConvList() {
      if (!conversations.length) {
        convList.innerHTML = `<div class="cw-empty-hint">${esc(t('noConv'))}</div>`;
        return;
      }
      convList.innerHTML = conversations.map(c => `
        <div class="cw-conv${c.peer_id === activePeer ? ' active' : ''}" data-peer="${esc(c.peer_id)}">
          ${avatarHtml(c, 38)}
          <div class="cw-conv-meta">
            <div class="cw-conv-name">${esc(c.display_name || c.username)}</div>
            <div class="cw-conv-last${typingPeers[c.peer_id] ? ' cw-conv-typing' : ''}">${typingPeers[c.peer_id] ? esc(t('typing')) : esc(c.last_body || '')}</div>
          </div>
          ${c.unread ? `<div class="cw-conv-badge">${c.unread > 9 ? '9+' : c.unread}</div>` : ''}
        </div>`).join('');
      convList.querySelectorAll('.cw-conv').forEach(el => {
        el.addEventListener('click', () => openThread(el.dataset.peer, JSON.parse(JSON.stringify(conversations.find(c => c.peer_id === el.dataset.peer) || { peer_id: el.dataset.peer }))));
      });
    }

    async function refreshConversations() {
      try {
        conversations = await api('/conversations');
        renderConvList();
      } catch (_) {}
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
        </div>`).join('');
      contactsList.querySelectorAll('.cw-conv').forEach(el => {
        el.addEventListener('click', () => {
          openThread(el.dataset.peer, contacts.find(c => c.id === el.dataset.peer) || { id: el.dataset.peer });
          setSidebarTab('chats');
        });
      });
    }

    async function refreshContacts() {
      try {
        contacts = await fetch('/api/pub/apphub/favourites', { headers: { 'X-Pub-Token': token } }).then(r => r.ok ? r.json() : []);
        renderContactsList();
      } catch (_) {}
    }

    function scrollBottom(el) { el.scrollTop = el.scrollHeight; }

    function setTyping(peerId, isTyping) {
      if (isTyping) typingPeers[peerId] = true; else delete typingPeers[peerId];
      renderConvList();
      if (peerId === activePeer) {
        const statusEl = threadPane.querySelector('.cw-thread-status');
        if (statusEl) statusEl.textContent = typingPeers[peerId] ? t('typing') : '';
      }
    }

    function bubbleHtml(m) {
      const mine = m.from_id ? m.from_id === me.id : m.from === me.id;
      const id = m.id || '';
      const clientId = (!id && m.client_id) ? m.client_id : '';
      const editedTag = m.edited_at ? `<span class="cw-bubble-edited">${esc(t('edited'))}</span>` : '';
      return `<div class="cw-bubble-row${mine ? ' me' : ''}"${id ? ` data-id="${esc(id)}"` : ''}${clientId ? ` data-client-id="${esc(clientId)}"` : ''}>
        <div class="cw-bubble"><span class="cw-bubble-body">${esc(m.body)}</span>${editedTag}<span class="cw-bubble-time">${timeStr(m.created_at)}</span></div>
      </div>`;
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
      let done = false;
      function restore(text) {
        if (done) return;
        done = true;
        const span = document.createElement('span');
        span.className = 'cw-bubble-body';
        span.textContent = text;
        input.replaceWith(span);
      }
      function commit() {
        const val = input.value.trim();
        if (val && val !== current) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'edit', id: row.dataset.id, body: val }));
          }
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

    function confirmDelete(row) {
      const overlay = document.createElement('div');
      overlay.className = 'cw-modal-overlay';
      overlay.innerHTML = `
        <div class="cw-modal">
          <div class="cw-modal-title">${esc(t('delTitle'))}</div>
          <button class="cw-modal-btn danger" data-act="everyone">${esc(t('delForEveryone'))}</button>
          <button class="cw-modal-btn" data-act="me">${esc(t('delForMe'))}</button>
          <button class="cw-modal-btn cancel" data-act="cancel">${esc(t('cancel'))}</button>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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

    async function openThread(peerId, peerInfo) {
      activePeer = peerId;
      cwRoot.classList.add('cw-show-thread');
      renderConvList();

      threadPane.innerHTML = `
        <div class="cw-thread-active">
          <div class="cw-thread-header">
            <button class="cw-back" type="button">←</button>
            ${avatarHtml(peerInfo, 30)}
            <div class="cw-thread-titlewrap">
              <div class="cw-thread-name">${esc(peerInfo.display_name || peerInfo.username || peerId)}</div>
              <div class="cw-thread-status">${typingPeers[peerId] ? esc(t('typing')) : ''}</div>
            </div>
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

      const msgsEl    = threadPane.querySelector('.cw-messages');
      const form      = threadPane.querySelector('.cw-input-row');
      const input     = threadPane.querySelector('.cw-input');
      const emojiBtn  = threadPane.querySelector('.cw-emoji-btn');
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

      try {
        const history = await api(`/messages/${encodeURIComponent(peerId)}?limit=50`);
        msgsEl.innerHTML = history.map(bubbleHtml).join('');
        scrollBottom(msgsEl);
      } catch (_) {}

      refreshConversations();

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
          ws.send(JSON.stringify({ type: 'typing', to: peerId }));
        }
      });

      form.addEventListener('submit', e => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        emojiPanel.classList.remove('show');
        const clientId = sendMessage(peerId, body);
        msgsEl.insertAdjacentHTML('beforeend', bubbleHtml({ from: me.id, body, created_at: new Date().toISOString(), client_id: clientId }));
        scrollBottom(msgsEl);
      });
    }

    function sendMessage(to, body) {
      const clientId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
      const payload = { type: 'send', to, body, client_id: clientId };
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      else pending.push(payload);
      return clientId;
    }

    function onIncoming(msg) {
      const peerId = msg.from === me.id ? msg.to : msg.from;
      const msgsEl = threadPane.querySelector('.cw-messages');
      if (msg.from !== me.id) {
        clearTimeout(typingTimers[msg.from]);
        setTyping(msg.from, false);
      }
      if (peerId === activePeer && msgsEl) {
        if (msg.from === me.id && msg.client_id) {
          const row = msgsEl.querySelector(`.cw-bubble-row[data-client-id="${CSS.escape(msg.client_id)}"]`);
          if (row) { row.dataset.id = msg.id; delete row.dataset.clientId; }
        } else if (msg.from !== me.id) {
          msgsEl.insertAdjacentHTML('beforeend', bubbleHtml(msg));
          scrollBottom(msgsEl);
        }
      }
      refreshConversations();
    }

    function onEdited(msg) {
      const row = threadPane.querySelector(`.cw-bubble-row[data-id="${CSS.escape(msg.id)}"]`);
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

    function onTyping(msg) {
      const from = msg.from;
      clearTimeout(typingTimers[from]);
      typingTimers[from] = setTimeout(() => setTyping(from, false), 3500);
      setTyping(from, true);
    }

    function connect() {
      if (!document.body.contains(root)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}${apiBase()}/ws`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', token })); };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.type === 'ping') { ws.send('{"type":"pong"}'); return; }
        if (msg.type === 'joined') {
          me = msg.user; retry = 0;
          while (pending.length) ws.send(JSON.stringify(pending.shift()));
          refreshConversations().then(() => {
            if (opts.openPeer && activePeer === null) {
              const conv = conversations.find(c => c.peer_id === opts.openPeer);
              openThread(opts.openPeer, conv ? peerFromConv(conv) : { id: opts.openPeer });
            }
          });
          refreshContacts();
          return;
        }
        if (msg.type === 'message') { onIncoming(msg); return; }
        if (msg.type === 'edited')  { onEdited(msg); return; }
        if (msg.type === 'deleted') { onDeleted(msg); return; }
        if (msg.type === 'typing')  { onTyping(msg); return; }
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
            const u = users.find(x => x.id === el.dataset.peer);
            el.addEventListener('click', () => {
              searchIn.value = ''; searchRes.classList.remove('show');
              openThread(u.id, u);
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

    connect();

    return {
      destroy() {
        closedByUs = true;
        Object.values(typingTimers).forEach(clearTimeout);
        if (ws) try { ws.close(); } catch (_) {}
      }
    };
  }

  return { mount, avatarHtml, esc };
})();
window.ChatWidget = ChatWidget;
