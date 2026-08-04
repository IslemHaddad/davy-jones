package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config centralizes every runtime-tunable value so production deployments
// can override behavior with environment variables instead of edited code.
type Config struct {
	Host string
	Port int

	DataDir string

	// AllowedOrigins lets the terminal WebSocket accept handshakes from
	// origins other than this server's own (the Vite dev server, mainly).
	// Empty in production, where same-origin is the only legitimate case.
	AllowedOrigins []string

	SessionTTL time.Duration

	SSHPort        int
	SSHDialTimeout time.Duration

	TCPPingTimeout time.Duration

	DockerBin     string
	DockerTimeout time.Duration

	// UnsealShares/UnsealThreshold are only read once, at first-run setup,
	// to size the Shamir split -- changing them afterward has no effect on
	// an already-initialized seal config.
	UnsealShares    int
	UnsealThreshold int
}

func loadConfig() Config {
	return Config{
		Host:           getEnvString("DJ_HOST", "0.0.0.0"),
		Port:           getEnvInt("DJ_PORT", 8080),
		DataDir:        getEnvString("DJ_DATA_DIR", defaultDataDir()),
		AllowedOrigins: getEnvList("DJ_ALLOWED_ORIGINS"),
		SessionTTL:     getEnvSeconds("DJ_SESSION_TTL_SECONDS", 4*3600),
		SSHPort:        getEnvInt("DJ_SSH_PORT", 22),
		SSHDialTimeout: getEnvSeconds("DJ_SSH_DIAL_TIMEOUT_SECONDS", 8),
		TCPPingTimeout: getEnvSeconds("DJ_TCP_PING_TIMEOUT_SECONDS", 2),
		DockerBin:      getEnvString("DJ_DOCKER_BIN", "docker"),
		DockerTimeout:  getEnvSeconds("DJ_DOCKER_TIMEOUT_SECONDS", 15),

		UnsealShares:    getEnvInt("DJ_UNSEAL_SHARES", 5),
		UnsealThreshold: getEnvInt("DJ_UNSEAL_THRESHOLD", 3),
	}
}

// defaultDataDir follows the XDG base directory spec so installed packages
// (.deb, AppImage) write to a per-user location instead of next to the
// (often read-only, shared) executable.
func defaultDataDir() string {
	xdgDataHome := os.Getenv("XDG_DATA_HOME")
	if xdgDataHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		xdgDataHome = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(xdgDataHome, "davy-jones")
}

func getEnvString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getEnvList reads a comma-separated env var into a slice, dropping empty
// entries so a trailing comma or an unset variable both yield nothing.
func getEnvList(key string) []string {
	var out []string
	for _, part := range strings.Split(os.Getenv(key), ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: invalid %s=%q, using default %d\n", key, v, fallback)
		return fallback
	}
	return n
}

func getEnvSeconds(key string, fallbackSeconds int) time.Duration {
	return time.Duration(getEnvInt(key, fallbackSeconds)) * time.Second
}
