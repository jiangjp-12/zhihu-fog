<script>
/* ============================================================
   阶段引擎：倒计时 + 刘看山全屏过渡 + 10 阶段状态机
   ============================================================ */
const PHASE_META = {
  post:          { name:'帖子加载', hint:'看清楼里在聊什么' },
  discuss:       { name:'讨论阶段', hint:'只聊热点，别聊 AI' },
  mark:          { name:'识别阶段', hint:'私密标记，不影响投票' },
  vote1:         { name:'第一轮投票', hint:'不能投自己' },
  defense:       { name:'最后辩解', hint:'辩解不保证真实' },
  night:         { name:'黑夜', hint:'伪人独立选择折叠对象' },
  final_discuss: { name:'终轮讨论', hint:'谁最可疑？' },
  vote2:         { name:'终投', hint:'最后一票' },
  settle:        { name:'结算', hint:'揭晓所有身份' },
  replay:        { name:'复盘模式', hint:'房间未关闭，可继续聊' },
};

/** 全屏过渡；resolve 后继续流程 */
function curtain(variant, title, sub = '', hold = 1750, mood = 'norm') {
  return new Promise((resolve) => {
    const c = document.getElementById('curtain');
    document.getElementById('ctArt').innerHTML = lks(variant, 170);
    document.getElementById('ctTitle').textContent = title;
    document.getElementById('ctSub').textContent = sub;
    c.className = mood + ' show';
    setTimeout(() => {
      c.classList.remove('show');
      setTimeout(resolve, 520);           // 等 opacity transition 收尾
    }, hold);
  });
}

/** 跑一个带倒计时的阶段 */
function runPhase(phase, secs, onEnd, onStart) {
  STATE.phase = phase;
  STATE.gen = (STATE.gen || 0) + 1;      // 阶段代际：让上一轮遗留的 NPC 发言循环自然退出
  const meta = PHASE_META[phase] || { name: phase, hint: '' };
  document.getElementById('phaseName').textContent =
    meta.name + (phase === 'discuss' ? ` 第${STATE.round}轮` : '');
  document.getElementById('phaseHint').textContent = meta.hint;
  document.getElementById('roundTag').textContent =
    phase === 'discuss' ? `第 ${STATE.round} / ${CONFIG.rounds} 轮` : meta.name;
  updateComposer(); renderPlayers();

  // onStart 必须在 phase/gen 设定之后触发。
  // 之前把 npcSpeak() 放在 runPhase() 之前调用，导致它读到的还是上一个阶段，
  // 首行守卫直接 return —— NPC 全程一句话都不发。
  if (onStart) onStart();

  clearInterval(STATE.tick);
  let left = secs;
  const paint = () => {
    document.getElementById('clock').textContent =
      String(Math.floor(left / 60)) + ':' + String(left % 60).padStart(2, '0');
    document.getElementById('bar').style.width = (left / secs * 100) + '%';
  };
  paint();
  return new Promise((resolve) => {
    STATE.tick = setInterval(() => {
      left--; paint();
      if (left <= 0) {
        clearInterval(STATE.tick);
        snapshot(phase);
        resolve(onEnd ? onEnd() : undefined);
      }
    }, 1000);
  });
}

/** 复盘快照 */
function snapshot(phase) {
  STATE.history.push({
    phase, round: STATE.round,
    comments: STATE.comments.length,
    votes: { ...STATE.votes },
    alive: alive().map((p) => p.name),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

/** 让所有存活 NPC 依次发言（错开时间，像真人陆续冒出来） */
async function npcSpeak(phase, filterFn) {
  const gen = STATE.gen;                          // 绑定本轮代际
  const npcs = alive().filter((p) => !p.isMe && (!filterFn || filterFn(p)));
  npcs.sort(() => Math.random() - 0.5);
  for (const npc of npcs) {
    // 阶段切换或进入下一轮，立刻停止（避免上一轮发言溢到下一轮）
    if (STATE.phase !== phase || STATE.gen !== gen) return;
    await sleep(jitter(900, 2600));
    if (STATE.phase !== phase || STATE.gen !== gen) return;
    const text = await speak(npc, phase);
    if (STATE.phase !== phase || STATE.gen !== gen) return;
    // 有一定概率作为楼中楼回复挂在别人评论下
    const cands = STATE.comments.filter((c) => !c.parent && c.authorId !== npc.id);
    const parent = (cands.length && Math.random() < 0.4) ? pick(cands).id : null;
    addComment(npc, text, parent, phase);
  }
}

/* ===================== 主流程 ===================== */
async function startGame() {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  buildPlayers();
  STATE.post = await fetchHotPost(STATE.circle);
  renderPost(); renderPlayers(); renderComments();

  // 2. 帖子加载 20s
  await runPhase('post', CONFIG.durations.post);

  // 3. 讨论 2 轮 × 90s
  await curtain('discuss', '开始讨论', '只聊热点，别聊 AI', 1900);
  for (let r = 1; r <= CONFIG.rounds; r++) {
    STATE.round = r;
    // 作为 onStart 传入：阶段就绪后再让 NPC 陆续发言，与倒计时并行（不 await）
    await runPhase('discuss', CONFIG.durations.discuss, null, () => npcSpeak('discuss'));
  }

  // 4. 识别 60s
  await curtain('hunt', '现在开始找 AI', '标记是私密的，不影响投票', 1900);
  await runPhase('mark', CONFIG.durations.mark, () => { npcMark(); });

  // 5. 第一轮投票 30s
  await curtain('vote', '投票折叠', '存活者各 1 票，不能投自己', 1750);
  await runPhase('vote1', CONFIG.durations.vote1);
  const out1 = tallyVotes('vote1');

  // 出局者辩解 30s
  if (out1) {
    await runPhase('defense', CONFIG.durations.defense, null);
  }

  if (checkEnd()) return;

  // 6. 黑夜 20s
  await curtain('night', '天黑请闭眼', '伪人独立选择，互不知情', 2100, 'night');
  await runPhase('night', CONFIG.durations.night, () => resolveNight());
  await curtain('day', '天亮了', STATE.nightMsg || '', 1900, 'day');
  if (STATE.nightMsg) toast(STATE.nightMsg);

  if (checkEnd()) return;

  // 7. 终轮讨论 45s
  STATE.round = 3;
  await runPhase('final_discuss', CONFIG.durations.final_discuss, null,
                 () => npcSpeak('final_discuss'));

  // 8. 终投 30s
  await curtain('vote', '最后一票', '最高票出局', 1650);
  await runPhase('vote2', CONFIG.durations.vote2);
  tallyVotes('vote2');

  // 9. 结算
  finish();
}

/** 计票：最高票出局，平票随机；返回出局者 */
function tallyVotes(phase) {
  // 补齐未投票的 NPC
  alive().forEach((p) => { if (!p.isMe && !STATE.votes[p.id]) STATE.votes[p.id] = npcVote(p); });

  const cnt = {};
  Object.values(STATE.votes).forEach((t) => { if (t) cnt[t] = (cnt[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(cnt));
  if (!max) { STATE.votes = {}; return null; }

  const top = Object.keys(cnt).filter((k) => cnt[k] === max);
  const outId = pick(top);
  const out = byId(outId);
  out.alive = false; out.out = phase;
  STATE.lastOut = out;                            // 供辩解阶段判断是否是我自己

  STATE.voteLog = STATE.voteLog || [];
  STATE.voteLog.push({ phase, votes: { ...STATE.votes }, out: out.name, role: out.role, tie: top.length > 1 });

  showReveal(out, phase, cnt);
  STATE.votes = {};
  renderPlayers(); renderComments(); updateComposer(); updateSpectator();
  return out;
}

/** NPC 投票倾向：AI 优先投票给"标记自己可疑"或发言最像人类侦探的；真人投可疑的 */
function npcVote(p) {
  const cands = alive().filter((x) => x.id !== p.id);
  if (!cands.length) return null;
  const score = cands.map((c) => {
    let s = Math.random() * 2;
    if (p.role === 'ai') {
      s += (STATE.markCounts[c.id] || 0) * 0.3;          // 被公认可疑的，顺水推舟
      if (c.role === 'ai') s -= 1.1;                      // 弱直觉：说话方式相近，略回避
      if (c.isMe) s += 0.9;                               // 真人玩家威胁最大
    } else {
      s += (STATE.markCounts[c.id] || 0) * 0.85;
      if (c.role === 'ai') s += 0.7;                       // 真人有一定判断力
    }
    return { id: c.id, s };
  }).sort((a, b) => b.s - a.s);
  return score[0].id;
}

/** NPC 私密标记（只影响 markCounts，用于结算展示与投票倾向） */
function npcMark() {
  alive().filter((p) => !p.isMe).forEach((p) => {
    const t = pick(alive().filter((x) => x.id !== p.id));
    if (t && Math.random() < 0.75) STATE.markCounts[t.id] = (STATE.markCounts[t.id] || 0) + 1;
  });
}

/**
 * 黑夜判定：
 *   2 AI 存活 + 同一目标 -> 出局
 *   2 AI 存活 + 不同目标 -> 无人出局
 *   1 AI 存活           -> 直接生效
 */
function resolveNight() {
  const ais = aliveAI();
  STATE.nightMsg = '';
  if (!ais.length) return;

  ais.forEach((ai) => {
    if (ai.isMe) return;                                   // 我是 AI 时用面板选择
    const cands = alive().filter((x) => x.id !== ai.id);
    if (cands.length) STATE.nightPicks[ai.id] = pick(cands).id;
  });

  const picks = ais.map((a) => STATE.nightPicks[a.id]).filter(Boolean);
  if (ais.length >= 2) {
    if (picks.length === 2 && picks[0] === picks[1]) {
      const v = byId(picks[0]); v.alive = false; v.out = 'night';
      STATE.nightMsg = `${v.name} 被折叠了`;
      showReveal(v, 'night', null);
    } else {
      STATE.nightMsg = '昨夜平安无事 —— 两个伪人选了不同的人';
    }
  } else if (picks.length === 1) {
    const v = byId(picks[0]); v.alive = false; v.out = 'night';
    STATE.nightMsg = `${v.name} 被折叠了`;
    showReveal(v, 'night', null);
  }
  STATE.nightPicks = {};
  renderPlayers(); updateComposer(); updateSpectator();
}

/** 提前结束判定：AI 全灭立刻结束 */
function checkEnd() {
  if (aliveAI().length === 0) { finish(); return true; }
  if (alive().length <= 2) { finish(); return true; }
  return false;
}

function toast(msg) {
  const d = document.createElement('div');
  d.className = 'fixed left-1/2 -translate-x-1/2 top-20 z-[70] glass px-4 py-2 text-sm fade-in';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
</script>
