'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import styles from './front-desk.module.css';

const BRIDGE = 'http://127.0.0.1:43981';

type Coin = {
  mint:string;
  name:string;
  symbol:string;
  matchType:'exact'|'strong'|'possible'|string;
  matchScore:number;
  matchReason:string;
  marketCap:number|null;
  liquidity:number|null;
  volume24h:number|null;
  price:number|null;
  seen:number;
  verifiedPumpfun:true;
};

type HotPost = {
  url:string;
  platform:string;
  author:string;
  content:string;
  published:number|null;
  views:number|null;
  likes:number|null;
  ageHours:number|null;
  viewsPerHour:number;
  likesPerHour:number;
  hot:boolean;
  rising:boolean;
};

type LearningReason = {label:string;points:number;examples:number};

type Row = {
  id:string;
  title:string;
  stage:string;
  creators:number;
  posts:number;
  platforms:string[];
  ageMs:number;
  lastSeen:number;
  priority:number;
  reasons:string[];
  hotPosts:HotPost[];
  maxViewsPerHour:number;
  maxLikesPerHour:number;
  crossPostedCreators:number;
  semanticCrossPlatformCreators:number;
  coins:Coin[];
  possibleCoins:Coin[];
  topMarketCap:number|null;
  learnedAdjustment:number;
  learningReasons:LearningReason[];
};

type Feed = {
  rows:Row[];
  stats:{narratives:number;hot:number;verifiedCoins:number;lastSeen:number|null};
  learning:{examples:number;feedback:number;positive:number;negative:number;outcomes:number;activeFeatures:number;minExamplesPerFeature:number;maxAdjustment:number};
  feedback:Record<string,'useful'|'not-relevant'>;
  at:number;
  note:string;
};

type BridgeResult = {
  evidence:Record<string,unknown>[];
  inferredTopics?:Record<string,unknown>[];
  at:number;
  audit?:Record<string,unknown>;
};

type Pending = {
  evidence:Record<string,unknown>[];
  lastTopics?:Record<string,unknown>[];
  count:number;
};

type Detail = {
  narrative:{title:string;aliases:string[];earliestEvidenceAt:number|null;detectedAt:number|null};
  latest?:{
    momentum?:{label?:string;score?:number};
    origin?:{url?:string;confidence?:string;method?:string};
    feedPenetration?:number|null;
    feedPenetrationVelocity?:number|null;
    soundSignals?:{title?:string;creators?:number}[];
    visualSignals?:{creators?:number;platforms?:string[]}[];
    semanticMerge?:{reason?:string;score?:number};
  }|null;
  evidence:{
    id:string;
    platform:string;
    author:string;
    url:string;
    content:string;
    published:number|null;
    first_seen:number;
    views:number|null;
    likes:number|null;
    reposts?:number|null;
    quotes?:number|null;
    comments?:number|null;
    shares?:number|null;
    creator_followers?:number|null;
    sound_title?:string|null;
    relation_type?:string|null;
    quoted_url?:string|null;
    outbound_urls?:string[];
  }[];
  relationships:{
    related_key:string;
    related_title:string;
    relation:string;
    score:number;
    author_count:number;
    evidence_count:number;
    platforms:string[];
  }[];
  coins:{mint:string;data:Record<string,unknown>}[];
  launches:{mint:string;name:string;symbol:string|null;seen:number;match_type:string;data:Record<string,unknown>}[];
  edge:{status:string;leadMs:number|null};
  note:string;
};

const compact = (n:number|null|undefined) => n == null
  ? '—'
  : new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);

const usd = (n:number|null|undefined) => n == null
  ? '—'
  : new Intl.NumberFormat('en-US',{
      style:'currency',
      currency:'USD',
      notation:n >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits:n >= 1 ? 2 : 8,
    }).format(n);

const metric = (value:unknown) => {
  if(value===null||value===undefined||value==='') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const ago = (ts:number|null|undefined, now:number) => {
  if(!ts || !now) return '—';
  const minutes = Math.max(0,Math.round((now-ts)/60000));
  if(minutes < 60) return `${minutes}m`;
  const hours = minutes/60;
  if(hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${Math.round(hours/24)}d`;
};

const pump = (mint:string) => `https://pump.fun/coin/${encodeURIComponent(mint)}`;
const axiom = (mint:string) => `https://axiom.trade/t/${encodeURIComponent(mint)}`;

async function json<T>(url:string,init?:RequestInit){
  const response = await fetch(url,{cache:'no-store',...init});
  const data = await response.json() as T&{error?:string};
  if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}

async function post<T>(url:string,body:Record<string,unknown>){
  return json<T>(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

async function local<T>(path:string,init?:RequestInit,timeout=30000){
  const controller = new AbortController();
  const timer = window.setTimeout(()=>controller.abort(),timeout);
  try{
    return await json<T>(BRIDGE+path,{...init,signal:controller.signal});
  }finally{
    window.clearTimeout(timer);
  }
}

async function saveBrowser(result:{evidence:Record<string,unknown>[];inferredTopics?:Record<string,unknown>[]}){
  if(!result.evidence.length) return;
  await post('/api/browser-evidence',{evidence:result.evidence,inferredTopics:result.inferredTopics||[]});
  await post('/api/browser-rich',{evidence:result.evidence,inferredTopics:result.inferredTopics||[]}).catch(()=>null);
}

function CoinPill({coin}:{coin:Coin}){
  return <span className={styles.coinPill}>
    <span className={styles.match} data-type={coin.matchType}>{coin.matchType}</span>
    <b>{coin.symbol||coin.name||'coin'}</b>
    <span>MC {usd(coin.marketCap)}</span>
  </span>;
}

export default function FrontDesk(){
  const [feed,setFeed] = useState<Feed|null>(null);
  const [expanded,setExpanded] = useState<string|null>(null);
  const [details,setDetails] = useState<Record<string,Detail>>({});
  const [busy,setBusy] = useState(false);
  const [feedbackBusy,setFeedbackBusy] = useState<string|null>(null);
  const [status,setStatus] = useState('Connecting to scanner…');
  const [error,setError] = useState('');

  const load = useCallback(async()=>{
    try{
      setFeed(await json<Feed>('/api/front-feed'));
      setError('');
    }catch(e){
      setError((e as Error).message);
    }
  },[]);

  const syncPending = useCallback(async()=>{
    try{
      const pending = await local<Pending>('/pending');
      if(!pending.evidence?.length){
        setStatus('Scanner connected');
        return;
      }
      await saveBrowser({evidence:pending.evidence,inferredTopics:pending.lastTopics||[]});
      await local('/ack',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ids:pending.evidence.map((x)=>String(x.id||''))}),
      });
      await post('/api/front-feed',{action:'refreshCoins'});
      setStatus(`Synced ${pending.evidence.length} background posts`);
      await load();
    }catch{
      setStatus('Local scanner offline · open Settings to connect');
    }
  },[load]);

  useEffect(()=>{
    const initial = window.setTimeout(()=>{
      void load();
      void syncPending();
    },0);
    const interval = window.setInterval(()=>void syncPending(),45000);
    return()=>{
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  },[load,syncPending]);

  async function scan(){
    setBusy(true);
    setError('');
    setStatus('Deep scan: analyzing X + TikTok post by post…');
    try{
      const result = await local<BridgeResult>('/scan',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({mode:'deep'}),
      },10*60_000);
      setStatus(`Analyzed ${result.evidence.length} unique posts · saving narratives…`);
      await saveBrowser(result);
      await post('/api/front-feed',{action:'refreshCoins'});
      await load();
      setStatus('Scan complete · highest-velocity narratives ranked first');
    }catch(e){
      setError((e as Error).message);
      setStatus('Scan stopped');
    }finally{
      setBusy(false);
    }
  }

  async function rate(row:Row,label:'useful'|'not-relevant'){
    setFeedbackBusy(row.id);
    setError('');
    try{
      await post('/api/front-feed',{action:'feedback',narrativeId:row.id,label});
      setStatus(label==='useful'?'Saved · Front will learn which signal patterns are useful':'Saved · Front will learn which signal patterns are noise');
      await load();
    }catch(e){
      setError((e as Error).message);
    }finally{
      setFeedbackBusy(null);
    }
  }

  async function clearFresh(){
    if(!window.confirm('Clear active narrative results and start a brand-new scan? Your X/TikTok session, scanner settings, Pump.fun watches and private learning history stay intact.')) return;
    setBusy(true);
    setError('');
    try{
      setStatus('Archiving learning history and clearing active intelligence…');
      await post('/api/front-feed',{action:'clearAndStartFresh'});
      try{
        const pending = await local<Pending>('/pending');
        if(pending.evidence?.length){
          await local('/ack',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids:pending.evidence.map((x)=>String(x.id||''))}),
          });
        }
      }catch{}
      const resetAt = Date.now();
      setFeed(null);
      setExpanded(null);
      setDetails({});
      setBusy(false);
      setStatus(`Active intelligence cleared at ${new Date(resetAt).toLocaleTimeString()} · starting a fresh scan…`);
      await scan();
    }catch(e){
      setError((e as Error).message);
      setStatus('Reset failed');
      setBusy(false);
    }
  }

  async function toggle(row:Row){
    if(expanded===row.id){
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    if(details[row.id]) return;
    try{
      const detail = await json<Detail>(`/api/narrative-detail?id=${encodeURIComponent(row.id)}`);
      setDetails((old)=>({...old,[row.id]:detail}));
    }catch(e){
      setError((e as Error).message);
    }
  }

  const stats = feed?.stats;
  const renderAt = feed?.at||0;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>FRONT · NARRATIVE FIRST</div>
        <h1>What&apos;s moving before the coin?</h1>
        <p>Every post is scored for speed, repetition and cross-post spread. Only PumpPortal-verified Pump.fun coins appear.</p>
      </div>
      <div className={styles.actions}>
        <a className={styles.secondary} href='/settings'><Settings size={16}/>Settings</a>
        <button className={styles.danger} disabled={busy} onClick={()=>void clearFresh()}><Trash2 size={16}/>Clear & new scan</button>
        <button className={styles.primary} disabled={busy} onClick={()=>void scan()}>{busy?<RefreshCw className={styles.spin} size={16}/>:<Sparkles size={16}/>}Scan now</button>
      </div>
    </header>

    <div className={styles.statusbar}>
      <Activity size={14}/><span>{status}</span><span className={styles.dot}/>
      <span>Last evidence {stats?.lastSeen?`${ago(stats.lastSeen,renderAt)} ago`:'—'}</span>
      {feed?.learning&&<span>Private learning {feed.learning.examples} examples · {feed.learning.activeFeatures} active patterns</span>}
    </div>

    {error&&<div className={styles.error}>{error}</div>}

    <section className={styles.stats}>
      <div><span>Priority narratives</span><b>{stats?.narratives??0}</b></div>
      <div><span>Hot right now</span><b>{stats?.hot??0}</b></div>
      <div><span>Verified Pump.fun matches</span><b>{stats?.verifiedCoins??0}</b></div>
    </section>

    <section className={styles.feed}>
      <div className={styles.feedHead}>
        <div><h2>Priority feed</h2><p>Fast engagement + independent creators + same-event cross-platform spread + verified coin matches rise to the top. Your feedback can only tune ranking; it cannot weaken the quality gate.</p></div>
        <span>{feed?.rows.length??0} qualified</span>
      </div>

      {(feed?.rows||[]).map((row,index)=>{
        const open = expanded===row.id;
        const detail = details[row.id];
        const explosiveViews = row.hotPosts.some((post)=>post.viewsPerHour>=100000||(post.views!=null&&post.views>=100000&&(post.ageHours??99)<=6));
        return <article className={styles.card} key={row.id} data-hot={row.hotPosts.some((p)=>p.hot)||undefined}>
          <button className={styles.cardButton} onClick={()=>void toggle(row)}>
            <span className={styles.rank}>{index+1}</span>
            <div className={styles.cardMain}>
              <div className={styles.badges}>
                <span className={styles.stage}>{row.stage}</span>
                {row.hotPosts.some((p)=>p.hot)&&<span className={styles.hot}><Flame size={12}/>{explosiveViews?'100K+ fast':'breakout engagement'}</span>}
                {row.platforms.map((platform)=><span key={platform}>{platform}</span>)}
                <span>{ago(renderAt-row.ageMs,renderAt)} old</span>
              </div>
              <h3>{row.title}</h3>
              <div className={styles.metrics}>
                <span><b>{row.creators}</b> creators</span>
                <span><b>{row.posts}</b> posts</span>
                {row.maxViewsPerHour>0?<span><b>{compact(row.maxViewsPerHour)}</b> max views/hr</span>:row.maxLikesPerHour>0?<span><b>{compact(row.maxLikesPerHour)}</b> max likes/hr</span>:<span>velocity metrics pending</span>}
                {row.crossPostedCreators>0&&<span><b>{row.crossPostedCreators}</b> cross-post creators</span>}
              </div>
              <div className={styles.reasons}>
                {row.reasons.slice(0,5).map((reason)=><span key={reason}>{reason}</span>)}
                {row.learnedAdjustment!==0&&<span>learned {row.learnedAdjustment>0?'+':''}{row.learnedAdjustment.toFixed(1)} rank</span>}
              </div>
              {row.coins.length>0&&<div className={styles.coinRow}>{row.coins.slice(0,3).map((coin)=><CoinPill coin={coin} key={coin.mint}/>)}</div>}
            </div>
            <div className={styles.right}>
              <span className={styles.priority}><TrendingUp size={14}/>{Math.round(row.priority)}</span>
              {row.topMarketCap!=null&&<span>top MC <b>{usd(row.topMarketCap)}</b></span>}
              {open?<ChevronUp size={18}/>:<ChevronDown size={18}/>}
            </div>
          </button>
          {open&&<div className={styles.expanded}>{!detail?<div className={styles.loading}>Loading full intelligence…</div>:<Expanded detail={detail} row={row} now={renderAt} feedbackLabel={feed?.feedback?.[row.id]} feedbackBusy={feedbackBusy===row.id} onFeedback={(label)=>void rate(row,label)}/>}</div>}
        </article>;
      })}

      {feed&&!feed.rows.length&&<div className={styles.empty}>
        <Sparkles size={24}/><h3>Clean slate.</h3>
        <p>No specific event has cleared the quality + acceleration gate yet. Run a scan and Front will keep generic words out of the priority feed.</p>
      </div>}
    </section>
  </main>;
}

function Expanded({detail,row,now,feedbackLabel,feedbackBusy,onFeedback}:{detail:Detail;row:Row;now:number;feedbackLabel?:'useful'|'not-relevant';feedbackBusy:boolean;onFeedback:(label:'useful'|'not-relevant')=>void}){
  const launchByMint = new Map(detail.launches.map((launch)=>[launch.mint,launch]));
  const verified = detail.coins.filter((coin)=>launchByMint.has(coin.mint)&&coin.data.verifiedPumpfun===true);
  const coin = (mint:string) => verified.find((entry)=>entry.mint===mint)?.data||{};
  const exactStrong = detail.launches.filter((launch)=>launch.match_type==='exact'||launch.match_type==='strong');
  const possible = detail.launches.filter((launch)=>launch.match_type==='possible');

  return <>
    <div className={styles.summary}>
      <div><span>Detected</span><b>{ago(detail.narrative.detectedAt,now)} ago</b></div>
      <div><span>Earliest verified find</span><b>{ago(detail.narrative.earliestEvidenceAt,now)} ago</b></div>
      <div><span>Momentum</span><b>{detail.latest?.momentum?.label||row.stage}</b></div>
      <div><span>Timing edge</span><b>{detail.edge.status==='before-launch'?'Before matching launch':detail.edge.status==='waiting'?'No match yet':detail.edge.status.replace('-',' ')}</b></div>
    </div>

    <section className={styles.section}>
      <h4>Teach Front</h4>
      <p className={styles.hint}>Rate the result, not the prediction. Feedback is private and only tunes ranking after at least five comparable examples; narrative-quality and corroboration gates never self-relax.</p>
      <div className={styles.actions}>
        <button className={styles.secondary} disabled={feedbackBusy} onClick={()=>onFeedback('useful')}>{feedbackLabel==='useful'?'✓ Useful':'Useful'}</button>
        <button className={styles.secondary} disabled={feedbackBusy} onClick={()=>onFeedback('not-relevant')}>{feedbackLabel==='not-relevant'?'✓ Not relevant':'Not relevant'}</button>
      </div>
      {row.learningReasons.length>0&&<p className={styles.hint}>Learned rank {row.learnedAdjustment>0?'+':''}{row.learnedAdjustment.toFixed(1)} from {row.learningReasons.map((reason)=>`${reason.label} (${reason.examples})`).join(' · ')}.</p>}
    </section>

    {row.hotPosts.length>0&&<section className={styles.section}>
      <h4><Flame size={14}/> Fast posts</h4>
      <p className={styles.hint}>Front evaluates each supporting post by age and engagement instead of treating scrolling as detection.</p>
      <div className={styles.postGrid}>{row.hotPosts.map((post)=><a href={post.url} target='_blank' rel='noreferrer' key={post.url}>
        <b>{post.platform} · @{post.author}</b>
        <span>{[
          post.views!=null?`${compact(post.views)} views`:null,
          post.viewsPerHour>0?`${compact(post.viewsPerHour)} views/hr`:null,
          post.likes!=null?`${compact(post.likes)} likes`:null,
          post.likesPerHour>0?`${compact(post.likesPerHour)} likes/hr`:null,
          post.ageHours!=null?`${post.ageHours.toFixed(1)}h old`:null,
        ].filter(Boolean).join(' · ')}</span>
        <p>{post.content}</p>
      </a>)}</div>
    </section>}

    <section className={styles.section}>
      <h4>Verified Pump.fun coins</h4>
      <p className={styles.hint}>A coin appears here only after Front observed its PumpPortal <code>subscribeNewToken</code> create event. DEX data is used only for market stats.</p>
      {exactStrong.length?<div className={styles.coinGrid}>{exactStrong.map((launch)=>{
        const data = coin(launch.mint);
        return <div className={styles.coinCard} key={launch.mint}>
          <div>
            <span className={styles.match} data-type={launch.match_type}>{launch.match_type}</span>
            <h5>{launch.name}{launch.symbol?` · ${launch.symbol}`:''}</h5>
            <p>Market cap <b>{usd(metric(data.marketCap))}</b> · liq {usd(metric(data.liquidity))} · 24h vol {usd(metric(data.volume24h))}</p>
            <small>{String(data.matchReason||launch.match_type)}</small>
          </div>
          <div>
            <a href={pump(launch.mint)} target='_blank' rel='noreferrer'>Pump.fun <ExternalLink size={11}/></a>
            <a href={axiom(launch.mint)} target='_blank' rel='noreferrer'>Axiom <ExternalLink size={11}/></a>
          </div>
        </div>;
      })}</div>:<div className={styles.subtle}>No Exact or Strong Pump.fun match yet.</div>}
      {possible.length>0&&<details className={styles.possible}>
        <summary>Possible matches ({possible.length})</summary>
        {possible.map((launch)=><div key={launch.mint}><span>{launch.name}{launch.symbol?` · ${launch.symbol}`:''}</span><a href={pump(launch.mint)} target='_blank' rel='noreferrer'>Inspect</a></div>)}
      </details>}
    </section>

    <section className={styles.section}>
      <h4>Why Front thinks this is a narrative</h4>
      <div className={styles.intelGrid}>
        <div><span>Aliases</span><b>{detail.narrative.aliases.slice(0,6).join(' · ')||'—'}</b></div>
        <div><span>For You share</span><b>{detail.latest?.feedPenetration!=null?`${detail.latest.feedPenetration.toFixed(2)}%`:'—'}</b></div>
        <div><span>Feed velocity</span><b>{detail.latest?.feedPenetrationVelocity!=null?`${detail.latest.feedPenetrationVelocity>=0?'+':''}${detail.latest.feedPenetrationVelocity.toFixed(2)} pts/hr`:'—'}</b></div>
        <div><span>Origin confidence</span><b>{detail.latest?.origin?.confidence||'—'}</b></div>
      </div>
      {detail.latest?.origin?.method&&<p className={styles.hint}>{detail.latest.origin.method}</p>}
    </section>

    <section className={styles.section}>
      <h4>Source evidence</h4>
      <div className={styles.evidence}>{detail.evidence.slice(0,20).map((item)=>{
        const published = item.published||item.first_seen;
        const hours = published&&now ? Math.max(1/60,(now-published)/3600000) : null;
        const viewsPerHour = item.views!=null&&hours ? item.views/hours : null;
        const likesPerHour = item.likes!=null&&hours ? item.likes/hours : null;
        return <a href={item.url} target='_blank' rel='noreferrer' key={item.id}>
          <div><b>{item.platform} · @{item.author}</b><span>{[
            `${ago(published,now)} ago`,
            item.views!=null?`${compact(item.views)} views`:null,
            viewsPerHour!=null?`${compact(viewsPerHour)} views/hr`:null,
            item.likes!=null?`${compact(item.likes)} likes`:null,
            item.views==null&&likesPerHour!=null?`${compact(likesPerHour)} likes/hr`:null,
          ].filter(Boolean).join(' · ')}</span></div>
          <p>{item.content}</p>
          <small>{[
            item.creator_followers!=null?`${compact(item.creator_followers)} followers`:null,
            item.reposts!=null?`${compact(item.reposts)} reposts`:null,
            item.shares!=null?`${compact(item.shares)} shares`:null,
            item.sound_title?`sound: ${item.sound_title}`:null,
            item.relation_type,
          ].filter(Boolean).join(' · ')}</small>
        </a>;
      })}</div>
    </section>

    {detail.relationships.length>0&&<section className={styles.section}>
      <h4>Related context</h4>
      <div className={styles.context}>{detail.relationships.slice(0,8).map((context)=><span key={context.related_key}><b>{context.related_title}</b> · {context.author_count} creators · {context.platforms.join(' + ')}</span>)}</div>
    </section>}
  </>;
}
