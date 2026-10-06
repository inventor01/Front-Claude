import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifierInternals } from '../src/market-verifier.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));

test('market verifier parsers preserve exact identifiers and money',()=>{
  const x=verifierInternals.normalizedInput({title:'Floris Cefiro',brand:'Floris London',gtin:'886266091149'});
  assert.equal(x.basis,'gtin');
  assert.equal(x.strict,true);
  assert.equal(verifierInternals.money('US $59.99'),59.99);
  assert.equal(verifierInternals.shippingAmount('Free shipping'),0);
  assert.equal(verifierInternals.shippingAmount('+$8.45 shipping'),8.45);
});

test('quantiles and title overlap are conservative and deterministic',()=>{
  assert.equal(verifierInternals.quantile([10,20,30,40],.5),25);
  assert.equal(verifierInternals.quantile([10,20,30,40],.25),17.5);
  assert.ok(verifierInternals.overlap('Floris Cefiro Eau de Toilette','Floris London Cefiro Eau de Toilette Spray')>.6);
});

test('server-v25 syntax remains valid after market verifier route is wired',()=>{
  const p=path.join(here,'..','src','server-v25.mjs');
  const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});
