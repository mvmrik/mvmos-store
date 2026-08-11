// mvmOS App: Tower Defense v1.0.0
//
// There is deliberately no game in this file. Tower Defense — like every game
// written against this pattern — is played on its public Game Hub page, which
// is the only place an Apps Hub account exists, and therefore the only place
// where anyone besides the single session logged into this desktop can play,
// score and appear in the leaderboards. A game opened in its own tab also gets
// the entire screen, which is what a game wants on a phone.
//
// So this window is a launcher, and core's GameLauncher (frontend/
// gamelauncher.js) is the whole of it: it opens the game in Game Hub, and it
// installs Game Hub in place when it is missing. Anything that belongs to the
// owner of the server rather than to a player — settings, premium switches —
// goes into `sections` below, and never travels to the public page.
//
// The game itself lives in public/mp.js (client) and mp_game.py (server).

const _tdBoot = {
  en: { title: 'Tower Defense' },
  bg: { title: 'Tower Defense' },
};
function _tdt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_tdBoot[lang] || _tdBoot.en)[key] || key;
}

mvmOS.registerApp({
  id: 'towerdefense',
  name: _tdt('title'),
  icon: '🏰',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_tdt('title'), 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({
      id: 'towerdefense',
      name: _tdt('title'),
      icon: '🏰',
      // Resolved lazily: the launcher merges this app's string table
      // (public/i18n.js) before it renders.
      tagline: () => t('td_tagline'),
    });
  },
});
