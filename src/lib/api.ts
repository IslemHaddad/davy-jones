import type {
  AuditEntry,
  CommandResult,
  Credential,
  DiscoveryResult,
  GraphLayout,
  Host,
  HostMetricsResponse,
  IpsecCredential,
  NodePosition,
  Project,
  Role,
  SSHResult,
  ServiceStatus,
  SavedCommand,
  SealStatus,
  Service,
  User,
  Vpn,
} from "../types";

// projectId is optional (unfiltered) but, when passed, "" means the
// implicit "Unassigned" bucket -- so it's distinguished from "not passed"
// via presence in the params object, not truthiness.
function projectQuery(projectId?: string): string {
  if (projectId === undefined) return "";
  return `?projectId=${encodeURIComponent(projectId)}`;
}

// The frontend is served by the same Go binary in production (same origin,
// relative paths) and proxied to it in dev (see vite.config.ts's
// server.proxy) -- so this never needs an absolute base URL.

let authToken: string | null = null;

/** Called by AuthContext on login/logout so every request below can attach
 * the current session token without each call site threading it through. */
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Read by the terminal WebSocket helper, which can't reuse this module's
 * fetch-based request() -- the WS auth handshake needs the raw token. */
export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // empty body (e.g. some error responses) -- fine, json stays null
  }

  if (!res.ok) {
    const message =
      (json as { error?: string } | null)?.error ??
      `request failed (${res.status})`;
    throw new Error(message);
  }

  // A path the server doesn't know falls through to the SPA handler, which
  // answers index.html with a 200. Without this check that HTML parses as
  // "no JSON" and request() hands back null typed as T -- the caller then
  // does .map() on it and takes the whole UI down with a blank screen. The
  // usual cause is a frontend newer than the running backend, so say so.
  if (!isJson) {
    throw new Error(
      `${method} ${path} did not return JSON (got ${contentType || "no content-type"}). ` +
        `This route is missing from the running backend -- restart it so it matches the frontend.`,
    );
  }

  return json as T;
}

export const api = {
  vpns: {
    list: (projectId?: string) =>
      request<Vpn[]>("GET", `/api/vpns${projectQuery(projectId)}`),
    create: (vpn: Omit<Vpn, "id">) =>
      request<Vpn & { container: CommandResult }>("POST", "/api/vpns", vpn),
    update: (id: string, vpn: Omit<Vpn, "id">) =>
      request<Vpn & { container: CommandResult }>(
        "PUT",
        `/api/vpns/${id}`,
        vpn,
      ),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/vpns/${id}`),
  },

  hosts: {
    list: (projectId?: string) =>
      request<Host[]>("GET", `/api/hosts${projectQuery(projectId)}`),
    create: (host: Omit<Host, "id">) =>
      request<Host>("POST", "/api/hosts", host),
    update: (id: string, host: Omit<Host, "id">) =>
      request<Host>("PUT", `/api/hosts/${id}`, host),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/hosts/${id}`),
    ping: (id: string) =>
      request<{ online: boolean }>("GET", `/api/hosts/${id}/ping`),
    metrics: (id: string) =>
      request<HostMetricsResponse>("GET", `/api/hosts/${id}/metrics`),
    discoverServices: (id: string, type: string) =>
      request<DiscoveryResult>("POST", `/api/hosts/${id}/discover-services`, {
        type,
      }),
    serviceStatus: (id: string, names: string[]) =>
      request<ServiceStatus[]>("POST", `/api/hosts/${id}/service-status`, {
        names,
      }),
  },

  services: {
    list: (projectId?: string) =>
      request<Service[]>("GET", `/api/services${projectQuery(projectId)}`),
    create: (service: Omit<Service, "id">) =>
      request<Service>("POST", "/api/services", service),
    update: (id: string, service: Omit<Service, "id">) =>
      request<Service>("PUT", `/api/services/${id}`, service),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/services/${id}`),
  },

  credentials: {
    list: (projectId?: string) =>
      request<Credential[]>(
        "GET",
        `/api/credentials${projectQuery(projectId)}`,
      ),
    create: (credential: Omit<Credential, "id">) =>
      request<Credential>("POST", "/api/credentials", credential),
    update: (id: string, credential: Omit<Credential, "id">) =>
      request<Credential>("PUT", `/api/credentials/${id}`, credential),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/credentials/${id}`),
  },

  ipsecCredentials: {
    list: (projectId?: string) =>
      request<IpsecCredential[]>(
        "GET",
        `/api/ipsec-credentials${projectQuery(projectId)}`,
      ),
    create: (credential: Omit<IpsecCredential, "id">) =>
      request<IpsecCredential>("POST", "/api/ipsec-credentials", credential),
    // Partial on purpose. The server's PUT is a *merge*: a key that isn't in
    // the body keeps its stored value. That's what lets the form leave a
    // secret blank to mean "unchanged" instead of wiping a password it was
    // never allowed to display in the first place.
    update: (id: string, credential: Partial<Omit<IpsecCredential, "id">>) =>
      request<IpsecCredential>(
        "PUT",
        `/api/ipsec-credentials/${id}`,
        credential,
      ),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/ipsec-credentials/${id}`),

    // Which profile a VPN draws its {{ipsec*}} placeholders from. Kept off
    // the VPN payload itself so this feature can't blank a field on a client
    // that doesn't know about it -- see IpsecConfig in backend/ipsec.go.
    binding: (vpnId: string) =>
      request<{ credentialId: string }>("GET", `/api/vpns/${vpnId}/ipsec`),
    /** Pass "" to clear the binding. */
    bind: (vpnId: string, credentialId: string) =>
      request<{ credentialId: string }>("PUT", `/api/vpns/${vpnId}/ipsec`, {
        credentialId,
      }),
  },

  layout: {
    get: (projectId: string) =>
      request<GraphLayout>(
        "GET",
        `/api/layout?projectId=${encodeURIComponent(projectId)}`,
      ),
    save: (projectId: string, positions: Record<string, NodePosition>) =>
      request<GraphLayout>("PUT", "/api/layout", { projectId, positions }),
  },

  projects: {
    list: () => request<Project[]>("GET", "/api/projects"),
    create: (project: Omit<Project, "id" | "createdAt">) =>
      request<Project>("POST", "/api/projects", project),
    update: (id: string, project: Omit<Project, "id" | "createdAt">) =>
      request<Project>("PUT", `/api/projects/${id}`, project),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/projects/${id}`),
    exportEvent: (
      id: string,
      format: "uml" | "json" | "drawio",
      includeSecrets: boolean,
    ) =>
      request<{ ok: boolean }>("POST", `/api/projects/${id}/export`, {
        format,
        includeSecrets,
      }),
  },

  // Public: no session, no unseal requirement. Possession of a threshold of
  // key shares is itself the authorization to unseal -- nothing else is
  // reachable (including login) until this is done.
  seal: {
    status: () => request<SealStatus>("GET", "/api/seal/status"),
    initialize: () =>
      request<{ shares: string[]; threshold: number; totalShares: number }>(
        "POST",
        "/api/seal/initialize",
      ),
    unseal: (share: string) =>
      request<SealStatus & { unsealed: boolean }>(
        "POST",
        "/api/seal/unseal",
        { share },
      ),
  },

  auth: {
    status: () => request<{ isSetup: boolean }>("GET", "/api/auth/status"),
    setup: (username: string, password: string) =>
      request<{ ok: boolean }>("POST", "/api/auth/setup", {
        username,
        password,
      }),
    login: (username: string, password: string) =>
      request<{ token: string; user: User }>("POST", "/api/auth/login", {
        username,
        password,
      }),
    logout: (token: string) =>
      request<{ ok: boolean }>("POST", "/api/auth/logout", { token }),
    validate: (token: string) =>
      request<{ valid: boolean; user?: User }>("POST", "/api/auth/validate", {
        token,
      }),
  },

  users: {
    list: () => request<User[]>("GET", "/api/users"),
    create: (username: string, password: string, role: Role) =>
      request<User>("POST", "/api/users", { username, password, role }),
    setRole: (id: string, role: Role) =>
      request<User>("PUT", `/api/users/${id}/role`, { role }),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/users/${id}`),
    /** Changes the signed-in account's own password; no id, by design. */
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>("POST", "/api/users/me/password", {
        currentPassword,
        newPassword,
      }),
  },

  audit: {
    list: (params?: { limit?: number; userId?: string; action?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.userId) qs.set("userId", params.userId);
      if (params?.action) qs.set("action", params.action);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<AuditEntry[]>("GET", `/api/audit${suffix}`);
    },
  },

  ssh: {
    exec: (hostId: string, command: string) =>
      request<SSHResult>("POST", "/api/ssh/exec", { hostId, command }),
  },

  savedCommands: {
    list: () => request<SavedCommand[]>("GET", "/api/saved-commands"),
    create: (cmd: Omit<SavedCommand, "id">) =>
      request<SavedCommand>("POST", "/api/saved-commands", cmd),
    update: (id: string, cmd: Omit<SavedCommand, "id">) =>
      request<SavedCommand>("PUT", `/api/saved-commands/${id}`, cmd),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/saved-commands/${id}`),
  },

  vpnDiagnostics: {
    dockerStart: (id: string) =>
      request<CommandResult>("POST", `/api/vpns/${id}/docker/start`),
    dockerStop: (id: string) =>
      request<CommandResult>("POST", `/api/vpns/${id}/docker/stop`),
    dockerStatus: (id: string) =>
      request<CommandResult>("GET", `/api/vpns/${id}/docker/status`),
    dockerLogs: (id: string) =>
      request<CommandResult>("GET", `/api/vpns/${id}/docker/logs`),
    dockerPing: (id: string, targetIp: string) =>
      request<CommandResult>("POST", `/api/vpns/${id}/docker/ping`, {
        targetIp,
      }),
    dockerNc: (id: string, targetIp: string, port?: number) =>
      request<CommandResult>("POST", `/api/vpns/${id}/docker/nc`, {
        targetIp,
        port,
      }),
  },
};
