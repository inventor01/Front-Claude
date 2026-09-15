import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {ContentUnderstandingEngine} from '../src/content-understanding.mjs';
const started=Date.now();
const browser=await chromium.connectOverCDP('http://127.0.0.1:43982',{noDefaults:true,timeout:10000});
const engine=new ContentUnderstandingEngine({dataDir:path.join(os.homedir(),'.front-browser-bridge')});
const rows=JSON.parse(fs.readFileSync(new URL('../../docs/qa/v26-model-failure-live.json',import.meta.url),'utf8')).evidence;
const row=rows.find(r=>r.url==='https://www.tiktok.com/@mobbinjamo/video/7676682463824874783');
const capture=engine.capture.bind(engine);
engine.capture=async(...args)=>{const at=Date.now();const result=await capture(...args);if(result.modelFrames?.[0]?.base64)fs.writeFileSync(new URL('../../docs/qa/v26-timeline-contact-sheet.jpg',import.meta.url),Buffer.from(result.modelFrames[0].base64,'base64'));console.log(JSON.stringify({phase:'captured',elapsed:Date.now()-at,frameCount:result.frames.length,type:result.captureType}));return result;};
const result=await engine.analyzeOne(browser.contexts()[0],row,{maxFrames:16,timeoutMs:45000});
const report={at:new Date().toISOString(),url:row.url,elapsed:Date.now()-started,result};
fs.writeFileSync(new URL('../../docs/qa/v26-content-diagnostic.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
// Disconnect only this process. capturePostFrames closes its own temporary page.
process.exit(result.analysis?0:1);
