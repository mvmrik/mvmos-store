// Software passkey provider, isolated-world half. It never sees vault data: it
// only relays opaque WebAuthn requests between the page (main world, via
// passkey-page.js, registered as a "world": "MAIN" content script) and the
// extension background, which opens the popup so the user can pick or confirm a
// credential from the encrypted vault. The keys themselves are generated and
// stored inside the popup's iframe, which is the only place the vault is open.
(() => {
  const api = globalThis.browser || globalThis.chrome;

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'mvm-passkey-page') return;
    const reqId = msg.reqId;
    let response;
    try {
      response = api.runtime.sendMessage({type: 'passkey-request', op: msg.op, options: msg.options, origin: location.origin});
    } catch (err) {
      window.postMessage({source: 'mvm-passkey-bridge', reqId, error: String((err && err.message) || err)}, location.origin);
      return;
    }
    Promise.resolve(response)
      .then(wrapped => {
        // A listener that never handled the request resolves with undefined.
        // Surfacing that as a plain "no result" would make the page's WebAuthn
        // call succeed with a null credential, which is what a relying party's
        // JSON serializer then crashes on — so it is reported as an error.
        if (!wrapped) {
          window.postMessage({source: 'mvm-passkey-bridge', reqId, error: 'The passkey provider is unavailable.'}, location.origin);
          return;
        }
        window.postMessage({source: 'mvm-passkey-bridge', reqId, result: wrapped.result, error: wrapped.error}, location.origin);
      })
      .catch(err => {
        window.postMessage({source: 'mvm-passkey-bridge', reqId, error: String((err && err.message) || err)}, location.origin);
      });
  });
})();
