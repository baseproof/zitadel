"use client";

import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";
import { forwardRef, useId, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label: string;
  // Under the boxes while there is no error ("Paste or type the 6-character code.").
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  length?: number;
};

// The code as six boxes (baseproof/legal-agents#120, 03): one transparent
// input over them takes typing and pasting, keeps uppercase letters and
// digits only (Zitadel's codes are uppercase letters and digits), and the
// boxes show it.
export const CodeInput = forwardRef<HTMLInputElement, Props>(function CodeInput(
  { value, onChange, onBlur, label, hint, error, autoFocus, length = 6 },
  ref,
) {
  const id = useId();
  const describedBy = `${id}-describe`;
  const [focused, setFocused] = useState(false);
  const current = Math.min(value.length, length - 1);

  return (
    <div className="flex flex-col gap-[6px] text-[14px]">
      <label htmlFor={id}>{label}</label>
      <div className="relative grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, i) => {
          const ch = value[i] ?? "";
          return (
            <div
              key={i}
              aria-hidden="true"
              className={clsx(
                "flex h-[56px] items-center justify-center rounded-[8px] border font-mono text-[22px] font-medium transition-[border-color,box-shadow] duration-150",
                error && !ch
                  ? "border-warn-light-500 dark:border-warn-dark-500 shadow-[0_0_0_1px_var(--theme-light-warn-500)] dark:shadow-[0_0_0_1px_var(--theme-dark-warn-500)]"
                  : focused && i === current
                    ? "border-primary-light-500 dark:border-primary-dark-500 shadow-[0_0_0_1px_var(--theme-light-primary-500)] dark:shadow-[0_0_0_1px_var(--theme-dark-primary-500)]"
                    : ch
                      ? "border-[var(--bp-subtle)]"
                      : "border-[var(--bp-input-border)]",
              )}
            >
              {ch}
            </div>
          );
        })}
        <input
          ref={ref}
          id={id}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, length),
            )
          }
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={length}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? describedBy : undefined}
          className="absolute inset-0 h-full w-full cursor-text border-0 p-0 text-[16px] opacity-0"
          data-testid="code-text-input"
        />
      </div>
      {error ? (
        <div
          id={describedBy}
          className="text-warn-light-500 dark:text-warn-dark-500 flex flex-row items-start gap-[6px] leading-[1.45]"
        >
          <ExclamationCircleIcon className="mt-[1px] h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        hint && (
          <div id={describedBy} className="text-[var(--bp-muted)]">
            {hint}
          </div>
        )
      )}
    </div>
  );
});
