// mvmPhoto — the editor window: menus, tool options, the canvas view, the
// color and layer panels, and opening, saving and exporting.
//
// window.MvmPhoto.mount(root, { desktop, openPath }) -> { editor, destroy, openPath }
(function () {
  const D = window.MvmPhotoDoc;
  const { UI, t, esc, extOf } = window.MvmPhotoUI;
  const EXT = 'mvmphoto';
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico'];
  const ZOOMS = [0.02, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const SWATCHES = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#e03131', '#f76707', '#fcc419', '#40c057',
    '#12b886', '#15aabf', '#228be6', '#4c6ef5', '#7950f2', '#be4bdb', '#e64980', '#8d5524'];
  const NEW_PRESETS = [[1920, 1080], [1280, 720], [3840, 2160], [1080, 1080], [1080, 1920], [2480, 3508], [800, 600]];
  const OPTS_KEY = 'mvmphoto.options';

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const MOD = isMac ? '⌘' : 'Ctrl+';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function hexOk(s) { return /^#?[0-9a-f]{6}$/i.test(s) || /^#?[0-9a-f]{3}$/i.test(s); }
  function normHex(s) {
    s = s.replace('#', '').toLowerCase();
    if (s.length === 3) s = s.split('').map(c => c + c).join('');
    return '#' + s;
  }
  function rgbHex(r, g, b) { return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }

  class Editor {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.doc = null;
      this.name = '';
      this.source = null;       // {kind:'server', path} of the project file
      this.origin = null;       // {dir, name} of the image the document came from
      this.dirty = false;
      this.view = { zoom: 1, x: 0, y: 0 };
      this.fg = '#000000';
      this.bg = '#ffffff';
      this.recent = [];
      this.toolId = 'brush';
      this.options = this.loadOptions();
      this.paint = null;        // {canvas, op, alpha} being drawn on the active layer
      this.float = null;        // pixels being moved or transformed
      this.adjust = null;       // {layerId, canvas} preview of an adjustment
      this.clip = null;         // {canvas, x, y} copied pixels
      this.compDirty = true;
      this.ants = 0;
      this.pointer = null;
      this.spaceDown = false;
      this.tools = window.MvmPhotoTools.create(this);
      this.build();
      if (window.mvmOS && mvmOS.onLangChange) mvmOS.onLangChange(() => { if (!this.dead) this.relabel(); });
      this.antsTimer = setInterval(() => {
        if (this.doc && this.doc.sel && !this.dead) { this.ants = (this.ants + 1) % 16; this.redraw(); }
      }, 140);
      if (this.opts.openPath) this.openPath(this.opts.openPath);
    }

    loadOptions() {
      const def = {
        select: { mode: 'new' },
        wand: { mode: 'new', tolerance: 32, contiguous: true, all: false },
        brush: { size: 20, hardness: 80, opacity: 100 },
        pencil: { size: 1, opacity: 100 },
        eraser: { size: 30, hardness: 80, opacity: 100 },
        bucket: { tolerance: 32, contiguous: true, all: false, opacity: 100 },
        gradient: { kind: 'linear', clear: false, opacity: 100 },
        shape: { kind: 'rect', style: 'fill', width: 4, opacity: 100 },
        text: { font: 'sans-serif', size: 48, bold: false, italic: false },
        picker: { all: true },
      };
      try {
        const saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}');
        for (const k of Object.keys(def)) if (saved[k] && typeof saved[k] === 'object') Object.assign(def[k], saved[k]);
      } catch (e) { /* no storage */ }
      return def;
    }
    saveOptions() { try { localStorage.setItem(OPTS_KEY, JSON.stringify(this.options)); } catch (e) { /* no storage */ } }

    // ── Layout ───────────────────────────────────────────────────────────
    build() {
      if (!document.getElementById('mvmphoto-style')) {
        const st = document.createElement('style');
        st.id = 'mvmphoto-style';
        st.textContent = STYLE;
        document.head.appendChild(st);
      }
      const r = this.root;
      r.classList.add('mp-root');
      r.tabIndex = 0;
      r.innerHTML = `
        <div class="mp-menubar"></div>
        <div class="mp-options"></div>
        <div class="mp-main">
          <div class="mp-tools"></div>
          <div class="mp-view">
            <canvas class="mp-canvas"></canvas>
            <div class="mp-welcome"></div>
          </div>
          <div class="mp-side">
            <div class="mp-panel mp-color-panel"></div>
            <div class="mp-panel mp-layers-panel"></div>
          </div>
        </div>
        <div class="mp-status"></div>
        <input type="color" class="mp-color-input" data-which="fg">
        <input type="color" class="mp-color-input" data-which="bg">
        <div class="mp-toasts"></div>`;
      this.viewEl = r.querySelector('.mp-view');
      this.canvas = r.querySelector('.mp-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.comp = null;

      const v = this.viewEl;
      v.addEventListener('pointerdown', e => this.onDown(e));
      v.addEventListener('pointermove', e => this.onMove(e));
      v.addEventListener('pointerup', e => this.onUp(e));
      v.addEventListener('pointercancel', e => this.onUp(e));
      v.addEventListener('pointerleave', () => { this.pointer = null; this.redraw(); this.renderStatus(); });
      v.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      v.addEventListener('contextmenu', e => e.preventDefault());
      v.addEventListener('dblclick', e => { const tl = this.tool(); if (tl.dblclick) tl.dblclick(this.imagePoint(e), e); });
      v.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); v.classList.add('mp-dropping'); } });
      v.addEventListener('dragleave', () => v.classList.remove('mp-dropping'));
      v.addEventListener('drop', e => {
        v.classList.remove('mp-dropping');
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        this.openLocalFiles([...e.dataTransfer.files]);
      });
      r.addEventListener('keydown', e => this.onKey(e));
      r.addEventListener('keyup', e => {
        if (e.key === ' ') { this.spaceDown = false; this.updateCursor(); }
      });
      r.addEventListener('paste', e => this.onPaste(e));
      r.querySelectorAll('.mp-color-input').forEach(inp => {
        inp.addEventListener('input', () => this.setColor(inp.dataset.which, inp.value, true));
        inp.addEventListener('change', () => this.pushRecent(inp.value));
      });
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(v);
      this.render();
    }

    relabel() { this.render(); }

    render() {
      this.renderMenubar();
      this.renderToolbox();
      this.renderOptions();
      this.renderColor();
      this.renderLayers();
      this.renderWelcome();
      this.renderStatus();
      this.updateCursor();
      this.redraw();
    }

    renderMenubar() {
      const el = this.root.querySelector('.mp-menubar');
      const menus = ['file', 'edit', 'image', 'layer', 'select', 'adjust'];
      el.innerHTML = menus.map(m => `<button class="mp-menubtn" data-m="${m}">${esc(t('mp_menu_' + m))}</button>`).join('')
        + `<span class="mp-docname">${this.doc ? esc(this.name || t('mp_untitled')) + (this.dirty ? ' •' : '') : ''}</span>`;
      el.onclick = e => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (this.menuAnchor === b) { this.closeMenu(); return; }
        const rc = b.getBoundingClientRect();
        this.menu(rc.left, rc.bottom + 2, this.menuItems(b.dataset.m), b);
        b.classList.add('mp-on');
      };
      el.onpointerover = e => {
        const b = e.target.closest('[data-m]');
        if (b && this.menuEl && this.menuAnchor && this.menuAnchor !== b) {
          const rc = b.getBoundingClientRect();
          this.menu(rc.left, rc.bottom + 2, this.menuItems(b.dataset.m), b);
          b.classList.add('mp-on');
        }
      };
    }

    menuItems(m) {
      const d = this.doc;
      const has = !!d;
      const sel = !!(d && d.sel);
      const L = d && d.activeLayer();
      const idx = d && L ? d.indexOf(L.id) : -1;
      const sh = isMac ? '⇧' : 'Shift+';
      if (m === 'file') return [
        { label: t('mp_new'), icon: '📄', keys: MOD + 'N', onClick: () => this.newDialog() },
        { label: t('mp_open_server'), icon: '📂', keys: MOD + 'O', onClick: () => this.openFromServer() },
        { label: t('mp_open_computer'), icon: '💻', onClick: () => this.openFromComputer() },
        { sep: true },
        { label: t('mp_place_server'), icon: '➕', disabled: !has, onClick: () => this.placeFromServer() },
        { label: t('mp_place_computer'), icon: '➕', disabled: !has, onClick: () => this.placeFromComputer() },
        { sep: true },
        { label: t('mp_save'), icon: '💾', keys: MOD + 'S', disabled: !has, onClick: () => this.save() },
        { label: t('mp_save_as'), icon: '💾', keys: MOD + sh + 'S', disabled: !has, onClick: () => this.saveAs() },
        { label: t('mp_export'), icon: '🖼', keys: MOD + sh + 'E', disabled: !has, onClick: () => this.exportDialog() },
      ];
      if (m === 'edit') return [
        { label: t('mp_undo'), icon: '↶', keys: MOD + 'Z', disabled: !has || !d.undoStack.length, onClick: () => this.undo() },
        { label: t('mp_redo'), icon: '↷', keys: MOD + sh + 'Z', disabled: !has || !d.redoStack.length, onClick: () => this.redo() },
        { sep: true },
        { label: t('mp_cut'), keys: MOD + 'X', disabled: !has, onClick: () => this.copy(true) },
        { label: t('mp_copy'), keys: MOD + 'C', disabled: !has, onClick: () => this.copy(false) },
        { label: t('mp_copy_merged'), keys: MOD + sh + 'C', disabled: !has, onClick: () => this.copy(false, true) },
        { label: t('mp_paste'), keys: MOD + 'V', onClick: () => this.pasteFromMenu() },
        { sep: true },
        { label: t('mp_fill_fg'), keys: isMac ? '⌥⌫' : 'Alt+Backspace', disabled: !has, onClick: () => this.fillSelection(this.fg) },
        { label: t('mp_fill_bg'), keys: MOD + '⌫', disabled: !has, onClick: () => this.fillSelection(this.bg) },
        { label: t('mp_clear'), keys: 'Delete', disabled: !has, onClick: () => this.clearSelection() },
        { sep: true },
        { label: t('mp_free_transform'), keys: MOD + 'T', disabled: !has, onClick: () => this.freeTransform() },
      ];
      if (m === 'image') return [
        { label: t('mp_image_size'), keys: MOD + (isMac ? '⌥' : 'Alt+') + 'I', disabled: !has, onClick: () => this.imageSizeDialog() },
        { label: t('mp_canvas_size'), keys: MOD + (isMac ? '⌥' : 'Alt+') + 'C', disabled: !has, onClick: () => this.canvasSizeDialog() },
        { sep: true },
        { label: t('mp_rotate_cw'), icon: '↻', disabled: !has, onClick: () => this.rotateImage(90) },
        { label: t('mp_rotate_ccw'), icon: '↺', disabled: !has, onClick: () => this.rotateImage(270) },
        { label: t('mp_rotate_180'), disabled: !has, onClick: () => this.rotateImage(180) },
        { label: t('mp_flip_h'), icon: '⇋', disabled: !has, onClick: () => this.flipImage(true) },
        { label: t('mp_flip_v'), icon: '⇵', disabled: !has, onClick: () => this.flipImage(false) },
        { sep: true },
        { label: t('mp_crop_selection'), icon: '✂', disabled: !sel, onClick: () => this.cropToSelection() },
        { label: t('mp_trim'), disabled: !has, onClick: () => this.trimTransparent() },
        { label: t('mp_flatten'), disabled: !has || d.layers.length < 2, onClick: () => this.flatten() },
      ];
      if (m === 'layer') return [
        { label: t('mp_layer_new'), icon: '➕', keys: MOD + sh + 'N', disabled: !has, onClick: () => this.addLayer() },
        { label: t('mp_layer_duplicate'), icon: '⧉', keys: MOD + 'J', disabled: !L, onClick: () => this.duplicateLayer() },
        { label: t('mp_layer_delete'), icon: '🗑', disabled: !L || d.layers.length < 2, onClick: () => this.deleteLayer() },
        { label: t('mp_layer_rename'), disabled: !L, onClick: () => this.renameLayer() },
        { sep: true },
        { label: t('mp_layer_up'), icon: '▲', keys: MOD + ']', disabled: !L || idx >= d.layers.length - 1, onClick: () => this.moveLayer(1) },
        { label: t('mp_layer_down'), icon: '▼', keys: MOD + '[', disabled: !L || idx <= 0, onClick: () => this.moveLayer(-1) },
        { label: t('mp_merge_down'), keys: MOD + 'E', disabled: !L || idx <= 0, onClick: () => this.mergeDown() },
        { label: t('mp_flatten'), disabled: !has || d.layers.length < 2, onClick: () => this.flatten() },
        { sep: true },
        { label: t('mp_layer_from_selection'), disabled: !sel, onClick: () => this.duplicateLayer() },
        { label: t('mp_select_layer_pixels'), disabled: !L, onClick: () => this.selectLayerPixels() },
      ];
      if (m === 'select') return [
        { label: t('mp_select_all'), keys: MOD + 'A', disabled: !has, onClick: () => this.selectAll() },
        { label: t('mp_deselect'), keys: MOD + 'D', disabled: !sel, onClick: () => this.deselect() },
        { label: t('mp_select_invert'), keys: MOD + sh + 'I', disabled: !has, onClick: () => this.invertSelection() },
        { label: t('mp_select_layer_pixels'), disabled: !L, onClick: () => this.selectLayerPixels() },
        { sep: true },
        { label: t('mp_select_grow'), disabled: !sel, onClick: () => this.growSelection(1) },
        { label: t('mp_select_shrink'), disabled: !sel, onClick: () => this.growSelection(-1) },
        { label: t('mp_select_feather'), disabled: !sel, onClick: () => this.featherSelection() },
      ];
      if (m === 'adjust') return [
        { label: t('mp_brightness_contrast'), icon: '☀', disabled: !L, onClick: () => this.adjustDialog('bc') },
        { label: t('mp_hue_saturation'), icon: '🎨', keys: MOD + 'U', disabled: !L, onClick: () => this.adjustDialog('hs') },
        { label: t('mp_invert_colors'), keys: MOD + 'I', disabled: !L, onClick: () => this.adjustNow(D.invertColors) },
        { label: t('mp_grayscale'), keys: MOD + sh + 'U', disabled: !L, onClick: () => this.adjustNow(D.grayscale) },
        { sep: true },
        { label: t('mp_blur'), icon: '💧', disabled: !L, onClick: () => this.adjustDialog('blur') },
        { label: t('mp_sharpen'), icon: '🔺', disabled: !L, onClick: () => this.adjustDialog('sharpen') },
      ];
      return [];
    }

    renderToolbox() {
      const el = this.root.querySelector('.mp-tools');
      el.innerHTML = this.tools.list.map(tl => `<button class="mp-tool${tl.id === this.toolId ? ' mp-on' : ''}" data-tool="${tl.id}" title="${esc(t('mp_tool_' + tl.id))} (${tl.key.toUpperCase()})">${tl.icon}</button>`).join('')
        + `<div class="mp-swatch-pair">
            <button class="mp-sw mp-sw-fg" title="${esc(t('mp_foreground'))}" style="background:${this.fg}"></button>
            <button class="mp-sw mp-sw-bg" title="${esc(t('mp_background'))}" style="background:${this.bg}"></button>
            <button class="mp-sw-swap" title="${esc(t('mp_swap_colors'))} (X)">⇄</button>
            <button class="mp-sw-reset" title="${esc(t('mp_default_colors'))} (D)">◩</button>
          </div>`;
      el.onclick = e => {
        const b = e.target.closest('[data-tool]');
        if (b) { this.setTool(b.dataset.tool); return; }
        if (e.target.closest('.mp-sw-fg')) this.pickColor('fg');
        else if (e.target.closest('.mp-sw-bg')) this.pickColor('bg');
        else if (e.target.closest('.mp-sw-swap')) this.swapColors();
        else if (e.target.closest('.mp-sw-reset')) this.defaultColors();
      };
    }

    pickColor(which) {
      const inp = this.root.querySelector(`.mp-color-input[data-which="${which}"]`);
      inp.value = which === 'fg' ? this.fg : this.bg;
      inp.click();
    }

    // Tool options: built from each tool's list of fields.
    renderOptions() {
      const el = this.root.querySelector('.mp-options');
      const tl = this.tool();
      const o = this.options[tl.group || tl.id] || {};
      const fields = tl.fields ? tl.fields() : [];
      const parts = [`<span class="mp-opt-title">${tl.icon} ${esc(t('mp_tool_' + tl.id))}</span>`];
      for (const f of fields) {
        if (f.type === 'range') {
          parts.push(`<label class="mp-opt">${esc(t(f.label))}
            <input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${o[f.key]}">
            <input type="number" class="mp-num" data-k="${f.key}" min="${f.min}" max="${f.max}" value="${o[f.key]}">${f.unit ? `<span class="mp-dim">${f.unit}</span>` : ''}</label>`);
        } else if (f.type === 'check') {
          parts.push(`<label class="mp-opt"><input type="checkbox" data-k="${f.key}" ${o[f.key] ? 'checked' : ''}> ${esc(t(f.label))}</label>`);
        } else if (f.type === 'seg') {
          parts.push(`<span class="mp-opt">${f.label ? esc(t(f.label)) : ''}<span class="mp-seg">${f.choices.map(c => `<button class="mp-seg-btn${o[f.key] === c.v ? ' mp-on' : ''}" data-k="${f.key}" data-v="${c.v}" title="${esc(t(c.label))}">${c.icon || esc(t(c.label))}</button>`).join('')}</span></span>`);
        } else if (f.type === 'select') {
          parts.push(`<label class="mp-opt">${esc(t(f.label))} <select data-k="${f.key}">${f.choices.map(c => `<option value="${esc(c.v)}" ${o[f.key] === c.v ? 'selected' : ''}>${esc(c.label ? t(c.label) : c.v)}</option>`).join('')}</select></label>`);
        } else if (f.type === 'button') {
          parts.push(`<button class="mp-btn mp-small${f.primary ? ' mp-primary' : ''}" data-act="${f.act}">${esc(t(f.label))}</button>`);
        } else if (f.type === 'hint') {
          parts.push(`<span class="mp-dim mp-opt-hint">${esc(t(f.label))}</span>`);
        }
      }
      el.innerHTML = parts.join('');
      const set = (k, v) => {
        o[k] = v;
        this.saveOptions();
        if (tl.optionChanged) tl.optionChanged(k);
        this.redraw();
      };
      el.oninput = e => {
        const k = e.target.dataset.k;
        if (!k) return;
        const f = fields.find(x => x.key === k);
        if (e.target.type === 'checkbox') { set(k, e.target.checked); return; }
        if (f.type === 'select') { set(k, e.target.value); return; }
        const n = +e.target.value;
        if (!Number.isFinite(n)) return;
        const v = clamp(n, f.min, f.max);
        el.querySelectorAll(`[data-k="${k}"]`).forEach(x => { if (x !== e.target) x.value = v; });
        set(k, v);
      };
      el.onclick = e => {
        const b = e.target.closest('.mp-seg-btn');
        if (b) {
          set(b.dataset.k, b.dataset.v);
          b.parentElement.querySelectorAll('.mp-seg-btn').forEach(x => x.classList.toggle('mp-on', x === b));
          return;
        }
        const a = e.target.closest('[data-act]');
        if (a && tl.action) tl.action(a.dataset.act);
      };
    }

    renderColor() {
      const el = this.root.querySelector('.mp-color-panel');
      el.innerHTML = `<div class="mp-panel-head">${esc(t('mp_color'))}</div>
        <div class="mp-color-row">
          <button class="mp-color-big" style="background:${this.fg}" title="${esc(t('mp_foreground'))}"></button>
          <input type="text" class="mp-input mp-hex" value="${this.fg}" maxlength="7" spellcheck="false">
          <button class="mp-color-small" style="background:${this.bg}" title="${esc(t('mp_background'))}"></button>
        </div>
        <div class="mp-swatches">${SWATCHES.map(c => `<button class="mp-swatch" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        ${this.recent.length ? `<div class="mp-dim mp-recent-label">${esc(t('mp_recent_colors'))}</div><div class="mp-swatches">${this.recent.map(c => `<button class="mp-swatch" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>` : ''}`;
      el.onclick = e => {
        if (e.target.closest('.mp-color-big')) this.pickColor('fg');
        else if (e.target.closest('.mp-color-small')) this.pickColor('bg');
        const s = e.target.closest('[data-c]');
        if (s) this.setColor(e.altKey ? 'bg' : 'fg', s.dataset.c);
      };
      el.oncontextmenu = e => {
        const s = e.target.closest('[data-c]');
        if (s) { e.preventDefault(); this.setColor('bg', s.dataset.c); }
      };
      const hex = el.querySelector('.mp-hex');
      hex.onchange = () => {
        if (hexOk(hex.value.trim())) this.setColor('fg', normHex(hex.value.trim()));
        else hex.value = this.fg;
      };
      hex.onkeydown = e => { if (e.key === 'Enter') hex.blur(); };
    }

    setColor(which, hex, live) {
      if (which === 'fg') this.fg = hex; else this.bg = hex;
      if (!live) this.pushRecent(hex);
      this.renderToolbox();
      this.renderColor();
      if (this.tools.text.editing) this.tools.text.restyle();
    }
    pushRecent(hex) {
      if (SWATCHES.includes(hex)) return;
      this.recent = [hex, ...this.recent.filter(c => c !== hex)].slice(0, 8);
      this.renderColor();
    }
    swapColors() { [this.fg, this.bg] = [this.bg, this.fg]; this.setColor('fg', this.fg, true); }
    defaultColors() { this.fg = '#000000'; this.bg = '#ffffff'; this.setColor('fg', this.fg, true); }

    renderLayers() {
      const el = this.root.querySelector('.mp-layers-panel');
      const d = this.doc;
      if (!d) { el.innerHTML = `<div class="mp-panel-head">${esc(t('mp_layers'))}</div>`; return; }
      const L = d.activeLayer();
      el.innerHTML = `<div class="mp-panel-head">${esc(t('mp_layers'))}</div>
        <select class="mp-blend" title="${esc(t('mp_blend_mode'))}">${D.BLENDS.map(b => `<option value="${b}" ${L && L.blend === b ? 'selected' : ''}>${esc(t('mp_blend_' + b.replace(/-/g, '_')))}</option>`).join('')}</select>
        <div class="mp-opacity" title="${esc(t('mp_opacity'))}">
          <span class="mp-opacity-label">${esc(t('mp_opacity'))}</span>
          <input type="range" class="mp-layer-op-range" min="0" max="100" value="${L ? Math.round(L.opacity * 100) : 100}">
          <input type="number" class="mp-num mp-layer-op" min="0" max="100" value="${L ? Math.round(L.opacity * 100) : 100}">%
        </div>
        <div class="mp-layer-list">${[...d.layers].reverse().map(l => `
          <div class="mp-layer${l.id === d.active ? ' mp-on' : ''}" data-id="${l.id}" draggable="true">
            <button class="mp-eye" title="${esc(t('mp_visibility'))}">${l.visible ? '👁' : '<span class="mp-dim">—</span>'}</button>
            <canvas class="mp-thumb" width="44" height="34"></canvas>
            <span class="mp-layer-name">${esc(l.name)}</span>
            ${l.opacity < 1 ? `<span class="mp-dim mp-layer-meta">${Math.round(l.opacity * 100)}%</span>` : ''}
          </div>`).join('')}</div>
        <div class="mp-layer-btns">
          <button class="mp-btn mp-small" data-a="new" title="${esc(t('mp_layer_new'))}">➕</button>
          <button class="mp-btn mp-small" data-a="dup" title="${esc(t('mp_layer_duplicate'))}">⧉</button>
          <button class="mp-btn mp-small" data-a="up" title="${esc(t('mp_layer_up'))}">▲</button>
          <button class="mp-btn mp-small" data-a="down" title="${esc(t('mp_layer_down'))}">▼</button>
          <button class="mp-btn mp-small" data-a="merge" title="${esc(t('mp_merge_down'))}">⤓</button>
          <button class="mp-btn mp-small" data-a="del" title="${esc(t('mp_layer_delete'))}">🗑</button>
        </div>`;
      this.paintThumbs();
      const list = el.querySelector('.mp-layer-list');
      list.onclick = e => {
        const row = e.target.closest('.mp-layer');
        if (!row) return;
        if (e.target.closest('.mp-eye')) { this.toggleVisible(row.dataset.id); return; }
        this.selectLayer(row.dataset.id);
      };
      list.ondblclick = e => {
        const row = e.target.closest('.mp-layer');
        if (row && !e.target.closest('.mp-eye')) this.renameLayer(row.dataset.id);
      };
      list.oncontextmenu = e => {
        const row = e.target.closest('.mp-layer');
        if (!row) return;
        e.preventDefault();
        this.selectLayer(row.dataset.id);
        this.menu(e.clientX, e.clientY, this.menuItems('layer'));
      };
      let dragId = null;
      list.ondragstart = e => { const row = e.target.closest('.mp-layer'); dragId = row && row.dataset.id; e.dataTransfer.effectAllowed = 'move'; };
      list.ondragover = e => {
        if (!dragId) return;
        e.preventDefault();
        list.querySelectorAll('.mp-layer').forEach(x => x.classList.remove('mp-drop-above', 'mp-drop-below'));
        const row = e.target.closest('.mp-layer');
        if (row && row.dataset.id !== dragId) {
          const rc = row.getBoundingClientRect();
          row.classList.add(e.clientY < rc.top + rc.height / 2 ? 'mp-drop-above' : 'mp-drop-below');
        }
      };
      list.ondrop = e => {
        e.preventDefault();
        const row = e.target.closest('.mp-layer');
        if (row && dragId && row.dataset.id !== dragId) {
          const rc = row.getBoundingClientRect();
          this.reorderLayer(dragId, row.dataset.id, e.clientY < rc.top + rc.height / 2);
        }
        dragId = null;
        list.querySelectorAll('.mp-layer').forEach(x => x.classList.remove('mp-drop-above', 'mp-drop-below'));
      };
      list.ondragend = () => { dragId = null; };
      el.querySelector('.mp-layer-btns').onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        ({ new: () => this.addLayer(), dup: () => this.duplicateLayer(), up: () => this.moveLayer(1), down: () => this.moveLayer(-1),
          merge: () => this.mergeDown(), del: () => this.deleteLayer() })[b.dataset.a]();
      };
      el.querySelector('.mp-blend').onchange = e => {
        const l = this.doc.activeLayer();
        if (!l) return;
        this.doc.checkpoint();
        this.doc.activeLayer().blend = e.target.value;
        this.changed();
      };
      // One undo step per slider drag, however many values it passes.
      let editing = false;
      const setOp = (v, from) => {
        const l = this.doc.activeLayer();
        if (!l) return;
        if (!editing) { this.doc.checkpoint(); editing = true; }
        this.doc.activeLayer().opacity = clamp(v, 0, 100) / 100;
        el.querySelectorAll('.mp-layer-op, .mp-layer-op-range').forEach(x => { if (x !== from) x.value = Math.round(clamp(v, 0, 100)); });
        this.compDirty = true;
        this.dirty = true;
        this.redraw();
      };
      const endOp = () => { if (editing) { editing = false; this.changed(); } };
      const range = el.querySelector('.mp-layer-op-range');
      const num = el.querySelector('.mp-layer-op');
      range.oninput = () => setOp(+range.value, range);
      range.onchange = endOp;
      num.onchange = () => { if (Number.isFinite(+num.value)) setOp(+num.value, num); endOp(); };
    }

    paintThumbs() {
      if (!this.doc) return;
      const d = this.doc;
      this.root.querySelectorAll('.mp-layer').forEach(row => {
        const l = d.layer(row.dataset.id);
        const c = row.querySelector('.mp-thumb');
        if (!l || !c) return;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        const s = Math.min(c.width / d.width, c.height / d.height);
        const w = d.width * s, h = d.height * s;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(l.canvas, (c.width - w) / 2, (c.height - h) / 2, w, h);
      });
    }

    renderWelcome() {
      const el = this.root.querySelector('.mp-welcome');
      el.hidden = !!this.doc;
      if (this.doc) return;
      el.innerHTML = `<div class="mp-welcome-box">
        <div class="mp-welcome-icon">🎨</div>
        <h2>mvmPhoto</h2>
        <p class="mp-dim">${esc(t('mp_welcome'))}</p>
        <div class="mp-welcome-btns">
          <button class="mp-btn mp-primary" data-w="new">📄 ${esc(t('mp_new'))}</button>
          <button class="mp-btn" data-w="server">📂 ${esc(t('mp_open_server'))}</button>
          <button class="mp-btn" data-w="computer">💻 ${esc(t('mp_open_computer'))}</button>
        </div>
      </div>`;
      el.onclick = e => {
        const b = e.target.closest('[data-w]');
        if (!b) return;
        ({ new: () => this.newDialog(), server: () => this.openFromServer(), computer: () => this.openFromComputer() })[b.dataset.w]();
      };
    }

    renderStatus() {
      const el = this.root.querySelector('.mp-status');
      if (!this.doc) { el.innerHTML = ''; return; }
      const p = this.pointer;
      const tl = this.tool();
      el.innerHTML = `<span>${this.doc.width} × ${this.doc.height} px</span>
        <span class="mp-zoom-ctl"><button class="mp-mini" data-z="out">−</button><input class="mp-num mp-zoom-in" value="${Math.round(this.view.zoom * 1000) / 10}">%<button class="mp-mini" data-z="in">+</button><button class="mp-mini" data-z="fit" title="${esc(t('mp_zoom_fit'))} (${MOD}0)">⤢</button><button class="mp-mini" data-z="100" title="${esc(t('mp_zoom_actual'))} (${MOD}1)">1:1</button></span>
        <span class="mp-pos">${p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : ''}</span>
        ${this.doc.sel && this.doc.sel._bounds ? `<span class="mp-dim">⬚ ${this.doc.sel._bounds.w} × ${this.doc.sel._bounds.h}</span>` : ''}
        <span class="mp-dim mp-hint">${tl.hint ? esc(t(tl.hint)) : ''}</span>`;
      el.onclick = e => {
        const b = e.target.closest('[data-z]');
        if (!b) return;
        ({ out: () => this.zoomStep(-1), in: () => this.zoomStep(1), fit: () => this.zoomFit(), 100: () => this.zoomTo(1) })[b.dataset.z]();
      };
      const zi = el.querySelector('.mp-zoom-in');
      zi.onchange = () => { const v = parseFloat(zi.value); if (v > 0) this.zoomTo(clamp(v / 100, ZOOMS[0], ZOOMS[ZOOMS.length - 1])); };
      zi.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') zi.blur(); };
    }

    // Light updates while the pointer moves, without rebuilding the bar.
    renderPos() {
      const el = this.root.querySelector('.mp-pos');
      if (el) el.textContent = this.pointer ? `${Math.floor(this.pointer.x)}, ${Math.floor(this.pointer.y)}` : '';
    }

    // ── Tools ────────────────────────────────────────────────────────────
    tool() { return this.tools.byId[this.toolId]; }
    setTool(id) {
      if (!this.tools.byId[id] || id === this.toolId) return;
      const old = this.tool();
      if (old.leave) old.leave();
      this.toolId = id;
      this.renderToolbox();
      this.renderOptions();
      this.renderStatus();
      this.updateCursor();
      this.redraw();
    }
    updateCursor() {
      const tl = this.tool();
      let c = tl.cursor || 'crosshair';
      if (this.spaceDown || tl.id === 'hand') c = this.panning ? 'grabbing' : 'grab';
      else if (tl.cursorAt && this.pointer) c = tl.cursorAt(this.pointer) || c;
      if (tl.brushCursor && this.pointer && tl.brushCursor() * this.view.zoom > 6 && !this.spaceDown) c = 'none';
      this.viewEl.style.cursor = this.doc ? c : 'default';
    }

    imagePoint(e) {
      const rc = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - rc.left - this.view.x) / this.view.zoom, y: (e.clientY - rc.top - this.view.y) / this.view.zoom };
    }
    toScreen(p) { return { x: p.x * this.view.zoom + this.view.x, y: p.y * this.view.zoom + this.view.y }; }

    onDown(e) {
      if (!this.doc || this.modalOpen()) return;
      if (e.target.closest('.mp-text-edit')) return;
      this.root.focus({ preventScroll: true });
      this.closeMenu();
      if (e.button === 2) return;
      const p = this.imagePoint(e);
      this.pointer = p;
      this.viewEl.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.spaceDown || this.toolId === 'hand') {
        e.preventDefault();
        this.panning = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
        this.updateCursor();
        return;
      }
      if (e.button !== 0) return;
      let tl = this.tool();
      // Alt picks a color with the tools that paint, like the eyedropper.
      if (e.altKey && tl.paints) tl = this.tools.byId.picker;
      this.drag = { tool: tl };
      tl.down(p, e);
      this.redraw();
    }
    onMove(e) {
      if (!this.doc) return;
      const p = this.imagePoint(e);
      this.pointer = p;
      this.renderPos();
      if (this.panning) {
        this.view.x = this.panning.vx + e.clientX - this.panning.x;
        this.view.y = this.panning.vy + e.clientY - this.panning.y;
        this.clampView();
        this.redraw();
        return;
      }
      if (this.drag) {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of evs.length ? evs : [e]) this.drag.tool.move(this.imagePoint(ev), ev);
      } else {
        const tl = this.tool();
        if (tl.hover) tl.hover(p, e);
        this.updateCursor();
      }
      this.redraw();
    }
    onUp(e) {
      if (this.panning) { this.panning = null; this.updateCursor(); return; }
      if (!this.drag) return;
      const tl = this.drag.tool;
      this.drag = null;
      if (tl.up) tl.up(this.imagePoint(e), e);
      this.redraw();
    }
    onWheel(e) {
      if (!this.doc) return;
      e.preventDefault();
      const rc = this.canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025));
        this.zoomTo(clamp(this.view.zoom * f, ZOOMS[0], ZOOMS[ZOOMS.length - 1]), e.clientX - rc.left, e.clientY - rc.top);
        return;
      }
      const k = e.deltaMode ? 20 : 1;
      this.view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      this.view.y -= (e.shiftKey ? 0 : e.deltaY) * k;
      this.clampView();
      this.redraw();
    }

    // ── View ─────────────────────────────────────────────────────────────
    resize() {
      const rc = this.viewEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.vw = Math.max(1, rc.width);
      this.vh = Math.max(1, rc.height);
      this.canvas.width = Math.round(this.vw * dpr);
      this.canvas.height = Math.round(this.vh * dpr);
      this.canvas.style.width = this.vw + 'px';
      this.canvas.style.height = this.vh + 'px';
      if (this.doc && !this.viewed) { this.zoomFit(); this.viewed = true; }
      this.clampView();
      this.redraw();
    }
    zoomFit() {
      if (!this.doc || !this.vw) return;
      const z = Math.min(1, (this.vw - 40) / this.doc.width, (this.vh - 40) / this.doc.height);
      this.view.zoom = Math.max(ZOOMS[0], z);
      this.view.x = Math.round((this.vw - this.doc.width * this.view.zoom) / 2);
      this.view.y = Math.round((this.vh - this.doc.height * this.view.zoom) / 2);
      this.afterZoom();
    }
    zoomTo(z, cx, cy) {
      if (!this.doc) return;
      if (cx == null) { cx = this.vw / 2; cy = this.vh / 2; }
      const ix = (cx - this.view.x) / this.view.zoom, iy = (cy - this.view.y) / this.view.zoom;
      this.view.zoom = z;
      this.view.x = cx - ix * z;
      this.view.y = cy - iy * z;
      this.clampView();
      this.afterZoom();
    }
    zoomStep(dir, cx, cy) {
      const z = this.view.zoom;
      const next = dir > 0 ? ZOOMS.find(v => v > z * 1.001) : [...ZOOMS].reverse().find(v => v < z / 1.001);
      if (next) this.zoomTo(next, cx, cy);
    }
    afterZoom() {
      this.renderStatus();
      if (this.tools.text.editing) this.tools.text.place();
      this.updateCursor();
      this.redraw();
    }
    // Keeps at least a part of the image in sight.
    clampView() {
      if (!this.doc) return;
      const w = this.doc.width * this.view.zoom, h = this.doc.height * this.view.zoom;
      const m = 60;
      this.view.x = clamp(this.view.x, m - w, this.vw - m);
      this.view.y = clamp(this.view.y, m - h, this.vh - m);
      if (this.tools.text.editing) this.tools.text.place();
    }

    redraw() {
      if (this.rafPending || this.dead) return;
      this.rafPending = true;
      requestAnimationFrame(() => { this.rafPending = false; if (!this.dead) this.draw(); });
    }

    // Which canvas stands for a layer right now: the layer's own, or one
    // with the stroke, move or adjustment that is in progress.
    layerView(l) {
      if (this.float && this.float.layerId === l.id) return this.tools.floatCanvas();
      if (this.paint && this.doc.active === l.id) return this.paintPreview(l);
      if (this.adjust && this.adjust.layerId === l.id) return this.adjust.canvas;
      return null;
    }

    draw() {
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const d = this.doc;
      if (!d) return;
      if (!this.comp || this.comp.width !== d.width || this.comp.height !== d.height) { this.comp = D.canvas(d.width, d.height); this.compDirty = true; }
      if (this.compDirty || this.paint || this.float || this.adjust) {
        d.composite(this.comp.getContext('2d'), l => this.layerView(l));
        this.compDirty = false;
      }
      const { zoom, x, y } = this.view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = d.width * zoom, h = d.height * zoom;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.fillStyle = this.checker(ctx);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.imageSmoothingEnabled = zoom < 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.comp, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
      if (zoom >= 12) this.drawPixelGrid(ctx);
      if (d.sel && !(this.float && this.float.hideSel)) this.drawAnts(ctx, d.sel);
      const tl = this.tool();
      if (tl.overlay) tl.overlay(ctx);
      if (this.drag && this.drag.tool !== tl && this.drag.tool.overlay) this.drag.tool.overlay(ctx);
      if (tl.brushCursor && this.pointer && !this.spaceDown && !this.panning) {
        const s = this.toScreen(this.pointer);
        const r = tl.brushCursor() * zoom / 2;
        if (r > 3) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,.8)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.9)';
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }
    }
    checker(ctx) {
      if (!this.checkerPattern) {
        const c = D.canvas(16, 16);
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
        g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
        this.checkerPattern = ctx.createPattern(c, 'repeat');
      }
      return this.checkerPattern;
    }
    drawPixelGrid(ctx) {
      const { zoom, x, y } = this.view;
      const d = this.doc;
      const x0 = Math.max(0, Math.floor(-x / zoom)), x1 = Math.min(d.width, Math.ceil((this.vw - x) / zoom));
      const y0 = Math.max(0, Math.floor(-y / zoom)), y1 = Math.min(d.height, Math.ceil((this.vh - y) / zoom));
      ctx.beginPath();
      for (let i = x0; i <= x1; i++) { const sx = Math.round(x + i * zoom) + 0.5; ctx.moveTo(sx, y + y0 * zoom); ctx.lineTo(sx, y + y1 * zoom); }
      for (let j = y0; j <= y1; j++) { const sy = Math.round(y + j * zoom) + 0.5; ctx.moveTo(x + x0 * zoom, sy); ctx.lineTo(x + x1 * zoom, sy); }
      ctx.strokeStyle = 'rgba(128,128,128,.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawAnts(ctx, mask, dx, dy) {
      const path = D.outline(mask);
      const { zoom, x, y } = this.view;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (x + (dx || 0) * zoom), dpr * (y + (dy || 0) * zoom));
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = -this.ants / zoom / 2;
      ctx.stroke(path);
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = -this.ants / zoom / 2 + 4 / zoom;
      ctx.stroke(path);
      ctx.restore();
    }

    // ── Painting on the active layer ─────────────────────────────────────
    // A stroke is drawn on its own canvas and only lands on the layer when
    // it ends, with the tool's opacity and inside the selection.
    startPaint(op, alpha) {
      const d = this.doc;
      const l = d.activeLayer();
      if (!l) return null;
      if (!this.paintCanvas || this.paintCanvas.width !== d.width || this.paintCanvas.height !== d.height) {
        this.paintCanvas = D.canvas(d.width, d.height);
        this.paintTmp = D.canvas(d.width, d.height);
        this.paintMask = D.canvas(d.width, d.height);
      }
      const ctx = this.paintCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, d.width, d.height);
      this.paint = { canvas: this.paintCanvas, op, alpha };
      if (!l.visible) this.toast(t('mp_layer_hidden'));
      return ctx;
    }
    paintOnto(ctx) {
      const p = this.paint;
      let src = p.canvas;
      if (this.doc.sel) {
        const m = this.paintMask.getContext('2d');
        m.globalCompositeOperation = 'source-over';
        m.clearRect(0, 0, src.width, src.height);
        m.drawImage(src, 0, 0);
        m.globalCompositeOperation = 'destination-in';
        m.drawImage(this.doc.sel, 0, 0);
        src = this.paintMask;
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.globalCompositeOperation = p.op;
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    paintPreview(l) {
      const ctx = this.paintTmp.getContext('2d');
      ctx.clearRect(0, 0, this.paintTmp.width, this.paintTmp.height);
      ctx.drawImage(l.canvas, 0, 0);
      this.paintOnto(ctx);
      return this.paintTmp;
    }
    commitPaint() {
      if (!this.paint) return;
      const d = this.doc;
      const l = d.activeLayer();
      if (l) {
        d.checkpoint();
        this.paintOnto(d.pixels(l));
      }
      this.paint = null;
      this.changed();
    }
    cancelPaint() { this.paint = null; this.redraw(); }

    // After anything that changes the document.
    changed() {
      this.dirty = true;
      this.compDirty = true;
      this.renderLayers();
      this.renderMenubar();
      this.renderStatus();
      this.redraw();
    }

    // ── History ──────────────────────────────────────────────────────────
    busy() { return !!(this.drag || this.float || this.tools.text.editing || this.tools.crop.rect); }
    undo() {
      if (!this.doc) return;
      if (this.busy()) { this.tools.cancelAll(); return; }
      if (this.doc.undo()) this.afterHistory();
    }
    redo() {
      if (!this.doc) return;
      if (this.busy()) this.tools.cancelAll();
      if (this.doc.redo()) this.afterHistory();
    }
    afterHistory() {
      if (this.comp && (this.comp.width !== this.doc.width || this.comp.height !== this.doc.height)) this.clampView();
      this.changed();
    }

    // ── Layers ───────────────────────────────────────────────────────────
    selectLayer(id) {
      if (!this.doc || this.doc.active === id) return;
      this.tools.cancelAll();
      this.doc.active = id;
      this.renderLayers();
      this.renderMenubar();
    }
    toggleVisible(id) {
      const d = this.doc;
      d.checkpoint();
      const l = d.layer(id);
      l.visible = !l.visible;
      this.changed();
    }
    nextLayerName() {
      const used = new Set(this.doc.layers.map(l => l.name));
      let n = this.doc.layers.length;
      let name;
      do { name = t('mp_layer_n', { n: ++n }); } while (used.has(name));
      return name;
    }
    // Puts a new layer right above the active one.
    insertLayer(l) {
      const d = this.doc;
      const i = d.indexOf(d.active);
      d.layers.splice(i + 1, 0, l);
      d.active = l.id;
    }
    addLayer() {
      if (!this.doc) return;
      this.tools.cancelAll();
      this.doc.checkpoint();
      this.insertLayer(this.doc.newLayer(this.nextLayerName()));
      this.changed();
    }
    // With a selection this copies only the selected pixels, like
    // "Layer via Copy".
    duplicateLayer() {
      const d = this.doc;
      const src = d && d.activeLayer();
      if (!src) return;
      this.tools.cancelAll();
      d.checkpoint();
      const l = d.newLayer(d.sel ? this.nextLayerName() : t('mp_copy_of', { name: src.name }));
      l.canvas = d.sel ? D.masked(src.canvas, d.sel) : D.clone(src.canvas);
      if (!d.sel) { l.opacity = src.opacity; l.blend = src.blend; l.visible = src.visible; }
      this.insertLayer(l);
      this.changed();
    }
    deleteLayer() {
      const d = this.doc;
      if (!d || d.layers.length < 2) return;
      this.tools.cancelAll();
      d.checkpoint();
      const i = d.indexOf(d.active);
      d.layers.splice(i, 1);
      d.active = d.layers[Math.max(0, i - 1)].id;
      this.changed();
    }
    async renameLayer(id) {
      const d = this.doc;
      const l = d && d.layer(id || d.active);
      if (!l) return;
      const name = await this.prompt(t('mp_layer_rename'), l.name);
      if (name == null || !name.trim() || name.trim() === l.name) return;
      d.checkpoint();
      d.layer(l.id).name = name.trim().slice(0, 80);
      this.changed();
    }
    moveLayer(dir) {
      const d = this.doc;
      if (!d) return;
      const i = d.indexOf(d.active);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return;
      this.tools.cancelAll();
      d.checkpoint();
      [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      this.changed();
    }
    reorderLayer(id, targetId, above) {
      const d = this.doc;
      d.checkpoint();
      const [l] = d.layers.splice(d.indexOf(id), 1);
      const ti = d.indexOf(targetId);
      d.layers.splice(above ? ti + 1 : ti, 0, l);
      this.changed();
    }
    mergeDown() {
      const d = this.doc;
      if (!d) return;
      const i = d.indexOf(d.active);
      if (i <= 0) return;
      this.tools.cancelAll();
      d.checkpoint();
      const top = d.layers[i], below = d.layers[i - 1];
      const ctx = d.pixels(below);
      if (top.visible) {
        ctx.save();
        ctx.globalAlpha = top.opacity;
        ctx.globalCompositeOperation = top.blend;
        ctx.drawImage(top.canvas, 0, 0);
        ctx.restore();
      }
      d.layers.splice(i, 1);
      d.active = below.id;
      this.changed();
    }
    flatten() {
      const d = this.doc;
      if (!d || d.layers.length < 2) return;
      this.tools.cancelAll();
      d.checkpoint();
      const l = d.newLayer(t('mp_background_layer'));
      l.canvas = d.flattened();
      d.layers = [l];
      d.active = l.id;
      this.changed();
    }

    // ── Selection ────────────────────────────────────────────────────────
    setSelection(mask, mode) {
      const d = this.doc;
      const next = D.combine(d.sel, mask, mode || 'new');
      if (!next && !d.sel) return;
      d.checkpoint();
      d.sel = next;
      this.afterSelection();
    }
    afterSelection() {
      if (this.doc.sel) D.alphaBounds(this.doc.sel);
      this.renderMenubar();
      this.renderStatus();
      this.redraw();
    }
    selectAll() {
      if (!this.doc) return;
      const { width: w, height: h } = this.doc;
      this.setSelection(D.shapeMask(w, h, c => c.fillRect(0, 0, w, h)), 'new');
    }
    deselect() {
      if (!this.doc || !this.doc.sel) return;
      this.doc.checkpoint();
      this.doc.sel = null;
      this.afterSelection();
    }
    invertSelection() {
      const d = this.doc;
      if (!d) return;
      d.checkpoint();
      d.sel = D.invert(d.sel, d.width, d.height);
      this.afterSelection();
    }
    selectLayerPixels() {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      this.setSelection(D.masked(D.shapeMask(d.width, d.height, c => c.fillRect(0, 0, d.width, d.height)), l.canvas), 'new');
    }
    async growSelection(dir) {
      const d = this.doc;
      const v = await this.prompt(t(dir > 0 ? 'mp_select_grow_by' : 'mp_select_shrink_by'), '4');
      const n = Math.round(+v);
      if (!(n > 0) || !d.sel) return;
      // Growing is a blur pushed to full strength; shrinking grows the outside.
      const base = dir > 0 ? d.sel : D.invert(d.sel, d.width, d.height);
      if (!base) return;
      const soft = D.blur(base, n / 2);
      const bytes = new Uint8Array(d.width * d.height);
      const px = D.readPixels(soft).data;
      for (let i = 0; i < bytes.length; i++) bytes[i] = px[i * 4 + 3] > 8 ? 255 : 0;
      let m = D.maskFromBytes(bytes, d.width, d.height);
      if (dir < 0) m = D.invert(m, d.width, d.height);
      d.checkpoint();
      d.sel = m && D.alphaBounds(m) ? m : null;
      this.afterSelection();
    }
    async featherSelection() {
      const d = this.doc;
      const v = await this.prompt(t('mp_select_feather_by'), '8');
      const n = +v;
      if (!(n > 0) || !d.sel) return;
      d.checkpoint();
      d.sel = D.blur(d.sel, n);
      this.afterSelection();
    }
    fillSelection(color) {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      this.tools.cancelAll();
      const ctx = this.startPaint('source-over', 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, d.width, d.height);
      this.commitPaint();
    }
    clearSelection() {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      if (!d.sel) { this.toast(t('mp_need_selection')); return; }
      this.tools.cancelAll();
      const ctx = this.startPaint('destination-out', 1);
      ctx.fillRect(0, 0, d.width, d.height);
      this.commitPaint();
    }

    // ── Clipboard ────────────────────────────────────────────────────────
    copy(cut, merged) {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      this.tools.cancelAll();
      const src = merged ? d.flattened() : l.canvas;
      const whole = d.sel ? D.masked(src, d.sel) : src;
      const b = D.alphaBounds(d.sel || D.shapeMask(d.width, d.height, c => c.fillRect(0, 0, d.width, d.height)));
      if (!b) return;
      const part = D.crop(whole, b);
      this.clip = { canvas: part, x: b.x, y: b.y };
      if (navigator.clipboard && window.ClipboardItem) {
        D.canvasBlob(part, 'image/png').then(blob => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]))
          .then(() => { this.clip.system = true; }).catch(() => {});
      }
      if (cut && !merged) {
        if (d.sel) this.clearSelection();
        else { d.checkpoint(); d.pixels(l).clearRect(0, 0, d.width, d.height); this.changed(); }
      }
      this.toast(t(cut ? 'mp_cut_done' : 'mp_copied'));
    }
    onPaste(e) {
      if (e.target.closest && e.target.closest('input, textarea, .mp-modal')) return;
      const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
      e.preventDefault();
      if (files.length) {
        D.loadImage(files[0]).then(img => {
          // The same pixels as our own copy: paste them where they came from.
          if (this.clip && this.clip.system && img.naturalWidth === this.clip.canvas.width && img.naturalHeight === this.clip.canvas.height) this.pasteClip();
          else this.pasteImage(img, t('mp_pasted'));
        }).catch(() => this.toast(t('mp_open_failed'), 'bad'));
        return;
      }
      if (this.clip) this.pasteClip();
    }
    async pasteFromMenu() {
      if (navigator.clipboard && navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          for (const it of items) {
            const type = it.types.find(x => x.startsWith('image/'));
            if (!type) continue;
            const img = await D.loadImage(await it.getType(type));
            if (this.clip && this.clip.system && img.naturalWidth === this.clip.canvas.width && img.naturalHeight === this.clip.canvas.height) this.pasteClip();
            else this.pasteImage(img, t('mp_pasted'));
            return;
          }
        } catch (err) { /* not allowed: use our own copy */ }
      }
      if (this.clip) this.pasteClip();
      else this.toast(t('mp_clipboard_empty'));
    }
    pasteClip() {
      if (!this.doc) { this.pasteImage(this.clip.canvas, t('mp_pasted')); return; }
      const d = this.doc;
      this.tools.cancelAll();
      d.checkpoint();
      const l = d.newLayer(t('mp_pasted'));
      const fits = this.clip.x + this.clip.canvas.width <= d.width && this.clip.y + this.clip.canvas.height <= d.height;
      const x = fits ? this.clip.x : Math.round((d.width - this.clip.canvas.width) / 2);
      const y = fits ? this.clip.y : Math.round((d.height - this.clip.canvas.height) / 2);
      l.canvas.getContext('2d').drawImage(this.clip.canvas, x, y);
      this.insertLayer(l);
      d.sel = null;
      this.changed();
      this.setTool('move');
    }
    // An image as a new layer, in the middle; with no document it becomes one.
    pasteImage(img, name) {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!this.doc) {
        if (!D.sizeOk(w, h)) { this.toast(t('mp_too_large'), 'bad'); return; }
        this.setDoc(D.fromImage(img, t('mp_background_layer')), name, null, null);
        this.dirty = true;
        return;
      }
      const d = this.doc;
      this.tools.cancelAll();
      d.checkpoint();
      const l = d.newLayer(name);
      let s = 1;
      if (w > d.width || h > d.height) s = Math.min(d.width / w, d.height / h);
      const ctx = l.canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
      if (s < 1) ctx.drawImage(D.resample(img instanceof HTMLCanvasElement ? img : D.fromImage(img, '').layers[0].canvas, dw, dh), Math.round((d.width - dw) / 2), Math.round((d.height - dh) / 2));
      else ctx.drawImage(img, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2));
      this.insertLayer(l);
      this.changed();
      if (s < 1) this.toast(t('mp_placed_scaled'));
    }

    // ── Image operations ─────────────────────────────────────────────────
    rotateImage(deg) {
      const d = this.doc;
      if (!d) return;
      this.tools.cancelAll();
      const swap = deg === 90 || deg === 270;
      d.transformAll(c => D.rotate(c, deg), swap ? d.height : d.width, swap ? d.width : d.height, true);
      this.afterResize();
    }
    flipImage(h) {
      const d = this.doc;
      if (!d) return;
      this.tools.cancelAll();
      d.transformAll(c => D.flip(c, h), d.width, d.height, true);
      this.afterResize();
    }
    cropTo(r) {
      const d = this.doc;
      r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      if (r.w < 1 || r.h < 1) return;
      d.transformAll(c => D.crop(c, r), r.w, r.h, false);
      this.afterResize();
    }
    cropToSelection() {
      const d = this.doc;
      if (!d || !d.sel) return;
      this.tools.cancelAll();
      this.cropTo(D.alphaBounds(d.sel));
    }
    trimTransparent() {
      const d = this.doc;
      if (!d) return;
      const b = D.alphaBounds(d.flattened());
      if (!b) { this.toast(t('mp_nothing_to_trim')); return; }
      if (b.w === d.width && b.h === d.height) { this.toast(t('mp_nothing_to_trim')); return; }
      this.tools.cancelAll();
      this.cropTo(b);
    }
    afterResize() {
      this.zoomFit();
      this.changed();
    }
    imageSizeDialog() {
      const d = this.doc;
      if (!d) return;
      this.tools.cancelAll();
      const box = this.modal(t('mp_image_size'), `
        <div class="mp-form">
          <label>${esc(t('mp_width'))}<input type="number" class="mp-input" data-f="w" min="1" max="${D.MAX_SIDE}" value="${d.width}"> px</label>
          <label>${esc(t('mp_height'))}<input type="number" class="mp-input" data-f="h" min="1" max="${D.MAX_SIDE}" value="${d.height}"> px</label>
          <label>${esc(t('mp_percent'))}<input type="number" class="mp-input" data-f="p" min="1" max="1000" value="100"> %</label>
          <label class="mp-check"><input type="checkbox" data-f="lock" checked> ${esc(t('mp_keep_ratio'))}</label>
        </div>`, [
        { label: t('mp_cancel') },
        { label: t('mp_ok'), primary: true, onClick: b => {
          const w = Math.round(+b.querySelector('[data-f="w"]').value), h = Math.round(+b.querySelector('[data-f="h"]').value);
          if (!D.sizeOk(w, h)) { this.toast(t('mp_bad_size'), 'bad'); return false; }
          if (w === d.width && h === d.height) return;
          d.transformAll(c => D.resample(c, w, h), w, h, true);
          this.afterResize();
        } },
      ]);
      const W = box.querySelector('[data-f="w"]'), H = box.querySelector('[data-f="h"]'), P = box.querySelector('[data-f="p"]'), lock = box.querySelector('[data-f="lock"]');
      const ratio = d.width / d.height;
      W.oninput = () => { if (lock.checked) H.value = Math.max(1, Math.round(W.value / ratio)); P.value = Math.round(W.value / d.width * 1000) / 10; };
      H.oninput = () => { if (lock.checked) { W.value = Math.max(1, Math.round(H.value * ratio)); P.value = Math.round(W.value / d.width * 1000) / 10; } };
      P.oninput = () => { W.value = Math.max(1, Math.round(d.width * P.value / 100)); H.value = Math.max(1, Math.round(d.height * P.value / 100)); };
    }
    canvasSizeDialog() {
      const d = this.doc;
      if (!d) return;
      this.tools.cancelAll();
      let anchor = 4;
      const box = this.modal(t('mp_canvas_size'), `
        <div class="mp-form">
          <label>${esc(t('mp_width'))}<input type="number" class="mp-input" data-f="w" min="1" max="${D.MAX_SIDE}" value="${d.width}"> px</label>
          <label>${esc(t('mp_height'))}<input type="number" class="mp-input" data-f="h" min="1" max="${D.MAX_SIDE}" value="${d.height}"> px</label>
          <div class="mp-form-row"><span>${esc(t('mp_anchor'))}</span><div class="mp-anchor">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `<button class="mp-anchor-btn${i === 4 ? ' mp-on' : ''}" data-a="${i}"></button>`).join('')}</div></div>
          <p class="mp-dim">${esc(t('mp_canvas_size_hint'))}</p>
        </div>`, [
        { label: t('mp_cancel') },
        { label: t('mp_ok'), primary: true, onClick: b => {
          const w = Math.round(+b.querySelector('[data-f="w"]').value), h = Math.round(+b.querySelector('[data-f="h"]').value);
          if (!D.sizeOk(w, h)) { this.toast(t('mp_bad_size'), 'bad'); return false; }
          if (w === d.width && h === d.height) return;
          const dx = Math.round((w - d.width) * (anchor % 3) / 2), dy = Math.round((h - d.height) * Math.floor(anchor / 3) / 2);
          d.transformAll(c => D.offset(c, w, h, dx, dy), w, h, true);
          this.afterResize();
        } },
      ]);
      box.querySelector('.mp-anchor').onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        anchor = +b.dataset.a;
        box.querySelectorAll('.mp-anchor-btn').forEach(x => x.classList.toggle('mp-on', x === b));
      };
    }

    // ── Adjustments ──────────────────────────────────────────────────────
    // Applies to the active layer, inside the selection if there is one.
    adjustNow(fn) {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      this.tools.cancelAll();
      d.checkpoint();
      l.canvas = D.applyMasked(l.canvas, fn(l.canvas), d.sel);
      this.changed();
    }
    adjustDialog(kind) {
      const d = this.doc;
      const l = d && d.activeLayer();
      if (!l) return;
      this.tools.cancelAll();
      const defs = {
        bc: { title: 'mp_brightness_contrast', fields: [['brightness', -100, 100, 0], ['contrast', -100, 100, 0]], fn: (c, v) => D.brightnessContrast(c, v.brightness, v.contrast) },
        hs: { title: 'mp_hue_saturation', fields: [['hue', -180, 180, 0], ['saturation', -100, 100, 0], ['lightness', -100, 100, 0]], fn: (c, v) => D.hueSaturation(c, v.hue, v.saturation, v.lightness) },
        blur: { title: 'mp_blur', fields: [['radius', 0, 100, 4]], fn: (c, v) => D.blur(c, v.radius) },
        sharpen: { title: 'mp_sharpen', fields: [['amount', 0, 300, 80]], fn: (c, v) => D.sharpen(c, v.amount) },
      };
      const def = defs[kind];
      const vals = {};
      def.fields.forEach(([k, , , v0]) => { vals[k] = v0; });
      const orig = l.canvas;
      let timer = 0;
      const preview = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!this.adjust) return;
          this.adjust.canvas = D.applyMasked(orig, def.fn(orig, vals), d.sel);
          this.compDirty = true;
          this.redraw();
        }, orig.width * orig.height > 4e6 ? 120 : 30);
      };
      this.adjust = { layerId: l.id, canvas: orig };
      const close = () => { clearTimeout(timer); this.adjust = null; this.compDirty = true; this.redraw(); };
      const box = this.modal(t(def.title), `<div class="mp-form">${def.fields.map(([k, min, max, v0]) => `
          <label class="mp-slider">${esc(t('mp_adj_' + k))}
            <input type="range" data-f="${k}" min="${min}" max="${max}" value="${v0}">
            <input type="number" class="mp-num" data-n="${k}" min="${min}" max="${max}" value="${v0}"></label>`).join('')}
        </div>`, [
        { label: t('mp_cancel'), onClick: close },
        { label: t('mp_ok'), primary: true, onClick: () => {
          clearTimeout(timer);
          const out = D.applyMasked(orig, def.fn(orig, vals), d.sel);
          this.adjust = null;
          d.checkpoint();
          d.layer(l.id).canvas = out;
          this.changed();
        } },
      ], null, 'mp-modal-side');
      box.oninput = e => {
        const k = e.target.dataset.f || e.target.dataset.n;
        if (!k) return;
        const f = def.fields.find(x => x[0] === k);
        const v = clamp(+e.target.value || 0, f[1], f[2]);
        vals[k] = v;
        box.querySelectorAll(`[data-f="${k}"], [data-n="${k}"]`).forEach(x => { if (x !== e.target) x.value = v; });
        preview();
      };
      if (kind === 'blur' || kind === 'sharpen') preview();
    }

    // ── Free transform ───────────────────────────────────────────────────
    freeTransform() {
      if (!this.doc) return;
      this.setTool('move');
      this.tools.move.startTransform();
    }

    // ── Keyboard ─────────────────────────────────────────────────────────
    onKey(e) {
      if (this.dead) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (this.modalOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === ' ' && !mod) { if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); } done(); return; }
      if (e.key === 'Escape') { this.closeMenu(); this.tools.cancelAll(); done(); return; }
      if (e.key === 'Enter') { const tl = this.tool(); if (tl.enter && tl.enter()) done(); return; }
      if (mod) {
        const act = {
          n: () => (e.shiftKey ? this.addLayer() : this.newDialog()),
          o: () => this.openFromServer(),
          s: () => (e.shiftKey ? this.saveAs() : this.save()),
          e: () => (e.shiftKey ? this.exportDialog() : this.mergeDown()),
          z: () => (e.shiftKey ? this.redo() : this.undo()),
          y: () => this.redo(),
          a: () => this.selectAll(),
          d: () => this.deselect(),
          i: () => (e.altKey ? this.imageSizeDialog() : e.shiftKey ? this.invertSelection() : this.adjustNow(D.invertColors)),
          c: () => (e.altKey ? this.canvasSizeDialog() : this.copy(false, e.shiftKey)),
          x: () => this.copy(true),
          t: () => this.freeTransform(),
          j: () => this.duplicateLayer(),
          u: () => (e.shiftKey ? this.adjustNow(D.grayscale) : this.adjustDialog('hs')),
          ']': () => this.moveLayer(1),
          '[': () => this.moveLayer(-1),
          0: () => this.zoomFit(),
          1: () => this.zoomTo(1),
          '=': () => this.zoomStep(1),
          '+': () => this.zoomStep(1),
          '-': () => this.zoomStep(-1),
          backspace: () => this.fillSelection(this.bg),
        }[k];
        // Ctrl+V is left to the browser, which then sends the paste event.
        if (act && (this.doc || 'no'.includes(k))) { done(); act(); }
        return;
      }
      if (!this.doc) return;
      if (e.key === 'Backspace' && e.altKey) { done(); this.fillSelection(this.fg); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { done(); this.clearSelection(); return; }
      if (e.key.startsWith('Arrow') && this.toolId === 'move') {
        const s = e.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
        done();
        this.tools.move.nudge(dx, dy);
        return;
      }
      if (e.altKey) return;
      if (k === 'x') { done(); this.swapColors(); return; }
      if (k === 'd') { done(); this.defaultColors(); return; }
      if (k === '[' || k === ']') {
        const tl = this.tool();
        const o = this.options[tl.group || tl.id];
        if (o && o.size != null) {
          done();
          const s = o.size;
          const step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : 25;
          o.size = clamp(k === ']' ? s + step : s - step, 1, tl.id === 'pencil' ? 100 : 500);
          this.saveOptions();
          this.renderOptions();
          this.redraw();
        }
        return;
      }
      // A tool's letter; pressed again it moves to the next tool with the same one.
      const same = this.tools.list.filter(x => x.key === k);
      if (same.length) {
        done();
        const i = same.findIndex(x => x.id === this.toolId);
        this.setTool(same[(i + 1) % same.length].id);
      }
    }

    // ── Documents ────────────────────────────────────────────────────────
    setDoc(doc, name, source, origin) {
      this.tools.cancelAll();
      this.doc = doc;
      this.name = name || '';
      this.source = source;
      this.origin = origin;
      this.dirty = false;
      this.comp = null;
      this.paintCanvas = null;
      this.compDirty = true;
      doc.onChange = () => { this.dirty = true; };
      this.zoomFit();
      this.render();
      this.root.focus({ preventScroll: true });
    }
    async leave() {
      if (!this.doc || !this.dirty) return true;
      return this.confirm(t('mp_leave_unsaved'), t('mp_discard'));
    }
    async newDialog() {
      if (!(await this.leave())) return;
      const box = this.modal(t('mp_new'), `
        <div class="mp-form">
          <label>${esc(t('mp_preset'))}<select class="mp-input" data-f="preset">
            <option value="">${esc(t('mp_custom'))}</option>
            ${NEW_PRESETS.map(([w, h]) => `<option value="${w}x${h}" ${w === 1920 && h === 1080 ? 'selected' : ''}>${w} × ${h}</option>`).join('')}
            ${this.clip ? `<option value="clip">${esc(t('mp_clipboard_size'))} (${this.clip.canvas.width} × ${this.clip.canvas.height})</option>` : ''}
          </select></label>
          <label>${esc(t('mp_width'))}<input type="number" class="mp-input" data-f="w" min="1" max="${D.MAX_SIDE}" value="1920"> px</label>
          <label>${esc(t('mp_height'))}<input type="number" class="mp-input" data-f="h" min="1" max="${D.MAX_SIDE}" value="1080"> px</label>
          <label>${esc(t('mp_fill'))}<select class="mp-input" data-f="bg">
            <option value="white">${esc(t('mp_fill_white'))}</option>
            <option value="transparent">${esc(t('mp_fill_transparent'))}</option>
            <option value="color">${esc(t('mp_fill_bgcolor'))}</option>
          </select></label>
        </div>`, [
        { label: t('mp_cancel') },
        { label: t('mp_create'), primary: true, onClick: b => {
          const w = Math.round(+b.querySelector('[data-f="w"]').value), h = Math.round(+b.querySelector('[data-f="h"]').value);
          if (!D.sizeOk(w, h)) { this.toast(t('mp_bad_size'), 'bad'); return false; }
          const bg = b.querySelector('[data-f="bg"]').value;
          const fill = bg === 'white' ? '#ffffff' : bg === 'color' ? this.bg : null;
          this.setDoc(D.blank(w, h, fill, t('mp_background_layer')), t('mp_untitled'), null, null);
        } },
      ]);
      const W = box.querySelector('[data-f="w"]'), H = box.querySelector('[data-f="h"]'), P = box.querySelector('[data-f="preset"]');
      P.onchange = () => {
        if (P.value === 'clip') { W.value = this.clip.canvas.width; H.value = this.clip.canvas.height; }
        else if (P.value) { const [w, h] = P.value.split('x'); W.value = w; H.value = h; }
      };
      W.oninput = H.oninput = () => { P.value = ''; };
    }
    async openFromServer() {
      if (!(await this.leave())) return;
      const path = await this.fileBrowser({ title: t('mp_open_server'), places: await this.places(), exts: [...IMAGE_EXTS, EXT] });
      if (path) this.openServerFile(path, true);
    }
    openFromComputer() {
      this.pickLocal(`image/*,.${EXT}`, files => this.openLocalFiles(files, true));
    }
    pickLocal(accept, fn) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = true;
      input.onchange = () => { if (input.files.length) fn([...input.files]); };
      input.click();
    }
    // Called from File Manager or at start.
    openPath(path) { this.openServerFile(path, false); }
    async openServerFile(path, confirmed) {
      if (!confirmed && !(await this.leave())) return;
      const name = path.split('/').pop();
      const dir = path.slice(0, path.length - name.length).replace(/\/+$/, '') || '/';
      try {
        const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
        if (!r.ok) throw new Error('load');
        const blob = await r.blob();
        if (extOf(name) === EXT) {
          const doc = await D.parse(await blob.text());
          this.setDoc(doc, name.replace(/\.mvmphoto$/i, ''), { kind: 'server', path }, { dir, name: name.replace(/\.mvmphoto$/i, '') });
        } else {
          const img = await D.loadImage(blob);
          const w = img.naturalWidth, h = img.naturalHeight;
          if (!D.sizeOk(w, h)) { this.toast(t('mp_too_large'), 'bad'); return; }
          const base = name.replace(/\.[^.]+$/, '');
          this.setDoc(D.fromImage(img, t('mp_background_layer')), base, null, { dir, name: base, ext: extOf(name) });
        }
      } catch (e) {
        this.toast(t(e.message === 'not_project' ? 'mp_not_project' : 'mp_open_failed'), 'bad');
      }
    }
    // Local files: the first opens as the document when there is none (or
    // when asked), the others become layers.
    async openLocalFiles(files, replace) {
      files = files.filter(f => f.type.startsWith('image/') || IMAGE_EXTS.includes(extOf(f.name)) || extOf(f.name) === EXT);
      if (!files.length) { this.toast(t('mp_unsupported'), 'bad'); return; }
      const project = files.find(f => extOf(f.name) === EXT);
      if (project) {
        if (!replace && !(await this.leave())) return;
        try {
          this.setDoc(await D.parse(await project.text()), project.name.replace(/\.mvmphoto$/i, ''), null, null);
        } catch (e) { this.toast(t(e.message === 'not_project' ? 'mp_not_project' : 'mp_open_failed'), 'bad'); }
        return;
      }
      let first = true;
      for (const f of files) {
        let img;
        try { img = await D.loadImage(f); } catch (e) { this.toast(t('mp_open_failed_name', { name: f.name }), 'bad'); continue; }
        const base = f.name.replace(/\.[^.]+$/, '');
        if (first && (replace || !this.doc)) {
          if (!D.sizeOk(img.naturalWidth, img.naturalHeight)) { this.toast(t('mp_too_large'), 'bad'); return; }
          this.setDoc(D.fromImage(img, t('mp_background_layer')), base, null, { dir: null, name: base, ext: extOf(f.name) });
        } else {
          this.pasteImage(img, base);
        }
        first = false;
      }
    }
    async placeFromServer() {
      if (!this.doc) return;
      const path = await this.fileBrowser({ title: t('mp_place_server'), places: await this.places(), exts: IMAGE_EXTS });
      if (!path) return;
      try {
        const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
        if (!r.ok) throw new Error('load');
        this.pasteImage(await D.loadImage(await r.blob()), path.split('/').pop().replace(/\.[^.]+$/, ''));
      } catch (e) { this.toast(t('mp_open_failed'), 'bad'); }
    }
    placeFromComputer() {
      if (this.doc) this.pickLocal('image/*', files => this.openLocalFiles(files, false));
    }

    fileBase() { return (this.name || t('mp_untitled')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'image'; }

    async save() {
      if (!this.doc) return;
      this.tools.cancelAll();
      if (this.source && this.source.kind === 'server') return this.writeProject(this.source.path);
      return this.saveAs();
    }
    async saveAs() {
      if (!this.doc) return;
      this.tools.cancelAll();
      const where = this.opts.desktop ? await this.choice(t('mp_save_as'), [
        { id: 'server', label: '📂 ' + t('mp_to_server') },
        { id: 'computer', label: '💻 ' + t('mp_to_computer') },
      ]) : 'computer';
      if (!where) return;
      if (where === 'computer') {
        const blob = new Blob([await D.serialize(this.doc)], { type: 'application/json' });
        this.download(blob, this.fileBase() + '.' + EXT);
        this.dirty = false;
        this.renderMenubar();
        return;
      }
      const target = await this.askServerTarget(t('mp_save_to_folder'), this.origin && this.origin.dir, this.fileBase() + '.' + EXT, EXT);
      if (target) this.writeProject(target.dir.replace(/\/+$/, '') + '/' + target.name);
    }
    async writeProject(path) {
      const name = path.split('/').pop();
      const dir = path.slice(0, path.length - name.length).replace(/\/+$/, '') || '/';
      try {
        const blob = new Blob([await D.serialize(this.doc)], { type: 'application/json' });
        await this.uploadTo(dir, name, blob);
        this.source = { kind: 'server', path };
        this.origin = { dir, name: name.replace(/\.mvmphoto$/i, '') };
        this.name = this.origin.name;
        this.dirty = false;
        this.renderMenubar();
        this.toast(t('mp_saved'), 'good');
      } catch (e) {
        this.toast(t('mp_save_failed'), 'bad');
      }
    }

    exportDialog() {
      const d = this.doc;
      if (!d) return;
      this.tools.cancelAll();
      const fmt0 = this.origin && ['jpg', 'jpeg'].includes(this.origin.ext) ? 'jpeg' : this.origin && this.origin.ext === 'webp' ? 'webp' : 'png';
      const box = this.modal(t('mp_export'), `
        <div class="mp-form">
          <label>${esc(t('mp_file_name'))}<input type="text" class="mp-input" data-f="name" value="${esc(this.fileBase())}"></label>
          <label>${esc(t('mp_format'))}<select class="mp-input" data-f="fmt">
            <option value="png" ${fmt0 === 'png' ? 'selected' : ''}>PNG — ${esc(t('mp_format_png'))}</option>
            <option value="jpeg" ${fmt0 === 'jpeg' ? 'selected' : ''}>JPEG — ${esc(t('mp_format_jpeg'))}</option>
            <option value="webp" ${fmt0 === 'webp' ? 'selected' : ''}>WebP — ${esc(t('mp_format_webp'))}</option>
          </select></label>
          <label class="mp-slider" data-q>${esc(t('mp_quality'))}<input type="range" data-f="q" min="1" max="100" value="92"><input type="number" class="mp-num" data-f="qn" min="1" max="100" value="92"></label>
          <p class="mp-dim" data-jpeg-note>${esc(t('mp_jpeg_note'))}</p>
          ${this.opts.desktop ? `<label>${esc(t('mp_destination'))}<select class="mp-input" data-f="dest">
            <option value="server">📂 ${esc(t('mp_to_server'))}</option>
            <option value="computer">💻 ${esc(t('mp_to_computer'))}</option>
          </select></label>` : ''}
          <p class="mp-dim">${d.width} × ${d.height} px</p>
        </div>`, [
        { label: t('mp_cancel') },
        { label: t('mp_export_btn'), primary: true, onClick: b => {
          const name = b.querySelector('[data-f="name"]').value.trim().replace(/[\\/]+/g, ' ') || this.fileBase();
          const fmt = b.querySelector('[data-f="fmt"]').value;
          const q = clamp(+b.querySelector('[data-f="q"]').value || 92, 1, 100) / 100;
          const dest = this.opts.desktop ? b.querySelector('[data-f="dest"]').value : 'computer';
          this.runExport(name, fmt, q, dest);
        } },
      ]);
      const F = box.querySelector('[data-f="fmt"]'), Q = box.querySelector('[data-f="q"]'), QN = box.querySelector('[data-f="qn"]');
      const sync = () => {
        box.querySelector('[data-q]').hidden = F.value === 'png';
        box.querySelector('[data-jpeg-note]').hidden = F.value !== 'jpeg';
      };
      F.onchange = sync;
      Q.oninput = () => { QN.value = Q.value; };
      QN.oninput = () => { Q.value = QN.value; };
      sync();
    }
    async runExport(name, fmt, quality, dest) {
      const d = this.doc;
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      let file = name;
      if (extOf(file) !== ext && !(ext === 'jpg' && extOf(file) === 'jpeg')) file += '.' + ext;
      let blob;
      try {
        const img = d.flattened(fmt === 'jpeg' ? '#ffffff' : null);
        blob = await D.canvasBlob(img, 'image/' + fmt, fmt === 'png' ? undefined : quality);
        if (blob.type !== 'image/' + fmt) throw new Error('format');
      } catch (e) {
        this.toast(t(e.message === 'format' ? 'mp_format_unsupported' : 'mp_export_failed'), 'bad');
        return;
      }
      if (dest === 'computer') { this.download(blob, file); return; }
      const places = await this.places();
      const dir = await this.pickFolder(t('mp_export_to_folder'), (this.origin && this.origin.dir) || places.home || '/');
      if (!dir) return;
      if (await this.exists(dir, file) && !(await this.confirm(t('mp_overwrite_confirm', { name: file }), t('mp_replace')))) return;
      try {
        await this.uploadTo(dir, file, blob);
        this.toast(t('mp_exported', { path: dir.replace(/\/+$/, '') + '/' + file }), 'good');
      } catch (e) {
        this.toast(t('mp_upload_failed'), 'bad');
        this.download(blob, file);
      }
    }

    destroy() {
      this.dead = true;
      clearInterval(this.antsTimer);
      this.closeMenu();
      this.ro.disconnect();
      this.tools.cancelAll();
    }
  }
  Object.assign(Editor.prototype, UI);

  const STYLE = `
.mp-root{position:relative;display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);font-size:13px;outline:none;user-select:none;overflow:hidden}
.mp-root button{font:inherit;color:inherit}
.mp-root [hidden]{display:none!important}
.mp-dim{color:var(--text-dim)}
.mp-menubar{display:flex;align-items:center;gap:2px;padding:3px 6px;border-bottom:1px solid var(--border);background:var(--surface)}
.mp-menubtn{background:none;border:none;padding:5px 10px;border-radius:5px;cursor:pointer}
.mp-menubtn:hover,.mp-menubtn.mp-on{background:var(--surface2)}
.mp-docname{margin-left:auto;padding-right:6px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mp-options{display:flex;align-items:center;gap:14px;padding:5px 10px;min-height:38px;box-sizing:border-box;border-bottom:1px solid var(--border);background:var(--surface);flex-wrap:wrap}
.mp-opt-title{font-weight:600;white-space:nowrap}
.mp-opt{display:flex;align-items:center;gap:6px;white-space:nowrap}
.mp-opt input[type=range]{width:110px}
.mp-opt-hint{white-space:normal}
.mp-num{width:54px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:3px 5px;font:inherit}
.mp-seg{display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
.mp-seg-btn{background:var(--bg);border:none;border-right:1px solid var(--border);padding:4px 9px;cursor:pointer;min-width:30px}
.mp-seg-btn:last-child{border-right:none}
.mp-seg-btn.mp-on{background:var(--accent);color:#fff}
.mp-root select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:3px 5px;font:inherit}
.mp-main{flex:1;display:flex;min-height:0}
.mp-tools{width:46px;flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;border-right:1px solid var(--border);background:var(--surface);overflow-y:auto}
.mp-tool{width:36px;height:34px;flex:none;border:none;background:none;border-radius:6px;cursor:pointer;font-size:17px;line-height:1}
.mp-tool:hover{background:var(--surface2)}
.mp-tool.mp-on{background:color-mix(in srgb,var(--accent) 30%,transparent);box-shadow:inset 0 0 0 1px var(--accent)}
.mp-swatch-pair{position:relative;width:40px;height:46px;margin-top:8px;flex:none}
.mp-sw{position:absolute;width:24px;height:24px;border:2px solid var(--surface);outline:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0}
.mp-sw-fg{left:2px;top:2px;z-index:1}
.mp-sw-bg{left:14px;top:14px}
.mp-sw-swap,.mp-sw-reset{position:absolute;background:none;border:none;cursor:pointer;font-size:11px;padding:0;line-height:1}
.mp-sw-swap{right:-2px;top:0}
.mp-sw-reset{left:0;bottom:-2px}
.mp-view{position:relative;flex:1;min-width:0;overflow:hidden;background:color-mix(in srgb,var(--bg) 70%,#808080);touch-action:none}
.mp-view.mp-dropping{box-shadow:inset 0 0 0 3px var(--accent)}
.mp-canvas{position:absolute;left:0;top:0;display:block}
.mp-welcome{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg)}
.mp-welcome-box{text-align:center;max-width:460px;padding:20px}
.mp-welcome-icon{font-size:52px}
.mp-welcome-box h2{margin:6px 0}
.mp-welcome-btns{display:flex;flex-direction:column;gap:8px;margin-top:16px;align-items:stretch}
.mp-side{width:250px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--border);background:var(--surface);min-height:0}
.mp-panel{padding:8px 10px;border-bottom:1px solid var(--border)}
.mp-layers-panel{flex:1;display:flex;flex-direction:column;min-height:0}
.mp-panel-head{font-weight:600;margin-bottom:8px}
.mp-color-row{display:flex;align-items:center;gap:8px}
.mp-color-big{width:40px;height:32px;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:0}
.mp-color-small{width:22px;height:22px;border:1px solid var(--border);border-radius:5px;cursor:pointer;padding:0}
.mp-hex{flex:1;min-width:0;font-family:monospace}
.mp-swatches{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:8px}
.mp-swatch{aspect-ratio:1;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0}
.mp-recent-label{margin-top:8px;font-size:11px}
.mp-color-input{position:absolute;left:-40px;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.mp-blend{width:100%}
.mp-opacity{display:flex;align-items:center;gap:6px;margin:6px 0;white-space:nowrap}
.mp-opacity-label{max-width:40%;overflow:hidden;text-overflow:ellipsis}
.mp-opacity .mp-num{width:46px}
.mp-layer-op-range{flex:1;min-width:40px}
.mp-layer-list{flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:6px;min-height:80px}
.mp-layer{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent);cursor:pointer}
.mp-layer:hover{background:var(--surface2)}
.mp-layer.mp-on{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.mp-layer.mp-drop-above{box-shadow:inset 0 2px 0 var(--accent)}
.mp-layer.mp-drop-below{box-shadow:inset 0 -2px 0 var(--accent)}
.mp-eye{width:24px;border:none;background:none;cursor:pointer;padding:0;font-size:13px}
.mp-thumb{flex:none;border:1px solid var(--border);border-radius:3px;background:repeating-conic-gradient(#d0d0d0 0 25%,#fff 0 50%) 0 0/8px 8px}
.mp-layer-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-layer-meta{font-size:11px}
.mp-layer-btns{display:flex;gap:4px;margin-top:8px;justify-content:space-between}
.mp-layer-btns .mp-btn{flex:1;padding:4px 0}
.mp-status{display:flex;align-items:center;gap:16px;padding:3px 10px;border-top:1px solid var(--border);background:var(--surface);font-size:12px;min-height:28px;box-sizing:border-box;white-space:nowrap;overflow:hidden}
.mp-zoom-ctl{display:flex;align-items:center;gap:3px}
.mp-zoom-ctl .mp-num{width:52px;padding:1px 4px;text-align:right}
.mp-mini{background:var(--bg);border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0 6px;min-width:22px;height:20px;line-height:1}
.mp-pos{min-width:80px;font-variant-numeric:tabular-nums}
.mp-hint{overflow:hidden;text-overflow:ellipsis}
.mp-btn{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.mp-btn:hover{border-color:var(--accent)}
.mp-btn:disabled{opacity:.5;cursor:default}
.mp-small{padding:3px 9px;font-size:12px}
.mp-primary{background:var(--accent);border-color:var(--accent);color:#fff!important}
.mp-input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font:inherit;box-sizing:border-box}
.mp-modal-body>.mp-input{width:100%}
.mp-toasts{position:absolute;right:12px;bottom:40px;display:flex;flex-direction:column;gap:6px;z-index:30;pointer-events:none}
.mp-toast{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);padding:8px 12px;border-radius:6px;box-shadow:var(--shadow);max-width:380px}
.mp-toast-good{border-left-color:#40c057}
.mp-toast-bad{border-left-color:#f38ba8}
.mp-modal{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:40}
.mp-modal-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,8px);box-shadow:var(--shadow);width:min(420px,92%);max-height:88%;display:flex;flex-direction:column}
.mp-modal-wide{width:min(620px,94%)}
.mp-modal:has(.mp-modal-side){background:rgba(0,0,0,.15);justify-content:flex-end;align-items:flex-start;padding:90px 270px 0 0}
.mp-modal-head{padding:12px 14px;font-weight:600;border-bottom:1px solid var(--border)}
.mp-modal-body{padding:12px 14px;overflow:auto;user-select:text}
.mp-modal-body p{margin:0 0 8px}
.mp-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--border)}
.mp-form{display:flex;flex-direction:column;gap:10px}
.mp-form label{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:8px}
.mp-form label.mp-check{display:flex}
.mp-form .mp-slider{grid-template-columns:110px 1fr 60px}
.mp-form-row{display:flex;gap:8px;align-items:center}
.mp-form-row>span{width:110px}
.mp-anchor{display:grid;grid-template-columns:repeat(3,24px);gap:3px}
.mp-anchor-btn{width:24px;height:24px;border:1px solid var(--border);background:var(--bg);border-radius:4px;cursor:pointer;padding:0}
.mp-anchor-btn.mp-on{background:var(--accent)}
.mp-choices{display:flex;flex-direction:column;gap:8px}
.mp-fb-places{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.mp-fb-path{font-size:12px;color:var(--text-dim);margin-bottom:6px;word-break:break-all}
.mp-fb-list{border:1px solid var(--border);border-radius:6px;height:min(340px,45vh);overflow:auto;user-select:none}
.mp-fb-row{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent)}
.mp-fb-row:hover{background:var(--surface2)}
.mp-fb-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-empty{padding:16px;text-align:center;color:var(--text-dim)}
.mp-bad{color:#f38ba8}
.mp-menu{position:absolute;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);padding:4px;min-width:240px}
.mp-menu-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap}
.mp-menu-item:hover{background:var(--surface2)}
.mp-menu-item.mp-off{opacity:.45;cursor:default}
.mp-menu-item.mp-off:hover{background:none}
.mp-menu-ic{width:18px;text-align:center}
.mp-menu-label{flex:1}
.mp-menu-keys{color:var(--text-dim);font-size:11px;margin-left:16px}
.mp-menu-sep{height:1px;background:var(--border);margin:4px 0}
.mp-text-edit{position:absolute;z-index:5;background:transparent;border:1px dashed var(--accent);outline:none;resize:none;overflow:hidden;white-space:pre;padding:0;margin:0;min-width:20px;line-height:1.2;user-select:text}
`;

  window.MvmPhoto = {
    mount(root, opts) {
      const ed = new Editor(root, opts);
      return { editor: ed, destroy: () => ed.destroy(), openPath: p => ed.openPath(p) };
    },
  };
})();
