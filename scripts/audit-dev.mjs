import { spawnSync } from 'node:child_process';

const allowed = new Set([
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
]);

const result = spawnSync('npm', ['audit', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  console.error('[audit-dev] npm audit did not return readable JSON.');
  process.exit(1);
}

const vulnerabilities = report?.vulnerabilities && typeof report.vulnerabilities === 'object'
  ? report.vulnerabilities
  : {};

const blocking = [];
const accepted = [];

function rootAdvisories(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = vulnerabilities[name];
  if (!entry) return [];
  const roots = [];
  for (const via of Array.isArray(entry.via) ? entry.via : []) {
    if (typeof via === 'string') {
      roots.push(...rootAdvisories(via, new Set(seen)));
    } else if (via && typeof via === 'object') {
      roots.push({
        url: String(via.url || ''),
        title: String(via.title || ''),
        severity: String(via.severity || entry.severity || ''),
      });
    }
  }
  return roots;
}

for (const [name, entry] of Object.entries(vulnerabilities)) {
  const severity = String(entry?.severity || '').toLowerCase();
  if (!['high', 'critical'].includes(severity)) continue;

  const advisories = rootAdvisories(name);
  const urls = [...new Set(advisories.map((advisory) => advisory.url).filter(Boolean))];
  const isExactBracesChain =
    urls.length > 0 &&
    urls.every((url) => allowed.has(url));

  if (isExactBracesChain) {
    accepted.push({ name, severity, advisories });
  } else {
    blocking.push({ name, severity, advisories, fixAvailable: entry?.fixAvailable });
  }
}

if (accepted.length) {
  console.warn('[audit-dev] Accepted temporary dev-only exception: GHSA-vfj7-8cjw-p6xm (braces).');
  console.warn('[audit-dev] The production audit runs separately with --omit=dev and must remain clean.');
}

if (blocking.length) {
  console.error('[audit-dev] High/critical dependency findings outside the approved dev-only exception:');
  console.error(JSON.stringify(blocking, null, 2));
  process.exit(1);
}

console.log('[audit-dev] No unapproved high/critical dependency advisories.');
