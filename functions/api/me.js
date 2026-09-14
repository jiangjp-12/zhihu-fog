// GET  /api/me      —— 当前登录用户（只回公开字段，绝不回 token）
// POST /api/logout  见 logout.js
import { store, readCookie, cookieName, json } from '../_lib/session.js';

export async function onRequestGet({ request, env }) {
  // llm_ready 让前端知道能否走服务端默认模型（不暴露 key 本身）
  const base = { oauth_configured: !!env.ZHIHU_OAUTH_APP_ID, llm_ready: !!env.LLM_API_KEY };
  const sid = readCookie(request, cookieName(request.url));
  if (!sid) return json({ login: false, ...base });

  const sess = await store(env).get(`sess:${sid}`);
  if (!sess) return json({ login: false, ...base });

  // token 过期即停止读取，不静默降级到 Access Secret 所属账号
  if (sess.expiresAt && sess.expiresAt < Date.now()) {
    return json({ login: false, expired: true, ...base });
  }
  return json({ login: true, user: sess.user, ...base });
}
