package main

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"strconv"

	"golang.org/x/crypto/ssh"
)

type SSHResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
	Error    string `json:"error,omitempty"`
}

// hostPort returns the host's configured SSH port, falling back to the
// global default (DJ_SSH_PORT, 22) when the host doesn't override it.
func hostPort(host Host) int {
	if host.Port > 0 {
		return host.Port
	}
	return cfg.SSHPort
}

func sshAuthMethod(cred Credential) (ssh.AuthMethod, error) {
	if cred.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(cred.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("invalid private key: %w", err)
		}
		return ssh.PublicKeys(signer), nil
	}
	if cred.Password != "" {
		return ssh.Password(cred.Password), nil
	}
	return nil, errors.New("credential has neither a password nor a private key")
}

// RunSSHCommand connects to the host's configured port (or the DJ_SSH_PORT
// default) using the given credential and runs command, returning stdout,
// stderr and the remote exit code.
func RunSSHCommand(host Host, cred Credential, command string) SSHResult {
	authMethod, err := sshAuthMethod(cred)
	if err != nil {
		return SSHResult{ExitCode: -1, Error: err.Error()}
	}

	config := &ssh.ClientConfig{
		User:            cred.Username,
		Auth:            []ssh.AuthMethod{authMethod},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         cfg.SSHDialTimeout,
	}

	addr := net.JoinHostPort(host.IP, strconv.Itoa(hostPort(host)))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return SSHResult{ExitCode: -1, Error: fmt.Sprintf("dial failed: %v", err)}
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return SSHResult{ExitCode: -1, Error: fmt.Sprintf("session failed: %v", err)}
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	result := SSHResult{}
	err = session.Run(command)
	result.Stdout = stdout.String()
	result.Stderr = stderr.String()

	if err == nil {
		result.ExitCode = 0
		return result
	}

	var exitErr *ssh.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitStatus()
		return result
	}

	result.ExitCode = -1
	result.Error = err.Error()
	return result
}
