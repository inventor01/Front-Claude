import test from 'node:test';import assert from 'node:assert/strict';
import {scanOutcome} from '../src/scan-outcome-v26.mjs';
test('nonempty evidence cannot hide model or collector failures',()=>{
 for(const stage of [{status:'degraded',failed:1},{status:'complete',errors:['renderer failed']}]){
  const outcome=scanOutcome({evidenceCount:20,stages:{model:stage}});assert.equal(outcome.status,'failed');assert.equal(outcome.errors.length,1);
 }
 assert.equal(scanOutcome({evidenceCount:20,stages:{model:{status:'complete',failed:0}}}).status,'complete');
 assert.equal(scanOutcome({stopped:true,evidenceCount:20}).status,'stopped');
});
test('one working platform cannot conceal an empty requested collector',()=>{
 assert.equal(scanOutcome({evidenceCount:10,stages:{xDiscovery:{status:'complete',observed:10},tiktokDiscovery:{status:'complete',observed:0}}}).status,'failed');
 assert.equal(scanOutcome({evidenceCount:10,stages:{xDiscovery:{status:'complete',observed:10},tiktokDiscovery:{status:'disabled',observed:0}}}).status,'complete');
});
