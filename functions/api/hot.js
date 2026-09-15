// GET /api/hot?circle=tech —— 知乎热榜代理。
//
// 热榜接口需要开放平台 Access Secret 鉴权，凭证绝不能进浏览器，
// 因此必须由服务端代理。未配置 ZHIHU_ACCESS_SECRET 时返回 503，
// 前端据此回落到内置话题池（游戏流程不受影响）。
import { store, json } from '../_lib/session.js';

const TTL_CACHE = 600;     // 热榜 10 分钟缓存，避免重复消耗额度
const RATE_LIMIT = 120;
const RATE_WINDOW = 3600;

export async function onRequestGet({ request, env }) {
  const secret = env.ZHIHU_ACCESS_SECRET;
  if (!secret) {
    return json({ error: 'not_configured', message: '未配置 Access Secret，使用内置话题池' }, 503);
  }

  const db = store(env);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = `hrl:${ip}:${Math.floor(Date.now() / (RATE_WINDOW * 1000))}`;
  const used = (await db.get(rl)) || 0;
  if (used >= RATE_LIMIT) return json({ error: 'rate_limited' }, 429);
  await db.put(rl, used + 1, RATE_WINDOW);

  // 应用层缓存 + 请求去重（文档明确要求）
  const cacheKey = 'hot:list';
  const cached = await db.get(cacheKey);
  if (cached) return json({ items: cached, cached: true });

  try {
    const res = await fetch('https://developer.zhihu.com/api/v1/hot_list?Limit=30', {
      headers: {
        Authorization: 'Bearer ' + secret,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return json({ error: 'upstream_error', status: res.status }, 502);
    const raw = await res.json();

    // 字段大小写在不同接口间不一致，两种都兼容
    const list = raw?.Data?.Items || raw?.data?.items || raw?.Data || raw?.data || [];
    const items = (Array.isArray(list) ? list : []).map((x) => ({
      title: x.Title || x.title || '',
      body: x.Excerpt || x.excerpt || x.Description || '',
      url: x.Url || x.url || '',
    })).filter((x) => x.title);

    if (!items.length) return json({ error: 'empty' }, 502);
    await db.put(cacheKey, items, TTL_CACHE);
    return json({ items, cached: false });
  } catch (e) {
    return json({ error: 'proxy_failed', message: String(e?.message || e) }, 502);
  }
}
