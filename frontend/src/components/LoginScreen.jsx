import { useState } from "react";
import supabase from "../supabaseClient.js";

function normalizePhone(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  return trimmed;
}

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSendCode = async (event) => {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      setError("Enter a phone number to receive the code.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });

      if (authError) throw authError;

      setMessage("We sent a one-time code to your phone. Enter it below.");
      setStep(2);
    } catch (authError) {
      setError(authError.message || "We could not send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      setError("Enter the phone number again before verifying.");
      return;
    }

    if (!otp.trim()) {
      setError("Enter the 6-digit code from the SMS.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const { error: authError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: otp.trim(),
        type: "sms",
      });

      if (authError) throw authError;

      setMessage("Signed in successfully.");
    } catch (authError) {
      setError(authError.message || "The code was invalid or expired. Please retry.");
    } finally {
      setLoading(false);
    }
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
            <p className="text-sm text-gray-500">Secure sign-in with SMS</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          Enter your phone number to receive a one-time code. This is the same
          number used by your seller account.
        </p>

        {step === 1 ? (
          <form className="space-y-4" onSubmit={handleSendCode}>
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
              {loading ? "Sending code..." : "Send code"}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleVerifyCode}>
            <div>
              <label htmlFor="otp" className="mb-1 block text-sm font-medium text-gray-700">
                One-time code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                className="w-full rounded-full border border-gray-300 px-4 py-3 text-center text-sm font-semibold tracking-[0.35em] outline-none focus:border-gray-900"
              />
              <p className="mt-2 text-xs text-gray-500">
                Enter the 6-digit code sent to {normalizePhone(phone) || "your phone"}.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep(1);
                setOtp("");
                setMessage("");
                setError("");
              }}
              className="w-full rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Change phone number
            </button>
          </form>
        )}

        {(error || message) && (
          <div
            className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {error || message}
          </div>
        )}
      </div>
    </div>
  );
}
