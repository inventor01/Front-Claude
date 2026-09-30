/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { bodyJson, clean, db, noStore, requireBridge } from '@/lib/front-agent-auth';
const platforms=new Set(['X','TikTok','Instagram']);
function safeUrl(platform:string,raw:unknown){
  try{
    const u=new URL(String(raw||''));if(u.protocol!=='https:')return null;
    const host=u.hostname.toLowerCase();
    if(platform==='X'&&!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(host))return null;
    if(platform==='TikTok'&&!['tiktok.com','www.tiktok.com','ads.tiktok.com'].includes(host))return null;
    if(platform==='Instagram'&&(!['instagram.com','www.instagram.com'].includes(host)||!/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)))return null;
    u.hash='';return u.toString();
  }catch{return null;}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const owner=requireBridge(request),{id}=await params,body=await bodyJson<any>(request,512_000);
    const leaseId=clean(body.leaseId,120),bridgeId=clean(body.bridgeId,120),now=Date.now();
    const active=await db().prepare('SELECT 1 FROM agent_scroll_jobs WHERE owner=? AND id=? AND lease_id=? AND bridge_id=? AND status NOT IN (\'COMPLETED\',\'FAILED\',\'CANCELLED\',\'EXPIRED\') LIMIT 1').bind(owner,id,leaseId,bridgeId).first();
    if(!active)return noStore({error:'Scroll job lease is no longer valid.'},409);
    const rows=Array.isArray(body.evidence)?body.evidence.slice(0,100):[];
    const statements=[];
    let accepted=0;
    for(const row of rows){
      const platform=String(row?.platform||'');if(!platforms.has(platform))continue;
      const url=safeUrl(platform,row?.url);if(!url)continue;
      const evidenceId=clean(row?.id,180);if(!evidenceId)continue;
      const payload={...row,platform,url};
      statements.push(db().prepare(`INSERT INTO agent_scroll_evidence(owner,job_id,evidence_id,platform,payload,created,updated)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,job_id,evidence_id) DO UPDATE SET platform=excluded.platform,payload=excluded.payload,updated=excluded.updated`)
        .bind(owner,id,evidenceId,platform,JSON.stringify(payload),now,now));
      accepted++;
    }
    if(statements.length)await db().batch(statements);
    return noStore({ok:true,accepted});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
