const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/mvmai-widget.js'), 'utf8');
const code = source.slice(source.indexOf('      function compactKeepRecent()'), source.indexOf('      // Messages written while'));

(async () => {
  for (const status of [200, 502, 409]) {
    const messages = Array.from({length: 40}, (_, i) => ({role: i % 2 ? 'assistant' : 'user', content: `Message ${i}`}));
    let complete, request;
    const notes = [];
    const ctx = {history: messages};
    const scope = {
      me: {compact_keep_recent: 20}, history: messages, sessionId: 'original-chat',
      chosenApp: null, sending: false, chatContext: ctx, listEl: {innerHTML: 'Original conversation'},
      uiLang: () => 'en', t: key => key, saveChatContext: () => ctx,
      api: (path, options) => {
        request = JSON.parse(options.body);
        return new Promise(resolve => { complete = resolve; });
      },
      addBubble: (role, text) => notes.push(text), addModelSwitchNote: () => {},
      addCompactedNote: text => notes.push(text), scrollDown: () => {},
    };
    vm.createContext(scope);
    vm.runInContext(code + '\nmaybeCompact();', scope);
    assert.equal(request.session_id, 'original-chat');
    assert.equal(request.compact_cli, true);
    assert.deepEqual(request.compact_last, messages.at(-1));
    assert.equal(scope.history.length, 40, 'Do not show success while native compaction is pending');
    complete({__status: status, message: {content: 'Confirmed summary'}});
    await new Promise(resolve => setImmediate(resolve));
    if (status === 200) {
      assert.equal(scope.history.length, 21);
      assert.equal(scope.history[0].role, 'summary');
      assert.equal(scope.history.at(-1).content, 'Message 39');
      assert.equal(ctx.history, scope.history);
      assert(notes.includes('Confirmed summary'));
    } else {
      assert.equal(scope.history, messages);
      assert(!notes.includes('Confirmed summary'));
      assert.equal(notes.includes('mvmai_pub_compact_failed'), status === 502);
    }
  }
  console.log('PASS: compaction keeps the session, waits for confirmation, and retains history on failure or a stale request');
})().catch(error => { console.error(error); process.exit(1); });
