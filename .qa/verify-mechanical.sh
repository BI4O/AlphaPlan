#!/usr/bin/env bash
# AlphaPlan mechanical acceptance checks — 口径见 docs/ACCEPTANCE.md (v2)
#
#   .qa/verify-mechanical.sh          # fast (~10s)，无网络，不构建前端
#   .qa/verify-mechanical.sh --full   # 另跑 forge test + pnpm build（慢）
#
# Exit 0 = 无 FAIL。SKIP = 前置未就绪，不是通过。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FULL=0; [[ "${1:-}" == "--full" ]] && FULL=1

PASS=0; FAIL=0; SKIP=0; INFO=0; WARN=0; FAILED_ITEMS=(); WARNED_ITEMS=()
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %-7s %s\n' "$1" "$2"; }
info() { INFO=$((INFO+1)); printf '  \033[36mINFO\033[0m %-7s %s\n' "$1" "$2"; }
warn() { WARN=$((WARN+1)); WARNED_ITEMS+=("$1: $2"); printf '  \033[33mWARN\033[0m %-7s %s\n' "$1" "$2"; }
bad()  { FAIL=$((FAIL+1)); FAILED_ITEMS+=("$1: $2"); printf '  \033[31mFAIL\033[0m %-7s %s\n' "$1" "$2"; }
skip() { SKIP=$((SKIP+1)); printf '  \033[33mSKIP\033[0m %-7s %s\n' "$1" "$2"; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
# assert <id> <desc> <cmd...>
assert() { local id="$1" desc="$2"; shift 2; if "$@" >/dev/null 2>&1; then ok "$id" "$desc"; else bad "$id" "$desc"; fi; }

CT=src/contract; BE=src/backend; FE=src/frontend/alpha-plan; CR=$BE/cre
SOL=$(find $CT/src -name '*.sol' 2>/dev/null)

hdr "A. 合约 (src/contract)"
if [[ -z "$SOL" ]]; then
  skip A1-A18 "$CT/src 无 .sol"
else
  if (cd $CT && forge build >/tmp/qa-forge-build.log 2>&1); then ok A1 "forge build"; else bad A1 "forge build（/tmp/qa-forge-build.log）"; fi
  assert A2 "remappings 含 @openzeppelin/" grep -q '@openzeppelin/=lib/openzeppelin-contracts/' $CT/remappings.txt
  if grep -qE '^cache/?$' .gitignore; then ok A3 "根 .gitignore 含 cache/"; else bad A3 "根 .gitignore 缺 cache/（PLAN P0）"; fi

  # A12 无后门
  BAD=$(grep -nEi 'function +set(Fee|FeeRecipient|MaxWethBps|MinCashBps|Slippage|Tolerance)|upgradeTo|_authorizeUpgrade|initialize\(' $SOL 2>/dev/null)
  [[ -z "$BAD" ]] && ok A12 "无费率 setter / 无升级 / 无 initializer" || bad A12 "可疑权限函数：$BAD"

  # A13 常量表 8 项 + MIN_CASH_BPS 必须不存在
  MISSING=""
  for pair in "MAX_WETH_BPS,6000" "TOLERANCE_BPS,300" "MAX_SWAP_BPS,5000" "SLIPPAGE_BPS,50" "MIN_INTERVAL,60" "MAX_PLAN_AGE,3600" "FEE_BPS_PER_PERIOD,10"; do
    n=${pair%,*}; v=${pair#*,}
    grep -qE "$n *= *$v\b|$n *= *uint(16|64)\($v\)" $SOL 2>/dev/null || MISSING+="$n=$v "
  done
  grep -qE 'FEE_PERIOD *= *30 *days' $SOL 2>/dev/null || MISSING+="FEE_PERIOD=30days "
  [[ -z "$MISSING" ]] && ok A13 "常量 8 项与 PRD §5 一致" || bad A13 "常量缺失/不符：$MISSING"
  if grep -qi 'MIN_CASH_BPS' $SOL 2>/dev/null; then
    bad A13b "MIN_CASH_BPS 仍存在（PRD §3.2 已证明它是死代码）"
  else
    ok A13b "MIN_CASH_BPS 已不存在"
  fi

  # A14 两个事件 —— 从 ABI 抽真实签名，算 topic0，与期望值比。不 grep 名字就放行。
  # 期望值来源：PRD §5 事件定义（asOf + validUntil 版）。改事件必须同时改这里 + PRD。
  check_event() {  # name want_sig want_topic want_names want_indexed
    local name="$1" wsig="$2" wtopic="$3" wnames="$4" widx="$5"
    local j=sig names idx topic
    j=$(echo "$ABIJSON" | jq -r --arg n "$name" '[.[]|select(.type=="event" and .name==$n)][0]')
    if [[ -z "$j" || "$j" == "null" ]]; then bad "A14:$name" "ABI 里没有该事件"; return; fi
    sig=$(echo "$j" | jq -r '.name + "(" + ([.inputs[].type]|join(",")) + ")"')
    names=$(echo "$j" | jq -r '[.inputs[].name]|join(",")')
    idx=$(echo "$j" | jq -r '[.inputs[]|select(.indexed)|.name]|join(",")')
    topic=$(cast keccak "$sig")
    if [[ "$sig" != "$wsig" ]]; then
      bad "A14:$name" "签名不符｜源码=${sig}｜期望=$wsig"
    elif [[ "$topic" != "$wtopic" ]]; then
      bad "A14:$name" "topic0 不符｜${topic}｜期望=$wtopic"
    elif [[ "$names" != "$wnames" ]]; then
      bad "A14:$name" "字段名/顺序不符｜${names}｜期望=$wnames"
    elif [[ "$idx" != "$widx" ]]; then
      bad "A14:$name" "indexed 不符｜[$idx]｜期望=[$widx]"
    else
      ok "A14:$name" "$sig  topic0=$topic  indexed=[$idx]"
    fi
  }
  ABIJSON=$( (cd $CT && forge inspect AlphaPlanVault abi --json 2>/dev/null) )
  if [[ -z "$ABIJSON" ]]; then
    bad A14 "forge inspect 拿不到 ABI（事件无法验）"
  else
    check_event PlanExecuted \
      "PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)" \
      "0x32fcaf0e03b774dd6c329a94ed690d2c36cab98914f95e28d809f9ef81104f11" \
      "reportHash,planHash,asOf,validUntil,targetWethBps,actualWethBps,usdcIn,wethIn,nonce" \
      "reportHash,planHash"
    check_event PlanRecorded \
      "PlanRecorded(bytes32,bytes32,uint64,uint64,uint16,uint16,uint64)" \
      "0xb7e38568320cd4c1f411da3b661de985d1ca19a9c83d0ff910bbf8a592dd823c" \
      "reportHash,planHash,asOf,validUntil,targetWethBps,actualWethBps,nonce" \
      "reportHash,planHash"
    # A14p PRD 声明的事件必须带 asOf / validUntil（防文档停留在旧 7 字段版）
    for ev in PlanExecuted PlanRecorded; do
      BLK=$(awk "/event $ev\\(/,/\\);/" $ROOT/docs/PRD.md 2>/dev/null)
      if [[ -z "$BLK" ]]; then
        bad "A14p:$ev" "PRD §5 找不到 event $ev 声明"
      elif echo "$BLK" | grep -q ' asOf' && echo "$BLK" | grep -q ' validUntil'; then
        ok "A14p:$ev" "PRD 事件声明含 asOf + validUntil"
      else
        bad "A14p:$ev" "PRD 事件声明缺 asOf/validUntil（与合约不一致，verify/前端会解错）"
      fi
    done
  fi

  # A15 报告 ABI：6 字段、asOf 在 validUntil 之前
  DEC=$(grep -rhoE 'abi\.decode\(report,[^;]*\)' $SOL 2>/dev/null | head -1)
  if [[ -z "$DEC" ]]; then
    bad A15 "找不到 abi.decode(report, ...)（无法核对 6 字段）"
  else
    INNER=$(echo "$DEC" | sed -n 's/.*abi\.decode(report,[[:space:]]*(\(.*\))[[:space:]]*)$/\1/p')
    N=$(echo "$INNER" | tr ',' '\n' | wc -l | tr -d ' ')
    if [[ "$N" -eq 6 ]] && echo "$INNER" | grep -qE '^[[:space:]]*address,[[:space:]]*uint64,[[:space:]]*uint64,[[:space:]]*uint64,[[:space:]]*uint16,[[:space:]]*bytes32'$; then
      ok A15 "报告 ABI 6 字段且顺序为 (address,asOf,validUntil,nonce,uint16,bytes32)"
    else
      bad A15 "报告 ABI 不是 6 字段/顺序不符：$INNER"
    fi
  fi

  # A16 planUsed
  if grep -qE 'mapping *\( *bytes32[^)]*=> *bool[^)]*\) *public *planUsed' $SOL 2>/dev/null; then
    ok A16 "planUsed 是 public mapping"
  else
    bad A16 "缺 mapping(bytes32=>bool) public planUsed"
  fi
  assert A18 "有 currentWethBps()" grep -q 'function currentWethBps' $SOL

  # A5a / A5b 判据形态
  T=$(find $CT/test -name '*.t.sol' 2>/dev/null)
  if [[ -z "$T" ]]; then
    skip A5a "无 test/*.t.sol"
  else
    R=$(grep -h 'vm.expectRevert' $T | wc -l | tr -d ' ')
    [[ "$R" -ge 10 ]] && ok A5a "revert 用例 $R ≥ 10（人工确认逐条对应 PRD §5 第 1–10 行）" || bad A5a "revert 用例仅 $R < 10"
    if grep -q 'PlanRecorded' $T; then ok A5b "有 PlanRecorded 分支断言（第 11 行不是 revert）"; else bad A5b "缺容差分支的 PlanRecorded 断言"; fi
    grep -q 'MAX_PLAN_AGE' $T && ok A5c "asOf/MAX_PLAN_AGE 边界有断言" || bad A5c "缺 asOf 上界/下界断言"
  fi

  if [[ $FULL -eq 1 ]]; then
    if (cd $CT && forge test >/tmp/qa-forge-test.log 2>&1); then ok A4 "forge test"; else bad A4 "forge test（/tmp/qa-forge-test.log）"; fi
  else
    skip A4 "--full 才跑 forge test"
  fi
fi

hdr "B. 后端 (src/backend)"
if (cd $BE && bun check >/tmp/qa-bun-check.log 2>&1); then ok B1 "bun check"; else bad B1 "bun check（/tmp/qa-bun-check.log）"; fi
S=$BE/src/schema.ts

grep -q 'not implemented yet' $BE/src/debate.ts 2>/dev/null && bad B2 "debate.ts 仍是脚手架" || {
  [[ -f $BE/src/debate.ts ]] && {
    if (cd $BE && bun run debate --check >/tmp/qa-debate-check.log 2>&1); then ok B3 "bun run debate --check"; else bad B3 "bun run debate --check（/tmp/qa-debate-check.log）"; fi
    assert B4 "支持 --offline" grep -q -- '--offline' $BE/src/debate.ts
  }
}
if grep -q 'not implemented yet' $BE/src/verify.ts 2>/dev/null; then bad B6 "verify.ts 仍是脚手架"; else ok B6 "verify.ts 已实现"; fi

# B5 分域边界
if grep -q 'MAX_TARGET_WETH_BPS *= *6000' $S 2>/dev/null; then ok B5 "target 上限 6000 已分离"; else bad B5 "无 MAX_TARGET_WETH_BPS=6000"; fi
if grep -qE 'degenerate' /dev/null; then :; fi
grep -qE 'max\(10_000\)' $S 2>/dev/null && {
  if grep -qE 'observedWethBps|MAX_OBSERVED_WETH_BPS' $S; then ok B5b "10000 只用于观测域（wethBps）"; else bad B5b "10000 仍可能用于 target 域"; fi
} || ok B5b "无裸 10_000 上限"

# B8 degraded 必填
if grep -qE 'degraded: *z\.boolean\(\)' $S 2>/dev/null && ! grep -qE 'degraded:.*(optional|default\()' $S; then
  ok B8 "degraded 必填（非 optional/default）"
else
  bad B8 "degraded 不是必填 z.boolean()"
fi

# B9 model 三字段（schema + 写入器）
for f in model promptTemplateSha temperature; do
  grep -q "$f" $S 2>/dev/null && ok "B9:$f" "schema 有 $f" || bad "B9:$f" "schema 缺 $f"
done
if [[ -f $BE/src/debate.ts ]]; then
  # 判「实际产物」而不是「源码字面量」：
  # 实现可能写 4 处字面量，也可能写 1 处泛化写入 × 4 次调用（当前是后者）。
  # 数源码出现次数会假红 —— 第 10 例：判据依赖具体实现形式。
  SAMPLE=$(ls $BE/plans/*.json 2>/dev/null | tail -1)
  if [[ -z "$SAMPLE" ]]; then
    info B9b "plans/ 为空，无法检查实际产物"
  else
    N=$(jq '[paths(scalars) as $p | select($p[-1]=="promptTemplateSha")] | length' "$SAMPLE" 2>/dev/null || echo 0)
    NAMES=$(jq -r '[.rounds[]|.agent] + ["final"] | join(",")' "$SAMPLE" 2>/dev/null)
    if [[ "$N" -eq 4 ]]; then
      ok B9b "实际产物含 4 处 promptTemplateSha（${NAMES}）"
    else
      bad B9b "实际产物只有 ${N} 处（应 4：bull/bear/risk/final；实际 ${NAMES}）"
    fi
  fi
  grep -q 'serializePlan' $BE/src/debate.ts && ok B11 "写入器是 serializePlan（可做往返测试）" || bad B11 "找不到 serializePlan"
fi

# B10 prompts 入库 + keccak
PMISS=""; PUNTRACKED=0; PSHA=""
for a in bull bear risk judge; do
  f=$BE/prompts/$a.txt
  if [[ -f $f ]]; then
    git ls-files --error-unmatch "$f" >/dev/null 2>&1 || PUNTRACKED=$((PUNTRACKED+1))
    PSHA+="$a=$(cast keccak 0x$(xxd -p -c 1000000 "$f" | tr -d '\n') 2>/dev/null | cut -c1-14)… "
  else
    PMISS+="$a(缺失) "
  fi
done
if [[ -n "$PMISS" ]]; then
  bad B10 "prompts 缺失：$PMISS"
elif [[ $PUNTRACKED -gt 0 ]]; then
  if [[ $(git ls-files src | wc -l | tr -d ' ') -le 2 ]]; then
    skip B10 "prompts 4 个齐全，但整仓尚未提交（git ls-files src 只有 submodule）→ 留到 P6 复验"
  else
    bad B10 "$PUNTRACKED 个 prompt 未入库（仓库已在提交代码，这四个不能漏）"
  fi
  echo "       $PSHA"
else
  ok B10 "prompts 4 个齐全且已入库"; echo "       $PSHA"
fi

# B13 validity 默认 900
if grep -qE 'validitySeconds[^0-9]*900|900[^0-9]*validitySeconds|VALIDITY_SECONDS *= *900' $BE/src/*.ts 2>/dev/null; then
  ok B13 "默认 validitySeconds 900"
elif grep -qE '\b1800\b' $BE/src/*.ts 2>/dev/null; then
  bad B13 "出现 1800（PLAN P2 明确说这是踩过的坑）"
else
  skip B13 "尚未见 validitySeconds 默认值"
fi

# B7 字节稳定（已提交的计划文件）
# 先跑一个 canary：cast keccak 必须是 0x 前缀才会按字节哈希，否则算的是 ASCII 文本
CANARY=$(cast keccak 0x616263 2>/dev/null)
if [[ "$CANARY" == "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45" ]]; then
  ok B7c "keccak 命令形式正确（0x616263 → keccak256(\"abc\") 公认值）"
else
  bad B7c "keccak 形式错误：cast keccak 0x616263 = ${CANARY}（应为 4e03657a…）"
fi
PL=$(ls $BE/plans/*.json 2>/dev/null | head -1)
if [[ -z "$PL" ]]; then
  skip B7 "plans/ 为空"
else
  grep -q $'\r' "$PL" && bad B7 "计划文件含 CRLF" || ok B7 "无 CRLF"
  head -c3 "$PL" | od -An -tx1 | grep -q 'ef bb bf' && bad B7b "有 UTF-8 BOM" || ok B7b "无 BOM"
  echo "       $PL"
  echo "       sha256=$(shasum -a 256 "$PL" | cut -d' ' -f1)"
  echo "       keccak=$(cast keccak 0x$(xxd -p -c 1000000 "$PL" | tr -d '\n'))"
fi

hdr "B12. prompt 归档：文件名必须等于内容 keccak"
ARCH=$BE/prompts/archive
if [[ ! -d "$ARCH" ]]; then
  bad B12 "无 prompts/archive/ —— prompt 追溯链未建立"
else
  TOTAL=0; BAD=0; BADLIST=""
  for f in "$ARCH"/*.txt; do
    [[ -e "$f" ]] || continue
    TOTAL=$((TOTAL+1))
    NAME=$(basename "$f" .txt)
    ACT=$(cast keccak 0x$(xxd -p -c 1000000 "$f" | tr -d '\n') 2>/dev/null)
    if [[ "$NAME" != "$ACT" ]]; then
      BAD=$((BAD+1)); BADLIST+="$(basename "$f") "
    fi
  done
  if [[ $TOTAL -eq 0 ]]; then
    bad B12 "archive/ 为空"
  elif [[ $BAD -eq 0 ]]; then
    ok B12 "prompt 归档 ${TOTAL} 份，文件名 == 内容 keccak"
  else
    bad B12 "${BAD}/${TOTAL} 份归档文件名与内容哈希不符：${BADLIST}"
  fi
  # 当前 prompts 是否都已归档（否则下次改 prompt 就断链）
  MISSING=""
  for n in bull bear risk judge; do
    f=$BE/prompts/$n.txt
    [[ -f "$f" ]] || continue
    H=$(cast keccak 0x$(xxd -p -c 1000000 "$f" | tr -d '\n') 2>/dev/null)
    [[ -f "$ARCH/$H.txt" ]] || MISSING+="$n "
  done
  [[ -z "$MISSING" ]] && ok B12b "当前 4 份 prompt 均已归档" || bad B12b "未归档的当前 prompt：${MISSING}（改 prompt 后会断链）"
fi

hdr "C. CRE (src/backend/cre)"
if [[ ! -f $CR/project.yaml ]]; then
  skip C1-C10 "cre/ 不存在"
else
  ok C1 "cre/project.yaml 存在"
  assert C2 "RPC = ethereum-testnet-sepolia-base-1" grep -q 'ethereum-testnet-sepolia-base-1' $CR/project.yaml
  assert C3 "workflow.yaml 含 local-simulation" grep -q 'local-simulation' $CR/alpha-plan/workflow.yaml
  BADSCH=""
  while read -r v; do [[ -z "$v" ]] && continue; [[ $(echo "$v" | wc -w) -eq 6 ]] || BADSCH+="[$v] "; done \
    <<< "$(grep -rho '"schedule"[[:space:]]*:[[:space:]]*"[^"]*"' $CR/alpha-plan/config*.json 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')"
  [[ -z "$BADSCH" ]] && ok C4 "cron 全为六段" || bad C4 "非六段 cron：$BADSCH"

  WF=$(find $CR/alpha-plan -maxdepth 2 -name '*.ts' 2>/dev/null)
  # 只在**非注释行**里查禁用 API（否则文档注释里提到 'No z.string().url()' 会被误判为违规）
  CODE_ONLY=$(grep -vE '^[[:space:]]*(//|/\*|\*)' $WF 2>/dev/null)
  F1=$(echo "$CODE_ONLY" | grep -nE 'z\.string\(\)\.url\(')
  F2=$(echo "$CODE_ONLY" | grep -nE 'await +[a-zA-Z_]+\.(http|evm|log|crypto)')
  F3=$(echo "$CODE_ONLY" | grep -nE '\bprocess\.|\bBuffer\.|Date\.now\(')
  [[ -z "$F1$F2$F3" ]] && ok C5 "无禁用 API" || bad C5 "禁用 API：$F1 $F2 $F3"
  assert C6 "聚合用 identical" grep -q 'identical' $WF

  # C10 degraded 必须早于 planUsed，且都早于 local-simulation 提前返回
  LR=$(echo "$CODE_ONLY" | grep -n 'degraded' | head -1 | cut -d: -f1)
  LP=$(echo "$CODE_ONLY" | grep -n 'planUsed' | head -1 | cut -d: -f1)
  if [[ -n "$LR" && -n "$LP" ]]; then
    [[ "$LR" -lt "$LP" ]] && ok C10 "degraded(L$LR) 早于 planUsed(L$LP)" || bad C10 "顺序反了：degraded L$LR vs planUsed L$LP → 降级检查是死分支"
  else
    bad C10 "找不到 degraded/planUsed 前置检查"
  fi
  echo "$CODE_ONLY" | grep -q 'refusing to write' && ok C10b "有 degraded 拒绝日志" || bad C10b "缺 \"refusing to write\" 日志"
  echo "$CODE_ONLY" | grep -q 'already executed' && ok C10c "有 planUsed 跳过日志" || bad C10c "缺 \"already executed\" 日志"
fi

hdr "D. 部署闸门（源码改了但链上还是旧的）"
# 这一类问题的特征：forge test 全绿、源码里有新事件，但 anvil/测试网上的合约是旧版。
# 判据：链上 runtime bytecode 必须与本地 artifact **逐字节相同**，且含新事件 topic0。
ENVF=/tmp/alphaplan-demo-env
ART=$CT/out/AlphaPlanVault.sol/AlphaPlanVault.json
if [[ ! -f "$ENVF" ]]; then
  skip D0 "无 ${ENVF}（demo-up.sh 未跑过）"
elif [[ ! -f "$ART" ]]; then
  skip D0 "无 artifact，先 forge build"
else
  # shellcheck disable=SC1090
  eval "$(grep -E '^(VAULT|RPC_URL)=' "$ENVF")"
  LIVE=$(cast code "$VAULT" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n')
  # 注意：artifact 的 deployedBytecode 把 immutable 位置留成 00 占位（本合约 672 字节），
  # 链上是真实部署值（owner/forwarder/feed/router/…），所以**不能逐字节相等**。
  # 正确做法：先把 immutable 位置从两侧都抠掉，再比；同时比长度 + CBOR metadata。
  D0=$(python3 - "$LIVE" "$ART" <<'PY2'
import json,sys
live, art = sys.argv[1], sys.argv[2]
try: a=json.load(open(art))
except Exception as e: print("ERR cannot read artifact"); sys.exit()
local=a['deployedBytecode']['object']
pos=set()
for v in a['deployedBytecode'].get('immutableReferences',{}).values():
    for r in v: pos.update(range(r['start'], r['start']+r['length']))
if len(live)!=len(local): print(f"LEN {len(live)//2-1} != {len(local)//2-1}"); sys.exit()
bad=[i for i in range(len(local)//2) if i not in pos and live[2+2*i:4+2*i]!=local[2+2*i:4+2*i]]
meta_ok = live[-106:]==local[-106:]
print(("OK" if not bad else f"DIFF {len(bad)} bytes outside immutables (first at {bad[0]})") + (" | metadata ok" if meta_ok else " | METADATA DIFFERS"))
PY2
)
  if [[ "$D0" == OK* ]]; then
    ok D0 "链上 bytecode == 本地 artifact（已排除 $(python3 -c "import json;a=json.load(open('$ART'));print(sum(r['length'] for v in a['deployedBytecode'].get('immutableReferences',{}).values() for r in v))")B immutable 占位）"
  else
    bad D0 "链上合约与源码不一致：$D0 @ $VAULT —— 重新跑 demo-up.sh"
  fi
  # 新事件/新 error 的 selector 必须在链上 bytecode 里出现（旧版不含）
  LIQ=$(cast keccak "LiquiditySold(address,uint256,uint256,uint256,uint64)" 2>/dev/null | cut -c3-10)
  INSLIQ=$(cast sig "InsufficientLiquidity(uint256,uint256,uint256)" 2>/dev/null | cut -c3-10)
  if echo "$LIVE" | grep -qi "$LIQ"; then ok D0a "链上含 LiquiditySold topic($LIQ)"; else bad D0a "链上无 LiquiditySold —— 部署的是 A11b 之前的旧版"; fi
  if echo "$LIVE" | grep -qi "$INSLIQ"; then ok D0b "链上含 InsufficientLiquidity($INSLIQ)"; else bad D0b "链上无 InsufficientLiquidity —— 同上"; fi
  echo "        demo env: VAULT=$VAULT  RPC=$RPC_URL  deployBlock=$(grep -E '^DEPLOY_BLOCK=' "$ENVF" | cut -d= -f2)"
fi

hdr "E6c-d. 前端 getLogs 必须分块（anvil fork 上游硬限 200 块）"
HIST=$FE/lib/history.ts
ENVF2=/tmp/alphaplan-demo-env
if [[ ! -f "$HIST" ]]; then
  skip E6c-d "无 lib/history.ts"
else
  # 1) 代码里是否有分块循环
  if grep -qE 'CHUNK|chunk|for *\(.*fromBlock.*toBlock|PAGE_SIZE' "$HIST"; then
    ok E6c-d1 "history.ts 有分块循环"
  else
    bad E6c-d1 "history.ts 未分块：一次性 getLogs(deployBlock→latest)，跨度 >200 时上游必拒（error -32614）"
  fi
  # 2) 区间过大与网络错误是否分开报
  if grep -qiE 'limited to|32614|range' "$HIST"; then
    ok E6c-d2 "区分了「区间过大」错误"
  else
    bad E6c-d2 "未区分「区间过大」与网络错误 —— 代码问题会被伪装成环境问题"
  fi
  # 3) 真打一次大跨度 getLogs，看 RPC 会不会拒（用部署块→latest）
  if [[ -f "$ENVF2" ]]; then
    eval "$(grep -E '^(VAULT|RPC_URL|DEPLOY_BLOCK)=' "$ENVF2")"
    N=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null)
    if [[ -n "$N" && -n "${DEPLOY_BLOCK:-}" ]]; then
      SPAN=$((N - DEPLOY_BLOCK))
      # 关键：跨度小时它本来就会通过，所以「现在能过」不等于代码对。
      # 判据要能回答"环境跑久了会不会红"：直接测 300 块（>上游 200 限），
      # 这才反映真实上限，与当前 deployBlock 无关。
      # 探测的是**会不会被拒**（看 error / 退出码），不是**有没有结果**。
      # 两者必须分开：区间内无事件 → 空数组 + 退出 0（正常）；区间超限 → error + 退出非 0。
      # 实测（14:11）：空结果 exit=0，超限 exit=1，且区间内**确有事件**时仍 exit=1。
      # d3 测的是**环境上限**（上游 200 块），不是代码正确性 ——
      # 永远红会变噪音、噪音淹没真问题。所以三档：
      #   span > 200      → FAIL（此刻历史区就是坏的）
      #   span 距 200≤50  → WARN（马上要坏，必须看得见）
      #   其余            → INFO（只报告，不污染失败列表）
      LIMIT=200; MARGIN=$((LIMIT - SPAN))
      if [[ "$SPAN" -gt "$LIMIT" ]]; then
        bad E6c-d3 "span=${SPAN} > ${LIMIT}，历史区此刻已经无法读取"
      elif [[ "$MARGIN" -le 50 ]]; then
        warn E6c-d3 "span=${SPAN} 块，距 ${LIMIT} 上限只剩 ${MARGIN} 块 —— 超过后页面历史区会空白"
      else
        info E6c-d3 "上游 getLogs 限 ${LIMIT} 块；当前 span=${SPAN} 块（距上限还有 ${MARGIN} 块）"
      fi
      # 独立报告"上游真实上限"，与当前 span 无关（防止跨度过小时误判为无限制）
      PROBE_FROM=$((N - 300))
      PROBE_OUT=$(cast logs --address "$VAULT" --from-block "$PROBE_FROM" --to-block "$N" --json --rpc-url "$RPC_URL" 2>&1)
      PROBE_RC=$?
      if [[ $PROBE_RC -ne 0 ]] || echo "$PROBE_OUT" | grep -qiE 'limited to|32614|32603|Fork Error|range'; then
        info E6c-d3b "上游实测硬限 200 块（300 块探测被拒 rc=${PROBE_RC}）—— 与当前 span 无关"
      else
        warn E6c-d3b "300 块探测未被拒（rc=0）—— 上游限制与预期不同，需人工确认"
      fi
      # 单独报告：演示可用倒计时（span 距 200 还有多少块）
      if [[ "$SPAN" -lt 200 ]]; then
        printf '        注：当前 span=%s 块 < 200，暂时能跑；但 anvil 只增不减，到 200 块就会空白（约 %s 个空块后）\n' "$SPAN" "$((200 - SPAN))"
      fi
    fi
  fi
fi

hdr "D/E. 前端 (src/frontend/alpha-plan)"
if grep -q 'Get started by editing' $FE/app/page.tsx 2>/dev/null; then
  bad E1 "app/page.tsx 仍是 Next 默认模板"
elif [[ $FULL -eq 1 ]]; then
  if (cd $FE && pnpm build >/tmp/qa-fe-build.log 2>&1); then ok E1 "pnpm build"; else bad E1 "pnpm build（/tmp/qa-fe-build.log）"; fi
else
  skip E1 "--full 才跑 pnpm build"
fi

hdr "F. 文档 / 密钥"
if [[ -f README.md ]]; then
  if grep -qiE 'anvil.*fork|本地.*anvil|fork.*anvil' README.md && grep -qiE '公共|BaseScan|sepolia.*无代码|no code' README.md; then
    ok F1g "README 声明了「本地 anvil fork，公共链上无代码」"
  else
    bad F1g "README 未声明链是本地 anvil fork / 公共 Base Sepolia 上该地址无代码（F1g）"
  fi
  # F1a 判「实质三要素」，不判某个词 —— 上一版只 grep '保真度'，
  # 而正确写法是「L1/L2，不是 L3」，于是真通过了却判 FAIL（假红，我自己踩的）
  H40=$(head -40 README.md)
  F1A_OK=1
  echo "$H40" | grep -qE 'L1/L2|L1.*L2|不是 L3' || F1A_OK=0
  echo "$H40" | grep -qE 'DON 不会真的定时执行|DON 不会真的'  || F1A_OK=0
  echo "$H40" | grep -qE 'Deploy Access'                    || F1A_OK=0
  if [[ $F1A_OK -eq 1 ]]; then
    ok F1a "README 前 40 行含 L1/L2≠L3 + DON 不会定时执行 + Deploy Access"
  else
    bad F1a "README 前 40 行缺保真度横幅要素（L1/L2≠L3 / DON 不会定时执行 / Deploy Access）"
  fi
  # 只数「诚实边界」这一节内的编号条目（到下一个 ### 或 ## 截止），别把后面
  # 「demo 环境三个技术事实」那节的 1./2./3. 也算进来（那会让 8 条漏成"11 条通过"）
  # 必须锚定到**标题行**（^#{2,6} 且含「诚实边界」）。
  # 上一版用 /诚实边界/ 匹配任意行，被正文里的锚点链接「[诚实边界](#…)」抢先触发，
  # 于是立刻遇到下一个标题就 exit，BODY 恒为空 → 恒判 0 条（假红，我自己踩的）
  BODY=$(awk '/^#{2,6}[[:space:]].*诚实边界/{f=1;next} f&&/^#{2,6}[[:space:]]/{exit} f' README.md)
  N=$(echo "$BODY" | grep -cE '^[0-9]+\. \*\*')
  if [[ "$N" -eq 8 ]]; then
    ok F1b "§9 诚实边界恰 $N 条"
  elif [[ "$N" -gt 8 ]]; then
    bad F1b "§9 有 $N 条（PRD §9 是 8 条；多出的是别的节被算进来了，或新增了未申报的边界）"
  else
    bad F1b "§9 只有 $N 条（要求 8 条）"
  fi
fi
git ls-files | grep -qE '^\.env' && bad F4 ".env* 有入库" || ok F4 ".env* 未入库"
# F4b 机械检查只能抓「高信号」模式：64 hex 它自己分不清是哈希还是私钥
# （planHash / promptTemplateSha / keccak256() 都是 64 hex，按形状扫必误报）
ZK='0x0{64}'
SUSP=$(git ls-files -z src 2>/dev/null | xargs -0 grep -nEi '(--private-key[[:space:]]+|(PRIVATE_?KEY|SECRET[_-]?KEY|MNEMONIC)[A-Z_]*[[:space:]]*[=:][[:space:]]*["'"'"']?)0x[0-9a-fA-F]{64}' 2>/dev/null \
  | grep -vEi "$ZK" | grep -v node_modules || true)
[[ -z "$SUSP" ]] && ok F4b "无 PRIVATE_KEY/SECRET/MNEMONIC 形式的 64 hex（已排除全 0 占位）" || { bad F4b "疑似私钥/密钥入库"; echo "$SUSP" | head -5; }
INFO=$(git ls-files -z src 2>/dev/null | xargs -0 grep -cE '0x[0-9a-fA-F]{64}' 2>/dev/null | grep -v ':0$' | grep -v node_modules | wc -l | tr -d ' ')
[[ "$INFO" -gt 0 ]] && echo "       注：$INFO 个文件含 64-hex 串（绝大多数应为 planHash/promptTemplateSha，人工抽查即可）"

hdr "R. 渲染层闸门（需要 ego-browser + 页面在跑）"
if ! command -v ego-browser >/dev/null 2>&1; then
  skip R "ego-browser 未安装"
elif ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:3000/ 2>/dev/null; then
  skip R "3000 端口无响应（pnpm dev 未起）"
else
  # 渲染闸门是独立脚本（用 ego-browser nodejs 跑）；退出码直接传导
  RG=$ROOT/.qa/render-gate.mjs
  if [[ -f "$RG" ]]; then
    if ego-browser nodejs -e "await import('file://$RG')" >/tmp/qa-render.log 2>&1; then
      ok R "渲染闸门通过（详见 /tmp/qa-render.log）"
    else
      # 把渲染闸门的失败项拉进主汇总，而不是只说一句"失败"
      while IFS= read -r line; do
        case "$line" in
          *FAIL*) bad "R:$(echo "$line" | awk '{print $2}')" "$(echo "$line" | cut -c11-)" ;;
          *SKIP*) info "R:$(echo "$line" | awk '{print $2}')" "$(echo "$line" | cut -c11-)" ;;
        esac
      done < <(grep -E '^  (FAIL|SKIP)' /tmp/qa-render.log)
    fi
  else
    skip R "无 .qa/render-gate.mjs"
  fi
fi

hdr "汇总"
printf '  PASS %d   FAIL %d   WARN %d   SKIP %d   INFO %d\n' "$PASS" "$FAIL" "$WARN" "$SKIP" "$INFO"
if [[ $WARN -gt 0 ]]; then
  printf '\n\033[33m警告项（不算失败，但接近出问题）\033[0m\n'; printf '  ! %s\n' "${WARNED_ITEMS[@]}"
fi
if [[ $FAIL -gt 0 ]]; then
  printf '\n\033[31m失败项\033[0m\n'; printf '  - %s\n' "${FAILED_ITEMS[@]}"; exit 1
fi
exit 0
