import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDrawer } from "./SettingsDrawer.jsx";
import apiClient from "../apiClient.js";

describe("SettingsDrawer", () => {
  test("test_settings_drawer_validation", async () => {
    const user = userEvent.setup();

    render(
      <SettingsDrawer
        sellerId="riya_sharma"
        skuIds={["blue_kurti"]}
        isOpen={true}
        onClose={() => {}}
      />,
    );

    const floorInput = screen.getByDisplayValue("370");
    const ceilingInput = screen.getByDisplayValue("490");

    await user.clear(floorInput);
    await user.type(floorInput, "500");
    await user.clear(ceilingInput);
    await user.type(ceilingInput, "400");

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText(/Ceiling must be greater than floor/i)).toBeInTheDocument();
  });

  test("test_settings_drawer_shows_sku_name", async () => {
    render(
      <SettingsDrawer
        sellerId="riya_sharma"
        skuId="blue_kurti"
        skuName="Blue Kurti"
        isOpen={true}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/Editing price range for:/i)).toBeInTheDocument();
    expect(screen.getByText(/Blue Kurti/i)).toBeInTheDocument();
  });

  test("test_settings_drawer_save", async () => {
    const user = userEvent.setup();

    render(
      <SettingsDrawer
        sellerId="riya_sharma"
        skuId="blue_kurti"
        skuName="Blue Kurti"
        isOpen={true}
        onClose={() => {}}
      />,
    );

    const timeInput = screen.getByDisplayValue("09:00");
    await user.clear(timeInput);
    await user.type(timeInput, "10:30");

    const spy = vi.spyOn(apiClient, "updateSettings").mockResolvedValue({ arms_recomputed: true, new_arm_count: 5 });

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(spy).toHaveBeenCalledWith(
      "riya_sharma",
      expect.objectContaining({ sku_id: "blue_kurti", daily_alert_time: "10:30" }),
    );
    spy.mockRestore();
  });
});
