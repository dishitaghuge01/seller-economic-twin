export function TypingIndicator() {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-card px-3 py-2 shadow-sm">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
    </div>
  );
}
