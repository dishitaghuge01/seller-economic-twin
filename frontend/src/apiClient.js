// apiClient.js
// Router: uses the mock API during development, and the real API once
// VITE_API_URL points at an actual backend. Every component should import
// the client from here — never directly from api.js or mockApi.js.

import * as realApi from "./api.js";
import * as mockApi from "./mockApi.js";

const USE_MOCK =
  import.meta.env.VITE_API_URL === "mock" ||
  (!import.meta.env.VITE_API_URL && (import.meta.env.MODE === "test" || import.meta.env.VITEST));

const api = USE_MOCK ? mockApi : realApi;

const apiClient = { ...api };

export default apiClient;