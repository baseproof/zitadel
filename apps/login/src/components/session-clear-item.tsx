"use client";

import { clearSession } from "@/lib/server/session";
import { timestampDate } from "@zitadel/client";
import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import moment from "moment";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "./alert";
import { Avatar } from "./avatar";
import { isSessionPrimaryFactorAndLifetimeValid } from "./session-item";
import { Translated } from "./translated";

export function SessionClearItem({ session, reload }: { session: Session; reload: () => void }) {
  const currentLocale = useLocale();
  moment.locale(currentLocale === "zh" ? "zh-cn" : currentLocale);
  const t = useTranslations("error");

  const [_loading, setLoading] = useState<boolean>(false);

  /**
   * Returns true when the session was removed (server-side and from the cookie).
   * On failure the error is shown and the card must stay in the list.
   */
  async function clearSessionId(id: string): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const response = await clearSession({ sessionId: id });
      if (response && "error" in response && response.error) {
        setError(response.error);
        return false;
      }
      return true;
    } catch {
      setError(t("couldNotClearSession"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  const { valid, verifiedAt } = isSessionPrimaryFactorAndLifetimeValid(session);

  const [error, setError] = useState<string | null>(null);

  // TODO: To we have to call this?
  useRouter();

  return (
    <>
      <button
        onClick={async () => {
          if (await clearSessionId(session.id)) {
            reload();
          }
        }}
        className="group flex w-full flex-row items-center gap-3 rounded-[8px] border border-[var(--bp-input-border)] px-[14px] py-[10px] text-left transition-colors hover:bg-[var(--bp-surface-hover)]"
      >
        <Avatar
          size="small"
          loginName={session.factors?.user?.loginName as string}
          name={session.factors?.user?.displayName ?? ""}
        />

        <div className="flex min-w-0 flex-col items-start">
          <span className="max-w-full truncate text-[15px] font-medium">{session.factors?.user?.displayName}</span>
          <span className="max-w-full truncate text-[13px] text-[var(--bp-muted)]">{session.factors?.user?.loginName}</span>
          {valid ? (
            <span className="text-[13px] text-[var(--bp-muted)]">
              {verifiedAt && (
                <Translated
                  i18nKey="verifiedAt"
                  namespace="logout"
                  data={{ time: moment(timestampDate(verifiedAt)).fromNow() }}
                />
              )}
            </span>
          ) : (
            verifiedAt && (
              <span className="text-[13px] text-[var(--bp-muted)]">
                <Translated i18nKey="expired" namespace="accounts" />{" "}
                {session.expirationDate && moment(timestampDate(session.expirationDate)).fromNow()}
              </span>
            )
          )}
        </div>

        <span className="flex-grow"></span>
        <span className="text-warn-light-500 dark:text-warn-dark-500 text-[14px] font-medium">
          <Translated i18nKey="clear" namespace="logout" />
        </span>
      </button>
      {error && <Alert>{error}</Alert>}
    </>
  );
}
