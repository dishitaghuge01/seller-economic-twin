import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

export default function ShockEventChart({ orderHistory }) {
  let shockDay = null;
  let maxDropRatio = 0;
  for (let i = 3; i < orderHistory.length; i++) {
    const prevAvg =
      (orderHistory[i - 1].units_sold +
        orderHistory[i - 2].units_sold +
        orderHistory[i - 3].units_sold) /
      3;
    if (prevAvg <= 0) continue;
    const drop = (prevAvg - orderHistory[i].units_sold) / prevAvg;
    if (drop > maxDropRatio) {
      maxDropRatio = drop;
      if (drop > 0.4) shockDay = orderHistory[i].date;
    }
  }

  const data = orderHistory.map((r, i) => ({
    day: i + 1,
    date: r.date,
    units_sold: r.units_sold,
  }));

  const shockIdx = shockDay ? data.find((d) => d.date === shockDay)?.day : null;

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 mb-1">Sales Trend (30 days)</h3>
      <p className="text-xs text-gray-500 mb-4">Daily units sold</p>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 40, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11 }}
              ticks={[1, 5, 10, 15, 20, 25, 30]}
              tickFormatter={(v) => `D${v}`}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(l) => `Day ${l}`} />
            <Line
              type="monotone"
              dataKey="units_sold"
              stroke="#374151"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            {shockIdx && (
              <ReferenceLine
                x={shockIdx}
                stroke="#dc2626"
                strokeDasharray="4 4"
                label={{ value: "Market shift detected", position: "top", fontSize: 12, fill: "#dc2626" }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {!shockIdx && (
        <p className="mt-3 text-xs text-gray-500">
          No significant market shock detected in the last 30 days.
        </p>
      )}
    </div>
  );
}
