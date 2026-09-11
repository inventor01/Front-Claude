import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './sites-env.mjs';
import { hasEnoughNaturalSupport, lowQualityIntelligenceLabel, normalizeIntelligenceLabel } from './intelligence-quality.mjs';

const owner = process.env.FRONT_STANDALONE_USER_ID || '';
if (!owner) {
  console.log('[front-cleanup] skipped: FRONT_STANDALONE_USER_ID is not configured.');
  process.exit(0);
}

const MODEL_EPOCH = Date.parse(process.env.FRONT_INTELLIGENCE_MODEL_EPOCH || '2026-09-11T18:45:00Z');
const persistDir = process.env.FRONT_PERSIST_DIR ? path.resolve(process.env.FRONT_PERSIST_DIR) : path.join(projectRoot, '.wrangler/state');
mkdirSync(persistDir, { recursive: true });
const hosting = JSON.parse(readFileSync(path.join(projectRoot, '.openai/hosting.json'), 'utf8'));
if (!hosting.d1) throw new Error('D1 binding is not configured.');

const configDirectory = mkdtempSync(path.join(tmpdir(), 'front-cleanup-'));
const configPath = path.join(configDirectory, 'wrangler.json');
writeFileSync(configPath, JSON.stringify({
  name: 'front-local-cleanup',
  compatibility_date: '2026-01-01',
  d1_databases: [{ binding: hosting.d1, database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
}));

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const wrangler = path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js');
function execute(sql, json = false) {
  const args = [wrangler, 'd1', 'execute', hosting.d1, '--local', '--persist-to', persistDir, '--config', configPath, '--command', sql];
  if (json) args.push('--json');
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw new Error((result.stderr || result.stdout || 'D1 cleanup command failed').trim());
  return result.stdout || '';
}
function query(sql) {
  const raw = execute(sql, true).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  return blocks.flatMap((block) => Array.isArray(block?.results) ? block.results : []);
}

try {
  const ownerSql = sqlString(owner);
  const rows = query(`SELECT n.id,n.title,n.aliases,n.created,COALESCE(MAX(e.last_seen),n.created) AS last_seen,COUNT(DISTINCT CASE WHEN e.id IS NOT NULL AND e.provenance NOT LIKE '%X Explore%' AND e.provenance NOT LIKE '%TikTok Creative Center%' THEN e.id END) AS natural_evidence,COUNT(DISTINCT CASE WHEN e.id IS NOT NULL AND e.provenance NOT LIKE '%X Explore%' AND e.provenance NOT LIKE '%TikTok Creative Center%' THEN e.platform || ':' || lower(e.author) END) AS natural_creators FROM narratives n LEFT JOIN evidence_links l ON l.owner=n.owner AND l.narrative=n.id LEFT JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE n.owner=${ownerSql} AND n.id LIKE 'auto:%' GROUP BY n.id,n.title,n.aliases,n.created ORDER BY n.created ASC`);
  let removedNarratives = 0;
  const removedTitles = [];
  for (const row of rows) {
    const title = String(row.title || '');
    const naturalCreators = Number(row.natural_creators || 0);
    const naturalEvidence = Number(row.natural_evidence || 0);
    if (!lowQualityIntelligenceLabel(title) && hasEnoughNaturalSupport(title, naturalCreators, naturalEvidence)) continue;
    const idSql = sqlString(row.id);
    let aliases = [];
    try { aliases = JSON.parse(row.aliases || '[]'); } catch {}
    const keys = [...new Set([title, ...aliases].map(normalizeIntelligenceLabel).filter(Boolean))];
    const keyClause = keys.length ? ` AND topic_key IN (${keys.map(sqlString).join(',')})` : '';
    execute(`BEGIN;DELETE FROM narrative_coins WHERE owner=${ownerSql} AND narrative=${idSql};DELETE FROM evidence_links WHERE owner=${ownerSql} AND narrative=${idSql};DELETE FROM narrative_relationships WHERE owner=${ownerSql} AND narrative=${idSql};DELETE FROM coin_match_queue WHERE owner=${ownerSql} AND narrative=${idSql};DELETE FROM launch_events WHERE owner=${ownerSql} AND narrative=${idSql};DELETE FROM topic_snapshots WHERE owner=${ownerSql}${keyClause};DELETE FROM narratives WHERE owner=${ownerSql} AND id=${idSql};COMMIT;`);
    removedNarratives++;
    removedTitles.push(title);
  }

  const invalidSnapshots = query(`SELECT topic_key,topic_title,MAX(observed) AS observed,MAX(creators) AS creators,MAX(evidence_count) AS evidence_count FROM topic_snapshots WHERE owner=${ownerSql} GROUP BY topic_key,topic_title`)
    .filter((row) => lowQualityIntelligenceLabel(row.topic_title) || !hasEnoughNaturalSupport(row.topic_title, row.creators, row.evidence_count));
  for (const row of invalidSnapshots) execute(`DELETE FROM topic_snapshots WHERE owner=${ownerSql} AND topic_key=${sqlString(row.topic_key)}`);

  const preModel = query(`SELECT COUNT(*) AS count FROM topic_snapshots WHERE owner=${ownerSql} AND observed<${MODEL_EPOCH}`)[0]?.count || 0;
  execute(`DELETE FROM topic_snapshots WHERE owner=${ownerSql} AND observed<${MODEL_EPOCH};DELETE FROM coin_match_queue WHERE owner=${ownerSql} AND narrative NOT IN (SELECT id FROM narratives WHERE owner=${ownerSql});DELETE FROM narrative_coins WHERE owner=${ownerSql} AND narrative NOT IN (SELECT id FROM narratives WHERE owner=${ownerSql});DELETE FROM launch_events WHERE owner=${ownerSql} AND narrative IS NOT NULL AND narrative NOT IN (SELECT id FROM narratives WHERE owner=${ownerSql});`);

  console.log(`[front-cleanup] complete · removed ${removedNarratives} unsupported auto narrative(s), ${invalidSnapshots.length} invalid topic key(s), ${preModel} pre-v4 snapshot row(s). Raw X/TikTok evidence was preserved.`);
  if (removedTitles.length) console.log(`[front-cleanup] removed titles: ${removedTitles.slice(0, 40).join(' | ')}${removedTitles.length > 40 ? ' | …' : ''}`);
} finally {
  rmSync(configDirectory, { recursive: true, force: true });
}
