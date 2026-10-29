import { IDPType } from "@zitadel/proto/zitadel/idp/v2/idp_pb";
import { IdentityProvider, IdentityProviderType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";

// The slug of each IdentityProviderType the login has a button and the
// /success and /failure routes for.
const IDP_SLUGS = {
  [IdentityProviderType.GITHUB]: "github",
  [IdentityProviderType.GITHUB_ES]: "github_es",
  [IdentityProviderType.GITLAB]: "gitlab",
  [IdentityProviderType.GITLAB_SELF_HOSTED]: "gitlab_es",
  [IdentityProviderType.APPLE]: "apple",
  [IdentityProviderType.GOOGLE]: "google",
  [IdentityProviderType.AZURE_AD]: "azure",
  [IdentityProviderType.SAML]: "saml",
  [IdentityProviderType.OAUTH]: "oauth",
  [IdentityProviderType.OIDC]: "oidc",
  [IdentityProviderType.LDAP]: "ldap",
  [IdentityProviderType.JWT]: "jwt",
  [IdentityProviderType.ZITADEL]: "zitadel",
} as const;

export type IdpSlug = (typeof IDP_SLUGS)[keyof typeof IDP_SLUGS];

// This maps the IdentityProviderType to a slug which is used in the /success and /failure routes
export function idpTypeToSlug(idpType: IdentityProviderType): IdpSlug {
  const slug = IDP_SLUGS[idpType as keyof typeof IDP_SLUGS];
  if (!slug) {
    throw new Error("Unknown identity provider type");
  }
  return slug;
}

/**
 * A provider as the sign-in buttons need it: its id, its name, its slug.
 * Pages build these on the server, so the buttons (a client component) carry
 * no protobuf schema to the browser. IdentityProviderType's enum brings the
 * whole of zitadel/idp/v2/idp.proto and login_settings.proto with it: 24 KiB
 * of descriptors on the sign-in page. A type the login has no slug for gets
 * no button, as before.
 */
export type IdpButton = { id: string; name: string; slug: IdpSlug };

export function idpButtons(providers: IdentityProvider[]): IdpButton[] {
  return providers.flatMap(({ id, name, type }) => {
    const slug = IDP_SLUGS[type as keyof typeof IDP_SLUGS];
    return slug ? [{ id, name, slug }] : [];
  });
}

// TODO: this is ugly but needed atm as the getIDPByID returns a IDPType and not a IdentityProviderType
export function idpTypeToIdentityProviderType(idpType: IDPType): IdentityProviderType {
  switch (idpType) {
    case IDPType.IDP_TYPE_GITHUB:
      return IdentityProviderType.GITHUB;

    case IDPType.IDP_TYPE_GITHUB_ES:
      return IdentityProviderType.GITHUB_ES;

    case IDPType.IDP_TYPE_GITLAB:
      return IdentityProviderType.GITLAB;

    case IDPType.IDP_TYPE_GITLAB_SELF_HOSTED:
      return IdentityProviderType.GITLAB_SELF_HOSTED;

    case IDPType.IDP_TYPE_APPLE:
      return IdentityProviderType.APPLE;

    case IDPType.IDP_TYPE_GOOGLE:
      return IdentityProviderType.GOOGLE;

    case IDPType.IDP_TYPE_AZURE_AD:
      return IdentityProviderType.AZURE_AD;

    case IDPType.IDP_TYPE_SAML:
      return IdentityProviderType.SAML;

    case IDPType.IDP_TYPE_OAUTH:
      return IdentityProviderType.OAUTH;

    case IDPType.IDP_TYPE_OIDC:
      return IdentityProviderType.OIDC;

    case IDPType.IDP_TYPE_JWT:
      return IdentityProviderType.JWT;

    case IDPType.IDP_TYPE_ZITADEL:
      return IdentityProviderType.ZITADEL;

    default:
      throw new Error("Unknown identity provider type");
  }
}
