import {LEGACY_BACKUP_SEND,BACKUP_ADAPTERS,voteSummary,seatElectionStatus,tableBadgeStatus,reviewEntries,reviewText,reviewLabel,BOARDS,rulesFor,isWolf,MODERN_SKIPPABLE,PROVIDERS,RULES,defaultSeats,newGame,nextTask,promptFor,acceptReply,parseReply,validateSeats,validateConversation,conversationKey,replaceUnconfirmedSeat,replaceSeat,messageFor,markDelivered,retryPending,skipPending,contextPageFor} from './core.js';
import {onPage,ensureTab,waitReply,confirmSubmitted} from './transport.js';
import {backgroundDelay} from './scheduler.js';
import {releasePage} from './render-assist.js';
import {DEFAULT_ADAPTERS} from './core.js';
const $=id=>document.getElementById(id);
const fields={input:'输入框',send:'发送按钮',reply:'AI回复正文',stop:'停止生成按钮，可留空'};
const phases={sheriffSignup:'上警报名',sheriffSpeech:'警长竞选发言',sheriffWithdraw:'退水',sheriffVote:'警长投票',sheriffPK:'警长平票PK',sheriffRunoffVote:'警长复投',dayOrder:'警长选择发言顺序',explosionDeaths:'自爆结算',setup:'开局规则确认',identity:'私人身份确认',night:'夜晚',nightDeaths:'天亮结算',speech:'白天发言',vote:'放逐投票',runoffSpeech:'平票发言',runoffVote:'平票复投',voteDeaths:'放逐结算',finished:'结束'};
const actions={lastWords:'遗言',sheriffSignup:'上警报名',sheriffSpeech:'竞选发言',sheriffWithdraw:'退水',sheriffVote:'选举警长',dayOrder:'安排发言顺序',badge:'移交警徽',explode:'自爆响应',intro:'说明狼人杀规则',identity:'告知私人身份',catchup:'交接本席位进度',guard:'守护',wolfTalk:'狼队交流',wolfKill:'选择刀口',seer:'查验',witch:'用药',speech:'发言',vote:'投票',hunter:'开枪'};
let state={seats:defaultSeats(),adapters:{},game:null,transport:null,probe:null,settings:{timeout:240,discard:true,memory:false,background:true}};
let tabs=[],running=false,busy=false,stop=false,nativeArmed=false,waitingRequestId=null,skipRequestId=null,skipInProgress=false,changingAI=false,preparingGame=false;
let userAdapters={};
let actionsOpen=false;
let saveQueue=Promise.resolve(),configSaveVersion=0;
const save=()=>{saveQueue=saveQueue.catch(()=>{}).then(()=>chrome.storage.local.set({werewolf:state}));return saveQueue;};
async function savePlayerConfig(){
  const version=++configSaveVersion;notice('正在保存配置');
  await save();if(version===configSaveVersion)notice('配置已保存');
}
let feedbackSequence=0,pendingStatus=false,lastNotice='';
function renderNotice(){
  const failure=state.lastError;
  let text=lastNotice||'就绪';
  if(failure&&(!lastNotice||lastNotice===failure.message)){
    const message=/当前适配需要键盘辅助/.test(failure.message)?'后台适配未就绪':failure.message;
    text=[failure.actor?`${failure.actor}号`:'',PROVIDERS[failure.provider]?.name||'',message].filter(Boolean).join(' · ');
  }
  $('notice').textContent=text;
}
const notice=text=>{lastNotice=text;pendingStatus=false;renderNotice();};
document.addEventListener?.('click',event=>{const button=event.target.closest?.('button');if(!button||button.disabled)return;feedbackSequence++;notice(`正在处理 · ${button.textContent}`);pendingStatus=true;},true);
const safe=fn=>async(...args)=>{const sequence=feedbackSequence;try{await fn(...args);if(sequence===feedbackSequence&&pendingStatus)notice('操作已完成');}catch(e){
  if(e.code==='ACTION_SKIPPED')return;
  notice(e.message);running=false;
  if(!/^已暂停|^请先暂停|^正在暂停/.test(e.message)){state.lastError=e.context||errorContext(e.message);try{await save()}catch{}}
  render();
}};
const selected=()=>state.seats[Number($('calibrationSeat').value)-1];
const backgroundMode=()=>state.settings.background!==false;
const gameEnded=()=>!!(state.game?.winner||state.game?.endedAt);
const gameTab=player=>ensureTab(player,{background:backgroundMode(),render:backgroundMode()});
const delay=ms=>typeof backgroundDelay==='function'?backgroundDelay(ms):new Promise(resolve=>setTimeout(resolve,ms));
async function pauseForChange(){
  if(!busy)return;
  stop=true;running=false;nativeArmed=false;render();notice('正在暂停');
  const until=Date.now()+15000;while(busy&&Date.now()<until)await delay(100);
  if(busy)throw Error('当前网页操作尚未退出，原进度已保留，请稍后再次更换。');
}
const suspendedRecords=s=>[s.suspendedTransport,...(s.suspendedTransports||[])].filter(Boolean);
function storeSuspended(s,records){s.suspendedTransport=records[0]||null;if(records.length>1)s.suspendedTransports=records.slice(1);else delete s.suspendedTransports;}
function errorContext(message){
  const record=state.probe||state.replacementProbe||state.transport,task=state.game?.pending;
  const actor=record?.actor||task?.actor;
  const player=(state.game?.players||state.seats).find(p=>p.id===actor);
  return {at:Date.now(),message,actor:actor||null,provider:record?.provider||player?.provider||null,url:record?.url||player?.url||'',requestId:record?.requestId||task?.id||null,kind:state.probe?'probe':state.replacementProbe?'replacement':record?.kind==='context'?'context':task?.kind||null};
}
function clearError(){delete state.lastError;}
function recoverableTask(){
  if(gameEnded())return null;
  const failure=state.lastError,t=state.game?.pending;
  const id=state.transport?.kind==='context'?state.transport.requestId:t?.id;
  return !state.probe&&!state.replacementProbe&&failure&&t&&!state.game.winner&&failure.requestId===id&&failure.actor===t.actor?t:null;
}
const canSkip=t=>!!t&&(state.game?.rulesVersion===2?MODERN_SKIPPABLE:['speech','wolfTalk','vote','guard','wolfKill','seer','witch','hunter']).includes(t.kind);
function skippedRead(){return Object.assign(new Error('本次等待已由用户跳过'),{code:'ACTION_SKIPPED'});}
function archiveRecovery(operation,task){
  const entry={at:Date.now(),operation,actor:task.actor,kind:task.kind,requestId:task.id,transport:state.transport?structuredClone(state.transport):null,error:state.lastError?structuredClone(state.lastError):null};
  state.recoveryHistory=[...(state.recoveryHistory||[]),entry].slice(-50);return entry;
}
function normalizeAdapter(provider,config){
  const cfg={...config};
  if(BACKUP_ADAPTERS[provider]&&cfg.send===LEGACY_BACKUP_SEND)Object.assign(cfg,BACKUP_ADAPTERS[provider],{tested:cfg.tested??false});
  if(provider==='chatglm'&&['.enter-icon-container','.enter-icon-container .enter_icon'].includes(cfg.send)){cfg.sendEvent='mousedown';cfg.confirmSubmission=true;}
  if(provider==='spark'&&cfg.send==='div[class*="AskWindow_send"] img[alt="发送"],div[class*="AskWindow_send"]:not(:has(img)),button[aria-label="发送"]')cfg.send=BACKUP_ADAPTERS.spark.send;
  cfg.renderAssist=backgroundMode();
  if(provider==='deepseek')cfg.nativeSend=cfg.inputMode==='native';
  if(provider==='claude'&&cfg.send==='[data-testid=chat-input-send]')cfg.send='[data-testid=chat-input-send],button[aria-label="Send message"]';
  if(provider==='qianwen'){cfg.nativeSend=false;cfg.inputMode='slatePaste';}
  if(provider==='zai'&&!cfg.stop)cfg.stop='button:has(> span.block.bg-white.size-3)';
  if(provider==='kimi'&&cfg.reply==='.chat-content-item-assistant')cfg.reply='.chat-content-item-assistant .markdown-container';
  return cfg;
}
function configFor(provider){const cfg=userAdapters[provider]||state.adapters[provider]||DEFAULT_ADAPTERS[provider]||{input:'',send:'',reply:'',stop:''};return normalizeAdapter(provider,cfg);}
function configured(provider){const c=configFor(provider);if(!c.input||!c.send||!c.reply)throw Error(`${PROVIDERS[provider].name}尚未完成控件校准`);return c;}
function escNode(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function render(){
  const record=state.probe||state.transport;
  const failure=state.lastError;
  $('errorPanel').hidden=!failure;
  if(failure){
    const provider=PROVIDERS[failure.provider]?.name||'未知平台';
    const action=actions[failure.kind]||({probe:'收发测试',replacement:'更换AI接入',context:'补齐记录'})[failure.kind]||'当前操作';
    if($('errorTitle'))$('errorTitle').textContent=failure.actor?`${failure.actor}号 · ${provider} · ${action}异常`:'观战台操作异常';
    if($('errorDetails'))$('errorDetails').textContent=failure.message;
  }
  $('openErrorSeat').disabled=!failure?.url;
  const recovery=recoverableTask();
  $('resendError').disabled=busy||!recovery;
  $('skipError').disabled=busy||skipInProgress||!canSkip(recovery);
  $('waitActions').hidden=!waitingRequestId;
  $('skipWaiting').disabled=skipInProgress||!waitingRequestId||!!state.probe||!canSkip(state.game?.pending);
  const nativePlayer=record&&(state.game?.players||state.seats).find(p=>p.id===record.actor);
  const nativeTab=record&&tabs.find(t=>{try{return conversationKey(t.url)===conversationKey(record.url);}catch{return false;}});
  if($('nativeBindings'))$('nativeBindings').value=record&&nativePlayer&&nativeTab?JSON.stringify({id:nativePlayer.id,provider:nativePlayer.provider,url:record.url,tabName:nativeTab.title,requestId:record.requestId,status:record.status,armed:nativeArmed}):'';
  const g=state.game;const table=$('table');table.replaceChildren();
  if($('board')){
    const board=g?.rulesVersion===2?g.boardId:g?'legacy':(BOARDS[state.settings.boardId]?state.settings.boardId:'standard');
    $('board').replaceChildren();for(const [id,b] of Object.entries(BOARDS)){const option=escNode('option',b.name);option.value=id;$('board').append(option);}
    if(board==='legacy'){const option=escNode('option','旧版守卫场');option.value='legacy';$('board').append(option);}
    $('board').value=board;$('board').disabled=!!g||busy||preparingGame||changingAI;
  }
  $('rules').textContent=rulesFor(g||{rulesVersion:2,boardId:state.settings.boardId||'standard'});
  if($('badgeStatus')){const badge=tableBadgeStatus(g);$('badgeStatus').hidden=!badge;$('badgeStatus').textContent=badge||'';}
  for(const s of g?.players||state.seats){
    const show=$('reveal').checked;const card=escNode('div',undefined,'seat'+(s.alive===false?' dead':'')+(show&&isWolf(s)?' wolf':''));
    const configured=gameEnded()?state.seats.find(p=>p.id===s.id)||s:s;
    card.append(escNode('strong',`${s.id}号`),escNode('span',PROVIDERS[configured.provider].name),escNode('em',show?(s.role||'尚未发牌'):'身份隐藏'));
    if(!g){const draft=state.setupDrafts?.[s.id];card.append(escNode('small',s.url?'已绑定独立对话':draft?.status==='sent'?'正在等待接入回复':draft?.status==='draft'?'测试草稿已准备':draft?.error?'接入待修正':'等待接入'));}
    else if(g.phase==='setup'||g.phase==='identity')card.append(escNode('small',s.identityConfirmed?'身份已确认':s.rulesConfirmed?'规则已确认':'等待规则确认'));
    const electionStatus=seatElectionStatus(g,s.id);if(electionStatus)card.append(escNode('small',electionStatus,'election-tag'));
    if(g?.sheriff===s.id)card.append(escNode('small','警长','sheriff-tag'));
    if(s.idiotRevealed)card.append(escNode('small','白痴已翻牌 · 无投票权'));
    if(s.alive===false)card.append(escNode('span','已出局'));table.append(card);
  }
  $('status').textContent=g?(g.winner?`${g.winner}获胜`:g.endedAt?'本局已结束':`第${g.day}轮 · ${phases[g.phase]||g.phase}${g.pending?' · '+g.pending.actor+'号行动':''}`):'尚未开局';
  if(g?.handover)$('status').textContent+=` · 正在交接${g.handover.actor}号`;
  const showActions=$('reveal').checked&&actionsOpen;
  const review=reviewEntries(g,showActions);
  const actionColumn=$('actionColumn');if(actionColumn)actionColumn.hidden=!showActions;
  if($('toggleActions')){$('toggleActions').hidden=!$('reveal').checked;$('toggleActions').textContent=showActions?'隐藏行动':'显示行动';$('toggleActions').setAttribute?.('aria-expanded',String(showActions));}
  for(const [id,entries] of [['log',review.speeches],['actionLog',review.actions]]){
    const box=$(id);if(!box)continue;
    const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<64;
    const previous=box.scrollTop;box.replaceChildren();
    for(const e of entries){const row=escNode('div',undefined,'entry'+(e.privateTo!==null?' private':''));row.append(escNode('small',reviewLabel(e)));const votes=voteSummary(e);if(votes){const summary=escNode('div',undefined,'vote-summary');summary.append(escNode('strong',votes.title,'vote-title'));for(const group of votes.groups){const item=escNode('div',undefined,'vote-group'),heading=escNode('div',undefined,'vote-heading');heading.append(escNode('strong',group.target===null?'弃票':group.target+'号'),escNode('span',group.target===null?group.voters.length+'人':group.total+'票','vote-count'));const voters=escNode('div',undefined,'vote-voters');for(const voter of group.voters)voters.append(escNode('span',voter.actor+'号'+(voter.weight===1.5?' · 1.5票':''),'vote-chip'));item.append(heading,voters);summary.append(item);}row.append(summary);}else row.append(escNode('span',reviewText(e,g)));box.append(row);}
    box.scrollTop=nearBottom?box.scrollHeight:previous;
  }
  for(const id of ['step','run','newGame','probe','acceptManual','saveSeats','saveAdapter','refreshTabs','readPending','reloadPending','sendDraft','import','reset','diagnose','diagnoseAll','openPlatforms','draftSeats','connectSeats','connectRemaining','verifySeats'])if($(id))$(id).disabled=busy;
  for(const e of document.querySelectorAll('#bindings input,#bindings select,#selectors input,#selectors button,#calibrationSeat,#openSeat,#inspect'))e.disabled=busy;
  for(const e of document.querySelectorAll('#bindings input,#bindings select'))e.disabled=busy||!!g;
  const locked=changingAI||preparingGame;
  $('newGame').disabled=locked;$('newGame').title='保留上一局本机备份，准备下一场对局';
  const started=!!(g&&(g.startedAt||g.pending||state.transport||g.players.some(p=>p.rulesConfirmed)));
  $('run').textContent=started&&!busy&&!gameEnded()?'继续':'开始';
  $('pause').textContent=busy?'暂停':'结束';
  $('pause').disabled=busy?stop:!g||gameEnded();
  $('step').disabled=busy||locked||!g||gameEnded()||!!state.probe;
  $('run').disabled=busy||locked||gameEnded()||!!state.probe;
  if($('probe'))$('probe').disabled=busy||!!state.transport||!!state.probe;
  if($('readPending'))$('readPending').disabled=busy||(!state.transport&&!state.probe)||(gameEnded()&&!state.probe);
  if($('sendDraft'))$('sendDraft').disabled=busy||!(state.probe||state.transport)||((state.probe||state.transport)?.status==='sent');
  const replaceReason=changingAI?'正在更换AI，测试和交接会自动完成。':preparingGame?'正在准备新局，请稍候。':'';
  $('replaceSeat').disabled=!!replaceReason;$('replaceSeat').title=replaceReason;
  if($('testReplacement'))$('testReplacement').disabled=busy||locked;
  if($('repairReplacement'))$('repairReplacement').disabled=busy||locked||!state.replacementProbe;
  if($('cancelReplacement')){$('cancelReplacement').hidden=!state.replacementProbe;$('cancelReplacement').disabled=busy||locked;}
  if($('previewHandover'))$('previewHandover').disabled=busy||locked||!g||gameEnded();
  for(const id of ['replacement-seat','replacement-provider','replacement-url'])$(id).disabled=locked;
  if($('saveSeats')){$('saveSeats').disabled=busy||!!g;$('saveSeats').title=g?'本局配置已锁定，请使用更换AI。':'';}
  renderNotice();
}
function conversationLink(seat,label){
  let url;try{url=new URL(seat.url);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{return escNode('span','未绑定对话','conversation-unbound');}
  const link=escNode('a',label||url.href,'conversation-link');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.title=`打开${seat.id}号 · ${url.href}`;
  link.onclick=safe(async event=>{event.preventDefault();validateConversation(seat);await ensureTab(seat);});return link;
}
function providerSelect(value){const el=document.createElement('select');for(const [id,p] of Object.entries(PROVIDERS))el.add(new Option(p.name,id));el.value=value;return el;}
function renderBindings(){
  const box=$('bindings');box.replaceChildren();
  for(const seat of state.seats){
    const row=escNode('div',undefined,'binding');row.append(escNode('strong',seat.id+'号'));
    const provider=providerSelect(seat.provider);provider.id='seat-provider-'+seat.id;provider.disabled=!!state.game;
    provider.onchange=safe(async()=>{if(state.game||busy||changingAI||preparingGame)return;seat.provider=provider.value;seat.url='';seat.tabId=null;renderBindings();renderCalibration();render();await savePlayerConfig();});row.append(provider);
    const url=document.createElement('input');url.id='seat-url-'+seat.id;url.className='url';url.placeholder='该玩家专属聊天的完整地址';url.value=seat.url;url.disabled=!!state.game;
    const open=escNode('div',undefined,'binding-open');const refreshOpen=()=>open.replaceChildren(conversationLink(seat,'打开对话'));
    url.oninput=url.onchange=safe(async()=>{if(state.game||busy||changingAI||preparingGame||!state.seats.includes(seat))return;seat.url=url.value.trim();seat.tabId=null;refreshOpen();await savePlayerConfig();});row.append(url);refreshOpen();
    row.append(open);box.append(row);
  }
}
function renderCalibration(){
  if(!$('calibrationSeat'))return;
  const value=$('calibrationSeat').value||'1';$('calibrationSeat').replaceChildren();
  for(const s of state.seats)$('calibrationSeat').add(new Option(`${s.id}号 · ${PROVIDERS[s.provider].name}`,String(s.id)));
  $('calibrationSeat').value=value;const box=$('selectors');box.replaceChildren();
  const cfg=configFor(selected().provider);
  for(const [field,label] of Object.entries(fields)){
    const row=escNode('div',undefined,'selector');row.append(escNode('label',label));
    const input=document.createElement('input');input.id='selector-'+field;input.value=cfg[field]||'';input.placeholder='网页CSS选择器';row.append(input);
    const button=escNode('button','点选');button.onclick=safe(async()=>{
      if(busy)throw Error('请先暂停对局');busy=true;render();
      try{const s=selected();if(!s.url)throw Error('请先绑定该玩家的独立对话');const id=await ensureTab(s);notice('请切换到聊天网页并点击'+label);
        const result=await onPage(id,'pick',{field,label});if(!result.cancelled){input.value=result.selector;notice(`已选择${label}，匹配${result.count}项。保存后请检查。`);}}
      finally{busy=false;render();}
    });row.append(button);box.append(row);
  }
}
function readConfig(){return Object.fromEntries(Object.keys(fields).map(f=>[f,$('selector-'+f).value.trim()]));}
function readSettings(){state.settings={...state.settings,timeout:Math.max(30,Math.min(900,Number($('timeout')?.value??state.settings.timeout)||240)),discard:$('discard')?.checked??state.settings.discard,background:$('background')?.checked??backgroundMode()};}
async function refreshTabs(){tabs=await chrome.tabs.query({});renderBindings();render();}
async function inspect(){
  const s=selected();if(!s.url)throw Error('请先绑定独立对话');const id=await ensureTab(s);const c=readConfig();const result=await onPage(id,'inspect',{config:c});
  notice(`输入框 ${result.inputs}项，发送按钮 ${result.sends}项，回复 ${result.count}项。最新回复预览 ${result.text.slice(0,240)||'无'}。`);
}
async function lowMemory(tabId){
  if(typeof releasePage==='function'){const player=state.game?.players.find(p=>p.tabId===tabId)||state.seats.find(p=>p.tabId===tabId);if(player)await releasePage(tabId,player.url);}
  if(!state.settings.discard)return;
  try{
    if(backgroundMode()){
      if(chrome.tabs.get&&chrome.tabs.getCurrent){
        const tab=await chrome.tabs.get(tabId),observer=await chrome.tabs.getCurrent();
        if(tab.active&&observer&&tab.windowId!==observer.windowId){
          const parked=(await chrome.tabs.query({windowId:tab.windowId})).find(t=>t.url==='about:blank#werewolf-idle');
          if(parked)await chrome.tabs.update(parked.id,{active:true});
          else await chrome.tabs.create({windowId:tab.windowId,url:'about:blank#werewolf-idle',active:true});
        }
      }
    }else{
      await chrome.tabs.update(tabId,{active:false});const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});
    }
    await chrome.tabs.discard(tabId);
  }catch{}
}
async function readyForSend(tabId,config,url){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(stop)throw Error('已暂停，消息尚未发送');
    const before=await onPage(tabId,'inspect',{config,expectedUrl:url});
    if(conversationKey(before.url)!==conversationKey(url))throw Error('聊天地址与绑定地址不一致');
    if(before.inputs>1)throw Error('输入框必须唯一，请重新校准');
    if(before.inputs===1&&(config.scanByRequest||before.count>0))return before;
    await delay(500);
  }
  throw Error('网页控件尚未加载或需要登录，已暂停且未发送消息。');
}
async function prepareSend(player,config,prompt,requestId,kind,delivery=null,replaceDraft=null){
  if(backgroundMode()&&config.nativeSend)throw Error(`${player.id}号当前适配需要键盘辅助，后台模式已暂停，请手动处理或更换AI。`);
  const tabId=await gameTab(player);
  const abandoned=state.abandonedReplies?.[player.id];
  if(abandoned&&conversationKey(abandoned.url)===conversationKey(player.url)){
    replaceDraft=replaceDraft||abandoned.prompt||null;
    let snapshot=await onPage(tabId,'read',{config,expectedUrl:player.url});
    if(snapshot.busy){
      await onPage(tabId,'stopGeneration',{config,expectedUrl:player.url});
      for(let i=0;i<20&&snapshot.busy&&!stop;i++){await delay(500);snapshot=await onPage(tabId,'read',{config,expectedUrl:player.url});}
      if(snapshot.busy)throw Error('上次跳过的回复仍在生成，补齐记录尚未发送，请打开原对话处理');
    }
    delete state.abandonedReplies[player.id];await save();
  }
  await readyForSend(tabId,config,player.url);
  const record={requestId,actor:player.id,tabId,status:'sending',prompt,url:player.url,config:{...config},delivery,...(kind==='context'?{kind:'context',taskId:state.game.pending.id}:{})};
  if(kind==='probe')state.probe=record;else state.transport=record;
  // Persist before clicking. Any interruption thereafter must resume by reading, never automatically resend.
  await save();await onPage(tabId,'send',{config,prompt,expectedUrl:player.url,replaceDraft});await delay(650);
  if(config.nativeSend){record.status='draft';await save();tabs=await chrome.tabs.query({});if($('pendingPrompt'))$('pendingPrompt').value=prompt;throw Error(`${player.id}号消息已准备，需要通过本机键盘同步后点击网页发送，再继续读取已有回复。`);}
  await onPage(tabId,'clickSend',{config,prompt,expectedUrl:player.url,requestId});if(config.confirmSubmission)await confirmSubmitted(tabId,requestId,player.url,()=>stop);record.status='sent';await save();return record;
}
async function readRecord(record){
  const player=state.game?.players.find(p=>p.id===record.actor)||state.seats.find(p=>p.id===record.actor);
  record.config=normalizeAdapter(player.provider,record.config);
  const tabId=await gameTab(player);record.tabId=tabId;await save();
  const read=async()=>{
    waitingRequestId=record.requestId;render();
    let out;
    try{
      let message='正在读取网页';
      out=await waitReply(tabId,record.config,record.requestId,record.url,()=>stop||skipRequestId===record.requestId,state.settings.timeout,info=>{message=info.message;},progress=>{
        const timing=`已等待${progress.elapsed}秒 / ${progress.seconds}秒`;
        notice(`${record.actor}号 · ${message} · ${timing}`);
      });
      if(skipRequestId===record.requestId)throw skippedRead();
    }catch(error){if(skipRequestId===record.requestId)throw skippedRead();throw error;}
    finally{if(waitingRequestId===record.requestId)waitingRequestId=null;if(stop&&typeof releasePage==='function')await releasePage(tabId,record.url);render();}
    const original=record.nonceRepair?.originalReply;
    if(original){
      const before=Object.keys(original).filter(k=>k!=='request_id').sort(),after=Object.keys(out.reply).filter(k=>k!=='request_id').sort();
      if(JSON.stringify(before)!==JSON.stringify(after)||before.some(k=>JSON.stringify(original[k])!==JSON.stringify(out.reply[k])))throw Error(`${record.actor}号更正时改变了原回复内容，已暂停，未接收改变后的行动。`);
    }
    return out;
  };
  try{return await read();}catch(error){
    if(error.code!=='REPLY_NONCE_MISMATCH'||stop)throw error;
    if(record.nonceRepair)throw Error(`${record.actor}号已请求更正一次，但行动编号仍不符。已暂停，请检查原回复。`);
    // Persist the attempt before any UI operation. A refresh never repeats this clarification.
    record.nonceRepair={wrongRequestId:error.wrongRequestId,originalReply:error.originalReply,startedAt:Date.now(),status:'preparing'};await save();
    notice(`${record.actor}号已回复但编号抄错，正在请求只更正编号、保留原行动。`);
    const prompt=`你上一条游戏回复的行动编号抄错。当前仍是同一个行动，不要重新选择或推理。保持你上一条JSON中除request_id以外的所有字段和值完全不变，只更正request_id。\n本次行动编号 ${record.requestId}\n请逐字符复制上面的完整编号，只返回更正后的JSON，不添加说明。`;
    await onPage(tabId,'send',{config:record.config,prompt,expectedUrl:record.url});
    await delay(650);
    await onPage(tabId,'clickSend',{config:record.config,prompt,expectedUrl:record.url});
    record.nonceRepair.status='sent';await save();
    return read();
  }
}
async function completeRecord(record,out,kind){
  if(kind!=='probe'&&gameEnded())throw Error('本局已经结束，未接收后续行动。');
  if(skipRequestId===record.requestId)throw skippedRead();
  kind=record.kind==='context'?'context':kind;
  if(kind==='probe'){
    if(out.reply.text!=='就绪')throw Error('收发测试格式不正确，请查看网页回复');
    const provider=state.seats.find(p=>p.id===record.actor).provider;const tested=record.status==='sent';state.adapters[provider]={...record.config,tested};state.probe=null;
    notice(tested?'单次收发测试通过。正式对局仍需先关闭跨聊天记忆。':'已读取测试回复，自动发送尚未验证，请重新进行收发测试。');
  }else if(kind==='context'){
    if(state.game?.pending?.id!==record.taskId)throw Error('补充记录不属于当前行动');
    if(out.reply.text!=='记录已收到')throw Error('补充记录尚未得到正确确认');
    if(!markDelivered(state.game,record.actor,record.delivery))throw Error('补充记录的确认位置无效，已保留待处理消息');
    state.transport=null;notice(`${record.actor}号已确认本批补充记录，继续补齐或执行当前行动。`);
  }else{
    acceptReply(state.game,out.reply);markDelivered(state.game,record.actor,record.delivery);const provider=state.game.players.find(p=>p.id===record.actor).provider;if(BACKUP_ADAPTERS[provider]&&record.status==='sent')state.adapters[provider]={...record.config,tested:true};state.transport=null;notice(`${record.actor}号行动已完成`);
  }
  if(state.lastError?.requestId===record.requestId)clearError();
  await save();render();await lowMemory(record.tabId);
}
async function step(){
  if(gameEnded())throw Error('本局已经结束，请重设玩家准备新局。');
  if(!state.game)throw Error('请先随机发牌');if(state.probe)throw Error('先处理未完成的收发测试');
  const t=nextTask(state.game);await save();render();if(!t){notice('对局结束');return;}
  if(!state.transport){const records=suspendedRecords(state),at=records.findIndex(r=>(r.kind==='context'?r.taskId:r.requestId)===t.id);if(at>=0){state.transport=records.splice(at,1)[0];storeSuspended(state,records);await save();}}
  let record=state.transport;
  if(record&&(record.kind==='context'?record.taskId:record.requestId)!==t.id)throw Error('待回复记录与行动不一致，请恢复正确的存档');
  if(record?.status==='draft'&&record.config.nativeSend&&backgroundMode())throw Error(`${record.actor}号保留了此前的键盘草稿。请先核对原聊天，再发送已保留的草稿或读取已有回复；后台模式不会自动重发。`);
  if(record?.status==='draft'&&record.config.nativeSend&&nativeArmed){
    tabs=await chrome.tabs.query({});if($('pendingPrompt'))$('pendingPrompt').value=record.prompt;
    throw Error(`${record.actor}号消息已准备，需要通过本机键盘同步后点击网页发送，再继续读取已有回复。`);
  }
  if(!record){
    const p=state.game.players.find(p=>p.id===t.actor),page=contextPageFor(state.game,t);
    if(page){notice(`等待${p.id}号确认未收到的补充记录`);record=await prepareSend(p,configured(p.provider),page.prompt,page.requestId,'context',page.delivery);}
    else{notice(`等待${p.id}号 · ${PROVIDERS[p.provider].name} · ${actions[t.kind]||t.kind}`);const message=messageFor(state.game,t);record=await prepareSend(p,configured(p.provider),message.prompt,t.id,'game',message.delivery);}
  }
  const out=await readRecord(record);await completeRecord(record,out,'game');
}
async function launch(continuous){
  if(gameEnded())throw Error('本局已经结束，请重设玩家准备新局。');
  if(busy)throw Error('已有操作正在进行');readSettings();clearError();busy=true;running=continuous;nativeArmed=continuous&&!backgroundMode();stop=false;render();
  try{if(state.game){state.game.startedAt??=Date.now();await save();}do{await step();if(!continuous||state.game.winner||stop)break;await delay(1800);}while(running);}
  finally{busy=false;running=false;render();if(state.game?.winner)notice(`对局结束 · ${state.game.winner}阵营获胜`);}
}
async function createGame(){
  if(state.transport||state.probe)throw Error('有未完成的消息，请先继续读取');
  readSettings();validateSeats(state.seats);for(const s of state.seats)configured(s.provider);
  if(state.game)throw Error('已有本局存档，请点击准备新局后再开始。');
  state.game=newGame(state.seats,Math.random,BOARDS[state.settings.boardId]?state.settings.boardId:'standard');await save();renderBindings();render();notice('开局流程已创建。点击开始，将先向12席发送规则说明，全部确认后分别告知身份，再进入第一夜。');
}
async function prepareNewGame(){
  if(preparingGame||changingAI)throw Error('当前配置操作正在进行，请稍候');
  preparingGame=true;render();try{
    await pauseForChange();await saveQueue;
    const backup=structuredClone(state),seats=state.seats.map(s=>({...s}));
    await chrome.storage.local.set({werewolfPreviousSession:{savedAt:Date.now(),state:backup}});
    state.game=null;state.transport=null;state.probe=null;state.seats=seats;actionsOpen=false;
    for(const key of ['replacementProbe','replacementReady','suspendedTransport','suspendedTransports','lastError','abandonedReplies','recoveryHistory','setupDrafts','draftAudit','connectionAudit'])delete state[key];
    stop=false;nativeArmed=false;await save();hydrate();await refreshTabs();notice('新局已准备 · AI配置已保留');
  }finally{preparingGame=false;render();}
}
if($('newGame'))$('newGame').onclick=safe(prepareNewGame);
if($('step'))$('step').onclick=safe(()=>launch(false));if($('run'))$('run').onclick=safe(async()=>{if(!state.game)await createGame();await launch(true);});
async function resolveReplacementTab(record){
  await chrome.tabs.get(record.tabId);
  const snapshot=await onPage(record.tabId,'hasRequest',{requestId:record.requestId});
  validateConversation({id:record.actor,provider:record.provider,url:snapshot.url});
  if(!snapshot.present)throw Error('原接入编号未在该聊天正文中找到，未确认接入消息已发送。请核对原对话；程序没有重发，也不会把点击成功当作发送成功。');
  if(state.seats.some(p=>p.url&&conversationKey(p.url)===conversationKey(snapshot.url)))throw Error('新聊天地址属于其他玩家');
  record.url=snapshot.url;$('replacement-url').value=snapshot.url;await save();return record.tabId;
}
async function testReplacement(){
  if(busy||state.probe)throw Error('请先暂停');
  const id=Number($('replacement-seat').value),provider=$('replacement-provider').value,url=$('replacement-url').value.trim();
  if(!Number.isInteger(id)||id<1||id>12)throw Error('席位必须为1至12');
  validateConversation({id,provider,url});
  if(state.seats.some(p=>p.url&&conversationKey(p.url)===conversationKey(url)))throw Error('请使用一段全新的独立聊天');
  const ready=state.replacementReady;
  if(!state.replacementProbe&&ready?.actor===id&&ready.provider===provider&&conversationKey(ready.url)===conversationKey(url)){stop=false;return ready;}
  let record=state.replacementProbe;
  if(record&&(record.actor!==id||record.provider!==provider||conversationKey(record.url)!==conversationKey(url)))throw Error('请先完成上次新AI的接入测试');
  busy=true;stop=false;render();
  try{
    if(!record){
      const config=configured(provider);
      if(config.nativeSend)throw Error('该平台当前需要真实键盘辅助，尚未验证可靠的后台发送。未发送接入消息，请使用已支持后台收发的平台。');
      const tabId=await gameTab({id,provider,url,tabId:null});
      const requestId=crypto.randomUUID(),prompt=`你将接替12人狼人杀中的${id}号玩家。用户只旁观，裁判转发消息，此聊天只属于你这一席。稍后先说明完整规则，再告知原身份和允许接收的进度。现在不要分配身份或模拟游戏。这条消息只测试接入。\n本次行动编号 ${requestId}\n只返回JSON对象，request_id填写本次行动编号，text必须为“就绪”。`;
      record={actor:id,provider,url,tabId,requestId,prompt,config,status:'sending'};state.replacementProbe=record;await save();
      await onPage(tabId,'send',{config,prompt});await onPage(tabId,'clickSend',{config,prompt});if(config.confirmSubmission)await confirmSubmitted(tabId,requestId,null,()=>stop);record.status='clicked';await save();
      const after=await onPage(tabId,'inspect',{config});validateConversation({id,provider,url:after.url});
      if(state.seats.some(p=>p.url&&conversationKey(p.url)===conversationKey(after.url)))throw Error('接入后地址属于其他玩家');
      record.url=after.url;$('replacement-url').value=after.url;await save();
    }
    await resolveReplacementTab(record);record.status='sent';await save();notice(`等待${id}号新AI接入回复`);
    const out=await waitReply(record.tabId,record.config,record.requestId,record.url,()=>stop,state.settings.timeout,()=>{},progress=>notice(`${id}号新AI接入 · 已等待${progress.elapsed}秒 / ${progress.seconds}秒 · ${progress.matched?'已收到确认，正在核验':'正在读取回复'}`));
    if(out.reply.text!=='就绪')throw Error('新AI接入回复不正确');
    state.adapters[provider]={...record.config,tested:true};state.replacementReady={actor:id,provider,url:record.url,requestId:record.requestId};state.replacementProbe=null;
    if(state.lastError?.requestId===record.requestId)clearError();await save();
    notice('新AI已确认接入。点击更换AI即可保留进度更换，无需重复发送接入测试。');return state.replacementReady;
  }finally{busy=false;render();}
}
if($('testReplacement'))$('testReplacement').onclick=safe(testReplacement);
if($('repairReplacement'))$('repairReplacement').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.replacementProbe;if(!record)throw Error('没有等待中的新AI接入测试');
  if(gameEnded())throw Error('本局已经结束，请重设玩家准备新局，无需修正上一局的接入回复。');
  if(record.repairAttempted)throw Error('已请求修正，请再次点击测试新AI对话，只读取已有回复');
  busy=true;stop=false;render();
  try{
    record.repairAttempted=true;await save();
    const prompt=`你上一条回复没有正确抄写行动编号。请重新确认接入，逐字符复制下面这行编号，不能改变任何数字或字母。\n本次行动编号 ${record.requestId}\n只返回一个JSON对象，request_id为上面这行完整编号，text为“就绪”。不要使用上一条回复中的错误编号。`;
    const tabId=await resolveReplacementTab(record);if(!backgroundMode())await chrome.tabs.update(tabId,{active:true});
    await onPage(tabId,'send',{config:record.config,prompt});await onPage(tabId,'clickSend',{config:record.config,prompt});await save();
    notice('已请求新AI修正接入编号。再次点击测试新AI对话，只读取已有回复。');
  }finally{busy=false;render();}
});
if($('previewHandover'))$('previewHandover').onclick=safe(async()=>{
  const id=Number($('replacement-seat').value),player=state.game?.players.find(p=>p.id===id);
  if(!player)throw Error('请先选择本局的有效席位');
  const task={actor:id,id:'预览编号，实际发送时使用新的行动编号',handover:true};
  $('handoverPreview').value=promptFor(state.game,{...task,kind:'identity'})+'\n\n'+promptFor(state.game,{...task,kind:'catchup'});
  $('handoverPreview').hidden=false;
  notice('已生成本席位交接预览，仅在本机显示，尚未发送。');
});
async function applyReplacement(){
  if(busy||state.probe||state.replacementProbe)throw Error('请先暂停并完成收发测试');
  busy=true;render();try{await saveQueue;const id=Number($('replacement-seat').value);
  const backup=structuredClone(state),candidate=structuredClone(state);
  const binding={id,provider:$('replacement-provider').value,url:$('replacement-url').value.trim(),tabId:null};
  validateConversation(binding);if(candidate.seats.some(s=>s.id!==id&&s.url&&conversationKey(s.url)===conversationKey(binding.url)))throw Error('新聊天地址属于其他玩家');
  if(!candidate.game||gameEnded()){
    Object.assign(candidate.seats.find(p=>p.id===id),binding);delete candidate.replacementReady;delete candidate.lastError;
    await chrome.storage.local.set({werewolfBeforeReplacement:{savedAt:Date.now(),state:backup},werewolf:candidate});state=candidate;hydrate();await refreshTabs();notice(`${id}号AI配置已更新`);return;
  }
  replaceSeat(candidate.game,id,{provider:$('replacement-provider').value,url:$('replacement-url').value.trim()});
  const player=candidate.game.players.find(p=>p.id===id);
  Object.assign(candidate.seats.find(p=>p.id===id),{provider:player.provider,url:player.url,tabId:null});
  const records=[...suspendedRecords(candidate),candidate.transport].filter(r=>r&&r.actor!==id);
  storeSuspended(candidate,records.filter((r,index)=>records.findIndex(other=>other.requestId===r.requestId)===index));
  candidate.transport=null;
  delete candidate.replacementReady;delete candidate.lastError;
  await chrome.storage.local.set({werewolfBeforeReplacement:{savedAt:Date.now(),state:backup},werewolf:candidate});
  state=candidate;nativeArmed=false;hydrate();await refreshTabs();
  notice(`${id}号正在交接`);
  }finally{busy=false;render();}
}
if($('replaceSeat'))$('replaceSeat').onclick=safe(async()=>{
  if(changingAI||preparingGame)throw Error('当前配置操作正在进行，请稍候');
  const selection={actor:Number($('replacement-seat').value),provider:$('replacement-provider').value,url:$('replacement-url').value.trim()};
  const resume=running;changingAI=true;render();
  try{
    await pauseForChange();
    validateConversation({id:selection.actor,provider:selection.provider,url:selection.url});
    if(state.probe){await chrome.storage.local.set({werewolfSuspendedProbe:structuredClone(state.probe)});state.probe=null;await save();}
    const old=state.replacementProbe;
    if(old&&(old.actor!==selection.actor||old.provider!==selection.provider||conversationKey(old.url)!==conversationKey(selection.url))){await chrome.storage.local.set({werewolfCancelledReplacement:structuredClone(old)});state.replacementProbe=null;delete state.replacementReady;await save();}
    if(state.game&&!gameEnded()){await testReplacement();if(stop)throw Error('已暂停，接入确认已保留，可点击更换AI继续。');}
    else{state.replacementProbe=null;delete state.replacementReady;stop=false;}
    await applyReplacement();
    if(state.game&&!gameEnded()){
      busy=true;stop=false;render();try{while(state.game.handover&&!stop)await step();}finally{busy=false;render();}
      if(!stop)notice(`${selection.actor}号AI更换完成`);
    }
  }
  catch(error){error.context={...errorContext(error.message),...selection,at:Date.now(),kind:'replacement'};throw error;}
  finally{changingAI=false;render();}
  if(resume&&!stop&&state.game&&!gameEnded())await launch(true);
});
if($('openReplacement'))$('openReplacement').onclick=safe(async()=>{
  const provider=$('replacement-provider').value,url=$('replacement-url').value.trim()||PROVIDERS[provider].home;
  const parsed=new URL(url),home=new URL(PROVIDERS[provider].home);
  if(parsed.protocol!=='https:'||parsed.hostname.replace(/^www\./,'')!==home.hostname.replace(/^www\./,''))throw Error('网址与所选平台不一致，请检查平台和网址');
  const matches=(await chrome.tabs.query({})).filter(t=>{try{return conversationKey(t.url)===conversationKey(url)}catch{return false}});
  const tab=matches[0]||await chrome.tabs.create({url,active:true});await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});notice('已打开所选AI网址。');
});
if($('cancelReplacement'))$('cancelReplacement').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停并等待操作退出');if(!state.replacementProbe)return;
  const record=state.replacementProbe;await chrome.storage.local.set({werewolfCancelledReplacement:structuredClone(record)});
  state.replacementProbe=null;delete state.replacementReady;if(state.lastError?.kind==='replacement')clearError();await save();render();notice('已取消本次接入测试，原玩家和对局进度未变。可以选择另一个平台或新对话重新更换。');
});
if($('openNativeTarget'))$('openNativeTarget').onclick=safe(async()=>{
  const record=state.probe||state.transport;
  if(!nativeArmed||busy||record?.status!=='draft'||!record.config.nativeSend)throw Error('尚未允许键盘辅助提交草稿');
  const player=(state.game?.players||state.seats).find(p=>p.id===record.actor);
  if(!player||conversationKey(player.url)!==conversationKey(record.url))throw Error('辅助目标对话不匹配');
  await ensureTab(player);
});
if($('pause'))$('pause').onclick=safe(async()=>{
  if(busy){stop=true;running=false;nativeArmed=false;render();notice('正在暂停');return;}
  if(!state.game||gameEnded())return;
  state.game.endedAt=Date.now();stop=true;running=false;nativeArmed=false;clearError();render();await save();notice('本局已结束');
});
if($('saveSeats'))$('saveSeats').onclick=safe(async()=>{if(state.game)throw Error('本局玩家配置已锁定');for(const seat of state.seats){const url=$('seat-url-'+seat.id).value.trim();if(url!==seat.url)seat.tabId=null;seat.url=url;seat.provider=$('seat-provider-'+seat.id).value;}readSettings();await save();notice('玩家配置已保存');render();});
if($('refreshTabs'))$('refreshTabs').onclick=safe(refreshTabs);
if($('draftSeats'))$('draftSeats').onclick=safe(async()=>{
  if(busy||state.game)throw Error('请先暂停或结束当前对局');busy=true;stop=false;render();state.setupDrafts??={};const reports=[];
  const inputs={kimi:'.chat-input-editor[contenteditable=true]',doubao:'.tiptap.ProseMirror[contenteditable=true]',qianwen:'[contenteditable=true]',claude:'[contenteditable=true]',gemini:'.ql-editor[contenteditable=true]',mistral:'.ProseMirror[contenteditable=true]',grok:'.query-bar-editor[contenteditable=true]',chatgpt:'.ProseMirror[contenteditable=true][role=textbox]'};
  try{
    const chosen=state.seats.filter(s=>inputs[s.provider]&&!state.seats.some(x=>x.id<s.id&&x.provider===s.provider));
    for(const seat of chosen){
      if(stop)break;if(seat.url){reports.push({seat:seat.id,provider:seat.provider,status:'已绑定，未修改'});continue;}
      if(state.setupDrafts[seat.id]?.status==='draft'){
        const host=new URL(PROVIDERS[seat.provider].home).hostname.replace(/^www\./,'');const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
        if(tab){await chrome.tabs.update(tab.id,{active:true});await delay(1000);state.setupDrafts[seat.id].tabId=tab.id;reports.push({seat:seat.id,provider:seat.provider,status:'已有草稿，未重复填写',...await onPage(tab.id,'diagnose')});}
        continue;
      }
      notice(`正在准备${seat.id}号 · ${PROVIDERS[seat.provider].name}，暂不发送。`);
      const host=new URL(PROVIDERS[seat.provider].home).hostname.replace(/^www\./,'');
      const candidates=(await chrome.tabs.query({})).filter(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
      if(candidates.length!==1){reports.push({seat:seat.id,provider:seat.provider,error:'初始化需要该平台恰好一个标签页',count:candidates.length});continue;}
      const tabId=candidates[0].id;await chrome.tabs.update(tabId,{active:true});
      for(let i=0;i<36;i++){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete'&&!tab.discarded)break;await delay(500);}
      await delay(900);const requestId=state.setupDrafts[seat.id]?.requestId||crypto.randomUUID();
      const prompt=state.setupDrafts[seat.id]?.prompt||`这是${seat.id}号玩家专属对话的准备测试，身份将在正式开局时告知。只输出一个JSON对象，request_id字段的值为${requestId}，text字段的值为就绪。不要添加其他文字。`;
      const record={seat:seat.id,provider:seat.provider,tabId,requestId,prompt,status:'preparing',input:inputs[seat.provider]};state.setupDrafts[seat.id]=record;await save();
      try{await onPage(tabId,'send',{config:{input:record.input,emptyText:seat.provider==='qianwen'?'向千问提问':undefined},prompt});await delay(900);record.status='draft';await save();reports.push({seat:seat.id,provider:seat.provider,tabId,requestId,...await onPage(tabId,'diagnose')});}
      catch(e){record.error=e.message;reports.push({seat:seat.id,provider:seat.provider,error:e.message,...await onPage(tabId,'diagnose')});await save();}
      const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});
    }
    state.draftAudit=reports;await save();const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(reports,null,2);output.scrollIntoView({block:'center'});notice('首批席位草稿已准备，尚未发送。');
  }finally{busy=false;render();}
});
if($('connectSeats'))$('connectSeats').onclick=safe(async()=>{
  if(busy||state.game)throw Error('请先暂停或结束当前对局');busy=true;stop=false;render();const reports=[];
  const sends={kimi:'.send-button-container',doubao:'#flow-end-msg-send',qianwen:'button[aria-label="发送消息"]',claude:'[data-testid=chat-input-send]',gemini:'button[aria-label="Send message"]',mistral:'button[aria-label=Send]',grok:'button[data-testid=chat-submit]',chatgpt:'button[aria-label="发送"]'};
  try{
    for(const record of Object.values(state.setupDrafts||{})){
      if(stop)break;const seat=state.seats.find(s=>s.id===record.seat);if(!seat||seat.url||!sends[seat.provider])continue;
      if(!['draft','sending','sent'].includes(record.status))continue;
      notice(`接入${seat.id}号 · ${PROVIDERS[seat.provider].name}，等待实际回复`);render();
      try{
        const host=new URL(PROVIDERS[seat.provider].home).hostname.replace(/^www\./,'');
        const candidates=(await chrome.tabs.query({})).filter(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
        if(candidates.length!==1)throw Error('该平台须保留一个初始化标签页');
        const tabId=candidates[0].id;record.tabId=tabId;await chrome.tabs.update(tabId,{active:true});await delay(1200);
        if(record.status==='draft'){
          record.status='sending';await save();
          await onPage(tabId,'clickSend',{config:{input:record.input,send:sends[seat.provider]},prompt:record.prompt});record.status='sent';await save();
        }
        let found=null,previous='',stableAt=0;const until=Date.now()+45000;
        while(Date.now()<until&&!stop){
          const snapshot=await onPage(tabId,'readInit',{requestId:record.requestId});
          for(const candidate of snapshot.candidates){let reply;try{reply=parseReply(candidate.text);}catch{continue;}
            if(reply.request_id===record.requestId&&reply.text==='就绪'){
              if(candidate.text!==previous){previous=candidate.text;stableAt=Date.now();}
              if(Date.now()-stableAt>=5000)found={...candidate,url:snapshot.url};break;
            }
          }
          if(found)break;await delay(1000);
        }
        if(!found)throw Error(stop?'已暂停，初始化消息保留':'接入回复尚未确认；再次接入只读取，不会重复发送');
        const key=validateConversation({...seat,url:found.url});
        if(state.seats.some(s=>s.id!==seat.id&&s.url&&conversationKey(s.url)===key))throw Error('同一对话不能绑定两名玩家');
        seat.url=found.url;seat.tabId=tabId;record.status='connected';record.reply=found;delete record.error;
        reports.push({seat:seat.id,provider:seat.provider,...found,...await onPage(tabId,'diagnose')});await save();renderBindings();render();
      }catch(e){record.error=e.message;reports.push({seat:seat.id,provider:seat.provider,status:record.status,error:e.message});await save();render();}
      const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});
    }
    state.connectionAudit=reports;await save();const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(reports,null,2);notice(`首批接入已处理，目前${state.seats.filter(s=>s.url).length}/12席绑定独立对话。`);
  }finally{busy=false;render();}
});
if($('recheckFirst'))$('recheckFirst').onclick=safe(async()=>{
  const g=state.game;if(busy||!g||state.transport||g.players.some(p=>p.identityConfirmed))throw Error('仅可在尚未发送身份且没有待处理消息时复核规则');
  busy=true;stop=false;render();try{
    const p=g.players.find(p=>p.id===1);p.rulesConfirmed=false;g.phase='setup';g.queue=[];
    g.pending={id:crypto.randomUUID(),actor:1,kind:'intro',verifyRules:true};
    for(const e of g.log)if(e.text==='1号规则已理解')e.text='1号此前规则确认未通过聊天记录复核';
    g.log.push({day:0,phase:'setup',text:'重新向1号发送规则并核验人数与座位',privateTo:null,time:Date.now()});
    await save();render();await prepareSend(p,{...configured(p.provider),nativeSend:true},promptFor(g,g.pending),g.pending.id,'game');
  }finally{busy=false;render();}
});
if($('platformAction'))$('platformAction').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const cmd=JSON.parse($('platform-command').value);
  if(!['controls','clickControl'].includes(cmd.operation)||!PROVIDERS[cmd.provider])throw Error('平台操作无效');
  const url=new URL(cmd.url);if(url.protocol!=='https:'||url.hostname.replace(/^www\./,'')!==new URL(PROVIDERS[cmd.provider].home).hostname.replace(/^www\./,''))throw Error('平台地址不匹配');
  const matches=(await chrome.tabs.query({})).filter(t=>{try{return conversationKey(t.url)===conversationKey(cmd.url);}catch{return false;}});
  if(matches.length!==1)throw Error('须有一个已打开的目标设置页面');
  busy=true;render();try{if(cmd.background)await gameTab({url:cmd.url,tabId:matches[0].id});else await chrome.tabs.update(matches[0].id,{active:true});await delay(600);const result=await onPage(matches[0].id,cmd.operation,{selector:cmd.selector});const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(result,null,2);notice('平台设置操作已完成');}finally{busy=false;render();}
});
if($('verifySeats'))$('verifySeats').onclick=safe(async()=>{
  if(busy||state.game)throw Error('请先暂停');busy=true;stop=false;render();const reports=[];
  const defaults={
    deepseek:{input:'textarea',send:'div[role=button]._52c986b',reply:'.ds-assistant-message-main-content'},
    kimi:{input:'.chat-input-editor[contenteditable=true]',send:'.send-button-container',reply:'.chat-content-item-assistant'},
    doubao:{input:'.tiptap.ProseMirror[contenteditable=true]',send:'#flow-end-msg-send',reply:'[data-testid=receive_message] [data-testid=message_content]'},
    qianwen:{input:'[contenteditable=true]',send:'button[aria-label="发送消息"]',reply:'[class*=message-select-wrapper-answer]',emptyText:'向千问提问',nativeSend:true},
    claude:{input:'[contenteditable=true]',send:'[data-testid=chat-input-send]',reply:'[data-testid=assistant-message]'},
    gemini:{input:'.ql-editor[contenteditable=true]',send:'button[aria-label="Send message"]',reply:'model-response-content'},
    mistral:{input:'.ProseMirror[contenteditable=true]',send:'button[aria-label=Send]',reply:'[data-message-author-role=assistant]'},
    grok:{input:'.query-bar-editor[contenteditable=true]',send:'button[data-testid=chat-submit]',reply:'[data-testid=assistant-message]'},
    chatgpt:{input:'.ProseMirror[contenteditable=true][role=textbox]',send:'button[aria-label="发送"]',reply:'[data-message-author-role=assistant]',scanByRequest:true}
  };
  try{
    validateSeats(state.seats);
    for(const seat of state.seats){
      if(stop)break;notice(`核验${seat.id}号 · ${PROVIDERS[seat.provider].name}`);
      try{
        const tabId=await ensureTab(seat);const cfg={...defaults[seat.provider],stop:''};const snapshot=await onPage(tabId,'inspect',{config:cfg});
        if(snapshot.inputs!==1||(!cfg.scanByRequest&&snapshot.count<1))throw Error(`输入框或回复控件未匹配，输入${snapshot.inputs}，回复${snapshot.count}`);
        const record=state.setupDrafts?.[seat.id];
        if(record?.requestId){const actual=await onPage(tabId,'read',{config:cfg,requestId:record.requestId});const reply=parseReply(actual.text);if(reply.request_id!==record.requestId||reply.text!=='就绪')throw Error('初始化回复读取未匹配该席位');}
        state.adapters[seat.provider]={...cfg,tested:state.adapters[seat.provider]?.tested||false};reports.push({seat:seat.id,provider:seat.provider,ready:true,config:cfg});await save();
      }catch(e){reports.push({seat:seat.id,provider:seat.provider,error:e.message});}
      const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});
    }
    state.preflight=reports;await save();const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(reports,null,2);renderCalibration();notice(`实际控件已核验 ${reports.filter(r=>r.ready).length}/12席。`);
  }finally{busy=false;render();}
});
if($('connectRemaining'))$('connectRemaining').onclick=safe(async()=>{
  if(busy||state.game)throw Error('请先暂停或结束当前对局');busy=true;stop=false;render();state.setupDrafts??={};const reports=[];
  const configs={deepseek:{input:'textarea',send:'div[role=button]._52c986b'},kimi:{input:'.chat-input-editor[contenteditable=true]',send:'.send-button-container'},claude:{input:'[contenteditable=true]',send:'[data-testid=chat-input-send]'}};
  try{
    for(const seat of state.seats.filter(s=>[9,10,11].includes(s.id)&&!s.url)){
      if(stop)break;notice(`新建${seat.id}号 · ${PROVIDERS[seat.provider].name}独立聊天`);
      let record=state.setupDrafts[seat.id];
      try{
        const config=configs[seat.provider];if(!config)throw Error('该平台尚无独立对话初始化配置');
        if(!record){
          const tab=await chrome.tabs.create({url:PROVIDERS[seat.provider].home,active:true});const requestId=crypto.randomUUID();
          record={seat:seat.id,provider:seat.provider,tabId:tab.id,requestId,status:'created',prompt:`你将作为${seat.id}号玩家参加12人狼人杀，每个玩家使用独立聊天，用户只旁观。开局时裁判会发送完整规则并私下告知你的身份；现在不要分配身份或模拟整场游戏。此消息只测试该席位的独立对话是否可用。只输出一个JSON对象，request_id字段填写${requestId}，text字段填写“就绪”。`};
          state.setupDrafts[seat.id]=record;await save();
        }
        let tab;try{tab=await chrome.tabs.get(record.tabId);}catch{throw Error('该席位初始化标签页已关闭，请先检查保留的接入记录');}
        await chrome.tabs.update(tab.id,{active:true});
        for(let i=0;i<60;i++){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.discarded)break;await delay(500);}
        await delay(1800);
        if(state.seats.some(s=>s.url&&conversationKey(s.url)===conversationKey(tab.url)))throw Error('新页仍指向已绑定聊天，拒绝重复使用');
        if(record.status==='created'){
          let ready=false;for(let i=0;i<20;i++){const snapshot=await onPage(tab.id,'inspect',{config});if(snapshot.inputs===1){ready=true;break;}await delay(500);}
          if(!ready)throw Error('新聊天输入框未加载');
          await onPage(tab.id,'send',{config,prompt:record.prompt});record.status='draft';await save();await delay(1000);
        }
        if(record.status==='draft'){
          record.status='sending';await save();await onPage(tab.id,'clickSend',{config,prompt:record.prompt});record.status='sent';await save();
        }
        let found=null,previous='',stableAt=0;const until=Date.now()+90000;
        while(Date.now()<until&&!stop){
          const snapshot=await onPage(tab.id,'readInit',{requestId:record.requestId});
          for(const candidate of snapshot.candidates){let reply;try{reply=parseReply(candidate.text);}catch{continue;}
            if(reply.request_id===record.requestId&&reply.text==='就绪'){
              if(candidate.text!==previous){previous=candidate.text;stableAt=Date.now();}
              if(Date.now()-stableAt>=5000)found={...candidate,url:snapshot.url};break;
            }
          }
          if(found)break;await delay(1000);
        }
        if(!found)throw Error(stop?'已暂停，消息保留':'尚未读到本席位的确认回复，继续接入时只读取');
        const key=validateConversation({...seat,url:found.url});
        if(state.seats.some(s=>s.id!==seat.id&&s.url&&conversationKey(s.url)===key))throw Error('同一对话不能绑定两名玩家');
        seat.url=found.url;seat.tabId=tab.id;record.status='connected';record.reply=found;delete record.error;
        reports.push({seat:seat.id,provider:seat.provider,...found});await save();renderBindings();render();
      }catch(e){if(record){record.error=e.message;await save();}reports.push({seat:seat.id,error:e.message});render();}
      const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});
    }
    state.remainingAudit=reports;await save();const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(reports,null,2);notice(`独立对话已绑定 ${state.seats.filter(s=>s.url).length}/12席。`);
  }finally{busy=false;render();}
});
if($('diagnoseAll'))$('diagnoseAll').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');busy=true;stop=false;render();const result=[];
  try{
    for(const [provider,p] of Object.entries(PROVIDERS)){
      if(stop)break;notice('读取 '+p.name+' 的实际页面控件');const host=new URL(p.home).hostname.replace(/^www\./,'');
      const candidates=(await chrome.tabs.query({})).filter(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
      if(candidates.length!==1){result.push({provider,error:'该平台需要恰好一个初始化标签页',count:candidates.length});continue;}
      let tab=candidates[0];await chrome.tabs.update(tab.id,{active:true});
      for(let i=0;i<36;i++){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete'&&!tab.discarded)break;await delay(500);}
      await delay(1000);try{result.push({provider,tabId:tab.id,...await onPage(tab.id,'diagnose')});}catch(e){result.push({provider,tabId:tab.id,error:e.message});}
      const me=await chrome.tabs.getCurrent();if(me)await chrome.tabs.update(me.id,{active:true});try{await chrome.tabs.discard(tab.id);}catch{}
    }
    const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(result,null,2);output.scrollIntoView({block:'center'});state.domAudit=result;await save();notice('各平台控件读取完成，未发送消息。');
  }finally{busy=false;render();}
});
if($('openPlatforms'))$('openPlatforms').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');busy=true;stop=false;render();const audit=[];
  try{
    for(const [provider,p] of Object.entries(PROVIDERS)){
      if(stop)break;notice('正在检查 '+p.name+'，检查完成后休眠后台网页。');
      const host=new URL(p.home).hostname.replace(/^www\./,'');const current=await chrome.tabs.query({});
      let tab=current.find(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
      if(!tab)tab=await chrome.tabs.create({url:p.home,active:false});
      // Discarded existing tabs are left intact; login is checked when the user activates them.
      if(tab.discarded){audit.push({provider,name:p.name,tabId:tab.id,url:tab.url,status:'已有休眠网页，点击标签即可恢复'});continue;}
      for(let i=0;i<24;i++){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete')break;await delay(500);}
      await delay(900);let detail;
      try{
        const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
          const lines=(document.body?.innerText||'').split('\n').map(x=>x.trim());
          return {url:location.href,title:document.title,loginLabels:lines.filter(x=>x.length<100&&/登录|登入|Sign in|Log in|Continue with|Verify you are human|Checking your browser|Just a moment|Sorry, you have been blocked/i.test(x)).slice(0,12)};
        }});detail=results[0]?.result||{title:tab.title};
      }catch(e){detail={url:tab.url,title:tab.title,readError:e.message};}
      audit.push({provider,name:p.name,tabId:tab.id,...detail});
      if(!tab.active)try{await chrome.tabs.discard(tab.id);}catch{}
    }
    state.loginAudit=audit;await save();const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(audit,null,2);output.scrollIntoView({block:'center'});
    await refreshTabs();notice('各平台网页已打开。请点击需要使用的平台标签完成登录，验证码请在网站上自行处理。');
  }finally{busy=false;render();}
});
if($('reset'))$('reset').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');
  if(!confirm('结束当前对局并清空玩家绑定？需要保留记录时，请先导出存档。'))return;
  state.game=null;state.transport=null;state.probe=null;state.seats=defaultSeats();state.settings.memory=false;
  for(const key of ['replacementProbe','replacementReady','suspendedTransport','lastError','abandonedReplies','recoveryHistory'])delete state[key];
  delete state.setupDrafts;delete state.draftAudit;delete state.connectionAudit;
  await save();hydrate();await refreshTabs();notice('已重设玩家。下一局请建立12段全新的独立聊天。');
});
if($('prepareNext'))$('prepareNext').onclick=(...args)=>$('reset').onclick(...args);
if($('showPending'))$('showPending').onclick=()=>{$('pendingPrompt').value=(state.probe||state.transport)?.prompt||'没有待处理消息';};
if($('calibrationSeat'))$('calibrationSeat').onchange=renderCalibration;
if($('saveAdapter'))$('saveAdapter').onclick=safe(async()=>{
  const provider=selected().provider;const cfg=readConfig();const old=configFor(provider);
  cfg.tested=!!old.tested&&Object.keys(fields).every(k=>old[k]===cfg[k]);state.adapters[provider]=cfg;
  readSettings();await save();notice('网页校准已保存'+(cfg.tested?'':'，需要通过收发测试'));});
if($('openSeat'))$('openSeat').onclick=safe(async()=>{const s=selected();if(!s.url)throw Error('先绑定一个已建立的独立对话');await ensureTab(s);await save();});
if($('inspect'))$('inspect').onclick=safe(inspect);
if($('diagnose'))$('diagnose').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const seat=selected();const host=new URL(PROVIDERS[seat.provider].home).hostname.replace(/^www\./,'');
  const candidates=(await chrome.tabs.query({})).filter(t=>{try{return new URL(t.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
  let id;if(seat.url)id=await ensureTab(seat);else if(candidates.length===1)id=candidates[0].id;else throw Error('请先绑定独立对话，或仅保留该平台的一个标签页');
  const result=await onPage(id,'diagnose');const output=$('diagnostic-output');output.hidden=false;output.value=JSON.stringify(result,null,2);output.scrollIntoView({block:'center'});notice('网页诊断完成，未发送任何消息。');
});
if($('probe'))$('probe').onclick=safe(async()=>{
  if(busy||state.transport||state.probe)throw Error('先完成待处理的消息');readSettings();busy=true;stop=false;render();
  try{const p=selected();const requestId=crypto.randomUUID();const prompt=`这是网页收发测试。只返回一个JSON对象，不添加其他文字。request_id字段填写${requestId}，text字段填写“就绪”。`;
    const record=await prepareSend(p,configured(p.provider),prompt,requestId,'probe');await completeRecord(record,await readRecord(record),'probe');}
  finally{busy=false;render();}
});
if($('readPending'))$('readPending').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.probe||state.transport;if(!record)throw Error('没有等待中的消息');
  clearError();busy=true;stop=false;readSettings();render();try{await completeRecord(record,await readRecord(record),state.probe?'probe':'game');}finally{busy=false;render();}
});
if($('openErrorSeat'))$('openErrorSeat').onclick=safe(async()=>{
  const failure=state.lastError;if(!failure?.url)throw Error('当前异常没有可打开的玩家对话');
  validateConversation({id:failure.actor,provider:failure.provider,url:failure.url});
  // This explicit user click is the only exception to background window handling.
  await ensureTab({id:failure.actor,provider:failure.provider,url:failure.url,tabId:null});
});
if($('resendError'))$('resendError').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const task=recoverableTask();if(!task)throw Error('异常已不属于当前行动，不能重新发送');
  busy=true;stop=false;nativeArmed=false;running=false;readSettings();render();
  try{
    const player=state.game.players.find(p=>p.id===task.actor),config=configured(player.provider),tabId=await gameTab(player);
    let snapshot=await onPage(tabId,'read',{config,expectedUrl:player.url});
    if(snapshot.busy){
      await onPage(tabId,'stopGeneration',{config,expectedUrl:player.url});
      for(let i=0;i<20&&snapshot.busy&&!stop;i++){await delay(500);snapshot=await onPage(tabId,'read',{config,expectedUrl:player.url});}
      if(snapshot.busy)throw Error('原回复仍在生成，尚未重新发送，请打开原对话处理');
    }
    if(stop)throw Error('已暂停，尚未重新发送');
    const previous=state.transport,archive=archiveRecovery('resend',task);
    const {oldId,newId}=previous?.kind==='context'?{oldId:previous.requestId,newId:crypto.randomUUID()}:retryPending(state.game);
    archive.newRequestId=newId;state.transport=null;clearError();await save();render();
    // Use the exact saved context, with a fresh nonce; late replies to the old request cannot advance this task.
    const message=previous&&typeof previous.prompt==='string'&&previous.prompt.includes(oldId)?{prompt:previous.prompt.split(oldId).join(newId),delivery:previous.delivery}:messageFor(state.game,task);
    const record=await prepareSend(player,config,message.prompt,newId,previous?.kind==='context'?'context':'game',message.delivery,previous?.prompt||null);
    await completeRecord(record,await readRecord(record),'game');
  }finally{busy=false;render();}
  await launch(true);
});
async function skipCurrent(waiting=false){
  if(skipInProgress)return;
  const task=waiting?state.game?.pending:recoverableTask(),record=state.transport;
  if(!task||!canSkip(task))throw Error('当前行动不能跳过，规则、身份和进度确认必须完成');
  if(waiting&&(!waitingRequestId||record?.requestId!==waitingRequestId||record.actor!==task.actor))throw Error('本次等待已结束，请检查当前状态');
  if(!waiting&&busy)throw Error('请先暂停');
  const taskId=task.id;skipInProgress=true;
  try{
    if(busy){
      skipRequestId=record.requestId;stop=true;running=false;render();notice(`正在停止${task.actor}号本次读取，随后跳过。`);
      const deadline=Date.now()+15000;
      while(busy&&Date.now()<deadline)await delay(25);
      if(busy)throw Error('读取尚未停止，已保留原行动，请稍后重试跳过');
    }
    if(state.game?.pending?.id!==taskId){notice('该行动已经结束，没有跳过其他玩家。');return;}
    archiveRecovery('skip',task);skipPending(state.game);state.transport=null;
    if(record)state.abandonedReplies={...(state.abandonedReplies||{}),[task.actor]:{requestId:record.requestId,url:record.url,prompt:record.prompt}};
    if(state.suspendedTransport?.requestId===taskId)state.suspendedTransport=null;
    clearError();await save();render();notice(`已跳过${task.actor}号本次行动，未确认记录将保留到下次补齐。`);
  }finally{skipRequestId=null;skipInProgress=false;render();}
  await launch(true);
}
if($('skipError'))$('skipError').onclick=safe(()=>skipCurrent(false));
if($('skipWaiting'))$('skipWaiting').onclick=safe(()=>skipCurrent(true));

if($('reloadPending'))$('reloadPending').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.probe||state.transport;if(!record)throw Error('没有等待中的消息');
  busy=true;stop=false;render();
  try{
    const player=(state.game?.players||state.seats).find(p=>p.id===record.actor);
    const tabId=await gameTab(player);await chrome.tabs.reload(tabId);
    notice(`${record.actor}号原对话已重新加载，只读取已有回复。`);
    await completeRecord(record,await readRecord(record),state.probe?'probe':'game');
  }finally{busy=false;render();}
});
if($('inspectPending'))$('inspectPending').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.probe||state.transport;if(!record)throw Error('没有待回复消息');
  const player=state.game?.players.find(p=>p.id===record.actor)||state.seats.find(p=>p.id===record.actor);
  const tabId=await gameTab(player),snapshot=await onPage(tabId,'read',{config:record.config,requestId:record.requestId});
  let parsed,error;try{parsed=parseReply(snapshot.text)}catch(e){error=e.message}
  const matches=await onPage(tabId,'readInit',{requestId:record.requestId});
  $('diagnostic-output').hidden=false;$('diagnostic-output').value=JSON.stringify({actor:record.actor,requestId:record.requestId,config:record.config,snapshot,parsed,error,matches},null,2);
  notice('已读取待回复诊断，未重新发送消息。');
});
if($('previewContext'))$('previewContext').onclick=safe(async()=>{
  const task=state.game?.pending||state.game?.queue?.[0];if(!task)throw Error('当前没有可预览的行动');
  const message=messageFor(state.game,task);
  $('diagnostic-output').hidden=false;$('diagnostic-output').value=JSON.stringify({actor:task.actor,kind:task.kind,sentMessagePreserved:!!state.transport,sentPrompt:state.transport?.prompt||'',examplePrompt:message.prompt,sentLength:state.transport?.prompt?.length||0,exampleLength:message.prompt.length,delivery:message.delivery},null,2);
  notice('已在本机预览消息。已发送的待回复消息保持原文，预览不标记为已收到。');
});
if($('sendDraft'))$('sendDraft').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.probe||state.transport;if(!record||record.status==='sent')throw Error('没有可补发的草稿');
  const kind=state.probe?'probe':'game';const player=state.game?.players.find(p=>p.id===record.actor)||state.seats.find(p=>p.id===record.actor);
  busy=true;stop=false;readSettings();render();
  try{
    const config=configured(player.provider);const tabId=await gameTab(player);
    const snapshot=await onPage(tabId,'read',{config});if(conversationKey(snapshot.url)!==conversationKey(record.url))throw Error('对话地址已改变');
    // clickSend verifies the draft exactly matches the saved request. Empty or changed drafts cannot be resent.
    await onPage(tabId,'clickSend',{config,prompt:record.prompt,expectedUrl:record.url,requestId:record.requestId});record.config={...config};record.tabId=tabId;record.status='sent';await save();
    await completeRecord(record,await readRecord(record),kind);
  }finally{busy=false;render();}
});
if($('acceptManual'))$('acceptManual').onclick=safe(async()=>{
  if(busy)throw Error('请先暂停');const record=state.probe||state.transport;
  if(!record)throw Error('没有已发送的待处理消息');const reply=parseReply($('manual').value,record.requestId);
  await completeRecord(record,{reply},state.probe?'probe':'game');$('manual').value='';
});
if($('export'))$('export').onclick=safe(async()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='狼人杀存档-'+new Date().toISOString().replaceAll(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
if($('import'))$('import').onchange=safe(async e=>{
  if(busy)throw Error('请先暂停');const file=e.target.files[0];if(!file)return;
  const value=JSON.parse(await file.text());
  if(!Array.isArray(value.seats)||value.seats.length!==12||!value.adapters||!value.settings)throw Error('存档格式不正确');
  if(value.game){validateSeats(value.game.players);if(value.game.version!==1)throw Error('不支持该版本存档');}
  state=value;state.settings.timeout=Math.max(30,Math.min(900,Number(state.settings.timeout)||240));
  for(const p of [...state.seats,...(state.game?.players||[])])p.tabId=null;
  await save();hydrate();await refreshTabs();notice('存档已恢复，点击执行一步继续。');e.target.value='';
});
function hydrate(){
  const replacement=state.replacementProbe||state.replacementReady;
  $('replacement-provider').replaceChildren();for(const [id,p] of Object.entries(PROVIDERS))$('replacement-provider').add(new Option(p.name,id));$('replacement-provider').value=replacement?.provider||'yuanbao';
  if(replacement){$('replacement-seat').value=replacement.actor;$('replacement-url').value=replacement.url;}
  if($('timeout'))$('timeout').value=state.settings.timeout;if($('discard'))$('discard').checked=state.settings.discard;
  if($('background'))$('background').checked=backgroundMode();
  renderBindings();renderCalibration();render();
}
if($('board'))$('board').onchange=safe(async()=>{if(state.game||busy||preparingGame||changingAI)return;const id=$('board').value;if(!BOARDS[id])throw Error('未知板子');state.settings.boardId=id;await save();render();notice('板子已保存');});
if($('toggleActions'))$('toggleActions').onclick=()=>{actionsOpen=$('reveal').checked&&!actionsOpen;render();};
if($('reveal'))$('reveal').onchange=()=>{if(!$('reveal').checked)actionsOpen=false;render();};if($('private'))$('private').onchange=render;$('rules').textContent=RULES;
async function boot(){
  if(chrome.runtime?.id&&chrome.tabs.getCurrent){const observer=await chrome.tabs.getCurrent();if(observer)await chrome.tabs.update(observer.id,{autoDiscardable:false});}
  const saved=await chrome.storage.local.get(['werewolf','werewolfAdapterOverrides']);if(saved.werewolf)state=saved.werewolf;userAdapters=saved.werewolfAdapterOverrides||{};
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.werewolfAdapterOverrides)userAdapters=changes.werewolfAdapterOverrides.newValue||{};});
  if(!state.game&&state.seats[11]?.provider==='gemini'&&!state.seats[11].url){state.seats[11].provider='chatgpt';await save();}
  hydrate();await refreshTabs();
  if(state.lastError)notice(state.lastError.message);
  else if(state.game?.endedAt)notice('本局已结束');
  else if(state.game?.winner)notice(`${state.game.winner}阵营获胜`);
  else if(state.transport||state.probe)notice('待回复已保留');
}
safe(boot)();
