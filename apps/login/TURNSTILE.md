# Turnstile and Login V2 cutover

This fork uses Login V2 as its only hosted browser login. Turnstile runs in the
existing Next.js Login process. There is no verifier service, sidecar, shared
redemption database, or change to Zitadel's credential, session, permission, or
account-state rules.

## Enforcement

`src/lib/server/actions.ts` is the browser action boundary. Its private
implementations, cookie helpers and privileged transports import `server-only`.
The boundary verifies a fresh token before password/current-password checks,
OTP verification, passkey assertions, LDAP credentials, local/manual account
creation and external-provider completion. Public OTP/passkey operations cannot
submit arbitrary session checks. Social completion uses the `signup` action
because that operation may create an account; existing provider intent/state
validation still runs afterward.

Username discovery, provider initiation and challenge creation do not perform a
credential check or create an account. They keep their existing behavior.
Recovery, invitation/email verification, authenticator enrollment and device
consent retain their existing code/session authorization. Authenticated SSO
reloads its session using the server cookie rather than trusting browser-supplied
authentication factors. Turnstile is not a replacement for these checks or a
CAPTCHA requirement on authorized administrative/service APIs.

`src/lib/server/turnstile.ts` calls only Cloudflare's fixed HTTPS Siteverify URL.
It requires strict success, an exact configured hostname, the server-selected
action and an unexpired challenge timestamp. Missing tokens, malformed responses,
timeouts and capacity exhaustion deny the operation. Each process allows at most
64 outstanding verifications with a five-second deadline and a 16 KiB response
limit. Replicas remain stateless. Health probes do not depend on Cloudflare.

Cloudflare tokens expire after five minutes. Duplicate detection is eventually
consistent; this implementation does not promise atomic concurrent redemption
across replicas. A consumed, expired or failed attempt needs a fresh widget token.
See [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Runtime configuration

| Variable                      | Contract                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `TURNSTILE_ENABLED`           | Explicit `true` or `false`; missing/invalid is an error.                                 |
| `TURNSTILE_SITE_KEY`          | Public widget site key.                                                                  |
| `TURNSTILE_SECRET_KEY`        | Server-only matching secret, injected from a Kubernetes Secret.                          |
| `TURNSTILE_APPEARANCE`        | `always`, `execute`, or `interaction-only`.                                              |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Exact lowercase hostnames separated by commas; for this installation, `id.baseproof.ai`. |

All fields are required when enabled. Production rejects Cloudflare's documented
dummy keys. The layout reads configuration at request time and sends only
`enabled`, `siteKey` and `appearance` to React; no `NEXT_PUBLIC_*` secret or rebuild
is needed. Changes to Kubernetes environment variables require a pod rollout.
Privileged API transports accept only the configured `ZITADEL_API_URL` destination.

Use a Managed widget with `interaction-only` for background verification that
shows an interaction when Cloudflare requires one. Managed visible presentation
and Invisible widgets use the same component and server check. Widget mode
belongs to the key pair configured in Cloudflare; `appearance` does not change
Managed into Invisible. Invisible use must include Cloudflare's required privacy
notice. See [widget modes](https://developers.cloudflare.com/turnstile/concepts/widget/).

The shared widget preserves form inputs, bounds script/token waits, consumes its
in-memory token once, and provides retry after failure or expiry. It does not put
tokens or passwords in browser storage or URLs. Cloudflare receives only its
secret and token. Metrics contain the operation, allowlisted outcome and latency;
the verifier does not log upstream errors or request bodies.

## Breaking cutover requirements

The Go issuer no longer registers `/ui/login`. Old browser login, registration,
initialization and callback URLs return 404, including at direct issuer origins.
OIDC and SAML create V2 authentication requests regardless of old per-client
login-version preferences. `/device` GET redirects to the configured V2 device
page and preserves `user_code`; other methods are rejected. Old in-flight browser
flows must be restarted.

Before switching issuer images:

1. Require administrators and automation to use the existing V2 user/invitation
   APIs with V2 URL templates. Legacy provisioning APIs remain authenticated core
   APIs, but their initialization-link workflows are unsupported by this hosted
   login. Update Console-dependent provisioning procedures accordingly.
2. Complete onboarding for all users in `Initial` state before cutover. A legacy
   initialization code is not a V2 invitation code. Redirecting the old URL or
   merely issuing an invitation does not perform the canonical initialization
   state transition. This release does not migrate those users or change their
   state automatically.
3. Replace legacy IdP callback registrations and notification templates with the
   supported V2 destinations. Reissue applicable V2 email/invitation/recovery
   links; do not reinterpret old initialization codes. Check custom templates and
   outstanding links in the actual instance.
4. Qualify OIDC, SAML, device, existing-session SSO and V2 email/invitation flows.
   Legacy sessions are terminated locally on logout; their old upstream IdP
   logout handoff through the removed UI is no longer performed. An upstream IdP
   session can therefore remain active.
5. Deploy the tested fork issuer and Login images together. Updating only Login
   leaves the old issuer routes reachable. Confirm every reachable issuer origin
   runs the fork; Kubernetes ingress blocking alone is insufficient evidence.

The initial release versions are issuer `4.20.1` and Login `1.1.0`. The existing
publisher verifies both artifacts before publishing. The charts repository owns
their real digest pins, runtime environment references and rollout. No deployment
or secret provisioning is implied by this source change. Keep Turnstile explicitly
disabled in existing profiles until the paired release and cutover are qualified.

## Verification

Use the frozen workspace dependencies and repository Nx targets:

```sh
pnpm install --frozen-lockfile
pnpm nx run @zitadel/login:lint
pnpm nx run @zitadel/login:test-unit
pnpm nx run @zitadel/login:build
pnpm nx run @zitadel/login:test-dockerized
pnpm nx run @zitadel/api:build
go build ./...
go vet ./...
pnpm nx run @zitadel/api:lint
pnpm nx run @zitadel/api:test-unit
pnpm nx run @zitadel/api:test-integration
```

Confirm target names against `apps/api/project.json` when running manually. The
publisher is the executable build/release contract. Unit tests exercise the real
action boundary/verifier with isolated private effects and simulated Cloudflare
responses; this proves ordering, not deployed browser or network behavior.

Before production enablement, run Login acceptance tests against an isolated
seeded stack with the production `/ui/v2/login` base path. Check missing/invalid
tokens through direct actions, fresh retries after bad credentials, Managed
interaction and Invisible mode, provider-return registration, email links,
multi-tab behavior and key rotation across replicas. Inspect synthetic markers
in shipped client artifacts, HTML/RSC, action responses, logs and traces. Verify
trusted forwarding headers, outbound Cloudflare HTTPS and no old issuer image at
another origin. Do not claim “no leak” or complete deployment protection from
source tests or Cloudflare dashboard counts alone.
