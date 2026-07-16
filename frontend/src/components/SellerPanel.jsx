import { useEffect, useState, useCallback } from "react";
import apiClient from "../apiClient.js";
import SKUSummaryCards from "./SKUSummaryCards.jsx";
import PriceExplorationChart from "./PriceExplorationChart.jsx";
import ForecastFanChart from "./ForecastFanChart.jsx";
import ShockEventChart from "./ShockEventChart.jsx";
import AgentReasoningLog from "./AgentReasoningLog.jsx";
import SettingsDrawer from "./SettingsDrawer.jsx";

export default function SellerPanel({ sellerId }) {
  const [seller, setSeller] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const loadSeller = useCallback(() => {
    setLoading(true);
    setErr(null);
    apiClient
      .getSeller(sellerId)
      .then((d) => {
        setSeller(d);
        if (d.skus?.[0]) setSelectedSkuId(d.skus[0].sku_id);
      })
      .catch((e) => setErr(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [sellerId]);

  useEffect(() => {
    loadSeller();
  }, [loadSeller]);

  useEffect(() => {
    if (!selectedSkuId) return;
    setHistoryLoading(true);
    apiClient
      .getSkuHistory(sellerId, selectedSkuId)
      .then(setHistory)
      .finally(() => setHistoryLoading(false));
  }, [sellerId, selectedSkuId]);

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

  if (loading) {
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
  const skuIds = seller.skus.map((s) => s.sku_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">Welcome back</div>
          <div className="font-semibold text-gray-900">{seller.seller.seller_name}</div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>

      <SKUSummaryCards
        skus={seller.skus}
        selectedSkuId={selectedSkuId}
        onSelectSku={setSelectedSkuId}
      />

      {selectedSku && (
        <>
          <hr className="border-gray-200" />
          <h2 className="font-semibold text-gray-900">{selectedSku.sku_name}</h2>

          {historyLoading || !history ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <div className="space-y-4">
              <PriceExplorationChart
                skuId={selectedSkuId}
                priceArms={history.price_arms}
              />
              <ForecastFanChart skuId={selectedSkuId} sellerId={sellerId} />
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
        skuIds={skuIds}
        isOpen={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
