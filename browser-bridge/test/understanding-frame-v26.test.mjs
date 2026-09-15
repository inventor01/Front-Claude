import test from 'node:test';
import assert from 'node:assert/strict';
import {attachUnderstandingFrame,assessNarrativeClaims,buildUnderstandingFrame,eventFingerprintForFrame,eventFingerprintSimilarity,extractOriginClaims} from '../src/understanding-frame-v26.mjs';

test('understanding frame preserves source provenance instead of flattening observations into facts',()=>{
 const row={id:'1',platform:'TikTok',author:'a',mediaType:'video',content:'everyone is posting this',transcript:'This started on Discord and the original video was @sourceacct',transcriptSource:'active-text-track',contentSummary:'Person speaking to camera',contentConfidence:.8,postSubject:'Daejon Love interview meme',postEvent:'interview clip becomes meme',postEntities:['Daejon Love'],semanticNarrativeKey:'daejon love interview meme',postUnderstandingConfidence:.91,postUnderstandingMethod:'semantic-model'};
 const frame=buildUnderstandingFrame(row);
 assert.equal(frame.subject,'Daejon Love interview meme');
 assert.equal(frame.confidence.semantic,.91);
 assert(frame.provenance.transcript.includes('active-text-track'));
 assert(frame.observations.some(item=>item.channel==='transcript'));
 assert(frame.originClaims.some(claim=>claim.type==='origin-platform'&&claim.value==='discord'));
 assert(frame.originClaims.some(claim=>claim.type==='origin-account'&&claim.value==='sourceacct'));
 assert(frame.uncertainty.includes('PARTIAL_TRANSCRIPT_POSSIBLE'));
 assert(frame.eventFingerprint);
 assert(frame.evidenceBuckets.observed.length>=2);
 assert(frame.evidenceBuckets.inferred.some(item=>item.field==='subject'));
 assert(frame.evidenceBuckets.claimed.length>=2);
 assert.deepEqual(frame.evidenceBuckets.verified,[]);
});

test('event fingerprints compare concrete story identity without auto-merging',()=>{
 const left=eventFingerprintForFrame({subject:'Daejon Love interview meme',event:'interview clip becomes meme',entities:['Daejon Love']});
 const same=eventFingerprintForFrame({subject:'Daejon Love meme',event:'interview clip spreads online',entities:['Daejon Love']});
 const different=eventFingerprintForFrame({subject:'NEO robot launch campaign',event:'robot promoted with X Ads',entities:['NEO robot','X Ads']});
 assert(left&&same&&different);
 assert(eventFingerprintSimilarity(left,same)>eventFingerprintSimilarity(left,different));
});

test('origin extraction marks creator statements as CLAIMED rather than verified',()=>{
 const claims=extractOriginClaims({content:'This came from TikTok back in 2023'});
 assert(claims.some(claim=>claim.type==='origin-platform'&&claim.value==='tiktok'&&claim.claimState==='CLAIMED'));
 assert(claims.some(claim=>claim.type==='origin-year'&&claim.value==='2023'&&claim.claimState==='CLAIMED'));
});

test('missing video transcript is explicit uncertainty for future STT escalation',()=>{
 const frame=buildUnderstandingFrame({mediaType:'video',content:'vague caption',postSubject:'Specific mascot event',semanticNarrativeKey:'specific mascot event',postUnderstandingConfidence:.8});
 assert.equal(frame.transcriptStatus.present,false);
 assert.equal(frame.transcriptStatus.needsFallback,true);
 assert(frame.uncertainty.includes('SPEECH_TRANSCRIPT_UNAVAILABLE'));
});

test('contradictory origin claims remain explicit instead of silently choosing one',()=>{
 const rows=[
  attachUnderstandingFrame({id:'1',platform:'X',author:'a',content:'This started on TikTok',postSubject:'Specific event story',semanticNarrativeKey:'specific event story',postUnderstandingConfidence:.9,postUnderstandingMethod:'semantic-model'}),
  attachUnderstandingFrame({id:'2',platform:'TikTok',author:'b',content:'This started on Twitch',postSubject:'Specific event story',semanticNarrativeKey:'specific event story',postUnderstandingConfidence:.9,postUnderstandingMethod:'semantic-model'}),
 ];
 const assessment=assessNarrativeClaims(rows);
 assert.equal(assessment.status,'CONFLICTING');
 assert.equal(assessment.contradictions.length,1);
 assert.equal(assessment.contradictions[0].type,'origin-platform');
 assert.deepEqual(new Set(assessment.contradictions[0].values.map(value=>value.value)),new Set(['tiktok','twitch']));
});
