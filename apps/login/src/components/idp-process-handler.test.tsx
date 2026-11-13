import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IdpProcessHandler } from "./idp-process-handler";

const { getToken, processCallback, push } = vi.hoisted(() => ({
  getToken: vi.fn(),
  processCallback: vi.fn(),
  push: vi.fn(),
}));
vi.mock("./turnstile-provider", () => ({ useTurnstile: () => ({ getToken, widget: null }) }));
vi.mock("@/lib/server/actions", () => ({ processIDPCallback: processCallback }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => {
  vi.clearAllMocks();
  processCallback.mockResolvedValue({ redirect: "/next" });
});
afterEach(cleanup);

test("waits for verification before consuming the IdP intent", async () => {
  let verify!: (token: string) => void;
  getToken.mockReturnValue(
    new Promise<string>((resolve) => {
      verify = resolve;
    }),
  );
  render(<IdpProcessHandler provider="google" id="intent" token="intent-token" />);
  expect(processCallback).not.toHaveBeenCalled();
  verify("turnstile-token");
  await waitFor(() =>
    expect(processCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "intent",
        token: "intent-token",
        turnstileToken: "turnstile-token",
      }),
    ),
  );
  expect(processCallback).toHaveBeenCalledTimes(1);
});

test("verification failure preserves the intent and allows a fresh attempt", async () => {
  getToken.mockRejectedValueOnce(new Error("Security verification unavailable"));
  getToken.mockResolvedValueOnce("fresh-token");
  render(<IdpProcessHandler provider="google" id="intent" token="intent-token" />);
  await screen.findByText("Security verification unavailable");
  expect(processCallback).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
  await waitFor(() => expect(processCallback).toHaveBeenCalledTimes(1));
  expect(processCallback).toHaveBeenCalledWith(expect.objectContaining({ turnstileToken: "fresh-token" }));
});
