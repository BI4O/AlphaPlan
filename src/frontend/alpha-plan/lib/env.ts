/**
 * 环境变量的唯一读取点。
 *
 * 为什么不把地址写进代码：合约在改（redeem 自动卖 WETH 后要重新部署），
 * 地址会变；块号也必须跟着部署走。写死一个地址，第一次重部署就会让整页指向空气。
 *
 * 变量名与仓库根 .env 的约定保持一致（backend 用的是 RPC_URL / BASE_SEPOLIA_RPC_URL）。
 */

const DEFAULT_RPC = "https://sepolia.base.org";

export function rpcUrl(): string {
  return process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_RPC;
}

export function vaultAddress(): `0x${string}` | null {
  const raw = process.env.VAULT_ADDRESS ?? process.env.BASE_SEPOLIA_VAULT_ADDRESS;
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : null;
}

/** 部署块号。缺了会让 getLogs 从创世块扫 —— 公共 RPC 一定拒，所以宁可为空。 */
export function deployBlock(): bigint | null {
  const raw = process.env.DEPLOY_BLOCK;
  if (!raw) return null;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function expectedChainId(): number {
  const raw = process.env.CHAIN_ID;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 84532;
}

/** 浏览器端读链用的端点（NEXT_PUBLIC_ 会被构建期内联）。 */
export function publicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || rpcUrl();
}
