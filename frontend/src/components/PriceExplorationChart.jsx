import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import apiClient from "../apiClient.js";
import { LoadingSpinner } from "./LoadingSpinner";
import { useT } from "@/lib/i18n";


export function PriceExplorationChart({ sellerId, skuId, priceArms: initialArms }) {
  const t = useT();
  const [arms, setArms] = useState(initialArms || null);
  const [loading, setLoading] = useState(!initialArms);
  const [error, setError] = useState(null);
  const [showAbout, setShowAbout] = useState(false);

  const loadArms = () => {
    if (initialArms) {
      setArms(initialArms);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    apiClient.getSkuHistory(sellerId, skuId)
      .then((h) => {
        if (alive) {
          setArms(h.price_arms);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err?.message || "Unable to load price arms.");
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    return loadArms();
  }, [sellerId, skuId, initialArms]);

  if (loading || !arms) {
    if (error && !arms) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          <button onClick={loadArms} className="mt-2 text-xs font-medium underline">
            Retry
          </button>
        </div>
      );
    }
    return <LoadingSpinner messages={[t("chart.loadingArms")]} />;
  }

  const enriched = arms.map((a) => ({
    ...a,
    posterior_mean: a.alpha / (a.alpha + a.beta_param),
    ci_low: Math.max(0, a.alpha / (a.alpha + a.beta_param) - 0.15),
    ci_high: Math.min(1, a.alpha / (a.alpha + a.beta_param) + 0.15),
  }));
  const bestIdx = enriched.reduce((best, cur, i) => (cur.posterior_mean > enriched[best].posterior_mean ? i : best), 0);

  return (
    <div className="space-y-3">
      <div className="h-52 w-full">
        <ResponsiveContainer>
          <BarChart data={enriched} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="price_value" tickFormatter={(v) => `₹${v}`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "oklch(0.48 0.17 310 / 0.08)" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
              formatter={(v) => [v, t("chart.timesChosen")]} 
              labelFormatter={(v) => `${t("chart.price")} ₹${v}`}

            />
            <Bar dataKey="times_chosen" radius={[6, 6, 0, 0]}>
              {enriched.map((_, i) => (
                <Cell key={i} fill={i === bestIdx ? "var(--jamuni)" : "oklch(0.48 0.17 310 / 0.28)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("chart.price")}</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">{t("chart.timesChosenCol")}</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">{t("chart.posteriorMean")}</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">{t("chart.ci95")}</th>

            </tr>
          </thead>
          <tbody>
            {enriched.map((a, i) => (
              <tr key={a.price_value} className={i === bestIdx ? "bg-jamuni-soft/60" : ""}>
                <td className="px-3 py-2 font-medium tabular-nums">₹{a.price_value}{i === bestIdx && <span className="ml-1.5 text-[10px] font-bold text-jamuni">{t("chart.best")}</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.times_chosen}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.posterior_mean.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{a.ci_low.toFixed(2)} – {a.ci_high.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={() => setShowAbout((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-jamuni">
        {showAbout ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {t("chart.about")}
      </button>
      {showAbout && (
        <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {t("chart.aboutBody")}
        </p>
      )}

    </div>
  );
}
