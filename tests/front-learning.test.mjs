import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const folder=mkdtempSync(path.join(tmpdir(),'front-learning-test-'));
const target=path.join(folder,'front-learning.mjs');
const source=readFileSync(new URL('../lib/front-learning.ts',import.meta.url),'utf8');
writeFileSync(target,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const learning=await import(pathToFileURL(target));

const featureSet={platforms:['X','TikTok'],semanticCrossPlatformCreators:3,crossPostedCreators:2,creators:5,stage:'Accelerating',hotPosts:[{}],maxViewsPerHour:125000,maxLikesPerHour:9000,ageMs:45*60000};
const features=learning.learningFeatures(featureSet);

function record(kind,data){return{kind,data};}
function feedback(label,count,override={}){return Array.from({length:count},(_,i)=>record('ranking-feedback',{narrativeId:`n${i}`,label,features:{...features,...override}}));}
function outcome(value,count,override={}){return Array.from({length:count},(_,i)=>record('verified-outcome',{narrativeId:`o${i}`,outcome:value,features:{...features,...override}}));}

test('extracts only social ranking features and excludes coin state',()=>{
  assert.equal(features.crossPlatform,true);
  assert.equal(features.semanticCross,true);
  assert.equal(features.crossPost,true);
  assert.equal(features.creators3,true);
  assert.equal(features.accelerating,true);
  assert.equal(features.hot,true);
  assert.equal(features.velocity50k,true);
  assert.equal(features.velocity100k,true);
  assert.equal(features.fresh3h,true);
  assert.equal('coin' in features,false);
});

test('does not self-adjust before enough comparable examples exist',()=>{
  const policy=learning.buildLearningPolicy(feedback('useful',4));
  const applied=learning.applyLearning(features,policy);
  assert.equal(policy.activeFeatures,0);
  assert.equal(applied.adjustment,0);
});

test('human useful feedback creates a bounded positive ranking signal',()=>{
  const policy=learning.buildLearningPolicy(feedback('useful',20));
  const applied=learning.applyLearning(features,policy);
  assert(policy.feedback===20&&policy.positive===20);
  assert(applied.adjustment>0&&applied.adjustment<=15);
  assert(applied.reasons.length>0);
});

test('human not-relevant feedback creates a bounded negative ranking signal',()=>{
  const policy=learning.buildLearningPolicy(feedback('not-relevant',20));
  const applied=learning.applyLearning(features,policy);
  assert(policy.feedback===20&&policy.negative===20);
  assert(applied.adjustment<0&&applied.adjustment>=-15);
});

test('verified coin creation is weaker supervision than explicit human feedback',()=>{
  const human=learning.applyLearning(features,learning.buildLearningPolicy(feedback('useful',20))).adjustment;
  const automatic=learning.applyLearning(features,learning.buildLearningPolicy(outcome('coin-created',20))).adjustment;
  assert(automatic>0);
  assert(human>automatic);
});

test('market-cap outcomes add evidence without allowing unbounded rank changes',()=>{
  const records=[...outcome('coin-created',30),...outcome('mc-25k',30),...outcome('mc-100k',30),...outcome('mc-500k',30)];
  const applied=learning.applyLearning(features,learning.buildLearningPolicy(records));
  assert(applied.adjustment>0);
  assert(applied.adjustment<=15);
});

test('unrelated archive kinds never train the ranker',()=>{
  const policy=learning.buildLearningPolicy([record('active-reset-summary',{features,label:'useful'}),record('other',{features,outcome:'mc-500k'})]);
  assert.equal(policy.examples,0);
  assert.equal(learning.applyLearning(features,policy).adjustment,0);
});

test.after(()=>rmSync(folder,{recursive:true,force:true}));
