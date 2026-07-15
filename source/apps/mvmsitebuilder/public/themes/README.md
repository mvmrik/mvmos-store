# mvmSiteBuilder themes

A theme is a folder here: `themes/<theme_id>/`. It's picked up automatically —
no code change, no restart.

## Uploading a theme

From the app's Design tab, any Apps Hub user can zip up a theme folder (the
zip's root — or a single top-level folder inside it — must contain the three
files below) and upload it with a `theme_id`. The id must be `[a-z0-9-]`,
1-40 characters. Uploaded themes are shared: they show up in every site's
Design dropdown, same as `default`. The uploader who registers an id is
recorded as its owner — only they can re-upload/update that same id later;
anyone else picking the same id gets rejected. `default` itself is reserved
and can never be overwritten by an upload.

Required contents:

```
themes/<theme_id>/
  theme.json            name, description, author
  style.css             free-form CSS — no fixed class names required
  templates/
    page.html           full HTML document, renders one page
```

A theme owns its whole document — `<head>`, header, nav markup, footer,
layout, mobile behavior. mvmSiteBuilder never dictates HTML structure; it
only fills in `{{tag}}` placeholders inside `templates/page.html` before
serving it. There is no loop/conditional syntax — just plain substitution —
so any iteration (e.g. the menu) already happened in Python before your
template sees it.

## theme.json

```json
{ "name": "My Theme", "description": "...", "author": "you" }
```

## templates/page.html — available tags

| Tag | What it is |
|---|---|
| `{{site_name}}` | Site name, HTML-escaped |
| `{{page_title}}` | Current page's title, HTML-escaped |
| `{{theme_css_url}}` | URL to this theme's `style.css` — put in a `<link rel="stylesheet">` yourself |
| `{{home_url}}` | Absolute URL of the site's homepage — use it for a logo/site-name link |
| `{{content}}` | The page's blocks, already rendered to HTML (text/html/image/spacer today; more block types land here automatically as they're added — you never touch this markup, just decide where it sits on the page) |
| `{{menu}}` | A ready-made `<nav class="msb-nav">…</nav>` with `<a class="msb-nav-item">` links — drop it in if you don't need custom menu markup |
| `{{menu_json}}` | The same menu as a JSON array `[{"label": "...", "href": "..."}, ...]`, safe to embed in a `<script type="application/json">` tag — read it from your own JS if you want a dropdown, a mobile hamburger, or any markup `{{menu}}` doesn't give you |
| `{{custom_css}}` | The site owner's custom CSS (Design tab) — put inside a `<style>` tag yourself. If you don't include this tag, their custom CSS silently won't apply. |
| `{{custom_js}}` | The site owner's custom JS (Design tab) — put inside a `<script>` tag yourself, same caveat as above. |

`templates/page.html` must be a complete document (`<!DOCTYPE html>` through
`</html>`) — see `default/templates/page.html` for a minimal working example.

## Rules

- **Wrap everything in one `<div>` directly inside `<body>`.** Every
  `/pub/<app>/...` page (this one included) gets a shared header/footer chrome
  auto-injected by core (`apphub_pub/layout.js`), which forces `<body>` into
  `display:flex; flex-direction:column` and looks for the *first `<div>`
  child of `<body>`* to size as the scrollable content area. If your real
  markup (header/nav/main/footer) sits directly in `<body>` with no wrapping
  div, any of those elements using `margin: 0 auto` for centering will
  silently shrink-to-fit instead of taking their intended width — flexbox
  auto-margins behave that way for direct flex children. `default`'s
  template wraps its whole page in `<div class="msb-app">...</div>` for
  exactly this reason — copy that pattern.
- No fixed CSS class names are enforced — `style.css` styles whatever markup
  your own `page.html` emits. The `default` theme happens to use
  `.msb-header`/`.msb-nav`/`.msb-page`/`.msb-block`/`.msb-footer`, but that's
  just its own convention, not a contract other themes must follow.
- `theme_id` (the folder name) becomes part of a URL path segment — keep it
  to `[a-z0-9-]`.
- A theme missing `style.css` or `templates/page.html` is treated as
  incomplete: it won't show up in the Design tab dropdown, and a site
  pointing at it silently falls back to `default`.
- Future content types (e.g. a products module, if/when one is built) will
  add their own `templates/<name>.html` contract the same way, with their
  own tag table — `page.html` is the only one that exists today.
