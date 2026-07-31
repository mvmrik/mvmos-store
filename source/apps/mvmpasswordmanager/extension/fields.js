(() => {
  const api = globalThis.browser || globalThis.chrome;
  let marker;
  function mode(callback) {
    const result = api.storage.local.get({autofill_mode: 'off'});
    if (result && typeof result.then === 'function') result.then(value => callback(value.autofill_mode));
    else api.storage.local.get({autofill_mode: 'off'}, value => callback(value.autofill_mode));
  }
  function loginField(input) {
    return input && input.matches && input.matches('input[type="password"],input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i]');
  }
  function remove() { if (marker) marker.remove(); marker = null; }
  function show(input) {
    mode(value => {
      if (value !== 'icons' || !loginField(input)) return remove();
      remove();
      const rect = input.getBoundingClientRect();
      marker = document.createElement('button');
      marker.type = 'button'; marker.textContent = '🔑'; marker.title = 'Open password vault';
      marker.style.cssText = 'position:fixed;z-index:2147483647;left:' + Math.max(0, rect.right - 27) + 'px;top:' + (rect.top + Math.max(2, (rect.height - 24) / 2)) + 'px;width:24px;height:24px;border:0;border-radius:5px;background:#313244;color:#89b4fa;cursor:pointer;font-size:14px;padding:0;line-height:24px;box-shadow:0 1px 4px #0008';
      marker.addEventListener('mousedown', event => event.preventDefault());
      marker.addEventListener('click', () => api.runtime.sendMessage({type: 'password-manager-open'}));
      document.documentElement.appendChild(marker);
    });
  }
  document.addEventListener('focusin', event => show(event.target), true);
  window.addEventListener('scroll', remove, true);
  window.addEventListener('resize', remove);
})();
