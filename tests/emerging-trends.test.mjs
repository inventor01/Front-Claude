import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync(new URL('../app/front-live-shell.tsx',import.meta.url),'utf8');
const emerging=fs.readFileSync(new URL('../app/emerging-trends.tsx',import.meta.url),'utf8');
const evidenceRoute=fs.readFileSync(new URL('../app/api/browser-evidence/route.ts',import.meta.url),'utf8');

test('scan UI shows display-only emerging signals without weakening dashboard promotion',()=>{
  assert.match(shell,/buildEmergingSignals\(live\?\.evidence\|\|\[\],live\?\.inferredTopics\|\|\[\],24\)/);
  assert.match(shell,/<EmergingTrends topics=\{topics\}/);
  assert.match(shell,/saveLive\(fresh,next\.inferredTopics\|\|\[\],scanAt\)/);
  assert.doesNotMatch(shell,/saveLive\(fresh,topics/);
  assert.match(evidenceRoute,/if\(evidenceCount<2\|\|authorCount<2\)continue/);
  assert.match(evidenceRoute,/if\(tier==='candidate'&&row\.corroborated!==true\)continue/);
});

test('emerging trend strip supports WATCH EARLY RISING and QUALIFIED states',()=>{
  assert.match(emerging,/semanticNarrativeKey/);
  assert.match(emerging,/postUnderstandingConfidence/);
  assert.match(emerging,/confidence<0\.5/);
  assert.match(emerging,/specificNarrativeTerms/);
  assert.match(emerging,/return 'WATCH'/);
  assert.match(emerging,/return 'EARLY'/);
  assert.match(emerging,/return 'RISING'/);
  assert.match(emerging,/return 'QUALIFIED'/);
  assert.match(emerging,/visible=topics\.slice\(0,10\)/);
  assert.match(emerging,/only QUALIFIED reaches the dashboard/);
});

test('weak scan signals remain inspectable but cannot self-promote',()=>{
  assert.match(emerging,/tier:prior\?\.tier\|\|'pre-breakout'/);
  assert.match(emerging,/corroborated:prior\?\.corroborated===true/);
  assert.match(emerging,/evidenceCount:Math\.max/);
  assert.match(emerging,/authorCount:Math\.max/);
  assert.match(shell,/Not promoted yet/);
  assert.match(shell,/No narrative qualified yet/);
});
