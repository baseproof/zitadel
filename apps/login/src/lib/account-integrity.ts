// Baseproof's account integrity (baseproof/legal-agents docs/account-integrity.md):
// one person per account, one account per verified address.
//
// Reproduced on a local Zitadel 4.20.0 with this login (2026-10-30, run 4): a
// provider that does not verify email (Microsoft is configured so) made an
// account holding another person's address unverified; linking by email then
// joined that person's own provider identity (Google, verified) into it, the
// next sign-in's auto-update verified the address, and the first person's
// sign-in got in. These rules close each step: an address joins nothing unless
// an account holds it verified, and a sign-in never makes or moves an account
// onto an address another account holds verified.

import { User } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";

/** Whether the account is a human whose own email is verified. */
export function hasVerifiedEmail(user: User): boolean {
  return user.type.case === "human" && !!user.type.value.email?.isVerified;
}

/** Whether the account holds this address, verified (the address compared case-insensitively). */
export function holdsVerified(user: User, address: string): boolean {
  return (
    user.type.case === "human" &&
    !!user.type.value.email?.isVerified &&
    user.type.value.email.email.toLowerCase() === address.trim().toLowerCase()
  );
}

/** The accounts among these that hold the address verified. */
export function verifiedHolders(users: User[], address: string): User[] {
  return users.filter((user) => holdsVerified(user, address));
}

/**
 * An account whose only way to sign in is a provider: it has a provider identity
 * and neither a password nor a passkey. Such an account signs in only through its
 * provider; the login gives it no password or passkey.
 */
export function isProviderOnly(methods: AuthenticationMethodType[]): boolean {
  return (
    methods.includes(AuthenticationMethodType.IDP) &&
    !methods.includes(AuthenticationMethodType.PASSWORD) &&
    !methods.includes(AuthenticationMethodType.PASSKEY)
  );
}
