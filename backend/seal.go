package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"

	"github.com/hashicorp/vault/shamir"
)

// sealCheckPlaintext is encrypted with the master key at initialization time
// and stored alongside the (non-secret) seal config. On unseal, decrypting
// it successfully is how we verify the submitted shares reconstructed the
// *correct* key, without ever persisting the key itself.
const sealCheckPlaintext = "davy-jones-unseal-check-v1"

// SealConfig is the only seal-related state persisted to disk. It never
// contains the master key or any share -- both live in memory only, for
// as long as the process stays unsealed.
type SealConfig struct {
	Initialized bool   `json:"initialized"`
	Threshold   int    `json:"threshold"`
	TotalShares int    `json:"totalShares"`
	CheckValue  string `json:"checkValue"` // base64(AES-GCM(masterKey, sealCheckPlaintext))
}

type SealManager struct {
	mu            sync.RWMutex
	storage       *Storage
	config        SealConfig
	masterKey     []byte   // nil while sealed
	pendingShares [][]byte // accumulated toward threshold; reset on success/failure
}

func NewSealManager(storage *Storage) (*SealManager, error) {
	cfg, err := storage.GetSealConfig()
	if err != nil {
		return nil, err
	}
	return &SealManager{storage: storage, config: cfg}, nil
}

type SealStatus struct {
	Initialized bool `json:"initialized"`
	Sealed      bool `json:"sealed"`
	Progress    int  `json:"progress"`
	Threshold   int  `json:"threshold"`
	TotalShares int  `json:"totalShares"`
}

func (sm *SealManager) Status() SealStatus {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return SealStatus{
		Initialized: sm.config.Initialized,
		Sealed:      sm.masterKey == nil,
		Progress:    len(sm.pendingShares),
		Threshold:   sm.config.Threshold,
		TotalShares: sm.config.TotalShares,
	}
}

// Initialize generates a new master key, splits it into totalShares Shamir
// shares (any threshold of which reconstruct it), and persists only a
// verification value -- never the key or the shares. The returned shares
// must be shown to the caller exactly once; the server does not retain them.
func (sm *SealManager) Initialize(totalShares, threshold int) ([]string, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.config.Initialized {
		return nil, errors.New("already initialized")
	}
	if threshold < 1 || totalShares < threshold {
		return nil, errors.New("invalid share threshold configuration")
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}

	shares, err := shamir.Split(key, totalShares, threshold)
	if err != nil {
		return nil, fmt.Errorf("split key: %w", err)
	}

	checkValue, err := encryptWithKey(key, []byte(sealCheckPlaintext))
	if err != nil {
		return nil, err
	}

	sm.config = SealConfig{
		Initialized: true,
		Threshold:   threshold,
		TotalShares: totalShares,
		CheckValue:  base64.StdEncoding.EncodeToString(checkValue),
	}
	if err := sm.storage.SaveSealConfig(sm.config); err != nil {
		sm.config = SealConfig{}
		return nil, err
	}

	// Require the operator to immediately re-submit `threshold` of these
	// shares (mirrors Vault's `init` + `unseal` split) rather than
	// auto-unsealing, so a share display bug can't go unnoticed.
	sm.masterKey = nil
	sm.pendingShares = nil

	encoded := make([]string, len(shares))
	for i, s := range shares {
		encoded[i] = base64.StdEncoding.EncodeToString(s)
	}
	return encoded, nil
}

// SubmitShare adds one share toward the unseal threshold. Returns true once
// enough shares have been submitted and they correctly reconstruct the key.
func (sm *SealManager) SubmitShare(encodedShare string) (bool, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.masterKey != nil {
		return true, nil
	}
	if !sm.config.Initialized {
		return false, errors.New("not initialized")
	}

	share, err := base64.StdEncoding.DecodeString(encodedShare)
	if err != nil {
		return false, errors.New("invalid share encoding")
	}
	for _, existing := range sm.pendingShares {
		if bytes.Equal(existing, share) {
			return false, errors.New("share already submitted")
		}
	}
	sm.pendingShares = append(sm.pendingShares, share)

	if len(sm.pendingShares) < sm.config.Threshold {
		return false, nil
	}

	candidate, err := shamir.Combine(sm.pendingShares)
	if err != nil {
		sm.pendingShares = nil
		return false, fmt.Errorf("failed to reconstruct key: %w", err)
	}

	checkBytes, err := base64.StdEncoding.DecodeString(sm.config.CheckValue)
	if err != nil {
		sm.pendingShares = nil
		return false, err
	}
	plain, err := decryptWithKey(candidate, checkBytes)
	if err != nil || string(plain) != sealCheckPlaintext {
		sm.pendingShares = nil
		return false, errors.New("shares did not reconstruct the correct key")
	}

	sm.masterKey = candidate
	sm.pendingShares = nil
	return true, nil
}

// Reseal drops the in-memory master key. There is no HTTP route for this
// today (a process restart already reseals), but it's here so one can be
// added without touching the rest of the seal machinery.
func (sm *SealManager) Reseal() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.masterKey = nil
	sm.pendingShares = nil
}

// Key returns the live master key, or an error if still sealed.
func (sm *SealManager) Key() ([]byte, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if sm.masterKey == nil {
		return nil, errors.New("sealed")
	}
	return sm.masterKey, nil
}

type sealKeyCtxKey struct{}

func withSealKey(ctx context.Context, key []byte) context.Context {
	return context.WithValue(ctx, sealKeyCtxKey{}, key)
}

func sealKeyFromContext(ctx context.Context) ([]byte, error) {
	key, ok := ctx.Value(sealKeyCtxKey{}).([]byte)
	if !ok {
		return nil, errors.New("sealed")
	}
	return key, nil
}
