// Git Manager — SSH key management
/* global window */
var GM = window.GM;

GM.ssh = (function() {

  function show(container) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
        <div style="font-weight:600;font-size:.9rem">SSH Keys</div>
        <button id="gm-ssh-gen" class="s-btn s-btn-sm">＋ Generate new key</button>
      </div>
      <div id="gm-ssh-content" style="flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:14px"></div>
    `;
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    container.querySelector('#gm-ssh-gen').addEventListener('click', () => _showGenerate(container));
    _loadKeys(container);
  }

  async function _loadKeys(container) {
    const c = container.querySelector('#gm-ssh-content');
    c.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">Loading...</div>`;
    try {
      const keys = await GM.api('/ssh');
      c.innerHTML = '';

      if (!keys.length) {
        c.innerHTML = `
          <div style="color:var(--text-dim);font-size:.85rem;text-align:center;padding:24px 0;opacity:.7">
            No SSH keys found.<br>Generate one to connect to GitHub, GitLab and others.
          </div>
        `;
        return;
      }

      keys.forEach(function(key) {
        const parts = key.public_key.split(' ');
        const comment = parts[2] || '';
        const keyShort = parts[1] ? parts[1].substring(0, 24) + '...' : '';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--surface2,#313244);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px';
        card.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:1.1rem">🔑</span>
            <div style="flex:1">
              <div style="font-weight:600;font-size:.85rem">${key.type}</div>
              ${comment ? `<div style="font-size:.75rem;color:var(--text-dim)">${comment}</div>` : ''}
            </div>
            <span style="font-size:.7rem;background:#a6e3a1;color:#1e1e2e;border-radius:10px;padding:2px 8px;font-weight:600">Active</span>
          </div>
          <div style="font-family:monospace;font-size:.72rem;color:var(--text-dim);background:var(--surface);border-radius:5px;padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${key.public_key}">
            ${key.public_key.substring(0, key.type.length + 1 + 48)}...
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="s-btn s-btn-sm gm-copy-key" data-key="${encodeURIComponent(key.public_key)}">📋 Copy public key</button>
            <button class="s-btn s-btn-sm gm-test-gh" data-key="${encodeURIComponent(key.public_key)}">Test GitHub</button>
            <button class="s-btn s-btn-sm gm-test-gl">Test GitLab</button>
            <button class="s-btn s-btn-sm gm-test-custom">Test other...</button>
          </div>
          <div class="gm-test-result" style="display:none;font-size:.78rem;padding:6px 10px;border-radius:5px;font-family:monospace"></div>
        `;

        card.querySelector('.gm-copy-key').addEventListener('click', function() {
          navigator.clipboard.writeText(key.public_key).then(function() {
            this.textContent = '✓ Copied!';
            setTimeout(() => { this.textContent = '📋 Copy public key'; }, 2000);
          }.bind(this));
        });

        card.querySelector('.gm-test-gh').addEventListener('click', function() {
          _testSSH(card, 'github.com');
        });
        card.querySelector('.gm-test-gl').addEventListener('click', function() {
          _testSSH(card, 'gitlab.com');
        });
        card.querySelector('.gm-test-custom').addEventListener('click', function() {
          const host = prompt('Enter hostname (e.g. git.myserver.com):');
          if (host) _testSSH(card, host.trim());
        });

        c.appendChild(card);
      });

      // Add note about adding key to GitHub/GitLab
      const note = document.createElement('div');
      note.style.cssText = 'font-size:.78rem;color:var(--text-dim);padding:4px 0;opacity:.8';
      note.innerHTML = `<strong>Tip:</strong> Copy your public key and add it to <a href="#" style="color:var(--accent)" onclick="return false">GitHub → Settings → SSH Keys</a> or GitLab → Preferences → SSH Keys.`;
      c.appendChild(note);

    } catch(e) {
      c.innerHTML = `<div style="color:#f38ba8;font-size:.82rem">${e.message}</div>`;
    }
  }

  async function _testSSH(card, host) {
    const result = card.querySelector('.gm-test-result');
    result.style.display = 'block';
    result.style.background = 'var(--surface)';
    result.style.color = 'var(--text-dim)';
    result.textContent = `Testing git@${host}...`;
    try {
      const r = await GM.api('/ssh/test', { method: 'POST', json: { host } });
      result.textContent = r.output || (r.ok ? 'Connection successful' : 'Connection failed');
      result.style.color = r.ok ? '#a6e3a1' : '#f38ba8';
      result.style.background = r.ok ? 'rgba(166,227,161,.1)' : 'rgba(243,139,168,.1)';
    } catch(e) {
      result.textContent = e.message;
      result.style.color = '#f38ba8';
    }
  }

  function _showGenerate(container) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:360px;display:flex;flex-direction:column;gap:12px">
        <div style="font-weight:600;font-size:.95rem">Generate SSH Key</div>
        <div>
          <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">Comment (optional)</div>
          <input class="s-input" id="gm-gen-comment" placeholder="e.g. your@email.com" style="width:100%;box-sizing:border-box">
        </div>
        <div style="font-size:.78rem;color:var(--text-dim);background:var(--surface2,#313244);border-radius:6px;padding:8px 10px">
          Will generate <strong>ed25519</strong> key in <code>~/.ssh/id_ed25519</code>
        </div>
        <div id="gm-gen-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="s-btn" id="gm-gen-cancel">Cancel</button>
          <button class="s-btn" id="gm-gen-ok" style="background:var(--accent);color:#fff;border-color:var(--accent)">Generate</button>
        </div>
      </div>
    `;
    container.style.position = 'relative';
    container.appendChild(overlay);
    overlay.querySelector('#gm-gen-comment').focus();
    overlay.querySelector('#gm-gen-cancel').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#gm-gen-ok').addEventListener('click', async function() {
      const comment = overlay.querySelector('#gm-gen-comment').value.trim();
      const errEl = overlay.querySelector('#gm-gen-err');
      const btn = overlay.querySelector('#gm-gen-ok');
      btn.textContent = 'Generating...'; btn.disabled = true;
      try {
        const r = await GM.api('/ssh/generate', { method: 'POST', json: { comment } });
        overlay.remove();
        _loadKeys(container);
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
        btn.textContent = 'Generate'; btn.disabled = false;
      }
    });
  }

  return { show };
})();
