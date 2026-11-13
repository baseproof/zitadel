//go:build integration

package admin_test

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/zitadel/internal/integration"
	"github.com/zitadel/zitadel/pkg/grpc/admin"
)

func TestServer_Restrictions_DisallowPublicOrgRegistration(t *testing.T) {
	instance := integration.NewInstance(CTX)
	regOrgUrl, err := url.Parse("http://" + instance.Domain + ":8082/ui/login/register/org")
	require.NoError(t, err)
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	iamOwnerCtx := instance.WithAuthorization(CTX, integration.UserTypeIAMOwner)

	t.Run("restriction defaults to false while Login V1 remains retired", func(tt *testing.T) {
		awaitPublicOrgRestriction(tt, iamOwnerCtx, instance.Client, false)
		requireRetiredPublicOrgRegistration(tt, iamOwnerCtx, client, regOrgUrl)
	})
	t.Run("disallowing public org registration preserves retired endpoints", func(tt *testing.T) {
		_, err = instance.Client.Admin.SetRestrictions(iamOwnerCtx, &admin.SetRestrictionsRequest{DisallowPublicOrgRegistration: gu.Ptr(true)})
		require.NoError(tt, err)
		awaitPublicOrgRestriction(tt, iamOwnerCtx, instance.Client, true)
		requireRetiredPublicOrgRegistration(tt, iamOwnerCtx, client, regOrgUrl)
	})
	t.Run("clearing the restriction cannot reopen Login V1", func(tt *testing.T) {
		_, err = instance.Client.Admin.SetRestrictions(iamOwnerCtx, &admin.SetRestrictionsRequest{DisallowPublicOrgRegistration: gu.Ptr(false)})
		require.NoError(tt, err)
		awaitPublicOrgRestriction(tt, iamOwnerCtx, instance.Client, false)
		requireRetiredPublicOrgRegistration(tt, iamOwnerCtx, client, regOrgUrl)
	})
}

func awaitPublicOrgRestriction(t *testing.T, ctx context.Context, cc *integration.Client, disallowed bool) {
	t.Helper()
	retryDuration, tick := integration.WaitForAndTickWithMaxDuration(ctx, time.Minute)
	require.EventuallyWithT(t, func(tt *assert.CollectT) {
		restrictions, err := cc.Admin.GetRestrictions(ctx, &admin.GetRestrictionsRequest{})
		require.NoError(tt, err)
		assert.Equal(tt, disallowed, restrictions.DisallowPublicOrgRegistration)
	}, retryDuration, tick, "awaiting public organization restriction failed")
}

// The compatibility setting remains readable and writable, but neither value may
// remount the retired Login V1 organization-registration form or submission route.
func requireRetiredPublicOrgRegistration(t *testing.T, ctx context.Context, client *http.Client, parsedURL *url.URL) {
	t.Helper()
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			form := url.Values{"gorilla.csrf.Token": {"forged-csrf-token"}}
			req, err := http.NewRequestWithContext(ctx, method, parsedURL.String(), strings.NewReader(form.Encode()))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()
			require.Equal(t, http.StatusNotFound, resp.StatusCode)
			require.Empty(t, resp.Header.Get("Location"))
		})
	}
}
