// Versioned referee for new games. Old saves continue through core's original engine.
export const BOARDS = {
  standard:{name:'标准12人 · 预女猎白',roles:['狼人','狼人','狼人','狼人','村民','村民','村民','村民','预言家','女巫','猎人','白痴']},
  wolfKing:{name:'狼王守卫',roles:['狼人','狼人','狼人','狼王','村民','村民','村民','村民','预言家','女巫','猎人','守卫']},
  whiteWolf:{name:'白狼王守卫',roles:['狼人','狼人','狼人','白狼王','村民','村民','村民','村民','预言家','女巫','猎人','守卫']}
};
export const isWolf = p => ['狼人','狼王','白狼王'].includes(typeof p==='string'?p:p?.role);
export const modern = g => g?.rulesVersion===2;
export const MODERN_RULES = [
  '12人，狼人阵营4人、村民4人、神职4人。好人消灭全部狼人获胜；狼人消灭全部村民或全部神职获胜。死亡结算满足胜负后立即结束，不再追加技能或遗言；夜间先结算经守救后的狼刀及胜负，再结算毒药。',
  '首夜结束、公布死讯前竞选警长，所有玩家包括尚未公布的夜间死者均可上警。先同时报名，再依座位发言、退水，只有最初未上警者能投票，退水者也不能投。有警下玩家且仅一名候选人时直接当选；无人参选或无人可投票则无警长。平票候选人PK，再由原警下玩家复投，仍平票则警徽流失。警上自爆采用单爆吞警徽，本局不再竞选。',
  '警长放逐票为1.5票，其他有投票权玩家1票。警长每日选择顺时针或逆时针，从警长相邻存活玩家开始，警长最后发言。无警长时从上一位出局者下一存活座位开始顺时针发言，首日无死者从1号开始。警长死亡或白痴警长翻牌可移交警徽给有投票权的存活玩家，或撕徽；警长自爆直接撕徽。',
  '所有报名、退水及投票先封存，收齐后统一公布；不得把同一轮已收集的选择告诉尚未行动的玩家。放逐不能自票，可以弃票。放逐平票者PK发言，候选人不能参加复投，其他有票权玩家只能投平票候选人；再次平票或全体弃票则无人被放逐。',
  '遗言仅限首夜死亡者和白天被放逐者；首夜平安不把遗言顺延到次夜。自爆者、白狼王带走者、枪击者没有遗言。首夜警上自爆仍先公布首夜死讯、保留首夜死者遗言。结算时先遗言、再出局技能、再移交警徽；枪击连锁先结算，再继续未完成的遗言和警徽。',
  '狼人在警上及白天发言、PK期间可自爆，终止当天发言和放逐，结算死讯、出局技能及警徽后直接入夜。投票、遗言、出局技能结算中禁止自爆。AI在自己的白天行动可提交explode:true，并在每段发言后获得自爆响应机会；不自爆回复explode:false。',
  '狼人每夜先私聊，再密封选择刀口，允许自刀、刀队友和空刀；最多票的唯一目标为刀口，并列最高或全空则空刀。预言家每夜查验另一存活玩家，仅知道其属于狼人阵营还是好人阵营。',
  '女巫有解药、毒药各一瓶，一夜只能用一瓶，12人场全程不能自救，解药用完后不再告知刀口。守卫可以自守或空守，不可连续两夜守同一人；空守解除连续限制。守护只挡狼刀，不挡毒药和枪；同守同救仍死亡。',
  '猎人被毒不能开枪，其他出局可以开枪或放弃。狼王被毒或自爆不能开枪，其他出局可开枪；狼王与猎人开枪统一以“出局技能”公开，不公开两者身份。白狼王仅白天自爆时可以额外带走一人，可放弃带人；被毒后警上自爆不能带人，最后一狼自爆直接判好人胜利，不再带人。白狼王带走的猎人仍可开枪。',
  '白痴首次被放逐时公开翻牌，免除本次死亡，之后仍能发言但永久失去投票权，也不能再成为放逐目标、不能接警徽；仍计入存活神职。被刀、被毒、被枪均正常死亡。'
].join('\n');
export function boardRules(g){
  const board=BOARDS[g?.boardId]||BOARDS.standard;
  const counts={};for(const r of board.roles)counts[r]=(counts[r]||0)+1;
  let text=MODERN_RULES;
  if(!counts['白痴'])text=text.split('\n').filter(line=>!line.startsWith('白痴首次')).join('\n');
  if(!counts['狼王'])text=text.replace('狼王被毒或自爆不能开枪，其他出局可开枪；狼王与猎人开枪统一以“出局技能”公开，不公开两者身份。','');
  if(!counts['白狼王'])text=text.replace('白狼王仅白天自爆时可以额外带走一人，可放弃带人；被毒后警上自爆不能带人，最后一狼自爆直接判好人胜利，不再带人。白狼王带走的猎人仍可开枪。','');
  return `${board.name}。配置 ${Object.entries(counts).map(([r,n])=>`${r}${n}人`).join('、')}。\n${text}`;
}
const uid=()=>globalThis.crypto.randomUUID();
const get=(g,id)=>g.players.find(p=>p.id===id);
const live=g=>g.players.filter(p=>p.alive);
const voters=g=>live(g).filter(p=>!p.idiotRevealed);
const log=(g,text,privateTo=null,extra={})=>g.log.push({day:g.day,phase:g.phase,text,privateTo,time:Date.now(),...extra});
const task=(g,actor,kind,extra={})=>g.queue.push({id:uid(),actor,kind,...extra});
const voteKinds=['vote','sheriffVote'];
const daytime=['sheriffSignup','sheriffSpeech','sheriffWithdraw','sheriffPK','speech','runoffSpeech','dayOrder'];
export function modernWinner(g){
  const a=live(g);if(!a.some(isWolf))return '好人';
  if(!a.some(p=>p.role==='村民')||!a.some(p=>!isWolf(p)&&p.role!=='村民'))return '狼人';
  return null;
}
function finish(g){
  const result=modernWinner(g);if(!result)return false;
  g.winner=result;g.phase='finished';g.queue=[];log(g,`${result}阵营获胜`);return true;
}
export function knifeTarget(votes){
  const ties=leaders(votes);return ties.length===1?ties[0]:null;
}
function leaders(votes,weights={}){
  const count={};for(const [actor,target] of Object.entries(votes))if(target!==null)count[target]=(count[target]||0)+(weights[actor]??1);
  const max=Math.max(0,...Object.values(count));return Object.keys(count).filter(k=>count[k]===max).map(Number).sort((a,b)=>a-b);
}
function night(g){
  if(g.day===0&&g.players.every(p=>p.rulesConfirmed&&p.identityConfirmed))log(g,'游戏开始');
  g.day++;g.phase='night';g.night={guard:null,kill:null,poison:null,save:false,wolfVotes:{},wolfTalk:[]};
  g.ballot=null;g.pendingNightDeaths=null;log(g,`第${g.day}夜开始`);
  const guard=live(g).find(p=>p.role==='守卫');if(guard)task(g,guard.id,'guard');
  for(const p of live(g).filter(isWolf))task(g,p.id,'wolfTalk');
  // All night ballots see the same information, too.
  for(const p of live(g).filter(isWolf))task(g,p.id,'wolfKill');
  const seer=live(g).find(p=>p.role==='预言家');if(seer)task(g,seer.id,'seer');
  const witch=live(g).find(p=>p.role==='女巫');if(witch)task(g,witch.id,'witch');
}
function nightDeaths(g){
  const n=g.night,rows=[];
  if(n.kill!==null&&((n.guard!==n.kill&&!n.save)||(n.guard===n.kill&&n.save)))rows.push({id:n.kill,cause:'knife'});
  if(n.poison!==null){const same=rows.find(r=>r.id===n.poison);if(same)same.poisoned=true;else rows.push({id:n.poison,cause:'poison',poisoned:true});}
  return rows;
}
function sheriffSignup(g){
  g.phase='sheriffSignup';g.election={signup:{},withdraw:{},original:[],candidates:[],votes:{},runoff:false};
  log(g,'首日警长竞选开始，暂不公布昨夜死讯');
  for(const p of live(g))task(g,p.id,'sheriffSignup');
}
function reactions(g,actor){
  for(const p of live(g).filter(p=>isWolf(p)&&p.id!==actor))task(g,p.id,'explode');
}
function speeches(g,ids,kind='speech'){
  for(const id of ids){task(g,id,kind);reactions(g,id);}
}
function elect(g,id){
  g.election.completed=true;
  g.sheriff=id??null;g.badgeLost=id==null;g.ballot=null;
  log(g,id==null?'警徽流失，本局不再竞选':`${id}号当选警长`);
  announceNight(g);
}
function electionVote(g,runoff=false){
  const e=g.election;g.phase=runoff?'sheriffRunoffVote':'sheriffVote';e.votes={};e.runoff=runoff;
  const eligible=voters(g).filter(p=>!e.original.includes(p.id)).map(p=>p.id);
  if(!e.candidates.length||!eligible.length){elect(g,null);return;}
  if(e.candidates.length===1){elect(g,e.candidates[0]);return;}
  g.ballot={kind:'sheriffVote',log:g.log.length,candidates:[...e.candidates],eligible,weights:{}};
  for(const id of eligible)task(g,id,'sheriffVote',{runoff});
}
function showVotes(g,name,votes,weights={}){
  log(g,`${name} ${Object.entries(votes).map(([actor,target])=>`${actor}号→${target===null?'弃票':target+'号'}${weights[actor]===1.5?'（1.5票）':''}`).join('，')}`);
}
function electionResult(g){
  const e=g.election;showVotes(g,'警长投票结果',e.votes);const ties=leaders(e.votes);g.ballot=null;
  if(ties.length===1){elect(g,ties[0]);return;}
  if(!ties.length||e.runoff){elect(g,null);return;}
  e.candidates=ties;g.phase='sheriffPK';log(g,`警长平票 ${ties.join('、')}号`);speeches(g,ties,'sheriffSpeech');
}
function deathTasks(g,rows,{lastWords=false}={}){
  const actual=rows.filter((r,i)=>get(g,r.id)?.alive&&rows.findIndex(x=>x.id===r.id)===i);
  for(const row of actual){const p=get(g,row.id);p.alive=false;p.deathCause=row.cause;g.lastDeath=p.id;log(g,`${p.id}号出局`);}
  if(finish(g))return;
  // Add this death batch before older continuation so chained shots settle first.
  const tail=g.queue;g.queue=[];
  for(const row of actual){
    const p=get(g,row.id);
    if(lastWords)task(g,p.id,'lastWords');
    if(['猎人','狼王'].includes(p.role)&&!row.poisoned&&!['poison','explode'].includes(row.cause)&&!p.shotUsed)task(g,p.id,'hunter');
    if(g.sheriff===p.id)task(g,p.id,'badge');
  }
  g.queue.push(...tail);
}
function announceNight(g,{toNight=false}={}){
  const rows=g.pendingNightDeaths||nightDeaths(g);g.pendingNightDeaths=null;g.ballot=null;
  g.phase=toNight?'explosionDeaths':'nightDeaths';log(g,`第${g.day}天天亮`);
  if(!rows.length)log(g,'昨夜平安夜');
  // Knife has priority over poison at the victory boundary. Co-poison blocks a gun.
  const knife=rows.filter(r=>r.cause==='knife');
  deathTasks(g,knife,{lastWords:g.day===1});if(g.winner)return;
  const first=g.queue;g.queue=[];
  deathTasks(g,rows.filter(r=>r.cause!=='knife'),{lastWords:g.day===1});
  if(!g.winner)g.queue=[...first,...g.queue];
}
function orderIds(g,direction=1){
  const ids=live(g).map(p=>p.id).sort((a,b)=>a-b),anchor=g.sheriff??g.lastDeath??0;
  const ordered=[];for(let step=1;step<=12;step++){const id=((anchor-1+direction*step)%12+12)%12+1;if(ids.includes(id)&&id!==g.sheriff)ordered.push(id);}
  if(g.sheriff&&ids.includes(g.sheriff))ordered.push(g.sheriff);return ordered;
}
function beginDay(g){
  if(g.sheriff&&get(g,g.sheriff)?.alive){g.phase='dayOrder';task(g,g.sheriff,'dayOrder');}
  else{g.phase='speech';speeches(g,orderIds(g));}
}
function beginVote(g,runoff=false){
  g.phase=runoff?'runoffVote':'vote';g.votes={};
  const candidates=runoff?[...g.ties]:live(g).filter(p=>!p.idiotRevealed).map(p=>p.id);
  const eligible=voters(g).filter(p=>!runoff||!g.ties.includes(p.id)).map(p=>p.id);
  const weights={};for(const id of eligible)weights[id]=id===g.sheriff?1.5:1;
  g.ballot={kind:'vote',log:g.log.length,candidates,eligible,weights};
  for(const id of eligible)task(g,id,'vote',{runoff});
}
function voteResult(g,runoff=false){
  const weights=g.ballot?.weights||{},ties=leaders(g.votes,weights);
  showVotes(g,'投票结果',g.votes,weights);g.ballot=null;
  if(ties.length===1){
    const p=get(g,ties[0]);g.phase='voteDeaths';
    if(p.role==='白痴'&&!p.idiotRevealed){p.idiotRevealed=true;log(g,`${p.id}号翻牌白痴，免于本次放逐，永久失去投票权`);if(g.sheriff===p.id)task(g,p.id,'badge');}
    else deathTasks(g,[{id:p.id,cause:'exile'}],{lastWords:true});
  }else if(ties.length>1&&!runoff){g.ties=ties;g.phase='runoffSpeech';log(g,`放逐平票 ${ties.join('、')}号`);speeches(g,ties);}
  else{log(g,'本轮无人被放逐');if(!finish(g))night(g);}
}
function explode(g,p,target){
  if(!isWolf(p)||!p.alive||!daytime.includes(g.phase))throw Error('当前不能自爆');
  if(p.role!=='白狼王'&&target!==null)throw Error('普通狼人及狼王自爆不能带人');
  if(target!==null&&(!Number.isInteger(target)||target===p.id||!get(g,target)?.alive))throw Error('自爆带人目标不合法');
  const poisoned=(g.pendingNightDeaths||[]).some(r=>r.id===p.id&&r.poisoned);
  if(poisoned&&target!==null)throw Error('吃毒白狼王警上自爆不能带人');
  const pendingNight=g.pendingNightDeaths;
  g.queue=[];g.ballot=null;g.phase='explosionDeaths';
  log(g,`${p.id}号${target!==null?'白狼王':''}自爆`);
  if(g.sheriff===p.id||g.election&&!g.election.completed&&pendingNight){g.sheriff=null;g.badgeLost=true;log(g,'自爆吞警徽，本局不再竞选');}
  p.alive=false;p.deathCause='explode';g.lastDeath=p.id;
  if(finish(g))return;
  // First-night deaths remain entitled to last words after a police-stage explosion.
  if(pendingNight)announceNight(g,{toNight:true});
  if(g.winner)return;
  if(target!==null)deathTasks(g,[{id:target,cause:'whiteWolf'}]);
}
export function modernNextTask(g){
  if(g.pending)return g.pending;
  for(let i=0;i<32&&!g.queue.length&&!g.winner;i++){
    switch(g.phase){
      case 'setup':g.phase='identity';for(const p of g.players)task(g,p.id,'identity');break;
      case 'identity':night(g);break;
      case 'night':g.pendingNightDeaths=nightDeaths(g);if(g.day===1)sheriffSignup(g);else announceNight(g);break;
      case 'sheriffSignup':{
        const e=g.election;e.original=Object.keys(e.signup).filter(id=>e.signup[id]).map(Number);e.candidates=[...e.original];
        log(g,`上警名单 ${e.original.join('、')||'无人'}`);
        if(!e.candidates.length)elect(g,null);else{g.phase='sheriffSpeech';speeches(g,e.candidates,'sheriffSpeech');}break;
      }
      case 'sheriffSpeech':g.phase='sheriffWithdraw';for(const id of g.election.candidates)task(g,id,'sheriffWithdraw');break;
      case 'sheriffWithdraw':{
        const e=g.election;e.candidates=e.original.filter(id=>!e.withdraw[id]);log(g,`退水名单 ${e.original.filter(id=>e.withdraw[id]).join('、')||'无人'}`);electionVote(g);break;
      }
      case 'sheriffVote':case 'sheriffRunoffVote':electionResult(g);break;
      case 'sheriffPK':electionVote(g,true);break;
      case 'nightDeaths':if(!finish(g))beginDay(g);break;
      case 'dayOrder':throw Error('警长尚未选择发言顺序');
      case 'speech':beginVote(g);break;
      case 'runoffSpeech':beginVote(g,true);break;
      case 'vote':voteResult(g);break;
      case 'runoffVote':voteResult(g,true);break;
      case 'voteDeaths':case 'explosionDeaths':if(!finish(g))night(g);break;
      default:throw Error('未知规则阶段 '+g.phase);
    }
  }
  if(g.winner)return null;
  g.pending=g.queue.shift()||null;
  if(g.pending?.kind==='witch')g.night.kill=knifeTarget(g.night.wolfVotes);
  return g.pending;
}
export function modernTargets(g,t){
  if(voteKinds.includes(t.kind))return (g.ballot?.candidates||[]).filter(id=>id!==t.actor);
  if(t.kind==='badge')return voters(g).map(p=>p.id).filter(id=>id!==t.actor);
  let ids=live(g).map(p=>p.id);
  if(['seer','hunter','explode'].includes(t.kind))ids=ids.filter(id=>id!==t.actor);
  if(t.kind==='guard')ids=ids.filter(id=>id!==g.lastGuard);
  return ids;
}
export const MODERN_SKIPPABLE=['speech','wolfTalk','vote','guard','wolfKill','seer','witch','hunter','lastWords','sheriffSignup','sheriffSpeech','sheriffWithdraw','sheriffVote','dayOrder','badge','explode'];
export function modernAccept(g,t,reply){
  const p=get(g,t.actor),target=reply.target;
  if(reply.explode===true){explode(g,p,target??null);return;}
  if(reply.explode!==undefined&&reply.explode!==false)throw Error('explode必须为布尔值');
  if(['sheriffSignup','sheriffWithdraw'].includes(t.kind)){
    const field=t.kind==='sheriffSignup'?'run':'withdraw';if(typeof reply[field]!=='boolean')throw Error(field+'必须为布尔值');
    g.election[t.kind==='sheriffSignup'?'signup':'withdraw'][p.id]=reply[field];return;
  }
  if(t.kind==='explode'){if(reply.explode!==false)throw Error('请明确回复explode为false或true');return;}
  if(['speech','sheriffSpeech','lastWords','wolfTalk'].includes(t.kind)){
    if(typeof reply.text!=='string'||!reply.text.trim()||reply.text.length>600)throw Error('发言必须是1至600字文本');
    const privacy=t.kind==='wolfTalk'?g.players.filter(isWolf).map(p=>p.id):null;
    log(g,`${p.id}号${t.kind==='lastWords'?'遗言':t.kind==='sheriffSpeech'?'竞选发言':t.kind==='wolfTalk'?'狼队交流':''} ${reply.text}`,privacy,{category:t.kind==='wolfTalk'?'action':'speech'});
    if(t.kind==='wolfTalk')g.night.wolfTalk.push(`${p.id}号 ${reply.text}`);return;
  }
  if(t.kind==='dayOrder'){
    if(!['clockwise','counterclockwise'].includes(reply.direction))throw Error('direction应为clockwise或counterclockwise');
    log(g,`${p.id}号警长选择${reply.direction==='clockwise'?'顺':'逆'}时针发言`);g.phase='speech';speeches(g,orderIds(g,reply.direction==='clockwise'?1:-1));return;
  }
  if(t.kind==='witch'){
    if(typeof reply.save!=='boolean'||!(reply.poison===null||Number.isInteger(reply.poison)))throw Error('女巫行动格式不正确');
    if(reply.save&&(!g.potions.save||g.night.kill===null||g.night.kill===p.id))throw Error('此次不能使用解药');
    if(reply.poison!==null&&(!g.potions.poison||!modernTargets(g,t).includes(reply.poison)))throw Error('毒药目标不合法');
    if(reply.save&&reply.poison!==null)throw Error('一夜不能使用两瓶药');
    if(reply.save){g.potions.save=false;g.night.save=true;p.notes.push(`第${g.day}夜救了${g.night.kill}号`);}
    if(reply.poison!==null){g.potions.poison=false;g.night.poison=reply.poison;p.notes.push(`第${g.day}夜毒了${reply.poison}号`);}
    log(g,`${p.id}号女巫行动 ${JSON.stringify({save:reply.save,poison:reply.poison,...(reply.save?{saveTarget:g.night.kill}:{})})}`,[p.id]);return;
  }
  if(target===null&&t.kind==='seer')throw Error('查验必须选择目标');
  if(target!==null&&(!Number.isInteger(target)||!modernTargets(g,t).includes(target)))throw Error('行动目标不合法');
  if(voteKinds.includes(t.kind)){
    if(!g.ballot||g.ballot.kind!==t.kind||!g.ballot.eligible.includes(p.id))throw Error('本轮没有投票权');
    if(t.kind==='vote')g.votes[p.id]=target;else g.election.votes[p.id]=target;
    log(g,`${p.id}号${t.kind==='vote'?'放逐投票':'警长投票'} ${target===null?'弃票':target+'号'}`,[p.id],{category:'action',observerOnly:true});return;
  }
  if(t.kind==='guard'){g.night.guard=target;g.lastGuard=target;p.notes.push(`第${g.day}夜守护${target??'无人'}号`);}
  else if(t.kind==='wolfKill'){g.night.wolfVotes[p.id]=target;g.night.kill=knifeTarget(g.night.wolfVotes);log(g,`${p.id}号选择刀口 ${target===null?'空刀':target+'号'}`,[p.id],{category:'action',observerOnly:true});return;}
  else if(t.kind==='seer'){const result=isWolf(get(g,target))?'狼人':'好人';p.notes.push(`第${g.day}夜查验${target}号为${result}`);log(g,`${p.id}号查验${target}号为${result}`,[p.id]);return;}
  else if(t.kind==='hunter'){
    if(p.alive||p.shotUsed||!['猎人','狼王'].includes(p.role)||['poison','explode'].includes(p.deathCause))throw Error('当前不能发动出局技能');
    p.shotUsed=true;log(g,`${p.id}号${target===null?'放弃出局技能':'发动出局技能带走'+target+'号'}`);
    if(target!==null)deathTasks(g,[{id:target,cause:'shot'}]);return;
  }
  else if(t.kind==='badge'){
    if(g.sheriff!==p.id||p.alive&&!p.idiotRevealed)throw Error('当前不能移交警徽');g.sheriff=target;g.badgeLost=target===null;log(g,target===null?`${p.id}号撕毁警徽`:`${p.id}号将警徽移交${target}号`);return;
  }else throw Error('不支持的游戏行动 '+t.kind);
  log(g,`${p.id}号 ${t.kind} 目标${target??'无'}`,[p.id]);
}
export function modernSkip(g,t){
  if(!MODERN_SKIPPABLE.includes(t.kind))throw Error('规则、身份和进度确认必须完成，不能跳过');
  const reply={target:null};
  if(t.kind==='seer'){log(g,`用户跳过${t.actor}号本次查验，不产生结果`,[t.actor]);return;}
  if(t.kind==='sheriffSignup')reply.run=false;
  if(t.kind==='sheriffWithdraw')reply.withdraw=true;
  if(t.kind==='explode')reply.explode=false;
  if(t.kind==='dayOrder')reply.direction='clockwise';
  if(t.kind==='witch'){reply.save=false;reply.poison=null;}
  if(['speech','sheriffSpeech','lastWords','wolfTalk'].includes(t.kind)){
    log(g,`用户跳过${t.actor}号${t.kind==='lastWords'?'遗言':'本次发言'}`,t.kind==='wolfTalk'?g.players.filter(isWolf).map(p=>p.id):null);return;
  }
  modernAccept(g,t,reply);
  // Sealed ballots never publish even participation order while collecting.
  log(g,`用户跳过${t.actor}号本次行动`,[t.actor]);
}
export function modernActionPrompt(g,t){
  const p=get(g,t.actor),base={request_id:'填写本次行动编号'};
  const canExplode=isWolf(p)&&p.alive&&daytime.includes(g.phase);
  let extra='',shape={...base,target:null},instruction='target填写合法数字座位号，放弃使用null。';
  if(['speech','sheriffSpeech','lastWords','wolfTalk'].includes(t.kind)){
    extra=t.kind==='lastWords'?'你已经出局，这是你唯一一次遗言，不再参与后续普通发言和投票。':t.kind==='sheriffSpeech'?'这是警长竞选或平票PK发言。':'';
    shape={...base,text:'本次发言',target:null};instruction='发言限180字，target保持null。';
  }else if(t.kind==='sheriffSignup'){shape={...base,run:false};instruction='run为是否上警的布尔值，名单收齐后公布。';}
  else if(t.kind==='sheriffWithdraw'){shape={...base,withdraw:false};instruction='withdraw为是否退水的布尔值；无论是否退水，你都没有本次警长选举投票权。';}
  else if(t.kind==='dayOrder'){shape={...base,direction:'clockwise'};instruction='direction为clockwise或counterclockwise，警长最后发言。';}
  else if(t.kind==='explode'){shape={...base,explode:false,target:null};instruction='这是白天自爆响应机会，只选择是否自爆，不发言；不自爆explode:false、target:null；自爆explode:true，只有白狼王可用target带走另一玩家。';}
  else if(t.kind==='witch'){
    extra=(g.potions.save?`今晚刀口 ${g.night.kill??'无'}。`:'')+`本次可救人 ${g.potions.save&&g.night.kill!==null&&g.night.kill!==p.id?'是':'否'}。`;
    shape={...base,save:false,poison:null};instruction='save填写布尔值，poison填写合法数字座位号或null，不能同时使用两药，不能自救。';
  }else if(t.kind==='badge')extra='你已出局或翻牌失去投票权，请移交给合法存活玩家，或target:null撕毁警徽。';
  else if(voteKinds.includes(t.kind))extra='本轮为同时投票，选票封存，收齐后统一公布。本轮尚未公布的其他玩家选择不可知。';
  else if(t.kind==='wolfKill')extra='密封选择狼刀，允许自刀、队友刀或target:null空刀；本轮其他狼的选择不可知。';
  if(!['speech','sheriffSpeech','lastWords','wolfTalk','sheriffSignup','sheriffWithdraw','dayOrder','explode'].includes(t.kind))extra+='\n合法目标 '+modernTargets(g,t).join('、')+'号。'+(t.kind==='seer'?'查验不可放弃。':'');
  if(canExplode){extra+='\n此时允许自爆；选择自爆时返回explode:true、target:null，白狼王可指定合法带人目标。';if(p.role==='白狼王'&&(g.pendingNightDeaths||[]).some(r=>r.id===p.id&&r.poisoned))extra+='你昨夜已中毒，警上自爆不能带人。';}
  return {extra,shape,instruction};
}
