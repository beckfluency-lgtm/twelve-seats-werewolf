import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSeats,PROVIDERS,newGame,nextTask,acceptReply,promptFor,replaceUnconfirmedSeat} from '../core.js';
function waitingNine(){
  const seats=defaultSeats().map(s=>({...s,url:new URL('/conversation/test-'+s.id,PROVIDERS[s.provider].home).href}));
  const g=newGame(seats);
  for(let i=0;i<20;i++){const t=nextTask(g);acceptReply(g,{request_id:t.id,text:t.kind==='intro'?'规则已理解':'身份已收到'});}
  nextTask(g);return g;
}
test('replacement preserves the original deal and other seats, rejects stale replies, and explains rules before identity',()=>{
  const g=waitingNine(),before=structuredClone(g),oldRequest=g.pending.id;
  replaceUnconfirmedSeat(g,9,{provider:'zai',url:'https://zchat.z.ai/c/new-nine'});
  assert.equal(g.id,before.id);assert.deepEqual(g.players.map(p=>p.role),before.players.map(p=>p.role));
  assert.deepEqual(g.players.filter(p=>p.id!==9),before.players.filter(p=>p.id!==9));
  assert.deepEqual(g.queue.slice(2),before.queue);
  let t=nextTask(g);assert.equal(t.kind,'intro');assert.equal(t.actor,9);
  assert.equal(g.players[8].identityConfirmed,false);assert.equal(g.players[8].rulesConfirmed,false);
  assert.doesNotMatch(promptFor(g,t),/你的私人身份是|你的狼队友是/);
  assert.throws(()=>acceptReply(g,{request_id:oldRequest,text:'身份已收到'}),/编号/);
  assert.throws(()=>acceptReply(g,{request_id:t.id,text:'规则已理解',seat:1,wolves:4,villagers:4,gods:4,roleAssigned:false}),/座位/);
  acceptReply(g,{request_id:t.id,text:'规则已理解',seat:9,wolves:4,villagers:4,gods:4,roleAssigned:false});
  t=nextTask(g);assert.equal(t.kind,'identity');assert.equal(t.actor,9);assert.notEqual(t.id,oldRequest);
  assert.ok(promptFor(g,t).includes('你的私人身份是'+before.players[8].role));
  acceptReply(g,{request_id:t.id,text:'身份已收到'});assert.equal(nextTask(g).actor,10);
});
test('replacement rejects shared or reused chats and cannot modify a game after night starts',()=>{
  for(const replacement of [{provider:'deepseek',url:'https://chat.deepseek.com/conversation/test-9'},{provider:'deepseek',url:'https://chat.deepseek.com/conversation/test-1'}]){
    const g=waitingNine(),before=structuredClone(g);assert.throws(()=>replaceUnconfirmedSeat(g,9,replacement));assert.deepEqual(g,before);
  }
  const g=waitingNine();g.day=1;g.phase='night';const before=structuredClone(g);
  assert.throws(()=>replaceUnconfirmedSeat(g,9,{provider:'zai',url:'https://zchat.z.ai/c/new'}));assert.deepEqual(g,before);
});
