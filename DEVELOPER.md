# mvmOS Developer Guide

Apps for mvmOS are written in JavaScript and registered via the global `mvmOS` object. Each app consists of a `manifest.json`, a `public/` folder holding everything the browser loads (`main.js`, an optional `style.css`), a `db.json` (if it uses a database), and optionally server code (`api.py`) — see [App structure](#app-structure) below.

---

## App structure

```
apps/<app-id>/
  manifest.json   — metadata
  store.json      — the long store listing for mvmos.org
  premium.json    — premium feature list (only if the app has premium)
  main.js         — logic
  style.css       — styles (optional)
  db.json         — database schema (optional)
  data.db         — the app's own SQLite database (optional)
  api.py          — server code (optional)
  desktop.py      — desktop routes, when api.py grows too big (optional)
  public/         — the only web-reachable folder
```

An app lives entirely inside its own folder, and **that folder is all it can touch** — core mvmOS, other apps and the system are off limits, enforced at runtime (see [Folder isolation](#folder-isolation--enforced)). Whatever it needs from mvmOS it asks the [Platform API](#platform-api) for.

The one exception is an app that must genuinely reach the system — `subprocess`, system files, a local service. That code goes in `backend/apps/<app-id>/backend.py`, and installing such an app [asks the user for their password](#backendappsapp-id--the-exception).

---

## manifest.json

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "🚀",
  "category": "Utilities",
  "tags": ["notes", "planning"],
  "version": "1.0.0",
  "min_core_version": "0.5.12",
  "description": "App description.",
  "entry": "main.js",
  "css": "style.css",
  "settings": [
    { "key": "host", "label": "Host", "type": "text",     "default": "localhost" },
    { "key": "port", "label": "Port", "type": "number",   "default": 8080, "min": 1, "max": 65535 },
    { "key": "user", "label": "User", "type": "text",     "default": "" },
    { "key": "pass", "label": "Pass", "type": "password", "default": "" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier (kebab-case) |
| `name` | yes | Display name |
| `icon` | yes | Emoji icon |
| `category` | yes | App Store category |
| `tags` | no | Array of 1–5 lowercase discovery tags (for example `["notes", "planning"]`). Use short, stable kebab-case terms; tags are for Store search/filters, not extra Start Menu categories. |
| `version` | yes | Semver version |
| `min_core_version` | no | Minimum mvmOS core version required |
| `entry` | no | JS file (default: `main.js`) |
| `css` | no | CSS file |
| `settings` | no | Settings shown in App Store (⚙ button) |
| `trayable` | no | `true` if the app supports System Tray |
| `scheduler` | no | Python file for background scheduled logic (e.g. `"scheduler.py"`) |
| `public_directory` | no | `false` to hide from the Apps Hub public directory card grid even though `public.py` exists — see [Listing in the public directory](#listing-in-the-public-directory). Default `true`. |

### Official Store categories

Use one broad primary category. The official Store currently uses: `Productivity`, `Finance`, `Communication`, `Media`, `Creative`, `Business`, `AI`, `Developer Tools`, `System & Administration`, `Security & Privacy`, `Utilities`, and `Games`.

Do not create a narrow category for one app. Put the app in the closest broad category and use `tags` for specific capabilities, topics, or audiences.

---

## store.json — the listing on mvmos.org

`manifest.json`'s `description` is the one-paragraph blurb the desktop App Store shows on a card. `store.json` is the long form, and it is what [mvmos.org](https://mvmos.org/store) renders on the app's own page.

The site reads it straight from this repository (`source/apps/<app-id>/store.json`) — there is no upload step and no admin form. Commit the file and the site picks it up on its next sync. It is **English only**, because the site is English.

```json
{
  "tagline": "One short line under the app name.",
  "description": "Two or three paragraphs, separated by blank lines.\n\nWhat the app is, who it is for, and how it is actually used.",
  "capabilities": [
    "One general capability per line — what the app can do, not every detail.",
    "8–14 lines suits a full app; 3–5 is right for a small one."
  ],
  "requirements": [
    "Anything external the app needs to work — an API key, a service on the machine."
  ],
  "integrations": [
    {
      "app": "budget",
      "name": "Budget",
      "kind": "app_api",
      "direction": "consumes",
      "summary": "Completing a task with a reward writes the amount into a Budget category.",
      "requires": "Budget installed, and its App API enabled in Apps Hub → Settings → App APIs. The switch is off by default."
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `tagline` | yes | One line, shown under the app name |
| `description` | yes | The long description. `\n\n` separates paragraphs |
| `capabilities` | yes | Array of short capability lines |
| `requirements` | no | External prerequisites. Omit the key when there are none |
| `integrations` | no | Array of integration objects. Omit the key when the app has none |

### Writing integrations

The two directions are written differently on purpose:

- **`"direction": "provides"`** — the app does not know who will call it, so keep it generic: *"Lets other apps add amounts to your categories and read the category list."*
- **`"direction": "consumes"`** — name the other app and describe the exact behaviour: *"A shopping list item marked bought is deducted from the Budget category you picked."*

`kind` tells the reader which door the integration goes through, because they are not gated the same way:

| `kind` | What it is | Gated by |
|--------|------------|----------|
| `app_api` | The Apps Hub app-to-app API — `call_app_api()` from server code, or `POST /api/platform/apps/<id>/call` from the frontend. Both end up at the same gate | **Apps Hub → Settings → App APIs, off by default** |
| `telegram` | The app ships a `telegram.py` adapter and appears in the Telegram Hub bot | Telegram Hub installed with a configured bot |
| `gamehub` | Game Hub profiles, sessions, leaderboards and multiplayer rooms | Game Hub installed |
| `http` | A plain HTTP call to another app's desktop API | the other app installed and configured |

Anything with `"kind": "app_api"` **must** say in `requires` that the toggle is off by default and where to switch it on. Otherwise the feature reads as broken on a fresh install.

Use `"app": ""` with `"name": "Any app"` for a `provides` integration that is open to everything, rather than listing every current consumer.

---

## premium.json — apps with a subscription

Only for apps that ship a `premium/` folder. It is a separate file, not a section of `store.json`, because the premium page on mvmos.org pulls just these — per app, without parsing anything else.

```json
{
  "summary": "One line: what a subscription adds to this app.",
  "features": [
    {
      "title": "App widgets in your pages",
      "short": "Embed another app's widget in a site page",
      "description": "Two or three sentences for the app page: what the feature does, and what happens without it."
    }
  ]
}
```

`short` is what the premium comparison list shows; `title` and `description` are what the app's own page shows. Both forms are required for every feature — the premium page must never have to shorten a description itself.

Describe what happens **without** a subscription too. The base app always stays whole: the control is present and inert, never missing, and nothing breaks. Saying so in the description is what stops the listing reading as a paywall on a broken app.

### Neither file ships to an install

`make-zip.sh` deletes `store.json` and `premium.json` from the archive it builds. They are listing metadata for the website, not app code — and `_install_from_zip()` routes anything it does not recognise into `apps/<id>/public/`, the one folder that *is* served over HTTP.

Note also that `.gitignore` excludes `source/apps/*/premium/` **with a trailing slash**: that matches the premium *directory* (subscriber-only code, never in this repo). `premium.json` is a normal committed file and must stay one.

---

## db.json

Defines the SQLite database schema. On install and update the system automatically creates tables and adds new columns. Existing data is never deleted.

```json
{
  "tables": [
    {
      "name": "cfg",
      "columns": [
        { "name": "key",        "type": "TEXT",    "primary": true },
        { "name": "value",      "type": "TEXT" },
        { "name": "updated_at", "type": "TEXT",    "default": null }
      ]
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `name` | Table name |
| `columns[].name` | Column name |
| `columns[].type` | SQLite type: `TEXT`, `INTEGER`, `REAL`, `BLOB` |
| `columns[].primary` | `true` for PRIMARY KEY |
| `columns[].default` | Default value (optional) |

---

## main.js — registration

```js
mvmOS.registerApp({
  id: 'my-app',
  name: 'My App',
  icon: '🚀',
  category: 'Utilities',
  trayable: true,           // optional — System Tray support
  settings: [               // must match manifest.json
    { key: 'host', label: 'Host', type: 'text', default: 'localhost' },
  ],
  launch() {
    mvmOS.createWindow({
      id: 'my-app',
      title: 'My App',
      icon: '🚀',
      width: 800,
      height: 600,
      onMount(body) {
        // body is the DOM element inside the window
        body.innerHTML = '<p>Hello!</p>';
      },
    });
  },
});
```

---

## mvmOS API

### mvmOS.createWindow(opts)

Opens a window.

```js
mvmOS.createWindow({
  id: 'my-app',           // app id
  title: 'My App',        // title
  icon: '🚀',             // emoji for tray icon
  width: 800,             // initial width (px)
  height: 600,            // initial height (px)
  onMount(body) { ... },  // called on open — body is the DOM element
  appSettings: true,      // show gear button in titlebar
  onAppSettings() { ... } // called when gear button is clicked
});
```

**`appSettings: true` without `onAppSettings`** opens the App Store settings panel for this app directly (same as clicking ⚙ in the App Store listing). This is the standard pattern — define your fields in `manifest.json` and use `appSettings: true` alone.

**`appSettings: true` with `onAppSettings`** calls your custom callback instead. Use this only when you need UI that can't be expressed as manifest settings fields (e.g. dynamic lists). In that case, render the custom UI inside the app window.

---

### mvmOS.db(appId)

Returns an object for accessing the app's SQLite database.

```js
const db = mvmOS.db('my-app');

// Read
const rows = await db.query('SELECT value FROM cfg WHERE key = ?', ['theme']);

// Write
await db.run('INSERT OR REPLACE INTO cfg (key, value) VALUES (?, ?)', ['theme', 'dark']);
```

| Method | Description |
|--------|-------------|
| `db.query(sql, params)` | Executes SELECT, returns array of rows |
| `db.run(sql, params)` | Executes INSERT/UPDATE/DELETE, returns number of affected rows |

---

### mvmOS.notify(title, body, action?, actionLabel?)

Shows a notification in the notification center, for the current user, from the frontend.

```js
mvmOS.notify('Done', 'File saved.');

// With action button
mvmOS.notify('New version', 'v1.2.0 is available.', () => openUpdate(), 'Install');
```

The `action` callback only fires within the browser session that created the notification (it isn't persisted) — it won't run if the user reloads the page and clicks the notification later. If you need the action to survive a reload, notify from the backend instead (see below) and pass `action_app`.

To notify a **different** user (e.g. "someone sent you a message"), or to have the notification survive a page reload, create it from your `backend.py` instead — see [Notifications from your backend](#notifications-from-your-backend) below.

### mvmOS.markNotifsRead(source, ref)

Clears your app's own unread notifications for the current user, matched by `source` + `ref` — the same two values your backend passed to `create_notification()` when it created them. Call this when the user views the underlying content directly, so the notification disappears without them having to open it from the bell icon.

```js
// user opened the conversation with peerId — any pending
// "new message" notification from that specific sender is now stale
mvmOS.markNotifsRead('chat', peerId);
```

This only marks read; it doesn't delete or need to know the notification's id — one call clears every unread notification matching that `source`/`ref` for the current user, which also covers the case where several arrived before the user looked.

---

### mvmOS.openSettings(tab?)

Opens system settings.

```js
mvmOS.openSettings();          // home page
mvmOS.openSettings('apps');    // Apps tab
mvmOS.openSettings('about');   // About tab
```

---

### mvmOS.initMobileSidebar(body)

Automatically adds a ☰ button in the titlebar on mobile, if `body` contains an element with class `.as-sidebar`. No effect on desktop.

```js
onMount(body) {
  body.innerHTML = `
    <div class="as-sidebar">...</div>
    <div class="main-content">...</div>
  `;
  mvmOS.initMobileSidebar(body);
}
```

---

### mvmOS.system

System information and operations.

#### mvmOS.system.resources()

Returns CPU, memory, disk and hardware info.

```js
const data = await mvmOS.system.resources();
// {
//   cpu_pct: 12.5,          // CPU usage %
//   mem_used: 4294967296,   // used memory (bytes)
//   mem_total: 8589934592,  // total memory (bytes)
//   disk_used: 107374182400,
//   disk_total: 536870912000,
//   cpu_model: 'Intel Core i7-...',
//   cpu_cores: 8,
//   cpu_freq_mhz: 3600,
//   hostname: 'mypc',
//   uptime: 86400,          // seconds
// }
```

#### mvmOS.system.processes()

Returns a list of running processes.

```js
const procs = await mvmOS.system.processes();
// [{ pid: 1234, user: 'martin', cpu: 1.5, mem: 0.8, rss: '120 MB',
//    stat: 'S', command: 'firefox' }, ...]
```

#### mvmOS.system.kill(pid, signal?, sudo_password?)

Sends a signal to a process.

```js
await mvmOS.system.kill(1234);                        // SIGTERM
await mvmOS.system.kill(1234, 'SIGKILL');             // SIGKILL
await mvmOS.system.kill(1234, 'SIGTERM', 'mypasswd'); // with sudo
// → { ok: true } or { error: 'permission_denied' }
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `pid` | — | Process PID |
| `signal` | `'SIGTERM'` | `'SIGTERM'` or `'SIGKILL'` |
| `sudo_password` | `''` | Sudo password (if required) |

#### mvmOS.system.services()

Returns a list of registered systemd services.

```js
const services = await mvmOS.system.services();
// [{ name: 'nginx', status: 'active', enabled: true, description: '...' }, ...]
```

#### mvmOS.system.serviceAction(name, action, sudo_password?)

Controls a systemd service.

```js
await mvmOS.system.serviceAction('nginx', 'restart');
await mvmOS.system.serviceAction('nginx', 'stop', 'mypasswd');
// → { ok: true, status: 'inactive' } or { error: 'permission_denied' }
```

| `action` | Description |
|----------|-------------|
| `'start'` | Start |
| `'stop'` | Stop |
| `'restart'` | Restart |
| `'enable'` | Enable on boot |
| `'disable'` | Disable on boot |

---

### mvmOS.fs

File system.

#### mvmOS.fs.list(path)

Lists the contents of a directory.

```js
const entries = await mvmOS.fs.list('/home/user/Documents');
// [{ name: 'file.txt', type: 'file', size: 1024, modified: '...' },
//  { name: 'Photos',   type: 'dir',  size: 0,    modified: '...' }, ...]
```

#### mvmOS.fs.read(path)

Reads a text file.

```js
const { content } = await mvmOS.fs.read('/home/user/notes.txt');
```

#### mvmOS.fs.write(path, content)

Writes a text file.

```js
await mvmOS.fs.write('/home/user/notes.txt', 'Hello!');
// → { ok: true }
```

#### mvmOS.fs.delete(path)

Deletes a file or directory.

```js
await mvmOS.fs.delete('/home/user/old-file.txt');
// → { ok: true }
```

#### mvmOS.fs.mkdir(path)

Creates a directory (including parent directories).

```js
await mvmOS.fs.mkdir('/home/user/new-folder');
// → { ok: true }
```

#### mvmOS.fs.rename(from, to)

Renames or moves a file/directory.

```js
await mvmOS.fs.rename('/home/user/old.txt', '/home/user/new.txt');
// → { ok: true }
```

---

## Widgets

Widgets are registered with `mvmOS.registerWidget()` and come in two types:

| type | Where it appears |
|---|---|
| `'desktop'` | Draggable overlay on the desktop, S/M/L sizes |
| `'taskbar'` | Inline in the taskbar; on mobile shown in the clock/calendar popup |

### Desktop widget

```js
mvmOS.registerWidget({
  id:          'my-widget',
  name:        'My Widget',
  icon:        '📊',
  type:        'desktop',
  defaultX:    20,
  defaultY:    80,
  defaultSize: 'm',
  sizes:       ['s', 'm', 'l'],

  init(container, size) {
    // Called once on mount AND again on size change.
    // Always set cssText = (not +=) to avoid style bleed between sizes.
    const w = { s: 180, m: 240, l: 320 }[size] || 240;
    container.style.cssText = `width:${w}px;background:var(--surface);border-radius:10px;color:var(--text)`;
    container.innerHTML = `<div style="padding:12px">Hello at size ${size}</div>`;
  },
});
```

### Taskbar widget

```js
mvmOS.registerWidget({
  id:   'my-taskbar-widget',
  name: 'My Widget',
  icon: '📊',
  type: 'taskbar',

  init(wrap) {
    // wrap is a flex div, height:100%, already in the taskbar.
    wrap.innerHTML = `<span style="padding:0 8px;font-size:.75rem;color:var(--text)">Hello</span>`;
    // Click to open an app:
    wrap.addEventListener('click', () => mvmOS.openApp('my-app'));
  },
});
```

On mobile, taskbar widgets are hidden from the bar and appear in the clock/calendar popup when the user taps the clock.

### One file, two widgets

An app can ship both a desktop and a taskbar widget in a single `widget.js`. Use a guard so the file is safe to reload (re-install, hot-reload):

```js
// apps/my-app/widget.js
(function () {
  if (window._myWidgetRegistered) return;
  window._myWidgetRegistered = true;

  let _lastData = null;   // shared cache — instant display on size change

  async function refresh(container, size) {
    const r = await fetch('/api/apps/my-app/data');
    _lastData = await r.json();
    render(container, _lastData, size);
  }

  mvmOS.registerWidget({
    id: 'my-app-widget', type: 'desktop', sizes: ['s','m','l'], defaultSize: 'm',
    init(container, size) {
      container._built = false;                    // reset on size change
      container.style.cssText = `width:${({s:180,m:240,l:320})[size]}px;...`;
      if (_lastData) render(container, _lastData, size);  // instant — no flash
      refresh(container, size);
      if (container._timer) clearInterval(container._timer);
      container._timer = setInterval(() => refresh(container, size), 60000);
    },
  });

  mvmOS.registerWidget({
    id: 'my-app-taskbar', type: 'taskbar',
    init(wrap) {
      wrap.innerHTML = `...`;
      wrap.addEventListener('click', () => mvmOS.openApp('my-app'));
      setInterval(async () => {
        const r = await fetch('/api/apps/my-app/data');
        _lastData = await r.json();
        renderTaskbar(wrap, _lastData);
      }, 60000);
    },
  });
})();
```

### No-flicker pattern (desktop widgets)

Split DOM building from value updates so refreshes don't recreate the DOM:

```js
function buildSkeleton(container, size) {
  if (container._built) return;
  container._built = true;
  container.innerHTML = `<div id="my-val">—</div>`;
}

function updateValues(container, data) {
  const el = container.querySelector('#my-val');
  if (el) el.textContent = data.value;
}

// In init():
buildSkeleton(container, size);
if (_lastData) updateValues(container, _lastData);
refresh(container, size);
```

Reset `container._built = false` at the top of `init()` — `init` is called again on size change with the same container.

### Installing a widget from inside an app

Add a button in the app UI that calls `/api/widgets/install`:

```js
await fetch('/api/widgets/install', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id:          'my-app-widget',
    name:        'My Widget',
    icon:        '📊',
    category:    'System',
    version:     '1.0.0',
    description: '...',
    widget_type: 'desktop',   // or 'taskbar'
    js_url:      location.origin + '/apps/my-app/widget.js',
  }),
});
```

The backend fetches `js_url`, saves it to `/widgets/<id>/main.js` and registers it in the DB. On next page load the system loads it automatically.

Hot-load immediately after install (no page reload):

```js
window._myWidgetRegistered = false;
const s = document.createElement('script');
s.src = '/apps/my-app/widget.js?_=' + Date.now();
document.head.appendChild(s);
```

### mvmOS.openApp(id)

Opens an installed app by plugin ID. Safe to call from any widget:

```js
mvmOS.openApp('server-monitor');
```

### window._vosSettings — user preferences

Read-only object with the current user's regional settings. Available in all apps and widgets.

```js
window._vosSettings?.timezone      // IANA timezone, e.g. "Europe/Sofia"
window._vosSettings?.time_format   // "24" or "12"
window._vosSettings?.date_format   // "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"
window._vosSettings?.week_starts   // "monday" or "sunday"
window._vosSettings?.language      // "en" or "bg"
```

Updates live when the user changes settings:
```js
window.addEventListener('settings-changed', e => {
  const s = e.detail; // same shape as _vosSettings
});
```

Time formatting pattern (respects user's 12/24h preference):
```js
date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: (window._vosSettings?.time_format === '12') })
```

### mvmOS.onResources(fn)

Subscribes to system resources (CPU, memory, disk) — updated every 3 seconds. Use in widgets instead of making separate requests.

```js
mvmOS.onResources(data => {
  el.textContent = data.cpu_pct + '%';
});
```

### mvmOS.widgetSetting(id, key, default?)

Reads a widget setting from localStorage.

```js
const unit = mvmOS.widgetSetting('my-widget', 'unit', 'c');
```

### mvmOS.widgetDb(widgetId)

Returns a DB object for a widget — same interface as `mvmOS.db()`.

```js
const db = mvmOS.widgetDb('my-widget');
await db.run('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)');
```

---

## Server code — api.py

An app's server code lives in **`apps/<app-id>/api.py`**, alongside the rest of the app. It is loaded in-process and may declare either or both of these routers:

| Object | Mounted at | Who can reach it |
|---|---|---|
| `router` | `/pub/<app-id>` | Public page — Apps Hub token (`X-Pub-Token`) |
| `desktop_router` | `/api/apps/<app-id>` | Desktop window — behind the mvmOS session |

```python
import os
import sqlite3
import sys
from fastapi import APIRouter, Depends

current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter()           # optional — only if the app has a public page
desktop_router = APIRouter()   # optional — only if the app has a desktop window

_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@desktop_router.get("/items")
async def items(session=Depends(current_session)):
    with _conn() as c:
        rows = c.execute("SELECT * FROM items WHERE user=?",
                         (session["effective_user"],)).fetchall()
    return [dict(r) for r in rows]
```

If the desktop half grows large, put it in its own **`apps/<app-id>/desktop.py`** instead; its `router` is mounted at `/api/apps/<app-id>` exactly as `desktop_router` would be.

### Folder isolation — enforced

**An app can only touch its own folder.** While `api.py` is loading and while its routes are running, `open()` and `sqlite3.connect()` are confined to `apps/<app-id>/`. This is not a guideline — it raises `AppIsolationError`, and an app that does it at module level does not load at all.

```python
# Allowed — inside the app's own folder:
sqlite3.connect(os.path.join(os.path.dirname(__file__), "data.db"))
open(os.path.join(os.path.dirname(__file__), "public", "config.json"))

# AppIsolationError:
sqlite3.connect("../../data.db")        # core mvmOS database
sqlite3.connect("../budget/data.db")    # another app's database
open("/etc/passwd")                     # system files
```

Anything the app needs from mvmOS itself — the install's currency, who is logged in, credits, another app — goes through the **[Platform API](#platform-api)**. If something has no endpoint yet, it gets one; that is the whole point of it being a documented, shared contract rather than private access.

---

## Platform API

The documented way an app gets anything from outside its own folder. Every endpoint is the same for every app and every third-party developer — nothing is handed to an app privately.

Inside `api.py` these are plain function calls (same process — do **not** make an HTTP request to your own server):

```python
import sys

cfg = sys.modules["backend.platform_api"].get_settings()
currency    = cfg["currency"]     # "EUR"
date_format = cfg["date_format"]  # "DD/MM/YYYY"
```

From a public page or any frontend, the same data over HTTP:

| Endpoint | Returns |
|---|---|
| `GET /api/platform/settings` | `{currency, locale, date_format}` — install-wide settings |
| `GET /api/platform/whoami` | `{user, pub_user_id, pub_user_name}` — who is calling |
| `GET /api/platform/apps` | `{apps: [...]}` — installed app ids, for feature detection |
| `POST /api/platform/apps/{id}/call` | Call another app's `api.py` (its API must be enabled in Apps Hub) |
| `GET /api/platform/credits` | `{balance}` — Apps Hub credits for the caller |
| `POST /api/platform/credits/spend` | Spend credits; `402` when short. Always send `idempotency_key` |
| `POST /api/platform/notify` | Raise an mvmOS notification for the logged-in desktop user |
| `GET /api/platform/premium` | `{premium, build}` — is this install licensed, does `?app_id=` have its build |

```js
const cfg = await fetch('/api/platform/settings').then(r => r.json());

const who = await fetch('/api/platform/whoami', {
  headers: { 'X-Pub-Token': token }   // only needed on a public page
}).then(r => r.json());
```

Never send a user id from the client — `POST /apps/{id}/call` fills `user_id` in from the account actually making the request, so no app can act on behalf of someone else.

---

## Premium features

A premium module is **ordinary app code**. It lives in `apps/<app-id>/premium/` and is loaded confined to the app's own folder, exactly like `api.py`. Needing premium is **not** a reason for an app to have a backend.

### What actually protects it

Not a check — **delivery**. `premium.zip` is hosted on mvmos.org and never travels in the public store zip (`make-zip.sh` skips any `premium/` directory). On every install and update, `sync_premium()` wipes `premium/` and re-fetches it **only** if the installation holds a valid licence. The licence key never leaves the server and is never sent to the frontend.

So an unlicensed install does not have the premium code at all. There is no local decision to bypass, no flag to flip, no function to patch — the file is absent.

```
licensed install:    apps/my-app/premium/backend.py   ← fetched from mvmos.org
unlicensed install:  (nothing)                        ← load_premium_backend() → None
```

### The base app stays whole

Schema, settings, checkboxes — all of it stays in the app regardless of licence. What is premium is only **whether the control does anything**. An app with no premium build, or a lapsed licence, just leaves the control inert. It never disappears and the app never breaks.

**Base app** (`api.py`) — always degrade gracefully:

```python
import sys


def _feature_enforced(x):
    mod = sys.modules["backend.premium"].load_premium_backend("my-app")
    if mod is None or not hasattr(mod, "is_enforced"):
        return False   # no premium build: the stored value stays inert
    return mod.is_enforced(x)
```

**Premium half** (`apps/my-app/premium/backend.py`) — always re-check `is_premium()`:

```python
import sys


def is_enforced(x):
    # This file being here proves you were licensed when it was fetched, not
    # that you still are: a licence that lapses after install leaves it behind.
    # Check every time — the heartbeat keeps the answer at most 10 min stale.
    if not sys.modules["backend.premium"].is_premium():
        return False
    base = sys.modules["app_public_my-app"]
    ...
```

That runtime check exists **only** for expiry. Everything else is handled at install/update time by not delivering the code.

### GET /api/platform/premium

For deciding what the UI **offers** — a badge, an upsell, a disabled control — never for protecting a feature:

```js
const p = await fetch('/api/platform/premium?app_id=my-app').then(r => r.json());
p.premium  // this installation holds a valid licence
p.build    // this app's premium/ code is actually on disk
```

Do not gate anything real on this. Anything the frontend can read, a user can lie about — that is fine, because lying only unlocks code they were never sent.

### Publishing

```bash
/var/www/mvmos-store/make-premium-zip.sh <app-id>
```

Packages `source/apps/<id>/premium/` flat into `premium.zip` on mvmos.org. Republish it in the same turn as any change to `premium/` — otherwise the old build stays live with nothing to signal it.

---

## backend/apps/&lt;app-id&gt;/ — the exception

Work that **structurally cannot** go through an endpoint — running `subprocess`, reading system files, driving another service on the machine — goes in `backend/apps/<app-id>/backend.py`. Code there is not confined.

That is exactly why **installing such an app asks the user for their password**. The bar is high, and most apps never clear it:

- ✅ `yoursql` connecting to a real database server, `git-manager` running `git`, `server-monitor` reading `/proc`
- ❌ the app's own SQLite database, a public page, an API for its own frontend — all of these belong in `api.py`

If an app needs something it cannot do and no endpoint covers, the answer is a new Platform API endpoint, not a backend. A backend is the last resort.

**WebSockets** belong in `backend/apps/<app-id>/` — an app using one cannot run isolated from `apps/<app-id>/`, so a backend is what it takes, same as `subprocess` or system files. A WS route in `api.py` is not supported.

```python
import sys
from fastapi import APIRouter, Depends

get_current_session = sys.modules["backend.auth"].get_current_session
router = APIRouter(prefix="/api/my-app", tags=["my-app"])

@router.get("/data")
async def get_data(session=Depends(get_current_session)):
    return {"hello": "world"}
```

**Rules:**
- The file must define a `router` object at module level
- All endpoints must require `session=Depends(get_current_session)` for authentication
- The prefix must be unique — recommended `/api/<app-id>`

---

## Notifications from your backend

`mvmOS.notify()` (above) only posts for the current session's user. To notify a **different** user — e.g. "someone sent you a message" — or to make a notification survive a page reload (via a real action app instead of an in-memory callback), create it from `backend.py` using the shared `backend.notifications` module, the same `sys.modules` pattern used for Apps Hub:

```python
import sys

def _notify(username, title, body, ref=None):
    notif = sys.modules.get("backend.notifications")
    if not notif:
        return
    notif.create_notification(
        username, title, body,
        kind="push",            # "push" = toast + auto-hides; "persistent" = stays until dismissed
        source="my-app",        # your app id — namespaces `ref` so it can't collide with other apps
        action_app="my-app",    # optional: clicking the notification launches this app
        ref=None,               # optional: an id for the exact thing this is about (see below)
    )
```

If your app only knows a recipient's user `id` (not their `username`), resolve it first via Apps Hub's [`get_users_by_ids`](#looking-up-other-users):

```python
hub = sys.modules.get("backend.apphub")
users = hub.get_users_by_ids([recipient_id])
if users and users[0].get("username"):
    _notify(users[0]["username"], "New message", body, ref=sender_id)
```

### The `ref` field — precise "mark read on view"

`ref` is an opaque string you choose — it means whatever you want it to mean (a conversation partner's user id, a document id, an order id...). It exists so your app's frontend can clear *exactly* the notifications about one specific thing, the moment the user looks at that thing directly, instead of making them dig through the bell icon:

1. Backend creates the notification with `source="my-app"` and e.g. `ref=sender_id`.
2. Later, when the user opens that specific conversation/document/order in your app, your frontend calls `mvmOS.markNotifsRead('my-app', sender_id)`.
3. Only notifications matching *both* `source` and `ref` for the current user flip to read — notifications about other conversations stay unread, so the user still sees they have something new elsewhere.

If you don't need this precision, just omit `ref` (or leave it `None`) — the notification then only clears via the bell icon / Notifications app, same as a plain `mvmOS.notify()` call. Chat uses this exact pattern: `ref` is the sender's user id, and opening that sender's thread clears just their pending notification.

---

## Startup Manager

If your app has a **background loop** that must run continuously (e.g. periodic metric collection, a WebSocket server, a polling task), define an `on_startup()` async function in `backend.py`:

```python
async def on_startup():
    _ensure_loop()   # or any async init logic
```

When defined, the app appears in the system **Startup Manager** (Start → Applications → System → 🚀 Startup). The user can enable it with a toggle — if enabled, `on_startup()` is called automatically every time the mvmOS backend starts, even after a manual restart from the terminal.

**When you need it:**
- Your backend has a loop that runs every N seconds (monitoring, data collection)
- You start background asyncio tasks that must always be running

**When you don't need it:**
- Your app only responds to HTTP requests — those work automatically without `on_startup()`
- Scheduled tasks via `scheduler.py` — those are handled by the scheduler system

**Pattern:**

```python
import asyncio

_loop_task = None

def _ensure_loop():
    global _loop_task
    if _loop_task is None or _loop_task.done():
        try:
            _loop_task = asyncio.get_event_loop().create_task(_my_loop())
        except RuntimeError:
            pass

async def _my_loop():
    while True:
        await _do_work()
        await asyncio.sleep(60)

async def on_startup():
    _ensure_loop()
```

---

## i18n

Define your own dictionary inside `main.js`:

```js
const _i18n = {
  en: { title: 'My App', hello: 'Hello' },
  bg: { title: 'Моето приложение', hello: 'Здравей' },
};
const _t = k => _i18n[mvmOS.lang]?.[k] || _i18n.en[k] || k;
```

System UI strings (in `frontend/i18n/`) are not touched by apps.

---

## System Tray

To support minimizing to tray:

```js
mvmOS.registerApp({
  id: 'my-app',
  trayable: true,   // ← this is all that's needed
  ...
});

mvmOS.createWindow({
  id: 'my-app',
  icon: '🚀',       // ← used as the tray icon
  ...
});
```

The system automatically adds a "Close to Tray" setting in App Store. No additional logic needed.

---

## Version requirements

If the app requires functionality from a specific version of mvmOS core:

```json
"min_core_version": "0.5.12"
```

When installing on an incompatible system the user receives an error message.

**Rule:** add `min_core_version` whenever you rely on new core functionality.

---

## mvmOS App Scheduler

Allows apps to execute background logic on a schedule — without the browser being open.

### How it works

1. The user installs **Cron Manager** and enables the mvmOS Scheduler (installs a system cron `* * * * *`)
2. Every minute Linux cron calls `POST /api/scheduler/tick`
3. Core reads the manifests of all installed apps
4. If an app has a `"scheduler"` field → runs the specified Python file

### Step 1 — add to manifest.json

```json
{
  "id": "my-app",
  "scheduler": "scheduler.py"
}
```

### Step 2 — create apps/\<app-id\>/scheduler.py

```python
def run(now, db_path, config):
    """
    now       — datetime object with the current time
    db_path   — full path to the app's SQLite DB (may not exist yet)
    config    — dict of app settings from the cfg table
    """
    # Example: runs every day at 09:00
    if now.hour == 9 and now.minute == 0:
        do_something()

    # Example: runs on the 1st of every month at 09:00
    if now.day == 1 and now.hour == 9 and now.minute == 0:
        send_monthly_emails(db_path, config)
```

### Accessing the app's DB

```python
import sqlite3

def run(now, db_path, config):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    users = conn.execute("SELECT * FROM users").fetchall()
    conn.close()
```

### Notes

- `scheduler.py` goes in `apps/<app-id>/scheduler.py`, beside `api.py` — it is loaded the same confined way, and does **not** need a `backend/apps/<app-id>/` of its own. `backend/apps/<app-id>/scheduler.py` is the older location, still honoured for apps that already have an approved backend for other reasons.
- If the app only needs scheduled logic → only `scheduler.py`, nothing in `backend/apps/<app-id>/`
- If the file is missing, core skips it silently
- Runs every minute — the file itself decides when to act using `if now.hour == X`
- Errors are logged in the `/api/scheduler/tick` response and do not stop other apps

---

## Apps Hub integration

Apps Hub is the central public identity system for mvmOS. It provides user accounts that work both inside the OS and on public-facing pages of apps.

### Requiring login before the app opens

Add `requires_apphub: true` to `registerApp`. The OS will open Apps Hub automatically if the user is not logged in, and only open your app's window after a successful login. No additional code needed.

```js
mvmOS.registerApp({
  id: 'my-app',
  requires_apphub: true,   // ← one line — everything else is automatic
  launch() {
    mvmOS.createWindow({ ... });
  },
});
```

Flow:
- User not logged in → Apps Hub opens → user logs in → your app opens
- User already logged in → your app opens immediately

### Reading the current user in your app

After the window opens, the user is guaranteed to be logged in. Read the token and profile:

```js
const token = AppHub.getToken();   // string or null

const me = await fetch('/api/pub/apphub/me', {
  headers: { 'X-Pub-Token': token }
}).then(r => r.ok ? r.json() : null);
// me: { id, username, display_name, avatar_color, avatar_svg }
```

Pass the token to your backend via the `X-Pub-Token` header on every request.

### Backend: identifying the caller

```python
import sys

def _pub_user(token):
    hub = sys.modules.get("backend.apphub")
    if not hub or not token:
        return None
    return hub.get_pub_session(token)

@router.get("/my-data")
async def get_data(session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    # u["id"] is the user's stable public ID
    return {"user": u["id"], ...}
```

`get_pub_session` validates the token and returns `{ id, username, display_name, avatar_color }`, or `None` if invalid/expired.

### Looking up other users

Your app will often store just a user's `id` (e.g. as the sender of a message, or a favourited contact) without holding their session token. Apps Hub exposes shared helpers so every app renders the same display name/avatar instead of re-implementing lookups:

**Bulk profile lookup**, in-process from your backend:

```python
import sys

def _hub():
    return sys.modules.get("backend.apphub")

hub = _hub()
users = hub.get_users_by_ids(["uid1", "uid2", "uid3"])
# -> [{ id, username, display_name, avatar_color, avatar_svg }, ...]
# unknown/missing ids are silently skipped, order is not guaranteed
```

**Search by username/display name**, either in-process or over REST:

```python
results = hub.search_users("joh", exclude_id=me["id"], limit=20)
# -> same shape as get_users_by_ids; substring match, min 2 chars or returns []
```

```http
GET /api/pub/apphub/search?q=joh
```

### Favourites

Apps Hub keeps one shared favourites list per user — so "starred contacts" is the same list in Chat, Game Hub, or any other app, instead of every app tracking its own.

```python
hub.get_favourites(user_id)                 # -> list of full profile dicts, ordered by display_name
hub.add_favourite(user_id, favourite_id)    # raises ValueError("Cannot favourite yourself" / "User not found")
hub.remove_favourite(user_id, favourite_id)
```

REST equivalents (all require `X-Pub-Token`):

```http
GET    /api/pub/apphub/favourites
POST   /api/pub/apphub/favourites/{fav_id}
DELETE /api/pub/apphub/favourites/{fav_id}
```

### Syncing your own users into Apps Hub

If your app keeps its own user/player accounts (its own signup, its own login) rather than requiring Apps Hub login, you can still make those users searchable, favouritable and lookup-able by other apps by syncing them in:

```python
hub.sync_user_from_backend({
    "id": pid,                    # your own stable user id — reused as the Apps Hub id
    "username": uname,
    "display_name": dname,
    "avatar_color": "#89b4fa",    # optional
    "password_hash": phash,       # optional — only if you want it copied, e.g. during a migration
    "avatar_data": None,          # optional
    "avatar_svg": None,           # optional
    "created_at": now,            # optional — defaults to now
})
```

Safe to call repeatedly (insert-or-update): call it once when the user is created, and again any time `display_name`/`avatar_color`/etc. change. Omitted optional fields are left untouched on updates. Game Hub uses this so players created before Apps Hub existed — and any created since through Game Hub's own signup — still show up in search/favourites everywhere else.

### Public page (optional)

If your app also has a page accessible without logging into mvmOS, declare a `router` in your `apps/<app-id>/api.py` (or its `desktop.py`-style companion) — the same file described in [Server code — api.py](#server-code--apipy). Apps Hub admin auto-detects any app whose `api.py` exposes a `router` and shows an enable/disable toggle. `backend/apps/<app-id>/public.py` is the older location, still honoured for apps that already have an approved backend.

**Minimum template:**

```python
"""
Pattern:
1. Declare `router` in api.py → Apps Hub detects it and shows an admin toggle.
2. Call hub.is_app_public(APP_ID) to guard all routes — this is not automatic,
   core mounts the router unconditionally at startup.
3. HTML page handles auth client-side (redirect to /pub/apphub/?next=...).
4. API endpoints validate X-Pub-Token via hub.get_pub_session().
"""

import os, sys
from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from typing import Optional

router = APIRouter(tags=["my-app-public"])
APP_ID = "my-app"   # ← only thing to change

_DIR = os.path.join(os.path.dirname(__file__), "public")

def _hub():
    return sys.modules.get("backend.apphub")

def _pub_user(token):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None

def _private():
    return HTMLResponse("<html><body>This app is private.</body></html>")

@router.get("/")
async def index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private()
    return FileResponse(os.path.join(_DIR, "index.html"))

@router.get("/data")
async def get_data(x_pub_token: Optional[str] = Header(default=None)):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    return {"user_id": u["id"], "data": [...]}
```

The public page is served at `/pub/<app-id>/` once the admin enables it in Apps Hub. `_DIR` here is `apps/<app-id>/public/` — the same folder `main.js`/`index.html` already live in — not a separate location.

### Public page PWA (automatic)

Public apps do not implement their own PWA files. Once an app has `public.py`, exposes `/pub/<app-id>/`, and an Apps Hub administrator enables its public page, mvmOS core automatically supplies:

- a web app manifest scoped to `/pub/<app-id>/`;
- PNG icons generated from the app's `icon` in `manifest.json`;
- a service worker and the browser's normal install flow.

There is no `manifest.webmanifest`, service-worker file, or install button for the app author to create. The install prompt is controlled by the browser and only appears when that browser allows it. `public_directory: false` only hides the app from the Apps Hub directory; it does not disable its PWA.

To redirect unauthenticated visitors to login:

```js
// In your public/index.html
const token = localStorage.getItem('apphub_token');
if (!token) {
  location.href = `/pub/apphub/?next=${encodeURIComponent(location.href)}`;
}
```

**Important:** `is_app_public(APP_ID)` must be checked at the top of **every** route in your `public.py`, not just `/`. The router is mounted unconditionally at startup — nothing enforces the private/public toggle for you except this check. Forgetting it on even one route means that route stays reachable while the app is set to Private in Apps Hub.

### Theming & text size on public pages

Every `/pub/<app-id>/` page automatically gets a shared header/footer (breadcrumb, avatar menu, credits, logout) injected server-side — you never add this yourself. That same injected script also applies the user's **Apps Hub appearance settings** (dark/light theme + text size) to your page, but only if your CSS is written to react to it. Two things to know:

**1. Theme — use CSS custom properties, never hardcoded colors.**

The injected script overrides a fixed set of CSS variables on `:root` when the user picks the light theme (dark is the default baked into your own CSS, so it does nothing). There are two naming sets — pick the one that matches how your page is structured:

- `--bg`, `--fg`, `--fg2`, `--surface1`, `--surface2`, `--border`, `--accent`, `--green`, `--red`, `--yellow` — unprefixed, for a **standalone public page** with its own `:root` (a generic landing page, a leaderboard, etc.)
- `--pub-bg`, `--pub-fg`, `--pub-fg2`, `--pub-surface1`, `--pub-surface2`, `--pub-border`, `--pub-dim`, `--pub-crust`, `--pub-accent`, `--pub-accent-hover`, `--pub-green`, `--pub-red`, `--pub-yellow`, `--pub-warning` — prefixed, for a **shared widget** that can also be mounted inside a desktop window (like Budget/Chat/Calendar's public widgets do) — the prefix keeps the public-theme override from ever leaking into the desktop shell's own unprefixed `--bg`/`--accent`/etc.

Write every color in your public page's/widget's CSS as `var(--pub-fg, #cdd6f4)` (prefixed set) or `var(--fg, #cdd6f4)` (unprefixed set) — never a bare hex value — with your normal dark-theme color as the fallback. If you skip this, your page will simply ignore the user's light-theme choice; nothing errors, it just won't catch.

**2. Text size — build layout with `rem`/flex-wrap, not fixed `px` assumptions.**

The user can pick one of six text sizes (`sm` 90% → `xxxl` 155%), applied as `html{font-size:X%}`. Everything sized in `rem`/`em` scales with it automatically — that part is free. What's *not* free: any container width you set in fixed `px` (grid card `minmax(240px, 1fr)`, a fixed-width sidebar, etc.) stays the same physical size while the text inside it grows, so cramped layouts (icon-button rows next to a title, badges next to text) can start wrapping mid-word or overlapping at the larger sizes. When laying out anything with text next to controls:

- Prefer stacking (title on its own row, actions below) over a tight `justify-content:space-between` row once more than 2-3 short items are involved.
- Add `flex-wrap: wrap` on rows that mix text and buttons, so at large sizes the row wraps as a whole instead of squeezing.
- Give text elements `white-space: nowrap` if they're short labels/badges that should never break mid-word — let the *layout* wrap, not the word.
- Test your public page at the `xxxl` setting (Apps Hub → avatar menu → Settings → Text size) before shipping, the same way you'd test a narrow mobile width.

**Opting out:** if your public page fully owns its own theming (e.g. it's meant to look identical regardless of the viewer's Apps Hub preferences) and doesn't use the shared chrome at all, set `"public_chrome": false` in `manifest.json` — this suppresses the header/footer/theme injection entirely (also hides the footer's "Public page" link). Most apps should *not* set this; it means your page won't follow the user's chosen theme/text size at all.

### App-to-app API (optional)

If your app's backend wants to let *other* apps call into it — e.g. a Tasks app crediting a reward into a Budget category — don't reach into another app's database or import its code directly. Expose a Python API instead, the same opt-in-file-plus-admin-toggle pattern as a public page:

Create `apps/<app-id>/app_api.py` — a separate file from `api.py`, since `api.py` already holds the app's own routes. Apps Hub auto-detects it and shows an admin enable/disable toggle (**Apps Hub → Settings → App APIs**, off by default). No HTTP framework needed; calls happen in-process. `backend/apps/<app-id>/api.py` is the older location, still honoured for apps that already have an approved backend.

**Minimum template:**

```python
"""
Pattern:
1. Create this file → Apps Hub detects it and shows an admin toggle.
2. Export plain functions — whatever you're willing to let other apps call.
3. Never touch another app's DB directly, and never let another app import
   this file directly — everything goes through hub.call_app_api().
"""

def list_categories(user_id):
    # reuse your own public.py / backend helpers here
    ...
    return [...]

def add_to_category(user_id, category_id, amount, reason="", idempotency_key=None):
    # validate, dedupe on idempotency_key, insert, return the new balance
    ...
    return {"balance": ...}
```

**Calling another app's API from your own backend:**

```python
import sys

def _hub():
    return sys.modules.get("backend.apphub")

hub = _hub()
try:
    result = hub.call_app_api("budget", "add_to_category", user_id, category_id, 500, reason="task reward", idempotency_key=my_uuid)
except hub.AppApiError:
    # target app not installed, its API is disabled, or it doesn't expose this method —
    # a normal, expected outcome, not a bug. Degrade gracefully.
    pass
```

`call_app_api(target_app_id, method, *args, **kwargs)` is the *only* sanctioned way to reach another app — it checks the admin toggle, loads `api.py` on first use (cached after), and calls `method` with whatever args/kwargs you pass. It raises `AppApiError` if the target app has no `api.py`, its API is disabled, or it doesn't expose that method; always catch this and degrade gracefully rather than letting it bubble up, since "the other app isn't installed" is routine, not exceptional.

**Never import another app's `api.py` directly** (`from backend.apps.budget import api` or similar) — always go through `hub.call_app_api()`, even though nothing currently stops a direct import. Apps are expected to become fully sandboxed from each other over time; `call_app_api()` is designed to be the one channel that keeps working after that happens, but only if it's actually used consistently everywhere, starting now.

If your API method changes money, credits, or anything else where a retried call must not double-apply, accept an `idempotency_key` argument and dedupe on it (mirrors the pattern `hub.spend_credits()`/`hub.grant_credits()` already use) — a caller may legitimately retry after a timeout without knowing whether the first attempt succeeded.

### Window footer

Every window (desktop, not mobile-fullscreen) gets a shared footer, rendered centrally by `Desktop.createWindow`. You don't add anything for the "mvmOS" branding on the left — that's automatic — but you can put your own content in it.

**Your own content:**

`createWindow` returns the window element with a `.footer` handle:

```js
const win = await mvmOS.createWindow({ id: 'my-app', title: 'My App', onMount(body) { ... } });
win.footer.setContent('3 items · last synced 2m ago');
// win.footer.clear() to remove it again
```

`setContent(html)` replaces only your slot in the footer — it's safe to call repeatedly (e.g. on every status update), the same way File Manager updates its own status bar, except this one is shared chrome instead of app-owned space. It accepts HTML, so links/icons work too; escape any user-controlled text yourself.

**Public page link:**

The right side also shows a "🔗 Public page" link, but only if your `manifest.json` declares `public_url`:

```json
{
  "id": "my-app",
  "public_url": "/pub/my-app/"
}
```

This only makes sense if your app has a `public.py` (see above) with a real generic landing page at `/pub/<app-id>/` — the footer link doesn't check `is_app_public`/enable state itself, it just links there. If you don't have a public page, omit the field and the link simply doesn't appear.

### Listing in the public directory

Any app with a `public.py` is auto-detected and, once enabled (toggled Public) in Apps Hub admin, appears as a card in the public directory at `/pub/apphub/` (the "Apps" tab) linking to `/pub/<app-id>/`.

This only makes sense for apps whose `/pub/<app-id>/` route is a real, generic landing page anyone can open (e.g. a reading list, a leaderboard). If your `public.py` only serves **per-resource share links** with no generic index — e.g. `/pub/<app-id>/{token}` for a single shared document, and a bare `/pub/<app-id>/` would 404 or makes no sense to browse — opt out of the directory by adding to your `manifest.json`:

```json
{
  "id": "my-app",
  "public_directory": false
}
```

The app's toggle still works as usual (`is_app_public` still gates whether its share links resolve) — this flag only hides it from the generic browsable directory card grid. Default is `true` (listed) when the field is omitted.

---

## Writing a game

A game is not a normal app, and it is the one app type with a fixed shape. **The game itself runs on its public Game Hub page, not in a desktop window.**

The reason is accounts. An mvmOS desktop has exactly one session — the Linux user looking at it. Apps Hub accounts, which is what players are, only exist on public pages. A game played inside a window can therefore only ever be played by one person, who is scored against nobody; the same game played on its public page can be opened by anyone with an Apps Hub account, in any browser, and every run lands in the same leaderboard. A public page also opens in its own tab and gets the whole screen, which is what a game wants on a phone.

So the split is:

| Where | What lives there |
|---|---|
| `public/main.js` — the desktop window | A launcher. No game logic at all. Plus anything belonging to the *owner of the server* rather than to a player: settings, premium switches. |
| `public/mp.js` — the public play page | The whole game, client side. |
| `mp_game.py` — the server | The rules that must not be trusted to a browser: the wave plan, the shared seed, the scores it reports. |

This holds for a solo game too. Single player is not a separate code path — it is a room with one player in it, so a game written this way becomes multiplayer by raising `max_players`, not by being rewritten.

### The window: `public/main.js`

Core ships `GameLauncher` (`frontend/gamelauncher.js`, mvmOS ≥ 0.37.0). A game's `main.js` is essentially this and nothing more:

```js
mvmOS.registerApp({
  id: 'towerdefense',
  name: 'Tower Defense',
  icon: '🏰',
  category: 'Games',
  launch() {
    window.GameLauncher.open({
      id: 'towerdefense',
      name: 'Tower Defense',
      icon: '🏰',
      tagline: () => t('td_tagline'),          // string or function
      sections: [                              // optional, owner-side only
        { title: t('td_settings'), render(el) { /* … */ } },
      ],
    });
  },
});
```

What the launcher does:

- Checks whether Game Hub is installed (live, via `/api/plugins` — not a cached list).
- If it is: a **Play** button that opens `/pub/gamehub/?game=<your-id>` in a new tab. That deep link skips the game grid and lands the player on your game's page.
- If it is not: a card explaining that Game Hub is required, with an **Install** button that installs it in place (including the backend-confirmation prompt Game Hub needs) and re-renders itself.
- Loads your `public/i18n.js` before rendering, so `t('…')` works in the window as well as on the play page.
- Renders your `sections` underneath. This is the only place owner-side UI belongs — it never reaches the public page, and public players simply get whatever the owner configured.

Any text field (`name`, `tagline`) may be a function, so it can be a `t('…')` call that only resolves after the string table is merged.

Guard for older cores, which have no `GameLauncher`:

```js
if (!window.GameLauncher) { mvmOS.notify(name, 'This game needs a newer mvmOS core.'); return; }
```

**Game Hub is a hard requirement for new games.** There is no manifest dependency mechanism, so the launcher is what enforces it — never show a Play button that leads to a page that does not exist.

### manifest.json

```json
{
  "id": "towerdefense",
  "category": "Games",
  "min_core_version": "0.37.0",
  "multiplayer": false,
  "max_players": 1,
  "themed": true,
  "public_directory": false
}
```

| Field | Meaning |
|---|---|
| `multiplayer` | `false` = solo only. Game Hub then shows a single **Play** button instead of Solo / New game, labels the card "Single player", and hides the open-lobbies list. **Omitting it means multiplayer** — games written before this flag keep working unchanged. |
| `max_players` | Room size cap (default `8`). `1` also hides the game's rooms from the open-lobbies list. |
| `themed` | The play page follows the visitor's Apps Hub theme (light or dark) instead of being permanently dark. Only set it if your `mp.js` takes every colour from the page's CSS variables — a game with dark colours baked into its markup will look broken on a light page. Default is off, so older games stay dark exactly as they were. |
| `min_core_version` | `0.37.0` or newer — that is when `GameLauncher` landed. |
| `public_directory` | `false` — the game is reached through Game Hub, not through the generic public app directory. |

### The server: `mp_game.py`

Sits at `apps/<id>/mp_game.py` (next to `manifest.json`, **not** inside `public/`). Its presence is what makes the game playable in Game Hub at all — Game Hub finds it by convention. Expose a class named `Game`:

```python
class Game:
    def __init__(self, ctx):
        self.ctx = ctx

    async def on_start(self, settings):        # host pressed Start
    async def on_join(self, player):           # someone joined, or reconnected
    async def on_leave(self, player):
    async def on_message(self, player, msg):   # a client sent something
```

`ctx` gives you:

```python
ctx.settings          # what renderSetup collected
ctx.room_id, ctx.host_id
ctx.players()         # currently connected
ctx.all_players()     # including the disconnected
await ctx.broadcast(msg, exclude=None)
await ctx.send(player_id, msg)
ctx.schedule(delay, coro_factory)             # timers
await ctx.finish(records, duration=None, metadata={})
```

`records` is `[{player_id, score, rank, is_winner}]`. Game Hub writes the session itself, and calls it **singleplayer** when there is one record — that is how a solo run reaches the player's history and stats. Do not mark a solo player `is_winner`: the leaderboard counts wins, and a win over nobody makes it meaningless.

**Put anything that decides what the run looks like on this side.** The pattern that makes a solo game multiplayer-ready for free is to send a *seed*, not content: the server draws one seed per room, every client grows the same waves/board/sequence out of it with the same arithmetic, and a second player is then playing the identical run without a byte of per-entity traffic. Reconnects are free too — resend the same start message in `on_join`.

### The game: `public/mp.js`

Loaded by Game Hub's play page, together with your `public/i18n.js` and `public/style.css`. Register once, at load time:

```js
const mp = window.GameHub.mp;

mp.registerGame({
  id: 'towerdefense',
  name: t('td_title'),
  renderSetup(box, settings) {      // host-only, shown in the lobby
    box.innerHTML = '<select id="diff">…</select>';
    return () => ({ difficulty: box.querySelector('#diff').value });   // becomes ctx.settings
  },
  renderGame(root, { reconnect }) { /* draw the game into root */ },
});

mp.on('td_start', msg => { /* server said go */ });
mp.send({ type: 'td_over', score, wave });
```

Also available: `mp.settings()`, `mp.players()`, `mp.me()`, `mp.isHost()`, `mp.renderAvatar(player, size)`, and `window.GameHub.getToken()`.

Two things to get right:

- **Register your `mp.on(...)` handlers at load time, not inside `renderGame`.** The server's first message follows `game_started` immediately, and a handler attached later misses it. If the message can arrive before the canvas exists, stash it and replay it when `renderGame` runs.
- **A room is one run.** When the game ends it is finished, and "Play again" means asking for a new room, not resetting state:

```js
const r = await fetch('/api/pub/gamehub/mp/rooms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() },
  body: JSON.stringify({ game_id: 'towerdefense', max_players: 1, settings: mp.settings() }),
});
location.href = (await r.json()).play_url;
```

### Surviving a reload

The room outlives the socket — five minutes after everyone disconnects, two hours in total — and the framework reconnects a returning player to the same slot by their Game Hub token, then calls `on_join` again. That is the framework's whole contribution: it gets the player back into the room. **Whether the player gets their *run* back is the game's job**, because only the game knows what a run is, and in most games the browser is the thing running it.

The cheap pattern, and the one `towerdefense` uses:

1. The client reports a snapshot on a timer (and at every natural checkpoint) — score, level, lives, whatever the run consists of.
2. The server keeps the last snapshot per player. It does not interpret it.
3. `on_join` sends the start message with that snapshot attached, and the client picks up from it.

```python
async def on_join(self, player):
    if self.started:
        await self.ctx.send(player["id"], self._start_msg(player["id"]))   # carries "resume"
```

Two details worth copying. If the run is generated from a seed, wind the generator forward through the parts already played before resuming, or the rest of the run will not be the run the player left. And handle the player who reconnects *after* finishing — in multiplayer their room stays open while the others play on, so they must come back to their result, not to a fresh game.

What you cannot restore is fine to drop. `towerdefense` resumes at the start of the wave the player was in and does not put the enemies back: the score, kills and tower are the run, the enemies in flight are not. Decide that per game.

Note that a room that has already **finished** is over for good — `start` answers 409 — and the framework shows a "this game is over" panel with a link back to Game Hub. "Play again" means creating a new room.

**Getting back in from the hub.** Resuming only helps if the player can find the room again, and a player who closes the tab comes back to Game Hub, not to the play URL. So the hub asks the server: `GET /api/pub/gamehub/mp/rooms/mine` (header `X-GH-Token`) returns the caller's own live rooms — every room they are in that has not finished, solo ones included. The hub turns that into a banner on the games grid and a **Continue** button on the game's own page, ahead of the buttons that start a new run. This is generic; a game gets it for free and needs to write nothing. (`GET /rooms` is a different list — open lobbies for *other* people, which deliberately skips solo rooms and rooms already playing, i.e. exactly the ones a returning player wants.)

The window is the room's, not the browser's. A room that never got past the lobby is collected five minutes after the last player leaves; a room that is **playing** waits an hour, because that one is a run someone means to come back to. Two hours after it was created any room is gone regardless, and a backend restart takes every room with it — rooms are memory, not storage. Nothing is stored client-side, so the same run is offered in another browser, or on the phone, to the same Apps Hub account.

For a solo game there is at most one such run at a time: `POST /rooms` refuses a second one, in **every** game — the rule is the framework's, not the game's. A player who does not want the run back throws it away with `DELETE /api/pub/gamehub/mp/rooms/{room_id}` (header `X-GH-Token`, solo rooms you are in only); the hub puts that on a 🗑 next to Continue. A player who wants to stop for longer than that window saves instead — see the next section.

### Saving a game

Resuming above is about *not losing* a run: the socket dropped, the tab
reloaded, the player wandered off for twenty minutes. Saving is the other
thing — the player deciding to stop, and expecting the run to be there tomorrow
or next week. A room cannot do that: it lives in memory, so a backend restart
ends it whatever the timeouts say. So a save goes to the database.

**All of it is the framework's, and it is the same in every game.** The button,
the question, the storage, the closing of the room, and the "new game or
continue?" prompt back in the hub are written once, in Game Hub. It applies to
**solo runs only**: a multiplayer room is other people's evening, and no single
player gets to freeze it. The framework simply refuses `__save` there.

What a game contributes is the one thing only it knows — what belongs in the
save. A save has two halves, because in some games the run lives in the browser
and in others on the server:

```js
// client — apps/<id>/public/mp.js
mp.registerGame({
  id, name, renderSetup, renderGame,
  snapshot: () => ({ board: _grid, score: _score }),  // the browser's half, or null
  pause:  () => { _paused = true; },                  // optional: while the prompt is up
  resume: () => { _paused = false; },
  exitButton: false,   // optional: the game already has its own exit control
  saveable:   false,   // optional: this game cannot be saved at all
});

mp.savedState()   // the browser's half of the save this run resumed from, or null
mp.exitPrompt()   // show the stop-for-now question (the built-in button calls this)
mp.saveAndExit()  // save straight away, no question
```

```python
# server — apps/<id>/mp_game.py
def snapshot(self):
    return {"round": self.current_round, "totals": self.totals}   # or None

ctx.saved_state    # the server half this run was started from, or None (read in on_start)
```

Unless `exitButton: false`, Game Hub puts its own **⏸ Save & exit** control on
every solo play page. Clicking it pauses the game, asks, and on confirm sends
`__save` with `snapshot()`; the hub writes both halves as one row, answers
`__saved`, closes the room and sends the player back to Game Hub. Nothing
reaches the leaderboard — the run has not *ended*, it has been put down.

Reading the save back is where the two halves differ, and both are one line:

* **Server-side state** — `on_start` checks `ctx.saved_state` and rebuilds from
  it. `findyourself` restores the round, the standings and the already-resolved
  locations and opens straight at that round; `towerdefense` restores the wave,
  score and tower and hands them to the same start message a reconnect gets.
* **Browser-side state** — the game calls `mp.savedState()` at the point in its
  own startup where the board is ready for it. `sudofall` does it right after
  the server's `game_start` has laid out a fresh board, and replaces it with
  the saved one.

A game with no server state does not write `snapshot()` in Python; a game with
no browser state does not write it in JS. Neither has to care which kind the
other games are.

The rest is enforced by the server in `POST /rooms`, not the UI:

| The player has | `POST /rooms` (solo) does |
|---|---|
| nothing | creates the room |
| a run in progress | **409** `run_in_progress` + the room to go back to |
| a saved game, no `resume` in the body | **409** `saved_game` — ask the player |
| a saved game, `resume: true` | creates a room that starts from the save |
| a saved game, `resume: false` | deletes the save, starts fresh |

Starting a run **consumes** the save, so there is never both a save and a run
of the same game. Game Hub reads `GET /saves` to know which of those it is
looking at (and `DELETE /saves/{game_id}` to drop one), and shows the question
when it has to.

Two things worth deciding per game. A resumed save is a **new run**: new room,
new seed, new session — it just does not begin at the beginning. And a save is
one-shot, not a checkpoint: it disappears the moment it is used, which is what
stops a player from farming the same good position over and over. Pick a
natural place to cut, too — `findyourself` saves at a round boundary and drops
the guess in progress, because the standings are the run and half a guess is
not.

If the raw protocol matters to you: the client sends
`{"type": "__save", "state": {...}|null}` and gets back
`{"type": "__saved", "ok": true|false}`, then `room_closed`. The browser half
comes back in the `game_started` (and `joined`) frame as `saved_state`.

### Persistent progress across games

Sessions, scores and leaderboards belong to Game Hub. Anything else a player accumulates — upgrades, unlocks, currency, a save file — is the **game's own data**, and belongs in the game's own database (`db.json` + `api.py`), keyed by the Apps Hub player id you already have from `GameHub.getToken()`. Do not try to hang it off Game Hub; it has no concept of it.

One rule if the game also reports to a leaderboard: **apply the progress on the server**, in `mp_game.py`, by loading the player's row in `on_start`/`on_join` and folding it into the tuning it sends out. A browser that is told "you have +40% damage" is a browser that can tell itself the same thing. The seed pattern above has the same shape — the server decides, the client draws.

### Translations

Both halves read the same table from `apps/<id>/public/i18n.js` — the launcher window injects it, and the play page loads it. Never put game strings in core's `frontend/i18n/*.js`: those do not travel in the store zip, and the text would be missing on every other installation.

```js
(function () {
  if (window.MYGAME_I18N) return;
  var STRINGS = { en: { mg_title: 'My Game' }, bg: { mg_title: 'Моята игра' } };
  function apply(lang) {
    var table = STRINGS[lang] || STRINGS.en;
    window._i18n = window._i18n || {};
    for (var k in table) window._i18n[k] = table[k];
  }
  apply((window.mvmOS && window.mvmOS.lang) || 'en');
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(apply);
  window.MYGAME_I18N = true;
})();
```

### Full layout

```
apps/towerdefense/
  manifest.json      — multiplayer / max_players / themed / min_core_version
  store.json         — the mvmos.org listing
  mp_game.py         — server: rules, seed, scoring
  public/
    main.js          — the launcher window (no game logic)
    mp.js            — the game
    i18n.js          — strings for both halves
    style.css        — optional, loaded by the play page
```

`apps/towerdefense` is the reference implementation of every point above.

### Games written before this

The pattern is additive: `multiplayer` and `themed` default to the old behaviour, so a game that plays inside its window and knows nothing about `GameLauncher` keeps working exactly as it did. Migrating one is a deliberate, per-game job — it removes its in-window single player and makes Game Hub mandatory — so do it as its own release, not as a side effect of something else.

---

## Game Hub integration

Game Hub is the central player identity and stats system for multiplayer games. If your game supports multiplayer, integrate with Game Hub so players can use their profile, avatar, and track stats across all games.

### Loading Game Hub

Load only `widget.js` — there is no separate `avatar.js` anymore, everything is built into the widget:

```js
function _loadGameHub(cb) {
  if (window.GameHub) { window.GameHub.init().then(cb); return; }
  const s = document.createElement('script');
  s.src = '/apps/gamehub/widget.js';
  s.onload = () => window.GameHub?.init().then(cb) || cb();
  s.onerror = cb;  // Game Hub not installed — continue without it
  document.head.appendChild(s);
}
```

Game Hub is optional — always handle the case where `window.GameHub` is `undefined` (not installed).

### Login widget

Show the login/register/guest form inside any container:

```js
window.GameHub.renderWidget(container, {
  guestText: 'Play as Guest',
  onReady(player) {
    // player.is_guest === true → guest (no stats)
    // otherwise → logged-in player
  }
});
```

### Current player and avatar

```js
const player = window.GameHub.currentPlayer();
// player: { id, display_name, avatar_color, avatar_svg }

// Render avatar at any size:
const html = window.GameHub.renderAvatar(player, 32);
```

`renderAvatar` falls back gracefully: uses `avatar_svg` if present, otherwise generates a colored circle with the player's initial.

**Never use `window.GHAvatar` — it no longer exists.**

### Recording a session (stats)

```js
window.GameHub.recordSession({
  game_id: 'my-game',
  mode: 'singleplayer',  // or 'multiplayer'
  players: [
    { player_id: player.id, score: 150, is_winner: true }
    // for guests: { guest_name: 'Name', score: 0, is_winner: false }
  ],
  duration_seconds: 120,
  metadata: {},  // any extra data
});
```

### Auth token (for multiplayer API calls)

```js
const token = window.GameHub.getToken();
// Use in fetch headers: { 'X-GH-Token': token }
// Required for: /api/pub/gamehub/favourites, /api/pub/gamehub/invite, etc.
```

### Avatars in multiplayer (WebSocket)

When players connect, exchange `avatar_svg` in the first WebSocket message so all clients can render each other's avatars without extra API calls:

```js
// Joining player sends:
ws.send(JSON.stringify({
  type: 'hello',
  name: player.display_name,
  gh_player_id: player.id,
  avatar_svg: player.avatar_svg || null,
}));

// Store it in your roster:
roster[msg.from] = { name: msg.name, avatar_svg: msg.avatar_svg || null };

// Render anywhere:
const html = window.GameHub.renderAvatar(
  { avatar_svg: roster[idx].avatar_svg, display_name: roster[idx].name },
  28
);
```

---

## Publishing a site (mvmOS Studio)

Projects created in mvmOS Studio can be published as public websites on a custom domain or subpath — no separate web server required.

### How it works

mvmOS runs on port `2052` by default. When a domain or subpath is registered for a project, the built-in middleware identifies incoming requests by the `Host` header (domain mode) or URL prefix (path mode) and serves the project's public files without requiring login.

### Path mode

The project is accessible as a subpath of your mvmOS URL:

```
https://your-mvmos.com/myproject/
```

No additional configuration needed. Works out of the box.

### Domain mode — without nginx/Apache

If no web server is installed, use the built-in **Web Server** (in the Sites panel) to listen on port 80:

1. Create your project and register the domain in mvmOS Studio
2. Start the Web Server on port 80 (Sites → Web Server button)
3. Point your domain's DNS A record to your server's IP

```
DNS:  mysite.com  →  A  →  your.server.ip
      ↓
mvmOS public server :80
      ↓
serves your project
```

The public server only exposes project content — the admin panel, terminal, and all internal routes are blocked.

### Domain mode — with nginx

If nginx is already running on port 80, add a server block for your domain and proxy to mvmOS:

```nginx
server {
    listen 80;
    server_name mysite.com;

    location / {
        proxy_pass http://127.0.0.1:2052;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Then reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`proxy_set_header Host $host` is required — mvmOS uses the Host header to identify which project to serve.

**With SSL (certbot):**

```bash
sudo certbot --nginx -d mysite.com
```

Certbot automatically adds the HTTPS block. mvmOS itself does not need any SSL configuration.

### Domain mode — with Apache

```apache
<VirtualHost *:80>
    ServerName mysite.com

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:2052/
    ProxyPassReverse / http://127.0.0.1:2052/
</VirtualHost>
```

Enable required modules and reload:

```bash
sudo a2enmod proxy proxy_http
sudo systemctl reload apache2
```

`ProxyPreserveHost On` is required for the same reason as `proxy_set_header Host` in nginx.

**With SSL (certbot):**

```bash
sudo certbot --apache -d mysite.com
```

### Domain mode — with Cloudflare

Cloudflare terminates SSL itself and talks to your origin over HTTP. Your server only needs to handle plain HTTP.

**Without nginx/Apache (built-in server):**

1. Start the Web Server on port 80 in mvmOS Studio
2. In Cloudflare DNS, add an A record pointing to your server IP (orange cloud = proxied)
3. Cloudflare handles HTTPS — your origin stays on HTTP port 80

**With nginx/Apache:**

Configure nginx/Apache as above (HTTP only, port 80). Cloudflare proxies HTTPS → your origin HTTP. Set SSL/TLS mode to **Full** in Cloudflare dashboard (not Full Strict, unless you add a certificate on origin too).

Cloudflare supported HTTP origin ports: `80, 8080, 8880, 2052, 2082, 2086, 2095`
