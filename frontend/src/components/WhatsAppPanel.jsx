import { useEffect, useRef, useState } from "react";
import apiClient from "../apiClient.js";
import MessageBubble from "./MessageBubble.jsx";
import ComposeBar from "./ComposeBar.jsx";

export default function WhatsAppPanel({ sellerId }) {
  const [messages, setMessages] = useState([]);
  const [showReasoning, setShowReasoning] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiClient.getConversations(sellerId).then((d) => {
        if (cancelled) return;
        setMessages((prev) => {
          // merge, keep any optimistic messages not yet on server
          const ids = new Set(d.messages.map((m) => m.message_id));
          const extras = prev.filter((m) => !ids.has(m.message_id));
          return [...d.messages, ...extras];
        });
      });
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sellerId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (text) => {
    const now = new Date().toISOString();
    const inbound = {
      message_id: `local_${Date.now()}`,
      direction: "inbound",
      message_body: text,
      created_at: now,
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
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[calc(100vh-140px)]">
      <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center font-semibold">
          A
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Seller Economic Twin Agent</div>
          <div className="text-xs opacity-90 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-300 inline-block" />
            Online
          </div>
        </div>
        <label className="text-xs flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={showReasoning}
            onChange={(e) => setShowReasoning(e.target.checked)}
          />
          Show reasoning
        </label>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{
          backgroundColor: "#efeae2",
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.03) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {messages.map((m) => (
          <MessageBubble
            key={m.message_id}
            message={m}
            showReasoning={showReasoning}
            relatedAction={m._related_action}
          />
        ))}
      </div>

      <ComposeBar onSend={handleSend} isLoading={sending} />
    </div>
  );
}
