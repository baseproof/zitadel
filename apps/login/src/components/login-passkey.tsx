"use client";

import { coerceToArrayBuffer, coerceToBase64Url } from "@/helpers/base64";
import { handleServerActionResponse } from "@/lib/client-utils";
import { sendPasskey } from "@/lib/server/passkeys";
import { updateOrCreateSession } from "@/lib/server/session";
import { create, JsonObject } from "@zitadel/client";
import { RequestChallengesSchema, UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb";
import { Checks } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

// either loginName or sessionId must be provided
type Props = {
  loginName?: string;
  sessionId?: string;
  requestId?: string;
  altPassword: boolean;
  login?: boolean;
  organization?: string;
};

export function LoginPasskey({ loginName, sessionId, requestId, altPassword, organization, login = true }: Props) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const t = useTranslations("passkey");
  const router = useRouter();

  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setLoading(true);
      updateOrCreateSessionForChallenge()
        .then((response) => {
          const pK = response?.challenges?.webAuthN?.publicKeyCredentialRequestOptions?.publicKey;

          if (!pK) {
            setError(t("verify.errors.couldNotRequestChallenge"));
            setLoading(false);
            return;
          }

          return submitLoginAndContinue(pK)
            .catch((error) => {
              setError(error instanceof Error ? error.message : String(error));
              return;
            })
            .finally(() => {
              setLoading(false);
            });
        })
        .catch((error) => {
          setError(error instanceof Error ? error.message : String(error));
          return;
        })
        .finally(() => {
          setLoading(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateOrCreateSessionForChallenge(
    userVerificationRequirement: number = login
      ? UserVerificationRequirement.REQUIRED
      : UserVerificationRequirement.DISCOURAGED,
  ) {
    setError("");
    setLoading(true);
    const sessionResponse = await updateOrCreateSession({
      loginName,
      sessionId,
      organization,
      challenges: create(RequestChallengesSchema, {
        webAuthN: {
          domain: "",
          userVerificationRequirement,
        },
      }),
      requestId,
    })
      .catch((error) => {
        console.error(error);
        setError(t("verify.errors.couldNotRequestChallenge"));
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (sessionResponse && "error" in sessionResponse && sessionResponse.error) {
      setError(sessionResponse.error);
      return;
    }

    return sessionResponse;
  }

  async function submitLogin(data: JsonObject) {
    setLoading(true);
    try {
      const response = await sendPasskey({
        loginName,
        sessionId,
        organization,
        checks: {
          webAuthN: { credentialAssertionData: data },
        } as Checks,
        requestId,
      });

      const handled = handleServerActionResponse(response, router, setSamlData, setError);

      if (!handled) {
        if (!response) {
          setError(t("verify.errors.noResponseReceived"));
        } else {
          setError(t("verify.errors.noRedirectProvided"));
        }
      }
    } catch {
      setError(t("verify.errors.couldNotVerifyPasskey"));
    } finally {
      setLoading(false);
    }
  }

  async function submitLoginAndContinue(publicKey: any): Promise<boolean | void> {
    publicKey.challenge = coerceToArrayBuffer(publicKey.challenge, "publicKey.challenge");
    publicKey.allowCredentials.map((listItem: any) => {
      listItem.id = coerceToArrayBuffer(listItem.id, "publicKey.allowCredentials.id");
    });

    return navigator.credentials
      .get({
        publicKey,
      })
      .then((assertedCredential: any) => {
        if (!assertedCredential) {
          setError(t("verify.errors.couldNotRetrievePasskey"));
          return;
        }

        const authData = new Uint8Array(assertedCredential.response.authenticatorData);
        const clientDataJSON = new Uint8Array(assertedCredential.response.clientDataJSON);
        const rawId = new Uint8Array(assertedCredential.rawId);
        const sig = new Uint8Array(assertedCredential.response.signature);
        const userHandle = new Uint8Array(assertedCredential.response.userHandle);
        const data = {
          id: assertedCredential.id,
          rawId: coerceToBase64Url(rawId, "rawId"),
          type: assertedCredential.type,
          response: {
            authenticatorData: coerceToBase64Url(authData, "authData"),
            clientDataJSON: coerceToBase64Url(clientDataJSON, "clientDataJSON"),
            signature: coerceToBase64Url(sig, "sig"),
            userHandle: coerceToBase64Url(userHandle, "userHandle"),
          },
        };

        return submitLogin(data);
      })
      .catch((error) => {
        // Handle passkey cancellation or errors
        if (error?.name === "NotAllowedError") {
          setError(t("verify.errors.verificationCancelled"));
        } else {
          setError(t("verify.errors.verificationFailed"));
        }
        console.error("Passkey verification error:", error);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  // 02a·D: the browser's prompt was cancelled or timed out.
  const cancelled = error === t("verify.errors.verificationCancelled");

  return (
    <div className="w-full">
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {error && (
        <div className="mb-6">
          <Alert title={error}>{cancelled ? t("verify.errors.verificationCancelledHint") : undefined}</Alert>
        </div>
      )}
      <div className="flex w-full flex-col-reverse gap-2">
        {altPassword ? (
          <Button
            type="button"
            className="w-full"
            variant={ButtonVariants.Secondary}
            onClick={() => {
              const params = new URLSearchParams();

              if (loginName) {
                params.append("loginName", loginName);
              }

              if (sessionId) {
                params.append("sessionId", sessionId);
              }

              if (requestId) {
                params.append("requestId", requestId);
              }

              if (organization) {
                params.append("organization", organization);
              }

              return router.push(
                "/password?" + params, // alt is set because password is requested as alternative auth method, so passkey prompt can be escaped
              );
            }}
            data-testid="password-button"
          >
            <Translated i18nKey="verify.usePassword" namespace="passkey" />
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full"
            variant={ButtonVariants.Secondary}
            onClick={() => router.push("/loginname?" + new URLSearchParams(requestId ? { requestId } : {}))}
            data-testid="different-email-button"
          >
            <Translated i18nKey="verify.useDifferentEmail" namespace="passkey" />
          </Button>
        )}

        <Button
          type="submit"
          className="w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
          onClick={async () => {
            const response = await updateOrCreateSessionForChallenge().finally(() => {
              setLoading(false);
            });

            const pK = response?.challenges?.webAuthN?.publicKeyCredentialRequestOptions?.publicKey;

            if (!pK) {
              setError(t("verify.errors.couldNotRequestChallenge"));
              return;
            }

            setLoading(true);

            return submitLoginAndContinue(pK)
              .catch((error) => {
                setError(error instanceof Error ? error.message : String(error));
                return;
              })
              .finally(() => {
                setLoading(false);
              });
          }}
          data-testid="submit-button"
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />}{" "}
          <Translated i18nKey={error ? "verify.tryAgain" : "verify.submit"} namespace="passkey" />
        </Button>
      </div>
    </div>
  );
}
