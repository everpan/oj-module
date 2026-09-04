#!/usr/bin/env bash
# playground-oj 两态集成冒烟（P5）：
#   ram build → ram preview 冒烟 → ram dev 冒烟
# 每态：后台拉起 ram，轮询 /api/health 直到就绪，跑 scripts/smoke_all.py，
# 再 SIGINT + 兜底 pkill 清理（oj 与 ram 子进程不残留占端口）。
# 任一态失败即非零退出。
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

fail() { echo "[smoke.sh] ✗ $1"; exit 1; }

run_state() {
  local mode="$1" port="$2"
  echo ""
  echo "===== $mode (port $port) ====="
  # dev/preview 各自把 oj 拉到 config 里的 9779；两态顺序跑，前态清理后再起后态
  pnpm "$mode" "$port" > "/tmp/oj-$mode.log" 2>&1 &
  local pid=$!
  local ready=0
  for i in $(seq 1 60); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/api/health" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then ready=1; echo "[smoke.sh] $mode oj 就绪（${i}s）"; break; fi
    sleep 1
  done
  [ "$ready" = "1" ] || fail "$mode 未在 60s 内就绪（见 /tmp/oj-$mode.log）"

  python3 scripts/smoke_all.py "http://127.0.0.1:$port" || fail "$mode 冒烟失败"

  # 清理：先 SIGINT 让 ram 优雅回收 oj，再兜底强杀残口
  kill -INT "$pid" 2>/dev/null
  sleep 2
  pkill -f "bin/oj" 2>/dev/null
  local p
  p=$(lsof -ti ":$port" 2>/dev/null || true); [ -n "$p" ] && kill -9 "$p" 2>/dev/null
  sleep 1
}

# 1) release 构建（oj build 闸门 + 全站合并 + 模块构建）
echo "===== ram build ====="
pnpm build || fail "ram build 失败"

# 2) preview 态（生产形态：api/dist + 合并全站）
run_state preview 4173

# 3) dev 态（开发形态：api/src + 模块热更）
run_state dev 5174

echo ""
echo "[smoke.sh] ✅ 两态集成冒烟全部通过（preview + dev）"
