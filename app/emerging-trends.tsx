'use client';

import { isNarrativeLabelJunk, normalizeNarrativeText, specificNarrativeTerms } from '@/lib/narrative-quality';
import styles from './front-live-shell.module.css';

export type ScanEvidence = {
  id:string;
  platform:'X'|'TikTok';
  author:string;
  content:string;
  transcript?:string|null;
  semanticNarrativeKey?:string|null;
  postSubject?:string|null;
  postEvent?:string|null;
  postUnderstandingConfidence?:number|null;
};

export type ScanTopic = {
  topic?:string;
  key?:string;
  tier?:string;
  evidenceCount?:number;
  authorCount?:number;
  platforms?:string[];
  evidenceIds?:string[];
  score?:number;
  corroborated?:boolean;
  scanStatus?:'WATCH'|'EARLY'|'RISING'|'QUALIFIED';
  signalScore?:number;
  signalSource?:'semantic'|'raw-repeat'|'engine';
};

const clean=(value:unknown,max=120)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const clamp=(value:number,min=0,max=100)=>Math.max(min,Math.min(max,value));
const creatorKey=(row:ScanEvidence)=>String(row.author||'').replace(/^@/,'').trim().toLowerCase();
const topicKey=(topic:ScanTopic)=>normalizeNarrativeText(String(topic.key||topic.topic||''));
const sourceText=(row:ScanEvidence)=>clean([row.content,row.transcript].filter(Boolean).join(' '),2400);

export function qualifiesForDashboard(topic:ScanTopic){
  const evidenceCount=Math.max(0,Number(topic.evidenceCount||0));
  const authorCount=Math.max(0,Number(topic.authorCount||0));
  const words=clean(topic.topic||topic.key,120).split(/\s+/).filter(Boolean);
  return evidenceCount>=2&&authorCount>=2&&topic.tier==='candidate'&&topic.corroborated===true&&!(words.length===1&&authorCount<3);
}

function signalStatus(topic:ScanTopic){
  if(qualifiesForDashboard(topic))return 'QUALIFIED' as const;
  const creators=Math.max(0,Number(topic.authorCount||0));
  const posts=Math.max(0,Number(topic.evidenceCount||0));
  const platforms=new Set(topic.platforms||[]).size;
  const score=Math.max(0,Number(topic.signalScore??topic.score??0));
  if(creators>=2&&(platforms>=2||posts>=3)&&score>=55)return 'RISING' as const;
  if(creators>=2)return 'EARLY' as const;
  return 'WATCH' as const;
}

function groupedSignalScore(rows:ScanEvidence[]){
  const creators=new Set(rows.map(creatorKey).filter(Boolean));
  const platforms=new Set(rows.map((row)=>row.platform).filter(Boolean));
  const confidences=rows.map((row)=>Number(row.postUnderstandingConfidence||0)).filter(Number.isFinite);
  const confidence=confidences.length?confidences.reduce((sum,value)=>sum+value,0)/confidences.length:0;
  return clamp(Math.round(confidence*35+Math.min(25,creators.size*10)+Math.min(20,rows.length*5)+(platforms.size>=2?10:0)+(rows.length>creators.size?5:0)));
}

function bestSubject(rows:ScanEvidence[]){
  const counts=new Map<string,number>();
  for(const row of rows){
    for(const value of [row.postSubject,row.postEvent]){
      const subject=clean(value,100);
      if(!subject||isNarrativeLabelJunk(subject)||!specificNarrativeTerms(subject).length)continue;
      counts.set(subject,(counts.get(subject)||0)+1);
      break;
    }
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)[0]?.[0]||'';
}

function rawRepeatedSignals(evidence:ScanEvidence[]){
  const groups=new Map<string,{terms:string[];rows:ScanEvidence[]}>();
  for(const row of evidence){
    const terms=[...new Set(specificNarrativeTerms(sourceText(row)))].slice(0,8);
    if(terms.length<2)continue;
    for(let i=0;i<terms.length;i++)for(let j=i+1;j<terms.length;j++){
      const pair=[terms[i],terms[j]].sort();
      const key=pair.join(' ');
      const group=groups.get(key)||{terms:pair,rows:[]};
      if(!group.rows.some((item)=>item.id===row.id))group.rows.push(row);
      groups.set(key,group);
    }
  }
  const out:ScanTopic[]=[];
  for(const [key,group] of groups){
    const creators=new Set(group.rows.map(creatorKey).filter(Boolean));
    if(creators.size<2)continue;
    const platforms=[...new Set(group.rows.map((row)=>row.platform))];
    const evidenceIds=group.rows.map((row)=>row.id);
    const signalScore=clamp(25+Math.min(30,creators.size*10)+Math.min(20,group.rows.length*5)+(platforms.length>=2?10:0));
    const topic:ScanTopic={topic:group.terms.join(' '),key:`raw ${key}`,tier:'pre-breakout',corroborated:false,evidenceCount:group.rows.length,authorCount:creators.size,platforms,evidenceIds,score:signalScore,signalScore,signalSource:'raw-repeat'};
    topic.scanStatus=signalStatus(topic);
    out.push(topic);
  }
  return out;
}

export function buildEmergingSignals(evidence:ScanEvidence[]=[],inferredTopics:ScanTopic[]=[],limit=24){
  const groups=new Map<string,ScanEvidence[]>();
  for(const row of evidence){
    const confidence=Number(row.postUnderstandingConfidence||0);
    const key=normalizeNarrativeText(String(row.semanticNarrativeKey||''));
    const subject=clean(row.postSubject||row.postEvent,100);
    if(!key||confidence<0.5||!subject||isNarrativeLabelJunk(subject)||!specificNarrativeTerms(subject).length)continue;
    const list=groups.get(key)||[];
    list.push(row);
    groups.set(key,list);
  }

  const merged=new Map<string,ScanTopic>();
  for(const topic of inferredTopics){
    const key=topicKey(topic);
    if(!key)continue;
    const base:ScanTopic={...topic,key,signalScore:clamp(Math.round(Number(topic.score||0))),signalSource:topic.signalSource||'engine'};
    base.scanStatus=signalStatus(base);
    merged.set(key,base);
  }

  for(const [key,rows] of groups){
    const creators=new Set(rows.map(creatorKey).filter(Boolean));
    const platforms=[...new Set(rows.map((row)=>row.platform).filter(Boolean))];
    const title=bestSubject(rows);
    if(!title)continue;
    const prior=merged.get(key);
    const evidenceIds=[...new Set([...(prior?.evidenceIds||[]),...rows.map((row)=>row.id).filter(Boolean)])];
    const signalScore=Math.max(Number(prior?.signalScore||0),groupedSignalScore(rows));
    const next:ScanTopic={
      ...prior,
      topic:prior?.topic||title,
      key,
      tier:prior?.tier||'pre-breakout',
      corroborated:prior?.corroborated===true,
      evidenceCount:Math.max(Number(prior?.evidenceCount||0),rows.length),
      authorCount:Math.max(Number(prior?.authorCount||0),creators.size),
      platforms:[...new Set([...(prior?.platforms||[]),...platforms])],
      evidenceIds,
      score:Math.max(Number(prior?.score||0),signalScore),
      signalScore,
      signalSource:'semantic',
    };
    next.scanStatus=signalStatus(next);
    merged.set(key,next);
  }

  for(const raw of rawRepeatedSignals(evidence)){
    const fingerprint=(raw.evidenceIds||[]).slice().sort().join('|');
    const semanticMatch=[...merged.values()].some((topic)=>{
      const other=(topic.evidenceIds||[]).slice().sort().join('|');
      return fingerprint&&other===fingerprint;
    });
    if(!semanticMatch)merged.set(String(raw.key),raw);
  }

  const rank={QUALIFIED:4,RISING:3,EARLY:2,WATCH:1};
  const fingerprints=new Set<string>();
  return [...merged.values()]
    .filter((topic)=>clean(topic.topic||topic.key,120)&&!isNarrativeLabelJunk(String(topic.topic||topic.key)))
    .sort((a,b)=>(rank[b.scanStatus||'WATCH']-rank[a.scanStatus||'WATCH'])||Number(b.signalScore||0)-Number(a.signalScore||0)||Number(b.authorCount||0)-Number(a.authorCount||0))
    .filter((topic)=>{
      const fp=(topic.evidenceIds||[]).slice().sort().join('|');
      if(!fp)return true;
      if(fingerprints.has(fp))return false;
      fingerprints.add(fp);return true;
    })
    .slice(0,Math.max(1,limit));
}

export default function EmergingTrends({topics,selectedTopic,onChoose}:{topics:ScanTopic[];selectedTopic:string;onChoose:(topic:ScanTopic)=>void}){
  const visible=topics.slice(0,10);
  if(!visible.length)return null;
  return <>
    <div className={styles.platforms}><span>Emerging trends · top {visible.length} scan signals · only QUALIFIED reaches the dashboard</span></div>
    <div className={styles.topicRow}>{visible.map((topic)=>{
      const key=String(topic.key||topic.topic||'');
      const qualified=qualifiesForDashboard(topic);
      return <button className={styles.topic} data-selected={selectedTopic===key||undefined} data-qualified={qualified||undefined} onClick={()=>onChoose(topic)} key={key}>
        <span className={styles.topicTitle}><b>{clean(topic.topic||topic.key,120)}</b><em>{topic.scanStatus||signalStatus(topic)}</em></span>
        <small>Signal {Math.round(Number(topic.signalScore||0))} · {topic.authorCount||0} creator{Number(topic.authorCount||0)===1?'':'s'} · {topic.evidenceCount||0} post{Number(topic.evidenceCount||0)===1?'':'s'}{(topic.platforms||[]).length?` · ${(topic.platforms||[]).join(' + ')}`:''}</small>
      </button>;
    })}</div>
  </>;
}
