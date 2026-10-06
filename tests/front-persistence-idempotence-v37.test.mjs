import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script=fileURLToPath(new URL('../scripts/prepare-front-persistence.mjs',import.meta.url));
const startServer=fs.readFileSync(new URL('../scripts/start-server.mjs',import.meta.url),'utf8');

test('persistence prep is idempotent across rolling-start retries',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'front-persist-test-'));
 const persist=path.join(root,'persist');
 const temp=path.join(root,'tmp');
 fs.mkdirSync(temp,{recursive:true});
 const env={...process.env,TMPDIR:temp,TMP:temp,TEMP:temp};
 const first=spawnSync(process.execPath,[script,persist],{env,encoding:'utf8'});
 assert.equal(first.status,0,first.stderr);
 const link=path.join(persist,'v3','observability');
 assert.equal(fs.lstatSync(link).isSymbolicLink(),true);
 const target1=fs.readlinkSync(link);
 const inode1=fs.lstatSync(link).ino;
 const second=spawnSync(process.execPath,[script,persist],{env,encoding:'utf8'});
 assert.equal(second.status,0,second.stderr);
 assert.equal(fs.readlinkSync(link),target1);
 assert.equal(fs.lstatSync(link).ino,inode1,'second start should reuse the verified symlink rather than replacing it');
 assert.match(second.stdout,/already points to ephemeral storage/);
 fs.rmSync(root,{recursive:true,force:true});
});

test('persistence prep repairs legacy observability directories',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'front-persist-legacy-'));
 const persist=path.join(root,'persist');
 const temp=path.join(root,'tmp');
 const legacy=path.join(persist,'v3','observability');
 fs.mkdirSync(legacy,{recursive:true});
 fs.writeFileSync(path.join(legacy,'old.log'),'legacy');
 fs.mkdirSync(temp,{recursive:true});
 const result=spawnSync(process.execPath,[script,persist],{env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.lstatSync(legacy).isSymbolicLink(),true);
 assert.match(result.stdout,/reclaimedBytes=/);
 fs.rmSync(root,{recursive:true,force:true});
});

test('server fails closed when persistent-state preparation fails',()=>{
 assert.match(startServer,/persistence preparation failed with status/);
 assert.match(startServer,/refusing to start in an unverified persistence state/);
 assert.doesNotMatch(startServer,/persistence preparation exited with status.*console\.warn/);
});
