# SuperBi4o

个人应用（personal app）的构建仓库 —— 用来打造我自己的应用。

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
