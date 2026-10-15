import {test} from 'node:test';import assert from 'node:assert/strict';import {onPage,ensureTab,waitReply} from '../transport.js';
test('changing reasoning and JSON key order do not postpone a stable completed action',async()=>{
 const originalNow=Date.now;let clock=0,calls=0;Date.now=()=>clock;
 globalThis.chrome={runtime:{sendMessage:async()=>({ok:true})},scripting:{executeScript:async()=>{
  clock=calls++*1000;const json=calls%2?' {"request_id":"current","target":9}':' {"target":9,"request_id":"current"}';
  return [{result:{text:`reasoning ${calls}${json}`,busy:false,url:'https://www.kimi.com/chat/test'}}];
 }}};
 try{const out=await waitReply(2,{},'current','https://www.kimi.com/chat/test',()=>false,30);assert.equal(out.reply.target,9);assert.equal(calls,6)}finally{Date.now=originalNow}
});
test('a changing action resets confirmation and progress reports every read before a nonce exists',async()=>{
 const originalNow=Date.now;let clock=0,calls=0;const progress=[];Date.now=()=>clock;
 globalThis.chrome={runtime:{sendMessage:async()=>({ok:true})},scripting:{executeScript:async()=>{
  clock=calls++*1000;
  return [{result:{text:calls<=2?`thinking ${calls}`:JSON.stringify({request_id:'current',target:calls<5?3:9}),busy:false,url:'https://www.kimi.com/chat/test'}}];
 }}};
 try{const out=await waitReply(2,{},'current','https://www.kimi.com/chat/test',()=>false,30,()=>{},p=>progress.push(p));assert.equal(out.reply.target,9);assert.equal(calls,10);assert.equal(progress[1].receiving,true);assert.equal(progress[1].matched,false);assert.equal(progress[1].elapsed,1);assert.equal(progress.length,9)}finally{Date.now=originalNow}
});
test('page failures propagate and missing results cannot be interpreted as a reply',async()=>{
  globalThis.chrome={scripting:{executeScript:async()=>[{result:{error:'输入框必须唯一'}}]}};
  await assert.rejects(onPage(1,'send'),/必须唯一/);
  chrome.scripting.executeScript=async()=>[];await assert.rejects(onPage(1,'read'),/没有返回/);
});
test('a recycled tab ID is replaced by an exact conversation URL lookup',async()=>{
  const original='https://claude.ai/chat/original';let activated=null;
  globalThis.chrome={tabs:{get:async id=>({id,url:id===2?'https://claude.ai/chat/other':original,status:'complete'}),query:async()=>[{id:3,url:original}],update:async id=>{activated=id;}}};
  assert.equal(await ensureTab({id:1,url:original,tabId:2}),3);assert.equal(activated,3);
});
test('pause exits polling without sending or altering a reply',async()=>{
  let called=false;globalThis.chrome={scripting:{executeScript:async()=>{called=true;return [];}}};
  await assert.rejects(waitReply(1,{},'id','https://claude.ai/chat/id',()=>true,30),/暂停/);assert.equal(called,false);
});
test('opening a player in another browser window focuses the correct window',async()=>{
  let focused=null;const url='https://yuanbao.tencent.com/chat/test';
  globalThis.chrome={tabs:{get:async()=>({id:3,url,windowId:7,status:'complete'}),update:async()=>{}},windows:{update:async(id,options)=>{focused={id,options}}}};
  assert.equal(await ensureTab({id:1,url,tabId:3}),3);assert.deepEqual(focused,{id:7,options:{focused:true}});
});
test('background access wakes a discarded conversation without activating any tab or window',async()=>{
  const url='https://www.qianwen.com/chat/existing';let awake=false;const updates=[];
  globalThis.chrome={tabs:{get:async()=>({id:4,url,windowId:7,status:'complete',discarded:!awake}),reload:async id=>{assert.equal(id,4);awake=true},update:async(...args)=>updates.push(args)},windows:{update:async(...args)=>updates.push(args)}};
  assert.equal(await ensureTab({id:4,url,tabId:4},{background:true}),4);assert.equal(awake,true);assert.deepEqual(updates,[]);
});
test('a missing conversation opens in the background and mismatched addresses remain rejected',async()=>{
  const url='https://claude.ai/chat/saved';let created;
  globalThis.chrome={tabs:{query:async()=>[],create:async options=>{created=options;return {id:5,url,status:'complete'}},get:async()=>({id:5,url,status:'complete'}),update:async()=>{throw Error('No activation allowed')}}};
  assert.equal(await ensureTab({id:5,url},{background:true}),5);assert.equal(created.active,false);
  chrome.tabs.get=async()=>({id:5,url:'https://claude.ai/chat/wrong',status:'complete'});
  // The URL is checked again at every DOM operation and reply read, including after loading.
  chrome.scripting={executeScript:async({func,args})=>{
    const oldLocation=globalThis.location;globalThis.location={href:'https://claude.ai/chat/wrong'};
    try{return [{result:func(...args)}]}finally{globalThis.location=oldLocation}
  }};
  await assert.rejects(onPage(5,'send',{expectedUrl:url}),/地址与绑定地址不一致/);
});
test('render compatibility activates only the separate worker tab and never focuses its window',async()=>{
 const url='https://www.qianwen.com/chat/saved';let tab={id:4,url,windowId:7,status:'complete'},options;
 globalThis.chrome={tabs:{get:async()=>tab,getCurrent:async()=>({id:99,windowId:7}),update:async(id,opt)=>{assert.equal(tab.windowId,8);assert.equal(id,4);assert.equal(opt.active,true)}},windows:{create:async opt=>{options=opt;tab={...tab,windowId:8};return {id:8}},update:async()=>{throw Error('Must not focus window')}}};
 assert.equal(await ensureTab({id:4,url,tabId:4},{background:true,render:true}),4);
 assert.deepEqual(options,{tabId:4,focused:false});
});
test('a redirect to another conversation is rejected even if it has the same action ID',async()=>{
  globalThis.chrome={scripting:{executeScript:async()=>[{result:{text:'{"request_id":"id","target":1}',busy:false,url:'https://claude.ai/chat/other'}}]}};
  await assert.rejects(waitReply(1,{},'id','https://claude.ai/chat/id',()=>false,30),/地址发生变化/);
});
test('polling consumes a completed answer after reasoning examples without sending a new message',async()=>{
  const originalNow=Date.now;let clock=0,calls=0;
  Date.now=()=>clock;
  globalThis.chrome={scripting:{executeScript:async({args})=>{
    assert.equal(args[0],'read');assert.equal(args[1].requestId,'current');calls++;if(calls===2)clock=6000;
    return [{result:{text:'示例{"request_id":"...","target":null}\n{"request_id":"current","target":5}',busy:false,url:'https://www.kimi.com/chat/test'}}];
  }}};
  try{const result=await waitReply(10,{},'current','https://www.kimi.com/chat/test',()=>false,30);assert.equal(result.reply.target,5);assert.equal(calls,2)}finally{Date.now=originalNow}
});
test('a malformed current reply reports its state and explains the format problem at the reply deadline',async()=>{
  const originalNow=Date.now;let clock=0,calls=0;const statuses=[];
  Date.now=()=>clock;
  globalThis.chrome={scripting:{executeScript:async({args})=>{assert.equal(args[0],'read');calls++;if(calls===2)clock=240001;return [{result:{text:'{"request_id":"current" broken JSON}',busy:false,url:'https://claude.ai/chat/test'}}]}}};
  try{await assert.rejects(waitReply(5,{},'current','https://claude.ai/chat/test',()=>false,240,s=>statuses.push(s.kind)),/已读到本次回复.*无法识别/);assert.deepEqual(statuses,['invalid']);assert.equal(calls,2)}finally{Date.now=originalNow}
});
test('a stream can pause on incomplete JSON for more than ten seconds and still complete without a new message',async()=>{
  const originalNow=Date.now;let clock=0,calls=0;const statuses=[];
  Date.now=()=>clock;
  globalThis.chrome={scripting:{executeScript:async({args})=>{assert.equal(args[0],'read');calls++;clock=[0,15000,16000,22000][calls-1];return [{result:{text:calls<3?'{"request_id":"current","text":"still streaming':'{"request_id":"current","text":"complete","target":null}',busy:false,url:'https://gemini.google.com/app/test'}}]}}};
  try{const out=await waitReply(6,{},'current','https://gemini.google.com/app/test',()=>false,240,s=>statuses.push(s.kind));assert.equal(out.reply.text,'complete');assert.equal(calls,4);assert.deepEqual(statuses,['invalid','validating'])}finally{Date.now=originalNow}
});
test('a previous answer is reported as waiting and does not get mistaken for a malformed current answer',async()=>{
  const originalNow=Date.now;let clock=0,calls=0;const statuses=[];
  Date.now=()=>clock;
  globalThis.chrome={scripting:{executeScript:async()=>{calls++;if(calls===3)clock=6000;return [{result:{text:JSON.stringify({request_id:calls===1?'old':'current',target:5}),busy:false,url:'https://claude.ai/chat/test'}}]}}};
  try{const out=await waitReply(5,{},'current','https://claude.ai/chat/test',()=>false,240,s=>statuses.push(s.kind));assert.equal(out.reply.target,5);assert.deepEqual(statuses,['waiting','validating'])}finally{Date.now=originalNow}
});
test('a stable wrong UUID is diagnosed only when its answer belongs to the current question',async()=>{
 const expected='807fc476-7e92-4eac-82c8-19b592b6b240',wrong='807fc476-7e92-4eac-82c8-19b592b6b740';
 const originalNow=Date.now;let clock=0,calls=0;const statuses=[];Date.now=()=>clock;
 globalThis.chrome={scripting:{executeScript:async()=>{calls++;if(calls===2)clock=6000;return [{result:{text:JSON.stringify({request_id:wrong,target:1}),currentTurn:true,busy:false,url:'https://www.qianwen.com/chat/test'}}]}}};
 try{await assert.rejects(waitReply(4,{},expected,'https://www.qianwen.com/chat/test',()=>false,240,s=>statuses.push(s.kind)),error=>error.code==='REPLY_NONCE_MISMATCH'&&error.originalReply.target===1&&error.wrongRequestId===wrong);assert.deepEqual(statuses,['wrongId']);assert.equal(calls,2)}finally{Date.now=originalNow}
});
test('an active generation uses the same fixed timeout as a quiet page',async()=>{
 const originalNow=Date.now;let clock=0,calls=0;const statuses=[];Date.now=()=>clock;
 globalThis.chrome={scripting:{executeScript:async({args})=>{assert.equal(args[0],'read');clock=[0,31000,32000,38000][calls++];return [{result:{text:calls<3?'':'{"request_id":"current","target":1}',busy:calls<3,url:'https://zchat.z.ai/c/test'}}]}}};
 try{await assert.rejects(waitReply(9,{},'current','https://zchat.z.ai/c/test',()=>false,30,s=>statuses.push(s.message)),/统一的30秒等待时限/);assert.equal(calls,2);assert.ok(statuses.some(s=>s.includes('/ 30秒')))}finally{Date.now=originalNow}
});
test('a stuck generation indicator never extends the configured timeout',async()=>{
 const originalNow=Date.now;let clock=0,calls=0;Date.now=()=>clock;
 globalThis.chrome={scripting:{executeScript:async()=>{clock=[0,899000,901000][calls++];return [{result:{text:'',busy:true,url:'https://zchat.z.ai/c/test'}}]}}};
 try{await assert.rejects(waitReply(9,{},'current','https://zchat.z.ai/c/test',()=>false,30),/统一的30秒等待时限/);assert.equal(calls,2)}finally{Date.now=originalNow}
});
test('a short prompt or partial code line cannot mask a complete current answer in other DOM candidates',async()=>{
  const originalNow=Date.now;let clock=0,calls=0;
  Date.now=()=>clock;
  globalThis.chrome={scripting:{executeScript:async({args})=>{assert.equal(args[0],'read');calls++;if(calls===2)clock=6000;
    return [{result:{text:'current {"request_id":"填写本次行动编号","target":null}',texts:['current {"request_id":"填写本次行动编号","target":null}','{"request_id":"current",','{"request_id":"current","text":"这是实际的完整回答","target":null}'],busy:false,url:'https://zchat.z.ai/c/test'}}];
  }}};
  try{const out=await waitReply(9,{},'current','https://zchat.z.ai/c/test',()=>false,30);assert.equal(out.reply.text,'这是实际的完整回答');assert.equal(calls,2)}finally{Date.now=originalNow}
});
