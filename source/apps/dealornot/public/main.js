// mvmOS App: Deal or Not v1.0.0
//
// There is deliberately no game in this file. Like every game written against
// the Game Hub pattern, Deal or Not is played on its public Game Hub page, where
// the players' Apps Hub accounts exist and where several people can share one
// board. This window is a launcher: core's GameLauncher opens the game in Game
// Hub and installs Game Hub in place when it is missing.
//
// The game itself lives in public/mp.js (client) and mp_game.py (the boxes and
// the banker, on the server).

mvmOS.registerApp({
  id: 'dealornot',
  name: 'Deal or Not',
  icon: '💼',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) { mvmOS.notify('Deal or Not', 'This game needs a newer mvmOS core.'); return; }
    window.GameLauncher.open({
      id: 'dealornot',
      name: () => t('dn_title'),
      icon: '💼',
      tagline: () => t('dn_tagline'),
    });
  },
});
