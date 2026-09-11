'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ExternalLink, RefreshCw, ShieldCheck, X } from 'lucide-react';

const BRIDGE = 'http://127.0.0.1:43981';

type BridgeConfig = {
  enabled: boolean;
  intervalMinutes: number;
  scanXExplore: boolean;
  scanTikTokTrends: boolean;
  maxTrendQueries: number;
  resultsPerQuery: number;
  xAccounts: string[];
  keywords: string[];
};

type Evidence = {
  id: string;
  platform: 'X' | 'TikTok';
  author: string;
  url: string;
  content: string;
  published: number | null;
  views: number | null;
  likes: number | null;
  provenance: string;
};

type ScanResult = { evidence: Evidence[]; errors: string[]; at: number; config: BridgeConfig };

type Narrative = {
  id: string;
  title: string;
  stage: string;
  authors: number;
  firstSeen: number;
  lastSeen: number;
  platforms: string[];
};

const DEFAULT_CONFIG: BridgeConfig = {
  enabled: true,
  intervalMinutes: 15,
  scanXExplore: true,
  scanTikTokTrends: true,
  maxTrendQueries: 3,
  resultsPerQuery: 6,
  xAccounts: [],
  keywords: [],
};

async function local<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(BRIDGE + path, { ...init, signal: controller.signal });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || 'Local browser bridge request failed.');
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

async function saveEvidence(evidence: Evidence[]) {
  const response = await fetch('/api/browser-evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence }),
  });
  const data = await response.json() as { accepted?: number; rejected?: number; error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not save browser evidence.');
  return data;
}

async function fetchNarratives(): Promise<Narrative[]> {
  const response = await fetch('/api/desk?action=narratives', { cache: 'no-store' });
  const data = await response.json() as { cards?: Narrative[]; error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not refresh narratives.');
  return data.cards || [];
}

function lines(value: string) {
  return [...new Set(value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];
}

export default function BrowserIntelligence() {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<BridgeConfig>(DEFAULT_CONFIG);
  const [accounts, setAccounts] = useState('');
  const [keywords, setKeywords] = useState('');
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [narratives, setNarratives] = useState<Narrative[]>([]);

  const evidenceByPlatform = useMemo(() => {
    const x = lastScan?.evidence.filter((item) => item.platform === 'X').length || 0;
    const tiktok = lastScan?.evidence.filter((item) => item.platform === 'TikTok').length || 0;
    return { x, tiktok };
  }, [lastScan]);

  async function ping(silent = false) {
    try {
      const status = await local<{ config: BridgeConfig }>('/health');
      setConnected(true);
      setConfig(status.config || DEFAULT_CONFIG);
      setAccounts((status.config?.xAccounts || []).join('\n'));
      setKeywords((status.config?.keywords || []).join('\n'));
      if (!silent) setMessage('Local browser intelligence is connected. X API is optional.');
      return true;
    } catch {
      setConnected(false);
      if (!silent) setError('Local browser bridge is not running yet. Start browser-bridge/start.command on this Mac, then reconnect.');
      return false;
    }
  }

  useEffect(() => {
    if (!open) return;
    void ping(true);
  }, [open]);

  async function saveConfig() {
    setBusy('config'); setError(''); setMessage('');
    try {
      const next = { ...config, xAccounts: lines(accounts), keywords: lines(keywords) };
      const result = await local<{ config: BridgeConfig }>('/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
      setConfig(result.config);
      setMessage('Browser-source settings saved locally on this Mac.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function openLogin() {
    setBusy('login'); setError(''); setMessage('');
    try {
      const result = await local<{ message: string }>('/open-login', { method: 'POST' });
      setConnected(true);
      setMessage(result.message);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function scan() {
    setBusy('scan'); setError(''); setMessage('');
    try {
      const result = await local<ScanResult>('/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, xAccounts: lines(accounts), keywords: lines(keywords) }),
      });
      setLastScan(result);
      const stored = await saveEvidence(result.evidence);
      const cards = await fetchNarratives();
      setNarratives(cards.slice(0, 8));
      setConnected(true);
      const warning = result.errors.length ? ` ${result.errors.length} source warning(s); details shown below.` : '';
      setMessage(`Saved ${stored.accepted || 0} browser evidence records. X ${result.evidence.filter((x) => x.platform === 'X').length} · TikTok ${result.evidence.filter((x) => x.platform === 'TikTok').length}.${warning}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  return <>
    <button onClick={() => setOpen((v) => !v)} aria-label="Open browser intelligence" style={{position:'fixed',left:20,bottom:20,zIndex:70,border:0,borderRadius:999,padding:'12px 16px',fontWeight:800,background:'#fff',color:'#111',boxShadow:'0 10px 30px #0005',cursor:'pointer'}}>
      <Activity size={16} style={{display:'inline',verticalAlign:'-3px',marginRight:7}}/>Browser Sources
    </button>
    {open && <aside style={{position:'fixed',left:20,bottom:76,zIndex:69,width:'min(500px,calc(100vw - 28px))',maxHeight:'82vh',overflow:'auto',background:'#101216',color:'#f5f5f5',border:'1px solid #ffffff22',borderRadius:18,padding:18,boxShadow:'0 24px 60px #0009'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}>
        <div><strong>Almost-free social intelligence</strong><div style={{fontSize:12,opacity:.7}}>{connected ? '● Local bridge connected · X API optional' : '○ Local bridge offline'}</div></div>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{background:'none',border:0,color:'inherit'}}><X/></button>
      </div>
      <p style={{fontSize:13,opacity:.75}}>Uses a browser on this Mac for X Latest/Explore and TikTok search/Creative Center. Your login session stays local; Front stores only the evidence it extracts.</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={() => void ping()} disabled={!!busy}>Reconnect</button>
        <button onClick={() => void openLogin()} disabled={!!busy}>{busy === 'login' ? 'Opening…' : 'Open X + TikTok login'}</button>
        <button onClick={() => void scan()} disabled={!!busy || !connected}>{busy === 'scan' ? 'Scanning…' : 'Run browser scan'}</button>
      </div>
      <hr style={{borderColor:'#ffffff18'}}/>
      <label style={{fontSize:12,fontWeight:700}}>High-signal X accounts</label>
      <textarea value={accounts} onChange={(e) => setAccounts(e.target.value)} rows={5} placeholder={'unusual_whales\nWatcherGuru\nother_account'} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:10,borderRadius:9,border:'1px solid #ffffff22',background:'#171a20',color:'inherit'}}/>
      <label style={{fontSize:12,fontWeight:700,display:'block',marginTop:10}}>Narratives / keywords to hunt</label>
      <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={4} placeholder={'Dejon Love\nviral meme phrase\ncelebrity moment'} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:10,borderRadius:9,border:'1px solid #ffffff22',background:'#171a20',color:'inherit'}}/>
      <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
        <label style={{fontSize:12}}>Results/query <input type="number" min={2} max={20} value={config.resultsPerQuery} onChange={(e) => setConfig({...config,resultsPerQuery:Number(e.target.value)})} style={{width:55}}/></label>
        <label style={{fontSize:12}}>TikTok trend searches <input type="number" min={0} max={10} value={config.maxTrendQueries} onChange={(e) => setConfig({...config,maxTrendQueries:Number(e.target.value)})} style={{width:55}}/></label>
        <button onClick={() => void saveConfig()} disabled={!!busy}>{busy === 'config' ? 'Saving…' : 'Save local settings'}</button>
      </div>
      <small style={{display:'block',opacity:.65,marginTop:8}}>The collector does not bypass CAPTCHAs, login challenges, or platform blocks. If either site asks you to verify, complete it in the local browser and rerun.</small>
      {message && <div style={{marginTop:12,padding:10,borderRadius:9,background:'#d5ff481a',fontSize:13}}>{message}</div>}
      {error && <div style={{marginTop:12,padding:10,borderRadius:9,background:'#ff52521a',fontSize:13}}>{error}</div>}
      {lastScan && <>
        <hr style={{borderColor:'#ffffff18'}}/>
        <strong>Latest scan · X {evidenceByPlatform.x} · TikTok {evidenceByPlatform.tiktok}</strong>
        {lastScan.errors.map((value) => <div key={value} style={{fontSize:12,opacity:.72,marginTop:4}}>⚠ {value}</div>)}
        {lastScan.evidence.slice(0, 8).map((item) => <div key={item.id} style={{marginTop:9,padding:9,border:'1px solid #ffffff18',borderRadius:9}}>
          <div style={{fontSize:11,opacity:.65}}>{item.platform} · {item.author}{item.published ? ` · ${new Date(item.published).toLocaleString()}` : ''}</div>
          <div style={{fontSize:13,marginTop:3}}>{item.content.slice(0,220)}</div>
          <a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:12}}>Open evidence <ExternalLink size={11} style={{display:'inline'}}/></a>
        </div>)}
      </>}
      {narratives.length > 0 && <>
        <hr style={{borderColor:'#ffffff18'}}/>
        <strong>Detected narrative groups</strong>
        {narratives.map((item) => <div key={item.id} style={{marginTop:7,fontSize:13}}><b>{item.title}</b> · {item.stage} · {item.authors} account(s) · {item.platforms.join(' + ')}</div>)}
      </>}
      <div style={{marginTop:12,padding:10,borderRadius:9,background:'#ffffff0d',fontSize:12,display:'flex',gap:7}}><ShieldCheck size={15}/> X/TikTok cookies stay in ~/.front-browser-bridge/profile and are never uploaded to Front.</div>
    </aside>}
  </>;
}
