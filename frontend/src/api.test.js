import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSeller } from "./api.js";

describe("api auth headers", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: () => "application/json",
      },
      json: () => Promise.resolve({ seller_id: "riya_sharma" }),
    });
  });

  it("attaches the current JWT from localStorage to API requests", async () => {
    localStorage.setItem("seller_twin_token", "demo-token");

    await getSeller("riya_sharma");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer demo-token",
        }),
      }),
    );
  });
});
