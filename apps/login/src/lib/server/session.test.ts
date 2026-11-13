import { Code } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearSession, continueWithSession } from "./session";

vi.mock("@zitadel/client", async () => {
  const { Code } = await import("@connectrpc/connect");
  return { Code, create: vi.fn((_schema: unknown, data: unknown) => data), Duration: {} };
});

vi.mock("@/lib/zitadel", () => ({
  deleteSession: vi.fn(),
  getLoginSettings: vi.fn(),
  getSession: vi.fn(),
  getSecuritySettings: vi.fn(),
  humanMFAInitSkipped: vi.fn(),
  listAuthenticationMethodTypes: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("@/lib/server/cookie", () => ({
  createSessionAndUpdateCookie: vi.fn(),
  setSessionAndUpdateCookie: vi.fn(),
}));

vi.mock("../cookies", () => ({
  getMostRecentSessionCookie: vi.fn(),
  getSessionCookieById: vi.fn(),
  getSessionCookieByLoginName: vi.fn(),
  removeSessionFromCookie: vi.fn(),
}));

vi.mock("../service-url", () => ({
  getServiceConfig: vi.fn(() => ({ serviceConfig: { baseUrl: "https://example.com" } })),
}));

vi.mock("../client", () => ({
  completeFlowOrGetUrl: vi.fn(),
}));

vi.mock("../session", () => ({
  isSessionValid: vi.fn(),
}));

vi.mock("./host", () => ({
  getPublicHost: vi.fn(() => "test.com"),
}));

vi.mock("./loginname", () => ({
  sendLoginname: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock("@/lib/grpc/interceptors/error-classification", () => ({
  isClassifiedError: (error: unknown) => error !== null && typeof error === "object" && "code" in error,
}));

const cookie = { id: "session-1", token: "token-1", loginName: "user@example.com" };

describe("continueWithSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("requires a server cookie even if the browser supplies verified factors", async () => {
    const cookies = await import("../cookies");
    const zitadel = await import("@/lib/zitadel");
    vi.mocked(cookies.getSessionCookieById).mockResolvedValue(undefined);
    const forged = { id: "session-1", factors: { user: { id: "attacker" }, password: { verifiedAt: new Date() } } };
    await expect(continueWithSession(forged)).resolves.toEqual({ error: "couldNotContinueSession" });
    expect(zitadel.getSession).not.toHaveBeenCalled();
  });

  test("validates the session loaded using the server cookie, ignoring browser factors", async () => {
    const cookies = await import("../cookies");
    const zitadel = await import("@/lib/zitadel");
    const { isSessionValid } = await import("../session");
    const { completeFlowOrGetUrl } = await import("../client");
    vi.mocked(cookies.getSessionCookieById).mockResolvedValue(cookie as any);
    const authoritative = {
      id: cookie.id,
      factors: { user: { id: "real-user", loginName: cookie.loginName, organizationId: "real-org" } },
    };
    vi.mocked(zitadel.getSession).mockResolvedValue({ session: authoritative } as any);
    vi.mocked(zitadel.getLoginSettings).mockResolvedValue({ defaultRedirectUri: "/home" } as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);
    await continueWithSession({ id: cookie.id, requestId: "oidc_request", factors: { user: { id: "attacker" } } } as any);
    expect(zitadel.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: cookie.id, sessionToken: cookie.token }),
    );
    expect(isSessionValid).toHaveBeenCalledWith(expect.objectContaining({ session: authoritative }));
    expect(completeFlowOrGetUrl).toHaveBeenCalledWith(
      { sessionId: cookie.id, requestId: "oidc_request", organization: "real-org" },
      "/home",
    );
  });
});

describe("clearSession", () => {
  let deleteSession: any;
  let getSecuritySettings: any;
  let getSessionCookieById: any;
  let removeSessionFromCookie: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const zitadel = await import("@/lib/zitadel");
    const cookies = await import("../cookies");
    deleteSession = vi.mocked(zitadel.deleteSession);
    getSecuritySettings = vi.mocked(zitadel.getSecuritySettings);
    getSessionCookieById = vi.mocked(cookies.getSessionCookieById);
    removeSessionFromCookie = vi.mocked(cookies.removeSessionFromCookie);

    getSessionCookieById.mockResolvedValue(cookie);
    getSecuritySettings.mockResolvedValue({ embeddedIframe: { enabled: true } });
  });

  test("deletes the session and prunes the cookie entry on success", async () => {
    deleteSession.mockResolvedValue({ details: {} });

    const res = await clearSession({ sessionId: "session-1" });

    expect(res).toBeUndefined();
    expect(deleteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", sessionToken: "token-1" }));
    expect(removeSessionFromCookie).toHaveBeenCalledWith({ session: cookie, iFrameEnabled: true });
  });

  test("prunes the cookie entry when the server rejects the cookie token (session gone or token stale)", async () => {
    deleteSession.mockRejectedValue({ code: Code.PermissionDenied });

    const res = await clearSession({ sessionId: "session-1" });

    expect(res).toBeUndefined();
    expect(removeSessionFromCookie).toHaveBeenCalledWith({ session: cookie, iFrameEnabled: true });
  });

  test("keeps the cookie entry and reports an error on any other failure", async () => {
    deleteSession.mockRejectedValue({ code: Code.Unavailable });

    const res = await clearSession({ sessionId: "session-1" });

    expect(res).toEqual({ error: "couldNotClearSession" });
    expect(removeSessionFromCookie).not.toHaveBeenCalled();
  });

  test("attempts the server-side delete even when security settings cannot be loaded", async () => {
    deleteSession.mockResolvedValue({ details: {} });
    getSecuritySettings.mockRejectedValue(new Error("settings unavailable"));

    await expect(clearSession({ sessionId: "session-1" })).rejects.toThrow("settings unavailable");

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(removeSessionFromCookie).not.toHaveBeenCalled();
  });

  test("does nothing when the session id is not in the cookie", async () => {
    getSessionCookieById.mockResolvedValue(undefined);

    const res = await clearSession({ sessionId: "unknown" });

    expect(res).toBeUndefined();
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
