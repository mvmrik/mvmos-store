(function () {
  var tables = {
    en: {
      io_title: 'Image Optimizer', io_subtitle: 'Convert and optimise images privately in your browser.',
      io_drop_title: 'Drop images here', io_drop_hint: 'or click to choose JPEG, PNG or WebP files',
      io_format: 'Output format', io_format_webp: 'WebP', io_format_original: 'Original format', io_quality: 'Quality',
      io_processing: 'Processing {done} of {total}', io_ready: 'Ready for another batch',
      io_download_all: 'Download all as ZIP', io_clear: 'Clear results', io_privacy: 'Images stay on this device and are never uploaded.',
      io_preview: 'Preview', io_file: 'File', io_before: 'Before', io_after: 'After', io_savings: 'Savings', io_action: 'Action',
      io_download: 'Download', io_duplicate: 'A result named {name} already exists.', io_error: 'Could not process {name}.',
      io_unsupported: '{name} is not a supported JPEG, PNG or WebP image.', io_png_passthrough: 'Original PNG at 100% is kept without re-encoding.',
      io_no_results: 'Processed images will appear here.', io_login: 'Sign in to Apps Hub to use Image Optimizer.',
      io_zip_error: 'Could not create the ZIP archive.', io_open_preview: 'Open preview of {name}', io_select_files: 'Choose images'
    },
    bg: {
      io_title: 'Оптимизатор за изображения', io_subtitle: 'Конвертирай и оптимизирай изображения сигурно в браузъра.',
      io_drop_title: 'Пусни изображенията тук', io_drop_hint: 'или кликни, за да избереш JPEG, PNG или WebP файлове',
      io_format: 'Изходен формат', io_format_webp: 'WebP', io_format_original: 'Оригинален формат', io_quality: 'Качество',
      io_processing: 'Обработване на {done} от {total}', io_ready: 'Готово за нова група',
      io_download_all: 'Свали всички като ZIP', io_clear: 'Изчисти резултатите', io_privacy: 'Изображенията остават на това устройство и никога не се качват.',
      io_preview: 'Преглед', io_file: 'Файл', io_before: 'Преди', io_after: 'След', io_savings: 'Оптимизация', io_action: 'Действие',
      io_download: 'Свали', io_duplicate: 'Вече има резултат с име {name}.', io_error: 'Грешка при обработване на {name}.',
      io_unsupported: '{name} не е поддържано JPEG, PNG или WebP изображение.', io_png_passthrough: 'Оригинален PNG при 100% се запазва без повторно кодиране.',
      io_no_results: 'Обработените изображения ще се появят тук.', io_login: 'Влез в Apps Hub, за да използваш оптимизатора.',
      io_zip_error: 'ZIP архивът не можа да бъде създаден.', io_open_preview: 'Отвори преглед на {name}', io_select_files: 'Избери изображения'
    },
    de: {
      io_title: 'Bildoptimierer', io_subtitle: 'Bilder privat im Browser konvertieren und optimieren.',
      io_drop_title: 'Bilder hier ablegen', io_drop_hint: 'oder klicken, um JPEG-, PNG- oder WebP-Dateien auszuwählen',
      io_format: 'Ausgabeformat', io_format_webp: 'WebP', io_format_original: 'Originalformat', io_quality: 'Qualität',
      io_processing: '{done} von {total} werden verarbeitet', io_ready: 'Bereit für einen weiteren Stapel',
      io_download_all: 'Alle als ZIP herunterladen', io_clear: 'Ergebnisse löschen', io_privacy: 'Bilder bleiben auf diesem Gerät und werden nie hochgeladen.',
      io_preview: 'Vorschau', io_file: 'Datei', io_before: 'Vorher', io_after: 'Nachher', io_savings: 'Ersparnis', io_action: 'Aktion',
      io_download: 'Herunterladen', io_duplicate: 'Ein Ergebnis namens {name} ist bereits vorhanden.', io_error: '{name} konnte nicht verarbeitet werden.',
      io_unsupported: '{name} ist kein unterstütztes JPEG-, PNG- oder WebP-Bild.', io_png_passthrough: 'Original-PNG bei 100 % bleibt ohne Neukodierung erhalten.',
      io_no_results: 'Verarbeitete Bilder erscheinen hier.', io_login: 'Melde dich bei Apps Hub an, um den Bildoptimierer zu verwenden.',
      io_zip_error: 'Das ZIP-Archiv konnte nicht erstellt werden.', io_open_preview: 'Vorschau von {name} öffnen', io_select_files: 'Bilder auswählen'
    },
    es: {
      io_title: 'Optimizador de imágenes', io_subtitle: 'Convierte y optimiza imágenes de forma privada en tu navegador.',
      io_drop_title: 'Suelta imágenes aquí', io_drop_hint: 'o haz clic para elegir archivos JPEG, PNG o WebP',
      io_format: 'Formato de salida', io_format_webp: 'WebP', io_format_original: 'Formato original', io_quality: 'Calidad',
      io_processing: 'Procesando {done} de {total}', io_ready: 'Listo para otro lote',
      io_download_all: 'Descargar todo como ZIP', io_clear: 'Borrar resultados', io_privacy: 'Las imágenes permanecen en este dispositivo y nunca se suben.',
      io_preview: 'Vista previa', io_file: 'Archivo', io_before: 'Antes', io_after: 'Después', io_savings: 'Ahorro', io_action: 'Acción',
      io_download: 'Descargar', io_duplicate: 'Ya existe un resultado llamado {name}.', io_error: 'No se pudo procesar {name}.',
      io_unsupported: '{name} no es una imagen JPEG, PNG o WebP compatible.', io_png_passthrough: 'El PNG original al 100 % se conserva sin recodificar.',
      io_no_results: 'Las imágenes procesadas aparecerán aquí.', io_login: 'Inicia sesión en Apps Hub para usar el optimizador.',
      io_zip_error: 'No se pudo crear el archivo ZIP.', io_open_preview: 'Abrir vista previa de {name}', io_select_files: 'Elegir imágenes'
    },
    fr: {
      io_title: 'Optimiseur d’images', io_subtitle: 'Convertissez et optimisez vos images en privé dans le navigateur.',
      io_drop_title: 'Déposez les images ici', io_drop_hint: 'ou cliquez pour choisir des fichiers JPEG, PNG ou WebP',
      io_format: 'Format de sortie', io_format_webp: 'WebP', io_format_original: 'Format original', io_quality: 'Qualité',
      io_processing: 'Traitement de {done} sur {total}', io_ready: 'Prêt pour un autre lot',
      io_download_all: 'Tout télécharger en ZIP', io_clear: 'Effacer les résultats', io_privacy: 'Les images restent sur cet appareil et ne sont jamais téléversées.',
      io_preview: 'Aperçu', io_file: 'Fichier', io_before: 'Avant', io_after: 'Après', io_savings: 'Gain', io_action: 'Action',
      io_download: 'Télécharger', io_duplicate: 'Un résultat nommé {name} existe déjà.', io_error: 'Impossible de traiter {name}.',
      io_unsupported: '{name} n’est pas une image JPEG, PNG ou WebP prise en charge.', io_png_passthrough: 'Le PNG original à 100 % est conservé sans réencodage.',
      io_no_results: 'Les images traitées apparaîtront ici.', io_login: 'Connectez-vous à Apps Hub pour utiliser l’optimiseur.',
      io_zip_error: 'Impossible de créer l’archive ZIP.', io_open_preview: 'Ouvrir l’aperçu de {name}', io_select_files: 'Choisir des images'
    },
    ja: {
      io_title: '画像オプティマイザー', io_subtitle: 'ブラウザー内で画像を非公開のまま変換・最適化します。',
      io_drop_title: 'ここに画像をドロップ', io_drop_hint: 'またはクリックして JPEG、PNG、WebP ファイルを選択',
      io_format: '出力形式', io_format_webp: 'WebP', io_format_original: '元の形式', io_quality: '品質',
      io_processing: '{total} 件中 {done} 件を処理中', io_ready: '次の一括処理を開始できます',
      io_download_all: 'すべて ZIP でダウンロード', io_clear: '結果を消去', io_privacy: '画像はこのデバイス内に留まり、アップロードされません。',
      io_preview: 'プレビュー', io_file: 'ファイル', io_before: '変換前', io_after: '変換後', io_savings: '削減率', io_action: '操作',
      io_download: 'ダウンロード', io_duplicate: '{name} という名前の結果は既にあります。', io_error: '{name} を処理できませんでした。',
      io_unsupported: '{name} は対応する JPEG、PNG、WebP 画像ではありません。', io_png_passthrough: '品質 100% の元の PNG は再エンコードせず保持されます。',
      io_no_results: '処理した画像がここに表示されます。', io_login: '画像オプティマイザーを使うには Apps Hub にサインインしてください。',
      io_zip_error: 'ZIP アーカイブを作成できませんでした。', io_open_preview: '{name} のプレビューを開く', io_select_files: '画像を選択'
    },
    'pt-BR': {
      io_title: 'Otimizador de imagens', io_subtitle: 'Converta e otimize imagens com privacidade no navegador.',
      io_drop_title: 'Solte imagens aqui', io_drop_hint: 'ou clique para escolher arquivos JPEG, PNG ou WebP',
      io_format: 'Formato de saída', io_format_webp: 'WebP', io_format_original: 'Formato original', io_quality: 'Qualidade',
      io_processing: 'Processando {done} de {total}', io_ready: 'Pronto para outro lote',
      io_download_all: 'Baixar tudo como ZIP', io_clear: 'Limpar resultados', io_privacy: 'As imagens ficam neste dispositivo e nunca são enviadas.',
      io_preview: 'Prévia', io_file: 'Arquivo', io_before: 'Antes', io_after: 'Depois', io_savings: 'Economia', io_action: 'Ação',
      io_download: 'Baixar', io_duplicate: 'Já existe um resultado chamado {name}.', io_error: 'Não foi possível processar {name}.',
      io_unsupported: '{name} não é uma imagem JPEG, PNG ou WebP compatível.', io_png_passthrough: 'O PNG original em 100% é mantido sem nova codificação.',
      io_no_results: 'As imagens processadas aparecerão aqui.', io_login: 'Entre no Apps Hub para usar o otimizador.',
      io_zip_error: 'Não foi possível criar o arquivo ZIP.', io_open_preview: 'Abrir prévia de {name}', io_select_files: 'Escolher imagens'
    },
    ru: {
      io_title: 'Оптимизатор изображений', io_subtitle: 'Конвертируйте и оптимизируйте изображения прямо в браузере.',
      io_drop_title: 'Перетащите изображения сюда', io_drop_hint: 'или нажмите, чтобы выбрать файлы JPEG, PNG или WebP',
      io_format: 'Выходной формат', io_format_webp: 'WebP', io_format_original: 'Исходный формат', io_quality: 'Качество',
      io_processing: 'Обработка: {done} из {total}', io_ready: 'Можно добавить следующую группу',
      io_download_all: 'Скачать все в ZIP', io_clear: 'Очистить результаты', io_privacy: 'Изображения остаются на этом устройстве и не загружаются на сервер.',
      io_preview: 'Просмотр', io_file: 'Файл', io_before: 'До', io_after: 'После', io_savings: 'Экономия', io_action: 'Действие',
      io_download: 'Скачать', io_duplicate: 'Результат с именем {name} уже существует.', io_error: 'Не удалось обработать {name}.',
      io_unsupported: '{name} не является поддерживаемым изображением JPEG, PNG или WebP.', io_png_passthrough: 'Исходный PNG при качестве 100% сохраняется без перекодирования.',
      io_no_results: 'Обработанные изображения появятся здесь.', io_login: 'Войдите в Apps Hub, чтобы использовать оптимизатор.',
      io_zip_error: 'Не удалось создать ZIP-архив.', io_open_preview: 'Открыть просмотр {name}', io_select_files: 'Выбрать изображения'
    },
    'zh-CN': {
      io_title: '图像优化器', io_subtitle: '直接在浏览器中私密地转换和优化图像。',
      io_drop_title: '将图像拖放到这里', io_drop_hint: '或点击选择 JPEG、PNG 或 WebP 文件',
      io_format: '输出格式', io_format_webp: 'WebP', io_format_original: '原始格式', io_quality: '质量',
      io_processing: '正在处理第 {done} 个，共 {total} 个', io_ready: '可继续处理下一批',
      io_download_all: '全部下载为 ZIP', io_clear: '清除结果', io_privacy: '图像只保留在此设备上，绝不会上传。',
      io_preview: '预览', io_file: '文件', io_before: '处理前', io_after: '处理后', io_savings: '节省', io_action: '操作',
      io_download: '下载', io_duplicate: '名为 {name} 的结果已存在。', io_error: '无法处理 {name}。',
      io_unsupported: '{name} 不是受支持的 JPEG、PNG 或 WebP 图像。', io_png_passthrough: '质量为 100% 时，原始 PNG 将保留且不重新编码。',
      io_no_results: '处理后的图像会显示在这里。', io_login: '请登录 Apps Hub 以使用图像优化器。',
      io_zip_error: '无法创建 ZIP 压缩包。', io_open_preview: '打开 {name} 的预览', io_select_files: '选择图像'
    }
  };

  Object.assign(tables.en, {
    io_premium_title:'Premium tools',io_advanced_title:'Advanced tools',io_advanced_hint:'Apply the same options to individual images or a complete ZIP archive.',
    io_archive_title:'ZIP archive',io_archive_choose:'Choose ZIP archive',io_archive_hint:'Uploading an archive clears the current results and preserves its folder structure.',io_archive_reading:'Reading archive…',io_archive_empty:'The archive contains no supported images.',io_archive_error:'The ZIP archive could not be opened.',
    io_resize_title:'Resolution',io_resize_enable:'Resize images',io_width:'Width',io_height:'Height',io_keep_aspect:'Keep aspect ratio',io_rename_title:'Bulk rename',io_prefix:'Prefix',io_suffix:'Suffix',io_case:'Letter case',io_keep:'Keep unchanged',io_lowercase:'Lowercase',io_uppercase:'Uppercase',io_spaces:'Spaces',io_hyphens:'Replace with hyphens',io_underscores:'Replace with underscores',io_find:'Find text',io_replace:'Replace with',io_rename_only:'Rename only — do not convert or resize',
    io_transparency_title:'Transparency',io_preserve_transparency:'Preserve transparency',io_transparency_hint:'When disabled, transparent pixels are placed on white.',io_preferences_title:'Saved settings',io_preferences_hint:'Premium remembers these options for this Apps Hub profile on this device.',io_reset_settings:'Reset to defaults',
    io_admin_title:'Public-page access',io_admin_hint:'Choose which Premium tools every Apps Hub profile may use on the public page.',io_admin_archive_upload:'Allow ZIP archives',io_admin_resize:'Allow resolution changes',io_admin_bulk_rename:'Allow bulk rename',io_admin_preserve_transparency:'Allow transparency control',io_save_public:'Save public access',io_saved:'Saved',io_premium_required:'Activate Premium to use and configure these tools.',io_passthrough:'original bytes kept'
  });
  Object.assign(tables.bg, {
    io_premium_title:'Премиум инструменти',io_advanced_title:'Разширени инструменти',io_advanced_hint:'Прилагат едни и същи настройки към отделни изображения или цял ZIP архив.',
    io_archive_title:'ZIP архив',io_archive_choose:'Избери ZIP архив',io_archive_hint:'Качването на архив изчиства текущите резултати и запазва структурата на папките.',io_archive_reading:'Прочитане на архива…',io_archive_empty:'Архивът не съдържа поддържани изображения.',io_archive_error:'ZIP архивът не можа да бъде отворен.',
    io_resize_title:'Резолюция',io_resize_enable:'Промени размера',io_width:'Ширина',io_height:'Височина',io_keep_aspect:'Запази пропорциите',io_rename_title:'Масово преименуване',io_prefix:'Префикс',io_suffix:'Суфикс',io_case:'Главни и малки букви',io_keep:'Без промяна',io_lowercase:'Само малки букви',io_uppercase:'Само главни букви',io_spaces:'Интервали',io_hyphens:'Замени с тирета',io_underscores:'Замени с долни черти',io_find:'Намери текст',io_replace:'Замени с',io_rename_only:'Само преименуване — без конвертиране и резолюция',
    io_transparency_title:'Прозрачност',io_preserve_transparency:'Запази прозрачността',io_transparency_hint:'При изключване прозрачните пиксели се поставят върху бяло.',io_preferences_title:'Запазени настройки',io_preferences_hint:'Премиум запомня тези опции за този Apps Hub профил на устройството.',io_reset_settings:'Нулирай настройките',
    io_admin_title:'Достъп в публичната страница',io_admin_hint:'Избери кои Премиум инструменти да ползват всички Apps Hub профили.',io_admin_archive_upload:'Разреши ZIP архиви',io_admin_resize:'Разреши промяна на резолюция',io_admin_bulk_rename:'Разреши масово преименуване',io_admin_preserve_transparency:'Разреши контрол на прозрачността',io_save_public:'Запази публичния достъп',io_saved:'Запазено',io_premium_required:'Активирай Премиум, за да използваш и настройваш тези инструменти.',io_passthrough:'оригиналните данни са запазени'
  });
  Object.assign(tables.de, {
    io_premium_title:'Premium-Werkzeuge',io_advanced_title:'Erweiterte Werkzeuge',io_advanced_hint:'Dieselben Optionen auf einzelne Bilder oder ein komplettes ZIP-Archiv anwenden.',io_archive_title:'ZIP-Archiv',io_archive_choose:'ZIP-Archiv auswählen',io_archive_hint:'Ein Archiv löscht aktuelle Ergebnisse und behält die Ordnerstruktur bei.',io_archive_reading:'Archiv wird gelesen…',io_archive_empty:'Das Archiv enthält keine unterstützten Bilder.',io_archive_error:'Das ZIP-Archiv konnte nicht geöffnet werden.',io_resize_title:'Auflösung',io_resize_enable:'Bildgröße ändern',io_width:'Breite',io_height:'Höhe',io_keep_aspect:'Seitenverhältnis beibehalten',io_rename_title:'Stapelweise umbenennen',io_prefix:'Präfix',io_suffix:'Suffix',io_case:'Groß-/Kleinschreibung',io_keep:'Unverändert',io_lowercase:'Kleinbuchstaben',io_uppercase:'Großbuchstaben',io_spaces:'Leerzeichen',io_hyphens:'Durch Bindestriche ersetzen',io_underscores:'Durch Unterstriche ersetzen',io_find:'Text suchen',io_replace:'Ersetzen durch',io_rename_only:'Nur umbenennen — nicht konvertieren oder skalieren',io_transparency_title:'Transparenz',io_preserve_transparency:'Transparenz beibehalten',io_transparency_hint:'Deaktiviert werden transparente Pixel weiß.',io_preferences_title:'Gespeicherte Einstellungen',io_preferences_hint:'Premium merkt sich diese Optionen für dieses Apps-Hub-Profil auf diesem Gerät.',io_reset_settings:'Zurücksetzen',io_admin_title:'Zugriff der öffentlichen Seite',io_admin_hint:'Wählen Sie die Premium-Werkzeuge für öffentliche Apps-Hub-Profile.',io_admin_archive_upload:'ZIP-Archive erlauben',io_admin_resize:'Auflösungsänderung erlauben',io_admin_bulk_rename:'Stapel-Umbenennung erlauben',io_admin_preserve_transparency:'Transparenzsteuerung erlauben',io_save_public:'Öffentlichen Zugriff speichern',io_saved:'Gespeichert',io_premium_required:'Premium aktivieren, um diese Werkzeuge zu verwenden und zu konfigurieren.',io_passthrough:'Originaldaten beibehalten'
  });
  Object.assign(tables.es, {
    io_premium_title:'Herramientas Premium',io_advanced_title:'Herramientas avanzadas',io_advanced_hint:'Aplica las mismas opciones a imágenes individuales o a un ZIP completo.',io_archive_title:'Archivo ZIP',io_archive_choose:'Elegir archivo ZIP',io_archive_hint:'Subir un archivo borra los resultados actuales y conserva las carpetas.',io_archive_reading:'Leyendo archivo…',io_archive_empty:'El archivo no contiene imágenes compatibles.',io_archive_error:'No se pudo abrir el archivo ZIP.',io_resize_title:'Resolución',io_resize_enable:'Cambiar tamaño',io_width:'Ancho',io_height:'Alto',io_keep_aspect:'Mantener proporción',io_rename_title:'Cambio de nombre masivo',io_prefix:'Prefijo',io_suffix:'Sufijo',io_case:'Mayúsculas/minúsculas',io_keep:'Sin cambios',io_lowercase:'Minúsculas',io_uppercase:'Mayúsculas',io_spaces:'Espacios',io_hyphens:'Sustituir por guiones',io_underscores:'Sustituir por guiones bajos',io_find:'Buscar texto',io_replace:'Reemplazar con',io_rename_only:'Solo renombrar — no convertir ni redimensionar',io_transparency_title:'Transparencia',io_preserve_transparency:'Conservar transparencia',io_transparency_hint:'Desactivada, los píxeles transparentes se vuelven blancos.',io_preferences_title:'Ajustes guardados',io_preferences_hint:'Premium recuerda estas opciones para este perfil de Apps Hub en este dispositivo.',io_reset_settings:'Restablecer valores',io_admin_title:'Acceso de la página pública',io_admin_hint:'Elige qué herramientas Premium pueden usar los perfiles públicos.',io_admin_archive_upload:'Permitir archivos ZIP',io_admin_resize:'Permitir cambios de resolución',io_admin_bulk_rename:'Permitir cambio de nombre masivo',io_admin_preserve_transparency:'Permitir control de transparencia',io_save_public:'Guardar acceso público',io_saved:'Guardado',io_premium_required:'Activa Premium para usar y configurar estas herramientas.',io_passthrough:'datos originales conservados'
  });
  Object.assign(tables.fr, {
    io_premium_title:'Outils Premium',io_advanced_title:'Outils avancés',io_advanced_hint:'Appliquez les mêmes options à des images ou à une archive ZIP complète.',io_archive_title:'Archive ZIP',io_archive_choose:'Choisir une archive ZIP',io_archive_hint:'Une archive efface les résultats actuels et conserve les dossiers.',io_archive_reading:'Lecture de l’archive…',io_archive_empty:'L’archive ne contient aucune image prise en charge.',io_archive_error:'Impossible d’ouvrir l’archive ZIP.',io_resize_title:'Résolution',io_resize_enable:'Redimensionner',io_width:'Largeur',io_height:'Hauteur',io_keep_aspect:'Conserver les proportions',io_rename_title:'Renommage groupé',io_prefix:'Préfixe',io_suffix:'Suffixe',io_case:'Casse',io_keep:'Conserver',io_lowercase:'Minuscules',io_uppercase:'Majuscules',io_spaces:'Espaces',io_hyphens:'Remplacer par des tirets',io_underscores:'Remplacer par des traits bas',io_find:'Texte recherché',io_replace:'Remplacer par',io_rename_only:'Renommer uniquement — sans conversion ni redimensionnement',io_transparency_title:'Transparence',io_preserve_transparency:'Conserver la transparence',io_transparency_hint:'Sinon, les pixels transparents deviennent blancs.',io_preferences_title:'Réglages enregistrés',io_preferences_hint:'Premium mémorise ces options pour ce profil Apps Hub sur cet appareil.',io_reset_settings:'Réinitialiser',io_admin_title:'Accès à la page publique',io_admin_hint:'Choisissez les outils Premium accessibles aux profils publics.',io_admin_archive_upload:'Autoriser les archives ZIP',io_admin_resize:'Autoriser le changement de résolution',io_admin_bulk_rename:'Autoriser le renommage groupé',io_admin_preserve_transparency:'Autoriser le contrôle de transparence',io_save_public:'Enregistrer l’accès public',io_saved:'Enregistré',io_premium_required:'Activez Premium pour utiliser et configurer ces outils.',io_passthrough:'données originales conservées'
  });
  Object.assign(tables.ja, {
    io_premium_title:'Premium ツール',io_advanced_title:'高度なツール',io_advanced_hint:'個別画像または ZIP 全体に同じ設定を適用します。',io_archive_title:'ZIP アーカイブ',io_archive_choose:'ZIP を選択',io_archive_hint:'ZIP を読み込むと現在の結果を消去し、フォルダー構成を保持します。',io_archive_reading:'ZIP を読み込み中…',io_archive_empty:'対応画像がありません。',io_archive_error:'ZIP を開けませんでした。',io_resize_title:'解像度',io_resize_enable:'サイズを変更',io_width:'幅',io_height:'高さ',io_keep_aspect:'縦横比を維持',io_rename_title:'一括名前変更',io_prefix:'接頭辞',io_suffix:'接尾辞',io_case:'大文字・小文字',io_keep:'変更なし',io_lowercase:'小文字',io_uppercase:'大文字',io_spaces:'空白',io_hyphens:'ハイフンに置換',io_underscores:'アンダースコアに置換',io_find:'検索文字列',io_replace:'置換後',io_rename_only:'名前変更のみ — 変換・リサイズしない',io_transparency_title:'透明度',io_preserve_transparency:'透明度を保持',io_transparency_hint:'無効時は透明部分を白にします。',io_preferences_title:'保存済み設定',io_preferences_hint:'Premium はこの端末の Apps Hub プロフィールごとに設定を保存します。',io_reset_settings:'初期設定に戻す',io_admin_title:'公開ページのアクセス',io_admin_hint:'公開プロフィールが使える Premium ツールを選択します。',io_admin_archive_upload:'ZIP を許可',io_admin_resize:'解像度変更を許可',io_admin_bulk_rename:'一括名前変更を許可',io_admin_preserve_transparency:'透明度設定を許可',io_save_public:'公開設定を保存',io_saved:'保存しました',io_premium_required:'これらのツールには Premium の有効化が必要です。',io_passthrough:'元データを保持'
  });
  Object.assign(tables['pt-BR'], {
    io_premium_title:'Ferramentas Premium',io_advanced_title:'Ferramentas avançadas',io_advanced_hint:'Aplique as mesmas opções a imagens ou a um ZIP completo.',io_archive_title:'Arquivo ZIP',io_archive_choose:'Escolher arquivo ZIP',io_archive_hint:'O arquivo limpa os resultados atuais e preserva as pastas.',io_archive_reading:'Lendo arquivo…',io_archive_empty:'O arquivo não contém imagens compatíveis.',io_archive_error:'Não foi possível abrir o ZIP.',io_resize_title:'Resolução',io_resize_enable:'Redimensionar',io_width:'Largura',io_height:'Altura',io_keep_aspect:'Manter proporção',io_rename_title:'Renomeação em massa',io_prefix:'Prefixo',io_suffix:'Sufixo',io_case:'Maiúsculas/minúsculas',io_keep:'Manter',io_lowercase:'Minúsculas',io_uppercase:'Maiúsculas',io_spaces:'Espaços',io_hyphens:'Trocar por hifens',io_underscores:'Trocar por sublinhados',io_find:'Localizar texto',io_replace:'Substituir por',io_rename_only:'Apenas renomear — sem converter ou redimensionar',io_transparency_title:'Transparência',io_preserve_transparency:'Preservar transparência',io_transparency_hint:'Desativada, os pixels transparentes ficam brancos.',io_preferences_title:'Configurações salvas',io_preferences_hint:'O Premium lembra estas opções para este perfil do Apps Hub neste dispositivo.',io_reset_settings:'Restaurar padrões',io_admin_title:'Acesso da página pública',io_admin_hint:'Escolha quais ferramentas Premium os perfis públicos podem usar.',io_admin_archive_upload:'Permitir arquivos ZIP',io_admin_resize:'Permitir mudança de resolução',io_admin_bulk_rename:'Permitir renomeação em massa',io_admin_preserve_transparency:'Permitir controle de transparência',io_save_public:'Salvar acesso público',io_saved:'Salvo',io_premium_required:'Ative o Premium para usar e configurar estas ferramentas.',io_passthrough:'dados originais preservados'
  });
  Object.assign(tables.ru, {
    io_premium_title:'Премиум-инструменты',io_advanced_title:'Расширенные инструменты',io_advanced_hint:'Применяйте одни настройки к изображениям или целому ZIP.',io_archive_title:'ZIP-архив',io_archive_choose:'Выбрать ZIP-архив',io_archive_hint:'Загрузка архива очищает результаты и сохраняет структуру папок.',io_archive_reading:'Чтение архива…',io_archive_empty:'В архиве нет поддерживаемых изображений.',io_archive_error:'Не удалось открыть ZIP-архив.',io_resize_title:'Разрешение',io_resize_enable:'Изменить размер',io_width:'Ширина',io_height:'Высота',io_keep_aspect:'Сохранить пропорции',io_rename_title:'Массовое переименование',io_prefix:'Префикс',io_suffix:'Суффикс',io_case:'Регистр',io_keep:'Без изменений',io_lowercase:'Строчные',io_uppercase:'Прописные',io_spaces:'Пробелы',io_hyphens:'Заменить дефисами',io_underscores:'Заменить подчёркиваниями',io_find:'Найти текст',io_replace:'Заменить на',io_rename_only:'Только переименовать — без конвертации и размера',io_transparency_title:'Прозрачность',io_preserve_transparency:'Сохранить прозрачность',io_transparency_hint:'Если выключено, прозрачные пиксели станут белыми.',io_preferences_title:'Сохранённые настройки',io_preferences_hint:'Premium запоминает настройки этого профиля Apps Hub на устройстве.',io_reset_settings:'Сбросить настройки',io_admin_title:'Доступ публичной страницы',io_admin_hint:'Выберите Premium-инструменты для публичных профилей.',io_admin_archive_upload:'Разрешить ZIP-архивы',io_admin_resize:'Разрешить смену разрешения',io_admin_bulk_rename:'Разрешить массовое переименование',io_admin_preserve_transparency:'Разрешить управление прозрачностью',io_save_public:'Сохранить доступ',io_saved:'Сохранено',io_premium_required:'Активируйте Premium для использования и настройки этих инструментов.',io_passthrough:'исходные данные сохранены'
  });
  Object.assign(tables['zh-CN'], {
    io_premium_title:'Premium 工具',io_advanced_title:'高级工具',io_advanced_hint:'将相同设置应用到单张图片或整个 ZIP。',io_archive_title:'ZIP 压缩包',io_archive_choose:'选择 ZIP',io_archive_hint:'上传 ZIP 会清除当前结果并保留文件夹结构。',io_archive_reading:'正在读取 ZIP…',io_archive_empty:'ZIP 中没有支持的图片。',io_archive_error:'无法打开 ZIP。',io_resize_title:'分辨率',io_resize_enable:'调整尺寸',io_width:'宽度',io_height:'高度',io_keep_aspect:'保持宽高比',io_rename_title:'批量重命名',io_prefix:'前缀',io_suffix:'后缀',io_case:'字母大小写',io_keep:'保持不变',io_lowercase:'小写',io_uppercase:'大写',io_spaces:'空格',io_hyphens:'替换为连字符',io_underscores:'替换为下划线',io_find:'查找文本',io_replace:'替换为',io_rename_only:'仅重命名 — 不转换或调整尺寸',io_transparency_title:'透明度',io_preserve_transparency:'保留透明度',io_transparency_hint:'关闭后透明像素将变为白色。',io_preferences_title:'已保存设置',io_preferences_hint:'Premium 会在此设备上按 Apps Hub 用户保存设置。',io_reset_settings:'恢复默认值',io_admin_title:'公开页面权限',io_admin_hint:'选择公开用户可以使用的 Premium 工具。',io_admin_archive_upload:'允许 ZIP',io_admin_resize:'允许调整分辨率',io_admin_bulk_rename:'允许批量重命名',io_admin_preserve_transparency:'允许透明度控制',io_save_public:'保存公开权限',io_saved:'已保存',io_premium_required:'激活 Premium 后才能使用和配置这些工具。',io_passthrough:'保留原始数据'
  });

  var zipHints = {
    en: 'or click to choose JPEG, PNG, WebP or a ZIP archive',
    bg: 'или кликни, за да избереш JPEG, PNG, WebP или ZIP архив',
    de: 'oder klicken, um JPEG, PNG, WebP oder ein ZIP-Archiv auszuwählen',
    es: 'o haz clic para elegir JPEG, PNG, WebP o un archivo ZIP',
    fr: 'ou cliquez pour choisir JPEG, PNG, WebP ou une archive ZIP',
    ja: 'またはクリックして JPEG、PNG、WebP、ZIP を選択',
    'pt-BR': 'ou clique para escolher JPEG, PNG, WebP ou um arquivo ZIP',
    ru: 'или нажмите, чтобы выбрать JPEG, PNG, WebP или ZIP-архив',
    'zh-CN': '或点击选择 JPEG、PNG、WebP 或 ZIP'
  };
  Object.keys(zipHints).forEach(function (lang) { tables[lang].io_drop_hint_zip = zipHints[lang]; });

  function currentTable() {
    var lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    return tables[lang] || tables[lang.split('-')[0]] || tables.en;
  }
  function merge() {
    var table = currentTable();
    window._i18n = window._i18n || {};
    Object.keys(table).forEach(function (key) { window._i18n[key] = table[key]; });
  }
  merge();
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(merge);
  window.IMAGE_OPTIMIZER_I18N = { tables: tables, merge: merge };
})();
