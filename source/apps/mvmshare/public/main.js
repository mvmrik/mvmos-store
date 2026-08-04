// mvmOS App: mvmShare v1.0.0
//
// The desktop window is a thin shell: the entire interface lives in
// share-widget.js, which the public page mounts in exactly the same way, so
// there is only ever one form, one list and one unlock screen to maintain.
const _mshI18n = {
  en: { title: 'mvmShare' },
  bg: { title: 'mvmShare' },
};
function _msht(key) { const lang = window.mvmOS?.lang || 'en'; return (_mshI18n[lang] || _mshI18n.en)[key] || key; }

function _mshLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Always fetched fresh, every time the window opens — never gated on
// `window.MvmShare`/`window.MSH_I18N` already being set. A `?_=Date.now()`
// cache-buster on the <script> tag is worthless if the tag is never created
// again in the first place: once these globals exist from an earlier launch
// in the same desktop session, an `if (!window.X)` guard would skip the
// request entirely and silently keep running whatever code loaded first,
// for as long as the desktop tab stays open — no server or browser cache
// involved at all.
function _mshAssets() {
  return Promise.all([
    _mshLoadScript('/apps/mvmshare/i18n.js'),
    _mshLoadScript('/apps/mvmshare/share-widget.js'),
  ]);
}

mvmOS.registerApp({
  id: 'mvmshare',
  name: _msht('title'),
  icon: '🔗',
  category: 'Security & Privacy',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'mvmshare',
      title: '🔗 ' + _msht('title'),
      width: 960,
      height: 720,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = '<div id="mvmshare-root" style="height:100%"></div>';
        const root = body.querySelector('#mvmshare-root');
        _mshAssets()
          .then(() => window.MvmShare.mountManager(root))
          .catch(() => {
            root.innerHTML = '<div style="padding:24px;color:var(--text-dim)">…</div>';
          });
        // The strings come from the app's own table, which is re-merged on
        // every language change — so the window is rebuilt rather than left
        // half-translated behind the user. The isConnected check is what keeps
        // a closed window's listener from redrawing into a detached node.
        mvmOS.onLangChange?.(() => {
          if (window.MvmShare && root.isConnected) window.MvmShare.mountManager(root);
        });
      },
    });
  },
});
