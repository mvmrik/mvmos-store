/* Sample-based combustion voice, generated locally once per audio context.
 * Six firing pulses per four-stroke cycle, alternating exhaust banks. Three
 * overlapping RPM recordings keep the exhaust body from becoming a pure buzz.
 * No assets, audio worklets, network requests or per-sample JavaScript at runtime.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
function combustionBuffer(ac,rpm){
  const cycles=40,cycle=120/rpm,N=Math.round(cycles*cycle*ac.sampleRate),buffer=ac.createBuffer(2,N,ac.sampleRate);
  const amplitudes=[1,.91,1.07,.96,1.02,.94];let peak=0;
  for(let ch=0;ch<2;ch++){
    const out=buffer.getChannelData(ch);
    for(let i=0;i<N;i++){
      const phase=i/N*cycles,turn=phase%1;
      // Periodic broadband texture means a seamless loop without a pitched saw wave.
      const noise=.35*Math.sin(2*Math.PI*991*i/N)+.28*Math.sin(2*Math.PI*1877*i/N)+.21*Math.sin(2*Math.PI*3541*i/N)+.16*Math.sin(2*Math.PI*5113*i/N);
      let value=0;
      for(let cylinder=0;cylinder<6;cylinder++){
        const dt=((turn-cylinder/6+1)%1)*cycle;if(dt>.020)continue;
        const bank=cylinder%2===ch?1:.36;
        const pulse=Math.exp(-dt*850)-Math.exp(-dt*2600);
        const exhaust=Math.exp(-dt*330)*(Math.sin(2*Math.PI*690*dt)+.42*Math.sin(2*Math.PI*1470*dt)+.19*Math.sin(2*Math.PI*2930*dt));
        value+=bank*amplitudes[cylinder]*(1+.035*Math.sin(2*Math.PI*phase/5))*(1.1*pulse+.48*exhaust+.24*noise*Math.exp(-dt*500));
      }
      out[i]=value;peak=Math.max(peak,Math.abs(value));
    }
  }
  for(let ch=0;ch<2;ch++){const out=buffer.getChannelData(ch);for(let i=0;i<N;i++)out[i]*=.65/Math.max(.1,peak);}
  return buffer;
}
function noiseBuffer(ac){
  const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),a=b.getChannelData(0);let seed=86429;
  for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a[i]=(seed/2147483648-1)*.5;}
  return b;
}
export function createEngineAudio(options={}){
  const C=options.context?null:(window.AudioContext||window.webkitAudioContext);
  if(!options.context&&!C)return {update(){},setEnabled(){},resume(){},destroy(){}};
  const ac=options.context||new C(),owned=!options.context,nodes=[],sources=[];
  const add=n=>{nodes.push(n);return n;},master=add(ac.createGain()),compressor=add(ac.createDynamicsCompressor());
  compressor.threshold.value=-14;compressor.knee.value=14;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.12;
  const exhaust=add(ac.createBiquadFilter());exhaust.type='lowpass';exhaust.Q.value=.5;exhaust.frequency.value=6000;
  const dc=add(ac.createBiquadFilter());dc.type='highpass';dc.frequency.value=65;dc.Q.value=.5;
  exhaust.connect(dc);dc.connect(compressor);compressor.connect(master);master.connect(options.destination||ac.destination);master.gain.value=0;
  const layers=[4000,7200,10800].map(rpm=>{
    const source=add(ac.createBufferSource()),gain=add(ac.createGain());source.buffer=combustionBuffer(ac,rpm);source.loop=true;gain.gain.value=0;
    source.connect(gain);gain.connect(exhaust);source.start();sources.push(source);return {source,gain,rpm};
  });
  const noise=add(ac.createBufferSource());noise.buffer=noiseBuffer(ac);noise.loop=true;
  const intake=add(ac.createBiquadFilter()),airGain=add(ac.createGain());intake.type='bandpass';intake.frequency.value=1700;intake.Q.value=.55;airGain.gain.value=0;
  noise.connect(intake);intake.connect(airGain);airGain.connect(compressor);noise.start();sources.push(noise);
  const turbo=add(ac.createOscillator()),turboGain=add(ac.createGain());turbo.type='sine';turboGain.gain.value=0;turbo.connect(turboGain);turboGain.connect(compressor);turbo.start();sources.push(turbo);
  const shift=add(ac.createGain());shift.gain.value=0;
  const shiftFilter=add(ac.createBiquadFilter());shiftFilter.type='lowpass';shiftFilter.frequency.value=1700;
  noise.connect(shiftFilter);shiftFilter.connect(shift);shift.connect(compressor);
  let enabled=options.enabled!==false,dead=false,lastGear=0,lastTime=null,lastShift=-1,lastState=null;
  const target=(param,value,tau=.035)=>param.setTargetAtTime(value,ac.currentTime,tau);
  function resume(){if(!dead&&enabled&&(ac.state==='suspended'||ac.state==='interrupted'))ac.resume()?.catch(()=>{});}
  const unlock=()=>resume();if(typeof document!=='undefined'&&owned){['pointerdown','mousedown','touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,unlock,true));}
  function update(state){
    if(dead)return;lastState=state;if(state.playing&&enabled&&(ac.state==='suspended'||ac.state==='interrupted'))ac.resume()?.catch(()=>{});
    const playing=!!state.playing&&enabled;
    if(!playing){target(master.gain,0,.018);lastGear=0;return;}
    const rpm=clamp(state.rpm||3500,2500,13000),load=clamp(state.throttle??state.thr??.2,0,1),gear=state.gear||0,t=ac.currentTime;
    const seek=lastTime!=null&&state.time!=null&&state.time<lastTime;lastTime=state.time;
    const shifted=!seek&&gear>0&&lastGear>0&&gear!==lastGear&&t-lastShift>.12;
    if(shifted){lastShift=t;shift.gain.cancelScheduledValues(t);shift.gain.setValueAtTime(.018+(gear<lastGear?.025:0),t);shift.gain.exponentialRampToValueAtTime(.0001,t+.065);}
    lastGear=gear;
    const position=(rpm-4000)/3400;
    layers.forEach((layer,i)=>{
      const weight=Math.max(0,1-Math.abs(position-i));
      target(layer.source.playbackRate,clamp(rpm/layer.rpm,.4,2.9),shifted?.009:.028);
      const cut=t-lastShift<.045?.38:1;
      // Overrun keeps an engine voice, but must not sound like the driver is
      // still on the accelerator. Use the same pedal sample as the HUD.
      target(layer.gain.gain,Math.sqrt(weight)*(.10+.60*load)*cut,.018);
    });
    const cockpit=state.camera==='cockpit',external=['tv','heli','orbit'].includes(state.camera);
    target(exhaust.frequency,clamp(1800+rpm*.32+load*1800,2000,10000)*(cockpit?.8:1));
    target(intake.frequency,1200+load*1800);
    target(airGain.gain,.018*load+.012*clamp(state.speed||0,0,100)/100);
    target(turbo.frequency,1300+rpm*.25+load*800,.08);target(turboGain.gain,load*.006);
    target(master.gain,external?.34:cockpit?.58:.52,.025);
  }
  resume();
  return {update,resume,get blocked(){return !dead&&enabled&&(ac.state==='suspended'||ac.state==='interrupted');},setEnabled(value){enabled=!!value;if(enabled){resume();if(lastState)update(lastState);}else target(master.gain,0,.015);},
    destroy(){if(dead)return;dead=true;master.gain.cancelScheduledValues(ac.currentTime);master.gain.value=0;
      if(typeof document!=='undefined'&&owned){['pointerdown','mousedown','touchend','click','keydown'].forEach(ev=>document.removeEventListener(ev,unlock,true));}
      sources.forEach(n=>{try{n.stop();}catch(_){}});nodes.forEach(n=>{try{n.disconnect();}catch(_){}});if(owned)ac.close().catch(()=>{});
    }};
}
