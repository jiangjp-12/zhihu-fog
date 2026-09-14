// 会话 / state 存储与工具。
// 凭证只存在于此层（服务端），绝不下发到浏览器。
//
// 存储优先级：
//   1. KV 绑定 FOG_KV —— Serverless / 多实例安全（文档要求）
//   2. 进程内 Map —— 仅单实例 Demo 兜底，冷启动会清空
// 假设：黑客松 Demo 流量下 KV 未绑定时用内存兜底可接受，README 已标注。

const mem = new Map();

const TTL_SESSION = 60 * 60 * 6; // 会话 6 小时
const TTL_STATE = 60 * 10;       // state 10 分钟内有效

export function store(env) {
  if (env && env.FOG_KV) {
    return {
      kind: 'kv',
      get: (k) => env.FOG_KV.get(k, 'json'),
      put: (k, v, ttl) => env.FOG_KV.put(k, JSON.stringify(v), { expirationTtl: ttl }),
      del: (k) => env.FOG_KV.delete(k),
    };
  }
  return {
    kind: 'memory',
    async get(k) {
      const e = mem.get(k);
      if (!e) return null;
      if (e.exp < Date.now()) { mem.delete(k); return null; }
      return e.v;
    },
    async put(k, v, ttl) { mem.set(k, { v, exp: Date.now() + ttl * 1000 }); },
    async del(k) { mem.delete(k); },
  };
}

export { TTL_SESSION, TTL_STATE };

/** 密码学安全随机串，用于 state 与会话标识 */
export function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 无损解析 uid。
 * 知乎 /user 的 uid 是 int64，超过 JS 安全整数范围，
 * 直接 JSON.parse 会静默丢精度（...216200 -> ...216192）。
 * 因此在解析前把长数字字面量改写成字符串。
 */
export function parseJsonInt64Safe(text) {
  const safe = text.replace(/"(uid)"\s*:\s*(-?\d{16,})/g, '"$1":"$2"');
  return JSON.parse(safe);
}

export function cookieName(url) {
  // __Host- 前缀要求 Secure + Path=/ + 无 Domain；本地 http 调试时退回普通名字
  return new URL(url).protocol === 'https:' ? '__Host-fog_sid' : 'fog_sid';
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setCookie(name, value, url, maxAge) {
  const secure = new URL(url).protocol === 'https:';
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** 回调地址：优先用登记值，必须与赛事页面完全一致 */
export function redirectUri(env, url) {
  return env.ZHIHU_OAUTH_REDIRECT_URI || new URL('/api/oauth/callback', url).toString();
}
