package saml

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/internal/domain"
	"github.com/zitadel/zitadel/internal/query"
)

func TestServiceProvider_LoginURLUsesV2(t *testing.T) {
	t.Parallel()
	for _, version := range []domain.LoginVersion{domain.LoginVersionUnspecified, domain.LoginVersion1, domain.LoginVersion2} {
		sp := &ServiceProvider{
			SP:                &query.SAMLServiceProvider{LoginVersion: version},
			defaultLoginURLV2: "/ui/v2/login/login?samlRequest=",
		}
		for _, id := range []string{"legacy-id", "V2_request"} {
			require.Equal(t, "/ui/v2/login/login?samlRequest="+id, sp.LoginURL(id))
		}
	}
	sp := &ServiceProvider{SP: &query.SAMLServiceProvider{
		LoginBaseURI: &url.URL{Scheme: "https", Host: "login.example", Path: "/custom", RawQuery: "theme=dark"},
	}}
	require.Equal(t, "https://login.example/custom/login?samlRequest=V2_request&theme=dark", sp.LoginURL("V2_request"))
}
