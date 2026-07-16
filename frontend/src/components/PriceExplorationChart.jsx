import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";

export default function PriceExplorationChart({ skuId, priceArms }) {
  const [open, setOpen] = useState(false);

  const enriched = priceArms.map((a) => {
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
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 mb-1">Price Exploration</h3>
      <p className="text-xs text-gray-500 mb-4">
        Times each price was tried by the agent
      </p>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={enriched} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="priceLabel" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip
              formatter={(v) => [v, "Times chosen"]}
              labelFormatter={(l) => `Price ${l}`}
            />
            <Bar dataKey="times_chosen" radius={[6, 6, 0, 0]}>
              {enriched.map((e, i) => (
                <Cell
                  key={i}
                  fill={e.posterior_mean === bestMean ? "#1e40af" : "#93c5fd"}
                />
              ))}
              <LabelList dataKey="times_chosen" position="top" style={{ fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase border-b">
            <tr>
              <th className="text-left py-2">Price</th>
              <th className="text-right py-2">Times Chosen</th>
              <th className="text-right py-2">Posterior Mean</th>
              <th className="text-right py-2">95% CI</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((e) => (
              <tr
                key={e.price_value}
                className={
                  "border-b border-gray-100 " +
                  (e.posterior_mean === bestMean ? "bg-blue-50" : "")
                }
              >
                <td className="py-2 font-medium">{e.priceLabel}</td>
                <td className="py-2 text-right">{e.times_chosen}</td>
                <td className="py-2 text-right">{e.posterior_mean.toFixed(2)}</td>
                <td className="py-2 text-right text-gray-600">
                  [{e.ci_low.toFixed(2)}, {e.ci_high.toFixed(2)}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-xs text-blue-600 hover:underline"
      >
        {open ? "Hide" : "About this chart"}
      </button>
      {open && (
        <p className="mt-2 text-xs text-gray-600 leading-relaxed">
          The agent uses Thompson Sampling to explore different price points. Each price
          starts with equal chance of being picked; when a price sells well, its posterior
          mean rises and the agent picks it more often. Prices with taller bars have been
          tried more; the highlighted price currently looks best given the evidence so far.
        </p>
      )}
    </div>
  );
}
