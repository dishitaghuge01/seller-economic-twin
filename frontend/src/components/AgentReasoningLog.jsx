import { useState } from "react";

const severityConfig = {
  urgent: { bg: "bg-red-100", text: "text-red-700", label: "URGENT" },
  watch: { bg: "bg-amber-100", text: "text-amber-700", label: "WATCH" },
  safe: { bg: "bg-green-100", text: "text-green-700", label: "SAFE" },
};

function confidenceColor(v) {
  const s = (v || "").toLowerCase();
  if (s.includes("high")) return "bg-green-100 text-green-700";
  if (s.includes("medium")) return "bg-amber-100 text-amber-700";
  if (s.includes("low")) return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

function parseSummary(summary) {
  if (!summary) return [];
  return summary.split("|").map((chunk) => {
    const [k, ...rest] = chunk.split(":");
    return { key: (k || "").trim(), value: rest.join(":").trim() };
  });
}

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const sev = severityConfig[entry.stockout_severity] || severityConfig.safe;
  const summary = parseSummary(entry.action_summary);
  const triggerBadge =
    entry.trigger === "user_message"
      ? { cls: "bg-blue-100 text-blue-700", label: "User query" }
      : { cls: "bg-gray-100 text-gray-700", label: "Scheduled" };

  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">{entry.action_date || entry.created_at?.slice(0, 10)}</span>
        <span className={`px-2 py-0.5 rounded-full font-medium ${triggerBadge.cls}`}>
          {triggerBadge.label}
        </span>
        {entry.tool_called && (
          <span className="px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
            {entry.tool_called}
          </span>
        )}
        <span className={`px-2 py-0.5 rounded-full font-semibold ${sev.bg} ${sev.text}`}>
          {sev.label}
        </span>
      </div>

      <div className="mt-2 rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-800">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
          What the seller saw
        </div>
        {entry.seller_message}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs text-blue-600 hover:underline"
      >
        {open ? "Hide reasoning" : "Show reasoning"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <pre className="whitespace-pre-wrap text-[11px] font-mono bg-gray-900 text-gray-100 rounded p-2">
            {entry.reasoning_trace}
          </pre>
          {summary.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summary.map((s, i) => {
                const cls =
                  s.key === "ACTION"
                    ? "bg-gray-200 text-gray-800"
                    : s.key === "REASON"
                      ? "bg-blue-100 text-blue-700"
                      : s.key === "CONFIDENCE"
                        ? confidenceColor(s.value)
                        : "bg-gray-100 text-gray-700";
                return (
                  <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full ${cls}`}>
                    {s.key}: {s.value}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentReasoningLog({ agentActions, onUserMessage }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const sorted = [...agentActions].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );

  const handleSend = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onUserMessage(t);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 mb-3">Agent Reasoning Log</h3>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {sorted.map((e) => (
          <LogEntry key={e.action_id} entry={e} />
        ))}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <label className="text-xs text-gray-500 block mb-1">
          Ask the agent a question
        </label>
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="e.g. Why did you keep the price at ₹410?"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
