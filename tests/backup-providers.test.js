import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROVIDERS,BACKUP_ADAPTERS,validateConversation,validateSeats,defaultSeats} from '../core.js';
test('backup platforms have declared site access and reject login/landing pages before a replacement',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  for(const [id,cfg] of Object.entries(BACKUP_ADAPTERS)){
    const provider=PROVIDERS[id],origin=new URL(provider.home).origin;
    assert.ok(manifest.host_permissions.includes(origin+'/*'),id);
    for(const url of [origin+'/',origin+'/?lang=zh',origin+'/login?redirect=/chat/test',provider.home,...(provider.landingPaths||[]).map(path=>origin+path+'?lang=zh')])assert.throws(()=>validateConversation({id:1,provider:id,url}),/首页|登录页/);
    const url=origin+'/conversation/unique-seat-1';assert.ok(validateConversation({id:1,provider:id,url}));
    const seats=defaultSeats().map(s=>({...s,url:new URL('/conversation/seat-'+s.id,PROVIDERS[s.provider].home).href}));
    seats[0]={id:1,provider:id,url};validateSeats(seats);seats[1]={id:2,provider:id,url};assert.throws(()=>validateSeats(seats),/同一对话/);
    assert.equal(cfg.nativeSend,false);assert.equal(cfg.tested,false);assert.ok(cfg.input&&cfg.send&&cfg.reply);
  }
  assert.ok(validateConversation({id:1,provider:'spark',url:'https://xinghuo.xfyun.cn/desk?chatId=separate-thread'}));
  assert.throws(()=>validateConversation({id:1,provider:'poe',url:'https://chatgpt.com/c/abc'}),/不匹配/);
});
