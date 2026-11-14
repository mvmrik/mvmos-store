const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const context = vm.createContext({ window: {}, crypto });
for (const file of ['model.js', 'render.js', 'i18n.js']) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'),
    context,
  );
}
const M = context.window.MvmDesignModel;
const R = context.window.MvmDesignRender;

test('repeated occurrences keep one editable page with independent timing', () => {
  const p = M.project();
  p.pages[0].items.push(M.item());
  p.sequence.push(M.occurrence(p.pages[0].id, 9));
  p.pages[0].items[0].text = 'Updated chorus';
  const copy = M.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(copy.pages.length, 1);
  assert.equal(copy.sequence[0].pageId, copy.sequence[1].pageId);
  assert.equal(copy.pages[0].items[0].text, 'Updated chorus');
  assert.equal(M.duration(copy), 14);
  assert.equal(M.at(copy, 4.999).id, copy.sequence[0].id);
  assert.equal(M.at(copy, 5).id, copy.sequence[1].id);
});

test('project validation bounds geometry and rejects external media and invalid references', () => {
  const p = M.project();
  const it = M.item();
  Object.assign(it, { w: -10, opacity: 50, size: 100, enter: 'unknown' });
  p.pages[0].items.push(it);
  p.assets.external = { src: 'https://example.com/track.png' };
  p.audio = { data: 'https://example.com/music.mp3' };
  p.sequence.push(M.occurrence('missing'));
  const n = M.normalize(p);
  assert.equal(n.pages[0].items[0].w, 0.005);
  assert.equal(n.pages[0].items[0].opacity, 1);
  assert.equal(n.pages[0].items[0].size, 1);
  assert.equal(n.pages[0].items[0].enter, 'none');
  assert.equal(Object.keys(n.assets).length, 0);
  assert.equal(n.audio, null);
  assert.equal(n.sequence.length, 1);
  assert.throws(() => M.normalize({ format: 'different' }), /invalidProject/);
  assert.throws(() => M.normalize({ ...p, version: 2 }), /invalidProject/);
});

test('subtitle timing survives SRT round trips with Cyrillic and multiline cues', () => {
  const cues = [
    { start: 12.345, end: 18.89, text: 'Първи ред\nSecond line' },
    { start: 3601.001, end: 3612.999, text: 'Chorus again' },
  ];
  const result = M.parseSrt(M.toSrt(cues));
  assert.equal(result.length, 2);
  result.forEach((cue, i) => {
    assert.equal(cue.start, cues[i].start);
    assert.equal(cue.end, cues[i].end);
    assert.equal(cue.text, cues[i].text);
  });
  assert.equal(M.parseSrt('1\n00:00:01,000 --> 00:00:00,000\nBad').length, 0);
});

test('entry delay, text reveal and exit share deterministic frame timing', () => {
  const it = {
    ...M.item(),
    enter: 'typewriter',
    exit: 'fade',
    delay: 1,
    animDuration: 1,
  };
  assert.equal(R.motion(it, 0.5, 6).alpha, 0);
  assert.equal(R.motion(it, 1.5, 6).reveal, 0.5);
  assert.equal(R.motion(it, 3, 6).reveal, 1);
  assert.equal(R.motion(it, 6, 6).alpha, 0);
  const slide = R.motion({ ...it, enter: 'left' }, 1, 6);
  assert.equal(slide.dx, -0.2);
  assert.equal(slide.alpha, 0);
});

test('all nine translations cover the same complete key set', () => {
  const translations = context.window.MvmDesignI18n;
  assert.equal(Object.keys(translations).length, 9);
  const keys = Object.keys(translations.en).sort();
  for (const [lang, table] of Object.entries(translations)) {
    assert.deepEqual(Object.keys(table).sort(), keys, lang);
    assert.ok(
      Object.values(table).every((v) => typeof v === 'string' && v.trim()),
      lang,
    );
  }
});

test('subtitle moves preserve length and trims never invert their interval', () => {
  const cue = { id: 'chorus', start: 2, end: 5, text: 'Sing along' };
  const moved = M.retimeCue(cue, 'move', 1.25, 10);
  assert.equal(moved.start, 3.25);
  assert.equal(moved.end, 6.25);
  assert.equal(cue.start, 2, 'the drag source is immutable');
  assert.equal(M.retimeCue(cue, 'move', -99, 10).start, 0);
  assert.equal(M.retimeCue(cue, 'move', 99, 10).end, 10);
  assert.equal(M.retimeCue(cue, 'start', -99, 10).end, 5);
  assert.equal(M.retimeCue(cue, 'end', 99, 10).start, 2);
  assert.ok(M.retimeCue(cue, 'start', 99, 10).start < cue.end);
  assert.ok(M.retimeCue(cue, 'end', -99, 10).end > cue.start);
});

test('overlapping subtitle ranges occupy separate visual lanes', () => {
  const layout = M.cueLanes([
    { id: 'later', start: 5, end: 7 },
    { id: 'first', start: 1, end: 4 },
    { id: 'overlap', start: 2, end: 3 },
    { id: 'touching', start: 4, end: 5 },
  ]);
  const byId = Object.fromEntries(layout.map((c) => [c.id, c]));
  assert.notEqual(byId.first.lane, byId.overlap.lane);
  assert.equal(byId.first.lane, byId.touching.lane);
  assert.equal(byId.touching.lane, byId.later.lane);
});

test('subtitle tracks include only placed styles in first-appearance order', () => {
  const p = M.project();
  p.captionStyles = ['last', 'unused', 'first', 'middle', 'draft-only'].map(
    (id) => ({ id, name: id }),
  );
  p.captionDrafts = [
    { id: 'draft', styleId: 'draft-only', text: 'Not placed' },
  ];
  p.captions = [
    { id: 'late', styleId: 'last', start: 8, end: 10 },
    { id: 'middle', styleId: 'middle', start: 4, end: 7 },
    { id: 'first', styleId: 'first', start: 1, end: 3 },
    { id: 'overlap', styleId: 'first', start: 2, end: 4 },
    { id: 'repeat', styleId: 'first', start: 9, end: 10 },
  ];
  const before = JSON.stringify(p),
    tracks = M.captionTracks(p);
  assert.equal(tracks.map((t) => t.styleId).join(','), 'first,middle,last');
  assert.equal(tracks[0].cues.map((c) => c.lane).join(','), '0,1,0');
  assert.equal(JSON.stringify(p), before);
  p.captions.push(
    { id: 'global', start: 0, end: 1 },
    { id: 'missing', styleId: 'deleted', start: 5, end: 6 },
  );
  const fallback = M.captionTracks(p)[0];
  assert.equal(fallback.styleId, '');
  assert.equal(fallback.cues.length, 2);
  p.captions = [];
  assert.equal(M.captionTracks(p).length, 0);
});

test('subtitle effects and adjusted timing survive project files, including older files', () => {
  const p = M.project();
  p.captions.push({ id: 'cue', start: 1.235, end: 4.567, text: 'A lyric' });
  Object.assign(p.captionStyle, {
    preset: 'glow',
    enter: 'up',
    exit: 'fade',
    animDuration: 0.45,
  });
  const result = M.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(result.captionStyle.preset, 'glow');
  assert.equal(result.captionStyle.enter, 'up');
  assert.equal(result.captionStyle.exit, 'fade');
  assert.equal(result.captionStyle.animDuration, 0.45);
  assert.equal(result.captions[0].start, 1.235);
  assert.equal(result.captions[0].end, 4.567);
  delete p.captionStyle.enter;
  delete p.captionStyle.exit;
  delete p.captionStyle.animDuration;
  const older = M.normalize(p);
  assert.equal(older.captionStyle.enter, 'none');
  assert.equal(older.captionStyle.exit, 'none');
  assert.equal(older.captionStyle.animDuration, 0.3);
});

test('subtitle library and partial overrides survive saving and retain shared inheritance', () => {
  const p = M.project();
  p.captionStyle.color = '#eeccbb';
  p.captionDrafts = [
    { id: 'draft', text: 'Place me later', style: { enter: 'left' } },
  ];
  p.captions = [
    {
      id: 'c',
      start: 1,
      end: 4,
      text: 'Custom',
      style: { x: 0.3, color: '#123456', font: 'Example font', strokeWidth: 9 },
    },
  ];
  const restored = M.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.captionDrafts.length, 1);
  assert.equal(restored.captions.length, 1);
  assert.equal(restored.captionDrafts[0].style.enter, 'left');
  const c = restored.captions[0];
  assert.equal(M.captionStyle(restored, c).color, '#123456');
  assert.equal(M.captionStyle(restored, c).strokeWidth, 9);
  restored.captionStyle.size = 0.08;
  assert.equal(M.captionStyle(restored, c).size, 0.08);
  assert.equal(Object.hasOwn(c.style, 'size'), false);
  delete c.style.color;
  assert.equal(M.captionStyle(restored, c).color, '#eeccbb');
  const old = M.normalize({
    ...p,
    captionStyle: { y: 0.83 },
    captionDrafts: undefined,
  });
  assert.equal(M.captionBox(old, old.captions[0]).w, 0.88);
  assert.equal(old.captionDrafts.length, 0);
});

test('alignment snaps edges, centers and equal spacing with visible guide geometry', () => {
  let result = M.snapBox({ x: 0.397, y: 0.2, w: 0.2, h: 0.1 }, [], {
    x: 0.01,
    y: 0.01,
  });
  assert.equal(result.box.x, 0.4);
  assert.ok(result.guides.some((g) => g.axis === 'x' && g.value === 0.5));
  const neighbors = [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.2 },
    { x: 0.6, y: 0.1, w: 0.1, h: 0.2 },
  ];
  result = M.snapBox({ x: 0.302, y: 0.1, w: 0.2, h: 0.2 }, neighbors, {
    x: 0.01,
    y: 0.01,
  });
  assert.ok(Math.abs(result.box.x - 0.3) < 1e-8);
  assert.ok(result.guides.some((g) => g.axis === 'x' && g.gaps?.length === 2));
  result = M.snapBox(
    { x: 0.178, y: 0.4, w: 0.1, h: 0.2 },
    [{ x: 0.18, y: 0.7, w: 0.2, h: 0.1 }],
    { x: 0.01, y: 0.01 },
  );
  assert.ok(Math.abs(result.box.x - 0.18) < 1e-8);
});

test('an unfinished click timing interval retains its library link through save and undo snapshots', () => {
  const p = M.project();
  p.captions = [
    { id: 'cue', start: 1, end: 4, text: 'Open subtitle', timingKey: 'link' },
  ];
  p.captionDrafts = [{ id: 'row', text: 'Open subtitle', timingKey: 'link' }];
  const restored = M.normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.captions[0].timingKey, 'link');
  assert.equal(restored.captionDrafts[0].timingKey, 'link');
  p.captionDrafts = [];
  assert.equal(M.normalize(p).captions[0].timingKey, undefined);
});

test('decorative glyph effects persist for pages and captions without overriding layout or font', () => {
  const p = M.project(),
    it = M.item();
  it.font = 'Lobster';
  it.x = 0.25;
  it.enter = 'words';
  p.pages[0].items.push(it);
  for (const key of M.textStyles) {
    const preset = M.textPreset(key);
    Object.assign(it, preset);
    Object.assign(p.captionStyle, preset, { preset: 'custom' });
    p.captions = [
      {
        id: 'one',
        start: 0,
        end: 2,
        text: 'A caption',
        style: { effect: 'neon', color2: '#22ccff', effectAmount: 0.75 },
      },
      { id: 'two', start: 2, end: 4, text: 'Inherited' },
    ];
    const restored = M.normalize(M.clone(p));
    assert.equal(restored.pages[0].items[0].effect, preset.effect);
    assert.equal(restored.pages[0].items[0].font, 'Lobster');
    assert.equal(restored.pages[0].items[0].x, 0.25);
    assert.equal(restored.pages[0].items[0].enter, 'words');
    assert.equal(restored.captionStyle.textStyle, key);
    assert.equal(M.captionStyle(restored, restored.captions[0]).effect, 'neon');
    assert.equal(
      M.captionStyle(restored, restored.captions[1]).effect,
      preset.effect,
    );
  }
  const invalid = M.cleanCaptionStyle(
    { effect: 'arbitrary', effectAmount: 5 },
    true,
  );
  assert.equal(invalid.effect, 'none');
  assert.equal(invalid.effectAmount, 1);
});

test('saved subtitle styles persist as references with local overrides and fixed overlapping positions', () => {
  const p = M.project();
  p.captionStyles = [
    {
      id: 'line1',
      name: 'First line',
      style: { ...p.captionStyle, y: 0.1, color: '#33ccff', enter: 'pop' },
    },
  ];
  p.captions = [
    { id: 'one', text: 'First', start: 0, end: 4, styleId: 'line1', style: {} },
    {
      id: 'two',
      text: 'Repeat',
      start: 4,
      end: 8,
      styleId: 'line1',
      style: { color: '#ff2266' },
    },
  ];
  p.captionDrafts = [
    { id: 'pending', text: 'Next', styleId: 'line1', style: {} },
  ];
  assert.equal(M.captionStyle(p, p.captions[0]).color, '#33ccff');
  assert.equal(M.captionStyle(p, p.captions[1]).color, '#ff2266');
  p.captionStyles[0].style.y = 0.3;
  assert.equal(M.captionBox(p, p.captions[0], 2).y, 0.3);
  const saved = M.normalize(M.clone(p));
  assert.equal(saved.captionStyles[0].name, 'First line');
  assert.equal(saved.captions[0].styleId, 'line1');
  assert.equal(saved.captionDrafts[0].styleId, 'line1');
  assert.equal(M.captionStyle(saved, saved.captions[0]).enter, 'pop');
  assert.equal(M.captionStyle(saved, saved.captions[1]).color, '#ff2266');
});

test('batch rules select every fourth subtitle in explicit chronological and library order', () => {
  const p = M.project();
  p.captions = Array.from({ length: 8 }, (_, i) => ({
    id: 'c' + i,
    start: i,
    end: i + 1,
    text: String(i),
  })).reverse();
  p.captionDrafts = [
    { id: 'active', text: 'Linked', timingKey: 'active' },
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'd' + i, text: String(i) })),
  ];
  p.captions[0].timingKey = 'active';
  const all = M.captionTargets(p);
  assert.equal(all.length, 12);
  for (const offset of [1, 2, 3, 4])
    assert.deepEqual(
      Array.from(M.captionPattern(all, offset, 4), (t) => t.cue.id),
      ['c' + (offset - 1), 'c' + (offset + 3), 'd' + (offset - 1)],
    );
  assert.equal(M.captionTargets(p, 'drafts').length, 4);
  assert.equal(M.captionTargets(p, 'placed').length, 8);
  assert.deepEqual(
    Array.from(M.captionPattern(all, 2, 4, 7), (t) => t.cue.id),
    ['c1', 'c5'],
  );
});

test('older projects load without saved subtitle styles and invalid references fall back safely', () => {
  const p = M.project();
  delete p.captionStyles;
  p.captions = [
    {
      text: 'Old caption',
      start: 0,
      end: 1,
      styleId: 'missing',
      style: { color: '#ff0000' },
    },
  ];
  const saved = M.normalize(p);
  assert.equal(saved.captionStyles.length, 0);
  assert.equal(saved.captions[0].styleId, undefined);
  assert.equal(M.captionStyle(saved, saved.captions[0]).color, '#ff0000');
});


test('resize snaps page edges softly without moving the anchored corner', () => {
  const box = { x: 0.13, y: 0.21, w: 0.865, h: 0.795 };
  const result = M.snapResizeBox(box, { x: 0.01, y: 0.01 });
  assert.equal(result.box.x, box.x);
  assert.equal(result.box.y, box.y);
  assert.equal(result.box.x + result.box.w, 1);
  assert.equal(result.box.y + result.box.h, 1);
  assert.equal(result.guides.length, 2);
  assert.equal(box.w, 0.865);
  const beyond = M.snapResizeBox({ x: 0, y: 0, w: 1.03, h: 0.96 }, { x: 0.01, y: 0.01 });
  assert.equal(beyond.box.w, 1.03);
  assert.equal(beyond.box.h, 0.96);
  assert.equal(beyond.guides.length, 0);
  const negative = M.snapResizeBox({ x: -0.2, y: -0.1, w: 0.195, h: 0.105 }, { x: 0.01, y: 0.01 });
  assert.equal(negative.box.x + negative.box.w, 0);
  assert.equal(negative.box.y + negative.box.h, 0);
  const minimum = M.snapResizeBox({x: 0.995, y: 0.995, w: 0.02, h: 0.02}, {x: 0.03, y: 0.03});
  assert.equal(minimum.box.w, 0.02);
  assert.equal(minimum.box.h, 0.02);
  assert.equal(minimum.guides.length, 0);
});
