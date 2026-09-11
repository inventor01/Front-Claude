import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { matchNarrative, narrativeFeed } from '@/lib/narratives';
import { samePublicOrigin } from '@/lib/request-origin';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function parseJson<T>(value:string|null|undefined,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
const norm=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const GENERIC_SINGLE=new Set('original originals official sound audio caption video videos photo photos post posts repost reposts reply replies comment comments share shares view views like likes follow follows part episode full live new latest today tonight update updates breaking news meme memes viral trend trends trending funny reaction reactions clip clips edit edits creator creators account accounts user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone everybody thing things stuff something anything name names word words topic topics story stories love hate trade trading buy buying sell selling market markets coin coins token tokens crypto solana tiktok twitter fyp foryou'.split(' '));
function junkTitle(value:string){const parts=norm(value).split(' ').filter(Boolean);return !parts.length||(parts.length===1&&GENERIC_SINGLE.has(parts[0]));}

type Evidence={evidence_id?:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;views?:number|null;likes?:number|null;viewsPerMinute?:number|null};
type Card={id:string;title:string;aliases:string[];stage:string;authors:number;platforms:string[];firstSeen:number;lastSeen:number;evidence:Evidence[]};
type CoinRow={narrative:string;mint:string;observed:number;data:Record<string,unknown>};
type Feed={cards:Card[];coins:CoinRow[]};
type LaunchRow={narrative:string|null;mint:string;name:string;symbol:string|null;seen:number;match_type:string;data:string};
type RichRow={narrative:string;evidence:string;platform:string;author:string;sound_id:string|null;visual_hash:string|null;quoted_url:string|null;related_video_id:string|null};

function postVelocity(row:Evidence,now:number){
 const views=Number(row.views);const published=Number(row.published||row.first_seen);const ageHours=published>0?Math.max(1/60,(now-published)/3600000):null;
 const snapshotRate=Number(row.viewsPerMinute);const derived=Number.isFinite(views)&&views>=0&&ageHours!=null?views/ageHours:0;const observed=Number.isFinite(snapshotRate)&&snapshotRate>=0?snapshotRate*60:0;const viewsPerHour=Math.max(derived,observed);
 const hot=Number.isFinite(views)&&views>=100000&&ageHours!=null&&ageHours<=6||viewsPerHour>=100000;
 const rising=hot||Number.isFinite(views)&&views>=50000&&ageHours!=null&&ageHours<=3||viewsPerHour>=25000;
 return{views:Number.isFinite(views)?views:null,ageHours:ageHours==null?null:Number(ageHours.toFixed(2)),viewsPerHour:Math.round(viewsPerHour),hot,rising,url:row.url,platform:row.platform,author:row.author,content:row.content.slice(0,240),published:row.published};
}
function crossPostCreators(rows:RichRow[]){
 const groups=new Map<string,Set<string>>();
 for(const row of rows){const creator=`${row.platform}:${row.author.toLowerCase()}`;for(const key of [row.sound_id?`sound:${row.sound_id}`:null,row.visual_hash?`visual:${row.visual_hash}`:null,row.quoted_url?`quote:${row.quoted_url}`:null,row.related_video_id?`parent:${row.related_video_id}`:null].filter((x):x is string=>Boolean(x))){const set=groups.get(key)||new Set<string>();set.add(creator);groups.set(key,set);}}
 const creators=new Set<string>();for(const set of groups.values())if(set.size>=2)for(const creator of set)creators.add(creator);return creators.size;
}
const matchRank=(type:string)=>type==='exact'?3:type==='strong'?2:type==='possible'?1:0;

async function buildFeed(owner:string){
 const now=Date.now();
 const stored=await narrativeFeed(db(),owner,{limit:200,offset:0}) as unknown as Feed;
 const launches=(await db().prepare('SELECT narrative,mint,name,symbol,seen,match_type,data FROM launch_events WHERE owner=? ORDER BY seen DESC LIMIT 1000').bind(owner).all<LaunchRow>()).results;
 const launchByKey=new Map(launches.filter((x)=>x.narrative).map((x)=>[`${x.narrative}:${x.mint}`,x]));
 const coins=(stored.coins||[]).filter((coin)=>launchByKey.has(`${coin.narrative}:${coin.mint}`)&&coin.data?.verifiedPumpfun===true);
 const coinsByNarrative=new Map<string,CoinRow[]>();for(const coin of coins){const list=coinsByNarrative.get(coin.narrative)||[];list.push(coin);coinsByNarrative.set(coin.narrative,list);}
 let rich:RichRow[]=[];try{rich=(await db().prepare(`SELECT l.narrative,l.evidence,e.platform,e.author,er.sound_id,er.visual_hash,er.quoted_url,er.related_video_id FROM evidence_links l JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence LEFT JOIN evidence_rich er ON er.owner=e.owner AND er.id=e.id AND er.observed=(SELECT MAX(er2.observed) FROM evidence_rich er2 WHERE er2.owner=e.owner AND er2.id=e.id) WHERE l.owner=? ORDER BY e.last_seen DESC LIMIT 5000`).bind(owner).all<RichRow>()).results;}catch{rich=[];}
 const richByNarrative=new Map<string,RichRow[]>();for(const row of rich){const list=richByNarrative.get(row.narrative)||[];list.push(row);richByNarrative.set(row.narrative,list);}
 const rows=(stored.cards||[]).flatMap((card)=>{
  if(junkTitle(card.title))return[];
  const creatorSet=new Set(card.evidence.map((e)=>`${e.platform}:${e.author.toLowerCase()}`));const platforms=[...new Set(card.evidence.map((e)=>e.platform))];const creators=creatorSet.size;
  if(creators<2)return[];
  const velocities=card.evidence.map((e)=>postVelocity(e,now)).sort((a,b)=>b.viewsPerHour-a.viewsPerHour||(b.views||0)-(a.views||0));
  const hotPosts=velocities.filter((x)=>x.rising).slice(0,5);const maxViewsPerHour=velocities[0]?.viewsPerHour||0;const crossPosted=crossPostCreators(richByNarrative.get(card.id)||[]);
  const cardCoins=(coinsByNarrative.get(card.id)||[]).map((coin)=>{const launch=launchByKey.get(`${coin.narrative}:${coin.mint}`)!;return{mint:coin.mint,name:String(coin.data.name||launch.name||''),symbol:String(coin.data.symbol||launch.symbol||''),matchType:launch.match_type,matchScore:Number((parseJson<Record<string,unknown>>(launch.data,{}).matchScore)||coin.data.matchScore||0),matchReason:String((parseJson<Record<string,unknown>>(launch.data,{}).matchReason)||coin.data.matchReason||launch.match_type),marketCap:Number.isFinite(Number(coin.data.marketCap))?Number(coin.data.marketCap):null,liquidity:Number.isFinite(Number(coin.data.liquidity))?Number(coin.data.liquidity):null,volume24h:Number.isFinite(Number(coin.data.volume24h))?Number(coin.data.volume24h):null,price:Number.isFinite(Number(coin.data.price))?Number(coin.data.price):null,seen:launch.seen,verifiedPumpfun:true};}).sort((a,b)=>matchRank(b.matchType)-matchRank(a.matchType)||(b.marketCap||0)-(a.marketCap||0));
  const visibleCoins=cardCoins.filter((coin)=>coin.matchType==='exact'||coin.matchType==='strong');const possibleCoins=cardCoins.filter((coin)=>coin.matchType==='possible');
  const important=platforms.length>=2||hotPosts.length>0||crossPosted>=2||creators>=3||['Accelerating','Spreading'].includes(card.stage)||visibleCoins.length>0;if(!important)return[];
  const stageBonus:Record<string,number>={Accelerating:26,Spreading:18,'Early watch':10,Observed:4,Cooling:0};let priority=stageBonus[card.stage]||0;priority+=Math.min(24,creators*3)+Math.min(24,Math.log10(1+maxViewsPerHour)*5);priority+=hotPosts.some((x)=>x.hot)?25:hotPosts.length?12:0;priority+=Math.min(15,crossPosted*3);priority+=platforms.length>=2?12:0;priority+=visibleCoins.some((c)=>c.matchType==='exact')?24:visibleCoins.length?16:0;
  const reasons:string[]=[];if(hotPosts.some((x)=>x.hot))reasons.push('100K+ fast post');else if(hotPosts.length)reasons.push('fast engagement');if(maxViewsPerHour>=100000)reasons.push(`${Math.round(maxViewsPerHour/1000)}K views/hr`);if(crossPosted>=2)reasons.push(`${crossPosted} cross-post creators`);if(platforms.length>=2)reasons.push('X + TikTok');if(visibleCoins.length)reasons.push(`${visibleCoins.length} verified Pump.fun match${visibleCoins.length===1?'':'es'}`);
  return[{id:card.id,title:card.title,aliases:card.aliases,stage:card.stage,creators,posts:card.evidence.length,platforms,ageMs:Math.max(0,now-card.firstSeen),lastSeen:card.lastSeen,priority:Number(priority.toFixed(1)),reasons,hotPosts,maxViewsPerHour,crossPostedCreators:crossPosted,coins:visibleCoins,possibleCoins,topMarketCap:Math.max(0,...visibleCoins.map((c)=>c.marketCap||0))||null}];
 }).sort((a,b)=>b.priority-a.priority||b.maxViewsPerHour-a.maxViewsPerHour||b.lastSeen-a.lastSeen);
 return{rows,stats:{narratives:rows.length,hot:rows.filter((r)=>r.hotPosts.length>0).length,verifiedCoins:rows.reduce((sum,r)=>sum+r.coins.length,0),lastSeen:Math.max(0,...rows.map((r)=>r.lastSeen))||null},at:now,note:'Main feed requires independent creator corroboration. Coin rows are shown only when the mint was first verified by a PumpPortal subscribeNewToken/create event.'};
}

async function archiveAndReset(owner:string){
 const now=Date.now(),id=crypto.randomUUID();
 const [snapshots,launches,counts]=await Promise.all([
  db().prepare('SELECT topic_key,topic_title,observed,tier,score,creators,evidence_count,platforms FROM topic_snapshots WHERE owner=? ORDER BY observed DESC LIMIT 300').bind(owner).all(),
  db().prepare('SELECT mint,name,symbol,seen,narrative,match_type,data FROM launch_events WHERE owner=? ORDER BY seen DESC LIMIT 200').bind(owner).all(),
  db().prepare('SELECT (SELECT COUNT(*) FROM narratives WHERE owner=?) narratives,(SELECT COUNT(*) FROM evidence WHERE owner=?) evidence,(SELECT COUNT(*) FROM launch_events WHERE owner=?) launches').bind(owner,owner,owner).first(),
 ]);
 await db().prepare('INSERT INTO learning_archive(owner,id,created,kind,data) VALUES(?,?,?,?,?)').bind(owner,id,now,'active-reset-summary',JSON.stringify({resetAt:now,counts,snapshots:snapshots.results,launches:launches.results})).run();
 await db().batch([
  db().prepare('DELETE FROM narrative_coins WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence_links WHERE owner=?').bind(owner),db().prepare('DELETE FROM narrative_relationships WHERE owner=?').bind(owner),db().prepare('DELETE FROM narratives WHERE owner=?').bind(owner),db().prepare('DELETE FROM observations WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence_rich WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence WHERE owner=?').bind(owner),db().prepare('DELETE FROM topic_rich_snapshots WHERE owner=?').bind(owner),db().prepare('DELETE FROM topic_snapshots WHERE owner=?').bind(owner),db().prepare('DELETE FROM coin_match_queue WHERE owner=?').bind(owner),db().prepare('DELETE FROM launch_events WHERE owner=?').bind(owner),db().prepare('DELETE FROM dashboard_dismissals WHERE owner=?').bind(owner),db().prepare("UPDATE collector SET state='{}',lock_until=0,lock_id='' WHERE owner=?").bind(owner),
 ]);
 return{ok:true,archiveId:id,resetAt:now,preserved:['settings','X/TikTok browser profile','scanner configuration','Pump.fun watches','trades','usage','private learning archive']};
}

export async function GET(){const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);try{return json(await buildFeed(user.userId));}catch(error){return json({error:(error as Error).message},500);}}
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);if(!samePublicOrigin(request))return json({error:'Invalid request origin.'},403);try{const body=await request.json() as {action?:unknown};const action=String(body.action||'');if(action==='refreshCoins'){const feed=await narrativeFeed(db(),user.userId,{limit:40}) as unknown as Feed;let refreshed=0;for(const card of feed.cards.slice(0,25)){await matchNarrative(db(),user.userId,card.id);refreshed++;}return json({ok:true,refreshed});}if(action==='clearAndStartFresh')return json(await archiveAndReset(user.userId));return json({error:'Unknown action.'},400);}catch(error){return json({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},500);}}
