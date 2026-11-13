import "server-only";

import { metrics } from "@opentelemetry/api";
import type { TurnstileAction, TurnstileAppearance, TurnstilePublicConfig, TurnstileVerification } from "../turnstile";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_IN_FLIGHT = 64;
const FAILURE_MESSAGE = "We couldn't verify this request. Please retry the security check.";
const meter = metrics.getMeter("zitadel-login.turnstile");
const decisions = meter.createCounter("login.turnstile.decisions");
const latency = meter.createHistogram("login.turnstile.duration", { unit: "ms" });
let inFlight = 0;

type EnabledConfig = {
  enabled: true;
  siteKey: string;
  appearance: TurnstileAppearance;
  secretKey: string;
  allowedHostnames: ReadonlySet<string>;
};

type Outcome =
  "allowed" | "disabled" | "invalid-token" | "busy" | "upstream-error" | "invalid-response" | "rejected" | "policy-mismatch";

function configurationError(): never {
  // Environment values may contain secrets; never interpolate them in errors.
  throw new Error(
    "Invalid Turnstile configuration. Set TURNSTILE_ENABLED explicitly and configure all required fields when enabled.",
  );
}

function requiredValue(name: string): string {
  const value = process.env[name];
  if (!value || value !== value.trim()) configurationError();
  return value;
}

function readConfig(): EnabledConfig | { enabled: false } {
  if (process.env.TURNSTILE_ENABLED === "false") return { enabled: false };
  if (process.env.TURNSTILE_ENABLED !== "true") configurationError();

  const siteKey = requiredValue("TURNSTILE_SITE_KEY");
  const secretKey = requiredValue("TURNSTILE_SECRET_KEY");
  const appearance = requiredValue("TURNSTILE_APPEARANCE");
  if (!["always", "execute", "interaction-only"].includes(appearance)) configurationError();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(siteKey) || !/^[A-Za-z0-9_-]{1,256}$/.test(secretKey)) configurationError();
  // Cloudflare's documented dummy keys must never authorize production traffic.
  if (process.env.NODE_ENV === "production" && [siteKey, secretKey].some((key) => /^[123]x0{20,}/.test(key))) {
    configurationError();
  }

  const hostnames = requiredValue("TURNSTILE_ALLOWED_HOSTNAMES")
    .split(",")
    .map((host) => host.trim());
  if (
    hostnames.length > 100 ||
    hostnames.some(
      (host) =>
        host.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host) ||
        host.split(".").some((label) => label.length > 63),
    )
  )
    configurationError();

  return {
    enabled: true,
    siteKey,
    secretKey,
    appearance: appearance as TurnstileAppearance,
    allowedHostnames: new Set(hostnames),
  };
}

/** Read at request time; this projection is the only configuration sent to React. */
export function getTurnstilePublicConfig(): TurnstilePublicConfig {
  const config = readConfig();
  return config.enabled ? { enabled: true, siteKey: config.siteKey, appearance: config.appearance } : { enabled: false };
}

export function isTurnstileEnabled(): boolean {
  return readConfig().enabled;
}

async function readBoundedJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty verification response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Verification response exceeds limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/**
 * Admission only: callers still perform Zitadel authorization and credential checks.
 * No successful-token cache: each independent operation calls Siteverify once.
 * Cloudflare redemption is eventually consistent, not an atomic replay barrier.
 */
export async function verifyTurnstile(token: unknown, action: TurnstileAction): Promise<TurnstileVerification> {
  const started = performance.now();
  const finish = (outcome: Outcome): TurnstileVerification => {
    const attributes = { action, outcome };
    decisions.add(1, attributes);
    latency.record(performance.now() - started, attributes);
    return outcome === "allowed" || outcome === "disabled" ? { success: true } : { success: false, error: FAILURE_MESSAGE };
  };
  const config = readConfig();
  if (!config.enabled) return finish("disabled");
  if (typeof token !== "string" || token.length === 0 || token.length > 2048 || token !== token.trim()) {
    return finish("invalid-token");
  }
  // Bound work per existing Login process; replicas remain independent and stateless.
  if (inFlight >= MAX_IN_FLIGHT) return finish("busy");
  inFlight++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secretKey, response: token }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return finish("upstream-error");
    }
    const data = await readBoundedJSON(response);
    if (!data || typeof data !== "object" || !("success" in data) || typeof data.success !== "boolean") {
      return finish("invalid-response");
    }
    if (!data.success) return finish("rejected");
    if (
      !("hostname" in data) ||
      typeof data.hostname !== "string" ||
      !("action" in data) ||
      data.action !== action ||
      !("challenge_ts" in data) ||
      typeof data.challenge_ts !== "string" ||
      !config.allowedHostnames.has(data.hostname)
    ) {
      return finish("policy-mismatch");
    }
    const challengeTime = Date.parse(data.challenge_ts);
    const age = Date.now() - challengeTime;
    if (!Number.isFinite(challengeTime) || age < -30_000 || age > 300_000) return finish("policy-mismatch");
    return finish("allowed");
  } catch {
    // Fetch/parser errors may include request details. Only allowlisted metrics escape.
    return finish("upstream-error");
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}
