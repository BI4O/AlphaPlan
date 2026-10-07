# SuperBi4o · 个人 agent（分支 `p2-agent`）

一个跑在本机的个人 agent：pi SDK 作为 agent 内核，React 作为界面，**只读**地接一个
Binance Agentic Wallet（`baw` CLI）。这一版是路线图的**阶段 1**——能看，不能动钱。

```
浏览器 (React)  ──HTTP/SSE──▶  本地 server (Node)  ──▶  pi SDK 会话
                                     │
                                     ├─ 模型路径：wallet_* 工具（只读，9 个）
                                     └─ 面板路径：直接调 baw，不经过模型
```

两条路径是故意分开的：界面上的余额和额度由路由处理器直接读 CLI，不是模型"读完再总结"的结果。
当屏幕上的数字和模型的说法不一致时，你看到的那个必须是可信的。

## 快速开始

```bash
pnpm install

pnpm selftest      # 不需要 API key：验策略、验 CLI、验会话装配
pnpm test          # 64 个策略/守卫单测，约 100ms
pnpm typecheck     # server + web 都检查

pnpm start         # 终端 1：agent server，默认 http://127.0.0.1:8787
pnpm dev:web       # 终端 2：界面，http://localhost:5173
```

`pnpm build:web` 之后 server 会直接托管构建产物，就只需要一个进程。

模型来自 pi 自己的设置（本机解析到 `deepseek/deepseek-v4-pro`）；用 `AGENT_MODEL` 覆盖。

## 目录结构

```
apps/server/src/
  index.ts              入口：loadConfig → createWalletAgent → startServer（只有装配，无逻辑）
  config.ts             ★ 所有环境变量只在这里读；含"某个开关放弃了什么"的告警文本
  agent/
    extensions.ts       ★★ 扩展点：agent 能做什么，全在这里组装
    session.ts          pi 会话装配：skills、扩展、模型、会话存储、排除 bash
  wallet/               钱包域（一个域 = 一个目录）
    policy.ts           ★★ 唯一的策略真相：37 条只读命令 + flag 白名单，默认拒绝
    cli.ts              ★★ 唯一 spawn `baw` 的地方；策略检查先于进程创建；审计日志
    tools.ts            9 个只读工具（固定的 argv 模板）
    guard.ts            shell 守卫（启发式）+ mentionsWalletCli
    policy-doc.ts       同一份策略的"给人看"版本，作为 context file 进 system prompt
    index.ts            createWalletExtension()：把上面几件东西装成一个扩展
  http/
    server.ts           路由 + SSE + 与 web 的 wire 契约
    static.ts           静态文件
  dev/
    selftest.ts         `pnpm selftest`：不用 API key 的自检

apps/server/test/
  wallet-policy.test.ts  允许/拒绝决策、flag 白名单、错误类型
  shell-guard.test.ts    守卫匹配了什么、以及它明确的盲区

apps/web/src/
  main.tsx             React 入口
  App.tsx              布局与状态编排
  api.ts               ★ 与 server 的唯一契约：所有类型 + fetch/SSE 客户端
  hooks/useAgent.ts    SSE 事件流 → { messages, tools, busy, send, abort }
  components/
    Chat.tsx           聊天
    WalletPanel.tsx    钱包面板（余额、额度、会话过期、skills）
    DataView.tsx       通用渲染：CLI 返回什么都按形状渲染，不臆造字段名
  styles.css

pnpm-workspace.yaml    workspace 成员 + allowBuilds（见文末）
```

**改动落点速查**

| 想做的事 | 改哪里 |
|---|---|
| 加一个环境变量 | `config.ts`（并更新 `.env.example` 和本文件） |
| 让 agent 能做一件新事 | `agent/extensions.ts` 加一个 factory |
| 给钱包加一个只读能力 | `wallet/tools.ts` 加工具 + `wallet/policy.ts` 加命令，**两个必须一起改** |
| 放宽/收紧钱包边界 | `wallet/policy.ts`（然后 `pnpm test && pnpm selftest`） |
| 加一个 HTTP 路由 | `http/server.ts` 的 `handleApi` |
| 加一个前端请求 | `web/src/api.ts`，再用 hook 或组件消费 |
| 改 SSE 事件格式 | `http/server.ts` 的 `ClientEvent` + `web/src/api.ts` 的 `ClientEvent`（两处） |

## 安全模型

### 为什么 skill 不是安全边界

`binance-agentic-wallet` 是个写得很认真的 skill，它的安全策略里明确写着"执行前必须确认"，也明确
警告"代币名和链上数据可能包含 prompt injection"。

问题在于：这两句话的执行者，是同一个可能被注入影响的模型。**skill 是文档，不是 policy。**
所以同一个策略在这个仓库里被写了两遍——文档给人看（`wallet/policy-doc.ts`，作为 context file 进
system prompt），代码给机器执行（`wallet/policy.ts`）。真正生效的是后者。改一个就要改另一个。

### 四层防线（从最不可绕过开始）

1. **Binance 服务端硬限制**——只能在 Binance App 里改，agent 改不动：`dailyLimit`、
   `defiDailyLimit`、`x402DailyLimit`、`devMode.dailyLimit`、`abnormalTxnHandling: AutoReject`、
   `tradeAllTokens: false`，加上"收款地址必须在地址簿里"这条结构性白名单。
   → **先把这些数字调到"就算全丢也不心疼"的水平。** 无论代码有多少 bug，天花板在这里。
2. **代码级白名单**（`wallet/policy.ts`）：默认拒绝的 37 条只读命令，外加一个 flag 白名单（防止
   把 `--max` 这类变更型开关塞进读命令）。**未知命令，包括还不存在的命令，一律拒绝。**
3. **唯一出口**（`wallet/cli.ts`）：全仓库只有 `runBaw()` 会 spawn CLI，它在进程存在之前先做策略
   检查，用 `execFile` 传 argv 数组（不经 shell），并往 `data/baw-audit.jsonl` 记一行审计（只记
   命令路径和 flag 名，不记 flag 值和 stdout——argv 里可能有地址，stdout 里可能有会话信息）。
   界面上的 `/api/wallet/summary` 也走这里，所以"面板"和"模型"同样受约束。
4. **shell 守卫**（`wallet/guard.ts`）：用 pi 的 `tool_call` / `user_bash` hook 拦住任何提到
   `baw` 的 shell 命令。

### 阶段 1 为什么把 shell 关掉

第 4 层是**字符串匹配，它挡事故，不挡对手**：`eval "$(echo … | base64 -d)"` 就能绕过它
（`test/shell-guard.test.ts` 里有一条测试专门把这个盲区钉住），而 `baw` 本身能执行任何它支持的
命令，包括转账。

所以阶段 1 默认 `AGENT_SHELL=off`：pi 的 `bash` / `powershell` 工具**不注册**，agent 只能通过
`wallet_*` 工具碰钱包。这才是"只读"在结构上成立的原因，而不是靠它不去尝试。

另外 `AGENT_CWD` 默认指向仓库外的 `workspace/`，并且拒绝指向本 server 自己的源码目录：一个能写
文件的 agent，如果工作目录就是自己的代码，一次注入就能变成下次启动时的代码执行。

打开 `AGENT_SHELL=on` 是可以的，但要接受这个等式：**shell 打开 ≈ 钱包边界退回到第 1 层**。真正
想同时要 shell 和真正的钱包边界，就得上独立的 broker 进程（见路线图阶段 2/3）。

## 拓展指南

### 1. 加一个 skill

**不需要写代码。** 把目录放到发现路径下就会自动加载：

```
~/.pi/agent/skills/<name>/SKILL.md            # 全局
~/.agents/skills/<name>/SKILL.md              # Agent Skills 规范位置
<AGENT_CWD>/.agents/skills/<name>/SKILL.md    # 项目级（从 cwd 向上找，遇 repo root 停）
<AGENT_CWD>/.pi/skills/<name>/SKILL.md
```

`SKILL.md` 是 frontmatter + 正文：`name` / `description` 进 system prompt 做路由，正文只在需要时
被读取（渐进式加载）。写法与坑见 `docs/skills.md`。

三个实操要点：

- **description 决定命中率**，要同时说清"做什么"和"什么时候用"。它的质量比正文重要得多。
- **frontmatter 必须是合法 YAML**。`description` 里出现 `: `（冒号+空格）而没加引号，整个 skill 会
  **静默不加载**，只在 `skillDiagnostics` 里留一条 warning——server 启动时会打印，`/api/state`
  和界面上的 Skills 面板也会显示。本机现在就有一个中招的（`design-system-blueprint`）。
- **应用内管理 skill**（以后想让 UI 装/开关 skill）：把 skill 写进你自己的目录，再让
  `DefaultResourceLoader` 认它。两种做法：
  - 目录固定 → 在 settings 里加 `skills: ["~/superbi4o/skills"]`，或在 `DefaultResourceLoader`
    的 `additionalExtensionPaths` 同级机制里加路径；
  - 完全自管 → 用 `DefaultResourceLoader` 的 `skillsOverride`，像 `agent/session.ts` 现在过滤
    `binance-agentic-wallet` 那样，把自管的 skill 并进列表。改完调 `loader.reload()`。

  注意：skill 是**指令**，不是工具。给模型一个新 skill，等于给它一段可以诱导它行为的文本。所以
  **一个 skill 永远不应该被当作"授权"**——它能做的只是让模型知道一件事该怎么做。

### 2. 加一个工具域

以"加一个 `jobs` 域"为例，四步：

```ts
// 1) apps/server/src/jobs/tools.ts
import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const jobList = defineTool({
  name: "job_list",
  label: "List jobs",
  description: "List background jobs and their state.",
  promptSnippet: "List background jobs",
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: "text", text: "…" }], details: {} };
  },
});

export function registerJobTools(pi: ExtensionAPI): void {
  pi.registerTool(jobList);
}

// 2) apps/server/src/jobs/index.ts
// export function createJobsExtension(): ExtensionFactory {
//   return (pi) => registerJobTools(pi);
// }

// 3) apps/server/src/agent/extensions.ts
//    factories.push(createJobsExtension());

// 4) 如果这个域有安全边界，就把它自己的 policy 放进 jobs/policy.ts，
//    并像 wallet/cli.ts 那样做唯一出口——不要散落在各处。
```

约定（每个域都值得照做）：

- **每个域一个目录**，`index.ts` 导出唯一的 `create<Domain>Extension()`。
- **工具是"固定模板 + 模型只填值"**，不要让模型拼命令或 argv。
- **域自己的策略和唯一出口放在域内**，并在 README 里写清它放弃了什么。
- **`promptSnippet` 写一句话**，它决定工具在 system prompt 的 Available tools 里怎么出现；
  `promptGuidelines` 可以放额外的使用规则。

### 3. 接 MCP

pi 的 SDK 会话**不自动加载** MCP（CLI 才加载），要显式加。已经预留好了，打开开关即可：

```bash
AGENT_MCP=on pnpm start
```

对应 `agent/extensions.ts` 里的 `createMcpExtension()`——它读 agent 目录和已信任项目里的
`mcp.json`，和 CLI 的行为一致。细节（服务器配置、exposure、认证）见 `docs/mcp.md`。

**⚠️ 这是这个仓库里最需要先想清楚的一个开关。** `wallet/*` 只守两件事：pi 的 bash 工具，和
`wallet_*` 工具自己。MCP 带来的是**第三种工具**，它不在这个守卫的视野里：

- 一个能执行命令的 MCP 工具，就是一条绕开 shell 守卫去调 `baw` 的路；
- 一个能读文件的 MCP 工具，可能读到 `data/baw-audit.jsonl` 或会话 JSONL；
- MCP 服务器进程本身以你的用户权限运行。

所以：**只接你信任的、且尽量只读的 server**。这也是 `configWarnings()` 会在启动时打印告警的原因。
如果只是想让模型"多几个查询工具"，优先写本地工具（上一节），那条路的边界是清楚且可审计的。

### 4. codemode 与 tool_search

```bash
AGENT_CODEMODE=on AGENT_TOOL_SEARCH=on pnpm start
```

这两个让模型把多个工具调用写进一段 QuickJS 脚本一次跑完，并让工具可以按需被搜索到。工具多了之后
（比如 MCP 挂了一堆 server）很值得开。实现上有一个容易踩的坑已经在代码里处理了：注册它们**不等于
激活**，激活要走 `defaultTools` 设置，而不是 `tools` 选项——后者会把会话限制成只有这些工具、反而
把 MCP 工具藏起来。见 `agent/extensions.ts` 的 `buildDefaultTools()`。

### 5. "登录" —— 两个完全不同的东西

**（a）钱包登录（wallet session）**，也就是让 `baw` 连上你的钱包。流程来自
`references/authentication.md`，要点：

```text
baw auth signin --json   → { urlForWeb, qrCodeId, pairingCode, expireAt }
                           pairingCode 必须原样显示；urlForWeb 原样打开，不要拼接
baw auth verify --qrCodeId <id> --json
                           ← 阻塞最长 5 分钟，直到用户在 Binance App 确认
baw wallet status --json ← "是否已连接"的唯一真相，不是 App 的界面
```

四个必须处理的现实：

1. **`verify` 是前台阻塞调用**，最长 5 分钟，**中途被 kill 会导致认证不落地**（App 显示成功但
   CLI 仍 `UNCONNECTED`）。所以不能把它挂在一次 HTTP 请求上——要做成后台任务，UI 轮询
   `wallet status`。
2. **二维码约 5 分钟过期**，`AUTH_REJECTED` 时要用**新的** `qrCodeId` 重来，不要拿旧的反复
   `verify`。
3. **App 显示"已登录"不等于连上了**，一律以 `wallet status` 为准。
4. **会话本身会过期**（`maxSigninDuration`，本机现在是 7d；`sessionExpireTime` 见 `wallet_settings`），
   而且 sign-out 是**静默的**。界面必须一直显示这个时间。

实现建议（**尚未构建**）：不要把它塞进 `wallet/policy.ts` 的只读白名单——那会破坏 `cli.ts`
"我跑的每一条都是只读查询"这个不变量。正确做法是另开一个会话通道：

```
wallet/session-cli.ts    只有 auth signin / auth verify 两个命令，自带极小白名单
http/server.ts           POST /api/wallet/signin（起 signin，返回 pairingCode + urlForWeb）
                         POST /api/wallet/signin/verify（后台跑 verify，立刻返回）
                         GET  /api/wallet/signin/status（轮询 wallet status）
```

关键约束：**这条通道不注册任何工具**，模型拿不到它。`auth` 永远不进 `READ_ONLY_COMMANDS`，
`test/wallet-policy.test.ts` 里有两条测试专门钉住这一点（`auth signin` / `auth signout` 必须被拒）。

→ 会话明天就过期（`2026-10-08T17:30:02+08:00`），所以这是**建议的下一件事**：不做的话，过期后
整个面板只能告诉你"未连接"。

**（b）应用自身的登录**，也就是"这个 server 谁能访问"。现在默认 `HOST=127.0.0.1`，只听本机，没有
认证。以后真要远程访问，按优先级：

1. **隧道/内网**：Tailscale、Cloudflare Tunnel 之类，把认证交给网络层；
2. **一个静态 bearer token**：反向代理或 server 里加一层 `Authorization` 校验，token 放
   `.env`（`.gitignore` 已经排除 `.env*`，只保留 `.env.example`）；
3. **不要自己写用户名密码系统**。这个服务的价值是"你的钱包在你自己的机器上"，把它变成一个有账号
   体系的公网服务，是在给自己造一个高价值的攻击目标。如果真要做多用户，那已经是另一个阶段——
   并且需要先有独立 broker 进程和 per-user 的会话隔离。

### 6. 阶段 2：审批通道（钱包写操作的前置条件）

在加入**任何**变更类命令之前，先把审批通道做出来。设计要点，以及为什么每条都要：

| 要求 | 为什么 |
|---|---|
| 审批 token 绑定 `hash(argv + 参数)` | 批准了 A 却执行了 B 是这类系统最典型的漏洞 |
| token 一次性、短 TTL | 重放保护 |
| token 由 UI 点击产生 | 模型说"用户同意了"不算同意；`ctx.ui.confirm` 在无 UI 的 SDK 会话里返回 false（pi 的约定就是 fail-closed） |
| 审批请求落盘（含 argv、时间、结果） | 事后可审计；也是崩溃后对账的依据 |
| `devMode` 保持关闭 | `contract-call` / `sign-message` 是任意 calldata，等于任意资产转移 |

落点：`wallet/approvals.ts`（新）+ `wallet/tools.ts` 里给变更类工具加前置检查 + `http/server.ts`
加审批路由 + `wallet/policy.ts` 新增一个 `gated` 层级（**不是**放宽 `READ_ONLY`）。

### 7. 阶段 3：durable job 层（调度）

调度资产的关键判断：**触发器不能是"LLM 轮询"**。三条路，优先级从高到低：

1. `limit-order` 挂单，让**交易所**持有条件——3am 触发不需要你的机器开着、不需要会话有效；
2. 服务端 monitor job 轮询价格，条件满足时执行**预先批准过的固定命令模板**；
3. ❌ 让 agent 每分钟醒来问模型"现在该卖吗"——任何一个环节出错，结果都是一个你没同意过的市价成交。

（skill 自己就禁止了"把条件单静默降级成市价单"，见 SKILL.md 第 7 条。在自己的调度器里，正确做法是
结构性地保证它：job 的 action 是写死的 argv 模板。）

durable 语义上的四条硬要求：**intent 先落盘再广播**（幂等键 = `hash(argv)`，因为这个 CLI 只有
external-sign 有 `requestId`）；**绝不盲目重试广播**，重启后靠 `wallet tx-history --type pending`、
`market-order list`、`limit-order list`、`wallet tx-lock` **向交易所对账**；**会话过期 fail-closed
并通知**，不静默跳过也不循环重试；**USD 上限的汇率不能由模型提供**。

这一层正是 `@earendil-works/pi-durable` 擅长的地方（幂等重放、`replay: "safe"`、task graph、
abort 自下而上）。它不支持 skill（要自己实现约 50 行：扫目录 → 渲染 system prompt section →
让模型用 `read` 读 `SKILL.md`），所以它适合出现在 **job 层**，而不是替换掉 agent 内核。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_CWD` | `<repo>/workspace` | agent 的工作目录。指向本仓库源码会被拒绝启动 |
| `AGENT_MODEL` | pi 的设置 | `provider/modelId`，例如 `deepseek/deepseek-chat` |
| `AGENT_SHELL` | `off` | `on` 会注册 pi 的 bash 工具，钱包边界随之退化（见安全模型） |
| `AGENT_SESSION_DIR` | `<repo>/data/sessions` | 会话 JSONL，重启可继续 |
| `AGENT_INCLUDE_WALLET_SKILL` | `off` | 是否把 `binance-agentic-wallet` skill 也给模型。阶段 1 关掉：路由表只会引诱它去跑它跑不了的命令 |
| `AGENT_CODEMODE` | `off` | 启用 pi 的 codemode（模型写脚本批量调工具） |
| `AGENT_TOOL_SEARCH` | `off` | 启用工具搜索 |
| `AGENT_MCP` | `off` | ⚠️ 连接 `mcp.json` 里的 MCP server。这些工具不在钱包守卫的视野里 |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | 监听地址。默认只听本机 |
| `WEB_ROOT` | `apps/web/dist` | 静态文件目录 |
| `BAW_BIN` | `baw` | CLI 路径 |
| `BAW_TIMEOUT_MS` | `30000` | 单次调用超时 |
| `BAW_AUDIT_LOG` | `<repo>/data/baw-audit.jsonl` | 设为 `off` 关闭审计 |

启动时 `configWarnings()` 会把"某个开关放弃了什么"打印出来。

## 接口

| 路由 | 作用 |
|---|---|
| `GET /api/state` | 模型、cwd、shell 开关、已加载 skill、启用工具、策略阶段 |
| `GET /api/wallet/summary` | status + settings + balances，**不经过模型** |
| `GET /api/events` | SSE：`delta`、`tool_start`、`tool_end`、`busy`、`settled`、`error` |
| `POST /api/prompt` | `{"text": "..."}`，忙碌时自动变成 follow-up 排队 |
| `POST /api/abort` | 停止当前运行 |

`GET /` 在 `apps/web/dist` 存在时返回界面，否则返回一页占位说明。

## 关于 pnpm

这是个 pnpm workspace：成员在 `pnpm-workspace.yaml`（pnpm **不读** `package.json` 的 `workspaces`
字段），根目录脚本用 `pnpm --filter` 转发。

```bash
pnpm --filter @superbi4o/server test     # 等价于根目录的 pnpm test
pnpm --filter @superbi4o/server add <pkg>          # 加运行时依赖
pnpm --filter @superbi4o/server add -D <pkg>       # 加开发依赖
```

两件和 npm 不同的地方，都是有意为之：

- **依赖的安装脚本默认不执行**，而且每个带脚本的依赖必须被显式批准或拒绝，否则安装以
  `ERR_PNPM_IGNORED_BUILDS` 失败。名单在 `pnpm-workspace.yaml` 的 `allowBuilds`，用
  `pnpm approve-builds` 修改，不要手写。**每个 `true` 都是一段会在你机器上执行的第三方代码**，
  所以这是一份值得审的名单，不是样板文件。
- **`node_modules` 是隔离的**（非扁平）。这也意味着 `typebox` 被故意 pin 在 `1.3.27`，和 pi 自己
  的依赖完全同版本——否则会出现两份 TypeBox，类型对不上。

`baw` 是全局 CLI，不在 workspace 里。升级它**是人工作为**：skill 的 preflight 会自己
`pnpm add -g`，在无人值守的资产调度器里那等于让一个能动钱的 CLI 从网络自动升级自己。用
`baw cli-check --required-version <版本>` 检查，不要自动装。

## 维护

改了 `wallet/policy.ts` 之后：

```bash
pnpm test        # 必须全绿
pnpm selftest    # 顺带打印会话过期时间和当前日限额
```

flag 白名单不要手写。它由"白名单命令实际用到的 flag"推导而来，从 skill 的 references 重新生成再
和代码里对比：

```bash
cd ~/.pi/agent/skills/binance-agentic-wallet/references && python3 - <<'EOF'
import re, pathlib
allowed = sorted({
 "wallet status","wallet chains","wallet address","wallet balance","wallet tx-history",
 "wallet gas-price","wallet settings","wallet tx-lock","approvals list","approvals detail",
 "market-order quote","market-order list","limit-order list","prediction category list",
 "prediction market list","prediction market detail","prediction market search",
 "prediction market order-book","prediction market last-trade-price","prediction position list",
 "prediction position token","prediction position settled-history","prediction position pnl",
 "prediction position portfolio","prediction order history","prediction trade quote",
 "defi protocol-list","defi protocol-info","defi investment-list","defi investment-info",
 "defi position","defi preview","x402-payment preview","sign-message result",
 "sign-message history","skill-check","cli-check",
}, key=len, reverse=True)

flags = set()
for path in pathlib.Path(".").glob("*.md"):
    in_syntax = False
    for line in path.read_text().splitlines():
        if line.strip().startswith("### Syntax"): in_syntax = True; continue
        if in_syntax and (line.strip().startswith("###") or line.strip().startswith("## ")):
            in_syntax = False; continue
        if not in_syntax or not line.strip().startswith("baw "): continue
        if any(line.strip()[4:].startswith(c) for c in allowed):
            flags |= set(re.findall(r"--[a-zA-Z][a-zA-Z-]*", line))
print(" ".join(sorted(flags)))
EOF
```

更快的路：先跑 `pnpm selftest`，失败项会直接指出是哪个 flag 不在白名单里。

## 路线图与已知限制

| 阶段 | 内容 | 前置条件 |
|---|---|---|
| **1（当前）** | 只读工具 + 界面 + 面板直读 | ✅ |
| **下一代（建议优先）** | 钱包登录面板（`auth signin` / `verify` 的后台验证 + 二维码展示） | 会话明天过期，不做就只能显示"未连接" |
| 2 | 变更类工具 + 带外审批 | 审批通道（见拓展指南 §6） |
| 3 | 调度 + durable job 层 | 阶段 2；且先决定要不要独立 broker 进程 |
| 4 | 多策略 / 再平衡 | 阶段 1–3 都没出意外之后 |

已知限制：

- **单会话**：一个进程一个 pi 会话。多会话/多用户是阶段 2+ 的事。
- **没有审批通道**：`ctx.hasUI` 为 false 时 pi 的约定是默认阻止，本仓库沿用这个方向。
- **会话过期是静默的**：过期后 agent 只能报告，不能自动重登（见拓展指南 §5a）。
- **合约审计 skill 未安装**：`query-token-audit` / `query-token-info` 都不在，所以 skill 的 swap
  安全前置检查跑不了。阶段 1 不 swap，暂时无影响；**阶段 2 之前必须装上或显式承认这个缺口**。
- **shell 守卫是启发式的**：见 `test/shell-guard.test.ts` 里那条钉住盲区的测试。
- **读命令的 flag 白名单是手工维护的**：CLI 升级后如果新增 flag，读命令会先被拒绝，这是预期的
  fail-closed 行为，按维护一节处理。
- **`designSystem` 的那个 skill 目前是坏的**：`design-system-blueprint/SKILL.md` 的 frontmatter
  里 `description` 含未加引号的 `: `，YAML 解析失败 → 该 skill 静默不加载。修法：给 description
  加引号，或把那个冒号换成破折号。
