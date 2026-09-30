/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { env } from 'cloudflare:workers';
import { bodyJson, clean, db, frontOwnerId, noStore } from '@/lib/front-agent-auth';

async function digest(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function POST(request:Request){
  try{
    const owner=frontOwnerId();if(!owner)return noStore({error:'Front owner is not configured.'},503);
    const body=await bodyJson<any>(request,16_000);
    const pairingCode=clean(body.pairingCode,40).toUpperCase();
    if(!/^[A-Z2-9]{12}$/.test(pairingCode))return noStore({error:'Invalid or expired pairing code.'},401);
    const hash=await digest(pairingCode),key=`front-bridge-pair:${owner}:${hash}`,now=Date.now();
    const row=await db().prepare('DELETE FROM cache WHERE key=? AND expires>=? RETURNING value').bind(key,now).first<any>();
    if(!row)return noStore({error:'Invalid or expired pairing code.'},401);
    const bridgeKey=String(env.FRONT_BRIDGE_API_KEY||'');
    if(!bridgeKey)return noStore({error:'Front bridge pairing is not configured.'},503);
    return noStore({bridgeKey,cloudUrl:new URL(request.url).origin,pairedAt:now});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
