// Run with Playwright installed: node tests/timeline.browser.cjs.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH optionally select an existing local installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const app = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.stack));
    page.on('dialog', (d) => d.accept());
    await page.route('https://design.test/**', async (route) => {
      const url = new URL(route.request().url()),
        name = url.pathname;
      if (name.startsWith('/apps/mvmdesign/'))
        return route.fulfill({
          path: path.join(app, 'public', name.slice('/apps/mvmdesign/'.length)),
          contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
      if (name === '/api/auth/whoami')
        return route.fulfill({ json: { effective_user: 'fixture' } });
      if (name === '/pub/mvmfonts/client.js')
        return route.fulfill({
          contentType: 'text/javascript',
          body: 'window.MvmFontsClient={families:[],load:async()=>[],ready:async()=>{},has:()=>false};',
        });
      if (name === '/')
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}:root{--bg:#f5f6fa;--surface:#fff;--text:#202635;--border:#c9cdd8;--accent:#6352d8;--on-accent:#fff}</style><link rel="stylesheet" href="/apps/mvmdesign/design.css"><div id="root" style="height:100%"></div><script>window.asset=s=>s;window.mvmOS={lang:'en'};</script>${['i18n', 'model', 'render', 'export', 'editor'].map((file) => `<script src="/apps/mvmdesign/${file}.js"></script>`).join('')}<script>window.editor=new MvmDesign.Editor(document.querySelector('#root'))</script>`,
        });
      throw Error('Unexpected fixture request ' + name);
    });
    await page.goto('https://design.test/');
    await page.waitForFunction(() => window.editor?.db);
    await page.evaluate(async () => {
      const buffer = new ArrayBuffer(44 + 48000 * 2 * 12),
        v = new DataView(buffer),
        txt = (offset, text) => {
          for (let i = 0; i < text.length; i++)
            v.setUint8(offset + i, text.charCodeAt(i));
        };
      txt(0, 'RIFF');
      v.setUint32(4, buffer.byteLength - 8, true);
      txt(8, 'WAVE');
      txt(12, 'fmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, 48000, true);
      v.setUint32(28, 96000, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      txt(36, 'data');
      v.setUint32(40, buffer.byteLength - 44, true);
      for (let i = 0; i < 48000 * 12; i++)
        v.setInt16(
          44 + i * 2,
          Math.sin((i * 2 * Math.PI * 440) / 48000) *
            2000 *
            (0.15 + 0.85 * Math.abs(Math.sin((i / 48000) * 2))),
          true,
        );
      await editor.importFiles([
        new File([buffer], 'fixture.wav', { type: 'audio/wav' }),
      ]);
      editor.p.captions = [
        { id: 'a', start: 1, end: 3, text: 'First lyric' },
        { id: 'b', start: 4, end: 6, text: 'Second lyric' },
        { id: 'overlap', start: 4.5, end: 5.5, text: 'Harmony' },
      ];
      editor.mode = 'subtitles';
      editor.renderPanels();
      editor.draw();
    });
    const range = (id) =>
      page.evaluate(
        (id) => ({ ...editor.p.captions.find((c) => c.id === id) }),
        id,
      );
    const scale = () => page.evaluate(() => editor.timelineScale);
    const drag = async (id, edge, seconds, bypassSnap = true) => {
      const block = page.locator(`[data-cue-block="${id}"]`),
        box = await block.boundingBox();
      const x =
          edge === 'start'
            ? box.x + 3
            : edge === 'end'
              ? box.x + box.width - 3
              : box.x + box.width / 2,
        y = box.y + 15;
      if (bypassSnap) await page.keyboard.down('Alt');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + seconds * (await scale()), y, { steps: 8 });
      await page.mouse.up();
      if (bypassSnap) await page.keyboard.up('Alt');
    };
    assert.notEqual(
      await page.locator('[data-cue-block=b]').evaluate((el) => el.style.top),
      await page
        .locator('[data-cue-block=overlap]')
        .evaluate((el) => el.style.top),
    );
    const beforeUndo = await page.evaluate(() => editor.undo.length);
    await drag('a', 'move', 1);
    let cue = await range('a');
    assert.ok(Math.abs(cue.start - 2) < 0.02);
    assert.ok(Math.abs(cue.end - 4) < 0.02);
    assert.equal(await page.evaluate(() => editor.undo.length), beforeUndo + 1);
    await drag('a', 'end', -0.5);
    cue = await range('a');
    assert.ok(Math.abs(cue.end - 3.5) < 0.02);
    assert.ok(Math.abs(cue.start - 2) < 0.02);
    await drag('a', 'start', 0.25);
    cue = await range('a');
    assert.ok(Math.abs(cue.start - 2.25) < 0.02);
    assert.ok(Math.abs(cue.end - 3.5) < 0.02);
    await page.locator('[data-action=undo]').click();
    assert.ok(Math.abs((await range('a')).start - 2) < 0.02);
    await page.locator('[data-action=redo]').click();
    assert.ok(Math.abs((await range('a')).start - 2.25) < 0.02);
    // A canceled gesture restores its source and never creates an undo entry.
    const original = await range('a'),
      count = await page.evaluate(() => editor.undo.length);
    const box = await page.locator('[data-cue-block=a]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 25, box.y + 15, { steps: 3 });
    await page.evaluate(() => {
      editor.timeline.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: editor.cueDrag.pointerId,
          bubbles: true,
        }),
      );
    });
    await page.mouse.up();
    assert.deepEqual(await range('a'), original);
    assert.equal(await page.evaluate(() => editor.undo.length), count);
    await page.evaluate(() => {
      editor.selectCue('a');
      editor.seek(2.6);
    });
    assert.ok(
      await page
        .locator('[data-cue-block=a]')
        .evaluate((el) => el.classList.contains('md-active')),
    );
    const ruler = await page.locator('.md-time-ticks').boundingBox(),
      pps = await scale();
    await page.mouse.click(ruler.x + 7 * pps, ruler.y + 10);
    assert.ok(Math.abs((await page.evaluate(() => editor.time)) - 7) < 0.03);
    // Precision controls stay available alongside direct manipulation.
    await page.evaluate(() => editor.selectCue('a'));
    await page.locator('[data-inspector-tab=content]').click();
    await page.locator('[data-prop="cue:a:start"]').fill('2.123');
    await page.locator('[data-prop="cue:a:start"]').dispatchEvent('change');
    assert.equal((await range('a')).start, 2.123);
    await page.locator('[data-cue-block=a] [data-edge=end]').focus();
    const end = (await range('a')).end;
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await range('a')).end - end - 0.01) < 1e-6);
    const tab = (key) => page.locator(`[data-inspector-tab=${key}]`).click();
    await tab('style');
    await page.locator('[data-prop="caption:preset"]').selectOption('glow');
    await tab('animation');
    await page.locator('[data-animation-picker="caption:enter"]').click();
    await page.locator('[data-animation-value=up]').click();
    await page.locator('[data-animation-picker="caption:exit"]').click();
    await page.locator('[data-animation-value=fade]').click();
    const saved = await page.evaluate(() => {
      const p = MvmDesignModel.normalize(JSON.parse(JSON.stringify(editor.p)));
      return { style: p.captionStyle, start: p.captions[0].start };
    });
    assert.equal(saved.style.preset, 'glow');
    assert.equal(saved.style.enter, 'up');
    assert.equal(saved.style.exit, 'fade');
    assert.equal(saved.start, 2.123);
    await page.evaluate(async () => {
      editor.p.captions[0].start = 1;
      editor.p.captions[0].end = 1.35;
      editor.selectCue('a');
      await editor.playSelectedCue();
    });
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => editor.playing), false);
    assert.ok(Math.abs((await page.evaluate(() => editor.time)) - 1.35) < 0.02);
    await page.evaluate(async () => {
      editor.seek(4.8);
      await editor.play();
    });
    await page.waitForTimeout(80);
    assert.ok(
      await page
        .locator('[data-cue-block=b]')
        .evaluate((el) => el.classList.contains('md-active')),
    );
    assert.ok(
      await page
        .locator('[data-cue-block=overlap]')
        .evaluate((el) => el.classList.contains('md-active')),
    );
    await page.evaluate(() => editor.pause());
    // Editing during playback pauses for the gesture and resumes with the adjusted range.
    await page.evaluate(async () => {
      editor.seek(4.8);
      await editor.play();
    });
    await drag('b', 'start', 0.15);
    await page.waitForFunction(() => editor.playing);
    await page.evaluate(() => editor.pause());
    // A nearby edge snaps precisely to the following cue, unless Alt is held.
    const moving = await range('a'),
      target = await range('b');
    await drag('a', 'move', target.start - moving.end - 0.03, false);
    assert.ok(Math.abs((await range('a')).end - target.start) < 0.002);
    await page.locator('[data-action=undo]').click();
    // Frames use the same animated captions that are supplied to the video exporter.
    const changedPixels = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext('2d');
      MvmDesignRender.video(ctx, editor.p, 1, 640, 360);
      const a = ctx.getImageData(0, 0, 640, 360).data;
      MvmDesignRender.video(ctx, editor.p, 1.18, 640, 360);
      const b = ctx.getImageData(0, 0, 640, 360).data;
      return a.reduce((sum, v, i) => sum + (v !== b[i] ? 1 : 0), 0);
    });
    assert.ok(changedPixels > 50);
    // Plain subtitle text stays off the timeline until explicitly placed.
    const timedCount = await page.evaluate(() => editor.p.captions.length);
    await page.locator('[data-action=paste-lyrics]').click();
    await page
      .locator('[data-lyrics]')
      .fill('First segment\nSecond segment\nThird segment');
    await page.locator('[data-apply]').click();
    assert.equal(
      await page.evaluate(() => editor.p.captions.length),
      timedCount,
    );
    assert.equal(await page.locator('[data-draft]').count(), 3);
    // Library rows contain only a left drag handle and a placement button.
    assert.equal(await page.locator('[data-draft] textarea').count(), 0);
    assert.equal(await page.locator('[data-draft] button').count(), 3);
    const row = page.locator('[data-draft]').first();
    assert.ok((await row.boundingBox()).height < 55);
    await row.locator('button').click({ button: 'right' });
    assert.equal(
      await page.locator('.md-draft-menu [role=menuitem]').count(),
      2,
    );
    assert.equal(
      await page.evaluate(() => editor.p.captions.length),
      timedCount,
    );
    await page.locator('[data-action^="draft-edit-"]').click();
    await page.locator('[data-draft-text]').fill('Edited segment');
    await page.locator('[data-apply]').click();
    assert.equal(await row.locator('button').innerText(), 'Edited segment');
    await row.locator('button').click({ button: 'right' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.md-draft-menu').count(), 0);
    // Keyboard context menu, cancel editing and deletion with undo.
    await row.locator('button').focus();
    await page.keyboard.press('Shift+F10');
    await page.locator('[data-action^="draft-edit-"]').click();
    await page.locator('[data-draft-text]').fill('Canceled edit');
    await page.locator('[data-cancel]').click();
    assert.equal(await row.locator('button').innerText(), 'Edited segment');
    await row.locator('button').click({ button: 'right' });
    await page.locator('[data-action^="draft-delete-"]').click();
    assert.equal(await page.locator('[data-draft]').count(), 2);
    await page.locator('[data-action=undo]').click();
    assert.equal(await page.locator('[data-draft]').count(), 3);
    // Two clicks capture an interval without interrupting music or consuming the row early.
    await page.evaluate(async () => {
      window.beforeClickTiming = MvmDesignModel.clone(editor.p);
      editor.seek(1);
      await editor.play();
    });
    await page.locator('[data-draft] .md-draft-text').first().click();
    const liveStart = await page.evaluate(() => ({
      id: editor.clickCue.id,
      start: editor.clickCue.start,
    }));
    assert.equal(
      await page.evaluate(() => editor.playing && !editor.audio.paused),
      true,
    );
    assert.equal(await page.locator('[data-draft]').count(), 3);
    assert.equal(
      await page
        .locator('[data-draft] .md-draft-text')
        .first()
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.waitForTimeout(3300);
    const stillOpen = await page.evaluate(() => ({
      time: editor.time,
      start: editor.clickCue.start,
      end: editor.clickCue.end,
      playing: editor.playing && !editor.audio.paused,
      persisted: MvmDesignModel.normalize(MvmDesignModel.clone(editor.p)),
    }));
    assert.equal(stillOpen.playing, true);
    assert.ok(stillOpen.time - liveStart.start > 3.1);
    assert.ok(stillOpen.end > stillOpen.time);
    assert.ok(stillOpen.persisted.captions.some((c) => c.timingKey));
    assert.ok(stillOpen.persisted.captionDrafts.some((d) => d.timingKey));
    // A real click spans several playback frames; the pause icon must remain clickable.
    await page.locator('[data-scrub]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => editor.playing), false);
    assert.equal(await page.evaluate(() => editor.audio.paused), true);
    const pausedTime = await page.evaluate(() => editor.time);
    await page.waitForTimeout(160);
    assert.equal(await page.evaluate(() => editor.time), pausedTime);
    assert.equal(await page.evaluate(() => !!editor.clickCue), true);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => editor.playing && !editor.audio.paused);

    await page.locator('[data-draft] .md-draft-text').first().click();
    const closed = await page.evaluate(
      (id) => ({
        cue: editor.p.captions.find((c) => c.id === id),
        time: editor.time,
        playing: editor.playing && !editor.audio.paused,
        open: !!editor.clickCue,
      }),
      liveStart.id,
    );
    assert.equal(closed.playing, true);
    assert.equal(closed.open, false);
    assert.ok(
      Math.abs(closed.cue.end - closed.time) < 0.1,
      JSON.stringify(closed),
    );
    assert.ok(closed.cue.end - closed.cue.start > 3.1);
    assert.equal(await page.locator('[data-draft]').count(), 2);
    // Starting another row closes the previous interval at the same timestamp.
    await page.locator('[data-draft] .md-draft-text').first().click();
    const switchingId = await page.evaluate(() => editor.clickCue.id);
    await page.waitForTimeout(120);
    await page.locator('[data-draft] .md-draft-text').nth(1).click();
    const switchTimes = await page.evaluate(
      (id) => ({
        end: editor.p.captions.find((c) => c.id === id).end,
        start: editor.clickCue.start,
        playing: editor.playing,
      }),
      switchingId,
    );
    assert.equal(switchTimes.end, switchTimes.start);
    assert.equal(switchTimes.playing, true);
    await page.evaluate(() => editor.seek(11.9));
    await page.waitForFunction(() => !editor.playing);
    assert.equal(await page.evaluate(() => !!editor.clickCue), false);
    assert.equal(await page.locator('[data-draft]').count(), 0);
    await page.evaluate(() => {
      editor.p = beforeClickTiming;
      editor.seek(0);
      editor.renderPanels();
      editor.draw();
    });
    await page.evaluate(() => editor.seek(2));
    await page.locator('[data-action^="draft-place-"]').first().click();
    assert.equal(await page.evaluate(() => editor.p.captions.at(-1).start), 2);
    assert.equal(await page.locator('[data-draft]').count(), 3);
    await page.evaluate(() => editor.seek(3));
    await page.locator('[data-action^="draft-place-"]').first().click();
    assert.equal(await page.evaluate(() => editor.p.captions.at(-1).end), 3);
    assert.equal(await page.locator('[data-draft]').count(), 2);
    // Native drag/drop reads a precise drop position on the same time scale.
    const dropX = await page.evaluate(() => editor.timelineScale * 6);
    await page
      .locator('.md-draft-grip')
      .first()
      .dragTo(page.locator('.md-time-ticks'), {
        targetPosition: { x: dropX, y: 10 },
      });
    const dropped = await page.evaluate(() => editor.p.captions.at(-1));
    assert.ok(Math.abs(dropped.start - 6) < 0.01);
    assert.equal(await page.locator('[data-draft]').count(), 1);
    await page.evaluate(() => {
      editor.selectCue(editor.p.captions.at(-1).id, true);
      editor.renderInspector();
    });
    await page.locator('[data-prop=styleScope]').selectOption('individual');
    await tab('style');
    await page.locator('[data-prop="cueStyle:color"]').fill('#ff2244');
    await page.locator('[data-prop="cueStyle:color"]').dispatchEvent('change');
    await tab('animation');
    await page.locator('[data-animation-picker="cueStyle:enter"]').click();
    await page.locator('[data-animation-value=left]').click();
    let own = await page.evaluate(
      () => editor.p.captions.find((c) => c.id === editor.cueId).style,
    );
    assert.equal(own.color, '#ff2244');
    assert.equal(own.enter, 'left');
    assert.equal(Object.hasOwn(own, 'size'), false);
    await tab('style');
    assert.equal(
      await page.locator('[data-prop="override:color"]').isChecked(),
      true,
    );
    // Subtitle position is directly draggable on the preview canvas.
    const dragPreview = async (dx, dy) => {
      const b = await page.evaluate(() => {
        const active = editor.p.captions.filter(
            (c) => editor.time >= c.start && editor.time < c.end,
          ),
          cue = active.find((c) => c.id === editor.cueId);
        const box = MvmDesignModel.captionBox(
            editor.p,
            cue,
            active.indexOf(cue),
          ),
          rect = editor.canvas.getBoundingClientRect();
        return {
          x: rect.x + (box.x + box.w / 2) * rect.width,
          y: rect.y + (box.y + box.h / 2) * rect.height,
          w: rect.width,
          h: rect.height,
        };
      });
      await page.keyboard.down('Alt');
      await page.mouse.move(b.x, b.y);
      await page.mouse.down();
      await page.mouse.move(b.x + dx * b.w, b.y + dy * b.h, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
    };
    const globalY = await page.evaluate(() => editor.p.captionStyle.y);
    await dragPreview(0, -0.2);
    own = await page.evaluate(
      () => editor.p.captions.find((c) => c.id === editor.cueId).style,
    );
    assert.ok(Math.abs(own.y - (globalY - 0.2)) < 0.015);
    assert.equal(await page.evaluate(() => editor.p.captionStyle.y), globalY);
    // Shared properties remain live; disabling a single override preserves the others.
    await page.locator('[data-prop="override:color"]').uncheck();
    own = await page.evaluate(
      () => editor.p.captions.find((c) => c.id === editor.cueId).style,
    );
    assert.equal(Object.hasOwn(own, 'color'), false);
    assert.equal(own.enter, 'left');
    await tab('position');
    await page.locator('[data-prop="override:x"]').uncheck();
    await page.locator('[data-prop="override:y"]').uncheck();
    await page.locator('[data-prop=styleScope]').selectOption('global');
    await dragPreview(0, -0.1);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => editor.p.captionStyle.y)) - (globalY - 0.1),
      ) < 0.02,
    );
    // Returning a segment to the library retains its text and personal appearance.
    await tab('content');
    await page.locator('[data-action=cue-unplace]').click();
    assert.equal(await page.locator('[data-draft]').count(), 2);
    assert.equal(
      await page.evaluate(() => editor.p.captionDrafts.at(-1).style.enter),
      'left',
    );
    const restored = await page.evaluate(() =>
      MvmDesignModel.normalize(JSON.parse(JSON.stringify(editor.p))),
    );
    assert.equal(restored.captionDrafts.length, 2);
    assert.equal(restored.captionDrafts.at(-1).style.enter, 'left');
    // Standard toolbar controls are accessible icons.
    assert.equal(await page.locator('[data-action=rect] svg').count(), 1);
    assert.equal(
      await page.locator('[data-action=rect]').getAttribute('aria-label'),
      'Rectangle',
    );
    assert.equal(await page.locator('[data-action=play] svg').count(), 1);
    // Dragging design elements shows center alignment guides and supports cancellation.
    await page.evaluate(() => {
      editor.mode = 'design';
      const it = MvmDesignModel.item('shape');
      it.w = 0.2;
      it.h = 0.2;
      it.x = 0.2;
      it.y = 0.2;
      editor.pg.items.push(it);
      editor.itemId = it.id;
      editor.renderPanels();
      editor.draw();
    });
    const designBox = await page.locator('.md-canvas').boundingBox();
    await page.mouse.move(
      designBox.x + designBox.width * 0.3,
      designBox.y + designBox.height * 0.3,
    );
    await page.mouse.down();
    await page.mouse.move(
      designBox.x + designBox.width * 0.5,
      designBox.y + designBox.height * 0.5,
      { steps: 6 },
    );
    assert.ok(
      await page.evaluate(() =>
        editor.guides.some((g) => g.axis === 'x' && g.value === 0.5),
      ),
    );
    await page.mouse.up();
    assert.ok(Math.abs((await page.evaluate(() => editor.it.x)) - 0.4) < 1e-8);
    await page.evaluate(() => {
      editor.mode = 'subtitles';
      editor.renderPanels();
      editor.seek(4.8);
    });
    // The transport also remains available during guided subtitle timing.
    await page.evaluate(async () => {
      await editor.startTiming('captions');
    });
    const timingMarks = await page.evaluate(() => [...editor.recording.marks]);
    await page.locator('[data-action=play]').click({ delay: 120 });
    assert.equal(await page.evaluate(() => editor.playing), false);
    assert.equal(await page.evaluate(() => editor.audio.paused), true);
    assert.deepEqual(
      await page.evaluate(() => editor.recording.marks),
      timingMarks,
    );
    await page.locator('[data-action=play]').click({ delay: 120 });
    await page.waitForFunction(() => editor.playing && !editor.audio.paused);
    assert.deepEqual(
      await page.evaluate(() => editor.recording.marks),
      timingMarks,
    );
    await page.evaluate(() => editor.cancelTiming());
    // Timing library segments retains existing cues and leaves unused drafts untouched.
    await page.evaluate(async () => {
      const original = MvmDesignModel.clone(editor.p),
        count = original.captions.length;
      await editor.startTiming('captions');
      editor.seek(1);
      editor.finishTiming();
      if (
        editor.p.captions.length !== count + 1 ||
        editor.p.captionDrafts.length !== original.captionDrafts.length - 1
      )
        throw Error('Timing pass discarded existing cues or unused drafts');
      editor.p = original;
      editor.setAudio();
      editor.renderPanels();
      const before = JSON.stringify(editor.p);
      await editor.startTiming('captions');
      editor.cancelTiming();
      if (JSON.stringify(editor.p) !== before)
        throw Error('Timing cancellation changed the project');
      editor.renderPanels();
    });
    // Five saved styles, three used: each used style has a named time-aligned track.
    await page.evaluate(() => {
      const M = MvmDesignModel;
      editor.p.captionStyles = [
        'Third row',
        'Unused',
        'First row',
        'Second row',
        'Library only',
      ].map((name, i) => ({
        id: 'track-style-' + i,
        name,
        style: M.clone(editor.p.captionStyle),
      }));
      editor.p.captionDrafts = [
        { id: 'library-only', text: 'Pending', styleId: 'track-style-4' },
      ];
      editor.p.captions = [
        {
          id: 'track-third',
          text: 'Third row appears later',
          start: 7,
          end: 10,
          styleId: 'track-style-0',
        },
        {
          id: 'track-second',
          text: 'Second row',
          start: 4,
          end: 7,
          styleId: 'track-style-3',
        },
        {
          id: 'track-first',
          text: 'First row',
          start: 1,
          end: 4,
          styleId: 'track-style-2',
        },
        {
          id: 'track-overlap',
          text: 'Same style, overlapping cue',
          start: 2,
          end: 3,
          styleId: 'track-style-2',
        },
      ];
      editor.renderPanels();
    });
    const trackNames = () =>
      page.locator('.md-caption-track-heading span').allTextContents();
    assert.deepEqual(await trackNames(), [
      'First row',
      'Second row',
      'Third row',
    ]);
    assert.equal(
      await page
        .locator('[data-caption-track="track-style-2"] [data-cue-block]')
        .count(),
      2,
    );
    assert.notEqual(
      await page
        .locator('[data-cue-block="track-first"]')
        .evaluate((el) => el.style.top),
      await page
        .locator('[data-cue-block="track-overlap"]')
        .evaluate((el) => el.style.top),
    );
    await page
      .locator('[data-cue-block="track-third"]')
      .scrollIntoViewIfNeeded();
    await drag('track-third', null, -6.5);
    assert.deepEqual(await trackNames(), [
      'Third row',
      'First row',
      'Second row',
    ]);
    assert.equal((await range('track-third')).styleId, 'track-style-0');
    await page.evaluate(() => editor.action('undo'));
    assert.deepEqual(await trackNames(), [
      'First row',
      'Second row',
      'Third row',
    ]);
    await page.evaluate(() =>
      editor.commit(() => {
        editor.p.captions.find((c) => c.id === 'track-third').styleId =
          'track-style-3';
      }),
    );
    assert.deepEqual(await trackNames(), ['First row', 'Second row']);
    assert.equal(
      await page
        .locator('[data-caption-track="track-style-3"] [data-cue-block]')
        .count(),
      2,
    );
    await page.evaluate(() => editor.action('undo'));
    await page.evaluate(() => editor.seek(2.5));
    assert.equal(
      await page
        .locator('[data-caption-track="track-style-2"] .md-cue-block.md-active')
        .count(),
      2,
    );
    await page.evaluate(async () => {
      await editor.installProject(
        MvmDesignModel.normalize(JSON.parse(JSON.stringify(editor.p))),
      );
      editor.mode = 'subtitles';
      editor.renderPanels();
    });
    assert.deepEqual(await trackNames(), [
      'First row',
      'Second row',
      'Third row',
    ]);
    // Scrolling tracks keeps the ruler and its current-position marker usable.
    await page.evaluate(() => {
      editor.pps = 150;
      editor.renderTimeline();
      editor.timeline.scrollTop = editor.timeline.scrollHeight;
      editor.timeline.scrollLeft = 250;
    });
    const stickyRuler = page.locator('.md-time-ticks');
    const rulerBounds = await stickyRuler.boundingBox();
    const timelineBounds = await page.locator('.md-timeline').boundingBox();
    assert.ok(Math.abs(rulerBounds.y - timelineBounds.y) < 2);
    const seekX = await page.evaluate(
      () =>
        editor.track.getBoundingClientRect().left + 6 * editor.timelineScale,
    );
    await page.mouse.move(seekX - 30, rulerBounds.y + 12);
    await page.mouse.down();
    await page.mouse.move(seekX, rulerBounds.y + 12, { steps: 5 });
    await page.mouse.up();
    assert.ok(Math.abs((await page.evaluate(() => editor.time)) - 6) < 0.02);
    const markerBounds = await page.locator('.md-ruler-playhead').boundingBox();
    assert.ok(Math.abs(markerBounds.x - seekX) < 2);
    assert.ok(markerBounds.y >= timelineBounds.y);
    assert.equal(
      await page.evaluate(() => {
        const r = editor.track
          .querySelector('.md-time-ticks')
          .getBoundingClientRect();
        return (
          document
            .elementFromPoint(
              editor.timeline.getBoundingClientRect().left + 20,
              r.y + 12,
            )
            .closest('.md-time-ticks') !== null
        );
      }),
      true,
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        if (theme === 'dark')
          for (const [k, v] of Object.entries({
            bg: '#171b29',
            surface: '#252b3b',
            text: '#edf0ff',
            border: '#515b70',
          }))
            document.documentElement.style.setProperty('--' + k, v);
        editor.seek(4.8);
        editor.renderPanels();
        editor.draw();
      }, theme);
      if (process.env.ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(
            process.env.ARTIFACT_DIR,
            'subtitle-style-tracks-' + theme + '.png',
          ),
        });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    if (process.env.ARTIFACT_DIR) {
      const encoded = await page.evaluate(async () => {
        const p = MvmDesignModel.clone(editor.p);
        p.width = 640;
        p.height = 360;
        p.sequence = p.sequence.slice(0, 1);
        p.sequence[0].duration = 1.5;
        p.captions = [
          {
            id: 'render',
            start: 0.1,
            end: 1.4,
            text: 'Animated subtitle',
            style: {
              font: 'serif',
              color: '#ffdd88',
              x: 0.1,
              y: 0.65,
              w: 0.8,
              enter: 'left',
              exit: 'fade',
            },
          },
        ];
        const result = await MvmDesignExport.video(p, {
          fps: 24,
          quality: 'high',
        });
        return {
          ext: result.ext,
          bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
        };
      });
      assert.ok(encoded.bytes.length > 3000);
      fs.writeFileSync(
        path.join(process.env.ARTIFACT_DIR, 'subtitle-effects.' + encoded.ext),
        Buffer.from(encoded.bytes),
      );
    }
    // Page filmstrips, four visible caption tracks and a clean fullscreen player.
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(async () => {
      const M=MvmDesignModel,p=M.project();
      p.name='Video workspace';p.audio=editor.p.audio;
      p.pages[0].items=[Object.assign(M.item('text'),{text:'SCENE ONE',size:.12})];
      const second=M.page('Scene two');second.bg='#3f262a';second.items=[Object.assign(M.item('text'),{text:'SCENE TWO',size:.12})];p.pages.push(second);
      p.sequence=[{...M.occurrence(p.pages[0].id),duration:8},{...M.occurrence(second.id),duration:2},{...M.occurrence(p.pages[0].id),duration:2}];
      p.captionStyles=Array.from({length:4},(_,i)=>({id:'row'+i,name:'Subtitle row '+(i+1),style:M.cleanCaptionStyle({...p.captionStyle,y:.1+i*.18,h:.15})}));
      p.captions=Array.from({length:8},(_,i)=>({id:'line'+i,text:'Subtitle '+(i+1),start:i<4?0:6,end:i<4?5:11,styleId:'row'+(i%4),style:{}}));
      editor.mode='subtitles';await editor.installProject(p);editor.seek(1);
      editor.timeline.scrollTop=editor.timeline.scrollLeft=0;
    });
    const layout=await page.evaluate(()=>{
      const timeline=editor.timeline.getBoundingClientRect();
      const rows=[...editor.track.querySelectorAll('.md-caption-track')].map(el=>el.getBoundingClientRect());
      const strips=[...editor.track.querySelectorAll('.md-clip-strip')].map(el=>getComputedStyle(el));
      return {visible:rows.every(r=>r.top>=timeline.top&&r.bottom<=timeline.bottom),count:rows.length,vertical:editor.timeline.scrollHeight-editor.timeline.clientHeight,
        images:strips.map(style=>style.backgroundImage),repeat:strips[0].backgroundRepeat,
        audio:editor.track.querySelector('[data-track-label=audio]').textContent};
    });
    assert.equal(layout.count,4);assert.equal(layout.visible,true,JSON.stringify(layout));
    assert.ok(layout.vertical<=1,JSON.stringify(layout));
    assert.equal(layout.audio,'Audio');assert.equal(layout.repeat,'repeat-x');
    assert.match(layout.images[0],/^url\("data:image/);
    assert.equal(layout.images[0],layout.images[2]);assert.notEqual(layout.images[0],layout.images[1]);
    const artifact=process.env.ARTIFACT_DIR||'/tmp/mvmdesign-check';fs.mkdirSync(artifact,{recursive:true});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => {
        const colors=theme==='dark'?{bg:'#171b29',surface:'#252b3b',text:'#edf0ff',border:'#515b70'}:{bg:'#f5f6fa',surface:'#fff',text:'#202635',border:'#c9cdd8'};
        for (const [key,value] of Object.entries(colors)) document.documentElement.style.setProperty('--'+key,value);
        editor.root.querySelector('.md-toast')?.remove();
        editor.draw();
      },theme);
      await page.screenshot({path:path.join(artifact,'video-workspace-'+theme+'.png')});
    }
    // Space works on timeline buttons, ignores repeats and preserves text entry.
    await page.locator('[data-action=preview-timeline]').focus();
    await page.keyboard.down('Space');
    await page.waitForFunction(()=>editor.playing);
    await page.keyboard.down('Space');
    assert.equal(await page.evaluate(()=>editor.playing),true);
    await page.keyboard.up('Space');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>editor.playing),false);
    assert.equal(await page.locator('.md-video-preview').count(),0);
    await page.locator('[data-name]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>editor.playing),false);
    await page.evaluate(()=>editor.seek(1));
    await page.locator('[data-action=preview-timeline]').click();
    await page.locator('.md-video-preview').waitFor();
    const previewBefore=await page.evaluate(()=>editor.videoPreview.canvas.toDataURL());
    await page.locator('[data-preview-play]').click();
    await page.waitForFunction(()=>editor.playing&&editor.time>1.2);
    assert.equal(await page.evaluate(()=>!editor.p.audio||!editor.audio.paused),true);
    await page.locator('[data-preview-play]').click();
    assert.equal(await page.evaluate(()=>editor.playing),false);
    await page.locator('[data-preview-seek]').fill('8.5');
    assert.equal(await page.evaluate(()=>editor.time),8.5);
    assert.notEqual(await page.evaluate(()=>editor.videoPreview.canvas.toDataURL()),previewBefore);
    await page.locator('[data-preview-seek]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>editor.playing);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>editor.playing),false);
    await page.locator('[data-preview-fullscreen]').click();
    await page.waitForFunction(()=>document.fullscreenElement===editor.videoPreview.overlay);
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>editor.playing);
    assert.equal(await page.evaluate(()=>document.fullscreenElement===editor.videoPreview.overlay),true);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>editor.playing),false);
    await page.screenshot({path:path.join(artifact,'video-preview-fullscreen.png')});
    await page.locator('[data-preview-fullscreen]').click();
    await page.waitForFunction(()=>document.fullscreenElement===null);
    await page.locator('[data-preview-close]').click();
    assert.equal(await page.locator('.md-video-preview').count(),0);
    assert.equal(await page.evaluate(()=>editor.playing),false);
    assert.equal(await page.evaluate(()=>editor.mode),'subtitles');
    // Closing preview during playback stops audio; reopening starts from the same clock.
    await page.locator('[data-action=preview]').click();
    await page.locator('[data-preview-play]').click();
    await page.waitForFunction(()=>editor.playing);
    await page.locator('[data-preview-close]').click();
    assert.equal(await page.evaluate(()=>editor.audio.paused&&!editor.playing),true);
    // Wheel navigation and paused scrubbing must move the viewport without editing timing.
    await page.evaluate(()=>{
      editor.p.sequence[0].duration=120;editor.p.audio=null;editor.setAudio();editor.pps=50;
      for(let i=4;i<10;i++) {
        editor.p.captionStyles.push({id:'extra'+i,name:'Extra track '+i,style:{...editor.p.captionStyle}});
        editor.p.captions.push({id:'extra'+i,text:'Extra caption '+i,styleId:'extra'+i,start:i,end:i+1,style:{}});
      }
      editor.renderPanels();editor.timeline.scrollTop=editor.timeline.scrollLeft=0;
    });
    let wheelBox=await page.locator('.md-timeline').boundingBox();
    const timingBefore=await page.evaluate(()=>JSON.stringify(editor.p));
    await page.mouse.move(wheelBox.x+wheelBox.width/2,wheelBox.y+80);
    await page.mouse.wheel(0,240);
    await page.waitForFunction(()=>editor.timeline.scrollLeft>100);
    assert.equal(await page.evaluate(()=>editor.timeline.scrollTop),0);
    const wheelRight=await page.evaluate(()=>editor.timeline.scrollLeft);
    await page.mouse.wheel(0,-120);
    await page.waitForFunction(x=>editor.timeline.scrollLeft<x,wheelRight);
    const beforeShift=await page.evaluate(()=>editor.timeline.scrollLeft);
    await page.keyboard.down('Shift');await page.mouse.wheel(0,180);await page.keyboard.up('Shift');
    await page.waitForFunction(()=>editor.timeline.scrollTop>100);
    assert.equal(await page.evaluate(()=>editor.timeline.scrollLeft),beforeShift);
    const verticalBefore=await page.evaluate(()=>editor.timeline.scrollTop);
    await page.locator('[data-scrub]').fill('95');
    const late=await page.evaluate(()=>{
      const x=editor.track.offsetLeft+editor.time*editor.timelineScale-editor.timeline.scrollLeft;
      return {left:editor.timeline.scrollLeft,visible:x>=0&&x<=editor.timeline.clientWidth,top:editor.timeline.scrollTop};
    });
    assert.equal(late.visible,true);assert.ok(late.left>1000);assert.equal(late.top,verticalBefore);
    await page.locator('[data-scrub]').fill('2');
    assert.ok(await page.evaluate(()=>editor.timeline.scrollLeft)<late.left);
    await page.evaluate(()=>{editor.timeline.scrollLeft=800;editor.timeline.scrollTop=0;});
    wheelBox=await page.locator('.md-timeline').boundingBox();
    const startScroll=await page.evaluate(()=>editor.timeline.scrollLeft);
    await page.mouse.move(wheelBox.x+wheelBox.width/2,wheelBox.y+10);await page.mouse.down();
    const startTime=await page.evaluate(()=>editor.time);
    await page.mouse.move(wheelBox.x+wheelBox.width-6,wheelBox.y+10,{steps:3});
    await page.waitForFunction(x=>editor.timeline.scrollLeft>x+120,startScroll);
    assert.ok(await page.evaluate(()=>editor.time)>startTime);
    const endScroll=await page.evaluate(()=>editor.timeline.scrollLeft);
    await page.mouse.move(wheelBox.x+6,wheelBox.y+10,{steps:3});
    await page.waitForFunction(x=>editor.timeline.scrollLeft<x-100,endScroll);
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>editor.rulerPointer==null&&editor.rulerScrollFrame==null),true);
    const released=await page.evaluate(()=>editor.timeline.scrollLeft);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>editor.timeline.scrollLeft),released);
    // Cancellation and project replacement also stop the animation loop.
    await page.mouse.move(wheelBox.x+wheelBox.width/2,wheelBox.y+10);await page.mouse.down();
    await page.mouse.move(wheelBox.x+wheelBox.width-4,wheelBox.y+10);
    await page.evaluate(()=>editor.timeline.dispatchEvent(new PointerEvent('pointercancel',{pointerId:editor.rulerPointer,bubbles:true})));
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>editor.rulerPointer==null&&editor.rulerScrollFrame==null),true);
    assert.equal(await page.evaluate(()=>JSON.stringify(editor.p)),timingBefore);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS style tracks, first-appearance ordering, unused-style filtering, track reassignment, subtitle drag, both trims, undo/redo, overlap lanes, seeking, precision, effects, playback, project round-trip, staging, placement, per-property inheritance, preview positioning, icons, alignment guides, repeating page filmstrips, four visible subtitle tracks, fullscreen preview, seeking and shared audio playback/cleanup, horizontal wheel navigation, Shift-wheel vertical navigation, paused slider following and bidirectional ruler auto-scroll with release/cancel cleanup.',
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
