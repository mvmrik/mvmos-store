// Road to a Million: the AI part of the question manager (desktop only).
// Loaded by manager.js when an AI button is used. The server asks mvmAI; this
// file only builds the windows and polls the jobs. Every request to the AI
// stands alone; nothing of an earlier one is sent again.
(function () {
  if (window.RoadToMillionAI) return;
  const API = '/api/apps/roadtomillion';
  const NAMES = { en: 'English', bg: 'Български', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語', 'pt-BR': 'Português (Brasil)', ru: 'Русский', 'zh-CN': '简体中文' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
    const quiet = 'background:var(--surface2);color:var(--text)';

  // The language of the desktop, as one of the nine the game has.
  function uiLang(langs) {
    const raw = (window.mvmOS && mvmOS.lang) || document.documentElement.lang || 'en';
    return langs.find(l => l === raw) || langs.find(l => l.toLowerCase() === String(raw).toLowerCase()) ||
      langs.find(l => l.split('-')[0] === String(raw).split('-')[0]) || 'en';
  }

  const token = () => (typeof AppHub !== 'undefined' && AppHub.getToken && AppHub.getToken()) || localStorage.getItem('apphub_token') || '';

  async function call(path, method, body) {
    let res;
    try {
      res = await fetch(API + path, { method: method || 'GET', headers: Object.assign({ 'X-Pub-Token': token() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (_) { throw new Error('network'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The AI is asked as an Apps Hub profile: open the sign-in so the reason is clear.
      if (j.detail === 'login_required' && typeof AppHub !== 'undefined' && AppHub.requireLogin) AppHub.requireLogin(() => {});
      throw new Error(String(j.detail || 'error'));
    }
    return j;
  }

  // Starts a job on the server and waits for it; null when `alive()` says the window is gone.
  async function job(path, body, onProgress, alive) {
    const { job: id } = await call(path, 'POST', body);
    for (;;) {
      await sleep(1500);
      if (alive && !alive()) return null;
      const st = await call('/ai/job/' + id);
      if (onProgress) onProgress(st.progress);
      if (st.status === 'done') return st.result;
      if (st.status === 'error') throw new Error(st.error);
    }
  }

  function errText(e) {
    const m = String((e && e.message) || e);
    return m === 'mvmai_missing' ? t('rmm_ai_err_missing') : m === 'mvmai_disabled' ? t('rmm_ai_err_disabled')
      : m === 'repair_too_long' ? t('rmm_imp_repair_long') : m === 'repair_incomplete' ? t('rmm_imp_repair_incomplete')
      : m === 'login_required' ? t('rmm_ai_err_profile') : m === 'timeout' ? t('rmm_ai_err_timeout')
      : t('rmm_ai_err');
  }

  const field = (label, inner) => '<label style="display:flex;flex-direction:column;gap:3px;font-size:.8rem">' + esc(label) + inner + '</label>';
  const tag = txt => '<span style="font-size:.75rem;background:var(--surface2);border-radius:10px;padding:1px 8px">' + esc(txt) + '</span>';
  const warn = txt => '<span style="font-size:.75rem;color:var(--warning, #c80)">⚠ ' + esc(txt) + '</span>';
  const bad = txt => '<span style="font-size:.75rem;color:var(--danger, #d33)">' + esc(txt) + '</span>';

  const issueText = (i, langs) => {
    const [code, l] = i.split(':');
    return code === 'missing_text' ? t('rmm_issue_missing', { lang: NAMES[l] || l })
      : code === 'bad_text' ? t('rmm_err_text', { lang: NAMES[l] || l })
      : code === 'too_long' ? t('rmm_err_long', { lang: NAMES[l] || l })
      : code === 'no_category' ? t('rmm_issue_cat') : code === 'no_level' ? t('rmm_issue_level')
      : code === 'no_country_chances' || code === 'no_specialist_chances' ? t('rmm_issue_chances')
      : code === 'no_english' ? t('rmm_err_en') : i;
  };

  // ── Create with AI ─────────────────────────────────────────────────────────
  function createWindow(mgr) {
    const d = mgr.meta, winId = 'roadtomillion-ai-create';
    let open = true;
    mgr.panel({
      id: winId,
      title: '✨ ' + t('rmm_ai_create_title'),
      width: 780, height: 700,
      onClose() { open = false; },
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
        const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
        const lang0 = uiLang(d.langs);
        body.innerHTML =
          '<div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:10px">' +
          '<div style="font-size:.8rem;color:var(--text-dim)">' + esc(t('rmm_ai_create_hint')) + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          field(t('rmm_category'), '<select class="c-cat">' + opt('', t('rmm_ai_any_cat'), true) + d.cats.map(c => opt(c, t('rm_cat_' + c), false)).join('') + '</select>') +
          field(t('rmm_ai_write_lang'), '<select class="c-lang">' + d.langs.map(l => opt(l, NAMES[l], l === lang0)).join('') + '</select>') +
          field(t('rmm_ai_count'), '<input class="c-n" type="number" min="1" max="40" value="10" style="width:70px">') + '</div>' +
          field(t('rmm_ai_wishes'), '<textarea class="c-text" rows="2" placeholder="' + esc(t('rmm_ai_wishes_ph')) + '" style="width:100%;resize:vertical"></textarea>') +
          '<div style="display:flex;gap:10px;align-items:center"><button class="s-btn c-go">✨ ' + esc(t('rmm_ai_suggest')) + '</button></div></div>' +
          '<div class="c-out" style="flex:1;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px"></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--border)">' +
          '<span style="font-size:.8rem;color:var(--text-dim)">' + esc(t('rmm_ai_confirm_hint')) + '</span>' +
          '<span class="c-status" style="flex:1;font-size:.85rem;color:var(--text-dim);text-align:center"></span>' +
          '<button class="s-btn c-add">' + esc(t('rmm_ai_add')) + '</button></div>';
        const $ = s => body.querySelector(s), out = $('.c-out');
        const status = txt => { $('.c-status').textContent = txt || ''; };
        const cards = () => Array.from(out.querySelectorAll('.c-card'));
        const chosen = () => cards().filter(c => c.querySelector('.c-on').checked);
        const refresh = () => { const n = chosen().length; $('.c-add').textContent = t('rmm_ai_add') + (n ? ' (' + n + ')' : ''); $('.c-go').textContent = '✨ ' + t(cards().length ? 'rmm_ai_more' : 'rmm_ai_suggest'); };
        const busy = on => { $('.c-go').disabled = on; $('.c-add').disabled = on; };

        const addCard = it => {
          const l = it.lang, x = it.texts[l];
          const div = document.createElement('div');
          div.className = 'c-card';
          div.dataset.c = it.c || ''; div.dataset.d = it.d || 0; div.dataset.lang = l;
          div.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px';
          div.innerHTML =
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center;font-size:.85rem"><input class="c-on" type="checkbox" checked>' + esc(t('rmm_ai_take')) + '</label>' +
            (it.c ? tag(t('rm_cat_' + it.c)) : '') + (it.d ? tag(t('rmm_level', { n: it.d })) : '') +
            (it.dup ? warn(t('rmm_ai_dup', { id: it.dup })) : '') + '</div>' +
            '<textarea class="c-q" rows="2" style="width:100%;resize:vertical">' + esc(x.q) + '</textarea>' +
            x.a.map((v, i) => '<input class="c-a" type="text" value="' + esc(v) + '" placeholder="' + esc(i === 0 ? '✓ ' + t('rmm_correct') : t('rmm_wrong', { n: i })) + '" style="width:100%">').join('');
          div.querySelector('.c-on').onchange = refresh;
          out.appendChild(div);
        };

        $('.c-go').onclick = async () => {
          busy(true); status(t('rmm_ai_working'));
          try {
            const wl = $('.c-lang').value;
            const r = await job('/ai/suggest', { lang: lang0, write_lang: wl, cat: $('.c-cat').value, count: Math.max(1, Math.min(40, parseInt($('.c-n').value, 10) || 10)), text: $('.c-text').value },
              p => status(t('rmm_ai_working') + (p ? ' ' + p : '')), () => open && body.isConnected);
            if (!r) return;
            if (!r.items.length) status(t('rmm_ai_none'));
            else { status(''); r.items.forEach(it => addCard(Object.assign({ lang: wl }, it))); }
          } catch (e) { status(errText(e)); }
          busy(false); refresh();
        };

        $('.c-add').onclick = async () => {
          const picked = chosen();
          if (!picked.length) { status(t('rmm_none_selected')); return; }
          const items = picked.map(c => ({
            c: c.dataset.c, d: +c.dataset.d || 0,
            texts: { [c.dataset.lang]: { q: c.querySelector('.c-q').value, a: Array.from(c.querySelectorAll('.c-a')).map(i => i.value) } },
          }));
          busy(true); status(t('rmm_ai_adding'));
          try {
            const r = await job('/ai/finish', { lang: lang0, items }, p => status(t('rmm_ai_adding') + (p ? ' ' + p : '')), () => open && body.isConnected);
            if (!r) return;
            r.added.forEach(a => { if (picked[a.index]) picked[a.index].remove(); });
            status('');
            const sum = document.createElement('div');
            sum.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:.85rem;display:flex;flex-direction:column;gap:4px';
            sum.innerHTML = '<div style="font-weight:600">' + esc(t('rmm_ai_added', { n: r.added.length })) + '</div>' +
              r.added.map(a => '<div>' + esc(a.id) + ' · ' + esc(a.text) + (a.missing.length ? ' ' + warn(t('rmm_missing_n', { n: a.missing.length })) : '') + '</div>').join('') +
              r.failed.map(f => '<div>' + bad(t('rmm_ai_failed') + ': ') + esc(f.text) + ' — ' + esc(f.why === 'reject' ? (f.notes || []).join(' ') || t('rmm_ai_rejected') : t('rmm_ai_incomplete')) + '</div>').join('');
            out.prepend(sum);
            await mgr.load(false);
          } catch (e) { status(errText(e)); }
          busy(false); refresh();
        };
        refresh();
      },
    });
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  function importWindow(mgr) {
    const d = mgr.meta;
    let open = true, items = [], parsedText = null;
    mgr.panel({
      id: 'roadtomillion-ai-import',
      title: '📥 ' + t('rmm_imp_title'),
      width: 780, height: 720,
      onClose() { open = false; },
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
        body.innerHTML =
          '<div style="flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px">' +
          '<div style="font-weight:600">1. ' + esc(t('rmm_imp_step1')) + '</div>' +
          '<div style="font-size:.8rem;color:var(--text-dim)">' + esc(t('rmm_imp_step1_hint')) + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          field(t('rmm_ai_count'), '<input class="i-n" type="number" min="1" max="50" value="30" style="width:70px">') +
          '<div style="flex:1;min-width:200px">' + field(t('rmm_ai_wishes'), '<input class="i-topic" type="text" placeholder="' + esc(t('rmm_imp_topic_ph')) + '" style="width:100%">') + '</div>' +
          '<button class="s-btn i-copy">📋 ' + esc(t('rmm_imp_copy')) + '</button></div>' +
          '<div class="i-copied" style="font-size:.85rem;color:var(--text-dim);min-height:1.1em"></div>' +
          '<details class="i-tpl-box" style="display:none"><summary style="cursor:pointer;font-size:.8rem">' + esc(t('rmm_imp_show')) + '</summary><textarea class="i-tpl" readonly rows="8" style="width:100%;margin-top:6px"></textarea></details>' +
          '<div style="font-weight:600;margin-top:4px">2. ' + esc(t('rmm_imp_step2')) + '</div>' +
          '<textarea class="i-paste" rows="5" placeholder="' + esc(t('rmm_imp_paste_ph')) + '" style="width:100%;resize:vertical"></textarea>' +
          '<div style="display:flex;gap:10px;align-items:center"><button class="s-btn i-parse">' + esc(t('rmm_imp_review')) + '</button></div>' +
          '<div class="i-list" style="display:flex;flex-direction:column;gap:8px"></div></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--border)">' +
          '<button class="s-btn i-ai" style="' + quiet + '" title="' + esc(t('rmm_imp_ai_hint')) + '">✨ ' + esc(t('rmm_imp_ai')) + '</button>' +
          '<span class="i-status" style="flex:1;font-size:.85rem;color:var(--text-dim);text-align:center"></span>' +
          '<button class="s-btn i-add">' + esc(t('rmm_ai_add')) + '</button></div>';
        const $ = s => body.querySelector(s), list = $('.i-list');
        const status = txt => { $('.i-status').textContent = txt || ''; };
        const addable = it => !!(it.c && it.d && it.texts && it.texts.en && it.verdict !== 'reject');
        const isOn = i => { const c = list.querySelector('[data-i="' + i + '"] .i-on'); return !!(c && c.checked); };
        const picked = () => items.map((it, i) => ({ it, i })).filter(x => isOn(x.i));
        const refresh = () => {
          const n = picked().filter(x => addable(x.it)).length;
          $('.i-add').textContent = t('rmm_ai_add') + (n ? ' (' + n + ')' : '');
        };
        const busy = on => { $('.i-parse').disabled = on; $('.i-ai').disabled = on; $('.i-add').disabled = on; $('.i-paste').disabled = on; if (!on) refresh(); };

        const edit = i => {
          const it = items[i];
          mgr.editor(null, { winId: 'roadtomillion-edit-import-' + i, draft: it, onApply: p => {
            const texts = {};
            d.langs.forEach(l => { const x = p.texts[l]; if (x && (x.q.trim() || x.a.some(v => v.trim()))) texts[l] = x; });
            const issues = (it.issues || []).filter(s => !/^(missing_text|no_|bad_text|too_long)/.test(s));
            d.langs.forEach(l => { if (!texts[l]) issues.push('missing_text:' + l); });
            items[i] = Object.assign({}, it, { c: p.c, d: p.d, k: p.k, s: p.s, dc: p.dc || {}, changeable: !!p.changeable, texts, issues });
            const selected = items.map((_, index) => isOn(index));
            draw();
            list.querySelectorAll('[data-i]').forEach(row => {
              const c = row.querySelector('.i-on');
              if (c) c.checked = selected[+row.dataset.i];
            });
            refresh();
          } });
        };

        const draw = () => {
          list.innerHTML = items.map((it, i) => {
            const x = it.texts[d.langs.includes(uiLang(d.langs)) && it.texts[uiLang(d.langs)] ? uiLang(d.langs) : (it.texts.en ? 'en' : Object.keys(it.texts)[0])] || { q: '', a: [] };
            const miss = (it.issues || []).filter(s => s.startsWith('missing_text')).length;
            const probs = (it.issues || []).filter(s => /^(bad_text|too_long|no_english|no_category|no_level)/.test(s));
            const ok = addable(it) && it.verdict !== 'reject';
            return '<div data-i="' + i + '" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:5px' + (ok ? '' : ';opacity:.85') + '">' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="i-on" type="checkbox"' + ' checked' + '>' +
              (it.c ? tag(t('rm_cat_' + it.c)) : '') + (it.d ? tag(t('rmm_level', { n: it.d })) : '') +
              (miss ? warn(t('rmm_missing_n', { n: miss })) : '') +
              ((!it.k || !it.s) ? warn(t('rmm_issue_chances')) : '') +
              (it.dup ? warn(t('rmm_ai_dup', { id: it.dup })) : '') +
              probs.map(p => bad(issueText(p))).join(' ') +
              (it.verdict === 'reject' ? bad(t('rmm_ai_rejected')) : it.verdict === 'fixed' ? tag(t('rmm_imp_fixed')) : it.verdict === 'ok' ? tag(t('rmm_imp_checked')) : '') + '</div>' +
              '<div>' + esc(x.q) + '</div>' +
              '<div style="font-size:.8rem;color:var(--text-dim)">✓ ' + (x.a || []).map(esc).join(' · ') + '</div>' +
              ((it.notes || []).length ? '<div style="font-size:.8rem;color:var(--text-dim)">' + it.notes.map(esc).join('<br>') + '</div>' : '') + '</div>';
          }).join('');
          list.querySelectorAll('.i-on').forEach(c => c.onchange = refresh);
          list.querySelectorAll('[data-i]').forEach(r => {
            r.style.cursor = 'pointer';
            r.onclick = ev => { if (ev.target.closest('.i-on')) return; edit(+r.dataset.i); };
          });
          refresh();
        };

        $('.i-copy').onclick = async () => {
          let r;
          try { r = await call('/import/template?count=' + (parseInt($('.i-n').value, 10) || 30) + '&topic=' + encodeURIComponent($('.i-topic').value)); } catch (e) { $('.i-copied').textContent = errText(e); return; }
          const tpl = $('.i-tpl');
          tpl.value = r.text; $('.i-tpl-box').style.display = '';
          let done = false;
          try { await navigator.clipboard.writeText(r.text); done = true; } catch (_) {
            tpl.select();
            try { done = document.execCommand('copy'); } catch (_) { /* the text stays selected for a manual copy */ }
          }
          $('.i-copied').textContent = done ? t('rmm_imp_copied') : t('rmm_imp_copy_manual');
        };

        $('.i-paste').addEventListener('input', () => { parsedText = null; items = []; draw(); status(''); });

        $('.i-parse').onclick = async () => {
          status(''); busy(true); items = []; parsedText = null; draw();
          try {
            const r = await call('/import/parse', 'POST', { text: $('.i-paste').value });
            items = r.items; parsedText = $('.i-paste').value; draw();
            if (!items.length) status(t('rmm_imp_none'));
          } catch (_) { status(t('rmm_imp_bad')); }
          busy(false);
        };

        $('.i-ai').onclick = async () => {
          const raw = $('.i-paste').value;
          if (parsedText === null && raw.trim()) {
            busy(true); status(t('rmm_ai_working'));
            try {
              const r = await job('/import/repair', { text: raw },
                p => status(t('rmm_ai_working') + (p ? ' ' + p : '')), () => open && body.isConnected);
              if (!r) return;
              items = r.items; parsedText = raw; draw(); status(t('rmm_imp_repaired'));
            } catch (e) { status(errText(e)); }
            busy(false); return;
          }
          const pick = picked();
          if (!pick.length) { status(t('rmm_imp_pick_first')); return; }
          busy(true); status(t('rmm_ai_working'));
          try {
            const r = await job('/ai/review', { lang: uiLang(d.langs), items: pick.map(x => ({ c: x.it.c, d: x.it.d, changeable: !!x.it.changeable, k: x.it.k, s: x.it.s, dc: x.it.dc || {}, texts: x.it.texts })) },
              p => status(t('rmm_ai_working') + (p ? ' ' + p : '')), () => open && body.isConnected);
            if (!r) return;
            r.items.forEach((n, j) => { if (n) items[pick[j].i] = n; });
            status(''); draw();
          } catch (e) { status(errText(e)); }
          busy(false);
        };

        $('.i-add').onclick = async () => {
          const pick = picked().filter(x => addable(x.it));
          if (!pick.length) { status(t('rmm_none_selected')); return; }
          busy(true);
          try {
            const r = await call('/import/add', 'POST', { items: pick.map(x => ({ c: x.it.c, d: x.it.d, changeable: !!x.it.changeable, k: x.it.k, s: x.it.s, dc: x.it.dc || {}, texts: x.it.texts })) });
            const gone = new Set(r.added.map(a => pick[a.index]?.i).filter(i => i !== undefined));
            items = items.filter((_, i) => !gone.has(i));
            draw();
            status(t('rmm_ai_added', { n: r.added.length }) + (r.failed.length ? ' · ' + t('rmm_ai_failed') + ': ' + r.failed.length : ''));
            await mgr.load(false);
          } catch (_) { status(t('rmm_err_generic')); }
          busy(false);
        };
      },
    });
  }

  window.RoadToMillionAI = { call, job, errText, uiLang, createWindow, importWindow };
})();
