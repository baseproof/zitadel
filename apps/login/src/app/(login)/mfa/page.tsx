import { Alert } from "@/components/alert";
import { ChooseSecondFactor } from "@/components/choose-second-factor";
import { DynamicTheme } from "@/components/dynamic-theme";
import { EmailChip, loginNameHref } from "@/components/email-chip";
import { Translated } from "@/components/translated";
import { getSessionCookieById } from "@/lib/cookies";
import { getServiceConfig } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getBrandingSettings, getSession, listAuthenticationMethodTypes } from "@/lib/zitadel";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mfa");
  return { title: t("verify.title") };
}

export default async function Page(props: { searchParams: Promise<Record<string | number | symbol, string | undefined>> }) {
  const searchParams = await props.searchParams;

  const { loginName, requestId, organization, sessionId } = searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const sessionFactors = sessionId
    ? await loadSessionById(sessionId, organization)
    : await loadSessionByLoginname(loginName, organization);

  async function loadSessionByLoginname(loginName?: string, organization?: string) {
    return loadMostRecentSession({
      serviceConfig,
      sessionParams: {
        loginName,
        organization,
      },
    }).then((session) => {
      if (session && session.factors?.user?.id) {
        return listAuthenticationMethodTypes({ serviceConfig, userId: session.factors.user.id }).then((methods) => {
          return {
            factors: session?.factors,
            authMethods: methods.authMethodTypes ?? [],
          };
        });
      }
    });
  }

  async function loadSessionById(sessionId: string, organization?: string) {
    const recent = await getSessionCookieById({ sessionId, organization });

    if (!recent) {
      return undefined;
    }

    return getSession({ serviceConfig, sessionId: recent.id, sessionToken: recent.token }).then((response) => {
      if (response?.session && response.session.factors?.user?.id) {
        return listAuthenticationMethodTypes({ serviceConfig, userId: response.session.factors.user.id }).then((methods) => {
          return {
            factors: response.session?.factors,
            authMethods: methods.authMethodTypes ?? [],
          };
        });
      }
    });
  }

  const branding = await getBrandingSettings({ serviceConfig, organization });

  const email = loginName ?? sessionFactors?.factors?.user?.loginName;

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="verify.title" namespace="mfa" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="verify.description" namespace="mfa" />
        </p>
      </div>

      <div className="flex w-full flex-col gap-5">
        {!(loginName || sessionId) && (
          <Alert>
            <Translated i18nKey="unknownContext" namespace="error" />
          </Alert>
        )}

        {email && <EmailChip loginName={email} changeHref={loginNameHref({ loginName: email, organization, requestId })} />}

        {sessionFactors ? (
          <ChooseSecondFactor
            loginName={loginName}
            sessionId={sessionId}
            requestId={requestId}
            organization={organization}
            userMethods={sessionFactors.authMethods ?? []}
          ></ChooseSecondFactor>
        ) : (
          <Alert>
            <Translated i18nKey="verify.noResults" namespace="mfa" />
          </Alert>
        )}
      </div>
    </DynamicTheme>
  );
}
