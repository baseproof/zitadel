import { Translated } from "@/components/translated";
import { lowerCaseValidator, numberValidator, symbolValidator, upperCaseValidator } from "@/helpers/validators";
import { PasswordComplexitySettings } from "@zitadel/proto/zitadel/settings/v2/password_settings_pb";
import { useTranslations } from "next-intl";

type Props = {
  passwordComplexitySettings: PasswordComplexitySettings;
  password: string;
  equals: boolean;
  // After a submit: rules still unmet read in the warn color (02d·A).
  showErrors?: boolean;
};

function CheckIcon({ title }: { title: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="text-primary-light-500 dark:text-primary-dark-500 h-4 w-4 flex-none"
      role="img"
    >
      <title>{title}</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function CrossIcon({ title }: { title: string }) {
  return (
    <svg
      className="h-4 w-4 flex-none"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      role="img"
    >
      <title>{title}</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// Baseproof's checklist (baseproof/legal-agents#120, 02d): one rule per line,
// in the design's order, driven by Zitadel's password complexity settings.
export function PasswordComplexity({ passwordComplexitySettings, password, equals, showErrors = false }: Props) {
  const t = useTranslations("password");
  const hasMinLength = password?.length >= passwordComplexitySettings.minLength;
  const hasSymbol = symbolValidator(password);
  const hasNumber = numberValidator(password);
  const hasUppercase = upperCaseValidator(password);
  const hasLowercase = lowerCaseValidator(password);

  const rules: { key: string; testId: string; met: boolean; shown: boolean; data?: Record<string, string> }[] = [
    {
      key: "complexity.length",
      testId: "length-check",
      met: hasMinLength,
      shown: passwordComplexitySettings.minLength != undefined,
      data: { minLength: passwordComplexitySettings.minLength.toString() },
    },
    {
      key: "complexity.hasNumber",
      testId: "number-check",
      met: hasNumber,
      shown: passwordComplexitySettings.requiresNumber,
    },
    {
      key: "complexity.hasUppercase",
      testId: "uppercase-check",
      met: hasUppercase,
      shown: passwordComplexitySettings.requiresUppercase,
    },
    {
      key: "complexity.hasLowercase",
      testId: "lowercase-check",
      met: hasLowercase,
      shown: passwordComplexitySettings.requiresLowercase,
    },
    {
      key: "complexity.hasSymbol",
      testId: "symbol-check",
      met: hasSymbol,
      shown: passwordComplexitySettings.requiresSymbol,
    },
    { key: "complexity.equals", testId: "equal-check", met: equals, shown: true },
  ];

  return (
    <ul className="flex flex-col gap-2 text-[14px]">
      {rules
        .filter((rule) => rule.shown)
        .map((rule) => (
          <li
            key={rule.key}
            className={`flex flex-row items-center gap-2 ${
              rule.met
                ? "text-[var(--bp-subtle)]"
                : showErrors
                  ? "text-warn-light-500 dark:text-warn-dark-500"
                  : "text-[var(--bp-muted)]"
            }`}
            data-testid={rule.testId}
          >
            {rule.met ? <CheckIcon title={t("complexity.matches")} /> : <CrossIcon title={t("complexity.doesNotMatch")} />}
            <Translated i18nKey={rule.key} namespace="password" data={rule.data} />
          </li>
        ))}
    </ul>
  );
}
