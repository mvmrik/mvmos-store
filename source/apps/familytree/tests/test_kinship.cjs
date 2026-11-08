const assert=require('node:assert/strict');
const {relationships}=require('../public/kinship.js');
const p=(id,parents=[],gender='unknown',partners=[])=>({id,parents,gender,partners});
const people=[p('grandpa',[],'male'),p('grandma',[],'female'),p('dad',['grandpa','grandma'],'male'),p('aunt',['grandpa','grandma'],'female'),p('mum',[],'female',[{person_id:'dad',kind:'spouse'}]),p('self',['dad','mum']),p('sister',['dad','mum'],'female'),p('cousin',['aunt']),p('child',['self']),p('grandchild',['child']),p('greatgrandchild',['grandchild']),p('unrelated'),p('othermum'),p('half',['dad','othermum']),p('spouse',[],'female',[{person_id:'self',kind:'spouse'}]),p('inlaw',[],'male'),p('private')];
people.find(p=>p.id==='spouse').parents=['inlaw'];people.find(p=>p.id==='private').redacted=true;
const r=relationships(people,'self');
for(const [id,key] of Object.entries({self:'selectedPerson',dad:'parent',mum:'parent',grandpa:'grandparent',sister:'sibling',half:'halfSibling',aunt:'auntUncle',cousin:'cousin',child:'child',grandchild:'grandchild',greatgrandchild:'greatGrandchild',spouse:'spouse',inlaw:'parentInLaw',unrelated:'unrelated'}))assert.equal(r.get(id).key,key,id);
assert.equal(r.get('cousin').degree,1);assert.equal(r.get('greatgrandchild').generations,3);assert.equal(r.has('private'),false);
assert.deepEqual(r.get('inlaw').path.map(e=>e.kind),['spouse','parent']);
assert.deepEqual(r.get('cousin').path.map(e=>e.id),['dad','grandpa','aunt','cousin']);
assert.equal(relationships(people,'aunt').get('self').key,'nieceNephew');
assert.equal(relationships(people,'greatgrandchild').get('self').generations,3);
assert.equal(relationships(people,'grandpa').get('self').key,'grandchild');
assert.equal(relationships(people,'missing').size,0);
// Missing parent information does not imply a half-sibling.
assert.equal(relationships([p('a',['parent']),p('b',['parent']),p('parent')],'a').get('b').key,'sibling');
// Equal names do not create connections, and malformed cycles terminate.
assert.equal(relationships([{...p('a'),name:'Same'},{...p('b'),name:'Same'}],'a').get('b').key,'unrelated');
assert.equal(relationships([p('a',['b']),p('b',['a'])],'a').get('b').key,'parent');
console.log('PASS: kinship, cousins, ancestry, half siblings, marriage paths, privacy, identity and cycle handling');

const {labelKey}=require('../public/kinship.js');
const label=(id,lang)=>labelKey(r.get(id),people.find(p=>p.id===id),people,'self',lang);
for(const lang of ['bg','en','de','es','fr','ja','pt-BR','ru','zh-CN']){
  assert.equal(label('self',lang),'');
  assert.equal(label('unrelated',lang),'');
}
assert.equal(label('aunt','bg'),'aunt');
assert.equal(label('cousin','zh-CN'),''); // Unsupported culturally specific cousin distinctions stay hidden.
assert.equal(label('sister','ja'),''); // Unknown birth order cannot choose elder/younger.
const family=[p('root',['father','mother']),p('father',['gf'],'male'),p('mother',['gm'],'female'),p('gf'),p('gm'),p('uncleP',['gf'],'male'),p('uncleM',['gm'],'male')];
const familyRelations=relationships(family,'root');
const familyLabel=(id,lang)=>labelKey(familyRelations.get(id),family.find(p=>p.id===id),family,'root',lang);
assert.equal(familyLabel('uncleP','bg'),'paternalUncle');assert.equal(familyLabel('uncleM','bg'),'maternalUncle');
assert.equal(familyLabel('uncleP','zh-CN'),'');assert.equal(familyLabel('uncleM','zh-CN'),'maternalUncle');
family.find(p=>p.id==='father').birth_year=1970;family.find(p=>p.id==='uncleP').birth_year=1968;
assert.equal(familyLabel('uncleP','zh-CN'),'elderPaternalUncle');
console.log('PASS: no path/unknown labels, Bulgarian uncle sides and conservative Chinese/Japanese labels');

const {termKey}=require('../public/kinship.js');
for(const [relation,male,female,neutral] of [
  ['partner','partnerMale','partnerFemale','partner'],
  ['former_partner','formerPartnerMale','formerPartnerFemale','former_partner'],
  ['spouse','husband','wife','spouse'],
  ['former_spouse','formerHusband','formerWife','former_spouse']
]){
  assert.equal(termKey(relation,'male'),male);
  assert.equal(termKey(relation,'female'),female);
  assert.equal(termKey(relation,'unknown'),neutral);
  assert.equal(labelKey({key:relation,path:[]},p('target',[],'female'),[],'self','bg'),female);
}
console.log('PASS: partner and former-partner labels follow the target gender with neutral unknown fallback');

// Extended kinship: great-ancestors, removed and distant cousins, in-laws and step relatives.
const g=(id,parents=[],gender='unknown',partners=[])=>({id,parents,gender,partners});
const big=[g('gg1',[],'male'),g('gg2',[],'female'),g('g1',['gg1','gg2'],'male'),g('gb',['gg1','gg2'],'male'),g('gbson',['gb'],'male'),g('gbgs',['gbson'],'male'),
 g('p',['g1'],'male'),g('me',['p'],'female'),g('c1',['gbson'],'female'),g('c1r',['gbgs'],'male'),g('sc',['gbgs'],'female'),
 g('w',[],'male',[{person_id:'me',kind:'spouse'}]),g('wf',[],'male'),g('wb',['wf'],'male'),g('sis',['p'],'female'),g('sish',[],'male',[{person_id:'sis',kind:'spouse'}]),
 g('kid',['me'],'male'),g('kidw',[],'female',[{person_id:'kid',kind:'spouse'}]),g('stepmum',[],'female'),g('stepkid',['w'],'female')];
big.find(x=>x.id==='w').parents=['wf'];big.find(x=>x.id==='me').parents=['p'];big.find(x=>x.id==='me').partners=[];
big.find(x=>x.id==='w').partners=[{person_id:'me',kind:'spouse'}];
big.find(x=>x.id==='p').partners=[{person_id:'stepmum',kind:'spouse'}];const br=relationships(big,'me');
const bl=(id,lang='en')=>labelKey(br.get(id),big.find(x=>x.id===id),big,'me',lang);
assert.equal(bl('gg1'),'greatGrandfather');assert.equal(bl('gg2'),'greatGrandmother');
assert.equal(bl('gb'),'grandUncle');
assert.equal(bl('gbson'),'firstCousinMale');
assert.equal(br.get('gbson').key,'cousin');assert.equal(br.get('gbson').removed,1);
assert.equal(bl('gbgs'),'secondCousinMale');assert.equal(br.get('gbgs').removed,0);
assert.equal(bl('sc'),'secondCousinFemale');
assert.equal(bl('wf'),'fatherInLaw');assert.equal(bl('wf','bg'),'inlawFatherHusband');
assert.equal(br.get('wb').key,'spouseSibling');assert.equal(bl('wb'),'brotherInLaw');
assert.equal(bl('sish'),'brotherInLaw');assert.equal(bl('sish','bg'),'inlawSiblingHusband');
assert.equal(bl('kidw'),'daughterInLaw');assert.equal(bl('stepmum'),'stepMother');assert.equal(bl('stepkid'),'stepDaughter');
assert.equal(bl('c1'),'secondCousinFemale');assert.equal(br.get('sc').removed,1);
assert.equal(bl('wf','zh-CN'),'inlawFatherHusband');assert.equal(bl('wb','zh-CN'),'');assert.equal(bl('gg1','zh-CN'),'');assert.equal(bl('gbgs','ja'),'secondCousinMale');
console.log('PASS: extended kinship labels');
assert.equal(bl('gb','bg'),'');assert.equal(bl('stepmum','bg'),'stepMother');
console.log('PASS: uncertain Bulgarian terms stay hidden');
assert.equal(bl('gb','ja'),'');assert.equal(bl('sc','fr'),'secondCousinFemale');assert.equal(bl('gbgs','fr'),'secondCousinMale');
console.log('PASS: uncertain Japanese and French terms stay hidden');
