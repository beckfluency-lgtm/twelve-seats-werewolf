import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
test('switching another seat suspends its existing reply and restores it without sending again',async()=>{
  const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
  const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,core.PROVIDERS[s.provider].home).href})),game=core.newGame(seats,()=>.999);
  for(let i=0;i<24;i++){const t=core.nextTask(game);core.acceptReply(game,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}
  const pending=core.nextTask(game);
  let stored={seats,game,adapters:{},settings:{timeout:240,discard:false,memory:true},probe:null,transport:{actor:12,requestId:pending.id,status:'sent',url:seats[11].url,prompt:'Existing guard prompt',config:{reply:'.reply'}}};
  const original=structuredClone(stored.transport);let sends=0,reads=0;
  const context=vm.createContext({...core,document,console,setTimeout,URL,structuredClone,Option:class{constructor(text,value){this.text=text;this.value=value}},
    chrome:{storage:{local:{get:async()=>({werewolf:stored}),set:async value=>{if(value.werewolf)stored=value.werewolf}}},tabs:{query:async()=>seats.map((s,i)=>({id:i+1,url:s.url,title:'seat '+s.id}))}},
    onPage:async()=>{sends++;throw Error('A saved request must not be resent')},ensureTab:async()=>12,waitReply:async(tab,config,id)=>{reads++;return {reply:{request_id:id,target:12}}}});
  vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);
  await new Promise(resolve=>setImmediate(resolve));
  document.getElementById('replacement-seat').value='1';document.getElementById('replacement-provider').value='yuanbao';document.getElementById('replacement-url').value='https://yuanbao.tencent.com/chat/new-one';
  await context.applyReplacement();
  assert.equal(stored.transport,null);assert.deepEqual(stored.suspendedTransport,original);
  for(const kind of ['intro','identity','catchup']){const t=core.nextTask(stored.game);assert.equal(t.kind,kind);core.acceptReply(stored.game,{request_id:t.id,text:kind==='intro'?'规则已理解':kind==='identity'?'身份已收到':'进度已收到',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false});}
  await nodes.get('step').onclick();
  assert.equal(sends,0);assert.equal(reads,1);assert.equal(stored.transport,null);assert.equal(stored.suspendedTransport,null);assert.equal(stored.game.night.guard,12);
});
