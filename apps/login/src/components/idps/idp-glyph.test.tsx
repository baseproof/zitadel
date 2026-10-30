import { afterEach, describe, expect, test } from "vitest";

import { cleanup, render } from "@testing-library/react";
import { IdpGlyph } from "./idp-glyph";

afterEach(cleanup);

const fills = (container: HTMLElement) => Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("fill"));

describe("<IdpGlyph />", () => {
  test("marks Slack with its four-colour icon", () => {
    const { container } = render(<IdpGlyph name="Slack" />);
    expect(fills(container)).toEqual(["#E01E5A", "#36C5F0", "#2EB67D", "#ECB22E"]);
  });

  test("marks Clio with its gem, blue on light and white on dark", () => {
    const { container } = render(<IdpGlyph name="Clio" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 180 180");
    expect(svg.getAttribute("class")).toContain("text-[#0075BB]");
    expect(svg.getAttribute("class")).toContain("dark:text-white");
    expect(fills(container)).toEqual(["currentColor", "currentColor"]);
  });

  test("marks LinkedIn with its logo", () => {
    const { container } = render(<IdpGlyph name="LinkedIn" />);
    expect(fills(container)).toEqual(["#0A66C2"]);
  });

  test("matches whole words, so a name that only contains one gets its initial", () => {
    const { container } = render(<IdpGlyph name="Slacker Union" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("S");
  });
});
