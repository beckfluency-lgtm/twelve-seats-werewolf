import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

test('all normal game adapters route sends and reads through background access without focusing windows',async()=>{
 const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href}));
 const state={seats,game:null,adapters:{},settings:{timeout:240,discard:true,memory:true,background:true}};
 const operations=[],opened=[],discarded=[];let saved=null;
 const context=vm.createContext({...core,document,console,URL,structuredClone,setTimeout:fn=>setImmediate(fn),Option:class{constructor(text,value){this.text=text;this.value=value}},
  chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async value=>{saved=structuredClone(value.werewolf)}}},tabs:{query:async()=>[],update:async()=>{throw Error('Must not activate tabs')},discard:async id=>discarded.push(id)}},
  ensureTab:async(player,options)=>{assert.equal(options.background,true);assert.equal(options.render,true);opened.push(player.provider);return player.id},
  onPage:async(id,operation,data)=>{
   operations.push(operation);
   if(operation==='inspect')return {url:state.seats[0].url,inputs:1,count:1};
   assert.equal(data.expectedUrl,state.seats[0].url);
   assert.equal(saved.probe.requestId,'current');
   if(operation==='clickSend')assert.equal(data.requestId,'current');
   return {filled:true,clicked:true};
  },waitReply:async()=>({reply:{request_id:'current',text:'就绪'}})});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);
 await new Promise(resolve=>setImmediate(resolve));
 for(const provider of ['qianwen','yuanbao','zai','kimi','doubao','claude','gemini','mistral','grok','chatgpt']){
  const player={id:1,provider,url:new URL('/conversation/seat-1',core.PROVIDERS[provider].home).href};state.seats[0]=player;
  const config=context.normalizeAdapter(provider,{input:'i',send:'s',reply:'r',nativeSend:provider==='qianwen'});
  if(provider==='qianwen'){assert.equal(config.nativeSend,false);assert.equal(config.inputMode,'slatePaste')}
  const record=await context.prepareSend(player,config,'original saved prompt','current','probe');
  await context.readRecord(record);await context.lowMemory(1);
 }
 assert.equal(opened.length,20);assert.equal(discarded.length,10);
 assert.deepEqual(operations.filter(op=>op==='clickSend').length,10);
 const before=operations.length;
 await assert.rejects(context.prepareSend({id:1,provider:'deepseek',url:seats[0].url},{nativeSend:true},'p','new','probe'),/后台模式已暂停/);
 assert.equal(operations.length,before);
 // Releasing the active worker tab parks only its own window before discarding it.
 const releases=[];
 context.chrome.tabs.get=async()=>({id:1,active:true,windowId:8});
 context.chrome.tabs.getCurrent=async()=>({id:99,windowId:7});
 context.chrome.tabs.create=async options=>{releases.push(options);return {id:100}};
 await context.lowMemory(1);
 assert.equal(releases[0].windowId,8);assert.equal(releases[0].url,'about:blank#werewolf-idle');
 assert.equal(releases[0].active,true);assert.equal(discarded.length,11);
});
