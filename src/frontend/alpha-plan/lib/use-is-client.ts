import { useSyncExternalStore } from "react";

/**
 * 「现在是不是在浏览器里」—— 服务端返回 false，客户端返回 true。
 *
 * ## 为什么需要它
 *
 * 钱包状态（是否已连接、地址、余额）**只在客户端存在**。服务端渲染时
 * `useAccount()` 返回 `isConnected: false`，但客户端 hydrate 后立刻变成
 * `true` —— 于是同一个 `<dd>` 服务端渲染「—」、客户端渲染「读取失败」，
 * React 报 hydration mismatch 并把整棵树重建。
 *
 * ## 为什么不用 useEffect + setMounted
 *
 * 那会在 effect 里同步 setState，触发 cascading render
 * （`react-hooks/set-state-in-effect` 直接报错）。而这件事本质上是
 * 「读一个只在客户端为真的外部事实」—— 正是 useSyncExternalStore 的用途。
 *
 * ## 用法
 *
 * ```tsx
 * const isClient = useIsClient();
 * // 服务端与 hydration 期间一律走这个分支，两边必须渲染出**完全相同**的东西
 * if (!isClient) return <span>连接钱包后可见</span>;
 * ```
 *
 * 关键是**服务端与 hydration 期必须走同一条分支**。
 *
 * 这个 hook 不生产任何信息，它只做一件事：把「服务端」和「客户端首次渲染」
 * 拉到同一个答案上。之后客户端再渲染第二遍（getSnapshot 返回 true），
 * 差异才允许出现 —— 那里不一致是正常的，不构成 mismatch。
 *
 * 反过来说：如果两边本来渲染的东西就一样，那就不需要这个 hook；
 * 之所以需要，正是因为客户端知道得更多（钱包连没连），而这份「更多」
 * 在服务端不存在，必须先压平成「未知」才能一起出门。
 */
/**
 * 注意这三个都必须是**模块级常量**。
 *
 * useSyncExternalStore 会在每次渲染后比对 subscribe 的引用：
 * 如果它是内联箭头函数（或每次调用返回新的 unsubscribe），React 会认为
 * 订阅变了，于是不停地退订再订阅。实测后果不是报错，而是**整个页面
 * 静默失去交互** —— 点了没反应、hash 不变、但控制台一个错都没有。
 * 这比抛异常难查得多。
 */
const noopUnsubscribe = () => {};
const noopSubscribe = () => noopUnsubscribe;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot);
}
