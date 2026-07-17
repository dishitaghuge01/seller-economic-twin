// api.js
// Real API calls — used once VITE_API_URL points at an actual backend.
// Function names and return shapes must match mockApi.js exactly, since
// apiClient.js swaps between the two with zero changes elsewhere.

const BASE_URL = import.meta.env.VITE_API_URL;

function getAuthHeader() {
  const token = localStorage.getItem("seller_twin_token");
  if (!token) {
    throw new Error("You must be signed in to access this resource.");
  }

  return { Authorization: `Bearer ${token}` };
}

function maybeSignOut() {
  localStorage.removeItem("seller_twin_token");
  window.dispatchEvent(new CustomEvent("seller-twin-auth-change", { detail: { authenticated: false } }));
}

async function request(path, options = {}) {
  const authHeader = getAuthHeader();
  const headers = {
    "Content-Type": "application/json",
    ...authHeader,
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();
  const parsedBody = contentType.includes("application/json") && bodyText ? JSON.parse(bodyText) : null;

  if (!res.ok) {
    if (res.status === 401) {
      maybeSignOut();
      const error = new Error("Your session has expired. Please sign in again.");
      error.status = 401;
      throw error;
    }

    const detail = parsedBody?.detail || parsedBody?.message || bodyText || `${res.status} ${res.statusText}`;
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }

  if (parsedBody !== null) {
    return parsedBody;
  }

  return bodyText ? JSON.parse(bodyText) : null;
  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const getWhoAmI = async () => {
  return request("/seller/me");
};

export const getSeller = async (sellerId) => {
  return request(`/seller/${sellerId}`);
};

export const getSkuHistory = async (sellerId, skuId) => {
  return request(`/seller/${sellerId}/sku/${skuId}/history`);
};

export const getForecast = async (sellerId, skuId) => {
  return request(`/seller/${sellerId}/sku/${skuId}/forecast`);
};

export const postMessage = async (sellerId, messageText) => {
  return request(`/seller/${sellerId}/message`, {
    method: "POST",
    body: JSON.stringify({ message: messageText }),
  });
};

export const updateSettings = async (sellerId, settings) => {
  return request(`/seller/${sellerId}/settings`, {
    method: "POST",
    body: JSON.stringify(settings),
  });
};

export const triggerPricingNow = async (sellerId, skuId) => {
  return request(`/seller/${sellerId}/sku/${skuId}/trigger`, {
    method: "POST",
  });
};

export const createSku = async (sellerId, skuPayload) => {
  return request(`/seller/${sellerId}/skus`, {
    method: "POST",
    body: JSON.stringify(skuPayload),
  });
};

export const getConversations = async (sellerId) => {
  return request(`/seller/${sellerId}/conversations`);
};