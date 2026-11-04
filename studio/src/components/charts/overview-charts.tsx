"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OUTCOME_COLORS } from "@/lib/labels";

function chartVars() {
  if (typeof window === "undefined") {
    return { grid: "#1B2A41", label: "#8CA0BC", tipBg: "#0F1A2E", tipBorder: "#26395A", tipFg: "#E6F1FF" };
  }
  const s = getComputedStyle(document.documentElement);
  return {
    grid: s.getPropertyValue("--st-chart-grid").trim() || "#1B2A41",
    label: s.getPropertyValue("--st-chart-label").trim() || "#8CA0BC",
    tipBg: s.getPropertyValue("--st-tooltip-bg").trim() || "#0F1A2E",
    tipBorder: s.getPropertyValue("--st-border").trim() || "#26395A",
    tipFg: s.getPropertyValue("--st-ink").trim() || "#E6F1FF",
  };
}

const DARK_OUTCOME: Record<string, string> = {
  grounded_correct: "#2DD4BF",
  correct_ungrounded: "#F59E0B",
  misread: "#94A3B8",
  mislocated: "#F43F5E",
  mistimed: "#F43F5E",
  heard_wrong: "#94A3B8",
  misread_image: "#F59E0B",
  comparison_error: "#F43F5E",
  misunderstood: "#F59E0B",
  abstained: "#5F7391",
  invalid_output: "#F43F5E",
  other: "#5F7391",
};

export function StackedOutcomeBars({
  rows,
  labels,
}: {
  rows: Array<Record<string, string | number>>;
  labels: string[];
}) {
  if (!rows.length) return null;
  const v = chartVars();
  const isDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
          <CartesianGrid stroke={v.grid} vertical={false} />
          <XAxis
            dataKey="key"
            tick={{ fontSize: 10, fill: v.label }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={50}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: v.label }} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              borderColor: v.tipBorder,
              background: v.tipBg,
              color: v.tipFg,
            }}
            formatter={(value: number, name: string) => [value, name.replace(/_/g, " ")]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: v.label }} formatter={(x) => String(x).replace(/_/g, " ")} />
          {labels.map((lab) => (
            <Bar
              key={lab}
              dataKey={lab}
              stackId="a"
              fill={
                isDark
                  ? DARK_OUTCOME[lab] || DARK_OUTCOME.other
                  : OUTCOME_COLORS[lab] || OUTCOME_COLORS.other
              }
              name={lab}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GroundedLineChart({
  series,
  agents,
}: {
  series: Array<Record<string, string | number | null>>;
  agents: string[];
}) {
  if (!series.length || !agents.length) return null;
  const v = chartVars();
  const palette = ["#2DD4BF", "#8EC5FF", "#F59E0B", "#F43F5E"];
  const data = series.map((row) => {
    const next: Record<string, string | number | null> = { variant: row.variant as string };
    for (const a of agents) {
      const val = row[a];
      next[a] = typeof val === "number" ? Math.round(val * 1000) / 10 : null;
    }
    return next;
  });
  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={v.grid} />
          <XAxis dataKey="variant" tick={{ fontSize: 11, fill: v.label }} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: v.label }}
            tickFormatter={(x) => `${x}%`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              borderColor: v.tipBorder,
              background: v.tipBg,
              color: v.tipFg,
            }}
            formatter={(value: number, name: string) => [`${value}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: v.label }} />
          {agents.map((agent, i) => (
            <Line
              key={agent}
              type="monotone"
              dataKey={agent}
              stroke={palette[i % palette.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[11px] text-ink-muted">
        Grounded share = runs labeled grounded_correct. {agents.map((a) => `${a}`).join(" vs ")}.
      </p>
    </div>
  );
}
