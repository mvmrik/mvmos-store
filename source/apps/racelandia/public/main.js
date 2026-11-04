// mvmOS App: Racelandia
//
// There is deliberately no game in this file. Like every game written against
// the Game Hub pattern, Racelandia is played on its public Game Hub page: the
// only place an Apps Hub account exists, and so the only place where drivers,
// budgets and the best laps of several people can live. This window is a
// launcher, and core's GameLauncher is the whole of it.
//
// The game lives in public/mp.js (the garage and the playback), public/sim.js
// (the physics), public/view3d.js (the circuit and the cars), public/train.js
// (the training simulators) and, on the server, mp_game.py, apex_data.py and
// api.py.

mvmOS.registerApp({
  id: 'racelandia',
  name: 'Racelandia',
  icon: '🏁',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) { mvmOS.notify('Racelandia', 'This game needs a newer mvmOS core.'); return; }
    window.GameLauncher.open({
      id: 'racelandia',
      name: () => { const n = t('ap_title'); return n === 'ap_title' ? 'Racelandia' : n; },
      icon: '🏁',
      tagline: () => t('ap_tagline'),
    });
  },
});
