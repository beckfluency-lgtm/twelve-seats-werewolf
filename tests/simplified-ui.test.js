import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

test('the real reduced HTML boots, resumes a saved action, and retains adapter settings without calibration fields',async()=>{
 const html=await readFile(new URL('../dashboard.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/网页控件校准|绑定已打开的独立对话/);
 assert.doesNotMatch(html,/同一段聊天持续使用|任何阶段都可更换|gameControlsHelp|replacementHelp|playerConfigStatus|errorHelp|waitDescription|panel-feedback/);
 assert.equal([...html.matchAll(/role="status"/g)].length,1);assert.match(html,/id="activity"/);
 assert.doesNotMatch(html,/id="(?:prepareNext|reset|saveSeats|testReplacement|repairReplacement|cancelReplacement|previewHandover|memoryConfirmed)"/);
 const replacement=html.match(/<section[^>]*><h2>更换AI<\/h2>[\s\S]*?<\/section>/)[0];
 assert.deepEqual([...replacement.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['replaceSeat','openReplacement']);
 const players=html.match(/<section[^>]*><h2>玩家与独立对话<\/h2>[\s\S]*?<\/section>/)[0];
 assert.deepEqual([...players.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['openPlatforms','refreshTabs']);
 const nodes=new Map(),node=tag=>({tag,value:'',checked:false,disabled:false,children:[],append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]},add(item){this.children.push(item)}});
 for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"/g))nodes.set(match[2],node(match[1]));
 const document={getElementById:id=>nodes.get(id)||null,createElement:node,querySelectorAll:()=>[]};
 const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href}));
 const game=core.newGame(seats,()=>.999);
 for(let i=0;i<24;i++){const t=core.nextTask(game);core.acceptReply(game,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}
 const pending=core.nextTask(game),record={actor:pending.actor,requestId:pending.id,status:'sent',url:seats[pending.actor-1].url,prompt:'existing message',config:{reply:'.reply'}};
 const state={seats,game,transport:record,adapters:{chatgpt:{input:'.input',send:'.send',reply:'.reply'}},settings:{timeout:90,discard:false,memory:true,background:true}};
 let reads=0,sends=0;
 const context=vm.createContext({...core,document,console,setTimeout,URL,Option:class{},chrome:{storage:{local:{get:async()=>({werewolf:state}),set:async()=>{}}},tabs:{query:async()=>[]}},ensureTab:async player=>player.id,onPage:async()=>{sends++;throw Error('Must not resend')},waitReply:async(_tab,_config,id)=>{assert.equal(id,record.requestId);reads++;throw Error('已暂停，待回复保留，可继续读取')}});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(state.lastError,undefined);assert.match(nodes.get('notice').textContent,/待回复已保留/);assert.equal(nodes.get('bindings').children.length,12);
 for(const row of nodes.get('bindings').children){assert.equal(row.children.length,4);assert.equal(row.children.filter(n=>n.tag==='select').length,1);}
 await nodes.get('run').onclick();assert.equal(reads,1);assert.equal(sends,0);assert.equal(state.transport,record);assert.equal(state.settings.timeout,90);assert.equal(state.settings.discard,false);assert.equal(state.settings.background,true);assert.equal(nodes.get('run').textContent,'继续');assert.equal(nodes.get('replaceSeat').disabled,false);
 const nextGame=core.newGame(seats);for(let i=0;i<12;i++){const t=core.nextTask(nextGame);core.acceptReply(nextGame,{request_id:t.id,text:'规则已理解'});}
 const identity=core.nextTask(nextGame);state.game=nextGame;state.settings.memory=false;state.transport={actor:identity.actor,requestId:identity.id,status:'sent',url:seats[identity.actor-1].url,config:{reply:'.reply'}};
 context.waitReply=async(_tab,_config,id)=>({reply:{request_id:id,text:'身份已收到'}});
 await nodes.get('step').onclick();assert.equal(nextGame.players[identity.actor-1].identityConfirmed,true);assert.equal(sends,0);
});
