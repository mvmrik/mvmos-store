// mvmOS App: mvmOffice v1.0.0
const _moti18n = {
  en: { title: 'mvmOffice' },
  bg: { title: 'mvmOffice' },
  de: { title: 'mvmOffice' },
  es: { title: 'mvmOffice' },
  fr: { title: 'mvmOffice' },
  ja: { title: 'mvmOffice' },
  'pt-BR': { title: 'mvmOffice' },
  ru: { title: 'mvmOffice' },
  'zh-CN': { title: 'mvmOffice' },
};
function _mott(key) { const lang = window.mvmOS?.lang || 'en'; return (_moti18n[lang] || _moti18n.en)[key] || key; }

function _moLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
// In order: every file uses the ones before it.
async function _loadMvmOfficeAssets() {
  const files = [
    ['MvmPM', 'lib/prosemirror.min.js'],
    ['MVMOFFICE_I18N', 'i18n.js'],
    ['MvmOfficeFormula', 'formula.js'],
    ['MvmOfficeModel', 'model.js'],
    ['MvmOfficeGrid', 'grid.js'],
    ['MvmOfficeEditor', 'editor.js'],
    ['MvmOfficeXlsx', 'xlsx.js'],
    ['MvmOfficeDocx', 'docx.js'],
    ['MvmOffice', 'office.js'],
  ];
  for (const [global, file] of files) {
    if (!window[global]) await _moLoadScript('/apps/mvmoffice/' + file);
  }
}

// The open window's office, so a file opened from File Manager while the
// window is already up goes into it instead of a second window.
let _moHandle = null;

function _moOpenWindow(path) {
  if (_moHandle && document.body.contains(_moHandle.office.root)) {
    mvmOS.createWindow({ id: 'mvmoffice' });
    if (path) _moHandle.office.openPath(path);
    return;
  }
  mvmOS.createWindow({
    id: 'mvmoffice',
    title: '📝 ' + _mott('title'),
    width: 1100,
    height: 760,
    onMount(body) {
      body.style.padding = '0';
      body.innerHTML = `<div class="mvmoffice-root" style="height:100%"></div>`;
      const root = body.querySelector('.mvmoffice-root');
      let handle = null;

      _loadMvmOfficeAssets().then(() => {
        if (document.body.contains(root)) {
          handle = _moHandle = window.MvmOffice.mount(root, { desktop: true, openPath: path || null });
        }
      });

      const observer = new MutationObserver(() => {
        if (!document.body.contains(root)) {
          if (handle) handle.destroy();
          if (_moHandle === handle) _moHandle = null;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
  });
}

mvmOS.registerApp({
  id: 'mvmoffice',
  name: _mott('title'),
  icon: '📝',
  category: 'Productivity',
  requires_apphub: true,
  file_types: ['mvmoffice'],
  launch() { _moOpenWindow(null); },
  openFile(path) { _moOpenWindow(path); },
});
