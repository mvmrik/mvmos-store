// PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/racelandia/tools/test-driving-inputs-browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../public');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const moduleUrl = name => 'data:text/javascript;base64,' + Buffer.from(read(name)).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="host" style="width:196px"></div>');
    await page.addStyleTag({ content: read('style.css') });
    await page.addScriptTag({ content: read('i18n.js') });
    const result = await page.evaluate(async ({ meters, audio }) => {
      const M = await import(meters), A = await import(audio), host = document.querySelector('#host');
      host.innerHTML = M.drivingMetersHtml(k => window._i18n[k]);
      async function render(throttle, playing) {
        const ac = new OfflineAudioContext(2, 48000, 48000);
        const engine = A.createEngineAudio({ context: ac, enabled: true });
        // The instruments and audio receive the same pedal sample, at the
        // same RPM. A rising engine pitch alone must not imply full throttle.
        const state = { rpm: 10000, gear: 5, thr: throttle, brk: 0, speed: 0, time: 1, playing, camera: 'chase' };
        M.updateDrivingMeters(host, state);
        const shown = parseFloat(host.querySelector('[data-hud-throttle]').style.width) / 100;
        engine.update({ ...state, throttle: state.thr });
        const buffer = await ac.startRendering();
        let sum = 0, count = 0;
        for (let channel = 0; channel < 2; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 24000; i < samples.length; i++) { sum += samples[i] ** 2; count++; }
        }
        engine.destroy();
        return { rms: Math.sqrt(sum / count), shown };
      }
      return { coast: await render(0, true), loaded: await render(1, true), paused: await render(1, false) };
    }, { meters: moduleUrl('division.js'), audio: moduleUrl('engine-audio.js') });
    assert.equal(result.coast.shown, 0);
    assert.equal(result.loaded.shown, 1);
    assert.ok(result.loaded.rms > result.coast.rms * 2.5, 'Released throttle must sound unloaded at the same RPM');
    assert.ok(result.paused.rms < 1e-8, 'Paused playback must be silent');
    console.log('PASS: real browser meters and rendered audio use the same pedal input; loaded/overrun sound and pause');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
