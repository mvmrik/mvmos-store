// Written by mvmOS App Builder: the one line of text the game's launcher window shows.
(function () {
  var KEY = 'bld_tagline_' + "my-ttt-test".replace(/-/g, '-').replace(/-/g, '_');
  var TABLES = {"bg": {"tagline": "TTT Test"}, "de": {"tagline": "TTT Test"}, "en": {"tagline": "TTT Test"}, "es": {"tagline": "TTT Test"}, "fr": {"tagline": "TTT Test"}, "ja": {"tagline": "TTT Test"}, "pt-BR": {"tagline": "TTT Test"}, "ru": {"tagline": "TTT Test"}, "zh-CN": {"tagline": "TTT Test"}};
  function apply() {
    var lang = (window.mvmOS && window.mvmOS.lang) || document.documentElement.lang || 'en';
    var table = TABLES[lang] || TABLES.en;
    window._i18n = window._i18n || {};
    window._i18n[KEY] = table.tagline;
  }
  apply();
  window.addEventListener('i18n-loaded', apply);
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
})();
