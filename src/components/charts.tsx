"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartDataPoint } from "@/lib/utils";
import { uiPixels } from "@/lib/ui-scale";

type Period = "Daily" | "Weekly" | "Monthly";
type LabeledChartDataPoint = ChartDataPoint & { labelValue?: number };
type ValueLabelProps = {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: number | string | null;
};

const axisTick = { fontSize: uiPixels(12), fill: "#78827b" };

function QuestionsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDataPoint; value?: number }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="questions-tooltip">
      <span>{point.periodLabel}</span>
      <strong>
        {point.questions.toLocaleString("en-US")} question
        {point.questions === 1 ? "" : "s"}
      </strong>
    </div>
  );
}

function VisibleDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartDataPoint;
}) {
  if (
    !props.payload?.questions ||
    props.cx === undefined ||
    props.cy === undefined
  )
    return <g />;

  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={uiPixels(3.25)}
      fill="#ffffff"
      stroke="#239c68"
      strokeWidth={uiPixels(2)}
    />
  );
}

function LineValueLabel({ x, y, value }: ValueLabelProps) {
  if (!value || x === undefined || y === undefined) return null;
  return (
    <text
      className="chart-value-label"
      x={Number(x)}
      y={Number(y) - uiPixels(10)}
      textAnchor="middle"
      aria-hidden="true"
    >
      {Number(value).toLocaleString("en-US")}
    </text>
  );
}

function BarValueLabel({ x, y, width, value }: ValueLabelProps) {
  if (!value || x === undefined || y === undefined || width === undefined)
    return null;
  return (
    <text
      className="chart-value-label"
      x={Number(x) + Number(width) / 2}
      y={Number(y) - uiPixels(8)}
      textAnchor="middle"
      aria-hidden="true"
    >
      {Number(value).toLocaleString("en-US")}
    </text>
  );
}

const sharedAxisProps = {
  tickLine: false,
  axisLine: false,
  tick: axisTick,
} as const;

export function QuestionsChart({
  data,
  period = "Daily",
  compact = false,
}: {
  data: ChartDataPoint[];
  period?: Period;
  compact?: boolean;
}) {
  const chartData: LabeledChartDataPoint[] = data.map((point) => ({
    ...point,
    // Label every active period, including small values and adjacent points.
    labelValue: point.questions > 0 ? point.questions : undefined,
  }));
  const accessibilityLabel = `Questions over time, ${period.toLowerCase()}: ${data
    .map((point) => `${point.periodLabel}, ${point.questions}`)
    .join("; ")}`;
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="#edf1ee" strokeDasharray="3 4" />
      <XAxis
        {...sharedAxisProps}
        dataKey="label"
        minTickGap={uiPixels(period === "Daily" ? 32 : 18)}
        interval="preserveStartEnd"
        dy={uiPixels(9)}
      />
      <YAxis
        {...sharedAxisProps}
        allowDecimals={false}
        tickCount={4}
        width={uiPixels(42)}
      />
      <Tooltip
        content={<QuestionsTooltip />}
        cursor={
          period === "Daily"
            ? { stroke: "#9fd2b6", strokeDasharray: "4 4" }
            : { fill: "#f1f7f3" }
        }
        animationDuration={160}
      />
    </>
  );

  return (
    <div
      className={`questions-chart ${compact ? "compact" : ""}`}
      role="img"
      aria-label={accessibilityLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        {period === "Daily" ? (
          <LineChart
            data={chartData}
            margin={{
              top: uiPixels(22),
              right: uiPixels(14),
              left: 0,
              bottom: uiPixels(2),
            }}
          >
            {common}
            <Line
              type="monotone"
              dataKey="questions"
              stroke="#239c68"
              strokeWidth={uiPixels(2.25)}
              dot={<VisibleDot />}
              activeDot={{
                r: uiPixels(5),
                fill: "#239c68",
                stroke: "#ffffff",
                strokeWidth: uiPixels(3),
              }}
              isAnimationActive
              animationDuration={420}
              animationEasing="ease-out"
            >
              <LabelList dataKey="labelValue" content={<LineValueLabel />} />
            </Line>
          </LineChart>
        ) : (
          <BarChart
            data={chartData}
            margin={{
              top: uiPixels(22),
              right: uiPixels(14),
              left: 0,
              bottom: uiPixels(2),
            }}
            barCategoryGap={period === "Monthly" ? "48%" : "30%"}
          >
            {common}
            <Bar
              dataKey="questions"
              fill="#43a978"
              radius={[uiPixels(5), uiPixels(5), uiPixels(1), uiPixels(1)]}
              maxBarSize={uiPixels(period === "Monthly" ? 64 : 44)}
              isAnimationActive
              animationDuration={420}
              animationEasing="ease-out"
            >
              <LabelList dataKey="labelValue" content={<BarValueLabel />} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
