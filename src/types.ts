export type ClientCertificate = "none" | "local" | "smartcard";

export interface Vpn {
  id: string;
  name: string;
  image: string;
  containerName: string;
  command: string;
  remoteGateway: string;
  port: number; // default 10443
  clientCertificate: ClientCertificate;
  credentialId?: string;
  /** The project that owns this VPN (and alone may delete it). */
  projectId?: string;
  /** Further projects the VPN is shared into, and usable from. */
  sharedProjectIds?: string[];
}

export interface Host {
  id: string;
  name: string;
  ip: string;
  credentialId: string;
  vpnId?: string;
  port?: number; // SSH port; defaults to 22 (server-side) when unset
  projectId?: string;
}

export type ServiceType = "Docker" | "Node" | "LXC" | string;

export interface Service {
  id: string;
  name: string;
  type: ServiceType;
  hostId: string;
  projectId?: string;
}

export interface Credential {
  id: string;
  name: string;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  projectId?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  memberIds?: string[];
  createdAt: string;
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

/**
 * Global permission level, orthogonal to project membership: membership
 * decides which projects you can touch, the role decides what kind of
 * operation you may perform. Read-only accounts never receive credential
 * secrets from the server (they're stripped at the response boundary) and
 * cannot open a shell.
 */
export type Role = "admin" | "readwrite" | "read" | "write";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin — full access + user management",
  readwrite: "Read & write — full access to infrastructure",
  read: "Read only — no changes, no credentials, no shell",
  write: "Write only — can change things, cannot read them back",
};

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: string;
  /** Set on entries from one interactive shell, so its commands group together. */
  sessionId?: string;
}

/** One reading of a host's resource usage. `error` set = collection failed. */
export interface HostMetrics {
  hostId: string;
  collectedAt: string;
  cpuPercent: number;
  cpuCores: number;
  load1: number;
  load5: number;
  load15: number;
  memUsedKb: number;
  memTotalKb: number;
  memPercent: number;
  diskUsedKb: number;
  diskTotalKb: number;
  diskPercent: number;
  uptimeSec: number;
  error?: string;
}

/** Trimmed sample kept for the last hour, for the sparklines. */
export interface MetricSample {
  t: string;
  cpu: number;
  mem: number;
  disk: number;
}

export interface HostMetricsResponse extends HostMetrics {
  history: MetricSample[];
}

/**
 * What a host reports about one Docker service.
 *
 * `onThisHost` is separate from `running` on purpose: a Swarm service is
 * declared on a manager but its tasks run wherever the scheduler put them,
 * so a service can be running and still not belong to this host. Only
 * `onThisHost` justifies drawing an edge from the host to the service.
 */
export interface ServiceStatus {
  name: string;
  running: boolean;
  state: string;
  nodes?: string[];
  onThisHost: boolean;
  /** False when the host couldn't tell us — unreachable, or no such service. */
  found: boolean;
}

/** Result of asking a host what services it is already running. */
export interface DiscoveryResult {
  type: string;
  command: string;
  names: string[];
  raw?: string;
  error?: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * A project's hand-arranged canvas, keyed by graph node id
 * ("host-<id>" / "vpn-<id>" / "service-<id>"). Stored per project, not per
 * user, so everyone opening the project — and every exported diagram — sees
 * the same arrangement.
 */
export interface GraphLayout {
  projectId: string;
  positions: Record<string, NodePosition>;
  updatedAt?: string;
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
