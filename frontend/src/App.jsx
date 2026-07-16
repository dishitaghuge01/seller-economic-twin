import { useState } from "react";
import SellerPanel from "./components/SellerPanel.jsx";
import WhatsAppPanel from "./components/WhatsAppPanel.jsx";

const SELLER_ID = import.meta.env.VITE_SELLER_ID || "riya_sharma";

export default function App() {
  const [activeTab, setActiveTab] = useState("seller");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-800 mr-auto">
            Seller Economic Twin
          </h1>
          <button
            onClick={() => setActiveTab("seller")}
            className={
              "px-4 py-2 rounded-full text-sm font-medium transition-colors " +
              (activeTab === "seller"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100")
            }
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab("whatsapp")}
            className={
              "px-4 py-2 rounded-full text-sm font-medium transition-colors " +
              (activeTab === "whatsapp"
                ? "bg-green-600 text-white"
                : "text-gray-600 hover:bg-gray-100")
            }
          >
            WhatsApp Thread
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === "seller" ? (
          <SellerPanel sellerId={SELLER_ID} />
        ) : (
          <WhatsAppPanel sellerId={SELLER_ID} />
        )}
      </main>
    </div>
  );
}
