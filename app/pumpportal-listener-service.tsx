'use client';

import {useEffect} from 'react';
import {ensurePumpPortalRuntime,subscribePumpPortalMessages,type PumpPortalWireEvent} from './pumpportal-client-runtime.mjs';

const WATCH_KEY='front.launchWatches.v1';
export const HIT_KEY='front.launchHits.v1';
export const HIT_EVENT='front-pumpportal-hit';

type Watch={id:string;name:string;created:number};
export type PumpPortalHit={mint:string;name:string;symbol?:string;seen:number};

function normalize(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function readArray<T>(key:string):T[]{
  try{
    const value=JSON.parse(localStorage.getItem(key)||'[]');
    return Array.isArray(value)?value:[];
  }catch{return[];}
}

export default function PumpPortalListenerService(){
  useEffect(()=>{
    ensurePumpPortalRuntime();
    return subscribePumpPortalMessages((data:PumpPortalWireEvent)=>{
      if(data.txType!=='create'||!data.mint||!data.name)return;
      const watches=readArray<Watch>(WATCH_KEY).filter((watch)=>watch&&typeof watch.name==='string');
      if(!watches.some((watch)=>normalize(watch.name)===normalize(data.name||'')))return;

      const hit:PumpPortalHit={mint:data.mint,name:data.name,symbol:data.symbol,seen:Date.now()};
      const current=readArray<PumpPortalHit>(HIT_KEY);
      const next=[hit,...current.filter((item)=>item.mint!==hit.mint)].slice(0,20);
      localStorage.setItem(HIT_KEY,JSON.stringify(next));
      window.dispatchEvent(new CustomEvent<PumpPortalHit>(HIT_EVENT,{detail:hit}));

      if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
        new Notification('Front creation alert',{body:`${hit.name}${hit.symbol?` · ${hit.symbol}`:''} created on Pump.fun`});
      }
    });
  },[]);

  return null;
}
