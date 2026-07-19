import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../apiClient.js";
import { MessageBubble } from "./MessageBubble.jsx";
import { ComposeBar } from "./ComposeBar.jsx";
import { TypingIndicator } from "./TypingIndicator.jsx";
import { LoadingSpinner } from "./LoadingSpinner.jsx";
import { useT } from "../lib/i18n.jsx";

export default function WhatsAppPanel({ sellerId }) {
  const t = useT();
  const [messages, setMessages] = useState([]);
  const [showReasoning, setShowReasoning] = useState(false);
  const [sending, setSending] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [actionsBySummary, setActionsBySummary] = useState({});
  const initialLoadRef = useRef(true);
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [conversationsResponse, sellerResponse] = await Promise.all([
        apiClient.getConversations(sellerId),
        apiClient.getSeller(sellerId),
      ]);

      const map = {};
      for (const sku of sellerResponse?.skus || []) {
        const history = await apiClient.getSkuHistory(sellerId, sku.sku_id);
        for (const action of history?.agent_actions || []) {
          if (action?.seller_message) {
            map[action.seller_message] = action;
          }
        }
      }
      setActionsBySummary(map);

      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        setInitialLoading(false);
      }

      setMessages((prev) => {
        const ids = new Set((conversationsResponse?.messages || []).map((m) => m.message_id));
        const extras = prev.filter((m) => !ids.has(m.message_id));
        return [...(conversationsResponse?.messages || []), ...extras];
      });
    } catch (error) {
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        setInitialLoading(false);
      }
    }
  }, [sellerId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  const handleSend = async (text) => {
    if (sending) return;
    const inbound = {
      message_id: `local_${Date.now()}`,
      direction: "inbound",
      message_body: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, inbound]);
    setSending(true);
    try {
      const res = await apiClient.postMessage(sellerId, text);
      const outbound = {
        message_id: `local_out_${Date.now()}`,
        direction: "outbound",
        message_body: res.response_text,
        created_at: new Date().toISOString(),
        _related_action: {
          action_id: `act_local_${Date.now()}`,
          action_summary: res.action_summary,
          reasoning_trace: res.reasoning_trace,
        },
      };
      setMessages((m) => [...m, outbound]);
      setActionsBySummary((prev) => ({
        ...prev,
        [res.response_text]: {
          action_id: `live_${Date.now()}`,
          action_summary: res.action_summary,
          reasoning_trace: res.reasoning_trace,
        },
      }));
    } finally {
      setSending(false);
    }
  };

  if (initialLoading) {
    return <LoadingSpinner messages={[t("wa.loading")]} heightClass="h-[70vh]" />;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-64px)] max-w-2xl flex-col overflow-hidden border-x border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-whatsapp px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
            <span className="font-devanagari-display text-lg" style={{ color: "var(--aam)" }}>उ</span>
          </div>
          <div>
            <p className="text-sm font-semibold">
              <span className="font-devanagari-display" style={{ color: "var(--aam)" }}>उदय</span>{" "}
              <span className="text-white/90">{t("wa.agentSuffix")}</span>
            </p>
            <p className="text-[11px] text-white/70">{t("wa.online")}</p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={showReasoning} onChange={(e) => setShowReasoning(e.target.checked)} className="accent-white" />
          {t("wa.showReasoning")}
        </label>
      </div>

      <div ref={scrollRef} className="whatsapp-wallpaper flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.message_id}
            message={m}
            showReasoning={showReasoning}
            relatedAction={actionsBySummary[m.message_body]}
          />
        ))}
        {sending && (
          <div className="pl-1">
            <TypingIndicator />
          </div>
        )}
      </div>

      <ComposeBar onSend={handleSend} isLoading={sending} />
    </div>
  );
}
