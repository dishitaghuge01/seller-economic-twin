import { useEffect, useMemo, useRef, useState } from "react";

const severityConfig = {
  urgent: { bg: "bg-red-100", text: "text-red-700", label: "URGENT" },
  watch: { bg: "bg-amber-100", text: "text-amber-700", label: "WATCH" },
  safe: { bg: "bg-green-100", text: "text-green-700", label: "SAFE" },
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
        setFlashClass("text-red-600 scale-110 ring-2 ring-red-400 rounded-md px-1");
      } else if (value < previousValue) {
        setFlashClass("text-red-600 scale-110 ring-2 ring-red-300 rounded-md px-1");
      }
    } else if (kind === "price") {
      setFlashClass("text-indigo-600 scale-110 ring-2 ring-indigo-300 rounded-md px-1");
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

function SkuCard({ sku, isSelected, onSelectSku, previousStock, previousPrice, stockChangedToZero, flashedStockoutIds }) {
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
  const isOutOfStockFlash = flashedStockoutIds.has(sku.sku_id);
  const cardFlashClass = isOutOfStockFlash ? "border-red-400 bg-red-50" : "";
  const badgePulseClass = isUrgent ? "animate-pulse" : "";

  return (
    <button
      key={sku.sku_id}
      onClick={() => onSelectSku(sku.sku_id)}
      className={
        "text-left min-w-[240px] flex-none bg-white rounded-xl p-4 shadow-sm border-2 transition-all " +
        (isSelected
          ? "border-gray-900"
          : "border-transparent hover:border-gray-200") +
        ` ${cardFlashClass}`
      }
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="font-semibold text-gray-900 text-sm">{sku.sku_name}</div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text} ${badgePulseClass}`}
        >
          {sev.label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-gray-500">Stock</div>
          <div className={`text-2xl font-bold text-gray-900 ${stockFeedback.isFlashing ? stockFeedback.flashClass : ""}`}>
            {sku.current_stock}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Price</div>
          <div className={`text-lg font-semibold text-gray-800 ${priceFeedback.isFlashing ? priceFeedback.flashClass : ""}`}>
            ₹{sku.current_chosen_price}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function SKUSummaryCards({ skus, selectedSkuId, onSelectSku }) {
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
    <div className="flex gap-3 overflow-x-auto flex-nowrap md:flex-wrap md:overflow-visible pb-2">
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
  );
}
