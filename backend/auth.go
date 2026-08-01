package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type AuthManager struct {
	storage    *Storage
	mu         sync.Mutex
	sessions   map[string]time.Time
	sessionTTL time.Duration
}

func NewAuthManager(storage *Storage, sessionTTL time.Duration) *AuthManager {
	return &AuthManager{
		storage:    storage,
		sessions:   make(map[string]time.Time),
		sessionTTL: sessionTTL,
	}
}

// IsSetup checks if admin password has already been set. Requires the seal
// to be open -- the admin config is encrypted along with everything else.
func (am *AuthManager) IsSetup(ctx context.Context) (bool, error) {
	cfg, err := am.storage.GetAdminConfig(ctx)
	if err != nil {
		return false, err
	}
	return cfg.IsSetup, nil
}

// SetupAdmin sets up the initial admin password. Only reachable once the
// seal has already been initialized and unsealed (see seal.go) -- there is
// nothing to encrypt the password hash with otherwise.
func (am *AuthManager) SetupAdmin(ctx context.Context, password string) error {
	if len(password) < 6 {
		return errors.New("password must be at least 6 characters long")
	}

	isSetup, err := am.IsSetup(ctx)
	if err != nil {
		return err
	}
	if isSetup {
		return errors.New("admin password has already been setup")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	cfg := AdminConfig{
		PasswordHash: string(hashed),
		IsSetup:      true,
	}

	return am.storage.SaveAdminConfig(ctx, cfg)
}

// Login verifies the admin password and returns a session token if successful
func (am *AuthManager) Login(ctx context.Context, password string) (string, error) {
	cfg, err := am.storage.GetAdminConfig(ctx)
	if err != nil {
		return "", err
	}
	if !cfg.IsSetup {
		return "", errors.New("admin password has not been setup yet")
	}

	err = bcrypt.CompareHashAndPassword([]byte(cfg.PasswordHash), []byte(password))
	if err != nil {
		return "", errors.New("invalid admin password")
	}

	am.mu.Lock()
	defer am.mu.Unlock()

	token := am.generateSessionToken()
	am.sessions[token] = time.Now().Add(am.sessionTTL)

	return token, nil
}

// ValidateSession verifies if a token is valid and not expired
func (am *AuthManager) ValidateSession(token string) bool {
	if token == "" {
		return false
	}

	am.mu.Lock()
	defer am.mu.Unlock()

	expiry, exists := am.sessions[token]
	if !exists {
		return false
	}

	if time.Now().After(expiry) {
		delete(am.sessions, token)
		return false
	}

	// Extend session on activity
	am.sessions[token] = time.Now().Add(am.sessionTTL)
	return true
}

// Logout invalidates a session token
func (am *AuthManager) Logout(token string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	delete(am.sessions, token)
}

func (am *AuthManager) generateSessionToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		// fallback to timestamp if rand fails
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(b)
}
