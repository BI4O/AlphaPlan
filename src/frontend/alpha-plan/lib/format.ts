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
