import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const market=fs.readFileSync(new URL('../lib/social-arb-market-data.ts',import.meta.url),'utf8');
const research=fs.readFileSync(new URL('../app/api/social-arb/research/route.ts',import.meta.url),'utf8');
const outcomes=fs.readFileSync(new URL('../app/api/social-arb/outcomes/route.ts',import.meta.url),'utf8');
const scheduler=fs.readFileSync(new URL('../scripts/social-arb-scheduler.mjs',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../scripts/start-server.mjs',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../app/social-arb-panel.tsx',import.meta.url),'utf8');

test('market journal uses a documented Tiingo reference price and never puts token in URL',()=>{
 assert.match(market,/api\.tiingo\.com/);
 assert.match(market,/\/iex\//);
 assert.match(market,/tngoLast/);
 assert.match(market,/Authorization:'Token '/);
 assert.doesNotMatch(market,/\?token=/);
});

test('research freezes a point-in-time baseline without making price data mandatory',()=>{
 assert.match(research,/captureSocialArbReference/);
 assert.match(research,/provider-unconfigured/);
 assert.match(research,/capture-failed/);
 assert.match(research,/social_arb_outcomes/);
 assert.match(research,/never invent a live price/);
});

test('outcome evaluator uses explicit 1 5 20 60 session horizons and conservative backfill',()=>{
 assert.match(market,/'1':0,'5':4,'20':19,'60':59/);
 assert.match(market,/prior-session-close/);
 assert.match(outcomes,/historicalSocialArbBaseline/);
 assert.match(outcomes,/baselineBackfilled/);
 assert.match(outcomes,/Raw price return/);
});

test('outcomes remain research evidence and can refresh headlessly through service auth',()=>{
 assert.match(outcomes,/requireService/);
 assert.match(outcomes,/x-front-commerce-key/);
 assert.match(outcomes,/not a trading recommendation/);
 assert.match(outcomes,/never backfills a live reference price with future knowledge/);
});

test('daily outcome evaluation is bounded and Tiingo key is forwarded only to worker runtime',()=>{
 assert.match(scheduler,/b%96===0/);
 assert.match(scheduler,/action:'refresh',limit:15/);
 assert.match(server,/"TIINGO_API_KEY"/);
});

test('Social Arb UI displays baseline and measured horizons without BUY instructions',()=>{
 assert.match(panel,/Point-in-time journal/);
 assert.match(panel,/awaiting provider/);
 assert.match(panel,/\['1','5','20','60'\]/);
 assert.doesNotMatch(panel,/\bBUY\b/);
});
