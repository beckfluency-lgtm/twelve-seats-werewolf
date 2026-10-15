import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {backgroundDelay} from '../scheduler.js';
test('game delays use the extension worker, validate senders and cannot request unbounded worker timers',async()=>{
 let listener;const timers=[];
 const runtime={id:'own',getURL:path=>'chrome-extension://own/'+path,onMessage:{addListener:fn=>{listener=fn}}};
 vm.runInNewContext(await readFile(new URL('../background.js',import.meta.url),'utf8'),{chrome:{runtime,action:{onClicked:{addListener(){}}}},setTimeout:(fn,ms)=>{timers.push(ms);fn()}});
 let sender={id:'own',url:'chrome-extension://own/dashboard.html'};
 globalThis.chrome={runtime:{sendMessage:message=>new Promise(resolve=>listener(message,sender,resolve))}};
 await backgroundDelay(1000);assert.deepEqual(timers,[1000]);
 await assert.rejects(backgroundDelay(6000),/后台计时器未就绪/);assert.deepEqual(timers,[1000]);
 sender={id:'other',url:'https://zchat.z.ai/c/test'};await assert.rejects(backgroundDelay(1000),/后台计时器未就绪/);assert.deepEqual(timers,[1000]);
});
