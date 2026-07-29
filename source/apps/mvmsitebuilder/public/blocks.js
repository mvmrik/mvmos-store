// mvmSiteBuilder — block-type editor registry (admin side).
// Mirrors backend/apps/mvmsitebuilder/blocks.py's BLOCK_RENDERERS one-to-one
// by key. Adding a new block type for a future module means adding one
// entry here (icon/label/create/mount) plus the matching renderer in
// blocks.py — nothing else in main.js needs to change.
//
// Each block keeps a single live `data` object; mount() renders the edit
// form into `container` and wires inputs to mutate `data` directly, so the
// page editor can just JSON.stringify() the blocks array on save.
(function () {
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function t(k) { return (window.t || (k => k))(k); }

  function plainTextToHtml(text) {
    const holder = document.createElement('div');
    holder.textContent = text == null ? '' : String(text);
    return holder.innerHTML.split(/\n{2,}/).map(paragraph =>
      `<p>${paragraph.replace(/\n/g, '<br>')}</p>`
    ).join('');
  }

  function textToolbar() {
    return `
      <div class="msb-rich-toolbar" role="toolbar" aria-label="${t('msb_text_formatting')}">
        <button type="button" class="s-btn s-btn-sm" data-cmd="undo" title="${t('msb_text_undo')}">↶</button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="redo" title="${t('msb_text_redo')}">↷</button>
        <span class="msb-rich-separator"></span>
        <button type="button" class="s-btn s-btn-sm" data-cmd="bold" title="${t('msb_text_bold')}"><b>B</b></button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="italic" title="${t('msb_text_italic')}"><i>I</i></button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="underline" title="${t('msb_text_underline')}"><u>U</u></button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="strikeThrough" title="${t('msb_text_strikethrough')}"><s>S</s></button>
        <span class="msb-rich-separator"></span>
        <select class="s-input msb-rich-format" data-format title="${t('msb_text_paragraph_style')}">
          <option value="p">${t('msb_text_paragraph')}</option><option value="h2">${t('msb_text_heading_2')}</option>
          <option value="h3">${t('msb_text_heading_3')}</option><option value="h4">${t('msb_text_heading_4')}</option>
          <option value="blockquote">${t('msb_text_quote')}</option>
        </select>
        <button type="button" class="s-btn s-btn-sm" data-cmd="insertUnorderedList" title="${t('msb_text_bulleted_list')}">• ${t('msb_text_list')}</button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="insertOrderedList" title="${t('msb_text_numbered_list')}">1. ${t('msb_text_list')}</button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="createLink" title="${t('msb_text_add_link')}">🔗</button>
        <button type="button" class="s-btn s-btn-sm" data-cmd="removeFormat" title="${t('msb_text_clear_formatting')}">Tx</button>
      </div>`;
  }

  function mountHtmlCodeEditor(container, data) {
    const textarea = container.querySelector('textarea');
    const save = value => { data.code = value; };
    textarea.addEventListener('input', e => save(e.target.value));
    if (!window.MSB_loadCodeMirror) return;
    window.MSB_loadCodeMirror().then(() => {
      if (!container.isConnected || !window.CodeMirror) return;
      const cm = CodeMirror.fromTextArea(textarea, {
        mode: 'htmlmixed', theme: 'dracula', lineNumbers: true,
        indentUnit: 2, tabSize: 2, viewportMargin: Infinity,
      });
      cm.setSize('100%', 240);
      cm.on('change', editor => save(editor.getValue()));
    }).catch(() => { /* retain the usable plain textarea if the editor cannot load */ });
  }

  window.MSB_BLOCKS = {
    text: {
      icon: '📝',
      label: () => t('msb_block_text'),
      create: () => ({ html: '' }),
      mount(container, data) {
        container.innerHTML = `${textToolbar()}<div class="msb-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${esc(t('msb_block_text_ph'))}"></div>`;
        const editor = container.querySelector('.msb-rich-editor');
        editor.innerHTML = typeof data.html === 'string' ? data.html : plainTextToHtml(data.text || '');
        const save = () => { data.html = editor.innerHTML; delete data.text; };
        editor.addEventListener('input', save);
        container.querySelectorAll('[data-cmd]').forEach(button => {
          button.addEventListener('mousedown', e => e.preventDefault());
          button.addEventListener('click', async () => {
            const command = button.dataset.cmd;
            if (command === 'createLink') {
              const url = await mvmOS.prompt(t('msb_text_link_url'), 'https://');
              if (!url) return;
              document.execCommand('createLink', false, url.trim());
            } else {
              document.execCommand(command, false, null);
            }
            editor.focus(); save();
          });
        });
        const format = container.querySelector('[data-format]');
        format.addEventListener('change', () => {
          document.execCommand('formatBlock', false, '<' + format.value + '>');
          editor.focus(); save();
        });
      },
    },

    html: {
      icon: '💻',
      label: () => t('msb_block_html'),
      create: () => ({ code: '' }),
      mount(container, data) {
        container.innerHTML = `
          <textarea class="msb-f-textarea msb-f-code" rows="8" placeholder="${t('msb_block_html_ph')}">${esc(data.code)}</textarea>
          <div class="msb-f-hint">${t('msb_block_html_hint')}</div>`;
        mountHtmlCodeEditor(container, data);
      },
    },

    image: {
      icon: '🖼️',
      label: () => t('msb_block_image'),
      create: () => ({ src: '', alt: '', caption: '' }),
      mount(container, data, ctx) {
        container.innerHTML = `
          <div class="msb-f-image-preview">${data.src ? `<img src="${esc(data.src)}">` : `<div class="msb-f-image-empty">${t('msb_block_image_empty')}</div>`}</div>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="msb-f-file">
          <input type="text" class="msb-f-input" data-f="alt" placeholder="${t('msb_block_image_alt')}" value="${esc(data.alt)}">
          <input type="text" class="msb-f-input" data-f="caption" placeholder="${t('msb_block_image_caption')}" value="${esc(data.caption)}">
        `;
        container.querySelector('[data-f="alt"]').addEventListener('input', e => { data.alt = e.target.value; });
        container.querySelector('[data-f="caption"]').addEventListener('input', e => { data.caption = e.target.value; });
        container.querySelector('.msb-f-file').addEventListener('change', async e => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const result = await ctx.uploadImage(file);
            data.src = result.url;
            this.mount(container, data, ctx);
          } catch (err) {
            ctx.notifyError(err);
          }
        });
      },
    },

    spacer: {
      icon: '↕️',
      label: () => t('msb_block_spacer'),
      create: () => ({ height: 40 }),
      mount(container, data) {
        container.innerHTML = `<input type="number" class="msb-f-input msb-f-spacer" min="0" max="400" value="${data.height}"> px`;
        container.querySelector('input').addEventListener('input', e => {
          data.height = Math.max(0, Math.min(400, parseInt(e.target.value, 10) || 0));
        });
      },
    },

    app_widget: {
      icon: '🧩', label: () => t('msb_block_app_widget'),
      create: () => ({ title: '', embed_url: '', height: 720 }),
      mount(container, data) {
        container.innerHTML = `<div class="msb-f-hint">${esc(data.title || t('msb_block_app_widget'))}</div><input type="number" class="msb-f-input msb-f-spacer" min="260" max="1200" value="${data.height || 720}"> px`;
        container.querySelector('input').addEventListener('input', e => { data.height = Math.max(260, Math.min(1200, parseInt(e.target.value, 10) || 720)); });
      },
    },
  };

  window.MSB_BLOCK_ORDER = ['text', 'html', 'image', 'spacer', 'app_widget'];
})();
