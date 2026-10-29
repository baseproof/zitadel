"use client";

import { coerceToArrayBuffer, coerceToBase64Url } from "@/helpers/base64";
import { registerPasskeyLink, verifyPasskeyRegistration } from "@/lib/server/passkeys";
import { DevicePhoneMobileIcon, FingerPrintIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "./alert";
import { Button, ButtonVariants } from "./button";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs = Record<string, never>;

type Props = {
  sessionId?: string;
  userId?: string;
  isPrompt: boolean;
  requestId?: string;
  organization?: string;
  code?: string;
  codeId?: string;
  loginName?: string;
  // Where "Use password instead" goes (02d): a first password for this new account.
  usePasswordHref?: string;
};

export function RegisterPasskey({
  sessionId,
  userId,
  isPrompt,
  organization,
  requestId,
  code,
  codeId,
  loginName: initialLoginName,
  usePasswordHref,
}: Props) {
  const { handleSubmit } = useForm<Inputs>({
    mode: "onSubmit",
  });

  const [error, setError] = useState<string>("");
  const [cancelled, setCancelled] = useState<boolean>(false);
  // This browser has no WebAuthn at all (02c·B): offer the password only.
  const [unsupported, setUnsupported] = useState<boolean>(false);
  const [host, setHost] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);

  const router = useRouter();
  const t = useTranslations("passkey");

  useEffect(() => {
    setUnsupported(typeof window.PublicKeyCredential === "undefined");
    setHost(window.location.hostname);
  }, []);

  const continueAndLogin = useCallback(
    (loginName?: string) => {
      const params = new URLSearchParams();

      if (organization) {
        params.set("organization", organization);
      }

      if (requestId) {
        params.set("requestId", requestId);
      }

      if (sessionId) {
        params.set("sessionId", sessionId);
      }

      if (userId) {
        params.set("userId", userId);
      }

      if (loginName ?? initialLoginName) {
        params.set("loginName", loginName ?? initialLoginName ?? "");
      }

      router.push("/passkey?" + params);
    },
    [organization, requestId, sessionId, userId, initialLoginName, router],
  );

  async function submitVerify(
    passkeyId: string,
    passkeyName: string,
    publicKeyCredential: any,
    currentSessionId?: string,
    currentUserId?: string,
  ) {
    setLoading(true);
    const response = await verifyPasskeyRegistration({
      passkeyId,
      passkeyName,
      publicKeyCredential,
      sessionId: currentSessionId,
      userId: currentUserId,
    })
      .catch(() => {
        setError("Could not verify Passkey");
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    return response;
  }

  const submitRegisterAndContinue = useCallback(async (): Promise<boolean | void> => {
    setCancelled(false);
    setError("");
    // Require either sessionId or userId
    if (!sessionId && !userId) {
      setError("Missing session or user information");
      return;
    }

    setLoading(true);

    let regReq;

    if (sessionId) {
      regReq = { sessionId };
    } else if (userId && code && codeId) {
      regReq = { userId, code, codeId };
    } else {
      setError("Missing code for user-based registration");
      setLoading(false);
      return;
    }

    const resp = await registerPasskeyLink(regReq)
      .catch(() => {
        setError("Could not register passkey");
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (!resp) {
      setError("An error on registering passkey");
      return;
    }

    if ("error" in resp && resp.error) {
      setError(resp.error);
      return;
    }

    if (!("passkeyId" in resp)) {
      setError("An error on registering passkey");
      return;
    }

    const passkeyId = resp.passkeyId;
    const options: CredentialCreationOptions = (resp.publicKeyCredentialCreationOptions as CredentialCreationOptions) ?? {};

    if (!options.publicKey) {
      setError("An error on registering passkey");
      return;
    }

    options.publicKey.challenge = coerceToArrayBuffer(options.publicKey.challenge, "challenge");
    options.publicKey.user.id = coerceToArrayBuffer(options.publicKey.user.id, "userid");
    if (options.publicKey.excludeCredentials) {
      options.publicKey.excludeCredentials.map((cred: any) => {
        cred.id = coerceToArrayBuffer(cred.id as string, "excludeCredentials.id");
        return cred;
      });
    }

    // The browser's prompt: a cancel or a timeout rejects (02c·A), which
    // leaves the user free to try again or use a password instead.
    let credentials: Credential | null;
    try {
      credentials = await navigator.credentials.create(options);
    } catch {
      setCancelled(true);
      return;
    }

    if (
      !credentials ||
      !(credentials as any).response?.attestationObject ||
      !(credentials as any).response?.clientDataJSON ||
      !(credentials as any).rawId
    ) {
      setError("An error on registering passkey");
      return;
    }

    const attestationObject = (credentials as any).response.attestationObject;
    const clientDataJSON = (credentials as any).response.clientDataJSON;
    const rawId = (credentials as any).rawId;

    const data = {
      id: credentials.id,
      rawId: coerceToBase64Url(rawId, "rawId"),
      type: credentials.type,
      response: {
        attestationObject: coerceToBase64Url(attestationObject, "attestationObject"),
        clientDataJSON: coerceToBase64Url(clientDataJSON, "clientDataJSON"),
      },
    };

    const verificationResponse = await submitVerify(passkeyId, "", data, sessionId, userId);

    if (!verificationResponse) {
      setError("Could not verify Passkey!");
      return;
    }

    continueAndLogin(verificationResponse.loginName);
  }, [sessionId, userId, code, codeId, continueAndLogin]);

  // Auto-submit when code is provided (similar to VerifyForm)
  useEffect(() => {
    if (code) {
      submitRegisterAndContinue();
    }
  }, [code, submitRegisterAndContinue]);

  const benefits = [
    { Icon: FingerPrintIcon, key: "noPassword" },
    { Icon: DevicePhoneMobileIcon, key: "devices" },
    { Icon: ShieldCheckIcon, key: "phishing" },
  ] as const;

  const usePassword = usePasswordHref && (
    <Button
      type="button"
      className="w-full"
      variant={unsupported ? ButtonVariants.Primary : ButtonVariants.Secondary}
      onClick={() => router.push(usePasswordHref)}
      data-testid="use-password-button"
    >
      <Translated i18nKey={unsupported ? "set.usePasswordShort" : "set.usePassword"} namespace="passkey" />
    </Button>
  );

  return (
    <form method="post" className="flex w-full flex-col" onSubmit={handleSubmit(submitRegisterAndContinue)}>
      {unsupported && (
        <div className="mb-6">
          <Alert title={t("set.unsupported.title")}>{t("set.unsupported.description")}</Alert>
        </div>
      )}
      {!unsupported && cancelled && (
        <div className="mb-6">
          <Alert title={t("set.cancelled.title")}>{t("set.cancelled.description")}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-6">
          <Alert title={error} />
        </div>
      )}

      {!isPrompt && !unsupported && !cancelled && (
        <ul className="flex flex-col gap-4" data-testid="passkey-benefits">
          {benefits.map(({ Icon, key }) => (
            <li key={key} className="flex flex-row items-start gap-[14px]">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--bp-tile)]">
                <Icon className="text-primary-light-500 dark:text-primary-dark-500 h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-[2px]">
                <span className="text-[15px] font-semibold">{t(`set.benefits.${key}.title`)}</span>
                <span className="text-[14px] leading-[1.45] text-[var(--bp-subtle)]">
                  {t(`set.benefits.${key}.description`, { host })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 flex flex-col gap-2">
        {!unsupported && (
          <Button
            type="submit"
            className="w-full"
            variant={ButtonVariants.Primary}
            disabled={loading}
            data-testid="submit-button"
          >
            {loading && <Spinner className="mr-2 h-5 w-5" />}
            <Translated i18nKey={cancelled ? "set.tryAgain" : "set.submit"} namespace="passkey" />
          </Button>
        )}
        {isPrompt ? (
          <Button
            type="button"
            className="w-full"
            variant={ButtonVariants.Secondary}
            onClick={() => {
              continueAndLogin();
            }}
          >
            <Translated i18nKey="set.skip" namespace="passkey" />
          </Button>
        ) : (
          usePassword
        )}
      </div>
    </form>
  );
}
