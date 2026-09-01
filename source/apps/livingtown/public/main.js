const _ltBoot = { en: { title: 'Living Town' }, bg: { title: 'Living Town' } };
function _ltt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_ltBoot[lang] || _ltBoot.en)[key] || key;
}

mvmOS.registerApp({
  id: 'livingtown',
  name: _ltt('title'),
  icon: '🏘️',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_ltt('title'), 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({
      id: 'livingtown', name: _ltt('title'), icon: '🏘️',
      tagline: () => t('lt_tagline'),
    });
  },
});
