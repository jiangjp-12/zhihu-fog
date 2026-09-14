<script>
/* ============================================================
   交互层：发言 / 标记 / 投票 / 黑夜选择 / 观战
   ============================================================ */

/** 输入框可用性随阶段与存活状态变化 */
function updateComposer() {
  const box = document.getElementById('composer');
  const tip = document.getElementById('composerTip');
  const canTalk = ['discuss', 'final_discuss'].includes(STATE.phase) || STATE.replay;
  // 我自己刚被投出局时，允许在辩解阶段发言（辩解不保证真实）
  const myDefense = STATE.phase === 'defense' && STATE.lastOut && STATE.lastOut.isMe;
  const ok = ((canAct() || STATE.replay) && canTalk) || myDefense;

  box.style.display = ok ? '' : 'none';
  document.getElementById('input').disabled = !ok;
  document.getElementById('sendBtn').disabled = !ok;

  if (STATE.phase === 'discuss') {
    const mine = STATE.comments.filter((c) => c.authorId === STATE.me?.id && c.round === STATE.round).length;
    tip.textContent = mine ? `本轮你已发 ${mine} 条` : '本轮每人至少发 1 条';
  } else if (STATE.replay) {
    tip.textContent = '复盘模式 · 房间未关闭，可以继续聊';
  } else tip.textContent = '';

  renderActionPanel();
}

function setReply(cid) {
  const c = STATE.comments.find((x) => x.id === cid); if (!c) return;
  STATE.replyTo = cid;
  document.getElementById('replyTo').classList.remove('hidden');
  document.getElementById('replyToName').textContent = c.author;
  document.getElementById('input').focus();
}
function clearReply() {
  STATE.replyTo = null;
  document.getElementById('replyTo').classList.add('hidden');
}

function sendMine() {
  const el = document.getElementById('input');
  const text = el.value.trim();
  if (!text) return;
  if (!canAct() && !STATE.replay) return;
  addComment(STATE.me, text, STATE.replyTo, STATE.phase);
  el.value = ''; clearReply(); updateComposer();
}

/** 私密标记：只写入我自己的视图 + 结算统计 */
function mark(pid, kind) {
  if (!canAct() || STATE.phase !== 'mark') return;
  if (STATE.marks[pid] === kind) delete STATE.marks[pid];
  else {
    STATE.marks[pid] = kind;
    if (kind === 'suspect') STATE.markCounts[pid] = (STATE.markCounts[pid] || 0) + 1;
  }
  renderPlayers();
}

/** 右侧面板：投票 / 黑夜 / 识别 提示 */
function renderActionPanel() {
  const box = document.getElementById('actionPanel');
  const ph = STATE.phase;
  const iAmAliveAI = meAlive() && STATE.me.role === 'ai';

  // 黑夜：只有存活的 AI 有面板，且看不到同伴选择
  if (ph === 'night') {
    if (!iAmAliveAI) {
      box.classList.remove('hidden');
      box.innerHTML = `<h3 class="font-semibold text-sm mb-1">天黑请闭眼</h3>
        <p class="text-xs opacity-60">等待伪人行动…</p>`;
      return;
    }
    const picked = STATE.nightPicks[STATE.me.id];
    box.classList.remove('hidden');
    box.innerHTML = `<h3 class="font-semibold text-sm mb-1">选择折叠对象</h3>
      <p class="text-xs opacity-55 mb-2.5">你看不到另一个伪人的选择。只有两人选中同一人才会生效。</p>
      <div class="space-y-1.5">${alive().filter((p) => p.id !== STATE.me.id).map((p) => `
        <button class="w-full text-left glass-b p-2 text-sm hover:bg-white/10 ${picked === p.id ? 'ring-2 ring-fuchsia-400' : ''}"
          onclick="nightPick('${p.id}')">${p.avatar} ${esc(p.name)}</button>`).join('')}</div>`;
    return;
  }

  // 投票
  if (ph === 'vote1' || ph === 'vote2') {
    box.classList.remove('hidden');
    if (!meAlive()) {
      box.innerHTML = `<h3 class="font-semibold text-sm mb-1">投票进行中</h3>
        <p class="text-xs opacity-60">你已出局，只能观战。</p>`;
      return;
    }
    const my = STATE.votes[STATE.me.id];
    box.innerHTML = `<h3 class="font-semibold text-sm mb-1">${ph === 'vote2' ? '终投' : '投票折叠'}</h3>
      <p class="text-xs opacity-55 mb-2.5">不能投自己。最高票出局。</p>
      <div class="space-y-1.5">${alive().filter((p) => p.id !== STATE.me.id).map((p) => `
        <button class="w-full text-left glass-b p-2 text-sm hover:bg-white/10 ${my === p.id ? 'ring-2 ring-sky-400' : ''}"
          onclick="castVote('${p.id}')">${p.avatar} ${esc(p.name)}
          ${my === p.id ? '<span class="chip text-[10px] ml-1 bg-sky-500/25">已投</span>' : ''}</button>`).join('')}</div>`;
    return;
  }

  if (ph === 'mark') {
    box.classList.remove('hidden');
    box.innerHTML = `<h3 class="font-semibold text-sm mb-1">识别阶段</h3>
      <p class="text-xs opacity-55">在左侧玩家卡上标记「可信 / 可疑」。标记只有你能看到，不影响投票结果。</p>`;
    return;
  }

  if (ph === 'defense') {
    box.classList.remove('hidden');
    box.innerHTML = `<h3 class="font-semibold text-sm mb-1">最后辩解</h3>
      <p class="text-xs opacity-55">出局者的辩解不保证真实。</p>`;
    return;
  }
  box.classList.add('hidden');
}

function nightPick(pid) {
  if (STATE.phase !== 'night' || !meAlive() || STATE.me.role !== 'ai') return;
  STATE.nightPicks[STATE.me.id] = pid;
  renderActionPanel();
}

function castVote(pid) {
  if (!['vote1', 'vote2'].includes(STATE.phase) || !meAlive()) return;
  STATE.votes[STATE.me.id] = pid;
  renderActionPanel();
}

/** 出局揭晓 + 最后辩解 */
function showReveal(p, phase, cnt) {
  const box = document.getElementById('revealBox');
  box.classList.remove('hidden');
  const why = phase === 'night' ? '被伪人折叠' : '被投票折叠';
  box.innerHTML = `<h3 class="font-semibold text-sm mb-2">身份揭晓</h3>
    <div class="glass-b p-3">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-2xl">${p.avatar}</span>
        <div><b>${esc(p.name)}</b>
          <div class="text-xs opacity-60">${why}</div></div>
      </div>
      <div class="chip ${p.role === 'ai' ? 'bg-fuchsia-500/25 border-fuchsia-300/40' : 'bg-emerald-500/20 border-emerald-300/30'}">
        身份：${p.role === 'ai' ? 'AI 伪人' : '真人人类'}</div>
      ${cnt ? `<div class="text-xs opacity-55 mt-2">得票 ${cnt[p.id] || 0} 票</div>` : ''}
    </div>`;

  // 出局者辩解：NPC 由 AI/模板生成；我自己出局则用输入框
  if (phase !== 'night' && !p.isMe) {
    speak(p, 'defense').then((t) => {
      if (t) addComment(p, '【最后辩解】' + t, null, 'defense');
    });
  }
  updateSpectator();
}

/** 观战模式切换 */
function updateSpectator() {
  const out = STATE.me && !STATE.me.alive;
  document.getElementById('specBar').classList.toggle('hidden', !out || STATE.ended);
  document.getElementById('specChat').classList.toggle('hidden', !out);
  if (out) renderSpecMsgs();
  renderPlayers();
}

function renderSpecMsgs() {
  const box = document.getElementById('specMsgs');
  const dead = STATE.players.filter((p) => !p.alive && !p.isMe);
  box.innerHTML = STATE.spectatorMsgs.length
    ? STATE.spectatorMsgs.map((m) => `<div><b class="opacity-70">${esc(m.who)}</b>
        <span class="opacity-85">${esc(m.text)}</span></div>`).join('')
    : `<div class="opacity-45 text-xs">观战席只有你${dead.length ? ' 和 ' + dead.map((d) => d.name).join('、') : ''}。存活玩家看不到这里。</div>`;
  box.scrollTop = box.scrollHeight;
}

function sendSpec() {
  const el = document.getElementById('specInput');
  const t = el.value.trim(); if (!t) return;
  STATE.spectatorMsgs.push({ who: STATE.me.name + '(你)', text: t });
  el.value = '';
  // 其他观战者偶尔回一句
  const others = STATE.players.filter((p) => !p.alive && !p.isMe);
  if (others.length && Math.random() < 0.65) {
    setTimeout(() => {
      const o = pick(others);
      STATE.spectatorMsgs.push({ who: o.name, text: pick(['我早说了。','里面那俩还在演。','看他们投错人真上火。','安静看戏吧。']) });
      renderSpecMsgs();
    }, jitter(700, 1800));
  }
  renderSpecMsgs();
}
</script>
