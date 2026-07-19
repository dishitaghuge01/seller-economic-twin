import { useCallback, useEffect, useState } from "react";
import { useLang, useT } from "../lib/i18n.jsx";

function normalizePhone(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  return trimmed;
}

function getApiBaseUrl() {
  return import.meta.env.VITE_API_URL || "http://localhost:8000";
}

export function LoginScreen({ onLoginSuccess }) {
  const { lang } = useLang();
  const t = useT();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [waLink, setWaLink] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [step, setStep] = useState("phone");
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");

  const resetToPhoneStep = useCallback(() => {
    setStep("phone");
    setLoading(false);
    setError("");
    setStatusMessage("");
    setWaLink("");
    setIsPolling(false);
    setPollFailureCount(0);
  }, []);

  const checkPairingStatus = useCallback(async (phoneValue = phone) => {
    const normalizedPhone = normalizePhone(phoneValue);
    if (!normalizedPhone) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/pairing-status?phone_number=${encodeURIComponent(normalizedPhone)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error("We couldn't check the confirmation status right now.");
      }

      if (data.status === "complete") {
        setIsPolling(false);
        setStatusMessage("");
        setError("");
        setPollFailureCount(0);
        onLoginSuccess?.(data.token);
        return;
      }

      if (data.status === "expired") {
        setIsPolling(false);
        setStep("expired");
        setStatusMessage("");
        setPollFailureCount(0);
        return;
      }

      setPollFailureCount(0);
      setStatusMessage(t("login.waiting"));
      window.setTimeout(() => {
        void checkPairingStatus(normalizedPhone);
      }, 3000);
    } catch (pollError) {
      const nextFailureCount = pollFailureCount + 1;
      setPollFailureCount(nextFailureCount);
      if (nextFailureCount >= 3) {
        setIsPolling(false);
        setError(pollError.message || "We couldn't confirm the login right now. Please try again.");
      } else {
        setError("We couldn't confirm the login right now. We'll keep trying for a moment.");
      }
    }
  }, [onLoginSuccess, phone, pollFailureCount, t]);

  useEffect(() => {
    if (!isPolling) return undefined;
    void checkPairingStatus(phone);
    return undefined;
  }, [checkPairingStatus, isPolling, phone]);

  const handleStartPairing = async (event) => {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      setError(t("login.phoneRequired"));
      return;
    }

    setLoading(true);
    setError("");
    setStatusMessage("");
    setWaLink("");
    setPollFailureCount(0);
    setStep("waiting");
    setIsPolling(true);
    setStatusMessage(t("login.waiting"));

    try {
      const payload = { phone_number: normalizedPhone };
      const trimmedName = name.trim();
      if (trimmedName) {
        payload.seller_name = trimmedName;
      }

      const response = await fetch(`${getApiBaseUrl()}/auth/start-pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error("We couldn't start the WhatsApp login flow. Please try again.");
      }

      setWaLink(data.wa_link || "");
    } catch (startError) {
      setError(startError.message || "We couldn't start the WhatsApp login flow. Please try again.");
      setIsPolling(false);
      setStep("phone");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setError("");
    setPollFailureCount(0);
    setIsPolling(true);
    await checkPairingStatus();
  };

  const handleDemoLogin = async () => {
    setDemoLoading(true);
    setDemoMessage("");
    setError("");

    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/demo-login`);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          setDemoMessage("Demo login is not available in this deployment.");
          return;
        }
        throw new Error(data.detail || "We couldn't start the demo login flow.");
      }

      onLoginSuccess?.(data.token);
    } catch (demoError) {
      setDemoMessage(demoError.message || "We couldn't start the demo login flow.");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className={`min-h-screen bg-background px-4 py-8 ${lang === "hi" ? "font-devanagari" : ""}`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 lg:flex-row lg:items-center">
        <div className="flex-1 rounded-3xl border border-border bg-card/80 p-8 shadow-sm backdrop-blur">
          <div className="inline-flex items-center gap-3 rounded-full border border-border bg-background/80 px-3 py-1.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-jamuni text-lg font-semibold text-primary-foreground">
              <span className="font-devanagari-display">उ</span>
            </div>
            <div>
              <p className="font-display text-xl text-foreground">उदय</p>
              <p className="text-sm text-muted-foreground">{t("login.tagline")}</p>
            </div>
          </div>
          <h1 className="mt-6 font-display text-3xl font-semibold text-foreground">{t("login.welcome")}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{t("login.subtitle")}</p>
          <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t("login.confirmTitle")}</p>
            <p className="mt-1">{t("login.confirmSub")}</p>
          </div>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground">{t("login.welcome")}</p>
            <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
          </div>

          {step === "phone" ? (
            <form className="space-y-4" onSubmit={handleStartPairing}>
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium text-foreground">
                  {t("login.nameLabel")}
                </label>
                <input
                  id="name"
                  type="text"
                  inputMode="text"
                  autoComplete="name"
                  placeholder={t("login.namePlaceholder")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-full border border-input bg-background px-4 py-3 text-sm outline-none focus:border-jamuni"
                />
              </div>

              <div>
                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-foreground">
                  {t("login.phoneLabel")}
                </label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876543210"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="w-full rounded-full border border-input bg-background px-4 py-3 text-sm outline-none focus:border-jamuni"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Use the full number, including the country code. A +91 prefix is shown as a helper for Indian numbers.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-jamuni px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? "Preparing WhatsApp…" : t("login.continue")}
              </button>

              <div className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-center">
                <p className="text-sm font-semibold text-foreground">{t("login.viewDemo")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  See a fully populated example seller account — no WhatsApp needed.
                </p>
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={demoLoading}
                  className="mt-3 w-full rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {demoLoading ? "Opening demo…" : "View Demo Dashboard"}
                </button>
                {demoMessage ? <p className="mt-2 text-xs text-muted-foreground">{demoMessage}</p> : null}
              </div>
            </form>
          ) : step === "waiting" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-full border border-border bg-background/70 px-4 py-3 text-sm text-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-jamuni border-t-transparent" />
                <span>{t("login.waiting")}</span>
              </div>
              {waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center rounded-full bg-whatsapp px-4 py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
                >
                  {t("login.openWa")}
                </a>
              ) : null}
              <p className="text-sm text-muted-foreground">
                We&apos;ve also sent a login link to your WhatsApp if you&apos;re already registered — otherwise, tap below to get started.
              </p>
              {error ? <div className="rounded-xl border border-urgent/20 bg-urgent-soft px-3 py-2 text-sm text-urgent">{error}</div> : null}
              {pollFailureCount >= 3 ? (
                <button type="button" onClick={handleRetry} className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                  {t("login.retry")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-watch/20 bg-watch-soft px-3 py-2 text-sm text-watch">
                This took too long — try again.
              </div>
              <button type="button" onClick={resetToPhoneStep} className="w-full rounded-full bg-jamuni px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90">
                Try again
              </button>
            </div>
          )}

          {(statusMessage || error) && step === "waiting" ? (
            <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? "border-urgent/20 bg-urgent-soft text-urgent" : "border-safe/20 bg-safe-soft text-safe"}`}>
              {error || statusMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
