import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, StopCircle } from "lucide-react";
import apiClient from "../apiClient.js";
import { useT } from "../lib/i18n.jsx";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildLogLine(stepResponse, t) {
  const shockSku = stepResponse?.shock_sku;
  const depletionSku = stepResponse?.depletion_sku;
  const targetName = shockSku?.sku_name || depletionSku?.sku_name || t("demo.defaultSku");
  const severity = shockSku?.stockout_severity || depletionSku?.stockout_severity;
  const sentNotification = stepResponse?.notifications?.find((n) => n.sent);

  if (stepResponse?.shock_event_triggered_today) {
    return `${t("demo.logDay", { day: stepResponse.day })} ${targetName} ${t("demo.logShock")}`;
  }

  if (sentNotification) {
    const matchingSku =
      sentNotification.sku_id === shockSku?.sku_id
        ? shockSku
        : sentNotification.sku_id === depletionSku?.sku_id
          ? depletionSku
          : null;
    const skuName = matchingSku?.sku_name || targetName;
    return `${t("demo.logDay", { day: stepResponse.day })} ${skuName} ${t("demo.logAlertSent")}`;
  }

  if (severity === "urgent") {
    return `${t("demo.logDay", { day: stepResponse.day })} ${targetName} ${t("demo.logCritical")}`;
  }

  if (severity === "watch") {
    return `${t("demo.logDay", { day: stepResponse.day })} ${targetName} ${t("demo.logWatch")}`;
  }

  return `${t("demo.logDay", { day: stepResponse.day })} ${targetName} ${t("demo.logPriceHeld")}`;
}

export function DemoRunner({ sellerId, isDemoSeller, onStepCompleted, onNotificationSent, onReset }) {
  const t = useT();
  const [isConfirming, setIsConfirming] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [currentDay, setCurrentDay] = useState(0);
  const [maxDays, setMaxDays] = useState(6);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const stopRequestedRef = useRef(false);
  const isMountedRef = useRef(true);

  const statusText = (() => {
    switch (status) {
      case "preparing":
        return t("demo.preparing");
      case "simulating":
        return t("demo.simulating", { day: currentDay, total: maxDays });
      case "complete":
        return t("demo.complete");
      case "paused":
        return t("demo.pausedAt", { day: currentDay, total: maxDays });
      case "stopped":
        return t("demo.stopped");
      case "failed":
        return t("demo.failed");
      case "reset":
        return t("demo.resetSuccess");
      case "idle":
      default:
        return t("demo.idle");
    }
  })();

  useEffect(() => {
    isMountedRef.current = true;
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
            setStatus("complete");
            setIsComplete(true);
            setIsPaused(false);
          } else {
            setStatus("paused");
            setIsPaused(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || t("demo.loadStatusError"));
        }
      }
    };

    void hydrateStatus();
    return () => {
      cancelled = true;
    };
  }, [sellerId, isDemoSeller, t]);

  const handleReset = async () => {
    stopRequestedRef.current = true;
    setIsRunning(false);
    setIsConfirming(false);
    setLogs([]);
    setCurrentDay(0);
    setIsComplete(false);
    setStatus("reset");
    setError("");
    try {
      await apiClient.resetDemo(sellerId);
      if (!isMountedRef.current) return;
      await onReset?.();
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err.message || t("demo.resetError"));
    }
  };

  const runDemo = async (resumeFromDay = 0) => {
    if (!sellerId) return;
    stopRequestedRef.current = false;
    setIsPaused(false);
    setIsRunning(true);
    setIsConfirming(false);
    setError("");
    setLogs([]);
    setIsComplete(false);
    setStatus("preparing");

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
        setStatus("simulating");

        const stepResponse = await apiClient.stepDemo(sellerId);
        if (!isMountedRef.current) return;
        const line = buildLogLine(stepResponse, t);
        setLogs((prev) => [...prev, line]);

        if (stepResponse?.notifications?.some((n) => n.sent)) {
          setToast(t("demo.toastNotification"));
          onNotificationSent?.();
        }

        void onStepCompleted?.(stepResponse);

        currentValue = Number(stepResponse?.day || nextDay);
        if (currentValue >= activeMaxDays) {
          if (!isMountedRef.current) return;
          setIsComplete(true);
          setStatus("complete");
          break;
        }

        if (stopRequestedRef.current) {
          if (!isMountedRef.current) return;
          setStatus("stopped");
          break;
        }

        await delay(1200);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err.message || t("demo.failedError"));
      setStatus("failed");
    } finally {
      if (isMountedRef.current) {
        setIsRunning(false);
      }
    }
  };

  if (!isDemoSeller) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-jamuni/10 text-jamuni">
              <Play className="h-4 w-4" />
            </span>
            <div className="text-sm font-semibold text-foreground">{t("demo.run")}</div>
          </div>
          <p className="text-sm text-muted-foreground">{t("demo.sub")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isRunning && !isComplete && !isConfirming && (
            <>
              {isPaused ? (
                <button
                  onClick={() => runDemo(currentDay)}
                  className="inline-flex items-center gap-2 rounded-full bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-jamuni/90"
                >
                  <Play className="h-4 w-4" />
                  {t("demo.resume")}
                </button>
              ) : (
                <button
                  onClick={() => setIsConfirming(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-jamuni/90"
                >
                  <Play className="h-4 w-4" />
                  {t("demo.run")}
                </button>
              )}
            </>
          )}
          {isRunning && (
            <button
              onClick={() => {
                stopRequestedRef.current = true;
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              <StopCircle className="h-4 w-4" />
              {t("demo.stop")}
            </button>
          )}
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <RotateCcw className="h-4 w-4" />
            {t("demo.reset")}
          </button>
        </div>
      </div>

      {isConfirming && (
        <div className="mt-4 rounded-2xl border border-border bg-background/70 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("demo.confirmReset")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("demo.confirmSub")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => runDemo(0)}
              className="inline-flex items-center gap-2 rounded-full bg-jamuni px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-jamuni/90"
            >
              <Play className="h-4 w-4" />
              {t("demo.startReplay")}
            </button>
            <button
              onClick={() => setIsConfirming(false)}
              className="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              {t("demo.confirmCancel")}
            </button>
          </div>
        </div>
      )}

      {(isRunning || status !== "idle") && (
        <div className="mt-4 rounded-2xl border border-border bg-background/70 p-3">
          <div className="flex items-center justify-between text-sm text-foreground">
            <span className="font-medium">{statusText}</span>
            <span className="text-xs text-muted-foreground">{t("demo.dayOf", { day: currentDay, total: maxDays })}</span>
          </div>
          {isRunning && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full animate-pulse rounded-full bg-jamuni" style={{ width: `${Math.min(100, (currentDay / Math.max(maxDays, 1)) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="mt-3 rounded-lg border border-jamuni/20 bg-jamuni/10 px-3 py-2 text-sm font-medium text-jamuni">
          {toast}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-background/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("demo.logTitle")}</div>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {logs.map((line, index) => (
              <li key={`${line}-${index}`}>
                • {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isComplete && (
        <div className="mt-3 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
          {t("demo.complete")}
        </div>
      )}
    </div>
  );
}