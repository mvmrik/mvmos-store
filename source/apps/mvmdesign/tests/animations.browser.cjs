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
    const open = async (key) => {
      await page.locator(`[data-animation-picker="${key}"]`).click();
      await page.locator('[data-animation-stage]').waitFor();
    };
    const choose = async (key, value) => {
      await open(key);
      await page.locator(`[data-animation-value="${value}"]`).click();
      await page.locator('.md-animation-dialog').waitFor({ state: 'detached' });
    };
    await click('text');
    await page.locator('[data-prop=text]').fill('Animated design');
    await page.locator('[data-prop=text]').dispatchEvent('change');
    await page.locator('[data-inspector-tab=animation]').click();
    const initial = await page.evaluate(() => JSON.stringify(editor.p));
    await page.evaluate(() => {
      const request = window.requestAnimationFrame.bind(window),
        cancel = window.cancelAnimationFrame.bind(window);
      window.animationFrames = new Set();
      window.requestAnimationFrame = (cb) => {
        const id = request((time) => {
          animationFrames.delete(id);
          cb(time);
        });
        animationFrames.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        animationFrames.delete(id);
        cancel(id);
      };
    });
    await open('enter');
    assert.equal(await page.locator('[data-animation-value]').count(), 26);
    await page.locator('[data-animation-value=bounce]').hover();
    await page.waitForTimeout(100);
    const first = await page
      .locator('[data-animation-stage]')
      .evaluate((c) => c.toDataURL());
    await page.waitForTimeout(220);
    assert.notEqual(
      await page
        .locator('[data-animation-stage]')
        .evaluate((c) => c.toDataURL()),
      first,
    );
    assert.equal(await page.evaluate(() => JSON.stringify(editor.p)), initial);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-animation-stage]').count(), 0);
    assert.equal(await page.evaluate(() => animationFrames.size), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(editor.p)), initial);
    const undo = await page.evaluate(() => editor.undo.length);
    await choose('enter', 'pop');
    assert.equal(await page.evaluate(() => editor.it.enter), 'pop');
    assert.equal(await page.evaluate(() => editor.undo.length), undo + 1);
    assert.equal(await page.evaluate(() => animationFrames.size), 0);
    await open('exit');
    assert.equal(await page.locator('[data-animation-value]').count(), 24);
    assert.equal(
      await page.locator('[data-animation-value=typewriter]').count(),
      0,
    );
    await page.locator('[data-animation-value=wipeLeft]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => editor.it.exit), 'wipeLeft');
    await open('exit');
    const selectedAnimation = page.locator('[data-animation-value=wipeLeft]');
    assert.equal(await selectedAnimation.getAttribute('aria-pressed'), 'true');
    assert.equal(await selectedAnimation.evaluate(el => {
      const row=el.getBoundingClientRect(), list=el.parentElement.getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom;
    }), true, 'reopened picker reveals the selected animation');
    assert.equal(await page.locator('[data-animation-name]').textContent(), 'Reveal from left');
    await page.locator('[data-animation-value=wipeRight]').hover();
    assert.equal(await selectedAnimation.getAttribute('aria-pressed'), 'true', 'preview keeps applied selection marked');
    assert.equal(await page.locator('[data-animation-value=wipeRight]').getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => editor.it.exit), 'wipeLeft');
    const textId = await page.evaluate(() => editor.itemId);
    await click('undo');
    assert.equal(
      await page.evaluate(
        () => editor.pg.items.find((i) => i.type === 'text').exit,
      ),
      'none',
    );
    await click('redo');
    assert.equal(
      await page.evaluate(
        () => editor.pg.items.find((i) => i.type === 'text').exit,
      ),
      'wipeLeft',
    );
    await click('rect');
    await page.locator('[data-inspector-tab=animation]').click();
    await open('enter');
    assert.equal(await page.locator('[data-animation-value]').count(), 24);
    await page.locator('[data-animation-value=flipX]').click();
    assert.equal(await page.evaluate(() => editor.it.enter), 'flipX');
    await click('mode-subtitles');
    await page.evaluate(() => {
      editor.p.captions = [
        { id: 'one', text: 'First subtitle', start: 0, end: 3 },
        { id: 'two', text: 'Second subtitle', start: 3, end: 5 },
      ];
      editor.selectCue('one');
    });
    await page.locator('[data-inspector-tab=animation]').click();
    await choose('caption:enter', 'elastic');
    assert.equal(
      await page.evaluate(() => editor.p.captionStyle.enter),
      'elastic',
    );
    await page.locator('[data-prop=styleScope]').selectOption('individual');
    await choose('cueStyle:exit', 'blur');
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.exit),
      'blur',
    );
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[1]).exit,
      ),
      'none',
    );
    await page.locator('[data-prop="override:exit"]').uncheck();
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(editor.p.captions[0].style, 'exit'),
      ),
      false,
    );
    // Every animation survives save/load and has deterministic visible entry/exit frames.
    const animations = await page.evaluate(() => {
      const M = MvmDesignModel,
        R = MvmDesignRender,
        canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      const hash = () => {
        let n = 2166136261;
        for (const b of ctx.getImageData(0, 0, 640, 360).data)
          n = Math.imul(n ^ b, 16777619);
        return n;
      };
      return M.animations.map((key) => {
        const p = M.project(),
          item = M.item();
        Object.assign(item, {
          text: 'Motion preview',
          size: 0.13,
          enter: key,
          exit: key,
          animDuration: 1,
          delay: 0,
        });
        p.width = 640;
        p.height = 360;
        p.pages[0].items = [item];
        p.captionStyle.enter = key;
        p.captionStyle.exit = key;
        const saved = M.normalize(M.clone(p));
        if (
          saved.pages[0].items[0].enter !== key ||
          saved.captionStyle.enter !== key ||
          saved.captionStyle.exit !== key
        )
          throw Error('Lost saved animation ' + key);
        const frames = [0.15, 0.4, 2, 4.6, 4.85].map((time) => {
          R.video(ctx, p, time, 640, 360);
          return hash();
        });
        const rest = R.motion(item, 2, 5);
        if (
          rest.alpha !== 1 ||
          rest.scale !== 1 ||
          rest.dx !== 0 ||
          rest.dy !== 0 ||
          rest.rotation !== 0 ||
          rest.blur !== 0 ||
          rest.clip
        )
          throw Error('Animation does not settle ' + key);
        return { key, frames };
      });
    });
    for (const { key, frames } of animations)
      if (key !== 'none') {
        assert.notEqual(
          frames[0],
          frames[2],
          key + ' entrance must differ from rest',
        );
        if (!['typewriter', 'words'].includes(key))
          assert.notEqual(
            frames[4],
            frames[2],
            key + ' exit must differ from rest',
          );
      }
    assert.ok(
      new Set(animations.map((a) => a.frames[1])).size >= 20,
      'Animations produce distinct visuals',
    );
    await page.locator('[data-prop=styleScope]').selectOption('global');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        const c =
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
        for (const [k, v] of Object.entries(c))
          document.documentElement.style.setProperty('--' + k, v);
      }, theme);
      await open('caption:enter');
      await page.locator('[data-animation-value=spin]').hover();
      await page.waitForTimeout(200);
      if (process.env.ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(process.env.ARTIFACT_DIR, `animations-${theme}.png`),
        });
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open('caption:exit');
    const mobileBounds = await page
      .locator('.md-animation-dialog')
      .boundingBox();
    assert.ok(mobileBounds.width <= 390);
    assert.ok(
      mobileBounds.y >= 0 && mobileBounds.y + mobileBounds.height <= 844,
    );
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'animations-mobile.png'),
      });
    await page.keyboard.press('Escape');
    if (process.env.ARTIFACT_DIR) {
      const movie = await page.evaluate(async () => {
        const M = MvmDesignModel,
          p = M.clone(editor.p);
        p.width = 640;
        p.height = 360;
        p.sequence = p.sequence.slice(0, 1);
        p.sequence[0].duration = 1.6;
        p.pages[0].items = p.pages[0].items.filter((i) => i.type === 'text');
        Object.assign(p.pages[0].items[0], {
          enter: 'spin',
          exit: 'wipeRight',
          animDuration: 0.5,
          size: 0.09,
        });
        p.captions = [
          {
            id: 'export',
            start: 0,
            end: 1.6,
            text: 'Animated subtitle',
            style: { enter: 'flipY', exit: 'blur', animDuration: 0.5 },
          },
        ];
        const out = await MvmDesignExport.video(p, {
          fps: 24,
          quality: 'high',
        });
        return {
          ext: out.ext,
          data: Array.from(new Uint8Array(await out.blob.arrayBuffer())),
        };
      });
      fs.writeFileSync(
        path.join(process.env.ARTIFACT_DIR, 'animations.' + movie.ext),
        Buffer.from(movie.data),
      );
      assert.ok(movie.data.length > 2000);
    }
    await open('caption:enter');
    await page.evaluate(() => editor.destroy());
    assert.equal(await page.locator('.md-animation-dialog').count(), 0);
    assert.equal(await page.evaluate(() => animationFrames.size), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS animated samples and real design preview, hover without changes, cancellation, entry/exit selection, undo, shape/text variants, caption inheritance, animation save/load, distinct rendered frames, video export, themes, mobile, and animation loop cleanup.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
