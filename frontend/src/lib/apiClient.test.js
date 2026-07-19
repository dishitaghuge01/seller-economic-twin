import { describe, expect, it } from "vitest";
import apiClient from "../apiClient.js";
import shimClient from "./apiClient.js";

describe("apiClient shim", () => {
  it("re-exports the shared frontend client implementation", () => {
    expect(shimClient).toBe(apiClient);
  });
});
