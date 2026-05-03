"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsSummary } from "@/types/analytics";

export interface DashboardChartsProps {
  summary: AnalyticsSummary;
}

export function DashboardCharts({ summary }: DashboardChartsProps) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-stone-800">访问量趋势</h3>
        <div className="mt-4 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.visitsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#78716c" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#78716c" width={36} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4" }}
                labelStyle={{ fontSize: 12 }}
              />
              <Line type="monotone" dataKey="count" name="访问" stroke="#047857" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-stone-800">提交量趋势</h3>
        <div className="mt-4 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.submissionsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#78716c" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#78716c" width={36} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4" }}
                labelStyle={{ fontSize: 12 }}
              />
              <Line type="monotone" dataKey="count" name="提交" stroke="#b45309" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
