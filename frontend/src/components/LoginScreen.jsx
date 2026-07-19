import { useEffect, useState } from "react";
import { Phone, MessageCircle, RotateCw } from "lucide-react";
import apiClient from "../apiClient.js";
import { Wordmark } from "./Wordmark.jsx";
import { LanguageToggle } from "./LanguageToggle.jsx";
import { useT, useLang } from "../lib/i18n.jsx";

function normalizePhone(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  return trimmed;
}

export default function LoginScreen({ onLoginSuccess }) {
  const t = useT();
  const { lang } = useLang();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [error, setError] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const resetToPhoneStep = () => {
    setStep(1);
    setPairing(null);
    setPollFailures(0);
    setError("");
    setLoading(false);
    setIsPolling(false);
  };

  useEffect(() => {
    if (step !== 2 || !isPolling) return undefined;

    const poll = async () => {
      try {
        const normalizedPhone = normalizePhone(phone);
        const response = await apiClient.getPairingStatus(normalizedPhone);
        if (response.status === "complete") {
          setIsPolling(false);
          setError("");
          setPollFailures(0);
          localStorage.setItem("seller_twin_token", response.token);
          onLoginSuccess?.(response.token);
          return;
        }

        if (response.status === "expired") {
          setIsPolling(false);
          setStep(3);
          setError("This took too long. Please try again.");
          setPollFailures(0);
          return;
        }

        setPollFailures((count) => count + 1);
        if (pollFailures >= 2) {
          setError("We couldn't confirm the login right now. We'll keep trying for a moment.");
        }
      } catch (pollError) {
        const nextFailures = pollFailures + 1;
        setPollFailures(nextFailures);
        if (nextFailures >= 3) {
          setIsPolling(false);
          setStep(3);
          setError(pollError.message || "We couldn't confirm the login right now. Please try again.");
        } else {
          setError("We couldn't confirm the login right now. We'll keep trying for a moment.");
        }
      }
    };

    const timer = window.setTimeout(() => {
      void poll();
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [isPolling, onLoginSuccess, phone, pollFailures, step]);

  const startPairing = async (event) => {
    event?.preventDefault();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      setError(t("login.phoneRequired"));
      return;
    }

    setError("");
    setLoading(true);
    setPollFailures(0);
    setStep(2);
    setIsPolling(true);
    setPairing({ wa_link: "", status: "pending" });

    try {
      const pairingResponse = await apiClient.startPairing({ phone: normalizedPhone, name: name.trim() || undefined });
      setPairing(pairingResponse || { wa_link: "", status: "pending" });
    } catch (startError) {
      setError(startError.message || "We couldn't start the WhatsApp login flow. Please try again.");
      setStep(1);
      setIsPolling(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setError("");
    setPollFailures(0);
    setIsPolling(true);
    setStep(2);
    try {
      const normalizedPhone = normalizePhone(phone);
      const pairingResponse = await apiClient.startPairing({ phone: normalizedPhone, name: name.trim() || undefined });
      setPairing(pairingResponse);
    } catch (retryError) {
      setError(retryError.message || "We couldn't start the WhatsApp login flow. Please try again.");
      setStep(3);
      setIsPolling(false);
    }
  };

  const demoLogin = async () => {
    setDemoLoading(true);
    setDemoMessage("");
    setError("");

    try {
      const response = await apiClient.demoLogin();
      onLoginSuccess?.(response.token);
    } catch (demoError) {
      setDemoMessage(demoError.message || "We couldn't start the demo login flow.");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className={`bazaar-texture flex min-h-screen items-center justify-center px-4 py-10 ${lang === "hi" ? "font-devanagari" : ""}`}>
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageToggle />
        </div>
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark size="xl" />
          <p className="mt-3 font-display text-sm italic text-muted-foreground">{t("login.tagline")}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {step === 1 && (
            <form onSubmit={startPairing} className="space-y-4">
              <div>
                <h1 className="font-display text-2xl font-semibold">{t("login.welcome")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
              </div>

              <label className="block space-y-1.5" htmlFor="login-phone">
                <span className="text-xs font-medium">{t("login.phoneLabel")}</span>
                <div className="flex items-center rounded-lg border border-input bg-background px-3 focus-within:border-jamuni">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <input
                    id="login-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98xxxxxxxx"
                    className="w-full bg-transparent px-2 py-2.5 text-sm outline-none tabular-nums"
                  />
                </div>
              </label>

              <label className="block space-y-1.5" htmlFor="login-name">
                <span className="text-xs font-medium">
                  {t("login.nameLabel")} <span className="text-muted-foreground">{t("login.optional")}</span>
                </span>
                <input
                  id="login-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("login.namePlaceholder")}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-jamuni"
                />
              </label>

              {error && <p className="text-xs text-urgent">{error}</p>}

              <button type="submit" className="w-full rounded-lg bg-jamuni px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                {loading ? t("login.continue") : t("login.continue")}
              </button>
            </form>
          )}

          {step === 2 && pairing && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-safe-soft">
                <MessageCircle className="h-6 w-6 text-safe" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">{t("login.confirmTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("login.confirmSub")}</p>
              </div>

              {pairing.wa_link?.trim() ? (
                <a href={pairing.wa_link} target="_blank" rel="noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
                  <MessageCircle className="h-4 w-4" /> {t("login.openWa")}
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-whatsapp/70 px-4 py-2.5 text-sm font-semibold text-white/90 opacity-80"
                >
                  <MessageCircle className="h-4 w-4" /> {t("login.openWa")}
                </button>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jamuni" />
                {t("login.waiting")}
              </div>

              {pollFailures >= 3 && (
                <button onClick={handleRetry} className="inline-flex items-center gap-1.5 text-xs font-medium text-jamuni">
                  <RotateCw className="h-3.5 w-3.5" /> Try again
                </button>
              )}

              {error && <p className="text-xs text-urgent">{error}</p>}

              <button onClick={resetToPhoneStep} className="text-xs text-muted-foreground hover:text-foreground">
                {t("login.diffNumber")}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-urgent-soft">
                <Phone className="h-6 w-6 text-urgent" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">{t("login.confirmTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{error || "This took too long — try again."}</p>
              </div>
              <button onClick={handleRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground">
                <RotateCw className="h-4 w-4" /> Try again
              </button>
              <button onClick={resetToPhoneStep} className="text-xs text-muted-foreground hover:text-foreground">
                {t("login.diffNumber")}
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-jamuni/40 bg-jamuni-soft/40 p-4 text-center">
          <p className="text-xs text-jamuni-ink">{t("login.exploring")}</p>
          <button onClick={demoLogin} className="mt-1 text-sm font-semibold text-jamuni underline-offset-2 hover:underline">
            {t("login.viewDemo")}
          </button>
          {demoMessage && <p className="mt-2 text-xs text-urgent">{demoMessage}</p>}
          {demoLoading && <p className="mt-2 text-xs text-muted-foreground">Opening demo…</p>}
        </div>
      </div>
    </div>
  );
}
