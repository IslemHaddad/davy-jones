import type {
  CommandResult,
  Credential,
  Host,
  SSHResult,
  SavedCommand,
  SealStatus,
  Service,
  Vpn,
} from "../types";

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

  return json as T;
}

export const api = {
  vpns: {
    list: () => request<Vpn[]>("GET", "/api/vpns"),
    create: (vpn: Omit<Vpn, "id">) => request<Vpn>("POST", "/api/vpns", vpn),
    update: (id: string, vpn: Omit<Vpn, "id">) =>
      request<Vpn>("PUT", `/api/vpns/${id}`, vpn),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/vpns/${id}`),
  },

  hosts: {
    list: () => request<Host[]>("GET", "/api/hosts"),
    create: (host: Omit<Host, "id">) =>
      request<Host>("POST", "/api/hosts", host),
    update: (id: string, host: Omit<Host, "id">) =>
      request<Host>("PUT", `/api/hosts/${id}`, host),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/hosts/${id}`),
    ping: (id: string) =>
      request<{ online: boolean }>("GET", `/api/hosts/${id}/ping`),
  },

  services: {
    list: () => request<Service[]>("GET", "/api/services"),
    create: (service: Omit<Service, "id">) =>
      request<Service>("POST", "/api/services", service),
    update: (id: string, service: Omit<Service, "id">) =>
      request<Service>("PUT", `/api/services/${id}`, service),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/services/${id}`),
  },

  credentials: {
    list: () => request<Credential[]>("GET", "/api/credentials"),
    create: (credential: Omit<Credential, "id">) =>
      request<Credential>("POST", "/api/credentials", credential),
    update: (id: string, credential: Omit<Credential, "id">) =>
      request<Credential>("PUT", `/api/credentials/${id}`, credential),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/api/credentials/${id}`),
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
    setup: (password: string) =>
      request<{ ok: boolean }>("POST", "/api/auth/setup", { password }),
    login: (password: string) =>
      request<{ token: string }>("POST", "/api/auth/login", { password }),
    logout: (token: string) =>
      request<{ ok: boolean }>("POST", "/api/auth/logout", { token }),
    validate: (token: string) =>
      request<{ valid: boolean }>("POST", "/api/auth/validate", { token }),
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
