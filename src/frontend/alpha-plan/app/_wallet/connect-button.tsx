"use client";

import { useAppKit, useAppKitAccount, useAppKitNetwork, useDisconnect } from "@reown/appkit/react";
import { AlertTriangle, ChevronDown, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useBalance } from "wagmi";

import { useIsClient } from "@/lib/use-is-client";
import { LOCAL_RPC, REOWN_PROJECT_ID, isLocalRpc, localChain } from "@/lib/wallet/chain";

function shortAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * 顶栏的钱包入口。
 *
 * 三态：未配置 / 未连接 / 已连接。
 * 「未配置」是真实状态（没有 Project ID），不是错误 —— 页面只读部分照常可用。
 *
 * ## 为什么外面要套一层 mounted 守卫
 *
 * AppKit 的 hook 在未初始化时**直接 throw**：
 *
 *   useAppKit() → if (!modal) throw new Error('Please call "createAppKit"…')
 *
 * 而 createAppKit 只能在浏览器里调（它要 fetch 远程项目配置，服务端渲染阶段那个
 * fetch 会被 React 中止）。于是服务端渲染这个按钮时 modal 一定不存在 —— 一渲染就抛。
 *
 * 实测（2026-10-24，next start 的 stderr）：
 *
 *   ⨯ Error: Please call "createAppKit" before using "useAppKit" hook
 *       at V (.next/server/chunks/ssr/app__console_console_tsx_…js:1:11626)
 *       digest: '2842032614'
 *
 * 后果不是「按钮渲染不出来」这么局部：这个 throw 冒泡到最近的 Suspense 边界，
 * 而整页只有**一个** Suspense 边界（见 app/page.tsx 的注释），于是整页停在骨架屏
 * 「正在读取链上状态…」。用户看到的正是「我页面右上角都没有看到钱包连接」。
 *
 * 修法不是 try/catch（hook 抛在 render 阶段，抓不住），而是**让这些 hook 根本不在
 * 服务端运行**：占位组件首帧返回一个纯静态 span，服务端与客户端首帧 DOM 完全一致
 * （不会有 hydration mismatch），挂载后第二帧才渲染真正调用 AppKit hook 的子组件。
 *
 * ⚠️ 不能把 `if (!mounted) return` 写进 ConnectButtonInner —— 那会让两次渲染的
 * hook 数量不同，React 报 "Rendered more hooks than during the previous render"。
 * 必须拆成两个组件。
 */
export function ConnectButton() {
  if (!REOWN_PROJECT_ID) {
    return (
      <span className="wallet-reason" title="缺少 NEXT_PUBLIC_REOWN_PROJECT_ID，申赎不可用">
        <AlertTriangle size={14} strokeWidth={1.6} />
        钱包未配置
      </span>
    );
  }
  return <ConnectButtonGate />;
}

/**
 * 「是不是已经跑到浏览器里了」。
 *
 * 为什么不用 useEffect + setMounted：那会在 effect 里同步 setState，
 * 触发 cascading render（react-hooks/set-state-in-effect 直接报错）。
 * 而这件事本质上是「读一个只在客户端为真的外部事实」——
 * 正是 useSyncExternalStore 的用途：服务端快照返回 false，客户端返回 true。
 *
 * 占位与 .btn-connect 同尺寸，避免挂载那一刻顶栏跳动。
 */
function ConnectButtonGate() {
  const mounted = useIsClient();
  if (!mounted) {
    return (
      <span
        className="btn-connect"
        aria-hidden="true"
        style={{ opacity: 0.55, cursor: "default", pointerEvents: "none" }}
      >
        <Wallet size={15} strokeWidth={1.6} />
        连接钱包
      </span>
    );
  }
  return <ConnectButtonInner />;
}

function ConnectButtonInner() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { disconnect } = useDisconnect();
  const { chainId, switchNetwork } = useAppKitNetwork();
  const [panelOpen, setPanelOpen] = useState(false);

  const { data: balance } = useBalance({
    address: address as `0x${string}` | undefined,
    chainId: localChain.id,
    query: { enabled: Boolean(address) },
  });

  /**
   * 验收用的调试日志（工单硬性要求，不许删）。
   *
   * 第 2 步判据是「console 里 isConnected === true、address 正确」。
   * 没有这行就只能看 UI 猜 —— 而 adapter 单例出错时 UI 仍会显示已连接
   * （AppKit 自己的 store 与 wagmi 的 store 是两套），照着 UI 验收会把 bug 放过去。
   *
   * 唯一的 console.log，只输地址与连接态，不含余额/签名/私钥。
   */
  useEffect(() => {
    console.log("[wallet]", { address, isConnected });
  }, [address, isConnected]);

  const wrongChain = isConnected && chainId !== localChain.id;
  const balText = balance
    ? `${Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} ${balance.symbol}`
    : null;

  if (!isConnected) {
    return (
      <div className="wallet-connect-wrap">
        <button
          className="btn-connect"
          type="button"
          onClick={() => void open()}
        >
          <Wallet size={15} strokeWidth={1.6} />
          连接钱包
        </button>
        {/*
          本地链提示挂在**未连接**状态，而不是藏在连接弹窗里。

          理由：这句话决定了用户接下来做什么。等他点开弹窗、选出钱包、
          在手机上扫完码才看到「手机连不上」，那时他已经失败一次了。
          放在按钮下面，是唯一能让他「先知道再决定」的位置。

          只在 RPC 是 localhost 时出现（LocalChainNotice 自己判断）。
        */}
        <LocalChainNotice />
      </div>
    );
  }

  /**
   * 网络不匹配时，整块 chip 变成警告态，并且**必须**给出「切换」。
   *
   * 之前这里只有一个 7px 圆点从绿变黄 —— 那等于什么都没说。
   * 评委看到的是一串地址加一个 6 ETH 的数字，然后问「这是谁的钱」。
   * 正确的做法是把「网络不对」变成一行可读的字，外加一个能动手的按钮。
   */
  if (wrongChain) {
    return (
      <div className="wallet-wrong">
        <span className="wallet-wrong__msg">
          <AlertTriangle size={14} strokeWidth={1.8} />
          网络不匹配 · 需 chain {localChain.id}
        </span>
        <button
          className="wallet-wrong__switch"
          type="button"
          onClick={() => {
            void switchNetwork(localChain);
          }}
        >
          切换
        </button>
        <button
          className="wallet-chip__x"
          type="button"
          onClick={() => disconnect()}
          aria-label="断开钱包"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-wrap">
      <div className="wallet-chip">
        <button
          className="wallet-chip__main"
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          title={address}
        >
          <span className="wallet-chip__dot" data-tone="ok" aria-hidden="true" />
          <span className="mono">{shortAddr(address)}</span>
          {/*
            余额必须标明归属。评委看到「6 ETH」会以为这是本基金的资产 ——
            那是钱包自己的测试币，和基金无关。title 里写清楚，hover 即可读到。
          */}
          <span
            className="wallet-chip__bal mono"
            title={`这是钱包 ${address} 的余额，不是本基金资产`}
          >
            {balText ?? "—"}
          </span>
          {/* 网络名常驻，不依赖 hover —— 否则等于没显示 */}
          <span className="wallet-chip__net">{localChain.name}</span>
          <ChevronDown size={13} strokeWidth={1.6} />
        </button>
        <button
          className="wallet-chip__x"
          type="button"
          onClick={() => disconnect()}
          aria-label="断开钱包"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>

      {panelOpen ? (
        <WalletPanel
          address={address}
          chainId={chainId}
          balance={balText}
          onClose={() => setPanelOpen(false)}
          onDisconnect={() => {
            setPanelOpen(false);
            disconnect();
          }}
        />
      ) : null}
    </div>
  );
}

function WalletPanel({
  address,
  chainId,
  balance,
  onClose,
  onDisconnect,
}: {
  address?: string;
  chainId?: number | string;
  balance: string | null;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  return (
    <>
      <button className="scrim scrim--ghost" type="button" aria-label="关闭" onClick={onClose} />
      <div className="wallet-panel" role="dialog" aria-label="钱包详情">
        <div className="wallet-panel__head">
          <span>钱包</span>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭">
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
        <dl className="wallet-panel__kv">
          <div>
            <dt>地址</dt>
            <dd className="mono wallet-panel__addr">{address}</dd>
          </div>
          <div>
            <dt>网络</dt>
            <dd>
              {localChain.name} · chain {chainId ?? "—"}
            </dd>
          </div>
          <div>
            <dt>RPC</dt>
            <dd className="mono">{LOCAL_RPC}</dd>
          </div>
          <div>
            <dt>ETH 余额</dt>
            <dd className="mono">{balance ?? "—"}</dd>
          </div>
        </dl>
        <p className="wallet-panel__note">
          ETH 余额属于这个钱包，<strong>不是本基金资产</strong>。基金资产见「金库与流水」。
        </p>
        <button className="btn-ghost wallet-panel__disconnect" type="button" onClick={onDisconnect}>
          断开连接
        </button>
      </div>
    </>
  );
}

/**
 * 本地链提示。只在 RPC 是 localhost 时出现。
 *
 * Reown 走云端中继：手机扫码后由手机上的钱包去访问 RPC，而 127.0.0.1 在手机上
 * 指手机自己 —— 所以手机一定失败。插件钱包在同一台机器上，所以能连。
 * 不写这句，用户会以为是我们程序坏了。
 */
export function LocalChainNotice() {
  if (!isLocalRpc()) return null;
  return (
    <p className="local-notice">
      <AlertTriangle size={14} strokeWidth={1.6} />
      请用<strong>浏览器插件钱包（MetaMask）</strong>。手机扫码的钱包无法访问本机{" "}
      <code>{LOCAL_RPC}</code> 的本地链。
    </p>
  );
}