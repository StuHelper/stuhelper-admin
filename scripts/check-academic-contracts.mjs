import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stuhelper-admin-academic-'));
try{
  for(const module of ['catalog','reviews','moderation']){
    const source=JSON.parse(fs.readFileSync(`contracts/${module}.source.json`,'utf8'));
    assert.equal(source.repository,`StuHelper/stuhelper-${module}`);
    assert.match(source.revision,/^[0-9a-f]{40}$/);
    const contract=`contracts/${module}.openapi.json`; const generated=`apps/web-antd/src/api/${module}.gen.ts`;
    assert.equal(source.version,JSON.parse(fs.readFileSync(contract,'utf8')).info.version);
    for(const file of [contract,generated])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),source.sha256[file]);
    const output=path.join(temp,`${module}.gen.ts`);
    execFileSync('pnpm',['--dir','scripts/openapi','exec','openapi-typescript',path.resolve(contract),'-o',output],{stdio:'inherit'});
    assert.equal(fs.readFileSync(output,'utf8'),fs.readFileSync(generated,'utf8'));
  }
  console.log('PASS: academic source records, digests and generated types');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
