import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrativeTitleIntelligenceV28, chooseNarrativeTitleV28 } from '../src/narrative-title-v28.mjs';

const row = (id, author, platform, subject, event, confidence = 0.92) => ({
  id, author, platform, postSubject: subject, postEvent: event,
  postUnderstandingConfidence: confidence,
});

test('builds a specific title only from independently corroborated subject and event', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('2','b','TikTok','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('3','c','X','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('4','d','X','DeJon Love','DeJon Love reaction clip reused as meme'),
  ];
  const result = buildNarrativeTitleIntelligenceV28({}, rows);
  assert.ok(result);
  assert.match(result.title, /DeJon Love/i);
  assert.match(result.title, /Reaction|Reused|Meme/i);
  assert.equal(result.version, 28);
  assert.ok(result.confidence >= 0.8);
  assert.ok(result.evidence.claims.every((claim) => claim.type === 'cross-platform' || claim.creators.length >= 2));
});

test('drops an event that only one creator supports instead of inventing certainty', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('2','b','TikTok','DeJon Love',''),
    row('3','c','X','DeJon Love',''),
  ];
  const result = buildNarrativeTitleIntelligenceV28({}, rows);
  assert.equal(result.title, 'DeJon Love');
  assert.equal(result.evidence.claims.length, 1);
  assert.equal(result.evidence.claims[0].type, 'subject');
});

test('refuses a tied contradictory subject cluster', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','reaction clip'),
    row('2','b','TikTok','DeJon Love','reaction clip'),
    row('3','c','X','LeBron James','reaction clip'),
    row('4','d','X','LeBron James','reaction clip'),
  ];
  assert.equal(buildNarrativeTitleIntelligenceV28({}, rows), null);
});

test('requires independent creators rather than repeated posts by one account', () => {
  const rows = [
    row('1','same','TikTok','DeJon Love','reaction clip'),
    row('2','same','TikTok','DeJon Love','reaction clip'),
    row('3','same','X','DeJon Love','reaction clip'),
  ];
  assert.equal(chooseNarrativeTitleV28({}, rows), null);
});

test('does not add cross-platform language without enough independent spread evidence', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','reaction clip reused as meme'),
    row('2','b','X','DeJon Love','reaction clip reused as meme'),
  ];
  const result = buildNarrativeTitleIntelligenceV28({}, rows);
  assert.ok(result);
  assert.doesNotMatch(result.title, /Across X and TikTok|Across TikTok and X/i);
});

test('does not imply an event is cross-platform when only the subject crosses platforms', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','reaction clip reused as meme'),
    row('2','b','TikTok','DeJon Love','reaction clip reused as meme'),
    row('3','c','X','DeJon Love','different unrelated appearance'),
    row('4','d','X','DeJon Love','different unrelated appearance'),
  ];
  const result = buildNarrativeTitleIntelligenceV28({}, rows);
  assert.ok(result);
  assert.doesNotMatch(result.title, /Across X and TikTok|Across TikTok and X/i);
});

test('clusters one-edit spelling variants without losing the narrative title', () => {
  const rows = [
    row('1','a','TikTok','DeJon Love','reaction clip reused as meme'),
    row('2','b','X','Daejon Love','reaction clip reused as meme'),
    row('3','c','TikTok','DeJon Love','reaction clip reused as meme'),
  ];
  const result = buildNarrativeTitleIntelligenceV28({}, rows);
  assert.ok(result);
  assert.match(result.title, /DeJon Love|Daejon Love/i);
  assert.ok(result.confidence >= 0.7);
});

test('rejects generic narrative labels', () => {
  const rows = [
    row('1','a','TikTok','viral video','funny reaction'),
    row('2','b','X','viral video','funny reaction'),
  ];
  assert.equal(buildNarrativeTitleIntelligenceV28({}, rows), null);
});
