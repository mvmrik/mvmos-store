// Telegram Hub — own translations, shipped inside this app's store zip.
// Not in core frontend/i18n/*.js: those files aren't part of the app zip
// (make-zip.sh only packages apps/<id>/ and backend/apps/<id>/), so anything
// added there would never reach another mvmOS instance that installs this
// app from the store. Merges into window._i18n, same as core does, then
// re-applies on every language switch.
(function () {
  var STRINGS = {
    en: {
      tgh_tab_bot:                   '⚙️ Bot',
      tgh_tab_apps:                  '🔲 Apps',
      tgh_config_intro:              'Create a bot with {botfather}, paste its token below, then register the webhook.',
      tgh_bot_token:                 'Bot token',
      tgh_bot_token_set_ph:          '{preview} (set — leave blank to keep)',
      tgh_bot_token_ph:              '123456:ABC-...',
      tgh_bot_username:              'Bot username (without @, shown on the public page)',
      tgh_bot_username_ph:           'my_mvmos_bot',
      tgh_public_base_url:           'Public base URL',
      tgh_public_base_url_ph:        'https://your-domain.com',
      tgh_public_base_url_hint:      'Must be a public HTTPS address (Telegram requires HTTPS for webhooks).',
      tgh_save:                      'Save',
      tgh_register_webhook:          'Register webhook',
      tgh_unregister:                'Unregister',
      tgh_linked_chats:              'Linked Telegram chats:',
      tgh_saving:                    'Saving…',
      tgh_saved:                     'Saved.',
      tgh_save_failed:               'Failed to save.',
      tgh_registering:               'Registering…',
      tgh_webhook_registered:        'Webhook registered.',
      tgh_webhook_register_failed:   'Failed to register webhook.',
      tgh_unregistering:             'Unregistering…',
      tgh_webhook_removed:           'Webhook removed.',
      tgh_webhook_unregister_failed: 'Failed to unregister webhook.',
      tgh_error_loading_apps:        'Error loading apps',
      tgh_no_apps_detected:          'No apps with a telegram.py adapter detected yet.',
      tgh_apps_intro:                'Apps with a {code} adapter are detected automatically. Toggle to show them in the bot\'s menu.',
      tgh_apps_order:                'Order shown in bot menu',
      tgh_sort_alpha:                'Alphabetical',
      tgh_sort_recent:               'Recently used',
      tgh_sort_frequent:             'Most used',
      tgh_admin_only_title:          'Only visible to Telegram accounts linked to an Apps Hub admin profile',
      tgh_admin_only:                'Admin only',
      tgh_admin_only_premium:        'Admin-only visibility for a bot app is a premium feature.',
      tgh_enabled:                   'Enabled',
      tgh_disabled:                  'Disabled',
      tgh_pub_index_intro:           'This app lives inside Telegram, not in the browser. Open the bot, send /start and link your mvmOS account to get started.',
      tgh_pub_open_bot:              'Open bot',
      tgh_pub_not_configured:        'The bot is not configured yet.',
      tgh_pub_link_title:            'Link Telegram to your mvmOS account',
      tgh_pub_checking:              'Checking…',
      tgh_pub_missing_code:          'Missing link code. Open the link from your Telegram bot again.',
      tgh_pub_linked:                'Your Telegram is now linked.',
      tgh_pub_linked_status:         '✓ Linked — you can go back to Telegram',
      tgh_pub_link_failed:           'Could not link this code.',
      tgh_pub_link_invalid:          'The code is invalid or has expired. Ask the bot for a new /start link.',
      tgh_pub_network_error:         'Network error, please try again.',
    },
    bg: {
      tgh_tab_bot:                   '⚙️ Бот',
      tgh_tab_apps:                  '🔲 Приложения',
      tgh_config_intro:              'Създай бот с {botfather}, постави токена му по-долу, после регистрирай webhook.',
      tgh_bot_token:                 'Токен на бота',
      tgh_bot_token_set_ph:          '{preview} (зададен — остави празно, за да го запазиш)',
      tgh_bot_token_ph:              '123456:ABC-...',
      tgh_bot_username:              'Потребителско име на бота (без @, показва се на публичната страница)',
      tgh_bot_username_ph:           'my_mvmos_bot',
      tgh_public_base_url:           'Публичен базов URL',
      tgh_public_base_url_ph:        'https://your-domain.com',
      tgh_public_base_url_hint:      'Трябва да е публичен HTTPS адрес (Telegram изисква HTTPS за webhook-ове).',
      tgh_save:                      'Запази',
      tgh_register_webhook:          'Регистрирай webhook',
      tgh_unregister:                'Премахни регистрацията',
      tgh_linked_chats:              'Свързани Telegram чатове:',
      tgh_saving:                    'Запазване…',
      tgh_saved:                     'Запазено.',
      tgh_save_failed:               'Неуспешно запазване.',
      tgh_registering:               'Регистриране…',
      tgh_webhook_registered:        'Webhook регистриран.',
      tgh_webhook_register_failed:   'Неуспешна регистрация на webhook.',
      tgh_unregistering:             'Премахване на регистрацията…',
      tgh_webhook_removed:           'Webhook премахнат.',
      tgh_webhook_unregister_failed: 'Неуспешно премахване на webhook.',
      tgh_error_loading_apps:        'Грешка при зареждане на приложенията',
      tgh_no_apps_detected:          'Все още няма открити приложения с telegram.py адаптер.',
      tgh_apps_intro:                'Приложенията с {code} адаптер се откриват автоматично. Превключи, за да ги покажеш в менюто на бота.',
      tgh_apps_order:                'Ред на показване в менюто на бота',
      tgh_sort_alpha:                'По азбучен ред',
      tgh_sort_recent:               'Скоро използвани',
      tgh_sort_frequent:             'Най-използвани',
      tgh_admin_only_title:          'Видимо само за Telegram акаунти, свързани с администраторски профил в Apps Hub',
      tgh_admin_only:                'Само админ',
      tgh_admin_only_premium:        'Видимост само за админ на бот приложение е премиум функция.',
      tgh_enabled:                   'Включено',
      tgh_disabled:                  'Изключено',
      tgh_pub_index_intro:           'Това приложение работи в Telegram, не в браузъра. Отвори бота, изпрати /start и свържи своя mvmOS акаунт, за да започнеш.',
      tgh_pub_open_bot:              'Отвори бота',
      tgh_pub_not_configured:        'Ботът все още не е конфигуриран.',
      tgh_pub_link_title:            'Свържи Telegram с твоя mvmOS акаунт',
      tgh_pub_checking:              'Проверка…',
      tgh_pub_missing_code:          'Липсва код за свързване. Отвори връзката от твоя Telegram бот отново.',
      tgh_pub_linked:                'Твоят Telegram вече е свързан.',
      tgh_pub_linked_status:         '✓ Свързан — можеш да се върнеш в Telegram',
      tgh_pub_link_failed:           'Кодът не можа да бъде свързан.',
      tgh_pub_link_invalid:          'Кодът е невалиден или е изтекъл. Поискай нова /start връзка от бота.',
      tgh_pub_network_error:         'Мрежова грешка, моля опитай отново.',
    },
  };

  function apply(lang) {
    var table = STRINGS[lang] || STRINGS.en;
    window._i18n = window._i18n || {};
    for (var k in table) window._i18n[k] = table[k];
  }

  var lang = (window.mvmOS && window.mvmOS.lang) || 'en';
  apply(lang);
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
  window.TELEGRAMHUB_I18N = true;
})();
