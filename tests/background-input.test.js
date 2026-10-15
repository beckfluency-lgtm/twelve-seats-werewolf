import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {onPage,confirmSubmitted} from '../transport.js';

function slatePage(accept){
 const events=[];let clicks=0;
 const entry={innerText:'向千问提问',value:undefined,getClientRects:()=>[{}],getBoundingClientRect:()=>({width:100,height:40,bottom:100,right:100,top:50,left:0}),matches:s=>s.includes('contenteditable')||s.includes('data-slate-editor'),focus:()=>events.push('focus'),dispatchEvent:event=>{events.push(event.type);if(accept){entry.innerText=event.clipboardData.getData('text/plain');event.defaultPrevented=true}},closest:()=>entry};
 const button={...entry,innerText:'',click:()=>clicks++};
 const document={querySelectorAll:s=>s==='.input'?[entry]:s==='.send'?[button]:[],createRange:()=>({selectNodeContents(){},collapse(){}})};
 class Transfer{setData(type,text){this.text=text}getData(){return this.text}}
 class Paste{constructor(type,options){this.type=type;Object.assign(this,options);this.defaultPrevented=false}}
 const context=vm.createContext({document,location:{href:'https://www.qianwen.com/chat/saved'},URL,innerWidth:1000,innerHeight:1000,getComputedStyle:()=>({visibility:'visible'}),getSelection:()=>({removeAllRanges(){},addRange(){}}),DataTransfer:Transfer,ClipboardEvent:Paste});
 globalThis.chrome={scripting:{executeScript:async options=>{assert.equal(options.world,'MAIN');context.payload=options.args;return [{result:vm.runInContext(`(${options.func.toString()})(...payload)`,context)}]}}};
 return {events,entry,document,context,get clicks(){return clicks}};
}
test('Slate paste reaches the webpage editor without clicking send or synthesizing raw text mutations',async()=>{
 const page=slatePage(true);
 const result=await onPage(4,'send',{config:{input:'.input',inputMode:'slatePaste',emptyText:'向千问提问'},prompt:'saved original prompt',expectedUrl:'https://www.qianwen.com/chat/saved'});
 assert.equal(result.method,'slatePaste');assert.equal(page.entry.innerText,'saved original prompt');assert.deepEqual(page.events,['focus','paste']);assert.equal(page.clicks,0);
});
test('a rich-text backup editor accepts a background paste without requiring Slate or sending',async()=>{
 const page=slatePage(true);page.entry.innerText='';const matches=page.entry.matches;page.entry.matches=s=>s.includes('data-slate-editor')?false:matches(s);
 const result=await onPage(4,'send',{config:{input:'.input',inputMode:'editorPaste'},prompt:'backup editor draft'});
 assert.equal(result.method,'editorPaste');assert.equal(page.entry.innerText,'backup editor draft');assert.equal(page.clicks,0);
 const unhandled=slatePage(false);unhandled.entry.innerText='';await assert.rejects(onPage(4,'send',{config:{input:'.input',inputMode:'editorPaste'},prompt:'draft'}),/未接管后台粘贴/);assert.equal(unhandled.entry.innerText,'');assert.equal(unhandled.clicks,0);
});
test('ChatGLM dispatches only its actual mousedown submit event, never a second click',async()=>{
 const page=slatePage(false);page.entry.innerText='saved handover';
 const events=[],button={...page.entry,getAttribute:()=>null,dispatchEvent:event=>{events.push(event.type);return true},click:()=>{throw Error('Must not click twice')}};
 page.document.querySelectorAll=s=>s==='.input'?[page.entry]:s==='.send'?[button]:[];
 page.context.window={};page.context.MouseEvent=class{constructor(type,options){this.type=type;Object.assign(this,options)}};
 await onPage(2,'clickSend',{config:{input:'.input',send:'.send',sendEvent:'mousedown'},prompt:'saved handover'});
 assert.deepEqual(events,['mousedown']);
});
test('an unhandled paste or unrelated draft stops without fallback mutation or sending',async()=>{
 const page=slatePage(false);
 const data={config:{input:'.input',inputMode:'slatePaste',emptyText:'向千问提问'},prompt:'saved original prompt'};
 await assert.rejects(onPage(4,'send',data),/未接管后台粘贴/);assert.equal(page.entry.innerText,'向千问提问');assert.equal(page.clicks,0);
 page.entry.innerText='unrelated personal draft';page.events.length=0;
 await assert.rejects(onPage(4,'send',data),/已有草稿/);assert.deepEqual(page.events,[]);
});
test('an action already present in history cannot be submitted twice',async()=>{
 const page=slatePage(false),history={...page.entry,innerText:'saved-request',closest:()=>null,querySelector:()=>null};
 page.document.querySelectorAll=()=>[history];
 chrome.scripting.executeScript=async options=>[{result:options.func(...options.args)}];
 const original={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 Object.assign(globalThis,{document:page.document,location:{href:'https://www.qianwen.com/chat/saved'},getComputedStyle:()=>({visibility:'visible'})});
 try{await assert.rejects(onPage(4,'clickSend',{requestId:'saved-request'}),/未重复发送/);assert.equal(page.clicks,0)}finally{Object.assign(globalThis,original)}
});

test('an identical saved draft is retained and its textarea is not mistaken for an already-sent request',async()=>{
 const page=slatePage(false),prompt='original request saved-id';page.entry.innerText=prompt;
 const wrapper={...page.entry,innerText:prompt,closest:()=>null,querySelector:s=>s.includes('textarea')?page.entry:null};
 const button={...page.entry,innerText:'',getAttribute:()=>null,click:()=>page.events.push('click')};let history=[];
 page.document.querySelectorAll=s=>s==='.input'?[page.entry]:s==='.send'?[button]:[wrapper,...history];
 chrome.scripting.executeScript=async options=>{page.context.payload=options.args;return [{result:vm.runInContext(`(${options.func.toString()})(...payload)`,page.context)}]};
 const data={config:{input:'.input',send:'.send'},prompt,requestId:'saved-id'};
 assert.equal((await onPage(5,'send',data)).retained,true);assert.deepEqual(page.events,[]);
 await onPage(5,'clickSend',data);assert.deepEqual(page.events,['click']);
 history=[{...wrapper,querySelector:()=>null}];await assert.rejects(onPage(5,'clickSend',data),/未重复发送/);assert.deepEqual(page.events,['click']);
});

test('a DeepSeek button disabled through its CSS state cannot be counted as a successful click',async()=>{
 const page=slatePage(false);page.entry.innerText='saved prompt';
 const button={...page.entry,getAttribute:()=>null,classList:{contains:()=>true},click:()=>page.events.push('click')};
 page.document.querySelectorAll=s=>s==='.input'?[page.entry]:s==='.send'?[button]:[];
 chrome.scripting.executeScript=async options=>{page.context.payload=options.args;return [{result:vm.runInContext(`(${options.func.toString()})(...payload)`,page.context)}]};
 await assert.rejects(onPage(5,'clickSend',{config:{input:'.input',send:'.send'},prompt:'saved prompt'}),/发送按钮不可用/);assert.deepEqual(page.events,[]);
});

test('submission confirmation only reads the original nonce, never clicks or resends, and respects pause',async()=>{
 let reads=0;globalThis.chrome={scripting:{executeScript:async options=>{assert.equal(options.args[0],'hasRequest');assert.equal(options.args[1].requestId,'original');return [{result:{present:++reads===2}}]}}};
 assert.equal(await confirmSubmitted(2,'original','https://chatglm.cn/main?cid=test'),true);assert.equal(reads,2);
 await assert.rejects(confirmSubmitted(2,'original',null,()=>true),/已暂停/);assert.equal(reads,2);
});