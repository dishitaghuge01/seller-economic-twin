import { useCallback, useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from "recharts";
import { RefreshCw, AlertTriangle } from "lucide-react";
import apiClient from "../apiClient.js";
import { LoadingSpinner } from "./LoadingSpinner";
import { useT } from "@/lib/i18n";


const sevColor = { urgent: "var(--urgent)", watch: "var(--watch)", safe: "var(--safe)" };

export function ForecastFanChart({ skuId, sellerId, refreshKey }) {
  const t = useT();
  const [f, setF] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);


  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    apiClient.getForecast(sellerId, skuId).then((res) => { if (alive) { setF(res); setLoading(false); } });
    return () => { alive = false; };
  }, [sellerId, skuId]);

  useEffect(() => load(), [load, refreshKey, nonce]);

  if (loading || !f) return <LoadingSpinner messages={[t("forecast.loading")]} />;
  const color = sevColor[f.severity];

  return (
    <div className="space-y-3">
      <h3 className="font-display text-lg font-semibold">Stockout Forecast</h3>
      {f.severity === "urgent" && (
        <div className="flex items-start gap-2 rounded-lg bg-urgent-soft p-3 text-sm text-urgent">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t("forecast.restockUrgent")}</p>
            <p className="text-xs opacity-90">{t("forecast.stockoutLikely", { days: f.median_stockout_day })}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t("forecast.30day")}</p>
        <button onClick={() => setNonce((n) => n + 1)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted">
          <RefreshCw className="h-3 w-3" /> {t("forecast.refresh")}
        </button>
      </div>


      <div className="h-52 w-full">
        <ResponsiveContainer>
          <AreaChart data={f.fan_chart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <defs>
              <linearGradient id="fanFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tickFormatter={(v) => `D${v}`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => [`${Math.round(v * 100)}%`, t("forecast.pStockout")]} labelFormatter={(l) => `${t("forecast.dayLabel")} ${l}`} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
            <ReferenceLine y={0.5} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "50%", fontSize: 10, fill: "var(--muted-foreground)", position: "right" }} />
            <Area type="monotone" dataKey="p_stockout" stroke={color} strokeWidth={2} fill="url(#fanFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.likelyDay")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{t("forecast.dayLabel")} {f.median_stockout_day}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.range80")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{f.stockout_ci_low} – {f.stockout_ci_high}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("forecast.ordersPerDay")}</p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums">{f.lambda_estimated.toFixed(1)}</p>
        </div>
      </div>

    </div>
  );
}
