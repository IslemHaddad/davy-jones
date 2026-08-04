package main

import (
	"net/http"
	"net/url"
	"strings"
)

// securityHeaders wraps the whole mux so every response -- API JSON, static
// assets and the SPA shell alike -- carries the baseline browser hardening
// headers. It sits outermost in main.go, ahead of any auth middleware, so
// even error and 404 responses are covered.
func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		head := w.Header()
		head.Set("X-Content-Type-Options", "nosniff")
		head.Set("X-Frame-Options", "DENY")
		head.Set("Referrer-Policy", "no-referrer")
		// This is an infrastructure console: it has no use for any of the
		// powerful browser APIs, so deny them outright rather than leave
		// them available to injected script.
		head.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
		head.Set("Content-Security-Policy", contentSecurityPolicy(r))
		h.ServeHTTP(w, r)
	})
}

// contentSecurityPolicy is built per-request because connect-src has to name
// the WebSocket origin explicitly: 'self' covers same-origin http(s) fetches,
// but ws:// and wss:// are separate schemes that older browsers do not fold
// into 'self', and the terminal would silently fail to connect there.
//
// style-src keeps 'unsafe-inline' because React (and React Flow's transform
// styles in particular) sets style attributes on nearly every node; that is
// inline *style*, not inline script, and script-src stays strict.
func contentSecurityPolicy(r *http.Request) string {
	host := r.Host
	directives := []string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self' ws://" + host + " wss://" + host,
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}
	return strings.Join(directives, "; ")
}

// sameOriginWS is the CheckOrigin for the terminal WebSocket. The session
// token is still the real gate (it arrives in the first WS message, since
// browsers can't attach an Authorization header to a WebSocket handshake),
// but rejecting foreign origins stops a page the operator merely *visits*
// from opening a socket to this server at all.
//
// A missing Origin header means a non-browser client (curl, a script, the
// Go tests) -- those are not subject to the ambient-credential problem
// origin checks exist to solve, so they are allowed through to the token
// check like any other unauthenticated caller.
func sameOriginWS(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	// Dev runs the Vite server on its own port and proxies /api here, so the
	// browser's Origin never matches this server's Host. DJ_ALLOWED_ORIGINS
	// (comma-separated, e.g. "http://localhost:5173") opts those in.
	for _, allowed := range cfg.AllowedOrigins {
		if strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}
