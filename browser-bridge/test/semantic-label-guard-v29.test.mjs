import test from 'node:test';
import assert from 'node:assert/strict';
import { isInternalSemanticLabel, preferSpecificSemanticLabel } from '../src/semantic-label-guard-v29.mjs';
import { buildScanSignals, qualifiesScanSignal } from '../src/scan-signals-v26.mjs';

test('internal semantic metadata labels are blocked without blocking real topics', () => {
  for (const label of ['meaning','subject','event','analysis','semantic meaning','content analysis','post subject']) {
    assert.equal(isInternalSemanticLabel(label), true, label);
  }
  for (const label of ['DeJon Love','DeJon Love meme','snake bite reaction','meaning of life']) {
    assert.equal(isInternalSemanticLabel(label), false, label);
  }
  assert.equal(preferSpecificSemanticLabel('meaning','DeJon Love meme'),'DeJon Love meme');
});

test('scan signals never qualify an internal semantic label', () => {
  assert.equal(qualifiesScanSignal({topic:'meaning',key:'meaning',tier:'candidate',corroborated:true,evidenceCount:4,authorCount:4}),false);
});

test('semantic evidence replaces a stale meaning topic with the concrete subject', () => {
  const evidence = [
    {id:'1',author:'a',platform:'TikTok',postSubject:'DeJon Love meme',postEvent:'reaction clip reused',semanticNarrativeKey:'dejon love meme',postUnderstandingConfidence:.94,content:'DeJon Love meme reaction'},
    {id:'2',author:'b',platform:'X',postSubject:'DeJon Love meme',postEvent:'reaction clip reused',semanticNarrativeKey:'dejon love meme',postUnderstandingConfidence:.92,content:'DeJon Love meme reaction'},
    {id:'3',author:'c',platform:'TikTok',postSubject:'DeJon Love meme',postEvent:'reaction clip reused',semanticNarrativeKey:'dejon love meme',postUnderstandingConfidence:.9,content:'DeJon Love meme reaction'},
  ];
  const inferred = [{topic:'meaning',key:'dejon love meme',tier:'candidate',corroborated:true,evidenceCount:3,authorCount:3,platforms:['TikTok','X'],evidenceIds:['1','2','3'],score:78}];
  const signals = buildScanSignals(evidence,inferred);
  assert.ok(signals.length > 0);
  assert.equal(signals[0].topic,'DeJon Love meme');
  assert.notEqual(signals[0].topic.toLowerCase(),'meaning');
  assert.equal(signals[0].scanStatus,'QUALIFIED');
});

test('meaning-only semantic rows are discarded instead of rendered', () => {
  const evidence = [
    {id:'1',author:'a',platform:'TikTok',postSubject:'meaning',semanticNarrativeKey:'meaning',postUnderstandingConfidence:.99,content:'meaning meaning'},
    {id:'2',author:'b',platform:'X',postSubject:'meaning',semanticNarrativeKey:'meaning',postUnderstandingConfidence:.99,content:'meaning meaning'},
  ];
  const signals = buildScanSignals(evidence,[{topic:'meaning',key:'meaning',tier:'candidate',corroborated:true,evidenceCount:2,authorCount:2,platforms:['TikTok','X'],evidenceIds:['1','2'],score:90}]);
  assert.equal(signals.some((signal)=>String(signal.topic).toLowerCase()==='meaning'),false);
});
