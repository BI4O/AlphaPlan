import { NextResponse } from "next/server";

import { deployBlock, expectedChainId, rpcUrl, vaultAddress } from "@/lib/env";

/**
 * `GET /api/demo` —— 演示面板的**只读**状态：现在环境里有什么、还差什么。
 *
 * 存在的理由只有一个：**让按钮自己说出「已就绪」，而不是让人猜**。
 *
 * 演示时最尴尬的两种情形都可以靠它避免：
 *   1. 点了①「生成计划」才发现其实已经有一份现成可用的（白等 82 秒）
 *   2. 点了②「送到链上」才发现计划已经过期（合约会拒，当场难看）
 *
 * 所以这里回答三个问题：
 *   · 有没有一份「现在就送得上链」的计划？（未执行 + 未过期 + degraded=false）
 *   · 它多旧了？还剩多少秒有效期？
 *   · 链在这头吗（chainId / vault 有代码 / nonce 多少）？
 *
 * 全部字段要么来自链、要么来自计划文件的原始字节，没有推断值。
 * 读不到就返回 `ok: false` 加原因 —— 不编造一个「大概就绪」。
 */

const PLAN_SERVER = process.env.PLAN_SERVER ?? "http://127.0.0.1:8788";

type ReadyPlan = {
  planId: string;
  bytes: number;
  keccak256: string;
  targetWethBps: number;
  asOf: number;
  validUntil: number;
  /** 还能送的时间。<= 0 表示已过期，② 点了也会被合约拒。 */
  secondsLeft: number;
  /** 链上是否已经执行过这份（执行过就不能再送，会 revert PlanAlreadyExecuted）。 */
  alreadyOnchain: boolean;
};

type DemoState = {
  ok: boolean;
  /** 为什么不可用 —— 读不到时唯一能说的真话。 */
  reason?: string;
  chain: {
    chainId: number | null;
    expectedChainId: number;
    vault: `0x${string}` | null;
    vaultHasCode: boolean;
    lastNonce: number | null;
    deployBlock: number | null;
  };
  /** 现在点②就能成功的那一份；null 表示没有。 */
  ready: ReadyPlan | null;
  /** 有多少份计划文件存在（历史证据，不代表可用）。 */
  totalPlans: number | null;
};

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "rpc error");
  return json.result;
}

export async function GET() {
  const vault = vaultAddress();
  const chain: DemoState["chain"] = {
    chainId: null,
    expectedChainId: expectedChainId(),
    vault,
    vaultHasCode: false,
    lastNonce: null,
    deployBlock: deployBlock() === null ? null : Number(deployBlock()),
  };

  try {
    const id = await rpc("eth_chainId", []);
    chain.chainId = Number(id as string);

    if (vault) {
      const code = await rpc("eth_getCode", [vault, "latest"]);
      chain.vaultHasCode = typeof code === "string" && code !== "0x" && code.length > 2;

      if (chain.vaultHasCode) {
        // lastPlan() 返回 (hash, targetBps, nonce) —— 只取 nonce，够判断能不能再送。
        const raw = (await rpc("eth_call", [
          { to: vault, data: LAST_PLAN_SELECTOR },
          "latest",
        ])) as string;
        // 第 3 个 32 字节字是 nonce
        if (raw && raw.length >= 2 + 64 * 3) {
          chain.lastNonce = Number(BigInt(`0x${raw.slice(2 + 64 * 2, 2 + 64 * 3)}`));
        }
      }
    }
  } catch (err) {
    return NextResponse.json<DemoState>(
      {
        ok: false,
        reason: `链读不到：${err instanceof Error ? err.message : String(err)}`,
        chain,
        ready: null,
        totalPlans: null,
      },
      { status: 200 },
    );
  }

  // 计划文件：从后端 /plans.json 取。后端没起不是错误 —— 面板照样要显示链的状态，
  // 只是没有「就绪」判断，按钮会提示先起后端。
  try {
    const res = await fetch(`${PLAN_SERVER}/plans.json`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json<DemoState>({
        ok: false,
        reason: `计划文件服务返回 ${res.status}（${PLAN_SERVER}）`,
        chain,
        ready: null,
        totalPlans: null,
      });
    }
    const data = (await res.json()) as {
      chainNow?: number;
      plans?: Array<{
        planId: string;
        bytes: number;
        keccak256: string;
        targetWethBps: number;
        asOf: number;
        validUntil: number;
        degraded: boolean;
        selectable: boolean;
        rejectedBecause: string[];
        onchainMatch: boolean;
      }>;
    };

    const plans = data.plans ?? [];
    const chainNow = data.chainNow ?? null;

    // 「就绪」= 后端认为可选中（未执行 + 未过期 + degraded=false），
    // 或者虽然已上链但我们仍然想显示它的新鲜度 —— 这里只取可送的那份。
    const candidate = plans.find((p) => p.selectable && !p.onchainMatch) ?? null;

    let ready: ReadyPlan | null = null;
    if (candidate && chainNow !== null) {
      ready = {
        planId: candidate.planId,
        bytes: candidate.bytes,
        keccak256: candidate.keccak256,
        targetWethBps: candidate.targetWethBps,
        asOf: candidate.asOf,
        validUntil: candidate.validUntil,
        secondsLeft: candidate.validUntil - chainNow,
        alreadyOnchain: candidate.onchainMatch,
      };
    }

    return NextResponse.json<DemoState>({
      ok: true,
      chain,
      ready,
      totalPlans: plans.length,
    });
  } catch (err) {
    return NextResponse.json<DemoState>({
      ok: false,
      reason: `计划文件服务读不到（${PLAN_SERVER}）：${err instanceof Error ? err.message : String(err)}`,
      chain,
      ready: null,
      totalPlans: null,
    });
  }
}

/**
 * `lastPlan()` 的选择器：keccak256("lastPlan()")[:4] = 0x7599b82c。
 *
 * 这里只取 nonce 一个字段，不值得把整个 ABI 拉进来。但**这个常量必须能复算**：
 *
 *   $ cast sig "lastPlan()"
 *   0x7599b82c
 *
 * 第一次写的时候我凭印象填了 9f2f9c0e，链上返回空 —— 猜常量是没有代价的错，
 * 因为链不会报「选择器不存在」，它只会返回 0x。所以写上复算命令。
 */
const LAST_PLAN_SELECTOR = "0x7599b82c";
