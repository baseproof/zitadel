"use client";

import { handleServerActionResponse } from "@/lib/client-utils";
import { completeFlowOrGetUrl, updateOrCreateSession } from "@/lib/server/actions";
import { LoginSettings } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { CodeInput } from "./code-input";
import { Spinner } from "./spinner";
import { Translated } from "./translated";
import { useTurnstile } from "./turnstile-provider";

// either loginName or sessionId must be provided
type Props = {
  host: string | null;
  loginName?: string;
  sessionId?: string;
  requestId?: string;
  organization?: string;
  method: string;
  code?: string;
  loginSettings?: LoginSettings;
};

type Inputs = {
  code: string;
};

export function LoginOTP({ loginName, sessionId, requestId, organization, method, code, loginSettings }: Props) {
  const t = useTranslations("otp");
  const turnstile = useTurnstile("login");

  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const router = useRouter();

  const initialized = useRef(false);

  // The button stays enabled; the check runs when the user submits.
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      code: code ? code : "",
    },
  });

  const updateSessionForOTPChallenge = useCallback(async (): Promise<{
    error?: string;
    [key: string]: any;
  }> => {
    if (method !== "email" && method !== "sms") return { error: t("errors.couldNotRequestChallenge") };

    let response;
    try {
      response = await updateOrCreateSession({
        loginName,
        sessionId,
        organization,
        operation: "otp-send",
        method,
        requestId,
      });
    } catch {
      return { error: t("errors.couldNotRequestChallenge") };
    }

    if (response && "error" in response && response.error) {
      return { error: response.error };
    }

    return response;
  }, [method, requestId, loginName, sessionId, organization, t]);

  useEffect(() => {
    if (!initialized.current && ["email", "sms"].includes(method) && !code) {
      initialized.current = true;
      setLoading(true);
      updateSessionForOTPChallenge()
        .then((response) => {
          if (response?.error) {
            setError(response.error);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [updateSessionForOTPChallenge, method, code]);

  async function submitCode(values: Inputs, organization?: string) {
    setLoading(true);
    if (method !== "email" && method !== "sms" && method !== "time-based") {
      setError(t("errors.couldNotVerifyCode"));
      setLoading(false);
      return;
    }

    const response = await turnstile
      .getToken()
      .then((turnstileToken) =>
        updateOrCreateSession({
          loginName,
          sessionId,
          organization,
          operation: "otp-verify",
          code: values.code,
          method,
          turnstileToken,
          requestId,
        }),
      )
      .catch(() => {
        setError(t("errors.couldNotVerifyCode"));
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (response && "error" in response && response.error) {
      setError(response.error);
      return;
    }

    return response;
  }

  function setCodeAndContinue(values: Inputs) {
    return submitCode(values, organization).then(async (response) => {
      if (response && "sessionId" in response) {
        setLoading(true);
        // Wait for 2 seconds to avoid eventual consistency issues with an OTP code being verified in the /login endpoint
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Use unified approach that handles both OIDC/SAML and regular flows
        if (response.factors?.user) {
          const callbackResponse = await completeFlowOrGetUrl(
            requestId && response.sessionId
              ? {
                  sessionId: response.sessionId,
                  requestId: requestId,
                  organization: response.factors?.user?.organizationId,
                }
              : {
                  loginName: response.factors.user.loginName,
                  organization: response.factors?.user?.organizationId,
                },
            loginSettings?.defaultRedirectUri,
          );
          setLoading(false);

          handleServerActionResponse(callbackResponse, router, setSamlData, setError);
        } else {
          setLoading(false);
        }
      }
    });
  }

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {turnstile.widget}
      {error && (
        <div data-testid="error">
          <Alert>{error}</Alert>
        </div>
      )}
      <form method="post" className="flex w-full flex-col gap-5" noValidate onSubmit={handleSubmit(setCodeAndContinue)}>
        <Controller
          control={control}
          name="code"
          rules={{
            required: t("verify.required.code"),
            validate: (value: string) => value.length === 6 || t("verify.required.code"),
          }}
          render={({ field }) => (
            <CodeInput
              ref={field.ref}
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={t("verify.labels.code")}
              error={errors.code?.message}
              autoFocus
            />
          )}
        />

        {["email", "sms"].includes(method) && (
          <p className="text-[14px] text-[var(--bp-muted)]">
            <Translated i18nKey="verify.noCodeReceived" namespace="otp" />{" "}
            <button
              aria-label={t("verify.resendCode")}
              disabled={loading}
              type="button"
              className="tap-target text-primary-light-500 dark:text-primary-dark-500 font-medium hover:underline disabled:cursor-default disabled:opacity-60"
              onClick={async () => {
                setLoading(true);
                const response = await updateSessionForOTPChallenge();
                if (response?.error) {
                  setError(response.error);
                }
                setLoading(false);
              }}
              data-testid="resend-button"
            >
              <Translated i18nKey="verify.resendCode" namespace="otp" />
            </button>
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
          data-testid="submit-button"
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />} <Translated i18nKey="verify.submit" namespace="otp" />
        </Button>
      </form>
    </>
  );
}
