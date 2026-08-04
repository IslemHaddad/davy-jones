import { useState } from "react";
import { X, Upload } from "lucide-react";
import { api } from "../../lib/api";
import { parseProjectExport, type ProjectExport } from "../../lib/umlExport";
import type { Project } from "../../types";

interface ImportSummary {
  vpns: number;
  hosts: number;
  services: number;
  credentials: number;
  skippedCredentials: number;
}

interface ImportProjectDialogProps {
  existingProjects: Project[];
  onClose: () => void;
  onImported: (newProjectId: string) => Promise<void>;
}

function dedupeName(name: string, existing: Project[]): string {
  if (!existing.some((p) => p.name === name)) return name;
  let n = 2;
  while (existing.some((p) => p.name === `${name} (${n})`)) n++;
  return `${name} (${n})`;
}

export function ImportProjectDialog({
  existingProjects,
  onClose,
  onImported,
}: ImportProjectDialogProps) {
  const [parsed, setParsed] = useState<ProjectExport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleFile(file: File) {
    setFileError(null);
    setSummary(null);
    try {
      const json = JSON.parse(await file.text());
      const result = parseProjectExport(json);
      if (!result) {
        setFileError(
          "This doesn't look like a Davy Jones project export (missing project/vpns/hosts/services/credentials).",
        );
        setParsed(null);
        return;
      }
      setParsed(result);
    } catch {
      setFileError("Could not parse this file as JSON.");
      setParsed(null);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    setError(null);
    setImporting(true);
    try {
      const name = dedupeName(parsed.project.name, existingProjects);
      const project = await api.projects.create({
        name,
        description: parsed.project.description,
      });

      const credIdMap = new Map<string, string>();
      let skippedCredentials = 0;
      for (const c of parsed.credentials) {
        if (!c.password && !c.privateKey) {
          skippedCredentials++;
          continue;
        }
        const created = await api.credentials.create({
          name: c.name,
          username: c.username,
          password: c.password,
          privateKey: c.privateKey,
          passphrase: c.passphrase,
          projectId: project.id,
        });
        credIdMap.set(c.id, created.id);
      }

      const vpnIdMap = new Map<string, string>();
      for (const v of parsed.vpns) {
        const created = await api.vpns.create({
          name: v.name,
          image: v.image,
          containerName: v.containerName,
          command: v.command,
          remoteGateway: v.remoteGateway,
          port: v.port,
          clientCertificate: v.clientCertificate,
          credentialId: v.credentialId
            ? credIdMap.get(v.credentialId)
            : undefined,
          projectId: project.id,
        });
        vpnIdMap.set(v.id, created.id);
      }

      const hostIdMap = new Map<string, string>();
      for (const h of parsed.hosts) {
        const created = await api.hosts.create({
          name: h.name,
          ip: h.ip,
          credentialId: credIdMap.get(h.credentialId) ?? "",
          vpnId: h.vpnId ? vpnIdMap.get(h.vpnId) : undefined,
          port: h.port,
          projectId: project.id,
        });
        hostIdMap.set(h.id, created.id);
      }

      let serviceCount = 0;
      for (const s of parsed.services) {
        const hostId = hostIdMap.get(s.hostId);
        if (!hostId) continue;
        await api.services.create({
          name: s.name,
          type: s.type,
          hostId,
          projectId: project.id,
        });
        serviceCount++;
      }

      setSummary({
        vpns: vpnIdMap.size,
        hosts: hostIdMap.size,
        services: serviceCount,
        credentials: credIdMap.size,
        skippedCredentials,
      });
      await onImported(project.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-full max-w-md flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-ink">
            Import Project
          </span>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {summary ? (
            <div className="flex flex-col gap-2 text-xs text-ink">
              <p>Imported as a new project.</p>
              <ul className="list-disc pl-4 text-ink-faint">
                <li>{summary.vpns} VPNs</li>
                <li>{summary.hosts} hosts</li>
                <li>{summary.services} services</li>
                <li>{summary.credentials} credentials</li>
                {summary.skippedCredentials > 0 && (
                  <li className="text-red-400">
                    {summary.skippedCredentials} credentials skipped (redacted
                    export -- add them manually)
                  </li>
                )}
              </ul>
              <button
                onClick={onClose}
                className="mt-2 rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
                className="text-xs text-ink-faint"
              />
              {fileError && <p className="text-xs text-red-400">{fileError}</p>}
              {parsed && (
                <p className="text-xs text-ink-faint">
                  Ready to import <span className="text-ink">{parsed.project.name}</span>{" "}
                  as a new project ({parsed.vpns.length} VPNs,{" "}
                  {parsed.hosts.length} hosts, {parsed.services.length} services,{" "}
                  {parsed.credentials.length} credentials).
                </p>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                onClick={handleImport}
                disabled={!parsed || importing}
                className="flex items-center justify-center gap-1.5 rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas disabled:opacity-40"
              >
                <Upload size={12} />
                {importing ? "Importing..." : "Import as New Project"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
