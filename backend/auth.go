package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// dummyPasswordHash is compared against on every failed-username login so a
// nonexistent username takes the same time as a wrong password for a real
// one -- bcrypt is deliberately slow, so skipping it when no user matches
// would otherwise let an unauthenticated caller enumerate valid usernames
// by timing responses.
var dummyPasswordHash = func() string {
	hash, err := bcrypt.GenerateFromPassword([]byte("dummy-password-for-constant-time-login"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return string(hash)
}()

// Session identifies who a live token belongs to, not just when it expires
// -- needed so every protected handler can attribute its action to a user
// (see withUser/userFromContext) for the audit log.
type Session struct {
	UserID   string
	Username string
	Expiry   time.Time
}

type AuthManager struct {
	storage    *Storage
	mu         sync.Mutex
	sessions   map[string]Session
	sessionTTL time.Duration

	migrateOnce sync.Once
	migrateErr  error
}

func NewAuthManager(storage *Storage, sessionTTL time.Duration) *AuthManager {
	return &AuthManager{
		storage:    storage,
		sessions:   make(map[string]Session),
		sessionTTL: sessionTTL,
	}
}

// ensureMigrated moves a pre-multi-user install's single admin password
// into the users store, exactly once. If admin.json shows a completed
// legacy setup and users.json is still empty, the existing bcrypt hash is
// carried over as-is (it's portable) under the username "admin" -- the
// operator keeps their existing password, they just now log in with a name
// attached to it. Requires the seal to already be open (both admin.json and
// users.json are encrypted).
func (am *AuthManager) ensureMigrated(ctx context.Context) error {
	am.migrateOnce.Do(func() {
		users, err := am.storage.GetUsers(ctx)
		if err != nil {
			am.migrateErr = err
			return
		}
		if len(users) > 0 {
			return
		}
		legacy, err := am.storage.GetAdminConfig(ctx)
		if err != nil {
			am.migrateErr = err
			return
		}
		if !legacy.IsSetup {
			return
		}
		admin := User{
			ID:           newID("user"),
			Username:     "admin",
			PasswordHash: legacy.PasswordHash,
			CreatedAt:    time.Now(),
		}
		am.migrateErr = am.storage.SaveUsers(ctx, []User{admin})
	})
	return am.migrateErr
}

// IsSetup checks if at least one user account exists. Requires the seal to
// be open -- user data is encrypted along with everything else.
func (am *AuthManager) IsSetup(ctx context.Context) (bool, error) {
	if err := am.ensureMigrated(ctx); err != nil {
		return false, err
	}
	users, err := am.storage.GetUsers(ctx)
	if err != nil {
		return false, err
	}
	return len(users) > 0, nil
}

func validateCredentials(username, password string) error {
	if strings.TrimSpace(username) == "" {
		return errors.New("username is required")
	}
	if len(username) > 64 {
		return errors.New("username must be at most 64 characters long")
	}
	if len(password) < 6 {
		return errors.New("password must be at least 6 characters long")
	}
	return nil
}

// CreateFirstUser sets up the very first account. Only reachable once the
// seal has already been initialized and unsealed -- there is nothing to
// encrypt the user store with otherwise.
func (am *AuthManager) CreateFirstUser(ctx context.Context, username, password string) (User, error) {
	isSetup, err := am.IsSetup(ctx)
	if err != nil {
		return User{}, err
	}
	if isSetup {
		return User{}, errors.New("a user account has already been created")
	}
	return am.createUserLocked(ctx, username, password, nil)
}

// CreateUser adds another account. Flat model -- any authenticated caller
// may call this, there is no admin/member distinction.
func (am *AuthManager) CreateUser(ctx context.Context, username, password string) (User, error) {
	users, err := am.storage.GetUsers(ctx)
	if err != nil {
		return User{}, err
	}
	return am.createUserLocked(ctx, username, password, users)
}

// createUserLocked does the actual validate+append+save. existing may be
// nil, in which case it's loaded fresh (used by CreateFirstUser, where the
// caller already knows the store is empty).
func (am *AuthManager) createUserLocked(ctx context.Context, username, password string, existing []User) (User, error) {
	if err := validateCredentials(username, password); err != nil {
		return User{}, err
	}
	username = strings.TrimSpace(username)

	users := existing
	if users == nil {
		var err error
		users, err = am.storage.GetUsers(ctx)
		if err != nil {
			return User{}, err
		}
	}
	for _, u := range users {
		if strings.EqualFold(u.Username, username) {
			return User{}, errors.New("username is already taken")
		}
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	u := User{
		ID:           newID("user"),
		Username:     username,
		PasswordHash: string(hashed),
		CreatedAt:    time.Now(),
	}
	users = append(users, u)
	if err := am.storage.SaveUsers(ctx, users); err != nil {
		return User{}, err
	}
	return u, nil
}

// ListUsers returns every account. Callers at the HTTP boundary are
// responsible for stripping PasswordHash before responding.
func (am *AuthManager) ListUsers(ctx context.Context) ([]User, error) {
	if err := am.ensureMigrated(ctx); err != nil {
		return nil, err
	}
	return am.storage.GetUsers(ctx)
}

// DeleteUser refuses to remove the last remaining account -- there must
// always be at least one way to log in. Also drops any of that user's live
// sessions so a deleted account can't keep acting through an old token.
func (am *AuthManager) DeleteUser(ctx context.Context, id string) error {
	users, err := am.storage.GetUsers(ctx)
	if err != nil {
		return err
	}
	if len(users) <= 1 {
		return errors.New("cannot delete the last remaining user")
	}
	out := users[:0]
	found := false
	for _, u := range users {
		if u.ID == id {
			found = true
			continue
		}
		out = append(out, u)
	}
	if !found {
		return errors.New("user not found")
	}
	if err := am.storage.SaveUsers(ctx, out); err != nil {
		return err
	}

	am.mu.Lock()
	defer am.mu.Unlock()
	for tok, sess := range am.sessions {
		if sess.UserID == id {
			delete(am.sessions, tok)
		}
	}
	return nil
}

// Login verifies a username/password pair and returns a session token if
// successful.
func (am *AuthManager) Login(ctx context.Context, username, password string) (string, User, error) {
	if err := am.ensureMigrated(ctx); err != nil {
		return "", User{}, err
	}
	users, err := am.storage.GetUsers(ctx)
	if err != nil {
		return "", User{}, err
	}
	if len(users) == 0 {
		return "", User{}, errors.New("no user accounts have been set up yet")
	}

	var match *User
	for i := range users {
		if strings.EqualFold(users[i].Username, username) {
			match = &users[i]
			break
		}
	}
	// Always run bcrypt, even against a dummy hash when no username matches,
	// so response time doesn't reveal whether the username exists.
	hash := dummyPasswordHash
	if match != nil {
		hash = match.PasswordHash
	}
	compareErr := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if match == nil || compareErr != nil {
		return "", User{}, errors.New("invalid username or password")
	}

	am.mu.Lock()
	defer am.mu.Unlock()

	token := am.generateSessionToken()
	am.sessions[token] = Session{
		UserID:   match.ID,
		Username: match.Username,
		Expiry:   time.Now().Add(am.sessionTTL),
	}

	return token, *match, nil
}

// ValidateSession verifies if a token is valid and not expired, returning
// the identity attached to it.
func (am *AuthManager) ValidateSession(token string) (Session, bool) {
	if token == "" {
		return Session{}, false
	}

	am.mu.Lock()
	defer am.mu.Unlock()

	sess, exists := am.sessions[token]
	if !exists {
		return Session{}, false
	}

	if time.Now().After(sess.Expiry) {
		delete(am.sessions, token)
		return Session{}, false
	}

	// Extend session on activity
	sess.Expiry = time.Now().Add(am.sessionTTL)
	am.sessions[token] = sess
	return sess, true
}

// SessionForToken looks up a live session without extending or requiring
// validity semantics beyond existence -- used by Logout to attribute the
// auth.logout audit entry before the token is deleted.
func (am *AuthManager) SessionForToken(token string) (Session, bool) {
	am.mu.Lock()
	defer am.mu.Unlock()
	sess, ok := am.sessions[token]
	return sess, ok
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

type userCtxKey struct{}

func withUser(ctx context.Context, userID, username string) context.Context {
	return context.WithValue(ctx, userCtxKey{}, Session{UserID: userID, Username: username})
}

func userFromContext(ctx context.Context) (userID, username string, ok bool) {
	sess, found := ctx.Value(userCtxKey{}).(Session)
	if !found {
		return "", "", false
	}
	return sess.UserID, sess.Username, true
}
