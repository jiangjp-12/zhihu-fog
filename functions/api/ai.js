// POST /api/ai —— LLM 代理。
//
// 存在的理由：默认体验不该要求用户自带 API key，但把项目方的 key 放进前端
// 等于公开（看一眼源码就能拿走并烧掉额度）。所以 key 只存服务端 secret，
// 浏览器调这个端点，由它转发。
//
// 前端仍可填自己的 base_url + api_key 走直连（调试台），那条路不经过这里。
import { store, json } from '../_lib/session.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS_CAP = 300;      // 这是评论区短发言，不需要长输出
const RATE_LIMIT = 240;          // 每 IP 每小时上限，防被当成免费 API 刷
const RATE_WINDOW = 3600;

export async function onRequestPost({ request, env }) {
  const key = env.LLM_API_KEY;
  const base = (env.LLM_BASE_URL || 'https://api.openai-next.com').replace(/\/+$/, '');
  if (!key) {
    // 未配置就明确告知，前端据此降级到本地拟人模板
    return json({ error: 'llm_not_configured', message: '服务端未配置 LLM，已降级本地模板' }, 503);
  }

  // --- 限流：公开端点必须有，否则等于把额度送人 ---
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const db = store(env);
  const bucket = `rl:${ip}:${Math.floor(Date.now() / (RATE_WINDOW * 1000))}`;
  const used = (await db.get(bucket)) || 0;
  if (used >= RATE_LIMIT) {
    return json({ error: 'rate_limited', message: '调用过于频繁，请稍后再试或在调试台填入自己的 API Key' }, 429);
  }
  await db.put(bucket, used + 1, RATE_WINDOW);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || !messages.length) return json({ error: 'messages_required' }, 400);

  // 收紧入参：不让客户端指定任意模型或超长输出
  const payload = {
    model: env.LLM_MODEL || DEFAULT_MODEL,
    messages: messages.slice(-12).map((m) => ({
      role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
      content: String(m.content ?? '').slice(0, 4000),
    })),
    temperature: Math.min(Math.max(Number(body.temperature) || 0.85, 0), 2),
    max_tokens: Math.min(Math.max(parseInt(body.max_tokens, 10) || 110, 16), MAX_TOKENS_CAP),
  };

  try {
    const t0 = Date.now();
    const res = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      // 不把上游报文原样透出，避免泄露账号/额度细节
      return json({ error: 'upstream_error', status: res.status }, 502);
    }
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: 'upstream_bad_json' }, 502); }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return json({ error: 'empty_completion' }, 502);

    // 只回内容与耗时；不回 key、不回上游完整响应
    return json({ content, ms: Date.now() - t0, model: payload.model });
  } catch (e) {
    return json({ error: 'proxy_failed', message: String(e?.message || e) }, 502);
  }
}
