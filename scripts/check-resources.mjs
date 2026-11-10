import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync('module.json','utf8')).scenario_tests;
for(const [id,entries]of Object.entries(manifest)){assert.ok(entries.length,id);for(const ref of entries){const [file,name]=ref.split('#');assert.ok(fs.readFileSync(file,'utf8').includes(name),ref)}}
console.log(`PASS: ${Object.keys(manifest).length} resource client scenarios`);
