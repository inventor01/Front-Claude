import { getChatGPTUser } from '@/app/chatgpt-auth';
import { noStore } from '@/lib/front-agent-auth';
import { samePublicOrigin } from '@/lib/request-origin';
import { deleteProviderSecret, providerSecretMetadata, putProviderSecret } from '@/lib/front-provider-secrets';
import { environmentTiingoToken, validateTiingoToken } from '@/lib/social-arb-market-data';

export async function GET(){
 const user=await getChatGPTUser();
 if(!user)return noStore({error:'Please sign in to view market-data connection status.'},401);
 try{
  const stored=await providerSecretMetadata(user.userId,'tiingo');
  const environmentConfigured=Boolean(environmentTiingoToken());
  return noStore({
   provider:'tiingo',
   configured:Boolean(stored||environmentConfigured),
   source:stored?'front-encrypted-store':environmentConfigured?'environment':'none',
   lastValidated:stored?.lastValidated||null,
   validationStatus:stored?.validationStatus||null,
   secretVisible:false,
  });
 }catch(error){return noStore({error:(error as Error).message},502);}
}

export async function POST(request:Request){
 const user=await getChatGPTUser();
 if(!user)return noStore({error:'Please sign in to manage market-data connections.'},401);
 if(!samePublicOrigin(request))return noStore({error:'Invalid request origin.'},403);
 try{
  const body=await request.json() as {action?:unknown;token?:unknown};
  if(body.action==='disconnect'){
   const removed=await deleteProviderSecret(user.userId,'tiingo');
   return noStore({
    ok:true,provider:'tiingo',removed,
    configured:Boolean(environmentTiingoToken()),
    source:environmentTiingoToken()?'environment':'none',
   });
  }
  if(body.action!=='connect')return noStore({error:'Unsupported provider action.'},400);
  const token=String(body.token??'').trim();
  if(token.length<8||token.length>4000)return noStore({error:'Enter a valid Tiingo API token.'},400);
  await validateTiingoToken(token);
  const metadata=await putProviderSecret(user.userId,'tiingo',token,Date.now());
  return noStore({
   ok:true,provider:'tiingo',configured:true,source:'front-encrypted-store',
   lastValidated:metadata.lastValidated,validationStatus:metadata.validationStatus,secretVisible:false,
  });
 }catch(error){
  return noStore({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},502);
 }
}
