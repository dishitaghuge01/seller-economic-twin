// Mock API layer for Seller Economic Twin
// Simulates network latency; matches the exact contract the real backend will implement later.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const SELLERS = {
  riya_sharma: {
    seller: { seller_id: "riya_sharma", seller_name: "Riya Sharma", language_preference: "hi" },
    skus: [
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
    ],
  },
};

const PRICE_ARMS = {
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

const AGENT_ACTIONS = {
  blue_kurti: [
    {
      action_id: "act_001",
      action_date: "2024-07-14",
      trigger: "scheduled",
      tool_called: "both",
      chosen_price: 410,
      stockout_probability_5d: 0.312,
      stockout_probability_10d: 0.891,
      stockout_severity: "urgent",
      seller_message: "Stock 6 units. Restock advised within 5 days.",
      reasoning_trace:
        "Thompson Sampling selected Rs410 (theta=0.67, alpha=8, beta=4). Forecasting tool: lambda=1.4, P(stockout by day 5)=0.312, severity=urgent. Recommending restock alert and holding at Rs410.",
      delivered_via: "whatsapp",
      created_at: "2024-07-14T08:00:12",
      action_summary: "ACTION: Hold price at Rs410 | REASON: Best posterior mean | CONFIDENCE: high",
    },
  ],
  cotton_palazzo: [
    {
      action_id: "act_002",
      action_date: "2024-07-14",
      trigger: "scheduled",
      tool_called: "both",
      chosen_price: 550,
      stockout_probability_5d: 0.004,
      stockout_probability_10d: 0.018,
      stockout_severity: "safe",
      seller_message: "Cotton Palazzo Set ka stock 40 units hai. Abhi koi chinta nahi.",
      reasoning_trace:
        "Thompson Sampling selected Rs550 (theta=0.70, alpha=7, beta=3). Forecasting tool: lambda=2.0, P(stockout by day 5)=0.004, severity=safe. Holding price.",
      delivered_via: "whatsapp",
      created_at: "2024-07-14T08:00:15",
      action_summary: "ACTION: Hold price at Rs550 | REASON: Safe stock levels | CONFIDENCE: high",
    },
  ],
};

// Deterministic pseudo-random for reproducible demo shock
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateOrderHistory(skuId) {
  const cfg =
    skuId === "blue_kurti"
      ? { lambda: 1.4, price: 410, cost: 280, seed: 42 }
      : { lambda: 2.0, price: 550, cost: 360, seed: 77 };
  const rand = seededRandom(cfg.seed);
  const today = new Date();
  const rows = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayIdx = 29 - i;
    let units = Math.round(rand() * cfg.lambda * 2);
    // seed a visible shock around day 16 (index 15) for blue_kurti
    if (skuId === "blue_kurti" && dayIdx === 15) units = 0;
    if (skuId === "blue_kurti" && dayIdx === 16) units = 0;
    const margin = units * (cfg.price - cfg.cost);
    rows.push({
      date: d.toISOString().slice(0, 10),
      units_sold: units,
      price_charged: cfg.price,
      margin,
    });
  }
  return rows;
}

function generateFanChart(skuId) {
  if (skuId === "blue_kurti") {
    // exponential saturation towards 1 over 30 days, matching provided 10-point seed
    const seed = [0.002, 0.018, 0.064, 0.164, 0.312, 0.488, 0.642, 0.77, 0.863, 0.921];
    const out = seed.map((p, i) => ({ day: i + 1, p_stockout: p }));
    let last = 0.921;
    for (let d = 11; d <= 30; d++) {
      last = last + (1 - last) * 0.35;
      out.push({ day: d, p_stockout: Math.min(0.999, +last.toFixed(3)) });
    }
    return out;
  }
  // cotton_palazzo - flat/slow curve
  const out = [];
  for (let d = 1; d <= 30; d++) {
    const p = 1 - Math.exp(-d / 120);
    out.push({ day: d, p_stockout: +p.toFixed(4) });
  }
  return out;
}

export async function getSeller(sellerId) {
  await delay(400);
  const data = SELLERS[sellerId] || SELLERS.riya_sharma;
  return JSON.parse(JSON.stringify(data));
}

export async function getSkuHistory(sellerId, skuId) {
  await delay(600);
  return {
    order_history: generateOrderHistory(skuId),
    price_arms: PRICE_ARMS[skuId] || [],
    agent_actions: AGENT_ACTIONS[skuId] || [],
  };
}

export async function getForecast(sellerId, skuId) {
  await delay(800);
  if (skuId === "blue_kurti") {
    return {
      lambda_estimated: 1.4,
      starting_stock: 6,
      fan_chart: generateFanChart(skuId),
      p_stockout_5d: 0.312,
      p_stockout_10d: 0.921,
      median_stockout_day: 6,
      stockout_ci_low: 4,
      stockout_ci_high: 9,
      severity: "urgent",
      confidence: "high",
      days_of_history: 30,
    };
  }
  return {
    lambda_estimated: 2.0,
    starting_stock: 40,
    fan_chart: generateFanChart(skuId),
    p_stockout_5d: 0.004,
    p_stockout_10d: 0.018,
    median_stockout_day: 99,
    stockout_ci_low: 60,
    stockout_ci_high: 150,
    severity: "safe",
    confidence: "high",
    days_of_history: 30,
  };
}

export async function postMessage(sellerId, messageText) {
  await delay(1200);
  return {
    response_text:
      "Pichle 14 dino mein aapke average 1.4 orders per din rahe hain. Is hisab se 6 units 4–5 din mein khatam ho sakti hain.",
    reasoning_trace: `User asked: '${messageText}'. Forecasting tool: lambda=1.4, P(stockout day 5)=0.312. Explaining demand trend in Hindi.`,
    action_summary: "ACTION: Follow-up explanation | REASON: User queried urgency | CONFIDENCE: high",
  };
}

export async function updateSettings(sellerId, settings) {
  await delay(300);
  return { status: "updated", arms_recomputed: true, new_arm_count: 5 };
}

export async function getConversations(sellerId) {
  await delay(300);
  return {
    messages: [
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
    ],
  };
}
