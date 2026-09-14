#!/bin/sh
# 把 parts/ 拼装成单文件 dist/index.html。
# 无依赖、无构建工具链 —— 就是按顺序 cat。
set -e
cd "$(dirname "$0")"

cat parts/00-head.html \
    parts/01-body.html \
    parts/02-config.js \
    parts/03-adapter.js \
    parts/04-state.js \
    parts/05-flow.js \
    parts/06-interact.js \
    parts/07-settle.js \
    parts/08-boot.js \
    > dist/index.html

echo "built dist/index.html ($(wc -c < dist/index.html) bytes)"
echo "run tests: node test/harness.js"
