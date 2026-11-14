// PLAYWRIGHT_MODULE and CHROMIUM_PATH may select existing local browser installations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const app = path.resolve(__dirname, '..'),
  fonts = path.resolve(app, '../mvmfonts');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.stack));
    const catalog = JSON.parse(
      fs.readFileSync(path.join(fonts, 'fonts/catalog.json'), 'utf8'),
    );
    for (const family of catalog.families)
      for (const style of family.styles)
        for (const key of Object.keys(style.files))
          style.files[key] = '/pub/mvmfonts/file/' + style.files[key];
    await page.route('https://design.test/**', (route) => {
      const url = new URL(route.request().url()),
        name = url.pathname;
      if (name.startsWith('/apps/mvmdesign/'))
        return route.fulfill({
          path: path.join(app, 'public', name.slice('/apps/mvmdesign/'.length)),
          contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
      if (name.startsWith('/pub/mvmfonts/file/'))
        return route.fulfill({
          path: path.join(fonts, 'fonts/files', path.basename(name)),
          contentType: 'font/woff2',
        });
      if (
        [
          '/pub/mvmfonts/client.js',
          '/pub/mvmfonts/picker.js',
          '/pub/mvmfonts/i18n.js',
        ].includes(name)
      )
        return route.fulfill({
          path: path.join(fonts, 'public', path.basename(name)),
          contentType: 'text/javascript',
        });
      if (name === '/api/platform/apps/mvmfonts/call')
        return route.fulfill({ json: { result: catalog } });
      if (name === '/api/auth/whoami')
        return route.fulfill({ json: { effective_user: 'fixture' } });
      if (name === '/')
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}:root{--bg:#171b29;--surface:#252b3b;--text:#edf0ff;--border:#515b70;--accent:#6352d8;--on-accent:#fff}</style><link rel="stylesheet" href="/apps/mvmdesign/design.css"><div id="root" style="height:100%"></div><script>window.asset=s=>s;window.mvmOS={lang:'en'};</script>${['i18n', 'model', 'render', 'export', 'editor'].map((f) => `<script src="/apps/mvmdesign/${f}.js"></script>`).join('')}<script>window.editor=new MvmDesign.Editor(document.querySelector('#root'));</script>`,
        });
      throw Error('Unexpected request ' + name);
    });
    await page.goto('https://design.test/');
    await page.waitForFunction(() => editor.fonts.length > 20 && editor.db);
    await page.locator('[data-action=text]').click();
    await page.locator('[data-prop=text]').fill('Design Живот');
    await page.locator('[data-prop=text]').dispatchEvent('change');
    // Input events redraw the live canvas without replacing the focused control.
    const reselectText = () =>
      page.evaluate(() => {
        editor.itemId = editor.pg.items[0].id;
        editor.renderInspector();
        editor.draw();
      });
    const tab = (key) => page.locator(`[data-inspector-tab=${key}]`).click();
    await tab('style');
    const originalColor = await page.evaluate(() => editor.it.color),
      undoCount = await page.evaluate(() => editor.undo.length);
    const color = page.locator('[data-prop=color]');
    const liveColor = await color.evaluate((el) => {
      el.focus();
      window.liveColorControl = el;
      const before = editor.canvas.toDataURL();
      for (const value of ['#ff3300', '#44bb99', '#2266ff']) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return {
        value: editor.it.color,
        connected: el.isConnected,
        focused: document.activeElement === el,
        changed: editor.canvas.toDataURL() !== before,
      };
    });
    assert.equal(liveColor.value, '#2266ff');
    assert.equal(liveColor.connected, true);
    assert.equal(liveColor.focused, true);
    assert.equal(liveColor.changed, true);
    assert.equal(await page.evaluate(() => editor.undo.length), undoCount + 1);
    await color.dispatchEvent('change');
    assert.equal(
      await page.evaluate(
        () => liveColorControl === document.querySelector('[data-prop=color]'),
      ),
      true,
    );
    assert.equal(await page.evaluate(() => editor.undo.length), undoCount + 1);
    await page.locator('[data-action=undo]').click();
    assert.equal(
      await page.evaluate(() => editor.pg.items[0].color),
      originalColor,
    );
    await page.locator('[data-action=redo]').click();
    assert.equal(
      await page.evaluate(() => editor.pg.items[0].color),
      '#2266ff',
    );
    await reselectText();
    await tab('content');
    const initialSize = await page.evaluate(() => editor.it.size),
      size = page.locator('[data-prop=size]'),
      beforeSizeUndo = await page.evaluate(() => editor.undo.length);
    await size.fill('97.2');
    assert.ok(Math.abs(await page.evaluate(() => editor.it.size) - 0.09) < 1e-12);
    await size.fill('129.6');
    assert.ok(Math.abs(await page.evaluate(() => editor.it.size) - 0.12) < 1e-12);
    await size.fill('');
    assert.ok(Math.abs(await page.evaluate(() => editor.it.size) - 0.12) < 1e-12);
    await size.fill('151.2');
    assert.ok(Math.abs(await page.evaluate(() => editor.it.size) - 0.14) < 1e-12);
    assert.equal(
      await page.evaluate(() => editor.undo.length),
      beforeSizeUndo + 1,
    );
    await size.press('Tab');
    await page.locator('[data-action=undo]').click();
    assert.equal(
      await page.evaluate(() => editor.pg.items[0].size),
      initialSize,
    );
    await reselectText();
    await tab('content');
    const blankUndo = await page.evaluate(() => editor.undo.length);
    await page.locator('[data-prop=size]').fill('');
    await page.locator('[data-prop=size]').press('Tab');
    assert.equal(await page.evaluate(() => editor.it.size), initialSize);
    assert.equal(await page.evaluate(() => editor.undo.length), blankUndo);
    // Escape rolls back the entire in-progress field edit, including undo/redo history.
    await tab('style');
    const beforeCancel = await page.evaluate(() => ({
      undo: editor.undo.length,
      redo: editor.redo.length,
      color: editor.it.color,
    }));
    await page.locator('[data-prop=color]').evaluate((el) => {
      el.focus();
      el.value = '#00ff11';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await page.evaluate(() => ({
        undo: editor.undo.length,
        redo: editor.redo.length,
        color: editor.it.color,
      })),
      beforeCancel,
    );
    assert.equal(await page.locator('[data-style-preview]').count(), 24);
    await page.locator('[data-action=style-retro]').click();
    assert.equal(await page.evaluate(() => editor.it.effect), 'retro');
    // The dialog previews actual, already loaded fonts before committing any selection.
    await tab('content');
    await page.locator('[data-font-picker=font]').click();
    await page.locator('[data-font-search]').fill('Lobster');
    await page.waitForSelector(
      '[data-font-family=Lobster][data-font-ready=true]',
    );
    assert.equal(await page.evaluate(() => editor.it.font), 'sans-serif');
    assert.equal(
      await page.evaluate(() =>
        document.fonts.check('16px "Lobster"', 'Design Живот'),
      ),
      true,
    );
    assert.match(
      await page
        .locator('[data-font-family=Lobster] .mfp-sample')
        .evaluate((el) => getComputedStyle(el).fontFamily),
      /Lobster/,
    );
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'font-picker-dark.png'),
      });
    await page.locator('[data-font-family=Lobster]').click();
    await page.waitForFunction(() => editor.it.font === 'Lobster');
    const saved = await page.evaluate(() =>
      MvmDesignModel.normalize(MvmDesignModel.clone(editor.p)),
    );
    assert.equal(saved.pages[0].items[0].font, 'Lobster');
    assert.equal(saved.pages[0].items[0].effect, 'retro');
    await tab('content');
    await page.locator('[data-font-picker=font]').click();
    const selectedFont = page.locator('[data-font-family=Lobster]');
    assert.equal(await selectedFont.getAttribute('aria-selected'), 'true');
    assert.equal(await selectedFont.evaluate(el => {
      const row=el.getBoundingClientRect(), list=el.closest('.mfp-list').getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom;
    }), true, 'reopened picker reveals the selected font');
    assert.ok(await page.locator('.mfp-list').evaluate(el => el.scrollTop) > 0);
    await page.locator('[data-font-search]').fill('Alegreya');
    await page.waitForSelector(
      '[data-font-family=Alegreya][data-font-ready=true]',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => editor.it.font), 'Lobster');
    // Increasing font size must grow glyphs even when wrapping adds lines in a short box.
    const fontSizes = await page.evaluate(() => {
      const M = MvmDesignModel,
        R = MvmDesignRender;
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      const painted = [];
      const fillText = ctx.fillText.bind(ctx);
      ctx.fillText = function (...args) {
        const metrics = this.measureText('Mg');
        painted.push({
          size: parseFloat(this.font.match(/([\d.]+)px/)[1]),
          glyphHeight:
            metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        });
        return fillText(...args);
      };
      return ['page', 'subtitle'].map((kind) => {
        const p = M.project();
        p.width = 960;
        p.height = 540;
        const text = 'A longer line of text that wraps onto several lines';
        const item = {
          ...M.item(),
          text,
          font: 'sans-serif',
          x: 0.1,
          y: 0.3,
          w: 0.6,
          h: 0.08,
          enter: 'none',
          exit: 'none',
          effect: 'none',
          strokeWidth: 0,
          shadow: 0,
        };
        if (kind === 'page') p.pages[0].items.push(item);
        else {
          Object.assign(p.captionStyle, item, { preset: 'custom' });
          p.captions = [{ id: 'size-check', text, start: 0, end: 4 }];
        }
        return [8, 9, 10, 12, 18].map((value) => {
          item.size = p.captionStyle.size = value / 100;
          painted.length = 0;
          ctx.clearRect(0, 0, 960, 540);
          if (kind === 'page') R.page(ctx, p, p.pages[0], 960, 540);
          else R.video(ctx, p, 1, 960, 540);
          return { kind, value, painted: painted.map((v) => ({ ...v })) };
        });
      });
    });
    for (const group of fontSizes) {
      let previousHeight = 0;
      for (const sample of group) {
        assert.ok(sample.painted.length > 0, 'Text is rendered');
        for (const glyph of sample.painted)
          assert.ok(
            Math.abs(glyph.size - sample.value * 5.4) < 0.001,
            `${sample.kind}: requested ${sample.value}, rendered ${glyph.size}px`,
          );
        assert.ok(
          sample.painted[0].glyphHeight > previousHeight,
          `${sample.kind}: glyphs must grow as the selected font size increases`,
        );
        previousHeight = sample.painted[0].glyphHeight;
      }
    }
    // Every style is normalized for both element and caption properties, with distinct rendered output.
    const rendered = await page.evaluate(() => {
      const M = MvmDesignModel,
        R = MvmDesignRender,
        canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      const results = [];
      for (const key of M.textStyles) {
        ctx.clearRect(0, 0, 500, 200);
        ctx.fillStyle = '#202534';
        ctx.fillRect(0, 0, 500, 200);
        const style = M.textPreset(key),
          it = { ...M.item(), ...style, text: 'Design Живот', size: 0.13 };
        R.drawText(ctx, it, 500, 200, 540);
        let hash = 2166136261;
        for (const byte of ctx.getImageData(0, 0, 500, 200).data)
          hash = Math.imul(hash ^ byte, 16777619);
        results.push([key, hash]);
        const p = M.project();
        Object.assign(p.captionStyle, style, { preset: 'custom' });
        p.pages[0].items.push(it);
        const n = M.normalize(M.clone(p));
        if (
          n.captionStyle.effect !== style.effect ||
          n.pages[0].items[0].effect !== style.effect
        )
          throw Error('Effect lost on saving ' + key);
      }
      return results;
    });
    assert.ok(new Set(rendered.map(([, hash]) => hash)).size >= 22);
    // Page/caption style catalogs are identical, while per-cue selection keeps inheritance intact.
    await page.evaluate(() => {
      editor.p.captions = [
        { id: 'one', text: 'Design Живот', start: 0, end: 5 },
        { id: 'two', text: 'Shared caption', start: 5, end: 9 },
      ];
      editor.mode = 'subtitles';
      editor.cueId = 'one';
      editor.renderPanels();
      editor.seek(1);
    });
    assert.equal(await page.locator('[data-style-preview]').count(), 24);
    await tab('style');
    await page.locator('[data-action=caption-style-neon]').click();
    assert.equal(
      await page.evaluate(() => editor.p.captionStyle.effect),
      'neon',
    );
    await page.locator('[data-prop=styleScope]').selectOption('individual');
    const sharedColor = await page.evaluate(() => editor.p.captionStyle.color);
    await page.locator('[data-prop="cueStyle:color"]').evaluate((el) => {
      el.focus();
      window.captionColorControl = el;
      el.value = '#88ee44';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.color),
      '#88ee44',
    );
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[1]).color,
      ),
      sharedColor,
    );
    assert.equal(
      await page.locator('[data-prop="override:color"]').isChecked(),
      true,
    );
    assert.equal(
      await page.evaluate(() => captionColorControl.isConnected),
      true,
    );
    await page.locator('[data-prop="cueStyle:color"]').dispatchEvent('change');
    const slider = page.locator('[data-prop="cueStyle:effectAmount"]'),
      sliderUndo = await page.evaluate(() => editor.undo.length);
    await slider.evaluate((el) => {
      el.focus();
      window.liveSlider = el;
      for (const v of ['.1', '.5', '.9']) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.effectAmount),
      0.9,
    );
    assert.equal(
      await page.evaluate(
        () => liveSlider.isConnected && document.activeElement === liveSlider,
      ),
      true,
    );
    await slider.dispatchEvent('change');
    assert.equal(await page.evaluate(() => editor.undo.length), sliderUndo + 1);
    await page.locator('[data-action=caption-style-chrome]').click();
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.effect),
      'metal',
    );
    assert.equal(
      await page.evaluate(
        () =>
          MvmDesignModel.captionStyle(editor.p, editor.p.captions[1]).effect,
      ),
      'neon',
    );
    await tab('typography');
    await page.locator('[data-font-picker="cueStyle:font"]').click();
    await page.locator('[data-font-search]').fill('Alegreya');
    await page.waitForSelector(
      '[data-font-family=Alegreya][data-font-ready=true]',
    );
    await page.locator('[data-font-family=Alegreya]').click();
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].style.font),
      'Alegreya',
    );
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(editor.p.captions[1].style || {}, 'font'),
      ),
      false,
    );
    if (process.env.ARTIFACT_DIR) {
      await page.evaluate(() => {
        editor.inspector.scrollTop = 420;
      });
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'text-styles-dark.png'),
      });
      // Export a grid using the same renderer as videos, to inspect all effects at once.
      const grid = await page.evaluate(() => {
        const M = MvmDesignModel,
          R = MvmDesignRender,
          c = document.createElement('canvas');
        c.width = 1600;
        c.height = 1200;
        const ctx = c.getContext('2d');
        for (const [i, key] of M.textStyles.entries()) {
          const x = (i % 4) * 400,
            y = Math.floor(i / 4) * 200;
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = '#202534';
          ctx.fillRect(0, 0, 400, 200);
          R.drawText(
            ctx,
            {
              ...M.item(),
              ...M.textPreset(key),
              text: 'Design',
              size: 0.17,
              weight: 900,
            },
            400,
            160,
            540,
          );
          ctx.font = '16px sans-serif';
          ctx.fillStyle = '#fff';
          ctx.fillText(key, 16, 184);
          ctx.restore();
        }
        return c.toDataURL().split(',')[1];
      });
      fs.writeFileSync(
        path.join(process.env.ARTIFACT_DIR, 'text-effects-grid.png'),
        Buffer.from(grid, 'base64'),
      );
    }
    if (process.env.ARTIFACT_DIR) {
      const movie = await page.evaluate(async () => {
        const M = MvmDesignModel,
          p = M.clone(editor.p);
        p.width = 640;
        p.height = 360;
        p.sequence = p.sequence.slice(0, 1);
        p.sequence[0].duration = 1.2;
        Object.assign(p.pages[0].items[0], M.textPreset('glitch'), {
          text: 'Glitch design',
          font: 'Lobster',
          size: 0.1,
        });
        p.captions = [
          {
            id: 'export',
            start: 0.05,
            end: 1.15,
            text: 'Neon caption',
            style: {
              ...M.textPreset('neon'),
              font: 'Alegreya',
              y: 0.65,
              preset: 'custom',
              enter: 'up',
              exit: 'fade',
            },
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
        path.join(process.env.ARTIFACT_DIR, 'decorative-text.' + movie.ext),
        Buffer.from(movie.data),
      );
      assert.ok(movie.data.length > 2000);
    }
    // The font picker remains readable in a light theme and cancellation cleans up its overlay.
    await page.evaluate(() => {
      for (const [k, v] of Object.entries({
        bg: '#f5f6fa',
        surface: '#fff',
        text: '#202635',
        border: '#c9cdd8',
      }))
        document.documentElement.style.setProperty('--' + k, v);
    });
    await tab('typography');
    await page.locator('[data-font-picker="cueStyle:font"]').click();
    await page.locator('[data-font-search]').fill('Alegreya');
    await page.waitForSelector(
      '[data-font-family=Alegreya][data-font-ready=true]',
    );
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'font-picker-light.png'),
      });
    await page.evaluate(() => editor.destroy());
    assert.equal(await page.locator('.mvm-font-picker').count(), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS live property inputs, retained focus, grouped undo, cancellation, 24 text/caption styles, distinct effect rendering, project persistence, shared/local caption styling, real font previews, search, cancellation, theme layouts, and picker cleanup.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
