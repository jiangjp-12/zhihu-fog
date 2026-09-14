// GET  /api/me      —— 当前登录用户（只回公开字段，绝不回 token）
// POST /api/logout  见 logout.js
import { store, readCookie, cookieName, json } from '../_lib/session.js';

export async function onRequestGet({ request, env }) {
  const sid = readCookie(request, cookieName(request.url));
  if (!sid) return json({ login: false, oauth_configured: !!env.ZHIHU_OAUTH_APP_ID });

  const sess = await store(env).get(`sess:${sid}`);
  if (!sess) return json({ login: false, oauth_configured: !!env.ZHIHU_OAUTH_APP_ID });

  // token 过期即停止读取，不静默降级到 Access Secret 所属账号
  if (sess.expiresAt && sess.expiresAt < Date.now()) {
    return json({ login: false, expired: true, oauth_configured: true });
  }
  return json({ login: true, user: sess.user });
}
