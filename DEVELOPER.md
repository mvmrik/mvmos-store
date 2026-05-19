# mvmOS Developer Guide

Приложенията за mvmOS се пишат на JavaScript и се регистрират чрез глобалния обект `mvmOS`. Всяко приложение е един `main.js` файл, опционален `style.css`, `manifest.json` и `db.json` (ако ползва база данни).

---

## Структура на приложение

```
apps/<category>/<app-id>/
  manifest.json   — метаданни
  main.js         — логика
  style.css       — стилове (опционално)
  db.json         — схема на базата данни (опционално)
  backend.py      — сървърен компонент (опционално, изисква потвърждение)
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
  "description": "Описание на приложението.",
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

| Поле | Задължително | Описание |
|------|-------------|----------|
| `id` | да | Уникален идентификатор (kebab-case) |
| `name` | да | Показвано име |
| `icon` | да | Emoji иконка |
| `category` | да | Категория в App Store |
| `version` | да | Semver версия |
| `min_core_version` | не | Минимална версия на mvmOS core |
| `entry` | не | JS файл (default: `main.js`) |
| `css` | не | CSS файл |
| `settings` | не | Настройки, показвани в App Store (⚙ бутон) |
| `trayable` | не | `true` ако приложението поддържа System Tray |

---

## db.json

Дефинира схемата на SQLite базата данни. При инсталация и ъпдейт системата автоматично създава таблиците и добавя нови колони. Съществуващите данни не се изтриват.

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

| Поле | Описание |
|------|----------|
| `name` | Име на таблицата |
| `columns[].name` | Име на колоната |
| `columns[].type` | SQLite тип: `TEXT`, `INTEGER`, `REAL`, `BLOB` |
| `columns[].primary` | `true` за PRIMARY KEY |
| `columns[].default` | Default стойност (опционално) |

---

## main.js — регистрация

```js
mvmOS.registerApp({
  id: 'my-app',
  name: 'My App',
  icon: '🚀',
  category: 'Utilities',
  trayable: true,           // опционално — System Tray поддръжка
  settings: [               // трябва да съвпада с manifest.json
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
        // body е DOM елементът вътре в прозореца
        body.innerHTML = '<p>Hello!</p>';
      },
    });
  },
});
```

---

## mvmOS API

### mvmOS.createWindow(opts)

Отваря прозорец.

```js
mvmOS.createWindow({
  id: 'my-app',           // id на приложението
  title: 'My App',        // заглавие
  icon: '🚀',             // emoji за tray иконка
  width: 800,             // начална ширина (px)
  height: 600,            // начална височина (px)
  onMount(body) { ... },  // извиква се при отваряне — body е DOM елементът
  appSettings: true,      // показва gear бутон в titlebar
  onAppSettings() { ... } // извиква се при клик на gear бутона
});
```

---

### mvmOS.db(appId)

Връща обект за достъп до SQLite базата на приложението.

```js
const db = mvmOS.db('my-app');

// Четене
const rows = await db.query('SELECT value FROM cfg WHERE key = ?', ['theme']);

// Запис
await db.run('INSERT OR REPLACE INTO cfg (key, value) VALUES (?, ?)', ['theme', 'dark']);
```

| Метод | Описание |
|-------|----------|
| `db.query(sql, params)` | Изпълнява SELECT, връща масив от редове |
| `db.run(sql, params)` | Изпълнява INSERT/UPDATE/DELETE, връща брой засегнати редове |

---

### mvmOS.notify(title, body, action?, actionLabel?)

Показва известие в notification center.

```js
mvmOS.notify('Готово', 'Файлът е запазен.');

// С бутон за действие
mvmOS.notify('Нова версия', 'v1.2.0 е налична.', () => openUpdate(), 'Инсталирай');
```

---

### mvmOS.openSettings(tab?)

Отваря системните настройки.

```js
mvmOS.openSettings();          // начална страница
mvmOS.openSettings('apps');    // таб Приложения
mvmOS.openSettings('about');   // таб За системата
```

---

### mvmOS.initMobileSidebar(body)

Автоматично добавя ☰ бутон в titlebar-а на мобилен, ако `body` съдържа елемент с клас `.as-sidebar`. На десктоп няма ефект.

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

Системна информация и операции.

#### mvmOS.system.resources()

Връща CPU, памет, диск и хардуерна информация.

```js
const data = await mvmOS.system.resources();
// {
//   cpu_pct: 12.5,          // % натоварване на CPU
//   mem_used: 4294967296,   // използвана памет (байтове)
//   mem_total: 8589934592,  // обща памет (байтове)
//   disk_used: 107374182400,
//   disk_total: 536870912000,
//   cpu_model: 'Intel Core i7-...',
//   cpu_cores: 8,
//   cpu_freq_mhz: 3600,
//   hostname: 'mypc',
//   uptime: 86400,          // секунди
// }
```

#### mvmOS.system.processes()

Връща списък с активни процеси.

```js
const procs = await mvmOS.system.processes();
// [{ pid: 1234, user: 'martin', cpu: 1.5, mem: 0.8, rss: '120 MB',
//    stat: 'S', command: 'firefox' }, ...]
```

#### mvmOS.system.kill(pid, signal?, sudo_password?)

Изпраща сигнал към процес.

```js
await mvmOS.system.kill(1234);                        // SIGTERM
await mvmOS.system.kill(1234, 'SIGKILL');             // SIGKILL
await mvmOS.system.kill(1234, 'SIGTERM', 'mypasswd'); // с sudo
// → { ok: true } или { error: 'permission_denied' }
```

| Параметър | Default | Описание |
|-----------|---------|----------|
| `pid` | — | PID на процеса |
| `signal` | `'SIGTERM'` | `'SIGTERM'` или `'SIGKILL'` |
| `sudo_password` | `''` | Sudo парола (ако е нужна) |

#### mvmOS.system.services()

Връща списък с регистрирани systemd услуги.

```js
const services = await mvmOS.system.services();
// [{ name: 'nginx', status: 'active', enabled: true, description: '...' }, ...]
```

#### mvmOS.system.serviceAction(name, action, sudo_password?)

Управлява systemd услуга.

```js
await mvmOS.system.serviceAction('nginx', 'restart');
await mvmOS.system.serviceAction('nginx', 'stop', 'mypasswd');
// → { ok: true, status: 'inactive' } или { error: 'permission_denied' }
```

| `action` | Описание |
|----------|----------|
| `'start'` | Стартира |
| `'stop'` | Спира |
| `'restart'` | Рестартира |
| `'enable'` | Включва при старт |
| `'disable'` | Изключва при старт |

---

### mvmOS.fs

Файлова система.

#### mvmOS.fs.list(path)

Листва съдържанието на директория.

```js
const entries = await mvmOS.fs.list('/home/user/Documents');
// [{ name: 'file.txt', type: 'file', size: 1024, modified: '...' },
//  { name: 'Photos',   type: 'dir',  size: 0,    modified: '...' }, ...]
```

#### mvmOS.fs.read(path)

Чете текстов файл.

```js
const { content } = await mvmOS.fs.read('/home/user/notes.txt');
```

#### mvmOS.fs.write(path, content)

Записва текстов файл.

```js
await mvmOS.fs.write('/home/user/notes.txt', 'Здравей!');
// → { ok: true }
```

#### mvmOS.fs.delete(path)

Изтрива файл или директория.

```js
await mvmOS.fs.delete('/home/user/old-file.txt');
// → { ok: true }
```

#### mvmOS.fs.mkdir(path)

Създава директория (включително родителски директории).

```js
await mvmOS.fs.mkdir('/home/user/new-folder');
// → { ok: true }
```

#### mvmOS.fs.rename(from, to)

Преименува или премества файл/директория.

```js
await mvmOS.fs.rename('/home/user/old.txt', '/home/user/new.txt');
// → { ok: true }
```

---

## Уиджети

Уиджетите се регистрират с `mvmOS.registerWidget()` и са два вида: `taskbar` (в лентата) и `desktop` (на работния плот).

```js
mvmOS.registerWidget({
  id: 'my-widget',
  name: 'My Widget',
  icon: '📊',
  type: 'taskbar',        // 'taskbar' или 'desktop'
  settings: [
    { key: 'unit', label: 'Unit', type: 'select',
      options: [{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }],
      default: 'c' },
  ],
  init(container) {
    // container е DOM елементът на уиджета
    container.innerHTML = '<span>Hello</span>';
  },
});
```

#### mvmOS.onResources(fn)

Абонира се за системни ресурси (CPU, памет, диск) — обновява се на всеки 3 секунди. Използва се в уиджети за да не правят собствени заявки.

```js
mvmOS.onResources(data => {
  el.textContent = data.cpu_pct + '%';
});
```

#### mvmOS.widgetSetting(id, key, default?)

Чете настройка на уиджет.

```js
const unit = mvmOS.widgetSetting('my-widget', 'unit', 'c');
```

#### mvmOS.widgetDb(widgetId)

Връща DB обект за уиджет — същия интерфейс като `mvmOS.db()`.

```js
const db = mvmOS.widgetDb('my-widget');
await db.run('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT)');
```

---

## backend.py

Ако приложението трябва да достъпва локални услуги (CORS ограничения), може да включи `backend.py`. При инсталация потребителят получава диалог за потвърждение.

```python
import sys
from fastapi import APIRouter, Depends

get_current_session = sys.modules["backend.auth"].get_current_session
router = APIRouter(prefix="/api/my-app", tags=["my-app"])

@router.get("/data")
async def get_data(session=Depends(get_current_session)):
    return {"hello": "world"}
```

**Правила:**
- Файлът трябва да дефинира `router` обект на модулно ниво
- Всички endpoints трябва да изискват `session=Depends(get_current_session)` за автентикация
- Prefix-ът трябва да е уникален — препоръчително `/api/<app-id>`
- Само `backend.py` се инсталира — никакви други Python файлове

---

## i18n

Вътре в `main.js` се дефинира собствен речник:

```js
const _i18n = {
  en: { title: 'My App', hello: 'Hello' },
  bg: { title: 'Моето приложение', hello: 'Здравей' },
};
const _t = k => _i18n[mvmOS.lang]?.[k] || _i18n.en[k] || k;
```

Системните UI стрингове (в `frontend/i18n/`) не се пипат от приложения.

---

## System Tray

За да поддържа приложението минимизиране в tray:

```js
mvmOS.registerApp({
  id: 'my-app',
  trayable: true,   // ← само това е нужно
  ...
});

mvmOS.createWindow({
  id: 'my-app',
  icon: '🚀',       // ← използва се за tray иконката
  ...
});
```

Системата автоматично добавя "Close to Tray" настройка в App Store. Разработчикът не пише допълнителна логика.

---

## Версионни зависимости

Ако приложението изисква функционалност от конкретна версия на mvmOS core:

```json
"min_core_version": "0.5.12"
```

При опит за инсталация на несъвместима система потребителят получава съобщение за грешка.

**Правило:** добавяй `min_core_version` при всяка промяна, която разчита на нова функционалност от core.
