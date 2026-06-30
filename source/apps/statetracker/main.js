const _st18n = {
  en: {
    title:'State Tracker', add:'+ Add', no_entities:'No entities yet. Click "+ Add" to start tracking.',
    edit:'Edit', del:'Delete', del_confirm:'Delete this entity and all its history?',
    test:'Test', testing:'Testing…', test_val:'Value', test_state:'State', test_err:'Error',
    name:'Name', source:'Source',
    src_push:'Manual / Push', src_ping:'Ping', src_http_check:'HTTP Check', src_http_fetch:'HTTP Fetch (JSON)',
    host:'Host / IP', url:'URL',
    auth:'Auth', auth_none:'None', auth_header:'API Key (header)', auth_bearer:'Bearer', auth_basic:'Basic',
    auth_key:'Header name', auth_val:'Key / Token', auth_user:'Username', auth_pass:'Password',
    path:'JSON path (e.g. bitcoin.usd)',
    path_hint:'Dot-separated path into JSON response. Arrays: items.0.value',
    interval:'Check interval (minutes)',
    states:'States', s_name:'Name', s_color:'Color', s_cond:'Condition',
    cond_hint_fetch:'Examples:  > 60000  |  <= 60000  |  == "running"  |  contains error  |  (empty = catch-all)',
    cond_hint_push:'No conditions needed — state is set explicitly when pushing.',
    cond_hint_ping:'State is matched by name: "online" or "offline".',
    add_state:'+ Add state', save:'Save', cancel:'Cancel',
    push_hint:'POST /api/statetracker/entities/{id}/push  →  {"state":"state_name"}',
    since:'since', unknown:'Unknown', no_data:'No data',
    period_day:'Day', period_week:'7d', period_month:'30d',
  },
  bg: {
    title:'State Tracker', add:'+ Добави', no_entities:'Няма entities. Натисни "+ Добави".',
    edit:'Редактирай', del:'Изтрий', del_confirm:'Изтриване на entity и цялата история?',
    test:'Тест', testing:'Тества…', test_val:'Стойност', test_state:'Стейт', test_err:'Грешка',
    name:'Име', source:'Тип',
    src_push:'Ръчно / Push', src_ping:'Ping', src_http_check:'HTTP Check', src_http_fetch:'HTTP Fetch (JSON)',
    host:'Хост / IP', url:'URL',
    auth:'Удостоверяване', auth_none:'Без', auth_header:'API ключ (header)', auth_bearer:'Bearer', auth_basic:'Basic',
    auth_key:'Header', auth_val:'Ключ / токен', auth_user:'Потребител', auth_pass:'Парола',
    path:'JSON path (напр. bitcoin.usd)',
    path_hint:'Точки за вложен JSON. Масиви: items.0.value',
    interval:'Интервал на проверка (минути)',
    states:'Стейтове', s_name:'Име', s_color:'Цвят', s_cond:'Условие',
    cond_hint_fetch:'Примери:  > 60000  |  <= 60000  |  == "running"  |  contains error  |  (празно = по подразбиране)',
    cond_hint_push:'Без условия — стейтът се задава при push.',
    cond_hint_ping:'Стейтът се мачва по име: "online" или "offline".',
    add_state:'+ Добави стейт', save:'Запази', cancel:'Отказ',
    push_hint:'POST /api/statetracker/entities/{id}/push  →  {"state":"state_name"}',
    since:'от', unknown:'Неизвестно', no_data:'Няма данни',
    period_day:'Ден', period_week:'7 дни', period_month:'30 дни',
  },
};
function _stt(k) { const l = window.mvmOS?.lang||'en'; return (_st18n[l]||_st18n.en)[k]||k; }

const _ST_COLORS = ['#a6e3a1','#f38ba8','#89b4fa','#f9e2af','#fab387','#cba6f7','#94e2d5','#f5c2e7'];

mvmOS.registerApp({
  id: 'statetracker',
  name: _stt('title'),
  icon: '📡',
  category: 'Utilities',

  launch() {
    mvmOS.createWindow({
      id: 'statetracker',
      title: '📡 ' + _stt('title'),
      width: 860,
      height: 560,
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:var(--font,sans-serif);background:var(--bg);color:var(--fg)';

        // ── state ──────────────────────────────────────────────
        let period = 'day', offset = 0, entities = [];

        // ── helpers ────────────────────────────────────────────
        const q  = s => body.querySelector(s);
        const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        const btn = (bg) => `padding:4px 10px;border-radius:6px;border:none;cursor:pointer;font-size:13px;background:${bg||'var(--surface2)'};color:${bg?'#fff':'var(--fg)'}`;
        const inp = () => 'padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--fg);font-size:13px;width:100%;box-sizing:border-box';
        const fld = (label, inner) => `<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--fg2)">${label}${inner}</label>`;
        const uid = () => Math.random().toString(36).slice(2,8);

        function timeRange() {
          const now = new Date();
          const days = period==='day'?1:period==='week'?7:30;
          const end = new Date(now.getTime() + offset*days*86400000);
          if (period==='day') { end.setHours(23,59,59,999); const s=new Date(end); s.setHours(0,0,0,0); return {start:s,end}; }
          end.setHours(23,59,59,999);
          const start = new Date(end.getTime()-(days-1)*86400000); start.setHours(0,0,0,0);
          return {start,end};
        }

        function fmt(d) {
          if(!(d instanceof Date)) d=new Date(d);
          return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
        }

        function sinceStr(evData) {
          const all=[...(evData.events||[])];
          if(evData.prev) all.unshift(evData.prev);
          if(!all.length) return '';
          const diff = Date.now()-new Date(all[all.length-1].recorded_at);
          if(diff<60000) return '<1min';
          if(diff<3600000) return Math.floor(diff/60000)+'min';
          if(diff<86400000) return Math.floor(diff/3600000)+'h';
          return Math.floor(diff/86400000)+'d';
        }

        function buildSegments(evData, start, end) {
          const events=(evData.events||[]).map(e=>({...e,ts:new Date(e.recorded_at)}));
          const segs=[];
          let cur=evData.prev?{name:evData.prev.state_name,color:evData.prev.state_color}:null;
          let cs=start;
          for(const ev of events) {
            if(cur) segs.push({start:cs,end:ev.ts<start?start:ev.ts,name:cur.name,color:cur.color});
            cur={name:ev.state_name,color:ev.state_color};
            cs=ev.ts<start?start:ev.ts;
          }
          if(cur) segs.push({start:cs,end,name:cur.name,color:cur.color});
          return segs;
        }

        // ── shell ──────────────────────────────────────────────
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
            <span style="font-weight:600">📡 ${_stt('title')}</span>
            <div style="flex:1"></div>
            <div id="st-periods" style="display:flex;gap:4px"></div>
            <button id="st-prev" style="${btn()}" title="←">‹</button>
            <button id="st-next" style="${btn()}" title="→">›</button>
            <button id="st-add" style="${btn('var(--accent)')}">＋ ${_stt('add')}</button>
          </div>
          <div id="st-body" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px"></div>
        `;

        ['day','week','month'].forEach(p => {
          const b = document.createElement('button');
          b.id = `st-p-${p}`; b.textContent = _stt(`period_${p}`); b.style.cssText = btn();
          b.onclick = () => { period=p; offset=0; reload(); };
          q('#st-periods').appendChild(b);
        });
        q('#st-prev').onclick = () => { offset--; reload(); };
        q('#st-next').onclick = () => { if(offset<0){offset++;reload();} };
        q('#st-add').onclick  = () => showModal(null);

        // ── reload ─────────────────────────────────────────────
        async function reload() {
          ['day','week','month'].forEach(p => {
            const b=q(`#st-p-${p}`); if(!b) return;
            b.style.background = period===p?'var(--accent)':'var(--surface2)';
            b.style.color = period===p?'#fff':'var(--fg)';
          });
          const nb = q('#st-next'); if(nb) nb.disabled = offset>=0;

          const res = await fetch('/api/statetracker/entities');
          if(!res.ok) return;
          entities = await res.json();
          renderBody();
        }

        async function renderBody() {
          const content = q('#st-body'); if(!content) return;
          if(!entities.length) {
            content.innerHTML = `<div style="color:var(--fg2);text-align:center;margin-top:40px">${_stt('no_entities')}</div>`;
            return;
          }
          const {start,end} = timeRange();
          content.innerHTML = '';
          for(const entity of entities) {
            const evRes = await fetch(`/api/statetracker/entities/${entity.id}/events?frm=${start.toISOString()}&to=${end.toISOString()}`);
            const evData = evRes.ok ? await evRes.json() : {events:[],prev:null};
            content.appendChild(renderRow(entity, evData, start, end));
          }
          content.appendChild(renderAxis(start, end));
        }

        function renderRow(entity, evData, start, end) {
          const all=[...(evData.events||[])]; if(evData.prev) all.unshift(evData.prev);
          const cur = all.length ? all[all.length-1] : null;
          const segs = buildSegments(evData, start, end);
          const totalMs = end-start;

          const wrap = document.createElement('div');
          wrap.style.cssText = 'background:var(--surface1);border-radius:8px;padding:10px 12px';

          const hdr = document.createElement('div');
          hdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
          hdr.innerHTML = `
            <span style="width:10px;height:10px;border-radius:50%;background:${cur?cur.state_color:'#585b70'};display:inline-block;flex-shrink:0"></span>
            <span style="font-weight:600;font-size:14px">${esc(entity.name)}</span>
            <span style="font-size:12px;color:var(--fg2)">${cur ? esc(cur.state_name)+' · '+_stt('since')+' '+sinceStr(evData) : _stt('unknown')}</span>
            <div style="flex:1"></div>
            <button class="st-edit-btn" style="${btn()}" data-id="${entity.id}">${_stt('edit')}</button>
          `;
          hdr.querySelector('.st-edit-btn').onclick = () => showModal(entity);
          wrap.appendChild(hdr);

          const bar = document.createElement('div');
          bar.style.cssText = 'position:relative;height:26px;background:var(--surface2);border-radius:4px;overflow:hidden';
          if(!segs.length) {
            bar.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--fg2)">${_stt('no_data')}</div>`;
          } else {
            for(const seg of segs) {
              const pct = ((seg.start-start)/totalMs)*100;
              const w   = ((seg.end-seg.start)/totalMs)*100;
              const el  = document.createElement('div');
              el.style.cssText = `position:absolute;top:0;height:100%;left:${pct.toFixed(3)}%;width:${w.toFixed(3)}%;background:${seg.color}`;
              el.title = `${seg.name}\n${fmt(seg.start)} → ${fmt(seg.end)}`;
              bar.appendChild(el);
            }
          }
          wrap.appendChild(bar);
          return wrap;
        }

        function renderAxis(start, end) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative;height:18px';
          const totalMs = end-start, days = totalMs/86400000;
          const step = days<=1?3600000*4:days<=7?86400000:86400000*5;
          for(let t=new Date(Math.ceil(start/step)*step); t<=end; t=new Date(t.getTime()+step)) {
            const pct = ((t-start)/totalMs)*100;
            const lbl = document.createElement('span');
            lbl.style.cssText = `position:absolute;left:${pct.toFixed(2)}%;transform:translateX(-50%);font-size:10px;color:var(--fg2);white-space:nowrap`;
            lbl.textContent = days<=1 ? t.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false}) : t.toLocaleDateString(undefined,{month:'short',day:'numeric'});
            wrap.appendChild(lbl);
          }
          return wrap;
        }

        // ── modal ──────────────────────────────────────────────
        function showModal(entity) {
          const isNew = !entity;
          const defaultStates = src => src==='http_fetch'||src==='push'
            ? [{id:uid(),name:'Active',color:'#a6e3a1',condition:''},{id:uid(),name:'Inactive',color:'#f38ba8',condition:''}]
            : [{id:uid(),name:'Online',color:'#a6e3a1',condition:''},{id:uid(),name:'Offline',color:'#f38ba8',condition:''}];
          const states = entity ? JSON.parse(JSON.stringify(entity.states)) : defaultStates(entity?.source_type||'ping');
          const cfg = entity?.source_cfg || {};

          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999';

          const box = document.createElement('div');
          box.style.cssText = 'background:var(--surface1);border-radius:10px;padding:20px;width:500px;max-width:95vw;max-height:85vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px';

          const cfgArea   = document.createElement('div');
          const statesWrap= document.createElement('div');
          const testArea  = document.createElement('div');

          function renderCfg(src) {
            const v = k => esc(cfg[k]||'');
            const intervalField = `<div style="margin-top:4px">${fld(_stt('interval'),`<input id="sc-interval" type="number" min="1" max="1440" value="${esc(cfg.interval_minutes||1)}" style="${inp()};width:120px">`)}</div>`;
            if(src==='push') { cfgArea.innerHTML=`<div style="font-size:12px;color:var(--fg2);background:var(--surface2);padding:8px;border-radius:6px">${_stt('push_hint').replace('{id}',entity?.id||'(id after save)')}</div>`; return; }
            if(src==='ping') { cfgArea.innerHTML=fld(_stt('host'),`<input id="sc-host" value="${v('host')}" style="${inp()}">`)+intervalField; return; }
            const authSel = `<select id="sc-auth" style="${inp()}">
              <option value="none"   ${!cfg.auth_type||cfg.auth_type==='none'  ?'selected':''}>${_stt('auth_none')}</option>
              <option value="header" ${cfg.auth_type==='header'?'selected':''}>${_stt('auth_header')}</option>
              <option value="bearer" ${cfg.auth_type==='bearer'?'selected':''}>${_stt('auth_bearer')}</option>
              <option value="basic"  ${cfg.auth_type==='basic' ?'selected':''}>${_stt('auth_basic')}</option>
            </select>`;
            cfgArea.innerHTML = fld(_stt('url'),`<input id="sc-url" value="${v('url')}" placeholder="https://" style="${inp()}">`)
              + fld(_stt('auth'),authSel)
              + `<div id="sc-auth-extra"></div>`
              + (src==='http_fetch'?fld(_stt('path'),`<input id="sc-path" value="${v('extract_path')}" placeholder="bitcoin.usd" style="${inp()}">`)+'<div style="font-size:11px;color:var(--fg2)">'+ _stt('path_hint')+'</div>':'')
              + intervalField;
            cfgArea.querySelector('#sc-auth').onchange = e => renderAuthExtra(e.target.value);
            renderAuthExtra(cfg.auth_type||'none');
          }

          function renderAuthExtra(type) {
            const el = cfgArea.querySelector('#sc-auth-extra'); if(!el) return;
            const v = k => esc(cfg[k]||'');
            if(type==='none') { el.innerHTML=''; return; }
            if(type==='bearer') { el.innerHTML=fld(_stt('auth_val'),`<input id="sc-aval" value="${v('auth_value')}" type="password" style="${inp()}">`); return; }
            el.innerHTML = fld(type==='basic'?_stt('auth_user'):_stt('auth_key'),`<input id="sc-akey" value="${v('auth_key')}" style="${inp()}">`)
              + fld(type==='basic'?_stt('auth_pass'):_stt('auth_val'),`<input id="sc-aval" value="${v('auth_value')}" type="password" style="${inp()}">`);
          }

          function renderStates() {
            const src = box.querySelector('#st-src')?.value || 'ping';
            const showCond = src === 'http_fetch';
            const hintKey = src==='http_fetch' ? 'cond_hint_fetch' : src==='push' ? 'cond_hint_push' : 'cond_hint_ping';
            statesWrap.innerHTML = `<div style="font-weight:600;font-size:13px;margin-bottom:6px">${_stt('states')}</div>`;
            states.forEach((s,i) => {
              const row = document.createElement('div');
              row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
              row.innerHTML = `
                <input data-i="${i}" data-f="name"  value="${esc(s.name)}"      placeholder="${_stt('s_name')}" style="${inp()};flex:2">
                <input data-i="${i}" data-f="color" value="${esc(s.color)}"     type="color" style="width:32px;height:32px;border:none;border-radius:4px;padding:2px;cursor:pointer;background:none;flex-shrink:0">
                ${showCond ? `<input data-i="${i}" data-f="cond" value="${esc(s.condition)}" placeholder="${i===states.length-1?'(catch-all)':'> / == / contains…'}" style="${inp()};flex:2">` : ''}
                <button data-i="${i}" data-a="up"   style="${btn()};padding:2px 5px" ${i===0?'disabled':''}>↑</button>
                <button data-i="${i}" data-a="down" style="${btn()};padding:2px 5px" ${i===states.length-1?'disabled':''}>↓</button>
                <button data-i="${i}" data-a="del"  style="${btn('#f38ba8')};padding:2px 5px">✕</button>`;
              statesWrap.appendChild(row);
            });
            const hint = document.createElement('div');
            hint.style.cssText='font-size:11px;color:var(--fg2);margin-bottom:6px';
            hint.textContent = _stt(hintKey);
            statesWrap.appendChild(hint);
            const addBtn = document.createElement('button');
            addBtn.textContent = _stt('add_state'); addBtn.style.cssText=btn()+';width:100%';
            addBtn.onclick = () => { states.push({id:uid(),name:'',color:_ST_COLORS[states.length%_ST_COLORS.length],condition:''}); renderStates(); };
            statesWrap.appendChild(addBtn);
            statesWrap.querySelectorAll('input[data-i]').forEach(el => {
              el.oninput = el.onchange = () => {
                const i=+el.dataset.i, f=el.dataset.f;
                if(f==='name') states[i].name=el.value;
                if(f==='color') states[i].color=el.value;
                if(f==='cond') states[i].condition=el.value;
              };
            });
            statesWrap.querySelectorAll('button[data-a]').forEach(el => {
              el.onclick = () => {
                const i=+el.dataset.i, a=el.dataset.a;
                if(a==='del') { states.splice(i,1); renderStates(); }
                if(a==='up'   && i>0)              { [states[i-1],states[i]]=[states[i],states[i-1]]; renderStates(); }
                if(a==='down' && i<states.length-1){ [states[i],states[i+1]]=[states[i+1],states[i]]; renderStates(); }
              };
            });
          }

          // footer
          const footer = document.createElement('div');
          footer.style.cssText='display:flex;gap:8px;justify-content:flex-end;align-items:center';

          if(!isNew) {
            const delBtn = document.createElement('button');
            delBtn.textContent=_stt('del'); delBtn.style.cssText=btn('#f38ba8');
            delBtn.onclick = async () => {
              if(!confirm(_stt('del_confirm'))) return;
              await fetch(`/api/statetracker/entities/${entity.id}`,{method:'DELETE'});
              ov.remove(); reload();
            };
            const testBtn = document.createElement('button');
            testBtn.textContent=_stt('test'); testBtn.style.cssText=btn();
            testBtn.onclick = async () => {
              testBtn.textContent=_stt('testing'); testBtn.disabled=true;
              const r = await fetch(`/api/statetracker/entities/${entity.id}/test`,{method:'POST'});
              const d = await r.json();
              testArea.innerHTML = d.ok
                ? `<div style="font-size:12px;background:var(--surface2);padding:6px 10px;border-radius:6px">${_stt('test_val')}: <b>${esc(d.value)}</b> → ${_stt('test_state')}: <b style="color:${d.state?.color||'inherit'}">${esc(d.state?.name||'?')}</b></div>`
                : `<div style="font-size:12px;color:#f38ba8;background:var(--surface2);padding:6px 10px;border-radius:6px">${_stt('test_err')}: ${esc(d.error)}</div>`;
              testBtn.textContent=_stt('test'); testBtn.disabled=false;
            };
            footer.append(delBtn, testBtn);
          }

          const cancelBtn = document.createElement('button');
          cancelBtn.textContent=_stt('cancel'); cancelBtn.style.cssText=btn();
          cancelBtn.onclick = () => ov.remove();

          const saveBtn = document.createElement('button');
          saveBtn.textContent=_stt('save'); saveBtn.style.cssText=btn('var(--accent)');
          saveBtn.onclick = async () => {
            const name = box.querySelector('#st-name')?.value?.trim(); if(!name) return;
            const src  = box.querySelector('#st-src')?.value||'push';
            const newCfg = {};
            const intervalVal = parseInt(cfgArea.querySelector('#sc-interval')?.value)||1;
            if(intervalVal > 1) newCfg.interval_minutes = intervalVal;
            if(src==='ping') newCfg.host = cfgArea.querySelector('#sc-host')?.value?.trim()||'';
            if(src==='http_check'||src==='http_fetch') {
              newCfg.url        = cfgArea.querySelector('#sc-url')?.value?.trim()||'';
              newCfg.auth_type  = cfgArea.querySelector('#sc-auth')?.value||'none';
              newCfg.auth_key   = cfgArea.querySelector('#sc-akey')?.value?.trim()||'';
              newCfg.auth_value = cfgArea.querySelector('#sc-aval')?.value?.trim()||'';
              if(src==='http_fetch') newCfg.extract_path = cfgArea.querySelector('#sc-path')?.value?.trim()||'';
            }
            const payload = {name, source_type:src, source_cfg:newCfg, states};
            await fetch(isNew?'/api/statetracker/entities':`/api/statetracker/entities/${entity.id}`,
              {method:isNew?'POST':'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
            ov.remove(); reload();
          };
          footer.append(cancelBtn, saveBtn);

          const srcSel = `<select id="st-src" style="${inp()}">
            <option value="push"       ${entity?.source_type==='push'       ?'selected':''}>📥 ${_stt('src_push')}</option>
            <option value="ping"       ${entity?.source_type==='ping'       ?'selected':''}>📶 ${_stt('src_ping')}</option>
            <option value="http_check" ${entity?.source_type==='http_check' ?'selected':''}>🌐 ${_stt('src_http_check')}</option>
            <option value="http_fetch" ${entity?.source_type==='http_fetch' ?'selected':''}>🔗 ${_stt('src_http_fetch')}</option>
          </select>`;

          box.innerHTML = `<div style="font-weight:700;font-size:16px">${isNew?_stt('add'):_stt('edit')}</div>`;
          box.appendChild(_stEl(fld(_stt('name'),`<input id="st-name" value="${esc(entity?.name||'')}" style="${inp()}">`)));
          box.appendChild(_stEl(fld(_stt('source'),srcSel)));
          box.appendChild(cfgArea);
          box.appendChild(statesWrap);
          box.appendChild(testArea);
          box.appendChild(footer);
          ov.appendChild(box);
          ov.onclick = e => { if(e.target===ov) ov.remove(); };
          document.body.appendChild(ov);

          box.querySelector('#st-src').onchange = e => { renderCfg(e.target.value); renderStates(); };
          renderCfg(entity?.source_type||'ping');
          renderStates();
          setTimeout(()=>box.querySelector('#st-name')?.focus(),50);
        }

        reload();
        const timer = setInterval(()=>{ if(document.contains(body)) reload(); else clearInterval(timer); }, 60000);
      }
    });
  }
});

function _stEl(html) { const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }
