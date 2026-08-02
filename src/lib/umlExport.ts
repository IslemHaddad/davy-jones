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
      `node "${plantUmlSafe(v.name)}\\n${plantUmlSafe(v.remoteGateway)}" as vpn_${sanitizeId(v.id)}`,
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

// xmlEscape/drawioLabel neutralize user-controlled text before it's
// interpolated into mxGraph XML attribute values -- same rationale as
// plantUmlSafe above, different syntax to escape.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function drawioLabel(s: string): string {
  return xmlEscape(s).replace(/\n/g, "&#10;");
}

// Generates a draw.io / diagrams.net file (mxGraph XML): VPNs and hosts as
// boxes, services as boxes hanging off their host, a sticky-note-style
// credential summary per host, and edges for VPN->host and host->service.
// Opens directly in app.diagrams.net or the desktop/VS Code draw.io apps --
// no rendering service needed, same reasoning as the PlantUML export.
export function buildDrawIO(
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

  const cells: string[] = [];
  let nextId = 2; // 0 and 1 are the default root/layer cells

  const vpnCellId = new Map<string, number>();
  vpns.forEach((v, i) => {
    const id = nextId++;
    vpnCellId.set(v.id, id);
    const label = drawioLabel(`${v.name}\n${v.remoteGateway}`);
    cells.push(
      `<mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">` +
        `<mxGeometry x="${i * 220 + 40}" y="40" width="160" height="60" as="geometry" /></mxCell>`,
    );
  });

  hosts.forEach((h, i) => {
    const id = nextId++;
    const x = i * 220 + 40;
    const y = 200;
    const label = drawioLabel(`${h.name}\n${h.ip}`);
    cells.push(
      `<mxCell id="${id}" value="${label}" style="whiteSpace=wrap;html=0;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${y}" width="160" height="60" as="geometry" /></mxCell>`,
    );

    if (h.vpnId && vpnCellId.has(h.vpnId)) {
      const edgeId = nextId++;
      cells.push(
        `<mxCell id="${edgeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="${vpnCellId.get(h.vpnId)}" target="${id}">` +
          `<mxGeometry relative="1" as="geometry" /></mxCell>`,
      );
    }

    const cred = credById.get(h.credentialId);
    const credLines: string[] = [];
    if (cred) {
      const authMethod = cred.privateKey ? "private key" : "password";
      credLines.push(`${cred.name} (user: ${cred.username}, auth: ${authMethod})`);
      if (opts.includeSecrets) {
        if (cred.password) credLines.push(`password: ${cred.password}`);
        if (cred.privateKey) credLines.push(`private key: ${cred.privateKey}`);
        if (cred.passphrase) credLines.push(`passphrase: ${cred.passphrase}`);
      }
    } else {
      credLines.push("(no credential configured)");
    }
    const noteId = nextId++;
    const noteHeight = 40 + credLines.length * 16;
    cells.push(
      `<mxCell id="${noteId}" value="${drawioLabel(credLines.join("\n"))}" style="shape=note;whiteSpace=wrap;html=0;align=left;spacingLeft=6;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${y + 80}" width="180" height="${noteHeight}" as="geometry" /></mxCell>`,
    );

    const hostServices = servicesByHost.get(h.id) ?? [];
    hostServices.forEach((s, j) => {
      const svcId = nextId++;
      const svcY = y + 80 + noteHeight + 20 + j * 50;
      cells.push(
        `<mxCell id="${svcId}" value="${drawioLabel(`${s.name} (${s.type})`)}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1">` +
          `<mxGeometry x="${x}" y="${svcY}" width="160" height="40" as="geometry" /></mxCell>`,
      );
      const svcEdgeId = nextId++;
      cells.push(
        `<mxCell id="${svcEdgeId}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="${id}" target="${svcId}">` +
          `<mxGeometry relative="1" as="geometry" /></mxCell>`,
      );
    });
  });

  const title = drawioLabel(project ? project.name : "Unassigned");
  return `<mxfile host="davy-jones">
  <diagram name="${title}" id="infra">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        ${cells.join("\n        ")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
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
