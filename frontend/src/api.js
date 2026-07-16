// api.js
// Real API calls — used once VITE_API_URL points at an actual backend.
// Function names and return shapes must match mockApi.js exactly, since
// apiClient.js swaps between the two with zero changes elsewhere.

import supabase from "./supabaseClient.js";

const BASE_URL = import.meta.env.VITE_API_URL;

async function getAuthHeader() {
  if (!supabase) {
    throw new Error("Authentication is not configured for this client.");
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session?.access_token) {
    throw new Error("You must be signed in to access this resource.");
  }

  return { Authorization: `Bearer ${session.access_token}` };
}

async function maybeSignOut() {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore sign-out failures and let the caller surface the original error.
  }
}

async function request(path, options = {}) {
  const authHeader = await getAuthHeader();
  const headers = {
    "Content-Type": "application/json",
    ...authHeader,
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      await maybeSignOut();
      const error = new Error("Your session has expired. Please sign in again.");
      error.status = 401;
      throw error;
    }

    const error = new Error(`API request failed: ${res.status} ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  const contentType = res.headers.get("content-type") || "";
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

export const getConversations = async (sellerId) => {
  return request(`/seller/${sellerId}/conversations`);
};