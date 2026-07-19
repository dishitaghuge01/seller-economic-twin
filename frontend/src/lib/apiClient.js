// Re-export shim so redesigned components importing "@/lib/apiClient" reach
// the real implementation at "../apiClient.js". Do not add logic here.
export { default } from "../apiClient.js";
