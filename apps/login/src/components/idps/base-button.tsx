"use client";

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

// The row, in a list of providers: the same surface as the tile, the logo
// at 20px, then the name.
const LIST_ROW =
  "h-[44px] w-full rounded-[8px] bg-[var(--bp-surface)] px-[14px] text-[15px] font-medium hover:bg-[var(--bp-surface-hover)] [&_.h-12]:h-5 [&_.w-12]:w-5 [&_.h-12]:p-0 [&_.ml-4]:ml-0";

export const BaseButton = forwardRef<HTMLButtonElement, SignInWithIdentityProviderProps>(function BaseButton(props, ref) {
  const { iconOnly, ...buttonProps } = props;
  const formStatus = useFormStatus();

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
        "text-text-light-500 dark:text-text-dark-500 focus-visible:ring-primary-light-500 dark:focus-visible:ring-primary-dark-500 flex cursor-pointer flex-row items-center transition-colors outline-none focus-visible:ring-2",
        LIST_ROW,
      )}
    >
      <div className="flex flex-1 items-center justify-between gap-4">
        <div className="flex flex-1 flex-row items-center gap-3">{props.children}</div>
        {formStatus.pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
      </div>
    </button>
  );
});
