import { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import apiClient from "../apiClient.js";

const severityColors = {
  urgent: "#dc2626",
  watch: "#d97706",
  safe: "#16a34a",
};

export default function ForecastFanChart({ skuId, sellerId, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .getForecast(sellerId, skuId)
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [sellerId, skuId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 h-80 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-gray-800 rounded-full" />
      </div>
    );
  }
  if (!data) return null;

  const color = severityColors[data.severity] || severityColors.safe;
  const chartData = data.fan_chart.map((r) => ({
    day: r.day,
    pct: Math.round(r.p_stockout * 1000) / 10,
  }));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">Stockout Forecast</h3>
          <p className="text-xs text-gray-500">Likelihood of running out over 30 days</p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {data.severity === "urgent" && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
          ⚠ Restock recommended within {data.stockout_ci_low} days.
        </div>
      )}

      <div className="h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 24, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${skuId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={1} />
                <stop offset="100%" stopColor={color} stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11 }}
              ticks={[1, 5, 10, 15, 20, 25, 30]}
              tickFormatter={(v) => `Day ${v}`}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              formatter={(v) => [`${v}%`, "P(stockout)"]}
              labelFormatter={(l) => `Day ${l}`}
            />
            <ReferenceLine
              y={50}
              stroke="#6b7280"
              strokeDasharray="4 4"
              label={{ value: "50% likelihood", position: "insideTopRight", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="pct"
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${skuId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Most likely stockout</div>
          <div className="font-semibold text-gray-900">Day {data.median_stockout_day}</div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">80% range</div>
          <div className="font-semibold text-gray-900">
            Day {data.stockout_ci_low} – Day {data.stockout_ci_high}
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Based on</div>
          <div className="font-semibold text-gray-900">
            {data.lambda_estimated} orders/day average
          </div>
        </div>
      </div>
    </div>
  );
}
