import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
test('delivery boundaries are saved before UI send and committed only after a valid reply, including resumed reads',async()=>{
  const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
  const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,core.PROVIDERS[s.provider].home).href})),game=core.newGame(seats,()=>.999);
  game.day=1;game.phase='speech';game.log=[{day:1,text:'本次需要送达的原文',privateTo:null}];game.queue=[];game.pending={id:'current',actor:5,kind:'speech'};
  const state={seats,game,adapters:{claude:{input:'.input',send:'.send',reply:'.reply'}},settings:{timeout:240,discard:false,memory:true},probe:null,transport:null};
  let durable=null,fills=0,clicks=0;
  const context=vm.createContext({...core,document,console,setTimeout,URL,structuredClone,Option:class{constructor(text,value){this.text=text;this.value=value}},
    chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async value=>{if(value.werewolf)durable=structuredClone(value.werewolf)}}},tabs:{query:async()=>seats.map((s,i)=>({id:i+1,url:s.url,title:'seat '+s.id}))}},
    ensureTab:async()=>5,
    onPage:async(id,operation)=>{if(operation==='inspect')return {url:seats[4].url,inputs:1,count:1};if(operation==='send'){fills++;assert.equal(durable.transport.delivery.log,1);assert.equal(durable.transport.delivery.notes,0);return {filled:true}}if(operation==='clickSend'){clicks++;return {clicked:true}}throw Error('Unexpected operation')},
    waitReply:async()=>({reply:{request_id:'current',text:'',target:null}})});
  vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
  await nodes.get('step').onclick();assert.equal(game.players[4].delivery.log,0);assert.equal(state.transport.status,'sent');
  assert.ok(durable.transport.prompt.includes('本次需要送达的原文'));assert.ok(!durable.transport.prompt.includes(core.RULES));
  context.waitReply=async()=>({reply:{request_id:'current',text:'5号的实际发言',target:null}});
  await nodes.get('readPending').onclick();assert.equal(game.players[4].delivery.log,1);assert.equal(state.transport,null);assert.equal(fills,1);assert.equal(clicks,1);
  assert.ok(!core.messageFor(game,{id:'next',actor:5,kind:'speech'}).prompt.includes('本次需要送达的原文'));
});
