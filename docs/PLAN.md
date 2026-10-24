# 实施计划 — AlphaPlan

配套：[PRD.md](./PRD.md)。本文件只回答"先做什么、怎么验证、卡住怎么办"。

目标：**半天内跑出可演示的完整闭环**（存入 → AI 辩论 → CRE 模拟 → 上链 → 前端哈希 ✓ → 复算对账），
每一步都有可执行的验证命令，不靠"看起来对了"。

---

## 阶段总览

| 阶段 | 内容 | 验证方式 | 预估 |
|---|---|---|---|
| P0 | 三端骨架确认 + 依赖 | `forge build` / `bun install` / `pnpm build` | 20 min |
| P1 | `AlphaPlanVault` + 测试（`src/contract`） | `forge test` 全绿 | 90 min |
| P2 | AI 辩论层 + 计划文件（`src/backend`） | `bun run debate --check` 退出码 0 | 40 min |
| P3 | CRE workflow（`src/backend/cre`） | `cre workflow simulate` 非交互跑通 | 60 min |
| P4 | 广播 + 对账脚本 | `bun run verify <tx>` 退出码 0 | 40 min |
| P5 | 前端单页（`src/frontend/alpha-plan`） | 页面显示 ✓ 哈希一致 | 60 min |
| P6 | README / demo 录制 | 按 PRD §11 走一遍 | 30 min |

**并行关系**：P1、P2、P5 互不依赖，可并行。P3 依赖 P1 的 ABI + P2 的文件格式。
P4 依赖 P1/P2/P3。P5 只依赖 P4 产生的一笔交易（没有也能用 mock 渲染）。

**砍的顺序**（时间不够时从下往上砍）：P2 退化为单 agent 静态文件 → P5 只做只读静态页
→ 都保留 P1+P3+P4，那是产品本体。

---

## P0 — 骨架与依赖

现有目录（**不要改动结构**）：

```
src/
├── contract/          # 空
├── backend/           # 空
└── frontend/alpha-plan/   # Next 16.4.2 脚手架已完成，pnpm 已装
```

### 合约端

```bash
cd src/contract
forge init --no-git --force .
forge install OpenZeppelin/openzeppelin-contracts --no-git
```

> 只装 OpenZeppelin。Uniswap 走手写接口（`ISwapRouter` 只需要
> `ExactInputSingleParams` + `exactInputSingle`），引 `@uniswap/v3-periphery`
> 会带进一堆 npm 依赖，不划算。

**要补一条根 `.gitignore`**：现有规则有 `out/`、`build/`、`dist/`，但没 `cache/`，
而 Foundry 默认往 `cache/` 写构建缓存。加一行 `cache/`，否则每次 `forge build` 都有脏文件。
（这是唯一需要改动根级文件的地方。）

验证：`forge build` 通过；`remappings.txt` 含 `@openzeppelin/=lib/openzeppelin-contracts/`；
`git status` 里没有 `cache/`。

### 后端

```bash
mkdir -p src/backend/src src/backend/plans
cd src/backend && bun init -y && bun add viem zod
```

> 后端**只有一个 package.json**，flat 结构：`src/debate.ts`、`src/schema.ts`、
> `src/verify.ts` 都放在 `src/` 下。不嵌套、不建 workspace —— 前端 `alpha-plan/`
> 已经锁了 pnpm，混一个 workspace 进来只会让两个 lockfile 打架。

### CRE 工程

`cre init` 会在**当前目录下创建 `<project-name>/`**（实测，`--project-root` 不能改这个行为）。
所以要到 `src/backend/cre`，必须**在 `src/backend` 里执行**，用 `cre` 作为 project-name：

```bash
cd src/backend
cre init --non-interactive \
  --project-name cre \
  --deployment-registry private \
  --workflow-name alpha-plan \
  --template hello-world-ts
```

产出（实测结构）：

```
src/backend/cre/
├── project.yaml            # 各 target 的 RPC（生成的默认是 ethereum-testnet-sepolia，要改）
├── secrets.yaml
├── .gitignore              # 只有 *.env
└── alpha-plan/             # workflow 目录
    ├── workflow.yaml       # staging-settings / production-settings
    ├── config.staging.json
    ├── config.production.json
    ├── main.ts
    └── package.json
```

> 用 `private` **只**为了本地模拟不需要 registry 绑定。真要部署才需要
> `onchain:ethereum-mainnet`（`cre registry list` 里那个）。

生成后**必须改**的三处：

1. `project.yaml` 两个 target 的 `rpcs` 改成
   `chain-name: ethereum-testnet-sepolia-base-1` + `url: https://sepolia.base.org`
2. `workflow.yaml` 增加第三个 target `local-simulation`（`deployment-registry: "private"`，
   `config-path: "./config.local-simulation.json"`）
3. 两个 config 的 `schedule` 改成六段 `0 */10 * * * *`（生成的是 `*/30 * * * * *`，30 秒一次）

然后装依赖（含 `cre-setup`，它把 TS workflow 的 WASM 工具链补上）：

```bash
cd src/backend/cre/alpha-plan && bun install && bunx cre-setup
```

验证：`src/backend/cre/project.yaml` 存在；`alpha-plan/workflow.yaml` 有三个 target；
`bun install` 无报错。

---

## P1 — 合约（`src/contract`）

### 文件

| 文件 | 内容 |
|---|---|
| `src/interfaces/AggregatorV3Interface.sol` | 20 行 |
| `src/interfaces/ISwapRouter.sol` | `ExactInputSingleParams` + `exactInputSingle` |
| `src/AlphaPlanVault.sol` | ERC4626 + Ownable + `onReport` |
| `test/AlphaPlanVault.t.sol` | 见下 |
| `test/mocks/MockFeed.sol` / `MockRouter.sol` | 可控返回值 |

### 实现顺序（每步先写测试）

1. **部署与初始化** — immutable 非零、`asset() == USDC`、`decimals() == 6`
2. **`totalAssets()`** — mock feed 2000e8，金库 100 USDC + 0.04 WETH
   → `100e6 + 0.04e18 * 2000e8 / 1e8 = 180e6`；含 feed 陈旧 revert 用例
3. **deposit / redeem** — 初始 1:1；涨价后赎回更多；`paused == true` 时 `redeem` 仍可用
3b. **赎回自动卖 WETH**（PRD §3.5，对应 ACCEPTANCE A11b–A11e）—— 四种情形各自一个用例：
   - 现金充足 → `router` **零调用**，不 emit `LiquiditySold`
   - 现金不足 → `router.exactInputSingle` 调用次数 **1 ≤ n ≤ 4**（**池子足额成交时必须 n == 1**），
     `tokenIn=WETH`/`tokenOut=USDC`/`recipient=vault`；**第 1 笔** `amountIn == ceilDiv(shortfall × 1e20, price)`
     （**精确断言，不是上界**）；补卖笔 `amountIn ≤ ceilDiv((deficit+2) × BPS × 1e20, (BPS−50) × price)`；
     卖出后 USDC 零头 ∈ **`[0, 3]` wei**，emit 一次 `LiquiditySold`
   - 卖出后仍不足 → revert `InsufficientLiquidity(required, cashAvailable, wethValue)`（自定义 error，
     `vm.expectRevert(AlphaPlanVault.InsufficientLiquidity.selector)`，不用空 `expectRevert()`），状态全回滚
   - **逐笔**断言 `amountOutMinimum == expectedOut × (10000−50) / 10000`（不是整次 redeem 只有一笔）；
     `amountOut == minOut` 通过、`minOut − 1` revert
   另断言 `maxRedeem`/`maxWithdraw` 在现金不足时返回现金可覆盖部分，而超出该值的 `redeem` 仍成功
4. **`currentWethBps()`** — 全现金 0；全 WETH ≈ 10000；空金库 0（不 panic）
   ；**WETH 涨价后实测值可 > 6000**（观测值不受仓位上限约束）
5. **`onReport` 校验矩阵** — **10 个 `vm.expectRevert` + 1 个正常路径断言**：
   sender 错 / vault 错 / paused / 太频繁 / `asOf > now` / `now - asOf > MAX_PLAN_AGE` /
   validUntil 过期 / nonce 不连续 / `targetWethBps > 6000` / `planUsed[planHash]` 已为 true
   —— 这 10 条各自 revert；第 11 条「偏离 ≤ 容差」**不 revert**，断言产出的是
   `PlanRecorded` 事件、`router` 零调用、`lastNonce` 已推进。

   > 写成「11 条各一个 `vm.expectRevert`」是错的：容差是正常分支，
   > 那样会逼出一个"只有错误实现才能通过"的测试。
6. **`asOf` 边界**
   - `asOf == now` → 通过（上界是闭区间）
   - `asOf == now - MAX_PLAN_AGE` → 通过（下界也是闭区间）
   - `asOf == now - MAX_PLAN_AGE - 1` → revert
   - `asOf == now + 1` → revert
   - 常量断言 `MAX_PLAN_AGE == 3600`

   > **合约看不到计划文件**，所以 forge 里无法断言 `MAX_PLAN_AGE >= validitySeconds`。
   > 合约侧只能断言常量本身；`900 <= 3600` 是后端 / verify 的断言（ACCEPTANCE B13）。
7. **`planUsed` 幂等（新增）**
   - 同一 `planHash` 第二次提交 → revert，即使 `nonce` 已递增、`asOf` 仍新鲜
   - 断言被拒后状态不变（`lastNonce` / `lastExecutedAt` 不推进）
   - 断言 `planUsed[planHash] == true` 在**交易路径与容差路径都**被置位
8. **swap 执行** — mock router 记录入参：
   - 目标 3000、当前 0 → 用 USDC 买，`tokenIn == USDC`
   - 目标 0、当前 3000 → 卖 WETH，`tokenIn == WETH`
   - `amountOutMinimum` 与 oracle 价的偏差恰为 `SLIPPAGE_BPS`
   - 偏离 ≤ 300bps → **不调 router，但仍发事件、消耗 nonce**
9. **仓位上限截断** — 目标 6000、当前 0、NAV 1000 → 买入后现金恰为 400，不再触发
   独立的现金下限（**该参数已删除**，见 PRD §3.2 的死代码证明）。
   额外断言：买入量被 `MAX_SWAP_BPS` 截断时，`planUsed` 仍置位，且**不能**用同一份计划补完
10. **费率：单周期** — `vm.warp(+30 days)` → `accrueFee` → `feeRecipient` 份额 +0.1%；
    同区块重复调用不再累计
11. **费率：多周期近似线性累计**
    - `vm.warp(+90 days)` → 一次 `accrueFee` → **+0.3%**，不是 0.1%（补收，不是只收一期）
    - **「近似线性累计（非严格复利）」不是恒等式**：90 天一次调用得 `1.003000·S`，
      分三次得 `1.001³ = 1.003003·S`，相对差 ≈ 3.0e-6。
      断言用 **相对误差 ≤ 1e-5**，不要断言严格相等（严格相等会失败）
    - 断言余数保留：`+45 days` 后再 `+45 days`，累计恰为 3 期而非 2 期
    - 断言稀释比例：期间新存入资金后，**老持有人被稀释的比例恰为 0.1%**；
      绝对 `feeShares` 变大是正确的（新资金也享用了同期管理），不要断言它不变

### 两个容易写错的地方

- **精度**：USDC 6 / WETH 18 / feed 8。换算统一 `usdcValueOfWeth = weth * price / 1e20`，
  抽成 `internal pure` 并单独测边界（0、极大值、price=0）。
- **`nonce` 与 `planUsed` 职责不同，都要有**：`nonce` 防报告层重放并给事件显式顺序，
  `planUsed` 防同一份计划跨 cron 周期重复执行。测试里两条路径要**分别**覆盖，
  不能因为一条挡住就跳过另一条。

---

## P2 — AI 辩论层（`src/backend`）

### 范围

读权威数据 → 三 agent 并行 → judge 裁决 → 写文件。就这三件事。

```ts
type MarketInput = {
  ethUsd: number; ethUsd24hPct: number;
  btcUsd: number; btcUsd24hPct: number;
  navUsdc: number; wethBps: number;
}
```

- 24h 涨跌幅：两次运行间缓存对比，或读历史 round。取不到填 0 并标 `"degraded": true`
  —— **demo 不能依赖外部服务可用性**。
- 三 agent 用同一次调用 + 不同 system prompt（省时省钱），judge 单独一次。
- 输出走 zod：`targetWethBps` 必须 `0..6000` 整数，越界直接抛错。

### `validitySeconds` 必须与 PRD 一致

默认 **900**（由 cron 周期 600s 推出，见 PRD §5 参数约束）。

代码里如果留了 `DEBATE_VALIDITY_SECONDS` 之类的环境变量覆盖，必须满足两条：
1. 默认值就是 900，不是 1800 或别的；
2. `--check` 断言 `plan.validitySeconds <= MAX_PLAN_AGE (3600)`，
   并明确拒绝超出 PRD 定义的默认值（除非调用方显式说明理由）。

**这条是踩过的坑**：曾经默认写 1800（两个半 cron 周期），与 PRD 的 900 不一致，
而 900 之所以被选成 900 正是因为它刚好覆盖一个周期。数字漂了，语义就没了。

### `degraded` 必填，且降级计划不得上链

`degraded` **必须必填**，不能 `optional().default(false)` —— 默认值会让一次
offline 运行自动伪装成 live 运行，而两者在链上都是同一个 `planHash`，无法区分。

- `--offline` 产出的计划 `degraded: true`
- 任何输入缺失（feed 降级、24h 数据缺失）也标 `degraded: true`
- **workflow 读到 `degraded: true` 必须拒绝生成报告**（PRD §6 第 5 步）

`--check` 要额外断言：offline 样例的 `degraded` 恰为 `true`
（防止有人为了让样例"好看"把它改成 false）。

### prompt 模板必须进仓库

`src/backend/prompts/{bull,bear,risk,judge}.txt`，**提交进 Git**，
文件里存的 `promptTemplateSha` 就是这些文件的 keccak256。
模板里用占位符（如 `{{ETH_USD}}`）标出注入点，实际渲染值放在 `input` 字段里
（渲染结果由 `input` 决定，所以不需要单独哈希整段渲染后的 prompt）。

理由：哈希一个不在仓库里的字符串等于没哈希。别人拿不到模板，就无法复算
「这个 agent 到底被问了什么」，「可验证 prompt」就只是一句声明。

`temperature` 一律 0，否则输出不可复现；确实非 0 就标 `"nondeterministic": true`。

### 文件即证据的硬规则

写文件用**固定序列化函数**（键顺序固定、无尾随空格、UTF-8 无 BOM）。
CRE 对 HTTP 响应原始字节算 keccak256，verify 脚本对文件原始字节算 ——
两边必须是同一串字节。**永远不要 parse 后再 stringify 去算哈希。**

> **踩过的坑（必须一起改）**：schema 加了 `model` / `promptTemplateSha` /
> `temperature` 之后，**唯一的写入器 `serializePlan` 必须同步输出这三个字段**（每轮
> 三个 + `final` 三个 = 12 行），否则写出的文件立刻违反自己的契约：
> `serializePlan → parsePlan` 往返失败，B2 与 B3 会一起 FAIL。
> 契约与写入器必须**同一次提交**改完；只改一侧 = 读写不一致。

### 验证

```bash
cd src/backend
bun run debate            # 生成 plans/<id>.json
bun run debate --check    # zod 通过 + 目标 [0,6000] + 文件字节稳定 + promptHash 可复算
bun run debate --offline  # 不调 LLM，输出固定样例（断网兜底）
```

`--check` 额外做四件断言：
1. 每个 round 的 `promptTemplateSha` == `keccak256(prompts/<agent>.txt 原始字节)`
2. `final` 也有 model/prompt/temperature（judge 是第四个模型调用，不能被漏掉）
3. **`serializePlan` 往返一致**：`parsePlan(parse(serializePlan(plan)))` 不报错，
   且 `serializePlan(往返结果)` 与原文逐字节相同 —— 这条是专门防「契约加了字段、
   写入器没跟着改」的回归
4. `validitySeconds` 默认 900；offline 样例的 `degraded` 恰为 `true`

**`--offline` 必须有**：录 demo 时 API 挂了也能把"哈希对得上"讲完整。

---

## P3 — CRE workflow（`src/backend/cre`）

### handler（单个 cron）

```
1. getNetwork(ethereum-testnet-sepolia-base-1)
2. evm 读：totalAssets / currentWethBps / lastNonce / lastExecutedAt
3. evm 读：ETH/USD latestRoundData → roundId>0、answeredInRound>=roundId、未过期
4. HTTP 取计划文件 → keccak256(原始字节) = planHash
5. 【第 0 步前置】plan.degraded === true
      → runtime.log("degraded plan, refusing to write") → return，不发报告
6. evm 读：planUsed[planHash]
      已用 → runtime.log("plan already executed, skipping") → return，不发报告
7. 校验：asOf 时效、validUntil、targetWethBps ∈ [0,6000]、nonce == lastNonce + 1
8. local-simulation → log 并 return {mode, currentWethBps, target, driftBps, planHash, wouldWrite}
9. production → runtime.report → writeReport → txHash
```

**第 5 步（degraded）必须在第 6 步（planUsed）之前。** 原因不是顺序洁癖：
一份降级计划根本没有现实依据，追问它"执行过没有"毫无意义；而且顺序反了之后，
`planUsed` 会先返回、降级检查变成一条永不触发的死分支。

**第 5、6 步都必须在 `local-simulation` target 下也执行。** 它们只是"读"，不写链，
所以模拟路径完全跑得动。若不执行，模拟与广播两条路径行为分叉：
模拟会说 `wouldWrite: true`，广播却静默跳过，日志对不上，demo 时无法自证。

**这两步都是前置检查，不是靠 catch revert。** `TX_STATUS_REVERTED` 在 CRE 日志里
是红色错误，观感极差；且 gas 照付、状态没变，每 10 分钟白烧一次。

> **`degraded` 是链上审计的关键一环**（PRD §5「降级计划不得上链」）：
> offline 计划与 live 计划在链上都是同一个 `planHash`，无法区分。
> 一旦让降级计划上链，审计记录里就多了一条看起来正常、实则没有现实依据的决策。
> **崩溃会被发现，假决策不会** —— 所以这道门必须在前置检查里，不能靠事后审计。

聚合用 **`identical`**（计划文件是静态的，两个节点读到的必须完全一样；
用 median 会把两份不同的计划静默平均掉）。

### 三条硬约束

1. cron **六段**：`0 */10 * * * *`
2. 不要 `z.string().url()`（QuickJS 无 `URL`），用 `.regex()`
3. 不要 `await` capability，用 `.result()`；不要 `process` / `Buffer` / `Date.now()`

### 验证

```bash
cd src/backend/cre
cre workflow simulate alpha-plan --target local-simulation \
  --non-interactive --trigger-index 0
```

期望日志：真实持仓、真实 feed 价、planHash、**`degraded` 判定**、
**`planUsed` 检查结果（false/true）**、`wouldWrite`。**不产生交易**，这是第一道检查。

三条必须逐个跑到的路径：

1. 用一份 live 计划（`degraded: false`）→ 日志 `wouldWrite: true`
2. 再跑一次同一条命令 → 日志必须是 `plan already executed, skipping`
3. 用 `--offline` 产出的计划（`degraded: true`）→ 日志必须是
   `degraded plan, refusing to write`，**且即使 `planUsed` 为 false 也不写**

第 3 条是链上审计的守门测试：如果它没触发，说明降级检查被放在了 `planUsed` 之后，
或者根本没实现。

---

## P4 — 广播与对账

1. 部署合约到 Base Sepolia（`forge script Deploy`）
2. 存入 100 USDC（需要测试网 USDC；拿不到见 R1）
3. `cre workflow simulate ... --broadcast` → txHash
4. `bun run verify <txHash>`：

```
读 receipt → 解 PlanExecuted / PlanRecorded → 取 planHash + asOf
（**按全量签名解码，不要按字段下标手写**：两个事件的非 indexed 字段序都是
 asOf, validUntil, targetWethBps, ...，下标 2 是 asOf 不是 targetWethBps。
 签名与 topic0 见 PRD §5 的签名表）
读 plans/<planId>.json 原始字节 → keccak256
断言 planHash == keccak256(file bytes)
断言 report.asOf == file.asOf
断言 file.asOf + file.validitySeconds == file.validUntil
断言 keccak256(prompts/<agent>.txt) == file.rounds[i].promptTemplateSha
→ 打印 "OK: on-chain plan == debate record"
```

后三条是**第二层时效校验**：合约看不见文件，只能校验报告自带的 `asOf`；
「文件声称的时间」与「报告携带的时间」是否一致，只能在这里和前端徽章里查。
**两层缺一，可追溯性就不成立**（PRD §5）。

退出码 0 = 通过。**这个脚本就是 demo 片尾那一帧**，所以只有一个命令、一行成功输出。

### 验证

```bash
cd src/backend && bun run verify 0x<txhash>; echo $?   # 期望 0
```

---

## P5 — 前端（`src/frontend/alpha-plan`）

### 前置：先读文档

```bash
ls node_modules/next/dist/docs/01-app/
```

这个 Next 版本有 breaking changes（`cacheComponents: true`、`partialPrefetching: true`、
`LayoutProps<"/">` 这种新写法）。**写代码前必须读** `01-getting-started` 和
`03-api-reference` 里 Route Handler / 数据获取相关章节，不要按训练数据的 Next 写法硬写。

### 范围（单页只读）

| 区块 | 内容 |
|---|---|
| 金库 | NAV、份额价格、现金 %、WETH %（viem 读合约 view） |
| 最新计划 | planId、三家意见、judge 裁决、planHash、**哈希校验徽章 ✓/✗** |
| 计划历史 | 目标 vs 实际、偏离、tx 链接 |

哈希校验在**服务端**做（读文件原始字节 + 读链上事件），不放到浏览器。

徽章要同时覆盖四件事，缺一不算 ✓：
1. `keccak256(file bytes) == planHash`
2. `plan.asOf == report.asOf`（第二层时效校验，PRD §5）
3. `plan.asOf + plan.validitySeconds == report.validUntil`
4. 每个 round 的 `promptTemplateSha` 能对上仓库里的 `prompts/*.txt`
徽章是全场最重要的一格 —— 页面自己验证了链上记录。

不做：钱包连接、申赎表单、图表、多语言、自动轮询。

### 验证

```bash
cd src/frontend/alpha-plan && pnpm build && pnpm start
# 打开页面：金库数字非零、最新计划卡片出现、徽章为 ✓
```

---

## P6 — 交付

- README 增补：架构一段、快速开始、PRD §9 诚实边界**原样**贴入
- `docs/PRD.md`、`docs/PLAN.md` 提交
- 录屏前跑两遍确认幂等（`MIN_INTERVAL` 会拦第二次，等 60s 或重新部署）

---

## 风险与退路

| # | 风险 | 信号 | 退路 |
|---|---|---|---|
| R1 | 没有 Base Sepolia USDC | 水龙头不给 | 部署 `MockUSDC`(6dec) 自己 mint；README 注明。**不要**假装是官方 USDC |
| R2 | `--broadcast` 需要 CLI 已 `link-key` 的**有资金钱包**（`CRE_ETH_PRIVATE_KEY` 对 CLI 可用，且不能读它） | 报 no signer / 提示 link-key | 转 anvil：`vm.prank(MOCK_FORWARDER)` 调 `onReport`，配合 simulate 日志讲完整链路。**这是 L3，README 与视频必须逐字声明「本节演示合约逻辑，DON 签名路径见 simulate 日志」，不得声称 DON 在跑** |
| R3 | LLM 不可达 / 限额 | 超时 | `debate --offline` 出固定样例，哈希照样对上 |
| R4 | 池子滑点超 50bps | swap revert | 先 `quote` 验证；不行调 `SLIPPAGE_BPS` 到 100 并在 README 说明 |
| R5 | cron 段数写错 | simulate 报 schedule 错 | `0 */10 * * * *` |
| R6 | feed 陈旧 revert | `totalAssets` 读不出 | 阈值放到 1 小时（ETH/USD 心跳 20 分钟），日志打实际 age |
| R7 | Next 16 新 API 没读文档写错 | `pnpm build` 报类型错 | 退回纯 Server Component + 一次 `fetch`，不碰 experimental 特性 |
| R8 | 文件哈希对不上（换行/BOM/键序） | verify 退出码 1 | 用固定序列化函数重写文件；确认 HTTP 响应是原始字节没被中间层改写 |

**R2 概率最高。** 半小时跑不通就立刻转 anvil，别继续烧时间 —— 演示价值不在
"真发了笔交易"，在"报告路径是真的"。

**但降级必须降说法。** 三档保真度（PRD 开头横幅）：

| 档位 | 路径 | 可以说什么 | 不可以说 |
|---|---|---|---|
| L1 | `simulate` | workflow 逻辑真跑、真读链、真聚合 | "上链了" |
| L2 | `simulate --broadcast` | 真交易、真 `forwarder→onReport` | "DON 执行的" |
| L3 | anvil + `vm.prank` | 合约逻辑正确 | 任何暗示 CRE 参与的话 |

**L2 本身也不是 DON 签名。** 这一点最容易漏：`--broadcast` 成功会让人以为
"DON 跑通了"，实际签名方是本地 CLI，`MockKeystoneForwarder` 只是测试网合约。
落到哪一档就在 README 和视频里说哪一档，降档不降说法等于骗。

---

## 今天不做（避免范围蔓延）

前端钱包连接 / 申赎 UI / 子图 / 多链 / 限价单 / 回测框架 / 生产 forwarder 切换 /
多资产支持。
