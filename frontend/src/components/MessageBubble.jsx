import { useT } from "@/lib/i18n";

function timeOf(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

export function MessageBubble({ message, relatedAction }) {
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
        </div>
      </div>
    </div>
  );
}
