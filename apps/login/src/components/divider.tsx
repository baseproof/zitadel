import { ReactNode } from "react";

// A rule with a word in the middle ("or", "or sign up with"), as Baseproof's
// login draws it between ways of signing in.
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-row items-center gap-4 px-8 text-[14px] text-[var(--bp-muted)]">
      <div className="h-px flex-1 bg-[var(--bp-divider)]" />
      <span>{children}</span>
      <div className="h-px flex-1 bg-[var(--bp-divider)]" />
    </div>
  );
}
