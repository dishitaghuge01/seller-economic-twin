import { useEffect } from "react";
import { X } from "lucide-react";

export function WhatsAppToast({ message, senderName, onDismiss, onClick }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="toast-slide-in fixed right-4 top-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] sm:right-6 sm:top-6">

      <button
        onClick={onClick}
        className="w-full rounded-xl bg-card p-3 text-left shadow-lg ring-1 ring-border transition hover:ring-jamuni"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-whatsapp text-white">
            <span className="text-lg">📱</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{senderName}</p>
              <span
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
      </button>
    </div>
  );
}
