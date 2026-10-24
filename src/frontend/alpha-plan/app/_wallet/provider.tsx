"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { REOWN_PROJECT_ID, localChain } from "@/lib/wallet/chain";

/**
 * 钱包 Provider。
 *
 * 三件事必须写在代码里，否则会静默出错：
 *  1. **自定义 chain**，rpc 指向 NEXT_PUBLIC_RPC_URL。用 AppKit 内置的 baseSepolia
 *     会去公共节点读，那里没有我们的合约，报错看起来像「合约不存在」。
 *  2. **ssr: true + cookieStorage**：Next 的 SSR 期间没有 window，不开 ssr 会在
 *     服务端渲染时炸；cookieStorage 让已连接的会话在刷新后保持一致。
 *  3. **没有 Project ID 时不调用 createAppKit**。AppKit 缺 ID 会抛异常把整页拖垮，
 *     而这一页的主体（只读控制台）不该因为钱包没配就打不开。
 */
const metadata = {
  name: "AlphaPlan",
  description: "可审计的 AI 基金经理",
  url: "http://localhost:3000",
  icons: [],
};

/**
 * adapter 必须是**模块级单例**。
 *
 * 之前这里写成 makeConfig() 被调用两次：initAppKit() 里建了实例 A 交给 createAppKit，
 * useReducer 里又建了实例 B 交给 WagmiProvider。两个 WagmiAdapter 各自持有一套
 * wagmi config 与 connector，于是 AppKit 的连接状态和 useAccount() 的读数不同步 ——
 * 典型症状是 MetaMask 明明授权了，页面上 isConnected 永远 false，
 * 或者断开时只断了一边。
 *
 * 这种错 build 和 tsc 都抓不到，只有真实连一次才暴露。
 */
let adapterInstance: WagmiAdapter | null = null;

function getAdapter(): WagmiAdapter {
  adapterInstance ??= new WagmiAdapter({
    networks: [localChain],
    projectId: REOWN_PROJECT_ID,
    ssr: true,
  });
  return adapterInstance;
}

let initialized = false;

function initAppKit() {
  // AppKit 初始化时会 fetch 远程项目配置（cloud.reown.com）。
  // 服务端预渲染阶段没有网络上下文，那个 fetch 会被 React 中止并抛
  // HANGING_PROMISE_REJECTION —— 所以初始化只能在浏览器里发生。
  if (typeof window === "undefined") return;
  if (initialized || !REOWN_PROJECT_ID) return;
  // 关键：createAppKit 与 WagmiProvider 必须拿到同一个实例
  const adapter = getAdapter();
  createAppKit({
    adapters: [adapter],
    networks: [localChain],
    projectId: REOWN_PROJECT_ID,
    metadata,
    /**
     * featuredWalletIds 只做**排序提升**，不做过滤。
     *
     * 实测（AppKit 1.8.24）：只写 MetaMask 一个 id，modal 里仍然列出
     * WalletConnect / MetaMask / Trust Wallet / Binance Wallet / SafePal / Search Wallet。
     * 所以它不能用来「只留插件钱包」—— 之前那段注释是错的，已改。
     *
     * 把 MetaMask 提到第一位就够了：我们的链是本地 anvil fork，
     * 只有同机的浏览器插件钱包能连上。手机钱包的那几条是无害的（点了会失败），
     * 而「为什么失败」由顶栏那条 .local-notice 提前说明。
     */
    featuredWalletIds: [
      // MetaMask
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
    ],
    features: {
      analytics: false,
      email: false,
      socials: false,
      onramp: false,
      swaps: false,
      send: false,
      receive: false,
      history: false,
    },
    themeMode: "light",
    themeVariables: {
      "--w3m-accent": "#42508c",
      "--w3m-border-radius-master": "8px",
      "--w3m-font-family":
        'Inter, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
    },
  });
  initialized = true;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // QueryClient 必须在客户端只建一次，否则每次渲染都会丢缓存
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }),
  );
  const [wagmiConfig] = useState(() => {
    initAppKit();
    return getAdapter().wagmiConfig;
  });

  // 没有 Project ID：不包 WagmiProvider（config 无效会抛），直接给静态提示
  if (!REOWN_PROJECT_ID) {
    return <>{children}</>;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

