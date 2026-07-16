import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as mockApi from "./mockApi.js";
import * as realApi from "./api.js";

describe("apiClient", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("test_mock_to_real_api_switch", async () => {
    vi.stubEnv("VITE_API_URL", "https://example.test");
    const { default: client } = await import("./apiClient.js?test=" + Date.now());
    expect(client.getSeller).not.toBe(mockApi.getSeller);
    expect(client.getSeller).toBe(realApi.getSeller);
  });
});
