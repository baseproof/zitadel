package login

import (
	"context"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/internal/api/authz"
	http_utils "github.com/zitadel/zitadel/internal/api/http"
	"github.com/zitadel/zitadel/internal/feature"
)

func TestDefaultInviteURLTemplate(t *testing.T) {
	t.Parallel()
	for _, custom := range []string{"", "/custom", "https://login.example.com/custom"} {
		t.Run(custom, func(t *testing.T) {
			t.Parallel()
			base, err := url.Parse(custom)
			require.NoError(t, err)
			ctx := http_utils.WithDomainContext(
				authz.NewMockContext("instance", "org", "user", authz.WithMockFeatures(feature.Features{
					LoginV2: feature.LoginV2{Required: false, BaseURI: base},
				})),
				&http_utils.DomainCtx{Protocol: "https", PublicHost: "id.example.com"},
			)
			paths := &DefaultPaths{BasePath: &url.URL{Path: "/ui/v2/login"}}
			assertInviteDestination(t, ctx, paths, custom)
		})
	}
}

func assertInviteDestination(t *testing.T, ctx context.Context, paths *DefaultPaths, custom string) {
	t.Helper()
	template := paths.DefaultInviteURLTemplate(ctx)
	parsed, err := url.Parse(template)
	require.NoError(t, err)
	switch custom {
	case "":
		require.Equal(t, "https://id.example.com/ui/v2/login/verify", parsed.Scheme+"://"+parsed.Host+parsed.Path)
	case "/custom":
		require.Equal(t, "https://id.example.com/custom/verify", parsed.Scheme+"://"+parsed.Host+parsed.Path)
	default:
		require.Equal(t, "https://login.example.com/custom/verify", parsed.Scheme+"://"+parsed.Host+parsed.Path)
	}
	require.Equal(t, "true", parsed.Query().Get("invite"))
	require.Equal(t, "{{.Code}}", parsed.Query().Get("code"))
	require.Equal(t, "{{.UserID}}", parsed.Query().Get("userId"))
	require.Equal(t, "{{.OrgID}}", parsed.Query().Get("organization"))
	require.Contains(t, template, "code={{.Code}}")
	require.NotContains(t, template, "/ui/login")
}
