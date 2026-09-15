import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ledger=fs.readFileSync(new URL('../app/settings/ledger/ledger-client.tsx',import.meta.url),'utf8');
const scanLedger=fs.readFileSync(new URL('../browser-bridge/src/scan-ledger-v26.mjs',import.meta.url),'utf8');

test('ledger UI exposes persisted scan signal states and transcript coverage',()=>{
  assert.match(scanLedger,/scanSignals/);
  assert.match(scanLedger,/scanSignalCounts/);
  assert.match(scanLedger,/transcriptEvidence/);
  assert.match(ledger,/Scan signals/);
  assert.match(ledger,/WATCH/);
  assert.match(ledger,/RISING/);
  assert.match(ledger,/Transcript evidence/);
});
