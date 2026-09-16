// mvmOS App: RSS Reader v1.0.0

const _rssi18n = {
  en: {
    title:          'RSS Reader',
    fetch:          '↻ Fetch',
    settings:       '⚙ Settings',
    all_feeds:      'All feeds',
    unread:         'Unread',
    read:           'Read',
    all_filter:     'All',
    add_feed:       '+ Add Feed',
    no_feeds:       'No feeds yet. Add one in Settings.',
    no_articles:    'No articles.',
    back:           '← Back',
    back_list:      '← Back',
    open_original:  'Open original ↗',
    mark_all_read:  'Mark all read',
    del_feed:       'Delete',
    feed_url_ph:    'RSS / Atom URL',
    add:            'Add',
    cancel:         'Cancel',
    settings_title: 'Settings',
    feeds_title:    'Feeds',
    fetch_interval: 'Auto-fetch every',
    public_page:    'Public reading list',
    public_url:     'Public URL',
    copy:           'Copy',
    copied:         'Copied!',
    save:           'Save',
    fetching:       'Fetching…',
    feed_added:     'Feed added.',
    settings_saved: 'Settings saved.',
    min5:  '5 minutes',  min15: '15 minutes', min30: '30 minutes',
    h1:    '1 hour',     h2:    '2 hours',    h6:    '6 hours',
    h12:   '12 hours',   h24:   '24 hours',
    filter_label:   'Show:',
    source_label:   'Source:',
    just_now:       'just now',
    ago_min:        'min ago',
    ago_h:          'h ago',
    ago_d:          'd ago',
    saved:          'Saved',
    error_label:    'Error',
    fetched_label:  'Last fetched',
    public_hint:    'When enabled, anyone with the link can see your unread articles. Reading an article marks it as read.',
    deepl_section:    'DeepL Integration',
    deepl_enable_lbl: 'Enable DeepL translate button',
    deepl_needs_app:  'Requires the free DeepL Translator app — each reader enters their own DeepL API key there.',
    deepl_translate:  'Translate',
    deepl_translating:'Translating…',
    deepl_close:      'Close',
    deepl_key_missing:'Add your DeepL API key in the DeepL Translator app to translate.',
    deepl_error:      'Translation failed. Please try again.',
  },
  bg: {
    title:          'RSS четец',
    fetch:          '↻ Обнови',
    settings:       '⚙ Настройки',
    all_feeds:      'Всички',
    unread:         'Непрочетени',
    read:           'Прочетени',
    all_filter:     'Всички',
    add_feed:       '+ Добави',
    no_feeds:       'Няма добавени източници. Добави в Настройки.',
    no_articles:    'Няма статии.',
    back:           '← Назад',
    back_list:      '← Назад',
    open_original:  'Отвори оригинала ↗',
    mark_all_read:  'Маркирай всички прочетени',
    del_feed:       'Изтрий',
    feed_url_ph:    'RSS / Atom URL',
    add:            'Добави',
    cancel:         'Отказ',
    settings_title: 'Настройки',
    feeds_title:    'Източници',
    fetch_interval: 'Проверявай на всеки',
    public_page:    'Публичен списък за четене',
    public_url:     'Публичен линк',
    copy:           'Копирай',
    copied:         'Копирано!',
    save:           'Запази',
    fetching:       'Зареждане…',
    feed_added:     'Изворът е добавен.',
    settings_saved: 'Настройките са запазени.',
    min5:  '5 минути',  min15: '15 минути', min30: '30 минути',
    h1:    '1 час',     h2:    '2 часа',    h6:    '6 часа',
    h12:   '12 часа',   h24:   '24 часа',
    filter_label:   'Покажи:',
    source_label:   'Извор:',
    just_now:       'сега',
    ago_min:        'мин. назад',
    ago_h:          'ч. назад',
    ago_d:          'д. назад',
    saved:          'Запазени',
    error_label:    'Грешка',
    fetched_label:  'Последно обновен',
    public_hint:    'При активиране всеки с линка вижда непрочетените ти статии. Отварянето на статия я маркира като прочетена.',
    deepl_section:    'DeepL интеграция',
    deepl_enable_lbl: 'Активирай бутон за превод с DeepL',
    deepl_needs_app:  'Изисква безплатното приложение DeepL Translator — всеки читател въвежда там своя собствен DeepL API ключ.',
    deepl_translate:  'Преведи',
    deepl_translating:'Превежда се…',
    deepl_close:      'Затвори',
    deepl_key_missing:'Добавете своя DeepL API ключ в приложението DeepL Translator, за да превеждате.',
    deepl_error:      'Преводът не бе успешен. Опитайте пак.',
  },
  de: {
    title:          'RSS-Reader',
    fetch:          '↻ Abrufen',
    settings:       '⚙ Einstellungen',
    all_feeds:      'Alle Feeds',
    unread:         'Ungelesen',
    read:           'Gelesen',
    all_filter:     'Alle',
    add_feed:       '+ Feed hinzufügen',
    no_feeds:       'Noch keine Feeds. Füge einen in den Einstellungen hinzu.',
    no_articles:    'Keine Artikel.',
    back:           '← Zurück',
    back_list:      '← Zurück',
    open_original:  'Original öffnen ↗',
    mark_all_read:  'Alle als gelesen markieren',
    del_feed:       'Löschen',
    feed_url_ph:    'RSS-/Atom-URL',
    add:            'Hinzufügen',
    cancel:         'Abbrechen',
    settings_title: 'Einstellungen',
    feeds_title:    'Feeds',
    fetch_interval: 'Automatisch abrufen alle',
    public_page:    'Öffentliche Leseliste',
    public_url:     'Öffentliche URL',
    copy:           'Kopieren',
    copied:         'Kopiert!',
    save:           'Speichern',
    fetching:       'Wird abgerufen…',
    feed_added:     'Feed hinzugefügt.',
    settings_saved: 'Einstellungen gespeichert.',
    min5:  '5 Minuten',  min15: '15 Minuten', min30: '30 Minuten',
    h1:    '1 Stunde',   h2:    '2 Stunden',  h6:    '6 Stunden',
    h12:   '12 Stunden', h24:   '24 Stunden',
    filter_label:   'Anzeigen:',
    source_label:   'Quelle:',
    just_now:       'gerade eben',
    ago_min:        'Min. her',
    ago_h:          'Std. her',
    ago_d:          'Tg. her',
    saved:          'Gespeichert',
    error_label:    'Fehler',
    fetched_label:  'Zuletzt abgerufen',
    public_hint:    'Wenn aktiviert, kann jeder mit dem Link deine ungelesenen Artikel sehen. Das Lesen eines Artikels markiert ihn als gelesen.',
    deepl_section:    'DeepL-Integration',
    deepl_enable_lbl: 'DeepL-Übersetzungsschaltfläche aktivieren',
    deepl_needs_app:  'Erfordert die kostenlose App DeepL Translator — jeder Leser gibt dort seinen eigenen DeepL-API-Schlüssel ein.',
    deepl_translate:  'Übersetzen',
    deepl_translating:'Wird übersetzt…',
    deepl_close:      'Schließen',
    deepl_key_missing:'Füge deinen DeepL-API-Schlüssel in der App DeepL Translator hinzu, um zu übersetzen.',
    deepl_error:      'Übersetzung fehlgeschlagen. Bitte erneut versuchen.',
  },
  es: {
    title:          'Lector RSS',
    fetch:          '↻ Actualizar',
    settings:       '⚙ Configuración',
    all_feeds:      'Todos los feeds',
    unread:         'No leídos',
    read:           'Leídos',
    all_filter:     'Todos',
    add_feed:       '+ Añadir feed',
    no_feeds:       'Aún no hay feeds. Añade uno en Configuración.',
    no_articles:    'No hay artículos.',
    back:           '← Atrás',
    back_list:      '← Atrás',
    open_original:  'Abrir original ↗',
    mark_all_read:  'Marcar todo como leído',
    del_feed:       'Eliminar',
    feed_url_ph:    'URL RSS / Atom',
    add:            'Añadir',
    cancel:         'Cancelar',
    settings_title: 'Configuración',
    feeds_title:    'Feeds',
    fetch_interval: 'Actualizar automáticamente cada',
    public_page:    'Lista de lectura pública',
    public_url:     'URL pública',
    copy:           'Copiar',
    copied:         '¡Copiado!',
    save:           'Guardar',
    fetching:       'Actualizando…',
    feed_added:     'Feed añadido.',
    settings_saved: 'Configuración guardada.',
    min5:  '5 minutos', min15: '15 minutos', min30: '30 minutos',
    h1:    '1 hora',    h2:    '2 horas',    h6:    '6 horas',
    h12:   '12 horas',  h24:   '24 horas',
    filter_label:   'Mostrar:',
    source_label:   'Fuente:',
    just_now:       'ahora mismo',
    ago_min:        'min',
    ago_h:          'h',
    ago_d:          'd',
    saved:          'Guardados',
    error_label:    'Error',
    fetched_label:  'Última actualización',
    public_hint:    'Al activarlo, cualquiera con el enlace puede ver tus artículos no leídos. Leer un artículo lo marca como leído.',
    deepl_section:    'Integración con DeepL',
    deepl_enable_lbl: 'Activar botón de traducción DeepL',
    deepl_needs_app:  'Requiere la app gratuita DeepL Translator — cada lector introduce allí su propia clave API de DeepL.',
    deepl_translate:  'Traducir',
    deepl_translating:'Traduciendo…',
    deepl_close:      'Cerrar',
    deepl_key_missing:'Añade tu clave API de DeepL en la app DeepL Translator para traducir.',
    deepl_error:      'La traducción falló. Inténtalo de nuevo.',
  },
  fr: {
    title:          'Lecteur RSS',
    fetch:          '↻ Actualiser',
    settings:       '⚙ Paramètres',
    all_feeds:      'Tous les flux',
    unread:         'Non lus',
    read:           'Lus',
    all_filter:     'Tous',
    add_feed:       '+ Ajouter un flux',
    no_feeds:       'Aucun flux pour le moment. Ajoutez-en un dans les paramètres.',
    no_articles:    'Aucun article.',
    back:           '← Retour',
    back_list:      '← Retour',
    open_original:  "Ouvrir l'original ↗",
    mark_all_read:  'Tout marquer comme lu',
    del_feed:       'Supprimer',
    feed_url_ph:    'URL RSS / Atom',
    add:            'Ajouter',
    cancel:         'Annuler',
    settings_title: 'Paramètres',
    feeds_title:    'Flux',
    fetch_interval: 'Actualiser automatiquement toutes les',
    public_page:    'Liste de lecture publique',
    public_url:     'URL publique',
    copy:           'Copier',
    copied:         'Copié !',
    save:           'Enregistrer',
    fetching:       'Actualisation…',
    feed_added:     'Flux ajouté.',
    settings_saved: 'Paramètres enregistrés.',
    min5:  '5 minutes', min15: '15 minutes', min30: '30 minutes',
    h1:    '1 heure',   h2:    '2 heures',   h6:    '6 heures',
    h12:   '12 heures', h24:   '24 heures',
    filter_label:   'Afficher :',
    source_label:   'Source :',
    just_now:       "à l'instant",
    ago_min:        'min',
    ago_h:          'h',
    ago_d:          'j',
    saved:          'Enregistrés',
    error_label:    'Erreur',
    fetched_label:  'Dernière actualisation',
    public_hint:    "Une fois activé, toute personne disposant du lien peut voir vos articles non lus. Lire un article le marque comme lu.",
    deepl_section:    'Intégration DeepL',
    deepl_enable_lbl: 'Activer le bouton de traduction DeepL',
    deepl_needs_app:  "Nécessite l'application gratuite DeepL Translator — chaque lecteur y saisit sa propre clé API DeepL.",
    deepl_translate:  'Traduire',
    deepl_translating:'Traduction…',
    deepl_close:      'Fermer',
    deepl_key_missing:"Ajoutez votre clé API DeepL dans l'application DeepL Translator pour traduire.",
    deepl_error:      'Échec de la traduction. Réessayez.',
  },
  ja: {
    title:          'RSSリーダー',
    fetch:          '↻ 更新',
    settings:       '⚙ 設定',
    all_feeds:      'すべてのフィード',
    unread:         '未読',
    read:           '既読',
    all_filter:     'すべて',
    add_feed:       '+ フィードを追加',
    no_feeds:       'フィードがまだありません。設定から追加してください。',
    no_articles:    '記事がありません。',
    back:           '← 戻る',
    back_list:      '← 戻る',
    open_original:  '元の記事を開く ↗',
    mark_all_read:  'すべて既読にする',
    del_feed:       '削除',
    feed_url_ph:    'RSS / Atom URL',
    add:            '追加',
    cancel:         'キャンセル',
    settings_title: '設定',
    feeds_title:    'フィード',
    fetch_interval: '自動更新間隔',
    public_page:    '公開の閲覧リスト',
    public_url:     '公開URL',
    copy:           'コピー',
    copied:         'コピーしました!',
    save:           '保存',
    fetching:       '更新中…',
    feed_added:     'フィードを追加しました。',
    settings_saved: '設定を保存しました。',
    min5:  '5分',  min15: '15分', min30: '30分',
    h1:    '1時間', h2:    '2時間', h6:    '6時間',
    h12:   '12時間', h24:  '24時間',
    filter_label:   '表示:',
    source_label:   'ソース:',
    just_now:       'たった今',
    ago_min:        '分前',
    ago_h:          '時間前',
    ago_d:          '日前',
    saved:          '保存済み',
    error_label:    'エラー',
    fetched_label:  '最終更新',
    public_hint:    '有効にすると、リンクを知っている人は誰でも未読記事を閲覧できます。記事を開くと既読になります。',
    deepl_section:    'DeepL連携',
    deepl_enable_lbl: 'DeepL翻訳ボタンを有効にする',
    deepl_needs_app:  '無料のDeepL Translatorアプリが必要です — 各読者はそこで自分のDeepL APIキーを入力します。',
    deepl_translate:  '翻訳',
    deepl_translating:'翻訳中…',
    deepl_close:      '閉じる',
    deepl_key_missing:'翻訳するには、DeepL TranslatorアプリでDeepL APIキーを追加してください。',
    deepl_error:      '翻訳に失敗しました。再試行してください。',
  },
  'pt-BR': {
    title:          'Leitor RSS',
    fetch:          '↻ Atualizar',
    settings:       '⚙ Configurações',
    all_feeds:      'Todos os feeds',
    unread:         'Não lidos',
    read:           'Lidos',
    all_filter:     'Todos',
    add_feed:       '+ Adicionar feed',
    no_feeds:       'Ainda não há feeds. Adicione um nas Configurações.',
    no_articles:    'Nenhum artigo.',
    back:           '← Voltar',
    back_list:      '← Voltar',
    open_original:  'Abrir original ↗',
    mark_all_read:  'Marcar tudo como lido',
    del_feed:       'Excluir',
    feed_url_ph:    'URL RSS / Atom',
    add:            'Adicionar',
    cancel:         'Cancelar',
    settings_title: 'Configurações',
    feeds_title:    'Feeds',
    fetch_interval: 'Atualizar automaticamente a cada',
    public_page:    'Lista de leitura pública',
    public_url:     'URL pública',
    copy:           'Copiar',
    copied:         'Copiado!',
    save:           'Salvar',
    fetching:       'Atualizando…',
    feed_added:     'Feed adicionado.',
    settings_saved: 'Configurações salvas.',
    min5:  '5 minutos', min15: '15 minutos', min30: '30 minutos',
    h1:    '1 hora',    h2:    '2 horas',    h6:    '6 horas',
    h12:   '12 horas',  h24:   '24 horas',
    filter_label:   'Mostrar:',
    source_label:   'Fonte:',
    just_now:       'agora mesmo',
    ago_min:        'min atrás',
    ago_h:          'h atrás',
    ago_d:          'd atrás',
    saved:          'Salvos',
    error_label:    'Erro',
    fetched_label:  'Última atualização',
    public_hint:    'Quando ativado, qualquer pessoa com o link pode ver seus artigos não lidos. Ler um artigo o marca como lido.',
    deepl_section:    'Integração com DeepL',
    deepl_enable_lbl: 'Ativar botão de tradução DeepL',
    deepl_needs_app:  'Requer o app gratuito DeepL Translator — cada leitor insere lá sua própria chave de API do DeepL.',
    deepl_translate:  'Traduzir',
    deepl_translating:'Traduzindo…',
    deepl_close:      'Fechar',
    deepl_key_missing:'Adicione sua chave de API do DeepL no app DeepL Translator para traduzir.',
    deepl_error:      'A tradução falhou. Tente novamente.',
  },
  ru: {
    title:          'RSS-читалка',
    fetch:          '↻ Обновить',
    settings:       '⚙ Настройки',
    all_feeds:      'Все ленты',
    unread:         'Непрочитанные',
    read:           'Прочитанные',
    all_filter:     'Все',
    add_feed:       '+ Добавить ленту',
    no_feeds:       'Лент пока нет. Добавьте в настройках.',
    no_articles:    'Нет статей.',
    back:           '← Назад',
    back_list:      '← Назад',
    open_original:  'Открыть оригинал ↗',
    mark_all_read:  'Отметить всё как прочитанное',
    del_feed:       'Удалить',
    feed_url_ph:    'URL RSS / Atom',
    add:            'Добавить',
    cancel:         'Отмена',
    settings_title: 'Настройки',
    feeds_title:    'Ленты',
    fetch_interval: 'Автообновление каждые',
    public_page:    'Публичный список чтения',
    public_url:     'Публичная ссылка',
    copy:           'Копировать',
    copied:         'Скопировано!',
    save:           'Сохранить',
    fetching:       'Обновление…',
    feed_added:     'Лента добавлена.',
    settings_saved: 'Настройки сохранены.',
    min5:  '5 минут', min15: '15 минут', min30: '30 минут',
    h1:    '1 час',   h2:    '2 часа',   h6:    '6 часов',
    h12:   '12 часов',h24:   '24 часа',
    filter_label:   'Показать:',
    source_label:   'Источник:',
    just_now:       'только что',
    ago_min:        'мин. назад',
    ago_h:          'ч. назад',
    ago_d:          'дн. назад',
    saved:          'Сохранённые',
    error_label:    'Ошибка',
    fetched_label:  'Последнее обновление',
    public_hint:    'При включении любой, у кого есть ссылка, может видеть ваши непрочитанные статьи. Открытие статьи отмечает её как прочитанную.',
    deepl_section:    'Интеграция с DeepL',
    deepl_enable_lbl: 'Включить кнопку перевода DeepL',
    deepl_needs_app:  'Требуется бесплатное приложение DeepL Translator — каждый читатель вводит там свой собственный API-ключ DeepL.',
    deepl_translate:  'Перевести',
    deepl_translating:'Перевод…',
    deepl_close:      'Закрыть',
    deepl_key_missing:'Добавьте свой API-ключ DeepL в приложении DeepL Translator, чтобы переводить.',
    deepl_error:      'Перевод не удался. Попробуйте снова.',
  },
  'zh-CN': {
    title:          'RSS 阅读器',
    fetch:          '↻ 获取',
    settings:       '⚙ 设置',
    all_feeds:      '所有订阅源',
    unread:         '未读',
    read:           '已读',
    all_filter:     '全部',
    add_feed:       '+ 添加订阅源',
    no_feeds:       '还没有订阅源。请在设置中添加。',
    no_articles:    '没有文章。',
    back:           '← 返回',
    back_list:      '← 返回',
    open_original:  '打开原文 ↗',
    mark_all_read:  '全部标记为已读',
    del_feed:       '删除',
    feed_url_ph:    'RSS / Atom 链接',
    add:            '添加',
    cancel:         '取消',
    settings_title: '设置',
    feeds_title:    '订阅源',
    fetch_interval: '自动获取间隔',
    public_page:    '公开阅读列表',
    public_url:     '公开链接',
    copy:           '复制',
    copied:         '已复制!',
    save:           '保存',
    fetching:       '获取中…',
    feed_added:     '已添加订阅源。',
    settings_saved: '设置已保存。',
    min5:  '5分钟', min15: '15分钟', min30: '30分钟',
    h1:    '1小时', h2:    '2小时', h6:    '6小时',
    h12:   '12小时', h24:  '24小时',
    filter_label:   '显示:',
    source_label:   '来源:',
    just_now:       '刚刚',
    ago_min:        '分钟前',
    ago_h:          '小时前',
    ago_d:          '天前',
    saved:          '已收藏',
    error_label:    '错误',
    fetched_label:  '最后获取',
    public_hint:    '启用后,任何拥有该链接的人都可以查看你的未读文章。打开文章会将其标记为已读。',
    deepl_section:    'DeepL 集成',
    deepl_enable_lbl: '启用 DeepL 翻译按钮',
    deepl_needs_app:  '需要免费的 DeepL Translator 应用 — 每位读者在其中输入自己的 DeepL API 密钥。',
    deepl_translate:  '翻译',
    deepl_translating:'翻译中…',
    deepl_close:      '关闭',
    deepl_key_missing:'请在 DeepL Translator 应用中添加你的 DeepL API 密钥以进行翻译。',
    deepl_error:      '翻译失败,请重试。',
  },
};
function _rsst(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_rssi18n[lang] || _rssi18n.en)[key] || key;
}

mvmOS.registerApp({
  id: 'rssfeed',
  name: 'RSS Reader',
  icon: '📰',
  category: 'Media',
  requires_apphub: true,
  async renderSettingsExtra(container) {
    // The DeepL flag lives server-side (backend/apps/rssfeed cfg table, shared
    // by every visitor), not in the per-browser local settings cache the core
    // Settings panel passes in — reading/writing through that local cache showed
    // a checkbox state that had nothing to do with reality and clobbered the
    // other two server fields back to their defaults on every toggle.
    let live = {};
    try { live = await (await fetch('/api/apps/rssfeed/settings')).json(); } catch {}
    const enabled = live.deepl_enabled === '1';
    container.innerHTML = `
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">${_rsst('deepl_section')}</div>
        <label id="rss-se-deepl-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="rss-se-deepl" ${enabled ? 'checked' : ''}>
          <span style="font-size:.84rem">${_rsst('deepl_enable_lbl')}</span>
        </label>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;margin-left:24px">${_rsst('deepl_needs_app')}</div>
      </div>`;

    const row = container.querySelector('#rss-se-deepl-row');
    const cb  = container.querySelector('#rss-se-deepl');
    window.mvmOS?.premiumGate?.(row, _rsst('deepl_needs_app'));

    cb.onchange = async () => {
      const val = cb.checked ? '1' : '0';
      try {
        const r = await fetch('/api/apps/rssfeed/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fetch_interval: live.fetch_interval || '30',
            public_enabled: live.public_enabled || '0',
            deepl_enabled:  val,
          }),
        });
        if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
        live.deepl_enabled = val;
      } catch (e) {
        cb.checked = !cb.checked;
        window.mvmOS?.notify?.('RSS Reader', _rsst('deepl_error'));
      }
    };
  },
  launch() {
    mvmOS.createWindow({
      id: 'rssfeed',
      title: '📰 RSS Reader',
      width: 820,
      height: 580,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'rssfeed' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        RSS.mount(body);
      },
    });
  },
});

const RSS = (() => {
  const _t = _rsst;
  let _root;
  let _feeds = [], _articles = [], _settings = {};
  let _pubUser = null;
  let _selFeed = 0;       // 0 = all
  let _filterRead = 0;    // -1=all, 0=unread, 1=read
  let _filterSaved = false;
  let _selArticle = null;
  let _fetching = false;

  // ── API ───────────────────────────────────────────────────────────────────

  async function _api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    if (token) opts.headers['X-Pub-Token'] = token;
    const prefix = token ? '/api/apps/rssfeed/user' : '/api/apps/rssfeed';
    const r = await fetch(`${prefix}${path}`, opts);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(txt || r.statusText);
    }
    return r.json();
  }

  async function _getSettings() {
    const r = await fetch('/api/apps/rssfeed/settings');
    return r.ok ? r.json() : {};
  }

  async function _reload() {
    const q = _filterSaved
      ? `feed_id=${_selFeed}&is_saved=1`
      : `feed_id=${_selFeed}&is_read=${_filterRead}`;
    [_feeds, _articles, _settings] = await Promise.all([
      _api('GET', '/feeds'),
      _api('GET', `/articles?${q}&limit=200`),
      _getSettings(),
    ]);
  }

  async function _reloadArticles() {
    const q = _filterSaved
      ? `feed_id=${_selFeed}&is_saved=1`
      : `feed_id=${_selFeed}&is_read=${_filterRead}`;
    _articles = await _api('GET', `/articles?${q}&limit=200`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || d.innerText || '';
  }
  function _relTime(dateStr) {
    if (!dateStr) return '';
    try {
      const dt  = new Date(dateStr);
      const sec = Math.floor((Date.now() - dt.getTime()) / 1000);
      if (sec < 90)   return _t('just_now');
      if (sec < 3600) return `${Math.floor(sec/60)} ${_t('ago_min')}`;
      if (sec < 86400) return `${Math.floor(sec/3600)} ${_t('ago_h')}`;
      return `${Math.floor(sec/86400)} ${_t('ago_d')}`;
    } catch { return ''; }
  }
  function _wrap()  { return _root?.querySelector('#rss-wrap'); }
  function _btnS(type) {
    const b = 'padding:5px 11px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;';
    if (type === 'primary')   return b + 'border:none;background:var(--accent);color:#fff;';
    if (type === 'ghost')     return b + 'border:1px solid var(--border);background:transparent;color:var(--text-dim);';
    if (type === 'link')      return 'background:none;border:none;cursor:pointer;font-size:.82rem;color:var(--accent);padding:0;font-family:inherit;';
    return b + 'border:1px solid var(--border);background:var(--surface);color:var(--text);';
  }

  // ── DeepL ─────────────────────────────────────────────────────────────────

  const _DEEPL_LANG_MAP = {
    en: 'EN-US', bg: 'BG', de: 'DE', es: 'ES', fr: 'FR',
    ja: 'JA', 'pt-BR': 'PT-BR', ru: 'RU', 'zh-CN': 'ZH',
  };

  async function _translate(text) {
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Pub-Token'] = token;
    const lang = window.mvmOS?.lang || 'en';
    const target_lang = _DEEPL_LANG_MAP[lang] || 'EN-US';
    // Posts to RSS Reader's own endpoint, never to the DeepL app directly: the
    // translation is a premium feature of *this* app, and only its premium
    // module can perform one. On an install without that module the route is
    // not there at all and this throws, which is the correct outcome.
    const r = await fetch('/pub/rssfeed/translate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, target_lang }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d.translated_text || '';
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function _render() {
    const w = _wrap();
    if (!w) return;
    _renderMain(w);
  }

  function _renderMain(w) {
    const totalUnread = _feeds.reduce((s, f) => s + (f.unread_count || 0), 0);
    const userName = _pubUser?.display_name || '';

    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-weight:700;font-size:.95rem;flex:1">${_t('title')}</span>
        ${userName ? `<span style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">${_esc(userName)}</span>` : ''}
        <button id="rss-fetch" style="${_btnS('ghost')}" title="${_t('fetch')}">${_t('fetch')}</button>
        <button id="rss-settings" style="${_btnS('ghost')}">${_t('feeds_title')}</button>
      </div>
      <div style="display:flex;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);overflow-x:auto;flex-shrink:0;scrollbar-width:none">
        ${_feedChip(0, _t('all_feeds'), totalUnread, _selFeed === 0)}
        ${_feeds.map(f => _feedChip(f.id, f.name, f.unread_count || 0, _selFeed === f.id)).join('')}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        ${_selArticle ? _readerHtml() : _listHtml()}
      </div>
    `;

    w.querySelectorAll('.rss-feed-chip').forEach(el => {
      el.onclick = async () => {
        _selFeed    = parseInt(el.dataset.id);
        _selArticle = null;
        await _reloadArticles();
        _render();
      };
    });

    w.querySelector('#rss-fetch').onclick = _doFetch;
    w.querySelector('#rss-settings').onclick = () => _showSettingsModal(w);

    if (_selArticle) _bindReader(w);
    else _bindList(w);
  }

  function _feedChip(id, name, unread, selected) {
    const base = 'border-radius:20px;padding:4px 12px;font-size:.78rem;cursor:pointer;white-space:nowrap;border:1px solid;flex-shrink:0;font-family:inherit;';
    const style = selected
      ? base + 'background:var(--accent);color:#1e1e2e;border-color:var(--accent);font-weight:600'
      : base + 'background:transparent;color:var(--text-dim);border-color:var(--border)';
    const cnt = unread > 0 ? ` <span style="background:${selected?'rgba(0,0,0,.2)':'var(--accent)'};color:${selected?'#1e1e2e':'#1e1e2e'};border-radius:99px;font-size:.65rem;padding:1px 5px">${unread}</span>` : '';
    return `<button class="rss-feed-chip" data-id="${id}" style="${style}">${_esc(name)}${cnt}</button>`;
  }

  function _showSettingsModal(w) {
    w.style.position = 'relative';
    const overlay = document.createElement('div');
    overlay.id = 'rss-modal';
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;width:100%;max-width:420px;max-height:calc(100% - 32px);overflow-y:auto';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;font-size:.95rem;flex:1">${_t('feeds_title')}</span>
        <button id="rss-modal-close" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-dim);padding:2px 6px;font-family:inherit">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:16px">
        <div>
          <div id="rss-feeds-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="rss-add-url" placeholder="${_t('feed_url_ph')}" style="flex:1;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.84rem;outline:none">
            <button id="rss-add-btn" style="padding:6px 12px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;border:1px solid var(--accent);background:var(--accent);color:#1e1e2e;white-space:nowrap">${_t('add')}</button>
          </div>
          <div id="rss-add-err" style="color:#f38ba8;font-size:.78rem;margin-top:4px;min-height:16px"></div>
        </div>
      </div>`;

    function renderFeedsList() {
      const list = panel.querySelector('#rss-feeds-list');
      if (!_feeds.length) {
        list.innerHTML = `<div style="font-size:.82rem;color:var(--text-dim)">${_t('no_feeds')}</div>`;
        return;
      }
      list.innerHTML = _feeds.map(f => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(f.name)}</span>
          ${f.unread_count ? `<span style="font-size:.7rem;color:var(--accent)">${f.unread_count} unread</span>` : ''}
          <button class="rss-del-feed" data-id="${f.id}"
            style="background:none;border:none;cursor:pointer;color:#f38ba8;font-size:.78rem;padding:2px 6px;border-radius:4px;font-family:inherit">${_t('del_feed')}</button>
        </div>`).join('');
      list.querySelectorAll('.rss-del-feed').forEach(btn => {
        btn.onclick = async () => {
          await _api('DELETE', `/feeds/${btn.dataset.id}`).catch(()=>{});
          await _reload();
          if (_selFeed == btn.dataset.id) _selFeed = 0;
          renderFeedsList();
          _render();
        };
      });
    }
    renderFeedsList();

    panel.querySelector('#rss-modal-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    const addBtn = panel.querySelector('#rss-add-btn');
    const addErr = panel.querySelector('#rss-add-err');
    addBtn.onclick = async () => {
      const url = panel.querySelector('#rss-add-url').value.trim();
      if (!url) return;
      addBtn.disabled = true; addErr.textContent = '';
      try {
        await _api('POST', '/feeds', { url });
        panel.querySelector('#rss-add-url').value = '';
        await _reload();
        renderFeedsList();
        _render();
      } catch(e) {
        addErr.textContent = String(e).replace(/^Error:\s*/,'');
      }
      addBtn.disabled = false;
    };
    panel.querySelector('#rss-add-url').onkeydown = e => { if (e.key==='Enter') addBtn.click(); };

    overlay.appendChild(panel);
    w.appendChild(overlay);
  }

  // ── Article list ──────────────────────────────────────────────────────────

  function _listHtml() {
    const deeplOn = _settings.deepl_enabled === '1' && !!_settings.deepl_available;
    const filters = [
      { v: -1,      saved: false, lbl: _t('all_filter') },
      { v: 0,       saved: false, lbl: _t('unread') },
      { v: 1,       saved: false, lbl: _t('read') },
      { v: -1,      saved: true,  lbl: _t('saved') },
    ];
    const filterBar = `
      <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
        <span style="font-size:.76rem;color:var(--text-dim)">${_t('filter_label')}</span>
        ${filters.map((f, fi) => {
          const active = f.saved ? _filterSaved : (!_filterSaved && _filterRead === f.v);
          return `<button class="rss-filter" data-fi="${fi}" style="${_btnS(active?'primary':'ghost')}">${f.lbl}</button>`;
        }).join('')}
        <div style="flex:1"></div>
        <button id="rss-mark-all" style="${_btnS('ghost')} font-size:.78rem">${_t('mark_all_read')}</button>
      </div>`;

    if (_articles.length === 0) {
      return filterBar + `<div style="text-align:center;color:var(--text-dim);padding:48px 16px;font-size:.85rem">${_t('no_articles')}</div>`;
    }

    const items = _articles.map(a => {
      const unread  = !a.is_read;
      const excerpt = _stripHtml(a.description || '');
      const rel     = _relTime(a.pub_date || a.fetched_at);
      const showFeed = _selFeed === 0;
      return `
        <div class="rss-art" data-id="${a.id}" style="padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s"
          onmouseenter="this.style.background='var(--surface)'"
          onmouseleave="this.style.background=''">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:6px;display:inline-block;${unread?'background:var(--accent)':''}"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.86rem;font-weight:${unread?'600':'400'};color:${unread?'var(--text)':'var(--text-dim)'};line-height:1.4;word-break:break-word">${_esc(a.title || '(no title)')}</div>
              ${excerpt ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:3px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${_esc(excerpt)}</div>` : ''}
              <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                ${showFeed ? `<span style="color:var(--accent)">${_esc(a.feed_name)}</span>` : ''}
                ${rel ? `<span>${rel}</span>` : ''}
                ${deeplOn ? `<button class="rss-list-tr-btn" data-aid="${a.id}" style="background:none;border:1px solid var(--border);border-radius:3px;padding:1px 7px;font-size:.7rem;cursor:pointer;color:var(--text-dim);font-family:inherit" onclick="event.stopPropagation()">${_esc(_t('deepl_translate'))}</button>` : ''}
              </div>
              ${deeplOn ? `<div class="rss-list-tr-result" data-aid="${a.id}" style="display:none;margin-top:7px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 10px;font-size:.78rem;line-height:1.6;white-space:pre-wrap;word-break:break-word"></div>` : ''}
            </div>
            <button class="rss-star" data-id="${a.id}" onclick="event.stopPropagation()"
              style="background:none;border:none;cursor:pointer;font-size:1.05rem;padding:2px 4px;flex-shrink:0;line-height:1;color:${a.is_saved?'#f59e0b':'var(--text-dim)'}">
              ${a.is_saved ? '★' : '☆'}
            </button>
          </div>
        </div>`;
    }).join('');

    return filterBar + `<div style="flex:1;overflow-y:auto">${items}</div>`;
  }

  const _filterDefs = [
    { v: -1, saved: false },
    { v: 0,  saved: false },
    { v: 1,  saved: false },
    { v: -1, saved: true  },
  ];

  function _bindList(w) {
    w.querySelectorAll('.rss-filter').forEach(btn => {
      btn.onclick = async () => {
        const f = _filterDefs[parseInt(btn.dataset.fi)];
        _filterSaved = f.saved;
        _filterRead  = f.v;
        await _reloadArticles();
        _render();
      };
    });

    w.querySelectorAll('.rss-star').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const res = await _api('POST', `/articles/${id}/save`).catch(() => null);
        if (!res) return;
        const a = _articles.find(x => x.id === id);
        if (a) a.is_saved = res.is_saved;
        btn.textContent = res.is_saved ? '★' : '☆';
        btn.style.color = res.is_saved ? '#f59e0b' : 'var(--text-dim)';
        if (_filterSaved && !res.is_saved) {
          _articles = _articles.filter(x => x.id !== id);
          _render();
        }
      };
    });
    w.querySelectorAll('.rss-art').forEach(el => {
      el.onclick = async () => {
        const id = parseInt(el.dataset.id);
        _selArticle = _articles.find(a => a.id === id) || null;
        if (_selArticle && !_selArticle.is_read) {
          await _api('POST', `/articles/${id}/read`).catch(() => {});
          _selArticle.is_read = 1;
          const feed = _feeds.find(f => f.id === _selArticle.feed_id);
          if (feed && feed.unread_count > 0) feed.unread_count--;
        }
        _render();
      };
    });
    w.querySelectorAll('.rss-list-tr-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const aid = parseInt(btn.dataset.aid);
        const a   = _articles.find(x => x.id === aid);
        if (!a) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = _t('deepl_translating');
        const resultEl = w.querySelector(`.rss-list-tr-result[data-aid="${aid}"]`);
        try {
          const text = await _translate(`${a.title || ''}\n\n${_stripHtml(a.description || '').slice(0, 1200)}`);
          if (resultEl) { resultEl.textContent = text; resultEl.style.display = ''; }
        } catch (err) {
          if (resultEl) { resultEl.textContent = _t('deepl_error'); resultEl.style.display = ''; }
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      };
    });

    const mAll = w.querySelector('#rss-mark-all');
    if (mAll) mAll.onclick = async () => {
      await _api('POST', '/articles/read-all', { feed_id: _selFeed }).catch(() => {});
      await _reload();
      _selArticle = null;
      _render();
    };
  }

  // ── Reader ────────────────────────────────────────────────────────────────

  function _readerHtml() {
    const a   = _selArticle;
    const rel = _relTime(a.pub_date || a.fetched_at);
    const deeplOn = _settings.deepl_enabled === '1' && !!_settings.deepl_available;
    const trRow = deeplOn ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        <button id="rss-tr-btn" style="${_btnS('ghost')} font-size:.78rem;padding:4px 10px">${_t('deepl_translate')}</button>
      </div>
      <div id="rss-tr-result" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:.84rem;line-height:1.7">
        <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:8px">
          <button id="rss-tr-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:0;font-family:inherit">${_t('deepl_close')}</button>
        </div>
        <div id="rss-tr-result-text" style="white-space:pre-wrap;word-break:break-word"></div>
      </div>` : '';
    return `
      <div style="flex:1;overflow-y:auto;padding:20px 22px">
        <div style="margin-bottom:14px">
          <button id="rss-back-list" style="${_btnS('ghost')}">${_t('back_list')}</button>
        </div>
        <div style="font-size:.72rem;color:var(--accent);margin-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>${_esc(a.feed_name || '')}</span>
          ${rel ? `<span style="color:var(--text-dim)">${rel}</span>` : ''}
        </div>
        <h2 style="font-size:1rem;font-weight:700;line-height:1.45;margin-bottom:14px;word-break:break-word">${_esc(a.title || '(no title)')}</h2>
        ${trRow}
        <div id="rss-content" style="font-size:.86rem;line-height:1.7;color:var(--text);word-break:break-word;max-width:640px">
          ${a.description || '<span style="color:var(--text-dim)">—</span>'}
        </div>
        ${a.link ? `
        <div style="margin-top:20px">
          <a href="${_esc(a.link)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:.84rem;text-decoration:none">${_t('open_original')}</a>
        </div>` : ''}
      </div>`;
  }

  function _bindReader(w) {
    w.querySelector('#rss-back-list').onclick = () => {
      _selArticle = null;
      _render();
    };
    const trBtn = w.querySelector('#rss-tr-btn');
    if (trBtn) trBtn.onclick = async () => {
      const orig = trBtn.textContent;
      trBtn.disabled = true;
      trBtn.textContent = _t('deepl_translating');
      try {
        const a = _selArticle;
        const text = await _translate(`${a.title || ''}\n\n${_stripHtml(a.description || '').slice(0, 1200)}`);
        w.querySelector('#rss-tr-result-text').textContent = text;
        w.querySelector('#rss-tr-result').style.display = '';
      } catch (e) {
        mvmOS.notify('RSS Reader', _t('deepl_error'));
      } finally {
        trBtn.disabled = false;
        trBtn.textContent = orig;
      }
    };
    const closeBtn = w.querySelector('#rss-tr-close');
    if (closeBtn) closeBtn.onclick = () => { w.querySelector('#rss-tr-result').style.display = 'none'; };
  }

  // ── Fetch now ─────────────────────────────────────────────────────────────

  async function _doFetch() {
    if (_fetching) return;
    _fetching = true;
    const btn = _wrap()?.querySelector('#rss-fetch');
    if (btn) btn.textContent = _t('fetching');
    try {
      await _api('POST', '/fetch');
      await _reload();
      _selArticle = null;
      _render();
    } catch (e) {
      mvmOS.notify('RSS Reader', String(e));
    } finally {
      _fetching = false;
    }
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function mount(root) {
    _root = root;
    root.innerHTML = `<div id="rss-wrap" style="display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);font-family:inherit;overflow:hidden"></div>`;

    const _start = async () => {
      if (typeof AppHub !== 'undefined') {
        const t = AppHub.getToken();
        if (t) {
          const u = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': t } })
            .then(r => r.ok ? r.json() : null).catch(() => null);
          _pubUser = u;
        }
      }
      await _reload();
      _render();
      if (_feeds.length > 0 && _feeds.some(f => !f.last_fetched)) {
        _doFetch();
      }
    };

    _start().catch(e => {
      const w = _wrap();
      if (w) w.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${String(e)}</div>`;
    });
  }

  return { mount };
})();
