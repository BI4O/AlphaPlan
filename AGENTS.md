# Agent 协作规则（本仓库）

本仓库同时运行多个 agent。跨 agent 传话**必须用对方的通道**，且**禁止阻塞等待**。

## 谁用什么通道

| 对方 | 通道 | 命令 |
|---|---|---|
| **Claude Code**（Orca 终端里的 `✳`） | **orca CLI** | 见下 |
| **另一个 pi 会话** | **cross-session 工具** | `list_pi` / `send_pi_message` |

判断对方身份：`orca terminal show --terminal <handle> --json` 看 `agentIdentity` 字段。

## orca CLI 收发消息

```bash
# 1. 找终端
orca terminal list          # 认名字：Claude Code 显示为 "✳ <name>"

# 2. 确认身份
orca terminal show --terminal <handle> --json | grep agentIdentity

# 3. 发消息（--enter 是必须的，漏了只会打进输入框不发送）
orca terminal send --terminal <handle> --text "$(cat /tmp/msg.txt)" --enter --wait-submit 20 --json

# 4. 读回复（用 --screen，默认模式会把重绘的 TUI 拆成碎片）
orca terminal read --terminal <handle> --screen
```

⚠️ **`--enter` 漏了 = 消息没发出去。** 用户第一次就抓到了这个错。
确认发送成功看 `result.send.prompt.stages` 里有没有 `turn_started`。

## 不要阻塞等待

发完消息后**不要** `sleep 300` 死等对方。正确做法：

1. 发消息时告诉对方「**用 orca CLI 回复我**」（Claude Code 那边要自己执行 `orca terminal send`）
2. 我方继续做别的事，或直接下一轮读取
3. 读取用 `orca terminal read --screen`，看最后几屏就行

**因为对方回复也要执行命令，所以循环是：发 → 各自 read → 各自再发。**

## 给 Claude Code 的提示模板

发给 Claude Code 的消息里要显式写：

> 你的回复请用 orca CLI 发回给我：
> `orca terminal send --terminal <我的 handle> --text "..." --enter`

否则它只会把答案打印在自己的终端里，我这边看不到（除非我去 read）。

## pi ↔ pi

```javascript
list_pi()                                    // 列出所有活跃 pi 会话
send_pi_message({ target: "<name> [ref]", message: "..." })
```

跨 pi 不需要 `--enter`，工具自己会送达。

---

# 角色边界（本项目的实际分工）

| 角色 | 终端 | 管什么 | **绝对不碰** |
|---|---|---|---|
| **product-manager**（我） | pi | 调度、仲裁、派活、收敛异议 | **任何 src/ 代码**；docs 只做移交不改 |
| **planner** | Claude Code | docs/PRD.md、docs/PLAN.md | src/ |
| **backend-worker** | pi | src/backend/ | contract、frontend、docs |
| **contract-worker** | pi | src/contract/ | backend、frontend、docs |
| **frontend-worker** | pi | src/frontend/ | 其它 |
| **reviewer** | pi | docs/ACCEPTANCE.md、.qa/ | PRD/PLAN、src/ |

## PM 不写代码

PM 的产出是**指令**，不是文件。发现需要改代码时：

1. 把要改什么写成**可执行的工单**，发给对应 worker
2. 参考草稿放 `.pm-handoff/`，**不直接写进 src/**
3. worker 参考、修改或整体重写都行 —— 那是它的领地

`docs/` 同理：PM 要改 docs，交给 planner。

## 停下 ≠ 回退

收到"PM 回话前不再写代码"这类指令时：

- ✅ **停止新增**（不写新文件、不加新功能）
- ❌ **不要回退已完成的工作**（不要删、不要改回旧版本）

11:52 出过一次事故：backend-worker 把已完成的 400 行实现回退成脚手架，
连带冲掉了 PM 加进 schema.ts 的字段。指令不清是我的问题，但这条要记住。

## 派活工单必须包含

1. **范围**（只改哪些路径，明确排除什么）
2. **变更摘要**（如果 docs 改过，把关键变更列出来，别让它去猜）
3. **验收判据**（指向 docs/ACCEPTANCE.md 的具体条目）
4. **回报方式**（用 orca / send_pi_message 发回给谁）
5. **容易写错的点**（你已知的坑，直接告诉它）

---

# 交付闭环（PM 的调度纪律）

**worker 做完 → 报 PM → PM 派 reviewer 验收 → PASS 才进下一阶段**

## 三条不可跳过的规则

1. **worker 不得自己开始下一阶段。** 没有 PM 的「验收通过」，做完当前阶段就停。
   原因：验收可能要求返工，先做下一阶段就是白做。

2. **reviewer 不得自己找活。** 只做 PM 派的验收单，验完出 PASS/FAIL 就停。
   发现问题报 PM，由 PM 派给对应 worker —— **reviewer 不改代码**。

3. **PM 不得自己动手。** 发现代码问题 → 派工单；发现 docs 问题 → 派 planner。

## worker 回报格式（三行）

```
1. 阶段 + 状态（P1 done / P2 done / blocked）
2. 关键验证命令的真实输出（不是"应该通过"）
3. 一句话：未完成项或已知风险
```

禁止词：「应该」「理论上」「看起来」。只报跑过的命令和看到的输出。

## reviewer 验收格式

```
结论：PASS / FAIL / SKIP
失败项：文件:行 + 期望 vs 实际 + 复现命令
通过的项：只列表，不复述判据
最后一行：独立判断（"我认为这个阶段完成了" / "还差 X"）
```

## 阻塞上报

worker 遇到 PRD 矛盾或不可实现之处 → **停下报 PM**，不得擅自改 docs，
也不得为通过验收而降低标准。

---

# PM 转发 FAIL 之前，先独立复现一次

**教训来源（2026-10-24）**：reviewer 报了 6 个 FAIL，其中 1 个是误报
（说 `AlphaPlanVault.t.sol:289` 缺 `unicode` 前缀会报 solc Error 8936，
实测文件里已有该前缀、`forge build` exit=0）。若直接转发，contract-worker
会去修一个编译通过的文件，白烧一轮。

PM 的复核只需要一条命令：

```bash
forge build; echo "exit=$?"     # 验证编译类 FAIL
forge test 2>&1 | tail -5       # 验证测试类 FAIL
grep -n '<被指控的字符串>' <文件>  # 验证"缺少某语法"类 FAIL
```

**代价对比**：复核 10 秒 vs 白派一轮 20 分钟。永远先复现。

## 同理：自己写的命令也要实测

同一轮里，我（PM）给 docs 的复算命令 `cast keccak $(xxd -p <file>)` 是错的
—— cast 无 `0x` 前缀时按 UTF-8 文本哈希，算出来的是 hex 字符的哈希而非文件字节。
是 reviewer 抓到的。

**规则：任何写进 docs 的命令，写之前先跑一遍，并且用一个已知答案验证**
（例：`keccak256("abc") = 0x4e03657a…`）。

---

# FAIL 报告的有效性规则

**一条 FAIL 不带「当次重跑的输出 + 时间戳」视为无效。**

来源（2026-10-24）：reviewer 报 `AlphaPlanVault.t.sol:289` 缺 `unicode` 前缀
（solc 8936）。错误**当时真实存在过**（11:58 的文件确实没有该前缀），
但报告时（12:06）文件已改、`forge build` 已 exit=0。
它用的是旧快照下结论 —— 这不是虚构，是**时效性失效**。

**验证方式**：报告里必须带

```
forge test 2>&1 | tail -5     # 当次输出
date -u +%FT%TZ               # 当次时间戳
```

## PM 侧同样适用

PM 转发 FAIL 前独立复现一次（见上一节）。两侧都做，才不会有「修一个不存在的问题」。

## 验收脚本要带 canary

`cast keccak` 那个坑（无 `0x` 前缀按 UTF-8 文本哈希）最好的防法是**运行时自检**：

```bash
# 形式错了直接 FAIL，不用等具体文件验出问题
test "$(cast keccak 0x616263)" = "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45" \
  || { echo "cast keccak 形式错误"; exit 1; }
```

任何写进文档、依赖「字节级正确」的命令，都该有这么一条。

## xxd 也要验证

`xxd -p -c 100000` 在文件 >100KB 时**会折行**（实测 15 万字节 → 2 行）。
多行进 `$( )` 保留换行，算的就不是原始字节。

```bash
cast keccak 0x$(xxd -p -c 1000000 <file> | tr -d '\n')   # ✅
cast keccak 0x$(xxd -p -c 100000  <file>)                # ❌ >100KB 时错
```

---

# 验收脚本里最危险的失败模式：假绿

**假绿（false PASS）比漏检严重**，因为它让团队以为某项已通过。

## 实例（2026-10-24）

`.qa/verify-mechanical.sh` 的 A14：

```bash
for ev in "PlanExecuted(bytes32,bytes32,uint16,uint16,uint256,uint256,uint64)" ...; do
  if grep -q "event ${ev%%(*}" $SOL; then          # ❌ 只查事件名
    ok "A14" "topic0 = $(cast keccak "$ev")"        # ❌ 硬编码签名，不读源码
```

合约事件已经加了 `asOf`/`validUntil` 两个字段，脚本**仍然打印 PASS 并显示旧 topic0**。

**两个错**：
1. 签名字符串硬编码，合约改了脚本不知道
2. `grep` 只验证名字存在，不验证字段列表

## 规则

任何「对比型」验收项（签名、ABI、哈希、常量表）都必须：

1. **从源码/产物抽取实际值**（`forge inspect`、读 `out/*.json` 的 abi）
2. 与期望值比对
3. 不一致时打印**双方的值**

只 grep 名字、只比常量，等于没验。

## 自检

写完一个验收项后问：**「如果实现改错了，这一项会变红吗？」**
答案是否，就是假绿。

---

# demo 环境的三个实测事实（不要重新发现一遍）

来自 contract-worker 的 fork 实测，写在这里省得下一个人踩：

## 1. 真 Chainlink feed 在合约上下文里 revert `No access`

EOA 调用 `latestRoundData()` 正常，但**由合约内部发起就失败**。
fork 上和真 `sepolia.base.org` 都验证过（写了一个最小 probe 合约复现）。

→ 所以 demo 必须用 `anvil_setCode` 把 `MockAggregator` 装到 feed 地址。

## 2. 池价 ≠ 文档里的 feed 价

```
池子隐含 ETH 价（从 Uniswap slot0 算）= 3697.93
PRD §10 表里实测的 feed 价           = 2382.45
差 55%
```

金库的 `minOut` 由 oracle 价推出、容差 50bps，所以 **mock 初始价必须等于池价**，
否则买入必然 revert。`demo-up.sh` 会自动从 `slot0` 算出来写入。

## 3. 价格只往上调

往下调会让买入被 50bps 容差拒绝（池子实际给的比 oracle 预期的少）。
要下调就分小步、中间穿插实际 swap。

## 改价必须同时改 updatedAt

`MAX_FEED_STALENESS` 是 1 小时。anvil 的块时间不自动走，
只改 `slot0`（answer）不改 `slot2`（updatedAt）→ 金库 revert。
`demo-bump-price.sh` 已经两条一起写。

## anvil 重启会丢一切

部署 + setCode + 存款全没。`demo-up.sh` 会重建，地址缓存在
`/tmp/alphaplan-demo-env` 所以重跑不换地址；`RESET=1` 强制重部署。

---

# MockAggregator 的 round id 不能返回 1

**第二次踩这个坑的预防针。**

## 症状

backend 的 `findRound24hAgo` 用二分搜索找 24h 前的 round：

```ts
let lo = latest.roundId > WINDOW ? latest.roundId - WINDOW : 1n;
let hi = latest.roundId - 1n;
```

如果 mock 的 `latestRoundData()` 返回 `roundId = 1`，则
`hi = 0`、`lo = 1` → **`while (lo <= hi)` 一次都不执行** → 永远拿不到 24h 前
→ 24h 涨跌幅算不出 → 计划永远 `degraded: true`。

## 正确做法

```
LATEST_ROUND_ID  = 5000   ← latestRoundData 返回这个
HISTORY_ROUND_ID = 4000   ← 分界线
getRoundData(id):
  id <= 4000 → 返回 24h 前的价格/时间戳（slot 3/4）
  id >  4000 → 返回当前价格/时间戳（slot 0/2）
```

这样 `(roundId → updatedAt)` 单调递增，二分搜索能正常收敛。

## 存储布局（5 个 slot，不要重排）

```
slot 0 = answer        （当前价，8 位小数）
slot 1 = decimals      （8）
slot 2 = updatedAt     （当前块时间）
slot 3 = answer24h     （24h 前价格）
slot 4 = updatedAt24h  （24h 前时间戳）
```

`demo-up.sh` 必须写全部 5 个，否则 anvil 重启后 `degraded` 回 `true`。

## 自检

```bash
cast call $FEED "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4000
# updatedAt 应该 = now - 86400
cast call $FEED "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" 4999
# updatedAt 应该 = now
```

两者差值必须是 86400。不是就是错的。

---

# `tsc --noEmit` 绿 ≠ `pnpm build` 绿

**实例（2026-10-24）**：frontend 交付时自报 `tsc --noEmit` exit 0，
但 `pnpm build` 直接挂在 type check：

```
lib/env.ts(27,20): error TS2737: BigInt literals are not available when targeting lower than ES2020.
```

根因：`tsconfig.json` 的 `target: "ES2017"`，而代码用了 `0n` 字面量。

## 规则

Next.js 的 `build` 会用**自己的** TS 配置路径，可能和裸 `tsc --noEmit` 不同。
交付前必须跑项目真正的构建命令：

```bash
pnpm build      # Next
forge build     # Foundry
bun check       # Bun 项目
```

不是 `tsc --noEmit`，不是 `dev` 模式（dev 不做完整类型检查）。

## PM 侧的教训

我自己也是**直接跑 build 才发现**的。所以：

> **验收任何一个「构建通过」的声明时，PM 要自己跑一遍项目的真实构建命令**，
> 而不是信 `tsc --noEmit` 的结果。

---

# 假绿的五种形态（本项目实录）

reviewer 连续抓到 **7 个**验收工具自身的判定错误。每个都做了正反两次验证才修好。

| # | 现象 | 根因 | 危害 |
|---|---|---|---|
| 1 | A14 事件检查 PASS，但 topic0 是旧的 | 签名硬编码，`grep` 只查事件名 | 合约改了，脚本不知道 |
| 2 | D0 报「链上是旧合约」 | 拿 artifact 的 `deployedBytecode` 逐字节比，但 **672 字节 immutable 位置是 00 占位** | 假红，会让人去修一个没坏的东西 |
| 3 | F4b 把 planHash 当私钥 | 正则 `0x[0-9a-f]{64}` 命中了哈希 | 假红 + 噪音淹没真问题 |
| 4 | F1b「11 ≥ 8 → PASS」 | `grep` 从该节数到文件尾，把下一节的 1./2./3. 也算进去 | **假绿**：8 条里少了一条也过 |
| 5 | `tsc --noEmit` 绿，`pnpm build` 红 | Next 的 TS 走自己的配置路径 | 交付时报"绿"，实际构建失败 |

## 共同规则

1. **对比型判据必须从源码/产物抽实际值**，不能硬编码期望值再 grep 名字
2. **数数量必须限定区间**（到下一个同级标题截止），并要求**恰等**而非 `>=`
3. **排除已知差异再比**（immutable 占位、时间戳、编译元数据）
4. **每个判据都要做负向测试**：故意改错，它必须变红
5. **交付前跑项目真正的构建命令**（`pnpm build` / `forge build` / `bun check`），不是 `tsc`

## 累计 7 例（reviewer 实录）

| # | 现象 | 方向 | 根因 |
|---|---|---|---|
| 1 | A14 PASS 但 topic0 是旧的 | 假绿 | 硬编码签名 + grep 只查事件名 |
| 2 | D0 报「链上是旧合约」 | 假红 | artifact 的 672B immutable 是 `00` 占位 |
| 3 | F4b 把 planHash 当私钥 | 假红 | 正则 `0x[0-9a-f]{64}` |
| 4 | F1b「11 ≥ 8 → PASS」 | 假绿 | grep 从该节数到文件尾，数进下一节 |
| 5 | F1a 判据只 grep「保真度」 | 假红 | 正确写法是「L1/L2，不是 L3」，不含该词 |
| 6 | F1b `awk '/诚实边界/'` 恒为空 | 假红 | 被第 7 行的锚点链接 `[诚实边界](#…)` 抢先命中 |
| 7 | E6c-d3 报「大跨度 getLogs 未被拒 → PASS」 | 假绿 | 判据用 `deployBlock→latest` 的**当前**跨度；环境刚重置、span 只有 5 块，当然能过。改成固定探测 300 块 |

## 规律（这条比列表更有用）

- **假绿全部出现在「只查形状不查内容」的地方** —— grep 一个名字、数 `>= N`、比一个硬编码常量
- **假红全部出现在「判据写得太具体」的地方** —— 盯某个词、假设从 0 起算、忽略已知差异
- **第 7 例揭示第三种**：**判据依赖了"当前恰好成立的状态"** ——
  它今天绿不是因为它对，是因为被测量的东西今天刚好够小（span=5 块）。
  这类判据会随**时间**失效，比前两类更隐蔽：它不会立刻错，它会在演示当天错。
  修法是让判据测量**常量性质**（"300 块跨度能不能过"）而不是**当前状态**（"现在这个跨度能不能过"）。

## 所以每条判据要回答**两个**问题

```
1. 改坏了它会不会红？     ← 防假绿
2. 没改坏它会不会绿？     ← 防假红
```

**只答一个不可信。** 这是 reviewer 的原话，也是这 7 例的归纳。

还有第 3 问，专治第 7 例：

```
3. 明天它还对吗？         ← 防「依赖当前状态」
```

一个判据如果今天靠运气通过（跨度刚好够小、文件刚好够短、措辞刚好一致），
**它就不是判据，是巧合。**

## 一句话

> **工具假绿比代码 bug 更该报告**，因为它会让后面所有结论失真。
> 但假红同样有毒：它会让人去修一个没坏的东西，并淹没真问题。

---

# fork 环境的 RPC 有硬限制，且会随时间恶化

**实例（2026-10-24）**：前端历史区块在演示时必然空白。

```
cast logs --address $VAULT --from-block $DEPLOY_BLOCK --to-block $LATEST
→ error -32614: eth_getLogs is limited to a 200 range
```

二分确认：跨度 200 ✅ / 500 ❌ / 1000 ❌。

## 为什么必然失败

`anvil --fork-url` 的 `getLogs` 会**转发给上游**（这里是 Base Sepolia），
上游硬限 200 块。而 `DEPLOY_BLOCK` 固定、链高每分钟在涨 —— **跨度只会变大**。

刚重建环境时跨度可能只有 5，能跑；几十分钟后必然超限。

## 更糟的是它伪装成环境问题

```ts
try { ... } catch { reason = "无法读取历史事件" }
```

`-32614`（区间过大）和 `ECONNREFUSED`（连不上）落到同一个 catch，
UI 显示「未采集」，看起来像环境没起来 —— **掩盖了代码缺陷**。

## 规则

1. **任何 `getLogs` 都要分块**（保守 100 块一批），不要一次扫 `deployBlock → latest`
2. **错误要分类**：区间过大（可自愈）≠ 连不上 ≠ 空结果
3. **空结果不是错误**：「本期 0 笔」是正常状态，要单独渲染

## 判断方法

写 `getLogs` 时问自己：**这个跨度在 24 小时后还合法吗？**
fork 环境的答案通常是「不合法，因为链高在涨」。

---

# 判据的第三个问题：明天它还对吗？

reviewer 在 7 个假绿/假红之后补的第 3 问，比前两问更本质：

```
1. 改坏了它会不会红？     ← 防假绿
2. 没改坏它会不会绿？     ← 防假红
3. 明天它还对吗？         ← 防「靠运气通过」
```

**第 3 例**：`E6c-d3` 第一版是「用 deployBlock→latest 打一次 getLogs，不报错就 PASS」。
环境重置后 span 变成 5 块 → PASS，但代码根本没修。

它不查形状（第 1 问能过），判据也不具体（第 2 问能过），
**问题是判据会随时间失效**：今天绿不是因为对，是因为被测量的东西今天刚好够小。

> **一个判据如果今天靠运气通过，它就不是判据，是巧合。**

## 修法

把判据锚在**不变量**上，不是当前状态上：

```bash
# ❌ 依赖当前 span（今天小，明天大）
span = latest - deployBlock

# ✅ 固定探测上限（与当前状态无关）
cast logs --from-block (latest-300) --to-block latest   # 300 永远被拒，反映真实上限
```

## 另一条：永远红的判据是噪音

`E6c-d3` 改进后测的是「上游硬限 200」这个**环境事实**，它永远不可能是 PASS。

> 永远红的判据会变成噪音，而噪音会淹没真问题。

正确做法是分级：
- 平时 **INFO**（不污染失败列表）
- 接近阈值 **WARN**（可见但不阻断）
- 真的坏了 **FAIL**

## 只读纪律的边界

判断标准不是「有没有发交易」，而是 **「有没有改变业务状态」**：

| 操作 | 允许？ |
|---|---|
| `anvil_mine` 挖空块 | ✅ 不改余额/nonce/事件 |
| `cast send` 任何交易 | ❌ 必须先申请 |
| `evm_increaseTime` | ❌ 会污染时钟，必须先申请 |
