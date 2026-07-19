export function Wordmark({ size = "md", className = "" }) {
  const sizes = { sm: "text-2xl", md: "text-3xl", lg: "text-5xl", xl: "text-7xl" };
  return (
    <span
      className={`font-devanagari-display leading-none tracking-tight ${sizes[size]} ${className}`}
      style={{ color: "var(--aam)" }}
      aria-label="Uday"
    >
      उदय
    </span>
  );
}
