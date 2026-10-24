#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 把「最新的一份可执行计划」送上链 —— 演示里的那一下。
#
#   bash src/contract/script/demo-report.sh
#
# 做的事：
#   1. 取计划：默认用 /latest.json（后端已按「链上 lastPlanHash 优先」选好），
#      后端没起就退回 plans/ 里 planId 最大且未执行的那份
#   2. 校验：degraded 必须是 false、时效必须在窗口内、nonce 必须是 lastNonce+1
#   3. keccak256(文件原始字节) → planHash
#   4. 用 forwarder 地址发 onReport（anvil impersonate，本地没有 DON）
#   5. 回读 lastPlanHash 与 lastNonce，证明真的上链了
#
# ⚠️ 这一步用 anvil_impersonateAccount 假扮 CRE forwarder。
#    真实部署里 onReport 由 Chainlink 的 forwarder 合约调用，私钥在 DON 里。
#    本地没有 DON，所以用 anvil 的 impersonate 顶上 —— 页面必须标注这一点。
# ---------------------------------------------------------------------------
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
ENV_FILE="/tmp/alphaplan-demo-env"

# shellcheck disable=SC1090
[[ -f "${ENV_FILE}" ]] && source "${ENV_FILE}"

VAULT="${VAULT:-0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b}"
FORWARDER="0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLANS_DIR="${REPO}/src/backend/plans"
SERVE="${PLAN_SERVER:-http://127.0.0.1:8788}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 环境自检：env 文件里的 VAULT 可能属于一台已经不存在的链。
# 不检查的话，后面每一步都会对着一个空地址读，报出来的错看起来像「合约 bug」。
if [[ -z "$(cast code "${VAULT}" --rpc-url "${RPC_URL}" 2>/dev/null)" || \
      "$(cast code "${VAULT}" --rpc-url "${RPC_URL}" 2>/dev/null)" == "0x" ]]; then
  echo "✗ ${VAULT} 在 ${RPC_URL} 上没有代码。" >&2
  echo "  这条链上部署的是另一个金库地址，或环境已被重建。" >&2
  echo "  先跑 bash src/contract/script/demo-up.sh，再用它打印的 VAULT 地址。" >&2
  echo "  （当前 /tmp/alphaplan-demo-env 写的是：${VAULT}）" >&2
  exit 1
fi

# ------------------------------------------------------- 1. 挑计划
say "1/5 取计划"
PLAN_FILE=""
PICK_REASON=""

if curl -sS -m 3 -f -o /tmp/latest-plan.json -D /tmp/latest-plan.head "${SERVE}/latest.json" 2>/dev/null; then
  PICKED_ID="$(grep -i '^x-plan-file:' /tmp/latest-plan.head | tr -d '\r' | awk '{print $2}')"
  if [[ -n "${PICKED_ID}" && -f "${PLANS_DIR}/${PICKED_ID}" ]]; then
    PLAN_FILE="${PLANS_DIR}/${PICKED_ID}"
    PICK_REASON="后端 /latest.json（${SERVE}）"
  fi
fi

if [[ -z "${PLAN_FILE}" ]]; then
  # 后端没起：退回「planId 最大且未执行」的那份。
  # 注意这不是重新实现一套判定 —— 只是演示脚本的兜底，选完仍然要过下面的门禁。
  PLAN_FILE="$(ls -1 "${PLANS_DIR}"/*.json 2>/dev/null | sort | tail -1 || true)"
  PICK_REASON="plans/ 目录里最新的文件（后端未响应）"
fi

[[ -n "${PLAN_FILE}" && -f "${PLAN_FILE}" ]] || { echo "找不到任何计划文件" >&2; exit 1; }
echo "  文件: ${PLAN_FILE}"
echo "  来源: ${PICK_REASON}"

# ------------------------------------------------------- 2. 读字段 + 门禁
say "2/5 校验"
read -r ASOF VALIDITY DEGRADED TARGET <<<"$(python3 - "${PLAN_FILE}" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(d["asOf"], d["validitySeconds"], str(d["degraded"]).lower(), d["final"]["targetWethBps"])
PY
)"

VALID_UNTIL=$((ASOF + VALIDITY))
NOW="$(cast block latest --field timestamp --rpc-url "${RPC_URL}")"
LAST_NONCE="$(cast call "${VAULT}" "lastPlan()(bytes32,uint16,uint64)" --rpc-url "${RPC_URL}" | sed -n '3p' | awk '{print $1}')"
NONCE=$((LAST_NONCE + 1))
HASH="$(cast keccak "0x$(xxd -p -c 1000000 "${PLAN_FILE}" | tr -d '\n')")"

echo "  asOf=${ASOF}  validUntil=${VALID_UNTIL}  链上 now=${NOW}"
echo "  degraded=${DEGRADED}  target=${TARGET} bps"
echo "  lastNonce=${LAST_NONCE} → 本次 nonce=${NONCE}"
echo "  keccak=${HASH}"

[[ "${DEGRADED}" == "false" ]] || { echo "✗ degraded=true，链上会拒（合约有三道门禁）" >&2; exit 1; }
[[ "${NOW}" -ge "${ASOF}" ]] || { echo "✗ 计划的 asOf 在未来（时钟错位）" >&2; exit 1; }
[[ "${NOW}" -le "${VALID_UNTIL}" ]] || { echo "✗ 计划已过期（validUntil=${VALID_UNTIL}）" >&2; exit 1; }

# 已在链上执行过的 planHash 不能重发（合约会 revert PlanAlreadyExecuted）
CUR_HASH="$(cast call "${VAULT}" "lastPlan()(bytes32,uint16,uint64)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
if [[ "${CUR_HASH}" == "${HASH}" ]]; then
  echo "✗ 这份计划已经在链上（lastPlanHash 就是它），换个计划或重跑 debate" >&2
  exit 1
fi

# ------------------------------------------------------- 3. 组报告
say "3/5 组 onReport"
REPORT="$(cast abi-encode "f(address,uint64,uint64,uint64,uint16,bytes32)" \
  "${VAULT}" "${ASOF}" "${VALID_UNTIL}" "${NONCE}" "${TARGET}" "${HASH}")"
echo "  6 字段: (${VAULT}, ${ASOF}, ${VALID_UNTIL}, ${NONCE}, ${TARGET}, ${HASH:0:18}…)"

# ------------------------------------------------------- 4. 发交易
say "4/5 发交易（impersonate forwarder）"
cast rpc anvil_impersonateAccount "${FORWARDER}" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setBalance "${FORWARDER}" 0x56BC75E2D63100000 --rpc-url "${RPC_URL}" >/dev/null

TX="$(cast send "${VAULT}" "onReport(bytes,bytes)" 0x "${REPORT}" \
  --from "${FORWARDER}" --unlocked --rpc-url "${RPC_URL}" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')"
echo "  tx: ${TX}"

# ------------------------------------------------------- 5. 回读证明
say "5/5 回读"
NEW_HASH="$(cast call "${VAULT}" "lastPlan()(bytes32,uint16,uint64)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
NEW_NONCE="$(cast call "${VAULT}" "lastPlan()(bytes32,uint16,uint64)" --rpc-url "${RPC_URL}" | sed -n '3p' | awk '{print $1}')"
NEW_BPS="$(cast call "${VAULT}" "currentWethBps()(uint16)" --rpc-url "${RPC_URL}" | awk '{print $1}')"
NEW_NAV="$(cast call "${VAULT}" "totalAssets()(uint256)" --rpc-url "${RPC_URL}" | awk '{print $1}')"

echo "  lastPlanHash = ${NEW_HASH}"
echo "  lastNonce    = ${NEW_NONCE}"
echo "  currentWethBps = ${NEW_BPS} bps  (target ${TARGET})"
echo "  totalAssets  = $(python3 -c "print(f'{${NEW_NAV}/1e6:.6f}')") USDC"

if [[ "${NEW_HASH}" != "${HASH}" ]]; then
  echo "✗ 回读的 lastPlanHash 与计划文件哈希不一致" >&2
  exit 1
fi
if [[ "${NEW_NONCE}" != "${NONCE}" ]]; then
  echo "✗ 回读的 nonce 不是 ${NONCE}" >&2
  exit 1
fi

echo
echo "✓ 计划已上链，哈希逐位一致。"
echo "  注意：本次用 anvil_impersonateAccount 假扮 CRE forwarder；"
echo "        真实部署里这笔交易由 Chainlink DON 签发。"
