import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {pulsePage,protectTab,releasePage} from '../render-assist.js';
function page(url='https://zchat.z.ai/c/test'){
 let now=0,next=0;const frames=new Map(),errors=[];
 const window={requestAnimationFrame:callback=>{frames.set(++next,callback);return next},cancelAnimationFrame:id=>frames.delete(id),reportError:error=>errors.push(error)};
 const timers=new Map();window.setTimeout=(fn,ms,...args)=>{timers.set(++next,{fn,ms,args});return next};window.clearTimeout=id=>timers.delete(id);
 const native=window.requestAnimationFrame,document={visibilityState:'hidden',hidden:true,hasFocus:()=>false,events:[],dispatchEvent(event){this.events.push(event.type)}};
 const context=vm.createContext({window,document,performance:{now:()=>now},location:{href:url,hostname:new URL(url).hostname},URL,Map,Event});
 globalThis.chrome={scripting:{executeScript:async options=>{assert.equal(options.world,'MAIN');context.args=options.args;return [{result:vm.runInContext(`(${options.func.toString()})(...args)`,context)}]}}};
 return {window,document,frames,native,timers,errors,set now(value){now=value}};
}
test('hidden-page pulses run stalled frames once, preserve cancellation and bound recursive work',async()=>{
 const p=page();await pulsePage(9,'https://zchat.z.ai/c/test');let count=0;
 const id=p.window.requestAnimationFrame(()=>count++);p.now=100;await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,0);
 p.now=1000;const result=await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,1);assert.equal(result.assisted,1);assert.equal(p.frames.has(id),false);assert.equal(result.focused,false);
 await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,1);
 const canceled=p.window.requestAnimationFrame(()=>count++);p.window.cancelAnimationFrame(canceled);p.now=2000;await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,1);
 const recursive=()=>{count++;p.window.requestAnimationFrame(recursive)};p.window.requestAnimationFrame(recursive);p.now=3000;await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,2);
 p.now=4000;await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,3);
 await releasePage(9,'https://zchat.z.ai/c/test');assert.equal(p.window.requestAnimationFrame,p.native);
});

test('only ChatGLM short typewriter timers catch up, stay bounded, cancel once, and restore native timers',async()=>{
 const url='https://chatglm.cn/main/test',p=page(url),native=p.window.setTimeout;await pulsePage(9,url);let count=0;
 const typeWritterId=1,answerListDisplay=[];
 const typing=()=>{if(typeWritterId&&answerListDisplay){count++;p.window.setTimeout(typing,30)}};
 const canceled=p.window.setTimeout(typing,30);p.window.clearTimeout(canceled);
 p.window.setTimeout(()=>{throw Error('ordinary timer must remain native')},30);
 p.window.setTimeout(typing,30);p.now=1000;const first=await pulsePage(9,url);assert.equal(count,33);assert.equal(first.typingAssisted,33);
 p.now=100000;await pulsePage(9,url);assert.equal(count,113);
 const remaining=[...p.timers.values()].find(e=>e.fn.toString().includes('pending.delete'));remaining.fn();assert.equal(count,114);remaining.fn();assert.equal(count,114);
 await releasePage(9,url);assert.equal(p.window.setTimeout,native);
});

test('ChatGLM presentation stays awake without focus, physical hidden frames still flush, and release restores descriptors',async()=>{
 const url='https://chatglm.cn/main/test',p=page(url);
 const visibility=Object.getOwnPropertyDescriptor(p.document,'visibilityState'),hidden=Object.getOwnPropertyDescriptor(p.document,'hidden');
 await pulsePage(9,url);assert.equal(p.document.visibilityState,'visible');assert.equal(p.document.hidden,false);assert.equal(p.document.hasFocus(),false);
 let count=0;p.window.requestAnimationFrame(()=>count++);p.now=1000;
 const health=await pulsePage(9,url);assert.equal(count,1);assert.equal(health.visibility,'hidden');assert.equal(health.presentationAwake,true);assert.deepEqual(p.document.events,['visibilitychange']);
 await assert.rejects(pulsePage(9,'https://chatglm.cn/main/other'),/绑定对话不一致/);
 await releasePage(9,url);assert.deepEqual(Object.getOwnPropertyDescriptor(p.document,'visibilityState'),visibility);assert.deepEqual(Object.getOwnPropertyDescriptor(p.document,'hidden'),hidden);assert.deepEqual(p.document.events,['visibilitychange','visibilitychange']);
 await pulsePage(9,url);assert.equal(p.document.hidden,false);await releasePage(9,url);assert.equal(p.document.hidden,true);
});
test('foreground animation stays native and another conversation is never modified',async()=>{
 const p=page();p.document.visibilityState='visible';await pulsePage(9,'https://zchat.z.ai/c/test');let count=0;
 const id=p.window.requestAnimationFrame(()=>count++);p.now=1000;await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,0);p.frames.get(id)(1000);assert.equal(count,1);await pulsePage(9,'https://zchat.z.ai/c/test');assert.equal(count,1);
 const before=p.window.requestAnimationFrame;await assert.rejects(pulsePage(9,'https://zchat.z.ai/c/other'),/目标与绑定对话不一致/);assert.equal(p.window.requestAnimationFrame,before);
});
test('only the owned active tab is protected and its previous discard setting is restored',async()=>{
 const p=page(),updates=[];chrome.runtime={id:'own'};chrome.tabs={get:async id=>({id,autoDiscardable:false}),update:async(id,options)=>updates.push({id,...options})};
 await protectTab(9);await releasePage(9,'https://zchat.z.ai/c/test');assert.deepEqual(updates,[{id:9,autoDiscardable:false},{id:9,autoDiscardable:false}]);
});
