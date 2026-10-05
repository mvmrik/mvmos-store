// mvmOS App: Hearthvale
//
// The game is played on its public Game Hub page, like every game written
// against this pattern: this window is only core's GameLauncher, which opens
// it there and installs Game Hub in place when it is missing.
//
// The game itself lives in public/mp.js (client), mp_game.py and hv_world.py
// (server, the one shared world).

mvmOS.registerApp({
  id: 'hearthvale',
  name: 'Hearthvale',
  icon: '🏡',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify('Hearthvale', 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({
      id: 'hearthvale',
      name: 'Hearthvale',
      icon: '🏡',
      // Resolved lazily: the launcher merges this app's string table
      // (public/i18n.js) before it renders.
      tagline: () => t('hv_tagline'),
    });
  },
});
