import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
function game(){const g=core.newGame(core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href})),()=>.999);g.day=2;g.phase='night';g.queue=[];g.night={guard:null,save:false,poison:null,wolfVotes:{1:5},wolfTalk:[],kill:5};return g}
test('retry invalidates late replies and preserves roles, decisions and delivery positions',()=>{
 const g=game();g.phase='vote';g.pending={id:'old',actor:9,kind:'vote'};const roles=g.players.map(p=>p.role),positions=structuredClone(g.players.map(p=>p.delivery));
 const ids=core.retryPending(g);assert.equal(ids.oldId,'old');assert.notEqual(ids.newId,'old');assert.equal(g.pending.id,ids.newId);assert.deepEqual(g.players.map(p=>p.role),roles);assert.deepEqual(g.players.map(p=>p.delivery),positions);
 assert.throws(()=>core.acceptReply(g,{request_id:'old',target:1}),/编号不符/);assert.deepEqual(g.votes,{});
 core.acceptReply(g,{request_id:ids.newId,target:1});assert.equal(g.votes[9],1);
});
test('skipping each action applies only non-action semantics and never invents an AI reply',()=>{
 for(const kind of ['speech','wolfTalk','vote','guard','wolfKill','seer','witch','hunter']){
  const g=game();g.pending={id:'old',actor:kind==='wolfKill'||kind==='wolfTalk'?2:9,kind};const potions=structuredClone(g.potions),alive=g.players.map(p=>p.alive),delivery=structuredClone(g.players.map(p=>p.delivery));g.lastGuard=5;
  core.skipPending(g);assert.equal(g.pending,null);assert.deepEqual(g.potions,potions);assert.deepEqual(g.players.map(p=>p.alive),alive);assert.deepEqual(g.players.map(p=>p.delivery),delivery);assert.ok(g.log.at(-1).text.startsWith('用户跳过'));assert.ok(g.players.every(p=>p.notes.length===0));
  if(kind==='vote'){assert.equal(g.votes[9],null);assert.deepEqual(g.log.at(-1).privateTo,[9])}
  if(kind==='guard'){assert.equal(g.night.guard,null);assert.equal(g.lastGuard,null)}
  if(kind==='wolfKill'){assert.equal(g.night.wolfVotes[2],null);assert.equal(g.night.kill,5)}
  if(kind==='wolfTalk')assert.deepEqual(g.night.wolfTalk,[]);
  const restored=JSON.parse(JSON.stringify(g));assert.equal(restored.pending,null);
 }
 for(const kind of ['intro','identity','catchup']){const g=game();g.pending={id:'old',actor:9,kind};assert.throws(()=>core.skipPending(g),/不能跳过/);assert.equal(g.pending.id,'old')}
});
async function fixture(){
 const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,hidden:true,textContent:'',children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const g=game();g.phase='vote';g.players[8].provider='zai';g.players[8].url='https://zchat.z.ai/c/seat9';g.pending={id:'old',actor:9,kind:'vote'};
 const prompt=core.promptFor(g,g.pending),record={actor:9,requestId:'old',url:g.players[8].url,status:'sent',prompt,config:{input:'i',send:'s',reply:'r'},delivery:{version:1,conversation:core.conversationKey(g.players[8].url),log:g.log.length,notes:0}};
 const state={seats:g.players.map(p=>({...p})),game:g,transport:record,lastError:{actor:9,requestId:'old',provider:'zai',url:record.url,message:'超时',kind:'vote'},adapters:{zai:record.config},settings:{timeout:240,discard:false,memory:true,background:true}};
 const operations=[];let durable,resumes=0,reads=0;
 const context=vm.createContext({...core,document,console,URL,structuredClone,setTimeout:fn=>setImmediate(fn),Option:class{constructor(text,value){this.text=text;this.value=value}},
  chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async value=>{durable=structuredClone(value.werewolf)}}},tabs:{query:async()=>[]}},ensureTab:async()=>9,
  onPage:async(id,op,data)=>{operations.push(op);if(op==='read')return {busy:++reads===1,url:record.url};if(op==='inspect')return {url:record.url,inputs:1,count:1};if(op==='send'){assert.equal(durable.transport.requestId,g.pending.id);assert.equal(durable.recoveryHistory[0].requestId,'old');assert.ok(!data.prompt.includes('本次行动编号 old'));assert.equal(data.replaceDraft,prompt)}return {filled:true,clicked:true}},
  waitReply:async()=>({reply:{request_id:g.pending.id,target:1}})});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));context.launch=async()=>{resumes++};
 return {context,nodes,state,g,record,operations,get resumes(){return resumes}};
}
test('explicit resend stops the old generation, persists a new nonce before sending and ignores duplicate clicks',async()=>{
 const f=await fixture();const first=f.nodes.get('resendError').onclick(),duplicate=f.nodes.get('resendError').onclick();await Promise.all([first,duplicate]);
 assert.equal(f.operations.filter(op=>op==='stopGeneration').length,1);assert.equal(f.operations.filter(op=>op==='send').length,1);assert.equal(f.operations.filter(op=>op==='clickSend').length,1);assert.equal(f.resumes,1);assert.equal(f.g.votes[9],1);assert.equal(f.state.transport,null);assert.equal(f.state.recoveryHistory[0].operation,'resend');assert.notEqual(f.state.recoveryHistory[0].newRequestId,'old');
});
test('explicit skip abstains once, archives the old transport and never sends any webpage message',async()=>{
 const f=await fixture();await f.nodes.get('skipError').onclick();assert.equal(f.g.votes[9],null);assert.equal(f.g.pending,null);assert.equal(f.state.transport,null);assert.equal(f.state.recoveryHistory[0].transport.requestId,'old');assert.equal(f.resumes,1);assert.deepEqual(f.operations,[]);
 await f.nodes.get('skipError').onclick();assert.equal(f.state.recoveryHistory.length,1);assert.equal(f.resumes,1);
});
test('stale error controls cannot affect a new task, and identity acknowledgement cannot be skipped',async()=>{
 const f=await fixture();f.g.pending.id='newer';f.context.render();assert.equal(f.nodes.get('resendError').disabled,true);assert.equal(f.nodes.get('skipError').disabled,true);await f.nodes.get('resendError').onclick();assert.equal(f.operations.length,0);assert.equal(f.g.pending.id,'newer');
 f.g.pending.kind='identity';f.state.lastError={actor:9,requestId:'newer'};f.context.render();assert.equal(f.nodes.get('skipError').disabled,true);
});
test('skip during a live wait drains the old reader and discards even a simultaneously arriving valid reply',async()=>{
 const f=await fixture();delete f.state.lastError;const before=structuredClone(f.g.players[8].delivery);
 let release,start,checkStop;const started=new Promise(resolve=>{start=resolve});
 f.context.waitReply=async(...args)=>new Promise(resolve=>{checkStop=args[4];release=()=>resolve({reply:{request_id:'old',target:1}});start()});
 const reading=f.nodes.get('readPending').onclick();await started;
 assert.equal(f.nodes.get('waitActions').hidden,false);assert.equal(f.nodes.get('skipWaiting').disabled,false);
 const skipping=f.nodes.get('skipWaiting').onclick(),duplicate=f.nodes.get('skipWaiting').onclick();assert.equal(checkStop(),true);release();
 await Promise.all([reading,skipping,duplicate]);
 assert.equal(f.g.votes[9],null);assert.equal(f.g.pending,null);assert.deepEqual(f.g.players[8].delivery,before);assert.equal(f.state.lastError,undefined);assert.equal(f.state.recoveryHistory.length,1);assert.equal(f.resumes,1);
 assert.equal(f.nodes.get('waitActions').hidden,true);assert.equal(f.state.abandonedReplies[9].requestId,'old');
});
test('context batches survive a failed read, commit only an actual acknowledgement and never count as game actions',async()=>{
 const f=await fixture();f.g.phase='speech';f.g.pending={id:'speech-task',actor:9,kind:'speech'};f.state.transport=null;delete f.state.lastError;f.g.log=[];
 for(let i=0;i<80;i++)f.g.log.push({text:`第${i}条公开原文`+'内容'.repeat(150),privateTo:null});
 let fills=0;
 f.context.onPage=async(id,op,data)=>{if(op==='inspect')return {url:f.g.players[8].url,inputs:1,count:1};if(op==='send'){fills++;assert.ok(data.prompt.length<=5000)}return {filled:true,clicked:true}};
 f.context.waitReply=async()=>{throw Error('等待回复超时')};
 await assert.rejects(f.context.step(),/超时/);const pending=f.state.transport;assert.equal(pending.kind,'context');assert.equal(pending.taskId,'speech-task');assert.equal(f.g.players[8].delivery.log,0);
 f.context.waitReply=async()=>({reply:{request_id:pending.requestId,text:'记录已收到'}});
 await f.nodes.get('readPending').onclick();assert.equal(fills,1);assert.equal(f.state.transport,null);assert.equal(f.g.pending.id,'speech-task');assert.equal(f.g.players[8].delivery.log,pending.delivery.log);assert.ok(pending.delivery.log<80);
});
