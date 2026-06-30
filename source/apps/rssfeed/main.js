// mvmOS App: RSS Reader v1.0.0

const _rssi18n = {
  en: {
    title:          'RSS Reader',
    fetch:          '↻ Fetch',
    settings:       '⚙ Settings',
    all_feeds:      'All feeds',
    unread:         'Unread',
    read:           'Read',
    all_filter:     'All',
    add_feed:       '+ Add Feed',
    no_feeds:       'No feeds yet. Add one in Settings.',
    no_articles:    'No articles.',
    back:           '← Back',
    back_list:      '← Back',
    open_original:  'Open original ↗',
    mark_all_read:  'Mark all read',
    del_feed:       'Delete',
    feed_url_ph:    'RSS / Atom URL',
    add:            'Add',
    cancel:         'Cancel',
    settings_title: 'Settings',
    feeds_title:    'Feeds',
    fetch_interval: 'Auto-fetch every',
    public_page:    'Public reading list',
    public_url:     'Public URL',
    copy:           'Copy',
    copied:         'Copied!',
    save:           'Save',
    fetching:       'Fetching…',
    feed_added:     'Feed added.',
    settings_saved: 'Settings saved.',
    min5:  '5 minutes',  min15: '15 minutes', min30: '30 minutes',
    h1:    '1 hour',     h2:    '2 hours',    h6:    '6 hours',
    h12:   '12 hours',   h24:   '24 hours',
    filter_label:   'Show:',
    source_label:   'Source:',
    just_now:       'just now',
    ago_min:        'min ago',
    ago_h:          'h ago',
    ago_d:          'd ago',
    saved:          'Saved',
    error_label:    'Error',
    fetched_label:  'Last fetched',
    public_hint:    'When enabled, anyone with the link can see your unread articles. Reading an article marks it as read.',
    ai_section:     'AI Buttons',
    ai_source_lbl:  'AI source',
    ai_off:         'Disabled',
    ai_mvmai:       'mvmAI — configured provider',
    ai_cli:         'mvmAI — Claude CLI',
    ai_btn_name_ph: 'Button name (e.g. Summarize)',
    ai_btn_prmt_ph: 'Prompt (e.g. Summarize this article in Bulgarian in 3-4 sentences.)',
    ai_add_btn:     '+ Add button',
    ai_no_btns:     'No buttons yet.',
    ai_examples:    'Examples: "Summarize in Bulgarian in 3-4 sentences." · "Translate fully to Bulgarian." · "TL;DR in English in 2 sentences."',
    ai_running:     'Working…',
    ai_result_close:'Close',
    ai_scope_lbl:   'Show in',
    ai_scope_list:  'List',
    ai_scope_reader:'Reader',
    ai_scope_both:  'Both',
  },
  bg: {
    title:          'RSS четец',
    fetch:          '↻ Обнови',
    settings:       '⚙ Настройки',
    all_feeds:      'Всички',
    unread:         'Непрочетени',
    read:           'Прочетени',
    all_filter:     'Всички',
    add_feed:       '+ Добави',
    no_feeds:       'Няма добавени източници. Добави в Настройки.',
    no_articles:    'Няма статии.',
    back:           '← Назад',
    back_list:      '← Назад',
    open_original:  'Отвори оригинала ↗',
    mark_all_read:  'Маркирай всички прочетени',
    del_feed:       'Изтрий',
    feed_url_ph:    'RSS / Atom URL',
    add:            'Добави',
    cancel:         'Отказ',
    settings_title: 'Настройки',
    feeds_title:    'Източници',
    fetch_interval: 'Проверявай на всеки',
    public_page:    'Публичен списък за четене',
    public_url:     'Публичен линк',
    copy:           'Копирай',
    copied:         'Копирано!',
    save:           'Запази',
    fetching:       'Зареждане…',
    feed_added:     'Изворът е добавен.',
    settings_saved: 'Настройките са запазени.',
    min5:  '5 минути',  min15: '15 минути', min30: '30 минути',
    h1:    '1 час',     h2:    '2 часа',    h6:    '6 часа',
    h12:   '12 часа',   h24:   '24 часа',
    filter_label:   'Покажи:',
    source_label:   'Извор:',
    just_now:       'сега',
    ago_min:        'мин. назад',
    ago_h:          'ч. назад',
    ago_d:          'д. назад',
    saved:          'Запазени',
    error_label:    'Грешка',
    fetched_label:  'Последно обновен',
    public_hint:    'При активиране всеки с линка вижда непрочетените ти статии. Отварянето на статия я маркира като прочетена.',
    ai_section:     'AI бутони',
    ai_source_lbl:  'AI провайдър',
    ai_off:         'Изключено',
    ai_mvmai:       'mvmAI — настроен провайдър',
    ai_cli:         'mvmAI — Claude CLI',
    ai_btn_name_ph: 'Наименование (напр. Резюме)',
    ai_btn_prmt_ph: 'Промпт (напр. Резюмирай на български в 3-4 изречения.)',
    ai_add_btn:     '+ Добави бутон',
    ai_no_btns:     'Няма бутони.',
    ai_examples:    'Примери: "Резюмирай на български в 3-4 изречения." · "Преведи изцяло на български." · "TL;DR на 2 изречения."',
    ai_running:     'Обработва…',
    ai_result_close:'Затвори',
    ai_scope_lbl:   'Показвай в',
    ai_scope_list:  'Списък',
    ai_scope_reader:'Reader',
    ai_scope_both:  'И двете',
  },
};
function _rsst(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_rssi18n[lang] || _rssi18n.en)[key] || key;
}

mvmOS.registerApp({
  id: 'rssfeed',
  name: 'RSS Reader',
  icon: '📰',
  category: 'Utilities',
  requires_apphub: true,
  renderSettingsExtra(container, saved) {
    const _pendingBtns = (() => {
      try { return JSON.parse(saved.ai_buttons || '[]'); } catch { return []; }
    })();
    const s = 'padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.84rem;outline:none;';

    container.innerHTML = `
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">AI Buttons</div>
        <div id="rss-se-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <input id="rss-se-name" placeholder="Button name (e.g. Summarize)" style="${s}width:100%">
          <textarea id="rss-se-prompt" placeholder="Prompt (e.g. Summarize in 3 sentences.)" rows="2"
            style="${s}width:100%;resize:vertical;font-family:inherit"></textarea>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.82rem;color:var(--text-dim)">Show in:</span>
            <select id="rss-se-scope" style="${s}width:auto">
              <option value="reader">Reader</option>
              <option value="list">List</option>
              <option value="both">Both</option>
            </select>
            <button id="rss-se-add" style="padding:5px 12px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;border:1px solid var(--accent);background:var(--accent);color:#1e1e2e">+ Add</button>
          </div>
          <div style="font-size:.72rem;color:var(--text-dim)">Examples: "Summarize in Bulgarian in 3 sentences." · "Translate to Bulgarian." · "TL;DR in 2 sentences."</div>
        </div>
      </div>`;

    const listEl = container.querySelector('#rss-se-list');

    function renderList() {
      listEl.innerHTML = _pendingBtns.length === 0
        ? `<div style="font-size:.82rem;color:var(--text-dim)">No buttons yet.</div>`
        : _pendingBtns.map((b, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px">
            <div style="flex:1;min-width:0">
              <span style="font-size:.84rem;font-weight:600">${b.name}</span>
              <span style="font-size:.72rem;color:var(--text-dim);margin-left:6px">${b.scope||'reader'}</span>
              <div style="font-size:.75rem;color:var(--text-dim);word-break:break-word">${b.prompt}</div>
            </div>
            <button data-i="${i}" style="background:none;border:none;cursor:pointer;color:#f38ba8;font-size:.8rem;padding:2px 6px;font-family:inherit">✕</button>
          </div>`).join('');
      listEl.querySelectorAll('button[data-i]').forEach(btn => {
        btn.onclick = () => {
          _pendingBtns.splice(parseInt(btn.dataset.i), 1);
          save(); renderList();
        };
      });
    }

    function save() {
      const db = mvmOS.db('rssfeed');
      db.run('INSERT OR REPLACE INTO cfg(key,value) VALUES(?,?)', ['ai_buttons', JSON.stringify(_pendingBtns)]).catch(()=>{});
      saved.ai_buttons = JSON.stringify(_pendingBtns);
    }

    container.querySelector('#rss-se-add').onclick = () => {
      const name   = container.querySelector('#rss-se-name').value.trim();
      const prompt = container.querySelector('#rss-se-prompt').value.trim();
      if (!name || !prompt) return;
      const scope  = container.querySelector('#rss-se-scope').value;
      _pendingBtns.push({ name, prompt, scope });
      container.querySelector('#rss-se-name').value   = '';
      container.querySelector('#rss-se-prompt').value = '';
      save(); renderList();
    };

    renderList();
  },
  launch() {
    mvmOS.createWindow({
      id: 'rssfeed',
      title: '📰 RSS Reader',
      width: 820,
      height: 580,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'rssfeed' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        RSS.mount(body);
      },
    });
  },
});

const RSS = (() => {
  const _t = _rsst;
  let _root;
  let _feeds = [], _articles = [], _settings = {};
  let _pubUser = null;
  let _selFeed = 0;       // 0 = all
  let _filterRead = 0;    // -1=all, 0=unread, 1=read
  let _filterSaved = false;
  let _selArticle = null;
  let _fetching = false;

  // ── API ───────────────────────────────────────────────────────────────────

  async function _api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    if (token) opts.headers['X-Pub-Token'] = token;
    const prefix = token ? '/api/apps/rssfeed/user' : '/api/apps/rssfeed';
    const r = await fetch(`${prefix}${path}`, opts);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(txt || r.statusText);
    }
    return r.json();
  }

  async function _getSettings() {
    const r = await fetch('/api/apps/rssfeed/settings');
    return r.ok ? r.json() : {};
  }

  async function _reload() {
    const q = _filterSaved
      ? `feed_id=${_selFeed}&is_saved=1`
      : `feed_id=${_selFeed}&is_read=${_filterRead}`;
    [_feeds, _articles, _settings] = await Promise.all([
      _api('GET', '/feeds'),
      _api('GET', `/articles?${q}&limit=200`),
      _getSettings(),
    ]);
  }

  async function _reloadArticles() {
    const q = _filterSaved
      ? `feed_id=${_selFeed}&is_saved=1`
      : `feed_id=${_selFeed}&is_read=${_filterRead}`;
    _articles = await _api('GET', `/articles?${q}&limit=200`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || d.innerText || '';
  }
  function _relTime(dateStr) {
    if (!dateStr) return '';
    try {
      const dt  = new Date(dateStr);
      const sec = Math.floor((Date.now() - dt.getTime()) / 1000);
      if (sec < 90)   return _t('just_now');
      if (sec < 3600) return `${Math.floor(sec/60)} ${_t('ago_min')}`;
      if (sec < 86400) return `${Math.floor(sec/3600)} ${_t('ago_h')}`;
      return `${Math.floor(sec/86400)} ${_t('ago_d')}`;
    } catch { return ''; }
  }
  function _wrap()  { return _root?.querySelector('#rss-wrap'); }
  function _btnS(type) {
    const b = 'padding:5px 11px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;';
    if (type === 'primary')   return b + 'border:none;background:var(--accent);color:#fff;';
    if (type === 'ghost')     return b + 'border:1px solid var(--border);background:transparent;color:var(--text-dim);';
    if (type === 'link')      return 'background:none;border:none;cursor:pointer;font-size:.82rem;color:var(--accent);padding:0;font-family:inherit;';
    return b + 'border:1px solid var(--border);background:var(--surface);color:var(--text);';
  }

  // ── AI ────────────────────────────────────────────────────────────────────

  async function _runAI(prompt, article) {
    const body = `${prompt}\n\n---\nTitle: ${article.title || ''}\n\n${_stripHtml(article.description || '').slice(0, 1200)}`;
    const messages = [{ role: 'user', content: body }];
    const source = _settings.ai_source || 'off';
    if (source === 'claude-cli') {
      const r = await fetch('/api/mvmai/cli-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: 'claude-cli', messages }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      return d.content || '';
    }
    const r = await fetch('/api/mvmai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, tools_enabled: false }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d.message?.content || '';
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function _render() {
    const w = _wrap();
    if (!w) return;
    _renderMain(w);
  }

  function _renderMain(w) {
    const totalUnread = _feeds.reduce((s, f) => s + (f.unread_count || 0), 0);
    const userName = _pubUser?.display_name || '';

    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-weight:700;font-size:.95rem;flex:1">${_t('title')}</span>
        ${userName ? `<span style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">${_esc(userName)}</span>` : ''}
        <button id="rss-fetch" style="${_btnS('ghost')}" title="${_t('fetch')}">${_t('fetch')}</button>
        <button id="rss-settings" style="${_btnS('ghost')}">${_t('feeds_title')}</button>
      </div>
      <div style="display:flex;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);overflow-x:auto;flex-shrink:0;scrollbar-width:none">
        ${_feedChip(0, _t('all_feeds'), totalUnread, _selFeed === 0)}
        ${_feeds.map(f => _feedChip(f.id, f.name, f.unread_count || 0, _selFeed === f.id)).join('')}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        ${_selArticle ? _readerHtml() : _listHtml()}
      </div>
    `;

    w.querySelectorAll('.rss-feed-chip').forEach(el => {
      el.onclick = async () => {
        _selFeed    = parseInt(el.dataset.id);
        _selArticle = null;
        await _reloadArticles();
        _render();
      };
    });

    w.querySelector('#rss-fetch').onclick = _doFetch;
    w.querySelector('#rss-settings').onclick = () => _showSettingsModal(w);

    if (_selArticle) _bindReader(w);
    else _bindList(w);
  }

  function _feedChip(id, name, unread, selected) {
    const base = 'border-radius:20px;padding:4px 12px;font-size:.78rem;cursor:pointer;white-space:nowrap;border:1px solid;flex-shrink:0;font-family:inherit;';
    const style = selected
      ? base + 'background:var(--accent);color:#1e1e2e;border-color:var(--accent);font-weight:600'
      : base + 'background:transparent;color:var(--text-dim);border-color:var(--border)';
    const cnt = unread > 0 ? ` <span style="background:${selected?'rgba(0,0,0,.2)':'var(--accent)'};color:${selected?'#1e1e2e':'#1e1e2e'};border-radius:99px;font-size:.65rem;padding:1px 5px">${unread}</span>` : '';
    return `<button class="rss-feed-chip" data-id="${id}" style="${style}">${_esc(name)}${cnt}</button>`;
  }

  function _showSettingsModal(w) {
    w.style.position = 'relative';
    const overlay = document.createElement('div');
    overlay.id = 'rss-modal';
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;width:100%;max-width:420px;max-height:calc(100% - 32px);overflow-y:auto';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;font-size:.95rem;flex:1">${_t('feeds_title')}</span>
        <button id="rss-modal-close" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-dim);padding:2px 6px;font-family:inherit">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:16px">
        <div>
          <div id="rss-feeds-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="rss-add-url" placeholder="${_t('feed_url_ph')}" style="flex:1;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.84rem;outline:none">
            <button id="rss-add-btn" style="padding:6px 12px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;border:1px solid var(--accent);background:var(--accent);color:#1e1e2e;white-space:nowrap">${_t('add')}</button>
          </div>
          <div id="rss-add-err" style="color:#f38ba8;font-size:.78rem;margin-top:4px;min-height:16px"></div>
        </div>
      </div>`;

    function renderFeedsList() {
      const list = panel.querySelector('#rss-feeds-list');
      if (!_feeds.length) {
        list.innerHTML = `<div style="font-size:.82rem;color:var(--text-dim)">${_t('no_feeds')}</div>`;
        return;
      }
      list.innerHTML = _feeds.map(f => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(f.name)}</span>
          ${f.unread_count ? `<span style="font-size:.7rem;color:var(--accent)">${f.unread_count} unread</span>` : ''}
          <button class="rss-del-feed" data-id="${f.id}"
            style="background:none;border:none;cursor:pointer;color:#f38ba8;font-size:.78rem;padding:2px 6px;border-radius:4px;font-family:inherit">${_t('del_feed')}</button>
        </div>`).join('');
      list.querySelectorAll('.rss-del-feed').forEach(btn => {
        btn.onclick = async () => {
          await _api('DELETE', `/feeds/${btn.dataset.id}`).catch(()=>{});
          await _reload();
          if (_selFeed == btn.dataset.id) _selFeed = 0;
          renderFeedsList();
          _render();
        };
      });
    }
    renderFeedsList();

    panel.querySelector('#rss-modal-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    const addBtn = panel.querySelector('#rss-add-btn');
    const addErr = panel.querySelector('#rss-add-err');
    addBtn.onclick = async () => {
      const url = panel.querySelector('#rss-add-url').value.trim();
      if (!url) return;
      addBtn.disabled = true; addErr.textContent = '';
      try {
        await _api('POST', '/feeds', { url });
        panel.querySelector('#rss-add-url').value = '';
        await _reload();
        renderFeedsList();
        _render();
      } catch(e) {
        addErr.textContent = String(e).replace(/^Error:\s*/,'');
      }
      addBtn.disabled = false;
    };
    panel.querySelector('#rss-add-url').onkeydown = e => { if (e.key==='Enter') addBtn.click(); };

    overlay.appendChild(panel);
    w.appendChild(overlay);
  }

  // ── Article list ──────────────────────────────────────────────────────────

  function _listHtml() {
    const aiSource = _settings.ai_source || 'off';
    let _allAiBtns = [];
    if (aiSource !== 'off') { try { _allAiBtns = JSON.parse(_settings.ai_buttons || '[]'); } catch {} }
    const listBtns = _allAiBtns.filter(b => (b.scope||'reader') === 'list' || b.scope === 'both');
    const filters = [
      { v: -1,      saved: false, lbl: _t('all_filter') },
      { v: 0,       saved: false, lbl: _t('unread') },
      { v: 1,       saved: false, lbl: _t('read') },
      { v: -1,      saved: true,  lbl: _t('saved') },
    ];
    const filterBar = `
      <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
        <span style="font-size:.76rem;color:var(--text-dim)">${_t('filter_label')}</span>
        ${filters.map((f, fi) => {
          const active = f.saved ? _filterSaved : (!_filterSaved && _filterRead === f.v);
          return `<button class="rss-filter" data-fi="${fi}" style="${_btnS(active?'primary':'ghost')}">${f.lbl}</button>`;
        }).join('')}
        <div style="flex:1"></div>
        <button id="rss-mark-all" style="${_btnS('ghost')} font-size:.78rem">${_t('mark_all_read')}</button>
      </div>`;

    if (_articles.length === 0) {
      return filterBar + `<div style="text-align:center;color:var(--text-dim);padding:48px 16px;font-size:.85rem">${_t('no_articles')}</div>`;
    }

    const items = _articles.map(a => {
      const unread  = !a.is_read;
      const excerpt = _stripHtml(a.description || '');
      const rel     = _relTime(a.pub_date || a.fetched_at);
      const showFeed = _selFeed === 0;
      return `
        <div class="rss-art" data-id="${a.id}" style="padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s"
          onmouseenter="this.style.background='var(--surface)'"
          onmouseleave="this.style.background=''">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:6px;display:inline-block;${unread?'background:var(--accent)':''}"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.86rem;font-weight:${unread?'600':'400'};color:${unread?'var(--text)':'var(--text-dim)'};line-height:1.4;word-break:break-word">${_esc(a.title || '(no title)')}</div>
              ${excerpt ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:3px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${_esc(excerpt)}</div>` : ''}
              <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                ${showFeed ? `<span style="color:var(--accent)">${_esc(a.feed_name)}</span>` : ''}
                ${rel ? `<span>${rel}</span>` : ''}
                ${listBtns.map((b, bi) => `<button class="rss-list-ai-btn" data-aid="${a.id}" data-bi="${bi}" style="background:none;border:1px solid var(--border);border-radius:3px;padding:1px 7px;font-size:.7rem;cursor:pointer;color:var(--text-dim);font-family:inherit" onclick="event.stopPropagation()">${_esc(b.name)}</button>`).join('')}
              </div>
              <div class="rss-list-ai-result" data-aid="${a.id}" style="display:none;margin-top:7px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 10px;font-size:.78rem;line-height:1.6;white-space:pre-wrap;word-break:break-word"></div>
            </div>
            <button class="rss-star" data-id="${a.id}" onclick="event.stopPropagation()"
              style="background:none;border:none;cursor:pointer;font-size:1.05rem;padding:2px 4px;flex-shrink:0;line-height:1;color:${a.is_saved?'#f59e0b':'var(--text-dim)'}">
              ${a.is_saved ? '★' : '☆'}
            </button>
          </div>
        </div>`;
    }).join('');

    return filterBar + `<div style="flex:1;overflow-y:auto">${items}</div>`;
  }

  const _filterDefs = [
    { v: -1, saved: false },
    { v: 0,  saved: false },
    { v: 1,  saved: false },
    { v: -1, saved: true  },
  ];

  function _bindList(w) {
    w.querySelectorAll('.rss-filter').forEach(btn => {
      btn.onclick = async () => {
        const f = _filterDefs[parseInt(btn.dataset.fi)];
        _filterSaved = f.saved;
        _filterRead  = f.v;
        await _reloadArticles();
        _render();
      };
    });

    w.querySelectorAll('.rss-star').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const res = await _api('POST', `/articles/${id}/save`).catch(() => null);
        if (!res) return;
        const a = _articles.find(x => x.id === id);
        if (a) a.is_saved = res.is_saved;
        btn.textContent = res.is_saved ? '★' : '☆';
        btn.style.color = res.is_saved ? '#f59e0b' : 'var(--text-dim)';
        if (_filterSaved && !res.is_saved) {
          _articles = _articles.filter(x => x.id !== id);
          _render();
        }
      };
    });
    w.querySelectorAll('.rss-art').forEach(el => {
      el.onclick = async () => {
        const id = parseInt(el.dataset.id);
        _selArticle = _articles.find(a => a.id === id) || null;
        if (_selArticle && !_selArticle.is_read) {
          await _api('POST', `/articles/${id}/read`).catch(() => {});
          _selArticle.is_read = 1;
          const feed = _feeds.find(f => f.id === _selArticle.feed_id);
          if (feed && feed.unread_count > 0) feed.unread_count--;
        }
        _render();
      };
    });
    // List AI buttons
    let _allAiBtns2 = [];
    try { _allAiBtns2 = JSON.parse(_settings.ai_buttons || '[]'); } catch {}
    const _listBtns2 = _allAiBtns2.filter(b => (b.scope||'reader') === 'list' || b.scope === 'both');
    w.querySelectorAll('.rss-list-ai-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const aid = parseInt(btn.dataset.aid);
        const bi  = parseInt(btn.dataset.bi);
        const b   = _listBtns2[bi];
        if (!b) return;
        const a   = _articles.find(x => x.id === aid);
        if (!a) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = _t('ai_running');
        const resultEl = w.querySelector(`.rss-list-ai-result[data-aid="${aid}"]`);
        try {
          const text = await _runAI(b.prompt, { title: a.title, description: _stripHtml(a.description || '').slice(0, 150) });
          if (resultEl) { resultEl.textContent = text; resultEl.style.display = ''; }
        } catch (err) {
          if (resultEl) { resultEl.textContent = String(err); resultEl.style.display = ''; }
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      };
    });

    const mAll = w.querySelector('#rss-mark-all');
    if (mAll) mAll.onclick = async () => {
      await _api('POST', '/articles/read-all', { feed_id: _selFeed }).catch(() => {});
      await _reload();
      _selArticle = null;
      _render();
    };
  }

  // ── Reader ────────────────────────────────────────────────────────────────

  function _readerHtml() {
    const a   = _selArticle;
    const rel = _relTime(a.pub_date || a.fetched_at);
    const aiSource = _settings.ai_source || 'off';
    let aiButtons = [];
    if (aiSource !== 'off') {
      try {
        const all = JSON.parse(_settings.ai_buttons || '[]');
        aiButtons = all.filter(b => (b.scope||'reader') === 'reader' || b.scope === 'both');
      } catch {}
    }
    const aiRow = aiButtons.length > 0 ? `
      <div id="rss-ai-btns" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        ${aiButtons.map((b, i) => `<button class="rss-ai-btn" data-i="${i}" style="${_btnS('ghost')} font-size:.78rem;padding:4px 10px">${_esc(b.name)}</button>`).join('')}
      </div>
      <div id="rss-ai-result" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:.84rem;line-height:1.7">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span id="rss-ai-result-label" style="font-size:.72rem;font-weight:600;color:var(--accent)"></span>
          <button id="rss-ai-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:0;font-family:inherit">${_t('ai_result_close')}</button>
        </div>
        <div id="rss-ai-result-text" style="white-space:pre-wrap;word-break:break-word"></div>
      </div>` : '';
    return `
      <div style="flex:1;overflow-y:auto;padding:20px 22px">
        <div style="margin-bottom:14px">
          <button id="rss-back-list" style="${_btnS('ghost')}">${_t('back_list')}</button>
        </div>
        <div style="font-size:.72rem;color:var(--accent);margin-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>${_esc(a.feed_name || '')}</span>
          ${rel ? `<span style="color:var(--text-dim)">${rel}</span>` : ''}
        </div>
        <h2 style="font-size:1rem;font-weight:700;line-height:1.45;margin-bottom:14px;word-break:break-word">${_esc(a.title || '(no title)')}</h2>
        ${aiRow}
        <div id="rss-content" style="font-size:.86rem;line-height:1.7;color:var(--text);word-break:break-word;max-width:640px">
          ${a.description || '<span style="color:var(--text-dim)">—</span>'}
        </div>
        ${a.link ? `
        <div style="margin-top:20px">
          <a href="${_esc(a.link)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:.84rem;text-decoration:none">${_t('open_original')}</a>
        </div>` : ''}
      </div>`;
  }

  function _bindReader(w) {
    w.querySelector('#rss-back-list').onclick = () => {
      _selArticle = null;
      _render();
    };
    w.querySelectorAll('.rss-ai-btn').forEach(btn => {
      btn.onclick = async () => {
        let aiButtons = [];
        try { aiButtons = JSON.parse(_settings.ai_buttons || '[]'); } catch {}
        const b = aiButtons[parseInt(btn.dataset.i)];
        if (!b) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = _t('ai_running');
        try {
          const text = await _runAI(b.prompt, _selArticle);
          const box   = w.querySelector('#rss-ai-result');
          w.querySelector('#rss-ai-result-label').textContent = b.name;
          w.querySelector('#rss-ai-result-text').textContent  = text;
          box.style.display = '';
        } catch (e) {
          mvmOS.notify('RSS Reader', String(e));
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      };
    });
    const closeBtn = w.querySelector('#rss-ai-close');
    if (closeBtn) closeBtn.onclick = () => { w.querySelector('#rss-ai-result').style.display = 'none'; };
  }

  // ── Fetch now ─────────────────────────────────────────────────────────────

  async function _doFetch() {
    if (_fetching) return;
    _fetching = true;
    const btn = _wrap()?.querySelector('#rss-fetch');
    if (btn) btn.textContent = _t('fetching');
    try {
      await _api('POST', '/fetch');
      await _reload();
      _selArticle = null;
      _render();
    } catch (e) {
      mvmOS.notify('RSS Reader', String(e));
    } finally {
      _fetching = false;
    }
  }

  function _renderAiBtnList(container, btns, onDelete) {
    container.innerHTML = btns.length === 0
      ? `<div style="font-size:.8rem;color:var(--text-dim)">${_t('ai_no_btns')}</div>`
      : btns.map((b, i) => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.84rem;font-weight:600">${_esc(b.name)} <span style="font-size:.7rem;color:var(--text-dim);font-weight:400">${_t('ai_scope_' + (b.scope||'reader'))}</span></div>
            <div style="font-size:.75rem;color:var(--text-dim);margin-top:2px;word-break:break-word">${_esc(b.prompt)}</div>
          </div>
          <button class="rss-ai-del" data-i="${i}" style="${_btnS('ghost')} font-size:.73rem;padding:3px 8px;flex-shrink:0">${_t('del_feed')}</button>
        </div>`).join('');
    container.querySelectorAll('.rss-ai-del').forEach(btn => {
      btn.onclick = async () => {
        _pendingAiButtons.splice(parseInt(btn.dataset.i), 1);
        _renderAiBtnList(container, _pendingAiButtons, onDelete);
        if (onDelete) await onDelete();
      };
    });
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function mount(root) {
    _root = root;
    root.innerHTML = `<div id="rss-wrap" style="display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);font-family:inherit;overflow:hidden"></div>`;

    const _start = async () => {
      if (typeof AppHub !== 'undefined') {
        const t = AppHub.getToken();
        if (t) {
          const u = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': t } })
            .then(r => r.ok ? r.json() : null).catch(() => null);
          _pubUser = u;
        }
      }
      await _reload();
      _render();
      if (_feeds.length > 0 && _feeds.some(f => !f.last_fetched)) {
        _doFetch();
      }
    };

    _start().catch(e => {
      const w = _wrap();
      if (w) w.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${String(e)}</div>`;
    });
  }

  return { mount };
})();
