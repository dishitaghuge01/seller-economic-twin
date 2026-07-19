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

async function requestUnauthenticated(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    ...(options.body ? { body: options.body } : {}),
  });

  const contentType = res.headers?.get?.("content-type") || "";
  let bodyText = "";
  let parsedBody = null;

  if (typeof res.text === "function") {
    bodyText = await res.text();
    if (contentType.includes("application/json") && bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = null;
      }
    }
  } else if (typeof res.json === "function") {
    parsedBody = await res.json();
  }

  if (!res.ok) {
    const detail = _extractErrorMessage(parsedBody, bodyText, res);
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }

  if (parsedBody !== null) {
    return parsedBody;
  }

  return bodyText ? JSON.parse(bodyText) : null;
}

export function _extractErrorMessage(parsedBody, bodyText, res) {
  const detail = parsedBody?.detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const loc = Array.isArray(item.loc)
          ? item.loc.filter(Boolean).join(".")
          : "";
        const message = typeof item.msg === "string" ? item.msg : "";

        if (loc && message) {
          return `${loc}: ${message}`;
        }

        return message || loc || null;
      })
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join("; ");
    }
  }

  if (typeof detail === "string" && detail) {
    return detail;
  }

  if (typeof parsedBody?.message === "string" && parsedBody.message) {
    return parsedBody.message;
  }

  if (typeof bodyText === "string" && bodyText) {
    return bodyText;
  }

  return `${res.status} ${res.statusText}`;
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

  const contentType = res.headers?.get?.("content-type") || "";
  let bodyText = "";
  let parsedBody = null;

  if (typeof res.text === "function") {
    bodyText = await res.text();
    if (contentType.includes("application/json") && bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = null;
      }
    }
  } else if (typeof res.json === "function") {
    parsedBody = await res.json();
  }

  if (!res.ok) {
    if (res.status === 401) {
      maybeSignOut();
      const error = new Error("Your session has expired. Please sign in again.");
      error.status = 401;
      throw error;
    }

    const detail = _extractErrorMessage(parsedBody, bodyText, res);
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }

  if (parsedBody !== null) {
    return parsedBody;
  }

  return bodyText ? JSON.parse(bodyText) : null;
}

export const startPairing = async ({ phone, name }) => {
  return requestUnauthenticated("/auth/start-pairing", {
    method: "POST",
    body: JSON.stringify({
      phone_number: phone,
      ...(name ? { seller_name: name } : {}),
    }),
  });
};

export const getPairingStatus = async (phone) => {
  const encodedPhone = encodeURIComponent(phone);
  return requestUnauthenticated(`/auth/pairing-status?phone_number=${encodedPhone}`);
};

export const demoLogin = async () => {
  const res = await fetch(`${BASE_URL}/auth/demo-login`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (res.status === 404) {
    throw new Error("Demo login is not available in this deployment.");
  }

  if (!res.ok) {
    const bodyText = await res.text();
    const error = new Error(bodyText || "Demo login failed.");
    error.status = res.status;
    throw error;
  }

  return res.json();
};

export const getWhoAmI = async () => {
  return request("/seller/me");
};

export const startDemo = async (sellerId) => {
  return request(`/seller/${sellerId}/demo/start`, {
    method: "POST",
  });
};

export const stepDemo = async (sellerId) => {
  return request(`/seller/${sellerId}/demo/step`, {
    method: "POST",
  });
};

export const resetDemo = async (sellerId) => {
  return request(`/seller/${sellerId}/demo/reset`, {
    method: "POST",
  });
};

export const getDemoStatus = async (sellerId) => {
  return request(`/seller/${sellerId}/demo/status`);
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