package main

import (
	"net"
	"strconv"
)

// TCPPing dials host:port with a short timeout to determine online/offline status.
func TCPPing(ip string, port int) bool {
	if port == 0 {
		port = cfg.SSHPort
	}
	addr := net.JoinHostPort(ip, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, cfg.TCPPingTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
