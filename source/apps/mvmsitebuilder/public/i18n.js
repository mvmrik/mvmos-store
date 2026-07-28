// mvmSiteBuilder — own translations, shipped inside this app's store zip.
// Not in core frontend/i18n/*.js: those files aren't part of the app zip
// (make-zip.sh only packages apps/<id>/ and backend/apps/<id>/), so anything
// added there would never reach another mvmOS instance that installs this
// app from the store. Merges into window._i18n, same as core does, then
// re-applies on every language switch.
(function () {
  var STRINGS = {
    en: {
      msb_title:               'mvmSiteBuilder',
      msb_error:                'Error',
      msb_loading:               'Loading…',
      msb_saved:                 'Saved',
      msb_save:                  'Save',
      msb_cancel:                'Cancel',
      msb_delete:                'Delete',
      msb_edit:                  'Edit',
      msb_back:                  'Back',
      msb_add:                   'Add',
      msb_untitled:              'Untitled',
      msb_no_results:            'No results',
      msb_read_only:             'Read-only — you have view access only',

      msb_no_sites:              'You have no sites yet',
      msb_new_site:              'New site',
      msb_new_site_prompt:       'Site name:',
      msb_site_name_ph:          'My site',
      msb_view_site:             'View site',
      msb_confirm_delete_site:   'Delete site "{name}"? This cannot be undone.',
      msb_delete_site:           'Delete site',

      msb_tab_pages:             'Pages',
      msb_tab_menu:              'Menu',
      msb_tab_design:            'Design',
      msb_tab_settings:          'Settings',

      msb_new_page:              'New page',
      msb_no_pages:              'No pages yet',
      msb_page_title_ph:         'Page title',
      msb_page_slug_ph:          'page-slug',
      msb_status_draft:          'Draft',
      msb_status_published:      'Published',
      msb_publish:               'Publish',
      msb_unpublish:             'Unpublish',
      msb_set_homepage:          'Set as homepage',
      msb_confirm_delete_page:   'Delete page "{title}"?',
      msb_no_blocks:             'No blocks yet — add one above',

      msb_block_text:            'Text',
      msb_block_text_ph:         'Write some text…',
      msb_block_html:            'HTML',
      msb_block_html_ph:         '<p>Custom HTML, CSS or JS…</p>',
      msb_block_html_hint:       'Raw HTML — rendered as-is, including any <script> tags.',
      msb_block_image:           'Image',
      msb_block_image_empty:     'No image uploaded yet',
      msb_block_image_alt:       'Alt text',
      msb_block_image_caption:   'Caption (optional)',
      msb_block_spacer:          'Spacer',

      msb_new_menu_item:         'New menu item',
      msb_no_menu_items:         'No menu items yet',
      msb_menu_label_ph:         'Label',
      msb_menu_target_page:      'Page',
      msb_menu_target_url:       'External URL',

      msb_theme:                 'Theme',
      msb_custom_css:            'Custom CSS',
      msb_custom_js:             'Custom JS',
      msb_design_sub_theme:      'Theme',
      msb_design_sub_css:        'CSS',
      msb_design_sub_js:         'JS',
      msb_css_error:             'CSS error: {msg}',
      msb_js_error:              'JS error: {msg}',

      msb_upload_theme:          'Upload a theme',
      msb_theme_id_ph:           'theme-id (a-z, 0-9, -)',
      msb_upload:                'Upload',
      msb_theme_upload_hint:     'A .zip containing theme.json, style.css and templates/page.html. See the themes README for the rules.',
      msb_theme_id_invalid:      'Theme id must be lowercase letters, digits and hyphens only.',
      msb_theme_zip_required:    'Choose a .zip file first.',
      msb_theme_uploaded:        'Theme uploaded.',

      msb_site_name:             'Site name',
      msb_site_slug:             'Site slug',
      msb_members:                'Members',
      msb_role_owner:             'Owner',
      msb_role_editor:            'Editor',
      msb_role_viewer:            'Viewer',
      msb_search_user_ph:         'Search by username…',
    },
    bg: {
      msb_title:                'mvmSiteBuilder',
      msb_error:                 'Грешка',
      msb_loading:                'Зареждане…',
      msb_saved:                  'Записано',
      msb_save:                   'Запази',
      msb_cancel:                 'Отказ',
      msb_delete:                 'Изтрий',
      msb_edit:                   'Редактирай',
      msb_back:                   'Назад',
      msb_add:                    'Добави',
      msb_untitled:                'Без заглавие',
      msb_no_results:              'Няма резултати',
      msb_read_only:               'Само за преглед — имаш достъп само за четене',

      msb_no_sites:                'Все още нямаш сайтове',
      msb_new_site:                'Нов сайт',
      msb_new_site_prompt:         'Име на сайта:',
      msb_site_name_ph:            'Моят сайт',
      msb_view_site:               'Виж сайта',
      msb_confirm_delete_site:     'Да се изтрие ли сайтът "{name}"? Действието е необратимо.',
      msb_delete_site:             'Изтрий сайта',

      msb_tab_pages:                'Страници',
      msb_tab_menu:                 'Меню',
      msb_tab_design:               'Дизайн',
      msb_tab_settings:             'Настройки',

      msb_new_page:                 'Нова страница',
      msb_no_pages:                 'Все още няма страници',
      msb_page_title_ph:            'Заглавие на страницата',
      msb_page_slug_ph:             'page-slug',
      msb_status_draft:             'Чернова',
      msb_status_published:         'Публикувана',
      msb_publish:                  'Публикувай',
      msb_unpublish:                'Скрий',
      msb_set_homepage:             'Направи начална страница',
      msb_confirm_delete_page:      'Да се изтрие ли страницата "{title}"?',
      msb_no_blocks:                'Все още няма блокове — добави от бутоните горе',

      msb_block_text:               'Текст',
      msb_block_text_ph:            'Напиши текст…',
      msb_block_html:               'HTML',
      msb_block_html_ph:            '<p>Собствен HTML, CSS или JS…</p>',
      msb_block_html_hint:          'Суров HTML — извежда се както е, включително всякакви <script> тагове.',
      msb_block_image:              'Изображение',
      msb_block_image_empty:        'Все още няма качено изображение',
      msb_block_image_alt:          'Алтернативен текст',
      msb_block_image_caption:      'Надпис (по избор)',
      msb_block_spacer:             'Разделител',

      msb_new_menu_item:            'Нов елемент от менюто',
      msb_no_menu_items:            'Все още няма елементи в менюто',
      msb_menu_label_ph:            'Етикет',
      msb_menu_target_page:         'Страница',
      msb_menu_target_url:          'Външен URL',

      msb_theme:                    'Тема',
      msb_custom_css:               'Собствен CSS',
      msb_custom_js:                'Собствен JS',
      msb_design_sub_theme:        'Тема',
      msb_design_sub_css:          'CSS',
      msb_design_sub_js:          'JS',
      msb_css_error:               'CSS грешка: {msg}',
      msb_js_error:                'JS грешка: {msg}',

      msb_upload_theme:             'Качване на тема',
      msb_theme_id_ph:              'theme-id (a-z, 0-9, -)',
      msb_upload:                   'Качи',
      msb_theme_upload_hint:        '.zip съдържащ theme.json, style.css и templates/page.html. Виж README-то на темите за правилата.',
      msb_theme_id_invalid:         'Theme id трябва да съдържа само малки латински букви, цифри и тирета.',
      msb_theme_zip_required:       'Първо избери .zip файл.',
      msb_theme_uploaded:           'Темата е качена.',

      msb_site_name:                'Име на сайта',
      msb_site_slug:                'Slug на сайта',
      msb_members:                  'Участници',
      msb_role_owner:               'Собственик',
      msb_role_editor:              'Редактор',
      msb_role_viewer:              'Преглед',
      msb_search_user_ph:           'Търси по потребителско име…',
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
  window.MSB_I18N = true;
})();
