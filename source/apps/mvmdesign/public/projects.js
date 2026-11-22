(function () {
  'use strict';
  const M = () => window.MvmDesignModel;
  const t = (k) =>
    (window.MvmDesignI18n[window.mvmOS?.lang || 'en'] ||
      window.MvmDesignI18n.en)[k] ||
    window.MvmDesignI18n.en[k] ||
    k;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  class Projects {
    constructor(editor, options) {
      this.e = editor;
      this.public = !!options.public;
      this.token = options.token;
      this.user = options.user;
      this.current = null;
      this.onFocus = () => this.checkAccess();
      window.addEventListener('focus', this.onFocus);
    }
    async request(path, options = {}) {
      if (this.public && localStorage.getItem('apphub_token') !== this.token)
        throw Error('loginRequired');
      const response = await fetch(
        (this.public ? '/pub/mvmdesign' : '/api/apps/mvmdesign') + path,
        {
          ...options,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-MvmDesign': '1',
            ...(this.public ? { 'X-Pub-Token': this.token } : {}),
            ...options.headers,
          },
        },
      );
      const result = await response.json();
      if (!response.ok) {
        const error = Error(result.detail || result.error || 'failed');
        error.status = response.status;
        throw error;
      }
      return result;
    }
    detach() {
      clearInterval(this.accessTimer);
      this.current = null;
    }
    destroy() {
      this.detach();
      window.removeEventListener('focus', this.onFocus);
    }
    controls() {
      const e = this.e,
        save = e.root.querySelector('[data-action=save]');
      if (!save) return;
      const copy = this.public && this.current?.role !== 'editor';
      const label = copy
        ? 'downloadProject'
        : this.current
          ? 'saveSharedProject'
          : this.e.source ? 'save' : 'saveServerProject';
      save.title = save.ariaLabel = t(label);
      const share = e.root.querySelector('[data-action=share-project]');
      if (share) share.hidden = this.public;
      let badge = e.root.querySelector('.md-project-access');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'md-project-access';
        e.root.querySelector('.md-state').after(badge);
      }
      badge.textContent = this.current
        ? t(
            this.current.role === 'owner'
              ? 'serverProject'
              : this.current.role === 'editor'
                ? 'editorAccess'
                : 'viewerAccess',
          )
        : this.public
          ? t('localProject')
          : this.e.source || t('notSavedToServer');
      badge.title = this.current ? t('serverSaveHint') : (this.e.source || t('localRecentHint'));
      e.root.querySelector('.md-state').title = badge.title;
    }
    async open(id) {
      if (!this.e.leave()) return false;
      return this.e.projectOperation('openingProject', async () => {
        const data = await this.request('/projects/' + encodeURIComponent(id));
        if (this.e.dead) return false;
        await this.e.installProject(M().normalize(data.project));
        this.current = { id: data.id, revision: data.revision, role: data.role };
        this.e.source = null;
        this.e.localRecentId = null;
        this.e.renderState();
        this.e.root.querySelector('.md-project-dialog [data-cancel]')?.click();
        if (this.public)
          this.accessTimer = setInterval(() => this.checkAccess(), 10000);
        return true;
      });
    }
    async checkAccess() {
      if (!this.public || !this.current || this.checking || this.e.dead) return;
      this.checking = true;
      const current = this.current;
      try {
        const data = await this.request(
          '/projects/' + encodeURIComponent(current.id) + '/status',
        );
        if (this.current !== current) return;
        if (data.role !== current.role) {
          current.role = data.role;
          this.e.renderState();
          this.e.toast(
            t(data.role === 'editor' ? 'editorAccess' : 'viewerAccess'),
          );
        }
      } catch (error) {
        if (
          this.current === current &&
          ([401, 403, 404].includes(error.status) ||
            error.message === 'loginRequired')
        )
          await this.invalidate();
      } finally {
        this.checking = false;
      }
    }
    async invalidate() {
      this.e.abort?.abort();
      this.e.root.querySelectorAll('.md-modal').forEach((el) => {
        el.cleanup?.();
        el.remove();
      });
      this.e.stylePreviewCache.clear();
      await this.e.installProject(M().project());
      this.e.source = null;
      this.e.localRecentId = null;
      this.e.toast(t('projectUnavailable'));
      await this.e.projectDialog();
    }
    async askName(initial, title = 'saveServerProject', hint = 'serverSaveHint', button = 'save') {
      return new Promise((resolve) => {
        let value = null;
        const box = this.e.modal(
          title,
          `<p class="md-note">${esc(t(hint))}</p><label class="md-field"><span>${esc(t('projectName'))}</span><input data-server-name maxlength="200" required value="${esc(initial ?? (this.e.p.name || t('untitled')))}"></label>`,
          () => {
            const input = box.querySelector('[data-server-name]');
            if (!input.value.trim()) {
              input.value = '';
              input.reportValidity();
              return false;
            }
            value = input.value.trim();
          },
          button,
        );
        box.cleanup = () => resolve(value);
        const input = box.querySelector('[data-server-name]');
        input.select();
        input.onkeydown = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            box.querySelector('[data-apply]').click();
          }
        };
      });
    }
    async save(as = false) {
      if (this.public && (as || this.current?.role !== 'editor')) {
        await this.e.action('download');
        return true;
      }
      if (this.saving) return false;
      this.saving = true;
      try {
        this.e.finishPropertyEdit();
        const current = this.current;
        const project = this.e.p;
        const name = as || !current ? await this.askName() : project.name;
        if (name === null) return false;
        if (this.e.p !== project || this.e.dead) return false;
        return await this.e.projectOperation('savingProject', async () => {
          const p = { ...project, name };
          const snapshot = JSON.stringify(project);
          const result = await this.request(
            '/projects' +
              (!as && current ? '/' + encodeURIComponent(current.id) : ''),
            {
              method: !as && current ? 'PUT' : 'POST',
              body: JSON.stringify({
                project: p,
                revision: !as ? current?.revision : undefined,
              }),
            },
          );
          if (this.e.p !== project || this.e.dead) return false;
          this.current = {
            id: result.id,
            revision: result.revision,
            role: result.role,
          };
          this.e.source = null;
          if (JSON.stringify(project) === snapshot) {
            project.name = name;
            this.e.dirty = false;
          }
          this.e.renderState();
          this.e.toast(t('projectSavedOnServer'));
          return true;
        });
      } catch (error) {
        if (this.public && [401, 403, 404].includes(error.status))
          await this.checkAccess();
        throw error;
      } finally {
        this.saving = false;
      }
    }
    async start(box) {
      const e = this.e;
      if (!this.public && (!e.source || this.current)) {
        for (const action of ['save', 'save-as']) {
          const button = box.querySelector(`[data-project-action="${action}"]`);
          if (button) {
            button.querySelector('strong').textContent = t(action === 'save-as' ? 'saveServerCopy' : this.current ? 'saveSharedProject' : 'saveServerProject');
            button.querySelector('span').textContent = t(action === 'save-as' ? 'serverCopyHint' : 'serverSaveHint');
          }
        }
      }
      if (this.public) {
        box.querySelector('[data-project-action=open-server]')?.remove();
        box.querySelector('[data-project-action=save-as]')?.remove();
        if (this.current?.role !== 'editor')
          box.querySelector('[data-project-action=save]')?.remove();
        const save = box.querySelector('[data-project-action=save]');
        if (save) {
          save.querySelector('strong').textContent = t(
            this.current?.role === 'editor'
              ? 'saveSharedProject'
              : 'downloadProject',
          );
          save.querySelector('span').textContent = t(
            this.current?.role === 'editor' ? 'sharedSaveHint' : 'downloadHint',
          );
        }
        const recentHint =
          box.querySelector('.md-recent-list')?.previousElementSibling;
        if (recentHint) recentHint.textContent = t('localRecentHint');
      }
      const area = document.createElement('section');
      area.className = 'md-server-projects';
      area.innerHTML = `<h4>${esc(t(this.public ? 'sharedWithMe' : 'myServerProjects'))}</h4><p class="md-note">${esc(t('loadingProjects'))}</p>`;
      box.querySelector('.md-project-actions').after(area);
      try {
        const entries = await this.request('/projects');
        if (!box.isConnected) return;
        area.innerHTML = `<h4>${esc(t(this.public ? 'sharedWithMe' : 'myServerProjects'))}</h4><div class="md-server-list">${entries.length ? entries.map((p, i) => `<div class="md-server-row"><button type="button" data-server-project="${i}"><div class="md-project-cover" aria-hidden="true"><span>▧</span></div><strong>${esc(p.name || t('untitled'))}</strong><span>${esc(t(p.role === 'owner' ? 'serverProject' : p.role === 'editor' ? 'editorAccess' : 'viewerAccess'))} · ${p.width} × ${p.height} px</span></button>${p.role === 'owner' && !this.public ? `<div class="md-card-tools"><button type="button" data-server-copy="${i}" aria-label="${esc(t('duplicateProject'))}" title="${esc(t('duplicateProject'))}">⧉</button><button type="button" data-server-delete="${i}" aria-label="${esc(t('deleteProject'))}" title="${esc(t('deleteProject'))}">🗑</button></div>` : ''}</div>`).join('') : `<p class="md-note">${esc(t('noServerProjects'))}</p>`}</div>`;
        e.previewCards(box, entries, 'data-server-project', async entry => {
          const data = await this.request('/projects/' + encodeURIComponent(entry.id) + '/preview');
          return data.project;
        });
        area.querySelectorAll('[data-server-project]').forEach(
          (b) =>
            (b.onclick = async () => {
              b.disabled = true;
              try {
                await this.open(entries[+b.dataset.serverProject].id);
              } catch (error) {
                e.error(error);
              } finally {
                b.disabled = false;
              }
            }),
        );
        area.querySelectorAll('[data-server-copy]').forEach(
          (b) =>
            (b.onclick = async () => {
              const entry = entries[+b.dataset.serverCopy];
              const name = await this.askName(
                t('copyName').replace('{name}', entry.name || t('untitled')),
                'duplicateProject',
                'duplicateHint',
                'duplicateProject',
              );
              if (name === null || !box.isConnected) return;
              b.disabled = true;
              try {
                await this.request(
                  '/projects/' + encodeURIComponent(entry.id) + '/duplicate',
                  { method: 'POST', body: JSON.stringify({ name }) },
                );
                e.toast(t('projectDuplicated'));
                this.refreshDialog(box);
              } catch (error) {
                e.error(error);
                b.disabled = false;
              }
            }),
        );
        area.querySelectorAll('[data-server-delete]').forEach(
          (b) =>
            (b.onclick = async () => {
              const entry = entries[+b.dataset.serverDelete];
              if (!confirm(t('deleteProjectConfirm').replace('{name}', entry.name || t('untitled')))) return;
              b.disabled = true;
              try {
                await this.request('/projects/' + encodeURIComponent(entry.id), { method: 'DELETE' });
                if (this.current?.id === entry.id) {
                  this.current = null;
                  this.e.dirty = true;
                  this.e.renderState();
                }
                e.toast(t('projectDeleted'));
                this.refreshDialog(box);
              } catch (error) {
                e.error(error);
                b.disabled = false;
              }
            }),
        );
      } catch (error) {
        if (box.isConnected)
          area.querySelector('p').textContent = t(
            window.MvmDesignI18n.en[error.message] ? error.message : 'failed',
          );
      }
    }
    refreshDialog(box) {
      // Rebuild the project dialog so the list reflects the change.
      if (!box.isConnected) return;
      box.querySelector('[data-cancel]')?.click();
      this.e.projectDialog().catch((error) => this.e.error(error));
    }
    async share() {
      if (this.public) return;
      if (!this.current) {
        if (!(await this.save())) return;
      } else if (this.e.dirty) {
        if (!(await this.save())) return;
      }
      const project = this.current;
      const box = this.e.modal(
        'shareProject',
        `<p class="md-note">${esc(t('sharingHint'))}</p><label class="md-field"><span>${esc(t('findProfile'))}</span><input data-profile-search type="search" maxlength="100"></label><div data-profile-results></div><h4>${esc(t('projectAccess'))}</h4><div data-grants></div>`,
        () => false,
      );
      box.querySelector('[data-apply]').hidden = true;
      box.querySelector('[data-cancel]').textContent = t('close');
      const roleOptions = (role) =>
        ['viewer', 'editor']
          .map(
            (r) =>
              `<option value="${r}" ${r === role ? 'selected' : ''}>${esc(t(r === 'viewer' ? 'viewerAccess' : 'editorAccess'))}</option>`,
          )
          .join('');
      const path = '/projects/' + encodeURIComponent(project.id) + '/shares';
      const refresh = async () => {
        const grants = await this.request(path);
        if (!box.isConnected) return;
        box.querySelector('[data-grants]').innerHTML = grants
          .map(
            (g, i) =>
              `<div class="md-share-row"><span>${esc(g.name)}</span><select data-share-role="${i}" aria-label="${esc(t('projectAccess'))}">${roleOptions(g.role)}</select><button data-revoke="${i}" type="button">${esc(t('revokeAccess'))}</button></div>`,
          )
          .join('');
        box.querySelectorAll('[data-share-role]').forEach(
          (select) =>
            (select.onchange = async () => {
              select.disabled = true;
              try {
                await this.request(
                  path +
                    '/' +
                    encodeURIComponent(
                      grants[+select.dataset.shareRole].user_id,
                    ),
                  {
                    method: 'PUT',
                    body: JSON.stringify({ role: select.value }),
                  },
                );
                await refresh();
              } catch (error) {
                this.e.error(error);
                select.value = grants[+select.dataset.shareRole].role;
              } finally {
                select.disabled = false;
              }
            }),
        );
        box.querySelectorAll('[data-revoke]').forEach(
          (b) =>
            (b.onclick = async () => {
              b.disabled = true;
              try {
                await this.request(
                  path +
                    '/' +
                    encodeURIComponent(grants[+b.dataset.revoke].user_id),
                  { method: 'DELETE' },
                );
                await refresh();
              } catch (error) {
                this.e.error(error);
                b.disabled = false;
              }
            }),
        );
      };
      let timer,
        serial = 0;
      box.cleanup = () => {
        clearTimeout(timer);
        serial++;
      };
      box.querySelector('[data-profile-search]').oninput = (event) => {
        clearTimeout(timer);
        const q = event.target.value.trim(),
          ticket = ++serial;
        box.querySelector('[data-profile-results]').replaceChildren();
        if (!q) return;
        timer = setTimeout(async () => {
          try {
            const users = await this.request(
              '/profiles?q=' + encodeURIComponent(q),
            );
            if (ticket !== serial || !box.isConnected) return;
            box.querySelector('[data-profile-results]').innerHTML = users
              .map(
                (u, i) =>
                  `<div class="md-share-row"><span>${esc(u.display_name || u.username)} (@${esc(u.username)})</span><select data-new-role="${i}" aria-label="${esc(t('projectAccess'))}">${roleOptions('viewer')}</select><button data-grant="${i}" type="button">${esc(t('grantAccess'))}</button></div>`,
              )
              .join('');
            box.querySelectorAll('[data-grant]').forEach(
              (b) =>
                (b.onclick = async () => {
                  b.disabled = true;
                  const i = +b.dataset.grant;
                  try {
                    await this.request(
                      path + '/' + encodeURIComponent(users[i].id),
                      {
                        method: 'PUT',
                        body: JSON.stringify({
                          role: box.querySelector(`[data-new-role="${i}"]`)
                            .value,
                        }),
                      },
                    );
                    await refresh();
                  } catch (error) {
                    this.e.error(error);
                  } finally {
                    b.disabled = false;
                  }
                }),
            );
          } catch (error) {
            this.e.error(error);
          }
        }, 250);
      };
      await refresh();
    }
  }
  window.MvmDesignProjects = Projects;
})();
