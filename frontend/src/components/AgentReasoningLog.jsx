import { useState } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { useT } from "@/lib/i18n";


const sevBadge = {
  urgent: "bg-urgent-soft text-urgent",
  watch: "bg-watch-soft text-watch",
  safe: "bg-safe-soft text-safe",
};

function ActionEntry({ action }) {
  const t = useT();
  const [showTrace, setShowTrace] = useState(false);
  const chips = (action.action_summary || "").split("|").map((c) => c.trim()).filter(Boolean);
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-medium text-muted-foreground">{action.action_date}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
          {action.trigger === "scheduled" ? t("log.scheduled") : t("log.userQuery")}
        </span>
        <span className="rounded-full bg-jamuni-soft px-2 py-0.5 font-medium text-jamuni-ink">
          {t("log.tool")}: {action.tool_called}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${sevBadge[action.stockout_severity] || "bg-muted"}`}>
          {t(`sku.${action.stockout_severity}`)}
        </span>
      </div>

      <div className="mt-3 rounded-lg border-l-0 bg-jamuni-soft/50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-jamuni-ink/80">{t("log.sellerSaw")}</p>
        <p className="mt-1 text-sm font-devanagari leading-relaxed">{action.seller_message}</p>
      </div>

      <button onClick={() => setShowTrace((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-jamuni">
        {showTrace ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {t("log.showReasoning")}
      </button>


      {showTrace && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => {
              const [k, v] = c.split(":").map((s) => s?.trim());
              if (!k) return null;
              return (
                <span key={i} className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-mono">
                  {k}{v ? `: ${v}` : ""}
                </span>
              );
            })}
          </div>
          <pre className="max-h-56 overflow-auto rounded-lg bg-ink/95 p-3 font-mono text-[11px] leading-snug text-paper">
            {action.reasoning_trace}
          </pre>
        </div>
      )}
    </li>
  );
}

export function AgentReasoningLog({ agentActions, onUserMessage }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!q.trim() || sending) return;
    setSending(true);
    try { await onUserMessage(q.trim()); setQ(""); } finally { setSending(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(e);
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {(agentActions || []).map((a) => <ActionEntry key={a.action_id} action={a} />)}
        {(!agentActions || agentActions.length === 0) && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("log.empty")}
          </li>
        )}
      </ul>

      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-3">
        <label className="text-[11px] font-medium text-muted-foreground">{t("log.askUday")}</label>
        <div className="mt-1.5 flex items-end gap-2">
          <textarea
            value={q}
            onKeyDown={handleKeyDown}
            onChange={(e) => setQ(e.target.value)}
            rows={2}
            placeholder={t("log.askPlaceholder")}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-jamuni"
          />

          <button
            type="submit"
            disabled={sending || !q.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-jamuni text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
