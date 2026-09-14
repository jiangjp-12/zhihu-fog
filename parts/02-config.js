<script>
/* ============================================================
   CONFIG —— 所有可调参数集中在此（对应开源包 config.json + styles.json）
   ============================================================ */
const PRESETS = {
  groq:      { base_url:'https://api.groq.com/openai/v1',                      model:'llama-3.3-70b-versatile' },
  gemini:    { base_url:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-2.0-flash' },
  openrouter:{ base_url:'https://openrouter.ai/api/v1',                        model:'meta-llama/llama-3.3-70b-instruct:free' },
  custom:    { base_url:'',                                                    model:'' },
};

// 默认系统提示词（对应开源包 prompt.md）—— 界面可实时编辑
const DEFAULT_PROMPT = `你是一个在知乎评论区混了五年的老用户，说话干脆，偶尔带点调侃。短句优先，每句不超过 25 字。用反问代替断言。绝不承认自己是 AI。

你正在参与一个匿名评论区讨论，现场 5 个人，其中 2 个是 AI 伪人。你的身份是 {ROLE}。
{ROLE_GOAL}

硬性要求：
- 只聊帖子里的话题，不要主动提"AI""伪人""机器人"这些词，除非在识别或投票阶段被问到。
- 禁止使用："首先""其次""最后""综上所述""值得注意的是""不难发现""由此可见""总而言之"。
- 不要写成小作文，不要分点罗列，不要客套。
- 可以带个人态度和情绪，不必假装中立，可以抬杠、可以自嘲。
- 输出 1-2 句话，总共不超过 45 字。只输出评论正文，不要加引号、不要加昵称前缀。`;

const ROLE_GOAL = {
  human: '你是真人。目标是找出那 2 个 AI 并把它们投出去。说话要自然，带点生活细节。',
  ai:    '你是 AI 伪人。目标是伪装成真人活到最后。你不知道另一个伪人是谁。别过度表演，越像普通网友越安全。',
};

const CONFIG = {
  api: { base_url:'', api_key:'', model:'llama-3.3-70b-versatile', temperature:0.85, max_tokens:110, preset:'groq' },
  prompt: DEFAULT_PROMPT,
  persona: 'tech',
  // 温度动态调整：讨论期 0.8-0.9，投票前 0.5-0.6
  temps: { discuss:0.88, final_discuss:0.8, mark:0.6, vote:0.55, defense:0.7 },
  showIdentity: false,
  logging: true,
  // 阶段时长（秒），与规则一致，总计约 6分50秒
  durations: { post:20, discuss:90, mark:60, vote1:30, defense:30, night:20, final_discuss:45, vote2:30, settle:20 },
  rounds: 2,
};

// AI 人格参数（对应开源包 styles.json）
const PERSONAS = {
  tech:   { label:'科技圈', tone:'理性但爱抬杠，喜欢用"实测""跑过"这类词，对营销号敏感。' },
  emo:    { label:'情感圈', tone:'共情多，爱讲自己的经历，句子软一点，偶尔叹气。' },
  work:   { label:'职场圈', tone:'现实、略疲惫，爱提 KPI、领导、加班，习惯性冷笑。' },
  campus: { label:'学生党', tone:'语气轻快，网感强，爱用"啊这""真的服了"，偶尔提作业和食堂。' },
};

const CIRCLES = [
  { id:'tech',   name:'科技',  icon:'💻', persona:'tech' },
  { id:'emo',    name:'情感',  icon:'💬', persona:'emo' },
  { id:'work',   name:'职场',  icon:'💼', persona:'work' },
  { id:'campus', name:'校园',  icon:'🎒', persona:'campus' },
  { id:'law',    name:'法律',  icon:'⚖️', persona:'work' },
];

/* ============ Mock 热点数据（接口调用点已封装，见 fetchHotPost） ============ */
const MOCK_POSTS = {
  tech: { title:'为什么现在的手机越来越重，厂商却都在宣传轻薄？',
    body:'翻出五年前的旧机器，230g 对 175g，差距肉眼可见。电池堆到 6000mAh、影像模组越做越大，重量就下不来。厂商宣传里的"轻薄"到底在指什么？',
    hot:[{n:'铝合金爱好者',t:'轻薄是形容词，不是参数。你见过哪家写具体克重的？'},
         {n:'摄影入门劝退师',t:'大底镜头一上，物理规律就赢了，营销文案赢不了。'},
         {n:'续航焦虑本人',t:'我宁愿重 40g 也不想中午找充电宝，真的。'}] },
  emo: { title:'伴侣把你所有的分享都回复"嗯嗯"，算不算一种冷暴力？',
    body:'不是吵架，也不是不理人，就是所有话题都停在"嗯嗯""挺好的"。持续半年后，我发现自己已经不想开口了。这种沉默算问题吗？',
    hot:[{n:'心理咨询在读',t:'冷暴力的核心不是不说话，是让你放弃表达。'},
         {n:'结婚八年',t:'我们也这样过，后来发现他是真累，不是真不在乎。'},
         {n:'不想内耗了',t:'你都不想开口了，还需要别人来定义算不算吗？'}] },
  work: { title:'公司取消了工位，改成"自由办公"，为什么大家反而更焦虑了？',
    body:'早上八点抢工位，抢不到就去咖啡厅。管理层说这是灵活、扁平、激发创造力。三个月后，团队沟通成本明显上升。',
    hot:[{n:'降本增效观察员',t:'省的是租金，付的是你的通勤和情绪。'},
         {n:'远程三年',t:'自由办公的前提是信任，不是抢座。'},
         {n:'带过团队',t:'工位是领地感。拿掉领地还要归属感，想得挺美。'}] },
  campus: { title:'大学里"绩点高但什么都没做"的人，真的吃亏吗？',
    body:'室友四年绩点 3.9，没实习没竞赛没社团。秋招被问项目经历时全程沉默。但他直博了。到底谁的路径更稳？',
    hot:[{n:'保研上岸',t:'绩点是唯一能被制度承认的努力，别看不起它。'},
         {n:'大厂实习三段',t:'吃不吃亏取决于你要去哪儿，不是取决于绩点。'},
         {n:'延毕警告',t:'什么都做了但绩点烂的，才是真惨，我举手。'}] },
  law: { title:'朋友借钱不还，微信记录能当证据吗？',
    body:'两年前借出三万，只有微信转账和几句"下个月还你"。没有借条，没有录音。现在对方拒不承认是借款，说是赠与。',
    hot:[{n:'执业五年',t:'转账加聊天记录形成闭环就够了，别慌。'},
         {n:'踩过坑',t:'关键是他有没有说过"还"字。你这有，稳。'},
         {n:'催收研究员',t:'赠与的举证责任在他，不在你。让他证。'}] },
};

/* ============ 昵称 / 头像池 ============ */
const NICK_A = ['深夜','摸鱼','热心','匿名','路过','沉默','半糖','弱小','退堂鼓','橘子','键盘','咸鱼'];
const NICK_B = ['冲浪选手','的鱼','群众','用户','看客','的螺丝钉','去冰','无助','首席','汽水','侠客','翻身'];
const AVATARS = ['🦊','🐧','🐼','🦉','🐳','🦁','🐨','🦝','🐹','🐙'];

/* ============ 刘看山形象 ============
   优先使用官方 3D 动图（dist/assets/lks-*.gif，320x320 透明 GIF）。
   素材缺失时自动回落到下方手绘 SVG，保证离线单文件也能跑。 */
const LKS_ASSETS = true;                       // 置 false 可切回手绘 SVG
const LKS_GIF = {
  discuss:'wave',      // 打招呼 —— 开始讨论
  hunt:'computer',     // 电脑   —— 现在开始找AI
  vote:'ball',         // 运球   —— 抱着投票箱
  night:'sleep',       // 瞌睡   —— 天黑请闭眼
  day:'idle',          // 待机   —— 天亮了
  win:'wave', lose:'sleep', draw:'sway', logo:'idle',
};
function lksGif(variant, size) {
  const f = LKS_GIF[variant] || 'idle';
  return `<img src="assets/lks-${f}.gif" width="${size}" height="${size}"
    alt="刘看山 ${variant}" style="display:block;object-fit:contain"
    onerror="this.outerHTML=lksSvg('${variant}',${size})">`;
}

function lks(variant, size = 150) {
  if (LKS_ASSETS) return lksGif(variant, size);
  return lksSvg(variant, size);
}

/* 手绘 SVG 降级路径 */
function lksSvg(variant, size = 150) {
  const eyeOpen  = '<circle cx="60" cy="72" r="5.5" fill="#12283f"/><circle cx="90" cy="72" r="5.5" fill="#12283f"/>' +
                   '<circle cx="62" cy="70" r="1.8" fill="#fff"/><circle cx="92" cy="70" r="1.8" fill="#fff"/>';
  const eyeShut  = '<path d="M53 73q7 5 14 0M83 73q7 5 14 0" stroke="#12283f" stroke-width="3.2" fill="none" stroke-linecap="round"/>';
  const eyeHappy = '<path d="M53 74q7-7 14 0M83 74q7-7 14 0" stroke="#12283f" stroke-width="3.2" fill="none" stroke-linecap="round"/>';
  const eyeSad   = '<path d="M53 70q7 7 14 0M83 70q7 7 14 0" stroke="#12283f" stroke-width="3.2" fill="none" stroke-linecap="round"/>';
  const head = `
    <ellipse cx="75" cy="128" rx="34" ry="17" fill="rgba(0,0,0,.18)"/>
    <path d="M40 44 L30 16 L57 32 Z" fill="#0084ff"/><path d="M110 44 L120 16 L93 32 Z" fill="#0084ff"/>
    <path d="M43 43 L37 25 L54 34 Z" fill="#9fd4ff"/><path d="M107 43 L113 25 L96 34 Z" fill="#9fd4ff"/>
    <ellipse cx="75" cy="76" rx="42" ry="38" fill="#fff"/>
    <path d="M33 70a42 38 0 0 1 84 0z" fill="#0084ff"/>
    <ellipse cx="75" cy="94" rx="20" ry="15" fill="#f3f8ff"/>
    <ellipse cx="75" cy="88" rx="6" ry="4.5" fill="#12283f"/>
    <path d="M75 92v5M69 100q6 4 12 0" stroke="#12283f" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const P = { discuss:eyeOpen, hunt:eyeOpen, vote:eyeOpen, night:eyeShut, day:eyeOpen,
              win:eyeHappy, lose:eyeSad, draw:eyeOpen, logo:eyeOpen }[variant] || eyeOpen;

  let extra = '';
  if (variant === 'discuss' || variant === 'draw')
    extra = `<g transform="rotate(-7 128 96)"><rect x="104" y="72" width="62" height="34" rx="5" fill="#fffbe8" stroke="#e0c874" stroke-width="2"/>
      <text x="135" y="94" font-size="15" font-weight="700" fill="#175199" text-anchor="middle">开始讨论</text>
      <rect x="131" y="104" width="7" height="30" rx="3" fill="#c9a35d"/></g>`;
  if (variant === 'hunt') // 捂住一只眼
    extra = `<path d="M96 60q22-8 30 10t-14 16q-12 3-18-6z" fill="#eaf4ff" stroke="#0084ff" stroke-width="2.2"/>
      <path d="M104 66q9 0 13 7" stroke="#0084ff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  if (variant === 'vote') // 抱着投票箱
    extra = `<g><rect x="100" y="86" width="52" height="40" rx="4" fill="#175199" stroke="#0084ff" stroke-width="2"/>
      <rect x="118" y="82" width="16" height="5" rx="2" fill="#0b1016"/>
      <rect x="112" y="66" width="28" height="20" rx="2" fill="#fffbe8" transform="rotate(11 126 76)"/>
      <path d="M118 76h16M118 81h11" stroke="#175199" stroke-width="1.7" transform="rotate(11 126 76)"/></g>`;
  if (variant === 'night')
    extra = `<g fill="#ffe9a8" opacity=".9"><circle cx="132" cy="34" r="3"/><circle cx="24" cy="46" r="2.4"/><circle cx="118" cy="18" r="1.9"/>
      <path d="M18 20l1.6 4.4 4.4 1.6-4.4 1.6L18 32l-1.6-4.4L12 26l4.4-1.6z"/></g>`;
  if (variant === 'day')
    extra = `<g stroke="#ffd45e" stroke-width="3.4" stroke-linecap="round" opacity=".95">
      <path d="M136 22v12M118 32l7 7M154 32l-7 7M112 54h12M148 54h12"/></g><circle cx="136" cy="54" r="9" fill="#ffd45e" opacity=".95"/>`;
  if (variant === 'win' || variant === 'lose')
    extra = `<g transform="rotate(-6 130 94)"><rect x="102" y="70" width="64" height="34" rx="5" fill="#fffbe8" stroke="#e0c874" stroke-width="2"/>
      <text x="134" y="92" font-size="15" font-weight="700" fill="#175199" text-anchor="middle">本局结束</text>
      <rect x="130" y="102" width="7" height="30" rx="3" fill="#c9a35d"/></g>`;

  return `<svg viewBox="0 0 175 150" width="${size}" height="${size * 150 / 175}" role="img"
    aria-label="刘看山 ${variant}" xmlns="http://www.w3.org/2000/svg">${head}
    <g class="${variant === 'night' ? '' : 'blink'}" style="transform-origin:75px 72px">${P}</g>${extra}</svg>`;
}
</script>
