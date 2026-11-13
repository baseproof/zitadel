package login

import "net/http"

// RedirectToLogin sends the issuer root to the selected instance's Login V2 base.
// The V2 /login endpoint requires an authentication request; its base page also
// supports visiting the issuer directly without starting an OIDC or SAML flow.
func (c *DefaultPaths) RedirectToLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	http.Redirect(w, r, c.defaultBaseURL(r.Context()).String(), http.StatusFound)
}
