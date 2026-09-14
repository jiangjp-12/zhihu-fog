<script>
/* ============================================================
   STATE —— 全局对局状态
   ============================================================ */
const STATE = {
  phase: 'lobby', circle: 'tech', round: 0,
  players: [], me: null, post: null,
  comments: [],           // {id,authorId,author,avatar,text,parent,likes,dislikes,round,phase}
  marks: {},              // 我的私密标记 {playerId:'trust'|'suspect'}
  markCounts: {},         // 结算用：被标记可疑次数
  votes: {},              // 当前轮投票 {voterId:targetId}
  history: [],            // 复盘：每阶段快照
  logs: [], ratings: [],  // AI 调用日志 / 像人评分
  spectatorMsgs: [], replyTo: null,
  nightPicks: {}, timer: null, tick: null, ended: false, replay: false,
};

let CID = 0;
const uid = () => 'c' + (++CID);
const byId = (id) => STATE.players.find((p) => p.id === id);
const alive = () => STATE.players.filter((p) => p.alive);
const aliveAI = () => alive().filter((p) => p.role === 'ai');
const meAlive = () => STATE.me && STATE.me.alive;
const canAct = () => meAlive() && !STATE.replay;

/** 组建 5 席：我固定为真人，其余 4 席中随机 2 席为 AI 伪人 */
function buildPlayers() {
  const names = [], used = new Set();
  while (names.length < 5) {
    const n = pick(NICK_A) + pick(NICK_B);
    if (!used.has(n)) { used.add(n); names.push(n); }
  }
  const avs = [...AVATARS].sort(() => Math.random() - 0.5).slice(0, 5);
  const roles = ['human', 'human', 'ai', 'ai'].sort(() => Math.random() - 0.5); // 4 个 NPC
  const meSeat = Math.floor(Math.random() * 5);

  STATE.players = names.map((name, i) => ({
    id: 'p' + i, name, avatar: avs[i],
    role: i === meSeat ? 'human' : roles.pop(),
    alive: true, isMe: i === meSeat,
    said: 0, out: null,   // out: 'vote1'|'night'|'vote2'
  }));
  STATE.me = STATE.players[meSeat];
  STATE.me.name = document.getElementById('myName').textContent || STATE.me.name;
  STATE.me.avatar = document.getElementById('myAvatar').textContent.trim() || STATE.me.avatar;
  STATE.players.forEach((p) => { STATE.markCounts[p.id] = 0; });
}

/** 接口调用点：真实接入时替换为知乎热榜 / 搜索 API（见 references/http-api.md） */
async function fetchHotPost(circle) {
  // TODO(真实接入): GET https://developer.zhihu.com/api/v1/hot_list
  //   headers: Authorization: Bearer <Access Secret>, X-Request-Timestamp
  //   必须在服务端调用（凭证不进浏览器），前端改为 fetch('/api/hot')
  return MOCK_POSTS[circle] || MOCK_POSTS.tech;
}

/* ===================== 渲染 ===================== */

function renderPost() {
  const p = STATE.post; if (!p) return;
  document.getElementById('postCard').innerHTML = `
    <div class="flex items-center gap-2 mb-2 text-xs">
      <span class="chip" style="background:rgba(0,132,255,.16);border-color:rgba(0,132,255,.4)">
        ${CIRCLES.find((c) => c.id === STATE.circle)?.icon || ''} ${CIRCLES.find((c) => c.id === STATE.circle)?.name || ''}圈</span>
      <span class="opacity-45">热榜 · mock 数据</span>
    </div>
    <h2 class="text-lg font-bold leading-snug mb-2">${esc(p.title)}</h2>
    <p class="text-sm opacity-72 leading-relaxed mb-3">${esc(p.body)}</p>
    <div class="space-y-1.5 pt-3 border-t border-white/10">
      <div class="text-xs opacity-50 mb-1">高赞评论</div>
      ${p.hot.map((h) => `<div class="text-sm flex gap-2">
        <b class="opacity-60 shrink-0">${esc(h.n)}</b>
        <span class="opacity-80">${esc(h.t)}</span></div>`).join('')}
    </div>`;
}

function renderPlayers() {
  const box = document.getElementById('players');
  const show = CONFIG.showIdentity || STATE.ended || !meAlive();  // 出局者知道所有人身份
  box.innerHTML = STATE.players.map((p) => {
    const mk = STATE.marks[p.id];
    const tag = p.alive ? '' : `<span class="chip text-[10px] bg-red-500/20 border-red-400/30">已折叠</span>`;
    const idt = show ? `<span class="chip text-[10px] ${p.role === 'ai' ? 'bg-fuchsia-500/25 border-fuchsia-300/40' : 'bg-emerald-500/20 border-emerald-300/30'}">${p.role === 'ai' ? 'AI 伪人' : '真人'}</span>` : '';
    return `<div class="glass-b p-2.5 flex items-center gap-2.5 ${p.alive ? '' : 'dead'}">
      <span class="text-xl shrink-0">${p.avatar}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium truncate flex items-center gap-1.5">
          ${esc(p.name)} ${p.isMe ? '<span class="chip text-[10px] bg-sky-500/25 border-sky-300/40">你</span>' : ''}
        </div>
        <div class="flex gap-1 mt-0.5 flex-wrap">${tag}${idt}
          ${mk ? `<span class="chip text-[10px] ${mk === 'trust' ? 'bg-emerald-500/20' : 'bg-amber-500/20'}">${mk === 'trust' ? '可信' : '可疑'}</span>` : ''}
          <span class="chip text-[10px] opacity-50">${p.said} 条</span>
        </div>
      </div>
      ${STATE.phase === 'mark' && canAct() && !p.isMe && p.alive ? `
        <div class="flex flex-col gap-1 shrink-0">
          <button class="btn-g text-[10px] px-1.5 py-0.5" onclick="mark('${p.id}','trust')">可信</button>
          <button class="btn-g text-[10px] px-1.5 py-0.5" onclick="mark('${p.id}','suspect')">可疑</button>
        </div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('aliveCount').textContent = `${alive().length}/5 存活`;
}

function renderComments() {
  const box = document.getElementById('comments');
  const tops = STATE.comments.filter((c) => !c.parent);
  const node = (c, depth) => {
    const kids = STATE.comments.filter((k) => k.parent === c.id);
    const p = byId(c.authorId);
    return `<div class="${depth ? 'reply' : ''} fade-in">
      <div class="flex gap-2">
        <span class="text-lg shrink-0 ${p && !p.alive ? 'dead' : ''}">${c.avatar}</span>
        <div class="min-w-0 flex-1">
          <div class="text-xs opacity-55 flex items-center gap-1.5 flex-wrap">
            <b class="opacity-90">${esc(c.author)}</b>
            ${c.authorId === STATE.me?.id ? '<span class="chip text-[10px] bg-sky-500/25">你</span>' : ''}
            <span>· 第${c.round || '-'}轮</span>
          </div>
          <div class="text-sm mt-0.5 leading-relaxed">${esc(c.text)}</div>
          <div class="flex items-center gap-3 mt-1 text-xs opacity-55">
            <button class="hover:opacity-100" onclick="like('${c.id}',1)">▲ ${c.likes}</button>
            <button class="hover:opacity-100" onclick="like('${c.id}',-1)">▼ ${c.dislikes}</button>
            ${canAct() && ['discuss','final_discuss'].includes(STATE.phase)
              ? `<button class="hover:opacity-100 underline" onclick="setReply('${c.id}')">回复</button>` : ''}
            ${STATE.ended || !meAlive() ? rateBtns(c) : ''}
          </div>
          ${kids.map((k) => node(k, depth + 1)).join('')}
        </div>
      </div></div>`;
  };
  box.innerHTML = tops.length ? tops.map((c) => node(c, 0)).join('')
    : '<div class="text-sm opacity-40 py-6 text-center">还没有人发言</div>';
  box.scrollTop = box.scrollHeight;
  document.getElementById('cmtCount').textContent = `${STATE.comments.length} 条`;
}

/** 评分按钮：玩家对 AI 发言打「像人 / 不像人」，写入 logs */
function rateBtns(c) {
  const p = byId(c.authorId);
  if (!p || p.role !== 'ai') return '';
  const r = STATE.ratings.find((x) => x.commentId === c.id);
  if (r) return `<span class="chip text-[10px] ${r.human ? 'bg-emerald-500/20' : 'bg-red-500/20'}">${r.human ? '像人' : '不像人'}</span>`;
  return `<button class="hover:opacity-100 underline" onclick="rate('${c.id}',1)">像人</button>
          <button class="hover:opacity-100 underline" onclick="rate('${c.id}',0)">不像人</button>`;
}

function rate(cid, human) {
  const c = STATE.comments.find((x) => x.id === cid); if (!c) return;
  STATE.ratings.push({ commentId: cid, actor: c.author, text: c.text, human: !!human, at: Date.now() });
  pushLog({ actor: c.author, phase: 'rating', mode: '人工评分', prompt: c.text, reply: human ? '像人 👍' : '不像人 👎' });
  renderComments();
}

function like(cid, d) {
  const c = STATE.comments.find((x) => x.id === cid); if (!c || !canAct()) return;
  if (d > 0) c.likes++; else c.dislikes++;
  renderComments();
}

/** 发一条评论（真人或 NPC 共用） */
function addComment(actor, text, parent = null, phase = STATE.phase) {
  const c = { id: uid(), authorId: actor.id, author: actor.name, avatar: actor.avatar,
              text, parent, likes: 0, dislikes: 0, round: STATE.round, phase };
  STATE.comments.push(c); actor.said++;
  renderComments(); renderPlayers();
  return c;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
</script>
