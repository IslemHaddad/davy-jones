package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Storage struct {
	mu      sync.RWMutex
	dataDir string
}

func NewStorage(dataDir string) (*Storage, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	return &Storage{dataDir: dataDir}, nil
}

func (s *Storage) readJSON(filename string, v interface{}) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	filePath := filepath.Join(s.dataDir, filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func (s *Storage) writeJSON(filename string, v interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	filePath := filepath.Join(s.dataDir, filename)
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

// readEncrypted and writeEncrypted back the four infrastructure resource
// types (VPNs, hosts, services, credentials): SSH passwords/private keys,
// network topology, and gateway addresses are all sensitive, so these are
// the only files ever written encrypted-at-rest. The key comes from the
// request context, attached by the requireUnsealed middleware -- if the
// process is sealed, callers never reach here.
func (s *Storage) readEncrypted(filename string, key []byte, v interface{}) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	filePath := filepath.Join(s.dataDir, filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil
	}
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	plain, err := decryptWithKey(key, raw)
	if err != nil {
		return fmt.Errorf("decrypt %s: %w", filename, err)
	}
	return json.Unmarshal(plain, v)
}

func (s *Storage) writeEncrypted(filename string, key []byte, v interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	plain, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	cipherBytes, err := encryptWithKey(key, plain)
	if err != nil {
		return err
	}
	filePath := filepath.Join(s.dataDir, filename)
	return os.WriteFile(filePath, cipherBytes, 0600)
}

func sealKey(ctx context.Context) ([]byte, error) {
	return sealKeyFromContext(ctx)
}

// VPN Storage
func (s *Storage) GetVpns(ctx context.Context) ([]Vpn, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var vpns []Vpn
	err = s.readEncrypted("vpns.json", key, &vpns)
	if vpns == nil {
		vpns = []Vpn{}
	}
	return vpns, err
}

func (s *Storage) SaveVpns(ctx context.Context, vpns []Vpn) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("vpns.json", key, vpns)
}

// Host Storage
func (s *Storage) GetHosts(ctx context.Context) ([]Host, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var hosts []Host
	err = s.readEncrypted("hosts.json", key, &hosts)
	if hosts == nil {
		hosts = []Host{}
	}
	return hosts, err
}

func (s *Storage) SaveHosts(ctx context.Context, hosts []Host) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("hosts.json", key, hosts)
}

// Service Storage
func (s *Storage) GetServices(ctx context.Context) ([]Service, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var services []Service
	err = s.readEncrypted("services.json", key, &services)
	if services == nil {
		services = []Service{}
	}
	return services, err
}

func (s *Storage) SaveServices(ctx context.Context, services []Service) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("services.json", key, services)
}

// Credential Storage
func (s *Storage) GetCredentials(ctx context.Context) ([]Credential, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var credentials []Credential
	err = s.readEncrypted("credentials.json", key, &credentials)
	if credentials == nil {
		credentials = []Credential{}
	}
	return credentials, err
}

func (s *Storage) SaveCredentials(ctx context.Context, credentials []Credential) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("credentials.json", key, credentials)
}

// Project Storage
func (s *Storage) GetProjects(ctx context.Context) ([]Project, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var projects []Project
	err = s.readEncrypted("projects.json", key, &projects)
	if projects == nil {
		projects = []Project{}
	}
	return projects, err
}

func (s *Storage) SaveProjects(ctx context.Context, projects []Project) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("projects.json", key, projects)
}

// GraphLayout Storage
func (s *Storage) GetLayouts(ctx context.Context) ([]GraphLayout, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var layouts []GraphLayout
	err = s.readEncrypted("layouts.json", key, &layouts)
	if layouts == nil {
		layouts = []GraphLayout{}
	}
	return layouts, err
}

func (s *Storage) SaveLayouts(ctx context.Context, layouts []GraphLayout) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("layouts.json", key, layouts)
}

// SavedCommand Storage
func (s *Storage) GetSavedCommands(ctx context.Context) ([]SavedCommand, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var cmds []SavedCommand
	err = s.readEncrypted("saved_commands.json", key, &cmds)
	if cmds == nil {
		cmds = []SavedCommand{}
	}
	return cmds, err
}

func (s *Storage) SaveSavedCommands(ctx context.Context, cmds []SavedCommand) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("saved_commands.json", key, cmds)
}

// AdminConfig Storage -- legacy single-admin login, retired in favor of
// User/users.json below. Kept read-only so AuthManager can migrate an
// existing install's password hash into a real user account on first
// contact after upgrade; nothing writes admin.json anymore.
func (s *Storage) GetAdminConfig(ctx context.Context) (AdminConfig, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return AdminConfig{}, err
	}
	var cfg AdminConfig
	err = s.readEncrypted("admin.json", key, &cfg)
	return cfg, err
}

// User Storage -- encrypted like the rest of the sensitive data. Multiple
// users are supported with no role distinction (see User's doc comment).
func (s *Storage) GetUsers(ctx context.Context) ([]User, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return nil, err
	}
	var users []User
	err = s.readEncrypted("users.json", key, &users)
	if users == nil {
		users = []User{}
	}
	return users, err
}

func (s *Storage) SaveUsers(ctx context.Context, users []User) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	return s.writeEncrypted("users.json", key, users)
}

// SealConfig Storage -- also unencrypted (it's the config that describes how
// to unseal in the first place; it contains no secret material, only a
// verification value).
func (s *Storage) GetSealConfig() (SealConfig, error) {
	var cfg SealConfig
	err := s.readJSON("seal.json", &cfg)
	return cfg, err
}

func (s *Storage) SaveSealConfig(cfg SealConfig) error {
	return s.writeJSON("seal.json", cfg)
}
