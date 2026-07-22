// Tasks — own translations, shipped inside this app's store zip.
// Not in core frontend/i18n/*.js: those files aren't part of the app zip
// (make-zip.sh only packages apps/<id>/ and backend/apps/<id>/), so anything
// added there would never reach another mvmOS instance that installs this
// app from the store. Merges into window._i18n, same as core does, then
// re-applies on every language switch.
(function () {
  var STRINGS = {
    en: {
      tk_title:                    'Tasks',
      tk_tab_tasks:                 'Tasks',
      tk_tab_history:               'History',
      tk_tab_settings:              'Settings',

      tk_new_task:                  'New task',
      tk_edit_task:                 'Edit task',
      tk_no_tasks:                  'No tasks yet',
      tk_task_title_ph:             'Task title',
      tk_description_ph:            'Description (optional)',

      tk_type:                      'Type',
      tk_type_persistent:           'Persistent',
      tk_type_onetime:              'One-time',
      tk_type_periodic:             'Periodic',

      tk_reward_mode:               'Completion mode',
      tk_reward_mode_fixed:         'One-shot',
      tk_reward_mode_hourly:        'Timed (hourly rate)',

      tk_period:                    'Recurrence',
      tk_period_daily:              'Daily',
      tk_period_weekly:             'Weekly',
      tk_period_monthly:            'Monthly',

      tk_due_at:                    'Due date & time',
      tk_amount:                    'Amount',
      tk_amount_hint:                'Positive = reward, negative = penalty',
      tk_amount_hourly_hint:         'Rate per hour — positive = reward, negative = penalty',
      tk_category:                  'Budget category',
      tk_category_none:             'No category (no reward)',
      tk_reward_optional_hint:       'Optional — leave empty for no Budget reward',
      tk_no_categories:              'No Budget categories available',
      tk_budget_unavailable:         'Budget integration is unavailable',

      tk_save:                      'Save',
      tk_saving:                    'Saving…',
      tk_cancel:                    'Cancel',
      tk_close:                     'Close',
      tk_delete:                    'Delete',
      tk_edit:                      'Edit',
      tk_add:                       'Add task',
      tk_confirm_delete:             'Delete task "{title}"?',

      tk_complete:                  'Complete',
      tk_completed:                 'Completed',
      tk_overdue:                   'Overdue',
      tk_done_this_period:           'Done',
      tk_not_done_this_period:       'Not done yet',
      tk_due:                       'Due',

      tk_start_timer:               'Start',
      tk_stop_timer:                'Stop',
      tk_pause_timer:               'Pause',
      tk_resume_timer:              'Continue',
      tk_timer_running:             'Running…',
      tk_timer_paused:              'Paused',
      tk_elapsed:                   'Elapsed',

      tk_reward_applied:             'Reward applied to Budget',
      tk_penalty_applied:            'Penalty applied to Budget',
      tk_reward_applied_amount:      'Reward of {amount} applied to Budget',
      tk_penalty_applied_amount:     'Penalty of {amount} applied to Budget',
      tk_reward_failed:              'Task completed, but the Budget reward could not be applied',

      tk_settings:                  'Settings',
      tk_budget_integration:         'Budget integration',
      tk_budget_integration_hint:    'Let tasks add rewards or penalties to your Budget categories on completion.',

      tk_history:                   'History',
      tk_no_history:                 'No completions yet',

      tk_error:                     'Error',
      tk_error_loading:              'Failed to load',
      tk_login_required:             'Please log in to Apps Hub',
    },
    bg: {
      tk_title:                    'Задачи',
      tk_tab_tasks:                 'Задачи',
      tk_tab_history:               'История',
      tk_tab_settings:              'Настройки',

      tk_new_task:                  'Нова задача',
      tk_edit_task:                 'Редактиране на задача',
      tk_no_tasks:                  'Няма добавени задачи',
      tk_task_title_ph:             'Заглавие на задачата',
      tk_description_ph:            'Описание (незадължително)',

      tk_type:                      'Вид',
      tk_type_persistent:           'Постоянна',
      tk_type_onetime:              'Еднократна',
      tk_type_periodic:             'Периодична',

      tk_reward_mode:               'Начин на изпълнение',
      tk_reward_mode_fixed:         'Еднократно изпълнение',
      tk_reward_mode_hourly:        'За време (на час)',

      tk_period:                    'Период',
      tk_period_daily:              'Дневна',
      tk_period_weekly:             'Седмична',
      tk_period_monthly:            'Месечна',

      tk_due_at:                    'Дата и час',
      tk_amount:                    'Сума',
      tk_amount_hint:                'Положителна = награда, отрицателна = наказание',
      tk_amount_hourly_hint:         'Ставка на час — положителна = награда, отрицателна = наказание',
      tk_category:                  'Категория в бюджета',
      tk_category_none:             'Без категория (без награда)',
      tk_reward_optional_hint:       'По желание — остави празно за без награда в Бюджета',
      tk_no_categories:              'Няма налични категории в Бюджета',
      tk_budget_unavailable:         'Интеграцията с Бюджет не е налична',

      tk_save:                      'Запази',
      tk_saving:                    'Запазване…',
      tk_cancel:                    'Отказ',
      tk_close:                     'Затвори',
      tk_delete:                    'Изтрий',
      tk_edit:                      'Редактирай',
      tk_add:                       'Добави задача',
      tk_confirm_delete:             'Да се изтрие ли задача "{title}"?',

      tk_complete:                  'Изпълни',
      tk_completed:                 'Изпълнена',
      tk_overdue:                   'Просрочена',
      tk_done_this_period:           'Изпълнена',
      tk_not_done_this_period:       'Все още не е изпълнена',
      tk_due:                       'Краен срок',

      tk_start_timer:               'Старт',
      tk_stop_timer:                'Стоп',
      tk_pause_timer:               'Пауза',
      tk_resume_timer:              'Продължи',
      tk_timer_running:             'Работи…',
      tk_timer_paused:              'На пауза',
      tk_elapsed:                   'Изминало време',

      tk_reward_applied:             'Наградата е добавена в Бюджета',
      tk_penalty_applied:            'Наказанието е добавено в Бюджета',
      tk_reward_applied_amount:      'Награда от {amount} е добавена в Бюджета',
      tk_penalty_applied_amount:     'Наказание от {amount} е добавено в Бюджета',
      tk_reward_failed:              'Задачата е изпълнена, но наградата не можа да бъде добавена в Бюджета',

      tk_settings:                  'Настройки',
      tk_budget_integration:         'Интеграция с Бюджет',
      tk_budget_integration_hint:    'Позволи на задачите да добавят награди или наказания към категориите ти в Бюджета при изпълнение.',

      tk_history:                   'История',
      tk_no_history:                 'Няма изпълнени задачи',

      tk_error:                     'Грешка',
      tk_error_loading:              'Неуспешно зареждане',
      tk_login_required:             'Моля, влез в Apps Hub',
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
  window.TASKS_I18N = true;
})();
