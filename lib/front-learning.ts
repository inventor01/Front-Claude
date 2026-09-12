export const LEARNING_FEATURES = [
  'crossPlatform',
  'semanticCross',
  'crossPost',
  'creators3',
  'accelerating',
  'hot',
  'velocity50k',
  'velocity100k',
  'fresh3h',
] as const;

export type LearningFeature = (typeof LEARNING_FEATURES)[number];
export type LearningFeatures = Record<LearningFeature, boolean>;
export type LearningOutcome = 'useful'|'not-relevant'|'coin-created'|'mc-25k'|'mc-100k'|'mc-500k';

export type LearningArchiveRecord = {
  kind: string;
  data: unknown;
};

export type LearningEventData = {
  narrativeId?: string;
  title?: string;
  outcome?: LearningOutcome;
  label?: 'useful'|'not-relevant';
  features?: Partial<LearningFeatures>;
};

export type LearningFeaturePolicy = {
  feature: LearningFeature;
  examples: number;
  reward: number;
  confidence: number;
  points: number;
};

export type LearningPolicy = {
  examples: number;
  feedback: number;
  positive: number;
  negative: number;
  outcomes: number;
  activeFeatures: number;
  features: Record<LearningFeature, LearningFeaturePolicy>;
};

const OUTCOME_REWARD: Record<LearningOutcome, number> = {
  useful: 1.5,
  'not-relevant': -2,
  'coin-created': 0.25,
  'mc-25k': 0.5,
  'mc-100k': 0.8,
  'mc-500k': 1.2,
};

const FEATURE_LABEL: Record<LearningFeature, string> = {
  crossPlatform: 'cross-platform',
  semanticCross: 'same-event X ↔ TikTok',
  crossPost: 'cross-post repetition',
  creators3: '3+ independent creators',
  accelerating: 'creator acceleration',
  hot: 'fast engagement',
  velocity50k: '50K+ hourly velocity',
  velocity100k: '100K+ hourly velocity',
  fresh3h: 'fresh under 3h',
};

function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function emptyFeatures():LearningFeatures{return Object.fromEntries(LEARNING_FEATURES.map((feature)=>[feature,false])) as LearningFeatures;}

export function learningFeatures(input:{platforms?:string[];semanticCrossPlatformCreators?:number;crossPostedCreators?:number;creators?:number;stage?:string;hotPosts?:unknown[];maxViewsPerHour?:number;maxLikesPerHour?:number;ageMs?:number}):LearningFeatures{
  const maxVelocity=Math.max(Number(input.maxViewsPerHour||0),Number(input.maxLikesPerHour||0)*20);
  return {
    crossPlatform:(input.platforms?.length||0)>=2,
    semanticCross:Number(input.semanticCrossPlatformCreators||0)>=2,
    crossPost:Number(input.crossPostedCreators||0)>=2,
    creators3:Number(input.creators||0)>=3,
    accelerating:['Accelerating','Spreading'].includes(String(input.stage||'')),
    hot:Array.isArray(input.hotPosts)&&input.hotPosts.length>0,
    velocity50k:maxVelocity>=50000,
    velocity100k:maxVelocity>=100000,
    fresh3h:Number.isFinite(Number(input.ageMs))&&Number(input.ageMs)>=0&&Number(input.ageMs)<=3*3600000,
  };
}

function parseEvent(record:LearningArchiveRecord):{outcome:LearningOutcome;features:LearningFeatures}|null{
  if(!['ranking-feedback','verified-outcome'].includes(record.kind))return null;
  if(!record.data||typeof record.data!=='object')return null;
  const data=record.data as LearningEventData;
  const outcome=(record.kind==='ranking-feedback'?data.label:data.outcome) as LearningOutcome|undefined;
  if(!outcome||!(outcome in OUTCOME_REWARD))return null;
  const features=emptyFeatures();
  if(data.features&&typeof data.features==='object')for(const feature of LEARNING_FEATURES)features[feature]=data.features[feature]===true;
  return{outcome,features};
}

export function buildLearningPolicy(records:LearningArchiveRecord[]):LearningPolicy{
  const parsed=records.map(parseEvent).filter((event):event is NonNullable<typeof event>=>Boolean(event));
  const sums=Object.fromEntries(LEARNING_FEATURES.map((feature)=>[feature,{examples:0,reward:0}])) as Record<LearningFeature,{examples:number;reward:number}>;
  let feedback=0,positive=0,negative=0,outcomes=0;
  for(const event of parsed){
    const reward=OUTCOME_REWARD[event.outcome];
    if(event.outcome==='useful'){feedback++;positive++;}
    else if(event.outcome==='not-relevant'){feedback++;negative++;}
    else outcomes++;
    for(const feature of LEARNING_FEATURES)if(event.features[feature]){sums[feature].examples++;sums[feature].reward+=reward;}
  }
  const policies={} as Record<LearningFeature,LearningFeaturePolicy>;
  let activeFeatures=0;
  for(const feature of LEARNING_FEATURES){
    const stat=sums[feature],average=stat.examples?stat.reward/stat.examples:0;
    const confidence=stat.examples<5?0:clamp((stat.examples-4)/16,0,1);
    const points=Number((clamp(average/2,-1,1)*confidence*3.5).toFixed(2));
    if(Math.abs(points)>=0.25)activeFeatures++;
    policies[feature]={feature,examples:stat.examples,reward:Number(stat.reward.toFixed(2)),confidence:Number(confidence.toFixed(3)),points};
  }
  return{examples:parsed.length,feedback,positive,negative,outcomes,activeFeatures,features:policies};
}

export function applyLearning(features:LearningFeatures,policy:LearningPolicy){
  let adjustment=0;
  const reasons:{feature:LearningFeature;label:string;points:number;examples:number}[]=[];
  for(const feature of LEARNING_FEATURES){
    if(!features[feature])continue;
    const learned=policy.features[feature];
    if(!learned||Math.abs(learned.points)<0.25)continue;
    adjustment+=learned.points;
    reasons.push({feature,label:FEATURE_LABEL[feature],points:learned.points,examples:learned.examples});
  }
  adjustment=Number(clamp(adjustment,-15,15).toFixed(2));
  reasons.sort((a,b)=>Math.abs(b.points)-Math.abs(a.points)||b.examples-a.examples);
  return{adjustment,reasons:reasons.slice(0,4)};
}
