package saml

import (
	"github.com/zitadel/saml/pkg/provider/serviceprovider"

	"github.com/zitadel/zitadel/internal/query"
)

const (
	LoginSamlRequestParam = "samlRequest"
	LoginPath             = "/login"
)

type ServiceProvider struct {
	SP                *query.SAMLServiceProvider
	defaultLoginURLV2 string
}

func ServiceProviderFromBusiness(spQuery *query.SAMLServiceProvider, defaultLoginURLV2 string) (*serviceprovider.ServiceProvider, error) {
	sp := &ServiceProvider{
		SP:                spQuery,
		defaultLoginURLV2: defaultLoginURLV2,
	}

	return serviceprovider.NewServiceProvider(
		spQuery.AppID,
		&serviceprovider.Config{Metadata: spQuery.Metadata},
		sp.LoginURL,
	)
}

func (s *ServiceProvider) LoginURL(id string) string {
	// Requests without an application-specific URI use the configured Login V2 UI.
	if s.SP.LoginBaseURI == nil || s.SP.LoginBaseURI.String() == "" {
		return s.defaultLoginURLV2 + id
	}
	// for applications with a specific URI (internal or external) we only need to add the auth request id
	uri := s.SP.LoginBaseURI.JoinPath(LoginPath)
	q := uri.Query()
	q.Set(LoginSamlRequestParam, id)
	uri.RawQuery = q.Encode()
	return uri.String()
}
