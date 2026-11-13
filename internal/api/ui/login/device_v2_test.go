package login

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/internal/api/authz"
	http_utils "github.com/zitadel/zitadel/internal/api/http"
	"github.com/zitadel/zitadel/internal/feature"
)

func TestDefaultPaths_RedirectDeviceAuthorization(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		baseURI  *url.URL
		query    string
		expected string
	}{
		{
			name:     "default V2 page without a code",
			expected: "https://issuer.example/ui/v2/login/device",
		},
		{
			name:     "preserve user code without forwarding other parameters",
			query:    "?user_code=ABCD-EFGH&authRequestID=legacy&redirect=https://untrusted.example",
			expected: "https://issuer.example/ui/v2/login/device?user_code=ABCD-EFGH",
		},
		{
			name:     "custom absolute V2 base",
			baseURI:  &url.URL{Scheme: "https", Host: "login.example", Path: "/custom"},
			query:    "?user_code=ABCD-EFGH",
			expected: "https://login.example/custom/device?user_code=ABCD-EFGH",
		},
		{
			name:     "custom relative V2 base",
			baseURI:  &url.URL{Path: "/custom"},
			expected: "https://issuer.example/custom/device",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx := http_utils.WithDomainContext(
				authz.NewMockContext("instance", "org", "user", authz.WithMockFeatures(feature.Features{
					LoginV2: feature.LoginV2{Required: false, BaseURI: tt.baseURI},
				})),
				&http_utils.DomainCtx{Protocol: "https", PublicHost: "issuer.example"},
			)
			request := httptest.NewRequest(http.MethodGet, "/device"+tt.query, nil).WithContext(ctx)
			response := httptest.NewRecorder()
			paths := &DefaultPaths{BasePath: &url.URL{Path: "/ui/v2/login"}}
			paths.RedirectDeviceAuthorization(response, request)
			require.Equal(t, http.StatusFound, response.Code)
			require.Equal(t, tt.expected, response.Header().Get("Location"))
		})
	}
}

func TestDefaultPaths_RedirectDeviceAuthorizationRejectsMutation(t *testing.T) {
	t.Parallel()
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			t.Parallel()
			response := httptest.NewRecorder()
			paths := &DefaultPaths{}
			paths.RedirectDeviceAuthorization(response, httptest.NewRequest(method, "/device", nil))
			require.Equal(t, http.StatusMethodNotAllowed, response.Code)
			require.Equal(t, http.MethodGet, response.Header().Get("Allow"))
			require.Empty(t, response.Header().Get("Location"))
		})
	}
}
