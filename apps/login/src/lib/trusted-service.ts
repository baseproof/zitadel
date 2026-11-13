import "server-only";

function parseDestination(value: unknown): URL {
  if (typeof value !== "string" || value !== value.trim()) throw new Error("Invalid Zitadel service destination");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Zitadel service destination");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Zitadel service destination");
  }
  return url;
}

/** Privileged transports may only send credentials to the deployment's configured API. */
export function trustedServiceUrl(destination: unknown): string {
  const trusted = parseDestination(process.env.ZITADEL_API_URL);
  if (parseDestination(destination).href !== trusted.href) throw new Error("Untrusted Zitadel service destination");
  return trusted.href;
}
