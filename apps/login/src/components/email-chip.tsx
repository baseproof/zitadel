import Link from "next/link";
import { ReactNode } from "react";
import { Translated } from "./translated";

// 01 again, with the email filled in for "Change", or empty for "Use a
// different email".
export function loginNameHref({
  loginName,
  organization,
  requestId,
}: {
  loginName?: string;
  organization?: string;
  requestId?: string;
}): string {
  const params = new URLSearchParams();
  if (loginName) {
    params.append("loginName", loginName);
  }
  if (organization) {
    params.append("organization", organization);
  }
  if (requestId) {
    params.append("requestId", requestId);
  }
  return "/loginname?" + params;
}

export const CHANGE_LINK_CLASSES =
  "tap-target text-primary-light-500 dark:text-primary-dark-500 text-[14px] font-medium hover:underline";

// A value the page carries, read-only, with an action beside it: 02a's email
// row (baseproof/legal-agents#120), and the reset's code once it's entered.
export function ValueChip({ label, value, action }: { label: ReactNode; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px] text-[14px]">
      <span>{label}</span>
      <div className="flex h-[44px] flex-row items-center justify-between gap-2 rounded-[8px] bg-[var(--bp-surface)] px-[14px] text-[15px]">
        <span className="truncate">{value}</span>
        {action}
      </div>
    </div>
  );
}

type Props = {
  loginName: string;
  // where "Change" goes; a page whose account is settled leaves it out
  changeHref?: string;
};

// On every page that acts for one account: the email, and "Change" back to 01.
export function EmailChip({ loginName, changeHref }: Props) {
  return (
    <ValueChip
      label={<Translated i18nKey="email" namespace="common" />}
      value={<span data-testid="login-name">{loginName}</span>}
      action={
        changeHref && (
          <Link href={changeHref} className={CHANGE_LINK_CLASSES} data-testid="change-button">
            <Translated i18nKey="change" namespace="common" />
          </Link>
        )
      }
    />
  );
}
