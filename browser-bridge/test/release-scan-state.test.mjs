import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseScanState} from '../src/release-scan-state.mjs';
test('499 preserves live evidence and reports validator abort while scan runs',()=>{
 const result=releaseScanState({scanId:'a',scan:{res:{status:499}},live:{scanId:'a',active:true,status:'running',evidence:[{platform:'X'},{platform:'TikTok'}]}});
 assert.equal(result.outcome,'validator-aborted');assert.equal(result.running,true);assert.equal(result.counts.evidence,2);
});
test('timeout recovers ledger totals and never uses another scan',()=>{
 const result=releaseScanState({scanId:'a',timedOut:true,live:{scanId:'b',evidence:[]},ledger:{scans:[{id:'a',status:'failed',usableEvidence:64,platformCounts:{X:2,TikTok:62}}]}});
 assert.equal(result.outcome,'validator-timeout');assert.equal(result.counts.evidence,64);assert.equal(result.counts.tiktok,62);
 assert.equal(releaseScanState({scanId:'a',live:{scanId:'b',evidence:[]}}).counts.evidence,null);
});
test('true zero and internal failure remain distinct',()=>{
 assert.equal(releaseScanState({scanId:'a',live:{scanId:'a',active:false,status:'zero',evidence:[]}}).outcome,'scan-zero-evidence');
 assert.equal(releaseScanState({scanId:'a',live:{scanId:'a',active:false,status:'failed',evidence:[]}}).outcome,'scan-failed-internally');
});
