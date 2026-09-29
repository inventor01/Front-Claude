import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const logic=fs.readFileSync(new URL('../lib/commerce-intelligence.ts',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../app/api/commerce-intel/route.ts',import.meta.url),'utf8');

test('commerce intelligence never represents social signal as launch approval',()=>{
  assert.match(logic,/SIGNAL_ONLY/);
  assert.match(logic,/EARLY_CANDIDATE/);
  assert.match(logic,/not product verification/i);
  assert.match(route,/launchAuthority:false/);
  assert.match(route,/supplier viability/);
  assert.match(route,/gross margin/);
  assert.match(route,/IP\/trademark/);
});

test('commerce classifier requires evidence before early candidate state',()=>{
  assert.match(logic,/creators\.size>=2/);
  assert.match(logic,/purchaseIntentMentions>0\|\|creativePatterns\.length>0/);
  assert.match(logic,/purchaseIntentMentions/);
  assert.match(logic,/creativePatterns/);
  assert.match(logic,/evidenceCount/);
});

test('commerce API reuses authenticated Front evidence instead of public fake data',()=>{
  assert.match(route,/getChatGPTUser/);
  assert.match(route,/FROM topic_snapshots/);
  assert.match(route,/FROM evidence e/);
  assert.match(route,/observations/);
  assert.match(route,/owner=\?/);
  assert.doesNotMatch(route,/Math\.random/);
});

test('commerce API keeps a bounded recent intelligence window',()=>{
  assert.match(route,/48\*3600000/);
  assert.match(route,/LIMIT 4000/);
  assert.match(route,/Math\.min\(50/);
});


test('commerce service integration requires a server-side key and fixed evidence owner',()=>{
  assert.match(route,/x-front-commerce-key/);
  assert.match(route,/FRONT_COMMERCE_API_KEY/);
  assert.match(route,/FRONT_COMMERCE_OWNER_ID/);
  assert.match(route,/serviceAuthorized/);
  assert.match(route,/authMode:interactiveUser\?'user':'service'/);
  assert.doesNotMatch(route,/ownerId=params/);
});
