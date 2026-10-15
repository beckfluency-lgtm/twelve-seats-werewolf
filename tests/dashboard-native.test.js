import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

test('restoring a native draft stays disarmed; continuous run arms it and pause revokes it without sending',async()=>{
  const nodes=new Map();
  function node(){return {value:'',checked:false,disabled:false,children:[],append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},add(item){this.children.push(item)}};}
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
  const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,core.PROVIDERS[s.provider].home).href}));
  const game=core.newGame(seats),task=core.nextTask(game);
  const state={seats,game,adapters:{deepseek:{input:'i',send:'s',reply:'r'}},settings:{timeout:240,discard:false,memory:true,background:false},probe:null,
    transport:{actor:1,requestId:task.id,status:'draft',url:seats[0].url,prompt:core.promptFor(game,task),config:{nativeSend:true}}};
  let webpageOperations=0;
  const context=vm.createContext({...core,document,console,setTimeout,URL,Option:class{constructor(text,value){this.text=text;this.value=value}},
    chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async()=>{}}},tabs:{query:async()=>[{id:17,url:seats[0].url,title:'A changed conversation title'}]}},
    onPage:async()=>{webpageOperations++;throw Error('Unexpected webpage operation')},ensureTab:async()=>{webpageOperations++},waitReply:async()=>{webpageOperations++}});
  const source=(await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  const connection=()=>JSON.parse(nodes.get('nativeBindings').value);
  assert.equal(context.normalizeAdapter('kimi',{reply:'.chat-content-item-assistant'}).reply,'.chat-content-item-assistant .markdown-container');
  assert.equal(context.normalizeAdapter('kimi',{reply:'.custom-final-answer'}).reply,'.custom-final-answer');
  assert.equal(context.normalizeAdapter('chatglm',{send:core.LEGACY_BACKUP_SEND,tested:true}).send,'.enter-icon-container .enter_icon');
  assert.equal(context.normalizeAdapter('chatglm',{send:'.custom-verified-send'}).send,'.custom-verified-send');
  assert.equal(context.normalizeAdapter('spark',{send:'div[class*="AskWindow_send"] img[alt="发送"],div[class*="AskWindow_send"]:not(:has(img)),button[aria-label="发送"]'}).send,'#ask_window_send_btn');
  assert.equal(context.normalizeAdapter('spark',{send:'.custom-send'}).send,'.custom-send');
  assert.equal(connection().armed,false);
  assert.equal(connection().tabName,'A changed conversation title');
  await nodes.get('openNativeTarget').onclick();
  assert.equal(webpageOperations,0);
  await nodes.get('run').onclick();
  assert.equal(connection().armed,true);
  assert.match(nodes.get('notice').textContent,/1号消息已准备/);
  nodes.get('pause').onclick();
  assert.equal(connection().armed,false);
  await nodes.get('openNativeTarget').onclick();
  assert.equal(webpageOperations,0);
  assert.equal(state.transport.requestId,task.id);
});
