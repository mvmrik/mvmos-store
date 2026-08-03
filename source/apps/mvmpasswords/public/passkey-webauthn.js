(function () {
  if (window.MvmPasswordManagerPasskey) return;

  function b64uToBuf(value) {
    var s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function bufToB64u(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function concatBuf(parts) {
    var total = parts.reduce(function (n, p) { return n + p.byteLength; }, 0);
    var out = new Uint8Array(total), off = 0;
    parts.forEach(function (p) { out.set(p instanceof Uint8Array ? p : new Uint8Array(p), off); off += p.byteLength; });
    return out;
  }

  // Minimal CBOR encoder covering only the value shapes WebAuthn needs:
  // unsigned ints, byte strings, text strings, maps with text/int keys, and -7/-257 COSE keys.
  function cborUint(major, value) {
    if (value < 24) return new Uint8Array([(major << 5) | value]);
    if (value < 256) return new Uint8Array([(major << 5) | 24, value]);
    if (value < 65536) return new Uint8Array([(major << 5) | 25, value >> 8, value & 0xff]);
    return new Uint8Array([
      (major << 5) | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
    ]);
  }
  function cborNegInt(value) {
    var n = -1 - value;
    var head = cborUint(1, n);
    head[0] = (1 << 5) | (head[0] & 0x1f);
    return head;
  }
  function cborBytes(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return concatBuf([cborUint(2, bytes.length), bytes]);
  }
  function cborText(str) {
    var bytes = new TextEncoder().encode(str);
    return concatBuf([cborUint(3, bytes.length), bytes]);
  }
  function cborKey(key) {
    return typeof key === 'string' ? cborText(key) : (key < 0 ? cborNegInt(key) : cborUint(0, key));
  }
  function cborMap(entries) {
    var head = cborUint(5, entries.length);
    var parts = [head];
    entries.forEach(function (entry) { parts.push(cborKey(entry[0]), entry[1]); });
    return concatBuf(parts);
  }

  function coseEs256PublicKey(x, y) {
    // COSE_Key map: kty=2 (EC2), alg=-7 (ES256), crv=1 (P-256), x, y
    return cborMap([
      [1, cborUint(0, 2)],
      // cborNegInt takes the value itself, not the CBOR payload: passing 6 here
      // encoded alg as the two-byte header 0x39 with no bytes behind it, which
      // left the whole key — and so the attestation object — unparseable CBOR.
      [3, cborNegInt(-7)],
      [-1, cborUint(0, 1)],
      [-2, cborBytes(x)],
      [-3, cborBytes(y)],
    ]);
  }

  async function sha256(buf) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }

  function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  async function generateKeyPair() {
    return crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  }

  async function exportRawPoint(publicKey) {
    var raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
    // raw = 0x04 || X (32 bytes) || Y (32 bytes)
    return {x: raw.slice(1, 33), y: raw.slice(33, 65)};
  }

  function authenticatorData(rpId, flags, signCount, attestedCredData) {
    return sha256(new TextEncoder().encode(rpId)).then(function (rpHash) {
      var flagsByte = new Uint8Array([flags]);
      var counter = new Uint8Array(4);
      new DataView(counter.buffer).setUint32(0, signCount >>> 0, false);
      var parts = [rpHash, flagsByte, counter];
      if (attestedCredData) parts.push(attestedCredData);
      return concatBuf(parts);
    });
  }

  function attestedCredentialData(aaguid, credentialId, coseKey) {
    var idLen = new Uint8Array(2);
    new DataView(idLen.buffer).setUint16(0, credentialId.length, false);
    return concatBuf([aaguid, idLen, credentialId, coseKey]);
  }

  // "none" attestation must carry an all-zero AAGUID: that is what a browser
  // writes when it strips attestation, and a relying party is entitled to
  // reject an identifiable one. A software authenticator has nothing to attest
  // to anyway, so there is no identity to lose here.
  var AAGUID = new Uint8Array(16);

  async function derSignature(signature) {
    // WebCrypto ECDSA signatures are raw r||s (32+32 bytes); WebAuthn requires DER.
    var raw = new Uint8Array(signature);
    var r = raw.slice(0, 32), s = raw.slice(32, 64);
    function trim(v) {
      var i = 0;
      while (i < v.length - 1 && v[i] === 0 && !(v[i + 1] & 0x80)) i++;
      v = v.slice(i);
      if (v[0] & 0x80) { var padded = new Uint8Array(v.length + 1); padded.set(v, 1); v = padded; }
      return v;
    }
    r = trim(r); s = trim(s);
    function intDer(v) { return concatBuf([new Uint8Array([0x02, v.length]), v]); }
    var body = concatBuf([intDer(r), intDer(s)]);
    return concatBuf([new Uint8Array([0x30, body.length]), body]);
  }

  async function createCredential(options) {
    var rpId = (options.rp && options.rp.id) || '';
    var challenge = b64uToBuf(options.challenge);
    var keyPair = await generateKeyPair();
    var point = await exportRawPoint(keyPair.publicKey);
    var credentialIdBytes = randomBytes(32);
    var coseKey = coseEs256PublicKey(point.x, point.y);
    var attestedData = attestedCredentialData(AAGUID, credentialIdBytes, coseKey);
    // BE|BS say the credential is backed up and multi-device, which is exactly
    // what a vault-stored passkey is; sites use them to decide whether to keep
    // offering a password fallback. BE must then stay set on every assertion.
    var authData = await authenticatorData(rpId, 0x5d /* UP|UV|BE|BS|AT */, 1, attestedData);
    var clientData = {
      type: 'webauthn.create',
      challenge: bufToB64u(challenge),
      origin: options.__origin,
      crossOrigin: false,
    };
    var clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));
    var clientDataHash = await sha256(clientDataJSON);
    var attestationObject = cborMap([
      ['fmt', cborText('none')],
      ['attStmt', cborMap([])],
      ['authData', cborBytes(authData)],
    ]);
    var privateKeyRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    var publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    return {
      credentialId: bufToB64u(credentialIdBytes),
      clientDataJSON: bufToB64u(clientDataJSON),
      attestationObject: bufToB64u(attestationObject),
      publicKeySpki: bufToB64u(publicKeySpki),
      vaultRecord: {
        credentialId: bufToB64u(credentialIdBytes),
        rpId: rpId,
        rpName: (options.rp && options.rp.name) || rpId,
        userName: (options.user && options.user.name) || '',
        userDisplayName: (options.user && options.user.displayName) || '',
        userHandle: options.user && options.user.id,
        privateKeyPkcs8: bufToB64u(privateKeyRaw),
        publicKeySpki: bufToB64u(publicKeySpki),
        createdAt: Date.now(),
      },
    };
  }

  async function getAssertion(options, record) {
    var challenge = b64uToBuf(options.challenge);
    var authData = await authenticatorData(record.rpId, 0x1d /* UP|UV|BE|BS */, (record.signCount || 0) + 1, null);
    var clientData = {
      type: 'webauthn.get',
      challenge: bufToB64u(challenge),
      origin: options.__origin,
      crossOrigin: false,
    };
    var clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));
    var clientDataHash = await sha256(clientDataJSON);
    var privateKey = await crypto.subtle.importKey(
      'pkcs8', b64uToBuf(record.privateKeyPkcs8), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']
    );
    var signed = concatBuf([authData, clientDataHash]);
    var rawSignature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, privateKey, signed);
    var signature = await derSignature(rawSignature);
    return {
      credentialId: record.credentialId,
      clientDataJSON: bufToB64u(clientDataJSON),
      authenticatorData: bufToB64u(authData),
      signature: bufToB64u(signature),
      userHandle: record.userHandle || null,
    };
  }

  window.MvmPasswordManagerPasskey = {
    createCredential: createCredential,
    getAssertion: getAssertion,
    bufToB64u: bufToB64u,
    b64uToBuf: b64uToBuf,
  };
})();
