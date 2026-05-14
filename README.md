# mvmOS Developer Guide

This repository contains apps, widgets and themes for [mvmOS](https://mvmos.mvmrik.com) — a web-based desktop OS.

---

## Table of Contents

1. [Apps](#apps)
2. [Widgets](#widgets)
3. [Themes](#themes)
4. [CSS Variables Reference](#css-variables-reference)
5. [mvmOS API Reference](#mvmos-api-reference)

---

## Apps

### Directory structure

```
apps/
  <category>/
    manifest.json          ← category metadata
    <app-id>/
      manifest.json        ← app metadata
      main.js              ← app code
```

### manifest.json

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "🚀",
  "category": "Utilities",
  "version": "1.0.0",
  "description": "Short description shown in the App Store.",
  "entry": "main.js"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier, kebab-case |
| `name` | ✅ | Display name |
| `icon` | ✅ | Emoji icon |
| `category` | ✅ | Groups apps in the start menu |
| `version` | ✅ | Semver string |
| `description` | ✅ | Shown in App Store |
| `entry` | ✅ | Entry JS file (always `"main.js"`) |

### main.js

Call `mvmOS.registerApp(def)` — the OS loads this file and runs it in a sandboxed `Function` context.

```js
mvmOS.registerApp({
  id: 'my-app',
  name: 'My App',
  icon: '🚀',
  category: 'Utilities',

  launch() {
    mvmOS.createWindow({
      id: 'my-app',          // unique window id
      title: '🚀 My App',
      width: 400,
      height: 300,

      onMount(body) {
        // `body` is the window's content div — build your UI here
        body.innerHTML = `<p style="padding:16px">Hello from My App!</p>`;
      }
    });
  }
});
```

**`mvmOS.createWindow(options)`**

| Option | Type | Description |
|--------|------|-------------|
| `id` | string | Window identifier (only one window per id at a time) |
| `title` | string | Title bar text |
| `width` | number | Initial width in px |
| `height` | number | Initial height in px |
| `onMount(body)` | function | Called once with the content `div` |

**Inside `onMount(body)`**

- `body` is a plain `div` — put any HTML you want inside it.
- The window has minimize, maximize and close buttons built in.
- Use `var(--surface)`, `var(--text)` etc. (see [CSS Variables](#css-variables-reference)) so your app matches the active theme.
- You can use `mvmOS.storage` to persist data across sessions.

### Persistent storage

```js
mvmOS.storage.set('key', { value: 42 });
const data = mvmOS.storage.get('key'); // { value: 42 }
mvmOS.storage.remove('key');
```

Storage is namespaced per key automatically — no collisions between apps.

### Notifications

```js
mvmOS.notify('Title', 'Body text');

// with an action button:
mvmOS.notify('Download ready', 'file.zip is ready.', () => {
  // callback when user clicks the action
}, 'Open');
```

### Fetching data

Apps run in the browser — you can use `fetch()` freely. The OS backend API is available at `/api/*`.

Useful endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/system/resources` | CPU %, memory, disk, uptime, load avg |
| `GET /api/system/hardware` | Hostname, CPU model, RAM total |
| `GET /api/files?path=/some/dir` | List directory |
| `GET /api/files/raw?path=/some/file` | Download/view a file |
| `POST /api/files/write` | Write text to a file (`{ path, content }`) |

---

## Widgets

Widgets are small always-on components that live either on the **desktop** (draggable, positioned) or in the **taskbar** (right side, next to the clock).

### Directory structure

```
widgets/
  <category>/
    manifest.json
    <widget-id>/
      manifest.json
      main.js
```

### manifest.json

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "icon": "📊",
  "category": "System",
  "version": "1.0.0",
  "widget_type": "desktop",
  "description": "Short description.",
  "entry": "main.js"
}
```

`widget_type` is either `"desktop"` or `"taskbar"`.

### main.js — desktop widget

```js
mvmOS.registerWidget({
  id: 'my-widget',
  name: 'My Widget',
  icon: '📊',
  type: 'desktop',
  defaultX: 20,   // initial left position in px
  defaultY: 60,   // initial top position in px

  init(container) {
    // `container` is the widget body div
    // Build your UI here — keep it compact
    container.innerHTML = `
      <div style="width:200px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text)">
        Hello Widget
      </div>
    `;
  }
});
```

The OS wraps your widget automatically with:
- A hover titlebar showing `icon + name` and a close (✕) button
- Drag-to-reposition (drag from the titlebar)
- Position persistence across sessions (saved via `/api/widgets/{id}/position`)

**You do not need to add any of this yourself.**

### main.js — taskbar widget

```js
mvmOS.registerWidget({
  id: 'my-taskbar-widget',
  name: 'My Widget',
  type: 'taskbar',

  init(container) {
    // `container` is a flex div inside the taskbar (right side)
    container.innerHTML = `
      <span style="font-size:.75rem;padding:0 8px;color:var(--text)">Hello</span>
    `;
    setInterval(() => {
      container.querySelector('span').textContent = new Date().toLocaleTimeString();
    }, 1000);
  }
});
```

### System resource data

Both widget types can subscribe to live system data (CPU, memory, disk, uptime) polled every 3 seconds:

```js
mvmOS.onResources(data => {
  // data.cpu_pct      — CPU usage 0–100
  // data.mem_used     — bytes used
  // data.mem_total    — bytes total
  // data.disks        — array of { path, used, total, pct }
  // data.uptime       — human string e.g. "3d 4h 12m"
  // data.hostname     — machine hostname
  // data.load         — { '1': x, '5': y, '15': z }
});
```

### Widget design tips

- Use `var(--surface)` as background and `var(--border)` for borders so the widget automatically adapts to any theme.
- Use `var(--text)` for primary text and `var(--text-dim)` for secondary/label text.
- Keep the width fixed (e.g. `220px`) — widgets don't resize.
- Avoid `backdrop-filter: blur` for performance on slower machines.
- If you need a custom background colour (e.g. a branded widget), set it directly on the inner div — the OS wrapper `container` is transparent.

---

## Themes

### Directory structure

```
themes/
  <theme-id>/
    theme.css     ← CSS variables + optional overrides
    manifest.json ← (optional, used by Theme Store)
```

### theme.css

A theme is a single CSS file that overrides the `:root` variables. You can also add extra rules to change the desktop background, window buttons, fonts etc.

```css
:root {
  --bg:           #0d1117;   /* page / desktop background */
  --surface:      #161b22;   /* windows, panels, widgets */
  --surface2:     #21262d;   /* context menus, dropdowns */
  --border:       #30363d;   /* borders and dividers */
  --text:         #c9d1d9;   /* primary text */
  --text-dim:     #8b949e;   /* labels, secondary text */
  --accent:       #2a6ee0;   /* buttons, links, selections */
  --accent-hover: #1a5ec0;   /* accent on hover */
  --danger:       #da3633;   /* delete, error states */
  --titlebar:     #1c2128;   /* window title bar background */
  --taskbar:      #161b22;   /* taskbar background */
  --shadow:       0 8px 32px rgba(0,0,0,0.7); /* window shadows */
  --radius:       6px;       /* border-radius for windows/widgets */
  --font:         'Segoe UI', system-ui, sans-serif;
  --mono:         'Consolas', 'Menlo', monospace;
}

/* Optional: desktop wallpaper */
#desktop {
  background: linear-gradient(135deg, #0d1117 0%, #0f2027 50%, #0d1117 100%);
}

/* Optional: custom window control button colours */
.wbtn-close { background: #ff5f57; }
.wbtn-min   { background: #ffbd2e; }
.wbtn-max   { background: #28c840; }
```

All variables have fallback values built into the OS, so you only need to define the ones you want to change.

---

## CSS Variables Reference

| Variable | Role |
|----------|------|
| `--bg` | Desktop and page background |
| `--surface` | Windows, sidebars, panels, widgets |
| `--surface2` | Context menus, dropdowns |
| `--border` | All borders and separators |
| `--text` | Primary readable text |
| `--text-dim` | Labels, placeholders, metadata |
| `--accent` | Buttons, selections, active states |
| `--accent-hover` | Hover state for accent elements |
| `--danger` | Destructive actions (delete, error) |
| `--titlebar` | Window title bar background |
| `--taskbar` | Taskbar background |
| `--shadow` | Box-shadow for windows and panels |
| `--radius` | Border-radius used throughout |
| `--font` | UI font stack |
| `--mono` | Monospace font (terminal, code) |

---

## mvmOS API Reference

Global object available in all app and widget scripts:

```
mvmOS.registerApp(def)          — register an app
mvmOS.registerWidget(def)       — register a widget
mvmOS.createWindow(options)     — open a window (call inside launch())
mvmOS.storage.get(key)          — read from namespaced localStorage
mvmOS.storage.set(key, value)   — write to namespaced localStorage
mvmOS.storage.remove(key)       — delete a key
mvmOS.notify(title, body)       — push a notification
mvmOS.notify(title, body, fn, label) — notification with action button
mvmOS.onResources(callback)     — subscribe to system resource updates
```
