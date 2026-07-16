import { useCallback, useEffect, useState } from "react";

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

export default function LoginScreen({ onLoginSuccess }) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [waLink, setWaLink] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [step, setStep] = useState("phone");

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
    console.log("checkPairingStatus", phoneValue, isPolling);
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
      setStatusMessage("Waiting for confirmation on WhatsApp…");
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
  }, [onLoginSuccess, phone, pollFailureCount]);

  useEffect(() => {
    if (!isPolling) return undefined;

    void checkPairingStatus(phone);
    return undefined;
  }, [checkPairingStatus, isPolling, phone]);

  const handleStartPairing = async (event) => {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      setError("Enter a phone number to continue.");
      return;
    }

    setLoading(true);
    setError("");
    setStatusMessage("");
    setWaLink("");
    setPollFailureCount(0);
    setStep("waiting");
    setIsPolling(true);
    setStatusMessage("Waiting for confirmation on WhatsApp…");

    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/start-pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: normalizedPhone }),
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
            S
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">Seller Economic Twin</p>
            <p className="text-sm text-gray-500">Sign in with WhatsApp</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          Enter your phone number and we’ll open the WhatsApp flow for you.
        </p>

        {step === "phone" ? (
          <form className="space-y-4" onSubmit={handleStartPairing}>
            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+919876543210"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="w-full rounded-full border border-gray-300 px-4 py-3 text-sm outline-none ring-0 focus:border-gray-900"
              />
              <p className="mt-2 text-xs text-gray-500">
                Use the full number, including the country code. A +91 prefix is shown as a helper for Indian numbers.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Preparing WhatsApp…" : "Continue"}
            </button>
          </form>
        ) : step === "waiting" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-full border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
              <span>Waiting for confirmation on WhatsApp…</span>
            </div>
            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center rounded-full bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
              >
                Confirm on WhatsApp
              </a>
            ) : null}
            <p className="text-sm text-gray-600">
              We&apos;ve also sent a login link to your WhatsApp if you&apos;re already registered — otherwise, tap below to get started.
            </p>
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {pollFailureCount >= 3 ? (
              <button
                type="button"
                onClick={handleRetry}
                className="w-full rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              This took too long — try again.
            </div>
            <button
              type="button"
              onClick={resetToPhoneStep}
              className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        )}

        {(statusMessage || error) && step === "waiting" ? (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
            {error || statusMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
