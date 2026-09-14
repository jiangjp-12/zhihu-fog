# 热帖迷雾：评论区伪人局

知乎黑客松参赛作品。5 席 = 3 真人 + 2 AI 伪人，在热帖评论区里互相辨认。
人类要找出伪人并投票折叠，伪人要伪装到最后。

游戏本体是**单文件 HTML**（`dist/index.html`，无构建步骤，Tailwind CDN + 原生 JS），
双击即可离线试玩。OAuth 需要一个最小后端，见下文。

## 目录结构

```
dist/index.html                  # 游戏本体（单文件，可独立运行）
functions/api/oauth/start.js     # GET  /api/oauth/start     发起授权，下发 state
functions/api/oauth/callback.js  # GET  /api/oauth/callback  校验 state、换 token、建会话
functions/api/me.js              # GET  /api/me              当前登录用户（不含 token）
functions/api/logout.js          # POST /api/logout          清理会话
functions/_lib/session.js        # 会话 / state 存储 + int64 安全解析
wrangler.toml                    # Pages 配置（不含任何凭证）
.chk/                            # 规则测试（18 项，不进仓库）
```

## 部署（Cloudflare Pages）

```bash
npx wrangler login
npx wrangler pages project create zhihu-fog --production-branch main
npx wrangler pages deploy dist
```

部署完成后拿到 `https://zhihu-fog.pages.dev`。**只做游戏、不接 OAuth 的话，到这一步就够了。**

### 接入 OAuth

> **顺序要紧**：secret 只对**之后**的部署生效。若先 deploy 再 put secret，
> 线上那份部署读不到值，`/api/oauth/start` 会回 503、`/api/me` 会回
> `oauth_configured:false`。put 完必须**再 deploy 一次**。

1. 注入凭证（**只能用 secret，不能写进任何文件**）：

```bash
npx wrangler pages secret put ZHIHU_OAUTH_APP_ID      --project-name zhihu-fog
npx wrangler pages secret put ZHIHU_OAUTH_APP_KEY     --project-name zhihu-fog
npx wrangler pages secret put ZHIHU_OAUTH_REDIRECT_URI --project-name zhihu-fog
```

`ZHIHU_OAUTH_REDIRECT_URI` 填 `https://zhihu-fog.pages.dev/api/oauth/callback`，
并确保与赛事页面「知乎登录回调地址」登记值**完全一致**（协议、域名、端口、路径、尾部斜杠都算）。

2. 建议绑定 KV，否则会话存在进程内 Map 里，冷启动会掉登录态：

```bash
npx wrangler kv namespace create FOG_KV
# 把返回的 id 填进 wrangler.toml 的 [[kv_namespaces]] 并取消注释，然后重新 deploy
```

3. 本地联调：把凭证写进 `.dev.vars`（已在 `.gitignore` 里），然后 `npx wrangler pages dev dist`。

### 已实现的 OAuth 安全要求

- `app_key` 与 OAuth `access_token` 只存在于 Function 服务端，不进浏览器、URL、日志、前端响应。
- 浏览器只持有应用自己的随机会话 ID，走 `HttpOnly` + `Secure` + `SameSite=Lax`（HTTPS 下用 `__Host-` 前缀）。
- `state` 用 `crypto.getRandomValues` 生成，服务端保存并绑定当前浏览器（一次性 nonce cookie），
  10 分钟有效；回调时校验一致性后**原子消费**，缺失 / 不匹配 / 过期 / 重复使用一律拒绝登录。
- Token 过期即停止读取，不静默切换到 Access Secret 所属账号。

### 按文档实测结论处理的两个协议偏差

- 回调参数是 `authorization_code` 而非 `code`（接收端同时兼容 `code`）；
  换 token 时表单字段仍叫 `code`。
- `/user` 的 `uid` 是 int64，直接 `JSON.parse` 会静默丢精度
  （`969570047710216200` → `...192`）。`parseJsonInt64Safe()` 在解析前把长数字字面量
  改写成字符串，全程以字符串传递。
- 业务字段 `code: 20000` 表示成功，因此判定成功看的是「有没有 token / 用户对象」，不是 `code` 非零。

## AI bot 调试

底部「🛠 调试台」抽屉：

- **API 配置** —— base_url / api_key / model / temperature / max_tokens，预设 GroqCloud（默认）、
  Gemini、OpenRouter。`api_key` 只存本机 `localStorage`，导出配置时自动清空。
- **Prompt 编辑** —— 直接改系统提示词，实时生效，可一键恢复默认。
- **日志** —— 每次调用的 prompt 摘要、回复、耗时、温度、模式（API / 降级 / 本地模板），可导出 JSON。
- **评分** —— 结算和观战时可对 AI 发言打「像人 / 不像人」，写入 logs 一起导出。
- **导入 / 导出** —— 配置 JSON 互换。

未配置 api_key 时自动走本地拟人模板，游戏流程完全不受影响；配置后调用失败也会自动降级。

温度按阶段动态调整：讨论 0.88、终轮 0.8、辩解 0.7、识别 0.6、投票 0.55。

### 开源包结构（当前为单文件原型，注释中已预留映射）

```
ai-bot/
├── config.json   -> CONFIG.api
├── prompt.md     -> CONFIG.prompt / DEFAULT_PROMPT
├── adapter.js    -> callAI() + sanitize() + speak()
├── styles.json   -> PERSONAS
├── logs.json     -> STATE.logs（可导出）
└── README.md     -> 本文件
```

## 测试

```bash
node .chk/harness.js
```

18 项规则测试：组队分布（300 次）、黑夜三种判定分支、胜负三档、计票与「不投自己」（300 次）、
阶段时长、`sanitize` 套话过滤、无 API 时的降级路径。

## 已做的假设

1. **刘看山素材**：已接入**官方刘看山 3D 动图**（`dist/assets/lks-*.gif`，6 个 320×320
   透明 GIF）。阶段映射：打招呼→开始讨论、电脑→现在开始找AI、运球→投票、瞌睡→天黑请闭眼、
   待机→天亮。`LKS_ASSETS = false` 可切回手绘 SVG；GIF 加载失败也会自动回落（`onerror`）。
2. **知乎不提供托管域名**：文档同样 0 命中，只要求交「可运行的线上 Demo 地址」，
   所以托管自建（Cloudflare Pages）。
3. **单机原型**：只有你是真人，其余 4 席由 LLM 或本地模板驱动。多人实时对局需要
   WebSocket + 房间服务，超出单页原型范围。
4. **热点数据用 mock**：5 个圈子各一条帖子。真实接入点已封装在 `fetchHotPost()`，
   替换为知乎热榜接口时**必须在服务端调用**（Access Secret 不能进浏览器）。
5. **总时长**：规则写「约 6 分 50 秒」，但逐阶段时长相加是 450 秒（7 分 30 秒，含入场 15s）。
   逐阶段时长是明确规范，聚合值是约数，因此以**逐阶段为准**，可在 `CONFIG.durations` 调。
6. **会话存储**：未绑定 KV 时用进程内 Map，仅适合单实例 Demo。

## 安全提示

仓库、前端响应、日志、截图和演示视频里都不应出现 App Key、Access Secret 或 OAuth Token。
`.gitignore` 已排除 `.env*` / `.dev.vars` / `*secret*`。
