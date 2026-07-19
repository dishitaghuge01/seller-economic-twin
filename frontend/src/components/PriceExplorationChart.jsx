import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useT } from "../lib/i18n.jsx";

export function PriceExplorationChart({ skuId, priceArms }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const enriched = (priceArms || []).map((a) => {
    const mean = a.alpha / (a.alpha + a.beta_param);
    const n = a.alpha + a.beta_param;
    const sd = Math.sqrt((mean * (1 - mean)) / n);
    return {
      ...a,
      priceLabel: `₹${a.price_value}`,
      posterior_mean: mean,
      ci_low: Math.max(0, mean - 1.96 * sd),
      ci_high: Math.min(1, mean + 1.96 * sd),
    };
  });

  const bestMean = Math.max(...enriched.map((e) => e.posterior_mean));

  return (
    <div className="space-y-3">
      <div className="h-52 w-full">
        <ResponsiveContainer>
          <BarChart data={enriched} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="priceLabel" tickFormatter={(value) => value} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: "oklch(0.48 0.17 310 / 0.08)" }} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(value) => [value, t("chart.timesChosen")]} labelFormatter={(label) => `${t("chart.price")} ${label}`} />
            <Bar dataKey="times_chosen" radius={[6, 6, 0, 0]}>
              {enriched.map((e, i) => (
                <Cell key={`${e.price_value}-${i}`} fill={e.posterior_mean === bestMean ? "var(--jamuni)" : "oklch(0.48 0.17 310 / 0.28)"} />
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
            {enriched.map((e, index) => (
              <tr key={`${e.price_value}-${index}`} className={e.posterior_mean === bestMean ? "bg-jamuni-soft/60" : ""}>
                <td className="px-3 py-2 font-medium tabular-nums">{e.priceLabel}{e.posterior_mean === bestMean && <span className="ml-1.5 text-[10px] font-bold text-jamuni">{t("chart.best")}</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.times_chosen}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.posterior_mean.toFixed(3)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{e.ci_low.toFixed(2)} – {e.ci_high.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 text-xs font-medium text-jamuni">
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {t("chart.about")}
      </button>
      {open && <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">{t("chart.aboutBody")}</p>}
    </div>
  );
}

export default PriceExplorationChart;
