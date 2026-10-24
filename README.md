# AlphaPlan

> 一个可审计的 AI 基金经理。**不承诺 AI 赚钱，承诺每个决策都能被第三方复算。**

AI 决定买多少 ETH，把这个决定写成一份计划文件，文件的 keccak256 哈希上链。
三个月后你打开那份文件、自己算一遍哈希 —— 对上了，就证明它当时确实是这么决定的；
差一个字节，就证明有人改过。**没有「相信我」这一环。**

```bash
git clone <this-repo> && cd AlphaPlan
bash src/contract/script/demo-up.sh        # 起链 + 部署 + 入金
cd src/frontend/alpha-plan && pnpm dev     # → http://localhost:3000
```

---

> ⚠️ **本 demo 是 L1/L2，不是 L3。DON 不会真的定时执行**
> （`cre whoami` → `Deploy Access: Not enabled`）。`--broadcast` 发的确实是真交易、
> 走真 forwarder→onReport，但**签名方是本地 CLI，不是 DON 共识**。
> 详见 [诚实边界](#诚实边界8-条逐条都在限制一个对外承诺)。

## 目录结构

```
AlphaPlan/
├── src/
│   ├── contract/          # Solidity：AlphaPlanVault（ERC-4626）+ Foundry 测试
│   ├── backend/           # TypeScript：AI 辩论、计划文件生成、计划文件服务
│   └── frontend/alpha-plan/  # Next.js：五屏控制台 + 钱包申赎
├── docs/
│   ├── PRD.md             # 产品设计
│   ├── PLAN.md            # 实施计划
│   └── ACCEPTANCE.md      # 验收口径（每一条都能机械判定）
├── .qa/                   # 机械闸门与渲染闸门
├── .agents/skills/        # 项目级 Agent Skills（随仓库走）
└── AGENTS.md              # 开发约定与踩过的坑
```

## 三件套，各管一件事

| 组件 | 职责 | 安全目标 |
|---|---|---|
| **合约** `AlphaPlanVault`（ERC-4626） | 持仓、算 NAV、执行 swap、强制风控 | **trustless** —— 不需要信任任何人 |
| **CRE workflow** | 取计划、校验三道门禁、生成签名报告写链 | **traceable** —— 需要出处证明 |
| **AI 辩论层**（链下） | bull / bear / risk 三个 agent 辩论，judge 裁决 | 可复算 —— 输出即证据 |

**NAV 绝不由 CRE 报告。** 它由合约用「持仓 × Chainlink Data Feeds 价格」实时计算。
否则报告与执行之间的时间差就是免费套利窗口。

完整设计见 [`docs/PRD.md`](docs/PRD.md)，实施计划见 [`docs/PLAN.md`](docs/PLAN.md)，
验收口径见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

## 关于 Git 工作树

`.worktrees/` 用于并行开发：多个分支可以各自检出到独立的工作树里，
互不干扰，而共享同一个 Git 历史。

```bash
# 新建一个工作树，检出某个分支到 .worktrees/<name>
git worktree add .worktrees/<name> <branch>

# 查看所有工作树
git worktree list

# 用完删除工作树
git worktree remove .worktrees/<name>
```

该目录已在 `.gitignore` 中忽略：工作树的检出内容不需要被记录，
它们只是同一份历史在不同分支上的视图。

## 依赖与环境

本项目的能力来自两条链：**链上执行层（Chainlink CRE）** 与 **钱包操作层（Binance Agentic Wallet）**。
两者都通过各自 CLI 落地，CLI 装在机器上，不在仓库里。

### 机器级依赖（需要手动装一次）

| 依赖 | 当前版本 | 安装位置 | 用途 |
|---|---|---|---|
| Node.js | v24.2.0 | nvm | 运行时与技能安装器 |
| Bun | 1.2.19 | `~/Library/pnpm/bun` | 构建 / 运行 TypeScript CRE workflow |
| Go | **未安装** | — | 仅 Go 版 CRE workflow 需要；走 TS 路线可跳过 |
| `cre` | **v1.39.0** | `~/.cre/bin/cre` | Chainlink CRE CLI：项目初始化、模拟、部署 |
| `baw` | **v1.10.0** | `~/.local/bin/baw` | Binance Agentic Wallet CLI：钱包、交易、DeFi |

`cre` 的安装（macOS / Apple Silicon）：

```bash
# 官方一键脚本（会写入 ~/.cre/bin 并在 ~/.zshrc 追加 PATH）
curl -sSL https://app.chain.link/cre/install.sh | bash
```

> ⚠️ 该脚本硬依赖 `api.github.com/repos/smartcontractkit/cre-cli/releases/latest` 取版本号，
> **没有降级路径**。未认证请求被限流时会直接失败（`403 rate limit exceeded`）。
> 走不通时的替代流程：从 [releases 页](https://github.com/smartcontractkit/cre-cli/releases)
> 下载 `cre_darwin_arm64.zip` → 核对 SHA-256（与 release 资产的 `digest` 比对）
> → `codesign --verify --strict --identifier com.smartcontract.cre.cli <binary>`
> → 放入 `~/.cre/bin/cre` → `chmod +x`。

`baw` 的安装：

```bash
npm install -g @binance/agentic-wallet    # 提供 baw 命令
baw --version                              # 应 >= 1.10.0
```

装完后**新开一个终端**（或 `source ~/.zshrc`）确认命令可用：

```bash
cre version    # CRE CLI version v1.39.0
baw --version  # 1.10.0
```

### 仓库级依赖（提交进 Git）

`.agents/skills/` 里放的是 Agent Skills，纯 Markdown + 参考文档，**随仓库版本化**，是唯一的技能真相源。

`skills-lock.json` 和 `.claude/` 是 `npx skills add` 的副产物，只对**本机**有意义，
均已在 `.gitignore` 中忽略：

- `.claude/skills/` 是指向 `.agents/skills/` 的软链，供 Claude Code 读取
- `skills-lock.json` 记录来源与内容哈希

两者都可以随时重新生成，不影响项目配置。

| 技能 | 版本 | 来源 | 作用域 |
|---|---|---|---|
| `chainlink-cre-skill` | 0.0.29 | `smartcontractkit/chainlink-agent-skills` | **项目级**（`.agents/skills/`） |
| `binance-agentic-wallet` | 1.12.0 | `~/.cc-switch/skills/` | 全局级（`~/.pi/agent/skills/` 软链） |
| `binance-agentic-wallet` | 1.13.0 | `binance/binance-skills-hub` | 尚未安装（需 `baw` >= 1.11.0） |

安装 / 更新技能：

```bash
# 项目级（默认）：装到 .agents/skills/
npx skills add smartcontractkit/chainlink-agent-skills --skill chainlink-cre-skill

# 查看本机已装
npx skills list
```

新克隆仓库时，`.agents/skills/` 已随 Git 下来，**无需重装**。

> ⚠️ **技能清单只在 pi 启动时构建。** 改动了 `.agents/skills/` 之后，
> 当前会话里要敲 `/reload` 才会生效；技能以 `/skill:<name>` 形式调用，没有短名别名。

**关于 `binance-agentic-wallet` 的版本落差**：全局那份是 v1.12.0，而官方 hub
已发布 v1.13.0（新增 ENS / `.bnb` 域名解析、Agent ID 等）。升级技能前必须先升 CLI：

```bash
npm install -g @binance/agentic-wallet@latest   # 需要 >= 1.11.0
```


### 快速开始（三条命令，从零到能点）

前提：`anvil` / `forge` / `cast` / `bun` / `pnpm` 都装好（见上面「依赖与环境」）。

```bash
# ① 起链：fork Base Sepolia + 部署金库 + 装 mock feed + 入金 20 USDC
bash src/contract/script/demo-up.sh
```

**它会打印四个值，后面都要用**：

```
 RPC_URL=http://127.0.0.1:8545
 VAULT_ADDRESS=0x……        ← 记住它
 DEPLOY_BLOCK=495……        ← 记住它（anvil 每次重启这个数会变）
 CHAIN_ID=31337
```

```bash
# ② 前端：把上面两个值写进 .env.local，然后起服务
cd src/frontend/alpha-plan
#   VAULT_ADDRESS=<上一步的>
#   DEPLOY_BLOCK=<上一步的>
#   RPC_URL=http://127.0.0.1:8545
#   CHAIN_ID=31337
#   NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
#   NEXT_PUBLIC_CHAIN_ID=31337
pnpm dev          # → http://localhost:3000
```

```bash
# ③ 计划文件服务（可选，但 demo-report.sh 要用它挑「链上已执行的那份」）
cd src/backend
VAULT_ADDRESS=<同上> DEPLOY_BLOCK=<同上> RPC_URL=http://127.0.0.1:8545 \
  bun src/serve-plans.ts     # → http://127.0.0.1:8788
```

**打开 http://localhost:3000，滚到最底部就是「演示操作」三步按钮。**

> ⚠️ **`bun` 不自动读 `.env` —— 这一行不传环境变量就会 503。**
>
> ```
> $ bun src/serve-plans.ts
> serve:plans: VAULT_ADDRESS is required (used to read lastPlan/planUsed)
> # 然后每个请求都返回 {"error":"chain unavailable …"}
> ```
>
> 这是它故意的设计：没有 `VAULT_ADDRESS` 就无法判断「哪份计划是链上执行过的」，
> 而静默退化成「取最新文件」正是要修掉的那个 bug。**宁可 503，也不猜。**

---

### demo 脚本：四个脚本各管一件事

全部在 `src/contract/script/`，都是幂等的、可以随时重跑。

| 脚本 | 做什么 | 改链上？ |
|---|---|---|
| `demo-up.sh` | 起 anvil fork + 部署 + 装 mock feed + 入金 | ✅ |
| `demo-report.sh` | 把计划送上链（`onReport`） | ✅ |
| `demo-bump-price.sh` | 把 ETH 价推高（oracle + 池子一起改） | ✅ |
| `demo-snapshot.sh` | 打印关键值，`--before/--after` 出差值 | ❌ 只读 |

#### `demo-up.sh` —— 起环境

```bash
bash src/contract/script/demo-up.sh                # 复用已有 anvil 与已部署的金库
PORT=8545 RESET=1 bash src/contract/script/demo-up.sh   # 强制重新部署一个新金库
```

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8545` | anvil 监听端口 |
| `RESET` | `0` | `1` = 忽略缓存，部署新金库 |
| `DEPOSIT_USDC` | `20000000` | 初始入金（6 位小数，即 20 USDC） |
| `CHAIN_ID_OVERRIDE` | `31337` | fork 拿真状态，chainId 覆盖成这个 |

> **`RESET=1` 不会删掉旧金库。** 旧合约仍在链上、仍有代码、仍能读。
> 实测踩过：同时存在 `0x8f7a…`（有执行记录）和 `0x6ee3…`（全新），
> 两个都「合法」，下游指错了看不出来。脚本现在会在部署前警告旧地址还活着。

#### `demo-report.sh` —— 送计划上链

```bash
bash src/contract/script/demo-report.sh
```

它是**演示里最关键的一步**，做五件事并逐条打印：

1. 从 `/latest.json` 取计划（后端没起就退回 `plans/` 里最新的一份）
2. 校验：`degraded` 必须 `false`、声明的时效必须还在窗口内、`planHash` 不能已执行过
3. `keccak256(原始字节)` → 这就是报告里的 `planHash`
4. 发 `onReport`，过合约三道门禁（degraded → planUsed → nonce）
5. **回读** `lastPlanHash` 与 `lastNonce`，证明真的上链了

> ⚠️ **这一步用 `anvil_impersonateAccount` 假扮 CRE forwarder。**
> 真实部署里这笔交易由 Chainlink DON 的 forwarder 合约签发，私钥在 DON 里。
> 本地没有 DON，所以用 anvil 的 debug 方法顶上 —— 输出里会原样打印这句话。
> **不标注这一点就是假装演示的是完整链路。**

#### `demo-bump-price.sh` —— 抬价

```bash
bash src/contract/script/demo-bump-price.sh 4000        # 推到 4000 USDC/WETH
bash src/contract/script/demo-bump-price.sh 400000000000 --raw   # 用 8 位小数原值
```

**必须同时改两处**（脚本自己会做）：

- mock oracle 的 `latestRoundData`
- Uniswap 池子的 `slot0`（只换 `sqrtPriceX96` 与 `tick`，其余位保留）

> 只改 oracle 不改池子，会造出「oracle 说涨了、市场没涨」的假场景，
> 而且**卖方向必然 revert** —— 金库的 `minOut` 由 oracle 推出，oracle 比池价
> 高 11% 时池子给的本来就少 11%，50bps 容差直接拒单。清仓和赎回自动卖币
> 都走卖方向，所以只抬 oracle 会让「涨了之后 cash out」整段演示卡死。

脚本自带自检：读回 `slot0` 比对 + 干跑一笔 1 USDC 的 swap（不改状态）。
任一步失败会**把原 slot0 写回去**并 `exit 1`。

#### `demo-snapshot.sh` —— 前后对比

```bash
bash src/contract/script/demo-snapshot.sh --before   # 抬价前存一份
bash src/contract/script/demo-bump-price.sh 5000
bash src/contract/script/demo-snapshot.sh --after    # 打印差值与百分比
```

只读。演示时如果被问「真的变了吗」，这一条能当场给出前后两列。实测输出：

```
--- 与基准的差值 ---
totalAssets    10441829 → 10603648  (+161819)
sharePrice     1044182 → 1060364  (+16182)
oracle 现价    480000000000 → 500000000000
池子现货       4788.53 → 4993.92
currentWethBps 3719 → 3815
NAV 涨幅       +1.55%
```

**注意池子现货跟着动了**（4788.53 → 4993.92）—— 这是 `demo-bump-price.sh`
两处一起改的结果，不是只改了 oracle。只改 oracle 的话这里会只有一行变。

---

### 前端两个「演示」不是一回事

页面上有两处带“演示”字样的东西，**回答的问题不同，都在是对的**：

| | `demo-panel.tsx`（总览屏底部「演示操作」） | `walkthrough-bar.tsx`（执行链路屏「▶ 演示」） |
|---|---|---|
| 作用 | **驱动**：生成计划 → 送链上 → 抬价 | **讲解**：11 个节点逐个运镜 + 字幕 |
| 改链上 | 三步里两步会改 | **一个字都不写** |
| 依赖 | DeepSeek key、anvil debug 方法（所以走服务端 spawn） | 只读已有数据 |
| 讲给 | 演示者自己点 | 评委听 |

**一前一后配套**：先点 `demo-panel` 把交易送上去，再用 walkthrough 讲那笔交易怎么来的。
顺序反了的话，walkthrough 后三步会如实显示「没有执行事件」—— 这本身也是正确行为。

> `demo-panel` 的输出**原样摊开，包括失败的部分**。
> 一个只会显示绿勾的演示，证明不了任何东西。

---

### 五分钟演示剧本（点按钮版，不碰命令行）

前提：环境已起（`demo-up.sh`）、前端已连本地链（见「MetaMask 导入与配置」）。

**按顺序点总览屏底部的三步按钮**：

| 步骤 | 点完会发生什么 | 屏幕上能看到 |
|---|---|---|
| ① 生成计划 | Bull/Bear/Risk 三家 + Judge 出结果，写成 JSON | 「辩论与裁决」屏出现新的 `planId` |
| ② 送到链上 | 计划 keccak 写进金库，按目标仓位调仓 | 「执行链路」屏多一笔 `PlanExecuted`；`lastNonce` +1 |
| ③ 抬高 ETH 价 | oracle 与池子一起推到 4800 | 「总览」屏的 NAV 与份额价上涨 |

**每一步的输出都会原样展开在按钮下面**，包括 `anvil_impersonateAccount` 那一行。
红字不隐藏 —— 这是有意为之。

**讲的时候可以顺着说**：

1. **①之后**切到「辩论与裁决」：「三个 agent 各自给目标仓位，Judge 加权。
   注意它没有简单平均 —— 它扣掉了论据不成立的意见。」
2. **②之后**切到「哈希自验」：「链上 `lastPlanHash` 与这个文件的 keccak 逐位对上。
   改一个字节，这里就红了。**这是『可审计』，不是『相信我』。**」
3. **③之后**切回「总览」：「ETH 涨了约 30%，但基金只持有约 37%，所以 NAV 涨得不那么多。
   **这是杠杆传导的算术，不是凭空变出来的钱。**」
4. 最后切到「执行链路」按「▶ 演示」，让 11 个节点自己走一遍，
   把刚才那笔交易的来路串起来。

**万一 AI 判断空仓（0 bps）**：不要掩饰，直接讲
「这次它选择不承担风险，所以抬价对净值没影响」——
这本身证明了决策是真的，而不是前面写死了一个方向。

---

### demo 剧本（净值上涨怎么演，命令行版）



```bash
# 抬价：同时推 mock oracle 与 Uniswap 池子 slot0（tick 对齐 tickSpacing=60）
bash src/contract/script/demo-bump-price.sh 4000
```

| | 抬价前 | 抬价到 4000 |
|---|---|---|
| NAV | 19.98 USDC | **20.47 USDC** |
| 份额价 | 0.999046¹ | **1.023609** |
| 涨幅 | — | **+2.46%** |

¹ 合约 `convertToAssets(1e6)` 的口径是 floor，所以链上读到 `999046`；
数学精确值 `19,980,933 / 20,000,000 = 0.999046650`，四舍五入是 `0.999047`。
两者都对，区别只是**向下取整 vs 四舍五入** —— 这里用链上口径，因为它才是用户实际能取出的数。

**注意涨幅只有 2.46%，不是 8%。** 因为金库只持有 ~30% 的 WETH，
ETH 涨 8.2% 只能带动 NAV 涨 2.46%。这是杠杆传导的算术，不是实现缺陷。

台词应该说：

> ❌「AI 让基金涨了 8%」
> ✅「ETH 从 3696 涨到 4000（+8.2%），因为金库按 AI 决策持有 30% WETH，
>    基金净值跟着涨了 2.46%」


### 改 prompt 不会让历史计划失效（content-addressed 存档）

计划文件里记的是 `promptTemplateSha = keccak256(prompt 原文)`，**不记原文**。
所以「改了 prompt」会有一个陷阱：

```
prompts/bull.txt  被改写  →  旧计划里记的 0xceb2a196… 找不到对应内容
                          →  那份计划的「prompt 可复算」永久失效
```

**这不是假设，是我们自己踩过的。** 2026-10-24 15:16 改了四个 prompt
（去掉「risk 应当偏向保守」这类写死的立场），结果 8 份历史计划从「可复算」
变成「不可复算」，`bun run debate --check` 红 32 项 —— 而那些计划文件
本身一个字都没错。

**修法：`prompts/archive/<keccak>.txt`，文件名就是它自己的校验和。**

```
prompts/
  bull.txt                          ← 当前用的
  index.json
  archive/
    0xceb2a196….txt                 ← 15:16 之前那版
    0x345570c2….txt                 ← 现在这版（每次 debate 自动归档）
```

`--check` 现在问的问题变了：

```
❌ 旧问题：「这份计划是不是用当前 prompt 生成的？」→ 改 prompt 就全红
✅ 新问题：「它当时用的那份原文，我们还能不能拿出来？」→ 按 hash 去 archive 找
```

于是**改 prompt 是「新增」不是「覆盖」**，历史字节永远还在。

```bash
cd src/backend

# 校验全部历史计划（现在 13 份全 OK，且改 prompt 之后仍然 OK）
bun run debate --check

# 每次 bun run debate 会自动把当前 prompt 归档，输出一行
#   prompts archived: 0x345570c2….txt
```

> **归档是在调 LLM 之前做的，不是之后。** 因为计划文件可能已经写下新哈希了，
> 事后归档会在「生成中途失败」时留下一个指向空气的哈希。

---

### 诚实边界（8 条，逐条都在限制一个对外承诺）

1. **保真度：本 demo 是 L1/L2，不是 L3，DON 不会真的定时执行。**
   `cre whoami` → `Deploy Access: Not enabled`。demo 展示的是
   `cre workflow simulate`（真 WASM、真 HTTP、真链上读）与 `--broadcast`
   （真交易、真 forwarder→onReport 路径），但**签名方是本地 CLI，不是 DON**。

2. **不保证策略优秀。** 60/40 带宽内的择时，alpha 大概率不如躺平。
   我们卖的是可审计性，不是收益。

3. **计划里的 `model` / `promptTemplateSha` 是自述，不是证明。**
   手写 JSON 也能这么写。只有 zkML 或 TEE attestation 才能证明「真的是那个模型跑的」。
   我们承诺的是「这份记录未被篡改」，不是「这个模型确实跑过」。

4. **赎回依赖 Uniswap 池子，不只是自己的 USDC 余额。**
   现金不足时合约会自动卖 WETH 补足（最多 4 轮补卖）。池子枯竭或
   oracle 偏离超过 50bps 容差时赎回仍会 revert。**这是即时赎回的代价。**
   - 滑点成本由所有持有人共同承担（NAV 多减，上限 50bps），不是只由赎回人承担
   - `maxRedeem` / `maxWithdraw` 返回「现金可覆盖的部分」（保守）
     超出仍然可以赎回，但视图不承诺成功

5. **只支持 USDC/WETH。** 该测试网其余标的没有流动性。

6. **owner 可暂停、可换 forwarder，但不能转移用户资产、不能升级逻辑、不能改费率。**
   合约里不存在任何能把用户资产转给 owner 的函数。费率是编译期常量。

7. **计划文件是仓库里的静态文件**，前端通过 HTTP 端点读原始字节。
   生产形态应该是对象存储 / IPFS，demo 阶段不假装。

8. **demo 里的第一笔存款来自开发者本人。** 这不是用户验证，是机制验证。
   「谁会存钱进来」在本阶段不是本项目要解决的问题 —— 我们不编市场故事。


### MetaMask 导入与配置（一条一条照做）

> ⚠️ **先启动环境再导入。** 导入时 MetaMask 会去连 RPC，链没起就会失败。
> 启动：`bash src/contract/script/demo-up.sh`

#### 1. 添加网络

MetaMask → 网络下拉 → **Add a custom network**：

| 字段 | 填什么 |
|---|---|
| Network name | `Local Anvil (AlphaPlan)` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |
| Block explorer | 留空 |

> **Chain ID 必须填 31337。** 我们的链是 `anvil --fork-url <Base Sepolia> --chain-id 31337` ——
> fork 拿到真 USDC/WETH/Uniswap 状态，`--chain-id` 覆盖成 anvil 默认的 31337。

**如果删不掉旧网络**（MetaMask 的已知限制）：

1. 先把当前网络**切到别的**（如 Ethereum Mainnet）—— 不能删除正在使用的网络
2. 再打开下拉 → 找到旧网络 → 三个点 → Delete
3. 还不行就加个 `chainId 31338` 的假网络占位，旧的就能删了

#### 2. 导入测试账户

MetaMask → 账户头像 → **Import account** → 粘贴私钥：

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

地址会是 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`。

> **这是 anvil 的公开测试私钥**，写在 Hardhat/Foundry 官方文档里，
> 只在这条本地链上有意义。**永远不要用在任何真实网络上。**

#### 3. 导入代币（否则只看到 ETH）

MetaMask → **Import tokens** → **Custom token**，加两个：

| 代币 | 合约地址 | 符号 | Decimals |
|---|---|---|---|
| 测试 USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `USDC` | **6** |
| 基金份额 | `0x8f7a1DEFa8B06a8d66ea14a71A2eF2CE4bA1295b` | `apUSDC` | **6** |

> **基金份额代币的地址就是金库合约本身** —— ERC-4626 金库本身就是 ERC-20，
> 你的份额就是它的代币。不是笔误。
>
> ⚠️ **这个地址会变。** `demo-up.sh` 不带 `RESET=1` 时复用同一个金库，
> 带 `RESET=1` 时会部署新的、地址就变了。届时以它打印的 `VAULT_ADDRESS` 为准，
> 在 MetaMask 里把旧的份额代币删掉、按新地址重新导入。

导入后应该看到：

```
ETH      10,000
USDC     24.354929
apUSDC   20.000000
```

#### 4. 验证连对了链

连上钱包后，页面右上角应该显示：

```
0xf39F…2266 · 10,000.0000 ETH · Local Anvil (AlphaPlan)
```

如果显示**「网络不匹配」**，说明 MetaMask 连的不是 `31337 + 127.0.0.1:8545`。
点页面上的「切换」按钮，或手动在 MetaMask 里切到 `Local Anvil (AlphaPlan)`。

#### 5. 常见问题

**Q: 页面显示「读取失败」但 MetaMask 显示已连接**
A: 大概率连错 RPC。**Chain ID 相同的网络可以有不同 RPC** ——
如果你之前加过别的 31337 网络（裸 anvil、Hardhat），MetaMask 可能连的是那个。
那上面没有本项目的合约。删掉重新加，RPC 必须精确为 `http://127.0.0.1:8545`。

**Q: 导入 USDC 时提示「代币已存在」**
A: 说明之前加过。地址相同就可以直接用。

**Q: 余额是 0**
A: 先确认网络是 `Local Anvil (AlphaPlan)`，再确认账户是 `0xf39F…2266`。
环境重启后余额会回到初始值（`demo-up.sh` 每次都重新入金 20 USDC）。

**Q: 手机钱包扫码连不上**
A: 正常。Reown 走 WalletConnect 云端中继，手机访问不到你电脑的 `127.0.0.1`。
**只用浏览器插件钱包（MetaMask）。**

#### 6. 环境重启后要做什么

`anvil` 进程一停，部署、mock feed、入金全部消失。重跑：

```bash
bash src/contract/script/demo-up.sh          # 复用已部署的金库，只补 feed 和入金
PORT=8545 RESET=1 bash src/contract/script/demo-up.sh   # 部署一个全新的金库
```

**不加 `RESET=1` 会复用**：脚本读 `/tmp/alphaplan-demo-env` 里记的地址，
发现链上还有代码就直接用，只重新装 mock feed、重新入金。地址不变。

**加了 `RESET=1` 会换地址**：部署新金库，打印新的 `VAULT_ADDRESS`。
此时必须同步改三处，否则页面读旧库、脚本写新库：

```
src/frontend/alpha-plan/.env.local   VAULT_ADDRESS / DEPLOY_BLOCK   （改了要重启 dev）
根 .env                              VAULT_ADDRESS / DEPLOY_BLOCK   （8788 要用）
```

> **旧金库不会消失。** 它仍在链上、仍有代码、仍能读。
> 脚本会在部署前打印「旧金库 0x… 仍在链上」—— 看到这句就说明下游有指错的风险。

重启后 MetaMask 里**不用重新导入** —— 网络和代币配置都还在。
但**如果换了金库地址，份额代币要重新导入**（ERC-4626 的份额代币就是金库本身）。

### ⚠️ 关于本地链（必须知道）

**本项目的链是本地 anvil fork，只在开发者机器上运行。**

- 金库地址在**公共 Base Sepolia 上没有代码**（`cast code` → `0x`）
- 演示只在本机进行；换一台机器需要重跑 `demo-up.sh`
- 好处是：**任何人都能重建完全相同的状态** —— 这比部署到公共测试网更适合评委验证

前端 P1 的「浏览器自己算哈希」需要连 `http://127.0.0.1:8545`。
连不上时页面会明确显示「这个 demo 的链在本地」，不会假装成功或显示 0。

### demo 环境的三个技术事实

1. **真 Chainlink feed 在合约上下文里调用会 revert `No access`**
   （EOA 调用正常；fork 和真 `sepolia.base.org` 都验证过）。
   所以 demo 用 `anvil_setCode` 把 `MockAggregator` 装到 feed 地址 —— **净值来源是 mock 价**。

2. **池子现货价与 PRD 表里的 feed 价不同**（实测 3697.93 vs 2382.45，差 55%）。
   金库 `minOut` 由 oracle 价推出、容差 50bps，所以 mock 初始价**必须等于池价**，
   否则买入必然 revert。`demo-up.sh` 会自动从 `slot0` 算池价并写入。

3. **抬价必须同时推 oracle 与池子 slot0**。
   只改 oracle 会造出「oracle 说涨了但市场没涨」的不成立场景；
   而且 `minOut` 按 oracle 算会比池子实际给的高，50bps 容差必然 revert。
   `demo-bump-price.sh` 用位运算同时改 `sqrtPriceX96` 与 `tick`（对齐 tickSpacing=60），
   改完读回比对 + 干跑 1 USDC swap 验证深度，失败则回滚。

## 开发

具体的技术栈与启动方式将随首个应用模块一起补充到这里。

目前可用的能力入口：

```bash
cre init              # 初始化 CRE 项目（从模板拉取）
cre workflow simulate # 本地模拟（编译成 WASM 跑在本机，但真实调用线上 API 与公链）
cre login             # 认证（需要 app.chain.link 账号 + 2FA）

baw --help            # 查看钱包 CLI 全部命令
```

> 部署 CRE workflow 到 DON 需要审批（`cre account access` 提交申请）；
> 本地模拟则不需要任何审批。

## 许可证

个人项目，暂未开放授权。未经许可请勿使用。

黑客松赛道：🧠 Verifiable AI。
