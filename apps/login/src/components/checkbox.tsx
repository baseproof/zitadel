import classNames from "clsx";
import { DetailedHTMLProps, forwardRef, InputHTMLAttributes, useEffect, useState } from "react";

export type CheckboxProps = DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
  checked: boolean;
  disabled?: boolean;
  onChangeVal?: (checked: boolean) => void;
};

// The tick, drawn inline (baseproof/legal-agents#120): a CSS image is a request
// the login's Content-Security-Policy refuses (img-src 'self', no data:), and
// upstream's url("/checkbox.svg") misses the /ui/v2/login base path. It follows
// its box's input, which carries `peer`.
export function CheckboxTick() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden h-[18px] w-[18px] text-[var(--theme-light-primary-contrast-500)] peer-checked:block dark:text-[var(--theme-dark-primary-contrast-500)]"
    >
      <path
        fill="currentColor"
        d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"
      />
    </svg>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className = "", checked = false, disabled = false, onChangeVal, children, ...props },
  ref,
) {
  const [enabled, setEnabled] = useState<boolean>(checked);

  useEffect(() => {
    setEnabled(checked);
  }, [checked]);

  return (
    <div className="relative flex items-start">
      <div className="flex h-5 items-center">
        <div className="box-sizing relative block h-[18px] w-[18px]">
          <input
            ref={ref}
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target?.checked);
              if (onChangeVal) onChangeVal(event.target?.checked);
            }}
            disabled={disabled}
            type="checkbox"
            className={classNames(
              "peer form-checkbox text-primary-light-500 dark:text-primary-dark-500 focus:ring-primary-light-500 dark:focus:ring-primary-dark-500 h-[18px] w-[18px] rounded-[4px] border border-[var(--bp-input-border)] bg-transparent focus:ring-2 focus:ring-offset-0",
              className,
            )}
            {...props}
          />
          <CheckboxTick />
        </div>
      </div>
      {children}
    </div>
  );
});
