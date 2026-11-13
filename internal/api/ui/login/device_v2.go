package login

import "net/http"

// RedirectDeviceAuthorization sends the device verification entry point to Login V2.
// It never creates a legacy authentication request or accepts a form submission.
func (c *DefaultPaths) RedirectDeviceAuthorization(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	uri := c.defaultBaseURL(r.Context()).JoinPath(EndpointDeviceAuth)
	query := uri.Query()
	if userCode := r.URL.Query().Get("user_code"); userCode != "" {
		query.Set("user_code", userCode)
	}
	uri.RawQuery = query.Encode()
	http.Redirect(w, r, uri.String(), http.StatusFound)
}
