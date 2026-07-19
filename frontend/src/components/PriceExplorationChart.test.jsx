import { render, screen } from "@testing-library/react";
import { PriceExplorationChart } from "./PriceExplorationChart.jsx";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div style={{ width: 500, height: 300 }}>{children}</div>,
    BarChart: ({ data, children }) => (
      <div data-testid="bar-chart">
        {data?.map((entry, index) => (
          <div key={index} className="recharts-bar-rectangle">
            {entry.times_chosen}
          </div>
        ))}
        {children}
      </div>
    ),
    Bar: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    LabelList: () => null,
  };
});

describe("PriceExplorationChart", () => {
  test("test_price_exploration_chart_bars", () => {
    const priceArms = [
      { price_value: 370, alpha: 3.0, beta_param: 5.0, times_chosen: 4 },
      { price_value: 390, alpha: 5.0, beta_param: 4.0, times_chosen: 6 },
      { price_value: 410, alpha: 8.0, beta_param: 4.0, times_chosen: 9 },
      { price_value: 430, alpha: 6.0, beta_param: 4.0, times_chosen: 7 },
      { price_value: 450, alpha: 3.0, beta_param: 5.0, times_chosen: 4 },
      { price_value: 470, alpha: 2.0, beta_param: 5.0, times_chosen: 3 },
      { price_value: 490, alpha: 2.0, beta_param: 6.0, times_chosen: 3 },
    ];

    render(<PriceExplorationChart skuId="blue_kurti" priceArms={priceArms} />);

    const bars = document.querySelectorAll(".recharts-bar-rectangle");
    expect(bars).toHaveLength(7);

    const barLabels = Array.from(bars).map((bar) => bar.textContent.trim());
    priceArms.forEach((arm) => {
      expect(barLabels).toContain(String(arm.times_chosen));
    });
  });

  test("test_arm_table_posterior_mean", () => {
    const priceArms = [
      { price_value: 370, alpha: 3.0, beta_param: 5.0, times_chosen: 4 },
      { price_value: 390, alpha: 5.0, beta_param: 4.0, times_chosen: 6 },
    ];

    render(<PriceExplorationChart skuId="blue_kurti" priceArms={priceArms} />);

    priceArms.forEach((arm) => {
      const expected = (arm.alpha / (arm.alpha + arm.beta_param)).toFixed(2);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });
});
