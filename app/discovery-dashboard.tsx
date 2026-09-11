'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ExternalLink, Layers, Radio, RefreshCw, Search, Sparkles } from 'lucide-react';
import styles from './discovery-dashboard.module.css';

type PublicStatus='Raw signal'|'Early candidate'|'Promoted';
type PublicItem={id:string;source:string;sourceKey:string;title:string;query:string;url:string;observed:number;published:number|null;views:number|null;likes:number|null;status:PublicStatus;narrative?:{id:string;title:string}|null;detail:string};
type PublicDiagnostics={browserEvidence:number;usableBrowserEvidence?:number;ignoredNotifications?:number;uniqueAuthors:number;earlyCandidates:number;sourceCounts:Record<string,number>;latestBrowserSeen:number|null;externalSignals:number;diagnosis:string|null};
type PublicFeed={items:PublicItem[];page:{total:number};counts:Record<string,number>;diagnostics:PublicDiagnostics;at:number;note:string};
type RadarSignal={id:string;title:string;source:string;detail:string;url:string;query:string};
type RadarFeed={signals:RadarSignal[];page?:{total:number};at:number;note?:string};
type BridgeHealth={ok:boolean;version:number;running:boolean;lastRun:number|null;lastCount:number;lastError:string|null;pendingCount?:number;nextScheduledRun?:number|null;scanConnection?:string};

const BRIDGE='http://127.0.0.1:43981';
const sourceLabels:Record<string,string>={
 'x-trending':'X Trending','x-feed':'X Feed','x-search':'X Search','tiktok-trending':'TikTok Trending','tiktok-explore':'TikTok Explore','tiktok-search':'TikTok Search','google-trends':'Google Trends','market-theme':'Market themes','x-browser':'X Browser','tiktok-browser':'TikTok Browser'
};
const age=(ts:number|null|undefined)=>{if(!ts)return'unknown';const mins=Math.max(0,Math.round((Date.now()-ts)/60000));if(mins<60)return`${mins}m`;const h=mins/60;if(h<48)return`${h.toFixed(h<10?1:0)}h`;return`${Math.round(h/24)}d`;};
const compact=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);

async function json<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{cache:'no-store',...init});const d=await r.json() as T&{error?:string};if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;}

export default function DiscoveryDashboard(){
 const [publicFeed,setPublicFeed]=useState<PublicFeed|null>(null);
 const [radar,setRadar]=useState<RadarFeed|null>(null);
 const [bridge,setBridge]=useState<BridgeHealth|null>(null);
 const [bridgeReachable,setBridgeReachable]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [view,setView]=useState<'all'|'early'|'raw'>('all');

 async function refresh(){
  setBusy(true);setError('');
  const [publicResult,radarResult]=await Promise.allSettled([
   json<PublicFeed>('/api/public-signals?limit=100&source=all'),
   json<RadarFeed>('/api/desk?action=discover&limit=100&offset=0'),
  ]);
  if(publicResult.status==='fulfilled')setPublicFeed(publicResult.value);else setError(publicResult.reason instanceof Error?publicResult.reason.message:'Could not load Public Signals.');
  if(radarResult.status==='fulfilled')setRadar(radarResult.value);else setError(old=>old||(radarResult.reason instanceof Error?radarResult.reason.message:'Could not load Narrative Radar.'));
  try{const health=await json<BridgeHealth>(BRIDGE+'/health');setBridge(health);setBridgeReachable(true);}catch{setBridgeReachable(false);setBridge(null);}
  setBusy(false);
 }

 useEffect(()=>{const t=window.setTimeout(()=>void refresh(),0);const id=window.setInterval(()=>void refresh(),60000);const onSaved=()=>void refresh();window.addEventListener('front-browser-evidence-saved',onSaved);return()=>{window.clearTimeout(t);window.clearInterval(id);window.removeEventListener('front-browser-evidence-saved',onSaved);};},[]); // eslint-disable-line react-hooks/exhaustive-deps

 const early=useMemo(()=>publicFeed?.items.filter(x=>x.status==='Early candidate')??[],[publicFeed]);
 const raw=useMemo(()=>publicFeed?.items.filter(x=>x.status==='Raw signal')??[],[publicFeed]);
 const visible=useMemo(()=>view==='early'?early:view==='raw'?raw:(publicFeed?.items??[]),[view,early,raw,publicFeed]);
 const radarCount=radar?.page?.total??radar?.signals.length??0;
 const diag=publicFeed?.diagnostics;
 const quality=diag?.browserEvidence?Math.round(100*((diag.usableBrowserEvidence??diag.browserEvidence)/diag.browserEvidence)):0;
 const latestScan=bridge?.lastRun||diag?.latestBrowserSeen||null;
 const pending=bridge?.pendingCount??0;
 const noData=!busy&&(publicFeed?.items.length??0)===0&&radarCount===0;

 return <section className={styles.shell} aria-label="Front discovery command center">
  <header className={styles.header}>
   <div className={styles.brand}><span className={styles.mark}><Layers size={18}/></span><span>FRONT <small>DISCOVERY COMMAND CENTER</small></span></div>
   <div className={styles.headerActions}><span className={styles.status}><span className={bridgeReachable?(bridge?.running?styles.dotBusy:styles.dot):styles.dotOff}/>{bridgeReachable?`Scanner ${bridge?.running?'running':'connected'}`:'Scanner offline'}</span><button className={styles.button} onClick={()=>void refresh()} disabled={busy}><RefreshCw size={14} className={busy?styles.spin:''}/>Refresh</button></div>
  </header>
  <main className={styles.main}>
   <div className={styles.hero}><div><div className={styles.eyebrow}>RAW SIGNAL → EARLY CANDIDATE → NARRATIVE RADAR</div><h1>See the story before the coin.</h1><p>The dashboard now shows high-recall X/TikTok/public discovery and strict Narrative Radar side by side, so an empty Radar no longer looks like a failed scanner.</p></div><span className={styles.status}>Last evidence {age(latestScan)}</span></div>

   {error&&<div className={styles.alert}>{error}</div>}
   {diag?.diagnosis&&<div className={styles.alert}><b>Discovery diagnosis:</b> {diag.diagnosis}</div>}
   {noData&&<div className={styles.alert}><b>No synced discovery data yet.</b> Start/restart Browser Sources on this Mac, run a deep scan, then keep Front open long enough to sync the pending queue. Public provider signals will still appear independently when available.</div>}

   <div className={styles.stats}>
    <div className={styles.stat}><span>Public signals</span><strong>{publicFeed?.page.total??'—'}</strong><small>raw + early discovery</small></div>
    <div className={styles.stat}><span>Early candidates</span><strong>{diag?.earlyCandidates??early.length}</strong><small>interesting, not promoted</small></div>
    <div className={styles.stat}><span>Narrative Radar</span><strong>{radarCount||0}</strong><small>corroborated niche narratives</small></div>
    <div className={styles.stat}><span>Actual evidence</span><strong>{diag?.usableBrowserEvidence??diag?.browserEvidence??'—'}</strong><small>{diag?.ignoredNotifications??0} UI/notification rows rejected</small></div>
    <div className={styles.stat}><span>Creators</span><strong>{diag?.uniqueAuthors??'—'}</strong><small>unique sampled authors</small></div>
    <div className={styles.stat}><span>Pending sync</span><strong>{pending}</strong><small>{bridgeReachable?'local queue':'bridge not reachable'}</small></div>
   </div>
   <div className={styles.funnel}><b>{diag?.browserEvidence??0}</b> collected <span className={styles.arrow}>→</span><b>{diag?.usableBrowserEvidence??diag?.browserEvidence??0}</b> usable <span className={styles.arrow}>→</span><b>{diag?.earlyCandidates??early.length}</b> early <span className={styles.arrow}>→</span><b>{radarCount}</b> promoted</div>

   <div className={styles.grid}>
    <div className={styles.column}>
     <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2><Radio size={16}/> Public Signals + Early Candidates</h2><p>Raw discovery stays visible. Early Candidates bridge the gap before strict promotion.</p></div><div className={styles.modeBar}>{(['all','early','raw'] as const).map(mode=><button key={mode} className={`${styles.button} ${view===mode?styles.modeActive:''}`} onClick={()=>setView(mode)}>{mode==='all'?'All':mode==='early'?'Early':'Raw'}</button>)}</div></div>
      <div className={styles.list}>{visible.slice(0,30).map((item,i)=><article className={styles.item} key={item.id}><span className={styles.rank}>{String(i+1).padStart(2,'0')}</span><div><div className={styles.badges}><span className={item.status==='Early candidate'?styles.badgeHot:item.status==='Promoted'?styles.badgeRadar:styles.badgeRaw}>{item.status}</span><span className={styles.badge}>{item.source}</span><span className={styles.badge}>{age(item.published||item.observed)}</span></div><h3>{item.title}</h3><p>{item.detail}</p><div className={styles.meta}>views {compact(item.views)} · likes {compact(item.likes)}{item.narrative?` · Radar → ${item.narrative.title}`:''}</div></div><a className={styles.link} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`}><ExternalLink size={14}/></a></article>)}{!visible.length&&<div className={styles.empty}>No signals in this view yet. If Browser Sources collected items, check the scanner-health panel for pending sync or extraction rejection counts.</div>}</div>
     </section>

     <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2><Sparkles size={16}/> Narrative Radar</h2><p>Only corroborated niche narratives belong here. Zero Radar cards can be normal while Early Candidates are still developing.</p></div><span className={styles.count}>{radarCount} active</span></div>
      <div className={styles.list}>{(radar?.signals??[]).slice(0,20).map((item,i)=><article className={styles.item} key={item.id}><span className={styles.rank}>{String(i+1).padStart(2,'0')}</span><div><div className={styles.badges}><span className={styles.badgeRadar}>Promoted</span><span className={styles.badge}>Narrative Radar</span></div><h3>{item.title}</h3><p>{item.detail}</p></div><a className={styles.link} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`}><ExternalLink size={14}/></a></article>)}{!radar?.signals.length&&<div className={styles.empty}>Nothing has crossed the strict promotion gate yet. Use the Early Candidates above as the watchlist rather than treating this as a scanner failure.</div>}</div>
     </section>
    </div>

    <aside className={styles.column}>
     <section className={styles.panel}><div className={styles.panelHead}><div><h2><Activity size={16}/> Scanner health</h2><p>Proof that collection, cleaning, sync and promotion are each working.</p></div></div><div className={styles.health}><div className={styles.healthRow}><span>Local bridge</span><strong>{bridgeReachable?`v${bridge?.version} · ${bridge?.scanConnection||'connected'}`:'offline / blocked'}</strong></div><div className={styles.healthRow}><span>Last scan</span><strong>{latestScan?`${age(latestScan)} ago`:'none detected'}</strong></div><div className={styles.healthRow}><span>Last scan records</span><strong>{bridge?.lastCount??diag?.browserEvidence??0}</strong></div><div className={styles.healthRow}><span>Pending upload</span><strong>{pending}</strong></div><div className={styles.healthRow}><span>Content quality</span><strong>{diag?.browserEvidence?`${quality}% usable`:'no sample'}</strong></div><div className={styles.progress}><span style={{width:`${Math.max(0,Math.min(100,quality))}%`}}/></div>{bridge?.lastError&&<div className={styles.alert}><b>Last scanner warning:</b> {bridge.lastError}</div>}</div><div className={styles.quality}><h3>Evidence by source</h3><div className={styles.sourceGrid}>{Object.entries(diag?.sourceCounts??{}).sort((a,b)=>b[1]-a[1]).map(([key,count])=><div className={styles.sourceCard} key={key}><span>{sourceLabels[key]||key}</span><b>{count}</b></div>)}{!Object.keys(diag?.sourceCounts??{}).length&&<div className={styles.empty}>No synced browser-source counts yet.</div>}</div></div><div className={styles.footerNote}>The website cannot run your authenticated local Chrome scanner by itself. The bridge must stay running on this Mac. It can queue evidence while Front is closed, then Front syncs that queue when opened.</div></section>
    </aside>
   </div>
  </main>
 </section>;
}
