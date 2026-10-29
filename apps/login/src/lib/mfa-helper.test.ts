import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkMFAFactors } from "./mfa-helper";

vi.mock("./zitadel", () => ({
  getUserByID: vi.fn(),
}));

const { getUserByID } = await import("./zitadel");

const serviceConfig = { baseUrl: "https://zitadel.test" } as any;

// Login settings that ask for no second factor but offer one every 30 days.
const promptSettings = {
  forceMfa: false,
  forceMfaLocalOnly: false,
  mfaInitSkipLifetime: { seconds: BigInt(30 * 24 * 60 * 60), nanos: 0 },
} as any;

const passwordSession = {
  id: "session-1",
  factors: {
    user: { id: "user-1", loginName: "jordan@example.test", organizationId: "org-1" },
    password: { verifiedAt: { seconds: BigInt(1), nanos: 0 } },
  },
} as any;

const providerSession = {
  id: "session-2",
  factors: {
    user: { id: "user-1", loginName: "jordan@example.test", organizationId: "org-1" },
    intent: { verifiedAt: { seconds: BigInt(1), nanos: 0 } },
  },
} as any;

describe("checkMFAFactors: the optional second-factor prompt", () => {
  beforeEach(() => {
    vi.mocked(getUserByID).mockResolvedValue({ user: { type: { case: "human", value: {} } } } as any);
  });

  test("asks after a password sign-in when the user has no second factor", async () => {
    const result = await checkMFAFactors(serviceConfig, passwordSession, promptSettings, [
      AuthenticationMethodType.PASSWORD,
    ]);

    expect(result).toEqual({ redirect: expect.stringMatching(/^\/mfa\/set\?/) });
    expect(new URLSearchParams(result!.redirect!.split("?")[1]).get("force")).toBe("false");
  });

  test("does not ask after a provider (SSO) sign-in", async () => {
    const result = await checkMFAFactors(serviceConfig, providerSession, promptSettings, [AuthenticationMethodType.IDP]);

    expect(result).toBeUndefined();
  });

  test("does not ask again within the skip lifetime", async () => {
    vi.mocked(getUserByID).mockResolvedValue({
      user: {
        type: { case: "human", value: { mfaInitSkipped: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 } } },
      },
    } as any);

    const result = await checkMFAFactors(serviceConfig, passwordSession, promptSettings, [
      AuthenticationMethodType.PASSWORD,
    ]);

    expect(result).toBeUndefined();
  });

  test("does not ask when the lifetime is zero", async () => {
    const result = await checkMFAFactors(
      serviceConfig,
      passwordSession,
      { ...promptSettings, mfaInitSkipLifetime: { seconds: BigInt(0), nanos: 0 } },
      [AuthenticationMethodType.PASSWORD],
    );

    expect(result).toBeUndefined();
  });
});
