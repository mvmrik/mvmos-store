// MVMAI_PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/mvmai/tests/test_theme_contrast.cjs
const { chromium } = require(process.env.MVMAI_PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const base = path.resolve(__dirname, '../../../');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const source = read('apps/mvmai/public/mvmai-widget.js');
const styles = source.slice(source.indexOf('  var stylesInjected'), source.indexOf('  function mount('));
const layout = read('backend/apphub_pub/layout.js');
const appearance = layout.slice(0, layout.indexOf('  function renderAvatar(')) + 'window.applyPublicTheme=applyTheme;})();';
const desktop = read('frontend/mvmos.js');
(async () => {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  try {
    for (const width of [390, 1280]) for (const mode of ['desktop', 'public']) {
      const page = await browser.newPage({viewport:{width,height:800}});
      await page.route('http://contrast.test/**', route => route.fulfill({contentType:'text/html', body:`<!doctype html><html><head></head><body>
        <main class="mvmai-widget ${mode === 'desktop' ? 'mvmai-desktop' : ''}" style="height:760px">
        <section class="mvmai-chat-col"><div class="mvmai-list">
        <div class="mvmai-msg user">A sample message <a href="#example">with a link</a><div class="mvmai-msg-meta"><span class="mvmai-msg-time">03/11/2026 19:44</span></div></div>
        <div class="mvmai-msg assistant">A sample answer</div>
        <button class="mvmai-start-new">New chat</button><button class="mvmai-confirm-yes">Confirm</button>
        <button class="mvmai-send">Send</button><button class="mvmai-exec-btn auto">Auto</button>
        <span class="mvmai-badge">Assistant</span><div class="mvmai-gal-tabs"><button class="on">Files</button></div>
        <button class="mvmai-model-confirm">Select model</button>
        </div></section></main></body></html>`}));
      await page.goto('http://contrast.test');
      await page.addScriptTag({content:styles + '\ninjectStyles();'});
      // No canvas readback, matching privacy-restricted browsers.
      await page.evaluate(() => {HTMLCanvasElement.prototype.getContext = () => {throw Error('Canvas blocked');};});
      if (mode === 'desktop') {
        await page.addStyleTag({content:read('frontend/style.css')});
        await page.addScriptTag({content:desktop.slice(0, desktop.indexOf('  // System actions'))+'return {};})();'});
        // A public component may have registered its own surface colours.
        // The desktop chat must still use the desktop accent/foreground pair.
        await page.addStyleTag({content:':root{--pub-surface1:#fff}'});
      } else {
        await page.addScriptTag({content:read('frontend/accent-contrast.js')});
        await page.addScriptTag({content:appearance});
      }
      const themes = mode === 'desktop' ? ['light','catppuccin','windows11'] : ['light','dark'];
      for (const theme of themes) {
        if (mode === 'desktop') await page.addStyleTag({content:read(`themes/${theme}/theme.css`)});
        else await page.evaluate(theme => window.applyPublicTheme(theme), theme);
        await page.waitForTimeout(220);
        const results = await page.evaluate(() => {
          const lum = rgb => rgb.slice(0,3).map(v => {v/=255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const rgb = color => color.match(/[\d.]+/g).map(Number);
          return ['.mvmai-msg.user','.mvmai-msg.user a','.mvmai-msg-time','.mvmai-start-new','.mvmai-confirm-yes','.mvmai-send','.mvmai-exec-btn.auto','.mvmai-badge','.mvmai-gal-tabs .on','.mvmai-model-confirm'].map(selector => {
            const el = document.querySelector(selector); let chain=[], current=el, bg=[255,255,255];
            while(current){chain.unshift(current);current=current.parentElement;}
            for(const node of chain){const c=rgb(getComputedStyle(node).backgroundColor), alpha=c.length>3?c[3]:1;bg=bg.map((v,i)=>c[i]*alpha+v*(1-alpha));}
            const a=lum(rgb(getComputedStyle(el).color)), b=lum(bg);
            return {selector,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:getComputedStyle(el).color};
          });
        });
        for (const result of results) assert(result.contrast >= 4.5, JSON.stringify({mode,theme,width,...result}));
        await page.screenshot({path:`/tmp/mvmai-contrast-${mode}-${theme}-${width}.png`});
        console.log(`PASS ${mode} ${theme} ${width}px: messages, links, timestamps and accent controls`);
      }
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
