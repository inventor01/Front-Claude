import { db, noStore, requireService } from '@/lib/front-agent-auth';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function digest(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function code(){
  const bytes=new Uint8Array(12);crypto.getRandomValues(bytes);
  return [...bytes].map(x=>alphabet[x%alphabet.length]).join('');
}
export async function POST(request:Request){
  try{
    const owner=requireService(request),pairingCode=code(),now=Date.now(),expiresAt=now+10*60_000;
    const hash=await digest(pairingCode);
    await db().prepare('INSERT OR REPLACE INTO cache(key,value,expires) VALUES(?,?,?)')
      .bind(`front-bridge-pair:${owner}:${hash}`,JSON.stringify({created:now}),expiresAt).run();
    return noStore({pairingCode,expiresAt,expiresInSeconds:600});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
