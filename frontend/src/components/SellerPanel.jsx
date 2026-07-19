import { useEffect, useState, useCallback, useRef } from "react";
import { useT } from "../lib/i18n.jsx";
import apiClient from "../apiClient.js";
import { SKUSummaryCards } from "./SKUSummaryCards.jsx";
import { PriceExplorationChart } from "./PriceExplorationChart.jsx";
import { ForecastFanChart } from "./ForecastFanChart.jsx";
import { ShockEventChart } from "./ShockEventChart.jsx";
import AgentReasoningLog from "./AgentReasoningLog.jsx";
import SettingsDrawer from "./SettingsDrawer.jsx";
import DemoRunner from "./DemoRunner.jsx";
import LoadingSpinner from "./LoadingSpinner.jsx";
import AddProductModal from "./AddProductModal.jsx";

export function SellerPanel({ sellerId, isDemoSeller = false, onDemoNotification }) {
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
    if (!selectedSkuId) return;
    void refreshHistory();
  }, [refreshHistory]);

  const handleSkuCreated = useCallback(async (newSku) => {
    setAddProductOpen(false);
    setSelectedSkuId(newSku.sku_id);
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
    return <LoadingSpinner messages={[t("dash.loadingShop")]} heightClass="h-72" />;
  }
  if (err) {
    return (
      <div className="rounded-xl border border-urgent/20 bg-urgent-soft px-4 py-3 text-sm text-urgent">
        <div className="flex items-center justify-between gap-3">
          <span>{err}</span>
          <button onClick={loadSeller} className="font-medium underline">
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!seller) return null;

  const selectedSku = seller.skus.find((s) => s.sku_id === selectedSkuId);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{t("dash.welcomeBack")}</p>
            <h2 className="font-display text-2xl font-semibold text-foreground">{seller.seller.seller_name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAddProductOpen(true)} className="rounded-full bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
              {t("dash.addProduct")}
            </button>
            <button onClick={() => selectedSku && setSettingsOpen(true)} disabled={!selectedSku} className={`rounded-full border border-border px-3 py-2 text-sm transition ${selectedSku ? "hover:bg-muted" : "cursor-not-allowed opacity-50"}`} aria-label={t("dash.settings")}>
              ⚙
            </button>
          </div>
        </div>
      </div>

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
        <div className="rounded-3xl border border-dashed border-border bg-card/70 px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
          <p className="mb-4">{t("dash.noProductsSub")}</p>
          <button onClick={() => setAddProductOpen(true)} className="rounded-full bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
            {t("dash.addFirst")}
          </button>
        </div>
      ) : (
        <SKUSummaryCards skus={seller.skus} selectedSkuId={selectedSkuId} onSelectSku={setSelectedSkuId} />
      )}

      {selectedSku && (
        <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("sec.priceExploration")}</p>
              <h3 className="font-display text-xl font-semibold text-foreground">{selectedSku.sku_name}</h3>
            </div>
            {!isDemoSeller && (
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
                disabled={!selectedSkuId}
                className="rounded-full bg-jamuni px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {t("dash.runPricingNow")}
              </button>
            )}
          </div>

          {!history ? (
            <LoadingSpinner messages={[t("dash.loadingShop"), t("dash.pricing")]} heightClass="h-64" />
          ) : (
            <div ref={chartSectionRef} className="mt-4 space-y-4">
              <PriceExplorationChart skuId={selectedSkuId} priceArms={history.price_arms} />
              <ForecastFanChart skuId={selectedSkuId} sellerId={sellerId} refreshKey={historyRefreshKey} />
              <ShockEventChart orderHistory={history.order_history} />
              <AgentReasoningLog agentActions={history.agent_actions} onUserMessage={handleUserMessage} />
            </div>
          )}
        </div>
      )}

      <SettingsDrawer sellerId={sellerId} skuId={selectedSkuId} skuName={selectedSku?.sku_name} isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

      <AddProductModal sellerId={sellerId} open={isAddProductOpen} onOpenChange={setAddProductOpen} onCreated={handleSkuCreated} />
    </div>
  );
}

export default SellerPanel;
