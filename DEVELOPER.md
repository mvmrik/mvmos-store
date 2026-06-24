# mvmOS Developer Guide

Apps for mvmOS are written in JavaScript and registered via the global `mvmOS` object. Each app consists of a `main.js` file, an optional `style.css`, a `manifest.json`, and a `db.json` (if it uses a database).

---

## App structure

```
apps/<category>/<app-id>/
  manifest.json   — metadata
  main.js         — logic
  style.css       — styles (optional)
  db.json         — database schema (optional)
  backend.py      — server-side component (optional, requires user confirmation)
```

---

## manifest.json

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "🚀",
  "category": "Utilities",
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
| `version` | yes | Semver version |
| `min_core_version` | no | Minimum mvmOS core version required |
| `entry` | no | JS file (default: `main.js`) |
| `css` | no | CSS file |
| `settings` | no | Settings shown in App Store (⚙ button) |
| `trayable` | no | `true` if the app supports System Tray |
| `scheduler` | no | Python file for background scheduled logic (e.g. `"scheduler.py"`) |

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

Shows a notification in the notification center.

```js
mvmOS.notify('Done', 'File saved.');

// With action button
mvmOS.notify('New version', 'v1.2.0 is available.', () => openUpdate(), 'Install');
```

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

## backend.py

If the app needs to access local services (CORS restrictions), it can include a `backend.py`. On install the user receives a confirmation dialog.

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
- Only `backend.py` is installed — no other Python files

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

### Step 2 — create backend/apps/\<app-id\>/scheduler.py

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

- `scheduler.py` goes in `backend/apps/<app-id>/scheduler.py` in the zip — yes, this is the backend folder, but **the app does not need a `backend.py`**. `backend.py` is only needed if the app has its own API endpoints (FastAPI routes). `scheduler.py` is just a plain Python function — no routes, no FastAPI.
- If the app only needs scheduled logic → only `scheduler.py`, no `backend.py`
- If the file is missing, core skips it silently
- Runs every minute — the file itself decides when to act using `if now.hour == X`
- Errors are logged in the `/api/scheduler/tick` response and do not stop other apps

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
