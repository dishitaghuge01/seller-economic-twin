// apiClient.js
// Router: uses the mock API during development, and the real API once
// VITE_API_URL points at an actual backend. Every component should import
// the client from here — never directly from api.js or mockApi.js.

import * as realApi from "./api.js";
import * as mockApi from "./mockApi.js";

const USE_MOCK =
  import.meta.env.VITE_API_URL === "mock" || !import.meta.env.VITE_API_URL;

const client = USE_MOCK ? mockApi : realApi;

export default client;