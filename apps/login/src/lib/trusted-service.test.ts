import { afterEach, describe, expect, it, vi } from "vitest";
import { trustedServiceUrl } from "./trusted-service";

afterEach(() => vi.unstubAllEnvs());

describe("privileged service destination", () => {
  it("uses only the server-configured endpoint, including a configured internal HTTP endpoint", () => {
    vi.stubEnv("ZITADEL_API_URL", "https://zitadel.internal:8080");
    expect(trustedServiceUrl("https://zitadel.internal:8080/")).toBe("https://zitadel.internal:8080/");
    vi.stubEnv("ZITADEL_API_URL", "http://localhost:8080");
    expect(trustedServiceUrl("http://localhost:8080")).toBe("http://localhost:8080/");
  });

  it.each([
    "https://attacker.invalid",
    "https://zitadel.internal:8080.attacker.invalid",
    "http://zitadel.internal:8080",
    "https://zitadel.internal:8081",
    "https://zitadel.internal:8080/other",
    "https://user:secret@zitadel.internal:8080",
    "https://zitadel.internal:8080?redirect=attacker",
    "https://zitadel.internal:8080#fragment",
    undefined,
  ])("rejects an untrusted destination", (destination) => {
    vi.stubEnv("ZITADEL_API_URL", "https://zitadel.internal:8080");
    expect(() => trustedServiceUrl(destination)).toThrow(/Zitadel service destination/);
  });

  it.each([undefined, "", "not a URL", "file:///etc/passwd", "https://user:secret@example.com"])(
    "rejects broken trusted configuration",
    (destination) => {
      vi.stubEnv("ZITADEL_API_URL", destination);
      expect(() => trustedServiceUrl("https://example.com")).toThrow("Invalid Zitadel service destination");
    },
  );
});
