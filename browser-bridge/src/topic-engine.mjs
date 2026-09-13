import { dedupeEvidence } from './core.mjs';
import {
  detectTopics as baseDetectTopics,
  enrichMomentum as baseEnrichMomentum,
  sameTopicKey,
  topicSnapshot as baseTopicSnapshot,
} from './topic-engine-base.mjs';

export { sameTopicKey };

const GENERIC_SINGLE = new Set((
  'original originals originalsound official officially create creates created creating creation creations creator creators sound sounds audio caption captions video videos photo photos image images '+
  'post posts repost reposts reply replies comment comments share shares view views like likes follow follows part parts episode episodes full live new latest today tonight yesterday tomorrow update updates breaking news '+
  'meme memes viral virality trend trends trending funny reaction reactions clip clips edit edits account accounts user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone anybody '+
  'everyone everybody thing things stuff something anything everything name names word words topic topics story stories love hate trade trading buy buying sell selling market markets coin coins token tokens crypto solana tiktok twitter x fyp foryou '+
  'ever solo human back everywhere feed timeline discussion discussions appearing appears appear spreading spreads spread popping popped becoming became keeps keep again '+
  'face faces take takes took taking grow grows growing grown look looks looking looked make makes making made get gets getting got go goes going went come comes coming came use uses using used '+
  'run runs running ran fall falls falling fell move moves moving moved drop drops dropping dropped say says saying said tell tells telling told want wants wanting wanted need needs needing needed '+
  'good better best bad big small crazy insane wild nice cool hot real really literally basically actually '+
  'sonido sonidos originales esta este esto hacer hace haciendo hecho haber escucha escuchar escuchando canción cancion canciones música musica nuevo nueva nuevos nuevas hoy ayer mañana '+
  'звук звуки оригинальный оригинальная оригинальное оригинальные оригинал видео фото пост посты тренд тренды вирусный som sons originais postagem postagens compartilhar curtida curtidas tendance tendances originalton'
).split(/\s+/));

const STOP = new Set((
  'the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really now have has had do does did can could would '+
  'should will may might about into over under after before more most some any all one two via amp rt know think why how what when where who which there here '+
  'el la los las un una unos unas y o pero si de del en por para con sin es son era eran ser fue fueron se su sus mi mis tu tus que como cuando donde quien quienes hay aqui allí ya muy más mas menos todo todos toda todas uno dos'
).split(/\s+/));

const BOILERPLATE = new Set(['original sound','sound original','sonido original','audio original','som original','son original','originalton','оригинальный звук','оригинальная музыка','original audio','official sound']);
const GENERIC_STEM = /^(?:creat(?:e|es|ed|ing|ion|ions|or|ors)|origin(?:al|als|ally)?|sound(?:s)?|audio|video(?:s)?|post(?:s)?|trend(?:s|ing)?|viral|meme(?:s)?|reaction(?:s)?|clip(?:s)?|update(?:s)?|share(?:s|d|ing)?|view(?:s|ed|ing)?|like(?:s|d|ing)?|follow(?:s|ed|ing)?|grow(?:s|ing|n)?|tak(?:e|es|ing)|fac(?:e|es)|look(?:s|ed|ing)?|mak(?:e|es|ing)|mov(?:e|es|ed|ing)|drop(?:s|ped|ping)?|sonid(?:o|os)|escuch(?:a|ar|ando)|canci[oó]n(?:es)?|звук(?:и)?|оригинальн(?:ый|ая|ое|ые)|som(?:s)?|tend(?:ance|ances))$/iu;

const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/^#/,'').replace(/[_-]+/g,' ').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}$]+/gu,' ').replace(/\s+/g,' ').trim();
const tokens = (value) => normalize(value).split(' ').filter(Boolean);
const specificWords = (value) => tokens(value).filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC_SINGLE.has(word) && !GENERIC_STEM.test(word) && !/^\d+$/.test(word));
const creatorKey = (row) => `${row.platform}:${String(row.author || '').toLowerCase()}`;
const cleanLabel = (value) => String(value ?? '').replace(/^#/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
const titleCase = (value) => cleanLabel(value).split(' ').map((word) => /^[A-Z0-9$]{2,}$/.test(word) ? word : word ? word[0].toUpperCase() + word.slice(1) : word).join(' ');

function genericLabel(value) {
  const normalized = normalize(value), parts = tokens(value);
  if (!parts.length || BOILERPLATE.has(normalized)) return true;
  if (parts.length === 1) {
    const word = parts[0];
    return word.length < 4 || GENERIC_SINGLE.has(word) || STOP.has(word) || GENERIC_STEM.test(word) || /^\d+$/.test(word);
  }
  const specific = specificWords(value);
  if (!specific.length) return true;
  const noise = parts.filter((word) => STOP.has(word) || GENERIC_SINGLE.has(word) || GENERIC_STEM.test(word) || word.length < 3).length;
  return parts.length >= 3 && specific.length === 1 && noise >= parts.length - 1;
}

function rowText(row) {
  return [
    row?.semanticNarrativeKey,
    row?.postSubject,
    row?.postEvent,
    row?.contentEvent,
    ...(Array.isArray(row?.postEntities) ? row.postEntities : []),
    ...(Array.isArray(row?.contentEntities) ? row.contentEntities : []),
    row?.contentSummary,
    row?.content,
  ].filter(Boolean).join(' ');
}

function rowTerms(row) {
  return [...new Set(specificWords(rowText(row)))].slice(0, 60);
}

function rowSemanticKey(row) {
  const candidates = [row?.semanticNarrativeKey, row?.postSubject, row?.postEvent, row?.contentEvent];
  for (const value of candidates) {
    const key = normalize(value);
    if (specificWords(key).length >= 2 && !genericLabel(key)) return key;
  }
  return '';
}

function mediaKey(row) {
  return [
    row?.soundId ? `sound:${row.soundId}` : null,
    row?.visualHash ? `visual:${row.visualHash}` : null,
    row?.quotedUrl ? `quote:${row.quotedUrl}` : null,
    row?.relatedVideoId ? `parent:${row.relatedVideoId}` : null,
  ].filter(Boolean);
}

function compatibleContext(a, b) {
  if (!a || !b || creatorKey(a) === creatorKey(b)) return false;
  const aKey = rowSemanticKey(a), bKey = rowSemanticKey(b);
  if (aKey && bKey && sameTopicKey(aKey, bKey)) return true;

  const aMedia = new Set(mediaKey(a));
  if (mediaKey(b).some((key) => aMedia.has(key))) return true;

  const left = new Set(rowTerms(a)), right = new Set(rowTerms(b));
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((word) => right.has(word));
  if (shared.length < 2) return false;
  const overlap = shared.length / Math.max(1, Math.min(left.size, right.size));
  const namedOverlap = shared.some((word) => {
    const rawA = String(a?.content || '');
    const rawB = String(b?.content || '');
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu');
    return re.test(rawA) && re.test(rawB) && (/[A-Z0-9$]/.test(rawA) || /[A-Z0-9$]/.test(rawB));
  });
  return overlap >= 0.42 || shared.length >= 3 || (namedOverlap && shared.length >= 2);
}

function repeatedContiguousPhrases(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const words = normalize(row?.postSubject || row?.contentEvent || row?.contentSummary || row?.content).split(' ').filter(Boolean).slice(0, 90);
    const author = creatorKey(row);
    for (let size = 2; size <= 6; size++) {
      for (let i = 0; i <= words.length - size; i++) {
        const slice = words.slice(i, i + size);
        const meaningful = slice.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC_SINGLE.has(word) && !GENERIC_STEM.test(word));
        if (meaningful.length < Math.min(2, size)) continue;
        const phrase = slice.join(' ');
        if (genericLabel(phrase)) continue;
        const old = buckets.get(phrase) || { authors: new Set(), platforms: new Set(), count: 0 };
        old.authors.add(author); old.platforms.add(row.platform); old.count += 1; buckets.set(phrase, old);
      }
    }
  }
  return [...buckets.entries()]
    .filter(([, stat]) => stat.authors.size >= 2)
    .map(([label, stat]) => ({ label, creators: stat.authors.size, platforms: stat.platforms.size, count: stat.count }))
    .sort((a,b) => b.creators-a.creators || b.platforms-a.platforms || b.count-a.count || tokens(b.label).length-tokens(a.label).length);
}

function contextualClusters(evidence) {
  const rows = evidence.filter((row) => row?.id && row?.platform && rowText(row));
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a,b) => { const ra=find(a), rb=find(b); if (ra!==rb) parent[rb]=ra; };
  for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) if (compatibleContext(rows[i], rows[j])) unite(i,j);
  const groups = new Map();
  rows.forEach((row,i)=>{ const root=find(i); const list=groups.get(root)||[]; list.push(row); groups.set(root,list); });
  return [...groups.values()].filter((group)=>new Set(group.map(creatorKey)).size>=2 && group.length>=2);
}

function clusterLabel(rows) {
  const semantic = new Map();
  for (const row of rows) {
    for (const value of [row?.postSubject,row?.postEvent,row?.semanticNarrativeKey,row?.contentEvent]) {
      const label = cleanLabel(value);
      if (!label || genericLabel(label) || specificWords(label).length < 2) continue;
      const key = normalize(label);
      const old = semantic.get(key) || { label, creators:new Set(), count:0 };
      old.creators.add(creatorKey(row)); old.count++; semantic.set(key,old);
    }
  }
  const exact=[...semantic.values()].filter((x)=>x.creators.size>=2).sort((a,b)=>b.creators.size-a.creators.size||b.count-a.count||tokens(a.label).length-tokens(b.label).length);
  if (exact[0]) return exact[0].label;
  const repeated = repeatedContiguousPhrases(rows);
  if (repeated[0]) return repeated[0].label;
  const counts = new Map();
  for (const row of rows) for (const term of rowTerms(row)) {
    const old = counts.get(term)||new Set(); old.add(creatorKey(row)); counts.set(term,old);
  }
  const shared=[...counts.entries()].filter(([,authors])=>authors.size>=2).sort((a,b)=>b[1].size-a[1].size||b[0].length-a[0].length).map(([term])=>term).slice(0,5);
  return shared.length>=2 ? shared.join(' ') : '';
}

function semanticTopic(rows, now) {
  const label = clusterLabel(rows);
  if (!label || genericLabel(label) || specificWords(label).length < 2) return null;
  const creators = new Set(rows.map(creatorKey));
  const platforms = [...new Set(rows.map((row)=>row.platform).filter(Boolean))];
  const timestamps = rows.map((row)=>Number(row.published || row.firstObserved || 0)).filter((n)=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  const evidenceIds = [...new Set(rows.map((row)=>row.id).filter(Boolean))];
  const authorCount = creators.size;
  const evidenceCount = evidenceIds.length;
  const oldestPublished = timestamps[0] || null;
  const newestPublished = timestamps[timestamps.length-1] || null;
  const ageHours = oldestPublished ? Math.max(0,(now-oldestPublished)/3600000) : null;
  const score = 18 + Math.min(32,authorCount*6) + Math.min(20,evidenceCount*2) + (platforms.length>=2?12:0) + (ageHours!=null&&ageHours<=2?10:ageHours!=null&&ageHours<=6?5:0);
  return {
    topic:titleCase(label), key:normalize(label), aliases:[cleanLabel(label)], tier:authorCount>=3||platforms.length>=2?'candidate':'pre-breakout',
    evidenceCount, authorCount, platforms, oldestPublished, newestPublished, engagementEvidence:rows.filter((row)=>Number(row.views||0)>0||Number(row.likes||0)>0).length,
    score:Number(score.toFixed(2)), specificityScore:Math.min(10,specificWords(label).length*2), niche:true, nicheEvidenceCount:evidenceCount,
    corroborated:authorCount>=3||platforms.length>=2, evidenceIds,
    anchors:rows.slice(0,6).map((row)=>({id:row.id,platform:row.platform,author:row.author,url:row.url,content:row.content,published:row.published||null,views:row.views??null,likes:row.likes??null})),
    originCandidate:null, relatedContexts:[], detector:'semantic-context-v26',
    labelEvidence:{creators:authorCount,evidence:evidenceCount,platforms:platforms.length},
    crossPlatform:{pairs:platforms.length>=2?1:0,creators:authorCount,corroborated:platforms.length>=2},
    labelPolicy:'semantic-subject-event', contextual:true,
  };
}

function supportingRows(topic,evidence) {
  const ids = new Set(topic?.evidenceIds || []);
  if (ids.size) { const linked=evidence.filter((row)=>ids.has(row.id)); if (linked.length) return linked; }
  const labels=[topic?.topic,...(topic?.aliases||[])].map(normalize).filter(Boolean);
  return evidence.filter((row)=>{const text=` ${normalize(rowText(row))} `;return labels.some((label)=>label.length>=3&&text.includes(` ${label} `));});
}
function exactSupport(label,rows) {
  const key=normalize(label); if(!key)return{creators:0,evidence:0,platforms:0};
  const matches=rows.filter((row)=>` ${normalize(rowText(row))} `.includes(` ${key} `));
  return{creators:new Set(matches.map(creatorKey)).size,evidence:matches.length,platforms:new Set(matches.map((row)=>row.platform)).size};
}
function bestDisplayLabel(topic,rows) {
  const candidates=[...new Set([topic.topic,...(topic.aliases||[])].map(cleanLabel).filter(Boolean))]
    .filter((label)=>!genericLabel(label)).map((label)=>({label,...exactSupport(label,rows)})).filter((item)=>item.creators>=2)
    .sort((a,b)=>b.creators-a.creators||b.platforms-a.platforms||Math.min(6,tokens(b.label).length)-Math.min(6,tokens(a.label).length)||a.label.length-b.label.length);
  if(candidates[0])return candidates[0].label;
  const repeated=repeatedContiguousPhrases(rows); if(repeated[0])return repeated[0].label;
  const fallback=cleanLabel(topic.topic||topic.key); return fallback&&!genericLabel(fallback)?fallback:'';
}
function stableIdentity(topic,display,evidence) {
  const semanticRows=supportingRows(topic,evidence); const semanticKeys=semanticRows.map(rowSemanticKey).filter(Boolean);
  if(semanticKeys.length){const counts=new Map();for(const key of semanticKeys)counts.set(key,(counts.get(key)||0)+1);const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];if(best?.[1]>=2)return best[0];}
  return normalize(display||topic?.key||topic?.topic);
}
function semanticCrossPlatform(rows,label) {
  const x=rows.filter((r)=>r.platform==='X').slice(0,50),t=rows.filter((r)=>r.platform==='TikTok').slice(0,50);const creators=new Set();let pairs=0;
  for(const a of x)for(const b of t){if(!compatibleContext(a,b))continue;pairs++;creators.add(creatorKey(a));creators.add(creatorKey(b));}
  return{pairs,creators:creators.size,corroborated:pairs>0&&creators.size>=2};
}
function keepTopic(topic,display,rows) {
  if(!display||genericLabel(display))return false;
  const support=exactSupport(display,rows),parts=tokens(display),creators=Number(topic.authorCount||0),evidenceCount=Number(topic.evidenceCount||0);
  if(creators<2||evidenceCount<2)return false;
  if(parts.length===1)return specificWords(display)[0]?.length>=4&&creators>=3&&support.creators>=3;
  return specificWords(display).length>=2 && (support.creators>=2 || rows.some((row)=>rowSemanticKey(row)&&sameTopicKey(rowSemanticKey(row),display)));
}
function evidenceOverlap(a,b){const left=new Set(a.evidenceIds||[]),right=new Set(b.evidenceIds||[]);const shared=[...left].filter((id)=>right.has(id)).length;return{shared,ratio:shared/Math.max(1,Math.min(left.size,right.size))};}
function isFragmentOf(shorter,longer){const a=specificWords(shorter.topic),b=specificWords(longer.topic);if(!a.length||a.length>=b.length)return false;return a.every((word)=>b.includes(word));}
function suppressFragments(rows){return rows.filter((candidate,index)=>!rows.some((other,j)=>{if(index===j||!isFragmentOf(candidate,other))return false;const overlap=evidenceOverlap(candidate,other);return overlap.shared>=2&&overlap.ratio>=.6&&Number(other.labelEvidence?.creators||0)>=2;}));}

export function detectTopics(events=[],now=Date.now(),limit=15) {
  const evidence=dedupeEvidence(events);
  const raw=baseDetectTopics(evidence,now,Math.max(limit*4,40));
  const repaired=[];
  for(const topic of raw){
    const rows=supportingRows(topic,evidence),display=bestDisplayLabel(topic,rows);
    if(!keepTopic(topic,display,rows))continue;
    const labelEvidence=exactSupport(display,rows),crossPlatform=semanticCrossPlatform(rows,display),parts=tokens(display);
    const tier=parts.length===1&&labelEvidence.creators<3?'pre-breakout':topic.tier;
    repaired.push({...topic,tier,corroborated:tier==='candidate',topic:titleCase(display),key:stableIdentity(topic,display,evidence),aliases:[...new Set([display,topic.topic,...(topic.aliases||[])].map(cleanLabel).filter((value)=>value&&!genericLabel(value)))].filter((alias)=>tokens(alias).length>1||normalize(alias)===normalize(display)).slice(0,18),labelEvidence,crossPlatform,labelPolicy:'context-required-v26'});
  }

  const semantic=contextualClusters(evidence).map((rows)=>semanticTopic(rows,now)).filter(Boolean);
  const combined=[...semantic,...repaired].sort((a,b)=>Number(b.contextual||0)-Number(a.contextual||0)||(b.score||0)-(a.score||0)||(b.authorCount||0)-(a.authorCount||0));
  const out=[];
  for(const topic of suppressFragments(combined)){
    const duplicate=out.find((item)=>sameTopicKey(item.key||item.topic,topic.key||topic.topic)||evidenceOverlap(item,topic).ratio>=.75);
    if(!duplicate)out.push(topic);
    else if(topic.contextual&&!duplicate.contextual){Object.assign(duplicate,topic);}
  }
  return out.slice(0,Math.max(0,limit));
}

export function enrichMomentum(topics=[],history=[],now=Date.now()) {
  const enriched=baseEnrichMomentum(topics,history,now).map((topic)=>{
    const hot=Array.isArray(topic.hotPosts)?topic.hotPosts:[];
    const maxViewsPerHour=Number(topic.maxViewsPerHour||0),crossPostedCreators=Number(topic.crossPostedCreators||0),creators=Number(topic.authorCount||0);
    const shouldFlag=creators>=2&&(maxViewsPerHour>=100000||hot.some((post)=>Number(post.views||0)>=100000&&Number(post.ageHours||99)<=6)||crossPostedCreators>=3&&maxViewsPerHour>=25000);
    if(!shouldFlag||topic.momentum?.label==='Accelerating')return topic;
    return{...topic,momentum:{...(topic.momentum||{}),label:'Accelerating',score:Number(((topic.momentum?.score||0)+Math.min(35,Math.log10(1+maxViewsPerHour)*6)).toFixed(2)),engagementAcceleration:true}};
  });
  return enriched.sort((a,b)=>(b.priorityScore||0)-(a.priorityScore||0)||(b.momentum?.score||0)-(a.momentum?.score||0)||(b.score||0)-(a.score||0));
}

export function topicSnapshot(topics=[],at=Date.now()) {
  const snapshot=baseTopicSnapshot(topics,at),byKey=new Map(topics.map((topic)=>[normalize(topic.key||topic.topic),topic]));
  snapshot.topics=snapshot.topics.map((row)=>{const source=byKey.get(normalize(row.key||row.topic));return{...row,priorityScore:source?.priorityScore||0,maxViewsPerHour:source?.maxViewsPerHour||0,crossPostedCreators:source?.crossPostedCreators||0,hotPostCount:source?.hotPosts?.length||0,crossPlatform:source?.crossPlatform||null,contextual:source?.contextual||false,labelPolicy:source?.labelPolicy||null};});
  return snapshot;
}
