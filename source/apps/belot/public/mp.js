(function () {
  if (!window.GameHub?.mp) return;
  const mp = window.GameHub.mp;
  const tr = (key, fallback) => window.t ? window.t(key, fallback) : fallback;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const suit = {C:'♣',D:'♦',H:'♥',S:'♠',NT:'',AT:''};
  // A suit shows as its sign; no trump and all trump show as their name, never as an abbreviation.
  const contractMark = c => `<span class="${'DH'.includes(c) ? 'redsuit' : ''}">${suit[c] || esc(label(c))}</span>`;
  const label = c => ({C:tr('bl_clubs','Clubs'),D:tr('bl_diamonds','Diamonds'),H:tr('bl_hearts','Hearts'),S:tr('bl_spades','Spades'),NT:tr('bl_nt','No trump'),AT:tr('bl_at','All trump')})[c] || c;
  const standard = {variant:'bulgarian',contracts:'all',no_trump_raise:false,all_trump_raise:true,trump_raise:true,plain_raise:false,
    must_trump:true,partner_winning_exempts:true,must_overtrump:true,allow_undertrump:false,
    announcements:true,announcements_mode:'declare',announcement_visibility:'named',announcement_competition:'highest',equal_value_priority:'quad',no_trump_announcements:false,
    belote:true,belote_mode:'declare',all_trump_belote_follow:true,
    allow_contra:true,escape_contra:true,capot_cancels_contra:true,capot_bonus:90,no_trump_capot_doubled:true,no_trump_multiplier:2,target:151,
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
    ['capot_cancels_contra','check','bl_capot_cancels_contra'],
    ['redeal_all_pass','check','bl_redeal'],
    ['no_trump_multiplier','number','bl_nt_multiplier',1,3],
    ['capot_bonus','number','bl_capot_bonus',0,200],
    ['no_trump_capot_doubled','check','bl_no_trump_capot_doubled'],
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
  // AI mentors for bots (Premium): what the server offers, and the seats chosen.
  let aiInfo = null, aiSeats = [false, false, false, false], aiLoadedFor = null;
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
    loadAiInfo();
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
      return {rules:custom ? {...standardFor(baseOf(custom)), ...custom} : {...standardFor(chosenVariant)}, seats:seatIds.slice(), ai: aiInfo?.available ? aiSeats.slice() : undefined};
    };
  }
  let pickedSeat = null;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const seatAvatar = (seat, size, ai) => {
    if (!seat || seat.bot) return `<span class="bl-botface" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.55)}px">${ai ? '🧠' : '🤖'}</span>`;
    const p = mp.players().find(x => String(x.id) === String(seat.id));
    return mp.renderAvatar(p || {display_name: seat.name}, size);
  };
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
    const pos = ['bottom', 'left', 'top', 'right'];
    const offered = !!aiInfo?.available;
    const price = Number(aiInfo?.price) || 0;
    const maxAi = price > 0 ? Math.floor((Number(aiInfo?.balance) || 0) / price) : 4;
    let used = 0;
    aiSeats = aiSeats.map((on, i) => {
      const keep = offered && on && !seatIds[i] && used < maxAi;
      if (keep) used += 1;
      return keep;
    });
    seatBox.innerHTML = `<div class="bl-seatmap"><div class="bl-seatmap-felt"><i class="bl-line a"></i><i class="bl-line b"></i></div>` +
      seatIds.map((id, i) => {
        const person = id ? people.find(p => String(p.id) === id) : null;
        const seat = person ? {id, name: person.display_name, bot: false} : {bot: true};
        const ai = !person && offered
          ? `<span class="bl-aibtn ${aiSeats[i] ? 'on' : ''}" data-ai="${i}" role="button" tabindex="0">🧠 ${esc(tr('bl_ai_label','AI'))}</span>` : '';
        return `<button type="button" class="bl-sseat ${pos[i]} team${i % 2 ? 'b' : 'a'} ${pickedSeat === i ? 'sel' : ''}" data-seat="${i}">${seatAvatar(seat, 46, aiSeats[i])}<b>${esc(person ? person.display_name : tr('bl_bot','Bot'))}</b><small>${esc(tr('bl_team','Team'))} ${i % 2 ? 'B' : 'A'}</small>${ai}</button>`;
      }).join('') + `</div><p class="bl-seat-note">${pickedSeat === null ? '' : esc(tr('bl_swap_next','Tap the seat to swap with'))}</p>` +
      (offered ? `<p class="bl-seat-note bl-ai-note">${esc(tr('bl_ai_hint','Tap AI under a bot to give it an AI mentor.'))}${price
        ? ' ' + esc(tr('bl_ai_cost','An AI bot costs %price% credits per game. You have %balance%.').replace('%price%', price).replace('%balance%', aiInfo.balance || 0))
          + (used ? ' ' + esc(tr('bl_ai_total','This table: %n% × %price% = %total% credits.').replace('%n%', used).replace('%price%', price).replace('%total%', used * price)) : '')
          + (used >= maxAi ? ' ' + esc(tr('bl_ai_short','Not enough credits for more AI bots.')) : '') : ''}</p>` : '');
    seatBox.querySelectorAll('.bl-aibtn').forEach(btn => {
      const toggle = async event => {
        event.stopPropagation();
        const seat = Number(btn.dataset.ai);
        if (aiSeats[seat]) { aiSeats[seat] = false; return drawSeats(); }
        const count = aiSeats.filter(Boolean).length;
        if (count >= maxAi) return drawSeats();
        // A priced AI bot is only switched on once the host has agreed to pay for it.
        if (price > 0 && !(await askToPay(price, (count + 1) * price, Number(aiInfo.balance) || 0))) return;
        aiSeats[seat] = true;
        drawSeats();
      };
      btn.onclick = toggle;
      btn.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(event); } };
    });
    seatBox.querySelectorAll('.bl-sseat').forEach(btn => btn.onclick = () => {
      const seat = Number(btn.dataset.seat);
      if (pickedSeat === null) { pickedSeat = seat; return drawSeats(); }
      if (pickedSeat !== seat) {
        [seatIds[pickedSeat], seatIds[seat]] = [seatIds[seat], seatIds[pickedSeat]];
        [aiSeats[pickedSeat], aiSeats[seat]] = [aiSeats[seat], aiSeats[pickedSeat]];
      }
      pickedSeat = null;
      drawSeats();
    });
  }
  // Asks the host to confirm what the AI bots will cost; resolves true or false.
  function askToPay(price, total, balance) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'bl-ask bl-ask-fixed';
      box.innerHTML = `<div class="bl-bidpanel"><div class="bl-bidnow">${esc(tr('bl_ai_confirm_title','Use an AI bot?'))}</div>` +
        `<p class="bl-ask-text">${esc(tr('bl_ai_confirm_body','An AI bot costs %price% credits, taken when the game starts. With this bot the table costs %total% credits. You have %balance%.').replace('%price%', price).replace('%total%', total).replace('%balance%', balance))}</p>` +
        `<button type="button" data-yes="1">${esc(tr('bl_ai_confirm_yes','Use AI'))}</button>` +
        `<button type="button" class="alt" data-yes="0">${esc(tr('bl_ai_confirm_no','Cancel'))}</button></div>`;
      document.body.appendChild(box);
      box.querySelectorAll('button').forEach(button => button.onclick = () => { box.remove(); resolve(button.dataset.yes === '1'); });
    });
  }
  async function loadAiInfo() {
    const token = localStorage.getItem('apphub_token');
    const roomId = mp.roomId();
    if (!token || aiLoadedFor === roomId) return;
    aiLoadedFor = roomId;
    try {
      const res = await fetch('/pub/belot/ai-info', {headers: {'X-Pub-Token': token}});
      aiInfo = res.ok ? await res.json() : null;
    } catch (_) { aiInfo = null; }
    drawSeats();
  }
  mp.on('roster', drawSeats);

  // ---- cards ----
  const pipMap = {
    '7':[[30,20],[70,20],[30,50],[70,50],[30,80],[70,80],[50,35]],
    '8':[[30,20],[70,20],[30,50],[70,50],[30,80],[70,80],[50,35],[50,65]],
    '9':[[30,18],[70,18],[30,39],[70,39],[30,61],[70,61],[30,82],[70,82],[50,50]],
    'T':[[30,18],[70,18],[30,39],[70,39],[30,61],[70,61],[30,82],[70,82],[50,28],[50,72]]
  };
  const emblem = {J:'♞︎', Q:'♛︎', K:'♚︎'};
  const rank = c => c[0] === 'T' ? '10' : c[0];
  function cardMarkup(c) {
    const r = c[0], s = suit[c[1]];
    let body;
    if (pipMap[r]) body = `<div class="pips">${pipMap[r].map(([x,y]) => `<i class="${y > 50 ? 'inv' : ''}" style="left:${x}%;top:${y}%">${s}</i>`).join('')}</div>`;
    else if (r === 'A') body = `<div class="pips ace"><i style="left:50%;top:50%">${s}</i></div>`;
    else body = `<div class="face"><em class="fs">${s}</em><b>${emblem[r]}</b><em class="fs inv">${s}</em></div>`;
    return `<span class="ix tl"><b>${rank(c)}</b><u>${s}</u></span><span class="ix br"><b>${rank(c)}</b><u>${s}</u></span>${body}`;
  }
  function cardEl(c, tag = 'div') {
    const el = document.createElement(tag);
    el.className = 'bl-card ' + ('DH'.includes(c[1]) ? 'red' : 'black');
    el.dataset.card = c;
    el.innerHTML = cardMarkup(c);
    if (tag === 'button') el.type = 'button';
    return el;
  }
  const cardHtml = c => cardEl(c).outerHTML;
  const backHtml = (n, side) => Array.from({length:n}, () => `<div class="bl-card bl-back ${side ? 'side' : ''}"></div>`).join('');
  const center = el => { const r = el.getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2, w:r.width}; };
  function flyFrom(el, from, opts = {}) {
    if (reduced() || !el.animate || !from) return;
    const to = center(el);
    const dx = from.x - to.x, dy = from.y - to.y, k = (from.w || to.w) / (to.w || 1);
    el.animate([
      {transform:`translate(${dx}px,${dy}px) scale(${k}) rotate(${opts.rot || 0}deg)`, opacity: opts.fade ? 0 : 1},
      {transform:'none', opacity:1}
    ], {duration:opts.dur || 460, delay:opts.delay || 0, easing:'cubic-bezier(.2,.8,.25,1)', fill:'backwards'});
  }

  function announcementLabel(item) {
    if (item.kind === 'quad') return `${tr('bl_four_kind','Four of a kind')} ${item.value}`;
    return (item.length || item.cards?.length) === 3 ? tr('bl_terce','Terce') : String(item.value);
  }

  // ---- sound (synthesized, no files) ----
  const sfx = (() => {
    let ctx = null, master = null, noiseBuf = null;
    const enabled = () => { try { return localStorage.getItem('belot.sound') !== '0'; } catch (_) { return true; } };
    function unlock() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; }
        master = ctx.createGain(); master.gain.value = .7; master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function env(g, t0, dur, peak) {
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + .008); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    }
    function tone(f, dur, o = {}) {
      const t0 = ctx.currentTime + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      env(g, t0, dur, o.gain || .12);
      if (o.lp) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; osc.connect(lp).connect(g); } else osc.connect(g);
      g.connect(master); osc.start(t0); osc.stop(t0 + dur + .03);
    }
    const bellNote = (f, at, gain = .08, dur = .55) => { tone(f, dur, {at, gain}); tone(f * 2, dur * .6, {at, gain: gain * .35}); };
    const suitNote = {C:392, D:440, H:494, S:587};
    function noise(dur, o = {}) {
      const t0 = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; filt.type = o.type || 'bandpass'; filt.Q.value = o.q || 1; filt.frequency.setValueAtTime(o.f || 2000, t0);
      if (o.to) filt.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      env(g, t0, dur, o.gain || .1); src.connect(filt).connect(g).connect(master); src.start(t0, Math.random() * .5); src.stop(t0 + dur + .03);
    }
    const sounds = {
      deal() { noise(.06, {f:3400, q:.8, gain:.1}); },
      play() { noise(.09, {type:'lowpass', f:1100, gain:.2}); tone(150, .09, {to:70, gain:.16}); },
      sweep() { noise(.45, {f:700, to:3200, q:.7, gain:.09}); },
      turn() { tone(880, .14, {gain:.07}); tone(1320, .2, {at:.11, gain:.07}); },
      bell() { tone(1046, .6, {gain:.09}); tone(1568, .5, {at:.05, gain:.05}); },
      // Every call sounds different: a flat sigh for pass, a rising ding per suit, brass for no trump, a growl for all trump.
      bid(call) {
        if (call === 'PASS') tone(300, .18, {type:'triangle', to:225, gain:.07});
        else if (suitNote[call]) { tone(suitNote[call], .14, {type:'triangle', gain:.1}); tone(suitNote[call] * 1.5, .22, {at:.09, type:'triangle', gain:.07}); }
        else if (call === 'NT') { tone(262, .45, {type:'sawtooth', lp:900, gain:.09}); tone(392, .45, {at:.14, type:'sawtooth', lp:1100, gain:.08}); tone(523, .5, {at:.28, type:'sawtooth', lp:1300, gain:.07}); }
        else if (call === 'AT') {
          tone(98, 1, {type:'sawtooth', lp:520, to:80, gain:.16}); tone(139, 1, {type:'sawtooth', lp:620, to:110, gain:.12});
          tone(55, 1, {gain:.2, to:45}); noise(.9, {type:'lowpass', f:220, gain:.18}); tone(147, .5, {at:.4, type:'square', lp:500, gain:.06});
        }
        else if (call === 'CONTRA') { tone(190, .28, {type:'square', lp:800, to:120, gain:.1}); noise(.12, {type:'lowpass', f:900, gain:.16}); }
        else if (call === 'RECONTRA') { [0, .22].forEach(at => { tone(150, .28, {at, type:'square', lp:700, to:90, gain:.12}); noise(.12, {at, type:'lowpass', f:800, gain:.18}); }); }
      },
      belote() { bellNote(784, 0); bellNote(1046, .14, .09); },
      rebelote() { bellNote(784, 0); bellNote(1046, .13, .09); bellNote(1318, .26, .09, .7); },
      // Bigger announcements ring longer: terce 2 notes ... 200 six notes with a drum and a cymbal swell.
      ann(total) {
        const level = total <= 20 ? 1 : total <= 50 ? 2 : total <= 100 ? 3 : total <= 150 ? 4 : 5;
        [523, 659, 784, 1046, 1318, 1568].slice(0, level + 1).forEach((f, i) => bellNote(f, i * .11, .07 + level * .006));
        if (level >= 3) tone(90, .3, {to:50, gain:.2});
        if (level >= 4) tone(262, .8, {type:'triangle', gain:.08});
        if (level >= 5) { noise(1, {type:'highpass', f:5000, gain:.07}); tone(131, 1, {type:'triangle', gain:.12}); tone(60, .5, {to:40, gain:.22, at:.1}); }
      },
      win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .45, {at:i * .14, type:'triangle', gain:.1})); },
      lose() { [392, 330, 262].forEach((f, i) => tone(f, .5, {at:i * .2, type:'triangle', gain:.09})); }
    };
    return {
      enabled, unlock,
      play(name, arg) { if (!enabled() || !view?.isConnected) return; if (unlock() && sounds[name]) try { sounds[name](arg); } catch (_) {} },
      toggle() { try { localStorage.setItem('belot.sound', enabled() ? '0' : '1'); } catch (_) {} if (enabled()) unlock(); return enabled(); }
    };
  })();
  document.addEventListener('pointerdown', () => sfx.unlock(), true);

  // ---- table ----
  const STEP = 90, PACKET = 210, FLIGHT = 520;
  const cardPoints = {A:11, T:10, K:4, Q:3, J:2, '9':0, '8':0, '7':0};
  const trumpPoints = {J:20, '9':14, A:11, T:10, K:4, Q:3, '8':0, '7':0};
  const trickPoints = (cards, contract) => cards.reduce((sum, [, c]) => sum + ((contract === 'AT' || c[1] === contract ? trumpPoints : cardPoints)[c[0]] || 0), 0);
  let sweepTimers = [], sweeping = false, sweepKey = null, clickRect = null, bannerText = '', bannerTimer = 0, builtKey = '';
  let localHistory = [], dealResultTimer = 0, lastResultKey = '', lastAiSay = 0;
  let declPicked = new Set();
  let dealUntil = 0, dealTimer = 0, says = [[], [], [], []], saysTimer = 0;
  const dealing = () => Date.now() < dealUntil;
  function renderGame(root) {
    view = root; root.style.containerType = 'inline-size'; builtKey = ''; sweeping = false; sweepTimers.forEach(clearTimeout); sweepTimers = [];
    localHistory = []; lastResultKey = ''; seenBidEvents = 0; queue = []; shownAt = 0; pace = 0; clearTimeout(pumpTimer); dealUntil = 0; clearTimeout(dealTimer); says = [[], [], [], []];
    root.innerHTML = `<div class="bl-table"><div class="bl-top"><a id="bl-exit" href="/pub/gamehub/?game=belot">${mp.canSave() ? '⏸ ' + esc(tr('bl_save_exit','Save & exit')) : '← ' + esc(tr('bl_hub','Game Hub'))}</a><div id="bl-score" role="button" tabindex="0"></div><span class="bl-top-btns"><button id="bl-sound" type="button" title="${esc(tr('bl_sound','Sound'))}"></button><button id="bl-show-rules">${esc(tr('bl_rules_short','Rules'))}</button></span></div>
      <div class="bl-board" id="bl-board"><div class="bl-felt"></div>
        <div class="bl-corner"><div class="bl-trump" id="bl-contract" hidden></div><div class="bl-upcard" id="bl-upcard" hidden></div></div>
        <div class="bl-players" id="bl-seats"></div>
        <div class="bl-actions" id="bl-actions"></div><div class="bl-trickbox" id="bl-trick"><div class="bl-slot p0"></div><div class="bl-slot p1"></div><div class="bl-slot p2"></div><div class="bl-slot p3"></div></div>
      </div>
      <div class="bl-message" id="bl-message"></div>
      <div class="bl-declarations" id="bl-declarations"></div><div class="bl-hand" id="bl-hand"></div><div class="bl-fly" id="bl-fly"></div><div class="bl-overlay deal" id="bl-deal" hidden></div><div class="bl-overlay" id="bl-history" hidden></div><div class="bl-overlay end" id="bl-end" hidden></div></div>`;
    // A solo game is put down with Game Hub's own save question; otherwise this is just the way back.
    root.querySelector('#bl-exit').onclick = event => { if (mp.canSave()) { event.preventDefault(); mp.exitPrompt(); } };
    root.querySelector('#bl-show-rules').onclick = () => {
      if (!state) return;
      const lines = fieldsFor(state.rules.variant).map(([key,kind,title]) => {
        const value = state.rules[key];
        return tr(title,key) + ': ' + (kind==='check' ? (value?'✓':'—') : value);
      });
      alert(lines.join('\n'));
    };
    const soundBtn = root.querySelector('#bl-sound');
    const paintSound = () => { soundBtn.textContent = sfx.enabled() ? '🔊' : '🔇'; };
    paintSound();
    soundBtn.onclick = () => { sfx.toggle(); paintSound(); };
    const openHistory = () => { const box = root.querySelector('#bl-history'); box.hidden = !box.hidden; if (!box.hidden) renderHistory(); };
    root.querySelector('#bl-score').onclick = openHistory;
    root.querySelector('#bl-score').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openHistory(); } };
    root.querySelector('#bl-history').onclick = event => { if (event.target.id === 'bl-history' || event.target.closest('.bl-ov-close')) event.currentTarget.hidden = true; };
    root.querySelector('#bl-end').onclick = event => { event.currentTarget.hidden = true; };
    root.querySelector('#bl-hand').addEventListener('click', event => {
      const btn = event.target.closest('.playable');
      if (!btn || pending || !state || dealing()) return;
      const card = btn.dataset.card;
      // First tap lifts the card, a second tap on the lifted card plays it.
      // With only one legal card there is nothing to confirm: one tap plays it.
      if (state.legal.length > 1 && pickedCard !== card) { pickedCard = card; markPicked(); return; }
      // The card stays lifted until the table takes it, so it never drops back first.
      clickRect = {...center(btn), at: Date.now()};
      const rebelote = (state.rebelote_cards || []).includes(card);
      (state.belote_cards || []).includes(card) ? askBelote(rebelote).then(play) : play(false);
      function play(announceBelote) {
        const announced = Array.from(declPicked);
        declPicked = new Set();
        pending = true;
        // The card shows at once that it was taken, until the table answers.
        const sent = view.querySelector(`#bl-hand .bl-card[data-card="${card}"]`);
        sent?.classList.add('sending');
        mp.send({type:'bl_play',card,announcements:announced,belote:announceBelote});
        // If the table has not answered, give the card back to the player, still lifted, to tap again.
        setTimeout(() => {
          if (pending && state && state.turn === state.seat && state.hand.includes(card)) { report('card-unanswered'); pending = false; sent?.classList.remove('sending'); pickedCard = card; markPicked(); mp.send({type: 'bl_sync'}); }
        }, 3000);
      }
    });
    draw(null);
  }
  // Asks, on the table itself, whether to say belote/rebelote for the card being played.
  function askBelote(rebelote) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'bl-ask';
      box.innerHTML = `<div class="bl-bidpanel"><div class="bl-bidnow">${esc(rebelote ? tr('bl_announce_rebelote','Announce rebelote for this card?') : tr('bl_announce_belote','Announce belote for this card?'))}</div>` +
        `<button type="button" data-yes="1">${esc(rebelote ? tr('bl_rebelote_say','Rebelote!') : tr('bl_belote_say','Belote!'))}</button>` +
        `<button type="button" class="alt" data-yes="0">${esc(tr('bl_play_without','Play without announcing'))}</button></div>`;
      view.querySelector('.bl-table').appendChild(box);
      box.querySelectorAll('button').forEach(button => button.onclick = () => { box.remove(); resolve(button.dataset.yes === '1'); });
    });
  }
  const plainOrder = '789JQKTA', trumpOrder = '78QKTA9J';
  function trickWinner(trick, contract) {
    const led = trick[0][1][1];
    const power = c => contract !== 'AT' && c[1] === contract ? 100 + trumpOrder.indexOf(c[0])
      : c[1] === led ? (contract === 'AT' ? trumpOrder : plainOrder).indexOf(c[0]) : -1;
    return trick.reduce((best, cur) => power(cur[1]) > power(best[1]) ? cur : best)[0];
  }
  const relPos = seat => (seat - (state.seat ?? 0) + 4) % 4;
  const playerEl = pos => view.querySelector(`.bl-player.p${pos}`);
  const avatarRect = pos => { const el = playerEl(pos)?.querySelector('.bl-av'); return el ? center(el) : null; };
  function buildPlayers() {
    const key = state.seats.map((s, i) => (s.id || 'bot') + ((state.ai_seats || []).includes(i) ? '+ai' : '')).join('|') + '/' + (state.seat ?? 0);
    if (key === builtKey) return;
    builtKey = key;
    view.querySelector('#bl-seats').innerHTML = [0,1,2,3].map(pos => {
      const seat = (pos + (state.seat ?? 0)) % 4;
      return `<div class="bl-player p${pos} team${seat % 2 ? 'b' : 'a'}" data-seat="${seat}"><div class="bl-av">${seatAvatar(state.seats[seat], pos === 0 ? 50 : 44, (state.ai_seats || []).includes(seat))}</div>
        <div class="bl-pinfo"><b class="bl-pname"></b><small class="bl-pmeta"></small><span class="bl-chips"></span></div>${pos ? '<div class="bl-fan"></div>' : ''}<div class="bl-say"></div></div>`;
    }).join('');
    renderSays();
  }

  // Speech bubbles: what each player called or announced, kept on screen for a while.
  function addSay(seat, kind, text, ms) {
    says[seat] = says[seat].filter(item => item.kind !== kind);
    says[seat].push({kind, text, until: ms ? Date.now() + ms : Infinity});
    renderSays();
  }
  function dropSay(seat, kind) {
    if (!says[seat].some(item => item.kind === kind)) return;
    says[seat] = says[seat].filter(item => item.kind !== kind);
    renderSays();
  }
  function renderSays() {
    clearTimeout(saysTimer);
    if (!view) return;
    const at = Date.now();
    let next = Infinity;
    says = says.map(list => list.filter(item => item.until > at));
    says.forEach((list, seat) => {
      const box = view.querySelector(`.bl-player[data-seat="${seat}"] .bl-say`);
      if (!box) return;
      const html = list.map(item => `<span class="bl-bubble ${item.kind} ${item.tone || ''}">${esc(item.text)}</span>`).join('');
      if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
      list.forEach(item => { if (item.until < next) next = item.until; });
    });
    if (next !== Infinity) saysTimer = setTimeout(renderSays, Math.max(80, next - at));
  }
  function bidText(c) {
    if (c === 'PASS') return tr('bl_pass', 'Pass');
    if (c === 'CONTRA') return tr('bl_contra', 'Contra');
    if (c === 'RECONTRA') return tr('bl_recontra', 'Recontra');
    return `${suit[c]} ${label(c)}`.trim();
  }
  // Each call is worked out from how the turn and the contract moved, so it also works in older rooms.
  function lastCall(prev, newDeal) {
    if (!prev || prev.phase !== 'bidding' || (!newDeal && state.turn === prev.turn && state.phase === 'bidding')) return null;
    if (!newDeal && state.bid !== prev.bid) return {seat: state.bidder, call: state.bid};
    if (!newDeal && state.double !== prev.double) return {seat: prev.turn, call: state.double === 1 ? 'CONTRA' : 'RECONTRA'};
    return {seat: prev.turn, call: 'PASS'};
  }
  let seenBidEvents = 0;
  function syncSays(prev, newDeal) {
    if (!prev) { seenBidEvents = Array.isArray(state?.bid_events) ? state.bid_events.length : 0; return; }
    // The server lists every call of the deal in order; a table that missed a
    // state in between still shows each call at the seat that really made it.
    const calls = [];
    if (Array.isArray(state.bid_events)) {
      if (state.bid_events.length < seenBidEvents) seenBidEvents = 0;
      state.bid_events.slice(seenBidEvents).forEach(([seat, call]) => calls.push({seat, call}));
      seenBidEvents = state.bid_events.length;
    } else {
      const said = lastCall(prev, newDeal);
      if (said) calls.push(said);
    }
    calls.forEach(said => {
      addSay(said.seat, 'bid', bidText(said.call), 2800);
      sfx.play('bid', said.call);
      says[said.seat].find(i => i.kind === 'bid').tone = said.call === 'PASS' ? 'pass' : said.call.endsWith('CONTRA') ? 'contra' : '';
    });
    for (let seat = 0; seat < 4; seat++) {
      const ann = (state.announced || [])[seat];
      if (ann && !(prev.announced || [])[seat])
        addSay(seat, 'ann', ann.items ? ann.items.map(announcementLabel).join(', ') : tr('bl_announced_generic', 'Has an announcement'), 3600);
      if (ann && !(prev.announced || [])[seat]) {
        const total = ann.items ? ann.items.reduce((sum, a) => sum + (a.value || 0), 0) : 0;
        sfx.play(total ? 'ann' : 'bell', total);
      }
      const now = state.belote_pub, was = prev.belote_pub;
      if (now && was) {
        if (now.done[seat].length > was.done[seat].length) sfx.play(state.rules.variant === 'french' ? 'rebelote' : 'belote');
        else if (now.pending[seat].length > was.pending[seat].length) sfx.play('belote');
        if (now.done[seat].length > was.done[seat].length) addSay(seat, 'bel', tr(state.rules.variant === 'french' ? 'bl_rebelote_say' : 'bl_belote_say', 'Belote!'), 3000);
        else if (now.pending[seat].length > was.pending[seat].length) addSay(seat, 'bel', tr('bl_belote_say', 'Belote!'), 3000);
      }
    }
    renderSays();
  }

  function syncPlayers(prev, newDeal, targets) {
    const me = state.seat ?? 0;
    const firstLead = state.phase === 'bidding' || (state.counts.every(n => n === 8) && !state.trick.length && !state.last);
    for (let pos = 0; pos < 4; pos++) {
      const seat = (pos + me) % 4, el = playerEl(pos), p = state.seats[seat];
      el.classList.toggle('active', state.turn === seat && state.phase !== 'finished' && !state.result);
      el.classList.toggle('self', pos === 0 && state.seat !== null);
      el.querySelector('.bl-pname').textContent = p.name;
      el.querySelector('.bl-pmeta').textContent = pos === 0 && state.seat !== null ? tr('bl_you','You') : pos === 2 ? tr('bl_partner','Partner') : `${tr('bl_team','Team')} ${seat % 2 ? 'B' : 'A'}`;
      el.querySelector('.bl-chips').innerHTML =
        (state.dealer === seat ? `<span class="chip dealer">${esc(tr('bl_dealer','Dealer'))}</span>` : '') +
        ((state.dealer + 1) % 4 === seat && firstLead ? `<span class="chip lead">${esc(tr('bl_leads','Leads'))}</span>` : '');
      const fan = el.querySelector('.bl-fan');
      if (fan) {
        const n = state.counts[seat];
        if (newDeal) { fan.innerHTML = backHtml(n, pos !== 2); targets[seat] = [...fan.children]; }
        else {
          const have = fan.children.length;
          if (n < have) while (fan.children.length > n) fan.lastChild.remove();
          else if (n > have) {
            fan.insertAdjacentHTML('beforeend', backHtml(n - have, pos !== 2));
            targets[seat] = [...fan.children].slice(have);
          }
        }
      }
    }
  }
  function finishSweep() {
    sweepTimers.forEach(clearTimeout); sweepTimers = []; sweeping = false; sweepInfo = null;
    view?.querySelectorAll('.bl-slot').forEach(s => { s.replaceChildren(); });
    view?.querySelectorAll('.bl-player.won').forEach(e => e.classList.remove('won'));
  }
  function say(text, ms = 1400) {
    bannerText = text; clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { bannerText = ''; if (view && state) drawMessage(); }, ms);
  }
  let sweepInfo = null;
  const slotTilt = [-4, -9, 3, 8];
  // Hand the finished trick to its winner: the cards leave the table as clones so the slots are free at once.
  function launchSweep(quick) {
    sweepTimers.forEach(clearTimeout); sweepTimers = []; sweeping = false;
    if (!sweepInfo || !view) return;
    const {winPos, gained, cards} = sweepInfo;
    sweepInfo = null;
    const layer = view.querySelector('#bl-fly'), base = layer.getBoundingClientRect(), to = avatarRect(winPos), host = playerEl(winPos);
    sfx.play('sweep');
    if (host) {
      host.classList.add('won'); setTimeout(() => host.classList.remove('won'), 1500);
      const gain = document.createElement('span'); gain.className = 'bl-gain'; gain.textContent = '+' + gained;
      host.appendChild(gain); setTimeout(() => gain.remove(), 1800);
    }
    cards.forEach(([seat], order) => {
      const pos = relPos(seat), slot = view.querySelector(`.bl-slot.p${pos}`), el = slot.firstChild;
      if (!el) return;
      if (!to || !el.animate || reduced()) { slot.replaceChildren(); return; }
      const c = center(el), w = el.offsetWidth, h = el.offsetHeight;
      const clone = el.cloneNode(true);
      clone.classList.remove('winning'); clone.classList.add('bl-clone');
      clone.style.cssText = `--w:${w}px;left:${c.x - base.left - w / 2}px;top:${c.y - base.top - h / 2}px;`;
      layer.appendChild(clone);
      slot.replaceChildren();
      clone.animate([{transform:`rotate(${slotTilt[pos]}deg)`,opacity:1},
        {transform:`translate(${to.x - c.x}px,${to.y - c.y}px) scale(.3) rotate(${order % 2 ? 25 : -25}deg)`,opacity:.2}],
        {duration:quick ? 320 : 600, delay:order * (quick ? 40 : 130), easing:'cubic-bezier(.5,0,.8,.4)', fill:'forwards'}).onfinish = () => clone.remove();
    });
  }
  function syncTrick(animate) {
    let cards = state.last?.length ? state.last : state.trick;
    const key = state.last?.length ? JSON.stringify(state.last) : null;
    if (key && key === sweepKey && !sweeping) return;            // this trick was already collected
    if (sweeping && !(key && key === sweepKey)) { if (cards.length) launchSweep(true); else return; }
    const slots = [0,1,2,3].map(i => view.querySelector(`.bl-slot.p${i}`));
    const present = new Set();
    cards.forEach(([seat, c], order) => {
      const pos = relPos(seat), slot = slots[pos];
      present.add(pos);
      slot.style.zIndex = order + 1;
      if (slot.firstChild?.dataset.card === c) return;
      const el = cardEl(c);
      slot.replaceChildren(el);
      if (animate) {
        const mine = pos === 0 && state.seat !== null && clickRect && Date.now() - clickRect.at < 4000;
        flyFrom(el, mine ? clickRect : avatarRect(pos), {dur:520, rot:pos % 2 ? 40 : -12});
        setTimeout(() => sfx.play('play'), 400);
      }
    });
    slots.forEach((s, i) => { if (!present.has(i)) s.replaceChildren(); });
    if (key && key !== sweepKey) {
      sweepKey = key; sweeping = true;
      const winSeat = state.last_winner ?? trickWinner(state.last, state.bid);
      sweepInfo = {winPos:relPos(winSeat), gained:trickPoints(state.last, state.bid), cards};
      say(`${state.seats[winSeat].name} ${tr('bl_takes_trick','takes the trick')} · +${sweepInfo.gained}`, 2200);
      slots[sweepInfo.winPos].firstChild?.classList.add('winning');
      sweepTimers.push(setTimeout(() => launchSweep(false), 1100));
    } else if (!key && !cards.length) sweepKey = null;
  }
  let pickedCard = null;
  function markPicked() {
    view?.querySelectorAll('#bl-hand .bl-card').forEach(el => el.classList.toggle('picked', el.dataset.card === pickedCard));
  }
  function syncHand(fresh) {
    const box = view.querySelector('#bl-hand');
    const playing = state.phase === 'playing' && state.turn === state.seat && !state.result && !dealing();
    const existing = new Map([...box.children].map(e => [e.dataset.card, e]));
    state.hand.forEach((c, i) => {
      let el = existing.get(c);
      if (el) existing.delete(c); else { el = cardEl(c, 'button'); fresh.push(el); }
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
      const ok = playing && state.legal.includes(c);
      // Only highlight when the rules actually narrow the choice; with a free choice nothing is suggested.
      const narrowed = playing && state.legal.length < state.hand.length;
      el.classList.toggle('playable', ok);
      el.classList.toggle('hint', ok && narrowed);
      el.classList.toggle('dim', narrowed && !ok);
      el.disabled = !ok;
      el.classList.remove('sending');
    });
    existing.forEach(e => e.remove());
    if (pickedCard && !(state.phase === 'playing' && state.turn === state.seat && state.hand.includes(pickedCard))) pickedCard = null;
    markPicked();
  }
  // Cards leave the dealer in packets (3 then 2 for the first five, then the rest) and land one by one.
  function runDeal(targets, rounds) {
    const dealerPos = (state.dealer - (state.seat ?? 0) + 4) % 4;
    const from = avatarRect(dealerPos), layer = view.querySelector('#bl-fly'), base = layer.getBoundingClientRect();
    const order = [1,2,3,4].map(k => (state.dealer + k) % 4), taken = [0,0,0,0];
    let t = 350, end = 0;
    for (const round of rounds) for (const seat of order) {
      const list = targets[seat] || [];
      const n = round === null ? list.length : round;
      for (let k = 0; k < n; k++) {
        const el = list[taken[seat]++];
        if (!el || !from) continue;
        const at = t + k * STEP, arrive = at + FLIGHT;
        el.animate([{opacity:0},{opacity:0,offset:arrive / (arrive + 160)},{opacity:1}], {duration:arrive + 160, fill:'backwards'});
        const ghost = document.createElement('div');
        ghost.className = 'bl-card bl-back bl-ghost';
        ghost.style.cssText = `left:${from.x - base.left - 17}px;top:${from.y - base.top - 25}px;`;
        layer.appendChild(ghost);
        const to = center(el);
        ghost.animate([{transform:'translate(0,0) rotate(-12deg)',opacity:0},{opacity:1,offset:.12},
          {transform:`translate(${to.x - from.x}px,${to.y - from.y}px) rotate(${(taken[seat] % 2 ? 8 : -8)}deg) scale(${Math.max(.6, to.w / 34)})`,opacity:1}],
          {duration:FLIGHT, delay:at, easing:'cubic-bezier(.25,.7,.3,1)', fill:'both'}).onfinish = () => ghost.remove();
        end = Math.max(end, arrive);
        setTimeout(() => sfx.play('deal'), arrive - 40);
      }
      t += n ? PACKET + n * STEP : 0;
    }
    dealUntil = Date.now() + end + 120;
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => { dealUntil = 0; if (view && state) { drawActions(); syncHand([]); drawMessage(); } }, end + 140);
    return end;
  }
  const historyRows = () => Array.isArray(state.history) ? state.history : localHistory;
  // Every finished deal: what it was worth to each team, shown for a moment in the middle of the table.
  function showDealResult() {
    const box = view?.querySelector('#bl-deal');
    if (!box || !state?.result) return;
    const mine = (state.seat ?? 0) % 2, r = state.result;
    const n = historyRows().length || state.deals;
    const cell = team => `<div class="bl-deal-team ${team === 0 ? 'teama' : 'teamb'} ${r.awarded[team] > r.awarded[1 - team] ? 'won' : ''}"><span>${esc(team === mine ? tr('bl_us', 'Us') : tr('bl_them', 'Them'))}</span><b>+${r.awarded[team]}</b>${r.raw[team] !== r.awarded[team] ? `<small>${r.raw[team]}</small>` : ''}</div>`;
    box.innerHTML = `<div class="bl-deal-card"><h3>${esc(tr('bl_deal_no', 'Deal'))} ${n}${state.bid ? ` · ${contractMark(state.bid)} ${esc(state.seats[state.bidder].name)}` : ''}</h3>
      <div class="bl-deal-scores">${cell(mine)}${cell(1 - mine)}</div>
      <p>${esc(tr('bl_us', 'Us'))} ${state.scores[mine]} : ${state.scores[1 - mine]} ${esc(tr('bl_them', 'Them'))}${state.hanging ? ' · ⏳ ' + state.hanging : ''}</p></div>`;
    box.hidden = false;
    // The result stays 3.5 s, then goes away; the next deal waits for it in the queue.
    clearTimeout(dealResultTimer);
    dealResultTimer = setTimeout(() => { box.hidden = true; }, 3500);
  }
  function annRow(item) {
    const lines = (item.reveal || []).map((items, seat) => {
      const parts = (items || []).map(a => `${announcementLabel(a)} (${a.cards.map(c => rank(c) + suit[c[1]]).join(' ')})`);
      if (item.belotes?.[seat]) parts.push(tr('bl_belote_say', 'Belote!').replace(/[!！]/g, ''));
      return parts.length ? `<div><b>${esc(state.seats[seat]?.name || '')}:</b> ${esc(parts.join(', '))}</div>` : '';
    }).join('');
    return lines ? `<tr class="bl-annrow"><td></td><td colspan="3">${lines}</td></tr>` : '';
  }
  function renderHistory() {
    const box = view?.querySelector('#bl-history');
    if (!box || box.hidden || !state) return;
    const mine = (state.seat ?? 0) % 2, rows = historyRows();
    const cell = (item, team) => {
      const a = item.awarded[team], r = item.raw[team];
      return `<td><b>${a}</b>${r !== a ? `<small>${r}</small>` : ''}</td>`;
    };
    box.innerHTML = `<div class="bl-panel"><div class="bl-panel-head"><h3>${esc(tr('bl_history','Game score by deal'))}</h3><button type="button" class="bl-ov-close" aria-label="${esc(tr('bl_close','Close'))}">×</button></div>
      <div class="bl-panel-body">${rows.length ? `<table class="bl-history"><thead><tr><th>${esc(tr('bl_deal_no','Deal'))}</th><th>${esc(tr('bl_contract','Contract'))}</th><th class="teama${mine ? '' : ''}">${esc(tr('bl_us','Us'))}</th><th>${esc(tr('bl_them','Them'))}</th></tr></thead><tbody>${rows.map((item, i) => `<tr class="bl-hrow"><td>${i + 1}</td><td>${item.bid ? `${contractMark(item.bid)} ${esc(state.seats[item.bidder]?.name || '')}${item.double ? ' ×' + (item.double === 1 ? 2 : 4) : ''}` : '—'}</td>${cell(item, mine)}${cell(item, 1 - mine)}</tr>${annRow(item)}`).join('')}</tbody>
        <tfoot><tr><td colspan="2">${esc(tr('bl_total','Total'))}</td><td><b>${state.scores[mine]}</b></td><td><b>${state.scores[1 - mine]}</b></td></tr></tfoot></table>` : `<p class="bl-empty">${esc(tr('bl_no_deals','No deal has finished yet.'))}</p>`}</div></div>`;
  }
  function showEnd() {
    const box = view?.querySelector('#bl-end');
    if (!box || !state) return;
    view.querySelector('#bl-deal').hidden = true;
    const mine = (state.seat ?? 0) % 2, s = state.scores;
    const winner = s[0] === s[1] ? null : s[0] > s[1] ? 0 : 1;
    const names = team => state.seats.filter((_, i) => i % 2 === team).map(p => p.name).join(' · ');
    const title = winner === null ? tr('bl_draw', 'Draw') : winner === mine ? tr('bl_win', 'You win!') : tr('bl_lose', 'You lose');
    box.innerHTML = `<div class="bl-end-card ${winner === null ? '' : winner === mine ? 'good' : 'bad'}"><div class="bl-end-trophy">${winner === null ? '🤝' : winner === mine ? '🏆' : '🎴'}</div><h2>${esc(title)}</h2>
      ${winner === null ? '' : `<p>${esc(tr('bl_winner', 'Winning team'))}<br><b>${esc(names(winner))}</b></p>`}
      <div class="bl-end-score"><span class="${mine ? 'teamb' : 'teama'}">${esc(tr('bl_us', 'Us'))} <b>${s[mine]}</b></span><i>:</i><span class="${mine ? 'teama' : 'teamb'}"><b>${s[1 - mine]}</b> ${esc(tr('bl_them', 'Them'))}</span></div><section data-gh-results></section><a href="/pub/gamehub/?game=belot">${esc(tr('bl_back','Back to Game Hub'))}</a></div>`;
    box.hidden = false;
    sfx.play(winner === null ? 'bell' : winner === mine ? 'win' : 'lose');
    clearTimeout(showEnd.timer);

  }
  function drawMessage() {
    const me = state.seat, yourTurn = state.turn === me && !dealing();
    const msg = bannerText || (state.result ? `${tr('bl_deal_result','Deal')}: ${state.result.awarded.join(' : ')}`
      : state.phase === 'bidding' ? (yourTurn ? tr(state.rules.variant === 'french' ? 'bl_choose_french' : 'bl_choose_bid', state.rules.variant === 'french' ? 'Take a trump suit or pass' : 'Choose a contract or pass') : `${tr('bl_wait_bid','Waiting for bid…')} ${state.seats[state.turn].name}`)
      : yourTurn ? tr('bl_your_turn','Your turn') : `${tr('bl_waiting','Waiting for')} ${state.seats[state.turn].name}`);
    const el = view.querySelector('#bl-message');
    el.textContent = msg;
    el.classList.toggle('mine', yourTurn && !state.result && !bannerText);
  }
  function drawActions() {
    const yourTurn = state.turn === state.seat && !dealing();
    const bidding = state.phase === 'bidding' && yourTurn;
    let panel = '';
    if (bidding) {
      const current = state.bid
        ? `<span class="${'DH'.includes(state.bid) ? 'redsuit' : ''}">${suit[state.bid] ? suit[state.bid] + ' ' : ''}${esc(label(state.bid))}</span>: ${esc(state.seats[state.bidder].name)}${state.double ? ' · ' + esc(state.double === 1 ? tr('bl_contra', 'Contra') : tr('bl_recontra', 'Recontra')) : ''}`
        : esc(tr('bl_no_bid_yet', 'No bid yet'));
      panel = `<div class="bl-bidpanel"><div class="bl-bidnow">${current}</div>` +
        `<button data-bid="PASS">${esc(tr('bl_pass','Pass'))}</button>` +
        state.contracts.map(c => `<button data-bid="${c}">${state.rules.variant === 'french' ? esc(tr(state.french_round === 1 ? 'bl_take' : 'bl_choose_trump',state.french_round === 1 ? 'Take' : 'Choose')) + ' ' : ''}<span class="${'DH'.includes(c) ? 'redsuit' : ''}">${suit[c] ? `<span class="suitsign">${suit[c]}</span> ` : ''}${esc(label(c))}</span></button>`).join('') +
        (state.can_contra?`<button data-bid="CONTRA">${esc(tr('bl_contra','Contra'))}</button>`:'') +
        (state.can_recontra?`<button data-bid="RECONTRA">${esc(tr('bl_recontra','Recontra'))}</button>`:'') + '</div>';
    }
    view.querySelector('#bl-actions').innerHTML = panel;
    view.querySelectorAll('[data-bid]').forEach(btn => btn.onclick=() => {
      if (pending) return;
      pending = true;
      // The chosen call lights up and the others step back until the table answers.
      btn.classList.add('sent');
      btn.closest('.bl-bidpanel')?.classList.add('waiting');
      mp.send({type:'bl_bid',contract:btn.dataset.bid});
      // If the table has not answered, the buttons work again.
      setTimeout(() => {
        if (pending && state && state.turn === state.seat) {
          report('bid-unanswered'); pending = false; mp.send({type: 'bl_sync'});
          btn.classList.remove('sent'); btn.closest('.bl-bidpanel')?.classList.remove('waiting');
        }
      }, 3000);
    });
    const declarations = view.querySelector('#bl-declarations');
    const options = state.announcement_options || [];
    declPicked = new Set(Array.from(declPicked).filter(id => options.some(a => a.id === id)));
    declarations.hidden = !options.length || !yourTurn;
    declarations.innerHTML = options.length && yourTurn ? `<div class="bl-decl-title">${esc(tr('bl_announce_before_play','Announce before your first card'))}</div>` +
      options.map(a => `<button type="button" class="bl-decl${declPicked.has(a.id) ? ' on' : ''}" data-id="${esc(a.id)}"><span>${esc(tr(a.kind==='quad'?'bl_four_kind':'bl_sequence',a.kind))} ${esc(a.cards.map(c => rank(c)+suit[c[1]]).join(' '))}</span><b>${a.value}</b></button>`).join('') : '';
    declarations.querySelectorAll('.bl-decl').forEach(button => button.onclick = () => {
      const id = button.dataset.id;
      if (declPicked.has(id)) declPicked.delete(id);
      else {
        const picked = options.find(a => a.id === id);
        declPicked = new Set(Array.from(declPicked).filter(other => !options.find(a => a.id === other).cards.some(c => picked.cards.includes(c))));
        declPicked.add(id);
      }
      drawActions();
    });
  }
  function draw(prev) {
    if (!view || !state) return;
    const animate = !!prev && !reduced();
    const me = state.seat ?? 0;
    const newDeal = animate && state.phase === 'bidding' && (prev.phase !== 'bidding' || prev.dealer !== state.dealer || prev.hand.join() !== state.hand.join());
    const extraDeal = animate && !newDeal && prev.phase === 'bidding' && state.phase === 'playing' && state.counts.some((n, i) => n > prev.counts[i]);
    buildPlayers();
    const mine = me % 2;
    view.querySelector('#bl-score').innerHTML = `<span class="sc team${mine ? 'b' : 'a'}">${esc(tr('bl_us','Us'))} <b>${state.scores[mine]}</b></span><span class="sc team${mine ? 'a' : 'b'}">${esc(tr('bl_them','Them'))} <b>${state.scores[1 - mine]}</b></span>${state.hanging ? `<span class="sc">⏳ ${state.hanging}</span>` : ''}`;
    const trump = view.querySelector('#bl-contract');
    trump.hidden = !state.bid;
    if (state.bid) trump.innerHTML = `${suit[state.bid] ? `<span class="bl-suit ${'DH'.includes(state.bid) ? 'red' : ''}">${suit[state.bid]}</span>` : ''}<small>${esc(label(state.bid))}<br>${esc(state.seats[state.bidder].name)}${state.double ? ' · ' + esc(state.double === 1 ? tr('bl_contra','Contra') : tr('bl_recontra','Recontra')) : ''}</small>`;
    const upcard = view.querySelector('#bl-upcard');
    upcard.hidden = !(state.rules.variant === 'french' && state.phase === 'bidding');
    if (!upcard.hidden) upcard.innerHTML = `<small>${esc(tr('bl_turned_card','Turned card'))}<br>${esc(tr('bl_bidding_round','Round'))} ${state.french_round}</small>${cardHtml(state.upcard)}`;
    const targets = [[], [], [], []];
    syncPlayers(prev, newDeal, targets);
    syncSays(prev, newDeal);
    if (prev && state.ai_say && state.ai_say.n !== lastAiSay) {
      addSay(state.ai_say.seat, 'ai', state.ai_say.text, 6500);
      renderSays();
    }
    lastAiSay = state.ai_say ? state.ai_say.n : 0;
    if (newDeal) { finishSweep(); clearTimeout(dealResultTimer); view.querySelector('#bl-deal').hidden = true; }
    if (state.result) {
      const key = state.deals + ':' + state.scores.join();
      if (key !== lastResultKey) {
        lastResultKey = key;
        if (!Array.isArray(state.history)) localHistory.push({bid:state.bid, bidder:state.bidder, double:state.double, raw:state.result.raw, awarded:state.result.awarded, reveal:state.last_reveal, belotes:null});
        if (animate) setTimeout(showDealResult, 1300);
      }
    }
    syncTrick(animate);
    const fresh = [];
    syncHand(fresh);
    targets[me] = fresh;
    if (newDeal || extraDeal) {
      const ms = runDeal(targets, newDeal ? [3, 2] : [null]);
      if (newDeal) say(`${state.seats[state.dealer].name} ${tr('bl_dealing','is dealing the cards')}`, ms + 200);
    }
    drawMessage();
    drawActions();
    if (dealing()) syncHand([]);
    renderHistory();
    if (animate && state.seat !== null && state.turn === state.seat && !state.result && (prev.turn !== state.seat || prev.phase !== state.phase))
      setTimeout(() => sfx.play('turn'), dealing() ? dealUntil - Date.now() + 150 : sweeping ? 700 : 120);
  }
  // The server never waits for the table: after a person's move the bots play
  // at once and every step arrives as its own state. They are shown here one
  // at a time, in order, with the pause each one needs to be seen: a card or a
  // call, a trick going to its winner, a deal arriving, a deal's result.
  let queue = [], shownAt = 0, pace = 0, pumpTimer = 0;
  function pauseAfter(prev, s) {
    if (!prev) return 0;
    if (s.result) return 4800;
    if (dealing()) return dealUntil - Date.now() + 400;
    if (s.last?.length) return 1900;
    return 900;
  }
  function pump() {
    clearTimeout(pumpTimer);
    while (queue.length) {
      const wait = shownAt + pace - Date.now();
      if (wait > 0) { pumpTimer = setTimeout(pump, wait); return; }
      const item = queue.shift();
      const prev = state;
      // One state that cannot be drawn must not stop the ones after it.
      try { item.type === 'game_over' ? gameOver() : handleState(item); } catch (e) { console.error(e); }
      shownAt = Date.now();
      pace = item.type === 'game_over' ? 0 : pauseAfter(prev, item);
    }
  }
  mp.on('bl_state', s => { lastStateAt = Date.now(); queue.push(s); pump(); });
  function handleState(s) {
    if (pendingStartedVariant?.room === mp.roomId()) {
      rememberVariant(pendingStartedVariant.variant);
      pendingStartedVariant = null;
    }
    const prev = state;
    pending = false; state = s; draw(prev);
  }
  // What this table shows, for the server log when something takes too long.
  function report(reason) {
    if (!state) return;
    mp.send({type: 'bl_diag', reason, info: {phase: state.phase, turn: state.turn, seat: state.seat, hand: state.hand.length,
      trick: (state.trick || []).length, queue: queue.length, pending, dealing: dealing(), legal: (state.legal || []).length, quietMs: Date.now() - lastStateAt,
      hidden: document.hidden, online: navigator.onLine}});
  }
  // If the table has gone quiet in the middle of a game, ask the server where it is.
  let lastStateAt = Date.now();
  setInterval(() => {
    if (!view?.isConnected || !state || queue.length || !['bidding', 'playing'].includes(state.phase)) return;
    if (Date.now() - lastStateAt > 20000) {
      if (state.turn !== state.seat) report('quiet');
      lastStateAt = Date.now() - 10000; mp.send({type: 'bl_sync'});
    }
  }, 5000);
  // Coming back to the window: catch up with the table at once.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && view?.isConnected && state && ['bidding', 'playing'].includes(state.phase)) mp.send({type: 'bl_sync'});
  });
  mp.on('game_over', msg => { queue.push({type: 'game_over', msg}); pump(); });
  function gameOver() {
    if (!view || !state) return;
    const team = (state.seat ?? 0) % 2;
    bannerText = '';
    const el = view.querySelector('#bl-message');
    el.classList.remove('mine');
    el.textContent = state.scores[team] > state.scores[1-team] ? tr('bl_win','You win!') : state.scores[team] === state.scores[1-team] ? tr('bl_draw','Draw') : tr('bl_lose','You lose');
    view.querySelector('#bl-actions').innerHTML = `<a href="/pub/gamehub/?game=belot">${esc(tr('bl_back','Back to Game Hub'))}</a>`;
    view.querySelector('#bl-hand').innerHTML = '';
    setTimeout(showEnd, 200);
  }
  mp.registerGame({id:'belot',name:'Belot',renderSetup:ruleForm,renderGame,exitButton:false,
    snapshot:()=>({seats: state?.seats?.map(p => p.id) || seatIds.slice(), variant:chosenVariant})});
})();
