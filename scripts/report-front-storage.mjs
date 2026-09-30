import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.env.RAILWAY_VOLUME_MOUNT_PATH||'');
if(!root||root==='/')process.exit(0);
const files=[];
function walk(dir,depth=0){
  if(depth>8)return;
  let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())walk(p,depth+1);
    else if(entry.isFile()){
      try{files.push({path:path.relative(root,p),bytes:fs.statSync(p).size});}catch{}
    }
  }
}
walk(root);
files.sort((a,b)=>b.bytes-a.bytes);
const total=files.reduce((sum,x)=>sum+x.bytes,0);
console.log('[front-storage-report] files='+files.length+' totalBytes='+total);
for(const item of files.slice(0,20))console.log('[front-storage-report] '+item.bytes+' '+item.path);
