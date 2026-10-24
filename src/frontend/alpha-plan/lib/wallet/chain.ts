import { defineChain } from "viem";

/**
 * 本地 anvil fork 的链定义。
 *
 * 为什么必须自定义而不是用 AppKit 内置的 baseSepolia：
 * 内置配置的 rpcUrls 指向公共节点（sepolia.base.org），那里**没有我们的合约**
 * （公共 Base Sepolia 上该地址的代码是 0x）。用了内置配置，钱包会去公共节点
 * 读一个空地址，所有调用都会失败，而错误看起来像「合约不存在」。
 *
 * ⚠️ 已知限制（必须写进 UI，这是技术事实不是缺陷）：
 * Reown 走云端中继，手机钱包扫码后无法访问本机 127.0.0.1:8455。
 * 只有**浏览器插件钱包（MetaMask）**能连，因为它在同一台机器上。
 */
/**
 * 本地链 RPC。**必须**来自 env，不写死端口。
 *
 * 这台机器上的 anvil 端口换过一次（8545 → 8546），写死的默认值会在
 * env 缺失时静默连到一个已经废弃的端口 —— 页面照常打开，但所有数字
 * 变成「—」，而且错误信息看起来像「链没起」。比直接报错更难查。
 *
 * 所以缺 env 时不留一个「看起来能用」的默认值，宁可指向一个空串，
 * 让 isLocalRpc() 与失败信息把问题暴露出来。
 */
export const LOCAL_RPC = process.env.NEXT_PUBLIC_RPC_URL?.trim() ?? "";

export const localChain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532),
  name: "Base Sepolia (local fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [LOCAL_RPC],
    },
  },
  // 不配 blockExplorers：本地链没有区块浏览器。
  // 之前配了一个指向本地 RPC 的 url，若任何地方把它渲染成链接，
  // 用户点进去看到的是 JSON-RPC 的原始响应 —— 那不是「暂无」，是坏掉的东西。
  // 不配的话 wagmi 的 useBlockExplorer 会返回 undefined，UI 自然不渲染链接。
  testnet: true,
});

/** 这个 RPC 是不是本机地址 —— UI 用它决定要不要提示「手机扫码连不上」。 */
export function isLocalRpc(url: string = LOCAL_RPC): boolean {
  return /127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]/.test(url);
}

export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
