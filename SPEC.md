# mvmOS App Specification

The short list of rules every mvmOS app follows. The full guide with every field, API and example is **[DEVELOPER.md](DEVELOPER.md)**; the repository layout, widgets and themes are in **[README.md](README.md)**.

---

## App structure

An app is a folder `apps/<app-id>/` of a running mvmOS installation:

```
apps/your-app/
  manifest.json     ← required: app metadata
  store.json        ← the Store listing on mvmos.org (never in the zip)
  premium.json      ← only for apps with premium (never in the zip)
  db.json           ← optional: database schema
  api.py            ← optional: the app's server routes
  app_api.py        ← optional: functions for other apps, Automations and the External API
  scheduler.py      ← optional: runs every minute
  premium/          ← optional: premium code, delivered only to licensed installations
  public/           ← the only web-reachable folder
    main.js         ← required: entry point
    style.css       ← optional
    i18n.js         ← the app's translations
```

The official Store keeps the same tree in `source/apps/<app-id>/` and ships each version as `apps/<category>/<app-id>-<version>.zip`, built with `make-zip.sh`.

---

## manifest.json

```json
{
  "id": "your-app",
  "name": "Your App",
  "name_i18n": { "en": "Your App", "bg": "Вашето приложение" },
  "icon": "🚀",
  "category": "Utilities",
  "tags": ["notes", "planning"],
  "version": "1.0.0",
  "min_core_version": "1.10.0",
  "description": "Short description shown in the store.",
  "entry": "main.js",
  "css": "style.css"
}
```

| Field              | Required | Description |
|--------------------|----------|-------------|
| `id`               | ✓        | Unique identifier, lowercase, hyphens allowed |
| `name`             | ✓        | Display name |
| `name_i18n`        |          | The name in each of the nine languages |
| `icon`             | ✓        | Emoji, or a path/URL to an image (`/apps/your-app/icon.png`) |
| `category`         | ✓        | One broad Store category (below) |
| `tags`             |          | 1–5 lowercase kebab-case discovery tags for Store search, not extra Start menu categories |
| `version`          | ✓        | Semver — bump it for every change that ships, including premium-only changes |
| `min_core_version` |          | The oldest mvmOS that has everything the app uses |
| `description`      | ✓        | Short description |
| `entry`            |          | Entry JS file in `public/` (default `main.js`) |
| `css`              |          | CSS file in `public/` loaded with the app |

Every other field (`settings`, `scheduler`, `file_types`, `requires_apphub`, `public_url`, games…) is in [DEVELOPER.md → manifest.json](DEVELOPER.md#manifestjson).

Official Store categories: `Productivity`, `Finance`, `Communication`, `Media`, `Creative`, `Business`, `AI`, `Developer Tools`, `System & Administration`, `Security & Privacy`, `Health & Fitness`, `Utilities`, `Games`. Use `tags` for anything narrower.

---

## main.js

```js
mvmOS.registerApp({
  id: 'your-app',       // must match manifest id
  name: 'Your App',
  icon: '🚀',
  launch() {
    mvmOS.createWindow({
      id: 'your-app',
      title: t('ya_title'),
      width: 600,
      height: 400,
      onMount(body) {
        body.innerHTML = `<p>${t('ya_hello')}</p>`;
      }
    });
  }
});
```

`createWindow` also takes `onResize(el)`. On screens under 768px windows open full screen; a sidebar marked `as-sidebar` inside `as-wrap` + `as-main` becomes an overlay behind a ☰ button.

---

## Rules

- **Translate everything.** No hard-coded text. Strings live in `public/i18n.js`, cover all nine languages (`en`, `bg`, `de`, `es`, `fr`, `ja`, `pt-BR`, `ru`, `zh-CN`) and are read with `t(key, vars)`. Never add keys to core's `frontend/i18n/`. See [DEVELOPER.md → i18n](DEVELOPER.md#i18n).
- **Follow the theme.** Colours come from the theme variables, in the desktop window and on the public page. See [README.md → Following the theme](README.md#following-the-theme).
- **Use mvmOS dialogs.** `mvmOS.confirm`, `mvmOS.prompt`, `mvmOS.toast` and `mvmOS.notify` instead of the browser's own.
- **Load files through `asset()`.** Every script, stylesheet or image the browser loads goes through `window.asset(url)`, which adds the file's change time so no cache serves an old copy.
- **Stay in your folder.** An app reads and writes only its own `apps/<app-id>/` and reaches other apps only through `hub.call_app_api()`.
- **Premium stays in `premium/`.** Whatever does the premium work — server code or browser code — lives in `premium/`; the public part may only show the locked control. See [DEVELOPER.md → Premium features](DEVELOPER.md#premium-features).

---

## Data storage

You are responsible for your app's data.

1. **The app's database** — `apps/your-app/data.db`, created from `db.json`. Read and write it from your own `api.py` routes; that is the normal way. The browser door `mvmOS.db('your-app')` (`query`, `run`) still works for small apps without `api.py`, but once an app has `api.py` it reaches only the `cfg` settings table unless the app's own scripts use it. Good for records that must follow the user across devices.
2. **Per-browser values** — `this.storage.get/set/remove` inside `registerApp`, namespaced by your app id. Good for UI preferences of one device. (`mvmOS.storage` is a shared global store; don't use it in new apps.)
3. **Files** — your app's own folder through `api.py`, or the user's files through `mvmOS.fs` and the upload manager (see [README.md → File uploads](README.md#file-uploads)).

> When an app is uninstalled, `apps/your-app/` is deleted, `data.db` included. If users need to keep their data, offer an export.

---

## Widgets

Widgets live on the desktop or in the taskbar and call `mvmOS.registerWidget()`:

```js
mvmOS.registerWidget({
  id: 'my-widget',
  name: 'My Widget',
  type: 'desktop',      // 'desktop' or 'taskbar'
  defaultX: 20,         // desktop widgets only
  defaultY: 60,
  init(container) {
    function render() {
      container.innerHTML = `<div>${t('mw_title')}</div>`;
    }
    render();
    mvmOS.onLangChange(render);
    mvmOS.onResources(data => { /* data.cpu_pct, mem_used, mem_total, disks, uptime, load … */ });
  }
});
```

The release is a zip with `<widget-id>/manifest.json` (the app fields plus `widget_type`) and `<widget-id>/main.js`, listed in `widgets/<type>/<category>/manifest.json`. Sizes, the full `onResources` data and more are in [README.md → Widgets](README.md#widgets).

## Widget settings

Widgets can expose user-configurable settings. These appear in **App Store → My Widgets** and are accessible via a right-click / long-press context menu on the widget itself.

Declare a `settings` array in `registerWidget()`:

```js
mvmOS.registerWidget({
  id: 'my-widget',
  type: 'desktop',
  name: 'My Widget',
  settings: [
    { key: 'interval', label: 'Refresh interval (s)', type: 'number', default: 5, min: 1, max: 60 },
    { key: 'show_label', label: 'Show label', type: 'checkbox', default: true },
    { key: 'color', label: 'Color scheme', type: 'select', options: ['blue','green','red'], default: 'blue' },
    { key: 'title', label: 'Custom title', type: 'text', default: '' },
  ],
  init(container) {
    // Read a setting (returns saved value, or the field default, or null)
    const interval = mvmOS.widgetSetting('my-widget', 'interval', 5);

    function render() {
      const show = mvmOS.widgetSetting('my-widget', 'show_label', true);
      container.innerHTML = `<div>${show ? 'My Widget' : ''}</div>`;
    }
    render();

    // Re-render when user saves settings
    window.addEventListener('widget-settings-changed', e => {
      if (e.detail?.id === 'my-widget') render();
    });
  }
});
```

### Setting field types

| `type`     | Extra fields                                      |
|------------|---------------------------------------------------|
| `number`   | `min`, `max` (optional)                           |
| `checkbox` | —                                                 |
| `select`   | `options: string[]`                               |
| `text`     | —                                                 |
| `city`     | autocomplete via Open-Meteo Geocoding (no key)    |

All fields require `key`, `label`, `type`, and `default`.

### Reading settings in `init`

```js
mvmOS.widgetSetting(widgetId, key, defaultValue)
```

Returns the saved value (from this browser's localStorage), or `defaultValue` if nothing is saved yet.

### Server-side settings (persist across devices)

By default settings are stored in `localStorage` — per browser. If you want settings shared across all devices, add `useDb: true` to `registerWidget()` and use `mvmOS.widgetDb()` instead of `mvmOS.widgetSetting()`:

```js
mvmOS.registerWidget({
  id: 'my-widget',
  useDb: true,
  settings: [ /* ... */ ],
  init(container) {
    const db = mvmOS.widgetDb('my-widget');

    async function _init() {
      await db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    }

    async function _get(key, def) {
      const rows = await db.query('SELECT value FROM settings WHERE key=?', [key]);
      if (rows.length) return JSON.parse(rows[0].value);
      return def;
    }

    async function render() {
      const city = await _get('city', null);
      // ...
    }

    _init().then(() => render());

    window.addEventListener('widget-settings-changed', e => {
      if (e.detail?.id === 'my-widget') render();
    });
  }
});
```

The database file is `widgets/my-widget/data.db` in the mvmOS installation. The App Store settings panel reads and writes it automatically when `useDb: true` is set.

### Custom context menu items

You can add extra items to the right-click / long-press menu:

```js
mvmOS.registerWidget({
  id: 'my-widget',
  contextMenu: [
    { label: 'Reset data', action() { /* ... */ } },
  ],
  // ...
});
```

---

---

## Publishing to the store

The official Store is built from a running mvmOS installation, not by copying folders into this repository:

1. Write the app in `apps/<app-id>/` of your installation, with `store.json` (and `premium.json` for premium).
2. An app whose `manifest.json` has `"beta": true` is not released: its source may be committed, but `make-zip.sh` refuses it, so it stays out of the App Store and mvmos.org until the field is removed.
3. Release it with `make-zip.sh <app-id> <version> <category>`. The script replaces the old `apps/<category>/<app-id>-*.zip` with `apps/<category>/<app-id>-<version>.zip` built from `source/apps/<app-id>/`, without `store.json`, `premium.json`, `premium/`, uploads or runtime data, copies `premium` and `name_i18n` into the category entry and publishes the premium build when there is one.
4. Set `version`, `zip_url` and `min_core_version` of the app's entry in the category `manifest.json` to match, then commit the source, the zip and the category manifest together.

> **The version lives in two places:** the app's own `manifest.json` and its entry in the category `manifest.json`. Installations compare against the category manifest, so a version bumped only in the app would never reach them. Keep `min_core_version` the same in both as well.

To offer an app without being in the official Store, publish your own store (next section) or send a pull request to [mvmrik/mvmos-store](https://github.com/mvmrik/mvmos-store) with the app's source.

## Using a custom store

Host a `manifest.json` in the same format as this repository's — `{"version": 2, "categories": [...]}` pointing to category manifests, or a simple `{"version": 1, "apps": [...]}` list — and add it in mvmOS:

**App Store → Stores → + Add store** → a name and the URL of your `manifest.json`

```
https://raw.githubusercontent.com/yourname/your-store/main/manifest.json
```

Its apps appear in the App Store next to the official ones and install like any other. See [README.md → Your own store](README.md#your-own-store).
