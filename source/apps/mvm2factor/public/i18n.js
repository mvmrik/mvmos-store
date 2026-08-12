// mvm2factor translations, shipped with the app.
(function () {
  var STRINGS = {
    en: {
      m2f_title: 'mvm2factor',
      m2f_accounts: 'Accounts',
      m2f_add_account: 'Add account',
      m2f_account_name: 'Account name (e.g. GitHub)',
      m2f_issuer: 'Username / email (optional)',
      m2f_website: 'Website (optional, e.g. github.com)',
      m2f_secret: 'Secret key (Base32)',
      m2f_save: 'Save',
      m2f_cancel: 'Cancel',
      m2f_copied: '✓ Copied',
      m2f_copy: 'Copy',
      m2f_delete: 'Delete',
      m2f_no_accounts: 'No accounts yet. Add your first one.',
      m2f_invalid_secret: 'Invalid secret key. Use Base32 characters (A–Z, 2–7).',
      m2f_invalid_website: 'Enter a valid website URL or domain.',
      m2f_name_required: 'Account name is required.',
      m2f_secret_required: 'Secret key is required.',
      m2f_seconds: 's',
      m2f_error_loading: 'Failed to load your accounts.',
      m2f_error_saving: 'Failed to save the account.',
      m2f_sort_newest: 'Newest first',
      m2f_sort_used: 'Last used first',
      m2f_login_required: 'Please log in to Apps Hub',
      m2f_delete_confirm: 'Delete "{name}"?',
      m2f_fill: 'Fill',
      m2f_matching_site: 'Showing accounts matching {host}',
      m2f_current_site: 'Current website: {host}',
      m2f_no_matching_accounts: 'No accounts match {host}. Add one with this website or change the extension setting to show all.',
      m2f_no_current_website: 'This tab has no website to match. Change the extension setting to show all accounts.',
    },
    bg: {
      m2f_title: 'mvm2factor',
      m2f_accounts: 'Акаунти',
      m2f_add_account: 'Добави акаунт',
      m2f_account_name: 'Название (напр. GitHub)',
      m2f_issuer: 'Потребител / имейл (незадължително)',
      m2f_website: 'Сайт (незадължително, напр. github.com)',
      m2f_secret: 'Таен ключ (Base32)',
      m2f_save: 'Запази',
      m2f_cancel: 'Отказ',
      m2f_copied: '✓ Копирано',
      m2f_copy: 'Копирай',
      m2f_delete: 'Изтрий',
      m2f_no_accounts: 'Няма акаунти. Добави първия.',
      m2f_invalid_secret: 'Невалиден таен ключ. Използвай Base32 знаци (A–Z, 2–7).',
      m2f_invalid_website: 'Въведи валиден URL адрес или домейн.',
      m2f_name_required: 'Името е задължително.',
      m2f_secret_required: 'Тайният ключ е задължителен.',
      m2f_seconds: 'с',
      m2f_error_loading: 'Неуспешно зареждане на акаунтите.',
      m2f_error_saving: 'Грешка при записване на акаунта.',
      m2f_sort_newest: 'Най-нови първо',
      m2f_sort_used: 'Последно използвани първо',
      m2f_login_required: 'Моля, влез в Apps Hub',
      m2f_delete_confirm: 'Да се изтрие ли „{name}“?',
      m2f_fill: 'Попълни',
      m2f_matching_site: 'Показват се акаунтите за {host}',
      m2f_current_site: 'Текущ сайт: {host}',
      m2f_no_matching_accounts: 'Няма акаунти за {host}. Добави сайт към код или промени настройката на разширението да показва всички.',
      m2f_no_current_website: 'Този раздел няма сайт за съпоставяне. Промени настройката на разширението да показва всички акаунти.',
    },
  };

  function apply(lang) {
    var table = STRINGS[lang] || STRINGS.en;
    window._i18n = window._i18n || {};
    for (var key in table) window._i18n[key] = table[key];
  }

  STRINGS.en.m2f_transfer = 'Import and export';
  STRINGS.en.m2f_export_backup = 'Export mvm2factor backup';
  STRINGS.en.m2f_export_csv = 'Export CSV for another authenticator';
  STRINGS.en.m2f_import = 'Import accounts';
  STRINGS.en.m2f_backup_warning = 'This backup is unencrypted and contains your two-factor secrets. Keep it private and delete it after importing. Continue?';
  STRINGS.en.m2f_csv_warning = 'This CSV is unencrypted and contains your two-factor secrets. Continue?';
  STRINGS.en.m2f_import_invalid = 'This file does not contain readable two-factor accounts.';
  STRINGS.en.m2f_import_warning = 'Import {n} accounts? Existing accounts will not be removed.';
  STRINGS.en.m2f_import_done = 'Imported {n} accounts.';
  STRINGS.bg.m2f_transfer = 'Внос и износ';
  STRINGS.bg.m2f_export_backup = 'Изнеси mvm2factor backup';
  STRINGS.bg.m2f_export_csv = 'Изнеси CSV за друг authenticator';
  STRINGS.bg.m2f_import = 'Внеси акаунти';
  STRINGS.bg.m2f_backup_warning = 'Този backup не е криптиран и съдържа двуфакторните ти тайни ключове. Пази го лично и го изтрий след внасянето. Продължи ли?';
  STRINGS.bg.m2f_csv_warning = 'Този CSV не е криптиран и съдържа двуфакторните ти тайни ключове. Продължи ли?';
  STRINGS.bg.m2f_import_invalid = 'Във файла няма разпознаваеми двуфакторни акаунти.';
  STRINGS.bg.m2f_import_warning = 'Да се внесат ли {n} акаунта? Съществуващите няма да бъдат изтрити.';
  STRINGS.bg.m2f_import_done = 'Внесени са {n} акаунта.';
  var lang = (window.mvmOS && window.mvmOS.lang) || 'en';
  apply(lang);
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
  window.MVM2FACTOR_I18N = true;
})();
