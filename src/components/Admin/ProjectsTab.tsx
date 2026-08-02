import { useState } from "react";
import { Pencil, Trash2, Download, Upload } from "lucide-react";
import type { Project } from "../../types";
import { Field, SubmitButton, inputClass } from "../Layout/AddResourcesPanel";
import { ExportUmlDialog } from "./ExportUmlDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";

const emptyForm = { name: "", description: "" };

interface ProjectsTabProps {
  projects: Project[];
  onCreate: (project: Omit<Project, "id" | "createdAt">) => Promise<void>;
  onUpdate: (
    id: string,
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onDelete: (id: string) => void;
  onProjectsChanged: () => Promise<void>;
}

export function ProjectsTab({
  projects,
  onCreate,
  onUpdate,
  onDelete,
  onProjectsChanged,
}: ProjectsTabProps) {
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exportingProject, setExportingProject] = useState<Project | null | undefined>(
    undefined,
  );
  const [importOpen, setImportOpen] = useState(false);

  function startEdit(p: Project) {
    setEditingId(p.id);
    setForm({ name: p.name, description: p.description ?? "" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { name: form.name, description: form.description || undefined };
    if (editingId) {
      await onUpdate(editingId, payload);
    } else {
      await onCreate(payload);
    }
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Field label="Name">
          <input
            required
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className={inputClass}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <SubmitButton label={editingId ? "Update Project" : "Add Project"} />
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="mt-1 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <button
        onClick={() => setImportOpen(true)}
        className="flex items-center justify-center gap-1.5 rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
      >
        <Upload size={12} />
        Import Project (JSON)
      </button>

      <div>
        <div className="section-header mb-2">Existing Projects</div>
        <div className="flex flex-col gap-1.5">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-ink">{p.name}</div>
                {p.description && (
                  <div className="truncate text-[11px] text-ink-faint">
                    {p.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => setExportingProject(p)}
                className="text-ink-faint hover:text-ink"
                title="Export"
              >
                <Download size={12} />
              </button>
              <button
                onClick={() => startEdit(p)}
                className="text-ink-faint hover:text-ink"
                title="Edit"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => onDelete(p.id)}
                className="text-ink-faint hover:text-red-400"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded border border-dashed border-border px-2.5 py-1.5">
            <div className="min-w-0 flex-1 text-xs text-ink-faint">
              Unassigned resources
            </div>
            <button
              onClick={() => setExportingProject(null)}
              className="text-ink-faint hover:text-ink"
              title="Export"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
      </div>

      {exportingProject !== undefined && (
        <ExportUmlDialog
          project={exportingProject}
          onClose={() => setExportingProject(undefined)}
        />
      )}
      {importOpen && (
        <ImportProjectDialog
          existingProjects={projects}
          onClose={() => setImportOpen(false)}
          onImported={onProjectsChanged}
        />
      )}
    </div>
  );
}
