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
  assert.match(source,/snapshotRate=numericOrNull\(row\.viewsPerMinute\)/);
});
