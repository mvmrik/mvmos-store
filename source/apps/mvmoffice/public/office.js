// mvmOffice — the window: the list of documents, and a document with its
// Pages (text on A4 sheets) and Data (spreadsheets). Mounted the same way in
// the desktop window and on the public page.
//
// Where a document lives decides where it is saved:
//   cloud   a file of this account on the server (apps/mvmoffice/storage)
//   local   a file from this computer: saving downloads a new copy, the
//           same in every browser
//   server  a file in the user's own folders on the server (desktop only)
(function () {
  if (window.MvmOffice) return;
  const F = window.MvmOfficeFormula;
  const M = window.MvmOfficeModel;
  const G = window.MvmOfficeGrid;
  const E = window.MvmOfficeEditor;

  const API = '/pub/mvmoffice';
  const EXT = '.mvmoffice';
  const SAVE_DELAY = 800;

  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Display formats offered for cells and for values in the text.
  const FORMATS = {
    auto: null,
    number: { type: 'number', dec: 2 },
    int: { type: 'number', dec: 0 },
    percent: { type: 'percent', dec: 0 },
    eur: { type: 'currency', dec: 2, sym: '€', pos: 'after' },
    usd: { type: 'currency', dec: 2, sym: '$', pos: 'before' },
    date: { type: 'date' },
    text: { type: 'text' },
  };
  function formatKey(f) {
    if (!f || !f.type || f.type === 'general') return 'auto';
    if (f.type === 'number') return (f.dec | 0) === 0 ? 'int' : 'number';
    if (f.type === 'currency') return f.sym === '$' ? 'usd' : 'eur';
    return FORMATS[f.type] ? f.type : 'auto';
  }
  const formatOptions = (withAuto) => Object.keys(FORMATS).map(k => `<option value="${k}">${esc(t(k === 'auto' ? (withAuto || 'mo_fmt_auto') : 'mo_fmt_' + k))}</option>`).join('');

  const COLORS = ['#000000', '#5c5c5c', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ffffff'];
  const QUICK_FNS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];
  const FILLS = ['#fde2e1', '#fdebd0', '#fcf3cf', '#d5f5e3', '#d6eaf8', '#e8daef', '#eaecee', '#fff9c4', '#c8e6c9'];

  // The desktop's folder dialog. Core declares it with a top-level const, so
  // it is a global binding but not a property of window.
  const folderPicker = () => (typeof FolderPicker !== 'undefined' ? FolderPicker : null);

  let styleAdded = false;
  function addStyle() {
    if (styleAdded || document.getElementById('mo-style')) return;
    styleAdded = true;
    const st = document.createElement('style');
    st.id = 'mo-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  class Office {
    constructor(root, opts) {
      addStyle();
      this.opts = opts || {};
      this.desktop = !!this.opts.desktop && !!folderPicker();
      this.token = localStorage.getItem('apphub_token');
      this.t = t;
      this.host = root;
      this.doc = null;
      this.engine = null;
      this.schema = null;
      this.editor = null;
      this.sheetGrid = null;
      this.activeGrid = null;
      this.pick = null;
      this.clip = null;
      this.undoStack = [];
      this.redoStack = [];
      this.lastFocus = 'text';
      this.saveTimer = null;
      this.saving = false;
      this.saveAgain = false;
      this.dirty = false;
      this.conflict = false;
      this.build();
      if (!this.token) { if (this.opts.onNeedLogin) this.opts.onNeedLogin(); return; }
      // Numbers and dates are shown and typed the way this person writes them.
      this.api('/region').then(r => F.setRegion(r)).catch(() => {})
        .then(() => (this.opts.openPath ? this.openServerFile(this.opts.openPath) : this.showList()));
    }
    // A file handed over by File Manager or the desktop while the window is open.
    async openPath(path) {
      if (!this.token) return;
      if (await this.leaveDoc()) this.openServerFile(path);
    }

    // ── Server ─────────────────────────────────────────────────────────────
    async api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': this.token }, o.headers || {});
      if (o.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const r = await fetch(API + path, Object.assign({}, o, { headers }));
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && this.opts.onNeedLogin) this.opts.onNeedLogin();
      if (!r.ok) { const e = new Error(data.error || ('http_' + r.status)); e.status = r.status; e.data = data; throw e; }
      return data;
    }

    // ── Frame ──────────────────────────────────────────────────────────────
    build() {
      const root = document.createElement('div');
      root.className = this.opts.desktop ? 'mo mo-os' : 'mo';
      root.innerHTML = `
        <div class="mo-list"></div>
        <div class="mo-docview" hidden>
          <div class="mo-top">
            <button class="mo-ib mo-side-toggle" data-a="side" title="${esc(t('mo_contents'))}">☰</button>
            <button class="mo-ib" data-a="back" title="${esc(t('mo_all_docs'))}">‹</button>
            <input class="mo-title" spellcheck="false" maxlength="200">
            <span class="mo-where"></span>
            <span class="mo-status"></span>
            <span class="mo-grow"></span>
            <button class="mo-btn" data-a="file">${esc(t('mo_file'))} ▾</button>
          </div>
          <div class="mo-conflict" hidden>
            <span>${esc(t('mo_conflict'))}</span>
            <button class="mo-btn" data-a="theirs">${esc(t('mo_conflict_theirs'))}</button>
            <button class="mo-btn mo-primary" data-a="mine">${esc(t('mo_conflict_mine'))}</button>
          </div>
          <div class="mo-tools">
            <button class="mo-ib" data-a="undo" title="${esc(t('mo_undo'))} (Ctrl+Z)">↶</button>
            <button class="mo-ib" data-a="redo" title="${esc(t('mo_redo'))} (Ctrl+Y)">↷</button>
            <span class="mo-sep"></span>
            <span class="mo-tg-text">
              <select class="mo-sel-block" title="${esc(t('mo_style'))}">
                <option value="p">${esc(t('mo_normal'))}</option>
                <option value="h1">${esc(t('mo_heading'))} 1</option>
                <option value="h2">${esc(t('mo_heading'))} 2</option>
                <option value="h3">${esc(t('mo_heading'))} 3</option>
              </select>
            </span>
            <button class="mo-ib mo-b" data-a="b" title="${esc(t('mo_bold'))} (Ctrl+B)">B</button>
            <button class="mo-ib mo-i" data-a="i" title="${esc(t('mo_italic'))} (Ctrl+I)">I</button>
            <button class="mo-ib mo-u" data-a="u" title="${esc(t('mo_underline'))} (Ctrl+U)">U</button>
            <button class="mo-ib mo-s" data-a="s" title="${esc(t('mo_strike'))}">S</button>
            <button class="mo-ib" data-a="color" title="${esc(t('mo_text_color'))}"><span class="mo-a-color">A</span></button>
            <span class="mo-tg-cell"><button class="mo-ib" data-a="fill" title="${esc(t('mo_fill_color'))}">▧</button></span>
            <span class="mo-sep"></span>
            <button class="mo-ib" data-a="al" title="${esc(t('mo_align_left'))}">${ICON.left}</button>
            <button class="mo-ib" data-a="ac" title="${esc(t('mo_align_center'))}">${ICON.center}</button>
            <button class="mo-ib" data-a="ar" title="${esc(t('mo_align_right'))}">${ICON.right}</button>
            <span class="mo-tg-text">
              <button class="mo-ib" data-a="aj" title="${esc(t('mo_align_justify'))}">${ICON.justify}</button>
              <span class="mo-sep"></span>
              <button class="mo-ib" data-a="ul" title="${esc(t('mo_bullets'))}">•≡</button>
              <button class="mo-ib" data-a="ol" title="${esc(t('mo_numbering'))}">1≡</button>
              <span class="mo-sep"></span>
              <button class="mo-btn mo-ins" data-a="table" title="${esc(t('mo_insert_table'))}">▦ ${esc(t('mo_table'))}</button>
              <button class="mo-btn mo-ins mo-fx-btn" data-a="fx" title="${esc(t('mo_insert_formula_hint'))}">ƒx</button>
              <button class="mo-ib" data-a="pb" title="${esc(t('mo_page_break'))} (Ctrl+Enter)">⤓</button>
            </span>
            <span class="mo-tg-cell">
              <span class="mo-sep"></span>
              <select class="mo-sel-fmt" title="${esc(t('mo_number_format'))}">${formatOptions()}</select>
              <button class="mo-ib" data-a="dec-" title="${esc(t('mo_fewer_decimals'))}">.0←</button>
              <button class="mo-ib" data-a="dec+" title="${esc(t('mo_more_decimals'))}">.00→</button>
            </span>
          </div>
          <div class="mo-fbar" hidden>
            <span class="mo-addr"></span>
            <span class="mo-fx-lbl">ƒx</span>
            <input class="mo-fin" spellcheck="false">
          </div>
          <div class="mo-body">
            <aside class="mo-side"></aside>
            <main class="mo-main">
              <div class="mo-desk"><div class="mo-paper"><div class="mo-page-host"></div></div></div>
              <div class="mo-sheet-host" hidden></div>
              <div class="mo-empty" hidden></div>
            </main>
          </div>
        </div>`;
      this.host.appendChild(root);
      this.root = root;
      const q = s => root.querySelector(s);
      this.listEl = q('.mo-list');
      this.docEl = q('.mo-docview');
      this.titleEl = q('.mo-title');
      this.whereEl = q('.mo-where');
      this.statusEl = q('.mo-status');
      this.conflictEl = q('.mo-conflict');
      this.toolsEl = q('.mo-tools');
      this.fbarEl = q('.mo-fbar');
      this.addrEl = q('.mo-addr');
      this.finEl = q('.mo-fin');
      this.sideEl = q('.mo-side');
      this.deskEl = q('.mo-desk');
      this.pageHost = q('.mo-page-host');
      this.sheetHost = q('.mo-sheet-host');
      this.emptyEl = q('.mo-empty');
      this.blockSel = q('.mo-sel-block');
      this.fmtSel = q('.mo-sel-fmt');

      // Toolbar buttons keep the focus where the user is writing.
      root.addEventListener('mousedown', e => {
        const b = e.target.closest('.mo-top [data-a], .mo-tools [data-a], .mo-conflict [data-a]');
        if (b) e.preventDefault();
      });
      root.addEventListener('click', e => {
        const b = e.target.closest('.mo-top [data-a], .mo-tools [data-a], .mo-conflict [data-a]');
        if (b) this.command(b.dataset.a, b);
      });
      this.titleEl.addEventListener('input', () => {
        if (!this.doc) return;
        this.doc.title = this.titleEl.value;
        this.scheduleSave();
      });
      this.titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.focusWork(); } });
      this.blockSel.addEventListener('change', () => { if (this.editor) this.editor.setBlock(this.blockSel.value); });
      this.fmtSel.addEventListener('change', () => this.setCellFormat(this.fmtSel.value));
      this.setupFormulaBar();
      root.addEventListener('keydown', e => this.onRootKey(e));
      this._ro = new ResizeObserver(() => root.classList.toggle('mo-narrow', root.clientWidth < 760));
      this._ro.observe(root);
      this._unload = e => {
        if (this.dirty && this.source && this.source.kind !== 'local') { this.flushSave(); e.preventDefault(); e.returnValue = ''; }
      };
      window.addEventListener('beforeunload', this._unload);

      // A .mvmoffice file dropped anywhere on the window opens it.
      root.addEventListener('dragover', e => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('mo-drop'); }
      });
      root.addEventListener('dragleave', e => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('mo-drop'); });
      root.addEventListener('drop', e => this.onDrop(e));
    }

    destroy() {
      this.flushSave();
      window.removeEventListener('beforeunload', this._unload);
      if (this._ro) this._ro.disconnect();
      this.closeDoc(true);
      this.root.remove();
    }

    focusWork() {
      if (this.view && this.view.kind === 'sheet' && this.sheetGrid) this.sheetGrid.focus();
      else if (this.editor) this.editor.focus();
    }

    // ── The list of documents ──────────────────────────────────────────────
    async showList() {
      this.closeDoc();
      this.docEl.hidden = true;
      this.listEl.hidden = false;
      this.listEl.innerHTML = `
        <div class="mo-lhead">
          <span class="mo-logo">📝</span><h2>mvmOffice</h2><span class="mo-grow"></span>
          <button class="mo-btn mo-primary" data-l="new">+ ${esc(t('mo_new'))}</button>
          <button class="mo-btn" data-l="open">📂 ${esc(t('mo_open_file'))}</button>
          ${this.desktop ? `<button class="mo-btn" data-l="openfolder">🗄 ${esc(t('mo_open_from_folder'))}</button>` : ''}
        </div>
        <div class="mo-lbody"><div class="mo-loading">${esc(t('mo_loading'))}</div></div>
        <div class="mo-lhint">${esc(t('mo_drop_hint'))}</div>`;
      this.listEl.onclick = e => {
        const b = e.target.closest('[data-l]');
        if (!b) return;
        const a = b.dataset.l;
        if (a === 'new') this.newDoc();
        else if (a === 'open') this.openLocalFile();
        else if (a === 'openfolder') this.openFromFolder();
        else if (a === 'doc') this.openCloud(b.dataset.id);
        else if (a === 'dl') { e.stopPropagation(); this.downloadCloud(b.dataset.id); }
        else if (a === 'dup') { e.stopPropagation(); this.duplicateCloud(b.dataset.id); }
        else if (a === 'del') { e.stopPropagation(); this.deleteCloud(b.dataset.id, b.dataset.title); }
      };
      let docs;
      try { docs = (await this.api('/docs')).docs; } catch (e) {
        this.listEl.querySelector('.mo-lbody').innerHTML = `<div class="mo-emptylist">${esc(t('mo_load_failed'))}</div>`;
        return;
      }
      const body = this.listEl.querySelector('.mo-lbody');
      if (!body) return;
      if (!docs.length) {
        body.innerHTML = `
          <div class="mo-start">
            <p>${esc(t('mo_no_docs'))}</p>
            <button class="mo-btn mo-primary mo-start-btn" data-l="new">+ ${esc(t('mo_new'))}</button>
            <p class="mo-start-hint">${esc(t('mo_start_hint'))}</p>
          </div>`;
        return;
      }
      body.innerHTML = `<div class="mo-docs">${docs.map(d => `
          <div class="mo-doc" data-l="doc" data-id="${d.id}">
            <span class="mo-doc-ico">📄</span>
            <span class="mo-doc-main"><span class="mo-doc-title">${esc(d.title || t('mo_untitled'))}</span>
              <span class="mo-doc-meta">${esc(this.when(d.updated))} · ${esc(this.size(d.size))}</span></span>
            <button class="mo-ib" data-l="dl" data-id="${d.id}" title="${esc(t('mo_download'))}">⬇</button>
            <button class="mo-ib" data-l="dup" data-id="${d.id}" title="${esc(t('mo_duplicate'))}">⧉</button>
            <button class="mo-ib mo-danger-ib" data-l="del" data-id="${d.id}" data-title="${esc(d.title || t('mo_untitled'))}" title="${esc(t('mo_delete'))}">🗑</button>
          </div>`).join('')}</div>`;
    }
    when(iso) {
      try { return new Date(iso).toLocaleString((window.mvmOS && window.mvmOS.lang) || undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
    }
    size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
    async newDoc() {
      const doc = M.newDoc({ title: t('mo_untitled'), page: t('mo_page_base') });
      try {
        const res = await this.api('/docs', { method: 'POST', body: JSON.stringify(doc) });
        this.openDoc(doc, { kind: 'cloud', id: res.id, revision: res.revision });
        setTimeout(() => { this.titleEl.focus(); this.titleEl.select(); }, 0);
      } catch (e) { this.toast(t('mo_save_failed'), 'bad'); }
    }
    async openCloud(id) {
      try {
        const res = await this.api('/docs/' + id);
        this.openDoc(res.doc, { kind: 'cloud', id, revision: res.revision });
      } catch (e) { this.toast(t(e.message === 'not_mvmoffice' ? 'mo_not_mvmoffice' : 'mo_load_failed'), 'bad'); }
    }
    async downloadCloud(id) {
      try {
        const res = await this.api('/docs/' + id);
        this.download(res.doc);
      } catch (e) { this.toast(t('mo_load_failed'), 'bad'); }
    }
    async duplicateCloud(id) {
      try { await this.api('/docs/' + id + '/duplicate', { method: 'POST', body: '{}' }); this.showList(); } catch (e) { this.toast(t('mo_save_failed'), 'bad'); }
    }
    async deleteCloud(id, title) {
      if (!(await this.confirm(t('mo_delete_doc_confirm', { title }), t('mo_delete')))) return;
      try { await this.api('/docs/' + id, { method: 'DELETE' }); this.showList(); } catch (e) { this.toast(t('mo_delete_failed'), 'bad'); }
    }

    // ── Opening files ──────────────────────────────────────────────────────
    parseFileText(text) {
      let doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error('not_mvmoffice'); }
      return M.normalize(doc);
    }
    openLocalFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = EXT + ',application/json';
      input.onchange = () => { if (input.files[0]) this.openPlainFile(input.files[0]); };
      input.click();
    }
    async openPlainFile(file) {
      try {
        const doc = this.parseFileText(await file.text());
        this.openDoc(doc, { kind: 'local', name: file.name });
      } catch (e) { this.toast(t(e.message === 'not_mvmoffice' ? 'mo_not_mvmoffice' : 'mo_load_failed'), 'bad'); }
    }
    async onDrop(e) {
      this.root.classList.remove('mo-drop');
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      e.preventDefault();
      if (this.doc && !(await this.leaveDoc())) return;
      this.openPlainFile(dt.files[0]);
    }

    // Files in the user's own folders on the server (desktop window only).
    async homeDir() {
      try { const d = await (await fetch('/api/files/places')).json(); return d.home || '/'; } catch (e) { return '/'; }
    }
    async openFromFolder() {
      const root = await this.homeDir();
      folderPicker().open({
        root, title: t('mo_open_from_folder'),
        onSelect: async dir => {
          let entries = [];
          try {
            const r = await fetch('/api/files?path=' + encodeURIComponent(dir));
            entries = ((await r.json()).entries || []).filter(x => x.type === 'file' && x.name.toLowerCase().endsWith(EXT));
          } catch (e) { /* none */ }
          if (!entries.length) { this.toast(t('mo_no_files_in_folder'), 'bad'); return; }
          const r = this.root.getBoundingClientRect();
          this.menu(r.left + r.width / 2 - 140, r.top + 80, entries.map(x => ({
            icon: '📄', label: x.name, onClick: () => this.openServerFile(dir.replace(/\/+$/, '') + '/' + x.name),
          })), t('mo_pick_file'));
        },
      });
    }
    async openServerFile(path) {
      try {
        const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
        if (!r.ok) throw new Error('load');
        const doc = this.parseFileText(await r.text());
        this.openDoc(doc, { kind: 'server', path });
      } catch (e) {
        this.toast(t(e.message === 'not_mvmoffice' ? 'mo_not_mvmoffice' : 'mo_load_failed'), 'bad');
        if (!this.doc && this.listEl.hidden) this.showList();
      }
    }

    // ── The open document ──────────────────────────────────────────────────
    openDoc(doc, source) {
      this.closeDoc(true);
      doc = M.normalize(doc);
      M.dropOrphans(doc);
      this.doc = doc;
      this.source = source;
      this.engine = new F.Engine(doc);
      this.schema = E.makeSchema(this);
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      this.conflict = false;
      this.conflictEl.hidden = true;
      this.listEl.hidden = true;
      this.docEl.hidden = false;
      this.titleEl.value = doc.title;
      this.applyPage();
      this.showWhere();
      this.setStatus(source.kind === 'local' ? 'local' : 'saved');
      this.renderSide();
      if (doc.pages.length) this.showPage(doc.pages[0].id);
      else if (doc.sheets.length) this.showSheet(doc.sheets[0].id);
      else this.showEmpty();
    }
    closeDoc(silent) {
      this.closeFormulaBox();
      this.closeMenus();
      if (this.editor) { this.editor.destroy(); this.editor = null; }
      if (this.sheetGrid) { this.sheetGrid.destroy(); this.sheetGrid = null; }
      this.activeGrid = null;
      this.setPick(null);
      this.carry = null;
      this.view = null;
      if (!silent) this.doc = null;
    }
    async leaveDoc() {
      if (!this.doc) return true;
      if (this.source.kind === 'local' && this.dirty) {
        if (!(await this.confirm(t('mo_leave_unsaved'), t('mo_leave')))) return false;
      } else this.flushSave();
      return true;
    }
    showWhere() {
      const s = this.source;
      const label = {
        cloud: '☁ ' + t('mo_where_cloud'),
        local: '💻 ' + (s.name || ''),
        server: '🗄 ' + (s.path || '').split('/').pop(),
      }[s.kind];
      this.whereEl.textContent = label;
      this.whereEl.title = s.kind === 'server' ? s.path : s.kind === 'local' ? t('mo_where_local_hint') : t('mo_where_cloud_hint');
    }

    // ── Sidebar ────────────────────────────────────────────────────────────
    renderSide() {
      const d = this.doc;
      const v = this.view || {};
      const item = (kind, id, icon, label) => `
        <div class="mo-si${v.kind === kind && v.id === id ? ' on' : ''}" data-s="${kind}" data-id="${id}">
          <span class="mo-si-ico">${icon}</span><span class="mo-si-name">${esc(label)}</span>
          <button class="mo-ib mo-si-more" data-s="more-${kind}" data-id="${id}" title="${esc(t('mo_more'))}">⋯</button>
        </div>`;
      this.sideEl.innerHTML = `
        <div class="mo-sh"><span>${esc(t('mo_pages'))}</span><button class="mo-ib" data-s="addpage" title="${esc(t('mo_add_page'))}">+</button></div>
        ${d.pages.map(p => item('page', p.id, '📄', p.title || t('mo_untitled'))).join('') || `<div class="mo-snone">${esc(t('mo_no_pages'))}</div>`}
        <div class="mo-sh"><span>${esc(t('mo_data'))}</span><button class="mo-ib" data-s="addsheet" title="${esc(t('mo_add_sheet'))}">+</button></div>
        ${d.sheets.map(s => item('sheet', s.id, '📊', (d.tables[s.tableId] || {}).name || '?')).join('') || `<div class="mo-snone">${esc(t('mo_no_sheets'))}</div>`}
        <div class="mo-shint">${esc(t('mo_data_hint'))}</div>`;
      this.sideEl.onclick = e => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const a = b.dataset.s, id = b.dataset.id;
        if (a === 'page' || a === 'sheet') {
          const carrying = this.carryFormula();
          if (a === 'page') this.showPage(id); else this.showSheet(id);
          if (carrying) this.resumeCarry();
          this.root.classList.remove('mo-side-open');
        }
        else if (a === 'addpage') this.addPage();
        else if (a === 'addsheet') this.addSheet();
        else if (a === 'more-page' || a === 'more-sheet') {
          e.stopPropagation();
          const r = b.getBoundingClientRect();
          this.menu(r.left, r.bottom + 2, a === 'more-page' ? this.pageMenu(id) : this.sheetMenu(id));
        }
      };
      // Keep the formula being typed focused, so it can move along.
      this.sideEl.onmousedown = e => {
        if (e.target.closest('[data-s="page"],[data-s="sheet"]') && (this.fbox || this.formulaInProgress())) e.preventDefault();
      };
      this.sideEl.ondblclick = e => {
        const b = e.target.closest('.mo-si');
        if (!b) return;
        if (b.dataset.s === 'page') this.renamePage(b.dataset.id);
        else this.renameSheet(b.dataset.id);
      };
    }
    pageMenu(id) {
      const i = this.doc.pages.findIndex(p => p.id === id);
      return [
        { icon: '✎', label: t('mo_rename'), onClick: () => this.renamePage(id) },
        { icon: '↑', label: t('mo_move_up'), disabled: i === 0, onClick: () => this.movePage(i, -1) },
        { icon: '↓', label: t('mo_move_down'), disabled: i === this.doc.pages.length - 1, onClick: () => this.movePage(i, 1) },
        '-',
        { icon: '🗑', label: t('mo_delete'), danger: true, onClick: () => this.deletePage(id) },
      ];
    }
    sheetMenu(id) {
      const i = this.doc.sheets.findIndex(s => s.id === id);
      return [
        { icon: '✎', label: t('mo_rename'), onClick: () => this.renameSheet(id) },
        { icon: '↑', label: t('mo_move_up'), disabled: i === 0, onClick: () => this.moveSheet(i, -1) },
        { icon: '↓', label: t('mo_move_down'), disabled: i === this.doc.sheets.length - 1, onClick: () => this.moveSheet(i, 1) },
        { icon: '🖨', label: t('mo_print_sheet'), onClick: () => this.printSheet(id) },
        { icon: '📊', label: t('mo_export_sheet_xlsx'), onClick: () => this.exportXlsx([this.sheetTable(id).id]) },
        '-',
        { icon: '🗑', label: t('mo_delete'), danger: true, onClick: () => this.deleteSheet(id) },
      ];
    }
    addPage() {
      const p = M.addPage(this.doc, t('mo_page_base') + ' ' + (this.doc.pages.length + 1));
      this.renderSide();
      this.showPage(p.id);
      this.scheduleSave();
    }
    async renamePage(id) {
      const p = this.doc.pages.find(x => x.id === id);
      if (!p) return;
      const name = await this.prompt(t('mo_rename_page'), p.title);
      if (name == null || !name.trim()) return;
      p.title = name.trim().slice(0, 100);
      this.renderSide();
      this.scheduleSave();
    }
    movePage(i, d) {
      const a = this.doc.pages;
      if (i + d < 0 || i + d >= a.length) return;
      [a[i], a[i + d]] = [a[i + d], a[i]];
      this.renderSide();
      this.scheduleSave();
    }
    async deletePage(id) {
      const p = this.doc.pages.find(x => x.id === id);
      if (!p) return;
      if (!(await this.confirm(t('mo_delete_page_confirm', { title: p.title }), t('mo_delete')))) return;
      if (this.editor && this.editor.page.id === id) { this.closeFormulaBox(); this.editor.destroy(); this.editor = null; }
      this.doc.pages = this.doc.pages.filter(x => x.id !== id);
      this.engine.invalidate();
      this.afterRemoval();
      this.scheduleSave();
    }
    afterRemoval() {
      const v = this.view;
      const stillThere = v && (v.kind === 'page' ? this.doc.pages.some(p => p.id === v.id) : this.doc.sheets.some(s => s.id === v.id));
      if (!stillThere) {
        this.view = null;
        if (this.doc.pages.length) this.showPage(this.doc.pages[0].id);
        else if (this.doc.sheets.length) this.showSheet(this.doc.sheets[0].id);
        else this.showEmpty();
      }
      this.renderSide();
    }
    addSheet() {
      const before = this.snapshot();
      const s = M.addSheet(this.doc, M.uniqueName(this.doc, t('mo_sheet_base') + '1'));
      this.pushUndo({ type: 'snap', before, after: this.snapshot() });
      this.engine.invalidate();
      this.renderSide();
      this.showSheet(s.id);
      this.scheduleSave();
    }
    async renameSheet(id) {
      const s = this.doc.sheets.find(x => x.id === id);
      const tb = s && this.doc.tables[s.tableId];
      if (!tb) return;
      const name = await this.prompt(t('mo_rename_sheet'), tb.name, t('mo_rename_sheet_hint'));
      if (name != null) this.renameTable(tb, name);
    }
    renameTable(tb, name) {
      name = String(name).trim();
      if (name === tb.name) return true;
      const err = M.validateName(this.doc, name, tb.id);
      if (err) { this.toast(t(err), 'bad'); return false; }
      const before = this.snapshot();
      const fn = M.renameRewriter(this.doc, tb, name);
      M.eachFormula(this.doc, fn);
      if (this.editor) this.editor.rewriteFormulas(fn);
      tb.name = name;
      this.pushUndo({ type: 'snap', before, after: this.snapshot() });
      this.renderSide();
      this.changed();
      return true;
    }
    moveSheet(i, d) {
      const a = this.doc.sheets;
      if (i + d < 0 || i + d >= a.length) return;
      [a[i], a[i + d]] = [a[i + d], a[i]];
      this.renderSide();
      this.scheduleSave();
    }
    async deleteSheet(id) {
      const s = this.doc.sheets.find(x => x.id === id);
      const tb = s && this.doc.tables[s.tableId];
      if (!s) return;
      if (!(await this.confirm(t('mo_delete_sheet_confirm', { title: tb ? tb.name : '' }), t('mo_delete')))) return;
      const before = this.snapshot();
      this.doc.sheets = this.doc.sheets.filter(x => x.id !== id);
      if (tb) delete this.doc.tables[tb.id];
      this.pushUndo({ type: 'snap', before, after: this.snapshot() });
      if (this.view && this.view.kind === 'sheet' && this.view.id === id && this.sheetGrid) { this.sheetGrid.destroy(); this.sheetGrid = null; }
      this.engine.invalidate();
      this.afterRemoval();
      this.changed();
    }

    // ── Views ──────────────────────────────────────────────────────────────
    showPage(id) {
      const page = this.doc.pages.find(p => p.id === id);
      if (!page) return;
      if (this.sheetGrid) { this.sheetGrid.destroy(); this.sheetGrid = null; }
      if (!this.editor || this.editor.page !== page) {
        this.closeFormulaBox();
        if (this.editor) this.editor.destroy();
        this.pageHost.innerHTML = '';
        this.editor = new E.PageEditor(this, this.pageHost, page);
      }
      this.view = { kind: 'page', id };
      this.deskEl.hidden = false;
      this.sheetHost.hidden = true;
      this.emptyEl.hidden = true;
      this.activate(null);
      this.renderSide();
      if (!this.carry && !this.fbox) this.editor.focus();
      this.setMode('text');
      if (this.fbox) this.fbox.place();
    }
    showSheet(id) {
      const s = this.doc.sheets.find(x => x.id === id);
      const tb = s && this.doc.tables[s.tableId];
      if (!tb) return;
      // The page stays open underneath, so a formula being written in the
      // text can take its references from here.
      if (this.sheetGrid) this.sheetGrid.destroy();
      this.sheetHost.innerHTML = '';
      this.view = { kind: 'sheet', id };
      this.deskEl.hidden = true;
      this.emptyEl.hidden = true;
      this.sheetHost.hidden = false;
      this.sheetGrid = new G.Grid(this.sheetHost, { office: this, table: tb, mode: 'sheet' });
      this.renderSide();
      this.activate(this.sheetGrid);
      if (!this.fbox && !this.carry) this.sheetGrid.focus();
      this.onSelect(this.sheetGrid);
      if (this.fbox) this.fbox.place();
    }
    showEmpty() {
      this.view = null;
      this.deskEl.hidden = true;
      this.sheetHost.hidden = true;
      this.emptyEl.hidden = false;
      this.emptyEl.innerHTML = `<div class="mo-start"><p>${esc(t('mo_doc_empty'))}</p></div>`;
      this.setMode('none');
    }
    setMode(mode) {
      this.mode = mode;
      this.root.classList.toggle('mo-mode-cell', mode === 'cell');
      this.root.classList.toggle('mo-mode-text', mode === 'text');
      this.fbarEl.hidden = mode !== 'cell' && !this.carry;
      if (mode === 'text') this.updateTextTools();
      if (mode === 'cell') { this.updateFbar(); this.updateCellTools(); }
    }

    // ── Grid callbacks ─────────────────────────────────────────────────────
    activate(grid) {
      if (this.activeGrid === grid) {
        if (grid) { this.lastFocus = 'cell'; this.setMode('cell'); }
        return;
      }
      const old = this.activeGrid;
      this.activeGrid = grid;
      if (old && !old.destroyed) old.setActive(false);
      if (grid) {
        grid.setActive(true);
        this.lastFocus = 'cell';
        this.setMode('cell');
      } else if (this.view && this.view.kind === 'page') this.setMode('text');
    }
    onTextFocus() { this.lastFocus = 'text'; this.setMode('text'); }
    onTextSelection() {
      if (this._tsRaf) return;
      this._tsRaf = requestAnimationFrame(() => { this._tsRaf = null; if (this.mode === 'text') this.updateTextTools(); });
    }
    textChanged() { this.scheduleSave(); }
    onSelect(grid) {
      if (grid !== this.activeGrid) return;
      this.updateFbar();
      this.updateCellTools();
    }
    leaveEmbed(grid) { if (this.editor) this.editor.leaveEmbed(grid); }
    setPick(p) {
      if (this.pick && this.pick !== p) this.pick.clearMark();
      this.pick = p;
    }
    growTable(tb, rows, cols) {
      tb.rows = Math.min(M.MAX_ROWS, rows);
      tb.cols = Math.min(M.MAX_COLS, cols);
      if (this.sheetGrid && this.sheetGrid.table === tb) this.sheetGrid.render();
      this.scheduleSave();
    }
    setCells(tb, changes) {
      const before = {}, after = {};
      for (const [k, v] of Object.entries(changes)) {
        before[k] = tb.cells[k] ? M.clone(tb.cells[k]) : null;
        if (v == null) delete tb.cells[k]; else tb.cells[k] = v;
        after[k] = v == null ? null : M.clone(v);
      }
      this.pushUndo({ type: 'cells', tableId: tb.id, before, after });
      this.changed();
    }
    // Rows (axis 'r') or columns ('c') inserted (count > 0) or deleted
    // (count < 0) at `at`; every formula pointing past them follows.
    structural(tb, axis, at, count) {
      if (count < 0) {
        const size = axis === 'r' ? tb.rows : tb.cols;
        count = -Math.min(-count, size - 1 - 0, size - at);
        if (count === 0) return;
        if ((axis === 'r' ? tb.rows : tb.cols) + count < 1) return;
      }
      const before = this.snapshot();
      const fn = M.shiftRewriter(this.doc, tb, axis, at, count);
      M.eachFormula(this.doc, fn);
      if (this.editor) this.editor.rewriteFormulas(fn);
      M.shiftCells(tb, axis, at, count);
      this.pushUndo({ type: 'snap', before, after: this.snapshot() });
      this.changed();
    }
    changed(opts) {
      if (opts && opts.layoutOnly) { this.scheduleSave(); return; }
      this.engine.invalidate();
      if (this.sheetGrid) this.sheetGrid.render();
      if (this.editor) this.editor.refresh();
      if (this.fbox) this.fbox.preview();
      if (this.mode === 'cell') { this.updateFbar(); this.updateCellTools(); }
      this.scheduleSave();
    }
    embedAction(grid, act) {
      const tb = grid.table;
      if (act === 'rename') {
        this.prompt(t('mo_rename_table'), tb.name, t('mo_rename_sheet_hint')).then(name => { if (name != null) this.renameTable(tb, name); });
      } else if (act === 'addrow') this.structural(tb, 'r', tb.rows, 1);
      else if (act === 'addcol') this.structural(tb, 'c', tb.cols, 1);
      else if (act === 'header') {
        const before = this.snapshot();
        tb.header = !tb.header;
        this.pushUndo({ type: 'snap', before, after: this.snapshot() });
        this.changed();
      } else if (act === 'delete') {
        if (this.editor) this.editor.removeEmbed(grid);
      } else if (act === 'xlsx') {
        this.exportXlsx([tb.id]);
      }
    }
    gridMenu(grid, x, y, hit) {
      const tb = grid.table;
      const { r1, r2, c1, c2 } = grid.selRect();
      const nr = r2 - r1 + 1, nc = c2 - c1 + 1;
      const items = [
        { icon: '✂', label: t('mo_cut'), onClick: () => { grid.focus(); document.execCommand('cut'); } },
        { icon: '⧉', label: t('mo_copy'), onClick: () => { grid.focus(); document.execCommand('copy'); } },
        { icon: '📋', label: t('mo_paste'), onClick: () => this.pasteFromClipboard(grid) },
        '-',
      ];
      const rows = hit.col == null;
      const cols = hit.row == null;
      if (rows) {
        items.push({ icon: '⤒', label: t('mo_insert_row_above'), onClick: () => this.structural(tb, 'r', r1, nr) });
        items.push({ icon: '⤓', label: t('mo_insert_row_below'), onClick: () => this.structural(tb, 'r', r2 + 1, nr) });
      }
      if (cols) {
        items.push({ icon: '⇤', label: t('mo_insert_col_left'), onClick: () => this.structural(tb, 'c', c1, nc) });
        items.push({ icon: '⇥', label: t('mo_insert_col_right'), onClick: () => this.structural(tb, 'c', c2 + 1, nc) });
      }
      items.push('-');
      if (rows) items.push({ icon: '🗑', label: nr > 1 ? t('mo_delete_rows', { n: nr }) : t('mo_delete_row'), danger: true, disabled: nr >= tb.rows, onClick: () => { this.structural(tb, 'r', r1, -nr); grid.select(Math.min(r1, tb.rows - 1), c1, false); } });
      if (cols) items.push({ icon: '🗑', label: nc > 1 ? t('mo_delete_cols', { n: nc }) : t('mo_delete_col'), danger: true, disabled: nc >= tb.cols, onClick: () => { this.structural(tb, 'c', c1, -nc); grid.select(r1, Math.min(c1, tb.cols - 1), false); } });
      items.push({ icon: '⌫', label: t('mo_clear'), onClick: () => grid.clearSelection() });
      if (cols && nc === 1) items.push({ icon: '↔', label: t('mo_autofit'), onClick: () => grid.autoFit(c1) });
      this.menu(x, y, items);
    }
    async pasteFromClipboard(grid) {
      try {
        const text = await navigator.clipboard.readText();
        grid.pasteText(text, '');
      } catch (e) { this.toast(t('mo_paste_keyboard'), 'bad'); }
      grid.focus();
    }

    // ── Things the text asks for ───────────────────────────────────────────
    tableFromRows(rows) {
      const cols = Math.max(1, ...rows.map(r => r.length));
      const tb = M.newTable(this.doc, 'embed', M.uniqueName(this.doc, t('mo_table_base') + '1'), Math.max(1, rows.length), cols);
      rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') tb.cells[r + ',' + c] = G.typedCell(null, v); }));
      this.engine.invalidate();
      return tb;
    }
    copyTable(tb) {
      const n = M.clone(tb);
      n.id = M.uid();
      n.name = M.uniqueName(this.doc, tb.name);
      this.doc.tables[n.id] = n;
      this.engine.invalidate();
      return n;
    }
    tableIdsInText(ed) {
      const ids = new Set();
      for (const p of this.doc.pages) {
        const content = ed && ed.page === p && ed.view ? ed.view.state.doc.toJSON() : p.content;
        M.walkJSON(content, n => { if (n.type === 'table_embed' && n.attrs) ids.add(n.attrs.tableId); });
      }
      return ids;
    }
    inlineFormat(expr, fmt) {
      if (fmt) return fmt;
      const src = String(expr || '').replace(/^=/, '');
      return this.engine.astFormat(this.engine.ast(src), null, 0);
    }
    inlineText(expr, fmt) {
      if (!expr) return '';
      return F.formatValue(this.engine.evaluate(expr), this.inlineFormat(expr, fmt));
    }
    inlineIsError(expr) { return !!expr && F.isErr(this.engine.evaluate(expr)); }
    insertTable() {
      if (!this.editor) return;
      const tb = M.newTable(this.doc, 'embed', M.uniqueName(this.doc, t('mo_table_base') + '1'));
      this.engine.invalidate();
      this.editor.insertTable(tb);
    }

    // ── Commands ───────────────────────────────────────────────────────────
    command(a, btn) {
      const ed = this.editor;
      const g = this.activeGrid;
      const cell = this.mode === 'cell' && g;
      switch (a) {
        case 'side': this.root.classList.toggle('mo-side-open'); return;
        case 'back': this.leaveDoc().then(ok => { if (ok) this.showList(); }); return;
        case 'file': this.fileMenu(btn); return;
        case 'theirs': this.reloadTheirs(); return;
        case 'mine': this.keepMine(); return;
        case 'undo': if (this.lastFocus === 'text' && ed && this.mode === 'text') ed.undo(); else this.undo(); return;
        case 'redo': if (this.lastFocus === 'text' && ed && this.mode === 'text') ed.redo(); else this.redo(); return;
      }
      if (cell) {
        const map = { b: 'b', i: 'i', u: 'u', s: 's' };
        if (map[a]) { g.toggleStyle(map[a]); return; }
        if (a === 'al' || a === 'ac' || a === 'ar') {
          const want = { al: 'left', ac: 'center', ar: 'right' }[a];
          const cur = g.activeCell();
          g.applyStyle({ a: cur && cur.a === want ? null : want });
          return;
        }
        if (a === 'color') { this.palette(btn, COLORS, c => g.applyStyle({ fg: c })); return; }
        if (a === 'fill') { this.palette(btn, FILLS, c => g.applyStyle({ bg: c })); return; }
        if (a === 'dec-' || a === 'dec+') { this.changeDecimals(a === 'dec+' ? 1 : -1); return; }
        return;
      }
      if (!ed || this.mode !== 'text') return;
      switch (a) {
        case 'b': ed.toggleMark('strong'); break;
        case 'i': ed.toggleMark('em'); break;
        case 'u': ed.toggleMark('underline'); break;
        case 's': ed.toggleMark('strike'); break;
        case 'color': this.palette(btn, COLORS, c => ed.setColor(c)); return;
        case 'al': ed.setAlign('left'); break;
        case 'ac': ed.setAlign('center'); break;
        case 'ar': ed.setAlign('right'); break;
        case 'aj': ed.setAlign('justify'); break;
        case 'ul': ed.toggleList('bullet_list'); break;
        case 'ol': ed.toggleList('ordered_list'); break;
        case 'table': this.insertTable(); return;
        case 'fx': ed.insertFormula(); return;
        case 'pb': ed.insertPageBreak(); break;
      }
      this.updateTextTools();
    }
    onRootKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !this.doc || this.docEl.hidden) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); if (this.source.kind === 'local') this.download(this.doc); else this.flushSave(); }
      else if (k === 'p') { e.preventDefault(); if (this.view && this.view.kind === 'sheet') this.printSheet(this.view.id); else this.printDoc(); }
    }
    fileMenu(btn) {
      const r = btn.getBoundingClientRect();
      const s = this.source;
      const items = [
        { icon: '⬇', label: t('mo_download'), hint: EXT, onClick: () => this.download(this.doc) },
      ];
      if (s.kind !== 'cloud') items.push({ icon: '☁', label: t('mo_save_to_cloud'), onClick: () => this.saveToCloud() });
      else items.push({ icon: '⧉', label: t('mo_save_copy_cloud'), onClick: () => this.saveCopyToCloud() });
      if (this.desktop) items.push({ icon: '🗄', label: t('mo_save_to_folder'), onClick: () => this.saveToFolder() });
      if (this.exportables().length) items.push({ icon: '📊', label: t('mo_export_xlsx'), hint: '.xlsx', onClick: () => this.exportDialog() });
      if (this.doc.pages.length) {
        items.push({ icon: '📄', label: t('mo_export_docx'), hint: '.docx', onClick: () => this.exportDocx() });
        items.push({ icon: '📕', label: t('mo_export_pdf'), hint: '.pdf', onClick: () => this.exportPdf() });
      }
      items.push('-');
      items.push({ icon: '📐', label: t('mo_page_setup'), onClick: () => this.pageSetup() });
      if (this.doc.pages.length) items.push({ icon: '🖨', label: t('mo_print_doc'), onClick: () => this.printDoc() });
      if (this.view && this.view.kind === 'sheet') items.push({ icon: '🖨', label: t('mo_print_sheet'), onClick: () => this.printSheet(this.view.id) });
      // The preview shows what Print would print from where the user is now.
      if (this.view && this.view.kind === 'sheet') items.push({ icon: '🔍', label: t('mo_print_preview'), onClick: () => this.printSheet(this.view.id, true) });
      else if (this.doc.pages.length) items.push({ icon: '🔍', label: t('mo_print_preview'), onClick: () => this.printDoc(true) });
      items.push('-');
      items.push({ icon: '✕', label: t('mo_close'), onClick: () => this.leaveDoc().then(ok => { if (ok) this.showList(); }) });
      this.menu(r.right - 240, r.bottom + 4, items);
    }

    updateTextTools() {
      const ed = this.editor;
      if (!ed) return;
      const on = (a, v) => { const b = this.toolsEl.querySelector(`[data-a="${a}"]`); if (b) b.classList.toggle('on', !!v); };
      on('b', ed.markActive('strong'));
      on('i', ed.markActive('em'));
      on('u', ed.markActive('underline'));
      on('s', ed.markActive('strike'));
      const al = ed.align();
      on('al', al === 'left'); on('ac', al === 'center'); on('ar', al === 'right'); on('aj', al === 'justify');
      on('ul', ed.inList('bullet_list'));
      on('ol', ed.inList('ordered_list'));
      if (document.activeElement !== this.blockSel) this.blockSel.value = ed.blockType();
    }
    updateCellTools() {
      const g = this.activeGrid;
      if (!g) return;
      const cell = g.activeCell() || {};
      const on = (a, v) => { const b = this.toolsEl.querySelector(`[data-a="${a}"]`); if (b) b.classList.toggle('on', !!v); };
      on('b', cell.b); on('i', cell.i); on('u', cell.u); on('s', cell.s);
      on('al', cell.a === 'left'); on('ac', cell.a === 'center'); on('ar', cell.a === 'right');
      if (document.activeElement !== this.fmtSel) this.fmtSel.value = formatKey(cell.f);
    }
    setCellFormat(key) {
      const g = this.activeGrid;
      if (!g) return;
      const f = FORMATS[key];
      g.applyStyle({ f: f ? M.clone(f) : null });
      g.focus();
    }
    changeDecimals(d) {
      const g = this.activeGrid;
      const eng = this.engine;
      const tb = g.table;
      g.forSelection((cell, r, c) => {
        if (!cell || cell.v == null) return undefined;
        const v = eng.value(tb, r, c);
        if (typeof v !== 'number') return undefined;
        let f = cell.f && cell.f.type && cell.f.type !== 'general' ? M.clone(cell.f) : M.clone(eng.autoFormat(tb, r, c) || { type: 'number' });
        if (f.type === 'date' || f.type === 'text') return undefined;
        if (f.dec == null) {
          const s = String(v);
          f.dec = f.type === 'number' && !cell.f ? (s.includes('.') ? s.split('.')[1].length : 0) : 2;
        }
        f.dec = Math.max(0, Math.min(10, f.dec + d));
        return Object.assign({}, cell, { f });
      });
    }

    // ── Formula bar ────────────────────────────────────────────────────────
    setupFormulaBar() {
      const fin = this.finEl;
      let target = null, pick = null, assist = null, done = false;
      const finish = (dir) => {
        if (!target) return;
        const g = target.grid, value = fin.value;
        const tgt = target;
        target = null;
        if (assist) { assist.detach(); assist = null; }
        if (this.pick === pick) this.setPick(null);
        if (tgt.carry) { this.endCarry(value, dir); return; }
        if (g.destroyed) return;
        if (g.editing) g.commitEdit(dir, value);
        else if (value !== tgt.orig) {
          g.setRaw(tgt.r, tgt.c, value);
          if (dir) g.select(tgt.r + (dir === 'down' ? 1 : 0), tgt.c + (dir === 'right' ? 1 : 0), false);
        } else if (dir) g.select(tgt.r + (dir === 'down' ? 1 : 0), tgt.c + (dir === 'right' ? 1 : 0), false);
        if (dir) g.focus();
      };
      fin.addEventListener('focus', () => {
        const cr = this.carry;
        if (cr) {
          done = false;
          target = { carry: true };
          pick = new G.PickTarget(fin, cr.table, () => {});
          this.setPick(pick);
          assist = this.attachAssist(fin, cr.table);
          return;
        }
        const g = this.activeGrid;
        if (!g) return;
        done = false;
        target = { grid: g, r: g.editing ? g.editing.r : g.sel.r, c: g.editing ? g.editing.c : g.sel.c, orig: g.editing ? g.editing.orig : g.activeText() };
        pick = new G.PickTarget(fin, g.table, () => sync());
        this.setPick(pick);
        assist = this.attachAssist(fin, g.table);
      });
      const sync = () => {
        const g = target && target.grid;
        if (g && g.editing) { g.editing.el.value = fin.value; g.grow(); }
      };
      fin.addEventListener('input', sync);
      fin.addEventListener('keydown', e => {
        if (assist && assist.handleKey(e)) return;
        if (e.key === 'Enter') { e.preventDefault(); done = true; finish('down'); }
        else if (e.key === 'Tab') { e.preventDefault(); done = true; finish('right'); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          if (target && target.carry) {
            target = null;
            if (assist) { assist.detach(); assist = null; }
            if (this.pick === pick) this.setPick(null);
            this.endCarry(null, null);
            return;
          }
          const g = target && target.grid;
          if (target) fin.value = target.orig;
          target = null;
          if (assist) { assist.detach(); assist = null; }
          if (this.pick === pick) this.setPick(null);
          if (g) { if (g.editing) g.cancelEdit(); else g.focus(); }
        }
      });
      fin.addEventListener('blur', () => {
        setTimeout(() => {
          if (done || document.activeElement === fin) return;
          const g = target && target.grid;
          // Back into the cell being edited: it carries on from there.
          if (g && g.editing && document.activeElement === g.editing.el) {
            target = null;
            if (assist) { assist.detach(); assist = null; }
            if (this.pick === pick) this.setPick(g.editing.pick);
            return;
          }
          finish(null);
        }, 0);
      });

      // A formula being typed in a cell moves into the formula bar when you
      // go to another page or data sheet, so references can be picked there
      // too; Enter puts it in its cell and brings you back, as in Excel.
      this.formulaInProgress = () => {
        if (this.carry) return true;
        if (target && document.activeElement === fin) return fin.value.startsWith('=');
        const g = this.activeGrid;
        return !!(g && g.editing && g.editing.el.value.startsWith('='));
      };
      this.carryFormula = () => {
        if (this.carry) return true;
        if (!this.formulaInProgress()) return false;
        const inBar = !!target && document.activeElement === fin;
        const g = inBar ? target.grid : this.activeGrid;
        const ed = g.editing;
        const r = inBar ? target.r : ed.r, c = inBar ? target.c : ed.c;
        const orig = inBar ? target.orig : ed.orig;
        const el = inBar ? fin : ed.el;
        this.carry = { table: g.table, grid: g, r, c, orig, back: this.view, value: el.value, caret: el.selectionStart };
        if (inBar) target = { carry: true };
        if (g.editing) g.endEdit();
        return true;
      };
      this.resumeCarry = () => {
        const cr = this.carry;
        this.fbarEl.hidden = false;
        this.addrEl.textContent = F.quoteName(cr.table.name) + '!' + F.cellText(cr.r, cr.c);
        if (document.activeElement !== fin) {
          fin.value = cr.value;
          fin.focus();
          fin.setSelectionRange(cr.caret, cr.caret);
        }
      };
    }
    // value null: the formula is dropped.
    endCarry(value, dir) {
      const cr = this.carry;
      if (!cr) return;
      this.carry = null;
      const tb = cr.table;
      if (!Object.values(this.doc.tables).includes(tb)) { this.setMode(this.mode); return; }
      if (value && value.startsWith('=')) { value = F.closeParens(value); this.formulaHint(value); }
      if (value != null && value !== cr.orig) {
        const k = cr.r + ',' + cr.c;
        const next = Object.assign({}, tb.cells[k] || {});
        if (value === '') delete next.v; else next.v = value;
        this.setCells(tb, { [k]: Object.keys(next).length ? next : null });
      }
      const b = cr.back, v = this.view;
      if (b && (!v || b.kind !== v.kind || b.id !== v.id)) {
        if (b.kind === 'page') this.showPage(b.id); else this.showSheet(b.id);
      }
      const g = cr.grid && !cr.grid.destroyed ? cr.grid : this.sheetGrid && this.sheetGrid.table === tb ? this.sheetGrid : null;
      if (!g) { this.setMode(this.mode); return; }
      const d = { down: [1, 0], right: [0, 1] }[dir] || [0, 0];
      g.select(Math.min(tb.rows - 1, cr.r + d[0]), Math.min(tb.cols - 1, cr.c + d[1]), false);
      g.focus();
    }
    updateFbar() {
      const g = this.activeGrid;
      if (!g || document.activeElement === this.finEl || this.carry) return;
      this.addrEl.textContent = (g.mode === 'embed' ? g.table.name + '!' : '') + g.address();
      this.finEl.value = g.editing ? g.editing.el.value : g.activeText();
    }
    onEditInput(grid, value) {
      if (grid !== this.activeGrid || document.activeElement === this.finEl) return;
      this.finEl.value = value == null ? grid.activeText() : value;
    }

    // ── Suggestions while writing a formula ────────────────────────────────
    // Functions and table names as you type, columns after "Table[", and the
    // arguments of the function the cursor is in.
    attachAssist(input, ctxTable) {
      const box = document.createElement('div');
      box.className = 'mo-assist';
      box.hidden = true;
      this.root.appendChild(box);
      let items = [], idx = 0, span = null;
      const fnNames = Object.keys(F.FN).sort();
      const place = () => {
        const rr = this.root.getBoundingClientRect();
        const ir = input.getBoundingClientRect();
        box.style.left = Math.max(4, Math.min(ir.left - rr.left, rr.width - 320)) + 'px';
        box.style.top = (ir.bottom - rr.top + 2) + 'px';
      };
      const hintFor = before => {
        let depth = 0, inStr = false;
        for (let i = before.length - 1; i >= 0; i--) {
          const ch = before[i];
          if (ch === '"') inStr = !inStr;
          if (inStr) continue;
          if (ch === ')') depth++;
          else if (ch === '(') {
            if (depth === 0) {
              const m = before.slice(0, i).match(/([A-Za-z][A-Za-z0-9.]*)$/);
              return m ? F.FN_HINTS[m[1].toUpperCase()] || null : null;
            }
            depth--;
          }
        }
        return null;
      };
      const update = () => {
        const v = input.value;
        const pos = input.selectionStart;
        const before = v.slice(0, pos);
        items = [];
        span = null;
        const quotes = (before.match(/"/g) || []).length;
        const formula = !ctxTable || v.startsWith('=');
        if (formula && quotes % 2 === 0) {
          const cm = before.match(/('(?:[^']|'')+'|[^\s!'"()\[\],;=+\-*/^&<>:]+)\[([^\]]*)$/);
          if (cm) {
            const name = cm[1].startsWith("'") ? cm[1].slice(1, -1).replace(/''/g, "'") : cm[1];
            const tb = this.engine.table(name);
            if (tb) {
              const want = cm[2].trim().toLowerCase();
              for (let c = 0; c < tb.cols && items.length < 12; c++) {
                const h = tb.cells[0 + ',' + c];
                const text = h && h.v != null ? String(h.v).trim() : '';
                if (!text || text.startsWith('=') || /[\[\]]/.test(text)) continue;
                if (!want || text.toLowerCase().includes(want)) items.push({ kind: 'col', label: text, insert: text + ']', hint: tb.name });
              }
              span = { s: pos - cm[2].length, e: pos };
            }
          } else {
            const wm = before.match(/(^|[^A-Za-z0-9_.!$À-￿'])([A-Za-z_À-￿][A-Za-z0-9_.À-￿]*)$/);
            if (wm && !F.parseCell(wm[2])) {
              const w = wm[2];
              const up = w.toUpperCase();
              for (const n of fnNames) if (n.startsWith(up) && items.length < 8) items.push({ kind: 'fn', label: n, insert: n + '(', hint: F.FN_HINTS[n] || '' });
              for (const tb of Object.values(this.doc.tables)) {
                if (tb.name.toLowerCase().startsWith(w.toLowerCase()) && items.length < 12) {
                  const q = F.quoteName(tb.name);
                  items.push({ kind: 'table', label: tb.name, insert: q, hint: t(tb.kind === 'sheet' ? 'mo_sheet' : 'mo_table') });
                }
              }
              span = { s: pos - w.length, e: pos };
              if (items.length === 1 && items[0].label.toUpperCase() === up && items[0].kind === 'fn') items = [];
            }
          }
        }
        const hint = formula && quotes % 2 === 0 ? hintFor(before) : null;
        if (!items.length && !hint) { box.hidden = true; return; }
        idx = Math.min(idx, Math.max(0, items.length - 1));
        box.innerHTML = items.map((it, i) => `
          <div class="mo-as-item${i === idx ? ' on' : ''}" data-i="${i}">
            <span class="mo-as-kind mo-as-${it.kind}">${it.kind === 'fn' ? 'ƒ' : it.kind === 'col' ? '▥' : '▦'}</span>
            <span class="mo-as-label">${esc(it.label)}</span><span class="mo-as-hint">${esc(it.hint)}</span>
          </div>`).join('') + (hint ? `<div class="mo-as-sig">${esc(hint)}</div>` : '');
        box.hidden = false;
        place();
      };
      const accept = i => {
        const it = items[i];
        if (!it || !span) return;
        const v = input.value;
        input.value = v.slice(0, span.s) + it.insert + v.slice(span.e);
        const p = span.s + it.insert.length;
        input.setSelectionRange(p, p);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        update();
      };
      const onInput = () => { idx = 0; update(); };
      const onBlur = () => setTimeout(() => { if (document.activeElement !== input) box.hidden = true; }, 100);
      input.addEventListener('input', onInput);
      input.addEventListener('click', update);
      input.addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') update(); });
      input.addEventListener('blur', onBlur);
      input.addEventListener('focus', update);
      box.addEventListener('mousedown', e => {
        e.preventDefault();
        const el = e.target.closest('[data-i]');
        if (el) accept(+el.dataset.i);
      });
      return {
        handleKey(e) {
          if (box.hidden || !items.length) return false;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            update();
            return true;
          }
          if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); accept(idx); return true; }
          if (e.key === 'Escape') { e.preventDefault(); box.hidden = true; items = []; return true; }
          return false;
        },
        refresh: update,
        detach() {
          input.removeEventListener('input', onInput);
          input.removeEventListener('click', update);
          input.removeEventListener('blur', onBlur);
          input.removeEventListener('focus', update);
          box.remove();
        },
      };
    }

    // ── A value inside the text ────────────────────────────────────────────
    formulaBox(o) {
      this.closeFormulaBox();
      const box = document.createElement('div');
      box.className = 'mo-fbox';
      box.innerHTML = `
        <div class="mo-fb-head"><b>ƒx ${esc(t('mo_formula_in_text'))}</b><span class="mo-grow"></span><button class="mo-ib" data-f="cancel">✕</button></div>
        <div class="mo-fb-row"><span class="mo-fb-eq">=</span><input class="mo-fb-in" spellcheck="false" placeholder="${esc(t('mo_formula_ph'))}"></div>
        <div class="mo-fb-chips mo-fb-fns">${QUICK_FNS.map(n => `<button class="mo-chip" data-fn="${n}">${n}</button>`).join('')}</div>
        <div class="mo-fb-prev"></div>
        <div class="mo-fb-tip">${esc(t('mo_formula_tip'))}</div>
        <div class="mo-fb-chips mo-fb-from"></div>
        <div class="mo-fb-foot">
          <label>${esc(t('mo_number_format'))} <select class="mo-fb-fmt">${formatOptions()}</select></label>
          <span class="mo-grow"></span>
          ${o.editing ? `<button class="mo-btn mo-danger" data-f="remove">${esc(t('mo_remove'))}</button>` : ''}
          <button class="mo-btn mo-primary" data-f="ok">${esc(o.editing ? t('mo_update') : t('mo_insert'))}</button>
        </div>`;
      this.root.appendChild(box);
      const input = box.querySelector('.mo-fb-in');
      const prev = box.querySelector('.mo-fb-prev');
      const fmtSel = box.querySelector('.mo-fb-fmt');
      input.value = String(o.expr || '').replace(/^=/, '');
      fmtSel.value = formatKey(o.fmt);
      const rr = this.root.getBoundingClientRect();
      const w = Math.min(420, rr.width - 16);
      box.style.width = w + 'px';
      const home = this.view;
      const at = {
        left: Math.max(8, Math.min((o.rect ? o.rect.left : rr.left + 40) - rr.left - 20, rr.width - w - 8)),
        top: Math.max(8, Math.min(o.rect ? o.rect.bottom - rr.top + 8 : 80, rr.height - 300)),
      };
      let moved = false;
      // On its page the box sits by the text; on a data sheet it keeps to
      // the lower right corner, out of the way of the cells being picked.
      const place = () => {
        const onHome = this.view && home && this.view.id === home.id;
        const r2 = this.root.getBoundingClientRect();
        if (!moved) {
          box.style.left = (onHome ? at.left : Math.max(8, r2.width - box.offsetWidth - 16)) + 'px';
          box.style.top = (onHome ? at.top : Math.max(8, r2.height - box.offsetHeight - 16)) + 'px';
        }
        const from = box.querySelector('.mo-fb-from');
        const page = this.doc.pages.find(p => home && p.id === home.id);
        from.innerHTML = (page ? `<button class="mo-chip${onHome ? ' on' : ''}" data-go="page" data-id="${page.id}">📄 ${esc(page.title || t('mo_untitled'))}</button>` : '')
          + this.doc.sheets.map(s => {
            const tb = this.doc.tables[s.tableId];
            const on = this.view && this.view.kind === 'sheet' && this.view.id === s.id;
            return tb ? `<button class="mo-chip${on ? ' on' : ''}" data-go="sheet" data-id="${s.id}">📊 ${esc(tb.name)}</button>` : '';
          }).join('');
      };
      // Back to the text it belongs to once it is done.
      const goHome = () => {
        if (home && home.kind === 'page' && (!this.view || this.view.id !== home.id) && this.doc.pages.some(p => p.id === home.id)) this.showPage(home.id);
      };
      box.querySelector('.mo-fb-head').addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const sx = e.clientX - box.offsetLeft, sy = e.clientY - box.offsetTop;
        const mv = ev => { moved = true; box.style.left = (ev.clientX - sx) + 'px'; box.style.top = (ev.clientY - sy) + 'px'; };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });

      const fmtOf = () => (fmtSel.value === 'auto' ? null : M.clone(FORMATS[fmtSel.value]));
      const preview = () => {
        const src = input.value.trim();
        if (!src) { prev.textContent = ''; prev.className = 'mo-fb-prev'; return; }
        const v = this.engine.evaluate(F.closeParens(src));
        const bad = F.isErr(v);
        prev.className = 'mo-fb-prev' + (bad ? ' mo-err' : '');
        prev.textContent = '→ ' + F.formatValue(v, this.inlineFormat(src, fmtOf()));
      };
      const pick = new G.PickTarget(input, null, () => { preview(); assist.refresh(); });
      pick.inline = true;
      this.setPick(pick);
      const assist = this.attachAssist(input, null);
      const close = () => { this.closeFormulaBox(); goHome(); };
      const ok = () => {
        const src = F.closeParens(input.value.trim().replace(/^=/, ''));
        if (!src) { close(); if (o.onCancel) o.onCancel(); return; }
        this.formulaHint(src);
        const cb = o.onDone;
        const f = fmtOf();
        close();
        cb(src, f);
      };
      input.addEventListener('input', preview);
      fmtSel.addEventListener('change', preview);
      input.addEventListener('keydown', e => {
        if (assist.handleKey(e)) return;
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); if (o.onCancel) o.onCancel(); }
      });
      box.addEventListener('mousedown', e => { if (e.target.closest('[data-f],[data-fn],[data-go]')) e.preventDefault(); });
      box.addEventListener('click', e => {
        const fn = e.target.closest('[data-fn]');
        if (fn) { this.quickFunction(input, fn.dataset.fn); preview(); assist.refresh(); return; }
        const go = e.target.closest('[data-go]');
        if (go) { if (go.dataset.go === 'page') this.showPage(go.dataset.id); else this.showSheet(go.dataset.id); input.focus(); return; }
        const b = e.target.closest('[data-f]');
        if (!b) return;
        if (b.dataset.f === 'ok') ok();
        else if (b.dataset.f === 'remove') { const cb = o.onRemove; close(); if (cb) cb(); }
        else { close(); if (o.onCancel) o.onCancel(); }
      });
      this.fbox = { el: box, pick, assist, preview, place };
      place();
      preview();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    // "=A1*1,5" written out of habit: say how decimals are written in
    // formulas instead of leaving a bare error.
    formulaHint(src) {
      src = String(src).replace(/^=/, '');
      if (!/(^|[^\w.'"\]])\d+,\d+/.test(src)) return;
      try { F.parse(src); return; } catch (e) { /* the comma broke it */ }
      this.toast(t('mo_formula_decimal_hint'), 'bad');
    }
    // A function from the quick row: around what is there when that is a
    // single reference, otherwise at the cursor.
    quickFunction(input, name) {
      const v = input.value.trim();
      if (v && !/[(),;+\-*/^&<>=\s]/.test(v.replace(/'[^']*'/g, 'x'))) {
        input.value = name + '(' + v + ')';
        input.setSelectionRange(input.value.length, input.value.length);
      } else {
        const s = input.selectionStart, e = input.selectionEnd;
        input.value = input.value.slice(0, s) + name + '(' + input.value.slice(e);
        const p = s + name.length + 1;
        input.setSelectionRange(p, p);
      }
      input.focus();
    }
    closeFormulaBox() {
      const b = this.fbox;
      if (!b) return;
      this.fbox = null;
      b.assist.detach();
      if (this.pick === b.pick) this.setPick(null);
      b.el.remove();
    }

    // ── Undo ───────────────────────────────────────────────────────────────
    // Cell changes remember their cells; anything that moves or renames
    // remembers the whole data part and every formula in the text.
    snapshot() {
      const formulas = {};
      for (const p of this.doc.pages) {
        if (this.editor && this.editor.page === p) formulas[p.id] = this.editor.formulaExprs();
        else { const list = []; M.eachTextFormula(p.content, src => { list.push(src); return undefined; }); formulas[p.id] = list; }
      }
      return { tables: M.clone(this.doc.tables), sheets: M.clone(this.doc.sheets), formulas };
    }
    restore(s) {
      this.doc.tables = M.clone(s.tables);
      this.doc.sheets = M.clone(s.sheets);
      for (const p of this.doc.pages) {
        const list = s.formulas[p.id];
        if (!list) continue;
        if (this.editor && this.editor.page === p) this.editor.setFormulaExprs(list);
        else { let i = 0; M.eachTextFormula(p.content, () => list[i++]); }
      }
      this.engine.setDoc(this.doc);
      if (this.view && this.view.kind === 'sheet') {
        const sh = this.doc.sheets.find(x => x.id === this.view.id);
        if (sh && this.sheetGrid) { this.sheetGrid.table = this.doc.tables[sh.tableId]; }
        else this.afterRemoval();
      }
      this.renderSide();
    }
    pushUndo(entry) {
      this.undoStack.push(entry);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    undo() { this.step(this.undoStack, this.redoStack, 'before'); }
    redo() { this.step(this.redoStack, this.undoStack, 'after'); }
    step(from, to, side) {
      const e = from.pop();
      if (!e) return;
      to.push(e);
      if (e.type === 'cells') {
        const tb = this.doc.tables[e.tableId];
        if (tb) {
          for (const [k, v] of Object.entries(e[side])) { if (v == null) delete tb.cells[k]; else tb.cells[k] = M.clone(v); }
          const g = this.activeGrid;
          if (g && g.table === tb) {
            const keys = Object.keys(e[side]).map(k => k.split(',').map(Number));
            const rs = keys.map(k => k[0]), cs = keys.map(k => k[1]);
            g.sel = { ar: Math.min(...rs), ac: Math.min(...cs), r: Math.max(...rs), c: Math.max(...cs) };
          }
        }
      } else this.restore(e[side]);
      this.changed();
      if (this.activeGrid) { this.activeGrid.drawSelection(); this.activeGrid.scrollToActive(); }
    }

    // ── Saving ─────────────────────────────────────────────────────────────
    setStatus(s) {
      this.status = s;
      const text = { saved: t('mo_saved'), saving: t('mo_saving'), unsaved: t('mo_unsaved'), failed: t('mo_save_failed'), local: t('mo_local_status'), conflict: t('mo_conflict_short') }[s] || '';
      this.statusEl.textContent = text;
      this.statusEl.className = 'mo-status mo-st-' + s;
      this.statusEl.title = s === 'local' ? t('mo_where_local_hint') : '';
    }
    scheduleSave() {
      if (!this.doc) return;
      this.dirty = true;
      if (this.source.kind === 'local') { this.setStatus('local'); return; }
      if (this.conflict) return;
      this.setStatus('unsaved');
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
    }
    flushSave() {
      if (!this.dirty || !this.doc || this.source.kind === 'local' || this.conflict) return;
      clearTimeout(this.saveTimer);
      this.save();
    }
    serialize() {
      return JSON.stringify(this.doc);
    }
    async save(force) {
      if (!this.doc) return;
      if (this.saving) { this.saveAgain = true; return; }
      const doc = this.doc, src = this.source;
      this.saving = true;
      this.dirty = false;
      this.setStatus('saving');
      try {
        const body = this.serialize();
        if (src.kind === 'cloud') {
          const headers = force ? {} : { 'X-Base-Revision': src.revision };
          const res = await this.api('/docs/' + src.id, { method: 'PUT', body, headers });
          src.revision = res.revision;
        } else if (src.kind === 'server') {
          const r = await fetch('/api/files/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: src.path, content: body }) });
          if (!r.ok) throw new Error('write');
        }
        if (this.doc === doc) this.setStatus(this.dirty ? 'unsaved' : 'saved');
      } catch (e) {
        if (this.doc === doc) {
          this.dirty = true;
          if (e.status === 409) {
            this.conflict = true;
            this.conflictEl.hidden = false;
            this.setStatus('conflict');
          } else this.setStatus('failed');
        }
      } finally {
        this.saving = false;
        if (this.saveAgain) { this.saveAgain = false; if (this.doc === doc && this.dirty && !this.conflict) this.save(); }
      }
    }
    async reloadTheirs() {
      const src = this.source;
      this.conflict = false;
      this.dirty = false;
      await this.openCloud(src.id);
    }
    keepMine() {
      this.conflict = false;
      this.conflictEl.hidden = true;
      this.save(true);
    }
    fileName() {
      const base = (this.doc.title || t('mo_untitled')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'document';
      return base + EXT;
    }
    download(doc) {
      const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = (doc.title || t('mo_untitled')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'document';
      a.download = base + EXT;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      if (this.doc === doc && this.source.kind === 'local') { this.dirty = false; this.setStatus('local'); }
    }
    async saveToCloud() {
      try {
        const res = await this.api('/docs', { method: 'POST', body: this.serialize() });
        this.source = { kind: 'cloud', id: res.id, revision: res.revision };
        this.dirty = false;
        this.showWhere();
        this.setStatus('saved');
        this.toast(t('mo_saved_to_cloud'), 'good');
      } catch (e) { this.toast(t('mo_save_failed'), 'bad'); }
    }
    async saveCopyToCloud() {
      const copy = M.clone(this.doc);
      copy.title = t('mo_copy_of', { title: this.doc.title || t('mo_untitled') });
      try {
        await this.api('/docs', { method: 'POST', body: JSON.stringify(copy) });
        this.toast(t('mo_copy_saved'), 'good');
      } catch (e) { this.toast(t('mo_save_failed'), 'bad'); }
    }
    async saveToFolder() {
      const root = await this.homeDir();
      folderPicker().open({
        root, title: t('mo_save_to_folder'),
        onSelect: async dir => {
          const name = await this.prompt(t('mo_file_name'), this.fileName());
          if (name == null || !name.trim()) return;
          let file = name.trim().replace(/[\\/]+/g, ' ');
          if (!file.toLowerCase().endsWith(EXT)) file += EXT;
          const path = dir.replace(/\/+$/, '') + '/' + file;
          try {
            const r = await fetch('/api/files?path=' + encodeURIComponent(dir));
            const exists = ((await r.json()).entries || []).some(x => x.name === file);
            if (exists && !(await this.confirm(t('mo_overwrite_confirm', { name: file }), t('mo_overwrite')))) return;
          } catch (e) { /* write will tell */ }
          this.flushSave();
          this.source = { kind: 'server', path };
          this.showWhere();
          this.dirty = true;
          await this.save();
          if (this.status === 'saved') this.toast(t('mo_saved_to_folder'), 'good');
        },
      });
    }

    // ── Printing ───────────────────────────────────────────────────────────
    printDoc(preview) {
      if (!this.doc.pages.length) return;
      const html = this.doc.pages.map(p => E.pageHTML(this, p.content)).join('<div class="mo-page-break"></div>');
      this.printHTML(html, this.doc.title, preview);
    }
    printSheet(id, preview) {
      const s = this.doc.sheets.find(x => x.id === id);
      const tb = s && this.doc.tables[s.tableId];
      if (!tb) return;
      let r1 = 0, c1 = 0, r2 = -1, c2 = -1;
      const g = this.sheetGrid;
      const sel = g && g.table === tb ? g.selRect() : null;
      if (sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) && !(sel.r2 === tb.rows - 1 && sel.r1 === 0 && sel.c1 === 0 && sel.c2 === tb.cols - 1)) {
        ({ r1, r2, c1, c2 } = sel);
      } else {
        for (const k of Object.keys(tb.cells)) {
          const cell = tb.cells[k];
          if (!cell || cell.v == null || cell.v === '') continue;
          const [r, c] = k.split(',').map(Number);
          if (r > r2) r2 = r;
          if (c > c2) c2 = c;
        }
      }
      if (r2 < 0 || c2 < 0) { this.toast(t('mo_nothing_to_print'), 'bad'); return; }
      const eng = this.engine;
      let html = `<h3 class="mo-print-title">${esc(tb.name)}</h3><table class="mo-print-table"><tbody>`;
      for (let r = r1; r <= r2; r++) {
        html += '<tr>';
        for (let c = c1; c <= c2; c++) {
          const cell = tb.cells[r + ',' + c];
          const v = eng.value(tb, r, c);
          const a = (cell && cell.a) || (typeof v === 'number' ? 'right' : '');
          let st = a ? 'text-align:' + a + ';' : '';
          if (cell && cell.b) st += 'font-weight:700;';
          if (cell && cell.i) st += 'font-style:italic;';
          if (cell && cell.bg) st += 'background:' + cell.bg + ';';
          if (cell && cell.fg) st += 'color:' + cell.fg + ';';
          html += `<td style="${st}">${esc(eng.display(tb, r, c))}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      this.printHTML(html, tb.name, preview);
    }
    // Print goes through the same sheets the preview shows, so what is on
    // paper is exactly what was previewed, page numbers included.
    printHTML(body, title, preview) {
      if (preview) { this.printPreview(body, title); return; }
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      renderPages(frame.contentDocument, body, title, M.pageBox(this.doc));
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 60000);
      }, 50);
    }

    // The same HTML Print sends, laid out on A4 sheets: top-level blocks are
    // placed one after another and move to the next sheet when they do not
    // fit; tables and lists are split between rows or items, a table
    // repeating its header row, the way the browser prints them.
    printPreview(body, title) {
      const ov = document.createElement('div');
      ov.className = 'mo-preview';
      ov.innerHTML = `
        <div class="mo-pv-bar">
          <strong>${esc(t('mo_print_preview'))}</strong><span class="mo-pv-title">${esc(title || '')}</span>
          <span class="mo-pv-count"></span><span class="mo-grow"></span>
          <button class="mo-btn mo-primary" data-p="print">🖨 ${esc(t('mo_print'))}</button>
          <button class="mo-btn" data-p="close">${esc(t('mo_close'))}</button>
        </div>
        <iframe class="mo-pv-frame" title="${esc(t('mo_print_preview'))}"></iframe>`;
      this.root.appendChild(ov);
      const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); this.focusWork(); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        if (b.dataset.p === 'print') { close(); this.printHTML(body, title); } else close();
      });
      const d = ov.querySelector('iframe').contentDocument;
      const n = renderPages(d, body, title, M.pageBox(this.doc));
      ov.querySelector('.mo-pv-count').textContent = t('mo_pages_count', { n });
      // A narrow window shows the whole width of a sheet, smaller.
      const frame = ov.querySelector('iframe');
      const fit = () => {
        const sheet = d.querySelector('.pv-page');
        if (!sheet || !ov.isConnected) return;
        d.body.style.zoom = Math.min(1, (frame.clientWidth - 24) / sheet.offsetWidth);
      };
      fit();
      new ResizeObserver(fit).observe(frame);
    }

    // ── Page setup ─────────────────────────────────────────────────────────
    applyPage() {
      const b = M.pageBox(this.doc);
      const st = this.root.style;
      st.setProperty('--mo-pw', b.w + 'mm');
      st.setProperty('--mo-ph', b.h + 'mm');
      st.setProperty('--mo-pm', `${b.t}mm ${b.r}mm ${b.b}mm ${b.l}mm`);
      if (this.editor) this.editor.repaginate();
    }
    pageSetup() {
      const pg = M.normPage(this.doc.page);
      const presetOf = m => Object.keys(M.MARGINS).find(k => M.MARGINS[k].every((v, i) => v === m[i])) || 'custom';
      const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
      const sides = [['t', 'mo_margin_top'], ['b', 'mo_margin_bottom'], ['l', 'mo_margin_left'], ['r', 'mo_margin_right']];
      const idx = { t: 0, r: 1, b: 2, l: 3 };
      const ov = this.dialog(`
        <h3>${esc(t('mo_page_setup'))}</h3>
        <div class="mo-ps">
          <div class="mo-ps-form">
            <label>${esc(t('mo_paper_size'))}<select data-k="size">${Object.keys(M.PAPER).map(k => opt(k, `${k} (${M.PAPER[k][0]} × ${M.PAPER[k][1]} mm)`, pg.size)).join('')}</select></label>
            <label>${esc(t('mo_orientation'))}<select data-k="orient">${opt('portrait', t('mo_portrait'), pg.orient)}${opt('landscape', t('mo_landscape'), pg.orient)}</select></label>
            <label>${esc(t('mo_margins'))}<select data-k="preset">${['normal', 'narrow', 'wide', 'custom'].map(k => opt(k, t('mo_margins_' + k), presetOf(pg.margins))).join('')}</select></label>
            <div class="mo-ps-m">${sides.map(([k, key]) => `<label>${esc(t(key))}<span><input type="number" min="0" step="0.5" data-m="${k}" value="${pg.margins[idx[k]]}"> mm</span></label>`).join('')}</div>
            <label>${esc(t('mo_page_numbers'))}<select data-k="numbers">${M.PAGE_NUMBERS.map(k => opt(k, t('mo_pn_' + k), pg.numbers)).join('')}</select></label>
          </div>
          <div class="mo-ps-view"><div class="mo-ps-sheet"><div class="mo-ps-text"></div><div class="mo-ps-num">1</div></div></div>
        </div>
        <p class="mo-dlg-hint">${esc(t('mo_page_setup_hint'))}</p>
        <div class="mo-dlg-foot"><button class="mo-btn" data-d="no">${esc(t('mo_cancel'))}</button><button class="mo-btn mo-primary" data-d="ok">OK</button></div>`);
      ov.querySelector('.mo-dialog').classList.add('mo-dialog-wide');
      const q = s => ov.querySelector(s);
      const read = () => ({
        size: q('[data-k="size"]').value,
        orient: q('[data-k="orient"]').value,
        margins: ['t', 'r', 'b', 'l'].map(k => q(`[data-m="${k}"]`).value),
        numbers: q('[data-k="numbers"]').value,
      });
      // A small picture of the sheet, to scale, with the area the text uses.
      const draw = () => {
        const b = M.pageBox({ page: read() });
        const k = 150 / Math.max(b.w, b.h);
        const sh = q('.mo-ps-sheet'), tx = q('.mo-ps-text'), nm = q('.mo-ps-num');
        sh.style.width = b.w * k + 'px'; sh.style.height = b.h * k + 'px';
        Object.assign(tx.style, { top: b.t * k + 'px', right: b.r * k + 'px', bottom: b.b * k + 'px', left: b.l * k + 'px' });
        nm.hidden = b.numbers === 'none';
        nm.style.textAlign = b.numbers === 'right' ? 'right' : 'center';
        Object.assign(nm.style, { left: b.l * k + 'px', right: b.r * k + 'px', bottom: Math.max(1, b.b * k / 2 - 5) + 'px' });
      };
      q('[data-k="preset"]').addEventListener('change', e => {
        const m = M.MARGINS[e.target.value];
        if (m) ['t', 'r', 'b', 'l'].forEach((k, i) => { q(`[data-m="${k}"]`).value = m[i]; });
        draw();
      });
      ov.querySelectorAll('[data-m]').forEach(inp => inp.addEventListener('input', () => {
        q('[data-k="preset"]').value = presetOf(['t', 'r', 'b', 'l'].map(k => +q(`[data-m="${k}"]`).value));
        draw();
      }));
      ov.querySelectorAll('[data-k="size"],[data-k="orient"],[data-k="numbers"]').forEach(el => el.addEventListener('change', draw));
      draw();
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); end(false); } };
      const end = ok => {
        document.removeEventListener('keydown', key, true);
        if (ok) {
          this.doc.page = M.normPage(read());
          this.applyPage();
          this.scheduleSave();
        }
        ov.remove();
        this.focusWork();
      };
      document.addEventListener('keydown', key, true);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-d]');
        if (b) end(b.dataset.d === 'ok');
        else if (e.target === ov) end(false);
      });
    }

    // ── Export to Excel ────────────────────────────────────────────────────
    sheetTable(sheetId) {
      const s = this.doc.sheets.find(x => x.id === sheetId);
      return s ? this.doc.tables[s.tableId] : null;
    }
    // Everything that can become a worksheet: the data sheets in their order,
    // then the tables in the text, page by page, as they appear.
    exportables() {
      const out = [];
      for (const s of this.doc.sheets) {
        const tb = this.doc.tables[s.tableId];
        if (tb) out.push({ table: tb, kind: 'sheet' });
      }
      const seen = new Set();
      for (const p of this.doc.pages) {
        const visit = node => {
          if (!node) return;
          if (node.type === 'table_embed') {
            const tb = this.doc.tables[node.attrs && node.attrs.tableId];
            if (tb && !seen.has(tb.id)) { seen.add(tb.id); out.push({ table: tb, kind: 'embed', page: p }); }
          }
          (node.content || []).forEach(visit);
        };
        visit(p.content);
      }
      return out;
    }
    exportXlsx(ids) {
      const X = window.MvmOfficeXlsx;
      const all = this.exportables();
      const chosen = all.filter(x => ids.includes(x.table.id));
      if (!X || !chosen.length) return;
      this.engine.invalidate();
      const blob = X.workbook(chosen.map(x => ({ table: x.table, colW: x.kind === 'sheet' ? 100 : 120 })), this.engine);
      const title = this.doc.title || t('mo_untitled');
      const name = chosen.length === 1 && all.length > 1 ? title + ' - ' + chosen[0].table.name : title;
      this.download(blob, name, '.xlsx');
    }
    // The pages as a Word file: what Print prints, the tables in the text
    // included, the data sheets left for Excel.
    exportDocx() {
      const D = window.MvmOfficeDocx;
      if (!D || !this.doc.pages.length) return;
      this.engine.invalidate();
      this.download(D.document(this.doc, this), this.doc.title || t('mo_untitled'), '.docx');
    }
    // A PDF is the printed document saved by the browser's own "Save as PDF":
    // the same sheets as on paper, with text that can be selected and
    // searched, in every script the browser can show.
    exportPdf() {
      if (!this.doc.pages.length) return;
      this.toast(t('mo_pdf_hint'), 'good');
      this.printDoc();
    }
    download(blob, name, ext) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'export') + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    exportDialog() {
      const list = this.exportables();
      if (list.length === 1) { this.exportXlsx([list[0].table.id]); return; }
      const row = x => `<label class="mo-xl-row"><input type="checkbox" data-id="${esc(x.table.id)}" checked>
        <span>${x.kind === 'sheet' ? '📊' : '▦'} ${esc(x.table.name)}</span>${x.kind === 'embed' ? `<small>${esc(x.page.title)}</small>` : ''}</label>`;
      const sheets = list.filter(x => x.kind === 'sheet'), embeds = list.filter(x => x.kind === 'embed');
      const ov = this.dialog(`
        <h3>${esc(t('mo_export_xlsx'))}</h3>
        <p class="mo-dlg-hint">${esc(t('mo_export_xlsx_hint'))}</p>
        <label class="mo-xl-row mo-xl-all"><input type="checkbox" data-all checked><span>${esc(t('mo_select_all'))}</span></label>
        <div class="mo-xl-list">
          ${sheets.length ? `<div class="mo-xl-group">${esc(t('mo_data_sheets'))}</div>${sheets.map(row).join('')}` : ''}
          ${embeds.length ? `<div class="mo-xl-group">${esc(t('mo_text_tables'))}</div>${embeds.map(row).join('')}` : ''}
        </div>
        <div class="mo-dlg-foot"><button class="mo-btn" data-d="no">${esc(t('mo_cancel'))}</button><button class="mo-btn mo-primary" data-d="ok">${esc(t('mo_export'))}</button></div>`);
      const boxes = [...ov.querySelectorAll('[data-id]')];
      const all = ov.querySelector('[data-all]');
      const okBtn = ov.querySelector('[data-d="ok"]');
      const sync = () => {
        const n = boxes.filter(b => b.checked).length;
        all.checked = n === boxes.length;
        all.indeterminate = n > 0 && n < boxes.length;
        okBtn.disabled = !n;
      };
      all.addEventListener('change', () => { boxes.forEach(b => { b.checked = all.checked; }); sync(); });
      boxes.forEach(b => b.addEventListener('change', sync));
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); end(false); } };
      const end = ok => {
        document.removeEventListener('keydown', key, true);
        const ids = boxes.filter(b => b.checked).map(b => b.dataset.id);
        ov.remove();
        if (ok && ids.length) this.exportXlsx(ids);
        this.focusWork();
      };
      document.addEventListener('keydown', key, true);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-d]');
        if (b && !b.disabled) end(b.dataset.d === 'ok');
        else if (e.target === ov) end(false);
      });
    }

    // ── Small UI pieces ────────────────────────────────────────────────────
    menu(x, y, items, title) {
      this.closeMenus();
      const rr = this.root.getBoundingClientRect();
      const m = document.createElement('div');
      m.className = 'mo-menu';
      m.innerHTML = (title ? `<div class="mo-menu-title">${esc(title)}</div>` : '') + items.map((it, i) => it === '-' ? '<div class="mo-menu-sep"></div>' : `
        <button class="mo-mi${it.danger ? ' mo-danger-mi' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
          <span class="mo-mi-ico">${esc(it.icon || '')}</span><span class="mo-mi-label">${esc(it.label)}</span>${it.hint ? `<span class="mo-mi-hint">${esc(it.hint)}</span>` : ''}
        </button>`).join('');
      this.root.appendChild(m);
      const w = m.offsetWidth, h = m.offsetHeight;
      m.style.left = Math.max(4, Math.min(x - rr.left, rr.width - w - 4)) + 'px';
      m.style.top = Math.max(4, Math.min(y - rr.top, rr.height - h - 4)) + 'px';
      m.addEventListener('mousedown', e => e.preventDefault());
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (!b || b.disabled) return;
        this.closeMenus();
        items[+b.dataset.i].onClick();
      });
      const away = e => { if (!m.contains(e.target)) this.closeMenus(); };
      const key = e => { if (e.key === 'Escape') this.closeMenus(); };
      setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', key, true); }, 0);
      this._menu = { el: m, away, key };
    }
    closeMenus() {
      const m = this._menu;
      if (!m) return;
      this._menu = null;
      document.removeEventListener('mousedown', m.away, true);
      document.removeEventListener('keydown', m.key, true);
      m.el.remove();
    }
    palette(btn, colors, onPick) {
      this.closeMenus();
      const rr = this.root.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const m = document.createElement('div');
      m.className = 'mo-menu mo-palette';
      m.innerHTML = colors.map(c => `<button class="mo-sw" data-c="${c}" style="background:${c}"></button>`).join('') +
        `<button class="mo-sw-none" data-c="">${esc(t('mo_no_color'))}</button>`;
      this.root.appendChild(m);
      m.style.left = Math.max(4, Math.min(br.left - rr.left, rr.width - m.offsetWidth - 4)) + 'px';
      m.style.top = (br.bottom - rr.top + 4) + 'px';
      m.addEventListener('mousedown', e => e.preventDefault());
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        this.closeMenus();
        onPick(b.dataset.c || null);
      });
      const away = e => { if (!m.contains(e.target)) this.closeMenus(); };
      const key = e => { if (e.key === 'Escape') this.closeMenus(); };
      setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', key, true); }, 0);
      this._menu = { el: m, away, key };
    }
    dialog(html) {
      const ov = document.createElement('div');
      ov.className = 'mo-overlay';
      ov.innerHTML = `<div class="mo-dialog">${html}</div>`;
      this.root.appendChild(ov);
      return ov;
    }
    prompt(title, value, hint) {
      return new Promise(resolve => {
        const ov = this.dialog(`
          <h3>${esc(title)}</h3>
          <input class="mo-dlg-in" spellcheck="false" maxlength="200">
          ${hint ? `<p class="mo-dlg-hint">${esc(hint)}</p>` : ''}
          <div class="mo-dlg-foot"><button class="mo-btn" data-d="no">${esc(t('mo_cancel'))}</button><button class="mo-btn mo-primary" data-d="ok">OK</button></div>`);
        const input = ov.querySelector('input');
        input.value = value || '';
        const end = v => { ov.remove(); resolve(v); };
        ov.addEventListener('click', e => {
          const b = e.target.closest('[data-d]');
          if (b) end(b.dataset.d === 'ok' ? input.value : null);
          else if (e.target === ov) end(null);
        });
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); end(input.value); }
          if (e.key === 'Escape') { e.preventDefault(); end(null); }
        });
        setTimeout(() => { input.focus(); const dot = input.value.lastIndexOf('.mvmoffice'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length); }, 0);
      });
    }
    confirm(message, okLabel) {
      return new Promise(resolve => {
        const ov = this.dialog(`
          <p>${esc(message)}</p>
          <div class="mo-dlg-foot"><button class="mo-btn" data-d="no">${esc(t('mo_cancel'))}</button><button class="mo-btn mo-danger" data-d="ok">${esc(okLabel || 'OK')}</button></div>`);
        const end = v => { ov.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
        const key = e => { if (e.key === 'Escape') end(false); if (e.key === 'Enter') end(true); };
        document.addEventListener('keydown', key, true);
        ov.addEventListener('click', e => {
          const b = e.target.closest('[data-d]');
          if (b) end(b.dataset.d === 'ok');
          else if (e.target === ov) end(false);
        });
      });
    }
    toast(msg, kind) {
      const el = document.createElement('div');
      el.className = 'mo-toast' + (kind ? ' mo-toast-' + kind : '');
      el.textContent = msg;
      this.root.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2800);
    }
  }

  const ICON = {
    left: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8" stroke="currentColor" stroke-width="1.6"/></svg>',
    center: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8" stroke="currentColor" stroke-width="1.6"/></svg>',
    right: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8" stroke="currentColor" stroke-width="1.6"/></svg>',
    justify: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12" stroke="currentColor" stroke-width="1.6"/></svg>',
  };

  const PRINT_CSS = `
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.45; }
    p { margin: 0 0 .5em; min-height: 1em; }
    h1 { font-size: 20pt; margin: .4em 0 .3em; } h2 { font-size: 16pt; margin: .4em 0 .3em; } h3 { font-size: 13pt; margin: .4em 0 .3em; }
    ul, ol { margin: 0 0 .5em; padding-left: 1.6em; }
    blockquote { margin: 0 0 .5em; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
    hr { border: 0; border-top: 1px solid #999; margin: 1em 0; }
    .mo-page-break { break-after: page; page-break-after: always; height: 0; }
    table.mo-print-table { border-collapse: collapse; margin: .4em 0 .8em; table-layout: fixed; max-width: 100%; }
    table.mo-print-table td, table.mo-print-table th { border: 1px solid #999; padding: 3px 6px; vertical-align: top; white-space: pre-wrap; word-break: break-word; font-size: 10pt; text-align: left; }
    table.mo-print-table thead { display: table-header-group; }
    table.mo-print-table th { background: #f0f2f5; font-weight: 700; }
    table.mo-print-table tr { break-inside: avoid; page-break-inside: avoid; }
    .mo-print-title { font-size: 12pt; margin: 0 0 .5em; }
    .mo-fx { }
  `;

  const PREVIEW_CSS = `
    html, body { background: #d9dce1; }
    body { padding: 16px 0; }
    .pv-page { position: relative; margin: 0 auto 16px; background: #fff; box-sizing: border-box;
      box-shadow: 0 2px 10px rgba(0,0,0,.25); overflow: hidden; }
    .pv-body { height: 100%; display: flow-root; }
    .pv-src { position: absolute; left: -10000px; top: 0; }
    .pv-num { position: absolute; font-size: 9pt; color: #444; }
    .mo-page-break { display: none; }
    @media print {
      html, body { background: #fff; padding: 0; }
      .pv-page { box-shadow: none; margin: 0; break-after: page; page-break-after: always; }
      .pv-page:last-child { break-after: auto; page-break-after: auto; }
    }
  `;
  // The sheet size, margins and page number place of one document.
  function pageCSS(b) {
    return `@page { size: ${b.w}mm ${b.h}mm; margin: 0; }
      .pv-page { width: ${b.w}mm; height: ${b.h}mm; padding: ${b.t}mm ${b.r}mm ${b.b}mm ${b.l}mm; }
      .pv-src { width: ${Math.max(20, b.w - b.l - b.r)}mm; }
      .pv-num { left: ${b.l}mm; right: ${b.r}mm; bottom: ${Math.max(3, b.b / 2 - 2.5)}mm; text-align: ${b.numbers === 'right' ? 'right' : 'center'}; }`;
  }
  // Writes `body` into the frame's document as numbered sheets; returns how
  // many there are.
  function renderPages(d, body, title, box) {
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'mvmOffice')}</title><style>${PRINT_CSS}${PREVIEW_CSS}${pageCSS(box)}</style></head><body><div class="pv-src">${body}</div><div class="pv-pages"></div></body></html>`);
    d.close();
    const n = paginate(d);
    if (box.numbers !== 'none') {
      d.querySelectorAll('.pv-page').forEach((pg, i) => {
        const num = d.createElement('div');
        num.className = 'pv-num';
        num.textContent = String(i + 1);
        pg.appendChild(num);
      });
    }
    return n;
  }

  function paginate(d) {
    const src = d.querySelector('.pv-src');
    const out = d.querySelector('.pv-pages');
    let page = null, box = null, count = 0;
    const newPage = () => {
      page = d.createElement('div'); page.className = 'pv-page';
      box = d.createElement('div'); box.className = 'pv-body';
      page.appendChild(box); out.appendChild(page); count++;
    };
    const fits = () => box.scrollHeight <= box.clientHeight + 1;
    const empty = () => !box.firstChild;
    // Moves rows or items of `el` one by one into copies of it while they
    // fit; returns what is left over, or null when everything was placed.
    const split = (el) => {
      const isTable = el.tagName === 'TABLE';
      const holder = isTable ? el.tBodies[0] : el;
      if (!holder) return el;
      const parts = [...holder.children];
      const shell = el.cloneNode(true);
      const shellHolder = isTable ? shell.tBodies[0] : shell;
      shellHolder.innerHTML = '';
      box.appendChild(shell);
      let placed = 0;
      for (const part of parts) {
        shellHolder.appendChild(part);
        if (!fits()) { shellHolder.removeChild(part); break; }
        placed++;
      }
      if (!placed) { shell.remove(); return el; }
      if (placed === parts.length) return null;
      const rest = el.cloneNode(true);
      const restHolder = isTable ? rest.tBodies[0] : rest;
      restHolder.innerHTML = '';
      parts.slice(placed).forEach(x => restHolder.appendChild(x));
      if (el.tagName === 'OL') rest.setAttribute('start', (+(el.getAttribute('start') || 1)) + placed);
      return rest;
    };
    newPage();
    let nodes = [...src.childNodes];
    while (nodes.length) {
      let node = nodes.shift();
      if (node.nodeType === 3 && !node.textContent.trim()) continue;
      if (node.nodeType === 1 && node.classList.contains('mo-page-break')) { if (!empty()) newPage(); continue; }
      box.appendChild(node);
      if (fits()) continue;
      box.removeChild(node);
      if (node.nodeType === 1 && /^(TABLE|UL|OL)$/.test(node.tagName)) {
        const rest = split(node);
        if (rest === null) continue;
        if (rest !== node) { newPage(); nodes.unshift(rest); continue; }
      }
      if (!empty()) { newPage(); nodes.unshift(node); continue; }
      box.appendChild(node);   // taller than a whole sheet: it gets one to itself
      if (nodes.length) newPage();
    }
    src.remove();
    return count;
  }

  const CSS = `
  .mo{--mo-bg:var(--pub-bg,#1e1e2e);--mo-fg:var(--pub-fg,#cdd6f4);--mo-fg2:var(--pub-fg2,#a6adc8);--mo-s1:var(--pub-surface1,#232336);
    --mo-s2:var(--pub-surface2,#313244);--mo-border:var(--pub-border,#45475a);--mo-dim:var(--pub-dim,#6c7086);--mo-accent:var(--pub-accent,#89b4fa);
    --mo-accent-h:var(--pub-accent-hover,#a6c8ff);--mo-red:var(--pub-red,#f38ba8);--mo-green:var(--pub-green,#a6e3a1);--mo-yellow:var(--pub-yellow,#f9e2af);
    --mo-on-accent:var(--mo-bg);
    --mo-grid:color-mix(in srgb,var(--mo-border) 70%,transparent);
    position:relative;height:100%;display:flex;flex-direction:column;background:var(--mo-bg);color:var(--mo-fg);overflow:hidden;
    font-family:inherit;font-size:.875rem}
  /* In a desktop window the colours come from the OS theme, not from the
     public page's --pub-* set (which the desktop does not define). */
  .mo.mo-os{--mo-bg:var(--surface,#161b22);--mo-fg:var(--text,#c9d1d9);--mo-fg2:var(--text-dim,#8b949e);
    --mo-s1:color-mix(in srgb,var(--mo-fg) 5%,var(--mo-bg));--mo-s2:var(--surface2,#21262d);--mo-border:var(--border,#30363d);
    --mo-dim:color-mix(in srgb,var(--mo-fg2) 80%,var(--mo-bg));--mo-accent:var(--accent,#2a6ee0);--mo-accent-h:var(--accent-hover,#1a5ec0);
    --mo-red:var(--danger,#da3633);--mo-green:#2e9e57;--mo-yellow:#b58100;--mo-on-accent:#fff;font-family:var(--font,inherit)}
  .mo *{box-sizing:border-box}
  .mo [hidden]{display:none!important}
  .mo.mo-drop::after{content:'';position:absolute;inset:6px;border:2px dashed var(--mo-accent);border-radius:10px;pointer-events:none;z-index:50}
  .mo-grow{flex:1}
  .mo-btn{background:var(--mo-s2);color:var(--mo-fg);border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.82rem;white-space:nowrap;font-family:inherit}
  .mo-btn:hover{background:var(--mo-border)}
  .mo-primary{background:var(--mo-accent);color:var(--mo-on-accent);font-weight:600}
  .mo-primary:hover{background:var(--mo-accent-h)}
  .mo-danger{background:var(--mo-red);color:var(--mo-on-accent);font-weight:600}
  .mo-ib{background:none;border:none;color:var(--mo-fg2);cursor:pointer;font-size:.9rem;min-width:28px;height:28px;padding:0 6px;border-radius:5px;
    display:inline-flex;align-items:center;justify-content:center;font-family:inherit;flex-shrink:0}
  .mo-ib:hover{background:var(--mo-s2);color:var(--mo-fg)}
  .mo-ib.on{background:color-mix(in srgb,var(--mo-accent) 28%,transparent);color:var(--mo-fg)}
  .mo-ib:disabled{opacity:.4;cursor:default}
  .mo-danger-ib:hover{color:var(--mo-red)}

  .mo-list{flex:1;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
  .mo-lhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .mo-lhead h2{margin:0;font-size:1.2rem}
  .mo-logo{font-size:1.4rem}
  .mo-loading,.mo-emptylist{color:var(--mo-dim);padding:30px;text-align:center}
  .mo-lhint{color:var(--mo-dim);font-size:.75rem;text-align:center;margin-top:auto}
  .mo-start{text-align:center;color:var(--mo-fg2);padding:30px 10px}
  .mo-start-btn{margin-top:6px;padding:10px 22px;font-size:1rem}
  .mo-start-hint{color:var(--mo-dim);font-size:.8rem;max-width:420px;margin:14px auto 0}
  .mo-docs{display:flex;flex-direction:column;gap:6px}
  .mo-doc{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--mo-s1);cursor:pointer;border:1px solid transparent}
  .mo-doc:hover{border-color:var(--mo-border)}
  .mo-doc-ico{font-size:1.2rem}
  .mo-doc-main{flex:1;min-width:0;display:flex;flex-direction:column}
  .mo-doc-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mo-doc-meta{color:var(--mo-dim);font-size:.75rem}

  .mo-docview{flex:1;display:flex;flex-direction:column;min-height:0}
  .mo-top{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--mo-s2);flex-shrink:0}
  .mo-title{background:transparent;border:1px solid transparent;color:var(--mo-fg);font-size:1rem;font-weight:600;padding:4px 6px;border-radius:5px;
    min-width:80px;width:clamp(120px,30vw,340px);font-family:inherit}
  .mo-title:hover{border-color:var(--mo-s2)} .mo-title:focus{outline:none;border-color:var(--mo-accent)}
  .mo-where{color:var(--mo-dim);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
  .mo-status{font-size:.75rem;color:var(--mo-dim);white-space:nowrap}
  .mo-st-failed,.mo-st-conflict{color:var(--mo-red)} .mo-st-local{color:var(--mo-yellow)}
  .mo-side-toggle{display:none}
  .mo-conflict{display:flex;align-items:center;gap:8px;padding:6px 12px;background:color-mix(in srgb,var(--mo-red) 18%,transparent);font-size:.82rem;flex-wrap:wrap}
  .mo-conflict span{flex:1}
  .mo-tools{display:flex;align-items:center;gap:2px;padding:4px 8px;border-bottom:1px solid var(--mo-s2);flex-shrink:0;flex-wrap:wrap}
  .mo-tools > span{display:inline-flex;align-items:center;gap:2px}
  .mo-tools select{background:var(--mo-s2);color:var(--mo-fg);border:none;border-radius:5px;padding:4px 6px;font-size:.8rem;font-family:inherit;height:28px}
  .mo-sep{width:1px;height:18px;background:var(--mo-s2);margin:0 4px}
  .mo-tg-cell{display:none!important}
  .mo-mode-cell .mo-tg-cell{display:inline-flex!important}
  .mo-mode-cell .mo-tg-text{display:none!important}
  .mo-tools .mo-b{font-weight:800} .mo-tools .mo-i{font-style:italic;font-family:serif} .mo-tools .mo-u{text-decoration:underline} .mo-tools .mo-s{text-decoration:line-through}
  .mo-a-color{border-bottom:3px solid var(--mo-red);line-height:1;font-weight:700}
  .mo-ins{padding:4px 8px;height:28px}
  .mo-fx-btn{font-style:italic;font-weight:700;color:var(--mo-accent)}
  .mo-fbar{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--mo-s2);flex-shrink:0}
  .mo-addr{min-width:70px;max-width:180px;font-family:ui-monospace,monospace;font-size:.78rem;color:var(--mo-fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mo-fx-lbl{font-style:italic;color:var(--mo-dim);font-weight:700}
  .mo-fin{flex:1;background:var(--mo-s1);border:1px solid var(--mo-s2);color:var(--mo-fg);border-radius:4px;padding:4px 6px;font-family:ui-monospace,monospace;font-size:.82rem;min-width:0}
  .mo-fin:focus{outline:none;border-color:var(--mo-accent)}
  .mo-body{flex:1;display:flex;min-height:0;position:relative}
  .mo-side{width:210px;flex-shrink:0;border-right:1px solid var(--mo-s2);overflow:auto;padding:6px;background:var(--mo-bg)}
  .mo-sh{display:flex;align-items:center;justify-content:space-between;color:var(--mo-dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;padding:8px 4px 4px}
  .mo-si{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer}
  .mo-si:hover{background:var(--mo-s1)}
  .mo-si.on{background:var(--mo-s2)}
  .mo-si-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mo-si-more{visibility:hidden;min-width:22px;height:22px}
  .mo-si:hover .mo-si-more,.mo-si.on .mo-si-more{visibility:visible}
  .mo-snone{color:var(--mo-dim);font-size:.75rem;padding:2px 8px 6px}
  .mo-shint{color:var(--mo-dim);font-size:.7rem;padding:12px 6px;line-height:1.4}
  .mo-main{flex:1;min-width:0;position:relative;display:flex}
  .mo-main > *{flex:1;min-width:0}
  .mo-empty{display:flex;align-items:center;justify-content:center}
  .mo-narrow .mo-side-toggle{display:inline-flex}
  .mo-narrow .mo-side{position:absolute;left:0;top:0;bottom:0;z-index:30;transform:translateX(-100%);transition:transform .15s;box-shadow:4px 0 16px rgba(0,0,0,.3)}
  .mo-narrow.mo-side-open .mo-side{transform:none}
  .mo-narrow .mo-where{display:none}

  .mo-desk{overflow:auto;background:color-mix(in srgb,var(--mo-bg) 80%,#000);padding:24px 16px}
  .mo-paper{width:var(--mo-pw,210mm);min-height:var(--mo-ph,297mm);margin:0 auto 40px;color:#1f1f1f;padding:var(--mo-pm,20mm);position:relative}
  .mo-sheets{position:absolute;inset:0;pointer-events:none}
  .mo-sheet{position:absolute;left:0;right:0;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.35)}
  .mo-page-host{position:relative}
  .mo-pgap{display:block;pointer-events:none;user-select:none}
  .mo-measuring .mo-pgap{display:none}
  .mo-narrow .mo-desk{padding:0}
  .mo-narrow .mo-paper{width:auto;min-height:100%;margin:0;padding:16px;background:#fff}
  .mo-narrow .mo-sheets{display:none}
  .mo-page-host{min-height:200px}
  .mo-text{outline:none;font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.45;min-height:240px;caret-color:#1f1f1f}
  .mo-text p{margin:0 0 .5em}
  .mo-text h1{font-size:20pt;margin:.4em 0 .3em} .mo-text h2{font-size:16pt;margin:.4em 0 .3em} .mo-text h3{font-size:13pt;margin:.4em 0 .3em}
  .mo-text ul,.mo-text ol{margin:0 0 .5em;padding-left:1.6em}
  .mo-text blockquote{margin:0 0 .5em;padding-left:1em;border-left:3px solid #ccc;color:#444}
  .mo-text hr{border:0;border-top:1px solid #999;margin:1em 0}
  .mo-text .mo-page-break{border-top:2px dashed #b5bcc9;margin:18px 0;height:0}
  .mo-text .mo-page-break.ProseMirror-selectednode{outline:none;border-top-color:var(--mo-accent)}
  .mo-fx{background:#e3ecff;color:#1d3f91;border-radius:3px;padding:0 3px;cursor:pointer;border-bottom:1px dashed #6f8fd8;white-space:nowrap}
  .mo-fx:hover{background:#d2e0ff}
  .mo-fx.mo-err{background:#fde3e3;color:#b3261e;border-bottom-color:#e08080}
  .mo-fx-sel{outline:2px solid var(--mo-accent)}
  .mo-embed{margin:.5em 0;position:relative}
  .mo-embed-sel{outline:2px solid var(--mo-accent);outline-offset:2px}
  .mo-embed-missing{color:#b3261e;font-size:.8rem;padding:6px;border:1px dashed #e08080}
  .ProseMirror{position:relative;word-wrap:break-word;white-space:pre-wrap;white-space:break-spaces;font-variant-ligatures:none;font-feature-settings:"liga" 0}
  .ProseMirror pre{white-space:pre-wrap}
  .ProseMirror li{position:relative}
  .ProseMirror-hideselection *::selection{background:transparent}
  .ProseMirror-hideselection{caret-color:transparent}
  .ProseMirror [draggable][contenteditable=false]{user-select:text}
  .ProseMirror-selectednode{outline:2px solid var(--mo-accent)}
  li.ProseMirror-selectednode{outline:none}
  img.ProseMirror-separator{display:inline!important;border:none!important;margin:0!important}
  .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}
  .ProseMirror-gapcursor:after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:1px solid #1f1f1f;animation:mo-blink 1.1s steps(2,start) infinite}
  @keyframes mo-blink{to{visibility:hidden}}
  .ProseMirror-focused .ProseMirror-gapcursor{display:block}

  .mo-grid{position:relative;font-size:.8125rem}
  .mo-kbd{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;overflow:hidden;border:0;padding:0;z-index:-1}
  .mo-sel{position:absolute;pointer-events:none;border:1px solid var(--mo-accent);z-index:1}
  .mo-sel.multi{background:color-mix(in srgb,var(--mo-accent) 14%,transparent)}
  .mo-act{position:absolute;pointer-events:none;border:2px solid var(--mo-accent);z-index:1}
  .mo-pick{position:absolute;pointer-events:none;border:2px dashed #e67e22;background:rgba(230,126,34,.08);z-index:2}
  .mo-cell-editor{position:absolute;z-index:6;border:2px solid var(--mo-accent);padding:2px 4px;font:inherit;resize:none;overflow:hidden;
    background:var(--mo-bg);color:var(--mo-fg);outline:none;white-space:pre;box-shadow:0 2px 10px rgba(0,0,0,.3);line-height:1.35}
  .mo-c.mo-a-left{text-align:left}.mo-c.mo-a-center{text-align:center}.mo-c.mo-a-right{text-align:right}
  .mo-c.mo-b{font-weight:700}.mo-c.mo-i{font-style:italic}.mo-c.mo-u{text-decoration:underline}.mo-c.mo-s{text-decoration:line-through}
  .mo-c.mo-u.mo-s{text-decoration:underline line-through}
  .mo-c.mo-err{color:var(--mo-red)}
  .mo-rsz{position:absolute;right:-3px;top:0;width:6px;height:100%;cursor:col-resize;z-index:2}
  .mo-measure{position:absolute;visibility:hidden;white-space:nowrap;font-size:.8125rem}

  .mo-grid-sheet{height:100%;overflow:auto;background:var(--mo-bg);user-select:none}
  .mo-gs-inner{position:relative}
  .mo-gs-colhdr{position:sticky;top:0;z-index:5;height:24px}
  .mo-gs-corner{position:sticky;left:0;width:48px;height:24px;z-index:6;background:var(--mo-s1);border-right:1px solid var(--mo-grid);border-bottom:1px solid var(--mo-grid);cursor:pointer}
  .mo-gs-colcells{position:absolute;left:48px;top:0;height:24px;right:0}
  .mo-grid-sheet .mo-hc{position:absolute;top:0;height:24px;line-height:23px;text-align:center;background:var(--mo-s1);color:var(--mo-fg2);font-size:.7rem;
    border-right:1px solid var(--mo-grid);border-bottom:1px solid var(--mo-grid);cursor:default}
  .mo-grid-sheet .mo-hc.sel,.mo-grid-sheet .mo-hr.sel{background:color-mix(in srgb,var(--mo-accent) 25%,var(--mo-s1));color:var(--mo-fg)}
  .mo-gs-body{position:relative}
  .mo-gs-rowhdr{position:sticky;left:0;width:48px;height:100%;z-index:3;background:var(--mo-s1)}
  .mo-grid-sheet .mo-hr{position:absolute;left:0;width:48px;height:24px;line-height:23px;text-align:center;color:var(--mo-fg2);font-size:.7rem;
    border-right:1px solid var(--mo-grid);border-bottom:1px solid var(--mo-grid);background:var(--mo-s1)}
  .mo-gs-cells{position:absolute;left:48px;top:0}
  .mo-grid-sheet .mo-c{position:absolute;height:24px;line-height:23px;padding:0 4px;white-space:nowrap;overflow:hidden;border-right:1px solid var(--mo-grid);border-bottom:1px solid var(--mo-grid)}

  .mo-grid-embed{color:#1f1f1f}
  .mo-ge-bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:.75rem;margin-bottom:3px;min-height:0}
  .mo-ge-bar:empty{display:none}
  .mo-ge-bar button{background:#eef1f6;border:1px solid #d5dae3;color:#333;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:.72rem;font-family:inherit}
  .mo-ge-bar button:hover{background:#e0e6f0}
  .mo-ge-bar button.on{background:#d6e2fb;border-color:#9cb5ea}
  .mo-ge-bar .mo-danger{background:#fdecec;border-color:#f3c2c2;color:#b3261e;font-weight:400}
  .mo-ge-name{font-weight:700;color:#35507f;cursor:pointer;padding:2px 4px;border-radius:4px;margin-right:4px}
  .mo-ge-name:hover{background:#eef1f6}
  .mo-ge-scroll{overflow-x:auto;max-width:100%}
  .mo-ge-wrap{position:relative;display:inline-block;vertical-align:top}
  .mo-ge-table{border-collapse:collapse;table-layout:fixed;font-size:10pt}
  .mo-ge-table td{border:1px solid #b9bfca;padding:3px 6px;vertical-align:top;white-space:pre-wrap;word-break:break-word;min-height:22px;height:24px;cursor:cell}
  .mo-ge-table tr.mo-head-row td{background:#f0f2f5;font-weight:700}
  .mo-ge-table th{background:#f5f6f8;color:#7a8190;font-size:.66rem;font-weight:500;border:1px solid #d9dde4;padding:1px 2px;user-select:none;position:relative;cursor:default}
  .mo-ge-table th.mo-corner{background:#fff;border-color:transparent #d9dde4 #d9dde4 transparent}
  .mo-grid-embed .mo-c.mo-err{color:#b3261e}
  .mo-grid-embed .mo-cell-editor{background:#fff;color:#1f1f1f}
  .mo-grid-embed:not(.active) .mo-sel,.mo-grid-embed:not(.active) .mo-act{display:none}

  .mo-assist{position:absolute;z-index:120;min-width:240px;max-width:360px;background:var(--mo-s1);border:1px solid var(--mo-border);border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px;font-size:.8rem}
  .mo-as-item{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;cursor:pointer}
  .mo-as-item.on,.mo-as-item:hover{background:var(--mo-s2)}
  .mo-as-kind{width:18px;text-align:center;color:var(--mo-accent);font-weight:700}
  .mo-as-label{font-family:ui-monospace,monospace}
  .mo-as-hint{color:var(--mo-dim);font-size:.72rem;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
  .mo-as-sig{color:var(--mo-fg2);font-family:ui-monospace,monospace;font-size:.75rem;padding:5px 6px 3px;border-top:1px solid var(--mo-s2);margin-top:2px}
  .mo-as-sig:first-child{border-top:0;margin-top:0}

  .mo-fbox{position:absolute;z-index:110;background:var(--mo-s1);border:1px solid var(--mo-border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:10px;display:flex;flex-direction:column;gap:8px}
  .mo-fb-head{display:flex;align-items:center;gap:6px}
  .mo-fb-row{display:flex;align-items:center;gap:6px}
  .mo-fb-eq{color:var(--mo-dim);font-weight:700}
  .mo-fb-in{flex:1;background:var(--mo-bg);border:1px solid var(--mo-border);color:var(--mo-fg);border-radius:6px;padding:7px 8px;font-family:ui-monospace,monospace;font-size:.85rem;min-width:0}
  .mo-fb-in:focus{outline:none;border-color:var(--mo-accent)}
  .mo-fb-prev{min-height:1.2em;color:var(--mo-green);font-weight:600}
  .mo-fb-prev.mo-err{color:var(--mo-red)}
  .mo-fb-tip{color:var(--mo-dim);font-size:.72rem;line-height:1.4}
  .mo-fb-head{cursor:move}
  .mo-fb-chips{display:flex;flex-wrap:wrap;gap:4px}
  .mo-fb-from:empty{display:none}
  .mo-chip{background:var(--mo-s2);color:var(--mo-fg);border:1px solid transparent;border-radius:12px;padding:2px 9px;font-size:.75rem;cursor:pointer;font-family:inherit}
  .mo-chip:hover{border-color:var(--mo-accent)}
  .mo-chip.on{background:var(--mo-accent);color:var(--mo-on-accent)}
  .mo-fb-fns .mo-chip{font-family:ui-monospace,monospace}
  .mo-fb-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .mo-fb-foot label{font-size:.75rem;color:var(--mo-fg2);display:flex;align-items:center;gap:4px}
  .mo-fb-foot select{background:var(--mo-s2);color:var(--mo-fg);border:none;border-radius:5px;padding:4px;font-family:inherit}

  .mo-menu{position:absolute;z-index:130;min-width:200px;max-height:70%;overflow:auto;background:var(--mo-s1);border:1px solid var(--mo-border);border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px}
  .mo-menu-title{color:var(--mo-dim);font-size:.72rem;padding:4px 8px}
  .mo-mi{display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;color:var(--mo-fg);padding:6px 8px;border-radius:5px;cursor:pointer;font-size:.82rem;text-align:left;font-family:inherit}
  .mo-mi:hover:not(:disabled){background:var(--mo-s2)}
  .mo-mi:disabled{opacity:.4;cursor:default}
  .mo-mi-ico{width:18px;text-align:center}
  .mo-mi-label{flex:1}
  .mo-mi-hint{color:var(--mo-dim);font-size:.72rem}
  .mo-danger-mi{color:var(--mo-red)}
  .mo-menu-sep{height:1px;background:var(--mo-s2);margin:4px 2px}
  .mo-palette{min-width:0;display:grid;grid-template-columns:repeat(5,24px);gap:5px;padding:8px}
  .mo-sw{width:24px;height:24px;border-radius:5px;border:1px solid var(--mo-border);cursor:pointer}
  .mo-sw-none{grid-column:1/-1;background:var(--mo-s2);border:none;color:var(--mo-fg);border-radius:5px;padding:4px;cursor:pointer;font-size:.75rem;font-family:inherit}
  .mo-overlay{position:absolute;inset:0;z-index:140;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .mo-dialog{background:var(--mo-s1);border:1px solid var(--mo-border);border-radius:12px;padding:16px;width:min(420px,100%);display:flex;flex-direction:column;gap:10px}
  .mo-dialog h3{margin:0;font-size:1rem}
  .mo-dialog p{margin:0;line-height:1.45}
  .mo-dlg-in{background:var(--mo-bg);border:1px solid var(--mo-border);color:var(--mo-fg);border-radius:6px;padding:8px;font-size:.9rem;font-family:inherit}
  .mo-dlg-in:focus{outline:none;border-color:var(--mo-accent)}
  .mo-dlg-hint{color:var(--mo-dim);font-size:.75rem}
  .mo-dlg-foot{display:flex;justify-content:flex-end;gap:8px}
  .mo-preview{position:absolute;inset:0;z-index:145;display:flex;flex-direction:column;background:var(--mo-bg)}
  .mo-pv-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--mo-s2);flex-wrap:wrap}
  .mo-pv-title{color:var(--mo-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}
  .mo-pv-count{color:var(--mo-dim);font-size:.78rem;white-space:nowrap}
  .mo-pv-frame{flex:1;border:0;width:100%;background:#d9dce1}
  .mo-dialog.mo-dialog-wide{width:min(560px,100%)}
  .mo-ps{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
  .mo-ps-form{flex:1;min-width:230px;display:flex;flex-direction:column;gap:8px}
  .mo-ps-form label{display:flex;flex-direction:column;gap:3px;font-size:.78rem;color:var(--mo-fg2)}
  .mo-ps-form select,.mo-ps-form input{background:var(--mo-bg);border:1px solid var(--mo-border);color:var(--mo-fg);border-radius:6px;padding:5px 6px;font-family:inherit;font-size:.85rem}
  .mo-ps-m{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
  .mo-ps-m span{display:flex;align-items:center;gap:4px;color:var(--mo-dim)}
  .mo-ps-m input{width:100%;min-width:0}
  .mo-ps-view{width:160px;height:160px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin:0 auto}
  .mo-ps-sheet{position:relative;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35);transition:width .15s,height .15s}
  .mo-ps-text{position:absolute;background:repeating-linear-gradient(to bottom,#c9d3e6 0,#c9d3e6 2px,transparent 2px,transparent 6px)}
  .mo-ps-num{position:absolute;font-size:8px;line-height:1;color:#555}
  .mo-xl-list{max-height:320px;overflow:auto;border:1px solid var(--mo-border);border-radius:8px;padding:4px 0;margin-bottom:4px}
  .mo-xl-group{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mo-dim);padding:8px 12px 4px}
  .mo-xl-row{display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;font-size:.88rem}
  .mo-xl-row:hover{background:var(--mo-s2)}
  .mo-xl-row small{margin-left:auto;color:var(--mo-fg2);font-size:.75rem}
  .mo-xl-all{padding:4px 2px 8px;font-weight:600}
  .mo-xl-all:hover{background:none}
  .mo-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,20px);opacity:0;transition:all .2s;z-index:150;background:var(--mo-s2);color:var(--mo-fg);
    padding:8px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35);font-size:.82rem;max-width:90%}
  .mo-toast.show{opacity:1;transform:translate(-50%,0)}
  .mo-toast-bad{background:var(--mo-red);color:var(--mo-on-accent)} .mo-toast-good{background:var(--mo-green);color:var(--mo-on-accent)}
  `;

  window.MvmOffice = {
    mount(root, opts) {
      const o = new Office(root, opts);
      return { destroy: () => o.destroy(), office: o };
    },
  };
})();
