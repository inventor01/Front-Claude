export type CommerceEvidence = {
  id:string;
  platform:string;
  author:string;
  url:string;
  content:string;
  published:number|null;
  firstSeen:number;
  lastSeen:number;
  views:number|null;
  likes:number|null;
};

export type CommerceOpportunity = {
  key:string;
  title:string;
  status:'SIGNAL_ONLY'|'EARLY_CANDIDATE';
  confidence:'LOW'|'MEDIUM'|'HIGH';
  creators:number;
  platforms:string[];
  ageHours:number|null;
  purchaseIntentMentions:number;
  socialProofMentions:number;
  creativePatterns:string[];
  evidenceCount:number;
  evidence:Array<{id:string;url:string;platform:string;author:string;excerpt:string;views:number|null;likes:number|null}>;
  notes:string[];
};

const PURCHASE_INTENT=/\b(?:where (?:did|do) (?:you|i) get|where can i (?:get|buy)|link\??|drop the link|need this|i need (?:this|one)|want this|i want (?:this|one)|how much|price\??|buy it|ordered|just ordered|adding to cart|add to cart|take my money)\b/i;
const SOCIAL_PROOF=/\b(?:viral|sold out|selling out|everyone has|everyone is buying|keeps selling|restock|back in stock|must have|obsessed|worth it)\b/i;
const PATTERNS:Array<[string,RegExp]>=[
  ['demonstration',/\b(?:demo|demonstrat|how it works|watch this|works like|using this)\b/i],
  ['before-after',/\b(?:before and after|before\/after|before vs after|transformation)\b/i],
  ['unboxing',/\bunbox(?:ing|ed)?\b/i],
  ['comparison',/\b(?:versus| vs\.? |compare|comparison|better than)\b/i],
  ['reaction',/\b(?:reaction|reacting|my face|did not expect|didn't expect)\b/i],
  ['problem-solution',/\b(?:problem|solution|finally fixed|hack|life saver|lifesaver)\b/i],
  ['gift',/\b(?:gift|gift idea|present for|boyfriend|girlfriend|mom|dad)\b/i],
];

const normalize=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

function matchesTopic(content:string,title:string,aliases:string[]){
  const hay=normalize(content);
  const candidates=[title,...aliases].map(normalize).filter(Boolean);
  return candidates.some((candidate)=>{
    if(candidate.length<3)return false;
    if(candidate.includes(' '))return hay.includes(candidate);
    return hay.split(' ').includes(candidate);
  });
}

function confidence(creators:number,purchaseIntent:number,evidenceCount:number):CommerceOpportunity['confidence']{
  if(creators>=5&&purchaseIntent>=3&&evidenceCount>=6)return 'HIGH';
  if(creators>=3&&purchaseIntent>=1&&evidenceCount>=3)return 'MEDIUM';
  return 'LOW';
}

export function buildCommerceOpportunity(input:{
  key:string;
  title:string;
  observed:number;
  created?:number|null;
  aliases?:string[];
  rows:CommerceEvidence[];
  now:number;
}):CommerceOpportunity|null{
  const aliases=input.aliases||[];
  const matched=input.rows.filter((row)=>matchesTopic(row.content,input.title,aliases));
  if(!matched.length)return null;

  const creators=new Set(matched.map((row)=>`${row.platform}:${row.author.toLowerCase()}`));
  const platforms=[...new Set(matched.map((row)=>row.platform))];
  const purchaseIntentMentions=matched.filter((row)=>PURCHASE_INTENT.test(row.content)).length;
  const socialProofMentions=matched.filter((row)=>SOCIAL_PROOF.test(row.content)).length;
  const patternCounts=new Map<string,number>();
  for(const row of matched){
    for(const [label,re] of PATTERNS){
      if(re.test(row.content))patternCounts.set(label,(patternCounts.get(label)||0)+1);
    }
  }
  const creativePatterns=[...patternCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([label])=>label);
  const first=Math.min(...matched.map((row)=>row.published||row.firstSeen||row.lastSeen).filter(Boolean));
  const ageHours=Number.isFinite(first)?Math.max(0,(input.now-first)/3600000):null;

  // Front-Commerce only surfaces a signal. Product Research must verify supplier,
  // economics, compliance and saturation before launch review.
  const status:CommerceOpportunity['status']=
    creators.size>=2&&(purchaseIntentMentions>0||creativePatterns.length>0)
      ?'EARLY_CANDIDATE'
      :'SIGNAL_ONLY';

  return {
    key:input.key,
    title:input.title,
    status,
    confidence:confidence(creators.size,purchaseIntentMentions,matched.length),
    creators:creators.size,
    platforms,
    ageHours,
    purchaseIntentMentions,
    socialProofMentions,
    creativePatterns,
    evidenceCount:matched.length,
    evidence:[...matched]
      .sort((a,b)=>((b.views||0)+(b.likes||0)*4)-((a.views||0)+(a.likes||0)*4)||b.lastSeen-a.lastSeen)
      .slice(0,8)
      .map((row)=>({
        id:row.id,
        url:row.url,
        platform:row.platform,
        author:row.author,
        excerpt:row.content.slice(0,360),
        views:row.views,
        likes:row.likes,
      })),
    notes:[
      'Commerce classification is heuristic and evidence-backed, not product verification.',
      'Front-Commerce does not infer supplier quality, landed cost, margin, IP risk, or regulatory safety.',
    ],
  };
}
