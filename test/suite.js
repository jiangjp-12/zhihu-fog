// 游戏规则测试用例。由 harness.js 在 index.html 的脚本作用域内 eval。
console.log('[1] 组队：5 席 = 3 真人 + 2 AI');
let bad = 0;
for (let i = 0; i < 300; i++) {
  buildPlayers();
  const ai = STATE.players.filter(p => p.role === 'ai').length;
  const hu = STATE.players.filter(p => p.role === 'human').length;
  if (STATE.players.length !== 5 || ai !== 2 || hu !== 3 || STATE.me.role !== 'human') bad++;
}
ok('300 次组队均为 3 真人 + 2 AI，且"我"总是真人', bad === 0);
buildPlayers();
ok('昵称与头像不重复',
  new Set(STATE.players.map(p => p.name)).size === 5 &&
  new Set(STATE.players.map(p => p.avatar)).size === 5);

console.log('');
console.log('[2] 黑夜判定（isMe=true 以绕过随机自动选择，直测判定分支）');
buildPlayers(); STATE.phase = 'night'; STATE.nightPicks = {};
let ais = STATE.players.filter(p => p.role === 'ai'); ais.forEach(a => a.isMe = true);
let target = STATE.players.find(p => p.role === 'human');
ais.forEach(a => STATE.nightPicks[a.id] = target.id);
resolveNight();
ok('2 AI 同选 -> 目标出局', !target.alive && /被折叠/.test(STATE.nightMsg));

buildPlayers(); STATE.phase = 'night'; STATE.nightPicks = {};
ais = STATE.players.filter(p => p.role === 'ai'); ais.forEach(a => a.isMe = true);
const hs = STATE.players.filter(p => p.role === 'human');
ais.forEach((a, i) => STATE.nightPicks[a.id] = hs[i].id);
resolveNight();
ok('2 AI 分歧 -> 无人出局 + 平安提示',
  STATE.players.filter(p => p.alive).length === 5 && /平安/.test(STATE.nightMsg));

buildPlayers(); STATE.phase = 'night'; STATE.nightPicks = {};
ais = STATE.players.filter(p => p.role === 'ai'); ais[1].alive = false;
const solo = ais[0]; solo.isMe = true;
const t2 = STATE.players.find(p => p.role === 'human');
STATE.nightPicks[solo.id] = t2.id;
resolveNight();
ok('仅 1 AI 存活 -> 选择直接生效', !t2.alive);

console.log('');
console.log('[3] 胜负判定');
const outcomeOf = (n) => {
  buildPlayers();
  STATE.comments = []; STATE.voteLog = []; STATE.history = []; STATE.ratings = []; STATE.ended = false;
  const a = STATE.players.filter(p => p.role === 'ai');
  for (let i = 0; i < 2 - n; i++) a[i].alive = false;
  finish();
  return STATE.outcome.key;
};
ok('2 AI 存活 -> 伪人完胜(lose)', outcomeOf(2) === 'lose');
ok('1 AI 存活 -> 平局(draw)', outcomeOf(1) === 'draw');
ok('0 AI 存活 -> 人类胜(win)', outcomeOf(0) === 'win');

console.log('');
console.log('[4] 计票');
buildPlayers();
STATE.votes = {}; STATE.voteLog = []; STATE.phase = 'vote1'; STATE.ended = false;
const victim = STATE.players[1];
STATE.players.forEach(p => { if (p.id !== victim.id) STATE.votes[p.id] = victim.id; });
const out = tallyVotes('vote1');
ok('最高票者出局', !!out && out.id === victim.id && !victim.alive);
ok('写入 voteLog 且标注身份', STATE.voteLog.length === 1 && STATE.voteLog[0].role === victim.role);
let noSelf = true;
for (let i = 0; i < 300; i++) {
  buildPlayers();
  const p = STATE.players[i % 5];
  if (npcVote(p) === p.id) { noSelf = false; break; }
}
ok('NPC 投票 300 次从不投自己', noSelf);

console.log('');
console.log('[5] 阶段时长');
const d = CONFIG.durations;
const total = d.post + d.discuss * CONFIG.rounds + d.mark + d.vote1 + d.defense
            + d.night + d.final_discuss + d.vote2 + d.settle;
console.log('  对局时长 ' + total + ' 秒 = ' + Math.floor(total / 60) + '分' + (total % 60) + '秒'
          + '（+入场 15s = ' + (total + 15) + 's）');
// 规则里"约 6分50秒"与逐阶段列出的时长自相矛盾：
// 15+20+180+60+30+30+20+45+30+20 = 450s = 7分30秒。
// 逐阶段时长是明确规范，聚合值是约数，因此以逐阶段为准。
ok('各阶段时长与规则逐条一致', d.post === 20 && d.discuss === 90 && CONFIG.rounds === 2
  && d.mark === 60 && d.vote1 === 30 && d.defense === 30 && d.night === 20
  && d.final_discuss === 45 && d.vote2 === 30 && d.settle === 20);
ok('对局总时长 = 435s（含入场 450s）', total === 435);

console.log('');
console.log('[6] sanitize 清洗');
const s1 = sanitize('首先，这个问题值得注意的是，综上所述我觉得不行。');
ok('套话被剔除', !/首先|值得注意的是|综上所述/.test(s1));
console.log('  -> ' + s1);
ok('去掉昵称前缀与引号', sanitize('"摸鱼的鱼：这事儿没那么简单"') === '这事儿没那么简单');
ok('超长输出被截断', sanitize('啊'.repeat(200)).length <= 61);

console.log('');
console.log('[7] 降级路径（未配置 API）');
CONFIG.api.base_url = ''; CONFIG.api.api_key = '';
buildPlayers(); STATE.post = MOCK_POSTS.tech; STATE.round = 1; STATE.logs = [];
speak(STATE.players[0], 'discuss').then((t) => {
  ok('无 API 时 speak() 返回本地模板文本', typeof t === 'string' && t.length > 0);
  ok('日志记录 mode=本地模板', STATE.logs.length === 1 && STATE.logs[0].mode === '本地模板');
  console.log('  样例发言: ' + t);
  __done();
});
