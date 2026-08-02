import { useState } from "react";
import { Anchor, LogOut, Settings } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { AdminPanel } from "../Admin/AdminPanel";
import type { Project } from "../../types";

interface HeaderProps {
  projects: Project[];
  activeProjectId: string;
  onChangeProject: (id: string) => void;
  onCreateProject: (
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onUpdateProject: (
    id: string,
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onDeleteProject: (id: string) => void;
  onProjectsChanged: () => Promise<void>;
}

export function Header(props: HeaderProps) {
  const { logout, currentUser } = useAuth();
  const [adminOpen, setAdminOpen] = useState(false);

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Anchor size={14} className="text-ink-muted" />
          <span className="text-xs font-semibold tracking-wide text-ink">
            Davy Jones
          </span>
        </div>
        <select
          value={props.activeProjectId}
          onChange={(e) => props.onChangeProject(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-border-strong"
          title="Active project"
        >
          <option value="">Unassigned</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-4">
        {currentUser && (
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">
            {currentUser.username}
          </span>
        )}
        <button
          onClick={() => setAdminOpen(true)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
        >
          <Settings size={12} />
          Admin
        </button>
        <button
          onClick={() => logout()}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
        >
          <LogOut size={12} />
          Lock
        </button>
      </div>
      {adminOpen && (
        <AdminPanel
          onClose={() => setAdminOpen(false)}
          projects={props.projects}
          onCreateProject={props.onCreateProject}
          onUpdateProject={props.onUpdateProject}
          onDeleteProject={props.onDeleteProject}
          onProjectsChanged={props.onProjectsChanged}
        />
      )}
    </header>
  );
}
