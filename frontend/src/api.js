// api.js
// Real API calls — used once VITE_API_URL points at an actual backend.
// Function names and return shapes must match mockApi.js exactly, since
// apiClient.js swaps between the two with zero changes elsewhere.

const BASE_URL = import.meta.env.VITE_API_URL;

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

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

export const getConversations = async (sellerId) => {
  return request(`/seller/${sellerId}/conversations`);
};