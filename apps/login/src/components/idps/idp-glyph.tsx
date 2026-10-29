// The tile's mark for a provider set up through Zitadel's generic OAuth or
// OIDC templates, which carry no logo of their own: chosen by the provider's
// name (data in Zitadel), else its initial.
export function IdpGlyph({ name }: { name: string }) {
  if (/linkedin/i.test(name)) {
    return (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden="true">
        <path
          fill="#0A66C2"
          d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"
        />
      </svg>
    );
  }
  // A div, not a span: the tile keeps spans for screen readers only.
  return (
    <div aria-hidden="true" className="text-[15px] font-semibold">
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}
