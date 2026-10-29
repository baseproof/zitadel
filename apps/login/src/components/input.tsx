"use client";

import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { clsx } from "clsx";
import { ChangeEvent, DetailedHTMLProps, forwardRef, InputHTMLAttributes, ReactNode, useId } from "react";

export type TextInputProps = DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
  label: string;
  // Beside the label, right-aligned: a link such as "Forgot password?".
  labelAction?: ReactNode;
  suffix?: string;
  placeholder?: string;
  defaultValue?: string;
  error?: string | ReactNode;
  success?: string | ReactNode;
  disabled?: boolean;
  onChange?: (value: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (value: ChangeEvent<HTMLInputElement>) => void;
  roundness?: string; // Allow override via props
};

// Baseproof's field (baseproof/legal-agents#120): 44px, 8px corners, a ring
// in branding's primary color on focus and in its warn color on an error.
const styles = (error: boolean, disabled: boolean, roundnessClasses: string = "rounded-[8px]") =>
  clsx(
    {
      "h-[44px] w-full px-[14px] text-[15px] bg-transparent border grow transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-0": true,
      "text-text-light-500 dark:text-text-dark-500 placeholder:text-[var(--bp-muted)]": true,
      "border-[var(--bp-input-border)] focus:border-primary-light-500 dark:focus:border-primary-dark-500 focus:shadow-[0_0_0_1px_var(--theme-light-primary-500)] dark:focus:shadow-[0_0_0_1px_var(--theme-dark-primary-500)]":
        !error,
      "border-warn-light-500 dark:border-warn-dark-500 shadow-[0_0_0_1px_var(--theme-light-warn-500)] dark:shadow-[0_0_0_1px_var(--theme-dark-warn-500)]":
        error,
      "pointer-events-none opacity-70 cursor-default": disabled,
    },
    roundnessClasses,
  );

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      labelAction,
      placeholder,
      defaultValue,
      suffix,
      required = false,
      error,
      disabled,
      success,
      onChange,
      onBlur,
      roundness,
      ...props
    },
    ref,
  ) => {
    const actualRoundness = roundness || "rounded-[8px]";
    const generatedId = useId();
    const inputId = props.id ?? generatedId;
    const errorId = `${inputId}-error`;

    return (
      <div className="relative flex flex-col gap-[6px] text-[14px]">
        <div className="flex flex-row items-baseline justify-between gap-2">
          <label htmlFor={inputId}>{label}</label>
          {labelAction}
        </div>
        <div className="relative flex flex-row">
          <input
            suppressHydrationWarning
            ref={ref}
            id={inputId}
            className={styles(!!error, !!disabled, actualRoundness)}
            defaultValue={defaultValue}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete={props.autoComplete ?? "off"}
            onChange={(e) => onChange && onChange(e)}
            onBlur={(e) => onBlur && onBlur(e)}
            {...props}
          />

          {suffix && (
            <span
              className={clsx(
                "absolute top-1/2 right-[3px] z-30 -translate-y-1/2 transform bg-[var(--bp-surface)] p-2",
                actualRoundness.split(" ")[0],
              )}
            >
              @{suffix}
            </span>
          )}
        </div>

        {error && (
          <div
            id={errorId}
            className="text-warn-light-500 dark:text-warn-dark-500 flex flex-row items-start gap-[6px] leading-[1.45]"
          >
            <ExclamationCircleIcon className="mt-[1px] h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex flex-row items-center text-green-600">
            <CheckCircleIcon className="h-4 w-4" />
            <span className="ml-1">{success}</span>
          </div>
        )}
      </div>
    );
  },
);
