import type { Metadata } from "next";

import { WalletProvider } from "./_wallet/provider";
import { inter, newsreader, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlphaPlan — 可审计的 AI 基金经理",
  description: "每一笔交易，都先有一份能复算的计划。计划文件的原始字节哈希写在链上。",
};

/**
 * 根布局只保留字体变量与全局底色。
 *
 * 这里**没有**保真度角标：控制台把它放在侧栏底部（常驻、且不占视口高度）。
 * 之前这里挂过一条 sticky 的 42px 横幅，和侧栏底部那句重复了，
 * 在 1413×624 的窗口里白占掉 7% 的屏幕 —— 删掉。
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${newsreader.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
