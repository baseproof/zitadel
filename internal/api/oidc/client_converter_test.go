package oidc

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/internal/domain"
	"github.com/zitadel/zitadel/internal/query"
)

func TestClient_LoginURLUsesV2(t *testing.T) {
	t.Parallel()
	for _, version := range []domain.LoginVersion{domain.LoginVersionUnspecified, domain.LoginVersion1, domain.LoginVersion2} {
		client := ClientFromBusiness(&query.OIDCClient{LoginVersion: version}, "/ui/v2/login/login?authRequest=")
		for _, id := range []string{"legacy-id", "V2_request"} {
			require.Equal(t, "/ui/v2/login/login?authRequest="+id, client.LoginURL(id))
		}
	}
	baseURI := &url.URL{Scheme: "https", Host: "login.example", Path: "/custom", RawQuery: "theme=dark"}
	client := ClientFromBusiness(&query.OIDCClient{LoginBaseURI: (*query.URL)(baseURI)}, "/ui/v2/login/login?authRequest=")
	require.Equal(t, "https://login.example/custom/login?authRequest=V2_request&theme=dark", client.LoginURL("V2_request"))
}
