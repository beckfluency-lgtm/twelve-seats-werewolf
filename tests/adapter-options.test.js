import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {PROVIDERS,DEFAULT_ADAPTERS} from '../core.js';import {validateAdapter,validateAdapterFile,editableAdapter} from '../adapters.js';
test('every exported default is portable and excludes game state and tested flags',()=>{
 const adapters=Object.fromEntries(Object.entries(DEFAULT_ADAPTERS).map(([id,cfg])=>[id,editableAdapter(cfg)]));
 const text=JSON.stringify({format:'twelve-seats-adapters',version:1,adapters}),parsed=validateAdapterFile(JSON.parse(text),PROVIDERS);
 assert.equal(Object.keys(parsed).length,17);assert.equal(parsed.spark.send,'#ask_window_send_btn');
 for(const cfg of Object.values(parsed)){assert.equal(cfg.nativeSend,false);assert.equal(cfg.tested,false);assert.equal(cfg.confirmSubmission,true);assert.equal(cfg.url,undefined);assert.equal(cfg.prompt,undefined);}
 assert.throws(()=>validateAdapter({input:'a',send:'b',reply:'c',script:'evil'}));assert.throws(()=>validateAdapter({input:'a',send:'b',reply:'c',nativeSend:true}));assert.throws(()=>validateAdapter({input:'',send:'b',reply:'c'}));assert.throws(()=>validateAdapter({input:'a',send:'b',reply:'c',sendEvent:'keyboard'}));
 assert.throws(()=>validateAdapterFile({format:'twelve-seats-adapters',version:1,adapters:{unknown:{input:'a',send:'b',reply:'c'}}},PROVIDERS));
 assert.throws(()=>validateAdapterFile({format:'twelve-seats-adapters',version:1,adapters:[]},PROVIDERS));
});
test('settings save and restore defaults only in the override key, leaving an active game untouched',async()=>{
 const nodes=new Map(),node=()=>({value:'',add(){},files:[]});const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelector:()=>null};
 const game={id:'private-game',pending:{id:'original-request'}},storage={werewolf:{game},werewolfAdapterOverrides:{}};
 const context=vm.createContext({PROVIDERS,DEFAULT_ADAPTERS,validateAdapter,validateAdapterFile,editableAdapter,document,Option:class{},chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}}}});
 nodes.set('provider',{value:'spark',add(){}});
 vm.runInContext((await readFile(new URL('../options.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(r=>setImmediate(r));
 nodes.get('config').value=JSON.stringify({input:'#editor',send:'#send',reply:'.reply'});await nodes.get('save').onclick();assert.equal(storage.werewolfAdapterOverrides.spark.send,'#send');
 await nodes.get('reset').onclick();assert.equal(storage.werewolfAdapterOverrides.spark.send,'#ask_window_send_btn');assert.equal(storage.werewolf.game,game);assert.equal(game.pending.id,'original-request');
});
