'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Activity,ArrowLeft,Bell,CheckCircle2,LogIn,Play,Plus,Radio,RefreshCw,Save,Trash2,TriangleAlert} from 'lucide-react';
import styles from './settings-client.module.css';

const BRIDGE='http://127.0.0.1:43981';
const LOCAL_TIMEOUT_MS=30_000;
const DEEP_TIMEOUT_MS=10*60_000;
const WATCH_KEY='front.launchWatches.v1';

type BridgeConfig={
  enabled:boolean;
  intervalMinutes:number;
  scanXExplore:boolean;
  scanXHome:boolean;
  scanTikTokTrends:boolean;
  scanTikTokExplore:boolean;
  scrollPasses:number;
  maxFeedItems:number;
  inferredTopicSearches:number;
  maxTrendQueries:number;
  resultsPerQuery:number;
  xAccounts:string[];
  keywords:string[];
  scanXForYou?:boolean;
  scanTikTokForYou?:boolean;
  targetUniqueFeedItems?:number;
  maxFeedScanSeconds?:number;
  maxAdaptiveScrolls?:number;
  stalePassLimit?:number;
  searchScrollPasses?:number;
  deepResultsPerQuery?:number;
  sentinelAccountsPerScout?:number;
  sentinelAccountsPerDeep?:number;
};

type Evidence={id:string;platform:'X'|'TikTok';author:string;url:string;content:string;published:number|null;views:number|null;likes:number|null;provenance:string};
type InferredTopic={topic:string;key:string;evidenceCount:number;authorCount:number;platforms:string[];evidenceIds:string[]};
type BridgeHealth={config:BridgeConfig;version:number;scanner?:string;capabilities?:string[];running:boolean;pendingCount?:number;nextScheduledRun?:number|null;scanConnection?:string;lastError?:string|null};
type ScanResult={evidence:Evidence[];errors:string[];inferredTopics?:InferredTopic[];at:number;config:BridgeConfig};
type StoredResult={accepted?:number;inferredNarratives?:number;error?:string};
type Watch={id:string;name:string;created:number};
type Hit={mint:string;name:string;symbol?:string;seen:number};

const DEFAULT_CONFIG:BridgeConfig={
  enabled:true,
  intervalMinutes:10,
  scanXExplore:true,
  scanXHome:true,
  scanTikTokTrends:true,
  scanTikTokExplore:true,
  scrollPasses:4,
  maxFeedItems:40,
  inferredTopicSearches:4,
  maxTrendQueries:3,
  resultsPerQuery:6,
  xAccounts:[],
  keywords:[],
  scanXForYou:true,
  scanTikTokForYou:true,
  targetUniqueFeedItems:90,
  maxFeedScanSeconds:70,
  maxAdaptiveScrolls:14,
  stalePassLimit:2,
  searchScrollPasses:3,
  deepResultsPerQuery:14,
  sentinelAccountsPerScout:6,
  sentinelAccountsPerDeep:10,
};

function lines(value:string){return[...new Set(value.split(/[\n,]+/).map((item)=>item.trim()).filter(Boolean))];}
function normalize(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}

async function local<T>(path:string,init?:RequestInit,timeoutMs=LOCAL_TIMEOUT_MS):Promise<T>{
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(BRIDGE+path,{...init,signal:controller.signal});
    const data=await response.json() as T&{error?:string};
    if(!response.ok)throw new Error(data.error||'Local browser bridge request failed.');
    return data;
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')throw new Error(path==='/scan'?'The deep scan exceeded the panel timeout. The bridge may still be finishing.':'The local browser bridge timed out.');
    throw error;
  }finally{window.clearTimeout(timer);}
}

async function saveEvidence(evidence:Evidence[],inferredTopics:InferredTopic[]=[]){
  const response=await fetch('/api/browser-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence,inferredTopics})});
  const data=await response.json() as StoredResult;
  if(!response.ok)throw new Error(data.error||'Could not save browser evidence.');
  try{await fetch('/api/browser-rich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence,inferredTopics})});}catch{}
  return data;
}

export default function SettingsClient(){
  const [connected,setConnected]=useState(false);
  const [health,setHealth]=useState<BridgeHealth|null>(null);
  const [config,setConfig]=useState<BridgeConfig>(DEFAULT_CONFIG);
  const [accounts,setAccounts]=useState('');
  const [keywords,setKeywords]=useState('');
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [watches,setWatches]=useState<Watch[]>([]);
  const [watchName,setWatchName]=useState('');
  const [listening,setListening]=useState(false);
  const [listenStatus,setListenStatus]=useState('Off');
  const [hits,setHits]=useState<Hit[]>([]);
  const watchesRef=useRef<Watch[]>([]);
  const hydrated=useRef(false);

  const nextRun=health?.nextScheduledRun?new Date(health.nextScheduledRun).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'—';

  async function ping(silent=false){
    try{
      const status=await local<BridgeHealth>('/health');
      setConnected(true);
      setHealth(status);
      setConfig({...DEFAULT_CONFIG,...status.config});
      setAccounts((status.config?.xAccounts||[]).join('\n'));
      setKeywords((status.config?.keywords||[]).join('\n'));
      setError('');
      if(!silent)setMessage(`Connected to browser bridge v${status.version}${status.scanner?` · ${status.scanner}`:''}.`);
      return true;
    }catch{
      setConnected(false);
      setHealth(null);
      if(!silent)setError('Local browser bridge is offline. Start browser-bridge/start.command on this Mac, then reconnect.');
      return false;
    }
  }

  async function saveConfig(){
    setBusy('save');setMessage('');setError('');
    try{
      const next={...config,xAccounts:lines(accounts).slice(0,30),keywords:lines(keywords)};
      const result=await local<{config:BridgeConfig}>('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
      setConfig({...DEFAULT_CONFIG,...result.config});
      setAccounts((result.config.xAccounts||[]).join('\n'));
      setKeywords((result.config.keywords||[]).join('\n'));
      setMessage(`Scanner settings saved. Background Scout runs every ${result.config.intervalMinutes} minutes while the bridge is running.`);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  async function openLogin(){
    setBusy('login');setMessage('');setError('');
    try{
      const result=await local<{message:string}>('/open-login',{method:'POST'},45_000);
      setConnected(true);setMessage(result.message);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  async function syncPending(){
    setBusy('sync');setMessage('');setError('');
    try{
      const pending=await local<{evidence:Evidence[];count:number;lastTopics?:InferredTopic[]}>('/pending');
      if(!pending.evidence.length){setMessage('No unsynced background finds.');return;}
      const stored=await saveEvidence(pending.evidence,pending.lastTopics||[]);
      await local('/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:pending.evidence.map((row)=>row.id)})});
      setMessage(`Synced ${stored.accepted||0} evidence record(s) and ${stored.inferredNarratives||0} inferred narrative(s).`);
      window.dispatchEvent(new CustomEvent('front-browser-evidence-saved'));
      await ping(true);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  async function runDeepScan(){
    setBusy('scan');setMessage('Running deep X + TikTok investigation…');setError('');
    try{
      const result=await local<ScanResult>('/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,mode:'deep',xAccounts:lines(accounts).slice(0,30),keywords:lines(keywords)})},DEEP_TIMEOUT_MS);
      const stored=await saveEvidence(result.evidence,result.inferredTopics||[]);
      const warnings=result.errors.length?` ${result.errors.length} source warning(s).`:'';
      setMessage(`Deep scan finished: ${result.evidence.length} evidence record(s), ${result.inferredTopics?.length||0} candidate topic(s), ${stored.accepted||0} saved.${warnings}`);
      window.dispatchEvent(new CustomEvent('front-browser-evidence-saved'));
      await ping(true);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  function addWatch(){
    const name=watchName.replace(/\s+/g,' ').trim();
    if(normalize(name).length<2){setError('Enter a token name with at least 2 characters.');return;}
    if(watches.some((watch)=>normalize(watch.name)===normalize(name))){setError('That exact-name watch already exists.');return;}
    setError('');
    setWatches((current)=>[{id:crypto.randomUUID(),name,created:Date.now()},...current].slice(0,100));
    setWatchName('');
    setMessage(`Watching exact normalized token name: ${name}.`);
  }

  async function requestAlerts(){
    if(typeof Notification==='undefined'){setError('Browser notifications are not available here.');return;}
    const permission=await Notification.requestPermission();
    setMessage(permission==='granted'?'Browser creation alerts enabled.':'Browser alerts were not enabled.');
  }

  useEffect(()=>{
    const kickoff=window.setTimeout(()=>{void ping(true);try{const raw=JSON.parse(localStorage.getItem(WATCH_KEY)||'[]');if(Array.isArray(raw))setWatches(raw.filter((item)=>item&&typeof item.name==='string'));}catch{}hydrated.current=true;},0);
    const interval=window.setInterval(()=>{void ping(true);},30_000);
    return()=>{window.clearTimeout(kickoff);window.clearInterval(interval);};
  },[]);

  useEffect(()=>{watchesRef.current=watches;if(hydrated.current)localStorage.setItem(WATCH_KEY,JSON.stringify(watches));},[watches]);

  useEffect(()=>{
    if(!listening)return;
    let socket:WebSocket|undefined;
    let retry:ReturnType<typeof setTimeout>;
    let stopped=false;
    let attempt=0;
    const connect=()=>{
      setListenStatus('Connecting');
      socket=new WebSocket('wss://pumpportal.fun/api/data');
      socket.onopen=()=>{attempt=0;setListenStatus('Connected · creations only');socket?.send(JSON.stringify({method:'subscribeNewToken'}));};
      socket.onmessage=(event)=>{try{
        const data=JSON.parse(event.data) as {txType?:string;mint?:string;name?:string;symbol?:string};
        if(data.txType!=='create'||!data.mint||!data.name)return;
        const match=watchesRef.current.find((watch)=>normalize(watch.name)===normalize(data.name||''));
        if(!match)return;
        const hit:Hit={mint:data.mint,name:data.name,symbol:data.symbol,seen:Date.now()};
        setHits((current)=>[hit,...current.filter((item)=>item.mint!==hit.mint)].slice(0,20));
        setMessage(`MATCH: ${hit.name} was created on Pump.fun.`);
        if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('Front creation alert',{body:`${hit.name}${hit.symbol?` · ${hit.symbol}`:''} created on Pump.fun`});
      }catch{}};
      socket.onerror=()=>setListenStatus('Connection error');
      socket.onclose=()=>{if(!stopped){setListenStatus('Reconnecting');retry=setTimeout(connect,Math.min(30_000,1000*2**attempt++));}};
    };
    connect();
    return()=>{stopped=true;clearTimeout(retry);socket?.close();};
  },[listening]);

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>FRONT · SETTINGS</div>
        <h1>Scanner control center</h1>
        <p>Configure the local X/TikTok intelligence bridge and Pump.fun creation alerts without opening floating tool panels.</p>
      </div>
      <Link className={styles.back} href="/"><ArrowLeft size={15}/> Back to Front</Link>
    </header>

    {error&&<div className={styles.error}><TriangleAlert size={16}/><span>{error}</span></div>}
    {message&&<div className={styles.message}><CheckCircle2 size={16}/><span>{message}</span></div>}

    <section className={styles.statusGrid}>
      <div className={styles.statusCard}><span>Browser bridge</span><b data-ok={connected}>{connected?'Connected':'Offline'}</b><small>{connected?`v${health?.version||'—'}${health?.scanner?` · ${health.scanner}`:''}`:'Start the local bridge on this Mac'}</small></div>
      <div className={styles.statusCard}><span>Scanner</span><b>{health?.running?'Running':config.enabled?'Scheduled':'Paused'}</b><small>{health?.pendingCount||0} pending · next {nextRun}</small></div>
      <div className={styles.statusCard}><span>Pump.fun alerts</span><b>{listening?'Listening':'Off'}</b><small>{watches.length} exact-name watch{watches.length===1?'':'es'}</small></div>
    </section>

    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.span2}`}>
        <div className={styles.cardHead}><div><Activity size={18}/><div><h2>Browser scanner</h2><p>X + TikTok discovery and investigation settings</p></div></div><span className={connected?styles.good:styles.muted}>{connected?'● connected':'○ offline'}</span></div>
        <div className={styles.actions}>
          <button onClick={()=>void ping()} disabled={!!busy}><RefreshCw size={14}/> Reconnect</button>
          <button onClick={()=>void openLogin()} disabled={!!busy}><LogIn size={14}/> {busy==='login'?'Opening…':'Open X + TikTok login'}</button>
          <button className={styles.primary} onClick={()=>void runDeepScan()} disabled={!!busy||!connected}><Play size={14}/> {busy==='scan'?'Investigating…':'Run deep scan'}</button>
          <button onClick={()=>void syncPending()} disabled={!!busy||!connected}><RefreshCw size={14}/> {busy==='sync'?'Syncing…':'Sync finds'}</button>
        </div>

        <div className={styles.rule}/>
        <div className={styles.toggleGrid}>
          <label className={styles.toggle}><input type="checkbox" checked={config.enabled} onChange={(e)=>setConfig({...config,enabled:e.target.checked})}/><span><b>Background Scout</b><small>Run scheduled discovery while the local bridge is open.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={config.scanXForYou??true} onChange={(e)=>setConfig({...config,scanXForYou:e.target.checked})}/><span><b>X For You</b><small>Primary X discovery surface.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={config.scanTikTokForYou??true} onChange={(e)=>setConfig({...config,scanTikTokForYou:e.target.checked})}/><span><b>TikTok For You</b><small>Primary TikTok discovery surface.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={config.scanXExplore} onChange={(e)=>setConfig({...config,scanXExplore:e.target.checked})}/><span><b>X Explore seeds</b><small>Use trend pages only to seed investigations.</small></span></label>
        </div>

        <div className={styles.fields}>
          <label><span>Scout interval</span><div className={styles.number}><input type="number" min={10} max={240} value={config.intervalMinutes} onChange={(e)=>setConfig({...config,intervalMinutes:Number(e.target.value)})}/><small>minutes</small></div></label>
          <label><span>Unique feed target</span><div className={styles.number}><input type="number" min={30} max={180} value={config.targetUniqueFeedItems??90} onChange={(e)=>setConfig({...config,targetUniqueFeedItems:Number(e.target.value)})}/><small>items</small></div></label>
          <label><span>Feed time cap</span><div className={styles.number}><input type="number" min={20} max={120} value={config.maxFeedScanSeconds??70} onChange={(e)=>setConfig({...config,maxFeedScanSeconds:Number(e.target.value)})}/><small>seconds</small></div></label>
          <label><span>Adaptive scrolls</span><div className={styles.number}><input type="number" min={3} max={25} value={config.maxAdaptiveScrolls??14} onChange={(e)=>setConfig({...config,maxAdaptiveScrolls:Number(e.target.value)})}/><small>max</small></div></label>
          <label><span>Search scrolls</span><div className={styles.number}><input type="number" min={1} max={6} value={config.searchScrollPasses??3} onChange={(e)=>setConfig({...config,searchScrollPasses:Number(e.target.value)})}/><small>passes</small></div></label>
          <label><span>Deep results/query</span><div className={styles.number}><input type="number" min={8} max={24} value={config.deepResultsPerQuery??14} onChange={(e)=>setConfig({...config,deepResultsPerQuery:Number(e.target.value)})}/><small>results</small></div></label>
          <label><span>Topics to expand</span><div className={styles.number}><input type="number" min={1} max={10} value={config.inferredTopicSearches} onChange={(e)=>setConfig({...config,inferredTopicSearches:Number(e.target.value)})}/><small>topics</small></div></label>
          <label><span>Deep sentinels</span><div className={styles.number}><input type="number" min={0} max={30} value={config.sentinelAccountsPerDeep??10} onChange={(e)=>setConfig({...config,sentinelAccountsPerDeep:Number(e.target.value)})}/><small>accounts</small></div></label>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}><div><div><h2>Sentinel accounts</h2><p>Optional early-culture sources · max 30</p></div></div></div>
        <textarea value={accounts} onChange={(e)=>setAccounts(e.target.value)} rows={9} placeholder={'early_meme_account\nviral_clip_account\ninternet_culture_account'}/>
        <small className={styles.help}>Front rotates a subset and learns which accounts contribute useful early evidence. They do not define discovery.</small>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}><div><div><h2>Narratives to hunt</h2><p>Optional phrases for targeted investigation</p></div></div></div>
        <textarea value={keywords} onChange={(e)=>setKeywords(e.target.value)} rows={9} placeholder={'Daejon Love\nviral meme phrase\ncelebrity moment'}/>
        <small className={styles.help}>These are search probes, not automatic narratives. Front still requires independent creator support before promotion.</small>
      </section>

      <section className={`${styles.card} ${styles.span2}`}>
        <div className={styles.saveRow}><div><h2>Save scanner settings</h2><p>Changes are written to the local bridge and persist across scans.</p></div><button className={styles.primary} onClick={()=>void saveConfig()} disabled={!!busy||!connected}><Save size={14}/> {busy==='save'?'Saving…':'Save changes'}</button></div>
      </section>

      <section className={`${styles.card} ${styles.span2}`}>
        <div className={styles.cardHead}><div><Radio size={18}/><div><h2>Pump.fun creation alerts</h2><p>Exact-name local watches using PumpPortal new-token creation events only</p></div></div><span className={listening?styles.good:styles.muted}>{listenStatus}</span></div>
        <div className={styles.watchRow}><input value={watchName} onChange={(e)=>setWatchName(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')addWatch();}} placeholder="Exact token name"/><button onClick={addWatch}><Plus size={14}/> Add watch</button><button className={listening?styles.danger:styles.primary} onClick={()=>setListening((value)=>!value)}><Radio size={14}/> {listening?'Stop listening':'Start listening'}</button><button onClick={()=>void requestAlerts()}><Bell size={14}/> Browser alerts</button></div>
        <div className={styles.chips}>{watches.length?watches.map((watch)=><span key={watch.id}>{watch.name}<button aria-label={`Remove ${watch.name}`} onClick={()=>setWatches((current)=>current.filter((item)=>item.id!==watch.id))}><Trash2 size={12}/></button></span>):<small>No exact-name watches yet.</small>}</div>
        {hits.length>0&&<div className={styles.hits}>{hits.map((hit)=><div key={hit.mint}><div><b>{hit.name}{hit.symbol?` · ${hit.symbol}`:''}</b><small>{new Date(hit.seen).toLocaleTimeString()}</small></div><a href={`https://pump.fun/coin/${encodeURIComponent(hit.mint)}`} target="_blank" rel="noreferrer">Open Pump.fun</a></div>)}</div>}
      </section>
    </div>
  </main>;
}
