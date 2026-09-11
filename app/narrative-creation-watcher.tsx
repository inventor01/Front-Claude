'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Radio } from 'lucide-react';
import { axiomUrl, isPumpPortalCreation, normalizeLaunchName, pumpFunUrl } from '@/lib/live';

type NarrativeCard = { id:string; title:string; aliases:string[]; lastSeen:number };
type Match = { mint:string; name:string; symbol?:string; narrative:string; seen:number };
const KEY='front.narrativeCreationMatches.v1';

export default function NarrativeCreationWatcher(){
 const [cards,setCards]=useState<NarrativeCard[]>([]),[matches,setMatches]=useState<Match[]>([]),[status,setStatus]=useState('Connecting');
 const cardsRef=useRef<NarrativeCard[]>([]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(saved))setMatches(saved.slice(0,20));}catch{}},[]);
 useEffect(()=>{cardsRef.current=cards;},[cards]);
 useEffect(()=>{let stopped=false;async function load(){try{const r=await fetch('/api/desk?action=narratives',{cache:'no-store'});if(!r.ok)return;const d=await r.json() as {cards?:NarrativeCard[]};if(!stopped)setCards((d.cards||[]).slice(0,50));}catch{}}void load();const timer=window.setInterval(load,60000);const refresh=()=>void load();window.addEventListener('front-browser-evidence-saved',refresh);return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('front-browser-evidence-saved',refresh);};},[]);
 useEffect(()=>{let socket:WebSocket|undefined,retry:ReturnType<typeof setTimeout>,stopped=false,attempt=0;const connect=()=>{setStatus('Connecting');socket=new WebSocket('wss://pumpportal.fun/api/data');socket.onopen=()=>{attempt=0;setStatus('Listening');socket?.send(JSON.stringify({method:'subscribeNewToken'}));};socket.onmessage=(event)=>{try{const data=JSON.parse(event.data);if(!isPumpPortalCreation(data)||typeof data.name!=='string')return;const target=normalizeLaunchName(data.name);if(!target)return;const narrative=cardsRef.current.find((card)=>[card.title,...(card.aliases||[])].some((term)=>normalizeLaunchName(term)===target));if(!narrative)return;const hit:Match={mint:data.mint,name:data.name,symbol:typeof data.symbol==='string'?data.symbol:undefined,narrative:narrative.title,seen:Date.now()};setMatches((old)=>{const next=[hit,...old.filter((x)=>x.mint!==hit.mint)].slice(0,20);localStorage.setItem(KEY,JSON.stringify(next));return next;});if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('Front narrative launch match',{body:`${hit.name} was just created and exactly matches “${narrative.title}”.`});}catch{}};socket.onerror=()=>setStatus('Connection error');socket.onclose=()=>{if(!stopped){setStatus('Reconnecting');retry=setTimeout(connect,Math.min(30000,1000*2**attempt++));}};};connect();return()=>{stopped=true;clearTimeout(retry);socket?.close();};},[]);
 const recent=useMemo(()=>matches.filter((hit)=>Date.now()-hit.seen<24*3600000),[matches]);
 if(!recent.length)return null;
 return <aside style={{position:'fixed',right:20,bottom:78,zIndex:68,width:'min(380px,calc(100vw - 28px))',background:'#101216',color:'#f5f5f5',border:'1px solid #d5ff4855',borderRadius:14,padding:12,boxShadow:'0 18px 50px #0008'}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><strong><Radio size={13} style={{display:'inline',verticalAlign:'-2px'}}/> Narrative launch match</strong><span style={{opacity:.65}}>{status}</span></div>{recent.slice(0,3).map((hit)=><div key={hit.mint} style={{marginTop:9,paddingTop:9,borderTop:'1px solid #ffffff18'}}><strong>{hit.name}{hit.symbol?` · ${hit.symbol}`:''}</strong><div style={{fontSize:12,opacity:.7}}>Exact normalized name match · {hit.narrative}</div><div style={{fontSize:12,marginTop:4}}><a href={pumpFunUrl(hit.mint)} target="_blank" rel="noreferrer">Pump.fun <ExternalLink size={11} style={{display:'inline'}}/></a>{' · '}<a href={axiomUrl(hit.mint)} target="_blank" rel="noreferrer">Axiom <ExternalLink size={11} style={{display:'inline'}}/></a></div></div>)}</aside>;
}
