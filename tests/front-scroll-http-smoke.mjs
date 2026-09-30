import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {rmSync} from 'node:fs';

const dir='/tmp/front-remote-scroll-ci';
const port='18980',base='http://127.0.0.1:'+port;
const service=randomBytes(32).toString('hex'),bridge=randomBytes(32).toString('hex');
const env={...process.env,PORT:port,FRONT_PERSIST_DIR:dir,
 FRONT_STANDALONE_USER_ID:'front-ci-user',
 FRONT_COMMERCE_API_KEY:service,FRONT_BRIDGE_API_KEY:bridge,
 FRONT_SETTINGS_KEY:''};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',body=null,role='service'){
 const headers={'content-type':'application/json'};
 if(role==='service')headers['x-front-commerce-key']=service;
 if(role==='bridge')headers['x-front-bridge-key']=bridge;
 const response=await fetch(base+route,{method,headers,body:body===null?undefined:JSON.stringify(body)});
 const data=await response.json();
 return {status:response.status,data};
}
test('Front scroll queue HTTP contract', {timeout:120000},async()=>{
 rmSync(dir,{recursive:true,force:true});
 const migrated=spawnSync(process.execPath,['scripts/migrate-local.mjs'],{env,timeout:45000,encoding:'utf8'});
 assert.equal(migrated.status,0,migrated.stderr?.slice(-1200));
 const child=spawn(process.execPath,['scripts/start-server.mjs'],{env,stdio:'ignore'});
 try{
   let ready=false;
   for(let i=0;i<100;i++){
     try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
     await sleep(250);
   }
   assert.ok(ready,'Front runtime health failed');
   assert.equal((await api('/api/agent/capabilities','GET',null,'none')).status,401);
   const payload={requestId:'ci-research',objective:'hoodie patterns',
     mode:'scout',platforms:['Instagram'],keywords:['hoodie'],
     targetUniqueFeedItems:12,maxSeconds:40};
   const first=await api('/api/agent/scroll-jobs','POST',payload);
   const again=await api('/api/agent/scroll-jobs','POST',payload);
   assert.equal(first.status,201,JSON.stringify(first.data));
   assert.equal(first.data.id,again.data.id);
   assert.equal(again.data.deduplicated,true);
   const heartbeat={bridgeId:'ci-local',label:'CI bridge',busy:false,
     capabilities:{supportedPlatforms:['Instagram'],chromeReady:true}};
   const claim=await api('/api/agent/bridge/claim','POST',heartbeat,'bridge');
   assert.equal(claim.data.job?.id,first.data.id);
   assert.equal((await api('/api/agent/bridge/claim','POST',heartbeat,'bridge')).data.job,null);
   const leaseId=claim.data.job.leaseId,id=first.data.id;
   const result=await api('/api/agent/bridge/jobs/'+id+'/heartbeat','POST',{
     bridgeId:'ci-local',leaseId,status:'SCROLLING',observedCount:1,
     platformCounts:{Instagram:1},capabilities:heartbeat.capabilities
   },'bridge');
   assert.equal(result.status,200);
   const evidence={id:'post-ci',platform:'Instagram',author:'tester',
     url:'https://www.instagram.com/p/CiAbc123/?utm_source=unit',content:'Hoodie sample'};
   for(let i=0;i<2;i++){
     assert.equal((await api('/api/agent/bridge/jobs/'+id+'/evidence','POST',{
       bridgeId:'ci-local',leaseId,evidence:[evidence]
     },'bridge')).status,200);
   }
   assert.equal((await api('/api/agent/bridge/jobs/'+id+'/complete','POST',{
     bridgeId:'ci-local',leaseId,status:'COMPLETED',result:{status:'complete'}
   },'bridge')).status,200);
   const finished=await api('/api/agent/scroll-jobs/'+id);
   assert.equal(finished.data.status,'COMPLETED');
   assert.equal(finished.data.evidence.length,1);
   assert.equal(finished.data.evidence[0].url,'https://www.instagram.com/p/CiAbc123/');
   const queued=await api('/api/agent/scroll-jobs','POST',{...payload,requestId:'ci-cancelled'});
   const cancelled=await api('/api/agent/scroll-jobs/'+queued.data.id+'/cancel','POST');
   assert.equal(cancelled.data.status,'CANCELLED');
 }finally{
   child.kill('SIGTERM');
   await sleep(500);
   rmSync(dir,{recursive:true,force:true});
 }
});