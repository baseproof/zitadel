import { cleanup } from "@testing-library/react";
import { create } from "@zitadel/client";
import { LegalAndSupportSettingsSchema } from "@zitadel/proto/zitadel/settings/v2/legal_settings_pb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "../../test-mocks/render-with-turnstile";
import { RegisterForm } from "./register-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/server/actions", () => ({
  registerUser: vi.fn(),

  handleServerActionResponse: vi.fn(),
}));

const defaultLegal = create(LegalAndSupportSettingsSchema, {});

describe("RegisterForm", () => {
  afterEach(cleanup);

  test("should autofocus the firstname input on mount", () => {
    const { getByTestId } = render(<RegisterForm legal={defaultLegal} organization="org-1" idpCount={0} />);
    expect(getByTestId("firstname-text-input")).toHaveFocus();
  });
});
