import { frontCredential } from './external-connections.js';
export type FrontOpportunity={key:string;title:string;status:'SIGNAL_ONLY'|'EARLY_CANDIDATE';confidence:'LOW'|'MEDIUM'|'HIGH';creators:number;platforms:string[];ageHours:number|null;purchaseIntentMentions:number;socialProofMentions:number;creativePatterns:string[];evidenceCount:number;evidence:Array<{id:string;url:string;platform:string;author:string;excerpt:string;views:number|null;likes:number|null}>;notes:string[]};
export async function getCommerceOpportunities(companyId:string,query=''){
  const connected=await frontCredential(companyId);
  const base=connected?.baseUrl||process.env.FRONT_COMMERCE_URL, key=connected?.apiKey||process.env.FRONT_COMMERCE_API_KEY;
  if(!base||!key) throw Object.assign(new Error('BLOCKED_EXTERNAL_AUTH: Front Intelligence is not configured'),{code:'AUTH_REQUIRED'});
  const url=new URL('/api/commerce-intel',base); if(query)url.searchParams.set('q',query);
  const response=await fetch(url,{headers:{'x-front-commerce-key':key}});
  if(!response.ok) throw new Error(`Front-Commerce ${response.status}: ${await response.text()}`);
  const data=await response.json() as {opportunities:FrontOpportunity[];contract:{launchAuthority:boolean};diagnostics:Record<string,unknown>};
  if(data.contract?.launchAuthority!==false) throw new Error('Front-Commerce contract violation');
  return data;
}
