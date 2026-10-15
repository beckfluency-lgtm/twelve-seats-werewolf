// Delay in the extension worker so a covered/minimized dashboard is not the clock.
export async function backgroundDelay(ms){
  if(!globalThis.chrome?.runtime?.sendMessage)return new Promise(resolve=>setTimeout(resolve,ms));
  const result=await chrome.runtime.sendMessage({type:'werewolf-delay',ms});
  if(!result?.ok)throw Error('扩展后台计时器未就绪，请重新加载插件后继续读取');
}
