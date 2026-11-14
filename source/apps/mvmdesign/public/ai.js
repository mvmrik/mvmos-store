/* Free shell only. The assistant's context, tools and UI load from licensed code. */
(function () {
  const t = k => (window.MvmDesignI18n[window.mvmOS?.lang || 'en'] || window.MvmDesignI18n.en)[k] || window.MvmDesignI18n.en[k] || k;
  class AI {
    constructor(editor, options) {
      this.e = editor; this.public = !!options.public; this.token = options.token;
      this.refresh = () => this.status().catch(() => {
        if (this.public) for (const action of ['ai-chat','ai-image'])
          editor.root.querySelector(`[data-action=${action}]`).hidden = true;
      });
      if (this.public) for (const action of ['ai-chat','ai-image'])
        editor.root.querySelector(`[data-action=${action}]`).hidden = true;
      this.login = () => { this.panel?.destroy(); this.panel = null; this.refresh(); };
      window.addEventListener('apphub_login', this.login);
      window.addEventListener('apphub_logout', this.login);
      window.addEventListener('focus', this.refresh);
      if (!this.public) for (const action of ['ai-chat','ai-image'])
        window.mvmOS?.premiumGate?.(editor.root.querySelector(`[data-action=${action}]`), t('aiPremium'));
      this.refresh();
    }
    async request(path, body) {
      const token = this.public ? this.token : localStorage.getItem('apphub_token');
      if (this.public && token !== localStorage.getItem('apphub_token')) throw Error('loginRequired');
      const response = await fetch(window.asset((this.public ? '/pub/mvmdesign' : '/api/apps/mvmdesign') + '/ai/' + path), {
        method: body === undefined ? 'GET' : 'POST', cache:'no-store',
        headers: {'Content-Type':'application/json','X-MvmDesign':'1', ...(token ? {'X-Pub-Token':token} : {})},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})
      });
      if (path === 'assistant.js' && response.ok) return response.text();
      const result = await response.json();
      if (result.credits !== undefined && this.info) this.info.credits = result.credits;
      if (!response.ok || result.error) throw Error(result.detail || result.error || 'aiUnavailable');
      return result;
    }
    async status() {
      this.info = await this.request('status');
      if (this.e.dead) return;
      this.e.root.querySelector('[data-action=ai-chat]').hidden = this.public && !(this.info.premium && this.info.enabled);
      this.e.root.querySelector('[data-action=ai-image]').hidden = this.public && !(this.info.premium && this.info.images_enabled);
      return this.info;
    }
    async open(kind) {
      const info = await this.status();
      if (!info.premium) { this.e.toast(t('aiPremium')); return; }
      if (!(kind === 'image' ? info.images_enabled : info.enabled)) { this.e.toast(t('aiDisabled')); return; }
      if (!info.signed_in) {
        if (!this.public && typeof AppHub !== 'undefined') AppHub.requireLogin(() => this.open(kind).catch(e => this.e.error(e)));
        else this.e.toast(t('aiLogin'));
        return;
      }
      if (!info.ready) { this.e.toast(t('aiUnavailable')); return; }
      if (!window.MvmDesignAssistant) {
        const script = await this.request('assistant.js');
        const url = URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
        try {
          await new Promise((resolve,reject) => { const node=document.createElement('script');node.src=url;node.onload=()=>{node.remove();resolve();};node.onerror=()=>{node.remove();reject(Error('aiUnavailable'));};document.head.appendChild(node); });
        } finally { URL.revokeObjectURL(url); }
      }
      if (this.e.dead) return;
      this.panel ||= new window.MvmDesignAssistant(this.e, this);
      if (kind === 'image') this.panel.imageDialog(); else this.panel.show();
    }
    destroy() {
      this.panel?.destroy();
      window.removeEventListener('focus',this.refresh);
      window.removeEventListener('apphub_login',this.login);
      window.removeEventListener('apphub_logout',this.login);
    }
  }
  window.MvmDesignAI = AI;
})();
