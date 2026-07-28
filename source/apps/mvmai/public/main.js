// mvmOS App: mvmAI v0.1.0 — AI chat with shell access
const _MVMAI_MODELS = {
  gemini:     ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-pro-preview-06-05'],
  openai:     ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
  groq:       ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  deepseek:   ['deepseek-chat', 'deepseek-reasoner'],
  qwen:       ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long', 'qwen2.5-72b-instruct'],
  mistral:    ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'codestral-latest'],
  openrouter: [], ollama: [], custom: [],
};
const _mvmai18n = {
  en: {
    title: 'mvmAI', new_chat: '+ New chat', no_sessions: 'No conversations yet',
    placeholder: 'Message mvmAI…  (Shift+Enter for newline)', send: 'Send', stop: 'Stop',
    thinking: 'Thinking…', running: 'Running command…',
    welcome_title: 'mvmAI', welcome_sub: 'Ask anything. I can run commands on this server for you.',
    no_provider: 'No provider configured. Open ⚙ Settings, pick a provider and enter your API key.',
    open_settings: '⚙ Settings', settings_btn: '⚙', rename: 'Rename', delete: 'Delete',
    del_confirm: 'Delete this conversation?', cmd_label: 'Command', reason_label: 'Reason',
    run_q: 'Run this command?', run_yes: 'Run', run_no: 'Skip', output: 'Output', exit_code: 'exit',
    blocked: '⛔ Blocked', cancelled: 'Skipped by user', dangerous: '⚠ dangerous',
    confirm_always: 'Ask before every command', confirm_dangerous: 'Ask only for dangerous commands',
    confirm_never: 'Run without asking', err: 'Error',
    provider: 'Provider', api_key: 'API key', model: 'Model (leave empty for default)',
    base_url: 'Custom base URL (only for Custom provider)', confirm_mode: 'Command confirmation',
    allow_dangerous: 'Allow dangerous commands (rm -rf, dd, shutdown…)', system_prompt: 'System prompt',
    sett_hint: 'Everything stays inside mvmOS — the API key is stored on the server and never leaves it.',
  },
  bg: {
    title: 'mvmAI', new_chat: '+ Нов чат', no_sessions: 'Все още няма разговори',
    placeholder: 'Съобщение до mvmAI…  (Shift+Enter за нов ред)', send: 'Изпрати', stop: 'Спри',
    thinking: 'Мисля…', running: 'Изпълнявам команда…',
    welcome_title: 'mvmAI', welcome_sub: 'Питай каквото поискаш. Мога да изпълнявам команди на този сървър вместо теб.',
    no_provider: 'Няма конфигуриран провайдър. Отвори ⚙ Настройки, избери провайдър и въведи API ключ.',
    open_settings: '⚙ Настройки', settings_btn: '⚙', rename: 'Преименувай', delete: 'Изтрий',
    del_confirm: 'Изтриване на този разговор?', cmd_label: 'Команда', reason_label: 'Причина',
    run_q: 'Да изпълня ли тази команда?', run_yes: 'Изпълни', run_no: 'Пропусни', output: 'Резултат', exit_code: 'изход',
    blocked: '⛔ Блокирана', cancelled: 'Пропусната от потребителя', dangerous: '⚠ опасна',
    confirm_always: 'Питай преди всяка команда', confirm_dangerous: 'Питай само за опасни команди',
    confirm_never: 'Изпълнявай без да питаш', err: 'Грешка',
    provider: 'Провайдър', api_key: 'API ключ', model: 'Модел (празно = по подразбиране)',
    base_url: 'Custom base URL (само за Custom провайдър)', confirm_mode: 'Потвърждение на команди',
    allow_dangerous: 'Разреши опасни команди (rm -rf, dd, shutdown…)', system_prompt: 'Системен prompt',
    sett_hint: 'Всичко остава вътре в mvmOS — API ключът се пази на сървъра и никога не го напуска.',
  },
};
function _ait(key) { const lang = window.mvmOS?.lang || 'en'; return (_mvmai18n[lang] || _mvmai18n.en)[key] || key; }

const _DEFAULT_PROMPT =
  'You are mvmAI, an assistant embedded in mvmOS running on a Linux server. ' +
  'You can run shell commands via the run_command tool; commands run with the privileges of the logged-in mvmOS user. ' +
  'Inspect before you modify, prefer non-destructive commands, and explain what you do in plain language. ' +
  'Be concise. When a command output answers the question, summarize it for the user instead of dumping raw text.';

mvmOS.registerApp({
  id: 'mvmai',
  name: _ait('title'),
  icon: '🤖',
  trayable: true,
  settings: [],
  async renderSettingsExtra(wrap, saved) {
    const isBg = (window.mvmOS?.lang || 'en') === 'bg';
    const _MODELS = _MVMAI_MODELS;
    const NO_KEY = ['ollama'];
    const savedProvider = saved?.provider || 'gemini';
    const savedModel    = saved?.model    || '';

    function _savedKey(p) {
      return saved?.[`api_key_${p}`] ?? (p === savedProvider ? saved?.api_key || '' : '');
    }

    const _row = (c) => `<div style="display:flex;flex-direction:column;gap:4px">${c}</div>`;
    const _lbl = (t) => `<label style="font-size:.8rem;color:var(--text-dim)">${t}</label>`;

    // load CLI providers from backend
    let cliProviders = [];
    try {
      const r = await fetch('/api/mvmai/cli-providers');
      cliProviders = (await r.json()).cli_providers || [];
    } catch(_) {}

    // build provider options: CLI first (if any), then separator, then API
    const apiOptions = [
      { value: 'gemini',     label: 'Google Gemini' },
      { value: 'openai',     label: 'OpenAI' },
      { value: 'groq',       label: 'Groq' },
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'deepseek',   label: 'DeepSeek' },
      { value: 'qwen',       label: 'Qwen (DashScope)' },
      { value: 'mistral',    label: 'Mistral' },
      { value: 'ollama',     label: 'Ollama (local)' },
      { value: 'custom',     label: 'Custom' },
    ];

    let providerOptionsHtml = '';
    if (cliProviders.length) {
      providerOptionsHtml += `<optgroup label="${isBg ? 'Инсталирани CLI' : 'Installed CLI'}">`;
      cliProviders.forEach(p => {
        providerOptionsHtml += `<option value="${p.id}" ${savedProvider === p.id ? 'selected' : ''}>${p.name}</option>`;
      });
      providerOptionsHtml += `</optgroup><optgroup label="${isBg ? 'С API ключ' : 'With API key'}">`;
      apiOptions.forEach(p => {
        providerOptionsHtml += `<option value="${p.value}" ${savedProvider === p.value ? 'selected' : ''}>${p.label}</option>`;
      });
      providerOptionsHtml += `</optgroup>`;
    } else {
      apiOptions.forEach(p => {
        providerOptionsHtml += `<option value="${p.value}" ${savedProvider === p.value ? 'selected' : ''}>${p.label}</option>`;
      });
    }

    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:4px';
    wrap.innerHTML = `
      ${_row(`${_lbl(isBg ? 'Провайдър' : 'Provider')}
        <select id="mvmai-provider-sel" class="s-input">${providerOptionsHtml}</select>`)}
      <div id="mvmai-key-row">
        ${_row(`${_lbl(isBg ? 'API ключ' : 'API key')}
          <input id="mvmai-key-inp" type="password" class="s-input" autocomplete="new-password">`)}
      </div>
      ${_row(`${_lbl(isBg ? 'Модел' : 'Model')}
        <select id="mvmai-model-sel" class="s-input"></select>
        <div id="mvmai-models-status" style="font-size:.75rem;color:var(--text-dim);min-height:1.2em"></div>`)}
      <div id="mvmai-baseurl-row" style="display:none;flex-direction:column;gap:4px">
        ${_lbl(isBg ? 'Base URL (само за Custom)' : 'Base URL (Custom provider only)')}
        <input id="mvmai-baseurl-inp" type="text" class="s-input" value="${saved?.base_url || ''}">
      </div>
      ${_row(`${_lbl(isBg ? 'Потвърждение на команди' : 'Command confirmation')}
        <select id="mvmai-confirm-sel" class="s-input">
          <option value="always"    ${(saved?.confirm_mode||'always')==='always'    ? 'selected' : ''}>${isBg ? 'Питай преди всяка команда' : 'Ask before every command'}</option>
          <option value="dangerous" ${saved?.confirm_mode==='dangerous' ? 'selected' : ''}>${isBg ? 'Питай само за опасни' : 'Ask only for dangerous commands'}</option>
          <option value="never"     ${saved?.confirm_mode==='never'     ? 'selected' : ''}>${isBg ? 'Изпълнявай без да питаш' : 'Run without asking'}</option>
        </select>`)}
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="mvmai-danger-chk" ${saved?.allow_dangerous ? 'checked' : ''}>
        ${isBg ? 'Разреши опасни команди (rm -rf, dd, shutdown…)' : 'Allow dangerous commands (rm -rf, dd, shutdown…)'}
      </label>
      ${_row(`${_lbl(isBg ? 'Системен prompt' : 'System prompt')}
        <input id="mvmai-sysprompt-inp" type="text" class="s-input" value="${(saved?.system_prompt || '').replace(/"/g, '&quot;')}">`)}
      <div style="font-size:.74rem;color:var(--text-dim)">${_ait('sett_hint')}</div>`;

    const provSel    = wrap.querySelector('#mvmai-provider-sel');
    const keyRow     = wrap.querySelector('#mvmai-key-row');
    const keyInp     = wrap.querySelector('#mvmai-key-inp');
    const sel        = wrap.querySelector('#mvmai-model-sel');
    const status     = wrap.querySelector('#mvmai-models-status');
    const baseUrlRow = wrap.querySelector('#mvmai-baseurl-row');
    const baseUrlInp = wrap.querySelector('#mvmai-baseurl-inp');

    function _isCli(p) { return p.endsWith('-cli'); }
    function _isFetch(p) { return (_MODELS[p]?.length === 0); }

    function _fillModelSelect(models, current) {
      sel.innerHTML = `<option value="">${isBg ? '(по подразбиране)' : '(provider default)'}</option>`;
      const all = (current && !models.includes(current)) ? [current, ...models] : models;
      all.forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        if (m === current) o.selected = true;
        sel.appendChild(o);
      });
      if (!current) sel.value = '';
    }

    async function _updateForProvider(provider, current) {
      const cli = _isCli(provider);
      keyRow.style.display     = (cli || NO_KEY.includes(provider)) ? 'none' : '';
      keyInp.value             = cli ? '' : _savedKey(provider);
      baseUrlRow.style.display = (!cli && ['ollama','custom'].includes(provider)) ? 'flex' : 'none';
      sel.closest('div').style.display = cli ? 'none' : '';
      status.textContent = '';
      if (cli) return;

      if (!_isFetch(provider)) {
        _fillModelSelect(_MODELS[provider], current || '');
        return;
      }
      sel.innerHTML = `<option value="">${isBg ? 'Зарежда…' : 'Loading…'}</option>`;
      try {
        const res = await fetch('/api/mvmai/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, api_key: keyInp.value || _savedKey(provider), base_url: baseUrlInp?.value || saved?.base_url || '' }),
        });
        const d = await res.json();
        if (d.error) { sel.innerHTML = `<option value="">${isBg ? '(грешка)' : '(error)'}</option>`; status.style.color='#e25555'; status.textContent=d.error.slice(0,120); return; }
        _fillModelSelect(d.models, current || '');
        status.textContent = `${d.models.length} ${isBg ? 'модела' : 'models'}`;
      } catch(e) { sel.innerHTML = `<option value="">(error)</option>`; status.style.color='#e25555'; status.textContent=e.message; }
    }

    _updateForProvider(savedProvider, savedModel);
    provSel.addEventListener('change', () => _updateForProvider(provSel.value, ''));
  },

  saveSettingsExtra(panel) {
    const provider    = panel.querySelector('#mvmai-provider-sel')?.value || 'gemini';
    const keyInp      = panel.querySelector('#mvmai-key-inp');
    const baseUrlInp  = panel.querySelector('#mvmai-baseurl-inp');
    const confirmSel  = panel.querySelector('#mvmai-confirm-sel');
    const dangerChk   = panel.querySelector('#mvmai-danger-chk');
    const promptInp   = panel.querySelector('#mvmai-sysprompt-inp');
    const db = mvmOS.db('mvmai');
    const s = (k, v) => db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [k, JSON.stringify(v)]);
    const saves = [s('provider', provider)];
    const modelVal = panel.querySelector('#mvmai-model-sel')?.value.trim();
    if (modelVal !== undefined) saves.push(s('model', modelVal));
    if (keyInp)     saves.push(s(`api_key_${provider}`,  keyInp.value.trim()));
    if (baseUrlInp) saves.push(s('base_url',             baseUrlInp.value.trim()));
    if (confirmSel) saves.push(s('confirm_mode',         confirmSel.value));
    if (dangerChk)  saves.push(s('allow_dangerous',      dangerChk.checked));
    if (promptInp)  saves.push(s('system_prompt',        promptInp.value.trim()));
    return Promise.all(saves);
  },
  launch() {
    mvmOS.createWindow({
      id: 'mvmai',
      title: '🤖 ' + _ait('title'),
      icon: '🤖',
      width: 980,
      height: 640,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'mvmai' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => AI.mount(body));
      },
    });
  },
});

// ── Core ────────────────────────────────────────────────────────────────────────
const AI = (() => {
  const _db = mvmOS.db('mvmai');
  let _root = null;
  let _sessionId = null;
  let _busy = false;
  let _cfg = {};

  function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── tiny markdown renderer ──────────────────────────────────────────────────
  function _md(src) {
    const blocks = [];
    let text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre class="mvmai-code"><code>${_esc(code.replace(/\n$/, ''))}</code></pre>`);
      return ` ${blocks.length - 1} `;
    });
    text = _esc(text);
    text = text.replace(/`([^`]+)`/g, '<code class="mvmai-inline">$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h3>$1</h3>');
    text = text.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`).replace(/<\/ul>\s*<ul>/g, '');
    text = text.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    text = text.replace(/ (\d+) /g, (_, i) => blocks[+i]);
    return text;
  }

  async function _api(path, body) {
    const res = await fetch('/api/mvmai' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  }

  // ── DB helpers ────────────────────────────────────────────────────────────────
  const _PROVIDER_NAMES = {
    gemini: 'Gemini', openai: 'OpenAI', groq: 'Groq', openrouter: 'OpenRouter',
    deepseek: 'DeepSeek', qwen: 'Qwen', mistral: 'Mistral', ollama: 'Ollama', custom: 'Custom',
    'claude-cli': 'Claude CLI', 'gemini-cli': 'Gemini CLI', 'ollama-cli': 'Ollama CLI',
    'sgpt-cli': 'shell-gpt', 'aichat-cli': 'aichat', 'llm-cli': 'llm', 'gpt4all-cli': 'GPT4All CLI',
  };

  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    const cfg = {};
    rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch (_) { cfg[r.key] = r.value; } });
    _cfg = cfg;
    _updatePlaceholder();
    _updateModelSelect();
    return cfg;
  }

  async function _updateModelSelect() {
    const sel = _root?.querySelector('.mvmai-model-quick');
    if (!sel) return;
    const provider = _cfg.provider || 'gemini';
    if (provider.endsWith('-cli')) { sel.style.display = 'none'; return; }
    sel.style.display = '';
    const current  = _cfg.model || '';
    let models = _MVMAI_MODELS[provider] || [];

    if (models.length === 0) {
      // fetch-based provider — load from API (uses saved key from DB)
      sel.innerHTML = `<option value="">${window.mvmOS?.lang === 'bg' ? 'Зарежда…' : 'Loading…'}</option>`;
      try {
        const res = await fetch('/api/mvmai/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        });
        const d = await res.json();
        models = d.error ? [] : (d.models || []);
      } catch(_) { models = []; }
    }

    sel.innerHTML = `<option value="">${window.mvmOS?.lang === 'bg' ? '(по подразбиране)' : '(default)'}</option>`;
    const all = (current && !models.includes(current)) ? [current, ...models] : models;
    all.forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      if (m === current) o.selected = true;
      sel.appendChild(o);
    });
    if (!current) sel.value = '';
  }

  function _updatePlaceholder() {
    const ta = _root?.querySelector('.mvmai-input textarea');
    if (!ta) return;
    const providerName = _PROVIDER_NAMES[_cfg.provider] || _cfg.provider || 'AI';
    const label = (_cfg.model && !_cfg.provider?.endsWith('-cli')) ? _cfg.model : providerName;
    ta.placeholder = `Message ${label}…  (Shift+Enter ${window.mvmOS?.lang === 'bg' ? 'за нов ред' : 'for newline'})`;
  }
  async function _listSessions() {
    return _db.query('SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC');
  }
  async function _loadMessages(sid, { forDisplay = false } = {}) {
    const rows = await _db.query('SELECT role, content FROM messages WHERE session_id=? ORDER BY id', [sid]);
    const all = rows.map(r => { try { return JSON.parse(r.content); } catch (_) { return { role: r.role, content: r.content }; } });
    if (forDisplay) return all.filter(m => m.role !== 'summary');
    // for model: one summary (if exists) + last 20 non-summary messages
    const summary = all.find(m => m.role === 'summary');
    const nonSummary = all.filter(m => m.role !== 'summary');
    const recent = nonSummary.slice(-20);
    return [...(summary ? [summary] : []), ...recent];
  }

  const _COMPACT_THRESHOLD = 40;

  async function _maybeCompact(sid) {
    const rows = await _db.query('SELECT id, role, content FROM messages WHERE session_id=? ORDER BY id', [sid]);
    const all = rows.map(r => { let msg; try { msg = JSON.parse(r.content); } catch (_) { msg = { role: r.role, content: r.content }; } return { _rowId: r.id, ...msg }; });
    const prevSummary = all.find(m => m.role === 'summary');
    const nonSummary = all.filter(m => m.role !== 'summary');
    if (nonSummary.length < _COMPACT_THRESHOLD) return;
    const toSummarize = nonSummary.slice(0, nonSummary.length - 20);
    if (!toSummarize.length) return;

    const prevText = prevSummary?.content || null;
    const historyLines = toSummarize
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const compactInstruction = prevText
      ? `Here is the previous summary:\n${prevText}\n\nHere is the new conversation to add to it:\n${historyLines}\n\nWrite an updated single summary covering everything. Be concise but include key topics, decisions, and context.`
      : `Summarize this conversation concisely. Include key topics, decisions, and important context:\n${historyLines}`;

    const summaryPrompt = [
      _systemMsg(),
      { role: 'user', content: compactInstruction },
    ];

    let summaryText = null;
    try {
      if (_cfg.provider?.endsWith('-cli')) {
        const res = await fetch('/api/mvmai/cli-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: _cfg.provider, messages: summaryPrompt }),
        });
        const d = await res.json();
        summaryText = d.content || null;
      } else {
        const res = await _api('/chat', { messages: summaryPrompt, tools_enabled: false });
        summaryText = res.message?.content || null;
      }
    } catch(_) {}

    if (!summaryText) return;
    if (prevSummary) await _db.run('DELETE FROM messages WHERE id=?', [prevSummary._rowId]);
    await _saveMessage(sid, { role: 'summary', content: summaryText });
  }
  async function _saveMessage(sid, msg) {
    const now = Math.floor(Date.now() / 1000);
    await _db.run('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)',
      [sid, msg.role, JSON.stringify(msg), now]);
    await _db.run('UPDATE sessions SET updated_at=? WHERE id=?', [now, sid]);
  }
  async function _newSession(firstText) {
    const id = 's' + Date.now() + Math.random().toString(36).slice(2, 6);
    const now = Math.floor(Date.now() / 1000);
    const title = (firstText || 'New chat').trim().slice(0, 42) || 'New chat';
    await _db.run('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)', [id, title, now, now]);
    return id;
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  function _msgEl() { return _root.querySelector('.mvmai-messages'); }
  function _scroll() { const m = _msgEl(); if (m) m.scrollTop = m.scrollHeight; }

  function _addBubble(role, html) {
    const el = document.createElement('div');
    el.className = 'mvmai-msg mvmai-' + role;
    el.innerHTML = `<div class="mvmai-bubble">${html}</div>`;
    _msgEl().appendChild(el);
    _scroll();
    return el;
  }

  function _addCommandCard(command, reason) {
    const el = document.createElement('div');
    el.className = 'mvmai-msg mvmai-tool';
    el.innerHTML = `
      <div class="mvmai-cmdcard">
        <div class="mvmai-cmd-head"><span class="mvmai-cmd-tag">⌨ ${_ait('cmd_label')}</span>${reason ? `<span class="mvmai-cmd-reason">${_esc(reason)}</span>` : ''}</div>
        <pre class="mvmai-code mvmai-cmd"><code>${_esc(command)}</code></pre>
        <div class="mvmai-cmd-actions"></div>
        <div class="mvmai-cmd-output"></div>
      </div>`;
    _msgEl().appendChild(el);
    _scroll();
    return el;
  }

  function _renderOutput(card, result) {
    const out = card.querySelector('.mvmai-cmd-output');
    if (result.blocked) {
      out.innerHTML = `<div class="mvmai-blocked">${_ait('blocked')} — ${_esc(result.reason || '')}</div>`;
    } else if (result.cancelled) {
      out.innerHTML = `<div class="mvmai-blocked">${_ait('cancelled')}</div>`;
    } else {
      const parts = [];
      if (result.stdout) parts.push(`<pre class="mvmai-code"><code>${_esc(result.stdout)}</code></pre>`);
      if (result.stderr) parts.push(`<pre class="mvmai-code mvmai-stderr"><code>${_esc(result.stderr)}</code></pre>`);
      const codeBadge = `<span class="mvmai-exit ${result.code === 0 ? 'ok' : 'bad'}">${_ait('exit_code')} ${result.code}</span>`;
      out.innerHTML = `<div class="mvmai-out-head">${_ait('output')} ${codeBadge}</div>${parts.join('') || '<div class="mvmai-empty">∅</div>'}`;
    }
    _scroll();
  }

  // ── command execution with confirmation UI ────────────────────────────────────
  function _execWithUI(command, reason) {
    return new Promise(async (resolve) => {
      const card = _addCommandCard(command, reason);
      const first = await _api('/exec', { command, confirmed: false });
      if (first.blocked) { _renderOutput(card, first); return resolve({ blocked: true, reason: first.reason }); }
      if (first.pending) {
        const actions = card.querySelector('.mvmai-cmd-actions');
        if (first.is_dangerous) actions.innerHTML = `<span class="mvmai-danger">${_ait('dangerous')}</span>`;
        const yes = document.createElement('button'); yes.className = 's-btn s-btn-sm mvmai-run-yes'; yes.textContent = _ait('run_yes');
        const no = document.createElement('button'); no.className = 's-btn s-btn-sm'; no.textContent = _ait('run_no');
        actions.appendChild(yes); actions.appendChild(no);
        yes.addEventListener('click', async () => {
          actions.innerHTML = `<span class="mvmai-running">${_ait('running')}</span>`;
          const r = await _api('/exec', { command, confirmed: true });
          actions.innerHTML = '';
          _renderOutput(card, r);
          resolve(r);
        });
        no.addEventListener('click', () => { actions.innerHTML = ''; _renderOutput(card, { cancelled: true }); resolve({ cancelled: true }); });
        return; // wait for user
      }
      // ran immediately
      _renderOutput(card, first);
      resolve(first);
    });
  }

  // ── conversation turn ──────────────────────────────────────────────────────────
  function _systemMsg() {
    return { role: 'system', content: (_cfg.system_prompt && String(_cfg.system_prompt).trim()) || _DEFAULT_PROMPT };
  }

  async function _runTurnCli() {
    const history = await _loadMessages(_sessionId);
    const msgs = [_systemMsg(), ...history];
    const status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);
    try {
      const res = await fetch('/api/mvmai/cli-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: _cfg.provider, messages: msgs }),
      });
      const d = await res.json();
      if (d.error) { status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(d.error)}</span>`; return; }
      status.querySelector('.mvmai-bubble').innerHTML = `<div class="mvmai-model-label">${_esc(_cfg.provider)}</div>` + _md(d.content || '');
      await _saveMessage(_sessionId, { role: 'assistant', content: d.content || '', _model: _cfg.provider });
      await _maybeCompact(_sessionId);
    } catch(e) {
      status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(e.message)}</span>`;
    }
    _scroll();
  }

  async function _runTurn() {
    if (_cfg.provider?.endsWith('-cli')) return _runTurnCli();
    const history = await _loadMessages(_sessionId);
    let apiMsgs = [_systemMsg(), ...history];
    let status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);

    for (let i = 0; i < 10; i++) {
      const res = await _api('/chat', { messages: apiMsgs });
      if (res.error) { status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(res.error)}</span>`; return; }
      const msg = res.message;
      const msgWithModel = { ...msg, _model: _cfg.model || _cfg.provider || '' };
      apiMsgs.push(msg);
      await _saveMessage(_sessionId, msgWithModel);

      if (msg.tool_calls && msg.tool_calls.length) {
        if (msg.content && msg.content.trim()) status.querySelector('.mvmai-bubble').innerHTML = _md(msg.content);
        else status.remove();
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          const result = await _execWithUI(args.command || '', args.reason || '');
          const toolMsg = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
          apiMsgs.push(toolMsg);
          await _saveMessage(_sessionId, toolMsg);
        }
        status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);
        continue;
      }
      const modelLabel = _cfg.model || _cfg.provider || '';
      if (modelLabel) {
        const bubbleEl = status.querySelector('.mvmai-bubble');
        bubbleEl.innerHTML = `<div class="mvmai-model-label">${_esc(modelLabel)}</div>` + _md(msg.content || '');
      } else {
        status.querySelector('.mvmai-bubble').innerHTML = _md(msg.content || '');
      }
      _scroll();
      await _maybeCompact(_sessionId);
      return;
    }
    status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: too many steps</span>`;
  }

  // ── send ──────────────────────────────────────────────────────────────────────
  async function _send() {
    if (_busy) return;
    const ta = _root.querySelector('.mvmai-input textarea');
    const text = ta.value.trim();
    if (!text) return;
    const isCli = _cfg.provider?.endsWith('-cli');
    if (!_cfg.provider || (!isCli && _cfg.provider !== 'ollama' && !(_cfg[`api_key_${_cfg.provider}`] || _cfg.api_key))) {
      _addBubble('assistant', `<span class="mvmai-err">${_ait('no_provider')}</span>`);
      return;
    }
    _busy = true;
    ta.value = ''; ta.style.height = 'auto';
    _root.querySelector('.mvmai-welcome')?.remove();

    if (!_sessionId) { _sessionId = await _newSession(text); await _renderSessions(); }
    _addBubble('user', _md(text));
    await _saveMessage(_sessionId, { role: 'user', content: text });

    try { await _runTurn(); }
    catch (e) { _addBubble('assistant', `<span class="mvmai-err">${_ait('err')}: ${_esc(e.message || e)}</span>`); }
    finally { _busy = false; await _renderSessions(); ta.focus(); }
  }

  // ── session rendering / loading ───────────────────────────────────────────────
  async function _renderSessions() {
    const list = _root.querySelector('.mvmai-sessions');
    const sessions = await _listSessions();
    if (!sessions.length) { list.innerHTML = `<div class="mvmai-no-sessions">${_ait('no_sessions')}</div>`; return; }
    list.innerHTML = '';
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'mvmai-session' + (s.id === _sessionId ? ' active' : '');
      row.innerHTML = `<span class="mvmai-s-title">${_esc(s.title)}</span><button class="mvmai-s-del" title="${_ait('delete')}">✕</button>`;
      row.querySelector('.mvmai-s-title').addEventListener('click', () => _openSession(s.id));
      row.querySelector('.mvmai-s-del').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(_ait('del_confirm'))) return;
        await _db.run('DELETE FROM messages WHERE session_id=?', [s.id]);
        await _db.run('DELETE FROM sessions WHERE id=?', [s.id]);
        if (_sessionId === s.id) { _sessionId = null; _renderChat([]); }
        _renderSessions();
      });
      list.appendChild(row);
    });
  }

  function _renderChat(history) {
    const m = _msgEl();
    m.innerHTML = '';
    if (!history.length) {
      m.innerHTML = `<div class="mvmai-welcome"><div class="mvmai-welcome-icon">🤖</div><h2>${_ait('welcome_title')}</h2><p>${_ait('welcome_sub')}</p></div>`;
      return;
    }
    // group tool results onto their command cards by tool_call_id
    const cardByCall = {};
    history.forEach(msg => {
      if (msg.role === 'user') _addBubble('user', _md(msg.content || ''));
      else if (msg.role === 'assistant') {
        if (msg.content && msg.content.trim()) {
          const label = msg._model ? `<div class="mvmai-model-label">${_esc(msg._model)}</div>` : '';
          _addBubble('assistant', label + _md(msg.content));
        }
        (msg.tool_calls || []).forEach(tc => {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          cardByCall[tc.id] = _addCommandCard(args.command || '', args.reason || '');
        });
      } else if (msg.role === 'tool') {
        const card = cardByCall[msg.tool_call_id];
        if (card) { let r = {}; try { r = JSON.parse(msg.content); } catch (_) {} _renderOutput(card, r); }
      }
    });
    _scroll();
  }

  async function _openSession(sid) {
    _sessionId = sid;
    _renderChat(await _loadMessages(sid, { forDisplay: true }));
    await _renderSessions();
    _root.querySelector('.mvmai-sidebar')?.classList.remove('mobile-open');
    _root.querySelector('.as-sidebar-overlay')?.remove();
  }

  // ── mount ───────────────────────────────────────────────────────────────────────
  async function mount(body) {
    _root = body;
    body.innerHTML = `
      <div class="mvmai-root">
        <aside class="as-sidebar mvmai-sidebar">
          <button class="s-btn mvmai-new">${_ait('new_chat')}</button>
          <select class="mvmai-model-quick" title="Model"></select>
          <div class="mvmai-sessions"></div>
        </aside>
        <main class="mvmai-main">
          <div class="mvmai-messages"></div>
          <div class="mvmai-input">
            <textarea rows="1" placeholder="${_ait('placeholder')}"></textarea>
            <button class="mvmai-send" title="${_ait('send')}">➤</button>
          </div>
        </main>
      </div>`;

    await _loadCfg();
    _updatePlaceholder();
    _renderChat([]);
    await _renderSessions();

    body.querySelector('.mvmai-new').addEventListener('click', () => { _sessionId = null; _renderChat([]); _renderSessions(); body.querySelector('textarea').focus(); });

    const ta = body.querySelector('textarea');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); } });
    body.querySelector('.mvmai-send').addEventListener('click', _send);

    body.querySelector('.mvmai-model-quick').addEventListener('change', async e => {
      const model = e.target.value;
      _cfg.model = model;
      _updatePlaceholder();
      await _db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['model', JSON.stringify(model)]);
    });

    window.addEventListener('settings-changed', e => { if (e.detail?.app === 'mvmai') _loadCfg(); });
    window.mvmOS?.onLangChange?.(() => { /* keep current chat; labels update on reopen */ });
    mvmOS.initMobileSidebar?.(body);
    setTimeout(() => ta.focus(), 50);
  }

  return { mount };
})();
