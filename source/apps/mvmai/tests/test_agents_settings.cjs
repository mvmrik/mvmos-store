const {chromium}=require(process.env.MVMAI_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const premium of [true,false]){
    const page=await browser.newPage();
    await page.route('http://settings.test/**',route=>{
      if(new URL(route.request().url()).pathname==='/')return route.fulfill({contentType:'text/html',body:'<main id="panel"></main>'});
      return route.fulfill({contentType:'application/json',body:'{"models":[],"cli_providers":[],"users":[]}'});
    });
    await page.goto('http://settings.test/');
    await page.evaluate(premium=>{
      window.writes=[];window.asset=x=>x;window.MvmaiWidget={};
      window.mvmOS={lang:'en',premiumStatus:premium?'premium':'free',db:()=>({query:async()=>[],run:async(sql,args)=>writes.push(args)}),registerApp:app=>window.app=app,premiumGate:()=>{}};
      window.t=k=>window._i18n?.[k]||k;
    },premium);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../public/i18n.js'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../public/main.js'),'utf8')});
    await page.evaluate(()=>app.renderSettingsExtra(document.querySelector('#panel'),{provider:'gemini',agents_enabled:false}));
    const checkbox=page.locator('#mvmai-agents-chk');assert.equal(await checkbox.isDisabled(),!premium);
    assert.equal(await page.locator('#mvmai-agents-label').innerText(),'Enable mvmAgent');
    assert.equal(await page.locator('#mvmai-agent-search-label').innerText(),'Brave Search API key (optional)');
    if(premium){await checkbox.check();await page.locator('#mvmai-agent-search-key').fill('test-key-only');}
    await page.evaluate(()=>app.saveSettingsExtra(document.querySelector('#panel')));
    const writes=await page.evaluate(()=>Object.fromEntries(writes.map(([key,value])=>[key,JSON.parse(value)])));
    if(premium){assert.equal(writes.agents_enabled,true);assert.equal(writes.agent_search_key,'test-key-only');}
    else{assert.equal('agents_enabled' in writes,false);assert.equal('agent_search_key' in writes,false);}
    await page.close();
  }
  console.log('PASS: Premium settings save the agent toggle and optional search key; free settings remain disabled and cannot overwrite them');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
