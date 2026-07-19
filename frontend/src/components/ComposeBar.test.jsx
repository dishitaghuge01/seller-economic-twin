import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposeBar } from "./ComposeBar.jsx";

describe("ComposeBar", () => {
  test("test_compose_bar_send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<ComposeBar onSend={onSend} isLoading={false} />);

    const input = screen.getByPlaceholderText(/Type a message/i);
    await user.type(input, "Hello there");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("Hello there");
    expect(input).toHaveValue("");
  });

  test("test_compose_bar_loading_disables_input", () => {
    render(<ComposeBar onSend={() => {}} isLoading={true} />);

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i }).querySelector(".animate-spin")).toBeInTheDocument();
  });
});
