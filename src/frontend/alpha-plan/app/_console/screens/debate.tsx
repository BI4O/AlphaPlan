import { Icon } from "../icons";
import type { ConsoleData } from "../types";

const ROLE_LABEL: Record<string, string> = {
  bull: "看多",
  bear: "看空",
  risk: "风控",
};

/**
 * 屏 2 · 辩论与裁决。
 *
 * 叙事核心是那根标尺：把五个仓位画在同一根轴上，「judge 不取平均」就变成一个可量的距离
 * （裁决点与均值点之间的括号），而不是一句形容词。所以标尺不是装饰，它是这一屏的论据，
 * 位置必须在三个 agent 与 judge 之下、独占一整行。
 *
 * 数字全部来自计划文件；一个 agent 没给数就显示「—」，不让它装作 0（0 = 空仓，是真实主张）。
 */
export function DebateScreen({ data }: { data: ConsoleData }) {
  if (!data.debate.ok) {
    return (
      <>
        <ScreenHead
          eyebrow="辩论 → 裁决"
          meta="无计划文件"
          title="三个意见，一个不取平均的裁决"
          lede="计划文件没有读到，所以这里没有可展示的意见与裁决。"
        />
        <section className="panel">
          <div className="empty">
            <p className="empty__title">读不到计划文件</p>
            <p className="empty__msg">{data.debate.reason}</p>
          </div>
        </section>
      </>
    );
  }

  const view = data.debate.view;
  const final = view.final?.targetWethBps ?? null;
  const mean = view.mean;
  const delta = view.delta;

  const rounds = view.rounds.map((r) => ({
    agent: r.agent,
    label: ROLE_LABEL[r.agent] ?? r.agent,
    bps: r.targetWethBps,
    confidence: r.confidence,
    reason: r.reason,
    model: r.model,
    vsFinal:
      r.targetWethBps !== null && final !== null ? r.targetWethBps - final : null,
  }));

  const spread =
    rounds.length > 0 && rounds.every((r) => r.bps !== null)
      ? Math.max(...rounds.map((r) => r.bps as number)) -
        Math.min(...rounds.map((r) => r.bps as number))
      : null;

  return (
    <>
      <ScreenHead
        eyebrow="辩论 → 裁决"
        meta={`${rounds.length} 个意见 · 1 个裁决`}
        title="三个意见，一个不取平均的裁决"
        lede={
          <>
            {spread !== null ? (
              <>
                三个 agent 的目标仓位相差 <strong>{spread} bps</strong>。
              </>
            ) : null}
            {final !== null && delta !== null ? (
              <>
                {" "}
                裁决落在 <strong>{final} bps</strong>，比算术均值
                {delta === 0 ? "相同" : ` ${delta > 0 ? "高" : "低"} ${Math.abs(delta)} bps`}{" "}
                —— 这是本页最需要你自己判断的一处。
              </>
            ) : null}
          </>
        }
      />

      <div className="debate-grid">
        <div className="agents" role="list" aria-label="三个 agent 的目标仓位">
          {rounds.map((r) => (
            <article className="agent" role="listitem" key={r.agent}>
              <h3 className="agent__role">
                <span>{r.label}</span>
                <span className="agent__code">{r.agent}</span>
              </h3>
              <p className="agent__pos">
                <span className="agent__bps">
                  {r.bps === null ? "—" : r.bps.toLocaleString("en-US")}
                </span>
                <span className="unit">bps</span>
              </p>
              <p className="agent__delta">
                <span>较裁决</span>{" "}
                {r.vsFinal === null
                  ? "—"
                  : `${r.vsFinal > 0 ? "+" : ""}${r.vsFinal}`}
              </p>
              <div className="conf">
                <div className="conf__top">
                  <span className="conf__label">
                    <Icon name="exposure" size={13} /> 信心
                  </span>
                  <span className="num">
                    {r.confidence === null ? "—" : r.confidence.toFixed(2)}
                  </span>
                </div>
                <div
                  className="bar"
                  role="img"
                  aria-label={`信心 ${r.confidence ?? "未采集"}`}
                >
                  <i style={{ width: `${(r.confidence ?? 0) * 100}%` }} />
                </div>
              </div>
              <p className="agent__why">{r.reason ?? "（该 agent 未给出理由）"}</p>
            </article>
          ))}
        </div>

        <section className="judge" aria-labelledby="judge-h">
          <div className="judge__top">
            <h3 className="eyebrow" id="judge-h">
              judge 裁决
            </h3>
            <span className="mono-meta">
              <Icon name="decision" size={13} /> {view.final?.model ?? "—"}
            </span>
          </div>
          <p className="judge__pos">
            <span className="judge__bps">
              {final === null ? "—" : final.toLocaleString("en-US")}
            </span>
            <span className="unit">bps</span>
          </p>
          <div className="judge__dev">
            <span className="unit">与算术平均的偏离</span>
            <span className="judge__dev-val">
              <span>
                {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")}`}
              </span>
              <span className="unit">bps</span>
            </span>
          </div>
          <ul className="calc">
            <li>
              <span>看多 / 看空 / 风控</span>
              <span className="num">
                {rounds
                  .map((r) => (r.bps === null ? "—" : r.bps.toLocaleString("en-US")))
                  .join(" · ")}
              </span>
            </li>
            <li>
              <span>算术平均</span>
              <span className="num">
                {mean === null ? "—" : mean.toLocaleString("en-US")}
              </span>
            </li>
            <li>
              <b>裁决</b>
              <span className="num">
                {final === null ? "—" : final.toLocaleString("en-US")}
              </span>
            </li>
          </ul>
          <p className="judge__why">{view.final?.rationale ?? "（judge 未给出理由）"}</p>
        </section>

        {final !== null && mean !== null ? (
          <Ruler
            final={final}
            mean={mean}
            delta={delta}
            rounds={rounds}
          />
        ) : (
          <section className="panel ruler" aria-labelledby="ruler-h">
            <div className="ruler__head">
              <h2 className="panel-title" id="ruler-h">
                同一根轴上的三个意见
              </h2>
            </div>
            <div className="empty">
              <p className="empty__title">标尺无法绘制</p>
              <p className="empty__msg">裁决或算术均值未采集到，缺一端就画不出距离。</p>
            </div>
          </section>
        )}
      </div>

      <div className="ifields" style={{ marginTop: 24 }}>
        <span className="ifield">
          <Icon name="file" size={14} className="ifield__icon" />
          <span className="ifield__label">计划</span>
          <span className="ifield__value">{view.size} B</span>
        </span>
        {view.input?.ethUsd != null ? (
          <span className="ifield">
            <Icon name="db" size={14} className="ifield__icon" />
            <span className="ifield__label">记录时 ETH/USD</span>
            <span className="ifield__value">{view.input.ethUsd}</span>
          </span>
        ) : null}
        <span className="ifield" data-tone="warn">
          <Icon name="warn" size={14} className="ifield__icon" />
          <span className="ifield__value">model / prompt 均为文件自述，非推理证明</span>
        </span>
      </div>
    </>
  );
}

function ScreenHead({
  eyebrow,
  meta,
  title,
  lede,
}: {
  eyebrow: string;
  meta: string;
  title: string;
  lede: React.ReactNode;
}) {
  return (
    <div className="screen-head">
      <div className="screen-head__main">
        <p className="eyebrow-icons">
          <span className="eyebrow">{eyebrow}</span>
          <span className="screen-head__rule" aria-hidden="true" />
          <span className="mono-meta">{meta}</span>
        </p>
        <h1 className="screen-title">{title}</h1>
        <p className="lede">{lede}</p>
      </div>
    </div>
  );
}

/**
 * 标尺。x 轴固定 0–10000 bps，用 SVG 坐标 40–960，每个点按 bps 线性映射 ——
 * 所以视觉位置就是数值比例，两点之间的距离可以量。
 *
 * 两个必须处理好的排版问题（实测出来的，不是猜的）：
 *
 * 1. **同值合并**。裁决与某个 agent 同值时，它们落在同一个 x 上。画两个点、两条引线
 *    只是重复，标签还会一上一下互相挡。合并成一个标记、一个联合标签
 *    （「看空 · 裁决 1,500」）既省地方，也更准确：那里本来就是一个位置。
 *
 * 2. **标签行装箱**。标签宽度不一，靠「靠近均值就往上放」这种规则会撞车 ——
 *    实测 风控 1,000（x 93..172）与 看空 1,500（x 139..218）就重叠了 33px。
 *    改成按 x 排序后逐行贪心：同一行放不下就换下一行（往上/往下各算各的）。
 *    估算宽度宁可偏大（多一行）也不能偏小（撞车）。
 */

/** 估算 SVG 文本宽度。中文字宽约为字号 1.05 倍，西文 0.59 倍。 */
function textWidth(text: string, fontSize = 14): number {
  let w = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) w += fontSize * 1.05;
    else if (ch === " ") w += fontSize * 0.28;
    else w += fontSize * 0.59;
  }
  return w;
}

/** 贪心行装箱：同一行放不下就换行。返回 key → 行号（0 最靠近轴）。 */
function packRows(items: { key: string; text: string; x: number }[]): Map<string, number> {
  const rows: [number, number][][] = [];
  const out = new Map<string, number>();
  const GAP = 8;
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    const half = textWidth(it.text) / 2;
    const x0 = it.x - half;
    const x1 = it.x + half;
    let row = 0;
    for (;;) {
      rows[row] ??= [];
      const clash = rows[row].some(([a, b]) => x0 < b + GAP && x1 > a - GAP);
      if (!clash) {
        rows[row].push([x0, x1]);
        out.set(it.key, row);
        break;
      }
      row += 1;
      if (row > 3) {
        out.set(it.key, 3);
        break;
      }
    }
  }
  return out;
}

function Ruler({
  final,
  mean,
  delta,
  rounds,
}: {
  final: number;
  mean: number;
  delta: number | null;
  rounds: { agent: string; label: string; bps: number | null }[];
}) {
  const X0 = 40;
  const X1 = 960;
  const AXIS_Y = 100;
  const toX = (bps: number) => X0 + (bps / 10000) * (X1 - X0);

  const palette: Record<string, string> = { bull: "看多", bear: "看空", risk: "风控" };

  // 1) 同值合并：把所有仓位的（名字, bps）收拢到一个位置
  type Point = { bps: number; names: string[]; isFinal: boolean; isMean: boolean };
  const byBps = new Map<number, Point>();
  const touch = (bps: number) => {
    const p = byBps.get(bps) ?? { bps, names: [], isFinal: false, isMean: false };
    byBps.set(bps, p);
    return p;
  };

  for (const r of rounds) {
    if (r.bps === null) continue;
    const p = touch(r.bps);
    p.names.push(palette[r.agent] ?? r.label);
  }
  touch(final).isFinal = true;
  touch(mean).isMean = true;

  const points = [...byBps.values()].sort((a, b) => a.bps - b.bps);

  // 2) 分上下两组：裁决组与均值组优先占下方/上方，其余按位置装箱
  const labelOf = (p: Point) => {
    const val = p.bps.toLocaleString("en-US");
    // 裁决与均值是这一屏的主角，名字写全；同值的 agent 跟在后面
    const names = [...p.names];
    if (p.isFinal) names.push("裁决");
    if (p.isMean) names.push("均值");
    return `${names.join(" · ")} ${val}`;
  };

  const belowItems: { key: string; text: string; x: number }[] = [];
  const aboveItems: { key: string; text: string; x: number }[] = [];

  for (const p of points) {
    const item = { key: String(p.bps), text: labelOf(p), x: toX(p.bps) };
    // 均值天然是「参考线」，放上面；裁决放下面（它是论据，配括号）
    if (p.isMean) aboveItems.push(item);
    else belowItems.push(item);
  }

  const belowRow = packRows(belowItems);
  const aboveRow = packRows(aboveItems);
  const belowDepth = Math.max(0, ...[...belowRow.values()]);

  const H = 168 + belowDepth * 26 + 46;
  const belowY = (row: number) => 146 + row * 26;
  const aboveY = (row: number) => 42 - row * 20;
  const bracketY = 130 + belowDepth * 26 + 36;

  return (
    <section className="panel ruler" aria-labelledby="ruler-h">
      <div className="ruler__head">
        <h2 className="panel-title" id="ruler-h">
          同一根轴上的三个意见
        </h2>
        <p className="mono-meta">单位 bps · 0 = 空仓，10 000 = 满仓</p>
      </div>

      <svg
        className="ruler__svg"
        viewBox={`0 0 1000 ${H}`}
        role="img"
        aria-label={`仓位标尺：${points
          .map((p) => `${labelOf(p)}`)
          .join("、")}，单位 bps。同值已合并为一个标记。`}
      >
        <line className="axis" x1={X0} y1={AXIS_Y} x2={X1} y2={AXIS_Y} />
        <line className="tick" x1={X0} y1={94} x2={X0} y2={106} />
        <line className="tick" x1={X1} y1={94} x2={X1} y2={106} />
        <text className="dim" x={X0} y={124} textAnchor="middle">
          0
        </text>
        <text className="dim" x={X1} y={124} textAnchor="middle">
          10 000
        </text>

        {points.map((p) => {
          const x = toX(p.bps);
          const row = belowRow.get(String(p.bps));
          const isBelow = row !== undefined;
          const r = aboveRow.get(String(p.bps)) ?? 0;
          const labelY = isBelow ? belowY(row) : aboveY(r);
          const leaderEnd = isBelow ? labelY - 20 : labelY + 12;
          const isJudge = p.isFinal;
          const isRef = p.isMean;
          return (
            <g key={p.bps}>
              <line
                className={isJudge ? "lead-final" : isRef ? "lead-mean" : "lead"}
                x1={x}
                y1={AXIS_Y}
                x2={x}
                y2={leaderEnd}
              />
              <circle
                className={isJudge ? "mark-final" : isRef ? "mark-mean" : "mark"}
                cx={x}
                cy={AXIS_Y}
                r={isJudge ? 5.5 : isRef ? 4.5 : 4}
              />
              <text
                className={isJudge ? "strong" : isRef ? "lbl" : undefined}
                x={x}
                y={labelY}
                textAnchor="middle"
              >
                {labelOf(p)}
              </text>
            </g>
          );
        })}

        {delta !== null && delta !== 0 ? (
          <>
            <path
              className="bracket"
              d={`M${Math.min(toX(final), toX(mean))} ${bracketY} L${Math.min(
                toX(final),
                toX(mean),
              )} ${bracketY + 6} L${Math.max(toX(final), toX(mean))} ${bracketY + 6} L${Math.max(
                toX(final),
                toX(mean),
              )} ${bracketY}`}
            />
            <text
              className="strong"
              x={(toX(final) + toX(mean)) / 2}
              y={bracketY + 30}
              textAnchor="middle"
            >
              {delta > 0 ? "+" : "−"}
              {Math.abs(delta).toLocaleString("en-US")}
            </text>
          </>
        ) : null}
      </svg>

      <ul className="ruler-mobile" aria-hidden="true">
        {points
          .slice()
          .sort((a, b) => a.bps - b.bps)
          .map((p) => (
            <li key={p.bps} data-role={p.isFinal ? "judge" : p.isMean ? "mean" : "agent"}>
              <span>{labelOf(p)}</span>
              <span className="track">
                <b style={{ width: `${(p.bps / 10000) * 100}%` }} />
              </span>
              <span className="num">{p.bps.toLocaleString("en-US")}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}
