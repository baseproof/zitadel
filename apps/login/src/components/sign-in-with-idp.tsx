"use client";

import { idpTypeToSlug } from "@/lib/idp";
import { redirectToIdp } from "@/lib/server/idp";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { IdentityProvider, IdentityProviderType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { ReactNode, useActionState, useId, useRef } from "react";
import { Alert } from "./alert";
import { AutoSubmitForm } from "./auto-submit-form";
import { Divider } from "./divider";
import { SignInWithIdentityProviderProps } from "./idps/base-button";
import { IdpGlyph } from "./idps/idp-glyph";
import { SignInWithApple } from "./idps/sign-in-with-apple";
import { SignInWithAzureAd } from "./idps/sign-in-with-azure-ad";
import { SignInWithGeneric } from "./idps/sign-in-with-generic";
import { SignInWithGithub } from "./idps/sign-in-with-github";
import { SignInWithGitlab } from "./idps/sign-in-with-gitlab";
import { SignInWithGoogle } from "./idps/sign-in-with-google";
import { SignInWithZitadel } from "./idps/sign-in-with-zitadel";
import { Translated } from "./translated";

// The icon row, from 640px: five tiles to a line, and the tiles of the last
// line share its whole width (six are five and one full-width tile, seven
// five and two halves). A tile starts a pixel under a fifth of the row, so
// five always fit one line, and grows into its line's free width.
const ICON_ROW = "flex flex-wrap gap-2";
const ICON_ROW_TILE = "flex grow basis-[calc((100%_-_2rem)/5_-_1px)]";

// On a phone the providers sit behind one outlined button, its first three
// marks overlapping, that opens a sheet from the bottom of the screen with a
// line per provider.
const OTHER_WAYS =
  "text-text-light-500 dark:text-text-dark-500 focus-visible:ring-primary-light-500 dark:focus-visible:ring-primary-dark-500 inline-flex h-[44px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-[8px] border border-[var(--bp-card-border)] bg-transparent text-[15px] font-medium transition-colors outline-none hover:bg-[var(--bp-surface)] focus-visible:ring-2";
const OTHER_WAYS_MARK =
  "-ml-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--bp-card-border)] bg-[var(--bp-card)] first:ml-0";
const SHEET =
  "bp-sheet text-text-light-500 dark:text-text-dark-500 m-0 mt-auto max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-[16px] border-0 bg-[var(--bp-card)] p-0 backdrop:bg-black/40";

const COMPONENTS: Partial<Record<IdentityProviderType, (props: SignInWithIdentityProviderProps) => ReactNode>> = {
  [IdentityProviderType.APPLE]: SignInWithApple,
  [IdentityProviderType.OAUTH]: SignInWithGeneric,
  [IdentityProviderType.OIDC]: SignInWithGeneric,
  [IdentityProviderType.GITHUB]: SignInWithGithub,
  [IdentityProviderType.GITHUB_ES]: SignInWithGithub,
  [IdentityProviderType.AZURE_AD]: SignInWithAzureAd,
  [IdentityProviderType.GOOGLE]: (props) => <SignInWithGoogle {...props} e2e="google" />,
  [IdentityProviderType.GITLAB]: SignInWithGitlab,
  [IdentityProviderType.GITLAB_SELF_HOSTED]: SignInWithGitlab,
  [IdentityProviderType.SAML]: SignInWithGeneric,
  [IdentityProviderType.LDAP]: SignInWithGeneric,
  [IdentityProviderType.JWT]: SignInWithGeneric,
  [IdentityProviderType.ZITADEL]: SignInWithZitadel,
};

// Generic providers (OAuth, OIDC, SAML, LDAP, JWT) carry no logo: they show a mark by name.
function genericChildren(Component: (props: SignInWithIdentityProviderProps) => ReactNode, name: string) {
  return Component === SignInWithGeneric ? (
    <>
      <IdpGlyph name={name} />
      <span>{name}</span>
    </>
  ) : undefined;
}

export interface SignInWithIDPProps {
  children?: ReactNode;
  identityProviders: IdentityProvider[];
  requestId?: string;
  organization?: string;
  sessionId?: string;
  postErrorRedirectUrl?: string;
  /** Forwarded to the IdP as login_hint so the user does not have to type the identifier again. */
  loginHint?: string;
  showLabel?: boolean;
  // "icons": Baseproof's providers, a row of logo tiles from 640px and, on a
  // phone, "Other ways to sign in" and its sheet; "list": upstream's
  // full-width buttons.
  layout?: "list" | "icons";
  // Whether the tiles read "Sign in with …" or "Sign up with …".
  context?: "signIn" | "signUp";
}

export function SignInWithIdp({
  identityProviders,
  requestId,
  organization,
  sessionId,
  postErrorRedirectUrl,
  loginHint,
  showLabel = true,
  layout = "list",
  context = "signIn",
}: Readonly<SignInWithIDPProps>) {
  const [state, action, _isPending] = useActionState(redirectToIdp, {});
  const t = useTranslations("idp");

  const renderIDPButton = (idp: IdentityProvider, index: number, look: "row" | "tile" | "sheet") => {
    const { id, name, type } = idp;
    const Component = COMPONENTS[type];
    if (!Component) {
      return null;
    }
    const label = t(context === "signUp" ? "signUpWithName" : "signInWithName", { name });
    return (
      <form action={action} className={look === "tile" ? ICON_ROW_TILE : "flex"} key={`idp-${look}-${index}`}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="provider" value={idpTypeToSlug(type)} />
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="organization" value={organization} />
        {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
        {postErrorRedirectUrl && <input type="hidden" name="postErrorRedirectUrl" value={postErrorRedirectUrl} />}
        {loginHint && <input type="hidden" name="loginHint" value={loginHint} />}
        {look === "row" ? (
          <Component key={id} name={name}>
            {genericChildren(Component, name)}
          </Component>
        ) : (
          <Component key={id} name={name} look={look} title={label} aria-label={label}>
            {genericChildren(Component, name)}
          </Component>
        )}
      </form>
    );
  };

  if (layout === "icons") {
    const marks = identityProviders.slice(0, 3).map((idp, index) => {
      const Component = COMPONENTS[idp.type];
      return Component ? (
        <span className={OTHER_WAYS_MARK} key={`mark-${index}`}>
          <Component name={idp.name} look="mark">
            {genericChildren(Component, idp.name)}
          </Component>
        </span>
      ) : null;
    });
    return (
      <div className="flex w-full flex-col gap-5">
        {state?.samlData && <AutoSubmitForm url={state.samlData.url} fields={state.samlData.fields} />}
        {showLabel && (
          <Divider>
            <Translated i18nKey={context === "signUp" ? "orSignUpWith" : "orSignInWith"} namespace="idp" />
          </Divider>
        )}
        {!!identityProviders?.length && (
          <>
            <div className={clsx(ICON_ROW, "max-sm:hidden")}>
              {identityProviders.map((idp, index) => renderIDPButton(idp, index, "tile"))}
            </div>
            <ProviderSheet context={context} marks={marks}>
              {identityProviders.map((idp, index) => renderIDPButton(idp, index, "sheet"))}
            </ProviderSheet>
          </>
        )}
        {state?.error && <Alert>{state?.error}</Alert>}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {state?.samlData && <AutoSubmitForm url={state.samlData.url} fields={state.samlData.fields} />}
      {showLabel && (
        <div className="mb-3">
          <Divider>
            <Translated i18nKey="orSignInWith" namespace="idp" />
          </Divider>
        </div>
      )}
      {!!identityProviders?.length && identityProviders?.map((idp, index) => renderIDPButton(idp, index, "row"))}
      {state?.error && (
        <div className="mt-3">
          <Alert>{state?.error}</Alert>
        </div>
      )}
    </div>
  );
}

SignInWithIdp.displayName = "SignInWithIDP";

// The phone's providers: "Other ways to sign in", and the sheet it opens (a
// modal dialog: the page behind it inert, Escape or a press outside closes it).
function ProviderSheet({
  context,
  marks,
  children,
}: {
  context: "signIn" | "signUp";
  marks: ReactNode;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations("idp");

  return (
    <div className="sm:hidden">
      <button type="button" aria-haspopup="dialog" className={OTHER_WAYS} onClick={() => sheet.current?.showModal()}>
        <span className="flex" aria-hidden="true">
          {marks}
        </span>
        <Translated i18nKey={context === "signUp" ? "otherWaysSignUp" : "otherWaysSignIn"} namespace="idp" />
      </button>
      <dialog
        ref={sheet}
        aria-labelledby={titleId}
        className={SHEET}
        onClick={(event) => {
          // the sheet's content fills the dialog, so a press on the dialog itself is on the backdrop
          if (event.target === sheet.current) {
            sheet.current.close();
          }
        }}
      >
        <div className="flex flex-col px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div aria-hidden="true" className="mx-auto h-1 w-9 rounded-full bg-[var(--bp-divider)]" />
          <div className="mt-3 flex items-center justify-between">
            <h2 id={titleId} className="text-[17px] font-semibold">
              <Translated i18nKey={context === "signUp" ? "sheetSignUp" : "sheetSignIn"} namespace="idp" />
            </h2>
            <button
              type="button"
              aria-label={t("closeSheet")}
              className="tap-target -mr-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-[var(--bp-surface)]"
              onClick={() => sheet.current?.close()}
            >
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex flex-col [&>form:last-child>button]:border-b-0">{children}</div>
        </div>
      </dialog>
    </div>
  );
}
