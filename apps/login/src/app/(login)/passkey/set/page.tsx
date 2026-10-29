import { Alert } from "@/components/alert";
import { DynamicTheme } from "@/components/dynamic-theme";
import { RegisterPasskey } from "@/components/register-passkey";
import { Translated } from "@/components/translated";
import { getServiceConfig } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getBrandingSettings, getUserByID } from "@/lib/zitadel";
import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import { User } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("passkey");
  return { title: t("set.title") };
}

export default async function Page(props: { searchParams: Promise<Record<string | number | symbol, string | undefined>> }) {
  const searchParams = await props.searchParams;

  const { userId, loginName, prompt, organization, requestId, code, codeId } = searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  // also allow no session to be found for userId-based flows
  let session: Session | undefined;
  if (loginName) {
    session = await loadMostRecentSession({
      serviceConfig,
      sessionParams: {
        loginName,
        organization,
      },
    });
  }

  const branding = await getBrandingSettings({ serviceConfig, organization });

  let user: User | undefined;
  if (userId) {
    const userResponse = await getUserByID({ serviceConfig, userId });
    user = userResponse.user;
  }

  // 02c's "Use password instead": a first password for the account this
  // sign-up just made (/password/set without a code, the "initial" flow).
  const resolvedLoginName = loginName ?? session?.factors?.user?.loginName ?? user?.preferredLoginName;
  const usePasswordParams = new URLSearchParams({ initial: "true" });
  if (resolvedLoginName) {
    usePasswordParams.set("loginName", resolvedLoginName);
  }
  if (organization) {
    usePasswordParams.set("organization", organization);
  }
  if (requestId) {
    usePasswordParams.set("requestId", requestId);
  }

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col">
        <h1>
          <Translated i18nKey="set.title" namespace="passkey" />
        </h1>
      </div>

      <div className="w-full">
        {!session && !user && (
          <div className="py-4">
            <Alert>
              {/* context was provided but the session could not be resolved (cookie missing, invalid or expired) */}
              <Translated i18nKey={loginName || userId ? "sessionExpired" : "unknownContext"} namespace="error" />
            </Alert>
          </div>
        )}

        {(session?.id || userId) && (
          <RegisterPasskey
            sessionId={session?.id}
            userId={userId}
            isPrompt={!!prompt}
            organization={organization}
            requestId={requestId}
            code={code}
            codeId={codeId}
            loginName={resolvedLoginName}
            usePasswordHref={!prompt ? "/password/set?" + usePasswordParams : undefined}
          />
        )}
      </div>
    </DynamicTheme>
  );
}
