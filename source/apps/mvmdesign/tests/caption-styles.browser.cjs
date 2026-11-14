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
    const click = (a) => page.locator(`[data-action="${a}"]`).click();
    const prop = (k) => page.locator(`[data-prop="${k}"]`);
    const tab = (k) => page.locator(`[data-inspector-tab="${k}"]`).click();
    const apply = async () => {
      await page.locator('.md-modal [data-apply]').click();
      await page.locator('.md-modal').waitFor({ state: 'detached' });
    };
    await page.evaluate(() => {
      editor.p.sequence[0].duration = 8;
      editor.p.captions = Array.from({ length: 8 }, (_, i) => ({
        id: 'c' + (i + 1),
        text: 'Verse ' + (Math.floor(i / 4) + 1) + ' · line ' + ((i % 4) + 1),
        start: i,
        end: Math.floor(i / 4) * 4 + 4,
        style: {},
      }));
      editor.p.captionDrafts = Array.from({ length: 8 }, (_, i) => ({
        id: 'd' + (i + 1),
        text: 'Unplaced line ' + (i + 1),
        style: {},
      }));
      editor.selectCue('c1');
    });
    // Selecting a styled cue must not leave controls editing an unrelated global style.
    const initialProject = await page.evaluate(() => MvmDesignModel.clone(editor.p));
    await page.evaluate(async () => {
      const M = MvmDesignModel, p = M.clone(editor.p);
      p.name = 'Four subtitle styles';
      p.captionStyle.color = '#cc9900';
      p.captionStyles = Array.from({length:4}, (_,i) => ({
        id:'row'+(i+1), name:'Row '+(i+1),
        style:M.cleanCaptionStyle({...p.captionStyle, color:'#ffffff', y:0.1+i*0.2, h:0.15}),
      }));
      p.captions.forEach((cue,i)=>{cue.styleId='row'+(i%4+1);cue.style={};});
      // A previous project had the global style selected.
      editor.styleScope = 'global';
      await editor.installProject(p);
    });
    assert.equal(await prop('styleScope').inputValue(), 'saved:row1');
    await prop('styleScope').selectOption('global');
    await page.locator('[data-cue-block=c1]').click();
    assert.equal(await prop('styleScope').inputValue(), 'saved:row1');
    await tab('style');
    const beforeColor = await page.evaluate(() => editor.canvas.toDataURL());
    await prop('caption:color').fill('#33bb77');
    assert.notEqual(await page.evaluate(() => editor.canvas.toDataURL()), beforeColor);
    assert.deepEqual(await page.evaluate(() => editor.p.captions.map(c=>MvmDesignModel.captionStyle(editor.p,c).color)),
      ['#33bb77','#ffffff','#ffffff','#ffffff','#33bb77','#ffffff','#ffffff','#ffffff']);
    assert.equal(await page.evaluate(()=>editor.p.captionStyle.color), '#cc9900');
    await click('caption-style-neon');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[0].style.textStyle), 'neon');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[1].style.textStyle), 'outline');
    await click('undo');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[0].style.color), '#33bb77');
    await click('undo');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[0].style.color), '#ffffff');
    await click('redo');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[0].style.color), '#33bb77');
    await page.locator('[data-cue-block=c2]').click();
    assert.equal(await prop('styleScope').inputValue(), 'saved:row2');
    await prop('caption:color').fill('#ff7733');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[0].style.color), '#33bb77');
    assert.equal(await page.evaluate(()=>editor.p.captionStyles[1].style.color), '#ff7733');
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => {
        const colors = theme === 'dark' ? {bg:'#171b29',surface:'#252b3b',text:'#edf0ff',border:'#515b70'}
          : {bg:'#f5f6fa',surface:'#fff',text:'#202635',border:'#c9cdd8'};
        for (const [key,value] of Object.entries(colors)) document.documentElement.style.setProperty('--'+key,value);
      }, theme);
      const dir = process.env.ARTIFACT_DIR || '/tmp/mvmdesign-check';
      fs.mkdirSync(dir, {recursive:true});
      await page.evaluate(async () => {
        await MvmDesignRender.prepare(editor.p);
        editor.draw(); editor.drawStylePreviews();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({path:path.join(dir, 'caption-scope-'+theme+'.png')});
    }
    await prop('cueStyleId').selectOption('row3');
    assert.equal(await prop('styleScope').inputValue(), 'saved:row3');
    assert.equal(await prop('caption:color').inputValue(), '#ffffff');
    await prop('styleScope').selectOption('individual');
    await page.locator('[data-cue-block=c1]').click();
    assert.equal(await prop('styleScope').inputValue(), 'individual');
    await prop('cueStyle:color').fill('#bb44cc');
    assert.equal(await page.evaluate(()=>MvmDesignModel.captionStyle(editor.p,editor.p.captions[0]).color), '#bb44cc');
    assert.equal(await page.evaluate(()=>MvmDesignModel.captionStyle(editor.p,editor.p.captions[4]).color), '#33bb77');
    // All styles uses property patches, never a whole-style replacement.
    await page.evaluate(() => {
      editor.p.captionStyles.forEach((profile,i) => {
        profile.style.font=['sans-serif','serif','monospace','sans-serif'][i];
        profile.style.enter=['fade','pop','left','zoom'][i];
        profile.style.size=.04+i*.005;
      });
      editor.renderPanels();
    });
    const beforeAll = await page.evaluate(()=>MvmDesignModel.clone(editor.p));
    await prop('styleScope').selectOption('all');
    assert.equal(await prop('styleScope').inputValue(), 'all');
    assert.equal(await page.locator('[data-action=save-caption-style]').count(),0);
    await tab('position');
    assert.equal(await page.locator('[data-caption-mixed=y]').count(),1);
    await tab('style');
    assert.equal(await page.locator('[data-caption-mixed=color]').count(),1);
    await prop('caption:color').fill('#00bb55');
    assert.equal(await page.locator('[data-caption-mixed=color]').count(),0);
    await prop('caption:stroke').fill('#101010');
    await prop('caption:strokeWidth').fill('8');
    await prop('caption:strokeWidth').blur();
    const expectedAll = JSON.parse(JSON.stringify(beforeAll));
    for (const style of [expectedAll.captionStyle,...expectedAll.captionStyles.map(s=>s.style)])
      Object.assign(style,{color:'#00bb55',stroke:'#101010',strokeWidth:8});
    assert.deepEqual(await page.evaluate(()=>MvmDesignModel.clone(editor.p)),expectedAll);
    assert.equal(await page.evaluate(()=>MvmDesignModel.captionStyle(editor.p,editor.p.captions[0]).color),'#bb44cc');
    assert.equal(await page.evaluate(()=>MvmDesignModel.captionStyle(editor.p,editor.p.captions[4]).color),'#00bb55');
    await click('undo');await click('undo');await click('undo');
    assert.deepEqual(await page.evaluate(()=>MvmDesignModel.clone(editor.p)),beforeAll);
    await click('redo');await click('redo');await click('redo');
    assert.deepEqual(await page.evaluate(()=>MvmDesignModel.clone(editor.p)),expectedAll);
    await page.locator('[data-cue-block=c2]').click();
    assert.equal(await prop('styleScope').inputValue(),'all');
    await prop('styleScope').selectOption('saved:row2');
    await prop('caption:color').fill('#aabbcc');
    assert.deepEqual(await page.evaluate(()=>editor.p.captionStyles.map(s=>s.style.color)),['#00bb55','#aabbcc','#00bb55','#00bb55']);
    await prop('styleScope').selectOption('all');
    // Switching among mixed fields does not copy their reference values into other styles.
    await tab('position');await tab('typography');await tab('style');
    assert.deepEqual(await page.evaluate(()=>editor.p.captionStyles.map(s=>[s.style.x,s.style.y,s.style.w,s.style.h,s.style.font,s.style.enter,s.style.size])),
      beforeAll.captionStyles.map(s=>[s.style.x,s.style.y,s.style.w,s.style.h,s.style.font,s.style.enter,s.style.size]));
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{
        const colors=theme==='dark'?{bg:'#171b29',surface:'#252b3b',text:'#edf0ff',border:'#515b70'}:{bg:'#f5f6fa',surface:'#fff',text:'#202635',border:'#c9cdd8'};
        for(const [key,value] of Object.entries(colors))document.documentElement.style.setProperty('--'+key,value);
        editor.draw();
      },theme);
      const dir=process.env.ARTIFACT_DIR||'/tmp/mvmdesign-check';
      await page.screenshot({path:path.join(dir,'all-caption-styles-'+theme+'.png')});
    }
    // Returning to the original fixture must discard the prior project's scope.
    await page.evaluate(async p => { await editor.installProject(p); editor.selectCue('c1'); }, initialProject);
    // Saving from the default shared scope immediately assigns the selected cue.
    await page.evaluate(() => {
      editor.styleScope = 'global';
      editor.p.captions[0].style = { y: 0.23, color: '#aaddff' };
      editor.renderPanels();
    });
    await click('save-caption-style');
    await prop('captionStyleName').fill('Created from selection');
    await apply();
    const createdId = await page.evaluate(() => editor.p.captionStyles[0].id);
    assert.equal(await prop('cueStyleId').inputValue(), createdId);
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].styleId),
      createdId,
    );
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[0].style.y),
      0.23,
    );
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[0].style.color),
      '#aaddff',
    );
    assert.equal(
      await page.evaluate(() => Object.keys(editor.p.captions[0].style).length),
      0,
    );
    assert.equal(
      await page
        .locator(`[data-caption-track="${createdId}"] [data-cue-block="c1"]`)
        .count(),
      1,
    );
    await click('save-caption-style');
    assert.equal(await prop('saveStyleTarget').inputValue(), createdId);
    await page.locator('.md-modal [data-cancel]').click();
    await click('undo');
    assert.equal(await page.evaluate(() => editor.p.captionStyles.length), 0);
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].styleId),
      undefined,
    );
    await click('redo');
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].styleId),
      createdId,
    );
    await click('undo');
    await page.evaluate(() => {
      editor.p.captions[0].style = {};
    });
    const originalTimes = await page.evaluate(() =>
      editor.p.captions.map((c) => [c.start, c.end]),
    );
    const ids = [];
    for (let i = 0; i < 4; i++) {
      await page.evaluate((i) => editor.selectCue('c' + (i + 1)), i);
      await prop('styleScope').selectOption('individual');
      await tab('position');
      await prop('cueStyle:y').fill(String(10 + i * 20));
      await prop('cueStyle:y').dispatchEvent('change');
      await prop('cueStyle:h').fill('15');
      await prop('cueStyle:h').dispatchEvent('change');
      await tab('style');
      await prop('cueStyle:color').fill(
        ['#ffffff', '#ffcc33', '#44ddff', '#ff77bb'][i],
      );
      await prop('cueStyle:color').dispatchEvent('change');
      await click('save-caption-style');
      await prop('captionStyleName').fill('Line ' + (i + 1));
      await apply();
      ids.push(await page.evaluate(() => editor.p.captionStyles.at(-1).id));
    }
    assert.equal(await page.evaluate(() => editor.p.captionStyles.length), 4);
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].styleId),
      ids[0],
    );
    // Updating a positioned subtitle defaults to its assigned profile, without creating a duplicate.
    await tab('position');
    await prop('cueStyle:y').fill('65');
    await prop('cueStyle:y').dispatchEvent('change');
    await click('save-caption-style');
    assert.equal(await prop('saveStyleTarget').inputValue(), ids[3]);
    assert.equal(await prop('captionStyleName').inputValue(), 'Line 4');
    await prop('saveStyleTarget').selectOption('new');
    assert.notEqual(await prop('captionStyleName').inputValue(), 'Line 4');
    await prop('saveStyleTarget').selectOption(ids[3]);
    await apply();
    assert.equal(await page.evaluate(() => editor.p.captionStyles.length), 4);
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[3].style.y),
      0.65,
    );
    await click('undo');
    await tab('position');
    await prop('override:y').uncheck();
    // Rule marks 1,5,9,13 before applying; manual changes remain provisional.
    const original = await page.evaluate(() => JSON.stringify(editor.p));
    await click('apply-caption-styles');
    await page.locator(`[data-saved-caption-style="${ids[0]}"]`).click();
    await page.locator('[data-batch-rule]').click();
    assert.deepEqual(
      await page
        .locator('[data-batch-cue]:checked')
        .evaluateAll((es) => es.map((e) => e.dataset.batchCue)),
      ['c1', 'c5', 'd1', 'd5'],
    );
    await page.locator('[data-batch-cue=c5]').uncheck();
    await page.locator('[data-batch-cue=c6]').check();
    await page.locator(`[data-saved-caption-style="${ids[1]}"]`).click();
    await page.locator(`[data-saved-caption-style="${ids[0]}"]`).click();
    assert.deepEqual(
      await page
        .locator('[data-batch-cue]:checked')
        .evaluateAll((es) => es.map((e) => e.dataset.batchCue)),
      ['c1', 'c6', 'd1', 'd5'],
    );
    await page.locator('.md-modal [data-cancel]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(editor.p)), original);
    // Stage four different rules in one dialog, then apply them in a single transaction.
    await click('apply-caption-styles');
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-saved-caption-style="${ids[i]}"]`).click();
      await prop('batchStart').fill(String(i + 1));
      assert.equal(await page.locator('[data-batch-cue]:checked').count(), 4);
    }
    await page.locator(`[data-saved-caption-style="${ids[0]}"]`).click();
    assert.equal(await prop('batchStart').inputValue(), '1');
    assert.deepEqual(
      await page
        .locator('[data-batch-cue]:checked')
        .evaluateAll((es) => es.map((e) => e.dataset.batchCue)),
      ['c1', 'c5', 'd1', 'd5'],
    );
    await page.locator(`[data-saved-caption-style="${ids[3]}"]`).click();
    assert.equal(await prop('batchStart').inputValue(), '4');
    assert.deepEqual(
      await page
        .locator('[data-batch-cue]:checked')
        .evaluateAll((es) => es.map((e) => e.dataset.batchCue)),
      ['c4', 'c8', 'd4', 'd8'],
    );
    assert.equal(await page.evaluate(() => JSON.stringify(editor.p)), original);
    await apply();
    assert.deepEqual(
      await page.evaluate(() => editor.p.captions.map((c) => c.styleId)),
      [...ids, ...ids],
    );
    assert.deepEqual(
      await page.evaluate(() => editor.p.captionDrafts.map((c) => c.styleId)),
      [...ids, ...ids],
    );
    assert.deepEqual(
      await page.evaluate(() => editor.p.captions.map((c) => [c.start, c.end])),
      originalTimes,
    );
    await click('undo');
    assert.equal(
      await page.evaluate(() => editor.p.captions[7].styleId),
      undefined,
    );
    await click('redo');
    assert.equal(
      await page.evaluate(() => editor.p.captions[7].styleId),
      ids[3],
    );
    // Changing the selected cue leaves the previous saved-style editing context.
    await prop('styleScope').selectOption('saved:' + ids[0]);
    await page.evaluate(() => editor.selectCue('c2'));
    assert.equal(await prop('styleScope').inputValue(), 'saved:' + ids[1]);
    await click('save-caption-style');
    assert.equal(await prop('saveStyleTarget').inputValue(), ids[1]);
    await page.locator('.md-modal [data-cancel]').click();
    // Editing the linked style changes both verses; local overrides still win.
    await prop('styleScope').selectOption('saved:' + ids[0]);
    await tab('style');
    await prop('caption:color').fill('#55aaee');
    await prop('caption:color').dispatchEvent('change');
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[0]).color,
      ),
      '#55aaee',
    );
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[4]).color,
      ),
      '#55aaee',
    );
    await tab('animation');
    await page.locator('[data-animation-picker="caption:enter"]').click();
    await page.locator('[data-animation-value=pop]').click();
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[0].style.enter),
      'pop',
    );
    await page.evaluate(() => editor.selectCue('c5'));
    await prop('styleScope').selectOption('individual');
    await tab('style');
    await prop('cueStyle:color').fill('#ff0044');
    await prop('cueStyle:color').dispatchEvent('change');
    await prop('styleScope').selectOption('saved:' + ids[0]);
    await prop('caption:color').fill('#66cc88');
    await prop('caption:color').dispatchEvent('change');
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[4]).color,
      ),
      '#ff0044',
    );
    // Batch can preserve or reset local overrides while assigning a style.
    await click('apply-caption-styles');
    await prop('batchScope').selectOption('placed');
    await page.locator(`[data-saved-caption-style="${ids[1]}"]`).click();
    await prop('batchStart').fill('5');
    await prop('batchEnd').fill('5');
    await prop('batchKeep').check();
    await apply();
    assert.equal(
      await page.evaluate(() => editor.p.captions[4].styleId),
      ids[1],
    );
    assert.equal(
      await page.evaluate(
        () => MvmDesignModel.captionStyle(editor.p, editor.p.captions[4]).color,
      ),
      '#ff0044',
    );
    await click('undo');
    await page.evaluate(() => {
      editor.styleScope = 'individual';
      editor.selectCue('c5');
    });
    await prop('cueStyleId').selectOption(ids[2]);
    assert.equal(
      await page.evaluate(() => Object.keys(editor.p.captions[4].style).length),
      0,
    );
    await tab('style');
    assert.equal(await prop('cueStyle:color').inputValue(), '#44ddff');
    await click('undo');
    // Saved positions remain fixed even with four overlapping cues.
    assert.deepEqual(
      await page.evaluate(() =>
        editor.p.captions
          .slice(0, 4)
          .map((c, i) => MvmDesignModel.captionBox(editor.p, c, i).y),
      ),
      [0.1, 0.3, 0.5, 0.7],
    );
    await page.evaluate(() => editor.seek(3.5));
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'saved-caption-verse.png'),
      });
    // Placement and unplacement retain assigned styles.
    await page.evaluate(() => (editor.time = 0));
    await click('draft-place-d1');
    assert.equal(await page.evaluate(() => editor.clickCue.styleId), ids[0]);
    assert.equal(
      await page.evaluate(() => MvmDesignModel.captionTargets(editor.p).length),
      16,
    );
    await click('draft-place-d1');
    await tab('content');
    await click('cue-unplace');
    assert.equal(
      await page.evaluate(() => editor.p.captionDrafts.at(-1).styleId),
      ids[0],
    );
    // Deleting a profile preserves current appearance; Undo restores the references.
    await prop('styleScope').selectOption('saved:' + ids[0]);
    const beforeDelete = await page.evaluate(() =>
      MvmDesignModel.captionStyle(editor.p, editor.p.captions[0]),
    );
    await click('save-caption-style');
    assert.equal(await prop('saveStyleTarget').inputValue(), ids[0]);
    await prop('saveStyleTarget').selectOption(ids[0]);
    await page.locator('[data-delete-caption-profile]').click();
    assert.equal(await page.evaluate(() => editor.p.captionStyles.length), 3);
    assert.deepEqual(
      await page.evaluate(() =>
        MvmDesignModel.captionStyle(editor.p, editor.p.captions[0]),
      ),
      beforeDelete,
    );
    await click('undo');
    assert.equal(await page.evaluate(() => editor.p.captionStyles.length), 4);
    assert.equal(
      await page.evaluate(() => editor.p.captions[0].styleId),
      ids[0],
    );
    await prop('styleScope').selectOption('saved:' + ids[0]);
    await click('save-caption-style');
    assert.equal(await prop('saveStyleTarget').inputValue(), ids[0]);
    await prop('saveStyleTarget').selectOption(ids[0]);
    await prop('captionStyleName').fill('Opening line');
    await apply();
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[0].name),
      'Opening line',
    );
    const saved = await page.evaluate(() =>
      MvmDesignModel.normalize(MvmDesignModel.clone(editor.p)),
    );
    assert.equal(saved.captionStyles.length, 4);
    assert.equal(saved.captions[0].styleId, ids[0]);
    assert.equal(saved.captionDrafts[0].styleId, ids[1]);
    assert.equal(saved.captionStyles[0].style.enter, 'pop');
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
        for (const [k, v] of Object.entries(colors))
          document.documentElement.style.setProperty('--' + k, v);
      }, theme);
      await click('apply-caption-styles');
      await prop('batchStart').fill('2');
      await page.waitForTimeout(100);
      assert.ok(
        await page
          .locator('.md-caption-style-gallery canvas')
          .first()
          .evaluate((c) => {
            const d = c
              .getContext('2d')
              .getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4)
              if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++;
            return n > 5;
          }),
        'Style samples must contain visible glyphs',
      );
      if (process.env.ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(
            process.env.ARTIFACT_DIR,
            'caption-batch-' + theme + '.png',
          ),
        });
      await page.locator('.md-modal [data-cancel]').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await click('apply-caption-styles');
    const bounds = await page.locator('.md-caption-batch-dialog').boundingBox();
    assert.ok(
      bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844,
    );
    if (process.env.ARTIFACT_DIR)
      await page.screenshot({
        path: path.join(process.env.ARTIFACT_DIR, 'caption-batch-mobile.png'),
      });
    await page.locator('.md-modal [data-cancel]').click();
    if (process.env.ARTIFACT_DIR) {
      const movie = await page.evaluate(async () => {
        const p = MvmDesignModel.clone(editor.p);
        p.width = 640;
        p.height = 360;
        p.sequence[0].duration = 1.2;
        p.captions = p.captions
          .slice(0, 4)
          .map((c, i) => ({ ...c, start: i * 0.15, end: 1.2 }));
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
        path.join(
          process.env.ARTIFACT_DIR,
          'saved-caption-styles.' + movie.ext,
        ),
        Buffer.from(movie.data),
      );
      assert.ok(movie.data.length > 2000);
    }
    const reopened = await page.evaluate(async () => {
      const p = MvmDesignModel.normalize(MvmDesignModel.clone(editor.p));
      await editor.installProject(p);
      return editor.p.captions
        .slice(0, 4)
        .map((c) => [c.styleId, MvmDesignModel.captionStyle(editor.p, c).y]);
    });
    assert.deepEqual(
      reopened.map((r) => r[0]),
      ids,
    );
    assert.deepEqual(
      reopened.map((r) => r[1]),
      [0.1, 0.3, 0.5, 0.7],
    );
    // Reopening the dialog must preserve irregular saved assignments, not regenerate a pattern.
    const expectedChecks = await page.evaluate((id) => {
      editor.p.captions[5].styleId = id;
      return MvmDesignModel.captionTargets(editor.p)
        .filter((t) => t.cue.styleId === id)
        .map((t) => t.cue.id);
    }, ids[0]);
    await click('apply-caption-styles');
    await page.locator(`[data-saved-caption-style="${ids[0]}"]`).click();
    assert.deepEqual(
      await page
        .locator('[data-batch-cue]:checked')
        .evaluateAll((es) => es.map((e) => e.dataset.batchCue)),
      expectedChecks,
    );
    await page.locator('.md-modal [data-cancel]').click();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'PASS all-style property edits preserve geometry, fonts, animations, overrides and timing, mixed-value indicators, isolated single-style edits, three-step Undo/Redo, four distinct styles in one Apply, per-style rule and manual-selection memory, saved assignment restoration, saved subtitle styles, four-line verse rules, manual checks/cancel, shared edits, individual overrides, fixed overlapping positions, undo/redo, draft placement, delete preservation, save/load, video export and theme/mobile layouts.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
