#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 抬价 —— demo 里「净值上涨」的那一下。
#
#   bash src/contract/script/demo-bump-price.sh 4000        # USDC/WETH，人类可读
#   bash src/contract/script/demo-bump-price.sh 400000000000 --raw
#
# 为什么同时改两处（实测得出的必要做法）：
#   只改 mock oracle 不改池子，会造出「oracle 说涨了、市场没涨」的假场景，
#   而且**卖方向必然 revert** —— 金库的 minOut 由 oracle 推出，oracle 比池价
#   高 11% 时池子给的本来就少 11%，50bps 容差直接拒单。清仓和赎回自动卖币
#   都走卖方向，所以只抬 oracle 会让「涨了之后 cash out」整段演示卡死。
#   真实世界里 ETH 涨价时 Uniswap 池子的价格也会涨，所以这里两处一起推。
#
# 改 pool slot0 的做法（slot0 是 packed，不能整字替换）：
#   bit 0-159   sqrtPriceX96 (uint160)
#   bit 160-183 tick (int24)
#   bit 184-199 observationIndex (uint16)
#   bit 200-215 observationCardinality (uint16)
#   bit 216-231 observationCardinalityNext (uint16)
#   bit 232-239 feeProtocol (uint8)
#   bit 240     unlocked (bool)
#   只换 sqrtPriceX96 与 tick，其余位保留原值。
#   tick 取 tickSpacing(60) 的整数倍，且 sqrtPriceX96 由同一个 tick 反推，
#   保证两者内部一致（Uniswap 的 tick 与 sqrtPrice 是冗余表示）。
#
# 自检：读回 slot0 比对 + 用 `cast call` 干跑一笔 1 USDC 的 swap（不改状态）。
#       任一步失败 → 把原 slot0 写回去 → exit 1。
# ---------------------------------------------------------------------------
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
FEED="0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3"
POOL="0x46880b404CD35c165EDdefF7421019F8dD25F4Ad" # USDC/WETH 3000 池
USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH="0x4200000000000000000000000000000000000006"
ROUTER="0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
ACCOUNT0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

SLOT_ANSWER="0x0000000000000000000000000000000000000000000000000000000000000000"
SLOT_UPDATED_AT="0x0000000000000000000000000000000000000000000000000000000000000002"

[[ $# -ge 1 ]] || { echo "用法: $0 <USDC/WETH 价格> [--raw]" >&2; exit 1; }

if [[ "${2:-}" == "--raw" ]]; then
  ANSWER="$1"
else
  ANSWER="$(python3 -c "print(int(round(float('$1') * 1e8)))")"
fi
PRICE_HUMAN="$(python3 -c "print(round(${ANSWER}/1e8, 2))")"

# ---------------------------------------------------------------- 1. slot0
OLD_SLOT0="$(cast storage "${POOL}" 0 --rpc-url "${RPC_URL}")"
read -r NEW_SLOT0 TICK SQRT_P ACTUAL_PRICE <<<"$(OLD_SLOT0="${OLD_SLOT0}" ANSWER="${ANSWER}" python3 - <<'PY'
import math, os
raw = int(os.environ["OLD_SLOT0"], 16)
answer = int(os.environ["ANSWER"])          # oracle 价，8 位小数
price = answer / 1e8                        # USDC per WETH
# token0 = USDC(6), token1 = WETH(18) → p = token1_raw / token0_raw
p = 1.0 / (price * 10 ** (6 - 18))
tick = int(round((math.log(p) / math.log(1.0001)) / 60)) * 60   # 对齐 tickSpacing=60
sqrt_p = int(1.0001 ** (tick / 2) * 2 ** 96)                    # 由同一个 tick 反推
rest = raw >> 160
obs_idx, obs_card, obs_next = (rest >> 24) & 0xFFFF, (rest >> 40) & 0xFFFF, (rest >> 56) & 0xFFFF
fee_prot, unlocked = (rest >> 72) & 0xFF, (raw >> 240) & 1
new = (sqrt_p
       | ((tick & ((1 << 24) - 1)) << 160)
       | (obs_idx << 184) | (obs_card << 200) | (obs_next << 216)
       | (fee_prot << 232) | (unlocked << 240))
actual = 1.0 / ((sqrt_p / 2 ** 96) ** 2 * 10 ** (6 - 18))
print("0x%064x" % new, tick, sqrt_p, "%.2f" % actual)
PY
)"

echo "池子 slot0: ${OLD_SLOT0}"
echo "  → tick=${TICK} sqrtPriceX96=${SQRT_P} 实际价=${ACTUAL_PRICE} USDC/WETH"
cast rpc anvil_setStorageAt "${POOL}" 0x0000000000000000000000000000000000000000000000000000000000000000 \
  "${NEW_SLOT0}" --rpc-url "${RPC_URL}" >/dev/null

rollback() {
  echo "自检失败，回滚池子 slot0" >&2
  cast rpc anvil_setStorageAt "${POOL}" 0x0000000000000000000000000000000000000000000000000000000000000000 \
    "${OLD_SLOT0}" --rpc-url "${RPC_URL}" >/dev/null
  exit 1
}

GOT_TICK="$(cast call "${POOL}" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url "${RPC_URL}" | sed -n 2p | awk '{print $1}')"
[[ "${GOT_TICK}" == "${TICK}" ]] || { echo "slot0 读回 tick=${GOT_TICK}，期望 ${TICK}" >&2; rollback; }

# ------------------------------------------------------- 2. mock oracle
NOW="$(cast block latest --field timestamp --rpc-url "${RPC_URL}")"
cast rpc anvil_setStorageAt "${FEED}" "${SLOT_ANSWER}" "$(printf '0x%064x' "${ANSWER}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${FEED}" "${SLOT_UPDATED_AT}" "$(printf '0x%064x' "${NOW}")" --rpc-url "${RPC_URL}" >/dev/null

# ------------------------------------------------------- 3. 干跑验深度
# 用 eth_call 模拟一笔 1 USDC 的买入（不产生交易、不改状态）。
# 池子若在新的 tick 上没有流动性，这里会 revert，我们就回滚。
if ! SIM=$(cast call "${ROUTER}" \
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))" \
  "(${USDC},${WETH},3000,${ACCOUNT0},1000000,0,0)" \
  --from "${ACCOUNT0}" --rpc-url "${RPC_URL}" 2>&1); then
  echo "干跑 swap 失败: ${SIM}" >&2
  rollback
fi
echo "干跑 1 USDC swap 成功 → 新价位仍有流动性（amountOut=${SIM} wei WETH）"

# ------------------------------------------------------- 4. 打印
echo
echo "mock oracle = ${ANSWER}（8 位小数）= ${PRICE_HUMAN} USDC/WETH"
echo -n "  latestRoundData = "
cast call "${FEED}" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "${RPC_URL}" | tr '\n' ' '
echo

if [[ -f /tmp/alphaplan-demo-env ]]; then
  # shellcheck disable=SC1091
  source /tmp/alphaplan-demo-env
fi
if [[ -n "${VAULT:-}" ]]; then
  echo -n "  totalAssets     = "
  cast call "${VAULT}" "totalAssets()(uint256)" --rpc-url "${RPC_URL}"
  echo -n "  1 份额折合 USDC = "
  cast call "${VAULT}" "convertToAssets(uint256)(uint256)" 1000000 --rpc-url "${RPC_URL}"
  echo -n "  currentWethBps  = "
  cast call "${VAULT}" "currentWethBps()(uint16)" --rpc-url "${RPC_URL}"
fi
