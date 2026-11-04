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
import { pct } from "@/lib/utils";

export function StackedOutcomeBars({
  rows,
  labels,
}: {
  rows: Array<Record<string, string | number>>;
  labels: string[];
}) {
  if (!rows.length) return null;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
          <CartesianGrid stroke="#E4E9F0" vertical={false} />
          <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6A7B93" }} interval={0} angle={-25} textAnchor="end" height={50} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#6A7B93" }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#D7DDE7" }}
            formatter={(value: number, name: string) => [value, name.replace(/_/g, " ")]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => String(v).replace(/_/g, " ")} />
          {labels.map((lab) => (
            <Bar
              key={lab}
              dataKey={lab}
              stackId="a"
              fill={OUTCOME_COLORS[lab] || OUTCOME_COLORS.other}
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
  const palette = ["#0B8F7A", "#101B2D", "#C98512", "#D4285C"];
  const data = series.map((row) => {
    const next: Record<string, string | number | null> = { variant: row.variant as string };
    for (const a of agents) {
      const v = row[a];
      next[a] = typeof v === "number" ? Math.round(v * 1000) / 10 : null;
    }
    return next;
  });
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="#E4E9F0" />
          <XAxis dataKey="variant" tick={{ fontSize: 11, fill: "#6A7B93" }} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "#6A7B93" }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#D7DDE7" }}
            formatter={(value: number, name: string) => [`${value}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
      <p className="mt-1 text-[11px] text-ink/45">
        Grounded share = runs labeled grounded_correct. {agents.map((a) => `${a}`).join(" vs ")}.
        Tip: hover for exact {pct(0.5)} values.
      </p>
    </div>
  );
}
