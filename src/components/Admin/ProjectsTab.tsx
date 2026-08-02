import { useEffect, useState } from "react";
import { Pencil, Trash2, Download, Upload } from "lucide-react";
import type { Project, User } from "../../types";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Field, SubmitButton, inputClass } from "../Layout/AddResourcesPanel";
import { ExportUmlDialog } from "./ExportUmlDialog";
import { ImportProjectDialog } from "./ImportProjectDialog";

const emptyForm = { name: "", description: "", memberIds: [] as string[] };

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
  const { currentUser } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [exportingProject, setExportingProject] = useState<Project | null | undefined>(
    undefined,
  );
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    api.users.list().then(setUsers);
  }, []);

  function startEdit(p: Project) {
    setEditingId(p.id);
    setError(null);
    setForm({
      name: p.name,
      description: p.description ?? "",
      memberIds: p.memberIds ?? [],
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
    setForm(emptyForm);
  }

  function toggleMember(userId: string) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(userId)
        ? f.memberIds.filter((id) => id !== userId)
        : [...f.memberIds, userId],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: form.name,
      description: form.description || undefined,
      memberIds: form.memberIds,
    };
    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload);
      }
      setEditingId(null);
      setForm(emptyForm);
    } catch (e) {
      setError(String(e));
    }
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
        {editingId && (
          <Field label="Members (who can access this project)">
            <div className="flex flex-col gap-1 rounded border border-border bg-surface p-2">
              {users.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 text-xs text-ink"
                >
                  <input
                    type="checkbox"
                    checked={form.memberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  {u.username}
                  {u.id === currentUser?.id && (
                    <span className="text-[10px] uppercase tracking-widest text-ink-faint">
                      you
                    </span>
                  )}
                </label>
              ))}
            </div>
          </Field>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
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
                <div className="truncate text-[11px] text-ink-faint">
                  {(p.memberIds ?? []).length} member
                  {(p.memberIds ?? []).length === 1 ? "" : "s"}
                </div>
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
