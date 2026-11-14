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
    const click = (action) => page.locator(`[data-action="${action}"]`).click();
    const tab = (key) => page.locator(`[data-inspector-tab="${key}"]`).click();
    const prop = (key) => page.locator(`[data-prop="${key}"]`);
    const tabs = () =>
      page
        .locator('[data-inspector-tab]')
        .evaluateAll((els) => els.map((el) => el.dataset.inspectorTab));
    assert.match(
      await page.locator('.md-document-size').textContent(),
      /1920 × 1080/,
    );
    assert.deepEqual(await tabs(), ['background', 'layers']);
    await click('text');
    assert.deepEqual(await tabs(), [
      'content',
      'style',
      'position',
      'animation',
      'layers',
    ]);
    await prop('text').fill('A new canvas');
    await prop('text').dispatchEvent('change');
    await tab('style');
    assert.equal(await prop('text').isVisible(), false);
    assert.equal(await prop('color').isVisible(), true);
    await prop('color').evaluate((el) => {
      el.value = '#4488ee';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => editor.it.color), '#4488ee');
    await prop('color').dispatchEvent('change');
    assert.equal(
      await page
        .locator('[data-inspector-tab=style]')
        .getAttribute('aria-selected'),
      'true',
    );
    await tab('position');
    await prop('rotation').fill('18');
    await prop('rotation').dispatchEvent('change');
    assert.equal(await page.evaluate(() => editor.it.rotation), 18);
    // Keyboard tab navigation changes only the visible property group.
    await page.locator('[data-inspector-tab=position]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.locator('[data-animation-picker=enter]').isVisible(),
      true,
    );
    assert.equal(await prop('rotation').isVisible(), false);
    await page.locator('[data-animation-picker=enter]').click();
    await page.locator('[data-animation-value=up]').click();
    assert.equal(await page.evaluate(() => editor.it.enter), 'up');
    await click('rect');
    assert.deepEqual(await tabs(), [
      'style',
      'position',
      'animation',
      'layers',
    ]);
    await page.evaluate(async () => {
      const it = MvmDesignModel.item('image');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      it.assetId = 'fixture-image';
      editor.p.assets[it.assetId] = {
        src: canvas.toDataURL(),
        name: 'Test image',
      };
      await MvmDesignRender.prepare(editor.p);
      editor.pg.items.push(it);
      editor.itemId = it.id;
      editor.renderInspector();
    });
    assert.deepEqual(await tabs(), [
      'content',
      'style',
      'position',
      'animation',
      'layers',
    ]);
    assert.equal(await prop('fit').isVisible(), true);
    await click('mode-video');
    assert.deepEqual(await tabs(), ['sequence', 'audio']);
    await tab('audio');
    assert.equal(
      await page.locator('[data-action=audio]').last().isVisible(),
      true,
    );
    await click('mode-subtitles');
    assert.deepEqual(await tabs(), [
      'content',
      'typography',
      'style',
      'position',
      'animation',
      'onTimeline',
    ]);
    await page.evaluate(() => {
      editor.p.captions = [{ id: 'cue', text: 'Caption', start: 0, end: 4 }];
      editor.selectCue('cue');
    });
    await prop('styleScope').selectOption('individual');
    await tab('style');
    await prop('cueStyle:color').fill('#ff2244');
    await prop('cueStyle:color').dispatchEvent('change');
    await tab('animation');
    await page.locator('[data-animation-picker="cueStyle:enter"]').click();
    await page.locator('[data-animation-value=left]').click();
    await tab('position');
    await prop('cueStyle:y').fill('40');
    await prop('cueStyle:y').dispatchEvent('change');
    assert.equal(await page.evaluate(() => editor.p.captions[0].style.y), 0.4);
    assert.equal(await prop('styleScope').isVisible(), true);
    await prop('styleScope').selectOption('global');
    assert.equal(await prop('caption:y').isVisible(), true);
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.color),
      '#ff2244',
    );
    // Resizing is reversible and never changes pages, captions or object geometry.
    const original = await page.evaluate(() =>
      JSON.stringify([editor.p.pages, editor.p.captions]),
    );
    await page.locator('.md-document-size').click();
    assert.equal(await page.locator('[data-format]').count(), 22);
    await prop('formatCategory').selectOption('youtube');
    assert.equal(await page.locator('[data-format]:visible').count(), 4);
    await page.locator('[data-format="4"]').click();
    assert.equal(await prop('documentWidth').inputValue(), '2560');
    await page.locator('.md-modal [data-apply]').click();
    assert.match(
      await page.locator('.md-document-size').textContent(),
      /2560 × 1440/,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify([editor.p.pages, editor.p.captions]),
      ),
      original,
    );
    await click('undo');
    assert.match(
      await page.locator('.md-document-size').textContent(),
      /1920 × 1080/,
    );
    // New project is created only after selecting and confirming a size.
    await click('new');
    await prop('documentWidth').fill('1000');
    await page.locator('.md-modal [data-cancel]').click();
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify([editor.p.pages, editor.p.captions]),
      ),
      original,
    );
    await click('new');
    await prop('formatCategory').selectOption('print');
    await page.locator('[data-format="12"]').click();
    await prop('sizeUnit').selectOption('mm');
    assert.ok(
      Math.abs(+(await prop('documentWidth').inputValue()) - 210) < 0.1,
    );
    await prop('documentWidth').fill('210');
    await prop('documentHeight').fill('297');
    assert.match(
      await page.locator('.md-size-summary').textContent(),
      /2480 × 3508/,
    );
    await page.locator('[data-action=swap-dimensions]').click();
    assert.match(
      await page.locator('.md-size-summary').textContent(),
      /3508 × 2480/,
    );
    await prop('sizeUnit').selectOption('px');
    await prop('documentWidth').fill('7680');
    await prop('documentHeight').fill('7680');
    assert.equal(
      await page.locator('.md-modal [data-apply]').isDisabled(),
      true,
    );
    await prop('documentWidth').fill('');
    assert.equal(
      await page.locator('.md-modal [data-apply]').isDisabled(),
      true,
    );
    await prop('documentWidth').fill('1001');
    await prop('documentHeight').fill('601');
    assert.equal(
      await page.locator('.md-modal [data-apply]').isDisabled(),
      false,
    );
    await page.locator('.md-modal [data-apply]').click();
    await page.locator('.md-modal').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => editor.mode), 'design');
    assert.equal(await page.evaluate(() => editor.p.pages[0].items.length), 0);
    assert.equal(await page.evaluate(() => editor.p.captions.length), 0);
    assert.match(
      await page.locator('.md-document-size').textContent(),
      /1001 × 601/,
    );
    const size = await page.evaluate(async () => {
      const p = MvmDesignModel.normalize(MvmDesignModel.clone(editor.p));
      const blob = await MvmDesignExport.images(p, [p.pages[0]]);
      const bitmap = await createImageBitmap(blob);
      const result = [p.width, p.height, bitmap.width, bitmap.height];
      bitmap.close();
      return result;
    });
    assert.deepEqual(size, [1001, 601, 1001, 601]);
    await click('text');
    await tab('style');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        const colors =
          theme === 'dark'
            ? {
                bg: '#171b29',
                surface: '#252b3b',
                text: '#edf0ff',
                border: '#515b70',
              }
            : {
                bg: '#f5f6fa',
                surface: '#fff',
                text: '#202635',
                border: '#c9cdd8',
              };
        for (const [key, value] of Object.entries(colors))
          document.documentElement.style.setProperty('--' + key, value);
      }, theme);
      if (process.env.ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(process.env.ARTIFACT_DIR, `sidebar-${theme}.png`),
        });
      await page.locator('.md-document-size').click();
      if (process.env.ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(process.env.ARTIFACT_DIR, `sizes-${theme}.png`),
        });
      await page.locator('.md-modal [data-cancel]').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.md-document-size').click();
    assert.ok(
      (await page.locator('.md-size-dialog').boundingBox()).width <= 390,
    );
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'sizes-mobile.png'),
      });
    await page.locator('.md-modal [data-cancel]').click();
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'sidebar-mobile.png'),
      });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS contextual inspector tabs, keyboard navigation, live edits, caption overrides, 22 formats, reversible resizing, cancelled creation, print units, validation, exact custom dimensions through save/export, and theme/mobile layouts.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
