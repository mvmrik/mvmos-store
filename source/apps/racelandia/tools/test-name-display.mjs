import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const helper=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(root,'apps/gamehub/public/name-display.js')).toString('base64'));
const rules=JSON.parse(fs.readFileSync(path.join(root,'apps/gamehub/data/name-display.json')));
for(const lang of ['en','bg','ru','ja','zh-CN']){
 const identities=new Map();
 const sample={standings:[{id:'d5-0',name:'Ivan Petrov'},{id:'player',name:'Manager'}],roster:[{id:'d5-0',name:'Ivan Petrov',name_identity:{country:'RU',native_script:'Cyrl',native:'Иван Петров',latin:'Ivan Petrov'}}]};
 helper.formatTree(sample,{lang,rules,identities});
 const expected=['bg','ru'].includes(lang)?'Иван Петров':'Ivan Petrov';
 assert.equal(sample.standings[0].name,expected);assert.equal(sample.roster[0].name,expected);assert.equal(sample.standings[1].name,'Manager');
 const live={race_config:{entries:[{id:'d5-0',name:'Ivan Petrov'}]},timing_field:[{id:'d5-0',name:'Ivan Petrov'}],weekend:{classification:[{id:'d5-0',name:'Ivan Petrov'}]}};
 helper.formatTree(live,{lang,rules,identities});assert.equal(live.race_config.entries[0].name,expected);assert.equal(live.timing_field[0].name,expected);assert.equal(live.weekend.classification[0].name,expected);
 const legacy={roster:[{id:'d5-0',name:'Legacy Driver',name_identity:null}]};helper.formatTree(legacy,{lang,rules,identities});assert.equal(legacy.roster[0].name,'Legacy Driver');assert(!identities.has('d5-0'));
}
const ownIdentity={country:'BG',native_script:'Cyrl',native:'Иван Иванов',latin:'Ivan Ivanov'};
const aliases=new Map();
helper.formatTree({slots:[{key:'player',pilot_id:'own-driver',name:'Ivan Ivanov',name_identity:ownIdentity}],history:[{id:'player',name:'Historical Driver',name_identity:{native:'Historical Driver',latin:'Historical Driver',native_script:'Latn'}}]},{lang:'bg',rules,identities:aliases});
assert.equal(aliases.get('player'),ownIdentity);assert.equal(aliases.get('own-driver'),ownIdentity);
assert.equal(helper.countryFlag(aliases.get('player').country),'🇧🇬');
assert.equal(helper.displayName({...ownIdentity,custom_name:'My Champion'},'ru',rules),'My Champion');
console.log('PASS: shared formatter covers rival lists, standings, race entries, live timing and results in five languages; player names and legacy careers stay unchanged.');
