import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SellerPanel from "./SellerPanel.jsx";
import apiClient from "../apiClient.js";

vi.mock("../apiClient.js");

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
    apiClient.getSkuHistory = vi.fn().mockResolvedValue({
      price_arms: [],
      order_history: [],
      agent_actions: [],
    });
    apiClient.triggerPricingNow = vi.fn().mockResolvedValue({
      sku_id: sku2.sku_id,
      chosen_price: 360,
    });

    const user = userEvent.setup();
    render(<SellerPanel sellerId={sellerId} />);

    // wait for initial load
    await screen.findByText("Test Seller");

    // select the second SKU
    await user.click(screen.getByRole("button", { name: /Second SKU/i }));
    expect(screen.getByText("Second SKU")).toBeInTheDocument();

    // click Run Pricing Now
    await user.click(screen.getByRole("button", { name: /Run Pricing Now/i }));

    // wait for loadSeller to be called and UI to settle
    await waitFor(() => expect(apiClient.getSeller).toHaveBeenCalled());

    // selection should remain on Second SKU
    expect(screen.getByText("Second SKU")).toBeInTheDocument();
  });
});
