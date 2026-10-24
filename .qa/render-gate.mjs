/**
 * 渲染层闸门 —— 机械闸门看不到的那一类问题
 *
 * 用 ego-browser 读 document.body.innerText（不是像素、不是截图），检查：
 *   R1 静态壳是否服务端渲染（首屏不白）
 *   R2 关键数字格式（bps 不得超过 1 位小数）
 *   R3 「不一致」不能出现在不该出现的地方
 *   R4 不得裸显示外部钱包余额（数字必须标注归属）
 *
 * 用法：ego-browser nodejs -e "await import('file:///<abs>/render-gate.mjs')"
 */
const URL = process.env.GATE_URL || "http://127.0.0.1:3000/";
let pass = 0, fail = 0, skip = 0;
const failures = [];
const ok   = (id, msg) => { pass++; console.log(`  PASS ${id.padEnd(4)} ${msg}`); };
const bad  = (id, msg) => { fail++; failures.push(`${id}: ${msg}`); console.log(`  FAIL ${id.padEnd(4)} ${msg}`); };
const warn = (id, msg) => { skip++; console.log(`  SKIP ${id.padEnd(4)} ${msg}`); };

const task = await taskSpace("AlphaPlan render gate");
const page = task.page("p1");

// ---------- R1 静态壳（curl 层面） ----------
const res = await fetch(URL);
const html = await res.text();
const shellNeeds = ["AlphaPlan", "可审计的 AI 基金经理"];
const shellMissing = shellNeeds.filter((s) => !html.includes(s));
if (shellMissing.length === 0) {
  ok("R1a", `服务端 HTML 含品牌名（${(html.length/1024).toFixed(1)} KB）`);
} else {
  bad("R1a", `服务端 HTML 缺 ${shellMissing.join(" / ")}`);
}
// R1b 侧栏/导航是否 SSR（决定首屏会不会白一下）
const navProbe = ["总览", "金库与流水", "L2 · 真实链路"];
const navInHtml = navProbe.filter((s) => html.includes(s));
if (navInHtml.length === navProbe.length) {
  ok("R1b", "侧栏/导航/L2 横幅都在服务端 HTML 里（首屏不白）");
} else {
  const missing = navProbe.filter((s) => !html.includes(s));
  bad("R1b", `侧栏/导航未 SSR，首屏只显示骨架：缺 ${missing.join(" / ")}`);
}

// ---------- 渲染后 ----------
await page.goto(URL);
await new Promise((r) => setTimeout(r, 6000));
const text = await page.evaluate(() => document.body.innerText);

// ---------- R2 数字格式：bps 不得超过 1 位小数 ----------
const badBps = [...text.matchAll(/(-?\d+\.\d{2,})\s*bps/g)].map((m) => m[1]);
if (badBps.length === 0) {
  ok("R2", "所有 bps 值最多 1 位小数");
} else {
  bad("R2", `bps 浮点未格式化：${[...new Set(badBps)].join(", ")}`);
}

// ---------- R3 「不一致」出现在哪 ----------
const mismatchLines = text.split("\n")
  .map((l, i) => ({ l: l.trim(), i }))
  .filter(({ l }) => l === "不一致" || l.startsWith("不一致"));
if (mismatchLines.length === 0) {
  ok("R3", "页面上没有「不一致」（哈希自验通过）");
} else {
  bad("R3", `页面出现「不一致」×${mismatchLines.length}（哈希自验失败）`);
}

// ---------- R4 外部钱包余额必须标注归属 ----------
// 注意：这条**依赖钱包连接状态**。未连接时它天然 PASS，属于"依赖当前恰好成立的状态"。
// 所以不能只判 PASS/FAIL，必须同时报告"这条本次是否真的被检验到"。
const ethMatches = [...text.matchAll(/(\d+\.\d+)\s*ETH/g)].map((m) => m[1]);
const walletConnected = /断开钱包|Disconnect|已连接/.test(text);
if (ethMatches.length === 0) {
  if (walletConnected) {
    bad("R4", "钱包已连接但页面无 ETH 余额 —— 需人工确认是否漏渲染");
  } else {
    warn("R4", "钱包未连接，本条未被真正检验（连接后再跑一次才有意义）");
  }
} else {
  // 有 ETH 数字：必须能追溯到某个地址
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /(\d+\.\d+)\s*ETH/.test(l));
  const ctx = lines.slice(Math.max(0, at - 3), at + 3).join(" / ");
  const hasAddr = /0x[0-9a-fA-F]{4,}/.test(ctx);
  if (hasAddr) ok("R4", `ETH 余额有地址归属：${ctx.slice(0, 70)}`);
  else bad("R4", `裸显示 ETH 余额且无地址归属：${ethMatches.join(", ")} ETH｜上下文：${ctx.slice(0, 80)}`);
}

// ---------- R5 连接钱包时必须有网络标识（PM 新裁定 E7a）----------
const netShown = /chainId|84532|Base Sepolia|Base测试网|网络/i.test(text);
if (!walletConnected) {
  warn("R5", "钱包未连接，E7a（网络标识）未被真正检验");
} else if (netShown) {
  ok("R5", "钱包已连接且页面显示网络标识");
} else {
  bad("R5", "钱包已连接但页面无 chainId / 网络名（E7a）");
}

console.log(`\n  汇总  PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
if (fail) { console.log("\n  失败项\n" + failures.map((f) => "  - " + f).join("\n")); process.exitCode = 1; }
