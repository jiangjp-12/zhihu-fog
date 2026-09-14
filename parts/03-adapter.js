<script>
/* ============================================================
   adapter.js —— OpenAI 兼容调用层 + 本地拟人降级
   未配置 base_url / api_key 时自动走 localTemplate()，游戏流程不中断。
   ============================================================ */

/** 记录一次调用日志（对应开源包 logs.json） */
function pushLog(entry) {
  if (!CONFIG.logging) return;
  STATE.logs.push({ t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...entry });
  if (STATE.logs.length > 300) STATE.logs.shift();
  renderLogs();
}

/** OpenAI 兼容格式调用；失败抛错由上层降级 */
async function callAI(messages, cfg) {
  const base = (cfg.base_url || '').replace(/\/+$/, '');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.api_key },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt) throw new Error('响应为空');
  return txt;
}

/** 清洗模型输出：去引号、去昵称前缀、去套话、砍长度 */
function sanitize(text) {
  let s = String(text).trim().replace(/^["'「『]|["'」』]$/g, '');
  s = s.replace(/^[一-龥A-Za-z0-9_]{1,12}[:：]\s*/, '');   // 去掉"某某："前缀
  s = s.replace(/(首先|其次|最后|综上所述|值得注意的是|不难发现|由此可见|总而言之)[，,、]?/g, '');
  s = s.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (s.length > 60) {                                              // 超长按句截断
    const cut = s.slice(0, 60);
    const p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('？'), cut.lastIndexOf('！'));
    s = p > 18 ? cut.slice(0, p + 1) : cut + '…';
  }
  return s || '这话题我还真没想明白。';
}

/* ===================== 本地拟人模板（降级路径） =====================
   按阶段 + 人格取句，随机组合。不追求聪明，追求"像人随口一说"。 */
const T = {
  discuss: {
    tech:  ['这数据我实测过，跟宣传差挺远。','营销号又赢一次？','参数好看不代表手感好看。','我更关心一年后还剩多少。','所以到底谁在为这个买单？','用过就知道，别看评测。'],
    emo:   ['我经历过类似的，不好受。','沉默有时候比吵架伤人。','你确定他懂你在说什么吗？','这事儿真不是一句话能断的。','说到底还是不被在意吧。','我当年也这么自我怀疑过。'],
    work:  ['这不就是降本增效四个字？','领导一拍脑袋，我们跑三个月。','KPI 好看就行，谁管体验。','加班能解决的，从不叫问题。','我们公司也这么干过，黄了。','说灵活的，自己有独立办公室吧。'],
    campus:['啊这，我室友一模一样。','真的服了这套说法。','绩点这事儿别聊，伤感情。','食堂都比这靠谱点。','我导师也这么讲，笑死。','所以现在到底该卷哪边啊。'],
  },
  probe: ['楼上说得太顺了，像背过。','你这句怎么看着有点眼熟？','谁复述一下自己刚才的观点？','有人一直在跟着别人说话。','说细节啊，别说结论。','我怀疑这里有俩不太对的。'],
  defense:['投我？我从头到尾都在聊帖子。','行吧，反正我说什么你们都不信。','出局也认了，但你们抓错人了。','真的伪人还在里面笑呢。','我要是 AI，会说得这么难听？','下一轮你们就知道投错了。'],
  final: ['最后一轮了，别再抬杠了。','刚才那句话，我记着呢。','谁最安静谁最可疑。','我改主意了，说实话。','就剩这几个，不难猜吧？','这轮投错就没机会了。'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function localTemplate(actor, phase) {
  const p = CONFIG.persona;
  if (phase === 'defense') return pick(T.defense);
  if (phase === 'final_discuss') return pick(T.final);
  // 讨论阶段：第二轮开始掺入试探句
  const pool = (STATE.round >= 2 && Math.random() < 0.42) ? T.probe : (T.discuss[p] || T.discuss.tech);
  return pick(pool);
}

/** 构造系统提示词：{ROLE} / {ROLE_GOAL} 占位符 + 人格语气 */
function buildSystem(actor) {
  const isAI = actor.role === 'ai';
  return CONFIG.prompt
      .replace('{ROLE}', isAI ? 'AI 伪人' : '真人人类')
      .replace('{ROLE_GOAL}', isAI ? ROLE_GOAL.ai : ROLE_GOAL.human)
    + `\n\n你的说话风格：${(PERSONAS[CONFIG.persona] || PERSONAS.tech).tone}`
    + `\n你的昵称是「${actor.name}」。`;
}

/** 组装上下文：帖子 + 最近发言 */
function buildContext(phase) {
  const post = STATE.post;
  let ctx = `帖子标题：${post.title}\n帖子摘要：${post.body}\n\n`;
  const recent = STATE.comments.slice(-8).map((c) => `${c.author}：${c.text}`).join('\n');
  if (recent) ctx += `最近的评论：\n${recent}\n\n`;
  if (phase === 'discuss')       ctx += `现在是第 ${STATE.round} 轮讨论，请就这个话题发一条评论。`;
  if (phase === 'final_discuss') ctx += `现在是终轮讨论，围绕"谁最可疑"简短说一句，可以质问或辩解。`;
  if (phase === 'defense')       ctx += `你刚刚被投票出局，发表最后辩解。辩解不必真实。`;
  return ctx;
}

/**
 * 让某个角色发一句话。优先真实 API，失败自动降级本地模板。
 * @returns {Promise<string>}
 */
async function speak(actor, phase) {
  const temp = CONFIG.temps[phase] ?? CONFIG.api.temperature;
  const useAPI = !!(CONFIG.api.base_url && CONFIG.api.api_key);
  const t0 = performance.now();

  if (!useAPI) {
    const text = localTemplate(actor, phase);
    pushLog({ actor: actor.name, phase, mode: '本地模板', temp, ms: 0, prompt: '(未配置 API)', reply: text });
    return text;
  }
  const messages = [
    { role: 'system', content: buildSystem(actor) },
    { role: 'user',   content: buildContext(phase) },
  ];
  try {
    const raw = await callAI(messages, { ...CONFIG.api, temperature: temp });
    const text = sanitize(raw);
    pushLog({ actor: actor.name, phase, mode: 'API', temp, ms: Math.round(performance.now() - t0),
              prompt: messages[1].content.slice(-90), reply: text });
    return text;
  } catch (e) {
    const text = localTemplate(actor, phase);
    pushLog({ actor: actor.name, phase, mode: '降级', temp, ms: Math.round(performance.now() - t0),
              prompt: '调用失败', reply: text, error: String(e.message || e) });
    return text;
  }
}

/** 调试台"测试调用"按钮 */
async function testAI() {
  readCfgFromUI();
  if (!CONFIG.api.base_url || !CONFIG.api.api_key) { alert('请先填 base_url 和 api_key'); return; }
  const t0 = performance.now();
  try {
    const r = await callAI([{ role:'system', content:'用一句话回应，不超过 20 字。' },
                            { role:'user',   content:'测试连通性' }], CONFIG.api);
    pushLog({ actor:'(测试)', phase:'test', mode:'API', temp:CONFIG.api.temperature,
              ms:Math.round(performance.now()-t0), prompt:'测试连通性', reply:sanitize(r) });
    alert('调用成功：' + sanitize(r));
  } catch (e) {
    pushLog({ actor:'(测试)', phase:'test', mode:'失败', ms:Math.round(performance.now()-t0),
              prompt:'测试连通性', reply:'-', error:String(e.message||e) });
    alert('调用失败：' + (e.message || e));
  }
  updateApiState();
}
</script>
