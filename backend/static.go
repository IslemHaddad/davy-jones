package main

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

// The built frontend (npm run build -> web/dist) is embedded directly into
// the binary, so production deployment is a single file. web/dist always
// contains at least a placeholder index.html (see web/dist/index.html) so
// this compiles before the real frontend has ever been built.
//
//go:embed web/dist
var embeddedFrontend embed.FS

func staticHandler() http.Handler {
	sub, err := fs.Sub(embeddedFrontend, "web/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(sub, path); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// Not a real asset (or the root path): fall back to index.html for
		// client-side routing. Served directly via http.ServeContent rather
		// than routing back through http.FileServer, which special-cases
		// any path ending in "index.html" with a redirect to "./".
		serveIndex(w, r, sub)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	f, err := sub.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	rs, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "index.html is not seekable", http.StatusInternalServerError)
		return
	}

	http.ServeContent(w, r, "index.html", stat.ModTime(), rs)
}
