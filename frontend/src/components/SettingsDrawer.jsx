import { useEffect, useState } from "react";
import apiClient from "../apiClient.js";

export default function SettingsDrawer({ sellerId, skuId, skuName, isOpen, onClose }) {
  const [floor, setFloor] = useState(370);
  const [ceiling, setCeiling] = useState(490);
  const [alertTime, setAlertTime] = useState("09:00");
  const [language, setLanguage] = useState("hi");
  const [notifyPrice, setNotifyPrice] = useState(true);
  const [notifyStockout, setNotifyStockout] = useState(true);
  const [threshold, setThreshold] = useState(5);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!isOpen) return null;

  const invalid = Number(floor) >= Number(ceiling);

  const handleSave = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const res = await apiClient.updateSettings(sellerId, {
        sku_id: skuId,
        price_floor: Number(floor),
        price_ceiling: Number(ceiling),
        daily_alert_time: alertTime,
        alert_language: language,
        notify_on_price_change: notifyPrice,
        notify_on_stockout_risk: notifyStockout,
        price_change_threshold: threshold,
      });
      if (res.arms_recomputed) {
        setToast(
          `Price range updated — agent will explore ${res.new_arm_count} price points.`,
        );
      } else {
        setToast("Settings saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white w-full md:w-[420px] md:h-full max-h-[90vh] h-[90vh] mt-auto md:mt-0 rounded-t-2xl md:rounded-none shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">This product</div>
            <div className="text-lg font-semibold text-gray-900">
              Editing price range for: {skuName || "selected product"}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 space-y-4">
            <div className="text-sm font-semibold text-gray-900">Product price range</div>
            <div>
              <label className="text-sm font-medium text-gray-700">Price Floor</label>
              <input
                type="number"
                min={100}
                max={980}
                step={20}
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Price Ceiling</label>
              <input
                type="number"
                min={120}
                max={1000}
                step={20}
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              {invalid && (
                <p className="mt-1 text-xs text-red-600">
                  Ceiling must be greater than floor.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 space-y-4">
            <div className="text-sm font-semibold text-gray-900">Account settings</div>
            <div>
              <label className="text-sm font-medium text-gray-700">Daily Alert Time</label>
              <input
                type="time"
                value={alertTime}
                onChange={(e) => setAlertTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Language
              </label>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                {[
                  { v: "hi", l: "Hindi" },
                  { v: "en", l: "English" },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setLanguage(o.v)}
                    className={
                      "px-4 py-2 text-sm " +
                      (language === o.v
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50")
                    }
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={notifyPrice}
                onChange={(e) => setNotifyPrice(e.target.checked)}
              />
              Notify on price change
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={notifyStockout}
                onChange={(e) => setNotifyStockout(e.target.checked)}
              />
              Notify on stockout risk
            </label>

            <div>
              <label className="text-sm font-medium text-gray-700 flex justify-between">
                <span>Price change threshold</span>
                <span className="text-gray-500">{threshold}%</span>
              </label>
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={invalid || saving}
            className="w-full py-2.5 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          {toast && (
            <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
