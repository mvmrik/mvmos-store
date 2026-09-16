(function () {
  function t(k, v) { return (window.t || function (x) { return x }) (k, v) }

  var API = '/pub/deepl';
  var LANGS = [
    ['BG', 'Bulgarian'], ['ZH', 'Chinese'], ['CS', 'Czech'], ['DA', 'Danish'],
    ['NL', 'Dutch'], ['EN-GB', 'English (British)'], ['EN-US', 'English (American)'],
    ['ET', 'Estonian'], ['FI', 'Finnish'], ['FR', 'French'], ['DE', 'German'],
    ['EL', 'Greek'], ['HU', 'Hungarian'], ['ID', 'Indonesian'], ['IT', 'Italian'],
    ['JA', 'Japanese'], ['KO', 'Korean'], ['LV', 'Latvian'], ['LT', 'Lithuanian'],
    ['NB', 'Norwegian'], ['PL', 'Polish'], ['PT-BR', 'Portuguese (Brazilian)'],
    ['PT-PT', 'Portuguese (European)'], ['RO', 'Romanian'], ['RU', 'Russian'],
    ['SK', 'Slovak'], ['SL', 'Slovenian'], ['ES', 'Spanish'], ['SV', 'Swedish'],
    ['TR', 'Turkish'], ['UK', 'Ukrainian'],
  ];
  var SOURCE_LANGS = [
    ['BG', 'Bulgarian'], ['ZH', 'Chinese'], ['CS', 'Czech'], ['DA', 'Danish'],
    ['NL', 'Dutch'], ['EN', 'English'], ['ET', 'Estonian'], ['FI', 'Finnish'],
    ['FR', 'French'], ['DE', 'German'], ['EL', 'Greek'], ['HU', 'Hungarian'],
    ['ID', 'Indonesian'], ['IT', 'Italian'], ['JA', 'Japanese'], ['KO', 'Korean'],
    ['LV', 'Latvian'], ['LT', 'Lithuanian'], ['NB', 'Norwegian'], ['PL', 'Polish'],
    ['PT', 'Portuguese'], ['RO', 'Romanian'], ['RU', 'Russian'], ['SK', 'Slovak'],
    ['SL', 'Slovenian'], ['ES', 'Spanish'], ['SV', 'Swedish'], ['TR', 'Turkish'],
    ['UK', 'Ukrainian'],
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(path, options) {
    options = options || {};
    var token = window.DeepLWidget._token;
    return fetch(API + path, Object.assign({}, options, {
      headers: Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, options.headers || {}),
    })).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    });
  }

  function optionsHtml(list, selected) {
    return list.map(function (pair) {
      return '<option value="' + pair[0] + '"' + (pair[0] === selected ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
    }).join('');
  }

  function timeAgo(ts) {
    var d = new Date(ts * 1000);
    return d.toLocaleString();
  }

  function mount(root, opts) {
    opts = opts || {};
    var token = localStorage.getItem('apphub_token');
    if (!token) {
      if (opts.onNeedLogin) return opts.onNeedLogin();
      root.innerHTML = '<div style="padding:24px;text-align:center;color:var(--pub-fg,#ccc)">' + esc(t('deepl_login')) + '</div>';
      return;
    }
    window.DeepLWidget._token = token;

    // Kept locally per device only (not the database) so switching between
    // the same pair of languages a lot doesn't mean re-picking them every
    // time the widget is reopened.
    var SRC_LANG_KEY = 'deepl_source_lang', TGT_LANG_KEY = 'deepl_target_lang';
    var savedSrcLang = localStorage.getItem(SRC_LANG_KEY) || '';
    var savedTgtLang = localStorage.getItem(TGT_LANG_KEY) || 'EN-US';

    root.innerHTML =
      '<div class="dpl-wrap">' +
        '<style>' +
          '.dpl-wrap{height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:16px;gap:12px;font-family:system-ui,sans-serif;color:var(--pub-fg,#e8e8ec);background:var(--pub-bg,#1e1e2e)}' +
          '.dpl-wrap *{box-sizing:border-box}' +
          '.dpl-head{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
          '.dpl-head h1{font-size:18px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
          '.dpl-usage{font-size:12px;opacity:.65;white-space:nowrap}' +
          '.dpl-gear{cursor:pointer;font-size:18px;opacity:.8;background:none;border:none;color:inherit}' +
          '.dpl-gear:hover{opacity:1}' +
          '.dpl-langs{display:flex;align-items:center;gap:8px}' +
          '.dpl-langs select{flex:1;padding:6px;border-radius:6px;border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);color:inherit}' +
          '.dpl-swap{cursor:pointer;background:none;border:none;color:inherit;font-size:16px;padding:4px 8px}' +
          '.dpl-panes{display:flex;gap:12px;flex:1;min-height:120px}' +
          '.dpl-pane{flex:1;display:flex;flex-direction:column}' +
          '.dpl-pane textarea{flex:1;resize:none;padding:10px;border-radius:8px;border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);color:inherit;font-size:14px}' +
          '.dpl-actions{display:flex;justify-content:space-between;align-items:center}' +
          '.dpl-btn{padding:8px 16px;border-radius:8px;border:none;background:var(--pub-accent,#2563eb);color:#fff;cursor:pointer;font-size:14px}' +
          '.dpl-btn:disabled{opacity:.5;cursor:default}' +
          '.dpl-link-btn{background:none;border:none;color:inherit;opacity:.75;cursor:pointer;font-size:13px}' +
          '.dpl-link-btn:hover{opacity:1}' +
          '.dpl-error{color:var(--pub-red,#f38ba8);font-size:13px}' +
          '.dpl-hist{border-top:1px solid var(--pub-border,#45475a);padding-top:8px;overflow:auto;max-height:220px}' +
          '.dpl-hist h2{font-size:13px;opacity:.7;margin:0 0 8px;display:flex;justify-content:space-between}' +
          '.dpl-hist-item{padding:8px;border-radius:6px;background:var(--pub-surface2,#313244);margin-bottom:6px;font-size:13px}' +
          '.dpl-hist-meta{opacity:.6;font-size:11px;margin-bottom:4px}' +
          '.dpl-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}' +
          '.dpl-modal{background:var(--pub-surface1,var(--pub-bg,#1e1e2e));color:inherit;border-radius:10px;padding:20px;width:min(420px,90vw)}' +
          '.dpl-modal h3{margin-top:0}' +
          '.dpl-modal input{width:100%;padding:8px;border-radius:6px;border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);color:inherit;margin:8px 0}' +
          '.dpl-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}' +
          '.dpl-hint{font-size:12px;opacity:.65}' +
        '</style>' +
        '<div class="dpl-head"><h1>' + esc(t('deepl_title')) + '</h1>' +
          '<span class="dpl-usage" data-role="usage" hidden></span>' +
          '<button class="dpl-gear" data-act="settings" title="' + esc(t('deepl_settings')) + '">⚙️</button></div>' +
        '<div class="dpl-langs">' +
          '<select data-role="source-lang">' +
            '<option value="">' + esc(t('deepl_auto_detect')) + '</option>' +
            optionsHtml(SOURCE_LANGS, savedSrcLang) +
          '</select>' +
          '<button class="dpl-swap" data-act="swap" title="' + esc(t('deepl_swap')) + '">⇄</button>' +
          '<select data-role="target-lang">' + optionsHtml(LANGS, savedTgtLang) + '</select>' +
        '</div>' +
        '<div class="dpl-panes">' +
          '<div class="dpl-pane"><textarea data-role="source" placeholder="' + esc(t('deepl_source_placeholder')) + '" maxlength="5000"></textarea></div>' +
          '<div class="dpl-pane"><textarea data-role="result" placeholder="' + esc(t('deepl_result_placeholder')) + '" readonly></textarea></div>' +
        '</div>' +
        '<div class="dpl-actions">' +
          '<button class="dpl-btn" data-act="translate">' + esc(t('deepl_translate')) + '</button>' +
          '<span class="dpl-error" data-role="error" hidden></span>' +
          '<button class="dpl-link-btn" data-act="copy">' + esc(t('deepl_copy')) + '</button>' +
        '</div>' +
        '<div class="dpl-hist">' +
          '<h2><span>' + esc(t('deepl_history')) + '</span><span>' +
            '<button class="dpl-link-btn" data-act="load-history">' + esc(t('deepl_load_history')) + '</button>' +
            '<button class="dpl-link-btn" data-act="clear-history">' + esc(t('deepl_clear_history')) + '</button>' +
          '</span></h2>' +
          '<div data-role="hist-list"></div>' +
        '</div>' +
      '</div>';

    var $ = function (sel) { return root.querySelector(sel); };
    var srcEl = $('[data-role=source]');
    var resEl = $('[data-role=result]');
    var srcLangEl = $('[data-role=source-lang]');
    var tgtLangEl = $('[data-role=target-lang]');
    var errEl = $('[data-role=error]');
    var translateBtn = $('[data-act=translate]');

    function showError(msg, ok) {
      errEl.textContent = msg;
      errEl.hidden = !msg;
      errEl.style.color = ok ? 'var(--pub-green,#a6e3a1)' : '';
    }

    function errorMessage(code) {
      return {
        api_key_missing: t('deepl_key_missing_body'),
        invalid_api_key: t('deepl_error_invalid_key'),
        quota_exceeded: t('deepl_error_quota'),
        deepl_unreachable: t('deepl_error_unreachable'),
        empty_text: t('deepl_error_empty_text'),
        text_too_long: t('deepl_error_too_long'),
      }[code] || t('deepl_error_generic');
    }

    function fmtNum(n) {
      try { return Number(n).toLocaleString(); } catch (e) { return String(n); }
    }

    function loadUsage() {
      var usageEl = $('[data-role=usage]');
      api('/usage').then(function (res) {
        if (!res.ok) { usageEl.hidden = true; return; }
        var count = res.data.character_count || 0;
        var limit = res.data.character_limit || 0;
        usageEl.textContent = limit > 0
          ? t('deepl_usage', { count: fmtNum(count), limit: fmtNum(limit) })
          : t('deepl_usage_unlimited', { count: fmtNum(count) });
        usageEl.hidden = false;
      }).catch(function () { usageEl.hidden = true; });
    }

    function loadHistory() {
      api('/history').then(function (res) {
        if (!res.ok) return;
        var list = $('[data-role=hist-list]');
        var items = res.data.history || [];
        if (!items.length) {
          list.innerHTML = '<div class="dpl-hint">' + esc(t('deepl_history_empty')) + '</div>';
          return;
        }
        list.innerHTML = items.map(function (h) {
          return '<div class="dpl-hist-item">' +
            '<div class="dpl-hist-meta">' + esc((h.source_lang || '?') + ' → ' + h.target_lang) + ' · ' + esc(timeAgo(h.created_at)) + '</div>' +
            '<div>' + esc(h.source_text) + '</div>' +
            '<div style="opacity:.8;margin-top:4px">→ ' + esc(h.translated_text) + '</div>' +
          '</div>';
        }).join('');
      });
    }

    function doTranslate() {
      var text = srcEl.value.trim();
      showError('');
      if (!text) { showError(errorMessage('empty_text')); return; }
      translateBtn.disabled = true;
      translateBtn.textContent = t('deepl_translating');
      api('/translate', {
        method: 'POST',
        body: JSON.stringify({ text: text, target_lang: tgtLangEl.value, source_lang: srcLangEl.value || null }),
      }).then(function (res) {
        translateBtn.disabled = false;
        translateBtn.textContent = t('deepl_translate');
        if (!res.ok) {
          if (res.data.error === 'api_key_missing') return openSettings(true);
          showError(errorMessage(res.data.error));
          return;
        }
        resEl.value = res.data.translated_text;
        loadHistory();
        loadUsage();
      }).catch(function () {
        translateBtn.disabled = false;
        translateBtn.textContent = t('deepl_translate');
        showError(errorMessage('deepl_unreachable'));
      });
    }

    function openSettings(forceMissing) {
      api('/settings').then(function (res) {
        var hasKey = res.ok && res.data.has_api_key;
        var bg = document.createElement('div');
        bg.className = 'dpl-modal-bg';
        bg.innerHTML =
          '<div class="dpl-modal">' +
            '<h3>' + esc(hasKey && !forceMissing ? t('deepl_settings') : t('deepl_key_missing_title')) + '</h3>' +
            (forceMissing || !hasKey ? '<p class="dpl-hint">' + esc(t('deepl_key_missing_body')) + '</p>' : '') +
            '<a class="dpl-link-btn" href="https://www.deepl.com/pro-api" target="_blank" rel="noopener">' + esc(t('deepl_get_key_link')) + '</a>' +
            '<input type="text" data-role="key-input" placeholder="' + esc(hasKey ? t('deepl_key_saved_placeholder') : t('deepl_api_key_placeholder')) + '" autocomplete="off">' +
            '<div class="dpl-hint">' + esc(hasKey ? t('deepl_key_saved_hint') : t('deepl_api_key_hint')) + '</div>' +
            '<div class="dpl-modal-actions">' +
              (hasKey ? '<button class="dpl-link-btn" data-act="remove-key">' + esc(t('deepl_remove_key')) + '</button>' : '') +
              '<button class="dpl-link-btn" data-act="modal-cancel">' + esc(t('deepl_cancel')) + '</button>' +
              '<button class="dpl-btn" data-act="modal-save">' + esc(t('deepl_save')) + '</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(bg);
        var input = bg.querySelector('[data-role=key-input]');
        bg.addEventListener('click', function (e) {
          var act = e.target.getAttribute('data-act');
          if (e.target === bg || act === 'modal-cancel') { bg.remove(); return; }
          if (act === 'modal-save') {
            var key = input.value.trim();
            if (!key) { if (hasKey) bg.remove(); return; }
            api('/settings', { method: 'PUT', body: JSON.stringify({ api_key: key }) }).then(function (res2) {
              if (res2.ok) { bg.remove(); showError(t('deepl_key_saved'), true); loadUsage(); }
            });
          }
          if (act === 'remove-key') {
            if (!confirm(t('deepl_remove_key_confirm'))) return;
            api('/settings', { method: 'DELETE' }).then(function () { bg.remove(); loadUsage(); });
          }
        });
      });
    }

    root.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'translate') doTranslate();
      if (act === 'settings') openSettings(false);
      if (act === 'swap') {
        var s = srcLangEl.value, tg = tgtLangEl.value;
        if (s) {
          var tgBase = tg.split('-')[0];
          var srcMatch = SOURCE_LANGS.some(function (p) { return p[0] === tgBase; });
          srcLangEl.value = srcMatch ? tgBase : '';
          var tgtMatch = LANGS.find(function (p) { return p[0] === s || p[0].split('-')[0] === s; });
          tgtLangEl.value = tgtMatch ? tgtMatch[0] : tgtLangEl.value;
          saveLangs();
        }
        var tmp = srcEl.value; srcEl.value = resEl.value; resEl.value = tmp;
      }
      if (act === 'copy') {
        resEl.select();
        navigator.clipboard && navigator.clipboard.writeText(resEl.value).catch(function () {});
      }
      if (act === 'load-history') loadHistory();
      if (act === 'clear-history') {
        if (!confirm(t('deepl_clear_history_confirm'))) return;
        api('/history', { method: 'DELETE' }).then(loadHistory);
      }
    });

    srcEl.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doTranslate();
    });

    function saveLangs() {
      try {
        localStorage.setItem(SRC_LANG_KEY, srcLangEl.value);
        localStorage.setItem(TGT_LANG_KEY, tgtLangEl.value);
      } catch (e) {}
    }
    srcLangEl.addEventListener('change', saveLangs);
    tgtLangEl.addEventListener('change', saveLangs);

    loadUsage();
  }

  window.DeepLWidget = { mount: mount };
})();
