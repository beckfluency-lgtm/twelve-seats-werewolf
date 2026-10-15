import {parseReply,conversationKey} from './core.js';
import {backgroundDelay} from './scheduler.js';
import {protectTab,pulsePage} from './render-assist.js';
const sleep=backgroundDelay;
export async function onPage(tabId, operation, data={}) {
  let renderHealth;
  if(data.config?.renderAssist&&data.expectedUrl&&['read','send','inspect','clickSend'].includes(operation))renderHealth=await pulsePage(tabId,data.expectedUrl);
  const result=await chrome.scripting.executeScript({target:{tabId},...(operation==='send'&&['slatePaste','editorPaste'].includes(data.config?.inputMode)||operation==='clickSend'&&data.config?.sendEvent==='mousedown'?{world:'MAIN'}:{}),func:pageOperation,args:[operation,data]});
  const out=result[0]?.result;if(!out)throw Error('网页没有返回结果');if(out.error)throw Error(out.error);if(renderHealth)out.renderHealth=renderHealth;return out;
}
// This function is serialized into the selected webpage. It never calls model endpoints.
function pageOperation(operation,data) {
  try {
    const visible=e=>!!e&&!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
    const interactable=e=>{if(!visible(e))return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;};
    const normal=s=>String(s||'').replace(/[\u200B\uFEFF]/g,'').replace(/\r\n/g,'\n').trim();
    const find=s=>s?[...document.querySelectorAll(s)].filter(visible):[];
    const input=s=>find(s).filter(e=>interactable(e)&&e.matches('textarea,input,[contenteditable="true"]'));
    const cfg=data.config||{};
    if(operation==='editorHealth')return {url:location.href,visibility:document.visibilityState,focused:document.hasFocus(),answers:find(cfg.reply).slice(-2).map(e=>({text:e.innerText||e.textContent||'',html:e.outerHTML.slice(-3500)})),errors:[...document.querySelectorAll('div,p,span')].filter(e=>visible(e)&&/系统超时|重新生成|重新回答/.test(e.innerText||'')&&(e.innerText||'').length<100).slice(-6).map(e=>e.parentElement.outerHTML.slice(0,6000)),alerts:(document.body.innerText||'').split('\n').filter(t=>/繁忙|网络|失败|重试|频繁|验证|刷新|错误|登录|额度|稍后|异常|停止|正在思考/.test(t)&&t.length<140).slice(-16)};
    if(data.expectedUrl&&conversationKeyForPage(location.href)!==conversationKeyForPage(data.expectedUrl))throw Error('聊天地址与绑定地址不一致');
    function conversationKeyForPage(value){const u=new URL(value);for(const key of ['utm_source','utm_campaign','chat_enter_method','onboarding','rid','bizPassParams','from_login'])u.searchParams.delete(key);return u.origin+u.pathname.replace(/\/$/,'')+u.search+u.hash;}
    if(operation==='hasRequest')return {url:location.href,present:[...document.querySelectorAll('p,pre,div')].some(e=>visible(e)&&!e.closest('textarea,input,[contenteditable=true]')&&!e.querySelector('textarea,input,[contenteditable=true]')&&(e.innerText||e.textContent||'').includes(data.requestId))};
    if(operation==='controls')return {url:location.href,controls:[...document.querySelectorAll('button,input,textarea,[contenteditable=true],[role=button],[role=switch],[role=checkbox],[class*=switch],[class*=toggle],[class*=Send],[class*=send]')].filter(interactable).map(e=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:(e.innerText||'').slice(0,90),checked:e.checked??e.getAttribute('aria-checked'),html:e.outerHTML.slice(0,1800)})).slice(-60),memoryText:(document.body.innerText||'').split('\n').filter(t=>/记忆|Memory|memory|reference|历史引用|搜索历史/.test(t)&&t.length<160).slice(0,20)};
    if(operation==='clickControl'){
      const elements=find(data.selector).filter(interactable);if(elements.length!==1)throw Error('目标控件必须唯一且可见');
      if(elements[0].disabled||elements[0].getAttribute('aria-disabled')==='true')throw Error('目标控件不可用');
      elements[0].click();return {clicked:true,url:location.href};
    }
    if(operation==='stopGeneration'){
      const buttons=find(cfg.stop).filter(interactable);
      if(buttons.length!==1)throw Error('无法唯一识别停止生成按钮，请先打开原对话处理');
      buttons[0].click();return {stopped:true,url:location.href};
    }
    if(operation==='readInit'){
      const matches=[...document.querySelectorAll('div,p,pre,code,article,message-content')].filter(e=>visible(e)&&!e.closest('textarea,input,[contenteditable=true]')&&!e.querySelector('textarea,input,[contenteditable=true]')).map(e=>({e,text:e.innerText||e.textContent||''})).filter(x=>x.text.includes(data.requestId)&&x.text.includes('{')&&x.text.length<4000).sort((a,b)=>a.text.length-b.text.length).slice(0,16);
      return {url:location.href,candidates:matches.map(({e,text})=>{const ancestors=[];for(let i=0;e&&i<7;i++,e=e.parentElement)ancestors.push({tag:e.tagName,class:typeof e.className==='string'?e.className:'',role:e.getAttribute('data-message-author-role'),testid:e.getAttribute('data-testid')});return {text,ancestors};})};
    }
    if(operation==='diagnose'){
      const cssPath=e=>{
        if(e.id)return '#'+CSS.escape(e.id);
        const parts=[];for(let depth=0;e&&e!==document.body&&depth<7;depth++,e=e.parentElement){
          let part=e.tagName.toLowerCase();const classes=[...e.classList].filter(c=>/^[a-zA-Z_][\w-]*$/.test(c));
          if(classes.length)part+=classes.map(c=>'.'+CSS.escape(c)).join('');
          else {const siblings=[...e.parentElement.children].filter(n=>n.tagName===e.tagName);if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(e)+1})`;}
          parts.unshift(part);const candidate=parts.join(' > ');if(document.querySelectorAll(candidate).length===1)return candidate;
        }return parts.join(' > ');
      };
      const info=e=>({tag:e.tagName,selector:cssPath(e),class:e.className,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid'),href:e.getAttribute('href'),type:e.getAttribute('type'),placeholder:e.getAttribute('placeholder')||e.getAttribute('data-placeholder'),title:e.getAttribute('title'),disabled:e.getAttribute('aria-disabled')||e.getAttribute('data-disabled'),text:(e.innerText||'').slice(0,100),svg:e.querySelector('svg')?.outerHTML.slice(0,450)||'',rect:{x:Math.round(e.getBoundingClientRect().x),y:Math.round(e.getBoundingClientRect().y)}});
      return {url:location.href,inputs:[...document.querySelectorAll('textarea,input,[contenteditable="true"]')].filter(interactable).map(info),buttons:[...document.querySelectorAll('button,[role="button"]')].filter(interactable).slice(-28).map(info),extraControls:[...document.querySelectorAll('[class*="send"],[class*="submit"],[data-testid*="send"],svg')].filter(interactable).filter(e=>e.getBoundingClientRect().x>280).slice(-20).map(e=>({...info(e),parent:{tag:e.parentElement?.tagName,class:e.parentElement?.className,label:e.parentElement?.getAttribute('aria-label'),testid:e.parentElement?.getAttribute('data-testid')}})),newChats:[...document.querySelectorAll('button,[role="button"],a,[tabindex],[data-testid]')].filter(e=>interactable(e)&&/^(新建对话|新建聊天|开启新对话|开始新对话|新聊天|新对话|New chat|New conversation|Start (a )?new chat)/i.test(e.innerText?.trim()||e.getAttribute('aria-label')||e.getAttribute('title')||'')&&(e.innerText?.length||0)<50).map(info),replies:[...document.querySelectorAll('.ds-markdown,.markdown,.markdown-body,.prose,[data-message-author-role="assistant"]')].filter(visible).map(info)};
    }
    const read=()=>{
      if(cfg.scanByRequest&&data.requestId){
        const candidates=[...document.querySelectorAll('div,p,pre,code,article,message-content')].filter(e=>visible(e)&&!e.closest('textarea,input,[contenteditable=true]')&&!e.querySelector('textarea,input,[contenteditable=true]')).map(e=>e.innerText||e.textContent||'').filter(text=>text.includes(data.requestId)&&text.includes('{')&&text.length<6000).sort((a,b)=>a.length-b.length);
        return {text:candidates[0]||'',texts:candidates.slice(0,40),count:candidates.length,busy:find(cfg.stop).length>0,url:location.href};
      }
      const replies=find(cfg.reply);const last=replies.at(-1);
      const question=last?.closest('.chat-round')?.querySelector('[class*=message-select-wrapper-question]');
      const currentTurn=!!data.requestId&&!!question&&(question.innerText||question.textContent||'').includes(data.requestId);
      return {text:last?.innerText||last?.textContent||'',count:replies.length,busy:find(cfg.stop).length>0,url:location.href,currentTurn};
    };
    if(operation==='inspect')return {...read(),inputs:input(cfg.input).length,sends:find(cfg.send).length};
    if(operation==='read')return read();
    if(operation==='send'){
      if(find(cfg.stop).length)throw Error('该对话仍在生成回复');
      const entries=input(cfg.input);if(entries.length!==1)throw Error('输入框必须唯一，请重新校准');
      const e=entries[0];const existing=e.value??e.innerText;
      if(normal(existing)&&normal(existing)===normal(data.prompt))return {filled:true,retained:true,url:location.href};
      const replacing=!!data.replaceDraft&&normal(existing).replace(/\s+/g,'')===normal(data.replaceDraft).replace(/\s+/g,'');
      if(normal(existing)&&normal(existing)!==cfg.emptyText&&!replacing)throw Error('输入框已有草稿且与原消息不符，程序不会覆盖');
      if(['slatePaste','editorPaste'].includes(cfg.inputMode)){
        if(cfg.inputMode==='slatePaste'&&!e.matches('[data-slate-editor=true]'))throw Error('千问编辑器结构已变化，已停止后台填写');
        if(cfg.inputMode==='editorPaste'&&!e.matches('[contenteditable=true]'))throw Error('富文本编辑器结构已变化，已停止后台填写');
        e.focus({preventScroll:true});
        const range=document.createRange();range.selectNodeContents(e);if(!replacing)range.collapse(false);
        const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        const transfer=new DataTransfer();transfer.setData('text/plain',data.prompt);
        const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
        e.dispatchEvent(event);
        if(!event.defaultPrevented)throw Error('网页未接管后台粘贴，草稿未发送');
        return {filled:true,method:cfg.inputMode,url:location.href};
      }
      e.focus();
      if(e.matches('textarea,input')){
        const proto=e.matches('textarea')?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(e,data.prompt);
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
      }else{
        const selection=getSelection();const range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand('insertText',false,data.prompt)){
          e.textContent=data.prompt;e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:data.prompt}));
        }
      }
      return {filled:true};
    }
    if(operation==='clickSend'){
      if(data.requestId&&[...document.querySelectorAll('p,pre,code,article,div')].some(e=>visible(e)&&!e.closest('textarea,input,[contenteditable=true]')&&!e.querySelector('textarea,input,[contenteditable=true]')&&(e.innerText||e.textContent||'').includes(data.requestId)))throw Error('当前行动已出现在聊天记录中，请继续读取已有回复，未重复发送');
      if(find(cfg.stop).length)throw Error('该对话仍在生成回复');
      const entries=input(cfg.input);if(entries.length!==1)throw Error('输入框变化，请检查网页');
      const text=entries[0].value??entries[0].innerText;
      if(normal(text).replace(/\s+/g,'')!==normal(data.prompt).replace(/\s+/g,''))throw Error('输入内容未正确同步到网页，已停止发送');
      const buttons=find(cfg.send).filter(interactable);if(buttons.length!==1)throw Error('发送按钮必须唯一，请重新校准');
      if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true'||buttons[0].classList?.contains('ds-button--disabled'))throw Error('发送按钮不可用，请检查登录或页面状态');
      if(cfg.sendEvent==='mousedown')buttons[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window,button:0,buttons:1}));
      else buttons[0].click();return {clicked:true};
    }
    if(operation==='pick'){
      if(window.__werewolfPicker)throw Error('页面正在选择控件，请先完成或按Esc退出');
      const banner=document.createElement('div');banner.textContent='狼人杀校准 · 点击'+data.label+' · Esc取消';
      Object.assign(banner.style,{position:'fixed',top:'8px',left:'50%',transform:'translateX(-50%)',zIndex:'2147483647',background:'#11372e',color:'white',padding:'14px 24px',borderRadius:'12px',pointerEvents:'none'});
      document.body.append(banner);
      const selector=e=>{
        if(e.id)return '#'+CSS.escape(e.id);
        for(const a of ['data-testid','data-test-id','aria-label','data-message-author-role']){
          const v=e.getAttribute(a);if(v)return `${e.tagName.toLowerCase()}[${a}=${JSON.stringify(v)}]`;
        }
        const classes=[...e.classList].filter(c=>!/[\[\]():]/.test(c));
        if(classes.length)return e.tagName.toLowerCase()+classes.map(c=>'.'+CSS.escape(c)).join('');
        if(e.matches('textarea'))return 'textarea';
        if(e.matches('[contenteditable="true"]'))return '[contenteditable="true"]';
        let path=[];while(e&&e!==document.body){let part=e.tagName.toLowerCase();const siblings=[...e.parentElement.children].filter(n=>n.tagName===e.tagName);if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(e)+1})`;path.unshift(part);e=e.parentElement;}return 'body > '+path.join(' > ');
      };
      return new Promise(resolve=>{
        const cleanup=()=>{banner.remove();document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);delete window.__werewolfPicker;};
        const timer=setTimeout(()=>{cleanup();resolve({cancelled:true});},90000);
        const key=e=>{if(e.key==='Escape'){clearTimeout(timer);cleanup();resolve({cancelled:true});}};
        const click=e=>{
          e.preventDefault();e.stopImmediatePropagation();let el=e.target;
          if(data.field==='input')el=el.closest('textarea,input,[contenteditable="true"]');
          if(data.field==='send'||data.field==='stop')el=el.closest('button,[role="button"]');
          if(data.field==='reply')el=el.closest('.markdown,.markdown-body,.prose,message-content,[data-message-author-role="assistant"]')||el;
          if(!el)return;
          const selected=selector(el);clearTimeout(timer);cleanup();resolve({selector:selected,count:find(selected).length});
        };
        window.__werewolfPicker=true;document.addEventListener('click',click,true);document.addEventListener('keydown',key,true);
      });
    }
    throw Error('未知网页操作');
  }catch(e){return {error:e.message};}
}
let workerWindowId=null;
export async function confirmSubmitted(tabId,requestId,expectedUrl,shouldStop=()=>false){
  for(let i=0;i<15;i++){
    if(shouldStop())throw Error('已暂停，原消息已保留，请继续检查提交状态');
    const proof=await onPage(tabId,'hasRequest',{requestId,...(expectedUrl?{expectedUrl}:{})});
    if(proof.present)return true;
    await sleep(500);
  }
  throw Error('网页未确认消息已提交，已暂停并保留原消息，没有再次点击发送。');
}
export async function ensureTab(player,{background=false,render=false}={}) {
  let tab;
  if(player.tabId)try{tab=await chrome.tabs.get(player.tabId);}catch{}
  if(tab&&conversationKey(tab.url||player.url)!==conversationKey(player.url)){tab=null;player.tabId=null;}
  if(!tab){
    const matches=(await chrome.tabs.query({})).filter(t=>{try{return conversationKey(t.url)===conversationKey(player.url);}catch{return false;}});
    if(matches.length>1)throw Error('同一独立对话打开了多个标签页，请只保留一个');
    tab=matches[0]||await chrome.tabs.create({url:player.url,active:!background});player.tabId=tab.id;
  }
  if(conversationKey(tab.url||player.url)!==conversationKey(player.url))throw Error(`${player.id}号标签页已切换到其他对话，请重新绑定`);
  if(background){
    if(render&&chrome.tabs.getCurrent&&chrome.windows?.create){
      const observer=await chrome.tabs.getCurrent();
      if(!observer||!Number.isInteger(observer.windowId))throw Error('无法确认观战台窗口，已停止后台准备');
      if(tab.windowId===observer.windowId){
        let worker=null;if(workerWindowId)try{worker=await chrome.windows.get(workerWindowId)}catch{}
        if(worker&&worker.id!==observer.windowId){await chrome.tabs.move(tab.id,{windowId:worker.id,index:-1});}
        else {worker=await chrome.windows.create({tabId:tab.id,focused:false});}
        workerWindowId=worker.id;tab=await chrome.tabs.get(tab.id);
      }else workerWindowId=tab.windowId;
      // Activate only inside a separate AI window. Never focus that window or change the observer tab.
      await chrome.tabs.update(tab.id,{active:true});
    }else if(tab.discarded)await chrome.tabs.reload(tab.id);
  }
  else {
    await chrome.tabs.update(tab.id,{active:true});
    if(chrome.windows&&Number.isInteger(tab.windowId))await chrome.windows.update(tab.windowId,{focused:true});
  }
  for(let i=0;i<90;i++){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.discarded)break;await sleep(500);}
  if(tab.status!=='complete'||tab.discarded)throw Error('网页加载超时');
  if(background&&chrome.runtime?.id){await protectTab(tab.id);await pulsePage(tab.id,player.url);}
  await sleep(700);return tab.id;
}
export async function waitReply(tabId,config,requestId,expectedUrl,shouldStop,seconds=240,onStatus=()=>{},onProgress=()=>{}) {
  const started=Date.now(),timeoutMs=seconds*1000;
  const until=started+timeoutMs;
  let previous='',stableAt=0,invalidText='',lastStatus='',wrongText='',wrongAt=0,lastBusy=false,lastText=null,receiving=false;
  // Compare the actual JSON, not a changing reasoning/wrapper element around it.
  const signature=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const report=(kind,message)=>{if(lastStatus!==kind){lastStatus=kind;onStatus({kind,message});}};
  while(Date.now()<until){
    if(shouldStop())throw Error('已暂停，待回复保留，可继续读取');
    const snapshot=await onPage(tabId,'read',{config,requestId,expectedUrl});
    if(shouldStop())throw Error('已暂停，待回复保留，可继续读取');
    if(Date.now()>=until)break;
    lastBusy=!!snapshot.busy;
    const observed=snapshot.text||'';
    receiving=lastText!==null&&lastText!==observed&&!!observed;
    lastText=observed;
    if(conversationKey(snapshot.url)!==conversationKey(expectedUrl))throw Error('对话地址发生变化，已停止读取');
    let reply;for(const text of snapshot.texts||[snapshot.text]){try{reply=parseReply(text,requestId);snapshot.text=text;break;}catch{}}
    let wrong;
    if(!reply&&snapshot.currentTurn===true&&!snapshot.busy){try{const parsed=parseReply(snapshot.text);if(/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(parsed.request_id)&&parsed.request_id!==requestId)wrong=parsed;}catch{}}
    if(wrong){
      report('wrongId','已收到本次回复，但AI抄错了行动编号');
      if(wrongText!==snapshot.text){wrongText=snapshot.text;wrongAt=Date.now();}
      if(Date.now()-wrongAt>=5000){const error=new Error('AI回复的行动编号不符，原行动尚未接收。');error.code='REPLY_NONCE_MISMATCH';error.wrongRequestId=wrong.request_id;error.originalReply=wrong;throw error;}
      await sleep(1000);continue;
    }
    wrongText='';wrongAt=0;
    if(reply?.request_id===requestId && !snapshot.busy){
      invalidText='';report('validating','已收到本次回复，正在确认输出完成');
      const content=signature(reply);
      if(previous!==content){previous=content;stableAt=Date.now();}
      if(Date.now()-stableAt>=5000)return {reply,raw:snapshot.text};
    }else{
      previous='';stableAt=0;
      if(snapshot.busy){invalidText='';const elapsed=Math.floor((Date.now()-started)/1000);report('generating-'+Math.floor(elapsed/10),`网页仍显示生成中 · 已等待${elapsed}秒 / ${seconds}秒`);}
      else if(snapshot.text.includes(requestId)){
        report('invalid','已读到本次文本，正在等待完整且可识别的JSON');
        invalidText=snapshot.text;
      }else{invalidText='';report(receiving?'receiving':'waiting',receiving?'网页正文仍在更新，尚未收到完整行动JSON':'尚未读到本次行动编号的回复');}
    }
    onProgress({at:Date.now(),elapsed:Math.floor((Date.now()-started)/1000),seconds,busy:!!snapshot.busy,characters:observed.length,matched:!!reply,stableMs:stableAt?Date.now()-stableAt:0,kind:lastStatus,receiving,renderHealth:snapshot.renderHealth});
    await sleep(1000);
  }
  if(lastBusy)throw Error(`已达到统一的${seconds}秒等待时限，网页仍显示生成中。已暂停并保留原消息，没有重发行动。`);
  if(invalidText)throw Error('已读到本次回复，但在等待期限内仍无法识别完整JSON或匹配行动编号。请检查原聊天的完整回复，再继续读取；没有重发游戏行动。');
  throw Error('等待回复超时。检查登录、额度或页面控件，再继续读取；程序不会自动重发');
}
