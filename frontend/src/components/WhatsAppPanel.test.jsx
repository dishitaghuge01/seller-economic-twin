import { render, screen, waitFor } from "@testing-library/react";
import WhatsAppPanel from "./WhatsAppPanel.jsx";

describe("WhatsAppPanel", () => {
  test("test_whatsapp_panel_renders_messages", async () => {
    render(<WhatsAppPanel sellerId="riya_sharma" />);

    await waitFor(() => {
      expect(screen.getByText(/Riya ji, aapke Blue Floral Kurti/i)).toBeInTheDocument();
      expect(screen.getByText(/itni jaldi kyun/i)).toBeInTheDocument();
      expect(screen.getByText(/Pichle 14 dino mein/i)).toBeInTheDocument();
    });
  });
});
