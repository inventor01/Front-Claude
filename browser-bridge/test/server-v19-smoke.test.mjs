import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

async function waitJson(url,{timeoutMs=12000}={}){
  const started=Date.now();
  let last;
  while(Date.now()-started<timeoutMs){
    try{const response=await fetch(url,{cache:'no-store'});if(response.ok)return await response.json();last=new Error(`HTTP ${response.status}`);}catch(error){last=error;}
    await sleep(100);
  }
  throw last||new Error(`Timed out waiting for ${url}`);
}

test('v19 exposes health and persistent scan ledger endpoints',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'front-v19-smoke-'));
  const port=44301;
  const proc=spawn(process.execPath,[new URL('../src/launcher-v19.mjs',import.meta.url).pathname],{
    env:{
      ...process.env,
      FRONT_BRIDGE_PORT:String(port),
      FRONT_BRIDGE_V18_PORT:'44308',
      FRONT_BRIDGE_V17_PORT:'44311',
      FRONT_BRIDGE_INTERNAL_PORT:'44314',
      FRONT_BRIDGE_CDP_PORT:'44302',
      FRONT_BRIDGE_DATA:root,
      FRONT_CONTENT_PROVIDER:'off',
    },
    stdio:['ignore','pipe','pipe'],
  });
  let logs='';
  proc.stdout.on('data',(chunk)=>{logs+=chunk.toString();});
  proc.stderr.on('data',(chunk)=>{logs+=chunk.toString();});
  t.after(async()=>{
    if(proc.exitCode===null){proc.kill('SIGTERM');await Promise.race([new Promise((resolve)=>proc.once('exit',resolve)),sleep(3000)]);}
    fs.rmSync(root,{recursive:true,force:true});
  });

  const health=await waitJson(`http://127.0.0.1:${port}/health`);
  assert.equal(health.version,19,logs);
  assert.equal(health.scanner,'viral-narrative-content-scout-v19',logs);
  assert(health.capabilities.includes('scan-ledger'),logs);
  assert(health.capabilities.includes('cdp-no-defaults-compat'),logs);

  const ledger=await waitJson(`http://127.0.0.1:${port}/ledger`);
  assert.equal(ledger.ok,true,logs);
  assert.equal(ledger.version,19,logs);
  assert.deepEqual(ledger.scans,[],logs);
  assert.equal(ledger.current,null,logs);
});
