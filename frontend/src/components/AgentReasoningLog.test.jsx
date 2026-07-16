import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentReasoningLog from "./AgentReasoningLog.jsx";

describe("AgentReasoningLog", () => {
  test("test_reasoning_log_entries", () => {
    render(
      <AgentReasoningLog
        agentActions={[
          {
            action_id: "act_001",
            action_date: "2024-07-14",
            seller_message: "Stock is low",
            reasoning_trace: "Detailed reasoning",
            action_summary: "ACTION: Restock | REASON: Demand spike",
            stockout_severity: "urgent",
            trigger: "scheduled",
            tool_called: "both",
            created_at: "2024-07-14T08:00:12",
          },
        ]}
        onUserMessage={() => {}}
      />,
    );

    expect(screen.getByText("2024-07-14")).toBeInTheDocument();
    expect(screen.getByText("Stock is low")).toBeInTheDocument();
    expect(screen.queryByText("Detailed reasoning")).not.toBeInTheDocument();
  });

  test("test_reasoning_trace_toggle", async () => {
    const user = userEvent.setup();
    render(
      <AgentReasoningLog
        agentActions={[
          {
            action_id: "act_001",
            action_date: "2024-07-14",
            seller_message: "Stock is low",
            reasoning_trace: "Detailed reasoning",
            action_summary: "ACTION: Restock | REASON: Demand spike",
            stockout_severity: "urgent",
            trigger: "scheduled",
            tool_called: "both",
            created_at: "2024-07-14T08:00:12",
          },
        ]}
        onUserMessage={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show reasoning/i }));
    expect(screen.getByText("Detailed reasoning")).toBeInTheDocument();
  });

  test("test_user_message_submit", async () => {
    const user = userEvent.setup();
    const onUserMessage = vi.fn();

    render(
      <AgentReasoningLog
        agentActions={[]}
        onUserMessage={onUserMessage}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Why is this urgent?");
    await user.keyboard("{Enter}");

    expect(onUserMessage).toHaveBeenCalledWith("Why is this urgent?");
  });
});
