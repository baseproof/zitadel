import { hashCode, themeCss } from "@/helpers/colors";
import { BrandingSettings } from "@zitadel/proto/zitadel/settings/v2/branding_settings_pb";
import { preload } from "react-dom";
import { useSaveData } from "./save-data";

// What the page reads when the branding's font is not there yet, or not set.
const FALLBACK_FONTS = "ui-sans-serif, system-ui, sans-serif";

/**
 * The branding's font as a URL a stylesheet can carry: an http(s) URL as the
 * URL parser writes it, which percent-encodes a quote and drops line breaks,
 * so it cannot end the url("…") it goes into. Anything else is no font.
 */
export function brandingFontHref(fontUrl?: string): string | undefined {
  if (!fontUrl) {
    return undefined;
  }
  try {
    const url = new URL(fontUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The branding's @font-face and the page's font-family over it.
 *
 * The weight range is the font's: platform/identity uploads Hanken Grotesk's
 * variable font (wght 100–900). Without the range a browser takes the face for
 * 400 and synthesizes every bold from it, as upstream's injected face did.
 *
 * font-display: optional makes the font a bonus, never a wait. A browser uses
 * it only when it is ready by the first paint (it is preloaded, and the cache
 * holds it from the second page on). Otherwise the page keeps the system's
 * sans-serif for that view, with no swap and no shift when the font lands
 * later. On the throttled phone that measured the login on 2026-10-29, the
 * swap came 2.6 s into the load.
 */
export function brandingFontCss(href?: string): string {
  if (!href) {
    return "";
  }
  return (
    `@font-face{font-family:"Branding";src:url("${href}");font-display:optional;font-weight:100 900}` +
    `html{font-family:"Branding",${FALLBACK_FONTS}}`
  );
}

/**
 * Renders the branding into the page's HTML: its colors as the theme's custom
 * properties and its font, preloaded, as the page's font. Upstream applied
 * both from effects after hydration. Until the scripts ran, a phone painted
 * the page unbranded: white, in another font, the primary button without its
 * color, no logo. Seen on id.baseproof.ai on 2026-10-29 (login 1.0.1) at
 * DOMContentLoaded of a 360x800 phone on a throttled network, about 1.4 s
 * before the brand arrived. React hoists the <style> into the head and keeps
 * one per distinct branding (its href). A request that asks to save data
 * (Save-Data: on) gets no web font at all, the system's sans-serif and no
 * download: what the header is for.
 */
export function BrandingStyle({ branding }: { branding?: BrandingSettings }) {
  const saveData = useSaveData();
  const fontHref = saveData ? undefined : brandingFontHref(branding?.fontUrl);
  if (fontHref) {
    preload(fontHref, { as: "font", crossOrigin: "anonymous" });
  }
  const css = themeCss(branding) + brandingFontCss(fontHref);
  return (
    <style href={`branding-${hashCode(css)}`} precedence="branding">
      {css}
    </style>
  );
}
