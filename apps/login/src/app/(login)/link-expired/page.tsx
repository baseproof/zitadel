import { ButtonColors, ButtonSizes, ButtonVariants, getButtonClasses } from "@/components/button";
import { DynamicTheme } from "@/components/dynamic-theme";
import { Translated } from "@/components/translated";
import { isSafeRedirectUri } from "@/lib/client-utils";
import { createLogger } from "@/lib/logger";
import { getServiceConfig } from "@/lib/service-url";
import { getBrandingSettings, getLoginSettings } from "@/lib/zitadel";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

const logger = createLogger("link-expired");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("linkExpired");
  return { title: t("title") };
}

// 01·F (baseproof/legal-agents#120): the sign-in link names a request Zitadel
// no longer holds. Zitadel deletes an auth or SAML request once it succeeds or
// fails, so this is a link opened again after its sign-in finished, or one this
// instance never issued. The request named the app; without it, the way back
// is the instance's default redirect URI.
export default async function Page() {
  const _headers = await headers();
  const { serviceConfig } = getServiceConfig(_headers);

  const branding = await getBrandingSettings({ serviceConfig });
  const loginSettings = await getLoginSettings({ serviceConfig });

  const appUrl = loginSettings?.defaultRedirectUri;
  const back = appUrl && isSafeRedirectUri(appUrl) ? appUrl : undefined;
  if (!back) {
    logger.warn("the login settings name no safe defaultRedirectUri; 01·F shows no way back to the app", { appUrl });
  }

  return (
    <DynamicTheme branding={branding}>
      <div className="flex flex-col space-y-4">
        <h1>
          <Translated i18nKey="title" namespace="linkExpired" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="description" namespace="linkExpired" />
        </p>
      </div>

      <div className="w-full">
        {back && (
          <a
            href={back}
            className={`${getButtonClasses(ButtonSizes.Small, ButtonVariants.Primary, ButtonColors.Primary)} w-full`}
            data-testid="back-to-app"
          >
            <Translated i18nKey="back" namespace="linkExpired" />
          </a>
        )}
      </div>
    </DynamicTheme>
  );
}
