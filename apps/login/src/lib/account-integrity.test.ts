import { User } from "@zitadel/proto/zitadel/user/v2/user_pb";
import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { describe, expect, test } from "vitest";
import { hasVerifiedEmail, holdsVerified, isProviderOnly, verifiedHolders } from "./account-integrity";

const human = (userId: string, email: string, isVerified: boolean) =>
  ({ userId, type: { case: "human", value: { email: { email, isVerified } } } }) as unknown as User;
const machine = { userId: "m1", type: { case: "machine", value: {} } } as unknown as User;

describe("account integrity", () => {
  test("an account's email counts only when verified", () => {
    expect(hasVerifiedEmail(human("u1", "a@corp.example", true))).toBe(true);
    expect(hasVerifiedEmail(human("u1", "a@corp.example", false))).toBe(false);
    expect(hasVerifiedEmail(machine)).toBe(false);
  });

  test("an account holds an address only verified, compared case-insensitively", () => {
    expect(holdsVerified(human("u1", "Jordan@Corp.example", true), " jordan@corp.example ")).toBe(true);
    expect(holdsVerified(human("u1", "jordan@corp.example", false), "jordan@corp.example")).toBe(false);
    expect(holdsVerified(human("u1", "other@corp.example", true), "jordan@corp.example")).toBe(false);
    expect(holdsVerified(machine, "jordan@corp.example")).toBe(false);
  });

  test("of two accounts on one address, only the verified one holds it", () => {
    const squatter = human("u1", "victim@corp.example", false);
    const owner = human("u2", "victim@corp.example", true);
    expect(verifiedHolders([squatter, owner], "victim@corp.example")).toEqual([owner]);
    expect(verifiedHolders([squatter], "victim@corp.example")).toEqual([]);
  });

  test("an account is provider-only with a provider identity and no password or passkey", () => {
    const { IDP, PASSWORD, PASSKEY, TOTP } = AuthenticationMethodType;
    expect(isProviderOnly([IDP])).toBe(true);
    expect(isProviderOnly([IDP, TOTP])).toBe(true);
    expect(isProviderOnly([IDP, PASSWORD])).toBe(false);
    expect(isProviderOnly([IDP, PASSKEY])).toBe(false);
    expect(isProviderOnly([PASSWORD])).toBe(false);
    expect(isProviderOnly([])).toBe(false);
  });
});
