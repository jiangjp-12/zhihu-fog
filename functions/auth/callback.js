// GET /auth/callback —— 官方脚手架约定的回调路径别名。
//
// 官方 skill 的 configure_callback.mjs 强制要求回调地址以 /auth/callback 结尾，
// 而本项目原有路由是 /api/oauth/callback。两个都保留：
// 无论赛事页面登记的是哪一个，都能正常回调，避免因路径不一致被知乎拒绝。
export { onRequestGet } from '../api/oauth/callback.js';
