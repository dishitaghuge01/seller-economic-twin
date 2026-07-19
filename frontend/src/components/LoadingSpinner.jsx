import { useEffect, useState } from "react";

export function LoadingSpinner({ messages = ["Loading"], heightClass = "h-48" }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % messages.length), 1400);
    return () => clearInterval(t);
  }, [messages.length]);
  return (
    <div className={`flex ${heightClass} items-center justify-center`}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-jamuni border-t-transparent" />
        <p className="text-sm text-muted-foreground">{messages[i]}</p>
      </div>
    </div>
  );
}
