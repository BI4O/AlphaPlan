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

## 0. **锁定环境（PM 冻结，2026-10-24 12:53，块 49478398）**

```
VAULT_ADDRESS = 0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b
DEPLOY_BLOCK  = 49478393
RPC_URL       = http://127.0.0.1:8545
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
- **只有一个 anvil**（`:8545`）、一个 env 文件 ✅

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
| **E1b** | **P1 浏览器直连（裁定：不加 `/api/rpc` 代理）** | 页面由浏览器直连 `127.0.0.1:8545`。**RPC 不可达是预期行为，不判 FAIL**；判据是：显示「无法连接 127.0.0.1:8545，这个 demo 的链在本地」这类**可读提示**，既不白屏、也不假装成功（不显示 0、不显示假数字）。我验时会**停掉 anvil** 复跑一次确认这条。**另：验收前必须先确认只有一套环境** —— 12:51 采集到 :8545 与 :8546 各有一个 anvil，金库地址在不同端口上含义不同（同一地址在 :8545 有代码、:8546 为空），`/tmp/alphaplan-demo-env` 又指向其中一个。以 PM 最后锁定的那套为准，读错端口会得到看似合理实则错位的数字 | ✓ |
| E2 | 金库区块 | NAV / 份额价格 / 现金% / WETH% / 总份额 五项全在，且**与我 `cast` 读出的值一致**（含小数位与四舍五入方向）；读不到时显示 `—` 并标原因，**不要显示 0** | ✓ |
| E3 | 最新计划 | planId、bull/bear/risk（仓位+信心+理由+model）、judge 裁决、planHash 全在 | ✓ |
| **E4** | **徽章 = 4 项全对才 ✓** | ① `keccak(file bytes) == planHash` ② `plan.asOf == report.asOf` ③ `plan.asOf + validitySeconds == report.validUntil` ④ 4 个 `promptTemplateSha` 对得上仓库 prompts。**服务端**做，不是浏览器 | ✓ |
| **E5** | **负向测试（4 个篡改，必须 ✗ 且不白屏）** | ① 改文件一个字节 → ①✗ ② 改 `asOf` → ②✗ ③ 改 `validitySeconds` → ③✗ ④ 改一个 `promptTemplateSha` → ④✗。任一情况页面其余区块照常渲染 | ✓ |
| E6 | 计划历史（策略流） | 每条含 目标 vs 实际、偏离、tx 链接；`PlanRecorded`（未交易）也要出现并标注"未交易" | ✓ |
| **E6b** | **两条流分开渲染 + `LiquiditySold` 是渲染列不是 tooltip** | ① 历史区有**可视化分区**（两个分区标题或一条 `category` 列），不是同一张表里换个颜色；② `LiquiditySold` 行的 `category` **必须渲染出来**且文案明确为「流动性调整（非计划交易）」—— 在 tooltip / 折叠面板 / hover 里才可见 = FAIL（截图时看不见，评委抓的就是这个）；③ 该行显示 `wethIn` / `usdcOut` / `shares` / 块号 / tx 链接（5 项，缺一即 FAIL）；④ **数据来源按 PM 裁定**：从 `redeem` 那笔 tx 的 receipt logs 里 decode `LiquiditySold`，**不额外发 RPC** —— 我验时会核对 Network 面板：历史区加载不应产生 per-tx 的额外 `eth_getLogs`/`eth_getTransactionReceipt` 请求风暴 | ✓ |
| **E6c-1** | **硬对账（差分 + 快照一致 + 归类不重复）** | 两条恒等式，`Δ` **必须是差分**，且**每个 Transfer 只能进一个口袋**：<br>`balance(N) − balance(deployBlock−1) == ΣdepositAssets − ΣwithdrawAssets − Σbuy.usdcIn + Σsell.usdcOut + ΣLiquiditySold.usdcOut`<br>`balanceWETH(N) − balanceWETH(deployBlock−1) == Σbuy.wethReceived − Σsell.wethIn − ΣLiquiditySold.wethIn`<br>① **禁止** `in−out == balance`（期初非 0 必假红，§2.10）；② **快照一致性**：一次请求先 `getBlockNumber() → N`，`getLogs.toBlock`、`balanceOf.blockTag`、UI 显示三处同用 `N`；③ UI 显示**两个端点块号**；④ **归类必须按事件归类、不能按"所有 Transfer"归类**：`to==vault` 的 USDC Transfer 里既有存款也有 swap 到手，必须**只统计带 `PlanExecuted`/`LiquiditySold` 的那笔 tx**，否则存款被算两次（§2.11 实测 20,000,000 量级）；⑤ 严格相等，不等时显示差额数值 + 块号区间 | ✓ |
| **E6c-2** | **解释层（不是判定依据）** | 分项显示 价格效应 / 期间费用 / 已实现滑点；端点 feed 陈旧时显示「无法估值对账」+ **缺哪个源**（哪个 feed、age 多少）；**不得出现"通过/不通过"字样**——它是解释，不是判据。任何把它渲染成绿勾/红叉的实现 = FAIL | ✓ |
| **E6c-3** | **四条负向测试（必须都能红）** | ① 改一笔 `LiquiditySold.usdcOut` → 非零差额；② **删掉一条 `Deposit`** → 闭合破坏；③ **把一条 `Deposit` 的金额同时计入存取侧与 swap 收到侧** → 必须显示非零差额（专验 §2.11 重复计算）；④ **快照错位**：`balanceOf` 去掉 blockTag 而 `getLogs` 仍用 `N`，中间插一笔交易 → 闭合破坏（专验 §2.10 的 `N` 一致性）。**四条任一仍显示闭合 = FAIL** | ✓ |
| E7 | 无越界承诺 | 不暗示钱包连接/申赎表单/图表/自动轮询（PRD §13）；不出现"保证收益"类措辞 | ✓ |

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
