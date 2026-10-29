import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@zitadel/client";
import { PasswordComplexitySettingsSchema } from "@zitadel/proto/zitadel/settings/v2/password_settings_pb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SetPasswordForm } from "./set-password-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/server/password", () => ({
  changePassword: vi.fn(),
  resetPassword: vi.fn(),
  sendPassword: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  handleServerActionResponse: vi.fn(),
}));

const defaultComplexitySettings = create(PasswordComplexitySettingsSchema, {
  minLength: 8n,
  requiresUppercase: false,
  requiresLowercase: false,
  requiresNumber: false,
  requiresSymbol: false,
});

describe("SetPasswordForm", () => {
  afterEach(cleanup);

  test("should autofocus the code input when codeRequired is true", () => {
    const { getByTestId } = render(
      <SetPasswordForm
        passwordComplexitySettings={defaultComplexitySettings}
        loginName="test@example.com"
        userId="user-1"
        codeRequired={true}
      />,
    );
    expect(getByTestId("code-text-input")).toHaveFocus();
  });

  test("should use translated resend accessible name when codeRequired is true", () => {
    render(
      <SetPasswordForm
        passwordComplexitySettings={defaultComplexitySettings}
        loginName="test@example.com"
        userId="user-1"
        codeRequired={true}
      />,
    );

    expect(screen.getByRole("button", { name: "set.resend" })).toBeInTheDocument();
  });

  test("should autofocus the password input when codeRequired is false", () => {
    const { getByTestId } = render(
      <SetPasswordForm
        passwordComplexitySettings={defaultComplexitySettings}
        loginName="test@example.com"
        userId="user-1"
        codeRequired={false}
      />,
    );
    expect(getByTestId("password-set-text-input")).toHaveFocus();
  });

  // A reset asks for its code first; the password's fields show once it's entered.
  describe("a reset", () => {
    const renderReset = () =>
      render(
        <SetPasswordForm
          passwordComplexitySettings={defaultComplexitySettings}
          loginName="test@example.com"
          userId="user-1"
          codeRequired={true}
        />,
      );

    test("shows no password field before a code is entered", () => {
      renderReset();
      expect(screen.queryByTestId("password-set-text-input")).not.toBeInTheDocument();
      expect(screen.getByTestId("code-continue-button")).toBeInTheDocument();
    });

    test("keeps the code step while the code is incomplete", async () => {
      renderReset();
      fireEvent.change(screen.getByTestId("code-text-input"), { target: { value: "AB3" } });
      fireEvent.click(screen.getByTestId("code-continue-button"));

      expect(await screen.findByText("set.errors.codeIncomplete")).toBeInTheDocument();
      expect(screen.queryByTestId("password-set-text-input")).not.toBeInTheDocument();
    });

    test("shows the password's fields, with the code, once six characters are entered", async () => {
      renderReset();
      fireEvent.change(screen.getByTestId("code-text-input"), { target: { value: "AB3CD5" } });
      fireEvent.click(screen.getByTestId("code-continue-button"));

      expect(await screen.findByTestId("password-set-text-input")).toHaveFocus();
      expect(screen.getByTestId("code-value")).toHaveTextContent("AB3CD5");
    });

    test("brings the code step back when Zitadel refuses the code", async () => {
      const { changePassword } = await import("@/lib/server/password");
      vi.mocked(changePassword).mockResolvedValue({ error: "set.errors.codeRejected", field: "code" });
      renderReset();
      fireEvent.change(screen.getByTestId("code-text-input"), { target: { value: "AB3CD5" } });
      fireEvent.click(screen.getByTestId("code-continue-button"));

      const password = await screen.findByTestId("password-set-text-input");
      fireEvent.change(password, { target: { value: "longenough1" } });
      fireEvent.change(screen.getByTestId("password-set-confirm-text-input"), { target: { value: "longenough1" } });
      fireEvent.click(screen.getByTestId("submit-button"));

      expect(await screen.findByText("set.errors.codeRejected")).toBeInTheDocument();
      expect(screen.getByTestId("code-continue-button")).toBeInTheDocument();
      expect(screen.queryByTestId("password-set-text-input")).not.toBeInTheDocument();
    });
  });
});
