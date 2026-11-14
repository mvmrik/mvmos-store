// Browser integration for desktop-owned projects and public local/shared workflows.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  try {
    let document,
      revision = 1,
      role = 'viewer',
      revoked = false,
      publicMode = false,
      writes = 0,
      creates = 0,
      holdOpen = null,
      failOpen = false;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      forbidden = [];
    page.on('pageerror', (e) => errors.push(e.stack));
    page.on('dialog', (d) => d.accept(d.defaultValue()));
    const meta = () => ({
      id: 'server1',
      name: document?.name || 'Shared template',
      revision,
      role: publicMode ? role : 'owner',
      width: 1920,
      height: 1080,
    });
    await page.route('https://design.test/**', async (route) => {
      const url = new URL(route.request().url()),
        name = url.pathname,
        method = route.request().method();
      if (name.startsWith('/apps/mvmdesign/'))
        return route.fulfill({
          path: path.join(app, 'public', name.slice('/apps/mvmdesign/'.length)),
          contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript',
        });
      if (name === '/pub/mvmfonts/client.js')
        return route.fulfill({
          contentType: 'text/javascript',
          body: 'window.MvmFontsClient={families:[],load:async opts=>{window.fontOptions=opts;return []},ready:async()=>{},has:()=>false};',
        });
      if (name === '/api/auth/whoami') {
        if (publicMode) forbidden.push(name);
        return route.fulfill({ json: { effective_user: 'fixture' } });
      }
      if (name === '/api/pub/apphub/me')
        return route.fulfill({ json: { id: 'profile1', username: 'reader' } });
      if (name.startsWith('/api/files')) {
        forbidden.push(name);
        return route.fulfill({ status: 403, json: { detail: 'accessDenied' } });
      }
      const base = publicMode ? '/pub/mvmdesign' : '/api/apps/mvmdesign';
      if (name.startsWith(base + '/')) {
        const sub = name.slice(base.length);
        if (publicMode)
          assert.equal(
            route.request().headers()['x-pub-token'],
            'fixture-token',
          );
        if (sub === '/projects' && method === 'GET')
          return route.fulfill({ json: document && !revoked ? [meta()] : [] });
        if (sub === '/projects' && method === 'POST') {
          assert.equal(
            publicMode,
            false,
            'Public users must not create server projects',
          );
          document = route.request().postDataJSON().project;
          creates++;
          return route.fulfill({ json: meta() });
        }
        if (sub === '/projects/server1/preview') {
          if (revoked) return route.fulfill({status:404,json:{detail:'projectUnavailable'}});
          return route.fulfill({json:{project:document}});
        }
        if (sub === '/projects/server1' || sub === '/projects/server1/status') {
          if (revoked)
            return route.fulfill({
              status: 404,
              json: { detail: 'projectUnavailable' },
            });
          if (method === 'PUT') {
            const body = route.request().postDataJSON();
            if (publicMode && role !== 'editor')
              return route.fulfill({
                status: 403,
                json: { detail: 'readOnlyProject' },
              });
            if (body.revision !== revision)
              return route.fulfill({
                status: 409,
                json: { detail: 'projectConflict' },
              });
            document = body.project;
            revision++;
            writes++;
            return route.fulfill({ json: meta() });
          }
          if (!sub.endsWith('/status') && holdOpen) await holdOpen;
          if (failOpen) return route.fulfill({status: 500, json: {detail: 'openFailed'}});
          return route.fulfill({
            json: {
              ...meta(),
              ...(sub.endsWith('/status') ? {} : { project: document }),
            },
          });
        }
        if (sub === '/projects/server1/shares')
          return route.fulfill({ json: [] });
        if (sub.startsWith('/profiles'))
          return route.fulfill({
            json: [
              { id: 'profile1', username: 'reader', display_name: 'Reader' },
            ],
          });
        if (sub === '/projects/server1/shares/profile1') {
          role = route.request().postDataJSON()?.role || 'viewer';
          return route.fulfill({ json: { ok: true } });
        }
        throw Error('Unexpected API ' + method + ' ' + sub);
      }
      if (name === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}:root{--bg:#f5f6fa;--surface:#fff;--text:#202635;--border:#c9cdd8;--accent:#6352d8;--on-accent:#fff}</style><link rel="stylesheet" href="/apps/mvmdesign/design.css"><div id="root" style="height:100%"></div><script>window.asset=s=>s;window.mvmOS={lang:'en'};${publicMode ? "localStorage.setItem('apphub_token','fixture-token');" : ''}</script>${['i18n', 'model', 'render', 'export', 'projects', 'editor'].map((f) => `<script src="/apps/mvmdesign/${f}.js"></script>`).join('')}<script>window.editor=new MvmDesign.Editor(document.querySelector('#root'),${publicMode ? "{public:true,token:'fixture-token',user:{id:'profile1'}}" : '{}'});editor.ready.then(()=>editor.projectDialog());</script>`,
        });
      throw Error('Unexpected fixture ' + name);
    });
    await page.goto('https://design.test/');
    await page.locator('.md-project-dialog').waitFor();
    assert.equal(await page.locator('[data-project-action=save]').count(), 0);
    assert.equal(await page.locator('[data-project-action=save-as]').count(), 0);
    assert.equal(await page.locator('[data-project-action=download]').count(), 0);
    await page.locator('[data-project-action=new]').click();
    await page.locator('.md-modal:last-child [data-apply]').click();
    await page.waitForFunction(() => !document.querySelector('.md-project-home'));
    await page.evaluate(() => editor.projectDialog());
    assert.equal(await page.locator('[data-project-action=save]').count(), 1);
    await page.locator('[data-cancel]').click();
    // An owner creates the server original. Existing project media/styles are preserved.
    await page.evaluate(() => {
      editor.p.name = 'Four line template';
      editor.p.pages[0].background = '#24465b';
      editor.p.pages[0].items = [Object.assign(MvmDesignModel.item('text'), {text:'FOUR LINE TEMPLATE',x:0.1,y:0.3,w:0.8,h:0.4,fontSize:100,color:'#ffffff'})];
      editor.p.captionStyles = [
        { id: 'first', name: 'First line', style: { y: 0.1 } },
      ];
      editor.action('save');
    });
    await page.locator('[data-server-name]').fill('Four line template');
    await page.locator('[data-server-name]').press('Enter');
    await page.waitForFunction(() => editor.projects.current?.id === 'server1');
    assert.equal(creates, 1);
    assert.equal(document.captionStyles[0].id, 'first');
    await page.evaluate(async () => {
      editor.p.name = 'Updated original';
      await editor.save();
    });
    assert.equal(writes, 1);
    assert.equal(document.name, 'Updated original');
    await page.locator('[data-action=share-project]').click();
    await page.locator('[data-profile-search]').fill('reader');
    await page.locator('[data-grant="0"]').click();
    await page.locator('[data-cancel]').click();
    await page.reload();
    assert.equal(await page.locator('[data-project-action=save]').count(), 0);
    await page.locator('[data-server-project="0"] .md-project-cover img').waitFor();
    const pixels = await page.locator('[data-server-project="0"] .md-project-cover img').evaluate(img => ({loaded:img.complete && img.naturalWidth > 0}));
    assert.equal(pixels.loaded, true);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        for (const [key, value] of Object.entries(theme === 'dark'
          ? {'--bg':'#171b29','--surface':'#252b3b','--text':'#edf0ff','--border':'#495268'}
          : {'--bg':'#f5f6fa','--surface':'#fff','--text':'#202635','--border':'#c9cdd8'})) document.documentElement.style.setProperty(key,value);
      }, theme);
      const dir = process.env.ARTIFACT_DIR || '/tmp/mvmdesign-check';
      fs.mkdirSync(dir, {recursive:true});
      await page.screenshot({path:path.join(dir, 'project-home-' + theme + '.png')});
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.md-project-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({path:path.join(process.env.ARTIFACT_DIR || '/tmp/mvmdesign-check', 'project-home-phone.png')});
    await page.setViewportSize({width:1440,height:1000});
    let releaseOpen;
    holdOpen = new Promise(resolve => { releaseOpen = resolve; });
    await page.locator('[data-server-project="0"]').click();
    await page.locator('.md-project-busy').waitFor();
    assert.match(await page.locator('.md-project-busy').textContent(), /Opening project/);
    assert.equal(await page.evaluate(() => editor.projects.open('server1')), false);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        document.documentElement.style.setProperty('--bg', theme === 'dark' ? '#171b29' : '#f5f6fa');
        document.documentElement.style.setProperty('--text', theme === 'dark' ? '#edf0ff' : '#202635');
      }, theme);
      const dir = process.env.ARTIFACT_DIR || '/tmp/mvmdesign-check';
      fs.mkdirSync(dir, {recursive:true});
      await page.screenshot({path:path.join(dir, 'project-opening-' + theme + '.png')});
    }
    releaseOpen();
    holdOpen = null;
    await page.waitForFunction(() => editor.projects.current?.role === 'owner');
    assert.equal(
      await page.evaluate(() => editor.p.captionStyles[0].id),
      'first',
    );
    assert.equal(await page.locator('.md-project-busy').count(), 0);
    failOpen = true;
    assert.equal(await page.evaluate(async () => {
      try { await editor.projects.open('server1'); } catch (e) { return e.message; }
    }), 'openFailed');
    assert.equal(await page.locator('.md-project-busy').count(), 0);
    assert.equal(await page.evaluate(() => editor.projectBusy), false);
    failOpen = false;
    // Public profiles see shared originals and local projects, never Linux folder actions.
    publicMode = true;
    await page.reload();
    await page.locator('[data-server-project="0"]').waitFor();
    assert.equal(
      await page.locator('[data-project-action=open-server]').count(),
      0,
    );
    assert.equal(
      await page.locator('[data-project-action=save-as]').count(),
      0,
    );
    await page.locator('[data-server-project="0"]').click();
    await page.waitForFunction(
      () => editor.projects.current?.role === 'viewer',
    );
    assert.deepEqual(await page.evaluate(() => fontOptions), {
      token: 'fixture-token',
    });
    assert.equal(
      await page.locator('[data-action=share-project]').isVisible(),
      false,
    );
    await page.evaluate(() => {
      editor.p.name = 'Local viewer change';
      editor.dirty = true;
    });
    const download = page.waitForEvent('download');
    await page.locator('[data-action=save]').click();
    assert.match((await download).suggestedFilename(), /\.mvmdesign$/);
    assert.equal(document.name, 'Updated original');
    assert.equal(writes, 1);
    assert.equal(await page.evaluate(() => editor.dirty), false);
    // Explicitly downloaded local copy is available after restart.
    await page.reload();
    await page.locator('[data-recent="0"]').waitFor();
    assert.match(
      await page.locator('[data-recent="0"]').textContent(),
      /Local viewer change/,
    );
    await page.locator('[data-recent="0"]').click();
    await page.waitForFunction(() => editor.p.name === 'Local viewer change');
    assert.equal(await page.evaluate(() => editor.projects.current), null);
    role = 'editor';
    await page.evaluate(() => editor.projectDialog());
    await page.locator('[data-server-project="0"]').click();
    await page.waitForFunction(
      () => editor.projects.current?.role === 'editor',
    );
    await page.evaluate(async () => {
      editor.p.name = 'Public editor change';
      await editor.save();
    });
    assert.equal(document.name, 'Public editor change');
    assert.equal(writes, 2);
    // A stale editor cannot overwrite a newer version, and keeps its edits.
    revision++;
    const conflict = await page.evaluate(async () => {
      editor.p.name = 'Unsaved change';
      editor.dirty = true;
      try {
        await editor.save();
        return null;
      } catch (e) {
        return e.message;
      }
    });
    assert.equal(conflict, 'projectConflict');
    assert.equal(document.name, 'Public editor change');
    assert.equal(await page.evaluate(() => editor.dirty), true);
    role = 'viewer';
    await page.evaluate(() => editor.projects.checkAccess());
    assert.equal(
      await page.evaluate(() => editor.projects.current.role),
      'viewer',
    );
    // Revocation removes the loaded project and Undo data; no implicit cache survives.
    revoked = true;
    await page.evaluate(() => editor.projects.checkAccess());
    assert.equal(await page.evaluate(() => editor.projects.current), null);
    assert.equal(await page.evaluate(() => editor.p.name), '');
    assert.equal(await page.evaluate(() => editor.undo.length), 0);
    await page
      .locator('[data-server-project]')
      .count()
      .then((n) => assert.equal(n, 0));
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        if (theme === 'dark') {
          document.documentElement.style.setProperty('--bg', '#171b29');
          document.documentElement.style.setProperty('--surface', '#252b3b');
          document.documentElement.style.setProperty('--text', '#edf0ff');
        }
      }, theme);
      const dir = process.env.ARTIFACT_DIR || '/tmp/mvmdesign-check';
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, 'shared-start-' + theme + '.png'),
      });
    }
    assert.deepEqual(forbidden, []);
    assert.deepEqual(errors, []);
    console.log(
      'PASS server originals, profile sharing, local public copies, editor save, revision conflicts, downgrade, revocation and no filesystem API access.',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
