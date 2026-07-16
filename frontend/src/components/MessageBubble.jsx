function formatTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}, ${hh}:${mm}`;
}

function parseSummary(summary) {
  if (!summary) return [];
  return summary.split("|").map((chunk) => {
    const [k, ...rest] = chunk.split(":");
    return { key: (k || "").trim(), value: rest.join(":").trim() };
  });
}

export default function MessageBubble({ message, showReasoning, relatedAction }) {
  const isSellerMessage = message.direction === "inbound";
  const isAgentMessage = message.direction === "outbound";
  const summary = relatedAction ? parseSummary(relatedAction.action_summary) : [];

  return (
    <div className={`flex ${isSellerMessage ? "justify-end" : "justify-start"} mb-2`}>
      <div className={`max-w-[85%] flex flex-col ${isSellerMessage ? "items-end" : "items-start"}`}>
        <div
          className={
            "px-3 py-2 rounded-2xl text-sm shadow-sm whitespace-pre-wrap break-words " +
            (isSellerMessage
              ? "rounded-br-sm text-gray-900"
              : "rounded-bl-sm bg-white text-gray-900")
          }
          style={isSellerMessage ? { backgroundColor: "#dcf8c6" } : undefined}
        >
          {message.message_body}
          <div className={`text-[10px] text-gray-500 mt-1 ${isSellerMessage ? "text-right" : "text-left"}`}>
            {formatTime(message.created_at)}
          </div>
        </div>

        {isAgentMessage && showReasoning && relatedAction && (
          <div className="mt-1 max-w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs">
            <div className="flex flex-wrap gap-1 mb-1">
              {summary.map((s, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700"
                >
                  {s.key}: {s.value}
                </span>
              ))}
            </div>
            <button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("open-reasoning", {
                    detail: { actionId: relatedAction.action_id },
                  }),
                );
              }}
              className="text-blue-600 hover:underline"
            >
              View full reasoning
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
