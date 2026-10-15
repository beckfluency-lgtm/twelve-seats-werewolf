import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
async function fixture(){
 const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href}));
 const record={actor:4,requestId:'correct',url:seats[3].url,config:{input:'i',reply:'r',send:'s'},status:'sent'};
 const state={seats,game:null,transport:record,settings:{timeout:240,discard:false,memory:true,background:true}};
 const original={request_id:'wrong',text:'我投1号',target:1},operations=[];let durable=null;
 const error=()=>Object.assign(new Error('Wrong nonce'),{code:'REPLY_NONCE_MISMATCH',wrongRequestId:'wrong',originalReply:original});
 let reads=0;
 const context=vm.createContext({...core,document,console,URL,structuredClone,setTimeout:fn=>setImmediate(fn),Option:class{constructor(text,value){this.text=text;this.value=value}},
  chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async value=>{durable=structuredClone(value.werewolf)}}},tabs:{query:async()=>[]}},ensureTab:async()=>4,
  waitReply:async()=>{if(++reads===1)throw error();return {reply:{...original,request_id:'correct'}}},
  onPage:async(id,op,data)=>{assert.equal(durable.transport.nonceRepair.status,'preparing');assert.equal(data.expectedUrl,record.url);assert.ok(data.prompt.includes('只更正request_id'));operations.push(op);return {clicked:true,filled:true}}});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 return {context,record,operations,error,original};
}
test('a nonce clarification is saved before sending and is never repeated when reading resumes',async()=>{
 const {context,record,operations}=await fixture();const out=await context.readRecord(record);
 assert.equal(out.reply.target,1);assert.equal(out.reply.request_id,'correct');assert.equal(record.requestId,'correct');assert.equal(record.nonceRepair.status,'sent');assert.deepEqual(operations,['send','clickSend']);
 await context.readRecord(record);assert.equal(operations.length,2);
});
test('a clarification cannot change the original action and repeated wrong IDs cannot trigger another message',async()=>{
 const {context,record,operations,error,original}=await fixture();await context.readRecord(record);
 context.waitReply=async()=>({reply:{...original,request_id:'correct',target:2}});
 await assert.rejects(context.readRecord(record),/改变了原回复内容/);assert.equal(operations.length,2);
 context.waitReply=async()=>{throw error()};await assert.rejects(context.readRecord(record),/已请求更正一次/);assert.equal(operations.length,2);
});
