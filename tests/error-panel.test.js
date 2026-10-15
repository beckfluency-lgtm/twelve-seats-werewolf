import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import * as core from '../core.js';
test('errors persist the actual seat and action, survive refresh, and open its conversation only on explicit click',async()=>{
 const nodes=new Map(),node=()=>({value:'',checked:false,disabled:false,hidden:true,textContent:'',children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},add(x){this.children.push(x)}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href}));seats[8].provider='zai';seats[8].url='https://zchat.z.ai/c/seat9';
 const game=core.newGame(seats);game.pending={id:'pending',actor:9,kind:'vote'};
 const record={actor:9,requestId:'pending',url:seats[8].url,status:'sent',config:{}};
 const state={seats,game,transport:record,settings:{timeout:240,discard:false,memory:true,background:true}};
 const opens=[];let saved;
 const context=vm.createContext({...core,document,console,URL,structuredClone,setTimeout,Option:class{constructor(text,value){this.text=text;this.value=value}},
  chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async value=>{saved=structuredClone(value.werewolf)}}},tabs:{query:async()=>[]}},
  ensureTab:async(player,options)=>{opens.push({player,options});return 9}});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 const fail=vm.runInContext("safe(async()=>{throw Error('等待回复超时')})",context);await fail();
 assert.equal(nodes.get('errorPanel').hidden,false);assert.match(nodes.get('errorTitle').textContent,/9号.*Z.ai.*投票/);assert.equal(nodes.get('errorDetails').textContent,'等待回复超时');assert.equal(saved.lastError.requestId,'pending');assert.equal(opens.length,0);
 assert.match(nodes.get('notice').textContent,/9号.*Z.ai.*等待回复超时/);
 context.render();assert.equal(nodes.get('errorPanel').hidden,false);
 await nodes.get('openErrorSeat').onclick();assert.equal(opens.length,1);assert.equal(opens[0].player.url,seats[8].url);assert.equal(opens[0].options,undefined);assert.equal(record.status,'sent');
 assert.equal(nodes.has('dismissError'),false);assert.equal(state.transport,record);
});
