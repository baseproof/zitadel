/** Public, serializable widget configuration. Never add server credentials here. */
export type TurnstileAction = "login" | "signup" | "recovery";

export type TurnstileAppearance = "always" | "execute" | "interaction-only";

export type TurnstilePublicConfig = { enabled: false } | { enabled: true; siteKey: string; appearance: TurnstileAppearance };

export type TurnstileVerification = { success: true } | { success: false; error: string };
