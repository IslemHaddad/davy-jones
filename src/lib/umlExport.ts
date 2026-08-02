import type { Credential, Host, Project, Service, Vpn } from "../types";

interface ExportOpts {
  includeSecrets: boolean;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

// plantUmlSafe neutralizes user-controlled text before it's interpolated
// into PlantUML source: stripping quotes/newlines prevents breaking out of
// a quoted label, and escaping a leading "!"/"@" blocks it from being
// parsed as a preprocessor directive (e.g. "!include http://attacker/...")
// if it ever ends up at the start of a line.
function plantUmlSafe(s: string): string {
  return s.replace(/["\n\r]/g, " ").replace(/^[!@]/, "_");
}

function credentialLine(cred: Credential | undefined, opts: ExportOpts): string[] {
  if (!cred) return ["  credential: (none configured)"];
  const authMethod = cred.privateKey ? "private key" : "password";
  const lines = [
    `  credential: ${plantUmlSafe(cred.name)} (user: ${plantUmlSafe(cred.username)}, auth: ${authMethod})`,
  ];
  if (opts.includeSecrets) {
    if (cred.password) lines.push(`  password: ${plantUmlSafe(cred.password)}`);
    if (cred.privateKey)
      lines.push(`  private key:\\n${plantUmlSafe(cred.privateKey.replace(/\n/g, "\\n"))}`);
    if (cred.passphrase) lines.push(`  passphrase: ${plantUmlSafe(cred.passphrase)}`);
  }
  return lines;
}

// Generates PlantUML deployment-diagram source: a plaintext, widely-supported
// UML DSL, opened in any PlantUML viewer (plantuml.com, VS Code extension,
// local jar). This avoids standing up a rendering service for what's meant
// as a documentation artifact. Secrets are redacted unless opts.includeSecrets
// is explicitly set -- callers must default that to false.
export function buildPlantUML(
  project: Project | null,
  vpns: Vpn[],
  hosts: Host[],
  services: Service[],
  credentials: Credential[],
  opts: ExportOpts,
): string {
  const credById = new Map(credentials.map((c) => [c.id, c]));
  const servicesByHost = new Map<string, Service[]>();
  for (const s of services) {
    const list = servicesByHost.get(s.hostId) ?? [];
    list.push(s);
    servicesByHost.set(s.hostId, list);
  }

  const lines: string[] = ["@startuml"];
  const title = project ? project.name : "Unassigned";
  lines.push(`title ${plantUmlSafe(title)} — Infrastructure`);
  lines.push("");

  for (const v of vpns) {
    lines.push(
      `node "${plantUmlSafe(v.name)}\\n${plantUmlSafe(v.network)}" as vpn_${sanitizeId(v.id)}`,
    );
  }
  lines.push("");

  for (const h of hosts) {
    const hostVar = `host_${sanitizeId(h.id)}`;
    const hostServices = servicesByHost.get(h.id) ?? [];
    const hostLabel = `${plantUmlSafe(h.name)}\\n${plantUmlSafe(h.ip)}`;
    if (hostServices.length > 0) {
      lines.push(`node "${hostLabel}" as ${hostVar} {`);
      for (const s of hostServices) {
        lines.push(
          `  artifact "${plantUmlSafe(s.name)} (${plantUmlSafe(s.type)})" as svc_${sanitizeId(s.id)}`,
        );
      }
      lines.push("}");
    } else {
      lines.push(`node "${hostLabel}" as ${hostVar}`);
    }
    if (h.vpnId) {
      lines.push(`vpn_${sanitizeId(h.vpnId)} --> ${hostVar}`);
    }
    lines.push(`note right of ${hostVar}`);
    lines.push(...credentialLine(credById.get(h.credentialId), opts));
    lines.push("end note");
    lines.push("");
  }

  lines.push("@enduml");
  return lines.join("\n");
}

// ProjectExport is the round-trippable format: unlike the PlantUML export
// (a rendering language meant for humans/diagram tools), this is what
// ImportProjectDialog reads back in. Same redact/opt-in-secrets rule as the
// UML export -- credentials keep password/privateKey/passphrase only when
// includeSecrets is set.
export interface ProjectExport {
  project: { name: string; description?: string };
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
}

export function buildProjectJson(
  project: Project | null,
  vpns: Vpn[],
  hosts: Host[],
  services: Service[],
  credentials: Credential[],
  opts: ExportOpts,
): ProjectExport {
  return {
    project: {
      name: project?.name ?? "Unassigned",
      description: project?.description,
    },
    vpns,
    hosts,
    services,
    credentials: credentials.map((c) =>
      opts.includeSecrets
        ? c
        : { ...c, password: undefined, privateKey: undefined, passphrase: undefined },
    ),
  };
}

// parseProjectExport validates the minimal shape of an uploaded export file
// before ImportProjectDialog acts on it. Not a full schema check -- just
// enough to reject garbage input with a clear message instead of a cryptic
// runtime error partway through creating resources.
export function parseProjectExport(data: unknown): ProjectExport | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.project !== "object" || d.project === null) return null;
  const project = d.project as Record<string, unknown>;
  if (typeof project.name !== "string") return null;
  if (
    !Array.isArray(d.vpns) ||
    !Array.isArray(d.hosts) ||
    !Array.isArray(d.services) ||
    !Array.isArray(d.credentials)
  ) {
    return null;
  }
  return d as unknown as ProjectExport;
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
