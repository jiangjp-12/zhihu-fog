// POST /api/logout —— 清理会话映射；退出后不自动重新登录
import { store, readCookie, cookieName, setCookie, json } from '../_lib/session.js';

export async function onRequestPost({ request, env }) {
  const name = cookieName(request.url);
  const sid = readCookie(request, name);
  if (sid) await store(env).del(`sess:${sid}`);
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie(name, '', request.url, 0) });
}
