(function () {
  if (window.RSSFEED_I18N) return;
  window.RSSFEED_I18N = true;

  var STRINGS = {
    en: {
      rss_pub_loading:            'Loading…',
      rss_pub_feeds:               'Feeds',
      rss_pub_all_feeds:           'All feeds',
      rss_pub_filter_unread:      'Unread',
      rss_pub_filter_read:         'Read',
      rss_pub_filter_all:          'All',
      rss_pub_filter_saved:        'Saved',
      rss_pub_mark_all_read:      '✓ Mark all read',
      rss_pub_no_articles:         'No articles',
      rss_pub_back:                '← Back',
      rss_pub_open_original:      'Open original ↗',
      rss_pub_sign_in_tagline:    'Sign in with your Apps Hub account to manage your personal feeds.',
      rss_pub_sign_in_button:     'Sign in with Apps Hub',
      rss_pub_your_feeds:          'Your feeds',
      rss_pub_unread_count:        '{count} unread',
      rss_pub_remove:              'Remove',
      rss_pub_no_feeds_yet:        'No feeds yet.',
      rss_pub_add_feed:            'Add feed',
      rss_pub_add_feed_url_ph:    'RSS / Atom URL',
      rss_pub_add:                 'Add',
      rss_pub_error:               'Error',
      rss_pub_just_now:            'just now',
      rss_pub_minutes_ago:         '{n}m ago',
      rss_pub_hours_ago:           '{n}h ago',
      rss_pub_days_ago:            '{n}d ago',
    },
    bg: {
      rss_pub_loading:            'Зареждане…',
      rss_pub_feeds:               'Емисии',
      rss_pub_all_feeds:           'Всички емисии',
      rss_pub_filter_unread:      'Непрочетени',
      rss_pub_filter_read:         'Прочетени',
      rss_pub_filter_all:          'Всички',
      rss_pub_filter_saved:        'Запазени',
      rss_pub_mark_all_read:      '✓ Маркирай всички като прочетени',
      rss_pub_no_articles:         'Няма статии',
      rss_pub_back:                '← Назад',
      rss_pub_open_original:      'Отвори оригинала ↗',
      rss_pub_sign_in_tagline:    'Влез с акаунта си в Apps Hub, за да управляваш личните си емисии.',
      rss_pub_sign_in_button:     'Вход с Apps Hub',
      rss_pub_your_feeds:          'Твоите емисии',
      rss_pub_unread_count:        '{count} непрочетени',
      rss_pub_remove:              'Премахни',
      rss_pub_no_feeds_yet:        'Все още няма емисии.',
      rss_pub_add_feed:            'Добави емисия',
      rss_pub_add_feed_url_ph:    'RSS / Atom URL',
      rss_pub_add:                 'Добави',
      rss_pub_error:               'Грешка',
      rss_pub_just_now:            'току-що',
      rss_pub_minutes_ago:         'преди {n}мин',
      rss_pub_hours_ago:           'преди {n}ч',
      rss_pub_days_ago:            'преди {n}д',
    },
  };

  function apply(lang) {
    var table = STRINGS[lang] || STRINGS.en;
    window._i18n = Object.assign({}, window._i18n, table);
  }

  apply((window.mvmOS && window.mvmOS.lang) || 'en');
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
})();
