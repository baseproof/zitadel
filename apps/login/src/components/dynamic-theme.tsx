import { BrandingSettings, ThemeMode } from "@zitadel/proto/zitadel/settings/v2/branding_settings_pb";
import { ReactNode } from "react";
import { BrandingStyle } from "./branding-style";
import { DynamicThemeLayout } from "./dynamic-theme-layout";
import { ColorScheme } from "./theme-wrapper";

/**
 * A page's branding and layout. This half runs on the server: it renders the
 * branding's stylesheet (BrandingStyle) and reads the branding's theme mode,
 * then hands the layout (DynamicThemeLayout, the client half) plain values.
 * The browser therefore needs neither the protobuf schema behind ThemeMode
 * nor the color math behind the stylesheet.
 */
export function DynamicTheme({ branding, children }: { branding?: BrandingSettings; children: ReactNode }) {
  return (
    <>
      <BrandingStyle branding={branding} />
      <DynamicThemeLayout
        logo={branding && { light: branding.lightTheme?.logoUrl, dark: branding.darkTheme?.logoUrl }}
        colorScheme={branding && colorSchemeOf(branding.themeMode)}
      >
        {children}
      </DynamicThemeLayout>
    </>
  );
}

// The branding's theme mode as next-themes names it: a forced light or dark,
// else the system's.
function colorSchemeOf(themeMode: ThemeMode): ColorScheme {
  switch (themeMode) {
    case ThemeMode.LIGHT:
      return "light";
    case ThemeMode.DARK:
      return "dark";
    default:
      return "system";
  }
}
