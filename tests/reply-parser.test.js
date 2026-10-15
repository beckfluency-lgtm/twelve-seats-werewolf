import {test} from 'node:test';import assert from 'node:assert/strict';import {parseReply} from '../core.js';

test('an extra quote before the exact expected UUID is repaired without changing the speech or action',()=>{
  const id='0bff7aab-9d9a-478a-a9d2-5775a4627980';
  const raw=`Thought for 3s\n{"request_id":" "${id}", "text":"我认9号的逻辑，今天归票12号。", "target":null}`;
  assert.deepEqual(parseReply(raw,id),{request_id:id,text:'我认9号的逻辑，今天归票12号。',target:null});
  assert.throws(()=>parseReply(raw,'11111111-1111-4111-8111-111111111111'));
  assert.throws(()=>parseReply(raw));
  assert.throws(()=>parseReply(raw.replace('"target":null','"target":not_json'),id));
});
test('placeholder JSON in reasoning cannot hide the final reply for the expected request',()=>{
  const raw='思考：应返回{"request_id":"...","target":5}。格式为{"request_id":"填写本次行动编号","target":null}。\n{"request_id":"current","target":5}';
  assert.equal(parseReply(raw).request_id,'...');assert.deepEqual(parseReply(raw,'current'),{request_id:'current',target:5});
});
test('a revised final object takes precedence over an earlier draft using the same action ID',()=>{
  const raw='拟定{"request_id":"current","target":3}\n最终答案\n```json\n{"request_id":"current","target":5}\n```';
  assert.equal(parseReply(raw,'current').target,5);
});
test('only stale IDs or format placeholders cannot be accepted for the current action',()=>{
  assert.throws(()=>parseReply('{"request_id":"old","target":5}\n{"request_id":"填写本次行动编号","target":null}','current'),/本次行动编号/);
});
test('JSON-looking text inside a quoted speech is not treated as a later action',()=>{
  const raw=JSON.stringify({request_id:'current',text:'有人说 {"request_id":"current","target":3}，我不采纳',target:null});
  assert.equal(parseReply(raw,'current').target,null);
});
test('mixed typographic delimiters and a truncated accessibility prefix preserve the complete speech',()=>{
  const speech='5号发言，我是村民。请说明“为什么怀疑1号”，别只说跟票。';
  const raw=`Claude responded: {"request_id":"current","text":"5号发言，截断…\n\n{“request_id”:”current",”text”:”${speech}",”target”:null}`;
  assert.deepEqual(parseReply(raw,'current'),{request_id:'current',text:speech,target:null});
});
test('curly quotes inside an already valid JSON speech remain literal speech content',()=>{
  const text='他说“我是预言家”，我保留意见。{不要替我投票}';
  assert.equal(parseReply(JSON.stringify({request_id:'current',text,target:null}),'current').text,text);
});

test('a mismatched literal Chinese quote in a smart-delimited response preserves the original speech',()=>{
  const text='别接“重复观点"的话头，继续独立分析。';
  const raw='{“request_id”: “current”, “text”: “'+JSON.stringify(text).slice(1,-1)+'”, “target”: null}';
  assert.deepEqual(parseReply(raw,'current'),{request_id:'current',text,target:null});
  assert.throws(()=>parseReply(raw,'other'));
  assert.throws(()=>parseReply(raw.replace('null','undefined'),'current'));
  const nested='请解释“他说“预言家”是什么意思”，再投票。';
  assert.equal(parseReply('{“request_id”:“current”,“text”:“'+nested+'”,“target”:null}','current').text,nested);
});

test('unescaped straight speech quotes within smart JSON delimiters remain literal text',()=>{
  const text='别接遗言里"重复主流观点"的话头，继续独立分析。';
  const raw='{“request_id”:“current”,“text”:“'+text+'”,“target”:null}';
  assert.deepEqual(parseReply(raw,'current'),{request_id:'current',text,target:null});
  assert.throws(()=>parseReply(raw,'wrong'));
});
test('typographic compatibility does not repair a wrong nonce or invent missing fields',()=>{
  assert.throws(()=>parseReply('{“request_id”:“other”,”target”:5}','current'),/本次行动编号/);
  assert.deepEqual(parseReply('{“request_id”:“current”,”target”:“5”}','current'),{request_id:'current',target:'5'});
  assert.throws(()=>parseReply('{“request_id”:“current”,”target”:undefined}','current'));
});
