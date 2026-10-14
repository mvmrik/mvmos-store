// Belot's own strings travel in i18n.js; loaded here as well because the
// owner-side settings can be opened from the App Store without launching the game.
function _belotStrings() {
  if (window._i18n?.bl_ai_setting) return Promise.resolve();
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = window.asset('/apps/belot/i18n.js');
    script.onload = script.onerror = resolve;
    document.head.appendChild(script);
  });
}

mvmOS.registerApp({
  id: 'belot', name: 'Belot', icon: '🃏', category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify('Belot', 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({id:'belot',name:()=>t('bl_title'),icon:'🃏',tagline:()=>t('bl_tagline'),appSettings:true});
  },
  // Owner-side: whether players may give their bots an AI mentor (Premium).
  async renderSettingsExtra(wrap, saved) {
    await _belotStrings();
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px';
    wrap.innerHTML = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="belot-ai-chk" ${saved?.ai_enabled ? 'checked' : ''}> ${t('bl_ai_setting')}
      </label>
      <div style="font-size:.74rem;color:var(--text-dim);line-height:1.5">${t('bl_ai_setting_hint')}</div>`;
    if (window.mvmOS?.premiumStatus !== 'premium') wrap.querySelectorAll('input').forEach(el => el.disabled = true);
    window.mvmOS?.premiumGate?.(wrap, t('bl_ai_premium_hint'));
  },
  saveSettingsExtra(panel) {
    const chk = panel.querySelector('#belot-ai-chk');
    if (!chk || chk.disabled) return;
    return mvmOS.db('belot').run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['ai_enabled', JSON.stringify(chk.checked)]);
  }
});
