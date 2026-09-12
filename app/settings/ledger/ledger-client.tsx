'use client';

import {useEffect,useState} from 'react';
import {ArrowLeft,RefreshCw,Square,Trash2} from 'lucide-react';
import styles from './ledger-client.module.css';

const BRIDGE='http://127.0.0.1:43981';

type Sample={platform?:string|null;author?:string|null;url?:string|null;mediaType?:string|null;provenance?:string|null;content?:string|null;contentConfidence?:number|null;views?:number|null;likes?:number|null};
type ScanEntry={
  id:string;
  startedAt:number;
  completedAt?:number|null;
  durationMs?:number|null;
  status:string;
  phase?:string|null;
  scanConnection?:string|null;
  request?:{mode?:string;targetUniqueFeedItems?:number|null;keywordCount?:number;sentinelCount?:number};
  usableEvidence?:number;
  observed?:number;
  inferredTopics?:number;
  uniqueCreators?:number|null;
  sourceCounts?:Record<string,number>;
  platformCounts?:Record<string,number>;
  errors?:string[];
  fallback?:{triggered?:boolean;failed?:boolean;rawEvidence?:number;groundedEvidence?:number;diagnostics?:unknown}|null;
  vision?:{enabled?:boolean;provider?:string|null;model?:string|null;visuallyUnderstood?:number;scan?:Record<string,unknown>|null;lastError?:string|null}|null;
  contentUnderstanding?:{enabled?:boolean;provider?:string|null;model?:string|null;cachedVideos?:number;lastRun?:number|null;lastError?:string|null}|null;
  samples?:Sample[];
};
type Ledger={ok:boolean;version:number;current:ScanEntry|null;scans:ScanEntry[];retained:number};

function time(value?:number|null){return value?new Date(value).toLocaleString():'—';}
function duration(ms?:number|null){if(!ms)return'—';if(ms<1000)return`${ms} ms`;const sec=Math.round(ms/1000);return sec<60?`${sec}s`:`${Math.floor(sec/60)}m ${sec%60}s`;}
function counts(value?:Record<string,number>){const entries=Object.entries(value||{}).filter(([,n])=>Number(n)>0);return entries.length?entries.map(([k,n])=>`${k}: ${n}`).join(' · '):'None';}
function statusClass(status:string){return status==='complete'?styles.success:status==='running'?styles.running:status==='stopped'?styles.stopped:styles.warning;}

export default function LedgerClient(){
  const [ledger,setLedger]=useState<Ledger|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');

  async function refresh(silent=false){
    try{
      const response=await fetch(`${BRIDGE}/ledger`,{cache:'no-store'});
      const data=await response.json() as Ledger&{error?:string};
      if(!response.ok)throw new Error(data.error||'Could not read local scan ledger.');
      setLedger(data);setError('');
    }catch(e){if(!silent)setError((e as Error).message);}
  }
  async function stop(){
    setBusy('stop');
    try{const response=await fetch(`${BRIDGE}/stop`,{method:'POST'});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Could not stop scan.');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  }
  async function clear(){
    setBusy('clear');
    try{const response=await fetch(`${BRIDGE}/ledger/clear`,{method:'POST'});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Could not clear ledger.');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  useEffect(()=>{
    const kickoff=window.setTimeout(()=>{void refresh();},0);
    const timer=window.setInterval(()=>void refresh(true),2000);
    return()=>{window.clearTimeout(kickoff);window.clearInterval(timer);};
  },[]);

  const current=ledger?.current;
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>FRONT · SCAN LEDGER</div><h1>What Front actually scanned</h1><p>Live and historical local scan diagnostics: source counts, usable evidence, visual recovery, Ollama activity, errors, and sample post URLs.</p></div>
      <a className={styles.back} href="/settings"><ArrowLeft size={15}/> Scanner settings</a>
    </header>

    {error&&<div className={styles.error}>{error}</div>}

    <section className={styles.toolbar}>
      <button onClick={()=>void refresh()} disabled={!!busy}><RefreshCw size={14}/> Refresh</button>
      <button className={styles.danger} onClick={()=>void stop()} disabled={!!busy||!current}><Square size={14}/> {busy==='stop'?'Stopping…':'Stop current scan'}</button>
      <button onClick={()=>void clear()} disabled={!!busy||!ledger?.scans.length}><Trash2 size={14}/> {busy==='clear'?'Clearing…':'Clear history'}</button>
      <span>{ledger?`${ledger.retained} completed scan${ledger.retained===1?'':'s'} retained`:'Connecting to local bridge…'}</span>
    </section>

    <section className={styles.liveCard}>
      <div className={styles.cardHead}><div><h2>Live scan</h2><p>Updates every 2 seconds while this page is open.</p></div><span className={current?statusClass(current.status):styles.idle}>{current?current.status:'idle'}</span></div>
      {current?<>
        <div className={styles.metrics}>
          <div><span>Phase</span><b>{current.phase||'starting'}</b></div>
          <div><span>Mode</span><b>{current.request?.mode||'deep'}</b></div>
          <div><span>Browser</span><b>{current.scanConnection||'checking'}</b></div>
          <div><span>Started</span><b>{time(current.startedAt)}</b></div>
        </div>
        <div className={styles.liveLine}>Vision: {current.contentUnderstanding?.enabled?`${current.contentUnderstanding.provider||'provider'} · ${current.contentUnderstanding.model||'model'} · ${current.contentUnderstanding.cachedVideos||0} cached video(s)`:'waiting for content understanding status'}</div>
      </>:<div className={styles.empty}>No scan is running right now. Start a Deep Scan from Scanner Settings and this section will immediately show activity.</div>}
    </section>

    <section className={styles.history}>
      <div className={styles.sectionHead}><h2>Recent scans</h2><p>Newest first. These records stay on this Mac in the Front bridge data folder.</p></div>
      {!ledger?.scans.length?<div className={styles.empty}>No completed scans recorded yet.</div>:ledger.scans.map((scan)=><article className={styles.scanCard} key={scan.id}>
        <div className={styles.cardHead}><div><h3>{scan.request?.mode==='scout'?'Scout':'Deep'} scan · {time(scan.startedAt)}</h3><p>{duration(scan.durationMs)} · {scan.id}</p></div><span className={statusClass(scan.status)}>{scan.status}</span></div>
        <div className={styles.metrics}>
          <div><span>Observed</span><b>{scan.observed??0}</b></div>
          <div><span>Usable evidence</span><b>{scan.usableEvidence??0}</b></div>
          <div><span>Topics</span><b>{scan.inferredTopics??0}</b></div>
          <div><span>Creators</span><b>{scan.uniqueCreators??0}</b></div>
        </div>
        <div className={styles.detail}><b>Sources</b><span>{counts(scan.sourceCounts)}</span></div>
        <div className={styles.detail}><b>Platforms</b><span>{counts(scan.platformCounts)}</span></div>
        {scan.fallback?.triggered&&<div className={styles.detail}><b>Visual recovery</b><span>{scan.fallback.failed?'Failed':`Observed ${scan.fallback.rawEvidence||0}; grounded ${scan.fallback.groundedEvidence||0}`}</span></div>}
        {scan.vision&&<div className={styles.detail}><b>Video understanding</b><span>{scan.vision.enabled?`${scan.vision.provider||'provider'} · ${scan.vision.model||'model'} · understood ${scan.vision.visuallyUnderstood||0}`:'inactive'}{scan.vision.lastError?` · ${scan.vision.lastError}`:''}</span></div>}
        {!!scan.errors?.length&&<details className={styles.details} open={(scan.usableEvidence||0)===0}><summary>{scan.errors.length} warning/error{scan.errors.length===1?'':'s'}</summary><div className={styles.errorList}>{scan.errors.map((item,i)=><p key={i}>{item}</p>)}</div></details>}
        {!!scan.samples?.length&&<details className={styles.details}><summary>{scan.samples.length} scanned evidence sample{scan.samples.length===1?'':'s'}</summary><div className={styles.samples}>{scan.samples.map((sample,i)=><div className={styles.sample} key={`${sample.url}-${i}`}><div><b>{sample.platform||'Post'}{sample.author?` · @${sample.author}`:''}{sample.mediaType?` · ${sample.mediaType}`:''}</b><small>{sample.provenance||'Local browser scan'}</small></div>{sample.content&&<p>{sample.content}</p>}{sample.url&&<a href={sample.url} target="_blank" rel="noreferrer">Open scanned post</a>}</div>)}</div></details>}
      </article>)}
    </section>
  </main>;
}
