'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, ExternalLink, Eye, Filter, Radio, Sparkles } from 'lucide-react';
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

type LiveFilter='all'|'X'|'TikTok'|'candidates'|'synced';

const topicName=(topic:LiveTopic)=>String(topic.topic||topic.key||'').replace(/\s+/g,' ').trim();
const topicFingerprint=(topics:LiveTopic[])=>topics.slice(0,30).map((topic)=>`${topic.key||topic.topic}:${topic.evidenceCount||0}:${topic.authorCount||0}:${topic.score||0}`).join('|');
const compact=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
const ago=(value:number|null|undefined)=>{
  if(!value)return 'time unknown';
  const minutes=Math.max(0,Math.round((Date.now()-value)/60000));
  if(minutes<60)return `${minutes}m ago`;
  if(minutes<2880)return `${(minutes/60).toFixed(minutes<600?1:0)}h ago`;
  return `${Math.round(minutes/1440)}d ago`;
};

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

  const show=Boolean(live?.active);
  const topics=(live?.inferredTopics||[]).filter((topic)=>topicName(topic)).slice(0,12);
  const xCount=live?.platformCounts?.X||0;
  const tiktokCount=live?.platformCounts?.TikTok||0;

  const evidence=useMemo(()=>{
    const rows=live?.evidence||[];
    const topic=selectedTopic?topics.find((item)=>String(item.key||item.topic)===selectedTopic):undefined;
    const topicIds=new Set(topic?.evidenceIds||[]);
    const candidateIds=new Set(topics.flatMap((item)=>item.evidenceIds||[]));
    return rows.filter((row)=>{
      if(topic){
        if(topicIds.size)return topicIds.has(row.id);
        const needle=topicName(topic).toLowerCase();
        return needle.length>1&&row.content.toLowerCase().includes(needle);
      }
      if(filter==='X'||filter==='TikTok')return row.platform===filter;
      if(filter==='synced')return syncedEvidenceIds.has(row.id);
      if(filter==='candidates')return candidateIds.has(row.id);
      return true;
    }).slice().reverse().slice(0,80);
  },[live?.evidence,filter,selectedTopic,topics,syncedEvidenceIds]);

  function chooseFilter(next:LiveFilter){
    setFilter(next);
    setSelectedTopic('');
    setExpanded(true);
  }

  function chooseTopic(topic:LiveTopic){
    setSelectedTopic(String(topic.key||topic.topic||''));
    setFilter('candidates');
    setExpanded(true);
  }

  return <>
    {show&&live&&<section className={styles.livePanel} data-active={live.active||undefined}>
      <div className={styles.liveHead}>
        <button className={styles.liveTitleButton} onClick={()=>setExpanded((value)=>!value)} aria-expanded={expanded}>
          <span className={styles.liveTitle}><Radio size={15}/><b>LIVE SCAN</b><span>{live.phase}</span></span>
          {expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>} 
        </button>
        <div className={styles.liveNumbers}>
          <button data-selected={filter==='all'&&!selectedTopic||undefined} onClick={()=>chooseFilter('all')}><Eye size={14}/><b>{live.observed}</b> observed</button>
          <button data-selected={filter==='candidates'&&!selectedTopic||undefined} onClick={()=>chooseFilter('candidates')}><Sparkles size={14}/><b>{live.candidateTopics}</b> candidates</button>
          <button data-selected={filter==='synced'&&!selectedTopic||undefined} onClick={()=>chooseFilter('synced')}><Activity size={14}/><b>{synced}</b> synced</button>
        </div>
      </div>
      <div className={styles.platforms}>
        <button data-selected={filter==='X'&&!selectedTopic||undefined} onClick={()=>chooseFilter('X')}>X {xCount}</button>
        <button data-selected={filter==='TikTok'&&!selectedTopic||undefined} onClick={()=>chooseFilter('TikTok')}>TikTok {tiktokCount}</button>
        <button className={styles.allFilter} data-selected={filter==='all'&&!selectedTopic||undefined} onClick={()=>chooseFilter('all')}><Filter size={11}/>All</button>
        <span className={styles.pulse}>dashboard updating every 3s</span>
      </div>
      {topics.length>0&&<div className={styles.topicRow}>{topics.map((topic)=><button className={styles.topic} data-selected={selectedTopic===String(topic.key||topic.topic)||undefined} onClick={()=>chooseTopic(topic)} key={`${topic.key||topic.topic}`}><b>{topicName(topic)}</b><small>{topic.authorCount||0} creators · {topic.evidenceCount||0} posts</small></button>)}</div>}
      {expanded&&<div className={styles.drawer}>
        <div className={styles.drawerHead}>
          <div><b>{selectedTopic?topicName(topics.find((item)=>String(item.key||item.topic)===selectedTopic)??{}):filter==='all'?'All live evidence':`${filter} evidence`}</b><span>{evidence.length} visible · click X, TikTok, candidates, synced, or a topic to filter</span></div>
          <button onClick={()=>setExpanded(false)}>Collapse <ChevronUp size={13}/></button>
        </div>
        {evidence.length?<div className={styles.evidenceGrid}>{evidence.map((row)=><a key={row.id} href={row.url} target='_blank' rel='noreferrer' className={styles.evidenceCard}>
          <div className={styles.evidenceMeta}><b>{row.platform} · @{row.author}</b><ExternalLink size={12}/></div>
          <p>{row.content}</p>
          <small>{[ago(row.published),row.views!=null?`${compact(row.views)} views`:null,row.likes!=null?`${compact(row.likes)} likes`:null].filter(Boolean).join(' · ')}</small>
        </a>)}</div>:<div className={styles.noEvidence}>No live evidence matches this filter yet.</div>}
      </div>}
      {syncError&&<div className={styles.liveError}>{syncError}</div>}
    </section>}
    <FrontDesk key={refreshKey}/>
  </>;
}
