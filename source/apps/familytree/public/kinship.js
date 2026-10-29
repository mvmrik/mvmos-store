(function(root){
  'use strict';
  // Relations use only the authorized people in the current view. Names never identify people.
  function graph(people){
    const nodes=new Map(people.filter(p=>!p.redacted).map(p=>[p.id,p]));
    const edges=new Map([...nodes.keys()].map(id=>[id,[]]));
    const add=(a,b,kind)=>{if(edges.has(a)&&edges.has(b)&&!edges.get(a).some(e=>e.id===b&&e.kind===kind))edges.get(a).push({id:b,kind})};
    for(const p of nodes.values()){
      for(const id of p.parents||[]){add(p.id,id,'parent');add(id,p.id,'child')}
      for(const link of p.partners||[]){add(p.id,link.person_id,link.kind);add(link.person_id,p.id,link.kind)}
    }
    return {nodes,edges};
  }
  function ancestors(g,id){
    const found=new Map([[id,{distance:0,path:[]}]]),queue=[id];
    for(let i=0;i<queue.length;i++)for(const edge of g.edges.get(queue[i])||[]){
      if(edge.kind!=='parent'||found.has(edge.id))continue;
      const prior=found.get(queue[i]);found.set(edge.id,{distance:prior.distance+1,path:[...prior.path,edge]});queue.push(edge.id);
    }
    return found;
  }
  function relationships(people,selected){
    const g=graph(people),result=new Map();if(!g.nodes.has(selected))return result;
    const a=ancestors(g,selected),paths=new Map([[selected,[]]]),queue=[selected];
    // Breadth-first search gives a readable connection path even for distant relatives by marriage.
    for(let i=0;i<queue.length;i++)for(const edge of g.edges.get(queue[i])||[])if(!paths.has(edge.id)){
      paths.set(edge.id,[...paths.get(queue[i]),edge]);queue.push(edge.id);
    }
    for(const target of g.nodes.values()){
      const path=paths.get(target.id);let relation={key:'unrelated',path:[]};
      if(target.id===selected)relation={key:'selectedPerson',path:[]};
      else if(path){
        relation={key:'connectionPath',path};
        const direct=(g.edges.get(selected)||[]).find(e=>e.id===target.id);
        if(direct)relation={key:direct.kind,path:[direct]};
        else {
          const b=ancestors(g,target.id);let common=null;
          for(const [id,up] of a){const down=b.get(id);if(!down)continue;const score=up.distance+down.distance;
            if(!common||score<common.score||(score===common.score&&Math.max(up.distance,down.distance)<Math.max(common.up,common.down)))common={score,up:up.distance,down:down.distance,a:up.path,b:down.path};
          }
          if(common){
            const {up,down}=common;const bloodPath=[...common.a,...common.b.slice().reverse().map((e,i,arr)=>({id:i===arr.length-1?target.id:arr[i+1].id,kind:'child'}))];
            // A shorter marriage connection takes precedence over a distant common ancestor.
            if(common.score<=path.length||path.every(e=>['parent','child'].includes(e.kind))){
              if(down===0)relation={key:up===2?'grandparent':'ancestor',generations:up,path:bloodPath};
              else if(up===0)relation={key:down===2?'grandchild':'descendant',generations:down,path:bloodPath};
              else if(up===1&&down===1){
                const own=g.nodes.get(selected).parents||[],other=target.parents||[];
                const shared=own.filter(id=>other.includes(id)).length;
                relation={key:shared===1&&own.length===2&&other.length===2?'halfSibling':'sibling',path:bloodPath};
              } else if(up===2&&down===1)relation={key:'auntUncle',path:bloodPath};
              else if(up===1&&down===2)relation={key:'nieceNephew',path:bloodPath};
              else if(up===down)relation={key:'cousin',degree:up-1,path:bloodPath};
              else relation={key:'connectionPath',path:bloodPath};
            }
          }
        }
      }
      result.set(target.id,{...relation,gender:target.gender||'unknown'});
    }
    return result;
  }
  function birthOrder(a,b){
    if(!a||!b)return 0;
    if(a.birth_date&&b.birth_date)return a.birth_date<b.birth_date?-1:a.birth_date>b.birth_date?1:0;
    if(a.birth_year&&b.birth_year&&a.birth_year!==b.birth_year)return a.birth_year<b.birth_year?-1:1;
    return 0;
  }
  // Return only a conventional, supported kinship label. An empty key hides
  // an ambiguous or unsupported relationship instead of displaying a path.
  function labelKey(relation,person,people,selected,lang){
    if(!relation||!person||person.redacted)return '';
    const key=relation.key,sex=person.gender||'unknown';
    if(['connectionPath','unrelated'].includes(key))return '';
    if(key==='selectedPerson')return '';
    const nodes=new Map(people.map(p=>[p.id,p]));
    const path=relation.path||[],first=nodes.get(path[0]?.id),origin=nodes.get(selected);
    if(key==='ancestor'||key==='descendant')return '';
    if(sex==='unknown'&&!['parent','child','partner','spouse','former_partner','former_spouse'].includes(key))return '';
    if(lang==='bg'&&key==='auntUncle'){
      if(sex==='female')return 'aunt';
      return first?.gender==='male'?'paternalUncle':first?.gender==='female'?'maternalUncle':'';
    }
    if(lang==='ja'&&['sibling','halfSibling'].includes(key)){
      if(key==='halfSibling')return '';
      const order=birthOrder(person,origin);if(!order)return '';
      return sex==='male'?(order<0?'elderBrother':'youngerBrother'):(order<0?'elderSister':'youngerSister');
    }
    if(lang==='zh-CN'){
      if(key==='halfSibling'||key==='cousin')return '';
      if(key==='sibling'){
        const order=birthOrder(person,origin);if(!order)return '';
        return sex==='male'?(order<0?'elderBrother':'youngerBrother'):(order<0?'elderSister':'youngerSister');
      }
      if(key==='grandparent'){
        if(!['male','female'].includes(first?.gender))return '';
        return (first.gender==='male'?'paternal':'maternal')+(sex==='male'?'Grandfather':'Grandmother');
      }
      if(key==='grandchild'){
        if(!['male','female'].includes(first?.gender))return '';
        return (first.gender==='male'?'sons':'daughters')+(sex==='male'?'Grandson':'Granddaughter');
      }
      if(key==='auntUncle'){
        if(first?.gender==='female')return sex==='male'?'maternalUncle':'maternalAunt';
        if(first?.gender!=='male')return '';
        if(sex==='female')return 'paternalAunt';
        const order=birthOrder(person,first);return order<0?'elderPaternalUncle':order>0?'youngerPaternalUncle':'';
      }
      if(key==='nieceNephew'){
        const sibling=nodes.get(path[1]?.id);if(!['male','female'].includes(sibling?.gender))return '';
        return (sibling.gender==='male'?'brothers':'sisters')+(sex==='male'?'Nephew':'Niece');
      }
    }
    if(key==='cousin')return relation.degree===1?(sex==='male'?'firstCousinMale':'firstCousinFemale'):'';
    return termKey(key,sex);
  }
  function termKey(key,sex){
    const variants={parent:['father','mother','parent'],child:['son','daughter','child'],grandparent:['grandfather','grandmother'],grandchild:['grandson','granddaughter'],sibling:['brother','sister'],halfSibling:['halfBrother','halfSister'],auntUncle:['uncle','aunt'],nieceNephew:['nephew','niece'],partner:['partnerMale','partnerFemale','partner'],former_partner:['formerPartnerMale','formerPartnerFemale','former_partner'],spouse:['husband','wife','spouse'],former_spouse:['formerHusband','formerWife','former_spouse']};
    return variants[key]?variants[key][sex==='male'?0:sex==='female'?1:2]||'':key;
  }
  const api={relationships,graph,labelKey,termKey};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FamilyTreeKinship=api;
})(typeof window!=='undefined'?window:globalThis);
