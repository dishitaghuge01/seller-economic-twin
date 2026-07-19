import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";


function useFlashOnChange(value) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      prev.current = value;
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}

function SkuCard({ sku, selected, onClick }) {
  const t = useT();
  const severityStyles = {
    urgent: { pill: "bg-red-100 text-red-700", label: t("sku.urgent") },
    watch: { pill: "bg-amber-100 text-amber-700", label: t("sku.watch") },
    safe: { pill: "bg-green-100 text-green-700", label: t("sku.safe") },
  };
  const sev = severityStyles[sku.last_action?.stockout_severity || "safe"];
  const stockFlash = useFlashOnChange(sku.current_stock);
  const priceFlash = useFlashOnChange(sku.current_chosen_price);
  return (
    <button
      onClick={onClick}
      className={`snap-start shrink-0 w-[240px] rounded-2xl border bg-card p-4 text-left transition ${
        selected ? "border-jamuni ring-2 ring-jamuni/20" : "border-border hover:border-jamuni/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-semibold leading-tight line-clamp-2">{sku.sku_name}</h3>
      </div>
      <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${sev.pill}`}>
        {sev.label}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("sku.stock")}</p>
          <p className={`font-display text-2xl font-semibold tabular-nums ${stockFlash ? "flash-highlight rounded" : ""}`}>
            {sku.current_stock}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("sku.price")}</p>
          <p className={`font-display text-2xl font-semibold tabular-nums ${priceFlash ? "flash-highlight rounded" : ""}`}>
            ₹{sku.current_chosen_price}
          </p>
        </div>
      </div>
    </button>
  );
}


export function SKUSummaryCards({ skus, selectedSkuId, onSelectSku }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="flex snap-x snap-mandatory gap-3">
        {skus.map((s) => (
          <SkuCard key={s.sku_id} sku={s} selected={s.sku_id === selectedSkuId} onClick={() => onSelectSku(s.sku_id)} />
        ))}
      </div>
    </div>
  );
}
