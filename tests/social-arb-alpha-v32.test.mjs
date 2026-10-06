import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const research=fs.readFileSync(new URL('../app/api/social-arb/research/route.ts',import.meta.url),'utf8');
const social=fs.readFileSync(new URL('../app/api/social-arb/route.ts',import.meta.url),'utf8');
const scheduler=fs.readFileSync(new URL('../scripts/social-arb-scheduler.mjs',import.meta.url),'utf8');
const cloud=fs.readFileSync(new URL('../browser-bridge/src/cloud-agent.mjs',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../app/social-arb-panel.tsx',import.meta.url),'utf8');

test('information gap refuses false precision and preserves explicit uncertainty states',()=>{
 assert.match(research,/insufficient-data/);
 assert.match(research,/low-awareness/);
 assert.match(research,/emerging-awareness/);
 assert.match(research,/parity-likely/);
 assert.match(research,/high-information-gap-candidate/);
 assert.match(research,/product-level financial materiality from virality alone/);
 assert.doesNotMatch(research,/informationGapScore/);
});

test('research uses downstream SEC filings and financial-media evidence',()=>{
 assert.match(research,/data\.sec\.gov\/submissions/);
 assert.match(research,/news\.google\.com\/rss\/search/);
 assert.match(research,/earnings revenue sales stock investor analyst/);
 assert.match(research,/social_arb_research_runs/);
 assert.match(research,/x-front-bridge-key/);
 assert.match(research,/candidates\.length<4/);
});

test('24-7 autoscan has backpressure and world-first rotating discovery',()=>{
 assert.match(scheduler,/activeCount/);
 assert.match(scheduler,/social-arb-auto-/);
 assert.match(scheduler,/Observe ordinary consumer and cultural behavior before stock discussion/);
 assert.match(scheduler,/caller:'FRONT_SOCIAL_ARB'/);
 assert.match(scheduler,/platforms:\['X','TikTok','Instagram'\]/);
 assert.match(scheduler,/b%4===0/);
});

test('remote bridge persists Social Arb results through bridge auth',()=>{
 assert.match(social,/x-front-bridge-key/);
 assert.match(social,/requireBridge/);
 assert.match(cloud,/syncSocialArb/);
 assert.match(cloud,/scanObservedAt/);
 assert.match(cloud,/researchCandidates/);
 assert.match(cloud,/\/api\/social-arb\/research/);
 assert.match(cloud,/socialArbSummary/);
});

test('UI exposes research gate rather than a BUY instruction',()=>{
 assert.match(panel,/Research gap/);
 assert.match(panel,/SEC filing matches/);
 assert.match(panel,/financial-media matches/);
 assert.doesNotMatch(panel,/\bBUY\b/);
});