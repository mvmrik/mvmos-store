// mvmPhoto — dialogs, menus, messages and the server file dialogs. These are
// mixed into the editor, so `this` is the editor and `this.root` its element.
(function () {
  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }
  const folderPicker = () => (typeof FolderPicker !== 'undefined' ? FolderPicker : null);
  const CHUNK = 80 * 1024 * 1024;

  const UI = {
    modal(title, bodyHTML, buttons, onMount, cls) {
      const ov = document.createElement('div');
      ov.className = 'mp-modal';
      ov.innerHTML = `<div class="mp-modal-box ${cls || ''}">
        <div class="mp-modal-head">${esc(String(title).replace(/…$/, ''))}</div>
        <div class="mp-modal-body">${bodyHTML}</div>
        <div class="mp-modal-foot">${buttons.map((b, i) => `<button class="mp-btn${b.primary ? ' mp-primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      this.root.appendChild(ov);
      const box = ov.querySelector('.mp-modal-box');
      ov.querySelector('.mp-modal-foot').addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const def = buttons[+b.dataset.i];
        if (def.onClick && def.onClick(box) === false) return;
        if (!def.keep) this.closeModal(box);
      });
      ov.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          const cancel = buttons.find(b => !b.primary);
          if (cancel && cancel.onClick) cancel.onClick(box);
          if (!cancel || !cancel.keep) this.closeModal(box);
        } else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') {
          const primary = buttons.findIndex(b => b.primary);
          if (primary >= 0) ov.querySelector(`[data-i="${primary}"]`).click();
        }
      });
      if (onMount) onMount(box);
      const first = box.querySelector('input[type="text"], input[type="number"], select, button.mp-primary, button');
      if (first) setTimeout(() => first.focus(), 0);
      return box;
    },
    closeModal(box) {
      const ov = box && box.closest('.mp-modal');
      if (ov) ov.remove();
      this.root.focus({ preventScroll: true });
    },
    modalOpen() { return !!this.root.querySelector('.mp-modal'); },
    confirm(message, okLabel) {
      return new Promise(resolve => {
        this.modal(t('mp_confirm'), `<p>${esc(message)}</p>`, [
          { label: t('mp_cancel'), onClick: () => resolve(false) },
          { label: okLabel || t('mp_ok'), primary: true, onClick: () => resolve(true) },
        ]);
      });
    },
    prompt(label, value) {
      return new Promise(resolve => {
        this.modal(label, `<input type="text" class="mp-input" value="${esc(value || '')}">`, [
          { label: t('mp_cancel'), onClick: () => resolve(null) },
          { label: t('mp_ok'), primary: true, onClick: box => resolve(box.querySelector('input').value) },
        ], box => setTimeout(() => box.querySelector('input').select(), 0));
      });
    },
    choice(title, options) {
      return new Promise(resolve => {
        const box = this.modal(title, `<div class="mp-choices">${options.map(o => `<button class="mp-btn" data-c="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>`, [
          { label: t('mp_cancel'), onClick: () => resolve(null) },
        ]);
        box.querySelector('.mp-choices').addEventListener('click', e => {
          const b = e.target.closest('[data-c]');
          if (!b) return;
          this.closeModal(box);
          resolve(b.dataset.c);
        });
      });
    },
    // items: {label, icon, keys, onClick, disabled, check} or {sep: true}
    menu(x, y, items, anchor) {
      this.closeMenu();
      const el = document.createElement('div');
      el.className = 'mp-menu';
      el.innerHTML = items.map((it, i) => it.sep ? '<div class="mp-menu-sep"></div>'
        : `<div class="mp-menu-item${it.disabled ? ' mp-off' : ''}" data-i="${i}"><span class="mp-menu-ic">${it.check ? '✓' : it.icon || ''}</span><span class="mp-menu-label">${esc(it.label)}</span>${it.keys ? `<span class="mp-menu-keys">${esc(it.keys)}</span>` : ''}</div>`).join('');
      this.root.appendChild(el);
      const rr = this.root.getBoundingClientRect();
      el.style.left = Math.max(4, Math.min(x - rr.left, rr.width - el.offsetWidth - 4)) + 'px';
      el.style.top = Math.max(4, Math.min(y - rr.top, rr.height - el.offsetHeight - 4)) + 'px';
      el.addEventListener('click', e => {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        const def = items[+it.dataset.i];
        if (def.disabled) return;
        this.closeMenu();
        def.onClick();
      });
      setTimeout(() => {
        this.menuAway = e => { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) this.closeMenu(); };
        document.addEventListener('pointerdown', this.menuAway, true);
      }, 0);
      this.menuEl = el;
      this.menuAnchor = anchor || null;
    },
    closeMenu() {
      if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
      if (this.menuAnchor) { this.menuAnchor.classList.remove('mp-on'); this.menuAnchor = null; }
      if (this.menuAway) { document.removeEventListener('pointerdown', this.menuAway, true); this.menuAway = null; }
    },
    toast(msg, kind) {
      const el = document.createElement('div');
      el.className = 'mp-toast' + (kind ? ' mp-toast-' + kind : '');
      el.textContent = msg;
      this.root.querySelector('.mp-toasts').appendChild(el);
      setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
    },

    // ── Server files ───────────────────────────────────────────────────
    async places() {
      try {
        const r = await fetch('/api/files/places');
        if (r.ok) return await r.json();
      } catch (e) { /* offline */ }
      return { home: '/', xdg: [] };
    },
    async exists(dir, name) {
      try {
        const r = await fetch('/api/files?path=' + encodeURIComponent(dir));
        return ((await r.json()).entries || []).some(x => x.name === name);
      } catch (e) { return false; }
    },
    pickFolder(title, root) {
      return new Promise(resolve => {
        const fp = folderPicker();
        if (!fp) { resolve(null); return; }
        let done = false;
        fp.open({ root, title, onSelect: dir => { done = true; resolve(dir); } });
        // FolderPicker has no cancel callback; resolve null once its overlay goes away.
        const watch = setInterval(() => {
          if (!document.getElementById('fp-overlay')) { clearInterval(watch); if (!done) setTimeout(() => { if (!done) resolve(null); }, 0); }
        }, 300);
      });
    },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    },
    // Writes a file of any kind and size into a server folder, replacing a
    // file of the same name.
    async uploadTo(dir, name, blob) {
      const id = 'mp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const total = Math.max(1, Math.ceil(blob.size / CHUNK));
      for (let i = 0; i < total; i++) {
        const fd = new FormData();
        fd.append('upload_id', id);
        fd.append('chunk_index', String(i));
        fd.append('total_chunks', String(total));
        fd.append('filename', name);
        fd.append('path', dir);
        fd.append('file', blob.slice(i * CHUNK, (i + 1) * CHUNK), name);
        const r = await fetch('/api/files/upload-chunk', { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error || d.detail) throw new Error('upload');
      }
    },
    // Asks for a folder and a file name on the server. Resolves {dir, name}
    // or null; asks before replacing an existing file.
    async askServerTarget(title, startDir, name, ext) {
      const places = await this.places();
      const dir = await this.pickFolder(title, startDir || places.home || '/');
      if (!dir) return null;
      const typed = await this.prompt(t('mp_file_name'), name);
      if (typed == null || !typed.trim()) return null;
      let file = typed.trim().replace(/[\\/]+/g, ' ');
      if (ext && extOf(file) !== ext) file += '.' + ext;
      if (await this.exists(dir, file) && !(await this.confirm(t('mp_overwrite_confirm', { name: file }), t('mp_replace')))) return null;
      return { dir: dir.replace(/\/+$/, '') || '/', name: file };
    },

    // FolderPicker only chooses folders; this one shows the files in them,
    // limited to the kinds that can be opened here.
    fileBrowser({ title, places, exts }) {
      return new Promise(resolve => {
        const home = places.home || '/';
        const pics = (places.xdg || []).find(x => x.name === 'Pictures');
        let path = pics ? pics.path : home;
        const box = this.modal(title, `
          <div class="mp-fb-places">
            <button class="mp-btn mp-small" data-p="${esc(home)}">🏠 ${esc(t('mp_home'))}</button>
            ${(places.xdg || []).filter(x => ['Pictures', 'Downloads', 'Documents', 'Desktop'].includes(x.name)).map(x => `<button class="mp-btn mp-small" data-p="${esc(x.path)}">${x.icon || '📁'} ${esc(x.name)}</button>`).join('')}
          </div>
          <div class="mp-fb-path"></div>
          <div class="mp-fb-list"></div>`, [
          { label: t('mp_cancel'), onClick: () => resolve(null) },
        ], null, 'mp-modal-wide');
        const listEl = box.querySelector('.mp-fb-list');
        const pathEl = box.querySelector('.mp-fb-path');
        const go = async p => {
          path = p;
          pathEl.textContent = p;
          listEl.innerHTML = `<div class="mp-empty">${esc(t('mp_loading'))}</div>`;
          let entries = [];
          try {
            const r = await fetch('/api/files?path=' + encodeURIComponent(p));
            if (!r.ok) throw new Error('list');
            entries = (await r.json()).entries || [];
          } catch (e) {
            listEl.innerHTML = `<div class="mp-empty mp-bad">${esc(t('mp_folder_failed'))}</div>`;
            return;
          }
          const dirs = entries.filter(x => x.type === 'dir' && !x.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
          const files = entries.filter(x => x.type === 'file' && exts.includes(extOf(x.name))).sort((a, b) => a.name.localeCompare(b.name));
          const parent = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
          const rows = [];
          if (p !== '/') rows.push(`<div class="mp-fb-row" data-dir="${esc(parent)}">⬆ ..</div>`);
          for (const d of dirs) rows.push(`<div class="mp-fb-row" data-dir="${esc(p.replace(/\/+$/, '') + '/' + d.name)}">📁 ${esc(d.name)}</div>`);
          for (const f of files) {
            const fp = p.replace(/\/+$/, '') + '/' + f.name;
            rows.push(`<div class="mp-fb-row mp-fb-file" data-file="${esc(fp)}">${extOf(f.name) === 'mvmphoto' ? '🎨' : '🖼'} <span class="mp-fb-name">${esc(f.name)}</span><span class="mp-dim">${fmtBytes(f.size || 0)}</span></div>`);
          }
          if (!dirs.length && !files.length) rows.push(`<div class="mp-empty">${esc(t('mp_folder_empty'))}</div>`);
          listEl.innerHTML = rows.join('');
        };
        box.querySelector('.mp-fb-places').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) go(b.dataset.p); });
        listEl.addEventListener('click', e => {
          const row = e.target.closest('.mp-fb-row');
          if (!row) return;
          if (row.dataset.dir) { go(row.dataset.dir); return; }
          if (!row.dataset.file) return;
          this.closeModal(box);
          resolve(row.dataset.file);
        });
        go(path);
      });
    },
  };

  window.MvmPhotoUI = { UI, t, esc, extOf, fmtBytes };
})();
