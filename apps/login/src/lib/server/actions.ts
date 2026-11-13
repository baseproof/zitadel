"use server";

import { create } from "@zitadel/client";
import { RequestChallengesSchema, UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { headers } from "next/headers";
import { completeFlowOrGetUrl as completeFlow } from "../client";
import * as device from "./device";
import { getPublicHostWithProtocol } from "./host";
import * as idp from "./idp";
import * as idpIntent from "./idp-intent";
import * as loginname from "./loginname";
import * as oidc from "./oidc";
import * as passkeys from "./passkeys";
import * as password from "./password";
import * as registration from "./register";
import * as session from "./session";
import { verifyTurnstile } from "./turnstile";
import * as u2f from "./u2f";
import * as verification from "./verify";

export type { ContinueWithSessionCommand } from "./session";

type Challenge = { turnstileToken?: unknown };
type Action = "login" | "signup";

// Keep browser-callable server actions here. Credential/account implementations
// are server-only, so one verified submission covers their internal steps
// without consuming the Cloudflare token again or exposing an unguarded action.
async function guarded<T>(
  action: Action,
  token: unknown,
  operation: () => Promise<T>,
): Promise<T | { error: string; field?: undefined }> {
  const verification = await verifyTurnstile(token, action);
  if (!verification.success) return { error: verification.error };
  return operation();
}

export async function sendLoginname(command: Parameters<typeof loginname.sendLoginname>[0]) {
  return loginname.sendLoginname(command);
}

export async function sendPassword(command: Parameters<typeof password.sendPassword>[0] & Challenge) {
  return guarded("login", command.turnstileToken, () => {
    if (!command.checks?.password || Object.keys(command.checks).some((key) => key !== "password" && key !== "$typeName")) {
      return Promise.resolve({ error: "Invalid password submission." });
    }
    return password.sendPassword({
      loginName: command.loginName,
      organization: command.organization,
      defaultOrganization: command.defaultOrganization,
      requestId: command.requestId,
      checks: create(ChecksSchema, { password: { password: command.checks.password.password } }),
    });
  });
}

export async function resetPassword(command: Parameters<typeof password.resetPassword>[0]) {
  return password.resetPassword(command);
}

export async function changePassword(command: Parameters<typeof password.changePassword>[0]) {
  return password.changePassword(command);
}

export async function checkSessionAndSetPassword(
  command: Parameters<typeof password.checkSessionAndSetPassword>[0] & Challenge,
) {
  return guarded("login", command.turnstileToken, () => password.checkSessionAndSetPassword(command));
}

export async function registerUser(command: Parameters<typeof registration.registerUser>[0] & Challenge) {
  return guarded("signup", command.turnstileToken, () => registration.registerUser(command));
}

export async function registerUserAndLinkToIDP(
  command: Parameters<typeof registration.registerUserAndLinkToIDP>[0] & Challenge,
) {
  return guarded("signup", command.turnstileToken, () => registration.registerUserAndLinkToIDP(command));
}

type SessionAction = Challenge & {
  loginName?: string;
  sessionId?: string;
  organization?: string;
  requestId?: string;
} & (
    | { operation: "otp-send"; method: "email" | "sms" }
    | { operation: "otp-verify"; method: "email" | "sms" | "time-based"; code: string }
    | { operation: "passkey-challenge"; userVerification: "required" | "discouraged" }
  );

export async function updateOrCreateSession(command: SessionAction) {
  // Reject former raw Checks/RequestChallenges payloads instead of silently
  // ignoring a credential supplied through an unrelated action.
  if ("checks" in command || "challenges" in command || "lifetime" in command) {
    return { error: "Invalid authentication operation." };
  }
  const context = {
    loginName: command.loginName,
    sessionId: command.sessionId,
    organization: command.organization,
    requestId: command.requestId,
  };
  if (command.operation === "otp-send" && (command.method === "email" || command.method === "sms")) {
    const origin = getPublicHostWithProtocol(await headers());
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const requestQuery = command.requestId ? `&requestId=${encodeURIComponent(command.requestId)}` : "";
    const challenges = create(
      RequestChallengesSchema,
      command.method === "email"
        ? {
            otpEmail: {
              deliveryType: {
                case: "sendCode",
                value: {
                  urlTemplate: `${origin}${basePath}/otp/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}${requestQuery}`,
                },
              },
            },
          }
        : { otpSms: {} },
    );
    return session.updateOrCreateSession({ ...context, challenges });
  }
  if (
    command.operation === "otp-verify" &&
    typeof command.code === "string" &&
    command.code.length > 0 &&
    command.code.length <= 128
  ) {
    const checks =
      command.method === "email"
        ? { otpEmail: { code: command.code } }
        : command.method === "sms"
          ? { otpSms: { code: command.code } }
          : command.method === "time-based"
            ? { totp: { code: command.code } }
            : undefined;
    if (!checks) return { error: "Invalid authentication operation." };
    return guarded("login", command.turnstileToken, () =>
      session.updateOrCreateSession({ ...context, checks: create(ChecksSchema, checks) }),
    );
  }
  if (command.operation === "passkey-challenge" && ["required", "discouraged"].includes(command.userVerification)) {
    return session.updateOrCreateSession({
      ...context,
      challenges: create(RequestChallengesSchema, {
        webAuthN: {
          domain: "",
          userVerificationRequirement:
            command.userVerification === "required"
              ? UserVerificationRequirement.REQUIRED
              : UserVerificationRequirement.DISCOURAGED,
        },
      }),
    });
  }
  return { error: "Invalid authentication operation." };
}

export async function sendPasskey(command: Parameters<typeof passkeys.sendPasskey>[0] & Challenge) {
  return guarded("login", command.turnstileToken, async () => {
    const checks = command.checks;
    if (!checks?.webAuthN || Object.keys(checks).some((key) => key !== "webAuthN" && key !== "$typeName")) {
      return { error: "Invalid passkey assertion." };
    }
    return passkeys.sendPasskey({
      loginName: command.loginName,
      sessionId: command.sessionId,
      organization: command.organization,
      requestId: command.requestId,
      checks: create(ChecksSchema, { webAuthN: checks.webAuthN }),
    });
  });
}

export async function sendVerification(command: Parameters<typeof verification.sendVerification>[0]) {
  return verification.sendVerification(command);
}

export async function resendVerification(command: Parameters<typeof verification.resendVerification>[0]) {
  return verification.resendVerification(command);
}

export async function redirectToIdp(state: idp.RedirectToIdpState, data: FormData) {
  return idp.redirectToIdp(state, data);
}

export async function createNewSessionForLDAP(command: Parameters<typeof idp.createNewSessionForLDAP>[0] & Challenge) {
  return guarded("login", command.turnstileToken, () => idp.createNewSessionForLDAP(command));
}

export async function processIDPCallback(command: Parameters<typeof idpIntent.processIDPCallback>[0] & Challenge) {
  return guarded("signup", command.turnstileToken, () => idpIntent.processIDPCallback(command));
}

export async function getDeviceAuthorizationRequest(userCode: string) {
  return oidc.getDeviceAuthorizationRequest(userCode);
}

// These continuations retain their existing server-side session/enrollment
// authorization. A browser's claimed session factors are not authentication.
export async function continueWithSession(command: session.ContinueWithSessionCommand) {
  return session.continueWithSession(command);
}
export async function clearSession(command: Parameters<typeof session.clearSession>[0]) {
  return session.clearSession(command);
}
export async function skipMFAAndContinueWithNextUrl(command: Parameters<typeof session.skipMFAAndContinueWithNextUrl>[0]) {
  return session.skipMFAAndContinueWithNextUrl(command);
}
export async function registerPasskeyLink(command: Parameters<typeof passkeys.registerPasskeyLink>[0]) {
  return passkeys.registerPasskeyLink(command);
}
export async function verifyPasskeyRegistration(command: Parameters<typeof passkeys.verifyPasskeyRegistration>[0]) {
  return passkeys.verifyPasskeyRegistration(command);
}
export async function addU2F(command: Parameters<typeof u2f.addU2F>[0]) {
  return u2f.addU2F(command);
}
export async function verifyU2F(command: Parameters<typeof u2f.verifyU2F>[0]) {
  return u2f.verifyU2F(command);
}
export async function verifyTOTP(...args: Parameters<typeof verification.verifyTOTP>) {
  return verification.verifyTOTP(...args);
}
export async function approveDeviceAuthorization(command: Parameters<typeof device.approveDeviceAuthorization>[0]) {
  return device.approveDeviceAuthorization(command);
}
export async function denyDeviceAuthorization(command: Parameters<typeof device.denyDeviceAuthorization>[0]) {
  return device.denyDeviceAuthorization(command);
}
export async function completeFlowOrGetUrl(...args: Parameters<typeof completeFlow>) {
  return completeFlow(...args);
}
