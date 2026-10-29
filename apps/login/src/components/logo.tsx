type Props = {
  darkSrc?: string;
  lightSrc?: string;
  // a theme the branding forces; undefined when the theme follows the system
  forcedTheme?: "light" | "dark";
  height?: number;
  width?: number;
};

/**
 * The branding's logo as one image. When the theme follows the system and both
 * variants exist, the dark one comes through a media query, so a browser
 * downloads only the variant it shows. Upstream rendered both and hid one with
 * CSS, and both downloaded: 66 KiB on id.baseproof.ai, 2026-10-29. The logo is
 * a phone's largest paint, so it is fetched at high priority.
 */
export function Logo({ lightSrc, darkSrc, forcedTheme, height = 40, width = 147.5 }: Props) {
  const src = forcedTheme === "dark" ? darkSrc || lightSrc : lightSrc || darkSrc;
  if (!src) {
    return null;
  }
  const followsSystem = !forcedTheme && !!lightSrc && !!darkSrc;
  return (
    <picture>
      {followsSystem && <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />}
      <img height={height} width={width} src={src} alt="logo" fetchPriority="high" />
    </picture>
  );
}
