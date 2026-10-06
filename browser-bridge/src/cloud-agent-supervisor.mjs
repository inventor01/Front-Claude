import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const agent=path.join(here,'cloud-agent.mjs');
const restartDelay=Math.max(1000,Math.min(30000,Number(process.env.FRONT_CLOUD_AGENT_RESTART_MS||5000)));
let stopping=false;
let child=null;
let restartTimer=null;

function start(){
 if(stopping)return;
 child=spawn(process.execPath,[agent],{stdio:'inherit',env:process.env});
 child.on('exit',(code,signal)=>{
  child=null;
  if(stopping)return;
  console.warn('[front-cloud-supervisor] cloud agent exited', {code,signal,restartDelay});
  restartTimer=setTimeout(start,restartDelay);
  restartTimer.unref?.();
 });
}

function shutdown(signal){
 if(stopping)return;
 stopping=true;
 if(restartTimer)clearTimeout(restartTimer);
 if(child&&!child.killed)child.kill(signal);
 const force=setTimeout(()=>{
  if(child&&!child.killed)child.kill('SIGKILL');
  process.exit(0);
 },4000);
 force.unref?.();
 if(!child)process.exit(0);
 else child.once('exit',()=>process.exit(0));
}

process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGHUP',()=>shutdown('SIGHUP'));

console.log('[front-cloud-supervisor] starting cloud agent watchdog');
start();
