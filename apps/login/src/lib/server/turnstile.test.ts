import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTurnstilePublicConfig, verifyTurnstile } from "./turnstile";

const fetchMock = vi.fn<typeof fetch>();
const secret = "synthetic-deployment-secret-marker";
const token = "synthetic-challenge-token-marker";
const goodResponse = () => ({
  success: true,
  hostname: "id.example.com",
  action: "login",
  challenge_ts: new Date().toISOString(),
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TURNSTILE_ENABLED", "true");
  vi.stubEnv("TURNSTILE_SITE_KEY", "public-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", secret);
  vi.stubEnv("TURNSTILE_APPEARANCE", "interaction-only");
  vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", "id.example.com");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(goodResponse()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runtime Turnstile configuration", () => {
  it("exposes only the public projection and reads environment changes at runtime", () => {
    expect(getTurnstilePublicConfig()).toEqual({
      enabled: true,
      siteKey: "public-site-key",
      appearance: "interaction-only",
    });
    vi.stubEnv("TURNSTILE_SITE_KEY", "rotated-public-key");
    expect(getTurnstilePublicConfig()).toHaveProperty("siteKey", "rotated-public-key");
    expect(JSON.stringify(getTurnstilePublicConfig())).not.toContain(secret);
  });

  it.each([undefined, "", "FALSE", "1"])("requires an explicit enable policy (%s)", (enabled) => {
    vi.stubEnv("TURNSTILE_ENABLED", enabled);
    expect(getTurnstilePublicConfig).toThrow("Invalid Turnstile configuration");
  });

  it.each(["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_APPEARANCE", "TURNSTILE_ALLOWED_HOSTNAMES"])(
    "fails closed for missing %s",
    (key) => {
      vi.stubEnv(key, undefined);
      expect(getTurnstilePublicConfig).toThrow("Invalid Turnstile configuration");
    },
  );

  it.each([
    "*.example.com",
    "https://id.example.com",
    "id.example.com:443",
    "id.example.com,",
    "ID.example.com",
    "id.example.com/path",
  ])("rejects ambiguous hostname policy %s", (hostname) => {
    vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", hostname);
    expect(getTurnstilePublicConfig).toThrow("Invalid Turnstile configuration");
  });

  it("rejects Cloudflare test keys in production without exposing their values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    expect(getTurnstilePublicConfig).toThrow("Invalid Turnstile configuration");
  });

  it("supports explicitly disabled deployments without a network request", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "false");
    expect(getTurnstilePublicConfig()).toEqual({ enabled: false });
    await expect(verifyTurnstile(undefined, "login")).resolves.toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("server admission", () => {
  it("uses a fixed destination, no redirects/cache, and only sends the secret and token", async () => {
    await expect(verifyTurnstile(token, "login")).resolves.toEqual({ success: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(Object.fromEntries(options!.body as URLSearchParams)).toEqual({ secret, response: token });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([undefined, null, true, {}, 123, "", " padded ", "a".repeat(2049)])(
    "rejects invalid token inputs before fetch",
    async (input) => {
      expect(await verifyTurnstile(input, "login")).toHaveProperty("success", false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { success: false },
    { success: "true" },
    { success: true, hostname: "attacker.example.com" },
    { success: true, action: "signup" },
    { success: true, hostname: "child.id.example.com" },
    { success: true, challenge_ts: "invalid" },
    { success: true, challenge_ts: "2000-01-01T00:00:00Z" },
    { success: true, challenge_ts: "2099-01-01T00:00:00Z" },
  ])("rejects invalid or mismatched responses", async (override) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...goodResponse(), ...override }));
    expect(await verifyTurnstile(token, "login")).toHaveProperty("success", false);
  });

  it.each([null, [], true, {}, { success: true }])("rejects malformed success payloads", async (data) => {
    fetchMock.mockResolvedValueOnce(Response.json(data));
    expect(await verifyTurnstile(token, "login")).toHaveProperty("success", false);
  });

  it("does not cache a token authorization", async () => {
    await verifyTurnstile(token, "login");
    fetchMock.mockResolvedValueOnce(Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect(await verifyTurnstile(token, "login")).toHaveProperty("success", false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed for upstream status, oversized body, invalid JSON and network errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("upstream", { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(16385)));
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    fetchMock.mockRejectedValueOnce(new Error(`${secret} ${token}`));
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await verifyTurnstile(token, "login");
      expect(result).toHaveProperty("success", false);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });

  it("aborts upstream work after the deadline and releases capacity", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = verifyTurnstile(token, "login");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toHaveProperty("success", false);
    expect(await verifyTurnstile(token, "login")).toEqual({ success: true });
  });

  it("bounds concurrent upstream calls without making an extra request", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const pending = Array.from({ length: 64 }, () => verifyTurnstile(token, "login"));
    expect(await verifyTurnstile(token, "login")).toHaveProperty("success", false);
    expect(fetchMock).toHaveBeenCalledTimes(64);
    for (const resolve of resolvers) resolve(Response.json(goodResponse()));
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 64 }, () => ({ success: true })));
  });
});
