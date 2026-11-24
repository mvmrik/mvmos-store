// mvmOS App: Road to a Million
//
// There is deliberately no game in this file. Like every game written against
// the Game Hub pattern, it is played on its public Game Hub page, where the
// players' Apps Hub accounts exist and where several people can answer the same
// question. This window is a launcher: core's GameLauncher opens the game in
// Game Hub and installs Game Hub in place when it is missing.
//
// The game itself lives in public/mp.js (client) and mp_game.py (the questions,
// the lifelines and the money, on the server).

// The window title is read when the window is created, before the launcher has
// loaded this game's strings, so the table is loaded first (the launcher then
// finds the same script tag and does not load it twice).
function _rmLoadI18n() {
  return new Promise(resolve => {
    if (document.getElementById('game-i18n-roadtomillion')) return resolve();
    const s = document.createElement('script');
    s.id = 'game-i18n-roadtomillion';
    s.src = asset('/apps/roadtomillion/i18n.js');
    s.onload = resolve;
    s.onerror = resolve;
    document.head.appendChild(s);
  });
}

// Owner-side only: the question manager is a desktop tool and is not part of
// the public Game Hub page.
function _rmManageSection(el, showManager) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:flex-start';
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:.8rem;color:var(--text-dim);line-height:1.5';
  hint.textContent = t('rmm_section_hint');
  const btn = document.createElement('button');
  btn.className = 's-btn';
  btn.textContent = '📝 ' + t('rmm_manage');
  btn.onclick = async () => {
    if (!window.RoadToMillionManager) {
      await new Promise(res => {
        const s = document.createElement('script');
        s.src = asset('/apps/roadtomillion/manager.js');
        s.onload = res; s.onerror = res;
        document.head.appendChild(s);
      });
    }
    if (window.RoadToMillionManager) showManager();
  };
  row.append(hint, btn);
  el.appendChild(row);
}

mvmOS.registerApp({
  id: 'roadtomillion',
  name: 'The Road to Millions',
  icon: '💎',
  category: 'Games',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'roadtomillion' }); },
  async launch() {
    if (!window.GameLauncher) { mvmOS.notify('Road to a Million', 'This game needs a newer mvmOS core.'); return; }
    await _rmLoadI18n();
    const game = {
      id: 'roadtomillion',
      name: () => t('rm_title'),
      icon: '💎',
      tagline: () => t('rm_tagline'),
      sections: [{ title: t('rmm_section'), render: el => _rmManageSection(el, showManager) }],
    };
    let body;
    function showLauncher() { window.GameLauncher.render(body, game); }
    function showManager() {
      body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
      body.replaceChildren();
      const bar = document.createElement('div');
      bar.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border)';
      const back = document.createElement('button');
      back.className = 's-btn';
      back.textContent = '← ' + t('back');
      back.onclick = showLauncher;
      bar.appendChild(back);
      const content = document.createElement('div');
      content.style.cssText = 'flex:1;min-height:0';
      body.append(bar, content);
      window.RoadToMillionManager.mount(content);
    }
    mvmOS.createWindow({
      id: 'roadtomillion', title: '💎 ' + t('rm_title'), width: 1040, height: 700,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'roadtomillion' }); },
      onMount(el) { body = el; showLauncher(); },
    });
  },
});
