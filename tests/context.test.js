import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultSeats,PROVIDERS,RULES,newGame,nextTask,acceptReply,promptFor,messageFor,markDelivered,compactState,replaceSeat} from '../core.js';
function game(){const g=newGame(defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,PROVIDERS[s.provider].home).href})),()=>.999);g.day=2;g.phase='speech';g.log=[];return g;}
const task=(actor=5)=>({id:'action-'+actor,actor,kind:'speech'});
test('ordinary messages omit full rules and confirmed history is delivered independently for each seat',()=>{
  const g=game();g.log.push({day:1,text:'公开原文甲',privateTo:null});const urls=g.players.map(p=>p.url),t=task();
  const first=messageFor(g,t);assert.ok(first.prompt.includes('公开原文甲'));assert.ok(!first.prompt.includes(RULES));
  assert.equal(g.players[4].delivery.log,0);markDelivered(g,5,first.delivery);
  g.log.push({day:2,text:'公开原文乙',privateTo:null});
  const second=messageFor(g,t);assert.ok(second.prompt.includes('公开原文乙'));assert.ok(!second.prompt.includes('公开原文甲'));
  assert.ok(messageFor(g,task(6)).prompt.includes('公开原文甲'));assert.deepEqual(g.players.map(p=>p.url),urls);assert.equal(g.log.length,2);
});
test('rendering, failed validation and refresh do not advance received positions or lose records added after send',()=>{
  const g=game(),t=task();g.pending=t;g.log.push({day:1,text:'待确认原文',privateTo:null});
  const sent=messageFor(g,t);assert.equal(messageFor(g,t).prompt,sent.prompt);assert.equal(g.players[4].delivery.log,0);
  assert.throws(()=>acceptReply(g,{request_id:'wrong',text:'invalid'}));assert.equal(g.players[4].delivery.log,0);
  g.log.push({day:2,text:'发送后新增原文',privateTo:null});const restored=JSON.parse(JSON.stringify(g));
  acceptReply(restored,{request_id:t.id,text:'5号实际发言',target:null});markDelivered(restored,5,sent.delivery);
  const next=messageFor(restored,task()).prompt;assert.ok(!next.includes('待确认原文'));assert.ok(next.includes('发送后新增原文'));
});
test('skill results created by accepting an action remain unread until sent, and other seats cannot see them',()=>{
  const g=game();g.phase='night';g.pending={id:'check',actor:9,kind:'seer'};const sent=messageFor(g,g.pending);
  acceptReply(g,{request_id:'check',target:1});markDelivered(g,9,sent.delivery);
  const seer=messageFor(g,task(9));assert.ok(seer.prompt.includes('查验1号为狼人'));assert.ok(seer.prompt.includes('1号=狼人'));
  assert.ok(!messageFor(g,task(5)).prompt.includes('查验1号为狼人'));markDelivered(g,9,seer.delivery);
  const next=messageFor(g,task(9)).prompt;assert.ok(!next.includes('第2夜查验1号为狼人'));assert.ok(next.includes('1号=狼人'));
});
test('state tables include only announced votes and the selected seat own private state',()=>{
  const g=game();g.phase='vote';g.votes={1:5,2:5,5:null};g.lastGuard=8;g.potions.save=false;g.night.wolfVotes={1:6};
  g.players[8].notes.push('第1夜查验1号为狼人');g.log.push({day:1,text:'投票结果 1号→7号，2号→7号',privateTo:null},{day:2,text:'狼队私语',privateTo:[1,2,3,4]},{day:2,text:'预言家私密结果',privateTo:[9]});
  const civilian=messageFor(g,task(5)).prompt;assert.ok(civilian.includes('1号→7号'));assert.ok(civilian.includes('本轮你已提交的投票 弃票'));
  for(const hidden of ['1号→5','2号→5','狼队私语','预言家私密结果','上次守护','你的药品','1号=狼人','狼队 2号'])assert.ok(!civilian.includes(hidden),hidden);
  assert.ok(messageFor(g,task(1)).prompt.includes('狼队私语'));assert.ok(compactState(g,12).includes('上次守护 8号'));
  assert.ok(compactState(g,10).includes('解药已用完'));g.phase='night';assert.ok(!compactState(g,5).includes('本轮你已提交的投票'));
});
test('legacy saves begin before the last confirmed own action and do not treat a public death as receipt',()=>{
  const g=game();delete g.players[4].delivery;
  g.log=[{day:1,text:'很早已收到的记录',privateTo:null},{day:1,text:'5号 已确认旧发言',privateTo:null},{day:2,text:'之后新增公开原文',privateTo:null},{day:2,text:'5号出局',privateTo:null}];
  const preview=messageFor(g,task());assert.ok(!preview.prompt.includes('很早已收到的记录'));assert.ok(preview.prompt.includes('之后新增公开原文'));assert.ok(preview.prompt.includes('5号出局'));
  assert.equal(g.players[4].delivery,undefined);markDelivered(g,5,preview.delivery);
  assert.ok(!messageFor(g,task()).prompt.includes('之后新增公开原文'));
});
test('a replaced chat receives full allowed catchup once, while rule and identity acknowledgements consume no history',()=>{
  const g=game();g.log.push({day:1,text:'已见旧记录',privateTo:null},{day:2,text:'他人秘密',privateTo:[9]});markDelivered(g,5,messageFor(g,task()).delivery);
  g.pending=task();g.queue=[];replaceSeat(g,5,{provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/replacement'});
  let t=nextTask(g),m=messageFor(g,t);assert.ok(m.prompt.includes(RULES));assert.equal(m.delivery,null);acceptReply(g,{request_id:t.id,text:'规则已理解',seat:5,wolves:4,villagers:4,gods:4,roleAssigned:false});
  t=nextTask(g);m=messageFor(g,t);assert.equal(m.delivery,null);acceptReply(g,{request_id:t.id,text:'身份已收到'});
  t=nextTask(g);m=messageFor(g,t);assert.ok(m.prompt.includes('已见旧记录'));assert.ok(!m.prompt.includes('他人秘密'));assert.ok(!m.prompt.includes(RULES));
  acceptReply(g,{request_id:t.id,text:'进度已收到'});markDelivered(g,5,m.delivery);
  const ordinary=messageFor(g,nextTask(g)).prompt;assert.ok(!ordinary.includes('已见旧记录'));assert.ok(!ordinary.includes(RULES));
});
test('received positions survive storage, ignore mismatched conversations and keep ordinary messages bounded',()=>{
  const g=game();for(let i=0;i<500;i++)g.log.push({day:i,text:'历史原文-'+i+' '+('内容'.repeat(60)),privateTo:null});
  const sent=messageFor(g,task());markDelivered(g,5,sent.delivery);const restored=JSON.parse(JSON.stringify(g));restored.log.push({day:501,text:'只有这一条是新增原文',privateTo:null});
  const message=messageFor(restored,task());assert.ok(message.prompt.includes('只有这一条是新增原文'));assert.ok(!message.prompt.includes('历史原文-'));assert.ok(message.prompt.length<1000);assert.equal(restored.log.length,501);
  assert.equal(markDelivered(restored,5,{...message.delivery,conversation:'https://yuanbao.tencent.com/chat/wrong'}),false);
  assert.equal(restored.players[4].delivery.log,500);
});
