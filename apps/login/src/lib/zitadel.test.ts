import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@zitadel/proto/zitadel/message_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ClassifiedConnectError } from "./grpc/interceptors/error-classification";
import { isRejectedCode, startIdentityProviderFlow } from "./zitadel";

vi.mock("./service", () => ({
  createServiceForHost: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(),
}));

vi.mock("./fingerprint", () => ({
  getUserAgent: vi.fn(),
}));

describe("startIdentityProviderFlow", () => {
  const serviceConfig = { baseUrl: "https://api.example.com" } as any;
  let startIdentityProviderIntent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createServiceForHost } = await import("./service");
    startIdentityProviderIntent = vi.fn().mockResolvedValue({
      nextStep: { case: "authUrl", value: "https://idp.example.com/auth" },
    });
    vi.mocked(createServiceForHost).mockResolvedValue({ startIdentityProviderIntent } as any);
  });

  test("forwards the login hint to the API", async () => {
    const result = await startIdentityProviderFlow({
      serviceConfig,
      idpId: "idp123",
      urls: { successUrl: "https://login/success", failureUrl: "https://login/failure", loginHint: "user@example.com" },
    });

    expect(result).toEqual({ url: "https://idp.example.com/auth" });
    expect(startIdentityProviderIntent).toHaveBeenCalledWith({
      idpId: "idp123",
      content: {
        case: "urls",
        value: { successUrl: "https://login/success", failureUrl: "https://login/failure", loginHint: "user@example.com" },
      },
    });
  });

  test("drops a login hint the API would reject instead of failing the IdP flow", async () => {
    const loginHint = "a".repeat(201);

    const result = await startIdentityProviderFlow({
      serviceConfig,
      idpId: "idp123",
      urls: { successUrl: "https://login/success", failureUrl: "https://login/failure", loginHint },
    });

    expect(result).toEqual({ url: "https://idp.example.com/auth" });
    expect(startIdentityProviderIntent).toHaveBeenCalledWith({
      idpId: "idp123",
      content: {
        case: "urls",
        value: { successUrl: "https://login/success", failureUrl: "https://login/failure" },
      },
    });
  });

  test("does not set an empty login hint", async () => {
    await startIdentityProviderFlow({
      serviceConfig,
      idpId: "idp123",
      urls: { successUrl: "https://login/success", failureUrl: "https://login/failure", loginHint: "" },
    });

    const value = startIdentityProviderIntent.mock.calls[0][0].content.value;
    expect(value).not.toHaveProperty("loginHint");
  });
});

// Zitadel attaches each error's id as an ErrorDetail (internal/api/grpc/gerrors).
describe("isRejectedCode", () => {
  const zitadelError = (id: string, code: Code) =>
    new ClassifiedConnectError(
      new ConnectError(`message (${id})`, code, undefined, [{ desc: ErrorDetailSchema, value: { id, message: "message" } }]),
    );

  test.each([
    ["CODE-woT0xc", Code.InvalidArgument],
    ["CODE-QvUQ4P", Code.FailedPrecondition],
    ["COMMAND-2M9fs", Code.FailedPrecondition],
  ])("a reset code Zitadel refused (%s)", (id, code) => {
    expect(isRejectedCode(zitadelError(id, code))).toBe(true);
  });

  test("a password the complexity policy refuses is not a code problem", () => {
    expect(isRejectedCode(zitadelError("DOMAIN-HuJf6", Code.InvalidArgument))).toBe(false);
  });

  test("an error without Zitadel's detail is not a code problem", () => {
    expect(isRejectedCode(new ClassifiedConnectError(new ConnectError("unavailable", Code.Unavailable)))).toBe(false);
  });
});
