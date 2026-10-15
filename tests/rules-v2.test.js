import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BOARDS,PROVIDERS,defaultSeats,newGame,nextTask,acceptReply,legalTargets,promptFor,messageFor,contextPageFor,skipPending,replaceSeat,markDelivered,winner,rulesFor,retryPending} from '../core.js';
const seats=()=>defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,PROVIDERS[s.provider].home).href}));
const fresh=(board='standard')=>newGame(seats(),()=>.999,board);
function setup(board='standard'){
  const g=fresh(board);for(let i=0;i<24;i++){const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}return g;
}
function answer(g,fields){const t=nextTask(g);assert.ok(t);acceptReply(g,{request_id:t.id,...fields});return t;}
function reply(g,t,rng=()=>.8){
  const r={request_id:t.id},choices=legalTargets(g,t);
  if(['intro','identity','catchup'].includes(t.kind)){r.text={intro:'规则已理解',identity:'身份已收到',catchup:'进度已收到'}[t.kind];if(t.verifyRules)Object.assign(r,{seat:t.actor,wolves:4,villagers:4,gods:4,roleAssigned:false});}
  else if(['speech','sheriffSpeech','lastWords','wolfTalk'].includes(t.kind))r.text='根据公开信息判断。';
  else if(t.kind==='explode')r.explode=false;
  else if(t.kind==='sheriffSignup')r.run=t.actor===9||t.actor===1;
  else if(t.kind==='sheriffWithdraw')r.withdraw=false;
  else if(t.kind==='dayOrder')r.direction=rng()<.5?'counterclockwise':'clockwise';
  else if(t.kind==='witch'){r.save=g.potions.save&&g.night.kill!==null&&g.night.kill!==t.actor&&rng()<.4;r.poison=!r.save&&g.potions.poison&&rng()<.2?choices[Math.floor(rng()*choices.length)]??null:null;}
  else r.target=choices[Math.floor(rng()*choices.length)]??null;
  return r;
}
function advanceTo(g,predicate,limit=600){
  for(let i=0;i<limit;i++){const t=nextTask(g);if(predicate(t,g))return t;if(!t)break;acceptReply(g,reply(g,t));}throw Error('Phase not reached '+g.phase);
}
function election({kill=5,poison=null,board='standard'}={}){
  const g=setup(board);g.day=1;g.phase='night';g.queue=[];g.pending=null;g.night={guard:null,kill,poison,save:false,wolfVotes:{},wolfTalk:[]};nextTask(g);return g;
}
function ballot(g,kind='vote',{candidates=[1,2],eligible=[5,6],weights={}}={}){
  g.phase=kind==='vote'?'vote':'sheriffVote';g.pending=null;g.queue=eligible.map(id=>({id:crypto.randomUUID(),actor:id,kind}));
  g.ballot={kind,log:g.log.length,candidates,eligible,weights};g.votes={};
  if(kind==='sheriffVote')g.election={original:[1,2],candidates,signup:{1:true,2:true},withdraw:{},votes:{},runoff:false};
}
test('three standard boards have exactly 4 wolves, 4 villagers and 4 gods; old guard saves keep original rules',()=>{
  for(const id of Object.keys(BOARDS)){const g=fresh(id);assert.equal(g.rulesVersion,2);assert.equal(g.boardId,id);assert.equal(g.players.filter(p=>['狼人','狼王','白狼王'].includes(p.role)).length,4);assert.equal(g.players.filter(p=>p.role==='村民').length,4);assert.match(promptFor(g,nextTask(g)),new RegExp(BOARDS[id].name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
  assert.equal(fresh().players[11].role,'白痴');assert.equal(fresh('wolfKing').players[3].role,'狼王');assert.equal(fresh('whiteWolf').players[3].role,'白狼王');
  const old=newGame(seats(),()=>.999);assert.equal(old.rulesVersion,undefined);assert.match(rulesFor(old),/无警长，无遗言/);assert.throws(()=>fresh('invalid'),/未知板子/);
});
test('first-night election precedes death announcement and sealed signup is not leaked',()=>{
  const g=election();assert.equal(g.pending.kind,'sheriffSignup');assert.ok(g.players[4].alive);assert.ok(!g.log.some(e=>e.text==='5号出局'));
  answer(g,{run:true});const t=nextTask(g);assert.ok(!promptFor(g,t).includes('上警名单 1'));assert.equal(g.election.signup[1],true);
  for(let id=2;id<=12;id++)answer(g,{run:id===9});
  const first=nextTask(g);assert.equal(first.kind,'sheriffSpeech');assert.deepEqual(g.election.original,[1,9]);assert.ok(g.log.some(e=>e.text==='上警名单 1、9'));
});
test('withdrawn candidates cannot vote; single candidate elected; first-night death then receives last words',()=>{
  const g=election();for(let id=1;id<=12;id++)answer(g,{run:id===1||id===9});
  advanceTo(g,t=>t.kind==='sheriffWithdraw');answer(g,{withdraw:true});answer(g,{withdraw:false});
  const t=nextTask(g);assert.equal(g.sheriff,9);assert.equal(t.kind,'lastWords');assert.equal(t.actor,5);assert.equal(g.players[4].alive,false);
  assert.ok(g.log.findIndex(e=>e.text==='9号当选警长')<g.log.findIndex(e=>e.text==='5号出局'));
  const h=election({kill:null});for(let id=1;id<=12;id++)answer(h,{run:id===1||id===9||id===10});
  advanceTo(h,t=>t.kind==='sheriffWithdraw');answer(h,{withdraw:true});answer(h,{withdraw:false});answer(h,{withdraw:false});
  const vote=nextTask(h);assert.equal(vote.kind,'sheriffVote');assert.ok(!h.ballot.eligible.includes(1));assert.ok(!h.ballot.eligible.includes(9));
});
test('sheriff tie has PK with original off-police voters; second tie or all abstentions loses badge',()=>{
  const g=election({kill:null});g.pending=null;g.queue=[];ballot(g,'sheriffVote');answer(g,{target:1});answer(g,{target:2});
  assert.equal(nextTask(g).kind,'sheriffSpeech');assert.equal(g.phase,'sheriffPK');
  advanceTo(g,t=>t.kind==='sheriffVote');assert.equal(g.phase,'sheriffRunoffVote');assert.ok(!g.ballot.eligible.includes(1));
  while(g.queue.length||g.pending){const t=nextTask(g);if(t.kind!=='sheriffVote')break;answer(g,{target:null});}
  nextTask(g);
  assert.equal(g.sheriff,null);assert.equal(g.badgeLost,true);
});
test('all candidates with no original off-police voters cannot produce a sheriff, even after withdrawals',()=>{
  const g=election({kill:null});for(let id=1;id<=12;id++)answer(g,{run:true});
  advanceTo(g,t=>t.kind==='sheriffWithdraw');for(let id=1;id<=12;id++)answer(g,{withdraw:id!==9});
  nextTask(g);assert.equal(g.sheriff,null);assert.equal(g.badgeLost,true);
  const h=election({kill:null});h.pending=null;h.queue=[];ballot(h,'sheriffVote');answer(h,{target:1});answer(h,{target:2});
  advanceTo(h,t=>t.kind==='sheriffVote');const eligible=[...h.ballot.eligible];assert.equal(eligible.length,10);
  for(let i=0;i<eligible.length;i++)answer(h,{target:i<5?1:2});nextTask(h);assert.equal(h.sheriff,null);assert.equal(h.badgeLost,true);
});
test('exile and sheriff ballots stay sealed in normal, catchup, retry, skip, and batched context prompts',()=>{
  for(const kind of ['vote','sheriffVote']){
    const g=setup();ballot(g,kind,{candidates:[1,2,3],eligible:[5,6,7,8]});
    answer(g,{target:3});let t=nextTask(g);skipPending(g);t=nextTask(g);retryPending(g);
    for(const task of [g.pending,{id:'catch',actor:7,kind:'catchup'}]){
      const prompt=promptFor(g,task);assert.doesNotMatch(prompt,/5号→3号|6号.*弃票|本轮你已提交|已收集.*票/);
    }
    for(let i=0;i<30;i++)g.log.push({day:1,phase:g.phase,text:'历史已公开发言'+i+'甲'.repeat(180),privateTo:null});
    const page=contextPageFor(g,g.pending,1500);assert.ok(page);assert.doesNotMatch(page.prompt,/5号→3号|6号.*弃票/);
    answer(g,{target:1});answer(g,{target:3});nextTask(g);
    assert.ok(g.log.some(e=>e.privateTo===null&&e.text.includes('5号→3号')&&e.text.includes('6号→弃票')));
  }
});
test('sheriff 1.5 weight changes exile result; PK excludes candidates and restricts targets',()=>{
  const g=setup();g.sheriff=5;ballot(g,'vote',{weights:{5:1.5,6:1}});answer(g,{target:1});answer(g,{target:2});
  const t=nextTask(g);assert.equal(g.players[0].alive,false);assert.equal(g.players[1].alive,true);assert.equal(t.kind,'lastWords');assert.match(g.log.find(e=>e.text.startsWith('投票结果')).text,/1.5票/);
  const h=setup();ballot(h);answer(h,{target:1});answer(h,{target:2});nextTask(h);assert.equal(h.phase,'runoffSpeech');
  advanceTo(h,t=>t.kind==='vote');assert.equal(h.phase,'runoffVote');assert.ok(!h.ballot.eligible.includes(1));assert.deepEqual(legalTargets(h,h.pending),[1,2]);
});
test('idiot flips alive, loses voting and exile eligibility, remains a god and can transfer badge',()=>{
  const g=setup();g.sheriff=12;ballot(g,'vote',{candidates:[12],eligible:[1,2]});answer(g,{target:12});answer(g,{target:12});
  const t=nextTask(g);assert.equal(t.kind,'badge');assert.ok(g.players[11].alive);assert.ok(g.players[11].idiotRevealed);assert.equal(g.queue.some(t=>t.kind==='lastWords'),false);
  answer(g,{target:9});assert.equal(g.sheriff,9);
  g.phase='speech';g.pending=null;g.queue=[];nextTask(g);assert.ok(!g.ballot.eligible.includes(12));assert.ok(!g.ballot.candidates.includes(12));
  for(const p of g.players)if(['预言家','女巫','猎人'].includes(p.role))p.alive=false;assert.equal(winner(g),null);
});
test('only first-night deaths and exiles receive last words; night two and shot victims do not',()=>{
  const g=election({kill:5,poison:6});for(let id=1;id<=12;id++)answer(g,{run:false});
  assert.equal(nextTask(g).kind,'lastWords');assert.equal(g.pending.actor,5);answer(g,{text:'首夜5遗言'});assert.equal(nextTask(g).actor,6);answer(g,{text:'首夜6遗言'});
  const h=setup();h.day=2;h.phase='night';h.queue=[];h.pending=null;h.night={kill:11,guard:null,save:false,poison:null};
  assert.equal(nextTask(h).kind,'hunter');assert.equal(h.queue.some(t=>t.kind==='lastWords'),false);answer(h,{target:5});assert.equal(h.players[4].alive,false);assert.equal(h.queue.some(t=>t.kind==='lastWords'),false);
});
test('poison blocks hunter and wolf king gun; chains settle before continuing and do not reveal wolf-king identity',()=>{
  for(const board of ['standard','wolfKing']){
    const g=setup(board),id=board==='standard'?11:4;g.day=2;g.phase='night';g.queue=[];g.pending=null;g.night={kill:null,guard:null,save:false,poison:id};
    nextTask(g);assert.equal(g.players[id-1].alive,false);assert.ok(![g.pending,...g.queue].some(t=>t?.actor===id&&t.kind==='hunter'));
  }
  const g=setup('wolfKing');g.day=2;g.phase='night';g.queue=[];g.pending=null;g.night={kill:11,guard:null,save:false,poison:null};
  answer(g,{target:4});assert.equal(nextTask(g).kind,'hunter');assert.equal(g.pending.actor,4);answer(g,{target:5});assert.ok(!g.log.some(e=>e.privateTo===null&&/狼王.*开枪|4号狼王/.test(e.text)));
});
test('wolf king can self-knife, night ballot ties mean empty knife, witch cannot self-save even on night one',()=>{
  const g=setup('wolfKing');g.day=1;g.phase='night';g.pending={id:'knife',kind:'wolfKill',actor:4};g.queue=[];g.night.wolfVotes={};
  assert.ok(legalTargets(g,g.pending).includes(4));answer(g,{target:4});
  g.pending={id:'knife2',kind:'wolfKill',actor:1};answer(g,{target:5});assert.equal(g.night.kill,null);
  g.pending={id:'witch',kind:'witch',actor:10};g.night.kill=10;assert.throws(()=>answer(g,{save:true,poison:null}),/不能使用解药/);assert.ok(g.potions.save);
  const before=promptFor(g,g.pending);assert.match(before,/可救人 否/);
});
test('self-explosion aborts speech, is forbidden during voting/last words, and does not trigger wolf king gun',()=>{
  const g=setup('wolfKing');g.day=1;g.phase='speech';g.queue=[{id:'next',actor:5,kind:'speech'}];g.pending={id:'boom',actor:4,kind:'explode'};
  answer(g,{explode:true,target:null});assert.equal(g.players[3].alive,false);assert.equal(g.phase,'explosionDeaths');assert.equal(g.queue.length,0);
  assert.equal(nextTask(g).kind,'guard');assert.equal(g.day,2);
  for(const phase of ['vote','runoffVote','sheriffVote','voteDeaths','night']){
    const h=setup();h.phase=phase;h.pending={id:'forbidden',actor:1,kind:'vote'};
    assert.throws(()=>answer(h,{explode:true,target:null}),/不能自爆/);assert.ok(h.players[0].alive);
  }
});
test('white wolf explosion can carry hunter, hunter can fire, neither explosion death gets last words',()=>{
  const g=setup('whiteWolf');g.day=1;g.phase='speech';g.queue=[];g.pending={id:'boom',actor:4,kind:'speech'};
  answer(g,{explode:true,target:11});assert.equal(g.players[3].alive,false);assert.equal(g.players[10].alive,false);assert.equal(nextTask(g).kind,'hunter');assert.equal(g.pending.actor,11);assert.ok(!g.queue.some(t=>t.kind==='lastWords'));
  answer(g,{target:1});assert.equal(g.players[0].alive,false);assert.equal(nextTask(g).kind,'guard');
});
test('police explosion swallows badge but preserves first-night death words and poisoned white wolf cannot carry',()=>{
  const g=election({board:'whiteWolf',kill:5});g.pending={id:'policeBoom',actor:4,kind:'sheriffSignup'};
  answer(g,{explode:true,target:9});assert.equal(g.badgeLost,true);assert.equal(g.players[8].alive,false);assert.equal(nextTask(g).kind,'lastWords');assert.equal(g.pending.actor,5);answer(g,{text:'我仍有首夜遗言'});assert.equal(nextTask(g).kind,'guard');assert.equal(g.day,2);
  const h=election({board:'whiteWolf',kill:5,poison:4});h.pending={id:'poisoned',actor:4,kind:'sheriffSignup'};
  assert.throws(()=>answer(h,{explode:true,target:9}),/吃毒/);assert.ok(h.players[8].alive);answer(h,{explode:true,target:null});assert.equal(h.players[8].alive,true);
});
test('death of sheriff transfers or tears badge, explosion sheriff cannot transfer',()=>{
  const g=setup();g.sheriff=9;ballot(g,'vote',{candidates:[9],eligible:[1]});answer(g,{target:9});assert.equal(nextTask(g).kind,'lastWords');answer(g,{text:'遗言'});assert.equal(nextTask(g).kind,'badge');answer(g,{target:5});assert.equal(g.sheriff,5);
  const h=setup();h.sheriff=1;h.phase='speech';h.pending={id:'boomSheriff',actor:1,kind:'speech'};h.queue=[];answer(h,{explode:true,target:null});assert.equal(h.sheriff,null);assert.equal(h.badgeLost,true);assert.ok(!h.queue.some(t=>t.kind==='badge'));
});
test('wolf guns and last-wolf explosion stop once victory is reached; knife victory precedes poison',()=>{
  const g=setup('whiteWolf');for(let i=0;i<3;i++)g.players[i].alive=false;g.phase='speech';g.pending={id:'last',actor:4,kind:'speech'};g.queue=[];answer(g,{explode:true,target:9});assert.equal(g.winner,'好人');assert.ok(g.players[8].alive);
  const h=setup();for(let i=4;i<7;i++)h.players[i].alive=false;h.players[1].alive=h.players[2].alive=h.players[3].alive=false;h.day=2;h.phase='night';h.queue=[];h.pending=null;h.night={kill:8,guard:null,save:false,poison:1};nextTask(h);assert.equal(h.winner,'狼人');assert.ok(h.players[0].alive);
});
test('AI replacement during sealed voting preserves votes and pending continuation without leaking ballots',()=>{
  const g=setup();ballot(g,'vote',{eligible:[5,6,7]});answer(g,{target:2});const old=nextTask(g),before=structuredClone(g.ballot);
  replaceSeat(g,6,{provider:'chatgpt',url:'https://chatgpt.com/c/new-seat-six'});
  while(nextTask(g).handover){const t=g.pending;assert.doesNotMatch(promptFor(g,t),/5号→2号/);acceptReply(g,reply(g,t));}
  assert.equal(g.pending.actor,6);assert.notEqual(g.pending.id,old.id);assert.deepEqual(g.ballot,before);assert.equal(g.votes[5],2);
  answer(g,{target:1});answer(g,{target:1});nextTask(g);assert.ok(g.log.some(e=>e.text.includes('5号→2号')&&e.text.includes('6号→1号')));
});
test('all boards complete 120 simulated serialized games, including elections, skipped turns and explosions',()=>{
  let seed=92;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let explosions=0,elections=0,words=0;
  for(const board of Object.keys(BOARDS))for(let n=0;n<40;n++){
    let g=newGame(seats(),rng,board),steps=0;
    while(!g.winner&&steps++<3500){
      const t=nextTask(g);if(!t)break;assert.ok(g.players.find(p=>p.id===t.actor).alive||['lastWords','hunter','badge'].includes(t.kind));
      let r=reply(g,t,rng);if(t.kind==='explode'&&rng()<.015){r={request_id:t.id,explode:true,target:g.players[t.actor-1].role==='白狼王'?(legalTargets(g,t)[0]??null):null};explosions++;}
      if(t.kind==='sheriffSignup')elections++;if(t.kind==='lastWords')words++;
      const message=messageFor(g,t);assert.ok(message.prompt.length<5000);
      if(!['intro','identity','catchup'].includes(t.kind)&&rng()<.03)skipPending(g);else{acceptReply(g,r);markDelivered(g,t.actor,message.delivery);}
      g=JSON.parse(JSON.stringify(g));
    }
    assert.ok(g.winner,`${board} game ${n} stalled at ${g.phase}`);assert.ok(steps<3500);
  }
  assert.ok(explosions>0);assert.ok(elections>0);assert.ok(words>0);
});
