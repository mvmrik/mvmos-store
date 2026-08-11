// Tower Defense — own translations, shipped inside this app's store zip.
// Not in core frontend/i18n/*.js: those files aren't part of the app zip, so
// anything added there would never reach another mvmOS instance that installs
// this game from the store. Merges into window._i18n, same as core does, and
// re-applies on every language switch.
//
// Loaded in both of the places this game appears: the desktop launcher window
// (pulled in by core's GameLauncher) and the public Game Hub play page (pulled
// in by the play-page template in Game Hub's mp.py).
(function () {
  if (window.TOWERDEFENSE_I18N) return;

  var STRINGS = {
    en: {
      td_title:            'Tower Defense',
      td_tagline:          'One tower, no help. Waves close in from every side — hold out as long as you can.',

      td_difficulty:       'Difficulty',
      td_easy:             'Easy',
      td_normal:           'Normal',
      td_hard:             'Hard',

      td_wave:             'Wave',
      td_score:            'Score',
      td_integrity:        'Integrity',
      td_incoming:         'Wave {n} incoming',
      td_kills:            'Kills',
      td_survived:         'Survived',

      td_game_over:        'The tower has fallen',
      td_final_score:      'Final score',
      td_play_again:       '↻ Play again',
      td_back_to_hub:      '‹ Game Hub',
      td_starting:         'Starting…',
      td_error_new_game:   'A new game could not be started.',

      td_exit:             '⏸ Exit',
    },
    bg: {
      td_title:            'Tower Defense',
      td_tagline:          'Една кула, без помощ. Вълните идват от всички страни — издържи колкото можеш.',

      td_difficulty:       'Трудност',
      td_easy:             'Лесно',
      td_normal:           'Нормално',
      td_hard:             'Трудно',

      td_wave:             'Вълна',
      td_score:            'Точки',
      td_integrity:        'Здравина',
      td_incoming:         'Идва вълна {n}',
      td_kills:            'Убити',
      td_survived:         'Издържа',

      td_game_over:        'Кулата падна',
      td_final_score:      'Краен резултат',
      td_play_again:       '↻ Играй пак',
      td_back_to_hub:      '‹ Game Hub',
      td_starting:         'Стартиране…',
      td_error_new_game:   'Нова игра не можа да бъде стартирана.',

      td_exit:             '⏸ Изход',
    },
  };

  function apply(lang) {
    var table = STRINGS[lang] || STRINGS.en;
    window._i18n = window._i18n || {};
    for (var k in table) window._i18n[k] = table[k];
  }

  apply((window.mvmOS && window.mvmOS.lang) || 'en');
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
  window.TOWERDEFENSE_I18N = true;
})();
