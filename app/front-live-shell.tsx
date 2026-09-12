'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Eye, Filter, Radio, Sparkles } from 'lucide-react';
import FrontDesk from './front-desk';
import styles from './front-live-shell.module.css';

const BRIDGE = 'http://127.0.0.1:43981';

type LiveEvidence = {
  id:string;
  platform:'X'|'TikTok';
  author:string;
  url:string;
  content:string;
  published:number|null;
  views:number|null;
  likes:number|null;
  provenance:string;
};

type LiveTopic = {
  topic?:string;
  key?:string;
  tier?:string;
  evidenceCount?:number;
  authorCount?:number;
  platforms?:string[];
  evidenceIds?:string[];
  score?:number;
  corroborated?:boolean;
};

type LiveState = {
  ok:boolean;
  version:number;
  active:boolean;
  status:string;
  phase:string;
  startedAt:number|null;
  updatedAt:number|null;
  completedAt:number|null;
  observed:number;
  candidateTopics:number;
  platformCounts:Record<string,number>;
  sourcePages:string[];
  errors:string[];
  evidence:LiveEvidence[];
  inferredTopics:LiveTopic[];
};

type LiveFilter='all'|'X'|'TikTok'|'early'|'qualified'|'synced';

const topicName=(topic:LiveTopic)=>String(topic.topic||topic.key||'').replace(/\s+/g,' ').trim();
const topicFingerprint=(topics:LiveTopic[])=>topics.slice(0,30).map((topic)=>`${topic.key||topic.topic}:${topic.evidenceCount||0}:${topic.authorCount||0}:${topic.score||0}:${topic.tier||''}:${topic.corroborated===true?'1':'0'}`).join('|');
const compact=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
const ago=(value:number|null|undefined)=>{
  if(!value)return 'time unknown';
  const minutes=Math.max(0,Math.round((Date.now()-value)/60000));
  if(minutes<60)return `${minutes}m ago`;
  if(minutes<2880)return `${(minutes/60).toFixed(minutes<600?1:0)}h ago`;
  return `${Math.round(minutes/1440)}d ago`;
};

function qualifiesTopic(topic:LiveTopic){
  const evidenceCount=Math.max(0,Number(topic.evidenceCount||0));
  const authorCount=Math.max(0,Number(topic.authorCount||0));
  const words=topicName(topic).split(/\s+/).filter(Boolean);
  return evidenceCount>=2&&authorCount>=2&&topic.tier==='candidate'&&topic.corroborated===true&&!(words.length===1&&authorCount<3);
}

function qualificationReason(topic:LiveTopic){
  const evidenceCount=Math.max(0,Number(topic.evidenceCount||0));
  const authorCount=Math.max(0,Number(topic.authorCount||0));
  const words=topicName(topic).split(/\s+/).filter(Boolean);
  if(evidenceCount<2)return 'Needs at least 2 supporting posts';
  if(authorCount<2)return 'Needs at least 2 independent creators';
  if(words.length===1&&authorCount<3)return 'One-word topic needs 3 independent creators';
  if(topic.tier==='pre-breakout')return 'Still in pre-breakout learning';
  if(topic.corroborated!==true)return 'Needs stronger corroboration before promotion';
  if(topic.tier!=='candidate')return 'Not promoted to candidate status yet';
  return 'Qualified for the narrative feed';
}

function evidenceMatchesTopics(row:LiveEvidence,topics:LiveTopic[]){
  const ids=new Set(topics.flatMap((topic)=>topic.evidenceIds||[]));
  if(ids.has(row.id))return true;
  const haystack=row.content.toLowerCase();
  return topics.some((topic)=>{
    const needle=topicName(topic).toLowerCase();
    return needle.length>1&&haystack.includes(needle);
  });
}

async function saveLive(evidence:LiveEvidence[],inferredTopics:LiveTopic[]){
  const response=await fetch('/api/browser-evidence',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({evidence,inferredTopics}),
  });
  const data=await response.json() as {accepted?:number;error?:string};
  if(!response.ok)throw new Error(data.error||'Could not sync live scan findings.');
  if(evidence.length){
    void fetch('/api/browser-rich',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({evidence,inferredTopics}),
    }).catch(()=>null);
  }
  return data;
}

export default function FrontLiveShell(){
  const [live,setLive]=useState<LiveState|null>(null);
  const [refreshKey,setRefreshKey]=useState(0);
  const [synced,setSynced]=useState(0);
  const [syncedEvidenceIds,setSyncedEvidenceIds]=useState<Set<string>>(()=>new Set());
  const [syncError,setSyncError]=useState('');
  const [expanded,setExpanded]=useState(false);
  const [filter,setFilter]=useState<LiveFilter>('all');
  const [selectedTopic,setSelectedTopic]=useState('');
  const syncedIds=useRef(new Set<string>());
  const lastTopics=useRef('');
  const syncing=useRef(false);
  const wasActive=useRef(false);

  useEffect(()=>{
    let stopped=false;
    let timer:ReturnType<typeof setTimeout>|undefined;

    const poll=async()=>{
      try{
        const response=await fetch(`${BRIDGE}/live`,{cache:'no-store'});
        if(!response.ok)throw new Error(`Local live scan endpoint returned ${response.status}.`);
        const next=await response.json() as LiveState;
        if(stopped)return;
        setLive(next);

        const fingerprint=topicFingerprint(next.inferredTopics||[]);
        const fresh=(next.evidence||[]).filter((row)=>row?.id&&!syncedIds.current.has(row.id)).slice(0,120);
        const topicsChanged=Boolean(fingerprint&&fingerprint!==lastTopics.current);
        if((fresh.length||topicsChanged)&&!syncing.current){
          syncing.current=true;
          try{
            await saveLive(fresh,next.inferredTopics||[]);
            for(const row of fresh)syncedIds.current.add(row.id);
            if(fresh.length){
              setSyncedEvidenceIds((current)=>{
                const updated=new Set(current);
                for(const row of fresh)updated.add(row.id);
                return updated;
              });
            }
            if(fingerprint)lastTopics.current=fingerprint;
            if(fresh.length)setSynced((count)=>count+fresh.length);
            setSyncError('');
          }catch(error){
            setSyncError((error as Error).message);
          }finally{
            syncing.current=false;
          }
        }

        if(wasActive.current&&!next.active){
          setRefreshKey((value)=>value+1);
          if(next.observed>0||(next.inferredTopics||[]).length>0)setExpanded(true);
        }
        if(!wasActive.current&&next.active){
          syncedIds.current.clear();
          lastTopics.current='';
          setSynced(0);
          setSyncedEvidenceIds(new Set());
          setSyncError('');
          setFilter('all');
          setSelectedTopic('');
          setExpanded(false);
        }
        wasActive.current=next.active;
      }catch{
        if(!stopped)setLive(null);
      }finally{
        if(!stopped)timer=setTimeout(poll,3000);
      }
    };

    timer=setTimeout(poll,0);
    return()=>{stopped=true;if(timer)clearTimeout(timer);};
  },[]);

  const topics=(live?.inferredTopics||[]).filter((topic)=>topicName(topic)).slice(0,24);
  const qualifiedTopics=topics.filter(qualifiesTopic);
  const earlyTopics=topics.filter((topic)=>!qualifiesTopic(topic));
  const xCount=live?.platformCounts?.X||0;
  const tiktokCount=live?.platformCounts?.TikTok||0;
  const show=Boolean(live&&(live.active||live.observed>0||topics.length>0||(live.status&&live.status!=='idle')));

  const evidence=useMemo(()=>{
    const rows=live?.evidence||[];
    const topic=selectedTopic?topics.find((item)=>String(item.key||item.topic)===selectedTopic):undefined;
    return rows.filter((row)=>{
      if(topic){
        const topicIds=new Set(topic.evidenceIds||[]);
        if(topicIds.size)return topicIds.has(row.id);
        const needle=topicName(topic).toLowerCase();
        return needle.length>1&&row.content.toLowerCase().includes(needle);
      }
      if(filter==='X'||filter==='TikTok')return row.platform===filter;
      if(filter==='synced')return syncedEvidenceIds.has(row.id);
      if(filter==='early')return evidenceMatchesTopics(row,earlyTopics);
      if(filter==='qualified')return evidenceMatchesTopics(row,qualifiedTopics);
      return true;
    }).slice().reverse().slice(0,80);
  },[live?.evidence,filter,selectedTopic,topics,earlyTopics,qualifiedTopics,syncedEvidenceIds]);

  function chooseFilter(next:LiveFilter){
    setFilter(next);
    setSelectedTopic('');
    setExpanded(true);
  }

  function chooseTopic(topic:LiveTopic){
    setSelectedTopic(String(topic.key||topic.topic||''));
    setFilter(qualifiesTopic(topic)?'qualified':'early');
    setExpanded(true);
  }

  const selected=selectedTopic?topics.find((item)=>String(item.key||item.topic)===selectedTopic):undefined;
  const emptyCandidateMessage=live&&live.observed>0&&!topics.length;
  const panelTitle=live?.active?'LIVE SCAN':'RECENT SCAN RESULTS';
  const panelStatus=live?.active?live.phase:(live?.status||live?.phase||'complete');

  return <>
    {show&&live&&<section className={styles.livePanel} data-active={live.active||undefined} data-complete={!live.active||undefined}>
      <div className={styles.liveHead}>
        <button className={styles.liveTitleButton} onClick={()=>setExpanded((value)=>!value)} aria-expanded={expanded}>
          <span className={styles.liveTitle}>{live.active?<Radio size={15}/>:<CheckCircle2 size={15}/>}<b>{panelTitle}</b><span>{panelStatus}</span></span>
          {expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>} 
        </button>
        <div className={styles.liveNumbers}>
          <button data-selected={filter==='all'&&!selectedTopic||undefined} onClick={()=>chooseFilter('all')}><Eye size={14}/><b>{live.observed}</b> observed</button>
          <button data-selected={filter==='early'&&!selectedTopic||undefined} onClick={()=>chooseFilter('early')}><Sparkles size={14}/><b>{earlyTopics.length}</b> early</button>
          <button data-selected={filter==='qualified'&&!selectedTopic||undefined} onClick={()=>chooseFilter('qualified')}><CheckCircle2 size={14}/><b>{qualifiedTopics.length}</b> qualified</button>
          <button data-selected={filter==='synced'&&!selectedTopic||undefined} onClick={()=>chooseFilter('synced')}><Activity size={14}/><b>{synced}</b> synced</button>
        </div>
      </div>
      <div className={styles.platforms}>
        <button data-selected={filter==='X'&&!selectedTopic||undefined} onClick={()=>chooseFilter('X')}>X {xCount}</button>
        <button data-selected={filter==='TikTok'&&!selectedTopic||undefined} onClick={()=>chooseFilter('TikTok')}>TikTok {tiktokCount}</button>
        <button className={styles.allFilter} data-selected={filter==='all'&&!selectedTopic||undefined} onClick={()=>chooseFilter('all')}><Filter size={11}/>All</button>
        <span className={styles.pulse}>{live.active?'dashboard updating every 3s':'last scan stays visible until the next scan'}</span>
      </div>
      {topics.length>0&&<div className={styles.topicRow}>{topics.map((topic)=>{
        const qualified=qualifiesTopic(topic);
        return <button className={styles.topic} data-selected={selectedTopic===String(topic.key||topic.topic)||undefined} data-qualified={qualified||undefined} onClick={()=>chooseTopic(topic)} key={`${topic.key||topic.topic}`}>
          <span className={styles.topicTitle}><b>{topicName(topic)}</b><em>{qualified?'Qualified':'Early'}</em></span>
          <small>{qualified?'Qualified for feed':qualificationReason(topic)} · {topic.authorCount||0} creators · {topic.evidenceCount||0} posts</small>
        </button>;
      })}</div>}
      {expanded&&<div className={styles.drawer}>
        <div className={styles.drawerHead}>
          <div><b>{selected?topicName(selected):filter==='all'?'Observed posts':filter==='early'?'Early candidates':filter==='qualified'?'Qualified narratives':`${filter} evidence`}</b><span>{evidence.length} visible · raw observations stay inspectable even when nothing qualifies</span></div>
          <button onClick={()=>setExpanded(false)}>Collapse <ChevronUp size={13}/></button>
        </div>
        {selected&&<div className={styles.qualificationNote} data-qualified={qualifiesTopic(selected)||undefined}><b>{qualifiesTopic(selected)?'Qualified narrative':'Not promoted yet'}</b><span>{qualificationReason(selected)}</span></div>}
        {emptyCandidateMessage&&<div className={styles.qualificationNote}><b>No repeated candidate topic yet</b><span>Front still found posts. They remain under Observed while the scanner waits for repeated, specific evidence from independent creators instead of inventing a narrative.</span></div>}
        {filter==='early'&&!selected&&earlyTopics.length===0&&live.observed>0&&<div className={styles.qualificationNote}><b>No early candidate currently survives grouping</b><span>The observed posts are still available under Observed, X, and TikTok. A candidate needs repeated topic evidence instead of a single unrelated post.</span></div>}
        {filter==='qualified'&&!selected&&qualifiedTopics.length===0&&live.observed>0&&<div className={styles.qualificationNote}><b>No narrative qualified yet</b><span>This is different from finding nothing. Front has {live.observed} observed post{live.observed===1?'':'s'}, but none currently clear the promotion gates.</span></div>}
        {evidence.length?<div className={styles.evidenceGrid}>{evidence.map((row)=><a key={row.id} href={row.url} target='_blank' rel='noreferrer' className={styles.evidenceCard}>
          <div className={styles.evidenceMeta}><b>{row.platform} · @{row.author}</b><ExternalLink size={12}/></div>
          <p>{row.content}</p>
          <small>{[ago(row.published),row.views!=null?`${compact(row.views)} views`:null,row.likes!=null?`${compact(row.likes)} likes`:null].filter(Boolean).join(' · ')}</small>
        </a>)}</div>:<div className={styles.noEvidence}>No scan evidence matches this filter yet.</div>}
      </div>}
      {syncError&&<div className={styles.liveError}>{syncError}</div>}
    </section>}
    <FrontDesk key={refreshKey}/>
  </>;
}
