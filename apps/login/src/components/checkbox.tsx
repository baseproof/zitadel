import classNames from "clsx";
import { DetailedHTMLProps, forwardRef, InputHTMLAttributes, useEffect, useState } from "react";

export type CheckboxProps = DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
  checked: boolean;
  disabled?: boolean;
  onChangeVal?: (checked: boolean) => void;
};

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
        <div className="box-sizing block">
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
              "form-checkbox text-primary-light-500 dark:text-primary-dark-500 focus:ring-primary-light-500 dark:focus:ring-primary-dark-500 h-[18px] w-[18px] rounded-[4px] border border-[var(--bp-input-border)] bg-transparent focus:ring-2 focus:ring-offset-0",
              className,
            )}
            {...props}
          />
        </div>
      </div>
      {children}
    </div>
  );
});
