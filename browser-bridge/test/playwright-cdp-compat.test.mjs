import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import '../src/playwright-cdp-compat.mjs';

test('Front wraps connectOverCDP with the noDefaults compatibility option',()=>{
  assert.equal(chromium.connectOverCDP.frontCdpNoDefaults,true);
});
