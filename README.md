# mvmOS Developer Guide

This repository contains apps, widgets and themes for [mvmOS](https://github.com/mvmrik/mvmOS) — a web-based desktop OS.

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
| `entry` | ✅ | Entry JS file (e.g. `"main.js"`) |
| `css` | ☐ | Optional CSS file to inject when the app loads (e.g. `"style.css"`) |

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
- Use `this.storage` inside your `registerApp` def to persist data — each app has its own isolated storage.

### Persistent storage

Each app gets its own isolated storage, automatically namespaced by app id. Use `this.storage` inside the `def` object, or save a reference:

```js
mvmOS.registerApp({
  id: 'my-app',
  // ...
  launch() {
    const store = this.storage;
    store.set('count', 5);
    const count = store.get('count'); // 5
    store.remove('count');
  }
});
```

Two different apps using `storage.set('key', ...)` will never overwrite each other's data.

### Notifications

```js
mvmOS.notify('Title', 'Body text');

// with an action button:
mvmOS.notify('Download ready', 'file.zip is ready.', () => {
  // callback when user clicks the action
}, 'Open');
```

### Server-side backend (backend.py)

If your app needs to access local services (e.g. proxy to another process to avoid CORS), you can include a `backend.py` in your app folder.

```
apps/<category>/<app-id>/
  backend.py   ← optional server-side component
```

`backend.py` must expose a FastAPI `router` at module level:

```python
import sys
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/my-app", tags=["my-app"])

# Use sys.modules to access mvmOS auth — relative imports don't work in dynamic loaders
get_current_session = sys.modules["backend.auth"].get_current_session

@router.get("/hello")
async def hello(session=Depends(get_current_session)):
    return {"hello": "world"}
```

**Security model:**
- When a user installs or updates an app with `backend.py`, mvmOS shows a confirmation dialog and **requires the user's system password** before proceeding
- The file is copied to `backend/app-backends/<app-id>.py` and loaded dynamically — no server restart needed
- Every version bump that changes `backend.py` will trigger this confirmation dialog again on update
- **Always bump the app version when you change `backend.py`** — otherwise users won't get the updated backend

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
- Keep the width fixed within each size — use the `sizes` + `defaultSize` fields if you want S/M/L support.
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
mvmOS.registerApp(def)               — register an app
mvmOS.registerWidget(def)            — register a widget
mvmOS.createWindow(options)          — open a window (call inside launch())
mvmOS.notify(title, body)            — push a notification
mvmOS.notify(title, body, fn, label) — notification with action button
mvmOS.onResources(callback)          — subscribe to system resource updates

mvmOS.multiplayer.createRoom(gameId) — create a multiplayer room, returns { roomId, link }
mvmOS.multiplayer.connect(roomId, gameId) — connect to a room via WebSocket, returns WebSocket

this.storage.get(key)        — read from app-isolated localStorage (use inside registerApp def)
this.storage.set(key, value) — write to app-isolated localStorage
this.storage.remove(key)     — delete a key
```

---

## Multiplayer

mvmOS has a built-in generic multiplayer system based on WebSockets. Any game can use it — no extra server setup required.

### How it works

1. Player 1 calls `mvmOS.multiplayer.createRoom(gameId)` — the backend creates a room and returns a shareable link
2. Player 1 shares the link with Player 2
3. Player 2 opens the link in any browser (no mvmOS login needed) — the game loads in a standalone page
4. Both players connect via WebSocket — the backend syncs moves in real time
5. The game controls the rules — the backend only relays messages

### API

```js
// Create a room and get a shareable link
const { roomId, link } = await mvmOS.multiplayer.createRoom('my-game');
// link → e.g. https://your-mvmos.com/api/multiplayer/play/my-game/abc12345

// Connect to a room via WebSocket
const ws = mvmOS.multiplayer.connect(roomId, 'my-game');
```

### WebSocket message protocol

**Server → client:**

| Message | Fields | Description |
|---------|--------|-------------|
| `waiting` | — | Waiting for the second player to join |
| `joined` | `player` (0 or 1), `game_id` | You connected. `player` is your index |
| `start` | `first`, `your_turn`, `numbers` | Both players connected. `numbers` = array of upcoming values (first 10) |
| `move_ok` | `your_turn` (false), `next_number` | Your move was accepted. Wait for opponent |
| `opponent_move` | `move`, `your_turn` (true), `next_number` | Opponent moved. Now it's your turn |
| `opponent_score` | `score` | Opponent's current score |
| `opponent_grid` | `grid` | Opponent's grid state (2D array) |
| `opponent_game_over` | `score` | Opponent's game ended |
| `opponent_left` | — | Opponent disconnected |

**Client → server:**

| Message | Fields | Description |
|---------|--------|-------------|
| `move` | `move: { col }` | Player placed a piece in column `col` |
| `grid_update` | `grid` | Send your current grid so the opponent can see it |
| `score_update` | `score` | Send your current score |
| `game_over` | `score` | Your grid is full |

### Minimal example

```js
mvmOS.registerApp({
  id: 'my-game',
  name: 'My Game',
  icon: '🎮',
  category: 'Games',

  launch(opts) {
    const isMultiplayer = opts?.multiplayer === true;
    const roomId = opts?.roomId;

    mvmOS.createWindow({
      id: 'my-game',
      title: '🎮 My Game',
      width: 500, height: 600,
      onMount(body) {
        if (isMultiplayer && roomId) {
          // Came from shared link — connect directly
          startMultiplayer(body, roomId);
          return;
        }

        // Show lobby
        body.innerHTML = `
          <button id="single">Single Player</button>
          <button id="multi">Multiplayer</button>`;

        body.querySelector('#single').onclick = () => startGame(body, null);
        body.querySelector('#multi').onclick = async () => {
          const { roomId, link } = await mvmOS.multiplayer.createRoom('my-game');
          // Show link to share, then connect...
          startMultiplayer(body, roomId);
        };
      }
    });
  }
});

function startMultiplayer(body, roomId) {
  const ws = mvmOS.multiplayer.connect(roomId, 'my-game');
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'start') {
      startGame(body, ws, msg);
    }
  };
}

function startGame(body, ws, mpState) {
  // ws is null for single player
  // mpState.your_turn — whether you go first
  // mpState.numbers   — shared sequence of upcoming values

  // After each move, send state to backend:
  function sendMove(col) {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'move', move: { col } }));
    ws.send(JSON.stringify({ type: 'score_update', score: myScore }));
    ws.send(JSON.stringify({ type: 'grid_update', grid: myGrid }));
  }

  // Handle incoming messages:
  if (ws) {
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'opponent_move') {
        // msg.move       — what the opponent did
        // msg.your_turn  — true, now it's your turn
        // msg.next_number — next number in the shared sequence
      }
      if (msg.type === 'opponent_grid') {
        // msg.grid — render this to show opponent's board
      }
    };
  }
}
```

### Standalone page for external players

When Player 2 opens the shared link, they see the game in a standalone page (no mvmOS shell). A minimal `mvmOS` shim is injected so the app's `main.js` runs unchanged. `launch()` is called with `{ multiplayer: true, roomId }`.

### i18n in apps

Translations belong **inside the app's `main.js`** — do not add keys to the core `frontend/i18n/` files. Follow the pattern used in `apps/calculator/main.js`:

```js
const _mygame18n = {
  en: { title: 'My Game', play: 'Play' },
  bg: { title: 'Моята игра', play: 'Играй' },
};
function _t(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_mygame18n[lang] || _mygame18n.en)[key] || key;
}
```
