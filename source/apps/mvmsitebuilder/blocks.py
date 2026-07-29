"""
Block-type registry for mvmSiteBuilder public page rendering.

Every page's content is stored as an ordered JSON list of {type, data}
blocks (see public.py's `pages.blocks` column). This module maps each
`type` to a render(data) -> HTML function. Adding a new block type for a
future module (e.g. a "products" module) means adding one entry here and
a matching entry in the frontend's blocks.js editor registry — nothing
else in public.py or main.js needs to change. This registry is the
"plugin point" for content, mirrored by themes.py for visual styling.
"""

import html as _html
from html.parser import HTMLParser


def _esc(s) -> str:
    return _html.escape(str(s or ""), quote=True)


class _RichTextSanitizer(HTMLParser):
    """Keep the formatting produced by the editor, not executable markup."""

    allowed = {"p", "br", "strong", "b", "em", "i", "u", "s", "strike", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in self.allowed:
            return
        if tag == "a":
            href = next((value for key, value in attrs if key.lower() == "href"), "") or ""
            if href.startswith(("https://", "http://", "mailto:", "/", "#")):
                self.out.append(f'<a href="{_esc(href)}" rel="noopener noreferrer">')
                return
            self.out.append("<a>")
            return
        self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag.lower() in self.allowed and tag.lower() != "br":
            self.out.append(f"</{tag.lower()}>")

    def handle_data(self, data):
        self.out.append(_esc(data))

    def handle_entityref(self, name):
        self.out.append(f"&{name};")

    def handle_charref(self, name):
        self.out.append(f"&#{name};")

    def result(self):
        return "".join(self.out)


def _safe_rich_text(source: str) -> str:
    parser = _RichTextSanitizer()
    parser.feed(source)
    parser.close()
    return parser.result()


def render_text(data: dict) -> str:
    rich_html = data.get("html")
    if isinstance(rich_html, str):
        return f'<div class="msb-block msb-block-text">{_safe_rich_text(rich_html)}</div>'
    text = str(data.get("text", ""))
    # Escape first, then turn blank lines into paragraph breaks — keeps the
    # block trusted-input-free while still giving basic multi-paragraph text.
    paragraphs = [p for p in text.split("\n\n")]
    body = "".join(f"<p>{_esc(p).replace(chr(10), '<br>')}</p>" for p in paragraphs if p.strip())
    return f'<div class="msb-block msb-block-text">{body}</div>'


def render_html(data: dict) -> str:
    # Raw HTML/CSS/JS embed, intentionally unescaped — same trust level as a
    # site's custom_css/custom_js (only the site owner/editors can write it).
    code = str(data.get("code", ""))
    return f'<div class="msb-block msb-block-html">{code}</div>'


def render_image(data: dict) -> str:
    src = _esc(data.get("src", ""))
    if not src:
        return ""
    alt = _esc(data.get("alt", ""))
    caption = str(data.get("caption", ""))
    fig_caption = f"<figcaption>{_esc(caption)}</figcaption>" if caption.strip() else ""
    return (
        f'<figure class="msb-block msb-block-image">'
        f'<img src="{src}" alt="{alt}" loading="lazy">{fig_caption}'
        f"</figure>"
    )


def render_spacer(data: dict) -> str:
    try:
        height = max(0, min(400, int(data.get("height", 40))))
    except (TypeError, ValueError):
        height = 40
    return f'<div class="msb-block msb-block-spacer" style="height:{height}px"></div>'


def render_app_widget(data: dict) -> str:
    src = str(data.get("embed_url", ""))
    if not src.startswith("/pub/"):
        return ""
    try:
        height = max(260, min(1200, int(data.get("height", 720))))
    except (TypeError, ValueError):
        height = 720
    title = _esc(data.get("title", "App widget"))
    return (f'<section class="msb-block msb-block-app-widget"><iframe src="{_esc(src)}" '
            f'title="{title}" loading="lazy" sandbox="allow-forms allow-scripts" '
            f'style="width:100%;height:{height}px;border:0"></iframe></section>')


BLOCK_RENDERERS = {
    "text": render_text,
    "html": render_html,
    "image": render_image,
    "spacer": render_spacer,
    "app_widget": render_app_widget,
}


def render_blocks(blocks: list) -> str:
    out = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        renderer = BLOCK_RENDERERS.get(block.get("type"))
        if renderer:
            try:
                out.append(renderer(block.get("data") or {}))
            except Exception:
                continue
    return "\n".join(out)
