import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/api/front-feed/route.ts',import.meta.url),'utf8');

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
