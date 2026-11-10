// One formatter for all catalogue consumers. Rules come from Game Hub's service.
export function displayName(identity, lang, rules = {}) {
  if (identity.custom_name) return identity.custom_name;
  const languages = Object.fromEntries(Object.entries(rules.language_scripts || {}).map(([k,v]) => [k.toLowerCase(),v]));
  const locale = String(lang || 'en').replaceAll('_','-').toLowerCase();
  const readable = languages[locale] || languages[locale.split('-')[0]] || ['Latn'];
  return readable.includes(identity.native_script) ? identity.native : identity.latin;
}

export function formatTree(value, {lang = 'en', rules = {}, identities = new Map()} = {}) {
  // Learn all identities before displaying any row: a classification may precede
  // its roster in a response. The consumer can retain this index for later events.
  function learn(v) {
    if (!v || typeof v !== 'object') return;
    const keys = [v.id, v.pilot_id, v.key].filter(Boolean);
    if (Object.hasOwn(v, 'name_identity')) {
      for (const key of keys) {
        if (v.name_identity?.country) identities.set(key, v.name_identity);
        else if (!v.name_identity) identities.delete(key);
      }
    }
    for (const child of Object.values(v)) learn(child);
  }
  function format(v) {
    if (!v || typeof v !== 'object') return;
    const identity = v.name_identity || identities.get(v.id || v.pid || v.pilot_id || v.key);
    if (identity && typeof v.name === 'string') v.name = displayName(identity,lang,rules);
    for (const [key, child] of Object.entries(v)) if (key !== 'name_identity') format(child);
  }
  learn(value); format(value); return value;
}

export function countryFlag(country) {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country)
    ? String.fromCodePoint(...[...country].map(c => c.charCodeAt(0) + 127397)) : '';
}
