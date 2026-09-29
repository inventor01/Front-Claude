import http from 'node:http';

const target='https://employee-os-api-next-production.up.railway.app';

http.createServer((req,res)=>{
  if(req.url==='/health'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ok:true,legacyRedirect:true,target}));
    return;
  }
  res.statusCode=307;
  res.setHeader('location',target+(req.url||'/'));
  res.setHeader('cache-control','no-store');
  res.end();
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{
  console.log('legacy Employee OS redirect listening');
});
