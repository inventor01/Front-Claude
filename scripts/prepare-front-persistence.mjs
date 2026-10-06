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
fs.mkdirSync(ephemeralRoot,{recursive:true});

function symlinkTarget(p){
  try{return fs.lstatSync(p).isSymbolicLink()?fs.readlinkSync(p):null;}catch{return null;}
}
function sameTarget(target){
  if(!target)return false;
  const resolved=path.resolve(path.dirname(observability),target);
  return resolved===path.resolve(ephemeralRoot);
}

const existingTarget=symlinkTarget(observability);
if(sameTarget(existingTarget)){
  console.log('[front-storage] observability symlink already points to ephemeral storage; leaving shared volume entry untouched');
  process.exit(0);
}

const reclaimed=sizeOf(observability);
try{fs.rmSync(observability,{recursive:true,force:true});}catch{}
try{
  fs.symlinkSync(ephemeralRoot,observability,'dir');
}catch(error){
  if(error&&error.code==='EEXIST'&&sameTarget(symlinkTarget(observability))){
    console.log('[front-storage] observability symlink was repaired concurrently; continuing with verified target');
    process.exit(0);
  }
  throw error;
}
console.log(`[front-storage] observability redirected to ephemeral storage; reclaimedBytes=${reclaimed}`);
