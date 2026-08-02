import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { api } from "../../lib/api";
import { buildPlantUML, buildProjectJson, downloadTextFile } from "../../lib/umlExport";
import type { Credential, Host, Project, Service, Vpn } from "../../types";

interface ExportUmlDialogProps {
  project: Project | null; // null == the "Unassigned" bucket
  onClose: () => void;
}

export function ExportUmlDialog({ project, onClose }: ExportUmlDialogProps) {
  const projectId = project?.id ?? "";
  const [loading, setLoading] = useState(true);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [vpns, setVpns] = useState<Vpn[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);

  useEffect(() => {
    Promise.all([
      api.vpns.list(projectId),
      api.hosts.list(projectId),
      api.services.list(projectId),
      api.credentials.list(projectId),
    ]).then(([v, h, s, c]) => {
      setVpns(v);
      setHosts(h);
      setServices(s);
      setCredentials(c);
      setLoading(false);
    });
  }, [projectId]);

  async function handleExportUml() {
    const text = buildPlantUML(project, vpns, hosts, services, credentials, {
      includeSecrets,
    });
    downloadTextFile(`${project?.name ?? "unassigned"}.puml`, text, "text/plain");
    if (project) {
      await api.projects.exportEvent(project.id, "uml", includeSecrets).catch(() => {});
    }
  }

  async function handleExportJson() {
    const data = buildProjectJson(project, vpns, hosts, services, credentials, {
      includeSecrets,
    });
    downloadTextFile(
      `${project?.name ?? "unassigned"}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
    if (project) {
      await api.projects.exportEvent(project.id, "json", includeSecrets).catch(() => {});
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-full max-w-md flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-ink">
            Export {project ? project.name : "Unassigned"}
          </span>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            Include real passwords / private keys in the export
          </label>
          {includeSecrets && (
            <p className="text-[11px] text-red-400">
              This embeds plaintext credentials in the exported file. Treat it
              like the secrets themselves once downloaded.
            </p>
          )}

          <button
            onClick={handleExportUml}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas disabled:opacity-40"
          >
            <Download size={12} />
            Export UML (.puml)
          </button>
          <button
            onClick={handleExportJson}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 rounded border border-border-strong px-3 py-2 text-xs font-bold uppercase tracking-widest text-ink-muted hover:text-ink disabled:opacity-40"
          >
            <Download size={12} />
            Export JSON (re-importable)
          </button>
        </div>
      </div>
    </div>
  );
}
