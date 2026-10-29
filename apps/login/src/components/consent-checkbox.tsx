"use client";

import { resolveLocalizedLegalLink } from "@/lib/legal-links";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { LegalAndSupportSettings } from "@zitadel/proto/zitadel/settings/v2/legal_settings_pb";
import { useLocale, useTranslations } from "next-intl";
import { forwardRef, InputHTMLAttributes, useId } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  legal: LegalAndSupportSettings;
  error?: string;
};

// One checkbox for the legal links Zitadel's legal settings name (the Terms
// of Service, and the Privacy Policy when set), as Baseproof's sign-up asks
// for (baseproof/legal-agents#120, 02b); upstream draws one per link.
export const ConsentCheckbox = forwardRef<HTMLInputElement, Props>(function ConsentCheckbox(
  { legal, error, ...props },
  ref,
) {
  const t = useTranslations("register");
  const locale = useLocale();
  const id = useId();
  const errorId = `${id}-error`;

  const tosLink = resolveLocalizedLegalLink(legal?.tosLink, locale);
  const privacyPolicyLink = resolveLocalizedLegalLink(legal?.privacyPolicyLink, locale);

  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-light-500 dark:text-primary-dark-500 underline underline-offset-[3px]"
    >
      {label}
    </a>
  );

  return (
    <div className="flex flex-col gap-[6px] text-[14px]">
      <div className="flex flex-row items-center gap-[10px]">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="form-checkbox text-primary-light-500 dark:text-primary-dark-500 focus:ring-primary-light-500 dark:focus:ring-primary-dark-500 h-[18px] w-[18px] flex-shrink-0 rounded-[4px] border border-[var(--bp-input-border)] bg-transparent focus:ring-2 focus:ring-offset-0"
          data-testid="consent-checkbox"
          {...props}
        />
        <label htmlFor={id}>
          {t("consent.agreeTo")} {tosLink && link(tosLink, t("termsOfService"))}
          {tosLink && privacyPolicyLink && ` ${t("consent.and")} `}
          {privacyPolicyLink && link(privacyPolicyLink, t("privacyPolicy"))}
        </label>
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
    </div>
  );
});
