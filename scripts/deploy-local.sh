#!/usr/bin/env bash
# ACT: 本地构建 + 安装到已装应用，并同步运行期数据目录的节点包。
#
# 背景：应用启动时从数据目录 <DATA>/nodes 加载节点包，内置节点只在
# version.json 的 hash 变化时才从 Resources/app/nodes 覆盖过去。本地重打包
# 不会改 hash，所以只更新 Resources 目录会导致「代码改了、应用没变」。
#
# 用法：
#   scripts/deploy-local.sh            # 复用现有构建产物，只做安装同步
#   scripts/deploy-local.sh --build    # 先构建 nodes + web + desktop 入口
#   APP=/Applications/xxx.app DATA=... scripts/deploy-local.sh
set -euo pipefail

APP="${APP:-/Applications/toonflow-exec.app}"
DATA="${DATA:-/Applications/data}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$APP/Contents/Resources/app"

if [ ! -d "$RES" ]; then
  echo "找不到应用资源目录：$RES" >&2
  exit 1
fi

if [ "${1:-}" = "--build" ]; then
  echo "== 构建节点包 =="
  bun run --cwd "$ROOT" build:nodes
  echo "== 构建 web + server =="
  bun run --cwd "$ROOT" build
  echo "== 打包桌面入口 =="
  bun "$ROOT/scripts/bundle-desktop.ts" "$ROOT"
fi

for required in "$ROOT/build/desktop/main/index.js" "$ROOT/build/web/index.html"; do
  [ -f "$required" ] || { echo "缺少构建产物：$required（先跑 --build）" >&2; exit 1; }
done

echo "== 安装桌面入口 =="
cp "$ROOT/build/desktop/main/index.js" "$RES/bun/index.js"

echo "== 安装前端 =="
rsync -a "$ROOT/build/web/" "$RES/views/mainview/"

echo "== 安装节点包（Resources）=="
mkdir -p "$RES/nodes"
cp "$ROOT"/build/nodes/*.umd.js "$RES/nodes/"

if ls "$ROOT"/build/ext/*.umd.js >/dev/null 2>&1; then
  echo "== 安装扩展（Resources）=="
  mkdir -p "$RES/ext"
  cp "$ROOT"/build/ext/*.umd.js "$RES/ext/"
  if [ -d "$DATA/ext" ]; then
    echo "== 同步运行期扩展（$DATA/ext）=="
    extChanged=0
    for file in "$ROOT"/build/ext/*.umd.js; do
      name="$(basename "$file")"
      target="$DATA/ext/$name"
      if [ -f "$target" ] && cmp -s "$file" "$target"; then continue; fi
      cp "$file" "$target"
      echo "  updated: $name"
      extChanged=$((extChanged + 1))
    done
    [ "$extChanged" -eq 0 ] && echo "  无变化" || echo "  共更新 $extChanged 个扩展（需重启应用生效）"
  fi
fi

if [ -d "$DATA/nodes" ]; then
  echo "== 同步运行期节点包（$DATA/nodes）=="
  changed=0
  for file in "$ROOT"/build/nodes/*.umd.js; do
    name="$(basename "$file")"
    target="$DATA/nodes/$name"
    if [ -f "$target" ] && cmp -s "$file" "$target"; then
      continue
    fi
    cp "$file" "$target"
    echo "  updated: $name"
    changed=$((changed + 1))
  done
  [ "$changed" -eq 0 ] && echo "  无变化" || echo "  共更新 $changed 个节点包（需重启应用生效）"
else
  echo "提示：$DATA/nodes 不存在，跳过运行期同步"
fi

echo "完成。若改了节点包，重启应用后生效。"
