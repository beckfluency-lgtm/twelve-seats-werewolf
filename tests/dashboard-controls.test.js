import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

async function setup(){
 const nodes=new Map(),node=tag=>({tag,value:'',checked:false,disabled:false,dataset:{},children:[],setAttribute(key,value){this[key]=value},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]},add(item){this.children.push(item)}});
 let clickCapture;
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,querySelectorAll:()=>[],addEventListener(type,fn){if(type==='click')clickCapture=fn}};
 const seats=core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href}));
 const game=core.newGame(seats,()=>.999);
 for(let i=0;i<24;i++){const t=core.nextTask(game);core.acceptReply(game,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}
 const pending=core.nextTask(game),record={actor:pending.actor,requestId:pending.id,status:'sent',url:seats[pending.actor-1].url,prompt:'preserved prompt',config:{reply:'.reply'}};
 const state={seats,game,transport:record,adapters:{},settings:{timeout:240,discard:false,memory:true,background:true}},opens=[],writes=[];let stored=state;
 const context=vm.createContext({...core,document,console,setTimeout,URL,structuredClone,crypto:{randomUUID:()=> 'new-probe-id'},Option:class{},chrome:{storage:{local:{get:async()=>({werewolf:stored}),set:async value=>{writes.push(value);if(value.werewolf)stored=value.werewolf}}},tabs:{query:async()=>[],get:async id=>({id})}},ensureTab:async(player,options)=>{opens.push({player,options});return player.id},onPage:async()=>{throw Error('Must not send another message')}});
 context.confirmSubmitted=async()=>({present:true});
 vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 return {context,nodes,state,record,opens,writes,getState:()=>stored,captureClick:event=>clickCapture(event)};
}

test('pause and continue preserve the existing request; ending retains the game and blocks later actions',async()=>{
 const {context,nodes,state,record}=await setup();let rejectRead,stopCheck,reads=0;
 context.waitReply=async(_tab,_config,id,_url,shouldStop)=>{assert.equal(id,record.requestId);reads++;stopCheck=shouldStop;return new Promise((_resolve,reject)=>{rejectRead=reject})};
 assert.equal(nodes.get('run').textContent,'继续');
 const running=nodes.get('run').onclick();
 while(!rejectRead)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes.get('pause').textContent,'暂停');assert.equal(nodes.get('replaceSeat').disabled,false);
 await nodes.get('pause').onclick();assert.equal(stopCheck(),true);assert.equal(nodes.get('pause').disabled,true);
 rejectRead(Error('已暂停，待回复保留，可继续读取'));await running;
 assert.equal(nodes.get('run').textContent,'继续');assert.equal(nodes.get('pause').textContent,'结束');assert.equal(nodes.get('replaceSeat').disabled,false);assert.equal(state.transport,record);
 rejectRead=null;const resumed=nodes.get('run').onclick();while(!rejectRead)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,2);await nodes.get('pause').onclick();rejectRead(Error('已暂停，待回复保留，可继续读取'));await resumed;
 const original=structuredClone(record),logs=state.game.log.length;
 await nodes.get('pause').onclick();assert.ok(state.game.endedAt);assert.equal(JSON.stringify(state.transport),JSON.stringify(original));assert.equal(state.game.log.length,logs);assert.equal(state.seats.length,12);assert.equal(nodes.get('status').textContent,'本局已结束');assert.equal(nodes.get('run').disabled,true);
 await assert.rejects(context.launch(true),/本局已经结束/);await assert.rejects(context.completeRecord(record,{reply:{request_id:record.requestId,target:1}},'game'),/本局已经结束/);
 // A restored ended game must remain ended, including its unconsumed reply.
 vm.runInContext('stop=false;render()',context);assert.equal(nodes.get('run').disabled,true);assert.equal(state.transport.requestId,original.requestId);
});

test('seat links are absent from the table and remain clickable in player configuration during play',async()=>{
 const {context,nodes,state,opens}=await setup();
 const cards=nodes.get('table').children;
 assert.equal(cards.length,12);
 assert.ok(cards.every(card=>card.children.every(n=>n.tag!=='a')));
 const bindings=nodes.get('bindings').children;
 for(let i=0;i<12;i++){
  const links=bindings[i].children.at(-1).children.filter(n=>n.tag==='a');assert.equal(links.length,1);assert.equal(links[0].href,state.seats[i].url);
  let prevented=false;await links[0].onclick({preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(opens.at(-1).player.id,i+1);assert.equal(opens.at(-1).options,undefined);
 }
 vm.runInContext('busy=true;render()',context);
 for(const row of nodes.get('bindings').children)assert.equal(row.children.at(-1).children.find(n=>n.tag==='a').disabled,false);
 assert.equal(context.conversationLink({id:1,provider:'deepseek',url:'javascript:alert(1)'}).href,undefined);
});

test('one click verifies a new AI then preserves identities and the other pending reply',async()=>{
 const {context,nodes,state,record,getState}=await setup(),operations=[];
 const url='https://yuanbao.tencent.com/chat/new-seat-one',role=state.game.players[0].role;
 nodes.get('replacement-seat').value='1';nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value=url;
 context.backgroundDelay=async()=>{};
 context.onPage=async(_tab,operation)=>{operations.push(operation);return {url,present:true,inputs:1,count:1}};
 const acknowledgements=[];context.waitReply=async(_tab,_config,id)=>{
  const t=getState().game.pending,kind=getState().replacementProbe?'probe':t.kind;acknowledgements.push(kind);
  return {reply:{request_id:id,text:kind==='probe'?'就绪':kind==='intro'?'规则已理解':kind==='identity'?'身份已收到':'进度已收到',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false}};
 };
 await nodes.get('replaceSeat').onclick();
 const saved=getState();assert.equal(saved.game.players[0].url,url,nodes.get('notice').textContent);assert.equal(saved.game.players[0].role,role);assert.equal(saved.game.handover,null);assert.equal(saved.transport,null);assert.equal(saved.suspendedTransport.requestId,record.requestId);assert.equal(saved.replacementReady,undefined);
 assert.deepEqual(acknowledgements,['probe','intro','identity','catchup']);assert.equal(operations.filter(op=>op==='clickSend').length,4);assert.match(nodes.get('notice').textContent,/AI更换完成/);
});

test('a verified replacement resumes after pause without repeating the probe, while a failed probe never replaces the player',async()=>{
 const {context,nodes,state,getState}=await setup(),url='https://yuanbao.tencent.com/chat/new-seat-one';
 nodes.get('replacement-seat').value='1';nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value=url;
 context.onPage=async()=>({url,present:true});context.waitReply=async()=>({reply:{text:'wrong confirmation'}});
 const original=state.game.players[0].url;
 await nodes.get('replaceSeat').onclick();assert.equal(getState().game.players[0].url,original);assert.ok(getState().replacementProbe);assert.equal(getState().lastError.actor,1);assert.equal(getState().lastError.kind,'replacement');
 await nodes.get('cancelReplacement').onclick();assert.equal(getState().replacementProbe,null);assert.equal(getState().transport.requestId,state.transport.requestId);
 state.replacementReady={actor:1,provider:'yuanbao',url,requestId:'verified'};vm.runInContext('stop=true',context);
 context.backgroundDelay=async()=>{};
 context.onPage=async(_tab,_op,data)=>{assert.doesNotMatch(data.prompt||'',/这条消息只测试接入/);return {url,present:true,inputs:1,count:1}};
 context.waitReply=async(_tab,_cfg,id)=>{const t=getState().game.pending;return {reply:{request_id:id,text:t.kind==='intro'?'规则已理解':t.kind==='identity'?'身份已收到':'进度已收到',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false}}};
 await nodes.get('replaceSeat').onclick();assert.equal(getState().game.players[0].url,url);assert.equal(getState().replacementReady,undefined);
});

test('replacement and preparing a game remain available after the game finishes',async()=>{
 const {context,nodes,state}=await setup();state.game.winner='好人';vm.runInContext('render()',context);
 assert.equal(nodes.get('replaceSeat').disabled,false);assert.equal(nodes.get('newGame').disabled,false);assert.equal(nodes.get('status').textContent,'好人获胜');
});

test('button progress, errors and completion use only the shared status bar',async()=>{
 const {nodes,captureClick}=await setup();
 const panel={children:[],querySelector(){return this.children.find(n=>n.className==='panel-feedback')},append(node){this.children.push(node)}};
 const swap=nodes.get('replaceSeat');swap.textContent='更换AI';swap.closest=()=>panel;
 captureClick({target:{closest:()=>swap}});assert.match(nodes.get('notice').textContent,/正在处理/);
 await swap.onclick();assert.match(nodes.get('notice').textContent,/缺少独立对话地址/);assert.equal(panel.children.length,0);
 const refresh=nodes.get('refreshTabs');refresh.textContent='刷新已打开网页';refresh.closest=()=>panel;
 captureClick({target:{closest:()=>refresh}});await refresh.onclick();assert.equal(nodes.get('notice').textContent,'操作已完成');assert.equal(panel.children.length,0);
});

test('configuration can change before and after play, preparation archives the result while preserving every AI setting, and edits auto-save',async()=>{
 const {nodes,state,getState,writes}=await setup(),url='https://yuanbao.tencent.com/chat/future-seat-one',oldUrl=state.game.players[0].url;
 state.game.winner='好人';state.game.phase='finished';
 nodes.get('replacement-seat').value='1';nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value=url;
 await nodes.get('replaceSeat').onclick();assert.equal(getState().seats[0].url,url);assert.equal(getState().game.players[0].url,oldUrl);assert.equal(getState().game.winner,'好人');
 const configuration=JSON.stringify(getState().seats),adapters=JSON.stringify(getState().adapters),settings=JSON.stringify(getState().settings);
 await nodes.get('newGame').onclick();const prepared=getState();assert.equal(prepared.game,null);assert.equal(JSON.stringify(prepared.seats),configuration);assert.equal(JSON.stringify(prepared.adapters),adapters);assert.equal(JSON.stringify(prepared.settings),settings);assert.equal(prepared.transport,null);assert.equal(writes.find(w=>w.werewolfPreviousSession).werewolfPreviousSession.state.game.winner,'好人');
 const row=nodes.get('bindings').children[1],provider=row.children[1];provider.value='yuanbao';await provider.onchange();
 const input=nodes.get('bindings').children[1].children[2];input.value='https://yuanbao.tencent.com/chat/future-seat-two';await input.oninput();
 assert.equal(getState().seats[1].url,input.value);assert.equal(getState().seats[1].provider,'yuanbao');assert.equal(nodes.get('notice').textContent,'配置已保存');
 nodes.get('replacement-seat').value='3';nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value='https://yuanbao.tencent.com/chat/future-seat-three';await nodes.get('replaceSeat').onclick();assert.equal(getState().seats[2].provider,'yuanbao');assert.equal(getState().game,null);
});

test('replacing during a live read automatically pauses, sends onboarding, and resumes the original pending request without resending it',async()=>{
 const {context,nodes,state,record,getState}=await setup(),url='https://yuanbao.tencent.com/chat/running-replacement',sent=[];
 let rejectOld,checkStop,oldReads=0;
 context.backgroundDelay=async()=>{if(checkStop?.()&&rejectOld){rejectOld(Error('已暂停，待回复保留，可继续读取'));rejectOld=null;}await new Promise(resolve=>setImmediate(resolve));};
 context.onPage=async(_tab,operation,data)=>{if(operation==='send')sent.push(data.prompt);return {url,present:true,inputs:1,count:1}};
 context.waitReply=async(_tab,_config,id,_url,shouldStop)=>{
  if(id===record.requestId){oldReads++;if(oldReads===1){checkStop=shouldStop;return new Promise((_resolve,reject)=>{rejectOld=reject});}await nodes.get('pause').onclick();return {reply:{request_id:id,target:12}};}
  const t=getState().game.pending,kind=getState().replacementProbe?'probe':t.kind;
  return {reply:{request_id:id,text:kind==='probe'?'就绪':kind==='intro'?'规则已理解':kind==='identity'?'身份已收到':'进度已收到',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false}};
 };
 const run=nodes.get('run').onclick();while(!rejectOld)await new Promise(resolve=>setImmediate(resolve));
 nodes.get('replacement-seat').value='1';nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value=url;
 assert.equal(nodes.get('replaceSeat').disabled,false);await nodes.get('replaceSeat').onclick();await run;
 assert.equal(getState().game.players[0].url,url,nodes.get('notice').textContent);assert.equal(getState().game.handover,null);assert.equal(oldReads,2);assert.equal(getState().game.night.guard,12);assert.equal(sent.length,4);assert.ok(sent.every(prompt=>prompt!=='preserved prompt'));
});

test('interrupting another handover retains every suspended reply and restores each without sending it again',async()=>{
 const {context,nodes,record,getState}=await setup();
 const choose=(id,url)=>{nodes.get('replacement-seat').value=String(id);nodes.get('replacement-provider').value='yuanbao';nodes.get('replacement-url').value=url;};
 choose(1,'https://yuanbao.tencent.com/chat/first-swap');await context.applyReplacement();
 const first=core.nextTask(getState().game);getState().transport={actor:1,requestId:first.id,status:'sent',url:getState().game.players[0].url,prompt:'already sent first handover',config:{reply:'.reply'}};
 choose(2,'https://yuanbao.tencent.com/chat/second-swap');await context.applyReplacement();
 assert.equal(getState().suspendedTransport.requestId,record.requestId);assert.equal(getState().suspendedTransports[0].requestId,first.id);
 const acknowledge=()=>{const t=core.nextTask(getState().game);core.acceptReply(getState().game,{request_id:t.id,text:t.kind==='intro'?'规则已理解':t.kind==='identity'?'身份已收到':'进度已收到',seat:t.actor,wolves:4,villagers:4,gods:4,roleAssigned:false});};
 for(let i=0;i<3;i++)acknowledge();
 const reads=[];context.waitReply=async(_tab,_cfg,id)=>{reads.push(id);return {reply:id===first.id?{request_id:id,text:'规则已理解',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false}:{request_id:id,target:12}}};
 await context.step();assert.equal(getState().suspendedTransports,undefined);assert.equal(getState().suspendedTransport.requestId,record.requestId);
 acknowledge();acknowledge();await context.step();assert.deepEqual(reads,[first.id,record.requestId]);assert.equal(getState().suspendedTransport,null);assert.equal(getState().game.night.guard,12);
});
