import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

await import('../src/loopback-scan-fetch-compat.mjs');

function listen(server){
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve(server.address()));
  });
}
function close(server){return new Promise((resolve)=>server.close(()=>resolve()));}

test('loopback POST /scan uses the native long-scan transport',async(t)=>{
  const server=http.createServer((req,res)=>{
    if(req.method==='POST'&&req.url==='/scan'){
      setTimeout(()=>{
        const body=JSON.stringify({ok:true,evidence:[{id:'x'}]});
        res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
        res.end(body);
      },80);
      return;
    }
    res.writeHead(404).end();
  });
  const address=await listen(server);
  t.after(()=>close(server));
  const response=await fetch(`http://127.0.0.1:${address.port}/scan`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:'{"mode":"deep"}',
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-front-loopback-scan-proxy'),'1');
  assert.deepEqual(await response.json(),{ok:true,evidence:[{id:'x'}]});
});

test('loopback scan transport failures resolve to HTTP errors instead of rejecting for retry',async()=>{
  const probe=http.createServer();
  const address=await listen(probe);
  await close(probe);
  const response=await fetch(`http://127.0.0.1:${address.port}/scan`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:'{}',
  });
  assert.equal(response.status,503);
  assert.equal(response.headers.get('x-front-loopback-scan-proxy'),'1');
  const data=await response.json();
  assert.equal(data.error,'Local scan transport failed.');
});

test('non-scan loopback requests are not intercepted',async(t)=>{
  const server=http.createServer((req,res)=>{
    const body=JSON.stringify({ok:true});
    res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
    res.end(body);
  });
  const address=await listen(server);
  t.after(()=>close(server));
  const response=await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-front-loopback-scan-proxy'),null);
});
