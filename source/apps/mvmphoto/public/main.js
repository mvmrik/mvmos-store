// mvmOS App: mvmPhoto v1.0.0
const _mvti18n = {
  en: { title: 'mvmPhoto' },
  bg: { title: 'mvmPhoto' },
  de: { title: 'mvmPhoto' },
  es: { title: 'mvmPhoto' },
  fr: { title: 'mvmPhoto' },
  ja: { title: 'mvmPhoto' },
  'pt-BR': { title: 'mvmPhoto' },
  ru: { title: 'mvmPhoto' },
  'zh-CN': { title: 'mvmPhoto' },
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
// In order: every file uses the ones before it.
async function _loadMvmPhotoAssets() {
  const files = [
    ['MVMPHOTO_I18N', 'i18n.js'],
    ['MvmPhotoDoc', 'doc.js'],
    ['MvmPhotoUI', 'ui.js'],
    ['MvmPhotoTools', 'tools.js'],
    ['MvmPhoto', 'editor.js'],
  ];
  for (const [global, file] of files) {
    if (!window[global]) await _mvLoadScript('/apps/mvmphoto/' + file);
  }
}

// The open window's editor, so an image or project opened from File Manager while the
// window is already up goes into it instead of a second window.
let _mvHandle = null;

function _mvOpenWindow(path) {
  if (_mvHandle && document.body.contains(_mvHandle.editor.root)) {
    mvmOS.createWindow({ id: 'mvmphoto' });
    if (path) _mvHandle.openPath(path);
    return;
  }
  mvmOS.createWindow({
    id: 'mvmphoto',
    title: '🎨 ' + _mvtt('title'),
    width: 1280,
    height: 800,
    onMount(body) {
      body.style.padding = '0';
      body.innerHTML = `<div class="mvmphoto-root" style="height:100%"></div>`;
      const root = body.querySelector('.mvmphoto-root');
      let handle = null;

      _loadMvmPhotoAssets().then(() => {
        if (document.body.contains(root)) {
          handle = _mvHandle = window.MvmPhoto.mount(root, { desktop: true, openPath: path || null });
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
  id: 'mvmphoto',
  name: _mvtt('title'),
  icon: '🎨',
  category: 'Creative',
  file_types: ['mvmphoto', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
  launch() { _mvOpenWindow(null); },
  openFile(path) { _mvOpenWindow(path); },
});
