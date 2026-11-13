package oidc

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/logging"
	"github.com/zitadel/oidc/v3/pkg/crypto"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/zitadel/internal/api/authz"
	http_utils "github.com/zitadel/zitadel/internal/api/http"
	"github.com/zitadel/zitadel/internal/api/http/middleware"
	"github.com/zitadel/zitadel/internal/api/oidc/sign"
	"github.com/zitadel/zitadel/internal/api/ui/login"
	"github.com/zitadel/zitadel/internal/auth/repository/eventsourcing/handler"
	"github.com/zitadel/zitadel/internal/command"
	"github.com/zitadel/zitadel/internal/domain"
	"github.com/zitadel/zitadel/internal/query"
	"github.com/zitadel/zitadel/internal/telemetry/tracing"
	"github.com/zitadel/zitadel/internal/zerrors"
)

const (
	LoginClientHeader            = "x-zitadel-login-client"
	LoginPostLogoutRedirectParam = "post_logout_redirect"
	LoginLogoutHintParam         = "logout_hint"
	LoginUILocalesParam          = "ui_locales"
	LoginLogoutTokenParam        = "logout_token"
	LoginPath                    = "/login"
	LogoutPath                   = "/logout"
	LogoutDonePath               = "/logout/done"
)

func (o *OPStorage) CreateAuthRequest(ctx context.Context, req *oidc.AuthRequest, userID string) (_ op.AuthRequest, err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()

	// Preserve an explicitly selected login client; all requests use Login V2.
	headers, _ := http_utils.HeadersFromCtx(ctx)
	loginClient := headers.Get(LoginClientHeader)
	return o.createAuthRequestLoginClient(ctx, req, userID, loginClient)
}

func (o *OPStorage) createAuthRequestScopeAndAudience(ctx context.Context, clientID string, reqScope []string) (scope, audience []string, orgID string, err error) {
	project, err := o.query.ProjectByClientID(ctx, clientID)
	if err != nil {
		return nil, nil, "", err
	}

	orgID, err = o.assertOrgScope(ctx, reqScope)
	if err != nil {
		return nil, nil, "", err
	}

	scope, err = o.assertProjectRoleScopesByProject(ctx, project, reqScope)
	if err != nil {
		return nil, nil, "", err
	}
	audience, err = o.audienceFromProjectID(ctx, project.ID)
	audience = domain.AddAudScopeToAudience(ctx, audience, scope)
	if err != nil {
		return nil, nil, "", err
	}
	return scope, audience, orgID, nil
}

func (o *OPStorage) createAuthRequestLoginClient(ctx context.Context, req *oidc.AuthRequest, hintUserID, loginClient string) (op.AuthRequest, error) {
	scope, audience, orgID, err := o.createAuthRequestScopeAndAudience(ctx, req.ClientID, req.Scopes)
	if err != nil {
		return nil, err
	}
	authRequest := &command.AuthRequest{
		LoginClient:      loginClient,
		ClientID:         req.ClientID,
		RedirectURI:      req.RedirectURI,
		State:            req.State,
		Nonce:            req.Nonce,
		Scope:            scope,
		Audience:         audience,
		NeedRefreshToken: slices.Contains(scope, oidc.ScopeOfflineAccess),
		ResponseType:     ResponseTypeToBusiness(req.ResponseType),
		ResponseMode:     ResponseModeToBusiness(req.ResponseMode),
		CodeChallenge:    CodeChallengeToBusiness(req.CodeChallenge, req.CodeChallengeMethod),
		Prompt:           PromptToBusiness(req.Prompt),
		UILocales:        UILocalesToBusiness(req.UILocales),
		MaxAge:           MaxAgeToBusiness(req.MaxAge),
		Issuer:           o.contextToIssuer(ctx),
		OrganizationID:   orgID,
	}
	if req.LoginHint != "" {
		authRequest.LoginHint = &req.LoginHint
	}
	if hintUserID != "" {
		authRequest.HintUserID = &hintUserID
	}

	aar, err := o.command.AddAuthRequest(ctx, authRequest)
	if err != nil {
		return nil, err
	}
	return &AuthRequestV2{aar}, nil
}

func (o *OPStorage) audienceFromProjectID(ctx context.Context, projectID string) ([]string, error) {
	projectIDQuery, err := query.NewAppProjectIDSearchQuery(projectID)
	if err != nil {
		return nil, err
	}
	appIDs, err := o.query.SearchClientIDs(ctx, &query.AppSearchQueries{Queries: []query.SearchQuery{projectIDQuery}}, false)
	if err != nil {
		return nil, err
	}

	return append(appIDs, projectID), nil
}

func (o *OPStorage) AuthRequestByID(ctx context.Context, id string) (_ op.AuthRequest, err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()

	if strings.HasPrefix(id, command.IDPrefixV2) {
		req, err := o.command.GetCurrentAuthRequest(ctx, id)
		if err != nil {
			return nil, err
		}
		return &AuthRequestV2{req}, nil
	}

	userAgentID, ok := middleware.UserAgentIDFromCtx(ctx)
	if !ok {
		return nil, zerrors.ThrowPreconditionFailed(nil, "OIDC-D3g21", "no user agent id")
	}
	resp, err := o.repo.AuthRequestByIDCheckLoggedIn(ctx, id, userAgentID)
	if err != nil {
		return nil, err
	}
	return AuthRequestFromBusiness(resp)
}

func (o *OPStorage) AuthRequestByCode(ctx context.Context, code string) (_ op.AuthRequest, err error) {
	panic(o.panicErr("AuthRequestByCode"))
}

func (o *OPStorage) SaveAuthCode(ctx context.Context, id, code string) (err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()

	if strings.HasPrefix(id, command.IDPrefixV2) {
		return o.command.AddAuthRequestCode(ctx, id, code)
	}

	userAgentID, ok := middleware.UserAgentIDFromCtx(ctx)
	if !ok {
		return zerrors.ThrowPreconditionFailed(nil, "OIDC-Dgus2", "no user agent id")
	}
	return o.repo.SaveAuthCode(ctx, id, code, userAgentID)
}

func (o *OPStorage) DeleteAuthRequest(context.Context, string) error {
	panic(o.panicErr("DeleteAuthRequest"))
}

func (o *OPStorage) CreateAccessToken(context.Context, op.TokenRequest) (string, time.Time, error) {
	panic(o.panicErr("CreateAccessToken"))
}

func (o *OPStorage) CreateAccessAndRefreshTokens(context.Context, op.TokenRequest, string) (string, string, time.Time, error) {
	panic(o.panicErr("CreateAccessAndRefreshTokens"))
}

func (*OPStorage) panicErr(method string) error {
	return fmt.Errorf("OPStorage.%s should not be called anymore. This is a bug. Please report https://github.com/zitadel/zitadel/issues", method)
}

func (o *OPStorage) TokenRequestByRefreshToken(ctx context.Context, refreshToken string) (_ op.RefreshTokenRequest, err error) {
	panic("TokenRequestByRefreshToken should not be called anymore. This is a bug. Please report https://github.com/zitadel/zitadel/issues")
}

func (o *OPStorage) TerminateSession(ctx context.Context, userID, clientID string) (err error) {
	_, err = o.terminateSession(ctx, userID)
	return err
}

func (o *OPStorage) terminateSession(ctx context.Context, userID string) (sessions []command.HumanSignOutSession, err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()
	userAgentID, ok := middleware.UserAgentIDFromCtx(ctx)
	if !ok {
		logging.Error("no user agent id")
		return nil, zerrors.ThrowPreconditionFailed(nil, "OIDC-fso7F", "no user agent id")
	}
	sessions, err = o.repo.UserSessionsByAgentID(ctx, userAgentID)
	if err != nil {
		logging.WithError(err).Error("error retrieving user sessions")
		return nil, err
	}
	if len(sessions) == 0 {
		return nil, nil
	}
	data := authz.CtxData{
		UserID: userID,
	}
	err = o.command.HumansSignOut(authz.SetCtxData(ctx, data), userAgentID, sessions)
	logging.OnError(err).Error("error signing out")
	return sessions, err
}

func (o *OPStorage) TerminateSessionFromRequest(ctx context.Context, endSessionRequest *op.EndSessionRequest) (redirectURI string, err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()

	// Without an ID token hint, Login V2 selects the session to terminate.
	if endSessionRequest.IDTokenHintClaims == nil {
		redirectURI := v2PostLogoutRedirectURI(endSessionRequest.RedirectURI)
		logoutURI := authz.GetFeatures(ctx).LoginV2.BaseURI
		// if no logout uri is set, fallback to the default configured in the runtime config
		if logoutURI == nil || logoutURI.String() == "" {
			logoutURI, err = url.Parse(o.defaultLogoutURLV2)
			if err != nil {
				return "", err
			}
		} else {
			logoutURI = logoutURI.JoinPath(LogoutPath)
		}
		signer, _, err := sign.GetSignerOnce(o.query.GetActiveSigningWebKey)(ctx)
		if err != nil {
			return "", err
		}
		return buildLoginV2LogoutURL(logoutURI, redirectURI, endSessionRequest.LogoutHint, endSessionRequest.UILocales, signer)
	}

	// End existing legacy sessions locally. The removed Login V1 UI no longer
	// performs upstream identity-provider logout for those sessions.
	if endSessionRequest.IDTokenHintClaims.SessionID == "" {
		_, err := o.terminateSession(ctx, endSessionRequest.UserID)
		if err != nil {
			return "", err
		}
		return endSessionRequest.RedirectURI, nil
	}

	// V1:
	// If the sessionID is prefixed by V1, we also terminate a v1 session, but based on the SingleV1SessionTermination feature flag,
	// we either terminate all sessions of the user agent or only the specific session
	if strings.HasPrefix(endSessionRequest.IDTokenHintClaims.SessionID, handler.IDPrefixV1) {
		err = o.terminateV1Session(ctx, endSessionRequest.UserID, endSessionRequest.IDTokenHintClaims.SessionID)
		if err != nil {
			return "", err
		}
		return endSessionRequest.RedirectURI, nil
	}

	// V2:
	// Terminate the v2 session of the id_token_hint
	_, err = o.command.TerminateSessionWithoutTokenCheck(ctx, endSessionRequest.IDTokenHintClaims.SessionID)
	if err != nil {
		return "", err
	}
	return v2PostLogoutRedirectURI(endSessionRequest.RedirectURI), nil
}

type logoutTokenPayload struct {
	PostLogoutRedirectURI string       `json:"post_logout_redirect_uri,omitempty"`
	LogoutHint            string       `json:"logout_hint,omitempty"`
	UILocales             oidc.Locales `json:"ui_locales,omitempty"`
}

func buildLoginV2LogoutURL(logoutURI *url.URL, redirectURI, logoutHint string, uiLocales oidc.Locales, signer jose.Signer) (string, error) {
	if strings.HasSuffix(logoutURI.Path, "/") && len(logoutURI.Path) > 1 {
		logoutURI.Path = strings.TrimSuffix(logoutURI.Path, "/")
	}

	q := logoutURI.Query()
	q.Set(LoginPostLogoutRedirectParam, redirectURI)
	if logoutHint != "" {
		q.Set(LoginLogoutHintParam, logoutHint)
	}
	if len(uiLocales) > 0 {
		q.Set(LoginUILocalesParam, uiLocales.String())
	}
	logoutToken, err := crypto.Sign(&logoutTokenPayload{
		PostLogoutRedirectURI: redirectURI,
		LogoutHint:            logoutHint,
		UILocales:             uiLocales,
	}, signer)
	if err != nil {
		return "", err
	}
	q.Set(LoginLogoutTokenParam, logoutToken)
	logoutURI.RawQuery = q.Encode()
	return logoutURI.String(), nil
}

// v2PostLogoutRedirectURI makes the default destination relative to the Login V2 base URI.
func v2PostLogoutRedirectURI(redirectURI string) string {
	if redirectURI != login.DefaultLoggedOutPath {
		return redirectURI
	}
	return LogoutDonePath
}

// terminateV1Session terminates "v1" sessions created through the login UI.
// Depending on the flag, we either terminate a single session or all of the user agent
func (o *OPStorage) terminateV1Session(ctx context.Context, userID, sessionID string) error {
	ctx = authz.SetCtxData(ctx, authz.CtxData{UserID: userID})
	// if the flag is active we only terminate the specific session
	if authz.GetFeatures(ctx).OIDCSingleV1SessionTermination {
		userAgentID, err := o.repo.UserAgentIDBySessionID(ctx, sessionID)
		if err != nil {
			return err
		}
		return o.command.HumansSignOut(ctx, userAgentID, []command.HumanSignOutSession{{ID: sessionID, UserID: userID}})
	}
	// otherwise we search for all active sessions within the same user agent of the current session id
	userAgentID, sessions, err := o.repo.ActiveUserSessionsBySessionID(ctx, sessionID)
	if err != nil {
		logging.WithError(err).Error("error retrieving user sessions")
		return err
	}
	if len(sessions) == 0 {
		return nil
	}
	return o.command.HumansSignOut(ctx, userAgentID, sessions)
}

func (o *OPStorage) RevokeToken(ctx context.Context, token, userID, clientID string) (err *oidc.Error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		// check for nil, because `err` is not an error and EndWithError would panic
		if err == nil {
			span.End()
			return
		}
		span.EndWithError(err)
	}()

	if strings.HasPrefix(token, command.IDPrefixV2) {
		err := o.command.RevokeOIDCSessionToken(ctx, token, clientID)
		if err == nil {
			return nil
		}
		if zerrors.IsPreconditionFailed(err) {
			return oidc.ErrInvalidClient().WithDescription("token was not issued for this client")
		}
		return oidc.ErrServerError().WithParent(err).WithReturnParentToClient(authz.GetFeatures(ctx).DebugOIDCParentError)
	}

	return o.revokeTokenV1(ctx, token, userID, clientID)
}

func (o *OPStorage) revokeTokenV1(ctx context.Context, token, userID, clientID string) *oidc.Error {
	refreshToken, err := o.repo.RefreshTokenByID(ctx, token, userID)
	if err == nil {
		if refreshToken.ClientID != clientID {
			return oidc.ErrInvalidClient().WithDescription("token was not issued for this client")
		}
		_, err = o.command.RevokeRefreshToken(ctx, refreshToken.UserID, refreshToken.ResourceOwner, refreshToken.ID)
		if err == nil || zerrors.IsNotFound(err) {
			return nil
		}
		return oidc.ErrServerError().WithParent(err).WithReturnParentToClient(authz.GetFeatures(ctx).DebugOIDCParentError)
	}
	accessToken, err := o.repo.TokenByIDs(ctx, userID, token)
	if err != nil {
		if zerrors.IsNotFound(err) {
			return nil
		}
		return oidc.ErrServerError().WithParent(err).WithReturnParentToClient(authz.GetFeatures(ctx).DebugOIDCParentError)
	}
	if accessToken.ApplicationID != clientID {
		return oidc.ErrInvalidClient().WithDescription("token was not issued for this client")
	}
	_, err = o.command.RevokeAccessToken(ctx, userID, accessToken.ResourceOwner, accessToken.ID)
	if err == nil || zerrors.IsNotFound(err) {
		return nil
	}
	return oidc.ErrServerError().WithParent(err).WithReturnParentToClient(authz.GetFeatures(ctx).DebugOIDCParentError)
}

func (o *OPStorage) GetRefreshTokenInfo(ctx context.Context, clientID string, token string) (userID string, tokenID string, err error) {
	ctx, span := tracing.NewSpan(ctx)
	defer func() {
		err = oidcError(ctx, err)
		span.EndWithError(err)
	}()

	plainToken, err := o.authAlg.DecryptToken(token)
	if err != nil {
		return "", "", op.ErrInvalidRefreshToken
	}
	if strings.HasPrefix(plainToken, command.IDPrefixV2) {
		oidcSession, err := o.command.OIDCSessionByRefreshToken(ctx, plainToken)
		if err != nil {
			return "", "", op.ErrInvalidRefreshToken
		}
		return oidcSession.UserID, oidcSession.OIDCRefreshTokenID(oidcSession.RefreshTokenID), nil
	}
	refreshToken, err := o.repo.RefreshTokenByToken(ctx, token)
	if err != nil {
		return "", "", op.ErrInvalidRefreshToken
	}
	if refreshToken.ClientID != clientID {
		return "", "", oidc.ErrInvalidClient().WithDescription("token was not issued for this client")
	}
	return refreshToken.UserID, refreshToken.ID, nil
}

// assertOrgScope checks the scopes for organization scopes and returns the orgID if exactly one org scope is found.
// If multiple org scopes are found or if the org scope is invalid, an error is returned.
// For backwards compatibility, we support both orgID and orgDomain scopes, but they need to be consistent,
// meaning that if both are provided, they need to belong to the same organization.
func (o *OPStorage) assertOrgScope(ctx context.Context, scopes []string) (string, error) {
	var id string
	for _, scope := range scopes {
		if orgID, ok := strings.CutPrefix(scope, domain.OrgIDScope); ok {
			org, err := o.query.OrgByID(ctx, orgID)
			if err != nil {
				return "", err
			}
			if id != "" && id != org.ID {
				return "", oidc.ErrInvalidScope().WithDescription("Only one organization scope may be provided")
			}
			id = org.ID
			continue
		}

		if orgDomain, ok := strings.CutPrefix(scope, domain.OrgDomainPrimaryScope); ok {
			org, err := o.query.OrgByPrimaryDomain(ctx, orgDomain)
			if err != nil {
				return "", err
			}
			if id != "" && id != org.ID {
				return "", oidc.ErrInvalidScope().WithDescription("Only one organization scope may be provided")
			}
			id = org.ID
		}
	}
	return id, nil
}

func (o *OPStorage) assertProjectRoleScopesByProject(ctx context.Context, project *query.Project, scopes []string) ([]string, error) {
	for _, scope := range scopes {
		if strings.HasPrefix(scope, ScopeProjectRolePrefix) {
			return scopes, nil
		}
	}
	if !project.ProjectRoleAssertion {
		return scopes, nil
	}
	projectIDQuery, err := query.NewProjectRoleProjectIDSearchQuery(project.ID)
	if err != nil {
		return nil, zerrors.ThrowInternal(err, "OIDC-Cyc78", "Errors.Internal")
	}
	roles, err := o.query.SearchProjectRoles(ctx, true, &query.ProjectRoleSearchQueries{Queries: []query.SearchQuery{projectIDQuery}}, nil)
	if err != nil {
		return nil, err
	}
	for _, role := range roles.ProjectRoles {
		scopes = append(scopes, ScopeProjectRolePrefix+role.Key)
	}
	return scopes, nil
}

func setContextUserSystem(ctx context.Context) context.Context {
	data := authz.CtxData{
		UserID: "SYSTEM",
	}
	return authz.SetCtxData(ctx, data)
}

func CreateErrorCallbackURL(authReq op.AuthRequest, reason, description, uri string, authorizer op.Authorizer) (string, error) {
	e := struct {
		Error       string `schema:"error"`
		Description string `schema:"error_description,omitempty"`
		URI         string `schema:"error_uri,omitempty"`
		State       string `schema:"state,omitempty"`
	}{
		Error:       reason,
		Description: description,
		URI:         uri,
		State:       authReq.GetState(),
	}
	callback, err := op.AuthResponseURL(authReq.GetRedirectURI(), authReq.GetResponseType(), authReq.GetResponseMode(), e, authorizer.Encoder())
	if err != nil {
		return "", err
	}
	return callback, nil
}

func CreateCodeCallbackURL(ctx context.Context, authReq op.AuthRequest, authorizer op.Authorizer) (string, error) {
	code, err := op.CreateAuthRequestCode(ctx, authReq, authorizer.Storage(), authorizer.Crypto())
	if err != nil {
		return "", err
	}
	codeResponse := struct {
		code  string
		state string
	}{
		code:  code,
		state: authReq.GetState(),
	}
	return op.AuthResponseURL(authReq.GetRedirectURI(), authReq.GetResponseType(), authReq.GetResponseMode(), &codeResponse, authorizer.Encoder())
}

func (s *Server) CreateTokenCallbackURL(ctx context.Context, req op.AuthRequest) (string, error) {
	provider := s.Provider()
	opClient, err := provider.Storage().GetClientByClientID(ctx, req.GetClientID())
	if err != nil {
		return "", err
	}
	client, ok := opClient.(*Client)
	if !ok {
		return "", zerrors.ThrowInternal(nil, "OIDC-waeN6", "Error.Internal")
	}

	session, state, err := s.command.CreateOIDCSessionFromAuthRequest(
		setContextUserSystem(ctx),
		req.GetID(),
		implicitFlowComplianceChecker(),
		slices.Contains(client.GrantTypes(), oidc.GrantTypeRefreshToken),
		client.client.BackChannelLogoutURI,
	)
	if err != nil {
		return "", err
	}
	resp, err := s.accessTokenResponseFromSession(ctx, client, session, state, client.client.ProjectID, client.client.ProjectRoleAssertion, client.client.AccessTokenRoleAssertion, client.client.IDTokenRoleAssertion, client.client.IDTokenUserinfoAssertion)
	if err != nil {
		return "", err
	}
	callback, err := op.AuthResponseURL(req.GetRedirectURI(), req.GetResponseType(), req.GetResponseMode(), resp, provider.Encoder())
	if err != nil {
		return "", err
	}
	return callback, err
}

func implicitFlowComplianceChecker() command.AuthRequestComplianceChecker {
	return func(_ context.Context, authReq *command.AuthRequestWriteModel) error {
		if err := authReq.CheckAuthenticated(); err != nil {
			return err
		}
		return nil
	}
}

func (s *Server) authorizeCallbackHandler(w http.ResponseWriter, r *http.Request) {
	authorizer := s.Provider()
	authReq, err := func(ctx context.Context) (authReq *AuthRequest, err error) {
		ctx, span := tracing.NewSpan(ctx)
		r = r.WithContext(ctx)
		defer func() { span.EndWithError(err) }()

		id, err := op.ParseAuthorizeCallbackRequest(r)
		if err != nil {
			return nil, err
		}
		authReq, err = s.getAuthRequestV1ByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if !authReq.Done() {
			return authReq, oidc.ErrInteractionRequired().WithDescription("Unfortunately, the user may be not logged in and/or additional interaction is required.")
		}
		return authReq, s.authResponse(authReq, authorizer, w, r)
	}(r.Context())
	if err != nil {
		// we need to make sure there's no empty interface passed
		if authReq == nil {
			op.AuthRequestError(w, r, nil, err, authorizer)
			return
		}
		op.AuthRequestError(w, r, authReq, err, authorizer)
	}
}

func (s *Server) authResponse(authReq *AuthRequest, authorizer op.Authorizer, w http.ResponseWriter, r *http.Request) (err error) {
	ctx, span := tracing.NewSpan(r.Context())
	r = r.WithContext(ctx)
	defer func() { span.EndWithError(err) }()

	client, err := authorizer.Storage().GetClientByClientID(ctx, authReq.GetClientID())
	if err != nil {
		op.AuthRequestError(w, r, authReq, err, authorizer)
		return err
	}
	if authReq.GetResponseType() == oidc.ResponseTypeCode {
		op.AuthResponseCode(w, r, authReq, authorizer)
		return nil
	}
	return s.authResponseToken(authReq, authorizer, client, w, r)
}

func (s *Server) authResponseToken(authReq *AuthRequest, authorizer op.Authorizer, opClient op.Client, w http.ResponseWriter, r *http.Request) (err error) {
	ctx, span := tracing.NewSpan(r.Context())
	r = r.WithContext(ctx)
	defer func() { span.EndWithError(err) }()

	client, ok := opClient.(*Client)
	if !ok {
		return zerrors.ThrowInternal(nil, "OIDC-waeN6", "Error.Internal")
	}

	scope := authReq.GetScopes()
	session, err := s.command.CreateOIDCSession(ctx,
		authReq.UserID,
		authReq.UserOrgID,
		client.client.ClientID,
		client.client.BackChannelLogoutURI,
		scope,
		authReq.Audience,
		authReq.AuthMethods(),
		authReq.AuthTime,
		authReq.GetNonce(),
		authReq.PreferredLanguage,
		authReq.ToUserAgent(),
		domain.TokenReasonAuthRequest,
		nil,
		slices.Contains(scope, oidc.ScopeOfflineAccess),
		authReq.SessionID,
		authReq.oidc().ResponseType,
	)
	if err != nil {
		op.AuthRequestError(w, r, authReq, err, authorizer)
		return err
	}
	resp, err := s.accessTokenResponseFromSession(ctx, client, session, authReq.GetState(), client.client.ProjectID, client.client.ProjectRoleAssertion, client.client.AccessTokenRoleAssertion, client.client.IDTokenRoleAssertion, client.client.IDTokenUserinfoAssertion)
	if err != nil {
		op.AuthRequestError(w, r, authReq, err, authorizer)
		return err
	}

	if authReq.GetResponseMode() == oidc.ResponseModeFormPost {
		if err = op.AuthResponseFormPost(w, authReq.GetRedirectURI(), resp, authorizer.Encoder()); err != nil {
			op.AuthRequestError(w, r, authReq, err, authorizer)
			return err
		}
		return nil
	}

	callback, err := op.AuthResponseURL(authReq.GetRedirectURI(), authReq.GetResponseType(), authReq.GetResponseMode(), resp, authorizer.Encoder())
	if err != nil {
		op.AuthRequestError(w, r, authReq, err, authorizer)
		return err
	}
	http.Redirect(w, r, callback, http.StatusFound)
	return nil
}
