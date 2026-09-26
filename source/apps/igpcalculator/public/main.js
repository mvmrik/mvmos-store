const _igpBoot = {
  en: { title: 'IGP Calculator', tagline: 'Car setup and tyre strategy for every iGP Manager race.', old: 'This app needs a newer mvmOS core.' },
  bg: { title: 'IGP Calculator', tagline: 'Настройка на колата и стратегия за гумите за всяко състезание в iGP Manager.', old: 'Това приложение изисква по-нова версия на mvmOS.' },
  de: { title: 'IGP Calculator', tagline: 'Fahrzeug-Setup und Reifenstrategie für jedes iGP-Manager-Rennen.', old: 'Diese App benötigt eine neuere mvmOS-Kernversion.' },
  es: { title: 'IGP Calculator', tagline: 'Reglaje del coche y estrategia de neumáticos para cada carrera de iGP Manager.', old: 'Esta aplicación necesita una versión más reciente del núcleo de mvmOS.' },
  fr: { title: 'IGP Calculator', tagline: 'Réglages de la voiture et stratégie pneus pour chaque course iGP Manager.', old: 'Cette application nécessite une version plus récente du noyau mvmOS.' },
  ja: { title: 'IGP Calculator', tagline: 'iGP Manager の各レースのマシンセッティングとタイヤ戦略。', old: 'このアプリには新しいバージョンのmvmOSコアが必要です。' },
  'pt-BR': { title: 'IGP Calculator', tagline: 'Acerto do carro e estratégia de pneus para cada corrida do iGP Manager.', old: 'Este aplicativo precisa de uma versão mais recente do núcleo do mvmOS.' },
  ru: { title: 'IGP Calculator', tagline: 'Настройка машины и стратегия шин для каждой гонки в iGP Manager.', old: 'Для этого приложения требуется более новая версия ядра mvmOS.' },
  'zh-CN': { title: 'IGP Calculator', tagline: '为每场 iGP Manager 比赛设定赛车调校和轮胎策略。', old: '此应用需要更新版本的 mvmOS 核心。' },
};
function _igpt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_igpBoot[lang] || _igpBoot.en)[key] || key;
}
mvmOS.registerApp({
  id: 'igpcalculator', name: _igpt('title'), icon: '🏎️', category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_igpt('title'), _igpt('old'));
      return;
    }
    window.GameLauncher.open({ id: 'igpcalculator', name: _igpt('title'), icon: '🏎️', tagline: () => _igpt('tagline') });
  },
});
