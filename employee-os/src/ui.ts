export function commandCenterHtml(){
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Employee OS</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090b;color:#f4f5f7}
*{box-sizing:border-box}body{margin:0;background:#08090b;color:#f4f5f7}button,input,textarea,select{font:inherit}
button{cursor:pointer}.hidden{display:none!important}.shell{min-height:100vh;display:grid;grid-template-columns:220px 1fr}
aside{border-right:1px solid #202329;background:#0d0f12;padding:20px 12px;position:sticky;top:0;height:100vh}
.brand{padding:4px 8px 18px}.brand b{display:block;font-size:17px}.brand span{font-size:10px;color:#727884}
nav button{display:block;width:100%;border:0;background:transparent;color:#8f959f;padding:10px 11px;text-align:left;border-radius:8px;margin:2px 0}
nav button.active,nav button:hover{background:#191c21;color:#fff}.aside-foot{position:absolute;bottom:16px;left:12px;right:12px}
.aside-foot button{width:100%;background:#15181d;border:1px solid #292d34;color:#999;padding:9px;border-radius:8px}
main{min-width:0}.top{height:68px;border-bottom:1px solid #202329;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;background:#08090be8;backdrop-filter:blur(12px);z-index:4}
.top small{color:#737985}.top h1{font-size:17px;margin:2px 0}.top button{background:#14171b;border:1px solid #282c33;color:#b8bdc6;padding:8px 10px;border-radius:8px}
.view{padding:22px;max-width:1280px;margin:auto}.hero{border:1px solid #292d34;border-radius:16px;padding:24px;background:linear-gradient(135deg,#15181d,#0d0f12);margin-bottom:12px}
.hero h2{font-size:34px;letter-spacing:-.045em;margin:0 0 7px}.hero p{color:#858b95;margin:0;line-height:1.5}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.card{border:1px solid #252930;background:#101216;border-radius:12px;padding:15px;min-width:0}.card h3{margin:0 0 8px;font-size:14px}.card p{color:#858b95;font-size:11px;line-height:1.55}.metric{font-size:26px;font-weight:750;display:block}.label{font-size:9px;color:#767d88;text-transform:uppercase;letter-spacing:.08em}
.badge{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid #30343c;color:#a9afb9;font-size:9px;white-space:nowrap}.badge.good{border-color:#244b36;color:#72d49e}.badge.warn{border-color:#614c24;color:#e3bd64}.badge.bad{border-color:#5e2b30;color:#f49ca5}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.stack{display:grid;gap:8px}.item{border:1px solid #23272d;border-radius:9px;padding:11px;background:#0b0d10}.item b{font-size:11px}.item p{margin:5px 0 0}.muted{color:#747b86;font-size:10px}.attention{border-color:#5a3f24}.error{background:#2a1619;border:1px solid #5c2a31;color:#f5a3aa;border-radius:9px;padding:10px;margin-bottom:10px;font-size:11px}
.success{background:#12241b;border:1px solid #27513a;color:#89d8aa;border-radius:9px;padding:10px;margin-bottom:10px;font-size:11px}
textarea,input,select{width:100%;background:#0b0d10;color:#f1f2f4;border:1px solid #2b2f37;border-radius:8px;padding:10px;outline:none}textarea:focus,input:focus,select:focus{border-color:#5d6674}
textarea{min-height:92px;resize:vertical}.form{display:grid;gap:8px}.action{background:#f0f2f4;color:#0c0e11;border:0;border-radius:8px;padding:10px 13px;font-weight:700}.secondary{background:#171a1f;color:#cbd0d7;border:1px solid #2d323a;border-radius:8px;padding:8px 10px}.danger{background:#2a171a;color:#ffabb2;border:1px solid #5a2d32;border-radius:8px;padding:8px 10px}
.section-title{font-size:13px;margin:22px 0 9px}.tabs{display:flex;gap:6px;overflow:auto}.package pre{white-space:pre-wrap;word-break:break-word;font-size:9px;color:#8d949f;max-height:200px;overflow:auto}
.employee{display:flex;gap:10px;align-items:flex-start}.avatar{width:34px;height:34px;border-radius:9px;background:#20242b;display:grid;place-items:center;font-weight:800}.employee p{margin:2px 0}
.auth-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}.auth-card{width:min(440px,100%);border:1px solid #292d34;background:#101216;border-radius:16px;padding:24px}.auth-card h1{margin:0 0 5px}.auth-card>p{color:#7f8691;font-size:11px;margin:0 0 18px}.auth-switch{background:transparent;border:0;color:#aeb4bd;text-decoration:underline;margin-top:10px}.empty{padding:30px;text-align:center;color:#686f7a;border:1px dashed #2c3037;border-radius:10px}
@media(max-width:850px){.shell{grid-template-columns:1fr}aside{height:auto;position:relative;display:flex;align-items:center;overflow:auto}.brand{padding:4px 10px}.brand span,.aside-foot{display:none}nav{display:flex}.grid,.grid.two{grid-template-columns:1fr}.top{padding:0 14px}.view{padding:14px}.hero h2{font-size:28px}}
</style>
</head>
<body>
<div id="auth" class="auth-wrap">
  <div class="auth-card">
    <h1>AI Employee OS</h1>
    <p>Your private operating system for persistent AI employees.</p>
    <div id="authError"></div>
    <form id="authForm" class="form">
      <input id="email" type="email" placeholder="Email" required/>
      <input id="password" type="password" placeholder="Password (12+ characters)" required/>
      <input id="companyName" placeholder="Company / venture studio name" value="My Venture Studio" required/>
      <button class="action" type="submit" id="authSubmit">Create company</button>
    </form>
    <button id="authSwitch" class="auth-switch">Already have an account? Log in</button>
  </div>
</div>

<div id="app" class="shell hidden">
<aside>
  <div class="brand"><b>Employee OS</b><span>Private operator</span></div>
  <nav id="nav">
    <button data-view="today" class="active">Today</button>
    <button data-view="work">Work</button>
    <button data-view="team">Employees</button>
    <button data-view="venture">Venture</button>\n    <button data-view="link">Link-to-Launch</button>
    <button data-view="approvals">Approvals</button>
    <button data-view="support">Customer Ops</button>
    <button data-view="brain">Company Brain</button>\n    <button data-view="academy">Academy</button>\n    <button data-view="connections">Connections</button>\n    <button data-view="activity">Activity</button>
  </nav>
  <div class="aside-foot"><button id="logout">Log out</button></div>
</aside>
<main>
  <div class="top"><div><small id="companyNameTop">Company</small><h1 id="viewTitle">TODAY</h1></div><button id="refresh">Refresh</button></div>
  <div class="view"><div id="notice"></div><div id="content"></div></div>
</main>
</div>

<script>
(function(){
  var token=localStorage.getItem('employee_os_token')||'';
  var companyId=localStorage.getItem('employee_os_company')||'';
  var mode='register', view='today', state=null, briefing=null, execution=null, memories=null, academy=null, shopify=null, cj=null, apify=null, openai=null, runway=null;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function badge(v){var x=String(v||'');var cls=/DONE|SUCCEEDED|APPROVED|READY_FOR/.test(x)?'good':/BLOCK|FAILED|REJECT/.test(x)?'bad':'warn';return '<span class="badge '+cls+'">'+esc(x)+'</span>';}
  function fmt(v){try{return new Date(v).toLocaleString();}catch(e){return String(v||'');}}
  async function request(path,opts){
    opts=opts||{};opts.headers=Object.assign({},opts.headers||{});
    if(opts.body!=null&&!opts.headers['content-type'])opts.headers['content-type']='application/json';
    if(token)opts.headers.authorization='Bearer '+token;
    var r=await fetch(path,opts);var body=await r.json().catch(function(){return {};});
    if(!r.ok){var e=new Error(body.error||('HTTP '+r.status));e.status=r.status;throw e;}return body;
  }
  function notice(msg,type){document.getElementById('notice').innerHTML=msg?'<div class="'+(type||'success')+'">'+esc(msg)+'</div>':'';}
  async function resolveCompany(){
    var me=await request('/api/me');
    var memberships=(me&&me.memberships)||[];
    var m=memberships.find(function(x){return x.company_id===companyId;})||memberships[0];
    if(!m)throw new Error('No company membership found.');
    companyId=m.company_id;
    localStorage.setItem('employee_os_company',companyId);
    document.getElementById('companyNameTop').textContent=m.company_name||'Company';
    return m;
  }
  async function optionalRequest(path,fallback,label){
    try{return await request(path);}
    catch(e){
      if(e.status===401)throw e;
      console.error('Optional Employee OS module failed:',label,e);
      return fallback;
    }
  }
  async function load(){
    if(!token)return showAuth();
    try{
      await resolveCompany();
      document.getElementById('auth').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');

      var all=await Promise.all([
        optionalRequest('/api/company/'+companyId+'/state',{employees:[],objectives:[],projects:[],workOrders:[],approvals:[],events:[],productCandidates:[],storePackages:[],creativePackages:[],distributionPackages:[],supportCases:[],issuePatterns:[],toolConnections:[],supplierMappings:[],fulfillmentOrders:[],referenceSources:[],linkLaunches:[]},'state'),
        optionalRequest('/api/company/'+companyId+'/briefing',{decisionsNeeded:[],attention:[],activeProjects:[]},'briefing'),
        optionalRequest('/api/company/'+companyId+'/execution',{jobs:[],steps:[],evidence:[],messages:[]},'execution'),
        optionalRequest('/api/company/'+companyId+'/memories',{memories:[]},'memories'),
        optionalRequest('/api/company/'+companyId+'/academy',{profiles:[],sources:[],lessons:[],tools:[],discoveries:[],claims:[],skills:[],skillTests:[]},'academy'),
        optionalRequest('/api/company/'+companyId+'/integrations/shopify',{connected:false,status:'UNAVAILABLE'},'shopify'),
        optionalRequest('/api/company/'+companyId+'/integrations/cj',{connected:false,status:'UNAVAILABLE'},'cj'),
        optionalRequest('/api/company/'+companyId+'/integrations/apify',{connected:false,status:'UNAVAILABLE'},'apify'),
        optionalRequest('/api/company/'+companyId+'/integrations/openai',{connected:false,status:'UNAVAILABLE'},'openai'),
        optionalRequest('/api/company/'+companyId+'/integrations/runway',{connected:false,status:'UNAVAILABLE'},'runway')
      ]);
      state=all[0];briefing=all[1];execution=all[2];memories=all[3];academy=all[4];shopify=all[5];cj=all[6];apify=all[7];openai=all[8];runway=all[9];
      render();
    }catch(e){
      if(e.status===401){
        localStorage.removeItem('employee_os_token');
        localStorage.removeItem('employee_os_company');
        token='';companyId='';showAuth('Your session expired. Sign in again.');
      }else{
        document.getElementById('auth').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        notice(e.message||'Employee OS could not finish loading.','error');
      }
    }
  }
  function showAuth(message){
    document.getElementById('auth').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    if(message)document.getElementById('authError').innerHTML='<div class="error">'+esc(message)+'</div>';
  }
  document.getElementById('authSwitch').onclick=function(){
    mode=mode==='register'?'login':'register';
    document.getElementById('companyName').classList.toggle('hidden',mode==='login');
    document.getElementById('authSubmit').textContent=mode==='login'?'Log in':'Create company';
    this.textContent=mode==='login'?'Need an account? Create company':'Already have an account? Log in';
  };
  document.getElementById('authForm').onsubmit=async function(e){
    e.preventDefault();document.getElementById('authError').innerHTML='';
    try{
      var body={email:document.getElementById('email').value,password:document.getElementById('password').value};
      if(mode==='register')body.companyName=document.getElementById('companyName').value;
      if(mode==='login'){
        localStorage.removeItem('employee_os_company');
        companyId='';
      }
      var r=await request('/api/auth/'+mode,{method:'POST',body:JSON.stringify(body)});
      token=r.token;
      localStorage.setItem('employee_os_token',token);
      if(r.company){companyId=r.company.id;localStorage.setItem('employee_os_company',companyId);}
      await load();
    }catch(err){document.getElementById('authError').innerHTML='<div class="error">'+esc(err.message)+'</div>';}
  };
  document.getElementById('logout').onclick=function(){localStorage.clear();token='';companyId='';location.reload();};
  document.getElementById('refresh').onclick=function(){load();};
  document.getElementById('nav').onclick=function(e){var b=e.target.closest('button[data-view]');if(!b)return;view=b.dataset.view;document.querySelectorAll('#nav button').forEach(function(x){x.classList.toggle('active',x===b);});render();};

  function render(){
    document.getElementById('viewTitle').textContent=view.toUpperCase();
    var h='';
    if(view==='today')h=renderToday();
    if(view==='work')h=renderWork();
    if(view==='team')h=renderTeam();
    if(view==='venture')h=renderVenture();
    if(view==='link')h=renderLinkLaunch();
    if(view==='approvals')h=renderApprovals();
    if(view==='support')h=renderSupport();
    if(view==='brain')h=renderBrain();
    if(view==='academy')h=renderAcademy();
    if(view==='connections')h=renderConnections();
    if(view==='activity')h=renderActivity();
    document.getElementById('content').innerHTML=h;bindView();
  }

  function renderToday(){
    var decisions=(briefing&&briefing.decisionsNeeded)||[], attention=(briefing&&briefing.attention)||[], projects=(briefing&&briefing.activeProjects)||[];
    var urgent=decisions.length?decisions.length+' decision'+(decisions.length===1?'':'s')+' need you.':attention.length?attention.length+' blocker'+(attention.length===1?'':'s')+' visible.':'Nothing urgent needs you.';
    return '<div class="hero"><h2>'+esc(urgent)+'</h2><p>Give Ava an outcome. The company persists the work, delegates it, and surfaces only evidence-backed results and real blockers.</p></div>'+
    '<div class="grid"><div class="card"><span class="metric">'+projects.length+'</span><span class="label">Active projects</span></div><div class="card"><span class="metric">'+decisions.length+'</span><span class="label">Decisions</span></div><div class="card"><span class="metric">'+attention.length+'</span><span class="label">Attention items</span></div></div>'+
    '<h3 class="section-title">Launch from a reference link</h3><div class="card"><form id="linkLaunchQuickForm" class="form"><input id="linkLaunchQuickUrl" placeholder="Paste Instagram Reel, TikTok, X, YouTube, or product-demo URL"/><button class="action">Reverse-engineer and build venture</button></form><p>Employee OS preserves the source, identifies the product, reverse-sources it, and sends the creative structure to Maya without copying the creator\\'s exact assets.</p></div>'+
    '<h3 class="section-title">Or give Ava an objective</h3><div class="card"><form id="objectiveForm" class="form"><textarea id="objectiveText">Find a product that is demonstrably selling now and build the business from start to finish. Verify demand, supplier viability, stock, U.S. freight, landed economics, contentability, and risk. Build the brand and Shopify storefront, connect fulfillment, create the creative and distribution system, and continue until the business is launch-ready. Only bring me decisions or external actions that genuinely require owner approval. Never assume unknown facts and never call work complete without evidence.</textarea><input id="objectiveQuery" placeholder="Optional focus — leave blank and Rowan chooses the product from current evidence"/><button class="action">Start durable work</button></form></div>'+
    '<h3 class="section-title">What needs me</h3><div class="stack">'+(decisions.concat(attention).slice(0,8).map(renderAttention).join('')||'<div class="empty">No owner decision is waiting.</div>')+'</div>';
  }
  function renderAttention(x){return '<div class="item attention"><div class="row"><b>'+esc(x.action_type||x.objective||'Attention')+'</b>'+badge(x.status||x.risk)+'</div><p>'+esc(x.reason||((x.blockers||[]).join(' · ')))+'</p></div>';}
  function renderWork(){return '<div class="stack">'+((state.workOrders||[]).map(function(w){return '<div class="item"><div class="row"><b>'+esc(w.objective)+'</b>'+badge(w.status)+'</div><p>Assigned to '+esc(w.assigned_employee_slug)+' · '+esc((w.blockers||[]).join(' · '))+'</p></div>';}).join('')||'<div class="empty">No work orders yet.</div>')+'</div>';}
  function renderTeam(){return '<div class="grid two">'+(state.employees||[]).map(function(e){return '<div class="card employee"><div class="avatar">'+esc(e.name.slice(0,1))+'</div><div><div class="row"><b>'+esc(e.name)+'</b>'+badge(e.status)+'</div><p>'+esc(e.title)+'</p><span class="muted">'+esc(e.mission)+'</span></div></div>';}).join('')+'</div>';}
  function packageCard(title,pkg,extra){
    if(!pkg)return '<div class="card package"><h3>'+esc(title)+'</h3><p>Not created yet.</p></div>';
    return '<div class="card package"><div class="row"><h3>'+esc(title)+'</h3>'+badge(pkg.status)+'</div><p>'+esc(extra||'Persistent package')+'</p><pre>'+esc(JSON.stringify(pkg,null,2).slice(0,4000))+'</pre></div>';
  }
  function renderVenture(){
    var candidate=(state.productCandidates||[])[0], store=(state.storePackages||[])[0], creative=(state.creativePackages||[])[0], dist=(state.distributionPackages||[])[0];
    return '<div class="grid two">'+packageCard('Product Research',candidate,candidate?candidate.name+' · score '+candidate.score+'/100':'')+packageCard('Store Builder',store)+packageCard('Creative Studio',creative,creative?'Scripts: '+(creative.scripts||[]).length+' · rendered assets: '+((creative.external_state||{}).renderedAssets||0):'')+packageCard('Distribution',dist,dist?'Planned posts: '+(dist.calendar||[]).length+' · published: '+((dist.external_state||{}).publishedCount||0):'')+'</div>';
  }
  function renderLinkLaunch(){
    var launches=(state.linkLaunches||[]),sources=(state.referenceSources||[]);
    var rows=launches.map(function(l){
      var source=sources.find(function(s){return s.id===l.source_id;})||{};
      var product=l.identified_product||((source.analysis||{}).product||{}).searchQuery||'Identifying product…';
      return '<div class="item"><div class="row"><b>'+esc(product)+'</b>'+badge(l.status)+'</div><p>'+esc(source.source_url||'')+'</p><span class="muted">Source: '+esc(source.provider||'')+' · confidence '+esc(l.identified_product_confidence||'pending')+(l.product_url?' · '+esc(l.product_url):'')+'</span></div>';
    }).join('');
    var blockers=[];
    if(!(apify&&apify.connected))blockers.push('Apify/social capture');
    if(!(openai&&openai.connected))blockers.push('multimodal analyzer');
    var status=blockers.length?'<div class="error">Connect '+esc(blockers.join(' + '))+' in Connections before a blocked Instagram source can be visually analyzed.</div>':'<div class="success">Social capture and multimodal analysis are connected.</div>';
    return '<div class="hero"><h2>Link-to-Launch</h2><p>Paste one social-commerce reference. Rowan identifies and sources the product; Luca builds the storefront; Maya models the creative structure into original variants; Nova plans distribution; Ellis owns customer operations.</p></div>'+
      status+
      '<div class="card"><form id="linkLaunchForm" class="form"><input id="linkLaunchUrl" placeholder="https://www.instagram.com/reel/..."/><textarea id="linkLaunchConstraints" placeholder="Optional constraints, one per line">Prefer lowest verified landed cost without sacrificing reasonable U.S. delivery&#10;Avoid regulated, high-return, IP-sensitive, or unsafe products&#10;No publishing or spending without owner approval</textarea><button class="action">Start Link-to-Launch</button></form></div>'+
      '<h3 class="section-title">Reference ventures</h3><div class="stack">'+(rows||'<div class="empty">No link-based ventures yet.</div>')+'</div>';
  }

  function renderApprovals(){
    var rows=(state.approvals||[]).filter(function(a){return a.status==='PENDING';});
    return '<div class="stack">'+(rows.map(function(a){return '<div class="item"><div class="row"><b>'+esc(a.action_type)+'</b>'+badge(a.risk)+'</div><p>'+esc(a.reason)+'</p><div class="row"><span class="muted">Cost: $'+((a.cost_cents||0)/100).toFixed(2)+'</span><div><button class="secondary approval" data-id="'+esc(a.id)+'" data-decision="approve">Approve</button> <button class="danger approval" data-id="'+esc(a.id)+'" data-decision="reject">Reject</button></div></div></div>';}).join('')||'<div class="empty">No approvals waiting.</div>')+'</div>';
  }
  function renderSupport(){
    var cases=state.supportCases||[], patterns=state.issuePatterns||[];
    return '<div class="grid two"><div class="card"><h3>Test / manual customer case</h3><form id="supportForm" class="form"><select id="supportChannel"><option>EMAIL</option><option>LIVE_CHAT</option></select><input id="supportCustomer" placeholder="Customer reference" value="customer@example.test"/><input id="supportSubject" placeholder="Subject" value="Does this work with my setup?"/><textarea id="supportMessage">Does this work in a small car and how long does shipping take?</textarea><button class="action">Send to Ellis</button></form></div><div class="card"><h3>Recurring issue intelligence</h3><div class="stack">'+(patterns.map(function(p){return '<div class="item"><div class="row"><b>'+esc(p.category)+'</b><span class="badge">'+esc(p.occurrences)+'×</span></div><p>'+esc(p.latest_example)+'</p></div>';}).join('')||'<div class="empty">No repeated issue patterns yet.</div>')+'</div></div></div><h3 class="section-title">Cases</h3><div class="stack">'+(cases.map(function(x){return '<div class="item"><div class="row"><b>'+esc(x.subject)+'</b>'+badge(x.status)+'</div><p>'+esc(x.customer_message)+'</p><p><b>Ellis draft:</b> '+esc(x.draft_response||'Pending')+'</p></div>';}).join('')||'<div class="empty">No support cases yet.</div>')+'</div>';
  }
  function renderBrain(){return '<div class="stack">'+(((memories&&memories.memories)||[]).map(function(m){return '<div class="item"><div class="row"><b>'+esc(m.subject)+'</b>'+badge(m.type)+'</div><p>'+esc(m.content)+'</p><span class="muted">'+esc(m.source||'No source')+' · confidence '+esc(m.confidence)+'</span></div>';}).join('')||'<div class="empty">Company Brain has no active memory yet.</div>')+'</div>';}
  function renderAcademy(){
    var profiles=(academy&&academy.profiles)||[],sources=(academy&&academy.sources)||[],lessons=(academy&&academy.lessons)||[],tools=(academy&&academy.tools)||[],claims=(academy&&academy.claims)||[],skills=(academy&&academy.skills)||[];
    var employeeOptions='<option value="">Company-wide</option>'+((state&&state.employees)||[]).map(function(e){return '<option value="'+esc(e.slug)+'">'+esc(e.name)+' — '+esc(e.title)+'</option>';}).join('');
    var profileCards=profiles.map(function(p){
      return '<div class="item"><div class="row"><b>'+esc(p.employee_slug)+'</b>'+badge(p.uncertainty_policy)+'</div><p>First principles: '+esc(p.first_principles?'ON':'OFF')+' · think '+esc(p.forward_horizon_steps)+' moves ahead</p><span class="muted">'+esc(p.learning_policy)+'</span></div>';
    }).join('');
    var sourceCards=sources.slice(0,30).map(function(s){
      return '<div class="item"><div class="row"><b>'+esc(s.title)+'</b>'+badge(s.source_quality)+'</div><p>'+esc(s.employee_slug||'Company-wide')+' · '+esc(s.source_type)+'</p><span class="muted">'+esc(s.source_url||'Pasted training note')+'</span></div>';
    }).join('');
    var lessonCards=lessons.slice(0,40).map(function(l){
      return '<div class="item"><div class="row"><b>'+esc(l.lesson_type)+'</b>'+badge(l.confidence)+'</div><p>'+esc(l.principle)+'</p><span class="muted">'+esc(l.employee_slug||'Company-wide')+' · '+esc(l.source_title)+'</span></div>';
    }).join('');
    var skillCards=skills.slice(0,30).map(function(s){
      return '<div class="item"><div class="row"><b>'+esc(s.name)+' v'+esc(s.current_version)+'</b>'+badge(s.status)+'</div><p>'+esc(s.purpose)+'</p><span class="muted">'+esc(s.employee_slug||'Company-wide')+' · tools: '+esc((s.required_tools||[]).join(', ')||'none')+'</span><div style="margin-top:8px"><button class="secondary skill-test" data-id="'+esc(s.id)+'">Run skill test</button></div></div>';
    }).join('');
    var toolCards=tools.slice(0,40).map(function(t){
      return '<div class="item"><div class="row"><b>'+esc(t.name)+'</b>'+badge(t.verification_grade)+'</div><p>'+esc(t.capability)+'</p><span class="muted">'+esc(t.automation_policy)+' · '+esc(t.provider)+'</span></div>';
    }).join('');
    var claimCards=claims.slice(0,20).map(function(claim){
      return '<div class="item"><div class="row"><b>'+esc(claim.claim_type)+'</b>'+badge(claim.status)+'</div><p>'+esc(claim.claim_text)+'</p><span class="muted">Tool: '+esc(claim.selected_tool_id||'none yet')+' · desired '+esc(claim.desired_grade)+'</span></div>';
    }).join('');
    return '<div class="hero"><h2>Employee Academy</h2><p>Teach each AI from threads, tutorials, docs, examples, and your own notes. Then compile sourced lessons into versioned, testable Skills.</p></div>'+
      '<div class="grid two"><div class="card"><h3>Train an employee</h3><form id="trainingForm" class="form"><select id="trainingEmployee">'+employeeOptions+'</select><input id="trainingTitle" placeholder="Optional title"/><input id="trainingUrl" placeholder="X thread, tutorial, docs, or public URL"/><textarea id="trainingText" placeholder="Or paste training text / notes here"></textarea><input id="trainingTags" placeholder="Tags, comma separated (ai-video, hooks, editing)"/><button class="action">Ingest training source</button></form></div>'+
      '<div class="card"><h3>Compile a reusable Skill</h3><form id="skillCompileForm" class="form"><select id="skillEmployee">'+employeeOptions+'</select><input id="skillName" placeholder="Skill name" value="Cinematic product video"/><textarea id="skillPurpose">Turn sourced AI-video lessons into a repeatable product-video procedure with verification and tool requirements.</textarea><button class="action">Compile skill from active lessons</button></form><p class="muted">A Skill keeps source provenance, required tools, verification rules, versions, and tests.</p></div></div>'+
      '<div class="grid two" style="margin-top:10px"><div class="card"><h3>Find the right verification tool</h3><form id="toolDiscoveryForm" class="form"><select id="claimType"><option>OWN_REVENUE</option><option>COMPETITOR_REVENUE</option><option>TRAFFIC</option><option>AD_ACTIVITY</option><option>TREND</option></select><textarea id="claimDescription">Verify whether a competitor store is actually generating the revenue being claimed.</textarea><button class="action">Find verification tools</button></form></div>'+
      '<div class="card"><h3>Skill status</h3><p>Skills can be ACTIVE, READY_NEEDS_TOOLS, or DRAFT. Tool-dependent skills do not pretend they are executable until the required connection exists.</p></div></div>'+
      '<h3 class="section-title">Compiled skills</h3><div class="stack">'+(skillCards||'<div class="empty">Compile your first Skill from active lessons.</div>')+'</div>'+
      '<h3 class="section-title">Reasoning contracts</h3><div class="grid two">'+(profileCards||'<div class="empty">No reasoning profiles yet.</div>')+'</div>'+
      '<h3 class="section-title">Training sources</h3><div class="stack">'+(sourceCards||'<div class="empty">Add your first tutorial, thread, document, or note.</div>')+'</div>'+
      '<h3 class="section-title">Extracted lessons</h3><div class="stack">'+(lessonCards||'<div class="empty">Lessons will appear after training ingestion.</div>')+'</div>'+
      '<h3 class="section-title">Verification tool registry</h3><div class="grid two">'+(toolCards||'<div class="empty">Tool catalog is empty.</div>')+'</div>'+
      '<h3 class="section-title">Verification claims</h3><div class="stack">'+(claimCards||'<div class="empty">No claim-verification requests yet.</div>')+'</div>';
  }
  function renderConnections(){
    var connected=shopify&&shopify.connected, meta=(shopify&&shopify.metadata)||{};
    var shopifyStatus=connected
      ? '<div class="success"><b>Shopify connected</b><br>'+esc(meta.storeName||meta.storeDomain||'Store')+' · '+esc((meta.primaryDomain||{}).url||meta.storeDomain||'')+'</div>'
      : '<div class="error"><b>Shopify not connected</b><br>Luca cannot publish a live designed storefront until a dedicated venture store is authorized once.</div>';
    var scopes='read_products, write_products, read_orders, read_publications, write_publications, read_content, write_content, read_themes, write_themes, read_files, write_files, read_online_store_pages, write_online_store_pages, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders, read_third_party_fulfillment_orders, write_third_party_fulfillment_orders';

    var cjConnected=cj&&cj.connected, cjMeta=(cj&&cj.metadata)||{};
    var cjStatusHtml=cjConnected
      ? '<div class="success"><b>CJdropshipping connected</b><br>Fulfillment account '+esc(cjMeta.openId||'connected')+' · API 2.0</div>'
      : '<div class="error"><b>CJdropshipping not connected</b><br>No venture product can publish until a supplier variant, stock, U.S. freight, and landed cost are verified.</div>';

    var apifyConnected=apify&&apify.connected;
    var apifyHtml=apifyConnected
      ? '<div class="success"><b>Social reference capture connected</b><br>Instagram Reels can be captured from public URLs.</div>'
      : '<div class="error"><b>Social reference capture not connected</b><br>Instagram can block ordinary fetchers. Connect Apify once so public Reels can be captured reliably.</div>';

    var openaiConnected=openai&&openai.connected, openaiMeta=(openai&&openai.metadata)||{};
    var openaiHtml=openaiConnected
      ? '<div class="success"><b>Multimodal analyzer connected</b><br>'+esc(openaiMeta.model||'Vision model')+' · sampled Reel frames can be analyzed.</div>'
      : '<div class="error"><b>Multimodal analyzer not connected</b><br>Link-to-Launch needs image understanding to identify products and deconstruct creative from sampled video frames.</div>';

    var runwayConnected=runway&&runway.connected, runwayMeta=(runway&&runway.metadata)||{};
    var runwayCost=((Number(runwayMeta.estimatedDefaultCostCents||180))/100).toFixed(2);
    var runwayHtml=runwayConnected
      ? '<div class="success"><b>Runway renderer connected</b><br>'+esc(runwayMeta.model||'Video model')+' · default package '+esc(runwayMeta.defaultClipCount||3)+' clips / estimated $'+esc(runwayCost)+'</div>'
      : '<div class="error"><b>Runway renderer not connected</b><br>Maya can build scripts and storyboards, but cannot generate final original video assets.</div>';

    return '<div class="hero"><h2>Connections</h2><p>Authorize external tools once. Employees can then use them through audited backend adapters without exposing credentials to the browser again.</p></div>'+
      '<div class="grid two"><div class="card"><h3>Social reference capture</h3>'+apifyHtml+
      (apifyConnected
        ? '<button id="disconnectApify" class="danger">Disconnect capture</button>'
        : '<form id="apifyConnectForm" class="form"><input id="apifyToken" type="password" placeholder="Apify API token" autocomplete="new-password"/><button class="action">Connect Reel capture</button></form><p class="muted">Used for public Instagram reference capture. Token stays encrypted server-side.</p>')+
      '</div><div class="card"><h3>Multimodal reference analysis</h3>'+openaiHtml+
      (openaiConnected
        ? '<button id="disconnectOpenAI" class="danger">Disconnect analyzer</button>'
        : '<form id="openaiConnectForm" class="form"><input id="openaiApiKey" type="password" placeholder="OpenAI API key" autocomplete="new-password"/><button class="action">Connect visual analyzer</button></form><p class="muted">Employee OS samples frames and sends only the required reference context for product and creative analysis.</p>')+
      '</div></div>'+
      '<div class="grid two" style="margin-top:10px"><div class="card"><h3>Runway video rendering</h3>'+runwayHtml+
      (runwayConnected
        ? '<button id="disconnectRunway" class="danger">Disconnect Runway</button>'
        : '<form id="runwayConnectForm" class="form"><input id="runwayApiSecret" type="password" placeholder="Runway Dev API secret" autocomplete="new-password"/><input id="runwayModel" value="gen4.5" placeholder="Model"/><button class="action">Connect Runway renderer</button></form><p class="muted">Rendering remains approval-gated because it can create provider cost. Finished clips are copied into Shopify Files so temporary Runway URLs are never treated as durable assets.</p>')+
      '</div><div class="card"><h3>Creative execution rule</h3><p>Maya is only DONE after approved clips are rendered, Shopify-hosted assets are READY, and Nova receives durable URLs. Scripts alone are not completion.</p></div></div>'+
      '<div class="grid two" style="margin-top:10px"><div class="card"><h3>Shopify execution</h3>'+shopifyStatus+
      (connected
        ? '<p>API version: '+esc(meta.apiVersion||'2026-07')+' · Online Store: '+esc(meta.publicationTitle||'Online Store')+'</p><button id="disconnectShopify" class="danger">Disconnect Shopify</button>'
        : '<form id="shopifyConnectForm" class="form"><input id="shopifyDomain" placeholder="venture-store.myshopify.com" autocomplete="off"/><input id="shopifyToken" type="password" placeholder="Admin API access token" autocomplete="new-password"/><button class="action">Connect dedicated venture store</button></form><p class="muted">Required custom-app scopes: '+esc(scopes)+'. The token is encrypted server-side and never returned by this API.</p>')+
      '</div><div class="card"><h3>CJdropshipping fulfillment</h3>'+cjStatusHtml+
      (cjConnected
        ? '<p>Access tokens stay backend-only and are refreshed automatically before expiry.</p><button id="disconnectCJ" class="danger">Disconnect CJ</button>'
        : '<form id="cjConnectForm" class="form"><input id="cjApiKey" type="password" placeholder="CJ API key" autocomplete="new-password"/><button class="action">Connect CJdropshipping</button></form><p class="muted">Employee OS exchanges the API key for backend-only CJ access and refresh tokens.</p>')+
      '</div></div>'+
      '<div class="card" style="margin-top:10px"><h3>Finish-line rule</h3><p>Link-to-Launch is DONE only after source provenance, product identity, verified supplier mapping, stock, freight, landed cost, designed Shopify theme, product publication, reachable URL, creative package, and fulfillment path are all persisted.</p></div>';
  }
  function renderActivity(){return '<div class="stack">'+((state.events||[]).map(function(e){return '<div class="item"><div class="row"><b>'+esc(e.type)+'</b><span class="muted">'+esc(fmt(e.created_at))+'</span></div><p>'+esc(JSON.stringify(e.payload))+'</p></div>';}).join('')||'<div class="empty">No events yet.</div>')+'</div>';}

  function bindView(){
    async function submitLinkLaunch(url,constraints){
      if(!url)throw new Error('Paste a reference URL first.');
      notice('Ava accepted the reference. Rowan is capturing and identifying the product…');
      await request('/api/company/'+companyId+'/ventures/from-link',{method:'POST',body:JSON.stringify({url:url,constraints:constraints||[],budgetCents:null})});
      notice('Link-to-Launch started. Work will continue in the background.');setTimeout(load,1400);
    }
    var quick=document.getElementById('linkLaunchQuickForm');
    if(quick)quick.onsubmit=async function(e){e.preventDefault();try{await submitLinkLaunch(document.getElementById('linkLaunchQuickUrl').value,[]);}catch(err){notice(err.message,'error');}};
    var linkForm=document.getElementById('linkLaunchForm');
    if(linkForm)linkForm.onsubmit=async function(e){e.preventDefault();try{
      var constraints=document.getElementById('linkLaunchConstraints').value.split('\\n').map(function(x){return x.trim();}).filter(Boolean);
      await submitLinkLaunch(document.getElementById('linkLaunchUrl').value,constraints);
    }catch(err){notice(err.message,'error');}};
    var objective=document.getElementById('objectiveForm');
    if(objective)objective.onsubmit=async function(e){e.preventDefault();try{notice('Ava is creating durable work…');await request('/api/company/'+companyId+'/objectives',{method:'POST',body:JSON.stringify({statement:document.getElementById('objectiveText').value,constraints:['No spending without owner approval','No publishing without owner approval'],query:document.getElementById('objectiveQuery').value})});notice('Objective accepted. The worker will continue after this request.');setTimeout(load,1200);}catch(err){notice(err.message,'error');}};
    document.querySelectorAll('.approval').forEach(function(b){b.onclick=async function(){try{await request('/api/company/'+companyId+'/approvals/'+b.dataset.id+'/'+b.dataset.decision,{method:'POST'});notice('Decision recorded.');await load();}catch(err){notice(err.message,'error');}};});
    var support=document.getElementById('supportForm');
    if(support)support.onsubmit=async function(e){e.preventDefault();try{await request('/api/company/'+companyId+'/support/cases',{method:'POST',body:JSON.stringify({channel:document.getElementById('supportChannel').value,customerRef:document.getElementById('supportCustomer').value,subject:document.getElementById('supportSubject').value,message:document.getElementById('supportMessage').value})});notice('Case accepted by Ellis.');setTimeout(load,1200);}catch(err){notice(err.message,'error');}};
    var training=document.getElementById('trainingForm');
    if(training)training.onsubmit=async function(e){e.preventDefault();try{
      var tags=document.getElementById('trainingTags').value.split(',').map(function(x){return x.trim();}).filter(Boolean);
      var body={employeeSlug:document.getElementById('trainingEmployee').value||null,title:document.getElementById('trainingTitle').value||undefined,url:document.getElementById('trainingUrl').value||undefined,text:document.getElementById('trainingText').value||undefined,tags:tags};
      var result=await request('/api/company/'+companyId+'/academy/sources',{method:'POST',body:JSON.stringify(body)});
      notice('Training ingested: '+result.lessons.length+' sourced lessons extracted.');await load();
    }catch(err){notice(err.message,'error');}};
    var discover=document.getElementById('toolDiscoveryForm');
    if(discover)discover.onsubmit=async function(e){e.preventDefault();try{
      var result=await request('/api/company/'+companyId+'/academy/tools/discover',{method:'POST',body:JSON.stringify({claimType:document.getElementById('claimType').value,claimDescription:document.getElementById('claimDescription').value})});
      var suffix=result.webSearchStatus==='AUTH_REQUIRED'?' Existing verified catalog searched; web tool scout needs a Jina Search API key.':' Tool discovery completed.';
      notice('Verification tools evaluated.'+suffix);await load();
    }catch(err){notice(err.message,'error');}};
    var skillCompile=document.getElementById('skillCompileForm');
    if(skillCompile)skillCompile.onsubmit=async function(e){e.preventDefault();try{
      var result=await request('/api/company/'+companyId+'/academy/skills/compile',{method:'POST',body:JSON.stringify({
        employeeSlug:document.getElementById('skillEmployee').value||null,
        name:document.getElementById('skillName').value,
        purpose:document.getElementById('skillPurpose').value,
        sourceIds:[]
      })});
      notice('Skill compiled as version '+result.definition.current_version+'. Run its test before relying on it.');await load();
    }catch(err){notice(err.message,'error');}};
    document.querySelectorAll('.skill-test').forEach(function(b){b.onclick=async function(){try{
      var result=await request('/api/company/'+companyId+'/academy/skills/'+b.dataset.id+'/test',{method:'POST'});
      notice('Skill test: '+result.status+(result.missingTools&&result.missingTools.length?' · missing '+result.missingTools.join(', '):''));await load();
    }catch(err){notice(err.message,'error');}};});
    var shopifyForm=document.getElementById('shopifyConnectForm');
    if(shopifyForm)shopifyForm.onsubmit=async function(e){e.preventDefault();try{
      notice('Validating store, scopes, and Online Store publication…');
      await request('/api/company/'+companyId+'/integrations/shopify/connect',{method:'POST',body:JSON.stringify({
        storeDomain:document.getElementById('shopifyDomain').value,
        accessToken:document.getElementById('shopifyToken').value
      })});
      document.getElementById('shopifyToken').value='';notice('Shopify connected. Luca can now execute approved store builds.');await load();
    }catch(err){notice(err.message,'error');}};
    var disconnect=document.getElementById('disconnectShopify');
    if(disconnect)disconnect.onclick=async function(){try{
      await request('/api/company/'+companyId+'/integrations/shopify',{method:'DELETE'});notice('Shopify disconnected.');await load();
    }catch(err){notice(err.message,'error');}};
    var cjForm=document.getElementById('cjConnectForm');
    if(cjForm)cjForm.onsubmit=async function(e){e.preventDefault();try{
      notice('Authenticating with CJ and securing backend tokens…');
      await request('/api/company/'+companyId+'/integrations/cj/connect',{method:'POST',body:JSON.stringify({apiKey:document.getElementById('cjApiKey').value})});
      document.getElementById('cjApiKey').value='';notice('CJdropshipping connected. Supplier mapping can now run automatically.');await load();
    }catch(err){notice(err.message,'error');}};
    var disconnectCJ=document.getElementById('disconnectCJ');
    if(disconnectCJ)disconnectCJ.onclick=async function(){try{
      await request('/api/company/'+companyId+'/integrations/cj',{method:'DELETE'});notice('CJdropshipping disconnected.');await load();
    }catch(err){notice(err.message,'error');}};
    var apifyForm=document.getElementById('apifyConnectForm');
    if(apifyForm)apifyForm.onsubmit=async function(e){e.preventDefault();try{
      notice('Validating social capture provider…');
      await request('/api/company/'+companyId+'/integrations/apify/connect',{method:'POST',body:JSON.stringify({token:document.getElementById('apifyToken').value})});
      document.getElementById('apifyToken').value='';notice('Social reference capture connected.');await load();
    }catch(err){notice(err.message,'error');}};
    var disconnectApify=document.getElementById('disconnectApify');
    if(disconnectApify)disconnectApify.onclick=async function(){try{
      await request('/api/company/'+companyId+'/integrations/apify',{method:'DELETE'});notice('Social reference capture disconnected.');await load();
    }catch(err){notice(err.message,'error');}};
    var openaiForm=document.getElementById('openaiConnectForm');
    if(openaiForm)openaiForm.onsubmit=async function(e){e.preventDefault();try{
      notice('Validating multimodal model access…');
      await request('/api/company/'+companyId+'/integrations/openai/connect',{method:'POST',body:JSON.stringify({apiKey:document.getElementById('openaiApiKey').value})});
      document.getElementById('openaiApiKey').value='';notice('Multimodal reference analyzer connected.');await load();
    }catch(err){notice(err.message,'error');}};
    var disconnectOpenAI=document.getElementById('disconnectOpenAI');
    if(disconnectOpenAI)disconnectOpenAI.onclick=async function(){try{
      await request('/api/company/'+companyId+'/integrations/openai',{method:'DELETE'});notice('Multimodal analyzer disconnected.');await load();
    }catch(err){notice(err.message,'error');}};
    var runwayForm=document.getElementById('runwayConnectForm');
    if(runwayForm)runwayForm.onsubmit=async function(e){e.preventDefault();try{
      notice('Validating Runway Dev access…');
      await request('/api/company/'+companyId+'/integrations/runway/connect',{method:'POST',body:JSON.stringify({
        apiSecret:document.getElementById('runwayApiSecret').value,
        model:document.getElementById('runwayModel').value||'gen4.5'
      })});
      document.getElementById('runwayApiSecret').value='';notice('Runway renderer connected. Maya can now request priced render approval.');await load();
    }catch(err){notice(err.message,'error');}};
    var disconnectRunway=document.getElementById('disconnectRunway');
    if(disconnectRunway)disconnectRunway.onclick=async function(){try{
      await request('/api/company/'+companyId+'/integrations/runway',{method:'DELETE'});notice('Runway renderer disconnected.');await load();
    }catch(err){notice(err.message,'error');}};
  }
  load();
})();
</script>
</body></html>`;
}
