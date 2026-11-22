// Image resampling, alpha-preserving recoloring, editor history and export regression.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    await page.route('https://design.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name.startsWith('/apps/mvmdesign/')) return route.fulfill({
        path:path.join(app,'public',name.slice('/apps/mvmdesign/'.length)),
        contentType:name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript',
      });
      if (name === '/api/auth/whoami') return route.fulfill({json:{effective_user:'fixture'}});
      if (name === '/pub/mvmfonts/client.js') return route.fulfill({contentType:'text/javascript',body:'window.MvmFontsClient={families:[],load:async()=>[],ready:async()=>{},has:()=>false};'});
      if (name === '/') return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}:root{--bg:#f5f6fa;--surface:#fff;--text:#202635;--border:#c9cdd8;--accent:#6352d8;--on-accent:#fff}</style><link rel="stylesheet" href="/apps/mvmdesign/design.css"><div id="root" style="height:100%"></div><script>window.asset=s=>s;window.mvmOS={lang:'en'};</script>${['i18n','model','render','export','editor'].map(f=>`<script src="/apps/mvmdesign/${f}.js"></script>`).join('')}<script>window.editor=new MvmDesign.Editor(document.querySelector('#root'));</script>`});
      throw Error('Unexpected fixture '+name);
    });
    await page.goto('https://design.test/');
    await page.waitForFunction(()=>editor.db);
    // Full-page images must fill every corner, including legacy hidden radii.
    const corners = await page.evaluate(async () => {
      const M=MvmDesignModel,R=MvmDesignRender,X=MvmDesignExport;
      const source=document.createElement('canvas');source.width=320;source.height=180;
      const sourceCtx=source.getContext('2d');sourceCtx.fillStyle='#e0a040';sourceCtx.fillRect(0,0,320,180);
      const p=M.project();p.width=320;p.height=180;p.pages[0].bg='#102080';p.pages[0].gradient=false;
      p.assets.corner={src:source.toDataURL()};p.sequence[0].duration=.3;
      const it=Object.assign(M.item('image'),{assetId:'corner',x:0,y:0,w:1,h:1});p.pages[0].items=[it];
      await R.prepare(p);
      const out=document.createElement('canvas');out.width=320;out.height=180;const ctx=out.getContext('2d');
      const read=()=>[[0,0],[319,0],[0,179],[319,179]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
      R.page(ctx,p,p.pages[0],320,180);const fresh=read();
      it.radius=.02;
      R.page(ctx,p,p.pages[0],320,180);const legacy=read();
      R.video(ctx,p,.1,320,180);const frame=read();
      const png=await createImageBitmap(await X.images(p,p.pages,'png',1));ctx.drawImage(png,0,0);const image=read();png.close();
      const result=await X.video(p,{container:'webm',quality:'max',fps:30});
      const url=URL.createObjectURL(result.blob),video=document.createElement('video');video.muted=true;video.src=url;
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('Video decode failed'));});
      ctx.drawImage(video,0,0);const encoded=read();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
      return {fresh,legacy,frame,image,encoded,radius:M.item('image').radius};
    });
    assert.equal(corners.radius,0);
    for(const name of ['fresh','legacy','frame','image'])
      for(const pixel of corners[name]) assert.deepEqual(pixel,[224,160,64,255],name);
    for(const pixel of corners.encoded) {
      assert.ok(Math.abs(pixel[0]-224)<12&&Math.abs(pixel[1]-160)<12&&Math.abs(pixel[2]-64)<12,JSON.stringify(corners));
      assert.equal(pixel[3],255);
    }
    const quality = await page.evaluate(async () => {
      const M=MvmDesignModel,R=MvmDesignRender;
      const stripes=document.createElement('canvas');stripes.width=stripes.height=2048;
      const s=stripes.getContext('2d');s.fillStyle='white';s.fillRect(0,0,2048,2048);s.fillStyle='black';
      for(let x=0;x<2048;x+=6)s.fillRect(x,0,3,2048);
      const p=M.project();p.width=p.height=256;p.pages[0].gradient=false;
      p.assets.stripes={src:stripes.toDataURL('image/png')};
      p.pages[0].items=[Object.assign(M.item('image'),{assetId:'stripes',x:0,y:0,w:1,h:1,radius:0})];
      await R.prepare(p);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=73;
      const ctx=canvas.getContext('2d');R.page(ctx,p,p.pages[0],73,73);
      const pixels=ctx.getImageData(0,0,73,73).data;
      const raw=document.createElement('canvas');raw.width=raw.height=73;
      const low=raw.getContext('2d');low.drawImage(stripes,0,0,73,73);
      const original=low.getImageData(0,0,73,73).data;
      const variance=data=>{const a=[];for(let x=3;x<70;x++)a.push(data[(36*73+x)*4]);const mean=a.reduce((a,b)=>a+b,0)/a.length;return a.reduce((n,x)=>n+(x-mean)**2,0)/a.length;};
      return {smooth:variance(pixels),old:variance(original)};
    });
    assert.ok(quality.old>100,JSON.stringify(quality));
    assert.ok(quality.smooth<quality.old/10,JSON.stringify(quality));
    const checks=await page.evaluate(async () => {
      const M=MvmDesignModel,R=MvmDesignRender;
      const logo=document.createElement('canvas');logo.width=logo.height=1024;
      const c=logo.getContext('2d');c.strokeStyle='#b77a24';c.lineWidth=9;c.beginPath();c.arc(512,430,270,0,Math.PI*2);c.stroke();
      c.fillStyle='#b77a24';c.font='bold 100px serif';c.textAlign='center';c.fillText('LYRA',512,800);c.fillText('STUDIO',512,910);
      c.fillRect(460,250,100,350);
      const src=logo.toDataURL('image/png'),p=M.project();p.width=p.height=256;p.pages[0].bg='rgba(0,0,0,0)';p.pages[0].gradient=false;
      p.assets.logo={src,name:'Transparent logo.png'};
      const it=Object.assign(M.item('image'),{assetId:'logo',x:.25,y:.25,w:.5,h:.5,radius:0,fit:'contain'});p.pages[0].items=[it];
      await R.prepare(p);
      const render=video=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');if(video)R.video(ctx,p,0,256,256);else R.page(ctx,p,p.pages[0],256,256);return ctx.getImageData(0,0,256,256).data;};
      const original=render();it.imageTint=true;it.imageTintColor='#20c080';const colored=render();
      let alphaError=0,colorError=0,soft=0;
      for(let i=0;i<colored.length;i+=4){alphaError=Math.max(alphaError,Math.abs(original[i+3]-colored[i+3]));if(colored[i+3]>100)colorError=Math.max(colorError,Math.abs(colored[i]-32),Math.abs(colored[i+1]-192),Math.abs(colored[i+2]-128));if(colored[i+3]>0&&colored[i+3]<255)soft++;}
      const copy=M.normalize(JSON.parse(JSON.stringify(p)));const saved=copy.pages[0].items[0];
      const blob=await MvmDesignExport.images(p,p.pages,'png',1);
      const image=await createImageBitmap(blob),out=document.createElement('canvas');out.width=out.height=256;const ctx=out.getContext('2d');ctx.drawImage(image,0,0);const exported=ctx.getImageData(0,0,256,256).data;
      p.pages[0].bg='#123456';
      const opaque=render(),video=render(true);
      const equal=(a,b)=>a.every((v,i)=>v===b[i]);
      p.width=1920;p.height=1080;p.name='Image quality check';p.pages[0].bg='#24465b';p.pages[0].bg2='#3c264b';p.pages[0].gradient=true;
      Object.assign(it,{x:.035,y:.65,w:.14,h:.26,imageTintColor:'#ffffff'});
      await editor.installProject(p);editor.itemId=it.id;editor.renderPanels();editor.draw();
      window.originalLogoSource=src;
      return {alphaError,colorError,soft,png:equal(colored,exported),video:equal(opaque,video),saved:saved.imageTint&&saved.imageTintColor==='#20c080',source:copy.assets.logo.src===src};
    });
    assert.ok(checks.alphaError<=1,JSON.stringify(checks));
    assert.ok(checks.colorError<=2,JSON.stringify(checks));
    assert.ok(checks.soft>100,JSON.stringify(checks));
    assert.ok(checks.png&&checks.video&&checks.saved&&checks.source,JSON.stringify(checks));
    await page.locator('[data-inspector-tab=style]').click();
    await page.locator('[data-action=image-black]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].imageTintColor),'#000000');
    await page.locator('[data-action=undo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].imageTintColor),'#ffffff');
    await page.locator('[data-action=redo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].imageTintColor),'#000000');
    await page.evaluate(()=>{editor.itemId=editor.pg.items[0].id;editor.renderPanels();});
    await page.locator('[data-action=image-original]').click();
    assert.equal(await page.evaluate(()=>editor.it.imageTint),false);
    await page.locator('[data-action=image-white]').click();
    assert.equal(await page.evaluate(()=>editor.it.imageTint),true);
    await page.locator('[data-action=image-original]').click();
    assert.equal(await page.locator('[data-prop=imageTintColor]').isVisible(),false);
    await page.locator('[data-prop=imageTint]').check();
    await page.locator('[data-prop=imageTintColor]').fill('#ffbb33');
    await page.locator('[data-prop=imageTintColor]').blur();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].imageTintColor),'#ffbb33');
    assert.equal(await page.evaluate(()=>editor.it.imageTint),true);
    await page.locator('[data-action=undo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].imageTintColor),'#ffffff');
    assert.equal(await page.evaluate(()=>editor.p.assets.logo.src===originalLogoSource),true);
    await page.evaluate(()=>{editor.itemId=editor.pg.items[0].id;editor.renderPanels();});
    await page.locator('[data-action=image-white]').click();
    await page.evaluate(()=>{editor.itemId=editor.pg.items[0].id;editor.renderPanels();});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{for(const [key,value] of Object.entries(theme==='dark'?{'--bg':'#171b29','--surface':'#252b3b','--text':'#edf0ff','--border':'#495268'}:{'--bg':'#f5f6fa','--surface':'#fff','--text':'#202635','--border':'#c9cdd8'}))document.documentElement.style.setProperty(key,value);},theme);
      const dir=process.env.ARTIFACT_DIR||'/tmp/mvmdesign-check';fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'image-color-'+theme+'.png')});
    }
    // A newly added backdrop covers the logo until its layer is raised.
    const ids = await page.evaluate(async () => {
      const M=MvmDesignModel;
      const background=document.createElement('canvas');background.width=background.height=512;
      const ctx=background.getContext('2d');const gradient=ctx.createLinearGradient(0,0,512,512);gradient.addColorStop(0,'#d3a661');gradient.addColorStop(1,'#26354c');ctx.fillStyle=gradient;ctx.fillRect(0,0,512,512);
      editor.p.assets.backdrop={src:background.toDataURL('image/png'),name:'Evening backdrop.png'};
      const logo=editor.pg.items[0];
      const text=Object.assign(M.item('text'),{text:'LYRA STUDIO',x:.1,y:.15,w:.8,h:.2});
      const shape=Object.assign(M.item('shape'),{shape:'ellipse',x:.7,y:.6,w:.1,h:.1,color:'#cc6655'});
      const backdrop=Object.assign(M.item('image'),{assetId:'backdrop',x:0,y:0,w:1,h:1,radius:0});
      editor.pg.items=[logo,text,shape,backdrop];editor.itemId=null;
      await MvmDesignRender.prepare(editor.p);editor.renderPanels();editor.draw();
      return {logo:logo.id,text:text.id,shape:shape.id,backdrop:backdrop.id};
    });
    await page.locator('[data-inspector-tab=layers]').click();
    assert.equal(await page.locator('.md-layer-row').count(),4);
    assert.equal(await page.locator('[data-panel=layers] [data-action=front]').isDisabled(),true);
    assert.match(await page.locator('.md-layer-row').first().textContent(),/Evening backdrop/);
    await page.locator(`[data-action="layer-${ids.logo}"]`).click();
    assert.equal(await page.locator('[data-panel=layers]').isVisible(),true);
    assert.equal(await page.locator(`[data-action="layer-${ids.logo}"]`).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-panel=layers] [data-action=lower-layer]').isDisabled(),true);
    const thumbnailPixels=await page.locator('[data-layer-preview]').evaluateAll(canvases=>canvases.map(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return data.some((v,i)=>i%4===3&&v>0);}));
    assert.deepEqual(thumbnailPixels,[true,true,true,true]);
    await page.locator('[data-panel=layers] [data-action=raise-layer]').click();
    assert.deepEqual(await page.evaluate(()=>editor.pg.items.map(i=>i.id)),[ids.text,ids.logo,ids.shape,ids.backdrop]);
    await page.locator('[data-panel=layers] [data-action=front]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items.at(-1).id),ids.logo);
    assert.equal(await page.locator('.md-layer-row').first().getAttribute('data-action'),'layer-'+ids.logo);
    assert.equal(await page.locator('[data-panel=layers] [data-action=raise-layer]').isDisabled(),true);
    await page.locator('[data-action=undo]').click();
    assert.deepEqual(await page.evaluate(()=>editor.pg.items.map(i=>i.id)),[ids.text,ids.logo,ids.shape,ids.backdrop]);
    await page.locator('[data-action=redo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items.at(-1).id),ids.logo);
    await page.locator(`[data-action="layer-${ids.logo}"]`).click();
    await page.locator('[data-panel=layers] [data-action=lower-layer]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items.at(-2).id),ids.logo);
    await page.locator('[data-panel=layers] [data-action=back]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].id),ids.logo);
    await page.locator('[data-panel=layers] [data-action=front]').click();
    // Normalization assigns item identifiers; order and asset references persist.
    assert.equal(await page.evaluate(()=>MvmDesignModel.normalize(JSON.parse(JSON.stringify(editor.p))).pages[0].items.at(-1).assetId),'logo');
    await page.evaluate(()=>{editor.it.locked=true;editor.renderPanels();});
    assert.equal(await page.locator('[data-panel=layers] [data-action=back]').isDisabled(),true);
    await page.evaluate(()=>{editor.it.locked=false;editor.renderPanels();});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{for(const [key,value] of Object.entries(theme==='dark'?{'--bg':'#171b29','--surface':'#252b3b','--text':'#edf0ff','--border':'#495268'}:{'--bg':'#f5f6fa','--surface':'#fff','--text':'#202635','--border':'#c9cdd8'}))document.documentElement.style.setProperty(key,value);},theme);
      const dir=process.env.ARTIFACT_DIR||'/tmp/mvmdesign-check';await page.screenshot({path:path.join(dir,'image-layers-'+theme+'.png')});
    }
    // Resize with the actual pointer: snap near an edge, pass through it, and bypass with Alt.
    const history=await page.evaluate(()=>{
      const image=editor.pg.items.find(i=>i.assetId==='backdrop');
      Object.assign(image,{x:0,y:0,w:.7,h:.7});editor.pg.items=[image];editor.itemId=image.id;
      editor.renderPanels();editor.draw();return editor.undo.length;
    });
    const rect=await page.evaluate(()=>{const r=editor.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    const near={x:rect.x+rect.width-3,y:rect.y+rect.height-3};
    await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.7);
    await page.mouse.down();
    await page.mouse.move(near.x,near.y,{steps:5});
    assert.deepEqual(await page.evaluate(()=>[editor.it.w,editor.it.h,editor.guides.length]),[1,1,2]);
    await page.mouse.move(rect.x+rect.width+18,rect.y+rect.height+18);
    assert.equal(await page.evaluate(()=>editor.it.w>1&&editor.it.h>1&&editor.guides.length===0),true);
    await page.keyboard.down('Alt');
    await page.mouse.move(near.x,near.y);
    assert.equal(await page.evaluate(()=>editor.it.w<1&&editor.it.h<1&&editor.guides.length===0),true);
    await page.keyboard.up('Alt');
    await page.mouse.move(near.x+1,near.y+1);
    assert.deepEqual(await page.evaluate(()=>[editor.it.w,editor.it.h,editor.guides.length]),[1,1,2]);
    await page.screenshot({path:path.join(process.env.ARTIFACT_DIR||'/tmp/mvmdesign-check','image-resize-snap.png')});
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>editor.guides.length),0);
    assert.equal(await page.evaluate(()=>editor.undo.length),history+1);
    await page.locator('[data-action=undo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].w),.7);
    await page.locator('[data-action=redo]').click();
    assert.equal(await page.evaluate(()=>editor.pg.items[0].w),1);
    assert.deepEqual(errors,[]);
    console.log('PASS progressive downsampling ('+quality.old.toFixed(1)+' → '+quality.smooth.toFixed(1)+' stripe variance), transparent recoloring, PNG/video frame parity, project round trip, original preservation, image controls, layer previews and names, selection, four ordering actions, locked layers, soft resize snapping, oversize release, Alt bypass, Undo/Redo and themes.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
