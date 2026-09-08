(function(){
  if(!window.GameHub||!window.GameHub.mp)return;
  const mp=window.GameHub.mp, tr=(k,v)=>window.t?window.t(k,v):k;
  const NUMBERS=[20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
  let root=null,state=null,pending=[],toastTimer=0;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderSetup(box,settings){
    box.innerHTML=`<div class="sa-card"><div class="sa-options">
      <div class="sa-field"><label>${tr('sa_game')}</label><select id="sa-mode"><option value="501">${tr('sa_501')}</option><option value="cricket">${tr('sa_cricket')}</option><option value="bitcoin">₿ ${tr('sa_bitcoin')}</option></select></div>
      <div class="sa-field" id="sa-wins-wrap"><label>${tr('sa_match')}</label><select id="sa-wins">${[1,2,3,4,5,7].map(n=>`<option value="${n}">${tr('sa_first_to')} ${n} ${tr('sa_rounds')}</option>`).join('')}</select></div>
      <div class="sa-field"><label>${tr('sa_order')}</label><select id="sa-order"><option value="lobby">${tr('sa_lobby_order')}</option><option value="manual">${tr('sa_manual_first')}</option><option value="dice">🎲 ${tr('sa_random_dice')}</option></select></div>
      <div class="sa-field" id="sa-first-wrap" hidden><label>${tr('sa_first_player')}</label><select id="sa-first"></select></div>
    </div><p class="sa-sub" style="margin-top:12px">${tr('sa_ready')} ${tr('sa_all_can_score')}</p></div>`;
    const modeSel=box.querySelector('#sa-mode'),winsWrap=box.querySelector('#sa-wins-wrap'),order=box.querySelector('#sa-order'),wrap=box.querySelector('#sa-first-wrap'),first=box.querySelector('#sa-first');
    if(['501','cricket','bitcoin'].includes(settings?.mode)){modeSel.value=settings.mode;modeSel.disabled=true}
    const fill=()=>{const old=first.value;first.innerHTML=mp.players().map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');if(old)first.value=old};
    const syncMode=()=>{winsWrap.hidden=modeSel.value==='bitcoin'};
    fill();syncMode();order.onchange=()=>{wrap.hidden=order.value!=='manual';fill()};modeSel.onchange=syncMode;
    return()=>({mode:modeSel.value,target_wins:+box.querySelector('#sa-wins').value,order:order.value,first_player_id:first.value||null});
  }
  function renderGame(box){root=box;root.classList.add('sa-game');root.innerHTML=`<div class="sa-shell"><section class="sa-card sa-board-card"><div class="sa-eyebrow" id="sa-turn-label">${tr('sa_turn')}<button class="sa-help-btn" id="sa-help" title="${tr('sa_help')}" aria-label="${tr('sa_help')}">?</button></div><div class="sa-turn-name" id="sa-turn-name">${tr('sa_waiting')}</div><div id="sa-board"></div><div class="sa-row"><div class="sa-darts" id="sa-darts"></div><div class="sa-actions"><button class="sa-btn" id="sa-miss" title="${tr('sa_miss')}" aria-label="${tr('sa_miss')}">🚫</button><button class="sa-btn" id="sa-undo" title="${tr('sa_undo')}" aria-label="${tr('sa_undo')}">↩︎</button><button class="sa-btn primary" id="sa-submit" title="${tr('sa_submit')}" aria-label="${tr('sa_submit')}">✔</button></div></div><div class="sa-sub" id="sa-hint" style="margin-top:8px"></div></section><section><div class="sa-card"><div id="sa-score"></div><div id="sa-checkout"></div><div id="sa-cricket"></div><div id="sa-bitcoin-info"></div></div><div class="sa-card sa-history"><b>${tr('sa_history')}</b><div class="sa-history-list" id="sa-history"><span class="sa-sub">${tr('sa_no_throws')}</span></div></div></section></div><div id="sa-overlay"></div>`;
    root.querySelector('#sa-board').innerHTML=boardSvg();
    root.querySelector('#sa-board').onclick=e=>{const hit=e.target.closest('[data-hit]');if(hit)flashHit(hit)&&addDart(+hit.dataset.number,+hit.dataset.multiplier)};
    root.querySelector('#sa-miss').onclick=()=>addDart(0,0);root.querySelector('#sa-undo').onclick=()=>{pending.pop();drawPending()};root.querySelector('#sa-submit').onclick=submit;
    root.querySelector('#sa-help').onclick=showHelp;
    if(state)draw();
  }
  function showHelp(){
    if(!root)return;
    const kind=state?.mode==='bitcoin'?'bitcoin':state?.mode==='cricket'?'cricket':'501';
    const body=tr('sa_help_'+kind);
    const ov=document.createElement('div');ov.className='sa-help-ov';
    ov.innerHTML=`<div class="sa-help-card"><b>${tr('sa_help_title_'+kind)}</b><p>${esc(body).replace(/\n/g,'<br>')}</p><button class="sa-btn primary" id="sa-help-close">${tr('sa_ok')}</button></div>`;
    document.body.appendChild(ov);
    const close=()=>ov.remove();
    ov.querySelector('#sa-help-close').onclick=close;
    ov.onclick=e=>{if(e.target===ov)close()};
  }
  function flashHit(el){el.classList.remove('sa-hit');void el.getBoundingClientRect();el.classList.add('sa-hit');setTimeout(()=>el.classList.remove('sa-hit'),220);return true}
  function boardSvg(){
    const cx=250,cy=250,parts=[];parts.push('<svg class="sa-board" viewBox="0 0 500 500" role="group" aria-label="Dartboard">');
    parts.push('<circle cx="250" cy="250" r="247" fill="#181a1d"/>');
    const cricketTargets=[20,19,18,17,16,15];
    for(let i=0;i<20;i++){const a0=(i*18-99)*Math.PI/180,a1=((i+1)*18-99)*Math.PI/180,n=NUMBERS[i],light=i%2===0;parts.push(ring(cx,cy,36,196,a0,a1,light?'#eee6d2':'#202326',n,1));parts.push(ring(cx,cy,132,168,a0,a1,light?'#df3345':'#2d9b58',n,3));parts.push(ring(cx,cy,196,232,a0,a1,light?'#df3345':'#2d9b58',n,2));const am=(a0+a1)/2,x=cx+240*Math.cos(am),y=cy+240*Math.sin(am);parts.push(`<text x="${x}" y="${y}" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="800">${n}</text>`)
      if(cricketTargets.includes(n)){const mx=cx+150*Math.cos(am),my=cy+150*Math.sin(am);parts.push(`<g class="sa-cricket-mark" data-mark="${n}" data-size="10" transform="translate(${mx} ${my})" pointer-events="none"></g>`)}
      const sx=cx+116*Math.cos(am),sy=cy+116*Math.sin(am),tx=cx+150*Math.cos(am),ty=cy+150*Math.sin(am),dx=cx+214*Math.cos(am),dy=cy+214*Math.sin(am);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="1" data-size="13" transform="translate(${sx} ${sy})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="3" data-size="10" transform="translate(${tx} ${ty})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="2" data-size="10" transform="translate(${dx} ${dy})" pointer-events="none"></g>`);
    }
    parts.push('<circle data-hit data-number="25" data-multiplier="1" cx="250" cy="250" r="44" fill="#2d9b58"/><circle data-hit data-number="25" data-multiplier="2" cx="250" cy="250" r="19" fill="#df3345"/>');
    parts.push(`<g class="sa-cricket-mark" data-mark="25" data-size="8" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-bitcoin-mark" data-bt-number="25" data-bt-mult="1" data-size="30" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-bitcoin-mark" data-bt-number="25" data-bt-mult="2" data-size="10" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push('</svg>');return parts.join('')}
  function ring(cx,cy,inner,outer,a0,a1,color,n,m){const p=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)],A=p(outer,a0),B=p(outer,a1),C=p(inner,a1),D=p(inner,a0);return `<path data-hit data-number="${n}" data-multiplier="${m}" d="M${A} A${outer} ${outer} 0 0 1 ${B} L${C} A${inner} ${inner} 0 0 0 ${D}Z" fill="${color}" stroke="#4d4d4d" stroke-width="1"/>`}
  function addDart(number,multiplier){if(!state||pending.length>=3)return;pending.push({number,multiplier});drawPending()}
  function dartName(d){let name;if(!d.number)name=tr('sa_miss');else if(d.number===25)name=d.multiplier===2?tr('sa_inner_bull'):tr('sa_bull');else name=(d.multiplier===3?'T':d.multiplier===2?'D':'S')+d.number;return name+(d.checkout_attempt?' 🎯':'')}
  function drawPending(){if(!root)return;root.querySelector('#sa-darts').innerHTML=[0,1,2].map(i=>`<button class="sa-dart" data-pending="${i}" title="${tr('sa_checkout_attempt')}">${pending[i]?dartName(pending[i]):'—'}</button>`).join('');root.querySelectorAll('[data-pending]').forEach(b=>b.onclick=()=>{const d=pending[+b.dataset.pending];if(d){d.checkout_attempt=!d.checkout_attempt;drawPending()}});root.querySelector('#sa-submit').disabled=!pending.length}
  function submit(){if(!pending.length){notice(tr('sa_need_dart'));return}mp.send({type:'sa_turn',darts:pending});pending=[];drawPending()}
  function playerName(id){return state?.roster?.[id]?.display_name||id||''}
  function modeLabel(){return state.mode==='501'?tr('sa_501'):state.mode==='cricket'?tr('sa_cricket'):tr('sa_bitcoin')}
  function draw(){if(!root||!state)return;const current=state.current_player_id;root.querySelector('#sa-turn-name').textContent=playerName(current);root.querySelector('#sa-turn-label').firstChild.textContent=`${modeLabel()} · ${tr('sa_turn')} ${state.history.length+1}`;
    root.querySelector('#sa-score').innerHTML=`<div class="sa-scoreboard">${state.order.map(id=>{const p=state.players[id];return `<div class="sa-player ${id===current?'current':''}"><div class="sa-player-name">${esc(playerName(id))}</div>${state.mode==='bitcoin'?'':`<div class="sa-sub">${tr('sa_wins')}: ${p.wins}/${state.target_wins}</div>`}<div class="sa-big">${state.mode==='501'?p.remaining:state.mode==='bitcoin'?'₿'+p.score:p.score}</div></div>`}).join('')}</div>${state.dice&&Object.keys(state.dice).length?`<div class="sa-dice">🎲 ${tr('sa_dice_result')}: ${state.order.map(id=>`${esc(playerName(id))} ${state.dice[id]}`).join(' · ')}</div>`:''}`;
    const checkout=root.querySelector('#sa-checkout');if(state.mode==='501'){const rem=state.players[current]?.remaining||0,suggestions=findCheckouts(rem);checkout.innerHTML=`<div class="sa-checkout"><span class="sa-sub">${tr('sa_checkout')} · ${rem}</span><br><b>${suggestions.length?suggestions.join(' &nbsp; / &nbsp; '):tr('sa_no_checkout')}</b></div>`}else checkout.innerHTML='';
    root.querySelector('#sa-cricket').innerHTML=state.mode==='cricket'?cricketTable():'';
    root.querySelector('#sa-bitcoin-info').innerHTML=state.mode==='bitcoin'?bitcoinInfo():'';
    drawBoardMarks();drawBitcoinTargets();drawHistory();drawPending()}
  function bitcoinInfo(){const reward=state.halving_reward,names=(state.targets||[]).map(t=>targetLabel(t)).join(', ');
    return `<div class="sa-bitcoin-panel"><div class="sa-sub">${tr('sa_targets')}</div><b class="sa-bitcoin-targets">${esc(names)}</b>
      <div class="sa-bitcoin-stats"><span>${tr('sa_bitcoin_block')} ${state.block_count}/21</span><span>${tr('sa_bitcoin_difficulty')} ${state.difficulty}/8</span><span>₿ ${tr('sa_bitcoin_reward')} ${reward}</span></div></div>`}
  function targetLabel(t){if(t.number===25)return tr('sa_bull');if(t.number===50)return tr('sa_inner_bull');const p=t.type==='triple'?'T':t.type==='double'?'D':'S';return p+t.number}
  function drawBitcoinTargets(){if(!root)return;root.querySelectorAll('.sa-bitcoin-mark').forEach(el=>el.innerHTML='');
    if(!state||state.mode!=='bitcoin')return;
    (state.targets||[]).forEach(t=>{
      const num=t.number===50?25:t.number,mult=t.number===50?2:t.number===25?1:t.type==='triple'?3:t.type==='double'?2:1;
      const el=root.querySelector(`.sa-bitcoin-mark[data-bt-number="${num}"][data-bt-mult="${mult}"]`);
      if(!el)return;
      const s=+el.dataset.size;
      el.innerHTML=`<circle cx="0" cy="0" r="${s}" fill="#ffd700" stroke="#7a3d00" stroke-width="2"/><circle cx="0" cy="0" r="${Math.round(s*.45)}" fill="#df3345" stroke="#7a3d00" stroke-width="1.5"/>`;
    });
  }
  function drawBoardMarks(){if(!root)return;const els=root.querySelectorAll('.sa-cricket-mark');if(!els.length)return;const current=state.current_player_id,p=state.players[current];els.forEach(el=>{const n=el.dataset.mark,s=+el.dataset.size,w=Math.max(3,Math.round(s*.26));const count=state.mode==='cricket'&&p?(p.marks[n]||0):0;
    if(count<=0)el.innerHTML='';
    else if(count===1)el.innerHTML=`<line x1="${-s}" y1="${s}" x2="${s}" y2="${-s}" stroke="#f5d96b" stroke-width="${w}" stroke-linecap="round"/>`;
    else if(count===2)el.innerHTML=`<line x1="${-s}" y1="${s}" x2="${s}" y2="${-s}" stroke="#f5d96b" stroke-width="${w}" stroke-linecap="round"/><line x1="${-s}" y1="${-s}" x2="${s}" y2="${s}" stroke="#f5d96b" stroke-width="${w}" stroke-linecap="round"/>`;
    else el.innerHTML=`<circle cx="0" cy="0" r="${s}" fill="none" stroke="#f5d96b" stroke-width="${w}"/>`;
  })}
  function cricketTable(){const targets=[20,19,18,17,16,15,25];return `<div class="sa-cricket"><table><thead><tr><th>${tr('sa_targets')}</th>${state.order.map(id=>`<th>${esc(playerName(id).split(' ')[0])}</th>`).join('')}</tr></thead><tbody>${targets.map(n=>`<tr><th>${n===25?esc(tr('sa_bull')):n}</th>${state.order.map(id=>`<td class="sa-mark">${marks(state.players[id].marks[String(n)])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
  function marks(n){return n<=0?'—':n===1?'╱':n===2?'╳':'●'}
  function drawHistory(){const el=root.querySelector('#sa-history'),items=[...state.history].reverse();el.innerHTML=items.length?items.map(h=>`<div class="sa-history-row"><span><b>${esc(playerName(h.player_id))}</b> · ${(h.darts||[]).map(dartName).join(', ')}</span><span>${h.kind==='bitcoin'?(h.hit?'₿ +'+h.scored:tr('sa_bitcoin_miss')):h.bust?tr('sa_bust_short'):(h.kind==='501'?`${h.before} → ${h.after}`:`+${h.scored}`)}</span></div>`).join(''):`<span class="sa-sub">${tr('sa_no_throws')}</span>`}
  function findCheckouts(score){if(score<2||score>170)return[];const all=[];for(let n=1;n<=20;n++)all.push({v:n,l:'S'+n},{v:n*2,l:'D'+n},{v:n*3,l:'T'+n});all.push({v:25,l:'BULL'},{v:50,l:'DB'});const doubles=[];for(let n=20;n>=1;n--)doubles.push({v:n*2,l:'D'+n});doubles.push({v:50,l:'DB'});const out=[];for(let count=1;count<=3&&out.length<3;count++){for(const d of doubles){if(count===1&&d.v===score)out.push(d.l);if(count===2)for(const a of all)if(a.v+d.v===score)out.push(a.l+' '+d.l);if(count===3)for(const a of all)for(const b of all)if(a.v+b.v+d.v===score)out.push(a.l+' '+b.l+' '+d.l);if(out.length>=3)break}if(out.length)break}return [...new Set(out)].slice(0,3)}
  function finish(msg){state=msg;draw();if(!root)return;const w=msg.winner;root.querySelector('#sa-overlay').innerHTML=`<div class="sa-finished"><div><div style="font-size:3.2rem">🏆</div><div class="sa-eyebrow">${tr('sa_winner')}</div><h1 style="margin:6px 0 18px">${esc(playerName(w))}</h1><button class="sa-btn primary" onclick="location.reload()">${tr('sa_back')}</button></div></div>`}
  function notice(text){const el=root?.querySelector('#sa-hint');if(!el)return;el.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.textContent='',1800)}
  mp.on('sa_start',msg=>{state=msg;pending=[];draw()});mp.on('sa_state',msg=>{state=msg;pending=[];draw()});mp.on('sa_finished',finish);mp.on('sa_error',msg=>notice(msg.message==='empty_turn'?tr('sa_need_dart'):msg.message));
  mp.registerGame({id:'scorearena',name:'Score Arena',renderSetup,renderGame});
})();
