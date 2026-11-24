// Road to a Million: question manager, desktop only. Opened from the game's
// desktop window; the public Game Hub page never loads this file.
(function () {
  if (window.RoadToMillionManager) return;
  const API = '/api/apps/roadtomillion/questions';
  const NAMES = { en: 'English', bg: 'Български', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語', 'pt-BR': 'Português (Brasil)', ru: 'Русский', 'zh-CN': '简体中文' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(body) {
    const list = document.createElement('div');
    list.style.cssText = 'height:100%;min-height:0';
    body.appendChild(list);
    new Manager(list, body).start();
  }

  class Manager {
    constructor(body, host) {
      this.body = body;
      this.host = host;
      this.panels = [];
      this.meta = null;
      this.items = [];
      this.total = 0;
      this.counts = {};
      this.unexported = false;
      this.f = { q: '', cat: '', level: '', incomplete: false, pending: false, changeable: false };
      this.pending = 0;
      this.show = (document.documentElement.lang || 'en');
      this.closed = new Set();
      this.timer = null;
      this.seq = 0;
    }

    panel(options) {
      const previous = this.panels.length ? this.panels[this.panels.length - 1] : this.body;
      const previousDisplay = previous.style.display;
      previous.style.display = 'none';
      const panel = document.createElement('div');
      panel.style.cssText = 'height:100%;min-height:0;display:flex;flex-direction:column';
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border)';
      const back = document.createElement('button');
      back.className = 's-btn'; back.textContent = '← ' + t('back');
      const title = document.createElement('strong'); title.textContent = options.title || '';
      header.append(back, title);
      const content = document.createElement('div');
      content.style.cssText = 'flex:1;min-height:0';
      panel.append(header, content);
      this.host.appendChild(panel);
      this.panels.push(panel);
      let closed = false;
      const close = () => {
        if (closed || this.panels[this.panels.length - 1] !== panel) return;
        closed = true;
        this.panels.pop(); panel.remove(); previous.style.display = previousDisplay;
        if (options.onClose) options.onClose();
      };
      back.onclick = close;
      options.onMount(content);
      return close;
    }

    async start() {
      this.body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
      this.body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">…</div>';
      await this.load(true);
    }

    // The bank can hold thousands of questions: the server filters and pages
    // them, the window only ever holds the rows it has been given.
    async load(first, more) {
      const f = this.f, seq = ++this.seq;
      const qs = new URLSearchParams({ cat: f.cat, level: f.level || 0, q: f.q, lang: this.show, incomplete: f.incomplete, pending: f.pending, changeable: f.changeable, offset: more ? this.items.length : 0, limit: 100 });
      let res;
      try { res = await fetch(API + '?' + qs); } catch (_) { res = null; }
      if (seq !== this.seq) return;
      if (!res || !res.ok) { this.body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">' + esc(t('rmm_err_generic')) + '</div>'; return; }
      const d = await res.json();
      if (seq !== this.seq) return;
      this.meta = { langs: d.langs, cats: d.cats, countries: d.countries, professions: d.professions };
      this.items = more ? this.items.concat(d.items) : d.items;
      this.total = d.total; this.counts = d.counts; this.unexported = d.unexported; this.pending = d.pending || 0;
      if (first || !this.body.querySelector('.rmm-list')) this.draw(); else { this.drawList(); this.drawExport(); }
    }

    // The AI part is a separate file, loaded the first time it is used.
    ai() {
      if (window.RoadToMillionAI) return Promise.resolve(window.RoadToMillionAI);
      return new Promise(res => {
        const s = document.createElement('script');
        s.src = asset('/apps/roadtomillion/manager-ai.js');
        s.onload = () => res(window.RoadToMillionAI);
        document.head.appendChild(s);
      });
    }

    reload() { clearTimeout(this.timer); this.timer = setTimeout(() => this.load(false), 250); }

    draw() {
      const d = this.meta, f = this.f;
      const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
      this.body.innerHTML =
        '<div class="rmm-bar" style="display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
        '<input class="rmm-q" type="search" placeholder="' + esc(t('rmm_search')) + '" value="' + esc(f.q) + '" style="flex:1;min-width:160px">' +
        '<select class="rmm-cat">' + opt('', t('rmm_all_cats'), !f.cat) + d.cats.map(c => opt(c, t('rm_cat_' + c), f.cat === c)).join('') + '</select>' +
        '<select class="rmm-lvl">' + opt('', t('rmm_all_levels'), !f.level) + Array.from({ length: 20 }, (_, i) => opt(String(i + 1), t('rmm_level', { n: i + 1 }), f.level === String(i + 1))).join('') + '</select>' +
        '<select class="rmm-show" title="' + esc(t('rmm_show_lang')) + '">' + d.langs.map(l => opt(l, NAMES[l] || l, this.show === l)).join('') + '</select>' +
        '<label style="display:flex;gap:4px;align-items:center;font-size:.85rem"><input class="rmm-inc" type="checkbox"' + (f.incomplete ? ' checked' : '') + '>' + esc(t('rmm_incomplete')) + '</label>' +
        '<label style="display:flex;gap:4px;align-items:center;font-size:.85rem"><input class="rmm-pen" type="checkbox"' + (f.pending ? ' checked' : '') + '>' + esc(t('rmm_pending')) + ' <span class="rmm-pen-n" style="color:var(--text-dim)">(' + this.pending + ')</span></label>' +
        '<label style="display:flex;gap:4px;align-items:center;font-size:.85rem"><input class="rmm-changeable" type="checkbox"' + (f.changeable ? ' checked' : '') + '>' + esc(t('rmm_changeable')) + '</label>' +
        '<button class="s-btn rmm-new">+ ' + esc(t('rmm_new')) + '</button>' +
        '<button class="s-btn rmm-aicreate" style="background:var(--surface2);color:var(--text)">✨ ' + esc(t('rmm_ai_create')) + '</button>' +
        '<button class="s-btn rmm-import" style="background:var(--surface2);color:var(--text)">📥 ' + esc(t('rmm_import')) + '</button></div>' +
        '<div class="rmm-list" style="flex:1;overflow:auto;padding:6px 12px 14px"></div>' +
        '<div class="rmm-foot" style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid var(--border);font-size:.8rem"></div>';
      const b = this.body, $ = s => b.querySelector(s);
      $('.rmm-q').oninput = e => { f.q = e.target.value; this.reload(); };
      $('.rmm-cat').onchange = e => { f.cat = e.target.value; this.load(false); };
      $('.rmm-lvl').onchange = e => { f.level = e.target.value; this.load(false); };
      $('.rmm-show').onchange = e => { this.show = e.target.value; this.load(false); };
      $('.rmm-inc').onchange = e => { f.incomplete = e.target.checked; this.load(false); };
      $('.rmm-pen').onchange = e => { f.pending = e.target.checked; this.load(false); };
      $('.rmm-changeable').onchange = e => { f.changeable = e.target.checked; this.load(false); };
      $('.rmm-new').onclick = () => this.editor(null);
      $('.rmm-aicreate').onclick = async () => (await this.ai()).createWindow(this);
      $('.rmm-import').onclick = async () => (await this.ai()).importWindow(this);
      this.drawList();
      this.drawExport();
    }

    drawExport() {
      const foot = this.body.querySelector('.rmm-foot');
      if (!foot) return;
      foot.innerHTML = '<span style="color:var(--text-dim)">' + esc(t('rmm_total', { n: this.total })) + (this.pending ? ' · ' + esc(t('rmm_pending_n', { n: this.pending })) : '') + '</span>' +
        '<button class="s-btn rmm-export" title="' + esc(t('rmm_export_hint')) + '">' + esc(t('rmm_export')) + '</button>';
      foot.querySelector('.rmm-export').onclick = async ev => {
        ev.target.disabled = true;
        let res;
        try { res = await fetch(API.replace('/questions', '/export'), { method: 'POST' }); } catch (_) { res = null; }
        ev.target.disabled = false;
        mvmOS.notify && mvmOS.notify(t('rmm_title'), res && res.ok ? t('rmm_exported') : t('rmm_err_generic'));
        if (res && res.ok) this.load(false);
      };
      const pen = this.body.querySelector('.rmm-pen-n');
      if (pen) pen.textContent = '(' + this.pending + ')';
    }

    drawList() {
      const box = this.body.querySelector('.rmm-list'), d = this.meta;
      if (!this.items.length) { box.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-dim)">' + esc(t('rmm_empty')) + '</div>'; return; }
      let html = '', last = null;
      this.items.forEach(q => {
        if (q.c !== last) {
          last = q.c;
          const shut = this.closed.has(q.c);
          html += '<div class="rmm-cat-h" data-c="' + esc(q.c) + '" style="position:sticky;top:0;background:var(--surface);padding:10px 4px 6px;font-weight:600;cursor:pointer;border-bottom:1px solid var(--border)">' +
            (shut ? '▸ ' : '▾ ') + esc(t('rm_cat_' + q.c)) + ' <span style="color:var(--text-dim);font-weight:400">· ' + esc(t('rmm_count', { n: this.counts[q.c] || 0 })) + '</span></div>';
        }
        if (this.closed.has(q.c)) return;
        html += '<div class="rmm-row" data-id="' + esc(q.id) + '" style="display:flex;gap:10px;align-items:baseline;padding:7px 4px;border-bottom:1px solid var(--border);cursor:pointer' + (q.retired ? ';opacity:.5' : '') + '">' +
          '<span style="min-width:3.2em;color:var(--text-dim);font-size:.75rem">' + esc(q.id) + '</span>' +
          '<span style="min-width:4.6em;font-size:.8rem;background:var(--surface2);border-radius:10px;padding:1px 8px;text-align:center">' + esc(t('rmm_level', { n: q.d })) + '</span>' +
          '<span style="flex:1">' + esc(q.text) + '</span>' +
          (q.retired ? '<span style="font-size:.75rem;color:var(--text-dim)">' + esc(t('rmm_hidden')) + '</span>' : '') +
          (q.custom ? '<span style="font-size:.75rem;color:var(--accent, #38a)" title="' + esc(t('rmm_custom_hint')) + '">' + esc(t('rmm_custom')) + '</span>' : q.edited ? '<span style="font-size:.75rem;color:var(--accent, #38a)" title="' + esc(t('rmm_edited_hint')) + '">' + esc(t('rmm_edited')) + '</span>' : '') +
          (q.missing ? '<span style="font-size:.75rem;color:var(--warning, #c80)" title="' + esc(t('rmm_missing_n', { n: q.missing })) + '">⚠ ' + q.missing + '</span>' : '') +
          '</div>';
      });
      if (this.items.length < this.total) html += '<div style="text-align:center;padding:12px"><button class="s-btn rmm-more">' + esc(t('rmm_more')) + '</button></div>';
      box.innerHTML = html;
      box.querySelectorAll('.rmm-cat-h').forEach(h => h.onclick = () => { const c = h.dataset.c; this.closed.has(c) ? this.closed.delete(c) : this.closed.add(c); this.drawList(); });
      box.querySelectorAll('.rmm-row').forEach(r => r.onclick = () => this.editor(r.dataset.id));
      const more = box.querySelector('.rmm-more');
      if (more) more.onclick = () => this.load(false, true);
    }

    async editor(id, opts) {
      opts = opts || {};
      const d = this.meta, isNew = !id;
      let q = null;
      if (id) {
        const r = await fetch(API + '/' + encodeURIComponent(id)).catch(() => null);
        if (!r || !r.ok) { mvmOS.notify && mvmOS.notify(t('rmm_title'), t('rmm_err_generic')); return; }
        q = await r.json();
      } else if (opts.draft) {
        // a draft from the import: the same editor, but it hands the result back instead of saving it
        const dr = opts.draft;
        q = { id: '', c: dr.c || '', d: dr.d || '', k: (dr.k && dr.k.length ? dr.k : d.countries.map(() => '')), s: (dr.s && dr.s.length ? dr.s : d.professions.map(() => '')), retired: false, changeable: !!dr.changeable, dc: dr.dc || {}, texts: dr.texts || {} };
      }
      // a new question starts with the category and level of the filter, or blank: the AI (or you) fills the rest
      const cur = q || { id: '', c: this.f.cat || '', d: +this.f.level || '', k: d.countries.map(() => ''), s: d.professions.map(() => ''), retired: false, dc: {}, texts: {} };
      let lang = d.langs.includes(this.show) ? this.show : 'en';
      const texts = {};
      d.langs.forEach(l => { const x = cur.texts[l]; texts[l] = { q: x ? x.q : '', a: x ? x.a.slice(0, 4) : [] }; while (texts[l].a.length < 4) texts[l].a.push(''); });
      const changed = new Set();
      let alive = true;
      const winId = opts.winId || 'roadtomillion-edit-' + (cur.id || 'new');
      const blankChance = cur.k.concat(cur.s).some(v => v === '' || v == null);
      let closeEdit;
      closeEdit = this.panel({
        id: winId,
        title: '✏️ ' + (isNew ? t('rmm_new_title') : t('rmm_edit_title', { id: cur.id })),
        width: 640, height: 640,
        onClose() { alive = false; },
        onMount: body => {
          body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
          const num = (cls, v) => '<input class="' + cls + '" type="number" min="0" max="100" value="' + esc(v) + '" style="width:64px">';
          body.innerHTML =
            '<div style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px">' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">' +
            '<label style="display:flex;flex-direction:column;gap:3px;font-size:.8rem">' + esc(t('rmm_category')) + '<select class="e-cat">' + (cur.c ? '' : '<option value="">—</option>') + d.cats.map(c => '<option value="' + esc(c) + '"' + (c === cur.c ? ' selected' : '') + '>' + esc(t('rm_cat_' + c)) + '</option>').join('') + '</select></label>' +
            '<label style="display:flex;flex-direction:column;gap:3px;font-size:.8rem">' + esc(t('rmm_difficulty')) + '<input class="e-d" type="number" min="1" max="20" value="' + esc(cur.d) + '" style="width:70px"></label>' +
            '<button type="button" class="s-btn e-ai" style="margin-left:auto" title="' + esc(t('rmm_ai_fill_hint')) + '">✨ ' + esc(t('rmm_ai_fill')) + '</button>' +
            '<label style="display:flex;gap:6px;align-items:center;font-size:.85rem"><input class="e-ret" type="checkbox"' + (cur.retired ? ' checked' : '') + '>' + esc(t('rmm_hide')) + '</label></div>' +
            '<label style="display:flex;gap:6px;align-items:center;font-size:.85rem"><input class="e-changeable" type="checkbox"' + (cur.changeable ? ' checked' : '') + '>' + esc(t('rmm_changeable')) + '</label>' +
            '<div class="e-notes" style="display:none;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:.85rem"></div>' +
            '<div class="e-tabs" style="display:flex;gap:4px;flex-wrap:wrap"></div>' +
            '<div class="e-text" style="display:flex;flex-direction:column;gap:8px"></div>' +
            '<details class="e-dcs"' + (Object.keys(cur.dc || {}).length ? ' open' : '') + '><summary style="cursor:pointer;font-size:.85rem">' + esc(t('rmm_dc')) + '</summary>' +
            '<div style="font-size:.75rem;color:var(--text-dim);margin:6px 0">' + esc(t('rmm_dc_hint')) + '</div><div style="display:flex;flex-wrap:wrap;gap:8px">' +
            d.countries.map(c => '<label style="font-size:.8rem">' + esc(t('rm_cc_' + c)) + '<br><input class="e-dc" data-c="' + esc(c) + '" type="number" min="1" max="20" value="' + esc((cur.dc || {})[c] || '') + '" style="width:64px"></label>').join('') + '</div></details>' +
            '<details class="e-chances"' + (blankChance ? ' open' : '') + '><summary style="cursor:pointer;font-size:.85rem">' + esc(t('rmm_chances')) + '</summary>' +
            '<div style="font-size:.75rem;color:var(--text-dim);margin:6px 0">' + esc(t('rmm_chances_hint')) + '</div>' +
            '<div style="font-weight:600;font-size:.8rem;margin-top:6px">' + esc(t('rmm_countries')) + '</div><div style="display:flex;flex-wrap:wrap;gap:8px">' +
            d.countries.map((c, i) => '<label style="font-size:.8rem">' + esc(t('rm_cc_' + c)) + '<br>' + num('e-k', cur.k[i]) + '</label>').join('') + '</div>' +
            '<div style="font-weight:600;font-size:.8rem;margin-top:8px">' + esc(t('rmm_professions')) + '</div><div style="display:flex;flex-wrap:wrap;gap:8px">' +
            d.professions.map((p, i) => '<label style="font-size:.8rem">' + esc(t('rm_pro_' + p)) + '<br>' + num('e-s', cur.s[i]) + '</label>').join('') + '</div></details>' +
            '<div class="e-err" style="color:var(--danger, #d33);font-size:.85rem;min-height:1.2em"></div></div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--border)">' +
            '<button class="s-btn e-cancel" style="background:var(--surface2);color:var(--text)">' + esc(t('rmm_cancel')) + '</button>' +
            '<button class="s-btn e-save">' + esc(t(opts.onApply ? 'rmm_imp_apply' : 'rmm_save')) + '</button></div>';
          const $ = s => body.querySelector(s);
          const keep = () => {
            const box = $('.e-text');
            if (!box.children.length) return;
            texts[lang].q = box.querySelector('.t-q').value;
            texts[lang].a = Array.from(box.querySelectorAll('.t-a')).map(i => i.value);
          };
          const paint = () => {
            $('.e-tabs').innerHTML = d.langs.map(l => {
              const filled = texts[l].q.trim() || texts[l].a.some(x => x.trim());
              return '<button type="button" class="s-btn e-tab" data-l="' + esc(l) + '" style="padding:3px 10px;font-size:.8rem;' + (l === lang ? '' : 'background:var(--surface2);color:var(--text)') + '">' + esc(NAMES[l]) + (filled ? '' : ' ○') + (changed.has(l) ? ' ✦' : '') + '</button>';
            }).join('');
            const x = texts[lang];
            $('.e-text').innerHTML =
              '<label style="font-size:.8rem">' + esc(t('rmm_question')) + '<textarea class="t-q" rows="3" style="width:100%;resize:vertical">' + esc(x.q) + '</textarea></label>' +
              x.a.map((v, i) => '<label style="font-size:.8rem">' + esc(i === 0 ? '✓ ' + t('rmm_correct') : t('rmm_wrong', { n: i })) + '<input class="t-a" type="text" value="' + esc(v) + '" style="width:100%"></label>').join('');
            body.querySelectorAll('.e-tab').forEach(b => b.onclick = () => { keep(); lang = b.dataset.l; paint(); });
          };
          paint();
          $('.e-ai').onclick = async ev => {
            keep();
            const aib = ev.currentTarget, notes = $('.e-notes'), err = $('.e-err');
            const dcs = () => Object.fromEntries(Array.from(body.querySelectorAll('.e-dc')).filter(i => i.value !== '').map(i => [i.dataset.c, Math.max(1, Math.min(20, parseInt(i.value, 10) || 1))]));
            const vals = cls => { const v = Array.from(body.querySelectorAll(cls)).map(i => i.value === '' ? null : Math.max(0, Math.min(100, parseInt(i.value, 10) || 0))); return v.includes(null) ? null : v; };
            const AI = await this.ai();
            aib.disabled = true; err.textContent = '';
            notes.style.display = ''; notes.textContent = t('rmm_ai_working');
            try {
              const r = await AI.job('/ai/fill', {
                lang: AI.uiLang(d.langs),
                question: { changeable: $('.e-changeable').checked, c: $('.e-cat').value, d: parseInt($('.e-d').value, 10) || 0, k: vals('.e-k'), s: vals('.e-s'), dc: dcs(), texts: Object.fromEntries(d.langs.map(l => [l, { q: texts[l].q, a: texts[l].a }])) },
              }, p => { notes.textContent = t('rmm_ai_working') + (p ? ' ' + p : ''); }, () => alive && body.isConnected);
              if (!r) return;
              const n = (r.notes || []).map(x => '<div>• ' + esc(x) + '</div>').join('');
              if (r.verdict === 'reject') {
                notes.innerHTML = '<div style="color:var(--danger, #d33);font-weight:600">' + esc(t('rmm_ai_rejected')) + '</div>' + n;
              } else {
                const qn = r.question;
                $('.e-changeable').checked = !!qn.changeable;
                if (qn.c) $('.e-cat').value = qn.c;
                if (qn.d) $('.e-d').value = qn.d;
                if (qn.k) body.querySelectorAll('.e-k').forEach((i, j) => { i.value = qn.k[j]; });
                body.querySelectorAll('.e-dc').forEach(i => { i.value = (qn.dc || {})[i.dataset.c] || ''; });
                if (Object.keys(qn.dc || {}).length) $('.e-dcs').open = true;
                if (qn.s) body.querySelectorAll('.e-s').forEach((i, j) => { i.value = qn.s[j]; });
                changed.clear();
                d.langs.forEach(l => {
                  const x = qn.texts[l];
                  if (!x) return;
                  if (x.q !== texts[l].q || x.a.join('\u0001') !== texts[l].a.join('\u0001')) changed.add(l);
                  texts[l] = { q: x.q, a: x.a.slice(0, 4) };
                });
                lang = d.langs.includes(lang) ? lang : 'en';
                paint();
                notes.innerHTML = '<div style="font-weight:600">' + esc(t(r.verdict === 'ok' ? 'rmm_ai_ok' : 'rmm_ai_fixed')) + (changed.size ? ' · ' + esc(t('rmm_ai_changed_tabs')) : '') + '</div>' + n;
              }
            } catch (e) { notes.style.display = 'none'; err.textContent = AI.errText(e); }
            aib.disabled = false;
          };
          $('.e-cancel').onclick = () => closeEdit();
          $('.e-save').onclick = async () => {
            keep();
            const nums = cls => Array.from(body.querySelectorAll(cls)).map(i => i.value === '' ? 90 : Math.max(0, Math.min(100, parseInt(i.value, 10) || 0)));
            const err = $('.e-err');
            err.textContent = '';
            if (!$('.e-cat').value || !(parseInt($('.e-d').value, 10) >= 1)) { err.textContent = t('rmm_err_need_cat'); return; }
            const payload = {
              c: $('.e-cat').value, d: parseInt($('.e-d').value, 10), changeable: $('.e-changeable').checked, retired: $('.e-ret').checked,
              k: nums('.e-k'), s: nums('.e-s'),
              dc: Object.fromEntries(Array.from(body.querySelectorAll('.e-dc')).filter(i => i.value !== '').map(i => [i.dataset.c, Math.max(1, Math.min(20, parseInt(i.value, 10) || 1))])),
              texts: Object.fromEntries(d.langs.map(l => [l, { q: texts[l].q, a: texts[l].a }])),
            };
            if (opts.onApply) {
              if (!payload.texts.en || !payload.texts.en.q.trim()) { err.textContent = t('rmm_err_en'); return; }
              opts.onApply(payload);
              closeEdit();
              return;
            }
            let res;
            try { res = await fetch(isNew ? API : API + '/' + encodeURIComponent(cur.id), { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
            catch (_) { err.textContent = t('rmm_err_generic'); return; }
            if (!res.ok) {
              const det = await res.json().then(j => String(j.detail || '')).catch(() => '');
              const code = det.split(':')[0], l = det.split(':')[1];
              err.textContent = (code === 'english_required' ? t('rmm_err_en')
                : code === 'bad_text' ? t('rmm_err_text', { lang: NAMES[l] || l || '' })
                : code === 'too_long' ? t('rmm_err_long', { lang: NAMES[l] || l || '' })
                : t('rmm_err_generic'));
              return;
            }
            mvmOS.notify && mvmOS.notify(t('rmm_title'), t('rmm_saved'));
            closeEdit();
            await this.load(false);
          };
        },
      });
    }
  }

  window.RoadToMillionManager = { mount };
})();
