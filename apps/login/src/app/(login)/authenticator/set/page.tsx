import { Alert } from "@/components/alert";
import { ChooseAuthenticatorToSetup } from "@/components/choose-authenticator-to-setup";
import { Divider } from "@/components/divider";
import { DynamicTheme } from "@/components/dynamic-theme";
import { EmailChip, loginNameHref } from "@/components/email-chip";
import { SignInWithIdp } from "@/components/sign-in-with-idp";
import { Translated } from "@/components/translated";
import { getSessionCookieById } from "@/lib/cookies";
import { idpButtons } from "@/lib/idp";
import { getServiceConfig } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { checkUserVerification } from "@/lib/verify-helper";
import {
  getActiveIdentityProviders,
  getBrandingSettings,
  getLoginSettings,
  getSession,
  getUserByID,
  listAuthenticationMethodTypes,
} from "@/lib/zitadel";
import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import { PasskeysType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
// import { getLocale } from "next-intl/server";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("authenticator");
  return { title: t("title") };
}

export default async function Page(props: { searchParams: Promise<Record<string | number | symbol, string | undefined>> }) {
  const searchParams = await props.searchParams;

  const { loginName, requestId, organization, sessionId } = searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const sessionWithData = sessionId
    ? await loadSessionById(sessionId, organization)
    : await loadSessionByLoginname(loginName, organization);

  async function getAuthMethodsAndUser(session?: Session) {
    const userId = session?.factors?.user?.id;

    if (!userId) {
      throw Error("Could not get user id from session");
    }

    const methods = await listAuthenticationMethodTypes({ serviceConfig, userId });
    const user = await getUserByID({ serviceConfig, userId });

    const humanUser = user.user?.type.case === "human" ? user.user?.type.value : undefined;

    return {
      id: session?.id,
      factors: session?.factors,
      authMethods: methods.authMethodTypes ?? [],
      phoneVerified: humanUser?.phone?.isVerified ?? false,
      emailVerified: humanUser?.email?.isVerified ?? false,
      expirationDate: session?.expirationDate,
    };
  }

  async function loadSessionByLoginname(loginName?: string, organization?: string) {
    const session = await loadMostRecentSession({
      serviceConfig,
      sessionParams: {
        loginName,
        organization,
      },
    });

    return getAuthMethodsAndUser(session);
  }

  async function loadSessionById(sessionId: string, organization?: string) {
    const recent = await getSessionCookieById({ sessionId, organization });

    if (!recent) {
      return undefined;
    }

    const sessionResponse = await getSession({ serviceConfig, sessionId: recent.id, sessionToken: recent.token });
    return getAuthMethodsAndUser(sessionResponse.session);
  }

  if (!sessionWithData || !sessionWithData.factors || !sessionWithData.factors.user) {
    return (
      <Alert>
        {/* context was provided but the session could not be resolved (cookie missing, invalid or expired) */}
        <Translated i18nKey={loginName || sessionId ? "sessionExpired" : "unknownContext"} namespace="error" />
      </Alert>
    );
  }

  const branding = await getBrandingSettings({ serviceConfig, organization: sessionWithData.factors.user?.organizationId });

  const loginSettings = await getLoginSettings({
    serviceConfig,
    organization: sessionWithData.factors.user?.organizationId,
  });

  // check if user was verified recently
  const isUserVerified = await checkUserVerification(sessionWithData.factors.user?.id);

  if (!isUserVerified) {
    const params = new URLSearchParams({
      loginName: sessionWithData.factors.user.loginName as string,
      invite: "true",
      send: "true", // set this to true to request a new code immediately
    });

    if (requestId) {
      params.append("requestId", requestId);
    }

    if (organization || sessionWithData.factors.user.organizationId) {
      params.append("organization", organization ?? (sessionWithData.factors.user.organizationId as string));
    }

    redirect(`/verify?` + params);
  }

  const { identityProviders } = await getActiveIdentityProviders({
    serviceConfig,
    orgId: sessionWithData.factors?.user?.organizationId,
    linking_allowed: true,
  });

  const params = new URLSearchParams({
    initial: "true", // defines that a code is not required and is therefore not shown in the UI
  });

  if (sessionWithData.factors?.user?.loginName) {
    params.set("loginName", sessionWithData.factors?.user?.loginName);
  }

  if (sessionWithData.factors?.user?.organizationId) {
    params.set("organization", sessionWithData.factors?.user?.organizationId);
  }

  if (requestId) {
    params.set("requestId", requestId);
  }

  // An account with no way to sign in yet (it left 02c before choosing one)
  // gets the same offer as a new account: passwordless first, a password
  // through "Use password instead" (baseproof/legal-agents#120).
  if (loginSettings?.passkeysType === PasskeysType.ALLOWED && loginSettings?.allowLocalAuthentication) {
    params.delete("initial");
    redirect(`/passkey/set?` + params);
  }

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="title" namespace="authenticator" />
        </h1>

        <p className="ztdl-p">
          <Translated i18nKey="description" namespace="authenticator" />
        </p>
      </div>

      <div className="flex w-full flex-col gap-5">
        {sessionWithData.factors.user.loginName && (
          <EmailChip
            loginName={sessionWithData.factors.user.loginName}
            changeHref={loginNameHref({
              loginName: sessionWithData.factors.user.loginName,
              organization: sessionWithData.factors.user.organizationId,
              requestId,
            })}
          />
        )}

        {loginSettings && (
          <ChooseAuthenticatorToSetup
            authMethods={sessionWithData.authMethods}
            loginSettings={loginSettings}
            params={params}
          ></ChooseAuthenticatorToSetup>
        )}

        {loginSettings?.allowExternalIdp && !!identityProviders.length && (
          <>
            <Divider>
              <Translated i18nKey="linkWithIDP" namespace="authenticator" />
            </Divider>

            <SignInWithIdp
              showLabel={false}
              identityProviders={idpButtons(identityProviders)}
              requestId={requestId}
              organization={sessionWithData.factors?.user?.organizationId}
              sessionId={sessionWithData.id} // tell the callback function to link the IDP
              loginHint={sessionWithData.factors?.user?.loginName}
            ></SignInWithIdp>
          </>
        )}
      </div>
    </DynamicTheme>
  );
}
