// mvmOS App: mvmSiteBuilder v1.0.0
// Admin UI for building sites (pages/menu/theme/custom CSS-JS) that live at
// /pub/mvmsitebuilder/<slug>/. Identity is the Apps Hub token — the window
// only opens once AppHub.requireLogin() has resolved (see requires_apphub).

// Own i18n (apps/mvmsitebuilder/i18n.js), loaded synchronously so `t('msb_title')`
// below already resolves — this app's translations aren't in core (see CLAUDE.md).
(function () {
  if (window.MSB_I18N) return;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/apps/mvmsitebuilder/i18n.js?_=' + Date.now(), false);
    xhr.send(null);
    if (xhr.status === 200) (0, eval)(xhr.responseText);
  } catch (e) { /* falls back to raw keys via t()'s default */ }
})();

function _loadMsbBlocks() {
  if (window.MSB_BLOCKS) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/apps/mvmsitebuilder/blocks.js?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

mvmOS.registerApp({
  id: 'mvmsitebuilder',
  name: (window.t || (k => k))('msb_title'),
  icon: '🧱',
  category: 'Productivity',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'mvmsitebuilder',
      title: '🧱 ' + (window.t || (k => k))('msb_title'),
      width: 980,
      height: 660,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="msb-root" class="msb-root"></div>`;
        const root = body.querySelector('#msb-root');
        _loadMsbBlocks().then(() => MsbApp.mount(root));
      },
    });
  },
});

const MsbApp = (() => {
  const API = '/pub/mvmsitebuilder';
  const t = k => (window.t || (k => k))(k);
  const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

  let root, token;
  let sites = [], themes = [];
  let site = null;       // currently selected site (full dict incl. role)
  let pages = [];
  let page = null;       // currently open page in the editor, or null = list view
  let menuItems = [];
  let members = [];
  let tab = 'pages';
  let designSubTab = 'theme';

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Pub-Token': token }, opts.headers || {});
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http_' + res.status));
    return data;
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('site_id', site.id);
    fd.append('file', file);
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { 'X-Pub-Token': token }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http_' + res.status));
    return data;
  }

  function uploadTheme(themeId, file) {
    // Stage the zip via the core chunk-uploader (session-cookie auth, own
    // progress window), then hand the resulting tmp path to our own backend
    // to validate/extract/install. See mvmOS.upload docs in upload-manager.js.
    return new Promise((resolve, reject) => {
      mvmOS.upload.start({
        file,
        accept: ['.zip'],
        chunkEndpoint: '/api/files/upload-chunk',
        cancelEndpoint: '/api/files/upload-chunk',
        fields: { path: '/tmp' },
        noFinalize: true,
        onDone: async (data) => {
          try {
            const fd = new FormData();
            fd.append('theme_id', themeId);
            fd.append('tmp_path', data.tmp_path);
            const res = await fetch(API + '/themes/upload', { method: 'POST', headers: { 'X-Pub-Token': token }, body: fd });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) { reject(new Error(result.error || ('http_' + res.status))); return; }
            resolve(result);
          } catch (err) { reject(err); }
        },
        onError: (msg) => reject(new Error(msg)),
        onCancel: () => resolve(null),
      });
    });
  }

  function notifyError(err) {
    mvmOS.notify(t('msb_title'), t('msb_error') + ': ' + (err && err.message ? err.message : err));
  }

  function canEdit() { return site && (site.role === 'owner' || site.role === 'editor'); }
  function isOwner() { return site && site.role === 'owner'; }

  async function mount(el) {
    root = el;
    token = localStorage.getItem('apphub_token');
    root.innerHTML = `<div class="msb-loading">${t('msb_loading')}</div>`;
    try {
      const [siteList, themeList] = await Promise.all([api('/sites'), api('/themes')]);
      sites = siteList; themes = themeList;
    } catch (err) { notifyError(err); sites = []; themes = []; }
    if (sites.length) await selectSite(sites[0].id);
    else render();
  }

  async function selectSite(id) {
    try {
      site = await api('/sites/' + id);
      page = null;
      tab = 'pages';
      await Promise.all([loadPages(), loadMenuItems()]);
      if (isOwner()) await loadMembers();
    } catch (err) { notifyError(err); site = null; }
    render();
  }

  async function loadPages() { pages = await api('/sites/' + site.id + '/pages'); }
  async function loadMenuItems() { menuItems = await api('/sites/' + site.id + '/menu-items'); }
  async function loadMembers() { members = await api('/sites/' + site.id + '/members'); }

  async function createSite() {
    const name = await mvmOS.prompt(t('msb_new_site_prompt'), t('msb_site_name_ph'));
    if (!name) return;
    try {
      const s = await api('/sites', { method: 'POST', body: JSON.stringify({ name }) });
      sites.push(s);
      await selectSite(s.id);
    } catch (err) { notifyError(err); }
  }

  async function deleteSite() {
    if (!site) return;
    const ok = await mvmOS.confirm(t('msb_confirm_delete_site').replace('{name}', esc(site.name)));
    if (!ok) return;
    try {
      await api('/sites/' + site.id, { method: 'DELETE' });
      sites = sites.filter(s => s.id !== site.id);
      site = null;
      if (sites.length) await selectSite(sites[0].id);
      else render();
    } catch (err) { notifyError(err); }
  }

  // ── Render shell ─────────────────────────────────────────────────

  function render() {
    if (!sites.length && !site) {
      root.innerHTML = `
        <div class="msb-empty">
          <div class="msb-empty-icon">🧱</div>
          <div class="msb-empty-title">${t('msb_no_sites')}</div>
          <button class="s-btn" id="msb-create-first">${t('msb_new_site')}</button>
        </div>`;
      root.querySelector('#msb-create-first').onclick = createSite;
      return;
    }

    root.innerHTML = `
      <div class="msb-shell">
        <div class="msb-topbar">
          <select class="s-input msb-site-select" id="msb-site-select">
            ${sites.map(s => `<option value="${s.id}" ${site && s.id === site.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
          <button class="s-btn s-btn-sm" id="msb-new-site">＋ ${t('msb_new_site')}</button>
          ${site ? `<a class="msb-open-link" href="/pub/mvmsitebuilder/${esc(site.slug)}" target="_blank">🔗 ${t('msb_view_site')}</a>` : ''}
        </div>
        <div class="msb-body">
          <div class="msb-tabs">
            ${['pages', 'menu', 'design', 'settings'].map(tb => `
              <button class="msb-tab-btn ${tab === tb ? 'active' : ''}" data-tab="${tb}">${t('msb_tab_' + tb)}</button>
            `).join('')}
          </div>
          <div class="msb-content" id="msb-content"></div>
        </div>
      </div>`;

    root.querySelector('#msb-site-select').onchange = e => selectSite(e.target.value);
    root.querySelector('#msb-new-site').onclick = createSite;
    root.querySelectorAll('.msb-tab-btn').forEach(b => b.onclick = () => { tab = b.dataset.tab; page = null; render(); });

    const content = root.querySelector('#msb-content');
    if (!site) return;
    if (tab === 'pages') renderPagesTab(content);
    else if (tab === 'menu') renderMenuTab(content);
    else if (tab === 'design') renderDesignTab(content);
    else if (tab === 'settings') renderSettingsTab(content);
  }

  // ── Pages tab ────────────────────────────────────────────────────

  function renderPagesTab(content) {
    if (page) { renderPageEditor(content); return; }
    content.innerHTML = `
      <div class="msb-list-header">
        ${canEdit() ? `<button class="s-btn s-btn-sm" id="msb-add-page">＋ ${t('msb_new_page')}</button>` : ''}
      </div>
      <div class="msb-page-list">
        ${pages.length ? pages.map(p => `
          <div class="msb-page-row" data-id="${p.id}">
            <div class="msb-page-info">
              <span class="msb-page-title">${p.is_homepage ? '⭐ ' : ''}${esc(p.title || t('msb_untitled'))}</span>
              <span class="msb-page-slug">/${esc(p.slug)}</span>
              <span class="msb-badge msb-badge-${p.status}">${t('msb_status_' + p.status)}</span>
            </div>
            <div class="msb-page-actions">
              <button class="s-btn s-btn-sm" data-act="edit">${t('msb_edit')}</button>
              ${canEdit() ? `
                <button class="s-btn s-btn-sm" data-act="toggle">${p.status === 'published' ? t('msb_unpublish') : t('msb_publish')}</button>
                ${!p.is_homepage ? `<button class="s-btn s-btn-sm" data-act="homepage">${t('msb_set_homepage')}</button>` : ''}
                <button class="s-btn s-btn-sm s-btn-danger" data-act="delete">${t('msb_delete')}</button>
              ` : ''}
            </div>
          </div>`).join('') : `<div class="msb-empty-inline">${t('msb_no_pages')}</div>`}
      </div>`;

    if (canEdit()) content.querySelector('#msb-add-page').onclick = async () => {
      try {
        page = await api('/sites/' + site.id + '/pages', { method: 'POST', body: JSON.stringify({ title: t('msb_untitled'), blocks: [] }) });
        pages.push(page);
        render();
      } catch (err) { notifyError(err); }
    };

    content.querySelectorAll('.msb-page-row').forEach(row => {
      const id = row.dataset.id;
      const p = pages.find(x => x.id === id);
      row.querySelector('[data-act="edit"]').onclick = () => { page = p; render(); };
      const toggleBtn = row.querySelector('[data-act="toggle"]');
      if (toggleBtn) toggleBtn.onclick = async () => {
        try {
          const status = p.status === 'published' ? 'draft' : 'published';
          const updated = await api('/sites/' + site.id + '/pages/' + p.id, { method: 'PUT', body: JSON.stringify({ title: p.title, slug: p.slug, blocks: p.blocks, status }) });
          Object.assign(p, updated);
          render();
        } catch (err) { notifyError(err); }
      };
      const homeBtn = row.querySelector('[data-act="homepage"]');
      if (homeBtn) homeBtn.onclick = async () => {
        try {
          await api('/sites/' + site.id + '/pages/' + p.id + '/homepage', { method: 'POST' });
          await loadPages();
          render();
        } catch (err) { notifyError(err); }
      };
      const delBtn = row.querySelector('[data-act="delete"]');
      if (delBtn) delBtn.onclick = async () => {
        const ok = await mvmOS.confirm(t('msb_confirm_delete_page').replace('{title}', esc(p.title || t('msb_untitled'))));
        if (!ok) return;
        try {
          await api('/sites/' + site.id + '/pages/' + p.id, { method: 'DELETE' });
          pages = pages.filter(x => x.id !== p.id);
          render();
        } catch (err) { notifyError(err); }
      };
    });
  }

  function renderPageEditor(content) {
    const editable = canEdit();
    content.innerHTML = `
      <div class="msb-editor">
        <div class="msb-editor-head">
          <button class="s-btn s-btn-sm" id="msb-back">← ${t('msb_back')}</button>
          <input class="s-input msb-editor-title" id="msb-page-title" value="${esc(page.title)}" placeholder="${t('msb_page_title_ph')}" ${editable ? '' : 'disabled'}>
          <input class="s-input msb-editor-slug" id="msb-page-slug" value="${esc(page.slug)}" placeholder="${t('msb_page_slug_ph')}" ${editable ? '' : 'disabled'}>
          ${editable ? `<button class="s-btn s-btn-sm" id="msb-save-page">${t('msb_save')}</button>` : ''}
        </div>
        ${editable ? `
          <div class="msb-block-add-row">
            ${window.MSB_BLOCK_ORDER.map(type => `<button class="s-btn s-btn-sm" data-add-block="${type}">${window.MSB_BLOCKS[type].icon} ${window.MSB_BLOCKS[type].label()}</button>`).join('')}
          </div>` : ''}
        <div class="msb-blocks" id="msb-blocks"></div>
      </div>`;

    content.querySelector('#msb-back').onclick = () => { page = null; render(); };

    const blocksEl = content.querySelector('#msb-blocks');
    const ctx = { uploadImage, notifyError };

    function renderBlocks() {
      blocksEl.innerHTML = '';
      (page.blocks || []).forEach((block, i) => {
        const def = window.MSB_BLOCKS[block.type];
        if (!def) return;
        const card = document.createElement('div');
        card.className = 'msb-block-card';
        card.innerHTML = `
          <div class="msb-block-card-head">
            <span>${def.icon} ${def.label()}</span>
            ${editable ? `
              <span class="msb-block-card-actions">
                <button class="s-btn s-btn-sm" data-move="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="s-btn s-btn-sm" data-move="1" ${i === page.blocks.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="s-btn s-btn-sm s-btn-danger" data-remove="1">${t('msb_delete')}</button>
              </span>` : ''}
          </div>
          <div class="msb-block-card-body"></div>`;
        const bodyEl = card.querySelector('.msb-block-card-body');
        if (editable) def.mount(bodyEl, block.data, ctx);
        else bodyEl.innerHTML = `<div class="msb-block-readonly">${t('msb_read_only')}</div>`;

        if (editable) {
          card.querySelector('[data-move="-1"]')?.addEventListener('click', () => { swapBlocks(i, i - 1); });
          card.querySelector('[data-move="1"]')?.addEventListener('click', () => { swapBlocks(i, i + 1); });
          card.querySelector('[data-remove]')?.addEventListener('click', () => { page.blocks.splice(i, 1); renderBlocks(); });
        }
        blocksEl.appendChild(card);
      });
      if (!page.blocks || !page.blocks.length) blocksEl.innerHTML = `<div class="msb-empty-inline">${t('msb_no_blocks')}</div>`;
    }

    function swapBlocks(a, b) {
      const arr = page.blocks;
      [arr[a], arr[b]] = [arr[b], arr[a]];
      renderBlocks();
    }

    renderBlocks();

    if (editable) {
      content.querySelectorAll('[data-add-block]').forEach(btn => btn.onclick = () => {
        const type = btn.dataset.addBlock;
        page.blocks = page.blocks || [];
        page.blocks.push({ type, data: window.MSB_BLOCKS[type].create() });
        renderBlocks();
      });
      content.querySelector('#msb-save-page').onclick = async () => {
        try {
          const title = content.querySelector('#msb-page-title').value;
          const slug = content.querySelector('#msb-page-slug').value;
          const updated = await api('/sites/' + site.id + '/pages/' + page.id, {
            method: 'PUT', body: JSON.stringify({ title, slug, blocks: page.blocks, status: page.status }),
          });
          Object.assign(page, updated);
          const idx = pages.findIndex(p => p.id === page.id);
          if (idx >= 0) pages[idx] = page;
          mvmOS.notify(t('msb_title'), t('msb_saved'));
          render();
        } catch (err) { notifyError(err); }
      };
    }
  }

  // ── Menu tab ─────────────────────────────────────────────────────

  function renderMenuTab(content) {
    const editable = canEdit();
    content.innerHTML = `
      <div class="msb-list-header">
        ${editable ? `<button class="s-btn s-btn-sm" id="msb-add-menu-item">＋ ${t('msb_new_menu_item')}</button>` : ''}
      </div>
      <div class="msb-menu-list">
        ${menuItems.length ? menuItems.map(m => `
          <div class="msb-menu-row" data-id="${m.id}">
            <span class="msb-menu-label">${esc(m.label)}</span>
            <span class="msb-menu-target">${m.target_type === 'page' ? '📄 ' + esc((pages.find(p => p.id === m.target) || {}).title || '?') : '🔗 ' + esc(m.target)}</span>
            ${editable ? `<button class="s-btn s-btn-sm s-btn-danger" data-act="delete">${t('msb_delete')}</button>` : ''}
          </div>`).join('') : `<div class="msb-empty-inline">${t('msb_no_menu_items')}</div>`}
      </div>`;

    if (editable) {
      content.querySelector('#msb-add-menu-item').onclick = () => openMenuItemDialog();
      content.querySelectorAll('.msb-menu-row [data-act="delete"]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.closest('.msb-menu-row').dataset.id;
          try {
            await api('/sites/' + site.id + '/menu-items/' + id, { method: 'DELETE' });
            menuItems = menuItems.filter(m => m.id !== id);
            render();
          } catch (err) { notifyError(err); }
        };
      });
    }
  }

  function openMenuItemDialog() {
    const ov = document.createElement('div');
    ov.className = 'msb-overlay';
    ov.innerHTML = `
      <div class="msb-dialog">
        <div class="msb-dialog-title">${t('msb_new_menu_item')}</div>
        <input class="s-input" id="msb-mi-label" placeholder="${t('msb_menu_label_ph')}">
        <select class="s-input" id="msb-mi-type">
          <option value="page">${t('msb_menu_target_page')}</option>
          <option value="url">${t('msb_menu_target_url')}</option>
        </select>
        <select class="s-input" id="msb-mi-page">
          ${pages.map(p => `<option value="${p.id}">${esc(p.title || t('msb_untitled'))}</option>`).join('')}
        </select>
        <input class="s-input" id="msb-mi-url" placeholder="https://…" style="display:none">
        <div class="msb-dialog-actions">
          <button class="s-btn s-btn-sm" id="msb-mi-cancel">${t('msb_cancel')}</button>
          <button class="s-btn s-btn-sm" id="msb-mi-ok">${t('msb_save')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const typeSel = ov.querySelector('#msb-mi-type');
    typeSel.onchange = () => {
      ov.querySelector('#msb-mi-page').style.display = typeSel.value === 'page' ? '' : 'none';
      ov.querySelector('#msb-mi-url').style.display = typeSel.value === 'url' ? '' : 'none';
    };
    ov.querySelector('#msb-mi-cancel').onclick = () => ov.remove();
    ov.querySelector('#msb-mi-ok').onclick = async () => {
      const label = ov.querySelector('#msb-mi-label').value.trim();
      if (!label) return;
      const target_type = typeSel.value;
      const target = target_type === 'page' ? ov.querySelector('#msb-mi-page').value : ov.querySelector('#msb-mi-url').value.trim();
      try {
        const item = await api('/sites/' + site.id + '/menu-items', { method: 'POST', body: JSON.stringify({ label, target_type, target }) });
        menuItems.push(item);
        ov.remove();
        render();
      } catch (err) { notifyError(err); }
    };
  }

  // ── Design tab ───────────────────────────────────────────────────

  let _cmLoaded = false;
  function _loadCM() {
    if (_cmLoaded) return Promise.resolve();
    if (window.CodeMirror) { _cmLoaded = true; return Promise.resolve(); }
    const base = '/lib';
    function loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    function loadStyle(href) {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      document.head.appendChild(l);
    }
    loadStyle(`${base}/codemirror.min.css`);
    loadStyle(`${base}/codemirror-dracula.min.css`);
    return loadScript(`${base}/codemirror.min.js`)
      .then(() => Promise.all([loadScript(`${base}/codemirror-css.min.js`), loadScript(`${base}/codemirror-js.min.js`)]))
      .then(() => { _cmLoaded = true; });
  }

  // Native-browser syntax checks — no extra CM lint addon/library shipped
  // (none exists in this repo for CM 5.x), just enough to catch typos.
  function _cssError(src) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(src);
      return null;
    } catch (e) { return e.message || String(e); }
  }
  function _jsError(src) {
    try { new Function(src); return null; }
    catch (e) { return e.message || String(e); }
  }

  function _designEditor(content, elId, errId, lang, onChange) {
    const ta = content.querySelector('#' + elId);
    const cm = CodeMirror.fromTextArea(ta, {
      mode: lang === 'css' ? 'css' : 'javascript',
      theme: 'dracula',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      viewportMargin: Infinity,
    });
    cm.setSize('100%', 260);
    const errEl = content.querySelector('#' + errId);
    const check = () => {
      const src = cm.getValue();
      const msg = lang === 'css' ? _cssError(src) : _jsError(src);
      errEl.textContent = msg ? t(lang === 'css' ? 'msb_css_error' : 'msb_js_error', { msg }) : '';
      errEl.classList.toggle('msb-code-error-active', !!msg);
      onChange(src);
    };
    cm.on('change', check);
    check();
    return cm;
  }

  function renderDesignTab(content) {
    const editable = canEdit();
    content.innerHTML = `
      <div class="msb-design">
        <div class="msb-design-subtabs">
          ${['theme', 'css', 'js'].map(sb => `
            <button class="msb-subtab-btn ${designSubTab === sb ? 'active' : ''}" data-subtab="${sb}">${t('msb_design_sub_' + sb)}</button>
          `).join('')}
        </div>
        <div class="msb-design-subcontent" id="msb-design-subcontent"></div>
      </div>`;

    content.querySelectorAll('.msb-subtab-btn').forEach(b => b.onclick = () => {
      designSubTab = b.dataset.subtab;
      renderDesignTab(content);
    });

    const sub = content.querySelector('#msb-design-subcontent');
    if (designSubTab === 'theme') return renderThemeSubTab(sub, editable);
    if (designSubTab === 'css') return renderCodeSubTab(sub, editable, 'css', 'msb_custom_css', site.custom_css, v => { site.custom_css = v; });
    if (designSubTab === 'js') return renderCodeSubTab(sub, editable, 'js', 'msb_custom_js', site.custom_js, v => { site.custom_js = v; });
  }

  function _saveDesign() {
    return api('/sites/' + site.id, {
      method: 'PUT', body: JSON.stringify({
        name: site.name,
        theme: site.theme,
        custom_css: site.custom_css,
        custom_js: site.custom_js,
      }),
    });
  }

  function renderThemeSubTab(sub, editable) {
    sub.innerHTML = `
      <label class="msb-field-label">${t('msb_theme')}</label>
      <select class="s-input" id="msb-theme-select" ${editable ? '' : 'disabled'}>
        ${themes.map(th => `<option value="${th.id}" ${site.theme === th.id ? 'selected' : ''}>${esc(th.name)}</option>`).join('')}
      </select>
      ${editable ? `<button class="s-btn s-btn-sm" id="msb-save-design">${t('msb_save')}</button>` : ''}

      ${editable ? `
        <div class="msb-theme-upload">
          <label class="msb-field-label">${t('msb_upload_theme')}</label>
          <div class="msb-theme-upload-row">
            <input class="s-input msb-theme-id-input" id="msb-theme-id" placeholder="${t('msb_theme_id_ph')}" maxlength="40">
            <input type="file" id="msb-theme-zip" accept=".zip">
            <button class="s-btn s-btn-sm" id="msb-upload-theme-btn">${t('msb_upload')}</button>
          </div>
          <div class="msb-f-hint">${t('msb_theme_upload_hint')}</div>
        </div>` : ''}`;

    if (editable) sub.querySelector('#msb-save-design').onclick = async () => {
      try {
        site.theme = sub.querySelector('#msb-theme-select').value;
        const updated = await _saveDesign();
        Object.assign(site, updated);
        mvmOS.notify(t('msb_title'), t('msb_saved'));
      } catch (err) { notifyError(err); }
    };

    if (editable) sub.querySelector('#msb-upload-theme-btn').onclick = async () => {
      const idInput = sub.querySelector('#msb-theme-id');
      const fileInput = sub.querySelector('#msb-theme-zip');
      const themeId = idInput.value.trim().toLowerCase();
      const file = fileInput.files[0];
      if (!/^[a-z0-9-]{1,40}$/.test(themeId)) { mvmOS.notify(t('msb_title'), t('msb_theme_id_invalid')); return; }
      if (!file) { mvmOS.notify(t('msb_title'), t('msb_theme_zip_required')); return; }
      try {
        const result = await uploadTheme(themeId, file);
        if (!result) return; // cancelled
        themes = await api('/themes');
        mvmOS.notify(t('msb_title'), t('msb_theme_uploaded'));
        renderThemeSubTab(sub, editable);
        sub.querySelector('#msb-theme-select').value = themeId;
      } catch (err) { notifyError(err); }
    };
  }

  function renderCodeSubTab(sub, editable, lang, labelKey, value, onChange) {
    sub.innerHTML = `
      <label class="msb-field-label">${t(labelKey)}</label>
      <textarea class="msb-code-area" id="msb-code-${lang}">${esc(value)}</textarea>
      <div class="msb-code-error" id="msb-code-${lang}-error"></div>
      ${editable ? `<button class="s-btn s-btn-sm" id="msb-save-design">${t('msb_save')}</button>` : ''}`;

    _loadCM().then(() => {
      const cm = _designEditor(sub, `msb-code-${lang}`, `msb-code-${lang}-error`, lang, onChange);
      if (!editable) cm.setOption('readOnly', true);
    });

    if (editable) sub.querySelector('#msb-save-design').onclick = async () => {
      try {
        const updated = await _saveDesign();
        Object.assign(site, updated);
        mvmOS.notify(t('msb_title'), t('msb_saved'));
      } catch (err) { notifyError(err); }
    };
  }

  // ── Settings tab ─────────────────────────────────────────────────

  function renderSettingsTab(content) {
    const editable = canEdit();
    content.innerHTML = `
      <div class="msb-settings">
        <label class="msb-field-label">${t('msb_site_name')}</label>
        <input class="s-input" id="msb-set-name" value="${esc(site.name)}" ${editable ? '' : 'disabled'}>
        <label class="msb-field-label">${t('msb_site_slug')}</label>
        <input class="s-input" id="msb-set-slug" value="${esc(site.slug)}" ${editable ? '' : 'disabled'}>
        ${editable ? `<button class="s-btn s-btn-sm" id="msb-save-settings">${t('msb_save')}</button>` : ''}

        ${isOwner() ? `
          <div class="msb-members-section">
            <label class="msb-field-label">${t('msb_members')}</label>
            <div class="msb-members-list">
              ${members.map(m => `
                <div class="msb-member-row" data-uid="${m.user_id}">
                  <span>${esc(m.display_name || m.username || m.user_id)}</span>
                  ${m.role === 'owner' ? `<span class="msb-badge">${t('msb_role_owner')}</span>` : `
                    <select class="s-input msb-member-role" data-uid="${m.user_id}">
                      <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>${t('msb_role_editor')}</option>
                      <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('msb_role_viewer')}</option>
                    </select>
                    <button class="s-btn s-btn-sm s-btn-danger" data-remove-member="${m.user_id}">${t('msb_delete')}</button>
                  `}
                </div>`).join('')}
            </div>
            <div class="msb-member-add">
              <input class="s-input" id="msb-member-search" placeholder="${t('msb_search_user_ph')}">
              <div class="msb-member-search-results" id="msb-member-results"></div>
            </div>
          </div>
          <div class="msb-danger-zone">
            <button class="s-btn s-btn-danger s-btn-sm" id="msb-delete-site">${t('msb_delete_site')}</button>
          </div>` : ''}
      </div>`;

    if (editable) content.querySelector('#msb-save-settings').onclick = async () => {
      try {
        const updated = await api('/sites/' + site.id, {
          method: 'PUT', body: JSON.stringify({
            name: content.querySelector('#msb-set-name').value,
            slug: content.querySelector('#msb-set-slug').value,
          }),
        });
        Object.assign(site, updated);
        const idx = sites.findIndex(s => s.id === site.id);
        if (idx >= 0) sites[idx] = site;
        mvmOS.notify(t('msb_title'), t('msb_saved'));
        render();
      } catch (err) { notifyError(err); }
    };

    if (isOwner()) {
      content.querySelector('#msb-delete-site').onclick = deleteSite;
      content.querySelectorAll('.msb-member-role').forEach(sel => sel.onchange = async () => {
        try {
          await api('/sites/' + site.id + '/members/' + sel.dataset.uid, { method: 'PUT', body: JSON.stringify({ role: sel.value }) });
          await loadMembers();
          render();
        } catch (err) { notifyError(err); }
      });
      content.querySelectorAll('[data-remove-member]').forEach(btn => btn.onclick = async () => {
        try {
          await api('/sites/' + site.id + '/members/' + btn.dataset.removeMember, { method: 'DELETE' });
          await loadMembers();
          render();
        } catch (err) { notifyError(err); }
      });

      const searchInput = content.querySelector('#msb-member-search');
      const resultsEl = content.querySelector('#msb-member-results');
      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) { resultsEl.innerHTML = ''; return; }
        searchTimer = setTimeout(async () => {
          try {
            const results = await api('/sites/' + site.id + '/member-search?q=' + encodeURIComponent(q));
            resultsEl.innerHTML = results.map(u => `
              <div class="msb-search-result" data-uid="${u.id}">
                <span>${esc(u.display_name || u.username)}</span>
                <button class="s-btn s-btn-sm" data-invite="${u.id}">${t('msb_add')}</button>
              </div>`).join('') || `<div class="msb-empty-inline">${t('msb_no_results')}</div>`;
            resultsEl.querySelectorAll('[data-invite]').forEach(btn => btn.onclick = async () => {
              try {
                await api('/sites/' + site.id + '/members', { method: 'POST', body: JSON.stringify({ user_id: btn.dataset.invite, role: 'editor' }) });
                searchInput.value = ''; resultsEl.innerHTML = '';
                await loadMembers();
                render();
              } catch (err) { notifyError(err); }
            });
          } catch (err) { notifyError(err); }
        }, 300);
      });
    }
  }

  return { mount };
})();
