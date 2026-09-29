import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { pool } from './db.js';
const secret=process.env.JWT_SECRET;
if(!secret) throw new Error('JWT_SECRET is required');
const key=new TextEncoder().encode(secret);
export async function hashPassword(value:string){return argon2.hash(value,{type:argon2.argon2id});}
export async function verifyPassword(hash:string,value:string){return argon2.verify(hash,value);}
export async function signSession(userId:string){return new SignJWT({sub:userId}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(key);}
export async function requireUser(request:FastifyRequest){
  const header=request.headers.authorization||'';
  if(!header.startsWith('Bearer ')) throw Object.assign(new Error('Unauthorized'),{statusCode:401});
  const {payload}=await jwtVerify(header.slice(7),key);
  if(typeof payload.sub!=='string') throw Object.assign(new Error('Unauthorized'),{statusCode:401});
  return payload.sub;
}
export async function requireCompany(userId:string,companyId:string){
  const r=await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND company_id=$2',[userId,companyId]);
  if(!r.rowCount) throw Object.assign(new Error('Forbidden'),{statusCode:403});
  return r.rows[0] as {role:'OWNER'|'ADMIN'|'MEMBER'};
}
