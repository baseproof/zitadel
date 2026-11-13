import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "../../test-mocks/render-with-turnstile";
import { RegisterFormIDPIncomplete } from "./register-form-idp-incomplete";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/server/actions", () => ({
  registerUserAndLinkToIDP: vi.fn(),

  handleServerActionResponse: vi.fn(),
}));

const defaultProps = {
  organization: "org-1",
  idpIntent: { idpIntentId: "intent-1", idpIntentToken: "token-1" },
  idpUserId: "user-1",
  idpId: "idp-1",
};

describe("RegisterFormIDPIncomplete", () => {
  afterEach(cleanup);

  test("should autofocus the username input when idpUserName is not provided", () => {
    const { getByTestId } = render(<RegisterFormIDPIncomplete {...defaultProps} />);
    expect(getByTestId("username-text-input")).toHaveFocus();
  });

  test("should autofocus the firstname input when idpUserName is provided", () => {
    const { getByTestId } = render(<RegisterFormIDPIncomplete {...defaultProps} idpUserName="existing-user" />);
    expect(getByTestId("firstname-text-input")).toHaveFocus();
  });
});
