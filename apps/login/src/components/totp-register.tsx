"use client";

import { completeFlowOrGetUrl } from "@/lib/client";
import { handleServerActionResponse } from "@/lib/client-utils";
import { verifyTOTP } from "@/lib/server/verify";
import { LoginSettings } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Button, ButtonVariants } from "./button";
import { CodeInput } from "./code-input";
import { CopyToClipboard } from "./copy-to-clipboard";
import { Spinner } from "./spinner";
import { Translated } from "./translated";

type Inputs = {
  code: string;
};

type Props = {
  uri: string;
  secret: string;
  loginName?: string;
  sessionId?: string;
  requestId?: string;
  organization?: string;
  checkAfter?: boolean;
  loginSettings?: LoginSettings;
};
export function TotpRegister({ uri, loginName, sessionId, requestId, organization, checkAfter, loginSettings }: Props) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [samlData, setSamlData] = useState<{ url: string; fields: Record<string, string> } | null>(null);
  const router = useRouter();

  // The button stays enabled; the check runs when the user submits.
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      code: "",
    },
  });

  const t = useTranslations("otp");

  async function continueWithCode(values: Inputs) {
    setLoading(true);
    return verifyTOTP(values.code, loginName, organization)
      .then(async () => {
        // if attribute is set, validate MFA after it is setup, otherwise proceed as usual (when mfa is enforced to login)
        if (checkAfter) {
          const params = new URLSearchParams({});

          if (loginName) {
            params.append("loginName", loginName);
          }
          if (requestId) {
            params.append("requestId", requestId);
          }
          if (organization) {
            params.append("organization", organization);
          }

          return router.push(`/otp/time-based?` + params);
        } else {
          if (requestId && sessionId) {
            const callbackResponse = await completeFlowOrGetUrl(
              {
                sessionId: sessionId,
                requestId: requestId,
                organization: organization,
              },
              loginSettings?.defaultRedirectUri,
            );

            handleServerActionResponse(callbackResponse, router, setSamlData, setError);
          } else if (loginName) {
            const callbackResponse = await completeFlowOrGetUrl(
              {
                loginName: loginName,
                organization: organization,
              },
              loginSettings?.defaultRedirectUri,
            );

            handleServerActionResponse(callbackResponse, router, setSamlData, setError);
          }
        }
      })
      .catch((e) => {
        setError(e.message);
        return;
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <div className="flex w-full flex-col gap-5">
      {samlData && <AutoSubmitForm url={samlData.url} fields={samlData.fields} />}
      {uri && (
        <>
          <QRCodeSVG className="h-40 w-40 rounded-[8px] bg-white p-2" value={uri} />
          <div className="flex w-full flex-row items-center gap-2 rounded-[8px] bg-[var(--bp-surface)] py-2 pr-2 pl-[14px] text-[13px]">
            <Link href={uri} target="_blank" className="min-w-0 flex-1 truncate">
              {uri}
            </Link>

            <CopyToClipboard value={uri}></CopyToClipboard>
          </div>

          {error && <Alert>{error}</Alert>}

          <form method="post" className="flex w-full flex-col gap-5" noValidate onSubmit={handleSubmit(continueWithCode)}>
            <Controller
              control={control}
              name="code"
              rules={{
                required: t("set.required.code"),
                validate: (value: string) => value.length === 6 || t("set.required.code"),
              }}
              render={({ field }) => (
                <CodeInput
                  ref={field.ref}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  label={t("set.labels.code")}
                  error={errors.code?.message}
                  autoFocus
                />
              )}
            />

            <Button
              type="submit"
              className="w-full"
              variant={ButtonVariants.Primary}
              disabled={loading}
              data-testid="submit-button"
            >
              {loading && <Spinner className="mr-2 h-5 w-5" />}
              <Translated i18nKey="set.submit" namespace="otp" />
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
