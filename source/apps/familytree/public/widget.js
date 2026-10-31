(function(){
  if(window.FamilyTree)return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.FamilyTree={mount(root){
    if(!document.getElementById('ft-style')){const l=document.createElement('link');l.id='ft-style';l.rel='stylesheet';l.href=window.asset('/apps/familytree/style.css');document.head.appendChild(l)}
    const app=document.createElement('div');app.className='ft'+(root.closest('.window')?' in-os':'');root.replaceChildren(app);
    const menuId='ft-trees-'+Math.random().toString(36).slice(2);
    let lang=window.mvmOS?.lang||window.mvmOS?.pubLang||document.documentElement.lang||'en';
    let trees=[],tree=null,modal=null,selected=null,positions=new Map(),size={w:1,h:1},view={x:0,y:0,z:1},disposed=false,loading=0;
    let viewMode='tree',statisticsAvailable=false;
    let generation=0,starting=true,detailTrail=[],detailOriginFocus=null,regions=[],treeMenu=null,treeMenuAnchor=null;
    let token=localStorage.getItem('apphub_token');
    const t=k=>(window.FAMILYTREE_I18N[lang]||window.FAMILYTREE_I18N.en)[k]||window.FAMILYTREE_I18N.en[k]||k;
    const admin=()=>tree&&['owner','admin'].includes(tree.role);
    const editable=()=>tree&&tree.role!=='viewer';
    const editablePerson=p=>editable()&&p.home_tree_id===tree.id;
    const linkedOptions=p=>[...new Set([p.home_tree_id,...(p.linked_tree_ids||[])])].filter(id=>id&&id!==tree.id);
    const treeTitle=id=>(tree?.view_trees||[]).concat(tree?.linked_trees||[]).find(x=>x.id===id)?.title||trees.find(x=>x.id===id)?.title||t('unavailableTree');
    const name=id=>{const p=tree?.profiles[id];return p?(p.display_name||p.username):t('unknownProfile')};
    const personName=id=>tree?.people.find(p=>p.id===id)?.name||tree?.reference_names?.[id]||t('removedPerson');
    const button=(key,attrs='',cls='')=>`<button ${attrs.includes('type="submit"')?'':'type="button"'} class="${cls}" title="${esc(t(key))}" ${attrs}>${esc(t(key))}</button>`;
    async function api(path,method='GET',data){
      const requestToken=token;
      const r=await fetch('/pub/familytree'+path,{method,headers:{'X-Pub-Token':token||'','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
      if(requestToken!==token)throw Error(t('unauthorized'));
      if(r.status===401){if(!window.mvmOS?.createWindow)location.replace('/pub/apphub/?return='+encodeURIComponent(location.href));throw Error(t('unauthorized'))}
      const d=await r.json();if(!r.ok)throw Error(t(typeof d.detail==='string'?d.detail:'invalid_input'));return d;
    }
    function toast(s){app.querySelector('.ft-toast')?.remove();const e=document.createElement('div');e.className='ft-toast';e.setAttribute('role','status');e.textContent=s;app.appendChild(e);setTimeout(()=>e.remove(),4500)}
    async function run(fn,el){const expected=generation;if(el?.disabled)return;if(el)el.disabled=true;try{await fn()}catch(e){if(expected!==generation)return;if(modal){const error=modal.querySelector('.ft-error');if(error)error.textContent=e.message;else toast(e.message)}else toast(e.message)}finally{if(el)el.disabled=false}}
    async function refreshList(){trees=await api('/trees')}
    async function openTree(id,fit=true,target=null){
      const preserved=id===tree?.id?selected:null;
      const seq=++loading;const next=await api('/trees/'+id);
      if(seq!==loading||disposed)return;
      next.people.forEach(p=>{if(p.redacted)p.name=t('unavailablePerson')});
      close();detailTrail=[];app.classList.remove('menu-open');tree=next;selected=next.people.some(p=>p.id===preserved)?preserved:null;render();if(fit)requestAnimationFrame(()=>{if(tree===next){if(target&&positions.has(target))focus(target);else initialView()}});
    }
    async function openLinkedPerson(person){
      const ids=linkedOptions(person);
      if(ids.length===1)await openTree(ids[0],true,person.id);else linkedTrees(person);
    }
    function linkedTrees(person=null){
      const ids=person?new Set(linkedOptions(person)):null;
      const options=(tree.linked_trees||[]).filter(other=>!ids||ids.has(other.id));
      const box=panel(t('linkedViews'),`<p class="ft-muted">${esc(t('linkedViewsHint'))}</p>${options.map(other=>`<div class="ft-view-row"><strong>${esc(other.title)}</strong><button type="button" data-open-tree="${other.id}">${esc(t('openTree'))}</button></div>`).join('')}`);
      box.querySelectorAll('[data-open-tree]').forEach(el=>el.onclick=()=>run(()=>openTree(el.dataset.openTree,true,person?.id),el));
    }
    function existingPerson(){
      const available=trees.filter(x=>x.id!==tree.id);
      const box=panel(t('useExisting'),`<p class="ft-muted">${esc(t('referenceHint'))}</p><label>${esc(t('sourceTree'))}<select data-reference-tree style="display:block;width:100%;margin:8px 0 14px"><option value="">${esc(t('chooseTree'))}</option>${available.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select></label><input type="search" data-reference-search aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}" style="width:100%"><div class="ft-reference-results"></div>`);
      let candidates=[],sequence=0;
      const draw=()=>{const q=box.querySelector('[data-reference-search]').value.toLocaleLowerCase();const rows=candidates.filter(p=>p.name.toLocaleLowerCase().includes(q)).slice(0,40);const container=box.querySelector('.ft-reference-results');container.innerHTML=rows.map(p=>`<button type="button" data-use-person="${p.id}" class="ft-relative ft-sex-${gender(p)}">${esc(p.name)}<small>${esc(lifespan(p))}</small></button>`).join('')||`<p class="ft-muted">${esc(t('noResults'))}</p>`;container.querySelectorAll('[data-use-person]').forEach(b=>b.onclick=()=>run(async()=>{const result=await api('/trees/'+tree.id+'/references','POST',{action:'link',person_id:b.dataset.usePerson});await reload();if(result.status==='applied'){focus(result.id);detail(result.id)}toast(t(result.status==='pending'?'submitted':'saved'))},b))};
      box.querySelector('[data-reference-tree]').onchange=e=>run(async()=>{const seq=++sequence;const id=e.target.value;if(!id){candidates=[];draw();return}const other=await api('/trees/'+id);if(seq!==sequence||!box.isConnected)return;candidates=other.people.filter(p=>!p.redacted&&p.home_tree_id===id&&!tree.people.some(x=>x.id===p.id&&x.in_current_tree));draw()},e.target);
      box.querySelector('[data-reference-search]').oninput=draw;
    }
    async function reload(){const id=tree?.id;await refreshList();if(id&&trees.some(x=>x.id===id))await openTree(id,false);else{tree=null;render()}}
    function layout(){
      positions=new Map();regions=[];const all=tree?.people||[];let offset=0,maxHeight=0;
      const groups=[{id:tree?.id,title:tree?.title||''}];
      for(const group of groups){
      const original=all;if(!original.length)continue;
      const groupIds=new Set(original.map(p=>p.id));
      const people=original.map(p=>({...p,parents:p.parents.filter(id=>groupIds.has(id)),partners:(p.partners||[]).filter(link=>groupIds.has(link.person_id))}));
      const nodes=new Map(people.map(p=>[p.id,p]));const levels=new Map();const kids=new Map();const remaining=new Map();
      people.forEach(p=>{remaining.set(p.id,p.parents.length);p.parents.forEach(id=>{if(!kids.has(id))kids.set(id,[]);kids.get(id).push(p.id)})});
      const queue=people.filter(p=>!p.parents.length).map(p=>p.id);queue.forEach(id=>levels.set(id,0));
      for(let i=0;i<queue.length;i++){const id=queue[i];for(const child of kids.get(id)||[]){levels.set(child,Math.max(levels.get(child)||0,(levels.get(id)||0)+1));remaining.set(child,remaining.get(child)-1);if(!remaining.get(child))queue.push(child)}}
      // Co-parents belong together in the same generation whenever the ancestry allows it.
      const groups=new Map(people.map(p=>[p.id,p.id]));
      const find=id=>{let result=id;while(groups.get(result)!==result)result=groups.get(result);while(groups.get(id)!==id){const next=groups.get(id);groups.set(id,result);id=next}return result};
      people.forEach(p=>{if(p.parents.length===2)groups.set(find(p.parents[1]),find(p.parents[0]));for(const link of p.partners||[])if(nodes.has(link.person_id))groups.set(find(link.person_id),find(p.id))});
      const members=new Map();people.forEach(p=>{const id=find(p.id);if(!members.has(id))members.set(id,[]);members.get(id).push(p)});
      const edges=new Map([...members.keys()].map(id=>[id,new Set()]));const incoming=new Map([...members.keys()].map(id=>[id,0]));
      people.forEach(p=>p.parents.forEach(parent=>{const a=find(parent),b=find(p.id);if(!edges.get(a).has(b)){edges.get(a).add(b);incoming.set(b,incoming.get(b)+1)}}));
      const generations=new Map();const ready=[...members.keys()].filter(id=>!incoming.get(id));ready.forEach(id=>generations.set(id,0));
      for(let i=0;i<ready.length;i++)for(const child of edges.get(ready[i])){generations.set(child,Math.max(generations.get(child)||0,(generations.get(ready[i])||0)+1));incoming.set(child,incoming.get(child)-1);if(!incoming.get(child))ready.push(child)}
      const grouped=ready.length===members.size;
      const rows=[];for(const p of people){const level=(grouped?generations.get(find(p.id)):levels.get(p.id))||0;(rows[level]??=[]).push(p)}
      const width=Math.max(1,...rows.map(r=>r.length))*238+100;
      rows.forEach((row,level)=>{
        const rank=p=>{const family=grouped?members.get(find(p.id)):[p];const parents=family.flatMap(x=>x.parents).filter(id=>positions.has(id));return parents.length?parents.reduce((sum,id)=>sum+positions.get(id).x,0)/parents.length:0};
        const familyName=p=>grouped?members.get(find(p.id)).map(x=>x.name).sort()[0]:p.name;
        row.sort((a,b)=>rank(a)-rank(b)||familyName(a).localeCompare(familyName(b))||a.name.localeCompare(b.name));
        const start=(width-(row.length*238-44))/2;row.forEach((p,i)=>positions.set(p.id,{x:offset+start+i*238,y:90+level*270}));
      });
      const height=Math.max(1,rows.length)*270+100;
      regions.push({id:group.id,title:group.title,x:offset,w:width,h:height});offset+=width+180;maxHeight=Math.max(maxHeight,height);
      }
      size={w:Math.max(1,offset-180),h:Math.max(1,maxHeight)};
      return all;
    }
    function transform(){const world=app.querySelector('.ft-world');if(world)world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`;const z=app.querySelector('[data-percent]');if(z)z.textContent=Math.round(view.z*100)+'%'}
    function fitTree(readable=false){const c=app.querySelector('.ft-canvas');if(!c)return;view.z=Math.min(1.15,Math.max(.04,Math.min((c.clientWidth-70)/size.w,(c.clientHeight-100)/size.h)));if(readable&&c.clientWidth<560)view.z=Math.max(.72,view.z);view.x=(c.clientWidth-size.w*view.z)/2;view.y=(c.clientHeight-size.h*view.z)/2+10;transform()}
    function zoom(factor,cx,cy){const c=app.querySelector('.ft-canvas');if(!c)return;cx??=c.clientWidth/2;cy??=c.clientHeight/2;const old=view.z;view.z=Math.min(2.2,Math.max(.04,old*factor));view.x=cx-(cx-view.x)*view.z/old;view.y=cy-(cy-view.y)*view.z/old;transform()}
    function centerPerson(id,z=view.z,atTop=false){
      const p=positions.get(id),canvas=app.querySelector('.ft-canvas');if(!p||!canvas)return;
      const card=app.querySelector(`[data-person="${id}"]`);
      const search=app.querySelector('.ft-search');
      const top=Math.max(24,search?search.offsetTop+search.offsetHeight+20:24);
      view.z=z;view.x=canvas.clientWidth/2-(p.x+(card?.offsetWidth||194)/2)*z;view.y=atTop?top-p.y*z:canvas.clientHeight/2-(p.y+(card?.offsetHeight||144)/2)*z;transform();
    }
    function focus(id){selectPerson(id);if(viewMode==='flat'){app.querySelector(`[data-flat-row="${id}"]`)?.scrollIntoView({block:'nearest'});return}centerPerson(id,1)}
    function actualSize(){zoom(1/view.z)}
    function initialView(){
      view.z=1;
      const current=tree.people.filter(p=>!p.redacted&&(p.in_current_tree||p.view_only));
      const self=current.filter(p=>p.profile_id===tree.current_user_id).sort((a,b)=>(b.home_tree_id===tree.id)-(a.home_tree_id===tree.id))[0];
      if(self){focus(self.id);return;}
      const native=current.filter(p=>p.home_tree_id===tree.id),ids=new Set(native.map(p=>p.id));
      const roots=native.filter(p=>!p.parents.some(id=>ids.has(id)));
      const candidates=roots.length?roots:native.length?native:current;
      candidates.sort((a,b)=>(positions.get(a.id)?.y||0)-(positions.get(b.id)?.y||0)||(a.birth_year||9999)-(b.birth_year||9999)||a.id.localeCompare(b.id));
      selectPerson(null);
      if(candidates.length)centerPerson(candidates[0].id,1,true);else{view.x=0;view.y=0;transform();}
    }
    function relationText(relation,person){
      const subject=tree.people.find(p=>p.id===selected);
      if(subject?.parents.includes(person.id)&&(subject.adopted_parents||[]).includes(person.id))return familyTerm(subject,person,'parent');
      if(person.parents.includes(selected)&&(person.adopted_parents||[]).includes(selected))return familyTerm(subject,person,'child');
      const key=window.FamilyTreeKinship.labelKey(relation,person,tree.people,selected,lang);
      return key?t(key):'';
    }
    function selectPerson(id){
      selected=id;const relations=id?window.FamilyTreeKinship.relationships(tree.people,id):new Map();
      app.querySelectorAll('[data-person]').forEach(el=>{const active=el.dataset.person===id;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active))});
      app.querySelectorAll('[data-kinship]').forEach(el=>{const person=tree.people.find(p=>p.id===el.dataset.kinship),relation=relations.get(person.id);const text=id&&relation?relationText(relation,person):'';el.hidden=!text;el.textContent=text;el.title=text});
      app.querySelectorAll('[data-flat-select]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.flatSelect===id)));
      app.querySelectorAll('[data-flat-row]').forEach(el=>el.classList.toggle('selected',el.dataset.flatRow===id));
      const context=app.querySelector('[data-flat-context]');if(context){context.textContent=id?fill('flatRelativeTo',{name:personName(id)}):t('flatHint');app.querySelector('[data-flat-clear]').hidden=!id}
      const world=app.querySelector('.ft-world');world?.classList.toggle('ft-has-selection',!!id);
      const svg=world?.querySelector('svg');if(!svg)return;
      svg.querySelectorAll('.ft-flow').forEach(el=>el.remove());
      svg.querySelectorAll('[data-edge-from]').forEach(edge=>{
        const connected=!!id&&(edge.dataset.edgeFrom===id||edge.dataset.edgeTo===id);
        edge.classList.toggle('ft-edge-active',connected);edge.classList.toggle('ft-edge-muted',!!id&&!connected);
        if(!connected)return;
        const partner=edge.dataset.edgeKind==='partner';
        const color=partner?'#f7c77d':edge.dataset.edgeTo===id?'#8acfff':'#9df2bd';
        const flow=document.createElementNS('http://www.w3.org/2000/svg','path');flow.setAttribute('d',edge.getAttribute('d'));flow.setAttribute('class','ft-flow');flow.style.color=color;flow.setAttribute('marker-end',`url(#${menuId}-arrow)`);svg.appendChild(flow);if(partner){const reverse=flow.cloneNode();reverse.classList.add('ft-flow-return');reverse.removeAttribute('marker-end');reverse.setAttribute('marker-start',`url(#${menuId}-back-arrow)`);svg.appendChild(reverse)}
      });
    }
    function closeTreeMenu(restore=false){
      if(treeMenu){treeMenu.remove();treeMenu=null;if(restore&&treeMenuAnchor?.isConnected)treeMenuAnchor.focus({preventScroll:true})}
      treeMenuAnchor=null;
    }
    function showTreeMenu(id,anchor,x,y){
      closeTreeMenu();const target=trees.find(p=>p.id===id);if(!target)return;
      treeMenuAnchor=anchor;
      const actions=['openTree','refresh',...(target.role!=='viewer'?['addPerson']:[]),'reviews',...(['owner','admin'].includes(target.role)?['share','settings']:[])];
      const layer=document.createElement('div');layer.className='ft-tree-context-layer';
      layer.innerHTML=`<div class="ft-tree-context" role="menu" aria-label="${esc(target.title)}"><strong>${esc(target.title)}</strong>${actions.map(action=>button(action,`data-tree-action="${action}" role="menuitem"`)).join('')}</div>`;
      treeMenu=layer;app.appendChild(layer);
      const menu=layer.querySelector('[role=menu]'),bounds=app.getBoundingClientRect(),source=anchor.getBoundingClientRect();
      const left=(x??source.right)-bounds.left,top=(y??source.top)-bounds.top;
      menu.style.left=Math.max(8,Math.min(left,app.clientWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(top,app.clientHeight-menu.offsetHeight-8))+'px';
      layer.onpointerdown=e=>{if(e.target===layer)closeTreeMenu(true)};
      layer.oncontextmenu=e=>{e.preventDefault();if(e.target===layer)closeTreeMenu(true)};
      layer.onkeydown=e=>{
        const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeTreeMenu(true)}
        if(e.key==='Tab')closeTreeMenu();
        if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
      };
      menu.querySelectorAll('[data-tree-action]').forEach(b=>b.onclick=()=>{
        const action=b.dataset.treeAction;closeTreeMenu();run(async()=>{
          setMenu(false);if(tree?.id!==id)await openTree(id);
          if(action==='openTree')return;
          if(action==='refresh'){await reload();return;}
          if(action==='addPerson'&&editable())editPerson();
          if(action==='reviews')reviews();
          if(action==='share'&&admin())share();
          if(action==='settings'&&admin())treeForm(true);
        });
      });
      menu.querySelector('button')?.focus();
    }
    function setMenu(open){
      const compact=app.clientWidth<=600;
      app.classList.toggle('menu-open',open&&compact);
      const toggle=app.querySelector(viewMode==='flat'?'.ft-flat [data-menu]':'[data-menu]'),sidebar=app.querySelector('.ft-sidebar'),main=app.querySelector('.ft-main');
      toggle?.setAttribute('aria-expanded',String(open&&compact));
      if(main)main.inert=open&&compact;
      if(sidebar){sidebar.setAttribute('role',open&&compact?'dialog':'navigation');if(open&&compact)sidebar.setAttribute('aria-modal','true');else sidebar.removeAttribute('aria-modal')}
      if(open&&compact)sidebar?.querySelector('[data-close-menu]')?.focus();else if(compact)toggle?.focus();
    }
    app.addEventListener('keydown',e=>{
      if(!app.classList.contains('menu-open')||modal)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMenu(false)}
      if(e.key==='Tab'){
        const items=[...app.querySelectorAll('.ft-sidebar button')].filter(el=>!el.disabled&&el.offsetParent);
        if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus()}
        else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus()}
      }
    });
    const resize=new ResizeObserver(()=>{closeTreeMenu();if(app.clientWidth>600&&app.classList.contains('menu-open'))setMenu(false)});
    resize.observe(app);
    async function showStatistics(button,state=null){
      const features=await api('/features');statisticsAvailable=features.statistics;
      if(!statisticsAvailable){
        if(window.mvmOS?.premiumGate){window.mvmOS.premiumStatus='free';window.mvmOS.premiumGate(button,t('statisticsPremium'));button.disabled=false;button.click()}
        else{button.remove()}
        return;
      }
      delete window.FamilyTreeStatistics;
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=window.asset('/pub/familytree/statistics.js');script.onload=()=>{script.remove();resolve()};script.onerror=()=>{script.remove();reject(Error(t('statisticsUnavailable')))};document.head.appendChild(script)});
      setMenu(false);
      const origin={treeId:tree?.id,view:{...view},selected};
      await window.FamilyTreeStatistics.open({api,panel,t,esc,lang,treeId:tree?.id,trees,state,
        openPerson:(tid,pid,statisticsState)=>run(async()=>{
          await openTree(tid,true,pid);
          detail(pid,{returnToStatistics:()=>run(async()=>{
            if(origin.treeId)await openTree(origin.treeId,false);
            view={...origin.view};transform();selectPerson(origin.selected);
            await showStatistics(app.querySelector('[data-statistics]')||button,statisticsState);
          })});
        })
      });
    }
    function bindViewButtons(){app.querySelectorAll('[data-view-mode]').forEach(el=>{
      const next=viewMode==='tree'?'flat':'tree',label=t(next==='tree'?'treeView':'flatView');
      el.title=label;el.setAttribute('aria-label',label);
      el.onclick=()=>run(async()=>{await api('/preferences','PUT',{view_mode:next});viewMode=next;close();render();if(viewMode==='tree')initialView()},el);
    })}
    function renderFlat(people){
      const children=new Map();people.forEach(p=>p.parents.forEach(id=>{if(!children.has(id))children.set(id,[]);children.get(id).push(p)}));
      const byId=new Map(people.map(p=>[p.id,p]));
      const relative=(p,kind,subject)=>`<button type="button" data-flat-relative="${p.id}"><span>${esc(familyTerm(subject,p,kind))}:</span> ${esc(p.name)}</button>`;
      const rows=[...people].sort((a,b)=>a.name.localeCompare(b.name,lang)).map(p=>{
        const parents=p.parents.map(id=>byId.get(id)).filter(Boolean),partnerIds=new Map((p.partners||[]).map(link=>[link.person_id,link.kind]));(children.get(p.id)||[]).forEach(child=>child.parents.forEach(id=>{if(id!==p.id&&!partnerIds.has(id))partnerIds.set(id,'coParent')}));const partners=[...partnerIds].map(([id,kind])=>({person:byId.get(id),kind})).filter(link=>link.person);
        return `<article class="ft-flat-row ft-flat-sex-${gender(p)}" data-flat-row="${p.id}"><div class="ft-flat-person"><button type="button" data-flat-select="${p.id}"><strong>${esc(p.name)}</strong><small>${esc(cardAge(p))} · ${esc(lifespan(p))}</small></button><span class="ft-flat-kinship" data-kinship="${p.id}" hidden></span><div class="ft-flat-actions"><button type="button" data-person-info="${p.id}" aria-label="${esc(fill('personInfo',{name:p.name}))}">ⓘ</button>${linkedOptions(p).length?`<button type="button" data-person-trees="${p.id}" aria-label="${esc(t('showLinkedTree'))}">🌳 ↗</button>`:''}</div></div><div class="ft-flat-relations">${parents.map(x=>relative(x,'parent',p)).join('')}${partners.map(link=>relative(link.person,link.kind,p)).join('')}${(children.get(p.id)||[]).map(x=>relative(x,'child',p)).join('')||(!parents.length&&!partners.length?`<span class="ft-muted">${esc(t('none'))}</span>`:'')}</div></article>`;
      }).join('');
      const section=document.createElement('section');section.className='ft-flat';section.innerHTML=`<div class="ft-flat-toolbar">${button('menu',`data-menu aria-controls="${menuId}" aria-expanded="false"`,'ft-flat-menu')}<strong>${esc(tree.title)}</strong><button type="button" data-view-mode aria-label="${esc(t('viewMode'))}">▦</button><input type="search" data-flat-search aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><small>${people.length} ${esc(t('people'))} · ${people.reduce((n,p)=>n+p.parents.length,0)} ${esc(t('parentLinks'))} · ${new Set(people.flatMap(p=>(p.partners||[]).map(x=>[p.id,x.person_id].sort().join(':')))).size} ${esc(t('partnerLinks'))}</small><div class="ft-flat-context"><span data-flat-context></span>${button('clearSelection','data-flat-clear')}</div></div><div class="ft-flat-rows">${rows}</div><p data-flat-empty hidden>${esc(t('noResults'))}</p>`;
      app.querySelector('.ft-main').appendChild(section);
      section.querySelector('[data-flat-search]').oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase();let count=0;section.querySelectorAll('[data-flat-row]').forEach(row=>{row.hidden=!byId.get(row.dataset.flatRow).name.toLocaleLowerCase().includes(q);if(!row.hidden)count++});section.querySelector('[data-flat-empty]').hidden=!!count};
      section.querySelectorAll('[data-flat-select]').forEach(el=>el.onclick=()=>selectPerson(selected===el.dataset.flatSelect?null:el.dataset.flatSelect));
      section.querySelectorAll('[data-flat-relative]').forEach(el=>el.onclick=()=>{section.querySelector('[data-flat-search]').value='';section.querySelectorAll('[data-flat-row]').forEach(row=>row.hidden=false);section.querySelector('[data-flat-empty]').hidden=true;focus(el.dataset.flatRelative)});
      section.querySelector('[data-flat-clear]').onclick=()=>selectPerson(null);
      section.querySelector('[data-menu]').onclick=()=>setMenu(!app.classList.contains('menu-open'));
    }
    function render(){
      if(disposed)return;
      const people=layout();
      closeTreeMenu();
      app.classList.remove('menu-open');
      app.innerHTML=`<button type="button" class="ft-menu-backdrop" data-close-menu aria-label="${esc(t('close'))}"></button><aside id="${menuId}" class="ft-sidebar" role="navigation" aria-label="${esc(t('menu'))}"><div class="ft-sidebar-heading"><div class="ft-brand"><img src="${esc(window.asset('/apps/familytree/icon.svg'))}" alt=""><div><strong>${esc(t('title'))}</strong><small>${esc(t('tagline'))}</small></div></div><button type="button" class="ft-menu-close" data-close-menu aria-label="${esc(t('close'))}">×</button></div><div class="ft-sidebar-actions"><button type="button" data-new-tree title="${esc(t('newTree'))}" aria-label="${esc(t('newTree'))}">＋</button>${tree?`<button type="button" data-view-mode title="${esc(t('viewMode'))}" aria-label="${esc(t('viewMode'))}">▦</button><button type="button" data-linked-views title="${esc(t('linkedViews'))}" aria-label="${esc(t('linkedViews'))}" ${tree.linked_trees?.length?'':'disabled'}>⇄</button><button type="button" data-refresh title="${esc(t('refresh'))}" aria-label="${esc(t('refresh'))}">↻</button>`:''}</div>${statisticsAvailable||window.mvmOS?.premiumGate?button('statistics','data-statistics'):''}<div class="ft-trees">${trees.map(x=>`<div class="ft-tree-row"><button class="ft-tree ${tree?.id===x.id?'active':''}" data-tree="${x.id}"><strong>${esc(x.title)}</strong><small>${esc(t(x.role))} · ${x.person_count} ${esc(t('people'))}</small></button><button type="button" class="ft-tree-more" data-tree-options="${x.id}" title="${esc(t('treeOptions'))}" aria-label="${esc(fill('treeOptionsFor',{name:x.title}))}" aria-haspopup="menu">⋯</button></div>`).join('')}</div><footer>${esc(t('privateHint'))}</footer></aside>
      <main class="ft-main">
      <div class="ft-canvas" tabindex="0" aria-label="${esc(t('canvas'))}">${button('menu',`data-menu aria-controls="${menuId}" aria-expanded="false"`,'ft-mobile-menu')}<div class="ft-world"><svg width="${size.w}" height="${size.h}"><defs><marker id="${menuId}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="context-stroke"/></marker><marker id="${menuId}-back-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="context-stroke"/></marker></defs>${people.flatMap(p=>(p.partners||[]).filter(link=>p.id<link.person_id&&positions.has(link.person_id)).map(link=>{const a=positions.get(p.id),b=positions.get(link.person_id);const left=a.x<=b.x?a:b,right=a.x<=b.x?b:a;const arch=Math.min(75,40+(right.x-left.x)*.04);const path=left.y===right.y&&right.x-left.x>250?`M${left.x+97},${left.y} C${left.x+97},${left.y-arch} ${right.x+97},${right.y-arch} ${right.x+97},${right.y}`:`M${left.x+194},${left.y+85} C${left.x+215},${left.y+85} ${right.x-21},${right.y+85} ${right.x},${right.y+85}`;return `<path data-edge-from="${p.id}" data-edge-to="${link.person_id}" data-edge-kind="partner" class="ft-partner-line ${link.kind.startsWith('former')?'ft-former-line':''}" d="${path}"><title>${esc(t(link.kind))}</title></path>`})).join('')}${people.map(p=>{const end=positions.get(p.id);return p.parents.map(id=>{const start=positions.get(id);if(!start)return '';return `<path data-edge-from="${id}" data-edge-to="${p.id}" data-edge-kind="parent" class="ft-branch ${(p.adopted_parents||[]).includes(id)?'ft-adopted-branch':''}" d="M${start.x+97},${start.y+172} C${start.x+97},${start.y+215} ${end.x+97},${end.y-48} ${end.x+97},${end.y}"/>`}).join('')}).join('')}</svg>${people.map(p=>{const pos=positions.get(p.id);const profile=tree.profiles[p.profile_id];return `<div class="ft-node" style="left:${pos.x}px;top:${pos.y}px"><button class="ft-person ft-sex-${gender(p)} ${p.deceased?'ft-deceased':''} ${selected===p.id?'selected':''}" data-person="${p.id}" style="left:0;top:0" aria-label="${esc(p.name)}"><span class="ft-avatar">${esc(p.name.split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join(''))}</span><span><strong>${esc(p.name)}</strong><small class="ft-card-age" title="${esc(ownAge(p))}">${esc(cardAge(p))}</small><small class="ft-card-life">${esc(lifespan(p))}</small>${profile?`<small class="ft-linked">↗ @${esc(profile.username)}</small>`:''}</span></button><button type="button" class="ft-info" data-person-info="${p.id}" title="${esc(fill('personInfo',{name:p.name}))}" aria-label="${esc(fill('personInfo',{name:p.name}))}">ⓘ</button><span class="ft-kinship" data-kinship="${p.id}" hidden></span>${linkedOptions(p).length?`<button type="button" class="ft-tree-badge" data-person-trees="${p.id}" title="${esc(t('showLinkedTree'))}" aria-label="${esc(t('showLinkedTree'))}">🌳 ↗</button>`:p.redacted?`<span class="ft-tree-lock" title="${esc(t('unavailablePerson'))}">🔒</span>`:''}</div>`}).join('')}</div>
      ${people.length?`<div class="ft-search"><input type="search" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><div class="ft-search-results"></div></div><span class="ft-hint">${esc(t('panHint'))}</span><div class="ft-canvas-tools"><button data-zoom-out aria-label="${esc(t('zoomOut'))}">−</button><span data-percent></span><button data-zoom-in aria-label="${esc(t('zoomIn'))}">+</button><button type="button" data-actual-size title="${esc(t('actualSize'))}" aria-label="${esc(t('actualSize'))}">100%</button>${button('fit','data-fit')}</div>`:`<div class="ft-empty"><div><div class="ft-sprout">🌳</div><h2>${esc(t(tree?'emptyTree':'welcome'))}</h2><p>${esc(t(tree?'emptyHint':'welcomeHint'))}</p>${tree?(editable()?button('addPerson','data-add','ft-primary'):''):button('newTree','data-new-tree','ft-primary')}</div></div>`}</div></main>`;
      app.classList.toggle('ft-flat-mode',viewMode==='flat'&&!!tree);
      if(tree&&viewMode==='flat')renderFlat(people);
      bindViewButtons();
      app.querySelectorAll('[data-tree]').forEach(b=>b.onclick=()=>run(async()=>{setMenu(false);await openTree(b.dataset.tree)}));
      app.querySelectorAll('[data-tree]').forEach(b=>{
        b.oncontextmenu=e=>{e.preventDefault();showTreeMenu(b.dataset.tree,b,e.clientX,e.clientY)};
        b.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();showTreeMenu(b.dataset.tree,b)}};
      });
      app.querySelectorAll('[data-tree-options]').forEach(b=>b.onclick=e=>showTreeMenu(b.dataset.treeOptions,b,e.detail?e.clientX:undefined,e.detail?e.clientY:undefined));
      app.querySelectorAll('[data-new-tree]').forEach(b=>b.onclick=()=>{setMenu(false);treeForm()});
      app.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{setMenu(false);editPerson()});
      app.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>selectPerson(selected===b.dataset.person?null:b.dataset.person));
      app.querySelectorAll('[data-person-info]').forEach(b=>b.onclick=()=>detail(b.dataset.personInfo));
      const bind=(sel,fn)=>{const b=app.querySelector(sel);if(b)b.onclick=()=>run(fn,b)};
      const stats=app.querySelector('[data-statistics]');if(stats){stats.onclick=()=>run(()=>showStatistics(stats),stats);if(window.mvmOS?.premiumGate&&!statisticsAvailable){window.mvmOS.premiumStatus='free';window.mvmOS.premiumGate(stats,t('statisticsPremium'))}}
      bind('[data-linked-views]',()=>{setMenu(false);linkedTrees()});
      app.querySelectorAll('[data-person-trees]').forEach(b=>b.onclick=()=>run(async()=>{const p=tree.people.find(x=>x.id===b.dataset.personTrees);await openLinkedPerson(p)},b));
      bind('[data-menu]',()=>setMenu(!app.classList.contains('menu-open')));
      app.querySelectorAll('[data-close-menu]').forEach(b=>b.onclick=()=>setMenu(false));bind('[data-share]',share);bind('[data-reviews]',reviews);bind('[data-settings]',()=>treeForm(true));bind('[data-refresh]',reload);bind('[data-fit]',fitTree);bind('[data-actual-size]',actualSize);bind('[data-zoom-in]',()=>zoom(1.2));bind('[data-zoom-out]',()=>zoom(1/1.2));
      const search=app.querySelector('.ft-search input');if(search)search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();const results=app.querySelector('.ft-search-results');results.innerHTML=q?people.filter(p=>p.name.toLocaleLowerCase().includes(q)).slice(0,20).map(p=>`<button data-find="${p.id}">${esc(p.name)}</button>`).join(''):'';results.querySelectorAll('button').forEach(b=>b.onclick=()=>{focus(b.dataset.find);results.innerHTML=''})};
      const canvas=app.querySelector('.ft-canvas');const pointers=new Map();let drag=null,moved=false;
      canvas.addEventListener('wheel',e=>{if(e.target.closest('.ft-search'))return;e.preventDefault();const r=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0014),e.clientX-r.left,e.clientY-r.top)},{passive:false});
      canvas.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,select,textarea,.ft-search')&&!e.target.closest('.ft-person'))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});drag={x:e.clientX,y:e.clientY};moved=false;if(!e.target.closest('.ft-person'))canvas.setPointerCapture(e.pointerId)});
      canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)[1];const prev=Math.hypot(old.x-other.x,old.y-other.y);const next=Math.hypot(e.clientX-other.x,e.clientY-other.y);const r=canvas.getBoundingClientRect();if(prev>1)zoom(next/prev,(other.x+e.clientX)/2-r.left,(other.y+e.clientY)/2-r.top);moved=true}else if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4||moved){canvas.setPointerCapture(e.pointerId);moved=true;view.x+=dx;view.y+=dy;drag={x:e.clientX,y:e.clientY};transform()}}});
      const end=e=>{pointers.delete(e.pointerId);drag=pointers.size?[...pointers.values()][0]:null};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
      canvas.addEventListener('click',e=>{if(moved){e.stopPropagation();e.preventDefault();moved=false}},{capture:true});
      canvas.onkeydown=e=>{if(e.target!==canvas)return;const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(delta){e.preventDefault();view.x+=delta[0];view.y+=delta[1];transform()}if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(1/1.2);if(e.key==='0')fitTree();if(e.key==='1')actualSize()};
      transform();selectPerson(selected);
    }
    let previousFocus=null;
    function close(){if(modal){modal.remove();modal=null;previousFocus?.focus({preventScroll:true})}}
    function panel(title,html){
      closeTreeMenu();close();previousFocus=document.activeElement;
      modal=document.createElement('div');modal.className='ft-modal';modal.innerHTML=`<section class="ft-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ft-panel-top"><h2>${esc(title)}</h2><button type="button" data-close aria-label="${esc(t('close'))}">×</button></div>${html}<p class="ft-error" role="alert"></p></section>`;app.appendChild(modal);
      const current=modal;modal.querySelector('[data-close]').onclick=close;modal.onpointerdown=e=>{if(e.target===current)close()};modal.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();close()}if(e.key==='Tab'){const els=[...current.querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.disabled&&x.offsetParent);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};requestAnimationFrame(()=>current.querySelector('input,textarea,button')?.focus());return modal;
    }
    function treeForm(settings=false){
      const box=panel(t(settings?'settings':'newTree'),`<form><label>${esc(t('treeName'))}<input class="ft-wide" name="title" required maxlength="160" style="display:block;width:100%;margin-top:8px" value="${esc(settings?tree.title:'')}"></label><div class="ft-actions">${button('save','type="submit"','ft-primary')}${settings?button('deleteTree','data-delete-tree','ft-danger'):''}</div></form>`);
      box.querySelector('form').onsubmit=e=>{e.preventDefault();run(async()=>{const data={title:new FormData(e.target).get('title')};const r=await api(settings?'/trees/'+tree.id:'/trees',settings?'PUT':'POST',data);await refreshList();await openTree(settings?tree.id:r.id)},e.submitter)};
      if(settings)box.querySelector('[data-delete-tree]').onclick=()=>confirmAction('deleteTree','deleteTreeHint',async()=>{await api('/trees/'+tree.id,'DELETE');tree=null;await refreshList();close();render()});
    }
    function confirmAction(title,hint,fn){const box=panel(t(title),`<p>${esc(t(hint))}</p><div class="ft-actions">${button('cancel','data-cancel')}${button('confirm','data-confirm','ft-danger')}</div>`);box.querySelector('[data-cancel]').onclick=close;box.querySelector('[data-confirm]').onclick=e=>run(fn,e.target)}
    function gender(p){return p?.gender||'unknown'}
    function lifespan(p,exact=false){
      const born=exact&&p.birth_date?formatDate(p.birth_date):p.birth_year||t('unknownDate');
      const died=exact&&p.death_date?formatDate(p.death_date):p.death_year;
      return born+' – '+(p.deceased||died?died||t('unknownDate'):t('present'));
    }
    function familyTerm(subject,relative,kind){
      if(kind==='parent'&&(subject?.adopted_parents||[]).includes(relative.id))return t(gender(relative)==='male'?'adoptiveFather':gender(relative)==='female'?'adoptiveMother':'adoptiveParent');
      if(kind==='child'&&(relative?.adopted_parents||[]).includes(subject?.id))return t(gender(relative)==='male'?'adoptedSon':gender(relative)==='female'?'adoptedDaughter':'adoptedChild');
      return kin(relative,kind);
    }
    function kin(p,relation){return t(window.FamilyTreeKinship.termKey(relation,gender(p)))}
    function personKey(p,key){return key+(gender(p)==='male'?'Male':gender(p)==='female'?'Female':'')}
    function personTerm(p,key){return t(personKey(p,key))}
    function partnerships(p){
      const links=new Map((p.partners||[]).map(link=>[link.person_id,link.kind]));
      // Shared children identify a co-parent without implying marriage.
      tree.people.filter(child=>child.parents.includes(p.id)).forEach(child=>child.parents.forEach(id=>{if(id!==p.id&&!links.has(id))links.set(id,'coParent')}));
      return [...links].map(([id,kind])=>({person:tree.people.find(x=>x.id===id),kind})).filter(x=>x.person);
    }
    function fill(key,values){return t(key).replace(/\{(\w+)\}/g,(_,k)=>values[k]??'')}
    function ageDuration(value){
      const duration=new Intl.NumberFormat(lang,{style:'unit',unit:value.unit,unitDisplay:'long'}).format(value.value);
      return value.approximate?fill('approximateDuration',{duration}):duration;
    }
    function cardAge(p){
      const age=window.FamilyTreeDates.age(p);
      return age?(age.approximate?'≈ ':'')+ageDuration({...age,approximate:false}):t(p.deceased?'deathAgeUnknown':'ageUnknown');
    }
    function ownAge(p){
      const age=window.FamilyTreeDates.age(p);
      return age?fill(p.deceased?personKey(p,'ageAtDeath'):'currentAge',{duration:ageDuration(age)}):t(p.deceased?'deathAgeUnknown':'ageUnknown');
    }
    function ageComparison(subject,other){
      const value=window.FamilyTreeDates.compare(subject,other);
      if(!value)return t('ageDifferenceUnknown');
      if(value.direction==='sameDate')return t('sameBirthDate');
      if(value.direction==='sameYear')return t('sameBirthYear');
      const suffix=gender(other)==='male'?'Male':gender(other)==='female'?'Female':'';
      return fill(value.direction+'By'+suffix,{duration:ageDuration(value)});
    }
    function detail(id,navigation={}){const p=tree.people.find(x=>x.id===id);if(!p)return;const profile=tree.profiles[p.profile_id];
      if(!navigation.append&&!navigation.back){detailTrail=[];detailOriginFocus=document.activeElement}
      if(!navigation.back)detailTrail.push({id,view:{...view},scrollTop:0,returnToStatistics:navigation.returnToStatistics||detailTrail.at(-1)?.returnToStatistics});
      selectPerson(id);
      const relative=(person,relation)=>`<button class="ft-relative ft-sex-${gender(person)}" data-relative="${person.id}"><span>${esc(person.name)} <small>· ${esc(familyTerm(p,person,relation))}</small></span><small class="ft-age-difference">${esc(ageComparison(p,person))}</small></button>`;
      const partners=partnerships(p);
      const box=panel(p.name,`<p class="ft-tag">${esc(t(gender(p)))}${p.deceased?' · '+esc(personTerm(p,'deceased')):''}</p><p class="ft-lifespan">${esc(lifespan(p,true))}</p><p class="ft-age">${esc(ownAge(p))}</p><p class="ft-muted">${esc(personTerm(p,'birth'))}: ${esc(p.birth_date?formatDate(p.birth_date):p.birth_year||t('unknownDate'))}${p.deceased?`<br>${esc(personTerm(p,'death'))}: ${esc(p.death_date?formatDate(p.death_date):p.death_year||t('unknownDate'))}`:''}</p>${profile?`<p class="ft-tag">↗ ${esc(t('linkedProfile'))}</p><p><strong>${esc(profile.display_name)}</strong> <span class="ft-muted">@${esc(profile.username)}</span></p>`:''}<hr class="ft-separator"><div class="ft-biography">${esc(p.notes||t('noNotes'))}</div><hr class="ft-separator"><h3>${esc(t('parents'))}</h3><div class="ft-family-links">${p.parents.length?p.parents.map(pid=>{const parent=tree.people.find(x=>x.id===pid);return parent?relative(parent,'parent'):''}).join(''):esc(t('none'))}</div><h3 style="margin-top:18px">${esc(t('partners'))}</h3><div class="ft-family-links">${partners.map(x=>relative(x.person,x.kind)).join('')||esc(t('none'))}</div><h3 style="margin-top:18px">${esc(t('children'))}</h3><div class="ft-family-links">${tree.people.filter(c=>c.parents.includes(id)).map(c=>relative(c,'child')).join('')||esc(t('none'))}</div>${editablePerson(p)?`<div class="ft-actions">${button('edit','data-edit','ft-primary')}${button('deletePerson','data-delete','ft-danger')}</div>`:''}`);
      const section=box.querySelector('.ft-panel');section.classList.add('ft-person-panel','ft-sex-'+gender(p));
      if(p.home_tree_id!==tree.id||linkedOptions(p).length){
        const context=document.createElement('div');context.className='ft-person-source';
        context.innerHTML=`<p class="ft-muted">${esc(p.redacted?t('unavailablePerson'):fill('fromTree',{name:p.home_tree_title}))}</p><div class="ft-actions">${p.home_tree_id&&p.home_tree_id!==tree.id?button('openOriginal','data-original'):''}${p.home_tree_id===tree.id&&linkedOptions(p).length?button('showLinkedTree','data-show-linked'):''}${editable()&&p.in_current_tree&&!p.redacted?button('addChild','data-reference-child')+button('addPartner','data-reference-partner'):''}${editable()&&p.reference_version?button('removeReference','data-unlink-person','ft-danger'):''}</div>`;
        section.appendChild(context);
        context.querySelector('[data-reference-child]')?.addEventListener('click',()=>editPerson(null,p.id));
        context.querySelector('[data-reference-partner]')?.addEventListener('click',()=>editPerson(null,null,p.id));
        context.querySelector('[data-original]')?.addEventListener('click',()=>run(()=>openTree(p.home_tree_id,true,p.id)));
        context.querySelector('[data-show-linked]')?.addEventListener('click',()=>run(async()=>{await openLinkedPerson(p)}));
        context.querySelector('[data-unlink-person]')?.addEventListener('click',()=>confirmAction('removeReference','removeReferenceHint',async()=>{const result=await api('/trees/'+tree.id+'/references','POST',{action:'unlink',person_id:p.id,version:p.reference_version});await reload();toast(t(result.status==='pending'?'submitted':'saved'))}));
      }

      previousFocus=detailOriginFocus;
      if(detailTrail.length>1){
        const prior=detailTrail.at(-2);const label=fill('backToPerson',{name:personName(prior.id)});
        const back=document.createElement('button');back.type='button';back.className='ft-detail-back';back.dataset.personBack='';back.textContent='← '+t('back');back.title=label;back.setAttribute('aria-label',label);
        section.querySelector('.ft-panel-top').prepend(back);
        back.onclick=()=>{detailTrail.pop();const prior=detailTrail.at(-1);view={...prior.view};transform();detail(prior.id,{back:true})};
      }
      const returnToStatistics=detailTrail.at(-1)?.returnToStatistics;
      if(returnToStatistics){section.classList.add('ft-has-statistics-back');const back=document.createElement('button');back.type='button';back.className='ft-detail-back';back.dataset.statisticsBack='';back.textContent='← '+t('statistics');back.title=t('backToStatistics');back.setAttribute('aria-label',t('backToStatistics'));section.querySelector('.ft-panel-top').prepend(back);back.onclick=returnToStatistics}
      const entry=detailTrail.at(-1);requestAnimationFrame(()=>{if(section.isConnected)section.scrollTop=entry.scrollTop});
      box.querySelectorAll('[data-relative]').forEach(b=>b.onclick=()=>{
        const current=detailTrail.at(-1);current.scrollTop=section.scrollTop;current.view={...view};
        focus(b.dataset.relative);detail(b.dataset.relative,{append:true});
      });
      if(editablePerson(p)){box.querySelector('[data-edit]').onclick=()=>editPerson(p);box.querySelector('[data-delete]').onclick=()=>confirmAction('deletePerson','deletePersonHint',async()=>{const r=await api('/trees/'+tree.id+'/changes','POST',{action:'delete',person_id:id,version:p.version});await reload();toast(t(r.status==='pending'?'submitted':'saved'))})}
    }
    function formatDate(s){const [y,m,d]=s.split('-').map(Number);const v=new Date(0);v.setFullYear(y,m-1,d);return v.toLocaleDateString(lang)}
    function profilePicker(container,chosen,onSelect){
      let active=chosen;let timer,seq=0;const draw=()=>{container.innerHTML=`<div class="ft-profile-chosen">${active?`<span>↗ ${esc(active.display_name||active.username)} <small>@${esc(active.username)}</small></span>${button('unlink','data-unlink')}`:`<small>${esc(t('noProfile'))}</small>`}</div><input type="search" aria-label="${esc(t('profileSearch'))}" placeholder="${esc(t('profileSearch'))}"><div class="ft-profile-results"></div>`;
        container.querySelector('[data-unlink]')?.addEventListener('click',()=>{active=null;onSelect(null);draw()});
        container.querySelector('input').oninput=e=>{clearTimeout(timer);const q=e.target.value;const request=++seq;const results=container.querySelector('.ft-profile-results');results.replaceChildren();if(q.trim().length<2)return;timer=setTimeout(async()=>{try{const rows=await api('/profiles?q='+encodeURIComponent(q));if(request!==seq||!container.isConnected)return;results.innerHTML=rows.length?rows.map(p=>`<button type="button" data-profile="${esc(p.id)}">${esc(p.display_name)} <small>@${esc(p.username)}</small></button>`).join(''):`<small>${esc(t('noResults'))}</small>`;results.querySelectorAll('button').forEach(b=>b.onclick=()=>{active=rows.find(x=>x.id===b.dataset.profile);onSelect(active);draw()})}catch(e){if(container.isConnected)toast(e.message)}},250)};
      };draw();
    }
    function editPerson(person=null,parent=null,partner=null){
      const p=person||{name:'',notes:'',birth_date:'',birth_year:'',profile_id:'',parents:parent?[parent,...(partnerships(tree.people.find(x=>x.id===parent)).length===1?[partnerships(tree.people.find(x=>x.id===parent))[0].person.id]:[])]:[],gender:'unknown',deceased:false,death_date:'',death_year:'',partners:partner?[{person_id:partner,kind:'partner'}]:[]};let profileId=tree.profiles[p.profile_id]?p.profile_id:'';
      const links=(p.stored_partners??p.partners??[]).map(x=>({...x}));
      const choices=new Map(tree.people.map(x=>[x.id,x]));
      const selfId=person?.id,par=[p.parents[0]||'',p.parents[1]||''],kids=person?tree.people.filter(x=>x.parents.includes(person.id)&&x.home_tree_id===tree.id).map(x=>x.id):[];
      // Every list offers only people who cannot contradict the other choices made in this form.
      const walk=(ids,next)=>{const seen=new Set(),stack=ids.filter(Boolean);while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);next(id).forEach(n=>stack.push(n))}return seen};
      const below=ids=>walk(ids,id=>tree.people.filter(n=>n.id!==selfId&&n.parents.includes(id)).map(n=>n.id));
      const above=ids=>walk(ids,id=>tree.people.find(n=>n.id===id)?.parents||[]);
      const memo=(fn,key)=>{let k,v;return()=>{const n=key();if(n!==k){k=n;v=fn()}return v}};
      const belowKids=memo(()=>below(kids),()=>kids.join()),aboveParents=memo(()=>above(par),()=>par.join());
      const partnerIds=()=>links.map(l=>l.person_id).filter(Boolean);
      const okParent=(x,slot)=>x.id!==selfId&&!belowKids().has(x.id)&&!partnerIds().includes(x.id)&&par[1-slot]!==x.id;
      const okPartner=(x,row)=>x.id!==selfId&&!par.includes(x.id)&&!kids.includes(x.id)&&!links.some((l,j)=>j!==row&&l.person_id===x.id);
      const okKid=x=>x.home_tree_id===tree.id&&!x.redacted&&x.id!==selfId&&!kids.includes(x.id)&&!aboveParents().has(x.id)&&!partnerIds().includes(x.id)&&x.parents.filter(id=>id!==selfId).length<2;
      const options=(chosen,ok,empty='none')=>`<option value="">${esc(t(empty))}</option>`+[...choices.values()].filter(x=>x.id===chosen||ok(x)).map(x=>`<option value="${x.id}" ${chosen===x.id?'selected':''}>${esc(x.name)} · ${esc(kin(x,'parent'))}</option>`).join('');
      const year=new Date().getFullYear(),today=new Date().toISOString().slice(0,10);
      const box=panel(t(person?'editPerson':'addPerson'),`${tree.role==='editor'?`<p class="ft-muted">${esc(t('editorHint'))}</p>`:''}${person?`<section class="ft-connections" data-connections><h3>${esc(t('treeConnections'))}</h3><p>${esc(t('loading'))}</p></section>`:''}${!person?`<div class="ft-actions">${button('useExisting','data-use-existing')}</div>`:''}<form class="ft-form"><label>${esc(t('name'))}<input name="name" required maxlength="160" value="${esc(p.name)}"></label><label>${esc(t('gender'))}<select name="gender">${['unknown','male','female'].map(g=>`<option value="${g}" ${gender(p)===g?'selected':''}>${esc(t(g))}</option>`).join('')}</select></label><label>${esc(t('birthYear'))}<input name="birth_year" type="number" min="1" max="${year}" value="${p.birth_year||''}"></label><label>${esc(t('birthDate'))}<input name="birth_date" type="date" min="0001-01-01" max="${today}" value="${esc(p.birth_date)}"></label><label class="ft-wide ft-check"><input name="deceased" type="checkbox" ${p.deceased?'checked':''}> <span data-deceased-label>${esc(personTerm(p,'deceased'))}</span></label><label data-death>${esc(t('deathYear'))}<input name="death_year" type="number" min="1" max="${year}" value="${p.death_year||''}"></label><label data-death>${esc(t('deathDate'))}<input name="death_date" type="date" min="0001-01-01" max="${today}" value="${esc(p.death_date||'')}"></label><h3 class="ft-wide" style="margin:6px 0 -6px">${esc(t('familyConnections'))}</h3><div class="ft-wide"><label>${esc(t('peopleFromTree'))}<select data-choice-tree><option value="">${esc(t('chooseTree'))}</option>${trees.filter(x=>x.id!==tree.id).map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select></label><small>${esc(t('externalChoicesHint'))}</small></div><div><label>${esc(t('parentOne'))}<select name="parent1">${options(par[0],x=>okParent(x,0))}</select></label><label class="ft-check"><input type="checkbox" name="adopted1" ${(p.adopted_parents||[]).includes(p.parents[0])?'checked':''}> ${esc(t('adoptedByParent'))}</label></div><div><label>${esc(t('parentTwo'))}<select name="parent2">${options(par[1],x=>okParent(x,1))}</select></label><label class="ft-check"><input type="checkbox" name="adopted2" ${(p.adopted_parents||[]).includes(p.parents[1])?'checked':''}> ${esc(t('adoptedByParent'))}</label></div><div class="ft-wide"><h3>${esc(t('partners'))}</h3><p class="ft-muted ft-tip">${esc(t('partnersHint'))}</p><div data-derived-partners></div><div data-partners></div>${button('linkPartner','data-link-partner')}</div><div class="ft-wide"><h3>${esc(t('children'))}</h3><p class="ft-muted ft-tip">${esc(t('childrenHint'))}</p><div class="ft-family-links" data-kids></div><label>${esc(t('addChildLabel'))}<select data-kid-add></select></label></div><div class="ft-wide"><h3>${esc(t('siblingsAuto'))}</h3><p class="ft-muted" data-siblings></p></div><label class="ft-wide">${esc(t('notes'))}<textarea name="notes" maxlength="12000">${esc(p.notes)}</textarea></label><div class="ft-wide"><h3>${esc(t('linkedProfile'))}</h3><div data-picker></div><small>${esc(t('linkHint'))}</small></div>${tree.role==='editor'?`<label class="ft-wide">${esc(t('proposalNote'))}<textarea name="note" maxlength="2000"></textarea></label>`:''}<div class="ft-actions ft-wide">${button(tree.role==='editor'?'submit':'save','type="submit"','ft-primary')}${button('cancel','data-cancel')}</div></form>`);
      const drawDerived=()=>{const current=person?tree.people.find(x=>x.id===p.id):p;const derived=(current?.partners||[]).filter(link=>!links.some(stored=>stored.person_id===link.person_id));
      box.querySelector('[data-derived-partners]').innerHTML=derived.map(link=>{const other=choices.get(link.person_id);return `<div class="ft-connection-row"><strong>${esc(other?.name||personName(link.person_id))} · ${esc(kin(other,link.kind))}</strong><small>${esc(fill('relationshipInTree',{name:treeTitle(other?.home_tree_id)}))}</small>${button('openTree',`data-relationship-tree="${esc(other?.home_tree_id)}"`)}</div>`}).join('');
      box.querySelectorAll('[data-relationship-tree]').forEach(el=>el.onclick=()=>run(()=>openTree(el.dataset.relationshipTree,true,p.id),el));};drawDerived();
      if(person){
        const container=box.querySelector('[data-connections]');
        const drawConnections=async()=>{
          const state=await api('/people/'+p.id+'/tree-links');if(!box.isConnected)return;
          const existing=new Set(state.connections.map(x=>x.tree_id));
          container.innerHTML=`<h3>${esc(t('treeConnections'))}</h3><p class="ft-muted">${esc(t('treeConnectionsHint'))}</p>${state.connections.map(link=>`<div class="ft-connection-row"><strong>${esc(link.title)}</strong><small>${esc(t(link.role))}</small><div class="ft-actions">${button('openTree',`data-connection-open="${esc(link.tree_id)}"`)}${link.role!=='viewer'?button('removeReference',`data-connection-remove="${esc(link.tree_id)}"`,'ft-danger'):''}</div></div>`).join('')||`<p>${esc(t('noTreeConnections'))}</p>`}<label>${esc(t('addTreeConnection'))}<select data-connection-target><option value="">${esc(t('chooseTree'))}</option>${state.available.filter(x=>!existing.has(x.id)&&x.role!=='viewer').map(x=>`<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select></label>${button('addTreeConnection','data-connection-add')}<small>${esc(t('connectionImmediate'))}</small>`;
          container.querySelectorAll('[data-connection-open]').forEach(el=>el.onclick=()=>run(()=>openTree(el.dataset.connectionOpen,true,p.id),el));
          const update=async(target,action,version)=>{
            const result=await api('/trees/'+target+'/references','POST',{action,person_id:p.id,version});
            // Refresh the canvas without replacing this editor or losing its draft.
            await refreshList();const next=await api('/trees/'+tree.id);tree=next;const activeModal=modal;render();if(activeModal)app.appendChild(activeModal);drawDerived();await drawConnections();toast(t(result.status==='pending'?'submitted':'saved'));
          };
          container.querySelector('[data-connection-add]').onclick=e=>run(async()=>{const target=container.querySelector('[data-connection-target]').value;if(target)await update(target,'link')},e.currentTarget);
          container.querySelectorAll('[data-connection-remove]').forEach(el=>el.onclick=()=>{if(!el.dataset.confirmed){el.dataset.confirmed='true';el.textContent=t('confirm');return}const link=state.connections.find(x=>x.tree_id===el.dataset.connectionRemove);run(()=>update(link.tree_id,'unlink',link.version),el)});
        };
        run(drawConnections);
      }
      const setHtml=(sel,html)=>{if(sel)sel.innerHTML=html};
      const drawFamily=()=>{
        const box_=box.querySelector('[data-kids]');
        box_.innerHTML=kids.map(id=>`<button type="button" data-kid-remove="${esc(id)}" title="${esc(t('unlink'))}">${esc(choices.get(id)?.name||personName(id))} ×</button>`).join('')||esc(t('none'));
        box_.querySelectorAll('[data-kid-remove]').forEach(el=>el.onclick=()=>{kids.splice(kids.indexOf(el.dataset.kidRemove),1);refresh()});
        const add=box.querySelector('[data-kid-add]'),free=[...choices.values()].filter(okKid);
        setHtml(add,`<option value="">${esc(t('chooseChild'))}</option>`+free.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(''));add.disabled=!free.length;
        const mates=par.filter(Boolean),sibs=tree.people.filter(x=>x.id!==selfId&&!kids.includes(x.id)&&x.parents.some(id=>mates.includes(id)));
        box.querySelector('[data-siblings]').textContent=!mates.length?t('siblingsNeedParent'):sibs.map(x=>x.name).join(', ')||t('none');
      };
      const refresh=()=>{
        [0,1].forEach(n=>setHtml(box.querySelector(`[name=parent${n+1}]`),options(par[n],x=>okParent(x,n))));
        box.querySelectorAll('[data-partner-person]').forEach(el=>{const i=Number(el.dataset.partnerPerson);setHtml(el,`<option value="">${esc(t('choosePerson'))}</option>`+[...choices.values()].filter(x=>x.id===links[i].person_id||okPartner(x,i)).map(x=>`<option value="${x.id}" ${links[i].person_id===x.id?'selected':''}>${esc(x.name)}</option>`).join(''))});
        drawFamily();
      };
      const showLinks=()=>{
        const container=box.querySelector('[data-partners]');container.innerHTML=links.map((link,i)=>`<div class="ft-partner-edit"><select data-partner-person="${i}" aria-label="${esc(t('partnerPerson'))}" required><option value="">${esc(t('choosePerson'))}</option>${[...choices.values()].filter(x=>x.id===link.person_id||okPartner(x,i)).map(x=>`<option value="${x.id}" ${link.person_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select data-partner-kind="${i}" aria-label="${esc(t('relationship'))}">${['partner','spouse','former_partner','former_spouse'].map(kind=>`<option value="${kind}" ${kind===link.kind?'selected':''}>${esc(kin(choices.get(link.person_id),kind))}</option>`).join('')}</select><button type="button" data-remove-partner="${i}" aria-label="${esc(t('unlink'))}">×</button></div>`).join('');
        container.querySelectorAll('[data-partner-person]').forEach(el=>el.onchange=()=>{const index=Number(el.dataset.partnerPerson);links[index].person_id=el.value;refresh();container.querySelector(`[data-partner-kind="${index}"]`).querySelectorAll('option').forEach(option=>option.textContent=kin(choices.get(el.value),option.value))});
        container.querySelectorAll('[data-partner-kind]').forEach(el=>el.onchange=()=>links[Number(el.dataset.partnerKind)].kind=el.value);
        container.querySelectorAll('[data-remove-partner]').forEach(el=>el.onclick=()=>{links.splice(Number(el.dataset.removePartner),1);showLinks();refresh()});
      };
      box.querySelector('[data-use-existing]')?.addEventListener('click',existingPerson);
      let choiceSequence=0;
      box.querySelector('[data-choice-tree]').onchange=e=>run(async()=>{const id=e.target.value;if(!id)return;const seq=++choiceSequence;const other=await api('/trees/'+id);if(seq!==choiceSequence||!box.isConnected)return;other.people.filter(x=>!x.redacted&&x.home_tree_id===id).forEach(x=>choices.set(x.id,{...x,in_current_tree:false}));showLinks();refresh()},e.target);
      for(const n of [1,2]){const parentSelect=box.querySelector(`[name=parent${n}]`),check=box.querySelector(`[name=adopted${n}]`);const update=()=>{check.disabled=!parentSelect.value;if(check.disabled)check.checked=false};parentSelect.onchange=()=>{par[n-1]=parentSelect.value;update();refresh()};update()}
      box.querySelector('[data-kid-add]').onchange=e=>{if(e.target.value){kids.push(e.target.value);refresh()}};drawFamily();
      box.querySelector('[name=gender]').onchange=e=>{box.querySelector('[data-deceased-label]').textContent=personTerm({gender:e.target.value},'deceased')};
      showLinks();box.querySelector('[data-link-partner]').onclick=()=>{links.push({person_id:'',kind:'partner'});showLinks()};
      profilePicker(box.querySelector('[data-picker]'),tree.profiles[p.profile_id],x=>profileId=x?.id||'');
      box.querySelector('[data-cancel]').onclick=close;
      const deathFields=()=>{const dead=box.querySelector('[name=deceased]').checked;box.querySelectorAll('[data-death]').forEach(el=>{el.hidden=!dead;el.querySelector('input').disabled=!dead})};
      box.querySelector('[name=deceased]').onchange=deathFields;deathFields();
      for(const event of ['birth','death'])box.querySelector(`[name=${event}_date]`).onchange=e=>{if(e.target.value)box.querySelector(`[name=${event}_year]`).value=Number(e.target.value.slice(0,4))};
      box.querySelector('form').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);run(async()=>{const result=await api('/trees/'+tree.id+'/changes','POST',{action:person?'update':'create',person_id:person?.id||'',version:person?.version,references:[...new Set([fd.get('parent1'),fd.get('parent2'),...links.map(x=>x.person_id)].filter(id=>{const picked=choices.get(id);return picked&&picked.home_tree_id!==tree.id&&!picked.in_current_tree}))],data:{name:fd.get('name'),notes:fd.get('notes'),gender:fd.get('gender'),deceased:fd.has('deceased'),birth_year:fd.get('birth_year')?Number(fd.get('birth_year')):null,birth_date:fd.get('birth_date'),death_year:fd.get('death_year')?Number(fd.get('death_year')):null,death_date:fd.get('death_date')||'',parents:[fd.get('parent1'),fd.get('parent2')].filter(Boolean),adopted_parents:[1,2].filter(n=>fd.has('adopted'+n)).map(n=>fd.get('parent'+n)).filter(Boolean),partners:links,children:kids,profile_id:profileId},note:fd.get('note')||''});await reload();if(result.status!=='pending'){focus(result.id);detail(result.id)}toast(t(result.status==='pending'?'submitted':'saved'))},e.submitter)};
    }
    function share(){const box=panel(t('share'),`<p class="ft-muted">${esc(t('shareHint'))}</p><div>${tree.members.map(m=>`<div class="ft-member"><strong>${esc(name(m.user_id))}<small>${esc(tree.profiles[m.user_id]?.username?'@'+tree.profiles[m.user_id].username:'')}</small></strong>${m.role==='owner'?`<span class="ft-tag">${esc(t('owner'))}</span>`:`<select aria-label="${esc(t('role'))}" data-member="${esc(m.user_id)}">${['viewer','editor','admin','remove'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${esc(t(r))}</option>`).join('')}</select>`}</div>`).join('')}</div><hr class="ft-separator"><h3>${esc(t('addMember'))}</h3><div data-picker></div><div class="ft-member"><select data-role aria-label="${esc(t('role'))}">${['viewer','editor','admin'].map(r=>`<option value="${r}">${esc(t(r))}</option>`).join('')}</select>${button('share','data-invite','ft-primary')}</div><p class="ft-muted">${esc(t('adminHint'))}</p>`);
      let profile=null;profilePicker(box.querySelector('[data-picker]'),null,p=>profile=p);
      const update=async(user_id,role)=>{await api('/trees/'+tree.id+'/members','PUT',{user_id,role});await reload();share();toast(t('saved'))};
      box.querySelector('[data-invite]').onclick=e=>run(async()=>{if(!profile)throw Error(t('chooseProfile'));await update(profile.id,box.querySelector('[data-role]').value)},e.target);
      box.querySelectorAll('[data-member]').forEach(s=>s.onchange=()=>{const role=s.value;if(role==='admin'){confirmAction('admin','adminHint',()=>update(s.dataset.member,role))}else run(()=>update(s.dataset.member,role),s)});
    }
    function snapshot(p){if(p?.reference_id)return `<p>${esc(personName(p.reference_id))}</p>`;if(!p)return `<p>${esc(t('none'))}</p>`;return `<p><b>${esc(t('name'))}:</b> ${esc(p.name)}</p><p><b>${esc(t('gender'))}:</b> ${esc(t(gender(p)))}</p><p><b>${esc(t('lifespan'))}:</b> ${esc(lifespan(p,true))}</p><p><b>${esc(personTerm(p,'birth'))}:</b> ${esc(p.birth_date||p.birth_year||t('unknownDate'))}</p><p><b>${esc(t('parents'))}:</b> ${esc(p.parents.map(id=>personName(id)+((p.adopted_parents||[]).includes(id)?' · '+t('adoption'):'' )).join(', ')||t('none'))}</p><p><b>${esc(t('partners'))}:</b> ${esc((p.partners||[]).map(x=>personName(x.person_id)+' · '+kin(tree.people.find(person=>person.id===x.person_id),x.kind)).join(', ')||t('none'))}</p><p><b>${esc(t('linkedProfile'))}:</b> ${esc(p.profile_id?name(p.profile_id):t('none'))}</p><p>${esc(p.notes||t('noNotes'))}</p>`}
    function reviews(){
      const rows=tree.proposals;
      const box=panel(t('reviews'),`<p class="ft-muted">${esc(t(admin()?'reviewHint':'myProposals'))}</p>${rows.length?rows.map(p=>`<article class="ft-review" data-proposal="${p.id}"><header><strong>${esc(t(p.action))} · ${esc((p.after_data||p.before_data)?.name||personName(p.person_id))}</strong><span class="ft-status">${esc(t(p.status))}</span></header><p class="ft-muted">${esc(name(p.author_id))} · ${esc(new Date(p.created_at).toLocaleString(lang))}</p>${p.note?`<p>${esc(p.note)}</p>`:''}<details ${p.status==='pending'?'open':''}><summary>${esc(t('changes'))}</summary><div class="ft-diff"><div><strong>${esc(t('before'))}</strong>${snapshot(p.before_data)}</div><div><strong>${esc(t('after'))}</strong>${snapshot(p.after_data)}</div></div></details>${p.reviewer_id?`<p class="ft-muted">${esc(t('reviewedBy'))}: ${esc(name(p.reviewer_id))}</p>`:''}${p.review_note?`<p>${esc(p.review_note)}</p>`:''}${admin()&&p.status==='pending'?`<label><small>${esc(t('reviewNote'))}</small><textarea data-review-note maxlength="2000" style="display:block;width:100%;min-height:55px"></textarea></label><div class="ft-actions">${button('approve','data-decision="approve"','ft-primary')}${button('reject','data-decision="reject"')}</div>`:''}</article>`).join(''):`<p>${esc(t('noProposals'))}</p>`}`);
      box.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>run(async()=>{const article=b.closest('[data-proposal]');await api('/trees/'+tree.id+'/proposals/'+article.dataset.proposal+'/review','POST',{decision:b.dataset.decision,note:article.querySelector('[data-review-note]').value});await reload();reviews();toast(t('saved'))},b));
    }
    async function start(){const expected=generation;starting=true;if(!token){app.innerHTML='<div class="ft-empty"><div>'+esc(t('unauthorized'))+'</div></div>';return}app.innerHTML='<div class="ft-empty"><div>'+esc(t('loading'))+'</div></div>';try{const preference=await api('/preferences');if(expected!==generation)return;viewMode=preference.view_mode;const features=await api('/features');if(expected!==generation)return;statisticsAvailable=features.statistics;await refreshList();if(trees.length)await openTree(trees[0].id);else render()}catch(e){if(expected!==generation)return;render();toast(e.message)}finally{if(expected===generation)starting=false}}
    const language=e=>{lang=e.detail||window.mvmOS?.lang||'en';if(starting||!token)return;close();render()};window.addEventListener('i18n-loaded',language);
    const sessionChanged=()=>{const next=localStorage.getItem('apphub_token');if(next===token)return;token=next;generation++;loading++;detailTrail=[];detailOriginFocus=null;tree=null;trees=[];viewMode='tree';statisticsAvailable=false;close();start()};
    const storage=e=>{if(e.key==='apphub_token')sessionChanged()};window.addEventListener('storage',storage);
    window.addEventListener('apphub_login',sessionChanged);window.addEventListener('apphub_logout',sessionChanged);
    const observer=new MutationObserver(()=>{if(!app.isConnected){disposed=true;close();observer.disconnect();resize.disconnect();window.removeEventListener('i18n-loaded',language);window.removeEventListener('storage',storage);window.removeEventListener('apphub_login',sessionChanged);window.removeEventListener('apphub_logout',sessionChanged)}});observer.observe(document.body,{childList:true,subtree:true});
    start();
  }};
})();
