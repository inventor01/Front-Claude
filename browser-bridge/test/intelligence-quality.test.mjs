import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEnoughNaturalSupport, lowQualityIntelligenceLabel, normalizeIntelligenceLabel, requiredNaturalCreators } from '../../scripts/intelligence-quality.mjs';

test('rejects platform/generic/common labels but keeps real narrative names',()=>{
 for(const label of ['fyp','viral','TikTok','Blue','Trade','someone','crypto','trending']) assert.equal(lowQualityIntelligenceLabel(label),true,label);
 for(const label of ['Astra','Daejon Love','Blue Smurf Cat','Skibidi Toilet']) assert.equal(lowQualityIntelligenceLabel(label),false,label);
});

test('requires stronger independent support for one-word narratives',()=>{
 assert.equal(requiredNaturalCreators('Astra'),3);
 assert.equal(requiredNaturalCreators('Daejon Love'),2);
 assert.equal(hasEnoughNaturalSupport('Astra',2,2),false);
 assert.equal(hasEnoughNaturalSupport('Astra',3,3),true);
 assert.equal(hasEnoughNaturalSupport('Daejon Love',2,2),true);
});

test('normalizes hashtag/camel/spacing variants for cleanup matching',()=>{
 assert.equal(normalizeIntelligenceLabel('#DaejonLove'),'daejon love');
 assert.equal(normalizeIntelligenceLabel('  Blue_Smurf-Cat  '),'blue smurf cat');
});
