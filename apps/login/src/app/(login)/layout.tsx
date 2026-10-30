import "@/styles/globals.scss";

import { BackgroundWrapper } from "@/components/background-wrapper";
import { LanguageProvider } from "@/components/language-provider";
import { PhoneFooter } from "@/components/phone-footer";
import { Skeleton } from "@/components/skeleton";
import { ThemeProvider } from "@/components/theme-provider";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import React, { Suspense } from "react";

// Baseproof's favicons (cdn.baseproof.ai/web/favicons), served from public/
// under the login's base path.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("title"),
    icons: {
      icon: [
        { url: `${basePath}/favicon.svg`, type: "image/svg+xml" },
        { url: `${basePath}/favicon.ico`, sizes: "any" },
      ],
      apple: `${basePath}/apple-touch-icon.png`,
    },
  };
}

// No language picker. The page speaks the language the app asked for
// (ui_locales), else the browser's when the instance allows it, else the
// instance's default (src/i18n/request.ts). That is how Auth0's, Okta's and
// Microsoft's sign-in pages behave (checked 2026-10-29). The font is the
// branding's (BrandingStyle); until it loads, the system's sans-serif.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head />
      <body>
        <ThemeProvider>
          <Tooltip.Provider>
            <Suspense
              fallback={
                <BackgroundWrapper
                  className={`sm:bg-background-light-600 sm:dark:bg-background-dark-600 relative flex min-h-screen flex-col justify-start bg-[var(--bp-card)] sm:justify-center`}
                >
                  <div className="relative mx-auto w-full max-w-[440px] sm:py-8">
                    <Skeleton>
                      <div className="h-40"></div>
                    </Skeleton>
                  </div>
                </BackgroundWrapper>
              }
            >
              <LanguageProvider>
                {/* On a phone the page is the card's colour edge to edge, its content
                    from the top; from 640px the card sits centred on the page's colour. */}
                <BackgroundWrapper
                  className={`sm:bg-background-light-600 sm:dark:bg-background-dark-600 relative flex min-h-screen flex-col justify-start bg-[var(--bp-card)] sm:justify-center`}
                >
                  {/* The theme follows the system (branding's theme mode), so there is no switch.
                      On a phone the content fills the height down to the footer, so the page can
                      place its block in the space between the wordmark and the footer. */}
                  <div className="relative mx-auto w-full max-w-[1100px] max-sm:flex max-sm:flex-1 max-sm:flex-col sm:py-8">
                    <div className="max-sm:flex max-sm:flex-1 max-sm:flex-col">{children}</div>
                  </div>
                  <PhoneFooter />
                </BackgroundWrapper>
              </LanguageProvider>
            </Suspense>
          </Tooltip.Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
