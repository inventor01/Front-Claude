import { runOne } from './engine.js';
import { processOneManagerMessage } from './manager.js';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
console.log('employee worker started');

for(;;){
  try{
    let processed=0;
    for(let i=0;i<5;i++){
      const r=await runOne();
      if(!r.processed)break;
      processed++;
    }
    for(let i=0;i<5;i++){
      const m=await processOneManagerMessage();
      if(!m.processed)break;
      processed++;
    }
    if(!processed)await sleep(3000);
  }catch(e){
    console.error('worker loop error',e);
    await sleep(5000);
  }
}
