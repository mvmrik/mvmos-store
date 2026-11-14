(async function () {
  const root = document.querySelector('#design-public-root');
  const login = () =>
    location.replace(
      '/pub/apphub/?return=' + encodeURIComponent(location.href),
    );
  const load = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = window.asset(src);
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  try {
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      login();
      return;
    }
    const response = await fetch('/api/pub/apphub/me', {
      headers: { 'X-Pub-Token': token },
      cache: 'no-store',
    });
    if (!response.ok) {
      login();
      return;
    }
    const user = await response.json();
    await (window.mvmOS?.i18nReady || Promise.resolve());
    for (const file of [
      'i18n',
      'model',
      'render',
      'export',
      'projects',
      'ai',
      'editor',
    ])
      await load('/apps/mvmdesign/' + file + '.js');
    const editor = new window.MvmDesign.Editor(root, {
      public: true,
      token,
      user,
    });
    root.removeAttribute('aria-busy');
    await editor.ready;
    await editor.projectDialog();
    window.addEventListener('pagehide', () => editor.destroy(), { once: true });
  } catch (error) {
    root.textContent = String(error.message || error);
    root.removeAttribute('aria-busy');
  }
})();
