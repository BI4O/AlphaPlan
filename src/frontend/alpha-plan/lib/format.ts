/** 纯格式化工具 —— 服务端与客户端共用，不引入 node 或 viem。 */

/** `0x1234…abcd`：哈希在卡片上只留首尾，完整值放 title。 */
export function shortHex(value: string | null | undefined, head = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** 定点小数：金额/价格只在一处做除法，避免各处四舍五入不一致。 */
export function fixed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** bps → 百分比字符串，整数位补零（3214 → 32.14%）。 */
export function bps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value / 100).toFixed(2)}%`;
}

/** 秒差 → 「12m 34s」这种可读时长；负数按 0 处理。 */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** unix 秒 → ISO 分钟精度（链上时间戳都是秒）。 */
export function isoFromUnix(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * bps → 百分数，给不懂 bps 的人看。
 *
 * 1800 bps → "18.00%"。整数百分比时不留小数位（"18%"），
 * 因为「18.00%」会让不熟悉的人以为有隐藏精度。
 *
 * 为什么不直接除以 100 再 toFixed：1875 bps 是 18.75%，除以 100 得 18.75，
 * 再 toFixed(0) 会变成 19 —— 那是把 18.75% 说成 19%，多报了 0.25 个百分点。
 */
export function percentOf(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

/**
 * 差值的单位是「个百分点」，不是「%」。
 *
 * 40% 降到 35% 是差 5 个百分点，相对变化却是 12.5% —— 差值一律写「个百分点」，
 * 才不会和占比本身混成一种数。
 */
function pointsText(points: number): string {
  return `${points.toLocaleString("en-US", { maximumFractionDigits: 2 })} 个百分点`;
}

/** 距离（无方向）：500 bps → "5 个百分点"。 */
export function pointsOf(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  return pointsText(Math.abs(Math.round(bps) / 100));
}

/**
 * 带方向的差值：500 bps → "+5 个百分点"。
 *
 * 取整之后再判符号 —— AGENTS.md 记过 `delta > 0 ? "+" : ""` 在 0.4 上判真、
 * 四舍五入成 0，于是出现「+0」的坑。
 */
export function signedPoints(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  const points = Math.round(bps) / 100;
  if (points === 0) return pointsText(0);
  return points > 0 ? `+${pointsText(points)}` : pointsText(points);
}

/** 原始整数 bps，作百分比旁边的副值：4000 → "4,000 bps"。 */
export function rawBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  return `${bps.toLocaleString("en-US")} bps`;
}
