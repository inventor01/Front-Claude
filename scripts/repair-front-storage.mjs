import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root=path.resolve(process.argv[2]||process.env.RAILWAY_VOLUME_MOUNT_PATH||process.env.FRONT_PERSIST_DIR||'');
if(!root||root==='/')process.exit(0);

function walk(dir,depth=0,out=[]){
  if(depth>8)return out;
  let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return out;}
  for(const entry of entries){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())walk(p,depth+1,out);
    else if(entry.isFile()&&/\.(sqlite|sqlite3|db)$/i.test(entry.name))out.push(p);
  }
  return out;
}
function hasTable(db,name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1").get(name));
}
function bytes(file){try{return fs.statSync(file).size;}catch{return 0;}}
function safeUnlink(file){try{fs.unlinkSync(file);}catch{}}

const candidates=walk(root).sort((a,b)=>bytes(b)-bytes(a));
let target=null;
for(const file of candidates){
  try{
    const db=new DatabaseSync(file,{readOnly:true});
    const match=hasTable(db,'evidence')&&hasTable(db,'observations');
    db.close();
    if(match){target=file;break;}
  }catch{}
}
if(!target){
  console.log('[front-storage] no Front D1 sqlite database found on persistent volume');
  process.exit(0);
}

const before=bytes(target);
const backup=path.join(os.tmpdir(),`front-d1-backup-${process.pid}.sqlite`);
const compact=path.join(os.tmpdir(),`front-d1-compact-${process.pid}.sqlite`);
safeUnlink(backup);safeUnlink(compact);

console.log(`[front-storage] repairing ${path.relative(root,target)} size=${before}`);
fs.copyFileSync(target,backup);

const db=new DatabaseSync(target);
try{
  try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
  const now=Date.now();
  const retentions=[
    ['cache','expires',now],
    ['observations','observed',now-30*86400000],
    ['evidence_rich','observed',now-30*86400000],
    ['topic_snapshots','observed',now-90*86400000],
    ['topic_rich_snapshots','observed',now-90*86400000],
    ['coin_market_snapshots','observed',now-30*86400000],
    ['front_page_views','first_seen',now-90*86400000],
  ];
  let pruned=0;
  for(const [table,column,cutoff] of retentions){
    if(!hasTable(db,table))continue;
    const result=db.prepare(`DELETE FROM "${table}" WHERE "${column}" < ?`).run(cutoff);
    pruned+=Number(result.changes||0);
    console.log(`[front-storage] pruned ${result.changes||0} old rows from ${table}`);
  }
  db.exec('PRAGMA optimize');
  db.exec(`VACUUM INTO '${compact.replaceAll("'","''")}'`);
}finally{
  db.close();
}

const verify=new DatabaseSync(compact,{readOnly:true});
try{
  const integrity=verify.prepare('PRAGMA integrity_check').get();
  const value=Object.values(integrity||{})[0];
  if(value!=='ok')throw new Error(`compacted database integrity check failed: ${String(value)}`);
  if(!hasTable(verify,'evidence')||!hasTable(verify,'observations'))throw new Error('compacted database is missing required Front tables');
}finally{verify.close();}

const after=bytes(compact);
if(!(after>0&&after<=before))throw new Error(`compaction produced invalid size before=${before} after=${after}`);
try{
  fs.copyFileSync(compact,target);
  safeUnlink(target+'-wal');
  safeUnlink(target+'-shm');
  console.log(`[front-storage] repair complete before=${before} after=${after} reclaimed=${before-after}`);
}catch(error){
  console.error('[front-storage] replacement failed; restoring backup');
  fs.copyFileSync(backup,target);
  throw error;
}finally{
  safeUnlink(backup);safeUnlink(compact);
}
