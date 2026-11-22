(function () {
  'use strict';
  const M = window.MvmDesignModel,
    R = window.MvmDesignRender,
    X = window.MvmDesignExport;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const t = (k) =>
    (window.MvmDesignI18n[window.mvmOS?.lang || 'en'] ||
      window.MvmDesignI18n.en)[k] ||
    window.MvmDesignI18n.en[k] ||
    k;
  const clock = (s) =>
    `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  const inputFile = (accept, multiple = false) =>
    new Promise((resolve) => {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = accept;
      el.multiple = multiple;
      el.onchange = () => resolve([...el.files]);
      el.oncancel = () => resolve([]);
      el.click();
    });
  const dataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  const snapshot = (p) => ({
    ...p,
    pages: M.clone(p.pages),
    sequence: M.clone(p.sequence),
    captions: M.clone(p.captions),
    captionDrafts: M.clone(p.captionDrafts || []),
    captionRules: M.clone(p.captionRules || []),
    captionStyle: { ...p.captionStyle },
    captionStyles: M.clone(p.captionStyles || []),
    assets: { ...p.assets },
  });
  const icons = {
    renamePage: 'm15 4 5 5M4 16l-1 5 5-1L21 7l-5-5z',
    shareProject:
      'M8 12 17 5M8 12l9 7M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    new: 'M12 5v14M5 12h14',
    open: 'M3 7h7l2 2h9l-3 11H3zM3 7V4h7l2 3',
    openServer: 'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01',
    save: 'M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8',
    saveAs: 'M3 4h11v7H3zM3 4v16h8M17 13v8M13 17h8',
    downloadProject: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    recover: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
    undo: 'M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6',
    redo: 'm15 5 6 6-6 6M21 11H10a6 6 0 0 0-6 6',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    text: 'M4 5h16M12 5v15M8 20h8',
    image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M16 7h.01',
    rectangle: 'M3 5h18v14H3z',
    ellipse: 'M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0',
    line: 'M4 20 20 4',
    play: 'm8 4 12 8-12 8z',
    pause: 'M8 4v16M16 4v16',
    rewind: 'm11 5-8 7 8 7zM20 5v14M3 4v16',
    audio:
      'M9 18V5l11-2v12M9 8l11-2M9 18a3 3 0 1 1-3-3h3M20 15a3 3 0 1 1-3-3h3',
    zoomIn: 'M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12M14 14l7 7M7 10h6M10 7v6',
    zoomOut: 'M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12M14 14l7 7M7 10h6',
    duplicate: 'M8 8h13v13H8zM16 8V3H3v13h5',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    up: 'm5 15 7-7 7 7',
    down: 'm5 9 7 7 7-7',
    left: 'm15 5-7 7 7 7',
    right: 'm9 5 7 7-7 7',
    addPage: 'M4 3h12l4 4v14H4zM12 10v8M8 14h8',
    center: 'M12 2v20M2 12h20M6 7h12v10H6z',
    front: 'M8 8h13v13H8zM3 16V3h13',
    back: 'M3 3h13v13H3zM8 21h13V8',
    swapDimensions: 'M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4',
    previousSubtitle: 'm15 5-7 7 7 7',
    nextSubtitle: 'm9 5 7 7-7 7',
    playSubtitle: 'm8 4 12 8-12 8z',
    resetStyle: 'M4 10a8 8 0 1 1 1 8M4 3v7h7',
  };
  const buttonContent = (label) =>
    icons[label]
      ? `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[label]}"/></svg>`
      : esc(t(label));
  const btn = (action, label, extra = '') =>
    `<button type="button" class="${icons[label] ? 'md-icon' : ''}" data-action="${action}" data-label="${esc(label)}" title="${esc(t(label))}" aria-label="${esc(t(label))}" ${extra}>${buttonContent(label)}</button>`;
  function updateButton(el, label) {
    const state = `${label}:${t(label)}`;
    if (el.dataset.buttonState === state) return;
    el.dataset.buttonState = state;
    el.dataset.label = label;
    el.innerHTML = buttonContent(label);
    el.classList.toggle('md-icon', !!icons[label]);
    el.title = el.ariaLabel = t(label);
  }
  function field(key, label, value, type = 'number', extra = '') {
    return `<label class="md-field"><span>${esc(t(label))}</span><input data-prop="${key}" type="${type}" ${type === 'checkbox' ? (value ? 'checked' : '') : `value="${esc(value)}"`} ${extra}></label>`;
  }
  function select(key, label, value, options) {
    if (label === 'font' && window.MvmFontsClient?.pick) {
      const name =
        options.find((o) => Array.isArray(o) && o[0] === value)?.[1] || value;
      return `<div class="md-field"><span>${esc(t(label))}</span><button type="button" class="md-font-select" data-font-picker="${esc(key)}" aria-label="${esc(t('font'))}" aria-haspopup="dialog" aria-expanded="false">${esc(name)} <span aria-hidden="true">▾</span></button></div>`;
    }
    if (label === 'enter' || label === 'exit') {
      return `<div class="md-field"><span>${esc(t(label))}</span><button type="button" class="md-animation-select" data-animation-picker="${esc(key)}" aria-label="${esc(t(label))}" aria-haspopup="dialog"><span aria-hidden="true">▷</span> ${esc(t(value))}</button></div>`;
    }
    return `<label class="md-field"><span>${esc(t(label))}</span><select data-prop="${key}">${options
      .map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, t(o)];
        return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
      })
      .join('')}</select></label>`;
  }
  const section = (key, label = key) =>
    `<span data-inspector-section="${key}" data-section-label="${label}"></span>`;
  class Editor {
    constructor(root, options = {}) {
      this.root = root;
      root.className = 'md-app';
      root.tabIndex = 0;
      this.p = M.project();
      this.pageId = this.p.pages[0].id;
      this.itemId = null;
      this.inspectorId = M.uid();
      this.clipIds = [];
      this.mode = 'design';
      this.time = 0;
      this.undo = [];
      this.redo = [];
      this.dirty = false;
      this.pps = 35;
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.playing = false;
      this.fonts = [];
      this.stylePreviewCache = new Map();
      this.draftKey = 'draft';
      this.publicMode = !!options.public;
      this.projects = window.MvmDesignProjects
        ? new window.MvmDesignProjects(this, options)
        : null;
      this.build();
      this.bind();
      this.ai = window.MvmDesignAI ? new window.MvmDesignAI(this, options) : null;
      this.draw();
      this.renderPanels();
      this.resize = new ResizeObserver(() => {
        this.draw();
        if (!this.cueDrag) this.renderTimeline();
      });
      this.resize.observe(this.stage);
      this.loadFonts();
      this.ready = this.initDraft();
      this.unload = (e) => {
        if (this.dirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', this.unload);
      window.mvmOS?.onLangChange?.(() => {
        if (this.dead) return;
        this.root.querySelectorAll('[data-label]').forEach((el) => {
          updateButton(el, el.dataset.label);
        });
        this.root.querySelector('[data-name]').placeholder = t('untitled');
        this.renderPanels();
      });
    }
    get pg() {
      return (
        this.p.pages.find((pg) => pg.id === this.pageId) || this.p.pages[0]
      );
    }
    get it() {
      return this.pg.items.find((i) => i.id === this.itemId);
    }
    get clip() {
      return this.p.sequence.find((c) => c.id === this.clipIds[0]);
    }
    build() {
      this.root.innerHTML = `<div class="md-header"><input data-name aria-label="${esc(t('projectName'))}" placeholder="${esc(t('untitled'))}"><span class="md-state"></span><button type="button" class="md-document-size" data-action="settings"></button><div class="md-tabs">${['design', 'video', 'subtitles'].map((k) => btn('mode-' + k, k)).join('')}</div></div>
      <div class="md-actions">${[
        ['projects', 'projects'],
        ['new', 'new'],
        ['save', 'save'],
        ['share-project', 'shareProject'],
        ['ai-chat', 'aiChat'],
        ['undo', 'undo'],
        ['redo', 'redo'],
        ['settings', 'settings'],
        ['preview', 'videoPreview'],
        ['export', 'export'],
      ]
        .map(([a, b]) => btn(a, b))
        .join('')}</div>
      <div class="md-body"><aside class="md-pages" aria-label="${esc(t('pages'))}"></aside><main class="md-work"><div class="md-tools">${[
        ['text', 'text'],
        ['image', 'image'],
        ['ai-image', 'aiImage'],
        ['rect', 'rectangle'],
        ['ellipse', 'ellipse'],
        ['line', 'line'],
        ['template', 'templates'],
      ]
        .map(([a, b]) => btn(a, b))
        .join(
          '',
        )}</div><div class="md-stage"><canvas class="md-canvas" tabindex="0" aria-label="${esc(t('canvas'))}"></canvas></div><div class="md-help"></div><section class="md-bottom" hidden><div class="md-transport">${btn('play', 'play')}${btn('rewind', 'rewind')}${btn('preview-timeline', 'videoPreview')}${btn('audio', 'audio')}${btn('time-music', 'timeMusic')}${btn('next', 'next')}${btn('finish-timing', 'finishTiming')}${btn('cancel-timing', 'cancel')}<output data-time>0:00</output><input data-scrub type="range" min="0" max="5" step=".01" value="0" aria-label="${esc(t('seek'))}">${btn('zoom-out', 'zoomOut')}${btn('zoom-in', 'zoomIn')}</div><div class="md-timeline" title="${esc(t('timelineScrollHint'))}"><div class="md-track"><div class="md-time-ticks" aria-label="${esc(t('seek'))}"></div><div class="md-track-label" data-track-label="audio"></div><canvas class="md-wave"></canvas><div class="md-track-label" data-track-label="pages"></div><div class="md-clips"></div><div class="md-track-label" data-track-label="subtitles"></div><div class="md-subtitle-track" role="group" aria-label="${esc(t('subtitles'))}"></div><div class="md-playhead"></div></div></div></section></main><aside class="md-inspector"></aside></div>`;
      this.canvas = this.root.querySelector('.md-canvas');
      this.stage = this.root.querySelector('.md-stage');
      this.inspector = this.root.querySelector('.md-inspector');
      this.pages = this.root.querySelector('.md-pages');
      this.timeline = this.root.querySelector('.md-timeline');
      this.track = this.root.querySelector('.md-track');
    }
    bind() {
      this.rulerBlur = () => this.stopRulerScroll();
      window.addEventListener('blur', this.rulerBlur);
      this.timeline.addEventListener('wheel', event => {
        if (event.ctrlKey || event.metaKey) return;
        const vertical = event.shiftKey;
        const available = vertical ? this.timeline.scrollHeight - this.timeline.clientHeight
          : this.timeline.scrollWidth - this.timeline.clientWidth;
        if (available <= 1) return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const unit = event.deltaMode === 1 ? 18
          : event.deltaMode === 2 ? (vertical ? this.timeline.clientHeight : this.timeline.clientWidth) : 1;
        event.preventDefault();
        this.timeline[vertical ? 'scrollTop' : 'scrollLeft'] += delta * unit;
      }, { passive: false });
      this.timeline.addEventListener('lostpointercapture', event => {
        if (event.pointerId === this.rulerPointer) this.stopRulerScroll();
      });
      this.timeline.addEventListener('pointerdown', (e) => {
        this.cuePointerDown(e);
        if (
          !e.target.closest('.md-time-ticks,.md-wave') ||
          this.recording ||
          this.exporting
        )
          return;
        e.preventDefault();
        this.playCueEnd = null;
        this.rulerPointer = e.pointerId;
        this.timeline.setPointerCapture(e.pointerId);
        this.rulerClientX = e.clientX;
        this.seekRulerAt(e.clientX);
        this.startRulerScroll();
      });
      this.timeline.addEventListener('pointermove', (e) => {
        this.cuePointerMove(e);
        if (this.rulerPointer === e.pointerId) {
          this.rulerClientX = e.clientX;
          this.seekRulerAt(e.clientX);
        }
      });
      this.timeline.addEventListener('pointerup', (e) => {
        this.cuePointerUp(e);
        if (this.rulerPointer === e.pointerId) {
          this.stopRulerScroll();
          if (this.timeline.hasPointerCapture(e.pointerId))
            this.timeline.releasePointerCapture(e.pointerId);
        }
      });
      this.timeline.addEventListener('pointercancel', (e) => {
        this.cuePointerUp(e, true);
        this.stopRulerScroll();
      });

      this.inspector.addEventListener(
        'scroll',
        () => this.drawStylePreviews(),
        { passive: true },
      );
      this.root.addEventListener('click', (e) => {
        const animationPicker = e.target.closest('[data-animation-picker]');
        if (animationPicker) this.pickAnimation(animationPicker);
        const fontPicker = e.target.closest('[data-font-picker]');
        if (fontPicker)
          this.pickFont(fontPicker).catch((err) => this.error(err));
        const a = e.target.closest('[data-action]');
        if (a?.closest('.md-draft-menu')) this.closeDraftMenu();
        if (a && !a.disabled)
          this.action(a.dataset.action).catch((err) => this.error(err));
        const page = e.target.closest('[data-page]');
        if (page) {
          this.pageId = page.dataset.page;
          this.itemId = null;
          if (this.mode === 'design') this.pause();
          this.renderPanels();
          this.draw();
        }
        const clip = e.target.closest('[data-clip]');
        if (clip) {
          if (e.shiftKey) {
            if (this.clipIds.includes(clip.dataset.clip))
              this.clipIds = this.clipIds.filter(
                (id) => id !== clip.dataset.clip,
              );
            else this.clipIds.push(clip.dataset.clip);
          } else this.clipIds = [clip.dataset.clip];
          const c = M.schedule(this.p).find((c) => c.id === clip.dataset.clip);
          this.pageId = c.pageId;
          this.seek(c.start);
          this.renderPanels();
        }
      });
      this.pages.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('[data-draft]');
        if (!card) return;
        e.preventDefault();
        e.stopPropagation();
        this.showDraftMenu(card, e.clientX, e.clientY);
      });
      this.pages.addEventListener('keydown', (e) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        const card = e.target.closest('[data-draft]');
        if (!card) return;
        e.preventDefault();
        e.stopPropagation();
        const box = card.getBoundingClientRect();
        this.showDraftMenu(card, box.left + 20, box.bottom);
      });
      this.root.addEventListener('input', (e) => {
        const el = e.target,
          key = el.dataset.prop;
        if (
          !key ||
          el.closest('.md-modal') ||
          el.type === 'checkbox' ||
          key === 'styleScope' ||
          key === 'cueStyleId'
        )
          return;
        this.property(key, el.value, el);
      });
      this.root.addEventListener('change', (e) => {
        const el = e.target;
        if (el.matches('[data-name]')) {
          this.commit(() => (this.p.name = el.value));
          return;
        }
        if (el.closest('.md-modal')) return;
        const key = el.dataset.prop;
        if (!key) return;
        if (
          el.type === 'number' &&
          (el.value === '' || !Number.isFinite(el.valueAsNumber))
        ) {
          if (this.propertyEdit?.element === el) this.finishPropertyEdit();
          else {
            const value = this.propertyControlValue(key);
            if (value != null) el.value = value;
          }
          return;
        }
        if (this.propertyEdit?.element === el) {
          if (this.propertyEdit.value !== el.value)
            this.property(key, el.value, el);
          if (
            el.type === 'color' ||
            el.type === 'range' ||
            el.tagName === 'SELECT'
          )
            this.finishPropertyEdit();
        } else
          this.property(key, el.type === 'checkbox' ? el.checked : el.value);
      });
      this.root.addEventListener('focusout', (e) => {
        if (this.propertyEdit?.element === e.target) this.finishPropertyEdit();
      });
      this.root.querySelector('[data-scrub]').addEventListener('input', (e) => {
        if (!this.recording) this.seek(+e.target.value, true);
      });
      this.root.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-draft]');
        if (card)
          e.dataTransfer.setData(
            'application/x-mvmdesign-cue',
            card.dataset.draft,
          );
      });
      this.timeline.addEventListener('dragover', (e) => {
        if ([...e.dataTransfer.types].includes('application/x-mvmdesign-cue')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
      this.timeline.addEventListener('drop', (e) => {
        const id = e.dataTransfer.getData('application/x-mvmdesign-cue');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const x = e.clientX - this.track.getBoundingClientRect().left;
        this.placeDraft(id, Math.max(0, x / this.timelineScale));
      });
      this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
      this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
      this.canvas.addEventListener('pointercancel', () => {
        if (this.drag) {
          this.p = this.drag.before;
          this.drag = null;
          this.guides = [];
          this.renderInspector();
          this.draw();
        }
      });
      this.canvas.addEventListener('dblclick', () => {
        if (this.mode === 'design' && this.it?.type === 'text') {
          this.inspector.querySelector('[data-inspector-tab=content]')?.click();
          this.inspector.querySelector('[data-prop=text]')?.focus();
          this.inspector.querySelector('[data-prop=text]')?.select();
        }
      });
      this.root.addEventListener('keydown', (e) => this.key(e));
      this.root.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      });
      this.root.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          this.importFiles([...e.dataTransfer.files]).catch((err) =>
            this.error(err),
          );
        }
      });
      this.root.addEventListener('paste', (e) => {
        if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
        const files = [...e.clipboardData.files];
        if (files.length) {
          e.preventDefault();
          this.importFiles(files).catch((err) => this.error(err));
        }
      });
      this.audio.addEventListener('ended', () => {
        if (this.recording) this.finishTiming();
        else if (this.playing) {
          this.startTime = this.audio.duration;
          this.playStart = performance.now();
        }
      });
    }
    commit(fn, keepPlaying = false) {
      this.finishPropertyEdit();
      if (!keepPlaying) this.pauseUnlessRecording();
      this.undo.push(snapshot(this.p));
      if (this.undo.length > 30) this.undo.shift();
      this.redo = [];
      fn();
      this.changed();
    }
    changed() {
      M.applyCaptionRules(this.p);
      for (const d of this.p.captionDrafts)
        if (
          d.timingKey &&
          !this.p.captions.some((c) => c.timingKey === d.timingKey)
        )
          delete d.timingKey;
      this.dirty = true;
      this.hasEdited = true;
      this.renderPanels();
      this.draw();
      this.scheduleDraft();
      R.prepare(this.p)
        .then(() => {
          if (!this.dead) {
            this.draw();
            this.renderPages();
            this.drawStylePreviews();
            this.drawLayerPreviews();
            this.drawTimelinePreviews();
          }
        })
        .catch((e) => this.error(e));
    }
    pauseUnlessRecording() {
      if (!this.recording) this.pause();
    }
    async action(a) {
      if (this.exporting && a !== 'cancel-export') return;
      if (this.cueDrag) return;
      if (
        this.recording &&
        !['play', 'next', 'finish-timing', 'cancel-timing'].includes(a)
      )
        return;
      if (a.startsWith('mode-')) {
        if (this.recording) this.cancelTiming();
        this.pause();
        this.mode = a.slice(5);
        this.itemId = null;
        this.renderPanels();
        this.draw();
        return;
      }
      if (a.startsWith('rename-page-')) {
        this.renamePage(a.slice(12));
        return;
      }
      if (a.startsWith('draft-place-')) {
        this.toggleDraftTiming(a.slice(12));
        return;
      }
      if (a.startsWith('draft-edit-')) {
        const id = a.slice(11),
          cue = this.p.captionDrafts.find((c) => c.id === id);
        if (cue)
          this.modal(
            'editSubtitle',
            `<textarea data-draft-text maxlength="5000" aria-label="${esc(t('subtitleText'))}">${esc(cue.text)}</textarea>`,
            (box) => {
              this.property(
                'draft:' + id,
                box.querySelector('[data-draft-text]').value,
              );
            },
          );
        return;
      }
      if (a.startsWith('draft-delete-')) {
        const draft = this.p.captionDrafts.find((d) => d.id === a.slice(13));
        if (draft?.timingKey) this.finishClickCue();
        this.commit(
          () =>
            (this.p.captionDrafts = this.p.captionDrafts.filter(
              (c) => c.id !== a.slice(13),
            )),
        );
        return;
      }
      if (a === 'cue-unplace') {
        if (this.clickCue?.id === this.cueId) this.finishClickCue();
        this.commit(() => {
          const c = this.p.captions.find((c) => c.id === this.cueId);
          if (c) {
            this.p.captionDrafts.push({
              id: c.id,
              text: c.text,
              style: c.style,
              styleId: c.styleId,
            });
            this.p.captions = this.p.captions.filter((v) => v !== c);
          }
        });
        return;
      }
      if (a === 'reset-cue-style') {
        this.commit(() => {
          const c = this.p.captions.find((c) => c.id === this.cueId);
          if (c) c.style = {};
        });
        return;
      }
      switch (a) {
        case 'preview-timeline':
        case 'preview':
          await this.openVideoPreview();
          break;
        case 'save-caption-style':
          this.saveCaptionStyleDialog();
          break;
        case 'apply-caption-styles':
          this.captionStylesDialog();
          break;
        case 'cue-play':
          await this.playSelectedCue();
          break;
        case 'cue-previous':
        case 'cue-next': {
          const cues = this.p.captions
            .slice()
            .sort((a, b) => a.start - b.start);
          const index = cues.findIndex((c) => c.id === this.cueId),
            next =
              cues[
                index < 0
                  ? 0
                  : M.clamp(
                      index + (a === 'cue-next' ? 1 : -1),
                      0,
                      cues.length - 1,
                    )
              ];
          if (next) this.selectCue(next.id, true);
          break;
        }
        case 'text':
          this.addItem('text');
          break;
        case 'rect':
        case 'ellipse':
        case 'line':
          this.addItem('shape', a);
          break;
        case 'image':
          await this.importFiles(
            await inputFile(
              'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp',
              true,
            ),
          );
          break;
        case 'audio':
          await this.importFiles(await inputFile('audio/*'));
          break;
        case 'projects':
          await this.projectDialog();
          break;
        case 'new':
          this.settings(true);
          break;
        case 'open': {
          const [f] = await inputFile('.mvmdesign');
          if (f) await this.openFile(f);
          break;
        }
        case 'open-server':
          await this.browseServer();
          break;
        case 'ai-chat':
        case 'ai-image':
          await this.ai?.open(a === 'ai-image' ? 'image' : 'chat');
          break;
        case 'share-project':
          await this.projects?.share();
          break;
        case 'save':
          await this.save();
          break;
        case 'save-as':
          await this.save(true);
          break;
        case 'download':
          await this.projectOperation('preparingDownload', async () => {
            this.finishPropertyEdit();
            X.download(
              new Blob([JSON.stringify(this.p)], { type: 'application/json' }),
              this.fileName(),
            );
            if (
              !this.source &&
              (!this.projects?.current || this.projects.current.role === 'viewer')
            )
              this.dirty = false;
            await this.rememberProject(null, true);
            this.renderState();
            this.toast(t('projectDownloadStarted'));
          });
          break;
        case 'recover':
          await this.recover();
          break;
        case 'undo':
        case 'redo': {
          const from = a === 'undo' ? this.undo : this.redo,
            to = a === 'undo' ? this.redo : this.undo;
          if (from.length) {
            this.pause();
            to.push(snapshot(this.p));
            this.p = from.pop();
            if (!this.p.pages.some((pg) => pg.id === this.pageId))
              this.pageId = this.p.pages[0].id;
            this.itemId = null;
            this.setAudio();
            this.changed();
          }
          break;
        }
        case 'add-page':
          this.commit(() => {
            const pg = M.page();
            this.p.pages.push(pg);
            this.p.sequence.push(M.occurrence(pg.id));
            this.pageId = pg.id;
            this.itemId = null;
          });
          break;
        case 'duplicate-page':
          this.commit(() => {
            const pg = M.clone(this.pg);
            pg.id = M.uid();
            pg.items.forEach((i) => (i.id = M.uid()));
            this.p.pages.push(pg);
            this.p.sequence.push(M.occurrence(pg.id));
            this.pageId = pg.id;
            this.itemId = null;
          });
          break;
        case 'delete-page':
          if (this.p.pages.length > 1 && confirm(t('deletePageConfirm')))
            this.commit(() => {
              const id = this.pg.id;
              this.p.pages = this.p.pages.filter((pg) => pg.id !== id);
              this.p.sequence = this.p.sequence.filter((c) => c.pageId !== id);
              this.pageId = this.p.pages[0].id;
              this.itemId = null;
            });
          break;
        case 'page-up':
        case 'page-down':
          this.commit(() => {
            const i = this.p.pages.indexOf(this.pg),
              j = M.clamp(
                i + (a === 'page-up' ? -1 : 1),
                0,
                this.p.pages.length - 1,
              );
            [this.p.pages[i], this.p.pages[j]] = [
              this.p.pages[j],
              this.p.pages[i],
            ];
          });
          break;
        case 'duplicate-item':
          if (this.it)
            this.commit(() => {
              const it = M.clone(this.it);
              it.id = M.uid();
              it.x += 0.02;
              it.y += 0.02;
              this.pg.items.push(it);
              this.itemId = it.id;
            });
          break;
        case 'delete-item':
          if (this.it && !this.it.locked)
            this.commit(() => {
              this.pg.items = this.pg.items.filter((i) => i.id !== this.itemId);
              this.itemId = null;
            });
          break;
        case 'front':
        case 'back':
        case 'raise-layer':
        case 'lower-layer':
          this.reorderLayer(a);
          break;
        case 'image-white':
        case 'image-black':
        case 'image-original':
          if (this.it?.type === 'image' && !this.it.locked)
            this.commit(() => {
              this.it.imageTint = a !== 'image-original';
              if (a !== 'image-original') this.it.imageTintColor = a === 'image-white' ? '#ffffff' : '#000000';
            });
          break;
        case 'fill-page':
          if (this.it?.type === 'image')
            this.commit(() => {
              const it = this.it;
              Object.assign(it, {
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                rotation: 0,
                fit: 'cover',
              });
              this.pg.items = this.pg.items.filter((v) => v !== it);
              this.pg.items.unshift(it);
            });
          break;
        case 'center':
          if (this.it)
            this.commit(() => {
              this.it.x = (1 - this.it.w) / 2;
              this.it.y = (1 - this.it.h) / 2;
            });
          break;
        case 'add-occurrence':
          this.commit(() => {
            const c = M.occurrence(this.pg.id);
            this.p.sequence.push(c);
            this.clipIds = [c.id];
          });
          break;
        case 'repeat':
          if (this.clipIds.length)
            this.commit(() => {
              const source = this.p.sequence.filter((c) =>
                  this.clipIds.includes(c.id),
                ),
                last = Math.max(
                  ...this.clipIds.map((id) =>
                    this.p.sequence.findIndex((c) => c.id === id),
                  ),
                ),
                copies = source.map((c) => ({ ...c, id: M.uid() }));
              this.p.sequence.splice(last + 1, 0, ...copies);
              this.clipIds = copies.map((c) => c.id);
            });
          break;
        case 'delete-clip':
          this.commit(() => {
            this.p.sequence = this.p.sequence.filter(
              (c) => !this.clipIds.includes(c.id),
            );
            this.clipIds = [];
            this.time = Math.min(this.time, M.duration(this.p));
          });
          break;
        case 'clip-left':
        case 'clip-right':
          if (this.clip)
            this.commit(() => {
              const i = this.p.sequence.indexOf(this.clip),
                j = M.clamp(
                  i + (a === 'clip-left' ? -1 : 1),
                  0,
                  this.p.sequence.length - 1,
                );
              [this.p.sequence[i], this.p.sequence[j]] = [
                this.p.sequence[j],
                this.p.sequence[i],
              ];
            });
          break;
        case 'fit-music':
          if (this.p.audio && this.p.sequence.length)
            this.commit(() => {
              const ratio = this.p.audio.duration / M.duration(this.p);
              this.p.sequence.forEach(
                (c) => (c.duration = Math.max(0.1, c.duration * ratio)),
              );
            });
          break;
        case 'play':
          this.playCueEnd = null;
          if (this.playing) this.pause();
          else await this.play();
          break;
        case 'rewind':
          this.seek(0, true);
          break;
        case 'zoom-in':
          this.pps = Math.min(250, this.pps * 1.4);
          this.renderTimeline();
          this.timeline.scrollLeft = Math.max(
            0,
            this.time * this.timelineScale - this.timeline.clientWidth / 2,
          );
          break;
        case 'zoom-out':
          this.pps = Math.max(4, this.pps / 1.4);
          this.renderTimeline();
          this.timeline.scrollLeft = Math.max(
            0,
            this.time * this.timelineScale - this.timeline.clientWidth / 2,
          );
          break;
        case 'time-music':
          await this.startTiming();
          break;
        case 'time-captions':
          await this.startTiming('captions');
          break;
        case 'next':
          this.nextTiming();
          break;
        case 'finish-timing':
          this.finishTiming();
          break;
        case 'cancel-timing':
          this.cancelTiming();
          break;
        case 'remove-audio':
          this.commit(() => {
            this.p.audio = null;
          });
          this.setAudio();
          break;
        case 'add-cue':
          this.commit(() => {
            this.p.captions.push({
              id: M.uid(),
              start: this.time,
              end: this.time + 3,
              text: t('sampleSubtitle'),
            });
          });
          break;
        case 'cue-start':
          if (this.cueId) this.setCueTime('start');
          break;
        case 'cue-end':
          if (this.cueId) this.setCueTime('end');
          break;
        case 'import-srt': {
          const [f] = await inputFile('.srt');
          if (f) {
            const cues = M.parseSrt(await f.text());
            if (!cues.length) throw Error('invalidSrt');
            this.commit(() => this.p.captions.push(...cues));
          }
          break;
        }
        case 'export-srt':
          X.download(
            new Blob([M.toSrt(this.p.captions)], {
              type: 'application/x-subrip',
            }),
            (this.p.name || 'design') + '.srt',
          );
          break;
        case 'auto-style-info': {
          const box = this.modal(
            'captionAutoStyle',
            `<p class="md-note">${esc(t('captionAutoStyleHint'))}</p>`,
            () => {},
          );
          box.querySelector('[data-apply]').hidden = true;
          box.querySelector('[data-cancel]').textContent = t('close');
          break;
        }
        case 'paste-lyrics':
          this.lyricsDialog();
          break;
        case 'open-lyrics':
          this.lyricsDialog(true);
          break;
        case 'template':
          this.templates();
          break;
        case 'settings':
          this.settings();
          break;
        case 'export':
          this.exportDialog();
          break;
        default:
          if (a.startsWith('caption-style-'))
            this.applyCaptionPreset(a.slice(14));
          else if (a.startsWith('style-')) this.textPreset(a.slice(6));
          else if (a.startsWith('toggle-layer-')) {
            const id = a.slice(13);
            this.commit(() => {
              const layer = this.pg.items.find((i) => i.id === id);
              if (layer) layer.hidden = !layer.hidden;
            });
            this.renderInspector();
            this.draw();
          } else if (a.startsWith('layer-')) {
            this.itemId = a.slice(6);
            this.inspectorTabs ||= {};
            if (this.it) this.inspectorTabs[this.it.type] = 'layers';
            this.renderInspector();
            this.draw();
          } else if (a.startsWith('cue-select-')) {
            this.selectCue(a.slice(11), true);
          } else if (a.startsWith('cue-delete-'))
            this.commit(
              () =>
                (this.p.captions = this.p.captions.filter(
                  (c) => c.id !== a.slice(11),
                )),
            );
      }
    }
    addItem(type, shape) {
      this.mode = 'design';
      this.commit(() => {
        const it = M.item(type);
        if (type === 'text') it.text = t('sampleText');
        else {
          it.shape = shape;
          it.color = '#d5a56d';
          it.w = 0.35;
          it.h = 0.25;
          it.x = 0.325;
          it.y = 0.375;
        }
        this.pg.items.push(it);
        this.itemId = it.id;
      });
    }
    textPreset(kind) {
      if (!this.it || this.it.type !== 'text' || !M.textStyles.includes(kind))
        return;
      this.commit(() => Object.assign(this.it, M.textPreset(kind)));
    }
    defaultCaptionScope(cue) {
      return (this.p.captionStyles || []).some(style => style.id === cue?.styleId)
        ? 'saved:' + cue.styleId : 'global';
    }
    captionScope() {
      if (this.styleScope === 'all') return 'all';
      if (!this.styleScope)
        return this.defaultCaptionScope(this.p.captions.find(cue => cue.id === this.cueId));
      if (
        this.styleScope === 'individual' &&
        this.p.captions.some((c) => c.id === this.cueId)
      )
        return 'individual';
      if (
        (this.p.captionStyles || []).some(
          (s) => 'saved:' + s.id === this.styleScope,
        )
      )
        return this.styleScope;
      return 'global';
    }
    autoStyle() {
      return !!this.p.captionAutoStyle;
    }
    // Cues that share the style currently being edited.
    captionScopeCues() {
      const scope = this.captionScope(),
        known = new Set((this.p.captionStyles || []).map((x) => x.id));
      return [...this.p.captions, ...this.p.captionDrafts].filter((c) =>
        scope === 'all' ||
        (scope.startsWith('saved:')
          ? c.styleId === scope.slice(6)
          : !known.has(c.styleId)),
      );
    }
    captionBaseStyle() {
      if (this.captionScope() === 'all') {
        const cue = this.p.captions.find(cue => cue.id === this.cueId);
        return this.p.captionStyles.find(style => style.id === cue?.styleId)?.style
          || this.p.captionStyles[0]?.style || this.p.captionStyle;
      }
      return (
        (this.p.captionStyles || []).find(
          (s) => 'saved:' + s.id === this.captionScope(),
        )?.style || this.p.captionStyle
      );
    }
    captionEditTargets() {
      const cue = this.p.captions.find(cue => cue.id === this.cueId);
      if (this.captionScope() === 'all')
        return [this.p.captionStyle, ...this.p.captionStyles.map(style => style.style)];
      if (this.captionScope() === 'individual' && cue) return [cue.style ||= {}];
      return [this.captionBaseStyle()];
    }
    captionValueIsMixed(key) {
      const targets = this.captionEditTargets();
      return this.captionScope() === 'all' && targets.some(style =>
        (style[key] ?? this.p.captionStyle[key]) !== (targets[0][key] ?? this.p.captionStyle[key]));
    }
    captionEditStyle(cue) {
      return this.captionScope() === 'individual' && cue
        ? M.captionStyle(this.p, cue)
        : this.captionBaseStyle();
    }
    saveCaptionStyleDialog() {
      if (this.captionScope() === 'all') return;
      this.finishPropertyEdit();
      this.pause();
      const cue = this.p.captions.find((c) => c.id === this.cueId);
      const profiles = this.p.captionStyles || [];
      const scope = this.captionScope();
      const current = profiles.find((s) =>
        scope.startsWith('saved:')
          ? 'saved:' + s.id === scope
          : s.id === cue?.styleId,
      );
      const style = M.cleanCaptionStyle(
        cue && !scope.startsWith('saved:')
          ? M.captionStyle(this.p, cue)
          : this.captionEditStyle(cue),
      );
      const box = this.modal(
        'saveCaptionStyle',
        `${select('saveStyleTarget', 'saveStyleTarget', current?.id || 'new', [['new', t('newCaptionStyle')], ...profiles.map((s) => [s.id, s.name])])}
        ${field('captionStyleName', 'name', current?.name || t('captionStyleName') + ' ' + (profiles.length + 1), 'text', 'maxlength="100" required')}
        <button type="button" class="md-icon" data-delete-caption-profile ${current ? '' : 'disabled'} aria-label="${esc(t('delete'))}" title="${esc(t('delete'))}">${buttonContent('delete')}</button>
        <p class="md-note">${esc(t('saveCaptionStyleHint'))}</p>`,
        async () => {
          const name = box
            .querySelector('[data-prop=captionStyleName]')
            .value.trim();
          if (!name) {
            box.querySelector('[data-prop=captionStyleName]').focus();
            return false;
          }
          const id = box.querySelector('[data-prop=saveStyleTarget]').value;
          this.commit(() => {
            this.p.captionStyles ||= [];
            const existing = this.p.captionStyles.find((s) => s.id === id);
            const saved = existing || { id: M.uid() };
            Object.assign(saved, { name, style: M.clone(style) });
            if (!existing) this.p.captionStyles.push(saved);
            if (cue) {
              cue.styleId = saved.id;
              cue.style = {};
              for (const draft of this.p.captionDrafts)
                if (cue.timingKey && draft.timingKey === cue.timingKey) {
                  draft.styleId = saved.id;
                  draft.style = {};
                }
              if (scope !== 'individual') this.styleScope = 'saved:' + saved.id;
            }
          });
        },
        'save',
      );
      box.querySelector('[data-prop=saveStyleTarget]').onchange = (e) => {
        const profile = profiles.find((s) => s.id === e.target.value);
        box.querySelector('[data-delete-caption-profile]').disabled = !profile;
        box.querySelector('[data-prop=captionStyleName]').value =
          profile?.name || t('captionStyleName') + ' ' + (profiles.length + 1);
      };
      box.querySelector('[data-delete-caption-profile]').onclick = () => {
        const id = box.querySelector('[data-prop=saveStyleTarget]').value;
        if (!profiles.some((s) => s.id === id)) return;
        this.commit(() => {
          for (const cue of [...this.p.captions, ...this.p.captionDrafts])
            if (cue.styleId === id) {
              cue.style = M.captionStyle(this.p, cue);
              delete cue.styleId;
            }
          this.p.captionStyles = this.p.captionStyles.filter(
            (s) => s.id !== id,
          );
        });
        box.querySelector('[data-cancel]').click();
      };
    }
    captionStylesDialog() {
      this.finishPropertyEdit();
      this.pause();
      const project = this.p,
        profiles = project.captionStyles || [];
      const cue = project.captions.find((c) => c.id === this.cueId);
      let styleId =
        cue?.styleId ||
        (this.captionScope().startsWith('saved:')
          ? this.captionScope().slice(6)
          : profiles[0]?.id) ||
        '';
      let targets = [],
        checked = new Set(),
        previewTarget;
      const pending = new Map(),
        selections = new Map(),
        autoState = new Map(),
        holdState = new Map();
      const ruleOf = (id) => (project.captionRules || []).find((r) => r.styleId === id);
      const holdOf = (id) => {
        const saved = ruleOf(id)?.hold || 0;
        const st = holdState.get(id);
        return { on: st ? st.on : saved > 0 };
      };
      const holdDirty = (id) => {
        const h = holdOf(id), saved = ruleOf(id)?.hold || 0;
        return holdState.has(id) && (h.on ? (isAuto(id) ? !saved : true) : saved > 0);
      };
      const isAuto = (id) => (autoState.has(id) ? autoState.get(id) : !!ruleOf(id));
      this.root.scrollTop = 0;
      const box = this.modal(
        'applyCaptionStyles',
        `<p class="md-note">${esc(t('captionBatchHint'))}</p><p class="md-note">${esc(t('captionBatchMultiHint'))}</p>
        <div class="md-caption-batch">
          <div class="md-caption-batch-styles"><canvas data-batch-preview width="480" height="270"></canvas>
          <div class="md-caption-style-gallery" role="group" aria-label="${esc(t('savedCaptionStyles'))}">${[{ id: '', name: t('globalStyle'), style: project.captionStyle }, ...profiles].map((s) => `<button type="button" data-saved-caption-style="${esc(s.id)}" aria-pressed="${s.id === styleId}"><canvas width="200" height="85" aria-hidden="true"></canvas><span>${esc(s.name)}</span></button>`).join('')}</div></div>
          <div class="md-caption-batch-targets">
            ${select('batchScope', 'captionBatchScope', 'all', [
              ['all', t('allSubtitles')],
              ['placed', t('onTimeline')],
              ['drafts', t('unplaced')],
            ])}
            <div class="md-caption-rule">${field('batchStart', 'captionRuleStart', 1, 'number', 'min="1" step="1"')}${field('batchEvery', 'captionRuleEvery', 4, 'number', 'min="1" step="1"')}${field('batchEnd', 'captionRuleEnd', M.captionTargets(project).length, 'number', 'min="1" step="1"')}</div>
            <div class="md-row"><button type="button" data-batch-rule>${esc(t('selectCaptionRule'))}</button><button type="button" data-batch-all>${esc(t('selectAllCaptions'))}</button><button type="button" data-batch-none>${esc(t('clearCaptionSelection'))}</button></div>
            ${field('batchKeep', 'keepCaptionOverrides', false, 'checkbox')}
            <div class="md-field-info">${field('batchHold', 'captionHold', false, 'checkbox')}<button type="button" class="md-icon" data-hold-info aria-label="${esc(t('info'))}" title="${esc(t('info'))}">ⓘ</button></div>
            ${field('batchAuto', 'captionAutoApply', false, 'checkbox')}<p class="md-note" data-auto-hint>${esc(t('captionAutoHint'))}</p>
            <output class="md-caption-batch-count" aria-live="polite"></output>
            <div class="md-caption-batch-list"></div>
          </div>
        </div>`,
        async () => {
          stageSelection();
          const autoChanged = [...autoState].some(([id, on]) => on !== !!ruleOf(id)) || [...holdState.keys()].some(holdDirty);
          if (this.p !== project || (!pending.size && !autoChanged)) return false;
          const keep = box.querySelector('[data-prop=batchKeep]').checked;
          const holdOnce = [];
          this.commit(() => {
            // Saved rules: pattern from the "all subtitles" view of each style.
            const ids = new Set([...autoState.keys(), ...holdState.keys()]);
            for (const id of ids) {
              const on = isAuto(id), h = holdOf(id);
              const sel = selections.get(JSON.stringify([id, 'all']));
              const every = Math.max(1, Math.floor(+sel?.every) || ruleOf(id)?.every || 1);
              const rule = {
                styleId: id,
                start: Math.max(1, Math.floor(+sel?.start) || ruleOf(id)?.start || 1),
                every,
                hold: h.on ? 1 : 0,
              };
              if (autoState.has(id) || ruleOf(id)) {
                project.captionRules = (project.captionRules || []).filter((r) => r.styleId !== id);
                if (on && (sel || ruleOf(id))) project.captionRules.push(rule);
              }
              // One-time hold when the rule is not automatic.
              if (!on && rule.hold) holdOnce.push(rule);
            }
            const linkedByKey = new Map();
            for (const c of [...project.captions, ...project.captionDrafts]) {
              if (!c.timingKey) continue;
              if (!linkedByKey.has(c.timingKey))
                linkedByKey.set(c.timingKey, []);
              linkedByKey.get(c.timingKey).push(c);
            }
            for (const [cue, assignedId] of pending) {
              const linked = [cue, ...(linkedByKey.get(cue.timingKey) || [])];
              for (const c of new Set(linked)) {
                if (assignedId) c.styleId = assignedId;
                else delete c.styleId;
                if (!keep) c.style = {};
              }
            }
            for (const rule of holdOnce) M.holdCaptions(project, rule);
          });
        },
      );
      box
        .querySelector('.md-modal-box')
        .classList.add('md-caption-batch-dialog');
      const list = box.querySelector('.md-caption-batch-list');
      const drawPreview = (entry) => {
        if (!entry) return;
        previewTarget = entry;
        const p = snapshot(project),
          pg = p.pages.find((pg) => pg.id === this.pg.id);
        for (const item of pg.items)
          Object.assign(item, { enter: 'none', exit: 'none', delay: 0 });
        p.sequence = [
          { ...M.occurrence(pg.id), duration: 5, transition: 'cut' },
        ];
        const isPending = pending.has(entry.cue) || checked.has(entry.cue);
        const assignedId = pending.has(entry.cue)
          ? pending.get(entry.cue)
          : styleId;
        const style = isPending
          ? {
              ...(profiles.find((s) => s.id === assignedId)?.style ||
                project.captionStyle),
              ...(box.querySelector('[data-prop=batchKeep]').checked
                ? entry.cue.style
                : {}),
            }
          : M.captionStyle(project, entry.cue);
        p.captions = [
          {
            id: 'preview',
            text: entry.cue.text,
            start: 0,
            end: 5,
            style: { ...style, enter: 'none', exit: 'none', preset: 'custom' },
          },
        ];
        const canvas = box.querySelector('[data-batch-preview]');
        const scale = Math.min(480 / p.width, 270 / p.height);
        canvas.width = Math.max(1, Math.round(p.width * scale));
        canvas.height = Math.max(1, Math.round(p.height * scale));
        R.video(canvas.getContext('2d'), p, 2, canvas.width, canvas.height);
      };
      const update = () => {
        box.querySelector('.md-caption-batch-count').textContent =
          `${t('selectedCaptions')}: ${new Set([...pending.keys(), ...checked]).size} / ${M.captionTargets(project).length}`;
        const scopeAll = box.querySelector('[data-prop=batchScope]').value === 'all';
        const auto = box.querySelector('[data-prop=batchAuto]');
        auto.disabled = !scopeAll;
        auto.checked = scopeAll && isAuto(styleId);
        box.querySelector('[data-auto-hint]').textContent = t(scopeAll ? 'captionAutoHint' : 'captionAutoNeedsAll');
        const holdBox = box.querySelector('[data-prop=batchHold]');
        const h = holdOf(styleId);
        holdBox.checked = h.on;
        holdBox.disabled = !scopeAll;
        const autoChanged = [...autoState].some(([id, on]) => on !== !!ruleOf(id)) || [...holdState.keys()].some(holdDirty);
        box.querySelector('[data-apply]').disabled =
          !checked.size && !pending.size && !autoChanged;
        for (const row of list.children) {
          const entry = targets[+row.dataset.batchIndex],
            selected = checked.has(entry.cue);
          row.classList.toggle(
            'md-pending-style',
            selected || pending.has(entry.cue),
          );
          row.querySelector('input').checked = selected;
          const assignedId = pending.has(entry.cue)
            ? pending.get(entry.cue)
            : selected
              ? styleId
              : entry.cue.styleId;
          row.querySelector('[data-pending-style]').textContent =
            profiles.find((s) => s.id === assignedId)?.name || t('globalStyle');
        }
        drawPreview(
          previewTarget ||
            targets.find((t) => checked.has(t.cue)) ||
            targets[0],
        );
      };
      const scopeKey = () =>
        JSON.stringify([
          styleId,
          box.querySelector('[data-prop=batchScope]').value,
        ]);
      const remember = () =>
        selections.set(scopeKey(), {
          checked: new Set(checked),
          start: box.querySelector('[data-prop=batchStart]').value,
          every: box.querySelector('[data-prop=batchEvery]').value,
          end: box.querySelector('[data-prop=batchEnd]').value,
        });
      const stageSelection = () => {
        for (const { cue } of targets) {
          if (pending.has(cue) && pending.get(cue) === styleId)
            pending.delete(cue);
        }
        for (const cue of checked) pending.set(cue, styleId);
        remember();
      };
      const rule = () => {
        checked = new Set(
          M.captionPattern(
            targets,
            box.querySelector('[data-prop=batchStart]').value,
            box.querySelector('[data-prop=batchEvery]').value,
            box.querySelector('[data-prop=batchEnd]').value,
          ).map((t) => t.cue),
        );
        stageSelection();
        previewTarget = targets.find((t) => checked.has(t.cue));
        update();
      };
      const render = () => {
        targets = M.captionTargets(
          project,
          box.querySelector('[data-prop=batchScope]').value,
        );
        previewTarget = null;
        const previous = selections.get(scopeKey());
        const first = targets.findIndex((t) => t.cue.styleId === styleId);
        const savedRule = ruleOf(styleId);
        box.querySelector('[data-prop=batchStart]').value =
          previous?.start || savedRule?.start ||
          (first >= 0
            ? first + 1
            : Math.max(1, profiles.findIndex((s) => s.id === styleId) + 1));
        box.querySelector('[data-prop=batchEvery]').value =
          previous?.every || savedRule?.every || 4;
        box.querySelector('[data-prop=batchEnd]').value =
          previous?.end ?? targets.length;
        checked = previous
          ? new Set(
              [...previous.checked].filter(
                (cue) => !pending.has(cue) || pending.get(cue) === styleId,
              ),
            )
          : new Set(
              M.captionPattern(
                targets,
                box.querySelector('[data-prop=batchStart]').value,
                box.querySelector('[data-prop=batchEvery]').value,
                box.querySelector('[data-prop=batchEnd]').value,
              ).map((t) => t.cue),
            );
        if (!previous) {
          const assigned = targets.filter(
            (t) => (t.cue.styleId || '') === styleId,
          );
          if (assigned.length) checked = new Set(assigned.map((t) => t.cue));
        }
        list.innerHTML = targets
          .map(
            ({ cue, placed }, i) =>
              `<label class="md-caption-batch-row" data-batch-index="${i}"><input type="checkbox" data-batch-cue="${esc(cue.id)}"><span><strong>${i + 1}. ${esc(cue.text)}</strong><small>${esc(placed ? clock(cue.start) + '–' + clock(cue.end) : t('unplaced'))}</small><small data-pending-style></small></span></label>`,
          )
          .join('');
        for (const row of list.children) {
          const entry = targets[+row.dataset.batchIndex];
          row.querySelector('input').onchange = (e) => {
            if (e.target.checked) checked.add(entry.cue);
            else checked.delete(entry.cue);
            stageSelection();
            previewTarget = entry;
            update();
          };
          row.onpointerenter = () => drawPreview(entry);
          row.onfocusin = () => drawPreview(entry);
        }
        update();
      };
      for (const key of ['batchStart', 'batchEvery', 'batchEnd'])
        box.querySelector(`[data-prop=${key}]`).oninput = rule;
      box.querySelector('[data-batch-rule]').onclick = rule;
      box.querySelector('[data-prop=batchScope]').onchange = render;
      box.querySelector('[data-prop=batchKeep]').onchange = update;
      box.querySelector('[data-prop=batchHold]').onchange = (ev) => {
        holdState.set(styleId, { on: ev.target.checked });
        update();
      };
      box.querySelector('[data-hold-info]').onclick = () => {
        const info = this.modal('captionHold', `<p class="md-note">${esc(t('captionHoldHint'))}</p>`, () => {});
        info.querySelector('[data-apply]').hidden = true;
        info.querySelector('[data-cancel]').textContent = t('close');
      };
      box.querySelector('[data-prop=batchAuto]').onchange = (ev) => {
        autoState.set(styleId, ev.target.checked);
        if (ev.target.checked) {
          // Turning it on selects exactly what the rule covers.
          if (box.querySelector('[data-prop=batchScope]').value === 'all') rule();
        }
        stageSelection();
        update();
      };
      box.querySelector('[data-batch-all]').onclick = () => {
        checked = new Set(targets.map((t) => t.cue));
        stageSelection();
        update();
      };
      box.querySelector('[data-batch-none]').onclick = () => {
        checked.clear();
        stageSelection();
        update();
      };
      for (const button of box.querySelectorAll('[data-saved-caption-style]')) {
        const id = button.dataset.savedCaptionStyle;
        const style =
          profiles.find((s) => s.id === id)?.style || project.captionStyle;
        const canvas = button.querySelector('canvas'),
          ctx = canvas.getContext('2d');
        ctx.fillStyle = '#202638';
        ctx.fillRect(0, 0, 200, 85);
        R.drawText(
          ctx,
          { ...M.item(), ...style, size: 0.31, text: 'Aa', color: style.color },
          200,
          85,
          85,
        );
        button.onclick = () => {
          if (id !== styleId) remember();
          styleId = id;
          for (const b of box.querySelectorAll('[data-saved-caption-style]'))
            b.setAttribute('aria-pressed', String(b === button));
          render();
          stageSelection();
          update();
        };
      }
      render();
    }
    applyCaptionPreset(kind) {
      if (!M.textStyles.includes(kind)) return;
      this.commit(() => {
        const cue = this.p.captions.find((c) => c.id === this.cueId);
        for (const target of this.captionEditTargets()) {
          const current = this.captionScope() === 'individual' ? this.captionEditStyle(cue) : target;
          Object.assign(target, M.textPreset(kind), {
            preset: ['karaoke', 'typewriter'].includes(current.preset) ? current.preset : 'custom',
          });
        }
      });
    }
    styleGallery(caption = false) {
      return `<div class="md-style-gallery">${M.textStyles.map((k) => `<button type="button" class="md-style-tile" data-action="${caption ? 'caption-' : ''}style-${k}" title="${esc(t('style_' + k))}"><canvas data-style-preview="${k}" width="240" height="100" aria-hidden="true"></canvas><span>${esc(t('style_' + k))}</span></button>`).join('')}</div>`;
    }
    drawStylePreviews() {
      const viewport = this.inspector.getBoundingClientRect();
      for (const gallery of this.inspector.querySelectorAll(
        '.md-style-gallery',
      )) {
        if (!gallery.dataset.bound) {
          gallery.dataset.bound = 'true';
          gallery.addEventListener('scroll', () => this.drawStylePreviews(), {
            passive: true,
          });
        }
      }
      for (const canvas of this.inspector.querySelectorAll(
        '[data-style-preview]',
      )) {
        const gallery = canvas.closest('.md-style-gallery'),
          g = gallery.getBoundingClientRect(),
          r = canvas.getBoundingClientRect();
        if (
          !g.height ||
          r.bottom < Math.max(g.top, viewport.top) ||
          r.top > Math.min(g.bottom, viewport.bottom)
        )
          continue;
        const cue = this.p.captions.find((c) => c.id === this.cueId),
          source =
            this.mode === 'subtitles'
              ? M.captionStyle(this.p, cue || {})
              : this.it;
        const key =
          canvas.dataset.stylePreview +
          ':' +
          (source?.font || 'sans-serif') +
          ':' +
          document.fonts.status;
        if (canvas.dataset.renderKey === key) continue;
        canvas.dataset.renderKey = key;
        const ctx = canvas.getContext('2d');
        const cached = this.stylePreviewCache.get(key);
        if (cached) {
          ctx.drawImage(cached, 0, 0);
          continue;
        }
        ctx.clearRect(0, 0, 240, 100);
        ctx.fillStyle = '#202534';
        ctx.fillRect(0, 0, 240, 100);
        const it = {
          ...M.item(),
          ...M.textPreset(canvas.dataset.stylePreview),
          font: source?.font || 'sans-serif',
          size: 0.095,
          text: 'Aa',
          weight: 900,
        };
        R.drawText(ctx, it, 240, 100, 720);
        const copy = document.createElement('canvas');
        copy.width = 240;
        copy.height = 100;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        this.stylePreviewCache.set(key, copy);
        if (this.stylePreviewCache.size > 64)
          this.stylePreviewCache.delete(
            this.stylePreviewCache.keys().next().value,
          );
      }
      for (const button of this.inspector.querySelectorAll(
        '[data-font-picker]',
      )) {
        const key = button.dataset.fontPicker,
          cue = this.p.captions.find((c) => c.id === this.cueId);
        const family =
          key === 'font'
            ? this.it?.font
            : key.startsWith('cueStyle:')
              ? M.captionStyle(this.p, cue || {}).font
              : this.captionBaseStyle().font;
        button.style.fontFamily = window.MvmFontsClient?.has(family)
          ? window.MvmFontsClient.stack(family)
          : family;
      }
    }
    pickAnimation(button) {
      if (this.exporting || this.recording || this.cueDrag) return;
      this.finishPropertyEdit();
      this.pause();
      this.animationPickerClose?.();
      const key = button.dataset.animationPicker,
        exit = key.split(':').at(-1) === 'exit',
        caption = key.includes(':'),
        cue = this.p.captions.find((c) => c.id === this.cueId),
        style = caption
          ? key.startsWith('cueStyle:')
            ? M.captionStyle(this.p, cue || {})
            : this.captionBaseStyle()
          : this.it;
      if (!style) return;
      const project = this.p,
        itemId = this.itemId,
        cueId = this.cueId;
      const options = M.animations.filter(
        (value) =>
          !['typewriter', 'words'].includes(value) ||
          (!exit && (caption || style.type === 'text')),
      );
      const selected = style[exit ? 'exit' : 'enter'] || 'none';
      let candidate = selected;
      const preview = snapshot(this.p);
      const pg = preview.pages.find((p) => p.id === this.pg.id);
      for (const item of pg.items)
        Object.assign(item, { enter: 'none', exit: 'none', delay: 0 });
      const duration = M.clamp(style.animDuration || 0.7, 0.05, 3),
        length = Math.max(2.4, duration * 2 + 1);
      preview.sequence = [
        { ...M.occurrence(pg.id), duration: length, transition: 'cut' },
      ];
      const target = caption
        ? { ...style }
        : pg.items.find((item) => item.id === itemId);
      if (!target) return;
      if (caption)
        preview.captions = [
          {
            id: 'preview',
            text: cue?.text || t('sampleText'),
            start: 0,
            end: length,
            style: target,
          },
        ];
      else preview.captions = [];
      const tileProject = M.project();
      tileProject.assets = preview.assets;
      const tile = {
        ...M.item(caption ? 'text' : style.type),
        ...style,
        text: 'Aa',
        x: 0.17,
        y: 0.25,
        w: 0.66,
        h: 0.5,
        size: 0.28,
        delay: 0,
        animDuration: 0.7,
        enter: 'none',
        exit: 'none',
        opacity: 1,
        rotation: 0,
        color: caption || style.type === 'text' ? '#ffffff' : '#9b8afb',
      };
      tileProject.pages[0].bg = '#202638';
      tileProject.pages[0].gradient = false;
      tileProject.pages[0].items = [tile];
      let start = performance.now(),
        raf,
        previous = 0;
      const apply = () => {
        if (
          this.dead ||
          this.p !== project ||
          this.itemId !== itemId ||
          this.cueId !== cueId
        )
          return;
        this.property(key, candidate);
      };
      this.root.scrollTop = 0;
      const box = this.modal(
        exit ? 'exit' : 'enter',
        `<p class="md-note">${esc(t('animationPickerHint'))}</p>
        <div class="md-animation-preview"><canvas data-animation-stage></canvas><strong data-animation-name>${esc(t(candidate))}</strong></div>
        <div class="md-animation-gallery" role="group" aria-label="${esc(t(exit ? 'exit' : 'enter'))}">${options.map((value) => `<button type="button" data-animation-value="${value}" aria-pressed="${value === selected}"><canvas width="200" height="110" aria-hidden="true"></canvas><span>${esc(t(value))}</span></button>`).join('')}</div>`,
        async () => apply(),
      );
      box.querySelector('.md-modal-box').classList.add('md-animation-dialog');
      const stage = box.querySelector('[data-animation-stage]');
      const scale = Math.min(640 / preview.width, 300 / preview.height);
      stage.width = Math.max(1, Math.round(preview.width * scale));
      stage.height = Math.max(1, Math.round(preview.height * scale));
      const tiles = [...box.querySelectorAll('[data-animation-value]')];
      const selectPreview = (value) => {
        candidate = value;
        start = performance.now();
        box.querySelector('[data-animation-name]').textContent = t(value);

      };
      for (const tile of tiles) {
        const value = tile.dataset.animationValue;
        tile.onpointerenter = () => selectPreview(value);
        tile.onfocus = () => selectPreview(value);
        tile.onclick = () => {
          candidate = value;
          apply();
          close();
        };
      }
      const selectedTile = tiles.find(tile => tile.dataset.animationValue === selected);
      if (selectedTile) {
        const marker = document.createElement('span');
        marker.textContent = '✓';
        marker.setAttribute('aria-hidden', 'true');
        selectedTile.querySelector('span').prepend(marker, ' ');
        selectedTile.focus({ preventScroll: true });
        const gallery = selectedTile.parentElement;
        gallery.scrollTop += selectedTile.getBoundingClientRect().top - gallery.getBoundingClientRect().top
          - (gallery.clientHeight - selectedTile.offsetHeight) / 2;
      }
      const close = () => box.querySelector('[data-cancel]').click();
      this.animationPickerClose = close;
      box.cleanup = () => {
        cancelAnimationFrame(raf);
        if (this.animationPickerClose === close)
          this.animationPickerClose = null;
      };
      box.restoreFocus = () =>
        this.inspector
          .querySelector(`[data-animation-picker="${CSS.escape(key)}"]`)
          ?.focus({ preventScroll: true });
      const time = (elapsed, dur, len) => {
        const phase = elapsed % (dur + 1.1);
        if (!exit) return Math.min(phase, len - dur - 0.001);
        return Math.min(len - 0.001, len - dur - 0.45 + phase);
      };
      const draw = (now) => {
        if (this.dead || !box.isConnected) return;
        if (!document.hidden && now - previous >= 1000 / 24) {
          previous = now;
          Object.assign(target, {
            enter: exit ? 'none' : candidate,
            exit: exit ? candidate : 'none',
            delay: 0,
            animDuration: duration,
          });
          const elapsed = (now - start) / 1000;
          R.video(
            stage.getContext('2d'),
            preview,
            time(elapsed, duration, length),
            stage.width,
            stage.height,
          );
          const bounds = box
            .querySelector('.md-animation-gallery')
            .getBoundingClientRect();
          for (const button of tiles) {
            const r = button.getBoundingClientRect();
            if (r.bottom < bounds.top || r.top > bounds.bottom) continue;
            const canvas = button.querySelector('canvas');
            Object.assign(tile, {
              text: button.dataset.animationValue === 'words' ? 'Aa Bb' : 'Aa',
              enter: exit ? 'none' : button.dataset.animationValue,
              exit: exit ? button.dataset.animationValue : 'none',
            });
            R.page(
              canvas.getContext('2d'),
              tileProject,
              tileProject.pages[0],
              200,
              110,
              time(elapsed, 0.7, 2.4),
              2.4,
              true,
            );
          }
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }
    async pickFont(button) {
      if (this.exporting || this.recording || this.cueDrag) return;
      this.pause();
      this.fontPickerAbort?.abort();
      const controller = new AbortController();
      this.fontPickerAbort = controller;
      const key = button.dataset.fontPicker,
        project = this.p,
        itemId = this.itemId,
        cueId = this.cueId;
      const cue = this.p.captions.find((c) => c.id === cueId),
        style =
          key === 'font'
            ? this.it
            : key.startsWith('cueStyle:')
              ? M.captionStyle(this.p, cue || {})
              : this.captionBaseStyle();
      button.setAttribute('aria-expanded', 'true');
      try {
        const name = await window.MvmFontsClient.pick({
          value: style?.font,
          sample:
            (key === 'font' ? this.it?.text : cue?.text) ||
            'Aa Bb Жж 0123456789',
          lang: window.mvmOS?.lang || 'en',
          choices: this.fontOptions(),
          signal: controller.signal,
        });
        if (
          name &&
          !controller.signal.aborted &&
          !this.dead &&
          this.p === project &&
          this.itemId === itemId &&
          this.cueId === cueId
        )
          this.property(key, name);
      } finally {
        button.setAttribute('aria-expanded', 'false');
        if (this.fontPickerAbort === controller) this.fontPickerAbort = null;
      }
    }
    previewProperty(element, key, apply) {
      if (
        element.type === 'number' &&
        (element.value === '' || !Number.isFinite(element.valueAsNumber))
      )
        return;
      if (this.propertyEdit?.element !== element) {
        this.finishPropertyEdit();
        const before = snapshot(this.p);
        this.propertyEdit = {
          element,
          key,
          before,
          undo: this.undo.slice(),
          redo: this.redo,
          dirty: this.dirty,
          hasEdited: this.hasEdited,
        };
        this.undo.push(before);
        if (this.undo.length > 30) this.undo.shift();
        this.redo = [];
        this.pauseUnlessRecording();
      }
      apply();
      this.propertyEdit.value = element.value;
      this.dirty = true;
      this.hasEdited = true;
      this.renderState();
      this.draw();
      this.renderPages();
      if (key.startsWith('clip:')) this.renderTimeline();
      else if (key.startsWith('cue:')) {
        this.renderCueTrack();
        this.updateTransport();
        const cue = this.p.captions.find((c) => c.id === key.split(':')[1]);
        if (cue)
          for (const edge of ['start', 'end']) {
            const other = this.inspector.querySelector(
              `[data-prop="cue:${CSS.escape(cue.id)}:${edge}"]`,
            );
            if (other && other !== element && document.activeElement !== other)
              other.value = cue[edge].toFixed(3);
          }
      }
      if (key.startsWith('cueStyle:')) {
        const checkbox = this.inspector.querySelector(
          `[data-prop="override:${CSS.escape(key.split(':')[1])}"]`,
        );
        if (checkbox) checkbox.checked = true;
      }
      if (key.startsWith('caption:') && this.captionScope() === 'all' && !this.captionValueIsMixed(key.split(':')[1]))
        this.inspector.querySelector(`[data-caption-mixed="${CSS.escape(key.split(':')[1])}"]`)?.remove();
      this.updateInspectorVisibility();
      this.scheduleDraft();
    }
    propertyControlValue(key) {
      const parts = key.split(':'),
        k = parts[1];
      if (parts[0] === 'page') return this.pg[k];
      if (parts[0] === 'clip') return this.clip?.[k];
      if (parts[0] === 'cue')
        return this.p.captions.find((c) => c.id === k)?.[parts[2]];
      if (parts[0] === 'caption' || parts[0] === 'cueStyle') {
        const cue = this.p.captions.find((c) => c.id === this.cueId),
          style =
            parts[0] === 'caption'
              ? this.captionBaseStyle()
              : M.captionStyle(this.p, cue || {});
        return k === 'size' ? style.size * this.p.height
          : ['x', 'y', 'w', 'h'].includes(k) ? style[k] * 100 : style[k];
      }
      if (key === 'size') return this.it?.size * this.p.height;
      return ['x', 'y', 'w', 'h', 'opacity'].includes(key)
        ? this.it?.[key] * 100
        : this.it?.[key];
    }
    finishPropertyEdit() {
      const edit = this.propertyEdit;
      if (!edit) return;
      this.propertyEdit = null;
      const value = this.propertyControlValue(edit.key);
      if (edit.element.isConnected && value != null)
        edit.element.value =
          typeof value === 'number' ? +value.toFixed(6) : value;
      R.prepare(this.p)
        .then(() => {
          if (!this.dead) {
            this.draw();
            this.renderPages();
            this.drawStylePreviews();
            this.drawLayerPreviews();
            this.drawTimelinePreviews();
          }
        })
        .catch((e) => this.error(e));
    }
    cancelPropertyEdit() {
      const edit = this.propertyEdit;
      if (!edit) return;
      this.propertyEdit = null;
      this.p = edit.before;
      this.undo = edit.undo;
      this.redo = edit.redo;
      this.dirty = edit.dirty;
      this.hasEdited = edit.hasEdited;
      this.renderPanels();
      this.draw();
      this.storeDraft(true);
    }
    property(key, value, previewElement = null) {
      if (this.exporting || this.recording || this.cueDrag) return;
      if (key === 'captionAutoStyle') {
        this.finishPropertyEdit();
        this.commit(() => (this.p.captionAutoStyle = !!value));
        this.renderInspector();
        return;
      }
      if (key === 'styleScope') {
        this.finishPropertyEdit();
        this.styleScope = value;
        this.renderInspector();
        return;
      }
      const apply = () => {
        if (key === 'cueStyleId') {
          const cue = this.p.captions.find((c) => c.id === this.cueId);
          if (cue) {
            cue.styleId = (this.p.captionStyles || []).some(
              (s) => s.id === value,
            )
              ? value
              : undefined;
            cue.style = {};
            if (this.styleScope !== 'individual') this.styleScope = this.defaultCaptionScope(cue);
          }
          return;
        }
        if (key.startsWith('cue:') && this.clickCue) this.finishClickCueData();
        const parts = key.split(':');
        if (parts[0] === 'page') {
          const k = parts[1];
          this.pg[k] = value;
          return;
        }
        if (parts[0] === 'clip') {
          const c = this.clip;
          if (c)
            c[parts[1]] =
              parts[1] === 'duration' ? Math.max(0.1, +value || 0.1) : value;
          return;
        }
        if (parts[0] === 'override') {
          const c = this.p.captions.find((c) => c.id === this.cueId),
            k = parts[1];
          if (c) {
            c.style ||= {};
            if (value) c.style[k] = M.captionStyle(this.p, c)[k];
            else delete c.style[k];
          }
          return;
        }
        if (parts[0] === 'cueStyle' || parts[0] === 'caption') {
          const k = parts[1],
            c = this.p.captions.find((c) => c.id === this.cueId);
          const targets = parts[0] === 'caption' ? this.captionEditTargets() : c ? [c.style ||= {}] : [];
          const patch = M.cleanCaptionStyle({
            [k]: k === 'size' ? +value / this.p.height
              : ['x', 'y', 'w', 'h'].includes(k) ? +value / 100 : value,
          }, true);
          for (const target of targets) Object.assign(target, patch);
          // Automatic saving: personal overrides of the edited property no longer hide it.
          if (parts[0] === 'caption' && this.autoStyle() && this.captionScope() !== 'individual')
            for (const cue of this.captionScopeCues())
              for (const key of Object.keys(patch)) if (cue.style) delete cue.style[key];
          if (k === 'font') this.ensureFont(value);
          return;
        }
        if (parts[0] === 'draft') {
          const c = this.p.captionDrafts.find((c) => c.id === parts[1]);
          if (c) {
            c.text = String(value).slice(0, 5000);
            const active = this.clickCue;
            if (active && active.timingKey === c.timingKey)
              active.text = c.text;
          }
          return;
        }
        if (parts[0] === 'cue') {
          const c = this.p.captions.find((c) => c.id === parts[1]),
            k = parts[2];
          if (c) {
            c[k] = k === 'text' ? value : Math.max(0, +value || 0);
            if (c.end <= c.start) c.end = c.start + 0.1;
          }
          return;
        }
        if (!this.it) return;
        const it = this.it;
        if (
          [
            'text',
            'font',
            'align',
            'color',
            'color2',
            'stroke',
            'shadowColor',
            'panelColor',
            'imageTintColor',
            'enter',
            'exit',
            'fit',
            'effect',
            'textStyle',
          ].includes(key)
        )
          it[key] = value;
        else if (['italic', 'gradient', 'panel', 'locked', 'imageTint'].includes(key))
          it[key] = value;
        else if (key === 'size') it.size = +value / this.p.height;
        else if (['x', 'y', 'w', 'h', 'opacity'].includes(key))
          it[key] = +value / 100;
        else it[key] = +value;
        if (key === 'imageTintColor' && it.type === 'image') {
          it.imageTint = true;
          const toggle = this.inspector.querySelector('[data-prop=imageTint]');
          if (toggle) toggle.checked = true;
        }
        const limits = {
          x: [-2, 2],
          y: [-2, 2],
          w: [0.005, 3],
          h: [0.005, 3],
          size: [0.005, 1],
          opacity: [0, 1],
          lineHeight: [0.7, 3],
          tracking: [-5, 30],
          strokeWidth: [0, 20],
          shadow: [0, 80],
          panelOpacity: [0, 1],
          rotation: [-360, 360],
          delay: [0, 3600],
          animDuration: [0.05, 10],
          effectAmount: [0, 1],
        };
        if (limits[key]) it[key] = M.clamp(it[key], ...limits[key]);
        if (key === 'font') this.ensureFont(value);
      };
      if (previewElement) this.previewProperty(previewElement, key, apply);
      else this.commit(apply);
      this.updateInspectorVisibility();
    }
    renderState() {
      this.root.querySelector('.md-state').textContent = this.dirty
        ? t('unsaved')
        : t('saved');
      this.root.querySelector('.md-state').title =
        this.source || t('projectFileHint');
      this.root.querySelector('[data-action=save]').title =
        t('save') + ' — ' + (this.source || t('saveFirstHint'));
      this.projects?.controls();
      this.root.querySelector('[data-name]').value = this.p.name;
      this.root.querySelector('[data-action=undo]').disabled =
        !this.undo.length;
      this.root.querySelector('[data-action=redo]').disabled =
        !this.redo.length;
    }
    renderPanels() {
      if (this.dead) return;
      this.renderState();
      const dimensions = this.root.querySelector('.md-document-size');
      dimensions.textContent = `${this.p.width} × ${this.p.height} px`;
      dimensions.title = t('documentSize');
      dimensions.setAttribute(
        'aria-label',
        `${t('documentSize')}: ${dimensions.textContent}`,
      );
      this.renderPages();
      this.renderInspector();
      this.root.querySelector('.md-bottom').hidden = this.mode === 'design';
      this.renderTimeline();
      for (const k of ['design', 'video', 'subtitles'])
        this.root
          .querySelector(`[data-action=mode-${k}]`)
          .setAttribute('aria-pressed', String(this.mode === k));
      this.root.querySelector('.md-help').textContent = t(
        this.mode === 'design'
          ? 'designHint'
          : this.mode === 'subtitles'
            ? 'subtitleTimelineHint'
            : 'videoHint',
      );
      this.root.querySelector('.md-tools').hidden = this.mode !== 'design';
    }
    pageName(pg) {
      return pg.name || `${t('page')} ${this.p.pages.indexOf(pg) + 1}`;
    }
    closeDraftMenu() {
      this.draftMenuEvents?.abort();
      this.draftMenuEvents = null;
      this.draftMenu?.remove();
      this.draftMenu = null;
    }
    showDraftMenu(card, x, y) {
      this.closeDraftMenu();
      if (this.exporting || this.recording) return;
      const id = card.dataset.draft;
      const menu = document.createElement('div');
      menu.className = 'md-draft-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', t('subtitleText'));
      menu.innerHTML =
        btn('draft-edit-' + id, 'editSubtitle', 'role="menuitem"') +
        btn('draft-delete-' + id, 'delete', 'role="menuitem"');
      this.root.appendChild(menu);
      this.draftMenu = menu;
      const bounds = this.root.getBoundingClientRect(),
        r = menu.getBoundingClientRect();
      menu.style.left =
        Math.max(4, Math.min(x - bounds.left, bounds.width - r.width - 4)) +
        'px';
      menu.style.top =
        Math.max(4, Math.min(y - bounds.top, bounds.height - r.height - 4)) +
        'px';
      const events = new AbortController();
      this.draftMenuEvents = events;
      const options = { signal: events.signal, capture: true };
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (!menu.contains(e.target)) this.closeDraftMenu();
        },
        options,
      );
      document.addEventListener('scroll', () => this.closeDraftMenu(), options);
      window.addEventListener('resize', () => this.closeDraftMenu(), {
        signal: events.signal,
      });
      window.addEventListener('blur', () => this.closeDraftMenu(), {
        signal: events.signal,
      });
      menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      menu.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const buttons = [...menu.querySelectorAll('button')],
          current = buttons.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') {
          this.closeDraftMenu();
          card.querySelector('button')?.focus();
          if (e.key === 'Escape') e.preventDefault();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          buttons[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (current +
                    (e.key === 'ArrowDown' ? 1 : -1) +
                    buttons.length) %
                  buttons.length
          ].focus();
        }
      });
      menu.querySelector('button').focus({ preventScroll: true });
    }
    renamePage(id) {
      this.finishPropertyEdit();
      const pg = this.p.pages.find((p) => p.id === id);
      if (!pg) return;
      const box = this.modal(
        'renamePage',
        `<label class="md-field"><span>${esc(t('name'))}</span><input data-page-name type="text" maxlength="120" required value="${esc(this.pageName(pg))}"></label>`,
        () => {
          const input = box.querySelector('[data-page-name]');
          const name = input.value.trim();
          if (!name) {
            input.value = '';
            input.reportValidity();
            return false;
          }
          if (name !== pg.name)
            this.commit(() => {
              const page = this.p.pages.find((p) => p.id === id);
              if (page) page.name = name;
            });
        },
      );
      box.querySelector('[data-page-name]').select();
      box.querySelector('[data-page-name]').onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          box.querySelector('[data-apply]').click();
        }
      };
    }
    renderPages() {
      this.closeDraftMenu();
      this.pages.classList.toggle('md-library', this.mode === 'subtitles');
      if (this.mode === 'subtitles') {
        this.pages.innerHTML = `<strong>${esc(t('unplaced'))}</strong><div class="md-row">${btn('add-cue', 'addCue')}${btn('paste-lyrics', 'pasteLyrics')}</div>${this.p.captionText ? `<div class="md-row">${btn('open-lyrics', 'openSubtitleText')}</div>` : ''}<p class="md-note">${esc(t('draftHint'))}</p>${(this.p.captionDrafts || []).map((c) => `<div class="md-draft ${c.timingKey ? 'md-timing' : ''}" data-draft="${esc(c.id)}"><span class="md-draft-grip" draggable="true" aria-hidden="true" title="${esc(t('draftHint'))}">⠿</span><button type="button" class="md-draft-text" aria-pressed="${!!c.timingKey}" data-action="draft-place-${esc(c.id)}" title="${esc(c.text)}">${esc(c.text)}</button></div>`).join('')}<div class="md-row">${btn('import-srt', 'importSrt')}${btn('export-srt', 'exportSrt')}</div>`;
        return;
      }
      this.pages.innerHTML = `<strong>${esc(t('pages'))}</strong>${this.p.pages.map((pg) => `<div class="md-page-entry"><button class="md-page ${pg.id === this.pageId ? 'md-selected' : ''}" data-page="${esc(pg.id)}" title="${esc(this.pageName(pg))}"><canvas width="240" height="${Math.round((240 * this.p.height) / this.p.width)}"></canvas><span>${esc(this.pageName(pg))}</span></button>${btn('rename-page-' + pg.id, 'renamePage')}</div>`).join('')}<div class="md-row">${btn('add-page', 'addPage')}</div><div class="md-row">${btn('duplicate-page', 'duplicate')}${btn('delete-page', 'delete', this.p.pages.length < 2 ? 'disabled' : '')}</div><div class="md-row">${btn('page-up', 'up')}${btn('page-down', 'down')}</div>`;
      this.pages.querySelectorAll('[data-page]').forEach((el) =>
        R.page(
          el.querySelector('canvas').getContext('2d'),
          this.p,
          this.p.pages.find((p) => p.id === el.dataset.page),
          el.querySelector('canvas').width,
          el.querySelector('canvas').height,
        ),
      );
    }
    fontOptions() {
      return [
        ['sans-serif', t('sans')],
        ['serif', t('serif')],
        ['monospace', t('mono')],
        ...this.fonts.map((f) => [f.family, f.family]),
      ];
    }
    renderInspector() {
      this.renderInspectorContent();
      const context =
        this.mode === 'design' ? this.it?.type || 'page' : this.mode;
      this.inspectorTabs ||= {};
      const nodes = [...this.inspector.childNodes];
      const header = document.createElement('div');
      header.className = 'md-inspector-header';
      const tabs = document.createElement('div');
      tabs.className = 'md-inspector-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', t('settings'));
      const panels = [];
      let panel;
      for (const node of nodes) {
        if (
          node.nodeType === 1 &&
          node.hasAttribute('data-inspector-section')
        ) {
          panel = document.createElement('section');
          panel.className = 'md-inspector-panel';
          panel.dataset.panel = node.dataset.inspectorSection;
          panel.setAttribute('role', 'tabpanel');
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.setAttribute('role', 'tab');
          tab.textContent = t(node.dataset.sectionLabel);
          tab.dataset.inspectorTab = panel.dataset.panel;
          const prefix = `md-${this.inspectorId}-${context}-${panel.dataset.panel}`;
          tab.id = prefix + '-tab';
          panel.id = prefix + '-panel';
          tab.setAttribute('aria-controls', panel.id);
          panel.setAttribute('aria-labelledby', tab.id);
          tab.onclick = () => {
            this.finishPropertyEdit();
            this.inspectorTabs[context] = panelKey(tab);
            activate(panelKey(tab));
          };
          tabs.append(tab);
          panels.push(panel);
          node.remove();
        } else (panel || header).append(node);
      }
      const panelKey = (tab) => tab.dataset.inspectorTab;
      const activate = (key) => {
        for (const p of panels) p.hidden = p.dataset.panel !== key;
        for (const tab of tabs.children) {
          const active = panelKey(tab) === key;
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
        }
        this.inspector.scrollTop = 0;
        this.drawStylePreviews();
        this.drawLayerPreviews();
      };
      tabs.onkeydown = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...tabs.children];
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const next =
          buttons[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                  buttons.length
          ];
        next.click();
        next.focus();
      };
      this.inspector.replaceChildren(header, tabs, ...panels);
      this.updateInspectorVisibility();
      const active = this.inspectorTabs[context];
      activate(
        panels.some((p) => p.dataset.panel === active)
          ? active
          : panels[0]?.dataset.panel,
      );
    }
    updateInspectorVisibility() {
      const show = (key, visible) => {
        const input = this.inspector.querySelector(`[data-prop="${key}"]`);
        const row = input?.closest('.md-override, .md-caption-mixed-field') || input?.closest('.md-field');
        if (row) row.hidden = !visible;
      };
      const captions = this.mode === 'subtitles';
      const cue = this.p.captions.find(c => c.id === this.cueId);
      const individual = captions && this.styleScope === 'individual' && cue;
      const styles = captions
        ? individual ? [M.captionStyle(this.p, cue)] : this.captionEditTargets()
        : this.mode === 'design' && this.it ? [this.it] : [];
      const prefix = captions ? individual ? 'cueStyle:' : 'caption:' : '';
      const any = predicate => styles.some(predicate);
      // Keep a dependent field available if any of the styles being edited uses it.
      const secondaryEffects = ['extrude', 'retro', 'echo', 'glitch', 'chromatic', 'emboss', 'splice', 'double', 'neon', 'metal', 'striped'];
      const ownFillEffects = ['hollow', 'metal', 'striped'];
      show(prefix + 'highlight', any(s => s.preset === 'karaoke' || (s.preset === 'glow' && !s.shadow)));
      show(prefix + 'color2', any(s => secondaryEffects.includes(s.effect) || (s.gradient && !ownFillEffects.includes(s.effect))));
      show(prefix + 'gradient', any(s => !ownFillEffects.includes(s.effect)));
      show(prefix + 'effectAmount', any(s => (s.effect && s.effect !== 'none') || s.shadow > 0 || (captions && s.preset === 'glow')));
      show(prefix + 'stroke', any(s => (s.strokeWidth > 0 && s.effect !== 'hollow') || s.effect === 'retro'));
      show(prefix + 'shadowColor', any(s => s.shadow > 0 && s.effect !== 'hollow'));
      show(prefix + 'panelColor', any(s => s.panel || (captions && s.preset === 'box')));
      show(prefix + 'panelOpacity', any(s => s.panel || (captions && s.preset === 'box')));
      show(prefix + 'animDuration', any(s => (s.enter && s.enter !== 'none') || (s.exit && s.exit !== 'none')));
      show('imageTintColor', any(s => s.imageTint));
      show('page:bg2', !!this.pg.gradient);
    }
    reorderLayer(action) {
      const item = this.it, items = this.pg.items;
      if (!item || item.locked) return;
      const index = items.indexOf(item);
      const next = action === 'front' ? items.length - 1
        : action === 'back' ? 0
        : Math.max(0, Math.min(items.length - 1, index + (action === 'raise-layer' ? 1 : -1)));
      if (index === next) return;
      this.commit(() => {
        items.splice(index, 1);
        items.splice(next, 0, item);
      });
    }
    layersPanel() {
      const index = this.pg.items.indexOf(this.it);
      const movable = !!this.it && !this.it.locked;
      const control = (action, label, symbol, disabled) =>
        `<button type="button" data-action="${action}" ${disabled ? 'disabled' : ''}><span aria-hidden="true">${symbol}</span> ${esc(t(label))}</button>`;
      return `<p class="md-note">${esc(t('layerOrderHint'))}</p><div class="md-layer-order">${control('raise-layer', 'bringForward', '↑', !movable || index === this.pg.items.length - 1)}${control('lower-layer', 'sendBackward', '↓', !movable || index <= 0)}${control('front', 'front', '⇈', !movable || index === this.pg.items.length - 1)}${control('back', 'back', '⇊', !movable || index <= 0)}</div><div class="md-layer-list">${this.pg.items.slice().reverse().map(item => {
        const name = item.type === 'image' ? this.p.assets[item.assetId]?.name || t('image')
          : item.type === 'text' ? item.text || t('text') : t(item.shape || 'shape');
        return `<div class="md-layer-line ${item.hidden ? 'md-layer-off' : ''}"><button type="button" class="md-layer-row" data-action="layer-${esc(item.id)}" aria-pressed="${item.id === this.itemId}" title="${esc(name)}"><canvas width="144" height="104" data-layer-preview="${esc(item.id)}" aria-hidden="true"></canvas><span><strong>${esc(name)}</strong><small>${esc(t(item.type))}${item.locked ? ' 🔒' : ''}${item.hidden ? ' · ' + esc(t('layerHidden')) : ''}</small></span></button><button type="button" class="md-layer-eye" data-action="toggle-layer-${esc(item.id)}" aria-pressed="${!item.hidden}" aria-label="${esc(t(item.hidden ? 'showLayer' : 'hideLayer'))}" title="${esc(t(item.hidden ? 'showLayer' : 'hideLayer'))}">${item.hidden ? '🚫' : '👁'}</button></div>`;
      }).join('') || `<p class="md-note">${esc(t('noLayers'))}</p>`}</div>`;
    }
    drawLayerPreviews() {
      this.inspector.querySelectorAll('[data-layer-preview]').forEach(canvas => {
        const item = this.pg.items.find(item => item.id === canvas.dataset.layerPreview);
        if (item) R.itemPreview(canvas.getContext('2d'), this.p, item, canvas.width, canvas.height);
      });
    }
    renderInspectorContent() {
      this.finishPropertyEdit();
      if (this.mode === 'subtitles') {
        this.renderCaptions();
        return;
      }
      if (this.mode === 'video') {
        const c = this.clip,
          pg = this.p.pages.find((pg) => pg.id === c?.pageId);
        this.inspector.innerHTML = `<h3>${esc(t('video'))}</h3>${section('sequence')}<p class="md-note">${esc(t('reuseHint'))}</p>${btn('add-occurrence', 'usePage')}<div class="md-row">${btn('repeat', 'repeat', this.clipIds.length ? '' : 'disabled')}${btn('delete-clip', 'delete', c ? '' : 'disabled')}</div><div class="md-row">${btn('clip-left', 'left', c ? '' : 'disabled')}${btn('clip-right', 'right', c ? '' : 'disabled')}</div>${
          c
            ? `<h3>${esc(this.pageName(pg))}</h3>${select(
                'clip:pageId',
                'page',
                c.pageId,
                this.p.pages.map((pg) => [pg.id, this.pageName(pg)]),
              )}${field('clip:duration', 'duration', c.duration.toFixed(2), 'number', 'min="0.1" step="0.1"')}${select('clip:transition', 'transition', c.transition, ['cut', 'fade'])}`
            : ''
        }${section('audio')}<p class="md-note">${esc(this.p.audio?.name || t('noAudio'))}</p>${btn('audio', 'chooseAudio')}${this.p.audio ? `<div class="md-row">${btn('fit-music', 'fitMusic')}${btn('remove-audio', 'remove')}</div>` : ''}<p class="md-note">${esc(t('timingHint'))}</p>`;
        return;
      }
      const it = this.it;
      if (!it) {
        this.inspector.innerHTML = `<h3>${esc(t('page'))}</h3>${section('background')}${field('page:name', 'name', this.pg.name, 'text')}${field('page:bg', 'background', this.pg.bg, 'color')}${field('page:gradient', 'gradient', this.pg.gradient, 'checkbox')}${field('page:bg2', 'secondColor', this.pg.bg2, 'color')}<p class="md-note">${esc(t('fontHint'))}</p>${section('layers')}${this.layersPanel()}`;
        return;
      }
      let html = `<h3>${esc(t(it.type))}</h3><div class="md-row">${btn('duplicate-item', 'duplicate')}${btn('delete-item', 'delete', it.locked ? 'disabled' : '')}</div>${it.type === 'shape' ? '' : section('content', it.type === 'text' ? 'text' : 'image')}`;
      if (it.type === 'text')
        html += `<textarea data-prop="text" aria-label="${esc(t('text'))}">${esc(it.text)}</textarea>${select('font', 'font', it.font, this.fontOptions())}${field('size', 'fontSize', +(it.size * this.p.height).toFixed(2), 'number', `min="${this.p.height * 0.005}" max="${this.p.height}" step="1"`)}${select(
          'weight',
          'weight',
          it.weight,
          [
            [400, t('normal')],
            [700, t('bold')],
            [900, t('heavy')],
          ],
        )}${field('italic', 'italic', it.italic, 'checkbox')}${select('align', 'align', it.align, ['left', 'center', 'right'])}${field('lineHeight', 'lineHeight', it.lineHeight, 'number', 'min="0.7" max="3" step=".05"')}${field('tracking', 'tracking', it.tracking, 'number', 'min="-5" max="30" step=".5"')}${section('style')}<h3>${esc(t('textStyles'))}</h3><div class="md-presets">${this.styleGallery()}</div>`;
      if (it.type === 'text')
        html += `${select(
          'effect',
          'textEffect',
          it.effect,
          M.textEffects.map((k) => [k, t('effect_' + k)]),
        )}${field('effectAmount', 'effectAmount', it.effectAmount, 'range', 'min="0" max="1" step=".01"')}`;
      if (it.type === 'image')
        html +=
          select('fit', 'imageFit', it.fit, ['cover', 'contain']) +
          btn('fill-page', 'fillPage') +
          `${section('style')}${field('imageTint', 'recolorImage', it.imageTint, 'checkbox')}${field('imageTintColor', 'imageColor', it.imageTintColor || '#ffffff', 'color')}<div class="md-row">${btn('image-white', 'whiteImage')}${btn('image-black', 'blackImage')}${btn('image-original', 'originalImage')}</div><p class="md-note">${esc(t('imageColorHint'))}</p>`;
      if (it.type === 'shape') html += section('style');
      if (it.type !== 'image')
        html += `${field('color', 'color', it.color, 'color')}${field('gradient', 'gradient', it.gradient, 'checkbox')}${field('color2', 'secondColor', it.color2, 'color')}${field('strokeWidth', 'outlineWidth', it.strokeWidth, 'number', 'min="0" max="20" step=".5"')}${field('stroke', 'outlineColor', it.stroke, 'color')}${field('shadow', 'shadow', it.shadow, 'number', 'min="0" max="80"')}${field('shadowColor', 'shadowColor', it.shadowColor, 'color')}`;
      if (it.type === 'text')
        html += `${field('panel', 'textPanel', it.panel, 'checkbox')}${field('panelColor', 'panelColor', it.panelColor, 'color')}${field('panelOpacity', 'panelOpacity', it.panelOpacity, 'number', 'min="0" max="1" step=".05"')}`;
      html += `${section('position')}${['x', 'y', 'w', 'h'].map((k) => field(k, k, +(it[k] * 100).toFixed(2), 'number', `step="1" ${['w', 'h'].includes(k) ? 'min="0.5" max="300"' : 'min="-200" max="200"'}`)).join('')}${field('rotation', 'rotation', it.rotation, 'number', 'min="-360" max="360"')}${field('opacity', 'opacity', Math.round(it.opacity * 100), 'number', 'min="0" max="100"')}${field('locked', 'locked', it.locked, 'checkbox')}<div class="md-row">${btn('front', 'front')}${btn('back', 'back')}${btn('center', 'center')}</div>${section('animation')}${select('enter', 'enter', it.enter, it.type === 'text' ? M.animations : M.animations.filter((v) => !['typewriter', 'words'].includes(v)))}${select(
        'exit',
        'exit',
        it.exit,
        M.animations.filter((v) => !['typewriter', 'words'].includes(v)),
      )}${field('delay', 'delay', it.delay, 'number', 'min="0" step=".1"')}${field('animDuration', 'animationDuration', it.animDuration, 'number', 'min=".05" max="10" step=".1"')}<p class="md-note">${esc(t('animationHint'))}</p>${section('layers')}${this.layersPanel()}`;
      this.inspector.innerHTML = html;
      this.drawStylePreviews();
      this.drawLayerPreviews();
    }
    renderCaptions() {
      if (!this.p.captions.some((c) => c.id === this.cueId)) {
        const nextId = this.p.captions[0]?.id || null;
        if (this.cueId !== nextId && this.cueId) this.styleScope = null;
        this.cueId = nextId;
      }
      const cue = this.p.captions.find((c) => c.id === this.cueId);
      if (!this.styleScope) this.styleScope = this.defaultCaptionScope(cue);
      const edit = cue
        ? `<div class="md-cue md-selected" data-cue-card="${esc(cue.id)}"><textarea data-prop="cue:${esc(cue.id)}:text" aria-label="${esc(t('text'))}">${esc(cue.text)}</textarea>${field('cue:' + cue.id + ':start', 'start', cue.start.toFixed(3), 'number', 'min="0" step=".001"')}${field('cue:' + cue.id + ':end', 'end', cue.end.toFixed(3), 'number', 'min="0" step=".001"')}<div class="md-row">${btn('cue-start', 'startHere')}${btn('cue-end', 'endHere')}</div><div class="md-row">${btn('cue-play', 'playSubtitle')}${btn('cue-delete-' + cue.id, 'delete')}</div></div>`
        : '';
      this.inspector.innerHTML = `<h3>${esc(t('subtitles'))}</h3>${btn('time-captions', 'timeCaptions')}<div class="md-row">${btn('cue-previous', 'previousSubtitle', cue ? '' : 'disabled')}${btn('cue-next', 'nextSubtitle', cue ? '' : 'disabled')}</div>${select(
        'styleScope',
        'applyTo',
        this.captionScope(),
        [
          ['all', t('allCaptionStyles')],
          ['global', t('allSubtitles')],
          ['individual', t('thisSubtitle')],
          ...(this.p.captionStyles || []).map((s) => ['saved:' + s.id, s.name]),
        ],
      )}<div class="md-field-info">${field('captionAutoStyle', 'captionAutoStyle', this.autoStyle(), 'checkbox')}<button type="button" class="md-icon" data-action="auto-style-info" aria-label="${esc(t('info'))}" title="${esc(t('info'))}">ⓘ</button></div><p class="md-note">${esc(t(this.captionScope() === 'all' ? 'allCaptionStylesHint' : this.styleScope === 'individual' && cue ? 'captionInheritanceHint' : this.captionScope().startsWith('saved:') ? 'savedStyleEditHint' : 'globalHint'))}</p>${this.styleScope === 'individual' && cue ? btn('reset-cue-style', 'resetStyle') : ''}${cue ? select('cueStyleId', 'subtitleStyle', cue.styleId || '', [['', t('globalStyle')], ...(this.p.captionStyles || []).map((s) => [s.id, s.name])]) : ''}<div class="md-caption-style-actions">${this.captionScope() === 'all' ? '' : btn('save-caption-style', 'saveCaptionStyle')}${btn('apply-caption-styles', 'applyCaptionStyles')}</div>${section('content', 'text')}${edit}${cue ? btn('cue-unplace', 'unplace') : ''}${this.captionAppearance(cue)}${section('onTimeline')}<div class="md-caption-list">${this.p.captions.map((c) => `<button class="md-cue-link ${c.id === this.cueId ? 'md-selected' : ''}" data-action="cue-select-${esc(c.id)}" data-cue-card="${esc(c.id)}"><span>${esc(c.text)}</span><small>${clock(c.start)}–${clock(c.end)}</small></button>`).join('')}</div>`;
      this.drawStylePreviews();
      this.drawLayerPreviews();
    }
    timelineLength() {
      return Math.max(
        M.duration(this.p),
        this.p.audio?.duration || 0,
        ...this.p.captions.map((c) => c.end),
        0.1,
      );
    }
    renderTimeline() {
      if (this.cueDrag) return;
      const length = this.timelineLength();
      this.timelineScale = Math.max(
        this.pps,
        (this.timeline.clientWidth - 32) / length,
      );
      const scale = this.timelineScale,
        width = length * scale;
      this.track.style.width = width + 'px';
      this.track.querySelector('.md-clips').innerHTML = M.schedule(this.p)
        .map(
          (c) =>
            `<button class="md-clip ${this.clipIds.includes(c.id) ? 'md-selected' : ''}" data-clip="${esc(c.id)}" style="width:${c.duration * scale}px" title="${esc(this.pageName(this.p.pages.find((pg) => pg.id === c.pageId)))} · ${clock(c.start)}–${clock(c.end)}"><span class="md-clip-strip" aria-hidden="true"></span><strong>${esc(this.pageName(this.p.pages.find((pg) => pg.id === c.pageId)))}</strong><small>${clock(c.start)} · ${c.duration.toFixed(1)}s</small></button>`,
        )
        .join('');
      this.drawTimelinePreviews();
      const ruler = this.track.querySelector('.md-time-ticks');
      ruler.innerHTML =
        Array.from({ length: Math.max(2, Math.ceil(width / 100)) }, (_, i) => {
          const time = (i * 100) / scale;
          return `<span style="left:${time * scale}px">${clock(time)}</span>`;
        }).join('') + '<i class="md-ruler-playhead" aria-hidden="true"></i>';
      this.renderCueTrack();
      const wave = this.track.querySelector('.md-wave');
      wave.width = Math.max(1, Math.min(16000, Math.ceil(width)));
      wave.height = 28;
      const ctx = wave.getContext('2d');
      ctx.fillStyle = '#8888b5';
      const peakMaximum = this.peaks
        ? Math.max(
            0.01,
            this.peaks.reduce((max, value) => Math.max(max, value), 0),
          )
        : 1;
      if (this.peaks && this.p.audio) {
        for (let x = 0; x < wave.width; x++) {
          const a = Math.floor(
            (((x / wave.width) * length) / this.p.audio.duration) *
              this.peaks.length,
          );
          const b = Math.max(
            a + 1,
            Math.floor(
              ((((x + 1) / wave.width) * length) / this.p.audio.duration) *
                this.peaks.length,
            ),
          );
          let peak = 0;
          for (let i = a; i < b && i < this.peaks.length; i++)
            peak = Math.max(peak, this.peaks[i] || 0);
          peak = Math.min(1, peak / peakMaximum);
          ctx.fillRect(x, 14 - peak * 12, 1, Math.max(1, peak * 24));
        }
      }
      for (const node of this.track.querySelectorAll('.md-track-label'))
        node.textContent = t(node.dataset.trackLabel);
      this.updateTransport();
    }
    drawTimelinePreviews() {
      const samples = new Map();
      const schedule = new Map(M.schedule(this.p).map(clip => [clip.id, clip]));
      for (const button of this.track.querySelectorAll('[data-clip]')) {
        const clip = schedule.get(button.dataset.clip);
        const page = this.p.pages.find(page => page.id === clip?.pageId);
        if (!page) continue;
        if (!samples.has(page.id)) {
          const canvas = document.createElement('canvas');
          canvas.height = 104;
          canvas.width = Math.max(16, Math.min(1200, Math.round(104 * this.p.width / this.p.height)));
          R.page(canvas.getContext('2d'), this.p, page, canvas.width, canvas.height);
          samples.set(page.id, canvas.toDataURL('image/webp', 0.8));
        }
        const strip = button.querySelector('.md-clip-strip');
        if (strip) strip.style.backgroundImage = `url("${samples.get(page.id)}")`;
      }
    }
    renderCueTrack() {
      const track = this.track.querySelector('.md-subtitle-track'),
        groups = M.captionTracks(this.p),
        scale = this.timelineScale || this.pps;
      track.innerHTML = groups.length
        ? groups
            .map((group) => {
              const name = group.name || t('globalStyle'),
                height = (Math.max(...group.cues.map((c) => c.lane)) + 1) * 34;
              return `<section class="md-caption-track" data-caption-track="${esc(group.styleId)}" role="group" aria-label="${esc(name)}"><div class="md-caption-track-heading"><span>${esc(name)}</span><small>${group.cues.length}</small></div><div class="md-caption-track-lanes" style="height:${height}px">${group.cues
                .map(
                  (c) =>
                    `<div class="md-cue-block ${c.id === this.cueId ? 'md-selected' : ''}" data-cue-block="${esc(c.id)}" role="button" tabindex="0" aria-label="${esc(c.text)} · ${clock(c.start)}–${clock(c.end)}" style="left:${c.start * scale}px;width:${Math.max(2, (c.end - c.start) * scale)}px;top:${c.lane * 34}px"><span class="md-cue-handle" data-edge="start" role="button" tabindex="0" aria-label="${esc(t('trimStart'))}"></span><span class="md-cue-text">${esc(c.text)}</span><small>${clock(c.start)}–${clock(c.end)}</small><span class="md-cue-handle" data-edge="end" role="button" tabindex="0" aria-label="${esc(t('trimEnd'))}"></span></div>`,
                )
                .join('')}</div></section>`;
            })
            .join('')
        : `<span class="md-track-empty">${esc(t('subtitleTrackEmpty'))}</span>`;
    }
    get clickCue() {
      return this.p.captions.find(
        (c) =>
          c.timingKey &&
          this.p.captionDrafts.some((d) => d.timingKey === c.timingKey),
      );
    }
    finishClickCueData(end = this.time) {
      const cue = this.clickCue;
      if (!cue) return;
      cue.end = Math.max(cue.start + 0.1, end);
      const key = cue.timingKey;
      delete cue.timingKey;
      this.p.captionDrafts = this.p.captionDrafts.filter(
        (d) => d.timingKey !== key,
      );
    }
    finishClickCue() {
      if (this.clickCue) this.commit(() => this.finishClickCueData(), true);
    }
    toggleDraftTiming(id) {
      if (this.exporting || this.recording || this.cueDrag) return;
      const draft = this.p.captionDrafts.find((d) => d.id === id);
      if (!draft) return;
      // Sample the media clock at the click, without pausing or seeking the audio.
      if (this.playing && this.p.audio && !this.audio.paused)
        this.time = this.audio.currentTime;
      const same =
        this.clickCue?.timingKey && this.clickCue.timingKey === draft.timingKey;
      this.commit(() => {
        this.finishClickCueData();
        if (!same) {
          const key = M.uid(),
            cue = {
              id: M.uid(),
              start: this.time,
              end: this.time + 0.1,
              text: draft.text,
              style: M.clone(draft.style || {}),
              styleId: draft.styleId,
              timingKey: key,
            };
          draft.timingKey = key;
          this.p.captions.push(cue);
          this.cueId = cue.id;
        }
        this.mode = 'subtitles';
        this.playCueEnd = null;
      }, true);
    }
    clickPreviewProject() {
      const cue = this.clickCue;
      if (!cue) return this.p;
      return {
        ...this.p,
        captions: this.p.captions.map((c) =>
          c === cue
            ? {
                ...c,
                end: Math.max(
                  this.timelineLength(),
                  this.time + 10,
                  c.start + 10,
                ),
              }
            : c,
        ),
      };
    }
    updateClickCue() {
      const cue = this.clickCue;
      if (!cue) return;
      cue.end = Math.max(cue.start + 0.1, this.time + 0.04);
      const block = [...this.track.querySelectorAll('[data-cue-block]')].find(
        (el) => el.dataset.cueBlock === cue.id,
      );
      if (block) {
        block.style.width =
          Math.max(
            2,
            (cue.end - cue.start) * (this.timelineScale || this.pps),
          ) + 'px';
        block.querySelector('small').textContent =
          `${clock(cue.start)}–${clock(this.time)}`;
      }
      const input = this.inspector.querySelector(
        `[data-prop="cue:${CSS.escape(cue.id)}:end"]`,
      );
      if (input && document.activeElement !== input)
        input.value = cue.end.toFixed(3);
    }
    placeDraft(id, start) {
      if (this.exporting || this.recording) return;
      this.commit(() => {
        const c = (this.p.captionDrafts || []).find((c) => c.id === id);
        if (!c) return;
        if (c.timingKey && this.clickCue?.timingKey === c.timingKey) {
          const cue = this.clickCue;
          this.finishClickCueData();
          cue.start = start;
          cue.end = start + 3;
          this.cueId = cue.id;
          return;
        }
        this.p.captions.push({ ...c, start, end: start + 3 });
        this.p.captionDrafts = this.p.captionDrafts.filter((c) => c.id !== id);
        this.cueId = id;
      });
      this.selectCue(
        this.p.captions.some((c) => c.id === id) ? id : this.cueId,
        true,
      );
    }
    captionAppearance(cue) {
      const individual = this.styleScope === 'individual' && cue;
      const style = individual
        ? M.captionStyle(this.p, cue)
        : this.captionBaseStyle();
      const prefix = individual ? 'cueStyle:' : 'caption:';
      const control = (key, html) =>
        individual
          ? `<div class="md-override"><label title="${esc(t('customValue'))}"><input type="checkbox" data-prop="override:${key}" aria-label="${esc(t('customValue') + ' · ' + t(key))}" ${Object.hasOwn(cue.style || {}, key) ? 'checked' : ''}></label>${html}</div>`
          : this.captionValueIsMixed(key)
            ? `<div class="md-caption-mixed-field">${html}<small data-caption-mixed="${key}">${esc(t('mixedCaptionValue'))}</small></div>`
            : html;
      const f = (k, label, type = 'number', extra = '') =>
        control(
          k,
          field(
            prefix + k,
            label,
            k === 'size' ? +(style.size * this.p.height).toFixed(2)
              : ['x', 'y', 'w', 'h'].includes(k)
                ? +(style[k] * 100).toFixed(2)
                : style[k],
            type,
            extra,
          ),
        );
      const sel = (k, label, options) =>
        control(k, select(prefix + k, label, style[k], options));
      return `${section('typography', 'font')}
        ${sel('font', 'font', this.fontOptions())}
        ${f('size', 'fontSize', 'number', `min="${this.p.height * 0.015}" max="${this.p.height * 0.2}" step="1"`)}
        ${sel('align', 'align', ['left', 'center', 'right'])}
        ${sel('weight', 'weight', [
          [400, t('normal')],
          [700, t('bold')],
          [900, t('heavy')],
        ])}
        ${f('italic', 'italic', 'checkbox')}${f('tracking', 'tracking', 'number', 'min="-5" max="30" step=".5"')}${f('lineHeight', 'lineHeight', 'number', 'min=".7" max="3" step=".05"')}
        ${section('style')}${sel('preset', 'style', ['custom', 'outline', 'box', 'karaoke', 'typewriter', 'glow'])}
        <h3>${esc(t('textStyles'))}</h3>${this.styleGallery(true)}
        ${sel(
          'effect',
          'textEffect',
          M.textEffects.map((k) => [k, t('effect_' + k)]),
        )}
        ${f('effectAmount', 'effectAmount', 'range', 'min="0" max="1" step=".01"')}
        ${f('color', 'color', 'color')}${f('highlight', 'highlight', 'color')}
        ${f('gradient', 'gradient', 'checkbox')}${f('color2', 'secondColor', 'color')}
        ${f('stroke', 'outlineColor', 'color')}${f('strokeWidth', 'outlineWidth', 'number', 'min="0" max="20" step=".5"')}
        ${f('shadow', 'shadow', 'number', 'min="0" max="80"')}${f('shadowColor', 'shadowColor', 'color')}
        ${f('panel', 'textPanel', 'checkbox')}${f('panelColor', 'panelColor', 'color')}${f('panelOpacity', 'panelOpacity', 'number', 'min="0" max="1" step=".05"')}
        ${section('position')}${['x', 'y', 'w', 'h'].map((k) => f(k, k, 'number', 'min="0" max="100" step=".1"')).join('')}
        ${f('opacity', 'opacity', 'number', 'min="0" max="1" step=".05"')}
        ${section('animation')}${sel('enter', 'enter', M.animations)}
        ${sel(
          'exit',
          'exit',
          M.animations.filter((v) => !['typewriter', 'words'].includes(v)),
        )}
        ${f('animDuration', 'animationDuration', 'number', 'min=".05" max="3" step=".05"')}
        <p class="md-note">${esc(t('captionHint'))}</p>`;
    }
    selectCue(id, seek = false) {
      const cue = this.p.captions.find((c) => c.id === id);
      if (!cue) return;
      this.finishPropertyEdit();
      if (!['individual', 'all'].includes(this.styleScope))
        this.styleScope = this.defaultCaptionScope(cue);
      this.cueId = id;
      this.mode = 'subtitles';
      this.renderPages();
      this.itemId = null;
      for (const k of ['design', 'video', 'subtitles'])
        this.root
          .querySelector(`[data-action=mode-${k}]`)
          .setAttribute('aria-pressed', String(k === this.mode));
      this.root.querySelector('.md-tools').hidden = true;
      this.root.querySelector('.md-bottom').hidden = false;
      this.root.querySelector('.md-help').textContent = t(
        'subtitleTimelineHint',
      );
      this.renderInspector();
      this.track
        .querySelectorAll('[data-cue-block]')
        .forEach((el) =>
          el.classList.toggle('md-selected', el.dataset.cueBlock === id),
        );
      if (seek)
        this.seek(cue.start + Math.min(0.35, (cue.end - cue.start) / 2));
      this.updateTransport();
      this.draw();
    }
    cuePointerDown(e) {
      const block = e.target.closest('[data-cue-block]');
      if (!block || e.button !== 0 || this.exporting || this.recording) return;
      this.finishClickCue();
      e.preventDefault();
      const cue = this.p.captions.find((c) => c.id === block.dataset.cueBlock);
      if (!cue) return;
      const wasPlaying = this.playing;
      this.pause();
      this.playCueEnd = null;
      this.selectCue(cue.id);
      this.cueDrag = {
        id: cue.id,
        original: { ...cue },
        before: snapshot(this.p),
        kind: e.target.dataset.edge || 'move',
        x: e.clientX,
        scale: this.timelineScale,
        scroll: this.timeline.scrollLeft,
        block,
        moved: false,
        wasPlaying,
        pointerId: e.pointerId,
        time: this.time,
      };
      this.timeline.setPointerCapture(e.pointerId);
    }
    cuePointerMove(e) {
      const drag = this.cueDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
      drag.moved = true;
      const bounds = this.timeline.getBoundingClientRect();
      if (e.clientX > bounds.right - 30) this.timeline.scrollLeft += 12;
      if (e.clientX < bounds.left + 30) this.timeline.scrollLeft -= 12;
      let delta =
        (e.clientX - drag.x + this.timeline.scrollLeft - drag.scroll) /
        drag.scale;
      const limit = Math.max(M.duration(this.p), drag.original.end);
      let next = M.retimeCue(drag.original, drag.kind, delta, limit);
      if (!e.altKey) {
        const targets = [
          0,
          M.duration(this.p),
          drag.time,
          ...M.schedule(this.p).map((c) => c.start),
          ...this.p.captions
            .filter((c) => c.id !== drag.id)
            .flatMap((c) => [c.start, c.end]),
        ];
        let nearest = 8 / drag.scale,
          correction = 0;
        const edges =
          drag.kind === 'move' ? [next.start, next.end] : [next[drag.kind]];
        for (const edge of edges)
          for (const target of targets)
            if (Math.abs(target - edge) < nearest) {
              nearest = Math.abs(target - edge);
              correction = target - edge;
            }
        delta += correction;
        next = M.retimeCue(drag.original, drag.kind, delta, limit);
      }
      next.start = Math.round(next.start * 1000) / 1000;
      next.end = Math.round(next.end * 1000) / 1000;
      const cue = this.p.captions.find((c) => c.id === drag.id);
      Object.assign(cue, next);
      drag.block.style.left = cue.start * drag.scale + 'px';
      drag.block.style.width =
        Math.max(2, (cue.end - cue.start) * drag.scale) + 'px';
      drag.block.querySelector('small').textContent =
        `${clock(cue.start)}–${clock(cue.end)}`;
      drag.block.setAttribute(
        'aria-label',
        `${cue.text} · ${clock(cue.start)}–${clock(cue.end)}`,
      );
      for (const key of ['start', 'end']) {
        const input = this.inspector.querySelector(
          `[data-prop="cue:${CSS.escape(cue.id)}:${key}"]`,
        );
        if (input) input.value = cue[key].toFixed(3);
      }
      this.seek(
        drag.kind === 'end'
          ? Math.max(cue.start, cue.end - 0.05)
          : cue.start + Math.min(0.35, (cue.end - cue.start) / 2),
      );
    }
    cuePointerUp(e, cancel = false) {
      const drag = this.cueDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      this.cueDrag = null;
      if (this.timeline.hasPointerCapture(e.pointerId))
        this.timeline.releasePointerCapture(e.pointerId);
      if (cancel) {
        this.p = drag.before;
        this.time = drag.time;
        this.renderPanels();
        this.draw();
        return;
      }
      if (drag.moved) {
        this.undo.push(drag.before);
        if (this.undo.length > 30) this.undo.shift();
        this.redo = [];
        this.changed();
      } else if (!drag.wasPlaying) this.selectCue(drag.id, true);
      if (drag.wasPlaying) this.play().catch((error) => this.error(error));
    }
    cueKey(e) {
      const block = e.target.closest('[data-cue-block]');
      if (!block) return false;
      if (
        ['ArrowLeft', 'ArrowRight'].includes(e.key) &&
        !this.recording &&
        !this.exporting
      ) {
        e.preventDefault();
        const id = block.dataset.cueBlock,
          delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01),
          kind = e.target.dataset.edge || 'move';
        this.commit(() => {
          const cue = this.p.captions.find((c) => c.id === id);
          Object.assign(
            cue,
            M.retimeCue(
              cue,
              kind,
              delta,
              Math.max(M.duration(this.p), cue.end),
            ),
          );
        });
        const target = this.track.querySelector(
          `[data-cue-block="${CSS.escape(id)}"]`,
        );
        (kind === 'move'
          ? target
          : target?.querySelector(`[data-edge="${kind}"]`)
        )?.focus();
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.selectCue(block.dataset.cueBlock, true);
        return true;
      }
      return false;
    }
    async playSelectedCue() {
      const cue = this.p.captions.find((c) => c.id === this.cueId);
      if (!cue) return;
      this.pause();
      this.seek(cue.start);
      this.playCueEnd = Math.min(cue.end, M.duration(this.p));
      await this.play();
    }
    revealTimelineTime() {
      const x = this.track.offsetLeft + this.time * (this.timelineScale || this.pps);
      const left = this.timeline.scrollLeft, width = this.timeline.clientWidth;
      const margin = Math.min(45, width / 4);
      if (x > left + width - margin) this.timeline.scrollLeft = x - width + margin;
      else if (x < left + margin) this.timeline.scrollLeft = Math.max(0, x - margin);
    }
    seekRulerAt(clientX) {
      const rect = this.timeline.getBoundingClientRect();
      const x = M.clamp(clientX, rect.left + 1, rect.right - 1);
      this.seek((x - this.track.getBoundingClientRect().left) / this.timelineScale);
    }
    startRulerScroll() {
      cancelAnimationFrame(this.rulerScrollFrame);
      let previous;
      const tick = now => {
        if (this.rulerPointer == null || this.dead) return;
        const dt = previous == null ? 1 / 60 : Math.min(0.05, (now - previous) / 1000);
        previous = now;
        const rect = this.timeline.getBoundingClientRect();
        const margin = Math.min(48, rect.width / 4);
        let speed = 0;
        if (this.rulerClientX < rect.left + margin)
          speed = -900 * Math.min(1, (rect.left + margin - this.rulerClientX) / margin);
        else if (this.rulerClientX > rect.right - margin)
          speed = 900 * Math.min(1, (this.rulerClientX - rect.right + margin) / margin);
        const left = this.timeline.scrollLeft;
        if (speed) this.timeline.scrollLeft += speed * dt;
        if (left !== this.timeline.scrollLeft) this.seekRulerAt(this.rulerClientX);
        this.rulerScrollFrame = requestAnimationFrame(tick);
      };
      this.rulerScrollFrame = requestAnimationFrame(tick);
    }
    stopRulerScroll() {
      cancelAnimationFrame(this.rulerScrollFrame);
      this.rulerScrollFrame = null;
      this.rulerPointer = null;
      this.rulerClientX = null;
    }
    updateTransport() {
      this.updateClickCue();
      const len = M.duration(this.p);
      const active = new Set(
        this.p.captions
          .filter((c) => this.time >= c.start && this.time < c.end)
          .map((c) => c.id),
      );
      for (const el of this.track.querySelectorAll('[data-cue-block]')) {
        const isActive = active.has(el.dataset.cueBlock);
        el.classList.toggle('md-active', isActive);
        el.setAttribute('aria-current', String(isActive));
      }
      for (const el of this.inspector.querySelectorAll('[data-cue-card]'))
        el.classList.toggle('md-active', active.has(el.dataset.cueCard));
      if (this.playing && !this.cueDrag && this.rulerPointer == null)
        this.revealTimelineTime();
      this.root.querySelector('[data-time]').textContent =
        `${clock(this.time)} / ${clock(len)}`;
      const scrub = this.root.querySelector('[data-scrub]');
      scrub.max = Math.max(0.1, len);
      scrub.value = this.time;
      this.track.querySelector('.md-playhead').style.left =
        this.time * (this.timelineScale || this.pps) + 'px';
      const rulerHead = this.track.querySelector('.md-ruler-playhead');
      if (rulerHead)
        rulerHead.style.left =
          this.time * (this.timelineScale || this.pps) + 'px';
      updateButton(
        this.root.querySelector('[data-action=play]'),
        this.playing ? 'pause' : 'play',
      );
      for (const key of ['next', 'finish-timing', 'cancel-timing'])
        this.root.querySelector(`[data-action=${key}]`).hidden =
          !this.recording;
      updateButton(
        this.root.querySelector('[data-action=next]'),
        this.recording?.kind === 'captions' ? 'nextSubtitle' : 'next',
      );
      this.root
        .querySelector('[data-action=time-music]')
        .classList.toggle('md-record', !!this.recording);
      this.drawVideoPreview();
    }
    draw() {
      if (this.dead) return;
      const box = this.stage.getBoundingClientRect(),
        scale = Math.max(
          0.01,
          Math.min(
            (box.width - 40) / this.p.width,
            (box.height - 40) / this.p.height,
          ),
        ),
        dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.style.width = Math.round(this.p.width * scale) + 'px';
      this.canvas.style.height = Math.round(this.p.height * scale) + 'px';
      const W = Math.max(1, Math.round(this.p.width * scale * dpr)),
        H = Math.max(1, Math.round(this.p.height * scale * dpr));
      if (this.canvas.width !== W) this.canvas.width = W;
      if (this.canvas.height !== H) this.canvas.height = H;
      const ctx = this.canvas.getContext('2d');
      if (this.mode === 'design') {
        R.page(ctx, this.p, this.pg, W, H);
        const it = this.it;
        if (it) {
          ctx.save();
          ctx.translate((it.x + it.w / 2) * W, (it.y + it.h / 2) * H);
          ctx.rotate((it.rotation * Math.PI) / 180);
          ctx.strokeStyle = '#c5b7ff';
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([5 * dpr, 3 * dpr]);
          ctx.strokeRect((-it.w * W) / 2, (-it.h * H) / 2, it.w * W, it.h * H);
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffffff';
          for (const [x, y] of [[1, 1]]) {
            ctx.fillRect(
              (x * it.w * W) / 2 - 4 * dpr,
              (y * it.h * H) / 2 - 4 * dpr,
              8 * dpr,
              8 * dpr,
            );
          }
          ctx.restore();
        }
      } else if (this.recording?.kind === 'captions') {
        const r = this.recording,
          cue = this.p.captions[r.index];
        R.video(
          ctx,
          {
            ...this.p,
            captions: [
              { ...cue, start: r.marks[r.index], end: this.p.audio.duration },
            ],
          },
          this.time,
          W,
          H,
        );
      } else if (this.recording) {
        const r = this.recording,
          c = this.p.sequence[r.index],
          pg = this.p.pages.find((pg) => pg.id === c.pageId),
          local = this.time - r.marks[r.index];
        R.page(
          ctx,
          this.p,
          pg,
          W,
          H,
          local,
          Math.max(local + 1, this.p.audio.duration - r.marks[r.index]),
          true,
        );
      } else R.video(ctx, this.clickPreviewProject(), this.time, W, H);
      if (this.mode !== 'design' && !this.playing && !this.recording) {
        const active = this.p.captions.filter(
          (c) => this.time >= c.start && this.time < c.end,
        );
        const c = active.find((c) => c.id === this.cueId);
        if (c) {
          const b = M.captionBox(this.p, c, active.indexOf(c));
          ctx.save();
          ctx.strokeStyle = '#c5b7ff';
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([5 * dpr, 3 * dpr]);
          ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
          ctx.setLineDash([]);
          ctx.fillStyle = '#fff';
          ctx.fillRect(
            (b.x + b.w) * W - 4 * dpr,
            (b.y + b.h) * H - 4 * dpr,
            8 * dpr,
            8 * dpr,
          );
          ctx.restore();
        }
      }
      this.drawGuides(ctx, W, H, dpr);
      if (this.drag?.moved) {
        const cue = this.p.captions.find((c) => c.id === this.drag.id),
          b = this.drag.caption && cue ? M.captionBox(this.p, cue) : this.it;
        if (b) {
          ctx.save();
          ctx.font = `${11 * dpr}px sans-serif`;
          const text = `X ${Math.round(b.x * this.p.width)} · Y ${Math.round(b.y * this.p.height)}`,
            tw = ctx.measureText(text).width,
            x = Math.max(4 * dpr, Math.min(W - tw - 10 * dpr, b.x * W)),
            y = Math.max(18 * dpr, b.y * H - 8 * dpr);
          ctx.fillStyle = '#202534';
          ctx.fillRect(x - 3 * dpr, y - 13 * dpr, tw + 6 * dpr, 17 * dpr);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, x, y);
          ctx.restore();
        }
      }
    }
    drawGuides(ctx, W, H, dpr) {
      ctx.save();
      ctx.strokeStyle = '#ff72cf';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = dpr;
      ctx.font = `${11 * dpr}px sans-serif`;
      for (const g of this.guides || []) {
        ctx.beginPath();
        if (!g.gaps) {
          if (g.axis === 'x') {
            ctx.moveTo(g.value * W, 0);
            ctx.lineTo(g.value * W, H);
          } else {
            ctx.moveTo(0, g.value * H);
            ctx.lineTo(W, g.value * H);
          }
          ctx.stroke();
        } else
          for (const [a, b] of g.gaps) {
            const horizontal = g.axis === 'x',
              scale = horizontal ? W : H,
              cross = g.at * (horizontal ? H : W);
            const point = (v, c) =>
              horizontal ? [v * scale, c] : [c, v * scale];
            ctx.beginPath();
            ctx.moveTo(...point(a, cross));
            ctx.lineTo(...point(b, cross));
            for (const v of [a, b]) {
              ctx.moveTo(...point(v, cross - 4 * dpr));
              ctx.lineTo(...point(v, cross + 4 * dpr));
            }
            ctx.stroke();
            const [x, y] = point((a + b) / 2, cross - 6 * dpr),
              text =
                Math.round(
                  (b - a) * (horizontal ? this.p.width : this.p.height),
                ) + ' px';
            ctx.save();
            ctx.textAlign = 'center';
            const tw = ctx.measureText(text).width;
            ctx.fillStyle = '#202534';
            ctx.fillRect(
              x - tw / 2 - 3 * dpr,
              y - 11 * dpr,
              tw + 6 * dpr,
              14 * dpr,
            );
            ctx.fillStyle = '#fff';
            ctx.fillText(text, x, y);
            ctx.restore();
          }
      }
      ctx.restore();
    }
    captionPointerDown(e) {
      if (this.recording) return;
      const point = this.point(e),
        active = this.p.captions.filter(
          (c) => this.time >= c.start && this.time < c.end,
        );
      for (const c of active.slice().reverse()) {
        const b = M.captionBox(this.p, c, active.indexOf(c)),
          eps = 12 / this.canvas.getBoundingClientRect().width;
        const resize =
          c.id === this.cueId &&
          Math.abs(point.x - b.x - b.w) < eps &&
          Math.abs(point.y - b.y - b.h) < eps;
        if (
          !resize &&
          !(
            point.x >= b.x &&
            point.x <= b.x + b.w &&
            point.y >= b.y &&
            point.y <= b.y + b.h
          )
        )
          continue;
        this.pause();
        this.cueId = c.id;
        this.mode = 'subtitles';
        if (this.autoStyle()) {
          // Automatic style saving: dragging edits the shared style (unless this
          // subtitle was explicitly chosen for individual edits).
          if (this.styleScope !== 'individual')
            this.styleScope = this.defaultCaptionScope(c);
        } else if (
          resize ||
          this.captionScope() === 'all' ||
          active.length > 1 ||
          (c.styleId && this.styleScope !== 'saved:' + c.styleId) ||
          ['x', 'y', 'w', 'h'].some((k) => Object.hasOwn(c.style || {}, k))
        )
          this.styleScope = 'individual';
        this.renderPanels();
        this.drag = {
          caption: true,
          id: c.id,
          point,
          original: b,
          before: snapshot(this.p),
          resize,
          moved: false,
        };
        this.canvas.setPointerCapture(e.pointerId);
        this.draw();
        e.preventDefault();
        return;
      }
    }
    point(e) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      };
    }
    localPoint(p, it) {
      const x = (p.x - it.x - it.w / 2) * this.p.width,
        y = (p.y - it.y - it.h / 2) * this.p.height,
        r = (-it.rotation * Math.PI) / 180;
      return {
        x: (x * Math.cos(r) - y * Math.sin(r)) / this.p.width + it.w / 2,
        y: (x * Math.sin(r) + y * Math.cos(r)) / this.p.height + it.h / 2,
      };
    }
    pointerDown(e) {
      if (this.exporting || e.button !== 0) return;
      if (this.mode !== 'design') {
        this.captionPointerDown(e);
        return;
      }
      const p = this.point(e);
      let found = null,
        resize = false;
      if (this.it && !this.it.locked) {
        const q = this.localPoint(p, this.it),
          eps = 12 / this.canvas.getBoundingClientRect().width;
        if (
          Math.abs(q.x - this.it.w) < eps &&
          Math.abs(q.y - this.it.h) < eps
        ) {
          found = this.it;
          resize = true;
        }
      }
      if (!found)
        for (const i of this.pg.items.slice().reverse()) {
          if (i.hidden) continue;
          const q = this.localPoint(p, i);
          if (q.x >= 0 && q.x <= i.w && q.y >= 0 && q.y <= i.h) {
            found = i;
            break;
          }
        }
      this.itemId = found?.id || null;
      this.renderInspector();
      this.draw();
      if (found && !found.locked) {
        this.drag = {
          point: p,
          original: { ...found },
          before: snapshot(this.p),
          resize,
          moved: false,
        };
        this.canvas.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    }
    pointerMove(e) {
      if (!this.drag) return;
      const p = this.point(e),
        d = this.drag,
        cue = d.caption ? this.p.captions.find((c) => c.id === d.id) : null;
      const target = d.caption ? { ...d.original } : this.it;
      if (!target) return;
      d.moved = true;
      if (d.resize) {
        const q = this.localPoint(p, d.original);
        target.w = M.clamp(q.x, 0.02, d.caption ? 1 - target.x : 3);
        target.h = M.clamp(q.y, 0.02, d.caption ? 1 - target.y : 3);
        this.guides = [];
        if (!d.caption && !e.altKey && Math.abs((target.rotation || 0) % 360) < 1e-6) {
          const rect = this.canvas.getBoundingClientRect();
          const result = M.snapResizeBox(target, { x: 6 / rect.width, y: 6 / rect.height });
          target.w = result.box.w;
          target.h = result.box.h;
          this.guides = result.guides;
        }
      } else {
        target.x = M.clamp(
          d.original.x + p.x - d.point.x,
          d.caption ? 0 : -2,
          d.caption ? 1 - target.w : 2,
        );
        target.y = M.clamp(
          d.original.y + p.y - d.point.y,
          d.caption ? 0 : -2,
          d.caption ? 1 - target.h : 2,
        );
        const pg =
          this.mode === 'design'
            ? this.pg
            : this.p.pages.find(
                (pg) => pg.id === M.at(this.p, this.time)?.pageId,
              );
        const bounds = (i) => {
          const r = ((i.rotation || 0) * Math.PI) / 180;
          const w =
            Math.abs(i.w * Math.cos(r)) +
            Math.abs(((i.h * this.p.height) / this.p.width) * Math.sin(r));
          const h =
            Math.abs(i.h * Math.cos(r)) +
            Math.abs(((i.w * this.p.width) / this.p.height) * Math.sin(r));
          return { ...i, x: i.x + (i.w - w) / 2, y: i.y + (i.h - h) / 2, w, h };
        };
        const others = (pg?.items || [])
          .filter((i) => i.id !== target.id)
          .map(bounds);
        if (d.caption)
          others.push(
            ...this.p.captions
              .filter(
                (c) =>
                  c.id !== cue.id && this.time >= c.start && this.time < c.end,
              )
              .map((c) => M.captionBox(this.p, c)),
          );
        const rect = this.canvas.getBoundingClientRect();
        const box = bounds(target);
        const result = e.altKey
          ? { box, guides: [] }
          : M.snapBox(box, others, {
              x: 6 / rect.width,
              y: 6 / rect.height,
            });
        target.x += result.box.x - box.x;
        target.y += result.box.y - box.y;
        this.guides = result.guides;
      }
      if (cue) {
        const style =
          this.styleScope === 'individual'
            ? (cue.style ||= {})
            : this.captionBaseStyle();
        const keys = d.resize ? ['w', 'h'] : ['x', 'y'];
        for (const k of keys) style[k] = target[k];
        if (this.styleScope !== 'individual' && this.autoStyle())
          for (const c of this.captionScopeCues())
            for (const k of keys) if (c.style) delete c.style[k];
      }
      this.draw();
    }
    pointerUp() {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      this.guides = [];
      this.draw();
      if (d.moved) {
        this.undo.push(d.before);
        if (this.undo.length > 30) this.undo.shift();
        this.redo = [];
        this.changed();
      }
    }
    key(e) {
      if (e.key === 'Escape' && this.propertyEdit?.element === e.target) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPropertyEdit();
        return;
      }
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey &&
          this.mode !== 'design' && !e.target.closest('.md-modal') &&
          !e.target.closest('textarea, select, [contenteditable]:not([contenteditable="false"])') &&
          !(e.target.tagName === 'INPUT' && e.target.type !== 'range')) {
        e.preventDefault();
        if (!e.repeat) this.action('play').catch(err => this.error(err));
        return;
      }
      if (this.cueKey(e)) return;
      if (
        e.target.closest('.md-modal') ||
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      )
        return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save().catch((err) => this.error(err));
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.action(e.shiftKey ? 'redo' : 'undo');
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.action(this.mode === 'design' ? 'duplicate-item' : 'repeat');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.action(
          this.mode === 'design'
            ? 'delete-item'
            : this.mode === 'subtitles'
              ? this.cueId
                ? 'cue-delete-' + this.cueId
                : ''
              : 'delete-clip',
        );
      } else if (
        this.it &&
        !this.it.locked &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault();
        const n = (e.shiftKey ? 10 : 1) / this.p.width;
        this.commit(() => {
          if (e.key === 'ArrowLeft') this.it.x -= n;
          if (e.key === 'ArrowRight') this.it.x += n;
          if (e.key === 'ArrowUp')
            this.it.y -= (n * this.p.width) / this.p.height;
          if (e.key === 'ArrowDown')
            this.it.y += (n * this.p.width) / this.p.height;
        });
      }
    }
    async importFiles(files) {
      for (const f of files) {
        if (f.name.endsWith('.mvmdesign')) {
          await this.openFile(f);
          continue;
        }
        if (f.size > 250 * 1024 * 1024) throw Error('tooLarge');
        if (f.type.startsWith('audio/')) {
          const data = await dataURL(f),
            audio = new Audio(data);
          await new Promise((res, rej) => {
            audio.onloadedmetadata = res;
            audio.onerror = rej;
          });
          if (!Number.isFinite(audio.duration) || audio.duration <= 0)
            throw Error('audioFailed');
          this.commit(() => {
            this.p.audio = { name: f.name, data, duration: audio.duration };
            const total = M.duration(this.p);
            if (total > 0)
              this.p.sequence.forEach(
                (c) =>
                  (c.duration = Math.max(
                    0.1,
                    (c.duration * audio.duration) / total,
                  )),
              );
          });
          this.setAudio();
          this.mode = 'video';
          this.renderPanels();
          await this.computePeaks();
        } else if (/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(f.type)) {
          const src = await dataURL(f),
            im = new Image();
          im.src = src;
          await im.decode();
          this.mode = 'design';
          this.commit(() => {
            const id = M.uid(),
              it = M.item('image');
            this.p.assets[id] = { src, name: f.name };
            it.assetId = id;
            it.w = 0.65;
            it.h = Math.min(
              0.85,
              (((0.65 * this.p.width) / im.width) * im.height) / this.p.height,
            );
            it.x = (1 - it.w) / 2;
            it.y = (1 - it.h) / 2;
            this.pg.items.push(it);
            this.itemId = it.id;
          });
          await R.prepare(this.p);
          this.draw();
          this.renderPages();
        } else throw Error('unsupported');
      }
    }
    async loadFonts() {
      try {
        if (!window.MvmFontsClient) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = window.asset('/pub/mvmfonts/client.js');
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        this.fonts = await window.MvmFontsClient.load(
          this.publicMode ? { token: this.projects.token } : undefined,
        );
        if (!this.dead) {
          await R.prepare(this.p);
          this.renderInspector();
          this.draw();
        }
      } catch (_) {
        this.fonts = [];
      }
    }
    async ensureFont(name) {
      try {
        await window.MvmFontsClient?.ready([name], this.it?.text || 'AaЖя');
        this.draw();
        this.renderPages();
      } catch (e) {
        this.error(e);
      }
    }
    setAudio() {
      if (this.audioData === this.p.audio?.data) return;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.peaks = null;
      if (this.p.audio) this.audio.src = this.p.audio.data;
      this.audio.load();
      this.audioData = this.p.audio?.data;
    }
    async computePeaks() {
      const data = this.p.audio?.data;
      if (!data) return;
      const ac = new AudioContext();
      try {
        const buf = await ac.decodeAudioData(
            await (await fetch(data)).arrayBuffer(),
          ),
          arr = buf.getChannelData(0),
          count = Math.min(30000, Math.ceil(buf.duration * 60)),
          peaks = new Float32Array(count);
        for (let k = 0; k < count; k++) {
          const from = Math.floor((k * arr.length) / count),
            to = Math.floor(((k + 1) * arr.length) / count);
          for (let j = from; j < to; j += 4)
            peaks[k] = Math.max(peaks[k], Math.abs(arr[j]));
        }
        if (!this.dead && this.p.audio?.data === data) {
          this.peaks = peaks;
          this.renderTimeline();
        }
      } catch (_) {
        /* Audio playback remains usable when waveform decoding is unavailable. */
      } finally {
        await ac.close();
      }
    }
    async openVideoPreview() {
      if (this.videoPreview || this.recording || this.exporting) return;
      this.finishPropertyEdit();
      this.pause();
      await R.prepare(this.p);
      if (this.dead || this.videoPreview) return;
      const overlay = document.createElement('div');
      overlay.className = 'md-modal md-video-preview';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', t('videoPreview'));
      overlay.innerHTML = `<div class="md-preview-stage"><canvas></canvas></div><div class="md-preview-controls"><button type="button" data-preview-play></button><output data-preview-time></output><input data-preview-seek type="range" min="0" max="${M.duration(this.p)}" step="0.01" aria-label="${esc(t('seek'))}"><button type="button" data-preview-fullscreen>${esc(t('previewFullscreen'))}</button><button type="button" data-preview-close>${esc(t('close'))}</button></div>`;
      const view = { overlay, canvas: overlay.querySelector('canvas'), mode: this.mode };
      this.videoPreview = view;
      overlay.cleanup = () => this.closeVideoPreview();
      this.root.appendChild(overlay);
      const toggle = async () => {
        if (this.playing) this.pause();
        else {
          const button = overlay.querySelector('[data-preview-play]');
          button.disabled = true;
          try {
            this.playCueEnd = null;
            await this.play();
            if (this.videoPreview !== view) this.pause();
          } catch (error) { this.error(error); }
          finally { button.disabled = false; }
        }
      };
      overlay.querySelector('[data-preview-play]').onclick = toggle;
      overlay.querySelector('[data-preview-close]').onclick = () => this.closeVideoPreview();
      overlay.querySelector('[data-preview-seek]').oninput = event => this.seek(+event.target.value);
      const full = overlay.querySelector('[data-preview-fullscreen]');
      full.hidden = !overlay.requestFullscreen;
      full.onclick = async () => {
        try {
          if (document.fullscreenElement === overlay) await document.exitFullscreen();
          else await overlay.requestFullscreen();
          this.drawVideoPreview();
        } catch (error) { this.error(error); }
      };
      overlay.onkeydown = event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !document.fullscreenElement) this.closeVideoPreview();
        if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (!event.repeat) toggle();
        }
      };
      view.resize = new ResizeObserver(() => this.drawVideoPreview());
      view.resize.observe(overlay.querySelector('.md-preview-stage'));
      view.fullscreenChange = () => this.drawVideoPreview();
      document.addEventListener('fullscreenchange', view.fullscreenChange);
      overlay.querySelector('[data-preview-play]').focus();
      this.drawVideoPreview();
    }
    closeVideoPreview() {
      const view = this.videoPreview;
      if (!view) return;
      this.videoPreview = null;
      this.pause();
      view.resize.disconnect();
      document.removeEventListener('fullscreenchange', view.fullscreenChange);
      if (document.fullscreenElement === view.overlay) document.exitFullscreen().catch(() => {});
      view.overlay.remove();
      this.mode = view.mode;
      if (!this.dead) { this.renderPanels(); this.draw(); this.root.focus(); }
    }
    drawVideoPreview() {
      const view = this.videoPreview;
      if (!view || this.dead) return;
      const rect = view.overlay.querySelector('.md-preview-stage').getBoundingClientRect();
      const scale = Math.max(0.01, Math.min(rect.width / this.p.width, rect.height / this.p.height));
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(this.p.width * scale * dpr));
      const height = Math.max(1, Math.round(this.p.height * scale * dpr));
      if (view.canvas.width !== width) view.canvas.width = width;
      if (view.canvas.height !== height) view.canvas.height = height;
      view.canvas.style.width = this.p.width * scale + 'px';
      view.canvas.style.height = this.p.height * scale + 'px';
      R.video(view.canvas.getContext('2d'), this.p, this.time, width, height);
      view.overlay.querySelector('[data-preview-time]').textContent = `${clock(this.time)} / ${clock(M.duration(this.p))}`;
      const scrub = view.overlay.querySelector('[data-preview-seek]');
      scrub.value = this.time;
      updateButton(view.overlay.querySelector('[data-preview-play]'), this.playing ? 'pause' : 'play');
      const fullscreenButton = view.overlay.querySelector('[data-preview-fullscreen]');
      const label = t(document.fullscreenElement === view.overlay ? 'previewWindowed' : 'previewFullscreen');
      if (fullscreenButton.textContent !== label) fullscreenButton.textContent = label;
    }
    async play() {
      if (!this.p.sequence.length) throw Error('emptySequence');
      if (this.mode === 'design') this.mode = 'video';
      await R.prepare(this.p);
      if (this.time >= M.duration(this.p)) this.time = 0;
      if (this.p.audio && this.time < this.p.audio.duration) {
        this.audio.currentTime = this.time;
        await this.audio.play();
      }
      this.playing = true;
      this.playStart = performance.now();
      this.startTime = this.time;
      const focused = document.activeElement;
      this.renderPanels();
      if (this.root.contains(focused) === false && !focused.isConnected)
        this.canvas.focus({ preventScroll: true });
      const tick = () => {
        if (!this.playing || this.dead) return;
        this.time =
          this.p.audio && !this.audio.paused
            ? this.audio.currentTime
            : this.startTime + (performance.now() - this.playStart) / 1000;
        const end = this.recording
          ? this.p.audio.duration
          : (this.playCueEnd ?? M.duration(this.p));
        if (this.time >= end) {
          this.time = end;
          if (this.recording) this.finishTiming();
          else {
            this.finishClickCue();
            this.pause();
            this.playCueEnd = null;
          }
        }
        this.draw();
        this.updateTransport();
        if (this.playing) this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
    pause() {
      this.playing = false;
      this.audio.pause();
      cancelAnimationFrame(this.raf);
      if (this.root.isConnected) this.updateTransport();
    }
    seek(time, reveal = false) {
      if (this.recording) return;
      this.playCueEnd = null;
      this.time = M.clamp(time, 0, M.duration(this.p));
      if (reveal) this.revealTimelineTime();
      if (this.p.audio)
        this.audio.currentTime = Math.min(this.time, this.p.audio.duration);
      this.startTime = this.time;
      this.playStart = performance.now();
      if (this.playing && this.p.audio && this.time < this.p.audio.duration)
        this.audio.play().catch((e) => this.error(e));
      this.draw();
      this.updateTransport();
    }
    async startTiming(kind = 'pages') {
      this.finishClickCue();
      if (!this.p.audio) throw Error('needAudio');
      if (!this.p.sequence.length) throw Error('emptySequence');
      if (
        kind === 'captions' &&
        !this.p.captions.length &&
        !this.p.captionDrafts.length
      )
        throw Error('needCaptions');
      if (
        !confirm(
          t(kind === 'captions' ? 'recordCaptionConfirm' : 'recordConfirm'),
        )
      )
        return;
      this.pause();
      this.recording = { kind, before: snapshot(this.p), marks: [0], index: 0 };
      if (kind === 'captions' && this.p.captionDrafts.length) {
        this.recording.pending = true;
        this.p.captions = this.p.captionDrafts.map((c) => ({
          ...c,
          start: 0,
          end: 3,
        }));
      }
      this.time = 0;
      this.mode = kind === 'captions' ? 'subtitles' : 'video';
      this.clipIds = [this.p.sequence[0].id];
      try {
        await this.play();
        this.toast(t('recordHelp'));
      } catch (e) {
        this.cancelTiming();
        throw e;
      }
    }
    nextTiming() {
      const r = this.recording;
      if (!r) return;
      if (this.time - r.marks.at(-1) < 0.1) return;
      const source = r.kind === 'captions' ? this.p.captions : this.p.sequence;
      if (r.index >= source.length - 1) {
        this.finishTiming();
        return;
      }
      r.marks.push(this.time);
      r.index++;
      if (r.kind === 'captions') this.cueId = source[r.index].id;
      else this.clipIds = [source[r.index].id];
      this.renderInspector();
      this.toast(
        `${t(r.kind === 'captions' ? 'subtitles' : 'page')} ${r.index + 1} / ${source.length}`,
      );
    }
    finishTiming() {
      const r = this.recording;
      if (!r) return;
      const end = this.p.audio.duration;
      this.pause();
      this.undo.push(r.before);
      this.redo = [];
      if (r.kind === 'captions' && r.pending)
        this.p.captionDrafts = this.p.captionDrafts.slice(r.index + 1);
      if (r.kind === 'captions')
        this.p.captions = this.p.captions.slice(0, r.index + 1).map((c, i) => ({
          ...c,
          start: r.marks[i],
          end: r.marks[i + 1] ?? end,
        }));
      else
        this.p.sequence = this.p.sequence.slice(0, r.index + 1).map((c, i) => ({
          ...c,
          duration: Math.max(0.1, (r.marks[i + 1] ?? end) - r.marks[i]),
        }));
      if (r.pending)
        this.p.captions = [...r.before.captions, ...this.p.captions];
      this.recording = null;
      this.time = 0;
      this.changed();
    }
    cancelTiming() {
      if (!this.recording) return;
      this.pause();
      this.p = this.recording.before;
      this.recording = null;
      this.time = 0;
      this.renderPanels();
      this.draw();
    }
    setCueTime(k) {
      const playing = this.playing;
      this.commit(() => {
        const c = this.p.captions.find((c) => c.id === this.cueId);
        if (c) {
          c[k] = this.time;
          if (c.end <= c.start) c.end = c.start + 0.1;
        }
      });
      if (playing) this.play().catch((e) => this.error(e));
    }
    linesOf(text) {
      return String(text)
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ id: M.uid(), text, style: {} }));
    }
    lyricsDialog(edit = false) {
      // add: new text is appended to the stored full text and to the library.
      // edit: the whole stored text is shown; it can be saved or turned into subtitles again.
      const full = this.p.captionText || '';
      const box = this.modal(
        edit ? 'subtitleText' : 'pasteLyrics',
        `<p class="md-note">${esc(t(edit ? 'subtitleTextHint' : 'lyricsHint'))}</p><textarea data-lyrics maxlength="200000" aria-label="${esc(t('subtitleText'))}">${edit ? esc(full) : ''}</textarea>`,
        async (box) => {
          const text = box.querySelector('[data-lyrics]').value;
          const lines = this.linesOf(text);
          if (!edit && !lines.length) return false;
          this.commit(() => {
            if (edit) this.p.captionText = text.trim();
            else {
              this.p.captionText = [this.p.captionText, text.trim()]
                .filter(Boolean)
                .join('\n');
              this.p.captionDrafts.push(...lines);
            }
          });
        },
        edit ? 'save' : 'apply',
      );
      if (!edit) return;
      const again = document.createElement('button');
      again.type = 'button';
      again.textContent = t('regenerateSubtitles');
      again.title = t('regenerateHint');
      again.onclick = () => {
        const lines = this.linesOf(box.querySelector('[data-lyrics]').value);
        if (!lines.length) return;
        this.commit(() => {
          this.p.captionText = box.querySelector('[data-lyrics]').value.trim();
          this.p.captionDrafts = lines;
        });
        box.querySelector('[data-cancel]').click();
      };
      box.querySelector('[data-apply]').before(again);
    }
    templates() {
      this.modal(
        'templates',
        `<p class="md-note">${esc(t('templateHint'))}</p>${select('template', 'templates', 'lyric', ['lyric', 'poster', 'minimal'])}`,
        async (box) => {
          const kind = box.querySelector('select').value;
          this.commit(() => {
            const pg = M.page(),
              title = M.item();
            title.text = t('sampleText');
            title.enter = 'up';
            title.exit = 'fade';
            pg.items.push(title);
            if (kind === 'lyric') {
              pg.bg = '#12262b';
              pg.bg2 = '#354a48';
              title.panel = true;
              title.panelOpacity = 0.55;
              title.strokeWidth = 2;
              title.y = 0.32;
            } else if (kind === 'poster') {
              pg.bg = '#3d182a';
              pg.bg2 = '#99514c';
              title.gradient = true;
              title.color = '#fff0b8';
              title.color2 = '#df9e58';
              title.size = 0.11;
              const shape = M.item('shape');
              Object.assign(shape, {
                x: 0.08,
                y: 0.12,
                w: 0.84,
                h: 0.012,
                color: '#e6bd87',
              });
              pg.items.unshift(shape);
            } else {
              pg.bg = '#f2eadf';
              pg.gradient = false;
              title.color = '#252b32';
              title.weight = 400;
              title.align = 'left';
              title.y = 0.4;
            }
            this.p.pages.push(pg);
            this.p.sequence.push(M.occurrence(pg.id));
            this.pageId = pg.id;
            this.mode = 'design';
            this.itemId = title.id;
          });
        },
      );
    }
    settings(create = false) {
      const formats = [
        ['screen', 'presentationHD', 1920, 1080],
        ['screen', 'presentation4K', 3840, 2160],
        ['youtube', 'youtubeThumbnail', 3840, 2160],
        ['youtube', 'youtubeThumbnailHD', 1280, 720],
        ['youtube', 'youtubeBanner', 2560, 1440],
        ['youtube', 'shortsThumbnail', 2160, 3840],
        ['social', 'instagramSquare', 1080, 1080],
        ['social', 'instagramPortrait', 1080, 1350],
        ['social', 'instagramTall', 1080, 1440],
        ['social', 'storyReel', 1080, 1920],
        ['social', 'facebookPost', 1200, 630],
        ['social', 'facebookCover', 1640, 624],
        ['print', 'flyerA4', 2480, 3508, '210 × 297 mm'],
        ['print', 'flyerA5', 1748, 2480, '148 × 210 mm'],
        ['print', 'flyerA6', 1240, 1748, '105 × 148 mm'],
        ['print', 'brochure', 3508, 2480, '297 × 210 mm'],
        ['print', 'letter', 2550, 3300, '8.5 × 11 in'],
        ['print', 'businessCard', 1004, 650, '85 × 55 mm'],
        ['covers', 'bookCover', 1800, 2700, '6 × 9 in'],
        ['covers', 'bookCoverA5', 1748, 2480, '148 × 210 mm'],
        ['covers', 'ebookCover', 1600, 2560],
        ['covers', 'albumCover', 3000, 3000],
      ];
      const box = this.modal(
        create ? 'new' : 'documentSize',
        `${select('formatCategory', 'formatCategory', 'allFormats', ['allFormats', 'screen', 'youtube', 'social', 'print', 'covers'])}
        <div class="md-format-grid">${formats
          .map(
            ([category, key, w, h, physical], i) =>
              `<button type="button" class="md-format" data-format="${i}" data-category="${category}" aria-pressed="false"><span class="md-format-preview" aria-hidden="true"><span style="aspect-ratio:${w}/${h};${w >= h ? 'width:48px' : 'height:34px'}"></span></span><strong>${esc(t(key))}</strong><small>${w} × ${h} px${physical ? `<br>${esc(physical)}` : ''}</small></button>`,
          )
          .join('')}</div>
        <h3>${esc(t('customSize'))}</h3>
        ${select('sizeUnit', 'sizeUnit', 'px', [
          ['px', 'px'],
          ['mm', 'mm'],
          ['in', t('inches')],
        ])}
        <div class="md-size-inputs">${field('documentWidth', 'documentWidth', this.p.width, 'number', 'min="1" step="any" required')}${btn('swap-dimensions', 'swapDimensions')}${field('documentHeight', 'documentHeight', this.p.height, 'number', 'min="1" step="any" required')}</div>
        <output class="md-size-summary" aria-live="polite"></output>
        <p class="md-note">${esc(t('sizeHint'))}</p>
        <p class="md-note">${esc(t('printSizeHint'))}</p>
        ${!create ? `<p class="md-note">${esc(t('resizeHint'))}</p>` : ''}`,
        async () => {
          update();
          if (!valid) return false;
          if (create) {
            if (!this.leave()) return false;
            this.pause();
            this.projects?.detach();
            this.p = M.project();
            this.projectStarted = true;
            this.root.querySelector('.md-project-home [data-cancel]')?.click();
            this.p.width = pixelWidth;
            this.p.height = pixelHeight;
            this.source = null;
            this.localRecentId = null;
            this.pageId = this.pg.id;
            this.itemId = null;
            this.clipIds = [];
            this.cueId = null;
            this.playCueEnd = null;
            this.inspectorTabs = {};
            this.styleScope = 'global';
            this.mode = 'design';
            this.time = 0;
            this.undo = [];
            this.redo = [];
            this.setAudio();
            this.changed();
          } else {
            this.commit(() => {
              this.p.width = pixelWidth;
              this.p.height = pixelHeight;
            });
          }
        },
        create ? 'createDocument' : 'apply',
      );
      box.querySelector('.md-modal-box').classList.add('md-size-dialog');
      const width = box.querySelector('[data-prop=documentWidth]'),
        height = box.querySelector('[data-prop=documentHeight]'),
        unit = box.querySelector('[data-prop=sizeUnit]'),
        summary = box.querySelector('.md-size-summary');
      let factor = 1,
        pixelWidth,
        pixelHeight,
        valid;
      const update = () => {
        pixelWidth = Math.round(width.valueAsNumber * factor);
        pixelHeight = Math.round(height.valueAsNumber * factor);
        valid =
          Number.isFinite(pixelWidth) &&
          Number.isFinite(pixelHeight) &&
          pixelWidth >= 64 &&
          pixelWidth <= 7680 &&
          pixelHeight >= 64 &&
          pixelHeight <= 7680 &&
          pixelWidth * pixelHeight <= 34e6;
        summary.textContent = valid
          ? `${pixelWidth} × ${pixelHeight} px`
          : t('invalidSize');
        summary.classList.toggle('md-size-error', !valid);
        box.querySelector('[data-apply]').disabled = !valid;
        for (const tile of box.querySelectorAll('[data-format]')) {
          const format = formats[+tile.dataset.format];
          tile.setAttribute(
            'aria-pressed',
            String(format[2] === pixelWidth && format[3] === pixelHeight),
          );
        }
      };
      const showPixels = (w, h) => {
        // Keep enough precision to convert back to the exact original pixel size.
        width.value = +(w / factor).toFixed(6);
        height.value = +(h / factor).toFixed(6);
        update();
      };
      width.oninput = height.oninput = update;
      unit.onchange = () => {
        const w = width.valueAsNumber * factor,
          h = height.valueAsNumber * factor;
        factor =
          unit.value === 'mm' ? 300 / 25.4 : unit.value === 'in' ? 300 : 1;
        showPixels(w, h);
      };
      box.querySelector('[data-prop=formatCategory]').onchange = (e) => {
        for (const tile of box.querySelectorAll('[data-format]'))
          tile.hidden =
            e.target.value !== 'allFormats' &&
            tile.dataset.category !== e.target.value;
      };
      box.querySelector('[data-action=swap-dimensions]').onclick = (e) => {
        e.stopPropagation();
        [width.value, height.value] = [height.value, width.value];
        update();
      };
      for (const tile of box.querySelectorAll('[data-format]'))
        tile.onclick = () => {
          const f = formats[+tile.dataset.format];
          showPixels(f[2], f[3]);
        };
      update();
    }
    modal(title, html, apply, label = 'apply') {
      const overlay = document.createElement('div');
      overlay.className = 'md-modal';
      overlay.innerHTML = `<div class="md-modal-box" role="dialog" aria-modal="true" aria-label="${esc(t(title))}"><h3>${esc(t(title))}</h3>${html}<div class="md-row"><button data-cancel>${esc(t('cancel'))}</button><button data-apply class="md-primary">${esc(t(label))}</button></div></div>`;
      this.root.appendChild(overlay);
      const close = () => {
        overlay.cleanup?.();
        overlay.remove();
        this.root.focus({ preventScroll: true });
        overlay.restoreFocus?.();
      };
      overlay.querySelector('[data-cancel]').onclick = close;
      overlay.querySelector('[data-apply]').onclick = async (e) => {
        e.target.disabled = true;
        try {
          if ((await apply(overlay)) !== false) close();
        } catch (err) {
          this.error(err);
        } finally {
          e.target.disabled = false;
        }
      };
      overlay.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      };
      overlay
        .querySelector('input,select,textarea,button')
        ?.focus({ preventScroll: true });
      return overlay;
    }
    exportDialog() {
      this.pause();
      const p = this.p,
        isMovie =
          !!p.audio ||
          p.captions?.length > 0 ||
          p.sequence.length > 1 ||
          p.pages.some((pg) =>
            pg.items.some(
              (it) =>
                (it.enter && it.enter !== 'none') ||
                (it.exit && it.exit !== 'none'),
            ),
          ),
        defaultKind = isMovie ? 'movie' : p.pages.length > 1 ? 'allPages' : 'page';
      const box = this.modal(
        'export',
        `${select('kind', 'output', defaultKind, ['page', 'allPages', 'movie'])}${select(
          'imageType',
          'imageFormat',
          'png',
          [
            ['png', 'PNG'],
            ['jpg', 'JPEG'],
            ['webp', 'WebP'],
          ],
        )}${select('scale', 'resolution', '1', [
          [
            '.5',
            `${Math.round(this.p.width / 2)} × ${Math.round(this.p.height / 2)}`,
          ],
          ['1', `${this.p.width} × ${this.p.height}`],
        ])}${select('quality', 'quality', 'max', ['standard', 'high', 'max'])}${select(
          'fps',
          'fps',
          30,
          [
            [24, '24'],
            [25, '25'],
            [30, '30'],
            [60, '60'],
          ],
        )}${select('container', 'container', 'auto', [
          ['auto', t('auto')],
          ['mp4', 'MP4 (H.264 + AAC)'],
          ['webm', 'WebM (VP9 + Opus)'],
        ])}<p class="md-note" data-image-hint>${esc(t('imageExportHint'))}</p><p class="md-note" data-video-hint>${esc(t('videoExportHint'))}</p><p class="md-note" data-render-hint>${esc(t('exportHint'))}</p>`,
        async (box) => {
          const get = (k) => box.querySelector(`[data-prop=${k}]`).value,
            opts = {
              kind: get('kind'),
              type: get('imageType'),
              scale: +get('scale'),
              quality: get('quality'),
              fps: +get('fps'),
              container: get('container'),
            };
          box.remove();
          await this.export(opts);
        },
        'export',
      );
      const update = () => {
        const video = box.querySelector('[data-prop=kind]').value === 'movie';
        for (const key of ['imageType', 'quality', 'fps', 'container']) {
          const control = box.querySelector(`[data-prop=${key}]`);
          control.closest('.md-field').hidden = key === 'imageType' ? video : !video;
          control.disabled = control.closest('.md-field').hidden;
        }
        box.querySelector('[data-image-hint]').hidden = video;
        box.querySelector('[data-video-hint]').hidden = !video;
        box.querySelector('[data-render-hint]').hidden = !video;
      };
      box.querySelector('[data-prop=kind]').onchange = update;
      update();
    }
    async export(opts) {
      this.finishClickCue();
      const p = snapshot(this.p);
      this.pause();
      this.exporting = true;
      this.abort = new AbortController();
      const overlay = document.createElement('div');
      overlay.className = 'md-modal';
      overlay.innerHTML = `<div class="md-modal-box" role="dialog" aria-modal="true"><h3>${esc(t('exporting'))}</h3><progress max="1" value="0"></progress><p data-progress>0%</p><p>${esc(t('exportHint'))}</p><button>${esc(t('cancel'))}</button></div>`;
      this.root.appendChild(overlay);
      overlay.querySelector('button').onclick = () => this.abort.abort();
      const progress = (q) => {
        overlay.querySelector('progress').value = q;
        overlay.querySelector('[data-progress]').textContent =
          Math.round(q * 100) + '%';
      };
      try {
        let result, ext;
        if (opts.kind === 'movie') {
          const out = await X.video(p, {
            ...opts,
            signal: this.abort.signal,
            onProgress: progress,
          });
          result = out.blob;
          ext = out.ext;
        } else {
          const pages =
            opts.kind === 'page'
              ? [p.pages.find((pg) => pg.id === this.pageId)]
              : p.pages;
          result = await X.images(p, pages, opts.type, opts.scale, progress);
          ext = pages.length === 1 ? opts.type : 'zip';
        }
        if (this.abort.signal.aborted) throw Error('canceled');
        X.download(
          result,
          (p.name || 'design').replace(/[\\/]/g, '_') + '.' + ext,
        );
        this.toast(t('exportDone'));
      } finally {
        overlay.remove();
        this.exporting = false;
        this.abort = null;
      }
    }
    leave() {
      return !this.dirty || confirm(t('discardConfirm'));
    }
    fileName() {
      return (this.p.name || 'design').replace(/[\\/]/g, '_') + '.mvmdesign';
    }
    async projectOperation(label, task) {
      if (this.projectBusy || this.dead) return false;
      this.projectBusy = true;
      const overlay = document.createElement('div');
      overlay.className = 'md-modal md-project-busy';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = `<div class="md-modal-box"><span class="md-project-spinner" aria-hidden="true"></span><h3>${esc(t(label))}</h3><p class="md-note">${esc(t('projectWaitHint'))}</p></div>`;
      const previousFocus = document.activeElement;
      overlay.tabIndex = -1;
      const blockKeys = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
      this.root.addEventListener('keydown', blockKeys, true);
      this.root.setAttribute('aria-busy', 'true');
      this.root.appendChild(overlay);
      overlay.focus();
      try {
        // Allow a visible frame before parsing or serializing embedded media.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        return await task();
      } finally {
        overlay.remove();
        this.root.removeEventListener('keydown', blockKeys, true);
        this.root.removeAttribute('aria-busy');
        this.projectBusy = false;
        if (previousFocus?.isConnected) previousFocus.focus();
      }
    }
    async openFile(f) {
      if (!this.leave()) return;
      return this.projectOperation('openingProject', async () => {
        const p = M.normalize(JSON.parse(await f.text()));
        await this.installProject(p);
        this.root.querySelector('.md-project-home [data-cancel]')?.click();
        this.source = null;
        this.localRecentId = null;
        await this.rememberProject(null);
        this.renderState();
      });
    }
    async openPath(path) {
      if (this.publicMode) throw Error('accessDenied');
      if (!this.leave()) return false;
      return this.projectOperation('openingProject', async () => {
        const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
        if (!r.ok) throw Error('openFailed');
        await this.installProject(M.normalize(await r.json()));
        this.source = path;
        this.localRecentId = null;
        await this.rememberProject(path);
        this.renderState();
        this.root.querySelector('.md-project-dialog [data-cancel]')?.click();
      });
    }
    async installProject(p) {
      this.ai?.panel?.resetProject();
      this.stopRulerScroll();
      this.closeVideoPreview();
      this.projects?.detach();
      this.finishPropertyEdit();
      clearTimeout(this.draftTimer);
      this.pause();
      await R.prepare(p);
      this.p = p;
      this.cueId = null;
      this.styleScope = null;
      this.projectStarted = true;
      this.pageId = p.pages[0].id;
      this.itemId = null;
      this.clipIds = [];
      this.time = 0;
      this.undo = [];
      this.redo = [];
      this.recording = null;
      this.dirty = false;
      this.hasEdited = false;
      this.setAudio();
      this.renderPanels();
      this.draw();
      this.computePeaks();
    }
    async save(as = false) {
      this.finishPropertyEdit();
      if (
        this.projects &&
        (this.publicMode || this.projects.current || !this.source)
      )
        return this.projects.save(as);
      if (!this.source || as) {
        const places = await (await fetch('/api/files/places')).json();
        const picker =
          typeof FolderPicker !== 'undefined'
            ? FolderPicker
            : window.FolderPicker;
        if (!picker) {
          await this.action('download');
          return;
        }
        const dir = await new Promise((resolve) => {
          let done = false;
          picker.open({
            root: places.home || '/',
            title: t(as ? 'saveAs' : 'save'),
            onSelect: (v) => {
              done = true;
              resolve(v);
            },
          });
          const watch = setInterval(() => {
            if (!document.getElementById('fp-overlay')) {
              clearInterval(watch);
              if (!done) resolve(null);
            }
          }, 250);
        });
        if (!dir) return;
        const name = prompt(t('fileName'), this.fileName());
        if (!name?.trim()) return;
        const file =
          name.trim().replace(/[\\/]/g, '_') +
          (name.toLowerCase().endsWith('.mvmdesign') ? '' : '.mvmdesign');
        const list = await (
          await fetch('/api/files?path=' + encodeURIComponent(dir))
        ).json();
        if (
          (list.entries || []).some((e) => e.name === file) &&
          !confirm(t('overwriteConfirm'))
        )
          return;
        const path = dir.replace(/\/+$/, '') + '/' + file;
        await this.writeServer(path);
      } else await this.writeServer(this.source);
    }
    async writeServer(path) {
      if (this.publicMode) throw Error('accessDenied');
      return this.projectOperation('savingProject', async () => {
        const r = await fetch('/api/files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: JSON.stringify(this.p) }),
      });
      const d = await r.json();
      if (!r.ok || d.error || d.detail) throw Error('saveFailed');
      this.source = path;
      await this.rememberProject(path);
      this.dirty = false;
      this.renderState();
      this.toast(t('projectSaved'));
      });
    }
    async browseServer() {
      if (this.publicMode) throw Error('accessDenied');
      if (!this.leave()) return;
      const places = await (await fetch('/api/files/places')).json();
      let path = places.home || '/';
      const ov = this.modal(
        'openServer',
        '<div data-files></div>',
        () => false,
        'open',
      );
      ov.querySelector('[data-apply]').hidden = true;
      const list = ov.querySelector('[data-files]');
      const browse = async () => {
        const r = await fetch('/api/files?path=' + encodeURIComponent(path));
        if (!r.ok) throw Error('openFailed');
        const d = await r.json();
        list.innerHTML = `<p style="overflow-wrap:anywhere">${esc(path)}</p><button data-up>↑ ${esc(t('up'))}</button>${(
          d.entries || []
        )
          .filter(
            (e) =>
              e.is_dir ||
              e.type === 'directory' ||
              e.type === 'dir' ||
              e.name.endsWith('.mvmdesign'),
          )
          .map(
            (e, i) =>
              `<div class="md-row"><button data-entry="${i}">${e.is_dir || e.type === 'directory' || e.type === 'dir' ? '📁' : `<img class="md-file-icon" src="${esc(window.asset('/apps/mvmdesign/icon.svg'))}" alt="">`} ${esc(e.name)}</button></div>`,
          )
          .join('')}`;
        const entries = (d.entries || []).filter(
          (e) =>
            e.is_dir ||
            e.type === 'directory' ||
            e.type === 'dir' ||
            e.name.endsWith('.mvmdesign'),
        );
        list.querySelector('[data-up]').onclick = () => {
          path = path.split('/').slice(0, -1).join('/') || '/';
          browse().catch((e) => this.error(e));
        };
        list.querySelectorAll('[data-entry]').forEach(
          (b) =>
            (b.onclick = async () => {
              const e = entries[+b.dataset.entry],
                next = path.replace(/\/$/, '') + '/' + e.name;
              if (e.is_dir || e.type === 'directory' || e.type === 'dir') {
                path = next;
                await browse();
              } else {
                await this.openPath(next);
                ov.remove();
              }
            }),
        );
      };
      await browse();
    }
    async recentProjects() {
      await this.ready;
      if (!this.db) return [];
      return new Promise((resolve) => {
        const r = this.db
          .transaction('drafts')
          .objectStore('drafts')
          .get('recent:' + this.draftKey);
        r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
        r.onerror = () => resolve([]);
      });
    }
    async rememberProject(path, localCopy = false) {
      if (this.projects?.current && !localCopy) return;
      const project = path
        ? { name: this.p.name, width: this.p.width, height: this.p.height }
        : M.clone(this.p);
      await this.ready;
      if (!this.db || this.dead) return;
      const previous = await this.recentProjects();
      const id = path ? 'path:' + path : (this.localRecentId ||= M.uid());
      const entry = {
        id,
        name: project.name || t('untitled'),
        path,
        width: project.width,
        height: project.height,
      };
      try { entry.thumbnail = await this.projectThumbnail(this.p); } catch (_) {}
      // Browser imports cannot be reopened by path; retain the opened/saved copy locally.
      if (!path) entry.project = project;
      const entries = [entry, ...previous.filter((p) => p.id !== id)].slice(
        0,
        12,
      );
      await new Promise((resolve) => {
        const tx = this.db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(entries, 'recent:' + this.draftKey);
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => {
          this.toast(t('recentFailed'));
          resolve();
        };
      });
    }
    async projectThumbnail(project) {
      const p = M.normalize({ ...project, pages: [project.pages[0]], audio: null,
        captions: [], captionDrafts: [], captionStyles: [], sequence: [] });
      const renderer = R.createRenderer();
      await renderer.prepare(p);
      const canvas = document.createElement('canvas');
      const scale = 420 / Math.max(p.width, p.height);
      canvas.width = Math.max(1, Math.round(p.width * scale));
      canvas.height = Math.max(1, Math.round(p.height * scale));
      renderer.page(canvas.getContext('2d'), p, p.pages[0], canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.8);
    }
    previewCards(box, entries, selector, load) {
      const queue = [];
      let running = 0, stopped = false;
      const drain = () => {
        while (!stopped && running < 2 && queue.length) {
          const button = queue.shift();
          const entry = entries[+button.getAttribute(selector)];
          running++;
          Promise.resolve().then(async () => {
            if (stopped || !box.isConnected || this.dead) return;
            const src = entry.thumbnail || await this.projectThumbnail(await load(entry));
            if (stopped || !box.isConnected || this.dead) return;
            const image = document.createElement('img');
            image.src = src;
            image.alt = '';
            button.querySelector('.md-project-cover').replaceChildren(image);
          }).catch(() => {
            // Keep the cover placeholder when a file or font is unavailable.
          }).finally(() => { running--; drain(); });
        }
      };
      const observer = new IntersectionObserver((changes) => {
        for (const change of changes) {
          if (!change.isIntersecting) continue;
          observer.unobserve(change.target);
          queue.push(change.target);
        }
        drain();
      }, {root: box.querySelector('.md-project-dialog'), rootMargin: '100px'});
      box.querySelectorAll('[' + selector + ']').forEach(button => observer.observe(button));
      const cleanup = box.cleanup;
      box.cleanup = () => { stopped = true; queue.length = 0; observer.disconnect(); cleanup?.(); };
    }
    async projectDialog() {
      const entries = (await this.recentProjects()).filter(
        (entry) => !this.publicMode || !entry.path,
      );
      if (this.dead) return;
      const previous = this.root.querySelector('.md-project-dialog')?.closest('.md-modal');
      previous?.cleanup?.();
      previous?.remove();
      const startup = !this.projectStarted && !this.hasEdited && !this.dirty && !this.source && !this.projects?.current;
      const actions = [
        ['new', 'new', 'newProjectHint'],
        ['open-server', 'openServer', 'openServerHint'],
        ['open', 'open', 'openComputerHint'],
        ...(!startup ? [
          ['save', 'save', 'saveProjectHint'],
          ['save-as', 'saveAs', 'saveAsHint'],
          ['download', 'downloadProject', 'downloadHint'],
        ] : []),
        ['recover', 'recover', 'recoverHint'],
      ];
      const box = this.modal(
        'projects',
        `<div class="md-project-intro"><img src="${esc(window.asset('/apps/mvmdesign/icon.svg'))}" alt=""><div><h2>${esc(t(startup ? 'welcomeDesign' : 'projects'))}</h2><p class="md-note">${esc(t(startup ? 'chooseProjectHint' : 'projectFileHint'))}</p></div></div><div class="md-project-actions">${actions.map(([action, label, hint]) => `<button type="button" data-project-action="${action}"><strong>${esc(t(label))}</strong><span>${esc(t(hint))}</span></button>`).join('')}</div><h4>${esc(t('recentProjects'))}</h4><p class="md-note">${esc(t('recentHint'))}</p><div class="md-recent-list">${entries.length ? entries.map((entry, i) => `<div class="md-recent-row"><button type="button" data-recent="${i}"><div class="md-project-cover" aria-hidden="true"><span>▧</span></div><strong>${esc(entry.name)}</strong><span>${esc(entry.path || t('browserProjectCopy'))}</span><small>${entry.width} × ${entry.height} px</small></button><button type="button" data-forget="${i}" aria-label="${esc(t('forgetRecent'))}" title="${esc(t('forgetRecent'))}">×</button></div>`).join('') : `<p class="md-note">${esc(t('noRecentProjects'))}</p>`}</div>`,
        () => false,
      );
      box.querySelector('.md-modal-box').classList.add('md-project-dialog');
      box.classList.toggle('md-project-home', startup);
      if (startup) {
        box.querySelector('[data-cancel]').hidden = true;
        box.onkeydown = event => event.stopPropagation();
      }
      box.querySelector('.md-modal-box > h3').hidden = true;
      this.previewCards(box, entries, 'data-recent', async entry => {
        if (entry.project) return entry.project;
        const response = await fetch('/api/files/raw?path=' + encodeURIComponent(entry.path));
        if (!response.ok) throw Error('openFailed');
        return response.json();
      });
      box.querySelector('[data-apply]').hidden = true;
      box.querySelector('[data-cancel]').textContent = t('close');
      this.projects?.start(box).catch((e) => this.error(e));
      box.querySelectorAll('[data-project-action]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!startup) box.querySelector('[data-cancel]').click();
            try {
              await this.action(b.dataset.projectAction);
              if (startup && this.projectStarted) box.querySelector('[data-cancel]').click();
            } catch (e) {
              this.error(e);
            }
          }),
      );
      box.querySelectorAll('[data-recent]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            const entry = entries[+b.dataset.recent];
            try {
              if (entry.path) {
                if ((await this.openPath(entry.path)) === false) return;
              } else {
                if (!this.leave()) return;
                await this.projectOperation('openingProject', async () => {
                  await this.installProject(M.normalize(M.clone(entry.project)));
                  this.source = null;
                  this.localRecentId = entry.id;
                  await this.rememberProject(null);
                  this.renderState();
                });
              }
              box.querySelector('[data-cancel]').click();
            } catch (e) {
              this.toast(t('recentOpenFailed'));
            } finally {
              b.disabled = false;
            }
          }),
      );
      box.querySelectorAll('[data-forget]').forEach(
        (b) =>
          (b.onclick = async () => {
            const tx = this.db.transaction('drafts', 'readwrite');
            tx.objectStore('drafts').put(
              entries.filter((_, i) => i !== +b.dataset.forget),
              'recent:' + this.draftKey,
            );
            tx.oncomplete = () => {
              box.querySelector('[data-cancel]').click();
              this.projectDialog().catch((e) => this.error(e));
            };
          }),
      );
    }
    async initDraft() {
      try {
        const res = this.publicMode ? null : await fetch('/api/auth/whoami');
        if (this.publicMode)
          this.draftKey = 'draft:public:' + this.projects.user.id;
        if (res?.ok) {
          const me = await res.json();
          this.draftKey =
            'draft:' + (me.effective_user || me.username || me.id || 'desktop');
        }
        this.db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('mvmdesign', 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore('drafts');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } catch (_) {
        this.toast(t('draftFailed'));
      }
    }
    scheduleDraft() {
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => this.storeDraft(), 800);
    }
    storeDraft(force = false) {
      if (this.publicMode && this.projects?.current) return;
      if (!this.db || (!force && !this.dirty && !this.hasEdited)) return;
      try {
        const tx = this.db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(this.p, this.draftKey);
        tx.onabort = () => this.toast(t('draftFailed'));
      } catch (_) {
        this.toast(t('draftFailed'));
      }
    }
    async recover() {
      if (!this.db) {
        this.toast(t('noDraft'));
        return;
      }
      const p = await new Promise((resolve, reject) => {
        const r = this.db
          .transaction('drafts')
          .objectStore('drafts')
          .get(this.draftKey);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (!p) {
        this.toast(t('noDraft'));
        return;
      }
      if (this.leave()) {
        await this.installProject(M.normalize(p));
        this.source = null;
        this.localRecentId = null;
        this.dirty = true;
        this.renderState();
      }
    }
    toast(message) {
      this.root.querySelector('.md-toast')?.remove();
      const el = document.createElement('div');
      el.className = 'md-toast';
      el.setAttribute('role', 'status');
      el.textContent = message;
      this.root.appendChild(el);
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.remove(), 6000);
    }
    error(e) {
      console.error('mvmDesign', e);
      const k = e?.message;
      this.toast(window.MvmDesignI18n.en[k] ? t(k) : t('failed'));
    }
    destroy() {
      if (this.dead) return;
      this.stopRulerScroll();
      this.finishPropertyEdit();
      this.closeVideoPreview();
      this.closeDraftMenu();
      this.animationPickerClose?.();
      this.fontPickerAbort?.abort();
      this.stylePreviewCache.clear();
      if (this.cueDrag) {
        this.p = this.cueDrag.before;
        this.cueDrag = null;
      }
      this.storeDraft();
      this.ai?.destroy();
      this.projects?.destroy();
      this.pause();
      this.dead = true;
      this.abort?.abort();
      this.resize.disconnect();
      this.db?.close();
      this.audio.removeAttribute('src');
      this.audio.load();
      clearTimeout(this.draftTimer);
      clearTimeout(this.toastTimer);
      window.removeEventListener('beforeunload', this.unload);
      window.removeEventListener('blur', this.rulerBlur);
    }
  }
  window.MvmDesign = { Editor };
})();
