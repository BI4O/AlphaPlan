# backend

AlphaPlan 的链下部分：AI 辩论产计划文件，以及链上 ↔ 文件的哈希对账。无常驻服务。

## 安装

```bash
bun install
```

## 命令

```bash
bun run debate             # 读 Chainlink feed + 金库 → bull/bear/risk 辩论 → judge 裁决 → plans/<planId>.json
bun run debate --offline   # 不联网、不调 LLM，输出固定样例（断网兜底）
bun run debate --check     # 校验已提交的计划：schema + 字节 + 往返 + prompt 哈希 + 封印
bun run debate --help      # 全部参数
bun test                   # 77 个测试（schema 边界、字节规则、LLM 请求体、CLI 行为、模板哈希）
bun run typecheck          # bun check
```

脚本通过 `bun --env-file=../../.env` 读仓库根目录的 `.env`（Bun 只在 cwd 找 `.env`，
后端的 cwd 是 `src/backend`）。shell 里已导出的同名变量优先，`--env-file` 不会覆盖它。

`--offline --as-of "$(date -u +%s)"` 可产出 `validUntil` 在未来的样例（录 demo 用）；
不带 `--as-of` 时样例固定为 `2026-10-24T03:00:00Z`，因此两次运行字节完全相同。

## 模型：一个 DeepSeek，四份 system prompt

```
deepseek-flash     bull / bear / risk（并行三次调用）
deepseek-v4-pro    judge（更强的模型做裁决，不只是更强的 prompt）
temperature        0（所有调用；非 0 则记录不可复现）
base URL           https://api.deepseek.com（OpenAI 兼容）
```

「四个角色」靠 `prompts/*.txt` 分化，不靠四个厂商的模型。计划文件里的 `model` 字段写的是
**真实模型名**（`deepseek-flash` / `deepseek-v4-pro`）。不写 `claude-opus`、`gemini` 这类
没真正调用的名字：那会和 README §9.3「model 是自述，不是推理证明」直接矛盾。

诚实说法：*我们用同一个 DeepSeek 模型 + 四份不同的 system prompt 模拟四类投研视角，
成本可控且完全可复现；`model` 字段记录的是真实模型名。*

```bash
export DEEPSEEK_API_KEY=...          # 只放 .env，不进 Git
export VAULT_ADDRESS=0x...           # 不设则 navUsdc/wethBps 记 0 且 degraded: true
# 可覆盖项：DEBATE_LLM_MODEL / DEBATE_JUDGE_MODEL / DEBATE_LLM_BASE_URL
#          DEBATE_LLM_MAX_TOKENS / DEBATE_LLM_EFFORT(low|high|max) / RPC_URL
```

⚠️ **`max_tokens` 不能给小值。** DeepSeek 把 `reasoning_content` 计入
`completion_tokens`：`max_tokens=10` 时 `content` 是空字符串、`finish_reason=length`
（实测）。默认 2000，低于 800 直接在建 config 时报错，而不是让一次辩论产出空意见。

## 数据来源

| 字段 | 来源 |
|---|---|
| `input.ethUsd` / `btcUsd` | Chainlink ETH/USD、BTC/USD `latestRoundData()`（8 位精度，含 roundId/answeredInRound/陈旧 ≤1h 检查） |
| `input.*24hPct` | 同一 feed 的**历史 round**（二分查找最接近 24h 前的那个，±2h 内）；读不到时退回本地缓存；两者都没有则记 0 且 `degraded: true` |
| `input.vault.*` | 金库 `totalAssets()` / `currentWethBps()`；`VAULT_ADDRESS` 未设则记 0 且 `degraded: true` |

不使用新闻源：它对 demo 是可选项，不是依赖。

## 目录

```
src/
├── schema.ts    # zod 契约：target 0..6000 / observed 0..10000、modelProvenance、degraded 必填
├── canonical.ts # 唯一写入器 + 字节规则 + keccak/sha256 + plans.lock.json 封印
├── market.ts    # 权威数据：feed（含陈旧检查与 24h 历史 round）、金库 view、缓存
├── llm.ts       # OpenAI 兼容客户端（DeepSeek 默认），temperature 0
├── prompts.ts   # 读 prompts/*.txt 原始字节并算 keccak256
├── debate.ts    # CLI：live / --offline / --check
└── fixtures.ts  # 测试用计划样例
prompts/         # bull / bear / risk / judge 四份模板，**必须提交**（否则 promptTemplateSha 无法复算）
plans/           # 计划文件 + plans.lock.json，提交进 Git —— 它们是证据
```

## 四条硬规则

**1. 计划文件的原始字节就是被哈希的对象。**
CRE 对 HTTP 响应体原始字节算 keccak256，verify 与前端对文件原始字节算 —— 必须逐字节相同。
永远不要 `JSON.parse` 之后再 `JSON.stringify` 去算哈希：键顺序和空格一变，链上哈希立刻对不上。
`--check` 会重算并比对，所以文件是**重新生成**，不是手工编辑。

**2. 契约与写入器必须同一次提交改完。**
`serializePlan` 由 `canonical.ts` 里显式的字段序驱动，并且**双向**校验：schema 多出的字段、
写入器多写的字段，都会抛错而不是静默丢失。`--check` 还会做
`serialize → parse → serialize` 的逐字节相等断言 —— 只改一侧，往返立刻失败。

**3. `degraded` 必填，且降级计划不得上链。**
offline 样例恒为 `true`；live 只要缺任何输入（金库未配置、24h 数据缺失）也为 `true`。
workflow 读到 `degraded: true` 必须拒绝生成报告：链上无法区分"真实决策"和"演示样例"，
两者都是同一个 `planHash`，所以这个字段是安全边界，不是注释。

**4. `plans.lock.json` 只是"没被误改"的封印，不是锚点。**
计划文件故意不存自己的哈希，`--check` 需要一个本地封印才能发现「改了一个字节」。
能改文件的人也能改封印，所以它只证明"不是手滑"，不证明"没被篡改"。
真正的锚点是链上事件里的 `planHash`。

## ⚠️ 复算命令：`0x` 前缀 + `-c 1000000` + `tr -d '\n'`

```bash
cast keccak 0x$(xxd -p -c 1000000 plans/2026-10-24T03:00:00Z.json | tr -d '\n')   # ✅ 对文件字节算
cast keccak $(xxd -p -c 100000 plans/2026-10-24T03:00:00Z.json)                   # ❌ 两处都错
```

两个坑，都会算出"看起来像哈希"的错值：

1. **不带 `0x`**：`cast keccak` 把参数当 UTF-8 文本，而 `xxd -p` 输出的正是十六进制字符。
2. **`-c 100000`**：文件超过 100 KB 时会折成多行，`$( )` 保留换行，算的就不再是原始字节。

最小可复现：

```
printf 'abc' > t.bin
cast keccak $(xxd -p t.bin)   # 0x656fed88…  = keccak256("616263" 这六个字符)
cast keccak 0x616263          # 0x4e03657a…  = keccak256("abc")
```

模板同理：

```bash
cast keccak 0x$(xxd -p -c 1000000 prompts/bull.txt | tr -d '\n')
# 0xceb2a196bb23d0116cc8f56d3664d310e5aa9725998624ff655b7086fc28b1f7
# 应与计划文件里 bull 的 promptTemplateSha 相同
```

## 边界

- `model` / `promptTemplateSha` / `temperature` 是**同一进程的自述**：planHash 绑定"输出 +
  它对模型和 prompt 的声称"，**不是**推理证明。手写 JSON 也能这么写（见 README §9.3）。
- 四个角色共用一个模型家族，靠 system prompt 分化；「judge 更强」是真的（`deepseek-v4-pro`
  vs `deepseek-flash`），但四个"独立分析师"不是四家厂商。
- `verify.ts`（链上事件 ↔ 文件对账）属 P4，仍需先有部署合约与 txHash。

详见 `docs/PRD.md` §7.2 与 `docs/PLAN.md` P2。
