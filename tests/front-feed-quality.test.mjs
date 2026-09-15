import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/front-feed/route.ts',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../app/front-live-shell.tsx',import.meta.url),'utf8');
const emerging=fs.readFileSync(new URL('../app/emerging-trends.tsx',import.meta.url),'utf8');
const evidenceRoute=fs.readFileSync(new URL('../app/api/browser-evidence/route.ts',import.meta.url),'utf8');

test('undated posts are not assigned a fake publish time from first_seen',()=>{
  assert.doesNotMatch(source,/row\.published\s*\|\|\s*row\.first_seen/);
  assert.match(source,/published=numericOrNull\(row\.published\)/);
});

test('hot thresholds remain tied to a real age or measured snapshot velocity',()=>{
  assert.match(source,/views!=null&&ageHours!=null&&views>=100000&&ageHours<=6/);
  assert.match(source,/snapshotViews=numericOrNull\(row\.viewsPerMinute\)/);
  assert.match(source,/snapshotLikes=numericOrNull\(row\.likesPerMinute\)/);
});

test('undated-post velocity comes from two stored metric observations',()=>{
  assert.match(source,/SELECT id,observed,views,likes FROM observations/);
  assert.match(source,/if\(list\.length<2\)/);
  assert.match(source,/elapsed<60000\|\|elapsed>24\*3600000/);
  assert.match(source,/latestViews>=previousViews/);
  assert.match(source,/latestLikes>=previousLikes/);
  assert.match(source,/observedVelocity\.get\(e\.evidence_id\)/);
});

test('scan can expose emerging signals without weakening the canonical dashboard gate',()=>{
  assert.match(shell,/buildEmergingSignals\(live\?\.evidence\|\|\[\],live\?\.inferredTopics\|\|\[\],24\)/);
  assert.match(shell,/<EmergingTrends topics=\{topics\}/);
  assert.match(shell,/saveLive\(fresh,next\.inferredTopics\|\|\[\],scanAt\)/);
  assert.doesNotMatch(shell,/saveLive\(fresh,topics/);
  assert.match(evidenceRoute,/if\(evidenceCount<2\|\|authorCount<2\)continue/);
  assert.match(evidenceRoute,/if\(tier==='candidate'&&row\.corroborated!==true\)continue/);
});

test('emerging scan strip has bounded WATCH EARLY RISING and QUALIFIED states',()=>{
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
