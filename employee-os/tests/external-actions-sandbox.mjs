import http from 'node:http';
import assert from 'node:assert/strict';

const PORT=4340;
process.env.AYRSHARE_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;
process.env.RESEND_TEST_BASE_URL=`http://127.0.0.1:${PORT}`;

const seen={socialPosts:0,emails:0};
let lastPost=null,lastEmail=null;

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
  res.end(body);
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString('utf8');
  let body={};try{body=raw?JSON.parse(raw):{};}catch{}

  if(req.method==='GET'&&url.pathname==='/api/user'){
    assert.match(String(req.headers.authorization||''),/^Bearer /);
    return json(res,200,{title:'QA Social Profile',activeSocialAccounts:['instagram','tiktok']});
  }
  if(req.method==='POST'&&url.pathname==='/api/post'){
    assert.match(String(req.headers.authorization||''),/^Bearer /);
    seen.socialPosts++;lastPost=body;
    return json(res,200,{
      status:'success',
      id:'ayrshare-post-qa',
      postIds:[
        {status:'success',platform:'instagram',id:'ig-qa',postUrl:'https://instagram.test/p/qa'},
        {status:'success',platform:'tiktok',id:'tt-qa',postUrl:'https://tiktok.test/@qa/video/1'}
      ]
    });
  }
  if(req.method==='GET'&&url.pathname==='/domains'){
    assert.match(String(req.headers.authorization||''),/^Bearer /);
    return json(res,200,{data:[{id:'domain-qa',name:'example.test',status:'verified'}]});
  }
  if(req.method==='POST'&&url.pathname==='/emails'){
    assert.match(String(req.headers.authorization||''),/^Bearer /);
    seen.emails++;lastEmail=body;
    return json(res,200,{id:'email-message-qa'});
  }
  return json(res,404,{error:'not found'});
});

await new Promise(resolve=>server.listen(PORT,'127.0.0.1',resolve));

const {pool}=await import('../dist/db.js');
const {
  connectAyrshare,connectResend,publishSocial,sendSupportEmail,socialStatus,emailStatus
}=await import('../dist/external-connections.js');

try{
  const company=(await pool.query("INSERT INTO companies(name) VALUES('External Actions QA') RETURNING id")).rows[0].id;

  const social=await connectAyrshare({companyId:company,apiKey:'qa-social-key'});
  assert.equal(social.connected,true);
  const support=await connectResend({companyId:company,apiKey:'qa-email-key',fromEmail:'support@example.test'});
  assert.equal(support.connected,true);

  assert.equal((await socialStatus(company)).connected,true);
  assert.equal((await emailStatus(company)).connected,true);

  const posted=await publishSocial({
    companyId:company,
    post:'Launch QA post',
    platforms:['instagram','tiktok'],
    mediaUrls:['https://cdn.example.test/video.mp4']
  });
  assert.equal(posted.status,'success');
  assert.equal(seen.socialPosts,1);
  assert.deepEqual(lastPost.platforms,['instagram','tiktok']);
  assert.deepEqual(lastPost.mediaUrls,['https://cdn.example.test/video.mp4']);

  const sent=await sendSupportEmail({
    companyId:company,
    to:'customer@example.test',
    subject:'Your support answer',
    text:'This is the approved response.'
  });
  assert.equal(sent.id,'email-message-qa');
  assert.equal(seen.emails,1);
  assert.deepEqual(lastEmail.to,['customer@example.test']);
  assert.equal(lastEmail.from,'support@example.test');

  const creds=await pool.query("SELECT provider,ciphertext FROM integration_credentials WHERE company_id=$1 ORDER BY provider",[company]);
  assert.equal(creds.rowCount,2);
  const blob=creds.rows.map(x=>String(x.ciphertext)).join(' ');
  assert(!blob.includes('qa-social-key'));
  assert(!blob.includes('qa-email-key'));

  console.log('EXTERNAL ACTIONS SANDBOX QA PASSED');
  console.log(JSON.stringify({socialPostIds:posted.postIds,emailId:sent.id,encryptedCredentials:creds.rowCount},null,2));
}finally{
  await pool.end();
  await new Promise(resolve=>server.close(resolve));
}
