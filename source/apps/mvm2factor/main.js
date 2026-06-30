// mvmOS App: mvm2factor v1.0.0
const _2fa18n = {
  en: {
    title: 'mvm2factor',
    accounts: 'Accounts',
    addAccount: 'Add Account',
    accountName: 'Account name (e.g. GitHub)',
    issuer: 'Username / email (optional)',
    secretKey: 'Secret key (Base32)',
    save: 'Save',
    cancel: 'Cancel',
    copied: '✓ Copied',
    copy: 'Copy',
    noAccounts: 'No accounts yet. Click + to add your first.',
    invalidSecret: 'Invalid secret key. Use Base32 characters (A–Z, 2–7).',
    nameRequired: 'Account name is required.',
    secretRequired: 'Secret key is required.',
    seconds: 's',
    errorSaving: 'Error saving account.',
    sortNewest: 'Newest first',
    sortLastUsed: 'Last used first',
  },
  bg: {
    title: 'mvm2factor',
    accounts: 'Акаунти',
    addAccount: 'Добави акаунт',
    accountName: 'Название (напр. GitHub)',
    issuer: 'Потребител / имейл (незадължително)',
    secretKey: 'Таен ключ (Base32)',
    save: 'Запази',
    cancel: 'Отказ',
    copied: '✓ Копирано',
    copy: 'Копирай',
    noAccounts: 'Няма акаунти. Натисни + за да добавиш.',
    invalidSecret: 'Невалиден таен ключ. Използвай Base32 знаци (A–Z, 2–7).',
    nameRequired: 'Името е задължително.',
    secretRequired: 'Тайният ключ е задължителен.',
    seconds: 'с',
    errorSaving: 'Грешка при записване.',
    sortNewest: 'Най-нови първо',
    sortLastUsed: 'Последно използвани първо',
  }
};
function _2fat(k) { const l = window.mvmOS?.lang || 'en'; return (_2fa18n[l] || _2fa18n.en)[k] || k; }

// ── TOTP ──────────────────────────────────────────────────────────────────────
function _2fa_b32(input) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const i = alpha.indexOf(c);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function _2fa_totp(secret) {
  const key = _2fa_b32(secret);
  if (!key.length) throw new Error('empty key');
  const step = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, step >>> 0, false);
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, buf));
  const off = sig[19] & 0xf;
  const n = ((sig[off] & 0x7f) << 24) | ((sig[off+1] & 0xff) << 16) | ((sig[off+2] & 0xff) << 8) | (sig[off+3] & 0xff);
  return String(n % 1_000_000).padStart(6, '0');
}

function _2fa_color(name) {
  const pal = ['#89b4fa','#a6e3a1','#fab387','#f38ba8','#cba6f7','#94e2d5','#f9e2af','#74c7ec'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return pal[Math.abs(h) % pal.length];
}

// ── App ────────────────────────────────────────────────────────────────────────
mvmOS.registerApp({
  id: 'mvm2factor',
  name: _2fat('title'),
  icon: '🔐',
  category: 'Utilities',

  launch() {
    mvmOS.createWindow({
      id: 'mvm2factor',
      title: '🔐 mvm2factor',
      width: 370,
      height: 520,

      async onMount(body) {
        body.style.cssText = 'padding:0;overflow:hidden;';

        const CIRC = 2 * Math.PI * 18;
        let accounts = [], codes = {}, lastStep = -1, raf = null, destroyed = false, sortBy = 'newest';

        body.innerHTML = `
          <style>
            #tfa-root * { box-sizing:border-box; }
            .tfa-card { background:#313244;border-radius:10px;padding:13px 14px 11px;margin-bottom:8px;position:relative;transition:box-shadow .15s; }
            .tfa-card:hover { box-shadow:0 0 0 1px #45475a; }
            .tfa-code { font-size:1.75rem;font-weight:700;letter-spacing:.14em;font-family:monospace;cursor:pointer;user-select:all;line-height:1;transition:color .3s; }
            .tfa-code.refreshed { animation:tfa-pop .35s ease; }
            @keyframes tfa-pop { 0%{transform:scale(.96);opacity:.5} 60%{transform:scale(1.03)} 100%{transform:scale(1);opacity:1} }
            .tfa-copy { background:#45475a;color:#cdd6f4;border:none;border-radius:5px;padding:4px 11px;font-size:.78rem;cursor:pointer;transition:background .15s,color .15s; }
            .tfa-copy:hover { background:#585b70; }
            .tfa-copy.ok { background:#a6e3a1;color:#1e1e2e; }
            .tfa-del { position:absolute;top:9px;right:10px;background:none;border:none;color:#585b70;cursor:pointer;font-size:.85rem;padding:3px 5px;border-radius:4px;transition:color .15s,background .15s;line-height:1; }
            .tfa-del:hover { color:#f38ba8;background:rgba(243,139,168,.12); }
            .tfa-input { width:100%;background:#1e1e2e;border:1.5px solid #45475a;color:#cdd6f4;border-radius:7px;padding:9px 11px;font-size:.9rem;outline:none;font-family:inherit;transition:border-color .15s; }
            .tfa-input:focus { border-color:#89b4fa; }
            .tfa-input.mono { font-family:monospace;letter-spacing:.07em; }
            .tfa-btn { border:none;border-radius:7px;padding:9px;cursor:pointer;font-size:.9rem;font-weight:600;transition:opacity .15s; }
            .tfa-btn:hover { opacity:.85; }
            #tfa-list::-webkit-scrollbar { width:4px; }
            #tfa-list::-webkit-scrollbar-thumb { background:#45475a;border-radius:2px; }
          </style>
          <div id="tfa-root" style="display:flex;flex-direction:column;height:100%;background:#1e1e2e;color:#cdd6f4;font-family:system-ui,sans-serif;overflow:hidden">

            <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px 8px">
              <span style="font-size:.78rem;font-weight:700;color:#6c7086;text-transform:uppercase;letter-spacing:.09em;flex-shrink:0">${_2fat('accounts')}</span>
              <select id="tfa-sort"
                style="flex:1;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;
                       padding:4px 8px;font-size:.8rem;outline:none;cursor:pointer;min-width:0">
                <option value="newest">${_2fat('sortNewest')}</option>
                <option value="last_used">${_2fat('sortLastUsed')}</option>
              </select>
              <button id="tfa-add-btn" title="${_2fat('addAccount')}"
                style="background:#89b4fa;color:#1e1e2e;border:none;border-radius:50%;width:26px;height:26px;
                       cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">+</button>
            </div>

            <div id="tfa-list" style="flex:1;overflow-y:auto;padding:0 14px 14px;scrollbar-width:thin;scrollbar-color:#45475a transparent"></div>

            <div id="tfa-modal" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,.65);z-index:100;align-items:center;justify-content:center">
              <div style="background:#313244;border-radius:12px;padding:22px;width:315px;max-width:93%;box-shadow:0 12px 40px rgba(0,0,0,.55)">
                <div style="font-size:1rem;font-weight:700;margin-bottom:16px">${_2fat('addAccount')}</div>
                <input id="tfa-inp-name"   class="tfa-input"      placeholder="${_2fat('accountName')}"  style="margin-bottom:9px">
                <input id="tfa-inp-issuer" class="tfa-input"      placeholder="${_2fat('issuer')}"       style="margin-bottom:9px">
                <input id="tfa-inp-secret" class="tfa-input mono" placeholder="${_2fat('secretKey')}"    style="margin-bottom:5px">
                <div id="tfa-err" style="color:#f38ba8;font-size:.8rem;min-height:20px;margin-bottom:10px"></div>
                <div style="display:flex;gap:8px">
                  <button id="tfa-cancel" class="tfa-btn" style="flex:1;background:#45475a;color:#cdd6f4">${_2fat('cancel')}</button>
                  <button id="tfa-save"   class="tfa-btn" style="flex:1;background:#89b4fa;color:#1e1e2e">${_2fat('save')}</button>
                </div>
              </div>
            </div>
          </div>`;

        const $list    = body.querySelector('#tfa-list');
        const $sort    = body.querySelector('#tfa-sort');
        const $modal   = body.querySelector('#tfa-modal');
        const $inpName   = body.querySelector('#tfa-inp-name');
        const $inpIssuer = body.querySelector('#tfa-inp-issuer');
        const $inpSecret = body.querySelector('#tfa-inp-secret');
        const $err     = body.querySelector('#tfa-err');

        function arcSVG(id) {
          return `<svg width="44" height="44" viewBox="0 0 44 44" style="flex-shrink:0;display:block">
            <circle cx="22" cy="22" r="18" fill="none" stroke="#2a2a3d" stroke-width="3.5"/>
            <circle id="tfa-arc-${id}" cx="22" cy="22" r="18" fill="none"
              stroke="#89b4fa" stroke-width="3.5"
              stroke-dasharray="${CIRC.toFixed(3)}" stroke-dashoffset="0"
              stroke-linecap="round" transform="rotate(-90 22 22)"/>
          </svg>`;
        }

        function sortedAccounts() {
          const arr = [...accounts];
          if (sortBy === 'last_used') {
            arr.sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
          } else {
            arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          }
          return arr;
        }

        function renderCards() {
          const list = sortedAccounts();
          if (!list.length) {
            $list.innerHTML = `<div style="text-align:center;color:#6c7086;font-size:.88rem;padding:44px 20px;line-height:1.6">${_2fat('noAccounts')}</div>`;
            return;
          }
          $list.innerHTML = list.map(a => {
            const col  = _2fa_color(a.name);
            const init = (a.name.trim()[0] || '?').toUpperCase();
            const raw  = codes[a.id] || '------';
            const fmt  = raw === 'ERROR' ? '⚠ ERR' : raw.slice(0,3) + ' ' + raw.slice(3);
            return `
              <div class="tfa-card" data-aid="${a.id}">
                <button class="tfa-del" data-del="${a.id}">✕</button>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:11px;padding-right:24px">
                  <div style="width:36px;height:36px;border-radius:8px;border:1.5px solid ${col};background:${col}1a;
                              display:flex;align-items:center;justify-content:center;
                              font-weight:800;font-size:1rem;color:${col};flex-shrink:0">${init}</div>
                  <div style="min-width:0">
                    <div style="font-weight:600;font-size:.93rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div>
                    ${a.issuer ? `<div style="font-size:.75rem;color:#6c7086;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">${a.issuer}</div>` : ''}
                  </div>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                  <div>
                    <div id="tfa-code-${a.id}" class="tfa-code" style="color:${col}">${fmt}</div>
                    <button class="tfa-copy" data-copy="${a.id}" style="margin-top:7px">${_2fat('copy')}</button>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
                    ${arcSVG(a.id)}
                    <span id="tfa-s-${a.id}" style="font-size:.7rem;color:#6c7086;font-variant-numeric:tabular-nums;font-weight:600">30${_2fat('seconds')}</span>
                  </div>
                </div>
              </div>`;
          }).join('');
        }

        async function refreshCodes() {
          await Promise.all(accounts.map(async a => {
            try   { codes[a.id] = await _2fa_totp(a.secret); }
            catch { codes[a.id] = 'ERROR'; }
          }));
          accounts.forEach(a => {
            const el = $list.querySelector(`#tfa-code-${a.id}`);
            if (!el) return;
            const raw = codes[a.id] || '------';
            el.textContent = raw === 'ERROR' ? '⚠ ERR' : raw.slice(0,3) + ' ' + raw.slice(3);
            el.classList.remove('refreshed');
            void el.offsetWidth;
            el.classList.add('refreshed');
          });
        }

        function tick() {
          if (destroyed) return;
          const now      = Date.now();
          const step     = Math.floor(now / 1000 / 30);
          const msElapsed = now % 30000;
          const msLeft   = 30000 - msElapsed;
          const secsLeft = Math.ceil(msLeft / 1000);
          const pctLeft  = msLeft / 30000;
          const pctGone  = 1 - pctLeft;
          const color    = secsLeft <= 5 ? '#f38ba8' : secsLeft <= 10 ? '#fab387' : '#89b4fa';
          const offset = (CIRC * pctGone).toFixed(3);
          accounts.forEach(a => {
            const arc = $list.querySelector(`#tfa-arc-${a.id}`);
            const sl  = $list.querySelector(`#tfa-s-${a.id}`);
            if (arc) { arc.setAttribute('stroke-dashoffset', offset); arc.setAttribute('stroke', color); }
            if (sl)  { sl.textContent = secsLeft + _2fat('seconds'); sl.style.color = color; }
          });

          if (step !== lastStep) { lastStep = step; refreshCodes(); }
          raf = requestAnimationFrame(tick);
        }

        async function loadAccounts() {
          try {
            const [ra, rp] = await Promise.all([
              fetch('/api/apps/mvm2factor/accounts'),
              fetch('/api/apps/mvm2factor/prefs'),
            ]);
            accounts = ra.ok ? await ra.json() : [];
            if (rp.ok) { const p = await rp.json(); sortBy = p.sort_by || 'newest'; }
          } catch { accounts = []; }
          $sort.value = sortBy;
          renderCards();
          await refreshCodes();
          if (!raf) raf = requestAnimationFrame(tick);
        }

        function openModal()  {
          $inpName.value = ''; $inpIssuer.value = ''; $inpSecret.value = ''; $err.textContent = '';
          $modal.style.display = 'flex';
          setTimeout(() => $inpName.focus(), 50);
        }
        function closeModal() { $modal.style.display = 'none'; }

        $sort.onchange = async () => {
          sortBy = $sort.value;
          await fetch('/api/apps/mvm2factor/prefs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_by: sortBy }),
          });
          renderCards();
          await refreshCodes();
        };

        body.querySelector('#tfa-add-btn').onclick = openModal;
        body.querySelector('#tfa-cancel').onclick  = closeModal;
        $modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); });

        body.querySelector('#tfa-save').onclick = async () => {
          $err.textContent = '';
          const name   = $inpName.value.trim();
          const issuer = $inpIssuer.value.trim();
          const secret = $inpSecret.value.trim().toUpperCase().replace(/[\s=]/g, '');
          if (!name)   { $err.textContent = _2fat('nameRequired');   return; }
          if (!secret) { $err.textContent = _2fat('secretRequired'); return; }
          if (!/^[A-Z2-7]+$/.test(secret)) { $err.textContent = _2fat('invalidSecret'); return; }
          try { await _2fa_totp(secret); } catch { $err.textContent = _2fat('invalidSecret'); return; }

          const $btn = body.querySelector('#tfa-save');
          $btn.disabled = true;
          try {
            const r = await fetch('/api/apps/mvm2factor/accounts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, issuer, secret }),
            });
            if (!r.ok) { $err.textContent = _2fat('errorSaving'); return; }
            closeModal();
            await loadAccounts();
          } finally { $btn.disabled = false; }
        };

        [$inpName, $inpIssuer, $inpSecret].forEach(inp =>
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') body.querySelector('#tfa-save').click(); })
        );

        $list.addEventListener('click', async e => {
          const copyBtn = e.target.closest('[data-copy]');
          if (copyBtn) {
            const id   = copyBtn.dataset.copy;
            const code = codes[id];
            if (code && code !== 'ERROR') {
              await navigator.clipboard.writeText(code).catch(() => {});
              copyBtn.textContent = _2fat('copied');
              copyBtn.classList.add('ok');
              setTimeout(() => { copyBtn.textContent = _2fat('copy'); copyBtn.classList.remove('ok'); }, 1600);
              fetch(`/api/apps/mvm2factor/accounts/${id}/use`, { method: 'POST' });
              const acc = accounts.find(a => a.id === id);
              if (acc) acc.last_used = Math.floor(Date.now() / 1000);
            }
            return;
          }
          if (e.target.closest('.tfa-code')) {
            const id = e.target.closest('[data-aid]')?.dataset.aid;
            if (id && codes[id] && codes[id] !== 'ERROR') {
              await navigator.clipboard.writeText(codes[id]).catch(() => {});
              fetch(`/api/apps/mvm2factor/accounts/${id}/use`, { method: 'POST' });
              const acc = accounts.find(a => a.id === id);
              if (acc) acc.last_used = Math.floor(Date.now() / 1000);
            }
            return;
          }
          const delBtn = e.target.closest('[data-del]');
          if (delBtn) {
            const acc = accounts.find(a => a.id === delBtn.dataset.del);
            if (acc && confirm(`Delete "${acc.name}"?`)) {
              await fetch(`/api/apps/mvm2factor/accounts/${acc.id}`, { method: 'DELETE' });
              await loadAccounts();
            }
          }
        });

        new MutationObserver((_, obs) => {
          if (!document.contains(body)) { destroyed = true; if (raf) cancelAnimationFrame(raf); obs.disconnect(); }
        }).observe(document.body, { childList: true, subtree: true });

        await loadAccounts();
      }
    });
  }
});
