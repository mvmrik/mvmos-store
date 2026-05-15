# mvmOS App Specification

This document defines how to create an app for mvmOS.

---

## App Structure

Each app lives in its own folder inside `apps/`:

```
apps/
  your-app/
    manifest.json   ← required: app metadata
    main.js         ← required: entry point
    style.css       ← optional: styles
    README.md       ← optional: documentation
```

---

## manifest.json

```json
{
  "id": "your-app",
  "name": "Your App",
  "icon": "🚀",
  "category": "Utilities",
  "version": "1.0.0",
  "description": "Short description shown in the store.",
  "entry": "main.js",
  "css": "style.css"
}
```

| Field         | Required | Description                                      |
|---------------|----------|--------------------------------------------------|
| `id`          | ✓        | Unique identifier, lowercase, hyphens allowed    |
| `name`        | ✓        | Display name                                     |
| `icon`        | ✓        | Emoji, or a path/URL to an image (`/apps/your-app/icon.png`) |
| `category`    | ✓        | Category shown in the store                      |
| `version`     | ✓        | Semver string — bump to trigger update prompt    |
| `description` | ✓        | Short description                                |
| `entry`       |          | Entry JS file (default: `main.js`)               |
| `css`         |          | Optional CSS file loaded alongside the app       |

---

## main.js

The entry file must call `mvmOS.registerApp()`:

```js
mvmOS.registerApp({
  id: 'your-app',       // must match manifest id
  name: 'Your App',
  icon: '🚀',           // emoji, or a path/URL to an image file (e.g. '/apps/your-app/icon.png')
  launch() {
    mvmOS.createWindow({
      id: 'your-app',
      title: '🚀 Your App',
      width: 600,
      height: 400,
      onMount(body) {
        body.innerHTML = '<p>Hello from your app!</p>';
      }
    });
  }
});
```

---

## mvmOS API

Your app has access to the global `mvmOS` object:

```js
// Open a window
mvmOS.createWindow({
  id: 'unique-id',        // used to prevent duplicate windows
  title: 'Window Title',
  width: 600,             // default: 700
  height: 400,            // default: 450
  onMount(body) { ... },  // called with the window body element
  onResize(el) { ... },   // called on resize (optional)
})
```

**Mobile layout:** On small screens (< 768px) windows open fullscreen automatically. If your app has a sidebar, use the class `as-sidebar` and wrap the layout in `as-wrap` + `as-main` — the sidebar will automatically hide and a ☰ button will appear in the titlebar to show it as an overlay.

```html
<div class="as-wrap">
  <nav class="as-sidebar"><!-- sidebar items --></nav>
  <div class="as-main"><!-- main content --></div>
</div>
```

```js

// Open Settings on a specific tab
mvmOS.openSettings('display')   // display | regional | filemanager | users | about

// Per-app localStorage (namespaced automatically)
mvmOS.storage.get('key')             // returns value or null
mvmOS.storage.set('key', value)      // value can be any JSON-serializable type
mvmOS.storage.remove('key')

// Push a notification to the taskbar
mvmOS.notify('Title', 'Body text', () => { /* action on click */ }, 'Button label')

// SQLite database (stored in apps/your-app/data.db on the server)
const db = mvmOS.db('your-app');

await db.run('CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, text TEXT, created_at INTEGER)');
await db.run('INSERT INTO entries (text, created_at) VALUES (?, ?)', ['hello', Date.now()]);
const rows = await db.query('SELECT * FROM entries ORDER BY created_at DESC');
// rows → [{ id: 1, text: 'hello', created_at: ... }, ...]
```

---

## Data storage

You are responsible for your app's data. mvmOS provides three options:

### 1. Simple key-value (localStorage)
```js
mvmOS.storage.set('my-app/settings', { theme: 'dark' });
const s = mvmOS.storage.get('my-app/settings');
```
Good for: settings, preferences, small state. Stored in the browser, per device.

### 2. SQLite database (server-side)
```js
const db = mvmOS.db('your-app-id');
await db.run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)');
await db.run('INSERT INTO items (name) VALUES (?)', ['example']);
const rows = await db.query('SELECT * FROM items');
```
The database file is stored at `apps/your-app/data.db` on the server.
Good for: records, logs, entries — anything that needs to persist across devices/users.
You design the schema, you manage migrations. mvmOS just executes the queries.

### 3. File system
```js
// Use the mvmOS file manager API or standard fetch to read/write files
// Files can be stored anywhere the server user has access to
```
Good for: images, documents, exports.

> **Note:** When your app is uninstalled, the `apps/your-app/` folder is deleted —
> including `data.db`. If users need to keep their data, provide an export feature.

---

## Internationalization (i18n)

mvmOS has built-in multi-language support. The system loads a language file (`/i18n/en.js`, `/i18n/bg.js`, etc.) that populates `window._i18n`. Apps can read the current language and react to language changes.

### Available APIs

```js
// Current language code ('en', 'bg', ...)
window.mvmOS.lang

// Promise that resolves after the first language file loads
window.mvmOS.i18nReady

// Register a callback fired on every language change
window.mvmOS.onLangChange(callback)
```

### Recommended pattern

Embed your translations directly in `main.js` — no external files needed:

```js
const _myI18n = {
  en: { title: 'My App', hello: 'Hello', items: '{n} items' },
  bg: { title: 'Моето приложение', hello: 'Здравей', items: '{n} елемента' },
};

function _t(key, vars) {
  const lang = window.mvmOS?.lang || 'en';
  let str = (_myI18n[lang] || _myI18n.en)[key] || key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return str;
}

mvmOS.registerApp({
  id: 'my-app',
  name: _t('title'),   // evaluated at load time — will use whatever language is active
  icon: '🚀',
  launch() {
    mvmOS.createWindow({
      id: 'my-app',
      title: '🚀 ' + _t('title'),
      width: 600,
      height: 400,
      onMount(body) {
        // Wait for i18n to be ready before rendering
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => {
          MyApp.init(body);
        });
      }
    });
  }
});

const MyApp = (() => {
  function init(body) {
    body.innerHTML = `<p>${_t('hello')}</p>`;

    // Re-render when the user changes language
    window.mvmOS?.onLangChange(() => init(body));
  }
  return { init };
})();
```

### Key rules

- Always call `_t()` inside your render function, **not** at the top level of the script. The language file may not be loaded yet when the script first runs.
- The `name` field in `registerApp()` is read at load time. Since language scripts load asynchronously, the app name in the store may appear in English on first load. This is acceptable — the name is only used in the App Store listing, not inside the window.
- Use `window.mvmOS?.i18nReady` (optional chaining) so your app works even if run outside mvmOS.
- Call `onLangChange(() => init(body))` inside your `init` function so each new window re-registers the callback without stacking old ones.
- Variable substitution uses `{varName}` syntax: `_t('items', { n: 5 })` → `'5 items'`.

### Supported languages

Currently mvmOS ships with `en` (English) and `bg` (Bulgarian). The language is selected in **Settings → Regional**. Your app does not need to support all languages — if a language is missing from your dict, `_t()` falls back to `en` automatically (via `|| _myI18n.en`).

---

## Widgets

Widgets are small UI components that live on the desktop or in the taskbar. They follow the same store structure as apps but use `mvmOS.registerWidget()` instead of `mvmOS.registerApp()`.

### Widget structure

```
widgets/
  your-widget/
    manifest.json
    main.js
```

### manifest.json

Same fields as apps, plus:

| Field         | Description                                      |
|---------------|--------------------------------------------------|
| `widget_type` | `"desktop"` or `"taskbar"`                       |

### main.js

```js
mvmOS.registerWidget({
  id: 'my-widget',
  type: 'desktop',      // 'desktop' or 'taskbar'
  label: 'My Widget',   // shown in widget store
  defaultX: 20,         // initial desktop position (desktop widgets only)
  defaultY: 60,
  init(container) {
    container.innerHTML = `<div>Hello widget</div>`;

    // subscribe to system resources (CPU, RAM, disk) — called every N seconds
    mvmOS.onResources(data => {
      // data.cpu_pct, data.mem_used, data.mem_total, data.disk_used, data.disk_total
      // data.disks[], data.uptime, data.hostname, data.load
    });
  }
});
```

### i18n for widgets

Same pattern as apps — embed translations and use `onLangChange` to re-render:

```js
const _myW18n = {
  en: { label: 'My Widget', title: 'MY WIDGET' },
  bg: { label: 'Моят уиджет', title: 'МОЯ УИДЖЕТ' },
};
function _wt(key) { const lang = window.mvmOS?.lang || 'en'; return (_myW18n[lang] || _myW18n.en)[key] || key; }

mvmOS.registerWidget({
  id: 'my-widget',
  type: 'desktop',
  label: _wt('label'),
  init(container) {
    function render() {
      container.innerHTML = `<div>${_wt('title')}</div>`;
      mvmOS.onResources(d => { /* update */ });
    }
    render();
    window.mvmOS?.onLangChange(() => render());
  }
});
```

---

## Publishing to the store

1. Fork [mvmrik/mvmos-store](https://github.com/mvmrik/mvmos-store)
2. Add your app folder under `apps/your-app/`
3. Add your app entry to the category `manifest.json` (e.g. `apps/your-category/manifest.json`)
4. Submit a pull request

> **Version must be set in two places:** `apps/your-app/manifest.json` (the app itself) and the category `manifest.json` entry. The update checker reads the version from the category manifest — if you only bump the app's own manifest, users won't see an update notification.

## Using a custom store

You can host your own store by creating a GitHub repo with the same structure. In mvmOS:

**App Store → Stores → Add store** → paste the raw URL to your `manifest.json`

Example:
```
https://raw.githubusercontent.com/yourname/your-store/main/manifest.json
```

Your apps will appear in a separate tab in the App Store and can be installed like any other app.
