import test from 'node:test';
import assert from 'node:assert/strict';
import {countScanSignals} from '../browser-bridge/src/scan-signals-v26.mjs';

test('scan signal counts remain stable for ledger rendering',()=>{
 const counts=countScanSignals([{scanStatus:'WATCH'},{scanStatus:'EARLY'},{scanStatus:'RISING'},{scanStatus:'QUALIFIED'},{scanStatus:'RISING'}]);
 assert.deepEqual(counts,{WATCH:1,EARLY:1,RISING:2,QUALIFIED:1});
});
