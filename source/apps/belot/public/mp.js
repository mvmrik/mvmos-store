(function () {
  if (!window.GameHub?.mp) return;
  const mp = window.GameHub.mp;
  const tr = (key, fallback) => window.t ? window.t(key, fallback) : fallback;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const suit = {C:'♣',D:'♦',H:'♥',S:'♠',NT:'NT',AT:'AT'};
  const label = c => ({C:tr('bl_clubs','Clubs'),D:tr('bl_diamonds','Diamonds'),H:tr('bl_hearts','Hearts'),S:tr('bl_spades','Spades'),NT:tr('bl_nt','No trump'),AT:tr('bl_at','All trump')})[c] || c;
  const standard = {variant:'bulgarian',contracts:'all',no_trump_raise:false,all_trump_raise:true,trump_raise:true,plain_raise:false,
    must_trump:true,partner_winning_exempts:true,must_overtrump:true,allow_undertrump:false,
    announcements:true,announcements_mode:'declare',announcement_visibility:'named',announcement_competition:'highest',equal_value_priority:'quad',no_trump_announcements:false,
    belote:true,belote_mode:'declare',all_trump_belote_follow:true,
    allow_contra:true,escape_contra:true,capot_bonus:90,no_trump_multiplier:2,target:151,
    redeal_all_pass:true,rounding:'balanced',tie_mode:'caller_hangs',contra_tie_mode:'all_hangs',
    deals_limit:0,finish_after_capot:false,finish_on_tie:false,french_second_round_same_suit:true};
  const frenchStandard = {...standard,variant:'french',contracts:'suits',allow_contra:false,escape_contra:false,
    allow_undertrump:true,announcements:false,rounding:'raw',target:1000,finish_after_capot:true};
  const baseOf = rules => rules?.variant === 'french' ? 'french' : 'bulgarian';
  const standardFor = variant => variant === 'french' ? frenchStandard : standard;
  const fields = [
    ['contracts','select','bl_contracts','all:bl_all_contracts,suits:bl_suits_only'],
    ['no_trump_raise','check','bl_no_trump_raise'],
    ['all_trump_raise','check','bl_all_trump_raise'],
    ['trump_raise','check','bl_trump_raise'],
    ['plain_raise','check','bl_plain_raise'],
    ['must_trump','check','bl_must_trump'],
    ['partner_winning_exempts','check','bl_partner_exemption'],
    ['must_overtrump','check','bl_overtrump'],
    ['allow_undertrump','check','bl_undertrump'],
    ['french_second_round_same_suit','check','bl_french_second_round_same_suit'],
    ['announcements','check','bl_announcements'],
    ['announcements_mode','select','bl_announcements_mode','declare:bl_declare,automatic:bl_automatic'],
    ['announcement_visibility','select','bl_announcement_visibility','named:bl_announcements_named,hidden:bl_announcements_hidden'],
    ['announcement_competition','select','bl_announcement_competition','highest:bl_highest_only,both:bl_both_teams'],
    ['equal_value_priority','select','bl_equal_value_priority','quad:bl_quad_first,run:bl_run_first'],
    ['no_trump_announcements','check','bl_no_trump_announcements'],
    ['belote','check','bl_belote_bonus'],
    ['belote_mode','select','bl_belote_mode','declare:bl_declare,automatic:bl_automatic'],
    ['all_trump_belote_follow','check','bl_all_trump_belote_follow'],
    ['allow_contra','check','bl_allow_contra'],
    ['escape_contra','check','bl_escape_contra'],
    ['redeal_all_pass','check','bl_redeal'],
    ['no_trump_multiplier','number','bl_nt_multiplier',1,3],
    ['capot_bonus','number','bl_capot_bonus',0,200],
    ['target','number','bl_target',51,1001],
    ['deals_limit','number','bl_deals_limit',0,100],
    ['rounding','select','bl_rounding','balanced:bl_balanced,nearest:bl_nearest,floor:bl_floor,raw:bl_raw'],
    ['tie_mode','select','bl_tie_mode','caller_hangs:bl_caller_hangs,all_hangs:bl_all_hangs,split:bl_split'],
    ['contra_tie_mode','select','bl_contra_tie_mode','all_hangs:bl_all_hangs,split:bl_split'],
    ['finish_after_capot','check','bl_finish_after_capot'],
    ['finish_on_tie','check','bl_finish_on_tie']
  ];
  const frenchFieldKeys = new Set(['trump_raise','must_trump','partner_winning_exempts','must_overtrump','allow_undertrump','french_second_round_same_suit',
    'announcements','announcements_mode','announcement_visibility','announcement_competition','equal_value_priority',
    'belote','belote_mode','capot_bonus','target','deals_limit','rounding','tie_mode','finish_after_capot','finish_on_tie']);
  const fieldsFor = variant => variant === 'french' ? fields.filter(f => frenchFieldKeys.has(f[0])) : fields.filter(f => f[0] !== 'french_second_round_same_suit');
  let view = null, state = null, hold = null, pending = false, chosenVariant = 'bulgarian';
  let setupRoomId = null, pendingStartedVariant = null;
  let seatBox = null, seatIds = [null, null, null, null];
  const ownerKey = () => 'belot.presets.' + (window.GameHub.currentPlayer()?.id || 'guest');
  const lastVariantKey = () => 'belot.lastVariant.' + (window.GameHub.currentPlayer()?.id || 'guest');
  function saved() { try { const value = JSON.parse(localStorage.getItem(ownerKey()) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; } }
  function save(items) { localStorage.setItem(ownerKey(), JSON.stringify(items)); }
  function lastVariant() { try { return localStorage.getItem(lastVariantKey()); } catch (_) { return null; } }
  function rememberVariant(variant) { try { localStorage.setItem(lastVariantKey(), variant); } catch (_) {} }
  function validVariant(variant) {
    return variant === 'bulgarian' || variant === 'french' ||
      (typeof variant === 'string' && variant.startsWith('custom:') && Object.prototype.hasOwnProperty.call(saved(), variant.slice(7)));
  }
  function ruleForm(box, initial) {
    const resumedSeats = mp.savedState()?.seats;
    if (Array.isArray(resumedSeats) && resumedSeats.length === 4) seatIds = resumedSeats.slice();
    const roomId = mp.roomId();
    if (setupRoomId !== roomId) {
      setupRoomId = roomId;
      const preferred = mp.savedState()?.variant || lastVariant();
      chosenVariant = validVariant(preferred) ? preferred : 'bulgarian';
    } else if (!validVariant(chosenVariant)) {
      chosenVariant = 'bulgarian';
    }
    box.innerHTML = `<div class="bl-setup"><h2>${esc(tr('bl_seats','Choose seats'))}</h2>
      <p>${esc(tr('bl_seats_hint','The host chooses partners. Seats 1 and 3 form Team A; seats 2 and 4 form Team B. Empty seats are bots.'))}</p>
      <div class="bl-seat-picker"></div><h2>${esc(tr('bl_rules','Table rules'))}</h2>
      <div class="bl-variant-picker"><label><span>${esc(tr('bl_variant','Rule variant'))}</span><select id="bl-preset"></select></label><button id="bl-open-settings" type="button">⚙ ${esc(tr('bl_settings','Settings'))}</button></div>
      <div class="bl-settings-overlay" hidden><div class="bl-settings-dialog" role="dialog" aria-modal="true" aria-label="${esc(tr('bl_settings','Settings'))}">
        <div class="bl-settings-head"><div><h2>${esc(tr('bl_settings','Settings'))}</h2><p>${esc(tr('bl_variant_hint','Create and edit your saved rule variants here.'))}</p></div><button id="bl-close-settings" type="button" aria-label="${esc(tr('bl_close','Close'))}">×</button></div>
        <div class="bl-editor-toolbar"><label><span>${esc(tr('bl_variant','Rule variant'))}</span><select id="bl-edit-preset"></select></label><button id="bl-new" type="button">＋ ${esc(tr('bl_new_variant','New variant'))}</button></div>
        <div class="bl-editor-name"><label><span>${esc(tr('bl_preset_name','Preset name'))}</span><input id="bl-preset-name" maxlength="36"></label><p id="bl-editor-note"></p></div>
        <div class="bl-rules"></div>
        <div class="bl-editor-actions"><button id="bl-delete" type="button">${esc(tr('bl_delete','Delete'))}</button><button id="bl-save" type="button">${esc(tr('bl_save','Save'))}</button></div>
      </div></div></div>`;
    const select = box.querySelector('#bl-preset');
    const editSelect = box.querySelector('#bl-edit-preset');
    const overlay = box.querySelector('.bl-settings-overlay');
    const grid = box.querySelector('.bl-rules');
    const nameInput = box.querySelector('#bl-preset-name');
    let editorKey = 'bulgarian';
    let editorRules = {...standard};
    seatBox = box.querySelector('.bl-seat-picker');
    drawSeats();
    function populate() {
      const custom = saved();
      const options = `<option value="bulgarian">${esc(tr('bl_bulgarian','Bulgarian Standard Belot'))}</option>` +
        `<option value="french">${esc(tr('bl_french','French classic Belote'))}</option>` +
        Object.keys(custom).sort().map(key => `<option value="custom:${esc(key)}">${esc(key)} · ${esc(baseOf(custom[key]) === 'french' ? tr('bl_french','French classic Belote') : tr('bl_bulgarian','Bulgarian Standard Belot'))}</option>`).join('');
      select.innerHTML = options;
      if (!Array.from(select.options).some(option => option.value === chosenVariant)) chosenVariant = 'bulgarian';
      select.value = chosenVariant;
      editSelect.innerHTML = options + `<option value="new">${esc(tr('bl_new_variant','New variant'))}</option>`;
      if (!Array.from(editSelect.options).some(option => option.value === editorKey)) editorKey = 'bulgarian';
      editSelect.value = editorKey;
    }
    function draw() {
      grid.innerHTML = fieldsFor(editorRules.variant).map(f => {
        const [key,kind,title] = f;
        const id = 'bl-rule-'+key;
        const locked = ['bulgarian','french'].includes(editorKey) ? 'disabled' : '';
        if (kind === 'check') return `<label class="bl-check"><input id="${id}" type="checkbox" ${editorRules[key]?'checked':''} ${locked}><span>${esc(tr(title,key))}</span></label>`;
        if (kind === 'number') return `<label class="bl-field"><span>${esc(tr(title,key))}</span><input id="${id}" type="number" min="${f[3]}" max="${f[4]}" value="${Number(editorRules[key])}" ${locked}></label>`;
        return `<label class="bl-field"><span>${esc(tr(title,key))}</span><select id="${id}" ${locked}>${f[3].split(',').map(option => {const [v,t] = option.split(':'); return `<option value="${v}" ${editorRules[key]===v?'selected':''}>${esc(tr(t,v))}</option>`}).join('')}</select></label>`;
      }).join('');
      nameInput.disabled = ['bulgarian','french'].includes(editorKey);
      nameInput.value = editorKey.startsWith('custom:') ? editorKey.slice(7) : '';
      box.querySelector('#bl-editor-note').textContent = ['bulgarian','french'].includes(editorKey)
        ? tr('bl_standard_locked','The standard rules are fixed. Create a new variant to change them.')
        : `${tr('bl_based_on','Based on')}: ${editorRules.variant === 'french' ? tr('bl_french','French classic Belote') : tr('bl_bulgarian','Bulgarian Standard Belot')}`;
      box.querySelector('#bl-save').disabled = ['bulgarian','french'].includes(editorKey);
      box.querySelector('#bl-delete').disabled = !editorKey.startsWith('custom:');
    }
    function collect() {
      const result = {...standardFor(editorRules.variant)};
      for (const [key,kind] of fieldsFor(editorRules.variant)) {
        const el = box.querySelector('#bl-rule-'+key);
        result[key] = kind === 'check' ? el.checked : kind === 'number' ? Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value))) : el.value;
      }
      return result;
    }
    function loadEditor(key) {
      editorKey = key;
      const existing = key.startsWith('custom:') ? saved()[key.slice(7)] : null;
      editorRules = {...standardFor(existing ? baseOf(existing) : key), ...(existing || {})};
      editSelect.value = key;
      draw();
    }
    populate(); loadEditor('bulgarian');
    select.onchange = () => { chosenVariant = select.value; };
    editSelect.onchange = () => {
      if (editSelect.value === 'new') box.querySelector('#bl-new').click();
      else loadEditor(editSelect.value);
    };
    box.querySelector('#bl-open-settings').onclick = () => {
      loadEditor(chosenVariant);
      overlay.hidden = false;
      editSelect.focus();
    };
    box.querySelector('#bl-close-settings').onclick = () => { overlay.hidden = true; };
    overlay.onclick = event => { if (event.target === overlay) overlay.hidden = true; };
    overlay.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); overlay.hidden = true; } };
    box.querySelector('#bl-new').onclick = () => {
      editorRules = ['bulgarian','french'].includes(editorKey) ? {...standardFor(editorKey)} : collect();
      editorKey = 'new';
      editSelect.value = 'new';
      draw();
      nameInput.focus();
    };
    box.querySelector('#bl-save').onclick = () => {
      if (['bulgarian','french'].includes(editorKey)) return;
      const name = nameInput.value.trim();
      if (!name) return alert(tr('bl_name_required','Enter a preset name.'));
      const all = saved();
      if (Object.prototype.hasOwnProperty.call(all, name) && editorKey !== 'custom:' + name) return alert(tr('bl_name_exists','A variant with this name already exists.'));
      const rules = collect();
      if (editorKey.startsWith('custom:') && lastVariant() === editorKey) rememberVariant('custom:' + name);
      if (editorKey.startsWith('custom:')) delete all[editorKey.slice(7)];
      save(Object.fromEntries([...Object.entries(all), [name, rules]]));
      editorKey = chosenVariant = 'custom:' + name;
      populate(); loadEditor(editorKey); overlay.hidden = true;
    };
    box.querySelector('#bl-delete').onclick = () => {
      if (!editorKey.startsWith('custom:') || !confirm(tr('bl_delete_confirm','Delete this saved variant?'))) return;
      const fallback = baseOf(editorRules);
      if (lastVariant() === editorKey) rememberVariant(fallback);
      const all = saved(); delete all[editorKey.slice(7)]; save(all);
      if (chosenVariant === editorKey) chosenVariant = fallback;
      editorKey = fallback; populate(); loadEditor(editorKey);
    };
    return () => {
      const custom = chosenVariant.startsWith('custom:') ? saved()[chosenVariant.slice(7)] : null;
      pendingStartedVariant = {room: mp.roomId(), variant: chosenVariant};
      return {rules:custom ? {...standardFor(baseOf(custom)), ...custom} : {...standardFor(chosenVariant)}, seats:seatIds.slice()};
    };
  }
  function drawSeats() {
    if (!seatBox || !seatBox.isConnected) return;
    const people = mp.players().filter(p => p.connected);
    const active = new Set(people.map(p => String(p.id)));
    seatIds = seatIds.map(id => active.has(id) ? id : null);
    for (const p of people) {
      const id = String(p.id);
      if (!seatIds.includes(id)) {
        const open = seatIds.indexOf(null);
        if (open !== -1) seatIds[open] = id;
      }
    }
    seatBox.innerHTML = [0, 1].map(team => {
      const seats = [team, team + 2].map(i => {
        const botDisabled = !seatIds.includes(null) && seatIds[i] !== null ? 'disabled' : '';
        const options = `<option value="" ${botDisabled}>${esc(tr('bl_bot','Bot'))}</option>` + people.map(p => {
          const id = String(p.id);
          return `<option value="${esc(id)}" ${seatIds[i] === id ? 'selected' : ''}>${esc(p.display_name)}</option>`;
        }).join('');
        return `<label class="bl-seat-choice"><span>${esc(tr('bl_seat','Seat'))} ${i+1}</span><select data-seat="${i}">${options}</select></label>`;
      }).join('');
      return `<div class="bl-team-choice"><strong>${esc(tr('bl_team','Team'))} ${team ? 'B' : 'A'}</strong>${seats}</div>`;
    }).join('');
    seatBox.querySelectorAll('select').forEach(select => select.onchange = () => {
      const seat = Number(select.dataset.seat);
      const next = select.value || null;
      const previous = seatIds[seat];
      if (next === previous) return;
      if (next) {
        const other = seatIds.indexOf(next);
        if (other !== -1) seatIds[other] = previous;
        seatIds[seat] = next;
      } else {
        const open = seatIds.findIndex((id, i) => i !== seat && id === null);
        if (open !== -1) {
          seatIds[open] = previous;
          seatIds[seat] = null;
        }
      }
      drawSeats();
    });
  }
  mp.on('roster', drawSeats);
  function card(c, clickable=false) {
    const red = 'DH'.includes(c[1]);
    return `<button class="bl-card ${red?'red':'black'} ${clickable?'playable':''}" data-card="${esc(c)}" ${clickable?'':'disabled'}><span>${esc(c[0]==='T'?'10':c[0])}</span><strong>${suit[c[1]]}</strong><small>${esc(c[0]==='T'?'10':c[0])}</small></button>`;
  }
  function announcementLabel(item) {
    if (item.kind === 'quad') return `${tr('bl_four_kind','Four of a kind')} ${item.value}`;
    return (item.length || item.cards?.length) === 3 ? tr('bl_terce','Terce') : String(item.value);
  }
  function renderGame(root) {
    view = root;
    root.innerHTML = `<div class="bl-table"><div class="bl-top"><a href="/pub/gamehub/?game=belot">← ${esc(tr('bl_hub','Game Hub'))}</a><div id="bl-score"></div><div id="bl-contract"></div><button id="bl-show-rules">${esc(tr('bl_rules','Table rules'))}</button></div><div class="bl-message" id="bl-message"></div><div class="bl-upcard" id="bl-upcard" hidden></div><div class="bl-seats" id="bl-seats"></div><details class="bl-reveal" id="bl-reveal" hidden><summary></summary><div class="bl-reveal-list"></div></details><div class="bl-felt"><div class="bl-trick" id="bl-trick"></div></div><div class="bl-actions" id="bl-actions"></div><div class="bl-declarations" id="bl-declarations"></div><div class="bl-hand" id="bl-hand"></div></div>`;
    root.querySelector('#bl-show-rules').onclick = () => {
      if (!state) return;
      const lines = fieldsFor(state.rules.variant).map(([key,kind,title]) => {
        const value = state.rules[key];
        return tr(title,key) + ': ' + (kind==='check' ? (value?'✓':'—') : value);
      });
      alert(lines.join('\n'));
    };
    draw();
  }
  function draw() {
    if (!view || !state) return;
    const me = state.seat;
    view.querySelector('#bl-score').textContent = `${tr('bl_team','Team')} A ${state.scores[0]} · ${tr('bl_team','Team')} B ${state.scores[1]}${state.hanging?' · ⏳ '+state.hanging:''}`;
    view.querySelector('#bl-contract').textContent = state.bid ? `${tr('bl_contract','Contract')}: ${label(state.bid)} · ${state.seats[state.bidder].name}${state.double ? ' · '+(state.double===1?tr('bl_contra','Contra'):tr('bl_recontra','Recontra')) : ''}` : tr('bl_bidding','Bidding');
    const upcard = view.querySelector('#bl-upcard');
    upcard.hidden = !(state.rules.variant === 'french' && state.phase === 'bidding');
    if (!upcard.hidden) upcard.innerHTML = `<span>${esc(tr('bl_turned_card','Turned card'))} · ${esc(tr('bl_bidding_round','Round'))} ${state.french_round}</span>${card(state.upcard)}`;
    view.querySelector('#bl-seats').innerHTML = state.seats.map((p,i) => {
      const announced = (state.announced || [])[i];
      const said = announced ? (announced.items ? announced.items.map(announcementLabel).join(', ') : tr('bl_announced_generic','Has an announcement')) : '';
      return `<div class="bl-seat ${state.turn===i?'active':''} ${i===me?'self':''}"><span>${esc(p.bot?'🤖':'●')} ${esc(p.name)}</span><small>${esc(tr('bl_team','Team'))} ${i%2?'B':'A'} · ${state.counts[i]} ${esc(tr('bl_cards','cards'))}</small>${said?`<em class="bl-announced">${esc(said)}</em>`:''}</div>`;
    }).join('');
    const reveal = view.querySelector('#bl-reveal');
    const wasOpen = reveal.open;
    const currentVisible = !state.result && (state.current_reveal || []).some(items => items.length);
    const revealed = currentVisible ? state.current_reveal : state.last_reveal || [];
    reveal.hidden = !revealed.some(items => items.length);
    if (!reveal.hidden) {
      reveal.querySelector('summary').textContent = currentVisible ? tr('bl_current_announcements','Current deal announcements') : tr('bl_previous_announcements','Previous deal announcements');
      reveal.querySelector('.bl-reveal-list').innerHTML = revealed.map((items,i) => items.length
        ? `<div><strong>${esc(state.seats[i].name)}:</strong> ${items.map(a => esc(announcementLabel(a) + ' (' + a.cards.map(c => (c[0]==='T'?'10':c[0])+suit[c[1]]).join(' ') + ')')).join(', ')}</div>` : '').join('');
      reveal.open = !!state.result || currentVisible || wasOpen;
    }
    view.querySelector('#bl-trick').innerHTML = state.trick.map(([seat,c]) => `<div class="bl-played"><span>${esc(state.seats[seat].name)}</span>${card(c)}</div>`).join('') || (state.last ? state.last.map(([seat,c]) => `<div class="bl-played"><span>${esc(state.seats[seat].name)}</span>${card(c)}</div>`).join('') : '');
    const yourTurn = state.turn===me;
    const msg = state.result ? `${tr('bl_deal_result','Deal')}: ${state.result.awarded.join(' : ')}` : state.phase==='bidding' ? (yourTurn ? tr(state.rules.variant === 'french' ? 'bl_choose_french' : 'bl_choose_bid',state.rules.variant === 'french' ? 'Take a trump suit or pass' : 'Choose a contract or pass') : tr('bl_wait_bid','Waiting for bid…')) : yourTurn ? tr('bl_your_turn','Your turn') : `${tr('bl_waiting','Waiting for')} ${state.seats[state.turn].name}`;
    view.querySelector('#bl-message').textContent = msg;
    view.querySelector('#bl-actions').innerHTML = state.phase==='bidding' && yourTurn ? `<button data-bid="PASS">${esc(tr('bl_pass','Pass'))}</button>` + state.contracts.map(c => `<button data-bid="${c}">${state.rules.variant === 'french' ? esc(tr(state.french_round === 1 ? 'bl_take' : 'bl_choose_trump',state.french_round === 1 ? 'Take' : 'Choose')) + ' ' : ''}${suit[c]} ${esc(label(c))}</button>`).join('') + (state.can_contra?`<button data-bid="CONTRA">${esc(tr('bl_contra','Contra'))}</button>`:'') + (state.can_recontra?`<button data-bid="RECONTRA">${esc(tr('bl_recontra','Recontra'))}</button>`:'') : '';
    view.querySelectorAll('[data-bid]').forEach(btn => btn.onclick=() => { if (pending) return; pending=true; mp.send({type:'bl_bid',contract:btn.dataset.bid}); });
    const declarations = view.querySelector('#bl-declarations');
    const options = state.announcement_options || [];
    declarations.innerHTML = options.length && yourTurn ? `<strong>${esc(tr('bl_announce_before_play','Announce before your first card'))}</strong>` +
      options.map(a => `<label><input type="checkbox" value="${esc(a.id)}"><span>${esc(tr(a.kind==='quad'?'bl_four_kind':'bl_sequence',a.kind))} ${esc(a.cards.map(c => (c[0]==='T'?'10':c[0])+suit[c[1]]).join(' '))} · ${a.value}</span></label>`).join('') : '';
    declarations.hidden = !options.length || !yourTurn;
    declarations.querySelectorAll('input').forEach(input => input.onchange = () => {
      if (!input.checked) return;
      const picked = options.find(a => a.id === input.value);
      declarations.querySelectorAll('input:checked').forEach(other => {
        if (other !== input && options.find(a => a.id === other.value).cards.some(c => picked.cards.includes(c))) other.checked = false;
      });
    });
    view.querySelector('#bl-hand').innerHTML = state.hand.map(c => card(c, yourTurn && state.phase==='playing' && state.legal.includes(c))).join('');
    view.querySelectorAll('.bl-hand .playable').forEach(btn => btn.onclick=() => {
      if (pending) return;
      const announceBelote = (state.belote_cards || []).includes(btn.dataset.card)
        ? confirm((state.rebelote_cards || []).includes(btn.dataset.card)
          ? tr('bl_announce_rebelote','Announce rebelote for this card?')
          : tr('bl_announce_belote','Announce belote for this card?')) : false;
      const announced = Array.from(declarations.querySelectorAll('input:checked')).map(input => input.value);
      pending=true;
      mp.send({type:'bl_play',card:btn.dataset.card,announcements:announced,belote:announceBelote});
    });
  }
  mp.on('bl_state', s => {
    if (pendingStartedVariant?.room === mp.roomId()) {
      rememberVariant(pendingStartedVariant.variant);
      pendingStartedVariant = null;
    }
    pending=false; state=s; draw();
  });
  mp.on('game_over', msg => {
    if (!view || !state) return;
    const team = state.seat%2;
    view.querySelector('#bl-message').textContent = state.scores[team] > state.scores[1-team] ? tr('bl_win','You win!') : state.scores[team] === state.scores[1-team] ? tr('bl_draw','Draw') : tr('bl_lose','You lose');
    view.querySelector('#bl-actions').innerHTML = `<a href="/pub/gamehub/?game=belot">${esc(tr('bl_back','Back to Game Hub'))}</a>`;
    view.querySelector('#bl-hand').innerHTML = '';
  });
  mp.registerGame({id:'belot',name:'Belot',renderSetup:ruleForm,renderGame,
    snapshot:()=>({seats: state?.seats?.map(p => p.id) || seatIds.slice(), variant:chosenVariant})});
})();
