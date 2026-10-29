"use client";

import { handleServerActionResponse } from "@/lib/client-utils";
import { sendLoginname } from "@/lib/server/loginname";
import { FingerPrintIcon } from "@heroicons/react/24/outline";
import { LoginSettings } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { Divider } from "./divider";
import { TextInput } from "./input";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs = {
  loginName: string;
};

// A banner on this screen: a refusal from Zitadel or the network (01·D, 01·E,
// a deactivated account); the email stays filled.
export type LoginBanner = { title: string; description?: string };

type Props = {
  loginName: string | undefined;
  requestId: string | undefined;
  loginSettings: LoginSettings | undefined;
  organization?: string;
  defaultOrganization?: string;
  suffix?: string;
  hideSuffix?: boolean;
  submit: boolean;
  allowRegister: boolean;
  // Passkeys are allowed by the login settings: offer "Passwordless sign-in".
  allowPasskeys?: boolean;
  // A banner the page was opened with (a provider's sign-in failed).
  banner?: LoginBanner;
  // The provider tiles, under the passwordless button.
  children?: ReactNode;
};

// What the browser checks before Zitadel does: a login name here is an email.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsernameForm({
  loginName,
  requestId,
  organization,
  defaultOrganization,
  suffix,
  hideSuffix,
  loginSettings,
  submit,
  allowRegister,
  allowPasskeys = false,
  banner: initialBanner,
  children,
}: Props) {
  // Buttons stay enabled; the checks run when the user submits.
  const {
    register,
    handleSubmit,
    getValues,
    setError: setFieldError,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      loginName: loginName ? loginName : "",
    },
  });

  const t = useTranslations("loginname");

  const router = useRouter();

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [unreachable, setUnreachable] = useState<boolean>(false);
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const submitLoginName = useCallback(
    async (values: Inputs, organization?: string, method?: "passkey") => {
      setLoading(true);
      setUnreachable(false);

      try {
        const res = await sendLoginname({
          loginName: values.loginName,
          organization,
          defaultOrganization,
          requestId,
          suffix,
          method,
        });

        handleServerActionResponse(res, router, setSamlData, setError);
        return res;
      } catch {
        // The server action never answered: the network or the login is down (01·E).
        setUnreachable(true);
        setError("");
      } finally {
        setLoading(false);
      }
    },
    [defaultOrganization, requestId, suffix, router],
  );

  // Zitadel's refusals arrive as one translated line; the ones the design
  // gives a second line to are shown as a title and its hint.
  const banner: LoginBanner | undefined = unreachable
    ? { title: t("errors.internalError"), description: t("errors.internalErrorHint") }
    : error
      ? error === t("errors.userNotActive")
        ? { title: error, description: t("errors.userNotActiveHint") }
        : { title: error }
      : initialBanner;

  const loginNameRules = {
    required: t("required.loginName"),
    validate: (value: string) =>
      loginSettings?.disableLoginWithEmail || EMAIL_SHAPE.test(value.trim()) || t("errors.incompleteEmail"),
  };

  const signInWithPasskey = () => {
    // Zitadel needs the user before it can start a passkey sign-in (01·C).
    if (!getValues("loginName").trim()) {
      setFieldError("loginName", { type: "required", message: t("errors.passwordlessNeedsEmail") }, { shouldFocus: true });
      return;
    }
    handleSubmit((values) => submitLoginName(values, organization, "passkey"))();
  };

  useEffect(() => {
    if (submit && loginName) {
      // When we navigate to this page, we always want to be redirected if submit is true and the parameters are valid.
      submitLoginName({ loginName }, organization);
    }
  }, [submit, loginName, organization, submitLoginName]);

  let inputLabel = t("labels.loginname");
  if (loginSettings?.disableLoginWithEmail && loginSettings?.disableLoginWithPhone) {
    inputLabel = t("labels.username");
  } else if (loginSettings?.disableLoginWithEmail) {
    inputLabel = t("labels.usernameOrPhoneNumber");
  } else if (loginSettings?.disableLoginWithPhone) {
    inputLabel = t("labels.usernameOrEmail");
  }

  const hasAlternatives = allowPasskeys || !!children;

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {banner && (
        <div className="mb-6" data-testid="error">
          <Alert title={banner.title}>{banner.description}</Alert>
        </div>
      )}
      <form
        method="post"
        className="flex w-full flex-col"
        noValidate
        onSubmit={handleSubmit((e) => submitLoginName(e, organization))}
      >
        <TextInput
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          {...register("loginName", loginNameRules)}
          label={inputLabel}
          error={errors.loginName?.message}
          data-testid="username-text-input"
          suffix={hideSuffix ? undefined : suffix}
        />

        <Button
          data-testid="submit-button"
          type="submit"
          className="mt-3 w-full"
          variant={ButtonVariants.Primary}
          disabled={loading}
        >
          {loading && <Spinner className="mr-2 h-5 w-5" />}
          <Translated i18nKey={unreachable ? "tryAgain" : "submit"} namespace="loginname" />
        </Button>
      </form>

      {hasAlternatives && (
        <div className="mt-5 flex flex-col gap-5">
          <Divider>
            <Translated i18nKey="orSignInWith" namespace="idp" />
          </Divider>
          <div className="flex flex-col gap-2">
            {allowPasskeys && (
              <Button
                data-testid="passkey-button"
                type="button"
                className="w-full"
                variant={ButtonVariants.Secondary}
                disabled={loading}
                onClick={signInWithPasskey}
              >
                <FingerPrintIcon className="h-5 w-5" aria-hidden="true" />
                <Translated i18nKey="passwordless" namespace="loginname" />
              </Button>
            )}
            {children}
          </div>
        </div>
      )}

      {allowRegister && (
        <div className="mt-7 flex flex-row flex-wrap items-center gap-1.5 text-[14px]">
          <span className="text-[var(--bp-subtle)]">
            <Translated i18nKey="registerPrompt" namespace="loginname" />
          </span>
          <button
            className="text-primary-light-500 dark:text-primary-dark-500 font-medium hover:underline"
            onClick={() => {
              const registerParams = new URLSearchParams();
              if (organization) {
                registerParams.append("organization", organization);
              }
              if (requestId) {
                registerParams.append("requestId", requestId);
              }

              router.push("/register?" + registerParams);
            }}
            type="button"
            disabled={loading}
            data-testid="register-button"
          >
            <Translated i18nKey="register" namespace="loginname" />
          </button>
        </div>
      )}
    </>
  );
}
