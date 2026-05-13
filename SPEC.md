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

// Open Settings on a specific tab
mvmOS.openSettings('display')   // display | regional | filemanager | users | about

// Per-app localStorage (namespaced automatically)
mvmOS.storage.get('key')             // returns value or null
mvmOS.storage.set('key', value)      // value can be any JSON-serializable type
mvmOS.storage.remove('key')

// Push a notification to the taskbar
mvmOS.notify('Title', 'Body text', () => { /* action on click */ }, 'Button label')
```

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
