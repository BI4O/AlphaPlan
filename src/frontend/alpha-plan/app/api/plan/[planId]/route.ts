import { NextResponse } from "next/server";

import { isValidPlanId } from "@/lib/plan-id";
import { readPlanFile } from "@/lib/plan-file";

/**
 * `GET /api/plan/<planId>` —— 返回计划文件的**原始字节**。
 *
 * 这是 P1「粘贴 planId」路径的数据源：浏览器拿到字节后在本地算 keccak256。
 *
 * 三条硬要求：
 *   1. 原始字节，application/octet-stream。一旦过一遍 JSON 序列化，键序/空格就变了，
 *      哈希立刻对不上（ACCEPTANCE 陷阱 4）。
 *   2. 读不到必须 404，不能 200 空 body —— 空 body 会被算成 keccak256("")，
 *      然后页面显示「不一致」，那是会误导评委的假阴性。
 *   3. 不做任何缓存：文件可能刚被替换，缓存会让「验的是旧字节」这种错误无声发生。
 *
 * 注意：不写 `export const runtime` / `dynamic` —— cacheComponents 下这些段级配置已移除。
 */
export async function GET(_request: Request, context: RouteContext<"/api/plan/[planId]">) {
  const { planId } = await context.params;

  if (!isValidPlanId(planId)) {
    return NextResponse.json(
      { error: "invalid planId", expect: "YYYY-MM-DDTHH:MM:SSZ" },
      { status: 400 },
    );
  }

  const read = await readPlanFile(planId);
  if (!read.ok) {
    return NextResponse.json({ error: "plan_not_found", planId, reason: read.reason }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(read.plan.bytes), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(read.plan.size),
      "cache-control": "no-store",
      "x-plan-id": planId,
    },
  });
}
