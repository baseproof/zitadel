"use client";

import { Alert, AlertType } from "@/components/alert";
import { handleServerActionResponse } from "@/lib/client-utils";
import { UNKNOWN_USER_ID } from "@/lib/constants";
import { resendVerification, sendVerification } from "@/lib/server/verify";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { CodeInput } from "./code-input";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs = {
  code: string;
};

type Props = {
  userId: string;
  loginName?: string;
  organization?: string;
  code?: string;
  isInvite: boolean;
  requestId?: string;
  submit: boolean;
};

export function VerifyForm({ userId, loginName, organization, requestId, code, isInvite, submit }: Props) {
  const router = useRouter();

  // Buttons stay enabled; the checks run when the user submits.
  const {
    control,
    handleSubmit,
    setError: setFieldError,
    resetField,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      code: code ?? "",
    },
  });

  const t = useTranslations("verify");

  const [error, setError] = useState<string>("");
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const [loading, setLoading] = useState<boolean>(false);

  // After a resend (03·D): the notice, and the link waits this long before it
  // offers another. The first arrival is 03, the link offered at once: the
  // codeSent the server adds to the URL marks the first code too.
  const RESEND_WAIT_SECONDS = 45;
  const [resent, setResent] = useState<boolean>(false);
  const [resendWait, setResendWait] = useState<number>(0);
  useEffect(() => {
    if (resendWait <= 0) {
      return;
    }
    const timer = setTimeout(() => setResendWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendWait]);

  async function resendCode() {
    setError("");
    setLoading(true);
    resetField("code");

    // do not send code for dummy userid that is set to prevent user enumeration
    if (userId === UNKNOWN_USER_ID) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setLoading(false);
      return;
    }

    const response = await resendVerification({
      userId,
      isInvite: isInvite,
      requestId: requestId,
    })
      .catch(() => {
        setError(t("errors.couldNotResendEmail"));
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (response && "error" in response && response?.error) {
      setError(response.error);
      return;
    }

    setResent(true);
    setResendWait(RESEND_WAIT_SECONDS);

    return response;
  }

  const processedCode = useRef<string | undefined>(undefined);

  const fcn = useCallback(
    async function submitCodeAndContinue(value: Inputs): Promise<boolean | void> {
      setError("");
      setLoading(true);

      try {
        const response = await sendVerification({
          code: value.code,
          userId,
          isInvite: isInvite,
          loginName: loginName,
          organization: organization,
          requestId: requestId,
        });

        // A rejected code belongs under the boxes (03·B), not in a banner.
        if (response && "error" in response && "field" in response && response.field === "code") {
          setFieldError("code", { type: "server", message: response.error }, { shouldFocus: true });
          return;
        }

        handleServerActionResponse(response, router, setSamlData, setError);
      } catch {
        setError(t("errors.couldNotVerifyUser"));
      } finally {
        setLoading(false);
      }
    },
    [isInvite, userId, loginName, organization, requestId, router, t, setFieldError],
  );

  useEffect(() => {
    if (submit && code && code !== processedCode.current) {
      processedCode.current = code;
      fcn({ code });
    }
  }, [submit, code, fcn]);

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {/* 03·D: a new code is on its way, and Zitadel keeps only the latest one. */}
      {resent && (
        <div className="mb-6">
          <Alert type={AlertType.INFO} title={t("verify.codeSent")}>
            {t("verify.codeSentHint")}
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-6" data-testid="error">
          <Alert title={error} />
        </div>
      )}
      <form method="post" className="flex w-full flex-col" noValidate onSubmit={handleSubmit(fcn)}>
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
              hint={t("verify.codeHint")}
              error={errors.code?.message}
              autoFocus
            />
          )}
        />

        <Button
          type="submit"
          className="mt-6 w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
          data-testid="submit-button"
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />}
          <Translated i18nKey="verify.submit" namespace="verify" />
        </Button>

        <div className="mt-5 flex flex-row items-center justify-center gap-1.5 text-[14px]">
          {resendWait > 0 ? (
            <span className="text-[var(--bp-muted)]" data-testid="resend-wait">
              {t("verify.resendIn", {
                time: `${Math.floor(resendWait / 60)}:${String(resendWait % 60).padStart(2, "0")}`,
              })}
            </span>
          ) : (
            <>
              <span className="text-[var(--bp-subtle)]">
                <Translated i18nKey="verify.noCodeReceived" namespace="verify" />
              </span>
              <button
                disabled={loading}
                type="button"
                className="text-primary-light-500 dark:text-primary-dark-500 font-medium hover:underline disabled:cursor-default disabled:opacity-60"
                onClick={() => {
                  resendCode();
                }}
                data-testid="resend-button"
              >
                <Translated i18nKey="verify.resendCode" namespace="verify" />
              </button>
            </>
          )}
        </div>
      </form>
    </>
  );
}
