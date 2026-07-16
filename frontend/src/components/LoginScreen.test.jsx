import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginScreen from "./LoginScreen.jsx";

describe("LoginScreen pairing flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls until the pairing session completes and calls onLoginSuccess", async () => {
    const onLoginSuccess = vi.fn();

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "pending", wa_link: "https://wa.me/123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "complete", token: "pairing-token" }),
      });

    render(<LoginScreen onLoginSuccess={onLoginSuccess} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+919876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getAllByText(/waiting for confirmation/i).length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onLoginSuccess).toHaveBeenCalledWith("pairing-token");
  });

  it("shows an expired-state message after the polling window closes", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "pending", wa_link: "https://wa.me/123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "expired" }),
      });

    render(<LoginScreen onLoginSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+919876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText(/this took too long/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
