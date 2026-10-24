# 验收清单 — AlphaPlan

验收工程师（reviewer）维护。依据：`docs/PRD.md` §12 + `docs/PLAN.md` P0–P6（**2026-10-24 收敛版**）。
**每一项都必须能被一条命令复现**；不能复现的一律判 FAIL，不接受"看起来对了"。

机械部分跑 `.qa/verify-mechanical.sh`（约 10 秒，无需网络）。判据只有三档：
**PASS**（命令 + 期望输出都对上）、**FAIL**（文件:行 + 期望 vs 实际）、
**SKIP**（前置未就绪，写明缺什么）。不存在"基本通过"。

> **v2 变更（对齐 PRD/PLAN 收敛版）**：A5 拆成 a/b/c（11 行逐条）、A9 改为仓位上限截断、
> A13 常量表去 `MIN_CASH_BPS` 加 `MAX_PLAN_AGE`、A15 报告 ABI 6 字段、
> A14 增加 `PlanRecorded`、A10 扩展到多周期、新增 A16（`planUsed`）/A17/A18、
> B9（model 三字段）/B10（prompts 入库）/B11（serializePlan 往返）/B12（degraded 精确值）/
> **v2.1 变更（planner 文档修正后，2026-10-24 12:3x）**：§2.5 新增本轮 docs 验收记录；
> B7/B10/D6 的 `cast keccak` 命令加 `0x` 前缀并加 canary 自检；A10b/A10c 写入具体期望数值；
> A5a 措辞对齐 PLAN P1.5「10 revert + 1 正常路径」；§0 基线刷新；陷阱 8 新增 `cast keccak` 前缀。
>
> **流程规则（本轮加的，因为我自己踩了）**：报 FAIL 前必须**当次重跑**该命令并把时间戳写进报告。
> 我把 11:58 的编译错误报成 12:10 的结论，而文件在 12:00–12:02 已修好 —— 工人差点去修一个不存在的错。
> 快照一律标注采集时间；`FAIL` 不带当次输出 = 无效。
>
> **v2.23（16:07 采集）**：hydration mismatch 两层修复实测 **0**（含切 5 屏压力）；术语表/文案/两个格式化 bug 边界测试通过（§2.26）；
> 发现 `use-is-client.ts` 注释「两个分支输出必须不同」写反（仅文档）。闸门 **PASS 54 / FAIL 0**。
>
> **v2.22（15:45 采集）**：B3 修法（content-addressed 存档）我独立验证通过（8/8 文件名==hash，13 份全 OK）；
> 修我自己的第 10 例（B9b 锚定源码字面量）；**B1 是真问题但根因是 typescript@7 + @types/node**（§2.25）。
>
> **v2.21（15:40 采集）**：**DEPLOY_BLOCK 需用链上事实反推**（二分得 49522615，我上轮误信配置文件）；
> E2/E3/E4/E6b/E6c-1 全 PASS；**B3 FAIL = prompts 改写让 8 份历史计划永久不可校验**（§2.24，动摇核心卖点）。
>
> **v2.20（15:10 采集）**：E3 修复成立（15:07:58 实测 1000/−1000/同源），**但 15:08 环境被重置**（DEPLOY_BLOCK→49519398，lastNonce 0）→ 最终结论记 **SKIP**（§2.23）。
>
> **v2.19（15:02 采集）**：E4 修好（两格分开）；**E3 仍 FAIL** —— 同一页里辩论卡读 06:50:32Z、哈希卡读 06:49:13Z（§2.22）；
> 我自己的第 9 例：`textContent` 不穿透嵌套 shadowRoot，误报 modal 为空（已改递归探测）。
>
> **v2.18（14:55 采集）**：D7 反重放两条实测通过（`BadNonce(2,1)` / `PlanAlreadyExecuted`，状态无残留）；
> E6b/E6c-1 PASS；**E3/E4 FAIL 根因是环境里有两份计划文件**（§2.21，P2 数据卫生问题，不是前端 bug）。
>
> **v2.17（14:49 采集）**：换端口复核完成；修掉我自己的 R3 假绿（改成 通过/失败/未采集 三态，§2.20）；
> 发现块时间差 −41s 且扩大（演示前需 mine）。闸门 **PASS 53 / FAIL 0**。
>
> **v2.16（14:46 采集）**：**换端口 8546 + 全新环境**（DEPLOY_BLOCK 49512360，lastNonce 0，全现金）。
> 7 项复核一致；实测块时间比墙钟慢 41s 且持续扩大（§0）。事务类判据（E3/E4/E6b/E6c-1/D3/D7）因无历史事件暂 SKIP。
>
> **v2.15（14:43 采集）**：两个合约修复经**正反验证**成立（改回旧逻辑对症用例立刻失败）；
> 但 `Probe*.t.sol` 让 `forge test` 永远红 → A4 FAIL（§2.19）。正式套件 74 passed。
>
> **v2.14（14:42 采集）**：E7b 扩为三条（含 `eth_getCode` 探测法）；注入桩被真 MetaMask 覆盖（§2.18），
> 但探测法已用真钱包验证有效；发现 w3m-modal 为空待 frontend 确认。
>
> **v2.13（14:38 采集）**：四个 FAIL 全部修复（§2.17），三处修法优于我的建议；E 线回归 **17/17 PASS**；渲染闸门已接入主流程，
> 全量 **PASS 53 / FAIL 0**。仅剩 E7a/E7b/E7c 卡在「需真实连一次钱包」。
>
> **v2.12（14:33 采集）**：E7 判据作废并重写为 E7a/b/c（PM 裁定）；新增**渲染层闸门** `.qa/render-gate.mjs`（R1a/R1b/R2/R3/R4/R5）；
> 实测首屏只显示骨架（§2.16），并发现它正是 E2 失败态验不到的根因。
>
> **v2.11（14:16 采集）**：E 线验收完成（§2.15）；d3 改 INFO/WARN/FAIL 三档并三档正反验证；
> 发现文案错误 `PlanCommitted`（合约无此事件，2 处）待修；E2 失败态判 SKIP（dev 缓存挡住）。
>
> **v2.10（14:11 采集）**：环境重建（DEPLOY_BLOCK 49500223）已复核 7 项全一致；E6c-1 按**净额口径**放宽并实跑闭合；
> E6c-3③ 快照错位负向实做（差额 17,000,000）；E6c-d 探测逻辑改为**看 error/退出码**而非看有无结果（§2.14）。
>
> **v2.9（14:09 采集）**：前端已大规模落地并**主动 review**；发现 `eth_getLogs` 200 块硬限导致历史+对账必然空白（§2.13）；
> E6c-1..3 记 SKIP 而非 PASS。已提交 7d8e805（82 files，contract 71 + backend 90 tests 全绿）。
>
> **v2.8（13:02 采集）**：**闸门全绿 PASS 50 / FAIL 0 / SKIP 2**。F1a 改判实质三要素、F1b 改锚定标题行，
> 两者均做正反验证（§2.12，累计 6 个判定逻辑 bug）。README 顶部横幅 + §9 恰 8 条 + 小数脚注 + 命令注意事项均已核实。
>
> **v2.7（12:53 采集）**：E6c-1 再修一处**我自己的判据缺陷** —— `to==vault` 的 Transfer 会把 `Deposit` 一笔存款算两次（§2.11 实测）；改为「Transfer 只能来自已归类为 swap 的 tx」。E6c-3 增到 4 条负向。
>
> **v2.6（12:52 采集）**：E6c-1 改**差分形式** `balance(N) − balance(deployBlock−1)` + **快照一致性**（三处同用一个 `N`）+ UI 显示两个端点块号。
> 期初余额陷阱已实测复现（§2.10）。
>
> **v2.5（12:46 采集）**：E6c 拆成 **E6c-1 硬对账（含 Deposit/Withdraw）/ E6c-2 解释层（不得显示通过-不通过）/ E6c-3 两条负向**；
> 新增 `E1b`（P1 直连，RPC 不可达是预期）、`F1g`（README 必须声明本地 anvil fork）。
>
> **v2.4（12:44 采集）**：planner 三条裁定落盘，A11b/A11e 口径复验通过；新增 `A11g`（预检不白跑 swap）、
> `A11d` 断言三参数 error。新增 **D 线部署闸门**：链上 bytecode 必须与本地 artifact 一致（排除 immutable 占位）。
>
> **v2.3（12:42 采集）**：A11b/A11e 三条口径经 PM 裁定固化（n∈[1,4]、首笔 ceilDiv、补卖上界、剩余 ∈[0,3] wei、minOut 逐笔）。
>
> **v2.2（12:41 采集）**：新增 `E6b`/`E6c`（两条流 + 对账小结，PM 指派）、`A14q`/`A14r`（`LiquiditySold`）、
> `A11f`（`maxRedeem` 保守回退）；`A11` 加严为「paused 下自动卖路径也必须成功」。合约侧 12:41:08 实测 **69 passed / 0 failed**。
>
> **假绿比漏检严重**（12:10 抓到的实例）：A14 曾用「硬编码旧签名 + `grep` 事件名」判定，
> 合约加 `asOf`/`validUntil` 后脚本仍打 PASS 并显示旧 topic0。现已改为**从 ABI 抽签名算 topic0**，
> 并做了负向测试（把期望改回旧签名 → 必须 FAIL 并打印源码 vs 期望）。**判定逻辑本身也要被验证。**

---

## 0. **当前环境（2026-10-24 15:38 采集，lastNonce=3）**

```
VAULT_ADDRESS = 0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b
DEPLOY_BLOCK  = 49522615      ← 二分法实测确认
RPC_URL       = http://127.0.0.1:8545
CHAIN_ID      = 31337
```

**`DEPLOY_BLOCK` 用二分法独立验证**（不是抄 PM 的）：

```
先确认 49519398（PM 说错的）→ cast code = 3 B（无代码）
二分找「最小有代码的块」→ 49522615
```

**为什么 49519398 是错的**：anvil 每次重启都从上游重新 fork，**块高整体平移** ——
同一个合约在不同 anvil 实例上的块号完全不同。49519398 是**旧实例**上的首块。

**链上实况（15:38:27）**：`chainId 31337` / latest 49,522,635 / code 39,981 B /
`totalAssets` 10,441,829 / `totalSupply` 10,000,000 / `lastNonce` 3 /
`currentWethBps` 3719 / `lastPlanHash 0x4da387ae…dea367`

**8788 已修（503 → 200）**：
`x-plan-file: 2026-10-24T07:34:51Z.json`、`latestReason: "onchain"`、`onchain: nonce=3 target=4000 execs=3`

> **503 的真实根因**（PM 查明）：`serve-plans.ts` 启动时必须有 `VAULT_ADDRESS`，
> 否则拒绝启动（设计如此，不允许静默退化成"取最新文件"）；
> 而 `bun src/serve-plans.ts` **不会自动加载 `.env`** —— 进程起来了、env 是空的 → 每请求 503。
> 修法：显式传 env 启动。

#### 链上三条执行记录 —— **只有 nonce=1 是真 swap**

```
nonce=1  PlanExecuted  target=15.00% actual=14.96%  usdcIn=3.0000
nonce=2  PlanRecorded  target=35.00% actual=37.13%  （容差内未调仓）
nonce=3  PlanRecorded  target=40.00% actual=37.19%  （容差内未调仓）
```

**这条必须说清楚**：`PlanRecorded` 是「通过门禁但容差内不调仓」，**不是执行了交易**。
如果把它当成"执行了"，就等于宣称了一个没发生过的动作。

#### `currentWethBps` 从 14.96% 涨到 37.19% 的原因：**不是 swap，是现金变少**

```
当前 WETH = 809,095,192,231,808 wei（只在块 49522620 买入过一次，此后未变）
当前 cash = 6,558,173（6.5582 USDC）
WETH 估值 = 3,883,656（feed $4,800）
两者和   = 10,441,829 == 链上 totalAssets ✅
重算 bps = 3719 == 链上 currentWethBps ✅
```

仓位占比上升是因为 **cash 被赎回/费用吃掉、NAV 变小**，WETH 价值不变而分母变小。
**这正是 PRD「40% 现金不是不变量」的实证** —— 不变量在调仓那一刻成立，之后会被价格和赎回改变。

---

## 0. **当前环境（PM 重建 + onReport，2026-10-24 14:11 采集）**

```
VAULT_ADDRESS = 0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b
DEPLOY_BLOCK  = 49500223      ← 已从 49478393 重建
RPC_URL       = http://127.0.0.1:8546
CHAIN_ID      = 84532
N (采集时)     = 49500228
```

**PM 报的 6 项，我逐个独立复核，全部一致：**

| 项 | 链上实测 | PM 报的 |
|---|---|---|
| `totalAssets` | 19 990 733 | 19,990,733 ✅（注：PM 写 19,990,733，我读到 19990733） |
| `totalSupply` | 20 000 000 | — ✅ |
| USDC cash | 17 000 000 | 17e6 ✅ |
| WETH | 809 095 192 231 808 | — ✅ |
| `currentWethBps` | 1496 | 1496 ✅ |
| `lastNonce` | 1 | 1 ✅ |
| `PlanExecuted` 条数 | 1（tx `0xd33bfb3b…`, blk `0x2f35044`） | 1 条 ✅ |

**E6c-1 在新环境上两条平衡式均闭合（差分净额口径，与前端实现同款）：**

```
USDC: balance(49500228) − balance(49500222) = 17 000 000 == Transfer.in − Transfer.out = 17 000 000  ✓
WETH: balance(49500228) − balance(49500222) = 809 095 192 231 808 == 同值                              ✓
```

**E6c-3③ 快照错位负向测试已实做（14:11:37，只读 + 一个空块）：**

```
事件终点用 toBlock=49500224，余额读 latest=49500229
  同一 N  → balance(49500224)−balance(49500222) = 0        == flows 0        ✓ 闭合
  错位    → balance(49500229)−balance(49500222) = 17 000 000 vs flows 0     ✗ 差 17,000,000
```

→ 快照一致性**不是巧合**：一旦 `balanceOf` 用 latest 而 `getLogs` 用 `toBlock`，
差额立刻等于期间那笔存款全额。这条负向测试能红，说明前端的「一个 N 用到底」是真做到的。

> 注：为制造"新块已产生"的条件，我 `cast rpc anvil_mine` 挖了 **1 个空块**（无交易、不改任何状态、
> 不触发 redeem/accrueFee）。这属于只读纪律的边界，记录在此以便 PM 核对。

---

## 0. **锁定环境（PM 冻结，2026-10-24 12:53，块 49478398）**

```
VAULT_ADDRESS = 0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b
DEPLOY_BLOCK  = 49478393
RPC_URL       = http://127.0.0.1:8546
CHAIN_ID      = 84532
```

**我逐项独立复核（只读，未写链）× 8 项，PM 报的全部一致：**

| 项 | 链上实测 | PM 报的 | |
|---|---|---|---|
| `totalAssets` | 19 980 933 | 19,980,933 | ✅ |
| `totalSupply` | 20 000 000 | 20,000,000 | ✅ |
| USDC cash | 14 000 000 | 14,000,000 | ✅ |
| WETH | 1 618 046 181 452 145 | 同 | ✅ |
| `currentWethBps` | 2993 | 2993 | ✅ |
| `maxRedeem` | 14 013 359 | 14,013,359 | ✅ |
| 含 `LiquiditySold` topic | YES | ✓ | ✅ |
| 含 `InsufficientLiquidity` sel | YES | ✓ | ✅ |

附加复核（PM 没要求，但这是验收要用的）：
- **自洽性**：`WETH×price/1e20 = 5 980 933`，`+ cash 14 000 000 = 19 980 933 = totalAssets` ✅；
  重算 bps = `5 980 933×10000/19 980 933 = 2993` = 链上值 ✅
- **`maxRedeem` 保守回退**：`convertToShares(14 000 000) = 14 013 359` = `maxRedeem`，且 `< totalSupply` ✅
- **部署闸门 D0**：链上 bytecode == 本地 artifact（排除 672B immutable 占位）✅
- **E6c-1 在锁定状态上闭合**：端点 `49478392 → 49478398`，同一个 `N`
  `ΔUSDC = 14 000 000 = 20 000 000 − 6 000 000`，`ΔWETH = 1 618 046 181 452 145 = wethReceived`，**两条差均为 0** ✅
- **旧地址 `0x6ee38cdf…`**：code=3B（空），已不在环境中 ✅
- **只有一个 anvil**（`:8546`）、一个 env 文件 ✅

**E 线现状（12:54:16 采集）**：`vault/debate/history/self-verify` 四个 section **仍是 `<Pending>` 骨架**，
只有 `workflow.tsx` 有实现 → E2/E3/E4/E5/E6/E6b/E6c-1..3 全部 **SKIP**（未交付），不判 FAIL。

> **纪律**：锁定后我只读。上表任何一项若在后续验收中被改动，先报 PM，不自行处理。
> 需要写链的验收项（D3/D7/A11b 端到端）必须 PM 重新协调，不能由我单独触发。

---

## 0. 当前基线（快照采集于 2026-10-24 12:3x，main @ 22fb260，工作区未提交）

| 区域 | 状态 |
|---|---|
| `src/contract` | `forge build` **PASS**；`forge test` **59 passed / 0 failed**（采集 12:12:54）；事件已为 9/7 字段（带 `asOf`+`validUntil`） |
| `src/backend/src/schema.ts` | B5 已分域（target 6000 / observed 10000）、`degraded` 必填、`DEFAULT_VALIDITY_SECONDS = 900`、`serializePlan` 已含 model 三字段 |
| `src/backend/prompts/` | 4 个模板齐全，哈希与 PRD §7.2 参考值**逐个吻合**（见 §2.5） |
| `src/backend/plans/` | 已有 `2026-10-24T03:00:00Z.json` |
| `src/backend/src/verify.ts` | 仍 `exit 1` 脚手架 → P4 未开工（B6 FAIL） |
| `src/backend/cre/` | 不存在 → C 线 SKIP |
| `src/frontend/alpha-plan` | 仍是 Next 默认模板 → E 线 FAIL |
| 根 `README.md` | 无顶部横幅、无 §9 → F1a/F1b FAIL（P6 未开工） |

**机械快照（采集 2026-10-24 12:41）**：`forge test` **69 passed / 0 failed**（含 A11b–A11e 全部 9 条）。
A11b–A11e **已可执行且合约侧测试齐全**（`test_A11b_AutoSellsExactlyShortfall` / `_EnoughCashNeverTouchesRouter` / `_WithdrawPathAlsoAutoSells`、`test_A11c_MaxWithdrawAndMaxRedeemCappedByCash`、`test_A11d_RevertsWithCustomErrorWhenWethCannotCover`、`test_A11e_MinOutIsExactWithSlippageBps` / `_PoolUnderfillsMinOutReverts` / `_AmountOutEqualToMinOutStillSucceeds`、`test_A11_PausedAutoSellStillWorks`）。
**E6b/E6c 初始状态 SKIP**：`app/_sections/history.tsx` 仍是 `<Pending>` 骨架，没有两条流也没有对账 — 前端实现未交付，判 SKIP 不判 FAIL。
脚本 `PASS 32 / FAIL 5 / SKIP 3`（A14p + B6 + F1a/F1b 未变）。
**A11b–A11e 四项尚不可执行**：契约里没有 `_withdraw` override，也没有 `InsufficientLiquidity` 类 error —— contract-worker 还没落地。
脚本 `PASS 32 / FAIL 5 / SKIP 3`（A14p + B6 + F1a/F1b 未变）。
`A14p`（PRD §5 事件声明仍是旧 7/5 字段，合约已 9/7）、`B6`（verify.ts 脚手架）、`F1a`/`F1b`（README 未写）、
`A4` 已能用 `--full` 跑（12:12:54 采集：**59 passed / 0 failed**）。
3 个 FAIL 全是未开工项：`B6`（verify.ts 脚手架）、`F1a`/`F1b`（README 未写）。
A 线 14 项、B 线 13 项已可机械复核。

已独立用 `cast` 复核（不是抄 PRD）：chainId 84532、USDC 6 / WETH 18、ETH/USD 2382.45@8dec、
BTC/USD 80863.51、USDC/USD 0.99987（age ≈18.6h，符合 86400 心跳）、`router.factory()` 一致、
池子 liquidity 4.48e11 / 5.52e14、两个 forwarder 均有代码。**PRD §10 表格全部成立。**

---

## 1. 判定口径：什么叫 A5 的"逐条对得上"

PRD §5 的校验表有 **11 行**，但它们**不是同一种东西**：

| 行 | 性质 | 怎么测 |
|---|---|---|
| 1–10 | **revert**（fail-closed） | `vm.expectRevert` × 10 |
| 11 | **分支**（不 revert，只记录） | `expectEmit PlanRecorded` + `router` 零调用 + `nonce++` + `planUsed=true` |

所以判据是：**10 个独立 `vm.expectRevert` + 1 个 `PlanRecorded` 分支断言**，
而不是"11 个 expectRevert"。PRD §5 第 11 行不存在 revert 路径，
PLAN P1 第 5 步写成"11 条各一个 `vm.expectRevert`"是**不可能的**（见 §2 发现 1）。

`asOf` 的两条（PRD §5 第 5、6 行）是**闭区间**：
`asOf == now` 通过、`asOf == now+1` revert；`asOf == now−3600` 通过、`asOf == now−3601` revert。

---

## 2. 我的独立复核结论（PM 要求"不要信我"的部分）

### 2.1 PM 声称已改的 5 处 —— 逐条核对

| # | PM 的说法 | 核对结果 |
|---|---|---|
| 1 | A5 8 条 → 11 条 | **成立**。PRD §5 表格确为 11 行（sender/vault/paused/MIN_INTERVAL/asOf≤now/asOf 年龄/validUntil/nonce/≤6000/planUsed/容差）。但编号口径要按 §1 修正：**10 revert + 1 分支**。 |
| 2 | A9 现金下限 → 仓位上限截断 | **成立，且删得有道理**。`MIN_CASH_BPS` 数学上恒不生效：买入量 = `desired − current`，买入后现金 = `total − desired`，而 `desired ≤ 0.6·total`，故现金 ≥ `0.4·total`。它是一行永不触发的代码，留着会误导读者以为有两道保险。 |
| 3 | A13 去 4000 加 3600 | **成立**。PRD §5 常量体现在是 8 个：6000 / 300 / 5000 / 50 / 60 / 3600 / 10 / 30d，无 4000。 |
| 4 | A15 ABI 加 asOf | **成立**。`(address vault, uint64 asOf, uint64 validUntil, uint64 nonce, uint16 targetWethBps, bytes32 planHash)`，6 字段，asOf 在 vault 之后。 |
| 5 | B 线加 B9(model) / B10(prompts 入库) | **成立**。PRD §7.2 三轮 + `final` 各有 `model` / `promptTemplateSha` / `temperature`（共 12 个字段），且 PLAN P2 要求 `prompts/{bull,bear,risk,judge}.txt` 入库。 |

### 2.2 PM 没列、但这次改版新增的（我补进判据）

`planUsed` 映射（A16）、`PlanRecorded` 事件（A14）、费率多周期语义（A10b/c/d）、
`degraded` 前置门（B12/C10）、verify 与徽章的第二层时效校验（D8/E4）、README 顶部横幅（F1a）、
`currentWethBps` 可观测超过 6000（A18）。**PM 的变更清单不完整**，只照那 5 条改会漏 7 项。

### 2.3 文档自身不一致（需 planner 处置，不是代码问题）

1. **PLAN P1 第 5 步**："11 条各一个 `vm.expectRevert`"—— 第 11 行是分支不是 revert；
   而它列举的 11 项实际是"10 个 revert + 正常路径"，**漏掉了容差分支**。
   → 建议改为"10 个 `vm.expectRevert` + 1 个 `PlanRecorded` 分支"。
2. **PLAN P1 第 6 步**最后一句"断言 `MAX_PLAN_AGE >= plan.validitySeconds`"—— **在 forge 测试里实现不了**：
   合约看不到计划文件，"900 ≤ 3600" 只能在后端（B13）与 verify（D8）里断言。
   forge 侧只能断言 `MAX_PLAN_AGE == 3600` 常量本身。
3. **PLAN P1 第 11 步 / PRD §3.4**："按 `totalSupply` 计价，所以临时存入不影响收费金额"—— **算错了**。
   `feeShares = totalSupply × 0.1% × periods`；期内存入 100×，`totalSupply` 就变大，
   **绝对费用也等比变大**（不是"不影响"）。真正不变的是**每位老持有人每期被稀释恰 0.1%**。
   → 该测试项若按原文写，只有**实现错了才能通过**（见 A10c）。
4. **PLAN P1 第 11 步**："断言不复利：90 天一次调用与分三次调用，最终份额数相同"—— **不成立**。
   按文档公式：一次调用 `S(1+3×0.001) = 1.003000·S`；
   分三次 `S×1.001³ = 1.003003·S`。**相差 3.0e-6 相对误差**（因为每次都在已长大的 `totalSupply` 上再乘）。
   即：文档说"不复利"，公式**是**复利的（幅度极小）。二选一：改公式（以周期起点的 `totalSupply` 计价），
   或把断言改成"相对误差 ≤ 1e-5"（见 A10b）。

> 这 4 条我只上报，不改 `docs/PRD.md`、`docs/PLAN.md`。**代码侧我按"能真实成立"的版本判**：
> A10b 用容差断言，A10c 断言"老持有人稀释率不变"，两条都写明了理由。

### 2.4 F1 该不该收「降级不得上链」「validity 分层」—— 我的判断

**planner 的判断（不该进 F1）我独立验证后同意**，理由不是篇幅，而是**这三者在语义上不同**：

| 候选 | 是不是"诚实边界" | 判据（§9 每一项都在限制一个**对外承诺**） |
|---|---|---|
| 降级不得上链 | **不是**。它是**机制约束**：`degraded` 由 workflow 前置门执行，是本系统的行为规则。 | §9 的 8 条都是"我们不承诺/我们做不到/我们不是"；这条是"我们做了"。 |
| validity 主约束 / 兜底分层 | **不是**。它是**参数设计说明**，解释 900 与 3600 的优先级。 | 没有任何对外承诺因此被减弱；它是给实现者读的。 |

但有一处**值得补进 §9 第 3 条**（同样属"自述"边界，PM 未提）：`degraded` 也是**文件自述**——
手写一份 `degraded: false` 的计划文件，workflow 无法识别。这跟"`model` 是自述不是证明"同源。
我的建议是把一句话并进第 3 条，不新增第 9 条。**这属于建议，不改 PRD，也不影响 F1 判定**（F1 只数 8 条）。

### 2.7 `_ensureLiquidity` 的**补偿循环**与 A11b 判据冲突（需 planner/contract 裁定）

12:41 采集的 `src/contract/src/AlphaPlanVault.sol:425-480` 不是「卖一次刚好够」，
而是**最多 4 轮补卖**（第 1 轮按 oracle 价 `ceilDiv`，之后按 `SLIPPAGE_BPS` 放大并多加 2 个最小单位）。

这直接改动了我上一版 A11b 的判据，必须二选一：

| 判据 | 现状 | 按现有实现应为 |
|---|---|---|
| `router` 调用次数 | 我写「恰 1 次」 | **1 ≤ n ≤ 4**；且必须断言「池子按 minOut 足额成交时 n==1」 |
| `amountIn` | 我写「== `ceilDiv(shortfall*1e20, price)`」 | **第 1 笔**恰等于该值；补卖笔各自 ≤ 按 `SLIPPAGE_BPS` 放大的上界 |
| 卖出后 USDC 剩余 | 我写「恰为 0」 | **∈ [0,3] wei**（PM 已裁定改 PRD；补卖 `+2` 后零头上限 3） |

三条我不替你决定、但必须有人决定的：

1. ~~剩余可能超过 1 wei~~ → **已落盘并复验通过（12:44:38）**：`PRD.md:207` 现为 `[0, 3] wei`。
2. **`minOut` 在补卖轮次里是「按 oracle 算的 expectedOut×95%」，而实际会用满滑点。**
   于是前一轮 minOut 恰好卡死时，靠后续轮次补 —— 逻辑能收敛，但 A11e 的
   「`amountOutMinimum` 恰等于 `expectedOut*(10000-50)/10000`」只对**每一笔**成立，
   不能断言整个 redeem 只有一笔。
3. **gas 上界。** 4 轮 swap 意味着最坏 4 次池子交互；demo 里正常只有 1 次，
   但失败路径的 gas 需要在 README 或 §9 里说一句（赎回人付）。

> **PM 裁定（12:42）**：三条全部采纳我的判断 ——
> ① PRD 改 `[0,3] wei`（补卖 `want = deficit + 2` 两层 floor 的零头上限就是 3，是 PRD 写错，不是实现问题）；
> ② `minOut` 改逐笔断言；③ 最坏 4 次池子交互的 gas 写进 §9（由赎回人承担）。
> **A11b/A11e 按上述口径判。planner 的三条改动已于 12:44:38 复验通过：**
> `PRD.md:207` = `[0,3] wei`；`PRD.md:181–199` 补卖机制（4 轮、几何收敛、池子足额第 1 轮成功、
> 卖出额经济上界 `ceilDiv(shortfall×BPS×1e20/((BPS−50)×ethPrice))`）；
> `PRD.md:760` gas 上界（最多 4 次 swap，赎回人付）；`PRD.md:820–840` A11b 八条口径与我的判据逐条一致。
> 另外 planner 补了两条**我原来没写、但确实该有**的判据：
> `InsufficientLiquidity(uint256 required, uint256 cashAvailable, uint256 wethValue)` 三参数
> （PRD:194 ↔ `AlphaPlanVault.sol:136` 一致），以及「动手卖之前先预检 `cash + realizable < assets`
> 就 revert，不白跑一笔 swap」（PRD:198–199）——已固化为 **A11g**。

### 2.8 E6c 的两条恒等式：我按 ABI 核过数据源，**成立**（12:46:26 采集）

| 需要的量 | 数据源 | 核实结论 |
|---|---|---|
| `depositAssets` / `withdrawAssets` | `Deposit(address,address,uint256,uint256)` / `Withdraw(address,address,address,uint256,uint256)` | **两个事件都在 ABI 里**，直接可取 `assets`。frontend 的发现成立：漏了这两个，NAV 上涨会被算成收益 |
| `buy.usdcIn` / `sell.wethIn` | `PlanExecuted.usdcIn` / `.wethIn` | **在**，但语义是**投入量/卖出量**（`_rebalance` 第 360/384 行），不是到手量 |
| `buy.wethReceived` / `sell.usdcOut` | **不在 `PlanExecuted`**（ABI 只有 9 个字段，无此二项） | frontend 说的对：必须从**同 tx 的 `Transfer` 日志**取。`WETH(Transfer, to=vault)` 差额 = 到手 WETH；`USDC(Transfer, to=vault)` 差额 = 到手 USDC |
| `LiquiditySold.wethIn/.usdcOut` | `LiquiditySold(address,uint256,uint256,uint256,uint64)` | **在**，字段齐全，且是真实卖出量/到账量 |

> 补充（**已被 §2.9 的实测修正**）：这两条恒等式**不需要 Router 也不需要 Pool 地址** ——
> 只用 `topic0==Transfer` + `from/to==vault` 就够了。`ROUTER` 虽是 `public immutable`
> （`AlphaPlanVault.sol:57`）可以直接读，但**不要**用它来筛日志：我实测过，按 `to==ROUTER`
> 过滤会得 0（Router 转出的那一段 `to` 是池子）。详见 §2.9。

### 2.9 E6c-1 的恒等式：我用真实链上数据实算过，**并踩到两个坑**（12:47~12:48 采集）

我按 E6c-1 的两条式子对本地 anvil 逐笔复算：

```
ΣdepositAssets  = 20 000 000        ΣwithdrawAssets = 17 982 840
Σbuy.usdcIn     =  6 000 000        Σsell.wethIn    =          0
ΣLiquiditySold.usdcOut = 3 982 865  ΣLiquiditySold.wethIn = 1 080 035 453 240 393
当前 USDC = 25  → 25 == 20 000 000 − 17 982 840 − 6 000 000 + 3 982 865 + 0   ✅ 闭合
```

**USDC 等式一次就对上了** —— frontend 的判断成立：把 `Deposit`/`Withdraw` 放进算式后，
「存款被当成收益」的错解消失。**这条设计是对的。**

#### 坑 1（我自己先踩了，写下来免得 frontend 再踩）：`Approval` 也被算成 `Transfer`

tx `0x5a4f815d…` 里 WETH **有 4 条 `Transfer` + 2 条 `Approval`**，两组 `from` 都是 vault、
金额完全一样（`forceApprove` 先授权 Router，Router 再转给 Pool / 池子回调）。
我第一版按 `from==vault` 全量求和，得到 `2 160 070 906 480 786`，**正好是真值的 2 倍**。

| 我要求的取法 | 结果 |
|---|---|
| 只看 `topic0 == Transfer`（`0xddf252ad…`）且 `from==vault` | `1 080 035 453 240 393` ✅ 与 `LiquiditySold.wethIn` 一致 |
| 不看 `topic0`，只按 `from==vault` 求和 | `2 160 070 906 480 786` ❌ 差一倍 |

**所以 E6c-1 的第一条硬要求不是"用 Transfer 日志"，而是"先按 `topic0 == 0xddf252ad…` 过滤"。**
（`USDC 收到量` 同理：只看 `topic0==Transfer && to==vault`，得 `3 982 865`，与 `LiquiditySold.usdcOut` 一致。）

> 顺便纠正我上一版写的一句话：我原写「只计 `from==vault && to==vault.ROUTER()`」**是错的** ——
> 实测 Router 转出的那一段 `to` 是**池子**，不是 Router，按 `to==ROUTER` 过滤会得 0。
> 正确判据是 **`topic0==Transfer && from==vault`（卖出）/ `topic0==Transfer && to==vault`（买入）**，
> 不需要知道 Router 或 Pool 地址。这也解释了为什么这两条恒等式可以完全脱离 Uniswap 地址工作。

#### 坑 2：`Deposit` / `Withdraw` 的 `assets` 字段位置

两个事件的 `data` 只有 2 个 word（`assets, shares`），前两个参数是 indexed。
`cast` 打印时容易把 `topics[1]`（sender）当成金额。**判据里要写明：`assets = word[0]`，`shares = word[1]`。**

### 2.10 期初余额陷阱：frontend 的假红场景我复现了（12:52 采集）

frontend 说"不能假设期初余额为 0"，我拿**同一份链上数据、同一个 vault**，只换窗口起点，
复现了假红，第三行正好是它报告的那组数（`in==out==1,207,269,399` 那个窗口的邻居）：

| 窗口 `[start−1, latest]` | `in−out` | `balance(latest)` | `balance(start−1)` | 旧判据 `in−out==balance` | 新判据 `in−out==Δ` |
|---|---|---|---|---|---|
| `[49466693, 49466719]` | 13,854,462 | 13,854,462 | **0** | 闭合 | 闭合 |
| `[49466699, 49466719]` | −6,145,538 | 13,854,462 | 20,000,000 | **假红**（差 20,000,000） | 闭合 |
| `[49466713, 49466719]` | 853,615 | 13,854,462 | **13,000,847** | **假红**（差 13,000,847） | 闭合 |

只看第 1 行会得出"旧判据也没问题"的结论 —— **那正是我之前犯的错**：我采样的窗口期初恰好是 0。
第 3 行是这个地址上真实存在的窗口：期初 `13,000,847`，正好是 frontend 报的那个数。

**结论**：`Δ` 必须是 `balance(N) − balance(deployBlock−1)`，不能是 `0` 起算。

#### 快照一致性（frontend 提的这条也成立，而且是"随机假红"的来源）

如果先 `getLogs(toBlock=latest)`，再 `balanceOf()` 不带 blockTag（=最新块），两次读之间出了新块
（哪怕只是另一笔赎回），就会得到"事件覆盖到 N、余额读到 N+1"，差额非 0。
一条 60 秒的 cron 加上人工点赎回，很容易在演示时踩到。

**判据**：一次请求内先 `getBlockNumber() → N`，然后
`getLogs(fromBlock=deployBlock, toBlock=N)`、`balanceOf(..., {blockTag: N})`、
UI 上显示的 `latest` 也用这个 `N`。**三处必须同一个 N。**

> 验收方法：我会连点两次刷新，并在中间用 `cast send` 打一笔无关交易（比如 `accrueFee`），
> 对账必须仍然闭合；如果不闭合，就是没用同一个块号。

### 2.11 我自己给的恒等式有个真缺陷：`to==vault` 的 Transfer 会把存款算两次（12:52 实测）

在新地址上复跑 E6c-1 时，**USDC 恒等式差 `−23 982 865`**。追下去发现不是期初余额问题，
是我上一版口径的漏洞：

```
ΔUSDC(实际) = 25
ΣdepositAssets − ΣwithdrawAssets − Σbuy.usdcIn + Σsell.usdcOut + ΣLiquiditySold.usdcOut
            = 20 000 000 − 17 982 840 − 6 000 000 + 3 982 865 = 25        ← 对
但若把「所有 to==vault 的 USDC Transfer」当 sell.usdcOut：
            多算了 3 982 865 的 swap 到手 + 20 000 000 的存款          ← 差 23 982 865
```

`deposit(assets)` 会产生一条 `USDC Transfer(from=user, to=vault, 20 000 000)`，
而 `ΣdepositAssets` 已经从 `Deposit` 事件拿到同一个 `20 000 000`。**再把它当 swap 收入 = 一次存款记两笔。**

**这不是"实现要小心"，是我的判据错了。** 正确写法二选一：

| 做法 | 说明 | 风险 |
|---|---|---|
| **A. 按 tx 归类**（推荐） | 先 `groupBy(txHash)`：同一 tx 里有 `Deposit`/`Withdraw` → 归入存取款；有 `PlanExecuted`/`LiquiditySold` → 才去该 tx 的 `Transfer` 里取 swap 腿 | 需要一次 `groupBy`，逻辑稍绕 |
| **B. 按对手方归类** | swap 腿对手方是 Router/Pool，存取款对手方是用户地址；用 `Transfer.from ∉ {user 集合}` 过滤 | 需要地址集合，用户多了就脆 |

**推荐 A**：不依赖任何地址，且与"每个 Transfer 只属于一个语义口袋"的直觉一致。

> 实测记录（12:51~12:53，环境在换、数值会漂，方法不变）：新地址复跑时
> `ΔUSDC=25` 而事件口径算出 `23 982 890`；把 `Transfer` 限定在「带 swap 事件的 tx」后，
> 两条恒等式同时闭合（差 0）。
> 也解释了 12:47 那次为什么"闭合"了 —— 那次我只统计了 `from==vault`（卖出方向），
> 没把 `to==vault` 的存款算进去，**是口径不一致而不是方法正确**。

**硬要求**：「`usdcOut` / `wethReceived` 必须来自**已归类为 swap 的 tx** 的 `Transfer` 日志，
不得对全窗口的 `to==vault` Transfer 求和」。

### 2.12 我的验收工具第 5、6 个假绿（F1a / F1b，13:01~13:02 发现并修复）

PM 按我的落点把横幅挪到 README 第 3-7 行后，**脚本仍报 FAIL**。查下来两个都是我的判据写错，
不是 README 的问题：

| 项 | 错在哪 | 症状 | 修法 |
|---|---|---|---|
| **F1a** | 判据只 `grep '保真度'` | 正确写法是「L1/L2，不是 L3」，不含「保真度」三字 → **真通过了却判 FAIL（假红）** | 改判**实质三要素**（`L1/L2`/`不是 L3`、`DON 不会真的定时执行`、`Deploy Access`），不判某个词 |
| **F1b** | `awk '/诚实边界/'` 匹配任意行 | 第 7 行的锚点链接 `[诚实边界](#…)` 先命中 → 立刻遇到下一个标题就 `exit` → `BODY` 恒空 → **恒判 0 条（假红）** | 锚定到**标题行** `^#{2,6}[[:space:]].*诚实边界` |

**两条都做了正反验证（这是本文件的硬规矩）：**

| 负向用例 | 期望 | 实测 |
|---|---|---|
| 把横幅从顶部删掉（退回改前状态） | F1a FAIL | FAIL「前 40 行缺保真度横幅要素」✅ |
| 删掉 §9 第 8 条 | F1b FAIL（7 条） | FAIL「§9 只有 7 条」✅ |
| 在 §9 里多加第 9 条 | F1b FAIL（多了也算） | FAIL「§9 有 9 条」✅ |
| 还原 | 两条都 PASS | PASS ✅ |

**累计 6 个"判定逻辑本身出错"**（都是我自己写的、我自己抓的）：

1. A14 硬编码旧签名 + 只 grep 事件名 → **假绿**（合约改了仍 PASS）
2. D0 把 artifact 的 immutable `00` 占位当真 → **假红**（链上是对的）
3. F4b 把 `planHash`/`promptTemplateSha` 当私钥 → **假红**
4. F1b（第一版）数到文件尾，把别节的 1./2./3. 算进来 → **假绿**（11≥8）
5. F1a 只 grep 一个词 → **假红**
6. F1b（第二版）awk 被锚点链接提前触发 → **假红**

> 规律：**假绿全部出现在"只查形状不查内容"的地方**（grep 名字、数 ≥ N）；
> **假红全部出现在"判据写得太具体"的地方**（某个词、某个从 0 起算的假设）。
> 所以每条判据都要能回答两个问题：**改坏了它会不会红？没改坏它会不会绿？**
> 只回答一个是不可信的。

### 2.6 A11b–A11e 的连带影响（**需要产品裁定，不是代码问题**）

赎回改成「现金不足就卖 WETH」推翻了 PRD 现有的两处承诺，我按快照如实记录：

| 位置 | 现状（12:33 采集） | 与新行为的关系 |
|---|---|---|
| `PRD.md` §3.5 | 「只付 USDC 现金（**不自动卖 WETH**）。**不保证一定够付。**」「现金不足时 revert」 | **直接矛盾**。PM 说已派 planner 改，但当前文件还是旧版 |
| `PRD.md` §9 第 4 条 | 「赎回只付现金，且不保证够付……大额赎回可能 revert」 | **直接矛盾**，且这是 README 要原样贴的诚实边界 |

三条我没替你决定、但必须记下的：

1. **赎回现在依赖 Uniswap 池子。** 以前 redeem 只依赖自己合约的 USDC 余额；现在依赖 `ROUTER`、
   `POOL_FEE`、池子深度与 oracle 新鲜度。这属于 §9 该说的新边界（滑点 > 50bps 或池子枯竭就赎不回来），
   不能只改 §3.5 不改 §9。
2. **出现了一笔「没有计划」的交易。** 产品论点是「每一笔交易都先有一份计划」，而 redeem 触发的卖 WETH
   既无 plan 也无 `PlanExecuted` 事件 —— 审计记录里看不到它，但持仓变了。两种处理都成立，请选一个：
   ① 明确定义为「流动性管理，不是策略决策」并写进 §9 / README；② 发一个 `LiquiditySold(wethIn, usdcOut, forShares)` 事件。
   不处理的话，前端「计划历史」里的仓位变化会和链上事件对不上 —— 评委最容易抓的地方。
3. **`maxWithdraw` / `maxRedeem` 语义。** 改成自动卖之后，现金不再是上限，但「卖得出去」是。
   若 `maxRedeem` 仍返回全额而 redeem 可能 revert，ERC-4626 的「不该 revert 的视图」约定就被破坏了。建议二选一：
   `maxRedeem` 保守回退到现金可覆盖部分，或保持全额但在 §9 声明「视图不保证可执行」。
4. **滑点由留下的持有人承担。** 按 oracle 计价的 NAV 在真实成交价劣于 oracle 时会多减一点（上限 `SLIPPAGE_BPS`=50bps），
   这部分不是赎回人付，是留在金库里的人付。A11e 只保证「不超 50bps」，不保证「不吃这 50bps」。建议 §9 补一句。

### 2.5 docs 修正验收（planner 6 项，快照 2026-10-24 12:3x）—— **PASS**

| # | planner 声称 | 我的独立复核 | 结论 |
|---|---|---|---|
| 1 | `cast keccak` 加 `0x`（PRD §7.2 两处） | `grep -rn "cast keccak" docs/` 共 5 处：PRD:500/502 为命令且带 `0x`；507/514/515 是说明小节。**无一处缺 0x**，`<(` 写法已删 | **PASS** |
| 1b | 四个参考哈希 | 用 `cast keccak 0x$(xxd -p …)` 实测 4 个 prompt：bull `ceb2a196…` / bear `3497e792…` / risk `2854e9da…` / judge `d37d3c2b…` —— 与 PRD:524–527 **逐位吻合** | **PASS** |
| 2 | PLAN P1.5 → 10 revert + 1 正常路径 | PLAN:142–149：10 条列举齐全，并明写第 11 条不 revert、断言 `PlanRecorded` + router 零调用 + nonce 推进；148 有反面说明 | **PASS** |
| 3 | `MAX_PLAN_AGE >= validity` 移出合约测试 | PLAN:155 改「常量断言 `MAX_PLAN_AGE == 3600`」；157 明写「合约看不到计划文件」，900≤3600 指向 ACCEPTANCE B13 | **PASS** |
| 4 | 费率口径 + 摩擦方向 | PRD:136–141「每位既有持有人每期被稀释恰 0.1%」+「绝对金额会变大，不要写成不影响」；PRD:167–172 摩擦方向已改为晚存入者 | **PASS** |
| 5 | 复利近似 ≤ 1e-5 | PRD:158–162 与 PLAN:174–177 均给出 `1.003000·S` vs `1.001³`、`3.0e-6`、「不要断言严格相等」 | **PASS** |
| 6 | `degraded` 并入 §9 第 3 条 | §9 仍为 8 条；第 3 条末多一句「`degraded: true` 在链上不会出现，workflow 生成报告前就拒绝」 | **PASS（有 S3 建议）** |

**矛盾扫描（全文）**：`11 条各一个 expectRevert` 只剩在 PLAN:148 的反面说明里；`MIN_CASH_BPS` 只剩在 PRD:82「没有它」的论证里；`1800` 只剩在「不是 1800」的句子里；`不影响收费金额`/`极小份额`/`严格相等` 均只出现在「不要这么写」的语境；`4000` 全文 0 处。**无残留矛盾。**

**S3 建议（不影响 PASS）**：
- PRD:131 「按整周期线性累计，不复利」与 PRD:158「不复利是近似」字面冲突，建议改成「近似线性累计（非严格复利）」。
- PRD:167–169 那句描述的是**机制结果**，没提「门禁相信文件的 `degraded` 字段」（手写 `false` 可绕过）。补半句即可，不必新增第 9 条。
- PRD §12 的 CRE 那一条只写「执行了 `planUsed` 前置检查」，漏了 PRD §6 的第 0 步 degraded 门禁；建议并列写上。
- `xxd -p -c 100000`：文件超过 100KB 时 `xxd` 会折行，`$( )` 里留下内部换行，命令就不再是「原始字节」。当前计划/模板都在 2KB 内，不影响；稳妥写法是 `-c 1000000 | tr -d '\n'`。

---

### 2.13 anvil fork 的 `eth_getLogs` 只有 200 块（14:09 实测，阻塞 E6c）

页面 14:08 报「无法读取历史事件：An internal error was received」，我一开始以为是
"连不上时显示未采集"（那是正确行为），但 anvil 是活的（高度 49,500,226）。追下去：

```
cast logs --address <VAULT> --from-block 49478393 --to-block 49500226
→ error -32614: eth_getLogs is limited to a 200 range
```

二分（同 RPC、同地址，只改跨度）：**200 块 OK ／ 500 块报错 ／ 1000+ 报错**。

根因：`anvil --fork-url` 的 `getLogs` 会**转发给上游** Base Sepolia，上游硬限 200 块。
`src/frontend/alpha-plan/lib/history.ts:166` 是一次性大范围请求（部署块 → latest），
4 条 Transfer 查询同样如此。

**为什么是真缺陷而不是环境问题**：部署块 49,478,393，anvil 已到 49,500,226 = **21,833 块**。
只要 anvil 活着，跨度只增不减 —— **冻结环境后每过一分钟，这段代码离"能跑"更远一点**。
它不是偶发，是必然。

**判据（E6c-d）**：`getRawLogs` 必须分块（建议 ≤ 200），且把
`-32614 / "limited to"`（区间太大，可自愈）与网络错误**分开**报。
两者落同一个 catch 时 UI 无法区分，会把代码问题伪装成环境问题。

**当前判定**：`E6c-1` / `E6c-2` / `E6c-3` 记 **SKIP（被 RPC 区间限制阻塞）**，不是 PASS。

#### 口径说明：实现用「Transfer 净额」，比我的「按事件分类」更稳

前端没按"按事件分类求和"写，而是：

```
balance(N) − balance(deployBlock−1) == Transfer.in − Transfer.out   （只算 from/to == vault）
```

这个口径**天然不会重复计算**（每条 Transfer 只数一次），在"存款双计"这个坑上比我的判据更稳。
我的"必须只统计 swap tx"那条是针对按事件分类的写法，对它不适用。
**按实现口径判**：两条平衡式都成立即 PASS。这不是放水，是承认另一种更简洁的正确写法。
但 E6c-3③（Deposit 双计负向）需相应改成"把同一条 Transfer 同时计入 in 和 out"才适用。

---

### 2.14 E6c-d3 探测的是"会不会被拒"，不是"有没有结果"（14:11 实证）

PM 问：「如果区间内没有事件，`cast logs` 返回空数组而不是报错，d3 会误判 PASS 吗？」

**会 —— 如果判据写成"有输出就算过"。** 我实测了两种语义，并把判据改成看错误码而非看结果：

| 情形 | 退出码 | 输出 |
|---|---|---|
| 区间内**无事件**（正常） | **0** | `[]`（空数组） |
| 区间**超 200 块**（被拒） | **1** | `Error: … error code -32603: Fork Error … -32614 eth_getLogs is limited to a 200 range` |

关键验证：**区间内确实有 3 条事件时，300 块跨度仍然退出码 1**（不是因为有事件才报错，
而是因为跨度超限，与内容无关）。

现在的判据：

```
PROBE_OUT=$(cast logs --address $VAULT --from-block $((N-300)) --to-block $N --json --rpc-url $RPC 2>&1)
PROBE_RC=$?
[[ $PROBE_RC -ne 0 ]] || echo "$PROBE_OUT" | grep -qiE 'limited to|32614|32603|Fork Error|range'
```

双保险：**退出码非 0** 或 **输出含错误关键字**，任一命中即判 FAIL。
这样即使将来 `cast` 把错误写到 stdout 并退出 0，也不会漏。

另外我验证了**分块方案本身有效**（不只是"代码里有 CHUNK 常量"）：

```
250 块直接查        → error -32603（被拒）
250 块按 100 分 3 块 → ✓ 3 块全部成功
```

### 2.15 E 线验收实录（14:15:55 快照，源码静默 49s 后采集）

**先立一条纪律**：验收前必须确认 ①`.next` build 晚于源码 ②源码静默 ≥45 秒。
否则抓到的可能是 worker 写一半的中间态。本轮我自己就踩了一次：
14:13:01 抓的页面 52573b 含「中本聪单位」，14:14:50 重抓 52319b 已消失；
`.next` 14:14:31 重建、源码 grep「中本聪」= 0 处 → **旧 bundle，作废**。

| 项 | 结果 | 关键证据 |
|---|---|---|
| **E2** 金库五项 | **PASS** | 与 `cast` 逐项比对：19.99 / 0.9995 / 85.0% / 15.0% / 20.00 全一致 |
| **E2 失败态** | **PASS（代码级）** | `SIGSTOP` anvil 后页面仍返回同一内容（dev RSC 缓存挡住，请求未达 RPC）→ 运行时验不了。改读实现：`book.tsx:51` `{vault ? 值 : "—"}` + 副标题 `data.vault.reason`（**不显示 0**）；`chain.ts:59 reasonFrom()` 取 viem `shortMessage`；`data.ts:12` `Promise.all` 四路独立降级「一个源挂了不会让整页白屏」。**强度说明**：验的是代码路径而非运行时渲染，若上游把 reason 覆盖为空看不出来 |
| **E3** 辩论卡 | **PASS** | 计划文件独立复核：bull/bear/risk = 3500/1500/1000 → 均值 2000，judge 1500 → **−500 bps** 与页面一致；另有标尺图同轴呈现 |
| **E4/E4-P1** 哈希自验 | **PASS** | 我独立算 `0xe1fd6d14…48ba5` == 链上 `lastPlanHash` == 页面 `onchainHash` == 页面 `fileHash`；2406 B 一致 |
| **E5①** 正确 id | **PASS** | API 200 / 2406b / 与磁盘文件 `cmp` 逐字节相同 |
| **E5②** 不存在 | **PASS** | 404 `{"error":"plan_not_found",…}` |
| **E5③** 非法 id | **PASS** | 400 `{"error":"invalid planId","expect":"YYYY-MM-DDTHH:MM:SSZ"}` |
| **E5④** 路径穿越 | **PASS-with-note** | `%2e%2e%2f` → 400 被正则拦住；裸 `../../etc/passwd` → Next HTML 404。**已验证无泄漏**（`grep -c '^root:'` = 0，`.env` 取不到）。仅响应格式不统一（HTML vs JSON），非漏洞 |
| **E6b** 双流 | **PASS** | 策略 1 / 流动性 0；链上 `LiquiditySold` 事件数 = 0 证明 0 是正确的；空态文案「本期 0 笔」「这条流为空是正确状态」都在 |
| **E6c-1** 对账 | **PASS** | DOM 上两条平衡式均闭合：USDC 17 == 17、WETH 0.000809095192231808 == 同值；`equation` 里两个端点块号可见 |
| **E6c-2** 解释层 | **PASS** | 全页无「对账通过/不通过」；明写「第二层本版未做……容易被读成估值也对上了」 |
| **E6c-d** 分块 | d1/d2 **PASS**，d3 **INFO** | 真实场景验证：250 块直查被拒 → 按 100 分 3 块全部成功 |

**d3 三档正反验证（14:12 实做）：**

| span | 期望 | 实测 |
|---|---|---|
| 6 | INFO | `INFO 上游限 200 块；当前 span=6（距上限还有 194 块）` ✅ |
| 180 | WARN | `WARN span=180，距 200 上限只剩 20 块`；汇总 `WARN 1`，不污染 FAIL ✅ |
| 250 | FAIL | `FAIL span=250 > 200，历史区此刻已经无法读取`，exit 1 ✅ |

#### 待修：页面文案 `PlanCommitted` 不存在于合约

- `app/_console/screens/chain.tsx:70` — `title: "PlanCommitted"`
- `app/_console/screens/verify.tsx:243` — 「与链上 **PlanCommitted** 事件里的哈希逐位比对」

合约只有 `PlanExecuted` / `PlanRecorded` / `LiquiditySold`。
复现：`grep -rn "PlanCommitted" src/frontend/alpha-plan | grep -v node_modules`（2 处）

**为什么这条必须改**：那张 workflow 图正是「每个数字都带出处」那一屏，出处名字错了，
比数据错更难解释 —— 评委去 BaseScan 会找不到这个事件。

### 2.16 首屏只显示骨架（R1b），且它掩盖了 E2 失败态

`curl` 首页 29988b，去 script 后**可见文本只有**：

```
AlphaPlan — 可审计的 AI 基金经理 / AlphaPlan / 可审计的 AI 基金经理
正在读取链上状态… / 正在从 RPC 与计划文件读取，请稍候。
```

逐项探测：品牌名 ✓ 在服务端 HTML；**L2 横幅、签名方说明、总览、辩论与裁决、金库与流水全部 ✗**；
「金库与流水」在 HTML 里出现 **0 次**（连 RSC payload 都没有）。

根因 `app/page.tsx`：

```tsx
async function ConsoleShell() { await io(); const data = await loadConsoleData(); return <Console data={data}/> }
<Suspense fallback={<ShellFallback />}><ConsoleShell /></Suspense>
```

`ShellFallback` 是简化壳（品牌名 + loading 文案），**没有侧栏、没有导航、没有 L2 横幅**。
SSR 阶段输出 fallback，数据到达后整页替换。

**两个后果**：
1. demo 首屏会白一下；RPC 慢或断时这个 fallback 一直挂着。
2. **E2 失败态验不到的原因就在这里** —— 我之前 `SIGSTOP` anvil 后页面没变化，
   不是因为「设计上优雅降级」，而是因为 Suspense 还把整页挂在 fallback 上，
   而且 dev 缓存把请求挡住了。当时我判「PASS（代码级）」是对的，
   但**没意识到运行时根本到不了那段代码**。

**修法**：把「侧栏 + 导航 + L2 横幅」提到 layout 级 SSR（它们不依赖链数据），
只让链数据驱动的部分进 Suspense。首屏骨架至少是一整屏。

> **这条也解释了为什么渲染闸门必须存在**：三个 FAIL（哈希不一致、浮点、裸余额）
> 机械闸门一条都看不见。而 R1b 又只有渲染层能看见。两层闸门互补，缺一不可。

### 2.17 四个 FAIL 的修复复盘（14:36~14:38）—— 三处比我建议的更好

| FAIL | 谁修的 | 修法 | 是否比我建议的好 |
|---|---|---|---|
| 哈希口径 | frontend | `data.ts:49` 取 `PlanExecuted ∪ PlanRecorded` 中 **nonce 最大**者 | **是**。注释写明「排序用 nonce 不用块号 —— nonce 是合约的单调计数器，块号在 fork 上可能因重组/回滚不可靠」。我只说了"按 nonce"，没说为什么不用块号 |
| 浮点格式 | frontend | `lib/debate.ts:104` `round1()` 在**数据层**归一，mean 与 delta 都过一遍 | **是**。我建议在 `overview.tsx:104` 加 `toFixed(1)`，那只是修一个渲染点；改在数据层三个渲染点都受益 |
| caption | frontend | `book.tsx:137`「每行对应一次链上计划事件：PlanExecuted（已成交）或 PlanRecorded（容差内未交易）」 | **是**。并写下原则「穷举实际存在的行类型，不概括」，还自己记了"同一类错误的第三次" |
| R1b 首屏 | frontend | 侧栏/导航/L2 提到 SSR 层 | **是**。顺带修好了 E2 失败态验不到的问题 |

**R1b 修好后首屏实测**（`curl` 可见文本）：

```
AlphaPlan / 可审计的 AI 基金经理 / 工作区
总览 辩论与裁决 执行链路 哈希自验 金库与流水
L2 · 真实链路 · 真交易 / 签名方：本地 CLI（非 DON）
NAV — 读取中 / 本轮裁决 — 读取中 / 哈希自验 — 读取中 / 纪律越界 — 读取中
```

HTML 29988 → 37067 b。骨架完整，只有数据位显示「读取中」。

**E 线全项回归 17/17 PASS**（14:38）：E3 裁决 1300 / E3 均值已格式化 / E4 无不一致 / E4 计划 id /
E2 五项 / E6b 四项 / E6c-1 闭合与差分 / E6c-2 第二层未做且无「通过」字样。

> **一次自查**：我第一次跑回归时 E2 后四项报 FAIL —— 是我脚本在**总览屏**找金库数字。
> 切到「金库与流水」后五项全在。**判据要指向正确的屏**，这也是「假红」的一种。

### 2.19 两个合约修复经正反验证成立；但 probe 文件让 A4 变红（14:43）

**修复 1｜`maxRedeem` / `maxWithdraw` 在 feed 陈旧时不 revert**

```solidity
try this.totalAssets() returns (uint256) { ... } catch { return cash; }
```

ERC-4626 规定这两个视图 **MUST NOT revert**，但它们要读 NAV，而 NAV 在 feed 陈旧时 revert `StalePrice`。
不加 try/catch 的话，feed 停更 1 小时后任何按规范集成的 UI 都会崩。

**反向验证**：拆掉 try/catch → `test_P0_MaxViewsDoNotRevertOnStaleFeed` 立刻 `FAIL: StalePrice(7200)` ✅

**修复 2｜赎回准入判定：全仓折价 → 本次缺口**

```solidity
// 旧：uint256 realizable = wethValue * (BPS - SLIPPAGE_BPS) / BPS;
//     if (cash + realizable < assets) revert InsufficientLiquidity(...);
// 新：uint256 deficitNow = assets - cash;
//     if (deficitNow > wethValue) revert InsufficientLiquidity(...);
```

旧式用「全仓折价」比「总资产」，**永久差 50bps** —— 池子收 0.3%，
所以"卖光刚好够"在数学上不成立，**最后一个持有人永远退不出去**。

**反向验证**（改回旧逻辑）：

```
[FAIL] test_P0_LastHolderCanFullyRedeem      InsufficientLiquidity(179999999, 100000000, 80000000)
[FAIL] test_P0_MaxThenRemainderIsNotStuck    InsufficientLiquidity(80000001, 2, 80000000)
```

第二条最能说明问题：现金只剩 **2 wei**、WETH 值 8e7，旧逻辑判"不够"，新逻辑判"够"。
**修复必要，不是过度防御。** 两处均已还原，`forge build` 0 error。

#### A4 FAIL：`Probe*.t.sol` 让 `forge test` 永远红

```
test/Probe089b.t.sol   55 行（未跟踪，只有 SPDX 头，无用途注释）
test/Probe2.t.sol      56 行（同上）

forge test                          → 2 failed（都是 Probe 的 setUp）, 74 succeeded
forge test --no-match-path "test/Probe*" → 74 passed; 0 failed
```

**为什么这是 FAIL 而不是"小问题"**：它违反 A4「测试全绿」，而且这两个文件**没有说明要验什么** ——
一个不知道目的的红灯比红本身更糟，因为它会训练人忽略 `forge test` 的结果。

**处置建议**（不自行修改）：临时调试 → 删除或改名离开 `*.t.sol`；fork 探针 → 修好 `setUp()` 并加用途注释。

**A4 是否要加 `--no-match-path` 排除**：我倾向**不加**。「仓库里的测试全绿」本身就该是要求，
probe 文件不该进仓库。若 PM 决定保留，则加排除的同时必须加一条「probe 文件必须有用途注释」。

**正式套件已从 71 → 74 passed**（新增 `P0_MaxViewsDoNotRevertOnStaleFeed`、
`P0_LastHolderCanFullyRedeem`、`P0_MaxThenRemainderIsNotStuck`）。

### 2.21 D7 反重放实测通过（PM 授权，14:53）；E3/E4 因**两份计划文件**而 FAIL

#### D7：两把锁各自独立生效

| 用例 | 构造 | 结果 |
|---|---|---|
| **D7-A** 同 nonce 重复提交 | `nonce=1` + 新 planHash | revert `BadNonce(2, 1)`，选择器 `0xa4c98472` |
| **D7-B** 正确 nonce 但复用已执行 planHash | `nonce=2` + `0x2b91f9d0…` | revert `PlanAlreadyExecuted(0x2b91f9d0…)`，选择器 `0x2f091853` |

**状态无残留**（测前/测后逐项相同）：`lastNonce` 1→1、`lastExecutedAt` 1792824712→同、
`lastPlanHash` 同、`totalAssets` 19,993,881→同、`planUsed(重放用的新 hash)` = false。

#### E3/E4 FAIL 的根因：环境里有两份计划文件

```
06:49:13Z  2420 B  target=1000  keccak 0x2b91f9d0…  mtime 14:50:23  ← 链上执行的是这份
06:50:32Z  2503 B  target=0     keccak 0xe12722f5…  mtime 14:51:23  ← 多出来的
```

`readLatestPlan()` 取 **planId 最大** → `06:50:32Z`（target 0）；
链上 `lastPlanHash` 是 `06:49:13Z`（target 1000）→ `fileHash ≠ onchainHash` → 页面显示「不一致」。

页面实测：本轮裁决 **0 bps**（不是 1000）、较算术均值 **−1500 bps**、哈希自验 **不一致**、
侧栏 planId `06:50:32Z`、副标题同时显示 `0x2b91f9…ae3a · 2503 B` ——
**2503B 是后者的、0x2b91f9 是前者的，页面把两份文件混在一格里了。**

**这不是 frontend 的 bug，是 P2 的数据卫生问题**：`plans/` 被当作"证据目录"长期保留，
每次 `debate` 又写新文件，于是"最新文件"与"链上最后一次执行"必然随时间分叉。

三种处置（**产品决策，我不替选**）：

| 方案 | 做法 | 代价 |
|---|---|---|
| A | 每次演示前清空 `plans/`，只留将被执行的那份 | 最简单，牺牲"历史证据" |
| B | 前端按链上 `lastPlanHash` 反查对应文件；找不到时显示"该次执行的文件已不在 plans/" | 主徽章永远对着链上那次执行 |
| C | 保留现状，但**分别标注**每份来源，不能混在一格 | 多余文件可见但不误导 |

我倾向 **B + C**：B 让主徽章永远可信，C 让多余文件不再污染同一格。

#### E6b / E6c-1 不受影响，PASS

```
策略交易 1 笔：49513278 / 买入 WETH / +2.000000 / 1000 → 997 bps / 0x2b91f9…ae3a
流动性调整 0 笔：「本期 0 笔 · 正常」+「未发生『赎回超过现金』…」
对账：闭合。USDC balance(49513278) − balance(49513272) == Transfer.in − out；WETH 同
表题：「每行对应一次链上计划事件：PlanExecuted（已成交）或 PlanRecorded（容差内未交易）」
```

#### 渲染闸门 R3 现在正确报 FAIL

抓到「不一致」即 FAIL —— **说明上一轮修的三态判定生效了**（以前这里会假绿 PASS）。

### 2.22 E4 修好；E3 仍 FAIL（同一页里两处数据源分叉）；我自己的第 9 例

#### 我的第 9 例：`textContent` 不穿透嵌套 shadow root

PM 指出 modal 不是空的。我按他给的方法改成**递归 shadowRoot 到叶子**（只看 `children.length === 0`），
读到了 6 个钱包：`Connect Wallet / WalletConnect / qr code / MetaMask / installed / Trust Wallet / Binance Wallet`。

**上一版用 `element.textContent` —— 它不穿透嵌套 shadow root，拿到空字符串，于是误报「modal 为空」。**
这与前 8 例同类：**判据的观测方法本身有缺陷**，不是被观测对象有缺陷。

已改成递归探测并加入渲染闸门 `Rm`（先点开 modal → 递归读叶子 → 读完移除避免污染后续抓取）。
**此后不再报 modal 为空。**

#### 后端 onchain 优先：独立核实通过

```
/latest.json → planId = 2026-10-24T06:49:13Z,  latestReason = "onchain"
/plans.json:
  06:50:32Z  target=0     bytes=2503  match=false nonce=null execs=0  selectable=true
  06:49:13Z  target=1000  bytes=2420  match=true  nonce=1    execs=1  selectable=true
  06:25:34Z  target=1300  bytes=2422  match=false                    selectable=false
  03:00:00Z  target=3200  bytes=1679  match=false                    selectable=false
```

计划真值（自己算）：`rounds=[4000,1000,1000]` → 均值 2000，judge 1000 → **−1000 bps**

#### E4 PASS：两格分开了

```
链上最后执行的计划
  ✓ 文件在本地，逐位一致
  planId 2026-10-24T06:49:13Z / 2420 B
  keccak 0x2b91f9d0…2984ae3a
  来源 · vault.lastPlanHash → 反查 plans/
本地最新的计划
  ⚠ 尚未上链（与 lastPlanHash 不同）
  planId 2026-10-24T06:50:32Z / 2503 B
```

总览卡副标题也对：`0x2b91f9…ae3a · 2420 B · 另有 06:50:32 未上链`。
**2503B 不再配 0x2b91f9。**

#### E3 仍 FAIL：同一屏里两个数据源

```
本轮裁决    0 bps        ← 应为 1000
较算术均值  -1500 bps     ← 应为 -1000
辩论屏      bull 4,000 / bear 500 / risk 0   ← 这是 06:50:32Z 的数据
文案        「三个 agent 的目标仓位相差 4000 bps。裁决落在 0 bps，比算术均值 低 1500 bps」
```

**矛盾很明确**：同一屏里哈希卡读 `06:49:13Z`（正确），辩论卡读 `06:50:32Z`。

根因（读代码确认）：

```
lib/debate.ts:64        readDebate() 调用 readLatestPlan()
lib/plan-file.ts:46-65  readLatestPlan() 仍是 readdir + sort + reverse（取 planId 最大）
→ 前端没有接后端新的 /latest.json（onchain 优先）
→ E4 屏正确是因为它另走了一条「按 keccak 反查」的路径，没走 readLatestPlan
```

**建议一句话**：`readLatestPlan()` 改成调 `/latest.json`（或复用同一条 onchain 优先逻辑），
`readDebate()` 自动就对。**不要在两处各维护一份"哪份是最新"的判断** —— 那正是这次分叉的原因。

#### 渲染闸门现状

```
PASS R1a / R1b / R2 / R3（哈希自验真的「一致」了）/ Rm（模态 6 个钱包）
SKIP R4 / R5 / R6（钱包未连接）
汇总 PASS 5 / FAIL 0 / SKIP 3
```

R3 从 FAIL 变 PASS —— 页面侧的哈希自验确实修好了。E3 的问题不在哈希，在**辩论数据源**。

### 2.23 E3 修复成立（15:07:58 实测），但环境在 15:08 被重置 → 最终结论记 SKIP

#### 代码层：三条都做到了

```
app/_console/data.ts
  串行：Promise.all([vault, history]) → pickOnchainPlanHash(history)
        → selectCurrentPlan(keccak, onchainHash) → readDebate(current.plan)
  注释：「顺序是硬要求，不能改回 Promise.all」+ 解释分叉的物理原因
  有 dev 断言：[plan-source-mismatch] 对比 debatePlanId 与 currentPlanId
lib/debate.ts:71   「现在全站只有一个判定源：selectCurrentPlan()（onchain 优先）」
lib/plan-file.ts:73 selectCurrentPlan 存在
```

**只有一处判定、无并行分叉、有断言** —— 三条都做到了。

#### 实测层：E3 数字对了（15:07:58，源码静默 41s 后抓）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 本轮裁决 | 0 bps | **1000 bps** |
| 较算术均值 | −1500 bps | **−1000 bps** |
| 哈希自验 | 不一致 | **一致** |
| 副标题 | `0x2b91f9…ae3a · 2503 B`（混格） | `0x2b91f9…ae3a · 2420 B · 另有 06:50:32 未上链` |
| 侧栏 planId | 06:50:32Z | **06:49:13Z / 2420 B**（与哈希卡同源）|

#### 但 15:08:39 环境被重置，链上执行记录清空

| 时刻 | h | chainId | vault | 备注 |
|---|---|---|---|---|
| 15:07:58 | 49,513,285 | 31337 | 39,981 B | E3 正常 |
| 15:08:39 | 49,513,285 | — | **无代码** | 页面 NAV 显示 0.00 |
| 15:08:46 | 49,519,228 | **84532** | 3 B | 又一套新环境 |
| 15:09:02 | 49,519,232 | 84532 | 39,981 B | |
| 15:09:12 | 49,519,397 | 31337 | 3 B | 又被换 |
| 15:09:22 | 49,519,398 | 31337 | 39,981 B | 稳定 |
| 15:09:57 | 49,519,401 | 31337 | 39,981 B | **lastNonce=0, lastPlanHash=0x00…** |

env 现在 `DEPLOY_BLOCK=49519398`（原 49513273）。**链上执行记录已清空。**

**判定**：E3 = **SKIP（环境已变）**，不是 FAIL。代码在 15:07:58 那一次已证明正确；
最终 PASS 需要在新环境再执行一次 `onReport` 后复验。

#### 顺带纠正一处误传

PM 转述「reviewer 报过 8788 没起」—— 我上轮原文是
`/latest.json → planId = 2026-10-24T06:49:13Z（onchain 优先）✅`，并附了 `lsof` 的 LISTEN 输出。
**我从头到尾认定它活着。** 复核当前 8788 → HTTP 200，仍是活的。

frontend 选 B 的三个理由（不依赖第二进程 / SSR 推自己 origin 不可靠 / 渲染路径不该有 HTTP 往返）
比「8788 没起」更硬，B 是对的。

#### 闸门是否引用了被删目录

`app/_sections/` 与 `app/_components/` 已删除。已 grep 确认：
`verify-mechanical.sh` 与 `render-gate.mjs` **都没有引用这两个路径**（闸门只读 `lib/`、`app/_console/`，render-gate 走 HTTP）。

### 2.24 DEPLOY_BLOCK 必须用链上事实反推；B3 暴露 prompts 改写的架构风险（15:40）

#### DEPLOY_BLOCK：二分法独立验证 = 49522615

```
49519398（我上轮报的）→ cast code = 3 B（无代码）
二分找「最小有代码的块」→ 49522615
```

**我上轮错在哪**：我**直接读了 `/tmp/alphaplan-demo-env` 和 `.env`**，而这两个文件里的值是错的
（49519398 / 49522628）。**验收环境基准不能只信配置文件，必须用链上事实反推。**

**机制**：anvil 每次重启都从上游重新 fork，**块高整体平移** ——
同一合约在不同 anvil 实例上的块号完全不同。这类错误无法靠"对照另一个配置文件"发现。

#### E2/E3/E4/E6b/E6c-1 全 PASS（15:39）

| 项 | 实测 |
|---|---|
| **E3** | 本轮裁决 **4000 bps** / 较算术均值 **+400 bps** / 侧栏 planId `07:34:51Z / 2449 B` 与哈希卡同源 |
| **E4** | 哈希自验 **一致**，`0x4da387…a367 · 2449 B` |
| **E2** | NAV 10.44 / 份额价 1.0442 / 现金 62.8% / WETH 37.2% / 总份额 10.00（与 cast 逐项一致）|
| **E6b** | 策略 3 笔 / 流动性 0 笔；三行里两行标「未交易 · 容差内」（PlanRecorded）✅ |
| **E6c-1** | 闭合，`balance(49522635) − balance(49522614) = 6.558173` vs Transfer 净额同值 |

#### 补充实证：bps 从 14.96% → 37.19% 不是 swap，是现金变少

```
WETH 余额在块 49522620 买入一次后再没变过（809,095,192,231,808 wei）
但 cash 从 17 USDC 降到 6.5582
→ 分母变小，WETH 占比被动从 14.96% 升到 37.19%
WETH 估值 3,883,656 + cash 6,558,173 = 10,441,829 == totalAssets ✅
```

**这是 PRD「40% 现金不是不变量」的链上实证** —— 不变量只在调仓那一刻成立，
之后会被价格和赎回改变。值得写进 README 作为实证。

#### B3 FAIL：prompts 被改写，历史计划永久不可校验

```
prompts/*.txt 在 15:16~15:17 被改写（bull 931B → 1370B 等）
→ 07:17 之前的 8 份计划文件里 promptTemplateSha 是旧哈希：
  03:00:00Z / 06:25:34Z / 06:49:13Z / 06:50:32Z / 07:10:22Z / 07:11:27Z / 07:13:11Z / 07:15:52Z
→ 07:17 之后的 5 份用新哈希：07:17:07Z / 07:20:12Z / 07:23:37Z / 07:34:49Z / 07:34:51Z
```

`bun run debate --check` 报 **32 problem(s)** —— 因为它校验**全部**历史文件。

**链上执行的那份（07:34:51Z）不受影响**，但：
- 那 8 份旧文件的「prompt 可复算」**永久失效**
- `--check` 会一直红

**性质**：这与「计划文件是证据」直接冲突。prompt 模板一改，历史证据的复算链就断了 ——
而 PRD 卖的就是"可复算"。

| 方案 | 做法 | 代价 |
|---|---|---|
| A | 旧文件移到 `plans/archive/`，`--check` 只校验当前时代 | 清理当前目录，历史仍在 |
| B | 计划文件内同时存当时 prompts 的原文副本 | 体积 +1.5KB/份 |
| C | **prompts 冻结**：改 prompt 必须新建 `prompts/v2/`，计划里记版本 | 从根上让"改 prompt 不破历史" |

**我倾向 C + A**，但这是产品决策。

### 2.25 B3 修法：content-addressed prompt 存档（我认可，比我的三个选项高一层）

PM 的修法重新定义了问题：

| | 问法 | 结果 |
|---|---|---|
| 旧 | 「这份计划是不是用**当前** prompt 生成的？」 | 改 prompt 就全红 |
| 新 | 「它**当时**用的那份原文，我们还能不能拿出来？」 | 历史可重建 |

> **审计不要求历史与现在相同，只要求历史可重建。**

我原来的三个选项（归档 / 文件内存副本 / 冻结版本）**都还在问"当前 prompt 对不对"**。

#### 设计：`prompts/archive/<keccak256>.txt`

- 文件名**就是**它自己的校验和 → 内容寻址，改 prompt 是**新增**不是覆盖
- 校验时按 hash 反查，不按 agent 名找当前版本
- **归档在调 LLM 之前做**（计划可能已写下新哈希，事后归档会留空洞）
- 每次 `bun run debate` 自动归档

#### 我独立验证的最关键性质：文件名真的等于内容哈希

```
8 份归档，逐个 cast keccak 与文件名比对 → 8/8 全部相等
0x255c3df0… 1375B  0x2854e9da… 1105B  0x345570c2… 1370B  0x3497e792…  936B
0x9454be8a… 1744B  0xb8421165… 1894B  0xceb2a196…  931B  0xd37d3c2b… 1156B
```

`bun run debate --check` → **OK: 13 plan(s) validated against plans.lock.json** ✅（原红 32 项）

**当前 prompt 哈希**（我用 `cast keccak` 逐个复核过，与 PM 给的一致）：

```
bull  0x345570c250d49d35e5b494f36e0ce66a0bfe0825c7329ca4e3bd46c6d8875c40
bear  0x255c3df0f739dde53ee02f00fc6fde562343025fd9495650e61db4eb2a43f893
risk  0xb8421165f59cb79d7f27fe590994864146acd7793eb1329e04ea6b28d14f1c54
judge 0x9454be8abbe5960b1c49151b0c1242e55eba2b82ce81f534c29b461730d739c6
```

#### 我的第 10 例：B9b 判据依赖了实现形式

原判据 `grep -c 'promptTemplateSha' debate.ts ≥ 4`。
实现重构成「1 处泛化写入 `template.keccak256` × 4 次调用」→ 源码只出现 3 次 → **假红**。

改成检查**实际产物**：

```bash
jq '[paths(scalars) as $p | select($p[-1]=="promptTemplateSha")] | length' <plan.json>
→ 4   （bull / bear / risk / final 齐全）
```

**第 10 例的教训**：判据不能锚定"源码里出现几次某个字符串" —— 那是实现细节，
重构就会假红。**要判行为产物。**

#### B1 是真问题，但根因在工具链

`bun check` 报 7 个 TS2349，全部指向 `prompts.test.ts` 里的 `node:fs` 具名函数
（`mkdtempSync` / `mkdirSync` / `copyFileSync` / `readFileSync` / `existsSync`）→ 全被推成 `never`。

**三级排查**：

1. **最小复现**：只 import `{ mkdtempSync, readFileSync } from "node:fs"` 的新文件 → 同样 TS2349
   → **与 prompts.ts 无关**
2. `node_modules/@types/node/fs.d.ts` 里三处重载都在 ✅
3. 试 `types: ["bun","node"]` → 仍报错，不是 types 收窄

**根因**：`package.json` 写 `"typescript": "^7"`，实际装 **TypeScript 7.0.2**，
与 `@types/node` 22.20.5 的 `export function` 声明形式不兼容。

**为什么现在才炸**：全仓**只有 `prompts.test.ts`** 直接用 `node:fs` 具名函数；
其他地方都用 `Bun.file` / `Bun.write`（符合 CLAUDE.md）。这条新测试是第一个踩进来的。

**两条修法**（未定，属 backend 范围）：
- **A（推荐）** 改用 Bun API —— 实测可行：`Bun.write` / `Bun.file().exists()/.text()/.arrayBuffer()`
  探针 `bun check` → ✓ No type errors，运行正常；且符合 CLAUDE.md「Prefer Bun.file over node:fs」
- **B** 把 `typescript` 从 `^7` 降到 `^5` —— 影响全仓工具链，不宜为一个测试文件动

### 2.26 hydration mismatch：两层 bug，实测 0（含切 5 屏压力）

#### 第一层：服务端与客户端答案不同

`useAccount().isConnected` 服务端恒 `false`，hydrate 后立刻 `true`：

```
服务端（isConnected=false）            → "—"
客户端（isConnected=true, allowance=null）→ "读取失败"
```

两边输出不同 → React 重建整棵树。

**修法**：`lib/use-is-client.ts` 用 `useSyncExternalStore(noopSubscribe, () => true, () => false)`。
`walletKnown = isClient && isConnected`，`!walletKnown → 一律 "—"`。

**不用 `useEffect + setMounted`** 的理由：那会在 effect 里同步 setState，
触发 `react-hooks/set-state-in-effect` 报错。这件事本质是「读一个只在客户端为真的外部事实」，
正是 `useSyncExternalStore` 的用途。

#### 第二层：`null` 同时表示三件事

`allowance: bigint | null` 这个 `null` 被「没连钱包 / 还在读 / 读失败了」三者共用 →
UI 只能挑一个说法 → **loading 期间也显示「读取失败」，那是在陈述一件没发生过的事。**

**修法**：拆三态，新增 `readError: string | null`
（`app/_wallet/use-fund-data.ts:49`），渲染分三支：
`loading → "读取中…"` / `readError → "读取失败"（title 显示原因）` / `否则 → 实际值`。

> 这条诊断是本轮最有价值的：**用 loading 的样子陈述一件没发生过的事**，
> 比"显示错了"更糟 —— 它不报错、无法被日志发现。

#### 我实测：0 mismatch（压力版）

注入 `console.error` 捕获器（在页面脚本前），然后**依次切 5 个屏**
（辩论 → 链路 → 自验 → 金库 → 总览）触发更多渲染：

```
hydration mismatch 数量: 0
```

比"打开首页看一眼"更严，因为切屏会重新渲染多个原本隐藏的子树。

#### 术语表 + 三个文案改动（已核实实际渲染）

| 项 | 实测 |
|---|---|
| 主标签 | 「基金总值 NAV」✅ |
| 主值 | 「40%」+ 小字「4000 bps」✅ |
| 副标题 | 「三个 agent 各自目标平均 36%，AI 裁决比均值 +400 bps」✅ |
| 「较算术均值」 | **已消失**（页面 grep 未找到）✅ |

**第三个 bug 值得记**：主值 40% 是 AI 裁决、副标题 36% 是 agent 平均，
两个都对但主语不同，并排读会以为矛盾。**补主语而不是改数字是对的** —— 因为没有一个数字是错的。

#### 两个格式化 bug 的边界测试（我独立复现逻辑后跑）

```
percentOf(1875) = 18.75%   旧 toFixed(0) → 19%（多报 0.25pp）✅已修
percentOf(4000) = 40%   (3719)=37.19%   (1496)=14.96%   (50)=0.5%   (0)=0%

signedBps(0.4)  = 0 bps    旧 delta>0 判真 → 四舍五入 0 → "+0" ✅已修
signedBps(-0.4) = 0 bps    (0)=0 bps   (-0.5)=0 bps   (400)=+400   (-1000)=-1000
```

#### 一处注释写反了（仅文档，不影响功能）

`lib/use-is-client.ts` 结尾原文：

> 关键是**两个分支的输出必须不同**：如果服务端渲染「—」、客户端也渲染「—」，那就不需要这个 hook

**这句反了。** 正确做法恰恰是**两边输出相同**（服务端 "—"、hydration 期 "—"），
所以 `walletKnown ? 值 : "—"` 在服务端与 hydration 期都走 "—" 分支 —— 这**正是**它有效的原因。
如果两边输出不同，才会 mismatch。

建议改为：「关键是**两个分支在服务端与 hydration 期必须走同一条**」。

## A. 合约（P1）—— `src/contract`

| # | 检查 | 命令 / 判据 | 手工 |
|---|---|---|---|
| A1 | 能编译 | `forge build` 退出 0 | |
| A2 | 依赖走 submodule | `remappings.txt` 含 `@openzeppelin/=lib/openzeppelin-contracts/` | |
| A3 | 构建缓存不入库 | 根 `.gitignore` 含 `cache/`；`git status --porcelain` 无 `cache/` | |
| A4 | 测试全绿 | `forge test` 0 failed | |
| **A5a** | **PRD §5 第 1–10 行各一个 revert** | sender 错 / vault 错 / paused / `now < lastExecutedAt+60` / `asOf > now` / `now−asOf > 3600` / `validUntil < now` / `nonce != lastNonce+1` / `target > 6000` / `planUsed[planHash]==true` —— **10 个独立 `vm.expectRevert`**（PLAN P1.5 的「10 revert + 1 正常路径」口径） | ✓ |
| **A5b** | **第 11 行是分支，不是 revert** | 偏离 ≤300bps：`expectEmit PlanRecorded`、`router.exactInputSingle` **零调用**、`lastNonce` 已 +1、`planUsed` 已置位 | ✓ |
| **A5c** | **asOf 闭区间边界 + 合约侧常量关系** | `asOf==now` 通过；`asOf==now+1` revert；`asOf==now−3600` 通过；`asOf==now−3601` revert；`MAX_PLAN_AGE == 3600`。（"3600 ≥ 文件 900"合约侧看不到，在 B13/D8 断言） | ✓ |
| A6 | 反重放（两把锁都在） | `nonce` 与 `planUsed` **分别**有独立用例：只错 nonce 时 planUsed 路径仍被覆盖，反之亦然；不交易的报告也 `lastNonce++` | ✓ |
| A7 | 精度换算 | `usdcValueOfWeth = weth*price/1e20`（WETH 18 / feed 8 → USDC 6）；单测含 0 / 极大值 / price=0 | ✓ |
| A8 | swap 方向与 minOut | 买：`tokenIn==USDC`；卖：`tokenIn==WETH`；`amountOutMinimum` 恰好 = oracle 预期 ×(10000−50)/10000，**不允许额外打折** | ✓ |
| A9 | 仓位上限截断（**不是**现金下限） | 目标 6000、当前 0、NAV 1000 → 买入后现金恰 400；买入量被 `MAX_SWAP_BPS` 截断时 `planUsed` 仍置位，且**不能**拿同一份计划补完；**grep 确认 `MIN_CASH_BPS` 已不存在**（防止死代码被加回来） | ✓ |
| A10a | 费率单周期 | +30d → `accrueFee` → feeRecipient 份额 +0.1%；同区块重复调用不再累计 | ✓ |
| A10b | 费率多周期 + 不复利（近似） | +90d 一次 → **+0.3%**；+45d 再 +45d → 累计 **3 期**（余数保留）；一次 vs 三次：**相对误差 ≤ 1e-5**，不得断言严格相等。S=1000e6 时定点值：一次调用 **1 003 000 000**、三次 **1 003 003 001**（差 3001，≈3.0e-6）；45+45 路径 **1 003 002 000**（证明补的是 2 期而非 1 期） | ✓ |
| A10c | 计费基准是 accrual 时刻的 `totalSupply` | 断言**稀释比例**而非绝对金额：期内新存入 → 绝对 `feeShares` 等比变大（正确行为），**既有持有人被稀释仍恰 0.1%**。**不要**断言「金额不变」 | ✓ |
| A10d | `onReport` 内先 `accrueFee()` | 计划被接受时费用已结；`accrueFee` 也保留公开无权限入口 | ✓ |
| A11 | pause 不影响赎回（**含新路径**） | `paused==true` 时：`onReport` revert；① 现金充足的 `redeem` 成功；② **现金不足、走自动卖 WETH 的 `redeem` 也必须成功**（`_withdraw` 里不能有 `whenNotPaused`）。当前用例：`test_A11_RedeemWorksWhenPaused_AndOnReportReverts` | ✓ |
| **A11b** | **现金不足时自动卖 WETH 完成赎回** | 前置：USDC 现金 14e6、WETH 估值 5.98e6、赎回需 18e6（shortfall 4e6）。期望：① `redeem` 不 revert；② `router.exactInputSingle` 调用 **1 ≤ n ≤ 4**（第 1 笔按 oracle `ceilDiv`；补卖笔按 `SLIPPAGE_BPS` 放大，见 §2.7）；每笔都须 `tokenIn==WETH` / `tokenOut==USDC` / `recipient==vault` / `fee==POOL_FEE`；**池子足额成交时必须 n==1**；③ 用户到账 == 调用前 `previewRedeem(shares)`（**先取快照再赎**）；④ `amountIn` == `ceilDiv(shortfall*1e20, price)` —— **精确值，不是“不超过”**；卖出后金库 USDC 剰余 ∈ [0, 1]（USDC wei，只允许取整零头）；⑤ `totalAssets` 减少量**恰 == needed**（例：19.98 → 1.98，减 18）；shares 已烧、vault WETH 减少 `amountIn` | ✓ |
| **A11c** | **现金充足时不卖 WETH** | 前置：USDC ≥ needed。期望：`router` **零调用**；用户到账 == `previewRedeem`；WETH 余额不变；`totalAssets` 减少量恰 == needed（全在 USDC 侧） | ✓ |
| **A11d** | **USDC+WETH 都不够 → 可读 revert** | 前置：卖出 WETH 后仍不足（mock router 返回 0，模拟池子枯竭）。期望：revert 且是**合约自定义 error**（如 `InsufficientLiquidity(needed, available)`），不是裸 `revert()`、不是 OZ 的 `ERC20InsufficientBalance`；断言用 `vm.expectRevert(AlphaPlanVault.Xxx.selector)` 而非空 `expectRevert()`；**状态全回滚**（`totalSupply` / `balanceOf` 不变） | ✓ |
| **A11e** | **滑点保护（minOut 由 oracle 推）** | ① **每笔** swap 的 `amountOutMinimum` == `expectedOut*(10000−50)/10000`（`expectedOut = amountIn*price/1e20`，**精确断言取整方向**）；这是逐笔判据，不是整次 redeem 只一笔；② mock router 行为同真池：`amountOut < minOut` → revert，测试喂偏离 >50bps 的成交价 → `redeem` revert；③ 边界：`amountOut == minOut` 通过、`minOut−1` revert | ✓ |
| A12 | 无后门 | grep：无费率/常量 setter、无 proxy/upgrade/initializer；唯一 `onlyOwner` = `pause`/`unpause`/`setForwarder` | |
| A13 | 常量表 8 项 | 6000 / 300 / 5000 / 50 / 60 / **3600** / 10 / 30 days；**无 4000** | |
| A14 | 两个事件：**从 ABI 抽签名**再比 topic0 | 不 grep 名字（那是假绿）。`forge inspect AlphaPlanVault abi --json` → jq 拼出真实签名 → `cast keccak` 算 topic0 → 与期望值 + 字段名/顺序 + indexed 集合逐项比。当前期望：`PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)` = `0x32fcaf0e…`；`PlanRecorded(bytes32,bytes32,uint64,uint64,uint16,uint16,uint64)` = `0xb7e38568…`；两者 indexed 均为 `reportHash,planHash` | ✓ |
| **A14q** | **`LiquiditySold` 事件（第三个事件）** | 签名 `LiquiditySold(address,uint256,uint256,uint256,uint64)`，topic0 期望 `0xc1ce2ec3be95b90ba620b8bf68f85fe76a5890db4d6145149a5f446e182a8e14`（我 12:41:06 独立 `cast keccak` 复算过，与 PRD:342 一致）；`indexed` **仅** `forHolder`；字段名 `forHolder,wethIn,usdcOut,shares,timestamp` | ✓ |
| **A14r** | **`LiquiditySold` 只在真的卖了才 emit** | 现金充足路径 **零 emit**；自动卖路径恰 1 条；`_ensureLiquidity` 提前 return 时不得漏发/多发。用例：`test_A11b_EnoughCashNeverTouchesRouter` 须同时断言 `LiquiditySold` 计数为 0 | ✓ |
| **A11g** | **卖光也不够时**不白跑 swap | 前置：`cash + wethValue*(BPS−50)/BPS < assets`。期望：① `router` **零调用**（预检在 for 循环之前，不能先卖一笔再失败）；② revert `InsufficientLiquidity(required, cashAvailable, wethValue)` —— 三个参数逐个断言语义（`required==assets`、`cashAvailable==当时 USDC`、`wethValue==usdcValueOfWeth(WETH 余额)`）；③ 状态全回滚（`totalSupply`/`balanceOf`/WETH 余额不变）；④ **gas 观测**：该路径 gas 应显著低于「先卖再 revert」的对照（可用 `vm.startSnapshotGas` 或对比两条路径 gas，只作参考不作硬门槛） | ✓ |
| **A11f** | **`maxRedeem` / `maxWithdraw` 保守回退** | `maxRedeem == min(totalSupply, convertToShares(cash))`；`maxWithdraw == min(totalAssets, cash)`；**`maxRedeem < totalSupply` 时超出部分的 `redeem` 仍成功**（自动卖 WETH）；视图本身不得 revert（ERC-4626 约定） | ✓ |
| **A14p** | **PRD 事件声明跟得上合约** | `docs/PRD.md` §5 里两个 `event` 块都必须含 `asOf` 与 `validUntil` —— 否则 verify.ts / 前端按 PRD 写解码会解错。这一项就是用来抓「代码加了字段、文档没跟」的 | ✓ |
| A15 | 报告 ABI 6 字段 | `abi.decode` 顺序 `(address vault, uint64 asOf, uint64 validUntil, uint64 nonce, uint16 targetWethBps, bytes32 planHash)` | |
| A16 | `planUsed` 状态 | `mapping(bytes32=>bool) public planUsed`；**交易路径与容差路径都置位**；被拒后状态不变（`lastNonce`/`lastExecutedAt` 不推进） | ✓ |
| A17 | feed 陈旧阈值 | 实测 ETH/USD age **≈16 分钟**，阈值必须 ≥1h（PLAN R6），否则 `totalAssets()` 现场 revert | |
| A18 | `currentWethBps()` 边界 | 全现金 0；全 WETH ≈10000；空金库 0（不 panic）；**WETH 涨价后可 >6000 且不被夹到 6000**（观测值不受上限约束，对齐 schema 的 `MAX_OBSERVED_WETH_BPS`） | ✓ |

## B. AI 辩论层（P2）—— `src/backend`

| # | 检查 | 判据 | 手工 |
|---|---|---|---|
| B1 | 类型 | `bun check` 退出 0 | |
| B2 | 产出合法计划 | `bun run debate` → `plans/<planId>.json`，zod 通过 | |
| B3 | `--check` | 退出 0；篡改一个字节后退出非 0 | ✓ |
| B4 | `--offline` | 无网络 / 无 API key 下退出 0 且产出固定样例 | ✓ |
| B5 | 0..6000 边界 | `final.targetWethBps` 与三轮意见均 `0..6000` 整数；`-1 / 6001 / 10000 / 3.5` **四个都抛错**；`input.vault.wethBps` 用观测域（可到 10000）不算越界 | ✓ |
| B6 | 字节稳定 | 同输入两次 `sha256` 相同；无 BOM；无行尾空格；末尾恰一个 `\n` | |
| B7 | 哈希口径（**必须带 `0x`**） | `cast keccak 0x$(xxd -p -c 1000000 <file> \| tr -d '\n')` == 我独立算的值 == CRE planHash == 链上事件 planHash。**canary**：`cast keccak 0x616263` 必须等于 `0x4e03657a…`；不带 `0x` 会算成字符串 `"616263"`（`0x656fed88…`） | ✓ |
| B8 | `degraded` 必填 | schema 里**不是** `optional().default(false)`；缺字段直接抛错 | |
| **B9** | **model 三字段齐全（12 处）** | 三轮 + `final` 都有 `model` / `promptTemplateSha` / `temperature`；`temperature` **一律 0**（非 0 必须 `nondeterministic: true`）；`final` 也不能漏（judge 是第四次调用） | ✓ |
| **B10** | **prompts 入库且哈希可复算** | `src/backend/prompts/{bull,bear,risk,judge}.txt` 存在且 git 跟踪；`cast keccak 0x$(xxd -p -c 1000000 <file>)` 每个文件 == 计划文件里对应 `promptTemplateSha`（4 个逐个对，不是抽查一个）。**已实测参考值见 PRD §7.2 表**（bull `ceb2a196…` / bear `3497e792…` / risk `2854e9da…` / judge `d37d3c2b…`） | ✓ |
| **B11** | **serializePlan 往返逐字节一致** | `serializePlan → parsePlan → serializePlan` 与原文**逐字节相等**（不是"解析不报错"）。这是防"契约加字段、写入器没跟"的回归 —— 今天真出过 | ✓ |
| **B12** | **degraded 精确值** | `--offline` 样例恰为 `true`；live 样例恰为 `false`。不是"offline 可以是 true"，是**必须** | ✓ |
| **B13** | **validitySeconds 默认 900** | 默认值 == 900（不是 1800）；`--check` 断言 `plan.validitySeconds <= 3600`（`MAX_PLAN_AGE`） | ✓ |

## C. CRE workflow（P3）—— `src/backend/cre`

| # | 检查 | 判据 | 手工 |
|---|---|---|---|
| C1 | 工程可 install | `cre/project.yaml`、`cre/alpha-plan/workflow.yaml` 存在；`bun install` 无错 | |
| C2 | RPC 正确 | 两个 target 都是 `ethereum-testnet-sepolia-base-1` + `https://sepolia.base.org` | |
| C3 | 三个 target | `workflow.yaml` 含 `local-simulation`（`deployment-registry: private`） | |
| C4 | cron 六段 | 所有 config 的 `schedule` 为六段 `0 */10 * * * *` | |
| C5 | 禁用 API | 无 `z.string().url(`、无 `await <capability>`（须 `.result()`）、无 `process` / `Buffer` / `Date.now(` | |
| C6 | 聚合 identical | `planHash` / `planId` / `targetWethBps` 用 `identical`，不是 `median` | |
| C7 | simulate 跑通且日志齐全 | 退出 0，日志含：真实持仓、feed 价、planHash、**`degraded` 判定**、**`planUsed` 结果**、`wouldWrite`。不发交易 | ✓ |
| C8 | 报告不带价格 | 报告 6 字段里无价格；`minOut` 由合约用 oracle 推 | ✓ |
| C9 | workflow 侧校验 | `asOf` 时效（`asOf<=now` 且 `now−asOf<=3600`）/ `validUntil` / `target∈[0,6000]` / `nonce==lastNonce+1` 四项都在（链上会再查一遍，这里是早失败） | ✓ |
| **C10** | **degraded 前置门顺序 + 模拟路径也执行** | 源码里 degraded 检查的行号 **<** planUsed 检查的行号；且两者都在 `mode === "local-simulation"` 的提前返回**之前**。三条路径逐个跑：① live → `wouldWrite: true`；② 同命令第二次 → `plan already executed, skipping`；③ offline 计划 → `degraded plan, refusing to write`，**且此时 planUsed 为 false 也不写** | ✓ |

## D. 广播与对账（P4）

| # | 检查 | 判据 | 手工 |
|---|---|---|---|
| D1 | 已部署 | 合约地址记录在 README；`cast code` 非空 | |
| D2 | 已入金 | 金库 USDC ≥ 100e6（或按 R1 用 MockUSDC，README 注明，不得冒充官方 USDC） | |
| D3 | 广播成功 | `--broadcast` 得 txHash；`cast receipt --json status` == `0x1` | |
| D4 | 事件解码 | 从 receipt 解出 `PlanExecuted` **或** `PlanRecorded`（截断/容差时会走后者），取 planHash + asOf + nonce | |
| D5 | verify 脚本 | `bun run verify <tx>` 退出 0，只打一行 `OK: ...` | |
| D6 | **我独立复算** | 不用他们的脚本：`cast keccak 0x$(xxd -p -c 1000000 <file> \| tr -d '\n')` == 链上 planHash | ✓ |
| D7 | 反重放 | 同一份计划再报一次 → revert（`planUsed`）；60s 内第二次报告 → revert（`MIN_INTERVAL`） | ✓ |
| **D8** | **verify 的第二层时效校验（4 项）** | `report.asOf == file.asOf`；`file.asOf + file.validitySeconds == report.validUntil`；`keccak(prompts/<agent>.txt) == rounds[i].promptTemplateSha`（4 个）；`planUsed` 未被绕过。失败时打印两个哈希并退出非 0 | ✓ |

## E. 前端（P5）—— `src/frontend/alpha-plan`

用 ego-browser 打开 `pnpm build && pnpm start` 逐项核对，**并用 `cast` 独立取数比对**，
不接受"数字非零"。

| # | 检查 | 判据 | 手工 |
|---|---|---|---|
| E1 | 能构建 | `pnpm build` 退出 0，无类型错 | |
| **E1b** | **P1 浏览器直连（裁定：不加 `/api/rpc` 代理）** | 页面由浏览器直连 `127.0.0.1:8546`。**RPC 不可达是预期行为，不判 FAIL**；判据是：显示「无法连接 127.0.0.1:8546，这个 demo 的链在本地」这类**可读提示**，既不白屏、也不假装成功（不显示 0、不显示假数字）。我验时会**停掉 anvil** 复跑一次确认这条。**另：验收前必须先确认只有一套环境** —— 12:51 采集到 :8546 与 :8546 各有一个 anvil，金库地址在不同端口上含义不同（同一地址在 :8546 有代码、:8546 为空），`/tmp/alphaplan-demo-env` 又指向其中一个。以 PM 最后锁定的那套为准，读错端口会得到看似合理实则错位的数字 | ✓ |
| E2 | 金库区块 | NAV / 份额价格 / 现金% / WETH% / 总份额 五项全在，且**与我 `cast` 读出的值一致**（含小数位与四舍五入方向）；读不到时显示 `—` 并标原因，**不要显示 0** | ✓ |
| E3 | 最新计划 | planId、bull/bear/risk（仓位+信心+理由+model）、judge 裁决、planHash 全在 | ✓ |
| **E4** | **徽章 = 4 项全对才 ✓** | ① `keccak(file bytes) == planHash` ② `plan.asOf == report.asOf` ③ `plan.asOf + validitySeconds == report.validUntil` ④ 4 个 `promptTemplateSha` 对得上仓库 prompts。**服务端**做，不是浏览器 | ✓ |
| **E5** | **负向测试（4 个篡改，必须 ✗ 且不白屏）** | ① 改文件一个字节 → ①✗ ② 改 `asOf` → ②✗ ③ 改 `validitySeconds` → ③✗ ④ 改一个 `promptTemplateSha` → ④✗。任一情况页面其余区块照常渲染 | ✓ |
| E6 | 计划历史（策略流） | 每条含 目标 vs 实际、偏离、tx 链接；`PlanRecorded`（未交易）也要出现并标注"未交易" | ✓ |
| **E6b** | **两条流分开渲染 + `LiquiditySold` 是渲染列不是 tooltip** | ① 历史区有**可视化分区**（两个分区标题或一条 `category` 列），不是同一张表里换个颜色；② `LiquiditySold` 行的 `category` **必须渲染出来**且文案明确为「流动性调整（非计划交易）」—— 在 tooltip / 折叠面板 / hover 里才可见 = FAIL（截图时看不见，评委抓的就是这个）；③ 该行显示 `wethIn` / `usdcOut` / `shares` / 块号 / tx 链接（5 项，缺一即 FAIL）；④ **数据来源按 PM 裁定**：从 `redeem` 那笔 tx 的 receipt logs 里 decode `LiquiditySold`，**不额外发 RPC** —— 我验时会核对 Network 面板：历史区加载不应产生 per-tx 的额外 `eth_getLogs`/`eth_getTransactionReceipt` 请求风暴 | ✓ |
| **E6c-1** | **硬对账（差分净额口径）** | 两条平衡式（**按实现的净额口径判**，不要求"只统计 swap tx"）：<br>`balance(N) − balance(deployBlock−1) == Transfer.in − Transfer.out`（只算 `from/to == vault`，`topic0==Transfer`）<br>USDC 与 WETH 各一条，**均须严格相等**。① 差分，禁止 `in−out==balance`；② **快照一致性**：一个 `N` 用到底（`getLogs.toBlock`、`balanceOf.blockNumber`、UI 显示三处同源）；③ UI 显示两个端点块号；④ 不等时显示差额数值+块号区间。<br>**为什么放宽**：净额口径每条 Transfer 只数一次，**天然免疫存款双计**，比"按事件分类求和"更稳（PM 14:10 验证实现并认可） | ✓ |
| **E6c-2** | **解释层（不是判定依据）** | 分项显示 价格效应 / 期间费用 / 已实现滑点；端点 feed 陈旧时显示「无法估值对账」+ **缺哪个源**（哪个 feed、age 多少）；**不得出现"通过/不通过"字样**——它是解释，不是判据。任何把它渲染成绿勾/红叉的实现 = FAIL | ✓ |
| **E6c-3** | **四条负向测试（必须都能红）** | ① 改一笔 `LiquiditySold.usdcOut` → 非零差额；② **把同一条 Transfer 的金额同时计入 `in` 和 `out`** → 必须不闭合（净额口径下这才是有效的"双计"用例；"删掉 Deposit 事件"对它不适用）；③ **快照错位**：`balanceOf` 用 `latest` 而 `getLogs` 用 `toBlock` → 必须不闭合；④ 分块失效：把 `LOG_CHUNK` 调到 >300 → 大跨度必然被上游拒（E6c-d3 已覆盖）。**四条任一仍显示闭合 = FAIL** | ✓ |
| **E7a** | **钱包连接后必须显示网络标识** | 连接钱包后，页面必须显示 `chainId` 或网络名（当前 `31337`；应为「本地 anvil fork」而非「Base Sepolia」）。**只说「已连接」不算** —— 用户需要知道自己在哪条链上 |
| **E7b-1** | **chainId ≠ 31337 → 警告** | 当前环境 `--chain-id 31337`。钱包连到别的链（如 `0x1` 主网 / `0x14a34`=84532）时，页面必须显示可见警告，不能静默继续 |
| **E7b-2** | **chainId 正确但 `eth_getCode(VAULT)` === `0x` → 也警告** | chainId 相同不代表 RPC 相同：用户可能连着别的 31337 网络（如裸 anvil，上面 USDC/WETH/Router 全无代码）。MetaMask 只看 chainId 不区分 RPC。判据用**探测法**（`window.ethereum` 不暴露 RPC URL）：连上后调 `eth_getCode(VAULT, "latest")`，返回 `0x` 或抛错即判连错链 |
| **E7b-3** | **两者都正常 → 无警告** | 不得常驻显示警告（会变成噪音，用户学会忽略） |
| **E7c** | **任何余额必须标注归属地址** | 页面不得出现"裸数字"。`6.0000 ETH` 这种必须能追溯到它属于哪个地址（`0x802f…4d87`），否则用户无法判断这是金库的、自己的、还是别人的 |
| ~~E7（旧）~~ | ~~不暗示钱包连接/申赎表单~~ | **判据已作废**（见 §2.16）：用户原始需求就包含"连钱包、买基金、卖基金"，PM 已推翻 PRD §13 的 v1 范围限制 |

### 2.18 E7 验证受阻：真 MetaMask 覆盖桩 + w3m-modal 为空

**注入桩方案在这台机器上走不通**（按 PM 指示做过）：

```
CDP Page.addScriptToEvaluateOnNewDocument 注入 EIP-1193 桩（anvil account0）
结果：
  window.ethereum.isE7Stub  = false      ← 桩没拿到 window.ethereum
  window.ethereum.chainId   = "0x7a69"   ← 31337，真 MetaMask 报的
  eip6963 announce          = ["E7 Stub", "MetaMask"]   ← 两个 provider 都在
```

真扩展在 `document_start` 之后覆盖了 `window.ethereum`，桩只抢到 EIP-6963 announce。
要走通得让 AppKit 偏好选 Stub —— 那是 frontend 的代码，我不改。

**但 E7b-2 的探测法已用真钱包验证有效**（这是该判据的核心技术）：

```
eth_chainId  → "0x7a69"（31337 = 当前环境）      → 不触发 E7b-1
eth_getCode(VAULT) → 完整字节码 39561 B         → 说明它连的 RPC 指向本地 anvil
若连真 Base Sepolia → 返回 "0x"                 → 触发 E7b-2 场景
```

→ **探测法不依赖 RPC URL 暴露，分支可分辨。设计成立。**

**发现的 AppKit 缺陷（未定判）**：点「连接钱包」后 `w3m-modal` 挂载、`shadowRoot` 存在，
但 CDP `DOM.getDocument({pierce:true})` 读穿所有 shadow 层后，**只有 CSS，没有任何钱包选项**。
未注入桩时同样为空。三种可能：

a) AppKit 版本与 Next 16 的交互问题
b) 需要真实用户手势（CDP click 可能不算）
c) 网络隔离导致 provider 列表拉不到

**我不猜**。交给 frontend 用真浏览器点一次：他们看到空 = bug；他们有内容 = 我的 CDP 手势问题。

#### 判据必须标注「在哪一屏验证」

本轮第二次踩同类错误（第一次是 E6c-d3 依赖 span 小）：E2 回归脚本在**总览屏**找金库数字，
四项误报 FAIL，切到「金库与流水」后五项全在。

**规则**：每条 E 线判据必须写明 ① 所属屏 ② 是否需要先点击切屏。
否则换个屏就假红 —— 这比判据本身写错更难发现，因为页面"看起来是对的"。

### 2.20 换端口 8546 的复核 + 我自己的假绿 R3（14:46~14:49）

**新环境 7 项复核一致**（见 §0）。判据已全部更新：`8545 → 8546`、`DEPLOY_BLOCK 49512360`、
`/tmp/alphaplan-demo-env` 同步。部署闸门 D0 在新环境 PASS。

**两个需要注意的环境事实：**

1. **块时间差 −41s 且在扩大**（PM 报的是 ~11s）。anvil 无交易不出块，`--timestamp` 只在启动时对齐。
   不影响合约判据（用 `block.timestamp`），但**演示前必须 `anvil_mine` 一次**，
   否则 `MAX_PLAN_AGE`（3600s）以块时间为准，看起来"计划很新鲜"而墙钟已过 1 小时。
2. **前端端口期间从 3000 跳到 3600 又回到 3000**。我一度以为闸门坏了，先查 `lsof` 才确认是端口变了。
   **worker 换端口需要告知**，否则"没响应"会被误报成 FAIL。

#### 我自己的假绿：R3「没有不一致就算过」

新环境 `lastNonce=0`，页面显示「链上哈希未采集」。
但 R3 原判据是「页面里没有『不一致』→ PASS」—— **没得比的时候，"没有不一致"毫无意义**。
与 AGENTS.md 第 7 例「依赖当前恰好成立的状态」完全同类。

改成三态：

| 页面状态 | 判定 |
|---|---|
| 显示「一致」 | **PASS** |
| 显示「不一致」 | **FAIL** |
| 「链上哈希未采集」 | **SKIP**（明确说"未被真正检验"） |
| 两者都没有 | **FAIL**（状态不明，需人工看） |

**改的过程中又发现自己的正则写错**：`/\b一致\b/` 在中文里**永远不匹配**
（`\b` 是 ASCII word boundary，中文不是 word char）。
换成 `/(^|\n)\s*一致\s*($|\n)/m`。四用例验证：不一致→FAIL / 一致→PASS / 未采集→SKIP ✅

#### 空环境 = 事务类判据 SKIP，不是 PASS

`PlanExecuted` / `PlanRecorded` / `LiquiditySold` 均 0 条 → E3、E4、E6b、E6c-1、D3、D7 无法验证。
**要验这些必须重新生成计划 + 执行 `onReport`；A11b–A11g 需要主动写链。这些必须 PM 协调。**

## R. 渲染层闸门（`.qa/render-gate.mjs`）

机械闸门（`verify-mechanical.sh`）只看文件与链上，**看不到渲染结果**。
E 线的三个真问题（哈希显示不一致、浮点未格式化、裸钱包余额）全被它漏掉了。
所以补这一层：用 `ego-browser` 读 `document.body.innerText`，判文案与格式，**不判像素**。

```bash
# 用 $PWD 而不是写死绝对路径 —— 换机器、换目录都要能跑
ego-browser nodejs -e "await import('file://' + process.env.PWD + '/.qa/render-gate.mjs')"
```

| # | 判据 | 抓什么 |
|---|---|---|
| **R1a** | 服务端 HTML 含品牌名 | 整页崩成空壳 |
| **R1b** | 侧栏/导航/L2 横幅在**服务端** HTML 里 | 首屏白一下（demo 时很难看） |
| **R2** | 所有 `bps` 最多 1 位小数 | 浮点未格式化（`-466.66666666666674 bps`） |
| **R3** | 页面不出现「不一致」 | 哈希自验失败 |
| **R4** | ETH 余额必须带地址归属 | 裸显示不属于本产品的数字 |
| **R5** | 连接钱包时必须显示网络标识 | E7a |

**设计要点：R4/R5 依赖钱包连接状态。**
钱包未连时它们天然 PASS —— 那正是「依赖当前恰好成立的状态」的老毛病（第 7 例）。
所以这两条在未连接时**报 SKIP 而不是 PASS**，明确说"本条未被真正检验"。

**正向验证（14:33 实做）**：临时把 R2/R3 的问题改掉 → 两条转绿；立刻还原（`diff -q` 确认无残留）。
闸门能红也能绿，不是永远红或永远绿的装饰。

---

## F. 文档与交付（P6）

| # | 检查 | 判据 |
|---|---|---|
| **F1g** | **README 声明链是本地 anvil fork** | 明确写出「本项目链是本地 anvil fork（`--fork-url https://sepolia.base.org`），金库地址在公共 Base Sepolia 上无代码」。我已实测证伪可验：金库 `0x6ee38cdf…` 在本地 `cast code` = 39560 bytes，在公共 `https://sepolia.base.org` = `0x`（空）。README 里没有这句 = FAIL —— 否则评委拿地址去 BaseScan 会看到空合约，直接判造假 | |
| **F1a** | **顶部保真度横幅（判实质三要素）** | README **前 40 行**必须同时含：① `L1/L2` 或 `不是 L3`；② `DON 不会真的定时执行`；③ `Deploy Access`。**不判某个词**——按单个词 grep 会假红（见 §2.12）。判据来源 `docs/PRD.md:738-740`。放 §9 内部 = FAIL | ✓ |
| **F1b** | **§9 恰 8 条、逐条未软化** | 用 `awk` 锚定到**标题行** `^#{2,6}\s.*诚实边界`（不能匹配正文里的锚点链接，否则 BODY 恒空 → 假红），到下一个同级标题截止；条目数必须**恰为 8**（7 = 少了，9 = 混入别的节或新增未申报）。8 条：①L1/L2 ②不保证策略 ③model/prompt 是自述 ④赎回依赖池子 ⑤只支持 USDC/WETH ⑥owner 三不能 ⑦静态文件 ⑧第一笔存款是开发者 | ✓ |
| F2 | 快速开始可复制执行 | 每条命令退出 0 |
| F3 | docs 已提交 | `git ls-files docs/` |
| F4 | 无密钥入库 | 无 `.env*`（`.env.example` 除外）；tracked 文件无 32 字节私钥样式串 |
| F5 | 档位说法一致 | 若落到 L3（R2 退路），README **与** 视频台词都必须逐字声明"本节演示合约逻辑，DON 签名路径见 simulate 日志"；只在 README 写、台词不说 = FAIL |
| F6 | 可追溯性 | PRD §12 每条都能指到本文件某一项（我维护映射，不需要工人做） |

---

## 陷阱（踩到就是返工）

1. **feed 已是 16 分钟前的**。实测 ETH/USD `updatedAt` 与当前块差 956s。≤15min 的陈旧阈值会让
   `totalAssets()` 现场 revert，前端 NAV 直接空白。
2. **位数**：USDC 6 / WETH 18 / feed 8。`0.04e18 × 2000e8 / 1e20 = 80e6`，少一个 1e2 就是 100 倍误差。
3. **两把锁不同职责**：`nonce` 防报告重放，`planUsed` 防同一计划跨周期重放。两条**各写各的用例**，
   别因为一条挡住了就跳过另一条。
4. **哈希只算原始字节**。`JSON.parse` 再 `stringify` 会改键序/空格，链上立刻对不上。
5. **schema 分域**：`target` 是决策（0..6000），`wethBps` 是观测（0..10000）。合并回一个 `bps` = 6001 又能溜进去。
6. **`degraded` 不能靠 revert 兜底**：靠 catch `TX_STATUS_REVERTED` 既难看（红色错误）又每 10 分钟白烧 gas。
7. **`.env` 里有明文 Chainlink 账号恢复码**（未入库 ✅，但工作目录是明文，录屏/共享时注意）。
8. **`cast keccak` 必须带 `0x`**。`cast keccak $(xxd -p f)` 算的是 ASCII 十六进制**字符**（`abc` → `0x656fed88…`），
   `cast keccak 0x$(xxd -p f)` 才是字节（`0x4e03657a…` = `keccak256("abc")`）。
   另：`xxd -p -c 100000` 在文件 >100KB 时会折行，`$( )` 内部换行会毁掉命令；用 `-c 1000000 \| tr -d '\n'`。

---

## 我这边的交付物

- `docs/ACCEPTANCE.md`（本文件）—— 唯一验收口径；改判据必须改这里
- `.qa/verify-mechanical.sh` —— 一条命令跑完 A1–A18 / B / C / E1 / F 的机械项
- 每轮验收输出：**结论 → 失败项的 文件:行 + 期望 vs 实际 → 复现命令**
