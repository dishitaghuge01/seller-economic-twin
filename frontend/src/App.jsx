import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import apiClient from "./apiClient.js";
import SellerPanel from "./components/SellerPanel.jsx";
import WhatsAppPanel from "./components/WhatsAppPanel.jsx";
import { WhatsAppToast } from "./components/WhatsAppToast.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { Wordmark } from "./components/Wordmark.jsx";
import { LanguageToggle } from "./components/LanguageToggle.jsx";
import { useLang } from "./lib/i18n.jsx";

const FALLBACK_SELLER_ID = import.meta.env.VITE_SELLER_ID || "riya_sharma";

export default function App() {
  const { lang, setLang, t } = useLang();
  const [activeTab, setActiveTab] = useState("seller");
  const [sellerProfile, setSellerProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [showWhatsAppBadge, setShowWhatsAppBadge] = useState(false);
  const [toast, setToast] = useState(null);

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

  useEffect(() => {
    if (!sellerProfile) return;
    const stored = window.localStorage.getItem("uday_ui_lang");
    if (stored === "hi" || stored === "en") return;
    const sellerId = sellerProfile?.seller_id || FALLBACK_SELLER_ID;
    apiClient.getSeller(sellerId)
      .then((res) => {
        const pref = res?.seller?.language_preference;
        if (pref === "en" || pref === "hi") setLang(pref);
      })
      .catch(() => {});
  }, [sellerProfile, setLang]);

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

  const handleDemoNotification = (messageText) => {
    if (activeTab !== "whatsapp") {
      setShowWhatsAppBadge(true);
      setToast({ message: messageText || "New WhatsApp notification", senderName: "उदय एजेंट" });
    }
  };

  if (!authReady) {
    return (
      <div className={`min-h-screen bg-background ${lang === "hi" ? "font-devanagari" : ""}`}>
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="rounded-2xl border border-border bg-card px-6 py-4 text-sm font-medium text-muted-foreground shadow-sm">
            {t("dash.loadingShop")}
          </div>
        </div>
      </div>
    );
  }

  if (!sellerProfile && !profileLoading && authReady) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (profileLoading) {
    return (
      <div className={`min-h-screen bg-background ${lang === "hi" ? "font-devanagari" : ""}`}>
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="rounded-2xl border border-border bg-card px-6 py-4 text-sm font-medium text-muted-foreground shadow-sm">
            Loading your seller profile...
          </div>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className={`min-h-screen bg-background ${lang === "hi" ? "font-devanagari" : ""}`}>
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <h2 className="font-display text-lg font-semibold">Account setup required</h2>
            <p className="mt-2 text-sm text-muted-foreground">{profileError}</p>
            <button onClick={handleSignOut} className="mt-5 rounded-lg bg-jamuni px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sellerId = sellerProfile?.seller_id || FALLBACK_SELLER_ID;
  const isDemoSeller = Boolean(sellerProfile?.is_demo_seller);

  return (
    <div className={`min-h-screen bg-background ${lang === "hi" ? "font-devanagari" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <Wordmark size="md" />
            <nav className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
              <button
                onClick={() => setActiveTab("seller")}
                className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${activeTab === "seller" ? "bg-jamuni text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("nav.dashboard")}
              </button>
              <button
                onClick={() => {
                  setActiveTab("whatsapp");
                  setShowWhatsAppBadge(false);
                }}
                className={`relative rounded-full px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${activeTab === "whatsapp" ? "bg-jamuni text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <span className="sm:hidden">{t("nav.whatsapp")}</span>
                <span className="hidden sm:inline">{t("nav.whatsappLong")}</span>
                {showWhatsAppBadge && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-urgent ring-2 ring-card" />}
              </button>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageToggle />
            <button onClick={handleSignOut} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted sm:px-3">
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("nav.logout")}</span>
            </button>
          </div>
        </div>
      </header>

      {activeTab === "seller" ? (
        <ErrorBoundary>
          <SellerPanel sellerId={sellerId} isDemoSeller={isDemoSeller} onDemoNotification={handleDemoNotification} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary>
          <WhatsAppPanel sellerId={sellerId} />
        </ErrorBoundary>
      )}

      {toast && (
        <WhatsAppToast
          senderName={toast.senderName}
          message={toast.message}
          onDismiss={() => setToast(null)}
          onClick={() => {
            setActiveTab("whatsapp");
            setShowWhatsAppBadge(false);
            setToast(null);
          }}
        />
      )}
    </div>
  );
}
