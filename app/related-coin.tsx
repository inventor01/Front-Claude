'use client';
import { useEffect, useState } from 'react';
import { coinLinks,coinNumber as num,type CoinMetrics } from '@/lib/coin-intelligence';
const money=(n:unknown)=>num(n)===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(num(n)!);
const date=(n:unknown)=>num(n)===null?'Unknown':new Date(num(n)!).toLocaleString();
export default function RelatedCoin({mint,data}:{mint:string;data:CoinMetrics}){
 const [now,setNow]=useState<number|null>(null);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const [copy,setCopy]=useState('Copy CA');const links=coinLinks(mint);const pct=num(data.marketCapChangePctSinceMatch),lead=num(data.narrativeLeadMs);
 return <article style={{border:'1px solid #ffffff25',borderRadius:12,padding:16,minWidth:0,display:'grid',gap:10}}>
  <strong>{String(data.name||'Related coin')} {data.symbol?`· $${data.symbol}`:''}</strong>
  <span>COIN-CREATED · {String(data.opportunityStatus||'CONFIRMING')} · {String(data.momentumStatus||'UNKNOWN')}</span>
  <b>{money(data.marketCapAtMatch)} → {money(data.currentMarketCap)} {pct===null?'':`(${pct>=0?'+':''}${pct.toFixed(1)}%)`} since Front match</b>
  <small>{num(data.matchConfidence)??'—'}% match confidence · {String(data.matchReason||'Reason unavailable')}</small>
  <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,margin:0}}>{[
   ['First observed MC',money(data.marketCapAtFirstSeen)],['MC at match',money(data.marketCapAtMatch)],['Current MC',money(data.currentMarketCap)],['Peak MC since tracking',money(data.peakMarketCap)],['Gain after Front match',money(data.marketCapChangeSinceMatch)],['Price',money(data.price)],['Liquidity',money(data.liquidity)],
   ...['5m','1h','6h','24h'].flatMap(w=>[[`${w} volume`,money(data[`volume${w}`])],[`${w} price change`,num(data[`priceChange${w}`])===null?'—':`${num(data[`priceChange${w}`])}%`]]),
   ['5m buys / sells',`${num(data.buys5m)??'—'} / ${num(data.sells5m)??'—'}`],['1h buys / sells',`${num(data.buys1h)??'—'} / ${num(data.sells1h)??'—'}`],['Narrative first detected',date(data.narrativeDetectedAt)],['Coin created',date(data.createdAt)],['Creation event observed',date(data.creationObservedAt)],['Front matched coin',date(data.matchedAt)],['Market updated',date(data.marketRefreshedAt)],['Coin age',num(data.createdAt)===null||now===null?'Unknown':`${Math.max(0,(now-num(data.createdAt)!)/60000).toFixed(1)}m`],['Pair created',date(data.pairCreatedAt)],['Holder count',String(num(data.holderCount)??'—')],['Bonding curve progress',num(data.bondingCurveProgress)===null?'—':`${num(data.bondingCurveProgress)}%`],['Traction score',String(num(data.tractionScore)??'—')]
  ].map(([label,value])=><div key={label}><dt style={{opacity:.65,fontSize:12}}>{label}</dt><dd style={{margin:0}}>{value}</dd></div>)}</dl>
  <small>{lead===null?'Launch lead time unavailable: exact coin creation time has not been verified.':lead>=0?`Front detected narrative ${(lead/60000).toFixed(1)}m before coin launch`:`Coin launched ${(-lead/60000).toFixed(1)}m before Front detected narrative`}</small>
  <code style={{overflowWrap:'anywhere'}}>{mint}</code>
  <div style={{display:'flex',gap:12,flexWrap:'wrap',color:'#b6d4ff'}}><a href={links.pumpUrl} target='_blank' rel='noreferrer' style={{color:'inherit'}}>Pump.fun</a><a href={links.axiomUrl} target='_blank' rel='noreferrer' style={{color:'inherit'}}>Axiom</a><a href={links.dexScreenerUrl} target='_blank' rel='noreferrer' style={{color:'inherit'}}>DexScreener</a><button type='button' onClick={async()=>{try{await navigator.clipboard.writeText(mint);setCopy('Copied');}catch{setCopy('Copy unavailable');}}}>{copy}</button></div>
 </article>;
}
