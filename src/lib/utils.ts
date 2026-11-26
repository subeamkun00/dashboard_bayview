import type { Chat } from "./types";
export const number = (value: number) => value.toLocaleString("en-US");
export const date = (value: string, time = false) =>
  new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: time ? undefined : "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
export const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

export type ChartDataPoint = {
  label: string;
  periodLabel: string;
  questions: number;
};

const chartMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const chartDate = (value: Date) =>
  `${value.getDate()} ${chartMonths[value.getMonth()]}`;

function chartPeriodLabel(start: Date, end: Date) {
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  const startLabel = chartDate(start);
  const endLabel = chartDate(inclusiveEnd);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  };
  const csv =
    "\uFEFF" +
    [
      keys.map(escape).join(","),
      ...rows.map((row) => keys.map((k) => escape(row[k])).join(",")),
    ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function chartData(
  chats: Chat[],
  period: "Daily" | "Weekly" | "Monthly",
  days: number,
  now = Date.now(),
): ChartDataPoint[] {
  const firstDay = new Date(rangeStart(days, now));
  const until = new Date(now);
  until.setHours(24, 0, 0, 0);

  const point = (start: Date, end: Date): ChartDataPoint => ({
    label: chartDate(start),
    periodLabel: chartPeriodLabel(start, end),
    questions: chats.filter((chat) => {
      const createdAt = new Date(chat.created_at).getTime();
      return (
        createdAt >= start.getTime() &&
        createdAt < end.getTime() &&
        createdAt <= now
      );
    }).length,
  });

  if (period === "Monthly") {
    const months: ChartDataPoint[] = [];
    let start = firstDay;
    while (start < until) {
      const nextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const end = nextMonth < until ? nextMonth : until;
      months.push(point(start, end));
      start = end;
    }
    return months;
  }

  const count = period === "Daily" ? days : Math.ceil(days / 7);
  const step = period === "Daily" ? 1 : 7;
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(firstDay);
    start.setDate(start.getDate() + i * step);
    const end = new Date(start);
    end.setDate(end.getDate() + step);
    if (end > until) end.setTime(until.getTime());
    return point(start, end);
  });
}
export function rangeStart(days: number, now: number) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start.getTime();
}
