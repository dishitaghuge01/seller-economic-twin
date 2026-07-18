import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SellerPanel from "./SellerPanel.jsx";
import apiClient from "../apiClient.js";

vi.mock("../apiClient.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  apiClient.getDemoStatus = vi.fn();
  apiClient.resetDemo = vi.fn();
  apiClient.startDemo = vi.fn();
  apiClient.stepDemo = vi.fn();
  apiClient.getForecast = vi.fn().mockResolvedValue({
    severity: "safe",
    fan_chart: [{ day: 1, p_stockout: 0.01 }],
    lambda_estimated: 1.2,
    starting_stock: 10,
    p_stockout_5d: 0.01,
    p_stockout_10d: 0.02,
    median_stockout_day: 99,
    stockout_ci_low: 50,
    stockout_ci_high: 120,
    confidence: "high",
    days_of_history: 30,
  });
  apiClient.postMessage = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SellerPanel Run Pricing Now preserves selection", () => {
  test("selected SKU remains after Run Pricing Now", async () => {
    const sellerId = "s1";

    const sku1 = {
      sku_id: "k1",
      sku_name: "First SKU",
      current_stock: 10,
      current_chosen_price: 300,
      last_action: { stockout_severity: "safe" },
    };
    const sku2 = {
      sku_id: "k2",
      sku_name: "Second SKU",
      current_stock: 5,
      current_chosen_price: 350,
      last_action: { stockout_severity: "watch" },
    };

    const sellerPayload = {
      seller: { seller_name: "Test Seller" },
      skus: [sku1, sku2],
    };

    apiClient.getSeller.mockResolvedValue(sellerPayload);
    apiClient.getSkuHistory.mockResolvedValue({
      price_arms: [],
      order_history: [],
      agent_actions: [],
    });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });
    apiClient.triggerPricingNow.mockResolvedValue({
      sku_id: sku2.sku_id,
      chosen_price: 360,
    });

    render(<SellerPanel sellerId={sellerId} />);

    // wait for initial load
    await screen.findByText("Test Seller");

    // select the second SKU
    fireEvent.click(screen.getByRole("button", { name: /Second SKU/i }));
    expect(screen.getAllByText("Second SKU").length).toBeGreaterThan(0);

    // click Run Pricing Now
    fireEvent.click(screen.getByRole("button", { name: /Run Pricing Now/i }));

    // wait for loadSeller to be called and UI to settle
    await waitFor(() => expect(apiClient.getSeller).toHaveBeenCalled());

    // selection should remain on Second SKU
    expect(screen.getAllByText("Second SKU").length).toBeGreaterThan(0);
  });
});

describe("SellerPanel demo runner", () => {
  test("test_run_pricing_now_hidden_for_demo_seller", async () => {
    apiClient.getSeller.mockResolvedValue({
      seller: { seller_name: "Demo Seller" },
      skus: [
        {
          sku_id: "demo_sku",
          sku_name: "Demo SKU",
          current_stock: 10,
          current_chosen_price: 300,
          last_action: { stockout_severity: "safe" },
        },
      ],
    });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });

    render(<SellerPanel sellerId="s1" isDemoSeller={true} />);

    await screen.findByText("Demo Seller");
    expect(screen.queryByRole("button", { name: /Run Pricing Now/i })).not.toBeInTheDocument();
  });

  test("test_demo_runner_hidden_for_non_demo_seller", async () => {
    apiClient.getSeller.mockResolvedValue({ seller: { seller_name: "Test Seller" }, skus: [] });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });

    render(<SellerPanel sellerId="s1" isDemoSeller={false} />);

    await screen.findByText("Test Seller");
    expect(screen.queryByRole("button", { name: /Run Demo/i })).not.toBeInTheDocument();
  });

  test("test_demo_runner_visible_for_demo_seller", async () => {
    apiClient.getSeller.mockResolvedValue({ seller: { seller_name: "Demo Seller" }, skus: [] });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });

    render(<SellerPanel sellerId="s1" isDemoSeller={true} />);

    await screen.findByText("Demo Seller");
    expect(screen.getByRole("button", { name: /Run Demo/i })).toBeInTheDocument();
  });

  test("test_run_demo_steps_through_days", async () => {
    vi.useFakeTimers();
    apiClient.getSeller.mockResolvedValue({
      seller: { seller_name: "Demo Seller" },
      skus: [
        {
          sku_id: "blue_kurti",
          sku_name: "Blue Kurti",
          current_stock: 6,
          current_chosen_price: 410,
          last_action: { stockout_severity: "urgent" },
        },
      ],
    });
    apiClient.getSkuHistory.mockResolvedValue({ price_arms: [], order_history: [], agent_actions: [] });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });
    apiClient.resetDemo.mockResolvedValue({ status: "reset" });
    apiClient.startDemo.mockResolvedValue({
      status: "started",
      current_day: 0,
      max_days: 6,
      depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
      shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
    });
    apiClient.stepDemo
      .mockResolvedValueOnce({
        day: 1,
        max_days: 6,
        shock_event_triggered_today: false,
        notifications: [{ sku_id: "blue_kurti", sent: false, reason: "price change below threshold" }],
        agent_messages: [],
        depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
        shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
      })
      .mockResolvedValueOnce({
        day: 2,
        max_days: 6,
        shock_event_triggered_today: true,
        notifications: [{ sku_id: "cotton_palazzo", sent: true, reason: "shock arc" }],
        agent_messages: [],
        depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
        shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
      })
      .mockResolvedValueOnce({
        day: 6,
        max_days: 6,
        shock_event_triggered_today: false,
        notifications: [{ sku_id: "blue_kurti", sent: false, reason: "price change below threshold" }],
        agent_messages: [],
        depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
        shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
      });


    render(<SellerPanel sellerId="s1" isDemoSeller={true} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Demo Seller")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Demo/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Start demo replay/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start demo replay/i }));
    });

    expect(apiClient.resetDemo).toHaveBeenCalledWith("s1");
    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    expect(apiClient.stepDemo).toHaveBeenCalledTimes(3);
  });

  test("test_notification_toast_appears_on_sent_notification", async () => {
    vi.useFakeTimers();
    apiClient.getSeller.mockResolvedValue({ seller: { seller_name: "Demo Seller" }, skus: [] });
    apiClient.getSkuHistory.mockResolvedValue({ price_arms: [], order_history: [], agent_actions: [] });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });
    apiClient.resetDemo.mockResolvedValue({ status: "reset" });
    apiClient.startDemo.mockResolvedValue({ status: "started", current_day: 0, max_days: 6, depletion_sku: {}, shock_sku: {} });
    apiClient.stepDemo.mockResolvedValueOnce({
      day: 1,
      max_days: 6,
      shock_event_triggered_today: false,
      notifications: [{ sku_id: "blue_kurti", sent: true, reason: "depletion arc" }],
      agent_messages: [],
      depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
      shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
    });

    render(<SellerPanel sellerId="s1" isDemoSeller={true} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Demo Seller")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Demo/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Start demo replay/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start demo replay/i }));
    });

    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    expect(screen.getByText(/WhatsApp alert sent/i)).toBeInTheDocument();
  });

  test("test_reset_clears_local_log", async () => {
    vi.useFakeTimers();
    apiClient.getSeller.mockResolvedValue({ seller: { seller_name: "Demo Seller" }, skus: [] });
    apiClient.getSkuHistory.mockResolvedValue({ price_arms: [], order_history: [], agent_actions: [] });
    apiClient.getDemoStatus.mockResolvedValue({ status: "not_started" });
    apiClient.resetDemo.mockResolvedValue({ status: "reset" });
    apiClient.startDemo.mockResolvedValue({ status: "started", current_day: 0, max_days: 6, depletion_sku: {}, shock_sku: {} });
    apiClient.stepDemo.mockResolvedValueOnce({
      day: 1,
      max_days: 6,
      shock_event_triggered_today: false,
      notifications: [],
      agent_messages: [],
      depletion_sku: { sku_id: "blue_kurti", sku_name: "Blue Kurti", stockout_severity: "urgent" },
      shock_sku: { sku_id: "cotton_palazzo", sku_name: "Cotton Palazzo", stockout_severity: "safe" },
    });

    render(<SellerPanel sellerId="s1" isDemoSeller={true} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Demo Seller")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Demo/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Start demo replay/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start demo replay/i }));
    });

    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    expect(screen.getByText(/Day 1:/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Reset Demo/i }));
    });

    expect(screen.queryByText(/Day 1:/i)).not.toBeInTheDocument();
  });
});
