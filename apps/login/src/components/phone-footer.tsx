import { getServiceConfig } from "@/lib/service-url";
import { getLegalAndSupportSettings } from "@/lib/zitadel";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

// A phone's last line, at the foot of the screen: the legal policy's Terms
// and Privacy (Zitadel's legal settings, the links the sign-up's checkbox
// names), each in a new tab so the sign-in it interrupts stays where it was.
// A link the policy leaves empty is not shown. From 640px the card stands
// alone.
export async function PhoneFooter() {
  const { serviceConfig } = getServiceConfig(await headers());
  const legal = await getLegalAndSupportSettings({ serviceConfig });
  const t = await getTranslations("footer");
  const links = [
    { label: t("terms"), href: legal?.tosLink },
    { label: t("privacy"), href: legal?.privacyPolicyLink },
  ].filter((link) => link.href);

  if (!links.length) {
    return null;
  }

  return (
    <footer className="mt-auto flex justify-center gap-6 px-4 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[13px] text-[var(--bp-muted)] sm:hidden">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="tap-target hover:underline"
        >
          {link.label}
        </a>
      ))}
    </footer>
  );
}
