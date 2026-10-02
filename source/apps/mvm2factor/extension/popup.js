// mvm2factor's half of the extension popup. The shell (popup.js in core) has
// already sized the window, resolved the mvmOS server and loaded the public
// page; everything below is what this app in particular wants done with the
// browser, and it lives here rather than in core because no other app needs it.
(function () {
  var mvm = globalThis.mvmExt;
  if (!mvm) return;

  // Filling a one-time code into whatever the user was looking at. The selector
  // list is deliberately generous: sites label the field a dozen ways, and a
  // focused input always wins over guessing.
  mvm.onFrameMessage('autofill', function (message) {
    var code = String(message.code || '');
    if (!/^[0-9]{6,8}$/.test(code)) return;
    mvm.executeScript(function (value) {
      var focused = document.activeElement;
      var selector = [
        'input[autocomplete="one-time-code"]', 'input[name*="otp" i]', 'input[id*="otp" i]',
        'input[name*="totp" i]', 'input[id*="totp" i]', 'input[name*="2fa" i]',
        'input[id*="2fa" i]', 'input[name*="code" i]', 'input[id*="code" i]'
      ].join(',');
      var input = focused && focused.matches &&
        focused.matches('input:not([type]),input[type="text"],input[type="tel"],input[type="number"],input[type="password"]')
        ? focused : document.querySelector(selector);
      if (!input) return false;
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      input.focus();
      return true;
    }, [code]);
  });

  // The unlocked key, kept by the popup the way mvmPasswords' popup keeps its
  // own: the page in the frame has no lasting storage, so it hands the key
  // here and gets it back each time the popup opens. A chosen span outlives a
  // browser restart and ends by its deadline; "until closed" stays in memory.
  function sendVaultSession() {
    Promise.all([mvm.persist.get('vault_session'), mvm.session.get('vault_session')]).then(function (found) {
      var saved = found[0] || found[1];
      if (saved && saved.expires && saved.expires < Date.now()) saved = null;
      if (!saved) { mvm.persist.clear('vault_session'); mvm.session.clear('vault_session'); }
      mvm.postToFrame({type: 'vault-session', session: saved || null});
    });
  }
  mvm.onFrameMessage('vault-session-save', function (message) {
    var saved = message.session;
    if (saved && saved.expires) { mvm.session.clear('vault_session'); mvm.persist.set('vault_session', saved); }
    else { mvm.persist.clear('vault_session'); mvm.session.set('vault_session', saved); }
  });
  mvm.onFrameMessage('vault-session-clear', function () {
    mvm.persist.clear('vault_session');
    mvm.session.clear('vault_session');
  });
  mvm.onFrameReady(sendVaultSession);
})();
