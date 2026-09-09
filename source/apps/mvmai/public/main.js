// mvmOS App: mvmAI v0.1.0 — AI chat with shell access
const _MVMAI_MODELS = {
  gemini: [], openai: [], groq: [], deepseek: [], qwen: [], mistral: [],
  openrouter: [], ollama: [], custom: [],
};
const _mvmai18n = {
  en: {
    title: 'mvmAI', new_chat: '+ New chat', no_sessions: 'No conversations yet',
    placeholder: 'Message mvmAI…  (Shift+Enter for newline)', send: 'Send', stop: 'Stop',
    thinking: 'Thinking…', running: 'Running command…',
    welcome_title: 'mvmAI', welcome_sub: 'Ask anything.',
    no_provider: 'No provider configured. Open ⚙ Settings, pick a provider and enter your API key.',
    open_settings: '⚙ Settings', settings_btn: '⚙', rename: 'Rename', delete: 'Delete',
    del_confirm: 'Delete this conversation?', cmd_label: 'Command', reason_label: 'Reason',
    run_q: 'Run this command?', run_yes: 'Run', run_no: 'Skip', output: 'Output', exit_code: 'exit',
    blocked: '⛔ Blocked', cancelled: 'Skipped by user', dangerous: '⚠ dangerous',
    err: 'Error',
    provider: 'Provider', api_key: 'API key', model: 'Model (leave empty for default)',
    base_url: 'Custom base URL (only for Custom provider)',
    segment_desktop: 'Desktop', segment_public: 'Public page (Premium)',
    pub_provider_label: 'Public page AI', pub_provider_same: '(same as desktop)',
    pub_provider_premium_hint: 'Using a different AI for the public page requires Premium.',
    pub_bridge_label: 'Let public users use the app-data API integration',
    pub_bridge_hint: "Off by default. When on, mvmAI can read or change a user's own data in their other installed apps.",
    sett_hint: 'Everything stays inside mvmOS — the API key is stored on the server and never leaves it.',
    exec_toggle: 'Server commands', exec_off: 'Read-only', exec_confirm: 'Confirm', exec_auto_short: 'Auto',
    exec_enable_label: 'Let mvmAI run commands on this server', exec_mode_label: 'When it wants to run one',
    exec_mode_confirm: 'Ask me to confirm each command', exec_mode_auto: 'Run automatically, no confirmation',
    model_tool_default: '(tool default)', models_found: '{count} models found — the tool default is used initially.',
    models_failed: "The model list couldn't be loaded — the tool default will be used.",
    models_unavailable: "This CLI doesn't expose a model list — its default model will be used.",
    projects_title: 'Projects', project_new: '+ New project', no_projects: 'No projects yet',
    project_name_label: 'Name', project_path_label: 'Folder', project_browse: 'Browse…', project_create: 'Create',
    project_name_required: 'Project name is required', project_path_required: 'Choose a folder',
    project_del_confirm: 'Delete this project? The folder itself is not touched.', project_creating: 'Creating…',
    browse_title: 'Choose a folder', browse_select: 'Select this folder', browse_up: '.. (up)',
    active_project: 'Project: {name}', loading: 'Loading…', git_not_repo: 'Not a git repository', git_clean: 'No changes', cancel: 'Cancel',
  },
  bg: {
    title: 'mvmAI', new_chat: '+ Нов чат', no_sessions: 'Все още няма разговори',
    placeholder: 'Съобщение до mvmAI…  (Shift+Enter за нов ред)', send: 'Изпрати', stop: 'Спри',
    thinking: 'Мисля…', running: 'Изпълнявам команда…',
    welcome_title: 'mvmAI', welcome_sub: 'Питай каквото поискаш.',
    no_provider: 'Няма конфигуриран провайдър. Отвори ⚙ Настройки, избери провайдър и въведи API ключ.',
    open_settings: '⚙ Настройки', settings_btn: '⚙', rename: 'Преименувай', delete: 'Изтрий',
    del_confirm: 'Изтриване на този разговор?', cmd_label: 'Команда', reason_label: 'Причина',
    run_q: 'Да изпълня ли тази команда?', run_yes: 'Изпълни', run_no: 'Пропусни', output: 'Резултат', exit_code: 'изход',
    blocked: '⛔ Блокирана', cancelled: 'Пропусната от потребителя', dangerous: '⚠ опасна',
    err: 'Грешка',
    provider: 'Провайдър', api_key: 'API ключ', model: 'Модел (празно = по подразбиране)',
    base_url: 'Custom base URL (само за Custom провайдър)',
    segment_desktop: 'Работен плот', segment_public: 'Публична страница (Premium)',
    pub_provider_label: 'AI за публичната страница', pub_provider_same: '(същия като вътрешния)',
    pub_provider_premium_hint: 'Различен AI за публичната страница изисква Premium.',
    pub_bridge_label: 'Позволи на публичните потребители да ползват API интеграцията с приложенията',
    pub_bridge_hint: 'По подразбиране е изключено. Когато е включено, mvmAI може да чете или променя собствените данни на потребителя в другите му инсталирани приложения.',
    sett_hint: 'Всичко остава вътре в mvmOS — API ключът се пази на сървъра и никога не го напуска.',
    exec_toggle: 'Команди на сървъра', exec_off: 'Само преглед', exec_confirm: 'С потвърждение', exec_auto_short: 'Автоматично',
    exec_enable_label: 'Позволи на mvmAI да изпълнява команди на този сървър', exec_mode_label: 'Когато иска да изпълни команда',
    exec_mode_confirm: 'Да ме пита за потвърждение за всяка команда', exec_mode_auto: 'Да изпълнява автоматично, без потвърждение',
    model_tool_default: '(по подразбиране на инструмента)', models_found: '{count} открити модела — първоначално се използва моделът по подразбиране на инструмента.',
    models_failed: 'Списъкът с модели не може да бъде зареден — ще се използва моделът по подразбиране на инструмента.',
    models_unavailable: 'Този CLI не предоставя списък с модели — ще се използва неговият модел по подразбиране.',
    projects_title: 'Проекти', project_new: '+ Нов проект', no_projects: 'Все още няма проекти',
    project_name_label: 'Име', project_path_label: 'Папка', project_browse: 'Разгледай…', project_create: 'Създай',
    project_name_required: 'Името на проекта е задължително', project_path_required: 'Избери папка',
    project_del_confirm: 'Изтриване на този проект? Самата папка не се пипа.', project_creating: 'Създаване…',
    browse_title: 'Избери папка', browse_select: 'Избери тази папка', browse_up: '.. (нагоре)',
    active_project: 'Проект: {name}', loading: 'Зареждане…', git_not_repo: 'Не е git repository', git_clean: 'Няма промени', cancel: 'Отказ',
  },
  de: {
    title: 'mvmAI', new_chat: '+ Neuer Chat', no_sessions: 'Noch keine Unterhaltungen',
    placeholder: 'Nachricht an mvmAI…  (Umschalt+Eingabe für neue Zeile)', send: 'Senden', stop: 'Stopp',
    thinking: 'Denke nach…', running: 'Befehl wird ausgeführt…',
    welcome_title: 'mvmAI', welcome_sub: 'Frag mich alles.',
    no_provider: 'Kein Anbieter konfiguriert. Öffne ⚙ Einstellungen, wähle einen Anbieter und gib deinen API-Schlüssel ein.',
    open_settings: '⚙ Einstellungen', settings_btn: '⚙', rename: 'Umbenennen', delete: 'Löschen',
    del_confirm: 'Diese Unterhaltung löschen?', cmd_label: 'Befehl', reason_label: 'Grund',
    run_q: 'Diesen Befehl ausführen?', run_yes: 'Ausführen', run_no: 'Überspringen', output: 'Ausgabe', exit_code: 'exit',
    blocked: '⛔ Blockiert', cancelled: 'Vom Benutzer übersprungen', dangerous: '⚠ gefährlich',
    err: 'Fehler',
    provider: 'Anbieter', api_key: 'API-Schlüssel', model: 'Modell (leer = Standard)',
    base_url: 'Eigene Basis-URL (nur für Custom-Anbieter)',
    segment_desktop: 'Desktop', segment_public: 'Öffentliche Seite (Premium)',
    pub_provider_label: 'KI für die öffentliche Seite', pub_provider_same: '(wie im Desktop)',
    pub_provider_premium_hint: 'Eine andere KI für die öffentliche Seite erfordert Premium.',
    pub_bridge_label: 'Öffentlichen Nutzern die App-Daten-API-Integration erlauben',
    pub_bridge_hint: 'Standardmäßig deaktiviert. Wenn aktiviert, kann mvmAI die eigenen Daten des Nutzers in dessen anderen installierten Apps lesen oder ändern.',
    sett_hint: 'Alles bleibt innerhalb von mvmOS — der API-Schlüssel wird auf dem Server gespeichert und verlässt ihn nie.',
    exec_toggle: 'Serverbefehle', exec_off: 'Nur Lesen', exec_confirm: 'Bestätigen', exec_auto_short: 'Automatisch',
    exec_enable_label: 'mvmAI erlauben, Befehle auf diesem Server auszuführen', exec_mode_label: 'Wenn ein Befehl ausgeführt werden soll',
    exec_mode_confirm: 'Vor jedem Befehl um Bestätigung bitten', exec_mode_auto: 'Automatisch ausführen, ohne Bestätigung',
    model_tool_default: '(Standardeinstellung des Tools)', models_found: '{count} Modelle gefunden — zunächst wird die Standardeinstellung des Tools verwendet.',
    models_failed: 'Die Modellliste konnte nicht geladen werden — die Standardeinstellung des Tools wird verwendet.',
    models_unavailable: 'Dieses CLI stellt keine Modellliste bereit — sein Standardmodell wird verwendet.',
    projects_title: 'Projekte', project_new: '+ Neues Projekt', no_projects: 'Noch keine Projekte',
    project_name_label: 'Name', project_path_label: 'Ordner', project_browse: 'Durchsuchen…', project_create: 'Erstellen',
    project_name_required: 'Der Projektname ist erforderlich', project_path_required: 'Wähle einen Ordner',
    project_del_confirm: 'Dieses Projekt löschen? Der Ordner selbst bleibt unberührt.', project_creating: 'Wird erstellt…',
    browse_title: 'Ordner wählen', browse_select: 'Diesen Ordner auswählen', browse_up: '.. (nach oben)',
    active_project: 'Projekt: {name}', loading: 'Wird geladen…', git_not_repo: 'Kein Git-Repository', git_clean: 'Keine Änderungen', cancel: 'Abbrechen',
  },
  es: {
    title: 'mvmAI', new_chat: '+ Nuevo chat', no_sessions: 'Aún no hay conversaciones',
    placeholder: 'Mensaje para mvmAI…  (Mayús+Intro para salto de línea)', send: 'Enviar', stop: 'Detener',
    thinking: 'Pensando…', running: 'Ejecutando comando…',
    welcome_title: 'mvmAI', welcome_sub: 'Pregunta lo que quieras.',
    no_provider: 'No hay proveedor configurado. Abre ⚙ Ajustes, elige un proveedor e introduce tu clave API.',
    open_settings: '⚙ Ajustes', settings_btn: '⚙', rename: 'Renombrar', delete: 'Eliminar',
    del_confirm: '¿Eliminar esta conversación?', cmd_label: 'Comando', reason_label: 'Motivo',
    run_q: '¿Ejecutar este comando?', run_yes: 'Ejecutar', run_no: 'Omitir', output: 'Salida', exit_code: 'salida',
    blocked: '⛔ Bloqueado', cancelled: 'Omitido por el usuario', dangerous: '⚠ peligroso',
    err: 'Error',
    provider: 'Proveedor', api_key: 'Clave API', model: 'Modelo (vacío = predeterminado)',
    base_url: 'URL base personalizada (solo para proveedor Custom)',
    segment_desktop: 'Escritorio', segment_public: 'Página pública (Premium)',
    pub_provider_label: 'IA de la página pública', pub_provider_same: '(igual que en el escritorio)',
    pub_provider_premium_hint: 'Usar una IA distinta para la página pública requiere Premium.',
    pub_bridge_label: 'Permitir a los usuarios públicos usar la integración de API con las apps',
    pub_bridge_hint: 'Desactivado por defecto. Cuando está activado, mvmAI puede leer o modificar los propios datos del usuario en sus otras apps instaladas.',
    sett_hint: 'Todo permanece dentro de mvmOS — la clave API se guarda en el servidor y nunca sale de él.',
    exec_toggle: 'Comandos del servidor', exec_off: 'Solo lectura', exec_confirm: 'Confirmar', exec_auto_short: 'Automático',
    exec_enable_label: 'Permitir que mvmAI ejecute comandos en este servidor', exec_mode_label: 'Cuando quiera ejecutar uno',
    exec_mode_confirm: 'Pedirme confirmación para cada comando', exec_mode_auto: 'Ejecutar automáticamente, sin confirmación',
    model_tool_default: '(predeterminado de la herramienta)', models_found: '{count} modelos encontrados — inicialmente se usa el predeterminado de la herramienta.',
    models_failed: 'No se pudo cargar la lista de modelos — se usará el predeterminado de la herramienta.',
    models_unavailable: 'Este CLI no ofrece una lista de modelos — se usará su modelo predeterminado.',
    projects_title: 'Proyectos', project_new: '+ Nuevo proyecto', no_projects: 'Aún no hay proyectos',
    project_name_label: 'Nombre', project_path_label: 'Carpeta', project_browse: 'Explorar…', project_create: 'Crear',
    project_name_required: 'El nombre del proyecto es obligatorio', project_path_required: 'Elige una carpeta',
    project_del_confirm: '¿Eliminar este proyecto? La carpeta en sí no se modifica.', project_creating: 'Creando…',
    browse_title: 'Elegir una carpeta', browse_select: 'Seleccionar esta carpeta', browse_up: '.. (subir)',
    active_project: 'Proyecto: {name}', loading: 'Cargando…', git_not_repo: 'No es un repositorio git', git_clean: 'Sin cambios', cancel: 'Cancelar',
  },
  fr: {
    title: 'mvmAI', new_chat: '+ Nouvelle discussion', no_sessions: 'Aucune conversation pour le moment',
    placeholder: 'Message à mvmAI…  (Maj+Entrée pour un saut de ligne)', send: 'Envoyer', stop: 'Arrêter',
    thinking: 'Réflexion…', running: 'Exécution de la commande…',
    welcome_title: 'mvmAI', welcome_sub: 'Demande-moi ce que tu veux.',
    no_provider: 'Aucun fournisseur configuré. Ouvre ⚙ Paramètres, choisis un fournisseur et saisis ta clé API.',
    open_settings: '⚙ Paramètres', settings_btn: '⚙', rename: 'Renommer', delete: 'Supprimer',
    del_confirm: 'Supprimer cette conversation ?', cmd_label: 'Commande', reason_label: 'Raison',
    run_q: 'Exécuter cette commande ?', run_yes: 'Exécuter', run_no: 'Ignorer', output: 'Résultat', exit_code: 'sortie',
    blocked: '⛔ Bloquée', cancelled: "Ignorée par l'utilisateur", dangerous: '⚠ dangereuse',
    err: 'Erreur',
    provider: 'Fournisseur', api_key: 'Clé API', model: 'Modèle (vide = par défaut)',
    base_url: 'URL de base personnalisée (uniquement pour le fournisseur Custom)',
    segment_desktop: 'Bureau', segment_public: 'Page publique (Premium)',
    pub_provider_label: 'IA de la page publique', pub_provider_same: '(identique au bureau)',
    pub_provider_premium_hint: 'Utiliser une IA différente pour la page publique nécessite Premium.',
    pub_bridge_label: "Autoriser les utilisateurs publics à utiliser l'intégration API avec les applications",
    pub_bridge_hint: "Désactivé par défaut. Une fois activé, mvmAI peut lire ou modifier les propres données de l'utilisateur dans ses autres applications installées.",
    sett_hint: "Tout reste à l'intérieur de mvmOS — la clé API est stockée sur le serveur et ne le quitte jamais.",
    exec_toggle: 'Commandes serveur', exec_off: 'Lecture seule', exec_confirm: 'Confirmation', exec_auto_short: 'Automatique',
    exec_enable_label: 'Autoriser mvmAI à exécuter des commandes sur ce serveur', exec_mode_label: "Quand il veut en exécuter une",
    exec_mode_confirm: 'Me demander de confirmer chaque commande', exec_mode_auto: 'Exécuter automatiquement, sans confirmation',
    model_tool_default: '(valeur par défaut de l’outil)', models_found: '{count} modèles trouvés — la valeur par défaut de l’outil est utilisée initialement.',
    models_failed: 'La liste des modèles n’a pas pu être chargée — la valeur par défaut de l’outil sera utilisée.',
    models_unavailable: 'Ce CLI ne fournit pas de liste de modèles — son modèle par défaut sera utilisé.',
    projects_title: 'Projets', project_new: '+ Nouveau projet', no_projects: 'Aucun projet pour le moment',
    project_name_label: 'Nom', project_path_label: 'Dossier', project_browse: 'Parcourir…', project_create: 'Créer',
    project_name_required: 'Le nom du projet est requis', project_path_required: 'Choisissez un dossier',
    project_del_confirm: "Supprimer ce projet ? Le dossier lui-même n'est pas touché.", project_creating: 'Création…',
    browse_title: 'Choisir un dossier', browse_select: 'Sélectionner ce dossier', browse_up: '.. (remonter)',
    active_project: 'Projet : {name}', loading: 'Chargement…', git_not_repo: "Ce n'est pas un dépôt git", git_clean: 'Aucun changement', cancel: 'Annuler',
  },
  ja: {
    title: 'mvmAI', new_chat: '+ 新しいチャット', no_sessions: 'まだ会話がありません',
    placeholder: 'mvmAIへのメッセージ…  (Shift+Enterで改行)', send: '送信', stop: '停止',
    thinking: '考え中…', running: 'コマンドを実行中…',
    welcome_title: 'mvmAI', welcome_sub: '何でも聞いてください。',
    no_provider: 'プロバイダーが設定されていません。⚙ 設定を開き、プロバイダーを選んでAPIキーを入力してください。',
    open_settings: '⚙ 設定', settings_btn: '⚙', rename: '名前を変更', delete: '削除',
    del_confirm: 'この会話を削除しますか?', cmd_label: 'コマンド', reason_label: '理由',
    run_q: 'このコマンドを実行しますか?', run_yes: '実行', run_no: 'スキップ', output: '出力', exit_code: '終了コード',
    blocked: '⛔ ブロック済み', cancelled: 'ユーザーによりスキップ', dangerous: '⚠ 危険',
    err: 'エラー',
    provider: 'プロバイダー', api_key: 'APIキー', model: 'モデル (空欄でデフォルト)',
    base_url: 'カスタムベースURL (Customプロバイダーのみ)',
    segment_desktop: 'デスクトップ', segment_public: '公開ページ (Premium)',
    pub_provider_label: '公開ページのAI', pub_provider_same: '(デスクトップと同じ)',
    pub_provider_premium_hint: '公開ページで別のAIを使うにはPremiumが必要です。',
    pub_bridge_label: '公開ユーザーにアプリデータAPI連携の利用を許可する',
    pub_bridge_hint: '初期設定ではオフです。オンにすると、mvmAIはユーザー自身の他のインストール済みアプリのデータを読み書きできます。',
    sett_hint: 'すべてmvmOS内に留まります — APIキーはサーバーに保存され、外部に出ることはありません。',
    exec_toggle: 'サーバーコマンド', exec_off: '読み取り専用', exec_confirm: '確認あり', exec_auto_short: '自動',
    exec_enable_label: 'mvmAIがこのサーバーでコマンドを実行できるようにする', exec_mode_label: 'コマンドを実行したいとき',
    exec_mode_confirm: 'コマンドごとに確認を求める', exec_mode_auto: '確認なしで自動実行する',
    model_tool_default: '（ツールのデフォルト）', models_found: '{count}個のモデルが見つかりました — 初期状態ではツールのデフォルトを使用します。',
    models_failed: 'モデル一覧を読み込めませんでした — ツールのデフォルトを使用します。',
    models_unavailable: 'このCLIはモデル一覧を提供していません — デフォルトモデルを使用します。',
    projects_title: 'プロジェクト', project_new: '+ 新規プロジェクト', no_projects: 'まだプロジェクトがありません',
    project_name_label: '名前', project_path_label: 'フォルダ', project_browse: '参照…', project_create: '作成',
    project_name_required: 'プロジェクト名は必須です', project_path_required: 'フォルダを選択してください',
    project_del_confirm: 'このプロジェクトを削除しますか？フォルダ自体は削除されません。', project_creating: '作成中…',
    browse_title: 'フォルダを選択', browse_select: 'このフォルダを選択', browse_up: '..（上へ）',
    active_project: 'プロジェクト: {name}', loading: '読み込み中…', git_not_repo: 'gitリポジトリではありません', git_clean: '変更なし', cancel: 'キャンセル',
  },
  'pt-BR': {
    title: 'mvmAI', new_chat: '+ Nova conversa', no_sessions: 'Ainda não há conversas',
    placeholder: 'Mensagem para o mvmAI…  (Shift+Enter para nova linha)', send: 'Enviar', stop: 'Parar',
    thinking: 'Pensando…', running: 'Executando comando…',
    welcome_title: 'mvmAI', welcome_sub: 'Pergunte qualquer coisa.',
    no_provider: 'Nenhum provedor configurado. Abra ⚙ Configurações, escolha um provedor e informe sua chave de API.',
    open_settings: '⚙ Configurações', settings_btn: '⚙', rename: 'Renomear', delete: 'Excluir',
    del_confirm: 'Excluir esta conversa?', cmd_label: 'Comando', reason_label: 'Motivo',
    run_q: 'Executar este comando?', run_yes: 'Executar', run_no: 'Pular', output: 'Saída', exit_code: 'saída',
    blocked: '⛔ Bloqueado', cancelled: 'Ignorado pelo usuário', dangerous: '⚠ perigoso',
    err: 'Erro',
    provider: 'Provedor', api_key: 'Chave de API', model: 'Modelo (vazio = padrão)',
    base_url: 'URL base personalizada (apenas para provedor Custom)',
    segment_desktop: 'Desktop', segment_public: 'Página pública (Premium)',
    pub_provider_label: 'IA da página pública', pub_provider_same: '(igual ao desktop)',
    pub_provider_premium_hint: 'Usar uma IA diferente na página pública requer Premium.',
    pub_bridge_label: 'Permitir que usuários públicos usem a integração de API com os apps',
    pub_bridge_hint: 'Desativado por padrão. Quando ativado, o mvmAI pode ler ou alterar os próprios dados do usuário em seus outros apps instalados.',
    sett_hint: 'Tudo permanece dentro do mvmOS — a chave de API fica armazenada no servidor e nunca sai dele.',
    exec_toggle: 'Comandos do servidor', exec_off: 'Somente leitura', exec_confirm: 'Confirmar', exec_auto_short: 'Automático',
    exec_enable_label: 'Permitir que o mvmAI execute comandos neste servidor', exec_mode_label: 'Quando quiser executar um',
    exec_mode_confirm: 'Pedir confirmação para cada comando', exec_mode_auto: 'Executar automaticamente, sem confirmação',
    model_tool_default: '(padrão da ferramenta)', models_found: '{count} modelos encontrados — inicialmente, o padrão da ferramenta é usado.',
    models_failed: 'Não foi possível carregar a lista de modelos — o padrão da ferramenta será usado.',
    models_unavailable: 'Esta CLI não fornece uma lista de modelos — seu modelo padrão será usado.',
    projects_title: 'Projetos', project_new: '+ Novo projeto', no_projects: 'Ainda não há projetos',
    project_name_label: 'Nome', project_path_label: 'Pasta', project_browse: 'Procurar…', project_create: 'Criar',
    project_name_required: 'O nome do projeto é obrigatório', project_path_required: 'Escolha uma pasta',
    project_del_confirm: 'Excluir este projeto? A pasta em si não é afetada.', project_creating: 'Criando…',
    browse_title: 'Escolher uma pasta', browse_select: 'Selecionar esta pasta', browse_up: '.. (subir)',
    active_project: 'Projeto: {name}', loading: 'Carregando…', git_not_repo: 'Não é um repositório git', git_clean: 'Sem alterações', cancel: 'Cancelar',
  },
  ru: {
    title: 'mvmAI', new_chat: '+ Новый чат', no_sessions: 'Пока нет разговоров',
    placeholder: 'Сообщение для mvmAI…  (Shift+Enter для новой строки)', send: 'Отправить', stop: 'Стоп',
    thinking: 'Думаю…', running: 'Выполняю команду…',
    welcome_title: 'mvmAI', welcome_sub: 'Спрашивай что угодно.',
    no_provider: 'Провайдер не настроен. Открой ⚙ Настройки, выбери провайдера и введи API-ключ.',
    open_settings: '⚙ Настройки', settings_btn: '⚙', rename: 'Переименовать', delete: 'Удалить',
    del_confirm: 'Удалить этот разговор?', cmd_label: 'Команда', reason_label: 'Причина',
    run_q: 'Выполнить эту команду?', run_yes: 'Выполнить', run_no: 'Пропустить', output: 'Результат', exit_code: 'код выхода',
    blocked: '⛔ Заблокировано', cancelled: 'Пропущено пользователем', dangerous: '⚠ опасно',
    err: 'Ошибка',
    provider: 'Провайдер', api_key: 'API-ключ', model: 'Модель (пусто = по умолчанию)',
    base_url: 'Свой базовый URL (только для провайдера Custom)',
    segment_desktop: 'Рабочий стол', segment_public: 'Публичная страница (Premium)',
    pub_provider_label: 'ИИ для публичной страницы', pub_provider_same: '(как на десктопе)',
    pub_provider_premium_hint: 'Использование другого ИИ для публичной страницы требует Premium.',
    pub_bridge_label: 'Разрешить публичным пользователям использовать API-интеграцию с приложениями',
    pub_bridge_hint: 'По умолчанию выключено. Когда включено, mvmAI может читать или изменять собственные данные пользователя в его других установленных приложениях.',
    sett_hint: 'Всё остаётся внутри mvmOS — API-ключ хранится на сервере и никогда не покидает его.',
    exec_toggle: 'Команды на сервере', exec_off: 'Только чтение', exec_confirm: 'С подтверждением', exec_auto_short: 'Автоматически',
    exec_enable_label: 'Разрешить mvmAI выполнять команды на этом сервере', exec_mode_label: 'Когда хочет выполнить команду',
    exec_mode_confirm: 'Спрашивать подтверждение для каждой команды', exec_mode_auto: 'Выполнять автоматически, без подтверждения',
    model_tool_default: '(по умолчанию инструмента)', models_found: 'Найдено моделей: {count} — изначально используется настройка инструмента по умолчанию.',
    models_failed: 'Не удалось загрузить список моделей — будет использована настройка инструмента по умолчанию.',
    models_unavailable: 'Этот CLI не предоставляет список моделей — будет использована его модель по умолчанию.',
    projects_title: 'Проекты', project_new: '+ Новый проект', no_projects: 'Пока нет проектов',
    project_name_label: 'Имя', project_path_label: 'Папка', project_browse: 'Обзор…', project_create: 'Создать',
    project_name_required: 'Имя проекта обязательно', project_path_required: 'Выберите папку',
    project_del_confirm: 'Удалить этот проект? Сама папка не будет затронута.', project_creating: 'Создание…',
    browse_title: 'Выбрать папку', browse_select: 'Выбрать эту папку', browse_up: '.. (вверх)',
    active_project: 'Проект: {name}', loading: 'Загрузка…', git_not_repo: 'Не является git-репозиторием', git_clean: 'Нет изменений', cancel: 'Отмена',
  },
  'zh-CN': {
    title: 'mvmAI', new_chat: '+ 新对话', no_sessions: '暂无对话',
    placeholder: '给 mvmAI 发消息…  (Shift+Enter 换行)', send: '发送', stop: '停止',
    thinking: '思考中…', running: '正在执行命令…',
    welcome_title: 'mvmAI', welcome_sub: '尽管问吧。',
    no_provider: '尚未配置提供商。打开 ⚙ 设置，选择提供商并输入你的 API 密钥。',
    open_settings: '⚙ 设置', settings_btn: '⚙', rename: '重命名', delete: '删除',
    del_confirm: '删除此对话？', cmd_label: '命令', reason_label: '原因',
    run_q: '要执行此命令吗？', run_yes: '执行', run_no: '跳过', output: '输出', exit_code: '退出码',
    blocked: '⛔ 已阻止', cancelled: '已被用户跳过', dangerous: '⚠ 危险',
    err: '错误',
    provider: '提供商', api_key: 'API 密钥', model: '模型 (留空为默认)',
    base_url: '自定义基础 URL (仅适用于 Custom 提供商)',
    segment_desktop: '桌面端', segment_public: '公开页面 (Premium)',
    pub_provider_label: '公开页面 AI', pub_provider_same: '(与桌面端相同)',
    pub_provider_premium_hint: '为公开页面使用不同的 AI 需要 Premium。',
    pub_bridge_label: '允许公开用户使用应用数据 API 集成',
    pub_bridge_hint: '默认关闭。开启后，mvmAI 可以读取或更改用户自己在其他已安装应用中的数据。',
    sett_hint: '一切都保留在 mvmOS 内部 — API 密钥保存在服务器上，永远不会离开。',
    exec_toggle: '服务器命令', exec_off: '只读', exec_confirm: '需确认', exec_auto_short: '自动',
    exec_enable_label: '允许 mvmAI 在此服务器上执行命令', exec_mode_label: '当它想执行命令时',
    exec_mode_confirm: '每条命令都要我确认', exec_mode_auto: '自动执行，无需确认',
    model_tool_default: '（工具默认值）', models_found: '找到 {count} 个模型 — 初始使用工具默认值。',
    models_failed: '无法加载模型列表 — 将使用工具默认值。',
    models_unavailable: '此 CLI 不提供模型列表 — 将使用其默认模型。',
    projects_title: '项目', project_new: '+ 新建项目', no_projects: '还没有项目',
    project_name_label: '名称', project_path_label: '文件夹', project_browse: '浏览…', project_create: '创建',
    project_name_required: '项目名称为必填项', project_path_required: '选择一个文件夹',
    project_del_confirm: '删除此项目？文件夹本身不会被删除。', project_creating: '创建中…',
    browse_title: '选择文件夹', browse_select: '选择此文件夹', browse_up: '..（上一级）',
    active_project: '项目：{name}', loading: '加载中…', git_not_repo: '不是 git 仓库', git_clean: '没有更改', cancel: '取消',
  },
};
function _ait(key) { const lang = window.mvmOS?.lang || 'en'; return (_mvmai18n[lang] || _mvmai18n.en)[key] || key; }

function _loadMvmaiScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src + '?_=' + Date.now();
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function _loadMvmaiWidget() {
  if (!window.MVMAI_I18N) await _loadMvmaiScript('/apps/mvmai/i18n.js');
  if (!window.MvmaiWidget) await _loadMvmaiScript('/apps/mvmai/mvmai-widget.js');
}

const _DEFAULT_PROMPT =
  'You are mvmAI. Answer clearly and concisely. Server and app access is determined only by the tools supplied by mvmAI.';

mvmOS.registerApp({
  id: 'mvmai',
  name: _ait('title'),
  icon: '🤖',
  trayable: true,
  settings: [],
  async renderSettingsExtra(wrap, saved) {
    const isBg = (window.mvmOS?.lang || 'en') === 'bg';
    const _MODELS = _MVMAI_MODELS;
    const NO_KEY = ['ollama'];
    const savedProvider = saved?.provider || 'gemini';
    const savedModel    = saved?.model    || '';

    function _savedKey(p) {
      return saved?.[`api_key_${p}`] ?? (p === savedProvider ? saved?.api_key || '' : '');
    }

    const _row = (c) => `<div style="display:flex;flex-direction:column;gap:4px">${c}</div>`;
    const _lbl = (t) => `<label style="font-size:.8rem;color:var(--text-dim)">${t}</label>`;

    // load CLI providers from backend
    let cliProviders = [];
    try {
      const r = await fetch('/api/mvmai/cli-providers');
      cliProviders = (await r.json()).cli_providers || [];
    } catch(_) {}

    // build provider options: CLI first (if any), then separator, then API
    const apiOptions = [
      { value: 'gemini',     label: 'Google Gemini' },
      { value: 'openai',     label: 'OpenAI' },
      { value: 'groq',       label: 'Groq' },
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'deepseek',   label: 'DeepSeek' },
      { value: 'qwen',       label: 'Qwen (DashScope)' },
      { value: 'mistral',    label: 'Mistral' },
      { value: 'ollama',     label: 'Ollama (local)' },
      { value: 'custom',     label: 'Custom' },
    ];

    function _buildProviderOptions(selectedValue) {
      let html = '';
      if (cliProviders.length) {
        html += `<optgroup label="${isBg ? 'Инсталирани CLI' : 'Installed CLI'}">`;
        cliProviders.forEach(p => {
          html += `<option value="${p.id}" ${selectedValue === p.id ? 'selected' : ''}>${p.name}</option>`;
        });
        html += `</optgroup><optgroup label="${isBg ? 'С API ключ' : 'With API key'}">`;
        apiOptions.forEach(p => {
          html += `<option value="${p.value}" ${selectedValue === p.value ? 'selected' : ''}>${p.label}</option>`;
        });
        html += `</optgroup>`;
      } else {
        apiOptions.forEach(p => {
          html += `<option value="${p.value}" ${selectedValue === p.value ? 'selected' : ''}>${p.label}</option>`;
        });
      }
      return html;
    }
    const providerOptionsHtml = _buildProviderOptions(savedProvider);
    const pubProviderOptionsHtml = _buildProviderOptions(saved?.pub_provider || '');

    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:4px';
    wrap.innerHTML = `
      <div style="font-weight:600;font-size:.85rem">${_ait('segment_desktop')}</div>
      ${_row(`${_lbl(isBg ? 'Провайдър' : 'Provider')}
        <select id="mvmai-provider-sel" class="s-input">${providerOptionsHtml}</select>`)}
      <div id="mvmai-key-row">
        ${_row(`${_lbl(isBg ? 'API ключ' : 'API key')}
          <input id="mvmai-key-inp" type="password" class="s-input" autocomplete="new-password">`)}
      </div>
      ${_row(`${_lbl(isBg ? 'Модел' : 'Model')}
        <select id="mvmai-model-sel" class="s-input"></select>
        <select id="mvmai-model-cli-sel" class="s-input" style="display:none"></select>
        <input id="mvmai-model-cli-inp" type="text" class="s-input" style="display:none">
        <div id="mvmai-models-status" style="font-size:.75rem;color:var(--text-dim);min-height:1.2em"></div>`)}
      <div id="mvmai-baseurl-row" style="display:none;flex-direction:column;gap:4px">
        ${_lbl(isBg ? 'Base URL (само за Custom)' : 'Base URL (Custom provider only)')}
        <input id="mvmai-baseurl-inp" type="text" class="s-input" value="${saved?.base_url || ''}">
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:4px 0;opacity:.6">
      <div id="mvmai-pub-segment" style="display:flex;flex-direction:column;gap:10px">
        <div style="font-weight:600;font-size:.85rem">${_ait('segment_public')}</div>
        ${_row(`${_lbl(_ait('pub_provider_label'))}
          <select id="mvmai-pub-provider-sel" class="s-input">
            <option value="">${_ait('pub_provider_same')}</option>
            ${pubProviderOptionsHtml}
          </select>`)}
        ${_row(`${_lbl(isBg ? 'Модел' : 'Model')}
          <select id="mvmai-pub-model-sel" class="s-input"></select>
          <select id="mvmai-pub-model-cli-sel" class="s-input" style="display:none"></select>
          <input id="mvmai-pub-model-cli-inp" type="text" class="s-input" style="display:none">
          <div id="mvmai-pub-models-status" style="font-size:.75rem;color:var(--text-dim);min-height:1.2em"></div>`)}
        ${_row(`<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="mvmai-pub-bridge-chk" ${saved?.pub_data_bridge_enabled ? 'checked' : ''}>
            ${_ait('pub_bridge_label')}
          </label>
          <div style="font-size:.74rem;color:var(--text-dim)">${_ait('pub_bridge_hint')}</div>`)}
      </div>
      <div style="font-size:.74rem;color:var(--text-dim)">${_ait('sett_hint')}</div>`;

    const provSel    = wrap.querySelector('#mvmai-provider-sel');
    const keyRow     = wrap.querySelector('#mvmai-key-row');
    const keyInp     = wrap.querySelector('#mvmai-key-inp');
    const sel        = wrap.querySelector('#mvmai-model-sel');
    const cliModelSel = wrap.querySelector('#mvmai-model-cli-sel');
    const cliModelInp = wrap.querySelector('#mvmai-model-cli-inp');
    const status     = wrap.querySelector('#mvmai-models-status');
    const baseUrlRow = wrap.querySelector('#mvmai-baseurl-row');
    const baseUrlInp = wrap.querySelector('#mvmai-baseurl-inp');

    function _isCli(p) { return p.endsWith('-cli'); }
    function _isFetch(p) { return (_MODELS[p]?.length === 0); }

    function _fillModelSelectInto(targetSel, models, current) {
      targetSel.innerHTML = `<option value="">${isBg ? '(по подразбиране)' : '(provider default)'}</option>`;
      const all = (current && !models.includes(current)) ? [current, ...models] : models;
      all.forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        if (m === current) o.selected = true;
        targetSel.appendChild(o);
      });
      if (!current) targetSel.value = '';
    }

    // Shared by the desktop and public-page model controls — refs point at
    // whichever pair of select/input/status elements is being updated, and
    // keyForFetch supplies the API key to use when a provider's model list
    // has to be fetched live (the public segment has no key input of its
    // own, so it reuses whatever key is already saved for that provider).
    async function _updateModelControls(refs, provider, current, keyForFetch) {
      const cli = _isCli(provider);
      refs.status.textContent = '';
      refs.status.style.color = '';
      if (cli) {
        refs.sel.style.display = 'none';
        refs.cliInp.style.display = 'none';
        const cliInfo = cliProviders.find(p => p.id === provider);
        const choices = (cliInfo && cliInfo.model_choices) || [];
        refs.cliSel.style.display = '';
        refs.cliSel.innerHTML = `<option value="">${_ait('model_tool_default')}</option>`;
        choices.forEach(m => {
          const option = document.createElement('option');
          option.value = m;
          option.textContent = m;
          refs.cliSel.appendChild(option);
        });
        refs.cliSel.value = choices.includes(current) ? current : '';
        if (cliInfo?.models_dynamic && choices.length) {
          refs.status.textContent = _ait('models_found').replace('{count}', choices.length);
        } else if (cliInfo?.models_dynamic) {
          refs.status.textContent = _ait('models_failed');
        } else {
          refs.status.textContent = _ait('models_unavailable');
        }
        return;
      }
      refs.sel.style.display = '';
      refs.cliSel.style.display = 'none';
      refs.cliInp.style.display = 'none';

      if (!_isFetch(provider)) {
        _fillModelSelectInto(refs.sel, _MODELS[provider], current || '');
        return;
      }
      refs.sel.innerHTML = `<option value="">${isBg ? 'Зарежда…' : 'Loading…'}</option>`;
      try {
        const res = await fetch('/api/mvmai/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, api_key: keyForFetch(provider), base_url: baseUrlInp?.value || saved?.base_url || '' }),
        });
        const d = await res.json();
        if (d.error) {
          _fillModelSelectInto(refs.sel, [], '');
          refs.status.style.color = '#e25555';
          refs.status.textContent = d.error.slice(0, 120);
          return;
        }
        _fillModelSelectInto(refs.sel, d.models, current || '');
        refs.status.textContent = `${d.models.length} ${isBg ? 'модела' : 'models'}`;
      } catch(e) {
        _fillModelSelectInto(refs.sel, [], '');
        refs.status.style.color = '#e25555';
        refs.status.textContent = e.message;
      }
    }

    async function _updateForProvider(provider, current) {
      const cli = _isCli(provider);
      keyRow.style.display     = (cli || NO_KEY.includes(provider)) ? 'none' : '';
      keyInp.value             = cli ? '' : _savedKey(provider);
      baseUrlRow.style.display = (!cli && ['ollama','custom'].includes(provider)) ? 'flex' : 'none';
      await _updateModelControls(
        { sel, cliSel: cliModelSel, cliInp: cliModelInp, status },
        provider, current,
        p => keyInp.value || _savedKey(p),
      );
    }

    _updateForProvider(savedProvider, savedModel);
    provSel.addEventListener('change', () => _updateForProvider(provSel.value, ''));
    keyInp.addEventListener('change', () => _updateForProvider(provSel.value, ''));
    baseUrlInp.addEventListener('change', () => _updateForProvider(provSel.value, ''));

    // Public-page AI is a store-premium feature: the whole segment stays
    // visible and browsable, but without premium it's locked behind
    // mvmOS.premiumGate (same pattern as mvmPasswords' TOTP setting) — the
    // actual enforcement lives server-side in apps/mvmai/premium/backend.py
    // (resolve_pub_cfg), this is only the cosmetic desktop lock. It reuses
    // the desktop's own saved API keys/base URL — there's no separate key
    // input for the public provider.
    const pubProvSel   = wrap.querySelector('#mvmai-pub-provider-sel');
    const pubSel       = wrap.querySelector('#mvmai-pub-model-sel');
    const pubCliSel    = wrap.querySelector('#mvmai-pub-model-cli-sel');
    const pubCliInp    = wrap.querySelector('#mvmai-pub-model-cli-inp');
    const pubStatus    = wrap.querySelector('#mvmai-pub-models-status');
    const pubBridgeChk = wrap.querySelector('#mvmai-pub-bridge-chk');
    const pubSegment    = wrap.querySelector('#mvmai-pub-segment');

    function _pubEffectiveProvider() { return pubProvSel.value || savedProvider; }
    async function _updatePubModel(current) {
      await _updateModelControls(
        { sel: pubSel, cliSel: pubCliSel, cliInp: pubCliInp, status: pubStatus },
        _pubEffectiveProvider(), current,
        p => _savedKey(p),
      );
    }

    const initialPubModel = saved?.pub_model !== undefined ? saved.pub_model : savedModel;
    _updatePubModel(initialPubModel);
    pubProvSel.addEventListener('change', () => _updatePubModel(''));

    if (window.mvmOS?.premiumStatus !== 'premium') {
      [pubProvSel, pubSel, pubCliSel, pubCliInp, pubBridgeChk].forEach(el => el.disabled = true);
    }
    window.mvmOS?.premiumGate?.(pubSegment, _ait('pub_provider_premium_hint'));
  },

  saveSettingsExtra(panel) {
    const provider    = panel.querySelector('#mvmai-provider-sel')?.value || 'gemini';
    const keyInp      = panel.querySelector('#mvmai-key-inp');
    const baseUrlInp  = panel.querySelector('#mvmai-baseurl-inp');
    const pubProvSel   = panel.querySelector('#mvmai-pub-provider-sel');
    const pubBridgeChk = panel.querySelector('#mvmai-pub-bridge-chk');
    const db = mvmOS.db('mvmai');
    const s = (k, v) => db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [k, JSON.stringify(v)]);
    const saves = [s('provider', provider)];
    const cli = provider.endsWith('-cli');
    const cliModelSel = panel.querySelector('#mvmai-model-cli-sel');
    const cliModelInp = panel.querySelector('#mvmai-model-cli-inp');
    let modelVal;
    if (cli) {
      if (cliModelSel && cliModelSel.style.display !== 'none') modelVal = cliModelSel.value.trim();
      else if (cliModelInp && cliModelInp.style.display !== 'none') modelVal = cliModelInp.value.trim();
    } else {
      modelVal = panel.querySelector('#mvmai-model-sel')?.value.trim();
    }
    if (modelVal !== undefined) saves.push(s('model', modelVal));
    if (keyInp)     saves.push(s(`api_key_${provider}`,  keyInp.value.trim()));
    if (baseUrlInp) saves.push(s('base_url',             baseUrlInp.value.trim()));
    if (pubProvSel) saves.push(s('pub_provider',         pubProvSel.value));

    const pubProvider = (pubProvSel && pubProvSel.value) || provider;
    const pubCli = pubProvider.endsWith('-cli');
    const pubCliModelSel = panel.querySelector('#mvmai-pub-model-cli-sel');
    const pubCliModelInp = panel.querySelector('#mvmai-pub-model-cli-inp');
    let pubModelVal;
    if (pubCli) {
      if (pubCliModelSel && pubCliModelSel.style.display !== 'none') pubModelVal = pubCliModelSel.value.trim();
      else if (pubCliModelInp && pubCliModelInp.style.display !== 'none') pubModelVal = pubCliModelInp.value.trim();
    } else {
      pubModelVal = panel.querySelector('#mvmai-pub-model-sel')?.value.trim();
    }
    if (pubModelVal !== undefined) saves.push(s('pub_model', pubModelVal));
    if (pubBridgeChk) saves.push(s('pub_data_bridge_enabled', pubBridgeChk.checked));
    return Promise.all(saves);
  },
  launch() {
    mvmOS.createWindow({
      id: 'mvmai',
      title: '🤖 ' + _ait('title'),
      icon: '🤖',
      width: 980,
      height: 640,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'mvmai' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        body.innerHTML = '<div class="mvmai-shared-root" style="height:100%"></div>';
        const root = body.querySelector('.mvmai-shared-root');
        let handle = null;

        async function start() {
          const token = localStorage.getItem('apphub_token');
          if (!token) return;
          await fetch('/api/mvmai/migrate-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
          }).catch(() => {});
          await _loadMvmaiWidget();
          handle = window.MvmaiWidget.mount(root, {
            isDesktopApp: true,
            onNeedLogin() { AppHub.requireLogin(() => start()); },
          });
        }

        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => {
          if (typeof AppHub !== 'undefined') AppHub.requireLogin(() => start());
          else start();
        });

        const observer = new MutationObserver(() => {
          if (!document.body.contains(root)) {
            if (handle) handle.destroy();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
    });
  },
});

// ── Core ────────────────────────────────────────────────────────────────────────
const AI = (() => {
  const _db = mvmOS.db('mvmai');
  let _root = null;
  let _sessionId = null;
  let _busy = false;
  let _cfg = {};
  let _access = { apps_hub_logged_in: false, is_admin: false };
  let _activeProject = null;   // project tied to the current chat session — fixed at creation
  let _projects = [];

  function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── tiny markdown renderer ──────────────────────────────────────────────────
  function _md(src) {
    const blocks = [];
    let text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre class="mvmai-code"><code>${_esc(code.replace(/\n$/, ''))}</code></pre>`);
      return `\x00${blocks.length - 1}\x00`;
    });
    text = _esc(text);
    text = text.replace(/`([^`]+)`/g, '<code class="mvmai-inline">$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h3>$1</h3>');
    text = text.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, m => `<ul>${m}</ul>`).replace(/<\/ul>\s*<ul>/g, '');
    text = text.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    text = text.replace(/\x00(\d+)\x00/g, (_, i) => blocks[+i]);
    return text;
  }

  function _headers(extra = {}) {
    const token = localStorage.getItem('apphub_token');
    return Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Pub-Token': token } : {}, extra);
  }

  async function _api(path, body) {
    const res = await fetch('/api/mvmai' + path, {
      method: 'POST', headers: _headers(), body: JSON.stringify(body),
    });
    return res.json();
  }

  async function _apiGet(path) {
    const res = await fetch('/api/mvmai' + path, { headers: _headers() });
    return res.json();
  }

  async function _apiDelete(path) {
    const res = await fetch('/api/mvmai' + path, { method: 'DELETE', headers: _headers() });
    return res.json();
  }

  async function _loadAccess() {
    try {
      const res = await fetch('/api/mvmai/access', { headers: _headers() });
      _access = res.ok ? await res.json() : { apps_hub_logged_in: false, is_admin: false };
    } catch (_) {
      _access = { apps_hub_logged_in: false, is_admin: false };
    }
  }

  // ── DB helpers ────────────────────────────────────────────────────────────────
  const _PROVIDER_NAMES = {
    gemini: 'Gemini', openai: 'OpenAI', groq: 'Groq', openrouter: 'OpenRouter',
    deepseek: 'DeepSeek', qwen: 'Qwen', mistral: 'Mistral', ollama: 'Ollama', custom: 'Custom',
    'claude-cli': 'Claude CLI', 'gemini-cli': 'Gemini CLI', 'ollama-cli': 'Ollama CLI',
    'sgpt-cli': 'shell-gpt', 'aichat-cli': 'aichat', 'llm-cli': 'llm', 'gpt4all-cli': 'GPT4All CLI',
    'codex-cli': 'Codex CLI',
  };

  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    const cfg = {};
    rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch (_) { cfg[r.key] = r.value; } });
    _cfg = cfg;
    _updatePlaceholder();
    _updateModelSelect();
    _updateExecBtn();
    return cfg;
  }

  async function _updateModelSelect() {
    const sel = _root?.querySelector('.mvmai-model-quick');
    if (!sel) return;
    const provider = _cfg.provider || 'gemini';
    if (provider.endsWith('-cli')) { sel.style.display = 'none'; return; }
    sel.style.display = '';
    const current  = _cfg.model || '';
    let models = _MVMAI_MODELS[provider] || [];

    if (models.length === 0) {
      // fetch-based provider — load from API (uses saved key from DB)
      sel.innerHTML = `<option value="">${window.mvmOS?.lang === 'bg' ? 'Зарежда…' : 'Loading…'}</option>`;
      try {
        const res = await fetch('/api/mvmai/models', {
          method: 'POST', headers: _headers(),
          body: JSON.stringify({ provider }),
        });
        const d = await res.json();
        models = d.error ? [] : (d.models || []);
      } catch(_) { models = []; }
    }

    sel.innerHTML = `<option value="">${window.mvmOS?.lang === 'bg' ? '(по подразбиране)' : '(default)'}</option>`;
    const all = (current && !models.includes(current)) ? [current, ...models] : models;
    all.forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      if (m === current) o.selected = true;
      sel.appendChild(o);
    });
    if (!current) sel.value = '';
  }

  function _updateExecBtn() {
    const btn = _root?.querySelector('.mvmai-exec-btn');
    if (!btn) return;
    const enabled = !!_cfg.exec_enabled;
    const auto = !!_cfg.exec_auto;
    btn.classList.toggle('on', enabled && !auto);
    btn.classList.toggle('auto', enabled && auto);
    btn.querySelector('.mvmai-exec-state').textContent = !enabled ? _ait('exec_off') : (auto ? _ait('exec_auto_short') : _ait('exec_confirm'));
    const mode = !enabled ? 'readonly' : (auto ? 'auto' : 'confirm');
    const radio = _root.querySelector(`.mvmai-exec-menu input[name="mvmai-exec-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  async function _saveExecMode(mode) {
    _cfg.exec_enabled = mode !== 'readonly';
    _cfg.exec_auto = mode === 'auto';
    await Promise.all([
      _db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['exec_enabled', JSON.stringify(_cfg.exec_enabled)]),
      _db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['exec_auto', JSON.stringify(_cfg.exec_auto)]),
    ]);
    _updateExecBtn();
  }

  function _updatePlaceholder() {
    const ta = _root?.querySelector('.mvmai-input textarea');
    if (!ta) return;
    const providerName = _PROVIDER_NAMES[_cfg.provider] || _cfg.provider || 'AI';
    const label = (_cfg.model && !_cfg.provider?.endsWith('-cli')) ? _cfg.model : providerName;
    ta.placeholder = `Message ${label}…  (Shift+Enter ${window.mvmOS?.lang === 'bg' ? 'за нов ред' : 'for newline'})`;
  }
  async function _listSessions() {
    return _db.query('SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC');
  }
  async function _getSessionProjectId(sid) {
    const rows = await _db.query('SELECT project_id FROM sessions WHERE id=?', [sid]);
    return (rows[0] && rows[0].project_id) || null;
  }
  async function _loadMessages(sid, { forDisplay = false } = {}) {
    const rows = await _db.query('SELECT role, content FROM messages WHERE session_id=? ORDER BY id', [sid]);
    const all = rows.map(r => { try { return JSON.parse(r.content); } catch (_) { return { role: r.role, content: r.content }; } });
    if (forDisplay) return all.filter(m => m.role !== 'summary');
    // for model: one summary (if exists) + last 20 non-summary messages
    const summary = all.find(m => m.role === 'summary');
    const nonSummary = all.filter(m => m.role !== 'summary');
    const recent = nonSummary.slice(-20);
    return [...(summary ? [summary] : []), ...recent];
  }

  const _COMPACT_THRESHOLD = 40;

  async function _maybeCompact(sid) {
    const rows = await _db.query('SELECT id, role, content FROM messages WHERE session_id=? ORDER BY id', [sid]);
    const all = rows.map(r => { let msg; try { msg = JSON.parse(r.content); } catch (_) { msg = { role: r.role, content: r.content }; } return { _rowId: r.id, ...msg }; });
    const prevSummary = all.find(m => m.role === 'summary');
    const nonSummary = all.filter(m => m.role !== 'summary');
    if (nonSummary.length < _COMPACT_THRESHOLD) return;
    const toSummarize = nonSummary.slice(0, nonSummary.length - 20);
    if (!toSummarize.length) return;

    const prevText = prevSummary?.content || null;
    const historyLines = toSummarize
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const compactInstruction = prevText
      ? `Here is the previous summary:\n${prevText}\n\nHere is the new conversation to add to it:\n${historyLines}\n\nWrite an updated single summary covering everything. Be concise but include key topics, decisions, and context.`
      : `Summarize this conversation concisely. Include key topics, decisions, and important context:\n${historyLines}`;

    const summaryPrompt = [
      _systemMsg(),
      { role: 'user', content: compactInstruction },
    ];

    let summaryText = null;
    try {
      if (_cfg.provider?.endsWith('-cli')) {
        const res = await fetch('/api/mvmai/cli-chat', {
          method: 'POST', headers: _headers(),
          body: JSON.stringify({ provider_id: _cfg.provider, messages: summaryPrompt }),
        });
        const d = await res.json();
        summaryText = d.content || null;
      } else {
        const res = await _api('/chat', { messages: summaryPrompt, tools_enabled: false });
        summaryText = res.message?.content || null;
      }
    } catch(_) {}

    if (!summaryText) return;
    if (prevSummary) await _db.run('DELETE FROM messages WHERE id=?', [prevSummary._rowId]);
    await _saveMessage(sid, { role: 'summary', content: summaryText });
  }
  async function _saveMessage(sid, msg) {
    const now = Math.floor(Date.now() / 1000);
    await _db.run('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)',
      [sid, msg.role, JSON.stringify(msg), now]);
    await _db.run('UPDATE sessions SET updated_at=? WHERE id=?', [now, sid]);
  }
  async function _newSession(firstText) {
    const id = 's' + Date.now() + Math.random().toString(36).slice(2, 6);
    const now = Math.floor(Date.now() / 1000);
    const title = (firstText || 'New chat').trim().slice(0, 42) || 'New chat';
    await _db.run('INSERT INTO sessions (id, title, project_id, created_at, updated_at) VALUES (?,?,?,?,?)',
      [id, title, _activeProject ? _activeProject.id : null, now, now]);
    return id;
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  function _msgEl() { return _root.querySelector('.mvmai-messages'); }
  function _scroll() { const m = _msgEl(); if (m) m.scrollTop = m.scrollHeight; }

  function _addBubble(role, html) {
    const el = document.createElement('div');
    el.className = 'mvmai-msg mvmai-' + role;
    el.innerHTML = `<div class="mvmai-bubble">${html}</div>`;
    _msgEl().appendChild(el);
    _scroll();
    return el;
  }

  function _addCommandCard(command, reason) {
    const el = document.createElement('div');
    el.className = 'mvmai-msg mvmai-tool';
    el.innerHTML = `
      <div class="mvmai-cmdcard">
        <div class="mvmai-cmd-head"><span class="mvmai-cmd-tag">⌨ ${_ait('cmd_label')}</span>${reason ? `<span class="mvmai-cmd-reason">${_esc(reason)}</span>` : ''}</div>
        <pre class="mvmai-code mvmai-cmd"><code>${_esc(command)}</code></pre>
        <div class="mvmai-cmd-actions"></div>
        <div class="mvmai-cmd-output"></div>
      </div>`;
    _msgEl().appendChild(el);
    _scroll();
    return el;
  }

  function _renderOutput(card, result) {
    const out = card.querySelector('.mvmai-cmd-output');
    if (result.blocked) {
      out.innerHTML = `<div class="mvmai-blocked">${_ait('blocked')} — ${_esc(result.reason || '')}</div>`;
    } else if (result.cancelled) {
      out.innerHTML = `<div class="mvmai-blocked">${_ait('cancelled')}</div>`;
    } else {
      const parts = [];
      if (result.stdout) parts.push(`<pre class="mvmai-code"><code>${_esc(result.stdout)}</code></pre>`);
      if (result.stderr) parts.push(`<pre class="mvmai-code mvmai-stderr"><code>${_esc(result.stderr)}</code></pre>`);
      const codeBadge = `<span class="mvmai-exit ${result.code === 0 ? 'ok' : 'bad'}">${_ait('exit_code')} ${result.code}</span>`;
      out.innerHTML = `<div class="mvmai-out-head">${_ait('output')} ${codeBadge}</div>${parts.join('') || '<div class="mvmai-empty">∅</div>'}`;
    }
    _scroll();
  }

  // ── command execution with confirmation UI ────────────────────────────────────
  function _execWithUI(command, reason) {
    return new Promise(async (resolve) => {
      const card = _addCommandCard(command, reason);
      const first = await _api('/exec', { command, confirmed: false, project_id: _activeProject ? _activeProject.id : null });
      if (first.blocked) { _renderOutput(card, first); return resolve({ blocked: true, reason: first.reason }); }
      if (first.pending) {
        const actions = card.querySelector('.mvmai-cmd-actions');
        if (first.is_dangerous) actions.innerHTML = `<span class="mvmai-danger">${_ait('dangerous')}</span>`;
        const yes = document.createElement('button'); yes.className = 's-btn s-btn-sm mvmai-run-yes'; yes.textContent = _ait('run_yes');
        const no = document.createElement('button'); no.className = 's-btn s-btn-sm'; no.textContent = _ait('run_no');
        actions.appendChild(yes); actions.appendChild(no);
        yes.addEventListener('click', async () => {
          actions.innerHTML = `<span class="mvmai-running">${_ait('running')}</span>`;
          const r = await _api('/exec', { command, confirmed: true, project_id: _activeProject ? _activeProject.id : null });
          actions.innerHTML = '';
          _renderOutput(card, r);
          resolve(r);
        });
        no.addEventListener('click', () => { actions.innerHTML = ''; _renderOutput(card, { cancelled: true }); resolve({ cancelled: true }); });
        return; // wait for user
      }
      // ran immediately
      _renderOutput(card, first);
      resolve(first);
    });
  }

  async function _inspectWithUI(args) {
    const command = args.command || '';
    const card = _addCommandCard(command, args.reason || 'Read-only server inspection');
    const data = await _api('/inspect', {
      command, reason: args.reason || '', project_id: _activeProject ? _activeProject.id : null,
    });
    const result = data.error ? { stdout: '', stderr: data.error, code: 1 } : data.result;
    _renderOutput(card, result);
    return data.error ? { error: data.error } : data.result;
  }

  // ── conversation turn ──────────────────────────────────────────────────────────
  function _systemMsg() {
    return { role: 'system', content: _DEFAULT_PROMPT };
  }

  async function _runTurnCli() {
    const history = await _loadMessages(_sessionId);
    let msgs = [_systemMsg(), ...history];
    let status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);

    for (let i = 0; i < 10; i++) {
      let d;
      try {
        const res = await fetch('/api/mvmai/cli-chat', {
          method: 'POST', headers: _headers(),
          body: JSON.stringify({ provider_id: _cfg.provider, messages: msgs }),
        });
        d = await res.json();
      } catch(e) {
        status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(e.message)}</span>`;
        _scroll();
        return;
      }
      if (d.error) { status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(d.error)}</span>`; _scroll(); return; }

      const msg = { role: 'assistant', content: d.content || null, ...(d.tool_calls ? { tool_calls: d.tool_calls } : {}) };
      msgs.push(msg);
      await _saveMessage(_sessionId, { ...msg, _model: _cfg.provider });

      if (d.tool_calls && d.tool_calls.length) {
        if (msg.content && msg.content.trim()) status.querySelector('.mvmai-bubble').innerHTML = _md(msg.content);
        else status.remove();
        for (const tc of d.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          const result = tc.function.name === 'inspect_server'
            ? await _inspectWithUI(args)
            : await _execWithUI(args.command || '', args.reason || '');
          const toolMsg = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
          msgs.push(toolMsg);
          await _saveMessage(_sessionId, toolMsg);
        }
        status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);
        continue;
      }

      status.querySelector('.mvmai-bubble').innerHTML = `<div class="mvmai-model-label">${_esc(_cfg.provider)}</div>` + _md(d.content || '');
      await _maybeCompact(_sessionId);
      _scroll();
      return;
    }
    status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: too many steps</span>`;
    _scroll();
  }

  async function _runTurn() {
    if (_cfg.provider?.endsWith('-cli')) return _runTurnCli();
    const history = await _loadMessages(_sessionId);
    let apiMsgs = [_systemMsg(), ...history];
    let status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);

    for (let i = 0; i < 10; i++) {
      const res = await _api('/chat', { messages: apiMsgs, project_id: _activeProject ? _activeProject.id : null });
      if (res.error) { status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: ${_esc(res.error)}</span>`; return; }
      const msg = res.message;
      const msgWithModel = { ...msg, _model: _cfg.model || _cfg.provider || '' };
      apiMsgs.push(msg);
      await _saveMessage(_sessionId, msgWithModel);

      if (msg.tool_calls && msg.tool_calls.length) {
        if (msg.content && msg.content.trim()) status.querySelector('.mvmai-bubble').innerHTML = _md(msg.content);
        else status.remove();
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          const result = tc.function.name === 'inspect_server'
            ? await _inspectWithUI(args)
            : await _execWithUI(args.command || '', args.reason || '');
          const toolMsg = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
          apiMsgs.push(toolMsg);
          await _saveMessage(_sessionId, toolMsg);
        }
        status = _addBubble('assistant', `<span class="mvmai-typing">${_ait('thinking')}</span>`);
        continue;
      }
      const modelLabel = _cfg.model || _cfg.provider || '';
      if (modelLabel) {
        const bubbleEl = status.querySelector('.mvmai-bubble');
        bubbleEl.innerHTML = `<div class="mvmai-model-label">${_esc(modelLabel)}</div>` + _md(msg.content || '');
      } else {
        status.querySelector('.mvmai-bubble').innerHTML = _md(msg.content || '');
      }
      _scroll();
      await _maybeCompact(_sessionId);
      return;
    }
    status.querySelector('.mvmai-bubble').innerHTML = `<span class="mvmai-err">${_ait('err')}: too many steps</span>`;
  }

  // ── send ──────────────────────────────────────────────────────────────────────
  async function _send() {
    if (_busy) return;
    const ta = _root.querySelector('.mvmai-input textarea');
    const text = ta.value.trim();
    if (!text) return;
    const isCli = _cfg.provider?.endsWith('-cli');
    if (!_cfg.provider || (!isCli && _cfg.provider !== 'ollama' && !(_cfg[`api_key_${_cfg.provider}`] || _cfg.api_key))) {
      _addBubble('assistant', `<span class="mvmai-err">${_ait('no_provider')}</span>`);
      return;
    }
    _busy = true;
    ta.value = ''; ta.style.height = 'auto';
    _root.querySelector('.mvmai-welcome')?.remove();

    if (!_sessionId) { _sessionId = await _newSession(text); await _renderSessions(); }
    _addBubble('user', _md(text));
    await _saveMessage(_sessionId, { role: 'user', content: text });

    try { await _runTurn(); }
    catch (e) { _addBubble('assistant', `<span class="mvmai-err">${_ait('err')}: ${_esc(e.message || e)}</span>`); }
    finally { _busy = false; await _renderSessions(); ta.focus(); }
  }

  // ── session rendering / loading ───────────────────────────────────────────────
  async function _renderSessions() {
    const list = _root.querySelector('.mvmai-sessions');
    const sessions = await _listSessions();
    if (!sessions.length) { list.innerHTML = `<div class="mvmai-no-sessions">${_ait('no_sessions')}</div>`; return; }
    list.innerHTML = '';
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'mvmai-session' + (s.id === _sessionId ? ' active' : '');
      row.innerHTML = `<span class="mvmai-s-title">${_esc(s.title)}</span><button class="mvmai-s-del" title="${_ait('delete')}">✕</button>`;
      row.querySelector('.mvmai-s-title').addEventListener('click', () => _openSession(s.id));
      row.querySelector('.mvmai-s-del').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(_ait('del_confirm'))) return;
        await _db.run('DELETE FROM messages WHERE session_id=?', [s.id]);
        await _db.run('DELETE FROM sessions WHERE id=?', [s.id]);
        if (_sessionId === s.id) { _sessionId = null; _renderChat([]); }
        _renderSessions();
      });
      list.appendChild(row);
    });
  }

  function _renderChat(history) {
    const m = _msgEl();
    m.innerHTML = '';
    if (!history.length) {
      m.innerHTML = `<div class="mvmai-welcome"><div class="mvmai-welcome-icon">🤖</div><h2>${_ait('welcome_title')}</h2><p>${_ait('welcome_sub')}</p></div>`;
      return;
    }
    // group tool results onto their command cards by tool_call_id
    const cardByCall = {};
    history.forEach(msg => {
      if (msg.role === 'user') _addBubble('user', _md(msg.content || ''));
      else if (msg.role === 'assistant') {
        if (msg.content && msg.content.trim()) {
          const label = msg._model ? `<div class="mvmai-model-label">${_esc(msg._model)}</div>` : '';
          _addBubble('assistant', label + _md(msg.content));
        }
        (msg.tool_calls || []).forEach(tc => {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          const label = tc.function.name === 'inspect_server'
            ? (args.command || 'inspect_server')
            : (args.command || '');
          cardByCall[tc.id] = _addCommandCard(label, args.reason || '');
        });
      } else if (msg.role === 'tool') {
        const card = cardByCall[msg.tool_call_id];
        if (card) { let r = {}; try { r = JSON.parse(msg.content); } catch (_) {} _renderOutput(card, r); }
      }
    });
    _scroll();
  }

  async function _openSession(sid) {
    _sessionId = sid;
    const pid = await _getSessionProjectId(sid);
    _activeProject = pid ? (_projects.find(p => p.id === pid) || null) : null;
    _renderProjects();
    _updateProjectBar();
    _renderChat(await _loadMessages(sid, { forDisplay: true }));
    await _renderSessions();
    _root.querySelector('.mvmai-sidebar')?.classList.remove('mobile-open');
    _root.querySelector('.as-sidebar-overlay')?.remove();
  }

  // ── projects ────────────────────────────────────────────────────────────────────
  async function _loadProjects() {
    try { const d = await _apiGet('/projects'); _projects = d.projects || []; } catch (_) { _projects = []; }
    return _projects;
  }

  function _renderProjects() {
    const list = _root && _root.querySelector('.mvmai-projects-list');
    if (!list) return;
    if (!_projects.length) { list.innerHTML = `<div class="mvmai-no-sessions">${_ait('no_projects')}</div>`; return; }
    list.innerHTML = '';
    _projects.forEach(p => {
      const row = document.createElement('div');
      row.className = 'mvmai-project' + (_activeProject && _activeProject.id === p.id ? ' active' : '');
      row.innerHTML = `<span class="mvmai-p-title">📁 ${_esc(p.name)}</span><button class="mvmai-s-del" title="${_ait('delete')}">✕</button>`;
      row.querySelector('.mvmai-p-title').addEventListener('click', () => _selectProject(p));
      row.querySelector('.mvmai-s-del').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(_ait('project_del_confirm'))) return;
        await _apiDelete('/projects/' + p.id);
        if (_activeProject && _activeProject.id === p.id) { _activeProject = null; _updateProjectBar(); }
        await _loadProjects(); _renderProjects();
      });
      list.appendChild(row);
    });
  }

  function _selectProject(p) {
    _activeProject = (_activeProject && _activeProject.id === p.id) ? null : p;
    _renderProjects();
    _updateProjectBar();
  }

  function _updateProjectBar() {
    const bar = _root && _root.querySelector('.mvmai-project-bar');
    if (!bar) return;
    _root.querySelector('.mvmai-filetree-dropdown')?.remove();
    if (!_activeProject) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.querySelector('.mvmai-project-name').textContent = _ait('active_project').replace('{name}', _activeProject.name);
    bar.querySelector('.mvmai-project-branch').textContent = '';
  }

  async function _toggleFileTree() {
    const existing = _root.querySelector('.mvmai-filetree-dropdown');
    if (existing) { existing.remove(); return; }
    if (!_activeProject) return;
    const bar = _root.querySelector('.mvmai-project-bar');
    const dd = document.createElement('div');
    dd.className = 'mvmai-filetree-dropdown';
    dd.innerHTML = `<div class="mvmai-no-sessions">${_ait('loading')}</div>`;
    bar.appendChild(dd);
    let git = { is_repo: false };
    try { git = await _apiGet('/projects/' + _activeProject.id + '/git-status'); } catch (_) {}
    bar.querySelector('.mvmai-project-branch').textContent = git.is_repo ? ('⎇ ' + git.branch) : _ait('git_not_repo');
    const statusMap = {};
    (git.added || []).forEach(f => { statusMap[f] = 'A'; });
    (git.modified || []).forEach(f => { statusMap[f] = 'M'; });
    (git.deleted || []).forEach(f => { statusMap[f] = 'D'; });
    (git.untracked || []).forEach(f => { statusMap[f] = 'U'; });
    dd.innerHTML = '';
    await _renderDirEntries(_activeProject.path, dd, statusMap, _activeProject.path);
    if (!dd.children.length) dd.innerHTML = `<div class="mvmai-no-sessions">${_ait('git_clean')}</div>`;
    setTimeout(() => {
      const close = e => {
        if (!dd.contains(e.target) && !e.target.closest('.mvmai-files-toggle')) {
          dd.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  async function _renderDirEntries(dirPath, container, statusMap, rootPath) {
    let entries = [];
    try {
      const res = await fetch('/api/files?path=' + encodeURIComponent(dirPath), { headers: _headers() });
      const data = await res.json();
      entries = data.entries || data.files || data || [];
    } catch (_) {}
    entries = entries.filter(f => !f.name.startsWith('.'));
    entries.sort((a, b) => ((a.type === 'dir') === (b.type === 'dir')) ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
    entries.forEach(f => {
      const full = dirPath.replace(/\/$/, '') + '/' + f.name;
      const rel = full.slice(rootPath.length + 1);
      const row = document.createElement('div');
      row.className = f.type === 'dir' ? 'mvmai-ft-dir' : 'mvmai-ft-file';
      const badge = statusMap[rel] ? `<span class="mvmai-ft-badge mvmai-ft-${statusMap[rel]}">${statusMap[rel]}</span>` : '';
      row.innerHTML = `<span class="mvmai-ft-name">${f.type === 'dir' ? '📁' : '📄'} ${_esc(f.name)}</span>${badge}`;
      if (f.type === 'dir') {
        row.addEventListener('click', async e => {
          e.stopPropagation();
          const next = row.nextElementSibling;
          if (next && next.classList.contains('mvmai-ft-children')) { next.remove(); return; }
          const sub = document.createElement('div');
          sub.className = 'mvmai-ft-children';
          row.after(sub);
          await _renderDirEntries(full, sub, statusMap, rootPath);
        });
      } else {
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (typeof CodeEditor !== 'undefined') CodeEditor.openFile(full);
        });
      }
      container.appendChild(row);
    });
  }

  function _showFolderPicker(startPath, onSelect) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100';
    overlay.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:420px;max-width:92%;max-height:70%;display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:600;font-size:.95rem">${_ait('browse_title')}</div>
      <div class="mvmai-browse-path" style="font-size:.76rem;color:var(--text-dim);font-family:monospace;overflow-wrap:anywhere"></div>
      <div class="mvmai-browse-list" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:6px;min-height:200px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="s-btn mvmai-browse-cancel">${_ait('cancel')}</button>
        <button class="s-btn mvmai-browse-select" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_ait('browse_select')}</button>
      </div></div>`;
    _root.appendChild(overlay);
    let current = startPath || '/';

    async function load(path) {
      const data = await _apiGet('/browse?path=' + encodeURIComponent(path));
      if (data.error) return;
      current = data.path;
      overlay.querySelector('.mvmai-browse-path').textContent = current;
      const list = overlay.querySelector('.mvmai-browse-list');
      list.innerHTML = '';
      if (data.parent) {
        const up = document.createElement('div');
        up.className = 'mvmai-browse-row';
        up.textContent = _ait('browse_up');
        up.addEventListener('click', () => load(data.parent));
        list.appendChild(up);
      }
      (data.dirs || []).forEach(name => {
        const row = document.createElement('div');
        row.className = 'mvmai-browse-row';
        row.textContent = '📁 ' + name;
        row.addEventListener('click', () => load(current.replace(/\/$/, '') + '/' + name));
        list.appendChild(row);
      });
    }
    load(current);

    overlay.querySelector('.mvmai-browse-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.mvmai-browse-select').addEventListener('click', () => {
      onSelect(current);
      overlay.remove();
    });
  }

  function _showNewProjectDialog() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    overlay.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:380px;max-width:92%;display:flex;flex-direction:column;gap:12px">
      <div style="font-weight:600;font-size:.95rem">${_ait('project_new')}</div>
      <div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">${_ait('project_name_label')}</div>
      <input class="s-input mvmai-proj-name" style="width:100%;box-sizing:border-box"></div>
      <div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">${_ait('project_path_label')}</div>
      <div style="display:flex;gap:6px">
        <input class="s-input mvmai-proj-path" style="flex:1;box-sizing:border-box" readonly>
        <button class="s-btn mvmai-proj-browse">${_ait('project_browse')}</button>
      </div></div>
      <div class="mvmai-proj-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="s-btn mvmai-proj-cancel">${_ait('cancel')}</button>
      <button class="s-btn mvmai-proj-create" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_ait('project_create')}</button>
      </div></div>`;
    _root.appendChild(overlay);
    overlay.querySelector('.mvmai-proj-name').focus();
    overlay.querySelector('.mvmai-proj-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.mvmai-proj-browse').addEventListener('click', () => {
      _showFolderPicker(overlay.querySelector('.mvmai-proj-path').value || '/', chosen => {
        overlay.querySelector('.mvmai-proj-path').value = chosen;
      });
    });
    overlay.querySelector('.mvmai-proj-create').addEventListener('click', async function () {
      const name = overlay.querySelector('.mvmai-proj-name').value.trim();
      const path = overlay.querySelector('.mvmai-proj-path').value.trim();
      const err = overlay.querySelector('.mvmai-proj-err');
      if (!name) { err.textContent = _ait('project_name_required'); err.style.display = 'block'; return; }
      if (!path) { err.textContent = _ait('project_path_required'); err.style.display = 'block'; return; }
      this.disabled = true; this.textContent = _ait('project_creating');
      const r = await _api('/projects', { name, path });
      if (r.error) {
        err.textContent = r.error; err.style.display = 'block';
        this.disabled = false; this.textContent = _ait('project_create');
        return;
      }
      overlay.remove();
      await _loadProjects(); _renderProjects();
    });
  }

  // ── mount ───────────────────────────────────────────────────────────────────────
  async function mount(body) {
    _root = body;
    await _loadAccess();
    body.innerHTML = `
      <div class="mvmai-root">
        <aside class="as-sidebar mvmai-sidebar">
          <button class="s-btn mvmai-new">${_ait('new_chat')}</button>
          <select class="mvmai-model-quick" title="Model"></select>
          ${_access.is_admin ? `<div class="mvmai-exec-wrap">
            <button class="s-btn mvmai-exec-btn" title="${_ait('exec_toggle')}">⚡ <span class="mvmai-exec-state"></span></button>
            <div class="mvmai-exec-menu" hidden>
              <div class="mvmai-exec-mode-label">${_ait('exec_mode_label')}</div>
              <label class="mvmai-exec-row"><input type="radio" name="mvmai-exec-mode" value="readonly"> ${_ait('exec_off')}</label>
              <label class="mvmai-exec-row"><input type="radio" name="mvmai-exec-mode" value="confirm"> ${_ait('exec_mode_confirm')}</label>
              <label class="mvmai-exec-row"><input type="radio" name="mvmai-exec-mode" value="auto"> ${_ait('exec_mode_auto')}</label>
            </div>
          </div>` : ''}
          <div class="mvmai-sessions"></div>
          ${_access.is_admin ? `<div class="mvmai-projects">
            <div class="mvmai-projects-head">
              <span>${_ait('projects_title')}</span>
              <button class="s-btn s-btn-sm mvmai-project-new" title="${_ait('project_new')}">+</button>
            </div>
            <div class="mvmai-projects-list"></div>
          </div>` : ''}
        </aside>
        <main class="mvmai-main">
          <div class="mvmai-project-bar" hidden>
            <span class="mvmai-project-name"></span>
            <span class="mvmai-project-branch"></span>
            <button class="s-btn s-btn-sm mvmai-files-toggle">📁</button>
          </div>
          <div class="mvmai-messages"></div>
          <div class="mvmai-input">
            <textarea rows="1" placeholder="${_ait('placeholder')}"></textarea>
            <button class="mvmai-send" title="${_ait('send')}">➤</button>
          </div>
        </main>
      </div>`;

    await _loadCfg();
    _updatePlaceholder();
    _renderChat([]);
    await _renderSessions();
    if (_access.is_admin) {
      await _loadProjects();
      _renderProjects();
      body.querySelector('.mvmai-project-new').addEventListener('click', _showNewProjectDialog);
      body.querySelector('.mvmai-files-toggle').addEventListener('click', e => { e.stopPropagation(); _toggleFileTree(); });
    }
    _updateProjectBar();

    body.querySelector('.mvmai-new').addEventListener('click', () => { _sessionId = null; _renderChat([]); _renderSessions(); body.querySelector('textarea').focus(); });

    const ta = body.querySelector('textarea');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); } });
    body.querySelector('.mvmai-send').addEventListener('click', _send);

    body.querySelector('.mvmai-model-quick').addEventListener('change', async e => {
      const model = e.target.value;
      _cfg.model = model;
      _updatePlaceholder();
      await _db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['model', JSON.stringify(model)]);
    });

    const execWrap = body.querySelector('.mvmai-exec-wrap');
    const execMenu = body.querySelector('.mvmai-exec-menu');
    if (execWrap && execMenu) {
      body.querySelector('.mvmai-exec-btn').addEventListener('click', e => {
        e.stopPropagation();
        execMenu.hidden = !execMenu.hidden;
      });
      document.addEventListener('click', e => { if (!execWrap.contains(e.target)) execMenu.hidden = true; });
      body.querySelectorAll('.mvmai-exec-menu input[name="mvmai-exec-mode"]').forEach(r => {
        r.addEventListener('change', e => { if (e.target.checked) _saveExecMode(e.target.value); });
      });
    }

    window.addEventListener('settings-changed', e => { if (e.detail?.app === 'mvmai') _loadCfg(); });
    window.mvmOS?.onLangChange?.(() => { /* keep current chat; labels update on reopen */ });
    mvmOS.initMobileSidebar?.(body);
    setTimeout(() => ta.focus(), 50);
  }

  return { mount };
})();
