'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyAlias } from '@/lib/coin-matching';
import { coinLinks } from '@/lib/coin-intelligence';
import { ExternalLink, Radio } from 'lucide-react';
import { isPumpPortalCreation, normalizeLaunchName } from '@/lib/live';
import { ensurePumpPortalRuntime, setPumpPortalRuntimeEnabled, subscribePumpPortalMessages, subscribePumpPortalRuntime, type PumpPortalWireEvent } from './pumpportal-client-runtime.mjs';

type NarrativeCard = { id:string; title:string; aliases:string[]; lastSeen:number };
type Match = { mint:string; name:string; symbol?:string; narrative:string; seen:number; matchConfidence:number; matchReason:string; marketCapSol?:number };
type Watch = { id:string; name:string; created:number };
type LifecycleHit = { mint:string; name:string; symbol?:string; seen:number; event:'create'|'migrate'; poolId?:string; pool?:string };

const MATCH_KEY='front.narrativeCreationMatches.v1';
const WATCH_KEY='front.launchWatches.v1';
const HIT_KEY='front.launchHits.v2';
const CONTROL_EVENT='front-pumpportal-control';
const STATE_EVENT='front-pumpportal-state';
const WATCH_EVENT='front-pumpportal-watches-changed';

function normalize(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function readArray<T>(key:string):T[]{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return[];}}
function notify(title:string,body:string){if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(title,{body});}

export default function NarrativeCreationWatcher(){
 const [cards,setCards]=useState<NarrativeCard[]>([]);
 const [matches,setMatches]=useState<Match[]>([]);
 const [hits,setHits]=useState<LifecycleHit[]>([]);
 const [status,setStatus]=useState('Starting');
 const cardsRef=useRef<NarrativeCard[]>([]);
 const matchesRef=useRef<Match[]>([]);
 const hitsRef=useRef<LifecycleHit[]>([]);
 const watchesRef=useRef<Watch[]>([]);
 const enabledRef=useRef(true);
 const statusRef=useRef('Starting');

 const publish=useCallback((nextStatus=statusRef.current,nextHits=hitsRef.current,nextEnabled=enabledRef.current)=>{
  window.dispatchEvent(new CustomEvent(STATE_EVENT,{detail:{enabled:nextEnabled,status:nextStatus,hits:nextHits}}));
 },[]);
 const storeHits=useCallback((updater:(current:LifecycleHit[])=>LifecycleHit[])=>{
  setHits((current)=>{
   const next=updater(current).slice(0,30);
   hitsRef.current=next;
   localStorage.setItem(HIT_KEY,JSON.stringify(next));
   publish(statusRef.current,next,enabledRef.current);
   return next;
  });
 },[publish]);
 const addLifecycleHit=useCallback((hit:LifecycleHit)=>{
  storeHits((current)=>[hit,...current.filter((item)=>!(item.mint===hit.mint&&item.event===hit.event))]);
 },[storeHits]);

 useEffect(()=>{
  const savedMatches=readArray<Match>(MATCH_KEY).slice(0,20);
  const savedHits=readArray<LifecycleHit>(HIT_KEY).slice(0,30);
  const savedWatches=readArray<Watch>(WATCH_KEY).filter((item)=>item&&typeof item.name==='string').slice(0,100);
  matchesRef.current=savedMatches;hitsRef.current=savedHits;watchesRef.current=savedWatches;
  const hydrate=window.setTimeout(()=>{
   setMatches((current)=>current.length?current:savedMatches);
   setHits((current)=>current.length?current:savedHits);
  },0);

  const unsubscribeRuntime=subscribePumpPortalRuntime((runtime)=>{
   enabledRef.current=runtime.enabled;statusRef.current=runtime.status;
   setStatus(runtime.status);
   publish(runtime.status,hitsRef.current,runtime.enabled);
  });
  const control=(event:Event)=>{
   const detail=(event as CustomEvent<{enabled?:boolean}>).detail;
   if(typeof detail?.enabled!=='boolean')return;
   setPumpPortalRuntimeEnabled(detail.enabled);
  };
  const refreshWatches=()=>{watchesRef.current=readArray<Watch>(WATCH_KEY).filter((item)=>item&&typeof item.name==='string').slice(0,100);};
  window.addEventListener(CONTROL_EVENT,control as EventListener);
  window.addEventListener(WATCH_EVENT,refreshWatches);
  ensurePumpPortalRuntime();
  return()=>{
   window.clearTimeout(hydrate);
   unsubscribeRuntime();
   window.removeEventListener(CONTROL_EVENT,control as EventListener);
   window.removeEventListener(WATCH_EVENT,refreshWatches);
  };
 },[publish]);

 useEffect(()=>{cardsRef.current=cards;},[cards]);
 useEffect(()=>{matchesRef.current=matches;},[matches]);
 useEffect(()=>{hitsRef.current=hits;},[hits]);

 useEffect(()=>{
  let stopped=false;
  async function load(){try{const r=await fetch('/api/desk?action=narratives',{cache:'no-store'});if(!r.ok)return;const d=await r.json() as {cards?:NarrativeCard[]};if(!stopped)setCards((d.cards||[]).slice(0,50));}catch{}}
  const kickoff=window.setTimeout(()=>void load(),0);
  const timer=window.setInterval(load,60000);
  const refresh=()=>void load();
  window.addEventListener('front-browser-evidence-saved',refresh);
  return()=>{stopped=true;window.clearTimeout(kickoff);window.clearInterval(timer);window.removeEventListener('front-browser-evidence-saved',refresh);};
 },[]);

 useEffect(()=>subscribePumpPortalMessages((data:PumpPortalWireEvent)=>{
  if(typeof data.mint!=='string')return;
  if(isPumpPortalCreation(data)&&typeof data.name==='string'){
   const exact=watchesRef.current.find((watch)=>normalize(watch.name)===normalize(data.name||''));
   if(exact){
    const hit:LifecycleHit={mint:data.mint,name:data.name,symbol:typeof data.symbol==='string'?data.symbol:undefined,seen:Date.now(),event:'create'};
    addLifecycleHit(hit);
    notify('Front launch alert',`${hit.name}${hit.symbol?` · ${hit.symbol}`:''} was created on Pump.fun.`);
   }
   const target=normalizeLaunchName(data.name);
   if(!target)return;
   let best:{narrative:NarrativeCard;score:number;reason:string}|null=null;
   for(const narrative of cardsRef.current){for(const term of [narrative.title,...(narrative.aliases||[])]){const candidate=classifyAlias(String(data.name),typeof data.symbol==='string'?data.symbol:null,term,narrative.title);if(!candidate||!['exact','strong'].includes(candidate.type))continue;if(!best||candidate.score>best.score)best={narrative,score:candidate.score,reason:candidate.reason};}}
   if(!best)return;
   const marketCapSol=Number.isFinite(Number(data.marketCapSol))?Number(data.marketCapSol):undefined;
   const match:Match={mint:data.mint,name:data.name,symbol:typeof data.symbol==='string'?data.symbol:undefined,narrative:best.narrative.title,seen:Date.now(),matchConfidence:Math.round(best.score*100),matchReason:best.reason,marketCapSol};
   setMatches((old)=>{const next=[match,...old.filter((x)=>x.mint!==match.mint)].slice(0,20);matchesRef.current=next;localStorage.setItem(MATCH_KEY,JSON.stringify(next));return next;});
   if(!exact)addLifecycleHit({mint:match.mint,name:match.name,symbol:match.symbol,seen:match.seen,event:'create'});
   notify('NEW MATCHING COIN',`${match.name} matched “${best.narrative.title}” at ${match.matchConfidence}% confidence.`);
   return;
  }
  if(data.txType==='migrate'){
   const priorMatch=matchesRef.current.find((item)=>item.mint===data.mint);
   const priorHit=hitsRef.current.find((item)=>item.mint===data.mint&&item.event==='create');
   if(!priorMatch&&!priorHit)return;
   const name=priorMatch?.name||priorHit?.name||data.name||`${data.mint.slice(0,6)}…${data.mint.slice(-4)}`;
   const symbol=priorMatch?.symbol||priorHit?.symbol||(typeof data.symbol==='string'?data.symbol:undefined);
   const hit:LifecycleHit={mint:data.mint,name,symbol,seen:Date.now(),event:'migrate',poolId:typeof data.poolId==='string'?data.poolId:undefined,pool:typeof data.pool==='string'?data.pool:undefined};
   addLifecycleHit(hit);
   notify('Front graduation alert',`${name}${symbol?` · ${symbol}`:''} migrated${hit.pool?` to ${hit.pool}`:''}.`);
  }
 }),[addLifecycleHit]);

 const visibleHits=hits.slice(0,3);
 const visibleMatches=matches.filter((match)=>!visibleHits.some((hit)=>hit.mint===match.mint&&hit.event==='create')).slice(0,Math.max(0,3-visibleHits.length));
 if(!visibleHits.length&&!visibleMatches.length)return null;
 return <aside style={{position:'fixed',right:20,bottom:78,zIndex:68,width:'min(400px,calc(100vw - 28px))',background:'#101216',color:'#f5f5f5',border:'1px solid #d5ff4855',borderRadius:14,padding:12,boxShadow:'0 18px 50px #0008'}}>
  <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><strong><Radio size={13} style={{display:'inline',verticalAlign:'-2px'}}/> COIN LIFECYCLE</strong><span style={{opacity:.65}}>{status}</span></div>
  {visibleHits.map((hit)=>{const links=coinLinks(hit.mint);return <div key={`${hit.event}:${hit.mint}`} style={{marginTop:9,paddingTop:9,borderTop:'1px solid #ffffff18',display:'grid',gap:4}}><strong>{hit.event==='migrate'?'GRADUATED':'NEW'} · {hit.name}{hit.symbol?` · $${hit.symbol}`:''}</strong><div style={{fontSize:11,opacity:.65}}>{hit.event==='migrate'?`Migration observed${hit.pool?` · ${hit.pool}`:''}`:'Pump.fun creation observed'} · {new Date(hit.seen).toLocaleTimeString()}</div><div style={{fontSize:12,marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}><a href={links.pumpUrl} target="_blank" rel="noreferrer">Pump.fun <ExternalLink size={11} style={{display:'inline'}}/></a><a href={links.axiomUrl} target="_blank" rel="noreferrer">Axiom <ExternalLink size={11} style={{display:'inline'}}/></a><a href={links.dexScreenerUrl} target="_blank" rel="noreferrer">DexScreener <ExternalLink size={11} style={{display:'inline'}}/></a><button type="button" onClick={()=>void navigator.clipboard?.writeText(hit.mint)} style={{fontSize:12}}>Copy CA</button></div></div>;})}
  {visibleMatches.map((hit)=>{const links=coinLinks(hit.mint);return <div key={`match:${hit.mint}`} style={{marginTop:9,paddingTop:9,borderTop:'1px solid #ffffff18',display:'grid',gap:4}}><strong>{hit.name}{hit.symbol?` · $${hit.symbol}`:''}</strong><div style={{fontSize:12,opacity:.78}}>{hit.matchConfidence}% match · {hit.narrative}</div><div style={{fontSize:11,opacity:.62}}>{hit.matchReason}</div>{hit.marketCapSol!==undefined&&<div style={{fontSize:12}}>Creation event MC: {hit.marketCapSol.toLocaleString(undefined,{maximumFractionDigits:2})} SOL</div>}<div style={{fontSize:11,opacity:.6}}>Observed {new Date(hit.seen).toLocaleTimeString()} · {hit.mint.slice(0,7)}…{hit.mint.slice(-5)}</div><div style={{fontSize:12,marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}><a href={links.pumpUrl} target="_blank" rel="noreferrer">Pump.fun <ExternalLink size={11} style={{display:'inline'}}/></a><a href={links.axiomUrl} target="_blank" rel="noreferrer">Axiom <ExternalLink size={11} style={{display:'inline'}}/></a><a href={links.dexScreenerUrl} target="_blank" rel="noreferrer">DexScreener <ExternalLink size={11} style={{display:'inline'}}/></a><button type="button" onClick={()=>void navigator.clipboard?.writeText(hit.mint)} style={{fontSize:12}}>Copy CA</button></div></div>;})}
 </aside>;
}