import { TurnstileProvider } from "@/components/turnstile-provider";
import { render as renderComponent, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

// Existing form tests exercise their form behavior with CAPTCHA explicitly off.
export function render(ui: ReactElement, options?: RenderOptions) {
  const wrap = (element: ReactElement) => <TurnstileProvider config={{ enabled: false }}>{element}</TurnstileProvider>;
  const result = renderComponent(wrap(ui), options);
  return { ...result, rerender: (element: ReactElement) => result.rerender(wrap(element)) };
}
