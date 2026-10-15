let opening;
chrome.action.onClicked.addListener(()=>{
  if(opening)return;
  opening=(async()=>{
    const url=chrome.runtime.getURL('dashboard.html');
    const existing=(await chrome.tabs.query({})).find(tab=>tab.url?.split('?')[0]===url);
    if(existing){await chrome.tabs.update(existing.id,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
    else await chrome.tabs.create({url});
  })().catch(error=>console.error('无法打开观战台',error)).finally(()=>{opening=null;});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='werewolf-delay')return;
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(''))){respond({ok:false});return;}
  if(!Number.isFinite(message.ms)||message.ms<0||message.ms>5000){respond({ok:false});return;}
  setTimeout(()=>respond({ok:true}),message.ms);return true;
});
