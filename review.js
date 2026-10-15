// Observer presentation only. It never feeds either column back to a player.
export function seatElectionStatus(game,id){
  const election=game?.election,publicLog=(game?.log||[]).filter(e=>e.privateTo===null);
  if(!game?.phase?.startsWith('sheriff')||election?.completed)return null;
  if(!election||!publicLog.some(e=>e.text.startsWith('上警名单 '))||!(election.original||[]).includes(id))return null;
  if(publicLog.some(e=>e.text.startsWith('退水名单 '))&&election.withdraw?.[id])return '已退水';
  if(['sheriffPK','sheriffRunoffVote'].includes(game.phase)&&election.candidates?.includes(id))return '上警 · PK';
  return '已上警';
}
export function tableBadgeStatus(game){
  if(game?.rulesVersion!==2)return null;
  if(game.sheriff){const holder=game.players.find(p=>p.id===game.sheriff);return `${holder?.alive===false||holder?.idiotRevealed?'警徽待移交':'警徽'} · ${game.sheriff}号`;}
  if(game.badgeLost)return '警徽已流失';
  if(game.election&&!game.election.completed)return '警长竞选中';
  return '警徽尚未产生';
}
const spoken=e=>e.category==='speech'||(e.category!=='action'&&e.privateTo===null&&/^\d+号(?:竞选发言|遗言)? /.test(e.text)&&!/^\d+号 (?:guard|wolfKill|seer|witch|hunter) 目标/.test(e.text));
const operational=e=>e.category!=='speech'&&e.text!=='游戏开始'&&(e.category==='runtime'||['setup','identity'].includes(e.phase)||/^(?:向12名玩家说明规则|重新向\d+号发送规则|\d+号(?:规则已理解$|身份已收到$|此前规则确认|更换为|已完成AI交接$)|用户(?:重新发送|跳过)|(?:\d+号[ ·]*)?(?:异常提示|接入异常|操作失败|等待回复|重试提示))/.test(e.text));
export function reviewEntries(game,god=false){
  const entries=(game?.log||[]).filter(e=>!operational(e)&&!(e.privateTo!==null&&/^\d+号(?:放逐投票|警长投票) /.test(e.text)));
  // Old saves may have begun before lifecycle announcements were introduced.
  if(game?.day>0&&!entries.some(e=>e.text==='游戏开始'))entries.unshift({day:1,phase:'night',text:'游戏开始',privateTo:null});
  if(game?.endedAt&&!game.winner)entries.push({day:game.day,phase:'finished',text:'游戏结果 · 本局已结束，未产生胜负',privateTo:null});
  return {
    speeches:entries.filter(e=>e.privateTo===null&&!e.observerOnly),
    actions:god?entries.filter(e=>!spoken(e)):[]
  };
}
export function voteSummary(e){
  if(e.privateTo!==null)return null;
  const match=e.text.match(/^(警长)?投票结果 (.+)$/);if(!match)return null;
  const groups=new Map(),seen=new Set();
  for(const item of match[2].split('，')){
    const vote=item.match(/^(\d+)号→(?:(\d+)号|(弃票))(?:（(1\.5)票）)?$/);if(!vote)return null;
    const actor=Number(vote[1]),target=vote[2]?Number(vote[2]):null,weight=vote[4]?1.5:1;
    if(actor<1||actor>12||seen.has(actor)||target!==null&&(target<1||target>12))return null;seen.add(actor);
    if(!groups.has(target))groups.set(target,{target,total:0,voters:[]});
    const group=groups.get(target);if(target!==null)group.total+=weight;group.voters.push({actor,weight});
  }
  return {title:(match[1]?'警长':'放逐')+(['sheriffRunoffVote','runoffVote'].includes(e.phase)?'复投':'投票'),groups:[...groups.values()].sort((a,b)=>a.target===null?1:b.target===null?-1:b.total-a.total||a.target-b.target)};
}
export function reviewText(e,game){
  if(/^(好人|狼人)阵营获胜$/.test(e.text))return '游戏结果 · '+e.text;
  let text=e.text.replace(/^(\d+号) guard 目标(\d+|无)$/,(_,actor,target)=>`${actor} ${target==='无'?'空守':'守护 '+target+'号'}`).replace(/^(\d+号) wolfKill 目标(\d+|无)$/,(_,actor,target)=>`${actor} ${target==='无'?'空刀':'选择刀口 '+target+'号'}`);
  const match=text.match(/^(\d+号)女巫行动 (\{.*\})$/s);
  if(match){try{const r=JSON.parse(match[2]),note=game?.players?.find(p=>p.id===Number(match[1].slice(0,-1)))?.notes?.find(n=>n.startsWith(`第${e.day}夜救了`));const saved=r.saveTarget??note?.match(/救了(\d+)号/)?.[1];text=`${match[1]}女巫行动 · ${r.save?saved?'使用解药救'+saved+'号':'使用解药':r.poison!==null?'毒杀'+r.poison+'号':'不使用药品'}`;}catch{}}
  return text;
}
export function reviewLabel(e){
  const phase={setup:'规则确认',identity:'身份确认',night:'夜间行动',nightDeaths:'天亮结算',speech:'白天发言',vote:'放逐投票',runoffSpeech:'放逐PK',runoffVote:'放逐复投',voteDeaths:'放逐结算',sheriffSignup:'上警',sheriffSpeech:'竞选发言',sheriffWithdraw:'退水',sheriffVote:'警长投票',sheriffPK:'警长PK',sheriffRunoffVote:'警长复投',dayOrder:'发言顺序',explosionDeaths:'自爆结算',finished:'结束'};
  return `${e.day===0?'准备阶段':`第${e.day}${e.phase==='night'?'夜':'天'}`} · ${phase[e.phase]||e.phase||'记录'}${e.privateTo!==null||e.observerOnly?' · 私人行动':''}`;
}
