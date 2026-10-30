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
  // How the provider shows (every provider component puts its logo in a
  // 48px box and its name in a span):
  // - "row": upstream's list, a full-width button with the logo and the name;
  // - "tile": the logo only, in a row of providers, the name kept for screen
  //   readers (and in the button's title);
  // - "sheet": a line of a phone's provider sheet, the logo and the name on a
  //   hairline;
  // - "mark": the logo alone, not a button, for "Other ways to sign in".
  look?: "row" | "tile" | "sheet" | "mark";
};

const BUTTON =
  "text-text-light-500 dark:text-text-dark-500 focus-visible:ring-primary-light-500 dark:focus-visible:ring-primary-dark-500 flex cursor-pointer flex-row items-center transition-colors outline-none focus-visible:ring-2";

// The tile shrinks the logo's box to 24px and keeps the name for screen readers.
const ICON_TILE =
  "h-[44px] w-full justify-center rounded-[8px] bg-[var(--bp-surface)] hover:bg-[var(--bp-surface-hover)] [&_span]:sr-only [&_.h-12]:h-6 [&_.w-12]:w-6 [&_.h-12]:p-0";

// The row: the same surface as the tile, the logo at 20px, then the name.
const LIST_ROW =
  "h-[44px] w-full rounded-[8px] bg-[var(--bp-surface)] px-[14px] text-[15px] font-medium hover:bg-[var(--bp-surface-hover)] [&_.h-12]:h-5 [&_.w-12]:w-5 [&_.h-12]:p-0 [&_.ml-4]:ml-0";

// The sheet's line: no surface, a hairline under it, every logo at 20px
// (typed providers' boxes and generic marks alike), then the name.
const SHEET_ROW =
  "h-[52px] w-full rounded-none border-b border-[var(--bp-divider)] bg-transparent px-1 text-[15px] font-medium hover:bg-[var(--bp-surface)] [&_.h-12]:h-5 [&_.w-12]:w-5 [&_.h-12]:p-0 [&_.h-6]:h-5 [&_.w-6]:w-5 [&_svg]:h-5 [&_svg]:w-5 [&_.ml-4]:ml-0";

// The mark: every box and logo at 14px, no name.
const MARK =
  "flex h-3.5 w-3.5 items-center justify-center [&_span]:hidden [&_.h-12]:h-3.5 [&_.w-12]:w-3.5 [&_.h-12]:p-0 [&_.h-6]:h-3.5 [&_.w-6]:w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5";

export const BaseButton = forwardRef<HTMLButtonElement, SignInWithIdentityProviderProps>(function BaseButton(props, ref) {
  const { look = "row", ...buttonProps } = props;
  const formStatus = useFormStatus();

  if (look === "mark") {
    return (
      <span aria-hidden="true" className={MARK}>
        {buttonProps.children}
      </span>
    );
  }

  if (look === "tile") {
    return (
      <button {...buttonProps} type="submit" ref={ref} disabled={formStatus.pending} className={clsx(BUTTON, ICON_TILE)}>
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
      className={clsx(BUTTON, look === "sheet" ? SHEET_ROW : LIST_ROW)}
    >
      <div className="flex flex-1 items-center justify-between gap-4">
        <div className="flex flex-1 flex-row items-center gap-3">{props.children}</div>
        {formStatus.pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
      </div>
    </button>
  );
});
