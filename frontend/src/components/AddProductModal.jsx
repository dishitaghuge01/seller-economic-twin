import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog.jsx";
import apiClient from "../apiClient.js";
import { toast } from "sonner";
import { useT } from "../lib/i18n.jsx";

export default function AddProductModal({ sellerId, open, onOpenChange, onCreated }) {
  const t = useT();
  const [form, setForm] = useState({
    sku_name: "",
    current_stock: 20,
    reorder_point: 10,
    unit_cost: 200,
    price_floor: 300,
    price_ceiling: 500,
  });
  const [saving, setSaving] = useState(false);

  const invalid = useMemo(() => form.price_ceiling <= form.price_floor || !form.sku_name.trim(), [form]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (invalid) return;

    setSaving(true);
    try {
      const payload = {
        sku_name: form.sku_name,
        current_stock: Number(form.current_stock),
        reorder_point: Number(form.reorder_point),
        unit_cost: Number(form.unit_cost),
        price_floor: Number(form.price_floor),
        price_ceiling: Number(form.price_ceiling),
      };
      const sku = await apiClient.createSku(sellerId, payload);
      toast.success(t("add.added", { name: sku.sku_name }));
      onCreated?.(sku);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
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
            <input
              value={form.sku_name}
              onChange={(event) => setField("sku_name", event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-jamuni"
              placeholder={t("add.namePlaceholder")}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.stock")}</span>
              <input
                type="number"
                value={form.current_stock}
                onChange={(event) => setField("current_stock", Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.reorder")}</span>
              <input
                type="number"
                value={form.reorder_point}
                onChange={(event) => setField("reorder_point", Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.cost")}</span>
              <input
                type="number"
                value={form.unit_cost}
                onChange={(event) => setField("unit_cost", Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">{t("add.floor")}</span>
              <input
                type="number"
                value={form.price_floor}
                onChange={(event) => setField("price_floor", Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni"
              />
            </label>
            <label className="col-span-2 block space-y-1 text-xs">
              <span className="font-medium">{t("add.ceiling")}</span>
              <input
                type="number"
                value={form.price_ceiling}
                onChange={(event) => setField("price_ceiling", Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-jamuni"
              />
            </label>
          </div>
          {invalid && <p className="text-xs text-urgent">{t("settings.invalidRange")}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-border px-3 py-2 text-sm">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={invalid || saving} className="rounded-lg bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {saving ? t("add.creating") : t("add.create")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
