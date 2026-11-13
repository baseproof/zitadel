//go:build integration

package oidc_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	http_utils "github.com/zitadel/zitadel/internal/api/http"
	"github.com/zitadel/zitadel/internal/command"
)

func TestServer_LegacyLoginUnavailable(t *testing.T) {
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	for _, path := range []string{"/ui/login/", "/ui/login/login", "/ui/login/register", "/ui/login/password", "/ui/login/device"} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			t.Run(method+path, func(t *testing.T) {
				request, err := http.NewRequestWithContext(CTX, method, http_utils.BuildOrigin(Instance.Config.Host(), Instance.Config.Secure)+path, nil)
				require.NoError(t, err)
				request.Host = Instance.Host()
				response, err := client.Do(request)
				require.NoError(t, err)
				defer response.Body.Close()
				require.Equal(t, http.StatusNotFound, response.StatusCode)
				require.Empty(t, response.Header.Get("Location"))
			})
		}
	}
}

func TestServer_DeviceEntryUsesV2(t *testing.T) {
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	request, err := http.NewRequestWithContext(CTX, http.MethodGet, http_utils.BuildOrigin(Instance.Config.Host(), Instance.Config.Secure)+"/device?user_code=ABCD-EFGH", nil)
	require.NoError(t, err)
	request.Host = Instance.Host()
	response, err := client.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusFound, response.StatusCode)
	target, err := url.Parse(response.Header.Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "/ui/v2/login/device", target.Path)
	require.Equal(t, "ABCD-EFGH", target.Query().Get("user_code"))
}

func TestServer_UnspecifiedLoginVersionUsesV2WithoutHeader(t *testing.T) {
	clientID, _ := createClient(t, Instance)
	id := createAuthRequestNoLoginClientHeader(t, Instance, clientID, redirectURI)
	require.Contains(t, id, command.IDPrefixV2)
}
