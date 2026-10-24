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

// ---------- R3 哈希自验结论必须可判定 ----------
// 上一版只判「页面里没有『不一致』」→ 在 lastNonce=0 的空环境里，
// 页面显示「链上哈希未采集」，同样没有「不一致」，于是假绿 PASS。
// 这正是「依赖当前恰好成立的状态」。改成三态：通过 / 失败 / 无法判定。
// 注意：不能用 \b —— 中文不是 ASCII word char，\b一致\b 永远不匹配
const hasMatch    = /哈希自验[\s\S]{0,60}?(^|\n)\s*一致\s*($|\n)/m.test(text) && !/不一致/.test(text);
const hasMismatch = /不一致/.test(text);
const notCollected = /链上哈希未采集|尚未计算|未采集/.test(text);
if (hasMismatch) {
  bad("R3", "哈希自验显示「不一致」");
} else if (hasMatch) {
  ok("R3", "哈希自验通过（显示「一致」且无「不一致」）");
} else if (notCollected) {
  warn("R3", "哈希自验未采集 —— 链上没有 PlanExecuted/Recorded 记录，本条未被真正检验");
} else {
  bad("R3", "哈希自验区既无「一致」也无「未采集」—— 状态不明，需人工看页面");
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

// ---------- R5/E7a: 连接钱包时必须显示网络标识 ----------
const netShown = /chainId|31337|84532|Base Sepolia|Base测试网|网络|localChain|本地/i.test(text);
if (!walletConnected) {
  warn("R5", "钱包未连接，E7a（网络标识）未被真正检验");
} else if (netShown) {
  ok("R5", "钱包已连接且页面显示网络标识（E7a）");
} else {
  bad("R5", "钱包已连接但页面无 chainId / 网络名（E7a）");
}

// ---------- R6/E7b: 钱包连的链到底对不对（探测法）----------
// 注意：当前环境用 `--chain-id 31337` 覆盖了 fork 继承的 84532（PM 决定）。
// E7b-2 仍然必要：用户钱包可能连着别的 31337 网络（如裸 anvil），那上面没有我们的合约。
// 所以不能只看 chainId，必须探 eth_getCode(VAULT)。
// window.ethereum 不暴露 RPC URL，这是唯一可靠的办法。
if (!walletConnected) {
  warn("R6", "钱包未连接，E7b（连错链检测）未被真正检验");
} else {
  const probe = await page.evaluate(async (vault) => {
    const out = { chainId: null, code: null, err: null };
    try {
      out.chainId = await window.ethereum.request({ method: "eth_chainId" });
      out.code = await window.ethereum.request({ method: "eth_getCode", params: [vault, "latest"] });
    } catch (e) { out.err = String(e).slice(0, 160); }
    return out;
  }, process.env.VAULT_ADDRESS || "0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b");

  const EXPECT = process.env.EXPECT_CHAIN_ID_HEX || "0x7a69"; // 31337
  const chainOk = probe.chainId === EXPECT;
  const hasCode  = typeof probe.code === "string" && probe.code !== "0x" && probe.code.length > 2;
  const warns    = /网络不匹配|chainId|连的不是|合约不存在|请检查 RPC|切到|switch/i.test(text);
  if (!chainOk) {
    // E7b-1：chainId 不对，页面必须警告
    if (warns) ok("R6a", `E7b-1 成立：钱包 chainId=${probe.chainId}（≠${EXPECT}），页面已警告`);
    else bad("R6a", `E7b-1 FAIL：钱包 chainId=${probe.chainId}（≠${EXPECT}），页面无警告`);
  } else if (!hasCode) {
    // E7b-2：chainId 对但读不到合约 → 连错 RPC
    if (warns) ok("R6b", "E7b-2 成立：chainId 正确但 eth_getCode(VAULT)=0x，页面已警告连错链");
    else bad("R6b", "E7b-2 FAIL：chainId 正确但 eth_getCode(VAULT)=0x（连到别的同 chainId 网络），页面无警告");
  } else {
    // E7b-3：都正常 → 不应有警告
    if (warns) bad("R6c", "E7b-3 FAIL：链正常但页面常驻显示警告（会变噪音）");
    else ok("R6c", `E7b-3 成立：chainId=${probe.chainId} 且合约有代码（${(probe.code.length-2)/2} B），无警告`);
  }
}

console.log(`\n  汇总  PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
if (fail) { console.log("\n  失败项\n" + failures.map((f) => "  - " + f).join("\n")); process.exitCode = 1; }
