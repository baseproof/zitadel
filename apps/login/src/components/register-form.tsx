"use client";

import { handleServerActionResponse } from "@/lib/client-utils";
import { registerUser } from "@/lib/server/register";
import { LegalAndSupportSettings } from "@zitadel/proto/zitadel/settings/v2/legal_settings_pb";
import { LoginSettings, PasskeysType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldValues, useForm } from "react-hook-form";
import { Alert, AlertType } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { ConsentCheckbox } from "./consent-checkbox";
import { TextInput } from "./input";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs =
  | {
      firstname: string;
      lastname: string;
      email: string;
      // The Terms of Service (and Privacy Policy) box (02b).
      consent: boolean;
    }
  | FieldValues;

type Props = {
  legal: LegalAndSupportSettings;
  firstname?: string;
  lastname?: string;
  email?: string;
  organization: string;
  requestId?: string;
  loginSettings?: LoginSettings;
  idpCount: number;
};

export function RegisterForm({
  legal,
  email,
  firstname,
  lastname,
  organization,
  requestId,
  loginSettings,
  idpCount = 0,
}: Props) {
  // Buttons stay enabled; the checks run when the user submits.
  const {
    register,
    handleSubmit,
    getValues,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      email: email ?? "",
      firstname: firstname ?? "",
      lastname: lastname ?? "",
      consent: false,
    },
  });

  const t = useTranslations("register");

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);

  const router = useRouter();

  const toLoginName = (loginName?: string) => {
    const params = new URLSearchParams();
    if (loginName) {
      params.append("loginName", loginName);
      params.append("submit", "true");
    }
    if (requestId) {
      params.append("requestId", requestId);
    }
    return "/loginname?" + params;
  };

  async function submitAndRegister(values: Inputs) {
    setLoading(true);
    try {
      const response = await registerUser({
        email: values.email,
        firstName: values.firstname,
        lastName: values.lastname,
        organization: organization,
        requestId: requestId,
      });

      handleServerActionResponse(response, router, setSamlData, setError);

      return response;
    } catch {
      setError(t("errors.couldNotRegisterUser"));
    } finally {
      setLoading(false);
    }
  }

  async function submitAndContinue(value: Inputs, withPassword: boolean = false) {
    const registerParams: any = value;

    if (organization) {
      registerParams.organization = organization;
    }

    if (requestId) {
      registerParams.requestId = requestId;
    }

    // redirect user to /register/password if password is chosen
    if (withPassword) {
      return router.push(`/register/password?` + new URLSearchParams(registerParams));
    } else {
      return submitAndRegister(value);
    }
  }

  // The legal settings name the links to agree to; with none, there is nothing to accept.
  const consentRequired = !!(legal?.tosLink || legal?.privacyPolicyLink);
  const alreadyExists = error === t("errors.userAlreadyExists");

  return (
    <>
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {/* Sent here by 01 with an email no account uses (02b). */}
      {email && !alreadyExists && (
        <div
          className="text-primary-light-500 dark:text-primary-dark-500 mb-6 rounded-[8px] bg-[var(--bp-info-bg)] px-[14px] py-[10px] text-[14px] leading-[1.45]"
          data-testid="new-email-callout"
        >
          {t("newEmailCallout", { email })}
        </div>
      )}
      {alreadyExists && (
        <div className="mb-6" data-testid="error">
          <Alert title={error}>{t("errors.userAlreadyExistsHint")}</Alert>
        </div>
      )}
      {error && !alreadyExists && (
        <div className="mb-6" data-testid="error">
          <Alert title={error} />
        </div>
      )}
      <form
        className="flex w-full flex-col"
        noValidate
        onSubmit={handleSubmit((values) => {
          // Passwordless first (02c) when passkeys are allowed; "Use password instead" is offered there.
          const withPassword =
            loginSettings?.passkeysType !== PasskeysType.ALLOWED && !!loginSettings?.allowLocalAuthentication;
          return submitAndContinue(values, withPassword);
        })}
      >
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            type="text"
            autoComplete="given-name"
            autoFocus
            {...register("firstname", { required: t("required.firstname") })}
            label={t("labels.firstname")}
            error={errors.firstname?.message as string}
            data-testid="firstname-text-input"
          />
          <TextInput
            type="text"
            autoComplete="family-name"
            {...register("lastname", { required: t("required.lastname") })}
            label={t("labels.lastname")}
            error={errors.lastname?.message as string}
            data-testid="lastname-text-input"
          />
        </div>
        <div className="mt-4">
          <TextInput
            type="email"
            autoComplete="email"
            {...register("email", { required: t("required.email") })}
            label={t("labels.email")}
            error={errors.email?.message as string}
            data-testid="email-text-input"
          />
        </div>
        {consentRequired && (
          <div className="mt-[18px]">
            <ConsentCheckbox
              legal={legal}
              {...register("consent", {
                validate: (accepted) => !!accepted || t("consent.required"),
              })}
              error={errors.consent?.message as string}
            />
          </div>
        )}
        {!loginSettings?.allowLocalAuthentication &&
          loginSettings?.passkeysType !== PasskeysType.ALLOWED &&
          (!loginSettings?.allowExternalIdp || !idpCount) && (
            <div className="mt-4">
              <Alert type={AlertType.INFO}>
                <Translated i18nKey="noMethodAvailableWarning" namespace="register" />
              </Alert>
            </div>
          )}

        {alreadyExists ? (
          <div className="mt-6 flex flex-col gap-2">
            <Button
              type="button"
              className="w-full"
              variant={ButtonVariants.Primary}
              onClick={() => router.push(toLoginName(getValues("email")))}
              data-testid="login-instead-button"
            >
              <Translated i18nKey="logInInstead" namespace="register" />
            </Button>
            <Button
              type="button"
              className="w-full"
              variant={ButtonVariants.Secondary}
              onClick={() => {
                setError("");
                resetField("email", { defaultValue: "" });
                setFocus("email");
              }}
              data-testid="different-email-button"
            >
              <Translated i18nKey="useDifferentEmail" namespace="register" />
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            className="mt-6 w-full"
            variant={ButtonVariants.Primary}
            disabled={loading}
            data-testid="submit-button"
          >
            {loading && <Spinner className="mr-2 h-5 w-5" />}
            <Translated i18nKey="submit" namespace="register" />
          </Button>
        )}
      </form>
    </>
  );
}
