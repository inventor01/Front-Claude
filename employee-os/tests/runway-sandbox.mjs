import http from 'node:http';
import assert from 'node:assert/strict';

const PORT=4350;
process.env.PROVIDER_TEST_MODE='1';
process.env.RUNWAY_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;

let creates=0,lookups=0;
function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
  res.end(body);
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  const chunks=[];for await(const c of req)chunks.push(c);
  if(req.method==='GET'&&url.pathname==='/v1/tasks/00000000-0000-0000-0000-000000000000'){
    return json(res,404,{error:'not found'});
  }
  if(req.method==='POST'&&url.pathname==='/v1/image_to_video'){
    creates++; return json(res,200,{id:'runway-task-qa-1'});
  }
  if(req.method==='GET'&&url.pathname==='/v1/tasks/runway-task-qa-1'){
    lookups++; return json(res,200,{status:'SUCCEEDED',output:['https://cdn.example.test/runway-qa.mp4']});
  }
  return json(res,404,{error:'unhandled'});
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const {pool}=await import('../dist/db.js');
const {connectRunway,renderOriginalProductClips}=await import('../dist/runway-executor.js');

try{
  const company=(await pool.query("INSERT INTO companies(name) VALUES('Runway QA') RETURNING id")).rows[0].id;
  const connection=await connectRunway({companyId:company,apiSecret:'runway-qa-secret-123456',model:'gen4.5'});
  assert.equal(connection.connected,true);

  const input={
    companyId:company,jobId:null,workOrderId:null,employeeSlug:'maya',idempotencyKey:'runway-qa-render',
    promptImage:'https://cdn.example.test/product.jpg',
    specs:[{id:'clip-1',promptText:'Original QA product clip'}],clipCount:1,duration:5
  };
  const first=await renderOriginalProductClips(input);
  assert.equal(first.length,1);
  assert.equal(first[0].taskId,'runway-task-qa-1');
  assert.equal(first[0].temporaryUrl,'https://cdn.example.test/runway-qa.mp4');
  assert.equal(creates,1);

  const second=await renderOriginalProductClips(input);
  assert.deepEqual(second,first);
  assert.equal(creates,1,'retry must not create a second Runway task');

  const actions=await pool.query("SELECT status,attempt_count,provider_external_id FROM external_actions WHERE company_id=$1",[company]);
  assert.equal(actions.rowCount,1);
  assert.equal(actions.rows[0].status,'SUCCEEDED');
  assert.equal(Number(actions.rows[0].attempt_count),1);
  assert.equal(actions.rows[0].provider_external_id,'runway-task-qa-1');

  console.log('RUNWAY SANDBOX QA PASSED');
  console.log(JSON.stringify({creates,lookups,taskId:first[0].taskId,deduped:true},null,2));
}finally{
  await pool.end();
  await new Promise(r=>server.close(r));
}
