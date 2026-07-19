import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useT } from "../lib/i18n.jsx";

function detectShift(history) {
  for (let i = 3; i < history.length; i++) {
    const trailing = (history[i - 1].units_sold + history[i - 2].units_sold + history[i - 3].units_sold) / 3;
    if (trailing > 0 && history[i].units_sold < trailing * 0.6) {
      return { date: history[i].date, index: i, trailing };
    }
  }
  return null;
}

export function ShockEventChart({ orderHistory }) {
  const t = useT();
  const shift = useMemo(() => detectShift(orderHistory || []), [orderHistory]);
  const data = (orderHistory || []).map((r) => ({ ...r, dayLabel: r.date.slice(5) }));

  return (
    <div className="space-y-3">
      {shift && <div className="rounded-lg border border-watch/40 bg-watch-soft px-3 py-2 text-xs text-watch">{t("shock.detected", { date: shift.date })}</div>}
      <div className="h-52 w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(value) => [value, t("shock.units")]} labelFormatter={(label) => `${t("shock.date")} ${label}`} />
            {shift && <ReferenceLine x={data[shift.index].dayLabel} stroke="var(--watch)" strokeDasharray="4 3" label={{ value: t("shock.shiftLabel"), fontSize: 10, fill: "var(--watch)", position: "top" }} />}
            <Line type="monotone" dataKey="units_sold" stroke="var(--jamuni)" strokeWidth={2} dot={{ r: 2, fill: "var(--jamuni)" }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default ShockEventChart;
