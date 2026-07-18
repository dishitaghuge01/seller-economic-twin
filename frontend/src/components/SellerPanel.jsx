import { useEffect, useState, useCallback, useRef } from "react";
import apiClient from "../apiClient.js";
import SKUSummaryCards from "./SKUSummaryCards.jsx";
import PriceExplorationChart from "./PriceExplorationChart.jsx";
import ForecastFanChart from "./ForecastFanChart.jsx";
import ShockEventChart from "./ShockEventChart.jsx";
import AgentReasoningLog from "./AgentReasoningLog.jsx";
import SettingsDrawer from "./SettingsDrawer.jsx";
import DemoRunner from "./DemoRunner.jsx";
import LoadingSpinner from "./LoadingSpinner.jsx";

export default function SellerPanel({ sellerId, isDemoSeller = false, onDemoNotification }) {
  const [seller, setSeller] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isAddProductOpen, setAddProductOpen] = useState(false);
  const [creatingSku, setCreatingSku] = useState(false);
  const [addSkuError, setAddSkuError] = useState(null);
  const [newSkuName, setNewSkuName] = useState("");
  const [newCurrentStock, setNewCurrentStock] = useState(0);
  const [newReorderPoint, setNewReorderPoint] = useState(0);
  const [newUnitCost, setNewUnitCost] = useState(80);
  const [newPriceFloor, setNewPriceFloor] = useState(100);
  const [newPriceCeiling, setNewPriceCeiling] = useState(140);
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

  const canCreateSku =
    newSkuName.trim().length > 0 &&
    Number(newPriceFloor) < Number(newPriceCeiling) &&
    Number(newUnitCost) >= 0 &&
    Number(newCurrentStock) >= 0 &&
    Number(newReorderPoint) >= 0;

  const handleCreateSku = async () => {
    if (!canCreateSku) return;
    setCreatingSku(true);
    setAddSkuError(null);

    try {
      const newSku = await apiClient.createSku(sellerId, {
        sku_name: newSkuName,
        current_stock: Number(newCurrentStock),
        reorder_point: Number(newReorderPoint),
        unit_cost: Number(newUnitCost),
        price_floor: Number(newPriceFloor),
        price_ceiling: Number(newPriceCeiling),
      });
      setAddProductOpen(false);
      setNewSkuName("");
      setNewCurrentStock(0);
      setNewReorderPoint(0);
      setNewPriceFloor(100);
      setNewPriceCeiling(140);
      setSelectedSkuId(newSku.sku_id);
      void loadSeller({ silent: true });
    } catch (e) {
      setAddSkuError(e.message || "Unable to create product.");
    } finally {
      setCreatingSku(false);
    }
  };

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
    return (
      <div className="space-y-3">
        <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-32 w-full bg-gray-200 rounded-xl animate-pulse" />
        <div className="h-24 w-3/4 bg-gray-200 rounded-xl animate-pulse" />
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 flex items-center justify-between">
        <span>{err}</span>
        <button onClick={loadSeller} className="text-sm font-medium underline">
          Retry
        </button>
      </div>
    );
  }
  if (!seller) return null;

  const selectedSku = seller.skus.find((s) => s.sku_id === selectedSkuId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-gray-500">Welcome back</div>
          <div className="font-semibold text-gray-900">{seller.seller.seller_name}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAddProductOpen(true)}
            className="rounded-lg bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800"
          >
            Add Product
          </button>
          <button
            onClick={() => selectedSku && setSettingsOpen(true)}
            disabled={!selectedSku}
            className={
              "p-2 rounded-full text-sm " +
              (selectedSku
                ? "hover:bg-gray-100"
                : "cursor-not-allowed opacity-50")
            }
            aria-label="Settings"
          >
            ⚙
          </button>
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
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-600 shadow-sm">
          <p className="mb-4">No products yet — set up your first product to start getting pricing and stock advice.</p>
          <button
            onClick={() => setAddProductOpen(true)}
            className="rounded-lg bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-800"
          >
            Add your first product
          </button>
        </div>
      ) : (
        <SKUSummaryCards
          skus={seller.skus}
          selectedSkuId={selectedSkuId}
          onSelectSku={setSelectedSkuId}
        />
      )}

      {selectedSku && (
        <>
          <hr className="border-gray-200" />
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{selectedSku.sku_name}</h2>
            <div>
              <button
                onClick={async () => {
                  if (!selectedSkuId) return;
                  setHistoryLoading(true);
                  setErr(null);
                  try {
                    await apiClient.triggerPricingNow(sellerId, selectedSkuId);
                    // refresh seller; let the selectedSkuId effect fetch history
                    await loadSeller();
                  } catch (e) {
                    setErr(e.message || String(e));
                  } finally {
                    setHistoryLoading(false);
                  }
                }}
                disabled={!selectedSkuId}
                className="ml-2 rounded-md bg-indigo-600 text-white px-3 py-1 text-sm disabled:opacity-50"
              >
                Run Pricing Now
              </button>
            </div>
          </div>

          {!history ? (
            <LoadingSpinner
              messages={[
                "Pulling price history...",
                "Counting times each price was tried...",
                "Loading order history...",
                "Tallying the band's choices...",
              ]}
              heightClass="h-64"
            />
          ) : (
            <div ref={chartSectionRef} className="space-y-4">
              <PriceExplorationChart
                skuId={selectedSkuId}
                priceArms={history.price_arms}
              />
              <ForecastFanChart skuId={selectedSkuId} sellerId={sellerId} refreshKey={historyRefreshKey} />
              <ShockEventChart orderHistory={history.order_history} />
              <AgentReasoningLog
                agentActions={history.agent_actions}
                onUserMessage={handleUserMessage}
              />
            </div>
          )}
        </>
      )}

      <SettingsDrawer
        sellerId={sellerId}
        skuId={selectedSkuId}
        skuName={selectedSku?.sku_name}
        isOpen={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {isAddProductOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-4 py-6 sm:items-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setAddProductOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add product</h2>
                <p className="text-sm text-gray-500">Enter details for your new SKU.</p>
              </div>
              <button
                onClick={() => setAddProductOpen(false)}
                className="text-gray-500 hover:text-gray-900"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">Product name</label>
                <input
                  value={newSkuName}
                  onChange={(e) => setNewSkuName(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Current stock</label>
                  <input
                    type="number"
                    min={0}
                    value={newCurrentStock}
                    onChange={(e) => setNewCurrentStock(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Reorder point</label>
                  <input
                    type="number"
                    min={0}
                    value={newReorderPoint}
                    onChange={(e) => setNewReorderPoint(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Unit cost</label>
                  <input
                    type="number"
                    min={0}
                    value={newUnitCost}
                    onChange={(e) => setNewUnitCost(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Price floor</label>
                  <input
                    type="number"
                    min={1}
                    value={newPriceFloor}
                    onChange={(e) => setNewPriceFloor(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Price ceiling</label>
                  <input
                    type="number"
                    min={1}
                    value={newPriceCeiling}
                    onChange={(e) => setNewPriceCeiling(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {Number(newPriceFloor) >= Number(newPriceCeiling) && (
                <p className="text-sm text-red-600">Price ceiling must be higher than price floor.</p>
              )}
              {addSkuError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {addSkuError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setAddProductOpen(false)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSku}
                  disabled={!canCreateSku || creatingSku}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {creatingSku ? "Creating…" : "Create product"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
