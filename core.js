import {BOARDS,isWolf,modern,boardRules,modernWinner,modernNextTask,modernTargets,modernAccept,modernSkip,modernActionPrompt,MODERN_SKIPPABLE} from './rules.js';
import {BASE_ADAPTERS} from './adapters.js';
export {BOARDS,isWolf,MODERN_SKIPPABLE};
export {reviewEntries,reviewText,reviewLabel,seatElectionStatus,tableBadgeStatus,voteSummary} from './review.js';
export const rulesFor=g=>modern(g)?g.rulesText||boardRules(g):RULES;
export const ROLES = ['狼人','狼人','狼人','狼人','村民','村民','村民','村民','预言家','女巫','猎人','守卫'];
export const PROVIDERS = {
  yuanbao: {name:'腾讯元宝', home:'https://yuanbao.tencent.com/'},
  zai: {name:'Z.ai · GLM', home:'https://zchat.z.ai/'},
  deepseek: {name:'DeepSeek', home:'https://chat.deepseek.com/'},
  kimi: {name:'Kimi', home:'https://www.kimi.com/'},
  doubao: {name:'豆包', home:'https://www.doubao.com/chat/'},
  qianwen: {name:'千问', home:'https://www.qianwen.com/'},
  claude: {name:'Claude', home:'https://claude.ai/'},
  gemini: {name:'Gemini', home:'https://gemini.google.com/'},
  mistral: {name:'Le Chat', home:'https://chat.mistral.ai/'},
  grok: {name:'Grok', home:'https://grok.com/'},
  chatgpt: {name:'ChatGPT', home:'https://chatgpt.com/'},
  stepfun: {name:'阶跃AI · Step', home:'https://chat.stepfun.com/',landingPaths:['/chat/new','/chats/new']},
  chatglm: {name:'智谱清言 · GLM', home:'https://chatglm.cn/',landingPaths:['/main','/main/alltoolsdetail']},
  spark: {name:'讯飞星火', home:'https://xinghuo.xfyun.cn/desk',landingPaths:['/desk']},
  qwen: {name:'Qwen 国际版', home:'https://chat.qwen.ai/',landingPaths:['/c/new']},
  perplexity: {name:'Perplexity', home:'https://www.perplexity.ai/',landingPaths:['/discover','/library']},
  poe: {name:'Poe · 多模型', home:'https://poe.com/',landingPaths:['/login','/new_chat']}
};
// Candidate adapters are checked against the live page and an actual reply on replacement.
export const LEGACY_BACKUP_SEND='button[aria-label="Send"],button[aria-label="Send message"],button[aria-label="发送"],button[aria-label="发送消息"],button[data-testid="send-button"],button[type="submit"]';
export const BACKUP_ADAPTERS=Object.fromEntries(['stepfun','chatglm','spark','qwen','perplexity','poe'].map(id=>[id,{
  ...{
    stepfun:{input:'textarea[placeholder]',send:'button:has(svg.custom-icon-send-outline)'},
    chatglm:{input:'textarea.scroll-display-none',send:'.enter-icon-container .enter_icon',sendEvent:'mousedown'},
    spark:{input:'#askwindow-textarea,#login-askwindow-textarea,textarea[placeholder="发消息或语音说话"]',send:'#ask_window_send_btn'},
    qwen:{input:'textarea.message-input-textarea',send:'button.send-button'},
    perplexity:{input:'#ask-input',send:'button[aria-label="提交"],button[aria-label="Submit"],button[aria-label="Send"],button[aria-label="发送"]',inputMode:'editorPaste'},
    poe:{input:'textarea[class*="ChatMessageInput"],textarea[placeholder],[contenteditable=true][role=textbox]',send:'button[class*="ChatMessageSendButton"],button[aria-label="Send message"],button[aria-label="发送消息"],button[aria-label="Send"]'}
  }[id],
  reply:'[data-message-author-role="assistant"],.markdown,.prose,pre',stop:'button[aria-label="Stop generating"],button[aria-label="停止生成"]',scanByRequest:true,nativeSend:false,tested:false,confirmSubmission:true
}]));
export const DEFAULT_ADAPTERS={...BASE_ADAPTERS,...BACKUP_ADAPTERS};
export const RULES = '12人，4狼人4村民，预言家、女巫、猎人、守卫各1人。无警长，无遗言。狼人消灭全部村民或全部神职获胜；好人消灭全部狼人获胜。守卫可自守，不可连续两夜守同一人，也可空守。女巫仅首夜可自救，一夜最多使用一瓶药，解药用完后不告知刀口。同守同救仍死亡。猎人被毒不能开枪，其他死亡可开枪或放弃。狼人刀人平票取最小座位号。放逐平票后候选人发言，其他人复投，仍平票则无人出局。';
const uid = () => globalThis.crypto.randomUUID();
export function defaultSeats() {
  const ids=['deepseek','kimi','doubao','qianwen','claude','gemini','mistral','grok','deepseek','kimi','claude','chatgpt'];
  return ids.map((provider,i)=>({id:i+1,provider,url:'',tabId:null}));
}
export function conversationKey(raw) {
  const u=new URL(raw);for(const key of ['utm_source','utm_campaign','chat_enter_method','onboarding','rid','bizPassParams','from_login'])u.searchParams.delete(key);
  // Fragments sometimes identify SPA conversations and must be preserved.
  return u.origin+u.pathname.replace(/\/$/,'')+u.search+u.hash;
}
export function validateConversation(s) {
    if(!PROVIDERS[s.provider]) throw Error(`${s.id}号的平台无效`);
    let u; try {u=new URL(s.url);} catch {throw Error(`${s.id}号缺少独立对话地址`);}
    const home=new URL(PROVIDERS[s.provider].home);
    if(u.protocol!=='https:' || u.hostname.replace(/^www\./,'')!==home.hostname.replace(/^www\./,''))
      throw Error(`${s.id}号对话地址与平台不匹配`);
    if(BACKUP_ADAPTERS[s.provider]){
      const path=u.pathname.replace(/\/$/,'')||'/',hasId=['chatId','chat_id','conversationId','conversation_id','cid','id','sessionId'].some(key=>u.searchParams.get(key))||/(?:chat|conversation|session)\/[^/?#]+/.test(u.hash);
      if(/\/(?:login|signin|sign-in|register)(?:\/|$)/i.test(path)||((['/',...(PROVIDERS[s.provider].landingPaths||[])].includes(path))&&!hasId))throw Error(`${s.id}号仍是首页或登录页，请先建立一个独立聊天再绑定`);
    }
    // A homepage/new-chat landing address is not an established conversation.
    if(['','/','/chat','/chat/','/app','/app/'].includes(u.pathname) && !u.hash && !u.search)
      throw Error(`${s.id}号仍是首页，请先建立一个独立聊天再绑定`);
    return conversationKey(s.url);
}
export function validateSeats(seats) {
  if(seats.length!==12) throw Error('必须配置12名玩家');
  if(new Set(seats.map(s=>s.id)).size!==12 || seats.some(s=>!Number.isInteger(s.id)||s.id<1||s.id>12))throw Error('玩家座位号必须为不重复的1至12');
  const seen=new Set();
  for(const s of seats) {
    const key=validateConversation(s);
    if(seen.has(key)) throw Error('同一对话不能绑定两名玩家');
    seen.add(key);
  }
}
export function newGame(seats, rng=Math.random, boardId='legacy') {
  validateSeats(seats);
  if(boardId!=='legacy'&&!BOARDS[boardId])throw Error('未知板子');
  const roles=[...(BOARDS[boardId]?.roles||ROLES)];
  for(let i=roles.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[roles[i],roles[j]]=[roles[j],roles[i]];}
  const g={version:1,id:uid(),day:0,phase:'setup',players:seats.map((s,i)=>({...s,role:roles[i],alive:true,notes:[],delivery:{version:1,conversation:conversationKey(s.url),log:0,notes:0}})),
    log:[],queue:[],pending:null,night:{},potions:{save:true,poison:true},lastGuard:null,winner:null,votes:{},ties:[],shots:[],afterDeaths:null};
  if(boardId!=='legacy'){Object.assign(g,{rulesVersion:2,boardId,sheriff:null,badgeLost:false,ballot:null});g.rulesText=boardRules(g);}
  for(const p of g.players)task(g,p.id,'intro');
  log(g,'向12名玩家说明规则，等待逐席确认');return g;
}
const live = g => g.players.filter(p=>p.alive);
const get = (g,id) => g.players.find(p=>p.id===id);
export function replaceUnconfirmedSeat(g,id,replacement) {
  if(!g)throw Error('尚未开局');
  const player=get(g,id);
  if(g.day!==0||g.phase!=='identity'||g.pending?.actor!==id||g.pending?.kind!=='identity'||!player||player.identityConfirmed)
    throw Error('仅能在第一夜之前替换当前尚未确认身份的席位');
  const binding={id,provider:replacement.provider,url:replacement.url,tabId:null};
  validateSeats(g.players.map(p=>p.id===id?binding:p));
  if(conversationKey(binding.url)===conversationKey(player.url))throw Error('替换玩家必须使用一段新的独立聊天');
  Object.assign(player,binding,{rulesConfirmed:false,identityConfirmed:false,delivery:{version:1,conversation:conversationKey(binding.url),log:0,notes:0}});
  g.pending=null;
  g.queue=[{id:uid(),actor:id,kind:'intro',verifyRules:true},{id:uid(),actor:id,kind:'identity'},...g.queue.filter(t=>t.actor!==id)];
  log(g,`${id}号更换为${PROVIDERS[binding.provider].name}，重新确认规则和原身份`);
  return g;
}
export function replaceSeat(g,id,replacement) {
  if(!g||g.winner||g.phase==='finished')throw Error('请在尚未结束的对局中更换AI');
  const player=get(g,id);if(!player)throw Error('席位不存在');
  const binding={id,provider:replacement.provider,url:replacement.url,tabId:null};
  validateSeats(g.players.map(p=>p.id===id?binding:p));
  if(conversationKey(binding.url)===conversationKey(player.url))throw Error('更换AI必须使用一段新的独立聊天');
  const pending=g.pending;
  let continuation=[...(pending?[pending]:[]),...g.queue];
  continuation=continuation.filter(t=>!(t.actor===id&&(['intro','identity'].includes(t.kind)||t.handover)));
  continuation=continuation.map(t=>t===pending&&t.actor===id?{...t,id:uid()}:t);
  const onboarding=[{id:uid(),actor:id,kind:'intro',verifyRules:true,handover:true}];
  if(g.phase!=='setup')onboarding.push({id:uid(),actor:id,kind:'identity',handover:true},{id:uid(),actor:id,kind:'catchup',handover:true,handoverFinal:true});
  else onboarding[0].handoverFinal=true;
  Object.assign(player,binding,{rulesConfirmed:false,identityConfirmed:false,delivery:{version:1,conversation:conversationKey(binding.url),log:0,notes:0}});
  g.pending=null;g.queue=[...onboarding,...continuation];g.handover={actor:id,phase:g.phase};
  log(g,`${id}号更换为${PROVIDERS[binding.provider].name}，保留原身份及已确认进度，开始交接`);
  return g;
}
function log(g,text,privateTo=null) {g.log.push({day:g.day,phase:g.phase,text,privateTo,time:Date.now()});}
function task(g,actor,kind,extra={}) {g.queue.push({id:uid(),actor,kind,...extra});}
function beginNight(g) {
  if(g.day===0&&g.players.every(p=>p.rulesConfirmed&&p.identityConfirmed))log(g,'游戏开始');
  g.day++; g.phase='night'; g.night={guard:null,kill:null,poison:null,save:false,wolfVotes:{},wolfTalk:[]};
  log(g,`第${g.day}夜开始`);
  const guard=live(g).find(p=>p.role==='守卫'); if(guard)task(g,guard.id,'guard');
  const wolves=live(g).filter(p=>p.role==='狼人');
  for(const p of wolves)task(g,p.id,'wolfTalk');
  for(const p of wolves)task(g,p.id,'wolfKill');
  const seer=live(g).find(p=>p.role==='预言家'); if(seer)task(g,seer.id,'seer');
  const witch=live(g).find(p=>p.role==='女巫'); if(witch)task(g,witch.id,'witch');
}
function tally(votes) {
  const counts={};for(const v of Object.values(votes))if(v!==null)counts[v]=(counts[v]||0)+1;
  const max=Math.max(0,...Object.values(counts));
  return Object.keys(counts).filter(k=>counts[k]===max).map(Number).sort((a,b)=>a-b);
}
export function winner(g) {
  if(modern(g))return modernWinner(g);
  const a=live(g);if(!a.some(p=>p.role==='狼人'))return '好人';
  if(!a.some(p=>p.role==='村民') || !a.some(p=>!['狼人','村民'].includes(p.role)))return '狼人';
  return null;
}
function finishIfWon(g) {
  const w=winner(g);if(!w)return false;
  g.winner=w;g.phase='finished';g.queue=[];log(g,`${w}阵营获胜`);return true;
}
function kill(g,ids,poisoned=[]) {
  const actual=[...new Set(ids)].filter(id=>get(g,id)?.alive);
  for(const id of actual){get(g,id).alive=false;log(g,`${id}号出局`);}
  for(const id of actual)if(get(g,id).role==='猎人'&&!poisoned.includes(id))task(g,id,'hunter');
}
function resolveNight(g) {
  const n=g.night; const deaths=[];
  if(n.kill!==null){const guarded=n.guard===n.kill;const saved=n.save;
    if((!guarded&&!saved)||(guarded&&saved))deaths.push(n.kill);}
  if(n.poison!==null)deaths.push(n.poison);
  log(g,`第${g.day}天天亮`);if(!deaths.length)log(g,'昨夜平安夜');
  g.phase='nightDeaths';kill(g,deaths,n.poison===null?[]:[n.poison]);
}
function beginSpeech(g) {
  g.phase='speech';for(const p of live(g))task(g,p.id,'speech');
}
function beginVote(g,runoff=false) {
  g.phase=runoff?'runoffVote':'vote';g.votes={};
  for(const p of live(g))if(!runoff||!g.ties.includes(p.id))task(g,p.id,'vote',{runoff});
}
function resolveVote(g,runoff=false) {
  const ties=tally(g.votes);
  log(g,'投票结果 '+Object.entries(g.votes).map(([p,t])=>`${p}号→${t===null?'弃票':t+'号'}`).join('，'));
  if(ties.length===1){g.phase='voteDeaths';kill(g,ties);}
  else if(ties.length>1&&!runoff){g.ties=ties;g.phase='runoffSpeech';log(g,`平票 ${ties.join('、')}号`);for(const id of ties)task(g,id,'speech');}
  else {log(g,'本轮无人被放逐');if(!finishIfWon(g))beginNight(g);}
}
function advance(g) {
  if(g.queue.length||g.pending||g.winner)return;
  switch(g.phase){
    case 'setup':g.phase='identity';for(const p of g.players)task(g,p.id,'identity');break;
    case 'identity':beginNight(g);break;
    case 'night':resolveNight(g);break;
    case 'nightDeaths':if(!finishIfWon(g))beginSpeech(g);break;
    case 'speech':beginVote(g);break;
    case 'vote':resolveVote(g);break;
    case 'runoffSpeech':beginVote(g,true);break;
    case 'runoffVote':resolveVote(g,true);break;
    case 'voteDeaths':if(!finishIfWon(g))beginNight(g);break;
  }
}
export function nextTask(g) {
  if(modern(g))return modernNextTask(g);
  if(g.pending)return g.pending;
  for(let i=0;i<12&&!g.queue.length&&!g.winner;i++)advance(g);
  if(g.winner)return null;
  g.pending=g.queue.shift()||null;
  if(g.pending?.kind==='witch')g.night.kill=tally(g.night.wolfVotes)[0]??null;
  return g.pending;
}
export function legalTargets(g,t) {
  if(modern(g))return modernTargets(g,t);
  let ids=live(g).map(p=>p.id);
  if(['seer','vote','hunter'].includes(t.kind))ids=ids.filter(id=>id!==t.actor);
  if(t.kind==='guard')ids=ids.filter(id=>id!==g.lastGuard);
  if(t.kind==='wolfKill')ids=ids.filter(id=>get(g,id).role!=='狼人');
  if(t.kind==='vote'&&t.runoff)ids=ids.filter(id=>g.ties.includes(id));
  return ids;
}
function deliveryPosition(g,p){
  const key=conversationKey(p.url),d=p.delivery;
  if(d?.version===1&&d.conversation===key&&Number.isInteger(d.log)&&d.log>=0&&d.log<=g.log.length&&Number.isInteger(d.notes)&&d.notes>=0&&d.notes<=p.notes.length)return d;
  if(d)return {version:1,conversation:key,log:0,notes:0};
  // Old prompts contained the complete history before the player's last accepted action.
  // Keep that action and its new private result unread; never infer delivery from deaths.
  let last=-1;
  for(let i=0;i<g.log.length;i++){
    const text=g.log[i].text;
    if(text.startsWith(p.id+'号 ')||new RegExp('^'+p.id+'号(?:规则已理解$|身份已收到$|已完成AI交接$|狼队交流 |查验\\d+号为|女巫行动 |猎人(?:放弃开枪|开枪带走))').test(text))last=i;
  }
  return {version:1,conversation:key,log:Math.max(0,last),notes:Math.max(0,p.notes.length-1)};
}
const administrative=e=>/^(?:向12名玩家说明规则|重新向\d+号发送规则|\d+号(?:规则已理解$|身份已收到$|此前规则确认|更换为|已完成AI交接$))/.test(e.text);
const allowedRecord=(e,id)=>!e.observerOnly&&(e.privateTo===null||Array.isArray(e.privateTo)&&e.privateTo.includes(id));
function recordsFor(g,p,from=0){return g.log.slice(from).filter(e=>allowedRecord(e,p.id)&&!administrative(e));}
export function compactState(g,id){
  const p=get(g,id),phase={setup:'规则确认',identity:'身份确认',night:'夜晚',nightDeaths:'天亮结算',speech:'白天发言',vote:'放逐投票',runoffSpeech:'平票发言',runoffVote:'平票复投',voteDeaths:'放逐结算',finished:'结束'};
  Object.assign(phase,{sheriffSignup:'上警报名',sheriffSpeech:'警长竞选',sheriffWithdraw:'退水',sheriffVote:'警长投票',sheriffPK:'警长平票PK',sheriffRunoffVote:'警长复投',dayOrder:'安排发言顺序',explosionDeaths:'自爆结算'});
  const rows=[`第${g.day}轮 · ${phase[g.phase]||g.phase}`,`存活 ${live(g).map(x=>x.id).join('、')}`,`已出局 ${g.players.filter(x=>!x.alive).map(x=>x.id).join('、')||'无'}`,`本席位 ${p.id}号 · 身份${p.role} · ${p.alive?'存活':'已出局'}`];
  const vote=g.log.filter(e=>e.privateTo===null&&e.text.startsWith('投票结果 ')).at(-1);
  rows.push(vote?`最近已公布投票 第${vote.day??g.day}轮 ${vote.text.slice(5)}`:'最近已公布投票 无');
  if(g.phase.startsWith('runoff'))rows.push(`平票候选 ${g.ties.join('、')}`);
  if(!modern(g)&&['vote','runoffVote'].includes(g.phase)&&Object.hasOwn(g.votes,p.id))rows.push(`本轮你已提交的投票 ${g.votes[p.id]??'弃票'}`);
  if(isWolf(p)){
    rows.push('狼队 '+g.players.filter(x=>isWolf(x)&&x.id!==id).map(x=>`${x.id}号${x.alive?'存活':'已出局'}`).join('、'));
    if(!modern(g))rows.push('本夜已知刀人意见 '+(Object.entries(g.night.wolfVotes||{}).map(([actor,target])=>`${actor}号→${target}`).join('，')||'无'));
  }else if(p.role==='女巫')rows.push(`你的药品 解药${g.potions.save?'剩余1':'已用完'}，毒药${g.potions.poison?'剩余1':'已用完'}`);
  else if(p.role==='守卫')rows.push(`你上次守护 ${g.lastGuard===null?'无人':g.lastGuard+'号'}`);
  else if(p.role==='预言家'){
    const checks=new Map();for(const note of p.notes){const m=note.match(/^第\d+夜查验(\d+)号为(狼人|好人)$/);if(m)checks.set(m[1],m[2]);}
    rows.push('你的已知查验 '+([...checks].map(([target,result])=>`${target}号=${result}`).join('，')||'无'));
  }
  if(modern(g)){
    rows.push('警长 '+(g.sheriff?g.sheriff+'号':g.badgeLost?'警徽已流失':'尚未产生'));
    const revealed=g.players.filter(x=>x.idiotRevealed).map(x=>x.id);if(revealed.length)rows.push('翻牌白痴，已无投票权 '+revealed.join('、'));
    if(g.election&&g.phase!=='sheriffSignup')rows.push('警长候选 '+(g.election.candidates.join('、')||'无'));
  }
  return rows.join('\n');
}
export function messageFor(g,t){
  const p=get(g,t.actor);
  return {prompt:promptFor(g,t),delivery:['intro','identity'].includes(t.kind)?null:{version:1,conversation:conversationKey(p.url),log:g.log.length,notes:p.notes.length}};
}
export function contextPageFor(g,t,limit=5000){
  if(['intro','identity'].includes(t.kind)||messageFor(g,t).prompt.length<=limit)return null;
  const p=get(g,t.actor),position=deliveryPosition(g,p),requestId=uid();
  const publicRows=[],privateRows=[];let logAt=position.log,notesAt=position.notes;
  const format=()=>`这是${p.id}号玩家的补充记录。沿用当前对话，只接收记录，暂不执行游戏行动。后续仍可能有下一批。\n新增公开记录\n${publicRows.join('\n')||'无新增'}\n新增私人记录\n${privateRows.join('\n')||'无新增'}\n本次行动编号 ${requestId}\n只返回JSON对象，request_id逐字复制本次编号，text必须为“记录已收到”。`;
  for(let i=position.log;i<g.log.length;i++){
    const e=g.log[i];
    if(!allowedRecord(e,p.id)||administrative(e)){logAt=i+1;continue;}
    const rows=e.privateTo===null?publicRows:privateRows;rows.push(e.text);
    if(format().length>limit){rows.pop();break;}logAt=i+1;
  }
  if(logAt===g.log.length)for(let i=position.notes;i<p.notes.length;i++){
    privateRows.push(p.notes[i]);if(format().length>limit){privateRows.pop();break;}notesAt=i+1;
  }
  if(!publicRows.length&&!privateRows.length)throw Error('单条未确认记录超过发送长度限制，已保留原文，请检查记录。');
  return {requestId,prompt:format(),delivery:{version:1,conversation:conversationKey(p.url),log:logAt,notes:notesAt}};
}
export function markDelivered(g,id,delivery){
  const p=get(g,id);
  if(!p||!delivery||delivery.version!==1||delivery.conversation!==conversationKey(p.url)||!Number.isInteger(delivery.log)||delivery.log<0||delivery.log>g.log.length||!Number.isInteger(delivery.notes)||delivery.notes<0||delivery.notes>p.notes.length)return false;
  const previous=p.delivery?deliveryPosition(g,p):{log:0,notes:0};
  p.delivery={...delivery,log:Math.max(previous.log,delivery.log),notes:Math.max(previous.notes,delivery.notes)};return true;
}
export function promptFor(g,t) {
  const p=get(g,t.actor);const wolves=g.players.filter(isWolf).map(p=>p.id);
  if(t.kind==='intro')return [
    t.handover?'你将接替本局的一名玩家。请先学习规则；当前只确认理解，之后裁判会单独通知原身份和允许你接收的进度。':`我们即将开始一场12名AI参与的狼人杀。本局标识 ${g.id}。这是独立的新一局，此聊天中以前对局的身份、队友、查验、技能和投票均不适用于本局。只按本局裁判消息行动，等待重新告知身份。`,
    '你是'+p.id+'号玩家，用户只旁观，观战台担任裁判并转发各玩家发言。此聊天只属于你这一席，不引用其他聊天或其他游戏。',
    rulesFor(g),
    '你只控制自己。现在尚未向你通知身份，不要自行分配身份或模拟整场游戏。只依据裁判给出的公开记录和本席位私人信息推理。狼人可以在游戏内伪装；好人根据证据寻找狼人。夜间行动及狼队交流私下转发，白天发言转发给存活玩家，投票统计后公开。不要自行推进轮次。',
    '每次只返回一个JSON对象，不附带Markdown或额外说明。request_id填写裁判给出的本次行动编号。确认消息使用text字段；发言使用text且target为null；守护、查验、刀人、投票、开枪使用数字座位号target，允许不行动时使用null；女巫使用布尔值save及数字或null的poison。',
    '本次行动编号 '+t.id,
    '现在返回request_id和text，text必须为“规则已理解”。'+(t.verifyRules?'还需要在同一JSON内回答seat为你的座位号，wolves为狼人总数，villagers为村民总数，gods为神职总数，roleAssigned为是否已收到私人身份的布尔值。':'')
  ].join('\n');
  if(t.kind==='identity')return '本局你的座位是'+p.id+'号，你的私人身份是'+p.role+'。'+(isWolf(p)?'你的狼队友是'+wolves.filter(id=>id!==p.id).join('、')+'号。':'')+(t.handover?'你正在接替原玩家，稍后会提供本席位允许接收的进度。只确认收到身份，不执行行动。':'仅扮演这一席，尚未开始夜间行动。')+'不要把私人信息当作公开发言，等待裁判指令。\n本次行动编号 '+t.id+'\n只返回一个JSON对象，request_id填写本次行动编号，text必须为“身份已收到”。';
  if(t.kind==='catchup'){
    const position=deliveryPosition(g,p),records=recordsFor(g,p,position.log).map(e=>e.text).join('\n');
    return '你接替本局'+p.id+'号。\n当前局势\n'+compactState(g,p.id)+'\n你的新增私人记录\n'+p.notes.slice(position.notes).join('\n')+'\n尚未确认的公开记录及本席位有权接收的私人记录\n'+records+'\n沿用刚才已确认的规则与此前已确认的补充记录。裁判只保留已确认行动，原模型未确认的输出不算行动。此消息只交接进度，等待下一条指令。\n本次行动编号 '+t.id+'\n只返回JSON对象，request_id填写本次行动编号，text必须为“进度已收到”。';
  }
  const position=deliveryPosition(g,p),updates=recordsFor(g,p,position.log);
  const publicText=updates.filter(e=>e.privateTo===null).map(e=>e.text).join('\n')||'无新增';
  const privateText=[...updates.filter(e=>e.privateTo!==null).map(e=>e.text),...p.notes.slice(position.notes)].join('\n')||'无新增';
  let extra='';let shape={request_id:'填写本次行动编号',text:'本次发言',target:null};
  if(modern(g)){({extra,shape}=modernActionPrompt(g,t));}
  else if(t.kind==='witch'){
    const canSave=g.potions.save&&g.night.kill!==null&&(g.night.kill!==p.id||g.day===1);
    extra+=(g.potions.save?'今晚刀口 '+(g.night.kill??'无')+'号。':'')+'本次可救人 '+(canSave?'是':'否')+'。\n';
    shape={request_id:'填写本次行动编号',save:false,poison:null};
  }else if(!['speech','wolfTalk'].includes(t.kind)){
    extra+='合法目标 '+legalTargets(g,t).join('、')+'号。'+(['seer','wolfKill'].includes(t.kind)?'必须选择一人':'可用null表示不行动或弃票')+'。\n';
    shape={request_id:'填写本次行动编号',target:null};
  }
  const instruction=modern(g)?modernActionPrompt(g,t).instruction:['speech','wolfTalk'].includes(t.kind)?'发言限180字，target保持null。':t.kind==='witch'?'save填写布尔值，poison填写合法数字座位号或null。':'target填写所选合法数字座位号，仅允许放弃时可用null。';
  return '你是本局'+p.id+'号玩家，身份'+p.role+'。只控制自己，沿用本对话已确认的规则与已有信息。以下只补充你尚未收到的已确认记录。\n当前局势\n'+compactState(g,p.id)+'\n新增公开记录\n'+publicText+'\n新增私人记录\n'+privateText+'\n本次行动 '+t.kind+'\n'+extra+'本次行动编号 '+t.id+'\n仅返回一个JSON对象，request_id准确复制本次编号。'+instruction+'返回格式\n'+JSON.stringify(shape);
}
export function parseReply(raw,expectedRequestId=null) {
  let source=String(raw).trim();
  // Some chat renderers/models emit an extra quote before the UUID. Repair only
  // this field when it already contains the exact expected UUID; never alter actions.
  if(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(expectedRequestId||'')){
    const extraQuote=new RegExp('("request_id"\\s*:\\s*")\\s*"'+expectedRequestId+'("(?=\\s*[,}]))','g');
    source=source.replace(extraQuote,(_match,start,end)=>start+expectedRequestId+end);
  }
  let matching=null;
  const objectAt=(start,smart)=>{
    let depth=0,inString=false,smartString=false,escaped=false,innerQuotes=0,buffer='';
    for(let i=start;i<source.length;i++){
      const c=source[i];
      if(inString){
        if(escaped){buffer+=c;escaped=false;continue;}
        if(c==='\\'){buffer+=c;escaped=true;continue;}
        if(c==='"'){
          const next=source.slice(i+1).match(/^\s*(.)/s)?.[1];
          if(smartString&&(!next||!':,}]'.includes(next))){buffer+='\\"';continue;}
          buffer+=c;inString=false;continue;
        }
        if(smart&&c==='“'){innerQuotes++;buffer+=c;continue;}
        if(smart&&c==='”'){
          // A model may open a literal Chinese quote but close it with \".
          // Only an unambiguous following JSON property/object end may close
          // the outer value despite that unmatched literal quote.
          const boundary=/^\s*(?:,\s*["“”][A-Za-z_][A-Za-z_0-9]*["“”]\s*:|[}\]])/.test(source.slice(i+1));
          if(innerQuotes&&!boundary){innerQuotes--;buffer+=c;continue;}
          const next=source.slice(i+1).match(/^\s*(.)/s)?.[1];
          if(next&&':,}]'.includes(next)){buffer+='"';inString=false;continue;}
        }
        buffer+=c;continue;
      }
      if(c==='"'||smart&&(c==='“'||c==='”')){inString=true;smartString=smart&&c!=='"';innerQuotes=0;buffer+='"';continue;}
      buffer+=c;
      if(c==='{')depth++;
      if(c==='}'&&--depth===0){try{return {value:JSON.parse(buffer),end:i};}catch{return null;}}
    }
    return null;
  };
  for(let start=0;start<source.length;start++)if(source[start]==='{'){
    const found=objectAt(start,false)||objectAt(start,true),value=found?.value;
    if(value&&typeof value==='object'&&value.request_id){
      if(!expectedRequestId)return value;
      if(value.request_id===expectedRequestId)matching=value;
      start=found.end;
    }
  }
  if(matching)return matching;
  throw Error(expectedRequestId?'回复中没有与本次行动编号相符的JSON，请检查该玩家的最新回复':'回复不是带request_id的有效JSON，请检查该玩家的最新回复');
}
export function retryPending(g){
  if(!g.pending||g.winner)throw Error('没有可重新发送的行动');
  const oldId=g.pending.id;g.pending.id=uid();
  log(g,`用户重新发送${g.pending.actor}号当前行动，旧编号已作废`,[g.pending.actor]);
  return {oldId,newId:g.pending.id};
}
export function skipPending(g){
  const t=g.pending;if(!t||g.winner)throw Error('没有可跳过的行动');
  if(modern(g)){modernSkip(g,t);g.pending=null;return g;}
  if(!['speech','wolfTalk','vote','guard','wolfKill','seer','witch','hunter'].includes(t.kind))throw Error('规则、身份和进度确认必须完成，不能跳过');
  if(t.kind==='vote')g.votes[t.actor]=null;
  if(t.kind==='guard'){g.night.guard=null;g.lastGuard=null;}
  if(t.kind==='wolfKill'){g.night.wolfVotes[t.actor]=null;g.night.kill=tally(g.night.wolfVotes)[0]??null;}
  const labels={speech:'本次发言',wolfTalk:'本次狼队交流',vote:'本次投票，按弃票处理',guard:'本次守护，按空守处理',wolfKill:'本次刀人意见，不选择目标',seer:'本次查验，不产生查验结果',witch:'本次用药，不消耗药品',hunter:'本次开枪，按放弃开枪处理'};
  const privacy=['speech','hunter'].includes(t.kind)?null:t.kind==='wolfTalk'?g.players.filter(p=>p.role==='狼人').map(p=>p.id):[t.actor];
  log(g,`用户跳过${t.actor}号${labels[t.kind]}`,privacy);
  g.pending=null;return g;
}
export function acceptReply(g,reply) {
  const t=g.pending;if(!t)throw Error('没有待处理行动');
  if(reply.request_id!==t.id)throw Error('回复与本次行动编号不符，不能使用旧回复');
  const p=get(g,t.actor);
  if(modern(g)&&!['intro','identity','catchup'].includes(t.kind)){modernAccept(g,t,reply);g.pending=null;return g;}
  if(['intro','identity'].includes(t.kind)){
    const expected=t.kind==='intro'?'规则已理解':'身份已收到';
    if(reply.text!==expected)throw Error(`请等待该玩家确认“${expected}”`);
    if(t.verifyRules&&(reply.seat!==p.id||reply.wolves!==4||reply.villagers!==4||reply.gods!==4||reply.roleAssigned!==false))throw Error("座位、人数或身份通知状态回答不正确，不能确认规则");
    p[t.kind==='intro'?'rulesConfirmed':'identityConfirmed']=true;
    log(g,`${p.id}号${expected}`,t.kind==='identity'?[p.id]:null);
  } else if(t.kind==='catchup'){
    if(reply.text!=='进度已收到'||!p.rulesConfirmed||!p.identityConfirmed)throw Error('请先确认规则、身份及本席位进度');
    log(g,`${p.id}号已完成AI交接`);
  } else if(['speech','wolfTalk'].includes(t.kind)){
    if(typeof reply.text!=='string'||!reply.text.trim()||reply.text.length>600)throw Error('发言必须是1至600字文本');
    if(t.kind==='speech')log(g,`${p.id}号 ${reply.text}`);
    else {g.night.wolfTalk.push(`${p.id}号 ${reply.text}`);log(g,`${p.id}号狼队交流 ${reply.text}`,g.players.filter(p=>p.role==='狼人').map(p=>p.id));}
  } else if(t.kind==='witch'){
    if(typeof reply.save!=='boolean'||!(reply.poison===null||Number.isInteger(reply.poison)))throw Error('女巫行动格式不正确');
    if(reply.save&&(!g.potions.save||g.night.kill===null||(g.night.kill===p.id&&g.day!==1)))throw Error('此次不能使用解药');
    if(reply.poison!==null&&(!g.potions.poison||!legalTargets(g,t).includes(reply.poison)))throw Error('毒药目标不合法');
    if(reply.save&&reply.poison!==null)throw Error('一夜不能使用两瓶药');
    if(reply.save){g.potions.save=false;g.night.save=true;p.notes.push(`第${g.day}夜救了${g.night.kill}号`);}
    if(reply.poison!==null){g.potions.poison=false;g.night.poison=reply.poison;p.notes.push(`第${g.day}夜毒了${reply.poison}号`);}
    log(g,`${p.id}号女巫行动 ${JSON.stringify(reply)}`,[p.id]);
  } else {
    const target=reply.target;
    if(target===null&&['seer','wolfKill'].includes(t.kind))throw Error('此次必须选择目标');
    if(target!==null&&(!Number.isInteger(target)||!legalTargets(g,t).includes(target)))throw Error('行动目标不合法');
    if(t.kind==='guard'){g.night.guard=target;g.lastGuard=target;p.notes.push(`第${g.day}夜守护${target??'无人'}号`);}
    if(t.kind==='wolfKill'){g.night.wolfVotes[p.id]=target;g.night.kill=tally(g.night.wolfVotes)[0]??null;}
    if(t.kind==='seer'){const result=get(g,target).role==='狼人'?'狼人':'好人';p.notes.push(`第${g.day}夜查验${target}号为${result}`);log(g,`${p.id}号查验${target}号为${result}`,[p.id]);}
    if(t.kind==='vote')g.votes[p.id]=target;
    if(t.kind==='hunter'){log(g,`${p.id}号猎人${target===null?'放弃开枪':'开枪带走'+target+'号'}`);if(target!==null)kill(g,[target]);}
    if(!['seer','hunter','vote'].includes(t.kind))log(g,`${p.id}号 ${t.kind} 目标${target??'无'}`,[p.id]);
  }
  if(t.handoverFinal){const next=g.queue.find(task=>task.handover);g.handover=next?{actor:next.actor,phase:g.phase}:null;}
  g.pending=null;return g;
}
