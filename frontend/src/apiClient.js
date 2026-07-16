import * as realApi from "./api.js";
import * as mockApi from "./mockApi.js";

const USE_MOCK =
  import.meta.env.VITE_API_URL === "mock" || !import.meta.env.VITE_API_URL;
const client = USE_MOCK ? mockApi : realApi;
export default client;
