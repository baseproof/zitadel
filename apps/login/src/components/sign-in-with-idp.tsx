"use client";

import type { IdpButton, IdpSlug } from "@/lib/idp";
import { redirectToIdp } from "@/lib/server/idp";
import { useTranslations } from "next-intl";
import { ReactNode, useActionState } from "react";
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

// Each slug's button. A Record, so a slug lib/idp.ts adds without a button
// fails the type check here.
const BUTTONS: Record<IdpSlug, (props: SignInWithIdentityProviderProps) => ReactNode> = {
  apple: SignInWithApple,
  oauth: SignInWithGeneric,
  oidc: SignInWithGeneric,
  github: SignInWithGithub,
  github_es: SignInWithGithub,
  azure: SignInWithAzureAd,
  google: (props) => <SignInWithGoogle {...props} e2e="google" />,
  gitlab: SignInWithGitlab,
  gitlab_es: SignInWithGitlab,
  saml: SignInWithGeneric,
  ldap: SignInWithGeneric,
  jwt: SignInWithGeneric,
  zitadel: SignInWithZitadel,
};

export interface SignInWithIDPProps {
  children?: ReactNode;
  // From lib/idp's idpButtons, on the server: the slug, not the protobuf
  // type, so this component ships no protobuf schema.
  identityProviders: IdpButton[];
  requestId?: string;
  organization?: string;
  sessionId?: string;
  postErrorRedirectUrl?: string;
  /** Forwarded to the IdP as login_hint so the user does not have to type the identifier again. */
  loginHint?: string;
  showLabel?: boolean;
  // "icons": Baseproof's row of provider tiles (logo only, the name in the
  // tile's title); "list": upstream's full-width buttons.
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
  const iconOnly = layout === "icons";

  const renderIDPButton = (idp: IdpButton, index: number) => {
    const { id, name, slug } = idp;
    const Component = BUTTONS[slug];
    const tileLabel = t(context === "signUp" ? "signUpWithName" : "signInWithName", { name });
    // Generic providers (OAuth, OIDC, SAML, LDAP, JWT) carry no logo: the tile or row shows a mark by name.
    const genericTile =
      Component === SignInWithGeneric ? (
        <>
          <IdpGlyph name={name} />
          <span>{name}</span>
        </>
      ) : undefined;
    return Component ? (
      <form action={action} className="flex" key={`idp-${index}`}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="provider" value={slug} />
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="organization" value={organization} />
        {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
        {postErrorRedirectUrl && <input type="hidden" name="postErrorRedirectUrl" value={postErrorRedirectUrl} />}
        {loginHint && <input type="hidden" name="loginHint" value={loginHint} />}
        {iconOnly ? (
          <Component key={id} name={name} iconOnly title={tileLabel} aria-label={tileLabel}>
            {genericTile}
          </Component>
        ) : (
          <Component key={id} name={name}>
            {genericTile}
          </Component>
        )}
      </form>
    ) : null;
  };

  if (iconOnly) {
    return (
      <div className="flex w-full flex-col gap-5">
        {state?.samlData && <AutoSubmitForm url={state.samlData.url} fields={state.samlData.fields} />}
        {showLabel && (
          <Divider>
            <Translated i18nKey={context === "signUp" ? "orSignUpWith" : "orSignInWith"} namespace="idp" />
          </Divider>
        )}
        {!!identityProviders?.length && (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(identityProviders.length, 3)}, minmax(0, 1fr))` }}
          >
            {identityProviders.map(renderIDPButton)}
          </div>
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
      {!!identityProviders?.length && identityProviders?.map(renderIDPButton)}
      {state?.error && (
        <div className="mt-3">
          <Alert>{state?.error}</Alert>
        </div>
      )}
    </div>
  );
}

SignInWithIdp.displayName = "SignInWithIDP";
