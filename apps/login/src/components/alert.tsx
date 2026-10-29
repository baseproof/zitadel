import { ExclamationCircleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";
import { ReactNode } from "react";

type Props = {
  children?: ReactNode;
  // A banner's first line, in bold; children are the line under it.
  title?: ReactNode;
  type?: AlertType;
  className?: string;
};

export enum AlertType {
  // A form banner: Zitadel or the network refused the request.
  ALERT,
  // A notice: nothing failed, but the next step changes.
  INFO,
}

// Baseproof's banner and notice (baseproof/legal-agents#120). Both are
// announced to screen readers: a banner as an alert, a notice as a status.
export function Alert({ children, title, type = AlertType.ALERT, className }: Props) {
  const isAlert = type === AlertType.ALERT;
  return (
    <div
      role={isAlert ? "alert" : "status"}
      className={clsx(
        "flex flex-row items-start gap-[10px] rounded-[8px] border px-[14px] py-3 text-[14px] leading-[1.45]",
        isAlert
          ? "border-[var(--bp-error-border)] bg-[var(--bp-error-bg)]"
          : "border-[var(--bp-info-border)] bg-[var(--bp-info-bg)]",
        className,
      )}
    >
      {isAlert ? (
        <ExclamationCircleIcon className="text-warn-light-500 dark:text-warn-dark-500 mt-[1px] h-5 w-5 flex-shrink-0" />
      ) : (
        <InformationCircleIcon className="text-primary-light-500 dark:text-primary-dark-500 mt-[1px] h-5 w-5 flex-shrink-0" />
      )}
      <div className="flex w-full flex-col gap-[2px]">
        {title && <span className="font-semibold">{title}</span>}
        {children && <span className={title ? "text-[var(--bp-subtle)]" : ""}>{children}</span>}
      </div>
    </div>
  );
}
