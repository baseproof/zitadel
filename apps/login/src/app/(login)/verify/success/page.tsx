import { DynamicTheme } from "@/components/dynamic-theme";
import { EmailChip } from "@/components/email-chip";
import { Translated } from "@/components/translated";
import { VerifySuccessContinue } from "@/components/verify-success-continue";
import { getServiceConfig } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getBrandingSettings, getUserByID } from "@/lib/zitadel";
import { User } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { headers } from "next/headers";

export default async function Page(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const { loginName, organization, userId, requestId } = searchParams;

  const branding = await getBrandingSettings({ serviceConfig, organization });

  const sessionFactors = await loadMostRecentSession({ serviceConfig, sessionParams: { loginName, organization } });

  const id = userId ?? sessionFactors?.factors?.user?.id;

  if (!id) {
    throw Error("Failed to get user id");
  }

  const userResponse = await getUserByID({ serviceConfig, userId: id });

  const user: User | undefined = userResponse?.user;

  // Build continue URL to re-enter the login flow with requestId preserved
  let continueUrl: string | undefined;
  if (requestId) {
    const params = new URLSearchParams();
    if (loginName || user?.preferredLoginName) {
      params.set("loginName", loginName ?? user?.preferredLoginName ?? "");
    }
    if (organization) {
      params.set("organization", organization);
    }
    params.set("requestId", requestId);
    continueUrl = `/loginname?${params}`;
  }

  const email = loginName ?? sessionFactors?.factors?.user?.loginName ?? user?.preferredLoginName;

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="successTitle" namespace="verify" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="successDescription" namespace="verify" />
        </p>
      </div>
      <div className="flex w-full flex-col gap-5">
        {email && <EmailChip loginName={email} />}
        {continueUrl && <VerifySuccessContinue continueUrl={continueUrl} />}
      </div>
    </DynamicTheme>
  );
}
