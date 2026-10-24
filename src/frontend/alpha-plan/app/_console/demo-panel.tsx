"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { percentOf } from "@/lib/format";

/**
 * 演示操作面板 —— 把四个命令行动作变成按钮。
 *
 * ## 为什么这些不住在浏览器里
 *
 * 三个动作都要碰「链之外」的东西：DeepSeek 的 API key、anvil 的
 * `impersonateAccount` / `setStorageAt`（debug 方法）。这些都不能进 bundle，
 * 所以浏览器只发 action 名，服务端 spawn 对应脚本。
 *
 * ## 为什么显示原始输出
 *
 * 演示时最容易被问到的是「这是真的吗」。只给一个绿勾什么也证明不了；
 * 把脚本的 stdout 原样摊开，包括失败的、包括 `anvil_impersonateAccount`
 * 这一行，才能让人自己判断。**隐藏过程换来的信任是假的。**
 *
 * ## 每一步都要说清它改了什么
 *
 * 四个步骤里有三个会改链上状态。按钮上不写清楚，点下去就是黑箱。
 */

type ActionKey = "debate" | "report" | "bump";

/** `/api/demo/state` 的形状（只读，不含任何写操作）。 */
type DemoState = {
  ok: boolean;
  reason?: string;
  chain: {
    chainId: number | null;
    expectedChainId: number;
    vault: string | null;
    vaultHasCode: boolean;
    lastNonce: number | null;
    deployBlock: number | null;
  };
  ready: {
    planId: string;
    bytes: number;
    keccak256: string;
    targetWethBps: number;
    asOf: number;
    validUntil: number;
    secondsLeft: number;
    alreadyOnchain: boolean;
  } | null;
  totalPlans: number | null;
};

/** 把「还剩多少秒」说成人话。列表里不放具体时刻 —— 时区会误导。 */
function untilLabel(seconds: number): string {
  if (seconds <= 0) return "已过期";
  if (seconds < 60) return `还剩 ${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  return `还剩 ${m} 分钟`;
}

type Step = {
  key: ActionKey;
  title: string;
  what: string;
  /** 这一步会不会改链上状态 —— true 时按钮用 warn 样式 */
  writes: boolean;
  /** 真实部署里这一步由谁做 */
  production: string;
};

const STEPS: Step[] = [
  {
    key: "debate",
    title: "① 生成计划",
    what: "Bull / Bear / Risk 三个 agent 各给一个目标仓位，Judge 加权裁决。结果写成一个 JSON 文件。",
    writes: false,
    production: "同样由 CRE 的 CRON trigger 定时调用。",
  },
  {
    key: "report",
    title: "② 送到链上",
    what: "把计划文件的 keccak256 通过 onReport 写进金库。合约过三道门禁后按目标仓位调仓。",
    writes: true,
    production:
      "真实部署里这笔交易由 Chainlink DON 的 forwarder 合约签发。本地没有 DON，用 anvil 的 impersonateAccount 假扮 forwarder —— 这一点在输出里会原样打印。",
  },
  {
    key: "bump",
    title: "③ 抬高 ETH 价",
    what: "把 Chainlink oracle 和 Uniswap 池子的价格同时推到 4800（约 +30%）。两处必须一起改，只改一处会让卖方向必然 revert。",
    writes: true,
    production: "真实世界里这一步是市场自己发生的。这里是演示环境，所以手动推。",
  },
];

type Result = {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  caveat: string | null;
};

export function DemoPanel() {
  const router = useRouter();
  // 每一步都可能改链上状态，所以任何一步成功都重新读一遍服务端快照。
  // 不在本地改数字：五个数字必须来自同一块号的同一次读取。
  const onDone = useCallback(() => router.refresh(), [router]);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [results, setResults] = useState<Partial<Record<ActionKey, Result>>>({});
  const [state, setState] = useState<DemoState | null>(null);

  // 只读状态：告诉用户「① 要不要再跑」「② 现在点了会不会被拒」。
  // 演示时最尴尬的两件事都能靠它避开 —— 白等 82 秒、或者点②才发现计划过期。
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/state", { cache: "no-store" });
      setState((await res.json()) as DemoState);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(key: ActionKey) {
    setBusy(key);
    setResults((r) => ({ ...r, [key]: undefined }));
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: key }),
      });
      const json = (await res.json()) as Result;
      setResults((r) => ({ ...r, [key]: json }));
      if (json.exitCode === 0) {
        onDone();
        void reload();
      }
    } catch (err) {
      setResults((r) => ({
        ...r,
        [key]: {
          exitCode: -1,
          timedOut: false,
          output: err instanceof Error ? err.message : String(err),
          caveat: null,
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="demo" aria-labelledby="demo-title">
      <div className="demo__head">
        <h2 className="demo__title" id="demo-title">
          演示操作
        </h2>
        <p className="demo__lede">
          这三步在真实部署里由 CRE 与市场分别驱动。这里做成按钮，是为了让每一步
          都能单独看见、单独复算 —— 不是把流程藏起来。
        </p>
      </div>

      <ol className="demo__steps">
        {STEPS.map((step) => {
          const r = results[step.key];
          const running = busy === step.key;
          const ok = r && r.exitCode === 0;
          const bad = r && r.exitCode !== 0;

          return (
            <li className="demo__step" key={step.key}>
              <div className="demo__step-head">
                <h3 className="demo__step-title">
                  {step.title}
                  {step.writes && (
                    <span className="demo__tag" data-tone="warn" title="这一步会改链上状态">
                      改链上
                    </span>
                  )}
                </h3>
                <button
                  className={step.writes ? "btn-ghost demo__go" : "btn-primary demo__go"}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run(step.key)}
                  aria-describedby={`demo-what-${step.key}`}
                >
                  {running ? "执行中…" : ok ? "再跑一次" : bad ? "重试" : "执行"}
                </button>
              </div>

              <p className="demo__what" id={`demo-what-${step.key}`}>
                {step.what}
              </p>

              {/* ① 的「已经准备好了」提示 —— 避免演示时白等 82 秒 */}
              {step.key === "debate" && state?.ready && (
                <p className="demo__ready" data-tone="ok">
                  <span className="demo__ready-dot" aria-hidden="true" />
                  已有一份可送的计划：<span className="mono">{state.ready.planId}</span>
                  {" · "}
                  ETH 占比 {percentOf(state.ready.targetWethBps)}
                  {" · "}
                  {untilLabel(state.ready.secondsLeft)}
                  。演示时可以直接点 ②，不必等这一轮 82 秒。
                </p>
              )}

              {/* ② 的前置条件 —— 没有就绪计划时先说清楚，别让人点了才失败 */}
              {step.key === "report" && state && (
                <>
                  {state.ready && state.ready.secondsLeft > 0 && (
                    <p className="demo__ready" data-tone="ok">
                      <span className="demo__ready-dot" aria-hidden="true" />
                      可以送：<span className="mono">{state.ready.planId}</span>
                      {" · "}
                      ETH 占比 {percentOf(state.ready.targetWethBps)}
                      {" · "}
                      {untilLabel(state.ready.secondsLeft)}
                    </p>
                  )}
                  {state.ready && state.ready.secondsLeft <= 0 && (
                    <p className="demo__ready" data-tone="bad">
                      <span className="demo__ready-dot" aria-hidden="true" />
                      现有的计划已过期（{state.ready.planId}），送上去合约会拒。先点 ①。
                    </p>
                  )}
                  {!state.ready && state.ok && (
                    <p className="demo__ready" data-tone="bad">
                      <span className="demo__ready-dot" aria-hidden="true" />
                      没有可送的计划。先点 ① 生成一份。
                    </p>
                  )}
                  {!state.ok && (
                    <p className="demo__ready" data-tone="bad">
                      <span className="demo__ready-dot" aria-hidden="true" />
                      状态读不到：{state.reason}
                    </p>
                  )}
                </>
              )}
              <p className="demo__production">
                <span className="demo__production-label">真实部署</span>
                {step.production}
              </p>

              {running && (
                <p className="demo__status" data-tone="pending">
                  正在执行，通常 10–60 秒…
                </p>
              )}

              {r && (
                <>
                  <p className="demo__status" data-tone={ok ? "ok" : "bad"}>
                    {r.timedOut
                      ? "超时被中止"
                      : ok
                        ? "完成（退出码 0）"
                        : `失败（退出码 ${r.exitCode}）`}
                  </p>
                  {r.caveat && <p className="demo__caveat">{r.caveat}</p>}
                  <details className="demo__out" open={!!bad}>
                    <summary>脚本输出（原始，未删改）</summary>
                    <pre>{r.output || "（无输出）"}</pre>
                  </details>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <p className="demo__fine">
        每一步的输出都是脚本原样打印，包括可能失败的部分。
        红字不隐藏 —— 一个只会显示绿勾的演示，证明不了任何东西。
      </p>
    </section>
  );
}
