import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import apiClient from "../apiClient.js";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export function AddProductModal({ sellerId, open, onOpenChange, onCreated }) {
  const t = useT();
  const [form, setForm] = useState({ sku_name: "", current_stock: 20, reorder_point: 10, unit_cost: 200, price_floor: 300, price_ceiling: 500 });
  const [saving, setSaving] = useState(false);

  const invalid = form.price_ceiling <= form.price_floor || !form.sku_name.trim();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      const sku = await apiClient.createSku(sellerId, form);
      toast.success(t("add.added", { name: sku.sku_name }));
      onCreated?.(sku);
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{t("add.title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="font-medium">{t("add.productName")}</span>
            <input value={form.sku_name} onChange={(e) => set("sku_name", e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-jamuni" placeholder={t("add.namePlaceholder")} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.stock")}</span>
              <input type="number" value={form.current_stock} onChange={(e) => set("current_stock", Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni" />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.reorder")}</span>
              <input type="number" value={form.reorder_point} onChange={(e) => set("reorder_point", Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni" />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.cost")}</span>
              <input type="number" value={form.unit_cost} onChange={(e) => set("unit_cost", Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni" />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.floor")}</span>
              <input type="number" value={form.price_floor} onChange={(e) => set("price_floor", Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni" />
            </label>
            <label className="col-span-2 block space-y-1 text-xs">
              <span className="font-medium">{t("add.ceiling")}</span>
              <input type="number" value={form.price_ceiling} onChange={(e) => set("price_ceiling", Number(e.target.value))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni" />
            </label>
          </div>
          {form.price_ceiling <= form.price_floor && (
            <p className="text-xs text-urgent">{t("settings.invalidRange")}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-border px-3 py-2 text-sm">{t("common.cancel")}</button>
            <button type="submit" disabled={invalid || saving} className="rounded-lg bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {saving ? t("add.creating") : t("add.create")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
