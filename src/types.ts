export type ClientCertificate = "none" | "local" | "smartcard";

export interface Vpn {
  id: string;
  name: string;
  network: string; // CIDR
  clientContainer: string;
  remoteGateway: string;
  port: number; // default 10443
  clientCertificate: ClientCertificate;
  username: string;
}

export interface Host {
  id: string;
  name: string;
  ip: string;
  credentialId: string;
  vpnId?: string;
  port?: number; // SSH port; defaults to 22 (server-side) when unset
}

export type ServiceType = "Docker" | "Node" | "Nginx" | string;

export interface Service {
  id: string;
  name: string;
  type: ServiceType;
  hostId: string;
}

export interface Credential {
  id: string;
  name: string;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface SSHResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface SavedCommand {
  id: string;
  hostId: string;
  name: string;
  command: string;
}

export interface SealStatus {
  initialized: boolean;
  sealed: boolean;
  progress: number;
  threshold: number;
  totalShares: number;
}

export interface TerminalTab {
  id: string;
  hostId: string;
  hostName: string;
  command?: string;
  label: string;
}

export type NodeKind = "vpn" | "host" | "service";

export interface SelectedNode {
  kind: NodeKind;
  id: string;
}
