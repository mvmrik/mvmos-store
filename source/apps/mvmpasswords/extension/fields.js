(() => {
  const api = globalThis.browser || globalThis.chrome;
  const TITLE = navigator.language.toLowerCase().startsWith('bg') ? 'Отвори трезора с пароли' : 'Open password vault';
  // One marker per field, keyed on the field itself, so a form with a username
  // and a password box gets an icon on each. The old build kept a single marker
  // and created it from `focusin`, which is why an autofocused field never got
  // one: the focus had already happened before this script ran, and no further
  // event was coming.
  const markers = new Map();
  let enabled = false, onFocusOnly = false, frame = 0, mode = 'off', rules = [], currentUrl = location.href;
  const observer = new MutationObserver(schedule);

  // One rule per line. A host covers its subdomains; *.host covers only
  // subdomains. Adding a path makes the rule exact for that path, while a
  // scheme or port restricts those parts too. Query strings are optional:
  // without one, the rule covers every query on that path.
  function parseRule(line) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#') || /\s/.test(raw)) return null;
    const scheme = /^https?:\/\//i.test(raw);
    if (raw.includes('://') && !scheme) return null;
    const wildcard = (scheme ? raw.replace(/^https?:\/\//i, '') : raw).startsWith('*.');
    const clean = wildcard ? raw.replace('*.','') : raw;
    try {
      const url = new URL(scheme ? clean : 'http://' + clean);
      if (!url.hostname || url.username || url.password) return null;
      const authority = (scheme ? raw.replace(/^https?:\/\//i, '') : raw).split(/[/?#]/, 1)[0];
      const tail = (scheme ? raw.replace(/^https?:\/\//i, '') : raw).slice(authority.length);
      return {
        host: url.hostname.toLowerCase(), wildcard,
        protocol: scheme ? url.protocol : null,
        port: authority.includes(']') ? (authority.split(']')[1] || '').replace(/^:/, '') :
          (authority.match(/:(\d+)$/) || [])[1] || null,
        path: tail.startsWith('/') ? url.pathname : null,
        query: tail.includes('?') ? url.search : null
      };
    } catch (_) { return null; }
  }
  function isExcluded(href) {
    let page;
    try { page = new URL(href); } catch (_) { return false; }
    return rules.some(rule => {
      const host = page.hostname.toLowerCase();
      const matchesHost = host === rule.host ||
        ((rule.path === null || rule.wildcard) && !/^[\d.:]+$/.test(rule.host) &&
         host.endsWith('.' + rule.host));
      if (!matchesHost || (rule.wildcard && host === rule.host)) return false;
      if (rule.protocol && page.protocol !== rule.protocol) return false;
      if (rule.port !== null && page.port !== rule.port &&
          !(page.port === '' && ((page.protocol === 'http:' && rule.port === '80') ||
                                  (page.protocol === 'https:' && rule.port === '443')))) return false;
      return (rule.path === null || page.pathname === rule.path) &&
             (rule.query === null || page.search === rule.query);
    });
  }
  function updateAccess() {
    const allowed = mode === 'icons' && !isExcluded(location.href);
    if (allowed === enabled) return;
    enabled = allowed;
    if (enabled) {
      observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true,
        attributeFilter: ['type', 'name', 'autocomplete', 'style', 'class', 'hidden', 'disabled', 'readonly']});
      schedule();
    } else {
      observer.disconnect();
      clear();
    }
  }

  function loginField(input) {
    return input && input.matches && input.matches('input[type="password"],input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i]');
  }
  // A field that is off-screen, collapsed or unusable gets no icon: the marker
  // is positioned in viewport coordinates, so an invisible field would park it
  // in the top-left corner of the page with nothing under it.
  function usable(input, rect) {
    if (input.disabled || input.readOnly || input.type === 'hidden') return false;
    if (rect.width < 40 || rect.height < 14) return false;
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
    const style = getComputedStyle(input);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }
  function create() {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.textContent = '🔑';
    marker.title = TITLE;
    marker.setAttribute('aria-label', TITLE);
    marker.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;border:0;border-radius:5px;background:#313244;color:#89b4fa;cursor:pointer;font-size:14px;padding:0;line-height:24px;box-shadow:0 1px 4px #0008';
    // Pressing the icon must not take the focus off the field, or the page's own
    // validation fires on blur before the vault has even opened.
    marker.addEventListener('mousedown', event => event.preventDefault());
    marker.addEventListener('click', () => api.runtime.sendMessage({type: 'password-manager-open'}));
    document.documentElement.appendChild(marker);
    return marker;
  }
  function drop(input) {
    const marker = markers.get(input);
    if (marker) marker.remove();
    markers.delete(input);
  }
  function clear() { Array.from(markers.keys()).forEach(drop); }

  // Add what is new, remove what is gone, reposition the rest. Both modes come
  // through here and differ in one line — which fields qualify — so the icon
  // behaves identically either way and only its timing changes.
  function sync() {
    if (!enabled) return clear();
    const active = document.activeElement;
    const seen = new Set();
    document.querySelectorAll('input').forEach(input => {
      if (!loginField(input)) return;
      if (onFocusOnly && input !== active) return drop(input);
      const rect = input.getBoundingClientRect();
      if (!usable(input, rect)) return drop(input);
      seen.add(input);
      let marker = markers.get(input);
      if (!marker || !marker.isConnected) { marker = create(); markers.set(input, marker); }
      marker.style.left = Math.max(0, rect.right - 27) + 'px';
      marker.style.top = (rect.top + Math.max(2, (rect.height - 24) / 2)) + 'px';
    });
    Array.from(markers.keys()).forEach(input => { if (!seen.has(input) || !input.isConnected) drop(input); });
  }
  // Scrolling fires per frame and the DOM of a busy page changes constantly, so
  // the work is collapsed into the next animation frame rather than done once
  // per event.
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; sync(); });
  }

  function readSettings(callback) {
    const wanted = {autofill_mode: 'off', icons_on_focus: false, autofill_exclusions: ''};
    const result = api.storage.local.get(wanted);
    if (result && typeof result.then === 'function') result.then(callback);
    else api.storage.local.get(wanted, callback);
  }
  function apply(values) {
    mode = values.autofill_mode;
    onFocusOnly = Boolean(values.icons_on_focus);
    rules = String(values.autofill_exclusions || '').split(/\r?\n/).map(parseRule).filter(Boolean);
    updateAccess();
    if (enabled) schedule();
  }

  readSettings(apply);
  // Changing the setting reaches an already-open tab straight away, instead of
  // only after it is reloaded.
  if (api.storage.onChanged) api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.autofill_mode || changes.icons_on_focus || changes.autofill_exclusions)) readSettings(apply);
  });

  addEventListener('focusin', schedule, true);
  addEventListener('focusout', schedule, true);
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  addEventListener('transitionend', schedule, true);
  addEventListener('animationend', schedule, true);
  // A layout can move without any of the events above — an accordion opening, a
  // font finishing loading, a sticky header collapsing. The tracked fields are
  // few and getBoundingClientRect on them is cheap, so a slow tick keeps the
  // icons on their fields in the cases nothing announces. It rests while the tab
  // is in the background, where there is nothing to look at anyway.
  setInterval(() => { if (!document.hidden && markers.size) sync(); }, 700);
  // pushState changes the address without reloading the content script. Keep
  // exclusions in sync without observing a blocked page's busy DOM.
  setInterval(() => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    updateAccess();
  }, 1000);
})();
