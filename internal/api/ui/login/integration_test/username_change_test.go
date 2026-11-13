//go:build integration

// This file checks that retiring Login V1 closes GHSA-4hgj-wm6c-q7p2, an
// unauthenticated account-rename in the former server-rendered UI.
//
// The vulnerability: POST /ui/login/username/change (handleChangeUsername) renamed the account
// identified by authReq.UserID without checking that the login flow had reached the change-username
// step or that any factor had succeeded. authReq.UserID is bound as soon as a login name is
// submitted (POST /ui/login/loginname -> checkLoginName -> SetUserInfo), which requires no secret.
// An UNAUTHENTICATED attacker could therefore start a flow, submit a victim's login name to bind
// authReq.UserID to that victim, and then POST a new username to rename the victim - including
// instance admins - locking them out and freeing their login name for squatting.
//
// Authorization must select V2 even with the former V1 settings. The old login,
// login-name and username-change routes must return 404. The account query then
// independently verifies that directly posting the victim's name and a replacement
// username did not change the victim's account, including after projection lag.
//
// Requires a running backend + database. Run with:
//
//	go test -tags integration ./internal/api/ui/login/integration_test/...
package login_test

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/zitadel/internal/api/ui/login"
	"github.com/zitadel/zitadel/internal/integration"
	"github.com/zitadel/zitadel/pkg/grpc/app"
	feature "github.com/zitadel/zitadel/pkg/grpc/feature/v2"
	object "github.com/zitadel/zitadel/pkg/grpc/object/v2"
	user "github.com/zitadel/zitadel/pkg/grpc/user/v2"
)

// TestChangeUsername_UnauthenticatedRename_IsRejected ensures the retired
// GHSA-4hgj-wm6c-q7p2 endpoint cannot be reopened or rename an account.
func TestChangeUsername_UnauthenticatedRename_IsRejected(t *testing.T) {
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

	// The victim: an active human with a password (so its first-factor step is the password page). We
	// create it with a known username so we can both submit its login name and detect a rename.
	victimUsername := "victim-" + integration.RandString(8)
	victimID, victimLoginName := createVictim(t, victimUsername)

	// --- Attacker HTTP client -------------------------------------------------------------------

	// Preserve cookies from authorization without following the hosted V2 redirect.
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	httpClient := &http.Client{
		Jar: jar,
		// Never auto-follow redirects: we want each hop's response as-is.
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

	// Submit the victim's login name directly. It must not start a V1 credential flow.
	loginNameForm := url.Values{
		login.QueryAuthRequestID: {authRequestID},
		"gorilla.csrf.Token":     {"forged-csrf-token"},
		"loginName":              {victimLoginName},
	}
	loginNameURL := issuer + login.HandlerPrefix + login.EndpointLoginName
	requireRetiredLoginEndpoint(t, httpClient, http.MethodPost, loginNameURL, loginNameForm)

	// Submit the rename payload even though the preceding route is unavailable.
	newUsername := "pwned-" + integration.RandString(8)
	changeForm := url.Values{
		login.QueryAuthRequestID: {authRequestID},
		"gorilla.csrf.Token":     {"forged-csrf-token"},
		"username":               {newUsername},
	}
	changeURL := issuer + login.HandlerPrefix + login.EndpointChangeUsername
	requireRetiredLoginEndpoint(t, httpClient, http.MethodPost, changeURL, changeForm)

	// The core security property: the victim's username must remain unchanged. Poll for a window so a
	// vulnerable rename that projects late still fails the test (an immediate single read could race a
	// slow projection and give a false green against unpatched code).
	requireUsernameUnchanged(t, victimID, victimUsername, 5*time.Second, 250*time.Millisecond)
}

// --- helpers specific to the username-change reproduction --------------------------------------
//
// HTTP helpers and the CTX/Instance globals are defined in
// external_login_test.go, which shares this package and build tag.

// createVictim creates an active human user with the given username, a verified email and a password
// (so its login flow's first factor is the password step) and returns its id and the preferred login
// name to submit at /ui/login/loginname.
func createVictim(t *testing.T, username string) (userID, loginName string) {
	t.Helper()
	resp, err := Instance.Client.UserV2.AddHumanUser(CTX, &user.AddHumanUserRequest{
		Organization: &object.Organization{
			Org: &object.Organization_OrgId{OrgId: Instance.DefaultOrg.GetId()},
		},
		Username: gu.Ptr(username),
		Profile: &user.SetHumanProfile{
			GivenName:         "Vic",
			FamilyName:        "Tim",
			PreferredLanguage: gu.Ptr("en"),
		},
		Email: &user.SetHumanEmail{
			Email:        username + "@victim.test",
			Verification: &user.SetHumanEmail_IsVerified{IsVerified: true},
		},
		PasswordType: &user.AddHumanUserRequest_Password{
			Password: &user.Password{Password: "Password1!", ChangeRequired: false},
		},
	})
	require.NoError(t, err)
	Instance.TriggerUserByID(CTX, resp.GetUserId())

	got, err := Instance.Client.UserV2.GetUserByID(CTX, &user.GetUserByIDRequest{UserId: resp.GetUserId()})
	require.NoError(t, err)
	loginName = got.GetUser().GetPreferredLoginName()
	require.NotEmpty(t, loginName)
	require.Equal(t, username, got.GetUser().GetUsername())
	return resp.GetUserId(), loginName
}

// requireUsernameUnchanged fails if the user's username changes away from want within waitFor.
func requireUsernameUnchanged(t *testing.T, userID, want string, waitFor, tick time.Duration) {
	t.Helper()
	pollFor(t, waitFor, tick, func() {
		resp, err := Instance.Client.UserV2.GetUserByID(CTX, &user.GetUserByIDRequest{UserId: userID})
		require.NoError(t, err)
		require.Equal(t, want, resp.GetUser().GetUsername(),
			"victim username changed to %q - unauthenticated rename succeeded", resp.GetUser().GetUsername())
	})
}
