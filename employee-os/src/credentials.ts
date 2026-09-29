import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { pool } from './db.js';

function key(){
  const raw=process.env.CREDENTIALS_MASTER_KEY||'';
  const decoded=Buffer.from(raw,'base64');
  if(decoded.length!==32)throw new Error('CREDENTIALS_MASTER_KEY must be a base64-encoded 32-byte key.');
  return decoded;
}

function aad(companyId:string,provider:string,connectionId:string){
  return Buffer.from(`${companyId}:${provider}:${connectionId}`,'utf8');
}

export async function storeCredential(input:{
  companyId:string;provider:string;connectionId:string;secret:Record<string,unknown>;
}){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(aad(input.companyId,input.provider,input.connectionId));
  const plaintext=Buffer.from(JSON.stringify(input.secret),'utf8');
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  await pool.query(`INSERT INTO integration_credentials(
    company_id,provider,connection_id,ciphertext,iv,auth_tag,key_version
  ) VALUES($1,$2,$3,$4,$5,$6,'v1')
  ON CONFLICT(company_id,provider,connection_id) DO UPDATE SET
    ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,auth_tag=EXCLUDED.auth_tag,key_version='v1',updated_at=now()`,[
    input.companyId,input.provider,input.connectionId,
    ciphertext.toString('base64'),iv.toString('base64'),tag.toString('base64')
  ]);
}

export async function readCredential<T=Record<string,unknown>>(companyId:string,provider:string,connectionId:string):Promise<T>{
  const r=await pool.query(`SELECT * FROM integration_credentials
    WHERE company_id=$1 AND provider=$2 AND connection_id=$3 LIMIT 1`,[companyId,provider,connectionId]);
  if(!r.rowCount)throw new Error(`BLOCKED_EXTERNAL_AUTH: ${provider} credential is missing.`);
  const row=r.rows[0];
  const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(row.iv,'base64'));
  decipher.setAAD(aad(companyId,provider,connectionId));
  decipher.setAuthTag(Buffer.from(row.auth_tag,'base64'));
  const plaintext=Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext,'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

export async function deleteCredential(companyId:string,provider:string,connectionId:string){
  await pool.query('DELETE FROM integration_credentials WHERE company_id=$1 AND provider=$2 AND connection_id=$3',[
    companyId,provider,connectionId
  ]);
}
