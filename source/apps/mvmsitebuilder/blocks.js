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

  window.MSB_BLOCKS = {
    text: {
      icon: '📝',
      label: () => t('msb_block_text'),
      create: () => ({ text: '' }),
      mount(container, data) {
        container.innerHTML = `<textarea class="msb-f-textarea" rows="5" placeholder="${t('msb_block_text_ph')}">${esc(data.text)}</textarea>`;
        container.querySelector('textarea').addEventListener('input', e => { data.text = e.target.value; });
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
        container.querySelector('textarea').addEventListener('input', e => { data.code = e.target.value; });
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
  };

  window.MSB_BLOCK_ORDER = ['text', 'html', 'image', 'spacer'];
})();
