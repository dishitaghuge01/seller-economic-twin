// mockApi.js
// All functions return Promises to match the real API's async interface.
// Artificial delays simulate network latency so loading states are visible.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOCK_SELLER = {
  seller_id: "riya_sharma",
  seller_name: "Riya Sharma",
  language_preference: "hi",
};

const MOCK_SKUS = [
  {
    sku_id: "blue_kurti",
    sku_name: "Blue Floral Kurti",
    current_stock: 6,
    reorder_point: 15,
    price_floor: 370,
    price_ceiling: 490,
    current_chosen_price: 410,
    last_action: {
      action_date: "2024-07-14",
      stockout_severity: "urgent",
      stockout_probability_5d: 0.312,
      chosen_price: 410,
      seller_message:
        "Aapke Blue Floral Kurti ka stock sirf 6 units bacha hai. 80% chance hai ki yeh 5–9 din mein khatam ho jayega.",
      delivered_via: "whatsapp",
    },
  },
  {
    sku_id: "cotton_palazzo",
    sku_name: "Cotton Palazzo Set",
    current_stock: 40,
    reorder_point: 20,
    price_floor: 490,
    price_ceiling: 650,
    current_chosen_price: 550,
    last_action: {
      action_date: "2024-07-14",
      stockout_severity: "safe",
      stockout_probability_5d: 0.004,
      chosen_price: 550,
      seller_message: "Cotton Palazzo Set ka stock 40 units hai. Abhi koi chinta nahi.",
      delivered_via: "whatsapp",
    },
  },
];

const MOCK_PRICE_ARMS = {
  blue_kurti: [
    { price_value: 370, alpha: 3.0, beta_param: 5.0, times_chosen: 4, is_active: true },
    { price_value: 390, alpha: 5.0, beta_param: 4.0, times_chosen: 6, is_active: true },
    { price_value: 410, alpha: 8.0, beta_param: 4.0, times_chosen: 9, is_active: true },
    { price_value: 430, alpha: 6.0, beta_param: 4.0, times_chosen: 7, is_active: true },
    { price_value: 450, alpha: 3.0, beta_param: 5.0, times_chosen: 4, is_active: true },
    { price_value: 470, alpha: 2.0, beta_param: 5.0, times_chosen: 3, is_active: true },
    { price_value: 490, alpha: 2.0, beta_param: 6.0, times_chosen: 3, is_active: true },
  ],
  cotton_palazzo: [
    { price_value: 490, alpha: 2.0, beta_param: 5.0, times_chosen: 3, is_active: true },
    { price_value: 510, alpha: 3.0, beta_param: 4.0, times_chosen: 4, is_active: true },
    { price_value: 530, alpha: 4.0, beta_param: 4.0, times_chosen: 5, is_active: true },
    { price_value: 550, alpha: 7.0, beta_param: 3.0, times_chosen: 8, is_active: true },
    { price_value: 570, alpha: 6.0, beta_param: 4.0, times_chosen: 7, is_active: true },
    { price_value: 590, alpha: 3.0, beta_param: 5.0, times_chosen: 4, is_active: true },
    { price_value: 610, alpha: 2.0, beta_param: 5.0, times_chosen: 3, is_active: true },
    { price_value: 630, alpha: 2.0, beta_param: 6.0, times_chosen: 3, is_active: true },
    { price_value: 650, alpha: 1.0, beta_param: 5.0, times_chosen: 2, is_active: true },
  ],
};

const MOCK_CONVERSATIONS = [
  {
    message_id: "msg_001",
    direction: "outbound",
    message_body:
      "Riya ji, aapke Blue Floral Kurti ka stock sirf 6 units bacha hai. 80% chance hai ki yeh 5–9 din mein khatam ho jayega. Aaj price ₹410 rakhi hai — yeh aapke best performing range mein hai.",
    created_at: "2024-07-14T08:00:13",
  },
  {
    message_id: "msg_002",
    direction: "inbound",
    message_body: "itni jaldi kyun?",
    created_at: "2024-07-14T09:14:22",
  },
  {
    message_id: "msg_003",
    direction: "outbound",
    message_body:
      "Pichle 14 dino mein aapke average 1.4 orders per din rahe hain. Is hisab se 6 units 4–5 din mein khatam ho sakti hain. Agar aap 2–3 din aur wait karna chahein, main daily update deta rahunga — lekin reorder karne mein delay na karein.",
    created_at: "2024-07-14T09:14:25",
  },
];

export const getSeller = async (sellerId) => {
  await delay(400);
  return { seller: MOCK_SELLER, skus: MOCK_SKUS };
};

export const getSkuHistory = async (sellerId, skuId) => {
  await delay(600);
  return {
    order_history: generateMockOrderHistory(skuId),
    price_arms: MOCK_PRICE_ARMS[skuId] || [],
    agent_actions: generateMockAgentActions(skuId),
  };
};

export const getForecast = async (sellerId, skuId) => {
  await delay(800);
  return generateMockForecast(skuId);
};

export const postMessage = async (sellerId, messageText) => {
  await delay(1200); // simulate LLM latency
  return {
    response_text:
      "Pichle 14 dino mein aapke average 1.4 orders per din rahe hain. Is hisab se 6 units 4–5 din mein khatam ho sakti hain.",
    reasoning_trace:
      "User asked: '" +
      messageText +
      "'. Forecasting tool: lambda=1.4, P(stockout day 5)=0.312. Explaining demand trend in Hindi.",
    action_summary: "ACTION: Follow-up explanation | REASON: User queried urgency | CONFIDENCE: high",
  };
};

export const updateSettings = async (sellerId, settings) => {
  await delay(300);
  // sku_id is required for price floor/ceiling updates in the new contract.
  if (settings.price_floor != null || settings.price_ceiling != null) {
    if (!settings.sku_id) {
      throw new Error("sku_id is required when updating price_floor or price_ceiling");
    }
  }
  return { status: "updated", arms_recomputed: true, new_arm_count: 5 };
};

export const triggerPricingNow = async (sellerId, skuId) => {
  await delay(800);
  const sku = MOCK_SKUS.find((s) => s.sku_id === skuId);
  if (!sku) {
    throw new Error("SKU not found");
  }

  // pick a chosen price: prefer current_chosen_price, otherwise first active arm
  let chosen_price = sku.current_chosen_price;
  const arms = MOCK_PRICE_ARMS[skuId] || [];
  if (!chosen_price) {
    if (arms.length > 0) chosen_price = arms[0].price_value;
    else chosen_price = sku.price_floor || 0;
  }

  // update mock SKU state so UI reflects change
  sku.current_chosen_price = chosen_price;

  return {
    sku_id: skuId,
    chosen_price,
    response_text: `Agent set the price to ₹${chosen_price}`,
    reasoning_trace: `Manual trigger: selected arm ${chosen_price} based on mock policy.`,
    action_summary: "ACTION: price | REASON: manual_trigger | CONFIDENCE: medium",
  };
};

export const createSku = async (sellerId, skuPayload) => {
  await delay(400);
  const slug = skuPayload.sku_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  let skuId = slug || "sku";
  let suffix = 0;
  while (MOCK_SKUS.some((sku) => sku.sku_id === skuId)) {
    suffix += 1;
    skuId = `${slug}_${suffix}`;
  }

  const newSku = {
    sku_id: skuId,
    sku_name: skuPayload.sku_name,
    current_stock: skuPayload.current_stock,
    reorder_point: skuPayload.reorder_point,
    price_floor: skuPayload.price_floor,
    price_ceiling: skuPayload.price_ceiling,
    current_chosen_price: null,
    last_action: null,
  };
  MOCK_SKUS.push(newSku);
  return newSku;
};

export const getConversations = async (sellerId) => {
  await delay(300);
  return { messages: MOCK_CONVERSATIONS };
};

// ---- Helpers ----

function generateMockOrderHistory(skuId) {
  const lambda = skuId === "blue_kurti" ? 1.4 : 2.0;
  const basePrice = skuId === "blue_kurti" ? 410 : 550;
  const cost = skuId === "blue_kurti" ? 280 : 360;
  const today = new Date();

  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));

    // Seed a visible demand shock around day 16 (index 15) for blue_kurti,
    // so ShockEventChart has something real to detect in the demo.
    let units;
    if (skuId === "blue_kurti" && i === 15) {
      units = 0; // sudden drop
    } else {
      units = Math.round(Math.random() * lambda * 2);
    }

    return {
      date: d.toISOString().split("T")[0],
      units_sold: units,
      price_charged: basePrice,
      margin: units * (basePrice - cost),
    };
  });
}

function generateMockForecast(skuId) {
  const isUrgent = skuId === "blue_kurti";
  const lambda = isUrgent ? 1.4 : 0.1;
  const stock = isUrgent ? 6 : 40;

  const fanChart = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    const p = isUrgent
      ? Math.min(1, 1 - Math.exp((-lambda * day) / stock * 1.5))
      : Math.min(1, 1 - Math.exp((-lambda * day) / stock * 0.3));
    return { day, p_stockout: Math.round(p * 1000) / 1000 };
  });

  return {
    lambda_estimated: lambda,
    starting_stock: stock,
    fan_chart: fanChart,
    p_stockout_5d: fanChart[4].p_stockout,
    p_stockout_10d: fanChart[9].p_stockout,
    median_stockout_day: isUrgent ? 6 : 99,
    stockout_ci_low: isUrgent ? 4 : 60,
    stockout_ci_high: isUrgent ? 9 : 150,
    severity: isUrgent ? "urgent" : "safe",
    confidence: "high",
    days_of_history: 30,
  };
}

function generateMockAgentActions(skuId) {
  const isUrgent = skuId === "blue_kurti";
  return [
    {
      action_id: "act_001",
      action_date: "2024-07-14",
      trigger: "scheduled",
      tool_called: "both",
      chosen_price: isUrgent ? 410 : 550,
      stockout_probability_5d: isUrgent ? 0.312 : 0.004,
      stockout_probability_10d: isUrgent ? 0.891 : 0.018,
      stockout_severity: isUrgent ? "urgent" : "safe",
      seller_message: isUrgent
        ? "Stock 6 units. Restock advised within 5 days."
        : "Stock comfortable at 40 units.",
      reasoning_trace:
        "Thompson Sampling selected Rs" +
        (isUrgent ? "410" : "550") +
        " (theta=0.67). Forecasting: lambda=" +
        (isUrgent ? "1.4" : "2.0") +
        ", severity=" +
        (isUrgent ? "urgent" : "safe") +
        ".",
      delivered_via: "whatsapp",
      created_at: "2024-07-14T08:00:12",
    },
  ];
}