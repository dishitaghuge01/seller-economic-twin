import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n.jsx";

const severityConfig = {
  urgent: { pill: "bg-urgent-soft text-urgent", label: "URGENT" },
  watch: { pill: "bg-watch-soft text-watch", label: "WATCH" },
  safe: { pill: "bg-safe-soft text-safe", label: "SAFE" },
};

function useFlashingValue({ skuId, value, previousValue, kind }) {
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashClass, setFlashClass] = useState("");

  useEffect(() => {
    if (previousValue == null || value === previousValue) {
      return;
    }

    if (kind === "stock") {
      if (value === 0) {
        setFlashClass("text-urgent scale-110 ring-2 ring-urgent/30 rounded-md px-1");
      } else if (value < previousValue) {
        setFlashClass("text-watch scale-110 ring-2 ring-watch/30 rounded-md px-1");
      }
    } else if (kind === "price") {
      setFlashClass("text-jamuni scale-110 ring-2 ring-jamuni/30 rounded-md px-1");
    }

    setIsFlashing(true);
    const timer = window.setTimeout(() => {
      setIsFlashing(false);
      setFlashClass("");
    }, 900);

    return () => window.clearTimeout(timer);
  }, [kind, previousValue, skuId, value]);

  return { isFlashing, flashClass };
}

function SkuCard({ sku, isSelected, onSelectSku, previousStock, previousPrice, flashedStockoutIds }) {
  const t = useT();
  const stockFeedback = useFlashingValue({
    skuId: sku.sku_id,
    value: sku.current_stock,
    previousValue: previousStock,
    kind: "stock",
  });
  const priceFeedback = useFlashingValue({
    skuId: sku.sku_id,
    value: sku.current_chosen_price,
    previousValue: previousPrice,
    kind: "price",
  });

  const sev = severityConfig[sku.last_action?.stockout_severity] || severityConfig.safe;
  const isUrgent = sku.last_action?.stockout_severity === "urgent";
  const cardFlashClass = flashedStockoutIds.has(sku.sku_id) ? "border-urgent/40 bg-urgent-soft/40" : "";

  return (
    <button
      onClick={() => onSelectSku(sku.sku_id)}
      className={`w-[240px] shrink-0 rounded-2xl border bg-card p-4 text-left transition ${isSelected ? "border-jamuni ring-2 ring-jamuni/20" : "border-border hover:border-jamuni/40"} ${cardFlashClass}`}
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
          <p className={`font-display text-2xl font-semibold tabular-nums ${stockFeedback.isFlashing ? stockFeedback.flashClass : ""}`}>
            {sku.current_stock}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("sku.price")}</p>
          <p className={`font-display text-2xl font-semibold tabular-nums ${priceFeedback.isFlashing ? priceFeedback.flashClass : ""}`}>
            ₹{sku.current_chosen_price}
          </p>
        </div>
      </div>
    </button>
  );
}

export function SKUSummaryCards({ skus, selectedSkuId, onSelectSku }) {
  const previousValuesRef = useRef(new Map());
  const [flashedStockoutIds, setFlashedStockoutIds] = useState(new Set());

  const skuStates = useMemo(() => {
    return skus.map((sku) => {
      const previous = previousValuesRef.current.get(sku.sku_id);
      const previousStock = previous?.current_stock;
      const previousPrice = previous?.current_chosen_price;
      const stockWentZero = previousStock != null && previousStock > 0 && sku.current_stock === 0;
      const stockChangedToZero = stockWentZero || (previousStock == null && sku.current_stock === 0);

      previousValuesRef.current.set(sku.sku_id, {
        current_stock: sku.current_stock,
        current_chosen_price: sku.current_chosen_price,
      });

      return {
        sku,
        previousStock,
        previousPrice,
        stockChangedToZero,
      };
    });
  }, [skus]);

  useEffect(() => {
    const ids = new Set();
    skuStates.forEach(({ sku, stockChangedToZero }) => {
      if (stockChangedToZero) {
        ids.add(sku.sku_id);
      }
    });

    setFlashedStockoutIds(ids);
    const timer = window.setTimeout(() => {
      setFlashedStockoutIds(new Set());
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [skuStates]);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="flex snap-x snap-mandatory gap-3">
        {skuStates.map(({ sku, previousStock, previousPrice }) => (
          <SkuCard
            key={sku.sku_id}
            sku={sku}
            isSelected={sku.sku_id === selectedSkuId}
            onSelectSku={onSelectSku}
            previousStock={previousStock}
            previousPrice={previousPrice}
            flashedStockoutIds={flashedStockoutIds}
          />
        ))}
      </div>
    </div>
  );
}

export default SKUSummaryCards;
