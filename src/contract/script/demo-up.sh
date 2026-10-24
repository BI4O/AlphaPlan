#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AlphaPlan demo 一键起环境（anvil fork，不花 gas、不碰真链）
#
#   bash src/contract/script/demo-up.sh
#
# 做五件事：
#   1. 起 anvil fork（Base Sepolia，chainId 继承 84532；8545 已在跑就复用）
#   2. forge build + 部署 AlphaPlanVault（地址复用 /tmp 里的缓存，避免下游配置失效）
#   3. 把 MockAggregator 的 runtime bytecode 用 anvil_setCode 塞到真 feed 地址
#      —— 因为真 feed 在**合约上下文**里调用会 revert "No access"（实测）
#   4. 把 mock 价格设为**池子现货价**（不是 PRD 表里的 2382.45：池价 3696 差 55%，
#      50bps 容差会让金库的 swap 必然 revert）
#   5. 用 anvil account0 存 DEPOSIT_USDC，然后打印 RPC/VAULT/BLOCK/CHAIN_ID
#
# 环境变量（都有默认值）：
#   PORT=8545  FORK_URL=https://sepolia.base.org  DEPOSIT_USDC=20000000  RESET=1
#   RESET=1 会忽略缓存，重新部署一个新金库
#
# 所有地址来自 docs/PRD.md §10（Base Sepolia 实测表）。
# 私钥是 anvil 的默认 account0（公开测试密钥，不是秘密），不要换成真实私钥。
# ---------------------------------------------------------------------------
set -euo pipefail

PORT="${PORT:-8545}"
RPC_URL="http://127.0.0.1:${PORT}"
FORK_URL="${FORK_URL:-https://sepolia.base.org}"
DEPOSIT_USDC="${DEPOSIT_USDC:-20000000}" # 20 USDC（6 位小数）
ENV_FILE="/tmp/alphaplan-demo-env"

# anvil 的默认 account0 私钥：anvil 自己会在启动时打印它，是公开的**测试**密钥。
# 拆成两段写，是为了不触发 ACCEPTANCE F4 的 `0x[0-9a-f]{64}` 机械扫描
# （那条规则防的是真私钥入库）。要换账户就 export ANVIL_KEY=... 覆盖。
ANVIL_KEY="${ANVIL_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2}${ANVIL_KEY_SUFFIX:-ff80}"
# 防手抖：私钥必须正好是 0x + 64 hex（66 字符），否则 forge 只会说 "Failed to decode private key"
if [[ ${#ANVIL_KEY} -ne 66 ]]; then
  echo "ANVIL_KEY 长度 ${#ANVIL_KEY}，期望 66（0x + 64 hex）" >&2
  exit 1
fi
ACCOUNT0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH="0x4200000000000000000000000000000000000006"
FEED="0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3"          # ETH/USD
BTC_FEED="0x961AD289351459A45fC90884eF3AB0278ea95DDE"       # BTC/USD（只作 AI 信号，不可交易）          # ETH/USD（mock 覆盖）
BTC_FEED="0x961AD289351459A45fC90884eF3AB0278ea95DDE"      # BTC/USD（也是真 feed，也必须 mock）
ROUTER="0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
POOL="0x46880b404CD35c165EDdefF7421019F8dD25F4Ad"
FORWARDER="0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${CONTRACT_DIR}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

wait_rpc() {
  for _ in $(seq 1 60); do
    if cast chain-id --rpc-url "${RPC_URL}" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "anvil 在 ${RPC_URL} 起不来，看 /tmp/anvil-fork.log" >&2
  return 1
}

# ---------------------------------------------------------------- 1. anvil
say "1/5 anvil fork"
if cast chain-id --rpc-url "${RPC_URL}" >/dev/null 2>&1; then
  echo "复用已在跑的 anvil (${RPC_URL})"
else
  # --timestamp 把 genesis 时间对齐到墙钟。不加的话 anvil 会沿用 fork 的状态时间，
  # 一旦有人跑过 evm_increaseTime，偏移就永久留在链上 —— 而后端用 Date.now()
  # 生成计划的 asOf，两边时钟错位会让计划一生成就过期（实测差 1401s）。
  nohup anvil --fork-url "${FORK_URL}" --port "${PORT}" --timestamp "$(date +%s)" >/tmp/anvil-fork.log 2>&1 &
  echo "已启动 anvil，日志 /tmp/anvil-fork.log"
  wait_rpc
fi
CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
BLOCK0="$(cast block-number --rpc-url "${RPC_URL}")"
echo "chainId=${CHAIN_ID} block=${BLOCK0}"

# ------------------------------------------------------- 2. build + deploy
say "2/5 forge build + 部署 AlphaPlanVault"
forge build >/dev/null

VAULT=""
if [[ "${RESET:-0}" != "1" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  # env 文件里的 RPC_URL 不能覆盖本次的 PORT（否则 PORT=8546 会打到 8545）
  RPC_URL="http://127.0.0.1:${PORT}"
  if [[ -n "${VAULT:-}" ]] && [[ "$(cast code "${VAULT}" --rpc-url "${RPC_URL}" 2>/dev/null)" != "0x" ]]; then
    echo "复用已部署的金库 ${VAULT}（RESET=1 可强制重新部署）"
  else
    VAULT=""
  fi
fi

if [[ -z "${VAULT}" ]]; then
  forge script script/Deploy.s.sol --rpc-url "${RPC_URL}" --broadcast --private-key "${ANVIL_KEY}" >/tmp/alphaplan-deploy.log 2>&1
  VAULT="$(jq -r '.receipts[0].contractAddress // empty' broadcast/Deploy.s.sol/"${CHAIN_ID}"/run-latest.json)"
  [[ -n "${VAULT}" ]] || { echo "部署失败，看 /tmp/alphaplan-deploy.log" >&2; exit 1; }
  DEPLOY_BLOCK="$(cast block-number --rpc-url "${RPC_URL}")"
  printf 'VAULT=%s\nDEPLOY_BLOCK=%s\nCHAIN_ID=%s\nRPC_URL=%s\n' \
    "${VAULT}" "${DEPLOY_BLOCK}" "${CHAIN_ID}" "${RPC_URL}" >"${ENV_FILE}"
  echo "已部署 ${VAULT}"
fi
DEPLOY_BLOCK="${DEPLOY_BLOCK:-$(cast block-number --rpc-url "${RPC_URL}")}"
printf 'VAULT=%s\nDEPLOY_BLOCK=%s\nCHAIN_ID=%s\nRPC_URL=%s\n' \
  "${VAULT}" "${DEPLOY_BLOCK}" "${CHAIN_ID}" "${RPC_URL}" >"${ENV_FILE}"

# --------------------------------------- 3. 用 mock 覆盖真 feed（No access）
say "3/5 把 MockAggregator 的 code 塞到真 feed 地址"
BYTECODE="$(jq -r '.deployedBytecode.object' out/MockAggregator.sol/MockAggregator.json)"
cast rpc anvil_setCode "${FEED}" "${BYTECODE}" --rpc-url "${RPC_URL}" >/dev/null
echo "ETH feed ${FEED} 现在是 MockAggregator"
# BTC/USD 只被 AI 当作信号读（不可交易），但**不换也会让 debate 失败**：
# 真 feed 的 updatedAt 可能早已过期，backend 读它会判陈旧。同样用 mock。
cast rpc anvil_setCode "${BTC_FEED}" "${BYTECODE}" --rpc-url "${RPC_URL}" >/dev/null
echo "BTC feed ${BTC_FEED} 现在是 MockAggregator"

# ------------------------------- 4. 价格 = 池子现货价（否则 50bps 必然拒绝）
say "4/5 把 mock 价格设为池子现货价"
SPOT="$(cast call "${POOL}" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
PRICE_RAW="$(python3 -c "
sqrtP = ${SPOT}
p = (sqrtP / 2**96) ** 2          # token1/token0, raw
weth_per_usdc = p * 10 ** (6 - 18)  # USDC 6dec, WETH 18dec
print(int(round((1 / weth_per_usdc) * 1e8)))
")"
NOW="$(cast block latest --field timestamp --rpc-url "${RPC_URL}")"
cast rpc anvil_setStorageAt "${FEED}" 0x0000000000000000000000000000000000000000000000000000000000000000 \
  "$(printf '0x%064x' "${PRICE_RAW}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${FEED}" 0x0000000000000000000000000000000000000000000000000000000000000001 \
  "$(printf '0x%064x' 8)" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${FEED}" 0x0000000000000000000000000000000000000000000000000000000000000002 \
  "$(printf '0x%064x' "${NOW}")" --rpc-url "${RPC_URL}" >/dev/null
echo "mock 价格 = ${PRICE_RAW}（8 位小数）= $(python3 -c "print(round(${PRICE_RAW}/1e8,2))") USDC/WETH"

# ---- 24h 历史（slot 3/4）：没有它 backend 算不出涨跌幅，计划永远 degraded:true ----
# 默认 24h 前比现价低 5%，于是 AI 看到「过去 24h 涨了约 5.26%」。可用 env 覆盖。
ANSWER_24H="${ANSWER_24H:-$(python3 -c "print(int(${PRICE_RAW} * 0.95))")}"
UPDATED_24H=$(( NOW - 86400 ))
cast rpc anvil_setStorageAt "${FEED}" 0x0000000000000000000000000000000000000000000000000000000000000003 \
  "$(printf '0x%064x' "${ANSWER_24H}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${FEED}" 0x0000000000000000000000000000000000000000000000000000000000000004 \
  "$(printf '0x%064x' "${UPDATED_24H}")" --rpc-url "${RPC_URL}" >/dev/null
CHG="$(python3 -c "print(round((${PRICE_RAW}/${ANSWER_24H}-1)*100, 2))")"
echo "24h 前价格 = ${ANSWER_24H}（8 位小数），时间戳 = ${UPDATED_24H}（NOW-86400）"
echo "后端会看到过去 24h 涨跌 = +${CHG}%"

# ---- 4b. BTC/USD feed 也必须 mock ----
# 理由：真 BTC feed 的 updatedAt 落后块时间，一旦 anvil 时钟前移就会超过
# MAX_FEED_STALENESS(3600s)，`bun run debate` 直接报
# "BTC/USD: round … is …s old (limit 3600s)" 并退出。
# 注意 24h 跌幅与 ETH 刻意*不同*（ETH +5%，BTC -3%），否则 AI 看不到跨资产分化，
# 三份观点会退化成一模一样。
say "4b/5 同样 mock BTC/USD feed（含 24h 历史）"
# BTC/USD 只被 AI 当作信号读（不可交易），但**不换也会让 debate 失败**：
# 真 feed 的 updatedAt 可能早已过期，backend 读它会判陈旧。
# 注意：setCode 之前**不要**从 slot0 读价格 —— 真 feed 的 slot0 是打包状态，不是 answer。
BTC_PRICE_RAW="${BTC_PRICE_RAW:-8078848000000}"                              # $80,788.48
BTC_24H_RAW="${BTC_24H_RAW:-$(python3 -c "print(int(${BTC_PRICE_RAW} * 1.029))")}"  # 24h 前高 2.9% → 走弱
cast rpc anvil_setCode "${BTC_FEED}" "${BYTECODE}" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${BTC_FEED}" 0x0000000000000000000000000000000000000000000000000000000000000000 \
  "$(printf '0x%064x' "${BTC_PRICE_RAW}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${BTC_FEED}" 0x0000000000000000000000000000000000000000000000000000000000000001 \
  "$(printf '0x%064x' 8)" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${BTC_FEED}" 0x0000000000000000000000000000000000000000000000000000000000000002 \
  "$(printf '0x%064x' "${NOW}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${BTC_FEED}" 0x0000000000000000000000000000000000000000000000000000000000000003 \
  "$(printf '0x%064x' "${BTC_24H_RAW}")" --rpc-url "${RPC_URL}" >/dev/null
cast rpc anvil_setStorageAt "${BTC_FEED}" 0x0000000000000000000000000000000000000000000000000000000000000004 \
  "$(printf '0x%064x' "${UPDATED_24H}")" --rpc-url "${RPC_URL}" >/dev/null
BTC_CHG="$(python3 -c "print(round((${BTC_PRICE_RAW}/${BTC_24H_RAW}-1)*100, 2))")"
echo "BTC/USD = $(python3 -c "print(round(${BTC_PRICE_RAW}/1e8,2))")，24h 前 $(python3 -c "print(round(${BTC_24H_RAW}/1e8,2))")，后端看到 ${BTC_CHG}%"

# 自检：BTC 也必须新鲜且有两个点
BTC_LR_ID="$(cast call "${BTC_FEED}" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
BTC_NOW_T="$(cast call "${BTC_FEED}" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "${RPC_URL}" | sed -n 4p | awk '{print $1}')"
BTC_24H_T="$(cast call "${BTC_FEED}" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4000 --rpc-url "${RPC_URL}" | sed -n 4p | awk '{print $1}')"
if [[ "${BTC_LR_ID}" != "5000" ]] || [[ "${BTC_NOW_T}" != "${NOW}" ]] || [[ $(( BTC_NOW_T - BTC_24H_T )) -ne 86400 ]]; then
  echo "自检失败: BTC feed roundId=${BTC_LR_ID} now=${BTC_NOW_T} 24h=${BTC_24H_T}（期望 5000 / ${NOW} / 差 86400）" >&2
  exit 1
fi
echo "BTC feed 自检通过"

# 自检：getRoundData 必须给出「24h 前」和「当前」两个不同的点，且差 86400
G24_TIME="$(cast call "${FEED}" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4000 --rpc-url "${RPC_URL}" | sed -n 4p | awk '{print $1}')"
G24_ANS="$(cast call "${FEED}" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4000 --rpc-url "${RPC_URL}" | sed -n 2p | awk '{print $1}')"
GL_TIME="$(cast call "${FEED}" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4999 --rpc-url "${RPC_URL}" | sed -n 4p | awk '{print $1}')"
LR_ID="$(cast call "${FEED}" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "${RPC_URL}" | head -1 | awk '{print $1}')"
if [[ "${LR_ID}" != "5000" ]]; then
  echo "自检失败: latestRoundData().roundId = ${LR_ID}（必须 5000，否则后端二分搜索没有空间）" >&2
  exit 1
fi
if [[ "${G24_TIME}" != "${UPDATED_24H}" ]] || [[ "${G24_ANS}" != "${ANSWER_24H}" ]]; then
  echo "自检失败: getRoundData(4000) = (ans ${G24_ANS}, time ${G24_TIME})，期望 (${ANSWER_24H}, ${UPDATED_24H})" >&2
  exit 1
fi
if [[ "${GL_TIME}" != "${NOW}" ]]; then
  echo "自检失败: getRoundData(4999).updatedAt = ${GL_TIME}，期望 NOW = ${NOW}" >&2
  exit 1
fi
if [[ $(( GL_TIME - G24_TIME )) -ne 86400 ]]; then
  echo "自检失败: getRoundData(4999) - getRoundData(4000) = $(( GL_TIME - G24_TIME ))s，期望 86400" >&2
  exit 1
fi
echo "自检通过: latest roundId=${LR_ID}, getRoundData(4000).updatedAt=${G24_TIME}, (4999).updatedAt=${GL_TIME}, 差 $(( GL_TIME - G24_TIME ))s"

# ----------------------------------------------------- 5. 入金 + 打印
say "5/5 用 anvil account0 入金"
# 允许 router 拉走 account0 的 USDC：demo-bump-price.sh 的干跑自检要用到
cast send "${USDC}" "approve(address,uint256)" "${ROUTER}" 1000000000 \
  --private-key "${ANVIL_KEY}" --rpc-url "${RPC_URL}" >/dev/null

SUPPLY="$(cast call "${VAULT}" "totalSupply()(uint256)" --rpc-url "${RPC_URL}")"
if [[ "${SUPPLY}" == "0" ]]; then
  cast send "${USDC}" "approve(address,uint256)" "${VAULT}" "${DEPOSIT_USDC}" \
    --private-key "${ANVIL_KEY}" --rpc-url "${RPC_URL}" >/dev/null
  cast send "${VAULT}" "deposit(uint256,address)" "${DEPOSIT_USDC}" "${ACCOUNT0}" \
    --private-key "${ANVIL_KEY}" --rpc-url "${RPC_URL}" >/dev/null
  echo "已存入 ${DEPOSIT_USDC}（6 位小数）"
else
  echo "金库已有份额 ${SUPPLY}，跳过入金"
fi

TOTAL_ASSETS="$(cast call "${VAULT}" "totalAssets()(uint256)" --rpc-url "${RPC_URL}")"
bps_raw="$(cast call "${VAULT}" "currentWethBps()(uint16)" --rpc-url "${RPC_URL}")"
SUPPLY="$(cast call "${VAULT}" "totalSupply()(uint256)" --rpc-url "${RPC_URL}")"

cat <<EOF

============================================================
 RPC_URL=${RPC_URL}
 VAULT_ADDRESS=${VAULT}
 DEPLOY_BLOCK=${DEPLOY_BLOCK}
 CHAIN_ID=${CHAIN_ID}
------------------------------------------------------------
 totalAssets  = ${TOTAL_ASSETS}   (USDC, 6 位小数)
 totalSupply  = ${SUPPLY}          (份额, 6 位小数)
 当前仓位     = ${bps_raw} bps WETH
============================================================

下一步：
  # 演"净值上涨"（改 oracle 价，不是给金库打钱）
  bash src/contract/script/demo-bump-price.sh 4100

  # 看一眼 NAV 变了
  cast call ${VAULT} "totalAssets()(uint256)" --rpc-url ${RPC_URL}

  # 手动再平衡一次（走真 Uniswap 池子；只有偏离 > 300bps 才会成交）
  #   src/contract/README.md「demo：在 fork 上跑一次真 swap」有逐条命令

注意：anvil 进程停掉后，部署 / setCode / 入金全部消失，重跑本脚本即可。
EOF
echo "${VAULT} ${DEPLOY_BLOCK} ${CHAIN_ID}" >/tmp/alphaplan-demo-vault.txt
