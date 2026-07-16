import { render, screen, waitFor } from "@testing-library/react";
import ForecastFanChart from "./ForecastFanChart.jsx";
import apiClient from "../apiClient.js";

describe("ForecastFanChart", () => {
  test("test_forecast_fan_chart_loading", async () => {
    const spy = vi.spyOn(apiClient, "getForecast").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({
              severity: "safe",
              fan_chart: [{ day: 1, p_stockout: 0.1 }],
              median_stockout_day: 99,
              stockout_ci_low: 60,
              stockout_ci_high: 150,
              lambda_estimated: 0.1,
            });
          }, 50),
        ),
    );

    render(<ForecastFanChart skuId="cotton_palazzo" sellerId="riya_sharma" />);

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/Stockout Forecast/i)).toBeInTheDocument());
    spy.mockRestore();
  });

  test("test_forecast_severity_urgent", async () => {
    const spy = vi.spyOn(apiClient, "getForecast").mockResolvedValue({
      severity: "urgent",
      fan_chart: [{ day: 1, p_stockout: 0.1 }],
      median_stockout_day: 6,
      stockout_ci_low: 4,
      stockout_ci_high: 9,
      lambda_estimated: 1.4,
    });

    render(<ForecastFanChart skuId="blue_kurti" sellerId="riya_sharma" />);

    await waitFor(() => expect(screen.getByText(/Restock recommended/i)).toBeInTheDocument());
    spy.mockRestore();
  });

  test("test_forecast_severity_safe", async () => {
    const spy = vi.spyOn(apiClient, "getForecast").mockResolvedValue({
      severity: "safe",
      fan_chart: [{ day: 1, p_stockout: 0.1 }],
      median_stockout_day: 99,
      stockout_ci_low: 60,
      stockout_ci_high: 150,
      lambda_estimated: 0.1,
    });

    render(<ForecastFanChart skuId="cotton_palazzo" sellerId="riya_sharma" />);

    await waitFor(() => expect(screen.queryByText(/Restock recommended/i)).not.toBeInTheDocument());
    spy.mockRestore();
  });
});
