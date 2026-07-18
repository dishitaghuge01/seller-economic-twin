import { useEffect, useState } from "react";

export default function WhatsAppToast({ message, senderName, onDismiss, onClick }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDismiss?.();
    }, 5000);

    const visibleTimer = window.setTimeout(() => setIsVisible(true), 10);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(visibleTimer);
    };
  }, [onDismiss]);

  const preview = message?.trim?.() || "New WhatsApp notification";
  const initial = (senderName || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="fixed right-4 top-4 z-50">
      <div
        className={`flex max-w-sm items-start gap-3 rounded-2xl border border-green-200 bg-white px-4 py-3 text-left shadow-lg shadow-green-900/10 transition-all duration-200 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-[-8px] opacity-0"}`}
      >
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-semibold text-white">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">{senderName}</div>
            <div className="mt-1 line-clamp-2 text-sm text-gray-600">{preview}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
