import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Import as data modules so the test needs no package.json or browser globals.
const moduleAt=async path=>import('data:text/javascript;base64,'+readFileSync(root+path).toString('base64'));
const {generatePerson}=await moduleAt('gamehub/public/name-generator.js');
const {displayName}=await moduleAt('gamehub/public/name-display.js');
const source=`import sys,json
sys.path.insert(0,'apps/gamehub/tools')
from name_service_fixture import install,connect
hub=install()
with connect() as c:
 c.execute("CREATE TABLE IF NOT EXISTS name_catalog_custom (id INTEGER PRIMARY KEY, country TEXT, category TEXT, native TEXT, latin TEXT)")
 c.execute("INSERT INTO name_catalog_custom(country,category,native,latin) VALUES('BG','female_first','Пробноиме','Testname')")
 c.commit()
print(json.dumps(dict(catalogue=hub.name_catalogue(),rules=hub.name_display_rules())))`;
const {catalogue,rules}=JSON.parse(execFileSync('venv/bin/python',['-c',source],{encoding:'utf8'}));
for(const country of Object.keys(catalogue)){
 for(const row of catalogue[country].groups.male_last){
  const father=generatePerson(catalogue,{country,gender:'male'});
  father.family_names=row.family_names;
  const mother=generatePerson(catalogue,{gender:'female',family:father});
  assert.equal(mother.country,country);assert.deepEqual(mother.family_names,father.family_names);
  for(const gender of ['male','female']){
   const child=generatePerson(catalogue,{gender,family:mother});
   assert.equal(child.country,country);assert.equal(child.gender,gender);
   assert.deepEqual(child.family_names,father.family_names);
   const surname=row.family_names[gender];assert(child.native.includes(surname.native));assert(child.latin.includes(surname.latin));
   const restored=JSON.parse(JSON.stringify(child));assert.deepEqual(restored,child);
   const english=displayName(restored,'en',rules);
   assert.equal(english,child.native_script==='Latn'?child.native:child.latin);
   assert.equal(displayName(restored,catalogue[country].language,rules),child.native);
   if(country==='BG'||country==='RU')for(const language of ['bg','ru'])assert.equal(displayName(restored,language,rules),child.native);
  }
 }
}
const custom=generatePerson(catalogue,{country:'BG',gender:'female',random:()=>.99999});
assert.equal(custom.given_name.latin,'Testname');
const countries=new Set();for(let i=0;i<1000;i++)countries.add(generatePerson(catalogue).country);
assert.equal(countries.size,9);
console.log('PASS: 900 families, sons/daughters, three generations, native/Latin display, custom names and international generation');
