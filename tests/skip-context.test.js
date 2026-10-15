import {test} from 'node:test';import assert from 'node:assert/strict';import * as core from '../core.js';
function game(){const g=core.newGame(core.defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,core.PROVIDERS[s.provider].home).href})),()=>.999);g.day=3;g.phase='speech';g.queue=[];g.log=[];g.pending={id:'original-action',actor:5,kind:'speech'};return g}
test('skipped records survive refresh and are delivered verbatim in bounded acknowledged pages without leaking private notes',()=>{
 let g=game();const id=g.pending.id,received=[];
 for(let i=0;i<90;i++)g.log.push({day:2,text:`公开记录${i} `+'原文内容'.repeat(70),privateTo:null});
 g.log.push({day:2,text:'只属于5号的记录',privateTo:[5]},{day:2,text:'其他神职秘密',privateTo:[9]});g.players[4].notes.push('5号私人技能记录');
 const first=core.contextPageFor(g,g.pending);assert.ok(first.prompt.length<=5000);const start=structuredClone(g.players[4].delivery);
 // A skipped, unacknowledged page must not consume its records.
 core.skipPending(g);assert.deepEqual(g.players[4].delivery,start);g=JSON.parse(JSON.stringify(g));g.pending={id:'next-action',actor:5,kind:'speech'};
 let pages=0;
 for(;;){const page=core.contextPageFor(g,g.pending);if(!page)break;
  assert.ok(page.prompt.length<=5000);assert.ok(!page.prompt.includes('其他神职秘密'));assert.ok(!page.prompt.includes(core.RULES));
  for(const row of g.log.slice(g.players[4].delivery.log,page.delivery.log))if(row.privateTo===null||row.privateTo.includes(5))received.push(row.text);
  core.markDelivered(g,5,page.delivery);g=JSON.parse(JSON.stringify(g));assert.equal(g.pending.id,'next-action');assert.ok(++pages<100);
 }
 const final=core.messageFor(g,g.pending);assert.ok(final.prompt.length<=5000);assert.ok(!final.prompt.includes('其他神职秘密'));
 const remaining=g.log.slice(g.players[4].delivery.log).filter(e=>e.privateTo===null||e.privateTo.includes(5));
 assert.deepEqual([...received,...remaining.map(e=>e.text)],g.log.filter(e=>e.privateTo===null||e.privateTo.includes(5)).map(e=>e.text));assert.ok(pages>1);
 assert.equal(id,'original-action');assert.ok(g.players[4].notes.includes('5号私人技能记录'));
});
test('ordinary actions keep compact incremental context and setup does not get skipped through a context page',()=>{
 const g=game();g.log.push({text:'刚才遗漏的原文',privateTo:null});assert.equal(core.contextPageFor(g,g.pending),null);
 const sent=core.messageFor(g,g.pending);core.skipPending(g);g.pending={id:'later',actor:5,kind:'vote'};assert.ok(core.messageFor(g,g.pending).prompt.includes('刚才遗漏的原文'));
 core.markDelivered(g,5,sent.delivery);assert.ok(!core.messageFor(g,g.pending).prompt.includes('刚才遗漏的原文'));
 for(const kind of ['intro','identity','catchup'])assert.equal(core.contextPageFor(g,{id:'setup',actor:5,kind}),null);
});
