import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Settings, Zap } from "lucide-react";
import apiClient from "../apiClient.js";
import { SKUSummaryCards } from "./SKUSummaryCards.jsx";
import { PriceExplorationChart } from "./PriceExplorationChart.jsx";
import { ForecastFanChart } from "./ForecastFanChart.jsx";
import { ShockEventChart } from "./ShockEventChart.jsx";
import { AgentReasoningLog } from "./AgentReasoningLog.jsx";
import { SettingsDrawer } from "./SettingsDrawer.jsx";
import { DemoRunner } from "./DemoRunner.jsx";
import { AddProductModal } from "./AddProductModal.jsx";
import { LoadingSpinner } from "./LoadingSpinner.jsx";
import { useT } from "../lib/i18n.jsx";

export default function SellerPanel({ sellerId, isDemoSeller = false, onDemoNotification }) {
  const t = useT();
  const [seller, setSeller] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isAddProductOpen, setAddProductOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const chartSectionRef = useRef(null);

  const loadSeller = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const d = await apiClient.getSeller(sellerId);
      setSeller(d);
      setSelectedSkuId((prev) => {
        const nextSkuId = prev && d.skus?.some((s) => s.sku_id === prev) ? prev : d.skus?.[0]?.sku_id ?? null;
        return nextSkuId;
      });
      return d;
    } catch (e) {
      setErr(e.message || "Failed to load");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [sellerId]);

  useEffect(() => {
    loadSeller();
  }, [loadSeller]);

  const refreshHistory = useCallback(async ({ silent = false, skuId } = {}) => {
    const targetSkuId = skuId || selectedSkuId;
    if (!targetSkuId) return;
    if (!silent) setHistoryLoading(true);
    setErr(null);
    try {
      const nextHistory = await apiClient.getSkuHistory(sellerId, targetSkuId);
      setHistory(nextHistory);
      return nextHistory;
    } catch (e) {
      setErr(e.message || "Failed to load history");
      throw e;
    } finally {
      setHistoryLoading(false);
    }
  }, [sellerId, selectedSkuId]);

  useEffect(() => {
    if (!selectedSkuId) {
      setHistory(null);
      return;
    }
    void refreshHistory();
  }, [refreshHistory]);

  const handleSkuCreated = useCallback((newSku) => {
    setAddProductOpen(false);
    setSelectedSkuId(newSku?.sku_id ?? null);
    void loadSeller({ silent: true });
  }, [loadSeller]);

  const handleUserMessage = async (text) => {
    const res = await apiClient.postMessage(sellerId, text);
    setHistory((h) =>
      h
        ? {
            ...h,
            agent_actions: [
              {
                action_id: `user_${Date.now()}`,
                action_date: new Date().toISOString().slice(0, 10),
                trigger: "user_message",
                tool_called: "conversation",
                chosen_price: null,
                stockout_severity: "safe",
                seller_message: res.response_text,
                reasoning_trace: res.reasoning_trace,
                action_summary: res.action_summary,
                delivered_via: "whatsapp",
                created_at: new Date().toISOString(),
              },
              ...h.agent_actions,
            ],
          }
        : h,
    );
  };

  const handleDemoReset = useCallback(async () => {
    await loadSeller();
    await refreshHistory({ silent: true, skuId: selectedSkuId });
    setHistoryRefreshKey((value) => value + 1);
  }, [loadSeller, refreshHistory, selectedSkuId]);

  const handleDemoStepCompleted = useCallback(async (stepResponse) => {
    const candidateSkus = [stepResponse?.shock_sku, stepResponse?.depletion_sku].filter(Boolean);
    const notifications = Array.isArray(stepResponse?.notifications) ? stepResponse.notifications : [];
    const sentNotification = notifications.find((notification) => notification?.sent);
    const sentMessage = sentNotification
      ? stepResponse?.agent_messages?.find?.((message) => message?.sku_id === sentNotification?.sku_id) || null
      : null;

    const matchedSku =
      candidateSkus.find((sku) => sku?.shock_event_triggered_today) ||
      (sentNotification
        ? candidateSkus.find((sku) => sku?.sku_id === sentNotification?.sku_id)
        : null) ||
      candidateSkus.find((sku) => sku?.stockout_severity === "urgent") ||
      candidateSkus.find((sku) => sku?.stockout_severity === "watch");
    const targetSkuId = matchedSku?.sku_id || selectedSkuId;

    if (targetSkuId) {
      if (targetSkuId !== selectedSkuId) {
        setSelectedSkuId(targetSkuId);
      }
      if (matchedSku) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (typeof chartSectionRef.current?.scrollIntoView === "function") {
          chartSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }

    if (sentMessage?.seller_message && typeof onDemoNotification === "function") {
      onDemoNotification(sentMessage.seller_message);
    }

    void loadSeller({ silent: true });
    void refreshHistory({ silent: true, skuId: targetSkuId });
    setHistoryRefreshKey((value) => value + 1);
  }, [loadSeller, refreshHistory, selectedSkuId, onDemoNotification]);

  const onStepCompletedRef = useRef(handleDemoStepCompleted);
  useEffect(() => {
    onStepCompletedRef.current = handleDemoStepCompleted;
  }, [handleDemoStepCompleted]);

  const handleStepCompletedStable = useCallback((stepResponse) => {
    onStepCompletedRef.current(stepResponse);
  }, []);

  const onResetRef = useRef(handleDemoReset);
  useEffect(() => {
    onResetRef.current = handleDemoReset;
  }, [handleDemoReset]);

  const handleResetStable = useCallback(() => {
    onResetRef.current?.();
  }, []);

  const onDemoNotificationRef = useRef(onDemoNotification);
  useEffect(() => {
    onDemoNotificationRef.current = onDemoNotification;
  }, [onDemoNotification]);

  const handleNotificationStable = useCallback((message) => {
    onDemoNotificationRef.current?.(message);
  }, []);

  if (loading && !seller) {
    return <LoadingSpinner messages={[t("dash.loadingShop")]} heightClass="h-[60vh]" />;
  }
  if (err) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
        <span>{err}</span>
        <button onClick={() => loadSeller()} className="text-sm font-medium underline">
          Retry
        </button>
      </div>
    );
  }
  if (!seller) return null;

  const selectedSku = seller.skus?.find((s) => s.sku_id === selectedSkuId);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("dash.welcomeBack")}</p>
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">{seller.seller.seller_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAddProductOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> {t("dash.addProduct")}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            disabled={!selectedSkuId}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card p-2 hover:bg-muted disabled:opacity-40"
            aria-label={t("dash.settings")}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {isDemoSeller && (
        <DemoRunner
          sellerId={sellerId}
          isDemoSeller={isDemoSeller}
          onStepCompleted={handleStepCompletedStable}
          onNotificationSent={handleNotificationStable}
          onReset={handleResetStable}
        />
      )}

      {seller.skus.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <p className="font-display text-lg">{t("dash.noProductsTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("dash.noProductsSub")}</p>
          <button onClick={() => setAddProductOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Plus className="h-3.5 w-3.5" /> {t("dash.addFirst")}
          </button>
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dash.yourProducts")}</h2>
            <SKUSummaryCards skus={seller.skus} selectedSkuId={selectedSkuId} onSelectSku={setSelectedSkuId} />
          </section>

          {selectedSku && (
            <>
              {!isDemoSeller && (
                <div className="flex justify-end">
                  <button
                    onClick={async () => {
                      if (!selectedSkuId) return;
                      setHistoryLoading(true);
                      setErr(null);
                      try {
                        await apiClient.triggerPricingNow(sellerId, selectedSkuId);
                        await loadSeller();
                      } catch (e) {
                        setErr(e.message || String(e));
                      } finally {
                        setHistoryLoading(false);
                      }
                    }}
                    disabled={historyLoading || !selectedSkuId}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-jamuni px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {t("dash.runPricingNow")}
                  </button>
                </div>
              )}

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4">
                  <h3 className="font-display text-lg font-semibold">{t("sec.priceExploration")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sec.priceExplorationSub", { name: selectedSku.sku_name })}</p>
                </div>
                <PriceExplorationChart sellerId={sellerId} skuId={selectedSku.sku_id} priceArms={history?.price_arms} />
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4">
                  <h3 className="font-display text-lg font-semibold">{t("sec.forecast")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sec.forecastSub")}</p>
                </div>
                <ForecastFanChart skuId={selectedSku.sku_id} sellerId={sellerId} refreshKey={historyRefreshKey} />
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4">
                  <h3 className="font-display text-lg font-semibold">{t("sec.sales")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sec.salesSub")}</p>
                </div>
                <ShockEventChart orderHistory={history?.order_history} />
              </section>

              <section>
                <div className="mb-3">
                  <h3 className="font-display text-lg font-semibold">{t("sec.reasoning")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sec.reasoningSub")}</p>
                </div>
                <AgentReasoningLog agentActions={history?.agent_actions} onUserMessage={handleUserMessage} />
              </section>
            </>
          )}
        </>
      )}

      <SettingsDrawer
        sellerId={sellerId}
        skuId={selectedSku?.sku_id}
        skuName={selectedSku?.sku_name}
        isOpen={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <AddProductModal
        sellerId={sellerId}
        open={isAddProductOpen}
        onOpenChange={setAddProductOpen}
        onCreated={handleSkuCreated}
      />
    </div>
  );
}
