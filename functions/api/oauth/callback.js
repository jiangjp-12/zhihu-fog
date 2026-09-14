// GET /api/oauth/callback —— 校验 state、换取 token、建立应用会话
//
// 两处协议偏差已按 skill 文档实测结果处理：
//   1. 回调参数是 authorization_code，不是 code（同时兼容 code）
//   2. token 接口的表单字段仍叫 code
//   3. 业务字段 code:20000 表示成功，不能当错误
import {
  store, randomToken, readCookie, setCookie, redirectUri,
  parseJsonInt64Safe, json, TTL_SESSION,
} from '../../_lib/session.js';

const fail = (msg) =>
  new Response(null, { status: 302, headers: { Location: '/?login_error=' + encodeURIComponent(msg), 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const db = store(env);

  const code = url.searchParams.get('authorization_code') || url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return fail('缺少授权码');

  // --- state 校验：缺失 / 不匹配 / 过期 / 重复使用 一律拒绝 ---
  const nonce = readCookie(request, 'fog_oauth_nonce');
  if (!state || !nonce) return fail('state 缺失');
  const rec = await db.get(`state:${state}`);
  if (!rec) return fail('state 无效或已过期');
  if (rec.used) return fail('state 已被使用');
  if (rec.nonce !== nonce) return fail('state 与当前会话不匹配');
  await db.del(`state:${state}`); // 原子消费，防重放

  const appId = env.ZHIHU_OAUTH_APP_ID;
  const appKey = env.ZHIHU_OAUTH_APP_KEY;
  if (!appId || !appKey) return fail('服务端未配置 OAuth 凭证');

  try {
    // --- 换取 access_token（app_key 只在这里出现，不下发浏览器）---
    const form = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(env, request.url),
      code,
    });
    const tr = await fetch('https://openapi.zhihu.com/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tokenBody = parseJsonInt64Safe(await tr.text());
    const accessToken = tokenBody.access_token;
    // 只凭 HTTP 200 不足以判定成功，必须确认拿到 token
    if (!tr.ok || !accessToken) return fail('换取 token 失败');

    // --- 读取授权用户基础信息 ---
    const ur = await fetch('https://openapi.zhihu.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = parseJsonInt64Safe(await ur.text());
    // uid 已在解析阶段保为字符串，这里不再做 Number 往返
    if (!ur.ok || !(profile.uid || profile.hash_id)) return fail('读取用户信息失败');

    const sid = randomToken(32);
    await db.put(`sess:${sid}`, {
      accessToken,                                    // 留在服务端
      expiresAt: Date.now() + (tokenBody.expires_in || 3600) * 1000,
      user: {
        uid: String(profile.uid ?? ''),
        hash_id: profile.hash_id || '',
        fullname: profile.fullname || '知乎用户',
        avatar_path: profile.avatar_path || '',
        headline: profile.headline || '',
      },
    }, TTL_SESSION);

    // 浏览器只拿到应用自己的随机会话标识
    const headers = new Headers({ Location: '/?login=ok', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', setCookie(new URL(request.url).protocol === 'https:' ? '__Host-fog_sid' : 'fog_sid', sid, request.url, TTL_SESSION));
    headers.append('Set-Cookie', setCookie('fog_oauth_nonce', '', request.url, 0)); // 清理一次性 nonce
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return fail('OAuth 异常: ' + (e && e.message ? e.message : 'unknown'));
  }
}
