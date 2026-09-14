// 在 Node 中加载 dist/index.html 的内联脚本，用 DOM stub 跑规则测试。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('内联脚本块: ' + blocks.length);

/* ---------- 极简 DOM stub ---------- */
const mkEl = () => ({
  innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
  scrollTop: 0, scrollHeight: 0, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, setAttribute() {}, focus() {}, appendChild() {}, remove() {},
  querySelector: () => mkEl(),
});
const cache = {};
global.document = {
  getElementById: (id) => cache[id] || (cache[id] = mkEl()),
  createElement: () => mkEl(),
  body: { appendChild() {} },
};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = { search: '', protocol: 'http:' };
global.alert = (m) => console.log('ALERT: ' + m);

// 08-boot.js（block 7）含自动 init，需要真实 DOM，故不加载；
// 补上它导出的渲染函数桩，供 pushLog / 结算路径调用。
global.renderLogs = () => {};
global.updateApiState = () => {};
global.checkAuth = () => {};
global.renderCircles = () => {};
global.rollIdentity = () => {};

let pass = 0, fail = 0;
global.ok = (name, cond) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
};

const suite = fs.readFileSync(path.join(__dirname, 'suite.js'), 'utf8');
// 前 6 个 block（跳过 08-boot 的自动 init，它需要真实 DOM）+ 测试用例，
// 合成一次 eval，使顶层 const/let 共享作用域（等价于浏览器多个顶层 <script>）
const program = blocks.slice(0, 6).join('\n') + '\n' + suite;

new Promise((resolve) => { global.__done = resolve; eval(program); })
  .then(() => {
    console.log('');
    console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
    process.exit(fail ? 1 : 0);
  })
  .catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
