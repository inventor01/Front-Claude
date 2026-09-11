'use client';

import { useEffect, useState } from 'react';
import { Activity, ExternalLink, Radio, RefreshCw, Sparkles, Timer, TrendingUp } from 'lucide-react';
import styles from './narrative-workbench.module.css';

type MomentumWindow={creatorDelta?:number;evidenceDelta?:number;platformDelta?:number;creatorGrowthPct?:number|null};
type Momentum={label?:string;score?:number;windows?:Record<string,MomentumWindow>};
type Snapshot={observed:number;tier:string;score:number;creators:number;evidenceCount:number;platforms:string[];momentum:Momentum};
type Evidence={id:string;platform:string;author:string;url:string;content:string;published:number|null;first_seen:number;last_seen:number;provenance:string;views:number|null;likes:number|null};
type Relationship={related_key:string;related_title:string;relation:string;score:number;evidence_count:number;author_count:number;platforms:string[];observed:number};
type CoinData={name?:string;symbol?:string;price?:number|null;liquidity?:number|null;volume?:number|null;volume24h?:number|null;marketCap?:number|null;matchReason?:string};
type Coin={narrative:string;mint:string;observed:number;data:CoinData};
type Launch={mint:string;name:string;symbol:string|null;seen:number;narrative:string|null;match_type:string;data:{narrativeTitle?:string}};
type Detail={
 narrative:{id:string|null;title:string;aliases:string[];detectedAt:number|null;promotedAt:number|null;earliestEvidenceAt:number|null};
 latest:{key:string;title:string;observed:number;tier:string;score:number;momentum:Momentum;creators:number;evidenceCount:number;platforms:string[];origin:{url:string;published:number|null}|null}|null;
 snapshots:Snapshot[];
 evidence:Evidence[];
 relationships:Relationship[];
 coins:Coin[];
 launches:Launch[];
 edge:{detectedAt:number|null;firstLaunchAt:number|null;leadMs:number|null;status:'waiting'|'before-launch'|'after-launch'|'same-time'};
 note:string;
};

type Props={narrativeId?:string|null;topic:string};

const age=(ts:number|null|undefined)=>{if(!ts)return'unknown';const mins=Math.max(0,Math.round((Date.now()-ts)/60000));if(mins<60)return`${mins}m ago`;const h=mins/60;if(h<48)return`${h.toFixed(h<10?1:0)}h ago`;return`${Math.round(h/24)}d ago`;};
const compact=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
const dollars=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n>=1?2:8}).format(n);
const duration=(ms:number|null)=>{if(ms==null)return'unknown';const abs=Math.abs(ms);const mins=Math.round(abs/60000);if(mins<60)return`${mins}m`;const hours=mins/60;if(hours<48)return`${hours.toFixed(hours<10?1:0)}h`;return`${(hours/24).toFixed(1)}d`;};
const pump=(mint:string)=>`https://pump.fun/coin/${encodeURIComponent(mint)}`;
const axiom=(mint:string)=>`https://axiom.trade/t/${encodeURIComponent(mint)}`;

async function getJson<T>(url:string):Promise<T>{const response=await fetch(url,{cache:'no-store'});const data=await response.json() as T&{error?:string};if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data;}

export default function NarrativeWorkbench({narrativeId,topic}:Props){
 const [detail,setDetail]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{const params=new URLSearchParams(narrativeId?{id:narrativeId}:{topic});setDetail(await getJson<Detail>('/api/narrative-detail?'+params));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[narrativeId,topic]); // eslint-disable-line react-hooks/exhaustive-deps
 const latest=detail?.latest;
 const evidence=detail?.evidence??[];
 const distinctCreators=new Set(evidence.map(item=>`${item.platform}:${item.author.toLowerCase()}`)).size;
 const windows=[['15','15m'],['60','1h'],['360','6h'],['1440','24h']] as const;
 const edgeText=!detail?'':detail.edge.status==='waiting'?'No matching Pump.fun launch has been stored yet.':detail.edge.status==='before-launch'?`Front detected this ${duration(detail.edge.leadMs)} before the first matching stored launch.`:detail.edge.status==='after-launch'?`Front detected this ${duration(detail.edge.leadMs)} after the first matching stored launch.`:'Front detection and the first matching launch were recorded at about the same time.';
 const maxCreators=Math.max(1,...(detail?.snapshots??[]).map(s=>s.creators));
 return <div className={styles.workbench}>
  <div className={styles.topbar}><div><div className={styles.kicker}>NARRATIVE WORKBENCH</div><h4>{detail?.narrative.title||topic}</h4><p>Evidence, momentum, context, coins, launches and Front&apos;s timing edge in one place.</p></div><button className={styles.refresh} onClick={()=>void load()} disabled={busy}><RefreshCw size={13} className={busy?styles.spin:''}/>{busy?'Refreshing':'Refresh detail'}</button></div>
  {error&&<div className={styles.error}>{error}</div>}
  {!detail&&!error&&<div className={styles.loading}>Loading narrative intelligence…</div>}
  {detail&&<>
   <div className={styles.edgeCard} data-status={detail.edge.status}><Timer size={18}/><div><b>{edgeText}</b><span>Detection = earliest stored topic snapshot or Radar creation. Launch = matching PumpPortal creation event.</span></div></div>
   <div className={styles.summaryGrid}>
    <div><span>Front first detected</span><b>{age(detail.narrative.detectedAt)}</b><small>{detail.narrative.detectedAt?new Date(detail.narrative.detectedAt).toLocaleString():'Not stored'}</small></div>
    <div><span>Earliest sampled evidence</span><b>{age(detail.narrative.earliestEvidenceAt)}</b><small>Sampled evidence, not an absolute-origin claim</small></div>
    <div><span>Creators in evidence</span><b>{distinctCreators||latest?.creators||0}</b><small>{latest?.platforms?.join(' + ')||'social'}</small></div>
    <div><span>Momentum</span><b>{latest?.momentum?.label||'No live snapshot'}</b><small>score {latest?.momentum?.score?.toFixed?.(1)??'—'} · {latest?.evidenceCount??evidence.length} posts</small></div>
   </div>

   <section className={styles.section}><div className={styles.sectionHead}><div><h5><TrendingUp size={14}/> Momentum</h5><p>Creator/evidence acceleration across stored scan windows.</p></div><span>{detail.snapshots.length} snapshots</span></div>
    <div className={styles.windowGrid}>{windows.map(([key,label])=>{const win=latest?.momentum?.windows?.[key];return <div key={key} className={styles.window}><span>{label}</span><b>{win?`${(win.creatorDelta??0)>=0?'+':''}${win.creatorDelta??0} creators`:'—'}</b><small>{win?.creatorGrowthPct!=null?`${win.creatorGrowthPct}% creator growth`:`${win?.evidenceDelta??0} evidence delta`}</small></div>;})}</div>
    {detail.snapshots.length>1&&<div className={styles.history} aria-label="Creator history">{detail.snapshots.slice(-24).map((snap,index)=><div key={`${snap.observed}:${index}`} className={styles.historyBar} title={`${new Date(snap.observed).toLocaleString()} · ${snap.creators} creators · ${snap.evidenceCount} posts`}><span style={{height:`${Math.max(8,Math.round((snap.creators/maxCreators)*100))}%`}}/></div>)}</div>}
   </section>

   <section className={styles.section}><div className={styles.sectionHead}><div><h5><Sparkles size={14}/> Source evidence</h5><p>Actual posts/captions supporting the narrative.</p></div><span>{evidence.length} loaded</span></div>
    <div className={styles.evidenceList}>{evidence.slice(0,10).map(item=><article key={item.id} className={styles.evidenceCard}><div className={styles.evidenceMeta}><span>{item.platform}</span><span>{item.author}</span><span>{age(item.published||item.first_seen)}</span><span>views {compact(item.views)}</span><span>likes {compact(item.likes)}</span></div><p>{item.content.slice(0,380)}{item.content.length>380?'…':''}</p><a href={item.url} target="_blank" rel="noreferrer">Open source <ExternalLink size={11}/></a></article>)}{!evidence.length&&<div className={styles.empty}>No supporting evidence is available in the server detail record yet.</div>}</div>
   </section>

   <div className={styles.twoCol}>
    <section className={styles.section}><div className={styles.sectionHead}><div><h5><Activity size={14}/> Related context</h5><p>Repeated co-occurrence only; not a causal claim.</p></div></div><div className={styles.contextList}>{detail.relationships.slice(0,8).map(item=><div key={item.related_key}><b>{item.related_title}</b><span>{item.author_count} creators · {item.evidence_count} posts · {item.platforms.join(' + ')||'social'}</span></div>)}{!detail.relationships.length&&<div className={styles.empty}>No corroborated related context stored yet.</div>}</div></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><h5><Radio size={14}/> Matching launches</h5><p>PumpPortal creation events matched to this narrative.</p></div></div><div className={styles.launchList}>{detail.launches.slice(0,8).map(hit=><div key={hit.mint}><div><b>{hit.name}{hit.symbol?` · ${hit.symbol}`:''}</b><span>{age(hit.seen)} · {hit.match_type}</span></div><div><a href={pump(hit.mint)} target="_blank" rel="noreferrer">Pump</a><a href={axiom(hit.mint)} target="_blank" rel="noreferrer">Axiom</a></div></div>)}{!detail.launches.length&&<div className={styles.empty}>No matching stored launch yet. Front&apos;s server watcher remains armed for exact narrative aliases.</div>}</div></section>
   </div>

   <section className={styles.section}><div className={styles.sectionHead}><div><h5>Related coins</h5><p>Stored search candidates tied to this Radar narrative; association remains evidence-based, not guaranteed.</p></div><span>{detail.coins.length}</span></div><div className={styles.coinGrid}>{detail.coins.slice(0,10).map(coin=><div className={styles.coin} key={coin.mint}><div><b>{coin.data.name||coin.data.symbol||'Coin candidate'}{coin.data.symbol?` · ${coin.data.symbol}`:''}</b><span>price {dollars(coin.data.price)} · liq {dollars(coin.data.liquidity)}</span><span>volume {dollars(coin.data.volume24h??coin.data.volume)} · mcap {dollars(coin.data.marketCap)}</span><code>{coin.mint.slice(0,9)}…{coin.mint.slice(-5)}</code>{coin.data.matchReason&&<small>{coin.data.matchReason}</small>}</div><div className={styles.coinLinks}><a href={pump(coin.mint)} target="_blank" rel="noreferrer">Pump</a><a href={axiom(coin.mint)} target="_blank" rel="noreferrer">Axiom</a></div></div>)}{!detail.coins.length&&<div className={styles.empty}>No stored coin candidates yet. Use the row&apos;s coin button to run a match.</div>}</div></section>
   <div className={styles.note}>{detail.note}</div>
  </>}
 </div>;
}
