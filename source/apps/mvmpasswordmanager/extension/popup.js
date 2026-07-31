// mvmPasswordManager's half of the extension popup. The shell (popup.js in
// core) has already sized the window, resolved the mvmOS server and loaded the
// vault page; everything below is what this app wants done with the browser.
//
// It never sees decrypted vault data at rest: credentials arrive from the
// hosted page only at the moment the user picks one, are injected, and are not
// kept anywhere. The only thing cached is the wrapped vault session key, in
// session storage, so the popup does not demand the master password again on
// every open.
(function () {
  var mvm = globalThis.mvmExt;
  if (!mvm) return;

  // The popup opens two ways: under the toolbar icon, and as its own window
  // when a site asks for a passkey. The flag has to reach the hosted page too,
  // because that page renders a different screen in each case.
  var isPasskeyWindow = mvm.query.get('passkey') === '1';
  if (isPasskeyWindow) mvm.setFrameQuery('passkey=1');

  var passkeyJobs = {};

  // ---- vault session ------------------------------------------------------
  // Older development archives cached decrypted logins for experimental
  // automatic fill. This build never reads it, so clear it out on startup.
  mvm.api.storage.session && mvm.session.clear('autofill_cache');

  function sendVaultSession() {
    mvm.session.get('vault_session').then(function (saved) {
      if (!saved || (saved.expires && saved.expires < Date.now())) {
        mvm.session.clear('vault_session');
        saved = null;
      }
      mvm.postToFrame({type: 'vault-session', session: saved || null});
    });
  }

  mvm.onFrameMessage('vault-session-save', function (message) {
    mvm.session.set('vault_session', message.session);
  });
  mvm.onFrameMessage('vault-session-clear', function () {
    mvm.session.clear('vault_session');
  });

  // ---- filling a login ----------------------------------------------------
  mvm.onFrameMessage('autofill-login', function (message) {
    var credentials = message.credentials;
    if (!credentials || typeof credentials !== 'object') return;
    mvm.executeScript(function (login) {
      function set(input, value) {
        if (!input) return;
        var proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(input, value || '');
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
      }
      var password = document.activeElement && document.activeElement.matches &&
        document.activeElement.matches('input[type="password"]') ? document.activeElement :
        document.querySelector('input[type="password"]');
      var username = document.querySelector('input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i],input[id*="user" i],input[id*="email" i]');
      if (!username && password) {
        var inputs = Array.from(document.querySelectorAll('input:not([type]),input[type="text"],input[type="email"],input[type="tel"]'));
        var index = inputs.indexOf(password);
        username = index > 0 ? inputs[index - 1] : null;
      }
      set(username, login.username);
      set(password, login.password);
      if (password) password.focus();
      return Boolean(password || username);
    }, [{username: String(credentials.username || ''), password: String(credentials.password || '')}]);
  });

  mvm.onFrameMessage('password-match-count', function (message) {
    var count = Number(message.count) > 0 ? String(Math.min(99, Number(message.count))) : '';
    mvm.setBadge(count, '#3671e9');
  });

  // ---- passkeys -----------------------------------------------------------
  function runPasskeyJob(job) {
    passkeyJobs[job.reqId] = job;
    mvm.postToFrame({type: 'passkey-job', job: job});
  }

  if (isPasskeyWindow) {
    mvm.onBackgroundMessage(function (message) {
      if (!message || message.type !== 'passkey-job') return;
      runPasskeyJob(message.job);
    });
  }

  mvm.onFrameMessage('passkey-result', function (message) {
    var job = passkeyJobs[message.reqId];
    delete passkeyJobs[message.reqId];
    // Close only once the answer has actually left this window: closing it
    // synchronously can tear the popup down before the message is delivered,
    // leaving the page's WebAuthn call hanging until its own timeout.
    mvm.sendToBackground({
      type: 'passkey-popup-result', reqId: message.reqId,
      result: message.result, error: message.error
    }).then(function () { if (job) mvm.close(); });
  });

  mvm.onFrameReady(function () {
    sendVaultSession();
    if (!isPasskeyWindow) return;
    // A job that arrived before the iframe existed was kept but never
    // delivered, so re-post everything still pending now that it can receive
    // it; runPasskeyJob is idempotent per request id.
    Object.keys(passkeyJobs).forEach(function (id) { runPasskeyJob(passkeyJobs[id]); });
    mvm.sendToBackground({type: 'passkey-popup-ready'});
  });
})();
