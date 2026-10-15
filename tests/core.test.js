import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSeats,newGame,nextTask,promptFor,acceptReply,parseReply,legalTargets,validateSeats,winner} from '../core.js';
const hosts={deepseek:'https://chat.deepseek.com',kimi:'https://www.kimi.com',doubao:'https://www.doubao.com',qianwen:'https://www.qianwen.com',claude:'https://claude.ai',gemini:'https://gemini.google.com',mistral:'https://chat.mistral.ai',grok:'https://grok.com',chatgpt:'https://chatgpt.com'};
const seats=()=>defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,hosts[s.provider]).href}));
const game=()=>{const g=newGame(seats(),()=>.999);for(let i=0;i<24;i++){const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}nextTask(g);return g;};
const answer=(g,t,target=null)=>({request_id:t.id,target});
test('fixed role distribution and duplicate/homepage conversation rejection',()=>{
  const g=game();assert.equal(g.players.length,12);assert.equal(g.players.filter(p=>p.role==='狼人').length,4);
  const s=seats();s[8].url=s[0].url;assert.throws(()=>validateSeats(s),/同一对话/);
  s[8].url=s[0].url+'?utm_source=other';assert.throws(()=>validateSeats(s),/同一对话/);
  const tracked=seats();tracked[10].url=tracked[4].url+'?onboarding=1';assert.throws(()=>validateSeats(tracked),/同一对话/);
  const h=seats();h[0].url='https://chat.deepseek.com/';assert.throws(()=>validateSeats(h),/首页/);
  h[0].url='https://example.com/conversation/id';assert.throws(()=>validateSeats(h),/不匹配/);
});
test('every new game explains rules to all seats before private identities and night actions',()=>{
  for(let round=0;round<2;round++){
    const g=newGame(seats(),()=>.999);assert.equal(g.day,0);
    for(let id=1;id<=12;id++){
      const t=nextTask(g);assert.equal(t.kind,'intro');assert.equal(t.actor,id);
      const prompt=promptFor(g,t);assert.ok(prompt.includes('狼人杀'));assert.ok(prompt.includes(`${id}号玩家`));
      assert.ok(!prompt.includes('你的私人身份是'));assert.ok(!prompt.includes('你的狼队友是'));
      assert.throws(()=>acceptReply(g,{request_id:t.id,text:'随便'}),/确认/);
      assert.throws(()=>parseReply(prompt));acceptReply(g,{request_id:t.id,text:'规则已理解'});
    }
    assert.ok(g.players.every(p=>p.rulesConfirmed));
    for(let id=1;id<=12;id++){
      const t=nextTask(g);assert.equal(t.kind,'identity');assert.equal(t.actor,id);
      assert.ok(promptFor(g,t).includes(`你的私人身份是${g.players[id-1].role}`));
      acceptReply(g,{request_id:t.id,text:'身份已收到'});
    }
    assert.equal(nextTask(g).kind,'guard');assert.equal(g.day,1);assert.ok(g.players.every(p=>p.identityConfirmed));
    assert.notEqual(parseReply(promptFor(g,g.pending)).request_id,g.pending.id);
  }
});
test('private knowledge stays out of a civilian prompt',()=>{
  const g=game();g.players[8].notes.push('查验1号为狼人');g.log.push({text:'绝密狼人交流',privateTo:[1,2,3,4]},{text:'公开发言',privateTo:null});
  const p=promptFor(g,{id:'check',actor:5,kind:'speech'});assert.ok(p.includes('身份村民'));assert.ok(p.includes('公开发言'));
  assert.ok(!p.includes('绝密狼人交流'));assert.ok(!p.includes('查验1号为狼人'));assert.ok(!p.includes('狼队友'));
});
test('rule review validates actual seat, faction counts and role receipt',()=>{
  const g=newGame(seats());const t=nextTask(g);t.verifyRules=true;
  assert.throws(()=>parseReply(promptFor(g,t)),/有效JSON/);
  const r={request_id:t.id,text:'规则已理解',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false};
  assert.throws(()=>acceptReply(g,{...r,seat:9}),/回答不正确/);
  assert.throws(()=>acceptReply(g,{...r,roleAssigned:true}),/回答不正确/);
  acceptReply(g,r);assert.equal(g.players[0].rulesConfirmed,true);
});
test('stale replies and illegal targets cannot advance the turn',()=>{
  const g=game();const t=nextTask(g);assert.equal(t.kind,'guard');
  assert.throws(()=>acceptReply(g,{request_id:'old',target:5}),/编号/);assert.equal(g.pending.id,t.id);
  assert.throws(()=>acceptReply(g,answer(g,t,99)),/不合法/);assert.equal(g.pending.id,t.id);
  acceptReply(g,answer(g,t,5));assert.equal(g.lastGuard,5);assert.ok(!legalTargets(g,{kind:'guard',actor:12}).includes(5));
});
test('reply parser handles fences and quoted braces',()=>{
  assert.equal(parseReply('```json\n{"request_id":"a","text":"我看见{线索}","target":null}\n```').text,'我看见{线索}');assert.throws(()=>parseReply('{"target":1}'),/有效JSON/);
});
test('both wolf edge wins and good win',()=>{
  const g=game();g.players.filter(p=>p.role==='村民').forEach(p=>p.alive=false);assert.equal(winner(g),'狼人');
  const h=game();h.players.filter(p=>!['村民','狼人'].includes(p.role)).forEach(p=>p.alive=false);assert.equal(winner(h),'狼人');
  const k=game();k.players.filter(p=>p.role==='狼人').forEach(p=>p.alive=false);assert.equal(winner(k),'好人');
});
function nightFixture({guard=null,save=false,poison=null,kill=5}={}){const g=game();g.queue=[];g.pending=null;g.night={guard,kill,save,poison,wolfVotes:{},wolfTalk:[]};nextTask(g);return g;}
test('protection, rescue, double protection and poison',()=>{
  assert.equal(nightFixture({guard:5}).players[4].alive,true);assert.equal(nightFixture({save:true}).players[4].alive,true);
  assert.equal(nightFixture({guard:5,save:true}).players[4].alive,false);assert.equal(nightFixture({guard:5,poison:5}).players[4].alive,false);
});
test('poisoned hunter cannot fire, other deaths allow a shot',()=>{
  const g=nightFixture({kill:11,poison:11});assert.notEqual(g.pending?.kind,'hunter');
  const h=nightFixture({kill:11});assert.equal(h.pending.kind,'hunter');assert.equal(h.pending.actor,11);
  acceptReply(h,{request_id:h.pending.id,target:1});assert.equal(h.players[0].alive,false);
});
test('witch cannot use two potions or self-save after night one',()=>{
  const g=game();g.queue=[];g.pending={id:'witch',actor:10,kind:'witch'};g.night.kill=10;g.day=2;
  assert.throws(()=>acceptReply(g,{request_id:'witch',save:true,poison:null}),/不能使用解药/);g.day=1;
  assert.throws(()=>acceptReply(g,{request_id:'witch',save:true,poison:1}),/两瓶药/);assert.deepEqual(g.potions,{save:true,poison:true});
});
test('ties enter a runoff, votes are hidden until tally',()=>{
  const g=game();g.phase='vote';g.queue=[];g.pending=null;g.votes={1:5,2:6};const t=nextTask(g);assert.equal(g.phase,'runoffSpeech');assert.equal(t.actor,5);
  const h=game();h.phase='vote';h.queue=[];h.pending={id:'v',actor:1,kind:'vote'};acceptReply(h,{request_id:'v',target:5});assert.ok(!h.log.some(e=>e.text.includes('1号→5号')));
});
test('100 random legal games finish and survive serialization each turn',()=>{
  let seed=7;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let n=0;n<100;n++){
    const g=newGame(seats(),rng);let count=0;
    while(!g.winner&&count++<2000){
      const t=nextTask(g);if(!t)break;let r={request_id:t.id};const choices=legalTargets(g,t);
      if(['intro','identity'].includes(t.kind))r.text=t.kind==='intro'?'规则已理解':'身份已收到';
      else if(['speech','wolfTalk'].includes(t.kind))r.text='我会结合公开发言判断。';
      else if(t.kind==='witch'){const canSave=g.potions.save&&g.night.kill!==null&&(g.night.kill!==t.actor||g.day===1);r.save=canSave&&rng()<.4;r.poison=!r.save&&g.potions.poison&&rng()<.2?choices[Math.floor(rng()*choices.length)]??null:null;}
      else r.target=choices[Math.floor(rng()*choices.length)]??null;
      const before=g.players.filter(p=>p.alive).length;acceptReply(g,r);assert.ok(g.players.filter(p=>p.alive).length<=before);
      const upcoming=nextTask(g);assert.deepEqual(nextTask(JSON.parse(JSON.stringify(g))),upcoming);
    }
    assert.ok(g.winner,`game ${n} failed to finish`);assert.ok(count<2000);
  }
});
