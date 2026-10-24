"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * 交易成功后刷新服务端数据。
 *
 * 为什么要 refresh 而不是本地改数字：五格数字与流水都来自服务端的一次快照
 * （同一块号）。本地打补丁会让「NAV 是旧块、份额是新区块」这种错配出现，
 * router.refresh() 让服务端用新块号重新读一遍，整页仍然同源。
 */
export function RefreshOnDone({ children }: { children: (refresh: () => void) => React.ReactNode }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return <>{children(refresh)}</>;
}
