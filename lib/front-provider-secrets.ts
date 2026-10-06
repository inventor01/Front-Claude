import { env } from 'cloudflare:workers';
import { db } from '@/lib/front-agent-auth';

const enc=new TextEncoder(),dec=new TextDecoder();
const clean=(value:unknown,max=4000)=>String(value??'').trim().slice(0,max);

function settingsRoot(){
 const value=clean((env as unknown as Record<string,unknown>).FRONT_SETTINGS_KEY,4096);
 if(!value)throw new Error('FRONT_SETTINGS_KEY is not configured.');
 return value;
}
function bytesToB64(bytes:Uint8Array){
 let binary='';
 for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary);
}
function b64ToBytes(value:string){
 const binary=atob(value),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
async function key(){
 const digest=await crypto.subtle.digest('SHA-256',enc.encode(settingsRoot()));
 return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function seal(value:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),enc.encode(value));
 return 'v1.'+bytesToB64(iv)+'.'+bytesToB64(new Uint8Array(encrypted));
}
async function open(value:string){
 const parts=value.split('.');
 if(parts.length!==3||parts[0]!=='v1')throw new Error('Unsupported provider secret format.');
 const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(parts[1])},await key(),b64ToBytes(parts[2]));
 return dec.decode(decrypted);
}

export async function hasProviderSecret(owner:string,provider:string){
 const row=await db().prepare('SELECT provider FROM front_provider_secrets WHERE owner=? AND provider=? LIMIT 1').bind(owner,provider).first<{provider?:string}>();
 return Boolean(row?.provider);
}
export async function getProviderSecret(owner:string,provider:string){
 const row=await db().prepare('SELECT secret_ciphertext FROM front_provider_secrets WHERE owner=? AND provider=? LIMIT 1').bind(owner,provider).first<{secret_ciphertext?:string}>();
 if(!row?.secret_ciphertext)return null;
 return open(row.secret_ciphertext);
}
export async function putProviderSecret(owner:string,provider:string,secret:string,validatedAt=Date.now()){
 const value=clean(secret,4000);
 if(value.length<8)throw new Error('Provider secret is too short.');
 const now=Date.now(),ciphertext=await seal(value);
 await db().prepare('INSERT INTO front_provider_secrets(owner,provider,secret_ciphertext,created,updated,last_validated,validation_status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,updated=excluded.updated,last_validated=excluded.last_validated,validation_status=excluded.validation_status')
  .bind(owner,provider,ciphertext,now,now,validatedAt,'valid').run();
 return{provider,updated:now,lastValidated:validatedAt,validationStatus:'valid'};
}
export async function deleteProviderSecret(owner:string,provider:string){
 const result=await db().prepare('DELETE FROM front_provider_secrets WHERE owner=? AND provider=?').bind(owner,provider).run();
 return Number(result.meta?.changes||0)>0;
}
export async function providerSecretMetadata(owner:string,provider:string){
 const row=await db().prepare('SELECT provider,created,updated,last_validated,validation_status FROM front_provider_secrets WHERE owner=? AND provider=? LIMIT 1').bind(owner,provider).first<any>();
 if(!row)return null;
 return{
  provider:String(row.provider),created:Number(row.created)||0,updated:Number(row.updated)||0,
  lastValidated:Number(row.last_validated)||null,validationStatus:String(row.validation_status||'unknown')
 };
}
