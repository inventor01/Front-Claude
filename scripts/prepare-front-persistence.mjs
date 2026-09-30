import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const persistDir=path.resolve(process.argv[2]||'');
if(!persistDir||persistDir==='/')process.exit(0);

function sizeOf(p){
  try{
    const s=fs.statSync(p);
    if(s.isFile())return s.size;
    if(!s.isDirectory())return 0;
    return fs.readdirSync(p).reduce((sum,name)=>sum+sizeOf(path.join(p,name)),0);
  }catch{return 0;}
}

const v3=path.join(persistDir,'v3');
const observability=path.join(v3,'observability');
const ephemeralRoot=path.join(os.tmpdir(),'front-miniflare-observability');
fs.mkdirSync(v3,{recursive:true});
const reclaimed=sizeOf(observability);
try{
  const existing=fs.lstatSync(observability);
  if(existing.isSymbolicLink()||existing.isDirectory()||existing.isFile())fs.rmSync(observability,{recursive:true,force:true});
}catch{}
fs.rmSync(ephemeralRoot,{recursive:true,force:true});
fs.mkdirSync(ephemeralRoot,{recursive:true});
fs.symlinkSync(ephemeralRoot,observability,'dir');
console.log(`[front-storage] observability redirected to ephemeral storage; reclaimedBytes=${reclaimed}`);
