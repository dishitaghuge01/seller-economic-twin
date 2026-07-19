import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";

const STORAGE_KEY = "uday_ui_lang";

const DICT = {
  // Header / nav
  "nav.dashboard": { hi: "डैशबोर्ड", en: "Dashboard" },
  "nav.whatsapp": { hi: "व्हाट्सएप", en: "WhatsApp" },
  "nav.whatsappLong": { hi: "व्हाट्सएप चैट", en: "WhatsApp thread" },
  "nav.logout": { hi: "लॉग आउट", en: "Log out" },
  "lang.toggleAria": { hi: "भाषा बदलें", en: "Change language" },

  // Common
  "common.cancel": { hi: "रद्द करें", en: "Cancel" },

  // Login
  "login.tagline": { hi: "हर सुबह अपनी दुकान के साथ उठिए।", en: "Rise with your shop, every morning." },
  "login.welcome": { hi: "वापस आपका स्वागत है", en: "Welcome back" },
  "login.subtitle": { hi: "व्हाट्सएप से साइन इन कीजिए। उदय आपकी दुकान पर नज़र रखेगा।", en: "Sign in with WhatsApp. Uday will start watching your shop." },
  "login.phoneLabel": { hi: "फ़ोन नंबर", en: "Phone number" },
  "login.nameLabel": { hi: "आपका नाम", en: "Your name" },
  "login.optional": { hi: "(वैकल्पिक)", en: "(optional)" },
  "login.namePlaceholder": { hi: "रिया शर्मा", en: "Riya Sharma" },
  "login.phoneRequired": { hi: "फ़ोन नंबर ज़रूरी है।", en: "Phone number required." },
  "login.continue": { hi: "आगे बढ़ें", en: "Continue" },
  "login.confirmTitle": { hi: "व्हाट्सएप पर पुष्टि कीजिए", en: "Confirm on WhatsApp" },
  "login.confirmSub": { hi: "व्हाट्सएप खोलिए और पेयरिंग मैसेज भेज दीजिए। हम आपको अपने आप साइन इन कर देंगे।", en: "Open WhatsApp and send the pairing message. We will sign you in automatically." },
  "login.openWa": { hi: "व्हाट्सएप खोलें", en: "Open WhatsApp" },
  "login.waiting": { hi: "पुष्टि का इंतज़ार…", en: "Waiting for confirmation" },
  "login.retry": { hi: "फिर से कोशिश करें", en: "Retry pairing" },
  "login.diffNumber": { hi: "दूसरा नंबर इस्तेमाल करें", en: "Use a different number" },
  "login.exploring": { hi: "बस देखने आए हैं?", en: "Just exploring?" },
  "login.viewDemo": { hi: "डेमो डैशबोर्ड देखें (रिया शर्मा)", en: "View demo dashboard (Riya Sharma)" },

  // Dashboard
  "dash.welcomeBack": { hi: "वापस स्वागत है", en: "Welcome back" },
  "dash.addProduct": { hi: "प्रोडक्ट जोड़ें", en: "Add product" },
  "dash.settings": { hi: "सेटिंग्स", en: "Settings" },
  "dash.loadingShop": { hi: "आपकी दुकान लोड हो रही है", en: "Loading your shop" },
  "dash.noProductsTitle": { hi: "अभी कोई प्रोडक्ट नहीं है।", en: "No products yet." },
  "dash.noProductsSub": { hi: "पहला प्रोडक्ट जोड़िए और उदय उस पर नज़र रखना शुरू कर देगा।", en: "Add your first product and Uday will start watching it." },
  "dash.addFirst": { hi: "पहला प्रोडक्ट जोड़ें", en: "Add your first product" },
  "dash.yourProducts": { hi: "आपके प्रोडक्ट", en: "Your products" },
  "dash.runPricingNow": { hi: "अभी प्राइसिंग चलाएँ", en: "Run Pricing Now" },
  "dash.pricing": { hi: "प्राइसिंग हो रही है…", en: "Pricing..." },
  "dash.pricedAt": { hi: (v) => `₹${v.price} पर प्राइस सेट हुआ।`, en: (v) => `Priced at ₹${v.price}.` },

  // Section titles
  "sec.priceExploration": { hi: "प्राइस एक्सप्लोरेशन", en: "Price exploration" },
  "sec.priceExplorationSub": { hi: (v) => `उदय ने ${v.name} के लिए कौन-कौन से दाम आज़माए और कौन सा जीत रहा है।`, en: (v) => `Which prices Uday tested for ${v.name} and which one is winning.` },
  "sec.forecast": { hi: "स्टॉक-आउٹ पूर्वानुमान", en: "Stockout forecast" },
  "sec.forecastSub": { hi: "अगले 30 दिनों में स्टॉक ख़त्म होने की कितनी संभावना है।", en: "How likely you are to run out over the next 30 days." },
  "sec.sales": { hi: "बिक्री रुझान", en: "Sales trend" },
  "sec.salesSub": { hi: "पिछले 30 दिनों की बिक्री। अचानक गिरावट हाइलाइट होती है।", en: "Last 30 days of units sold. Sudden dips are flagged." },
  "sec.reasoning": { hi: "एजेंट रीज़निंग लॉग", en: "Agent reasoning log" },
  "sec.reasoningSub": { hi: "उदय ने जो भी फ़ैसला लिया और जो मैसेज व्हाट्सएप पर भेजा, सब यहाँ मौजूद है।", en: "Every decision Uday made and the message that went to WhatsApp." },

  // SKU card
  "sku.stock": { hi: "स्टॉक", en: "STOCK" },
  "sku.price": { hi: "दाम", en: "PRICE" },
  "sku.urgent": { hi: "तुरंत", en: "URGENT" },
  "sku.watch": { hi: "नज़र रखें", en: "WATCH" },
  "sku.safe": { hi: "सुरक्षित", en: "SAFE" },

  // Demo
  "demo.title": { hi: "डेमो सिमुलेशन", en: "Demo simulation" },
  "demo.sub": { hi: "6 दिन का स्क्रिप्टेड रन। देखिए उदय कैसे स्टॉक कम होने और डिमांड शॉक पर प्रतिक्रिया देता है।", en: "6 day scripted run. Watch Uday react to a depletion and a demand shock." },
  "demo.run": { hi: "डेमो चलाएँ", en: "Run demo" },
  "demo.resume": { hi: "डेमो जारी रखें", en: "Resume demo" },
  "demo.stop": { hi: "रोकें", en: "Stop" },
  "demo.reset": { hi: "डेमो रीसेट करें", en: "Reset demo" },
  "demo.confirmReset": { hi: "प्रगति रीसेट करें?", en: "Reset progress?" },
  "demo.confirmYes": { hi: "हाँ, रीसेट करें", en: "Yes, reset" },
  "demo.confirmCancel": { hi: "रद्द करें", en: "Cancel" },
  "demo.dayOf": { hi: (v) => `दिन ${v.day} / ${v.total}`, en: (v) => `Day ${v.day} of ${v.total}` },
  "demo.simulating": { hi: (v) => `दिन ${v.day} / ${v.total}, सिमुलेट हो रहा है…`, en: (v) => `Day ${v.day} of ${v.total}, simulating…` },
  "demo.pausedAt": { hi: (v) => `दिन ${v.day} / ${v.total} पर रुका है`, en: (v) => `Paused at day ${v.day} of ${v.total}` },
  "demo.complete": { hi: "डेमो पूरा हुआ", en: "Demo complete" },
  "demo.pausedError": { hi: "रुका (त्रुटि)", en: "Paused (error)" },
  "demo.logDay": { hi: (v) => `दिन ${v.day}.`, en: (v) => `Day ${v.day}.` },
  "demo.logNoAction": { hi: "कोई कदम ज़रूरी नहीं।", en: "No action needed." },
  "demo.logShock": { hi: "डिमांड शॉक पकड़ा गया।", en: "Demand shock detected." },

  // Price exploration chart
  "chart.loadingArms": { hi: "प्राइस डेटा लोड हो रहा है", en: "Loading price arms" },
  "chart.price": { hi: "दाम", en: "Price" },
  "chart.timesChosen": { hi: "बार चुना", en: "times chosen" },
  "chart.timesChosenCol": { hi: "कितनी बार चुना", en: "Times chosen" },
  "chart.posteriorMean": { hi: "पोस्टीरियर मीन", en: "Posterior mean" },
  "chart.ci95": { hi: "95% CI", en: "95% CI" },
  "chart.best": { hi: "बेस्ट", en: "BEST" },
  "chart.about": { hi: "इस चार्ट के बारे में", en: "About this chart" },
  "chart.aboutBody": { hi: "उदय एक छोटी रेंज में अलग-अलग दाम आज़माता है और याद रखता है कि किस पर सबसे ज़्यादा ऑर्डर आए। सबसे लंबी बार वो दाम है जो अभी सबसे बेहतर बिक रहा है। जैसे-जैसे बिक्री बढ़ती है, आँकड़े और भरोसेमंद होते जाते हैं और उदय जीतने वाले दाम को ज़्यादा बार चुनने लगता है।", en: "Uday tries different prices in a small range and remembers which one gets you the most orders. The tallest bar is the price we picked most often because it has been selling best so far. As you sell more, the numbers become more confident and Uday chooses the winner more often." },

  // Forecast chart
  "forecast.loading": { hi: "पूर्वानुमान बन रहा है", en: "Running forecast" },
  "forecast.restockUrgent": { hi: "स्टॉक तुरंत भरें।", en: "Restock recommended" },
  "forecast.stockoutLikely": { hi: (v) => `मौजूदा बिक्री पर ${v.days} दिनों में स्टॉक ख़त्म होने की संभावना है।`, en: (v) => `Stockout likely within ${v.days} days at current sales rate.` },
  "forecast.30day": { hi: "30 दिन में स्टॉक ख़त्म होने की संभावना", en: "30 day stockout probability" },
  "forecast.refresh": { hi: "रीफ़्रेश", en: "Refresh" },
  "forecast.pStockout": { hi: "स्टॉक-आउट संभावना", en: "P(stockout)" },
  "forecast.dayLabel": { hi: "दिन", en: "Day" },
  "forecast.likelyDay": { hi: "स्टॉक-आउट का अनुमानित दिन", en: "Likely stockout day" },
  "forecast.range80": { hi: "80% रेंज", en: "80% range" },
  "forecast.ordersPerDay": { hi: "रोज़ के ऑर्डर", en: "Orders per day" },

  // Sales / shock chart
  "shock.detected": { hi: (v) => `${v.date} को मार्केट शिफ़्ट दिखा। बिक्री ट्रेलिंग औसत से 40% से ज़्यादा गिरी।`, en: (v) => `Market shift detected on ${v.date}. Sales dropped over 40% from trailing average.` },
  "shock.units": { hi: "यूनिट", en: "units" },
  "shock.date": { hi: "तारीख़", en: "Date" },
  "shock.shiftLabel": { hi: "शिफ़्ट", en: "shift" },

  // Reasoning log
  "log.empty": { hi: "अभी कोई एजेंट एक्शन नहीं है। उदय हर प्राइस डिसीज़न यहाँ दर्ज करेगा।", en: "No agent actions yet. Uday will log every price decision here." },
  "log.scheduled": { hi: "शेड्यूल्ड", en: "Scheduled" },
  "log.userQuery": { hi: "यूज़र क्वेरी", en: "User query" },
  "log.tool": { hi: "टूल", en: "Tool" },
  "log.sellerSaw": { hi: "जो सेलर को दिखा", en: "What the seller saw" },
  "log.showReasoning": { hi: "रीज़निंग दिखाएँ", en: "Show reasoning" },
  "log.askUday": { hi: "उदय से सवाल पूछिए", en: "Ask Uday a question" },
  "log.askPlaceholder": { hi: "जैसे: नीली कुर्ती और महँगी करें?", en: "e.g. Blue Kurti aur mehenga karein?" },

  // WhatsApp panel + compose
  "wa.loading": { hi: "बातचीत लोड हो रही है", en: "Loading conversation" },
  "wa.agentSuffix": { hi: "एजेंट", en: "agent" },
  "wa.online": { hi: "ऑनलाइन", en: "online" },
  "wa.showReasoning": { hi: "रीज़निंग दिखाएँ", en: "Show reasoning" },
  "wa.composePlaceholder": { hi: "प्राइसिंग के बारे में पूछिए…", en: "Type a message" },
  "wa.send": { hi: "भेजें", en: "Send" },
  "wa.hide": { hi: "छिपाएँ", en: "Hide" },
  "wa.viewReasoning": { hi: "पूरी रीज़निंग देखें", en: "View full reasoning" },

  // Settings drawer
  "settings.title": { hi: "सेटिंग्स", en: "Settings" },
  "settings.priceRange": { hi: "प्रोडक्ट प्राइस रेंज", en: "Product price range" },
  "settings.floor": { hi: "न्यूनतम (₹)", en: "Floor (₹)" },
  "settings.ceiling": { hi: "अधिकतम (₹)", en: "Ceiling (₹)" },
  "settings.invalidRange": { hi: "अधिकतम, न्यूनतम से बड़ा होना चाहिए।", en: "Ceiling must be greater than floor." },
  "settings.account": { hi: "अकाउंट सेटिंग्स", en: "Account settings" },
  "settings.dailyAlert": { hi: "रोज़ का अलर्ट समय", en: "Daily alert time" },
  "settings.alertLang": { hi: "अलर्ट भाषा", en: "Alert language" },
  "settings.notifyPrice": { hi: "प्राइस बदलने पर सूचना", en: "Notify on price change" },
  "settings.notifyStock": { hi: "स्टॉक-आउट जोखिम पर सूचना", en: "Notify on stockout risk" },
  "settings.threshold": { hi: "प्राइस बदलाव थ्रेशोल्ड", en: "Price change threshold" },
  "settings.save": { hi: "सेटिंग्स सेव करें", en: "Save settings" },
  "settings.saving": { hi: "सेव हो रहा है…", en: "Saving..." },
  "settings.saved": { hi: (v) => `सेटिंग्स सेव हो गईं। उदय ${v.count} प्राइस पॉइंट आज़माएगा।`, en: (v) => `Settings saved. Uday will explore ${v.count} price points.` },

  // Add product modal
  "add.title": { hi: "प्रोडक्ट जोड़ें", en: "Add product" },
  "add.productName": { hi: "प्रोडक्ट का नाम", en: "Product name" },
  "add.namePlaceholder": { hi: "हरी अनारकली कुर्ती", en: "Green Anarkali Kurti" },
  "add.stock": { hi: "मौजूदा स्टॉक", en: "Current stock" },
  "add.reorder": { hi: "रीऑर्डर पॉइंट", en: "Reorder point" },
  "add.cost": { hi: "यूनिट लागत (₹)", en: "Unit cost (₹)" },
  "add.floor": { hi: "न्यूनतम दाम (₹)", en: "Price floor (₹)" },
  "add.ceiling": { hi: "अधिकतम दाम (₹)", en: "Price ceiling (₹)" },
  "add.create": { hi: "प्रोडक्ट बनाएँ", en: "Create product" },
  "add.creating": { hi: "बन रहा है…", en: "Creating..." },
  "add.added": { hi: (v) => `${v.name} जुड़ गया।`, en: (v) => `${v.name} added.` },
};

const resolveText = (key, lang, vars) => {
  const entry = DICT[key];
  if (!entry) return key;
  const value = entry[lang] ?? entry.en ?? key;
  if (typeof value === "function") return value(vars || {});
  return value;
};

const LangCtx = createContext({ lang: "en", setLang: (_next) => { void _next; }, t: (k, vars) => resolveText(k, "en", vars) });

function readInitial() {
  if (typeof window === "undefined") return "hi";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "hi" || v === "en") return v;
  } catch { /* empty */ }
  return "hi";
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState("hi");

  useEffect(() => {
    setLangState(readInitial());
  }, []);

  const setLang = useCallback((next) => {
    setLangState(next);
    // setLang is the single source of truth for the stored language key.
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* empty */ }
  }, []);

  const t = useCallback((key, vars) => resolveText(key, lang, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

export function useT() {
  return useContext(LangCtx).t;
}
