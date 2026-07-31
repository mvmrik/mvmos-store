// Runs in the page's main world (injected by passkey-bridge.js) so it can
// override navigator.credentials with the real prototypes the page expects.
// It never touches vault data directly — every create()/get() call is relayed
// through window.postMessage to the isolated-world content script, which asks
// the extension background to run it against the encrypted vault in the popup.
(() => {
  if (!window.PublicKeyCredential || window.__mvmPasskeyInstalled) return;
  window.__mvmPasskeyInstalled = true;

  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'mvm-passkey-bridge') return;
    const entry = pending.get(msg.reqId);
    if (!entry) return;
    pending.delete(msg.reqId);
    if (msg.error) entry.reject(new DOMException(msg.error, 'NotAllowedError'));
    else if (!msg.result) entry.reject(new DOMException('The operation was cancelled.', 'NotAllowedError'));
    else entry.resolve(msg.result);
  });

  function abortError() {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  function call(op, options, signal) {
    const reqId = 'pk' + (++seq) + '_' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      // A page that offers both autofill and a button aborts the first request
      // when the user takes the second route. Ignoring the signal left that
      // first promise alive until its own timeout, so the page kept waiting on
      // a request the user had already moved on from.
      if (signal && signal.aborted) return reject(abortError());
      pending.set(reqId, {resolve, reject});
      if (signal) signal.addEventListener('abort', () => {
        if (!pending.delete(reqId)) return;
        reject(abortError());
      }, {once: true});
      window.postMessage({source: 'mvm-passkey-page', reqId, op, options}, location.origin);
      setTimeout(() => {
        if (!pending.has(reqId)) return;
        pending.delete(reqId);
        reject(new DOMException('The operation timed out.', 'NotAllowedError'));
      }, 120000);
    });
  }

  function b64uToBuf(value) {
    let s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function bufToB64u(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function serialize(value) {
    if (value == null) return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return {__buf: bufToB64u(value)};
    if (Array.isArray(value)) return value.map(serialize);
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) out[key] = serialize(value[key]);
      return out;
    }
    return value;
  }

  const nativeCreate = navigator.credentials.create.bind(navigator.credentials);
  const nativeGet = navigator.credentials.get.bind(navigator.credentials);

  navigator.credentials.create = function (options) {
    if (!options || !options.publicKey) return nativeCreate(options);
    const pk = options.publicKey;
    const payload = serialize({
      rp: pk.rp,
      user: {...pk.user, id: pk.user && pk.user.id},
      challenge: pk.challenge,
      pubKeyCredParams: pk.pubKeyCredParams,
      timeout: pk.timeout,
      excludeCredentials: pk.excludeCredentials,
      authenticatorSelection: pk.authenticatorSelection,
      attestation: pk.attestation,
    });
    return call('create', payload, options.signal).then(result => buildCreateCredential(result));
  };

  navigator.credentials.get = function (options) {
    if (!options || !options.publicKey) return nativeGet(options);
    // Conditional mediation means "offer a passkey inside the login field,
    // without interrupting anyone". This provider can only answer by opening a
    // window, so honouring it would pop one open unasked on every sign-in page
    // that supports autofill. It stays silent instead and waits for the page's
    // own passkey button to call get() again modally — the same request the
    // page aborts at that moment, which is what settles this promise.
    if (options.mediation === 'conditional') {
      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) return;
        if (signal.aborted) return reject(abortError());
        signal.addEventListener('abort', () => reject(abortError()), {once: true});
      });
    }
    const pk = options.publicKey;
    const payload = serialize({
      rpId: pk.rpId,
      challenge: pk.challenge,
      timeout: pk.timeout,
      userVerification: pk.userVerification,
      allowCredentials: pk.allowCredentials,
    });
    return call('get', payload, options.signal).then(result => buildGetCredential(result));
  };

  function buildCreateCredential(result) {
    if (!result) return null;
    const rawId = b64uToBuf(result.credentialId);
    return {
      id: result.credentialId,
      rawId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64uToBuf(result.clientDataJSON),
        attestationObject: b64uToBuf(result.attestationObject),
        getTransports: () => ['internal'],
        getPublicKey: () => (result.publicKeySpki ? b64uToBuf(result.publicKeySpki) : null),
        getPublicKeyAlgorithm: () => -7,
      },
      getClientExtensionResults: () => ({}),
    };
  }

  function buildGetCredential(result) {
    if (!result) return null;
    const rawId = b64uToBuf(result.credentialId);
    return {
      id: result.credentialId,
      rawId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64uToBuf(result.clientDataJSON),
        authenticatorData: b64uToBuf(result.authenticatorData),
        signature: b64uToBuf(result.signature),
        userHandle: result.userHandle ? b64uToBuf(result.userHandle) : null,
      },
      getClientExtensionResults: () => ({}),
    };
  }

  // Answered unconditionally, not only when the browser lacks it: the browser's
  // own true refers to authenticators this override has already displaced, so
  // leaving it in place invites pages down a path nothing can serve.
  window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true);
})();
