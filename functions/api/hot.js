// GET /api/hot?circle=tech —— 话题来源
// 1) 配了 ZHIHU_ACCESS_SECRET 走知乎真实热榜
// 2) 否则用已通的 LLM 现生成（每局都不同，无需知乎付费凭证）
// 3) 都不可用 -> 503，前端回落内置话题池
import { store, json } from '../_lib/session.js';

const NAME = { tech:'科技', emo:'情感', work:'职场', campus:'校园', law:'法律' };
const TTL = 180, RL = 150, WIN = 3600;

async function fromZhihu(secret) {
  const res = await fetch('https://developer.zhihu.com/api/v1/hot_list?Limit=30', {
    headers: { Authorization: 'Bearer ' + secret,
               'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)) } });
  if (!res.ok) return null;
  const raw = await res.json();
  const list = raw?.Data?.Items || raw?.data?.items || [];
  const items = (Array.isArray(list) ? list : []).map((x) => ({
    title: x.Title || x.title || '', body: x.Excerpt || x.excerpt || '',
    heat: x.HotScore || x.hot_score || 0,
    hot: [{ n:'热榜', t:'来自知乎实时热榜，暂无评论摘要。' }],
  })).filter((x) => x.title);
  return items.length ? { items, source:'知乎热榜' } : null;
}

async function fromLLM(env, circle) {
  const key = env.LLM_API_KEY;
  if (!key) return null;
  const base = (env.LLM_BASE_URL || 'https://api.openai-next.com').replace(/\/+$/, '');
  const n = NAME[circle] || '科技';
  const res = await fetch(base + '/v1/chat/completions', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + key },
    body: JSON.stringify({
      model: env.LLM_MODEL || 'gpt-4o-mini',
      temperature: 1.05,               // 拉高，避免每次都生成同一个题
      max_tokens: 420,
      messages:[
        { role:'system', content:'你生成知乎风格讨论素材。只输出 JSON，不要解释，不要代码块标记。' },
        { role:'user', content:
          `生成一个「${n}」圈的知乎热帖，JSON 对象：\n` +
          `title: 疑问句标题，25字内，有争议性\n` +
          `body: 正文摘要，60字内，带具体细节或数字\n` +
          `hot: 3条高赞评论数组，每项 {n:昵称, t:评论}，口语化、有态度、25字内、可以互相抬杠\n` +
          `换个新角度，别老生常谈。` }] }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  let t = (d?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    const o = JSON.parse(t);
    if (!o.title) return null;
    const hot = Array.isArray(o.hot) ? o.hot.filter((h) => h && h.t).slice(0, 3) : [];
    return { items:[{ title:String(o.title), body:String(o.body || ''),
             hot: hot.length ? hot : [{ n:'匿名用户', t:'这题有意思，先占个楼。' }] }],
             source:'AI 生成话题' };
  } catch { return null; }
}

export async function onRequestGet({ request, env }) {
  const circle = new URL(request.url).searchParams.get('circle') || 'tech';
  const db = store(env);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = `hrl:${ip}:${Math.floor(Date.now() / (WIN * 1000))}`;
  const used = (await db.get(rl)) || 0;
  if (used >= RL) return json({ error:'rate_limited' }, 429);
  await db.put(rl, used + 1, WIN);

  const ck = `hot:${circle}:${Math.floor(Date.now() / (TTL * 1000))}`;  // 分桶，到点自然换题
  const hit = await db.get(ck);
  if (hit) return json({ ...hit, cached:true });
  try {
    const out = (env.ZHIHU_ACCESS_SECRET ? await fromZhihu(env.ZHIHU_ACCESS_SECRET) : null)
             || await fromLLM(env, circle);
    if (!out) return json({ error:'unavailable' }, 503);
    await db.put(ck, out, TTL);
    return json({ ...out, cached:false });
  } catch (e) {
    return json({ error:'failed', message:String(e?.message || e) }, 502);
  }
}
