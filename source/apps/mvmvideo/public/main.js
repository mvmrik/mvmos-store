// mvmOS App: mvmVideo v1.0.0
const _mvti18n = {
  en: { title: 'mvmVideo' },
  bg: { title: 'mvmVideo' },
  de: { title: 'mvmVideo' },
  es: { title: 'mvmVideo' },
  fr: { title: 'mvmVideo' },
  ja: { title: 'mvmVideo' },
  'pt-BR': { title: 'mvmVideo' },
  ru: { title: 'mvmVideo' },
  'zh-CN': { title: 'mvmVideo' },
};
function _mvtt(key) { const lang = window.mvmOS?.lang || 'en'; return (_mvti18n[lang] || _mvti18n.en)[key] || key; }

function _mvLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
// In order: every file uses the ones before it. The media library
// (lib/mediabunny.min.mjs) is an ES module and is imported by media.js the
// first time it is needed.
async function _loadMvmVideoAssets() {
  const files = [
    ['MVMVIDEO_I18N', 'i18n.js'],
    ['MvmVideoMedia', 'media.js'],
    ['MvmVideoExport', 'export.js'],
    ['MvmVideoPreview', 'preview.js'],
    ['MvmVideo', 'editor.js'],
  ];
  for (const [global, file] of files) {
    if (!window[global]) await _mvLoadScript('/apps/mvmvideo/' + file);
  }
}

// The open window's editor, so a project opened from File Manager while the
// window is already up goes into it instead of a second window.
let _mvHandle = null;

function _mvOpenWindow(path) {
  if (_mvHandle && document.body.contains(_mvHandle.editor.root)) {
    mvmOS.createWindow({ id: 'mvmvideo' });
    if (path) _mvHandle.openPath(path);
    return;
  }
  mvmOS.createWindow({
    id: 'mvmvideo',
    title: '🎬 ' + _mvtt('title'),
    width: 1280,
    height: 800,
    onMount(body) {
      body.style.padding = '0';
      body.innerHTML = `<div class="mvmvideo-root" style="height:100%"></div>`;
      const root = body.querySelector('.mvmvideo-root');
      let handle = null;

      _loadMvmVideoAssets().then(() => {
        if (document.body.contains(root)) {
          handle = _mvHandle = window.MvmVideo.mount(root, { desktop: true, openPath: path || null });
        }
      });

      const observer = new MutationObserver(() => {
        if (!document.body.contains(root)) {
          if (handle) handle.destroy();
          if (_mvHandle === handle) _mvHandle = null;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
  });
}

mvmOS.registerApp({
  id: 'mvmvideo',
  name: _mvtt('title'),
  icon: '🎬',
  category: 'Media',
  file_types: ['mvmvideo'],
  launch() { _mvOpenWindow(null); },
  openFile(path) { _mvOpenWindow(path); },
});
