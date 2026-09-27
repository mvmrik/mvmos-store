const _htcBoot = {
  en: { title: 'Hattrick Calculator', tagline: 'Squad, best lineup, training and arena planning for Hattrick.', old: 'This app needs a newer mvmOS core.' },
  bg: { title: 'Hattrick Calculator', tagline: 'Състав, най-добър състав за мача, тренировки и стадион за Hattrick.', old: 'Това приложение изисква по-нова версия на mvmOS.' },
  de: { title: 'Hattrick Calculator', tagline: 'Kader, beste Aufstellung, Training und Stadionplanung für Hattrick.', old: 'Diese App benötigt eine neuere mvmOS-Kernversion.' },
  es: { title: 'Hattrick Calculator', tagline: 'Plantilla, mejor alineación, entrenamiento y estadio para Hattrick.', old: 'Esta aplicación necesita una versión más reciente del núcleo de mvmOS.' },
  fr: { title: 'Hattrick Calculator', tagline: 'Effectif, meilleure composition, entraînement et stade pour Hattrick.', old: 'Cette application nécessite une version plus récente du noyau mvmOS.' },
  ja: { title: 'Hattrick Calculator', tagline: 'Hattrick のスカッド、最適な布陣、トレーニング、スタジアム計画。', old: 'このアプリには新しいバージョンのmvmOSコアが必要です。' },
  'pt-BR': { title: 'Hattrick Calculator', tagline: 'Elenco, melhor escalação, treino e estádio para o Hattrick.', old: 'Este aplicativo precisa de uma versão mais recente do núcleo do mvmOS.' },
  ru: { title: 'Hattrick Calculator', tagline: 'Состав, лучшая расстановка, тренировки и стадион для Hattrick.', old: 'Для этого приложения требуется более новая версия ядра mvmOS.' },
  'zh-CN': { title: 'Hattrick Calculator', tagline: 'Hattrick 的阵容、最佳首发、训练与球场规划。', old: '此应用需要更新版本的 mvmOS 核心。' },
};
function _htct(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_htcBoot[lang] || _htcBoot.en)[key] || key;
}
mvmOS.registerApp({
  id: 'hattrickcalculator', name: _htct('title'), icon: '⚽', category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_htct('title'), _htct('old'));
      return;
    }
    window.GameLauncher.open({ id: 'hattrickcalculator', name: _htct('title'), icon: '⚽', tagline: () => _htct('tagline') });
  },
});
