import { useState } from "react";
import { X, Users as UsersIcon, ScrollText, FolderKanban } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { AuditLogTab } from "./AuditLogTab";
import { ProjectsTab } from "./ProjectsTab";
import type { Project } from "../../types";

export type AdminTab = "users" | "projects" | "audit";

const TABS: { key: AdminTab; label: string; icon: typeof UsersIcon }[] = [
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "audit", label: "Audit Log", icon: ScrollText },
];

interface AdminPanelProps {
  onClose: () => void;
  initialTab?: AdminTab;
  projects: Project[];
  onCreateProject: (
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onUpdateProject: (
    id: string,
    project: Omit<Project, "id" | "createdAt">,
  ) => Promise<void>;
  onDeleteProject: (id: string) => void;
  onProjectsChanged: (newProjectId?: string) => Promise<void>;
}

export function AdminPanel(props: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>(props.initialTab ?? "users");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-ink">
            Admin
          </span>
          <button
            onClick={props.onClose}
            className="text-ink-faint hover:text-ink"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                tab === key
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-faint hover:text-ink-muted"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "users" && <UsersTab />}
          {tab === "projects" && (
            <ProjectsTab
              projects={props.projects}
              onCreate={props.onCreateProject}
              onUpdate={props.onUpdateProject}
              onDelete={props.onDeleteProject}
              onProjectsChanged={props.onProjectsChanged}
            />
          )}
          {tab === "audit" && <AuditLogTab />}
        </div>
      </div>
    </div>
  );
}
