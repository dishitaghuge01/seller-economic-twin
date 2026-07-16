import { render, screen } from "@testing-library/react";
import MessageBubble from "./MessageBubble.jsx";

describe("MessageBubble", () => {
  test("test_outbound_message_left_aligned", () => {
    render(
      <MessageBubble
        message={{ direction: "outbound", message_body: "Agent message", created_at: "2024-07-14T08:00:00" }}
        showReasoning={false}
        relatedAction={null}
      />,
    );

    const wrapper = screen.getByText("Agent message").closest("div")?.parentElement?.parentElement;
    expect(wrapper).toHaveClass("justify-start");
  });

  test("test_inbound_message_right_aligned", () => {
    render(
      <MessageBubble
        message={{ direction: "inbound", message_body: "Seller message", created_at: "2024-07-14T08:00:00" }}
        showReasoning={false}
        relatedAction={null}
      />,
    );

    const wrapper = screen.getByText("Seller message").closest("div")?.parentElement?.parentElement;
    expect(wrapper).toHaveClass("justify-end");
  });
});
