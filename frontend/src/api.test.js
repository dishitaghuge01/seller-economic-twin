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

describe("api error handling", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("seller_twin_token", "demo-token");
  });

  it("extracts a readable message from FastAPI 422 array detail errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Content",
      headers: {
        get: () => "application/json",
      },
      text: () => Promise.resolve(JSON.stringify({
        detail: [{ loc: ["body", "sku_id"], msg: "Field required", type: "missing" }],
      })),
    });

    await expect(getSeller("riya_sharma")).rejects.toMatchObject({
      message: "body.sku_id: Field required",
      status: 422,
    });
  });

  it("preserves string detail messages from normal HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: {
        get: () => "application/json",
      },
      text: () => Promise.resolve(JSON.stringify({ detail: "Bad request" })),
    });

    await expect(getSeller("riya_sharma")).rejects.toMatchObject({
      message: "Bad request",
      status: 400,
    });
  });
});
