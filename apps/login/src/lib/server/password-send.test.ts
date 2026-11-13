import { create } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { UserState } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { sendPassword } from "./password";

// Mock dependencies
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@zitadel/client", () => ({
  create: vi.fn((schema, data) => data),
  ConnectError: class extends Error {
    code: number;
    constructor(msg: string, code: number) {
      super(msg);
      this.code = code;
    }
  },
  timestampDate: (ts: any) => new Date(Number(ts.seconds) * 1000),
}));

vi.mock("@zitadel/client/v2", () => ({
  createUserServiceClient: vi.fn(),
}));

vi.mock("../service-url", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("../zitadel", () => ({
  getLoginSettings: vi.fn(),
  listAuthenticationMethodTypes: vi.fn(),
  getSession: vi.fn(),
  setPassword: vi.fn(),
  createServerTransport: vi.fn(),
  listUsers: vi.fn(),
  getLockoutSettings: vi.fn(),
  getPasswordExpirySettings: vi.fn(),
  getUserByID: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock("../cookies", () => ({
  getSessionCookieByLoginName: vi.fn(),
  getSessionCookieById: vi.fn(),
}));

vi.mock("../client", () => ({
  completeFlowOrGetUrl: vi.fn(),
}));

vi.mock("@/lib/server/cookie", () => ({
  createSessionAndUpdateCookie: vi.fn(),
  setSessionAndUpdateCookie: vi.fn(),
}));

vi.mock("../verify-helper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../verify-helper")>()),
  checkEmailVerification: vi.fn(),
  checkMFAFactors: vi.fn(),
}));

vi.mock("./verify", () => ({
  trySendVerification: vi.fn(),
}));

vi.mock("../verification-check", () => ({
  hasValidUserVerificationCheckCookie: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(() => (key: string) => key),
}));

describe("sendPassword", () => {
  let mockHeaders: any;
  let mockGetServiceConfig: any;
  let mockGetSessionCookieByLoginName: any;
  let mockSearchUsers: any;
  let mockGetLoginSettings: any;
  let mockCreateSessionAndUpdateCookie: any;
  let mockCompleteFlowOrGetUrl: any;
  let mockListAuthenticationMethodTypes: any;
  let mockCheckMFAFactors: any;
  let mockCheckEmailVerification: any;
  let mockSetSessionAndUpdateCookie: any;
  let mockGetUserByID: any;
  let mockGetPasswordExpirySettings: any;
  let mockGetLockoutSettings: any;

  beforeEach(async () => {
    vi.resetAllMocks();

    const { headers } = await import("next/headers");
    const { getServiceConfig } = await import("../service-url");
    const { getSessionCookieByLoginName } = await import("../cookies");
    const {
      getLoginSettings,
      listAuthenticationMethodTypes,
      searchUsers,
      getUserByID,
      getPasswordExpirySettings,
      getLockoutSettings,
    } = await import("../zitadel");
    const { createSessionAndUpdateCookie, setSessionAndUpdateCookie } = await import("@/lib/server/cookie");
    const { completeFlowOrGetUrl } = await import("../client");
    const { checkMFAFactors, checkEmailVerification } = await import("../verify-helper");

    mockHeaders = vi.mocked(headers);
    mockGetServiceConfig = vi.mocked(getServiceConfig);
    mockGetSessionCookieByLoginName = vi.mocked(getSessionCookieByLoginName);
    mockSearchUsers = vi.mocked(searchUsers);
    mockGetLoginSettings = vi.mocked(getLoginSettings);
    mockCreateSessionAndUpdateCookie = vi.mocked(createSessionAndUpdateCookie);
    mockCompleteFlowOrGetUrl = vi.mocked(completeFlowOrGetUrl);
    mockListAuthenticationMethodTypes = vi.mocked(listAuthenticationMethodTypes);
    mockCheckMFAFactors = vi.mocked(checkMFAFactors);
    mockCheckEmailVerification = vi.mocked(checkEmailVerification);
    mockSetSessionAndUpdateCookie = vi.mocked(setSessionAndUpdateCookie);
    mockGetUserByID = vi.mocked(getUserByID);
    mockGetPasswordExpirySettings = vi.mocked(getPasswordExpirySettings);
    mockGetLockoutSettings = vi.mocked(getLockoutSettings);

    mockHeaders.mockResolvedValue({});
    mockGetServiceConfig.mockReturnValue({ serviceConfig: { baseUrl: "https://api.example.com" } });
  });

  test("should create session and verify password when no session exists", async () => {
    // 1. No existing session
    mockGetSessionCookieByLoginName.mockResolvedValue(null);

    // 2. User exists
    mockSearchUsers.mockResolvedValue({
      result: [{ userId: "user123", type: { case: "human", value: {} }, state: UserState.ACTIVE }],
    });

    // 3. Login settings
    mockGetLoginSettings.mockResolvedValue({
      passwordCheckLifetime: { seconds: BigInt(86400) },
      allowLocalAuthentication: true,
    });

    // 4. Create session success
    mockCreateSessionAndUpdateCookie.mockResolvedValue({
      session: {
        id: "new-session-id",
        factors: {
          user: { id: "user123", loginName: "testuser", organizationId: "org123" },
          password: { verifiedAt: { seconds: 100 } },
        },
      },
      sessionCookie: {
        id: "new-session-id",
        token: "token123",
        organization: "org123",
      },
    });

    // 5. Auth methods (no MFA)
    mockListAuthenticationMethodTypes.mockResolvedValue({
      authMethodTypes: [AuthenticationMethodType.PASSWORD],
    });

    // 6. MFA check passes
    mockCheckMFAFactors.mockResolvedValue(null);

    // 7. Redirect
    mockCompleteFlowOrGetUrl.mockResolvedValue({ redirect: "/next-page" });

    const result = await sendPassword({
      loginName: "testuser",
      checks: create(ChecksSchema, { password: { password: "password123" } }),
    });

    // Verification
    expect(mockSearchUsers).toHaveBeenCalledWith(expect.objectContaining({ searchValue: "testuser" }));
    expect(mockCreateSessionAndUpdateCookie).toHaveBeenCalled();
    expect(mockCompleteFlowOrGetUrl).toHaveBeenCalled();
    expect(result).toEqual({ redirect: "/next-page" });
  });

  describe("required password change after password verification", () => {
    const loginName = "pilot+first@example.test";
    const organization = "org-first-login";
    const requestId = "oidc_request_123";
    const password = "fixture-initial-password";
    const user = {
      userId: "first-login-user",
      preferredLoginName: loginName,
      details: { resourceOwner: organization },
      type: { case: "human", value: { passwordChangeRequired: true, email: { isVerified: true } } },
      state: UserState.ACTIVE,
    };
    const verifiedSession = {
      id: "verified-session",
      factors: {
        user: { id: user.userId, loginName, organizationId: organization },
        password: { verifiedAt: { seconds: 100 } },
      },
    };
    const sessionCookie = {
      id: verifiedSession.id,
      token: "fixture-session-token",
      organization,
      loginName,
    };

    function command() {
      return {
        loginName,
        organization,
        requestId,
        checks: create(ChecksSchema, { password: { password } }),
      };
    }

    function configure({
      existingCookie,
      ignoreUnknownUsernames,
    }: {
      existingCookie: boolean;
      ignoreUnknownUsernames: boolean;
    }) {
      mockGetSessionCookieByLoginName.mockResolvedValue(existingCookie ? sessionCookie : undefined);
      mockGetLoginSettings.mockResolvedValue({
        allowLocalAuthentication: true,
        ignoreUnknownUsernames,
        passwordCheckLifetime: { seconds: BigInt(86400) },
      });
      mockSearchUsers.mockResolvedValue({ result: [user] });
      mockGetUserByID.mockResolvedValue({ user });
      mockGetPasswordExpirySettings.mockResolvedValue({ maxAgeDays: BigInt(0) });
      mockGetLockoutSettings.mockResolvedValue({ maxPasswordAttempts: BigInt(5) });
      mockCreateSessionAndUpdateCookie.mockResolvedValue({ session: verifiedSession, sessionCookie });
      mockSetSessionAndUpdateCookie.mockResolvedValue(verifiedSession);
    }

    function expectChangeRedirect(result: Awaited<ReturnType<typeof sendPassword>>) {
      expect(result).toEqual({
        redirect: "/password/change?" + new URLSearchParams({ loginName, organization, requestId }).toString(),
      });
      expect(mockCheckEmailVerification).not.toHaveBeenCalled();
      expect(mockCheckMFAFactors).not.toHaveBeenCalled();
      expect(mockCompleteFlowOrGetUrl).not.toHaveBeenCalled();
    }

    const cases = [
      { existingCookie: false, ignoreUnknownUsernames: false },
      { existingCookie: false, ignoreUnknownUsernames: true },
      { existingCookie: true, ignoreUnknownUsernames: false },
      { existingCookie: true, ignoreUnknownUsernames: true },
    ];

    test.each(cases)(
      "verifies the password before changing it (existingCookie=$existingCookie, ignoreUnknownUsernames=$ignoreUnknownUsernames)",
      async (settings) => {
        configure(settings);

        const result = await sendPassword(command());

        expectChangeRedirect(result);
        expect(mockGetSessionCookieByLoginName).toHaveBeenCalledWith({ loginName, organization });
        if (settings.existingCookie) {
          expect(mockSetSessionAndUpdateCookie).toHaveBeenCalledExactlyOnceWith({
            recentCookie: sessionCookie,
            checks: command().checks,
            requestId,
            lifetime: { seconds: BigInt(86400) },
          });
          expect(mockCreateSessionAndUpdateCookie).not.toHaveBeenCalled();
          expect(mockGetUserByID).toHaveBeenCalledWith(expect.objectContaining({ userId: user.userId }));
        } else {
          expect(mockCreateSessionAndUpdateCookie).toHaveBeenCalledExactlyOnceWith({
            checks: {
              user: { search: { case: "userId", value: user.userId } },
              password: { password },
            },
            requestId,
            lifetime: { seconds: BigInt(86400) },
          });
          expect(mockSetSessionAndUpdateCookie).not.toHaveBeenCalled();
        }
      },
    );

    test.each(cases)(
      "rejects an invalid password without changing it or completing login (existingCookie=$existingCookie, ignoreUnknownUsernames=$ignoreUnknownUsernames)",
      async (settings) => {
        configure(settings);
        const passwordCheck = settings.existingCookie ? mockSetSessionAndUpdateCookie : mockCreateSessionAndUpdateCookie;
        passwordCheck.mockRejectedValue({ failedAttempts: 1 });

        const result = await sendPassword(command());

        expect(result).toEqual(
          !settings.existingCookie && settings.ignoreUnknownUsernames
            ? { error: "errors.failedToAuthenticateNoLimit" }
            : { error: "errors.wrongPasswordAttemptsLeft", field: "password" },
        );
        expect(passwordCheck).toHaveBeenCalledTimes(1);
        if (settings.existingCookie) {
          expect(mockCreateSessionAndUpdateCookie).not.toHaveBeenCalled();
          expect(mockSearchUsers).not.toHaveBeenCalled();
        }
        expect(mockGetPasswordExpirySettings).not.toHaveBeenCalled();
        expect(mockCheckEmailVerification).not.toHaveBeenCalled();
        expect(mockCheckMFAFactors).not.toHaveBeenCalled();
        expect(mockCompleteFlowOrGetUrl).not.toHaveBeenCalled();
      },
    );

    test.each([false, true])(
      "re-verifies the password after a terminated cookie (ignoreUnknownUsernames=%s)",
      async (ignoreUnknownUsernames) => {
        configure({ existingCookie: true, ignoreUnknownUsernames });
        mockSetSessionAndUpdateCookie.mockRejectedValue(new Error("session already terminated"));

        const result = await sendPassword(command());

        expectChangeRedirect(result);
        expect(mockSetSessionAndUpdateCookie).toHaveBeenCalledTimes(1);
        expect(mockCreateSessionAndUpdateCookie).toHaveBeenCalledExactlyOnceWith({
          checks: {
            user: { search: { case: "userId", value: user.userId } },
            password: { password },
          },
          requestId,
          lifetime: { seconds: BigInt(86400) },
        });
        expect(mockSetSessionAndUpdateCookie.mock.invocationCallOrder[0]).toBeLessThan(
          mockCreateSessionAndUpdateCookie.mock.invocationCallOrder[0],
        );
      },
    );
  });
});
