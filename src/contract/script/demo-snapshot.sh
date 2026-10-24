#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# demo 环境快照 —— demo 前跑一次确认环境没变；升/降前后跑 --before / --after 证明"确实变了"。
#
#   bash script/demo-snapshot.sh            # 打印全部关键值（只读）
#   bash script/demo-snapshot.sh --before   # 同上，并把这份值存下来
#   bash script/demo-snapshot.sh --after    # 打印当前值 + 与 --before 的差值
#
# 只读：不写任何链上状态。
# ---------------------------------------------------------------------------
set -euo pipefail

MODE="${1:-}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
FEED="0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3"
USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH="0x4200000000000000000000000000000000000006"
ACCOUNT0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
POOL="0x46880b404CD35c165EDdefF7421019F8dD25F4Ad"
SNAP=/tmp/alphaplan-snapshot-before.env

if [[ -f /tmp/alphaplan-demo-env ]]; then
  # shellcheck disable=SC1091
  source /tmp/alphaplan-demo-env
fi
VAULT="${VAULT:-${VAULT_ADDRESS:-}}"
[[ -n "${VAULT}" ]] || { echo "找不到 VAULT：先跑 script/demo-up.sh（或用 VAULT=... 指定）" >&2; exit 1; }

u() { cast call "$1" "$2" ${3:+"$3"} --rpc-url "${RPC_URL}" | awk '{print $1}'; }

CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
BLOCK="$(cast block-number --rpc-url "${RPC_URL}")"
TOTAL_ASSETS="$(u "${VAULT}" "totalAssets()(uint256)")"
TOTAL_SUPPLY="$(u "${VAULT}" "totalSupply()(uint256)")"
SHARE_PRICE="$(u "${VAULT}" "convertToAssets(uint256)(uint256)" 1000000)"
CASH="$(cast call "${USDC}" "balanceOf(address)(uint256)" "${VAULT}" --rpc-url "${RPC_URL}" | awk '{print $1}')"
WETH_BAL="$(cast call "${WETH}" "balanceOf(address)(uint256)" "${VAULT}" --rpc-url "${RPC_URL}" | awk '{print $1}')"
WETH_BPS="$(u "${VAULT}" "currentWethBps()(uint16)")"
MAX_REDEEM="$(cast call "${VAULT}" "maxRedeem(address)(uint256)" "${ACCOUNT0}" --rpc-url "${RPC_URL}" | awk '{print $1}')"
PLAN_HASH="$(cast call "${VAULT}" "lastPlanHash()(bytes32)" --rpc-url "${RPC_URL}")"
NONCE="$(u "${VAULT}" "lastNonce()(uint64)")"
TARGET_BPS="$(u "${VAULT}" "lastTargetWethBps()(uint16)")"
EXECUTED_AT="$(u "${VAULT}" "lastExecutedAt()(uint64)")"
ORACLE_NOW="$(cast call "${FEED}" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "${RPC_URL}" | sed -n 2p | awk '{print $1}')"
ORACLE_24H="$(cast call "${FEED}" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4000 --rpc-url "${RPC_URL}" | sed -n 2p | awk '{print $1}')"
SQ="$(cast call "${POOL}" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
POOL_PRICE="$(python3 -c "print('%.2f' % (1/((${SQ}/2**96)**2*10**(6-18))))")"
CHG="$(python3 -c "print(round((${ORACLE_NOW}/${ORACLE_24H}-1)*100, 2))")"
ACCT_USDC="$(cast call "${USDC}" "balanceOf(address)(uint256)" "${ACCOUNT0}" --rpc-url "${RPC_URL}" | awk '{print $1}')"

report() {
cat <<EOF
RPC_URL        ${RPC_URL}
VAULT_ADDRESS  ${VAULT}
DEPLOY_BLOCK   ${DEPLOY_BLOCK:-?}
CHAIN_ID       ${CHAIN_ID}   (当前块 ${BLOCK})

totalAssets    ${TOTAL_ASSETS}        (USDC, 6 位小数)
totalSupply    ${TOTAL_SUPPLY}
sharePrice     ${SHARE_PRICE}        (1 份额折合 USDC)
cash (USDC)    ${CASH}
weth (wei)     ${WETH_BAL}
currentWethBps ${WETH_BPS}
maxRedeem      ${MAX_REDEEM}        (account0，保守回退到现金覆盖部分)

lastPlanHash   ${PLAN_HASH}
lastNonce      ${NONCE}
lastTargetBps  ${TARGET_BPS}
lastExecutedAt ${EXECUTED_AT}
EOF
}

# 每条输出同时写入变量表，供 --before 落盘
dump() {
# 用 _B 后缀存基准，这样 source 回来不会覆盖当前值
cat <<EOF
VAULT_ADDRESS_B=${VAULT}
DEPLOY_BLOCK_B=${DEPLOY_BLOCK:-?}
TOTAL_ASSETS_B=${TOTAL_ASSETS}
TOTAL_SUPPLY_B=${TOTAL_SUPPLY}
SHARE_PRICE_B=${SHARE_PRICE}
CASH_B=${CASH}
WETH_BAL_B=${WETH_BAL}
WETH_BPS_B=${WETH_BPS}
MAX_REDEEM_B=${MAX_REDEEM}
ORACLE_NOW_B=${ORACLE_NOW}
POOL_PRICE_B=${POOL_PRICE}
EOF
}

echo "=== AlphaPlan demo 环境快照 ==="
report

TOPIC="$(cast keccak "PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)")"
LOGS="$(cast logs --address "${VAULT}" --from-block "${DEPLOY_BLOCK:-0}" "${TOPIC}" --rpc-url "${RPC_URL}" 2>/dev/null | grep -E "transactionHash|blockNumber" | tail -2 || true)"
echo "PlanExecuted   ${LOGS:-(没有：金库还没执行过任何计划)}"

cat <<EOF

--- 行情（mock feed，写在真 feed 地址上）---
oracle 现价    ${ORACLE_NOW}   (${POOL_PRICE:+池子现货 ${POOL_PRICE}})
oracle 24h 前  ${ORACLE_24H}
24h 涨跌       +${CHG}%
account0 USDC  ${ACCT_USDC}
EOF

case "${MODE}" in
  --before)
    dump > "${SNAP}"
    echo
    echo "已保存基准 → ${SNAP}（抬价后跑 --after 看差值）"
    ;;
  --after)
    if [[ ! -f "${SNAP}" ]]; then
      echo
      echo "没有基准（先跑 --before）" >&2
      exit 1
    fi
    # shellcheck disable=SC1090
    source "${SNAP}"
    VAULT="${VAULT_ADDRESS_B}"
    echo
    echo "--- 与基准的差值 ---"
    printf 'totalAssets    %s → %s  (%+d)\n' "${TOTAL_ASSETS_B:-?}" "${TOTAL_ASSETS}" "$(( TOTAL_ASSETS - ${TOTAL_ASSETS_B:-0} ))"
    printf 'sharePrice     %s → %s  (%+d)\n' "${SHARE_PRICE_B:-?}" "${SHARE_PRICE}" "$(( SHARE_PRICE - ${SHARE_PRICE_B:-0} ))"
    printf 'oracle 现价    %s → %s\n' "${ORACLE_NOW_B:-?}" "${ORACLE_NOW}"
    printf '池子现货       %s → %s\n' "${POOL_PRICE_B:-?}" "${POOL_PRICE}"
    printf 'currentWethBps %s → %s\n' "${WETH_BPS_B:-?}" "${WETH_BPS}"
    printf 'NAV 涨幅       %+.2f%%\n' "$(python3 -c "print((${TOTAL_ASSETS}/${TOTAL_ASSETS_B:-1}-1)*100)")"
    ;;
esac
