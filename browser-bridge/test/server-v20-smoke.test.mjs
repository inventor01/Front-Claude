import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

async function waitJson(url,{timeoutMs=15000}={}){
  const started=Date.now();
  let last;
  while(Date.now()-started<timeoutMs){
    try{const response=await fetch(url,{cache:'no-store'});if(response.ok)return await response.json();last=new Error(`HTTP ${response.status}`);}catch(error){last=error;}
    await sleep(100);
  }
  throw last||new Error(`Timed out waiting for ${url}`);
}

test('v20 exposes live dashboard state and preserves the v19 ledger',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'front-v20-smoke-'));
  const port=44401;
  const proc=spawn(process.execPath,[new URL('../src/launcher-v20.mjs',import.meta.url).pathname],{
    env:{
      ...process.env,
      FRONT_BRIDGE_PORT:String(port),
      FRONT_BRIDGE_V19_PORT:'44409',
      FRONT_BRIDGE_V18_PORT:'44416',
      FRONT_BRIDGE_V17_PORT:'44419',
      FRONT_BRIDGE_INTERNAL_PORT:'44422',
      FRONT_BRIDGE_CDP_PORT:'44402',
      FRONT_BRIDGE_DATA:root,
      FRONT_CONTENT_PROVIDER:'off',
    },
    stdio:['ignore','pipe','pipe'],
  });
  let logs='';
  proc.stdout.on('data',(chunk)=>{logs+=chunk.toString();});
  proc.stderr.on('data',(chunk)=>{logs+=chunk.toString();});
  t.after(async()=>{
    if(proc.exitCode===null){proc.kill('SIGTERM');await Promise.race([new Promise((resolve)=>proc.once('exit',resolve)),sleep(4000)]);}
    fs.rmSync(root,{recursive:true,force:true});
  });

  const health=await waitJson(`http://127.0.0.1:${port}/health`);
  assert.equal(health.version,20,logs);
  assert.equal(health.scanner,'viral-narrative-content-scout-v20',logs);
  assert(health.capabilities.includes('live-dashboard-stream'),logs);
  assert(health.capabilities.includes('fast-duplicate-preflight'),logs);
  assert.equal(health.liveScan.endpoint,'/live',logs);

  const live=await waitJson(`http://127.0.0.1:${port}/live`);
  assert.equal(live.ok,true,logs);
  assert.equal(live.version,20,logs);
  assert.equal(live.active,false,logs);
  assert.deepEqual(live.evidence,[],logs);

  const ledger=await waitJson(`http://127.0.0.1:${port}/ledger`);
  assert.equal(ledger.ok,true,logs);
  assert.equal(ledger.version,20,logs);
  assert.deepEqual(ledger.scans,[],logs);
  assert.equal(ledger.current,null,logs);
  assert.equal(ledger.live.endpoint,'/live',logs);
});
