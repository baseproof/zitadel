"use client";

import { APPEARANCE_STYLES, getComponentRoundness, getThemeConfig } from "@/lib/theme";
import { clsx } from "clsx";
import { Loader2Icon } from "lucide-react";
import { ButtonHTMLAttributes, DetailedHTMLProps, forwardRef } from "react";
import { useFormStatus } from "react-dom";

export type SignInWithIdentityProviderProps = DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> & {
  name?: string;
  e2e?: string;
  // A tile in a row of providers: the logo only, the name kept for screen
  // readers (and in the button's title).
  iconOnly?: boolean;
};

// The tile: every provider component puts its logo in a 48px box and its
// name in a span; the tile shrinks the box and keeps the span for screen readers.
const ICON_TILE =
  "h-[44px] w-full justify-center rounded-[8px] bg-[var(--bp-surface)] hover:bg-[var(--bp-surface-hover)] [&_span]:sr-only [&_.h-12]:h-6 [&_.w-12]:w-6 [&_.h-12]:p-0";

// Helper function to get default IDP button appearance from centralized theme system
function getDefaultIdpButtonAppearance(): string {
  const themeConfig = getThemeConfig();
  const appearance = APPEARANCE_STYLES[themeConfig.appearance];
  return appearance?.["idp-button"] || "border border-divider-light dark:border-divider-dark"; // Fallback to basic border
}

export const BaseButton = forwardRef<HTMLButtonElement, SignInWithIdentityProviderProps>(function BaseButton(props, ref) {
  const { iconOnly, ...buttonProps } = props;
  const formStatus = useFormStatus();
  const buttonRoundness = getComponentRoundness("button");
  const idpButtonAppearance = getDefaultIdpButtonAppearance();

  if (iconOnly) {
    return (
      <button
        {...buttonProps}
        type="submit"
        ref={ref}
        disabled={formStatus.pending}
        className={clsx(
          "text-text-light-500 dark:text-text-dark-500 focus-visible:ring-primary-light-500 dark:focus-visible:ring-primary-dark-500 flex cursor-pointer flex-row items-center transition-colors outline-none focus-visible:ring-2",
          ICON_TILE,
        )}
      >
        {formStatus.pending ? <Loader2Icon className="h-5 w-5 animate-spin" /> : buttonProps.children}
      </button>
    );
  }

  return (
    <button
      {...buttonProps}
      type="submit"
      ref={ref}
      disabled={formStatus.pending}
      className={clsx(
        `text-text-light-500 focus:border-primary-light-500 dark:text-text-dark-500 focus:dark:border-primary-dark-500 flex flex-1 cursor-pointer flex-row items-center px-4 text-sm transition-all outline-none hover:border-black hover:dark:border-white`,
        buttonRoundness,
        idpButtonAppearance,
        `bg-background-light-400 dark:bg-background-dark-500`, // Keep background as fallback for non-glass themes
        props.className,
      )}
    >
      <div className="flex flex-1 items-center justify-between gap-4">
        <div className="flex flex-1 flex-row items-center">{props.children}</div>
        {formStatus.pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
      </div>
    </button>
  );
});
