import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import ts from 'typescript';

const dir = mkdtempSync(join(os.tmpdir(), 'front-origin-'));
const out = join(dir, 'request-origin.mjs');
const source = readFileSync('lib/request-origin.ts', 'utf8');
writeFileSync(out, ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText);
const { samePublicOrigin } = await import(pathToFileURL(out));

test('accepts a direct same-origin request', () => {
  const request = new Request('https://front.example/api/browser-evidence', {
    headers: { origin: 'https://front.example' },
  });
  assert.equal(samePublicOrigin(request), true);
});

test('accepts the browser public origin behind an HTTPS reverse proxy', () => {
  const request = new Request('http://internal:8080/api/browser-evidence', {
    headers: {
      origin: 'https://front.example',
      host: 'internal:8080',
      'x-forwarded-host': 'front.example',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(samePublicOrigin(request), true);
});

test('rejects a forged cross-site origin even behind the proxy', () => {
  const request = new Request('http://internal:8080/api/browser-evidence', {
    headers: {
      origin: 'https://evil.example',
      'x-forwarded-host': 'front.example',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(samePublicOrigin(request), false);
});

test('rejects requests with no Origin header', () => {
  const request = new Request('https://front.example/api/browser-evidence');
  assert.equal(samePublicOrigin(request), false);
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
