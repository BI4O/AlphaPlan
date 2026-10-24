"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { keccak256 } from "viem";

import { shortHex } from "@/lib/format";
import { readLastPlanHashInBrowser, type BrowserChainRead } from "@/lib/chain-browser";

import { Icon } from "../icons";
import type { ConsoleData } from "../types";

type Verdict =
  | { kind: "idle" }
  | { kind: "hashing" }
  | { kind: "match"; hash: `0x${string}`; label: string; size: number }
  | { kind: "mismatch"; hash: `0x${string}`; chain: `0x${string}`; label: string; size: number }
  | { kind: "unknown"; reason: string; hash: `0x${string}` | null; label: string; size: number | null }
  | { kind: "failed"; reason: string };

/**
 * 屏 4 · 哈希自验。
 *
 * 两条铁律：
 *  1. 哈希算的是**原始字节**（arrayBuffer → Uint8Array），绝不 file.text() 再编码。
 *  2. 链上值由**浏览器自己**向 RPC 读，不回落服务端值 —— 代理可以撒谎，代理一撒谎
 *     这一屏唯一的卖点就没了。读不到就明说读不到。
 */
export function VerifyScreen({ data }: { data: ConsoleData }) {
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const [chain, setChain] = useState<BrowserChainRead | null>(null);
  const [dragging, setDragging] = useState(false);
  const [planId, setPlanId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const vault = data.vault.ok ? data.vault.value.vault : null;

  useEffect(() => {
    if (!vault) return;
    let alive = true;
    void readLastPlanHashInBrowser(vault).then((r) => {
      if (alive) setChain(r);
    });
    return () => {
      alive = false;
    };
  }, [vault]);

  const compare = useCallback(
    (bytes: Uint8Array, label: string) => {
      const fileHash = keccak256(bytes);
      if (!vault) {
        setVerdict({
          kind: "unknown",
          reason: "没有配置金库地址（VAULT_ADDRESS），只能算文件哈希，无法比对",
          hash: fileHash,
          label,
          size: bytes.length,
        });
        return;
      }
      if (chain === null) {
        setVerdict({
          kind: "unknown",
          reason: "还在向 RPC 读链上哈希，稍等",
          hash: fileHash,
          label,
          size: bytes.length,
        });
        return;
      }
      if (chain.status !== "read") {
        setVerdict({
          kind: "unknown",
          reason: chain.reason,
          hash: fileHash,
          label,
          size: bytes.length,
        });
        return;
      }
      setVerdict(
        fileHash === chain.planHash
          ? { kind: "match", hash: fileHash, label, size: bytes.length }
          : {
              kind: "mismatch",
              hash: fileHash,
              chain: chain.planHash,
              label,
              size: bytes.length,
            },
      );
    },
    [chain, vault],
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setVerdict({ kind: "hashing" });
      const buf = await file.arrayBuffer();
      compare(new Uint8Array(buf), file.name);
    },
    [compare],
  );

  const onPlanId = useCallback(async () => {
    const id = planId.trim();
    if (!id) return;
    setVerdict({ kind: "hashing" });
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const body = await res.text();
        setVerdict({
          kind: "failed",
          reason: `HTTP ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`,
        });
        return;
      }
      const buf = await res.arrayBuffer();
      compare(new Uint8Array(buf), `plans/${id}.json`);
    } catch (e) {
      setVerdict({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }, [compare, planId]);

  return (
    <>
      <div className="screen-head">
        <div className="screen-head__main">
          <p className="eyebrow-icons">
            <span className="eyebrow">哈希自验</span>
            <span className="screen-head__rule" aria-hidden="true" />
            <Icon name="db" size={14} className="eyebrow-icons__icon" />
            <span>浏览器直读 RPC</span>
            <Icon name="fingerprint" size={14} className="eyebrow-icons__icon" />
            <span>本地 keccak256</span>
          </p>
          <h1 className="screen-title" id="vf-title">
            拿文件自己算一遍
          </h1>
          <p className="lede">文件由服务器交付，哈希由你的浏览器计算。</p>
        </div>
      </div>

      <div className="verify-grid">
        <div className="verify-left">
          <section className="panel">
            <div className="field">
              <label className="field__label" htmlFor="plan-id">
                或者粘贴 planId（从本仓库 plans/ 读原始字节）
              </label>
              <p className="field__help">
                <Icon name="info" size={13} /> 哈希在你的浏览器里算
              </p>
              <div className="od-row">
                <input
                  id="plan-id"
                  className="input mono"
                  placeholder="2026-10-24T04:45:35Z"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onPlanId();
                  }}
                />
                <button className="btn-primary" type="button" onClick={() => void onPlanId()}>
                  计算
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div
              className="dropzone"
              data-active={dragging ? "true" : "false"}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void onFiles(e.dataTransfer.files);
              }}
            >
              <p className="dropzone__label">把 plans/&lt;planId&gt;.json 拖进来</p>
              <p className="dropzone__hint">
                或点击选择 · 原始字节，不解析、不重排
              </p>
              <div className="dropzone__actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => void onFiles(e.target.files)}
                />
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                >
                  选择计划文件
                </button>
                {data.plan.planId ? (
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => {
                      setPlanId(data.plan.planId as string);
                    }}
                  >
                    填入最新 planId
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="panel panel--linen">
            <h2 className="panel-title">为什么这样能证明</h2>
            <ol className="steps">
              <li>
                <Icon name="file" size={16} />
                <span>原始字节，不重新序列化</span>
              </li>
              <li>
                <Icon name="hash" size={16} />
                <span>keccak256（Ethereum 变体，非 SHA3-256）</span>
              </li>
              <li>
                <Icon name="verify" size={16} />
                <span>与链上 PlanExecuted 逐位比对</span>
              </li>
            </ol>
          </section>
        </div>

        <div className="verify-right">
          {/*
            两份计划必须分开显示。
            之前把它们合成一格 → 显示「不一致 · 0x2b91f9…ae3a · 2503 B」：
            哈希来自链上那份（2420B），大小来自另一份（2503B）。
            「不一致」看起来像数据被篡改，实际只是「你拖的是还没上链的那份」。
          */}
          <PlanPair data={data} />

          <div className="hashrow">
            <div className="hashrow__top">
              <span className="hashrow__label">链上哈希 · 由你的浏览器读取</span>
            </div>
            <p className="hashrow__val mono">
              {!vault ? (
                <span className="muted">⚠️ 没有配置金库地址，无法读链上值</span>
              ) : chain === null ? (
                <span className="muted">正在向 RPC 读…</span>
              ) : chain.status === "read" ? (
                chain.planHash
              ) : (
                <span className="muted">{chain.reason}</span>
              )}
            </p>
          </div>

          <div className="hashrow">
            <div className="hashrow__top">
              <span className="hashrow__label">本地计算 · keccak256</span>
            </div>
            <p className="hashrow__val mono">
              {verdict.kind === "idle" ? (
                <span className="muted">— 尚未计算</span>
              ) : verdict.kind === "hashing" ? (
                <span className="muted">计算中…</span>
              ) : verdict.kind === "failed" ? (
                <span className="muted">{verdict.reason}</span>
              ) : verdict.hash === null ? (
                <span className="muted">—</span>
              ) : (
                verdict.hash
              )}
            </p>
          </div>

          <div className="verdict" data-testid="verify-result" data-kind={verdict.kind}>
            <p className="verdict__state">
              {verdict.kind === "idle"
                ? "未校验"
                : verdict.kind === "hashing"
                  ? "计算中"
                  : verdict.kind === "match"
                    ? "一致"
                    : verdict.kind === "mismatch"
                      ? "不一致"
                      : "未能计算"}
            </p>
            <p className="verdict__msg">
              {verdict.kind === "idle" ? (
                "拖入文件后，这里显示两边是不是同一个值。"
              ) : verdict.kind === "hashing" ? (
                "正在本地计算 keccak256。"
              ) : verdict.kind === "match" ? (
                <>
                  文件 <span className="num">{verdict.label}</span> 的 {verdict.size} 字节，
                  与链上记录逐位相同。这个决定没有被事后改动。
                </>
              ) : verdict.kind === "mismatch" ? (
                /*
                  区分两种「不一致」。这个区别很重要：
                  · 本地有这份文件、但链上执行的是另一份 → 「该文件尚未上链」，不是篡改
                  · 本地找不到任何匹配文件 → 才是真的「不是链上那份」
                  之前一律显示「不一致」，让人以为文件被改过。
                */
                isLocalKnownPlan(data, verdict.hash) ? (
                  (() => {
                    /*
                      两种「本地有、但不是链上那份」，措辞必须不同：
                        · planId 比链上那份更早 → 它**曾经**可能是链上那份，已被后续覆盖
                        · planId 比链上那份更晚 → 还没轮到它上链
                      都说成「尚未上链」是错的：更早那份不会「将」上链，它已经过去了。
                    */
                    const mine = data.allPlanHashes.find((p) => p.hash === verdict.hash);
                    const on = data.planOnchain.planId;
                    const older = mine && on ? mine.planId < on : false;
                    return (
                      <>
                        文件 <span className="num">{verdict.label}</span>（{verdict.size} B）与链上记录不同，
                        但它是本仓库 <span className="num">plans/</span> 里真实存在的一份 ——{" "}
                        <strong>{older ? "不是当前链上那份（已被后续计划覆盖）" : "该文件尚未上链"}</strong>
                        ，不是被篡改。
                        链上执行的是{on ? ` ${on}` : "另一份"}。
                      </>
                    );
                  })()
                ) : (
                  <>
                    文件 <span className="num">{verdict.label}</span>（{verdict.size} B）算出的{" "}
                    <span className="num">{shortHex(verdict.hash, 10, 6)}</span>，链上记录是{" "}
                    <span className="num">{shortHex(verdict.chain, 10, 6)}</span>。
                    这份文件不在本仓库 plans/ 里，也不是链上执行的那份。
                  </>
                )
              ) : verdict.kind === "unknown" ? (
                <>
                  能算出文件哈希，但链上值取不到：{verdict.reason}
                </>
              ) : (
                <>无法完成校验：{verdict.reason}</>
              )}
            </p>
            <p className="verdict__meta">
              <Icon name="db" size={13} />
              <span className="mono-meta">{chain?.status === "read" ? chain.rpcUrl : "RPC"}</span>
              <Icon name="info" size={13} />
              <span>不回落服务端值</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}


/**
 * 「链上执行的那份」与「本地最新的那份」。
 *
 * 两者相同 → 合成一行，标「一致」。
 * 两者不同 → 并列两行，各自带自己的 planId / 大小 / 哈希，绝不交叉引用字段。
 */
function PlanPair({ data }: { data: ConsoleData }) {
  const on = data.planOnchain;
  const local = data.planLocal;
  const same =
    on.planId !== null && local.planId !== null && on.planId === local.planId;

  if (same) {
    return (
      <section className="planpair planpair--one">
        <div className="planpair__head">
          <Icon name="check" size={14} strokeWidth={1.8} />
          <span>链上执行的就是本地最新这份</span>
        </div>
        <PlanRow
          label="planId"
          value={on.planId ?? "—"}
          mono
        />
        <PlanRow label="大小" value={on.size === null ? "—" : `${on.size} B`} mono />
        <PlanRow label="keccak" value={on.hash ?? "—"} mono small />
      </section>
    );
  }

  return (
    <section className="planpair">
      <div className="planpair__col" data-side="onchain">
        <p className="planpair__title">
          <Icon name="block" size={13} />
          链上最后执行的计划
        </p>
        <p className="planpair__state" data-tone={on.present ? "ok" : "warn"}>
          {on.present ? "✓ 文件在本地，逐位一致" : (on.reason ?? "本地无对应文件")}
        </p>
        <PlanRow label="planId" value={on.planId ?? "—"} mono />
        <PlanRow label="大小" value={on.size === null ? "—" : `${on.size} B`} mono />
        <PlanRow label="keccak" value={on.hash ?? "—"} mono small />
        <p className="planpair__src">来源 · vault.lastPlanHash → 反查 plans/</p>
      </div>

      <div className="planpair__col" data-side="local">
        <p className="planpair__title">
          <Icon name="file" size={13} />
          本地最新的计划
        </p>
        <p className="planpair__state" data-tone={local.matchesOnchain ? "ok" : "warn"}>
          {local.present
            ? local.matchesOnchain
              ? "✓ 已上链"
              : "⚠ 尚未上链（与 lastPlanHash 不同）"
            : (local.reason ?? "无文件")}
        </p>
        <PlanRow label="planId" value={local.planId ?? "—"} mono />
        <PlanRow label="大小" value={local.size === null ? "—" : `${local.size} B`} mono />
        <PlanRow label="keccak" value={local.hash ?? "—"} mono small />
        <p className="planpair__src">来源 · plans/ 里 planId 最大的一份</p>
      </div>
    </section>
  );
}

function PlanRow({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <p className="planrow">
      <span className="planrow__k">{label}</span>
      <span className={`planrow__v${mono ? " mono" : ""}${small ? " planrow__v--sm" : ""}`}>
        {value}
      </span>
    </p>
  );
}


/**
 * 拖进来的哈希，是不是本仓库 plans/ 里某一份真实的文件？
 *
 * 用来区分「尚未上链」与「根本不是链上那份」——
 * 两者都叫「不一致」，但含义完全不同。
 */
function isLocalKnownPlan(data: ConsoleData, hash: `0x${string}`): boolean {
  return data.allPlanHashes.some((p) => p.hash === hash);
}
