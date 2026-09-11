import { createHash } from 'node:crypto';

const port=String(process.env.PORT||'8787');
const base=`http://127.0.0.1:${port}`;
const secret=process.env.FRONT_SETTINGS_KEY||'';
const owner=process.env.FRONT_STANDALONE_USER_ID||'';
const internalKey=secret?createHash('sha256').update(`${secret}:launch-watch`).digest('hex'):'';
const normalize=(value)=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const COMMON=new Set('the a an and or for to of in on with is are was were this that it its my your our their new official original coin token meme memecoin crypto sol solana pump fun'.split(' '));
const words=(value)=>normalize(value).split(' ').filter((word)=>word.length>=3&&!COMMON.has(word));
let narratives=[];
let stopped=false;
let socket;
let reconnectTimer;
let refreshTimer;
let attempt=0;

async function refreshNarratives(){
 if(!internalKey||!owner)return;
 try{
  const response=await fetch(`${base}/api/internal/launch-watch`,{headers:{'x-front-internal-key':internalKey}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=await response.json();
  narratives=Array.isArray(data.narratives)?data.narratives:[];
  console.log(`[front-launch] watching ${narratives.length} narratives`);
 }catch(error){console.warn(`[front-launch] narrative refresh failed: ${error instanceof Error?error.message:String(error)}`);}
}
function overlapScore(a,b){const left=new Set(words(a)),right=new Set(words(b));if(!left.size||!right.size)return 0;const overlap=[...left].filter((word)=>right.has(word)).length;return overlap/Math.max(1,Math.min(left.size,right.size));}
function aliasCandidate(name,symbol,alias){const target=normalize(name),ticker=normalize(symbol||''),candidate=normalize(alias);if(!target||!candidate)return null;if(target===candidate||ticker===candidate)return{type:'exact',score:1};const candidateWords=words(candidate),overlap=overlapScore(`${name} ${symbol||''}`,alias),containment=candidate.length>=5&&(target.includes(candidate)||candidate.includes(target));if(containment&&candidateWords.length>=1)return{type:'strong',score:.91};if(candidateWords.length>=2&&overlap>=.66)return{type:'strong',score:.78+Math.min(.12,overlap*.12)};if(candidateWords.length>=1&&overlap>=.5&&candidate.length>=5)return{type:'possible',score:.52+Math.min(.12,overlap*.12)};return null;}
function candidateMatch(name,symbol){const rank={exact:3,strong:2,possible:1};let best=null;for(const narrative of narratives)for(const alias of Array.isArray(narrative.aliases)?narrative.aliases:[]){const hit=aliasCandidate(name,symbol,alias);if(!hit)continue;if(!best||rank[hit.type]>rank[best.type]||(rank[hit.type]===rank[best.type]&&hit.score>best.score))best={narrative,type:hit.type,score:hit.score};}return best;}
function allowedRaw(event){const fields=['txType','signature','marketCapSol','vSolInBondingCurve','vTokensInBondingCurve','initialBuy','traderPublicKey','uri','pool'];return Object.fromEntries(fields.filter((key)=>event[key]!==undefined).map((key)=>[key,event[key]]));}

async function saveMatch(event,match){
 try{
  const response=await fetch(`${base}/api/internal/launch-watch`,{method:'POST',headers:{'content-type':'application/json','x-front-internal-key':internalKey},body:JSON.stringify({mint:event.mint,name:event.name,symbol:event.symbol,seen:Date.now(),raw:{...allowedRaw(event),candidateMatchType:match.type,candidateMatchScore:match.score,narrativeHint:match.narrative.title}})});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=await response.json();
  if(data.matched)console.log(`[front-launch] ${String(data.matchType||match.type).toUpperCase()} MATCH ${event.name} -> ${data.narrative?.title||match.narrative.title}`);
 }catch(error){console.warn(`[front-launch] could not persist match: ${error instanceof Error?error.message:String(error)}`);}
}
function connect(){
 if(stopped||!internalKey||!owner)return;
 if(typeof WebSocket!=='function'){console.warn('[front-launch] WebSocket is unavailable in this Node runtime.');return;}
 socket=new WebSocket('wss://pumpportal.fun/api/data');
 socket.addEventListener('open',()=>{attempt=0;console.log('[front-launch] PumpPortal connected · subscribeNewToken');socket.send(JSON.stringify({method:'subscribeNewToken'}));});
 socket.addEventListener('message',(message)=>{try{const data=JSON.parse(String(message.data));if(data?.txType!=='create'||typeof data?.mint!=='string'||typeof data?.name!=='string')return;const match=candidateMatch(data.name,data.symbol);if(match)void saveMatch(data,match);}catch{}});
 socket.addEventListener('error',()=>console.warn('[front-launch] PumpPortal websocket error'));
 socket.addEventListener('close',()=>{if(stopped)return;const delay=Math.min(30000,1000*2**attempt++);console.warn(`[front-launch] disconnected; retrying in ${delay}ms`);reconnectTimer=setTimeout(connect,delay);});
}
async function start(){
 if(!internalKey||!owner){console.log('[front-launch] disabled: FRONT_SETTINGS_KEY and FRONT_STANDALONE_USER_ID are required.');return;}
 for(let i=0;i<30;i++){try{const response=await fetch(`${base}/api/internal/launch-watch`,{headers:{'x-front-internal-key':internalKey}});if(response.ok){const data=await response.json();narratives=Array.isArray(data.narratives)?data.narratives:[];break;}}catch{}await new Promise((resolve)=>setTimeout(resolve,1000));}
 console.log(`[front-launch] background watcher starting with ${narratives.length} narratives`);
 refreshTimer=setInterval(()=>void refreshNarratives(),60000);refreshTimer.unref?.();connect();
}
function shutdown(){stopped=true;clearTimeout(reconnectTimer);clearInterval(refreshTimer);try{socket?.close();}catch{}process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);void start();
