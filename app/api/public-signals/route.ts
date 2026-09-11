import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { publicSignals } from '@/lib/providers';

const db = () => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const UI_NOISE = /^(show|show more|more|see more|view|view more|read more|explore|home|for you|trending|trend|news|sports|entertainment|posts?|replies?|likes?|views?|share|bookmark|follow|following|hashtag|hashtags|caption|video|videos|photo|photos|sound|original sound|user|username|creator|account|profile|quote|reply|replies|repost|reposts?)$/i;
const SOCIAL_NOTIFICATION = /\b(?:and\s+\d[\d,.]*\s+others?\s+)?(?:liked|likes|reposted|reposts|quoted|quotes|followed|follows|mentioned|mentions|shared|shares)\s+(?:your|a|this)\s+(?:video|post|tweet|photo|comment|reply)\b/i;
const NUMERIC_ONLY = /^\s*[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?\s*$/i;
const METRIC_PHRASE = /^\s*[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T)?\s+(?:views?|likes?|posts?|replies?|comments?|shares?|reposts?)\s*$/i;
const GENERIC = new Set('meme memes viral virality reaction reactions clip clips trend trends trending story stories update updates breaking news funny internet tiktok twitter tweet tweets social media creator creators fyp foryou foryoupage hashtag hashtags caption video videos photo photos sound user username account profile'.split(' '));
const BROAD = new Set('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial'.split(' '));
const STOP = new Set('the a an and or but this that these those to of in on at for from with is are was were be been it its i you your we our they their he she his her not no just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video watch post posts people thing things time day get got like know think make made going go went see saw says said say look looks looking why how when where who which there here want wants wanted gonna gotta lol omg yeah yep okay ok good great best bad big small still even much many another first last every really literally actually'.split(' '));
const COMMON_SINGLE = new Set('never always sometimes often usually maybe probably perhaps someone somebody anyone anybody everyone everybody something anything everything nothing somewhere anywhere everywhere nowhere trade trading buy buying sell selling blue red green black white orange yellow pink purple brown grey gray dark light big small old young high low hot cold fast slow early late long short better worse best worst free paid money price prices cost costs deal deals work works working worked use used using try trying tried start started starting stop stopped stopping keep keeps keeping kept need needs needed want wants wanted help helps helped find finds found show shows showing see sees seeing look looks looking tell tells told ask asks asked say says said feel feels felt think thinks thought know knows knew believe believes believed love loves loved hate hates hated like likes liked follow follows followed watch watches watched share shares shared click clicks clicked open opens opened close closes closed run runs running ran play plays playing played move moves moving moved turn turns turned call calls called name names named word words post posts video videos photo photos account accounts profile profiles creator creators user users person persons people guy guys girl girls man men woman women kid kids child children friend friends bro dude team teams game games song songs movie movies food foods car cars phone phones app apps site sites page pages link links number numbers thing things stuff part parts way ways place places home homes room rooms school schools job jobs business businesses company companies product products service services market markets coin coins token tokens story stories news update updates topic topics idea ideas question questions answer answers comment comments reply replies'.split(' '));
const PLATFORM_TAG = new Set('fyp fy foryou foryoupage viral viralvideo viralvideos trending trend tiktok tiktokviral tiktoktrend tiktoktrending capcut edit edits funny comedy humor explore explorepage xyzbca xyzabc fypppp'.split(' '));
const RAW_TOPIC_SOURCES = new Set(['x-trending','tiktok-trending']);
const SOURCE_ORDER = ['early-candidate','x-trending','tiktok-trending','google-trends','market-theme'];
const SEED_PROVENANCE = /(?:X Explore|TikTok Creative Center)/i;

type BrowserRow = {id:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;last_seen:number;provenance:string;views:number|null;likes:number|null};
type LinkRow = { evidence:string; narrative:string; title:string };
type PublicStatus = 'Raw signal'|'Early candidate'|'Promoted';
type PublicItem = {id:string;source:string;sourceKey:string;title:string;query:string;url:string;observed:number;published:number|null;views:number|null;likes:number|null;status:PublicStatus;narrative?:{id:string;title:string}|null;detail:string;quality?:number};
type CandidateLabel={key:string;label:string;kind:'name'|'token'|'phrase'};
type CandidateGroup={labels:Map<string,number>;rows:BrowserRow[];authors:Set<string>;platforms:Set<string>;kinds:Set<CandidateLabel['kind']>};

function sourceFor(row: BrowserRow) {
  const p = row.provenance;
  if (/X Explore/i.test(p)) return { source: 'X Trending', key: 'x-trending' };
  if (/X Home/i.test(p)) return { source: 'X Feed', key: 'x-feed' };
  if (/X Latest search/i.test(p)) return { source: 'X Search', key: 'x-search' };
  if (/TikTok Creative Center/i.test(p)) return { source: 'TikTok Trending', key: 'tiktok-trending' };
  if (/TikTok Explore/i.test(p)) return { source: 'TikTok Explore', key: 'tiktok-explore' };
  if (/TikTok search/i.test(p)) return { source: 'TikTok Search', key: 'tiktok-search' };
  return row.platform === 'X' ? { source: 'X Browser', key: 'x-browser' } : { source: 'TikTok Browser', key: 'tiktok-browser' };
}
function cleanCandidate(value:string){return value.replace(/^#/,'').replace(/^[-·•\s]+|[-·•\s]+$/g,'').replace(/\s+/g,' ').trim();}
function authorLike(title:string,author:string){const a=normalize(author.replace(/^@/,'')),t=normalize(title.replace(/^@/,''));return Boolean(a&&t&&(t===a||t===`${a} ${a}`));}
function slugTopic(url:string){try{const u=new URL(url);const parts=u.pathname.split('/').filter(Boolean);const index=parts.findIndex((part)=>part==='hashtag'||part==='trend'||part==='trends');if(index>=0&&parts[index+1])return decodeURIComponent(parts[index+1]).replace(/[-_]+/g,' ').trim();}catch{}return '';}
function isJunkLabel(value:string,author=''){
  const clean=cleanCandidate(value);if(!clean||clean.length<2||UI_NOISE.test(clean)||SOCIAL_NOTIFICATION.test(clean)||NUMERIC_ONLY.test(clean)||METRIC_PHRASE.test(clean))return true;
  if(author&&authorLike(clean,author))return true;
  if(/^@?[A-Za-z0-9_.]{2,40}$/.test(clean)&&author&&normalize(clean)===normalize(author))return true;
  return false;
}
function topicTitle(row:BrowserRow){
  if(SOCIAL_NOTIFICATION.test(row.content))return '';
  if(/TikTok Creative Center/i.test(row.provenance)){const slug=slugTopic(row.url);if(slug&&!isJunkLabel(slug,row.author))return slug.slice(0,120);}
  const chunks=row.content.split(/\s+·\s+|\n+/).map(cleanCandidate).filter(Boolean);
  const hashtag=row.content.match(/#([\p{L}\p{N}_]{3,80})/u)?.[1]?.replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/_/g,' ');
  if(hashtag&&!isJunkLabel(hashtag,row.author))return hashtag.slice(0,120);
  return (chunks.find((part)=>!isJunkLabel(part,row.author)&&!/^trending in\b/i.test(part))||'').slice(0,120);
}
function dedupe(items:PublicItem[]){const out=new Map<string,PublicItem>();const rank:Record<PublicStatus,number>={'Raw signal':0,'Early candidate':1,'Promoted':2};for(const item of items){if(isJunkLabel(item.title))continue;const key=`${item.sourceKey}:${normalize(item.title)}`;const old=out.get(key);if(!old||rank[item.status]>rank[old.status]||(item.quality||0)>(old.quality||0)||item.observed>old.observed)out.set(key,item);}return[...out.values()];}
function balanced(items:PublicItem[]){const buckets=new Map<string,PublicItem[]>();for(const item of items){const list=buckets.get(item.sourceKey)||[];list.push(item);buckets.set(item.sourceKey,list);}for(const list of buckets.values())list.sort((a,b)=>(b.quality||0)-(a.quality||0)||b.observed-a.observed);const keys=[...SOURCE_ORDER.filter((k)=>buckets.has(k)),...[...buckets.keys()].filter((k)=>!SOURCE_ORDER.includes(k))];const result:PublicItem[]=[];let added=true;while(added){added=false;for(const key of keys){const item=buckets.get(key)?.shift();if(item){result.push(item);added=true;}}}return result;}
function lowValueToken(token:string){return STOP.has(token)||GENERIC.has(token)||BROAD.has(token)||COMMON_SINGLE.has(token)||PLATFORM_TAG.has(token)||/^\d+$/.test(token);}
function words(value:string){return normalize(value).split(' ').filter((token)=>token.length>=3&&!lowValueToken(token));}
function stripHashtags(value:string){return value.replace(/#[\p{L}\p{N}_]{2,80}/gu,' ').replace(/\s+/g,' ').trim();}
function isSeedEvidence(row:BrowserRow){return SEED_PROVENANCE.test(row.provenance)||normalize(row.author)==='x explore'||normalize(row.author)==='tiktok creative center';}
function candidateLabels(row:BrowserRow):CandidateLabel[]{
  const out=new Map<string,CandidateLabel>();
  const add=(raw:string,kind:CandidateLabel['kind'])=>{const label=cleanCandidate(raw).slice(0,80),key=normalize(label),tokens=words(label);if(!key||isJunkLabel(label,row.author)||!tokens.length)return;if(!out.has(key))out.set(key,{key,label,kind});};
  const body=stripHashtags(row.content);
  for(const match of body.matchAll(/\b[A-Z][\p{L}\p{N}'’_-]{2,30}(?:\s+[A-Z][\p{L}\p{N}'’_-]{2,30}){0,2}\b/gu))add(match[0],'name');
  const normalizedWords=words(body).slice(0,60);for(const token of normalizedWords)if(token.length>=4&&token.length<=30)add(token,'token');
  for(let size=2;size<=4;size++)for(let i=0;i<=normalizedWords.length-size;i++)add(normalizedWords.slice(i,i+size).join(' '),'phrase');
  return[...out.values()];
}
function buildEarlyCandidates(rows:BrowserRow[],linked:Set<string>,now:number):PublicItem[]{
  const groups=new Map<string,CandidateGroup>();
  for(const row of rows){
    if(linked.has(row.id)||row.last_seen<now-36*3600000||isSeedEvidence(row))continue;
    for(const candidate of candidateLabels(row)){
      const group=groups.get(candidate.key)||{labels:new Map<string,number>(),rows:[],authors:new Set<string>(),platforms:new Set<string>(),kinds:new Set<CandidateLabel['kind']>()};
      if(!group.rows.some((item)=>item.id===row.id))group.rows.push(row);
      group.authors.add(`${row.platform}:${row.author.toLowerCase()}`);group.platforms.add(row.platform);group.kinds.add(candidate.kind);group.labels.set(candidate.label,(group.labels.get(candidate.label)||0)+1);groups.set(candidate.key,group);
    }
  }
  return[...groups.entries()].flatMap(([key,group])=>{
    const label=[...group.labels.entries()].sort((a,b)=>b[1]-a[1]||b[0].split(' ').length-a[0].split(' ').length||a[0].length-b[0].length)[0]?.[0]||key;
    const labelWords=normalize(label).split(' ').filter(Boolean),structured=(group.kinds.has('name')||group.kinds.has('phrase'))&&labelWords.length>=2,cross=group.platforms.size>1;
    const enough=labelWords.length===1?(group.authors.size>=3||(cross&&group.authors.size>=2)):structured?group.authors.size>=2:group.authors.size>=3||(cross&&group.authors.size>=2);
    if(!enough||!words(label).length)return[];
    const top=[...group.rows].sort((a,b)=>((b.views||0)+(b.likes||0)*4)-((a.views||0)+(a.likes||0)*4)||b.last_seen-a.last_seen)[0];if(isJunkLabel(label))return[];
    const latest=Math.max(...group.rows.map((row)=>row.last_seen)),published=group.rows.map((row)=>row.published).filter((v):v is number=>typeof v==='number'&&v>0),engagement=Math.log10(1+(top.views||0))+0.35*Math.log10(1+(top.likes||0)),quality=group.authors.size*4+group.platforms.size*3+(structured?3:0)+Math.min(5,engagement);
    return[{id:`candidate:${key}`,source:'Early Candidate',sourceKey:'early-candidate',title:label,query:label,url:top.url,observed:latest,published:published.length?Math.min(...published):null,views:top.views,likes:top.likes,status:'Early candidate' as const,narrative:null,detail:`${group.authors.size} independent creators · ${[...group.platforms].join(' + ')} · ${group.rows.length} natural-language posts · unconfirmed`,quality}];
  }).sort((a,b)=>(b.quality||0)-(a.quality||0)||b.observed-a.observed).slice(0,60);
}

export async function GET(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'Please sign in to view public signals.'},401);
  try{
    const params=new URL(request.url).searchParams,limit=Math.max(10,Math.min(100,Math.trunc(Number(params.get('limit')))||50)),offset=Math.max(0,Math.min(10000,Math.trunc(Number(params.get('offset')))||0)),source=(params.get('source')||'all').trim().toLowerCase(),q=normalize(params.get('q')||''),now=Date.now();
    const browser=await db().prepare(`SELECT e.id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,e.provenance,(SELECT o.views FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS views,(SELECT o.likes FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS likes FROM evidence e WHERE e.owner=? AND e.last_seen>? ORDER BY e.last_seen DESC LIMIT 4000`).bind(user.userId,now-48*3600000).all<BrowserRow>();
    const links=await db().prepare(`SELECT l.evidence,l.narrative,n.title FROM evidence_links l JOIN narratives n ON n.owner=l.owner AND n.id=l.narrative WHERE l.owner=? ORDER BY n.created DESC LIMIT 8000`).bind(user.userId).all<LinkRow>();
    const linkByEvidence=new Map<string,LinkRow>();for(const row of links.results)if(!linkByEvidence.has(row.evidence))linkByEvidence.set(row.evidence,row);
    const usableRows=browser.results.filter((row)=>!SOCIAL_NOTIFICATION.test(row.content)&&!isJunkLabel(row.content,row.author));
    const explicitTopicRows=usableRows.filter((row)=>RAW_TOPIC_SOURCES.has(sourceFor(row).key));
    const browserTopics:PublicItem[]=explicitTopicRows.flatMap((row)=>{const meta=sourceFor(row),title=topicTitle(row);if(!title)return[];return[{id:`browser:${row.id}`,source:meta.source,sourceKey:meta.key,title,query:title,url:row.url,observed:row.last_seen,published:row.published,views:row.views,likes:row.likes,status:'Raw signal' as const,narrative:null,detail:`Discovery seed observed from ${meta.source}; not a narrative until creator evidence corroborates it.`,quality:5}];});
    const earlyCandidates=buildEarlyCandidates(usableRows,new Set(linkByEvidence.keys()),now);
    let external:Awaited<ReturnType<typeof publicSignals>>={signals:[],coverage:[],at:now};try{external=await publicSignals();}catch{}
    const externalItems:PublicItem[]=external.signals.map((signal)=>({id:`external:${signal.id}`,source:signal.source,sourceKey:signal.source==='Google Trends'?'google-trends':'market-theme',title:signal.title,query:signal.query,url:signal.url,observed:external.at,published:null,views:null,likes:null,status:'Raw signal',narrative:null,detail:signal.detail,quality:4}));
    const allItems=dedupe([...earlyCandidates,...browserTopics,...externalItems]);const counts:Record<string,number>={all:allItems.length};for(const item of allItems)counts[item.sourceKey]=(counts[item.sourceKey]||0)+1;
    const sourceCounts:Record<string,number>={};for(const row of usableRows){const key=sourceFor(row).key;sourceCounts[key]=(sourceCounts[key]||0)+1;}
    let items=source==='all'?balanced(allItems):allItems.filter((item)=>item.sourceKey===source).sort((a,b)=>(b.quality||0)-(a.quality||0)||b.observed-a.observed);if(q)items=items.filter((item)=>normalize(`${item.title} ${item.detail}`).includes(q));const total=items.length;
    const uniqueAuthors=new Set(usableRows.map((row)=>`${row.platform}:${row.author.toLowerCase()}`)).size,latestBrowserSeen=usableRows[0]?.last_seen??null,ignoredNotifications=browser.results.filter((row)=>SOCIAL_NOTIFICATION.test(row.content)).length,ignoredJunk=browser.results.length-usableRows.length-ignoredNotifications;
    const evidenceOnly=usableRows.length-explicitTopicRows.length,diagnosis=browser.results.length===0?'No synced browser evidence is stored in the active 48-hour window. Run a fresh Browser Sources scan or sync pending finds.':usableRows.length===0?'Stored browser evidence is UI/metric noise rather than actual post content. Run a fresh scan after updating the bridge.':allItems.length===0?'Evidence exists but no real topic has enough independent natural-language support yet. Raw posts stay evidence instead of becoming fake narratives.':null;
    return json({items:items.slice(offset,offset+limit),page:{limit,offset,total,hasMore:offset+limit<total,nextOffset:offset+limit<total?offset+limit:null},counts,coverage:external.coverage,diagnostics:{browserEvidence:browser.results.length,usableBrowserEvidence:usableRows.length,evidenceOnly,explicitTopicSignals:browserTopics.length,ignoredNotifications,ignoredJunk,uniqueAuthors,earlyCandidates:earlyCandidates.length,sourceCounts,latestBrowserSeen,externalSignals:externalItems.length,diagnosis},at:now,note:'Trend pages and hashtags are discovery seeds only. Early Candidates now require repeated natural-language entities or phrases from independent creators, and the active evidence window is 48 hours.'});
  }catch(error){return json({error:(error as Error).message},500);}
}
