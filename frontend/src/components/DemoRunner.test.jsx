import { render, screen } from "@testing-library/react";
import { DemoRunner } from "./DemoRunner.jsx";
import { LanguageProvider } from "../lib/i18n.jsx";
import apiClient from "../apiClient.js";

vi.mock("../apiClient.js");

describe("DemoRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.getDemoStatus = vi.fn().mockResolvedValue({ status: "not_started" });
  });

  test("renders localized demo actions", async () => {
    window.localStorage.setItem("uday_ui_lang", "en");

    render(
      <LanguageProvider>
        <DemoRunner sellerId="s1" isDemoSeller={true} />
      </LanguageProvider>,
    );

    expect(await screen.findByRole("button", { name: /Run demo/i })).toBeInTheDocument();
    expect(screen.queryByText("Run Demo")).not.toBeInTheDocument();
  });
});
