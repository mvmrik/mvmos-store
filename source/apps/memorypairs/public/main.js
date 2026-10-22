// mvmOS App: Remember the Pairs v1.0.0
//
// There is deliberately no game in this file. Like every game written against
// the Game Hub pattern, Remember the Pairs is played on its public Game Hub
// page — the only place an Apps Hub account exists, and therefore the only
// place where several people can take turns at the same table and score in
// the leaderboards. A game opened in its own tab also gets the entire screen,
// which is what a game wants on a phone.
//
// So this window is a launcher, and core's GameLauncher (frontend/
// gamelauncher.js) is the whole of it: it opens the game in Game Hub, and it
// installs Game Hub in place when it is missing.
//
// The game itself lives in public/mp.js (client), public/faces.js (the
// pictures), public/cylinder3d.js (the 3D view) and mp_game.py (the table, on the
// server).

mvmOS.registerApp({
  id: 'memorypairs',
  name: 'Remember the Pairs',
  icon: '🧠',
  category: 'Games',
  launch() {
    window.GameLauncher.open({
      id: 'memorypairs',
      name: () => t('mp_title'),
      icon: '🧠',
      // Resolved lazily: the launcher merges this app's string table
      // (public/i18n.js) before it renders.
      tagline: () => t('mp_tagline'),
    });
  },
});
