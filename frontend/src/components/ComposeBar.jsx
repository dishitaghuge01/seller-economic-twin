import { useState } from "react";
import { Send } from "lucide-react";
import { useT } from "@/lib/i18n";

export function ComposeBar({ onSend, isLoading }) {
  const t = useT();
  const [value, setValue] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-card px-3 py-3">
      <input
        type="text"
        value={value}
        disabled={isLoading}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("wa.composePlaceholder")}
        className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-jamuni disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={isLoading || !value.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-whatsapp text-white transition hover:opacity-90 disabled:opacity-40"
        aria-label={t("wa.send")}
      >
        {isLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </form>
  );
}
