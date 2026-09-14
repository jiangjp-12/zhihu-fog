// GET /api/oauth/start —— 发起知乎授权
// 生成不可预测 state，服务端保存并绑定当前浏览器（一次性 cookie），再跳转授权页。
import { store, randomToken, setCookie, redirectUri, json, TTL_STATE } from '../../_lib/session.js';

export async function onRequestGet({ request, env }) {
  const appId = env.ZHIHU_OAUTH_APP_ID;
  if (!appId) {
    return json({ error: 'oauth_not_configured', message: '未配置 ZHIHU_OAUTH_APP_ID，OAuth 不可用（游戏本体仍可玩）' }, 503);
  }

  const url = request.url;
  const db = store(env);

  // state 与 nonce 分离：state 传给知乎，nonce 存浏览器，回调时两者必须配对
  const state = randomToken(32);
  const nonce = randomToken(32);
  await db.put(`state:${state}`, { nonce, createdAt: Date.now(), used: false }, TTL_STATE);

  const authorize = new URL('https://openapi.zhihu.com/authorize');
  authorize.searchParams.set('app_id', appId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirectUri(env, url));
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': setCookie('fog_oauth_nonce', nonce, url, TTL_STATE),
      'Cache-Control': 'no-store',
    },
  });
}
