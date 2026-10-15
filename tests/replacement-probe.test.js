import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
test('reset clears old probes and native-only providers fail before creating a send record',async()=>{
 const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const state={seats:core.defaultSeats(),game:{winner:'好人',players:core.defaultSeats(),log:[]},adapters:{deepseek:{input:'textarea',send:'s',reply:'r'}},settings:{timeout:240,discard:false,memory:true,background:true},replacementProbe:{actor:5,provider:'deepseek',requestId:'old',url:'https://chat.deepseek.com/a/chat/s/old'},suspendedTransport:{requestId:'old'},lastError:{kind:'replacement'},abandonedReplies:{5:{}},recoveryHistory:[{}]};
 let pageCalls=0;
 const context=vm.createContext({...core,document,console,setTimeout,URL,confirm:()=>true,Option:class{constructor(text,value){this.text=text;this.value=value}},chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async()=>{}}},tabs:{query:async()=>[]}},ensureTab:async()=>{pageCalls++;throw Error('Unexpected page access')},onPage:async()=>{pageCalls++;throw Error('Unexpected page access')}});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 await nodes.get('reset').onclick();for(const key of ['replacementProbe','suspendedTransport','lastError','abandonedReplies','recoveryHistory'])assert.equal(state[key],undefined);assert.ok(state.adapters.deepseek);assert.equal(state.game,null);
 assert.equal(context.normalizeAdapter('deepseek',{nativeSend:true}).nativeSend,false);
 state.adapters.deepseek.inputMode='native';
 nodes.get('replacement-seat').value='5';nodes.get('replacement-provider').value='deepseek';nodes.get('replacement-url').value='https://chat.deepseek.com/a/chat/s/new';
 await nodes.get('testReplacement').onclick();assert.match(nodes.get('notice').textContent,/真实键盘辅助/);assert.equal(pageCalls,0);assert.equal(state.replacementProbe,undefined);
});
test('initialization follows a generated chat URL only in the original tab with the saved nonce and a unique provider-matching URL',async()=>{
  const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
  const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,core.PROVIDERS[s.provider].home).href}));
  seats[8]={...seats[8],provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/occupied'};
  const state={seats,game:null,adapters:{},settings:{timeout:240,discard:false,memory:true}};
  let snapshot={present:false,url:'https://yuanbao.tencent.com/chat/new/stable'},readIds=[];
  const context=vm.createContext({...core,document,console,setTimeout,URL,Option:class{constructor(text,value){this.text=text;this.value=value}},
    chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async()=>{}}},tabs:{query:async()=>[],get:async id=>{readIds.push(id);return {id}}}},onPage:async(id,op)=>{assert.equal(id,43);assert.equal(op,'hasRequest');return snapshot;}});
  vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
  const record={actor:1,provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/new',tabId:43,requestId:'saved-id'};
  await assert.rejects(context.resolveReplacementTab(record),/原接入编号/);assert.equal(record.url,'https://yuanbao.tencent.com/chat/new');
  snapshot={present:true,url:seats[8].url};await assert.rejects(context.resolveReplacementTab(record),/其他玩家/);
  snapshot={present:true,url:'https://claude.ai/chat/other'};await assert.rejects(context.resolveReplacementTab(record),/平台不匹配/);
  snapshot={present:true,url:'https://yuanbao.tencent.com/chat/new/stable'};assert.equal(await context.resolveReplacementTab(record),43);
  assert.equal(record.url,snapshot.url);assert.ok(readIds.every(id=>id===43));
});
