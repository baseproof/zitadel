import { cleanup, render } from "@testing-library/react";
import { BrandingSettings, ThemeMode } from "@zitadel/proto/zitadel/settings/v2/branding_settings_pb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { brandingFontCss, brandingFontHref, BrandingStyle } from "./branding-style";
import { Logo } from "./logo";

const preload = vi.hoisted(() => vi.fn());
vi.mock("react-dom", async (actual) => ({ ...(await actual<typeof import("react-dom")>()), preload }));

const FONT = "https://id.baseproof.ai/assets/v1/395030085486247961/policy/label/font-397194708553564316";

describe("branding font", () => {
  test.each([
    { name: "an https URL", url: FONT, href: FONT },
    {
      name: "an http URL",
      url: "http://localhost:8080/assets/v1/1/policy/label/font-2",
      href: "http://localhost:8080/assets/v1/1/policy/label/font-2",
    },
    { name: "a quote, percent-encoded", url: 'https://x.test/a"b', href: "https://x.test/a%22b" },
    { name: "no URL", url: undefined, href: undefined },
    { name: "a javascript: URL", url: "javascript:alert(1)", href: undefined },
    { name: "a malformed URL", url: "not a url", href: undefined },
  ])("$name", ({ url, href }) => {
    expect(brandingFontHref(url)).toBe(href);
  });

  test("the face carries the variable font's weight range and becomes the page's font", () => {
    const css = brandingFontCss(FONT);
    expect(css).toContain(`@font-face{font-family:"Branding";src:url("${FONT}");font-display:swap;font-weight:100 900}`);
    expect(css).toContain('html{font-family:"Branding",ui-sans-serif, system-ui, sans-serif}');
  });

  test("no font, no rule", () => {
    expect(brandingFontCss(undefined)).toBe("");
  });
});

// React keeps a hoisted stylesheet in the head once rendered, so each test
// finds its own by the color it set.
function brandingStyleWith(text: string) {
  return [...document.head.querySelectorAll('style[data-precedence="branding"]')].find((s) => s.textContent?.includes(text));
}

describe("BrandingStyle", () => {
  afterEach(() => {
    cleanup();
    preload.mockClear();
  });

  test("puts the colors and the font into one hoisted stylesheet and preloads the font", () => {
    const branding = { lightTheme: { primaryColor: "#1b3f97" }, fontUrl: FONT } as BrandingSettings;
    render(<BrandingStyle branding={branding} />);
    const style = brandingStyleWith("--theme-light-primary-500:#1b3f97");
    expect(style).toBeDefined();
    expect(style?.textContent).toContain(`src:url("${FONT}")`);
    expect(preload).toHaveBeenCalledWith(FONT, { as: "font", crossOrigin: "anonymous" });
  });

  test("without a font it still renders the colors, and preloads nothing", () => {
    render(<BrandingStyle branding={{ lightTheme: { primaryColor: "#9e2b25" } } as BrandingSettings} />);
    const style = brandingStyleWith("--theme-light-primary-500:#9e2b25");
    expect(style).toBeDefined();
    expect(style?.textContent).not.toContain("@font-face");
    expect(preload).not.toHaveBeenCalled();
  });
});

describe("Logo", () => {
  afterEach(cleanup);

  test("one image; the dark variant comes through the system's color scheme", () => {
    const { container } = render(<Logo lightSrc="/light.png" darkSrc="/dark.png" themeMode={ThemeMode.AUTO} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/light.png");
    expect(container.querySelector("img")?.getAttribute("fetchpriority")).toBe("high");
    const source = container.querySelector("source");
    expect(source?.getAttribute("srcset")).toBe("/dark.png");
    expect(source?.getAttribute("media")).toBe("(prefers-color-scheme: dark)");
  });

  test.each([
    { mode: ThemeMode.LIGHT, src: "/light.png" },
    { mode: ThemeMode.DARK, src: "/dark.png" },
  ])("a forced theme ($mode) shows its own variant alone", ({ mode, src }) => {
    const { container } = render(<Logo lightSrc="/light.png" darkSrc="/dark.png" themeMode={mode} />);
    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(src);
  });

  test("a single variant is used whatever the theme", () => {
    const { container } = render(<Logo darkSrc="/dark.png" />);
    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/dark.png");
  });

  test("no logo, nothing", () => {
    const { container } = render(<Logo />);
    expect(container.innerHTML).toBe("");
  });
});
