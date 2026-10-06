import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const secrets=fs.readFileSync(new URL('../lib/front-provider-secrets.ts',import.meta.url),'utf8');
const provider=fs.readFileSync(new URL('../app/api/social-arb/provider/route.ts',import.meta.url),'utf8');
const market=fs.readFileSync(new URL('../lib/social-arb-market-data.ts',import.meta.url),'utf8');
const research=fs.readFileSync(new URL('../app/api/social-arb/research/route.ts',import.meta.url),'utf8');
const outcomes=fs.readFileSync(new URL('../app/api/social-arb/outcomes/route.ts',import.meta.url),'utf8');
const settings=fs.readFileSync(new URL('../app/settings/settings-client.tsx',import.meta.url),'utf8');

test('provider secrets are encrypted with AES-GCM and random IVs before D1 storage',()=>{
 assert.match(secrets,/AES-GCM/);
 assert.match(secrets,/crypto\.getRandomValues\(new Uint8Array\(12\)\)/);
 assert.match(secrets,/crypto\.subtle\.encrypt/);
 assert.match(secrets,/FRONT_SETTINGS_KEY/);
 assert.match(secrets,/secret_ciphertext/);
 assert.doesNotMatch(secrets,/console\.log/);
});

test('Tiingo connection endpoint validates origin and never returns the stored secret',()=>{
 assert.match(provider,/samePublicOrigin/);
 assert.match(provider,/validateTiingoToken/);
 assert.match(provider,/putProviderSecret/);
 assert.match(provider,/secretVisible:false/);
 assert.doesNotMatch(provider,/secret_ciphertext/);
 assert.doesNotMatch(provider,/token\s*:/);
});

test('Tiingo authentication uses the official header and API test endpoint, never a URL token',()=>{
 assert.match(market,/Authorization:'Token '/);
 assert.match(market,/\/api\/test\//);
 assert.doesNotMatch(market,/\?token=/);
});

test('Social Arb research and outcome refresh resolve the per-user encrypted Tiingo credential',()=>{
 assert.match(research,/getProviderSecret\(owner,'tiingo'\)/);
 assert.match(research,/captureSocialArbReference\(ticker,researched,providerToken\)/);
 assert.match(outcomes,/getProviderSecret\(owner,'tiingo'\)/);
 assert.match(outcomes,/historicalSocialArbBaseline\(String\(row\.ticker\),Number\(row\.captured\),providerToken\)/);
});

test('Settings treats Tiingo token as a password field and never stores it in localStorage',()=>{
 assert.match(settings,/type="password"/);
 assert.match(settings,/Connect Tiingo/);
 assert.match(settings,/front-encrypted-store/);
 assert.doesNotMatch(settings,/localStorage\.setItem\([^\\n]*tiingo/i);
});
