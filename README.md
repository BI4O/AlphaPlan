# SuperBi4o

> ⚠️ **本 demo 是 L1/L2，不是 L3。DON 不会真的定时执行**
> （`cre whoami` → `Deploy Access: Not enabled`）。`--broadcast` 发的确实是真交易、
> 走真 forwarder→onReport，但**签名方是本地 CLI，不是 DON 共识**。
> 详见 [诚实边界](#诚实边界8-条逐条都在限制一个对外承诺)。

个人应用（personal app）的构建仓库 —— 用来打造我自己的应用。

> **当前应用：** [AlphaPlan — 可审计的 AI 基金经理](#alphaplan--可审计的-ai-基金经理)
> · 本地 anvil fork · 不承诺收益，只承诺可审计

## 这个仓库是什么

这里存放我个人应用的源码与设计资产。目标不是做一个通用框架或开源库，
而是围绕我自己的使用场景，把想法逐步做成真正能用起来的产品。

- 定位：个人项目，单人（或极小规模）开发与维护
- 关注点：能跑起来、够用、好用，而不是覆盖所有边缘场景
- 迭代方式：小步提交，按需重构

## 目录结构

```
SuperBi4o/
├── .agents/skills/   # 项目级 Agent Skills（随仓库走，会被提交）
├── .claude/          # 其它 Agent 工具的安装残留，已忽略
├── .worktrees/       # Git 工作树（worktree）目录，已忽略
├── skills-lock.json  # 本地安装记录（哈希），已忽略
├── README.md
└── .gitignore
```

随着项目推进，具体的应用代码、子项目会陆续加入此仓库。

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


## AlphaPlan — 可审计的 AI 基金经理

本仓库目前唯一的应用模块。**卖的不是收益，是出处证明**：

> 我们不承诺 AI 赚钱。我们承诺：它的每一个决定，你都能自己算一遍。
> 每一笔交易背后是一份「计划」文件 —— 三个 agent 的辩论记录 + judge 的裁决。
> 文件原始字节的哈希写在链上。改一个字节，就对不上。

完整设计见 [`docs/PRD.md`](docs/PRD.md)，实施计划见 [`docs/PLAN.md`](docs/PLAN.md)，
验收口径见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

### 架构（三件套，各管一件事）

| 组件 | 职责 | 安全目标 |
|---|---|---|
| **合约** `AlphaPlanVault`（ERC-4626） | 持仓、算 NAV、执行 swap、强制风控 | **trustless** —— 不需要信任任何人 |
| **CRE workflow** | 取计划、校验三道门禁、生成签名报告写链 | **traceable** —— 需要出处证明 |
| **AI 辩论层**（链下） | bull / bear / risk 三个 agent 辩论，judge 裁决 | 可复算 —— 输出即证据 |

**NAV 绝不由 CRE 报告。** 它由合约用「持仓 × Chainlink Data Feeds 价格」实时计算。
否则报告与执行之间的时间差就是免费套利窗口。

### 快速开始（本地 anvil fork）

```bash
# 一条命令：起 fork + 部署 + 装 mock feed + 存 20 USDC + 打印地址
bash src/contract/script/demo-up.sh

# 后端产出一次 AI 决策（真实调用 DeepSeek）
cd src/backend && VAULT_ADDRESS=<上一步打印> RPC_URL=http://127.0.0.1:8545 bun run debate

# 跑 CRE workflow（本地模拟，不写链）
cd src/backend/cre && cre workflow simulate alpha-plan --target local-simulation \
  --non-interactive --trigger-index 0

# 验降级门禁：指向一份 degraded:true 的计划，应该拒绝写链
cd src/backend/cre && cre workflow simulate alpha-plan --target local-simulation \
  --config config.degraded.json --non-interactive --trigger-index 0
# → degraded plan, refusing to write / wouldWrite: false

# 前端
cd src/frontend/alpha-plan && pnpm dev     # http://localhost:3000
```

> **命令注意事项**
> - `cre workflow simulate` 的 `--config` 用相对路径（相对 `cre/alpha-plan/`），
>   写成 `./alpha-plan/config.x.json` 会报 "ConfigPath must be a valid existing file"
> - 不带 `--target` 且存在多个 target 时会报 "multiple targets found"

### demo 剧本（净值上涨怎么演）

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
