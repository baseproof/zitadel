"use client";

import { handleServerActionResponse } from "@/lib/client-utils";
import { resetPassword, sendPassword } from "@/lib/server/password";
import { create } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { LoginSettings } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertType } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { TextInput } from "./input";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs = {
  password: string;
};

type Props = {
  loginSettings: LoginSettings | undefined;
  loginName: string;
  organization?: string;
  defaultOrganization?: string;
  requestId?: string;
  // "noPasskey": "Passwordless sign-in" found no passkey on this account (02a·E).
  notice?: "noPasskey";
  // An administrator reset the password (02a·F): no password is asked for,
  // the emailed link sets a new one.
  resetRequired?: boolean;
};

export function PasswordForm({
  loginSettings,
  loginName,
  organization,
  defaultOrganization,
  requestId,
  notice,
  resetRequired,
}: Props) {
  // Buttons stay enabled; the checks run when the user submits.
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    resetField,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const t = useTranslations("password");

  const [info, setInfo] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const [loading, setLoading] = useState<boolean>(false);

  const router = useRouter();

  // Back to 01: "Change" keeps the email to edit, "Use a different email" clears it.
  const toLoginName = (keepEmail: boolean) => {
    const params = new URLSearchParams();
    if (keepEmail) {
      params.append("loginName", loginName);
    }
    if (organization) {
      params.append("organization", organization);
    }
    if (requestId) {
      params.append("requestId", requestId);
    }
    return "/loginname?" + params;
  };

  async function submitPassword(values: Inputs) {
    setError("");
    setLoading(true);

    try {
      const response = await sendPassword({
        loginName,
        organization,
        defaultOrganization,
        checks: create(ChecksSchema, {
          password: { password: values.password },
        }),
        requestId,
      });

      // Typed values stay, except the password after a failed attempt.
      if (response && "error" in response) {
        resetField("password");
        if (response.field === "password") {
          setFieldError("password", { type: "server", message: response.error }, { shouldFocus: true });
          return;
        }
      }

      handleServerActionResponse(response, router, setSamlData, setError);
    } catch {
      setError(t("verify.errors.couldNotVerifyPassword"));
    } finally {
      setLoading(false);
    }
  }

  async function resetPasswordAndContinue() {
    setError("");
    setInfo("");
    setLoading(true);

    const response = await resetPassword({
      loginName,
      organization,
      defaultOrganization,
      requestId,
    })
      .catch(() => {
        setError(t("errors.couldNotSendResetLink"));
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (response && "error" in response) {
      setError(response.error as string);
      return;
    }

    setInfo(t("verify.info.passwordResetSent"));

    const params = new URLSearchParams({
      loginName: loginName,
    });

    if (organization) {
      params.append("organization", organization);
    }

    if (requestId) {
      params.append("requestId", requestId);
    }

    return router.push("/password/set?" + params);
  }

  const locked = error === t("errors.accountLocked");

  const emailChip = (
    <div className="flex flex-col gap-[6px] text-[14px]">
      <span>
        <Translated i18nKey="verify.labels.email" namespace="password" />
      </span>
      <div className="flex h-[44px] flex-row items-center justify-between gap-2 rounded-[8px] bg-[var(--bp-surface)] px-[14px] text-[15px]">
        <span className="truncate" data-testid="login-name">
          {loginName}
        </span>
        <button
          type="button"
          className="text-primary-light-500 dark:text-primary-dark-500 text-[14px] font-medium hover:underline"
          onClick={() => router.push(toLoginName(true))}
          data-testid="change-button"
        >
          <Translated i18nKey="verify.change" namespace="password" />
        </button>
      </div>
    </div>
  );

  const useDifferentEmail = (
    <Button
      type="button"
      className="w-full"
      variant={ButtonVariants.Secondary}
      onClick={() => router.push(toLoginName(false))}
      data-testid="different-email-button"
    >
      <Translated i18nKey="verify.useDifferentEmail" namespace="password" />
    </Button>
  );

  // 02a·F: an administrator reset the password; the old one no longer works.
  if (resetRequired) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Alert type={AlertType.INFO} title={t("verify.resetByAdmin.title")}>
          {t("verify.resetByAdmin.description")}
        </Alert>
        {error && <Alert>{error}</Alert>}
        <Button
          type="button"
          className="mt-3 w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
          onClick={() => resetPasswordAndContinue()}
          data-testid="send-link-button"
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />}
          <Translated i18nKey="verify.resetByAdmin.sendLink" namespace="password" />
        </Button>
        {useDifferentEmail}
      </div>
    );
  }

  // 02a·B: Zitadel locked the account; only an administrator unlocks it.
  if (locked) {
    return (
      <div className="flex w-full flex-col gap-3" data-testid="error">
        <Alert title={error}>{t("errors.accountLockedHint")}</Alert>
        <div className="mt-3">{useDifferentEmail}</div>
      </div>
    );
  }

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {notice === "noPasskey" && (
        <div className="mb-6">
          <Alert type={AlertType.INFO} title={t("verify.noPasskey.title")}>
            {t("verify.noPasskey.description")}
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-6" data-testid="error">
          <Alert title={error} />
        </div>
      )}
      {info && (
        <div className="mb-6">
          <Alert type={AlertType.INFO}>{info}</Alert>
        </div>
      )}
      <form className="flex w-full flex-col gap-5" noValidate onSubmit={handleSubmit(submitPassword)}>
        {emailChip}
        <TextInput
          type="password"
          autoComplete="current-password"
          autoFocus
          {...register("password", { required: t("verify.required.password") })}
          label={t("verify.labels.password")}
          labelAction={
            !loginSettings?.hidePasswordReset && (
              <button
                className="text-primary-light-500 dark:text-primary-dark-500 font-medium hover:underline"
                onClick={() => resetPasswordAndContinue()}
                type="button"
                disabled={loading}
                data-testid="reset-button"
              >
                <Translated i18nKey="verify.resetPassword" namespace="password" />
              </button>
            )
          }
          error={errors.password?.message}
          data-testid="password-text-input"
        />

        {loginName && <input type="hidden" name="loginName" autoComplete="username" value={loginName} />}

        <Button
          type="submit"
          className="w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
          data-testid="submit-button"
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />} <Translated i18nKey="verify.submit" namespace="password" />
        </Button>
      </form>
    </>
  );
}
