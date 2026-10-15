import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import * as core from '../core.js';
test('a clean browser has every preset and can prepare a game without any developer settings',async()=>{
 const nodes=new Map(),node=()=>({value:'',checked:false,children:[],append(...x){this.children.push(...x)},replaceChildren(...x){this.children=[...x]},add(x){this.children.push(x)},setAttribute(){}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[]};
 const writes=[];const context=vm.createContext({...core,document,URL,console,setTimeout,structuredClone,Option:class{},chrome:{storage:{local:{get:async()=>({}),set:async value=>writes.push(value)}},tabs:{query:async()=>[]}}});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(r=>setImmediate(r));
 assert.equal(nodes.get('bindings').children.length,12);
 const initial=vm.runInContext('state',context);assert.ok(initial.seats.every(s=>s.url===''&&s.tabId===null));assert.equal(initial.game,null);
 for(const id of Object.keys(core.PROVIDERS)){const cfg=context.configured(id);assert.ok(cfg.input&&cfg.send&&cfg.reply,id);assert.equal(cfg.nativeSend,false,id);assert.equal(cfg.confirmSubmission,true,id);}
 await assert.rejects(context.createGame(),/独立对话/);
 for(const s of initial.seats)s.url=new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href;
 await context.createGame();assert.equal(initial.game.phase,'setup');assert.equal(initial.game.players.length,12);assert.equal(initial.game.rulesVersion,2);assert.ok(writes.some(v=>v.werewolf?.game));
});

test('opening the extension icon reuses its dashboard and coalesces simultaneous clicks',async()=>{
 let click;const created=[],activated=[],focused=[];let tabs=[];
 const chrome={action:{onClicked:{addListener:fn=>{click=fn}}},runtime:{getURL:file=>'chrome-extension://own/'+file,onMessage:{addListener(){}}},tabs:{query:async()=>tabs,create:async opt=>{created.push(opt);tabs=[{id:7,windowId:3,url:opt.url+'?build=example'}]},update:async(id,opt)=>activated.push({id,...opt})},windows:{update:async(id,opt)=>focused.push({id,...opt})}};
 vm.runInNewContext(await readFile(new URL('../background.js',import.meta.url),'utf8'),{chrome,console,setTimeout});
 click();click();await new Promise(r=>setImmediate(r));assert.equal(created.length,1);
 click();await new Promise(r=>setImmediate(r));assert.equal(created.length,1);assert.equal(activated[0].id,7);assert.equal(focused[0].id,3);
});
