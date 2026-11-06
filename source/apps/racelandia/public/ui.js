// Racelandia menu updates retain live DOM nodes, form drafts and focus.
const bindings = new WeakMap();
export function on(node, type, handler, options) {
  if (!node) return;
  let events = bindings.get(node);
  if (!events) bindings.set(node, events = new Map());
  const capture = typeof options === 'boolean' ? options : !!options?.capture;
  const key = type + ':' + capture, previous = events.get(key);
  if (previous) node.removeEventListener(type, previous, capture);
  events.set(key, handler);
  node.addEventListener(type, handler, options);
}

function key(node) {
  if (node.nodeType !== 1) return '';
  if (node.id) return node.tagName + '#' + node.id;
  const identity = [...node.attributes].filter(a => a.name.startsWith('data-') &&
    !['data-ui-preserve', 'data-ui-view', 'data-n', 'data-m'].includes(a.name));
  return identity.length ? node.tagName + ':' + identity.map(a => a.name + '=' + a.value).sort().join('|') : '';
}
const compatible = (a, b) => a.nodeType === b.nodeType &&
  (a.nodeType !== 1 || a.tagName === b.tagName && key(a) === key(b));

function update(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const active = current === current.ownerDocument.activeElement;
  const control = /^(INPUT|TEXTAREA|SELECT)$/.test(current.tagName);
  const oldValue = current.getAttribute('value');
  const draft = control ? current.value : null;
  const oldDefault = current.defaultValue;
  const checked = current.checked, oldChecked = current.hasAttribute('checked');
  const oldSelection = current.tagName === 'SELECT' ? [...current.options].find(o => o.defaultSelected)?.value : null;
  const open = current.tagName === 'DETAILS' ? current.open : null;
  for (const a of [...current.attributes]) if (!next.hasAttribute(a.name)) current.removeAttribute(a.name);
  for (const a of next.attributes) if (current.getAttribute(a.name) !== a.value) current.setAttribute(a.name, a.value);
  if (!(next.hasAttribute('data-ui-preserve') && !next.hasChildNodes())) patch(current, next);
  if (control) {
    // Keep an unsaved draft when the server/model still has the same value.
    // A different car or an explicit reset supplies a new value and wins.
    if (current.tagName === 'SELECT') {
      const newSelection = [...next.options].find(o => o.defaultSelected)?.value;
      current.value = active || oldSelection === newSelection && [...current.options].some(o => o.value === draft) ? draft : next.value;
    } else if (current.tagName === 'TEXTAREA') {
      current.value = active || draft !== oldDefault && oldDefault === next.defaultValue ? draft : next.value;
    } else {
      current.value = active || oldValue === next.getAttribute('value') ? draft : next.value;
      current.checked = oldChecked === next.hasAttribute('checked') ? checked : next.checked;
    }
  }
  if (open !== null) current.open = open;
}

function patch(host, next) {
  const old = [...host.childNodes], used = new Set();
  const keyed = new Map(old.filter(n => key(n)).map(n => [key(n), n]));
  let cursor = host.firstChild;
  for (const desired of [...next.childNodes]) {
    const id = key(desired);
    let node = id ? keyed.get(id) : cursor;
    if (!node || used.has(node) || !compatible(node, desired)) {
      node = id ? null : old.find(n => !used.has(n) && !key(n) && compatible(n, desired));
    }
    if (!node) node = desired.cloneNode(true);
    if (node !== cursor) host.insertBefore(node, cursor);
    used.add(node);
    update(node, desired);
    cursor = node.nextSibling;
  }
  for (const node of old) if (!used.has(node)) node.remove();
}

export function render(host, html) {
  if (!host) return;
  const template = host.ownerDocument.createElement('template');
  template.innerHTML = html;
  patch(host, template.content);
  return host;
}

window.RacelandiaUI = { render, on };
