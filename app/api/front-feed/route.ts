import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { applyLearning, buildLearningPolicy, learningFeatures, type LearningArchiveRecord, type LearningOutcome } from '@/lib/front-learning';
import { matchNarrative, narrativeFeed } from '@/lib/narratives';
import { isNarrativeLabelJunk, narrativeLabelContains, normalizeNarrativeText, semanticCrossPlatformEvidence, specificNarrativeTerms } from '@/lib/narrative-quality';
import { samePublicOrigin } from '@/lib/request-origin';

const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function parseJson<T>(value:string|null|undefined,fallback:T):T{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}}
function numericOrNull(value:unknown){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}

type Evidence={evidence_id?:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;views?:number|null;likes?:number|null;viewsPerMinute?:number|null};
type Card={id:string;title:string;aliases:string[];stage:string;authors:number;platforms:string[];firstSeen:number;lastSeen:number;evidence:Evidence[]};
type CoinRow={narrative:string;mint:string;observed:number;data:Record<string,unknown>};
type Feed={cards:Card[];coins:CoinRow[]};
type LaunchRow={narrative:string|null;mint:string;name:string;symbol:string|null;seen:number;match_type:string;data:string};
type RichRow={narrative:string;evidence:string;platform:string;author:string;sound_id:string|null;visual_hash:string|null;quoted_url:string|null;related_video_id:string|null};
type LearningDbRow={id:string;created:number;kind:string;data:string};
type HotPost={url:string;platform:string;author:string;content:string;published:number|null;views:number|null;likes:number|null;ageHours:number|null;viewsPerHour:number;likesPerHour:number;hot:boolean;rising:boolean};
type OutputCoin={mint:string;name:string;symbol:string;matchType:string;matchScore:number;matchReason:string;marketCap:number|null;liquidity:number|null;volume24h:number|null;price:number|null;seen:number;verifiedPumpfun:true};
type LearningReason={label:string;points:number;examples:number};
type OutputRow={id:string;title:string;aliases:string[];stage:string;creators:number;posts:number;platforms:string[];ageMs:number;lastSeen:number;priority:number;reasons:string[];hotPosts:HotPost[];maxViewsPerHour:number;maxLikesPerHour:number;crossPostedCreators:number;semanticCrossPlatformCreators:number;coins:OutputCoin[];possibleCoins:OutputCoin[];topMarketCap:number|null;learnedAdjustment:number;learningReasons:LearningReason[];_evidenceIds:string[]};

type FeedbackData={narrativeId?:string;label?:'useful'|'not-relevant'};

function postVelocity(row:Evidence,now:number):HotPost{
 const views=numericOrNull(row.views),likes=numericOrNull(row.likes),published=Number(row.published||row.first_seen);const ageHours=published>0?Math.max(1/60,(now-published)/3600000):null;
 const snapshotRate=numericOrNull(row.viewsPerMinute),derived=views!=null&&ageHours!=null?views/ageHours:0,observed=snapshotRate!=null?snapshotRate*60:0;const viewsPerHour=Math.max(derived,observed),likesPerHour=likes!=null&&ageHours!=null?likes/ageHours:0;
 const viewHot=views!=null&&ageHours!=null&&views>=100000&&ageHours<=6||viewsPerHour>=100000;const engagementHot=likes!=null&&ageHours!=null&&likes>=10000&&ageHours<=6||likesPerHour>=5000;
 const hot=viewHot||engagementHot;const rising=hot||(views!=null&&ageHours!=null&&views>=50000&&ageHours<=3)||viewsPerHour>=25000||(likes!=null&&ageHours!=null&&likes>=5000&&ageHours<=3)||likesPerHour>=2000;
 return{views,likes,ageHours:ageHours==null?null:Number(ageHours.toFixed(2)),viewsPerHour:Math.round(viewsPerHour),likesPerHour:Math.round(likesPerHour),hot,rising,url:row.url,platform:row.platform,author:row.author,content:row.content.slice(0,240),published:row.published};
}
function crossPostCreators(rows:RichRow[]){const groups=new Map<string,Set<string>>();for(const row of rows){const creator=`${row.platform}:${row.author.toLowerCase()}`;for(const key of [row.sound_id?`sound:${row.sound_id}`:null,row.visual_hash?`visual:${row.visual_hash}`:null,row.quoted_url?`quote:${row.quoted_url}`:null,row.related_video_id?`parent:${row.related_video_id}`:null].filter((x):x is string=>Boolean(x))){const set=groups.get(key)||new Set<string>();set.add(creator);groups.set(key,set);}}const creators=new Set<string>();for(const set of groups.values())if(set.size>=2)for(const creator of set)creators.add(creator);return creators.size;}
const matchRank=(type:string)=>type==='exact'?3:type==='strong'?2:type==='possible'?1:0;
function evidenceOverlap(a:OutputRow,b:OutputRow){const left=new Set(a._evidenceIds),right=new Set(b._evidenceIds),shared=[...left].filter((id)=>right.has(id)).length;return{shared,ratio:shared/Math.max(1,Math.min(left.size,right.size))};}
function sameFeedEvent(a:OutputRow,b:OutputRow){const exact=normalizeNarrativeText(a.title)===normalizeNarrativeText(b.title),containment=narrativeLabelContains(a.title,b.title);if(!exact&&!containment)return false;const overlap=evidenceOverlap(a,b);return exact||overlap.shared>=2&&overlap.ratio>=.6;}
function mergeFeedDuplicates(rows:OutputRow[]){
 const out:OutputRow[]=[];for(const row of rows){const index=out.findIndex((old)=>sameFeedEvent(old,row));if(index<0){out.push(row);continue;}const old=out[index],oldTerms=specificNarrativeTerms(old.title).length,rowTerms=specificNarrativeTerms(row.title).length;const primary=rowTerms>oldTerms?row:old,secondary=primary===row?old:row;primary.aliases=[...new Set([...primary.aliases,...secondary.aliases,secondary.title])].filter((alias)=>!isNarrativeLabelJunk(alias)).slice(0,18);primary.reasons=[...new Set([...primary.reasons,...secondary.reasons])].slice(0,8);primary.coins=[...new Map([...primary.coins,...secondary.coins].map((coin)=>[coin.mint,coin])).values()].sort((a,b)=>matchRank(b.matchType)-matchRank(a.matchType)||(b.marketCap||0)-(a.marketCap||0));primary.possibleCoins=[...new Map([...primary.possibleCoins,...secondary.possibleCoins].map((coin)=>[coin.mint,coin])).values()];primary.hotPosts=[...new Map([...primary.hotPosts,...secondary.hotPosts].map((post)=>[post.url,post])).values()].sort((a,b)=>b.viewsPerHour-a.viewsPerHour||b.likesPerHour-a.likesPerHour).slice(0,6);primary.priority=Math.max(primary.priority,secondary.priority);primary.creators=Math.max(primary.creators,secondary.creators);primary.posts=Math.max(primary.posts,secondary.posts);primary.maxViewsPerHour=Math.max(primary.maxViewsPerHour,secondary.maxViewsPerHour);primary.maxLikesPerHour=Math.max(primary.maxLikesPerHour,secondary.maxLikesPerHour);primary.crossPostedCreators=Math.max(primary.crossPostedCreators,secondary.crossPostedCreators);primary.semanticCrossPlatformCreators=Math.max(primary.semanticCrossPlatformCreators,secondary.semanticCrossPlatformCreators);primary._evidenceIds=[...new Set([...primary._evidenceIds,...secondary._evidenceIds])];primary.topMarketCap=Math.max(0,...primary.coins.map((coin)=>coin.marketCap||0))||null;out[index]=primary;}
 return out.sort((a,b)=>b.priority-a.priority||b.maxViewsPerHour-a.maxViewsPerHour||b.maxLikesPerHour-a.maxLikesPerHour||b.lastSeen-a.lastSeen);
}

async function learningState(owner:string){
 const rows=(await db().prepare("SELECT id,created,kind,data FROM learning_archive WHERE owner=? AND kind IN ('ranking-feedback','verified-outcome') ORDER BY created DESC LIMIT 2000").bind(owner).all<LearningDbRow>()).results;
 const records:LearningArchiveRecord[]=rows.map((row)=>({kind:row.kind,data:parseJson<unknown>(row.data,null)}));
 const policy=buildLearningPolicy(records),feedback:Record<string,'useful'|'not-relevant'>={};
 for(const row of rows){if(row.kind!=='ranking-feedback')continue;const data=parseJson<FeedbackData>(row.data,{});if(data.narrativeId&&(data.label==='useful'||data.label==='not-relevant'))feedback[data.narrativeId]=data.label;}
 return{policy,feedback};
}

async function recordVerifiedOutcomes(owner:string,rows:OutputRow[],now:number){
 const statements:D1PreparedStatement[]=[];
 for(const row of rows.slice(0,50)){
  const detectedAt=now-row.ageMs,features=learningFeatures(row);
  for(const coin of row.coins){
   if(!['exact','strong'].includes(coin.matchType)||coin.seen<detectedAt)continue;
   const outcomes:LearningOutcome[]=['coin-created'];
   if((coin.marketCap||0)>=25000)outcomes.push('mc-25k');
   if((coin.marketCap||0)>=100000)outcomes.push('mc-100k');
   if((coin.marketCap||0)>=500000)outcomes.push('mc-500k');
   for(const outcome of outcomes){
    const id=`outcome:${row.id}:${coin.mint}:${outcome}`;
    const data=JSON.stringify({narrativeId:row.id,title:row.title,mint:coin.mint,outcome,features,detectedAt,launchSeen:coin.seen,marketCap:coin.marketCap,recordedAt:now});
    statements.push(db().prepare('INSERT OR IGNORE INTO learning_archive(owner,id,created,kind,data) VALUES(?,?,?,?,?)').bind(owner,id,now,'verified-outcome',data));
    if(statements.length>=80)break;
   }
   if(statements.length>=80)break;
  }
  if(statements.length>=80)break;
 }
 if(statements.length)await db().batch(statements);
}

async function buildFeed(owner:string,options:{recordOutcomes?:boolean}={}){
 const now=Date.now();
 const [stored,learned]=await Promise.all([narrativeFeed(db(),owner,{limit:200,offset:0}) as unknown as Promise<Feed>,learningState(owner)]);
 const launches=(await db().prepare('SELECT narrative,mint,name,symbol,seen,match_type,data FROM launch_events WHERE owner=? ORDER BY seen DESC LIMIT 1000').bind(owner).all<LaunchRow>()).results;
 const launchByKey=new Map(launches.filter((x)=>x.narrative).map((x)=>[`${x.narrative}:${x.mint}`,x]));const coins=(stored.coins||[]).filter((coin)=>launchByKey.has(`${coin.narrative}:${coin.mint}`)&&coin.data?.verifiedPumpfun===true);const coinsByNarrative=new Map<string,CoinRow[]>();for(const coin of coins){const list=coinsByNarrative.get(coin.narrative)||[];list.push(coin);coinsByNarrative.set(coin.narrative,list);}
 let rich:RichRow[]=[];try{rich=(await db().prepare(`SELECT l.narrative,l.evidence,e.platform,e.author,er.sound_id,er.visual_hash,er.quoted_url,er.related_video_id FROM evidence_links l JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence LEFT JOIN evidence_rich er ON er.owner=e.owner AND er.id=e.id AND er.observed=(SELECT MAX(er2.observed) FROM evidence_rich er2 WHERE er2.owner=e.owner AND er2.id=e.id) WHERE l.owner=? ORDER BY e.last_seen DESC LIMIT 5000`).bind(owner).all<RichRow>()).results;}catch{rich=[];}const richByNarrative=new Map<string,RichRow[]>();for(const row of rich){const list=richByNarrative.get(row.narrative)||[];list.push(row);richByNarrative.set(row.narrative,list);}
 const rawRows=(stored.cards||[]).flatMap((card):OutputRow[]=>{
  if(isNarrativeLabelJunk(card.title))return[];const titleSpecific=specificNarrativeTerms(card.title);if(!titleSpecific.length)return[];
  const creatorSet=new Set(card.evidence.map((e)=>`${e.platform}:${e.author.toLowerCase()}`)),platforms=[...new Set(card.evidence.map((e)=>e.platform))],creators=creatorSet.size;if(creators<2)return[];
  if(normalizeNarrativeText(card.title).split(' ').length===1&&creators<3)return[];
  const velocities=card.evidence.map((e)=>postVelocity(e,now)).sort((a,b)=>b.viewsPerHour-a.viewsPerHour||b.likesPerHour-a.likesPerHour||(b.views||0)-(a.views||0));const hotPosts=velocities.filter((x)=>x.rising).slice(0,6),maxViewsPerHour=velocities[0]?.viewsPerHour||0,maxLikesPerHour=Math.max(0,...velocities.map((x)=>x.likesPerHour));const crossPosted=crossPostCreators(richByNarrative.get(card.id)||[]),semanticCross=semanticCrossPlatformEvidence(card.evidence,card.title);
  const cardCoins=(coinsByNarrative.get(card.id)||[]).map((coin)=>{const launch=launchByKey.get(`${coin.narrative}:${coin.mint}`)!,launchData=parseJson<Record<string,unknown>>(launch.data,{});return{mint:coin.mint,name:String(coin.data.name||launch.name||''),symbol:String(coin.data.symbol||launch.symbol||''),matchType:launch.match_type,matchScore:Number(launchData.matchScore||coin.data.matchScore||0),matchReason:String(launchData.matchReason||coin.data.matchReason||launch.match_type),marketCap:numericOrNull(coin.data.marketCap),liquidity:numericOrNull(coin.data.liquidity),volume24h:numericOrNull(coin.data.volume24h),price:numericOrNull(coin.data.price),seen:launch.seen,verifiedPumpfun:true as const};}).sort((a,b)=>matchRank(b.matchType)-matchRank(a.matchType)||(b.marketCap||0)-(a.marketCap||0));
  const visibleCoins=cardCoins.filter((coin)=>coin.matchType==='exact'||coin.matchType==='strong'),possibleCoins=cardCoins.filter((coin)=>coin.matchType==='possible');
  const accelerating=['Accelerating','Spreading'].includes(card.stage),strongSignal=semanticCross.corroborated||hotPosts.length>0||crossPosted>=2||accelerating||visibleCoins.length>0;if(!strongSignal)return[];
  const stageBonus:Record<string,number>={Accelerating:26,Spreading:18,'Early watch':8,Observed:2,Cooling:0};let priority=stageBonus[card.stage]||0;priority+=Math.min(20,creators*2.5)+Math.min(24,Math.log10(1+maxViewsPerHour)*5)+Math.min(12,Math.log10(1+maxLikesPerHour)*2.5);priority+=hotPosts.some((x)=>x.hot)?25:hotPosts.length?12:0;priority+=Math.min(15,crossPosted*3);priority+=semanticCross.corroborated?16:0;priority+=visibleCoins.some((c)=>c.matchType==='exact')?24:visibleCoins.length?16:0;
  const reasons:string[]=[];if(hotPosts.some((x)=>x.hot&&x.views!=null&&x.views>=100000))reasons.push('100K+ fast post');else if(hotPosts.length)reasons.push('fast engagement');if(maxViewsPerHour>=100000)reasons.push(`${Math.round(maxViewsPerHour/1000)}K views/hr`);else if(maxLikesPerHour>=2000)reasons.push(`${Math.round(maxLikesPerHour/1000)}K likes/hr`);if(crossPosted>=2)reasons.push(`${crossPosted} cross-post creators`);if(semanticCross.corroborated)reasons.push('X ↔ TikTok same event');if(visibleCoins.length)reasons.push(`${visibleCoins.length} verified Pump.fun match${visibleCoins.length===1?'':'es'}`);
  return[{id:card.id,title:card.title,aliases:card.aliases.filter((alias)=>!isNarrativeLabelJunk(alias)),stage:card.stage,creators,posts:card.evidence.length,platforms,ageMs:Math.max(0,now-card.firstSeen),lastSeen:card.lastSeen,priority:Number(priority.toFixed(1)),reasons,hotPosts,maxViewsPerHour,maxLikesPerHour,crossPostedCreators:crossPosted,semanticCrossPlatformCreators:semanticCross.creators,coins:visibleCoins,possibleCoins,topMarketCap:Math.max(0,...visibleCoins.map((c)=>c.marketCap||0))||null,learnedAdjustment:0,learningReasons:[],_evidenceIds:card.evidence.map((e)=>e.evidence_id||e.url)}];
 });
 const ranked=mergeFeedDuplicates(rawRows).map((row)=>{const applied=applyLearning(learningFeatures(row),learned.policy);return{...row,priority:Number((row.priority+applied.adjustment).toFixed(1)),learnedAdjustment:applied.adjustment,learningReasons:applied.reasons.map((reason)=>({label:reason.label,points:reason.points,examples:reason.examples}))};}).sort((a,b)=>b.priority-a.priority||b.maxViewsPerHour-a.maxViewsPerHour||b.maxLikesPerHour-a.maxLikesPerHour||b.lastSeen-a.lastSeen);
 if(options.recordOutcomes!==false)await recordVerifiedOutcomes(owner,ranked,now);
 const rows=ranked.map(({_evidenceIds,...row})=>row);
 return{rows,stats:{narratives:rows.length,hot:rows.filter((r)=>r.hotPosts.length>0).length,verifiedCoins:rows.reduce((sum,r)=>sum+r.coins.length,0),lastSeen:Math.max(0,...rows.map((r)=>r.lastSeen))||null},learning:{examples:learned.policy.examples,feedback:learned.policy.feedback,positive:learned.policy.positive,negative:learned.policy.negative,outcomes:learned.policy.outcomes,activeFeatures:learned.policy.activeFeatures,minExamplesPerFeature:5,maxAdjustment:15},feedback:learned.feedback,at:now,note:'Hard narrative-quality gates stay fixed. Private feedback and verified post-detection Pump.fun outcomes may only make a bounded ranking adjustment after enough comparable examples.'};
}

async function saveFeedback(owner:string,narrativeId:string,label:'useful'|'not-relevant'){
 const feed=await buildFeed(owner,{recordOutcomes:false}),row=feed.rows.find((item)=>item.id===narrativeId);if(!row)throw new Error('Narrative is no longer in the qualified priority feed.');
 const now=Date.now(),features=learningFeatures(row),data=JSON.stringify({narrativeId:row.id,title:row.title,label,features,priority:row.priority,recordedAt:now});
 await db().prepare('INSERT INTO learning_archive(owner,id,created,kind,data) VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET created=excluded.created,kind=excluded.kind,data=excluded.data').bind(owner,`feedback:${row.id}`,now,'ranking-feedback',data).run();
 const learned=await learningState(owner);return{ok:true,narrativeId:row.id,label,learning:{examples:learned.policy.examples,feedback:learned.policy.feedback,positive:learned.policy.positive,negative:learned.policy.negative,outcomes:learned.policy.outcomes,activeFeatures:learned.policy.activeFeatures}};
}

async function archiveAndReset(owner:string){const now=Date.now(),id=crypto.randomUUID();const[snapshots,launches,counts]=await Promise.all([db().prepare('SELECT topic_key,topic_title,observed,tier,score,creators,evidence_count,platforms FROM topic_snapshots WHERE owner=? ORDER BY observed DESC LIMIT 300').bind(owner).all(),db().prepare('SELECT mint,name,symbol,seen,narrative,match_type,data FROM launch_events WHERE owner=? ORDER BY seen DESC LIMIT 200').bind(owner).all(),db().prepare('SELECT (SELECT COUNT(*) FROM narratives WHERE owner=?) narratives,(SELECT COUNT(*) FROM evidence WHERE owner=?) evidence,(SELECT COUNT(*) FROM launch_events WHERE owner=?) launches').bind(owner,owner,owner).first()]);await db().prepare('INSERT INTO learning_archive(owner,id,created,kind,data) VALUES(?,?,?,?,?)').bind(owner,id,now,'active-reset-summary',JSON.stringify({resetAt:now,counts,snapshots:snapshots.results,launches:launches.results})).run();await db().batch([db().prepare('DELETE FROM narrative_coins WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence_links WHERE owner=?').bind(owner),db().prepare('DELETE FROM narrative_relationships WHERE owner=?').bind(owner),db().prepare('DELETE FROM narratives WHERE owner=?').bind(owner),db().prepare('DELETE FROM observations WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence_rich WHERE owner=?').bind(owner),db().prepare('DELETE FROM evidence WHERE owner=?').bind(owner),db().prepare('DELETE FROM topic_rich_snapshots WHERE owner=?').bind(owner),db().prepare('DELETE FROM topic_snapshots WHERE owner=?').bind(owner),db().prepare('DELETE FROM coin_match_queue WHERE owner=?').bind(owner),db().prepare('DELETE FROM launch_events WHERE owner=?').bind(owner),db().prepare('DELETE FROM dashboard_dismissals WHERE owner=?').bind(owner),db().prepare("UPDATE collector SET state='{}',lock_until=0,lock_id='' WHERE owner=?").bind(owner)]);return{ok:true,archiveId:id,resetAt:now,preserved:['settings','X/TikTok browser profile','scanner configuration','Pump.fun watches','trades','usage','private learning archive']};}

export async function GET(){const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);try{return json(await buildFeed(user.userId));}catch(error){return json({error:(error as Error).message},500);}}
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return json({error:'Please sign in.'},401);if(!samePublicOrigin(request))return json({error:'Invalid request origin.'},403);try{const body=await request.json() as {action?:unknown;narrativeId?:unknown;label?:unknown};const action=String(body.action||'');if(action==='refreshCoins'){const feed=await narrativeFeed(db(),user.userId,{limit:40}) as unknown as Feed;let refreshed=0;for(const card of feed.cards.slice(0,25)){if(isNarrativeLabelJunk(card.title))continue;await matchNarrative(db(),user.userId,card.id);refreshed++;}return json({ok:true,refreshed});}if(action==='feedback'){const narrativeId=String(body.narrativeId||'').trim(),label=String(body.label||'');if(!narrativeId||!['useful','not-relevant'].includes(label))return json({error:'Invalid feedback.'},400);return json(await saveFeedback(user.userId,narrativeId,label as 'useful'|'not-relevant'));}if(action==='clearAndStartFresh')return json(await archiveAndReset(user.userId));return json({error:'Unknown action.'},400);}catch(error){return json({error:error instanceof SyntaxError?'Invalid request.':(error as Error).message},500);}}
