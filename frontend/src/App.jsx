import { useEffect, useState } from "react";
import apiClient from "./apiClient.js";
import SellerPanel from "./components/SellerPanel.jsx";
import WhatsAppPanel from "./components/WhatsAppPanel.jsx";
import LoginScreen from "./components/LoginScreen.jsx";

const FALLBACK_SELLER_ID = import.meta.env.VITE_SELLER_ID || "riya_sharma";

export default function App() {
  const [activeTab, setActiveTab] = useState("seller");
  const [sellerProfile, setSellerProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [showWhatsAppBadge, setShowWhatsAppBadge] = useState(false);

  const clearStoredToken = () => {
    localStorage.removeItem("seller_twin_token");
  };

  const loadSellerProfile = async () => {
    setProfileLoading(true);
    setProfileError(null);

    try {
      const profile = await apiClient.getWhoAmI();
      setSellerProfile(profile);
    } catch (error) {
      setSellerProfile(null);
      if (error?.status === 401) {
        clearStoredToken();
        setProfileError(null);
      } else if (error?.status === 404) {
        setProfileError("Your account isn't set up yet. Please contact support.");
      } else {
        setProfileError(error?.message || "We couldn't load your seller profile.");
      }
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "whatsapp") {
      setShowWhatsAppBadge(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const initializeAuth = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const queryToken = searchParams.get("token");
      const existingToken = localStorage.getItem("seller_twin_token");
      const tokenToUse = queryToken || existingToken;

      if (tokenToUse) {
        localStorage.setItem("seller_twin_token", tokenToUse);
        if (queryToken) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      }

      if (!tokenToUse) {
        setSellerProfile(null);
        setProfileError(null);
        setProfileLoading(false);
        setAuthReady(true);
        return;
      }

      await loadSellerProfile();
      setAuthReady(true);
    };

    const handleAuthEvent = (event) => {
      if (event?.detail?.authenticated === false) {
        clearStoredToken();
        setSellerProfile(null);
        setProfileError(null);
        setProfileLoading(false);
      }
    };

    window.addEventListener("seller-twin-auth-change", handleAuthEvent);
    void initializeAuth();

    return () => {
      window.removeEventListener("seller-twin-auth-change", handleAuthEvent);
    };
  }, []);

  const handleSignOut = () => {
    clearStoredToken();
    setSellerProfile(null);
    setProfileError(null);
    setProfileLoading(false);
    setAuthReady(true);
  };

  const handleLoginSuccess = async (token) => {
    localStorage.setItem("seller_twin_token", token);
    setAuthReady(false);
    await loadSellerProfile();
    setAuthReady(true);
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-4 text-sm font-medium text-gray-700 shadow-sm">
          Checking your session...
        </div>
      </div>
    );
  }

  if (!sellerProfile && !profileLoading && authReady) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-4 text-sm font-medium text-gray-700 shadow-sm">
          Loading your seller profile...
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Account setup required</h2>
          <p className="mt-2 text-sm text-gray-600">{profileError}</p>
          <button
            onClick={handleSignOut}
            className="mt-5 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  const sellerId = sellerProfile?.seller_id || FALLBACK_SELLER_ID;
  const isDemoSeller = Boolean(sellerProfile?.is_demo_seller);

  const handleDemoNotification = () => {
    if (activeTab !== "whatsapp") {
      setShowWhatsAppBadge(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <h1 className="mr-auto text-sm font-semibold text-gray-800">
            Seller Economic Twin
          </h1>
          <button
            onClick={() => setActiveTab("seller")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
              (activeTab === "seller"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100")
            }
          >
            Dashboard
          </button>
          <div className="relative">
            <button
              onClick={() => setActiveTab("whatsapp")}
              className={
                "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
                (activeTab === "whatsapp"
                  ? "bg-green-600 text-white"
                  : "text-gray-600 hover:bg-gray-100")
              }
            >
              WhatsApp Thread
            </button>
            {showWhatsAppBadge && (
              <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {activeTab === "seller" ? (
          <SellerPanel sellerId={sellerId} isDemoSeller={isDemoSeller} onDemoNotification={handleDemoNotification} />
        ) : (
          <WhatsAppPanel sellerId={sellerId} />
        )}
      </main>
    </div>
  );
}
