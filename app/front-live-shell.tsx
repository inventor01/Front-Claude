'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, Eye, Radio, Sparkles } from 'lucide-react';
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

const topicName=(topic:LiveTopic)=>String(topic.topic||topic.key||'').replace(/\s+/g,' ').trim();
const topicFingerprint=(topics:LiveTopic[])=>topics.slice(0,30).map((topic)=>`${topic.key||topic.topic}:${topic.evidenceCount||0}:${topic.authorCount||0}:${topic.score||0}`).join('|');

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
  const [syncError,setSyncError]=useState('');
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
          // The live panel supplied incremental findings while the scan ran.
          // Remount the canonical feed once at completion so final ranking,
          // dedupe, visual understanding and coin matches replace the preview.
          setRefreshKey((value)=>value+1);
        }
        if(!wasActive.current&&next.active){
          syncedIds.current.clear();
          lastTopics.current='';
          setSynced(0);
          setSyncError('');
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
  const topics=(live?.inferredTopics||[]).filter((topic)=>topicName(topic)).slice(0,6);
  const xCount=live?.platformCounts?.X||0;
  const tiktokCount=live?.platformCounts?.TikTok||0;

  return <>
    {show&&live&&<section className={styles.livePanel} data-active={live.active||undefined}>
      <div className={styles.liveHead}>
        <div className={styles.liveTitle}><Radio size={15}/><b>LIVE SCAN</b><span>{live.phase}</span></div>
        <div className={styles.liveNumbers}>
          <span><Eye size={14}/><b>{live.observed}</b> observed</span>
          <span><Sparkles size={14}/><b>{live.candidateTopics}</b> candidates</span>
          <span><Activity size={14}/><b>{synced}</b> synced</span>
        </div>
      </div>
      <div className={styles.platforms}><span>X {xCount}</span><span>TikTok {tiktokCount}</span><span className={styles.pulse}>dashboard updating every 3s</span></div>
      {topics.length>0&&<div className={styles.topicRow}>{topics.map((topic)=><span className={styles.topic} key={`${topic.key||topic.topic}`}><b>{topicName(topic)}</b><small>{topic.authorCount||0} creators · {topic.evidenceCount||0} posts</small></span>)}</div>}
      {syncError&&<div className={styles.liveError}>{syncError}</div>}
    </section>}
    <FrontDesk key={refreshKey}/>
  </>;
}
