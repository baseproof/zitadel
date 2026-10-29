import { Alert } from "@/components/alert";
import { DynamicTheme } from "@/components/dynamic-theme";
import { Translated } from "@/components/translated";
import { getServiceConfig } from "@/lib/service-url";
import { getBrandingSettings } from "@/lib/zitadel";
import { headers } from "next/headers";

/**
 * Linking failed page - shown when IDP linking fails
 */
export default async function LinkingFailedPage(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
  params: Promise<{ provider: string }>;
}) {
  const searchParams = await props.searchParams;
  const { organization, error } = searchParams;

  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const branding = await getBrandingSettings({ serviceConfig, organization });

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="linkingError.title" namespace="idp" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="linkingError.description" namespace="idp" />
        </p>
      </div>

      <div className="flex w-full flex-col gap-5">{error && <Alert>{error}</Alert>}</div>
    </DynamicTheme>
  );
}
