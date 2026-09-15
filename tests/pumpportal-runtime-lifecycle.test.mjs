import test from 'node:test';
import assert from 'node:assert/strict';
import {ensurePumpPortalRuntime,setPumpPortalRuntimeEnabled,subscribePumpPortalMessages,subscribePumpPortalRuntime} from '../app/pumpportal-client-runtime.mjs';

class MockWebSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;static instances=[];
  constructor(url){this.url=url;this.readyState=MockWebSocket.CONNECTING;this.sent=[];MockWebSocket.instances.push(this);}
  send(value){this.sent.push(JSON.parse(value));}
  open(){this.readyState=MockWebSocket.OPEN;this.onopen?.();}
  message(value){this.onmessage?.({data:JSON.stringify(value)});}
  close(){this.readyState=MockWebSocket.CLOSED;this.onclose?.();}
}

test('PumpPortal runtime survives Settings unmount and only explicit stop closes the socket',()=>{
  const store=new Map([['front.pumpPortalListenerEnabled.v2','true']]);
  const listeners=new Map();
  globalThis.WebSocket=MockWebSocket;
  globalThis.localStorage={getItem:(key)=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
  globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn)};
  globalThis.document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(`document:${name}`,fn)};
  MockWebSocket.instances.length=0;

  const states=[];const messages=[];
  const unsubscribeState=subscribePumpPortalRuntime((state)=>states.push(state));
  const unsubscribeMessages=subscribePumpPortalMessages((event)=>messages.push(event));
  ensurePumpPortalRuntime();
  assert.equal(MockWebSocket.instances.length,1);
  const first=MockWebSocket.instances[0];
  assert.equal(first.url,'wss://pumpportal.fun/api/data');
  first.open();
  assert.deepEqual(first.sent,[{method:'subscribeNewToken'}]);
  first.message({txType:'create',mint:'mint1',name:'Test Coin'});
  assert.equal(messages.length,1);
  assert.equal(states.at(-1)?.connected,true);

  const repeatedEnable=setPumpPortalRuntimeEnabled(true);
  assert.equal(repeatedEnable.status,'Connected · creations only');
  assert.equal(repeatedEnable.connected,true);
  assert.equal(MockWebSocket.instances.length,1);

  unsubscribeMessages();unsubscribeState();
  assert.equal(first.readyState,MockWebSocket.OPEN,'UI unmount must not close the shared socket');
  ensurePumpPortalRuntime();
  assert.equal(MockWebSocket.instances.length,1,'remount must reuse the existing live socket');

  setPumpPortalRuntimeEnabled(false);
  assert.equal(first.readyState,MockWebSocket.CLOSED);
  assert.equal(store.get('front.pumpPortalListenerEnabled.v2'),'false');
  setPumpPortalRuntimeEnabled(true);
  assert.equal(MockWebSocket.instances.length,2,'explicit restart creates one replacement socket');
  assert.equal(store.get('front.pumpPortalListenerEnabled.v2'),'true');
});
