// mvmOS App: Tower Defense v1.0.0
//
// There is deliberately no game in this file. Tower Defense — like every game
// written against this pattern — is played on its public Game Hub page, which
// is the only place an Apps Hub account exists, and therefore the only place
// where anyone besides the single session logged into this desktop can play,
// score and appear in the leaderboards. A game opened in its own tab also gets
// the entire screen, which is what a game wants on a phone.
//
// So this window is a launcher, and core's GameLauncher (frontend/
// gamelauncher.js) is the whole of it: it opens the game in Game Hub, and it
// installs Game Hub in place when it is missing. Anything that belongs to the
// owner of the server rather than to a player — settings, premium switches —
// goes into `sections` below, and never travels to the public page.
//
// The game itself lives in public/mp.js (client) and mp_game.py (server).

const _tdBoot = {
  en: { title: 'Tower Defense' },
  bg: { title: 'Tower Defense' },
};
function _tdt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_tdBoot[lang] || _tdBoot.en)[key] || key;
}

mvmOS.registerApp({
  id: 'towerdefense',
  name: _tdt('title'),
  icon: '🏰',
  category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify(_tdt('title'), 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({
      id: 'towerdefense',
      name: _tdt('title'),
      icon: '🏰',
      // Resolved lazily: the launcher merges this app's string table
      // (public/i18n.js) before it renders.
      tagline: () => t('td_tagline'),
      sections: [{ render: _tdFastPlaySection }],
    });
  },
});

// Fast play (Premium): the owner's switch for the speed button and auto waves
// on the public game page. Always shown here; without Premium a click opens
// the subscription dialog instead. The work itself is in premium/, and the
// public page never mentions Premium — it simply has the feature or not.
async function _tdFastPlaySection(el) {
  el.innerHTML =
    `<div style="font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${t('td_fast_title')}</div>` +
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem">` +
    `<input type="checkbox" disabled> <span>${t('td_fast_switch')}</span></label>` +
    `<div style="font-size:.8rem;line-height:1.5;color:var(--text-dim);margin-top:6px">${t('td_fast_desc')}</div>`;
  const box = el.querySelector('input');
  const data = await fetch('/api/apps/towerdefense/admin/fastplay')
    .then(r => (r.ok ? r.json() : { premium: false })).catch(() => ({ premium: false }));
  box.checked = !!data.on;
  box.disabled = false;
  if (!data.premium) {
    // premiumStatus can still say 'premium' while the module has not arrived;
    // the server is the authority, so the gate must not wave the click through.
    box.addEventListener('click', e => { if (window.mvmOS.premiumStatus === 'premium') e.preventDefault(); });
    window.mvmOS.premiumGate(el.querySelector('label'), t('td_fast_premium'));
    return;
  }
  box.onchange = async () => {
    const r = await fetch('/api/apps/towerdefense/admin/fastplay', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: box.checked }),
    }).catch(() => null);
    if (!r || !r.ok) box.checked = !box.checked;
  };
}
