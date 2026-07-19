import { useState } from "react";
import { useT } from "@/lib/i18n";


function timeOf(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

export function MessageBubble({ message, showReasoning, relatedAction }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const isInbound = message.direction === "inbound";

  return (
    <div className={`flex ${isInbound ? "justify-end" : "justify-start"} w-full`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${isInbound ? "bg-whatsapp-bubble text-ink" : "bg-card text-foreground"}`}
        style={isInbound ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }}>
        <div className="space-y-1.5">
          <p className="whitespace-pre-wrap leading-relaxed">{message.message_body}</p>
          <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            <span>{timeOf(message.created_at)}</span>
          </div>
          {showReasoning && !isInbound && relatedAction && (
            <div className="mt-2 space-y-1.5 border-t border-black/5 pt-2">
              <div className="flex flex-wrap gap-1">
                {(relatedAction.action_summary || "").split("|").map((chunk, i) => {
                  const [k, v] = chunk.split(":").map((s) => s?.trim());
                  if (!k || !v) return null;
                  return (
                    <span key={i} className="rounded-full bg-jamuni-soft px-2 py-0.5 text-[10px] font-medium text-jamuni-ink">
                      {k}: {v}
                    </span>
                  );
                })}
              </div>
              <button onClick={() => setExpanded((v) => !v)} className="text-[11px] font-medium text-jamuni underline-offset-2 hover:underline">
                {expanded ? t("wa.hide") : t("wa.viewReasoning")}
              </button>
              {expanded && (
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-ink/95 p-2 font-mono text-[10px] leading-snug text-paper">
                  {relatedAction.reasoning_trace}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
