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
| `icon`        | ✓        | Emoji or relative path to icon file              |
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
  icon: '🚀',
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

## Publishing to the store

1. Fork [mvmrik/mvmos-store](https://github.com/mvmrik/mvmos-store)
2. Add your app folder under `apps/your-app/`
3. Add your app entry to the root `manifest.json`
4. Submit a pull request

## Using a custom store

You can host your own store by creating a GitHub repo with the same structure. In mvmOS:

**App Store → Stores → Add store** → paste the raw URL to your `manifest.json`

Example:
```
https://raw.githubusercontent.com/yourname/your-store/main/manifest.json
```

Your apps will appear in a separate tab in the App Store and can be installed like any other app.
