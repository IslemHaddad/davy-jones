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

/**
 * How an IPsec tunnel authenticates. These are the four flows a strongSwan
 * client actually distinguishes, and they map 1:1 onto the ipsec-vpn
 * image's VPN_IKE_MODE. Which one is chosen decides which fields below are
 * required — see IKE_MODES for the specifics.
 */
export type IpsecIkeMode =
  | "ikev2-eap"
  | "ikev2-psk"
  | "ikev1-xauth"
  | "ikev2-cert";

export const IKE_MODES: {
  value: IpsecIkeMode;
  label: string;
  hint: string;
  needs: { psk?: boolean; login?: boolean; clientCert?: boolean };
}[] = [
  {
    value: "ikev2-eap",
    label: "IKEv2 + EAP (username / password)",
    hint: "The gateway proves itself with a certificate; you authenticate with a login. The usual corporate setup, and this image's default.",
    needs: { login: true },
  },
  {
    value: "ikev2-psk",
    label: "IKEv2 + pre-shared key",
    hint: "A single shared secret both ends hold. No certificates involved.",
    needs: { psk: true },
  },
  {
    value: "ikev1-xauth",
    label: "IKEv1 + XAuth (group secret + login)",
    hint: "The legacy Cisco / FortiGate style: a group pre-shared key, plus a per-user login carried over XAuth.",
    needs: { psk: true, login: true },
  },
  {
    value: "ikev2-cert",
    label: "IKEv2 + client certificate",
    hint: "You authenticate with an X.509 keypair rather than a secret.",
    needs: { clientCert: true },
  },
];

/**
 * Credentials for an IPsec tunnel (IKEv1/IKEv2 — strongSwan, libreswan,
 * Cisco/Fortinet gateways). Deliberately separate from `Credential`: an
 * IPsec tunnel needs a pre-shared key or an X.509 keypair, IKE identities
 * on both ends, an optional XAUTH/EAP user and the crypto proposals the
 * gateway insists on — none of which fit the SSH-shaped `Credential`.
 *
 * Every secret field is optional here because the server strips them from
 * responses for roles that may not read secrets, and because a blank secret
 * on save means "keep what's stored" (the server's PUT is a merge).
 */
export interface IpsecCredential {
  id: string;
  name: string;
  ikeMode: IpsecIkeMode;
  /** 1 or 2; omitted/0 means "derive it from ikeMode". */
  ikeVersion?: number;
  /** Pre-shared key, or the *group* secret in ikev1-xauth. */
  psk?: string;
  /** Our X.509 material (ikev2-cert). */
  certificate?: string;
  privateKey?: string;
  /** Not usable with the bundled image, which loads keys with --noprompt. */
  passphrase?: string;
  /** The *gateway's* certificate or CA, pinned as a trust anchor. */
  gatewayCert?: string;
  /** IKE identities (leftid/rightid) — gateways often key policy on these. */
  localId?: string;
  remoteId?: string;
  /** IKEv1 group/aggressive-mode group name, for gateways that require one. */
  group?: string;
  /** XAUTH (IKEv1) / EAP (IKEv2) login. */
  username?: string;
  password?: string;
  /** Phase-1 / phase-2 algorithm sets, e.g. "aes256-sha256-modp2048". */
  ikeProposal?: string;
  espProposal?: string;
  /** Subnets routed into the tunnel. Empty = everything. See the form's warning. */
  remoteTs?: string;
  localTs?: string;
  /** ESP in userspace, for hosts without a usable kernel XFRM stack. */
  userland?: boolean;
  projectId?: string;
}

/**
 * The `{{...}}` tokens a VPN's container command may use to receive values
 * from its bound IPsec profile. Mirrors `ipsecPlaceholders` in
 * backend/ipsec.go — shown in the UI so the set is discoverable rather than
 * folklore. Keep the two lists in step.
 */
export const IPSEC_PLACEHOLDERS = [
  "{{ipsecPsk}}",
  "{{ipsecIkeMode}}",
  "{{ipsecAuthMode}}",
  "{{ipsecIkeVersion}}",
  "{{ipsecLocalId}}",
  "{{ipsecRemoteId}}",
  "{{ipsecGroup}}",
  "{{ipsecUser}}",
  "{{ipsecPass}}",
  "{{ipsecIkeProposal}}",
  "{{ipsecEspProposal}}",
  "{{ipsecRemoteTs}}",
  "{{ipsecLocalTs}}",
  "{{ipsecUserland}}",
  "{{ipsecCert}}",
  "{{ipsecCertB64}}",
  "{{ipsecKey}}",
  "{{ipsecKeyB64}}",
  "{{ipsecKeyPassphrase}}",
  "{{ipsecGatewayCert}}",
  "{{ipsecGatewayCertB64}}",
] as const;

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
