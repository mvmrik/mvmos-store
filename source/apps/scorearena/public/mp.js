(function(){
  if(!window.GameHub||!window.GameHub.mp)return;
  const mp=window.GameHub.mp, tr=(k,v)=>window.t?window.t(k,v):k;
  const NUMBERS=[20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
  let root=null,state=null,pending=[],toastTimer=0,ghostPending=[],awaitingState=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const GAME_KINDS=[{id:'301',icon:'🎯',label:'sa_301'},{id:'501',icon:'🎯',label:'sa_501'},{id:'cricket',icon:'🏏',label:'sa_cricket'},{id:'bitcoin',icon:'₿',label:'sa_bitcoin'},{id:'breakdown',icon:'💥',label:'sa_breakdown'},{id:'atc',icon:'🕐',label:'sa_atc'},{id:'progolf',icon:'⛳',label:'sa_progolf'},{id:'minigolf',icon:'🏌️',label:'sa_minigolf'}];
  const SEQUENCE_MODES=['breakdown','atc'],GOLF_MODES=['progolf','minigolf'];
  const ALL_MODE_IDS=GAME_KINDS.map(k=>k.id);
  const BREAKDOWN_SEQ=[...Array(20)].map((_,i)=>20-i).concat([25]);
  const ATC_SEQ=[...Array(20)].map((_,i)=>i+1).concat([25]);
  const GOLF_HOLE_COUNTS={progolf:18,minigolf:9};
  const CATEGORIES=[{id:'darts',icon:'🎯',label:'sa_cat_darts',kinds:GAME_KINDS},{id:'board',icon:'🎲',label:'sa_cat_board',kinds:[]}];
  async function fetchModeStats(mode){
    try{
      const r=await fetch('/api/pub/gamehub/stats');
      if(!r.ok)return null;
      const data=await r.json();
      const myId=mp.youId&&mp.youId();
      const sessions=(data.recent||[]).filter(s=>s.game_id==='scorearena'&&(()=>{try{return JSON.parse(s.metadata||'{}').scorearena_mode===mode}catch(_){return false}})());
      const mine=[];
      sessions.forEach(s=>{
        let meta;try{meta=JSON.parse(s.metadata||'{}')}catch(_){meta={}}
        const ps=meta.player_stats||{};
        if(myId&&ps[myId])mine.push(ps[myId]);
      });
      if(!mine.length)return{played:0};
      const avg=k=>mine.reduce((a,m)=>a+(m[k]||0),0)/mine.length;
      const sum=k=>mine.reduce((a,m)=>a+(m[k]||0),0);
      const max=k=>mine.reduce((a,m)=>Math.max(a,m[k]||0),0);
      const min=k=>{const vals=mine.map(m=>m[k]||0).filter(v=>v>0);return vals.length?Math.min(...vals):0};
      const out={played:mine.length,wins:mine.reduce((a,m)=>a+(m.wins||0),0)};
      if(mode==='501'||mode==='301'){
        out.avg=avg('three_dart_average').toFixed(1);
        out.checkout=avg('checkout_rate').toFixed(0);
        out.highest_checkout=max('highest_checkout');
        out.scores_180=sum('scores_180');
        out.scores_140=sum('scores_140');
        out.scores_100=sum('scores_100');
        const bestLeg=min('best_leg_darts');out.best_leg_darts=bestLeg||null;
        out.nine_darters=sum('nine_darters');
      }else if(mode==='cricket'){
        out.mpr=avg('mpr').toFixed(2);
        out.marks_total=sum('marks_total');
        out.high_marks_rounds=sum('mark_5')+sum('mark_6')+sum('mark_7')+sum('mark_8');
        out.three_triples=sum('three_triples');
        out.perfect_games=sum('perfect_games');
      }else if(mode==='bitcoin'){
        out.hitrate=avg('hit_rate').toFixed(0);
        out.darts_per_block=avg('darts_per_block').toFixed(1);
        out.blocks_mined=sum('blocks_mined');
        out.btc_earned=sum('btc_earned').toFixed(2);
        out.best_block_reward=max('best_block_reward');
        out.best_mine_streak=max('best_mine_streak');
        out.halvings_survived=sum('halvings_survived');
        out.best_difficulty=max('best_difficulty');
      }else if(mode==='breakdown'){
        out.avg=avg('three_dart_average').toFixed(1);
        out.highest_checkout=max('highest_checkout');
        out.scores_80=sum('scores_80');
        out.scores_60=sum('scores_60');
        out.scores_40=sum('scores_40');
        out.perfect_breakdowns=sum('perfect_breakdowns');
      }else if(mode==='atc'){
        const bestLeg=min('best_leg_darts');out.best_leg_darts=bestLeg||null;
        out.darts_per_target=(sum('darts')/(21*mine.length)).toFixed(1);
        out.finishes_8dart=sum('finishes_8dart');
      }else if(mode==='progolf'||mode==='minigolf'){
        out.avg=avg('avg').toFixed(1);
        out.darts_per_target=avg('darts_per_target').toFixed(1);
        out.albatrosses=sum('albatrosses');
        out.eagles=sum('eagles');
        out.birdies=sum('birdies');
        out.pars=sum('pars');
        out.bogeys=sum('bogeys');
        out.double_bogeys=sum('double_bogeys');
      }
      return out;
    }catch(_){return null}
  }
  function renderSetup(box,settings){
    const solo=mp.players().length<=1;
    const locked=ALL_MODE_IDS.includes(settings?.mode);
    let mode=locked?settings.mode:null;
    let category=locked?'darts':null;
    box.innerHTML=`<div id="sa-cat-picker"></div><div id="sa-kind-picker" hidden></div><div id="sa-stats" hidden></div><div id="sa-kind-body" hidden></div>`;
    const catPicker=box.querySelector('#sa-cat-picker'),picker=box.querySelector('#sa-kind-picker'),statsBox=box.querySelector('#sa-stats'),body=box.querySelector('#sa-kind-body');
    let getExtra=()=>({});
    function drawCategories(){
      if(locked){catPicker.hidden=true;return}
      catPicker.hidden=false;
      catPicker.innerHTML=`<p class="sa-sub" style="margin-bottom:8px">${tr('sa_pick_category')}</p><div class="sa-kind-picker">${CATEGORIES.map(c=>`<button type="button" class="sa-kind-card${category===c.id?' sa-kind-chosen':''}" data-cat="${c.id}"><span class="sa-kind-icon">${c.icon}</span><span class="sa-kind-name">${tr(c.label)}</span></button>`).join('')}</div>`;
      catPicker.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{category=b.dataset.cat;mode=null;drawCategories();drawPicker();drawStats();drawBody()});
    }
    function drawPicker(){
      if(!category){picker.hidden=true;return}
      const cat=CATEGORIES.find(c=>c.id===category);
      if(!cat.kinds.length){picker.hidden=false;picker.innerHTML=`<p class="sa-sub">${tr('sa_cat_board_soon')}</p>`;return}
      picker.hidden=false;
      picker.innerHTML=`<p class="sa-sub" style="margin:10px 0 8px">${tr('sa_pick_game')}</p><div class="sa-kind-picker">${cat.kinds.map(k=>`<button type="button" class="sa-kind-card${mode===k.id?' sa-kind-chosen':''}" data-kind="${k.id}"><span class="sa-kind-icon">${k.icon}</span><span class="sa-kind-name">${tr(k.label)}</span></button>`).join('')}</div>`;
      picker.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{if(locked)return;mode=b.dataset.kind;drawPicker();drawStats();drawBody()});
    }
    function drawStats(){
      if(!mode){statsBox.hidden=true;statsBox.innerHTML='';return}
      statsBox.hidden=false;
      statsBox.innerHTML=`<p class="sa-sub">${tr('sa_stats_title')}…</p>`;
      fetchModeStats(mode).then(s=>{
        if(!s||!s.played){statsBox.innerHTML=`<p class="sa-sub">${tr('sa_stats_none')}</p>`;return}
        const main=[[tr('sa_stats_played'),s.played],[tr('sa_stats_wins'),s.wins]];
        const badges=[];
        if(mode==='501'||mode==='301'){
          main.push([tr('sa_stats_avg'),s.avg]);
          main.push([tr('sa_stats_checkout'),s.checkout+'%']);
          badges.push([tr('sa_stats_highest_checkout'),s.highest_checkout||0]);
          badges.push([tr('sa_stats_best_leg'),s.best_leg_darts||0]);
          badges.push(['180',s.scores_180||0]);
          badges.push([tr('sa_stats_140plus'),s.scores_140||0]);
          badges.push([tr('sa_stats_100plus'),s.scores_100||0]);
          badges.push([tr('sa_stats_perfect_leg'),s.nine_darters||0]);
        }else if(mode==='cricket'){
          main.push([tr('sa_stats_mpr'),s.mpr]);
          main.push([tr('sa_stats_marks_total'),s.marks_total||0]);
          badges.push([tr('sa_stats_high_marks'),s.high_marks_rounds||0]);
          badges.push([tr('sa_stats_9marks'),s.three_triples||0]);
          badges.push([tr('sa_stats_perfect_games'),s.perfect_games||0]);
        }else if(mode==='bitcoin'){
          main.push([tr('sa_stats_hitrate'),s.hitrate+'%']);
          main.push(['₿ '+tr('sa_stats_btc_earned'),s.btc_earned]);
          badges.push([tr('sa_stats_blocks_mined'),s.blocks_mined||0]);
          badges.push([tr('sa_stats_darts_per_block'),s.darts_per_block||0]);
          badges.push([tr('sa_stats_best_block'),s.best_block_reward||0]);
          badges.push([tr('sa_stats_best_streak'),s.best_mine_streak||0]);
          badges.push([tr('sa_stats_halvings'),s.halvings_survived||0]);
          badges.push([tr('sa_stats_best_difficulty'),s.best_difficulty||0]);
        }else if(mode==='breakdown'){
          main.push([tr('sa_stats_avg'),s.avg]);
          badges.push([tr('sa_stats_highest_checkout'),s.highest_checkout||0]);
          badges.push([tr('sa_stats_80s'),s.scores_80||0]);
          badges.push([tr('sa_stats_60s'),s.scores_60||0]);
          badges.push([tr('sa_stats_40s'),s.scores_40||0]);
          badges.push([tr('sa_stats_perfect_breakdown'),s.perfect_breakdowns||0]);
        }else if(mode==='atc'){
          main.push([tr('sa_stats_darts_per_target'),s.darts_per_target]);
          badges.push([tr('sa_stats_best_leg'),s.best_leg_darts||0]);
          badges.push([tr('sa_stats_8dart_finish'),s.finishes_8dart||0]);
        }else if(mode==='progolf'||mode==='minigolf'){
          main.push([tr('sa_stats_avg'),s.avg]);
          main.push([tr('sa_stats_darts_per_target'),s.darts_per_target]);
          badges.push([tr('sa_stats_albatross'),s.albatrosses||0]);
          badges.push([tr('sa_stats_eagle'),s.eagles||0]);
          badges.push([tr('sa_stats_birdie'),s.birdies||0]);
          badges.push([tr('sa_stats_par'),s.pars||0]);
          badges.push([tr('sa_stats_bogey'),s.bogeys||0]);
          badges.push([tr('sa_stats_double_bogey'),s.double_bogeys||0]);
        }
        const mainHtml=main.map(([l,v])=>`<div class="sa-stat"><div class="sa-stat-val">${v}</div><div class="sa-stat-label">${l}</div></div>`).join('');
        const badgeHtml=badges.length?`<div class="sa-stats-badges">${badges.map(([l,v])=>`<div class="sa-stat-badge"><span class="sa-badge-val">${v}</span><span class="sa-badge-label">${l}</span></div>`).join('')}</div>`:'';
        statsBox.innerHTML=`<div class="sa-stats-panel"><b>${tr('sa_stats_title')}</b><div class="sa-stats-grid">${mainHtml}</div>${badgeHtml}</div>`;
      });
    }
    function drawBody(){
      if(!mode){body.hidden=true;return}
      body.hidden=false;
      body.innerHTML=`
        <div class="sa-options" style="margin-top:14px">
          ${solo?`<div class="sa-field"><label>${tr('sa_opponent')}</label><select id="sa-opponent"><option value="">${tr('sa_alone')}</option><option value="ghost">👻 ${tr('sa_ghost')}</option></select></div>`:''}
          <div class="sa-field" id="sa-wins-wrap"><label>${tr('sa_match')}</label><select id="sa-wins">${[1,2,3,4,5,7].map(n=>`<option value="${n}">${tr('sa_first_to')} ${n} ${tr('sa_rounds')}</option>`).join('')}</select></div>
          <div class="sa-field" id="sa-order-wrap"><label>${tr('sa_order')}</label><select id="sa-order"><option value="lobby">${tr('sa_lobby_order')}</option><option value="manual">${tr('sa_manual_first')}</option><option value="dice">🎲 ${tr('sa_random_dice')}</option></select></div>
          <div class="sa-field" id="sa-first-wrap" hidden><label>${tr('sa_first_player')}</label><select id="sa-first"></select></div>
        </div>${solo?`<p class="sa-sub sa-ghost-blurb" id="sa-ghost-blurb" hidden>${tr('sa_ghost_blurb')}</p>`:''}<p class="sa-sub" style="margin-top:12px">${tr('sa_ready')} ${tr('sa_all_can_score')}</p>`;
      const winsWrap=body.querySelector('#sa-wins-wrap'),orderWrap=body.querySelector('#sa-order-wrap'),order=body.querySelector('#sa-order'),wrap=body.querySelector('#sa-first-wrap'),first=body.querySelector('#sa-first'),opponent=body.querySelector('#sa-opponent'),blurb=body.querySelector('#sa-ghost-blurb');
      const fill=()=>{const old=first.value;first.innerHTML=mp.players().map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');if(old)first.value=old};
      const hasRivals=()=>!solo||(opponent&&opponent.value==='ghost');
      const syncMode=()=>{winsWrap.hidden=mode==='bitcoin'||!hasRivals()};
      const syncRivals=()=>{const show=hasRivals();orderWrap.hidden=!show;if(!show)wrap.hidden=true;syncMode()};
      fill();syncRivals();order.onchange=()=>{wrap.hidden=order.value!=='manual';fill()};
      if(opponent)opponent.onchange=()=>{blurb.hidden=opponent.value!=='ghost';syncRivals()};
      getExtra=()=>({target_wins:+body.querySelector('#sa-wins').value,order:order.value,first_player_id:first.value||null,opponent:opponent?opponent.value||null:null});
    }
    drawCategories();drawPicker();drawStats();drawBody();
    return()=>{if(!mode)return null;return{mode,...getExtra()}};
  }
  function renderGame(box){root=box;root.classList.add('sa-game');root.innerHTML=`<div class="sa-shell"><section class="sa-card sa-board-card">${mp.players().length<=1?`<button class="sa-exit-btn" id="sa-exit" title="${tr('sa_save_exit')}" aria-label="${tr('sa_save_exit')}">⏸</button>`:''}<div class="sa-eyebrow" id="sa-turn-label">${tr('sa_turn')}<button class="sa-help-btn" id="sa-help" title="${tr('sa_help')}" aria-label="${tr('sa_help')}">?</button></div><div class="sa-turn-name" id="sa-turn-name">${tr('sa_waiting')}</div><div id="sa-board"></div><div class="sa-row"><div class="sa-darts" id="sa-darts"></div><div class="sa-actions"><button class="sa-btn" id="sa-miss" title="${tr('sa_miss')}" aria-label="${tr('sa_miss')}">🚫</button><button class="sa-btn" id="sa-undo" title="${tr('sa_undo')}" aria-label="${tr('sa_undo')}">↩︎</button><button class="sa-btn primary" id="sa-submit" title="${tr('sa_submit')}" aria-label="${tr('sa_submit')}">✔</button></div></div><div class="sa-sub" id="sa-hint" style="margin-top:8px"></div></section><section><div class="sa-card"><div id="sa-score"></div><div id="sa-checkout"></div><div id="sa-cricket"></div><div class="sa-cricket" id="sa-golf"></div><div id="sa-bitcoin-info"></div></div><div class="sa-card sa-history"><b>${tr('sa_history')}</b><div class="sa-history-list" id="sa-history"><span class="sa-sub">${tr('sa_no_throws')}</span></div></div></section></div><div id="sa-overlay"></div>`;
    root.querySelector('#sa-board').innerHTML=boardSvg();
    root.querySelector('#sa-board').onclick=e=>{const hit=e.target.closest('[data-hit]');if(hit)flashHit(hit)&&addDart(+hit.dataset.number,+hit.dataset.multiplier)};
    root.querySelector('#sa-miss').onclick=()=>addDart(0,0);root.querySelector('#sa-undo').onclick=()=>{pending.pop();drawPending();drawCheckout();drawTargetMark()};root.querySelector('#sa-submit').onclick=submit;
    root.querySelector('#sa-help').onclick=showHelp;
    const exitBtn=root.querySelector('#sa-exit');if(exitBtn)exitBtn.onclick=()=>mp.exitPrompt();
    if(state)draw();
  }
  function showHelp(){
    if(!root)return;
    const kind=ALL_MODE_IDS.includes(state?.mode)?state.mode:'501';
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
    const cx=250,cy=250,parts=[];parts.push(`<svg class="sa-board" viewBox="0 0 500 500" role="group" aria-label="${esc(tr('sa_dartboard'))}">`);
    parts.push('<circle cx="250" cy="250" r="247" fill="#181a1d"/>');
    const cricketTargets=[20,19,18,17,16,15];
    for(let i=0;i<20;i++){const a0=(i*18-99)*Math.PI/180,a1=((i+1)*18-99)*Math.PI/180,n=NUMBERS[i],light=i%2===0;parts.push(ring(cx,cy,36,196,a0,a1,light?'#eee6d2':'#202326',n,1));parts.push(ring(cx,cy,132,168,a0,a1,light?'#df3345':'#2d9b58',n,3));parts.push(ring(cx,cy,196,232,a0,a1,light?'#df3345':'#2d9b58',n,2));const am=(a0+a1)/2,x=cx+240*Math.cos(am),y=cy+240*Math.sin(am);parts.push(`<text x="${x}" y="${y}" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="800">${n}</text>`)
      if(cricketTargets.includes(n)){const mx=cx+150*Math.cos(am),my=cy+150*Math.sin(am);parts.push(`<g class="sa-cricket-mark" data-mark="${n}" data-size="10" transform="translate(${mx} ${my})" pointer-events="none"></g>`)}
      const sx=cx+116*Math.cos(am),sy=cy+116*Math.sin(am),tx=cx+150*Math.cos(am),ty=cy+150*Math.sin(am),dx=cx+214*Math.cos(am),dy=cy+214*Math.sin(am),s2x=cx+182*Math.cos(am),s2y=cy+182*Math.sin(am);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="1" data-size="10" transform="translate(${sx} ${sy})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="3" data-size="10" transform="translate(${tx} ${ty})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-bitcoin-mark" data-bt-number="${n}" data-bt-mult="2" data-size="10" transform="translate(${dx} ${dy})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-target-mark" data-target="${n}" data-mult="1" data-size="10" transform="translate(${sx} ${sy})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-target-mark" data-target="${n}" data-mult="1" data-size="10" transform="translate(${s2x} ${s2y})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-target-mark" data-target="${n}" data-mult="3" data-size="10" transform="translate(${tx} ${ty})" pointer-events="none"></g>`);
      parts.push(`<g class="sa-target-mark" data-target="${n}" data-mult="2" data-size="10" transform="translate(${dx} ${dy})" pointer-events="none"></g>`);
    }
    parts.push('<circle data-hit data-number="25" data-multiplier="1" cx="250" cy="250" r="44" fill="#2d9b58"/><circle data-hit data-number="25" data-multiplier="2" cx="250" cy="250" r="19" fill="#df3345"/>');
    parts.push(`<g class="sa-cricket-mark" data-mark="25" data-size="8" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-bitcoin-mark" data-bt-number="25" data-bt-mult="1" data-size="10" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-bitcoin-mark" data-bt-number="25" data-bt-mult="2" data-size="10" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-target-mark" data-target="25" data-mult="1" data-size="10" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push(`<g class="sa-target-mark" data-target="25" data-mult="2" data-size="10" transform="translate(250 250)" pointer-events="none"></g>`);
    parts.push('</svg>');return parts.join('')}
  function ring(cx,cy,inner,outer,a0,a1,color,n,m){const p=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)],A=p(outer,a0),B=p(outer,a1),C=p(inner,a1),D=p(inner,a0);return `<path data-hit data-number="${n}" data-multiplier="${m}" d="M${A} A${outer} ${outer} 0 0 1 ${B} L${C} A${inner} ${inner} 0 0 0 ${D}Z" fill="${color}" stroke="#4d4d4d" stroke-width="1"/>`}
  function addDart(number,multiplier){if(!state||pending.length>=3)return;pending.push({number,multiplier});drawPending();drawCheckout();drawTargetMark()}
  function dartName(d){let name;if(!d.number)name=tr('sa_miss');else if(d.number===25)name=d.multiplier===2?tr('sa_inner_bull'):tr('sa_bull');else name=(d.multiplier===3?'T':d.multiplier===2?'D':'S')+d.number;return name+(d.checkout_attempt?' 🎯':'')}
  function isGhostTurn(){return !!state?.roster?.[state.current_player_id]?.is_ghost}
  function drawPending(){if(!root)return;const ghostTurn=isGhostTurn(),shown=ghostTurn?ghostPending:pending;
    root.querySelector('#sa-darts').innerHTML=[0,1,2].map(i=>`<button class="sa-dart${ghostTurn?' sa-dart-ghost':''}" data-pending="${i}" title="${tr('sa_checkout_attempt')}"${ghostTurn?' disabled':''}>${shown[i]?dartName(shown[i]):'—'}</button>`).join('');
    if(!ghostTurn)root.querySelectorAll('[data-pending]').forEach(b=>b.onclick=()=>{const d=pending[+b.dataset.pending];if(d){d.checkout_attempt=!d.checkout_attempt;drawPending()}});
    root.querySelector('#sa-submit').disabled=ghostTurn||!pending.length;
    root.querySelector('#sa-miss').disabled=ghostTurn;root.querySelector('#sa-undo').disabled=ghostTurn;}
  function ghostDartEl(dart){if(!root)return null;if(!dart.number)return null;return root.querySelector(`[data-hit][data-number="${dart.number}"][data-multiplier="${dart.multiplier}"]`)}
  mp.on('sa_ghost_dart',msg=>{
    if(msg.index===0)ghostPending=[];
    ghostPending[msg.index]=msg.dart;drawPending();
    const el=ghostDartEl(msg.dart);if(el)flashHit(el);
  });
  function submit(){if(!pending.length){notice(tr('sa_need_dart'));return}mp.send({type:'sa_turn',darts:pending});awaitingState=true;pending=[];drawPending();drawCheckout();drawTargetMark()}
  function playerName(id){return state?.roster?.[id]?.display_name||id||''}
  function modeLabel(){const k=GAME_KINDS.find(k=>k.id===state.mode);return k?tr(k.label):tr('sa_501')}
  function ghostMoodBadge(id){const r=state?.roster?.[id];if(!r?.is_ghost)return'';const icon=r.mood==='hot'?'🔥':r.mood==='cold'?'🥶':'👻';return `<span class="sa-ghost-mood sa-ghost-mood-${esc(r.mood)}" title="${tr('sa_ghost_mood_'+r.mood)}">${icon}</span>`}
  function draw(){if(!root||!state)return;const current=state.current_player_id;root.querySelector('#sa-turn-name').textContent=playerName(current);root.querySelector('#sa-turn-label').firstChild.textContent=`${modeLabel()} · ${tr('sa_turn')} ${state.history.length+1}`;
    if(!isGhostTurn())ghostPending=[];
    const players=Math.max(1,Math.min(state.order.length,2));
    root.querySelector('#sa-score').innerHTML=`<div class="sa-scoreboard" style="--sa-players:${players}">${state.order.map(id=>{const p=state.players[id];return `<div class="sa-player ${id===current?'current':''}"><div class="sa-player-name">${esc(playerName(id))}${ghostMoodBadge(id)}</div>${bigSubLine(p)}<div class="sa-big">${bigValue(p)}</div></div>`}).join('')}</div>${state.dice&&Object.keys(state.dice).length?`<div class="sa-dice">🎲 ${tr('sa_dice_result')}: ${state.order.map(id=>`${esc(playerName(id))} ${state.dice[id]}`).join(' · ')}</div>`:''}`;
    drawCheckout();
    root.querySelector('#sa-cricket').innerHTML=state.mode==='cricket'?cricketTable():'';
    root.querySelector('#sa-bitcoin-info').innerHTML=state.mode==='bitcoin'?bitcoinInfo():'';
    const golfEl=root.querySelector('#sa-golf');if(golfEl)golfEl.innerHTML=GOLF_MODES.includes(state.mode)?golfTable():'';
    drawBoardMarks();drawBitcoinTargets();drawTargetMark();drawHistory();drawPending()}
  function bigValue(p){if(state.mode==='501'||state.mode==='301')return p.remaining;
    if(state.mode==='bitcoin')return '₿'+p.score;
    if(SEQUENCE_MODES.includes(state.mode))return p.seq_index;
    if(GOLF_MODES.includes(state.mode))return p.metrics.golf_strokes_total;
    return p.score}
  function bigSubLine(p){if(state.mode==='bitcoin')return '';
    if(GOLF_MODES.includes(state.mode))return `<div class="sa-sub">${tr('sa_stats_hole')}: ${Math.min(p.golf_hole+1,GOLF_HOLE_COUNTS[state.mode])}/${GOLF_HOLE_COUNTS[state.mode]}</div>`;
    return `<div class="sa-sub">${tr('sa_wins')}: ${p.wins}/${state.target_wins}</div>`}
  function drawCheckout(){if(!root||!state)return;const checkout=root.querySelector('#sa-checkout'),current=state.current_player_id;
    if(state.mode==='501'||state.mode==='301'){const rem=state.players[current]?.remaining||0,suggestions=findCheckouts(rem);checkout.innerHTML=`<div class="sa-checkout"><span class="sa-sub">${tr('sa_checkout')} · ${rem}</span><br><b>${suggestions.length?suggestions.join(' &nbsp; / &nbsp; '):tr('sa_no_checkout')}</b></div>`}
    else if(SEQUENCE_MODES.includes(state.mode)||GOLF_MODES.includes(state.mode)){const waiting=awaitingState||(!isGhostTurn()&&pending.length>=3);checkout.innerHTML=`<div class="sa-checkout"><span class="sa-sub">${tr('sa_current_target')}</span><br><b>${waiting?tr('sa_submit'):targetIndicatorText()}</b></div>`}
    else checkout.innerHTML='';
  }
  function targetIndicatorText(){const t=currentTargetNumber();if(t===null)return '';
    const label=t===25?tr('sa_bull'):String(t);
    if(GOLF_MODES.includes(state.mode)){const p=state.players[state.current_player_id];return `${tr('sa_stats_hole')} ${p.golf_hole+1} — ${tr('sa_target')} ${label}`}
    return `${tr('sa_target')}: ${label}`}
  function golfTable(){const holeCount=GOLF_HOLE_COUNTS[state.mode],rows=[];
    for(let h=0;h<holeCount;h++){rows.push(`<tr><th>${h+1}</th>${state.order.map(id=>{const strokes=state.players[id].golf_strokes[h];return `<td>${strokes!=null?strokes:''}</td>`}).join('')}</tr>`)}
    return `<table><thead><tr><th>${tr('sa_stats_hole')}</th>${state.order.map(id=>`<th>${esc(playerName(id))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`}
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
  function currentTargetNumber(){
    if(!state)return null;
    const p=state.players[state.current_player_id];if(!p)return null;
    if(SEQUENCE_MODES.includes(state.mode)){
      const seq=state.mode==='breakdown'?BREAKDOWN_SEQ:ATC_SEQ;
      let idx=p.seq_index;
      if(!isGhostTurn())for(const d of pending){if(idx>=seq.length)break;if(d.number===seq[idx])idx++}
      return seq[Math.min(idx,seq.length-1)];
    }
    if(GOLF_MODES.includes(state.mode))return p.golf_hole+1;
    return null;
  }
  function drawTargetMark(){if(!root)return;const els=root.querySelectorAll('.sa-target-mark');if(!els.length)return;
    const target=(awaitingState||(!isGhostTurn()&&pending.length>=3))?null:currentTargetNumber();
    els.forEach(el=>{const s=+el.dataset.size,on=target!==null&&+el.dataset.target===target;
      el.innerHTML=on?`<circle cx="0" cy="0" r="${s}" fill="#f5bf4f" stroke="#7a5300" stroke-width="2"/><circle cx="0" cy="0" r="${Math.round(s*.45)}" fill="#df3345" stroke="#7a5300" stroke-width="1.5"/>`:'';
    });
  }
  function cricketTable(){const targets=[20,19,18,17,16,15,25];return `<div class="sa-cricket"><table><thead><tr><th>${tr('sa_targets')}</th>${state.order.map(id=>`<th>${esc(playerName(id).split(' ')[0])}</th>`).join('')}</tr></thead><tbody>${targets.map(n=>`<tr><th>${n===25?esc(tr('sa_bull')):n}</th>${state.order.map(id=>`<td class="sa-mark">${marks(state.players[id].marks[String(n)])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
  function marks(n){return n<=0?'—':n===1?'╱':n===2?'╳':'●'}
  function drawHistory(){const el=root.querySelector('#sa-history'),items=[...state.history].reverse();el.innerHTML=items.length?items.map(h=>`<div class="sa-history-row"><span><b>${esc(playerName(h.player_id))}</b> · ${(h.darts||[]).map(dartName).join(', ')}</span><span>${historyResult(h)}</span></div>`).join(''):`<span class="sa-sub">${tr('sa_no_throws')}</span>`}
  function historyResult(h){
    if(h.kind==='bitcoin')return h.hit?'₿ +'+h.scored:tr('sa_bitcoin_miss');
    if(h.bust)return tr('sa_bust_short');
    if(h.kind==='501'||h.kind==='301')return `${h.before} → ${h.after}`;
    if(h.kind==='breakdown'||h.kind==='atc')return `+${h.scored}`;
    if(h.kind==='golf')return `${tr('sa_stats_hole')} ${h.hole}: ${h.strokes}`;
    return `+${h.scored}`}
  function findCheckouts(score){if(score<2||score>170)return[];const bullLabel=tr('sa_bull'),dbLabel=tr('sa_inner_bull');const all=[];for(let n=1;n<=20;n++)all.push({v:n,l:'S'+n},{v:n*2,l:'D'+n},{v:n*3,l:'T'+n});all.push({v:25,l:bullLabel},{v:50,l:dbLabel});const doubles=[];for(let n=20;n>=1;n--)doubles.push({v:n*2,l:'D'+n});doubles.push({v:50,l:dbLabel});const out=[];for(let count=1;count<=3&&out.length<3;count++){for(const d of doubles){if(count===1&&d.v===score)out.push(d.l);if(count===2)for(const a of all)if(a.v+d.v===score)out.push(a.l+' '+d.l);if(count===3)for(const a of all)for(const b of all)if(a.v+b.v+d.v===score)out.push(a.l+' '+b.l+' '+d.l);if(out.length>=3)break}if(out.length)break}return [...new Set(out)].slice(0,3)}
  function finish(msg){state=msg;draw();if(!root)return;const w=msg.winner;root.querySelector('#sa-overlay').innerHTML=`<div class="sa-finished"><div><div style="font-size:3.2rem">🏆</div><div class="sa-eyebrow">${tr('sa_winner')}</div><h1 style="margin:6px 0 18px">${esc(playerName(w))}</h1><button class="sa-btn primary" onclick="location.reload()">${tr('sa_back')}</button></div></div>`}
  function notice(text){const el=root?.querySelector('#sa-hint');if(!el)return;el.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.textContent='',1800)}
  mp.on('sa_start',msg=>{state=msg;pending=[];ghostPending=[];awaitingState=false;draw()});mp.on('sa_state',msg=>{state=msg;pending=[];ghostPending=[];awaitingState=false;draw()});mp.on('sa_finished',msg=>{ghostPending=[];finish(msg)});mp.on('sa_error',msg=>notice(msg.message==='empty_turn'?tr('sa_need_dart'):msg.message));
  mp.registerGame({id:'scorearena',name:'Score Arena',renderSetup,renderGame,exitButton:false});
})();
