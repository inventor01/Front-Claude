const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalize=(value)=>clean(value,1200).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const creator=(value)=>String(value||'').replace(/^@/,'').trim().toLowerCase();

export function socialContextEnabled(){return /^(?:1|true|yes|on)$/i.test(String(process.env.FRONT_SOCIAL_CONTEXT_ENABLED||''));}

export function socialContextWeight(role){const value=String(role||'').toLowerCase();if(/reply|comment/.test(value))return .3;if(/quote|repost/.test(value))return .7;return 1;}

export function meaningfulSocialContext(value){
 const text=clean(value,1200);
 if(text.length<4||!/[\p{L}\p{N}]/u.test(text))return false;
 if(/^(?:lol+|lmao+|omg+|wow+|same+|real+|facts+|this+|bro+|😂+|😭+|🔥+|💀+)$/iu.test(text))return false;
 if(/^(?:https?:\/\/\S+|@[A-Za-z0-9_.]+)$/i.test(text))return false;
 return true;
}

export function normalizeSocialContextRow(raw={}){
 const role=/quote|repost/i.test(String(raw.relationType||raw.evidenceRole||''))?'quote':/reply|comment/i.test(String(raw.relationType||raw.evidenceRole||''))?'comment':'comment';
 const content=clean(raw.content||raw.text,1200);
 const author=creator(raw.author);
 if(!raw.parentId||!author||!meaningfulSocialContext(content))return null;
 return{
   id:raw.id||`${raw.platform||'social'}:context:${raw.parentId}:${author}:${normalize(content).slice(0,60)}`,
   platform:raw.platform||null,
   author,
   url:raw.url||null,
   content,
   published:Number.isFinite(Number(raw.published))?Number(raw.published):null,
   firstObserved:Number.isFinite(Number(raw.firstObserved))?Number(raw.firstObserved):Date.now(),
   lastObserved:Number.isFinite(Number(raw.lastObserved))?Number(raw.lastObserved):Date.now(),
   evidenceRole:role,
   relationType:role,
   parentId:String(raw.parentId),
   parentAuthor:creator(raw.parentAuthor)||null,
   socialContextWeight:socialContextWeight(role),
   provenance:clean(raw.provenance||'supporting social context',180),
 };
}

export function dedupeSocialContext(rows=[],{limit=60}={}){
 const map=new Map();
 for(const raw of rows){
   const row=raw?.evidenceRole?raw:normalizeSocialContextRow(raw);
   if(!row)continue;
   const key=`${row.parentId}|${creator(row.author)}|${normalize(row.content)}`;
   if(!map.has(key))map.set(key,row);
 }
 return[...map.values()].sort((a,b)=>Number(a.firstObserved||0)-Number(b.firstObserved||0)).slice(-Math.max(1,Number(limit)||60));
}

export function socialContextSummary(rows=[]){
 const normalized=dedupeSocialContext(rows,{limit:500});
 const creators=new Set(normalized.map((row)=>creator(row.author)).filter(Boolean));
 const parents=new Set(normalized.map((row)=>row.parentId).filter(Boolean));
 const platforms=new Set(normalized.map((row)=>row.platform).filter(Boolean));
 const weightedSupport=normalized.reduce((sum,row)=>sum+socialContextWeight(row.evidenceRole),0);
 return{rows:normalized.length,creators:creators.size,parents:parents.size,platforms:[...platforms],weightedSupport:Number(weightedSupport.toFixed(2))};
}
