import { useEffect, useState } from "react";
import apiClient from "./apiClient.js";
import SellerPanel from "./components/SellerPanel.jsx";
import WhatsAppPanel from "./components/WhatsAppPanel.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import supabase from "./supabaseClient.js";

const FALLBACK_SELLER_ID = import.meta.env.VITE_SELLER_ID || "riya_sharma";
const AUTH_ENABLED = Boolean(supabase);

export default function App() {
  const [activeTab, setActiveTab] = useState("seller");
  const [session, setSession] = useState(null);
  const [sellerProfile, setSellerProfile] = useState(null);
  const [authReady, setAuthReady] = useState(!AUTH_ENABLED);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const loadSellerProfile = async (currentSession) => {
    if (!currentSession) {
      setSellerProfile(null);
      setProfileError(null);
      return;
    }

    setProfileLoading(true);
    setProfileError(null);

    try {
      const profile = await apiClient.getWhoAmI();
      setSellerProfile(profile);
    } catch (error) {
      setSellerProfile(null);
      if (error?.status === 404) {
        setProfileError("Your account isn't set up yet. Please contact support.");
      } else {
        setProfileError(error?.message || "We couldn't load your seller profile.");
      }
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setAuthReady(true);
      return undefined;
    }

    let isActive = true;
    let authSubscription = null;

    const initializeAuth = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!isActive) return;

      setSession(currentSession);
      if (currentSession) {
        await loadSellerProfile(currentSession);
      } else {
        setSellerProfile(null);
        setProfileError(null);
        setProfileLoading(false);
      }

      setAuthReady(true);

      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!isActive) return;
        setSession(nextSession);
        if (nextSession) {
          loadSellerProfile(nextSession);
        } else {
          setSellerProfile(null);
          setProfileError(null);
          setProfileLoading(false);
        }
      });

      authSubscription = data.subscription;
    };

    initializeAuth();

    return () => {
      isActive = false;
      authSubscription?.unsubscribe?.();
    };
  }, []);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
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

  if (!AUTH_ENABLED) {
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
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-6">
          {activeTab === "seller" ? (
            <SellerPanel sellerId={FALLBACK_SELLER_ID} />
          ) : (
            <WhatsAppPanel sellerId={FALLBACK_SELLER_ID} />
          )}
        </main>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
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
          <SellerPanel sellerId={sellerId} />
        ) : (
          <WhatsAppPanel sellerId={sellerId} />
        )}
      </main>
    </div>
  );
}
