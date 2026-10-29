import { ThemeableProps } from "@/lib/themeUtils";
import { clsx } from "clsx";
import { ButtonHTMLAttributes, DetailedHTMLProps, forwardRef } from "react";

export enum ButtonSizes {
  Small = "Small",
  Large = "Large",
}

export enum ButtonVariants {
  Primary = "Primary",
  Secondary = "Secondary",
  Destructive = "Destructive",
}

export enum ButtonColors {
  Neutral = "Neutral",
  Primary = "Primary",
  Warn = "Warn",
}

export type ButtonProps = DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
  size?: ButtonSizes;
  variant?: ButtonVariants;
  color?: ButtonColors;
} & ThemeableProps;

// Baseproof's buttons (baseproof/legal-agents#120): 44px, 8px corners; the
// primary is branding's primary color, the secondary a neutral surface.
export const getButtonClasses = (
  size: ButtonSizes,
  variant: ButtonVariants,
  color: ButtonColors,
  roundnessClasses: string = "rounded-[8px]",
  appearance: string = "",
) =>
  clsx(
    {
      "box-border h-[44px] text-[15px] inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-light-500 dark:focus-visible:ring-primary-dark-500 transition-colors duration-200": true,
      "font-semibold disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed disabled:dark:bg-gray-700 disabled:dark:text-gray-900":
        variant === ButtonVariants.Primary,
      "bg-primary-light-500 dark:bg-primary-dark-500 hover:bg-primary-light-600 hover:dark:bg-primary-dark-400 text-primary-light-contrast-500 dark:text-primary-dark-contrast-500":
        variant === ButtonVariants.Primary && color !== ButtonColors.Warn,
      "bg-warn-light-500 dark:bg-warn-dark-500 hover:bg-warn-light-600 hover:dark:bg-warn-dark-400 text-white dark:text-white":
        variant === ButtonVariants.Primary && color === ButtonColors.Warn,
      "font-medium bg-[var(--bp-surface)] hover:bg-[var(--bp-surface-hover)] text-text-light-500 dark:text-text-dark-500 disabled:opacity-60 disabled:cursor-not-allowed":
        variant === ButtonVariants.Secondary && color !== ButtonColors.Warn,
      "font-medium bg-[var(--bp-surface)] hover:bg-[var(--bp-surface-hover)] text-warn-light-500 dark:text-warn-dark-500":
        color === ButtonColors.Warn && variant !== ButtonVariants.Primary,
      "px-6": size === ButtonSizes.Large,
      "px-4": size === ButtonSizes.Small,
    },
    roundnessClasses,
    appearance,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = ButtonVariants.Primary,
      size = ButtonSizes.Small,
      color = ButtonColors.Primary,
      roundness, // Will use theme default if not provided
      ...props
    },
    ref,
  ) => {
    return (
      <button
        type="button"
        ref={ref}
        className={`${getButtonClasses(size, variant, color, roundness)} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
