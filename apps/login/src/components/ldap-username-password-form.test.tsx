import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "../../test-mocks/render-with-turnstile";
import { LDAPUsernamePasswordForm } from "./ldap-username-password-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/server/actions", () => ({
  createNewSessionForLDAP: vi.fn(),
}));

describe("LDAPUsernamePasswordForm", () => {
  afterEach(cleanup);

  test("should autofocus the username input on mount", () => {
    const { getByTestId } = render(<LDAPUsernamePasswordForm idpId="idp-1" link={false} />);
    expect(getByTestId("username-text-input")).toHaveFocus();
  });
});
