/* eslint-disable @typescript-eslint/no-explicit-any -- D1 and JSON boundary rows are dynamically validated before use. */
import { env } from 'cloudflare:workers';

const enc=new TextEncoder();
function equal(a:string,b:string){
  const aa=enc.encode(a),bb=enc.encode(b);
  let diff=aa.length^bb.length;
  const max=Math.max(aa.length,bb.length);
  for(let i=0;i<max;i++)diff|=(aa[i%Math.max(1,aa.length)]||0)^(bb[i%Math.max(1,bb.length)]||0);
  return diff===0;
}
export function frontOwnerId(){
  return String(env.FRONT_COMMERCE_OWNER_ID||env.FRONT_STANDALONE_USER_ID||'').trim();
}
export function requireService(request:Request){
  const expected=String(env.FRONT_COMMERCE_API_KEY||'');
  const actual=request.headers.get('x-front-commerce-key')||request.headers.get('x-front-service-key')||'';
  if(!expected||!actual||!equal(actual,expected))throw new Response(JSON.stringify({error:'Service authentication required.'}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});
  const owner=frontOwnerId();
  if(!owner)throw new Response(JSON.stringify({error:'Front service owner is not configured.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
  return owner;
}
export function requireBridge(request:Request){
  const expected=String(env.FRONT_BRIDGE_API_KEY||'');
  const actual=request.headers.get('x-front-bridge-key')||'';
  if(!expected||!actual||!equal(actual,expected))throw new Response(JSON.stringify({error:'Bridge authentication required.'}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});
  const owner=frontOwnerId();
  if(!owner)throw new Response(JSON.stringify({error:'Front service owner is not configured.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
  return owner;
}
export const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
export const noStore=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function bodyJson<T=any>(request:Request,maxBytes=256_000):Promise<T>{
  const text=await request.text();
  if(text.length>maxBytes)throw new Response(JSON.stringify({error:'Request body too large.'}),{status:413,headers:{'content-type':'application/json'}});
  try{return (text?JSON.parse(text):{}) as T;}catch{throw new Response(JSON.stringify({error:'Invalid JSON.'}),{status:400,headers:{'content-type':'application/json'}});}
}
export const clean=(v:unknown,max=1000)=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,max);
