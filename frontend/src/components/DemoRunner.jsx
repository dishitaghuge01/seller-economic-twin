import { useEffect, useRef, useState } from "react";
import apiClient from "../apiClient.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildLogLine(stepResponse) {
  const shockSku = stepResponse?.shock_sku;
  const depletionSku = stepResponse?.depletion_sku;
  const targetName = shockSku?.sku_name || depletionSku?.sku_name || "Demo SKU";
  const severity = shockSku?.stockout_severity || depletionSku?.stockout_severity;
  const sentNotification = stepResponse?.notifications?.find((n) => n.sent);

  if (stepResponse?.shock_event_triggered_today) {
    return `Day ${stepResponse.day}: ${targetName} demand dropped — market shift detected`;
  }

  if (sentNotification) {
    const matchingSku =
      sentNotification.sku_id === shockSku?.sku_id
        ? shockSku
        : sentNotification.sku_id === depletionSku?.sku_id
          ? depletionSku
          : null;
    const skuName = matchingSku?.sku_name || targetName;
    return `Day ${stepResponse.day}: ${skuName} alert triggered — WhatsApp notification sent`;
  }

  if (severity === "urgent") {
    return `Day ${stepResponse.day}: ${targetName} stock critical — no notification needed`;
  }

  if (severity === "watch") {
    return `Day ${stepResponse.day}: ${targetName} stock under watch — no notification needed`;
  }

  return `Day ${stepResponse.day}: ${targetName} price held — no notification needed`;
}

export default function DemoRunner({ sellerId, isDemoSeller, onStepCompleted, onNotificationSent, onReset }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [currentDay, setCurrentDay] = useState(0);
  const [maxDays, setMaxDays] = useState(6);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const stopRequestedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      if (isMountedRef.current) {
        setToast("");
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!sellerId || !isDemoSeller) return;
    let cancelled = false;
    const hydrateStatus = async () => {
      try {
        const res = await apiClient.getDemoStatus(sellerId);
        if (cancelled || !isMountedRef.current) return;
        if (res?.status === "running" && res.current_day != null) {
          const nextDay = Number(res.current_day || 0);
          const limit = Number(res.max_days || 6);
          setCurrentDay(nextDay);
          setMaxDays(limit);
          if (nextDay >= limit) {
            setStatus("Demo complete");
            setIsComplete(true);
          } else {
            setStatus(`Resuming from day ${nextDay + 1}`);
            void runDemo(nextDay);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load demo status.");
        }
      }
    };

    void hydrateStatus();
    return () => {
      cancelled = true;
    };
  }, [sellerId, isDemoSeller]);

  const handleReset = async () => {
    stopRequestedRef.current = true;
    setIsRunning(false);
    setIsConfirming(false);
    setLogs([]);
    setCurrentDay(0);
    setIsComplete(false);
    setStatus("Demo reset");
    setError("");
    try {
      await apiClient.resetDemo(sellerId);
      if (!isMountedRef.current) return;
      await onReset?.();
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err.message || "Unable to reset demo.");
    }
  };

  const runDemo = async (resumeFromDay = 0) => {
    if (!sellerId) return;
    stopRequestedRef.current = false;
    setIsRunning(true);
    setIsConfirming(false);
    setError("");
    setLogs([]);
    setIsComplete(false);
    setStatus("Preparing demo...");

    try {
      let currentValue = resumeFromDay;
      let activeMaxDays = maxDays;

      if (resumeFromDay <= 0) {
        await apiClient.resetDemo(sellerId);
        const startResponse = await apiClient.startDemo(sellerId);
        activeMaxDays = Number(startResponse?.max_days || 6);
        setMaxDays(activeMaxDays);
        setCurrentDay(Number(startResponse?.current_day || 0));
      } else {
        activeMaxDays = Number(maxDays || 6);
      }

      while (!stopRequestedRef.current) {
        const nextDay = currentValue + 1;
        if (!isMountedRef.current) return;
        setCurrentDay(nextDay);
        setStatus(`Day ${nextDay} of ${activeMaxDays} — simulating...`);

        const stepResponse = await apiClient.stepDemo(sellerId);
        if (!isMountedRef.current) return;
        const line = buildLogLine(stepResponse);
        setLogs((prev) => [...prev, line]);

        if (stepResponse?.notifications?.some((n) => n.sent)) {
          setToast("📱 WhatsApp alert sent — check the WhatsApp Thread tab.");
          onNotificationSent?.();
        }

        void onStepCompleted?.(stepResponse);

        currentValue = Number(stepResponse?.day || nextDay);
        if (currentValue >= activeMaxDays) {
          if (!isMountedRef.current) return;
          setIsComplete(true);
          setStatus("Demo complete");
          break;
        }

        if (stopRequestedRef.current) {
          if (!isMountedRef.current) return;
          setStatus("Demo stopped");
          break;
        }

        await delay(1200);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err.message || "Demo failed.");
      setStatus("Demo failed");
    } finally {
      if (isMountedRef.current) {
        setIsRunning(false);
      }
    }
  };

  if (!isDemoSeller) return null;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-indigo-700">Run Demo</div>
          <p className="mt-1 text-sm text-gray-600">
            Replay the demo seller’s week and watch the charts evolve day by day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isRunning && !isComplete && !isConfirming && (
            <button
              onClick={() => setIsConfirming(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Run Demo
            </button>
          )}
          {isRunning && (
            <button
              onClick={() => {
                stopRequestedRef.current = true;
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleReset}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset Demo
          </button>
        </div>
      </div>

      {isConfirming && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-white/80 p-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            This will reset and replay the demo seller’s data for the current session.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Any manual changes made during this session will be overwritten.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => runDemo(0)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Start demo replay
            </button>
            <button
              onClick={() => setIsConfirming(false)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(isRunning || status !== "Idle") && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white/80 p-3">
          <div className="flex items-center justify-between text-sm text-gray-700">
            <span className="font-medium">{status}</span>
            <span className="text-xs text-gray-500">Day {currentDay} of {maxDays}</span>
          </div>
          {isRunning && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full animate-pulse rounded-full bg-indigo-500" style={{ width: `${Math.min(100, (currentDay / Math.max(maxDays, 1)) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {toast}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white/80 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Demo log</div>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {logs.map((line, index) => (
              <li key={`${line}-${index}`}>
                • {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isComplete && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          Demo complete
        </div>
      )}
    </div>
  );
}
