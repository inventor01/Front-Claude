import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

async function waitJson(url,{timeoutMs=10000}={}){
  const started=Date.now();
  let last;
  while(Date.now()-started<timeoutMs){
    try{
      const response=await fetch(url,{cache:'no-store'});
      if(response.ok)return await response.json();
      last=new Error(`HTTP ${response.status}`);
    }catch(error){last=error;}
    await sleep(100);
  }
  throw last||new Error(`Timed out waiting for ${url}`);
}

test('v18 supervisor exposes health and can hard-stop/restart the scan tree',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'front-v18-supervisor-'));
  const port=44231;
  const v17Port=44241;
  const v16Port=44244;
  const proc=spawn(process.execPath,[new URL('../src/server-v18.mjs',import.meta.url).pathname],{
    env:{
      ...process.env,
      FRONT_BRIDGE_PORT:String(port),
      FRONT_BRIDGE_V17_PORT:String(v17Port),
      FRONT_BRIDGE_INTERNAL_PORT:String(v16Port),
      FRONT_BRIDGE_DATA:root,
      FRONT_CONTENT_PROVIDER:'off',
    },
    stdio:['ignore','pipe','pipe'],
  });
  let logs='';
  proc.stdout.on('data',(chunk)=>{logs+=chunk.toString();});
  proc.stderr.on('data',(chunk)=>{logs+=chunk.toString();});
  t.after(async()=>{
    if(proc.exitCode===null){proc.kill('SIGTERM');await Promise.race([new Promise((resolve)=>proc.once('exit',resolve)),sleep(2500)]);}
    fs.rmSync(root,{recursive:true,force:true});
  });

  const before=await waitJson(`http://127.0.0.1:${port}/health`);
  assert.equal(before.ok,true,logs);
  assert.equal(before.version,18,logs);
  assert.equal(before.scanner,'viral-narrative-content-scout-v18',logs);
  assert(before.capabilities.includes('manual-scan-stop'),logs);
  assert(before.capabilities.includes('zero-result-visual-fallback'),logs);
  assert(before.capabilities.includes('media-without-caption-discovery'),logs);

  const stopResponse=await fetch(`http://127.0.0.1:${port}/stop`,{method:'POST'});
  assert.equal(stopResponse.ok,true,await stopResponse.text());
  const stopped=await stopResponse.json();
  assert.equal(stopped.stopped,true,logs);

  const after=await waitJson(`http://127.0.0.1:${port}/health`,{timeoutMs:10000});
  assert.equal(after.version,18,logs);
  assert.equal(after.gateway.version,18,logs);
  assert(Number(after.gateway.lastStop)>0,logs);
  assert.notEqual(after.running,true,'A fresh supervisor should not inherit the killed scan state.');
});
