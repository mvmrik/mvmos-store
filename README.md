# mvmOS Store

This repository is the official Store of [mvmOS](https://github.com/mvmrik/mvmOS), a web-based desktop OS for your own server. It holds **48 apps, 5 widgets and 4 themes**. mvmOS reads it from the App Store; nothing here has to be installed by hand.

- **[DEVELOPER.md](DEVELOPER.md)** — the complete guide to writing an app: structure, `manifest.json`, `store.json`, `premium.json`, the `mvmOS` API, server code, Apps Hub, public pages, games, i18n and premium.
- **[SPEC.md](SPEC.md)** — the short checklist of the rules every app follows.
- This file — how the repository is laid out, how to run your own store, and the reference for widgets, themes and the shared CSS variables.

---

## Table of Contents

1. [Repository layout](#repository-layout)
2. [Your own store](#your-own-store)
3. [Widgets](#widgets)
4. [Themes](#themes)
5. [CSS Variables Reference](#css-variables-reference)
6. [Following the theme](#following-the-theme)
7. [File uploads](#file-uploads)

---

## Repository layout

```
manifest.json                     ← the app categories, each with its manifest_url
apps/<category>/
  manifest.json                   ← {"apps": [...]}: id, name, name_i18n, icon, category,
                                    version, description, tags, min_core_version, zip_url,
                                    premium (true when the app has Premium)
  <app-id>-<version>.zip          ← the release that mvmOS downloads
source/apps/<app-id>/             ← the source of every app (see DEVELOPER.md → App structure)
source/backend/apps/<app-id>/     ← the rare system backend of an app
widgets/                          ← see Widgets
themes/                           ← see Themes
make-zip.sh                       ← builds an app release zip (and publishes its premium build)
make-premium-zip.sh               ← publishes an app's premium build to mvmos.org
make-core-premium-zip.sh          ← publishes a core premium module to mvmos.org
```

App categories: `ai`, `business`, `communication`, `creative`, `developer-tools`, `finance`, `games`, `health-fitness`, `media`, `productivity`, `security-privacy`, `system-administration`, `utilities`.

An app is written as a folder under `apps/<app-id>/` of a running mvmOS installation, and the official releases are built from it with `make-zip.sh <app-id> <version> <category>`. The script leaves out `store.json`, `premium.json`, the `premium/` folder, uploads and runtime data, and fills `premium` and `name_i18n` in the category entry; `version`, `zip_url` and `min_core_version` of that entry are set to the same release. The store listing on mvmos.org is imported from `store.json` and `premium.json` in `source/`.

---

## Your own store

Any installation can add more stores in **App Store → Stores → + Add store**, with a name and the URL of a `manifest.json`. Two formats are accepted:

```json
{ "version": 2, "categories": [
  { "id": "tools", "name": "Tools", "icon": "🛠️", "manifest_url": "https://example.com/apps/tools/manifest.json" }
] }
```

Each category's manifest is `{"apps": [...]}` exactly as in this repository. A small store can instead list its apps directly:

```json
{ "version": 1, "apps": [
  { "id": "my-app", "name": "My App", "icon": "🚀", "version": "1.0.0", "category": "Utilities",
    "description": "…", "zip_url": "https://example.com/my-app-1.0.0.zip" }
] }
```

Every app needs `id`, `name` and `version`, and a `zip_url` (older stores may still give `base_url` or `js_url` instead). Widget and theme stores are added the same way from their own tabs.

---

## Widgets

Widgets are small always-on components that live either on the **desktop** (draggable, positioned) or in the **taskbar** (right side, next to the clock).

### Directory structure

```
widgets/
  manifest.json                    ← the two widget types: desktop, taskbar
  <type>/
    manifest.json                  ← categories of that type
    <category>/
      manifest.json                ← {"widgets": [...]} with zip_url
      <widget-id>-<version>.zip    ← <widget-id>/manifest.json + <widget-id>/main.js
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

The same object, with `zip_url` instead of `entry`, goes into the category's `manifest.json`.

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

### S/M/L size support

Desktop widgets can declare multiple sizes. The user picks a size via right-click context menu; the chosen size is saved in the main DB and synced across devices.

```js
mvmOS.registerWidget({
  id: 'my-widget',
  name: 'My Widget',
  icon: '📊',
  type: 'desktop',
  defaultX: 20,
  defaultY: 60,
  sizes: ['s', 'm', 'l'],   // declare supported sizes
  defaultSize: 'm',          // default if user hasn't picked one

  init(container, size) {
    // `size` is 's', 'm', or 'l'
    // Called again every time the user switches size
    const width = { s: 180, m: 240, l: 340 }[size] || 240;
    container.innerHTML = `
      <div style="width:${width}px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text)">
        Hello at size ${size}
      </div>
    `;
  }
});
```

| Field | Description |
|-------|-------------|
| `sizes` | Array of supported size codes — any subset of `['s', 'm', 'l']` |
| `defaultSize` | Size used on first install. Defaults to `'m'` if omitted |

- If `sizes` is not declared, `init(container)` is called without a size argument — widget is fixed size
- The chosen size is persisted in the main DB (`widgets.size`) and is the same on all devices
- Standard widths: S = 180 px, M = 240 px, L = 340 px (you can use any width you like)

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

Both widget types can subscribe to live system data, polled every few seconds. The object merges `/api/system/resources` and `/api/system/hardware`:

```js
mvmOS.onResources(data => {
  // data.cpu_pct                 — CPU usage 0–100
  // data.mem_used, mem_total     — bytes
  // data.disk_used, disk_total   — bytes, root filesystem
  // data.disks                   — every mounted disk
  // data.uptime, data.load       — uptime and load averages
  // data.hostname, os, kernel    — machine info
  // data.cpu_model, cpu_cores, cpu_freq_mhz, network, temps, swap_*
});
```

Widget settings (`settings`, `useDb`, `contextMenu`), one file serving two widgets, the no-flicker pattern and installing a widget from inside an app are described in [DEVELOPER.md → Widgets](DEVELOPER.md#widgets).

### Widget design tips

- Use `var(--surface)` as background and `var(--border)` for borders so the widget automatically adapts to any theme.
- Use `var(--text)` for primary text and `var(--text-dim)` for secondary/label text.
- Keep the width fixed within each size — use the `sizes` + `defaultSize` fields if you want S/M/L support.
- Avoid `backdrop-filter: blur` for performance on slower machines.
- If you need a custom background colour (e.g. a branded widget), set it directly on the inner div — the OS wrapper `container` is transparent.

---

## Themes

### Directory structure

```
themes/
  manifest.json                  ← categories: dark, light
  <dark|light>/
    manifest.json                ← {"themes": [...]} with zip_url
    <theme-id>-<version>.zip     ← theme.css + manifest.json
```

The `manifest.json` inside the zip holds `id`, `name`, `icon`, `version` and `layout` (`"macos"` for every current theme). The category entry adds `category`, `description` and `zip_url`.

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

---

## Following the theme


Every app must look right in whatever theme the user picked — light, dark or any theme from the store — both in its desktop window and on its public page. Never hard-code a dark (or light) palette for the app's own chrome: backgrounds, text, borders, buttons, inputs, menus and dialogs all come from theme variables. Test every new or changed app in a light and a dark theme.

The two places get their colours from different variables:

| Where | Variables | Set by |
|-------|-----------|--------|
| Desktop window | `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-dim`, `--accent`, `--accent-hover`, `--danger`, `--font` (see [CSS Variables](#css-variables-reference)) | The OS theme chosen in Settings |
| Public page | `--pub-bg`, `--pub-surface1`, `--pub-surface2`, `--pub-border`, `--pub-fg`, `--pub-fg2`, `--pub-dim`, `--pub-accent`, `--pub-accent-hover`, `--pub-green`, `--pub-red`, `--pub-yellow` | The Apps Hub theme of the visitor (light, dark or auto) |

The desktop does not define the `--pub-*` variables, and the public page does not define the OS ones. An app whose UI is shared between the two therefore maps both onto its own variables and switches set by where it is mounted:

```css
/* Public page: the Apps Hub theme. The fallbacks are the dark palette,
   because a dark Apps Hub theme leaves --pub-* unset. */
.my-app { --my-bg: var(--pub-bg, #1e1e2e); --my-fg: var(--pub-fg, #cdd6f4); --my-accent: var(--pub-accent, #89b4fa); }
/* Desktop window: the OS theme. */
.my-app.in-os { --my-bg: var(--surface); --my-fg: var(--text); --my-accent: var(--accent); }
.my-app { background: var(--my-bg); color: var(--my-fg); }
```

Because both are CSS variables, a theme change applies at once without reloading the app. Colours that belong to the content rather than the app — a white A4 page in a document editor, a chart series, a user-chosen cell colour — may stay fixed. Text placed on an accent colour needs its own variable (for example `--my-on-accent`), since the background colour is not always a readable choice there.

---

## File uploads


mvmOS has a global upload manager (`mvmOS.upload`) available to all apps. It handles chunked uploads (80 MB per chunk, no Cloudflare 100 MB limit), shows a floating OS window with progress and speed, and supports a sequential queue.

```js
mvmOS.upload.start({
  file,                          // File object (from <input type="file"> or drag-drop)
  chunkEndpoint: '/api/files/upload-chunk', // POST endpoint for each chunk
  cancelEndpoint: '/api/files/upload-chunk', // DELETE endpoint to cancel (same path)
  fields: { path: '/home/user/uploads' },    // extra FormData fields sent with every chunk
  accept: ['.sql', '.csv'],      // optional — allowed extensions/MIME types; error shown if violated
  noFinalize: true,              // optional — keep assembled file in /tmp/mvmos-uploads/ instead of moving to dest
  onDone(data) {
    // data.tmp_path — set when noFinalize is true; pass it to your backend for further processing
  },
  onError(msg) { /* upload failed or wrong file type */ },
  onCancel()   { /* user clicked Stop */ },
});
```

If your app starts a long background operation **after** the upload finishes (e.g. importing a large SQL file), update the upload window so the user knows something is still happening:

```js
onDone(data) {
  mvmOS.upload.setStatus('⏳ Processing...', true); // true = pulsing progress bar
  // ... start background job, poll for completion ...
  // when done:
  mvmOS.upload.clearStatus();
}
```

**`accept` values** — extensions (`.sql`), exact MIME types (`image/jpeg`), or wildcard MIME (`image/*`). If the file doesn't match, an error is shown immediately without uploading.

**`noFinalize`** — the assembled temp file stays in `/tmp/mvmos-uploads/<upload_id>_<filename>`. Your backend receives its path via `data.tmp_path` in `onDone`. Your backend deletes it once it is done; anything left behind is removed after 24 hours (younger files are never touched, so slow uploads survive).

**MySQL privileges** — if your app creates or drops MySQL databases via YourSQL or a similar app, the MySQL user needs global `CREATE` and `DROP` privileges:
```sql
GRANT CREATE, DROP ON *.* TO 'youruser'@'localhost';
FLUSH PRIVILEGES;
```
