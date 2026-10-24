import localFont from "next/font/local";

/**
 * 自托管字体，源文件在 `design/fonts/`（设计系统快照，别复制第二份）。
 * 只覆盖拉丁子集（原文件的 unicode-range 就是 U+0000-00FF），
 * 中文按 DESIGN.md 回落到 PingFang SC / Noto Sans SC —— 见 design-system/tokens.css。
 *
 * 用 next/font/local 而不是 @font-face 手写：它自带 preload + 尺寸调整，
 * 避免首屏字体跳动（CLS）。
 */

export const inter = localFont({
  src: "../design/fonts/inter-400-700.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

export const newsreader = localFont({
  src: "../design/fonts/newsreader-400-700.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-newsreader",
});

export const plexMono = localFont({
  src: [
    { path: "../design/fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../design/fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
});
