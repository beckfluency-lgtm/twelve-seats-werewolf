import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultSeats,PROVIDERS,newGame,nextTask,acceptReply,promptFor,replaceSeat} from '../core.js';
const binding={provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/new-player'};
test('a new replacement can interrupt handover, preserving the other handover and original game action',()=>{
 const g=night(),role=g.players[0].role;
 replaceSeat(g,1,binding);const intro=nextTask(g);
 replaceSeat(g,2,{provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/second-player'});finishHandover(g,2);
 assert.equal(g.handover.actor,1);assert.equal(nextTask(g).id,intro.id);
 finishHandover(g,1);assert.equal(g.handover,null);assert.equal(nextTask(g).kind,'wolfTalk');assert.equal(g.players[0].role,role);
 replaceSeat(g,1,{provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/third-player'});const abandoned=nextTask(g).id;
 replaceSeat(g,1,{provider:'yuanbao',url:'https://yuanbao.tencent.com/chat/fourth-player'});assert.ok(g.queue.every(task=>task.id!==abandoned));finishHandover(g,1);assert.equal(g.handover,null);
});
function game(){return newGame(defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,PROVIDERS[s.provider].home).href})),()=>.999)}
function night(){const g=game();for(let i=0;i<24;i++){const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}const guard=nextTask(g);acceptReply(g,{request_id:guard.id,target:12});nextTask(g);return g;}
function finishHandover(g,id){
  let t=nextTask(g);assert.equal(t.kind,'intro');assert.equal(t.actor,id);
  assert.doesNotMatch(promptFor(g,t),/你的私人身份是|你的狼队友是/);
  acceptReply(g,{request_id:t.id,text:'规则已理解',seat:id,wolves:4,villagers:4,gods:4,roleAssigned:false});
  t=nextTask(g);assert.equal(t.kind,'identity');assert.doesNotMatch(promptFor(g,t),/尚未开始夜间行动/);
  acceptReply(g,{request_id:t.id,text:'身份已收到'});
  t=nextTask(g);assert.equal(t.kind,'catchup');
  const prompt=promptFor(g,t);acceptReply(g,{request_id:t.id,text:'进度已收到'});return prompt;
}
test('night replacement preserves effects and roles, shares only allowed history and renews the replaced pending action',()=>{
  const g=night();g.potions.save=false;g.players[0].notes.push('my-own-note');g.players[8].notes.push('OTHER-SEER-SECRET');
  g.log.push({day:1,privateTo:[9],text:'OTHER-SEER-SECRET'},{day:1,privateTo:null,text:'public-event'},{day:1,privateTo:[1,2,3,4],text:'wolf-team-event'});
  const before=structuredClone(g);replaceSeat(g,1,binding);
  assert.equal(g.phase,before.phase);assert.equal(g.day,before.day);assert.deepEqual(g.night,before.night);assert.deepEqual(g.potions,before.potions);assert.equal(g.lastGuard,before.lastGuard);
  assert.deepEqual(g.players.map(p=>p.role),before.players.map(p=>p.role));assert.deepEqual(g.players.slice(1),before.players.slice(1));
  assert.throws(()=>acceptReply(g,{request_id:before.pending.id,text:'stale output'}),/没有待处理/);
  const prompt=finishHandover(g,1);assert.match(prompt,/my-own-note/);assert.match(prompt,/public-event/);assert.match(prompt,/wolf-team-event/);assert.doesNotMatch(prompt,/OTHER-SEER-SECRET/);
  const t=nextTask(g);assert.equal(t.kind,before.pending.kind);assert.equal(t.actor,1);assert.notEqual(t.id,before.pending.id);assert.deepEqual(g.queue,before.queue);assert.equal(g.handover,null);
});
test('switching an unrelated seat keeps the other player pending ID and private information isolated',()=>{
  const g=night(),pending=structuredClone(g.pending),queue=structuredClone(g.queue);
  g.log.push({day:1,privateTo:[1,2,3,4],text:'WOLF-PRIVATE'},{day:1,privateTo:[9],text:'OWN-SEER-CHECK'},{day:1,privateTo:[10],text:'WITCH-PRIVATE'});
  replaceSeat(g,9,binding);const prompt=finishHandover(g,9);
  assert.match(prompt,/OWN-SEER-CHECK/);assert.doesNotMatch(prompt,/WOLF-PRIVATE|WITCH-PRIVATE/);
  assert.deepEqual(nextTask(g),pending);assert.deepEqual(g.queue,queue);
});
test('replacement during initial rule confirmation does not disclose identities and preserves the remaining setup queue',()=>{
  const g=game(),pending=nextTask(g);replaceSeat(g,1,binding);const intro=nextTask(g);assert.equal(intro.kind,'intro');assert.notEqual(intro.id,pending.id);
  acceptReply(g,{request_id:intro.id,text:'规则已理解',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false});
  assert.equal(g.handover,null);assert.equal(g.players[0].identityConfirmed,false);const next=nextTask(g);assert.equal(next.actor,2);assert.equal(next.kind,'intro');
});
test('replacing a dead player does not revive them and invalid replacements leave state unchanged',()=>{
  const g=night();g.players[8].alive=false;replaceSeat(g,9,binding);assert.equal(g.players[8].alive,false);assert.match(finishHandover(g,9),/已出局/);assert.equal(g.players[8].alive,false);
  for(const replacement of [{provider:'deepseek',url:g.players[0].url},{provider:'yuanbao',url:'https://yuanbao.tencent.com/'}]){const before=structuredClone(g);assert.throws(()=>replaceSeat(g,1,replacement));assert.deepEqual(g,before);}
});
test('day speech, voting, runoff and hunter replacement preserve accepted actions and pending task options',()=>{
  for(const [phase,kind] of [['speech','speech'],['vote','vote'],['runoffSpeech','speech'],['runoffVote','vote'],['nightDeaths','hunter']]){
    const g=night();g.day=3;g.phase=phase;g.votes={2:3,4:null};g.ties=[1,3];g.shots=[{actor:11,target:null}];
    g.pending={id:crypto.randomUUID(),actor:1,kind,runoff:phase==='runoffVote'};
    if(kind==='hunter'){g.players[0].role='猎人';g.players[0].alive=false;}
    const before=structuredClone(g);replaceSeat(g,1,binding);finishHandover(g,1);const t=nextTask(g);
    assert.equal(g.phase,phase);assert.equal(g.day,3);assert.deepEqual(g.votes,before.votes);assert.deepEqual(g.ties,before.ties);assert.deepEqual(g.shots,before.shots);
    assert.equal(t.kind,kind);assert.equal(t.runoff,before.pending.runoff);assert.notEqual(t.id,before.pending.id);
  }
});
