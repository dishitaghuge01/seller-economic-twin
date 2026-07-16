import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockSignOut } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock("./supabaseClient.js", () => ({
  default: {
    auth: {
      getSession: mockGetSession,
      signOut: mockSignOut,
    },
  },
}));

import { getSeller } from "./api.js";

describe("api auth headers", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSignOut.mockReset();
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

  it("attaches the current JWT to API requests", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "demo-token" } },
    });

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
