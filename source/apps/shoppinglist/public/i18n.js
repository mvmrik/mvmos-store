// Shopping List — own translations, shipped inside this app's store zip.
// Not in core frontend/i18n/*.js: those files aren't part of the app zip
// (make-zip.sh only packages apps/<id>/ and backend/apps/<id>/), so anything
// added there would never reach another mvmOS instance that installs this
// app from the store. Merges into window._i18n, same as core does, then
// re-applies on every language switch.
(function () {
  var STRINGS = {
    en: {
      sl_title:                    'Shopping List',

      sl_settings:                 'Settings',
      sl_budget_integration:       'Budget integration',
      sl_budget_integration_hint:  'When enabled, products can be linked to a Budget category and marking one bought deducts its price from that category.',

      sl_add_list:                 'New list',
      sl_new_list:                 'New list',
      sl_edit_list:                'Edit list',
      sl_list_title_ph:            'List title',
      sl_no_lists:                 'No shopping lists yet',
      sl_items_progress:           '{bought}/{total} bought',

      sl_add_item:                 'Add product',
      sl_new_item:                 'New product',
      sl_edit_item:                'Edit product',
      sl_no_items:                 'No products yet',
      sl_name_ph:                  'Product name',
      sl_quantity:                 'Quantity',
      sl_price:                    'Price',
      sl_category:                 'Budget category',
      sl_category_none:            'No category',
      sl_name_required:            'Name required',
      sl_total:                    'Total',
      sl_total_bought:             'Bought',
      sl_total_remaining:          'Remaining',

      sl_budget_applied:           'Deducted from Budget',
      sl_budget_reverted:          'Reverted in Budget',
      sl_budget_failed:            'Bought, but the Budget withdrawal could not be applied',

      sl_warranty:                 'Warranty',
      sl_warranties:               'Warranties',
      sl_warranty_start_date:      'Start date',
      sl_warranty_end_date:        'End date',
      sl_warranty_date_invalid:    'End date must be after start date',
      sl_warranty_set:             'Set warranty',
      sl_warranty_remove:          'Remove warranty',
      sl_warranty_confirm_remove:  'Remove the warranty for "{name}"? Photos will also be deleted.',
      sl_warranty_photos:          'Photos',
      sl_warranty_no_photos:       'No photos yet',
      sl_warranty_started:         'Started: {date}',
      sl_warranty_expires:         'Expires: {date}',
      sl_warranty_expired:         'Expired',
      sl_warranty_days_left:       '{days} days left',
      sl_warranty_years_months_left: '{years}y {months}m left',
      sl_warranty_months_left:     '{months}m left',
      sl_no_warranties:            'No warranties yet',
      sl_warranty_upload_failed:   'Upload failed',
      sl_photo_delete_confirm:     'Delete this photo?',

      sl_history:                  'History',
      sl_no_history:                'No history yet',
      sl_history_confirm_delete:    'Permanently delete "{name}"? This cannot be undone.',

      sl_share:                    'Share',
      sl_share_title:              'Share',
      sl_current_members:          'Current members',
      sl_add_from_favourites:      'Add from favourites',
      sl_no_favourites:            'No favourites available',
      sl_owner:                    'Owner',
      sl_confirm_remove_member:    'Remove this member from the list?',

      sl_save:                     'Save',
      sl_cancel:                   'Cancel',
      sl_close:                    'Close',
      sl_delete:                   'Delete',
      sl_edit:                     'Edit',
      sl_title_required:           'Title required',
      sl_save_failed:              'Failed to save',
      sl_error:                    'Error',
      sl_confirm_delete_list:      'Delete list "{title}"? Its items will be kept in History.',
      sl_confirm_delete_item:      'Delete "{name}"?',
      sl_login_required:           'Please log in to Apps Hub',
    },
    bg: {
      sl_title:                    'Списък за пазаруване',

      sl_settings:                 'Настройки',
      sl_budget_integration:       'Интеграция с Бюджета',
      sl_budget_integration_hint:  'Когато е включено, продуктите могат да се свързват с категория в Бюджета, а отбелязването им като купени приспада цената от нея.',

      sl_add_list:                 'Нов списък',
      sl_new_list:                 'Нов списък',
      sl_edit_list:                'Редактиране на списък',
      sl_list_title_ph:            'Заглавие на списъка',
      sl_no_lists:                 'Няма добавени списъци',
      sl_items_progress:           '{bought}/{total} купени',

      sl_add_item:                 'Добави продукт',
      sl_new_item:                 'Нов продукт',
      sl_edit_item:                'Редактиране на продукт',
      sl_no_items:                 'Няма добавени продукти',
      sl_name_ph:                  'Име на продукта',
      sl_quantity:                 'Количество',
      sl_price:                    'Цена',
      sl_category:                 'Категория в бюджета',
      sl_category_none:            'Без категория',
      sl_name_required:            'Името е задължително',
      sl_total:                    'Общо',
      sl_total_bought:             'Купени',
      sl_total_remaining:          'Оставащи',

      sl_budget_applied:           'Приспаднато от Бюджета',
      sl_budget_reverted:          'Върнато обратно в Бюджета',
      sl_budget_failed:            'Купено, но приспадането от Бюджета не можа да бъде направено',

      sl_warranty:                 'Гаранция',
      sl_warranties:               'Гаранции',
      sl_warranty_start_date:      'Начална дата',
      sl_warranty_end_date:        'Крайна дата',
      sl_warranty_date_invalid:    'Крайната дата трябва да е след началната',
      sl_warranty_set:             'Задай гаранция',
      sl_warranty_remove:          'Премахни гаранцията',
      sl_warranty_confirm_remove:  'Да се премахне ли гаранцията на "{name}"? Снимките също ще бъдат изтрити.',
      sl_warranty_photos:          'Снимки',
      sl_warranty_no_photos:       'Няма добавени снимки',
      sl_warranty_started:         'Започва: {date}',
      sl_warranty_expires:         'Изтича: {date}',
      sl_warranty_expired:         'Изтекла',
      sl_warranty_days_left:       'Остават {days} дни',
      sl_warranty_years_months_left: 'Остават {years}г {months}м',
      sl_warranty_months_left:     'Остават {months}м',
      sl_no_warranties:            'Все още няма гаранции',
      sl_warranty_upload_failed:   'Неуспешно качване',
      sl_photo_delete_confirm:     'Да се изтрие ли тази снимка?',

      sl_history:                  'История',
      sl_no_history:                'Все още няма история',
      sl_history_confirm_delete:    'Да се изтрие ли завинаги "{name}"? Това действие не може да бъде отменено.',

      sl_share:                    'Сподели',
      sl_share_title:              'Споделяне',
      sl_current_members:          'Текущи участници',
      sl_add_from_favourites:      'Добави от любими',
      sl_no_favourites:            'Няма налични любими',
      sl_owner:                    'Собственик',
      sl_confirm_remove_member:    'Да се премахне ли този участник от списъка?',

      sl_save:                     'Запази',
      sl_cancel:                   'Отказ',
      sl_close:                    'Затвори',
      sl_delete:                   'Изтрий',
      sl_edit:                     'Редактирай',
      sl_title_required:           'Заглавието е задължително',
      sl_save_failed:              'Неуспешно запазване',
      sl_error:                    'Грешка',
      sl_confirm_delete_list:      'Да се изтрие ли списък "{title}"? Артикулите от него ще останат в История.',
      sl_confirm_delete_item:      'Да се изтрие ли "{name}"?',
      sl_login_required:           'Моля, влез в Apps Hub',
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
  window.SHOPPINGLIST_I18N = true;
})();
