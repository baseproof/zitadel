"use client";

import { lowerCaseValidator, numberValidator, symbolValidator, upperCaseValidator } from "@/helpers/validators";
import { handleServerActionResponse } from "@/lib/client-utils";
import { changePassword, resetPassword, sendPassword } from "@/lib/server/password";
import { create } from "@zitadel/client";
import { ChecksSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb";
import { PasswordComplexitySettings } from "@zitadel/proto/zitadel/settings/v2/password_settings_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, FieldValues, useForm } from "react-hook-form";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { CodeInput } from "./code-input";
import { TextInput } from "./input";
import { PasswordComplexity } from "./password-complexity";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs =
  | {
      code: string;
      password: string;
      confirmPassword: string;
    }
  | FieldValues;

type Props = {
  code?: string;
  passwordComplexitySettings: PasswordComplexitySettings;
  loginName: string;
  userId: string;
  organization?: string;
  defaultOrganization?: string;
  requestId?: string;
  codeRequired: boolean;
};

export function SetPasswordForm({
  passwordComplexitySettings,
  organization,
  defaultOrganization,
  requestId,
  loginName,
  userId,
  code,
  codeRequired,
}: Props) {
  // Buttons stay enabled; the checks run when the user submits.
  const { register, handleSubmit, watch, control, formState } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      code: code ?? "",
    },
  });

  const t = useTranslations("password");

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const router = useRouter();

  async function resendCode() {
    setError("");
    setLoading(true);

    const response = await resetPassword({
      loginName,
      organization,
      defaultOrganization,
      requestId,
    })
      .catch(() => {
        setError(t("set.errors.couldNotResetPassword"));
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (response && "error" in response && typeof response.error === "string") {
      setError(response.error);
      return;
    }
  }

  async function submitPassword(values: Inputs) {
    setLoading(true);

    let payload: { userId: string; password: string; code?: string; organization?: string } = {
      userId: userId,
      password: values.password,
      organization,
    };

    // this is not required for initial password setup
    if (codeRequired) {
      payload = { ...payload, code: values.code };
    }

    const changeResponse = await changePassword(payload).catch(() => {
      setError(t("set.errors.couldNotSetPassword"));
      setLoading(false);
      return;
    });

    if (changeResponse && "error" in changeResponse) {
      setLoading(false);
      setError(changeResponse.error);
      return;
    }

    if (!changeResponse) {
      setLoading(false);
      setError(t("set.errors.couldNotSetPassword"));
      return;
    }

    const params = new URLSearchParams({});

    if (loginName) {
      params.append("loginName", loginName);
    }
    if (organization) {
      params.append("organization", organization);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for a second to avoid eventual consistency issues with an initial password being set

    const passwordResponse = await sendPassword({
      loginName,
      organization,
      checks: create(ChecksSchema, {
        password: { password: values.password },
      }),
      requestId,
    }).catch(() => {
      setError(t("set.errors.couldNotVerifyPassword"));
      setLoading(false);
      return;
    });

    setLoading(false);
    handleServerActionResponse(passwordResponse as any, router, setSamlData, setError);

    return;
  }

  const { errors, isSubmitted } = formState;

  const watchPassword = watch("password", "");
  const watchConfirmPassword = watch("confirmPassword", "");

  // The first rule the password still misses, said as what to do (02d·A).
  const passwordRule = (value: string) => {
    if (!passwordComplexitySettings) {
      return true;
    }
    if (value.length < passwordComplexitySettings.minLength) {
      return t("set.errors.addLength", { minLength: passwordComplexitySettings.minLength.toString() });
    }
    if (passwordComplexitySettings.requiresNumber && !numberValidator(value)) {
      return t("set.errors.addNumber");
    }
    if (passwordComplexitySettings.requiresUppercase && !upperCaseValidator(value)) {
      return t("set.errors.addUppercase");
    }
    if (passwordComplexitySettings.requiresLowercase && !lowerCaseValidator(value)) {
      return t("set.errors.addLowercase");
    }
    if (passwordComplexitySettings.requiresSymbol && !symbolValidator(value)) {
      return t("set.errors.addSymbol");
    }
    return true;
  };

  // 02d's "Go passwordless instead": back to the passkey offer for this new account.
  const passkeyParams = new URLSearchParams({ loginName });
  if (organization) {
    passkeyParams.append("organization", organization);
  }
  if (requestId) {
    passkeyParams.append("requestId", requestId);
  }

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {error && (
        <div className="mb-6">
          <Alert title={error} />
        </div>
      )}
      <form className="flex w-full flex-col" noValidate onSubmit={handleSubmit(submitPassword)}>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={loginName}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <div className="flex flex-col gap-5">
          {codeRequired && (
            <div className="flex flex-col gap-2">
              <Controller
                control={control}
                name="code"
                rules={{
                  required: t("set.required.code"),
                  validate: (value: string) => value.length === 6 || t("set.errors.codeIncomplete"),
                }}
                render={({ field }) => (
                  <CodeInput
                    ref={field.ref}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    label={t("set.labels.code")}
                    hint={t("set.codeHint")}
                    error={errors.code?.message as string}
                    autoFocus
                  />
                )}
              />
              <div className="flex flex-row items-center gap-1.5 text-[14px]">
                <span className="text-[var(--bp-subtle)]">
                  <Translated i18nKey="set.noCodeReceived" namespace="password" />
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
                  <Translated i18nKey="set.resend" namespace="password" />
                </button>
              </div>
            </div>
          )}
          <TextInput
            type="password"
            autoComplete="new-password"
            autoFocus={!codeRequired}
            {...register("password", {
              required: t("set.required.newPassword"),
              validate: passwordRule,
            })}
            label={t("set.labels.newPassword")}
            error={errors.password?.message as string}
            data-testid="password-set-text-input"
          />
          <TextInput
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword", {
              required: t("set.required.confirmPassword"),
              validate: (value: string) => value === watch("password") || t("set.errors.mismatch"),
            })}
            label={t("set.labels.confirmPassword")}
            error={errors.confirmPassword?.message as string}
            data-testid="password-set-confirm-text-input"
          />
        </div>

        {passwordComplexitySettings && (
          <div className="mt-5">
            <PasswordComplexity
              passwordComplexitySettings={passwordComplexitySettings}
              password={watchPassword}
              equals={!!watchPassword && watchPassword === watchConfirmPassword}
              showErrors={isSubmitted}
            />
          </div>
        )}

        <div className="mt-7 flex flex-col gap-2">
          <Button
            type="submit"
            className="w-full"
            variant={ButtonVariants.Primary}
            disabled={loading}
            data-testid="submit-button"
          >
            {loading && <Spinner className="mr-2 h-5 w-5" />} <Translated i18nKey="set.submit" namespace="password" />
          </Button>
          {!codeRequired && (
            <Button
              type="button"
              className="w-full"
              variant={ButtonVariants.Secondary}
              onClick={() => router.push("/passkey/set?" + passkeyParams)}
              data-testid="go-passwordless-button"
            >
              <Translated i18nKey="set.goPasswordless" namespace="password" />
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
