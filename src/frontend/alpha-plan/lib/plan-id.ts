/**
 * planId 白名单校验。
 *
 * 后端 schema 只要求 `z.string().min(1)` —— 那对 HTTP 路径不够。
 * 前端要把 planId 拼进文件路径（`<PLANS_DIR>/<planId>.json`），所以这里的正则
 * 同时挡住 `../`、绝对路径和 `.json` 后缀注入。宁可拒掉一个合法的 planId，
 * 也不能读到一个不该读的文件。
 *
 * 形状来自 PRD §7.2 的样例：`2026-10-24T03:00:00Z`。
 */
const PLAN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isValidPlanId(value: string): boolean {
  return value.length <= 32 && PLAN_ID_PATTERN.test(value);
}
