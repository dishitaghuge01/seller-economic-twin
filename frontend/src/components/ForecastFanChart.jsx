import { useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { RefreshCw, AlertTriangle } from "lucide-react";
import apiClient from "../apiClient.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import { useT } from "../lib/i18n.jsx";

const severityColors = {
  urgent: "var(--urgent)",
  watch: "var(--watch)",
  safe: "var(--safe)",
};

export function ForecastFanChart({ skuId, sellerId, refreshKey }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    const thisRequestId = ++requestIdRef.current;
    apiClient
      .getForecast(sellerId, skuId)
      .then((d) => {
        if (thisRequestId === requestIdRef.current) {
          setData(d);
        }
      })
      .finally(() => {
        if (thisRequestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, [sellerId, skuId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading || !data) {
    return <LoadingSpinner messages={[t("forecast.loading")]} heightClass="h-80" />;
  }

  const color = severityColors[data.severity] || severityColors.safe;
  const chartData = data.fan_chart.map((r) => ({
    day: r.day,
    pct: Math.round(r.p_stockout * 1000) / 10,
  }));

  return (
    <div className="space-y-3">
      {data.severity === "urgent" && (
        <div className="flex items-start gap-2 rounded-lg bg-urgent-soft p-3 text-sm text-urgent">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t("forecast.restockUrgent")}</p>
            <p className="text-xs opacity-90">{t("forecast.stockoutLikely", { days: data.median_stockout_day })}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t("forecast.30day")}</p>
        <button onClick={load} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted">
          <RefreshCw className="h-3 w-3" /> {t("forecast.refresh")}
        </button>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <defs>
              <linearGradient id={`grad-${skuId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tickFormatter={(value) => `D${value}`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => [`${value}%`, t("forecast.pStockout")]} labelFormatter={(label) => `${t("forecast.dayLabel")} ${label}`} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "50%", fontSize: 10, fill: "var(--muted-foreground)", position: "right" }} />
            <Area type="monotone" dataKey="pct" stroke={color} strokeWidth={2} fill={`url(#grad-${skuId})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.likelyDay")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{t("forecast.dayLabel")} {data.median_stockout_day}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.range80")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{data.stockout_ci_low} – {data.stockout_ci_high}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.ordersPerDay")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{data.lambda_estimated.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
}

export default ForecastFanChart;
