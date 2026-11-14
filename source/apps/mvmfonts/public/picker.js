// Shared, optional visual font picker. Loaded lazily through MvmFontsClient.pick().
(function () {
  'use strict';
  const C = window.MvmFontsClient;
  let currentClose;
  C.openPicker = function (opts = {}) {
    currentClose?.();
    const lang = opts.lang || window.mvmOS?.lang || 'en',
      messages = window.MVMFONTS_I18N?.[lang] || window.MVMFONTS_I18N?.en || {};
    const t = (k) => messages[k] || window.MVMFONTS_I18N?.en?.[k] || k;
    return new Promise((resolve) => {
      if (opts.signal?.aborted) {
        resolve(null);
        return;
      }
      const events = new AbortController(),
        overlay = document.createElement('div');
      overlay.className = 'mvm-font-picker';
      const style = document.createElement('style');
      style.textContent = `
        .mvm-font-picker{position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;background:#0007;padding:20px;color:var(--text,#202635);font:13px/1.45 system-ui,sans-serif}
        .mvm-font-picker *{box-sizing:border-box}
        .mvm-font-picker .mfp-dialog{display:flex;flex-direction:column;width:560px;max-width:100%;max-height:min(720px,90vh);border:1px solid var(--border,#bfc6d5);border-radius:12px;background:var(--surface,var(--surface1,#fff));color:var(--text,#202635);box-shadow:0 18px 60px #0006;padding:16px;gap:10px}
        .mvm-font-picker header{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .mvm-font-picker h3{margin:0;font-size:17px}
        .mvm-font-picker button,.mvm-font-picker input{font:inherit;color:inherit;background:var(--surface,var(--surface1,#fff));border:1px solid var(--border,#bfc6d5);border-radius:6px;padding:8px}
        .mvm-font-picker button{cursor:pointer}
        .mvm-font-picker button:focus-visible,.mvm-font-picker input:focus-visible{outline:2px solid var(--accent,#6352d8);outline-offset:1px}
        .mvm-font-picker .mfp-list{overflow:auto;min-height:120px;max-height:470px;display:flex;flex-direction:column;gap:5px;padding:3px}
        .mvm-font-picker .mfp-row{flex-shrink:0;text-align:left;padding:9px 12px;min-height:86px}
        .mvm-font-picker .mfp-row[aria-selected=true]{border-color:var(--accent,#6352d8);box-shadow:inset 0 0 0 1px var(--accent,#6352d8)}
        .mvm-font-picker .mfp-row:hover{background:var(--bg,#f2f4f8)}
        .mvm-font-picker small{display:block;font:12px/1.3 system-ui,sans-serif;opacity:.78;margin-bottom:6px}
        .mvm-font-picker .mfp-sample{display:block;font-size:25px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mvm-font-picker label{display:flex;flex-direction:column;gap:4px}
      `;
      const dialog = document.createElement('section');
      dialog.className = 'mfp-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', t('pickerTitle'));
      const header = document.createElement('header'),
        title = document.createElement('h3');
      title.textContent = t('pickerTitle');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '×';
      cancel.setAttribute('aria-label', t('pickerClose'));
      header.append(title, cancel);
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = t('search');
      search.setAttribute('aria-label', t('search'));
      search.dataset.fontSearch = '';
      const label = document.createElement('label');
      label.append(document.createTextNode(t('pickerSample')));
      const sample = document.createElement('input');
      sample.value = String(opts.sample || 'Aa Bb Жж 0123456789')
        .replace(/\s+/g, ' ')
        .slice(0, 100);
      sample.maxLength = 100;
      sample.dataset.fontSample = '';
      label.append(sample);
      const list = document.createElement('div');
      list.className = 'mfp-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', t('pickerTitle'));
      dialog.append(header, search, label, list);
      overlay.append(style, dialog);
      document.body.append(overlay);
      const previous = document.activeElement;
      const close = (value) => {
        observer?.disconnect();
        events.abort();
        overlay.remove();
        if (currentClose === close) currentClose = null;
        if (previous?.isConnected) previous.focus({ preventScroll: true });
        resolve(value ?? null);
      };
      currentClose = close;
      const choices = opts.choices || [
        ['sans-serif', 'Sans serif'],
        ['serif', 'Serif'],
        ['monospace', 'Monospace'],
        ...C.families.map((f) => [f.family, f.family]),
      ];
      let observer,
        revision = 0;
      const paint = async (row, rev) => {
        const name = row.dataset.fontFamily,
          example = sample.value || 'Aa Bb Жж 0123456789';
        row.dataset.loading = 'true';
        await C.ready([name], example);
        if (!row.isConnected || rev !== revision) return;
        row.dataset.loading = 'false';
        const preview = row.querySelector('.mfp-sample');
        if (C.has(name) && !document.fonts.check(`16px "${name}"`, example)) {
          preview.textContent = t('pickerUnavailable');
          row.dataset.fontReady = 'false';
          return;
        }
        preview.style.fontFamily = C.has(name) ? C.stack(name) : name;
        preview.textContent = example;
        row.dataset.fontReady = 'true';
      };
      const render = (revealSelected = false) => {
        revision++;
        const rev = revision;
        observer?.disconnect();
        list.replaceChildren();
        const filtered = choices.filter(([value, text]) =>
          (value + ' ' + text)
            .toLocaleLowerCase()
            .includes(search.value.toLocaleLowerCase()),
        );
        if (!filtered.length) {
          const empty = document.createElement('p');
          empty.textContent = t('none');
          list.append(empty);
          return;
        }
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries)
              if (e.isIntersecting) {
                observer.unobserve(e.target);
                paint(e.target, rev);
              }
          },
          { root: list, rootMargin: '80px' },
        );
        for (const [name, text] of filtered) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'mfp-row';
          row.dataset.fontFamily = name;
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(name === opts.value));
          const caption = document.createElement('small');
          caption.textContent = text;
          if (name === opts.value) {
            const marker = document.createElement('span');
            marker.textContent = '✓';
            marker.setAttribute('aria-hidden', 'true');
            caption.prepend(marker, ' ');
          }
          const preview = document.createElement('span');
          preview.className = 'mfp-sample';
          preview.textContent = '…';
          row.append(caption, preview);
          row.addEventListener('click', () => close(name));
          list.append(row);
          observer.observe(row);
        }
        if (revealSelected) {
          const selected = list.querySelector('[aria-selected="true"]');
          if (selected) list.scrollTop += selected.getBoundingClientRect().top - list.getBoundingClientRect().top
            - (list.clientHeight - selected.offsetHeight) / 2;
        }
      };
      cancel.onclick = () => close();
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) close();
      });
      overlay.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          return;
        }
        const rows = [...list.querySelectorAll('button')];
        if (
          ['ArrowDown', 'ArrowUp'].includes(e.key) &&
          document.activeElement !== sample
        ) {
          e.preventDefault();
          const i = rows.indexOf(document.activeElement),
            next =
              rows[
                i < 0
                  ? e.key === 'ArrowDown'
                    ? 0
                    : rows.length - 1
                  : (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) %
                    rows.length
              ];
          next?.focus();
        }
        if (e.key === 'Tab') {
          const items = [cancel, search, sample, ...rows],
            i = items.indexOf(document.activeElement);
          if (e.shiftKey && i === 0) {
            e.preventDefault();
            items.at(-1)?.focus();
          } else if (!e.shiftKey && i === items.length - 1) {
            e.preventDefault();
            cancel.focus();
          }
        }
      });
      search.oninput = () => render();
      sample.oninput = () => render();
      opts.signal?.addEventListener('abort', () => close(), {
        signal: events.signal,
      });
      render(true);
      search.focus({ preventScroll: true });
    });
  };
})();
