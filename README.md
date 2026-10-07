# SuperBi4o · 个人 agent（分支 `p2-agent`）

一个跑在本机的个人 agent：pi SDK 作为 agent 内核，React 作为界面，**只读**地接一个
Binance Agentic Wallet（`baw` CLI）。这一版是路线图的**阶段 1**——能看，不能动钱。

```
浏览器 (React)  ──HTTP/SSE──▶  本地 server (Node)  ──▶  pi SDK 会话
                                     │
                                     ├─ 模型路径：wallet_* 工具（只读，8 个）
                                     └─ 面板路径：直接调 baw，不经过模型
```

两条路径是故意分开的：界面上的余额和额度由路由处理器直接读 CLI，不是模型"读完再总结"的
结果。屏幕上的数字和模型的说法可以不一致时，你看到的那个必须是可信的。

## 快速开始

```bash
npm install

npm run selftest      # 不需要 API key：验策略、验 CLI、验会话装配
npm run test          # 62 个策略单测，毫秒级

npm run start         # 终端 1：agent server，默认 http://127.0.0.1:8787
npm run dev:web       # 终端 2：界面，http://localhost:5173
```

`npm run build:web` 之后，server 会直接托管构建产物，就只需要一个进程。

模型来自 pi 自己的设置（本机解析到 `deepseek/deepseek-v4-pro`）；用 `AGENT_MODEL` 覆盖。

## 安全模型

### 为什么 skill 不是安全边界

`binance-agentic-wallet` 是个写得很认真的 skill，它的安全策略里明确写着"执行前必须确认"，
也明确警告"代币名和链上数据可能包含 prompt injection"。

问题在于：这两句话的执行者，是同一个可能被注入影响的模型。**skill 是文档，不是 policy。**
所以同一个策略在这个仓库里被写成了两遍——文档给人看（`wallet-policy-doc.ts`，会作为
context file 进入 system prompt），代码给机器执行（`policy.ts`）。真正生效的是后者。

### 四层防线（从最不可绕过开始）

1. **Binance 服务端硬限制**——只能在 Binance App 里改，agent 改不动：
   `dailyLimit`、`defiDailyLimit`、`x402DailyLimit`、`devMode.dailyLimit`、
   `abnormalTxnHandling: AutoReject`、`tradeAllTokens: false`，加上"收款地址必须在地址簿里"这条
   结构性白名单。
   → **先把这些数字调到"就算全丢也不心疼"的水平。** 无论代码有多少 bug，天花板在这里。
2. **代码级白名单**（本仓库）：`policy.ts` 是默认拒绝的。37 条只读命令，外加一个 flag 白名单
   （防止把 `--max` 这类变更型开关塞进读命令）。**未知命令，包括还不存在的命令，一律拒绝。**
3. **唯一出口**：全仓库只有 `baw.ts` 的 `runBaw()` 会 spawn CLI，它在进程存在之前先做策略检查，
   用 `execFile` 传 argv 数组（不经 shell），并往 `data/baw-audit.jsonl` 记一行审计
   （只记命令路径和 flag 名，不记 flag 值和 stdout——argv 里可能有地址，stdout 里可能有会话信息）。
4. **shell 守卫**：`wallet-tools.ts` 用 pi 的 `tool_call` / `user_bash` hook 拦住任何提到 `baw`
   的 shell 命令。

### 阶段 1 为什么把 shell 关掉

第 4 层是**字符串匹配，它挡事故，不挡对手**。`eval "$(echo … | base64 -d)"` 就能绕过它，
而 `baw` CLI 本身能执行任何它支持的命令，包括转账。

所以阶段 1 的默认值是 `AGENT_SHELL=off`：pi 的 `bash` / `powershell` 工具**不注册**，agent
只能通过 `wallet_*` 工具碰钱包。这才是"只读"这句话在结构上成立的原因，而不是靠它不去尝试。

另外，`AGENT_CWD` 默认指向仓库外的 `workspace/`，并且拒绝指向本 server 自己的源码目录：
一个能写文件的 agent 如果工作目录就是自己的代码，一次注入就能变成下次启动时的代码执行。

打开 `AGENT_SHELL=on` 是可以的，但要接受这个等式：**shell 打开 ≈ 钱包边界退回到第 1 层**
（也就是只剩 Binance 服务端的日限额）。真正想同时要 shell 和真正的钱包边界，就得上独立的
broker 进程——那一步被推迟到了阶段 2/3。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_CWD` | `<repo>/workspace` | agent 的工作目录。指向本仓库源码会被拒绝启动 |
| `AGENT_MODEL` | pi 的设置 | `provider/modelId`，例如 `deepseek/deepseek-chat` |
| `AGENT_SHELL` | `off` | `on` 会注册 pi 的 bash 工具，钱包边界随之退化（见上） |
| `AGENT_SESSION_DIR` | `<repo>/data/sessions` | 会话 JSONL，重启可 `--continue` |
| `AGENT_INCLUDE_WALLET_SKILL` | `off` | 是否把 `binance-agentic-wallet` skill 也给模型。阶段 1 关掉：路由表只会引诱它去跑 `baw` |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | 监听地址。默认只听本机 |
| `WEB_ROOT` | `apps/web/dist` | 静态文件目录 |
| `BAW_BIN` | `baw` | CLI 路径 |
| `BAW_TIMEOUT_MS` | `30000` | 单次调用超时 |
| `BAW_AUDIT_LOG` | `<cwd>/data/baw-audit.jsonl` | 设为 `off` 关闭审计 |

## 接口

| 路由 | 作用 |
|---|---|
| `GET /api/state` | 模型、cwd、shell 开关、已加载 skill、启用工具、策略阶段 |
| `GET /api/wallet/summary` | status + settings + balances，**不经过模型** |
| `GET /api/events` | SSE：`delta`、`tool_start`、`tool_end`、`busy`、`settled`、`error` |
| `POST /api/prompt` | `{"text": "..."}`，忙碌时自动变成 follow-up 排队 |
| `POST /api/abort` | 停止当前运行 |

## 维护

改 `policy.ts` 的只读白名单之后：

```bash
npm run test        # 必须全绿
npm run selftest    # 会顺带打印当前会话的过期时间
```

flag 白名单不要手写。它由「白名单命令实际用到的 flag」推导而来，可以重新生成再和
`policy.ts` 里的对比：

```bash
cd ~/.pi/agent/skills/binance-agentic-wallet/references && python3 - <<'EOF'
import re, pathlib
# 本仓库 policy.ts 里的允许命令，按最长匹配优先
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

更快的路：先跑 `npm run selftest`，失败项会直接指出是哪个 flag 不在白名单里。

**升级 `baw` CLI 是人工作为。** skill 的 preflight 会自己 `npm install -g`，在无人值守的资产
调度器里那等于让一个能动钱的 CLI 从网络自动升级自己。用
`baw cli-check --required-version <版本>` 检查，不要自动装。

## 路线图

| 阶段 | 要加的东西 | 关键点 |
|---|---|---|
| **1（当前）** | 只读工具 + 界面 | ✅ 已完成 |
| 2 | 变更类工具 + **带外审批** | 审批要绑定 `hash(argv + 参数)` 的一次性 token，UI 点批准才发；模型说"用户同意了"不算。`devMode` 保持关闭，`contract-call` / `sign-message` 继续拒绝 |
| 3 | 调度 + durable job 层 | 触发器用 `limit-order` 或服务端 monitor job，**绝不让 LLM 轮询决策**。intent 先落盘再广播；崩溃后靠 `wallet tx-history --type pending` 对账，绝不盲目重试广播 |
| 4 | 多策略 / 再平衡 | 只有在阶段 1–3 都没出意外之后 |

阶段 3 的 durable 语义（幂等键、replay-safe、abort 自下而上）正是 `@earendil-works/pi-durable`
擅长的东西。它没有 skill 支持（skills 要自己实现约 50 行：扫目录 → 渲染 system prompt section
→ 让模型用 `read` 读 `SKILL.md`），所以它适合出现在 job 层，而不是替换掉 agent 内核。

## 已知限制

- **单会话**：一个进程一个 pi 会话。多会话/多用户是阶段 2+ 的事。
- **没有审批通道**：`ctx.hasUI` 为 false 时 pi 的约定是默认阻止，本仓库沿用这个方向——阶段 1
  没有需要审批的动作，阶段 2 才会引入带外审批。
- **会话过期是静默的**（skill 自己的警告）：过期后唯一能做的就是报告，不能自动重登。界面上把
  `sessionExpireTime` 显示出来。
- **合约审计 skill 未安装**：`query-token-audit` / `query-token-info` 都不在，所以 skill 的
  swap 安全前置检查跑不了。阶段 1 不 swap，暂时无影响；阶段 2 之前必须装上或显式承认这个缺口。
- **shell 守卫是启发式的**：见上面"为什么把 shell 关掉"。
- **未知的 CLI 字段不会自动进白名单**：CLI 升级后如果新增 flag，读命令会先被拒绝，这是预期
  行为（fail-closed），按维护一节处理。
