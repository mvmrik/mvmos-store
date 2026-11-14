// Written by mvmOS App Builder from a platform template. A game is played on its Game Hub page;
// this window only launches it. The game itself runs in a sandbox (see mp.js).
(function () {
  var ID = "my-ttt-test";
  var NAMES = {"bg": "TTT Test", "de": "TTT Test", "en": "TTT Test", "es": "TTT Test", "fr": "TTT Test", "ja": "TTT Test", "pt-BR": "TTT Test", "ru": "TTT Test", "zh-CN": "TTT Test"};
  function appName() { var l = (window.mvmOS && mvmOS.lang) || 'en'; return NAMES[l] || NAMES.en || "TTT Test"; }
  mvmOS.registerApp({
    id: ID,
    name: "TTT Test",
    icon: "🎮",
    category: 'Games',
    launch: function () {
      if (!window.GameLauncher) { mvmOS.notify(appName(), 'This game needs a newer mvmOS.'); return; }
      window.GameLauncher.open({
        id: ID,
        name: appName,
        icon: "🎮",
        tagline: function () { return t('bld_tagline_' + ID.replace(/-/g, '_')); },
      });
    },
  });
})();
