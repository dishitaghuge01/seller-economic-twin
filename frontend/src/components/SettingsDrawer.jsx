import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import apiClient from "../apiClient.js";
import { useT } from "@/lib/i18n";

export function SettingsDrawer({ sellerId, skuId, skuName, isOpen, onClose }) {
  const t = useT();
  const [floor, setFloor] = useState(370);
  const [ceiling, setCeiling] = useState(490);
  const [alertTime, setAlertTime] = useState("09:00");
  const [alertLang, setAlertLang] = useState("hi");
  const [notifyPrice, setNotifyPrice] = useState(true);
  const [notifyStock, setNotifyStock] = useState(true);
  const [threshold, setThreshold] = useState(5);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (isOpen) setSaving(false); }, [isOpen]);

  const invalid = floor >= ceiling;

  const save = async () => {
    if (invalid || !skuId) return;
    setSaving(true);
    try {
      const res = await apiClient.updateSettings(sellerId, {
        sku_id: skuId, price_floor: floor, price_ceiling: ceiling,
        daily_alert_time: alertTime, alert_language: alertLang,
        notify_on_price_change: notifyPrice, notify_on_stockout_risk: notifyStock,
        price_change_threshold: threshold,
      });
      toast.success(t("settings.saved", { count: res.new_arm_count }));
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">{t("settings.title")}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-8 px-4 pb-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("settings.priceRange")}</h3>
              {skuName && <p className="text-xs text-muted-foreground">Editing price range for: {skuName}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="font-medium">{t("settings.floor")}</span>
                <input type="number" value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-jamuni tabular-nums" />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium">{t("settings.ceiling")}</span>
                <input type="number" value={ceiling} onChange={(e) => setCeiling(Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-jamuni tabular-nums" />
              </label>
            </div>
            {invalid && <p className="text-xs text-urgent">{t("settings.invalidRange")}</p>}
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("settings.account")}</h3>

            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("settings.dailyAlert")}</span>
              <input type="time" value={alertTime} onChange={(e) => setAlertTime(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums" />
            </label>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("settings.alertLang")}</span>
              <div className="inline-flex rounded-md border border-border p-0.5">
                {['hi', 'en'].map((l) => (
                  <button key={l} onClick={() => setAlertLang(l)} className={`rounded px-3 py-1 text-xs font-medium transition ${alertLang === l ? "bg-jamuni text-primary-foreground" : "text-muted-foreground"}`}>
                    {l === "hi" ? "हिंदी" : "English"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">{t("settings.notifyPrice")}</span>
              <Switch checked={notifyPrice} onCheckedChange={setNotifyPrice} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("settings.notifyStock")}</span>
              <Switch checked={notifyStock} onCheckedChange={setNotifyStock} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("settings.threshold")}</span>
                <span className="text-sm font-medium tabular-nums">{threshold}%</span>
              </div>
              <Slider min={2} max={20} step={1} value={[threshold]} onValueChange={(v) => setThreshold(v[0])} />
            </div>
          </section>

          <button
            onClick={save}
            disabled={invalid || saving || !skuId}
            className="w-full rounded-lg bg-jamuni px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
