const severityConfig = {
  urgent: { bg: "bg-red-100", text: "text-red-700", label: "URGENT" },
  watch: { bg: "bg-amber-100", text: "text-amber-700", label: "WATCH" },
  safe: { bg: "bg-green-100", text: "text-green-700", label: "SAFE" },
};

export default function SKUSummaryCards({ skus, selectedSkuId, onSelectSku }) {
  return (
    <div className="flex gap-3 overflow-x-auto md:flex-wrap md:overflow-visible pb-2">
      {skus.map((sku) => {
        const sev = severityConfig[sku.last_action?.stockout_severity] || severityConfig.safe;
        const isSelected = sku.sku_id === selectedSkuId;
        return (
          <button
            key={sku.sku_id}
            onClick={() => onSelectSku(sku.sku_id)}
            className={
              "text-left min-w-[240px] flex-1 bg-white rounded-xl p-4 shadow-sm border-2 transition-all " +
              (isSelected
                ? "border-gray-900"
                : "border-transparent hover:border-gray-200")
            }
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="font-semibold text-gray-900 text-sm">{sku.sku_name}</div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}
              >
                {sev.label}
              </span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs text-gray-500">Stock</div>
                <div className="text-2xl font-bold text-gray-900">{sku.current_stock}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Price</div>
                <div className="text-lg font-semibold text-gray-800">
                  ₹{sku.current_chosen_price}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
