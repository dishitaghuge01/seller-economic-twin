import { useLang } from "@/lib/i18n";

export function LanguageToggle({ className = "" }) {
  const { lang, setLang, t } = useLang();
  return (
    <div
      role="group"
      aria-label={t("lang.toggleAria")}
      className={`inline-flex items-center rounded-full border border-border bg-background p-0.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => setLang("hi")}
        aria-pressed={lang === "hi"}
        className={`rounded-full px-2 py-1 text-[11px] font-semibold transition font-devanagari ${
          lang === "hi" ? "bg-jamuni text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        हिं
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
          lang === "en" ? "bg-jamuni text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        EN
      </button>
    </div>
  );
}
