import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

/**
 * 演示操作 API —— 把四个原本要敲命令行的动作变成按钮。
 *
 * ## 为什么这些动作必须在服务端跑
 *
 * 前三个都要碰「链之外的系统」：
 *   - `debate`   要调 DeepSeek，API key 只在服务端（绝不下发浏览器）
 *   - `onReport` 要用 forwarder 地址发交易，本地链上是 anvil_impersonateAccount
 *   - `bump`     要写 anvil 的 storage（anvil_setStorageAt），这是 debug 方法
 *
 * 所以浏览器只发 `POST /api/demo` 带一个 action，服务端 spawn 对应命令，
 * 流式把 stdout 回传。浏览器不接触任何私钥、API key 或 debug RPC 方法。
 *
 * ## 为什么用 spawn 而不是内联实现
 *
 * 这些脚本已经存在、已经被验收过（ACCEPTANCE 里逐条对着它们）。重写一遍
 * 等于让「验收的东西」和「演示时跑的东西」变成两份实现 —— 那正是这次
 * `plans/` 分叉事故的同类错误（同一个判定，两处实现）。
 *
 * ## 一个必须诚实的地方
 *
 * `onReport` 用 `anvil_impersonateAccount` 假扮 forwarder。真实部署里
 * 这个交易是 CRE 的 forwarder 合约发的，私钥在 Chainlink 的 DON 里。
 * 本地没有 DON，所以用 anvil 的 impersonate 顶上 —— 页面必须标注这一点，
 * 否则就是「假装演示的是真实链路」。
 */

const REPO = path.resolve(process.cwd(), "../../..");
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const BACKEND = path.join(REPO, "src/backend");
const CONTRACT = path.join(REPO, "src/contract");

/** 白名单。没有任意命令执行 —— action 只能取这三个值。 */
const ACTIONS = {
  debate: {
    label: "生成新计划（AI 辩论）",
    cwd: BACKEND,
    // 用 bun 直接跑，与 `bun run debate` 等价，但不依赖 package.json script 名
    cmd: "bun",
    args: ["run", "debate"],
    timeoutMs: 180_000,
  },
  bump: {
    label: "抬高 ETH 价格（+30%）",
    cwd: REPO,
    cmd: "bash",
    args: ["src/contract/script/demo-bump-price.sh", "4800"],
    timeoutMs: 120_000,
  },
  report: {
    label: "把计划送到链上（onReport）",
    cwd: CONTRACT,
    cmd: "bash",
    args: ["script/demo-report.sh"],
    timeoutMs: 120_000,
  },
} as const;

type ActionName = keyof typeof ACTIONS;

function isAction(x: unknown): x is ActionName {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, x);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const action = (body as { action?: unknown })?.action;
  if (!isAction(action)) {
    return NextResponse.json(
      { error: "unknown action", allowed: Object.keys(ACTIONS) },
      { status: 400 },
    );
  }

  const spec = ACTIONS[action];

  // 只在这些 action 需要时注入环境。vault/RPC 一律从当前进程的 env 取，
  // 不接受请求体传入 —— 否则浏览器可以指定「往哪个合约发 onReport」。
  const env: NodeJS.ProcessEnv = { ...process.env };

  // 出块前置：anvil 没有交易就不出块，`block.timestamp` 会停在原地。
  // 而 planId 与 asOf 都取自**链上时间**，所以连点两次 debate 会拿到同一个
  // 时间戳 → 同一个 planId → 撞上「计划文件是证据、绝不覆盖」的锁，报
  // `planId collision`。实测：链上时间比墙钟落后 549 秒时，第二次点击必失败。
  // 先 mine 一块，把这个坑从演示路径上移走。
  if (action === "debate") {
    try {
      await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }),
      });
    } catch {
      // 链没起就让 debate 自己报错，不要在这里吞掉真实原因
    }
  }

  const child = spawn(spec.cmd, [...spec.args], {
    cwd: spec.cwd,
    env,
    shell: false,
  });

  const chunks: string[] = [];
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, spec.timeoutMs);

  const done = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });

  child.stdout?.on("data", (b: Buffer) => chunks.push(b.toString()));
  child.stderr?.on("data", (b: Buffer) => chunks.push(b.toString()));

  const code = await done;
  clearTimeout(timer);

  return NextResponse.json({
    action,
    label: spec.label,
    exitCode: code,
    timedOut,
    output: chunks.join("").slice(-20_000), // 只留尾部，debate 会刷很多行
    caveat:
      action === "report"
        ? "本地用 anvil_impersonateAccount 假扮 CRE forwarder。真实部署里这笔交易由 Chainlink DON 签发。"
        : null,
  });
}
