import { resetPassword, sendPassword } from "@/lib/server/password";
import { loadMostRecentSession } from "@/lib/session";
import { getLoginSettings } from "@/lib/zitadel";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@zitadel/client";
import { LoginSettingsSchema } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Page from "./page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/headers", () => ({ headers: vi.fn(() => new Headers()) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock("@/components/dynamic-theme", () => ({ DynamicTheme: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/service-url", () => ({
  getServiceConfig: () => ({ serviceConfig: { baseUrl: "https://login.example.com" } }),
}));
vi.mock("@/lib/session", () => ({ loadMostRecentSession: vi.fn() }));
vi.mock("@/lib/zitadel", () => ({ getBrandingSettings: vi.fn(), getDefaultOrg: vi.fn(), getLoginSettings: vi.fn() }));
vi.mock("@/lib/server/password", () => ({ resetPassword: vi.fn(), sendPassword: vi.fn() }));

const parameters = { loginName: "user@example.com", organization: "org123", requestId: "req123" };
const changeURL = "/password/change?loginName=user%40example.com&organization=org123&requestId=req123";

describe("password page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadMostRecentSession).mockResolvedValue(undefined);
    vi.mocked(getLoginSettings).mockResolvedValue(
      create(LoginSettingsSchema, { allowLocalAuthentication: true, ignoreUnknownUsernames: true }),
    );
  });
  afterEach(cleanup);

  test.each([undefined, "required"])(
    "accepts the current password without a cookie, including an old reset=%s URL",
    async (reset) => {
      vi.mocked(sendPassword).mockResolvedValue({ redirect: changeURL });
      render(await Page({ searchParams: Promise.resolve({ ...parameters, reset }) }));

      fireEvent.change(screen.getByTestId("password-text-input"), { target: { value: "current-password" } });
      fireEvent.click(screen.getByTestId("submit-button"));

      await waitFor(() => expect(push).toHaveBeenCalledWith(changeURL));
      expect(sendPassword).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          ...parameters,
          checks: expect.objectContaining({ password: expect.objectContaining({ password: "current-password" }) }),
        }),
      );
      expect(resetPassword).not.toHaveBeenCalled();
      expect(screen.queryByTestId("send-link-button")).not.toBeInTheDocument();
    },
  );

  test("keeps password verification and retry on the same page when the current password is wrong", async () => {
    vi.mocked(sendPassword)
      .mockResolvedValueOnce({ error: "errors.failedToAuthenticateNoLimit" })
      .mockResolvedValueOnce({ redirect: changeURL });
    render(await Page({ searchParams: Promise.resolve({ ...parameters, reset: "required" }) }));
    fireEvent.change(screen.getByTestId("password-text-input"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByTestId("submit-button"));
    await screen.findByText("errors.failedToAuthenticateNoLimit");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("password-text-input")).toHaveValue("");
    fireEvent.change(screen.getByTestId("password-text-input"), { target: { value: "current-password" } });
    fireEvent.click(screen.getByTestId("submit-button"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(changeURL));
    expect(sendPassword).toHaveBeenCalledTimes(2);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test("sends reset mail only when the user explicitly chooses Forgot password", async () => {
    vi.mocked(resetPassword).mockResolvedValue({});
    render(await Page({ searchParams: Promise.resolve({ ...parameters, reset: "required" }) }));
    expect(resetPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("reset-button"));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(parameters)));
    expect(sendPassword).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/password/set?loginName=user%40example.com&organization=org123&requestId=req123");
  });

  test("an old reset URL cannot override the hide-password-reset policy", async () => {
    vi.mocked(getLoginSettings).mockResolvedValue(
      create(LoginSettingsSchema, { allowLocalAuthentication: true, hidePasswordReset: true }),
    );
    render(await Page({ searchParams: Promise.resolve({ ...parameters, reset: "required" }) }));
    expect(screen.getByTestId("password-text-input")).toBeInTheDocument();
    expect(screen.queryByTestId("reset-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-link-button")).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
