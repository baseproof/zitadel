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

func TestDefaultPaths_RedirectToLogin(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		baseURI  *url.URL
		expected string
	}{
		{
			name:     "default V2 base despite old Required flag",
			expected: "https://issuer.example/ui/v2/login/",
		},
		{
			name:     "custom absolute V2 base",
			baseURI:  &url.URL{Scheme: "https", Host: "login.example", Path: "/custom"},
			expected: "https://login.example/custom",
		},
		{
			name:     "custom relative V2 base",
			baseURI:  &url.URL{Path: "/custom"},
			expected: "https://issuer.example/custom",
		},
	}
	for _, tt := range tests {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(tt.name+method, func(t *testing.T) {
				t.Parallel()
				ctx := http_utils.WithDomainContext(
					authz.NewMockContext("instance", "org", "user", authz.WithMockFeatures(feature.Features{
						LoginV2: feature.LoginV2{Required: false, BaseURI: tt.baseURI},
					})),
					&http_utils.DomainCtx{Protocol: "https", PublicHost: "issuer.example"},
				)
				request := httptest.NewRequest(method, "/?redirect=https://untrusted.example&authRequestID=legacy", nil).WithContext(ctx)
				response := httptest.NewRecorder()
				paths := &DefaultPaths{BasePath: &url.URL{Path: "/ui/v2/login/"}}
				paths.RedirectToLogin(response, request)
				require.Equal(t, http.StatusFound, response.Code)
				require.Equal(t, tt.expected, response.Header().Get("Location"))
			})
		}
	}
}

func TestDefaultPaths_RedirectToLoginRejectsMutation(t *testing.T) {
	t.Parallel()
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			t.Parallel()
			response := httptest.NewRecorder()
			paths := &DefaultPaths{}
			paths.RedirectToLogin(response, httptest.NewRequest(method, "/", nil))
			require.Equal(t, http.StatusMethodNotAllowed, response.Code)
			require.Equal(t, "GET, HEAD", response.Header().Get("Allow"))
			require.Empty(t, response.Header().Get("Location"))
		})
	}
}
