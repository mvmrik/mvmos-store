// Chrome runs this as an MV3 service worker, which takes a single entry file,
// so the shared config is pulled in here. Firefox lists config.js ahead of this
// script in the manifest instead, where importScripts does not exist.
if (typeof importScripts === 'function' && !globalThis.MVM_EXTENSION_CONFIG) {
  try { importScripts('config.js'); } catch (_) {}
}

(() => {
  const api = globalThis.browser || globalThis.chrome;
  const config = globalThis.MVM_EXTENSION_CONFIG || {};
  // This file is only ever packaged for an app that wants a passkey provider,
  // so there is no capability flag left to consult: shipping it is the switch.
  const isFirefox = config.browser === 'firefox';
  const pendingPasskey = new Map();
  let passkeyWindowId = null;

  function getMode() {
    const result = api.storage.local.get({autofill_mode: 'off'});
    return result && typeof result.then === 'function' ? result.then(value => value.autofill_mode) :
      new Promise(resolve => api.storage.local.get({autofill_mode: 'off'}, value => resolve(value.autofill_mode)));
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return undefined;
    if (message.type === 'password-manager-open' && api.action && api.action.openPopup) {
      try { const result = api.action.openPopup(); if (result && result.catch) result.catch(() => {}); } catch (_) {}
      return undefined;
    }
    if (message.type === 'passkey-request') {
      const settled = handlePasskeyRequest(message, sender).then(
        result => ({result}),
        err => ({error: String((err && err.message) || err)})
      );
      // Firefox answers by returning the promise; `return true` plus a later
      // sendResponse() is only honoured from Firefox 138 on, and on anything
      // older the caller would get an immediate undefined instead of waiting
      // for the user. Chrome is the mirror image and only understands `true`.
      if (isFirefox) return settled;
      settled.then(sendResponse);
      return true;
    }
    if (message.type === 'passkey-popup-ready') {
      flushPasskeyQueue();
      return undefined;
    }
    if (message.type === 'passkey-popup-result') {
      const entry = pendingPasskey.get(message.reqId);
      if (entry) {
        pendingPasskey.delete(message.reqId);
        if (message.error) entry.reject(new Error(message.error));
        else entry.resolve(message.result);
      }
      return undefined;
    }
    return undefined;
  });

  if (api.commands && api.commands.onCommand) api.commands.onCommand.addListener(command => {
    if (command !== 'open-password-manager') return;
    getMode().then(mode => {
      if (mode !== 'shortcut' || !api.action || !api.action.openPopup) return;
      try { const result = api.action.openPopup(); if (result && result.catch) result.catch(() => {}); } catch (_) {}
    });
  });

  if (api.tabs && api.tabs.onUpdated && api.action && api.action.setBadgeText) api.tabs.onUpdated.addListener(tabId => {
    try { const result = api.action.setBadgeText({tabId: tabId, text: ''}); if (result && result.catch) result.catch(() => {}); } catch (_) {}
  });

  let reqSeq = 0;
  const queue = [];

  function handlePasskeyRequest(message, sender) {
    return new Promise((resolve, reject) => {
      const reqId = 'bg' + (++reqSeq);
      const tab = sender && sender.tab;
      const item = {
        reqId, op: message.op, options: message.options, origin: message.origin,
        tabTitle: (tab && tab.title) || '', favIconUrl: tab && tab.favIconUrl,
      };
      pendingPasskey.set(reqId, {resolve, reject});
      queue.push(item);
      openPasskeyWindow();
    });
  }

  function flushPasskeyQueue() {
    while (queue.length) {
      const item = queue.shift();
      broadcastToPasskeyWindow({type: 'passkey-job', job: item});
    }
  }

  function broadcastToPasskeyWindow(message) {
    try {
      const result = api.runtime.sendMessage(message);
      if (result && result.catch) result.catch(() => {});
    } catch (_) {}
  }

  function openPasskeyWindow() {
    if (!api.windows || !api.windows.create) {
      // Fallback for browsers without windows.create (e.g. some mobile builds):
      // reject immediately rather than hang, since there is no way to show the vault UI.
      while (queue.length) {
        const item = queue.shift();
        const entry = pendingPasskey.get(item.reqId);
        if (entry) { pendingPasskey.delete(item.reqId); entry.reject(new Error('unsupported')); }
      }
      return;
    }
    if (passkeyWindowId != null) {
      try {
        const result = api.windows.update(passkeyWindowId, {focused: true});
        if (result && result.then) result.then(flushPasskeyQueue, () => { passkeyWindowId = null; openPasskeyWindow(); });
        else flushPasskeyQueue();
      } catch (_) { passkeyWindowId = null; openPasskeyWindow(); }
      return;
    }
    const url = api.runtime.getURL('popup.html') + '?passkey=1';
    const created = api.windows.create({url, type: 'popup', width: 420, height: 640});
    Promise.resolve(created).then(win => {
      passkeyWindowId = win && (win.id != null ? win.id : (win.windows && win.windows[0] && win.windows[0].id));
    });
  }

  if (api.windows && api.windows.onRemoved) api.windows.onRemoved.addListener(windowId => {
    if (windowId !== passkeyWindowId) return;
    passkeyWindowId = null;
    for (const [reqId, entry] of pendingPasskey) {
      entry.reject(new DOMException('The operation was cancelled.', 'NotAllowedError'));
      pendingPasskey.delete(reqId);
    }
    queue.length = 0;
  });
})();
