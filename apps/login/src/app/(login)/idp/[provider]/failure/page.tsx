import { Alert, AlertType } from "@/components/alert";
import { ChooseAuthenticatorToLogin } from "@/components/choose-authenticator-to-login";
import { DynamicTheme } from "@/components/dynamic-theme";
import { EmailChip, loginNameHref } from "@/components/email-chip";
import { Translated } from "@/components/translated";
import { getServiceConfig } from "@/lib/service-url";
import {
  getBrandingSettings,
  getIDPByID,
  getLoginSettings,
  getUserByID,
  listAuthenticationMethodTypes,
} from "@/lib/zitadel";
import { User } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
  params: Promise<{ provider: string }>;
}) {
  const searchParams = await props.searchParams;

  const { organization, userId, postErrorRedirectUrl, idpId, requestId } = searchParams;
  const { provider } = await props.params;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  // A sign-in through a provider that came back without finishing (cancelled
  // there, or refused) returns to the screen it started on, with a banner
  // naming the provider (baseproof/legal-agents#120, 01·D). Only a path on
  // this login is followed, never another site.
  if (!userId && postErrorRedirectUrl?.startsWith("/") && !postErrorRedirectUrl.startsWith("//")) {
    const idp = idpId ? await getIDPByID({ serviceConfig, id: idpId }) : undefined;
    const back = new URLSearchParams({ idpFailed: idp?.name || provider });
    if (requestId) {
      back.set("requestId", requestId);
    }
    if (organization) {
      back.set("organization", organization);
    }
    redirect(`${postErrorRedirectUrl}?${back}`);
  }

  const branding = await getBrandingSettings({ serviceConfig, organization });

  const loginSettings = await getLoginSettings({ serviceConfig, organization });

  let authMethods: AuthenticationMethodType[] = [];
  let user: User | undefined = undefined;

  const params = new URLSearchParams({});
  if (organization) {
    params.set("organization", organization);
  }
  if (userId) {
    params.set("userId", userId);
  }

  if (userId) {
    const userResponse = await getUserByID({ serviceConfig, userId });
    if (userResponse) {
      user = userResponse.user;

      if (user?.preferredLoginName) {
        params.set("loginName", user.preferredLoginName);
      }
    }

    const authMethodsResponse = await listAuthenticationMethodTypes({ serviceConfig, userId });
    if (authMethodsResponse.authMethodTypes) {
      authMethods = authMethodsResponse.authMethodTypes;
    }
  }

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="loginError.title" namespace="idp" />
        </h1>
      </div>

      <div className="flex w-full flex-col gap-5">
        <Alert type={AlertType.ALERT}>
          <Translated i18nKey="loginError.description" namespace="idp" />
        </Alert>

        {userId && authMethods.length > 0 && (
          <>
            {user?.preferredLoginName && (
              <EmailChip
                loginName={user.preferredLoginName}
                changeHref={loginNameHref({ loginName: user.preferredLoginName, organization, requestId })}
              />
            )}

            <ChooseAuthenticatorToLogin
              authMethods={authMethods}
              loginSettings={loginSettings}
              params={params}
            ></ChooseAuthenticatorToLogin>
          </>
        )}
      </div>
    </DynamicTheme>
  );
}
