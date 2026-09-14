<script>
/* ============================================================
   结算 + 复盘模式
   胜负：终局 2 AI 存活 = 伪人完胜；1 AI = 平局；0 AI = 人类胜
   ============================================================ */
function finish() {
  clearInterval(STATE.tick);
  STATE.ended = true;
  const n = aliveAI().length;
  const outcome = n >= 2 ? { key:'lose', title:'伪人完胜', sub:'两个 AI 活到了最后',
                             color:'text-fuchsia-300', art:'lose' }
                : n === 1 ? { key:'draw', title:'平局', sub:'还剩一个伪人潜在楼里',
                             color:'text-amber-300', art:'draw' }
                          : { key:'win',  title:'人类胜', sub:'两个伪人都被折叠了',
                             color:'text-emerald-300', art:'win' };
  STATE.outcome = outcome;

  curtain(outcome.art, '本局结束', outcome.title, 2400).then(() => {
    document.getElementById('game').classList.add('hidden');
    renderResult(outcome);
    document.getElementById('result').classList.remove('hidden');
    document.getElementById('phaseName').textContent = '结算';
    document.getElementById('phaseHint').textContent = outcome.title;
    document.getElementById('clock').textContent = '--';
    document.getElementById('bar').style.width = '100%';
    document.getElementById('specBar').classList.add('hidden');
    // 结算展示 20s 后自动进入复盘模式（房间不关闭）
    setTimeout(enterReplay, CONFIG.durations.settle * 1000);
  });
}

/** 每个人的投票命中情况：投中 AI 记一次命中 */
function voteHits(pid) {
  let hit = 0, total = 0;
  (STATE.voteLog || []).forEach((v) => {
    const t = v.votes[pid];
    if (!t) return;
    total++;
    if (byId(t)?.role === 'ai') hit++;
  });
  return { hit, total };
}

function renderResult(outcome) {
  const box = document.getElementById('result');
  const rows = STATE.players.map((p) => {
    const said = STATE.comments.filter((c) => c.authorId === p.id);
    const vh = voteHits(p.id);
    const outTxt = p.alive ? '存活' :
      ({ vote1:'首轮被投出', night:'黑夜被折叠', vote2:'终投被投出' }[p.out] || '出局');
    return `<div class="glass-b p-3">
      <div class="flex items-center gap-2 flex-wrap mb-1.5">
        <span class="text-xl">${p.avatar}</span>
        <b>${esc(p.name)}</b>
        ${p.isMe ? '<span class="chip text-[10px] bg-sky-500/25 border-sky-300/40">你</span>' : ''}
        <span class="chip text-[10px] ${p.role === 'ai' ? 'bg-fuchsia-500/25 border-fuchsia-300/40' : 'bg-emerald-500/20 border-emerald-300/30'}">
          ${p.role === 'ai' ? 'AI 伪人' : '真人'}</span>
        <span class="chip text-[10px] opacity-60">${outTxt}</span>
      </div>
      <div class="flex gap-4 text-xs opacity-65 mb-2 flex-wrap">
        <span>发言 ${said.length} 条</span>
        <span>被标记可疑 ${STATE.markCounts[p.id] || 0} 次</span>
        <span>投票命中 AI ${vh.hit}/${vh.total}</span>
      </div>
      <div class="space-y-1 text-sm">
        ${said.length ? said.map((c) => `<div class="opacity-80">· ${esc(c.text)}</div>`).join('')
                      : '<div class="opacity-40 text-xs">全程没说话</div>'}
      </div>
    </div>`;
  }).join('');

  const ratings = STATE.ratings.length
    ? `<div class="glass-b p-3 mt-3">
        <div class="text-sm font-semibold mb-1.5">AI 发言评分</div>
        <div class="text-xs opacity-70">共 ${STATE.ratings.length} 条评分 ·
          像人 ${STATE.ratings.filter((r) => r.human).length} ·
          不像人 ${STATE.ratings.filter((r) => !r.human).length}
          （数据已写入 logs，可在调试台导出）</div></div>` : '';

  box.innerHTML = `
    <div class="text-center mb-5">
      <div class="flex justify-center mb-1">${lks(outcome.art, 130)}</div>
      <h2 class="text-2xl font-bold ${outcome.color}">${outcome.title}</h2>
      <p class="text-sm opacity-60 mt-1">${outcome.sub} · 终局存活伪人 ${aliveAI().length} 个</p>
    </div>
    <div class="grid md:grid-cols-2 gap-3">${rows}</div>
    ${ratings}
    <div class="flex gap-2.5 justify-center mt-5 flex-wrap">
      <button class="btn px-5 py-2.5" onclick="restart()">再来一局</button>
      <button class="btn-g px-4 py-2.5 text-sm" onclick="enterReplay()">进入复盘模式</button>
      <button class="btn-g px-4 py-2.5 text-sm" onclick="exportLogs()">导出本局日志</button>
    </div>`;
}

/** 复盘模式：房间不关闭，可回看全部记录、继续聊天 */
function enterReplay() {
  if (STATE.replay) return;
  STATE.replay = true;
  document.getElementById('result').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('specChat').classList.add('hidden');
  STATE.phase = 'replay';
  document.getElementById('phaseName').textContent = '复盘模式';
  document.getElementById('phaseHint').textContent = '房间未关闭 · 可回看记录并继续聊';
  document.getElementById('clock').textContent = '∞';

  const box = document.getElementById('revealBox');
  box.classList.remove('hidden');
  box.innerHTML = `<h3 class="font-semibold text-sm mb-2">本局流程回看</h3>
    <div class="space-y-1 text-xs opacity-75 max-h-52 overflow-y-auto">
      ${STATE.history.map((h) => `<div>· ${PHASE_META[h.phase]?.name || h.phase}
        ${h.phase === 'discuss' ? '第' + h.round + '轮' : ''} —— 累计 ${h.comments} 条发言，存活 ${h.alive.length} 人</div>`).join('')}
      ${(STATE.voteLog || []).map((v) => `<div>· ${PHASE_META[v.phase]?.name || v.phase}：${esc(v.out)} 出局（${v.role === 'ai' ? 'AI 伪人' : '真人'}）${v.tie ? ' · 平票随机' : ''}</div>`).join('')}
    </div>
    <button class="btn w-full mt-3 py-2 text-sm" onclick="restart()">再来一局</button>`;

  renderPlayers(); renderComments(); updateComposer();
  toast('复盘模式：所有身份已公开，可继续聊天');
}

/** 再来一局：重置对局态，保留调试配置与日志 */
function restart() {
  clearInterval(STATE.tick);
  Object.assign(STATE, {
    phase:'lobby', round:0, players:[], me:null, post:null, comments:[],
    marks:{}, markCounts:{}, votes:{}, history:[], voteLog:[],
    spectatorMsgs:[], replyTo:null, nightPicks:{}, nightMsg:'', lastOut:null,
    ended:false, replay:false, ratings:[],
  });
  CID = 0;
  document.getElementById('result').classList.add('hidden');
  document.getElementById('game').classList.add('hidden');
  document.getElementById('revealBox').classList.add('hidden');
  document.getElementById('actionPanel').classList.add('hidden');
  document.getElementById('specBar').classList.add('hidden');
  document.getElementById('specChat').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('phaseName').textContent = '准备中';
  document.getElementById('phaseHint').textContent = '选择你的圈子';
  document.getElementById('clock').textContent = '--';
  document.getElementById('bar').style.width = '100%';
  rollIdentity();
}
</script>
