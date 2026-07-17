import { useEffect, useRef, useState } from "react";

const PLACEHOLDERS = ["Type a message...", "Ask your agent..."];

export default function ComposeBar({ onSend, isLoading }) {
  const [text, setText] = useState("");
  const [phIdx, setPhIdx] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      submittingRef.current = false;
    }
  }, [isLoading]);

  const submit = () => {
    const t = text.trim();
    if (!t || isLoading || submittingRef.current) return;
    submittingRef.current = true;
    onSend(t);
    setText("");
  };

  return (
    <div
      className="flex-none bg-gray-100 border-t border-gray-200 p-2 flex items-center gap-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <input
        type="text"
        value={text}
        disabled={isLoading}
        placeholder={PLACEHOLDERS[phIdx]}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="flex-1 rounded-full bg-white border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 disabled:opacity-60"
      />
      <button
        onClick={submit}
        disabled={isLoading || !text.trim()}
        className="h-10 w-10 rounded-full bg-green-600 text-white flex items-center justify-center disabled:opacity-50"
        aria-label="Send"
      >
        {isLoading ? (
          <span className="h-4 w-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
