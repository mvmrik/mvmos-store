// mvmVideo — the editor window: media list, preview and timeline.
//
// A project is plain JSON (.mvmvideo). It holds the tracks, the clips on
// them and where each source file lives; the sources themselves are never
// copied into it. Files from the server are referenced by path and read
// again when the project is opened. Files added from the computer only
// exist in this browser, so a reopened project asks for them to be found
// again.
//
// Clip times are in seconds: start is the position on the timeline, in/out
// the part of the source that is used (for a still image in is 0 and out is
// how long it stays on screen).
(function () {
  const Media = () => window.MvmVideoMedia;
  const Exporter = () => window.MvmVideoExport;
  const EXT = '.mvmvideo';
  const HEADER_W = 132;
  const IMAGE_SECONDS = 5;
  const SNAP_PX = 8;
  const MAX_HISTORY = 200;
  const FPS_CHOICES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const SIZE_PRESETS = [
    [3840, 2160], [2560, 1440], [1920, 1080], [1280, 720],
    [1080, 1920], [720, 1280], [1080, 1080],
  ];

  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  function even(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; }
  const folderPicker = () => (typeof FolderPicker !== 'undefined' ? FolderPicker : null);

  function fmtTime(sec, fps) {
    sec = Math.max(0, sec || 0);
    const f = fps ? Math.floor((sec - Math.floor(sec)) * fps + 1e-6) : 0;
    const s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
    const p2 = n => String(n).padStart(2, '0');
    return (h ? h + ':' + p2(m) : String(m)) + ':' + p2(s) + (fps ? ':' + p2(f) : '');
  }
  function fmtShort(sec) {
    sec = Math.max(0, sec || 0);
    const s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1e3)) + ' KB';
  }
  function fmtFps(f) { return String(Math.round(f * 1000) / 1000); }

  function newProject() {
    return {
      format: 'mvmvideo', version: 1,
      name: '', width: 1920, height: 1080, fps: 30, auto: true,
      tracks: [
        { id: uid('t'), kind: 'video', muted: false, hidden: false, volume: 1 },
        { id: uid('t'), kind: 'video', muted: false, hidden: false, volume: 1 },
        { id: uid('t'), kind: 'audio', muted: false, hidden: false, volume: 1 },
        { id: uid('t'), kind: 'audio', muted: false, hidden: false, volume: 1 },
      ],
      media: [],
      clips: [],
    };
  }

  // Only what a project file may contain, whatever was handed in.
  function normalize(raw) {
    if (!raw || raw.format !== 'mvmvideo') throw new Error('not_project');
    const p = newProject();
    p.name = String(raw.name || '');
    p.width = even(+raw.width || 1920);
    p.height = even(+raw.height || 1080);
    p.fps = +raw.fps > 0 && +raw.fps <= 240 ? +raw.fps : 30;
    p.auto = !!raw.auto;
    const tracks = Array.isArray(raw.tracks) ? raw.tracks.filter(x => x && (x.kind === 'video' || x.kind === 'audio')) : [];
    if (tracks.length) p.tracks = tracks.map(x => ({ id: String(x.id || uid('t')), kind: x.kind, muted: !!x.muted, hidden: !!x.hidden, volume: x.volume == null ? 1 : Math.min(2, Math.max(0, +x.volume || 0)) }));
    p.media = (Array.isArray(raw.media) ? raw.media : []).filter(m => m && m.id && ['video', 'audio', 'image'].includes(m.kind)).map(m => ({
      id: String(m.id), name: String(m.name || ''), kind: m.kind,
      path: m.path ? String(m.path) : null, size: +m.size || 0,
      duration: +m.duration || 0, width: +m.width || 0, height: +m.height || 0,
      hasAudio: !!m.hasAudio, fps: +m.fps || 0,
    }));
    const mids = new Set(p.media.map(m => m.id));
    const tids = new Set(p.tracks.map(x => x.id));
    p.clips = (Array.isArray(raw.clips) ? raw.clips : []).filter(c => c && mids.has(c.media) && tids.has(c.track)).map(c => {
      const o = {
        id: String(c.id || uid('c')), track: String(c.track), media: String(c.media),
        start: Math.max(0, +c.start || 0), in: Math.max(0, +c.in || 0), out: Math.max(0, +c.out || 0),
        volume: c.volume == null ? 1 : Math.min(2, Math.max(0, +c.volume)),
      };
      const fx = normFx(c.fx);
      if (fx) o.fx = fx;
      if (c.silent) o.silent = true;
      if (c.link) o.link = String(c.link);
      return o;
    }).filter(c => c.out > c.in);
    return p;
  }

  function normFx(f) {
    if (!f || typeof f !== 'object') return null;
    const n = (v, max) => Math.min(max, Math.max(0, Math.round((+v || 0) * 10) / 10));
    const o = { fadeIn: n(f.fadeIn, 60), fadeOut: n(f.fadeOut, 60), rumble: !!f.rumble, voice: !!f.voice, level: !!f.level, hiss: !!f.hiss };
    return window.MvmVideoExport.fxActive(o) ? o : null;
  }

  const clipLen = c => c.out - c.in;
  const clipEnd = c => c.start + clipLen(c);

  let styleAdded = false;
  function addStyle() {
    if (styleAdded || document.getElementById('mv-style')) return;
    styleAdded = true;
    const st = document.createElement('style');
    st.id = 'mv-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  class Editor {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.project = newProject();
      this.rt = new Map();            // media id -> { blob, info, status, progress, thumb, peaks, file }
      this.source = null;             // where the project file lives: { kind: 'server', path } | { kind: 'local', name }
      this.dirty = false;
      this.undoStack = [];
      this.redoStack = [];
      this.selected = null;
      this.pps = 40;                  // timeline pixels per second
      this.snap = true;
      this.exporting = null;
      addStyle();
      this.build();
      this.preview = new window.MvmVideoPreview(this.canvas, {
        project: () => this.project,
        media: id => { const r = this.rt.get(id); return r && r.status === 'ready' ? r : null; },
        onTime: tm => this.showTime(tm),
        onState: playing => { this.playBtn.textContent = playing ? '⏸' : '▶'; },
      });
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.root);
      this.langHandler = () => { if (!this.dead) this.render(); };
      if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(this.langHandler);
      this.render();
      if (this.opts.openPath) this.openServerProject(this.opts.openPath);
    }

    // ── Skeleton ─────────────────────────────────────────────────────────
    build() {
      this.root.classList.add('mv-root');
      this.root.tabIndex = 0;
      this.root.innerHTML = `
        <div class="mv-bar"></div>
        <div class="mv-main">
          <div class="mv-lib">
            <div class="mv-lib-head"></div>
            <div class="mv-lib-list"></div>
          </div>
          <div class="mv-view">
            <div class="mv-stage"><canvas class="mv-canvas"></canvas></div>
            <div class="mv-transport">
              <div class="mv-tp-left">
                <button class="mv-ibtn" data-a="start">⏮</button>
                <button class="mv-ibtn mv-play" data-a="play">▶</button>
                <button class="mv-ibtn" data-a="end">⏭</button>
                <span class="mv-time"></span>
              </div>
            </div>
          </div>
          <div class="mv-panel"><div class="mv-tabs"></div><div class="mv-pbody"></div></div>
        </div>
        <div class="mv-tl">
          <div class="mv-tl-tools"></div>
          <div class="mv-tl-scroll">
            <div class="mv-tl-inner">
              <div class="mv-ruler-row"><div class="mv-corner"></div><canvas class="mv-ruler"></canvas></div>
              <div class="mv-rows"></div>
              <div class="mv-playhead"></div>
            </div>
          </div>
        </div>
        <div class="mv-toasts"></div>
        <div class="mv-drop-hint"></div>`;
      const q = s => this.root.querySelector(s);
      this.bar = q('.mv-bar');
      this.libHead = q('.mv-lib-head');
      this.libList = q('.mv-lib-list');
      this.stage = q('.mv-stage');
      this.canvas = q('.mv-canvas');
      this.timeEl = q('.mv-time');
      this.playBtn = q('.mv-play');
      this.tabsEl = q('.mv-tabs');
      this.pbody = q('.mv-pbody');
      this.tlTools = q('.mv-tl-tools');
      this.scroll = q('.mv-tl-scroll');
      this.inner = q('.mv-tl-inner');
      this.rows = q('.mv-rows');
      this.ruler = q('.mv-ruler');
      this.playhead = q('.mv-playhead');
      this.dropHint = q('.mv-drop-hint');

      q('.mv-tp-left').addEventListener('click', e => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'play') this.preview.toggle();
        else if (a.dataset.a === 'start') this.seek(0);
        else if (a.dataset.a === 'end') this.seek(this.duration());
      });
      this.scroll.addEventListener('scroll', () => this.drawRuler());
      this.scroll.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = this.scroll.getBoundingClientRect();
        this.zoomAt(this.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left - HEADER_W);
      }, { passive: false });
      this.inner.addEventListener('pointerdown', e => this.onTimelineDown(e));
      this.root.addEventListener('keydown', e => this.onKey(e));
      this.root.addEventListener('dragover', e => this.onDragOver(e));
      this.root.addEventListener('dragleave', e => { if (e.target === this.root || !this.root.contains(e.relatedTarget)) this.showDropHint(false); });
      this.root.addEventListener('drop', e => this.onDrop(e));
    }

    // ── Rendering ────────────────────────────────────────────────────────
    render() {
      this.renderBar();
      this.renderLibrary();
      this.renderTimeline();
      this.renderInspector();
      this.showTime(this.preview ? this.preview.time : 0);
      this.dropHint.textContent = t('mv_drop_hint');
    }

    renderBar() {
      const name = this.project.name || t('mv_untitled');
      this.bar.innerHTML = `
        <button class="mv-btn" data-a="project">📁 ${esc(t('mv_project'))} ▾</button>
        <button class="mv-btn" data-a="save" title="Ctrl+S">💾 ${esc(t('mv_save'))}</button>
        <span class="mv-sep"></span>
        <button class="mv-ibtn" data-a="undo" title="${esc(t('mv_undo'))} (Ctrl+Z)" ${this.undoStack.length ? '' : 'disabled'}>↶</button>
        <button class="mv-ibtn" data-a="redo" title="${esc(t('mv_redo'))} (Ctrl+Y)" ${this.redoStack.length ? '' : 'disabled'}>↷</button>
        <span class="mv-sep"></span>
        <button class="mv-name" data-a="rename" title="${esc(t('mv_rename'))}">${esc(name)}${this.dirty ? ' •' : ''}</button>
        <span class="mv-spec">${this.project.width}×${this.project.height} · ${fmtFps(this.project.fps)} fps</span>
        <span class="mv-grow"></span>
        <button class="mv-btn" data-a="settings">⚙ ${esc(t('mv_settings'))}</button>
        <button class="mv-btn mv-primary" data-a="export">⬇ ${esc(t('mv_export'))}</button>`;
      this.bar.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'project') this.projectMenu(b);
        else if (a === 'save') this.save();
        else if (a === 'undo') this.undo();
        else if (a === 'redo') this.redo();
        else if (a === 'rename') this.rename();
        else if (a === 'settings') this.settingsDialog();
        else if (a === 'export') this.exportDialog();
      };
    }

    projectMenu(anchor) {
      const items = [
        { icon: '📄', label: t('mv_new_project'), onClick: () => this.newProject() },
      ];
      if (this.opts.desktop) items.push({ icon: '🗄', label: t('mv_open_server'), onClick: () => this.openFromServer() });
      items.push({ icon: '💻', label: t('mv_open_computer'), onClick: () => this.openFromComputer() });
      items.push({ sep: true });
      if (this.opts.desktop) items.push({ icon: '🗄', label: t('mv_save_to_folder'), onClick: () => this.saveToFolder() });
      items.push({ icon: '⬇', label: t('mv_download_project'), onClick: () => this.downloadProject() });
      const r = anchor.getBoundingClientRect();
      this.menu(r.left, r.bottom + 4, items);
    }

    renderLibrary() {
      this.libHead.innerHTML = `
        <div class="mv-lib-title">${esc(t('mv_media'))}</div>
        <div class="mv-lib-actions">
          ${this.opts.desktop ? `<button class="mv-btn mv-small" data-a="server" title="${esc(t('mv_add_server_hint'))}">🗄 ${esc(t('mv_add_server'))}</button>` : ''}
          <button class="mv-btn mv-small" data-a="computer" title="${esc(t('mv_add_computer_hint'))}">💻 ${esc(t('mv_add_computer'))}</button>
        </div>`;
      this.libHead.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'server') this.addFromServer();
        else this.addFromComputer();
      };
      const list = this.project.media;
      if (!list.length) {
        this.libList.innerHTML = `<div class="mv-empty">${esc(t('mv_no_media'))}</div>`;
        return;
      }
      this.libList.innerHTML = list.map(m => this.mediaItemHTML(m)).join('');
      this.libList.querySelectorAll('.mv-item').forEach(el => {
        const id = el.dataset.id;
        el.addEventListener('dragstart', e => {
          if (!this.isReady(id)) { e.preventDefault(); return; }
          e.dataTransfer.setData('application/x-mvmvideo-media', id);
          e.dataTransfer.effectAllowed = 'copy';
          this.draggingMedia = id;
        });
        el.addEventListener('dragend', () => { this.draggingMedia = null; this.clearGhost(); });
        el.addEventListener('dblclick', () => this.appendMedia(id));
        el.addEventListener('click', e => {
          const b = e.target.closest('[data-a]');
          if (!b) return;
          e.stopPropagation();
          if (b.dataset.a === 'add') this.appendMedia(id);
          else if (b.dataset.a === 'remove') this.removeMedia(id);
          else if (b.dataset.a === 'relink') this.relinkMedia(id);
          else if (b.dataset.a === 'retry') this.loadMedia(this.mediaDesc(id));
        });
      });
    }

    mediaItemHTML(m) {
      const r = this.rt.get(m.id) || {};
      const icon = m.kind === 'audio' ? '🎵' : m.kind === 'image' ? '🖼' : '🎬';
      const thumb = r.thumb ? `<img src="${r.thumb}" alt="">` : `<span class="mv-thumb-icon">${icon}</span>`;
      let meta = '';
      if (m.kind === 'image') meta = m.width ? `${m.width}×${m.height}` : '';
      else meta = fmtShort(m.duration) + (m.width ? ` · ${m.width}×${m.height}` : '');
      let status = '';
      if (r.status === 'loading') status = `<div class="mv-item-status">${esc(t('mv_loading'))} ${r.progress != null ? Math.round(r.progress * 100) + '%' : ''}</div>`;
      else if (r.status === 'missing') status = `<div class="mv-item-status mv-bad">${esc(t('mv_missing'))} <button class="mv-link" data-a="relink">${esc(t('mv_find_file'))}</button></div>`;
      else if (r.status === 'error') status = `<div class="mv-item-status mv-bad">${esc(t(r.error === 'codec' ? 'mv_err_codec' : r.error === 'read_failed' || r.error === 'not_found' ? 'mv_err_read' : 'mv_err_unsupported'))} <button class="mv-link" data-a="retry">${esc(t('mv_retry'))}</button></div>`;
      const used = this.project.clips.some(c => c.media === m.id);
      return `<div class="mv-item${r.status === 'ready' ? '' : ' mv-item-off'}" data-id="${esc(m.id)}" draggable="${r.status === 'ready'}" title="${esc(m.path || m.name)}">
        <div class="mv-thumb">${thumb}</div>
        <div class="mv-item-body">
          <div class="mv-item-name">${used ? '<span class="mv-used" title="' + esc(t('mv_in_use')) + '">●</span> ' : ''}${esc(m.name)}</div>
          <div class="mv-item-meta">${esc(meta)}${m.path ? '' : ' · ' + esc(t('mv_from_computer'))}</div>
          ${status}
        </div>
        <div class="mv-item-actions">
          ${r.status === 'ready' ? `<button class="mv-ibtn mv-small" data-a="add" title="${esc(t('mv_add_to_timeline'))}">＋</button>` : ''}
          <button class="mv-ibtn mv-small" data-a="remove" title="${esc(t('mv_remove_media'))}">✕</button>
        </div>
      </div>`;
    }

    trackLabel(tr) {
      const same = this.project.tracks.filter(x => x.kind === tr.kind);
      if (tr.kind === 'video') return 'V' + (same.length - same.indexOf(tr));
      return 'A' + (same.indexOf(tr) + 1);
    }

    contentWidth() {
      const visible = Math.max(200, this.scroll.clientWidth - HEADER_W);
      return Math.max(visible, (this.duration() + 30) * this.pps);
    }

    renderTimeline() {
      const p = this.project;
      this.tlTools.innerHTML = `
        <button class="mv-btn mv-small" data-a="split" title="${esc(t('mv_split'))} (S)">✂ ${esc(t('mv_split'))}</button>
        <button class="mv-btn mv-small" data-a="delete" title="${esc(t('mv_delete_clip'))} (Delete)" ${this.selectedClip() ? '' : 'disabled'}>🗑 ${esc(t('mv_delete_clip'))}</button>
        <span class="mv-sep"></span>
        <button class="mv-btn mv-small${this.snap ? ' mv-on' : ''}" data-a="snap" title="${esc(t('mv_snap_hint'))}">🧲 ${esc(t('mv_snap'))}</button>
        <span class="mv-sep"></span>
        <button class="mv-ibtn mv-small" data-a="zout" title="${esc(t('mv_zoom_out'))}">−</button>
        <button class="mv-btn mv-small" data-a="zfit" title="${esc(t('mv_zoom_fit'))}">↔</button>
        <button class="mv-ibtn mv-small" data-a="zin" title="${esc(t('mv_zoom_in'))}">＋</button>
        <span class="mv-grow"></span>
        <button class="mv-btn mv-small mv-rec" data-a="rec" title="${esc(t('mv_rec_hint'))}">🎙 ${esc(t('mv_rec'))}</button>
        <span class="mv-sep"></span>
        <button class="mv-btn mv-small" data-a="addv">＋ ${esc(t('mv_add_video_track'))}</button>
        <button class="mv-btn mv-small" data-a="adda">＋ ${esc(t('mv_add_audio_track'))}</button>`;
      this.tlTools.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'split') this.split();
        else if (a === 'delete') this.deleteSelected();
        else if (a === 'snap') { this.snap = !this.snap; this.renderTimeline(); }
        else if (a === 'zin') this.zoomAt(this.pps * 1.5);
        else if (a === 'zout') this.zoomAt(this.pps / 1.5);
        else if (a === 'zfit') this.zoomFit();
        else if (a === 'rec') this.recordDialog();
        else if (a === 'addv') this.addTrack('video');
        else if (a === 'adda') this.addTrack('audio');
      };

      const width = this.contentWidth();
      this.inner.style.width = (HEADER_W + width) + 'px';
      this.rows.innerHTML = p.tracks.map(tr => `
        <div class="mv-row mv-row-${tr.kind}" data-track="${esc(tr.id)}">
          <div class="mv-th${this.selTrack === tr.id ? ' mv-th-sel' : ''}">
            <span class="mv-th-name" data-ta="sel" title="${esc(t('mv_track_settings'))}">${this.trackLabel(tr)}</span>
            ${tr.kind === 'video' ? `<button class="mv-ibtn mv-tiny${tr.hidden ? ' mv-off' : ''}" data-ta="hide" title="${esc(t(tr.hidden ? 'mv_show_track' : 'mv_hide_track'))}">${tr.hidden ? '🙈' : '👁'}</button>` : ''}
            <button class="mv-ibtn mv-tiny${tr.muted ? ' mv-off' : ''}" data-ta="mute" title="${esc(t(tr.muted ? 'mv_unmute_track' : 'mv_mute_track'))}">${tr.muted ? '🔇' : '🔊'}</button>
            <button class="mv-ibtn mv-tiny" data-ta="remove" title="${esc(t('mv_remove_track'))}">✕</button>
          </div>
          <div class="mv-lane" style="width:${width}px">${p.clips.filter(c => c.track === tr.id).map(c => this.clipHTML(c)).join('')}</div>
        </div>`).join('');
      this.rows.querySelectorAll('.mv-th').forEach(th => {
        th.addEventListener('click', e => {
          const b = e.target.closest('[data-ta]');
          if (!b) return;
          const id = th.parentElement.dataset.track;
          if (b.dataset.ta === 'sel') this.selectTrack(id);
          else if (b.dataset.ta === 'hide') this.commit(() => { const tr = this.track(id); tr.hidden = !tr.hidden; });
          else if (b.dataset.ta === 'mute') this.commit(() => { const tr = this.track(id); tr.muted = !tr.muted; });
          else this.removeTrack(id);
        });
      });
      this.rows.querySelectorAll('canvas.mv-wave').forEach(cv => this.drawWave(cv));
      this.updatePlayhead();
      this.drawRuler();
    }

    clipHTML(c) {
      const m = this.mediaDesc(c.media);
      const r = this.rt.get(c.media) || {};
      const w = Math.max(2, clipLen(c) * this.pps);
      const onAudio = this.clipKind(c) === 'audio';
      const bg = r.thumb && !onAudio && m.kind !== 'audio' ? `background-image:url(${r.thumb})` : '';
      const sounds = (m.kind === 'audio' || m.hasAudio) && !c.silent;
      const canvas = `<canvas class="mv-wave" data-clip="${esc(c.id)}"></canvas>`;
      // The sound of a video that is still part of it is drawn as a strip
      // under the picture, like a track of its own.
      const strip = m.kind === 'video' && !onAudio && sounds && r.peaks;
      const wave = !strip && onAudio && r.peaks ? canvas : '';
      const vol = c.volume !== 1 && sounds ? ` · ${Math.round(c.volume * 100)}%` : '';
      const off = m.kind === 'video' && !onAudio && m.hasAudio && c.silent ? ' · 🔇' : '';
      const bad = r.status !== 'ready' ? ' mv-clip-bad' : '';
      const cls = onAudio && m.kind === 'video' ? 'audio' : m.kind;
      return `<div class="mv-clip mv-clip-${cls}${strip ? ' mv-clip-split' : ''}${this.selected === c.id ? ' mv-sel' : ''}${bad}" data-clip="${esc(c.id)}" style="left:${c.start * this.pps}px;width:${w}px;${bg}">
        ${wave}
        ${strip ? `<div class="mv-snd">${canvas}${w > 24 ? this.fadeHTML(c) : ''}</div>` : ''}
        ${!strip && sounds && (onAudio || m.kind === 'audio') && w > 24 ? this.fadeHTML(c) : ''}
        <div class="mv-clip-label">${esc(m.name)}${vol}${off}${window.MvmVideoExport.fxActive(c.fx) ? ' · 🎚' : ''}</div>
        <div class="mv-h mv-h-l" data-h="l"></div><div class="mv-h mv-h-r" data-h="r"></div>
      </div>`;
    }

    drawWave(cv) {
      const c = this.clip(cv.dataset.clip);
      if (!c) return;
      const r = this.rt.get(c.media);
      if (!r || !r.peaks) return;
      const box = cv.parentElement;
      const w = Math.min(4000, Math.max(1, Math.round(clipLen(c) * this.pps)));
      const h = Math.max(1, box.clientHeight || 40);
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      const pps = Media().PEAKS_PER_SEC;
      const from = c.in * pps, to = c.out * pps;
      const scale = Math.max(0.05, c.volume * window.MvmVideoExport.trackVol(this.track(c.track)));
      for (let x = 0; x < w; x++) {
        const a = Math.floor(from + (to - from) * x / w), b = Math.max(a + 1, Math.floor(from + (to - from) * (x + 1) / w));
        let peak = 0;
        for (let k = a; k < b && k < r.peaks.length; k++) if (r.peaks[k] > peak) peak = r.peaks[k];
        const ph = Math.min(1, peak * scale) * (h - 4);
        ctx.fillRect(x, (h - ph) / 2, 1, Math.max(1, ph));
      }
    }

    drawRuler() {
      const cv = this.ruler;
      const w = Math.max(1, this.scroll.clientWidth - HEADER_W);
      const dpr = window.devicePixelRatio || 1;
      const H = 22;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.style.width = w + 'px'; }
      cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      const style = getComputedStyle(this.root);
      ctx.strokeStyle = style.getPropertyValue('--text-dim') || '#888';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px sans-serif';
      const steps = [1 / this.project.fps, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
      const step = steps.find(s => s * this.pps >= 70) || 3600;
      const minor = step / 5;
      const left = this.scroll.scrollLeft / this.pps;
      const right = left + w / this.pps;
      ctx.beginPath();
      // Counted in whole ticks, so labels never drift from adding up fractions.
      for (let i = Math.floor(left / minor); i * minor <= right; i++) {
        const s = i * minor;
        const x = Math.round((s - left) * this.pps) + 0.5;
        const major = i % 5 === 0;
        ctx.moveTo(x, H); ctx.lineTo(x, major ? 8 : 16);
        if (major) ctx.fillText(step < 1 ? fmtTime(s + 1e-6, this.project.fps) : fmtShort(s + 1e-6), x + 3, 9);
      }
      ctx.stroke();
    }

    // The panel to the right of the preview: tabs for the selected clip, or
    // the settings of a selected track.
    renderInspector() {
      const X = window.MvmVideoExport;
      const c = this.selectedClip();
      const tr = !c && this.selTrack ? this.track(this.selTrack) : null;
      this.tabsEl.innerHTML = '';
      if (!c && !tr) { this.pbody.innerHTML = `<div class="mv-empty">${esc(t('mv_panel_empty'))}</div>`; return; }
      const box = this.pbody;
      const volRow = (id, label, v) => `<div class="mv-prow"><span>${esc(label)}</span><div class="mv-vrow"><input type="range" data-r="${id}" min="0" max="200" step="1" value="${v}"><input type="number" class="mv-num" data-n="${id}" min="0" max="200" step="1" value="${v}"><b>%</b></div></div>`;
      const bindVol = (id, apply) => {
        const r = box.querySelector(`[data-r="${id}"]`), n = box.querySelector(`[data-n="${id}"]`);
        let before = null;
        const set = v => {
          v = Math.min(200, Math.max(0, Math.round(+v || 0)));
          r.value = v; n.value = v;
          apply(v / 100);
          this.rows.querySelectorAll('canvas.mv-wave').forEach(cv => this.drawWave(cv));
          this.preview.sync();
        };
        r.addEventListener('pointerdown', () => { before = this.snapshot(); });
        r.addEventListener('input', () => { if (!before) before = this.snapshot(); set(r.value); });
        r.addEventListener('change', () => { if (before) this.pushHistory(before); before = null; this.changed(); });
        n.addEventListener('change', () => { const b = this.snapshot(); set(n.value); this.pushHistory(b); this.changed(); });
      };

      if (tr) {
        const pct = Math.round(X.trackVol(tr) * 100);
        box.innerHTML = `<div class="mv-ptitle">${esc(t('mv_track'))} ${esc(this.trackLabel(tr))}</div>
          ${volRow('track', t('mv_track_volume'), pct)}
          <label class="mv-fx-toggle"><input type="checkbox" data-tm ${tr.muted ? 'checked' : ''}><span>${esc(t('mv_mute_track'))}</span></label>
          ${tr.kind === 'video' ? `<label class="mv-fx-toggle"><input type="checkbox" data-th ${tr.hidden ? 'checked' : ''}><span>${esc(t('mv_hide_track'))}</span></label>` : ''}`;
        bindVol('track', v => { tr.volume = v; });
        box.querySelector('[data-tm]').addEventListener('change', e => this.commit(() => { tr.muted = e.target.checked; }));
        const hb = box.querySelector('[data-th]');
        if (hb) hb.addEventListener('change', e => this.commit(() => { tr.hidden = e.target.checked; }));
        return;
      }

      const m = this.mediaDesc(c.media);
      const onAudio = this.clipKind(c) === 'audio';
      const hasSound = (m.kind === 'audio' || m.hasAudio) && !c.silent;
      const tabs = onAudio || m.kind === 'audio' ? ['audio', 'fx', 'clip'] : ['clip', 'audio', 'fx'];
      const avail = tabs.filter(k => k === 'clip' || (k === 'audio' && (hasSound || (m.kind === 'video' && m.hasAudio))) || (k === 'fx' && hasSound));
      if (!avail.includes(this.tab)) this.tab = avail[0];
      const label = { clip: t('mv_tab_clip'), audio: t('mv_tab_audio'), fx: t('mv_tab_fx') };
      this.tabsEl.innerHTML = avail.map(k => `<button class="mv-tab${k === this.tab ? ' mv-on' : ''}" data-tab="${k}">${esc(label[k])}</button>`).join('');
      this.tabsEl.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { this.tab = b.dataset.tab; this.renderInspector(); } };
      const fx = c.fx || {};

      if (this.tab === 'clip') {
        const bits = [fmtTime(clipLen(c), this.project.fps)];
        if (m.width) bits.push(`${m.width}×${m.height}`);
        if (m.fps) bits.push(fmtFps(m.fps) + ' fps');
        box.innerHTML = `<div class="mv-ptitle" title="${esc(m.name)}">${esc(m.name)}</div><div class="mv-dim">${esc(bits.join(' · '))}</div>
          ${m.kind === 'image' ? `<div class="mv-prow"><span>${esc(t('mv_duration'))}</span><input type="number" class="mv-num" data-f="dur" min="0.1" step="0.5" value="${Math.round(clipLen(c) * 100) / 100}"> s</div>` : ''}
          ${m.kind === 'video' && !onAudio && m.hasAudio && c.silent ? `<div class="mv-note">🔇 ${esc(t('mv_sound_detached'))}</div>` : ''}`;
        const dur = box.querySelector('[data-f="dur"]');
        if (dur) dur.addEventListener('change', () => {
          const v = Math.max(0.1, +dur.value || IMAGE_SECONDS);
          const next = this.project.clips.filter(x => x.track === c.track && x.start >= clipEnd(c) - 1e-6 && x.id !== c.id).sort((a, b) => a.start - b.start)[0];
          const maxLen = next ? next.start - c.start : Infinity;
          this.commit(() => { c.out = c.in + Math.min(v, maxLen); });
        });
      } else if (this.tab === 'audio') {
        if (!hasSound) {
          box.innerHTML = `<div class="mv-note">🔇 ${esc(t('mv_sound_detached'))}</div>`;
          return;
        }
        const canDetach = m.kind === 'video' && !onAudio && m.hasAudio && !c.silent;
        const canJoin = !!this.joinTarget(c);
        const trk = this.track(c.track);
        const fade = (k, l) => `<div class="mv-prow"><span>${esc(t(l))}</span><input type="number" class="mv-num" data-fade="${k}" min="0" max="60" step="0.1" value="${(fx[k] || 0).toFixed(1)}"> s</div>`;
        box.innerHTML = `<div class="mv-ptitle" title="${esc(m.name)}">${esc(m.name)}</div>
          ${volRow('clip', t('mv_clip_volume'), Math.round(c.volume * 100))}
          ${volRow('track', t('mv_track_volume') + ' (' + this.trackLabel(trk) + ')', Math.round(X.trackVol(trk) * 100))}
          ${fade('fadeIn', 'mv_fx_fade_in')}${fade('fadeOut', 'mv_fx_fade_out')}
          <div class="mv-dim mv-hint">${esc(t('mv_fade_drag_hint'))}</div>
          ${canDetach ? `<button class="mv-btn mv-wide" data-f="detach" title="${esc(t('mv_detach_hint'))}">⛓ ${esc(t('mv_detach'))}</button>` : ''}
          ${canJoin ? `<button class="mv-btn mv-wide" data-f="attach" title="${esc(t('mv_attach_hint'))}">🔗 ${esc(t('mv_attach'))}</button>` : ''}`;
        bindVol('clip', v => { c.volume = v; });
        bindVol('track', v => { trk.volume = v; });
        box.querySelectorAll('[data-fade]').forEach(inp => inp.addEventListener('change', () => this.commit(() => this.setFade(c, inp.dataset.fade, +inp.value))));
        const d = box.querySelector('[data-f="detach"]'); if (d) d.addEventListener('click', () => this.detachAudio());
        const a = box.querySelector('[data-f="attach"]'); if (a) a.addEventListener('click', () => this.attachAudio());
      } else {
        const toggles = [
          ['rumble', 'mv_fx_rumble', 'mv_fx_rumble_hint'],
          ['voice', 'mv_fx_voice', 'mv_fx_voice_hint'],
          ['level', 'mv_fx_level', 'mv_fx_level_hint'],
          ['hiss', 'mv_fx_hiss', 'mv_fx_hiss_hint'],
        ];
        box.innerHTML = `<div class="mv-dim mv-hint">${esc(t('mv_fx_hint'))}</div>` + toggles.map(([k, l, h]) => `<label class="mv-fx-toggle"><input type="checkbox" data-fx="${k}" ${fx[k] ? 'checked' : ''}><span><b>${esc(t(l))}</b><br><small class="mv-dim">${esc(t(h))}</small></span></label>`).join('');
        box.querySelectorAll('[data-fx]').forEach(inp => inp.addEventListener('change', () => this.commit(() => {
          const f = c.fx = Object.assign({ fadeIn: 0, fadeOut: 0, rumble: false, voice: false, level: false, hiss: false }, c.fx);
          f[inp.dataset.fx] = inp.checked;
          if (!X.fxActive(f)) delete c.fx;
        })));
      }
    }

    // Sets one fade of a clip in seconds; the two never add up to more than
    // the clip itself.
    setFade(c, key, v) {
      const fx = c.fx = Object.assign({ fadeIn: 0, fadeOut: 0, rumble: false, voice: false, level: false, hiss: false }, c.fx);
      const other = key === 'fadeIn' ? fx.fadeOut : fx.fadeIn;
      const max = Math.max(0, Math.min(60, clipLen(c) - other));
      fx[key] = Math.min(max, Math.max(0, Math.round((+v || 0) * 10) / 10));
      if (!window.MvmVideoExport.fxActive(fx)) delete c.fx;
    }

    fadeHTML(c) {
      const fx = c.fx || {};
      const wi = (fx.fadeIn || 0) * this.pps, wo = (fx.fadeOut || 0) * this.pps;
      const svg = (cls, w, pts, line) => `<svg class="mv-fade ${cls}" style="width:${w}px" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${pts}" fill="rgba(0,0,0,.5)"/><line ${line} stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
      return svg('mv-fade-in', wi, '0,0 100,0 0,100', 'x1="0" y1="100" x2="100" y2="0"')
        + svg('mv-fade-out', wo, '0,0 100,0 100,100', 'x1="0" y1="0" x2="100" y2="100"')
        + `<div class="mv-fh mv-fh-in" data-f="in" style="left:${Math.max(0, wi - 5)}px" title="${esc(t('mv_fx_fade_in'))}: ${(fx.fadeIn || 0).toFixed(1)} s"></div>`
        + `<div class="mv-fh mv-fh-out" data-f="out" style="right:${Math.max(0, wo - 5)}px" title="${esc(t('mv_fx_fade_out'))}: ${(fx.fadeOut || 0).toFixed(1)} s"></div>`;
    }

    paintFade(el, c) {
      const fx = c.fx || {};
      const wi = (fx.fadeIn || 0) * this.pps, wo = (fx.fadeOut || 0) * this.pps;
      const q = s => el.querySelector(s);
      q('.mv-fade-in').style.width = wi + 'px';
      q('.mv-fade-out').style.width = wo + 'px';
      q('.mv-fh-in').style.left = Math.max(0, wi - 5) + 'px';
      q('.mv-fh-out').style.right = Math.max(0, wo - 5) + 'px';
      q('.mv-fh-in').title = t('mv_fx_fade_in') + ': ' + (fx.fadeIn || 0).toFixed(1) + ' s';
      q('.mv-fh-out').title = t('mv_fx_fade_out') + ': ' + (fx.fadeOut || 0).toFixed(1) + ' s';
    }

    // Dragging the round handle at either end of a clip's sound.
    dragFade(e, c, clipEl, which) {
      const key = which === 'in' ? 'fadeIn' : 'fadeOut';
      const before = this.snapshot();
      const edge = which === 'in' ? c.start : clipEnd(c);
      const secs = ev => which === 'in' ? this.timeAt(ev.clientX) - edge : edge - this.timeAt(ev.clientX);
      const grab = secs(e) - ((c.fx && c.fx[key]) || 0);
      const move = ev => {
        this.setFade(c, key, secs(ev) - grab);
        this.paintFade(clipEl, c);
        this.preview.sync();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (this.snapshot() !== before) { this.pushHistory(before); this.changed(); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    selectTrack(id) {
      this.selected = null;
      this.selTrack = id;
      this.rows.querySelectorAll('.mv-clip').forEach(el => el.classList.remove('mv-sel'));
      this.rows.querySelectorAll('.mv-th').forEach(el => el.classList.toggle('mv-th-sel', el.parentElement.dataset.track === id));
      const del = this.tlTools.querySelector('[data-a="delete"]');
      if (del) del.disabled = true;
      this.renderInspector();
    }

    layout() {
      const r = this.stage.getBoundingClientRect();
      this.preview.resize(Math.max(40, r.width - 16), Math.max(40, r.height - 16));
      const width = this.contentWidth();
      this.inner.style.width = (HEADER_W + width) + 'px';
      this.rows.querySelectorAll('.mv-lane').forEach(l => { l.style.width = width + 'px'; });
      this.drawRuler();
    }

    showTime(tm) {
      this.timeEl.textContent = fmtTime(tm, this.project.fps) + ' / ' + fmtTime(this.duration(), this.project.fps);
      this.updatePlayhead();
      if (this.preview && this.preview.playing) this.follow();
    }

    updatePlayhead() {
      const tm = this.preview ? this.preview.time : 0;
      this.playhead.style.left = (HEADER_W + tm * this.pps) + 'px';
    }

    // Keeps the playhead in view while playing.
    follow() {
      const x = this.preview.time * this.pps;
      const view = this.scroll.clientWidth - HEADER_W;
      const left = this.scroll.scrollLeft;
      if (x < left || x > left + view - 20) this.scroll.scrollLeft = Math.max(0, x - 40);
    }

    // ── Model helpers ────────────────────────────────────────────────────
    duration() { return this.project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0); }
    track(id) { return this.project.tracks.find(x => x.id === id); }
    clip(id) { return this.project.clips.find(x => x.id === id); }
    mediaDesc(id) { return this.project.media.find(x => x.id === id); }
    selectedClip() { return this.selected ? this.clip(this.selected) : null; }
    isReady(id) { const r = this.rt.get(id); return !!(r && r.status === 'ready'); }
    // What a clip counts as for placing it: sound that was detached from a
    // video sits on an audio track and moves only between audio tracks.
    clipKind(c) { const tr = this.track(c.track); const m = this.mediaDesc(c.media); return tr && tr.kind === 'audio' && m ? 'audio' : (m ? m.kind : 'video'); }
    fits(kind, trackKind) { return kind === 'audio' ? trackKind === 'audio' : trackKind === 'video'; }

    seek(tm) {
      this.preview.seek(Math.max(0, tm));
    }

    snapshot() {
      const p = this.project;
      return JSON.stringify({ name: p.name, width: p.width, height: p.height, fps: p.fps, auto: p.auto, tracks: p.tracks, clips: p.clips });
    }
    restore(s) {
      Object.assign(this.project, JSON.parse(s));
      if (this.selected && !this.clip(this.selected)) this.selected = null;
      this.preview.prune();
      this.changed();
      this.layout();
    }
    pushHistory(s) {
      this.undoStack.push(s);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    commit(fn) {
      const before = this.snapshot();
      fn();
      if (this.snapshot() === before) return;
      this.pushHistory(before);
      this.preview.prune();
      this.changed();
    }
    changed() {
      this.dirty = true;
      this.renderBar();
      this.renderTimeline();
      this.renderInspector();
      this.renderLibraryUsage();
      this.preview.sync();
      this.showTime(this.preview.time);
    }
    // The ● "in use" marks follow the clips.
    renderLibraryUsage() { this.renderLibrary(); }
    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
    }
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
    }

    // Where a clip of length len may sit on a track near `want`, without
    // covering another clip: the closest spot in any gap long enough.
    place(trackId, want, len, ignore) {
      const others = this.project.clips.filter(c => c.track === trackId && c.id !== ignore).sort((a, b) => a.start - b.start);
      let best = null;
      let gapStart = 0;
      const consider = (a, b) => {
        if (b - a < len - 1e-6) return;
        const s = Math.min(Math.max(want, a), b - len);
        if (best == null || Math.abs(s - want) < Math.abs(best - want)) best = s;
      };
      for (const o of others) { consider(gapStart, o.start); gapStart = Math.max(gapStart, clipEnd(o)); }
      consider(gapStart, Infinity);
      return Math.max(0, best == null ? want : best);
    }

    snapPoints(ignore) {
      const pts = [0, this.preview.time];
      for (const c of this.project.clips) if (c.id !== ignore) pts.push(c.start, clipEnd(c));
      return pts;
    }
    snapValue(v, pts) {
      if (!this.snap) return v;
      const lim = SNAP_PX / this.pps;
      let best = v, d = lim;
      for (const p of pts) { const dd = Math.abs(p - v); if (dd < d) { d = dd; best = p; } }
      return best;
    }

    // ── Timeline mouse work ──────────────────────────────────────────────
    timeAt(clientX) {
      const r = this.inner.getBoundingClientRect();
      return Math.max(0, (clientX - r.left - HEADER_W) / this.pps);
    }
    rowAt(clientY) {
      for (const row of this.rows.children) {
        const r = row.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) return row;
      }
      return null;
    }

    onTimelineDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest('.mv-th') || e.target.closest('.mv-corner')) return;
      this.root.focus({ preventScroll: true });
      const clipEl = e.target.closest('.mv-clip');
      if (clipEl) {
        const c = this.clip(clipEl.dataset.clip);
        if (!c) return;
        this.select(c.id);
        const fh = e.target.closest('.mv-fh');
        if (fh) { this.dragFade(e, c, clipEl, fh.dataset.f); return; }
        const h = e.target.closest('.mv-h');
        if (h) this.dragTrim(e, c, clipEl, h.dataset.h);
        else this.dragMove(e, c, clipEl);
        return;
      }
      // Empty lane or ruler: move the playhead, and keep following the mouse.
      if (this.selected || this.selTrack) this.select(null);
      const move = ev => this.seek(this.timeAt(ev.clientX));
      move(e);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    select(id) {
      this.selected = id;
      this.selTrack = null;
      this.rows.querySelectorAll('.mv-th-sel').forEach(el => el.classList.remove('mv-th-sel'));
      this.rows.querySelectorAll('.mv-clip').forEach(el => el.classList.toggle('mv-sel', el.dataset.clip === id));
      const del = this.tlTools.querySelector('[data-a="delete"]');
      if (del) del.disabled = !id;
      this.renderInspector();
    }

    dragMove(e, c, el) {
      const m = this.mediaDesc(c.media);
      const len = clipLen(c);
      const grab = this.timeAt(e.clientX) - c.start;
      const before = this.snapshot();
      const pts = this.snapPoints(c.id);
      const x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      let target = { track: c.track, start: c.start };
      const move = ev => {
        if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
        moved = true;
        el.classList.add('mv-dragging');
        let want = Math.max(0, this.timeAt(ev.clientX) - grab);
        const sStart = this.snapValue(want, pts);
        const sEnd = this.snapValue(want + len, pts) - len;
        // Whichever edge actually snapped, the closer one if both did.
        const dS = sStart !== want ? Math.abs(sStart - want) : Infinity;
        const dE = sEnd !== want ? Math.abs(sEnd - want) : Infinity;
        if (dS !== Infinity || dE !== Infinity) want = dS <= dE ? sStart : sEnd;
        const row = this.rowAt(ev.clientY);
        let trackId = target.track;
        if (row) {
          const tr = this.track(row.dataset.track);
          if (tr && this.fits(this.clipKind(c), tr.kind)) trackId = tr.id;
        }
        const start = this.place(trackId, Math.max(0, want), len, c.id);
        target = { track: trackId, start };
        const lane = this.rows.querySelector(`.mv-row[data-track="${CSS.escape(trackId)}"] .mv-lane`);
        if (lane && el.parentElement !== lane) lane.appendChild(el);
        el.style.left = (start * this.pps) + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        el.classList.remove('mv-dragging');
        if (!moved) return;
        c.track = target.track;
        c.start = target.start;
        if (this.snapshot() !== before) { this.pushHistory(before); this.changed(); }
        else this.renderTimeline();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    dragTrim(e, c, el, side) {
      const m = this.mediaDesc(c.media);
      const minLen = 1 / this.project.fps;
      const others = this.project.clips.filter(x => x.track === c.track && x.id !== c.id);
      const prevEnd = others.filter(x => clipEnd(x) <= c.start + 1e-6).reduce((a, x) => Math.max(a, clipEnd(x)), 0);
      const nextStart = others.filter(x => x.start >= clipEnd(c) - 1e-6).reduce((a, x) => Math.min(a, x.start), Infinity);
      const before = this.snapshot();
      const orig = { start: c.start, in: c.in, out: c.out };
      const end = clipEnd(c);
      const pts = this.snapPoints(c.id);
      const still = m.kind === 'image';
      const move = ev => {
        let tm = this.snapValue(this.timeAt(ev.clientX), pts);
        if (side === 'l') {
          const lo = Math.max(prevEnd, still ? 0 : orig.start - orig.in);
          tm = Math.min(Math.max(tm, lo), end - minLen);
          c.start = tm;
          if (still) { c.in = 0; c.out = end - tm; }
          else c.in = orig.in + (tm - orig.start);
        } else {
          const hi = Math.min(nextStart, still ? Infinity : orig.start + (m.duration - orig.in));
          tm = Math.max(Math.min(tm, hi), c.start + minLen);
          c.out = c.in + (tm - c.start);
        }
        el.style.left = (c.start * this.pps) + 'px';
        el.style.width = Math.max(2, clipLen(c) * this.pps) + 'px';
        this.seekQuiet(side === 'l' ? c.start : clipEnd(c) - minLen / 2);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (this.snapshot() !== before) { this.pushHistory(before); this.changed(); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    // Shows a frame while trimming without making it a snap target.
    seekQuiet(tm) { this.preview.seek(tm); }

    // ── Dropping media on the timeline ───────────────────────────────────
    onDragOver(e) {
      const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
      if (types.includes('application/x-mvmvideo-media') && this.draggingMedia) {
        const row = this.rowAt(e.clientY);
        if (!row || !e.target.closest('.mv-tl')) { this.clearGhost(); return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const spot = this.dropSpot(this.draggingMedia, e.clientX, row);
        this.showGhost(spot);
      } else if (types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.showDropHint(true);
      }
    }
    dropSpot(mediaId, clientX, row) {
      const m = this.mediaDesc(mediaId);
      let tr = this.track(row.dataset.track);
      if (!this.fits(m.kind, tr.kind)) tr = this.project.tracks.find(x => this.fits(m.kind, x.kind));
      if (!tr) return null;
      const len = m.kind === 'image' ? IMAGE_SECONDS : m.duration;
      const want = this.snapValue(this.timeAt(clientX), this.snapPoints(null));
      return { track: tr.id, start: this.place(tr.id, want, len, null), len };
    }
    showGhost(spot) {
      if (!spot) { this.clearGhost(); return; }
      if (!this.ghost) { this.ghost = document.createElement('div'); this.ghost.className = 'mv-ghost'; }
      const lane = this.rows.querySelector(`.mv-row[data-track="${CSS.escape(spot.track)}"] .mv-lane`);
      if (lane && this.ghost.parentElement !== lane) lane.appendChild(this.ghost);
      this.ghost.style.left = spot.start * this.pps + 'px';
      this.ghost.style.width = Math.max(2, spot.len * this.pps) + 'px';
    }
    clearGhost() { if (this.ghost) { this.ghost.remove(); this.ghost = null; } }
    showDropHint(on) { this.dropHint.classList.toggle('mv-show', !!on); }

    onDrop(e) {
      this.showDropHint(false);
      const id = e.dataTransfer && e.dataTransfer.getData('application/x-mvmvideo-media');
      if (id) {
        e.preventDefault();
        const row = this.rowAt(e.clientY);
        const spot = row && e.target.closest('.mv-tl') ? this.dropSpot(id, e.clientX, row) : null;
        this.clearGhost();
        this.draggingMedia = null;
        if (spot) this.insertClip(id, spot.track, spot.start);
        return;
      }
      const files = e.dataTransfer && [...(e.dataTransfer.files || [])];
      if (files && files.length) {
        e.preventDefault();
        const project = files.find(f => f.name.toLowerCase().endsWith(EXT));
        if (project) this.openLocalProjectFile(project);
        else this.addLocalFiles(files);
      }
    }

    insertClip(mediaId, trackId, start) {
      const m = this.mediaDesc(mediaId);
      const len = m.kind === 'image' ? IMAGE_SECONDS : m.duration;
      const c = { id: uid('c'), track: trackId, media: mediaId, start: this.place(trackId, start, len, null), in: 0, out: len, volume: 1 };
      this.commit(() => { this.project.clips.push(c); });
      this.select(c.id);
    }

    // Double-click or ＋ in the media list: at the end of the first track
    // that takes it (the bottom video track, the first audio track).
    appendMedia(mediaId) {
      if (!this.isReady(mediaId)) return;
      const m = this.mediaDesc(mediaId);
      const tracks = this.project.tracks.filter(x => this.fits(m.kind, x.kind));
      const tr = m.kind === 'audio' ? tracks[0] : tracks[tracks.length - 1];
      if (!tr) { this.addTrack(m.kind === 'audio' ? 'audio' : 'video'); return this.appendMedia(mediaId); }
      const end = this.project.clips.filter(c => c.track === tr.id).reduce((a, c) => Math.max(a, clipEnd(c)), 0);
      this.insertClip(mediaId, tr.id, end);
    }

    // ── Clip commands ────────────────────────────────────────────────────
    split() {
      const T = this.preview.time;
      const minLen = 1 / this.project.fps;
      const sel = this.selectedClip();
      const targets = (sel ? [sel] : this.project.clips).filter(c => T > c.start + minLen / 2 && T < clipEnd(c) - minLen / 2);
      if (!targets.length) { this.toast(t('mv_split_none'), 'bad'); return; }
      this.commit(() => {
        for (const c of targets) {
          const m = this.mediaDesc(c.media);
          const cut = T - c.start;
          const second = { ...c, id: uid('c'), start: T };
          delete second.link;
          if (c.fx) {
            // Each piece keeps its own end of the fades.
            second.fx = { ...c.fx, fadeIn: 0 };
            c.fx = { ...c.fx, fadeOut: 0 };
          }
          if (m.kind === 'image') { second.in = 0; second.out = clipLen(c) - cut; c.out = cut; }
          else { second.in = c.in + cut; c.out = c.in + cut; }
          this.project.clips.push(second);
        }
      });
    }

    // Taking the sound of a video out of it, as a clip of its own on an audio
    // track at exactly the same place. It is the same file and the same
    // range, so nothing is re-encoded or degraded; the video clip is only
    // marked as silent.
    detachAudio() {
      const c = this.selectedClip();
      if (!c) return;
      const m = this.mediaDesc(c.media);
      const vt = this.track(c.track);
      if (!m || m.kind !== 'video' || !m.hasAudio || c.silent || !vt || vt.kind !== 'video') return;
      const free = tr => !this.project.clips.some(x => x.track === tr.id && x.start < clipEnd(c) - 1e-6 && clipEnd(x) > c.start + 1e-6);
      const a = { id: uid('c'), track: '', media: c.media, start: c.start, in: c.in, out: c.out, volume: c.volume, link: c.id };
      this.commit(() => {
        let tr = this.project.tracks.find(x => x.kind === 'audio' && free(x));
        if (!tr) {
          tr = { id: uid('t'), kind: 'audio', muted: false, hidden: false, volume: 1 };
          this.project.tracks.push(tr);
        }
        a.track = tr.id;
        if (c.fx) { a.fx = { ...c.fx }; delete c.fx; }
        c.silent = true;
        c.volume = 1;
        this.project.clips.push(a);
      });
      this.select(a.id);
      this.toast(t('mv_detached'));
    }

    // The video this sound was taken from, if both are still exactly
    // together.
    joinTarget(a) {
      if (!a || !a.link || this.clipKind(a) !== 'audio') return null;
      const v = this.clip(a.link);
      const m = this.mediaDesc(a.media);
      const vt = v && this.track(v.track);
      if (!v || !m || m.kind !== 'video' || !v.silent || !vt || vt.kind !== 'video' || v.media !== a.media) return null;
      const e = 1e-4;
      return Math.abs(v.start - a.start) < e && Math.abs(v.in - a.in) < e && Math.abs(v.out - a.out) < e ? v : null;
    }

    attachAudio() {
      const a = this.selectedClip();
      const v = this.joinTarget(a);
      if (!v) return;
      this.commit(() => {
        v.silent = false;
        v.volume = a.volume;
        if (a.fx) v.fx = { ...a.fx };
        this.project.clips = this.project.clips.filter(x => x.id !== a.id);
      });
      this.select(v.id);
    }

    deleteSelected() {
      const c = this.selectedClip();
      if (!c) return;
      this.selected = null;
      this.commit(() => { this.project.clips = this.project.clips.filter(x => x.id !== c.id); });
    }

    addTrack(kind) {
      this.commit(() => {
        const tr = { id: uid('t'), kind, muted: false, hidden: false, volume: 1 };
        if (kind === 'video') this.project.tracks.unshift(tr);
        else this.project.tracks.push(tr);
      });
    }

    async removeTrack(id) {
      const tr = this.track(id);
      if (!tr) return;
      const n = this.project.clips.filter(c => c.track === id).length;
      if (n && !(await this.confirm(t('mv_remove_track_confirm', { name: this.trackLabel(tr), n }), t('mv_remove')))) return;
      this.commit(() => {
        this.project.tracks = this.project.tracks.filter(x => x.id !== id);
        this.project.clips = this.project.clips.filter(c => c.track !== id);
      });
    }

    zoomAt(pps, anchorX) {
      pps = Math.min(800, Math.max(0.5, pps));
      const ax = anchorX == null ? (this.preview.time * this.pps - this.scroll.scrollLeft) : anchorX;
      const tAtAnchor = (this.scroll.scrollLeft + ax) / this.pps;
      this.pps = pps;
      this.renderTimeline();
      this.scroll.scrollLeft = Math.max(0, tAtAnchor * this.pps - ax);
      this.drawRuler();
    }
    zoomFit() {
      const d = this.duration();
      const view = Math.max(200, this.scroll.clientWidth - HEADER_W - 30);
      this.pps = d > 0 ? Math.min(800, Math.max(0.5, view / d)) : 40;
      this.renderTimeline();
      this.scroll.scrollLeft = 0;
      this.drawRuler();
    }

    onKey(e) {
      if (e.target.closest('input, textarea, select') || e.target.isContentEditable) return;
      if (this.root.querySelector('.mv-modal') || this.rec) return;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      const frame = 1 / this.project.fps;
      if (k === ' ') { e.preventDefault(); this.preview.toggle(); }
      else if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); this.redo(); }
      else if (mod && (k === 's' || k === 'S')) { e.preventDefault(); this.save(); }
      else if (!mod && (k === 's' || k === 'S')) { e.preventDefault(); this.split(); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.seek(this.preview.time - (e.shiftKey ? 1 : frame)); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.seek(this.preview.time + (e.shiftKey ? 1 : frame)); }
      else if (k === 'Home') { e.preventDefault(); this.seek(0); }
      else if (k === 'End') { e.preventDefault(); this.seek(this.duration()); }
      else if (k === '+' || k === '=') { e.preventDefault(); this.zoomAt(this.pps * 1.5); }
      else if (k === '-') { e.preventDefault(); this.zoomAt(this.pps / 1.5); }
    }

    // ── Media ────────────────────────────────────────────────────────────
    async homeDir() {
      try { const d = await (await fetch('/api/files/places')).json(); return d; } catch (e) { return { home: '/' }; }
    }

    async addFromServer() {
      const places = await this.homeDir();
      const exts = [...Media().VIDEO_EXT, ...Media().AUDIO_EXT, ...Media().IMAGE_EXT];
      const picked = await this.fileBrowser({ title: t('mv_add_server'), places, exts, multi: true, startName: 'Videos' });
      if (!picked || !picked.length) return;
      for (const f of picked) this.addMedia({ name: f.name, path: f.path, size: f.size });
    }

    addFromComputer() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'video/*,audio/*,image/*,' + [...Media().VIDEO_EXT, ...Media().AUDIO_EXT, ...Media().IMAGE_EXT].map(x => '.' + x).join(',');
      input.onchange = () => this.addLocalFiles([...input.files]);
      input.click();
    }

    addLocalFiles(files) {
      let skipped = 0;
      for (const f of files) {
        if (!Media().kindOf(f.name, f.type)) { skipped++; continue; }
        this.addMedia({ name: f.name, path: null, size: f.size, file: f });
      }
      if (skipped) this.toast(t('mv_skipped_files', { n: skipped }), 'bad');
    }

    addMedia({ name, path, size, file }) {
      const existing = this.project.media.find(m => path ? m.path === path : (!m.path && m.name === name && m.size === size));
      if (existing) {
        const r = this.rt.get(existing.id);
        if (r && (r.status === 'missing' || r.status === 'error') && file) this.loadMedia(existing, file);
        return;
      }
      const kind = Media().kindOf(name, file && file.type);
      if (!kind) return;
      const m = { id: uid('m'), name, kind, path: path || null, size: size || 0, duration: 0, width: 0, height: 0, hasAudio: false, fps: 0 };
      this.project.media.push(m);
      this.dirty = true;
      this.renderBar();
      this.loadMedia(m, file);
    }

    // Reads and probes one source; a local file comes as a File, a server
    // one is fetched by path.
    async loadMedia(m, file) {
      const old = this.rt.get(m.id);
      if (old && old.info && old.info.url) URL.revokeObjectURL(old.info.url);
      const r = { status: 'loading', progress: m.path ? 0 : null, thumb: old && old.thumb };
      this.rt.set(m.id, r);
      this.renderLibrary();
      try {
        let blob = file || (old && old.blob);
        if (!blob) {
          if (!m.path) { r.status = 'missing'; this.renderLibrary(); this.renderTimeline(); return; }
          let lastPaint = 0;
          blob = await Media().fetchServerFile(m.path, m.size, pr => {
            r.progress = pr;
            const now = performance.now();
            if (now - lastPaint > 150) { lastPaint = now; this.paintItem(m.id); }
          });
        }
        const info = await Media().probe(blob, m.name);
        if (m.kind !== info.kind) m.kind = info.kind;
        r.blob = blob;
        r.info = info;
        r.status = 'ready';
        const firstVideo = info.kind === 'video' && this.project.auto && !this.project.clips.length && !this.project.media.some(x => x.id !== m.id && x.kind === 'video' && this.isReady(x.id));
        m.duration = info.duration; m.width = info.width; m.height = info.height; m.hasAudio = info.hasAudio; m.fps = info.fps || 0; m.size = blob.size;
        if (firstVideo) {
          this.project.width = even(info.width);
          this.project.height = even(info.height);
          this.project.fps = info.fps || 30;
          this.renderBar();
          this.layout();
        }
        this.renderLibrary();
        this.renderTimeline();
        this.preview.sync();
        if (info.kind === 'image') r.thumb = Media().drawThumb(info.img, info.width, info.height);
        else if (info.kind === 'video') r.thumb = await Media().videoThumb(info.url, info.duration);
        this.renderLibrary();
        this.renderTimeline();
        if (info.hasAudio && (info.kind === 'audio' || info.kind === 'video')) {
          r.peaks = await Media().computePeaks(blob, info);
          this.renderTimeline();
        }
      } catch (e) {
        r.status = 'error';
        r.error = e && e.message;
        this.renderLibrary();
        this.renderTimeline();
      }
    }

    paintItem(id) {
      const el = this.libList.querySelector(`.mv-item[data-id="${CSS.escape(id)}"] .mv-item-status`);
      const r = this.rt.get(id);
      if (el && r && r.status === 'loading') el.textContent = t('mv_loading') + (r.progress != null ? ' ' + Math.round(r.progress * 100) + '%' : '');
    }

    async removeMedia(id) {
      const m = this.mediaDesc(id);
      if (!m) return;
      const n = this.project.clips.filter(c => c.media === id).length;
      if (n && !(await this.confirm(t('mv_remove_media_confirm', { name: m.name, n }), t('mv_remove')))) return;
      if (n) this.commit(() => { this.project.clips = this.project.clips.filter(c => c.media !== id); });
      this.project.media = this.project.media.filter(x => x.id !== id);
      const r = this.rt.get(id);
      if (r && r.info && r.info.url) URL.revokeObjectURL(r.info.url);
      this.rt.delete(id);
      this.dirty = true;
      this.renderBar();
      this.renderLibrary();
    }

    // A source that is not where the project remembers it: pick it again,
    // from the server or from this computer.
    async relinkMedia(id) {
      const m = this.mediaDesc(id);
      if (!m) return;
      const choose = await this.choice(t('mv_find_file_title', { name: m.name }), [
        ...(this.opts.desktop ? [{ id: 'server', label: '🗄 ' + t('mv_add_server') }] : []),
        { id: 'computer', label: '💻 ' + t('mv_add_computer') },
      ]);
      if (choose === 'server') {
        const places = await this.homeDir();
        const exts = m.kind === 'video' ? Media().VIDEO_EXT : m.kind === 'audio' ? Media().AUDIO_EXT : Media().IMAGE_EXT;
        const picked = await this.fileBrowser({ title: t('mv_find_file_title', { name: m.name }), places, exts, multi: false });
        if (!picked || !picked.length) return;
        m.path = picked[0].path; m.name = picked[0].name; m.size = picked[0].size;
        this.dirty = true;
        this.renderBar();
        this.loadMedia(m);
      } else if (choose === 'computer') {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = () => {
          const f = input.files[0];
          if (!f) return;
          m.path = null; m.name = f.name; m.size = f.size;
          this.dirty = true;
          this.renderBar();
          this.loadMedia(m, f);
        };
        input.click();
      }
    }

    // ── Projects ─────────────────────────────────────────────────────────
    fileName() {
      const base = (this.project.name || t('mv_untitled')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'project';
      return base + EXT;
    }

    serialize() {
      const p = this.project;
      return JSON.stringify({
        format: 'mvmvideo', version: 1,
        name: p.name, width: p.width, height: p.height, fps: p.fps, auto: p.auto,
        tracks: p.tracks, media: p.media, clips: p.clips,
      }, null, 1);
    }

    async leaveProject() {
      if (!this.dirty) return true;
      return this.confirm(t('mv_leave_unsaved'), t('mv_discard'));
    }

    resetTo(p, source) {
      this.preview.pause();
      for (const r of this.rt.values()) if (r.info && r.info.url) URL.revokeObjectURL(r.info.url);
      this.rt.clear();
      for (const c of [...this.preview.els.keys()]) this.preview.drop(c);
      this.project = p;
      this.source = source;
      this.selected = null;
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      this.preview.time = 0;
      this.render();
      this.layout();
      this.zoomFit();
      for (const m of p.media) this.loadMedia(m);
    }

    async newProject() {
      if (!(await this.leaveProject())) return;
      this.resetTo(newProject(), null);
    }

    async openFromServer() {
      if (!(await this.leaveProject())) return;
      const places = await this.homeDir();
      const picked = await this.fileBrowser({ title: t('mv_open_server'), places, exts: ['mvmvideo'], multi: false });
      if (picked && picked.length) this.openServerProject(picked[0].path, true);
    }

    async openServerProject(path, confirmed) {
      if (!confirmed && !(await this.leaveProject())) return;
      try {
        const r = await fetch('/api/files/raw?path=' + encodeURIComponent(path));
        if (!r.ok) throw new Error('load');
        const p = normalize(JSON.parse(await r.text()));
        if (!p.name) p.name = path.split('/').pop().replace(/\.mvmvideo$/i, '');
        this.resetTo(p, { kind: 'server', path });
      } catch (e) {
        this.toast(t(e.message === 'not_project' ? 'mv_not_project' : 'mv_open_failed'), 'bad');
      }
    }

    async openFromComputer() {
      if (!(await this.leaveProject())) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = EXT;
      input.onchange = () => { if (input.files[0]) this.openLocalProjectFile(input.files[0], true); };
      input.click();
    }

    async openLocalProjectFile(file, confirmed) {
      if (!confirmed && !(await this.leaveProject())) return;
      try {
        const p = normalize(JSON.parse(await file.text()));
        if (!p.name) p.name = file.name.replace(/\.mvmvideo$/i, '');
        this.resetTo(p, { kind: 'local', name: file.name });
      } catch (e) {
        this.toast(t(e.message === 'not_project' ? 'mv_not_project' : 'mv_open_failed'), 'bad');
      }
    }

    async save() {
      if (this.source && this.source.kind === 'server') return this.writeServer(this.source.path);
      if (this.opts.desktop) return this.saveToFolder();
      return this.downloadProject();
    }

    async writeServer(path) {
      try {
        const r = await fetch('/api/files/write', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: this.serialize() }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error || d.detail) throw new Error('save');
        this.source = { kind: 'server', path };
        this.dirty = false;
        this.renderBar();
        this.toast(t('mv_saved'), 'good');
        return true;
      } catch (e) {
        this.toast(t('mv_save_failed'), 'bad');
        return false;
      }
    }

    async saveToFolder() {
      const places = await this.homeDir();
      const dir = await this.pickFolder(t('mv_save_to_folder'), places.home || '/');
      if (!dir) return;
      const name = await this.prompt(t('mv_file_name'), this.fileName());
      if (name == null || !name.trim()) return;
      let file = name.trim().replace(/[\\/]+/g, ' ');
      if (!file.toLowerCase().endsWith(EXT)) file += EXT;
      const path = dir.replace(/\/+$/, '') + '/' + file;
      if (await this.exists(dir, file) && !(await this.confirm(t('mv_overwrite_confirm', { name: file }), t('mv_replace')))) return;
      await this.writeServer(path);
    }

    downloadProject() {
      const blob = new Blob([this.serialize()], { type: 'application/json' });
      this.download(blob, this.fileName());
      this.dirty = false;
      this.renderBar();
    }

    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }

    async exists(dir, name) {
      try {
        const r = await fetch('/api/files?path=' + encodeURIComponent(dir));
        return ((await r.json()).entries || []).some(x => x.name === name);
      } catch (e) { return false; }
    }

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
    }

    async rename() {
      const name = await this.prompt(t('mv_project_name'), this.project.name || '');
      if (name == null) return;
      this.commit(() => { this.project.name = name.trim(); });
    }

    settingsDialog() {
      const p = this.project;
      const presetIdx = SIZE_PRESETS.findIndex(([w, h]) => w === p.width && h === p.height);
      const fpsList = FPS_CHOICES.includes(p.fps) ? FPS_CHOICES : [...FPS_CHOICES, p.fps].sort((a, b) => a - b);
      const body = `
        <label class="mv-field"><span>${esc(t('mv_project_name'))}</span><input type="text" data-f="name" value="${esc(p.name)}" placeholder="${esc(t('mv_untitled'))}"></label>
        <label class="mv-field"><span>${esc(t('mv_resolution'))}</span>
          <select data-f="preset">
            ${SIZE_PRESETS.map(([w, h], i) => `<option value="${i}" ${i === presetIdx ? 'selected' : ''}>${w}×${h}${h > w ? ' · ' + esc(t('mv_vertical')) : w === h ? ' · ' + esc(t('mv_square')) : ''}</option>`).join('')}
            <option value="custom" ${presetIdx < 0 ? 'selected' : ''}>${esc(t('mv_custom'))}</option>
          </select></label>
        <div class="mv-field mv-custom" ${presetIdx < 0 ? '' : 'hidden'}><span></span><div><input type="number" data-f="w" min="16" max="7680" step="2" value="${p.width}"> × <input type="number" data-f="h" min="16" max="7680" step="2" value="${p.height}"></div></div>
        <label class="mv-field"><span>${esc(t('mv_frame_rate'))}</span>
          <select data-f="fps">${fpsList.map(f => `<option value="${f}" ${f === p.fps ? 'selected' : ''}>${fmtFps(f)} fps</option>`).join('')}</select></label>
        <p class="mv-hint">${esc(t('mv_settings_hint'))}</p>`;
      this.modal(t('mv_settings'), body, [
        { label: t('mv_cancel') },
        { label: t('mv_apply'), primary: true, onClick: box => {
          const v = f => box.querySelector(`[data-f="${f}"]`).value;
          let w, h;
          if (v('preset') === 'custom') { w = even(Math.min(7680, Math.max(16, +v('w') || p.width))); h = even(Math.min(7680, Math.max(16, +v('h') || p.height))); }
          else [w, h] = SIZE_PRESETS[+v('preset')];
          this.commit(() => { p.name = v('name').trim(); p.width = w; p.height = h; p.fps = +v('fps'); p.auto = false; });
          this.layout();
        } },
      ], box => {
        const sel = box.querySelector('[data-f="preset"]');
        sel.addEventListener('change', () => { box.querySelector('.mv-custom').hidden = sel.value !== 'custom'; });
      });
    }


    // ── Audio effects ────────────────────────────────────────────────────
    // ── Voice recording ──────────────────────────────────────────────────
    recPrefs() {
      let o = {};
      try { o = JSON.parse(localStorage.getItem('mvmvideo.rec2') || '{}') || {}; } catch (e) { o = {}; }
      return Object.assign({ deviceId: '', noise: true, echo: true, gain: true, headphones: false, keep: false }, o);
    }

    // One click from the playhead: pick the microphone, check the level,
    // record while the video plays, and the voice lands on a free audio
    // track right where the recording started.
    async recordDialog() {
      if (this.rec || this.recDialog) return;
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.toast(t('mv_rec_insecure'), 'bad'); return; }
      const prefs = this.recPrefs();
      const st = { stream: null, ac: null, raf: 0, gen: 0 };
      this.recDialog = true;
      const stopTest = () => {
        st.gen++;
        cancelAnimationFrame(st.raf);
        if (st.stream) st.stream.getTracks().forEach(x => x.stop());
        if (st.ac) st.ac.close().catch(() => {});
        st.stream = null; st.ac = null;
      };
      const body = `
        <label class="mv-field"><span>${esc(t('mv_rec_mic'))}</span><select data-f="dev"><option value="">${esc(t('mv_rec_default_mic'))}</option></select></label>
        <div class="mv-field"><span>${esc(t('mv_rec_level'))}</span><div class="mv-meter"><i data-f="meter"></i></div></div>
        <p class="mv-hint" data-f="status">${esc(t('mv_rec_waiting'))}</p>
        <label class="mv-fx-toggle"><input type="checkbox" data-f="noise" ${prefs.noise ? 'checked' : ''}><span><b>${esc(t('mv_rec_noise'))}</b><br><small class="mv-dim">${esc(t('mv_rec_noise_hint'))}</small></span></label>
        <label class="mv-fx-toggle"><input type="checkbox" data-f="echo" ${prefs.echo ? 'checked' : ''}><span><b>${esc(t('mv_rec_echo'))}</b></span></label>
        <label class="mv-fx-toggle"><input type="checkbox" data-f="gain" ${prefs.gain ? 'checked' : ''}><span><b>${esc(t('mv_rec_gain'))}</b></span></label>
        <label class="mv-fx-toggle"><input type="checkbox" data-f="phones" ${prefs.headphones ? 'checked' : ''}><span><b>${esc(t('mv_rec_headphones'))}</b><br><small class="mv-dim">${esc(t('mv_rec_headphones_hint'))}</small></span></label>
        <label class="mv-fx-toggle"><input type="checkbox" data-f="keep" ${prefs.keep ? 'checked' : ''}><span><b>${esc(t('mv_rec_keep'))}</b><br><small class="mv-dim">${esc(t('mv_rec_keep_hint'))}</small></span></label>`;
      const finish = () => { stopTest(); this.recDialog = false; };
      this.modal(t('mv_rec_title'), body, [
        { label: t('mv_cancel'), onClick: finish },
        { label: '● ' + t('mv_rec_start'), primary: true, onClick: box => {
          if (!st.stream) return false;
          const o = this.readRecBox(box);
          localStorage.setItem('mvmvideo.rec2', JSON.stringify(o));
          const stream = st.stream;
          st.stream = null;
          finish();
          this.startRecording(stream, o);
        } },
      ], box => {
        const q = f => box.querySelector(`[data-f="${f}"]`);
        const startBtn = box.querySelector('.mv-modal-foot .mv-primary');
        startBtn.disabled = true;
        const open = async () => {
          const gen = ++st.gen;
          cancelAnimationFrame(st.raf);
          if (st.stream) st.stream.getTracks().forEach(x => x.stop());
          if (st.ac) st.ac.close().catch(() => {});
          st.stream = null; st.ac = null;
          startBtn.disabled = true;
          const o = this.readRecBox(box);
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: {
              deviceId: o.deviceId ? { exact: o.deviceId } : undefined,
              echoCancellation: o.echo, noiseSuppression: o.noise, autoGainControl: o.gain,
              channelCount: 1,
            } });
          } catch (e) {
            if (gen !== st.gen) return;
            q('status').textContent = t(e && e.name === 'NotFoundError' ? 'mv_rec_no_device' : 'mv_rec_denied');
            return;
          }
          if (gen !== st.gen || !box.isConnected) { stream.getTracks().forEach(x => x.stop()); return; }
          st.stream = stream;
          q('status').textContent = t('mv_rec_ready');
          startBtn.disabled = false;
          try {
            const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
            const cur = stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings().deviceId;
            const sel = q('dev');
            sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || t('mv_rec_mic') + ' ' + (i + 1))}</option>`).join('');
            if (cur && devs.some(d => d.deviceId === cur)) sel.value = cur;
          } catch (e) { /* the list is only a convenience */ }
          const AC = window.AudioContext || window.webkitAudioContext;
          st.ac = new AC();
          const an = st.ac.createAnalyser();
          an.fftSize = 1024;
          st.ac.createMediaStreamSource(stream).connect(an);
          const buf = new Float32Array(an.fftSize);
          const tick = () => {
            an.getFloatTimeDomainData(buf);
            let pk = 0;
            for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
            q('meter').style.width = Math.min(100, Math.sqrt(pk) * 100) + '%';
            st.raf = requestAnimationFrame(tick);
          };
          tick();
        };
        for (const f of ['dev', 'noise', 'echo', 'gain']) q(f).addEventListener('change', open);
        open();
      });
    }

    readRecBox(box) {
      const q = f => box.querySelector(`[data-f="${f}"]`);
      return { deviceId: q('dev').value, noise: q('noise').checked, echo: q('echo').checked, gain: q('gain').checked, headphones: q('phones').checked, keep: q('keep').checked };
    }

    async startRecording(stream, o) {
      const T0 = this.preview.time;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      ac.resume().catch(() => {});
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const chunks = [];
      let capturing = false, samples = 0;
      const take = d => { if (!capturing) return; chunks.push(d); samples += d.length; };
      // The samples are collected on the audio thread, so a busy page
      // (video playing, the timeline redrawing) can never make it skip.
      let node = null, workletUrl = null;
      try {
        const code = "class R extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b);this.b=new Float32Array(2048);this.n=0}}}return true}}registerProcessor('mvrec',R)";
        workletUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        await ac.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(ac, 'mvrec', { numberOfOutputs: 0 });
        node.port.onmessage = e => take(e.data);
        src.connect(node);
      } catch (e) {
        node = ac.createScriptProcessor(16384, 1, 1);
        node.onaudioprocess = e => take(new Float32Array(e.inputBuffer.getChannelData(0)));
        const mute = ac.createGain();
        mute.gain.value = 0;
        src.connect(node);
        node.connect(mute).connect(ac.destination);
      }
      if (workletUrl) URL.revokeObjectURL(workletUrl);

      // The track the voice goes to is decided now, so it shows up there
      // while it is being recorded: the first audio track with nothing at
      // or after this position, or a new one.
      const free = tr => !this.project.clips.some(c => c.track === tr.id && clipEnd(c) > T0 - 1e-6);
      let tr = this.project.tracks.find(x => x.kind === 'audio' && !x.muted && free(x));
      let madeTrack = false;
      if (!tr) {
        this.addTrack('audio');
        tr = this.project.tracks[this.project.tracks.length - 1];
        madeTrack = true;
      }
      const trackId = tr.id;

      const bar = document.createElement('div');
      bar.className = 'mv-recbar mv-counting';
      bar.innerHTML = `<span class="mv-rec-dot"></span><span class="mv-rec-count"></span><span class="mv-rec-time">0:00</span>
        <div class="mv-meter"><i></i></div>
        <button class="mv-btn mv-primary" data-r="stop">■ ${esc(t('mv_rec_stop'))}</button>
        <button class="mv-btn" data-r="discard">✕ ${esc(t('mv_rec_discard'))}</button>`;
      this.root.appendChild(bar);
      const meter = bar.querySelector('.mv-meter i'), timeEl = bar.querySelector('.mv-rec-time'), countEl = bar.querySelector('.mv-rec-count');
      let raf = 0, timer = 0, dead = false, live = null;
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let pk = 0;
        for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
        meter.style.width = Math.min(100, Math.sqrt(pk) * 100) + '%';
        const len = samples / ac.sampleRate;
        timeEl.textContent = fmtShort(len);
        if (capturing) {
          // The take grows on its track under the playhead.
          if (!this.preview.playing) this.preview.seek(T0 + len);
          const lane = this.rows.querySelector(`[data-track="${trackId}"] .mv-lane`);
          if (lane) {
            if (!live || live.parentNode !== lane) {
              live = document.createElement('div');
              live.className = 'mv-clip mv-clip-audio mv-live';
              live.innerHTML = `<div class="mv-clip-label">● ${esc(t('mv_rec_name'))}</div>`;
              lane.appendChild(live);
            }
            live.style.left = T0 * this.pps + 'px';
            live.style.width = Math.max(4, len * this.pps) + 'px';
          }
          this.follow();
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
      const teardown = () => {
        dead = true;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        try { node.port && (node.port.onmessage = null); node.onaudioprocess = null; src.disconnect(); node.disconnect(); } catch (e) { /* gone */ }
        stream.getTracks().forEach(x => x.stop());
        ac.close().catch(() => {});
        bar.remove();
        if (live) live.remove();
        this.preview.hushed = false;
        this.preview.pause();
        this.rec = null;
        this.root.focus({ preventScroll: true });
      };
      const dropEmptyTrack = () => {
        if (madeTrack && !this.project.clips.some(c => c.track === trackId)) {
          this.commit(() => { this.project.tracks = this.project.tracks.filter(x => x.id !== trackId); });
        }
      };
      const rec = {
        discard: () => { if (!dead) { teardown(); dropEmptyTrack(); } },
        stop: async () => {
          if (dead) return;
          const len = samples / ac.sampleRate;
          const rate = ac.sampleRate;
          teardown();
          if (len < 0.3) { this.toast(t('mv_rec_too_short'), 'bad'); dropEmptyTrack(); return; }
          await this.addRecording(chunks, samples, rate, T0, len, o, trackId);
        },
      };
      this.rec = rec;
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (b.dataset.r === 'stop') rec.stop(); else rec.discard();
      });
      // 3-2-1, then the video starts and the recording with it.
      let n = 3;
      const count = () => {
        if (dead) return;
        if (n > 0) { countEl.textContent = String(n--); timer = setTimeout(count, 1000); return; }
        countEl.textContent = '';
        bar.classList.remove('mv-counting');
        capturing = true;
        this.preview.hushed = !o.headphones;
        if (T0 < Exporter().projectDuration(this.project) - 0.01) this.preview.play();
      };
      count();
    }

    wavBlob(chunks, total, rate) {
      const data = new DataView(new ArrayBuffer(44 + total * 2));
      const w = (off, str) => { for (let i = 0; i < str.length; i++) data.setUint8(off + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); data.setUint32(4, 36 + total * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
      w(36, 'data'); data.setUint32(40, total * 2, true);
      let off = 44;
      for (const ch of chunks) {
        for (let i = 0; i < ch.length; i++) {
          const v = Math.max(-1, Math.min(1, ch[i]));
          data.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
          off += 2;
        }
      }
      return new Blob([data], { type: 'audio/wav' });
    }

    async addRecording(chunks, total, rate, T0, len, o, trackId) {
      const used = this.project.media.filter(m => !m.path && m.name.startsWith(t('mv_rec_name'))).length;
      const name = t('mv_rec_name') + ' ' + (used + 1) + '.wav';
      const file = new File([this.wavBlob(chunks, total, rate)], name, { type: 'audio/wav' });
      const m = { id: uid('m'), name, kind: 'audio', path: null, size: file.size, duration: 0, width: 0, height: 0, hasAudio: false, fps: 0 };
      this.project.media.push(m);
      this.dirty = true;
      this.renderBar();
      await this.loadMedia(m, file);
      if (!this.isReady(m.id)) { this.toast(t('mv_rec_failed'), 'bad'); return; }
      this.insertClip(m.id, this.track(trackId) ? trackId : this.project.tracks.find(x => x.kind === 'audio').id, T0);
      this.seek(T0);
      this.toast(t('mv_rec_added'), 'good');
      if (o.keep) this.download(file, name);
    }

    // ── Export ───────────────────────────────────────────────────────────
    async exportDialog() {
      if (this.exporting) return;
      const p = this.project;
      if (!p.clips.length) { this.toast(t('mv_export_empty'), 'bad'); return; }
      const notReady = [...new Set(p.clips.map(c => c.media))].filter(id => !this.isReady(id));
      if (notReady.length) {
        const r = this.rt.get(notReady[0]) || {};
        this.toast(t(r.status === 'loading' ? 'mv_export_wait' : 'mv_export_missing'), 'bad');
        return;
      }
      if (typeof VideoEncoder === 'undefined') { this.toast(t('mv_no_webcodecs'), 'bad'); return; }
      const media = this.readyMedia();
      const places = this.opts.desktop ? await this.homeDir() : null;
      const videos = places && (places.xdg || []).find(x => x.name === 'Videos');
      let dir = videos ? videos.path : places && places.home;
      const X = Exporter();
      const body = `
        <label class="mv-field"><span>${esc(t('mv_file_name'))}</span><input type="text" data-f="name" value="${esc((p.name || t('mv_untitled')).replace(/[\\/:*?"<>|]+/g, ' '))}"></label>
        <label class="mv-field"><span>${esc(t('mv_quality'))}</span>
          <select data-f="quality">
            <option value="max">${esc(t('mv_quality_max'))}</option>
            <option value="high">${esc(t('mv_quality_high'))}</option>
            <option value="standard">${esc(t('mv_quality_standard'))}</option>
          </select></label>
        <div class="mv-field"><span>${esc(t('mv_output'))}</span><div class="mv-out-spec">${p.width}×${p.height} · ${fmtFps(p.fps)} fps · ${fmtTime(this.duration(), p.fps)}<br><span class="mv-dim" data-f="format">…</span><br><span class="mv-dim" data-f="size"></span></div></div>
        ${this.opts.desktop ? `
        <div class="mv-field"><span>${esc(t('mv_save_where'))}</span><div class="mv-radio">
          <label><input type="radio" name="mv-dest" value="server" checked> 🗄 <span data-f="dir">${esc(dir || '/')}</span> <button type="button" class="mv-link" data-f="pick">${esc(t('mv_change'))}</button></label>
          <label><input type="radio" name="mv-dest" value="download"> 💻 ${esc(t('mv_download_computer'))}</label>
        </div></div>` : ''}
        <p class="mv-hint">${esc(t('mv_export_hint'))}</p>`;
      this.modal(t('mv_export'), body, [
        { label: t('mv_cancel') },
        { label: t('mv_start_export'), primary: true, onClick: box => {
          const name = box.querySelector('[data-f="name"]').value.trim() || t('mv_untitled');
          const quality = box.querySelector('[data-f="quality"]').value;
          const destEl = box.querySelector('input[name="mv-dest"]:checked');
          const dest = destEl ? destEl.value : 'download';
          this.runExport({ name, quality, dest, dir });
        } },
      ], box => {
        const q = box.querySelector('[data-f="quality"]');
        const refresh = async () => {
          box.querySelector('[data-f="size"]').textContent = '≈ ' + fmtBytes(X.estimateBytes(p, q.value, media));
          const f = await X.pickFormat(p, X.videoBitrate(p, q.value, media)).catch(() => null);
          box.querySelector('[data-f="format"]').textContent = f ? X.describeFormat(f) : t('mv_no_encoder');
        };
        q.addEventListener('change', refresh);
        refresh();
        const pick = box.querySelector('[data-f="pick"]');
        if (pick) pick.addEventListener('click', async e => {
          e.preventDefault();
          const d = await this.pickFolder(t('mv_save_where'), (places && places.home) || '/');
          if (d) { dir = d; box.querySelector('[data-f="dir"]').textContent = d; box.querySelector('input[value="server"]').checked = true; }
        });
      });
    }

    readyMedia() {
      const out = {};
      for (const m of this.project.media) {
        const r = this.rt.get(m.id);
        if (r && r.status === 'ready') out[m.id] = { blob: r.blob, info: r.info };
      }
      return out;
    }

    async runExport({ name, quality, dest, dir }) {
      this.preview.pause();
      const ctrl = new AbortController();
      this.exporting = ctrl;
      const box = this.modal(t('mv_exporting'), `
        <div class="mv-progress"><div class="mv-progress-fill"></div></div>
        <div class="mv-progress-text">${esc(t('mv_preparing'))}</div>
        <p class="mv-hint">${esc(t('mv_export_keep_open'))}</p>`, [
        { label: t('mv_cancel'), keep: true, onClick: () => ctrl.abort() },
      ]);
      const fill = box.querySelector('.mv-progress-fill');
      const text = box.querySelector('.mv-progress-text');
      try {
        const res = await Exporter().run({
          project: JSON.parse(this.snapshot()),
          media: this.readyMedia(),
          quality,
          signal: ctrl.signal,
          onProgress: pr => {
            if (pr.finalizing) { fill.style.width = '100%'; text.textContent = t('mv_finalizing'); return; }
            fill.style.width = (pr.frame / pr.total * 100).toFixed(1) + '%';
            text.textContent = t('mv_export_progress', { frame: pr.frame, total: pr.total, left: fmtShort(pr.eta) });
          },
        });
        this.closeModal(box);
        const fileName = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + res.ext;
        if (dest === 'server' && dir) await this.uploadExport(res.blob, fileName, dir);
        else { this.download(res.blob, fileName); this.toast(t('mv_export_done'), 'good'); }
      } catch (e) {
        this.closeModal(box);
        const msg = e && e.message;
        if (msg === 'aborted') this.toast(t('mv_export_canceled'));
        else this.toast(t(msg === 'no_encoder' ? 'mv_no_encoder' : 'mv_export_failed') + (msg && msg !== 'no_encoder' ? ': ' + msg : ''), 'bad');
        if (msg !== 'aborted') console.error(e);
      } finally {
        this.exporting = null;
      }
    }

    async uploadExport(blob, fileName, dir) {
      if (await this.exists(dir, fileName) && !(await this.confirm(t('mv_overwrite_confirm', { name: fileName }), t('mv_replace')))) {
        this.download(blob, fileName);
        return;
      }
      const file = new File([blob], fileName, { type: blob.type });
      const up = window.mvmOS && window.mvmOS.upload;
      if (!up || !up.start) { this.download(blob, fileName); return; }
      up.start({
        file,
        chunkEndpoint: '/api/files/upload-chunk',
        cancelEndpoint: '/api/files/upload-chunk',
        fields: { path: dir },
        onDone: () => this.toast(t('mv_export_saved', { path: dir.replace(/\/+$/, '') + '/' + fileName }), 'good'),
        onError: () => {
          this.toast(t('mv_upload_failed'), 'bad');
          this.download(blob, fileName);
        },
      });
    }

    // ── Server file browser ──────────────────────────────────────────────
    // FolderPicker only chooses folders; this one shows the files in them,
    // limited to the kinds that can be used here.
    fileBrowser({ title, places, exts, multi, startName }) {
      return new Promise(resolve => {
        const home = places.home || '/';
        const start = (startName && (places.xdg || []).find(x => x.name === startName)) || null;
        let path = start ? start.path : home;
        const chosen = new Map();
        const box = this.modal(title, `
          <div class="mv-fb-places">
            <button class="mv-btn mv-small" data-p="${esc(home)}">🏠 ${esc(t('mv_home'))}</button>
            ${(places.xdg || []).filter(x => ['Videos', 'Music', 'Pictures', 'Downloads', 'Documents'].includes(x.name)).map(x => `<button class="mv-btn mv-small" data-p="${esc(x.path)}">${x.icon || '📁'} ${esc(x.name)}</button>`).join('')}
          </div>
          <div class="mv-fb-path"></div>
          <div class="mv-fb-list"></div>`, [
          { label: t('mv_cancel'), onClick: () => resolve(null) },
          ...(multi ? [{ label: t('mv_add'), primary: true, onClick: () => resolve([...chosen.values()]) }] : []),
        ], null, 'mv-modal-wide');
        const listEl = box.querySelector('.mv-fb-list');
        const pathEl = box.querySelector('.mv-fb-path');
        const addBtn = multi ? box.querySelector('.mv-modal-foot .mv-primary') : null;
        const updateBtn = () => { if (addBtn) { addBtn.disabled = !chosen.size; addBtn.textContent = t('mv_add') + (chosen.size ? ` (${chosen.size})` : ''); } };
        updateBtn();
        const go = async p => {
          path = p;
          pathEl.textContent = p;
          listEl.innerHTML = `<div class="mv-empty">${esc(t('mv_loading'))}</div>`;
          let entries = [];
          try {
            const r = await fetch('/api/files?path=' + encodeURIComponent(p));
            if (!r.ok) throw new Error('list');
            entries = (await r.json()).entries || [];
          } catch (e) {
            listEl.innerHTML = `<div class="mv-empty mv-bad">${esc(t('mv_folder_failed'))}</div>`;
            return;
          }
          const dirs = entries.filter(x => x.type === 'dir' && !x.name.startsWith('.'));
          const files = entries.filter(x => x.type === 'file' && exts.includes(Media().ext(x.name)));
          const parent = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
          const rows = [];
          if (p !== '/') rows.push(`<div class="mv-fb-row" data-dir="${esc(parent)}">⬆ ..</div>`);
          for (const d of dirs) rows.push(`<div class="mv-fb-row" data-dir="${esc(p.replace(/\/+$/, '') + '/' + d.name)}">📁 ${esc(d.name)}</div>`);
          for (const f of files) {
            const fp = p.replace(/\/+$/, '') + '/' + f.name;
            const kind = Media().kindOf(f.name);
            const icon = kind === 'audio' ? '🎵' : kind === 'image' ? '🖼' : kind === 'video' ? '🎬' : '📄';
            rows.push(`<div class="mv-fb-row mv-fb-file${chosen.has(fp) ? ' mv-on' : ''}" data-file="${esc(fp)}" data-name="${esc(f.name)}" data-size="${f.size || 0}">
              ${multi ? `<input type="checkbox" ${chosen.has(fp) ? 'checked' : ''}>` : ''} ${icon} <span class="mv-fb-name">${esc(f.name)}</span><span class="mv-dim">${fmtBytes(f.size || 0)}</span></div>`);
          }
          if (!dirs.length && !files.length) rows.push(`<div class="mv-empty">${esc(t('mv_folder_empty'))}</div>`);
          listEl.innerHTML = rows.join('');
        };
        box.querySelector('.mv-fb-places').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) go(b.dataset.p); });
        listEl.addEventListener('click', e => {
          const row = e.target.closest('.mv-fb-row');
          if (!row) return;
          if (row.dataset.dir) { go(row.dataset.dir); return; }
          if (!row.dataset.file) return;
          const f = { path: row.dataset.file, name: row.dataset.name, size: +row.dataset.size };
          if (!multi) { this.closeModal(box); resolve([f]); return; }
          if (chosen.has(f.path)) chosen.delete(f.path); else chosen.set(f.path, f);
          row.classList.toggle('mv-on', chosen.has(f.path));
          const cb = row.querySelector('input');
          if (cb) cb.checked = chosen.has(f.path);
          updateBtn();
        });
        listEl.addEventListener('dblclick', e => {
          const row = e.target.closest('.mv-fb-file');
          if (!row || !multi) return;
          chosen.set(row.dataset.file, { path: row.dataset.file, name: row.dataset.name, size: +row.dataset.size });
          this.closeModal(box);
          resolve([...chosen.values()]);
        });
        go(path);
      });
    }

    // ── Small UI pieces ──────────────────────────────────────────────────
    modal(title, bodyHTML, buttons, onMount, cls) {
      const ov = document.createElement('div');
      ov.className = 'mv-modal';
      ov.innerHTML = `<div class="mv-modal-box ${cls || ''}">
        <div class="mv-modal-head">${esc(title)}</div>
        <div class="mv-modal-body">${bodyHTML}</div>
        <div class="mv-modal-foot">${buttons.map((b, i) => `<button class="mv-btn${b.primary ? ' mv-primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      this.root.appendChild(ov);
      const box = ov.querySelector('.mv-modal-box');
      ov.querySelector('.mv-modal-foot').addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const def = buttons[+b.dataset.i];
        if (def.onClick && def.onClick(box) === false) return;
        if (!def.keep) this.closeModal(box);
      });
      ov.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          const cancel = buttons.find(b => !b.primary);
          if (cancel && cancel.onClick) cancel.onClick(box);
          if (!cancel || !cancel.keep) this.closeModal(box);
        } else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          const primary = buttons.findIndex(b => b.primary);
          if (primary >= 0) ov.querySelector(`[data-i="${primary}"]`).click();
        }
      });
      if (onMount) onMount(box);
      const first = box.querySelector('input[type="text"], input[type="number"], select, button.mv-primary, button');
      if (first) setTimeout(() => first.focus(), 0);
      return box;
    }
    closeModal(box) {
      const ov = box && box.closest('.mv-modal');
      if (ov) ov.remove();
      this.root.focus({ preventScroll: true });
    }
    confirm(message, okLabel) {
      return new Promise(resolve => {
        this.modal(t('mv_confirm'), `<p>${esc(message)}</p>`, [
          { label: t('mv_cancel'), onClick: () => resolve(false) },
          { label: okLabel || t('mv_ok'), primary: true, onClick: () => resolve(true) },
        ]);
      });
    }
    prompt(label, value) {
      return new Promise(resolve => {
        this.modal(label, `<input type="text" class="mv-input" value="${esc(value || '')}">`, [
          { label: t('mv_cancel'), onClick: () => resolve(null) },
          { label: t('mv_ok'), primary: true, onClick: box => resolve(box.querySelector('input').value) },
        ], box => setTimeout(() => box.querySelector('input').select(), 0));
      });
    }
    choice(title, options) {
      return new Promise(resolve => {
        const box = this.modal(title, `<div class="mv-choices">${options.map(o => `<button class="mv-btn" data-c="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>`, [
          { label: t('mv_cancel'), onClick: () => resolve(null) },
        ]);
        box.querySelector('.mv-choices').addEventListener('click', e => {
          const b = e.target.closest('[data-c]');
          if (!b) return;
          this.closeModal(box);
          resolve(b.dataset.c);
        });
      });
    }
    menu(x, y, items) {
      this.closeMenu();
      const el = document.createElement('div');
      el.className = 'mv-menu';
      el.innerHTML = items.map((it, i) => it.sep ? '<div class="mv-menu-sep"></div>' : `<div class="mv-menu-item" data-i="${i}">${it.icon ? `<span>${it.icon}</span>` : ''}${esc(it.label)}</div>`).join('');
      this.root.appendChild(el);
      const rr = this.root.getBoundingClientRect();
      el.style.left = Math.max(4, Math.min(x - rr.left, rr.width - el.offsetWidth - 4)) + 'px';
      el.style.top = Math.max(4, y - rr.top) + 'px';
      el.addEventListener('click', e => {
        const it = e.target.closest('[data-i]');
        if (!it) return;
        this.closeMenu();
        items[+it.dataset.i].onClick();
      });
      setTimeout(() => {
        this.menuAway = e => { if (!el.contains(e.target)) this.closeMenu(); };
        document.addEventListener('pointerdown', this.menuAway, true);
      }, 0);
      this.menuEl = el;
    }
    closeMenu() {
      if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
      if (this.menuAway) { document.removeEventListener('pointerdown', this.menuAway, true); this.menuAway = null; }
    }
    toast(msg, kind) {
      const el = document.createElement('div');
      el.className = 'mv-toast' + (kind ? ' mv-toast-' + kind : '');
      el.textContent = msg;
      this.root.querySelector('.mv-toasts').appendChild(el);
      setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
    }

    destroy() {
      this.dead = true;
      if (this.exporting) this.exporting.abort();
      if (this.rec) this.rec.discard();
      this.closeMenu();
      this.ro.disconnect();
      this.preview.destroy();
      for (const r of this.rt.values()) if (r.info && r.info.url) URL.revokeObjectURL(r.info.url);
      this.rt.clear();
    }
  }

  const STYLE = `
.mv-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg);color:var(--text);font-size:13px;outline:none;user-select:none}
.mv-root button{font:inherit}
.mv-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--surface);flex-wrap:wrap}
.mv-btn{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 10px;cursor:pointer;white-space:nowrap}
.mv-btn:hover:not(:disabled){border-color:var(--accent)}
.mv-btn:disabled,.mv-ibtn:disabled{opacity:.4;cursor:default}
.mv-btn.mv-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent,var(--surface,var(--surface1,#fff)))}
.mv-btn.mv-on{border-color:var(--accent);color:var(--accent)}
.mv-small{padding:3px 8px;font-size:12px}
.mv-ibtn{background:none;border:1px solid transparent;color:var(--text);border-radius:6px;padding:3px 7px;cursor:pointer;line-height:1.2}
.mv-ibtn:hover:not(:disabled){background:var(--surface2);border-color:var(--border)}
.mv-ibtn.mv-tiny{padding:1px 4px;font-size:12px}
.mv-ibtn.mv-off{opacity:.55}
.mv-sep{width:1px;align-self:stretch;background:var(--border);margin:0 2px}
.mv-grow{flex:1}
.mv-name{background:none;border:none;color:var(--text);font-weight:600;cursor:pointer;padding:3px 6px;border-radius:6px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-name:hover{background:var(--surface2)}
.mv-spec,.mv-dim{color:var(--text-dim);font-size:12px}
.mv-main{display:flex;flex:1 1 55%;min-height:120px}
.mv-lib{width:250px;min-width:180px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--surface)}
.mv-lib-head{padding:8px;border-bottom:1px solid var(--border)}
.mv-lib-title{font-weight:600;margin-bottom:6px}
.mv-lib-actions{display:flex;gap:6px;flex-wrap:wrap}
.mv-lib-list{flex:1;overflow:auto;padding:6px}
.mv-empty{color:var(--text-dim);padding:14px 8px;text-align:center;font-size:12px}
.mv-item{display:flex;gap:8px;align-items:center;padding:5px;border-radius:6px;border:1px solid transparent;cursor:grab}
.mv-item:hover{background:var(--surface2);border-color:var(--border)}
.mv-item-off{cursor:default}
.mv-thumb{width:64px;height:38px;flex:none;border-radius:4px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
.mv-thumb img{width:100%;height:100%;object-fit:cover}
.mv-thumb-icon{font-size:18px}
.mv-item-body{flex:1;min-width:0}
.mv-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-used{color:var(--accent);font-size:9px;vertical-align:middle}
.mv-item-meta,.mv-item-status{font-size:11px;color:var(--text-dim)}
.mv-bad{color:#f38ba8!important}
.mv-item-actions{display:flex;flex-direction:column;gap:2px;opacity:0}
.mv-item:hover .mv-item-actions{opacity:1}
.mv-link{background:none;border:none;color:var(--accent);cursor:pointer;padding:0;text-decoration:underline;font-size:inherit}
.mv-view{flex:1;display:flex;flex-direction:column;min-width:0}
.mv-stage{flex:1;display:flex;align-items:center;justify-content:center;background:#111;min-height:0;overflow:hidden}
.mv-canvas{background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.mv-transport{display:flex;align-items:center;gap:10px;padding:5px 8px;border-top:1px solid var(--border);background:var(--surface);flex-wrap:wrap;min-height:36px}
.mv-tp-left{display:flex;align-items:center;gap:2px}
.mv-play{font-size:15px;min-width:34px}
.mv-time{font-variant-numeric:tabular-nums;margin-left:8px;font-size:12px}
.mv-num{width:64px}

.mv-panel{width:268px;flex:none;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;min-width:0}
.mv-tabs{display:flex;border-bottom:1px solid var(--border);min-height:0}
.mv-tabs:empty{display:none}
.mv-tab{flex:1;padding:8px 4px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;font:inherit}
.mv-tab:hover{color:var(--text)}
.mv-tab.mv-on{color:var(--text);border-bottom-color:var(--accent);font-weight:600}
.mv-pbody{flex:1;overflow:auto;padding:12px}
.mv-ptitle{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px}
.mv-prow{margin:12px 0}
.mv-prow>span{display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px}
.mv-vrow{display:flex;align-items:center;gap:6px}
.mv-vrow input[type=range]{flex:1;min-width:0}
.mv-hint{margin:8px 0 14px;line-height:1.4}
.mv-note{margin-top:10px;color:var(--text-dim)}
.mv-wide{width:100%;margin-top:8px}
.mv-th-sel{background:var(--surface2)!important}
.mv-th-name{cursor:pointer}
.mv-fade{position:absolute;top:0;height:100%;display:block;pointer-events:none}
.mv-fade-in{left:0}.mv-fade-out{right:0}
.mv-fh{position:absolute;top:3px;width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid #0b2a40;box-sizing:border-box;cursor:ew-resize;z-index:4;pointer-events:auto}
.mv-root input[type=text],.mv-root input[type=number],.mv-root select{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit}
.mv-tl{flex:1 1 45%;display:flex;flex-direction:column;border-top:1px solid var(--border);min-height:140px;background:var(--surface)}
.mv-tl-tools{display:flex;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.mv-tl-scroll{flex:1;overflow:auto;position:relative}
.mv-tl-inner{position:relative;min-height:100%}
.mv-ruler-row{position:sticky;top:0;z-index:4;display:flex;height:22px;background:var(--surface);border-bottom:1px solid var(--border)}
.mv-corner{position:sticky;left:0;width:${HEADER_W}px;box-sizing:border-box;flex:none;background:var(--surface);z-index:5;border-right:1px solid var(--border)}
.mv-ruler{position:sticky;left:${HEADER_W}px;display:block;cursor:pointer}
.mv-row{display:flex;height:52px;border-bottom:1px solid var(--border)}
.mv-row-video{height:78px}
.mv-row-audio{height:44px}
.mv-th{position:sticky;left:0;z-index:3;width:${HEADER_W}px;box-sizing:border-box;flex:none;display:flex;flex-wrap:wrap;align-content:center;align-items:center;gap:2px;padding:0 6px;background:var(--surface);border-right:1px solid var(--border)}
.mv-th-name{font-weight:600;width:28px;color:var(--text-dim)}
.mv-lane{position:relative;flex:none;background:var(--bg)}
.mv-row-audio .mv-lane{background:color-mix(in srgb,var(--bg) 92%,#2a9d8f)}
.mv-clip{position:absolute;top:3px;bottom:3px;border-radius:5px;overflow:hidden;cursor:grab;background:#3b5bdb;background-repeat:repeat-x;background-size:auto 100%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);color:#fff}
.mv-clip-image{background-color:#7048e8}
.mv-clip-audio{background-color:#2a9d8f}
.mv-clip-bad{background-color:#8b3a3a;background-image:none!important}
.mv-clip.mv-sel{box-shadow:0 0 0 2px var(--accent),inset 0 0 0 1px rgba(0,0,0,.35);z-index:2}
.mv-clip.mv-dragging{opacity:.85;cursor:grabbing;z-index:3}
.mv-clip-label{position:absolute;left:6px;right:6px;top:2px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.9);pointer-events:none}
.mv-wave{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.mv-clip-split{background-size:auto 56%;background-position:left top;background-color:#27408b}
.mv-snd{position:absolute;left:0;right:0;bottom:0;height:44%;background:rgba(10,30,40,.72);border-top:1px solid rgba(255,255,255,.18);pointer-events:none}
.mv-snd .mv-wave{background:none}
.mv-h{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:2}
.mv-h-l{left:0}.mv-h-r{right:0}
.mv-h:hover,.mv-sel .mv-h{background:rgba(255,255,255,.28)}
.mv-ghost{position:absolute;top:3px;bottom:3px;border:2px dashed var(--accent);border-radius:5px;background:color-mix(in srgb,var(--accent) 20%,transparent);pointer-events:none}
.mv-playhead{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#ff4757;z-index:4;pointer-events:none}
.mv-playhead::before{content:'';position:absolute;top:0;left:-5px;border:6px solid transparent;border-top:8px solid #ff4757}
.mv-toasts{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;z-index:30;pointer-events:none}
.mv-toast{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);padding:8px 12px;border-radius:6px;box-shadow:var(--shadow);max-width:380px}
.mv-toast-good{border-left-color:#40c057}
.mv-toast-bad{border-left-color:#f38ba8}
.mv-drop-hint{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fff;font-size:16px;z-index:25;pointer-events:none;border:3px dashed var(--accent)}
.mv-drop-hint.mv-show{display:flex}
.mv-modal{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:40}
.mv-modal-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,8px);box-shadow:var(--shadow);width:min(440px,92%);max-height:88%;display:flex;flex-direction:column}
.mv-modal-wide{width:min(620px,94%)}
.mv-modal-head{padding:12px 14px;font-weight:600;border-bottom:1px solid var(--border)}
.mv-modal-body{padding:12px 14px;overflow:auto;user-select:text}
.mv-modal-body p{margin:0 0 8px}
.mv-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--border)}
.mv-input{width:100%;box-sizing:border-box}
.mv-field{display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center;margin-bottom:10px}
.mv-field>span{color:var(--text-dim)}
.mv-field input[type=text],.mv-field select{width:100%;box-sizing:border-box}
.mv-field input[type=number]{width:90px}
.mv-hint{color:var(--text-dim);font-size:12px}
.mv-radio{display:flex;flex-direction:column;gap:6px}
.mv-radio label{display:flex;align-items:center;gap:6px;flex-wrap:wrap;word-break:break-all}
.mv-progress{height:10px;border-radius:5px;background:var(--surface2);overflow:hidden;margin:6px 0 10px}
.mv-progress-fill{height:100%;width:0;background:var(--accent);transition:width .2s}
.mv-progress-text{font-variant-numeric:tabular-nums}
.mv-choices{display:flex;flex-direction:column;gap:8px}
.mv-fb-places{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.mv-fb-path{font-size:12px;color:var(--text-dim);margin-bottom:6px;word-break:break-all}
.mv-fb-list{border:1px solid var(--border);border-radius:6px;height:min(340px,45vh);overflow:auto;user-select:none}
.mv-fb-row{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent)}
.mv-fb-row:hover{background:var(--surface2)}
.mv-fb-row.mv-on{background:color-mix(in srgb,var(--accent) 18%,transparent)}
.mv-fb-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-rec{color:#e03131}
.mv-live{opacity:.85;pointer-events:none;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.12) 0 8px,transparent 8px 16px)}
.mv-recbar{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:35;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)}
.mv-rec-dot{width:12px;height:12px;border-radius:50%;background:#e03131;animation:mv-blink 1s infinite}
.mv-counting .mv-rec-dot{animation:none;background:var(--text-dim)}
.mv-rec-count{font-size:22px;font-weight:700;min-width:16px;text-align:center}
.mv-rec-time{font-variant-numeric:tabular-nums;min-width:40px}
.mv-meter{flex:1;min-width:120px;height:10px;background:var(--surface2);border-radius:5px;overflow:hidden}
.mv-meter i{display:block;height:100%;width:0;background:#40c057;transition:width .06s}
@keyframes mv-blink{50%{opacity:.25}}
.mv-fx-row{display:flex;align-items:center;gap:8px}.mv-fx-row input{flex:1}.mv-fx-row b{min-width:44px;text-align:right;font-weight:500}
.mv-fx-toggle{display:flex;gap:10px;align-items:flex-start;margin:0 0 10px;cursor:pointer}
.mv-fx-toggle input{margin-top:3px}
.mv-menu{position:absolute;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);padding:4px;min-width:220px}
.mv-menu-item{display:flex;gap:8px;padding:7px 10px;border-radius:5px;cursor:pointer;white-space:nowrap}
.mv-menu-item:hover{background:var(--surface2)}
.mv-menu-sep{height:1px;background:var(--border);margin:4px 0}
@media (max-width:760px){.mv-lib{width:170px;min-width:0}.mv-panel{width:190px}.mv-spec{display:none}}
`;

  window.MvmVideo = {
    mount(root, opts) {
      const ed = new Editor(root, opts);
      requestAnimationFrame(() => { ed.layout(); });
      return { editor: ed, destroy: () => ed.destroy(), openPath: p => ed.openServerProject(p) };
    },
  };
})();
