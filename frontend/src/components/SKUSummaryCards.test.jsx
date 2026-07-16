import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SKUSummaryCards from "./SKUSummaryCards.jsx";

describe("SKUSummaryCards", () => {
  test("test_sku_summary_cards_renders", () => {
    render(
      <SKUSummaryCards
        skus={[
          {
            sku_id: "blue_kurti",
            sku_name: "Blue Floral Kurti",
            current_stock: 6,
            current_chosen_price: 410,
            last_action: { stockout_severity: "urgent" },
          },
          {
            sku_id: "cotton_palazzo",
            sku_name: "Cotton Palazzo Set",
            current_stock: 40,
            current_chosen_price: 550,
            last_action: { stockout_severity: "safe" },
          },
        ]}
        selectedSkuId={"blue_kurti"}
        onSelectSku={() => {}}
      />,
    );

    expect(screen.getByText("Blue Floral Kurti")).toBeInTheDocument();
    expect(screen.getByText("Cotton Palazzo Set")).toBeInTheDocument();
    expect(screen.getAllByText("URGENT")).toHaveLength(1);
    expect(screen.getAllByText("SAFE")).toHaveLength(1);
  });

  test("test_sku_card_click_selection", async () => {
    const user = userEvent.setup();
    const onSelectSku = vi.fn();

    render(
      <SKUSummaryCards
        skus={[
          {
            sku_id: "blue_kurti",
            sku_name: "Blue Floral Kurti",
            current_stock: 6,
            current_chosen_price: 410,
            last_action: { stockout_severity: "urgent" },
          },
          {
            sku_id: "cotton_palazzo",
            sku_name: "Cotton Palazzo Set",
            current_stock: 40,
            current_chosen_price: 550,
            last_action: { stockout_severity: "safe" },
          },
        ]}
        selectedSkuId={"blue_kurti"}
        onSelectSku={onSelectSku}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Cotton Palazzo Set/i }));
    expect(onSelectSku).toHaveBeenCalledWith("cotton_palazzo");
  });

  test("test_severity_chip_colours", () => {
    const { rerender } = render(
      <SKUSummaryCards
        skus={[
          {
            sku_id: "blue_kurti",
            sku_name: "Blue Floral Kurti",
            current_stock: 6,
            current_chosen_price: 410,
            last_action: { stockout_severity: "urgent" },
          },
        ]}
        selectedSkuId={"blue_kurti"}
        onSelectSku={() => {}}
      />,
    );

    expect(screen.getByText("URGENT")).toHaveClass("bg-red-100");

    rerender(
      <SKUSummaryCards
        skus={[
          {
            sku_id: "watch_sku",
            sku_name: "Watch SKU",
            current_stock: 12,
            current_chosen_price: 420,
            last_action: { stockout_severity: "watch" },
          },
        ]}
        selectedSkuId={"watch_sku"}
        onSelectSku={() => {}}
      />,
    );
    expect(screen.getByText("WATCH")).toHaveClass("bg-amber-100");

    rerender(
      <SKUSummaryCards
        skus={[
          {
            sku_id: "safe_sku",
            sku_name: "Safe SKU",
            current_stock: 30,
            current_chosen_price: 440,
            last_action: { stockout_severity: "safe" },
          },
        ]}
        selectedSkuId={"safe_sku"}
        onSelectSku={() => {}}
      />,
    );
    expect(screen.getByText("SAFE")).toHaveClass("bg-green-100");
  });
});
