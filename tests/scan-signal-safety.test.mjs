import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScanSignals,qualifiesScanSignal} from '../browser-bridge/src/scan-signals-v26.mjs';

test('raw repeated signals can rise but never self-qualify',()=>{
  const evidence=[
    {id:'1',platform:'X',author:'a',content:'fruit fly connectome brain simulation'},
    {id:'2',platform:'TikTok',author:'b',content:'fruit fly connectome brain simulation'},
    {id:'3',platform:'TikTok',author:'c',content:'fruit fly connectome brain simulation'},
  ];
  const signals=buildScanSignals(evidence,[]);
  const signal=signals.find(item=>item.scanStatus==='RISING');
  assert(signal);
  assert.equal(signal.corroborated,false);
  assert.equal(qualifiesScanSignal(signal),false);
});

test('same creator handle across platforms cannot manufacture an early or rising raw signal',()=>{
  const evidence=[
    {id:'1',platform:'X',author:'same',content:'fruit fly connectome brain simulation'},
    {id:'2',platform:'TikTok',author:'@same',content:'fruit fly connectome brain simulation'},
  ];
  const signals=buildScanSignals(evidence,[]);
  assert.equal(signals.some(signal=>['EARLY','RISING','QUALIFIED'].includes(signal.scanStatus)),false);
});
