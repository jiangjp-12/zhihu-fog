<script>
/* ============================================================
   入场 UI / 调试台读写 / 日志 / 知乎 OAuth 前端 / 启动
   ============================================================ */

/* ---------- 入场：圈子选择 + 系统分配昵称 ---------- */
function renderCircles() {
  document.getElementById('circles').innerHTML = CIRCLES.map((c) => `
    <button class="glass-b p-3 text-center hover:bg-white/10 transition ${STATE.circle === c.id ? 'ring-2 ring-sky-400' : ''}"
      onclick="pickCircle('${c.id}')" aria-pressed="${STATE.circle === c.id}">
      <div class="text-2xl mb-1">${c.icon}</div>
      <div class="text-sm font-medium">${c.name}</div>
    </button>`).join('');
}
function pickCircle(id) {
  STATE.circle = id;
  const c = CIRCLES.find((x) => x.id === id);
  if (c) { CONFIG.persona = c.persona; document.getElementById('cfgPersona').value = c.persona; }
  renderCircles();
  document.getElementById('lobbyTip').textContent = `AI 人格已切到「${(PERSONAS[CONFIG.persona] || {}).label || ''}」`;
}
/** 匿名头像 + 系统分配昵称 */
function rollIdentity() {
  document.getElementById('myName').textContent = pick(NICK_A) + pick(NICK_B);
  document.getElementById('myAvatar').textContent = pick(AVATARS);
}

/* ---------- 调试台：配置读写 ---------- */
function applyPreset(k) {
  const p = PRESETS[k]; if (!p) return;
  CONFIG.api.preset = k;
  if (p.base_url) document.getElementById('cfgBase').value = p.base_url;
  if (p.model) document.getElementById('cfgModel').value = p.model;
  saveCfg();
}
function readCfgFromUI() {
  CONFIG.api.base_url    = document.getElementById('cfgBase').value.trim();
  CONFIG.api.api_key     = document.getElementById('cfgKey').value.trim();
  CONFIG.api.model       = document.getElementById('cfgModel').value.trim();
  CONFIG.api.temperature = parseFloat(document.getElementById('cfgTemp').value) || 0.85;
  CONFIG.api.max_tokens  = parseInt(document.getElementById('cfgMax').value, 10) || 110;
  CONFIG.api.preset      = document.getElementById('cfgPreset').value;
  CONFIG.persona         = document.getElementById('cfgPersona').value;
  CONFIG.prompt          = document.getElementById('cfgPrompt').value;
  CONFIG.showIdentity    = document.getElementById('cfgShowId').checked;
  CONFIG.logging         = document.getElementById('cfgLog').checked;
}
function writeCfgToUI() {
  document.getElementById('cfgBase').value    = CONFIG.api.base_url;
  document.getElementById('cfgKey').value     = CONFIG.api.api_key;
  document.getElementById('cfgModel').value   = CONFIG.api.model;
  document.getElementById('cfgTemp').value    = CONFIG.api.temperature;
  document.getElementById('cfgMax').value     = CONFIG.api.max_tokens;
  document.getElementById('cfgPreset').value  = CONFIG.api.preset;
  document.getElementById('cfgPersona').value = CONFIG.persona;
  document.getElementById('cfgPrompt').value  = CONFIG.prompt;
  document.getElementById('cfgShowId').checked = CONFIG.showIdentity;
  document.getElementById('cfgLog').checked    = CONFIG.logging;
}
/** api_key 只落本机 localStorage，不上传、不进仓库 */
function saveCfg() {
  readCfgFromUI();
  try { localStorage.setItem('fog_cfg', JSON.stringify({ api: CONFIG.api, prompt: CONFIG.prompt,
        persona: CONFIG.persona, showIdentity: CONFIG.showIdentity, logging: CONFIG.logging })); } catch (e) {}
  updateApiState();
}
function loadCfg() {
  try {
    const s = JSON.parse(localStorage.getItem('fog_cfg') || 'null');
    if (s) Object.assign(CONFIG, { ...CONFIG, ...s, api: { ...CONFIG.api, ...(s.api || {}) } });
  } catch (e) {}
}
/** 三种模式：自带Key（直连） > 服务端默认模型 > 本地拟人模板 */
function updateApiState() {
  const own = !!(CONFIG.api.base_url && CONFIG.api.api_key);
  const el = document.getElementById('apiState');
  if (own)                 { el.textContent = '自带 Key'; el.style.background = 'rgba(16,185,129,.22)'; }
  else if (CONFIG.serverAI){ el.textContent = '服务端默认模型'; el.style.background = 'rgba(0,132,255,.22)'; }
  else                     { el.textContent = '本地模板'; el.style.background = ''; }
}
function resetPrompt() {
  CONFIG.prompt = DEFAULT_PROMPT;
  document.getElementById('cfgPrompt').value = DEFAULT_PROMPT;
  saveCfg();
}
/** 导出配置：api_key 置空，避免密钥外泄 */
function exportCfg() {
  readCfgFromUI();
  const out = { config: { ...CONFIG, api: { ...CONFIG.api, api_key: '' } },
                personas: PERSONAS, exported_at: new Date().toISOString() };
  dl('fog-config.json', JSON.stringify(out, null, 2));
  toast('已导出（api_key 已自动清空）');
}
function importCfg(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      const c = j.config || j;
      if (c.api) Object.assign(CONFIG.api, c.api);
      if (c.prompt) CONFIG.prompt = c.prompt;
      if (c.persona) CONFIG.persona = c.persona;
      if (c.temps) Object.assign(CONFIG.temps, c.temps);
      writeCfgToUI(); saveCfg(); toast('配置已导入');
    } catch (e) { alert('导入失败：' + e.message); }
  };
  r.readAsText(f);
  ev.target.value = '';
}

/* ---------- 日志 ---------- */
function renderLogs() {
  const box = document.getElementById('logs');
  document.getElementById('logCount').textContent = STATE.logs.length;
  box.innerHTML = STATE.logs.slice().reverse().map((l) => `
    <div class="glass-b p-1.5 leading-snug">
      <div class="flex gap-1.5 flex-wrap items-center">
        <span class="opacity-45">${l.t}</span>
        <b class="text-sky-300">${esc(l.actor)}</b>
        <span class="chip text-[10px] opacity-70">${esc(l.phase)}</span>
        <span class="chip text-[10px] ${l.mode === 'API' ? 'bg-emerald-500/20' : l.mode === '降级' || l.mode === '失败' ? 'bg-red-500/20' : 'opacity-60'}">${esc(l.mode)}</span>
        ${l.temp != null ? `<span class="opacity-45">T=${l.temp}</span>` : ''}
        ${l.ms ? `<span class="opacity-45">${l.ms}ms</span>` : ''}
      </div>
      <div class="opacity-50 mt-0.5 truncate">prompt: ${esc(l.prompt || '')}</div>
      <div class="opacity-90">→ ${esc(l.reply || '')}</div>
      ${l.error ? `<div class="text-red-300 opacity-80">err: ${esc(l.error)}</div>` : ''}
    </div>`).join('');
}
function exportLogs() {
  dl('fog-logs.json', JSON.stringify({
    logs: STATE.logs, ratings: STATE.ratings, history: STATE.history,
    voteLog: STATE.voteLog || [], outcome: STATE.outcome || null,
    config: { ...CONFIG, api: { ...CONFIG.api, api_key: '' } },
  }, null, 2));
}
function dl(name, text) {
  const b = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 知乎 OAuth 前端 ----------
   浏览器只跟自己的后端打交道；app_key 与 access_token 全程留在服务端。
   后端路由见 functions/api/oauth/*.js
   本地 file:// 打开时无后端，按钮会提示不可用（游戏本体不受影响）。 */
function zhLogin() { location.href = '/api/oauth/start'; }

async function zhLogout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
  renderAuth({ login: false });
}

async function checkAuth() {
  // 显示回调带回的登录错误
  const q = new URLSearchParams(location.search);
  if (q.get('login_error')) {
    const el = document.getElementById('loginErr');
    el.textContent = '登录失败：' + q.get('login_error');
    el.classList.remove('hidden');
  }
  // 离线 file:// 无后端：关掉服务端 AI，直接用本地模板
  if (location.protocol === 'file:') {
    CONFIG.serverAI = false; updateApiState();
    renderAuth({ login: false, local: true });
    return;
  }
  try {
    const r = await fetch('/api/me', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('no backend');
    const s = await r.json();
    CONFIG.serverAI = s.llm_ready !== false;     // 服务端没配 key 就别白跑一趟
    updateApiState();
    renderAuth(s);
  } catch (e) {
    CONFIG.serverAI = false; updateApiState();    // 静态托管无 Function，降级
    renderAuth({ login: false, local: true });
  }
}

function renderAuth(s) {
  const box = document.getElementById('authBox');
  if (s.login && s.user) {
    const u = s.user;
    box.innerHTML = `<div class="flex items-center gap-2">
      <img src="${esc(u.avatar_path)}" alt="" class="w-7 h-7 rounded-full bg-white/10 object-cover"
           onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'w-7 h-7 rounded-full bg-white/10 grid place-items-center text-xs',textContent:'知'}))">
      <span class="text-xs max-w-[92px] truncate" title="${esc(u.fullname)}">${esc(u.fullname)}</span>
      <button class="btn-g text-xs px-2 py-1" onclick="zhLogout()">退出</button>
    </div>`;
    return;
  }
  const tip = s.local ? '（需部署到云端后可用）' : '';
  box.innerHTML = `<button class="btn-g text-xs px-3 py-1.5" onclick="zhLogin()"
      ${s.local ? 'title="本地打开无后端，部署后可用"' : ''}>知乎账号登录${tip}</button>`;
}

/* ---------- 启动 ---------- */
(function init() {
  document.getElementById('cfgPreset').innerHTML =
    Object.keys(PRESETS).map((k) => `<option value="${k}">${k}</option>`).join('');
  document.getElementById('cfgPersona').innerHTML =
    Object.entries(PERSONAS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  document.getElementById('logoBox').innerHTML = lks('logo', 30);

  loadCfg(); writeCfgToUI(); updateApiState();
  renderCircles(); rollIdentity(); renderLogs();
  document.getElementById('drawer').addEventListener('transitionend', function () {
    const closed = this.classList.contains('closed');
    this.querySelector('button').setAttribute('aria-expanded', String(!closed));
  });
  checkAuth();
})();
</script>
</body>
</html>
