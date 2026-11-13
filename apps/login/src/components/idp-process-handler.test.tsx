import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IdpProcessHandler } from "./idp-process-handler";

const { getToken, processCallback, push } = vi.hoisted(() => ({
  getToken: vi.fn(),
  processCallback: vi.fn(),
  push: vi.fn(),
}));
vi.mock("./turnstile-provider", () => ({ useTurnstile: () => ({ getToken, widget: null }) }));
vi.mock("@/lib/server/actions", () => ({ processIDPCallback: processCallback }));
vi.mock("next/navigation", () => {
  const router = { push };
  return { useRouter: () => router };
});
vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});
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

test("Strict Mode effect replay processes the intent only from the active attempt", async () => {
  getToken.mockResolvedValueOnce("cancelled-attempt-token").mockResolvedValueOnce("active-attempt-token");
  render(
    <StrictMode>
      <IdpProcessHandler provider="google" id="intent" token="intent-token" />
    </StrictMode>,
  );
  await waitFor(() => expect(processCallback).toHaveBeenCalledTimes(1));
  expect(processCallback).toHaveBeenCalledWith(expect.objectContaining({ turnstileToken: "active-attempt-token" }));
});

test("unmounting while verification is pending does not consume the intent", async () => {
  let verify!: (token: string) => void;
  getToken.mockReturnValue(
    new Promise<string>((resolve) => {
      verify = resolve;
    }),
  );
  const page = render(<IdpProcessHandler provider="google" id="intent" token="intent-token" />);
  page.unmount();
  verify("late-token");
  await Promise.resolve();
  expect(processCallback).not.toHaveBeenCalled();
});
