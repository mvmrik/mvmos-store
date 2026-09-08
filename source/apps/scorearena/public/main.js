const _saBoot = {
  en: { title: 'Score Arena', tagline: 'Every throw. Every rival. Every result.', old: 'This game needs a newer mvmOS core.' },
  bg: { title: 'Score Arena', tagline: 'Всяко хвърляне. Всеки съперник. Всеки резултат.', old: 'Тази игра изисква по-нова версия на mvmOS.' },
  de: { title: 'Score Arena', tagline: 'Jeder Wurf. Jeder Rivale. Jedes Ergebnis.', old: 'Dieses Spiel benötigt eine neuere mvmOS-Kernversion.' },
  es: { title: 'Score Arena', tagline: 'Cada lanzamiento. Cada rival. Cada resultado.', old: 'Este juego necesita una versión más reciente del núcleo de mvmOS.' },
  fr: { title: 'Score Arena', tagline: 'Chaque lancer. Chaque rival. Chaque résultat.', old: 'Ce jeu nécessite une version plus récente du noyau mvmOS.' },
  ja: { title: 'Score Arena', tagline: 'すべての一投。すべてのライバル。すべての結果。', old: 'このゲームには新しいバージョンのmvmOSコアが必要です。' },
  'pt-BR': { title: 'Score Arena', tagline: 'Cada lançamento. Cada rival. Cada resultado.', old: 'Este jogo precisa de uma versão mais recente do núcleo do mvmOS.' },
  ru: { title: 'Score Arena', tagline: 'Каждый бросок. Каждый соперник. Каждый результат.', old: 'Для этой игры требуется более новая версия ядра mvmOS.' },
  'zh-CN': { title: 'Score Arena', tagline: '每一次投掷。每一位对手。每一个结果。', old: '此游戏需要更新版本的 mvmOS 核心。' },
};
function _sat(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_saBoot[lang] || _saBoot.en)[key] || key;
}
mvmOS.registerApp({
  id: 'scorearena', name: _sat('title'), icon: '🎯', category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_sat('title'), _sat('old'));
      return;
    }
    window.GameLauncher.open({ id: 'scorearena', name: _sat('title'), icon: '🎯', tagline: () => _sat('tagline') });
  },
});
