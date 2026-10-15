import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
import {reviewEntries,reviewText,reviewLabel,defaultSeats,PROVIDERS,newGame,nextTask,acceptReply,promptFor,contextPageFor} from '../core.js';
test('public actions appear in both columns; private actions only appear in god action view',()=>{
  const e=(text,privateTo=null,extra={})=>({day:1,phase:'speech',text,privateTo,...extra});
  const speech=e('1号 我的判断是2号狼人。'),campaign=e('2号竞选发言 我来带队'),words=e('3号遗言 我是村民');
  const votes=e('投票结果 1号→2号'),death=e('2号出局'),shot=e('3号发动出局技能带走4号');
  const secret=e('5号查验2号为狼人',[5]),wolf=e('6号狼队交流 今晚刀7号',[6,7,8,9]);
  const sealed=e('1号放逐投票 2号',[1],{observerOnly:true,category:'action'});
  const g={log:[speech,campaign,words,votes,death,shot,secret,wolf,sealed]};
  assert.deepEqual(reviewEntries(g,true).speeches,[speech,campaign,words,votes,death,shot]);
  assert.deepEqual(reviewEntries(g,true).actions,[votes,death,shot,secret,wolf]);
  assert.deepEqual(reviewEntries(g,false).actions,[]);assert.deepEqual(reviewEntries(g,false).speeches,[speech,campaign,words,votes,death,shot]);
});
test('public ballot cards group voters by target, preserve sheriff weight and put abstentions last',()=>{
  const result=core.voteSummary({privateTo:null,phase:'runoffVote',text:'投票结果 1号→3号（1.5票），2号→4号，3号→弃票，4号→3号'});
  assert.equal(result.title,'放逐复投');assert.deepEqual(result.groups.map(g=>[g.target,g.total]),[[3,2.5],[4,1],[null,0]]);assert.deepEqual(result.groups[0].voters,[{actor:1,weight:1.5},{actor:4,weight:1}]);
  assert.equal(core.voteSummary({privateTo:null,text:'警长投票结果 1号→2号'}).title,'警长投票');
  assert.equal(core.voteSummary({privateTo:[1],text:'投票结果 1号→2号'}),null);assert.equal(core.voteSummary({privateTo:null,text:'投票结果 1号→2号，1号→3号'}),null);
});
test('table shows only announced signup and withdrawal, and follows badge transfers, pending transfer and loss',()=>{
  const g={rulesVersion:2,phase:'sheriffSignup',players:[{id:1,alive:true},{id:2,alive:true}],log:[],election:{signup:{1:true},original:[],withdraw:{},candidates:[]},sheriff:null};
  assert.equal(core.seatElectionStatus(g,1),null);assert.equal(core.tableBadgeStatus(g),'警长竞选中');
  g.phase='sheriffSpeech';g.election.original=[1,2];g.election.candidates=[1,2];g.log.push({privateTo:null,text:'上警名单 1、2'});
  assert.equal(core.seatElectionStatus(g,1),'已上警');assert.equal(core.seatElectionStatus(g,3),null);
  g.phase='sheriffWithdraw';g.election.withdraw[1]=true;assert.equal(core.seatElectionStatus(g,1),'已上警');
  g.log.push({privateTo:null,text:'退水名单 1'});assert.equal(core.seatElectionStatus(g,1),'已退水');
  g.phase='sheriffPK';g.election.candidates=[2];assert.equal(core.seatElectionStatus(g,2),'上警 · PK');
  g.election.completed=true;assert.equal(core.seatElectionStatus(g,2),null);g.election.completed=false;g.phase='speech';assert.equal(core.seatElectionStatus(g,1),null);assert.equal(core.seatElectionStatus(g,2),null);
  g.sheriff=2;assert.equal(core.tableBadgeStatus(g),'警徽 · 2号');g.players[1].alive=false;assert.equal(core.tableBadgeStatus(g),'警徽待移交 · 2号');
  g.sheriff=1;assert.equal(core.tableBadgeStatus(g),'警徽 · 1号');g.sheriff=null;g.badgeLost=true;assert.equal(core.tableBadgeStatus(g),'警徽已流失');
  assert.equal(core.tableBadgeStatus(null),null);assert.equal(core.tableBadgeStatus({rulesVersion:1}),null);
});
test('new secret knife and sealed votes persist for review but never enter any AI prompt or context page',()=>{
  const seats=defaultSeats().map(s=>({...s,url:new URL('/conversation/'+s.id,PROVIDERS[s.provider].home).href}));
  const g=newGame(seats,()=>.999,'standard');
  for(let i=0;i<24;i++){const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}
  nextTask(g);g.pending={id:'knife',actor:1,kind:'wolfKill'};acceptReply(g,{request_id:'knife',target:5});
  g.phase='vote';g.votes={};g.ballot={kind:'vote',candidates:[1,2,3,4],eligible:[5,6]};g.queue=[];g.pending={id:'vote',actor:5,kind:'vote'};acceptReply(g,{request_id:'vote',target:2});
  assert.ok(reviewEntries(g,true).actions.some(e=>e.text==='1号选择刀口 5号'));assert.ok(!reviewEntries(g,true).actions.some(e=>e.text==='5号放逐投票 2号'));
  for(let id=1;id<=12;id++){
    for(const kind of ['speech','catchup','vote'])assert.doesNotMatch(promptFor(g,{id:'test',actor:id,kind}),/1号选择刀口 5号|5号放逐投票 2号/);
  }
  for(let i=0;i<30;i++)g.log.push({day:1,phase:'speech',text:'公开发言'+'甲'.repeat(180),privateTo:null});
  assert.doesNotMatch(contextPageFor(g,{id:'page',actor:1,kind:'speech'},1500).prompt,/1号选择刀口 5号|5号放逐投票 2号/);
  const restored=JSON.parse(JSON.stringify(g));assert.equal(reviewEntries(restored,true).actions.filter(e=>e.observerOnly).length,1);
});
test('legacy night actions and potion JSON are readable without exposing request identifiers',()=>{
  assert.equal(reviewText({text:'12号 guard 目标5'}),'12号 守护 5号');
  assert.equal(reviewText({text:'1号 wolfKill 目标6'}),'1号 选择刀口 6号');
  assert.equal(reviewText({day:2,text:'10号女巫行动 {"save":true,"poison":null}'},{players:[{id:10,notes:['第2夜救了5号']}]}),'10号女巫行动 · 使用解药救5号');
  assert.equal(reviewText({text:'10号女巫行动 {"request_id":"secret-id","save":false,"poison":2}'}),'10号女巫行动 · 毒杀2号');
  assert.match(reviewLabel({day:2,phase:'night',privateTo:[10]}),/第2夜 · 夜间行动 · 私人行动/);
  assert.match(reviewLabel({day:1,phase:'sheriffVote',privateTo:null}),/第1天 · 警长投票/);
});
test('operational confirmations and errors stay outside both columns, while real speech is retained',()=>{
  const texts=['向12名玩家说明规则，等待逐席确认','1号规则已理解','1号身份已收到','1号更换为腾讯元宝，开始交接','1号已完成AI交接','用户重新发送1号当前行动，旧编号已作废','用户跳过1号本次发言','异常提示：网络错误'];
  const log=texts.map(text=>({day:1,phase:'speech',text,privateTo:null}));
  log.push({day:1,phase:'speech',text:'2号 刚才的异常不影响我的判断。',privateTo:null,category:'speech'});
  assert.deepEqual(reviewEntries({log},true).speeches.map(e=>e.text),['2号 刚才的异常不影响我的判断。']);assert.deepEqual(reviewEntries({log},true).actions,[]);
});
test('game begins once only after all rules and identities are confirmed; normal and manual endings announce results',()=>{
  const seats=defaultSeats().map(s=>({...s,url:new URL('/conversation/'+s.id,PROVIDERS[s.provider].home).href}));
  for(const board of ['legacy','standard']){
    const g=newGame(seats,()=>.999,board);
    for(let i=0;i<24;i++){
      assert.equal(reviewEntries(g,true).speeches.length,0);assert.equal(reviewEntries(g,true).actions.length,0);
      const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});
    }
    nextTask(g);nextTask(g);assert.equal(g.log.filter(e=>e.text==='游戏开始').length,1);assert.equal(reviewEntries(g,true).speeches[0].text,'游戏开始');
    g.log.push({day:3,phase:'finished',text:'好人阵营获胜',privateTo:null});g.winner='好人';assert.equal(reviewText(reviewEntries(g,true).speeches.at(-1)),'游戏结果 · 好人阵营获胜');
  }
  assert.match(reviewEntries({day:2,log:[],endedAt:123},false).speeches.at(-1).text,/未产生胜负/);
});
test('switching off god view hides the action column and removes private action text from its DOM',async()=>{
  const html=await readFile(new URL('../dashboard.html',import.meta.url),'utf8');assert.doesNotMatch(html,/id="private"/);
  const nodes=new Map(),node=tag=>({tag,value:'',checked:false,children:[],scrollHeight:500,scrollTop:90,clientHeight:100,append(...n){this.children.push(...n)},replaceChildren(...n){this.children=[...n]},add(n){this.children.push(n)}});
  for(const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"/g))nodes.set(match[2],node(match[1]));nodes.get('reveal').checked=true;
  const seats=defaultSeats().map(s=>({...s,url:new URL('/conversation/'+s.id,PROVIDERS[s.provider].home).href})),game=newGame(seats);
  game.log=[{day:1,phase:'speech',text:'1号 我的公开发言',privateTo:null},{day:1,phase:'vote',text:'投票结果 1号→2号',privateTo:null},{day:1,phase:'night',text:'9号查验2号为狼人',privateTo:[9]}];
  const document={getElementById:id=>nodes.get(id)||null,createElement:node,querySelectorAll:()=>[]},state={seats,game,adapters:{},settings:{timeout:240,background:true}};
  const context=vm.createContext({...core,document,URL,console,setTimeout,Option:class{},chrome:{storage:{local:{get:async()=>({werewolf:state})}},tabs:{query:async()=>[]}}});
  vm.runInContext((await readFile(new URL('../dashboard.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
  const allText=n=>(n.textContent||'')+(n.children||[]).map(allText).join('');
  const texts=id=>nodes.get(id).children.map(row=>allText(row.children[1]));
  assert.equal(nodes.get('actionColumn').hidden,true);assert.equal(nodes.get('actionLog').children.length,0);assert.equal(nodes.get('toggleActions').textContent,'显示行动');
  nodes.get('toggleActions').onclick();assert.equal(nodes.get('toggleActions').textContent,'隐藏行动');
  assert.equal(nodes.get('actionColumn').hidden,false);assert.deepEqual(texts('log'),['1号 我的公开发言','放逐投票2号1票1号']);assert.deepEqual(texts('actionLog'),['放逐投票2号1票1号','9号查验2号为狼人']);
  assert.equal(nodes.get('log').scrollTop,90); // Reviewing earlier entries must not jump to the newest message.
  nodes.get('reveal').checked=false;nodes.get('reveal').onchange();assert.equal(nodes.get('actionColumn').hidden,true);assert.equal(nodes.get('actionLog').children.length,0);assert.deepEqual(texts('log'),['1号 我的公开发言','放逐投票2号1票1号']);
  assert.equal(nodes.get('toggleActions').hidden,true);nodes.get('toggleActions').onclick();assert.equal(nodes.get('actionColumn').hidden,true);
  nodes.get('reveal').checked=true;nodes.get('reveal').onchange();assert.equal(nodes.get('actionColumn').hidden,true);assert.equal(nodes.get('toggleActions').hidden,false);
  nodes.get('toggleActions').onclick();assert.equal(nodes.get('actionColumn').hidden,false);nodes.get('toggleActions').onclick();assert.equal(nodes.get('actionColumn').hidden,true);assert.equal(nodes.get('actionLog').children.length,0);
});
