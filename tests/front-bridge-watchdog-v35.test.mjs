import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const start=fs.readFileSync(new URL('../browser-bridge/start.command',import.meta.url),'utf8');
const installPath=new URL('../browser-bridge/install-autostart.command',import.meta.url);
const uninstallPath=new URL('../browser-bridge/uninstall-autostart.command',import.meta.url);
const install=fs.readFileSync(installPath,'utf8');
const uninstall=fs.readFileSync(uninstallPath,'utf8');
const supervisor=fs.readFileSync(new URL('../browser-bridge/src/cloud-agent-supervisor.mjs',import.meta.url),'utf8');

test('bridge launch scripts remain valid bash',()=>{
 for(const file of [installPath,uninstallPath]){
  const result=spawnSync('bash',['-n',file.pathname],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
});

test('start.command runs cloud polling under the watchdog instead of an unsupervised child',()=>{
 assert.match(start,/cloud-agent-supervisor\.mjs/);
 assert.doesNotMatch(start,/node \.\/src\/cloud-agent\.mjs &/);
 assert.match(start,/wait \"\$CLOUD_AGENT_SUPERVISOR_PID\"/);
});

test('cloud agent supervisor restarts after unexpected exits and forwards shutdown',()=>{
 assert.match(supervisor,/setTimeout\(start,restartDelay\)/);
 assert.match(supervisor,/child\.kill\(signal\)/);
 assert.match(supervisor,/SIGKILL/);
});

test('macOS LaunchAgent contains no secret material and keeps the bridge alive',()=>{
 assert.match(install,/com\.front\.browser-bridge/);
 assert.match(install,/<key>KeepAlive<\/key>/);
 assert.match(install,/<key>RunAtLoad<\/key>/);
 assert.doesNotMatch(install,/FRONT_BRIDGE_API_KEY[^\n]*<string>/);
 assert.doesNotMatch(install,/cookie|password/i);
});

test('uninstaller preserves Front local data',()=>{
 assert.match(uninstall,/rm -f \"\$PLIST\"/);
 assert.doesNotMatch(uninstall,/rm -rf/);
});
