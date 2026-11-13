//go:build integration

// Package login_test verifies that retiring Login V1 closes the account pre-hijack
// path from GHSA-738m-7888-jfv8 and the account-rename path from GHSA-4hgj-wm6c-q7p2.
//
// The vulnerability: POST /ui/login/externaluser/option (handleExternalNotFoundOptionCheck)
// is meant to be the *submit* of the "external account not found" page, which only ever appears
// after a genuine, protocol-verified IDP callback has populated the server-side
// authReq.LinkingUsers state. Before the fix, the handler ignored that state and built the new
// user's external identity (IDPConfigID + ExternalUserID) and its "verified" email straight from
// the raw POST body. An UNAUTHENTICATED attacker could therefore POST forged data directly to the
// endpoint - without ever going through the real IDP - and have Zitadel create a real account
// bound to an arbitrary (IDPConfigID, ExternalUserID). By setting ExternalUserID to a victim's
// public external identifier (e.g. a GitHub numeric user id) the attacker pre-creates an account
// that the victim's own, genuine future "Sign in with X" then silently logs into.
//
// Login V1 is no longer mounted. Even with its former feature setting and an
// unspecified application login version, authorization must create a V2 request.
// The retired login and IDP routes must return 404, including a direct forged
// registration POST. The account query then independently verifies no user was created.
//
// Note on setup: no real GitHub account or working OAuth app is needed. The exploit bypasses the
// real OAuth round-trip entirely, so the IDP template only has to EXIST with creation allowed and
// dummy credentials - its client id/secret and endpoints are never exercised on the attack path.
//
// Requires a running backend + database. Run with:
//
//	go test -tags integration ./internal/api/ui/login/integration_test/...
package login_test

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/zitadel/internal/api/ui/login"
	"github.com/zitadel/zitadel/internal/integration"
	"github.com/zitadel/zitadel/pkg/grpc/app"
	feature "github.com/zitadel/zitadel/pkg/grpc/feature/v2"
	idp_pb "github.com/zitadel/zitadel/pkg/grpc/idp"
	user "github.com/zitadel/zitadel/pkg/grpc/user/v2"
)

var (
	CTX      context.Context
	Instance *integration.Instance
)

func TestMain(m *testing.M) {
	os.Exit(func() int {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()

		Instance = integration.NewInstance(ctx)
		CTX = Instance.WithAuthorization(ctx, integration.UserTypeIAMOwner)
		return m.Run()
	}())
}

// TestExternalNotFoundOption_ForgedRegistration_IsRejected ensures the retired
// GHSA-738m-7888-jfv8 endpoint cannot be reopened or create an attacker-forged account.
func TestExternalNotFoundOption_ForgedRegistration_IsRejected(t *testing.T) {
	// --- Server setup (all via gRPC as the IAM owner) -------------------------------------------

	// The former V1 feature setting must not reopen the retired login paths.
	integration.EnsureInstanceFeature(t, CTX, Instance,
		&feature.SetInstanceFeaturesRequest{LoginV2: &feature.LoginV2{Required: false}},
		func(tt *assert.CollectT, got *feature.GetInstanceFeaturesResponse) {
			assert.False(tt, got.GetLoginV2().GetRequired())
		},
	)

	// Leave the application login version unspecified and omit the login-client
	// header below. These former V1 selectors must still produce a V2 auth request.
	redirectURI := "http://localhost:9999/callback"
	project := Instance.CreateProject(CTX, t, Instance.DefaultOrg.GetId(), integration.RandString(10), false, false)
	oidcApp, err := Instance.CreateOIDCClient(CTX, redirectURI, "", project.GetId(),
		app.OIDCAppType_OIDC_APP_TYPE_WEB, app.OIDCAuthMethodType_OIDC_AUTH_METHOD_TYPE_NONE, true)
	require.NoError(t, err)
	clientID := oidcApp.GetClientId()

	// An external OAuth IDP with creation ALLOWED but auto-creation DISABLED - the configuration under
	// which the genuine flow renders the not-found-option page. Its clientID/secret + example.com
	// endpoints are dummy and are never contacted on the attack path. auto-linking is left unspecified
	// so it plays no role here.
	idpResp := Instance.AddGenericOAuthProviderWithOptions(CTX, integration.RandString(10),
		true /*isLinkingAllowed*/, true /*isCreationAllowed*/, false /*isAutoCreation*/, idp_pb.AutoLinkingOption_AUTO_LINKING_OPTION_UNSPECIFIED)
	idpID := idpResp.GetId()
	// The IDP must be enabled on the login policy to be selectable in the login UI.
	Instance.AddProviderToDefaultLoginPolicy(CTX, idpID)

	// --- Attacker HTTP client -------------------------------------------------------------------

	// Preserve any cookies from authorization, but do not follow redirects into the
	// hosted Login V2 UI or the dummy external provider.
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	httpClient := &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	issuer := Instance.OIDCIssuer() // http://<instance-domain>:<port>

	// Authorization must work and select V2 before probing the retired V1 routes.
	authURL := issuer + "/oauth/v2/authorize?" + url.Values{
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"scope":                 {"openid"},
		"state":                 {"attacker-state"},
		"code_challenge":        {oidc.NewSHACodeChallenge(integration.CodeVerifier)},
		"code_challenge_method": {"S256"},
	}.Encode()
	loc := getLocation(t, httpClient, authURL)
	authRequestID := requireV2AuthRequest(t, loc)

	// The retired page cannot issue a V1 form or CSRF token.
	loginPageURL := issuer + login.HandlerPrefix + login.EndpointLogin + "?" + login.QueryAuthRequestID + "=" + authRequestID
	requireRetiredLoginEndpoint(t, httpClient, http.MethodGet, loginPageURL, nil)

	// Direct provider selection must also be unavailable.
	selectIDPURL := issuer + login.HandlerPrefix + login.EndpointExternalLogin + "?" +
		login.QueryAuthRequestID + "=" + authRequestID + "&idpConfigID=" + idpID
	requireRetiredLoginEndpoint(t, httpClient, http.MethodGet, selectIDPURL, nil)

	// Submit the original forged identity payload directly despite the unavailable
	// preceding pages. Require route retirement, not a CSRF or handler-level rejection.
	forgedEmail := "attacker-" + integration.RandString(8) + "@evil.test"
	forgedVictimID := "999999999" // e.g. a victim's public GitHub numeric user id
	form := url.Values{
		login.QueryAuthRequestID:   {authRequestID},
		"gorilla.csrf.Token":       {"forged-csrf-token"},
		"external-idp-config-id":   {idpID},          // attacker-controlled: which IDP the link is bound to
		"external-idp-ext-user-id": {forgedVictimID}, // attacker-controlled: the identity being claimed
		"external-email":           {forgedEmail},    // attacker-controlled: echoed "IDP" email
		"external-email-verified":  {"true"},         // attacker-controlled: forged "verified" flag
		"email":                    {forgedEmail},    // attacker-controlled
		"username":                 {"attacker-" + integration.RandString(8)},
		"firstname":                {"At"},
		"lastname":                 {"Tacker"},
		"language":                 {"en"},
		"terms-confirm":            {"true"},
	}
	postURL := issuer + login.HandlerPrefix + login.EndpointExternalNotFoundOption + "?autoregisterbutton=true"
	requireRetiredLoginEndpoint(t, httpClient, http.MethodPost, postURL, form)

	// No account may exist for the forged identity. Poll on the test goroutine for a window so a
	// late-projected user still fails the test (assert.Never is unsafe here: its condition runs in a
	// background goroutine that can outlive the test and panic on CTX cancel from TestMain).
	requireNeverUserByEmail(t, forgedEmail, 5*time.Second, 250*time.Millisecond)
}

// --- helpers ------------------------------------------------------------------------------------

func doGet(t *testing.T, c *http.Client, rawURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(CTX, http.MethodGet, rawURL, nil)
	require.NoError(t, err)
	resp, err := c.Do(req)
	require.NoError(t, err)
	return resp
}

// getLocation issues a GET and returns the parsed Location of the expected redirect response.
func getLocation(t *testing.T, c *http.Client, rawURL string) *url.URL {
	t.Helper()
	resp := doGet(t, c, rawURL)
	defer resp.Body.Close()
	require.GreaterOrEqual(t, resp.StatusCode, 300)
	require.Less(t, resp.StatusCode, 400, "expected a redirect from %q", rawURL)
	loc, err := resp.Location()
	require.NoError(t, err)
	return loc
}

func requireV2AuthRequest(t *testing.T, location *url.URL) string {
	t.Helper()
	require.Empty(t, location.Query().Get(login.QueryAuthRequestID), "authorization must not create a Login V1 request")
	require.False(t, strings.HasPrefix(location.Path, login.HandlerPrefix), "authorization must not redirect to Login V1")
	requestID := location.Query().Get("authRequest")
	require.True(t, strings.HasPrefix(requestID, "V2_"), "expected a V2 auth request in %q", location.String())
	return requestID
}

// requireRetiredLoginEndpoint distinguishes an unmounted route from a redirect,
// CSRF failure, or a live handler rejecting the particular attack payload.
func requireRetiredLoginEndpoint(t *testing.T, client *http.Client, method, rawURL string, form url.Values) {
	t.Helper()
	req, err := http.NewRequestWithContext(CTX, method, rawURL, strings.NewReader(form.Encode()))
	require.NoError(t, err)
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := client.Do(req)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusNotFound, response.StatusCode, "retired Login V1 route %s", rawURL)
	require.Empty(t, response.Header.Get("Location"), "retired Login V1 routes must not redirect")
}

// pollFor runs check every tick until waitFor elapses (and once more at the deadline). check should
// require an invariant that must hold for the whole window; it fails the test on violation via
// require.*. It proves a negative - that a forbidden change never appears even under projection lag -
// without assert.Never, whose background goroutine can outlive the test and panic on CTX cancel.
func pollFor(t *testing.T, waitFor, tick time.Duration, check func()) {
	t.Helper()
	deadline := time.Now().Add(waitFor)
	for {
		check()
		if !time.Now().Before(deadline) {
			return
		}
		time.Sleep(tick)
	}
}

// requireNeverUserByEmail fails if a user with the given email appears within waitFor.
func requireNeverUserByEmail(t *testing.T, email string, waitFor, tick time.Duration) {
	t.Helper()
	pollFor(t, waitFor, tick, func() {
		resp, err := Instance.Client.UserV2.ListUsers(CTX, &user.ListUsersRequest{
			Queries: []*user.SearchQuery{
				{Query: &user.SearchQuery_EmailQuery{EmailQuery: &user.EmailQuery{EmailAddress: email}}},
			},
		})
		require.NoError(t, err)
		require.Empty(t, resp.GetResult(),
			"a user was created for the attacker-forged external identity %q - account pre-hijack succeeded", email)
	})
}
