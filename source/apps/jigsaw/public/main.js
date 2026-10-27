// mvmOS App: Jigsaw
//
// There is deliberately no game in this file. Like every game written against
// the Game Hub pattern, Jigsaw is played on its public Game Hub page — the
// only place an Apps Hub account exists, and therefore the only place where
// several people can build the same picture and score in the leaderboards. A
// game opened in its own tab also gets the entire screen, which is what a game
// wants on a phone.
//
// So this window is a launcher, and core's GameLauncher (frontend/
// gamelauncher.js) is the whole of it: it opens the game in Game Hub, and it
// installs Game Hub in place when it is missing.
//
// The game itself lives in public/mp.js (client), public/table3d.js (the 3D
// table) and mp_game.py (the picture and the rules, on the server).

mvmOS.registerApp({
  id: 'jigsaw',
  name: 'Jigsaw',
  icon: '🧩',
  category: 'Games',
  launch() {
    window.GameLauncher.open({
      id: 'jigsaw',
      // The window is made before the game's own strings are loaded the first
      // time, so until then the name is the plain one.
      name: () => { const n = t('jp_title'); return n === 'jp_title' ? 'Jigsaw' : n; },
      icon: '🧩',
      // Resolved lazily: the launcher merges this app's string table
      // (public/i18n.js) before it renders.
      tagline: () => t('jp_tagline'),
    });
  },
});
