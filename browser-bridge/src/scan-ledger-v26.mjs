import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScanSignals, countScanSignals } from './scan-signals-v26.mjs';
import { attachUnderstandingFrame, assessNarrativeClaims } from './understanding-frame-v26.mjs';
import { emptyNarrativeMemory, memoryScanSignals, normalizeNarrativeMemory, updateNarrativeMemory } from './narrative-memory-v26.mjs';

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const memoryPath=()=>path.join(process.env.FRONT_BRIDGE_DATA||path.join(os.homedir(),'.front-browser-bridge'),'narrative-memory-v26.json');
const readMemory=()=>{try{return normalizeNarrativeMemory(JSON.parse(fs.readFileSync(memoryPath(),'utf8')));}catch{return emptyNarrativeMemory();}};
const writeMemory=(value)=>{try{const target=memoryPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2));return true;}catch{return false;}};

function mergeSignals(current=[],memory=[]){
  const merged=new Map();
  for(const signal of current){const key=String(signal.key||signal.topic||'');if(key)merged.set(key,signal);}
  for(const signal of memory){
    const key=String(signal.key||signal.topic||'');if(!key)continue;
    const prior=merged.get(key);
    if(prior){
      merged.set(key,{...prior,memory:signal.memory||prior.memory,signalScore:Math.max(Number(prior.signalScore||0),Number(signal.signalScore||0)),memoryStatus:signal.scanStatus});
    }else{
      merged.set(key,{...signal,corroborated:false,tier:'pre-breakout',scanStatus:signal.scanStatus==='QUALIFIED'?'RISING':signal.scanStatus});
    }
  }
  const rank={QUALIFIED:4,RISING:3,EARLY:2,WATCH:1};
  return [...merged.values()].sort((a,b)=>(rank[b.scanStatus||'WATCH']-rank[a.scanStatus||'WATCH'])||Number(b.signalScore||0)-Number(a.signalScore||0)).slice(0,24);
}

function attachClaimAssessment(signals,evidence){
  const byId=new Map(evidence.map((row)=>[row.id,row]));
  return signals.map((signal)=>{
    const rows=(signal.evidenceIds||[]).map((id)=>byId.get(id)).filter(Boolean);
    return rows.length?{...signal,claimAssessment:assessNarrativeClaims(rows)}:signal;
  });
}

export function buildScanLedgerEntry({id, finalStatus, startedAt, completedAt=Date.now(), request, latestLive, connected, contentStatus, postStatus}) {
  const framedEvidence=(latestLive.evidence||[]).map(attachUnderstandingFrame);
  const currentSignals=buildScanSignals(framedEvidence,latestLive.inferredTopics||[],24);
  const priorMemory=readMemory();
  const updatedMemory=updateNarrativeMemory(priorMemory,framedEvidence,latestLive.inferredTopics||[],{now:completedAt,scanId:id});
  const memoryPersisted=writeMemory(updatedMemory);
  const memorySignals=memoryScanSignals(updatedMemory,{now:completedAt,currentEvidenceIds:framedEvidence.map((row)=>row.id)});
  const scanSignals=attachClaimAssessment(mergeSignals(currentSignals,memorySignals),framedEvidence);
  const scanSignalCounts=countScanSignals(scanSignals);
  return {
      id, status: finalStatus, startedAt, completedAt: completedAt, durationMs: completedAt - startedAt, request,
      schemaVersion: 26, phase: latestLive.phase, phaseHistory: latestLive.phaseHistory || [], scanConnection: connected ? 'attached' : 'disconnected',
      usableEvidence: framedEvidence.length, inferredTopics: latestLive.candidateTopics,
      uniqueCreators: new Set(framedEvidence.map(row => String(row.author || '').replace(/^@/,'').toLowerCase()).filter(Boolean)).size,
      sourceCounts: framedEvidence.reduce((counts, row) => { const key = row.provenance || 'unknown'; counts[key] = (counts[key] || 0) + 1; return counts; }, {}),
      contentUnderstanding: contentStatus, postUnderstanding: postStatus,
      vision: { enabled: contentStatus.enabled, provider: contentStatus.provider, model: contentStatus.model, visuallyUnderstood: framedEvidence.filter(row => row.contentSummary).length, scan: latestLive.stages.visualUnderstanding },
      transcriptEvidence: framedEvidence.filter(row=>clean(row.transcript,40)).length,
      understandingFrames: framedEvidence.filter(row=>row.understandingFrame?.subject||row.understandingFrame?.event).length,
      narrativeMemory: { persisted: memoryPersisted, retained: Object.keys(updatedMemory.narratives||{}).length, updatedAt: updatedMemory.updatedAt },
      scanSignals, scanSignalCounts,
      observed: latestLive.observed, candidateTopics: latestLive.candidateTopics, platformCounts: latestLive.platformCounts,
      stages: latestLive.stages, errors: latestLive.errors, sourcePages: latestLive.sourcePages,
      samples: framedEvidence.slice(0, 30).map((row) => ({ platform: row.platform, author: row.author, url: row.url, mediaType: row.mediaType, contentConfidence: row.contentConfidence, views: row.views, likes: row.likes, subject: row.postSubject || null, event: row.postEvent || row.contentEvent || null, transcript: clean(row.transcript, 300) || null, transcriptSource: row.transcriptSource || null, understanding: row.understandingFrame || null, content: clean(row.contentSummary || row.content, 260), provenance: row.provenance })),
    };
}
