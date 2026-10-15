const protectedTabs=new Map();
export async function protectTab(tabId){
  if(!chrome.runtime?.id||!chrome.tabs?.get)return;
  if(!protectedTabs.has(tabId)){const tab=await chrome.tabs.get(tabId);protectedTabs.set(tabId,tab.autoDiscardable!==false);}
  await chrome.tabs.update(tabId,{autoDiscardable:false});
}
export async function pulsePage(tabId,url,release=false){
  const results=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:framePulse,args:[url,release]});
  const result=results[0]?.result;if(!result||result.error)throw Error(result?.error||'后台渲染检查没有返回结果');return result;
}
export async function releasePage(tabId,url){
  try{await pulsePage(tabId,url,true)}catch{}
  if(protectedTabs.has(tabId)){try{await chrome.tabs.update(tabId,{autoDiscardable:protectedTabs.get(tabId)})}catch{}protectedTabs.delete(tabId);}
}
// Only service stalled callbacks on this bound conversation; native foreground frames stay native.
function framePulse(url,release){
  const key=raw=>{const u=new URL(raw);for(const p of ['utm_source','utm_campaign','chat_enter_method','onboarding','rid','bizPassParams','from_login'])u.searchParams.delete(p);return u.origin+u.pathname.replace(/\/$/,'')+u.search+u.hash;};
  if(key(location.href)!==key(url))return {error:'后台渲染目标与绑定对话不一致'};
  const name='__werewolfFrameAssistV1';let state=window[name];
  if(release){
    if(state){if(window.requestAnimationFrame===state.request)window.requestAnimationFrame=state.nativeRequest;if(window.cancelAnimationFrame===state.cancel)window.cancelAnimationFrame=state.nativeCancel;state.active=false;
      if(state.visibility){for(const item of state.visibility.items)if(Object.getOwnPropertyDescriptor(document,item.name)?.get===item.get){if(item.original)Object.defineProperty(document,item.name,item.original);else delete document[item.name];}state.visibility=null;document.dispatchEvent(new Event('visibilitychange'));}
      if(state.typing){if(window.setTimeout===state.typing.set)window.setTimeout=state.typing.nativeSet;if(window.clearTimeout===state.typing.clear)window.clearTimeout=state.typing.nativeClear;state.typing=null;}
    }
    return {released:true};
  }
  if(!state){
    const nativeRequest=state?.nativeRequest||window.requestAnimationFrame,nativeCancel=state?.nativeCancel||window.cancelAnimationFrame;
    state={active:true,nativeRequest,nativeCancel,pending:new Map(),assisted:0,errors:0};
    state.request=function(callback){
      if(typeof callback!=='function')return nativeRequest.call(window,callback);
      const entry={callback,at:performance.now()};
      const id=nativeRequest.call(window,time=>{if(!state.pending.delete(id))return;callback.call(window,time)});
      state.pending.set(id,entry);return id;
    };
    state.cancel=function(id){state.pending.delete(id);nativeCancel.call(window,id)};
    window.requestAnimationFrame=state.request;window.cancelAnimationFrame=state.cancel;window[name]=state;
  }
  if(!state.active){state.active=true;window.requestAnimationFrame=state.request;window.cancelAnimationFrame=state.cancel;}
  // ChatGLM gates its incremental text presentation on document visibility.
  // Keep only this bound page's presentation awake; never activate a tab/window.
  if(location.hostname==='chatglm.cn'&&!state.visibility){
    const items=[];let owner=document;
    while(owner&&!Object.getOwnPropertyDescriptor(owner,'visibilityState'))owner=Object.getPrototypeOf(owner);
    const descriptor=owner&&Object.getOwnPropertyDescriptor(owner,'visibilityState');
    const read=descriptor?.get?()=>descriptor.get.call(document):()=>descriptor?.value;
    try{
      for(const [name,value] of [['visibilityState','visible'],['hidden',false]]){
        const original=Object.getOwnPropertyDescriptor(document,name),get=()=>value;
        Object.defineProperty(document,name,{configurable:true,get});items.push({name,original,get});
      }
      state.visibility={items,read};document.dispatchEvent(new Event('visibilitychange'));
    }catch(error){for(const item of items){if(item.original)Object.defineProperty(document,item.name,item.original);else delete document[item.name];}throw error;}
  }
  if(location.hostname==='chatglm.cn'&&!state.typing){
    const typing={nativeSet:window.setTimeout,nativeClear:window.clearTimeout,pending:new Map(),cursor:null,assisted:0};
    typing.set=function(callback,ms,...args){
      if(typeof callback!=='function'||Number(ms)>50||!String(callback).includes('typeWritterId')||!String(callback).includes('answerListDisplay'))return typing.nativeSet.call(window,callback,ms,...args);
      const entry={callback,args,due:(typing.cursor??performance.now())+Math.max(1,Number(ms)||0)};
      const id=typing.nativeSet.call(window,()=>{if(!typing.pending.delete(id))return;callback.apply(window,args)},ms);
      typing.pending.set(id,entry);return id;
    };
    typing.clear=function(id){typing.pending.delete(id);return typing.nativeClear.call(window,id)};
    state.typing=typing;window.setTimeout=typing.set;window.clearTimeout=typing.clear;
  }
  const now=performance.now();
  // Snapshot one batch; recursively scheduled animation work waits for the next pulse.
  const visibility=state.visibility?state.visibility.read():document.visibilityState;
  // Chromium throttles recursive 30ms typewriter timers in hidden pages. Catch
  // up only that identified cosmetic queue, with a strict budget per pulse.
  if(visibility!=='visible'&&state.typing)for(let budget=0;budget<80;budget++){
    const typing=state.typing,due=[...typing.pending].find(([,entry])=>entry.due<=now);if(!due)break;
    const [id,entry]=due;typing.pending.delete(id);typing.nativeClear.call(window,id);typing.cursor=entry.due;
    try{entry.callback.apply(window,entry.args)}catch(error){state.errors++;if(window.reportError)window.reportError(error)}finally{typing.cursor=null;}typing.assisted++;
  }
  const due=visibility==='visible'?[]:[...state.pending].filter(([,entry])=>now-entry.at>=250).slice(0,200);
  for(const [id,entry] of due){
    if(!state.pending.delete(id))continue;state.nativeCancel.call(window,id);
    try{entry.callback.call(window,now)}catch(error){state.errors++;if(window.reportError)window.reportError(error)}state.assisted++;
  }
  return {visibility,presentationAwake:!!state.visibility,typingAssisted:state.typing?.assisted||0,focused:document.hasFocus(),assisted:state.assisted,pending:state.pending.size,errors:state.errors};
}
