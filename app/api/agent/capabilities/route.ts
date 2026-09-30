import { db, noStore, requireService } from '@/lib/front-agent-auth';
export async function GET(request:Request){
  try{
    const owner=requireService(request),now=Date.now();
    const bridge=await db().prepare('SELECT id,status,last_seen,capabilities FROM bridge_agents WHERE owner=? ORDER BY last_seen DESC LIMIT 1').bind(owner).first<any>();
    let capabilities:any={};try{capabilities=bridge?.capabilities?JSON.parse(bridge.capabilities):{};}catch{}
    const online=Boolean(bridge&&now-Number(bridge.last_seen||0)<45_000);
    return noStore({service:'front',role:'intelligence-only',launchAuthority:false,scrollJobs:true,platforms:['X','TikTok','Instagram'],requiresLocalBridge:true,
      bridge:{online,id:bridge?.id||null,lastSeen:bridge?.last_seen||null,authenticatedPlatforms:Array.isArray(capabilities.authenticatedPlatforms)?capabilities.authenticatedPlatforms:[],capabilities}});
  }catch(error){if(error instanceof Response)return error;return noStore({error:(error as Error).message},500);}
}
