(function () {
  const key = location.hash.replace(/^#key=/, '');
  const app = document.getElementById('app');
  let path = '';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const error = message => { app.innerHTML = `<div class="error"><b>Folder cannot be opened</b><br>${esc(message)}</div>`; };
  if (!key) { error('Missing folder key. Use the complete link, including the part after #key=.'); return; }
  async function api(url) {
    const response = await fetch('/pub/mvmcloud/api/' + url, {headers: {Authorization: 'Bearer ' + key}});
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || 'Folder access failed');
    }
    return response.json();
  }
  async function download(filePath, name) {
    const response = await fetch('/pub/mvmcloud/api/download?path=' + encodeURIComponent(filePath), {headers: {Authorization: 'Bearer ' + key}});
    if (!response.ok) throw new Error('Download failed');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob()); link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function load() {
    try {
      const data = await api('list?path=' + encodeURIComponent(path));
      const up = path ? '<div class="row" data-up><span>↩</span><span class="name">..</span></div>' : '';
      const rows = data.entries.length ? data.entries.map(entry => `<div class="row" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}"><span>${entry.type === 'folder' ? '📁' : '📄'}</span><span class="name">${esc(entry.name)}</span><small class="muted">${entry.type === 'file' ? entry.size + ' B' : 'folder'}</small></div>`).join('') : '<div class="empty">This folder is empty.</div>';
      app.innerHTML = `<div class="bar"><b>☁️ Shared mvmCloud folder</b><span class="muted">Restricted access</span></div><div class="path">/${esc(path)}</div>${up}${rows}`;
      const upButton = app.querySelector('[data-up]');
      if (upButton) upButton.onclick = () => { path = path.split('/').slice(0, -1).join('/'); load(); };
      app.querySelectorAll('[data-name]').forEach(row => row.onclick = () => {
        const next = path ? path + '/' + row.dataset.name : row.dataset.name;
        if (row.dataset.type === 'folder') { path = next; load(); }
        else download(next, row.dataset.name).catch(e => error(e.message));
      });
    } catch (e) { error(e.message); }
  }
  load();
})();
