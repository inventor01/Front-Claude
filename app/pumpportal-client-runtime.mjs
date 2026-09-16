'use client';

export const PUMPPORTAL_ENABLE_KEY='front.pumpPortalListenerEnabled.v2';
const RUNTIME_KEY='__frontPumpPortalRuntimeV3';
const SOCKET_URL='wss://pumpportal.fun/api/data';

const snapshot=(runtime)=>({enabled:runtime.enabled,status:runtime.status,connected:runtime.socket?.readyState===WebSocket.OPEN});

function browserRuntime(){
  if(typeof window==='undefined')throw new Error('PumpPortal runtime is browser-only.');
  let runtime=window[RUNTIME_KEY];
  if(runtime)return runtime;
  const enabled=localStorage.getItem(PUMPPORTAL_ENABLE_KEY)==='true';
  runtime={socket:null,retry:null,attempt:0,enabled,status:enabled?'Starting':'Off',messageListeners:new Set(),stateListeners:new Set(),hooksInstalled:false};
  window[RUNTIME_KEY]=runtime;
  return runtime;
}

function publish(runtime,status=runtime.status){
  runtime.status=status;
  const state=snapshot(runtime);
  for(const listener of [...runtime.stateListeners]){try{listener(state);}catch{}}
}

function clearRetry(runtime){
  if(runtime.retry!==null){clearTimeout(runtime.retry);runtime.retry=null;}
}

function scheduleReconnect(runtime){
  if(!runtime.enabled||runtime.retry!==null)return;
  const delay=Math.min(30_000,1000*2**runtime.attempt++);
  publish(runtime,'Reconnecting');
  runtime.retry=setTimeout(()=>{runtime.retry=null;connect(runtime);},delay);
}

function connect(runtime){
  if(!runtime.enabled)return;
  const existing=runtime.socket;
  if(existing&&(existing.readyState===WebSocket.OPEN||existing.readyState===WebSocket.CONNECTING))return;
  clearRetry(runtime);
  publish(runtime,'Connecting');
  const socket=new WebSocket(SOCKET_URL);
  runtime.socket=socket;
  socket.onopen=()=>{
    if(runtime.socket!==socket||!runtime.enabled){try{socket.close();}catch{}return;}
    runtime.attempt=0;
    publish(runtime,'Connected · creations only');
    socket.send(JSON.stringify({method:'subscribeNewToken'}));
  };
  socket.onmessage=(event)=>{
    if(runtime.socket!==socket||!runtime.enabled)return;
    try{
      const data=JSON.parse(String(event.data));
      for(const listener of [...runtime.messageListeners]){try{listener(data);}catch{}}
    }catch{}
  };
  socket.onerror=()=>{if(runtime.socket===socket&&runtime.enabled)publish(runtime,'Connection error');};
  socket.onclose=()=>{
    if(runtime.socket!==socket)return;
    runtime.socket=null;
    if(runtime.enabled)scheduleReconnect(runtime);
    else publish(runtime,'Off');
  };
}

function installRecoveryHooks(runtime){
  if(runtime.hooksInstalled)return;
  runtime.hooksInstalled=true;
  window.addEventListener('online',()=>{if(runtime.enabled)connect(runtime);});
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&runtime.enabled)connect(runtime);});
}

export function ensurePumpPortalRuntime(){
  const runtime=browserRuntime();
  installRecoveryHooks(runtime);
  if(runtime.enabled)connect(runtime);
  else publish(runtime,'Off');
  return snapshot(runtime);
}

export function setPumpPortalRuntimeEnabled(enabled){
  const runtime=browserRuntime();
  installRecoveryHooks(runtime);
  runtime.enabled=Boolean(enabled);
  localStorage.setItem(PUMPPORTAL_ENABLE_KEY,String(runtime.enabled));
  if(!runtime.enabled){
    clearRetry(runtime);
    runtime.attempt=0;
    const socket=runtime.socket;
    runtime.socket=null;
    publish(runtime,'Off');
    try{socket?.close();}catch{}
    return snapshot(runtime);
  }
  if(runtime.socket?.readyState===WebSocket.OPEN){publish(runtime,'Connected · creations only');return snapshot(runtime);}
  if(runtime.socket?.readyState===WebSocket.CONNECTING){publish(runtime,'Connecting');return snapshot(runtime);}
  publish(runtime,'Starting');
  connect(runtime);
  return snapshot(runtime);
}

export function subscribePumpPortalRuntime(listener){
  const runtime=browserRuntime();
  installRecoveryHooks(runtime);
  runtime.stateListeners.add(listener);
  listener(snapshot(runtime));
  return()=>{runtime.stateListeners.delete(listener);};
}

export function subscribePumpPortalMessages(listener){
  const runtime=browserRuntime();
  installRecoveryHooks(runtime);
  runtime.messageListeners.add(listener);
  return()=>{runtime.messageListeners.delete(listener);};
}

export function getPumpPortalRuntimeSnapshot(){return snapshot(browserRuntime());}
